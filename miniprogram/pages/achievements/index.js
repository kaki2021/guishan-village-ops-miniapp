const ALL_ACHIEVEMENTS = [
  { key: 'camp_start', name: '营地建立', icon: '🏕️', desc: '第一天入驻' },
  { key: 'first_supply', name: '第一顿饭', icon: '🍳', desc: '完成首次采购记录' },
  { key: 'builder', name: '动手达人', icon: '🔨', desc: '完成5个建设任务' },
  { key: 'recorder', name: '记录者', icon: '📸', desc: '连续7天有记录' },
  { key: 'hundred_days', name: '百日营地', icon: '🌟', desc: '运营满100天' },
  { key: 'rich_camp', name: '万金营地', icon: '💰', desc: '金库曾达¥10000' },
  { key: 'full_house', name: '客满为患', icon: '🏠', desc: '同时接待5组客人' },
  { key: 'festival', name: '文化节', icon: '🎪', desc: '举办首次营地活动' }
]

Page({
  data: {
    unlocked: [],
    locked: []
  },

  onShow() {
    this.checkAndLoad()
  },

  checkAndLoad() {
    wx.cloud.callFunction({
      name: 'memberManager',
      data: { action: 'checkAndUnlock' }
    }).then(res => {
      const newUnlocked = res.result.newUnlocked || []
      if (newUnlocked.length > 0) {
        wx.showToast({ title: '解锁新成就：' + newUnlocked[0], icon: 'success', duration: 2500 })
      }
      this.loadAchievements()
    }).catch(() => {
      this.loadAchievements()
    })
  },

  loadAchievements() {
    wx.cloud.callFunction({
      name: 'memberManager',
      data: { action: 'getAchievements' }
    }).then(res => {
      const unlockedKeys = (res.result.list || []).map(a => a.key)
      const unlocked = ALL_ACHIEVEMENTS.filter(a => unlockedKeys.includes(a.key))
      const locked = ALL_ACHIEVEMENTS.filter(a => !unlockedKeys.includes(a.key))
      this.setData({ unlocked, locked })
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' })
    })
  }
})