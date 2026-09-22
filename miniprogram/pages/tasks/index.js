const app = getApp()

// 强度 5 档（与云函数 taskManager 一致）。XP = 工时 × 系数。
const INTENSITY = [
  { v: 1, name: '非常轻', short: '很轻', coef: 0.6, hint: '待命/值守' },
  { v: 2, name: '比较轻', short: '较轻', coef: 0.8, hint: '较轻松、能分心' },
  { v: 3, name: '中等',   short: '中',   coef: 1.0, hint: '常规（默认）' },
  { v: 4, name: '比较重', short: '较重', coef: 1.2, hint: '较累、持续出力' },
  { v: 5, name: '非常重', short: '很重', coef: 1.4, hint: '又累又费神/重体力' }
]
const INTENSITY_NAME = { 1: '非常轻', 2: '比较轻', 3: '中等', 4: '比较重', 5: '非常重' }
const INTENSITY_SHORT = { 1: '很轻', 2: '较轻', 3: '中', 4: '较重', 5: '很重' }
function coefOf(v) { const m = { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.2, 5: 1.4 }; return m[v] || 1.0 }
function calcXp(hours, intensity) { const h = Number(hours) || 0; return Math.round(h * coefOf(intensity) * 100) / 100 }
// 强度档颜色分桶（1-2 轻 / 3 中 / 4-5 重），复用既有色板
function intensityClass(v) { return v >= 4 ? 'int-heavy' : (v <= 2 ? 'int-light' : 'int-mid') }
// 老任务无 intensity，用旧 difficulty 反推一个档位仅供显示（high→4, mid→3, low→2）
function diffToIntensity(diff) { return diff === 'high' ? 4 : diff === 'low' ? 2 : diff === 'mid' ? 3 : null }

const DIFF_LABEL = { high: '难度高', mid: '难度中', low: '难度低' }

Page({
  data: {
    showModal: false,
    showNewType: false,
    showTaskDetail: false,
    newName: '',
    newDesc: '',
    newType: '',
    newSiteId: '',
    newDeadline: '',        // 任务截止日期，必填
    newTypeIcon: '',
    newTypeName: '',
    newDeliverables: [],   // AI回填的交付清单（发布前，字符串数组）
    detailTask: null,
    detailNoteText: '',
    // AI 帮判 + 工时/强度（XP = 工时×强度系数，实时算）
    aiJudging: false,
    aiJudged: false,
    intensityOptions: INTENSITY,
    newHours: '',          // 预计工时（可改），字符串便于输入
    newIntensity: 3,       // 强度档，默认中等
    newXpPreview: 0,       // 实时算出的 XP
    // 详情里「改工时/强度」面板
    showRevise: false,
    reviseHours: '',
    reviseIntensity: 3,
    reviseReason: '',
    reviseXpPreview: 0,
    members: [],
    myName: '',
    sites: [],
    myManagedSiteIds: [],
    isGlobalSupervisor: false,
    taskTypes: [],            // 从 config 拉，不再写死
    submitted: [],
    doing: [],
    open: [],
    onhold: [],
    done: []
  },

  onLoad() {
    wx.cloud.callFunction({
      name: 'taskManager',
      data: { action: 'createCollections' }
    }).then(() => { this.loadTasks() })
  },

  onShow() {
    const myName = app.globalData.myName || wx.getStorageSync('myName') || ''
    this.setData({ myName })
    this.loadMembers()
    this.loadMeta()
    this.loadTasks()
  },

  loadMembers() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } })
      .then(res => { this.setData({ members: res.result.list || [] }) })
  },

  // 拉「地方列表 + 我管哪些地方 + 类型库」
  loadMeta() {
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getTaskMeta' } })
      .then(res => {
        const r = res.result || {}
        this.setData({
          sites: r.sites || [],
          myManagedSiteIds: r.myManagedSiteIds || [],
          isGlobalSupervisor: !!r.isGlobalSupervisor,
          taskTypes: (r.taskTypes || []).map(t => ({ icon: t.icon || '📌', name: t.name }))
        }, () => { this.loadTasks() })
      })
      .catch(() => {})
  },

  iCanManageSite(siteId) {
    if (this.data.isGlobalSupervisor) return true
    if (!siteId) return this.data.myManagedSiteIds.length > 0
    return this.data.myManagedSiteIds.includes(siteId)
  },

  siteName(siteId) {
    const s = this.data.sites.find(x => x.id === siteId)
    return s ? s.name : ''
  },

  async loadTasks() {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getTasks' } })
      wx.hideLoading()
      const list = res.result.list || []
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const fmt = t => this.formatTask(t)
      const submitted = list.filter(t => t.status === 'submitted').map(fmt)
      const doing = list.filter(t => t.status === 'doing').map(fmt)
      const open = list.filter(t => t.status === 'open').map(fmt)
      const onhold = list.filter(t => t.status === 'onhold').map(fmt)
      const done = list.filter(t =>
        t.status === 'closed' && t.closeReason === 'completed' &&
        t.closedAt && new Date(t.closedAt) > weekAgo
      ).map(fmt)
      const update = { submitted, doing, open, onhold, done }
      if (this.data.showTaskDetail && this.data.detailTask && this.data.detailTask.id) {
        const fresh = list.find(t => t._id === this.data.detailTask.id)
        if (fresh) update.detailTask = this.formatTask(fresh)
      }
      this.setData(update)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  formatTask(t) {
    const d = new Date(t.publishTime)
    const timeStr = (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2,'0')
    let finishDate = ''
    const closeT = t.closedAt || t.finishTime
    if (closeT) {
      const fd = new Date(closeT)
      finishDate = (fd.getMonth()+1) + '/' + fd.getDate()
    }
    const owners = Array.isArray(t.owners) ? t.owners : (t.owner ? [t.owner] : [])
    const finishedBy = Array.isArray(t.finishedBy) ? t.finishedBy : []
    const myName = this.data.myName
    const ownerChips = owners.map(n => ({ name: n, finished: finishedBy.includes(n) }))
    const ownersText = owners.join('、')
    const notes = (Array.isArray(t.notes) ? t.notes : []).map(n => {
      const nd = new Date(n.createdAt)
      const ts = (nd.getMonth()+1) + '/' + nd.getDate() + ' ' + nd.getHours() + ':' + String(nd.getMinutes()).padStart(2,'0')
      return { name: n.name, text: n.text, timeStr: ts }
    })
    const totalXp = t.xp || 0
    const xpPerOwner = t.xpPerOwner || (owners.length > 0 ? Math.round(totalXp / owners.length * 100) / 100 : totalXp)
    const diff = t.difficulty || null
    // 强度显示：新任务用 intensity；老任务无 intensity 时按 difficulty 反推一个档仅供显示
    const intensity = (t.intensity != null) ? t.intensity : diffToIntensity(diff)
    const hasHours = (typeof t.hours === 'number' && t.hours > 0)
    const deliverables = Array.isArray(t.deliverables) ? t.deliverables.map((d, idx) => ({
      index: idx, text: d.text, done: !!d.done
    })) : []
    const dvDone = deliverables.filter(d => d.done).length
    // 变更记录（认领后改工时/强度）映射成可读
    const reviseLog = (Array.isArray(t.reviseLog) ? t.reviseLog : []).map((r, i) => {
      const rd = r.time ? new Date(r.time) : null
      const ts = rd ? ((rd.getMonth() + 1) + '/' + rd.getDate() + ' ' + rd.getHours() + ':' + String(rd.getMinutes()).padStart(2, '0')) : ''
      const fieldLabel = r.field === 'hours' ? '工时' : (r.field === 'intensity' ? '强度' : r.field)
      const fmtV = (v) => r.field === 'intensity' ? (INTENSITY_NAME[v] || v) : (v + 'h')
      return { idx: i, fieldLabel, fromText: fmtV(r.from), toText: fmtV(r.to), reason: r.reason || '', operator: r.operator || '', timeStr: ts }
    })
    return {
      id: t._id,
      name: t.name,
      desc: t.desc || '',
      type: t.type,
      siteId: t.siteId || '',
      siteName: this.siteName(t.siteId || ''),
      xp: totalXp,
      xpPerOwner,
      hours: hasHours ? t.hours : null,
      intensity: intensity,
      intensityName: intensity ? (INTENSITY_NAME[intensity] || '') : '',
      intensityShort: intensity ? (INTENSITY_SHORT[intensity] || '') : '',
      intensityClass: intensity ? intensityClass(intensity) : '',
      status: t.status,
      closeReason: t.closeReason || null,
      closedBy: t.closedBy || null,
      autoClosed: t.closedBy === 'auto',
      difficulty: diff,
      difficultyLabel: diff ? '· ' + DIFF_LABEL[diff] : '',
      aiDifficultyLabel: diff ? DIFF_LABEL[diff] : '未评',
      owners,
      ownerChips,
      ownersText,
      ownerCount: owners.length,
      finishedBy,
      finishedCount: finishedBy.length,
      isMine: owners.includes(myName),
      isMyFinished: finishedBy.includes(myName),
      isPublisher: !!(t.publisherName && t.publisherName === myName),
      iCanManage: this.iCanManageSite(t.siteId || ''),
      onholdBy: t.onholdBy || '',
      onholdNote: t.onholdNote || '',
      deliverables,
      dvDone,
      dvTotal: deliverables.length,
      notes,
      noteCount: notes.length,
      publisherName: t.publisherName || '',
      publishTime: timeStr,
      finishDate: finishDate,
      reviseLog,
      reviseCount: reviseLog.length
    }
  },

  showAddModal() {
    this.setData({
      showModal: true, newName: '', newDesc: '', newType: '', newSiteId: '', newDeadline: '', showNewType: false,
      aiJudging: false, aiJudged: false, newHours: '', newIntensity: 3, newXpPreview: 0, newDeliverables: []
    })
  },
  hideModal() { this.setData({ showModal: false }) },
  closeTaskDetail() { this.setData({ showTaskDetail: false, detailTask: null, detailNoteText: '', showRevise: false }) },
  noop() {},
  setField(e) {
    const f = e.currentTarget.dataset.field
    const patch = { [f]: e.detail.value }
    if (f === 'newName' || f === 'newDesc') { patch.aiJudged = false }  // 改名/改描述作废上次AI判断
    this.setData(patch)
  },
  selectType(e) { this.setData({ newType: e.currentTarget.dataset.name }) },
  selectSite(e) { this.setData({ newSiteId: e.currentTarget.dataset.id }) },
  setDeadline(e) { this.setData({ newDeadline: e.detail.value }) },
  toggleNewType() { this.setData({ showNewType: !this.data.showNewType }) },

  submitNewType() {
    const { newTypeIcon, newTypeName, taskTypes } = this.data
    if (!newTypeName) { wx.showToast({ title: '请填写类型名称', icon: 'none' }); return }
    // 入库（全村共享，不再只是内存）
    wx.cloud.callFunction({
      name: 'taskManager',
      data: { action: 'addTaskType', data: { name: newTypeName, icon: newTypeIcon || '📌' } }
    }).then(res => {
      const types = (res.result.taskTypes || []).map(t => ({ icon: t.icon || '📌', name: t.name }))
      this.setData({
        taskTypes: types, newType: newTypeName,
        showNewType: false, newTypeIcon: '', newTypeName: ''
      })
    }).catch(() => {
      // 兜底：本地先加上
      this.setData({
        taskTypes: taskTypes.concat([{ icon: newTypeIcon || '📌', name: newTypeName }]),
        newType: newTypeName, showNewType: false, newTypeIcon: '', newTypeName: ''
      })
    })
  },

  // 点「AI 帮判」：判类型+xp+难度+交付清单，回填供确认
  aiJudge() {
    const name = (this.data.newName || '').trim()
    if (!name) { wx.showToast({ title: '先填任务名', icon: 'none' }); return }
    this.setData({ aiJudging: true })
    const existingTypes = (this.data.taskTypes || []).map(t => t.name)
    wx.cloud.callFunction({
      name: 'aiSuggestXp',
      data: { taskName: name, taskDesc: this.data.newDesc || '', taskType: this.data.newType || '', existingTypes }
    }).then(res => {
      const r = res.result || {}
      const tt = r.taskType || this.data.newType || '其他'
      let types = this.data.taskTypes
      if (tt && !types.find(t => t.name === tt)) {
        types = types.concat([{ icon: '📌', name: tt }])
      }
      const hours = (typeof r.hours === 'number' && r.hours > 0) ? r.hours : 2
      const intensity = [1, 2, 3, 4, 5].includes(r.intensity) ? r.intensity : 3
      this.setData({
        aiJudging: false, aiJudged: true,
        taskTypes: types, newType: tt,
        newHours: String(hours), newIntensity: intensity,
        newXpPreview: calcXp(hours, intensity),
        newDeliverables: Array.isArray(r.deliverables) ? r.deliverables : []
      })
      wx.showToast({ title: 'AI 已填，可改', icon: 'none' })
    }).catch(() => {
      this.setData({ aiJudging: false })
      wx.showToast({ title: 'AI 判断失败，手动填工时即可', icon: 'none' })
    })
  },

  // 发布弹窗：改工时 / 选强度 → 实时重算 XP
  setNewHours(e) {
    const v = e.detail.value
    this.setData({ newHours: v, newXpPreview: calcXp(v, this.data.newIntensity) })
  },
  selectNewIntensity(e) {
    const v = Number(e.currentTarget.dataset.v)
    this.setData({ newIntensity: v, newXpPreview: calcXp(this.data.newHours, v) })
  },

  submitTask() {
    const { newName, newDesc, newType, newSiteId, newDeadline, taskTypes, myName, aiJudged, newHours, newIntensity, newDeliverables } = this.data
    if (!newName || !newType) return
    if (!newDeadline) { wx.showToast({ title: '请选截止日期', icon: 'none' }); return }
    if (aiJudged && !(Number(newHours) > 0)) { wx.showToast({ title: '工时需大于 0', icon: 'none' }); return }
    const typeObj = taskTypes.find(t => t.name === newType)
    const typeStr = (typeObj ? typeObj.icon : '📌') + ' ' + newType
    const payload = {
      name: newName, desc: newDesc || '', type: typeStr, typeName: newType,
      typeIcon: typeObj ? typeObj.icon : '📌',
      siteId: newSiteId, deadline: newDeadline, publisherName: myName
    }
    if (aiJudged) {
      payload.hours = Number(newHours)
      payload.intensity = newIntensity
      payload.deliverables = newDeliverables
    }

    wx.showLoading({ title: '发布中...' })
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'addTask', data: payload } })
      .then(res => {
        wx.hideLoading()
        const taskId = res.result.id
        this.setData({ showModal: false, newName: '', newDesc: '', newType: '', newSiteId: '', newDeadline: '', aiJudged: false, newHours: '', newIntensity: 3, newXpPreview: 0, newDeliverables: [] })
        if (aiJudged) {
          wx.showToast({ title: '已发布', icon: 'success' })
          this.loadTasks()
        } else {
          wx.showToast({ title: '已发布，AI评分中...', icon: 'none', duration: 2000 })
          this.loadTasks()
          this.autoScore(taskId, newName, newDesc)
        }
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '发布失败，请重试', icon: 'none' }) })
  },

  // 没点AI帮判直接发的退路：发布后让 AI 估工时/强度，再用 reviseHours 回填（任务还是 open，发布人可写）
  autoScore(taskId, taskName, taskDesc) {
    const existingTypes = (this.data.taskTypes || []).map(t => t.name)
    wx.cloud.callFunction({ name: 'aiSuggestXp', data: { taskName, taskDesc: taskDesc || '', existingTypes } })
      .then(res => {
        const r = res.result || {}
        const hours = (typeof r.hours === 'number' && r.hours > 0) ? r.hours : 2
        const intensity = [1, 2, 3, 4, 5].includes(r.intensity) ? r.intensity : 3
        wx.cloud.callFunction({ name: 'taskManager', data: { action: 'reviseHours', data: { id: taskId, hours, intensity } } })
          .then(() => {
            if (Array.isArray(r.deliverables) && r.deliverables.length) {
              wx.cloud.callFunction({ name: 'taskManager', data: { action: 'updateDeliverables', data: { id: taskId, deliverables: r.deliverables } } }).catch(() => {})
            }
            this.loadTasks()
          })
      }).catch(e => { console.error('AI评分失败', e) })
  },

  openTaskDetail(e) {
    const task = e.currentTarget.dataset.task
    this.setData({ showTaskDetail: true, detailTask: task, detailNoteText: '', showRevise: false, reviseReason: '' })
  },

  longPressTask(e) {
    const task = e.currentTarget.dataset.task
    const status = e.currentTarget.dataset.status
    if (status === 'closed') return
    wx.showModal({
      title: '删除任务',
      content: '确认删除「' + task.name + '」？',
      confirmText: '删除', confirmColor: '#e74c3c', cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'taskManager',
          data: { action: 'deleteTask', data: { id: task.id } }
        }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadTasks()
        }).catch(() => { wx.showToast({ title: '删除失败', icon: 'none' }) })
      }
    })
  },

  // ---------- 认领人操作 ----------
  async claimByMe() {
    if (!this.data.myName) { wx.showToast({ title: '请先到「营员」页加入村落', icon: 'none' }); return }
    const task = this.data.detailTask
    wx.showLoading({ title: '认领中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskManager',
        data: { action: 'claimTask', data: { id: task.id, name: this.data.myName } }
      })
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '认领失败', icon: 'none' }); return }
      wx.showToast({ title: '已认领', icon: 'success' })
      this.loadTasks()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '认领失败', icon: 'none' })
    }
  },

  unclaimByMe() {
    const task = this.data.detailTask
    wx.showModal({
      title: '取消认领',
      content: '确认从「' + task.name + '」中退出？',
      confirmText: '退出', confirmColor: '#e74c3c', cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中...' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'taskManager',
            data: { action: 'unclaimTask', data: { id: task.id, name: this.data.myName } }
          })
          wx.hideLoading()
          if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
          wx.showToast({ title: '已退出', icon: 'success' })
          this.setData({ showTaskDetail: false, detailTask: null })
          this.loadTasks()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  markMyPartDone() {
    const task = this.data.detailTask
    wx.showModal({
      title: '确认完成',
      content: '提交后将无法取消认领，等主管确认',
      confirmText: '完成', cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '提交中...' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'taskManager',
            data: { action: 'finishTask', data: { id: task.id, name: this.data.myName } }
          })
          wx.hideLoading()
          if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
          if (res.result.submitted) {
            wx.showToast({ title: '已提交，等主管确认', icon: 'success', duration: 2000 })
            this.setData({ showTaskDetail: false, detailTask: null })
          } else {
            wx.showToast({ title: '已提交，等其他人完成', icon: 'success' })
          }
          this.loadTasks()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '提交失败', icon: 'none' })
        }
      }
    })
  },

  // 认领人：遇阻搁置
  holdByMe() {
    const task = this.data.detailTask
    wx.showModal({
      title: '遇阻搁置',
      editable: true, placeholderText: '说一句卡在哪（可空）',
      confirmText: '搁置', cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中...' })
        try {
          const res = await wx.cloud.callFunction({
            name: 'taskManager',
            data: { action: 'holdTask', data: { id: task.id, note: r.content || '' } }
          })
          wx.hideLoading()
          if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
          wx.showToast({ title: '已搁置', icon: 'success' })
          this.setData({ showTaskDetail: false, detailTask: null })
          this.loadTasks()
        } catch (e) { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) }
      }
    })
  },

  // ---------- 主管操作 ----------
  unholdTask() {
    const task = this.data.detailTask
    this._managerAction('unholdTask', { id: task.id }, '已恢复进行中')
  },

  confirmTask() {
    const task = this.data.detailTask
    const tip = task.dvTotal > 0 ? ('交付清单 ' + task.dvDone + '/' + task.dvTotal + ' 已勾，确认完成？') : '确认这个任务完成？'
    wx.showModal({
      title: '确认完成',
      content: tip,
      confirmText: '确认完成', cancelText: '再看看',
      success: async (r) => {
        if (!r.confirm) return
        this._managerAction('confirmTask', { id: task.id }, '已确认，经验已发放')
      }
    })
  },

  // 认领人勾选/取消勾选交付清单某条
  toggleDeliverable(e) {
    const idx = e.currentTarget.dataset.index
    const task = this.data.detailTask
    if (!task.isMine) { wx.showToast({ title: '只有认领人能勾选', icon: 'none' }); return }
    wx.cloud.callFunction({
      name: 'taskManager',
      data: { action: 'toggleDeliverable', data: { id: task.id, name: this.data.myName, index: idx } }
    }).then(res => {
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
      this.loadTasks()
    }).catch(() => { wx.showToast({ title: '操作失败', icon: 'none' }) })
  },

  reopenTask() {
    const task = this.data.detailTask
    wx.showModal({
      title: '打回重做',
      editable: true, placeholderText: '说一句哪没干好（可空）',
      confirmText: '打回', confirmColor: '#e74c3c', cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return
        this._managerAction('reopenTask', { id: task.id, note: r.content || '' }, '已打回，需重新完成')
      }
    })
  },

  cancelTask(e) {
    const reason = e.currentTarget.dataset.reason
    const task = this.data.detailTask
    const word = reason === 'cancelled' ? '取消' : '标记重复'
    wx.showModal({
      title: word,
      content: '确认' + word + '「' + task.name + '」？不会发经验。',
      confirmText: word, confirmColor: '#e74c3c', cancelText: '返回',
      success: async (r) => {
        if (!r.confirm) return
        this._managerAction('closeTask', { id: task.id, reason }, '已' + word)
      }
    })
  },

  async _managerAction(action, data, okMsg) {
    wx.showLoading({ title: '处理中...' })
    try {
      const res = await wx.cloud.callFunction({ name: 'taskManager', data: { action, data } })
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
      wx.showToast({ title: okMsg, icon: 'success' })
      this.setData({ showTaskDetail: false, detailTask: null })
      this.loadTasks()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // ---------- 改工时 / 强度 ----------
  openRevise() {
    const t = this.data.detailTask
    const hours = t.hours != null ? t.hours : 2
    const intensity = t.intensity || 3
    this.setData({
      showRevise: true,
      reviseHours: String(hours),
      reviseIntensity: intensity,
      reviseReason: '',
      reviseXpPreview: calcXp(hours, intensity)
    })
  },
  closeRevise() { this.setData({ showRevise: false }) },
  setReviseHours(e) {
    const v = e.detail.value
    this.setData({ reviseHours: v, reviseXpPreview: calcXp(v, this.data.reviseIntensity) })
  },
  selectReviseIntensity(e) {
    const v = Number(e.currentTarget.dataset.v)
    this.setData({ reviseIntensity: v, reviseXpPreview: calcXp(this.data.reviseHours, v) })
  },
  setReviseReason(e) { this.setData({ reviseReason: e.detail.value }) },

  async submitRevise() {
    const task = this.data.detailTask
    const hours = Number(this.data.reviseHours)
    const intensity = this.data.reviseIntensity
    if (!(hours > 0)) { wx.showToast({ title: '工时需大于 0', icon: 'none' }); return }
    // 认领后（非 open）必须填原因
    const afterClaim = task.status !== 'open'
    const reason = (this.data.reviseReason || '').trim()
    if (afterClaim && !reason) { wx.showToast({ title: '认领后修改要填原因', icon: 'none' }); return }

    wx.showLoading({ title: '保存中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskManager',
        data: { action: 'reviseHours', data: { id: task.id, hours, intensity, reason } }
      })
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' }); return }
      wx.showToast({ title: '已更新，XP ' + res.result.xp, icon: 'none' })
      this.setData({ showRevise: false })
      this.loadTasks()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  // ---------- 备注 ----------
  setDetailNoteText(e) { this.setData({ detailNoteText: e.detail.value }) },

  async submitNote() {
    if (!this.data.myName) { wx.showToast({ title: '请先到「营员」页加入村落', icon: 'none' }); return }
    const text = (this.data.detailNoteText || '').trim()
    if (!text) { wx.showToast({ title: '备注不能为空', icon: 'none' }); return }
    const task = this.data.detailTask
    wx.showLoading({ title: '发送中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'taskManager',
        data: { action: 'addTaskNote', data: { id: task.id, name: this.data.myName, text } }
      })
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '发送失败', icon: 'none' }); return }
      this.setData({ detailNoteText: '' })
      this.loadTasks()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '发送失败', icon: 'none' })
    }
  }
})