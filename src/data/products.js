import { comparisonKey } from "../core/text.js";
import { snippet } from "./search.js";

// "bioMérieux VIDAS／mini VIDAS 全自動免疫螢光分析平台": brand first, then the product name.
export function productLabel(item) {
  return [item?.brand, item?.name].filter(Boolean).join(" ");
}

export function productOptions(toolkit = []) {
  return [...new Set(toolkit.map(productLabel).filter(Boolean))];
}

// The knowledge-base product a note talks about, matched by its name, code or sales nicknames.
export function matchProduct(toolkit = [], text = "") {
  const key = comparisonKey(text);
  if (!key) return null;
  let best = null;
  for (const item of toolkit) {
    // Besides the full name, its English parts ("RIDA CHECK" in "RIDA CHECK 蛋白質檢測塗抹棒")
    // and long single words ("HygieneChek") are how people actually say it.
    const latin = String(item.name || "").match(/[A-Za-z][A-Za-z0-9+\- ]*[A-Za-z0-9+]/g) || [];
    const singles = latin.flatMap((part) => part.split(/\s+/)).filter((word) => word.length >= 6);
    const words = [item.name, item.code, ...(item.aliases || []), ...latin, ...singles].map(comparisonKey).filter((word) => word.length >= 3);
    const hit = words.filter((word) => key.includes(word)).sort((left, right) => right.length - left.length)[0];
    if (hit && (!best || hit.length > best.length)) best = { item, length: hit.length };
  }
  return best ? best.item : null;
}

// What an opportunity is about: the product (brand + name) when known, else its category.
export function opportunityTitle(opportunity, width = 34) {
  const product = String(opportunity?.product || "").trim();
  const name = String(opportunity?.name || "").trim();
  const useProduct = product && comparisonKey(product) !== comparisonKey(name);
  return snippet(useProduct ? product : name || product || "未命名商機", "", width);
}

// The category line shown under the title (e.g. 食品/化妝品快篩) when the title is the product.
export function opportunityCategory(opportunity) {
  const product = String(opportunity?.product || "").trim();
  const name = String(opportunity?.name || "").trim();
  return product && comparisonKey(product) !== comparisonKey(name) ? snippet(name, "", 24) : "";
}
