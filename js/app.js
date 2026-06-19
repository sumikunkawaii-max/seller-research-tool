// === メインアプリ ===
let currentSellerId = null;
let currentFilter = 'active';
let sortCol = null;
let sortAsc = true;
let orderSortCol = null;
let orderSortAsc = true;
let profitView = 'list';
let loginEmail = '';

// === 初期化 ===
function init() {
  const session = getSession();
  if (session) {
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appMain').style.display = '';
    document.getElementById('accountNameDisplay').textContent = session.name;
    showPage('dashboard');
  } else {
    renderSavedAccounts();
  }
}

// ==========================
// ログイン
// ==========================
function renderSavedAccounts() {
  const accounts = getAccounts();
  const container = document.getElementById('savedAccounts');
  if (accounts.length === 0) { container.innerHTML = ''; return; }

  const unique = [];
  const seen = new Set();
  for (const a of accounts) {
    const key = a.email + '|' + a.name;
    if (!seen.has(key)) { seen.add(key); unique.push(a); }
  }

  container.innerHTML = `
    <div class="saved-accounts-section">
      <p style="font-size:12px;font-weight:600;margin-bottom:8px;color:#5f6368">保存済みアカウント</p>
      ${unique.map(a => `
        <button class="account-btn" onclick="quickLogin('${esc(a.email)}','${esc(a.name)}')">
          <div class="account-btn-name">${esc(a.name)}</div>
          <div class="account-btn-email">${esc(a.email)}</div>
        </button>
      `).join('')}
      <div class="divider"><span>または新しいアカウント</span></div>
    </div>
  `;
}

function quickLogin(email, name) {
  document.getElementById('loginEmail').value = email;
  saveSession({ email, name });
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appMain').style.display = '';
  document.getElementById('accountNameDisplay').textContent = name;
  showPage('dashboard');
}

function handleLogin(e) {
  e.preventDefault();
  loginEmail = document.getElementById('loginEmail').value.trim();
  const pw = document.getElementById('loginPassword').value;
  if (!loginEmail || !pw) return;

  const accounts = getAccountsByEmail(loginEmail);

  if (accounts.length > 1) {
    // 複数アカウント → 選択画面
    document.getElementById('loginStep1').style.display = 'none';
    document.getElementById('loginStep2').style.display = '';
    document.getElementById('loginEmailDisplay').textContent = loginEmail;
    document.getElementById('accountList').innerHTML = accounts.map(a => `
      <button class="account-btn" onclick="selectAccount('${esc(a.name)}')">
        <div class="account-btn-name">${esc(a.name)}</div>
      </button>
    `).join('');
  } else if (accounts.length === 1) {
    // 1つ → 自動ログイン
    completeLogin(loginEmail, accounts[0].name);
  } else {
    // 0 → アカウント名入力
    document.getElementById('loginStep1').style.display = 'none';
    document.getElementById('loginStep3').style.display = '';
    document.getElementById('loginEmailDisplay2').textContent = loginEmail;
  }
}

function selectAccount(name) {
  completeLogin(loginEmail, name);
}

function showNewAccountForm() {
  document.getElementById('loginStep2').style.display = 'none';
  document.getElementById('loginStep3').style.display = '';
  document.getElementById('loginEmailDisplay2').textContent = loginEmail;
}

function registerAccount(e) {
  e.preventDefault();
  const name = document.getElementById('accountNameInput').value.trim();
  if (!name) return;
  addAccount(loginEmail, name);
  completeLogin(loginEmail, name);
}

function backToLogin() {
  document.getElementById('loginStep1').style.display = '';
  document.getElementById('loginStep2').style.display = 'none';
  document.getElementById('loginStep3').style.display = 'none';
}

function completeLogin(email, name) {
  addAccount(email, name);
  saveSession({ email, name });
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appMain').style.display = '';
  document.getElementById('accountNameDisplay').textContent = name;
  showPage('dashboard');
}

function handleLogout() {
  clearSession();
  location.reload();
}

// ==========================
// ページ遷移
// ==========================
function showPage(page, data) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === page));

  if (page === 'dashboard') { currentSellerId = null; renderDashboard(); }
  else if (page === 'seller') { currentSellerId = data; currentFilter = 'active'; renderSellerPage(); }
  else if (page === 'profit') { initProfitPage(); }
  else if (page === 'settings') { document.getElementById('keepaKeyInput').value = getSettings().keepaApiKey || ''; }
}

// ==========================
// ダッシュボード
// ==========================
function renderDashboard() {
  const sellers = getSellers();
  const total = sellers.reduce((s, x) => s + (x.productCount || 0), 0);
  const totalNew = sellers.reduce((s, x) => s + (x.newCount || 0), 0);
  const totalRemoved = sellers.reduce((s, x) => s + (x.removedCount || 0), 0);

  document.getElementById('summaryBar').innerHTML = `
    <div class="summary-item"><div class="summary-num">${sellers.length}</div><div class="summary-label">監視セラー</div></div>
    <div class="summary-item"><div class="summary-num">${total.toLocaleString()}</div><div class="summary-label">合計出品数</div></div>
    <div class="summary-item"><div class="summary-num">${totalNew}</div><div class="summary-label">新規</div></div>
    <div class="summary-item"><div class="summary-num">${totalRemoved.toLocaleString()}</div><div class="summary-label">消失</div></div>
  `;

  const grid = document.getElementById('sellerGrid');
  const empty = document.getElementById('emptyState');
  if (sellers.length === 0) { grid.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  const today = new Date().toISOString().slice(0, 10);
  grid.innerHTML = sellers.map(s => {
    const ld = s.lastFetchedAt ? new Date(s.lastFetchedAt).toISOString().slice(0, 10) : null;
    const isToday = ld === today;
    const days = ld ? Math.floor((Date.now() - new Date(ld).getTime()) / 86400000) : null;
    const stale = !isToday;
    return `
      <div class="seller-card ${stale ? 'stale' : ''}" onclick="showPage('seller','${s.id}')">
        <div class="seller-card-header">
          <div class="seller-card-name">${esc(s.name)}</div>
          <span class="seller-card-date ${stale ? 'stale' : ''}">${ld ? (isToday ? '今日更新済' : days + '日前') : '未取得'}</span>
        </div>
        <div class="seller-card-stats">
          <div class="stat-box s-active" onclick="event.stopPropagation();openSellerFilter('${s.id}','active')"><div class="stat-num s-active">${s.productCount || 0}</div><div class="stat-label">出品中</div></div>
          <div class="stat-box s-new" onclick="event.stopPropagation();openSellerFilter('${s.id}','new')"><div class="stat-num s-new">${s.newCount || 0}</div><div class="stat-label">新規</div></div>
          <div class="stat-box s-removed" onclick="event.stopPropagation();openSellerFilter('${s.id}','removed')"><div class="stat-num s-removed">${s.removedCount || 0}</div><div class="stat-label">消失</div></div>
        </div>
      </div>
    `;
  }).join('');
}

function openSellerFilter(id, filter) { currentFilter = filter; showPage('seller', id); }

function addSeller() {
  const input = document.getElementById('addSellerInput');
  const id = input.value.trim().toUpperCase();
  if (!id) return;
  if (getSellers().find(s => s.sellerId === id)) { showSnackbar('既に登録済みです'); return; }
  addSellerToStorage(id, id);
  input.value = '';
  showSnackbar('セラーを追加しました');
  renderDashboard();
}
document.getElementById('addSellerInput').addEventListener('keydown', e => { if (e.key === 'Enter') addSeller(); });

// ==========================
// セラー詳細
// ==========================
function renderSellerPage() {
  const seller = getSellers().find(s => s.id === currentSellerId);
  if (!seller) { showPage('dashboard'); return; }

  document.getElementById('sellerHeader').innerHTML = `
    <div class="seller-info">
      <h2>${esc(seller.name)}</h2>
      <div class="seller-meta">
        <span style="font-family:monospace">${seller.sellerId}</span>
        <a onclick="renameSeller('${seller.id}')">名前変更</a>
        <a onclick="deleteSeller('${seller.id}')">削除</a>
      </div>
    </div>
    <div class="seller-actions">
      ${seller.lastFetchedAt ? `<span style="font-size:10px;color:#94a3b8">${new Date(seller.lastFetchedAt).toISOString().slice(0, 10)}</span>` : ''}
      <a href="https://keepa.com/#!seller/5-${seller.sellerId}" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none">セラー更新 <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
    </div>
  `;

  const products = getProducts(currentSellerId);
  const counts = { active: products.filter(p => p.status !== 'removed').length, new: products.filter(p => p.status === 'new').length, removed: products.filter(p => p.status === 'removed').length };

  document.getElementById('filterBar').innerHTML = ['active', 'new', 'removed'].map(f => `
    <button class="filter-item ${currentFilter === f ? 'selected' : ''}" onclick="currentFilter='${f}';renderSellerPage()">
      <div class="filter-num f-${f}">${counts[f]}</div>
      <div class="filter-label">${f === 'active' ? '出品中' : f === 'new' ? '新規' : '消失'}</div>
    </button>
  `).join('');

  document.getElementById('searchInput').value = '';
  renderProducts();
}

function renderProducts() {
  let products = getProducts(currentSellerId);
  if (currentFilter === 'active') products = products.filter(p => p.status !== 'removed');
  else if (currentFilter === 'new') products = products.filter(p => p.status === 'new');
  else if (currentFilter === 'removed') products = products.filter(p => p.status === 'removed');

  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  if (q) products = products.filter(p => (p.title || '').toLowerCase().includes(q) || p.asin.toLowerCase().includes(q));

  if (sortCol) {
    products.sort((a, b) => {
      let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      return (sortAsc ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });
  }

  const body = document.getElementById('productBody');
  const table = document.getElementById('productTable');
  const noP = document.getElementById('noProducts');

  if (products.length === 0) { table.style.display = 'none'; noP.style.display = ''; return; }
  table.style.display = ''; noP.style.display = 'none';

  body.innerHTML = products.map(p => {
    const img = p.image || `https://m.media-amazon.com/images/P/${p.asin}.09._SCL_SS120_.jpg`;
    return `<tr>
      <td><img src="${esc(img)}" class="product-img" loading="lazy" onerror="this.style.visibility='hidden'"></td>
      <td><a href="https://www.amazon.co.jp/dp/${p.asin}" target="_blank" class="asin-link">${p.asin}</a></td>
      <td><div class="product-title">${esc(p.title || p.asin)}</div></td>
      <td class="col-price">${p.price ? '¥' + p.price.toLocaleString() : '-'}</td>
      <td class="col-rank">${p.rank ? p.rank.toLocaleString() : '-'}</td>
      <td class="col-link"><a href="https://keepa.com/#!product/5-${p.asin}" target="_blank" class="link-btn">Keepa</a></td>
    </tr>`;
  }).join('');
}

function sortProducts(col) { if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = true; } renderProducts(); }
function renameSeller(id) { const s = getSellers().find(x => x.id === id); if (!s) return; const n = prompt('新しい名前', s.name); if (n?.trim()) { updateSellerName(id, n.trim()); renderSellerPage(); showSnackbar('名前を変更しました'); } }
function deleteSeller(id) { if (!confirm('削除しますか？')) return; deleteSellerFromStorage(id); showPage('dashboard'); showSnackbar('削除しました'); }

// CSV
const csvDrop = document.getElementById('csvDrop');
csvDrop.addEventListener('dragover', e => { e.preventDefault(); csvDrop.classList.add('dragging'); });
csvDrop.addEventListener('dragleave', () => csvDrop.classList.remove('dragging'));
csvDrop.addEventListener('drop', e => { e.preventDefault(); csvDrop.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) importCSV(f); });
document.getElementById('csvFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCSV(f); e.target.value = ''; });

function importCSV(file) {
  if (!currentSellerId) return;
  const r = new FileReader();
  r.onload = function(e) {
    const products = parseKeepaCSV(e.target.result);
    if (products.length === 0) { showSnackbar('CSVからデータを読み取れませんでした'); return; }
    saveProductsForSeller(currentSellerId, products);
    showSnackbar(products.length + '件の商品を取り込みました');
    renderSellerPage();
  };
  r.readAsText(file);
}

// ==========================
// 利益計算
// ==========================
function initProfitPage() {
  const now = new Date();
  const ys = document.getElementById('profitYear');
  const ms = document.getElementById('profitMonth');
  if (ys.options.length === 0) {
    for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) ys.add(new Option(y + '年', y));
    for (let m = 1; m <= 12; m++) ms.add(new Option(m + '月', m));
    ms.value = now.getMonth() + 1;
  }
  profitView = 'list';
  renderProfitPage();
}

function renderProfitPage() {
  const year = Number(document.getElementById('profitYear').value);
  const month = Number(document.getElementById('profitMonth').value);
  const orders = getOrdersByMonth(year, month);

  // サマリ
  const totalSelling = orders.reduce((s, o) => s + o.sellingPrice * o.quantity, 0);
  const totalCost = orders.reduce((s, o) => s + (o.costPrice || 0) * o.quantity, 0);
  const totalShipping = orders.reduce((s, o) => s + (o.shippingCost || 0) * o.quantity, 0);
  const totalFee = orders.reduce((s, o) => s + o.feeAmount, 0);
  const totalProfit = orders.reduce((s, o) => s + o.profit, 0);

  document.getElementById('profitSummary').innerHTML = `
    <div class="profit-item"><div class="profit-num c-blue">¥${totalSelling.toLocaleString()}</div><div class="profit-label">売上</div></div>
    <div class="profit-item"><div class="profit-num c-yellow">¥${totalCost.toLocaleString()}</div><div class="profit-label">仕入れ</div></div>
    <div class="profit-item"><div class="profit-num c-gray">¥${totalShipping.toLocaleString()}</div><div class="profit-label">送料</div></div>
    <div class="profit-item"><div class="profit-num c-red">¥${totalFee.toLocaleString()}</div><div class="profit-label">手数料</div></div>
    <div class="profit-item bg-green"><div class="profit-num ${totalProfit >= 0 ? 'c-green' : 'c-red'}">¥${totalProfit.toLocaleString()}</div><div class="profit-label">利益</div></div>
  `;

  updateViewToggle();
  if (profitView === 'list') renderOrderList(orders);
  else renderAsinSummary(orders);
}

function renderOrderList(orders) {
  document.getElementById('orderListView').style.display = '';
  document.getElementById('asinSummaryView').style.display = 'none';

  if (orderSortCol) {
    orders = [...orders].sort((a, b) => {
      let va = a[orderSortCol] ?? '', vb = b[orderSortCol] ?? '';
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      return (orderSortAsc ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });
  }

  const body = document.getElementById('orderBody');
  const noOrders = document.getElementById('noOrders');
  const table = document.getElementById('orderTable');

  if (orders.length === 0) { table.style.display = 'none'; noOrders.style.display = ''; return; }
  table.style.display = ''; noOrders.style.display = 'none';

  body.innerHTML = orders.map(o => `
    <tr>
      <td><div class="product-title">${esc(o.productName)}</div></td>
      <td><span class="asin-link">${esc(o.asin || '-')}</span></td>
      <td class="col-price">¥${o.sellingPrice.toLocaleString()}</td>
      <td style="text-align:right">${o.quantity}</td>
      <td class="col-price">¥${(o.costPrice || 0).toLocaleString()}</td>
      <td class="col-price">¥${(o.shippingCost || 0).toLocaleString()}</td>
      <td class="col-price" style="color:#dc2626">¥${o.feeAmount.toLocaleString()}</td>
      <td class="col-price" style="font-weight:700;color:${o.profit >= 0 ? '#059669' : '#dc2626'}">¥${o.profit.toLocaleString()}</td>
      <td><button class="del-btn" onclick="deleteOrderAndRefresh('${o.id}')">削除</button></td>
    </tr>
  `).join('');
}

function renderAsinSummary(orders) {
  document.getElementById('orderListView').style.display = 'none';
  document.getElementById('asinSummaryView').style.display = '';

  const map = new Map();
  for (const o of orders) {
    const key = o.asin || o.productName;
    const ex = map.get(key);
    if (ex) {
      ex.qty += o.quantity; ex.selling += o.sellingPrice * o.quantity;
      ex.cost += (o.costPrice || 0) * o.quantity; ex.shipping += (o.shippingCost || 0) * o.quantity;
      ex.fee += o.feeAmount; ex.profit += o.profit;
    } else {
      map.set(key, { asin: o.asin, name: o.productName, qty: o.quantity,
        selling: o.sellingPrice * o.quantity, cost: (o.costPrice || 0) * o.quantity,
        shipping: (o.shippingCost || 0) * o.quantity, fee: o.feeAmount, profit: o.profit });
    }
  }

  const items = Array.from(map.values()).sort((a, b) => b.selling - a.selling);
  const grand = items.reduce((a, i) => ({ qty: a.qty + i.qty, selling: a.selling + i.selling, cost: a.cost + i.cost, shipping: a.shipping + i.shipping, fee: a.fee + i.fee, profit: a.profit + i.profit }), { qty: 0, selling: 0, cost: 0, shipping: 0, fee: 0, profit: 0 });

  document.getElementById('asinBody').innerHTML = items.map(i => {
    const margin = i.selling > 0 ? (i.profit / i.selling * 100).toFixed(1) : '0.0';
    return `<tr>
      <td><div class="product-title">${esc(i.name)}</div>${i.asin ? `<span class="asin-link">${esc(i.asin)}</span>` : ''}</td>
      <td class="col-price">${i.qty}</td>
      <td class="col-price">¥${i.selling.toLocaleString()}</td>
      <td class="col-price" style="color:#d97706">¥${i.cost.toLocaleString()}</td>
      <td class="col-price">¥${i.shipping.toLocaleString()}</td>
      <td class="col-price" style="color:#dc2626">¥${i.fee.toLocaleString()}</td>
      <td class="col-price" style="font-weight:700;color:${i.profit >= 0 ? '#059669' : '#dc2626'}">¥${i.profit.toLocaleString()}</td>
      <td class="col-price" style="color:${Number(margin) >= 0 ? '#059669' : '#dc2626'}">${margin}%</td>
    </tr>`;
  }).join('') + `<tr class="total-row">
    <td>合計 (${items.length}商品)</td>
    <td class="col-price">${grand.qty}</td>
    <td class="col-price">¥${grand.selling.toLocaleString()}</td>
    <td class="col-price" style="color:#d97706">¥${grand.cost.toLocaleString()}</td>
    <td class="col-price">¥${grand.shipping.toLocaleString()}</td>
    <td class="col-price" style="color:#dc2626">¥${grand.fee.toLocaleString()}</td>
    <td class="col-price" style="font-weight:700;color:${grand.profit >= 0 ? '#059669' : '#dc2626'}">¥${grand.profit.toLocaleString()}</td>
    <td class="col-price">${grand.selling > 0 ? (grand.profit / grand.selling * 100).toFixed(1) : '0.0'}%</td>
  </tr>`;
}

function sortOrders(col) { if (orderSortCol === col) orderSortAsc = !orderSortAsc; else { orderSortCol = col; orderSortAsc = true; } renderProfitPage(); }
function deleteOrderAndRefresh(id) { if (!confirm('削除しますか？')) return; deleteOrder(id); renderProfitPage(); }

function setProfitView(v) { profitView = v; renderProfitPage(); }
function updateViewToggle() { document.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.view === profitView)); }

function toggleOrderForm() {
  const form = document.getElementById('orderForm');
  const btn = document.getElementById('toggleFormBtn');
  if (form.style.display === 'none') { form.style.display = ''; btn.textContent = '閉じる'; }
  else { form.style.display = 'none'; btn.textContent = '入力フォームを開く'; }
}

function updatePreview() {
  const price = Number(document.getElementById('orderPrice').value) || 0;
  const qty = Number(document.getElementById('orderQty').value) || 1;
  const cost = Number(document.getElementById('orderCost').value) || 0;
  const shipping = Number(document.getElementById('orderShipping').value) || 0;
  const feeRate = Number(document.getElementById('orderFeeRate').value) || 10;
  const el = document.getElementById('profitPreview');

  if (price <= 0) { el.style.display = 'none'; return; }
  el.style.display = '';

  const totalSelling = price * qty;
  const fee = Math.floor(totalSelling * feeRate / 100);
  const totalCost = cost * qty;
  const totalShipping = shipping * qty;
  const profit = totalSelling - totalCost - totalShipping - fee;

  el.innerHTML = `<div class="preview-row">
    <span class="preview-label">売上: ¥${totalSelling.toLocaleString()}</span>
    <span class="preview-label">- 仕入: ¥${totalCost.toLocaleString()}</span>
    <span class="preview-label">- 送料: ¥${totalShipping.toLocaleString()}</span>
    <span class="preview-label">- 手数料: ¥${fee.toLocaleString()}</span>
    <span class="preview-profit ${profit >= 0 ? 'positive' : 'negative'}">= 利益: ¥${profit.toLocaleString()}</span>
  </div>`;
}

function addOrder(e) {
  e.preventDefault();
  const year = Number(document.getElementById('profitYear').value);
  const month = Number(document.getElementById('profitMonth').value);
  addOrderToStorage({
    year, month,
    productName: document.getElementById('orderName').value.trim(),
    asin: document.getElementById('orderAsin').value.trim().toUpperCase(),
    sellingPrice: Number(document.getElementById('orderPrice').value) || 0,
    quantity: Number(document.getElementById('orderQty').value) || 1,
    costPrice: Number(document.getElementById('orderCost').value) || 0,
    shippingCost: Number(document.getElementById('orderShipping').value) || 0,
    feeRate: Number(document.getElementById('orderFeeRate').value) || 10,
  });
  document.getElementById('orderName').value = '';
  document.getElementById('orderAsin').value = '';
  document.getElementById('orderPrice').value = '';
  document.getElementById('orderQty').value = '1';
  document.getElementById('orderCost').value = '';
  document.getElementById('orderShipping').value = '';
  document.getElementById('profitPreview').style.display = 'none';
  toggleOrderForm();
  showSnackbar('注文を追加しました');
  renderProfitPage();
}

// ==========================
// ユーティリティ
// ==========================
let snackTimeout = null;
function showSnackbar(msg) {
  const el = document.getElementById('snackbar');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(snackTimeout);
  snackTimeout = setTimeout(() => el.classList.remove('show'), 3000);
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// === 起動 ===
init();
