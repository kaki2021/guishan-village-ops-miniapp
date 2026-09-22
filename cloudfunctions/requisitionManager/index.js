// cloudfunctions/requisitionManager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ---- 角色读取（复用 config 里的主管/库管）----
async function getRoles() {
  const res = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  const v = res.data.length ? (res.data[0].value || {}) : {}
  return { supervisors: v.supervisors || [], keepers: v.keepers || [] }
}

// ===== 按地方分管：共用契约（与 memberManager / scrapManager / purchaseManager 保持一致）=====
// 角色条目结构：{ openid, name, siteId, setAt, setBy }
// siteId 为空 = 旧的「全局」条目（migrateRoles 跑之前的兼容态），视为对所有地方有权限。
function roleScope(roleList, openid) {
  const mine = (roleList || []).filter(x => x.openid === openid)
  return {
    sites: new Set(mine.map(x => x.siteId).filter(Boolean)),
    global: mine.some(x => !x.siteId) // 存在无 siteId 的旧条目 → 全局兜底
  }
}
function coversSite(scope, siteId) {
  return scope.global || (!!siteId && scope.sites.has(siteId))
}
// 取一张领料单归属的地方（页面发起时整单选同一个地方+分库，故取首个带 siteId 的项）
function reqSiteId(r) {
  const it = (r.items || []).find(i => i && i.siteId)
  return it ? it.siteId : ''
}
// =====================================================================================

function logEntry(by, openid, text) {
  return { at: new Date(), by: by || '', openid, text }
}

// 出库扣减：按 storeId + name 精确匹配（同名可能存在于不同分库）。返回 {ok, msg}
// 先做一次整单库存校验，全部够才扣，避免扣一半卡住
async function deductItems(items) {
  // 1) 校验
  for (const it of items) {
    const qty = Number(it.qty) || 0
    if (qty <= 0) continue
    let q = db.collection('resources').where({ name: it.name })
    if (it.storeId) q = db.collection('resources').where({ name: it.name, storeId: it.storeId })
    const r = await q.limit(1).get()
    if (r.data.length === 0) return { ok: false, msg: `「${it.name}」不在该库，无法出库` }
    if ((r.data[0].qty || 0) < qty) return { ok: false, msg: `「${it.name}」库存不足（剩 ${r.data[0].qty || 0}，要领 ${qty}）` }
  }
  // 2) 扣减
  for (const it of items) {
    const qty = Number(it.qty) || 0
    if (qty <= 0) continue
    let q = db.collection('resources').where({ name: it.name })
    if (it.storeId) q = db.collection('resources').where({ name: it.name, storeId: it.storeId })
    const r = await q.limit(1).get()
    const doc = r.data[0]
    const newQty = (doc.qty || 0) - qty
    await db.collection('resources').doc(doc._id).update({
      data: { qty: newQty, updatedAt: new Date() }
    })
  }
  return { ok: true }
}

async function writeOutLogs(items, operatorName, openid) {
  for (const it of items) {
    const qty = Number(it.qty) || 0
    if (qty <= 0) continue
    await db.collection('logs').add({
      data: { type: 'out', itemName: it.name, qty, operatorName: operatorName || '', openid, createdAt: new Date() }
    })
  }
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'initCollections') {
    try { await db.createCollection('requisitions') } catch (e) {}
    return { success: true }
  }

  // 列表（可按状态过滤）
  if (action === 'getRequisitions') {
    try { await db.createCollection('requisitions') } catch (e) {}
    let q = db.collection('requisitions')
    if (data && data.status) q = q.where({ status: data.status })
    const res = await q.orderBy('createdAt', 'desc').limit(200).get()
    return { success: true, list: res.data }
  }

  // 个人页待办聚合（按管辖地方过滤）
  if (action === 'getMyRequisitionTodos') {
    try { await db.createCollection('requisitions') } catch (e) {}
    const roles = await getRoles()
    const supScope = roleScope(roles.supervisors, openid)
    const keepScope = roleScope(roles.keepers, openid)
    const all = (await db.collection('requisitions').orderBy('createdAt', 'desc').limit(200).get()).data
    const todos = {
      // 待审批：只看我管辖地方的单子
      toApprove: all.filter(r => r.status === 'pending' && coversSite(supScope, reqSiteId(r))),
      // 待发货：只看我当库管的地方
      toDeliver: all.filter(r => r.status === 'approved' && coversSite(keepScope, reqSiteId(r))),
      myRejected: all.filter(r => r.status === 'rejected' && r.applicantOpenid === openid)
    }
    const counts = {}
    let total = 0
    for (const k in todos) { counts[k] = todos[k].length; total += todos[k].length }
    return { success: true, todos, counts, total }
  }

  // 发起领料。data: { items:[{name,spec,qty,storeId,siteId,needApproval}], reason, applicantName }
  // needApproval 由前端按物品 consumeMode==='approval' 标好；只要有一个 true，整单走审批
  // 注：siteId 由前端逐项带入（页面发起时已选地方+分库），此处无需改动
  if (action === 'addRequisition') {
    const rawItems = (data.items || []).filter(it => it && it.name && (Number(it.qty) || 0) > 0)
    if (rawItems.length === 0) return { success: false, msg: '请至少填一项要领的物品' }
    const items = rawItems.map(it => ({
      name: String(it.name).trim(),
      spec: it.spec || '',
      qty: Number(it.qty) || 0,
      storeId: it.storeId || '',
      siteId: it.siteId || ''
    }))
    const needApproval = rawItems.some(it => it.needApproval)
    const applicantName = data.applicantName || ''

    const base = {
      items,
      reason: data.reason || '',
      needApproval,
      applicantName, applicantOpenid: openid,
      approverName: '', approverOpenid: '', approvedAt: null, rejectReason: '',
      delivererName: '', delivererOpenid: '', deliveredAt: null,
      createdAt: new Date()
    }

    if (!needApproval) {
      // 免审：提交即出库，当场扣库存
      const ded = await deductItems(items)
      if (!ded.ok) return { success: false, msg: ded.msg }
      await writeOutLogs(items, applicantName, openid)
      base.status = 'done'
      base.deliveredAt = new Date()
      base.delivererName = applicantName
      base.delivererOpenid = openid
      base.log = [logEntry(applicantName, openid, '免审领料，提交即出库')]
      await db.collection('requisitions').add({ data: base })
      return { success: true, immediate: true }
    } else {
      // 需审批
      base.status = 'pending'
      base.log = [logEntry(applicantName, openid, '提交领料申请，待审批')]
      await db.collection('requisitions').add({ data: base })
      return { success: true, immediate: false }
    }
  }

  // 主管审批（按该单所属地方校验：你得是这个地方的主管）
  if (action === 'approveRequisition' || action === 'rejectRequisition') {
    const r = (await db.collection('requisitions').doc(data.id).get()).data
    if (!r) return { success: false, msg: '领料单不存在' }
    if (r.status !== 'pending') return { success: false, msg: '该单不在待审批状态' }

    const roles = await getRoles()
    const supScope = roleScope(roles.supervisors, openid)
    if (!coversSite(supScope, reqSiteId(r))) {
      return { success: false, msg: '你不是该地方的主管，无权审批' }
    }
    const myName = data.operatorName || ''

    if (action === 'approveRequisition') {
      await db.collection('requisitions').doc(data.id).update({
        data: {
          status: 'approved',
          approverName: myName, approverOpenid: openid, approvedAt: new Date(),
          log: _.push([logEntry(myName, openid, '审批通过，待库管发货')])
        }
      })
    } else {
      await db.collection('requisitions').doc(data.id).update({
        data: {
          status: 'rejected',
          approverName: myName, approverOpenid: openid,
          rejectReason: data.reason || '',
          log: _.push([logEntry(myName, openid, `驳回：${data.reason || '未填原因'}`)])
        }
      })
    }
    return { success: true }
  }

  // 库管发货（扣库存，approved → done；按该单所属地方校验）
  if (action === 'deliverRequisition') {
    const r = (await db.collection('requisitions').doc(data.id).get()).data
    if (!r) return { success: false, msg: '领料单不存在' }
    if (r.status !== 'approved') return { success: false, msg: '该单不在待发货状态' }

    const roles = await getRoles()
    const keepScope = roleScope(roles.keepers, openid)
    if (!coversSite(keepScope, reqSiteId(r))) {
      return { success: false, msg: '你不是该地方的库管，无权发货' }
    }
    const myName = data.operatorName || ''

    const ded = await deductItems(r.items || [])
    if (!ded.ok) return { success: false, msg: ded.msg }
    await writeOutLogs(r.items || [], r.applicantName, openid)

    await db.collection('requisitions').doc(data.id).update({
      data: {
        status: 'done',
        delivererName: myName, delivererOpenid: openid, deliveredAt: new Date(),
        log: _.push([logEntry(myName, openid, '已发货，库存已扣减')])
      }
    })
    return { success: true }
  }

  // 删除（仅申请人，且仅 pending/rejected 可删；done 不可删避免破坏台账）
  if (action === 'deleteRequisition') {
    const r = (await db.collection('requisitions').doc(data.id).get()).data
    if (!r) return { success: false, msg: '领料单不存在' }
    if (r.applicantOpenid !== openid) return { success: false, msg: '只有申请人能删除' }
    if (r.status !== 'pending' && r.status !== 'rejected') return { success: false, msg: '已出库的领料单不可删除' }
    await db.collection('requisitions').doc(data.id).remove()
    return { success: true }
  }

  return { success: false, msg: 'unknown action' }
}