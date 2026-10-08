import { toDateOnly } from "../core/dates.js";
import { uuid as defaultUuid } from "../core/ids.js";
import { cleanText, comparisonKey, uniqueList } from "../core/text.js";
import { classifyLooseTags, normalizeAreas } from "./tags.js";

const STAGE_MAP = Object.freeze({
  客戶需求訪查: "接觸", 產品諮詢介紹: "接觸", 訪價階段: "接觸", 產品示範測試: "接觸",
  提案報價: "提案", 標案參與: "提案",
  議價階段: "議價", 合約制訂: "議價",
  結案贏: "成交", 結案輸: "失敗",
});
const IMPORTANT_STATUSES = new Set(["本週必攻", "重點培養"]);
const LINE_STATUS = Object.freeze({ 待確認: "待確認", 已給秘書: "已交客服" });

export function mapStage(value) {
  const text = cleanText(value);
  if (["接觸", "提案", "議價", "成交", "失敗"].includes(text)) return text;
  return STAGE_MAP[text] || "接觸";
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(/NT\$|,|%/g, ""));
  return Number.isFinite(number) ? number : null;
}

function probabilityPercent(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return number <= 1 ? Math.round(number * 100) : Math.round(number);
}

function rawLines(raw = {}, fields = []) {
  return fields.map((field) => (raw[field] !== undefined && raw[field] !== null && String(raw[field]).trim() ? `${field}：${String(raw[field]).trim()}` : null)).filter(Boolean);
}

function provenanceRef(item) {
  const source = item?.provenance?.[0];
  return source ? `${source.sourceSheet}!${source.sourceRow}` : "";
}

function ownerFinder(customers, field) {
  const owners = new Map();
  for (const customer of customers) {
    for (const id of customer[field] || []) {
      const current = owners.get(id);
      if (!current || (!current.customerId && customer.customerId)) owners.set(id, customer);
    }
  }
  return (id) => owners.get(id) || null;
}

function contactRows(customer) {
  const seen = new Set();
  return (customer.contacts || []).map((contact) => ({
    name: cleanText(contact.name), title: cleanText(contact.title || contact.role), department: cleanText(contact.department),
    phone: cleanText(contact.phone), mobile: cleanText(contact.mobile), email: cleanText(contact.email),
  })).filter((contact) => {
    const key = comparisonKey(`${contact.name}|${contact.phone}|${contact.email}`);
    if (!contact.name && !contact.phone && !contact.email) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Pure: turns a v2 snapshot into entity values with pre-assigned IDs. Existing
// sourceRefs are skipped so re-running an import never duplicates records.
// A record that already exists still lends its id, so its missing children
// (contacts, opportunities, order items) are linked to it instead of dropped.
export function planSnapshotImport(snapshot, { existingSourceRefs = new Set(), existingIdsBySourceRef = new Map(), uuid = defaultUuid } = {}) {
  const plan = { customer: [], contact: [], opportunity: [], activity: [], reminder: [], order: [], orderItem: [], skipped: 0, issues: [] };
  const customerIdByKey = new Map();
  const customerIdByNo = new Map();
  const add = (type, values) => {
    if (values.sourceRef && (existingSourceRefs.has(values.sourceRef) || existingIdsBySourceRef.has(values.sourceRef))) {
      plan.skipped += 1;
      const id = existingIdsBySourceRef.get(values.sourceRef);
      return id ? { ...values, id, existing: true } : null;
    }
    const record = { ...values, id: uuid() };
    plan[type].push(record);
    return record;
  };

  const activityDates = new Map();
  for (const activity of snapshot.activities || []) {
    for (const customer of snapshot.customers || []) {
      if ((customer.activityIds || []).includes(activity.id)) {
        const date = toDateOnly(activity.occurredAt);
        if (date && date > (activityDates.get(customer.key) || "")) activityDates.set(customer.key, date);
      }
    }
  }

  for (const source of snapshot.customers || []) {
    const name = cleanText(source.displayName || source.name);
    if (!name) { plan.issues.push({ type: "invalid-customer", key: source.key, reason: "缺少公司名稱" }); continue; }
    const geography = (source.tags || []).filter((tag) => tag?.group === "geography" && tag.active !== false).map((tag) => tag.label);
    const loose = classifyLooseTags([...(source.industries || []), ...(source.tags || []).filter((tag) => tag?.group === "industry").map((tag) => tag.label)]);
    const contacts = contactRows(source);
    const address = (source.addresses || []).map((item) => cleanText(typeof item === "string" ? item : item?.address)).find((item) => item.length > 4) || "";
    const record = add("customer", {
      customerNo: cleanText(source.customerId), taxId: "", name, aliases: uniqueList((source.aliases || []).filter((alias) => cleanText(alias) !== name)),
      address, phone: contacts.find((contact) => contact.phone)?.phone || "",
      areaTags: normalizeAreas(geography), ...loose,
      important: IMPORTANT_STATUSES.has(cleanText(source.status)), relationStatus: cleanText(source.status) || "未接觸",
      nextAction: cleanText(source.nextAction), nextFollowUpDate: toDateOnly(source.nextFollowUp),
      lastContactAt: activityDates.get(source.key) || "", notes: "", mergedIntoId: "",
      sourceRef: `snapshot:${source.key}`,
    });
    if (!record) continue;
    customerIdByKey.set(source.key, record.id);
    if (record.customerNo && !customerIdByNo.has(record.customerNo)) customerIdByNo.set(record.customerNo, record.id);
    contacts.forEach((contact, index) => add("contact", { ...contact, customerId: record.id, isPrimary: index === 0, notes: "", sourceRef: `snapshot:${source.key}:contact:${index}` }));
    if (record.nextFollowUpDate) add("reminder", { customerId: record.id, opportunityId: "", activityId: "", title: record.nextAction || "追蹤客戶", dueDate: record.nextFollowUpDate, status: "待辦", completedAt: null, completedByActivityId: "", sourceRef: `snapshot:${source.key}:follow-up` });
  }

  const opportunityOwner = ownerFinder(snapshot.customers || [], "opportunityIds");
  for (const source of snapshot.opportunities || []) {
    const owner = opportunityOwner(source.id);
    const customerId = owner ? customerIdByKey.get(owner.key) : null;
    if (!customerId) { plan.issues.push({ type: "unlinked-opportunity", key: source.id, reason: `找不到客戶：${source.customerName || "未命名"}` }); continue; }
    const raw = source.raw || {};
    const stage = mapStage(source.stage);
    add("opportunity", {
      customerId, contactId: "", name: cleanText(source.title || raw["試驗項目"]) || "未命名商機", product: cleanText(raw["試驗項目"] || source.title),
      stage, amount: numberOrNull(source.amount), probability: probabilityPercent(source.probability),
      expectedCloseDate: toDateOnly(source.expectedCloseDate), nextAction: cleanText(source.nextAction), reminderDate: toDateOnly(source.nextFollowUp),
      source: "匯入", sourceOrderItemId: "", outcome: stage === "成交" ? "won" : stage === "失敗" ? "lost" : "",
      lostReason: "", closedAt: ["成交", "失敗"].includes(stage) ? toDateOnly(source.lastUpdatedAt) || null : null, priorStage: "",
      notes: [cleanText(source.stage) ? `原階段：${cleanText(source.stage)}` : null, ...rawLines(raw, ["交易類別", "重點摘要", "客戶窗口"])].filter(Boolean).join("\n"),
      sourceRef: `snapshot:${provenanceRef(source) || source.id}`,
    });
  }

  const activityOwner = ownerFinder(snapshot.customers || [], "activityIds");
  for (const source of snapshot.activities || []) {
    const owner = activityOwner(source.id);
    const customerId = owner ? customerIdByKey.get(owner.key) : null;
    if (!customerId) { plan.issues.push({ type: "unlinked-activity", key: source.id, reason: `找不到客戶：${source.customerName || "未命名"}` }); continue; }
    const raw = source.raw || {};
    const detailedNote = [cleanText(source.summary), ...rawLines(raw, ["聯絡人", "職稱／角色", "現用品牌", "檢驗量／頻率", "主要痛點", "建議切入方案", "我方下一步"])].filter(Boolean).join("\n");
    add("activity", {
      customerId, contactId: "", opportunityId: "", activityDate: toDateOnly(source.occurredAt), channel: cleanText(source.type) || "其他",
      purpose: "需求訪談", reaction: "", result: "", detailedNote, summary: cleanText(source.summary).slice(0, 80),
      nextAction: cleanText(raw["我方下一步"]), nextFollowUpDate: toDateOnly(raw["下次跟進日"]),
      sourceRef: `snapshot:${provenanceRef(source) || source.id}`,
    });
  }

  const transactionOwner = ownerFinder(snapshot.customers || [], "transactionIds");
  const orders = new Map();
  for (const source of snapshot.transactions || []) {
    const raw = source.raw || {};
    const sheet = source.provenance?.[0]?.sourceSheet || "";
    const isErp = sheet.includes("交易明細");
    const customerNo = cleanText(source.customerId ?? raw["客戶編號"]);
    const owner = transactionOwner(source.id);
    const customerId = (customerNo && customerIdByNo.get(customerNo)) || (owner ? customerIdByKey.get(owner.key) : "") || "";
    const orderDate = toDateOnly(isErp ? raw["訂單日期"] || source.occurredAt : source.occurredAt);
    const erpOrderNo = cleanText(raw["訂單單號"]);
    const groupKey = isErp ? (erpOrderNo ? `erp:${erpOrderNo}` : `erp:row:${source.id}`) : `line:${customerNo}|${orderDate}|${cleanText(raw["原始訊息"])}`;
    let order = orders.get(groupKey);
    if (!order) {
      order = add("order", {
        orderNo: isErp ? cleanText(raw["訂單單號"]) : "", customerId, customerNo, customerName: cleanText(source.customerName),
        orderDate, status: isErp ? "已出貨" : LINE_STATUS[cleanText(raw["狀態"])] || "待確認", source: isErp ? "ERP出貨" : "LINE",
        deliveryMethod: cleanText(raw["配送方式"]), taxType: cleanText(raw["稅額"]), notes: isErp ? "" : cleanText(raw["備註"]),
        rawMessage: cleanText(raw["原始訊息"]), sourceRef: `snapshot:${groupKey}`,
      });
      if (!order) continue;
      orders.set(groupKey, order);
    }
    const quantity = numberOrNull(isErp ? raw["出貨數量"] ?? source.quantity : source.quantity);
    const unitPrice = numberOrNull(isErp ? raw["出貨未稅單價"] : raw["價格"] ?? source.amount);
    const amount = isErp ? numberOrNull(raw["出貨未稅金額(本幣)"] ?? source.amount) : (quantity !== null && unitPrice !== null ? quantity * unitPrice : null);
    add("orderItem", {
      orderId: order.id, customerNo, productCode: cleanText(source.productCode ?? raw["產品編號"]), productName: cleanText(source.productName),
      spec: cleanText(raw["規格"]), quantity, unit: cleanText(raw["出貨單位"]), unitPrice, amount,
      classification: "", basis: "", signalStatus: "", signalNote: "", handledAt: null, handledBy: "", linkedOpportunityId: "",
      sourceRef: `snapshot:${provenanceRef(source) || source.id}`,
    });
  }

  plan.counts = Object.fromEntries(["customer", "contact", "opportunity", "activity", "reminder", "order", "orderItem"].map((type) => [type, plan[type].length]));
  plan.customerIdByKey = customerIdByKey;
  return plan;
}

const LEGACY_KEY = "ocean-explorer:v1";

export function readLegacyState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Old explorer visits, tasks and important flags, keyed by snapshot customer keys.
export function planLegacyImport(legacy, customerIdBySourceRef, { existingSourceRefs = new Set(), uuid = defaultUuid } = {}) {
  const plan = { activity: [], reminder: [], importantCustomerIds: [], drafts: {}, skipped: 0, issues: [] };
  if (!legacy || typeof legacy !== "object") return plan;
  const resolve = (key) => customerIdBySourceRef.get(`snapshot:${key}`) || null;
  const activityIds = new Map();
  for (const change of Array.isArray(legacy.changes) ? legacy.changes : []) {
    if (change?.type !== "visit") continue;
    const sourceRef = `legacy:visit:${change.id}`;
    const customerId = resolve(change.customerKey);
    if (!customerId) { plan.issues.push({ type: "unlinked-visit", key: change.id, reason: "舊拜訪紀錄找不到客戶" }); continue; }
    if (existingSourceRefs.has(sourceRef)) { plan.skipped += 1; continue; }
    const id = uuid();
    activityIds.set(change.id, id);
    plan.activity.push({
      id, customerId, contactId: "", opportunityId: "", activityDate: toDateOnly(change.occurredAt),
      channel: cleanText(change.channel), purpose: cleanText(change.purpose), reaction: cleanText(change.reaction), result: cleanText(change.result),
      detailedNote: String(change.detailedNote || change.note || ""), summary: cleanText(change.summary),
      nextAction: cleanText(change.nextAction), nextFollowUpDate: toDateOnly(change.nextFollowUp), sourceRef,
    });
  }
  for (const task of Array.isArray(legacy.tasks) ? legacy.tasks : []) {
    const sourceRef = `legacy:${task.id}`;
    const customerId = resolve(task.customerKey);
    if (!customerId) { plan.issues.push({ type: "unlinked-task", key: task.id, reason: "舊待辦找不到客戶" }); continue; }
    if (existingSourceRefs.has(sourceRef)) { plan.skipped += 1; continue; }
    plan.reminder.push({
      id: uuid(), customerId, opportunityId: "", activityId: activityIds.get(task.visitId) || "", title: cleanText(task.title) || "追蹤客戶",
      dueDate: toDateOnly(task.dueDate), status: task.status === "completed" ? "完成" : "待辦", completedAt: task.completedAt || null,
      completedByActivityId: "", sourceRef,
    });
  }
  for (const key of Array.isArray(legacy.importantCustomerKeys) ? legacy.importantCustomerKeys : []) {
    const customerId = resolve(key);
    if (customerId) plan.importantCustomerIds.push(customerId);
  }
  for (const [key, draft] of Object.entries(legacy.drafts || {})) {
    const customerId = resolve(key);
    if (customerId && String(draft?.detailedNote || "").trim()) plan.drafts[customerId] = { customerId, detailedNote: String(draft.detailedNote), channel: draft.channel || "", purpose: draft.purpose || "" };
  }
  return plan;
}

const PLAN_TYPES = ["customer", "contact", "opportunity", "activity", "reminder", "order", "orderItem"];

export async function applyPlan(db, plan, requestId) {
  return db.transact(requestId, async (tx) => {
    const created = {};
    for (const type of PLAN_TYPES) {
      for (const values of plan[type] || []) {
        const { id, ...rest } = values;
        await tx.create(type, rest, { id });
        created[type] = (created[type] || 0) + 1;
      }
    }
    for (const id of plan.importantCustomerIds || []) {
      const customer = await tx.get("customer", id);
      if (customer && !customer.important) await tx.update("customer", id, { important: true });
    }
    return { created };
  });
}

export async function existingSourceRefs(db) {
  const refs = new Set();
  const all = db.peekAll();
  Object.values(all).flat().forEach((record) => { if (record.sourceRef) refs.add(record.sourceRef); });
  return refs;
}

// A customer merged into another points at the one it was merged into, so later
// imports attach new contacts and orders to the surviving record.
export async function idsBySourceRef(db) {
  const map = new Map();
  Object.values(db.peekAll()).flat().forEach((record) => {
    if (!record.sourceRef || map.has(record.sourceRef)) return;
    map.set(record.sourceRef, record.type === "customer" && record.mergedIntoId ? record.mergedIntoId : record.id);
  });
  return map;
}

export async function customerIdBySourceRef(db) {
  const map = new Map();
  db.peekAll().customer.forEach((customer) => { if (customer.sourceRef) map.set(customer.sourceRef, customer.id); });
  return map;
}
