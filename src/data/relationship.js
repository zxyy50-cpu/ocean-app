// Customer relationship P&L: five dimensions × five items × 1–5 points = 125.
// For cost and risk, a higher score means lower cost / lower risk.
export const RELATIONSHIP_DIMENSIONS = Object.freeze([
  { key: "contribution", label: "客戶貢獻", items: [["revenue", "年營收貢獻"], ["margin", "毛利率品質"], ["stability", "訂單穩定性"], ["expansion", "擴大採購機會"], ["payment", "付款紀律"]] },
  { key: "relation", label: "關係穩定", items: [["decider", "與決策者的關係"], ["users", "與使用端的關係"], ["trust", "客戶對我們的信任"], ["dependence", "對我們的依賴度"], ["loyalty", "不易被競品撼動"]] },
  { key: "cost", label: "合作成本（分數高＝成本低）", items: [["support", "客訴與技術支援負擔"], ["requests", "需求合理性"], ["visits", "拜訪成本"], ["pricing", "議價壓力"], ["delay", "專案延誤風險"]] },
  { key: "strategic", label: "策略價值", items: [["brand", "客戶品牌影響力"], ["showcase", "產業示範性"], ["potential", "長期合作潛力"], ["referral", "轉介紹可能性"], ["fit", "與公司策略吻合"]] },
  { key: "risk", label: "風險（分數高＝風險低）", items: [["finance", "財務健康"], ["compliance", "法務與合規"], ["industry", "產業景氣"], ["people", "決策者穩定性"], ["switching", "不易更換供應商"]] },
]);

export const RELATIONSHIP_TIERS = Object.freeze([
  { min: 90, label: "核心成長客戶", strategy: "積極投資：高層互訪、專屬資源、共同開發新應用", tone: "ok" },
  { min: 70, label: "關鍵合作客戶", strategy: "穩定成長：提高黏著度、簽長約、擴大部門滲透", tone: "accent" },
  { min: 50, label: "評估型客戶", strategy: "控制成本：標準化服務，觀察後續成長", tone: "neutral" },
  { min: 30, label: "高成本低回報客戶", strategy: "降載服務：重新協商條件，調整價格或服務範圍", tone: "warn" },
  { min: 0, label: "不值得投資客戶", strategy: "考慮退出：轉為被動接單，把資源移到高分客戶", tone: "danger" },
]);

export function normalizeRelationshipScore(input = {}) {
  const result = {};
  for (const dimension of RELATIONSHIP_DIMENSIONS) {
    result[dimension.key] = {};
    for (const [key] of dimension.items) {
      const raw = input[`${dimension.key}.${key}`] ?? input[dimension.key]?.[key];
      const number = Number(raw);
      result[dimension.key][key] = Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
    }
  }
  return result;
}

export function relationshipTotals(score) {
  if (!score) return null;
  const dimensions = Object.fromEntries(RELATIONSHIP_DIMENSIONS.map((dimension) => [dimension.key, dimension.items.reduce((sum, [key]) => sum + (Number(score[dimension.key]?.[key]) || 0), 0)]));
  const scored = RELATIONSHIP_DIMENSIONS.flatMap((dimension) => dimension.items.map(([key]) => score[dimension.key]?.[key])).filter(Boolean).length;
  if (!scored) return null;
  const total = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  return { dimensions, total, scored, complete: scored === 25, tier: RELATIONSHIP_TIERS.find((tier) => total >= tier.min) };
}

export function saveRelationshipScore(db, customerId, input, requestId, today) {
  const score = normalizeRelationshipScore(input);
  if (!relationshipTotals(score)) return Promise.resolve({ ok: false, error: "validation", errors: { _: "至少替一個項目打分" } });
  return db.update("customer", customerId, { relationshipScore: { ...score, scoredAt: today } }, requestId);
}
