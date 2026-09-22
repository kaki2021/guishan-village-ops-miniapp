// miniprogram/pages/index/index.js
const LEVELS = [
  { level: 1, name: '初建营地', xp: 500 },
  { level: 2, name: '成长营地', xp: 1000 },
  { level: 3, name: '先锋营地', xp: 2000 },
  { level: 4, name: '活力营地', xp: 4000 },
  { level: 5, name: '传奇营地', xp: 8000 }
]

const START_DATE = new Date('2026-05-15')

Page({
  data: {
    campDay: 1,
    memberCount: 4,
    balance: 0,
    balanceDisplay: '0.00',
    resourceCount: 0,
    doingTasks: 0,
    totalXp: 0,
    level: 1,
    levelName: '初建营地',
    nextLevelXp: 500,
    xpPercent: 0,
    logs: [],
    showMoneyModal: false,
    moneyType: 'out',
    moneyAmount: '',
    moneyNote: '',
    moneyScreenshots: [],
    moneyFiles: [],
    showContribModal: false,
    contribIsReverse: false,
    contribName: '',
    contribMembers: [],
    contribAmount: '',
    contribNote: '',
    contribScreenshots: [],
    contribFiles: [],
    uploadingTx: false,
    myName: '',
    weekDays: [],
    weekOffset: 0,
    weekLabel: '',
    selectedDate: '',
    selectedDateLabel: '',
    scheduleItems: [],
    dateTasks: [],          // 当天落在区间内的进行中任务（按紧迫度排序）
    newScheduleText: '',
    showEditModal: false,
    editingId: '',
    editingText: '',
    showLedgerModal: false,
    ledgerList: [],
    ledgerFiltered: [],
    ledgerTypeFilter: 'all',
    ledgerPersonFilter: 'all',
    ledgerTimeFilter: 'thisMonth',
    ledgerCustomStart: '',
    ledgerCustomEnd: '',
    ledgerTimeLabel: '本月',
    ledgerPersons: [],
    ledgerInTotal: '0.00',
    ledgerOutTotal: '0.00',
    ledgerNetTotal: '0.00',
    ledgerNetIsPositive: true,
    showEditLedgerModal: false,
    editLedgerId: '',
    editLedgerType: 'out',
    editLedgerAmount: '',
    editLedgerNote: '',
    editLedgerScreenshots: [],
    editLedgerShotUrls: [],
    editLedgerFiles: [],
    showExportModal: false,
    exportMode: 'expenses',              // expenses/debt/loan/pending/paid/transactions
    exportViewIndex: 0,
    exportViewOptions: ['项目累计实际费用', '当前全部欠款', '长期借款欠款', '待报销/采购垫款', '金库已实际支付', '金库流水'],
    exportViewValues: ['expenses', 'debt', 'loan', 'pending', 'paid', 'transactions'],
    exportViewLabel: '项目累计实际费用',
    exportViewHint: '包含所有真实发生过的费用，只计一次；可看到具体买了什么、谁垫付、当前是否已付或仍欠款。',
    exportRange: 'all',
    exportStartDate: '',
    exportEndDate: '',
    exportPreviewCount: 0,
    exportingNow: false,
    // 账房先生
    treasurer: null,                  // { openid, name, setAt }
    isTreasurer: false,               // 当前用户是不是账房先生
    iAmSupervisor: false,             // 当前用户是不是主管（决定能否看出资台账）
    showContribLedgerModal: false,
    showConsult: false,
    consultQ: '',
    consultA: '',
    consulting: false,
    consultNeedRange: false,
    consultCounts: null,
    showReport: false,
    reportTab: 'ops',           // ops 运营周报 / staff 工作周报
    reporting: false,
    reportText: '',
    reportFacts: '',
    // 人员工作周报
    staffRange: 'lastWeek',     // lastWeek 上周(完整) / thisWeek 本周至今
    staffList: [],              // [{name,icon,validDays,monthValid}] 全村有效工作日，纯展示
    staffRangeLabel: '',
    staffReporting: false,
    staffReportText: '',
    // 昨日工作总结（总览页卡片）
    digest: null,               // {date,summary,validPeople,taskCount,details}
    showDigestDetail: false,
    contribGroups: [],
    showPickTreasurerModal: false,    // 指定/转交弹窗
    pickTreasurerCandidates: [],      // 可选的营员列表（必须已绑 openid）
    // 只读详情
    showReadOnlyModal: false,
    readOnlyTx: null,
    // 待记账（账房先生在金库流水里处理采购单的记账）
    pendingRecords: [],
    showPendingModal: false,
    // 垫付 / 报销
    reimbMine: [],                   // 我的垫付记录（全员）
    reimbPending: [],                // 待报销平铺（计数/兜底）
    reimbGroups: [],                 // 待报销按垫付人分组（账房结算用，每笔带勾选）
    reimbHistGroups: [],             // 近期已处理（同一次结算归并成一行）
    reimbHistory: [],                // 近期已处理的垫付（原始平铺）
    reimbPendingTotal: '0.00',       // 待报销总额（账房）
    showReimbSubmitModal: false,     // 「我垫付了」登记弹窗
    reimbAmount: '',
    reimbNote: '',
    reimbScreenshots: [],
    reimbFiles: [],
    showMyReimbModal: false,         // 「我的垫付」列表弹窗
    myReimbFilter: 'all',            // 我的垫付筛选：all | pending | reimbursed | rejected | donated
    // 待报销转借款（短期垫付 → 长期应付款）
    convSelecting: false,            // 我的垫付里是否处于勾选模式
    convChecked: {},                 // {reimbId:true} 已勾选待转的待报销（自由垫付）
    convCheckedP: {},                // {purchaseId:amount} 已勾选的采购垫款
    convSelTotal: '0.00',            // 已勾选合计（两来源相加）
    myAdvances: [],                  // 我的采购垫款明细
    myAdvancesTotal: '0.00',
    myReimbTab: 'free',              // 我的垫付二级tab：free 自由垫付 / purchase 采购垫款
    // 账房待办三合一 + 借款台账
    showTreasurerTodo: false,
    ttTab: 'record',                 // record 待记账 / reimb 待报销 / loan 待还款
    treasurerTodoCount: 0,
    loanGroups: [],                  // 借款台账按人分组
    loanTotal: 0,
    loanTotalDisplay: '0.00',
    showLoanLedger: false,
    showRepayModal: false,
    repayName: '', repayOwed: '0.00', repayAmount: '', repayNote: '',
    myUnsettledCount: 0,             // 我的未结垫付笔数（自由pending + 采购垫款）
    myUnsettledTotal: '0.00',        // 我的未结垫付总额
    myUnsettledFreeTotal: '0.00',
    myUnsettledAdvTotal: '0.00',
    convSelTotal: '0.00',            // 已勾选合计
    convReviews: [],                 // 我要审核的转出资申请（主管看）
    convMine: [],                    // 我发起的转出资申请（看进度）
    iAmSupervisorConv: false,
    myReimbCounts: {},               // 各状态数量 {all,pending,reimbursed,rejected,donated}
    showReimbPendingModal: false,    // 账房「待报销」列表弹窗
    showReimbPayModal: false,        // 报销结算确认弹窗（传还款凭证）
    reimbPaySel: null,               // 正在结算的选中集合 {applicantName, ids, items, count, totalDisplay}
    reimbPayShots: [],               // 还款凭证图（临时路径）
    reimbPayFiles: [],               // 还款凭证文件
    pendingReimburseDisplay: '0.00', // 待报销总额（总览统计用）
    availableDisplay: '0.00'         // 可用 = 余额 − 待报销
  },

  onShow() {
    const today = new Date()
    const campDay = Math.max(1, Math.floor((today - START_DATE) / (1000 * 60 * 60 * 24)) + 1)
    const app = getApp()
    const myName = app.globalData.myName || wx.getStorageSync('myName') || ''
    const selectedDate = this.formatDate(today)
    const selectedDateLabel = `${today.getMonth()+1}月${today.getDate()}日`
    this.setData({ campDay, myName, selectedDate, selectedDateLabel, weekOffset: 0 })
    this.loadStats()
    this.loadLogs()
    this.buildWeek(0)
    this.loadMemberCount()
    this.loadDigest()
    this._loadConversions()
    this._loadMyUnsettled()
    this._loadLoans()
  },

  // ===== 借款台账 =====
  _loadLoans() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getLoans' } })
      .then(res => {
        const r = res.result || {}
        const groups = (r.groups || []).map(g => ({
          ...g,
          totalDisplay: (Number(g.total) || 0).toFixed(2),
          expanded: false,
          entries: (g.entries || []).map(en => ({
            ...en,
            amountDisplay: Math.abs(Number(en.amount) || 0).toFixed(2),
            isRepay: (Number(en.amount) || 0) < 0,
            dateStr: en.createdAt ? this.formatDateTime(en.createdAt) : ''
          }))
        }))
        const total = Number(r.total) || 0
        this.setData({ loanGroups: groups, loanTotal: total, loanTotalDisplay: total.toFixed(2) },
          () => this._refreshTreasurerTodoCount())
      }).catch(() => {})
  },
  _refreshTreasurerTodoCount() {
    const n = (this.data.pendingRecords || []).length
      + (this.data.reimbPending || []).length
      + (this.data.loanGroups || []).length
    this.setData({ treasurerTodoCount: n })
  },
  formatDateTime(d) {
    const t = new Date(d)
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
  },
  openLoanLedger() { this.setData({ showLoanLedger: true }); this._loadLoans() },
  hideLoanLedger() { this.setData({ showLoanLedger: false }) },
  toggleLoanDetail(e) {
    const i = e.currentTarget.dataset.index
    const g = this.data.loanGroups.slice()
    if (!g[i]) return
    g[i] = Object.assign({}, g[i], { expanded: !g[i].expanded })
    this.setData({ loanGroups: g })
  },

  // ===== 账房待办（三合一） =====
  openTreasurerTodo() {
    this.setData({ showTreasurerTodo: true, ttTab: 'record' })
    this._loadLoans()
  },
  hideTreasurerTodo() { this.setData({ showTreasurerTodo: false }) },
  setTtTab(e) { this.setData({ ttTab: e.currentTarget.dataset.val }) },

  // ===== 还借款 =====
  openRepay(e) {
    const { name, total } = e.currentTarget.dataset
    this.setData({ showRepayModal: true, repayName: name, repayOwed: total, repayAmount: '', repayNote: '' })
  },
  hideRepay() { this.setData({ showRepayModal: false }) },
  setRepayField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  submitRepay() {
    const { repayName, repayAmount, repayNote, repayOwed } = this.data
    const amt = parseFloat(repayAmount) || 0
    if (!(amt > 0)) { wx.showToast({ title: '请填还款金额', icon: 'none' }); return }
    if (amt > parseFloat(repayOwed) + 0.001) { wx.showToast({ title: '不能超过欠款额', icon: 'none' }); return }
    wx.showModal({
      title: '确认还款',
      content: `还给 ${repayName} ¥${amt.toFixed(2)}？\n金库会记一笔支出，借款台账相应减少。`,
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中...' })
        wx.cloud.callFunction({
          name: 'memberManager',
          data: { action: 'repayLoan', data: { targetName: repayName, amount: amt, note: repayNote } }
        }).then(res => {
          wx.hideLoading()
          if (!res.result.success) { wx.showModal({ title: '还款失败', content: res.result.msg || '', showCancel: false }); return }
          wx.showToast({ title: '已还款', icon: 'success' })
          this.setData({ showRepayModal: false })
          this._loadLoans(); this.loadStats(); this.loadLogs()
        }).catch(() => { wx.hideLoading(); wx.showToast({ title: '还款失败', icon: 'none' }) })
      }
    })
  },

  // 我的未结垫付汇总（按钮角标 + 弹窗总额用）：自由垫付pending + 采购垫款
  _loadMyUnsettled() {
    Promise.all([
      wx.cloud.callFunction({ name: 'campManager', data: { action: 'getReimbursements' } }).catch(() => ({ result: {} })),
      wx.cloud.callFunction({ name: 'purchaseManager', data: { action: 'getMyPurchaseAdvances' } }).catch(() => ({ result: {} }))
    ]).then(([rbRes, advRes]) => {
      const mine = (rbRes.result && rbRes.result.mine) || []
      const freePending = mine.filter(m => m.status === 'pending')
      const freeCount = freePending.length
      const freeTotal = freePending.reduce((s, m) => s + (Number(m.amount) || 0), 0)
      const advList = (advRes.result && advRes.result.list) || []
      const advCount = advList.length
      const advTotal = Number((advRes.result && advRes.result.total) || 0)
      this.setData({
        myUnsettledCount: freeCount + advCount,
        myUnsettledTotal: (freeTotal + advTotal).toFixed(2),
        myUnsettledFreeTotal: freeTotal.toFixed(2),
        myUnsettledAdvTotal: advTotal.toFixed(2)
      })
    }).catch(() => {})
  },

  // 昨日工作总结（总览页卡片）
  loadDigest() {
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getLatestDigest' } })
      .then(r => {
        const dg = (r.result && r.result.digest) || null
        this.setData({ digest: dg })
      }).catch(() => {})
  },
  toggleDigestDetail() { this.setData({ showDigestDetail: !this.data.showDigestDetail }) },

  loadMemberCount() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } })
      .then(res => { this.setData({ memberCount: (res.result.list || []).length }) })
      .catch(() => {})
  },

  formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  },

  buildWeek(offset) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dayOfWeek = today.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset + offset * 7)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const dayNames = ['一', '二', '三', '四', '五', '六', '日']
    const todayStr = this.formatDate(today)
    const selectedDate = this.data.selectedDate

    let weekLabel = ''
    if (offset === 0) weekLabel = '本周'
    else if (offset === -1) weekLabel = '上周'
    else if (offset === 1) weekLabel = '下周'
    else weekLabel = `${monday.getMonth()+1}/${monday.getDate()}~${sunday.getMonth()+1}/${sunday.getDate()}`

    const weekDays = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const dateStr = this.formatDate(d)
      weekDays.push({
        date: dateStr,
        dayNum: d.getDate(),
        dayName: dayNames[i],
        isToday: dateStr === todayStr,
        isSelected: dateStr === selectedDate,
        hasItems: false
      })
    }
    this.setData({ weekDays, weekLabel, weekOffset: offset })

    const startDate = this.formatDate(monday)
    const endDate = this.formatDate(sunday)
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'getScheduleDates', data: { startDate, endDate } }
    }).then(res => {
      const dates = res.result.dates || []
      const updated = this.data.weekDays.map(d => ({ ...d, hasItems: dates.includes(d.date) }))
      this.setData({ weekDays: updated })
    }).catch(() => {})

    const weekDateStrs = weekDays.map(d => d.date)
    if (!weekDateStrs.includes(selectedDate)) {
      const firstDate = weekDays[0].date
      const fd = new Date(firstDate)
      const newLabel = `${fd.getMonth()+1}月${fd.getDate()}日`
      const newWeekDays = weekDays.map(d => ({ ...d, isSelected: d.date === firstDate }))
      this.setData({ selectedDate: firstDate, selectedDateLabel: newLabel, weekDays: newWeekDays })
      this.loadScheduleItems(firstDate)
    } else {
      this.loadScheduleItems(selectedDate)
    }
  },

  prevWeek() { this.buildWeek(this.data.weekOffset - 1) },
  nextWeek() { this.buildWeek(this.data.weekOffset + 1) },

  loadScheduleItems(date) {
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'getScheduleItems', data: { date } }
    }).then(res => {
      this.setData({ scheduleItems: res.result.list || [] })
    }).catch(() => {})
    // 同时拉当天进行中的任务（区间内）
    wx.cloud.callFunction({
      name: 'taskManager',
      data: { action: 'getTasksForDate', data: { date } }
    }).then(res => {
      const list = (res.result && res.result.list) || []
      const dateTasks = list.map(t => ({
        _id: t._id, name: t.name,
        deadline: t.deadline, daysLeft: t.daysLeft, urgency: t.urgency,
        ownersText: t.ownersText || '无人认领',
        statusLabel: t.status === 'submitted' ? '待确认' : t.status === 'onhold' ? '搁置' : '进行中',
        dueLabel: t.daysLeft <= 0 ? '今天截止' : ('还剩 ' + t.daysLeft + ' 天')
      }))
      this.setData({ dateTasks })
    }).catch(() => { this.setData({ dateTasks: [] }) })
  },

  selectDay(e) {
    const date = e.currentTarget.dataset.date
    const d = new Date(date)
    const selectedDateLabel = `${d.getMonth()+1}月${d.getDate()}日`
    const weekDays = this.data.weekDays.map(w => ({ ...w, isSelected: w.date === date }))
    this.setData({ selectedDate: date, selectedDateLabel, weekDays })
    this.loadScheduleItems(date)
  },

  setScheduleText(e) { this.setData({ newScheduleText: e.detail.value }) },

  addScheduleItem() {
    const { newScheduleText, selectedDate, myName } = this.data
    if (!newScheduleText.trim()) return
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'addScheduleItem', data: { date: selectedDate, text: newScheduleText.trim(), operatorName: myName } }
    }).then(() => {
      this.setData({ newScheduleText: '' })
      this.loadScheduleItems(selectedDate)
      this.refreshDots()
    }).catch(() => {})
  },

  toggleScheduleItem(e) {
    const { id, done } = e.currentTarget.dataset
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'toggleScheduleItem', data: { id, done: !done } }
    }).then(() => { this.loadScheduleItems(this.data.selectedDate) }).catch(() => {})
  },

  tapScheduleItem(e) {
    const { id, text, operator } = e.currentTarget.dataset
    const myName = this.data.myName
    if (operator && operator !== myName) {
      wx.showToast({ title: `由 ${operator} 添加，无法编辑`, icon: 'none' })
      return
    }
    this.setData({ editingId: id, editingText: text, showEditModal: true })
  },

  setEditingText(e) { this.setData({ editingText: e.detail.value }) },

  submitEditSchedule() {
    const { editingId, editingText, selectedDate } = this.data
    if (!editingText.trim()) return
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'editScheduleItem', data: { id: editingId, text: editingText.trim() } }
    }).then(() => {
      this.setData({ showEditModal: false, editingId: '', editingText: '' })
      this.loadScheduleItems(selectedDate)
    }).catch(() => {})
  },

  deleteScheduleItem(e) {
    const id = e.currentTarget.dataset.id
    const selectedDate = this.data.selectedDate
    wx.showModal({
      title: '删除事项', content: '确认删除这条日程？',
      confirmText: '删除', confirmColor: '#e74c3c', cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'campManager',
          data: { action: 'deleteScheduleItem', data: { id } }
        }).then(res => {
          if (res.result && res.result.success) {
            this.loadScheduleItems(selectedDate)
            this.refreshDots()
          } else {
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }).catch(() => { wx.showToast({ title: '删除失败，请重试', icon: 'none' }) })
      }
    })
  },

  refreshDots() {
    const weekDays = this.data.weekDays
    if (!weekDays.length) return
    wx.cloud.callFunction({
      name: 'campManager',
      data: { action: 'getScheduleDates', data: { startDate: weekDays[0].date, endDate: weekDays[6].date } }
    }).then(res => {
      const dates = res.result.dates || []
      const updated = this.data.weekDays.map(d => ({ ...d, hasItems: dates.includes(d.date) }))
      this.setData({ weekDays: updated })
    }).catch(() => {})
  },

  async loadStats() {
    try {
      const res = await wx.cloud.callFunction({ name: 'campManager', data: { action: 'getStats' } })
      const { balance, doingTasks, resourceCount, totalXp } = res.result
      const levelInfo = this.calcLevel(totalXp || 0)
      this.setData({
        balance: balance || 0,
        balanceDisplay: (balance || 0).toFixed(2),
        pendingReimburseDisplay: (res.result.pendingReimburse || 0).toFixed(2),
        availableDisplay: ((balance || 0) - (res.result.pendingReimburse || 0)).toFixed(2),
        doingTasks: doingTasks || 0,
        resourceCount: resourceCount || 0,
        totalXp: totalXp || 0,
        ...levelInfo
      })
    } catch (e) { console.error('加载统计失败', e) }
  },

  calcLevel(xp) {
    let current = LEVELS[0]
    let next = LEVELS[1]
    for (let i = 0; i < LEVELS.length; i++) {
      if (xp >= LEVELS[i].xp) {
        current = LEVELS[i]
        next = LEVELS[i + 1] || LEVELS[LEVELS.length - 1]
      }
    }
    const prevXp = current.level > 1 ? LEVELS[current.level - 2].xp : 0
    const percent = Math.min(100, Math.floor((xp - prevXp) / (next.xp - prevXp) * 100))
    return { level: current.level, levelName: current.name, nextLevelXp: next.xp, xpPercent: percent }
  },

  async loadLogs() {
    try {
      const res = await wx.cloud.callFunction({ name: 'campManager', data: { action: 'getLogs' } })
      const logs = (res.result.list || []).map(log => {
        const d = new Date(log.createdAt)
        const now = new Date()
        const diff = Math.floor((now - d) / (1000 * 60 * 60))
        let timeStr = diff < 1 ? '刚刚' : diff < 24 ? `${diff}小时前` : `${Math.floor(diff / 24)}天前`
        let badgeText = '动态', badgeClass = 'badge-task', text = log.note || ''
        const who = log.operatorName || ''
        if (log.type === 'in') {
          badgeText = '补给'; badgeClass = 'badge-in'
          text = `${who ? who + ' · ' : ''}${log.itemName} +${log.qty}`
        } else if (log.type === 'out') {
          badgeText = '消耗'; badgeClass = 'badge-out'
          text = `${who ? who + ' · ' : ''}${log.itemName} -${log.qty}`
        } else if (log.type === 'money_in') {
          badgeText = '收入'; badgeClass = 'badge-in'
          text = `${who ? who + ' · ' : ''}金库 +¥${(log.amount || 0).toFixed(2)}${log.note ? ' ' + log.note : ''}`
        } else if (log.type === 'money_out') {
          badgeText = '支出'; badgeClass = 'badge-out'
          text = `${who ? who + ' · ' : ''}金库 -¥${(log.amount || 0).toFixed(2)}${log.note ? ' ' + log.note : ''}`
        } else if (log.type === 'task_done') {
          badgeText = '完成'; badgeClass = 'badge-task'
          text = `${log.owner || '??'} 完成了「${log.taskName}」+${log.xp}xp`
        }
        return { ...log, badgeText, badgeClass, text, timeStr }
      })
      this.setData({ logs })
    } catch (e) { console.error('加载日志失败', e) }
  },

  // 把 cloud:// 文件ID 批量换成 https 临时链接（走云函数，比客户端 getTempFileURL 可靠）
  async _toTempUrls(fileIDs) {
    const ids = [...new Set((fileIDs || []).filter(x => typeof x === 'string' && x.indexOf('cloud://') === 0))]
    if (ids.length === 0) return {}
    try {
      const res = await wx.cloud.callFunction({ name: 'campManager', data: { action: 'getFileUrls', data: { fileList: ids } } })
      return (res.result && res.result.urls) || {}
    } catch (e) { return {} }
  },

  // 给"待报销分组 / 我的垫付"里的内联缩略图转 https 链接（await 后再读最新 data，避免覆盖勾选状态）
  async _attachReimbUrls() {
    const ids = []
    ;(this.data.reimbGroups || []).forEach(g => (g.items || []).forEach(it => { ids.push(...(it.imgShots || []), ...(it.payImgShots || [])) }))
    ;(this.data.reimbMine || []).forEach(it => { ids.push(...(it.imgShots || []), ...(it.payImgShots || [])) })
    if (ids.length === 0) return
    const map = await this._toTempUrls(ids)
    const mp = arr => (arr || []).map(s => map[s] || s)
    const groups = (this.data.reimbGroups || []).map(g => ({ ...g, items: (g.items || []).map(it => ({ ...it, imgUrls: mp(it.imgShots), payUrls: mp(it.payImgShots) })) }))
    const mine = (this.data.reimbMine || []).map(it => ({ ...it, imgUrls: mp(it.imgShots), payUrls: mp(it.payImgShots) }))
    this.setData({ reimbGroups: groups, reimbMine: mine }, () => this._refreshTreasurerTodoCount())
  },

  showLedger() {
    wx.showLoading({ title: '加载中...' })
    Promise.all([
      wx.cloud.callFunction({ name: 'campManager', data: { action: 'getTransactions' } }),
      wx.cloud.callFunction({ name: 'campManager', data: { action: 'getTreasurer' } }),
      wx.cloud.callFunction({ name: 'purchaseManager', data: { action: 'getMyPurchaseTodos' } }),
      wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getRoles' } }),
      wx.cloud.callFunction({ name: 'campManager', data: { action: 'getReimbursements' } })
    ]).then(([txRes, trRes, pRes, roleRes, rbRes]) => {
      wx.hideLoading()
      const raw = txRes.result.list || []
      const formatted = raw.map(t => {
        const d = new Date(t.createdAt)
        const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
        const shots = t.screenshots || []
        const imgShots = shots.filter(x => typeof x === 'string')
        const fileShots = shots.filter(x => x && typeof x === 'object').map(o => ({ fileID: o.fileID, name: o.name || '文件' }))
        return {
          ...t,
          dateStr,
          payerDisplay: t.payerName || t.operatorName || '未知',
          amountDisplay: (t.amount || 0).toFixed(2),
          imgShots,
          fileShots,
          hasScreenshot: imgShots.length > 0,
          firstShot: imgShots[0] || '',
          extraShotCount: imgShots.length > 1 ? imgShots.length - 1 : 0,
          hasFiles: fileShots.length > 0
        }
      })
      const personSet = new Set(formatted.map(t => t.payerDisplay).filter(Boolean))
      const ledgerPersons = ['all', ...personSet]
      // 待记账采购（仅账房先生有数据；非账房先生 toRecord 为空）
      const pr = (pRes.result && pRes.result.todos && pRes.result.todos.toRecord) || []
      const pendingRecords = pr.map(p => ({
        _id: p._id,
        title: p.title || (p.items && p.items[0] && p.items[0].name) || '采购',
        itemSummary: (p.items || []).map(it => `${it.name}×${it.receivedQty || it.qty || '?'}`).join('、'),
        amountDisplay: (Number(p.actualAmount) || 0).toFixed(2),
        buyerName: p.buyerName || '',
        receipts: p.receipts || []
      }))
      const rb = (rbRes && rbRes.result) || {}
      this.setData({
        showLedgerModal: true,
        ledgerList: formatted,
        reimbMine: this._formatReimb(rb.mine || []),
        reimbPending: this._formatReimb(rb.pending || []),
        reimbGroups: this._buildReimbGroups(rb.pendingGroups || []),
        reimbHistGroups: this._groupHistory(rb.history || []),
        reimbPendingTotal: (Number(rb.pendingTotal) || 0).toFixed(2),
        ledgerTypeFilter: 'all',
        ledgerPersonFilter: 'all',
        ledgerTimeFilter: 'thisMonth',
        ledgerTimeLabel: '本月',
        ledgerPersons,
        treasurer: trRes.result.treasurer,
        isTreasurer: trRes.result.isMe,
        iAmSupervisor: !!(roleRes && roleRes.result && roleRes.result.me && roleRes.result.me.isSupervisor),
        pendingRecords
      })
      this.applyLedgerFilter()
      this._attachReimbUrls()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  },

  hideLedgerModal() { this.setData({ showLedgerModal: false }) },

  // ===== 出资台账（账房先生/主管可看金额）=====
  openContribLedger() {
    wx.showLoading({ title: '加载中...', mask: true })
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getContributions' } })
      .then(res => {
        wx.hideLoading()
        if (!res.result || !res.result.success) {
          wx.showToast({ title: (res.result && res.result.msg) || '无权查看', icon: 'none' }); return
        }
        const list = res.result.list || []
        const map = {}
        list.forEach(c => {
          const k = c.openid || c.name
          if (!map[k]) map[k] = { openid: c.openid || k, name: c.name || '未知', total: 0, entries: [] }
          const amt = Number(c.amount) || 0
          map[k].total += amt
          const d = new Date(c.createdAt)
          map[k].entries.push({
            isReverse: amt < 0,
            amountDisplay: Math.abs(amt).toFixed(2),
            note: c.note || '',
            by: c.byName || '',
            dateStr: `${d.getMonth() + 1}/${d.getDate()}`
          })
        })
        const groups = Object.keys(map).map(k => {
          const g = map[k]
          return { openid: g.openid, name: g.name, totalDisplay: g.total.toFixed(2), count: g.entries.length, entries: g.entries, expanded: false }
        }).sort((a, b) => parseFloat(b.totalDisplay) - parseFloat(a.totalDisplay))
        this.setData({ showContribLedgerModal: true, contribGroups: groups })
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }) })
  },
  hideContribLedger() { this.setData({ showContribLedgerModal: false }) },
  toggleContribDetail(e) {
    const i = e.currentTarget.dataset.index
    const key = `contribGroups[${i}].expanded`
    this.setData({ [key]: !this.data.contribGroups[i].expanded })
  },

  setLedgerTypeFilter(e) {
    this.setData({ ledgerTypeFilter: e.currentTarget.dataset.val })
    this.applyLedgerFilter()
  },

  setLedgerPersonFilter(e) {
    this.setData({ ledgerPersonFilter: e.currentTarget.dataset.val })
    this.applyLedgerFilter()
  },

  setLedgerTimeFilter(e) {
    const val = e.currentTarget.dataset.val
    if (val === 'custom') {
      const now = new Date()
      const monthStart = this.formatDate(new Date(now.getFullYear(), now.getMonth(), 1))
      const today = this.formatDate(now)
      this.setData({
        ledgerTimeFilter: 'custom',
        ledgerCustomStart: this.data.ledgerCustomStart || monthStart,
        ledgerCustomEnd: this.data.ledgerCustomEnd || today,
        ledgerTimeLabel: '自定义'
      })
      this.applyLedgerFilter()
      return
    }
    const labelMap = { all: '全部', thisWeek: '本周', thisMonth: '本月', lastMonth: '上月' }
    this.setData({ ledgerTimeFilter: val, ledgerTimeLabel: labelMap[val] || '' })
    this.applyLedgerFilter()
  },

  setLedgerCustomStart(e) {
    this.setData({ ledgerCustomStart: e.detail.value })
    this.applyLedgerFilter()
  },

  setLedgerCustomEnd(e) {
    this.setData({ ledgerCustomEnd: e.detail.value })
    this.applyLedgerFilter()
  },

  _getLedgerTimeBounds() {
    const { ledgerTimeFilter, ledgerCustomStart, ledgerCustomEnd } = this.data
    if (ledgerTimeFilter === 'all') return null
    const now = new Date()
    if (ledgerTimeFilter === 'thisWeek') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const dow = today.getDay()
      const mondayOffset = dow === 0 ? -6 : 1 - dow
      const monday = new Date(today)
      monday.setDate(today.getDate() + mondayOffset)
      const sundayEnd = new Date(monday)
      sundayEnd.setDate(monday.getDate() + 6)
      sundayEnd.setHours(23, 59, 59, 999)
      return { start: monday, end: sundayEnd }
    }
    if (ledgerTimeFilter === 'thisMonth') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      return { start, end }
    }
    if (ledgerTimeFilter === 'lastMonth') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      return { start, end }
    }
    if (ledgerTimeFilter === 'custom') {
      if (!ledgerCustomStart || !ledgerCustomEnd) return null
      return {
        start: new Date(ledgerCustomStart + 'T00:00:00'),
        end: new Date(ledgerCustomEnd + 'T23:59:59')
      }
    }
    return null
  },

  applyLedgerFilter() {
    const { ledgerList, ledgerTypeFilter, ledgerPersonFilter } = this.data
    let filtered = ledgerList
    const bounds = this._getLedgerTimeBounds()
    if (bounds) {
      filtered = filtered.filter(t => {
        const d = new Date(t.createdAt)
        return d >= bounds.start && d <= bounds.end
      })
    }
    if (ledgerTypeFilter !== 'all') filtered = filtered.filter(t => t.type === ledgerTypeFilter)
    if (ledgerPersonFilter !== 'all') filtered = filtered.filter(t => t.payerDisplay === ledgerPersonFilter)

    const inSum = filtered.filter(t => t.type === 'in').reduce((s, t) => s + (t.amount || 0), 0)
    const outSum = filtered.filter(t => t.type === 'out').reduce((s, t) => s + (t.amount || 0), 0)
    const net = inSum - outSum

    this.setData({
      ledgerFiltered: filtered,
      ledgerInTotal: inSum.toFixed(2),
      ledgerOutTotal: outSum.toFixed(2),
      ledgerNetTotal: Math.abs(net).toFixed(2),
      ledgerNetIsPositive: net >= 0
    })
    // 汇总数字以服务端聚合为准（流水超过列表上限时，客户端按行求和会偏小）
    this._loadLedgerSummary(bounds)
  },

  _loadLedgerSummary(bounds) {
    const { ledgerTypeFilter, ledgerPersonFilter } = this.data
    const payload = { typeFilter: ledgerTypeFilter, personFilter: ledgerPersonFilter }
    if (bounds) { payload.startTs = bounds.start.getTime(); payload.endTs = bounds.end.getTime() }
    const token = (this._ledgerSummaryToken = (this._ledgerSummaryToken || 0) + 1)
    wx.cloud.callFunction({ name: 'campManager', data: { action: 'getLedgerSummary', data: payload } })
      .then(res => {
        if (token !== this._ledgerSummaryToken) return   // 快速切换筛选时丢弃过期结果
        const r = res.result || {}
        if (!r.success) return
        const net = (r.inSum || 0) - (r.outSum || 0)
        this.setData({
          ledgerInTotal: (r.inSum || 0).toFixed(2),
          ledgerOutTotal: (r.outSum || 0).toFixed(2),
          ledgerNetTotal: Math.abs(net).toFixed(2),
          ledgerNetIsPositive: net >= 0
        })
      }).catch(() => {})
  },

  // 点击列表行：账房先生 → ActionSheet 编辑/删除；非账房先生 → 只读详情
  async tapLedgerRow(e) {
    const item = e.currentTarget.dataset.item
    if (!this.data.isTreasurer) { this._openTxnDetail(item); return }
    const hasAtt = (item.screenshots || []).length > 0
    const list = hasAtt ? ['查看票据', '编辑', '删除'] : ['编辑', '删除']
    wx.showActionSheet({
      itemList: list,
      success: (res) => {
        const choice = list[res.tapIndex]
        if (choice === '查看票据') {
          this._openTxnDetail(item)
        } else if (choice === '编辑') {
          this._openEditLedger(item)
        } else if (choice === '删除') {
          const shotCount = (item.screenshots || []).length
          wx.showModal({
            title: '删除记录',
            content: shotCount > 0
              ? `确认删除这条${item.type === 'in' ? '收入' : '支出'}记录？截图（${shotCount}张）会一并删除`
              : `确认删除这条${item.type === 'in' ? '收入' : '支出'}记录？`,
            confirmText: '删除', confirmColor: '#e74c3c', cancelText: '取消',
            success: (r) => {
              if (!r.confirm) return
              wx.cloud.callFunction({ name: 'campManager', data: { action: 'deleteTransaction', data: { id: item._id } } })
                .then((delRes) => {
                  if (!delRes.result.success) {
                    wx.showToast({ title: delRes.result.msg || '删除失败', icon: 'none' })
                    return
                  }
                  const ledgerList = this.data.ledgerList.filter(t => t._id !== item._id)
                  this.setData({ ledgerList })
                  this.applyLedgerFilter()
                  this.loadStats()
                  this.loadLogs()
                  wx.showToast({ title: '已删除', icon: 'success' })
                }).catch(() => { wx.showToast({ title: '删除失败', icon: 'none' }) })
            }
          })
        }
      }
    })
  },

  // 打开流水详情：把这一条的截图转成临时链接再展示（按需，只一条）
  async _openTxnDetail(item) {
    wx.showLoading({ title: '加载中...' })
    const map = await this._toTempUrls(item.imgShots || [])
    wx.hideLoading()
    const imgUrls = (item.imgShots || []).map(s => map[s] || s)
    this.setData({ showReadOnlyModal: true, readOnlyTx: { ...item, imgUrls } })
  },

  // 列表行里的缩略图点击 → 全屏预览（先转临时链接）
  async previewLedgerRowShots(e) {
    const shots = e.currentTarget.dataset.shots || []
    if (!shots.length) return
    wx.showLoading({ title: '加载中...' })
    const map = await this._toTempUrls(shots)
    wx.hideLoading()
    const urls = shots.map(s => map[s] || s)
    wx.previewImage({ current: urls[0], urls })
  },

  hideReadOnlyModal() { this.setData({ showReadOnlyModal: false, readOnlyTx: null }) },

  previewReadOnlyShot(e) {
    const index = e.currentTarget.dataset.index
    const urls = (this.data.readOnlyTx && this.data.readOnlyTx.imgUrls) || (this.data.readOnlyTx && this.data.readOnlyTx.imgShots) || []
    if (!urls.length) return
    wx.previewImage({ current: urls[index], urls })
  },

  hideEditLedgerModal() { this.setData({ showEditLedgerModal: false }) },
  setEditLedgerField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  setEditLedgerType(e) { this.setData({ editLedgerType: e.currentTarget.dataset.val }) },

  // 打开编辑：已存云图转 https 链接显示（保存仍用原 editLedgerScreenshots 里的云ID/本地路径）
  async _openEditLedger(item) {
    const cloudShots = (item.screenshots || []).filter(x => typeof x === 'string')
    const files = (item.screenshots || []).filter(x => x && typeof x === 'object').map(o => ({ fileID: o.fileID, name: o.name || '文件' }))
    wx.showLoading({ title: '加载中...' })
    const map = await this._toTempUrls(cloudShots)
    wx.hideLoading()
    this.setData({
      showEditLedgerModal: true,
      editLedgerId: item._id,
      editLedgerType: item.type,
      editLedgerAmount: String(item.amount),
      editLedgerNote: item.note || '',
      editLedgerScreenshots: cloudShots,
      editLedgerShotUrls: cloudShots.map(s => map[s] || s),
      editLedgerFiles: files
    })
  },

  async chooseEditLedgerScreenshots() {
    try {
      const res = await wx.chooseMedia({
        count: 9, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed']
      })
      const newPaths = res.tempFiles.map(f => f.tempFilePath)
      this.setData({
        editLedgerScreenshots: [...this.data.editLedgerScreenshots, ...newPaths],
        editLedgerShotUrls: [...this.data.editLedgerShotUrls, ...newPaths]
      })
    } catch (e) {}
  },

  removeEditLedgerScreenshot(e) {
    const index = e.currentTarget.dataset.index
    const list = [...this.data.editLedgerScreenshots]; list.splice(index, 1)
    const urls = [...this.data.editLedgerShotUrls]; urls.splice(index, 1)
    this.setData({ editLedgerScreenshots: list, editLedgerShotUrls: urls })
  },

  previewEditLedgerScreenshot(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.editLedgerShotUrls
    wx.previewImage({ current: urls[index], urls })
  },

  async submitEditLedger() {
    if (this.data.uploadingTx) return
    const { editLedgerId, editLedgerType, editLedgerAmount, editLedgerNote, editLedgerScreenshots } = this.data
    const amount = parseFloat(editLedgerAmount)
    if (!amount || amount <= 0) { wx.showToast({ title: '请输入有效金额', icon: 'none' }); return }
    this.setData({ uploadingTx: true })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const imgIDs = await this._uploadScreenshots(editLedgerScreenshots)
      const fileAtts = (this.data.editLedgerFiles || []).map(f => ({ fileID: f.fileID, name: f.name, type: 'file' }))
      const res = await wx.cloud.callFunction({
        name: 'campManager',
        data: { action: 'editTransaction', data: { id: editLedgerId, type: editLedgerType, amount, note: editLedgerNote, screenshots: imgIDs.concat(fileAtts) } }
      })
      wx.hideLoading()
      if (!res.result.success) {
        wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showEditLedgerModal: false, editLedgerScreenshots: [], editLedgerFiles: [] })
      this.showLedger()
      this.loadStats()
      this.loadLogs()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
      console.error(e)
    } finally {
      this.setData({ uploadingTx: false })
    }
  },

  async _uploadScreenshots(list) {
    const result = []
    for (const path of (list || [])) {
      if (path.startsWith('cloud://')) { result.push(path); continue }
      const cloudPath = `transactions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: path })
      result.push(up.fileID)
    }
    return result
  },

  showAddMoney() {
    if (!this.data.treasurer || !this.data.treasurer.openid) {
      wx.showToast({ title: '请先指定账房先生后才能记账', icon: 'none' })
      return
    }
    if (!this.data.isTreasurer) {
      wx.showToast({ title: `只有账房先生「${this.data.treasurer.name}」能记账`, icon: 'none' })
      return
    }
    this.setData({ showMoneyModal: true, moneyAmount: '', moneyNote: '', moneyType: 'out', moneyScreenshots: [], moneyFiles: [] })
  },
  hideMoneyModal() { this.setData({ showMoneyModal: false }) },
  hideEditModal() { this.setData({ showEditModal: false }) },
  noop() {},

  // ===== AI 咨询 =====
  openConsult() { this.setData({ showConsult: true, consultQ: '', consultA: '', consultNeedRange: false, consultCounts: null }) },
  hideConsult() { this.setData({ showConsult: false }) },
  setConsultQ(e) { this.setData({ consultQ: e.detail.value }) },
  askConsult() { this._doConsult(undefined) },          // 不带区间，默认近7天
  askConsultRange(e) { this._doConsult(e.currentTarget.dataset.range) },
  _doConsult(range) {
    const q = (this.data.consultQ || '').trim()
    if (!q) { wx.showToast({ title: '先输入问题', icon: 'none' }); return }
    this.setData({ consulting: true, consultA: '', consultNeedRange: false })
    const payload = { action: 'consult', data: { question: q } }
    if (range) payload.data.range = range
    wx.cloud.callFunction({ name: 'aiStockIn', data: payload })
      .then(r => {
        this.setData({ consulting: false })
        const rr = r.result || {}
        if (!rr.success) {
          if (rr.msg === 'unknown action') wx.showModal({ title: '云函数需更新', content: '请把 aiStockIn 云函数重新上传并部署后再试。', showCancel: false })
          else wx.showModal({ title: '没问成', content: rr.msg || '失败', showCancel: false })
          return
        }
        if (rr.needRange) {
          // 记录太多，让用户选区间
          this.setData({ consultNeedRange: true, consultCounts: rr.counts || {} })
          return
        }
        this.setData({ consultA: rr.answer || '（没有回答）', consultNeedRange: false })
      })
      .catch(err => { this.setData({ consulting: false }); wx.showModal({ title: '出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false }) })
  },

  // ===== AI 周报 =====
  openReport() {
    this.setData({ showReport: true, reportTab: 'ops', reportText: '', reportFacts: '', reporting: false, staffReportText: '', staffReporting: false })
  },
  hideReport() { this.setData({ showReport: false }) },
  setReportTab(e) {
    const tab = e.currentTarget.dataset.val
    this.setData({ reportTab: tab })
    if (tab === 'staff' && this.data.staffList.length === 0) this.loadStaffOverview()
  },
  genReport() {
    this.setData({ reporting: true, reportText: '', reportFacts: '' })
    wx.cloud.callFunction({ name: 'aiStockIn', data: { action: 'weeklyReport', data: {} } })
      .then(r => {
        this.setData({ reporting: false })
        const rr = r.result || {}
        if (!rr.success) {
          // AI 失败也尽量把统计数字显示出来
          if (rr.factText) { this.setData({ reportText: '（AI 生成失败，先看原始统计）', reportFacts: rr.factText }); return }
          if (rr.msg === 'unknown action') wx.showModal({ title: '云函数需更新', content: '请把 aiStockIn 云函数重新上传并部署后再试。', showCancel: false })
          else wx.showModal({ title: '生成失败', content: rr.msg || '失败', showCancel: false })
          return
        }
        this.setData({ reportText: rr.report || '（空）', reportFacts: rr.factText || '' })
      })
      .catch(err => { this.setData({ reporting: false }); wx.showModal({ title: '出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false }) })
  },
  copyReport() {
    const txt = (this.data.reportText || '') + (this.data.reportFacts ? ('\n\n— 数据 —\n' + this.data.reportFacts) : '')
    wx.setClipboardData({ data: txt, success: () => wx.showToast({ title: '已复制', icon: 'success' }) })
  },

  // ===== 人员工作周报（已并入"生成周报"弹窗的工作周报 tab）=====
  setStaffRange(e) {
    this.setData({ staffRange: e.currentTarget.dataset.val, staffReportText: '' }, () => this.loadStaffOverview())
  },
  // 全村出勤概览（纯展示，不耗 AI）
  loadStaffOverview() {
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getVillageWorklog' } })
      .then(r => {
        const list = (r.result && r.result.list) || []
        // 上周看 weekValid 不太准（getVillageWorklog 是近7天滚动），所以这里展示用「近7天/近30天」标注
        this.setData({ staffList: list.map(x => ({ name: x.name, icon: x.icon, validDays: x.weekValid, monthValid: x.monthValid })) })
      }).catch(() => {})
  },
  genStaffReport() {
    const range = this.data.staffRange
    this.setData({ staffReporting: true, staffReportText: '' })
    // 先按区间取全村各人日报数据，再喂 AI
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getStaffWorklogRange', data: { range } } })
      .then(r => {
        const rr = r.result || {}
        if (!rr.success || !(rr.people || []).length) {
          this.setData({ staffReporting: false })
          wx.showModal({ title: '无数据', content: (range === 'lastWeek' ? '上周' : '本周至今') + '暂无工作记录', showCancel: false })
          return
        }
        this.setData({ staffRangeLabel: (rr.fromStr || '') + ' 至 ' + (rr.toStr || '') })
        return wx.cloud.callFunction({
          name: 'aiStockIn',
          data: { action: 'staffWeeklyReport', data: { fromStr: rr.fromStr, toStr: rr.toStr, people: rr.people } }
        }).then(a => {
          this.setData({ staffReporting: false })
          const ar = a.result || {}
          if (!ar.success) {
            if (ar.msg === 'unknown action') wx.showModal({ title: '云函数需更新', content: '请把 aiStockIn 重新部署后再试。', showCancel: false })
            else wx.showModal({ title: '生成失败', content: ar.msg || '失败', showCancel: false })
            return
          }
          this.setData({ staffReportText: ar.report || '（空）' })
        })
      })
      .catch(err => { this.setData({ staffReporting: false }); wx.showModal({ title: '出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false }) })
  },
  copyStaffReport() {
    wx.setClipboardData({ data: this.data.staffReportText || '', success: () => wx.showToast({ title: '已复制', icon: 'success' }) })
  },
  setMoneyType(e) { this.setData({ moneyType: e.currentTarget.dataset.val }) },
  setMoneyField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },

  async chooseMoneyScreenshots() {
    try {
      const res = await wx.chooseMedia({
        count: 9, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed']
      })
      const newPaths = res.tempFiles.map(f => f.tempFilePath)
      this.setData({ moneyScreenshots: [...this.data.moneyScreenshots, ...newPaths] })
    } catch (e) {}
  },

  removeMoneyScreenshot(e) {
    const index = e.currentTarget.dataset.index
    const list = [...this.data.moneyScreenshots]
    list.splice(index, 1)
    this.setData({ moneyScreenshots: list })
  },

  previewMoneyScreenshot(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({ current: this.data.moneyScreenshots[index], urls: this.data.moneyScreenshots })
  },

  // ===== 统一附件入口：一个"+"，弹"图片 / 文件"二选一；带格式与大小校验 =====
  // 图片：jpg/jpeg/png/webp（走相册/拍照，本身就是图）；文件：pdf/xlsx/xls/docx/doc；单个 ≤10MB
  _pickAttachment(imgKey, fileKey) {
    wx.showActionSheet({
      itemList: ['拍照 / 相册（图片）', '聊天文件（PDF/Word/Excel）'],
      success: (r) => {
        if (r.tapIndex === 0) this._chooseImagesInto(imgKey)
        else this._chooseFilesInto(fileKey)
      }
    })
  },
  async _chooseImagesInto(imgKey) {
    try {
      const res = await wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'] })
      const ok = []
      for (const f of res.tempFiles) {
        if (f.size && f.size > 10 * 1024 * 1024) { wx.showToast({ title: '有图片超过10MB，已跳过', icon: 'none' }); continue }
        ok.push(f.tempFilePath)
      }
      if (ok.length) {
        const patch = { [imgKey]: [...this.data[imgKey], ...ok] }
        // 编辑流水弹窗：新加的是本地图(直接可显)，同步进显示数组保持下标一致
        if (imgKey === 'editLedgerScreenshots') patch.editLedgerShotUrls = [...this.data.editLedgerShotUrls, ...ok]
        this.setData(patch)
      }
    } catch (e) {}
  },
  async _chooseFilesInto(fileKey) {
    const DOC = ['pdf', 'xlsx', 'xls', 'docx', 'doc']
    try {
      const res = await wx.chooseMessageFile({ count: 5, type: 'file' })
      const valid = []
      for (const f of res.tempFiles) {
        const ext = (f.name && f.name.indexOf('.') >= 0) ? f.name.split('.').pop().toLowerCase() : ''
        if (DOC.indexOf(ext) < 0) { wx.showToast({ title: `${f.name}：只支持 PDF/Word/Excel`, icon: 'none' }); continue }
        if (f.size && f.size > 10 * 1024 * 1024) { wx.showToast({ title: `${f.name} 超过10MB`, icon: 'none' }); continue }
        valid.push(f)
      }
      if (!valid.length) return
      wx.showLoading({ title: '上传中...', mask: true })
      const added = []
      try {
        for (const f of valid) {
          const ext = f.name.split('.').pop()
          const cloudPath = `transactions/file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: f.path })
          added.push({ fileID: up.fileID, name: f.name || '文件' })
        }
      } finally { wx.hideLoading() }
      this.setData({ [fileKey]: [...this.data[fileKey], ...added] })
    } catch (e) { wx.hideLoading() }
  },
  chooseMoneyAttachment() { this._pickAttachment('moneyScreenshots', 'moneyFiles') },
  chooseEditLedgerAttachment() { this._pickAttachment('editLedgerScreenshots', 'editLedgerFiles') },
  chooseContribAttachment() { this._pickAttachment('contribScreenshots', 'contribFiles') },
  removeMoneyFile(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.moneyFiles]; list.splice(i, 1)
    this.setData({ moneyFiles: list })
  },
  removeEditLedgerFile(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.editLedgerFiles]; list.splice(i, 1)
    this.setData({ editLedgerFiles: list })
  },
  // 打开云端文件附件（下载→系统预览）
  async openFileAttachment(e) {
    const fileID = e.currentTarget.dataset.fileid
    if (!fileID) return
    wx.showLoading({ title: '打开中...', mask: true })
    try {
      const dl = await wx.cloud.downloadFile({ fileID })
      wx.hideLoading()
      await wx.openDocument({ filePath: dl.tempFilePath, showMenu: true })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '打开失败', icon: 'none' })
    }
  },

  async submitMoney() {
    if (this.data.uploadingTx) return
    const { moneyType, moneyAmount, moneyNote, myName, moneyScreenshots } = this.data
    if (!moneyAmount) { wx.showToast({ title: '请填写金额', icon: 'none' }); return }
    this.setData({ uploadingTx: true })
    wx.showLoading({ title: '记录中...', mask: true })
    try {
      const imgIDs = await this._uploadScreenshots(moneyScreenshots)
      const fileAtts = (this.data.moneyFiles || []).map(f => ({ fileID: f.fileID, name: f.name, type: 'file' }))
      await wx.cloud.callFunction({
        name: 'campManager',
        data: { action: 'addTransaction', data: { type: moneyType, amount: parseFloat(moneyAmount), note: moneyNote, operatorName: myName, screenshots: imgIDs.concat(fileAtts) } }
      })
      wx.showToast({ title: '记录成功', icon: 'success' })
      this.setData({ showMoneyModal: false, moneyScreenshots: [], moneyFiles: [] })
      this.loadStats()
      this.loadLogs()
      if (this.data.showLedgerModal) this.showLedger()
    } catch (e) {
      wx.showToast({ title: '记录失败', icon: 'none' })
      console.error(e)
    } finally {
      wx.hideLoading()
      this.setData({ uploadingTx: false })
    }
  },

  // ========== 录出资 / 冲正（账房先生；弹窗，和记录收支一致，可传图/文件）==========
  recordContribution() {
    if (!this.data.treasurer || !this.data.treasurer.openid) {
      wx.showToast({ title: '请先指定账房先生', icon: 'none' }); return
    }
    if (!this.data.isTreasurer) {
      wx.showToast({ title: `只有账房先生「${this.data.treasurer.name}」能录出资`, icon: 'none' }); return
    }
    wx.showLoading({ title: '加载营员...' })
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } })
      .then(res => {
        wx.hideLoading()
        const members = (res.result.list || []).filter(m => m.openid).map(m => m.name)
        if (members.length === 0) { wx.showToast({ title: '暂无已加入的营员', icon: 'none' }); return }
        this.setData({
          showContribModal: true, contribIsReverse: false, contribName: '',
          contribMembers: members, contribAmount: '', contribNote: '',
          contribScreenshots: [], contribFiles: []
        })
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '加载失败', icon: 'none' }) })
  },
  hideContribModal() { this.setData({ showContribModal: false }) },
  setContribReverse(e) { this.setData({ contribIsReverse: e.currentTarget.dataset.val === 'yes' }) },
  setContribField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  pickContribPerson() {
    const members = this.data.contribMembers || []
    if (!members.length) return
    wx.showActionSheet({ itemList: members, success: (r) => this.setData({ contribName: members[r.tapIndex] }) })
  },
  removeContribScreenshot(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.contribScreenshots]; list.splice(i, 1)
    this.setData({ contribScreenshots: list })
  },
  previewContribScreenshot(e) {
    const i = e.currentTarget.dataset.index
    wx.previewImage({ current: this.data.contribScreenshots[i], urls: this.data.contribScreenshots })
  },
  removeContribFile(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.contribFiles]; list.splice(i, 1)
    this.setData({ contribFiles: list })
  },
  async submitContribution() {
    if (this.data.uploadingTx) return
    const { contribIsReverse, contribName, contribAmount, contribNote, contribScreenshots, contribFiles } = this.data
    if (!contribName) { wx.showToast({ title: '请选择出资人', icon: 'none' }); return }
    const amount = parseFloat(contribAmount)
    if (!(amount > 0)) { wx.showToast({ title: '金额要大于 0', icon: 'none' }); return }
    this.setData({ uploadingTx: true })
    wx.showLoading({ title: '提交中...', mask: true })
    try {
      const imgIDs = await this._uploadScreenshots(contribScreenshots)
      const fileAtts = (contribFiles || []).map(f => ({ fileID: f.fileID, name: f.name, type: 'file' }))
      const screenshots = imgIDs.concat(fileAtts)
      const action = contribIsReverse ? 'reverseContribution' : 'addContribution'
      const r = await wx.cloud.callFunction({ name: 'memberManager', data: { action, data: { targetName: contribName, amount, note: contribNote || '', screenshots } } })
      wx.hideLoading()
      if (!r.result.success) { wx.showToast({ title: r.result.msg || '失败', icon: 'none' }); return }
      wx.showToast({ title: contribIsReverse ? '已冲正' : '已录出资', icon: 'success' })
      this.setData({ showContribModal: false })
      this.loadStats(); this.loadLogs()
      if (this.data.showLedgerModal) this.showLedger()
    } catch (e) {
      wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' })
    } finally {
      this.setData({ uploadingTx: false })
    }
  },

  // ========== 账房先生指定/转交 ==========
  async openPickTreasurer() {
    wx.showLoading({ title: '加载中...' })
    try {
      const res = await wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } })
      wx.hideLoading()
      const candidates = (res.result.list || []).filter(m => m.openid).map(m => ({
        name: m.name, openid: m.openid, role: m.role, icon: m.icon
      }))
      if (candidates.length === 0) {
        wx.showToast({ title: '还没有已加入村落的营员', icon: 'none' })
        return
      }
      this.setData({ showPickTreasurerModal: true, pickTreasurerCandidates: candidates })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  hidePickTreasurerModal() { this.setData({ showPickTreasurerModal: false }) },

  confirmPickTreasurer(e) {
    const { openid, name } = e.currentTarget.dataset
    const isTransfer = !!(this.data.treasurer && this.data.treasurer.openid)
    wx.showModal({
      title: isTransfer ? '转交账房先生' : '指定账房先生',
      content: isTransfer
        ? `将账房先生转交给「${name}」？转交后你将失去编辑权限`
        : `确认指定「${name}」为账房先生？指定后只有他能记录/编辑/删除流水`,
      confirmText: '确认', cancelText: '取消',
      success: async (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          const res = await wx.cloud.callFunction({
            name: 'campManager',
            data: { action: 'setTreasurer', data: { targetOpenid: openid, targetName: name } }
          })
          wx.hideLoading()
          if (!res.result.success) {
            wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
            return
          }
          wx.showToast({ title: isTransfer ? '已转交' : '已指定', icon: 'success' })
          this.setData({ showPickTreasurerModal: false })
          // 重新加载流水弹窗刷新权限
          this.showLedger()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  // ========== 待记账（账房先生记账，金额只读，二选一） ==========
  async openPendingModal() {
    this.setData({ showPendingModal: true })
    const recs = this.data.pendingRecords || []
    const ids = []
    recs.forEach(p => (p.receipts || []).forEach(s => { if (typeof s === 'string') ids.push(s) }))
    const map = ids.length ? await this._toTempUrls(ids) : {}
    const newRecs = recs.map(p => {
      const imgs = (p.receipts || []).filter(s => typeof s === 'string')
      const files = (p.receipts || []).filter(s => s && typeof s === 'object').map(o => ({ fileID: o.fileID, name: o.name || '文件' }))
      return { ...p, receiptUrls: imgs.map(s => map[s] || s), receiptFiles: files }
    })
    this.setData({ pendingRecords: newRecs })
  },
  hidePendingModal() { this.setData({ showPendingModal: false }) },
  previewPendingReceipt(e) {
    const shots = e.currentTarget.dataset.shots || []
    if (shots.length) wx.previewImage({ current: shots[0], urls: shots })
  },
  recordExpense(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '记为金库支出',
      content: `记一笔支出 ¥${item.amountDisplay}，报销给采购人「${item.buyerName || ''}」，凭证一并归档。`,
      confirmText: '确认记账',
      success: (r) => { if (r.confirm) this._doRecord(item._id, 'expense') }
    })
  },
  recordDonation(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '记为营员捐赠',
      content: `「${item.buyerName || ''}」垫付且不报销，记为对村落的捐赠，不动金库现金。`,
      confirmText: '确认',
      success: (r) => { if (r.confirm) this._doRecord(item._id, 'donation') }
    })
  },
  _doRecord(id, mode) {
    wx.showLoading({ title: '记账中...', mask: true })
    wx.cloud.callFunction({
      name: 'purchaseManager',
      data: { action: 'recordLedger', data: { id, mode } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '记账失败', icon: 'none' }); return }
      wx.showToast({ title: '已记账', icon: 'success' })
      this.showLedger()   // 刷新：待记账列表 + 新流水都更新
      this.loadStats()
      this.loadLogs()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '记账失败', icon: 'none' }) })
  },

  // ========== 垫付 / 报销 ==========
  // 缩略图加载失败（云图限流/失效等）：悄悄隐藏，不显示破图
  onLedgerThumbError(e) {
    const id = e.currentTarget.dataset.id
    const i = this.data.ledgerFiltered.findIndex(x => x._id === id)
    if (i >= 0) this.setData({ [`ledgerFiltered[${i}].firstShotUrl`]: '' })
  },

  _formatReimb(list) {
    const STAT = {
      pending:    { label: '待报销', cls: 'rb-pending' },
      reimbursed: { label: '已报销', cls: 'rb-done' },
      rejected:   { label: '已驳回', cls: 'rb-reject' },
      donated:    { label: '记为捐赠', cls: 'rb-donate' }
    }
    return (list || []).map(r => {
      const d = new Date(r.createdAt)
      const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
      const receipts = r.receipts || []
      const imgShots = receipts.filter(x => typeof x === 'string')
      const fileShots = receipts.filter(x => x && typeof x === 'object').map(o => ({ fileID: o.fileID, name: o.name || '文件' }))
      const payback = r.paybackReceipts || []
      const payImgShots = payback.filter(x => typeof x === 'string')
      const payFileShots = payback.filter(x => x && typeof x === 'object').map(o => ({ fileID: o.fileID, name: o.name || '文件' }))
      const s = STAT[r.status] || STAT.pending
      return {
        _id: r._id,
        applicantName: r.applicantName || '',
        amount: Number(r.amount) || 0,
        amountDisplay: (Number(r.amount) || 0).toFixed(2),
        note: r.note || '',
        rejectReason: r.rejectReason || '',
        operatorName: r.operatorName || '',
        settlementId: r.settlementId || '',
        status: r.status,
        statusLabel: s.label,
        statusClass: s.cls,
        dateStr,
        imgShots, fileShots,
        hasImg: imgShots.length > 0,
        hasFiles: fileShots.length > 0,
        payImgShots, payFileShots,
        hasPayImg: payImgShots.length > 0,
        hasPayFiles: payFileShots.length > 0
      }
    })
  },

  // 把待报销分组（后端已按人分好）格式化，每笔默认勾选
  _buildReimbGroups(pendingGroups) {
    return (pendingGroups || []).map(g => {
      const items = this._formatReimb(g.items).map(it => ({ ...it, checked: true }))
      const total = Number(g.total) || 0
      return {
        applicantOpenid: g.applicantOpenid || '',
        applicantName: g.applicantName || '未知',
        count: g.count || items.length,
        totalDisplay: total.toFixed(2),
        items,
        allChecked: true,
        selCount: items.length,
        selTotalDisplay: total.toFixed(2)
      }
    })
  },

  // 已处理：同一次结算(settlementId)的已报销归并成一行；驳回/捐赠各自一行
  _groupHistory(list) {
    const formatted = this._formatReimb(list)
    const out = [], map = {}
    for (const h of formatted) {
      if (h.status === 'reimbursed' && h.settlementId) {
        if (!map[h.settlementId]) {
          map[h.settlementId] = { _id: h._id, settlementId: h.settlementId, applicantName: h.applicantName, status: h.status, statusLabel: h.statusLabel, statusClass: h.statusClass, dateStr: h.dateStr, note: h.note, count: 0, amount: 0, isBatch: true }
          out.push(map[h.settlementId])
        }
        map[h.settlementId].count += 1
        map[h.settlementId].amount += h.amount
      } else {
        out.push({ ...h, count: 1, isBatch: false })
      }
    }
    return out.map(g => ({ ...g, amountDisplay: (g.amount || 0).toFixed(2) }))
  },
  _reloadReimb() {
    return wx.cloud.callFunction({ name: 'campManager', data: { action: 'getReimbursements' } })
      .then(res => {
        const rb = res.result || {}
        this.setData({
          reimbMine: this._formatReimb(rb.mine || []),
          reimbPending: this._formatReimb(rb.pending || []),
          reimbGroups: this._buildReimbGroups(rb.pendingGroups || []),
          reimbHistGroups: this._groupHistory(rb.history || []),
          reimbPendingTotal: (Number(rb.pendingTotal) || 0).toFixed(2)
        })
        this._refreshMyReimbCounts()
        this._refreshTreasurerTodoCount()
        this._attachReimbUrls()
      }).catch(() => {})
  },

  // ----- 我垫付了（任意营员自报） -----
  openReimbSubmit() {
    if (!this.data.myName) { wx.showToast({ title: '请先加入村落、设置身份', icon: 'none' }); return }
    this.setData({ showReimbSubmitModal: true, reimbAmount: '', reimbNote: '', reimbScreenshots: [], reimbFiles: [] })
  },
  hideReimbSubmit() { this.setData({ showReimbSubmitModal: false }) },
  setReimbField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  chooseReimbAttachment() { this._pickAttachment('reimbScreenshots', 'reimbFiles') },
  removeReimbScreenshot(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.reimbScreenshots]; list.splice(i, 1)
    this.setData({ reimbScreenshots: list })
  },
  previewReimbScreenshot(e) {
    const i = e.currentTarget.dataset.index
    wx.previewImage({ current: this.data.reimbScreenshots[i], urls: this.data.reimbScreenshots })
  },
  removeReimbFile(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.reimbFiles]; list.splice(i, 1)
    this.setData({ reimbFiles: list })
  },
  async submitReimb() {
    if (this.data.uploadingTx) return
    const { reimbAmount, reimbNote, reimbScreenshots, reimbFiles } = this.data
    const amount = parseFloat(reimbAmount)
    if (!(amount > 0)) { wx.showToast({ title: '请填写垫付金额', icon: 'none' }); return }
    this.setData({ uploadingTx: true })
    wx.showLoading({ title: '提交中...', mask: true })
    try {
      const imgIDs = await this._uploadScreenshots(reimbScreenshots)
      const fileAtts = (reimbFiles || []).map(f => ({ fileID: f.fileID, name: f.name, type: 'file' }))
      const res = await wx.cloud.callFunction({
        name: 'campManager',
        data: { action: 'submitReimbursement', data: { amount, note: reimbNote, receipts: imgIDs.concat(fileAtts) } }
      })
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
      wx.showToast({ title: '已提交，等账房报销', icon: 'success' })
      this.setData({ showReimbSubmitModal: false, reimbScreenshots: [], reimbFiles: [] })
      this._reloadReimb()
    } catch (e) {
      wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' })
    } finally {
      this.setData({ uploadingTx: false })
    }
  },

  // ----- 我的垫付（列表 + 撤回） -----
  openMyReimb() {
    this.setData({ showMyReimbModal: true, myReimbFilter: 'all', myReimbTab: 'free', convSelecting: false, convChecked: {}, convCheckedP: {}, convSelTotal: '0.00' })
    this._refreshMyReimbCounts()
    this._reloadReimb()
    this._loadConversions()
    this._loadMyAdvances()
    this._loadMyUnsettled()
  },
  setMyReimbTab(e) { this.setData({ myReimbTab: e.currentTarget.dataset.val }) },
  _loadMyAdvances() {
    wx.cloud.callFunction({ name: 'purchaseManager', data: { action: 'getMyPurchaseAdvances' } })
      .then(res => {
        const r = res.result || {}
        const list = (r.list || []).map(p => ({ ...p, amountDisplay: (Number(p.amount) || 0).toFixed(2) }))
        this.setData({ myAdvances: list, myAdvancesTotal: (Number(r.total) || 0).toFixed(2) })
      }).catch(() => {})
  },
  hideMyReimb() { this.setData({ showMyReimbModal: false, convSelecting: false, convChecked: {}, convCheckedP: {} }) },
  setMyReimbFilter(e) { this.setData({ myReimbFilter: e.currentTarget.dataset.val }) },

  // ===== 待报销转借款（两来源：自由垫付 reimb + 采购垫款 purchase）=====
  toggleConvSelect() {
    const on = !this.data.convSelecting
    this.setData({ convSelecting: on, convChecked: {}, convCheckedP: {}, convSelTotal: '0.00', myReimbFilter: on ? 'pending' : this.data.myReimbFilter })
  },
  toggleConvItem(e) {
    const id = e.currentTarget.dataset.id
    const amount = Number(e.currentTarget.dataset.amount) || 0
    const checked = Object.assign({}, this.data.convChecked)
    if (checked[id]) delete checked[id]; else checked[id] = amount
    this.setData({ convChecked: checked }, () => this._recalcConvTotal())
  },
  toggleConvPItem(e) {
    const id = e.currentTarget.dataset.id
    const amount = Number(e.currentTarget.dataset.amount) || 0
    const checked = Object.assign({}, this.data.convCheckedP)
    if (checked[id]) delete checked[id]; else checked[id] = amount
    this.setData({ convCheckedP: checked }, () => this._recalcConvTotal())
  },
  _recalcConvTotal() {
    const a = Object.values(this.data.convChecked).reduce((s, x) => s + (Number(x) || 0), 0)
    const b = Object.values(this.data.convCheckedP).reduce((s, x) => s + (Number(x) || 0), 0)
    this.setData({ convSelTotal: (a + b).toFixed(2) })
  },
  submitConversion() {
    const items = []
    Object.keys(this.data.convChecked).forEach(id => items.push({ source: 'reimb', id }))
    Object.keys(this.data.convCheckedP).forEach(id => items.push({ source: 'purchase', id }))
    if (items.length === 0) { wx.showToast({ title: '先勾选要转借款的垫付', icon: 'none' }); return }
    const total = this.data.convSelTotal
    wx.showModal({
      title: '转为借款',
      content: `把选中的 ${items.length} 笔（¥${total}）转为村里借款？\n转成借款后这些钱不再走报销、改为村里长期欠你，需全体主管审核通过后生效。`,
      confirmText: '发起申请',
      success: (r) => {
        if (!r.confirm) return
        wx.showLoading({ title: '提交中...' })
        wx.cloud.callFunction({ name: 'memberManager', data: { action: 'proposeConversion', data: { items } } })
          .then(res => {
            wx.hideLoading()
            if (!res.result.success) { wx.showModal({ title: '发起失败', content: res.result.msg || '', showCancel: false }); return }
            wx.showToast({ title: '已提交，等主管审核', icon: 'none' })
            this.setData({ convSelecting: false, convChecked: {}, convCheckedP: {}, convSelTotal: '0.00' })
            this._reloadReimb(); this._loadConversions(); this._loadMyAdvances()
          })
          .catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
      }
    })
  },
  cancelMyConversion(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤回申请', content: '撤回后这些垫付回到待报销，可重新报销或再次转借款。',
      confirmText: '撤回',
      success: (r) => {
        if (!r.confirm) return
        wx.cloud.callFunction({ name: 'memberManager', data: { action: 'cancelConversion', data: { id } } })
          .then(res => {
            if (!res.result.success) { wx.showToast({ title: res.result.msg || '撤回失败', icon: 'none' }); return }
            wx.showToast({ title: '已撤回', icon: 'success' })
            this._reloadReimb(); this._loadConversions()
          })
      }
    })
  },
  // 主管审核
  reviewConv(e) {
    const { id, agree } = e.currentTarget.dataset
    if (agree) {
      wx.showModal({
        title: '通过转借款', content: '确认转为村里借款？需全体主管都通过才生效。通过后这笔钱记入借款台账、不再走报销；金库余额不变。',
        confirmText: '通过',
        success: (r) => { if (r.confirm) this._doReviewConv(id, true) }
      })
    } else {
      wx.showModal({
        title: '驳回', content: '驳回后这些垫付退回待报销。', editable: true, placeholderText: '驳回原因（选填）',
        confirmText: '驳回', confirmColor: '#e74c3c',
        success: (r) => { if (r.confirm) this._doReviewConv(id, false, r.content || '') }
      })
    }
  },
  _doReviewConv(id, agree, reason) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'reviewConversion', data: { id, agree, reason: reason || '' } } })
      .then(res => {
        wx.hideLoading()
        const r = res.result || {}
        if (!r.success) { wx.showToast({ title: r.msg || '处理失败', icon: 'none' }); return }
        const msg = r.result === 'approved' ? '已通过，已记入借款台账' : (r.result === 'rejected' ? '已驳回' : `已记你这票（${r.approved}/${r.need}）`)
        wx.showToast({ title: msg, icon: 'none' })
        this._loadConversions()
        this.loadStats && this.loadStats()
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '处理失败', icon: 'none' }) })
  },
  _loadConversions() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getConversions' } })
      .then(res => {
        const r = res.result || {}
        this.setData({
          convReviews: r.toReview || [],
          convMine: (r.mine || []).filter(c => c.status === 'pending'),
          iAmSupervisorConv: !!r.iAmSupervisor
        })
      }).catch(() => {})
  },
  // 我的垫付各状态计数（筛选 chips 的角标；渲染层用 wx:if 过滤，不复制列表、缩略图链接不失联）
  _refreshMyReimbCounts() {
    const list = this.data.reimbMine || []
    const c = { all: list.length, pending: 0, reimbursed: 0, rejected: 0, donated: 0 }
    list.forEach(m => { if (c[m.status] !== undefined) c[m.status] += 1 })
    this.setData({ myReimbCounts: c })
  },
  cancelMyReimb(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤回垫付', content: '撤回后这条垫付登记和凭证都会删除，确认？',
      confirmText: '撤回', confirmColor: '#e74c3c', cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return
        wx.cloud.callFunction({ name: 'campManager', data: { action: 'cancelReimbursement', data: { id } } })
          .then(res => {
            if (!res.result.success) { wx.showToast({ title: res.result.msg || '撤回失败', icon: 'none' }); return }
            wx.showToast({ title: '已撤回', icon: 'success' })
            this._reloadReimb()
          }).catch(() => wx.showToast({ title: '撤回失败', icon: 'none' }))
      }
    })
  },
  async previewReimbReceipt(e) {
    const shots = e.currentTarget.dataset.shots || []
    if (!shots.length) return
    wx.showLoading({ title: '加载中...' })
    const map = await this._toTempUrls(shots)
    wx.hideLoading()
    const urls = shots.map(s => map[s] || s)
    wx.previewImage({ current: urls[0], urls })
  },

  // ----- 账房：待报销处理 -----
  openReimbPending() { this.setData({ showReimbPendingModal: true }); this._reloadReimb() },
  hideReimbPending() { this.setData({ showReimbPendingModal: false }) },
  // 勾选/全选
  toggleReimbItem(e) {
    const { gi, ii } = e.currentTarget.dataset
    const cur = this.data.reimbGroups[gi].items[ii].checked
    this.setData({ [`reimbGroups[${gi}].items[${ii}].checked`]: !cur }, () => this._recalcGroup(gi))
  },
  toggleReimbGroupAll(e) {
    const gi = e.currentTarget.dataset.gi
    const g = this.data.reimbGroups[gi]
    const target = !g.allChecked
    const items = g.items.map(i => ({ ...i, checked: target }))
    this.setData({ [`reimbGroups[${gi}].items`]: items }, () => this._recalcGroup(gi))
  },
  _recalcGroup(gi) {
    const g = this.data.reimbGroups[gi]
    const sel = g.items.filter(i => i.checked)
    const selTotal = sel.reduce((s, i) => s + (i.amount || 0), 0)
    this.setData({
      [`reimbGroups[${gi}].selCount`]: sel.length,
      [`reimbGroups[${gi}].selTotalDisplay`]: selTotal.toFixed(2),
      [`reimbGroups[${gi}].allChecked`]: sel.length === g.items.length
    })
  },

  // 结算选中：打开报销确认弹窗（批量）
  settleGroup(e) {
    const gi = e.currentTarget.dataset.gi
    const g = this.data.reimbGroups[gi]
    const sel = g.items.filter(i => i.checked)
    if (sel.length === 0) { wx.showToast({ title: '至少选一笔', icon: 'none' }); return }
    const total = sel.reduce((s, i) => s + (i.amount || 0), 0)
    this.setData({
      showReimbPayModal: true,
      reimbPaySel: {
        applicantName: g.applicantName,
        ids: sel.map(i => i._id),
        items: sel.map(i => ({ note: i.note, amountDisplay: i.amountDisplay })),
        count: sel.length,
        totalDisplay: total.toFixed(2)
      },
      reimbPayShots: [],
      reimbPayFiles: []
    })
  },
  hideReimbPay() { this.setData({ showReimbPayModal: false }) },
  chooseReimbPayAttachment() { this._pickAttachment('reimbPayShots', 'reimbPayFiles') },
  removeReimbPayShot(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.reimbPayShots]; list.splice(i, 1)
    this.setData({ reimbPayShots: list })
  },
  previewReimbPayShot(e) {
    const i = e.currentTarget.dataset.index
    wx.previewImage({ current: this.data.reimbPayShots[i], urls: this.data.reimbPayShots })
  },
  removeReimbPayFile(e) {
    const i = e.currentTarget.dataset.index
    const list = [...this.data.reimbPayFiles]; list.splice(i, 1)
    this.setData({ reimbPayFiles: list })
  },
  async confirmReimbPay() {
    if (this.data.uploadingTx) return
    const sel = this.data.reimbPaySel
    if (!sel || !sel.ids || sel.ids.length === 0) return
    this.setData({ uploadingTx: true })
    wx.showLoading({ title: '结算中...', mask: true })
    try {
      const imgIDs = await this._uploadScreenshots(this.data.reimbPayShots)
      const fileAtts = (this.data.reimbPayFiles || []).map(f => ({ fileID: f.fileID, name: f.name, type: 'file' }))
      const res = await wx.cloud.callFunction({
        name: 'campManager',
        data: { action: 'reimburseBatch', data: { ids: sel.ids, payShots: imgIDs.concat(fileAtts) } }
      })
      wx.hideLoading()
      const r = res.result || {}
      if (!r.success) { wx.showToast({ title: r.msg || '结算失败', icon: 'none' }); return }
      const txt = r.skipped > 0 ? `已结 ${r.settled} 笔，${r.skipped} 笔已被处理` : `已结算 ${r.settled} 笔`
      wx.showToast({ title: txt, icon: r.skipped > 0 ? 'none' : 'success' })
      this.setData({ showReimbPayModal: false, reimbPaySel: null, reimbPayShots: [], reimbPayFiles: [] })
      this.showLedger(); this.loadStats(); this.loadLogs()
    } catch (e) {
      wx.hideLoading(); wx.showToast({ title: '结算失败', icon: 'none' })
    } finally {
      this.setData({ uploadingTx: false })
    }
  },
  donateReimburse(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '记为捐赠',
      content: `「${item.applicantName}」垫的这 ¥${item.amountDisplay} 不报销，记为对村落的捐赠，不动金库。`,
      confirmText: '确认',
      success: (r) => { if (r.confirm) this._doReimburse(item._id, 'donation') }
    })
  },
  rejectReimburse(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '驳回垫付', editable: true, placeholderText: '填写驳回原因（必填）',
      confirmText: '驳回', confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return
        const reason = (r.content || '').trim()
        if (!reason) { wx.showToast({ title: '请填驳回原因', icon: 'none' }); return }
        this._doReimburse(item._id, 'reject', reason)
      }
    })
  },
  revokeReimburse(e) {
    const item = e.currentTarget.dataset.item
    wx.showModal({
      title: '撤销报销',
      content: `撤销对「${item.applicantName}」¥${item.amountDisplay} 的报销：删掉那笔金库支出、钱退回金库，垫付回到待报销。`,
      confirmText: '撤销报销', confirmColor: '#e74c3c',
      success: (r) => { if (r.confirm) this._doReimburse(item._id, 'revoke') }
    })
  },
  _doReimburse(id, mode, rejectReason) {
    wx.showLoading({ title: '处理中...', mask: true })
    const action = mode === 'revoke' ? 'revokeReimbursement' : 'reimburse'
    const data = mode === 'revoke' ? { id } : { id, mode, rejectReason: rejectReason || '' }
    wx.cloud.callFunction({ name: 'campManager', data: { action, data } })
      .then(res => {
        wx.hideLoading()
        if (!res.result.success) { wx.showToast({ title: res.result.msg || '处理失败', icon: 'none' }); return }
        wx.showToast({ title: '已处理', icon: 'success' })
        this.showLedger()   // 刷新流水 + 待报销 + 我的垫付
        this.loadStats()
        this.loadLogs()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '处理失败', icon: 'none' }) })
  },

  // ========== 导出账目 ==========
  showExportModal() {
    const { start, end } = this._getRangeBounds('all')
    this.setData({
      showExportModal: true,
      exportMode: 'expenses',
      exportViewIndex: 0,
      exportViewLabel: '项目累计实际费用',
      exportViewHint: '包含所有真实发生过的费用，只计一次；可看到具体买了什么、谁垫付、当前是否已付或仍欠款。',
      exportRange: 'all',
      exportStartDate: start,
      exportEndDate: end
    }, () => this._computeExportPreviewCount())
  },

  hideExportModal() { this.setData({ showExportModal: false }) },

  _getRangeBounds(key) {
    const today = new Date()
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    if (key === 'all') {
      return { start: fmt(START_DATE), end: fmt(today) }
    }
    if (key === 'thisMonth') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      return { start: fmt(start), end: fmt(today) }
    }
    if (key === 'lastMonth') {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 0)
      return { start: fmt(start), end: fmt(end) }
    }
    return { start: this.data.exportStartDate, end: this.data.exportEndDate }
  },

  setExportView(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const values = this.data.exportViewValues || []
    const labels = this.data.exportViewOptions || []
    const mode = values[idx] || 'expenses'
    const hints = {
      expenses: '包含所有真实发生过的费用，只计一次；可看到具体买了什么、谁垫付、当前是否已付或仍欠款。',
      debt: '只看当前仍欠着的钱：待报销、采购垫款、转借款审核中、长期借款未偿部分。',
      loan: '只看已经由原垫付/采购转成长期借款、目前仍未还清的消费来源。',
      pending: '只看尚未结清的待报销/采购垫款，以及正在转长期借款审核中的费用。',
      paid: '只看这些真实费用中，金库已经实际承担的部分；长期借款后续还款也算已支付，但不会再算一笔新费用。',
      transactions: '原始金库流水，沿用当前流水筛选中的类型 / 人员条件。'
    }
    this.setData({
      exportViewIndex: idx,
      exportMode: mode,
      exportViewLabel: labels[idx] || '项目累计实际费用',
      exportViewHint: hints[mode] || ''
    }, () => this._computeExportPreviewCount())
  },

  setExportRange(e) {
    const val = e.currentTarget.dataset.val
    if (val === 'custom') {
      this.setData({ exportRange: val }, () => this._computeExportPreviewCount())
      return
    }
    const { start, end } = this._getRangeBounds(val)
    this.setData({ exportRange: val, exportStartDate: start, exportEndDate: end }, () => this._computeExportPreviewCount())
  },

  setExportStartDate(e) {
    this.setData({ exportStartDate: e.detail.value, exportRange: 'custom' }, () => this._computeExportPreviewCount())
  },

  setExportEndDate(e) {
    this.setData({ exportEndDate: e.detail.value, exportRange: 'custom' }, () => this._computeExportPreviewCount())
  },

  _computeExportPreviewCount() {
    const { exportMode, ledgerList, exportStartDate, exportEndDate, ledgerTypeFilter, ledgerPersonFilter } = this.data
    if (!exportStartDate || !exportEndDate) { this.setData({ exportPreviewCount: 0 }); return }
    // 除“金库流水”外，其余都是服务端跨 transactions/reimbursements/purchases/loans 汇总，不能用前端 200 条流水估算。
    if (exportMode !== 'transactions') { this.setData({ exportPreviewCount: -1 }); return }
    const start = new Date(exportStartDate + 'T00:00:00')
    const end = new Date(exportEndDate + 'T23:59:59')
    let list = ledgerList.filter(t => {
      const d = new Date(t.createdAt)
      return d >= start && d <= end
    })
    if (ledgerTypeFilter !== 'all') list = list.filter(t => t.type === ledgerTypeFilter)
    if (ledgerPersonFilter !== 'all') list = list.filter(t => t.payerDisplay === ledgerPersonFilter)
    this.setData({ exportPreviewCount: list.length })
  },

  async confirmExport() {
    if (this.data.exportingNow) return
    const { exportStartDate, exportEndDate, ledgerTypeFilter, ledgerPersonFilter } = this.data
    if (!exportStartDate || !exportEndDate) { wx.showToast({ title: '请选择时间范围', icon: 'none' }); return }
    if (exportStartDate > exportEndDate) { wx.showToast({ title: '结束日期不能早于开始', icon: 'none' }); return }

    this.setData({ exportingNow: true })
    wx.showLoading({ title: '生成中...', mask: true })
    try {
      const isTxnExport = this.data.exportMode === 'transactions'
      const res = await wx.cloud.callFunction({
        name: 'campManager',
        data: {
          action: isTxnExport ? 'exportTransactions' : 'exportFullLedger',
          data: isTxnExport
            ? { startDate: exportStartDate, endDate: exportEndDate, typeFilter: ledgerTypeFilter, personFilter: ledgerPersonFilter }
            : { startDate: exportStartDate, endDate: exportEndDate, view: this.data.exportMode }
        }
      })
      if (!res.result || !res.result.success) {
        wx.hideLoading()
        wx.showToast({ title: (res.result && res.result.msg) || '生成失败', icon: 'none' })
        return
      }
      const { base64, filename, count } = res.result
      if (count === 0) {
        wx.hideLoading()
        wx.showToast({ title: '所选范围内没有记录', icon: 'none' })
        return
      }
      const filePath = `${wx.env.USER_DATA_PATH}/${filename}`
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().writeFile({
          filePath, data: base64, encoding: 'base64',
          success: resolve, fail: reject
        })
      })
      wx.hideLoading()
      wx.openDocument({
        filePath, fileType: 'xlsx', showMenu: true,
        success: () => { this.setData({ showExportModal: false }) },
        fail: (err) => {
          console.error('openDocument failed', err)
          wx.showToast({ title: '打开失败：' + (err.errMsg || ''), icon: 'none' })
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '生成失败', icon: 'none' })
      console.error(e)
    } finally {
      this.setData({ exportingNow: false })
    }
  }
})