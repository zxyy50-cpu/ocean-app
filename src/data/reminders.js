import { addDays, addWorkdays, isDateOnly } from "../core/dates.js";

export const REMINDER_KINDS = Object.freeze(["追蹤", "拜訪", "報價", "送樣", "會後信", "行動", "經營", "其他"]);

export function validateReminder(input = {}) {
  const errors = {};
  if (!String(input.customerId || "").trim()) errors.customerId = "請選擇客戶";
  if (!String(input.title || "").trim()) errors.title = "請輸入提醒內容";
  if (!isDateOnly(input.dueDate)) errors.dueDate = "請選擇提醒日期";
  if (input.kind && !REMINDER_KINDS.includes(input.kind)) errors.kind = "提醒類型不正確";
  return { ok: !Object.keys(errors).length, errors };
}

export function reminderValues(input = {}) {
  return {
    customerId: input.customerId, opportunityId: input.opportunityId || "", activityId: input.activityId || "",
    title: String(input.title || "").trim(), kind: input.kind || "追蹤", dueDate: input.dueDate,
    status: "待辦", completedAt: null, completedByActivityId: "",
  };
}

export async function createReminder(db, input, requestId) {
  const validation = validateReminder(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, (tx) => tx.create("reminder", reminderValues(input)));
}

export async function completeReminder(db, id, requestId, { activityId = "" } = {}) {
  return db.transact(requestId, async (tx) => {
    const reminder = await tx.get("reminder", id);
    if (!reminder || reminder.archivedAt) tx.fail("not-found");
    if (reminder.status === "完成") return reminder;
    const done = await tx.update("reminder", id, { status: "完成", completedAt: tx.now(), completedByActivityId: activityId });
    const repeat = Number(reminder.repeatDays) || 0;
    if (repeat > 0) {
      // Recurring care: the next one is scheduled from the later of today and the due date.
      const today = tx.now().slice(0, 10);
      const base = reminder.dueDate && reminder.dueDate > today ? reminder.dueDate : today;
      const { id: _id, type: _type, version: _version, localRev: _rev, createdAt: _c, createdBy: _cb, updatedAt: _u, updatedBy: _ub, syncStatus: _s, conflict: _x, ...rest } = reminder;
      await tx.create("reminder", { ...rest, dueDate: addDays(base, repeat), status: "待辦", completedAt: null, completedByActivityId: "", sourceRef: "" });
    }
    return done;
  });
}

export async function snoozeReminder(db, id, days, requestId, today) {
  return db.transact(requestId, async (tx) => {
    const reminder = await tx.get("reminder", id);
    if (!reminder || reminder.archivedAt) tx.fail("not-found");
    const base = reminder.dueDate && reminder.dueDate > today ? reminder.dueDate : today;
    return tx.update("reminder", id, { dueDate: addWorkdays(base, days), status: "待辦" });
  });
}

export async function clearCustomerFollowUp(db, customerId, requestId) {
  return db.transact(requestId, async (tx) => tx.update("customer", customerId, { nextFollowUpDate: "" }));
}
