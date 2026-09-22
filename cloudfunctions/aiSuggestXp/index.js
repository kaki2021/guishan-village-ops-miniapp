const cloud = require('wx-server-sdk')
const https = require('https')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 提示词写在代码里（不放环境变量：太长、不敏感、改它重部署即可）。
// 不再直接评 XP：让 AI 只估「工时 + 强度档」，XP 由 taskManager 用公式 工时×强度系数 算。
// 仍保留「按投入评、不因工种贵贱而异」的原则。
function buildSystemPrompt(existingTypes) {
  const typeList = (existingTypes && existingTypes.length)
    ? existingTypes.join('、')
    : '（暂无，请自行命名一个贴切的类型）'
  return `你是营地任务评估助手。营地有民宿、露营、内容拍摄、后厨、保洁、采购、建设维修、接待等各类活，这些活**没有贵贱之分**，评估只看投入的工夫，不看活的种类是否"专业"。
请基于任务名称和描述，保守、实际地估出四件事：

【1. 任务类型 taskType】
现有类型库：${typeList}
- 有贴切的就原样选用其一；都不贴切就自起一个简洁新类型名（2-6字名词，如「布草洗护」「短视频剪辑」）。

【2. 预计工时 hours（小时，可带小数）】
估这个任务**一个人**认真做下来大约要花多少小时。
- 半小时填 0.5；一个半小时填 1.5；半天约 3~4；一整天扎实干按 8 估。
- 只估"实打实投入的时长"，不含等待/挂机的空档。
- 信息模糊、看不出干多久时，按**较低**的合理值估，宁少勿多。

【3. 强度档 intensity（1~5 的整数）—— 只看累不累，不看技能高低】
强度衡量"干这活费不费劲、费不费神"，**与是否专业、是否人人都会无关**：
  1 非常轻：待命/值守，基本不费力，能分心做别的；
  2 比较轻：较轻松，偶尔出点力；
  3 中等：常规劳动，需要专注但不极端（**拿不准时一律填 3**）；
  4 比较重：较累，要持续出力或长时间高度专注；
  5 非常重：又累又费神，或重体力。
扫地、搬运这类"简单但费力"的活，强度该按实际体力给（可到 4、5），不因"活简单"压低；
坐着剪片这类"有门槛但不累"的活，强度别因"专业"抬高。

【4. 交付清单 deliverables（数组）】
列出「这个任务算干完了的可核对标准」，3-6 条，每条是一个具体、可眼见核对的结果（不是步骤）。
例：取快递任务 → ["取到名下全部快递","当场核对件数与单号无误","破损件已拍照登记","快递送到前台并签收"]
描述越清楚，清单越具体；信息少就给通用但可核对的几条。

只返回一个 JSON：{"taskType":"...","hours":数字,"intensity":1到5的整数,"deliverables":["...","..."]}
不要任何多余文字、不要 markdown 代码块。`
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// 失败 / 未配密钥时的兜底：给一个温和的默认（约 2 小时、中等强度）
function fallback(taskType, msg) {
  return { hours: 2, intensity: 3, taskType: taskType || '其他', deliverables: [], msg }
}

exports.main = async (event) => {
  const { taskName, taskDesc, taskType, existingTypes } = event
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return fallback(taskType, '尚未配置 DEEPSEEK_API_KEY')

  const userContent = '任务名称：' + taskName +
    (taskDesc ? ('\n任务描述：' + taskDesc) : '') +
    (taskType ? ('\n（用户暂选类型：' + taskType + '，仅供参考）') : '')

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: buildSystemPrompt(existingTypes) },
      { role: 'user', content: userContent }
    ],
    max_tokens: 300
  })

  const options = {
    hostname: 'api.deepseek.com',
    path: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(body)
    }
  }

  try {
    const data = await request(options, body)
    let raw = (data.choices[0].message.content || '').trim()
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim()

    let hours = 2, intensity = 3, tt = taskType || '其他', deliverables = []
    try {
      const obj = JSON.parse(raw)
      const h = parseFloat(obj.hours)
      if (!isNaN(h) && h > 0) hours = Math.round(h * 10) / 10   // 保留 1 位小数
      const it = parseInt(obj.intensity)
      if ([1, 2, 3, 4, 5].includes(it)) intensity = it
      if (obj.taskType && String(obj.taskType).trim()) tt = String(obj.taskType).trim()
      if (Array.isArray(obj.deliverables)) {
        deliverables = obj.deliverables
          .map(s => String(s || '').trim()).filter(Boolean).slice(0, 8)
      }
    } catch (e) {
      // JSON 没解出来：尽量从文本里抠一个数当工时，强度退默认
      const m = raw.match(/[\d.]+/)
      if (m) { const h = parseFloat(m[0]); if (!isNaN(h) && h > 0) hours = Math.round(h * 10) / 10 }
    }
    return { hours, intensity, taskType: tt, deliverables }
  } catch (e) {
    return fallback(taskType, 'AI 调用失败，已用默认值')
  }
}