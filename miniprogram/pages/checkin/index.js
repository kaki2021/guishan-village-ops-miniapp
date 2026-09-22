const app = getApp()
const WD = ['日', '一', '二', '三', '四', '五', '六']   // getUTCDay: 0=周日

Page({
  data: {
    name: '',
    today: '',
    days: [],          // 最新在前
    loading: true,
    pendingCount: 0    // 待打卡（过去+今天未打卡）的天数
  },

  onShow() { this.load() },

  load() {
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'getCheckinView', data: { days: 7 } } })
      .then(res => {
        const r = res.result || {}
        const days = (r.days || []).map(d => this.fmt(d))
        const pendingCount = days.filter(d => !d.checkedIn).length
        this.setData({ name: r.name || '', today: r.today || '', days, pendingCount, loading: false })
      })
      .catch(() => { this.setData({ loading: false }); wx.showToast({ title: '加载失败', icon: 'none' }) })
  },

  fmt(d) {
    const p = d.date.split('-')
    const wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()
    const md = (+p[1]) + '/' + (+p[2])
    const label = d.isToday ? '今天' : (md + ' 周' + WD[wd])
    return Object.assign({}, d, { label, md, empty: (d.completedCount === 0 && (!d.duties || d.duties.length === 0)) })
  },

  doCheckIn(e) {
    const date = e.currentTarget.dataset.date
    wx.showLoading({ title: '打卡中...' })
    wx.cloud.callFunction({ name: 'taskManager', data: { action: 'checkIn', data: { date } } })
      .then(res => {
        wx.hideLoading()
        if (!res.result || !res.result.success) {
          wx.showToast({ title: (res.result && res.result.msg) || '打卡失败', icon: 'none' }); return
        }
        const xp = res.result.awardedXp || 0
        wx.showToast({ title: xp > 0 ? ('已打卡 +' + xp + 'xp') : '已打卡', icon: 'success' })
        this.load()
      })
      .catch(() => { wx.hideLoading(); wx.showToast({ title: '打卡失败', icon: 'none' }) })
  },

  close() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  }
})