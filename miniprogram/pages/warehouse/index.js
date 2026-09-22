const app = getApp()

const CATEGORY_ICONS = {
  '食材': '🥬',
  '耗材': '🧴',
  '其他': '📦'
}

const PURCHASE_STATUS = {
  pending: '待审批',
  rejected: '已驳回',
  open: '待领取',
  buying: '采购中',
  checking: '待核验',
  verified: '待入库',
  done: '已入库'
}

Page({
  data: {
    // ===== 顶部 tab =====
    activeTab: 'stock', // 'stock' | 'purchase'

    // ===== 库存（原有） =====
    showModal: false,
    type: 'in',
    name: '',
    qty: '',
    icon: '',
    category: '食材',
    items: [],
    groupedItems: [],
    categories: ['食材', '耗材', '其他'],
    showNewCategory: false,
    newCategoryName: '',
    newCategoryIcon: '',
    myName: '',
    showQtyModal: false,
    qtyModalName: '',
    qtyModalType: 'out',
    qtyModalQty: '1',
    showEditItemModal: false,
    editItemId: '',
    editItemName: '',
    editItemIcon: '',
    editItemCategory: '',
    editItemThreshold: '',
    // 编辑弹窗实拍图三态
    editPhotoFileID: '',
    editPhotoLocal: '',
    editPhotoUrl: '',

    // ===== 采购 =====
    iAmSupervisor: false,   // 兼容：管任意地方即真
    iAmKeeper: false,
    iCanManageStock: false, // 对「当前浏览地方」我能不能直接管库存（库管/兜底主管）
    // 按地方分管：我的管辖范围 + 全部角色名单（算 iCanManageStock / 采购按钮用）
    mySupSites: [],
    myKeepSites: [],
    mySupGlobal: false,
    myKeepGlobal: false,
    rolesSup: [],
    rolesKeep: [],
    // 发起采购：这单给哪个地方
    pSiteId: '',
    pSiteName: '',
    purchases: [],
    // 联系人（供应商通讯录）
    showContactModal: false,
    contacts: [],
    contactsFiltered: [],
    contactTags: [],
    contactTagFilter: '',
    contactKw: '',
    showContactEdit: false,
    cEditId: '', cName: '', cTag: '', cPhone: '', cWechat: '', cNote: '',
    // 我垫付待还（采购人视角横幅）
    myAwaitCount: 0,
    myAwaitTotal: '0.00',
    myAwaitList: [],
    myAwaitOpen: false,
    purchaseFilter: 'todo', // 'todo' | 'done' | 'all'
    // 采购类型筛选：全部 | 物资 | 食材（食材单独列，需求 2026-07）
    pKindFilter: 'all',     // 'all' | 'general' | 'food'
    // 状态细筛：'all' 或具体 status（chips 按当前可见集合动态生成，带数量）
    pStatusFilter: 'all',
    pStatusChips: [],       // [{val,label,count}]
    // 时间区间筛选（按发起时间 createdAt）：可只填一头；都空 = 不限
    pRangeStart: '',        // YYYY-MM-DD
    pRangeEnd: '',
    purchasesFiltered: [],

    // 发起 / 重提
    showPurchaseModal: false,
    pEditId: '',
    pKind: 'general',       // 这单的采购类型：'general' 物资 | 'food' 食材
    pTitle: '',
    pReason: '',
    pBudget: '',
    pItems: [{ name: '', spec: '', qty: '' }],

    // 详情
    showPDetailModal: false,
    pDetail: {},

    // 报账
    showReportModal: false,
    reportId: '',
    reportItemsText: '',
    reportAmount: '',
    reportReceipts: [],

    // 核验
    showVerifyModal: false,
    verifyId: '',
    verifyItemsText: '',
    verifyReceipts: [],
    pDetailReceiptUrls: [],
    reportReceiptUrls: [],
    verifyReceiptUrls: [],

    // 入库确认
    showStockInModal: false,
    stockInId: '',
    stockInItems: [],
    siSiteId: '',
    siSiteName: '',
    siStoreId: '',
    siStoreTabs: [],

    // ===== 库房树（地方 > 分库） =====
    tree: { sites: [] },
    siteTabs: [],          // 浏览用：[{id,name}]，可能含"未归类"
    currentSiteId: '',
    storeTabs: [],         // 当前地方下的分库
    currentStoreId: '',
    allStockItems: [],     // 全部库存（未按库过滤）

    // ===== AI 帮填入库 =====
    showAiModal: false,
    aiStep: 'input',       // 'input' 输入文字 | 'confirm' 确认清单
    aiText: '',
    aiParsing: false,
    aiItems: [],           // [{name, qty, spec}]
    aiSiteId: '',
    aiStoreTabs: [],
    aiStoreId: '',

    // 加/编辑物品时选库
    formSiteId: '',
    formStoreId: '',
    formStoreTabs: [],
    editSiteId: '',
    editStoreId: '',
    editStoreTabs: [],

    // 管理库房弹窗
    showManageModal: false,

    // ===== 领料 =====
    requisitions: [],
    reqFilter: 'todo', // todo | done | all
    requisitionsFiltered: [],
    // 发起领料
    showReqModal: false,
    reqSiteId: '',
    reqStoreId: '',
    reqStoreTabs: [],
    reqPickItems: [],   // 当前分库的非即时消耗物品，带 input 数量
    reqReason: '',
    // 编辑物品的消耗模式
    editConsumeMode: 'instant',

    // ===== 报废报损 =====
    reqSubTab: 'requisition',   // 领料 tab 内的子切换：requisition | scrap
    scraps: [],
    scrapsFiltered: [],
    showScrapModal: false,
    scrapItem: null,            // { name, spec, storeId, siteId, avail }
    scrapQty: '',
    scrapReason: '损坏',
    scrapReasonNote: '',
    scrapRecyclable: false,

    // ===== 盘点 + 操作记录 =====
    stkSubTab: 'take',     // take 盘点 | logs 操作记录
    stocktakes: [],
    whLogs: [],
    showStkModal: false,
    stkSiteId: '',
    stkStoreId: '',
    stkStoreTabs: [],
    stkItems: []           // [{id,name,systemQty,actual}]
  },

  onShow() {
    if (app.globalData.warehouseTab === 'purchase') {
      this.setData({ activeTab: 'purchase' })
      app.globalData.warehouseTab = ''
    }
    const myName = app.globalData.myName || wx.getStorageSync('myName') || ''
    this.setData({ myName })
    this.loadItems()
    this.loadRoles()
    this.loadPurchases()
    this.loadRequisitions()
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    if (tab === 'purchase') this.loadPurchases()
    else if (tab === 'requisition') this.loadRequisitions()
    else if (tab === 'stocktake') this.loadStocktakeView()
    else this.loadItems()
  },

  loadStocktakeView() {
    if (this.data.stkSubTab === 'logs') this.loadWhLogs()
    else this.loadStocktakes()
  },

  // ================= 库存（原有逻辑，未改动） =================

  async loadItems() {
    try {
      const [treeRes, itemRes, stkRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getWarehouseTree' } }),
        wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getItems' } }),
        wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getStocktakes' } }).catch(() => ({ result: { list: [] } }))
      ])
      // 每分库最近一次盘点时间（列表按时间倒序，取每库第一条）
      const stkTimeByStore = {}
      for (const r of ((stkRes.result && stkRes.result.list) || [])) {
        if (r.storeId && !stkTimeByStore[r.storeId]) stkTimeByStore[r.storeId] = this.fmtTime(r.createdAt)
      }
      const tree = (treeRes.result && treeRes.result.tree) || { sites: [] }
      let all = (itemRes.result.list || []).filter(i => i.qty > 0)
      // 实拍图：cloud:// 批量换成临时链接（铁律：不能直接把 cloud:// 喂给 image）
      const photoIds = [...new Set(all.map(i => i.photo).filter(p => typeof p === 'string' && p.indexOf('cloud://') === 0))]
      if (photoIds.length > 0) {
        try {
          const ur = await wx.cloud.callFunction({ name: 'campManager', data: { action: 'getFileUrls', data: { fileList: photoIds } } })
          const urls = (ur.result && ur.result.urls) || {}
          all = all.map(i => ({ ...i, photoUrl: (i.photo && urls[i.photo]) || '' }))
        } catch (e) { all = all.map(i => ({ ...i, photoUrl: '' })) }
      } else {
        all = all.map(i => ({ ...i, photoUrl: '' }))
      }
      // 地方 tab（含"未归类"——有 site 缺失或不在树里的物品时出现）
      const known = new Set((tree.sites || []).map(s => s.id))
      const siteTabs = (tree.sites || []).map(s => ({ id: s.id, name: s.name }))
      if (all.some(i => !i.siteId || !known.has(i.siteId))) siteTabs.push({ id: '__none__', name: '未归类' })
      let currentSiteId = this.data.currentSiteId
      if (!siteTabs.some(s => s.id === currentSiteId)) currentSiteId = (siteTabs[0] || {}).id || ''
      this.setData({ tree, allStockItems: all, siteTabs, currentSiteId, stkTimeByStore }, () => this.refreshStoreTabs())
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 当前地方下的分库 tab
  refreshStoreTabs() {
    this.recomputeCanManage()
    const { tree, currentSiteId } = this.data
    if (currentSiteId === '__none__') {
      this.setData({ storeTabs: [], currentStoreId: '__none__' }, () => this.regroup())
      return
    }
    const site = (tree.sites || []).find(s => s.id === currentSiteId)
    const storeTabs = (site && site.stores) ? site.stores.map(st => ({ id: st.id, name: st.name })) : []
    let currentStoreId = this.data.currentStoreId
    if (!storeTabs.some(st => st.id === currentStoreId)) currentStoreId = (storeTabs[0] || {}).id || ''
    this.setData({ storeTabs, currentStoreId }, () => this.regroup())
  },

  // 把当前分库的物品按 category 分组
  regroup() {
    const { allStockItems, currentSiteId, currentStoreId, tree } = this.data
    const known = new Set((tree.sites || []).map(s => s.id))
    let list
    if (currentSiteId === '__none__') {
      list = allStockItems.filter(i => !i.siteId || !known.has(i.siteId))
    } else {
      list = allStockItems.filter(i => i.storeId === currentStoreId)
    }
    const cats = [...new Set(list.map(i => i.category).filter(Boolean))]
    const merged = [...this.data.categories]
    cats.forEach(c => { if (!merged.includes(c)) merged.push(c) })
    const decorate = (i) => {
      const mode = i.consumeMode || 'instant'
      return Object.assign({}, i, {
        isInstant: mode === 'instant',
        modeLabel: mode === 'approval' ? '审批领用' : (mode === 'requisition' ? '领用' : ''),
        updateTimeText: i.updatedAt ? this.fmtTime(i.updatedAt) : ''
      })
    }
    const groupedItems = merged
      .map(cat => ({ category: cat, icon: CATEGORY_ICONS[cat] || '📁', items: list.filter(i => i.category === cat).map(decorate) }))
      .filter(g => g.items.length > 0)
    this.setData({ items: list, groupedItems, categories: merged })
  },

  selectSite(e) {
    this.setData({ currentSiteId: e.currentTarget.dataset.id, currentStoreId: '' }, () => this.refreshStoreTabs())
  },
  selectStore(e) {
    this.setData({ currentStoreId: e.currentTarget.dataset.id }, () => this.regroup())
  },

  // 取某地方的分库列表
  storesOf(siteId) {
    const site = (this.data.tree.sites || []).find(s => s.id === siteId)
    return (site && site.stores) ? site.stores.map(st => ({ id: st.id, name: st.name })) : []
  },

  // ====== 管理库房（增删改地方/分库） ======
  openManageModal() { this.setData({ showManageModal: true }) },
  hideManageModal() { this.setData({ showManageModal: false }) },
  _treeCall(payload, okMsg) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({ name: 'warehouseManager', data: payload }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
      if (okMsg) wx.showToast({ title: okMsg, icon: 'success' })
      this.loadItems()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) })
  },
  addSiteAction() {
    wx.showModal({ title: '新增地方', editable: true, placeholderText: '如：观天瀑', success: (r) => {
      if (r.confirm && r.content) this._treeCall({ action: 'addSite', data: { name: r.content.trim() } }, '已添加')
    }})
  },
  addStoreAction(e) {
    const siteId = e.currentTarget.dataset.siteid
    wx.showModal({ title: '新增分库', editable: true, placeholderText: '如：露营装备库', success: (r) => {
      if (r.confirm && r.content) this._treeCall({ action: 'addStore', data: { siteId, name: r.content.trim() } }, '已添加')
    }})
  },
  renameNodeAction(e) {
    const { kind, id, name } = e.currentTarget.dataset
    wx.showModal({ title: '改名', editable: true, content: name, success: (r) => {
      if (r.confirm && r.content) this._treeCall({ action: 'renameNode', data: { kind, id, name: r.content.trim() } }, '已改名')
    }})
  },
  removeNodeAction(e) {
    const { kind, id, name } = e.currentTarget.dataset
    wx.showModal({ title: `删除${kind === 'site' ? '地方' : '分库'}`, content: `确认删除「${name}」？（有物品时无法删除）`, confirmText: '删除', confirmColor: '#e74c3c', success: (r) => {
      if (r.confirm) this._treeCall({ action: kind === 'site' ? 'removeSite' : 'removeStore', data: { id } }, '已删除')
    }})
  },

  longPressItem(e) {
    const { id, name, icon, category, threshold } = e.currentTarget.dataset
    const canManage = this.data.iCanManageStock

    const doEdit = () => {
      const item = this.data.allStockItems.find(i => i._id === id) || {}
      const editSiteId = item.siteId || ''
      this.setData({
        showEditItemModal: true,
        editItemId: id,
        editItemName: name,
        editItemIcon: icon || '',
        editItemCategory: category || '其他',
        editItemThreshold: String(threshold || 3),
        editSiteId,
        editStoreId: item.storeId || '',
        editStoreTabs: this.storesOf(editSiteId),
        editConsumeMode: item.consumeMode || 'instant',
        // 实拍图三态：fileID(已存云端) / local(本次新选的临时路径) / url(展示用)
        editPhotoFileID: item.photo || '',
        editPhotoLocal: '',
        editPhotoUrl: item.photoUrl || ''
      })
    }
    const doScrap = () => this.openScrap(id)
    const doDelete = () => {
      wx.showModal({
        title: '删除物品',
        content: `确认删除「${name}」？（仅删空记录，有库存的需先报废/领用清空）`,
        confirmText: '删除', confirmColor: '#e74c3c', cancelText: '取消',
        success: (r) => {
          if (!r.confirm) return
          wx.cloud.callFunction({
            name: 'warehouseManager',
            data: { action: 'deleteItem', data: { id, operatorName: this.data.myName } }
          }).then((res2) => {
            if (!res2.result.success) { wx.showToast({ title: res2.result.msg || '删除失败', icon: 'none' }); return }
            wx.showToast({ title: '已删除', icon: 'success' })
            this.loadItems()
          }).catch(() => { wx.showToast({ title: '删除失败', icon: 'none' }) })
        }
      })
    }

    // 库管：编辑/报废/删除；普通营员：只能发起报废
    const actions = canManage
      ? [{ label: '编辑物品', fn: doEdit }, { label: '报废报损', fn: doScrap }, { label: '删除物品', fn: doDelete }]
      : [{ label: '报废报损', fn: doScrap }]
    wx.showActionSheet({
      itemList: actions.map(a => a.label),
      success: (res) => { if (actions[res.tapIndex]) actions[res.tapIndex].fn() }
    })
  },

  setEditItemField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  setEditItemCategory(e) { this.setData({ editItemCategory: e.currentTarget.dataset.val }) },
  setEditSite(e) {
    const siteId = e.currentTarget.dataset.id
    const stores = this.storesOf(siteId)
    this.setData({ editSiteId: siteId, editStoreTabs: stores, editStoreId: (stores[0] || {}).id || '' })
  },
  setEditStore(e) { this.setData({ editStoreId: e.currentTarget.dataset.id }) },
  setEditConsumeMode(e) { this.setData({ editConsumeMode: e.currentTarget.dataset.val }) },
  hideEditItemModal() { this.setData({ showEditItemModal: false }) },

  // 实拍图：拍照/相册选一张（覆盖旧的）
  chooseItemPhoto() {
    wx.chooseMedia({
      count: 1, mediaTypes: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (f) this.setData({ editPhotoLocal: f.tempFilePath, editPhotoUrl: f.tempFilePath })
      }
    })
  },
  removeItemPhoto() { this.setData({ editPhotoFileID: '', editPhotoLocal: '', editPhotoUrl: '' }) },
  previewEditPhoto() {
    const url = this.data.editPhotoUrl
    if (url) wx.previewImage({ current: url, urls: [url] })
  },

  async submitEditItem() {
    const { editItemId, editItemName, editItemIcon, editItemCategory, editItemThreshold, editSiteId, editStoreId, editConsumeMode, editPhotoFileID, editPhotoLocal } = this.data
    if (!editItemName) { wx.showToast({ title: '请填写物品名', icon: 'none' }); return }
    wx.showLoading({ title: '保存中...' })
    // 实拍图定稿：本次新选的先传云端拿 fileID；没动就沿用原 fileID；删了就传空串（后端会清旧文件）
    let photo = editPhotoFileID || ''
    if (editPhotoLocal) {
      try {
        const up = await wx.cloud.uploadFile({
          cloudPath: `item-photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
          filePath: editPhotoLocal
        })
        photo = up.fileID
      } catch (e) {
        wx.hideLoading()
        wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        return
      }
    }
    wx.cloud.callFunction({
      name: 'warehouseManager',
      data: {
        action: 'editItem',
        data: {
          id: editItemId,
          name: editItemName,
          icon: editItemIcon || '📦',
          category: editItemCategory,
          lowThreshold: parseInt(editItemThreshold) || 3,
          siteId: editSiteId,
          storeId: editStoreId,
          consumeMode: editConsumeMode || 'instant',
          photo,
          operatorName: this.data.myName
        }
      }
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showEditItemModal: false })
      this.loadItems()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'none' })
    })
  },

  quickMinus(e) {
    const { name, qty } = e.currentTarget.dataset
    const myName = this.data.myName
    if (qty <= 0) { wx.showToast({ title: '库存已为0', icon: 'none' }); return }
    wx.showModal({
      title: '快捷消耗', content: `确认消耗 1 个「${name}」？`,
      confirmText: '确认', cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '更新中...' })
        wx.cloud.callFunction({
          name: 'warehouseManager',
          data: { action: 'addRecord', data: { name, qty: 1, type: 'out', icon: '', category: '', operatorName: myName } }
        }).then(() => {
          wx.hideLoading()
          wx.showToast({ title: `${name} -1`, icon: 'success' })
          this.loadItems()
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '更新失败', icon: 'none' })
        })
      }
    })
  },

  quickPlus(e) {
    const { name } = e.currentTarget.dataset
    const myName = this.data.myName
    wx.showModal({
      title: '快捷补给', content: `确认补给 1 个「${name}」？`,
      confirmText: '确认', cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '更新中...' })
        wx.cloud.callFunction({
          name: 'warehouseManager',
          data: { action: 'addRecord', data: { name, qty: 1, type: 'in', icon: '', category: '', operatorName: myName } }
        }).then(() => {
          wx.hideLoading()
          wx.showToast({ title: `${name} +1`, icon: 'success' })
          this.loadItems()
        }).catch(() => {
          wx.hideLoading()
          wx.showToast({ title: '更新失败', icon: 'none' })
        })
      }
    })
  },

  longPressQty(e) {
    const { name, type } = e.currentTarget.dataset
    this.setData({ showQtyModal: true, qtyModalName: name, qtyModalType: type, qtyModalQty: '1' })
  },

  setQtyModalType(e) { this.setData({ qtyModalType: e.currentTarget.dataset.val }) },
  setQtyModalQty(e) { this.setData({ qtyModalQty: e.detail.value }) },
  hideQtyModal() { this.setData({ showQtyModal: false }) },

  submitQty() {
    const { qtyModalName, qtyModalType, qtyModalQty, myName } = this.data
    const qty = parseInt(qtyModalQty)
    if (!qty || qty <= 0) { wx.showToast({ title: '请输入有效数量', icon: 'none' }); return }
    wx.showLoading({ title: '更新中...' })
    wx.cloud.callFunction({
      name: 'warehouseManager',
      data: { action: 'addRecord', data: { name: qtyModalName, qty, type: qtyModalType, icon: '', category: '', operatorName: myName } }
    }).then(() => {
      wx.hideLoading()
      wx.showToast({ title: `${qtyModalName} ${qtyModalType === 'in' ? '+' : '-'}${qty}`, icon: 'success' })
      this.setData({ showQtyModal: false })
      this.loadItems()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '更新失败', icon: 'none' })
    })
  },

  // ================= AI 帮填入库 =================
  openAiModal() {
    const sites = this.data.tree.sites || []
    let siteId = (this.data.currentSiteId && this.data.currentSiteId !== '__none__') ? this.data.currentSiteId : ((sites[0] || {}).id || '')
    const stores = this.storesOf(siteId)
    let storeId = (this.data.currentStoreId && this.data.currentStoreId !== '__none__') ? this.data.currentStoreId : ((stores[0] || {}).id || '')
    if (!stores.some(s => s.id === storeId)) storeId = (stores[0] || {}).id || ''
    this.setData({
      showAiModal: true, aiStep: 'input', aiText: '', aiItems: [], aiParsing: false,
      aiSiteId: siteId, aiStoreTabs: stores, aiStoreId: storeId
    })
  },
  hideAiModal() { this.setData({ showAiModal: false }) },
  setAiText(e) { this.setData({ aiText: e.detail.value }) },
  setAiSite(e) {
    const siteId = e.currentTarget.dataset.id
    const stores = this.storesOf(siteId)
    this.setData({ aiSiteId: siteId, aiStoreTabs: stores, aiStoreId: (stores[0] || {}).id || '' })
  },
  setAiStore(e) { this.setData({ aiStoreId: e.currentTarget.dataset.id }) },

  // 让 AI 梳理
  aiParse() {
    const text = (this.data.aiText || '').trim()
    if (!text) { wx.showToast({ title: '先输入要入库的内容', icon: 'none' }); return }
    this.setData({ aiParsing: true })
    wx.cloud.callFunction({ name: 'aiStockIn', data: { action: 'parse', data: { text } } })
      .then(res => {
        this.setData({ aiParsing: false })
        const r = res.result || {}
        if (!r.success) {
          if (r.msg === 'unknown action') {
            wx.showModal({ title: '云函数需部署', content: '请先在开发者工具里新建并部署 aiStockIn 云函数。', showCancel: false })
          } else {
            wx.showModal({ title: '梳理失败', content: r.msg || 'AI 没能识别', showCancel: false })
          }
          return
        }
        const aiItems = (r.items || []).map(it => ({ name: it.name, qty: it.qty ? String(it.qty) : '', spec: [it.unit, it.spec].filter(Boolean).join(' ') }))
        this.setData({ aiItems, aiStep: 'confirm' })
      }).catch(err => {
        this.setData({ aiParsing: false })
        wx.showModal({ title: '调用出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false })
      })
  },
  aiBackToInput() { this.setData({ aiStep: 'input' }) },

  // 拍照 / 选图片 → 上传 → 豆包视觉识别
  aiPickImage() {
    wx.chooseMedia({
      count: 3, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const files = res.tempFiles || []
        if (!files.length) return
        this.setData({ aiParsing: true })
        Promise.all(files.map((f, i) =>
          wx.cloud.uploadFile({ cloudPath: `ai-stockin/img-${Date.now()}-${i}.jpg`, filePath: f.tempFilePath }).then(u => u.fileID)
        )).then(fileIDs => wx.cloud.callFunction({ name: 'aiStockIn', data: { action: 'parseImage', data: { fileIDs } } }))
          .then(r => {
            this.setData({ aiParsing: false })
            const rr = r.result || {}
            if (!rr.success) {
              if (rr.msg === 'unknown action') wx.showModal({ title: '云函数需更新', content: '请把 aiStockIn 云函数重新上传并部署后再试。', showCancel: false })
              else wx.showModal({ title: '识别失败', content: rr.msg || '无法识别', showCancel: false })
              return
            }
            const aiItems = (rr.items || []).map(it => ({ name: it.name, qty: it.qty ? String(it.qty) : '', spec: [it.unit, it.spec].filter(Boolean).join(' ') }))
            if (aiItems.length === 0) { wx.showModal({ title: '没识别到物品', content: '照片不够清晰，换一张或用文字/表格。', showCancel: false }); return }
            this.setData({ aiItems, aiStep: 'confirm' })
          })
          .catch(err => { this.setData({ aiParsing: false }); wx.showModal({ title: '出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false }) })
      }
    })
  },

  // 选 Excel / CSV 文件 → 上传 → 交给 aiStockIn 解析
  aiPickFile() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['xlsx', 'xls', 'csv', 'docx'],
      success: (res) => {
        const f = res.tempFiles[0]
        if (!f) return
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        if (['xlsx', 'xls', 'csv', 'docx'].indexOf(ext) < 0) { wx.showToast({ title: '支持 Excel / CSV / Word(.docx)', icon: 'none' }); return }
        if (f.size > 5 * 1024 * 1024) { wx.showToast({ title: '文件太大（≤5MB）', icon: 'none' }); return }
        this.setData({ aiParsing: true })
        const cloudPath = `ai-stockin/${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`
        wx.cloud.uploadFile({ cloudPath, filePath: f.path })
          .then(up => wx.cloud.callFunction({ name: 'aiStockIn', data: { action: 'parseFile', data: { fileID: up.fileID, ext } } }))
          .then(r => {
            this.setData({ aiParsing: false })
            const rr = r.result || {}
            if (!rr.success) {
              if (rr.msg === 'unknown action') wx.showModal({ title: '云函数需更新', content: '请把 aiStockIn 云函数重新上传并部署后再试。', showCancel: false })
              else wx.showModal({ title: '解析失败', content: rr.msg || '无法解析', showCancel: false })
              return
            }
            const aiItems = (rr.items || []).map(it => ({ name: it.name, qty: it.qty ? String(it.qty) : '', spec: [it.unit, it.spec].filter(Boolean).join(' ') }))
            if (aiItems.length === 0) { wx.showModal({ title: '没识别到物品', content: '文件里没读出物品，换个文件或用文字输入。', showCancel: false }); return }
            this.setData({ aiItems, aiStep: 'confirm' })
          })
          .catch(err => { this.setData({ aiParsing: false }); wx.showModal({ title: '出错', content: (err && (err.errMsg || err.message)) || '未知错误', showCancel: false }) })
      }
    })
  },
  setAiItemField(e) {
    const { index, field } = e.currentTarget.dataset
    const aiItems = this.data.aiItems.slice()
    aiItems[index] = Object.assign({}, aiItems[index], { [field]: e.detail.value })
    this.setData({ aiItems })
  },
  addAiItemRow() { this.setData({ aiItems: this.data.aiItems.concat([{ name: '', qty: '', spec: '' }]) }) },
  removeAiItemRow(e) {
    const i = e.currentTarget.dataset.index
    const aiItems = this.data.aiItems.slice()
    aiItems.splice(i, 1)
    this.setData({ aiItems })
  },

  // 确认入库：逐项 addRecord（type:in），复用现有入库逻辑
  async aiConfirmStockIn() {
    const { aiItems, aiStoreId, aiSiteId, myName } = this.data
    if (!aiStoreId) { wx.showToast({ title: '请选择存入哪个分库', icon: 'none' }); return }
    const valid = aiItems.filter(it => (it.name || '').trim() && (parseInt(it.qty) || 0) > 0)
    if (valid.length === 0) { wx.showToast({ title: '没有有效物品（名字+数量）', icon: 'none' }); return }
    wx.showLoading({ title: '入库中...', mask: true })
    try {
      for (const it of valid) {
        await wx.cloud.callFunction({
          name: 'warehouseManager',
          data: { action: 'addRecord', data: { name: it.name.trim(), qty: parseInt(it.qty), type: 'in', icon: '📦', category: it.spec || '', operatorName: myName, siteId: aiSiteId, storeId: aiStoreId } }
        })
      }
      wx.hideLoading()
      wx.showToast({ title: `已入库 ${valid.length} 项`, icon: 'success' })
      this.setData({ showAiModal: false })
      this.loadItems()
    } catch (e) {
      wx.hideLoading()
      wx.showModal({ title: '入库出错', content: (e && (e.errMsg || e.message)) || '部分物品可能未入库，请到库存核对', showCancel: false })
      this.loadItems()
    }
  },

  showAddModal() {
    const sites = this.data.tree.sites || []
    let siteId = (this.data.currentSiteId && this.data.currentSiteId !== '__none__') ? this.data.currentSiteId : ((sites[0] || {}).id || '')
    const stores = this.storesOf(siteId)
    let storeId = (this.data.currentStoreId && this.data.currentStoreId !== '__none__') ? this.data.currentStoreId : ((stores[0] || {}).id || '')
    if (!stores.some(s => s.id === storeId)) storeId = (stores[0] || {}).id || ''
    this.setData({ showModal: true, name: '', qty: '', icon: '', type: 'in', showNewCategory: false, formSiteId: siteId, formStoreTabs: stores, formStoreId: storeId })
  },
  setFormSite(e) {
    const siteId = e.currentTarget.dataset.id
    const stores = this.storesOf(siteId)
    this.setData({ formSiteId: siteId, formStoreTabs: stores, formStoreId: (stores[0] || {}).id || '' })
  },
  setFormStore(e) { this.setData({ formStoreId: e.currentTarget.dataset.id }) },
  hideModal() { this.setData({ showModal: false }) },
  noop() {},
  setType(e) { this.setData({ type: e.currentTarget.dataset.val }) },
  setCategory(e) { this.setData({ category: e.currentTarget.dataset.val }) },
  setField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  toggleNewCategory() { this.setData({ showNewCategory: !this.data.showNewCategory }) },

  submitNewCategory() {
    const { newCategoryName, newCategoryIcon, categories } = this.data
    if (!newCategoryName) { wx.showToast({ title: '请填写分类名称', icon: 'none' }); return }
    if (categories.includes(newCategoryName)) { wx.showToast({ title: '分类已存在', icon: 'none' }); return }
    if (newCategoryIcon) CATEGORY_ICONS[newCategoryName] = newCategoryIcon
    this.setData({
      categories: categories.concat([newCategoryName]),
      category: newCategoryName,
      showNewCategory: false,
      newCategoryName: '',
      newCategoryIcon: ''
    })
  },

  async submitRecord() {
    const { name, qty, type, icon, category, myName, formSiteId, formStoreId } = this.data
    if (!name || !qty) { wx.showToast({ title: '请填写物品和数量', icon: 'none' }); return }
    if (!formStoreId) { wx.showToast({ title: '请选择存入哪个分库', icon: 'none' }); return }
    wx.showLoading({ title: '记录中...' })
    try {
      await wx.cloud.callFunction({
        name: 'warehouseManager',
        data: { action: 'addRecord', data: { name, qty: parseInt(qty), type, icon: icon || '📦', category, operatorName: myName, siteId: formSiteId, storeId: formStoreId } }
      })
      wx.showToast({ title: `${name} ${type === 'in' ? '+' : '-'}${qty} 记录成功`, icon: 'success' })
      this.setData({ showModal: false, name: '', qty: '', icon: '' })
      this.loadItems()
    } catch (e) {
      wx.showToast({ title: '记录失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ================= 采购 =================

  loadRoles() {
    wx.cloud.callFunction({ name: 'memberManager', data: { action: 'getRoles' } })
      .then(res => {
        const r = res.result || {}
        const me = r.me || {}
        this.setData({
          iAmSupervisor: !!me.isSupervisor,
          iAmKeeper: !!me.isKeeper,
          iAmTreasurer: !!me.isTreasurer,
          mySupSites: me.supervisorSiteIds || [],
          myKeepSites: me.keeperSiteIds || [],
          mySupGlobal: !!me.supervisorGlobal,
          myKeepGlobal: !!me.keeperGlobal,
          rolesSup: r.supervisors || [],
          rolesKeep: r.keepers || []
        }, () => {
          this.recomputeCanManage()
          // 角色到位后刷新采购列表的按钮（按地方）
          if (this.data.purchases && this.data.purchases.length) this.loadPurchases()
        })
      }).catch(() => {})
  },

  // 对某地方：我是不是主管 / 库管（含旧的全局条目兼容）
  iSupOf(siteId) { return this.data.mySupGlobal || (this.data.mySupSites || []).indexOf(siteId) >= 0 },
  iKeepOf(siteId) { return this.data.myKeepGlobal || (this.data.myKeepSites || []).indexOf(siteId) >= 0 },

  // 重算「当前浏览地方」能不能直接管库存：该地方库管，或该地方无库管时由该地方主管兜底
  recomputeCanManage() {
    const site = this.data.currentSiteId
    if (!site) { this.setData({ iCanManageStock: false }); return }
    if (site === '__none__') {
      // 未归类：任意库管/主管可处理（方便清理老物品）
      const any = this.data.myKeepGlobal || this.data.mySupGlobal ||
        (this.data.myKeepSites || []).length > 0 || (this.data.mySupSites || []).length > 0
      this.setData({ iCanManageStock: !!any }); return
    }
    const iKeepHere = this.iKeepOf(site)
    const iSupHere = this.iSupOf(site)
    const siteHasKeeper = (this.data.rolesKeep || []).some(k => !k.siteId || k.siteId === site)
    this.setData({ iCanManageStock: iKeepHere || (!siteHasKeeper && iSupHere) })
  },

  loadPurchases() {
    wx.cloud.callFunction({ name: 'purchaseManager', data: { action: 'getPurchases' } })
      .then(res => {
        const myName = this.data.myName
        const list = (res.result.list || []).map(p => {
          const items = p.items || []
          const itemSummary = items.map(it => `${it.name}×${it.qty || '?'}`).join('、')
          const mineInitiator = p.initiatorName === myName
          const mineBuyer = p.buyerName === myName
          const iSup = this.iSupOf(p.siteId)   // 我是不是这单地方的主管
          const iKeep = this.iKeepOf(p.siteId) // 我是不是这单地方的库管
          const iTrea = !!this.data.iAmTreasurer
          // 双签：该地方主管 + 账房先生 都签才放行
          const supSigned = !!p.supApproved
          const treaSigned = !!p.treaApproved
          const iCanSign = p.status === 'pending' && ((iSup && !supSigned) || (iTrea && !treaSigned))
          let signLabel = ''
          if (p.status === 'pending') {
            signLabel = `主管${supSigned ? '✓' : '…'} · 账房${treaSigned ? '✓' : '…'}`
          }
          return Object.assign({}, p, {
            itemSummary,
            siteName: this.siteNameOf(p.siteId),
            // 采购类型：老单无 purchaseKind 按物资兜底
            purchaseKind: p.purchaseKind === 'food' ? 'food' : 'general',
            isFood: p.purchaseKind === 'food',
            timeText: this.fmtTime(p.createdAt),
            createdTs: p.createdAt ? new Date(p.createdAt).getTime() : 0,
            statusLabel: PURCHASE_STATUS[p.status] || p.status,
            statusClass: 'st-' + p.status,
            canApprove: iCanSign,
            signLabel,
            canEdit: (mineInitiator || iSup) && ['pending', 'rejected', 'open', 'buying'].indexOf(p.status) >= 0,
            canDelete: (mineInitiator || iSup) && ['pending', 'rejected', 'open', 'buying'].indexOf(p.status) >= 0,
            canClaim: p.status === 'open',
            canReport: mineBuyer && p.status === 'buying',
            canVerify: iKeep && p.status === 'checking',
            canStockIn: iKeep && p.status === 'verified',
            ledgerLabel: p.status === 'done' ? (
              p.ledgerStatus === 'recorded' ? '已记账'
              : p.ledgerStatus === 'converted' ? '已转出资'
              : p.ledgerStatus === 'converting' ? '转出资审核中'
              : '待记账'
            ) : ''
          })
        })
        this.setData({ purchases: list }, () => this.applyPurchaseFilter())
        // 我垫付待还横幅：服务端按 openid 算好的（count/total/ids）
        const ma = res.result.myAwait || { count: 0, total: 0, ids: [] }
        const idSet = {}
        ;(ma.ids || []).forEach(id => { idSet[id] = true })
        const STAGE = { checking: '核验中', verified: '待入库', done: '待账房记账' }
        const myAwaitList = list.filter(p => idSet[p._id]).map(p => ({
          _id: p._id,
          title: p.title || p.itemSummary || '采购单',
          amountDisplay: (Number(p.actualAmount) || 0).toFixed(2),
          stageLabel: STAGE[p.status] || p.statusLabel,
          timeText: p.timeText
        }))
        this.setData({
          myAwaitCount: ma.count || 0,
          myAwaitTotal: (Number(ma.total) || 0).toFixed(2),
          myAwaitList
        })
      }).catch(() => {
        wx.showToast({ title: '采购加载失败', icon: 'none' })
      })
  },

  // 地方 id → 名字（采购列表展示用）
  siteNameOf(id) {
    const s = (this.data.tree.sites || []).find(x => x.id === id)
    return s ? s.name : (id ? '未指定' : '未指定')
  },

  setPurchaseFilter(e) {
    // 切大档时状态细筛重置（避免"进行中 × 已入库"这种空交集）
    this.setData({ purchaseFilter: e.currentTarget.dataset.val, pStatusFilter: 'all' }, () => this.applyPurchaseFilter())
  },
  setPKindFilter(e) {
    this.setData({ pKindFilter: e.currentTarget.dataset.val, pStatusFilter: 'all' }, () => this.applyPurchaseFilter())
  },
  setPStatusFilter(e) {
    this.setData({ pStatusFilter: e.currentTarget.dataset.val }, () => this.applyPurchaseFilter())
  },
  toggleMyAwait() { this.setData({ myAwaitOpen: !this.data.myAwaitOpen }) },

  // ===== 联系人（供应商通讯录）=====
  openContacts() {
    this.setData({ showContactModal: true, contactTagFilter: '', contactKw: '' })
    this.loadContacts()
  },
  hideContacts() { this.setData({ showContactModal: false }) },
  loadContacts() {
    wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getContacts' } })
      .then(res => {
        const list = res.result.list || []
        // 标签自动聚合成筛选 chips
        const tags = [...new Set(list.map(c => c.tag).filter(Boolean))]
        this.setData({ contacts: list, contactTags: tags }, () => this.applyContactFilter())
      })
      .catch(() => wx.showToast({ title: '加载失败', icon: 'none' }))
  },
  setContactTag(e) {
    const val = e.currentTarget.dataset.val
    // 再点一次同标签 = 取消筛选
    this.setData({ contactTagFilter: this.data.contactTagFilter === val ? '' : val }, () => this.applyContactFilter())
  },
  setContactKw(e) { this.setData({ contactKw: e.detail.value }, () => this.applyContactFilter()) },
  applyContactFilter() {
    const { contacts, contactTagFilter, contactKw } = this.data
    const kw = (contactKw || '').trim()
    const list = contacts.filter(c =>
      (!contactTagFilter || c.tag === contactTagFilter) &&
      (!kw || (c.name || '').indexOf(kw) >= 0 || (c.tag || '').indexOf(kw) >= 0 || (c.phone || '').indexOf(kw) >= 0)
    )
    this.setData({ contactsFiltered: list })
  },
  callContact(e) {
    const phone = e.currentTarget.dataset.phone
    if (phone) wx.makePhoneCall({ phoneNumber: phone, fail: () => {} })
  },
  copyContactWechat(e) {
    const wechat = e.currentTarget.dataset.wechat
    if (wechat) wx.setClipboardData({ data: wechat, success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }) })
  },
  // 新增/长按编辑
  showContactEditModal(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      const c = this.data.contacts.find(x => x._id === id) || {}
      this.setData({ showContactEdit: true, cEditId: id, cName: c.name || '', cTag: c.tag || '', cPhone: c.phone || '', cWechat: c.wechat || '', cNote: c.note || '' })
    } else {
      this.setData({ showContactEdit: true, cEditId: '', cName: '', cTag: '', cPhone: '', cWechat: '', cNote: '' })
    }
  },
  hideContactEdit() { this.setData({ showContactEdit: false }) },
  setCField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  submitContact() {
    const { cEditId, cName, cTag, cPhone, cWechat, cNote } = this.data
    if (!cName.trim()) { wx.showToast({ title: '姓名/称呼必填', icon: 'none' }); return }
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'warehouseManager',
      data: { action: 'saveContact', data: { id: cEditId || '', name: cName, tag: cTag, phone: cPhone, wechat: cWechat, note: cNote, operatorName: this.data.myName } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' }); return }
      this.setData({ showContactEdit: false })
      this.loadContacts()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '保存失败', icon: 'none' }) })
  },
  deleteContact() {
    const id = this.data.cEditId
    if (!id) return
    wx.showModal({
      title: '删除联系人', content: '确定删除这条联系方式？',
      success: (r) => {
        if (!r.confirm) return
        wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'deleteContact', data: { id } } })
          .then(res => {
            if (!res.result.success) { wx.showToast({ title: res.result.msg || '仅库管/主管可删除', icon: 'none' }); return }
            this.setData({ showContactEdit: false })
            this.loadContacts()
          })
      }
    })
  },
  // 物品实拍图预览（卡片图片位）
  previewItemPhoto(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.previewImage({ current: url, urls: [url] })
  },
  // 快捷传实拍图：点卡片图标占位区直接拍/选（有管理权才行；换图删图走长按→编辑）
  addPhotoFast(e) {
    if (!this.data.iCanManageStock) return
    const id = e.currentTarget.dataset.id
    wx.chooseMedia({
      count: 1, mediaTypes: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: async (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        if (!f) return
        wx.showLoading({ title: '上传中...', mask: true })
        try {
          const up = await wx.cloud.uploadFile({
            cloudPath: `item-photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`,
            filePath: f.tempFilePath
          })
          const r = await wx.cloud.callFunction({
            name: 'warehouseManager',
            data: { action: 'setItemPhoto', data: { id, photo: up.fileID, operatorName: this.data.myName } }
          })
          wx.hideLoading()
          if (!r.result.success) { wx.showToast({ title: r.result.msg || '保存失败', icon: 'none' }); return }
          wx.showToast({ title: '已添加实拍图', icon: 'success' })
          this.loadItems()
        } catch (err) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },
  setPRangeStart(e) {
    this.setData({ pRangeStart: e.detail.value }, () => this.applyPurchaseFilter())
  },
  setPRangeEnd(e) {
    this.setData({ pRangeEnd: e.detail.value }, () => this.applyPurchaseFilter())
  },
  clearPRange() {
    this.setData({ pRangeStart: '', pRangeEnd: '' }, () => this.applyPurchaseFilter())
  },

  // 时间筛选区间 [from, to)，毫秒时间戳；可只填一头；都空 = null 不限
  _pTimeRange() {
    const { pRangeStart, pRangeEnd } = this.data
    if (!pRangeStart && !pRangeEnd) return null
    const from = pRangeStart ? new Date(pRangeStart + 'T00:00:00').getTime() : -Infinity
    const to = pRangeEnd ? new Date(pRangeEnd + 'T00:00:00').getTime() + 86400000 : Infinity
    return from <= to ? { from, to } : { from: to - 86400000, to: from + 86400000 }
  },

  applyPurchaseFilter() {
    const { purchaseFilter, pKindFilter } = this.data
    // 第一级：采购类型（全部/物资/食材）
    let list = this.data.purchases.filter(p => pKindFilter === 'all' || p.purchaseKind === pKindFilter)
    // 第二级：时间（按发起时间）
    const range = this._pTimeRange()
    if (range) list = list.filter(p => p.createdTs >= range.from && p.createdTs < range.to)
    // 第三级：进行中/已完成/全部
    list = list.filter(p => {
      if (purchaseFilter === 'all') return true
      if (purchaseFilter === 'done') return p.status === 'done'
      return p.status !== 'done' // todo
    })
    // 第四级：状态 chips（按状态机顺序，只列当前集合里有单的状态，带数量）
    const ORDER = ['pending', 'open', 'buying', 'checking', 'verified', 'done', 'rejected']
    const counts = {}
    list.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1 })
    const pStatusChips = [{ val: 'all', label: '全部', count: list.length }]
    ORDER.forEach(s => {
      if (counts[s]) pStatusChips.push({ val: s, label: PURCHASE_STATUS[s] || s, count: counts[s] })
    })
    // 当前选中的状态在新集合里没了（切档/刷新后），退回全部
    let pStatusFilter = this.data.pStatusFilter
    if (!pStatusChips.some(c => c.val === pStatusFilter)) pStatusFilter = 'all'
    if (pStatusFilter !== 'all') list = list.filter(p => p.status === pStatusFilter)
    this.setData({ purchasesFiltered: list, pStatusChips, pStatusFilter })
  },

  // ---- 发起 / 重提 ----
  showPurchaseModal() {
    const sites = (this.data.tree.sites || []).map(s => ({ id: s.id, name: s.name }))
    if (sites.length === 0) { wx.showToast({ title: '还没有地方，请先到库存页建地方', icon: 'none' }); return }
    const open = (siteId, siteName) => {
      this.setData({
        showPurchaseModal: true,
        pEditId: '', pKind: 'general', pTitle: '', pReason: '', pBudget: '',
        pSiteId: siteId, pSiteName: siteName,
        pItems: [{ name: '', spec: '', qty: '' }]
      })
    }
    // 默认用当前浏览的地方；多地方时让用户先选这单给谁买
    const cur = (this.data.currentSiteId && this.data.currentSiteId !== '__none__')
      ? sites.find(s => s.id === this.data.currentSiteId) : null
    if (sites.length === 1) { open(sites[0].id, sites[0].name); return }
    wx.showActionSheet({
      itemList: sites.map(s => `给「${s.name}」采购`),
      success: (res) => { const s = sites[res.tapIndex]; open(s.id, s.name) },
      fail: () => { if (cur) open(cur.id, cur.name) }
    })
  },
  hidePurchaseModal() { this.setData({ showPurchaseModal: false }) },
  setPField(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }) },
  setPKind(e) { this.setData({ pKind: e.currentTarget.dataset.val }) },
  // 按「物品名 + 当前采购所选地方」在库存里匹配，返回展示用的库存信息
  _stockOf(name) {
    const n = (name || '').trim()
    if (!n) return { stockChecked: false, stockHas: false, stockQty: 0, stockLow: false }
    const site = this.data.pSiteId || ''
    const it = (this.data.allStockItems || []).find(x => x.name === n && (x.siteId || '') === site)
    if (!it) return { stockChecked: true, stockHas: false, stockQty: 0, stockLow: false }
    const low = (it.qty || 0) <= (it.lowThreshold || 3)
    return { stockChecked: true, stockHas: true, stockQty: it.qty || 0, stockLow: low }
  },
  setPItemField(e) {
    const { index, field } = e.currentTarget.dataset
    const pItems = this.data.pItems.slice()
    const patch = { [field]: e.detail.value }
    if (field === 'name') Object.assign(patch, this._stockOf(e.detail.value))
    pItems[index] = Object.assign({}, pItems[index], patch)
    this.setData({ pItems })
  },
  addPItemRow() {
    this.setData({ pItems: this.data.pItems.concat([{ name: '', spec: '', qty: '' }]) })
  },
  removePItemRow(e) {
    const index = e.currentTarget.dataset.index
    const pItems = this.data.pItems.slice()
    if (pItems.length <= 1) { wx.showToast({ title: '至少保留一项', icon: 'none' }); return }
    pItems.splice(index, 1)
    this.setData({ pItems })
  },
  submitPurchase() {
    const { pEditId, pKind, pTitle, pReason, pBudget, pItems, pSiteId, myName } = this.data
    if (!myName) { wx.showToast({ title: '请先到营员页加入村落', icon: 'none' }); return }
    if (!pSiteId) { wx.showToast({ title: '请选择这单给哪个地方', icon: 'none' }); return }
    const items = pItems
      .filter(it => it.name && String(it.name).trim())
      .map(it => ({ name: String(it.name).trim(), spec: it.spec || '', qty: parseInt(it.qty) || 0 }))
    if (items.length === 0) { wx.showToast({ title: '至少填一项物品', icon: 'none' }); return }
    wx.showLoading({ title: '提交中...' })
    const isEdit = !!pEditId
    const payload = isEdit
      ? { action: 'editPurchase', data: { id: pEditId, items, title: pTitle, reason: pReason, budget: parseFloat(pBudget) || 0, siteId: pSiteId, purchaseKind: pKind, operatorName: myName } }
      : { action: 'addPurchase', data: { items, title: pTitle, reason: pReason, budget: parseFloat(pBudget) || 0, siteId: pSiteId, purchaseKind: pKind, initiatorName: myName } }
    wx.cloud.callFunction({ name: 'purchaseManager', data: payload })
      .then(res => {
        wx.hideLoading()
        if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
        wx.showToast({ title: isEdit ? (res.result.bounced ? '已修改·打回重审' : '已修改') : '已提交待审批', icon: 'success' })
        this.setData({ showPurchaseModal: false })
        this.loadPurchases()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
  },

  // ---- 详情 ----
  // cloud:// 批量换 https（走 campManager 的 getFileUrls，最稳）
  async _toTempUrls(fileIDs) {
    const ids = [...new Set((fileIDs || []).filter(x => typeof x === 'string' && x.indexOf('cloud://') === 0))]
    if (ids.length === 0) return {}
    try {
      const res = await wx.cloud.callFunction({ name: 'campManager', data: { action: 'getFileUrls', data: { fileList: ids } } })
      return (res.result && res.result.urls) || {}
    } catch (e) { return {} }
  },
  async tapPurchase(e) {
    const p = e.currentTarget.dataset.item
    const map = await this._toTempUrls(p.receipts || [])
    const pDetailReceiptUrls = (p.receipts || []).map(s => map[s] || s)
    this.setData({ showPDetailModal: true, pDetail: p, pDetailReceiptUrls })
  },
  hidePDetail() { this.setData({ showPDetailModal: false }) },

  // ---- 审批：账房+主管双签 ----
  approvePurchase(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '签字通过', content: '本单需「该地方主管 + 账房先生」双签。两人都签字后才进入待领取。',
      confirmText: '签字', success: (r) => {
        if (!r.confirm) return
        this._callPurchase({ action: 'approvePurchase', data: { id, operatorName: this.data.myName } }, '已签字')
      }
    })
  },
  rejectPurchase(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '驳回采购', editable: true, placeholderText: '填写驳回原因（营员可改单重提）',
      confirmText: '驳回', confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return
        this._callPurchase({ action: 'rejectPurchase', data: { id, reason: r.content || '', operatorName: this.data.myName } }, '已驳回')
      }
    })
  },

  // ---- 发起人：重提 / 删除 ----
  resubmitPurchase(e) {
    const p = e.currentTarget.dataset.item
    this.setData({
      showPurchaseModal: true,
      pEditId: p._id,
      pKind: p.purchaseKind === 'food' ? 'food' : 'general',
      pTitle: p.title || '',
      pReason: p.reason || '',
      pBudget: p.budget ? String(p.budget) : '',
      pSiteId: p.siteId || '',
      pSiteName: this.siteNameOf(p.siteId),
      pItems: (p.items || []).map(it => Object.assign({ name: it.name, spec: it.spec || '', qty: it.qty ? String(it.qty) : '' }, this._stockOf(it.name)))
    })
  },
  deletePurchase(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除采购单', content: '报账前可删（已报账的删不了），确认删除？',
      confirmText: '删除', confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return
        this._callPurchase({ action: 'deletePurchase', data: { id } }, '已删除')
      }
    })
  },

  // ---- 营员：认领 ----
  claimPurchase(e) {
    const id = e.currentTarget.dataset.id
    if (!this.data.myName) { wx.showToast({ title: '请先加入村落', icon: 'none' }); return }
    wx.showModal({
      title: '认领采购', content: '认领后由你去采购、垫付并回传凭证报账。',
      confirmText: '认领', success: (r) => {
        if (!r.confirm) return
        this._callPurchase({ action: 'claimPurchase', data: { id, operatorName: this.data.myName } }, '已认领')
      }
    })
  },

  // ---- 采购人：报账 ----
  openReport(e) {
    const p = e.currentTarget.dataset.item
    this.setData({
      showReportModal: true,
      reportId: p._id,
      reportItemsText: p.itemSummary,
      reportAmount: '',
      reportReceipts: [],
      reportReceiptUrls: []
    })
  },
  hideReport() { this.setData({ showReportModal: false }) },
  setReportAmount(e) { this.setData({ reportAmount: e.detail.value }) },
  chooseReportReceipts() {
    const left = 9 - this.data.reportReceipts.length
    if (left <= 0) { wx.showToast({ title: '最多9张', icon: 'none' }); return }
    wx.chooseMedia({
      count: left, mediaType: ['image'], sourceType: ['album', 'camera'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' })
        try {
          const uploaded = []
          for (const f of res.tempFiles) {
            const ext = (f.tempFilePath.split('.').pop() || 'jpg')
            const up = await wx.cloud.uploadFile({
              cloudPath: `receipts/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`,
              filePath: f.tempFilePath
            })
            uploaded.push(up.fileID)
          }
          const urlMap = await this._toTempUrls(uploaded)
          this.setData({
            reportReceipts: this.data.reportReceipts.concat(uploaded),
            reportReceiptUrls: this.data.reportReceiptUrls.concat(uploaded.map(id => urlMap[id] || id))
          })
        } catch (err) {
          wx.showToast({ title: '上传失败', icon: 'none' })
        } finally { wx.hideLoading() }
      }
    })
  },
  previewReportReceipt(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.reportReceiptUrls
    wx.previewImage({ current: urls[index], urls })
  },
  removeReportReceipt(e) {
    const index = e.currentTarget.dataset.index
    const arr = this.data.reportReceipts.slice(); arr.splice(index, 1)
    const urls = this.data.reportReceiptUrls.slice(); urls.splice(index, 1)
    this.setData({ reportReceipts: arr, reportReceiptUrls: urls })
  },
  submitReport() {
    const { reportId, reportAmount, reportReceipts } = this.data
    if (reportReceipts.length === 0) { wx.showToast({ title: '请上传付款凭证', icon: 'none' }); return }
    if (!reportAmount) { wx.showToast({ title: '请填实付金额', icon: 'none' }); return }
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'purchaseManager',
      data: { action: 'submitReceipts', data: { id: reportId, receipts: reportReceipts, actualAmount: parseFloat(reportAmount) || 0 } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
      wx.showToast({ title: '已报账待核验', icon: 'success' })
      this.setData({ showReportModal: false })
      this.loadPurchases()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
  },

  // ---- 库管：核验 ----
  async openVerify(e) {
    const p = e.currentTarget.dataset.item
    const map = await this._toTempUrls(p.receipts || [])
    this.setData({
      showVerifyModal: true,
      verifyId: p._id,
      verifyItemsText: p.itemSummary,
      verifyReceipts: p.receipts || [],
      verifyReceiptUrls: (p.receipts || []).map(s => map[s] || s)
    })
  },
  hideVerify() { this.setData({ showVerifyModal: false }) },
  previewVerifyReceipt(e) {
    const index = e.currentTarget.dataset.index
    const urls = this.data.verifyReceiptUrls
    wx.previewImage({ current: urls[index], urls })
  },
  verifyPass() {
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'purchaseManager',
      data: { action: 'verifyPurchase', data: { id: this.data.verifyId, pass: true, operatorName: this.data.myName } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '失败', icon: 'none' }); return }
      wx.showToast({ title: '核验通过，待入库', icon: 'success' })
      this.setData({ showVerifyModal: false })
      this.loadPurchases()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '失败', icon: 'none' }) })
  },
  verifyReject() {
    const id = this.data.verifyId
    wx.showModal({
      title: '退回采购', editable: true, placeholderText: '填写退回原因（票据/物品有问题）',
      confirmText: '退回', confirmColor: '#e74c3c',
      success: (r) => {
        if (!r.confirm) return
        wx.cloud.callFunction({
          name: 'purchaseManager',
          data: { action: 'verifyPurchase', data: { id, pass: false, reason: r.content || '', operatorName: this.data.myName } }
        }).then(res => {
          if (!res.result.success) { wx.showToast({ title: res.result.msg || '失败', icon: 'none' }); return }
          wx.showToast({ title: '已退回采购人', icon: 'success' })
          this.setData({ showVerifyModal: false })
          this.loadPurchases()
        }).catch(() => { wx.showToast({ title: '失败', icon: 'none' }) })
      }
    })
  },

  // ---- 库管：入库确认 ----
  openStockIn(e) {
    const p = e.currentTarget.dataset.item
    const existNames = new Set(this.data.allStockItems.map(i => i.name))
    const stockInItems = (p.items || []).map(it => {
      const isNew = !existNames.has(it.name)
      return {
        name: it.name,
        spec: it.spec || '',
        qty: it.qty || 0,
        receivedQty: String(it.qty || 0),
        isNew,
        category: isNew ? '其他' : '',
        icon: isNew ? '📦' : ''
      }
    })
    // 入库地方锁定为采购单发起时声明的地方（B方案），只能选该地方下的分库
    const sites = this.data.tree.sites || []
    let siSiteId = p.siteId || ((sites[0] || {}).id || '')
    const stores = this.storesOf(siSiteId)
    let siStoreId = (this.data.currentStoreId && stores.some(s => s.id === this.data.currentStoreId))
      ? this.data.currentStoreId : ((stores[0] || {}).id || '')
    const siSiteName = this.siteNameOf(siSiteId)
    this.setData({ showStockInModal: true, stockInId: p._id, stockInItems, siSiteId, siSiteName, siStoreTabs: stores, siStoreId })
  },
  setSiSite(e) {
    // 地方已锁定（采购单指定），不允许改；仅提示
    wx.showToast({ title: `本单只能入到「${this.data.siSiteName || '指定地方'}」`, icon: 'none' })
  },
  setSiStore(e) { this.setData({ siStoreId: e.currentTarget.dataset.id }) },
  hideStockIn() { this.setData({ showStockInModal: false }) },
  setStockInQty(e) {
    const index = e.currentTarget.dataset.index
    const arr = this.data.stockInItems.slice()
    arr[index] = Object.assign({}, arr[index], { receivedQty: e.detail.value })
    this.setData({ stockInItems: arr })
  },
  setStockInCategory(e) {
    const { index, val } = e.currentTarget.dataset
    const arr = this.data.stockInItems.slice()
    arr[index] = Object.assign({}, arr[index], { category: val })
    this.setData({ stockInItems: arr })
  },
  setStockInIcon(e) {
    const index = e.currentTarget.dataset.index
    const arr = this.data.stockInItems.slice()
    arr[index] = Object.assign({}, arr[index], { icon: e.detail.value })
    this.setData({ stockInItems: arr })
  },
  submitStockIn() {
    if (!this.data.siStoreId) { wx.showToast({ title: '请选择入到哪个分库', icon: 'none' }); return }
    const items = this.data.stockInItems.map(it => ({
      name: it.name,
      spec: it.spec,
      qty: it.qty,
      receivedQty: parseInt(it.receivedQty) || 0,
      category: it.category || '其他',
      icon: it.icon || '📦'
    }))
    if (items.some(it => it.receivedQty <= 0)) {
      wx.showModal({
        title: '确认入库', content: '有物品实收数量为 0，确定继续？这些项不会加库存。',
        success: (r) => { if (r.confirm) this._doStockIn(items) }
      })
      return
    }
    this._doStockIn(items)
  },
  _doStockIn(items) {
    wx.showLoading({ title: '入库中...' })
    wx.cloud.callFunction({
      name: 'purchaseManager',
      data: { action: 'confirmStockIn', data: { id: this.data.stockInId, items, operatorName: this.data.myName, siteId: this.data.siSiteId, storeId: this.data.siStoreId } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '失败', icon: 'none' }); return }
      wx.showToast({ title: '已入库，待记账', icon: 'success' })
      this.setData({ showStockInModal: false })
      this.loadPurchases()
      this.loadItems()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '失败', icon: 'none' }) })
  },

  // 公共：调用 + 统一反馈 + 刷新
  _callPurchase(payload, okMsg) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({ name: 'purchaseManager', data: payload })
      .then(res => {
        wx.hideLoading()
        if (!res.result || !res.result.success) {
          const msg = (res.result && res.result.msg) || '操作失败'
          if (msg === 'unknown action') {
            wx.showModal({ title: '云函数需更新', content: `云端的 purchaseManager 还没有「${payload.action}」这个功能，请在开发者工具里把 purchaseManager「上传并部署」后再试。`, showCancel: false })
          } else {
            wx.showToast({ title: msg, icon: 'none' })
          }
          return
        }
        wx.showToast({ title: okMsg || '已处理', icon: 'success' })
        this.loadPurchases()
      }).catch((err) => {
        wx.hideLoading()
        wx.showModal({ title: '调用出错', content: `操作「${payload.action}」失败：${(err && (err.errMsg || err.message)) || '未知错误'}（多半是 purchaseManager 云函数没部署最新版，请上传并部署后再试）`, showCancel: false })
      })
  },

  // ================= 领料 =================

  loadRequisitions() {
    wx.cloud.callFunction({ name: 'requisitionManager', data: { action: 'getRequisitions' } })
      .then(res => {
        const myName = this.data.myName
        const STATUS = { pending: '待审批', approved: '待发货', rejected: '已驳回', done: '已出库' }
        const list = (res.result.list || []).map(r => {
          const items = r.items || []
          const itemSummary = items.map(it => `${it.name}×${it.qty}`).join('、')
          const mineApplicant = r.applicantName === myName
          const siteId = (items.find(i => i && i.siteId) || {}).siteId || ''
          return Object.assign({}, r, {
            itemSummary,
            statusLabel: STATUS[r.status] || r.status,
            statusClass: 'st-' + r.status,
            canApprove: this.iSupOf(siteId) && r.status === 'pending',
            canDeliver: this.iKeepOf(siteId) && r.status === 'approved',
            canDelete: mineApplicant && (r.status === 'pending' || r.status === 'rejected')
          })
        })
        this.setData({ requisitions: list }, () => this.applyReqFilter())
      }).catch(() => { wx.showToast({ title: '领料加载失败', icon: 'none' }) })
  },

  setReqFilter(e) { this.setData({ reqFilter: e.currentTarget.dataset.val }, () => this.applyReqFilter()) },
  applyReqFilter() {
    const f = this.data.reqFilter
    const list = this.data.requisitions.filter(r => {
      if (f === 'all') return true
      if (f === 'done') return r.status === 'done'
      return r.status !== 'done'
    })
    this.setData({ requisitionsFiltered: list })
  },

  // 发起领料：列出某分库的「非即时消耗」物品，逐项填要领的数量
  buildReqPickItems(storeId) {
    return this.data.allStockItems
      .filter(i => i.storeId === storeId && (i.consumeMode === 'requisition' || i.consumeMode === 'approval'))
      .map(i => ({ name: i.name, spec: i.spec || '', avail: i.qty, consumeMode: i.consumeMode, storeId: i.storeId, siteId: i.siteId, input: '' }))
  },
  openReqModal() {
    const sites = this.data.tree.sites || []
    let siteId = (this.data.currentSiteId && this.data.currentSiteId !== '__none__') ? this.data.currentSiteId : ((sites[0] || {}).id || '')
    const stores = this.storesOf(siteId)
    let storeId = (this.data.currentStoreId && this.data.currentStoreId !== '__none__') ? this.data.currentStoreId : ((stores[0] || {}).id || '')
    if (!stores.some(s => s.id === storeId)) storeId = (stores[0] || {}).id || ''
    this.setData({
      showReqModal: true, reqReason: '',
      reqSiteId: siteId, reqStoreTabs: stores, reqStoreId: storeId,
      reqPickItems: this.buildReqPickItems(storeId)
    })
  },
  hideReqModal() { this.setData({ showReqModal: false }) },
  setReqSite(e) {
    const siteId = e.currentTarget.dataset.id
    const stores = this.storesOf(siteId)
    const storeId = (stores[0] || {}).id || ''
    this.setData({ reqSiteId: siteId, reqStoreTabs: stores, reqStoreId: storeId, reqPickItems: this.buildReqPickItems(storeId) })
  },
  setReqStore(e) {
    const storeId = e.currentTarget.dataset.id
    this.setData({ reqStoreId: storeId, reqPickItems: this.buildReqPickItems(storeId) })
  },
  setReqItemQty(e) {
    const index = e.currentTarget.dataset.index
    const arr = this.data.reqPickItems.slice()
    arr[index] = Object.assign({}, arr[index], { input: e.detail.value })
    this.setData({ reqPickItems: arr })
  },
  setReqReason(e) { this.setData({ reqReason: e.detail.value }) },
  submitRequisition() {
    if (!this.data.myName) { wx.showToast({ title: '请先加入村落', icon: 'none' }); return }
    const items = this.data.reqPickItems
      .filter(it => (parseInt(it.input) || 0) > 0)
      .map(it => ({
        name: it.name, spec: it.spec, qty: parseInt(it.input) || 0,
        storeId: it.storeId, siteId: it.siteId,
        needApproval: it.consumeMode === 'approval'
      }))
    if (items.length === 0) { wx.showToast({ title: '请给要领的物品填数量', icon: 'none' }); return }
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'requisitionManager',
      data: { action: 'addRequisition', data: { items, reason: this.data.reqReason, applicantName: this.data.myName } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
      wx.showToast({ title: res.result.immediate ? '已出库' : '已提交待审批', icon: 'success' })
      this.setData({ showReqModal: false })
      this.loadRequisitions()
      this.loadItems()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
  },

  // 领料单操作
  approveReq(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '审批通过', content: '通过后由库管发货扣库存。', confirmText: '通过', success: (r) => {
      if (r.confirm) this._callReq({ action: 'approveRequisition', data: { id, operatorName: this.data.myName } }, '已通过')
    }})
  },
  rejectReq(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '驳回领料', editable: true, placeholderText: '填写驳回原因', confirmText: '驳回', confirmColor: '#e74c3c', success: (r) => {
      if (r.confirm) this._callReq({ action: 'rejectRequisition', data: { id, reason: r.content || '', operatorName: this.data.myName } }, '已驳回')
    }})
  },
  deliverReq(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '确认发货', content: '发货后将扣减库存，确认？', confirmText: '发货', success: (r) => {
      if (r.confirm) this._callReq({ action: 'deliverRequisition', data: { id, operatorName: this.data.myName } }, '已发货')
    }})
  },
  deleteReq(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '删除领料单', content: '确认删除？', confirmText: '删除', confirmColor: '#e74c3c', success: (r) => {
      if (r.confirm) this._callReq({ action: 'deleteRequisition', data: { id } }, '已删除')
    }})
  },
  _callReq(payload, okMsg) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({ name: 'requisitionManager', data: payload })
      .then(res => {
        wx.hideLoading()
        if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
        wx.showToast({ title: okMsg || '已处理', icon: 'success' })
        this.loadRequisitions()
        this.loadItems()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) })
  },

  // ================= 报废报损 =================

  switchReqSubTab(e) {
    const t = e.currentTarget.dataset.tab
    this.setData({ reqSubTab: t })
    if (t === 'scrap') this.loadScraps()
    else this.loadRequisitions()
  },

  loadScraps() {
    wx.cloud.callFunction({ name: 'scrapManager', data: { action: 'getScraps' } })
      .then(res => {
        const myName = this.data.myName
        const STATUS = { pending: '待审批', rejected: '已驳回', done: '已核销' }
        const list = (res.result.list || []).map(r => Object.assign({}, r, {
          statusLabel: STATUS[r.status] || r.status,
          statusClass: 'st-' + r.status,
          recyclableLabel: r.recyclable ? '可回收' : '不可回收',
          canApprove: this.iSupOf(r.siteId) && r.status === 'pending',
          canDelete: r.applicantName === myName && (r.status === 'pending' || r.status === 'rejected')
        }))
        this.setData({ scraps: list, scrapsFiltered: list })
      }).catch(() => { wx.showToast({ title: '报废加载失败', icon: 'none' }) })
  },

  // 从库存物品长按发起报废
  openScrap(id) {
    const item = this.data.allStockItems.find(i => i._id === id)
    if (!item) { wx.showToast({ title: '物品不存在', icon: 'none' }); return }
    this.setData({
      showScrapModal: true,
      scrapItem: { name: item.name, spec: item.spec || '', storeId: item.storeId || '', siteId: item.siteId || '', avail: item.qty },
      scrapQty: '', scrapReason: '损坏', scrapReasonNote: '', scrapRecyclable: false
    })
  },
  hideScrapModal() { this.setData({ showScrapModal: false }) },
  setScrapQty(e) { this.setData({ scrapQty: e.detail.value }) },
  setScrapReason(e) { this.setData({ scrapReason: e.currentTarget.dataset.val }) },
  setScrapReasonNote(e) { this.setData({ scrapReasonNote: e.detail.value }) },
  toggleScrapRecyclable() { this.setData({ scrapRecyclable: !this.data.scrapRecyclable }) },
  submitScrap() {
    if (!this.data.myName) { wx.showToast({ title: '请先加入村落', icon: 'none' }); return }
    const it = this.data.scrapItem || {}
    const qty = parseInt(this.data.scrapQty) || 0
    if (qty <= 0) { wx.showToast({ title: '请填报废数量', icon: 'none' }); return }
    if (qty > it.avail) { wx.showToast({ title: `最多报废 ${it.avail}`, icon: 'none' }); return }
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'scrapManager',
      data: { action: 'addScrap', data: {
        name: it.name, spec: it.spec, qty, storeId: it.storeId, siteId: it.siteId,
        reason: this.data.scrapReason, reasonNote: this.data.scrapReasonNote,
        recyclable: this.data.scrapRecyclable, applicantName: this.data.myName
      } }
    }).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
      wx.showToast({ title: '已提交待审批', icon: 'success' })
      this.setData({ showScrapModal: false, reqSubTab: 'scrap' })
      this.loadScraps()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
  },

  approveScrap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '批准报废', content: '批准后将核销扣减库存，确认？', confirmText: '批准', success: (r) => {
      if (r.confirm) this._callScrap({ action: 'approveScrap', data: { id, operatorName: this.data.myName } }, '已核销')
    }})
  },
  rejectScrap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '驳回报废', editable: true, placeholderText: '填写驳回原因', confirmText: '驳回', confirmColor: '#e74c3c', success: (r) => {
      if (r.confirm) this._callScrap({ action: 'rejectScrap', data: { id, reason: r.content || '', operatorName: this.data.myName } }, '已驳回')
    }})
  },
  deleteScrap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '删除报废单', content: '确认删除？', confirmText: '删除', confirmColor: '#e74c3c', success: (r) => {
      if (r.confirm) this._callScrap({ action: 'deleteScrap', data: { id } }, '已删除')
    }})
  },
  _callScrap(payload, okMsg) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({ name: 'scrapManager', data: payload })
      .then(res => {
        wx.hideLoading()
        if (!res.result.success) { wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' }); return }
        wx.showToast({ title: okMsg || '已处理', icon: 'success' })
        this.loadScraps()
        this.loadItems()
      }).catch(() => { wx.hideLoading(); wx.showToast({ title: '操作失败', icon: 'none' }) })
  },

  // ================= 盘点 + 操作记录 =================

  switchStkSubTab(e) {
    const t = e.currentTarget.dataset.tab
    this.setData({ stkSubTab: t })
    if (t === 'logs') this.loadWhLogs()
    else this.loadStocktakes()
  },

  loadStocktakes() {
    wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getStocktakes' } })
      .then(res => {
        const storeName = (id) => {
          for (const s of (this.data.tree.sites || [])) {
            const st = (s.stores || []).find(x => x.id === id)
            if (st) return s.name + ' · ' + st.name
          }
          return '—'
        }
        const list = (res.result.list || []).map(r => Object.assign({}, r, {
          storeName: storeName(r.storeId),
          timeText: this.fmtTime(r.createdAt)
        }))
        this.setData({ stocktakes: list })
        // 现场照片 cloud:// → 临时链接
        const ids = [...new Set(list.reduce((a, r) => a.concat(r.photos || []), []).filter(p => typeof p === 'string' && p.indexOf('cloud://') === 0))]
        if (ids.length > 0) {
          wx.cloud.callFunction({ name: 'campManager', data: { action: 'getFileUrls', data: { fileList: ids } } }).then(ur => {
            const urls = (ur.result && ur.result.urls) || {}
            this.setData({ stocktakes: list.map(r => ({ ...r, photoUrls: (r.photos || []).map(p => urls[p]).filter(Boolean) })) })
          }).catch(() => {})
        }
      }).catch(() => { wx.showToast({ title: '盘点历史加载失败', icon: 'none' }) })
  },

  previewStkPhoto(e) {
    const { urls, index } = e.currentTarget.dataset
    if (urls && urls.length) wx.previewImage({ current: urls[index], urls })
  },

  loadWhLogs() {
    wx.cloud.callFunction({ name: 'warehouseManager', data: { action: 'getWarehouseLogs' } })
      .then(res => {
        const LABEL = {
          in: '入库', out: '出库', scrap: '报废',
          item_edit: '编辑物品', item_delete: '删除物品', stocktake: '盘点'
        }
        const list = (res.result.list || []).map(g => {
          let text = ''
          if (g.type === 'in') text = `入库 ${g.itemName} +${g.qty}`
          else if (g.type === 'out') text = `出库 ${g.itemName} -${g.qty}`
          else if (g.type === 'scrap') text = `报废 ${g.itemName} -${g.qty}（${g.reason || ''}）`
          else if (g.type === 'item_edit') text = `编辑 ${g.itemName}：${g.changes || ''}`
          else if (g.type === 'item_delete') text = `删除物品 ${g.itemName}`
          else if (g.type === 'stocktake') text = `盘点 ${g.itemName}：${g.systemQty}→${g.actualQty}（${g.diff > 0 ? '+' : ''}${g.diff}）`
          else text = g.itemName || ''
          return {
            _id: g._id, type: g.type, label: LABEL[g.type] || g.type, text,
            who: g.operatorName || '', timeText: this.fmtTime(g.createdAt)
          }
        })
        this.setData({ whLogs: list })
      }).catch(() => { wx.showToast({ title: '操作记录加载失败', icon: 'none' }) })
  },

  fmtTime(d) {
    if (!d) return ''
    const t = new Date(d)
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
  },

  // 发起盘点
  openStkModal() {
    const sites = this.data.tree.sites || []
    let siteId = (this.data.currentSiteId && this.data.currentSiteId !== '__none__') ? this.data.currentSiteId : ((sites[0] || {}).id || '')
    const stores = this.storesOf(siteId)
    let storeId = (stores[0] || {}).id || ''
    this.setData({ showStkModal: true, stkSiteId: siteId, stkStoreTabs: stores, stkStoreId: storeId, stkItems: this.buildStkItems(storeId), stkPhotos: [] })
  },
  hideStkModal() { this.setData({ showStkModal: false }) },
  // 盘点现场照片（最多6张，本地暂存，提交时统一上传）
  chooseStkPhoto() {
    const left = 6 - (this.data.stkPhotos || []).length
    if (left <= 0) { wx.showToast({ title: '最多6张', icon: 'none' }); return }
    wx.chooseMedia({
      count: left, mediaTypes: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map(f => f.tempFilePath)
        this.setData({ stkPhotos: (this.data.stkPhotos || []).concat(paths) })
      }
    })
  },
  removeStkPhoto(e) {
    const idx = e.currentTarget.dataset.index
    const arr = (this.data.stkPhotos || []).slice()
    arr.splice(idx, 1)
    this.setData({ stkPhotos: arr })
  },
  previewStkLocal(e) {
    const idx = e.currentTarget.dataset.index
    const urls = this.data.stkPhotos || []
    wx.previewImage({ current: urls[idx], urls })
  },
  buildStkItems(storeId) {
    return this.data.allStockItems
      .filter(i => i.storeId === storeId)
      .map(i => ({ id: i._id, name: i.name, systemQty: i.qty, actual: String(i.qty) }))
  },
  setStkSite(e) {
    const siteId = e.currentTarget.dataset.id
    const stores = this.storesOf(siteId)
    const storeId = (stores[0] || {}).id || ''
    this.setData({ stkSiteId: siteId, stkStoreTabs: stores, stkStoreId: storeId, stkItems: this.buildStkItems(storeId) })
  },
  setStkStore(e) {
    const storeId = e.currentTarget.dataset.id
    this.setData({ stkStoreId: storeId, stkItems: this.buildStkItems(storeId) })
  },
  setStkActual(e) {
    const index = e.currentTarget.dataset.index
    const arr = this.data.stkItems.slice()
    arr[index] = Object.assign({}, arr[index], { actual: e.detail.value })
    this.setData({ stkItems: arr })
  },
  submitStocktake() {
    const counts = this.data.stkItems
      .filter(it => it.actual !== '' && !isNaN(Number(it.actual)))
      .map(it => ({ id: it.id, actualQty: Number(it.actual) }))
    if (counts.length === 0) { wx.showToast({ title: '没有可盘点的物品', icon: 'none' }); return }
    wx.showLoading({ title: '提交中...', mask: true })
    // 现场照片先上传拿 fileID
    const localPhotos = this.data.stkPhotos || []
    Promise.all(localPhotos.map((p, i) =>
      wx.cloud.uploadFile({ cloudPath: `stocktake/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.jpg`, filePath: p }).then(u => u.fileID)
    )).then(photos => wx.cloud.callFunction({
      name: 'warehouseManager',
      data: { action: 'submitStocktake', data: { siteId: this.data.stkSiteId, storeId: this.data.stkStoreId, counts, photos, operatorName: this.data.myName } }
    })).then(res => {
      wx.hideLoading()
      if (!res.result.success) { wx.showToast({ title: res.result.msg || '提交失败', icon: 'none' }); return }
      wx.showModal({ title: '盘点完成', content: `共盘 ${res.result.total} 项，${res.result.diffCount} 项有差异并已修正账面。`, showCancel: false })
      this.setData({ showStkModal: false })
      this.loadStocktakes()
      this.loadItems()
    }).catch(() => { wx.hideLoading(); wx.showToast({ title: '提交失败', icon: 'none' }) })
  }
})