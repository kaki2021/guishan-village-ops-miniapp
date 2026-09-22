const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 难度档仅作展示标签，不再折算经验。（已被强度 intensity 取代，保留兼容老数据）
const DIFF_TAGS = ['high', 'mid', 'low']

// ---------- XP = 工时 × 强度系数 ----------
// 强度 5 档系数：温和(0.6~1.4)，时间是主因、强度只作修正。默认第 3 档(中等 1.0)。
const INTENSITY_COEF = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.2, 5: 1.4 }
function coefOf(intensity) {
  return INTENSITY_COEF[intensity] != null ? INTENSITY_COEF[intensity] : 1.0
}
// XP = 工时(小时) × 强度系数，保留 1 位小数（避免浮点尾巴；整数仍显示为整数）
function calcXp(hours, intensity) {
  const h = Number(hours) || 0
  return Math.round(h * coefOf(intensity) * 100) / 100
}
// 经验留 1 位小数的统一收口（结算/平分用）
function roundXp(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 等级分档（沿用原有阈值；对小数同样适用）
function calcLevel(xp) {
  return xp >= 2000 ? 5 : xp >= 1000 ? 4 : xp >= 500 ? 3 : xp >= 200 ? 2 : 1
}

function _genId(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

// ---------- 角色 / 身份辅助 ----------
async function getRoles() {
  const r = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  return (r.data[0] && r.data[0].value) || { supervisors: [], keepers: [] }
}

// 是不是「该地方」的主管。任务无 siteId（老数据）→ 任意地方主管都可管；
// 主管条目无 siteId（老角色）→ 按全局兜底
async function isSiteSupervisor(openid, siteId) {
  const sups = (await getRoles()).supervisors || []
  if (!siteId) return sups.some(s => s.openid === openid)
  return sups.some(s => s.openid === openid && (!s.siteId || s.siteId === siteId))
}

async function getMemberByOpenid(openid) {
  const r = await db.collection('members').where({ openid }).limit(1).get()
  return r.data[0] || null
}

// ---------- 任务类型库（config key='taskTypes'，写法同 warehouseTree）----------
function _defaultTaskTypes() {
  return { types: [
    { id: _genId('tt_'), icon: '🛒', name: '采购补给' },
    { id: _genId('tt_'), icon: '🔨', name: '建设维修' },
    { id: _genId('tt_'), icon: '🧹', name: '清洁整理' },
    { id: _genId('tt_'), icon: '📸', name: '内容创作' },
    { id: _genId('tt_'), icon: '🌿', name: '接待向导' },
    { id: _genId('tt_'), icon: '⚙️', name: '其他' }
  ]}
}
async function getTaskTypes() {
  try { await db.createCollection('config') } catch (e) {}
  const r = await db.collection('config').where({ key: 'taskTypes' }).limit(1).get()
  if (r.data.length && r.data[0].value && Array.isArray(r.data[0].value.types)) {
    return { docId: r.data[0]._id, types: r.data[0].value.types }
  }
  const def = _defaultTaskTypes()
  const add = await db.collection('config').add({ data: { key: 'taskTypes', value: def } })
  return { docId: add._id, types: def.types }
}
// 确保类型名在库；不在就加一条，返回最终类型名
async function ensureTaskType(name, icon) {
  const clean = (name || '').trim()
  if (!clean) return '其他'
  const { docId, types } = await getTaskTypes()
  const hit = types.find(t => t.name === clean)
  if (hit) return hit.name
  const next = types.concat([{ id: _genId('tt_'), icon: icon || '📌', name: clean }])
  await db.collection('config').doc(docId).update({ data: { value: { types: next } } })
  return clean
}

// ---------- 经验结算 / 回收 ----------
// 按难度系数折算后平分给 owners，写 members（含 level），写 task_done 日志，标 xpSettled。幂等。
async function _settleAndAward(id, task) {
  if (task.xpSettled) return task.xpPerOwner || 0
  const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
  const totalXp = task.xp || 0
  // 平分保留 1 位小数（不再 floor 抹零头，与"XP 可带小数"一致）
  const xpPerOwner = owners.length > 0 ? roundXp(totalXp / owners.length) : 0

  await db.collection('tasks').doc(id).update({
    data: { xpPerOwner, xpSettled: true }
  })

  if (xpPerOwner > 0) {
    for (const ownerName of owners) {
      const mr = await db.collection('members').where({ name: ownerName }).limit(1).get()
      if (mr.data.length > 0) {
        const m = mr.data[0]
        const newXp = roundXp((m.xp || 0) + xpPerOwner)
        const newWeekXp = roundXp((m.weekXp || 0) + xpPerOwner)
        await db.collection('members').doc(m._id).update({
          data: { xp: newXp, weekXp: newWeekXp, level: calcLevel(newXp) }
        })
      }
    }
  }

  await db.collection('logs').add({
    data: {
      type: 'task_done',
      taskName: task.name,
      taskType: task.type || '',
      owner: owners.join('、'),
      xp: xpPerOwner,
      ownersCount: owners.length,
      totalXp,
      closedBy: task.closedBy || '',   // manager / auto，便于事后看把关情况
      createdAt: new Date()
    }
  })
  return xpPerOwner
}

// 打回时回收已发经验（防「关闭领分→打回→再关闭」刷分）
async function _clawbackXp(task) {
  if (!task.xpSettled) return
  const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
  const per = task.xpPerOwner || 0
  if (per > 0) {
    for (const ownerName of owners) {
      const mr = await db.collection('members').where({ name: ownerName }).limit(1).get()
      if (mr.data.length > 0) {
        const m = mr.data[0]
        const newXp = Math.max(0, roundXp((m.xp || 0) - per))
        const newWeekXp = Math.max(0, roundXp((m.weekXp || 0) - per))
        await db.collection('members').doc(m._id).update({
          data: { xp: newXp, weekXp: newWeekXp, level: calcLevel(newXp) }
        })
      }
    }
  }
  await db.collection('tasks').doc(task._id).update({ data: { xpSettled: false } })
}

exports.main = async (event) => {
  // 定时触发器：没有 action，event.Type === 'Timer'
  if (event && event.Type === 'Timer') {
    const closed = await autoCloseExpired()       // ① 待确认满1天自动关闭
    const logged = await generateDailyWorklogs()  // ② 生成「昨天」每人日报
    const digest = await generateDailyDigest()    // ③ 生成「昨天」全村总结(含AI一段话)
    return { success: true, autoClose: closed, worklog: logged, digest }
  }

  const { action, data = {} } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ============ 发起 ============
  if (action === 'addTask') {
    // 类型入库（带 typeName 才处理；AI 判出的新类型也在这落库）
    let finalTypeName = data.typeName || ''
    if (finalTypeName) {
      finalTypeName = await ensureTaskType(finalTypeName, data.typeIcon)
    }
    // 工时 + 强度（点过 AI 帮判则带值；否则留空，发布后 autoScore 回填）
    const hasPreset = (typeof data.hours === 'number' && data.hours > 0 &&
      [1, 2, 3, 4, 5].includes(data.intensity))
    const presetHours = hasPreset ? data.hours : null
    const presetIntensity = hasPreset ? data.intensity : null
    const presetXp = hasPreset ? calcXp(data.hours, data.intensity) : 0
    // 交付清单：[{text, done:false}]，建时即写好结构（避免 null→object 坑）
    let deliverables = []
    if (Array.isArray(data.deliverables)) {
      deliverables = data.deliverables
        .map(s => String(s || '').trim()).filter(Boolean).slice(0, 8)
        .map(text => ({ text, done: false }))
    }

    const result = await db.collection('tasks').add({
      data: {
        name: data.name,
        desc: data.desc || '',
        type: data.type,
        typeName: finalTypeName,
        taskKind: data.taskKind || 'oneoff',        // oneoff 一次性 / recurring 周期
        recurrence: data.recurrence || null,        // 仅 recurring 有；建时一次写好，不后补（避微信库 null→object 坑）
        deadline: data.deadline || '',              // 截止日期 'YYYY-MM-DD'，发布必填
        siteId: data.siteId || '',                  // 这单给哪个地方，发起时选
        status: 'open',
        hours: presetHours,                         // 预计工时(小时,可小数)；点AI帮判带值，否则null
        intensity: presetIntensity,                 // 强度档 1~5；同上
        xp: presetXp,                               // = 工时×强度系数；未帮判则0等发布后autoScore
        deliverables: deliverables,                 // 交付清单 [{text,done}]
        reviseLog: [],                              // 认领后改工时/强度的留痕 [{field,from,to,reason,operator,time}]
        publishTime: new Date(),
        publishOpenid: openid,
        publisherName: data.publisherName || '',
        owners: [],
        finishedBy: [],
        notes: [],
        reopenLog: [],
        xpPerOwner: 0,
        xpSettled: false,
        submittedAt: null,
        finishTime: null,                           // 保留原字段（兼容老前端）
        closeReason: null,                          // completed / cancelled / duplicate
        closedBy: null,                             // manager / auto
        closedAt: null,
        onholdBy: null,
        onholdAt: null,
        onholdNote: ''
      }
    })
    return { success: true, id: result._id, hasPreset }
  }

  // ============ 读取 ============
  if (action === 'getTasks') {
    const result = await db.collection('tasks')
      .orderBy('publishTime', 'desc')
      .limit(50)
      .get()
    return { success: true, list: result.data }
  }

  // 前端一次拿齐：地方列表 + 我管哪些地方 + 类型库
  if (action === 'getTaskMeta') {
    let sites = []
    const treeRes = await db.collection('config').where({ key: 'warehouseTree' }).limit(1).get()
    if (treeRes.data[0] && treeRes.data[0].value && Array.isArray(treeRes.data[0].value.sites)) {
      sites = treeRes.data[0].value.sites.map(s => ({ id: s.id, name: s.name }))
    }
    const roles = await getRoles()
    const myManagedSiteIds = (roles.supervisors || [])
      .filter(s => s.openid === openid).map(s => s.siteId || '')
    const isGlobalSupervisor = myManagedSiteIds.includes('')
    const { types } = await getTaskTypes()
    return { success: true, sites, myManagedSiteIds, isGlobalSupervisor, taskTypes: types }
  }

  // 用户在前端手动新增类型
  if (action === 'addTaskType') {
    const name = await ensureTaskType(data.name, data.icon)
    const { types } = await getTaskTypes()
    return { success: true, name, taskTypes: types }
  }

  // 看「我的」日报：最近 N 天的日报 + 有效工作日统计（本周/本月绝对数）
  if (action === 'getMyWorklog') {
    const name = ((data && data.name) || '').trim()
    if (!name) return { success: true, days: [], stat: { weekValid: 0, monthValid: 0 } }
    const days = await _fetchWorklogs({ name, limit: data.limit || 30 })
    const stat = await _validDayStat(name)
    return { success: true, days, stat }
  }

  // 看「全村」日报概览：每人最近的有效工作日统计（公开）
  if (action === 'getVillageWorklog') {
    const membersRes = await db.collection('members')
      .where({ status: _.neq('left') }).limit(200).get()
    const out = []
    for (const m of membersRes.data) {
      if (!m.name) continue
      const stat = await _validDayStat(m.name)
      out.push({ name: m.name, icon: m.icon || '🌿', weekValid: stat.weekValid, monthValid: stat.monthValid })
    }
    out.sort((a, b) => b.weekValid - a.weekValid)
    return { success: true, list: out }
  }

  // 手动触发跑批（测试用；正式靠凌晨定时）。可传 date='YYYY-MM-DD' 补某天，默认昨天
  if (action === 'genWorklogNow') {
    const res = await generateDailyWorklogs(data && data.date)
    return res
  }

  // 手动生成某天全村总结（测试用）。默认昨天
  if (action === 'genDigestNow') {
    const res = await generateDailyDigest(data && data.date)
    return res
  }

  // 读取最近的全村昨日总结（总览页卡片用）
  if (action === 'getLatestDigest') {
    const r = await db.collection('worklogs')
      .where({ kind: 'digest' })
      .orderBy('date', 'desc')
      .limit(1).get()
    if (!r.data.length) return { success: true, digest: null }
    const d = r.data[0]
    return { success: true, digest: {
      date: d.date,
      summary: d.summary || '',
      validPeople: d.validPeople || 0,
      taskCount: d.taskCount || 0,
      details: d.details || []   // [{name, tasks:[...]}]
    }}
  }

  // 按区间取全村各人日报（喂 AI 写人员工作周报用）。range: lastWeek(上周完整) / thisWeek(本周至今)
  if (action === 'getStaffWorklogRange') {
    const range = (data && data.range) || 'lastWeek'
    const { fromStr, toStr } = _weekRangeStr(range)
    const r = await db.collection('worklogs')
      .where({ date: _.gte(fromStr).and(_.lte(toStr)) })
      .limit(500).get()
    // 按人聚合
    const byName = {}
    for (const w of r.data) {
      if (!byName[w.name]) byName[w.name] = { name: w.name, validDays: 0, completedTasks: [], noteCount: 0 }
      if (w.isValidWorkday) byName[w.name].validDays++
      for (const c of (w.completed || [])) byName[w.name].completedTasks.push(c.name)
      byName[w.name].noteCount += (w.notes || []).length
    }
    const people = Object.keys(byName).map(k => byName[k])
      .sort((a, b) => b.validDays - a.validDays)
    return { success: true, fromStr, toStr, people }
  }

  // 日程页用：查某天「在区间内(发起日≤date≤deadline)且未完成」的任务，带紧迫度
  if (action === 'getTasksForDate') {
    const date = (data && data.date || '').trim()   // 'YYYY-MM-DD'
    if (!date) return { success: true, list: [] }
    // 未关闭 + 有 deadline 的任务（老任务无 deadline 不进日程）
    const r = await db.collection('tasks')
      .where({ status: _.neq('closed'), deadline: _.neq('') })
      .limit(200).get()
    const list = []
    for (const t of r.data) {
      const dl = t.deadline || ''
      if (!dl) continue
      const startDay = _bjDateStr(t.publishTime)   // 发起日（北京）
      // 区间判断：startDay <= date <= deadline
      if (date < startDay || date > dl) continue
      // 紧迫度：按 date 到 deadline 还差几天
      const daysLeft = _daysBetween(date, dl)
      let urgency = 'far'           // 还早
      if (daysLeft <= 0) urgency = 'due'        // 今天/已过期(今天到期也算紧)
      else if (daysLeft <= 1) urgency = 'soon'  // 剩1天
      const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
      list.push({
        _id: t._id, name: t.name, typeName: t.typeName || '',
        status: t.status, deadline: dl, startDay,
        ownersText: owners.join('、'), ownerCount: owners.length,
        daysLeft, urgency
      })
    }
    // 排序：紧的在前（due > soon > far），同档按 deadline 早的在前
    const rank = { due: 0, soon: 1, far: 2 }
    list.sort((a, b) => (rank[a.urgency] - rank[b.urgency]) || (a.deadline < b.deadline ? -1 : 1))
    return { success: true, list }
  }

  // 返回里带 myTaskState 供前端分组：doing(我还没报完成) / waitConfirm(我报了等主管确认) / onhold(搁置)
  if (action === 'getMyOpenTasks') {
    const name = ((data && data.name) || '').trim()
    if (!name) return { success: true, list: [] }
    const result = await db.collection('tasks')
      .where({ status: _.neq('closed') })
      .orderBy('publishTime', 'desc')
      .limit(100)
      .get()
    const list = result.data.filter(t => {
      const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
      return owners.includes(name)   // 凡是我认领的、没关闭的，都算我的待办
    }).map(t => {
      const finishedBy = Array.isArray(t.finishedBy) ? t.finishedBy : []
      let myTaskState = 'doing'
      if (t.status === 'onhold') myTaskState = 'onhold'
      else if (t.status === 'submitted') myTaskState = 'waitConfirm'
      else if (finishedBy.includes(name)) myTaskState = 'waitConfirm' // 我报了但还有人没报
      return Object.assign({}, t, { myTaskState })
    })
    return { success: true, list }
  }

  // ============ 打卡 ============
  // 打卡某一天（确认那天的工作/出勤）。当天为该头衔的排期日 → 发这次头衔XP（幂等）。
  if (action === 'checkIn') {
    const me = await getMemberByOpenid(openid)
    const name = (me && me.name) || ''
    if (!name) return { success: false, msg: '请先加入村落' }
    const date = (data && data.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, msg: '日期格式不对' }
    const today = _bjDateStr(new Date())
    if (date > today) return { success: false, msg: '不能打卡未来的日期' }

    const docId = 'wl_' + encodeURIComponent(name) + '_' + date
    let prior = {}
    try { const ex = await db.collection('worklogs').doc(docId).get(); prior = ex.data || {} } catch (e) { prior = {} }
    let completed = Array.isArray(prior.completed) ? prior.completed : null
    if (!completed) completed = await _completedForNameDate(name, date)

    // 头衔 occurrence 结算：当天是排期日、且该头衔本人本天还没发过 → 发一次
    const titles = await _heldTitlesByName(name)
    const awarded = Array.isArray(prior.titleAwarded) ? prior.titleAwarded.slice() : []
    const awardedIds = new Set(awarded.map(a => a.titleId))
    let newXp = 0
    for (const t of titles) {
      if (awardedIds.has(t.id)) continue
      if (!_isTitleOccurrence(t, date)) continue
      const xp = _titleOccXp(t)
      if (xp <= 0) continue
      awarded.push({ titleId: t.id, name: t.name, xp })
      awardedIds.add(t.id)
      newXp = roundXp(newXp + xp)
    }
    if (newXp > 0) await _addXpToMember(name, newXp)

    const doc = {
      name, date, completed,
      notes: prior.notes || [],
      isValidWorkday: true,                 // 打卡即算有效工作日
      checkedIn: true,
      // 头衔清单勾选留痕（路A：只记不算钱，XP 仍按头衔整份发）
      titleChecklist: prior.titleChecklist || {},
      checkedInAt: prior.checkedInAt || new Date(),
      titleAwarded: awarded,
      titleXpAwarded: roundXp((prior.titleXpAwarded || 0) + newXp),
      aiSummary: prior.aiSummary || null,
      createdAt: prior.createdAt || new Date()
    }
    try { await db.collection('worklogs').doc(docId).set({ data: doc }) }
    catch (e) { try { await db.collection('worklogs').doc(docId).remove() } catch (e2) {}; await db.collection('worklogs').add({ data: Object.assign({ _id: docId }, doc) }) }
    return { success: true, date, awardedXp: newXp }
  }

  // 打卡页数据：最近 n 天，每天的完成任务 + 当天到期的头衔日常 + 是否已打卡 + 漏打标记
  if (action === 'getCheckinView') {
    const me = await getMemberByOpenid(openid)
    const name = (me && me.name) || ((data && data.name) || '')
    if (!name) return { success: true, name: '', today: _bjDateStr(new Date()), days: [] }
    const n = Math.min(14, Math.max(3, (data && data.days) || 7))
    const dates = _recentBjDates(n)            // 最新在前
    const oldest = dates[dates.length - 1]
    const today = _bjDateStr(new Date())

    // 一次查窗口内本人完成的任务，按北京日分桶
    const { start } = _bjDayRange(oldest)
    const { end } = _bjDayRange(today)
    const tr = await db.collection('tasks').where({ submittedAt: _.gte(start).and(_.lt(end)) }).get()
    const compByDate = {}
    for (const t of tr.data) {
      const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
      if (!owners.includes(name)) continue
      const d = _bjDateStr(t.submittedAt)
      if (!compByDate[d]) compByDate[d] = []
      compByDate[d].push({ name: t.name, status: t.status })
    }
    const titles = await _heldTitlesByName(name)
    const wls = {}
    const wr = await db.collection('worklogs').where({ name, date: _.gte(oldest).and(_.lte(today)) }).limit(60).get().catch(() => ({ data: [] }))
    for (const w of wr.data) wls[w.date] = w

    const days = dates.map(d => {
      const wl = wls[d] || {}
      const completed = compByDate[d] || (wl.completed || []).map(c => ({ name: c.name, status: 'closed' }))
      const ckMap = wl.titleChecklist || {}
      const duties = titles.filter(t => _isTitleOccurrence(t, d) && _titleOccXp(t) > 0)
        .map(t => {
          const cl = Array.isArray(t.checklist) ? t.checklist : []
          const done = ckMap[t.id] || []
          return {
            titleId: t.id, titleName: t.name, xp: _titleOccXp(t),
            checklistTotal: cl.length,
            checklistDone: cl.filter(c => done.indexOf(c.id) >= 0).length
          }
        })
      const checkedIn = !!wl.checkedIn
      return {
        date: d, isToday: d === today, checkedIn,
        missed: !checkedIn && d < today,
        completed, completedCount: completed.length,
        duties, dutyXp: duties.reduce((s, x) => roundXp(s + x.xp), 0)
      }
    })
    return { success: true, name, today, days }
  }

  // 今日头衔待办：所持头衔中今天到期的，逐条列出清单项 + 是否已勾（我的主页用）
  if (action === 'getMyTitleDuties') {
    const me = await getMemberByOpenid(openid)
    const name = (me && me.name) || ((data && data.name) || '')
    if (!name) return { success: true, name: '', date: _bjDateStr(new Date()), duties: [] }
    const date = (data && data.date) || _bjDateStr(new Date())

    const titles = await _heldTitlesByName(name)
    const docId = 'wl_' + encodeURIComponent(name) + '_' + date
    let wl = {}
    try { const ex = await db.collection('worklogs').doc(docId).get(); wl = ex.data || {} } catch (e) { wl = {} }
    const ckMap = wl.titleChecklist || {}

    const duties = titles
      .filter(t => _isTitleOccurrence(t, date))
      .map(t => {
        const cl = Array.isArray(t.checklist) ? t.checklist : []
        const done = ckMap[t.id] || []
        return {
          titleId: t.id,
          titleName: t.name,
          dutyNote: t.dutyNote || '',
          xp: _titleOccXp(t),
          items: cl.map(c => ({ id: c.id, text: c.text, checked: done.indexOf(c.id) >= 0 })),
          doneCount: cl.filter(c => done.indexOf(c.id) >= 0).length,
          totalCount: cl.length
        }
      })
    return { success: true, name, date, duties, checkedIn: !!wl.checkedIn }
  }

  // 勾/取消勾一条头衔清单项（路A：只留痕，不动 XP）
  if (action === 'toggleTitleChecklistItem') {
    const me = await getMemberByOpenid(openid)
    const name = (me && me.name) || ''
    if (!name) return { success: false, msg: '请先加入村落' }
    const date = (data && data.date) || _bjDateStr(new Date())
    const today = _bjDateStr(new Date())
    if (date > today) return { success: false, msg: '不能勾未来的日期' }
    const { titleId, itemId, checked } = data || {}
    if (!titleId || !itemId) return { success: false, msg: '参数不全' }

    const docId = 'wl_' + encodeURIComponent(name) + '_' + date
    let prior = {}
    try { const ex = await db.collection('worklogs').doc(docId).get(); prior = ex.data || {} } catch (e) { prior = {} }

    const ckMap = Object.assign({}, prior.titleChecklist || {})
    const arr = Array.isArray(ckMap[titleId]) ? ckMap[titleId].slice() : []
    const idx = arr.indexOf(itemId)
    if (checked && idx < 0) arr.push(itemId)
    if (!checked && idx >= 0) arr.splice(idx, 1)
    ckMap[titleId] = arr

    if (prior && prior._id) {
      await db.collection('worklogs').doc(docId).update({ data: { titleChecklist: ckMap } })
    } else {
      // 当天还没有日报：建一条（不动 isValidWorkday —— 勾清单不等于出勤，出勤仍看打卡/完成任务）
      const doc = {
        name, date,
        completed: prior.completed || [],
        notes: prior.notes || [],
        isValidWorkday: !!prior.isValidWorkday,
        checkedIn: !!prior.checkedIn,
        checkedInAt: prior.checkedInAt || null,
        titleAwarded: prior.titleAwarded || [],
        titleXpAwarded: prior.titleXpAwarded || 0,
        titleChecklist: ckMap,
        aiSummary: prior.aiSummary || null,
        createdAt: prior.createdAt || new Date()
      }
      try { await db.collection('worklogs').doc(docId).set({ data: doc }) }
      catch (e) { await db.collection('worklogs').add({ data: Object.assign({ _id: docId }, doc) }) }
    }
    return { success: true, done: arr.length }
  }

  // ============ 认领 / 取消认领 ============
  if (action === 'claimTask') {
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '请先加入村落' }
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status === 'closed') return { success: false, msg: '任务已关闭，无法认领' }
    const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
    if (owners.includes(name)) return { success: false, msg: '你已认领该任务' }
    owners.push(name)
    await db.collection('tasks').doc(data.id).update({
      data: { owners, status: 'doing' }
    })
    return { success: true }
  }

  if (action === 'unclaimTask') {
    const name = (data.name || '').trim()
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status === 'closed') return { success: false, msg: '任务已关闭，无法取消认领' }
    if (task.status === 'submitted') return { success: false, msg: '已提交待确认，无法取消认领' }
    let owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
    let finishedBy = Array.isArray(task.finishedBy) ? task.finishedBy : []
    if (!owners.includes(name)) return { success: false, msg: '你不在认领人中' }
    if (finishedBy.includes(name)) return { success: false, msg: '已标记完成，无法取消认领' }
    owners = owners.filter(n => n !== name)

    // 取消后剩下的人恰好都已完成 → 转待确认（不再直接结算）
    if (owners.length > 0 && finishedBy.length === owners.length) {
      await db.collection('tasks').doc(data.id).update({
        data: { owners, finishedBy, status: 'submitted', submittedAt: new Date() }
      })
      return { success: true, submitted: true }
    }

    const newStatus = owners.length === 0 ? 'open' : 'doing'
    await db.collection('tasks').doc(data.id).update({
      data: { owners, finishedBy, status: newStatus }
    })
    return { success: true }
  }

  // ============ 报完成（→ submitted，不结算）============
  if (action === 'finishTask') {
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '请先加入村落' }
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status === 'closed') return { success: false, msg: '任务已关闭' }
    if (task.status === 'submitted') return { success: false, msg: '已提交，等主管确认' }
    if (task.status === 'onhold') return { success: false, msg: '任务搁置中，请先解除' }
    const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
    let finishedBy = Array.isArray(task.finishedBy) ? task.finishedBy : []
    if (!owners.includes(name)) return { success: false, msg: '只有认领人可标记完成' }
    if (finishedBy.includes(name)) return { success: false, msg: '你已提交，等其他人完成' }
    finishedBy = [...finishedBy, name]

    // 全员点齐 → 转待确认（注意：不发经验、不 closed）
    if (finishedBy.length === owners.length) {
      await db.collection('tasks').doc(data.id).update({
        data: { finishedBy, status: 'submitted', submittedAt: new Date() }
      })
      return { success: true, allDone: true, submitted: true }
    }

    await db.collection('tasks').doc(data.id).update({ data: { finishedBy } })
    return { success: true, allDone: false, finishedBy }
  }

  // ============ 搁置 / 解除搁置 ============
  if (action === 'holdTask') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    const me = await getMemberByOpenid(openid)
    const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
    if (!me || !owners.includes(me.name)) return { success: false, msg: '只有认领人能搁置' }
    if (task.status !== 'doing') return { success: false, msg: '只有进行中的任务能搁置' }
    await db.collection('tasks').doc(data.id).update({
      data: { status: 'onhold', onholdBy: me.name, onholdAt: new Date(), onholdNote: (data.note || '') }
    })
    return { success: true }
  }

  if (action === 'unholdTask') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status !== 'onhold') return { success: false, msg: '任务未处于搁置' }
    if (!(await isSiteSupervisor(openid, task.siteId))) return { success: false, msg: '只有该地方主管能解除搁置' }
    await db.collection('tasks').doc(data.id).update({
      data: { status: 'doing', onholdBy: null, onholdAt: null, onholdNote: '' }
    })
    return { success: true }
  }

  // ============ 主管确认完成（→ closed/completed/manager + 结算）============
  if (action === 'confirmTask') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status !== 'submitted') return { success: false, msg: '只有待确认的任务能确认' }
    if (!(await isSiteSupervisor(openid, task.siteId))) return { success: false, msg: '只有该地方主管能确认' }
    const me = await getMemberByOpenid(openid)

    const patch = {
      status: 'closed', closeReason: 'completed', closedBy: 'manager',
      closedAt: new Date(), finishTime: new Date(),
      confirmerName: me ? me.name : '', confirmerOpenid: openid
    }
    await db.collection('tasks').doc(data.id).update({ data: patch })

    const fresh = (await db.collection('tasks').doc(data.id).get()).data
    const xpPerOwner = await _settleAndAward(data.id, fresh)
    return { success: true, xpPerOwner }
  }

  // ============ 打回（→ doing，回收经验，清完成标记）============
  if (action === 'reopenTask') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    const reopenable = task.status === 'submitted' ||
      (task.status === 'closed' && task.closeReason === 'completed')
    if (!reopenable) return { success: false, msg: '当前状态不能打回' }
    if (!(await isSiteSupervisor(openid, task.siteId))) return { success: false, msg: '只有该地方主管能打回' }
    const me = await getMemberByOpenid(openid)

    await _clawbackXp(task)   // 已发经验先收回

    await db.collection('tasks').doc(data.id).update({
      data: {
        status: 'doing',
        closeReason: null, closedBy: null, closedAt: null, finishTime: null,
        finishedBy: [], submittedAt: null,
        reopenLog: _.push([{
          at: new Date(), by: me ? me.name : '', openid,
          fromStatus: task.status, note: (data.note || '')
        }])
      }
    })
    return { success: true }
  }

  // ============ 取消 / 重复关闭（不发经验）============
  if (action === 'closeTask') {
    const reason = data.reason
    if (!['cancelled', 'duplicate'].includes(reason)) return { success: false, msg: '关闭原因非法' }
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status === 'closed') return { success: false, msg: '任务已关闭' }
    if (!(await isSiteSupervisor(openid, task.siteId))) return { success: false, msg: '只有该地方主管能关闭' }
    const me = await getMemberByOpenid(openid)
    await db.collection('tasks').doc(data.id).update({
      data: {
        status: 'closed', closeReason: reason, closedBy: 'manager',
        closedAt: new Date(),
        confirmerName: me ? me.name : '', confirmerOpenid: openid
      }
    })
    return { success: true }
  }

  // ============ 备注 ============
  if (action === 'addTaskNote') {
    const name = (data.name || '').trim()
    const text = (data.text || '').trim()
    if (!name) return { success: false, msg: '请先加入村落' }
    if (!text) return { success: false, msg: '备注不能为空' }
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    const notes = Array.isArray(task.notes) ? task.notes : []
    notes.push({ name, text, createdAt: new Date() })
    await db.collection('tasks').doc(data.id).update({ data: { notes } })
    return { success: true }
  }

  if (action === 'updateXp') {
    await db.collection('tasks').doc(data.id).update({ data: { xp: data.xp } })
    return { success: true }
  }

  // ============ 改工时 / 强度 → 重算 XP ============
  // 认领前(open)：发布人或该地方主管可改，不留痕。
  // 认领后(doing/onhold/submitted)：仅该地方主管，必填 reason，写 reviseLog。
  // 已关闭(closed)：不许直接改（可能已结算），需先打回重做。
  if (action === 'reviseHours') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (!task) return { success: false, msg: '任务不存在' }
    if (task.status === 'closed') return { success: false, msg: '任务已关闭，如需改请先「打回重做」' }

    const hours = Number(data.hours)
    const intensity = parseInt(data.intensity)
    if (!(hours > 0)) return { success: false, msg: '工时需大于 0' }
    if (![1, 2, 3, 4, 5].includes(intensity)) return { success: false, msg: '强度档非法（1~5）' }

    const me = await getMemberByOpenid(openid)
    const isPublisher = task.publishOpenid === openid
    const isMgr = await isSiteSupervisor(openid, task.siteId)
    const beforeClaim = task.status === 'open'

    if (beforeClaim) {
      if (!isPublisher && !isMgr) return { success: false, msg: '只有发布者或该地方主管能改' }
    } else {
      if (!isMgr) return { success: false, msg: '认领后只有该地方主管能改工时/强度' }
      if (!((data.reason || '').trim())) return { success: false, msg: '认领后修改必须填写原因' }
    }

    const newXp = calcXp(hours, intensity)
    const patch = { hours, intensity, xp: newXp }

    // 认领后留痕：逐字段记录 from→to。绕开 _.push（老任务可能无 reviseLog 数组），读出后整体写回。
    if (!beforeClaim) {
      const reason = (data.reason || '').trim()
      const op = me ? me.name : ''
      const now = new Date()
      const entries = []
      const oldHours = (task.hours == null) ? '' : task.hours
      const oldInt = (task.intensity == null) ? '' : task.intensity
      if (oldHours !== hours) entries.push({ field: 'hours', from: oldHours, to: hours, reason, operator: op, time: now })
      if (oldInt !== intensity) entries.push({ field: 'intensity', from: oldInt, to: intensity, reason, operator: op, time: now })
      if (entries.length) {
        const existing = Array.isArray(task.reviseLog) ? task.reviseLog : []
        patch.reviseLog = existing.concat(entries)
      }
    }

    await db.collection('tasks').doc(data.id).update({ data: patch })
    return { success: true, xp: newXp, hours, intensity }
  }

  // 设难度（仅展示标签）。source=ai 不校验；source=manager 要该地方主管
  if (action === 'setDifficulty') {
    const src = data.source === 'ai' ? 'ai' : 'manager'
    if (src === 'manager') {
      const taskDoc = await db.collection('tasks').doc(data.id).get()
      if (!(await isSiteSupervisor(openid, taskDoc.data.siteId))) return { success: false, msg: '只有该地方主管能改难度' }
    }
    if (!DIFF_TAGS.includes(data.difficulty)) return { success: false, msg: '难度值非法' }
    await db.collection('tasks').doc(data.id).update({
      data: { difficulty: data.difficulty, difficultySource: src }
    })
    return { success: true }
  }

  // 改交付清单（仅认领前：open 状态；发布者或该地方主管可改）
  if (action === 'updateDeliverables') {
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    if (task.status !== 'open') return { success: false, msg: '已有人认领，交付清单锁定' }
    const isPublisher = task.publishOpenid === openid
    const isMgr = await isSiteSupervisor(openid, task.siteId)
    if (!isPublisher && !isMgr) return { success: false, msg: '只有发布者或该地方主管能改清单' }
    let items = []
    if (Array.isArray(data.deliverables)) {
      items = data.deliverables.map(s => String(s || '').trim()).filter(Boolean).slice(0, 8)
        .map(text => ({ text, done: false }))
    }
    await db.collection('tasks').doc(data.id).update({ data: { deliverables: items } })
    return { success: true }
  }

  // 勾选/取消勾选交付清单某条（仅认领人；按 index）
  if (action === 'toggleDeliverable') {
    const name = (data.name || '').trim()
    const taskDoc = await db.collection('tasks').doc(data.id).get()
    const task = taskDoc.data
    const owners = Array.isArray(task.owners) ? task.owners : (task.owner ? [task.owner] : [])
    if (!name || !owners.includes(name)) return { success: false, msg: '只有认领人能勾选' }
    const items = Array.isArray(task.deliverables) ? task.deliverables.slice() : []
    const i = data.index
    if (i < 0 || i >= items.length) return { success: false, msg: '清单项不存在' }
    items[i] = { text: items[i].text, done: !items[i].done }
    await db.collection('tasks').doc(data.id).update({ data: { deliverables: items } })
    return { success: true, deliverables: items }
  }

  if (action === 'deleteTask') {
    await db.collection('tasks').doc(data.id).remove()
    return { success: true }
  }

  // 一次性迁移：老的 status='done' 刷成新枚举 closed/completed/manager
  // 部署后在控制台手动调一次即可（幂等，可重复调）
  if (action === 'migrateDoneTasks') {
    const res = await db.collection('tasks').where({ status: 'done' }).limit(500).get()
    let n = 0
    for (const t of res.data) {
      await db.collection('tasks').doc(t._id).update({
        data: {
          status: 'closed',
          closeReason: 'completed',
          closedBy: 'manager',
          closedAt: t.finishTime || new Date(),
          xpSettled: true   // 老任务当时已发过经验，标记已结算，避免被再次结算
        }
      })
      n++
    }
    return { success: true, migrated: n }
  }

  if (action === 'createCollections') {
    for (const c of ['tasks','resources','transactions','logs','worklogs']) {
      try { await db.createCollection(c) } catch(e) {}
    }
    return { success: true, msg: '集合创建完成' }
  }

  // ============ 一次性：切换评分量纲时清空老任务 + 全员经验归零 ============
  // 控制台手动调：{ action:'resetTasksAndXp', data:{ confirm:'RESET' } }
  // 只删 tasks、清 members 的 xp/weekXp/level；不碰金库/出资/股东/物资/成就。
  // 想连历史日报一起清，再带 data:{ confirm:'RESET', alsoWorklogs:true }
  if (action === 'resetTasksAndXp') {
    if (data.confirm !== 'RESET') return { success: false, msg: '需传 data.confirm="RESET" 才执行' }
    // 删所有任务（分批，直到取空）
    let deletedTasks = 0
    while (true) {
      const r = await db.collection('tasks').limit(100).get()
      if (!r.data.length) break
      for (const t of r.data) { await db.collection('tasks').doc(t._id).remove(); deletedTasks++ }
    }
    // 全员经验归零
    let resetMembers = 0
    const ms = await db.collection('members').limit(1000).get()
    for (const m of ms.data) {
      await db.collection('members').doc(m._id).update({
        data: { xp: 0, weekXp: 0, level: calcLevel(0) }
      })
      resetMembers++
    }
    // 可选：连历史日报/全村小结一起清
    let deletedWorklogs = 0
    if (data.alsoWorklogs) {
      while (true) {
        const r = await db.collection('worklogs').limit(100).get().catch(() => ({ data: [] }))
        if (!r.data.length) break
        for (const w of r.data) { await db.collection('worklogs').doc(w._id).remove(); deletedWorklogs++ }
      }
    }
    return { success: true, deletedTasks, resetMembers, deletedWorklogs }
  }

  if (action === 'clearAllData') {
    const collections = ['tasks', 'resources', 'transactions', 'logs', 'members', 'achievements']
    for (const col of collections) {
      try {
        const res = await db.collection(col).limit(100).get()
        for (const item of res.data) {
          await db.collection(col).doc(item._id).remove()
        }
      } catch(e) {}
    }
    return { success: true, msg: '清理完成' }
  }

  return { success: false, msg: 'unknown action' }
}

// ============ 定时：把 submitted 满 1 天的自动 closed(completed, auto) 并结算 ============
async function autoCloseExpired() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const r = await db.collection('tasks').where({
    status: 'submitted', submittedAt: _.lt(cutoff)
  }).get()
  let n = 0
  for (const task of r.data) {
    await db.collection('tasks').doc(task._id).update({
      data: { status: 'closed', closeReason: 'completed', closedBy: 'auto', closedAt: new Date(), finishTime: new Date() }
    })
    const fresh = (await db.collection('tasks').doc(task._id).get()).data
    await _settleAndAward(task._id, fresh)
    n++
  }
  return { success: true, autoClosed: n }
}

// ============ 日报（worklog）============
// 注：微信云函数默认时区是 UTC，营地在 UTC+8。下面用「+8 偏移」把时间归到北京自然日。
const TZ_OFFSET = 8 * 60 * 60 * 1000

// 把某时刻归到北京自然日的字符串 'YYYY-MM-DD'
function _bjDateStr(d) {
  const t = new Date(new Date(d).getTime() + TZ_OFFSET)
  const y = t.getUTCFullYear()
  const m = String(t.getUTCMonth() + 1).padStart(2, '0')
  const day = String(t.getUTCDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}
// 北京「某自然日」的 UTC 起止时刻 [start,end)
function _bjDayRange(dateStr) {
  // dateStr 当作北京日 00:00 → 对应 UTC = 北京时刻 - 8h
  const start = new Date(new Date(dateStr + 'T00:00:00.000Z').getTime() - TZ_OFFSET)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}
// 昨天（北京）的日期串
function _yesterdayBjStr() {
  return _bjDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000))
}

// 两个 'YYYY-MM-DD' 相差天数：to - from（正=to在后）
function _daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00.000Z').getTime()
  const b = new Date(toStr + 'T00:00:00.000Z').getTime()
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

// 周区间（北京）。range='lastWeek' 上一个完整周一~周日；'thisWeek' 本周一~今天
// 返回 { fromStr, toStr }
function _weekRangeStr(range) {
  const nowBj = new Date(Date.now() + TZ_OFFSET)   // 当作"北京此刻"的UTC视图
  // getUTCDay: 0=周日,1=周一...6=周六。换算成「周一=0」的偏移
  const dow = (nowBj.getUTCDay() + 6) % 7          // 周一→0, 周日→6
  // 本周一（北京）
  const thisMonday = new Date(nowBj.getTime() - dow * 24 * 60 * 60 * 1000)
  const fmt = (d) => {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return y + '-' + m + '-' + day
  }
  if (range === 'thisWeek') {
    return { fromStr: fmt(thisMonday), toStr: _bjDateStr(new Date()) }
  }
  // lastWeek：上周一 ~ 上周日
  const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
  const lastSunday = new Date(thisMonday.getTime() - 1 * 24 * 60 * 60 * 1000)
  return { fromStr: fmt(lastMonday), toStr: fmt(lastSunday) }
}

// 生成某一天（默认昨天）每人的 worklog。幂等：同一人同一天用 _id 覆盖式写。
async function generateDailyWorklogs(dateStr) {
  const day = dateStr || _yesterdayBjStr()
  const { start, end } = _bjDayRange(day)

  // 当天「完成」的任务：按 submittedAt 落在这一天归集（他哪天干完算哪天，不看确认时间）
  const completedRes = await db.collection('tasks').where({
    submittedAt: _.gte(start).and(_.lt(end))
  }).get()
  // 当天「认领」「留备注」不易精确取（认领无时间戳、备注有 createdAt），
  // 这一版以「完成」为主线（它决定有效工作日），认领/备注作为补充从备注时间取。
  const noteRes = await db.collection('tasks').where({
    'notes.createdAt': _.gte(start).and(_.lt(end))
  }).get().catch(() => ({ data: [] }))

  // 汇总到 perPerson: { name: { completed:[], notes:[] } }
  const per = {}
  const ensure = (nm) => { if (!per[nm]) per[nm] = { completed: [], notes: [] } }

  for (const t of completedRes.data) {
    const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
    for (const nm of owners) {
      ensure(nm)
      per[nm].completed.push({ taskId: t._id, name: t.name, xp: t.xpPerOwner || 0 })
    }
  }
  for (const t of noteRes.data) {
    const notes = Array.isArray(t.notes) ? t.notes : []
    for (const n of notes) {
      if (n.createdAt && new Date(n.createdAt) >= start && new Date(n.createdAt) < end) {
        ensure(n.name)
        per[n.name].notes.push({ taskId: t._id, taskName: t.name, text: n.text })
      }
    }
  }

  // 写库：只给「当天有动静」的人写。_id = worklog_名字_日期（幂等覆盖）
  // 注意：头衔XP不在这里发了——改由「打卡」按排期触发（见 checkIn）。这里只保留已打卡/已发记录不被覆盖。
  let count = 0
  for (const nm of Object.keys(per)) {
    const docId = 'wl_' + encodeURIComponent(nm) + '_' + day
    // 读旧记录，保留 checkedIn / 已发头衔（避免重生成时被清掉）
    let prior = {}
    try { const ex = await db.collection('worklogs').doc(docId).get(); prior = ex.data || {} } catch (e) { prior = {} }
    const checkedIn = !!prior.checkedIn
    const isValid = per[nm].completed.length > 0 || checkedIn   // 完成任务 或 打卡 都算有效工作日

    const doc = {
      name: nm, date: day,
      completed: per[nm].completed,
      notes: per[nm].notes,
      isValidWorkday: isValid,
      checkedIn,                                   // 是否已打卡确认
      checkedInAt: prior.checkedInAt || null,
      titleAwarded: prior.titleAwarded || [],      // 已发的头衔occurrence [{titleId,xp}]
      titleXpAwarded: prior.titleXpAwarded || 0,   // 已发头衔XP合计（幂等基准）
      aiSummary: prior.aiSummary || null,
      createdAt: prior.createdAt || new Date()
    }
    try {
      await db.collection('worklogs').doc(docId).set({ data: doc })
    } catch (e) {
      try { await db.collection('worklogs').doc(docId).remove() } catch (e2) {}
      await db.collection('worklogs').add({ data: Object.assign({ _id: docId }, doc) })
    }
    count++
  }
  return { success: true, date: day, people: count }
}

// 给某人按名字加（或减）经验，含等级重算、小数收口
async function _addXpToMember(name, delta) {
  if (!name || !delta) return
  const mr = await db.collection('members').where({ name }).limit(1).get()
  if (!mr.data.length) return
  const m = mr.data[0]
  const newXp = Math.max(0, roundXp((m.xp || 0) + delta))
  const newWeekXp = Math.max(0, roundXp((m.weekXp || 0) + delta))
  await db.collection('members').doc(m._id).update({
    data: { xp: newXp, weekXp: newWeekXp, level: calcLevel(newXp) }
  })
}

// 某个北京自然日(YYYY-MM-DD)是不是某头衔的排期日
function _isTitleOccurrence(t, dateStr) {
  const st = t.schedType || 'daily'
  if (st === 'daily') return true
  const parts = String(dateStr).split('-')
  const Y = parseInt(parts[0]), M = parseInt(parts[1]), D = parseInt(parts[2])
  if (st === 'weekly') {
    const wd = new Date(Date.UTC(Y, M - 1, D)).getUTCDay()   // 0=周日..6=周六
    const iso = wd === 0 ? 7 : wd                            // 1=周一..7=周日
    return (t.schedWeekdays || []).includes(iso)
  }
  if (st === 'monthly') return (t.schedDays || []).includes(D)
  return false
}

// 本人持有的头衔（按 titleId 去重），返回 titleType 完整对象
async function _heldTitlesByName(name) {
  const roles = await getRoles()
  const types = roles.titleTypes || []
  const holders = roles.titleHolders || []
  const byId = {}; types.forEach(t => { byId[t.id] = t })
  const seen = {}; const out = []
  for (const h of holders) {
    if (h.name !== name || seen[h.titleId]) continue
    seen[h.titleId] = true
    if (byId[h.titleId]) out.push(byId[h.titleId])
  }
  return out
}
// 头衔「一次」的XP（填了工时+强度才有）
function _titleOccXp(t) {
  return (Number(t.hours) > 0 && [1, 2, 3, 4, 5].includes(t.intensity)) ? calcXp(t.hours, t.intensity) : 0
}
// 最近 n 个北京自然日，最新在前
function _recentBjDates(n) {
  const out = []
  for (let i = 0; i < n; i++) out.push(_bjDateStr(new Date(Date.now() - i * 24 * 60 * 60 * 1000)))
  return out
}
// 某人某北京日完成的任务（用于补算 worklog 缺失时）
async function _completedForNameDate(name, dateStr) {
  const { start, end } = _bjDayRange(dateStr)
  const r = await db.collection('tasks').where({ submittedAt: _.gte(start).and(_.lt(end)) }).get()
  const out = []
  for (const t of r.data) {
    const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
    if (owners.includes(name)) out.push({ taskId: t._id, name: t.name, xp: t.xpPerOwner || 0 })
  }
  return out
}

// 生成某天（默认昨天）全村总结：汇总数字（代码算）+ AI 写一段话，存成 kind:'digest' 一条
async function generateDailyDigest(dateStr) {
  const day = dateStr || _yesterdayBjStr()
  // 取当天所有人日报（排除 digest 自身）
  const r = await db.collection('worklogs')
    .where({ date: day, kind: _.neq('digest') })
    .limit(200).get()
  const logs = r.data

  let validPeople = 0
  let taskCount = 0
  const details = []
  for (const w of logs) {
    if (w.isValidWorkday) validPeople++
    const tasks = (w.completed || []).map(c => c.name)
    taskCount += tasks.length
    if (tasks.length > 0) details.push({ name: w.name, tasks })
  }

  // 没人干活：存一条空总结，不调 AI
  let summary = ''
  if (details.length === 0) {
    summary = day + ' 暂无完成的工作记录。'
  } else {
    // 拼事实文本喂 AI（数字代码算好）
    const factLines = details.map(d => `· ${d.name}：${d.tasks.join('、')}`)
    const factText = `日期：${day}\n当天 ${validPeople} 人有有效工作、共完成 ${taskCount} 项任务：\n` + factLines.join('\n')
    try {
      const aiRes = await cloud.callFunction({
        name: 'aiStockIn',
        data: { action: 'dailyDigest', data: { date: day, validPeople, taskCount, factText } }
      })
      const ar = (aiRes && aiRes.result) || {}
      summary = ar.success ? (ar.report || '') : (day + ' 完成 ' + taskCount + ' 项任务（AI 生成失败，仅数据）')
    } catch (e) {
      summary = day + ' 完成 ' + taskCount + ' 项任务（AI 调用失败，仅数据）'
    }
  }

  const docId = 'digest_' + day
  const doc = { kind: 'digest', date: day, summary, validPeople, taskCount, details, createdAt: new Date() }
  try {
    await db.collection('worklogs').doc(docId).set({ data: doc })
  } catch (e) {
    try { await db.collection('worklogs').doc(docId).remove() } catch (e2) {}
    await db.collection('worklogs').add({ data: Object.assign({ _id: docId }, doc) })
  }
  return { success: true, date: day, validPeople, taskCount }
}

// 取某人最近 N 条日报（倒序）
async function _fetchWorklogs({ name, limit }) {
  const r = await db.collection('worklogs')
    .where({ name })
    .orderBy('date', 'desc')
    .limit(limit || 30)
    .get()
  return r.data.map(w => ({
    date: w.date,
    completed: w.completed || [],
    notes: w.notes || [],
    isValidWorkday: !!w.isValidWorkday,
    aiSummary: w.aiSummary || ''
  }))
}

// 某人有效工作日绝对数：本周（近7个北京日）/ 本月（近30个北京日）
async function _validDayStat(name) {
  const todayBj = _bjDateStr(new Date())
  const weekAgo = _bjDateStr(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))   // 含今天共7天
  const monthAgo = _bjDateStr(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)) // 含今天共30天
  const r = await db.collection('worklogs')
    .where({ name, isValidWorkday: true, date: _.gte(monthAgo).and(_.lte(todayBj)) })
    .limit(100).get()
  let weekValid = 0, monthValid = 0
  for (const w of r.data) {
    monthValid++
    if (w.date >= weekAgo) weekValid++
  }
  return { weekValid, monthValid }
}