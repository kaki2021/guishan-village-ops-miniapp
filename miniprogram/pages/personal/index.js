const app = getApp()

const TASK_STATE_DEF = {
  doing:       { icon: '📋', colorClass: 'c-green',  hint: '在 任务页 标记完成' },
  waitConfirm: { icon: '⏳', colorClass: 'c-blue',   hint: '已完成，等主管确认' },
  onhold:      { icon: '⏸️', colorClass: 'c-orange', hint: '已搁置，待主管解除' }
}

Page({
  data: {
    myName: '',
    me: null,
    roleBadges: [],   // ['主管','库管','账房先生']
    todoItems: [],    // 采购待办：[{label,count,hint,icon,colorClass}]，纯展示
    myTasks: [],      // 我未完成的任务：[{_id,name,typeName,hint,icon,colorClass}]，纯展示
    titleDuties: [],  // 今日头衔待办（清单逐条勾选；路A：只留痕，不影响 XP）
    dutyDate: '',
    dutyCheckedIn: false,
    worklogDays: [],  // 我的日报：[{date,completedText,isValidWorkday}]
    weekValid: 0,     // 本周有效工作日
    monthValid: 0,    // 本月有效工作日
  },

  onShow() {
    const myName = app.globalData.myName || wx.getStorageSync('myName') || ''
    this.setData({ myName })
    if (!myName) { this.setData({ me: null, todoItems: [], myTasks: [], titleDuties: [], worklogDays: [], weekValid: 0, monthValid: 0 }); return }
    this.loadAll()
  },

  loadAll() {
    Promise.all([
      wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getMembers' } }),
      wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getRoles' } }),
      wx.cloud.callFunction({ name: 'purchaseManager', data: { action: 'getMyPurchaseTodos' } }),
      wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getMyOpenTasks', data: { name: this.data.myName } } }),
      wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getMyWorklog', data: { name: this.data.myName, limit: 14 } } }),
      wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getMyTitleDuties' } }).catch(() => ({ result: { duties: [] } }))
    ]).then(([mRes, rRes, pRes, tRes, wRes, dRes]) => {
      // 身份
      const me = (mRes.result.list || []).find(m => m.name === this.data.myName) || null
      const r = rRes.result || {}
      const badges = []
      if (r.me && r.me.isSupervisor) badges.push('主管')
      if (r.me && r.me.isKeeper) badges.push('库管')
      if (r.me && r.me.isTreasurer) badges.push('账房先生')

      // 采购待办（纯展示，只列 count>0，带图标/色块/去哪处理的提示）
      const counts = (pRes.result && pRes.result.counts) || {}
      const defs = [
        { key: 'toApprove', label: '待我审批的采购', hint: '在 仓库 · 采购 处理', icon: '🔍', colorClass: 'c-blue' },
        { key: 'toVerify', label: '待我核验的采购', hint: '在 仓库 · 采购 处理', icon: '✅', colorClass: 'c-blue' },
        { key: 'toStockIn', label: '待我入库的采购', hint: '在 仓库 · 采购 处理', icon: '📦', colorClass: 'c-green' },
        { key: 'toRecord', label: '待我记账的采购', hint: '在 总览 · 金库流水 处理', icon: '💰', colorClass: 'c-orange' },
        { key: 'myBuying', label: '我领取待报账的采购', hint: '在 仓库 · 采购 报账', icon: '🧾', colorClass: 'c-orange' },
        { key: 'myRejected', label: '我发起被驳回待重提', hint: '在 仓库 · 采购 改单重提', icon: '↩️', colorClass: 'c-red' }
      ]
      const todoItems = defs
        .filter(d => (counts[d.key] || 0) > 0)
        .map(d => ({ label: d.label, count: counts[d.key], hint: d.hint, icon: d.icon, colorClass: d.colorClass }))

      // 我未完成的任务（带状态：进行中/待确认/搁置，图标与提示各不同）
      const myTasks = ((tRes.result && tRes.result.list) || []).map(t => {
        const st = TASK_STATE_DEF[t.myTaskState] || TASK_STATE_DEF.doing
        const typeSuffix = t.typeName ? '（' + t.typeName + '）' : ''
        return {
          _id: t._id,
          name: t.name,
          typeName: t.typeName || '',
          icon: st.icon,
          colorClass: st.colorClass,
          hint: st.hint + typeSuffix
        }
      })

      // 我的日报（近14天，只展示有完成内容的天）
      const w = wRes.result || {}
      const stat = w.stat || { weekValid: 0, monthValid: 0 }
      const worklogDays = (w.days || []).map(d => ({
        date: d.date,
        isValidWorkday: d.isValidWorkday,
        completedText: (d.completed || []).map(c => c.name).join('、') || '—',
        noteCount: (d.notes || []).length
      }))

      // 今日头衔待办
      const d = dRes.result || {}
      this.setData({
        me, roleBadges: badges, todoItems, myTasks,
        titleDuties: d.duties || [], dutyDate: d.date || '', dutyCheckedIn: !!d.checkedIn,
        worklogDays, weekValid: stat.weekValid, monthValid: stat.monthValid
      })
    }).catch(() => {})
  },

  // 勾/取消勾一条头衔清单项。乐观更新：先动 UI，失败再回滚
  toggleDutyItem(e) {
    const { titleid, itemid, checked } = e.currentTarget.dataset
    const next = !checked
    const duties = this.data.titleDuties.map(d => {
      if (d.titleId !== titleid) return d
      const items = d.items.map(it => it.id === itemid ? Object.assign({}, it, { checked: next }) : it)
      return Object.assign({}, d, { items, doneCount: items.filter(x => x.checked).length })
    })
    this.setData({ titleDuties: duties })
    wx.cloud.callFunction({
      name: 'taskManager',
      data: { action: 'toggleTitleChecklistItem', data: { date: this.data.dutyDate, titleId: titleid, itemId: itemid, checked: next } }
    }).then(res => {
      if (!res.result.success) throw new Error(res.result.msg)
    }).catch(() => {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      this.loadAll()   // 回滚成服务端真实状态
    })
  }
})
