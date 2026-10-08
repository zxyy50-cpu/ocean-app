import { comparisonKey } from "../core/text.js";

// Find the cause first, then choose the response — each kind of doubt needs a different move.
export const OBJECTION_TYPES = Object.freeze([
  {
    id: "price", label: "價格", cause: "比價壓力、怕買貴",
    strategy: "拆解總成本：不只看單價，算進重驗、人力、放行延遲與報廢的成本",
    example: "「單價高一點，但每批提早一天放行，一個月可以少壓多少庫存？」",
  },
  {
    id: "technical", label: "技術", cause: "不熟悉、怕導入失敗或結果不準",
    strategy: "讓「別人成功過」替你說話：同業案例、比對數據、安排試用",
    example: "「我們先用貴司的樣品做兩週平行比對，數據出來再決定。」",
  },
  {
    id: "people", label: "人", cause: "決策風險：選錯要負責",
    strategy: "降低決策者個人風險：給他能直接向上交代的簡報與數據",
    example: "「我整理一頁評估摘要，讓您跟廠長報告時直接用。」",
  },
  {
    id: "timeline", label: "時程", cause: "人力不足、怕做不完、怕影響產線",
    strategy: "分階段：先從一條線或一個項目開始，成功再擴大",
    example: "「第一期只換沙門氏菌，其他項目維持原方法，三個月後再檢討。」",
  },
]);

// "太貴了" is a conclusion; these are the comparisons hidden inside it.
export const PRICE_QUESTIONS = Object.freeze([
  { axis: "價格", question: "您是跟哪一家、哪個規格比較？" },
  { axis: "成本", question: "只看採購價，還是含人力、耗材、重驗？" },
  { axis: "時效", question: "早一天出結果、早一天放行，對您值多少？" },
  { axis: "品質", question: "偽陽性或重驗一次的成本大概多少？" },
  { axis: "服務", question: "出問題時，當天有人到場和隔天才回覆差在哪？" },
  { axis: "法規", question: "方法是否符合公告或客戶稽核要求？換掉的風險呢？" },
  { axis: "品牌", question: "您向上報告時，哪個品牌比較好交代？" },
  { axis: "風險", question: "如果選錯了，代價由誰承擔？" },
]);

export const OBJECTION_REACTIONS = Object.freeze(["價格考量", "已有供應商", "需要評估"]);

export function objectionNote(type, detail = "") {
  const item = OBJECTION_TYPES.find((entry) => entry.id === type);
  return `【客戶疑問】（${item ? item.label : "疑慮"}）${detail}`;
}

// Matching "常見疑慮 / 建議回應" rows from the product knowledge base.
export function toolkitObjections(toolkit = [], { query = "", tags = [] } = {}) {
  const keys = [query, ...tags].map(comparisonKey).filter((key) => key.length >= 2);
  return toolkit.filter((item) => item.objection && item.answer)
    .map((item) => {
      const haystack = comparisonKey([item.name, item.category, item.objection, ...item.keywords].join(" "));
      return { item, score: keys.reduce((sum, key) => sum + (haystack.includes(key) ? 1 : 0), 0) };
    })
    .filter(({ score }) => !keys.length || score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(({ item }) => item);
}
