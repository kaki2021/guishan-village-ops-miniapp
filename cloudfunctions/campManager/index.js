// cloudfunctions/campManager/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function fmtBJ(d) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000)
  const Y = t.getUTCFullYear()
  const M = String(t.getUTCMonth() + 1).padStart(2, '0')
  const D = String(t.getUTCDate()).padStart(2, '0')
  const h = String(t.getUTCHours()).padStart(2, '0')
  const m = String(t.getUTCMinutes()).padStart(2, '0')
  return `${Y}-${M}-${D} ${h}:${m}`
}

// 附件元素 → fileID。兼容两种：图片是纯字符串 fileID；文件是对象 {fileID,name,type:'file'}
function fileIdOf(s) {
  if (!s) return ''
  return typeof s === 'string' ? s : (s.fileID || '')
}

// 取当前账房先生 config，没有则返回 null
async function getTreasurerConfig() {
  try { await db.createCollection('config') } catch(e) {}
  const res = await db.collection('config').where({ key: 'treasurer' }).limit(1).get()
  if (res.data.length === 0) return null
  return res.data[0]
}

// 统一的记账权限校验：返回 null 表示通过，否则返回应直接 return 的错误对象
function checkTreasurer(cfg, openid, verb) {
  if (!cfg || !cfg.value || !cfg.value.openid) {
    return { success: false, locked: true, msg: `尚未指定账房先生，金库已锁定。请先到金库流水页指定账房先生后再${verb}` }
  }
  if (cfg.value.openid !== openid) {
    return { success: false, msg: `只有账房先生「${cfg.value.name}」能${verb}流水` }
  }
  return null
}

// 按 openid 查营员真实姓名（垫付登记时用，比客户端传来的名字可信）
async function nameByOpenid(openid, fallback) {
  try {
    const r = await db.collection('members').where({ openid }).limit(1).get()
    if (r.data.length && r.data[0].name) return r.data[0].name
  } catch (e) {}
  return fallback || ''
}

// 计算待报销总额（status=pending 的垫付金额之和）—— 聚合求和，不截断
async function pendingReimburseSum() {
  try { await db.createCollection('reimbursements') } catch (e) {}
  const $ = db.command.aggregate
  const r = await db.collection('reimbursements').aggregate()
    .match({ status: 'pending' })
    .group({ _id: null, total: $.sum('$amount') })
    .end()
  return (r.list && r.list[0] && r.list[0].total) || 0
}

// 分页全量取垫付记录（待报销队列、个人记录绝不能因上限丢单）
async function getAllReimb(where, orderField, orderDir) {
  const PAGE = 1000
  let all = [], skip = 0
  while (true) {
    const r = await db.collection('reimbursements')
      .where(where).orderBy(orderField, orderDir).skip(skip).limit(PAGE).get()
    all = all.concat(r.data)
    if (r.data.length < PAGE) break
    skip += PAGE
  }
  return all
}


// 分页全量取任意集合（导出账目绝不能被 1000 条上限截断）
async function getAllDocs(collection, where, orderField, orderDir) {
  const PAGE = 1000
  let all = [], skip = 0
  while (true) {
    let q = db.collection(collection)
    if (where && Object.keys(where).length) q = q.where(where)
    if (orderField) q = q.orderBy(orderField, orderDir || 'asc')
    const r = await q.skip(skip).limit(PAGE).get()
    all = all.concat(r.data)
    if (r.data.length < PAGE) break
    skip += PAGE
  }
  return all
}

function num(v) { return Number(v) || 0 }

function expenseCategory(text, purchaseKind) {
  if (purchaseKind === 'food') return '食材'
  const t = String(text || '')
  const rules = [
    ['建材', /水泥|石子|砂石|河沙|沙子|砖|瓦|钢管|方管|木板|板材|石膏|腻子|油漆|涂料|防水|砂浆|建材|螺丝|五金/],
    ['家具软装', /地毯|窗帘|床垫|床架|桌子|桌椅|椅子|柜子|置物架|被子|枕头|床品|帐篷|软装/],
    ['设备工具', /工具|电钻|切割机|角磨机|梯子|水泵|气泵|电器|设备|插座|电线|灯具|摄像头|投影|音响/],
    ['日用品', /纸巾|垃圾袋|洗衣液|洗洁精|清洁|拖把|扫把|盆|桶|牙刷|牙膏|毛巾|日用品/],
    ['维修', /维修|修理|安装|人工费|工费|换锁|水管|管道|疏通/],
    ['交通', /车费|打车|滴滴|油费|汽油|柴油|过路费|高速费|停车费|运输|运费|物流|快递/],
    ['宣传', /广告|海报|打印|喷绘|招牌|宣传|物料制作|名片|二维码/],
    ['水电燃气', /电费|水费|燃气|煤气|柴火/],
    ['服务费', /服务费|手续费|平台费|佣金|咨询费|设计费/]
  ]
  for (const [name, re] of rules) if (re.test(t)) return name
  return purchaseKind === 'general' ? '物资' : '其他'
}

function purchaseItemsText(p) {
  const arr = (p.items || []).map(it => {
    const n = it.name || ''
    const spec = it.spec ? ` ${it.spec}` : ''
    const qty = num(it.receivedQty || it.qty)
    return `${n}${spec}${qty ? ` ×${qty}` : ''}`.trim()
  }).filter(Boolean)
  return arr.join('；') || p.title || ''
}

function isNonExpenseOutTxn(t) {
  const kind = String(t.kind || '')
  if (['contribution_reverse', 'loan_repay', 'loan_repayment', 'debt_repay', 'borrowing_repay'].includes(kind)) return true
  const note = String(t.note || '')
  // 还借款是在清偿此前已经计入项目费用的消费欠款，不是新的消费；避免重复计入“项目总花费”
  if (/归还借款|偿还借款|借款还款|还借款/.test(note)) return true
  return false
}

function styleHeader(row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7A5E' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
}

function addSummaryLine(ws, label, value, note) {
  const row = ws.addRow([label, value, note || ''])
  row.getCell(1).font = { bold: true }
  row.getCell(2).font = { bold: true }
  row.getCell(2).numFmt = '0.00'
  return row
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'getLogs') {
    const logs = await db.collection('logs').orderBy('createdAt', 'desc').limit(20).get()
    return { success: true, list: logs.data }
  }

  if (action === 'getStats') {
    // 余额必须对【全部】流水求和，不能只取最近 N 条（否则一旦流水超过上限，余额就失真）
    const $ = db.command.aggregate
    const sumAmount = async (type) => {
      const r = await db.collection('transactions').aggregate()
        .match({ type })
        .group({ _id: null, total: $.sum('$amount') })
        .end()
      return (r.list && r.list[0] && r.list[0].total) || 0
    }
    const totalIn = await sumAmount('in')
    const totalOut = await sumAmount('out')
    const balance = totalIn - totalOut

    const tasks = await db.collection('tasks').where({ status: 'doing' }).count()
    const resources = await db.collection('resources').count()
    // totalXp 同理：聚合全部 done 任务，不再 .get() 截断在 100 条
    const xpAgg = await db.collection('tasks').aggregate()
      .match({ status: 'done' })
      .group({ _id: null, total: $.sum('$xp') })
      .end()
    const totalXp = (xpAgg.list && xpAgg.list[0] && xpAgg.list[0].total) || 0

    // 待报销总额：已花未还。可用资金 = balance - pendingReimburse
    const pendingReimburse = await pendingReimburseSum()
    return { success: true, balance, totalIn, totalOut, doingTasks: tasks.total, resourceCount: resources.total, totalXp, pendingReimburse }
  }

  if (action === 'addTransaction') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '记账')
    if (err) return err

    const operatorName = data.operatorName || (cfg.value && cfg.value.name) || '账房先生'
    const screenshots = data.screenshots || []   // 可含字符串(图片)与对象(文件)
    // payerName/payerOpenid：真正花钱的人。手记不填则默认＝记账人（账房），保证字段不空、可被"按花钱人筛"
    const payerName = data.payerName || operatorName
    const payerOpenid = data.payerOpenid || openid
    await db.collection('transactions').add({
      data: { type: data.type, amount: data.amount, note: data.note || '', operatorName, openid, payerName, payerOpenid, screenshots, kind: data.kind || 'manual', createdAt: new Date() }
    })
    await db.collection('logs').add({
      data: { type: data.type === 'in' ? 'money_in' : 'money_out', note: data.note || '', amount: data.amount, operatorName, openid, createdAt: new Date() }
    })
    return { success: true }
  }

  // 服务端把 cloud:// 文件ID 批量换成 https 临时链接（比客户端 getTempFileURL 可靠）
  if (action === 'getFileUrls') {
    const fileList = (data && data.fileList) || []
    const ids = [...new Set(fileList.filter(x => typeof x === 'string' && x.indexOf('cloud://') === 0))]
    const urls = {}
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      try {
        const r = await cloud.getTempFileURL({ fileList: batch })
        ;(r.fileList || []).forEach(f => { if (f.fileID && f.tempFileURL) urls[f.fileID] = f.tempFileURL })
      } catch (e) { console.error('getTempFileURL 失败', e) }
    }
    return { success: true, urls }
  }

  if (action === 'getTransactions') {
    // 列表只展示最近 200 条（汇总走 getLedgerSummary 聚合，不靠列表求和，所以列表条数不影响数字准确性）
    const result = await db.collection('transactions').orderBy('createdAt', 'desc').limit(200).get()
    return { success: true, list: result.data }
  }

  // 流水汇总：服务端按筛选条件聚合 收入/支出/净额，不受列表上限影响，流水再多也准
  if (action === 'getLedgerSummary') {
    const $ = db.command.aggregate
    const match = {}
    if (data.typeFilter && data.typeFilter !== 'all') match.type = data.typeFilter
    if (data.startTs && data.endTs) {
      match.createdAt = _.gte(new Date(data.startTs)).and(_.lte(new Date(data.endTs)))
    }
    let agg = db.collection('transactions').aggregate().match(match)
    // 按"有效花钱人"筛：payerName 取不到就回退记账人，与列表展示口径一致
    if (data.personFilter && data.personFilter !== 'all') {
      agg = agg.addFields({
        _payer: $.cond({
          if: $.or([$.eq(['$payerName', null]), $.eq(['$payerName', ''])]),
          then: '$operatorName',
          else: '$payerName'
        })
      }).match({ _payer: data.personFilter })
    }
    const res = await agg.group({ _id: '$type', total: $.sum('$amount'), count: $.sum(1) }).end()
    let inSum = 0, outSum = 0, count = 0
    for (const g of (res.list || [])) {
      if (g._id === 'in') inSum = g.total
      else if (g._id === 'out') outSum = g.total
      count += g.count
    }
    return { success: true, inSum, outSum, net: inSum - outSum, count }
  }

  if (action === 'editTransaction') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '编辑')
    if (err) return err

    const newShots = data.screenshots || []
    const oldDoc = await db.collection('transactions').doc(data.id).get()
    const oldShots = (oldDoc.data && oldDoc.data.screenshots) || []
    const newIds = newShots.map(fileIdOf).filter(Boolean)
    const removed = oldShots.map(fileIdOf).filter(id => id && newIds.indexOf(id) < 0)
    if (removed.length > 0) {
      try { await cloud.deleteFile({ fileList: removed }) } catch (e) { console.error('删除旧附件失败', e) }
    }
    await db.collection('transactions').doc(data.id).update({
      data: { type: data.type, amount: data.amount, note: data.note || '', screenshots: newShots }
    })
    return { success: true }
  }

  if (action === 'deleteTransaction') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '删除')
    if (err) return err

    const doc = await db.collection('transactions').doc(data.id).get()
    const fileIDs = ((doc.data && doc.data.screenshots) || []).map(fileIdOf).filter(Boolean)
    if (fileIDs.length > 0) {
      try { await cloud.deleteFile({ fileList: fileIDs }) } catch (e) { console.error('删除附件失败', e) }
    }
    await db.collection('transactions').doc(data.id).remove()
    return { success: true }
  }

  if (action === 'getTreasurer') {
    const cfg = await getTreasurerConfig()
    if (!cfg || !cfg.value) return { success: true, treasurer: null, isMe: false }
    return { success: true, treasurer: cfg.value, isMe: cfg.value.openid === openid }
  }

  if (action === 'setTreasurer') {
    const { targetOpenid, targetName } = data
    if (!targetOpenid || !targetName) return { success: false, msg: '目标信息不完整' }
    const member = await db.collection('members').where({ openid: targetOpenid }).limit(1).get()
    if (member.data.length === 0) return { success: false, msg: '目标营员未绑定身份' }

    const cfg = await getTreasurerConfig()
    if (cfg && cfg.value && cfg.value.openid) {
      if (cfg.value.openid !== openid) {
        return { success: false, msg: `只有当前账房先生「${cfg.value.name}」能转交` }
      }
    }
    const newValue = { openid: targetOpenid, name: targetName, setAt: new Date(), setBy: openid }
    if (cfg) {
      await db.collection('config').doc(cfg._id).update({ data: { value: newValue } })
    } else {
      try { await db.createCollection('config') } catch(e) {}
      await db.collection('config').add({ data: { key: 'treasurer', value: newValue } })
    }
    return { success: true, treasurer: newValue }
  }

  // ====== 垫付 / 报销（自由垫付，不走采购单；全局，不分地方）======
  // 流程：营员自报垫付(submitReimbursement) → 待报销 → 账房报销/驳回/记捐赠(reimburse)
  // 关键：报销那一刻才动金库，待报销不影响余额。乱报的单子挂着碰不到金库。

  // 营员自报：任何已绑定身份的营员都能登记自己垫付的钱（金额+用途+垫付凭证图）
  if (action === 'submitReimbursement') {
    try { await db.createCollection('reimbursements') } catch (e) {}
    const amount = Number(data.amount) || 0
    if (!(amount > 0)) return { success: false, msg: '金额要大于 0' }
    const applicantName = await nameByOpenid(openid, data.applicantName || '')
    if (!applicantName) return { success: false, msg: '请先加入村落、绑定身份后再登记垫付' }
    const receipts = data.receipts || []   // 兼容图片(字符串)与文件(对象)，与 transactions.screenshots 同形
    const r = await db.collection('reimbursements').add({
      data: {
        applicantName, applicantOpenid: openid,
        amount, note: data.note || '',
        receipts,
        status: 'pending',            // pending / reimbursed / rejected / donated
        rejectReason: '',
        txnId: '',
        operatorName: '',             // 处理它的账房
        createdAt: new Date(),
        decidedAt: null
      }
    })
    return { success: true, id: r._id }
  }

  // 取垫付列表：账房返回 pending(全员待报) + history(近期已决) + mine(自己的)；普通营员只返回 mine
  if (action === 'getReimbursements') {
    try { await db.createCollection('reimbursements') } catch (e) {}
    const cfg = await getTreasurerConfig()
    const isTreasurer = !!(cfg && cfg.value && cfg.value.openid === openid)

    // 个人记录：分页全量，不漏自己任何一笔
    const mine = await getAllReimb({ applicantOpenid: openid }, 'createdAt', 'desc')

    if (!isTreasurer) {
      return { success: true, isTreasurer: false, pending: [], history: [], mine, pendingTotal: 0 }
    }

    // 待报销队列：分页全量。漏一笔就是有人垫了钱拿不回来，绝不能截断
    const pending = await getAllReimb({ status: 'pending' }, 'createdAt', 'asc')
    // 已处理：这是"近期"回顾视图（供撤销报销），保留最近 200 条即可；记录本身不会从库里丢
    const history = (await db.collection('reimbursements')
      .where({ status: _.neq('pending') })
      .orderBy('decidedAt', 'desc').limit(200).get()).data
    const pendingTotal = pending.reduce((s, x) => s + (Number(x.amount) || 0), 0)
    // 按垫付人分组，供账房一次性结算某人的多笔
    const gmap = {}
    for (const p of pending) {
      const k = p.applicantOpenid || p.applicantName || '?'
      if (!gmap[k]) gmap[k] = { applicantOpenid: p.applicantOpenid || '', applicantName: p.applicantName || '未知', items: [], total: 0 }
      gmap[k].items.push(p)
      gmap[k].total += Number(p.amount) || 0
    }
    const pendingGroups = Object.keys(gmap).map(k => {
      const g = gmap[k]
      return { applicantOpenid: g.applicantOpenid, applicantName: g.applicantName, items: g.items, count: g.items.length, total: g.total }
    }).sort((a, b) => b.total - a.total)
    return { success: true, isTreasurer: true, pending, pendingGroups, history, mine, pendingTotal }
  }

  // 账房处理垫付：pay=报销(扣金库+写流水) / reject=驳回(填原因) / donation=垫了不报(记捐赠,不动钱)
  if (action === 'reimburse') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '报销')
    if (err) return err
    try { await db.createCollection('reimbursements') } catch (e) {}

    const doc = (await db.collection('reimbursements').doc(data.id).get()).data
    if (!doc) return { success: false, msg: '垫付记录不存在' }
    if (doc.status !== 'pending') return { success: false, msg: '该垫付已处理' }

    const treasurerName = (cfg.value && cfg.value.name) || '账房先生'
    const amount = Number(doc.amount) || 0
    const who = doc.applicantName || ''

    if (data.mode === 'pay') {
      // 账房还款凭证（账房→垫付人转账截图等）。与垫付人原始凭证一并归档进流水
      const payShots = data.payShots || []
      const allShots = (doc.receipts || []).concat(payShots)
      const settlementId = 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const txn = await db.collection('transactions').add({
        data: {
          type: 'out', amount,
          note: `报销垫付：${doc.note || '（无说明）'}（垫付人 ${who}）`,
          operatorName: treasurerName, openid,
          payerName: who, payerOpenid: doc.applicantOpenid || '',
          screenshots: allShots,
          settlementId,
          reimbId: doc._id,
          kind: 'reimbursement',
          createdAt: new Date()
        }
      })
      await db.collection('logs').add({
        data: { type: 'money_out', note: `报销垫付：${doc.note || ''}（垫付人 ${who}）`, amount, operatorName: treasurerName, openid, createdAt: new Date() }
      })
      await db.collection('reimbursements').doc(data.id).update({
        data: { status: 'reimbursed', txnId: txn._id, settlementId, operatorName: treasurerName, decidedAt: new Date(), paybackReceipts: payShots }
      })
      return { success: true }
    }

    if (data.mode === 'reject') {
      await db.collection('reimbursements').doc(data.id).update({
        data: { status: 'rejected', rejectReason: data.rejectReason || '', operatorName: treasurerName, decidedAt: new Date() }
      })
      return { success: true }
    }

    if (data.mode === 'donation') {
      await db.collection('reimbursements').doc(data.id).update({
        data: { status: 'donated', operatorName: treasurerName, decidedAt: new Date() }
      })
      return { success: true }
    }

    return { success: false, msg: '未知处理方式' }
  }

  // 批量结算：一次转账结清同一垫付人的多笔垫付。金库只记一笔，盖同一 settlementId
  if (action === 'reimburseBatch') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '报销')
    if (err) return err
    try { await db.createCollection('reimbursements') } catch (e) {}

    const ids = Array.isArray(data.ids) ? data.ids : []
    if (ids.length === 0) return { success: false, msg: '没有选中要结算的垫付' }
    const treasurerName = (cfg.value && cfg.value.name) || '账房先生'

    // 逐笔重新校验：存在、仍 pending（非 pending 静默跳过，防双击/已被结算的重复支付）
    const docs = []
    for (const id of ids) {
      const d = (await db.collection('reimbursements').doc(id).get()).data
      if (d && d.status === 'pending') docs.push(d)
    }
    if (docs.length === 0) return { success: false, msg: '选中的垫付都已被处理，请刷新' }

    // 必须同一垫付人（一次转账只结一个人）
    const applicantOpenid = docs[0].applicantOpenid || ''
    const applicantName = docs[0].applicantName || ''
    for (const d of docs) {
      if ((d.applicantOpenid || '') !== applicantOpenid) {
        return { success: false, msg: '一次只能结算同一个垫付人的垫付' }
      }
    }

    const total = docs.reduce((s, d) => s + (Number(d.amount) || 0), 0)
    const payShots = data.payShots || []
    const settlementId = 'st-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const noteCore = `${applicantName} ${docs.length}笔`

    // 【2026-07 改】一笔垫付记一条流水（谁买了什么直观可见、导出 Excel 即明细），
    // 同批次盖同一 settlementId 串起来（对应现实中的一次转账）。
    // 还款凭证只挂到首条流水：deleteTransaction 删流水会连带清附件文件，
    // 若挂到每条，手动删其中一条会把共享的还款凭证文件删掉、其余各条引用全断。
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i]
      const shots = (d.receipts || []).concat(i === 0 ? payShots : [])
      const txn = await db.collection('transactions').add({
        data: {
          type: 'out', amount: Number(d.amount) || 0,
          note: `报销垫付：${d.note || '（无说明）'}（垫付人 ${applicantName}）`,
          operatorName: treasurerName, openid,
          payerName: applicantName, payerOpenid: applicantOpenid,
          screenshots: shots,
          settlementId,
          reimbId: d._id,
          kind: 'reimbursement',
          createdAt: new Date()
        }
      })
      // 每笔各自回填自己的 txnId（撤销时按 settlementId 收集全部流水一起删）
      await db.collection('reimbursements').doc(d._id).update({
        data: { status: 'reimbursed', txnId: txn._id, settlementId, operatorName: treasurerName, decidedAt: new Date(), paybackReceipts: payShots }
      })
    }
    // 动态日志仍记一条汇总（26 条会刷屏，动态看总账、流水看明细）
    await db.collection('logs').add({
      data: { type: 'money_out', note: `报销垫付：${noteCore}`, amount: total, operatorName: treasurerName, openid, createdAt: new Date() }
    })
    return { success: true, settled: docs.length, skipped: ids.length - docs.length, total }
  }

  // 垫付人撤回：仅本人、仅 pending 时可撤；连同上传的凭证一并删除
  if (action === 'cancelReimbursement') {
    try { await db.createCollection('reimbursements') } catch (e) {}
    const doc = (await db.collection('reimbursements').doc(data.id).get()).data
    if (!doc) return { success: false, msg: '垫付记录不存在' }
    if (doc.applicantOpenid !== openid) return { success: false, msg: '只能撤回自己登记的垫付' }
    if (doc.status !== 'pending') return { success: false, msg: '已被账房处理，不能撤回' }
    const fileIDs = (doc.receipts || []).map(fileIdOf).filter(Boolean)
    if (fileIDs.length > 0) {
      try { await cloud.deleteFile({ fileList: fileIDs }) } catch (e) { console.error('删除垫付凭证失败', e) }
    }
    await db.collection('reimbursements').doc(data.id).remove()
    return { success: true }
  }

  // 账房撤销报销（报错了用）：同一次结算的多笔一起撤——删那一笔金库支出(钱回金库)、各笔退回 pending。
  // 老的单笔记录没有 settlementId，就只撤它自己。垫付人原始凭证不动，只作废还款凭证。
  if (action === 'revokeReimbursement') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '撤销报销')
    if (err) return err
    try { await db.createCollection('reimbursements') } catch (e) {}

    const doc = (await db.collection('reimbursements').doc(data.id).get()).data
    if (!doc) return { success: false, msg: '垫付记录不存在' }
    if (doc.status !== 'reimbursed' || !doc.txnId) return { success: false, msg: '该垫付未处于已报销状态' }

    // 同一次结算的所有垫付一起撤（一次转账整进整出，不留半拉子账）
    let docs
    if (doc.settlementId) {
      docs = (await db.collection('reimbursements').where({ settlementId: doc.settlementId, status: 'reimbursed' }).limit(1000).get()).data
    } else {
      docs = [doc]
    }

    // 删本批次的金库支出（钱回金库）。
    // 新记法：每笔垫付各有一条流水（txnId 各不同）；老记法：整批共享一条。按 txnId 去重后逐条删，两者都对。
    const txnSet = {}
    for (const d of docs) { if (d.txnId) txnSet[d.txnId] = true }
    if (doc.txnId) txnSet[doc.txnId] = true
    for (const tid of Object.keys(txnSet)) {
      try { await db.collection('transactions').doc(tid).remove() } catch (e) { console.error('撤销报销删流水失败', tid, e) }
    }
    // 作废还款凭证文件（多笔共享同一批引用，去重后删一次）
    const paySet = {}
    for (const d of docs) for (const f of (d.paybackReceipts || [])) { const id = fileIdOf(f); if (id) paySet[id] = true }
    const payIDs = Object.keys(paySet)
    if (payIDs.length > 0) {
      try { await cloud.deleteFile({ fileList: payIDs }) } catch (e) { console.error('删除还款凭证失败', e) }
    }

    const total = docs.reduce((s, d) => s + (Number(d.amount) || 0), 0)
    const who = doc.applicantName || ''
    await db.collection('logs').add({
      data: { type: 'money_in', note: `撤销报销：${who} ${docs.length}笔`, amount: total, operatorName: (cfg.value && cfg.value.name) || '账房先生', openid, createdAt: new Date() }
    })
    for (const d of docs) {
      await db.collection('reimbursements').doc(d._id).update({
        data: { status: 'pending', txnId: '', settlementId: '', operatorName: '', decidedAt: null, paybackReceipts: [] }
      })
    }
    return { success: true, reverted: docs.length }
  }

  // ====== 一次性运维：旧"批量结算汇总流水"拆成一笔垫付一条明细流水（2026-07 拆分改造的历史数据迁移）======
  // 【可断点续跑】幂等粒度是"每笔垫付"而非"每个批次"：中途超时/被掐死都没关系，重跑自动接着补，
  // 直到批次内每笔都有自己的明细流水，才删那条旧汇总流水（删完余额即恢复正确）。
  // 每笔垫付的状态判定（看它 txnId 指向的流水）：
  //   带 migratedFrom 标记 → 这笔已迁移完成
  //   金额 ≈ 本笔垫付金额 → 新记法明细，本来就不用迁
  //   金额 ≈ 批次合计     → 还指着旧汇总，待迁移
  //   其他               → 异常，跳过并上报，不碰
  // 不带 data.confirm='SPLIT' 时只预览（含每批 已迁/待迁 笔数），不写任何数据。
  if (action === 'migrateSplitReimburseTxns') {
    const cfg = await getTreasurerConfig()
    const err = checkTreasurer(cfg, openid, '迁移')
    if (err) return err
    try { await db.createCollection('reimbursements') } catch (e) {}

    // 分页抓全量已报销
    let all = [], skip = 0
    while (true) {
      const r = await db.collection('reimbursements').where({ status: 'reimbursed' })
        .orderBy('decidedAt', 'asc').skip(skip).limit(1000).get()
      all = all.concat(r.data)
      if (r.data.length < 1000) break
      skip += 1000
    }
    // 按 settlementId 分组
    const groups = {}
    for (const d of all) {
      if (!d.settlementId || !d.txnId) continue
      ;(groups[d.settlementId] = groups[d.settlementId] || []).push(d)
    }

    // 流水按需取并缓存（同批次多笔共指旧汇总，只查一次）
    const txnCache = {}
    const getTxn = async (id) => {
      if (id in txnCache) return txnCache[id]
      let t = null
      try { t = (await db.collection('transactions').doc(id).get()).data } catch (e) {}
      txnCache[id] = t
      return t
    }

    const report = []
    let migratedCount = 0, doneGroups = 0, anomalies = 0
    for (const sid of Object.keys(groups)) {
      const docs = groups[sid]
      if (docs.length < 2) continue                                  // 单笔结算本来就是明细
      const groupSum = docs.reduce((s, d) => s + (Number(d.amount) || 0), 0)

      // 逐笔分类
      let aggTxn = null                                              // 本批次的旧汇总流水（若还在）
      const toMigrate = [], oddities = []
      let doneCnt = 0
      for (const d of docs) {
        const t = await getTxn(d.txnId)
        const dAmt = Number(d.amount) || 0
        if (!t) { oddities.push(`垫付${dAmt}元的流水不存在`); continue }
        const tAmt = Number(t.amount) || 0
        if (t.migratedFrom) { doneCnt++; continue }                  // 已迁移
        if (Math.abs(tAmt - dAmt) <= 0.005 && Math.abs(groupSum - dAmt) > 0.005) { doneCnt++; continue } // 新记法明细
        if (Math.abs(tAmt - groupSum) <= 0.005) {                    // 指着旧汇总 → 待迁移
          aggTxn = t; toMigrate.push(d); continue
        }
        oddities.push(`垫付${dAmt}元指向金额${tAmt}的流水，无法归类`)
      }

      if (oddities.length > 0) {
        anomalies++
        report.push({ sid, name: docs[0].applicantName, count: docs.length, msg: '存在异常，整批跳过：' + oddities.join('；') })
        continue
      }
      if (toMigrate.length === 0) { doneGroups++; continue }         // 整批已是明细，无事可做

      report.push({ sid, name: docs[0].applicantName, count: docs.length, total: groupSum.toFixed(2), done: doneCnt, remaining: toMigrate.length })
      if (data.confirm !== 'SPLIT') continue                         // 预览模式到此为止

      // 逐笔迁移：先查有没有已建好的明细（reimbId 匹配）——防上次死在"明细已建、指针没改"的缝里重复建
      const baseTs = aggTxn.createdAt ? new Date(aggTxn.createdAt).getTime() : Date.now()
      for (let i = 0; i < toMigrate.length; i++) {
        const d = toMigrate[i]
        let ntId = ''
        const exist = await db.collection('transactions').where({ reimbId: d._id }).limit(1).get()
        if (exist.data.length > 0) {
          ntId = exist.data[0]._id                                   // 已有明细，直接复用
        } else {
          // 还款凭证挂到本批第一条迁出的明细上（续跑时若已迁过就不再挂，避免重复引用）
          const payShots = (doneCnt === 0 && i === 0) ? (d.paybackReceipts || []) : []
          const shots = (d.receipts || []).concat(payShots)
          const nt = await db.collection('transactions').add({
            data: {
              type: 'out', amount: Number(d.amount) || 0,
              note: `报销垫付：${d.note || '（无说明）'}（垫付人 ${d.applicantName || ''}）`,
              operatorName: aggTxn.operatorName || '', openid: aggTxn.openid || '',
              payerName: aggTxn.payerName || d.applicantName || '', payerOpenid: aggTxn.payerOpenid || d.applicantOpenid || '',
              screenshots: shots,
              settlementId: sid,
              createdAt: new Date(baseTs + doneCnt + i),
              migratedFrom: aggTxn._id,                              // 审计留痕 + 已迁移标记
              reimbId: d._id                                         // 关联垫付记录，续跑防重复建
            }
          })
          ntId = nt._id
        }
        await db.collection('reimbursements').doc(d._id).update({ data: { txnId: ntId } })
        migratedCount++
      }
      // 清扫孤儿明细：带 migratedFrom 但没有任何垫付指向它的（上一版代码崩溃可能留下），删掉防虚增
      const refSet = {}
      for (const d of docs) refSet[d.txnId] = true                   // 注意 docs 里的 txnId 是查询时的旧值
      for (const d of toMigrate) refSet[d.txnId] = true              // 补上刚更新过的（内存里对象是同一批引用，但稳妥起见重查）
      const fresh = (await db.collection('reimbursements').where({ settlementId: sid, status: 'reimbursed' }).limit(1000).get()).data
      const freshRef = {}
      for (const f of fresh) if (f.txnId) freshRef[f.txnId] = true
      const migTxns = (await db.collection('transactions').where({ settlementId: sid, migratedFrom: _.exists(true) }).limit(1000).get()).data
      for (const mt of migTxns) {
        if (!freshRef[mt._id]) {
          try { await db.collection('transactions').doc(mt._id).remove() } catch (e) {}
          report.push({ sid, msg: `清除孤儿明细 ¥${(mt.amount || 0).toFixed(2)}` })
        }
      }
      // 整批每笔都有明细了，才删旧汇总（直接 remove、不清附件——文件已被明细和垫付记录引用）
      try { await db.collection('transactions').doc(aggTxn._id).remove() } catch (e) { console.error('删汇总流水失败', aggTxn._id, e) }
      doneGroups++
    }
    return {
      success: true,
      mode: data.confirm === 'SPLIT' ? '已执行' : '仅预览',
      migrated: migratedCount, doneGroups, anomalies, groups: report,
      hint: data.confirm === 'SPLIT' ? '若曾中途超时，重跑本命令即可续拆，直到 groups 为空' : ''
    }
  }

  // ====== 完整费用台账：费用发生与现金结算分开，避免报销/采购/转借款/还借款重复计算 ======
  if (action === 'exportFullLedger') {
    const { startDate, endDate } = data || {}
    const view = (data && data.view) || 'expenses'
    if (!startDate || !endDate) return { success: false, msg: '请选择导出时间范围' }
    const start = new Date(startDate + 'T00:00:00+08:00')
    const end = new Date(endDate + 'T23:59:59+08:00')
    if (!(start <= end)) return { success: false, msg: '时间范围不正确' }

    try { await db.createCollection('reimbursements') } catch (e) {}
    try { await db.createCollection('purchases') } catch (e) {}
    try { await db.createCollection('loans') } catch (e) {}

    // 费用按“发生日”筛；借款台账读取到 endDate 为止，用于计算截至结束日的已还/未还。
    const [allTxns, allReimbs, allPurchases, allLoans0] = await Promise.all([
      getAllDocs('transactions', { createdAt: _.gte(start).and(_.lte(end)) }, 'createdAt', 'asc'),
      getAllDocs('reimbursements', {}, 'createdAt', 'asc'),
      getAllDocs('purchases', {}, 'createdAt', 'asc'),
      getAllDocs('loans', {}, 'createdAt', 'asc')
    ])
    const allLoans = allLoans0.filter(l => l.createdAt && new Date(l.createdAt) <= end)

    const reimbById = {}
    const purchaseById = {}
    allReimbs.forEach(r => { reimbById[r._id] = r })
    allPurchases.forEach(p => { purchaseById[p._id] = p })

    // ===== 借款还款分摊 =====
    // 现有业务“还借款”只指定【人+金额】，没有指定偿还哪一笔原消费。
    // 为了让报表能展示每笔原消费当前剩余多少，这里按“转借款先后 FIFO”做【报表展示分摊】。
    // 总借款余额不受分摊方法影响；这个分摊不写回数据库、不改变真实账。
    const loanQueues = {}
    const loanSourceMap = {}
    const loanPositiveRows = []
    let loanBorrowedAll = 0
    let loanRepaidAll = 0

    const personKey = l => l.openid || ('name:' + (l.name || ''))
    for (const l of allLoans) {
      const amount = num(l.amount)
      const key = personKey(l)
      if (!loanQueues[key]) loanQueues[key] = []
      if (amount > 0) {
        const rec = {
          doc: l, original: amount, remaining: amount, repaid: 0,
          createdAt: new Date(l.createdAt)
        }
        loanQueues[key].push(rec)
        loanPositiveRows.push(rec)
        loanBorrowedAll += amount
        const sk = l.fromReimbId ? ('reimb:' + l.fromReimbId) : (l.fromPurchaseId ? ('purchase:' + l.fromPurchaseId) : '')
        if (sk) loanSourceMap[sk] = rec
      } else if (amount < 0) {
        let repay = -amount
        loanRepaidAll += repay
        const q = loanQueues[key]
        for (const rec of q) {
          if (!(repay > 0)) break
          if (rec.createdAt > new Date(l.createdAt)) continue
          if (!(rec.remaining > 0)) continue
          const take = Math.min(repay, rec.remaining)
          rec.remaining -= take
          rec.repaid += take
          repay -= take
        }
      }
    }
    const loanOutstandingAll = allLoans.reduce((s, l) => s + num(l.amount), 0)

    // 先建立“已经由业务单据认领”的流水 ID，后面扫描直接金库支出时跳过，防止重复。
    const linkedTxnIds = new Set()
    for (const r of allReimbs) if (r.txnId) linkedTxnIds.add(r.txnId)
    for (const p of allPurchases) if (p.ledgerTxnId) linkedTxnIds.add(p.ledgerTxnId)

    const rows = []
    const rejectedRows = []

    // 1) 自由垫付：以 reimbursements 为费用主记录；transactions 只代表“已经还了”
    for (const r of allReimbs) {
      const d = new Date(r.createdAt)
      if (!(d >= start && d <= end)) continue
      const amount = num(r.amount)
      if (!(amount > 0)) continue

      if (r.status === 'rejected') {
        rejectedRows.push({
          date: fmtBJ(d), source: '自由垫付', who: r.applicantName || '',
          amount, note: r.note || '', reason: r.rejectReason || '已驳回'
        })
        continue
      }

      let status = '待报销', settlement = '未结算', paid = 0, debt = amount
      let bucket = 'ordinaryDebt', debtType = '待报销', loanSource = false
      if (r.status === 'reimbursed') {
        status = '已报销'; settlement = '金库已报销'; paid = amount; debt = 0; bucket = 'paid'; debtType = ''
      } else if (r.status === 'donated') {
        status = '已记捐赠'; settlement = '个人捐赠'; debt = 0; bucket = 'donated'; debtType = ''
      } else if (r.status === 'converting') {
        status = '转借款审核中'; settlement = '待转长期借款'; debt = amount; bucket = 'converting'; debtType = '转借款审核中'
      } else if (r.status === 'converted') {
        loanSource = true
        const lm = loanSourceMap['reimb:' + r._id]
        const repaid = lm ? Math.min(amount, num(lm.repaid)) : 0
        paid = repaid
        debt = Math.max(0, amount - repaid)
        status = debt > 0 ? '已转长期借款（未结清）' : '已转长期借款（已还清）'
        settlement = '转长期借款'
        bucket = debt > 0 ? 'loanDebt' : 'paid'
        debtType = debt > 0 ? '长期借款' : ''
      }

      rows.push({
        eventDate: d, source: '自由垫付', site: '通用',
        category: expenseCategory(r.note, ''),
        title: r.note || '垫付',
        detail: r.note || '',
        who: r.applicantName || '',
        amount, status, paid, debt, debtType, settlement, bucket, loanSource,
        hasReceipt: (r.receipts && r.receipts.length) ? '有' : '',
        sourceId: r._id || '', txnId: r.txnId || ''
      })
    }

    // 2) 采购垫款：actualAmount > 0 且已提交报账，就代表消费真实发生。
    for (const p of allPurchases) {
      if (!p.submittedAt || !(num(p.actualAmount) > 0)) continue
      if (!['checking', 'verified', 'done'].includes(p.status)) continue
      const d = new Date(p.submittedAt || p.createdAt)
      if (!(d >= start && d <= end)) continue

      const amount = num(p.actualAmount)
      let status = '', settlement = '未结算', paid = 0, debt = amount
      let bucket = 'ordinaryDebt', debtType = '采购垫款', loanSource = false
      if (p.ledgerStatus === 'recorded') {
        if (p.ledgerNote === 'donation') {
          status = '已记捐赠'; settlement = '个人捐赠'; debt = 0; bucket = 'donated'; debtType = ''
        } else {
          status = '已记账'; settlement = '金库已支付'; paid = amount; debt = 0; bucket = 'paid'; debtType = ''
        }
      } else if (p.ledgerStatus === 'converting') {
        status = '转借款审核中'; settlement = '待转长期借款'; debt = amount; bucket = 'converting'; debtType = '转借款审核中'
      } else if (p.ledgerStatus === 'converted') {
        loanSource = true
        const lm = loanSourceMap['purchase:' + p._id]
        const repaid = lm ? Math.min(amount, num(lm.repaid)) : 0
        paid = repaid
        debt = Math.max(0, amount - repaid)
        status = debt > 0 ? '已转长期借款（未结清）' : '已转长期借款（已还清）'
        settlement = '转长期借款'
        bucket = debt > 0 ? 'loanDebt' : 'paid'
        debtType = debt > 0 ? '长期借款' : ''
      } else if (p.status === 'checking') {
        status = '待核验（已垫款）'
      } else if (p.status === 'verified') {
        status = '待入库（已垫款）'
      } else {
        status = '待记账'
      }

      const itemText = purchaseItemsText(p)
      const title = p.title || (p.items && p.items[0] && p.items[0].name) || '采购'
      rows.push({
        eventDate: d, source: '采购单', site: p.siteId || '',
        category: expenseCategory(`${title} ${itemText} ${p.reason || ''}`, p.purchaseKind),
        title, detail: itemText || p.reason || '',
        who: p.buyerName || '',
        amount, status, paid, debt, debtType, settlement, bucket, loanSource,
        hasReceipt: (p.receipts && p.receipts.length) ? '有' : '',
        sourceId: p._id || '', txnId: p.ledgerTxnId || ''
      })
    }

    // 3) 金库直接支出：只纳入没有被“报销单/采购单”认领的 out 流水。
    // loan_repay 是对已发生消费的偿债，只增加“已支付”，绝不能成为第二笔费用。
    for (const t of allTxns) {
      if (t.type !== 'out') continue
      if (linkedTxnIds.has(t._id)) continue
      if (isNonExpenseOutTxn(t)) continue
      const amount = num(t.amount)
      if (!(amount > 0)) continue
      rows.push({
        eventDate: new Date(t.createdAt), source: '金库直接支出', site: t.siteId || '',
        category: expenseCategory(t.note, ''),
        title: t.note || '直接支出', detail: t.note || '',
        who: t.payerName || t.operatorName || '',
        amount, status: '已支付', paid: amount, debt: 0, debtType: '',
        settlement: '金库直接支付', bucket: 'paid', loanSource: false,
        hasReceipt: (t.screenshots && t.screenshots.length) ? '有' : '',
        sourceId: t._id || '', txnId: t._id || ''
      })
    }

    rows.sort((a, b) => a.eventDate - b.eventDate)

    const totalExpense = rows.reduce((s, r) => s + r.amount, 0)
    const treasuryPaid = rows.reduce((s, r) => s + r.paid, 0) // 含长期借款后续已偿还部分
    const ordinaryDebt = rows.filter(r => r.bucket === 'ordinaryDebt').reduce((s, r) => s + r.debt, 0)
    const convertingDebt = rows.filter(r => r.bucket === 'converting').reduce((s, r) => s + r.debt, 0)
    const loanDebt = rows.filter(r => r.bucket === 'loanDebt').reduce((s, r) => s + r.debt, 0)
    const donatedAmount = rows.filter(r => r.bucket === 'donated').reduce((s, r) => s + r.amount, 0)
    const currentDebt = ordinaryDebt + convertingDebt + loanDebt
    const checkDiff = totalExpense - treasuryPaid - currentDebt - donatedAmount

    const VIEW = {
      expenses: { label: '项目累计实际费用', amount: totalExpense, hint: '所选时间范围内所有真实发生过的消费，只计一次' },
      debt: { label: '当前全部欠款', amount: currentDebt, hint: '所选费用对应的待报销、采购垫款、转借款审核中和长期借款未偿部分' },
      loan: { label: '长期借款欠款', amount: loanDebt, hint: '由原垫付/采购消费转成长期借款后，目前仍未偿还的部分' },
      pending: { label: '待报销/采购垫款', amount: ordinaryDebt + convertingDebt, hint: '尚未转成长借、也尚未从金库结清的费用' },
      paid: { label: '金库已实际支付', amount: treasuryPaid, hint: '对应这些真实费用，金库已经实际承担的金额；含长期借款后续还款' }
    }
    const viewInfo = VIEW[view] || VIEW.expenses
    let selectedRows = rows
    if (view === 'debt') selectedRows = rows.filter(r => r.debt > 0)
    else if (view === 'loan') selectedRows = rows.filter(r => r.loanSource && r.debt > 0)
    else if (view === 'pending') selectedRows = rows.filter(r => r.debt > 0 && !r.loanSource)
    else if (view === 'paid') selectedRows = rows.filter(r => r.paid > 0)

    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    wb.creator = '归山村落'
    wb.created = new Date()

    const addExpenseSheet = (sheetName, dataRows, title, focusAmount) => {
      const ws = wb.addWorksheet(sheetName)
      ws.columns = [
        { key: 'date', width: 20 },
        { key: 'source', width: 14 },
        { key: 'site', width: 14 },
        { key: 'category', width: 14 },
        { key: 'title', width: 28 },
        { key: 'detail', width: 44 },
        { key: 'who', width: 14 },
        { key: 'amount', width: 14 },
        { key: 'status', width: 22 },
        { key: 'paid', width: 14 },
        { key: 'debt', width: 14 },
        { key: 'debtType', width: 16 },
        { key: 'settlement', width: 18 },
        { key: 'receipt', width: 8 },
        { key: 'sourceId', width: 24 }
      ]
      ws.mergeCells('A1:O1')
      ws.getCell('A1').value = `${title}：¥${num(focusAmount).toFixed(2)}`
      ws.getCell('A1').font = { bold: true, size: 16 }
      ws.getCell('A1').alignment = { vertical: 'middle' }
      ws.mergeCells('A2:O2')
      ws.getCell('A2').value = `统计区间：${startDate} 至 ${endDate}｜项目累计费用 ¥${totalExpense.toFixed(2)}｜金库已支付 ¥${treasuryPaid.toFixed(2)}｜当前欠款 ¥${currentDebt.toFixed(2)}（待偿 ¥${ordinaryDebt.toFixed(2)} / 转借审核中 ¥${convertingDebt.toFixed(2)} / 长期借款 ¥${loanDebt.toFixed(2)}）`
      ws.getCell('A2').alignment = { wrapText: true }
      ws.addRow([])
      const hr = ws.addRow(['费用发生时间','来源','地方','分类','花了什么','具体内容','经手/垫付人','实际费用','当前状态','金库已支付','当前欠款','欠款类型','结算方式','凭证','来源ID'])
      styleHeader(hr)
      ws.views = [{ state: 'frozen', ySplit: 4 }]
      ws.autoFilter = { from: 'A4', to: 'O4' }

      for (const r of dataRows) {
        ws.addRow({
          date: fmtBJ(r.eventDate), source: r.source, site: r.site, category: r.category,
          title: r.title, detail: r.detail, who: r.who,
          amount: r.amount, status: r.status, paid: r.paid, debt: r.debt,
          debtType: r.debtType || '', settlement: r.settlement,
          receipt: r.hasReceipt, sourceId: r.sourceId
        })
      }
      ;['H','J','K'].forEach(c => { ws.getColumn(c).numFmt = '0.00' })
      ws.addRow([])
      const totalRow = ws.addRow({
        date: '本表合计',
        amount: dataRows.reduce((s, r) => s + r.amount, 0),
        paid: dataRows.reduce((s, r) => s + r.paid, 0),
        debt: dataRows.reduce((s, r) => s + r.debt, 0),
        detail: `共 ${dataRows.length} 笔；顶部金额按“${title}”口径显示`
      })
      totalRow.font = { bold: true }
      totalRow.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F0' } } })
      return ws
    }

    // Sheet 1：下拉所选的主视图
    addExpenseSheet(viewInfo.label.slice(0, 31), selectedRows, viewInfo.label, viewInfo.amount)

    // 如果不是“项目累计实际费用”，仍附完整清单，避免筛选视图把历史细节藏掉。
    if (view !== 'expenses') addExpenseSheet('完整费用清单', rows, '项目累计实际费用', totalExpense)

    // Sheet：费用汇总
    const sumWs = wb.addWorksheet('费用汇总')
    sumWs.columns = [
      { header: '指标', key: 'label', width: 28 },
      { header: '金额', key: 'value', width: 16 },
      { header: '说明', key: 'note', width: 68 }
    ]
    styleHeader(sumWs.getRow(1))
    addSummaryLine(sumWs, '项目累计实际费用', totalExpense, '所有真实发生过的消费，只计一次；包括已付、待报销、采购垫款、转长期借款和捐赠')
    addSummaryLine(sumWs, '金库已实际支付', treasuryPaid, '直接支出 + 已报销 + 已记账采购 + 长期借款后续已偿还部分')
    addSummaryLine(sumWs, '当前全部欠款', currentDebt, '待报销/采购垫款 + 转借款审核中 + 长期借款未偿部分')
    addSummaryLine(sumWs, '待报销/采购垫款', ordinaryDebt, '已发生消费，但尚未结清且尚未转长期借款')
    addSummaryLine(sumWs, '转借款审核中', convertingDebt, '审核未完成，仍属于项目欠款')
    addSummaryLine(sumWs, '长期借款欠款', loanDebt, '由原消费转成长借后，目前仍未偿还的部分')
    addSummaryLine(sumWs, '捐赠承担', donatedAmount, '费用真实发生，但最终由个人承担')
    addSummaryLine(sumWs, '口径校验差额', checkDiff, '项目累计费用 - 已支付 - 当前欠款 - 捐赠；正常应为 0.00')
    sumWs.addRow([])
    sumWs.addRow(['统计区间', '', `${startDate} 至 ${endDate}`])
    sumWs.addRow(['长期借款总台账余额（截至结束日，全项目）', loanOutstandingAll, '该数字按 loans 全台账计算；自定义时间范围时可能包含区间开始前形成的借款'])
    sumWs.addRow(['长期借款累计转入（截至结束日）', loanBorrowedAll, '所有从垫付/采购转成长借的正数记录'])
    sumWs.addRow(['长期借款累计已还（截至结束日）', loanRepaidAll, '所有 loans 负数还款记录的绝对值'])
    sumWs.addRow(['说明', '', '借款来自已发生消费：转借款不新增费用；还借款只增加“已支付”、减少欠款，不再次增加项目费用。'])
    sumWs.addRow(['还款分摊说明', '', '还借款目前只指定“人+金额”，未指定具体原消费；报表按转借款先后 FIFO 分摊到原消费，仅用于展示每笔剩余，真实总欠款不受影响。'])

    // 分类汇总
    sumWs.addRow([])
    const catHead = sumWs.addRow(['按分类汇总', '金额', '笔数'])
    styleHeader(catHead)
    const cat = {}
    for (const r of rows) {
      if (!cat[r.category]) cat[r.category] = { amount: 0, count: 0 }
      cat[r.category].amount += r.amount; cat[r.category].count++
    }
    Object.keys(cat).sort((a,b) => cat[b].amount - cat[a].amount).forEach(k => {
      const rr = sumWs.addRow([k, cat[k].amount, cat[k].count]); rr.getCell(2).numFmt = '0.00'
    })

    // 人员汇总
    sumWs.addRow([])
    const whoHead = sumWs.addRow(['按经手/垫付人汇总', '实际费用', '已支付', '当前欠款'])
    styleHeader(whoHead)
    const whos = {}
    for (const r of rows) {
      const k = r.who || '未标注'
      if (!whos[k]) whos[k] = { amount: 0, paid: 0, debt: 0 }
      whos[k].amount += r.amount; whos[k].paid += r.paid; whos[k].debt += r.debt
    }
    Object.keys(whos).sort((a,b) => whos[b].amount - whos[a].amount).forEach(k => {
      const rr = sumWs.addRow([k, whos[k].amount, whos[k].paid, whos[k].debt])
      rr.getCell(2).numFmt = '0.00'; rr.getCell(3).numFmt = '0.00'; rr.getCell(4).numFmt = '0.00'
    })

    // Sheet：购买内容。采购单的 items 有名称/规格/数量，但系统没有逐项价格，因此只展示“采购单总额”，不伪造单品价格。
    const itemWs = wb.addWorksheet('购买内容')
    itemWs.columns = [
      { header: '费用日期', key: 'date', width: 20 },
      { header: '地方', key: 'site', width: 14 },
      { header: '采购单', key: 'title', width: 26 },
      { header: '物品', key: 'item', width: 24 },
      { header: '规格', key: 'spec', width: 20 },
      { header: '数量', key: 'qty', width: 12 },
      { header: '采购单实付总额', key: 'total', width: 18 },
      { header: '采购人', key: 'buyer', width: 14 },
      { header: '当前状态', key: 'status', width: 22 },
      { header: '备注/原因', key: 'reason', width: 36 }
    ]
    styleHeader(itemWs.getRow(1))
    for (const p of allPurchases) {
      if (!p.submittedAt || !(num(p.actualAmount) > 0)) continue
      const d = new Date(p.submittedAt || p.createdAt)
      if (!(d >= start && d <= end)) continue
      let pst = p.ledgerStatus === 'converted' ? '已转长期借款' :
        (p.ledgerStatus === 'converting' ? '转借款审核中' :
        (p.ledgerStatus === 'recorded' ? (p.ledgerNote === 'donation' ? '已捐赠' : '已支付') :
        (p.status === 'checking' ? '待核验' : (p.status === 'verified' ? '待入库' : '待记账'))))
      const its = (p.items && p.items.length) ? p.items : [{ name: p.title || '采购单', spec: '', qty: '' }]
      its.forEach(it => itemWs.addRow({
        date: fmtBJ(d), site: p.siteId || '', title: p.title || '采购',
        item: it.name || '', spec: it.spec || '', qty: num(it.receivedQty || it.qty) || '',
        total: num(p.actualAmount), buyer: p.buyerName || '', status: pst, reason: p.reason || ''
      }))
    }
    itemWs.getColumn('total').numFmt = '0.00'

    // Sheet：长期借款原始台账。正数都能追到原消费；负数是按人还款。
    const loanWs = wb.addWorksheet('长期借款台账')
    loanWs.columns = [
      { header: '日期', key: 'date', width: 20 },
      { header: '人员', key: 'name', width: 14 },
      { header: '类型', key: 'type', width: 12 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '来源', key: 'source', width: 14 },
      { header: '原消费内容', key: 'detail', width: 46 },
      { header: '备注', key: 'note', width: 38 },
      { header: '原始来源ID', key: 'sourceId', width: 24 },
      { header: '关联流水ID', key: 'txnId', width: 24 }
    ]
    styleHeader(loanWs.getRow(1))
    for (const l of allLoans) {
      const amount = num(l.amount)
      let detail = ''
      let sid = ''
      if (l.fromPurchaseId) {
        const p = purchaseById[l.fromPurchaseId]
        sid = l.fromPurchaseId
        detail = p ? `${p.title || '采购'}｜${purchaseItemsText(p)}` : (l.note || '')
      } else if (l.fromReimbId) {
        const r = reimbById[l.fromReimbId]
        sid = l.fromReimbId
        detail = r ? (r.note || '自由垫付') : (l.note || '')
      }
      loanWs.addRow({
        date: fmtBJ(new Date(l.createdAt)), name: l.name || '',
        type: amount >= 0 ? '转入借款' : '还款',
        amount, source: l.source || '',
        detail, note: l.note || '', sourceId: sid, txnId: l.txnId || ''
      })
    }
    loanWs.getColumn('amount').numFmt = '0.00'
    loanWs.addRow([])
    const loanSumRow = loanWs.addRow({
      date: '截至结束日',
      amount: loanOutstandingAll,
      detail: `累计转入 ¥${loanBorrowedAll.toFixed(2)} / 累计已还 ¥${loanRepaidAll.toFixed(2)} / 当前余额`
    })
    loanSumRow.font = { bold: true }

    // Sheet：原始金库流水（审计）。loan_repay 会保留在这里，但不作为新费用。
    const txWs = wb.addWorksheet('金库流水')
    txWs.columns = [
      { header: '日期时间', key: 'date', width: 20 },
      { header: '类型', key: 'type', width: 8 },
      { header: '金额', key: 'amount', width: 12 },
      { header: '备注', key: 'note', width: 36 },
      { header: '花钱人', key: 'payer', width: 14 },
      { header: '记录人', key: 'operator', width: 14 },
      { header: '业务类型', key: 'kind', width: 18 },
      { header: '是否新费用', key: 'isExpense', width: 12 },
      { header: '附件', key: 'hasShot', width: 8 }
    ]
    styleHeader(txWs.getRow(1))
    let inSum = 0, outSum = 0
    for (const t of allTxns) {
      const isIn = t.type === 'in'
      const amount = num(t.amount)
      if (isIn) inSum += amount; else outSum += amount
      const nonExpense = !isIn && isNonExpenseOutTxn(t)
      txWs.addRow({
        date: fmtBJ(new Date(t.createdAt)), type: isIn ? '收入' : '支出', amount,
        note: t.note || '', payer: t.payerName || t.operatorName || '',
        operator: t.operatorName || '', kind: t.kind || '',
        isExpense: nonExpense ? '否（偿债/冲正）' : (isIn ? '—' : (linkedTxnIds.has(t._id) ? '否（已由原费用计入）' : '是')),
        hasShot: (t.screenshots && t.screenshots.length) ? '有' : ''
      })
    }
    txWs.getColumn('amount').numFmt = '0.00'
    txWs.addRow([])
    const txSum = txWs.addRow({ date: '合计', amount: inSum - outSum, note: `收入 ¥${inSum.toFixed(2)} / 支出 ¥${outSum.toFixed(2)} / 净额` })
    txSum.font = { bold: true }

    // 驳回记录：透明留痕，但不计项目费用
    if (rejectedRows.length) {
      const rejWs = wb.addWorksheet('未计入费用')
      rejWs.columns = [
        { header: '日期', key: 'date', width: 20 },
        { header: '来源', key: 'source', width: 14 },
        { header: '申请人', key: 'who', width: 14 },
        { header: '金额', key: 'amount', width: 14 },
        { header: '说明', key: 'note', width: 40 },
        { header: '原因', key: 'reason', width: 32 }
      ]
      styleHeader(rejWs.getRow(1))
      rejectedRows.forEach(x => rejWs.addRow(x))
      rejWs.getColumn('amount').numFmt = '0.00'
    }

    const buffer = await wb.xlsx.writeBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const safeLabel = viewInfo.label.replace(/[\\/:*?"<>|]/g, '')
    return {
      success: true, base64, count: selectedRows.length,
      totals: {
        totalExpense, treasuryPaid, currentDebt, ordinaryDebt, convertingDebt, loanDebt,
        donatedAmount, loanOutstandingAll, loanBorrowedAll, loanRepaidAll, checkDiff
      },
      filename: `归山村落_${safeLabel}_${startDate}_${endDate}.xlsx`
    }
  }

  if (action === 'exportTransactions') {
    const { startDate, endDate, typeFilter, personFilter } = data
    const start = new Date(startDate + 'T00:00:00+08:00')
    const end = new Date(endDate + 'T23:59:59+08:00')

    // 分页抓全量（单次上限 1000），避免区间内记录超过 1000 时被截断、合计算错
    let list = []
    let skip = 0
    const PAGE = 1000
    while (true) {
      const r = await db.collection('transactions')
        .where({ createdAt: _.gte(start).and(_.lte(end)) })
        .orderBy('createdAt', 'asc')
        .skip(skip).limit(PAGE).get()
      list = list.concat(r.data)
      if (r.data.length < PAGE) break
      skip += PAGE
    }
    if (typeFilter && typeFilter !== 'all') list = list.filter(t => t.type === typeFilter)
    if (personFilter && personFilter !== 'all') list = list.filter(t => (t.payerName || t.operatorName) === personFilter)

    const ExcelJS = require('exceljs')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('流水')

    ws.columns = [
      { header: '日期时间', key: 'date', width: 20 },
      { header: '类型', key: 'type', width: 8 },
      { header: '金额', key: 'amount', width: 12 },
      { header: '备注', key: 'note', width: 32 },
      { header: '花钱人', key: 'payer', width: 12 },
      { header: '记录人', key: 'operator', width: 12 },
      { header: '结算批次', key: 'batch', width: 10 },
      { header: '附件', key: 'hasShot', width: 8 }
    ]

    const headerRow = ws.getRow(1)
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A7A5E' } }
      cell.alignment = { vertical: 'middle', horizontal: 'center' }
    })

    let inSum = 0, outSum = 0
    for (const t of list) {
      const isIn = t.type === 'in'
      const amount = t.amount || 0
      if (isIn) inSum += amount; else outSum += amount
      ws.addRow({
        date: fmtBJ(new Date(t.createdAt)),
        type: isIn ? '收入' : '支出',
        amount,
        note: t.note || '',
        payer: t.payerName || t.operatorName || '',
        operator: t.operatorName || '',
        batch: t.settlementId ? t.settlementId.slice(-6) : '',
        hasShot: (t.screenshots && t.screenshots.length > 0) ? '有' : ''
      })
    }

    ws.getColumn('amount').numFmt = '0.00'
    ws.addRow([])
    const summaryRow = ws.addRow({
      date: '合计',
      type: '',
      amount: inSum - outSum,
      note: `收入 ¥${inSum.toFixed(2)} / 支出 ¥${outSum.toFixed(2)} / 净额`,
      payer: '',
      operator: '',
      hasShot: ''
    })
    summaryRow.font = { bold: true }
    summaryRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F0' } }
    })

    const buffer = await wb.xlsx.writeBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    return {
      success: true,
      base64,
      count: list.length,
      inSum, outSum,
      filename: `归山村落流水_${startDate}_${endDate}.xlsx`
    }
  }

  if (action === 'getScheduleItems') {
    try { await db.createCollection('schedules') } catch(e) {}
    const result = await db.collection('schedules').where({ date: data.date }).orderBy('createdAt', 'asc').get()
    return { success: true, list: result.data }
  }

  if (action === 'getScheduleDates') {
    try { await db.createCollection('schedules') } catch(e) {}
    const result = await db.collection('schedules').where({ date: _.gte(data.startDate).and(_.lte(data.endDate)) }).get()
    const dates = [...new Set(result.data.map(s => s.date))]
    return { success: true, dates }
  }

  if (action === 'addScheduleItem') {
    try { await db.createCollection('schedules') } catch(e) {}
    await db.collection('schedules').add({
      data: { date: data.date, text: data.text, done: false, operatorName: data.operatorName || '', openid, createdAt: new Date() }
    })
    return { success: true }
  }

  if (action === 'editScheduleItem') {
    await db.collection('schedules').doc(data.id).update({ data: { text: data.text } })
    return { success: true }
  }

  if (action === 'toggleScheduleItem') {
    await db.collection('schedules').doc(data.id).update({ data: { done: data.done } })
    return { success: true }
  }

  if (action === 'deleteScheduleItem') {
    await db.collection('schedules').doc(data.id).remove()
    return { success: true }
  }

  return { success: false, msg: 'unknown action' }
}