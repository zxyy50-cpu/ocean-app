import { comparisonKey } from "../core/text.js";
import { restoreCustomer } from "./customers.js";
import { restoreOpportunity } from "./opportunities.js";

export const ARCHIVE_TYPES = Object.freeze({ customer: "客戶", opportunity: "商機", contact: "聯絡人", order: "訂單", reminder: "提醒" });

export function displayName(model, record) {
  if (record.type === "customer") return record.name;
  if (record.type === "opportunity") return `${record.name}（${model.customerName(record.customerId)}）`;
  if (record.type === "contact") return `${record.name}（${model.customerName(record.customerId)}）`;
  if (record.type === "order") return `${record.orderNo || record.orderDate}（${model.customerName(record.customerId)}）`;
  if (record.type === "reminder") return `${record.title}（${model.customerName(record.customerId)}）`;
  return record.id;
}

export function listArchived(model, { type = "all", query = "" } = {}) {
  const key = comparisonKey(query);
  return Object.keys(ARCHIVE_TYPES)
    .filter((name) => type === "all" || type === name)
    .flatMap((name) => (model.all[name] || []).filter((record) => record.archivedAt))
    .filter((record) => !key || comparisonKey(`${displayName(model, record)} ${record.archiveReason || ""}`).includes(key))
    .sort((left, right) => String(right.archivedAt).localeCompare(String(left.archivedAt)));
}

export function mergeEvents(model) {
  return (model.all.archiveEvent || []).filter((event) => event.eventType === "merge").sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function archiveLog(model, limit = 100) {
  return [...(model.all.archiveEvent || [])].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, limit);
}

export async function restoreEntity(db, record, requestId) {
  if (record.type === "customer") return restoreCustomer(db, record.id, requestId);
  if (record.type === "opportunity") return restoreOpportunity(db, record.id, requestId);
  return db.transact(requestId, async (tx) => {
    const restored = await tx.restore(record.type, record.id);
    await tx.create("archiveEvent", { eventType: "restore", entityType: record.type, entityId: record.id, relatedIds: [record.customerId].filter(Boolean), reason: "", snapshot: {}, impactSummary: "", undoneAt: null, undoneBy: "" });
    return restored;
  });
}
