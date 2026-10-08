import { cleanText, comparisonKey, splitList } from "../core/text.js";

const INDUSTRY_FIELDS = ["最適合客戶產業", "適合產業", "成交案例／適合客戶", "客戶價值／賣點", "適用情境／賣點"];

const FABE_SOURCES = Object.freeze({
  F: ["核心優勢（最重要）", "產品型態", "規格／速度", "啟新推薦產品"],
  A: ["比競品好在哪裡", "價格競爭力", "產品定位"],
  B: ["客戶最常買的理由", "客戶價值／賣點", "適用情境／賣點", "主要用途／解決問題"],
  E: ["建議回應／證明資料", "法規／方法／認證依據", "TFDA公告方法／定位", "公告方法／文號", "官方來源", "來源依據", "成交案例／適合客戶"],
});

// Feature → Advantage → Benefit → Evidence, assembled from existing knowledge-base columns.
export function buildFabe(raw = {}) {
  const pick = (fields) => fields.map((field) => cleanText(raw[field])).find(Boolean) || "";
  const fabe = Object.fromEntries(Object.entries(FABE_SOURCES).map(([key, fields]) => [key, pick(fields)]));
  return Object.values(fabe).filter(Boolean).length >= 2 ? fabe : null;
}

export function normalizeToolkit(items = []) {
  return items.map((item) => {
    const raw = item.raw || {};
    return {
      id: item.id,
      name: cleanText(item.name || raw["產品名稱"] || raw["產品包"] || raw["啟新推薦產品"]),
      category: cleanText(item.category || raw["產品大類"]),
      summary: cleanText(item.summary || raw["核心優勢（最重要）"] || raw["主要用途／解決問題"]),
      pitch: cleanText(raw["一句話銷售話術"]),
      dm: cleanText(raw["DM來源"] || raw["建議攜帶DM"]),
      keywords: splitList([...INDUSTRY_FIELDS.map((field) => raw[field]), raw["業務俗稱／關鍵字"], item.category].filter(Boolean).join("、")),
      fabe: buildFabe(raw),
      objection: cleanText(raw["客戶常見疑慮"]),
      answer: cleanText(raw["建議回應／證明資料"]),
      source: item.provenance?.[0]?.sourceSheet || "",
      raw,
    };
  }).filter((item) => item.name);
}

export function recommendToolkit(customer, toolkit = [], limit = 3) {
  const interests = [...(customer.industryTags || []), ...(customer.productTags || []), ...(customer.segmentTags || [])].map(comparisonKey).filter((key) => key.length >= 2);
  if (!interests.length) return [];
  return toolkit.map((item) => {
    const haystack = comparisonKey([item.name, item.category, item.summary, ...item.keywords].join(" "));
    const score = interests.reduce((sum, key) => sum + (haystack.includes(key) ? 2 : 0) + (item.keywords.some((word) => key.includes(comparisonKey(word)) && comparisonKey(word).length >= 2) ? 1 : 0), 0);
    return { item, score };
  }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score).slice(0, limit).map(({ item }) => item);
}

export function searchToolkit(toolkit = [], query = "") {
  const key = comparisonKey(query);
  if (!key) return toolkit;
  return toolkit.filter((item) => comparisonKey([item.name, item.category, item.summary, item.pitch, ...item.keywords].join(" ")).includes(key));
}
