// cloudfunctions/aiStockIn/index.js
// AI 入库助手：把一段自然语言（如「矿泉水24瓶 方便面2箱 鸡蛋30个」）交给豆包（火山方舟），
// 梳理成结构化入库清单 [{name, qty, unit, spec}]，返回给前端让用户确认后再入库。
//
// 【密钥安全】不在代码里写任何密钥。云函数读取两个环境变量（在开发者工具的云函数配置里填）：
//   ARK_API_KEY  —— 火山方舟「大模型专用 API Key」
//   ARK_MODEL    —— 方舟推理接入点 ID（ep- 开头）或模型名
// 方舟接口与 OpenAI 兼容：POST https://ark.cn-beijing.volces.com/api/v3/chat/completions
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const https = require('https')
const db = cloud.database()
const _ = db.command

const ARK_HOST = 'ark.cn-beijing.volces.com'
const ARK_PATH = '/api/v3/chat/completions'

// 入库梳理的系统提示（文字 / 文件共用）
const SYS_PROMPT = '你是仓库入库助手。用户会用自然语言或一段表格内容描述要入库的物品。请把它们整理成一个 JSON 数组，' +
  '每个元素形如 {"name":"物品名","qty":数量,"unit":"单位","spec":"规格"}。' +
  '规则：name 必填；qty 是数字（识别不出就填 0）；unit 如 瓶/箱/个/袋，没有就留空字符串；spec 是规格描述，没有就留空。' +
  '忽略表头、合计行、与物品无关的文字。只输出 JSON 数组本身，不要任何解释、不要 markdown 代码块。'

// 头衔工作清单生成的系统提示
const CHECKLIST_PROMPT = '你是乡村社区的岗位职责助手。用户会给你一个头衔（岗位）名称，可能还有职责描述和排期。' +
  '请为这个岗位列出每次履职时要做的具体事项清单，整理成 JSON 数组，每个元素形如 {"text":"事项描述"}。' +
  '规则：每条是一个可勾选的具体动作，简短明确（10 字以内最佳），按实际做事顺序排列；' +
  '条数控制在 3~7 条，不要拆得太碎，也不要笼统；贴合乡村民宿/营地的真实场景，不要写空话套话。' +
  '只输出 JSON 数组本身，不要任何解释、不要 markdown 代码块。'

// 从模型返回里抠出清单数组
function extractChecklist(text) {
  if (!text) return []
  let t = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const l = t.indexOf('[')
  const r = t.lastIndexOf(']')
  if (l >= 0 && r > l) t = t.slice(l, r + 1)
  let arr
  try { arr = JSON.parse(t) } catch (e) { return [] }
  if (!Array.isArray(arr)) return []
  return arr
    .map(x => String((typeof x === 'string' ? x : (x.text || x.事项 || x.item || x.name || '')) || '').trim())
    .filter(Boolean)
    .slice(0, 10)   // 上限 10 条，防模型放飞
}

function callArk(apiKey, model, messages) {
  const payload = JSON.stringify({ model, messages, temperature: 0.1 })
  const options = {
    hostname: ARK_HOST,
    path: ARK_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 20000
  }
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          if (json.error) return reject(new Error(json.error.message || '模型返回错误'))
          const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
          resolve(content || '')
        } catch (e) { reject(new Error('解析模型响应失败：' + body.slice(0, 200))) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('请求模型超时')) })
    req.write(payload)
    req.end()
  })
}

// 从模型返回的文本里抠出 JSON 数组（容错：去掉 ```json 围栏、找第一个 [ 到最后一个 ]）
function extractJsonArray(text) {
  if (!text) return []
  let t = String(text).replace(/```json/gi, '').replace(/```/g, '').trim()
  const l = t.indexOf('[')
  const r = t.lastIndexOf(']')
  if (l >= 0 && r > l) t = t.slice(l, r + 1)
  let arr
  try { arr = JSON.parse(t) } catch (e) { return [] }
  if (!Array.isArray(arr)) return []
  return arr.map(x => ({
    name: String(x.name || x.物品 || x.名称 || '').trim(),
    qty: Number(x.qty || x.数量 || x.count || 0) || 0,
    unit: String(x.unit || x.单位 || '').trim(),
    spec: String(x.spec || x.规格 || '').trim()
  })).filter(x => x.name)
}

exports.main = async (event) => {
  const { action, data } = event

  // 头衔工作清单生成：给个头衔名（+职责描述），AI 列出要勾选的事项
  if (action === 'genChecklist') {
    const title = (data && data.title || '').trim()
    if (!title) return { success: false, msg: '请先填写头衔名称' }
    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) {
      return { success: false, msg: '尚未配置豆包密钥（请在 aiStockIn 云函数的环境变量里填 ARK_API_KEY 和 ARK_MODEL）' }
    }
    const parts = ['头衔：' + title]
    if (data.dutyNote) parts.push('职责说明：' + String(data.dutyNote).trim())
    if (data.schedText) parts.push('排期：' + String(data.schedText).trim())
    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: CHECKLIST_PROMPT },
        { role: 'user', content: parts.join('\n') }
      ])
      const items = extractChecklist(content)
      if (items.length === 0) return { success: false, msg: 'AI 没能生成清单，换个说法再试' }
      return { success: true, items }
    } catch (e) {
      return { success: false, msg: (e && e.message) || 'AI 调用失败' }
    }
  }

  if (action === 'parse') {
    const text = (data && data.text || '').trim()
    if (!text) return { success: false, msg: '请先输入要入库的内容' }

    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) {
      return { success: false, msg: '尚未配置豆包密钥（请在 aiStockIn 云函数的环境变量里填 ARK_API_KEY 和 ARK_MODEL）' }
    }

    const sys = SYS_PROMPT

    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: sys },
        { role: 'user', content: text }
      ])
      const items = extractJsonArray(content)
      if (items.length === 0) return { success: false, msg: 'AI 没能识别出物品，请把描述写清楚些（如：矿泉水 24瓶，方便面 2箱）' }
      return { success: true, items, raw: content }
    } catch (e) {
      return { success: false, msg: 'AI 调用失败：' + (e.message || '未知错误') }
    }
  }

  // 从文件（Excel / CSV）提取内容，再交给豆包梳理
  if (action === 'parseFile') {
    const fileID = data && data.fileID
    const ext = ((data && data.ext) || '').toLowerCase()
    if (!fileID) return { success: false, msg: '缺少文件' }

    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) {
      return { success: false, msg: '尚未配置豆包密钥（请在 aiStockIn 云函数的环境变量里填 ARK_API_KEY 和 ARK_MODEL）' }
    }

    let text = ''
    try {
      const dl = await cloud.downloadFile({ fileID })
      const buf = dl.fileContent
      if (ext === 'csv') {
        text = buf.toString('utf8')
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = require('xlsx')
        const wb = XLSX.read(buf, { type: 'buffer' })
        const parts = []
        wb.SheetNames.forEach(n => { parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[n])) })
        text = parts.join('\n')
      } else if (ext === 'docx') {
        const mammoth = require('mammoth')
        const result = await mammoth.extractRawText({ buffer: buf })
        text = (result && result.value) || ''
      } else {
        return { success: false, msg: '支持 Excel / CSV / Word(.docx)；.doc 旧格式请另存为 .docx 再传' }
      }
    } catch (e) {
      return { success: false, msg: '读取文件失败：' + (e.message || '') + '（请确认是 Excel/CSV，且文件没损坏）' }
    }

    if (!text.trim()) return { success: false, msg: '文件里没有可识别的内容' }
    if (text.length > 6000) text = text.slice(0, 6000) // 太长截断，避免超时

    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: '下面是一个表格/文件的内容，请提取其中要入库的物品：\n' + text }
      ])
      const items = extractJsonArray(content)
      if (items.length === 0) return { success: false, msg: '没能从文件里识别出物品，换个文件或改用文字输入' }
      return { success: true, items }
    } catch (e) {
      return { success: false, msg: 'AI 调用失败：' + (e.message || '未知错误') }
    }
  }

  // 图片入库：把照片交给豆包「视觉模型」识别（需 ARK_MODEL 是视觉版）
  if (action === 'parseImage') {
    const fileIDs = (data && data.fileIDs) || []
    if (!fileIDs.length) return { success: false, msg: '没有图片' }

    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) {
      return { success: false, msg: '尚未配置豆包密钥（请在 aiStockIn 云函数的环境变量里填 ARK_API_KEY 和 ARK_MODEL）' }
    }

    const userContent = [{ type: 'text', text: '这是一张物资清单/采购小票的照片。请识别其中要入库的物品，按系统要求只输出 JSON 数组。' }]
    try {
      for (const fid of fileIDs.slice(0, 3)) { // 最多 3 张，避免超时
        const dl = await cloud.downloadFile({ fileID: fid })
        const b64 = dl.fileContent.toString('base64')
        const mime = String(fid).toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
        userContent.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } })
      }
    } catch (e) {
      return { success: false, msg: '读取图片失败：' + (e.message || '') }
    }

    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: userContent }
      ])
      const items = extractJsonArray(content)
      if (items.length === 0) return { success: false, msg: '没能从图片识别出物品。换张更清晰的照片，或改用文字/表格输入' }
      return { success: true, items }
    } catch (e) {
      return { success: false, msg: 'AI 识别失败：' + (e.message || '未知错误') + '（若提示模型不支持图片，说明接入点不是视觉模型）' }
    }
  }

  // ====== AI 咨询：把区间内的明细丢给 AI，灵活问答；金额合计由代码算好 ======
  if (action === 'consult') {
    const question = (data && data.question || '').trim()
    if (!question) return { success: false, msg: '请输入你想问的问题' }
    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) return { success: false, msg: '尚未配置豆包密钥（aiStockIn 环境变量 ARK_API_KEY / ARK_MODEL）' }

    const range = data && data.range // undefined=未选；'today'|'7d'|'30d'
    let info
    try {
      info = await buildConsultContext(range)
    } catch (e) {
      return { success: false, msg: '读取数据失败：' + (e.message || '') }
    }
    // 记录太多且用户还没选区间 → 让前端弹区间选择
    if (info.needRange) {
      return { success: true, needRange: true, counts: info.counts }
    }

    const sys = '你是「归山村落」的管家助手。下面提供村子的数据：一部分是系统算好的合计数字，一部分是明细清单。' +
      '回答用户问题时：涉及金额合计请优先用「系统算好的数字」；需要归纳/查找/分类时可依据明细清单。' +
      '明细之外、数据里没有的，直说「目前数据里看不到」，绝不编造数字或人名。' +
      (info.truncated ? '注意：明细较多只给了最近一部分，如用户要更早的，提示他换更大的区间或去对应页面查。' : '') +
      '回答简洁、口语化。'
    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: sys },
        { role: 'user', content: '【村子数据】\n' + info.context + '\n\n【问题】' + question }
      ])
      return { success: true, answer: content || '（没有得到回答）' }
    } catch (e) {
      return { success: false, msg: 'AI 调用失败：' + (e.message || '未知错误') }
    }
  }

  // ====== AI 周报：数字由代码算，AI 只负责把数字写成通顺的话 ======
  if (action === 'weeklyReport') {
    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) return { success: false, msg: '尚未配置豆包密钥（aiStockIn 环境变量 ARK_API_KEY / ARK_MODEL）' }

    let facts
    try {
      facts = await computeWeeklyFacts()
    } catch (e) {
      return { success: false, msg: '统计数据失败：' + (e.message || '') }
    }

    const factText =
      `统计区间：最近 7 天（${facts.fromStr} 至 ${facts.toStr}）\n` +
      `金库：本周收入 ¥${facts.income}，支出 ¥${facts.expense}，净额 ¥${facts.net}，期末余额 ¥${facts.balance}\n` +
      `采购：本周新发起 ${facts.purchaseNew} 单，已完成入库 ${facts.purchaseDone} 单\n` +
      `出入库：入库 ${facts.inCount} 次，出库 ${facts.outCount} 次，报废 ${facts.scrapCount} 次\n` +
      `任务：本周完成 ${facts.taskDone} 个\n` +
      `成员：当前正式营员 ${facts.memberCount} 人，本周新加入 ${facts.memberNew} 人\n` +
      `库存预警：当前偏低物品 ${facts.lowCount} 项${facts.lowNames ? '（' + facts.lowNames + '）' : ''}`

    const sys = '你是「归山村落」的运营助理。下面是本周运营数据，所有数字都已由系统算好。' +
      '请把它写成一份通顺、平实的中文周报，分几个小段（金库、采购与库存、人员与任务、提醒）。' +
      '【铁律】不得改动、不得新增任何数字，只能用提供的数字；不要编造没有的内容。结尾可给一句简短提醒。'
    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: sys },
        { role: 'user', content: factText }
      ])
      return { success: true, report: content || '', facts, factText }
    } catch (e) {
      // AI 失败也把数字返回，前端至少能看到原始统计
      return { success: false, msg: 'AI 生成失败：' + (e.message || '未知错误'), facts, factText }
    }
  }

  // ====== 人员工作周报：前端把本周各人日报数据整理好传进来，AI 只写叙述、不碰数字 ======
  // event.data 期望：{ fromStr, toStr, people:[{name, validDays, completedTasks:[任务名...], noteCount}] }
  if (action === 'staffWeeklyReport') {
    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) return { success: false, msg: '尚未配置豆包密钥（aiStockIn 环境变量 ARK_API_KEY / ARK_MODEL）' }

    const d = (event && event.data) || {}
    const people = Array.isArray(d.people) ? d.people : []
    if (people.length === 0) return { success: false, msg: '本周暂无工作记录' }

    // 把结构化数据拼成给 AI 的事实文本（数字都是前端/代码算好的）
    const lines = people.map(p => {
      const tasks = (p.completedTasks || []).join('、') || '无'
      return `· ${p.name}：本周有效工作日 ${p.validDays} 天；完成任务：${tasks}；备注 ${p.noteCount || 0} 条`
    })
    const factText =
      `统计区间：${d.fromStr || ''} 至 ${d.toStr || ''}\n` +
      `本周共 ${people.length} 人有工作记录：\n` + lines.join('\n')

    const sys = '你是「归山村落」的运营助理。下面是本周各位营员的工作记录，数据都已由系统算好。' +
      '请写一段平实、简短的中文「人员工作周报」，概述这周大家干了些什么、谁比较活跃。' +
      '【铁律】只能用提供的内容，不得新增、夸大或编造任何人没做过的事，不得改动有效工作日的数字。' +
      '客观平实，不要溢美之词，不要给员工打分或排名评价。'
    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: sys },
        { role: 'user', content: factText }
      ])
      return { success: true, report: content || '', factText }
    } catch (e) {
      return { success: false, msg: 'AI 生成失败：' + (e.message || '未知错误'), factText }
    }
  }

  // ====== 全村昨日总结：跑批调用，数字代码算好，AI 只写一段平实的话 ======
  if (action === 'dailyDigest') {
    const apiKey = process.env.ARK_API_KEY
    const model = process.env.ARK_MODEL
    if (!apiKey || !model) return { success: false, msg: '尚未配置豆包密钥' }
    const d = (event && event.data) || {}
    if (!d.factText) return { success: false, msg: '无数据' }

    const sys = '你是「归山村落」的运营助理。下面是昨天全村的工作完成情况，数字已由系统算好。' +
      '请写一段简短（2-4句）、平实的中文「昨日工作小结」，概述昨天大家完成了哪些事。' +
      '【铁律】只能用提供的内容，不得新增、夸大或编造，不得改动人数和任务数。不要打分、不要排名、不要溢美。'
    try {
      const content = await callArk(apiKey, model, [
        { role: 'system', content: sys },
        { role: 'user', content: d.factText }
      ])
      return { success: true, report: content || '' }
    } catch (e) {
      return { success: false, msg: 'AI 生成失败：' + (e.message || '') }
    }
  }

  return { success: false, msg: 'unknown action' }
}

// —— 汇总村子当前数据，供 AI 咨询用 ——
// —— 咨询上下文：合计数字代码算好；明细按区间丢给 AI；超量则让用户选区间 ——
const RANGE_DAYS = { today: 0, '7d': 7, '30d': 30 }
const DETAIL_CAP = 80   // 明细超过这么多条就让用户选区间

function rangeFrom(key, now) {
  if (key === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = RANGE_DAYS[key] || 7
  return new Date(now.getTime() - days * 24 * 3600 * 1000)
}

async function buildConsultContext(range) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const wkAgo = rangeFrom('7d', now)
  const todayStart = rangeFrom('today', now)

  const tx = (await db.collection('transactions').orderBy('createdAt', 'desc').limit(1000).get()).data
  const d30 = rangeFrom('30d', now)
  const purch = (await db.collection('purchases').where({ createdAt: _.gte(d30) }).orderBy('createdAt', 'desc').limit(500).get()).data
  const logs = (await db.collection('logs').where({ createdAt: _.gte(d30) }).orderBy('createdAt', 'desc').limit(1000).get()).data

  // 合计（代码算）
  let income = 0, expense = 0, todayOut = 0, weekOut = 0, weekIn = 0, monthOut = 0, monthIn = 0
  tx.forEach(t => {
    const amt = Number(t.amount) || 0, dt = new Date(t.createdAt)
    if (t.type === 'in') { income += amt; if (dt >= wkAgo) weekIn += amt; if (dt >= monthStart) monthIn += amt }
    else { expense += amt; if (dt >= todayStart) todayOut += amt; if (dt >= wkAgo) weekOut += amt; if (dt >= monthStart) monthOut += amt }
  })
  const balance = income - expense

  // 各区间记录条数（用于"太多请选区间"）
  const countIn = (from) => tx.filter(t => new Date(t.createdAt) >= from).length +
    purch.filter(p => new Date(p.createdAt) >= from).length +
    logs.filter(l => new Date(l.createdAt) >= from).length
  const counts = { today: countIn(todayStart), '7d': countIn(wkAgo), '30d': countIn(d30) }

  const key = range || '7d'
  // 未选区间且默认(7天)就超量 → 让前端弹选择
  if (!range && counts['7d'] > DETAIL_CAP) {
    return { needRange: true, counts }
  }
  const from = rangeFrom(key, now)

  // 组装该区间明细（合并后按时间倒序，超 CAP 截断）
  let detail = []
  tx.filter(t => new Date(t.createdAt) >= from).forEach(t => detail.push({ at: new Date(t.createdAt), line: `${fmtDate(t.createdAt)} 金库${t.type === 'in' ? '收入' : '支出'} ¥${t.amount} ${t.note || ''}` }))
  purch.filter(p => new Date(p.createdAt) >= from).forEach(p => {
    const items = (p.items || []).map(it => `${it.name}×${it.qty || '?'}`).join('、')
    detail.push({ at: new Date(p.createdAt), line: `${fmtDate(p.createdAt)} 采购[${p.statusLabel || p.status}] ${p.title || ''} ${items}${p.actualAmount ? ' 实付¥' + p.actualAmount : ''}` })
  })
  logs.filter(l => new Date(l.createdAt) >= from).forEach(l => detail.push({ at: new Date(l.createdAt), line: `${fmtDate(l.createdAt)} ${logLabel(l.type)} ${l.itemName || l.note || ''}${l.qty ? ' ×' + l.qty : ''}` }))
  detail.sort((a, b) => b.at - a.at)
  let truncated = false
  if (detail.length > DETAIL_CAP) { detail = detail.slice(0, DETAIL_CAP); truncated = true }
  const detailText = detail.map(d => d.line).join('\n') || '（该区间无明细）'

  // 角色 / 成员 / 库存（始终带上）
  const cfg = (await db.collection('config').where({ key: 'roles' }).limit(1).get()).data[0]
  const roles = (cfg && cfg.value) || {}
  const treasurerDoc = (await db.collection('config').where({ key: 'treasurer' }).limit(1).get()).data[0]
  const headmanDoc = (await db.collection('config').where({ key: 'headman' }).limit(1).get()).data[0]
  const sup = (roles.supervisors || []).map(s => s.name).join('、') || '无'
  const keep = (roles.keepers || []).map(k => k.name).join('、') || '无'
  const treasurer = (treasurerDoc && treasurerDoc.value && treasurerDoc.value.name) || '未指定'
  const headman = (headmanDoc && headmanDoc.value && headmanDoc.value.name) || '未指定'
  const members = (await db.collection('members').limit(300).get()).data.filter(m => (m.status || 'active') === 'active')
  const res = (await db.collection('resources').limit(500).get()).data
  const low = res.filter(r => (r.qty || 0) <= (r.lowThreshold || 3))
  const lowNames = low.slice(0, 20).map(r => `${r.name}(${r.qty || 0})`).join('、')

  const rangeName = { today: '今天', '7d': '最近7天', '30d': '最近30天' }[key]
  const context = [
    '【系统算好的合计数字（金额请用这些）】',
    `金库余额：¥${balance}（累计收入 ¥${income}，累计支出 ¥${expense}）`,
    `今日支出 ¥${todayOut}；最近7天 支出 ¥${weekOut} / 收入 ¥${weekIn}；本月 支出 ¥${monthOut} / 收入 ¥${monthIn}`,
    `账房先生：${treasurer}；执事：${headman}；主管：${sup}；库管：${keep}`,
    `正式营员 ${members.length} 人；物资 ${res.length} 种；库存偏低 ${low.length} 项${lowNames ? '：' + lowNames : ''}`,
    '',
    `【${rangeName} 的明细清单（用于归纳/查找/分类，金额请勿自行加总，用上面的合计）】`,
    detailText,
    truncated ? `（明细较多，只列了最近 ${DETAIL_CAP} 条；要更早的请换更大区间或去对应页面查）` : ''
  ].join('\n')

  return { context, truncated }
}

function logLabel(t) {
  return ({ in: '入库', out: '出库', money_in: '金库收入', money_out: '金库支出', task_done: '完成任务', scrap: '报废', item_edit: '改物品', item_delete: '删物品', stocktake: '盘点', member_admit: '新成员加入', member_evict: '成员离开' })[t] || (t || '动态')
}

// —— 计算本周（最近7天）各项数字，全部由代码算 ——
async function computeWeeklyFacts() {
  const now = new Date()
  const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000)

  const allTx = (await db.collection('transactions').orderBy('createdAt', 'desc').limit(500).get()).data
  let income = 0, expense = 0, balIn = 0, balOut = 0
  allTx.forEach(t => {
    const amt = Number(t.amount) || 0
    if (t.type === 'in') balIn += amt; else balOut += amt
    if (new Date(t.createdAt) >= from) { if (t.type === 'in') income += amt; else expense += amt }
  })
  const balance = balIn - balOut

  const logs = (await db.collection('logs').where({ createdAt: _.gte(from) }).limit(1000).get()).data
  const cnt = (type) => logs.filter(l => l.type === type).length
  const inCount = cnt('in')
  const outCount = cnt('out')
  const scrapCount = cnt('scrap')
  const taskDone = cnt('task_done')

  const purchases = (await db.collection('purchases').where({ createdAt: _.gte(from) }).limit(500).get()).data
  const purchaseNew = purchases.length
  const purchaseDone = purchases.filter(p => p.status === 'done').length

  const members = (await db.collection('members').limit(300).get()).data
  const activeMembers = members.filter(m => (m.status || 'active') === 'active')
  const memberNew = activeMembers.filter(m => {
    const d = m.admittedAt || m.joinedAt
    return d && new Date(d) >= from
  }).length

  const res = (await db.collection('resources').limit(500).get()).data
  const low = res.filter(r => (r.qty || 0) <= (r.lowThreshold || 3))

  return {
    fromStr: fmtDate(from), toStr: fmtDate(now),
    income, expense, net: income - expense, balance,
    purchaseNew, purchaseDone,
    inCount, outCount, scrapCount,
    taskDone,
    memberCount: activeMembers.length, memberNew,
    lowCount: low.length,
    lowNames: low.slice(0, 12).map(r => r.name).join('、')
  }
}

function fmtDate(d) {
  const x = new Date(d)
  return `${x.getMonth() + 1}/${x.getDate()}`
}