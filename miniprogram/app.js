const { cloudEnvId } = require('./config.local')

const CLOUD_ENV_PLACEHOLDER = 'your-cloud-env-id'

function getCloudEnvId() {
  const value = typeof cloudEnvId === 'string' ? cloudEnvId.trim() : ''
  if (!value || value === CLOUD_ENV_PLACEHOLDER) {
    throw new Error(
      '未配置云开发环境 ID：请复制 miniprogram/config.example.js 为 ' +
      'miniprogram/config.local.js，并填写 cloudEnvId。'
    )
  }
  return value
}

App({
  onLaunch: function () {
    const env = getCloudEnvId()

    this.globalData = {
      env,
      myName: wx.getStorageSync('myName') || ''
    }

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力")
      return
    }

    wx.cloud.init({ env: this.globalData.env, traceUser: true })

    // 用 openid 反查身份，自动恢复
    wx.cloud.callFunction({
      name: 'memberManager',
      data: { action: 'getMyName' }
    }).then(res => {
      const name = res.result && res.result.name
      if (name) {
        this.globalData.myName = name
        wx.setStorageSync('myName', name)
      }
    }).catch(() => {})

    // 周经验重置：每周一自动重置一次
    const getThisMonday = () => {
      const today = new Date()
      const day = today.getDay()
      const diff = today.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(today)
      monday.setDate(diff)
      return monday.toISOString().split('T')[0]
    }
    const thisMonday = getThisMonday()
    const lastReset = wx.getStorageSync('lastWeekReset') || ''
    if (lastReset !== thisMonday) {
      wx.cloud.callFunction({
        name: 'memberManager',
        data: { action: 'resetWeekXp' }
      }).then(() => {
        wx.setStorageSync('lastWeekReset', thisMonday)
      }).catch(() => {})
    }
  },

  setMyName(name) {
    this.globalData.myName = name
    wx.setStorageSync('myName', name)
  },

  // 北京自然日 YYYY-MM-DD
  _bjToday() {
    const t = new Date(Date.now() + 8 * 3600 * 1000)
    return t.toISOString().split('T')[0]
  },

  // 每天第一次进小程序：拉起打卡页（已加入村落、且今天还没弹过）
  onShow() {
    const today = this._bjToday()
    const last = wx.getStorageSync('lastCheckinPrompt') || ''
    const myName = (this.globalData && this.globalData.myName) || wx.getStorageSync('myName') || ''
    if (last === today || !myName) return
    // 延迟确保首页已挂载，再 navigateTo 到非 tab 的打卡页
    setTimeout(() => {
      wx.setStorageSync('lastCheckinPrompt', today)
      wx.navigateTo({ url: '/pages/checkin/index' })
    }, 800)
  }
})
