const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ===== 库房树（地方 site > 分库 store）存 config 集合 key='warehouseTree' =====
// value = { sites: [ { id, name, stores: [ { id, name } ] } ] }
function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}
function defaultTree() {
  return {
    sites: [
      {
        id: genId('s_'), name: '金山书院', stores: [
          { id: genId('st_'), name: '食材库' },
          { id: genId('st_'), name: '耗材库' },
          { id: genId('st_'), name: '材料物品库' }
        ]
      },
      { id: genId('s_'), name: '观天瀑', stores: [] }
    ]
  }
}
async function getTreeDoc() {
  try { await db.createCollection('config') } catch (e) {}
  const res = await db.collection('config').where({ key: 'warehouseTree' }).limit(1).get()
  return res.data.length ? res.data[0] : null
}
// 取树（不存在则播种默认）
async function ensureTree() {
  let doc = await getTreeDoc()
  if (!doc) {
    const value = defaultTree()
    const added = await db.collection('config').add({ data: { key: 'warehouseTree', value } })
    return { _id: added._id, value }
  }
  return doc
}
async function saveTree(docId, value) {
  await db.collection('config').doc(docId).update({ data: { value } })
}

// ===== 权限：谁能直接管库存（编辑/删除/手动增减）=====
// 规则：库管可管；若全村落还没有库管，则主管兜底；都不是则拒绝
async function canManageStock(openid) {
  const res = await db.collection('config').where({ key: 'roles' }).limit(1).get()
  const v = res.data.length ? (res.data[0].value || {}) : {}
  const keepers = v.keepers || []
  const supervisors = v.supervisors || []
  const isKeeper = keepers.some(k => k.openid === openid)
  const isSupervisor = supervisors.some(s => s.openid === openid)
  const noKeeper = keepers.length === 0
  if (isKeeper) return { ok: true }
  if (noKeeper && isSupervisor) return { ok: true }   // 无库管时主管兜底
  return { ok: false, msg: noKeeper ? '请先设立库管，或由主管操作' : '仅库管可管理库存' }
}
// 删除物品记录时连带清实拍图文件（手动删/消耗清零/归零清理三条路共用）
async function delItemPhoto(item) {
  if (item && item.photo) {
    try { await cloud.deleteFile({ fileList: [item.photo] }) } catch (e) { console.error('删实拍图失败', e) }
  }
}
// 某个 store 下是否还有物品（删除前校验）
async function storeHasItems(storeId) {
  const c = await db.collection('resources').where({ storeId }).count()
  return c.total > 0
}
async function siteHasItems(siteId) {
  const c = await db.collection('resources').where({ siteId }).count()
  return c.total > 0
}

exports.main = async (event) => {
  const { action, data } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  // ========== 库房树 ==========

  if (action === 'getWarehouseTree') {
    const doc = await ensureTree()
    return { success: true, tree: doc.value }
  }

  if (action === 'addSite') {
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '地方名不能为空' }
    const doc = await ensureTree()
    const tree = doc.value
    if (tree.sites.some(s => s.name === name)) return { success: false, msg: '该地方已存在' }
    tree.sites.push({ id: genId('s_'), name, stores: [] })
    await saveTree(doc._id, tree)
    return { success: true, tree }
  }

  if (action === 'addStore') {
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '分库名不能为空' }
    const doc = await ensureTree()
    const tree = doc.value
    const site = tree.sites.find(s => s.id === data.siteId)
    if (!site) return { success: false, msg: '地方不存在' }
    if ((site.stores || []).some(st => st.name === name)) return { success: false, msg: '该分库已存在' }
    site.stores = site.stores || []
    site.stores.push({ id: genId('st_'), name })
    await saveTree(doc._id, tree)
    return { success: true, tree }
  }

  if (action === 'renameNode') {
    // data: { kind:'site'|'store', id, name }
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '名称不能为空' }
    const doc = await ensureTree()
    const tree = doc.value
    let done = false
    for (const s of tree.sites) {
      if (data.kind === 'site' && s.id === data.id) { s.name = name; done = true; break }
      if (data.kind === 'store') {
        const st = (s.stores || []).find(x => x.id === data.id)
        if (st) { st.name = name; done = true; break }
      }
    }
    if (!done) return { success: false, msg: '节点不存在' }
    await saveTree(doc._id, tree)
    return { success: true, tree }
  }

  if (action === 'removeStore') {
    if (await storeHasItems(data.id)) return { success: false, msg: '该分库下还有物品，先清空或移走再删' }
    const doc = await ensureTree()
    const tree = doc.value
    for (const s of tree.sites) {
      s.stores = (s.stores || []).filter(st => st.id !== data.id)
    }
    await saveTree(doc._id, tree)
    return { success: true, tree }
  }

  if (action === 'removeSite') {
    if (await siteHasItems(data.id)) return { success: false, msg: '该地方下还有物品，先清空或移走再删' }
    const doc = await ensureTree()
    const tree = doc.value
    tree.sites = tree.sites.filter(s => s.id !== data.id)
    await saveTree(doc._id, tree)
    return { success: true, tree }
  }

  // 老数据迁移：没有 siteId 的物品 → 归「金山书院」，食材→食材库 / 耗材→耗材库 / 其余→材料物品库
  if (action === 'migrateResourcesToStores') {
    const doc = await ensureTree()
    const tree = doc.value
    const site = tree.sites.find(s => s.name === '金山书院') || tree.sites[0]
    if (!site) return { success: false, msg: '库房树为空' }
    const storeIdByName = (nm) => {
      const st = (site.stores || []).find(x => x.name === nm)
      return st ? st.id : ((site.stores || [])[0] || {}).id
    }
    const foodId = storeIdByName('食材库')
    const consumId = storeIdByName('耗材库')
    const matId = storeIdByName('材料物品库')
    const all = await db.collection('resources').limit(500).get()
    let n = 0
    for (const r of all.data) {
      if (r.siteId) continue
      let storeId = matId
      if (r.category === '食材') storeId = foodId
      else if (r.category === '耗材') storeId = consumId
      await db.collection('resources').doc(r._id).update({ data: { siteId: site.id, storeId } })
      n++
    }
    return { success: true, migrated: n }
  }

  // ========== 物品（原有 + 带上 site/store） ==========

  if (action === 'editItem') {
    const perm = await canManageStock(openid)
    if (!perm.ok) return { success: false, msg: perm.msg }
    // 先读旧值，保存后对比哪些字段变了，写一条编辑留痕
    const oldDoc = await db.collection('resources').doc(data.id).get()
    const old = oldDoc.data || {}
    const patch = {
      name: data.name,
      icon: data.icon,
      category: data.category,
      lowThreshold: data.lowThreshold || 3,
      updatedAt: new Date()
    }
    if (data.siteId !== undefined) patch.siteId = data.siteId
    if (data.storeId !== undefined) patch.storeId = data.storeId
    if (data.consumeMode !== undefined) patch.consumeMode = data.consumeMode
    // 实拍图：传了才动（undefined 不碰，老调用不受影响）；换图/删图时清掉旧文件
    if (data.photo !== undefined) {
      patch.photo = data.photo || ''
      if (old.photo && old.photo !== patch.photo) {
        try { await cloud.deleteFile({ fileList: [old.photo] }) } catch (e) { console.error('删旧实拍图失败', e) }
      }
    }
    await db.collection('resources').doc(data.id).update({ data: patch })

    // 计算 diff（只记真正变了的字段）
    const labels = { name: '名称', category: '分类', lowThreshold: '预警值', consumeMode: '领用方式', siteId: '地方', storeId: '分库', icon: '图标' }
    const changes = []
    for (const k in labels) {
      if (patch[k] !== undefined && patch[k] !== old[k]) {
        changes.push(`${labels[k]}:${old[k] || '空'}→${patch[k] || '空'}`)
      }
    }
    // 实拍图变更留痕只记有/无，不记 fileID
    if (patch.photo !== undefined && (patch.photo || '') !== (old.photo || '')) {
      changes.push(`实拍图:${old.photo ? '有' : '无'}→${patch.photo ? '有' : '无'}`)
    }
    if (changes.length > 0) {
      await db.collection('logs').add({
        data: {
          type: 'item_edit', itemName: data.name, changes: changes.join('；'),
          operatorName: data.operatorName || '', openid, createdAt: new Date()
        }
      })
    }
    return { success: true }
  }

  // 快捷设置实拍图（卡片占位区直拍）：只动 photo，不碰其他字段；换图清旧文件
  if (action === 'setItemPhoto') {
    const perm = await canManageStock(openid)
    if (!perm.ok) return { success: false, msg: perm.msg }
    const doc = await db.collection('resources').doc(data.id).get()
    const old = doc.data
    if (!old) return { success: false, msg: '物品不存在' }
    const photo = data.photo || ''
    if (old.photo && old.photo !== photo) {
      try { await cloud.deleteFile({ fileList: [old.photo] }) } catch (e) { console.error('删旧实拍图失败', e) }
    }
    await db.collection('resources').doc(data.id).update({ data: { photo } })
    await db.collection('logs').add({
      data: {
        type: 'item_edit', itemName: old.name, changes: `实拍图:${old.photo ? '有' : '无'}→${photo ? '有' : '无'}`,
        operatorName: data.operatorName || '', openid, createdAt: new Date()
      }
    })
    return { success: true }
  }

  if (action === 'deleteItem') {
    const perm = await canManageStock(openid)
    if (!perm.ok) return { success: false, msg: perm.msg }
    // 护栏：还有库存的不让直删，避免账凭空少一批
    const doc = await db.collection('resources').doc(data.id).get()
    const item = doc.data
    if (!item) return { success: false, msg: '物品不存在' }
    if ((item.qty || 0) > 0) {
      return { success: false, msg: `「${item.name}」还有 ${item.qty} 库存，请先报废或领用清空再删除` }
    }
    await delItemPhoto(item)
    await db.collection('resources').doc(data.id).remove()
    // 删除留痕
    await db.collection('logs').add({
      data: { type: 'item_delete', itemName: item.name, operatorName: data.operatorName || '', openid, createdAt: new Date() }
    })
    return { success: true }
  }

  if (action === 'cleanZero') {
    const result = await db.collection('resources').where({ qty: _.lte(0) }).get()
    for (const item of result.data) {
      await delItemPhoto(item)
      await db.collection('resources').doc(item._id).remove()
    }
    return { success: true, cleaned: result.data.length }
  }

  if (action === 'getItems') {
    let q = db.collection('resources')
    const where = {}
    if (data && data.siteId) where.siteId = data.siteId
    if (data && data.storeId) where.storeId = data.storeId
    if (Object.keys(where).length) q = q.where(where)
    const result = await q.orderBy('category', 'asc').orderBy('name', 'asc').limit(200).get()
    return { success: true, list: result.data }
  }

  // ========== 盘点 ==========

  // 提交盘点：实际数为准，逐项改账 + 留痕，存一条盘点单
  if (action === 'submitStocktake') {
    try { await db.createCollection('stocktakes') } catch (e) {}
    const counts = (data.counts || []).filter(c => c && c.id)
    if (counts.length === 0) return { success: false, msg: '没有可盘点的物品' }
    const operatorName = data.operatorName || ''
    const items = []
    let diffCount = 0
    for (const c of counts) {
      const actual = Number(c.actualQty)
      if (isNaN(actual) || actual < 0) continue
      const doc = await db.collection('resources').doc(c.id).get()
      if (!doc.data) continue
      const systemQty = doc.data.qty || 0
      const diff = actual - systemQty
      items.push({ name: doc.data.name, systemQty, actualQty: actual, diff })
      if (diff !== 0) {
        diffCount++
        await db.collection('resources').doc(c.id).update({ data: { qty: actual, updatedAt: new Date() } })
        await db.collection('logs').add({
          data: {
            type: 'stocktake', itemName: doc.data.name,
            systemQty, actualQty: actual, diff,
            operatorName, openid, createdAt: new Date()
          }
        })
      }
    }
    await db.collection('stocktakes').add({
      data: {
        siteId: data.siteId || '', storeId: data.storeId || '',
        operatorName, openid,
        items, diffCount, total: items.length,
        photos: data.photos || [],
        createdAt: new Date()
      }
    })
    return { success: true, diffCount, total: items.length }
  }

  if (action === 'getStocktakes') {
    try { await db.createCollection('stocktakes') } catch (e) {}
    const res = await db.collection('stocktakes').orderBy('createdAt', 'desc').limit(50).get()
    return { success: true, list: res.data }
  }

  // 仓库操作记录（采购入库 in / 领料出库 out / 报废 scrap / 编辑 / 删除 / 盘点）
  if (action === 'getWarehouseLogs') {
    const types = (data && data.types) || ['in', 'out', 'scrap', 'item_edit', 'item_delete', 'stocktake']
    const res = await db.collection('logs')
      .where({ type: _.in(types) })
      .orderBy('createdAt', 'desc')
      .limit((data && data.limit) || 60)
      .get()
    return { success: true, list: res.data }
  }

  if (action === 'addRecord') {
    const perm = await canManageStock(openid)
    if (!perm.ok) return { success: false, msg: perm.msg }
    const { name, category, icon, qty, type, operatorName, siteId, storeId } = data
    const existing = await db.collection('resources').where({ name }).limit(1).get()

    if (existing.data.length > 0) {
      const item = existing.data[0]
      const newQty = type === 'in' ? item.qty + qty : item.qty - qty
      if (newQty <= 0) {
        await delItemPhoto(item)
        await db.collection('resources').doc(item._id).remove()
      } else {
        const patch = { qty: newQty, lastOperator: operatorName || '', updatedAt: new Date() }
        // 老物品若还没归库，本次补给时若带了库就补上
        if (siteId && !item.siteId) patch.siteId = siteId
        if (storeId && !item.storeId) patch.storeId = storeId
        await db.collection('resources').doc(item._id).update({ data: patch })
      }
    } else {
      await db.collection('resources').add({
        data: {
          name,
          category: category || '其他',
          icon: icon || '📦',
          qty: type === 'in' ? qty : 0,
          lowThreshold: 3,
          consumeMode: data.consumeMode || 'instant',
          siteId: siteId || '',
          storeId: storeId || '',
          lastOperator: operatorName || '',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      })
    }

    await db.collection('logs').add({
      data: { type, itemName: name, qty, operatorName: operatorName || '', openid, createdAt: new Date() }
    })

    return { success: true }
  }

  // ========== 联系人（供应商/常用外部联系方式）==========
  // 信任模型：全员可看可增可改（留操作人），删除走库管/主管

  if (action === 'getContacts') {
    try { await db.createCollection('contacts') } catch (e) {}
    const res = await db.collection('contacts').orderBy('updatedAt', 'desc').limit(200).get()
    return { success: true, list: res.data }
  }

  if (action === 'saveContact') {
    try { await db.createCollection('contacts') } catch (e) {}
    const name = (data.name || '').trim()
    if (!name) return { success: false, msg: '姓名/称呼不能为空' }
    const doc = {
      name,
      tag: (data.tag || '').trim(),
      phone: (data.phone || '').trim(),
      wechat: (data.wechat || '').trim(),
      note: (data.note || '').trim(),
      operatorName: data.operatorName || '',
      updatedAt: new Date()
    }
    if (data.id) {
      await db.collection('contacts').doc(data.id).update({ data: doc })
      return { success: true, id: data.id }
    }
    doc.createdAt = new Date()
    doc.openid = openid
    const r = await db.collection('contacts').add({ data: doc })
    return { success: true, id: r._id }
  }

  if (action === 'deleteContact') {
    const perm = await canManageStock(openid)
    if (!perm.ok) return { success: false, msg: perm.msg }
    await db.collection('contacts').doc(data.id).remove()
    return { success: true }
  }

  return { success: false, msg: 'unknown action' }
}