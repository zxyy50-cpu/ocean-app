// Single description of every syncable entity. ocean-gas/Schema.gs mirrors this
// file; tests/ocean-app/schema-parity.test.mjs keeps the two identical.

export const COMMON_FIELDS = Object.freeze([
  ["id", "text"], ["version", "number"],
  ["createdAt", "datetime"], ["createdBy", "text"], ["updatedAt", "datetime"], ["updatedBy", "text"],
  ["archivedAt", "datetime"], ["archivedBy", "text"], ["archiveReason", "text"], ["sourceRef", "text"],
]);

export const ENTITY_SCHEMAS = Object.freeze({
  customer: { sheet: "Customers", fields: [
    ["customerNo", "text"], ["taxId", "text"], ["name", "text"], ["aliases", "list"], ["address", "text"], ["phone", "text"],
    ["areaTags", "list"], ["industryTags", "list"], ["productTags", "list"], ["segmentTags", "list"],
    ["important", "bool"], ["relationStatus", "text"], ["nextAction", "text"], ["nextFollowUpDate", "date"],
    ["lastContactAt", "date"], ["notes", "longtext"], ["mergedIntoId", "text"], ["qualification", "json"], ["relationshipScore", "json"],
  ] },
  contact: { sheet: "Contacts", fields: [
    ["customerId", "text"], ["name", "text"], ["title", "text"], ["department", "text"], ["phone", "text"],
    ["mobile", "text"], ["email", "text"], ["isPrimary", "bool"], ["notes", "longtext"],
  ] },
  activity: { sheet: "Activities", fields: [
    ["customerId", "text"], ["contactId", "text"], ["opportunityId", "text"], ["activityDate", "date"],
    ["channel", "text"], ["purpose", "text"], ["reaction", "text"], ["result", "text"],
    ["detailedNote", "longtext"], ["summary", "text"], ["nextAction", "text"], ["nextFollowUpDate", "date"],
    ["prep", "json"], ["nextContactHint", "text"],
  ] },
  opportunity: { sheet: "Opportunities", fields: [
    ["customerId", "text"], ["contactId", "text"], ["name", "text"], ["product", "text"], ["stage", "text"],
    ["amount", "number"], ["probability", "number"], ["expectedCloseDate", "date"], ["nextAction", "text"],
    ["reminderDate", "date"], ["source", "text"], ["sourceOrderItemId", "text"], ["outcome", "text"],
    ["lostReason", "text"], ["closedAt", "datetime"], ["priorStage", "text"], ["notes", "longtext"],
    ["caseEnv", "json"], ["review", "json"], ["negotiation", "json"], ["competition", "json"], ["closeout", "json"], ["lostAtStage", "text"],
  ] },
  stakeholder: { sheet: "Stakeholders", fields: [
    ["opportunityId", "text"], ["customerId", "text"], ["contactId", "text"], ["name", "text"], ["title", "text"],
    ["role", "text"], ["influence", "text"], ["stance", "text"], ["relation", "text"],
    ["personalWin", "text"], ["companyWin", "text"], ["notes", "longtext"],
  ] },
  reminder: { sheet: "Reminders", fields: [
    ["customerId", "text"], ["opportunityId", "text"], ["activityId", "text"], ["title", "text"],
    ["kind", "text"], ["dueDate", "date"], ["status", "text"], ["completedAt", "datetime"], ["completedByActivityId", "text"],
    ["contactId", "text"], ["method", "text"], ["owner", "text"], ["repeatDays", "number"],
  ] },
  order: { sheet: "Orders", fields: [
    ["orderNo", "text"], ["customerId", "text"], ["customerNo", "text"], ["customerName", "text"], ["orderDate", "date"],
    ["status", "text"], ["source", "text"], ["deliveryMethod", "text"], ["taxType", "text"], ["notes", "longtext"],
    ["rawMessage", "longtext"],
  ] },
  orderItem: { sheet: "OrderItems", fields: [
    ["orderId", "text"], ["customerNo", "text"], ["productCode", "text"], ["productName", "text"], ["spec", "text"],
    ["quantity", "number"], ["unit", "text"], ["unitPrice", "number"], ["amount", "number"],
    ["classification", "text"], ["basis", "text"], ["signalStatus", "text"], ["signalNote", "text"],
    ["handledAt", "datetime"], ["handledBy", "text"], ["linkedOpportunityId", "text"],
  ] },
  archiveEvent: { sheet: "Archives", fields: [
    ["eventType", "text"], ["entityType", "text"], ["entityId", "text"], ["relatedIds", "list"], ["reason", "text"],
    ["snapshot", "json"], ["impactSummary", "text"], ["undoneAt", "datetime"], ["undoneBy", "text"],
  ] },
  setting: { sheet: "Settings", fields: [["key", "text"], ["value", "json"]] },
});

export const ENTITY_TYPES = Object.freeze(Object.keys(ENTITY_SCHEMAS));

export const CHANGELOG_HEADERS = Object.freeze([
  "seq", "changeId", "serverAt", "actorEmail", "deviceId", "entityType", "entityId", "operation",
  "baseVersion", "newVersion", "changedFields", "before", "after", "result",
]);

export function sheetHeaders(type) {
  const schema = ENTITY_SCHEMAS[type];
  if (!schema) throw new Error(`unknown entity type: ${type}`);
  return [...COMMON_FIELDS.map(([name]) => name), ...schema.fields.map(([name]) => name), "_seq"];
}

export function fieldType(type, field) {
  const found = [...COMMON_FIELDS, ...(ENTITY_SCHEMAS[type]?.fields || [])].find(([name]) => name === field);
  return found ? found[1] : null;
}

export function syncableFields(type) {
  return sheetHeaders(type).filter((name) => name !== "_seq");
}

export const OPPORTUNITY_STAGES = Object.freeze(["接觸", "提案", "議價", "成交", "失敗", "封存"]);
export const OPEN_OPPORTUNITY_STAGES = Object.freeze(["接觸", "提案", "議價"]);
export const LOST_REASONS = Object.freeze(["價格", "選用競品", "預算取消", "需求消失", "時程延後", "規格不符", "聯絡不上", "其他"]);
export const ORDER_STATUSES = Object.freeze(["待確認", "待交客服", "已交客服", "處理中", "已出貨", "已完成", "已取消"]);
export const SIGNAL_STATUSES = Object.freeze(["待處理", "已建商機", "不處理"]);
export const ITEM_CLASSIFICATIONS = Object.freeze({ first: "首次購買", repeat: "回購", review: "資料待確認" });
