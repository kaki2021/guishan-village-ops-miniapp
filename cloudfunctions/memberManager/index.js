const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ---- 角色配置（主管/库管）----
// 存在 config 集合：key='roles', value={ supervisors:[{openid,name,siteId,setAt,setBy}], keepers:[...] }
// 【按地方分管】每条角色绑一个 siteId（一个地方一个主管/库管）；同一人管多地 = 多条记录。
// 复用账房先生那套 config 模式。主管=批该地方的采购/领料/报废；库管=核验入库/发货/盘点该地方。
async function getRolesConfig() {
  try { await db.createCollection('config') } catch (e) {}
  const res = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  if (res.data.length === 0) return null
  return res.data[0]
}

async function getTreasurerValue() {
  const res = await db.collection('config').where({ key: 'treasurer' }).limit(1).get()
  if (res.data.length === 0) return null
  return res.data[0].value || null
}

// 执事（全局唯一，存 config key='headman'，模式同账房先生）
async function getHeadmanValue() {
  const res = await db.collection('config').where({ key: 'headman' }).limit(1).get()
  if (res.data.length === 0) return null
  return res.data[0].value || null
}

// 出资台账 → 股东推导：把 contributions 按 openid 累加，总额>0 即股东
// 返回 { byOpenid: {openid:{openid,name,total}}, list:[{openid,name,total}] }
async function getShareholders() {
  try { await db.createCollection('contributions') } catch (e) {}
  const all = (await db.collection('contributions').orderBy('createdAt', 'desc').limit(1000).get()).data
  const byOpenid = {}
  for (const c of all) {
    if (!c.openid) continue
    if (!byOpenid[c.openid]) byOpenid[c.openid] = { openid: c.openid, name: c.name || '', total: 0 }
    byOpenid[c.openid].total += Number(c.amount) || 0
    if (c.name) byOpenid[c.openid].name = c.name // 用最近一条的名字
  }
  const list = Object.values(byOpenid).filter(x => x.total > 0)
  return { byOpenid, list }
}

// 执行逐客：清掉对方的库管/主管/头衔/执事，再移除营员档案。
// 财务记录（contributions/transactions）保留不动，作为历史账。
async function executeEviction(targetOpenid, targetName, byOpenid) {
  // 1) 清 config.roles 里的角色与头衔
  const res = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  if (res.data.length) {
    const v = res.data[0].value || {}
    const value = Object.assign({}, v, {
      supervisors: (v.supervisors || []).filter(x => x.openid !== targetOpenid),
      keepers: (v.keepers || []).filter(x => x.openid !== targetOpenid),
      titleHolders: (v.titleHolders || []).filter(x => x.openid !== targetOpenid)
    })
    await db.collection('config').doc(res.data[0]._id).update({ data: { value } })
  }
  // 2) 若对方是执事，一并清掉
  const hm = await db.collection('config').where({ key: 'headman' }).limit(1).get()
  if (hm.data.length && hm.data[0].value && hm.data[0].value.openid === targetOpenid) {
    await db.collection('config').doc(hm.data[0]._id).update({ data: { value: null } })
  }
  // 3) 移除营员档案（解绑+删档）。历史 logs/tasks 保留。
  await db.collection('members').where({ openid: targetOpenid }).remove()
  // 4) 留痕
  await db.collection('logs').add({ data: { type: 'member_evict', note: `表决通过：${targetName} 已离开村落`, operatorName: targetName, openid: byOpenid, createdAt: new Date() } })
}

// 加入表决通过：把挂起申请转正
async function executeAdmit(targetOpenid, targetName, byOpenid) {
  const m = await db.collection('members').where({ openid: targetOpenid }).limit(1).get()
  if (m.data.length) await db.collection('members').doc(m.data[0]._id).update({ data: { status: 'active', admittedAt: new Date() } })
  await db.collection('logs').add({ data: { type: 'member_admit', note: `表决通过：${targetName} 已成为正式营员`, operatorName: targetName, openid: byOpenid, createdAt: new Date() } })
}
// 申请被否决/撤回：删档解绑
async function rejectApplicant(targetOpenid) {
  await db.collection('members').where({ openid: targetOpenid }).remove()
}

// 读库房树里的地方列表（任命选地方、迁移定位金山书院都要用）
async function getSites() {
  const res = await db.collection('config').where({ key: 'warehouseTree' }).limit(1).get()
  const sites = (res.data.length && res.data[0].value && res.data[0].value.sites) || []
  return sites.map(s => ({ id: s.id, name: s.name }))
}

// 规整头衔排期入参 → { schedType, schedWeekdays:[1..7], schedDays:[1..31] }
// 头衔工作清单规范化：[{id,text}]，元素补 id、去空、限 10 条；建表即数组（躲 null→object 的坑）
function _normChecklist(cl) {
  if (!Array.isArray(cl)) return []
  return cl
    .map(c => {
      const text = String((typeof c === 'string' ? c : (c && c.text) || '')).trim()
      if (!text) return null
      const id = (c && c.id) || 'ck' + Date.now().toString(36) + Math.floor(Math.random() * 10000).toString(36)
      return { id, text }
    })
    .filter(Boolean)
    .slice(0, 10)
}

function _normSchedule(data) {
  let schedType = ['daily', 'weekly', 'monthly'].includes(data.schedType) ? data.schedType : 'daily'
  let schedWeekdays = []
  let schedDays = []
  if (schedType === 'weekly') {
    schedWeekdays = (Array.isArray(data.schedWeekdays) ? data.schedWeekdays : [])
      .map(n => parseInt(n)).filter(n => n >= 1 && n <= 7)
    schedWeekdays = Array.from(new Set(schedWeekdays)).sort((a, b) => a - b)
    if (!schedWeekdays.length) schedType = 'daily'   // 周但没勾任何天 → 退回每天，避免永不发
  } else if (schedType === 'monthly') {
    schedDays = (Array.isArray(data.schedDays) ? data.schedDays : [])
      .map(n => parseInt(n)).filter(n => n >= 1 && n <= 31)
    schedDays = Array.from(new Set(schedDays)).sort((a, b) => a - b)
    if (!schedDays.length) schedType = 'daily'
  }
  return { schedType, schedWeekdays, schedDays }
}

// 排期转可读文字（用于变更记录对比）
function _schedText(t) {
  const st = t.schedType || 'daily'
  if (st === 'weekly') {
    const wd = (t.schedWeekdays || []).map(n => '一二三四五六日'[n - 1]).join('')
    return wd ? ('每周' + wd) : '每周'
  }
  if (st === 'monthly') {
    const ds = (t.schedDays || []).join('·')
    return ds ? ('每月' + ds + '号') : '每月'
  }
  return '每天'
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (action === 'initCollections') {
    try { await db.createCollection('members') } catch(e) {}
    try { await db.createCollection('achievements') } catch(e) {}
    try { await db.createCollection('config') } catch(e) {}
    return { success: true }
  }

  if (action === 'getMembers') {
    const result = await db.collection('members')
      .orderBy('xp', 'desc')
      .get()
    // 只返回正式营员；挂起申请（pending_review/pending_vote）不混进花名册
    const list = result.data.filter(m => (m.status || 'active') === 'active')
    return { success: true, list }
  }

  if (action === 'addMember') {
    const existing = await db.collection('members')
      .where({ name: data.name })
      .limit(1)
      .get()
    if (existing.data.length > 0) {
      return { success: false, msg: '营员已存在' }
    }
    await db.collection('members').add({
      data: {
        name: data.name,
        role: data.role,
        icon: data.icon || '🌿',
        xp: 0,
        weekXp: 0,
        level: 1,
        openid: '',
        joinedAt: new Date()
      }
    })
    return { success: true }
  }

  // 加入村落（双闸）：认领老档即时；全新的人——村子已有股东时走「申请挂起→执事初审→股东表决」，
  // 还没有任何股东（冷启动）时即时转正。data 可带 applyNote(申请说明)。
  if (action === 'joinAsMember') {
    const already = await db.collection('members').where({ openid }).limit(1).get()
    if (already.data.length > 0) {
      const me = already.data[0]
      const st = me.status || 'active'
      if (st === 'active') return { success: false, msg: `你已是「${me.name}」，无法重复加入` }
      return { success: true, status: st, pending: true, name: me.name } // 申请挂起中
    }
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '名字不能为空' }

    const existing = await db.collection('members').where({ name }).limit(1).get()
    if (existing.data.length > 0) {
      const m = existing.data[0]
      if (m.openid && m.openid !== openid) {
        return { success: false, msg: '该名字已被他人使用，请换一个' }
      }
      // 认领老档：即时生效，不走表决
      await db.collection('members').doc(m._id).update({
        data: { openid, role: data.role || m.role, icon: data.icon || m.icon || '🌿', status: 'active' }
      })
      return { success: true, claimed: true, status: 'active' }
    }

    // 全新的人
    const sh = await getShareholders()
    const established = sh.list.length > 0
    const base = { name, role: data.role, icon: data.icon || '🌿', xp: 0, weekXp: 0, level: 1, openid, joinedAt: new Date() }
    if (!established) {
      base.status = 'active' // 冷启动：还没股东，直接进
      await db.collection('members').add({ data: base })
      return { success: true, claimed: false, status: 'active', instant: true }
    }
    base.status = 'pending_review' // 等执事初审
    base.applyNote = data.applyNote || ''
    base.appliedAt = new Date()
    await db.collection('members').add({ data: base })
    return { success: true, claimed: false, status: 'pending_review', pending: true }
  }

  if (action === 'editMember') {
    const member = await db.collection('members')
      .where({ name: data.oldName })
      .limit(1)
      .get()
    if (member.data.length === 0) return { success: false, msg: '营员不存在' }
    const myOpenid = member.data[0].openid

    await db.collection('members').doc(member.data[0]._id).update({
      data: { name: data.name, role: data.role, icon: data.icon }
    })

    if (data.oldName !== data.name) {
      const transactions = await db.collection('transactions')
        .where({ operatorName: data.oldName }).limit(100).get()
      for (const t of transactions.data) {
        await db.collection('transactions').doc(t._id).update({ data: { operatorName: data.name } })
      }

      const logs = await db.collection('logs')
        .where({ operatorName: data.oldName }).limit(200).get()
      for (const l of logs.data) {
        await db.collection('logs').doc(l._id).update({ data: { operatorName: data.name } })
      }

      const publishedTasks = await db.collection('tasks')
        .where({ publisherName: data.oldName }).limit(100).get()
      for (const t of publishedTasks.data) {
        await db.collection('tasks').doc(t._id).update({ data: { publisherName: data.name } })
      }
      const ownedTasks = await db.collection('tasks')
        .where({ owner: data.oldName }).limit(100).get()
      for (const t of ownedTasks.data) {
        await db.collection('tasks').doc(t._id).update({ data: { owner: data.name } })
      }

      const schedules = await db.collection('schedules')
        .where({ operatorName: data.oldName }).limit(200).get()
      for (const s of schedules.data) {
        await db.collection('schedules').doc(s._id).update({ data: { operatorName: data.name } })
      }

      // 同步角色配置 & 账房先生里的名字（按 openid 匹配）。siteId 等其它字段原样保留。
      if (myOpenid) {
        const roleCfg = await getRolesConfig()
        if (roleCfg && roleCfg.value) {
          let changed = false
          const fix = (arr) => (arr || []).map(x => {
            if (x.openid === myOpenid && x.name !== data.name) { changed = true; return Object.assign({}, x, { name: data.name }) }
            return x
          })
          const sup = fix(roleCfg.value.supervisors)
          const keep = fix(roleCfg.value.keepers)
          const holders = fix(roleCfg.value.titleHolders)   // 头衔持有人名字也同步
          if (changed) {
            await db.collection('config').doc(roleCfg._id).update({
              data: { value: Object.assign({}, roleCfg.value, { supervisors: sup, keepers: keep, titleHolders: holders }) }
            })
          }
        }
        const tre = await db.collection('config').where({ key: 'treasurer' }).limit(1).get()
        if (tre.data.length && tre.data[0].value && tre.data[0].value.openid === myOpenid && tre.data[0].value.name !== data.name) {
          await db.collection('config').doc(tre.data[0]._id).update({
            data: { value: Object.assign({}, tre.data[0].value, { name: data.name }) }
          })
        }
      }
    }

    return { success: true }
  }

  if (action === 'bindOpenid') {
    await db.collection('members').where({ openid }).update({ data: { openid: '' } })
    const member = await db.collection('members').where({ name: data.name }).limit(1).get()
    if (member.data.length === 0) return { success: false, msg: '营员不存在' }
    await db.collection('members').doc(member.data[0]._id).update({ data: { openid } })
    return { success: true }
  }

  if (action === 'getMyName') {
    const result = await db.collection('members').where({ openid }).limit(1).get()
    if (result.data.length === 0) return { success: true, name: '' }
    const m = result.data[0]
    return { success: true, name: m.name, status: m.status || 'active', role: m.role, icon: m.icon }
  }

  // ====== 角色：主管 / 库管（按地方分管）======

  // 读取全部角色 + 头衔 + 地方列表 + 当前用户管辖哪些地方 + 按地方分组的职位名册
  if (action === 'getRoles') {
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const keepers = (cfg && cfg.value && cfg.value.keepers) || []
    const titleTypes = (cfg && cfg.value && cfg.value.titleTypes) || []     // [{id,name}] 头衔种类
    const titleHolders = (cfg && cfg.value && cfg.value.titleHolders) || [] // [{openid,name,titleId,siteId}]
    const treasurer = await getTreasurerValue()
    const headman = await getHeadmanValue()
    const sh = await getShareholders()
    const sites = await getSites()

    const mine = (arr) => arr.filter(x => x.openid === openid)
    const mySup = mine(supervisors)
    const myKeep = mine(keepers)
    const titleName = (id) => (titleTypes.find(t => t.id === id) || {}).name || '头衔'

    // ===== 职位名册：按地方分组，权限角色与头衔混在一起（不分两区）=====
    // 通用桶（siteId 为空）：账房先生 + 执事 + 通用头衔 + 旧的全局主管/库管（兼容）
    // 各地方桶：该地方的主管/库管/头衔
    const buckets = []
    const generic = { siteId: '', siteName: '通用', entries: [] }
    if (treasurer && treasurer.name) generic.entries.push({ kind: 'treasurer', position: '账房先生', name: treasurer.name })
    if (headman && headman.name) generic.entries.push({ kind: 'headman', position: '执事', name: headman.name })
    buckets.push(generic)
    const bySite = {}
    sites.forEach(s => { bySite[s.id] = { siteId: s.id, siteName: s.name, entries: [] }; buckets.push(bySite[s.id]) })
    const put = (siteId, entry) => {
      if (!siteId) { generic.entries.push(entry); return }
      if (bySite[siteId]) bySite[siteId].entries.push(entry)
      else { // 指向已删除地方的残留，归到通用避免丢失
        generic.entries.push(Object.assign({ orphanSite: siteId }, entry))
      }
    }
    supervisors.forEach(s => put(s.siteId, { kind: 'supervisor', position: '主管', name: s.name }))
    keepers.forEach(k => put(k.siteId, { kind: 'keeper', position: '库管', name: k.name }))
    titleHolders.forEach(h => put(h.siteId, { kind: 'title', titleId: h.titleId, position: titleName(h.titleId), name: h.name }))
    // 去掉空桶（通用桶即使空也保留，便于展示账房先生占位）
    const roster = buckets.filter(b => b.entries.length > 0 || b.siteId === '')

    return {
      success: true,
      supervisors, keepers, treasurer, headman,
      titleTypes, titleHolders,
      shareholders: sh.list.map(x => ({ openid: x.openid, name: x.name })),   // 股东名单（不含金额）
      sites,                 // [{id,name}] —— 任命/挂头衔选地方用
      roster,                // 按地方分组的职位名册，前端直接渲染
      me: {
        supervisorSiteIds: mySup.map(s => s.siteId).filter(Boolean),
        keeperSiteIds: myKeep.map(k => k.siteId).filter(Boolean),
        supervisorGlobal: mySup.some(s => !s.siteId),
        keeperGlobal: myKeep.some(k => !k.siteId),
        isSupervisor: mySup.length > 0,
        isKeeper: myKeep.length > 0,
        isTreasurer: !!(treasurer && treasurer.openid === openid),
        isHeadman: !!(headman && headman.openid === openid),
        isShareholder: !!(sh.byOpenid[openid] && sh.byOpenid[openid].total > 0),
        contribTotal: (sh.byOpenid[openid] && sh.byOpenid[openid].total) || 0,
        titles: titleHolders.filter(h => h.openid === openid).map(h => ({ titleId: h.titleId, name: titleName(h.titleId), siteId: h.siteId }))
      }
    }
  }

  // 任命角色。data: { role:'supervisor'|'keeper', targetName, siteId }
  // 治理（沿用引导式 + 你定的跨地方任命）：
  //  - 全村落还没有任何主管时，任意已绑定成员可设立「首位主管」（仍需选地方）
  //  - 之后：任意现任主管都能任命/取消任意地方的主管和库管（金山书院主管可任命观天瀑主管）
  if (action === 'setRole') {
    const role = data.role
    if (role !== 'supervisor' && role !== 'keeper') return { success: false, msg: '未知角色' }
    const targetName = (data.targetName || '').trim()
    if (!targetName) return { success: false, msg: '目标不能为空' }
    const siteId = (data.siteId || '').trim()
    if (!siteId) return { success: false, msg: '请先选择是哪个地方的主管/库管' }

    // 校验地方真实存在（防止任命到不存在的地方变孤儿）
    const sites = await getSites()
    if (sites.length && !sites.some(s => s.id === siteId)) {
      return { success: false, msg: '该地方不存在，请刷新后重试' }
    }
    const siteName = (sites.find(s => s.id === siteId) || {}).name || siteId

    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0) return { success: false, msg: '营员不存在' }
    if (!m.data[0].openid) return { success: false, msg: `「${targetName}」还没加入村落（未绑定身份），不能任命` }
    const targetOpenid = m.data[0].openid

    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const keepers = (cfg && cfg.value && cfg.value.keepers) || []
    const iAmSupervisor = supervisors.some(s => s.openid === openid)

    if (role === 'supervisor') {
      if (supervisors.length > 0 && !iAmSupervisor) {
        return { success: false, msg: '只有主管能任命主管' }
      }
    } else {
      if (!iAmSupervisor) {
        return { success: false, msg: supervisors.length === 0 ? '请先设立主管，再由主管任命库管' : '只有主管能任命库管' }
      }
    }

    const arr = role === 'supervisor' ? supervisors : keepers
    // 去重键改为「同一人 + 同一地方」：同一人可在不同地方各任一次
    if (arr.some(x => x.openid === targetOpenid && x.siteId === siteId)) {
      return { success: true, already: true }
    }
    arr.push({ openid: targetOpenid, name: targetName, siteId, setAt: new Date(), setBy: openid })
    const value = Object.assign({}, (cfg && cfg.value) || {}, { supervisors, keepers })
    if (cfg) {
      await db.collection('config').doc(cfg._id).update({ data: { value } })
    } else {
      await db.collection('config').add({ data: { key: 'roles', value } })
    }
    return { success: true, siteName }
  }

  // 取消角色。data: { role, targetName, siteId }
  //  - 只有现任主管能做
  //  - 按「人 + 地方」精确取消一条
  //  - 守护：不允许移除「全局最后一名主管」（移掉就没人能再任命，系统锁死）→ 提示先指定他人
  //    某地方最后一名主管不拦（别的地方主管可补任命，仅该地方暂时无人审批，可恢复）
  if (action === 'removeRole') {
    const role = data.role
    if (role !== 'supervisor' && role !== 'keeper') return { success: false, msg: '未知角色' }
    const targetName = (data.targetName || '').trim()
    const siteId = (data.siteId || '').trim()

    const cfg = await getRolesConfig()
    if (!cfg) return { success: false, msg: '尚无角色配置' }
    const supervisors = (cfg.value && cfg.value.supervisors) || []
    const keepers = (cfg.value && cfg.value.keepers) || []
    const iAmSupervisor = supervisors.some(s => s.openid === openid)
    if (!iAmSupervisor) return { success: false, msg: '只有主管能调整角色' }

    // 取消时按 名字 +（若给了）地方 精确匹配；没给 siteId 则按名字全部取消（兼容）
    const match = (x) => x.name === targetName && (!siteId || x.siteId === siteId)

    if (role === 'supervisor') {
      const next = supervisors.filter(s => !match(s))
      if (next.length === 0) {
        return { success: false, msg: '这是全村落最后一名主管。请先指定其他人为主管，再卸任。' }
      }
      await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { supervisors: next, keepers }) } })
    } else {
      const next = keepers.filter(k => !match(k))
      await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { supervisors, keepers: next }) } })
    }
    return { success: true }
  }

  // ====== 头衔（自定义职位，暂无权限；按地方/通用分配）======
  // 数据塞在 config.roles.value 里：titleTypes:[{id,name}]、titleHolders:[{openid,name,titleId,siteId}]
  // 管理权限：主管 或 执事 可管（执事 = 全局人事角色）。

  // 新增头衔种类。data:{ name, hours?, intensity?, dutyNote?, checklist?, schedType?, schedWeekdays?, schedDays? }
  // 工作内容（工时+强度）选填：填了就有「按排期自动发」的依据，不填则纯称号。
  // 排期 schedType: daily每天 / weekly每周(schedWeekdays:[1..7],1=周一) / monthly每月(schedDays:[1..31])
  if (action === 'addTitleType') {
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '头衔名不能为空' }
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const headman = await getHeadmanValue()
    if (!(supervisors.some(s => s.openid === openid) || (headman && headman.openid === openid))) return { success: false, msg: '只有主管或执事能管理头衔' }
    const titleTypes = (cfg.value.titleTypes) || []
    if (titleTypes.some(t => t.name === name)) return { success: true, already: true }
    const id = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
    const hours = Number(data.hours) > 0 ? Number(data.hours) : null
    const intensity = [1, 2, 3, 4, 5].includes(data.intensity) ? data.intensity : null
    const sched = _normSchedule(data)
    titleTypes.push({ id, name, dutyNote: (data.dutyNote || '').trim(), hours, intensity, checklist: _normChecklist(data.checklist), schedType: sched.schedType, schedWeekdays: sched.schedWeekdays, schedDays: sched.schedDays })
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { titleTypes }) } })
    return { success: true, id, name }
  }

  // 编辑头衔种类。data:{ titleId, name?, hours, intensity, dutyNote, schedType, schedWeekdays, schedDays }
  if (action === 'editTitleType') {
    const titleId = data.titleId
    const cfg = await getRolesConfig()
    if (!cfg) return { success: false, msg: '尚无配置' }
    const supervisors = (cfg.value && cfg.value.supervisors) || []
    const headman = await getHeadmanValue()
    if (!(supervisors.some(s => s.openid === openid) || (headman && headman.openid === openid))) return { success: false, msg: '只有主管或执事能管理头衔' }
    const titleTypes = (cfg.value.titleTypes) || []
    const idx = titleTypes.findIndex(t => t.id === titleId)
    if (idx < 0) return { success: false, msg: '该头衔不存在' }
    const name = (data.name || titleTypes[idx].name || '').trim()
    if (!name) return { success: false, msg: '头衔名不能为空' }
    if (titleTypes.some((t, i) => i !== idx && t.name === name)) return { success: false, msg: '已有同名头衔' }
    const hours = Number(data.hours) > 0 ? Number(data.hours) : null
    const intensity = [1, 2, 3, 4, 5].includes(data.intensity) ? data.intensity : null
    const sched = _normSchedule(data)
    const old = titleTypes[idx]

    // 变更留痕：逐项比对，记 from→to。操作人取本人名字。
    const meRec = await db.collection('members').where({ openid }).limit(1).get()
    const operator = (meRec.data[0] && meRec.data[0].name) || ''
    const now = new Date()
    const entries = []
    const intName = (v) => v == null ? '未设' : ({ 1: '非常轻', 2: '比较轻', 3: '中等', 4: '比较重', 5: '非常重' }[v] || v)
    if ((old.name || '') !== name) entries.push({ field: '名称', from: old.name || '', to: name, operator, time: now })
    if ((old.hours || null) !== hours) entries.push({ field: '工时', from: old.hours == null ? '未设' : (old.hours + 'h'), to: hours == null ? '未设' : (hours + 'h'), operator, time: now })
    if ((old.intensity || null) !== intensity) entries.push({ field: '强度', from: intName(old.intensity), to: intName(intensity), operator, time: now })
    const oldSched = _schedText(old)
    const newSched = _schedText({ schedType: sched.schedType, schedWeekdays: sched.schedWeekdays, schedDays: sched.schedDays })
    if (oldSched !== newSched) entries.push({ field: '排期', from: oldSched, to: newSched, operator, time: now })
    // 工作清单：传了才动（undefined 不碰，老调用零影响）；只记条数变化，不逐条铺进留痕
    const oldCl = Array.isArray(old.checklist) ? old.checklist : []
    const newCl = data.checklist === undefined ? oldCl : _normChecklist(data.checklist)
    if (JSON.stringify(oldCl.map(c => c.text)) !== JSON.stringify(newCl.map(c => c.text))) {
      entries.push({ field: '工作清单', from: oldCl.length + '条', to: newCl.length + '条', operator, time: now })
    }

    const reviseLog = (Array.isArray(old.reviseLog) ? old.reviseLog : []).concat(entries)

    titleTypes[idx] = Object.assign({}, old, {
      name, dutyNote: (data.dutyNote || '').trim(), hours, intensity,
      checklist: newCl,
      schedType: sched.schedType, schedWeekdays: sched.schedWeekdays, schedDays: sched.schedDays,
      reviseLog
    })
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { titleTypes }) } })
    return { success: true, changed: entries.length }
  }

  // 删除头衔种类。data:{ titleId }。有人持有时不让删（先摘干净），防残留
  if (action === 'removeTitleType') {
    const titleId = data.titleId
    const cfg = await getRolesConfig()
    if (!cfg) return { success: false, msg: '尚无配置' }
    const supervisors = (cfg.value && cfg.value.supervisors) || []
    const headman = await getHeadmanValue()
    if (!(supervisors.some(s => s.openid === openid) || (headman && headman.openid === openid))) return { success: false, msg: '只有主管或执事能管理头衔' }
    const holders = (cfg.value.titleHolders) || []
    const held = holders.filter(h => h.titleId === titleId).length
    if (held > 0) return { success: false, msg: `还有 ${held} 人持有该头衔，请先全部取消再删除` }
    const titleTypes = (cfg.value.titleTypes || []).filter(t => t.id !== titleId)
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { titleTypes }) } })
    return { success: true }
  }

  // 给某人挂头衔。data:{ targetName, titleId, siteId }（siteId 为空=通用）
  if (action === 'assignTitle') {
    const targetName = (data.targetName || '').trim()
    const titleId = data.titleId
    const siteId = (data.siteId || '').trim() // '' = 通用
    if (!targetName || !titleId) return { success: false, msg: '参数不全' }

    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const headman = await getHeadmanValue()
    if (!(supervisors.some(s => s.openid === openid) || (headman && headman.openid === openid))) return { success: false, msg: '只有主管或执事能管理头衔' }
    const titleTypes = (cfg.value.titleTypes) || []
    if (!titleTypes.some(t => t.id === titleId)) return { success: false, msg: '该头衔不存在' }
    if (siteId) {
      const sites = await getSites()
      if (sites.length && !sites.some(s => s.id === siteId)) return { success: false, msg: '该地方不存在' }
    }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0) return { success: false, msg: '营员不存在' }
    if (!m.data[0].openid) return { success: false, msg: `「${targetName}」还没加入村落，不能挂头衔` }
    const targetOpenid = m.data[0].openid

    const holders = (cfg.value.titleHolders) || []
    // 去重键：人 + 头衔 + 范围
    if (holders.some(h => h.openid === targetOpenid && h.titleId === titleId && (h.siteId || '') === siteId)) {
      return { success: true, already: true }
    }
    holders.push({ openid: targetOpenid, name: targetName, titleId, siteId, setAt: new Date(), setBy: openid })
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { titleHolders: holders }) } })
    return { success: true }
  }

  // 取消某人头衔。data:{ targetName, titleId, siteId }
  if (action === 'unassignTitle') {
    const targetName = (data.targetName || '').trim()
    const titleId = data.titleId
    const siteId = (data.siteId || '').trim()
    const cfg = await getRolesConfig()
    if (!cfg) return { success: false, msg: '尚无配置' }
    const supervisors = (cfg.value && cfg.value.supervisors) || []
    const headman = await getHeadmanValue()
    if (!(supervisors.some(s => s.openid === openid) || (headman && headman.openid === openid))) return { success: false, msg: '只有主管或执事能管理头衔' }
    const holders = (cfg.value.titleHolders) || []
    const next = holders.filter(h => !(h.name === targetName && h.titleId === titleId && (h.siteId || '') === siteId))
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { titleHolders: next }) } })
    return { success: true }
  }

  // ====== 执事（全局唯一，主管任命，存 config key='headman'）======
  if (action === 'setHeadman') {
    const targetName = (data.targetName || '').trim()
    if (!targetName) return { success: false, msg: '目标不能为空' }
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    if (!supervisors.some(s => s.openid === openid)) return { success: false, msg: '只有主管能任命执事' }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0) return { success: false, msg: '营员不存在' }
    if (!m.data[0].openid) return { success: false, msg: `「${targetName}」还没加入村落，不能任命` }
    const value = { openid: m.data[0].openid, name: targetName, setAt: new Date(), setBy: openid }
    // 稳妥写法：先删掉旧的 headman 记录（可能 value 为 null，update 子字段会报错），再 add 一条新的
    const exist = await db.collection('config').where({ key: 'headman' }).limit(1).get()
    for (const d of exist.data) { try { await db.collection('config').doc(d._id).remove() } catch (e) {} }
    await db.collection('config').add({ data: { key: 'headman', value } })
    return { success: true }
  }
  if (action === 'removeHeadman') {
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    if (!supervisors.some(s => s.openid === openid)) return { success: false, msg: '只有主管能免去执事' }
    // 直接删除该记录（而不是把 value 置 null，避免之后写子字段报错）
    const exist = await db.collection('config').where({ key: 'headman' }).limit(1).get()
    for (const d of exist.data) { try { await db.collection('config').doc(d._id).remove() } catch (e) {} }
    return { success: true }
  }

  // ====== 出资台账（账房先生录；同步进金库 transactions；股东 = 累加总额>0）======
  // 出资多次追加：每笔一条 contributions 记录；改错用「冲正」录负数，不直接改。
  if (action === 'getContributions') {
    try { await db.createCollection('contributions') } catch (e) {}
    // 金额明细仅 账房先生 / 主管 可看；执事和普通成员看不到金额（普通成员在营员页只看到谁是股东）
    const treasurer = await getTreasurerValue()
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const allowed = (treasurer && treasurer.openid === openid) || supervisors.some(s => s.openid === openid)
    if (!allowed) return { success: false, msg: '只有账房先生 / 主管能查看出资明细' }
    const list = (await db.collection('contributions').orderBy('createdAt', 'desc').limit(500).get()).data
    const sh = await getShareholders()
    return { success: true, list, shareholders: sh.list }   // 这里含金额，给有权限者
  }
  if (action === 'addContribution') {   // data:{ targetName, amount, note, screenshots? }
    const treasurer = await getTreasurerValue()
    if (!treasurer || !treasurer.openid) return { success: false, msg: '尚未指定账房先生，金库锁定，不能录出资' }
    if (treasurer.openid !== openid) return { success: false, msg: `只有账房先生「${treasurer.name}」能录出资` }
    const targetName = (data.targetName || '').trim()
    const amount = Number(data.amount) || 0
    if (!targetName) return { success: false, msg: '请选择出资人' }
    if (amount <= 0) return { success: false, msg: '出资金额要大于 0' }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0) return { success: false, msg: '营员不存在' }
    if (!m.data[0].openid) return { success: false, msg: `「${targetName}」还没加入村落` }
    const targetOpenid = m.data[0].openid
    try { await db.createCollection('contributions') } catch (e) {}
    // 同步进金库：记一笔收入（shape 与 campManager 的 transactions 一致）
    const txn = await db.collection('transactions').add({ data: {
      type: 'in', amount, note: `出资：${targetName}${data.note ? ('（' + data.note + '）') : ''}`,
      operatorName: treasurer.name, openid, screenshots: data.screenshots || [],
      kind: 'contribution', createdAt: new Date()
    }})
    await db.collection('contributions').add({ data: {
      openid: targetOpenid, name: targetName, amount, note: data.note || '',
      by: openid, byName: treasurer.name, txnId: txn._id, createdAt: new Date()
    }})
    await db.collection('logs').add({ data: { type: 'money_in', note: `出资：${targetName}`, amount, operatorName: treasurer.name, openid, createdAt: new Date() }})
    return { success: true }
  }
  if (action === 'reverseContribution') {   // data:{ targetName, amount(正数), note } 冲正：录负数 + 金库减
    const treasurer = await getTreasurerValue()
    if (!treasurer || treasurer.openid !== openid) return { success: false, msg: '只有账房先生能冲正出资' }
    const targetName = (data.targetName || '').trim()
    const amount = Number(data.amount) || 0
    if (!targetName || amount <= 0) return { success: false, msg: '请填出资人和冲正金额（正数）' }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0 || !m.data[0].openid) return { success: false, msg: '营员不存在或未加入' }
    const targetOpenid = m.data[0].openid
    try { await db.createCollection('contributions') } catch (e) {}
    const txn = await db.collection('transactions').add({ data: {
      type: 'out', amount, note: `出资冲正：${targetName}${data.note ? ('（' + data.note + '）') : ''}`,
      operatorName: treasurer.name, openid, screenshots: data.screenshots || [], kind: 'contribution_reverse', createdAt: new Date()
    }})
    await db.collection('contributions').add({ data: {
      openid: targetOpenid, name: targetName, amount: -amount, note: '冲正：' + (data.note || ''),
      by: openid, byName: treasurer.name, txnId: txn._id, createdAt: new Date()
    }})
    await db.collection('logs').add({ data: { type: 'money_out', note: `出资冲正：${targetName}`, amount, operatorName: treasurer.name, openid, createdAt: new Date() }})
    return { success: true }
  }

  // ====== 待报销转出资（债转股）======
  // 垫付人发起（把自己若干 pending 垫付申请转为出资）→ 全体主管【全部】通过 → 生效。
  // 生效效果：这些垫付标 converted（不再报销）；记出资 contributions；金库记一笔 in（余额+，与普通出资同 shape）。
  // 审核记录存 conversions 集合。审核期间垫付在 campManager 侧标 converting、移出待报销池，防双花。

  // 发起：data:{ items:[{source:'reimb'|'purchase', id}] }（都必须是本人的、待还的）
  if (action === 'proposeConversion') {
    try { await db.createCollection('conversions') } catch (e) {}
    try { await db.createCollection('reimbursements') } catch (e) {}
    try { await db.createCollection('purchases') } catch (e) {}
    const me = await db.collection('members').where({ openid }).limit(1).get()
    const myName = (me.data[0] && me.data[0].name) || ''
    if (!myName) return { success: false, msg: '请先加入村落' }

    // 兼容老调用：只传 ids[] 视为全 reimb
    let reqItems = Array.isArray(data.items) ? data.items : []
    if (reqItems.length === 0 && Array.isArray(data.ids)) reqItems = data.ids.map(id => ({ source: 'reimb', id }))
    if (reqItems.length === 0) return { success: false, msg: '没有选中要转出资的垫付' }

    const convItems = []
    for (const it of reqItems) {
      const src = it.source === 'purchase' ? 'purchase' : 'reimb'
      if (src === 'reimb') {
        const d = (await db.collection('reimbursements').doc(it.id).get()).data
        if (!d) return { success: false, msg: '有垫付记录不存在，请刷新' }
        if (d.applicantOpenid !== openid) return { success: false, msg: '只能转自己的垫付' }
        if (d.status !== 'pending') return { success: false, msg: '有垫付已被处理，请刷新' }
        convItems.push({ source: 'reimb', reimbId: d._id, note: d.note || '', amount: Number(d.amount) || 0 })
      } else {
        const p = (await db.collection('purchases').doc(it.id).get()).data
        if (!p) return { success: false, msg: '有采购单不存在，请刷新' }
        if (p.buyerOpenid !== openid) return { success: false, msg: '只能转自己领的采购垫款' }
        if (!(p.status === 'done' && p.ledgerStatus === 'pending_record' && (Number(p.actualAmount) || 0) > 0)) {
          return { success: false, msg: '有采购单不是"待账房记账"状态，请刷新' }
        }
        convItems.push({ source: 'purchase', purchaseId: p._id, note: p.title || '采购单', amount: Number(p.actualAmount) || 0 })
      }
    }
    const total = convItems.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0)
    if (!(total > 0)) return { success: false, msg: '金额异常' }

    const cfg = await getRolesConfig()
    const sups = (cfg && cfg.value && cfg.value.supervisors) || []
    const supMap = {}
    sups.forEach(x => { if (x.openid) supMap[x.openid] = x.name })
    const approvers = Object.keys(supMap).map(oid => ({ openid: oid, name: supMap[oid] }))
    if (approvers.length === 0) return { success: false, msg: '当前没有主管，无法审核转出资' }

    const conv = await db.collection('conversions').add({ data: {
      applicantOpenid: openid, applicantName: myName,
      items: convItems, total,
      approvers, approvedBy: [],
      status: 'pending', rejectReason: '',
      createdAt: new Date(), decidedAt: null
    }})

    // 移出各自的待还池，防双花
    for (const it of convItems) {
      if (it.source === 'reimb') {
        await db.collection('reimbursements').doc(it.reimbId).update({ data: { status: 'converting', convId: conv._id } })
      } else {
        await db.collection('purchases').doc(it.purchaseId).update({ data: { ledgerStatus: 'converting', convId: conv._id } })
      }
    }
    return { success: true, id: conv._id, total, approverCount: approvers.length }
  }

  // 审核列表：全体主管看 pending 的转出资申请（我的主页/待办用）。data:{ mineOnly? }
  if (action === 'getConversions') {
    try { await db.createCollection('conversions') } catch (e) {}
    const cfg = await getRolesConfig()
    const sups = (cfg && cfg.value && cfg.value.supervisors) || []
    const iAmSup = sups.some(x => x.openid === openid)

    // 我发起的（看进度）
    const mine = (await db.collection('conversions').where({ applicantOpenid: openid }).orderBy('createdAt', 'desc').limit(50).get()).data
    let toReview = []
    if (iAmSup) {
      const pend = (await db.collection('conversions').where({ status: 'pending' }).orderBy('createdAt', 'asc').limit(100).get()).data
      // 只列"轮到我审、我还没审"的
      toReview = pend.filter(c =>
        (c.approvers || []).some(a => a.openid === openid) &&
        (c.approvedBy || []).indexOf(openid) < 0
      )
    }
    const deco = (c) => ({
      _id: c._id, applicantName: c.applicantName, total: c.total,
      itemCount: (c.items || []).length, items: c.items || [],
      status: c.status,
      approvedCount: (c.approvedBy || []).length,
      approverCount: (c.approvers || []).length,
      rejectReason: c.rejectReason || ''
    })
    return { success: true, iAmSupervisor: iAmSup, toReview: toReview.map(deco), mine: mine.map(deco) }
  }

  // 主管审核：data:{ id, agree:bool, reason? }
  if (action === 'reviewConversion') {
    try { await db.createCollection('conversions') } catch (e) {}
    const cfg = await getRolesConfig()
    const sups = (cfg && cfg.value && cfg.value.supervisors) || []
    if (!sups.some(x => x.openid === openid)) return { success: false, msg: '只有主管能审核' }

    const me = await db.collection('members').where({ openid }).limit(1).get()
    const myName = (me.data[0] && me.data[0].name) || '主管'

    const conv = (await db.collection('conversions').doc(data.id).get()).data
    if (!conv) return { success: false, msg: '审核单不存在' }
    if (conv.status !== 'pending') return { success: false, msg: '该申请已处理' }
    if (!(conv.approvers || []).some(a => a.openid === openid)) return { success: false, msg: '你不在本单的审核名单里' }

    // 驳回：整单退回，各来源回到各自待还态
    if (!data.agree) {
      await db.collection('conversions').doc(data.id).update({
        data: { status: 'rejected', rejectReason: (data.reason || '').trim(), decidedAt: new Date(), rejectedBy: openid, rejectedByName: myName }
      })
      for (const it of (conv.items || [])) {
        try {
          if (it.source === 'purchase') {
            await db.collection('purchases').doc(it.purchaseId).update({ data: { ledgerStatus: 'pending_record', convId: '' } })
          } else {
            await db.collection('reimbursements').doc(it.reimbId).update({ data: { status: 'pending', convId: '' } })
          }
        } catch (e) {}
      }
      return { success: true, result: 'rejected' }
    }

    // 通过：记我这一票；若还没集齐全部主管，挂着等
    const approvedBy = (conv.approvedBy || []).slice()
    if (approvedBy.indexOf(openid) < 0) approvedBy.push(openid)
    const needAll = (conv.approvers || []).map(a => a.openid)
    const allDone = needAll.every(oid => approvedBy.indexOf(oid) >= 0)

    if (!allDone) {
      await db.collection('conversions').doc(data.id).update({ data: { approvedBy } })
      return { success: true, result: 'pending', approved: approvedBy.length, need: needAll.length }
    }

    // 集齐 → 生效：逐笔垫付标 converted + 记【借款台账 loans】
    // 【口径 2026-07 修订】股份人人固定相等（每人 ¥6000 股本），多出来的钱是【借款】不是股。
    // 所以这里【不记 contributions、不记 transactions】——没有真金白银进出，只是
    // 「短期该还的垫付款」变成「长期欠这个人的借款」。
    // 金库余额不变；可用余额(=余额-待报销)因待报销减少而变宽裕。
    try { await db.createCollection('loans') } catch (e) {}
    const treasurer = await getTreasurerValue()
    const treasurerName = (treasurer && treasurer.name) || '账房先生'
    const applicantName = conv.applicantName
    const applicantOpenid = conv.applicantOpenid

    for (const it of (conv.items || [])) {
      const amount = Number(it.amount) || 0
      if (!(amount > 0)) continue
      const srcLabel = it.source === 'purchase' ? '采购垫款' : '垫付'
      // 借款台账：正数=村里借入（欠这个人），负数=还款
      await db.collection('loans').add({ data: {
        openid: applicantOpenid, name: applicantName, amount,
        note: srcLabel + '转借款' + (it.note ? ('：' + it.note) : ''),
        source: it.source === 'purchase' ? 'purchase' : 'reimb',
        fromReimbId: it.reimbId || '', fromPurchaseId: it.purchaseId || '',
        convId: conv._id,
        by: openid, byName: myName,
        createdAt: new Date()
      }})
      // 各来源标终态（不再走报销/记账流程）
      try {
        if (it.source === 'purchase') {
          await db.collection('purchases').doc(it.purchaseId).update({
            data: { ledgerStatus: 'converted', ledgerNote: 'loan', convId: conv._id }
          })
        } else {
          await db.collection('reimbursements').doc(it.reimbId).update({
            data: { status: 'converted', convId: conv._id, operatorName: treasurerName, decidedAt: new Date() }
          })
        }
      } catch (e) {}
      await db.collection('logs').add({ data: {
        type: 'loan_in', note: `${srcLabel}转借款：${applicantName}`, amount, operatorName: myName, openid, createdAt: new Date()
      }})
    }
    await db.collection('conversions').doc(data.id).update({
      data: { approvedBy, status: 'approved', decidedAt: new Date() }
    })
    return { success: true, result: 'approved', total: conv.total }
  }

  // 发起人撤回（还没被全部通过时）：data:{ id }
  if (action === 'cancelConversion') {
    try { await db.createCollection('conversions') } catch (e) {}
    const conv = (await db.collection('conversions').doc(data.id).get()).data
    if (!conv) return { success: false, msg: '审核单不存在' }
    if (conv.applicantOpenid !== openid) return { success: false, msg: '只能撤回自己的申请' }
    if (conv.status !== 'pending') return { success: false, msg: '已处理，不能撤回' }
    await db.collection('conversions').doc(data.id).update({ data: { status: 'cancelled', decidedAt: new Date() } })
    for (const it of (conv.items || [])) {
      try {
        if (it.source === 'purchase') {
          await db.collection('purchases').doc(it.purchaseId).update({ data: { ledgerStatus: 'pending_record', convId: '' } })
        } else {
          await db.collection('reimbursements').doc(it.reimbId).update({ data: { status: 'pending', convId: '' } })
        }
      } catch (e) {}
    }
    return { success: true }
  }

  // ====== 人员流动表决（加入 admit / 离开 evict 两类，股东按人头 2/3）======
  if (action === 'getEvictions' || action === 'getProposals') {
    try { await db.createCollection('evictions') } catch (e) {}
    const list = (await db.collection('evictions').orderBy('createdAt', 'desc').limit(50).get()).data
    const STATUS = { open: '表决中', passed: '已通过', rejected: '未通过', withdrawn: '已撤回' }
    const out = list.map(e => {
      const type = e.type || 'evict'
      const inPool = (e.pool || []).indexOf(openid) >= 0
      const votedFor = (e.votesFor || []).indexOf(openid) >= 0
      const votedAgainst = (e.votesAgainst || []).indexOf(openid) >= 0
      return Object.assign({}, e, {
        type,
        typeLabel: type === 'admit' ? '加入表决' : '去留表决',
        statusLabel: STATUS[e.status] || e.status,
        forCount: (e.votesFor || []).length,
        againstCount: (e.votesAgainst || []).length,
        iCanVote: e.status === 'open' && inPool && !votedFor && !votedAgainst,
        iVoted: votedFor ? 'for' : (votedAgainst ? 'against' : '')
      })
    })
    return { success: true, list: out }
  }

  if (action === 'proposeEviction') {   // data:{ targetName, reason }
    const headman = await getHeadmanValue()
    if (!headman || headman.openid !== openid) return { success: false, msg: '只有执事能发起逐客提议' }
    const targetName = (data.targetName || '').trim()
    if (!targetName) return { success: false, msg: '请选择要请出村的人' }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0 || !m.data[0].openid) return { success: false, msg: '该营员不存在或未加入' }
    const targetOpenid = m.data[0].openid
    if (targetOpenid === openid) return { success: false, msg: '不能对自己发起逐客' }

    // 护栏：主管 / 账房先生 不能直接逐，得先卸其权限角色
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const treasurer = await getTreasurerValue()
    if (supervisors.some(s => s.openid === targetOpenid)) return { success: false, msg: '对方还是主管，请先卸去其主管职再发起' }
    if (treasurer && treasurer.openid === targetOpenid) return { success: false, msg: '对方还是账房先生，请先转交账房先生再发起' }

    // 已有进行中的提议则不重复
    try { await db.createCollection('evictions') } catch (e) {}
    const dup = await db.collection('evictions').where({ targetOpenid, status: 'open' }).limit(1).get()
    if (dup.data.length) return { success: false, msg: '已有一条针对该成员的逐客提议在表决中' }

    // 票池 = 发起这一刻的股东快照（出资总额>0）
    const sh = await getShareholders()
    const pool = sh.list.map(x => x.openid)
    if (pool.length === 0) return { success: false, msg: '当前没有任何股东，无法表决（需先有人出资）' }
    const needed = Math.ceil(pool.length * 2 / 3)

    await db.collection('evictions').add({ data: {
      type: 'evict',
      targetOpenid, targetName, reason: data.reason || '',
      proposerOpenid: openid, proposerName: headman.name,
      status: 'open',
      pool, poolSize: pool.length, needed,
      votesFor: [], votesAgainst: [],
      createdAt: new Date(), decidedAt: null
    }})
    return { success: true, poolSize: pool.length, needed }
  }

  if (action === 'voteEviction' || action === 'voteProposal') {   // data:{ id, agree:bool }
    const e = (await db.collection('evictions').doc(data.id).get()).data
    if (!e) return { success: false, msg: '提议不存在' }
    if (e.status !== 'open') return { success: false, msg: '该表决已结束' }
    if ((e.pool || []).indexOf(openid) < 0) return { success: false, msg: '你不是发起时的股东，无权投票' }
    if ((e.votesFor || []).indexOf(openid) >= 0 || (e.votesAgainst || []).indexOf(openid) >= 0) {
      return { success: false, msg: '你已经投过票了' }
    }
    const type = e.type || 'evict'
    const votesFor = (e.votesFor || []).slice()
    const votesAgainst = (e.votesAgainst || []).slice()
    if (data.agree) votesFor.push(openid); else votesAgainst.push(openid)

    if (votesFor.length >= e.needed) {
      if (type === 'admit') await executeAdmit(e.targetOpenid, e.targetName, openid)
      else await executeEviction(e.targetOpenid, e.targetName, openid)
      await db.collection('evictions').doc(data.id).update({ data: { votesFor, votesAgainst, status: 'passed', decidedAt: new Date() } })
      return { success: true, decided: 'passed' }
    }
    if (votesAgainst.length > (e.poolSize - e.needed)) {
      if (type === 'admit') await rejectApplicant(e.targetOpenid) // 加入没通过 → 删申请档
      await db.collection('evictions').doc(data.id).update({ data: { votesFor, votesAgainst, status: 'rejected', decidedAt: new Date() } })
      return { success: true, decided: 'rejected' }
    }
    await db.collection('evictions').doc(data.id).update({ data: { votesFor, votesAgainst } })
    return { success: true, decided: '' }
  }

  if (action === 'withdrawEviction' || action === 'withdrawProposal') {   // data:{ id }；发起人(执事)或主管可撤回
    const e = (await db.collection('evictions').doc(data.id).get()).data
    if (!e) return { success: false, msg: '提议不存在' }
    if (e.status !== 'open') return { success: false, msg: '该表决已结束，无需撤回' }
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const isProposer = e.proposerOpenid === openid
    const isSup = supervisors.some(s => s.openid === openid)
    if (!isProposer && !isSup) return { success: false, msg: '只有发起人或主管能撤回' }
    if ((e.type || 'evict') === 'admit') await rejectApplicant(e.targetOpenid) // 撤回加入表决 → 删申请档
    await db.collection('evictions').doc(data.id).update({ data: { status: 'withdrawn', decidedAt: new Date() } })
    return { success: true }
  }

  // ====== 加入申请：执事初审 + 待审列表 ======
  // 执事初审：驳回则删档；通过则进股东表决（无股东时直接转正，冷启动兜底）
  if (action === 'reviewApplication') {   // data:{ id, pass, reason }
    const headman = await getHeadmanValue()
    if (!headman || headman.openid !== openid) return { success: false, msg: '只有执事能初审加入申请' }
    const m = (await db.collection('members').doc(data.id).get()).data
    if (!m) return { success: false, msg: '申请不存在' }
    if ((m.status || 'active') !== 'pending_review') return { success: false, msg: '该申请不在待初审状态' }

    if (!data.pass) {
      await db.collection('members').doc(data.id).remove()
      await db.collection('logs').add({ data: { type: 'member_apply_reject', note: `加入申请驳回：${m.name}（${data.reason || '未填原因'}）`, operatorName: m.name, openid, createdAt: new Date() } })
      return { success: true, rejected: true }
    }

    const sh = await getShareholders()
    const pool = sh.list.map(x => x.openid)
    if (pool.length === 0) { // 没股东（极端）→ 直接转正
      await db.collection('members').doc(data.id).update({ data: { status: 'active', admittedAt: new Date() } })
      return { success: true, admitted: true, instant: true }
    }
    try { await db.createCollection('evictions') } catch (e) {}
    const dup = await db.collection('evictions').where({ targetOpenid: m.openid, status: 'open' }).limit(1).get()
    if (dup.data.length) return { success: false, msg: '已有一条该成员的表决在进行' }
    const needed = Math.ceil(pool.length * 2 / 3)
    await db.collection('evictions').add({ data: {
      type: 'admit',
      targetOpenid: m.openid, targetName: m.name, reason: m.applyNote || '',
      proposerOpenid: openid, proposerName: headman.name,
      status: 'open', pool, poolSize: pool.length, needed,
      votesFor: [], votesAgainst: [], createdAt: new Date(), decidedAt: null
    }})
    await db.collection('members').doc(data.id).update({ data: { status: 'pending_vote' } })
    return { success: true, toVote: true, poolSize: pool.length, needed }
  }

  // 待初审 / 表决中的申请（执事或主管可看）
  if (action === 'getApplications') {
    const headman = await getHeadmanValue()
    const cfg = await getRolesConfig()
    const supervisors = (cfg && cfg.value && cfg.value.supervisors) || []
    const allowed = (headman && headman.openid === openid) || supervisors.some(s => s.openid === openid)
    if (!allowed) return { success: true, pendingReview: [], pendingVote: [] }
    const all = (await db.collection('members').get()).data
    const pendingReview = all.filter(m => m.status === 'pending_review')
      .map(m => ({ _id: m._id, name: m.name, role: m.role, icon: m.icon, applyNote: m.applyNote || '', appliedAt: m.appliedAt }))
    const pendingVote = all.filter(m => m.status === 'pending_vote')
      .map(m => ({ _id: m._id, name: m.name }))
    return { success: true, pendingReview, pendingVote }
  }

  // 【一次性】把旧的无 siteId 角色条目盖上「金山书院」的 siteId。部署后跑一次即可。
  if (action === 'migrateRoles') {
    const sites = await getSites()
    if (sites.length === 0) return { success: false, msg: '未找到库房树，请先到仓库页初始化库房再迁移' }
    const home = sites.find(s => s.name === '金山书院') || sites[0]
    const homeId = home.id

    const cfg = await getRolesConfig()
    if (!cfg || !cfg.value) return { success: true, migrated: 0, msg: '尚无角色，无需迁移' }
    let migrated = 0
    const stamp = (arr) => (arr || []).map(x => {
      if (!x.siteId) { migrated++; return Object.assign({}, x, { siteId: homeId }) }
      return x
    })
    const supervisors = stamp(cfg.value.supervisors)
    const keepers = stamp(cfg.value.keepers)
    // 头衔不迁移：titleHolders 的空 siteId 表示「通用」，是故意的，不补地方
    await db.collection('config').doc(cfg._id).update({ data: { value: Object.assign({}, cfg.value, { supervisors, keepers }) } })
    return { success: true, migrated, siteId: homeId, siteName: home.name }
  }

  if (action === 'addXp') {
    const member = await db.collection('members').where({ name: data.name }).limit(1).get()
    if (member.data.length === 0) return { success: false }
    const m = member.data[0]
    const newXp = (m.xp || 0) + data.xp
    const newWeekXp = (m.weekXp || 0) + data.xp
    const level = newXp >= 2000 ? 5 : newXp >= 1000 ? 4 : newXp >= 500 ? 3 : newXp >= 200 ? 2 : 1
    await db.collection('members').doc(m._id).update({
      data: { xp: newXp, weekXp: newWeekXp, level }
    })
    return { success: true }
  }

  if (action === 'getAchievements') {
    const result = await db.collection('achievements').get()
    return { success: true, list: result.data }
  }

  if (action === 'checkAndUnlock') {
    const allAchs = [
      { key: 'camp_start', name: '营地建立', icon: '🏕️', desc: '第一天入驻', condition: 'always' },
      { key: 'first_supply', name: '第一顿饭', icon: '🍳', desc: '完成首次采购记录', condition: 'resource_count_1' },
      { key: 'builder', name: '动手达人', icon: '🔨', desc: '完成5个建设任务', condition: 'done_task_5' },
      { key: 'recorder', name: '记录者', icon: '📸', desc: '连续7天有记录', condition: 'log_days_7' },
      { key: 'hundred_days', name: '百日营地', icon: '🌟', desc: '运营满100天', condition: 'days_100' },
      { key: 'rich_camp', name: '万金营地', icon: '💰', desc: '金库曾达¥10000', condition: 'balance_10000' },
      { key: 'full_house', name: '客满为患', icon: '🏠', desc: '同时接待5组客人', condition: 'manual' },
      { key: 'festival', name: '文化节', icon: '🎪', desc: '举办首次营地活动', condition: 'manual' }
    ]

    const unlocked = await db.collection('achievements').get()
    const unlockedKeys = unlocked.data.map(a => a.key)

    const resources = await db.collection('resources').count()
    const doneTasks = await db.collection('tasks').where({ status: 'done' }).get()
    const buildTasks = doneTasks.data.filter(t => t.type && t.type.includes('建设维修'))
    const logs = await db.collection('logs').orderBy('createdAt', 'desc').limit(100).get()

    const logDays = new Set(logs.data.map(l => {
      const d = new Date(l.createdAt)
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    })).size

    const newUnlocked = []
    for (const ach of allAchs) {
      if (unlockedKeys.includes(ach.key)) continue
      let shouldUnlock = false
      if (ach.condition === 'always' && data && data.campDay >= 1) shouldUnlock = true
      if (ach.condition === 'resource_count_1' && resources.total >= 1) shouldUnlock = true
      if (ach.condition === 'done_task_5' && buildTasks.length >= 5) shouldUnlock = true
      if (ach.condition === 'log_days_7' && logDays >= 7) shouldUnlock = true
      if (ach.condition === 'days_100' && data && data.campDay >= 100) shouldUnlock = true
      if (ach.condition === 'balance_10000') {
        const txResult = await db.collection('transactions')
          .orderBy('createdAt', 'desc').limit(200).get()
        const balance = txResult.data.reduce((sum, t) => {
          return t.type === 'in' ? sum + t.amount : sum - t.amount
        }, 0)
        if (balance >= 10000) shouldUnlock = true
      }
      if (shouldUnlock) {
        await db.collection('achievements').add({
          data: Object.assign({}, ach, { unlockedAt: new Date() })
        })
        newUnlocked.push(ach.name)
      }
    }
    return { success: true, newUnlocked }
  }

  if (action === 'resetWeekXp') {
    const members = await db.collection('members').limit(100).get()
    for (const m of members.data) {
      await db.collection('members').doc(m._id).update({ data: { weekXp: 0 } })
    }
    return { success: true }
  }

  // ====== 借款台账（村里欠营员的长期借款）======
  // 来源：待报销/采购垫款「转借款」；还款由账房操作，金库真的出账。
  // 与股本的区别：股本人人固定相等(¥6000)，借款是债、不影响股份和表决权。
  if (action === 'getLoans') {
    try { await db.createCollection('loans') } catch (e) {}
    const all = (await db.collection('loans').orderBy('createdAt', 'desc').limit(1000).get()).data
    const byOpenid = {}
    for (const l of all) {
      if (!l.openid) continue
      if (!byOpenid[l.openid]) byOpenid[l.openid] = { openid: l.openid, name: l.name || '', total: 0, entries: [] }
      byOpenid[l.openid].total += Number(l.amount) || 0
      byOpenid[l.openid].entries.push(l)
      if (l.name) byOpenid[l.openid].name = l.name
    }
    const groups = Object.keys(byOpenid).map(k => byOpenid[k]).filter(g => Math.abs(g.total) > 0.001)
      .sort((a, b) => b.total - a.total)
    const total = groups.reduce((s2, g) => s2 + g.total, 0)
    // 我自己的（全员可看自己的）
    const mine = byOpenid[openid] || { total: 0, entries: [] }
    return { success: true, groups, total, myTotal: mine.total, myEntries: mine.entries }
  }

  // 还借款（账房先生）：金库记一笔 out（钱真还出去）+ 借款台账记负数
  // data:{ targetName, amount, note?, screenshots? }
  if (action === 'repayLoan') {
    const treasurer = await getTreasurerValue()
    if (!treasurer || treasurer.openid !== openid) return { success: false, msg: '只有账房先生能还借款' }
    try { await db.createCollection('loans') } catch (e) {}
    const targetName = (data.targetName || '').trim()
    const amount = Number(data.amount) || 0
    if (!targetName) return { success: false, msg: '请选择还给谁' }
    if (!(amount > 0)) return { success: false, msg: '还款金额要大于 0' }
    const m = await db.collection('members').where({ name: targetName }).limit(1).get()
    if (m.data.length === 0 || !m.data[0].openid) return { success: false, msg: '营员不存在或未绑定身份' }
    const targetOpenid = m.data[0].openid

    // 校验不超还
    const his = (await db.collection('loans').where({ openid: targetOpenid }).limit(1000).get()).data
    const owed = his.reduce((s2, l) => s2 + (Number(l.amount) || 0), 0)
    if (amount > owed + 0.001) return { success: false, msg: `村里只欠「${targetName}」¥${owed.toFixed(2)}，不能还更多` }

    // 金库真出账
    const txn = await db.collection('transactions').add({ data: {
      type: 'out', amount,
      note: `还借款：${targetName}${data.note ? ('（' + data.note + '）') : ''}`,
      operatorName: treasurer.name, openid,
      payerName: targetName, payerOpenid: targetOpenid,
      screenshots: data.screenshots || [],
      kind: 'loan_repay',
      createdAt: new Date()
    }})
    await db.collection('loans').add({ data: {
      openid: targetOpenid, name: targetName, amount: -amount,
      note: '还款' + (data.note ? ('：' + data.note) : ''),
      source: 'repay', txnId: txn._id,
      by: openid, byName: treasurer.name,
      createdAt: new Date()
    }})
    await db.collection('logs').add({ data: {
      type: 'money_out', note: `还借款：${targetName}`, amount, operatorName: treasurer.name, openid, createdAt: new Date()
    }})
    return { success: true, remaining: owed - amount }
  }

  // ====== 一次性运维：把历史"当收入记"的出资，补进出资台账（不动金库）======
  // 背景：早期「初期投入资金-XXX」是用「记录收支」记的，钱已进金库，但没建 contributions 记录，
  // 导致这些人不在出资台账、不被推导为股东（没有表决权、无资本股依据）。
  // 做法：只补 contributions 记录并挂到原流水 txnId 上，【不新建 transactions】——避免余额翻倍。
  // 幂等：已挂过的流水（contributions 里存在同 txnId）自动跳过，跑几遍都安全。
  // 不带 confirm='MIGRATE' 时只预览。data:{ keyword?, confirm?, mapping? }
  if (action === 'migrateInitialContributions') {
    const treasurer = await getTreasurerValue()
    if (!treasurer || treasurer.openid !== openid) return { success: false, msg: '只有账房先生能做出资台账迁移' }
    try { await db.createCollection('contributions') } catch (e) {}

    // ---- 手工指定模式（一笔钱拆给多人、名字对不上、代出关系，都走这里）----
    // data.entries = [{ noteContains|txnId, name, amount, note?, paidByName? }]
    // 幂等键 = 同一流水 + 同一人，已录过自动跳过；一笔流水可拆给多人各一条。
    if (Array.isArray(data.entries) && data.entries.length > 0) {
      const allTxn = (await db.collection('transactions').where({ type: 'in' }).limit(1000).get()).data
      const cons0 = (await db.collection('contributions').limit(1000).get()).data
      const rep = []
      let done = 0, skip2 = 0
      for (const en of data.entries) {
        const amt = Number(en.amount) || 0
        const nm = (en.name || '').trim()
        if (!nm || !(amt > 0)) { skip2++; rep.push({ name: nm, amount: amt, msg: '参数不全，跳过' }); continue }
        // 定位流水：优先 txnId，其次备注包含
        let t = null
        if (en.txnId) t = allTxn.find(x => x._id === en.txnId)
        else if (en.noteContains) {
          const ms = allTxn.filter(x => (x.note || '').indexOf(en.noteContains) >= 0)
          if (ms.length > 1) { skip2++; rep.push({ name: nm, amount: amt, msg: `备注「${en.noteContains}」匹配到${ms.length}条，请改用 txnId` }); continue }
          t = ms[0]
        }
        if (!t) { skip2++; rep.push({ name: nm, amount: amt, msg: '找不到对应流水，跳过' }); continue }
        // 幂等：同流水同人已录过
        if (cons0.some(c => c.txnId === t._id && c.name === nm)) { skip2++; rep.push({ name: nm, amount: amt, msg: '已录过，跳过' }); continue }
        const mm = await db.collection('members').where({ name: nm }).limit(1).get()
        if (mm.data.length === 0 || !mm.data[0].openid) { skip2++; rep.push({ name: nm, amount: amt, msg: '营员不存在或未绑定身份，跳过' }); continue }
        rep.push({ name: nm, amount: amt, txnNote: t.note, paidByName: en.paidByName || '', msg: '待补入台账' })
        if (data.confirm !== 'MIGRATE') continue
        const noteTxt = (en.note || '初始投入（历史补录）') + (en.paidByName ? `｜由 ${en.paidByName} 代出` : '')
        await db.collection('contributions').add({ data: {
          openid: mm.data[0].openid, name: nm, amount: amt,
          note: noteTxt,
          paidByName: en.paidByName || '',        // 代出人：钱谁掏的（股算本人的，钱谁出的另记）
          by: openid, byName: treasurer.name,
          txnId: t._id, migratedFromTxn: true,
          createdAt: t.createdAt || new Date()
        }})
        try { await db.collection('transactions').doc(t._id).update({ data: { kind: 'contribution' } }) } catch (e) {}
        done++
      }
      return { success: true, mode: data.confirm === 'MIGRATE' ? '已执行' : '仅预览', manual: true, migrated: done, skipped: skip2, report: rep }
    }

    const keyword = (data && data.keyword) || '投入资金'   // 兼容「初期/初始投入资金」两种写法
    const mapping = (data && data.mapping) || {}   // 可选：{流水备注里的名字: 实际营员名}，解决名字对不上

    // 取全部收入流水（分页，避免截断）
    let txns = [], skip = 0
    while (true) {
      const r = await db.collection('transactions').where({ type: 'in' })
        .orderBy('createdAt', 'asc').skip(skip).limit(1000).get()
      txns = txns.concat(r.data)
      if (r.data.length < 1000) break
      skip += 1000
    }
    const hits = txns.filter(t => (t.note || '').indexOf(keyword) >= 0)

    // 已经挂过出资的流水 txnId 集合（幂等基准）
    const existed = {}
    const cons = (await db.collection('contributions').limit(1000).get()).data
    cons.forEach(c => { if (c.txnId) existed[c.txnId] = true })

    const report = []
    let migrated = 0, skipped = 0
    for (const t of hits) {
      const amount = Number(t.amount) || 0
      if (existed[t._id]) { skipped++; report.push({ txnId: t._id, note: t.note, amount, msg: '已在出资台账，跳过' }); continue }
      if (!(amount > 0)) { skipped++; report.push({ note: t.note, amount, msg: '金额异常，跳过' }); continue }

      // 从备注里解析人名：取分隔符后的部分，如「初期投入资金-锦铭」→ 锦铭
      let raw = String(t.note || '')
      let name = raw.split(/[-－:：]/).pop().trim()
      if (mapping[name]) name = mapping[name]
      if (!name) { skipped++; report.push({ note: t.note, amount, msg: '解析不出人名，跳过' }); continue }

      const m = await db.collection('members').where({ name }).limit(1).get()
      if (m.data.length === 0) { skipped++; report.push({ txnId: t._id, note: t.note, amount, name, msg: '找不到该营员，可用 entries 手工指定' }); continue }
      if (!m.data[0].openid) { skipped++; report.push({ note: t.note, amount, name, msg: '该营员未绑定身份，跳过' }); continue }

      report.push({ txnId: t._id, note: t.note, amount, name, msg: '待补入台账' })
      if (data.confirm !== 'MIGRATE') continue

      // 只建 contributions，不建 transactions；时间沿用原流水，台账里日期不错乱
      await db.collection('contributions').add({ data: {
        openid: m.data[0].openid, name, amount,
        note: '初期投入（历史补录）',
        by: openid, byName: treasurer.name,
        txnId: t._id, migratedFromTxn: true,
        createdAt: t.createdAt || new Date()
      }})
      // 原流水标成出资类，口径统一（不改金额、不改类型，余额不受影响）
      try { await db.collection('transactions').doc(t._id).update({ data: { kind: 'contribution' } }) } catch (e) {}
      migrated++
    }
    return {
      success: true,
      mode: data.confirm === 'MIGRATE' ? '已执行' : '仅预览',
      keyword, found: hits.length, migrated, skipped, report
    }
  }

  return { success: false, msg: 'unknown action' }
}