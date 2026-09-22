// cloudfunctions/scrapManager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getRoles() {
  const res = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  const v = res.data.length ? (res.data[0].value || {}) : {}
  return { supervisors: v.supervisors || [], keepers: v.keepers || [] }
}

// ===== 按地方分管：共用契约（与 memberManager / requisitionManager / purchaseManager 保持一致）=====
// 角色条目结构：{ openid, name, siteId, setAt, setBy }
// siteId 为空 = 旧的「全局」条目（migrateRoles 跑之前的兼容态），视为对所有地方有权限。
function roleScope(roleList, openid) {
  const mine = (roleList || []).filter(x => x.openid === openid)
  return {
    sites: new Set(mine.map(x => x.siteId).filter(Boolean)),
    global: mine.some(x => !x.siteId)
  }
}
function coversSite(scope, siteId) {
  return scope.global || (!!siteId && scope.sites.has(siteId))
}
// =====================================================================================

function logEntry(by, openid, text) {
  return { at: new Date(), by: by || '', openid, text }
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'initCollections') {
    try { await db.createCollection('scraps') } catch (e) {}
    return { success: true }
  }

  if (action === 'getScraps') {
    try { await db.createCollection('scraps') } catch (e) {}
    let q = db.collection('scraps')
    if (data && data.status) q = q.where({ status: data.status })
    const res = await q.orderBy('createdAt', 'desc').limit(200).get()
    return { success: true, list: res.data }
  }

  // 个人页待办：待我审批的报废（按管辖地方过滤）+ 我发起被驳回的
  if (action === 'getMyScrapTodos') {
    try { await db.createCollection('scraps') } catch (e) {}
    const roles = await getRoles()
    const supScope = roleScope(roles.supervisors, openid)
    const all = (await db.collection('scraps').orderBy('createdAt', 'desc').limit(200).get()).data
    const todos = {
      toApprove: all.filter(r => r.status === 'pending' && coversSite(supScope, r.siteId)),
      myRejected: all.filter(r => r.status === 'rejected' && r.applicantOpenid === openid)
    }
    const counts = {}
    let total = 0
    for (const k in todos) { counts[k] = todos[k].length; total += todos[k].length }
    return { success: true, todos, counts, total }
  }

  // 发起报废报损。data: { name, spec, qty, storeId, siteId, reason(损坏/过期/丢失/其他), reasonNote, recyclable(bool), applicantName }
  // 任何营员可发起；一律待主管审批，批准才扣库存。siteId 由前端从库存物品带入，无需改动。
  if (action === 'addScrap') {
    const name = (data.name || '').trim()
    const qty = Number(data.qty) || 0
    if (!name) return { success: false, msg: '物品名不能为空' }
    if (qty <= 0) return { success: false, msg: '请填报废数量' }
    const applicantName = data.applicantName || ''
    await db.collection('scraps').add({
      data: {
        name, spec: data.spec || '',
        qty, storeId: data.storeId || '', siteId: data.siteId || '',
        reason: data.reason || '其他',
        reasonNote: data.reasonNote || '',
        recyclable: !!data.recyclable,
        status: 'pending',
        applicantName, applicantOpenid: openid,
        approverName: '', approverOpenid: '', approvedAt: null, rejectReason: '',
        log: [logEntry(applicantName, openid, `发起报废：${name}×${qty}（${data.reason || '其他'}${data.recyclable ? '·可回收' : '·不可回收'}）`)],
        createdAt: new Date()
      }
    })
    return { success: true }
  }

  // 主管审批（按该单所属地方校验：你得是这个地方的主管）
  if (action === 'approveScrap' || action === 'rejectScrap') {
    const r = (await db.collection('scraps').doc(data.id).get()).data
    if (!r) return { success: false, msg: '报废单不存在' }
    if (r.status !== 'pending') return { success: false, msg: '该单不在待审批状态' }

    const roles = await getRoles()
    const supScope = roleScope(roles.supervisors, openid)
    if (!coversSite(supScope, r.siteId)) {
      return { success: false, msg: '你不是该地方的主管，无权审批' }
    }
    const myName = data.operatorName || ''

    if (action === 'rejectScrap') {
      await db.collection('scraps').doc(data.id).update({
        data: {
          status: 'rejected',
          approverName: myName, approverOpenid: openid,
          rejectReason: data.reason || '',
          log: _.push([logEntry(myName, openid, `驳回：${data.reason || '未填原因'}`)])
        }
      })
      return { success: true }
    }

    // 批准 → 扣库存（按 名字+分库 精确匹配，库存不足拦截）
    let q = db.collection('resources').where({ name: r.name })
    if (r.storeId) q = db.collection('resources').where({ name: r.name, storeId: r.storeId })
    const found = await q.limit(1).get()
    if (found.data.length === 0) return { success: false, msg: `「${r.name}」不在该库，无法核销` }
    const doc = found.data[0]
    if ((doc.qty || 0) < r.qty) return { success: false, msg: `「${r.name}」库存不足（剩 ${doc.qty || 0}，要核销 ${r.qty}）` }

    // 报废到 0 也保留物品（qty=0），不自动删，便于对账
    await db.collection('resources').doc(doc._id).update({
      data: { qty: (doc.qty || 0) - r.qty, updatedAt: new Date() }
    })
    // 写报废动态（type:'scrap'，区别于领料的 out）
    await db.collection('logs').add({
      data: {
        type: 'scrap', itemName: r.name, qty: r.qty,
        reason: r.reason, recyclable: r.recyclable,
        operatorName: r.applicantName, approverName: myName, openid,
        createdAt: new Date()
      }
    })
    await db.collection('scraps').doc(data.id).update({
      data: {
        status: 'done',
        approverName: myName, approverOpenid: openid, approvedAt: new Date(),
        log: _.push([logEntry(myName, openid, '审批通过，已核销扣库存')])
      }
    })
    return { success: true }
  }

  // 删除报废单（仅申请人，pending/rejected 可删）
  if (action === 'deleteScrap') {
    const r = (await db.collection('scraps').doc(data.id).get()).data
    if (!r) return { success: false, msg: '报废单不存在' }
    if (r.applicantOpenid !== openid) return { success: false, msg: '只有申请人能删除' }
    if (r.status !== 'pending' && r.status !== 'rejected') return { success: false, msg: '已核销的报废单不可删除' }
    await db.collection('scraps').doc(data.id).remove()
    return { success: true }
  }

  return { success: false, msg: 'unknown action' }
}