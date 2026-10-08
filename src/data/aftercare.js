import { addDays } from "../core/dates.js";

// Signing and delivery checks: each one protects both sides — and the next order.
export const SIGN_ITEMS = Object.freeze([
  { key: "payment", label: "付款條件", hint: "票期、匯款方式確定且合理" },
  { key: "deposit", label: "訂金", hint: "訂金或支票確實收回、到位" },
  { key: "acceptance", label: "驗收標準", hint: "標準明確寫下，避免日後爭議" },
  { key: "feasibility", label: "交付可行", hint: "庫存、交期、人力是否足夠" },
  { key: "documents", label: "文件", hint: "簽名齊全，合約修改處也要簽" },
]);
export const DELIVERY_ITEMS = Object.freeze([
  { key: "install", label: "出貨／安裝", hint: "安裝細節確認、出貨單簽回" },
  { key: "collection", label: "款項", hint: "貨後支票兌現或匯款到帳" },
  { key: "training", label: "教育訓練", hint: "使用說明與教學，降低導入抗拒" },
  { key: "thanks", label: "感謝函", hint: "寄給利害關係人，高階與關鍵人物特別重要" },
  { key: "care", label: "關係管理", hint: "啟動定期經營節奏，介紹售後支援" },
]);

// After the deal: a fixed rhythm so the customer feels continuously looked after.
export const CARE_CADENCE = Object.freeze([
  { key: "thanks", title: "寄感謝函給利害關係人（高階與關鍵人物）", days: 1, repeatDays: 0 },
  { key: "needs", title: "新需求挖掘：從使用回饋、組織變動、擴廠計畫找新需求", days: 60, repeatDays: 120 },
  { key: "keyman", title: "關鍵人物拜訪：不談新單，更新產業資訊、關心使用狀況", days: 90, repeatDays: 90 },
  { key: "review", title: "成效回顧：用數據回顧導入成效，請拍板者一起參加", days: 180, repeatDays: 180 },
  { key: "referral", title: "請滿意的客戶引薦同業或上下游", days: 365, repeatDays: 365 },
]);

export function closeoutProgress(closeout = {}) {
  const items = [...SIGN_ITEMS.map((item) => closeout.sign?.[item.key]), ...DELIVERY_ITEMS.map((item) => closeout.delivery?.[item.key])];
  return { done: items.filter(Boolean).length, total: items.length };
}

export function saveCloseout(db, opportunityId, input = {}, requestId) {
  const pick = (items, group) => Object.fromEntries(items.map((item) => [item.key, input[`${group}.${item.key}`] === true || input[`${group}.${item.key}`] === "yes" || input[group]?.[item.key] === true]));
  return db.update("opportunity", opportunityId, { closeout: { sign: pick(SIGN_ITEMS, "sign"), delivery: pick(DELIVERY_ITEMS, "delivery") } }, requestId);
}

export async function startCare(db, opportunityId, today, requestId) {
  return db.transact(requestId, async (tx) => {
    const opportunity = await tx.get("opportunity", opportunityId);
    if (!opportunity) tx.fail("not-found");
    const existing = (await tx.list("reminder")).filter((reminder) => reminder.opportunityId === opportunityId && reminder.kind === "經營");
    if (existing.length) return { created: 0, existing: existing.length };
    for (const step of CARE_CADENCE) {
      await tx.create("reminder", {
        customerId: opportunity.customerId, opportunityId, activityId: "", title: step.title, kind: "經營", dueDate: addDays(today, step.days),
        status: "待辦", completedAt: null, completedByActivityId: "", contactId: "", method: "", owner: "我", repeatDays: step.repeatDays,
      });
    }
    return { created: CARE_CADENCE.length, existing: 0 };
  });
}
