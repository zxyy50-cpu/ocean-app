import { isDateOnly } from "../core/dates.js";
import { cleanText } from "../core/text.js";
import { negotiationWarnings } from "./negotiation.js";

export const ROLES = Object.freeze(["拍板者", "使用者", "採購者", "指導者"]);
export const ROLE_HINTS = Object.freeze({
  拍板者: "在意效益、風險與策略；用成果和數字跟他談",
  使用者: "在意操作和解決痛點；安排試用最有效",
  採購者: "在意價格、合約與合規；文件一次備齊",
  指導者: "提供內部情報與時機；先幫他贏，他才幫你",
});
export const INFLUENCE = Object.freeze(["高", "中", "低"]);
export const STANCES = Object.freeze(["需要", "無意見", "不需要"]);
export const RELATIONS = Object.freeze(["友好", "普通", "敵對"]);

export const ENV_FIELDS = Object.freeze([
  { key: "consensus", label: "決策者共識", hint: "各關鍵人態度一致嗎？分歧在預算、需求還是品牌？", example: "品保經理與廠長都支持，採購還在確認預算" },
  { key: "timeline", label: "時程", hint: "評估、試用、決策各在什麼時候？", example: "11 月試用、12 月決策、明年 Q1 下單" },
  { key: "budget", label: "預算", hint: "年度預算還是臨時預算？哪個部門出？大約多少？", example: "品保部年度耗材預算約 30 萬，需控制在 25 萬內" },
  { key: "process", label: "採購流程", hint: "要比價或投標嗎？誰簽核？可以先試用嗎？", example: "需三家比價，品保經理提出、廠長核准、採購下單" },
  { key: "competitors", label: "競爭對手", hint: "現用哪家？他們的優勢？客戶想換還是想維持？", example: "現用 3M，價格便宜；我方主打出結果快一天" },
]);

const VAGUE_WORDS = ["尚未決定", "未定", "不確定", "不知道", "近期", "很快", "下半年", "有預算", "預算充足", "依公司流程", "有幾家", "再看看", "待確認"];

// "Fuzzy information is no information": empty or short vague answers get flagged.
export function vagueness(value) {
  const text = cleanText(value);
  if (!text) return "empty";
  if (text.length <= 12 && VAGUE_WORDS.some((word) => text.includes(word))) return "vague";
  return null;
}

export function normalizeEnv(input = {}) {
  return Object.fromEntries(ENV_FIELDS.map(({ key }) => [key, String(input[key] ?? "").trim()]));
}

export function validateStakeholder(input = {}) {
  const values = {
    opportunityId: cleanText(input.opportunityId), customerId: cleanText(input.customerId), contactId: cleanText(input.contactId),
    name: cleanText(input.name), title: cleanText(input.title), role: cleanText(input.role), influence: cleanText(input.influence),
    stance: cleanText(input.stance), relation: cleanText(input.relation), personalWin: cleanText(input.personalWin),
    companyWin: cleanText(input.companyWin), notes: String(input.notes ?? "").trim(),
  };
  const errors = {};
  if (!values.opportunityId) errors.opportunityId = "缺少商機";
  if (!values.name) errors.name = "請選擇聯絡人或輸入姓名";
  if (!ROLES.includes(values.role)) errors.role = "請選擇角色";
  if (values.influence && !INFLUENCE.includes(values.influence)) errors.influence = "影響力不正確";
  if (values.stance && !STANCES.includes(values.stance)) errors.stance = "看法不正確";
  if (values.relation && !RELATIONS.includes(values.relation)) errors.relation = "關係不正確";
  return { ok: !Object.keys(errors).length, values, errors };
}

export async function saveStakeholder(db, input, { id = null, requestId } = {}) {
  const validation = validateStakeholder(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const opportunity = await tx.get("opportunity", validation.values.opportunityId);
    if (!opportunity) tx.fail("not-found");
    const values = { ...validation.values, customerId: opportunity.customerId };
    if (id) return tx.update("stakeholder", id, values);
    return tx.create("stakeholder", values);
  });
}

export function archiveStakeholder(db, id, requestId) {
  return db.archive("stakeholder", id, "不再參與此案", requestId);
}

export function saveCaseEnv(db, opportunityId, env, requestId) {
  return db.update("opportunity", opportunityId, { caseEnv: normalizeEnv(env) }, requestId);
}

export function validateAction(input = {}) {
  const errors = {};
  if (!cleanText(input.title)) errors.title = "請寫出具體動作（用動詞開頭）";
  else if (/^(持續|保持|繼續)?(追蹤|關心|聯繫|跟進)$/.test(cleanText(input.title))) errors.title = "「持續追蹤」不是行動；請寫成「10/25 前完成試用報告並寄給廠長」這種具體動作";
  if (!isDateOnly(input.dueDate)) errors.dueDate = "沒有期限的行動永遠不會發生，請選日期";
  return { ok: !Object.keys(errors).length, errors };
}

export async function addAction(db, input, requestId) {
  const validation = validateAction(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const opportunity = await tx.get("opportunity", input.opportunityId);
    if (!opportunity) tx.fail("not-found");
    return tx.create("reminder", {
      customerId: opportunity.customerId, opportunityId: opportunity.id, activityId: "", title: cleanText(input.title),
      kind: "行動", dueDate: input.dueDate, status: "待辦", completedAt: null, completedByActivityId: "",
      contactId: cleanText(input.contactId), method: cleanText(input.method), owner: cleanText(input.owner) || "我",
    });
  });
}

export function opportunityContext(model, opportunity) {
  const stakeholders = (model.stakeholdersByOpportunity?.get(opportunity.id) || []);
  const actions = (model.remindersByOpportunity?.get(opportunity.id) || []).filter((reminder) => reminder.status !== "完成");
  return { stakeholders, actions };
}

// The "red asterisks": biggest risks and information gaps for this case.
export function caseRedFlags(model, opportunity, today) {
  if (!["接觸", "提案", "議價"].includes(opportunity.stage)) return [];
  const { stakeholders, actions } = opportunityContext(model, opportunity);
  const flags = [];
  const deciders = stakeholders.filter((person) => person.role === "拍板者");
  if (!stakeholders.length) flags.push({ code: "no-people", level: "red", text: "還沒標記任何關鍵人物", hint: "先列出拍板者、使用者、採購者與指導者各是誰" });
  else {
    if (!deciders.length) flags.push({ code: "no-decider", level: "red", text: "不知道誰拍板", hint: "問：「這次評估，最後是由哪些單位一起決定？」" });
    if (deciders.some((person) => person.stance === "不需要")) flags.push({ code: "decider-against", level: "red", text: "拍板者還不覺得需要", hint: "下一步不是報價，是替拍板者創造有感的價值（效益、風險、數字）" });
    if (stakeholders.some((person) => person.relation === "敵對")) flags.push({ code: "hostile", level: "warn", text: `有敵對窗口：${stakeholders.filter((person) => person.relation === "敵對").map((person) => person.name).join("、")}`, hint: "了解他的 Personal Win，或找能降低他風險的做法" });
    if (stakeholders.length === 1) flags.push({ code: "single-thread", level: "warn", text: "只靠單一窗口", hint: "至少經營三個窗口交叉驗證，避免只聽到對方希望你聽到的版本" });
    if (!stakeholders.some((person) => person.role === "指導者")) flags.push({ code: "no-coach", level: "warn", text: "還沒有指導者（Coach）", hint: "秘書、工程師、採購助理都可能是 Coach——先給價值，再談請求" });
    if (stakeholders.some((person) => !person.stance)) flags.push({ code: "unknown-stance", level: "info", text: "有人的看法還不清楚", hint: "標記每個人對此案是需要、無意見還是不需要" });
  }
  const env = opportunity.caseEnv || {};
  const fuzzy = ENV_FIELDS.filter(({ key }) => vagueness(env[key]));
  if (fuzzy.length) flags.push({ code: "fuzzy-env", level: fuzzy.length >= 3 ? "warn" : "info", text: `案件環境待補：${fuzzy.map(({ label }) => label).join("、")}`, hint: "模糊的資訊等於沒有資訊；「不確定」也要寫成不確定什麼、何時、由誰確認" });
  const dated = actions.filter((action) => isDateOnly(action.dueDate));
  if (!dated.length && !(opportunity.reminderDate && opportunity.reminderDate >= today)) flags.push({ code: "no-next-step", level: "red", text: "沒有具體下一步", hint: "沒有 Next Step 就沒有成交：寫一個有對象、有負責人、有期限的行動" });
  else if (dated.every((action) => action.dueDate < today) && !(opportunity.reminderDate && opportunity.reminderDate >= today)) flags.push({ code: "stale-actions", level: "warn", text: "行動計畫都已過期", hint: "更新行動或標記完成" });
  if (opportunity.stage === "議價") {
    negotiationWarnings(opportunity.negotiation || {}, "議價").filter((warning) => warning.level === "red")
      .forEach((warning, index) => flags.push({ code: `negotiation-${index}`, level: "red", text: `談判：${warning.text}`, hint: warning.hint }));
  }
  return flags;
}

export function caseCompleteness(model, opportunity) {
  const { stakeholders, actions } = opportunityContext(model, opportunity);
  const env = opportunity.caseEnv || {};
  const checks = [
    ...ENV_FIELDS.map(({ key }) => !vagueness(env[key])),
    stakeholders.some((person) => person.role === "拍板者"),
    stakeholders.length >= 2,
    stakeholders.some((person) => person.role === "指導者"),
    stakeholders.length > 0 && stakeholders.every((person) => person.stance && person.relation),
    stakeholders.some((person) => person.personalWin || person.companyWin),
    actions.some((action) => isDateOnly(action.dueDate)),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// Late-stage cases (proposal / negotiation) whose biggest risks are still open, biggest amount first.
export function riskyCases(model, today, limit = 5) {
  return model.openOpportunities
    .filter((opportunity) => ["提案", "議價"].includes(opportunity.stage) && !model.customersById.get(opportunity.customerId)?.archivedAt)
    .map((opportunity) => ({ opportunity, flags: caseRedFlags(model, opportunity, today).filter((flag) => flag.level === "red") }))
    .filter((item) => item.flags.length)
    .sort((left, right) => (Number(right.opportunity.amount) || 0) - (Number(left.opportunity.amount) || 0))
    .slice(0, limit);
}