// === localStorage データ管理 ===
const KEYS = { accounts: 'srt_accounts', session: 'srt_session', sellers: 'srt_sellers', products: 'srt_products', orders: 'srt_orders', settings: 'srt_settings' };

// --- アカウント ---
function getAccounts() { try { return JSON.parse(localStorage.getItem(KEYS.accounts) || '[]'); } catch { return []; } }
function saveAccounts(a) { localStorage.setItem(KEYS.accounts, JSON.stringify(a)); }
function getAccountsByEmail(email) { return getAccounts().filter(a => a.email === email); }
function addAccount(email, name) {
  const accounts = getAccounts();
  if (accounts.find(a => a.email === email && a.name === name)) return;
  accounts.push({ id: Date.now().toString(), email, name, createdAt: new Date().toISOString() });
  saveAccounts(accounts);
}

// --- セッション ---
function getSession() { try { return JSON.parse(localStorage.getItem(KEYS.session) || 'null'); } catch { return null; } }
function saveSession(s) { localStorage.setItem(KEYS.session, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(KEYS.session); }

// --- セラー ---
function getSellers() { try { return JSON.parse(localStorage.getItem(KEYS.sellers) || '[]'); } catch { return []; } }
function saveSellers(s) { localStorage.setItem(KEYS.sellers, JSON.stringify(s)); }
function addSellerToStorage(sellerId, name) {
  const sellers = getSellers();
  if (sellers.find(s => s.sellerId === sellerId)) return null;
  const s = { id: Date.now().toString(), sellerId, name: name || sellerId, createdAt: new Date().toISOString(), lastFetchedAt: null, productCount: 0, newCount: 0, removedCount: 0 };
  sellers.push(s);
  saveSellers(sellers);
  return s;
}
function deleteSellerFromStorage(id) {
  saveSellers(getSellers().filter(s => s.id !== id));
  saveAllProducts(getAllProducts().filter(p => p.sellerId !== id));
}
function updateSellerName(id, name) {
  const sellers = getSellers();
  const s = sellers.find(x => x.id === id);
  if (s) { s.name = name; saveSellers(sellers); }
}

// --- 商品 ---
function getAllProducts() { try { return JSON.parse(localStorage.getItem(KEYS.products) || '[]'); } catch { return []; } }
function saveAllProducts(p) { localStorage.setItem(KEYS.products, JSON.stringify(p)); }
function getProducts(sellerInternalId) { return getAllProducts().filter(p => p.sellerId === sellerInternalId); }
function saveProductsForSeller(sellerInternalId, newProducts) {
  const all = getAllProducts();
  const existing = all.filter(p => p.sellerId === sellerInternalId);
  const existingAsins = new Set(existing.map(p => p.asin));
  const newAsins = new Set(newProducts.map(p => p.asin));
  const today = new Date().toISOString().slice(0, 10);
  const result = [];
  for (const p of newProducts) {
    const prev = existing.find(e => e.asin === p.asin);
    result.push({ sellerId: sellerInternalId, asin: p.asin, title: p.title || prev?.title || '', price: p.price || prev?.price || 0, rank: p.rank || prev?.rank || null, image: p.image || prev?.image || '', status: existingAsins.has(p.asin) ? 'existing' : 'new', firstSeen: prev?.firstSeen || today, lastSeen: today });
  }
  for (const p of existing) { if (!newAsins.has(p.asin)) result.push({ ...p, status: 'removed' }); }
  saveAllProducts([...all.filter(p => p.sellerId !== sellerInternalId), ...result]);
  // 統計更新
  const sellers = getSellers();
  const seller = sellers.find(s => s.id === sellerInternalId);
  if (seller) {
    seller.productCount = result.filter(p => p.status !== 'removed').length;
    seller.newCount = result.filter(p => p.status === 'new').length;
    seller.removedCount = result.filter(p => p.status === 'removed').length;
    seller.lastFetchedAt = new Date().toISOString();
    saveSellers(sellers);
  }
}

// --- 注文(利益計算) ---
function getOrders() { try { return JSON.parse(localStorage.getItem(KEYS.orders) || '[]'); } catch { return []; } }
function saveOrders(o) { localStorage.setItem(KEYS.orders, JSON.stringify(o)); }
function getOrdersByMonth(year, month) { return getOrders().filter(o => o.year === year && o.month === month); }
function addOrderToStorage(order) {
  const orders = getOrders();
  const qty = order.quantity || 1;
  const totalSelling = order.sellingPrice * qty;
  const feeAmount = Math.floor(totalSelling * ((order.feeRate || 10) / 100));
  const totalCost = (order.costPrice || 0) * qty;
  const totalShipping = (order.shippingCost || 0) * qty;
  order.id = Date.now().toString();
  order.feeAmount = feeAmount;
  order.profit = totalSelling - totalCost - totalShipping - feeAmount;
  orders.push(order);
  saveOrders(orders);
}
function deleteOrder(id) { saveOrders(getOrders().filter(o => o.id !== id)); }

// --- 設定 ---
function getSettings() { try { return JSON.parse(localStorage.getItem(KEYS.settings) || '{}'); } catch { return {}; } }

function saveAppSettings() {
  const key = document.getElementById('keepaKeyInput').value.trim();
  const s = getSettings();
  s.keepaApiKey = key;
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
  showSnackbar('設定を保存しました');
}

// --- エクスポート/インポート ---
function exportAllData() {
  const data = { accounts: getAccounts(), sellers: getSellers(), products: getAllProducts(), orders: getOrders(), settings: getSettings(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `seller-research-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  showSnackbar('エクスポートしました');
}
function importAllData(event) {
  const file = event.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = function(e) {
    try {
      const d = JSON.parse(e.target.result);
      if (d.accounts) localStorage.setItem(KEYS.accounts, JSON.stringify(d.accounts));
      if (d.sellers) localStorage.setItem(KEYS.sellers, JSON.stringify(d.sellers));
      if (d.products) localStorage.setItem(KEYS.products, JSON.stringify(d.products));
      if (d.orders) localStorage.setItem(KEYS.orders, JSON.stringify(d.orders));
      if (d.settings) localStorage.setItem(KEYS.settings, JSON.stringify(d.settings));
      showSnackbar('インポートしました');
      location.reload();
    } catch { showSnackbar('インポート失敗'); }
  };
  r.readAsText(file); event.target.value = '';
}
function clearAllData() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  showSnackbar('全データを削除しました');
  location.reload();
}
