// === Keepa CSV パーサー ===

function parseKeepaCSV(text) {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseLine(lines[0]);
  const cols = detectColumns(header);
  const products = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);
    if (fields.length < 3) continue;

    let asin = '';
    let title = '';
    let price = 0;
    let rank = null;
    let image = '';

    // カラムマッピングで取得
    if (cols.asin >= 0) asin = fields[cols.asin]?.trim() || '';
    if (cols.title >= 0) title = fields[cols.title]?.trim() || '';
    if (cols.price >= 0) price = parsePrice(fields[cols.price]);
    if (cols.rank >= 0) rank = parseInt((fields[cols.rank] || '').replace(/[^0-9]/g, ''), 10) || null;
    if (cols.image >= 0) image = fields[cols.image]?.trim() || '';

    // ASINが見つからない場合、フィールドから探す
    if (!asin) {
      for (const f of fields) {
        if (/^B[0-9A-Z]{9}$/.test(f.trim())) { asin = f.trim(); break; }
      }
    }

    if (!asin || !/^B[0-9A-Z]{9}$/.test(asin)) continue;

    // 画像URLを生成
    if (!image) {
      image = `https://m.media-amazon.com/images/P/${asin}.09._SCL_SS120_.jpg`;
    }

    products.push({ asin, title: title || asin, price, rank, image });
  }

  return products;
}

// CSVヘッダーからカラムインデックスを検出
function detectColumns(header) {
  const cols = { asin: -1, title: -1, price: -1, rank: -1, image: -1 };

  for (let i = 0; i < header.length; i++) {
    const h = header[i].trim().toLowerCase();

    // ASIN
    if ((h.includes('asin') && (h.includes('子') || h.includes('child'))) || h === 'asin') {
      cols.asin = i;
    } else if (h.includes('asin') && cols.asin < 0) {
      cols.asin = i;
    }

    // 商品名
    if (h.includes('タイトル') || h.includes('title') || h.includes('商品名') || h.includes('product name')) {
      cols.title = i;
    }

    // 価格
    if ((h.includes('新品') && h.includes('現在')) || h.includes('buy box') || h === 'price' || (h.includes('amazon') && h.includes('price')) || h.includes('現在の価格')) {
      if (cols.price < 0) cols.price = i;
    }

    // ランキング
    if (h.includes('売れ筋') || h.includes('sales rank') || h.includes('ランキング') || h.includes('bsr')) {
      if (cols.rank < 0) cols.rank = i;
    }

    // 画像
    if (h.includes('画像') || h.includes('image')) {
      cols.image = i;
    }
  }

  return cols;
}

// CSV行をパース（クオート・タブ対応）
function parseLine(line) {
  // タブ区切りかカンマ区切りを判定
  const sep = line.includes('\t') ? '\t' : ',';
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// 価格パース
function parsePrice(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[¥￥,\s円]/g, '');
  return parseFloat(cleaned) || 0;
}
