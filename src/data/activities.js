import { addDays, addWorkdays, isDateOnly } from "../core/dates.js";
import { cleanText } from "../core/text.js";
import { createOpportunityIn, updateOpportunityIn, validateOpportunity } from "./opportunities.js";
import { validateContact } from "./customers.js";

export const NOTE_PROMPTS = Object.freeze([
  { label: "需求", text: "【需求】" },
  { label: "現用產品／方法", text: "【目前使用】" },
  { label: "疑問", text: "【客戶疑問】" },
  { label: "競品", text: "【競品／原供應商】" },
  { label: "決策者", text: "【決策者／採購流程】" },
  { label: "預算與時程", text: "【預算與時程】" },
  { label: "下一步", text: "【下一步】" },
]);

// Prompt groups insert a heading plus the question to ask, so the answer is typed right after it.
export const PROMPT_GROUPS = Object.freeze([
  { id: "sections", label: "段落", prompts: NOTE_PROMPTS },
  { id: "spin", label: "SPIN 提問", tip: "順序很重要：S 別問太多，不要跳過 I 直接推方案", prompts: [
    { label: "S 現況", text: "【S 現況】（目前用什麼方法驗？每月大約多少樣品？誰在做？）" },
    { label: "P 問題", text: "【P 問題】（現在的方法哪裡最困擾？出結果太慢、偽陽性、人力不夠，還是成本？）" },
    { label: "I 影響", text: "【I 影響】（結果晚一天，對放行、出貨或客訴有什麼影響？一個月因此多花多少時間或錢？）" },
    { label: "N 價值", text: "【N 價值】（如果能提早一天出結果，對你們最大的幫助是什麼？）" },
  ] },
  { id: "root", label: "根本需求", tip: "客戶說出口的往往是解法，不是問題", prompts: [
    { label: "為什麼是現在", text: "【為什麼是現在】（是什麼契機讓貴司現在開始評估？）" },
    { label: "不處理的影響", text: "【不處理的影響】（如果這次沒處理，對貴司會有什麼影響？）" },
    { label: "誰一起決定", text: "【誰一起決定】（這次評估最後由哪些單位一起決定？）" },
  ] },
  { id: "executive", label: "高階四軸", tip: "見老闆：30 分鐘內、問題不超過 6 個、最後 5 分鐘談下一步", prompts: [
    { label: "時間", text: "【時間】（從收樣到放行目前要多久？哪一段最容易卡？）" },
    { label: "成本", text: "【成本】（檢驗人力和耗材，哪一塊的壓力最大？）" },
    { label: "品質", text: "【品質】（過去一年有沒有和微生物相關的客訴、退貨或重工？）" },
    { label: "創新", text: "【創新】（未來三年想擴線、拿新認證或打新市場嗎？）" },
  ] },
]);

export const PREP_QUESTIONS = Object.freeze([
  { key: "pain", label: "他們現在最頭痛的是什麼？" },
  { key: "keyPerson", label: "今天在場誰最關鍵？" },
  { key: "commitment", label: "我要帶走什麼承諾？" },
]);

const FOLLOW_UP_CHANNELS = new Set(["親訪", "視訊", "展覽／研討會"]);

// Only face-to-face meetings and demos earn a recap email and a key-person check;
// a quick phone or LINE follow-up would just pile up reminders.
export function suggestsPostVisitActions(input = {}) {
  return FOLLOW_UP_CHANNELS.has(input.channel) || String(input.purpose || "").includes("Demo");
}

export function postVisitActions(activityDate) {
  const recap = addWorkdays(activityDate, 1);
  return [
    { title: "寄會後信（LOU）：挑戰、原因、現況、方案、下一步", kind: "會後信", dueDate: recap },
    { title: "確認關鍵人物看法、與 Coach 核對案況", kind: "行動", dueDate: addWorkdays(recap, 1) },
  ];
}

export const REMINDER_PRESETS = Object.freeze([
  { label: "明天", days: 1 }, { label: "3 天後", days: 3 }, { label: "下週", days: 7 }, { label: "2 週後", days: 14 }, { label: "1 個月後", days: 30 }, { label: "3 個月後", days: 90 },
]);

const NEXT_ACTION_KIND = [["拜訪", "拜訪"], ["Demo", "拜訪"], ["報價", "報價"], ["送樣", "送樣"]];

export function reminderKindFor(nextAction = "") {
  return NEXT_ACTION_KIND.find(([word]) => nextAction.includes(word))?.[1] || "追蹤";
}

export function insertPrompt(note = "", prompt = "", position = note.length) {
  const before = note.slice(0, position);
  const after = note.slice(position);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const inserted = `${prefix}${prompt}`;
  return { value: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}

export function summarize(input) {
  const firstLine = String(input.detailedNote || "").split("\n").map((line) => line.replace(/^【[^】]*】/, "").trim()).find(Boolean) || "";
  const labels = [input.channel, input.purpose, input.result].filter(Boolean).join("・");
  return (firstLine ? firstLine.slice(0, 60) : labels) || "拜訪紀錄";
}

export function normalizePrep(input = {}) {
  const prep = Object.fromEntries([...PREP_QUESTIONS.map(({ key }) => key), "attendees"].map((key) => [key, cleanText(input[`prep.${key}`] ?? input.prep?.[key])]));
  return Object.values(prep).some(Boolean) ? prep : null;
}

export function presetDate(today, days) {
  return addWorkdays(today, days);
}

export function validateVisit(input = {}, { today } = {}) {
  const errors = {};
  if (!cleanText(input.customerId)) errors.customerId = "請先選擇客戶";
  if (!String(input.detailedNote || "").trim()) errors.detailedNote = "請寫下這次拜訪的完整紀錄";
  if (!cleanText(input.channel)) errors.channel = "請選擇拜訪方式";
  if (!isDateOnly(input.activityDate)) errors.activityDate = "請選擇拜訪日期";
  else if (today && input.activityDate > addDays(today, 1)) errors.activityDate = "拜訪日期不能是未來";
  if (input.followUpMode !== "none") {
    if (!isDateOnly(input.nextFollowUpDate)) errors.nextFollowUpDate = "請選擇下次提醒日期，或勾選「不需提醒」";
    else if (today && input.nextFollowUpDate < today) errors.nextFollowUpDate = "提醒日期不能早於今天";
  }
  if (input.opportunityAction === "create") {
    const result = validateOpportunity({ customerId: input.customerId, name: input.opportunityName, product: input.opportunityProduct, stage: input.opportunityStage, amount: input.opportunityAmount, probability: input.opportunityProbability, expectedCloseDate: input.opportunityCloseDate, lostReason: input.opportunityLostReason });
    Object.entries(result.errors).forEach(([key, message]) => { errors[`opportunity.${key}`] = message; });
  }
  if (input.opportunityAction === "update" && !cleanText(input.opportunityId)) errors["opportunity.id"] = "請選擇要更新的商機";
  if (input.contactId === "__new" && !validateContact({ name: input.newContactName }).ok) errors.newContactName = "請輸入新聯絡人姓名";
  return { ok: !Object.keys(errors).length, errors };
}

// One transaction: activity, optional opportunity, reminder and customer timeline all succeed together.
export async function saveVisit(db, input, { requestId, today } = {}) {
  const validation = validateVisit(input, { today });
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const customer = await tx.get("customer", input.customerId);
    if (!customer || customer.archivedAt) tx.fail("validation", { errors: { customerId: "客戶不存在或已封存" } });
    let contactId = cleanText(input.contactId);
    if (contactId === "__new") {
      const contact = await tx.create("contact", { ...validateContact({ name: input.newContactName, title: input.newContactTitle }).values, customerId: customer.id, isPrimary: false });
      contactId = contact.id;
    }
    const nextFollowUpDate = input.followUpMode === "none" ? "" : input.nextFollowUpDate;
    const nextAction = cleanText(input.nextAction);
    let opportunityId = "";
    if (input.opportunityAction === "create") {
      const opportunity = await createOpportunityIn(tx, {
        customerId: customer.id, contactId, name: input.opportunityName, product: input.opportunityProduct, stage: input.opportunityStage,
        amount: input.opportunityAmount, probability: input.opportunityProbability, expectedCloseDate: input.opportunityCloseDate,
        nextAction, reminderDate: nextFollowUpDate, lostReason: input.opportunityLostReason,
      }, { source: "拜訪" });
      opportunityId = opportunity.id;
    } else if (input.opportunityAction === "update") {
      const patch = { nextAction, reminderDate: nextFollowUpDate };
      if (input.opportunityStage) patch.stage = input.opportunityStage;
      if (String(input.opportunityAmount ?? "").trim() !== "") patch.amount = input.opportunityAmount;
      if (String(input.opportunityProbability ?? "").trim() !== "") patch.probability = input.opportunityProbability;
      if (input.opportunityCloseDate) patch.expectedCloseDate = input.opportunityCloseDate;
      if (input.opportunityLostReason) patch.lostReason = input.opportunityLostReason;
      if (cleanText(input.opportunityProduct)) patch.product = cleanText(input.opportunityProduct);
      const current = await tx.get("opportunity", input.opportunityId);
      if (!current || current.customerId !== customer.id) tx.fail("validation", { errors: { "opportunity.id": "這個商機不屬於此客戶" } });
      // The person met becomes the case's contact when it has none yet.
      if (contactId && !current.contactId) patch.contactId = contactId;
      opportunityId = (await updateOpportunityIn(tx, input.opportunityId, patch)).id;
    }
    const activity = await tx.create("activity", {
      customerId: customer.id, contactId, opportunityId, activityDate: input.activityDate,
      channel: cleanText(input.channel), purpose: cleanText(input.purpose), reaction: cleanText(input.reaction), result: cleanText(input.result),
      detailedNote: String(input.detailedNote), summary: summarize(input), nextAction, nextFollowUpDate,
      prep: normalizePrep(input), nextContactHint: cleanText(input.nextContactHint),
    });
    const postVisit = [];
    if (input.postVisitActions === "yes" || input.postVisitActions === true) {
      for (const action of postVisitActions(input.activityDate)) {
        postVisit.push(await tx.create("reminder", { customerId: customer.id, opportunityId, activityId: activity.id, ...action, status: "待辦", completedAt: null, completedByActivityId: "", contactId: "", method: "", owner: "我" }));
      }
    }
    let reminder = null;
    if (nextFollowUpDate) {
      reminder = await tx.create("reminder", { customerId: customer.id, opportunityId, activityId: activity.id, title: nextAction || "追蹤客戶", kind: reminderKindFor(nextAction), dueDate: nextFollowUpDate, status: "待辦", completedAt: null, completedByActivityId: "" });
    }
    if (input.reminderId) {
      const source = await tx.get("reminder", input.reminderId);
      if (source && source.status !== "完成") await tx.update("reminder", source.id, { status: "完成", completedAt: tx.now(), completedByActivityId: activity.id });
    }
    const lastContactAt = !customer.lastContactAt || input.activityDate > customer.lastContactAt ? input.activityDate : customer.lastContactAt;
    await tx.update("customer", customer.id, { lastContactAt, nextAction, nextFollowUpDate });
    return { activity, reminder, opportunityId, postVisit };
  });
}
