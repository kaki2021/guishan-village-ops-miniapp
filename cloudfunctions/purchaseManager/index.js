// cloudfunctions/purchaseManager/index.js
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
async function getTreasurer() {
  const res = await db.collection('config').where({ key: 'treasurer' }).limit(1).get()
  return res.data.length ? (res.data[0].value || null) : null
}

// ===== 按地方分管：共用契约（与 memberManager / requisitionManager / scrapManager 保持一致）=====
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

// 入库：按物品名加库存，完全复刻 warehouseManager.addRecord 的「同名累加 / 不存在则新建」语义
async function stockInItem(item, operatorName, openid, siteId, storeId) {
  const name = String(item.name).trim()
  const qty = Number(item.receivedQty) || 0
  if (!name || qty <= 0) return
  const existing = await db.collection('resources').where({ name }).limit(1).get()
  if (existing.data.length > 0) {
    const r = existing.data[0]
    const patch = { qty: (r.qty || 0) + qty, lastOperator: operatorName || '', updatedAt: new Date() }
    if (siteId && !r.siteId) patch.siteId = siteId
    if (storeId && !r.storeId) patch.storeId = storeId
    await db.collection('resources').doc(r._id).update({ data: patch })
  } else {
    await db.collection('resources').add({
      data: {
        name,
        category: item.category || '其他',
        icon: item.icon || '📦',
        qty,
        lowThreshold: 3,
        siteId: siteId || '',
        storeId: storeId || '',
        lastOperator: operatorName || '',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
  }
  await db.collection('logs').add({
    data: { type: 'in', itemName: name, qty, operatorName: operatorName || '', openid, createdAt: new Date() }
  })
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'initCollections') {
    try { await db.createCollection('purchases') } catch (e) {}
    return { success: true }
  }

  // ====== 读取 ======

  if (action === 'getPurchases') {
    try { await db.createCollection('purchases') } catch (e) {}
    let q = db.collection('purchases')
    if (data && data.status) q = q.where({ status: data.status })
    const res = await q.orderBy('createdAt', 'desc').limit(200).get()
    // 我垫付待还：我采购的、已填实付金额、账房还没记账的单（报账那刻起钱就是垫的，
    // 横跨 待核验/待入库/待记账 三个阶段；记为捐赠也算 recorded，不再显示；
    // converting/converted = 转出资中或已转，不再算待还）
    const awaitMine = res.data.filter(p =>
      p.buyerOpenid === openid &&
      (Number(p.actualAmount) || 0) > 0 &&
      ['checking', 'verified', 'done'].indexOf(p.status) >= 0 &&
      ['recorded', 'converting', 'converted'].indexOf(p.ledgerStatus) < 0
    )
    const myAwait = {
      count: awaitMine.length,
      total: awaitMine.reduce((s, p) => s + (Number(p.actualAmount) || 0), 0),
      ids: awaitMine.map(p => p._id)
    }
    return { success: true, list: res.data, myAwait }
  }

  // 我的采购垫款明细：我领的、报了账、账房还没记账的采购单（供"我的垫付"合并显示 + 转出资勾选）
  // 只有 status='done' && ledgerStatus='pending_record' 的才是"可转出资"的确定待还
  // （checking/verified 阶段钱虽已垫但采购单还没走完，暂不纳入可转，避免流程未完就转出资）
  if (action === 'getMyPurchaseAdvances') {
    try { await db.createCollection('purchases') } catch (e) {}
    const all = (await db.collection('purchases')
      .where({ buyerOpenid: openid, status: 'done', ledgerStatus: 'pending_record' })
      .orderBy('createdAt', 'desc').limit(200).get()).data
    const list = all
      .filter(p => (Number(p.actualAmount) || 0) > 0)
      .map(p => ({
        _id: p._id,
        title: p.title || '采购单',
        amount: Number(p.actualAmount) || 0,
        createdAt: p.createdAt
      }))
    return {
      success: true,
      list,
      total: list.reduce((s, x) => s + x.amount, 0)
    }
  }

  // 个人页待办聚合：按角色 + 管辖地方返回需要我处理的桶
  if (action === 'getMyPurchaseTodos') {
    try { await db.createCollection('purchases') } catch (e) {}
    const roles = await getRoles()
    const treasurer = await getTreasurer()
    const supScope = roleScope(roles.supervisors, openid)
    const keepScope = roleScope(roles.keepers, openid)
    const isTreasurer = !!(treasurer && treasurer.openid === openid)

    const all = (await db.collection('purchases').orderBy('createdAt', 'desc').limit(200).get()).data

    const todos = {
      // 审批/核验/入库都按采购单所属地方过滤；双签：该我签且我还没签才进待办
      toApprove: all.filter(p => p.status === 'pending' && (
        (coversSite(supScope, p.siteId) && !p.supApproved) ||
        (isTreasurer && !p.treaApproved)
      )),
      toVerify: all.filter(p => p.status === 'checking' && coversSite(keepScope, p.siteId)),
      toStockIn: all.filter(p => p.status === 'verified' && coversSite(keepScope, p.siteId)),
      // 记账是全局账房先生，不分地方
      toRecord: isTreasurer ? all.filter(p => p.status === 'done' && p.ledgerStatus === 'pending_record') : [],
      myBuying: all.filter(p => p.status === 'buying' && p.buyerOpenid === openid),
      myRejected: all.filter(p => p.status === 'rejected' && p.initiatorOpenid === openid)
    }
    const counts = {}
    let total = 0
    for (const k in todos) { counts[k] = todos[k].length; total += todos[k].length }
    return {
      success: true, todos, counts, total,
      me: { isSupervisor: supScope.global || supScope.sites.size > 0, isKeeper: keepScope.global || keepScope.sites.size > 0, isTreasurer }
    }
  }

  // ====== 发起（→ 待审批 pending）======
  // 【B方案】发起时必须声明这单是给哪个地方买的（siteId），一路透传到审批/核验/入库
  if (action === 'addPurchase') {
    const rawItems = (data.items || []).filter(it => it && it.name)
    if (rawItems.length === 0) return { success: false, msg: '至少填写一项物品' }
    const siteId = (data.siteId || '').trim()
    if (!siteId) return { success: false, msg: '请选择这单采购给哪个地方' }
    const items = rawItems.map(it => ({
      name: String(it.name).trim(),
      spec: it.spec || '',
      qty: Number(it.qty) || 0
    }))
    const name = data.initiatorName || ''
    // 采购类型：food 食材 / general 物资。老单无此字段，前端读取处按 general 兜底
    const purchaseKind = data.purchaseKind === 'food' ? 'food' : 'general'
    await db.collection('purchases').add({
      data: {
        status: 'pending',
        siteId,
        purchaseKind,
        title: data.title || '',
        items,
        reason: data.reason || '',
        budget: Number(data.budget) || 0,
        initiatorName: name, initiatorOpenid: openid,
        approverName: '', approverOpenid: '', approvedAt: null, rejectReason: '',
        supApproved: null, treaApproved: null,
        buyerName: '', buyerOpenid: '', claimedAt: null,
        receipts: [], actualAmount: 0, submittedAt: null,
        checkerName: '', checkerOpenid: '', checkedAt: null,
        stockedAt: null,
        ledgerStatus: '', ledgerTxnId: '', ledgerNote: '',
        log: [logEntry(name, openid, '发起采购申请')],
        createdAt: new Date()
      }
    })
    return { success: true }
  }

  // ====== 双签审批：该地方主管 + 账房先生 都签字才放行 ======
  // 任一方可驳回（整单驳回）。没有账房先生时，主管单签即可放行（避免死锁）。
  if (action === 'approvePurchase' || action === 'rejectPurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'pending') return { success: false, msg: '该单不在待审批状态' }

    const roles = await getRoles()
    const treasurer = await getTreasurer()
    const isSupHere = coversSite(roleScope(roles.supervisors, openid), p.siteId)
    const isTrea = !!(treasurer && treasurer.openid === openid)
    if (!isSupHere && !isTrea) return { success: false, msg: '你不是该地方的主管或账房先生，无权审批' }
    const myName = data.operatorName || ''

    // 驳回：任一方都可驳回整单
    if (action === 'rejectPurchase') {
      await db.collection('purchases').doc(data.id).update({
        data: {
          status: 'rejected',
          approverName: myName, approverOpenid: openid,
          rejectReason: data.reason || '',
          log: _.push([logEntry(myName, openid, `驳回：${data.reason || '未填原因'}`)])
        }
      })
      return { success: true }
    }

    // 通过：给自己持有且尚未签的角色签字。
    // 注意：签名存「标量」（名字字符串 + 时间），不要存嵌套对象——
    // 微信数据库不允许把值为 null 的字段 update 成带子字段的对象，会报
    // "Cannot create field 'xxx' in element {field: null}"。标量写入 null 字段是允许的。
    const patch = {}
    let signed = false
    if (isSupHere && !p.supApproved) { patch.supApproved = myName || true; patch.supApprovedAt = new Date(); signed = true }
    if (isTrea && !p.treaApproved) { patch.treaApproved = myName || true; patch.treaApprovedAt = new Date(); signed = true }
    if (!signed) return { success: false, msg: '你已签过字，正在等待另一方签字' }

    const supDone = !!(patch.supApproved || p.supApproved)
    const noTreasurer = !treasurer || !treasurer.openid
    const treaDone = noTreasurer ? true : !!(patch.treaApproved || p.treaApproved)

    if (supDone && treaDone) {
      patch.status = 'open'
      patch.approverName = myName; patch.approverOpenid = openid; patch.approvedAt = new Date()
      patch.log = _.push([logEntry(myName, openid, noTreasurer ? '主管签字通过（暂无账房先生），进入待领取' : '双签通过（主管 + 账房先生），进入待领取')])
      await db.collection('purchases').doc(data.id).update({ data: patch })
      return { success: true, done: true }
    } else {
      const waiting = !supDone ? '待该地方主管签字' : '待账房先生签字'
      patch.log = _.push([logEntry(myName, openid, `已签字，${waiting}`)])
      await db.collection('purchases').doc(data.id).update({ data: patch })
      return { success: true, done: false, waiting }
    }
  }

  // 被驳回 → 改单重提（仅发起人）。可顺带更新物品/标题/原因/预算/地方
  if (action === 'resubmitPurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.initiatorOpenid !== openid) return { success: false, msg: '只有发起人能重新提交' }
    if (p.status !== 'rejected') return { success: false, msg: '只有被驳回的单能重新提交' }
    const patch = {
      status: 'pending',
      rejectReason: '',
      supApproved: null, treaApproved: null,
      log: _.push([logEntry(p.initiatorName, openid, '修改后重新提交')])
    }
    if (Array.isArray(data.items)) {
      patch.items = data.items.filter(it => it && it.name).map(it => ({
        name: String(it.name).trim(), spec: it.spec || '', qty: Number(it.qty) || 0
      }))
    }
    if (typeof data.title === 'string') patch.title = data.title
    if (typeof data.reason === 'string') patch.reason = data.reason
    if (data.budget !== undefined) patch.budget = Number(data.budget) || 0
    if (data.siteId) patch.siteId = String(data.siteId).trim()
    if (data.purchaseKind) patch.purchaseKind = data.purchaseKind === 'food' ? 'food' : 'general'
    await db.collection('purchases').doc(data.id).update({ data: patch })
    return { success: true }
  }

  // ====== 营员认领（待领取 → 采购中）======
  if (action === 'claimPurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'open') return { success: false, msg: '该单不在待领取状态' }
    const myName = data.operatorName || ''
    await db.collection('purchases').doc(data.id).update({
      data: {
        status: 'buying',
        buyerName: myName, buyerOpenid: openid, claimedAt: new Date(),
        log: _.push([logEntry(myName, openid, '认领采购任务')])
      }
    })
    return { success: true }
  }

  // ====== 采购人报账（采购中 → 待核验）======
  if (action === 'submitReceipts') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'buying') return { success: false, msg: '该单不在采购中状态' }
    if (p.buyerOpenid !== openid) return { success: false, msg: '只有领取这单的人能报账' }
    const receipts = data.receipts || []
    if (receipts.length === 0) return { success: false, msg: '请至少上传一张付款凭证' }
    await db.collection('purchases').doc(data.id).update({
      data: {
        status: 'checking',
        receipts,
        actualAmount: Number(data.actualAmount) || 0,
        submittedAt: new Date(),
        log: _.push([logEntry(p.buyerName, openid, `提交报账，实付 ¥${Number(data.actualAmount) || 0}`)])
      }
    })
    return { success: true }
  }

  // ====== 库管核验（待核验 → 待入库 / 退回采购中；按该单所属地方校验）======
  if (action === 'verifyPurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'checking') return { success: false, msg: '该单不在待核验状态' }

    const roles = await getRoles()
    if (!coversSite(roleScope(roles.keepers, openid), p.siteId)) {
      return { success: false, msg: '你不是该地方的库管，无权核验' }
    }
    const myName = data.operatorName || ''

    if (data.pass) {
      await db.collection('purchases').doc(data.id).update({
        data: {
          status: 'verified',
          checkerName: myName, checkerOpenid: openid, checkedAt: new Date(),
          log: _.push([logEntry(myName, openid, '核验通过，待入库')])
        }
      })
    } else {
      await db.collection('purchases').doc(data.id).update({
        data: {
          status: 'buying',
          log: _.push([logEntry(myName, openid, `核验不通过退回：${data.reason || '未填原因'}`)])
        }
      })
    }
    return { success: true }
  }

  // ====== 库管确认入库（待入库 → 已入库；按该单所属地方校验，且强制入到发起时定的地方）======
  // data.items: [{ name, spec, receivedQty, category?, icon? }]，data.storeId: 入哪个分库
  if (action === 'confirmStockIn') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'verified') return { success: false, msg: '该单不在待入库状态' }

    const roles = await getRoles()
    if (!coversSite(roleScope(roles.keepers, openid), p.siteId)) {
      return { success: false, msg: '你不是该地方的库管，无权入库' }
    }
    // 入库地方锁定为发起时声明的地方，不允许转投别处
    if (data.siteId && data.siteId !== p.siteId) {
      return { success: false, msg: '该单只能入到发起时指定的地方' }
    }
    const siteId = p.siteId
    const myName = data.operatorName || p.checkerName || ''
    const confirmItems = (data.items || []).filter(it => it && it.name)
    if (confirmItems.length === 0) return { success: false, msg: '没有可入库的物品' }

    for (const it of confirmItems) {
      await stockInItem(it, myName, openid, siteId, data.storeId)
    }

    await db.collection('purchases').doc(data.id).update({
      data: {
        status: 'done',
        items: confirmItems.map(it => ({
          name: String(it.name).trim(),
          spec: it.spec || '',
          qty: Number(it.qty) || 0,
          receivedQty: Number(it.receivedQty) || 0
        })),
        stockedAt: new Date(),
        ledgerStatus: 'pending_record',
        log: _.push([logEntry(myName, openid, '确认入库，库存已更新；待账房先生记账')])
      }
    })
    return { success: true, suggestAmount: p.actualAmount || 0 }
  }

  // ====== 账房先生记账（待记账 → 已记账；全局，不分地方）======
  if (action === 'recordLedger') {
    const treasurer = await getTreasurer()
    if (!treasurer || !treasurer.openid) return { success: false, msg: '尚未指定账房先生' }
    if (treasurer.openid !== openid) return { success: false, msg: `只有账房先生「${treasurer.name}」能记账` }
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.status !== 'done' || p.ledgerStatus !== 'pending_record') return { success: false, msg: '该单无需记账或已记账' }

    const amount = Number(data.amount) || p.actualAmount || 0
    const noteTitle = p.title || (p.items && p.items[0] && p.items[0].name) || '采购'

    if (data.mode === 'expense') {
      const txn = await db.collection('transactions').add({
        data: {
          type: 'out', amount, note: `采购支出：${noteTitle}（采购人 ${p.buyerName || ''}）`,
          operatorName: treasurer.name, openid,
          payerName: p.buyerName || '', payerOpenid: p.buyerOpenid || '',
          screenshots: p.receipts || [],
          purchaseId: p._id,
          kind: 'purchase_expense',
          createdAt: new Date()
        }
      })
      await db.collection('logs').add({
        data: { type: 'money_out', note: `采购支出：${noteTitle}`, amount, operatorName: treasurer.name, openid, createdAt: new Date() }
      })
      await db.collection('purchases').doc(data.id).update({
        data: {
          ledgerStatus: 'recorded', ledgerTxnId: txn._id, ledgerNote: 'expense',
          log: _.push([logEntry(treasurer.name, openid, `记为金库支出 ¥${amount}`)])
        }
      })
      return { success: true }
    }

    if (data.mode === 'donation') {
      await db.collection('purchases').doc(data.id).update({
        data: {
          ledgerStatus: 'recorded', ledgerTxnId: '', ledgerNote: 'donation',
          log: _.push([logEntry(treasurer.name, openid, `记为营员捐赠（不报销），采购人 ${p.buyerName || ''}`)])
        }
      })
      return { success: true }
    }

    return { success: false, msg: '未知记账方式' }
  }

  // 删除采购单（仅发起人，且仅在待审批/已驳回时）
  // 删除：报账前（submittedAt 为空）都能删；发起人或该地方主管。报账后锁死（那之后才动钱/库存）
  if (action === 'deletePurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.submittedAt) return { success: false, msg: '已报账的采购单不能删除' }
    const roles = await getRoles()
    const isInitiator = p.initiatorOpenid === openid
    const isSupHere = coversSite(roleScope(roles.supervisors, openid), p.siteId)
    if (!isInitiator && !isSupHere) return { success: false, msg: '只有发起人或该地方主管能删除' }
    await db.collection('purchases').doc(data.id).remove()
    return { success: true }
  }

  // 修改：报账前都能改。改已审批/已认领的会「打回重审」——清审批+清认领，状态回到待审批。报账后锁死
  if (action === 'editPurchase') {
    const p = (await db.collection('purchases').doc(data.id).get()).data
    if (!p) return { success: false, msg: '采购单不存在' }
    if (p.submittedAt) return { success: false, msg: '已报账的采购单不能修改' }
    const roles = await getRoles()
    const isInitiator = p.initiatorOpenid === openid
    const isSupHere = coversSite(roleScope(roles.supervisors, openid), p.siteId)
    if (!isInitiator && !isSupHere) return { success: false, msg: '只有发起人或该地方主管能修改' }

    const rawItems = (data.items || []).filter(it => it && it.name)
    if (rawItems.length === 0) return { success: false, msg: '至少填写一项物品' }
    const items = rawItems.map(it => ({ name: String(it.name).trim(), spec: it.spec || '', qty: Number(it.qty) || 0 }))
    const wasOpenOrLater = (p.status !== 'pending' && p.status !== 'rejected')  // 已审批/已认领 → 真正的"打回重审"
    const patch = {
      items,
      title: data.title || '',
      reason: data.reason || '',
      budget: Number(data.budget) || 0,
      // 一律回到待审批：清双签、清审批人、清驳回原因、清认领
      status: 'pending',
      supApproved: null, treaApproved: null,
      approverName: '', approverOpenid: '', approvedAt: null, rejectReason: '',
      buyerName: '', buyerOpenid: '', claimedAt: null,
      log: (p.log || []).concat([logEntry(data.operatorName || '', openid, wasOpenOrLater ? '修改采购单（已审批，打回重审）' : '修改采购单')])
    }
    if (data.siteId) patch.siteId = String(data.siteId).trim()
    if (data.purchaseKind) patch.purchaseKind = data.purchaseKind === 'food' ? 'food' : 'general'
    await db.collection('purchases').doc(data.id).update({ data: patch })
    return { success: true, bounced: wasOpenOrLater }
  }

  return { success: false, msg: 'unknown action' }
}