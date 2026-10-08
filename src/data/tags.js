import { canonicalLabel, comparisonKey, splitList, uniqueList } from "../core/text.js";

export const DEFAULT_MY_AREAS = Object.freeze(["雲林", "嘉義", "高雄", "屏東"]);
export const UNCLASSIFIED_AREA = "未分類區域";

// Sub-areas roll up to a parent so that choosing "嘉義" also finds 民雄工業區.
export const AREA_PARENTS = Object.freeze({
  斗六工業區: "雲林", 斗六: "雲林", 虎尾: "雲林", 麥寮: "雲林", 北港: "雲林",
  民雄工業區: "嘉義", 嘉太工業區: "嘉義", 民雄: "嘉義", 朴子: "嘉義", 太保: "嘉義",
  屏東農科園區: "屏東", 屏南工業區: "屏東", 內埔: "屏東",
  路竹: "高雄", 岡山: "高雄", 仁武: "高雄", 大寮: "高雄", 楠梓: "高雄",
});

const PRODUCT_CODE = /^(1TMO|BBL|DIF|CM|[A-Z]{2,4}\d{3,})/i;
const INDUSTRY_WORDS = ["食品", "乳品", "牧場", "化妝品", "肉品", "禽肉", "蛋品", "藥品", "健康食品", "學校", "研究", "水產", "寵物", "飼料", "醫院", "檢驗", "生技", "調理", "飲料", "烘焙", "農產"];

export function canonicalArea(value) {
  return canonicalLabel(value).replace(/(縣|市)$/u, "");
}

export function areaFamily(value) {
  const area = canonicalArea(value);
  const parent = AREA_PARENTS[area];
  return parent ? [area, parent] : [area];
}

export function normalizeAreas(values) {
  return uniqueList(splitList(values).map(canonicalArea));
}

export function classifyLooseTags(values = []) {
  const result = { industryTags: [], productTags: [], segmentTags: [] };
  for (const raw of splitList(values)) {
    if (/^\d+$/.test(raw)) continue;
    if (PRODUCT_CODE.test(raw)) result.productTags.push(raw);
    else if (INDUSTRY_WORDS.some((word) => raw.includes(word))) result.industryTags.push(raw);
    else result.segmentTags.push(raw);
  }
  return {
    industryTags: uniqueList(result.industryTags),
    productTags: uniqueList(result.productTags),
    segmentTags: uniqueList(result.segmentTags),
  };
}

export function customerInAreas(customer, areas = []) {
  const wanted = new Set(areas.map((area) => comparisonKey(canonicalArea(area))));
  if (!wanted.size) return false;
  return (customer.areaTags || []).some((tag) => areaFamily(tag).some((area) => wanted.has(comparisonKey(area))));
}

export function partitionByMyAreas(customers = [], myAreas = DEFAULT_MY_AREAS) {
  const mine = [];
  const others = [];
  const unclassified = [];
  for (const customer of customers) {
    if (!(customer.areaTags || []).length) unclassified.push(customer);
    else if (customerInAreas(customer, myAreas)) mine.push(customer);
    else others.push(customer);
  }
  return { mine, others, unclassified };
}

export function areaOptions(customers = [], myAreas = DEFAULT_MY_AREAS) {
  const counts = new Map();
  for (const customer of customers) {
    for (const tag of customer.areaTags || []) {
      const area = canonicalArea(tag);
      if (area) counts.set(area, (counts.get(area) || 0) + 1);
    }
  }
  const myKeys = new Set(myAreas.map((area) => comparisonKey(area)));
  const isMine = (area) => areaFamily(area).some((value) => myKeys.has(comparisonKey(value)));
  const toOption = ([area, count]) => ({ area, count, mine: isMine(area), parent: AREA_PARENTS[area] || null });
  const sorted = [...counts.entries()].map(toOption).sort((left, right) => right.count - left.count || left.area.localeCompare(right.area, "zh-Hant"));
  for (const area of myAreas) if (!counts.has(canonicalArea(area))) sorted.unshift({ area: canonicalArea(area), count: 0, mine: true, parent: null });
  return { mine: sorted.filter((option) => option.mine), others: sorted.filter((option) => !option.mine) };
}
