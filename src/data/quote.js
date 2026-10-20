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
    return { code, name: product.name, nameZh: product.nameZh, spec: product.spec, unit: product.unit, brand: product.brand, ...list, discontinued: /停產/.test(product.spec) };
  }
  // Bought before but missing from the catalog: what the history knows.
  const entry = reference.history.find((item) => item.code === code);
  return entry ? { code, name: entry.name, nameZh: "", spec: entry.spec, unit: entry.unit, brand: "", ...historyListPrice(reference, code), discontinued: false, notInCatalog: true } : null;
}

export function quoteCandidates(reference, query, limit = 8) {
  return productCandidates(query, reference, "", limit).map((candidate) => quoteProduct(reference, candidate.code)).filter(Boolean);
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
