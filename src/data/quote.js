import { comparisonKey } from "../core/text.js";
import { productCandidates } from "./order-intake.js";
import { priceStory } from "./order-reference.js";

// 產品報價: look a product up by code or name in 商品清單 and copy it for the customer as
//   CMP0100131
//   BAP/MacConkey Agar
//   90 mm Bi, 10 PC/PKG, 40 PC/BOX
//   $2200
// The price starts at the list price (未稅定價); Ocean changes it before copying when he wants.

// 商品清單 sometimes has no 未稅定價 while the ERP does; the shipment history carries the ERP list price.
function historyListPrice(reference, code) {
  const entry = [...reference.history].filter((item) => item.code === code && item.listPrice).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return entry ? { listPrice: entry.listPrice, listSource: `購買紀錄的訂價（${String(entry.date).replaceAll("-", "/")}）` } : { listPrice: null, listSource: "" };
}

export function quoteProduct(reference, code) {
  const product = reference.products.get(code);
  if (product) {
    const list = product.listPrice ? { listPrice: product.listPrice, listSource: "" } : historyListPrice(reference, code);
    return { code, name: product.name, nameZh: product.nameZh, spec: product.spec, unit: product.unit, brand: product.brand, ...list, erpListDate: product.erpListDate || "", catalogListPrice: product.catalogListPrice ?? null, catalogUnit: product.catalogUnit || "", discontinued: /停產/.test(product.spec) };
  }
  // Bought before but missing from the catalog: what the history knows.
  const entry = reference.history.find((item) => item.code === code);
  return entry ? { code, name: entry.name, nameZh: "", spec: entry.spec, unit: entry.unit, brand: "", ...historyListPrice(reference, code), discontinued: false, notInCatalog: true } : null;
}

// 商品清單's 未稅定價 is sometimes wrong (DIF218661: 13,700 per SET while every deal is about 3,400
// a bottle). It is checked against the ERP 訂價 on shipments and against recent deals; a doubt says
// why and, when the ERP has a price, which one to quote instead. The reference already uses the ERP
// 訂價 as listPrice, so on screen only products without one are checked; { catalog: true } checks
// 商品清單's own price, for the list sent back to whoever keeps it.
const ntd = (value) => `NT$ ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const slashDate = (value) => String(value || "").replaceAll("-", "/");

export function listPriceDoubt(reference, code, { catalog = false } = {}) {
  const product = reference.products.get(code);
  // On screen the ERP 訂價 is trusted as is.
  if (!product || (!catalog && product.erpListDate)) return null;
  const list = product.erpListDate ? product.catalogListPrice : product.listPrice;
  if (!list) return null;
  const unit = product.erpListDate ? product.catalogUnit : product.unit;
  // reference.history is newest first.
  const entries = reference.history.filter((item) => item.code === code);
  const reasons = [];
  const erp = entries.find((item) => item.source === "出貨" && item.listPrice);
  const erpDiffers = erp && Math.abs(list / erp.listPrice - 1) > 0.1;
  if (erpDiffers) reasons.push(`ERP 訂價是 ${ntd(erp.listPrice)}（${slashDate(erp.date)}）`);
  const prices = entries.filter((item) => item.unitPrice > 0).slice(0, 6).map((item) => item.unitPrice);
  if (prices.length) {
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    if (list > high * 2) reasons.push(`是最近成交最高價 ${ntd(high)} 的 ${Math.round((list / high) * 10) / 10} 倍`);
    else if (list < low / 2) reasons.push(`不到最近成交最低價 ${ntd(low)} 的一半`);
  }
  if (!reasons.length) return null;
  const specUnit = (String(product.spec || "").match(/\/\s*([A-Za-z]+)\s*$/) || [])[1];
  if (specUnit && unit && specUnit.toUpperCase() !== unit.toUpperCase()) reasons.push(`規格是每 ${specUnit}，銷售單位卻是 ${unit}`);
  return { code, listPrice: list, unit, reasons, suggested: erpDiffers ? { price: erp.listPrice, source: `ERP 訂價（${slashDate(erp.date)}）` } : null };
}

// Every doubtful list price, the furthest off first, to send back to whoever keeps 商品清單.
export function listPriceDoubts(reference) {
  const doubts = [];
  for (const product of reference.productList) {
    const doubt = listPriceDoubt(reference, product.code, { catalog: true });
    if (doubt) doubts.push({ ...doubt, name: product.name, spec: product.spec });
  }
  const off = (doubt) => { const other = doubt.suggested?.price; return other ? Math.abs(Math.log(doubt.listPrice / other)) : 0; };
  return doubts.sort((left, right) => off(right) - off(left) || left.code.localeCompare(right.code));
}

export function listPriceDoubtText(doubts) {
  return doubts.map((doubt) => `${doubt.code} ${doubt.name}（${doubt.spec}）\n商品清單定價 ${ntd(doubt.listPrice)}${doubt.unit ? `／${doubt.unit}` : ""}：${doubt.reasons.join("；")}`).join("\n\n");
}

// What a new quote line starts at: the customer's last price, else the list price unless it is
// doubtful (then the ERP 訂價, or nothing so 「價格待確認」 is printed rather than a wrong number).
export function startingPrice(reference, customerNo, product) {
  const mine = customerDeal(reference, customerNo, product.code);
  if (mine) return mine.unitPrice;
  const doubt = listPriceDoubt(reference, product.code);
  return doubt ? doubt.suggested?.price ?? null : product.listPrice;
}

export function quoteCandidates(reference, query, limit = 8) {
  const codes = productCandidates(query, reference, "", limit).map((candidate) => candidate.code);
  // Sold before but missing from 商品清單 (GIB211693): still quotable from the purchase history.
  const key = comparisonKey(query);
  if (key.length >= 3) {
    for (const entry of reference.history) {
      if (codes.length >= limit) break;
      if (reference.products.has(entry.code) || codes.includes(entry.code)) continue;
      if (comparisonKey(`${entry.code} ${entry.name}`).includes(key)) codes.push(entry.code);
    }
  }
  return codes.map((code) => quoteProduct(reference, code)).filter(Boolean);
}

// The latest price each customer paid for this product, newest first.
export function recentDeals(reference, code, limit = 4) {
  const seen = new Set();
  const deals = [];
  for (const entry of [...reference.history].filter((item) => item.code === code && item.unitPrice !== null).sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    if (seen.has(entry.customerNo)) continue;
    seen.add(entry.customerNo);
    deals.push({ customerNo: entry.customerNo, customerName: entry.customerName || [...(reference.customers?.get?.(entry.customerNo)?.names || [])][0] || entry.customerNo, unitPrice: entry.unitPrice, date: entry.date });
    if (deals.length >= limit) break;
  }
  return deals;
}

export function customerDeal(reference, customerNo, code) {
  if (!customerNo) return null;
  const story = priceStory(reference, customerNo, code);
  return story ? { unitPrice: story.latest.unitPrice, date: story.latest.date } : null;
}

function plainPrice(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 100) / 100);
}

export function quoteLines(item) {
  const price = plainPrice(item.price);
  return [item.code, item.name, item.spec, price ? `$${price}` : "$（價格待確認）"].filter(Boolean);
}

export function quoteText(items) {
  return items.map((item) => quoteLines(item).join("\n")).join("\n\n");
}
