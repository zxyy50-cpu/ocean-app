import { addDays, isDateOnly } from "../core/dates.js";
import { archiveOpportunity, isOpen, markLost, markWon, prependNote, restoreOpportunity, updateOpportunity } from "./opportunities.js";
import { readSetting, saveSetting } from "./settings.js";
import { customerInAreas } from "./tags.js";

// 商機整理: go through open opportunities one card at a time and decide — keep chasing (new close
// date), won, lost, or not an opportunity at all. Which ones were already looked at is kept in
// settings, so the queue survives reloads and other devices without changing the sheet.

export const TIDY_KEY = "opportunityTidied";

export function tidiedMap(all) {
  return readSetting(all, TIDY_KEY) || {};
}

function addMonths(dateOnly, months) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export function laterDate(today, months) {
  return addMonths(today, months);
}

// Why a case needs a look; empty when it is in order.
export function tidyReasons(opportunity, today) {
  const reasons = [];
  if (!opportunity.expectedCloseDate) reasons.push("沒有預計結案日");
  else if (opportunity.expectedCloseDate < today) reasons.push(`預計結案日 ${opportunity.expectedCloseDate} 已過`);
  if (["提案", "議價"].includes(opportunity.stage) && !(Number(opportunity.amount) > 0)) reasons.push("金額未填");
  if (opportunity.source === "匯入") reasons.push("匯入後還沒整理");
  return reasons;
}

// The open cases still to go through (biggest first), and how far along the clean-up is.
export function tidyQueue(model, all, { today, areas = [] } = {}) {
  const tidied = tidiedMap(all);
  const inScope = (model.all.opportunity || []).filter((opportunity) => {
    if (opportunity.archivedAt && !tidied[opportunity.id]) return false;
    const customer = model.customersById.get(opportunity.customerId);
    if (!customer || customer.archivedAt) return false;
    return !areas.length || !(customer.areaTags || []).length || customerInAreas(customer, areas);
  });
  const queue = inScope
    .filter((opportunity) => !opportunity.archivedAt && isOpen(opportunity) && !tidied[opportunity.id] && tidyReasons(opportunity, today).length)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0) || String(a.expectedCloseDate || "").localeCompare(String(b.expectedCloseDate || "")));
  const done = inScope.filter((opportunity) => tidied[opportunity.id]).length;
  return { queue, done, total: done + queue.length };
}

// Always from the database as it is now: an undo much later must not wipe marks made since.
async function setTidied(db, all, id, value, requestId) {
  const map = { ...tidiedMap(db.peekAll?.() || all) };
  if (value) map[id] = value;
  else delete map[id];
  return saveSetting(db, TIDY_KEY, map, requestId);
}

// Each action returns { ok, message, undo } — undo puts the case back exactly as it was.
export async function tidyAction(db, model, opportunity, action, { today, requestId, months, date, amount, stage, reason, note } = {}) {
  const before = { stage: opportunity.stage, amount: opportunity.amount ?? "", probability: opportunity.probability ?? "", expectedCloseDate: opportunity.expectedCloseDate || "", reminderDate: opportunity.reminderDate || "", lostReason: opportunity.lostReason || "", notes: opportunity.notes || "" };
  const all = () => model.all;
  const notes = prependNote(opportunity.notes, note, today);
  let result;
  let message;
  if (action === "postpone") {
    const closeDate = date || laterDate(today, months || 1);
    if (!isDateOnly(closeDate) || closeDate < today) return { ok: false, errors: { expectedCloseDate: "請選今天以後的日期" } };
    const patch = { expectedCloseDate: closeDate, reminderDate: addDays(closeDate, -7) < today ? closeDate : addDays(closeDate, -7) };
    if (stage && stage !== opportunity.stage) patch.stage = stage;
    if (amount !== undefined && String(amount).trim() !== "" && Number(amount) !== Number(opportunity.amount)) patch.amount = amount;
    if (notes !== undefined) patch.notes = notes;
    result = await updateOpportunity(db, opportunity.id, patch, requestId);
    message = `繼續追，預計 ${closeDate.slice(5).replace("-", "/")} 結案（前一週提醒）`;
  } else if (action === "won") {
    result = await markWon(db, opportunity.id, requestId, { amount: amount ?? opportunity.amount, notes });
    message = "已標記成交 🎉";
  } else if (action === "lost") {
    result = await markLost(db, opportunity.id, reason, requestId, { notes });
    message = `已標記未成交（${reason}）`;
  } else if (action === "archive") {
    result = await archiveOpportunity(db, opportunity.id, "整理時判定不是商機", requestId);
    message = "已封存（不是商機），可以復原";
  } else return { ok: false, errors: { _: "不認得的動作" } };
  if (result?.ok === false) return result;
  await setTidied(db, all(), opportunity.id, today, `${requestId}:mark`);
  const undo = async () => {
    if (action === "archive") await restoreOpportunity(db, opportunity.id, `${requestId}:undo`);
    else await updateOpportunity(db, opportunity.id, before, `${requestId}:undo`);
    await setTidied(db, all(), opportunity.id, null, `${requestId}:unmark`);
  };
  return { ok: true, message, undo };
}
