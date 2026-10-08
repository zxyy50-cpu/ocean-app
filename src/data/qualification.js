// Five-dimension customer screening (1–5 each, 25 max): decide who deserves visit time.
export const QUALIFICATION_ITEMS = Object.freeze([
  { key: "scale", label: "客戶規模", question: "年營收、員工人數、檢驗量有多大？", basis: "規模越大、需求越穩定分數越高" },
  { key: "decision", label: "決策層級", question: "能接觸到決策者嗎？", basis: "能直達拍板者 5 分；只有承辦窗口 1–2 分" },
  { key: "pain", label: "痛點明確", question: "客戶說得出自己的問題嗎？", basis: "說得出具體痛點與影響 = 高分" },
  { key: "timeline", label: "時程", question: "有明確的評估或採購時間點嗎？", basis: "有日期節點高分；「再看看」低分" },
  { key: "budget", label: "預算", question: "預算編列了嗎？", basis: "已編列且金額明確 5 分" },
]);

export function qualificationTotal(qualification) {
  if (!qualification) return null;
  const scores = QUALIFICATION_ITEMS.map(({ key }) => Number(qualification[key]) || 0);
  if (!scores.some(Boolean)) return null;
  return scores.reduce((sum, value) => sum + value, 0);
}

export function qualificationTier(total) {
  if (total === null || total === undefined) return null;
  if (total >= 16) return { tier: "A", label: "A 級：值得本月投入拜訪", tone: "ok" };
  if (total >= 10) return { tier: "B", label: "B 級：持續培養，補齊缺的分數", tone: "accent" };
  return { tier: "C", label: "C 級：養名單即可，用資料或電子報維繫", tone: "neutral" };
}

export function validateQualification(input = {}) {
  const values = {};
  const errors = {};
  for (const { key, label } of QUALIFICATION_ITEMS) {
    const raw = input[key];
    if (raw === "" || raw === undefined || raw === null) { values[key] = null; continue; }
    const number = Number(raw);
    if (!Number.isInteger(number) || number < 1 || number > 5) errors[key] = `${label}請給 1 到 5 分`;
    else values[key] = number;
  }
  if (!Object.keys(errors).length && QUALIFICATION_ITEMS.every(({ key }) => values[key] === null)) errors._ = "至少替一個項目打分";
  return { ok: !Object.keys(errors).length, values, errors };
}

export async function saveQualification(db, customerId, input, requestId, today) {
  const validation = validateQualification(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.update("customer", customerId, { qualification: { ...validation.values, scoredAt: today } }, requestId);
}
