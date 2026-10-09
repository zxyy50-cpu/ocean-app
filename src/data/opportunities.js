import { isDateOnly } from "../core/dates.js";
import { cleanText } from "../core/text.js";
import { LOST_REASONS, OPEN_OPPORTUNITY_STAGES, OPPORTUNITY_STAGES } from "./schema.js";

export const STAGE_DEFAULT_PROBABILITY = Object.freeze({ 接觸: 10, 提案: 30, 議價: 60, 成交: 100, 失敗: 0 });
const AMOUNT_REQUIRED_FROM = new Set(["提案", "議價", "成交"]);

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : Number.NaN;
}

export function normalizeOpportunityInput(input = {}) {
  const stage = cleanText(input.stage) || "接觸";
  const probability = optionalNumber(input.probability);
  return {
    customerId: cleanText(input.customerId),
    contactId: cleanText(input.contactId),
    name: cleanText(input.name),
    product: cleanText(input.product),
    stage,
    amount: optionalNumber(input.amount),
    probability: probability === null ? STAGE_DEFAULT_PROBABILITY[stage] ?? null : probability,
    expectedCloseDate: cleanText(input.expectedCloseDate),
    nextAction: cleanText(input.nextAction),
    reminderDate: cleanText(input.reminderDate),
    lostReason: cleanText(input.lostReason),
    notes: String(input.notes ?? "").trim(),
  };
}

// Creating only needs a name and a stage; amount becomes required once a proposal exists.
export function validateOpportunity(input = {}) {
  const values = normalizeOpportunityInput(input);
  const errors = {};
  if (!values.customerId) errors.customerId = "請選擇客戶";
  if (!values.name) errors.name = "請輸入商機名稱";
  if (!OPPORTUNITY_STAGES.includes(values.stage) || values.stage === "封存") errors.stage = "請選擇商機階段";
  if (Number.isNaN(values.amount) || (values.amount !== null && values.amount < 0)) errors.amount = "金額需為 0 以上的數字";
  else if (AMOUNT_REQUIRED_FROM.has(values.stage) && values.amount === null) errors.amount = `進入「${values.stage}」後請填預估金額`;
  if (Number.isNaN(values.probability) || (values.probability !== null && (values.probability < 0 || values.probability > 100))) errors.probability = "成交機率需介於 0 到 100";
  if (values.expectedCloseDate && !isDateOnly(values.expectedCloseDate)) errors.expectedCloseDate = "日期格式不正確";
  if (values.reminderDate && !isDateOnly(values.reminderDate)) errors.reminderDate = "日期格式不正確";
  if (values.stage === "失敗" && !values.lostReason) errors.lostReason = "請選擇未成交原因";
  if (values.lostReason && !LOST_REASONS.includes(values.lostReason)) errors.lostReason = "未成交原因不正確";
  return { ok: !Object.keys(errors).length, values, errors };
}

function closingFields(stage, previous = {}, now) {
  if (stage === "成交") return { outcome: "won", closedAt: previous.stage === "成交" && previous.closedAt ? previous.closedAt : now };
  if (stage === "失敗") return { outcome: "lost", closedAt: previous.stage === "失敗" && previous.closedAt ? previous.closedAt : now };
  return { outcome: "", closedAt: null, lostReason: "" };
}

export async function createOpportunityIn(tx, input, { source = "手動", sourceOrderItemId = "" } = {}) {
  const validation = validateOpportunity(input);
  if (!validation.ok) tx.fail("validation", { errors: validation.errors });
  const customer = await tx.get("customer", validation.values.customerId);
  if (!customer || customer.archivedAt) tx.fail("validation", { errors: { customerId: "客戶不存在或已封存" } });
  return tx.create("opportunity", { ...validation.values, source, sourceOrderItemId, priorStage: "", ...closingFields(validation.values.stage, {}, tx.now()) });
}

export async function updateOpportunityIn(tx, id, input, { expectedRev } = {}) {
  const current = await tx.get("opportunity", id);
  if (!current || current.archivedAt) tx.fail("not-found", { message: "商機不存在或已封存" });
  const validation = validateOpportunity({ ...current, ...input });
  if (!validation.ok) tx.fail("validation", { errors: validation.errors });
  const patch = Object.fromEntries(Object.entries(validation.values).filter(([key]) => key in input));
  // A stage change without an explicit probability adopts the new stage's default.
  if (!("probability" in input) && "stage" in input && input.stage !== current.stage) patch.probability = STAGE_DEFAULT_PROBABILITY[validation.values.stage] ?? current.probability;
  else if (!("probability" in input) && (current.probability === null || current.probability === undefined || current.probability === "")) patch.probability = validation.values.probability;
  if ("review" in input) patch.review = normalizeReview(input.review);
  if (validation.values.stage === "失敗" && OPEN_OPPORTUNITY_STAGES.includes(current.stage)) patch.lostAtStage = current.stage;
  if (OPEN_OPPORTUNITY_STAGES.includes(validation.values.stage) && current.lostAtStage) patch.lostAtStage = "";
  return tx.update("opportunity", id, { ...patch, ...closingFields(validation.values.stage, current, tx.now()) }, { expectedRev });
}

export function createOpportunity(db, input, requestId, options) {
  return db.transact(requestId, (tx) => createOpportunityIn(tx, input, options));
}

export function updateOpportunity(db, id, input, requestId, options) {
  return db.transact(requestId, (tx) => updateOpportunityIn(tx, id, input, options));
}

// Win/Loss review: three questions that turn every closed case into a lesson.
export const REVIEW_QUESTIONS = Object.freeze([
  { key: "decider", label: "最後是誰做的決定？依據是什麼？" },
  { key: "turningPoint", label: "我們在哪一個階段開始領先（或落後）？" },
  { key: "lesson", label: "如果重來一次，哪一個動作會改變結果？" },
]);

export function normalizeReview(review = {}) {
  const values = Object.fromEntries(REVIEW_QUESTIONS.map(({ key }) => [key, String(review?.[key] ?? "").trim()]));
  return Object.values(values).some(Boolean) ? values : null;
}

export function markWon(db, id, requestId, { amount, review, notes } = {}) {
  return updateOpportunity(db, id, { stage: "成交", probability: 100, ...(amount !== undefined ? { amount } : {}), ...(review ? { review } : {}), ...(notes !== undefined ? { notes } : {}) }, requestId);
}

export function markLost(db, id, lostReason, requestId, { review, notes } = {}) {
  return updateOpportunity(db, id, { stage: "失敗", probability: 0, lostReason, ...(review ? { review } : {}), ...(notes !== undefined ? { notes } : {}) }, requestId);
}

// A dated free-text line goes on top of the existing notes (undefined = leave notes alone).
export function prependNote(existing, text, date) {
  const line = String(text || "").trim();
  return line ? [`${date}：${line}`, String(existing || "").trim()].filter(Boolean).join("\n") : undefined;
}

export function lossReasonSummary(opportunities = []) {
  const counts = new Map();
  for (const opportunity of opportunities) {
    if (opportunity.archivedAt || opportunity.stage !== "失敗") continue;
    const reason = opportunity.lostReason || "未填原因";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count);
}

export function reopenOpportunity(db, id, stage, requestId) {
  return updateOpportunity(db, id, { stage, probability: STAGE_DEFAULT_PROBABILITY[stage] }, requestId);
}

export async function archiveOpportunity(db, id, reason, requestId) {
  return db.transact(requestId, async (tx) => {
    const current = await tx.get("opportunity", id);
    if (!current || current.archivedAt) tx.fail("not-found");
    await tx.update("opportunity", id, { priorStage: current.stage, stage: "封存" });
    const archived = await tx.archive("opportunity", id, reason);
    await tx.create("archiveEvent", { eventType: "archive", entityType: "opportunity", entityId: id, relatedIds: [current.customerId], reason: archived.archiveReason, snapshot: { name: current.name, stage: current.stage }, impactSummary: "", undoneAt: null, undoneBy: "" });
    return archived;
  });
}

export async function restoreOpportunity(db, id, requestId) {
  return db.transact(requestId, async (tx) => {
    const current = await tx.get("opportunity", id);
    if (!current || !current.archivedAt) tx.fail("not-archived");
    await tx.restore("opportunity", id);
    const restored = await tx.update("opportunity", id, { stage: current.priorStage || "接觸", priorStage: "" });
    await tx.create("archiveEvent", { eventType: "restore", entityType: "opportunity", entityId: id, relatedIds: [current.customerId], reason: "", snapshot: { name: current.name, stage: restored.stage }, impactSummary: "", undoneAt: null, undoneBy: "" });
    return restored;
  });
}

// Batch clean-up for stale imported opportunities; all-or-nothing.
export function postponeOpportunities(db, ids, expectedCloseDate, requestId) {
  if (!isDateOnly(expectedCloseDate)) return Promise.resolve({ ok: false, error: "validation", errors: { expectedCloseDate: "請選擇新的預計結案日" } });
  return db.transact(requestId, async (tx) => {
    for (const id of ids) await updateOpportunityIn(tx, id, { expectedCloseDate, reminderDate: "" });
    return { count: ids.length };
  });
}

export function markLostMany(db, ids, lostReason, requestId) {
  if (!LOST_REASONS.includes(lostReason)) return Promise.resolve({ ok: false, error: "validation", errors: { lostReason: "請選擇未成交原因" } });
  return db.transact(requestId, async (tx) => {
    for (const id of ids) await updateOpportunityIn(tx, id, { stage: "失敗", probability: 0, lostReason });
    return { count: ids.length };
  });
}

export function filterOpportunities(model, { view = "open", query = "", today, customerIds = null } = {}) {
  const key = String(query || "").trim().toLowerCase();
  return (model.all.opportunity || []).filter((opportunity) => {
    if (opportunity.archivedAt) return false;
    const customer = model.customersById.get(opportunity.customerId);
    if (!customer || customer.archivedAt) return false;
    if (customerIds && !customerIds.has(opportunity.customerId)) return false;
    if (view === "open" && !isOpen(opportunity)) return false;
    if (view === "overdue" && !(isOpen(opportunity) && ((opportunity.expectedCloseDate && opportunity.expectedCloseDate < today) || (opportunity.reminderDate && opportunity.reminderDate < today)))) return false;
    if (view === "won" && opportunity.stage !== "成交") return false;
    if (view === "lost" && opportunity.stage !== "失敗") return false;
    if (key && ![opportunity.name, opportunity.product, customer.name, opportunity.notes].some((value) => String(value || "").toLowerCase().includes(key))) return false;
    return true;
  });
}

export function isOpen(opportunity) {
  return OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage);
}

const FUNNEL = ["接觸", "提案", "議價", "成交"];

// How far each case got: open cases sit at their stage, won cases went all the way,
// lost cases count up to the stage they were lost at (接觸 when unknown).
export function funnelConversion(opportunities = []) {
  const reached = [0, 0, 0, 0];
  let won = 0;
  let lost = 0;
  for (const opportunity of opportunities) {
    if (opportunity.archivedAt) continue;
    let depth;
    if (opportunity.stage === "成交") { depth = 3; won += 1; }
    else if (opportunity.stage === "失敗") { depth = Math.max(0, FUNNEL.indexOf(opportunity.lostAtStage)); lost += 1; }
    else depth = FUNNEL.indexOf(opportunity.stage);
    if (depth < 0) continue;
    for (let index = 0; index <= depth; index += 1) reached[index] += 1;
  }
  const steps = FUNNEL.slice(0, -1).map((stage, index) => ({
    from: stage, to: FUNNEL[index + 1], reached: reached[index], advanced: reached[index + 1],
    rate: reached[index] ? Math.round((reached[index + 1] / reached[index]) * 100) : null,
  }));
  return { steps, won, lost, winRate: won + lost ? Math.round((won / (won + lost)) * 100) : null };
}