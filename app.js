// === リサーチツール ===
// Amazonセラーの商品一覧をKeepa APIで取得・管理するツール

'use strict';

// === 定数 ===
const STORAGE_KEYS = {
  sellers: 'sr_sellers',
  settings: 'sr_settings',
  activeSeller: 'sr_active',
};

// Keepa CSV_TYPE定数（利益計算ツールと同じ）
const CSV_TYPE = {
  AMAZON: 0, NEW: 1, SALES_RANK: 3,
  COUNT_NEW: 11, RATING: 16, COUNT_REVIEWS: 17,
  BUY_BOX: 18, COUNT_NEW_FBA: 34, COUNT_NEW_FBM: 35,
};

// テーブル列定義
const COLUMNS = [
  { id: 'image',        label: '画像',       w: '50px' },
  { id: 'title',        label: '商品名' },
  { id: 'asin',         label: 'ASIN',       w: '100px' },
  { id: 'currentPrice', label: '現在価格',   w: '80px',  sortKey: 'currentPrice' },
  { id: 'avgPrice',     label: '平均価格',   w: '80px',  sortKey: 'avg90BuyBoxPrice' },
  { id: 'rank',         label: 'ランキング', w: '80px',  sortKey: 'avg90SalesRank' },
  { id: 'sales',        label: '販売数/月',  w: '70px',  sortKey: 'monthlySold' },
  { id: 'sellers',      label: '出品者数',   w: '60px',  sortKey: 'avg90NewSellerCount' },
  { id: 'category',     label: 'カテゴリ',   w: '120px' },
  { id: 'rating',       label: '評価',       w: '50px',  sortKey: 'rating' },
  { id: 'actions',      label: '',           w: '50px' },
];

// === 状態変数 ===
let sellers = [];
let settings = { keepaApiKey: '' };
let activeSellerIdState = null;
let sortState = { key: null, dir: 'asc' };
let searchQuery = '';
let currentMode = 'seller';
let currentProducts = []; // 条件検索結果用

// === ユーティリティ ===

// 数値フォーマット（カンマ区切り）
function formatNum(n) {
  if (n === null || n === undefined) return null;
  return Number(n).toLocaleString('ja-JP');
}

// 価格表示
function formatPrice(n) {
  if (n === null || n === undefined) return null;
  return '\u00a5' + formatNum(n);
}

// トースト表示
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 300ms ease-in forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ローディング表示/非表示
function showLoading(showOrText, text) {
  const el = document.getElementById('loadingOverlay');
  // 互換性: showLoading(text) の形式もサポート
  if (typeof showOrText === 'boolean') {
    el.classList.toggle('active', showOrText);
    if (text) document.getElementById('loadingText').textContent = text;
    else if (!showOrText) document.getElementById('loadingText').textContent = 'データを取得中...';
  } else {
    // 従来の showLoading(text) 形式
    document.getElementById('loadingText').textContent = showOrText || 'データを取得中...';
    el.classList.add('active');
  }
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('active');
  document.getElementById('loadingText').textContent = 'データを取得中...';
}

// === localStorage操作 ===

function loadSellers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sellers);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSellers() {
  localStorage.setItem(STORAGE_KEYS.sellers, JSON.stringify(sellers));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    return raw ? JSON.parse(raw) : { keepaApiKey: '' };
  } catch { return { keepaApiKey: '' }; }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadActiveSeller() {
  return localStorage.getItem(STORAGE_KEYS.activeSeller) || null;
}

function saveActiveSeller(id) {
  if (id) {
    localStorage.setItem(STORAGE_KEYS.activeSeller, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.activeSeller);
  }
}

// === セラーID抽出 ===
function extractSellerId(input) {
  input = input.trim();
  // URLからの抽出パターン
  const patterns = [
    /[?&]seller=([A-Z0-9]+)/i,
    /[?&]me=([A-Z0-9]+)/i,
    /\/sp\?.*seller=([A-Z0-9]+)/i,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1].toUpperCase();
  }
  // 直接IDが入力された場合（英数字10-14文字）
  if (/^[A-Z0-9]{10,14}$/i.test(input)) return input.toUpperCase();
  return null;
}

// === Keepa API ===

// Keepa商品データのパース（利益計算ツールと同じロジック）
function parseKeepaProduct(product) {
  const stats = product.stats || {};
  const g = (obj, i) => (!obj || !Array.isArray(obj) || obj[i] === undefined || obj[i] === -1) ? null : obj[i];

  // 画像URL
  let imageUrl = null;
  if (product.images && product.images.length) {
    const f = product.images[0].l || product.images[0].m;
    if (f) imageUrl = 'https://m.media-amazon.com/images/I/' + f;
  }

  // カテゴリ
  let category = '';
  if (product.categoryTree && product.categoryTree.length) {
    category = product.categoryTree.map(c => c.name).join(' > ');
  }

  // 評価
  const ratingRaw = g(stats.current, CSV_TYPE.RATING);

  // サイズ
  let sizeCm = null;
  let h = product.packageHeight, l = product.packageLength, w = product.packageWidth;
  if (h <= 0 && l <= 0 && w <= 0) {
    h = product.itemHeight;
    l = product.itemLength;
    w = product.itemWidth;
  }
  if (h > 0 || l > 0 || w > 0) {
    const toCm = v => v > 0 ? (v / 10).toFixed(1) : '?';
    sizeCm = toCm(l) + 'x' + toCm(w) + 'x' + toCm(h);
  }

  // 重量
  const weightG = (product.packageWeight > 0) ? product.packageWeight : (product.itemWeight > 0 ? product.itemWeight : null);

  // 現在価格（BuyBox > New）
  const currentBuyBox = stats.buyBoxPrice > 0 ? stats.buyBoxPrice : g(stats.current, CSV_TYPE.BUY_BOX);
  const currentNew = g(stats.current, CSV_TYPE.NEW);
  const currentPrice = currentBuyBox || currentNew;

  return {
    asin: product.asin,
    title: product.title || '不明',
    imageUrl,
    currentPrice,
    avg90BuyBoxPrice: g(stats.avg90, CSV_TYPE.BUY_BOX) ?? g(stats.avg90, CSV_TYPE.NEW),
    avg90SalesRank: g(stats.avg90, CSV_TYPE.SALES_RANK),
    salesRankDrops90: stats.salesRankDrops90 ?? null,
    monthlySold: product.monthlySold > 0 ? product.monthlySold : null,
    avg90NewSellerCount: g(stats.avg90, CSV_TYPE.COUNT_NEW),
    category,
    brand: product.brand || '',
    rating: ratingRaw !== null ? ratingRaw / 10 : null,
    reviewCount: g(stats.current, CSV_TYPE.COUNT_REVIEWS),
    sizeCm,
    weightG,
    lastUpdated: new Date().toISOString(),
  };
}

// セラー情報とASINリスト取得
async function fetchSellerFromKeepa(sellerId) {
  const apiKey = settings.keepaApiKey;
  if (!apiKey) {
    showToast('Keepa APIキーが設定されていません。設定画面でAPIキーを入力してください。', 'error');
    return null;
  }

  const url = 'https://api.keepa.com/seller?key=' + apiKey + '&domain=5&seller=' + sellerId;
  const res = await fetch(url);
  const data = await res.json();

  if (data.error) {
    showToast('Keepa APIエラー: ' + (data.error.message || JSON.stringify(data.error)), 'error');
    return null;
  }

  // セラーデータは sellers オブジェクトのキーとして返される
  const sellerData = data.sellers && data.sellers[sellerId];
  if (!sellerData) {
    showToast('セラーが見つかりませんでした: ' + sellerId, 'error');
    return null;
  }

  const sellerName = sellerData.sellerName || sellerId;
  const asinList = sellerData.asinList || [];

  return { sellerName, asinList, tokensLeft: data.tokensLeft };
}

// 商品詳細をバッチ取得（100件ずつ）
async function fetchProductsBatch(asinList, onProgress) {
  const apiKey = settings.keepaApiKey;
  const products = [];
  const total = asinList.length;

  for (let i = 0; i < total; i += 100) {
    const batch = asinList.slice(i, i + 100);
    const url = 'https://api.keepa.com/product?key=' + apiKey + '&domain=5&asin=' + batch.join(',') + '&stats=90';

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.error) {
        showToast('APIエラー: ' + (data.error.message || JSON.stringify(data.error)), 'error');
        break;
      }

      if (data.products) {
        data.products.forEach(p => {
          products.push(parseKeepaProduct(p));
        });
      }

      // 進捗コールバック
      if (onProgress) {
        onProgress(Math.min(i + 100, total), total);
      }

      // レート制限対策（最後のバッチは待たない）
      if (i + 100 < total) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      showToast('通信エラー: ' + err.message, 'error');
      break;
    }
  }

  return products;
}

// === セラー操作 ===

// セラー追加
function addSeller() {
  const input = document.getElementById('sellerIdInput');
  const rawValue = input.value.trim();
  if (!rawValue) {
    showToast('セラーIDまたはURLを入力してください', 'error');
    return;
  }

  const sellerId = extractSellerId(rawValue);
  if (!sellerId) {
    showToast('有効なセラーIDを取得できませんでした。セラーIDまたはセラーページのURLを入力してください。', 'error');
    return;
  }

  // 重複チェック
  if (sellers.find(s => s.id === sellerId)) {
    showToast('このセラーは既に登録されています', 'error');
    selectSeller(sellerId);
    input.value = '';
    return;
  }

  const newSeller = {
    id: sellerId,
    name: sellerId,  // 初期値はID（Keepa取得後に更新）
    addedAt: new Date().toISOString(),
    lastFetched: null,
    products: [],
  };

  sellers.push(newSeller);
  saveSellers();
  input.value = '';

  // セラー名をKeepaから取得（バックグラウンド）
  fetchSellerName(sellerId);

  selectSeller(sellerId);
  renderSidebar();
  showToast('セラーを追加しました: ' + sellerId);
}

// セラー名をKeepaから非同期取得
async function fetchSellerName(sellerId) {
  if (!settings.keepaApiKey) return;

  try {
    const result = await fetchSellerFromKeepa(sellerId);
    if (result && result.sellerName) {
      const seller = sellers.find(s => s.id === sellerId);
      if (seller) {
        seller.name = result.sellerName;
        saveSellers();
        renderSidebar();
        // アクティブセラーの場合はヘッダーも更新
        if (activeSellerIdState === sellerId) {
          renderMainHeader();
        }
      }
    }
  } catch (err) {
    // セラー名取得失敗は無視（IDを表示し続ける）
  }
}

// セラー選択
function selectSeller(sellerId) {
  activeSellerIdState = sellerId;
  saveActiveSeller(sellerId);
  sortState = { key: null, dir: 'asc' };
  searchQuery = '';
  const searchEl = document.getElementById('searchInput');
  if (searchEl) searchEl.value = '';
  renderSidebar();
  renderMainArea();
}

// セラー削除確認
function confirmDeleteSeller(sellerId, event) {
  if (event) {
    event.stopPropagation();
  }

  const seller = sellers.find(s => s.id === sellerId);
  if (!seller) return;

  const overlay = document.getElementById('confirmOverlay');
  const body = document.getElementById('confirmBody');
  document.getElementById('confirmTitle').textContent = 'セラー削除';

  body.innerHTML =
    '<p style="margin-bottom:16px;">セラー「' + escapeHtml(seller.name) + '」を削除しますか？</p>' +
    '<p style="font-size:12px;color:var(--on-surface-variant);margin-bottom:20px;">保存されている商品データも全て削除されます。</p>' +
    '<div class="modal-footer">' +
      '<button class="btn-secondary" onclick="closeConfirm()">キャンセル</button>' +
      '<button class="btn-danger" onclick="deleteSeller(\'' + sellerId + '\')">削除する</button>' +
    '</div>';

  overlay.classList.add('active');
}

// セラー削除
function deleteSeller(sellerId) {
  sellers = sellers.filter(s => s.id !== sellerId);
  saveSellers();

  if (activeSellerIdState === sellerId) {
    activeSellerIdState = sellers.length > 0 ? sellers[0].id : null;
    saveActiveSeller(activeSellerIdState);
  }

  closeConfirm();
  renderSidebar();
  renderMainArea();
  showToast('セラーを削除しました');
}

// 全商品取得
async function fetchSellerProducts() {
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (!seller) return;

  if (!settings.keepaApiKey) {
    showToast('Keepa APIキーが設定されていません', 'error');
    openSettings();
    return;
  }

  showLoading('セラー情報を取得中...');

  try {
    // 1. セラー情報とASINリスト取得
    const sellerResult = await fetchSellerFromKeepa(seller.id);
    if (!sellerResult) {
      hideLoading();
      return;
    }

    // セラー名を更新
    seller.name = sellerResult.sellerName;
    const asinList = sellerResult.asinList;

    if (asinList.length === 0) {
      hideLoading();
      showToast('このセラーには商品が見つかりませんでした');
      saveSellers();
      renderSidebar();
      renderMainArea();
      return;
    }

    // 2. 商品詳細をバッチ取得
    document.getElementById('loadingText').textContent =
      '商品データを取得中... (0/' + asinList.length + ')';

    const products = await fetchProductsBatch(asinList, (done, total) => {
      document.getElementById('loadingText').textContent =
        '商品データを取得中... (' + done + '/' + total + ')';
    });

    // 3. 保存
    seller.products = products;
    seller.lastFetched = new Date().toISOString();
    saveSellers();

    hideLoading();
    renderSidebar();
    renderMainArea();
    showToast(products.length + '件の商品を取得しました');

  } catch (err) {
    hideLoading();
    showToast('エラーが発生しました: ' + err.message, 'error');
  }
}

// 商品更新（既存データを再取得）
async function refreshSellerProducts() {
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (!seller || seller.products.length === 0) {
    showToast('取得済みの商品がありません。「全商品取得」を実行してください。', 'error');
    return;
  }

  if (!settings.keepaApiKey) {
    showToast('Keepa APIキーが設定されていません', 'error');
    return;
  }

  const asinList = seller.products.map(p => p.asin);
  showLoading('商品データを更新中... (0/' + asinList.length + ')');

  try {
    const products = await fetchProductsBatch(asinList, (done, total) => {
      document.getElementById('loadingText').textContent =
        '商品データを更新中... (' + done + '/' + total + ')';
    });

    seller.products = products;
    seller.lastFetched = new Date().toISOString();
    saveSellers();

    hideLoading();
    renderMainArea();
    showToast(products.length + '件の商品を更新しました');

  } catch (err) {
    hideLoading();
    showToast('エラー: ' + err.message, 'error');
  }
}

// === HTMLエスケープ ===
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// === モード切り替え ===

// サイドバーのセラー検索/条件検索モード切り替え
function switchMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.sidebar-mode-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sellerPanel').style.display = mode === 'seller' ? '' : 'none';
  document.getElementById('criteriaPanel').style.display = mode === 'criteria' ? '' : 'none';
}

// === 条件検索 ===

// Keepa Product Finder APIを使った条件検索
async function searchByCriteria() {
  const apiKey = settings.keepaApiKey;
  if (!apiKey) {
    showToast('Keepa APIキーを設定してください', 'error');
    openSettings();
    return;
  }

  // 検索条件を収集
  const category = document.getElementById('criteriaCategory').value;
  const priceMin = document.getElementById('criteriaPriceMin').value;
  const priceMax = document.getElementById('criteriaPriceMax').value;
  const salesMin = document.getElementById('criteriaSalesMin').value;
  const salesMax = document.getElementById('criteriaSalesMax').value;
  const sellersMin = document.getElementById('criteriaSellersMin').value;
  const sellersMax = document.getElementById('criteriaSellersMax').value;
  const rankMax = document.getElementById('criteriaRankMax').value;
  const reviewsMin = document.getElementById('criteriaReviewsMin').value;
  const sort = document.getElementById('criteriaSort').value;

  // Keepa Product Finder の selection パラメータを構築
  const selection = {};

  if (category) selection.categoryIds = [parseInt(category)];
  // domain=5（日本）では価格は円単位でそのまま指定
  if (priceMin) selection.current_NEW_MIN = parseInt(priceMin);
  if (priceMax) selection.current_NEW_MAX = parseInt(priceMax);
  if (salesMin) selection.monthlySold_MIN = parseInt(salesMin);
  if (salesMax) selection.monthlySold_MAX = parseInt(salesMax);
  if (sellersMin) selection.current_COUNT_NEW_MIN = parseInt(sellersMin);
  if (sellersMax) selection.current_COUNT_NEW_MAX = parseInt(sellersMax);
  if (rankMax) selection.current_SALES_RANK_MAX = parseInt(rankMax);
  if (reviewsMin) selection.current_COUNT_REVIEWS_MIN = parseInt(reviewsMin);

  // ソート設定
  selection.sort = [[sort, 'asc']];
  selection.perPage = 50;
  selection.page = 0;

  showLoading(true, '条件検索中...');

  try {
    const url = 'https://api.keepa.com/query?key=' + encodeURIComponent(apiKey) + '&domain=5&selection=' + encodeURIComponent(JSON.stringify(selection));
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      hideLoading();
      showToast('Keepa APIエラー: ' + JSON.stringify(data.error), 'error');
      return;
    }

    const asinList = data.asinList || [];
    if (!asinList.length) {
      hideLoading();
      showToast('条件に一致する商品が見つかりませんでした', 'error');
      return;
    }

    showLoading(true, asinList.length + '件の商品データを取得中...');

    // 商品詳細を取得（100件ずつ）
    const products = await fetchProductsBatch(asinList, (done, total) => {
      document.getElementById('loadingText').textContent =
        '商品データを取得中... (' + done + '/' + total + ')';
    });

    hideLoading();

    // 結果を表示（セラーと同じテーブルを使い回す）
    document.getElementById('mainHeader').style.display = 'flex';
    document.getElementById('sellerTitle').textContent = '条件検索結果';
    document.getElementById('sellerProductCount').textContent = products.length + '件';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('tableCard').style.display = 'block';

    // セラー選択状態をリセット（条件検索結果表示中）
    activeSellerIdState = null;
    saveActiveSeller(null);
    renderSidebar();

    // currentProductsに設定してテーブル描画
    currentProducts = products;
    sortState = { key: null, dir: 'asc' };
    searchQuery = '';
    const searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
    renderTable(products);

    showToast(products.length + '件の商品が見つかりました');
  } catch (err) {
    hideLoading();
    showToast('検索エラー: ' + err.message, 'error');
  }
}

// === 描画 ===

// サイドバー描画
function renderSidebar() {
  const list = document.getElementById('sellerList');
  if (sellers.length === 0) {
    list.innerHTML = '<div style="padding:20px 16px;text-align:center;color:var(--on-surface-variant);font-size:12px;">セラーが登録されていません</div>';
    return;
  }

  list.innerHTML = sellers.map(s => {
    const isActive = s.id === activeSellerIdState;
    const productCount = s.products.length;
    const metaText = productCount > 0 ? productCount + '件' : '未取得';

    return '<div class="seller-item' + (isActive ? ' active' : '') + '" onclick="selectSeller(\'' + s.id + '\')">' +
      '<div class="seller-item-info">' +
        '<div class="seller-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="seller-meta">' + s.id + ' / ' + metaText + '</div>' +
      '</div>' +
      '<button class="seller-delete-btn" onclick="confirmDeleteSeller(\'' + s.id + '\', event)" title="削除">' +
        '<span class="material-symbols-outlined">close</span>' +
      '</button>' +
    '</div>';
  }).join('');
}

// メインヘッダー描画
function renderMainHeader() {
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (!seller) return;

  document.getElementById('sellerTitle').textContent = seller.name;
  const count = seller.products.length;
  document.getElementById('sellerProductCount').textContent =
    count > 0 ? count + '件' : '未取得';
}

// メインエリア全体描画
function renderMainArea() {
  const header = document.getElementById('mainHeader');
  const empty = document.getElementById('emptyState');
  const tableCard = document.getElementById('tableCard');

  if (!activeSellerIdState) {
    // 条件検索結果が表示中の場合はそのまま維持
    if (currentProducts.length > 0 && currentMode === 'criteria') return;
    // セラー未選択
    header.style.display = 'none';
    empty.style.display = 'flex';
    tableCard.style.display = 'none';
    empty.innerHTML =
      '<span class="material-symbols-outlined empty-icon">search</span>' +
      '<h3>リサーチを始めましょう</h3>' +
      '<p>左のサイドバーからセラー検索または条件検索でリサーチできます</p>';
    return;
  }

  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (!seller) {
    activeSellerIdState = null;
    saveActiveSeller(null);
    renderMainArea();
    return;
  }

  header.style.display = 'flex';
  renderMainHeader();

  if (seller.products.length === 0) {
    // 商品未取得
    empty.style.display = 'flex';
    tableCard.style.display = 'none';
    empty.innerHTML =
      '<span class="material-symbols-outlined empty-icon">inventory_2</span>' +
      '<h3>商品がまだ取得されていません</h3>' +
      '<p>「全商品取得」ボタンをクリックしてKeepaからデータを取得してください</p>';
    return;
  }

  // 商品テーブル表示
  empty.style.display = 'none';
  tableCard.style.display = 'block';
  renderTable(seller.products);
}

// テーブル描画
function renderTable(products) {
  // フィルタリング
  let filtered = products;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = products.filter(p =>
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.asin && p.asin.toLowerCase().includes(q)) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  // ソート
  if (sortState.key) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortState.key];
      const bv = b[sortState.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortState.dir === 'asc' ? cmp : -cmp;
    });
  }

  // ヘッダー描画
  const thead = document.getElementById('productTableHead');
  thead.innerHTML = '<tr>' + COLUMNS.map(col => {
    const widthAttr = col.w ? ' style="width:' + col.w + '"' : '';
    if (col.sortKey) {
      const sortClass = sortState.key === col.sortKey
        ? (sortState.dir === 'asc' ? ' sorted-asc' : ' sorted-desc')
        : '';
      const sortIconText = sortState.key === col.sortKey
        ? (sortState.dir === 'asc' ? 'arrow_upward' : 'arrow_downward')
        : 'unfold_more';
      return '<th class="sortable' + sortClass + '" onclick="toggleSort(\'' + col.sortKey + '\')"' + widthAttr + '>' +
        col.label + ' <span class="material-symbols-outlined sort-icon">' + sortIconText + '</span></th>';
    }
    return '<th' + widthAttr + '>' + col.label + '</th>';
  }).join('') + '</tr>';

  // ボディ描画
  const tbody = document.getElementById('productTableBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + COLUMNS.length + '" style="text-align:center;padding:40px;color:var(--on-surface-variant);">該当する商品がありません</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    return '<tr>' +
      // 画像
      '<td class="col-image">' + renderImageCell(p) + '</td>' +
      // 商品名
      '<td class="col-title"><a class="product-name" href="https://www.amazon.co.jp/dp/' + p.asin + '" target="_blank" rel="noopener" title="' + escapeHtml(p.title) + '">' + escapeHtml(p.title) + '</a></td>' +
      // ASIN
      '<td class="col-asin"><span class="asin-copy" onclick="copyAsin(\'' + p.asin + '\', this)" title="クリックでコピー">' + p.asin + '</span></td>' +
      // 現在価格
      '<td class="col-price"><span class="cell-price">' + (formatPrice(p.currentPrice) || '<span class="cell-null">--</span>') + '</span></td>' +
      // 平均価格
      '<td class="col-price"><span class="cell-price">' + (formatPrice(p.avg90BuyBoxPrice) || '<span class="cell-null">--</span>') + '</span></td>' +
      // ランキング
      '<td class="col-rank"><span class="cell-rank">' + (p.avg90SalesRank ? formatNum(p.avg90SalesRank) : '<span class="cell-null">--</span>') + '</span></td>' +
      // 販売数/月
      '<td class="col-sales"><span class="cell-number">' + (p.monthlySold !== null ? formatNum(p.monthlySold) : '<span class="cell-null">--</span>') + '</span></td>' +
      // 出品者数
      '<td class="col-sellers"><span class="cell-number">' + (p.avg90NewSellerCount !== null ? formatNum(p.avg90NewSellerCount) : '<span class="cell-null">--</span>') + '</span></td>' +
      // カテゴリ
      '<td class="col-category"><span class="cell-category" title="' + escapeHtml(p.category) + '">' + escapeHtml(truncateCategory(p.category)) + '</span></td>' +
      // 評価
      '<td class="col-rating">' + renderRatingCell(p) + '</td>' +
      // アクション
      '<td class="col-actions"><div class="action-btns">' +
        '<button class="btn-icon" onclick="copyAsin(\'' + p.asin + '\', null)" title="ASINコピー"><span class="material-symbols-outlined">content_copy</span></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// 画像セル描画
function renderImageCell(product) {
  if (product.imageUrl) {
    return '<img class="product-thumb" src="' + product.imageUrl + '" alt="" loading="lazy" onclick="openDetailModal(\'' + product.asin + '\')">';
  }
  return '<div class="product-thumb-placeholder" onclick="openDetailModal(\'' + product.asin + '\')"><span class="material-symbols-outlined">image</span></div>';
}

// 評価セル描画
function renderRatingCell(product) {
  if (product.rating === null) return '<span class="cell-null">--</span>';
  return '<span class="cell-rating"><span class="material-symbols-outlined">star</span>' + product.rating.toFixed(1) + '</span>';
}

// カテゴリ省略表示
function truncateCategory(cat) {
  if (!cat) return '';
  const parts = cat.split(' > ');
  if (parts.length <= 2) return cat;
  return parts[0] + ' > ... > ' + parts[parts.length - 1];
}

// === ソート ===
function toggleSort(key) {
  if (sortState.key === key) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.key = key;
    sortState.dir = 'asc';
  }
  // セラー選択中はセラーの商品、条件検索結果がある場合はそちらを使う
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (seller) {
    renderTable(seller.products);
  } else if (currentProducts.length > 0) {
    renderTable(currentProducts);
  }
}

// === ASINコピー ===
function copyAsin(asin, el) {
  navigator.clipboard.writeText(asin).then(() => {
    showToast('コピーしました: ' + asin);
    if (el) {
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 1500);
    }
  }).catch(() => {
    showToast('コピーに失敗しました', 'error');
  });
}

// === 検索 ===
function handleSearch(e) {
  searchQuery = e.target.value.trim();
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (seller && seller.products.length > 0) {
    renderTable(seller.products);
  } else if (currentProducts.length > 0) {
    renderTable(currentProducts);
  }
}

// === 商品詳細モーダル ===
function openDetailModal(asin) {
  // セラーの商品または条件検索結果から商品を探す
  let product = null;
  const seller = sellers.find(s => s.id === activeSellerIdState);
  if (seller) {
    product = seller.products.find(p => p.asin === asin);
  } else if (currentProducts.length > 0) {
    product = currentProducts.find(p => p.asin === asin);
  }
  if (!product) return;

  const overlay = document.getElementById('detailOverlay');
  document.getElementById('detailTitle').textContent = '商品詳細';
  const body = document.getElementById('detailBody');

  body.innerHTML =
    // 上部：画像と基本情報
    '<div class="detail-top">' +
      (product.imageUrl
        ? '<img class="detail-image" src="' + product.imageUrl + '" alt="">'
        : '<div class="detail-image" style="display:flex;align-items:center;justify-content:center;"><span class="material-symbols-outlined" style="font-size:48px;color:var(--outline);">image</span></div>'
      ) +
      '<div class="detail-info">' +
        '<h3>' + escapeHtml(product.title) + '</h3>' +
        '<div class="detail-meta">' +
          '<span class="detail-tag">ASIN: ' + product.asin + '</span>' +
          (product.brand ? '<span class="detail-tag">' + escapeHtml(product.brand) + '</span>' : '') +
          '<a class="detail-tag" href="https://www.amazon.co.jp/dp/' + product.asin + '" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;">Amazon</a>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // 価格情報
    '<div class="detail-section-title">価格情報</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">現在価格</div>' +
        '<div class="detail-item-value price">' + (formatPrice(product.currentPrice) || '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">90日平均価格</div>' +
        '<div class="detail-item-value price">' + (formatPrice(product.avg90BuyBoxPrice) || '--') + '</div>' +
      '</div>' +
    '</div>' +

    // 販売データ
    '<div class="detail-section-title">販売データ</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">90日平均ランキング</div>' +
        '<div class="detail-item-value">' + (product.avg90SalesRank ? formatNum(product.avg90SalesRank) : '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">月間販売数</div>' +
        '<div class="detail-item-value">' + (product.monthlySold !== null ? formatNum(product.monthlySold) + '個' : '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">90日ランク下降回数</div>' +
        '<div class="detail-item-value">' + (product.salesRankDrops90 !== null ? formatNum(product.salesRankDrops90) + '回' : '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">出品者数 (90日平均)</div>' +
        '<div class="detail-item-value">' + (product.avg90NewSellerCount !== null ? formatNum(product.avg90NewSellerCount) + '人' : '--') + '</div>' +
      '</div>' +
    '</div>' +

    // 商品情報
    '<div class="detail-section-title">商品情報</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">カテゴリ</div>' +
        '<div class="detail-item-value" style="font-size:13px;font-weight:500;">' + (escapeHtml(product.category) || '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">評価</div>' +
        '<div class="detail-item-value">' +
          (product.rating !== null ? product.rating.toFixed(1) + ' / 5.0' : '--') +
          (product.reviewCount !== null ? ' <span style="font-size:12px;font-weight:400;color:var(--on-surface-variant);">(' + formatNum(product.reviewCount) + '件)</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">サイズ (cm)</div>' +
        '<div class="detail-item-value" style="font-size:14px;">' + (product.sizeCm || '--') + '</div>' +
      '</div>' +
      '<div class="detail-item">' +
        '<div class="detail-item-label">重量</div>' +
        '<div class="detail-item-value" style="font-size:14px;">' + (product.weightG !== null ? product.weightG + 'g' : '--') + '</div>' +
      '</div>' +
    '</div>';

  overlay.classList.add('active');
}

function closeDetailModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('detailOverlay').classList.remove('active');
}

// === 設定モーダル ===
function openSettings() {
  const overlay = document.getElementById('settingsOverlay');
  const body = document.getElementById('settingsBody');

  const maskedKey = settings.keepaApiKey
    ? settings.keepaApiKey.substring(0, 6) + '...' + settings.keepaApiKey.substring(settings.keepaApiKey.length - 4)
    : '未設定';

  body.innerHTML =
    '<div class="settings-section">' +
      '<div class="settings-label">Keepa APIキー</div>' +
      '<div class="settings-desc">' +
        '<a href="https://keepa.com/#!api" target="_blank" rel="noopener">Keepa</a>のAPIキーを設定してください。セラー情報や商品データの取得に必要です。' +
      '</div>' +
      '<div class="field-group">' +
        '<label>APIキー</label>' +
        '<input type="text" id="settingsApiKey" value="' + escapeHtml(settings.keepaApiKey) + '" placeholder="Keepa APIキーを入力" spellcheck="false" autocomplete="off">' +
      '</div>' +
      '<div class="settings-current">' +
        '<span class="settings-current-label">現在の設定:</span>' +
        '<span class="settings-current-value">' + maskedKey + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn-secondary" onclick="closeSettings()">キャンセル</button>' +
      '<button class="btn-primary" onclick="saveSettingsFromModal()">保存</button>' +
    '</div>';

  overlay.classList.add('active');
}

function saveSettingsFromModal() {
  const apiKey = document.getElementById('settingsApiKey').value.trim();
  settings.keepaApiKey = apiKey;
  saveSettings();
  closeSettings();
  showToast('設定を保存しました');
}

function closeSettings(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('settingsOverlay').classList.remove('active');
}

// === 確認モーダル ===
function closeConfirm(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('confirmOverlay').classList.remove('active');
}

// === 初期化 ===
document.addEventListener('DOMContentLoaded', () => {
  // データ読み込み
  sellers = loadSellers();
  settings = loadSettings();
  activeSellerIdState = loadActiveSeller();

  // アクティブセラーが存在しない場合はリセット
  if (activeSellerIdState && !sellers.find(s => s.id === activeSellerIdState)) {
    activeSellerIdState = sellers.length > 0 ? sellers[0].id : null;
    saveActiveSeller(activeSellerIdState);
  }

  // イベントリスナー
  document.getElementById('sellerIdInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addSeller();
  });

  document.getElementById('searchInput').addEventListener('input', handleSearch);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeDetailModal();
      closeSettings();
      closeConfirm();
    }
  });

  // 初期描画
  renderSidebar();
  renderMainArea();
});
