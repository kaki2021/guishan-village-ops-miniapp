const AVATAR_COLORS = [
  { bg: '#dbeafe', color: '#1d4ed8' },
  { bg: '#dcfce7', color: '#15803d' },
  { bg: '#fef9c3', color: '#854d0e' },
  { bg: '#fce7f3', color: '#9d174d' },
  { bg: '#ede9fe', color: '#6d28d9' },
  { bg: '#ffedd5', color: '#9a3412' }
]

// 强度 5 档（与 taskManager / tasks 页一致）。头衔工作内容 = 工时 × 强度系数。
const TITLE_INTENSITY = [
  { v: 1, name: '非常轻', coef: 0.6 },
  { v: 2, name: '比较轻', coef: 0.8 },
  { v: 3, name: '中等',   coef: 1.0 },
  { v: 4, name: '比较重', coef: 1.2 },
  { v: 5, name: '非常重', coef: 1.4 }
]
const INT_SHORT = { 1: '很轻', 2: '较轻', 3: '中', 4: '较重', 5: '很重' }
const WEEKDAYS = [{ v: 1, t: '一' }, { v: 2, t: '二' }, { v: 3, t: '三' }, { v: 4, t: '四' }, { v: 5, t: '五' }, { v: 6, t: '六' }, { v: 7, t: '日' }]
function titleCoef(v) { const m = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.2, 5: 1.4 }; return m[v] || 1.0 }
function titleXp(hours, intensity) { const h = Number(hours) || 0; return Math.round(h * titleCoef(intensity) * 100) / 100 }
// 头衔工作内容的一句话展示；没填工时/强度则返回 ''（纯称号）
function titleDutyText(t) {
  if (!(t && Number(t.hours) > 0 && [1, 2, 3, 4, 5].includes(t.intensity))) return ''
  const xp = titleXp(t.hours, t.intensity)
  const st = t.schedType || 'daily'
  let when = '每天', suffix = ''
  if (st === 'weekly') {
    const wd = (t.schedWeekdays || []).map(n => '一二三四五六日'[n - 1]).join('')
    when = wd ? ('每周' + wd) : '每周'; suffix = '/次'
  } else if (st === 'monthly') {
    const ds = (t.schedDays || []).join('·')
    when = ds ? ('每月' + ds + '号') : '每月'; suffix = '/次'
  }
  return `${when} ${t.hours}h·${INT_SHORT[t.intensity]} +${xp}xp${suffix}`
}

Page({
  data: {
    showModal: false,
    newName: '',
    newRole: '',
    newIcon: '',
    newApplyNote: '',
    roles: ['建设者', '创作者', '补给者', '向导', '管家', '厨师'],
    members: [],
    _rawMembers: [],
    myName: '',
    myStatus: 'active',          // active / pending_review / pending_vote
    iAmSupervisor: false,
    iAmHeadman: false,
    canManageTitles: false,      // 主管或执事
    canSeeApplications: false,   // 主管或执事
    supervisors: [],
    keepers: [],
    titleTypes: [],
    titleHolders: [],
    shareholders: [],
    headman: null,
    sites: [],
    roster: [],
    proposals: [],
    applReview: [],              // 待初审申请
    applVoteCount: 0,            // 表决中的加入申请数
    showEditMemberModal: false,
    editOldName: '',
    editMemberName: '',
    editMemberRole: '',
    editMemberIcon: '',
    showActionMenu: false,
    amName: '',
    amItems: [],
    amSupSites: [],
    amKeepSites: [],
    amTitles: [],
    showPickMenu: false,
    pickTitle: '',
    pickItems: [],
    // 头衔工作内容表单
    tfIntensityOptions: TITLE_INTENSITY,
    showTitleForm: false,
    tfMode: 'add',          // add / edit
    tfTitleId: '',
    tfName: '',
    tfDutyNote: '',
    tfHours: '',
    tfIntensity: 3,
    tfSchedType: 'daily',     // daily / weekly / monthly
    tfChecklist: [],          // 工作清单 [{id,text}]：每次履职要勾的事项（只留痕，不影响 XP）
    tfClGenerating: false,
    tfWeekdays: [],           // 周几 [1..7]
    tfMonthDays: '',          // 几号，逗号分隔 "1,3,15"
    weekdayOptions: WEEKDAYS,
    tfReviseLog: [],
    tfXpPreview: 0,
    tfAiJudging: false
  },

  async onShow() {
    let myName = wx.getStorageSync('myName') || ''
    this.setData({ myName })

    try {
      await wx.cloud.callFunction({ name: 'memberManager', data: { action: 'initCollections' } })
      const res = await wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMyName' } })
      const r = res.result || {}
      const serverName = r.name || ''
      if (serverName !== myName) {
        wx.setStorageSync('myName', serverName)
        const app = getApp()
        if (app && app.globalData) app.globalData.myName = serverName
      }
      this.setData({ myName: serverName, myStatus: r.status || 'active' })
    } catch (e) {}

    this.loadMembers()
    this.loadRoles()
    this.loadProposals()
  },

  goPersonal() { wx.navigateTo({ url: '/pages/personal/index' }) },

  loadMembers() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } })
      .then(res => {
        this.setData({ _rawMembers: res.result.list || [] }, () => this.decorate())
      }).catch(() => wx.showToast({ title: '加载失败', icon: 'none' }))
  },

  // 用 shareholders 给花名册标股东
  decorate() {
    const myName = this.data.myName
    const shNames = new Set((this.data.shareholders || []).map(s => s.name))
    const sorted = (this.data._rawMembers || []).slice().sort((a, b) => (b.weekXp || 0) - (a.weekXp || 0))
    const list = sorted.map((m, i) => {
      const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
      const xpPercent = Math.min(100, Math.floor((m.xp % 500) / 500 * 100))
      return Object.assign({}, m, {
        avatarBg: color.bg,
        avatarColor: color.color,
        avatarText: (m.name || '').length > 4 ? m.name.slice(0, 3) : m.name,
        xpPercent,
        isMe: m.name === myName,
        isShareholder: shNames.has(m.name)
      })
    })
    this.setData({ members: list })
  },

  loadRoles() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getRoles' } })
      .then(res => {
        const r = res.result || {}
        const me = r.me || {}
        const canManageTitles = !!(me.isSupervisor || me.isHeadman)
        this.setData({
          iAmSupervisor: !!me.isSupervisor,
          iAmHeadman: !!me.isHeadman,
          canManageTitles,
          canSeeApplications: canManageTitles,
          supervisors: r.supervisors || [],
          keepers: r.keepers || [],
          titleTypes: r.titleTypes || [],
          titleHolders: r.titleHolders || [],
          shareholders: r.shareholders || [],
          headman: r.headman || null,
          sites: r.sites || [],
          roster: this._enrichRoster(r.roster || [], r.titleTypes || [])
        }, () => this.decorate())
        if (canManageTitles) this.loadApplications()
      }).catch(() => {})
  },

  // 给名册里的头衔条目补一句「工作内容」展示
  _enrichRoster(roster, titleTypes) {
    const byId = {}
    titleTypes.forEach(t => { byId[t.id] = t })
    return (roster || []).map(g => Object.assign({}, g, {
      entries: (g.entries || []).map(en => {
        if (en.kind === 'title' && en.titleId && byId[en.titleId]) {
          return Object.assign({}, en, { duty: titleDutyText(byId[en.titleId]) })
        }
        return Object.assign({}, en, { duty: '' })
      })
    }))
  },

  loadProposals() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getProposals' } })
      .then(res => {
        const all = (res.result.list || [])
        const open = all.filter(p => p.status === 'open')
        const recent = all.filter(p => p.status !== 'open').slice(0, 5)
        this.setData({ proposals: open.concat(recent) })
      }).catch(() => {})
  },

  loadApplications() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getApplications' } })
      .then(res => {
        const r = res.result || {}
        this.setData({ applReview: r.pendingReview || [], applVoteCount: (r.pendingVote || []).length })
      }).catch(() => {})
  },

  refreshAll() { this.loadMembers(); this.loadRoles(); this.loadProposals() },

  tapMember(e) {
    const name = e.currentTarget.dataset.name
    const myName = this.data.myName
    if (!myName) { wx.showToast({ title: '请用「加入村落」按钮加入', icon: 'none' }); return }
    if (name === myName) { wx.navigateTo({ url: '/pages/personal/index' }); return }
    wx.showToast({ title: `已是「${myName}」，无法切换`, icon: 'none' })
  },

  // ---- 小工具 ----
  siteName(id) { const s = (this.data.sites || []).find(x => x.id === id); return s ? s.name : (id || '通用') },
  personSites(roleList, name) {
    return (roleList || []).filter(x => x.name === name).map(x => ({ id: x.siteId, name: this.siteName(x.siteId) }))
  },
  personTitles(name) {
    const types = this.data.titleTypes || []
    return (this.data.titleHolders || []).filter(h => h.name === name).map(h => ({
      titleId: h.titleId,
      titleName: (types.find(t => t.id === h.titleId) || {}).name || '头衔',
      siteId: h.siteId || '',
      siteName: h.siteId ? this.siteName(h.siteId) : '通用'
    }))
  },

  pickSite(title, cb) {
    const sites = this.data.sites || []
    if (sites.length === 0) { wx.showToast({ title: '还没有任何地方，请先到仓库页建地方', icon: 'none' }); return }
    if (sites.length === 1) { cb(sites[0].id); return }
    this._openPick('选择地方', sites.map(s => ({ label: s.name })), sites.map(s => s.id), cb)
  },
  pickFrom(list, title, cb) {
    if (!list || list.length === 0) { wx.showToast({ title: '没有可操作的项', icon: 'none' }); return }
    if (list.length === 1) { cb(list[0]); return }
    this._openPick(title || '选择', list.map(x => ({ label: x.label })), list, cb)
  },
  pickScope(title, cb) {
    const opts = [{ id: '', name: '通用' }].concat((this.data.sites || []).map(s => ({ id: s.id, name: s.name })))
    this._openPick(title || '选择范围', opts.map(o => ({ label: o.name })), opts.map(o => o.id), cb)
  },
  // 通用单列选择菜单（与操作菜单同款外观）：items=[{label,extra?}]，raw=回调要拿到的值数组
  _openPick(title, items, raw, cb) {
    this._pickRaw = raw
    this._pickCb = cb
    this.setData({ showPickMenu: true, pickTitle: title, pickItems: items })
  },
  tapPickItem(e) {
    const i = e.currentTarget.dataset.index
    const raw = (this._pickRaw || [])[i]
    const cb = this._pickCb
    this.setData({ showPickMenu: false })
    if (cb) cb(raw)
  },
  hidePickMenu() { this.setData({ showPickMenu: false }) },

  longPressMember(e) {
    const { name, role, icon } = e.currentTarget.dataset

    if (name === this.data.myName) {
      wx.showActionSheet({
        itemList: ['编辑信息'],
        success: (res) => {
          if (res.tapIndex === 0) this.setData({ showEditMemberModal: true, editOldName: name, editMemberName: name, editMemberRole: role, editMemberIcon: icon || '' })
        }
      })
      return
    }

    const { iAmSupervisor, iAmHeadman, canManageTitles, supervisors, keepers, headman } = this.data
    const bootstrap = supervisors.length === 0
    const canManageRole = iAmSupervisor || bootstrap

    if (!canManageRole && !canManageTitles && !iAmHeadman) {
      wx.showToast({ title: '只能编辑自己的档案', icon: 'none' })
      return
    }

    if (bootstrap && canManageRole) {
      wx.showActionSheet({
        itemList: [`设「${name}」为主管`],
        success: (res) => { if (res.tapIndex === 0) this.pickSite(`设「${name}」为哪个地方主管`, (siteId) => this.setRoleSite('supervisor', name, siteId)) }
      })
      return
    }

    const supSites = this.personSites(supervisors, name)
    const keepSites = this.personSites(keepers, name)
    const titles = this.personTitles(name)
    const isHeadman = !!(headman && headman.name === name)

    const items = []
    if (iAmSupervisor) {
      items.push({ key: 'addSup', icon: '👑', action: '设为主管', extra: '选地方' })
      if (supSites.length) items.push({ key: 'delSup', icon: '👑', action: '取消主管', extra: supSites.map(s => s.name).join('/') })
      items.push({ key: 'addKeep', icon: '📦', action: '设为库管', extra: '选地方' })
      if (keepSites.length) items.push({ key: 'delKeep', icon: '📦', action: '取消库管', extra: keepSites.map(s => s.name).join('/') })
      items.push({ key: isHeadman ? 'delHead' : 'addHead', icon: '🎖', action: isHeadman ? '免去执事' : '设为执事', extra: '' })
    }
    if (canManageTitles) {
      items.push({ key: 'addTitle', icon: '🏷', action: '挂头衔', extra: '' })
      if (titles.length) items.push({ key: 'delTitle', icon: '✂', action: '摘掉头衔', extra: titles.map(t => t.titleName).join('/') })
    }
    if (iAmHeadman) {
      items.push({ key: 'evict', icon: '🚪', action: '发起去留表决', extra: '' })
    }
    if (items.length === 0) { wx.showToast({ title: '你没有可对该成员执行的操作', icon: 'none' }); return }

    // 打开自定义底部菜单（B 方案），并存好分发所需上下文
    this.setData({
      showActionMenu: true,
      amName: name,
      amItems: items,
      amSupSites: supSites,
      amKeepSites: keepSites,
      amTitles: titles
    })
  },

  hideActionMenu() { this.setData({ showActionMenu: false }) },

  tapActionMenuItem(e) {
    const key = e.currentTarget.dataset.key
    const name = this.data.amName
    const supSites = this.data.amSupSites || []
    const keepSites = this.data.amKeepSites || []
    const titles = this.data.amTitles || []
    this.setData({ showActionMenu: false })
    if (key === 'addSup') this.pickSite(`设「${name}」为哪个地方主管`, (s) => this.setRoleSite('supervisor', name, s))
    else if (key === 'delSup') this.pickFrom(supSites.map(s => ({ label: s.name, id: s.id })), `取消「${name}」哪个地方主管`, (o) => this.removeRoleSite('supervisor', name, o.id))
    else if (key === 'addKeep') this.pickSite(`设「${name}」为哪个地方库管`, (s) => this.setRoleSite('keeper', name, s))
    else if (key === 'delKeep') this.pickFrom(keepSites.map(s => ({ label: s.name, id: s.id })), `取消「${name}」哪个地方库管`, (o) => this.removeRoleSite('keeper', name, o.id))
    else if (key === 'addHead') this.setHeadman(name)
    else if (key === 'delHead') this.removeHeadman(name)
    else if (key === 'addTitle') this.assignTitleFlow(name)
    else if (key === 'delTitle') this.unassignTitleFlow(name, titles)
    else if (key === 'evict') this.proposeEvictionFlow(name)
  },

  // ---- 角色（主管/库管，按地方）----
  setRoleSite(role, name, siteId) {
    this._call('setRole', { role, targetName: name, siteId }, (res) => {
      const label = role === 'supervisor' ? '主管' : '库管'
      const sn = res.siteName || this.siteName(siteId)
      wx.showToast({ title: res.already ? `已是${sn}${label}` : `已设为${sn}${label}`, icon: 'success' })
    })
  },
  removeRoleSite(role, name, siteId) {
    this._call('removeRole', { role, targetName: name, siteId }, () => {
      wx.showToast({ title: `已取消${this.siteName(siteId)}${role === 'supervisor' ? '主管' : '库管'}`, icon: 'success' })
    })
  },

  // ---- 执事 ----
  setHeadman(name) { this._call('setHeadman', { targetName: name }, () => wx.showToast({ title: `已设「${name}」为执事`, icon: 'success' })) },
  removeHeadman(name) {
    wx.showModal({ title: '免去执事', content: `确认免去「${name}」的执事职务？`, success: (r) => { if (r.confirm) this._call('removeHeadman', {}, () => wx.showToast({ title: '已免去', icon: 'success' })) } })
  },

  // ---- 头衔 ----
  assignTitleFlow(name) {
    const types = this.data.titleTypes || []
    if (types.length === 0) { wx.showToast({ title: '还没有头衔种类，先在「⚙头衔」里新增', icon: 'none' }); return }
    this._openPick('选择头衔', types.map(t => ({ label: t.name })), types, (t) => {
      this.pickScope('选择范围', (siteId) => {
        this._call('assignTitle', { targetName: name, titleId: t.id, siteId }, (res) => {
          wx.showToast({ title: res.already ? '已有该头衔' : `已挂「${t.name}」`, icon: 'success' })
        })
      })
    })
  },
  unassignTitleFlow(name, titles) {
    this.pickFrom(titles.map(t => ({ label: `${t.titleName}·${t.siteName}`, titleId: t.titleId, siteId: t.siteId })), '摘掉', (o) => {
      this._call('unassignTitle', { targetName: name, titleId: o.titleId, siteId: o.siteId }, () => wx.showToast({ title: '已摘掉', icon: 'success' }))
    })
  },
  manageTitleTypes() {
    wx.showActionSheet({
      itemList: ['新增头衔', '编辑头衔工作内容', '删除头衔'],
      success: (a) => {
        if (a.tapIndex === 0) {
          this.openTitleAdd()
        } else if (a.tapIndex === 1) {
          const types = this.data.titleTypes || []
          if (types.length === 0) { wx.showToast({ title: '还没有头衔种类', icon: 'none' }); return }
          this._openPick('编辑哪个头衔', types.map(t => ({ label: t.name + (titleDutyText(t) ? '（' + titleDutyText(t) + '）' : '（纯称号）') })), types, (t) => this.openTitleEdit(t))
        } else {
          const types = this.data.titleTypes || []
          if (types.length === 0) { wx.showToast({ title: '还没有头衔种类', icon: 'none' }); return }
          wx.showActionSheet({
            itemList: types.map(t => `删除「${t.name}」`),
            success: (b) => {
              const t = types[b.tapIndex]
              this._call('removeTitleType', { titleId: t.id }, () => wx.showToast({ title: '已删除', icon: 'success' }))
            }
          })
        }
      }
    })
  },

  // ---- 头衔工作内容表单（新增/编辑共用）----
  openTitleAdd() {
    this.setData({
      showTitleForm: true, tfMode: 'add', tfTitleId: '',
      tfName: '', tfDutyNote: '', tfHours: '', tfIntensity: 3,
      tfSchedType: 'daily', tfWeekdays: [], tfMonthDays: '', tfReviseLog: [], tfXpPreview: 0,
      tfChecklist: [], tfClGenerating: false
    })
  },
  openTitleEdit(t) {
    const hours = Number(t.hours) > 0 ? t.hours : ''
    const intensity = [1, 2, 3, 4, 5].includes(t.intensity) ? t.intensity : 3
    const log = (Array.isArray(t.reviseLog) ? t.reviseLog : []).map((r, i) => {
      const d = r.time ? new Date(r.time) : null
      const ts = d ? ((d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')) : ''
      return { idx: i, field: r.field, from: r.from, to: r.to, operator: r.operator || '', timeStr: ts }
    }).reverse()   // 最新在上
    this.setData({
      showTitleForm: true, tfMode: 'edit', tfTitleId: t.id,
      tfName: t.name || '', tfDutyNote: t.dutyNote || '',
      tfHours: hours === '' ? '' : String(hours),
      tfIntensity: intensity,
      tfChecklist: Array.isArray(t.checklist) ? t.checklist.map(c => ({ id: c.id, text: c.text })) : [],
      tfClGenerating: false,
      tfSchedType: ['daily', 'weekly', 'monthly'].includes(t.schedType) ? t.schedType : 'daily',
      tfWeekdays: Array.isArray(t.schedWeekdays) ? t.schedWeekdays.slice() : [],
      tfMonthDays: Array.isArray(t.schedDays) ? t.schedDays.join(',') : '',
      tfReviseLog: log,
      tfXpPreview: hours === '' ? 0 : titleXp(hours, intensity)
    })
  },
  hideTitleForm() { this.setData({ showTitleForm: false }) },
  setTfField(e) {
    const f = e.currentTarget.dataset.field
    const patch = { [f]: e.detail.value }
    if (f === 'tfHours') patch.tfXpPreview = titleXp(e.detail.value, this.data.tfIntensity)
    this.setData(patch)
  },
  selectTfIntensity(e) {
    const v = Number(e.currentTarget.dataset.v)
    this.setData({ tfIntensity: v, tfXpPreview: titleXp(this.data.tfHours, v) })
  },
  selectTfSchedType(e) { this.setData({ tfSchedType: e.currentTarget.dataset.t }) },
  toggleTfWeekday(e) {
    const v = Number(e.currentTarget.dataset.v)
    const arr = (this.data.tfWeekdays || []).slice()
    const i = arr.indexOf(v)
    if (i >= 0) arr.splice(i, 1); else arr.push(v)
    arr.sort((a, b) => a - b)
    this.setData({ tfWeekdays: arr })
  },
  setTfMonthDays(e) { this.setData({ tfMonthDays: e.detail.value }) },
  // AI 帮判头衔工作内容：用头衔名+说明估「一次干完」的工时+强度（复用 aiSuggestXp）
  tfAiJudge() {
    const name = (this.data.tfName || '').trim()
    if (!name) { wx.showToast({ title: '先填头衔名', icon: 'none' }); return }
    this.setData({ tfAiJudging: true })
    wx.cloud.callFunction({
      name: 'aiSuggestXp',
      data: { taskName: name, taskDesc: this.data.tfDutyNote || '', existingTypes: [] }
    }).then(res => {
      const r = res.result || {}
      const hours = (typeof r.hours === 'number' && r.hours > 0) ? r.hours : 2
      const intensity = [1, 2, 3, 4, 5].includes(r.intensity) ? r.intensity : 3
      this.setData({
        tfAiJudging: false,
        tfHours: String(hours), tfIntensity: intensity,
        tfXpPreview: titleXp(hours, intensity)
      })
      wx.showToast({ title: 'AI 已填，可改', icon: 'none' })
    }).catch(() => {
      this.setData({ tfAiJudging: false })
      wx.showToast({ title: 'AI 判断失败，手动填即可', icon: 'none' })
    })
  },
  // ---- 工作清单：手动增删改 ----
  addClItem() {
    const cl = (this.data.tfChecklist || []).slice()
    if (cl.length >= 10) { wx.showToast({ title: '最多 10 条', icon: 'none' }); return }
    cl.push({ id: 'ck' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), text: '' })
    this.setData({ tfChecklist: cl })
  },
  setClItem(e) {
    const i = e.currentTarget.dataset.index
    const cl = (this.data.tfChecklist || []).slice()
    if (!cl[i]) return
    cl[i] = Object.assign({}, cl[i], { text: e.detail.value })
    this.setData({ tfChecklist: cl })
  },
  delClItem(e) {
    const i = e.currentTarget.dataset.index
    const cl = (this.data.tfChecklist || []).slice()
    cl.splice(i, 1)
    this.setData({ tfChecklist: cl })
  },
  // ---- AI 帮我列清单（复用 aiStockIn 云函数的 genChecklist）----
  aiGenChecklist() {
    const name = (this.data.tfName || '').trim()
    if (!name) { wx.showToast({ title: '先填头衔名', icon: 'none' }); return }
    const has = (this.data.tfChecklist || []).some(c => (c.text || '').trim())
    const run = () => {
      this.setData({ tfClGenerating: true })
      wx.cloud.callFunction({
        name: 'aiStockIn',
        data: { action: 'genChecklist', data: { title: name, dutyNote: this.data.tfDutyNote || '', schedText: this.data.tfSchedType } }
      }).then(res => {
        this.setData({ tfClGenerating: false })
        const r = res.result || {}
        if (!r.success) { wx.showModal({ title: '生成失败', content: r.msg || 'AI 没能生成', showCancel: false }); return }
        const cl = (r.items || []).slice(0, 10).map((t, i) => ({
          id: 'ck' + Date.now().toString(36) + i.toString(36),
          text: String(t || '').trim()
        })).filter(c => c.text)
        this.setData({ tfChecklist: cl })
        wx.showToast({ title: 'AI 已列，可改', icon: 'none' })
      }).catch(() => {
        this.setData({ tfClGenerating: false })
        wx.showToast({ title: 'AI 调用失败', icon: 'none' })
      })
    }
    // 已有内容先确认，别把人手写的冲掉
    if (has) {
      wx.showModal({ title: 'AI 帮我列', content: '会覆盖当前清单，继续？', success: (r) => { if (r.confirm) run() } })
    } else run()
  },

  submitTitleForm() {
    const name = (this.data.tfName || '').trim()
    if (!name) { wx.showToast({ title: '请填头衔名', icon: 'none' }); return }
    const hours = Number(this.data.tfHours)
    const payload = { name, dutyNote: this.data.tfDutyNote || '', schedType: this.data.tfSchedType }
    if (this.data.tfSchedType === 'weekly') {
      if (!(this.data.tfWeekdays || []).length) { wx.showToast({ title: '请选周几', icon: 'none' }); return }
      payload.schedWeekdays = this.data.tfWeekdays
    } else if (this.data.tfSchedType === 'monthly') {
      const days = String(this.data.tfMonthDays || '').split(/[，,、\s]+/).map(s => parseInt(s)).filter(n => n >= 1 && n <= 31)
      if (!days.length) { wx.showToast({ title: '请填几号（如 1,3,15）', icon: 'none' }); return }
      payload.schedDays = days
    }
    if (hours > 0) { payload.hours = hours; payload.intensity = this.data.tfIntensity }
    payload.checklist = (this.data.tfChecklist || [])
      .map(c => ({ id: c.id, text: (c.text || '').trim() }))
      .filter(c => c.text)
    if (this.data.tfMode === 'edit') payload.titleId = this.data.tfTitleId
    const action = this.data.tfMode === 'edit' ? 'editTitleType' : 'addTitleType'
    const isEdit = this.data.tfMode === 'edit'
    this.setData({ showTitleForm: false })
    this._call(action, payload, () => wx.showToast({ title: isEdit ? '已保存' : '已新增', icon: 'success' }))
  },

  // ---- 人员流动表决 ----
  proposeEvictionFlow(name) {
    wx.showModal({
      title: `发起「${name}」去留表决`, editable: true, placeholderText: '说明原因（可选）',
      success: (r) => {
        if (!r.confirm) return
        this._call('proposeEviction', { targetName: name, reason: r.content || '' }, (res) => {
          wx.showToast({ title: `已发起，需 ${res.needed}/${res.poolSize} 票`, icon: 'none' })
        })
      }
    })
  },
  voteProposal(e) {
    const { id, agree } = e.currentTarget.dataset
    this._call('voteProposal', { id, agree: agree === 'yes' }, (res) => {
      const msg = res.decided === 'passed' ? '表决通过' : res.decided === 'rejected' ? '表决未通过' : '已投票'
      wx.showToast({ title: msg, icon: 'none' })
    })
  },
  withdrawProposal(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '撤回表决', content: '确认撤回这条表决？', success: (r) => { if (r.confirm) this._call('withdrawProposal', { id }, () => wx.showToast({ title: '已撤回', icon: 'success' })) } })
  },

  // ---- 加入申请初审（执事）----
  reviewApplication(e) {
    const { id, name, pass } = e.currentTarget.dataset
    if (pass === 'yes') {
      this._call('reviewApplication', { id, pass: true }, (res) => {
        wx.showToast({ title: res.instant ? '已直接通过' : `已提交股东表决（需 ${res.needed}/${res.poolSize}）`, icon: 'none' })
      })
    } else {
      wx.showModal({
        title: `驳回「${name}」`, editable: true, placeholderText: '驳回原因（可选）',
        success: (r) => { if (r.confirm) this._call('reviewApplication', { id, pass: false, reason: r.content || '' }, () => wx.showToast({ title: '已驳回', icon: 'none' })) }
      })
    }
  },

  // 统一的云调用 + 刷新
  _call(action, data, onOk) {
    wx.showLoading({ title: '处理中...', mask: true })
    wx.cloud.callFunction({ name: 'memberManager', data: { action, data } })
      .then(res => {
        wx.hideLoading()
        if (!res.result || !res.result.success) {
          const msg = (res.result && res.result.msg) || '操作失败'
          if (msg === 'unknown action') {
            wx.showModal({ title: '云函数需更新', content: `云端的 memberManager 还没有「${action}」这个功能，请在开发者工具里把 memberManager「上传并部署」后再试。`, showCancel: false })
          } else {
            wx.showToast({ title: msg, icon: 'none' })
          }
          return
        }
        if (onOk) onOk(res.result)
        this.refreshAll()
      }).catch((err) => {
        wx.hideLoading()
        wx.showModal({ title: '调用出错', content: `操作「${action}」失败：${(err && (err.errMsg || err.message)) || '未知错误'}`, showCancel: false })
      })
  },

  // ---- 编辑自己 ----
  setEditMemberField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectEditRole(e) { this.setData({ editMemberRole: e.currentTarget.dataset.val }) },
  hideEditMemberModal() { this.setData({ showEditMemberModal: false }) },
  submitEditMember() {
    const { editOldName, editMemberName, editMemberRole, editMemberIcon, myName } = this.data
    if (!editMemberName || !editMemberRole) { wx.showToast({ title: '请填写完整信息', icon: 'none' }); return }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'editMember', data: { oldName: editOldName, name: editMemberName, role: editMemberRole, icon: editMemberIcon || '🌿' } } })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
        if (editOldName === myName && editMemberName !== myName) {
          wx.setStorageSync('myName', editMemberName)
          const app = getApp(); if (app && app.globalData) app.globalData.myName = editMemberName
          this.setData({ myName: editMemberName })
        }
        this.setData({ showEditMemberModal: false })
        this.refreshAll()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
  },

  // ---- 加入村落 ----
  showAddModal() {
    if (this.data.myName) { wx.showToast({ title: '你已加入村落', icon: 'none' }); return }
    this.setData({ showModal: true, newName: '', newRole: '', newIcon: '', newApplyNote: '' })
  },
  hideModal() { this.setData({ showModal: false }) },
  noop() {},
  setField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  selectRole(e) { this.setData({ newRole: e.currentTarget.dataset.val }) },

  submitMember() {
    const { newName, newRole, newIcon, newApplyNote, myName } = this.data
    if (!newName || !newRole) { wx.showToast({ title: '请填写名字和职业', icon: 'none' }); return }
    if (myName) { wx.showToast({ title: '你已加入村落', icon: 'none' }); return }

    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'joinAsMember', data: { name: newName.trim(), role: newRole, icon: newIcon || '🌿', applyNote: newApplyNote || '' } } })
      .then(res => {
        wx.hideLoading()
        if (!res.result.success) { wx.showToast({ title: res.result.msg || '加入失败', icon: 'none' }); return }
        const finalName = newName.trim()
        wx.setStorageSync('myName', finalName)
        const app = getApp(); if (app && app.globalData) app.globalData.myName = finalName
        const st = res.result.status || 'active'
        this.setData({ myName: finalName, myStatus: st, showModal: false })
        if (res.result.pending) wx.showModal({ title: '申请已提交', content: '已提交加入申请，等待执事初审与股东表决，通过后即成为正式营员。', showCancel: false })
        else wx.showToast({ title: res.result.claimed ? '已认领并加入' : '加入成功！', icon: 'success' })
        this.refreshAll()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加入失败，请重试', icon: 'none' }) })
  }
})