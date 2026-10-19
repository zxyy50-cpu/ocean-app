import { cleanText, comparisonKey, companyKey } from "../core/text.js";

// Read-only reference data for LINE orders, read from the company workbook by header name:
//   商品清單 (product master), 歷年購買紀錄_整理版 (ERP shipments), LINE訂單整理 (earlier LINE orders).
// The app never writes to the first two; LINE訂單整理 only gets new rows and status updates.

export const LINE_ORDER_HEADERS = Object.freeze(["日期", "客戶姓名", "客戶編號", "產品編號", "訂購品項", "規格", "數量", "價格", "配送方式", "稅額", "原始訊息", "備註", "狀態", "APP編號"]);

const number = (value) => {
  const text = cleanText(value).replace(/[,$\s元]/g, "");
  if (!text || text === "-") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

// 10001000.0 → "10001000"; spreadsheet numbers come back as floats.
export function normalizeCustomerNo(value) {
  return cleanText(value).replace(/\.0+$/, "");
}

export function normalizeCode(value) {
  return cleanText(value).toUpperCase().replace(/\s+/g, "");
}

export function normalizeDate(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}

// 「立高生機 趙郁婷」→ company 立高生機, contact 趙郁婷.
export function splitCustomerName(value) {
  const parts = cleanText(value).split(/\s+/).filter(Boolean);
  return { company: parts[0] || "", contact: parts.slice(1).join(" ") };
}

// Parenthesised short names in product names, e.g. "Potato Dextrose Agar (PDA)" → PDA.
// 「(TSI Agar)」 also answers to TSI, and 「(D-30) (DO-30)」 to each.
function acronyms(name) {
  return [...String(name || "").matchAll(/\(([A-Za-z][A-Za-z0-9.\- ]{1,14})\)/g)].flatMap((match) => {
    const full = match[1].trim();
    const first = full.split(/\s+/)[0];
    return first !== full ? [full, first] : [full];
  });
}

export function normalizeReference(raw = {}) {
  const products = new Map();
  for (const row of raw.products || []) {
    const code = normalizeCode(row["料件編號"]);
    if (!code || products.has(code)) continue;
    const name = cleanText(row["品名"]);
    products.set(code, {
      code, name, nameZh: cleanText(row["中文名稱"]) === name ? "" : cleanText(row["中文名稱"]), spec: cleanText(row["規格"]),
      brand: cleanText(row["產品品牌"]), listPrice: number(row["未稅定價"]), unit: cleanText(row["銷售單位"]),
      acronyms: acronyms(name),
    });
  }
  const history = [];
  for (const row of raw.history || []) {
    const code = normalizeCode(row["產品編號"]);
    const customerNo = normalizeCustomerNo(row["客戶編號"]);
    if (!code || !customerNo) continue;
    history.push({
      source: "出貨", customerNo, customerName: cleanText(row["客戶簡稱"]), contact: "", code, name: cleanText(row["品名"]), spec: cleanText(row["規格"]),
      quantity: number(row["出貨數量"]), unitPrice: number(row["出貨未稅單價"]), listPrice: number(row["本幣未稅訂價"]), unit: cleanText(row["出貨單位"]),
      date: normalizeDate(row["出貨日期"]) || normalizeDate(row["訂單日期"]), orderNo: cleanText(row["訂單單號"]), note: "",
    });
  }
  const lineOrders = [];
  for (const row of raw.lineOrders || []) {
    const { company, contact } = splitCustomerName(row["客戶姓名"]);
    const entry = {
      source: "LINE", customerNo: normalizeCustomerNo(row["客戶編號"]), customerName: company, contact, code: normalizeCode(row["產品編號"]),
      name: cleanText(row["訂購品項"]), spec: cleanText(row["規格"]), quantity: number(row["數量"]), unitPrice: number(row["價格"]), listPrice: null,
      unit: "", date: normalizeDate(row["日期"]), orderNo: "", note: cleanText(row["備註"]), status: cleanText(row["狀態"]), taxType: cleanText(row["稅額"]),
      delivery: cleanText(row["配送方式"]), raw: cleanText(row["原始訊息"]), appId: cleanText(row["APP編號"]),
    };
    lineOrders.push(entry);
    // Earlier LINE orders count as price history too; a 含稅 price is turned back into 未稅.
    if (entry.customerNo && entry.code && entry.unitPrice !== null) {
      history.push(entry.taxType === "含稅" ? { ...entry, unitPrice: Math.round((entry.unitPrice / 1.05) * 10000) / 10000 } : entry);
    }
  }
  history.sort((left, right) => String(right.date).localeCompare(String(left.date)) || (left.source === "出貨" ? -1 : 1));
  const byCustomerCode = new Map();
  for (const entry of history) {
    const key = `${entry.customerNo}|${entry.code}`;
    if (!byCustomerCode.has(key)) byCustomerCode.set(key, []);
    byCustomerCode.get(key).push(entry);
  }
  // Every name we know a customer number by: ERP short names, LINE company names and contacts.
  const customers = new Map();
  const remember = (customerNo, name, contact = "") => {
    if (!/^\d{5,8}$/.test(customerNo)) return;
    if (!customers.has(customerNo)) customers.set(customerNo, { customerNo, names: new Set(), contacts: new Set(), codes: new Set() });
    const customer = customers.get(customerNo);
    if (cleanText(name)) customer.names.add(cleanText(name));
    if (cleanText(contact)) customer.contacts.add(cleanText(contact));
  };
  for (const entry of history) { remember(entry.customerNo, entry.customerName, entry.contact); customers.get(entry.customerNo)?.codes.add(entry.code); }
  for (const entry of lineOrders) if (!/^\d{5,8}$/.test(entry.customerNo)) entry.customerNo = "";
  for (const entry of lineOrders) remember(entry.customerNo, entry.customerName, entry.contact);
  // 客戶資料: the company's own customer list (聯絡人 may carry a title: 「陳慧瑜 食品技師」).
  let customerRows = 0;
  for (const row of raw.customers || []) {
    const customerNo = normalizeCustomerNo(row["客戶編號"]);
    if (!/^\d{5,8}$/.test(customerNo)) continue;
    customerRows += 1;
    remember(customerNo, row["客戶名稱"], cleanText(row["聯絡人"]).split(/\s+/)[0]);
    const customer = customers.get(customerNo);
    if (customer && !customer.phone) customer.phone = cleanText(row["電話"]);
  }
  return { products, productList: [...products.values()], history, byCustomerCode, lineOrders, customers, customerRows, loadedAt: raw.loadedAt || "" };
}

// The Apps Script sends each sheet as { headers, rows } to keep the payload small.
export function tablesToRecords(payload = {}) {
  const records = (table) => (table?.rows || []).map((row) => Object.fromEntries((table.headers || []).map((header, index) => [header, row[index] ?? ""])));
  return { customers: records(payload.customers), products: records(payload.products), history: records(payload.history), lineOrders: records(payload.lineOrders), loadedAt: payload.loadedAt || "" };
}

export function emptyReference() {
  return normalizeReference({});
}

export function customerHistory(reference, customerNo, code) {
  return reference.byCustomerCode.get(`${customerNo}|${normalizeCode(code)}`) || [];
}

// Codes this customer bought, most recent first (used to rank product guesses).
export function customerCodes(reference, customerNo) {
  const seen = new Map();
  for (const entry of reference.history) {
    if (entry.customerNo === customerNo && !seen.has(entry.code)) seen.set(entry.code, entry.date);
  }
  return seen;
}

// Price history for one customer and product: latest price, when it last changed, the highest ever, the list price.
export function priceStory(reference, customerNo, code) {
  const entries = customerHistory(reference, customerNo, code).filter((entry) => entry.unitPrice !== null);
  if (!entries.length) return null;
  const latest = entries[0];
  let changedAt = latest.date;
  let previousPrice = null;
  for (const entry of entries.slice(1)) {
    if (entry.unitPrice !== latest.unitPrice) { previousPrice = entry.unitPrice; break; }
    changedAt = entry.date;
  }
  const listPrice = entries.find((entry) => entry.listPrice !== null)?.listPrice ?? null;
  const highest = entries.reduce((best, entry) => (entry.unitPrice > best.unitPrice ? entry : best), latest);
  return { latest, changedAt, previousPrice, listPrice, highest, count: entries.length };
}

export function companyNameKey(value) {
  return companyKey(value);
}

export function textKey(value) {
  return comparisonKey(value);
}
