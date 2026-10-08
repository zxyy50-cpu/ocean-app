import { addDays } from "../core/dates.js";
import { cleanText, comparisonKey, companyKey, digitsOnly, splitList } from "../core/text.js";
import { canonicalArea, customerInAreas, normalizeAreas } from "./tags.js";
import { qualificationTotal } from "./qualification.js";

export const RELATION_STATUSES = Object.freeze(["未接觸", "開發中", "洽談中", "往來中", "重點培養", "暫停追蹤"]);
export const ARCHIVE_REASONS = Object.freeze(["重複資料", "公司歇業／搬遷", "非目標客戶", "已轉給其他業務", "其他"]);

const PHONE = /^[+()\d\s#-]{6,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeCustomerInput(input = {}) {
  return {
    name: cleanText(input.name),
    customerNo: cleanText(input.customerNo),
    taxId: cleanText(input.taxId),
    phone: cleanText(input.phone),
    address: cleanText(input.address),
    areaTags: normalizeAreas(input.areaTags),
    industryTags: splitList(input.industryTags),
    productTags: splitList(input.productTags),
    segmentTags: splitList(input.segmentTags),
    relationStatus: cleanText(input.relationStatus) || "未接觸",
    notes: String(input.notes ?? "").trim(),
    nextAction: cleanText(input.nextAction),
    nextFollowUpDate: cleanText(input.nextFollowUpDate),
  };
}

export function validateCustomer(input = {}) {
  const values = normalizeCustomerInput(input);
  const errors = {};
  if (!values.name) errors.name = "請輸入公司名稱";
  if (values.taxId && !/^\d{8}$/.test(values.taxId)) errors.taxId = "統編應為 8 位數字";
  if (values.phone && !PHONE.test(values.phone)) errors.phone = "電話格式不正確";
  if (values.nextFollowUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(values.nextFollowUpDate)) errors.nextFollowUpDate = "日期格式不正確";
  return { ok: !Object.keys(errors).length, values, errors };
}

export function validateContact(input = {}) {
  const values = {
    name: cleanText(input.name), title: cleanText(input.title), department: cleanText(input.department),
    phone: cleanText(input.phone), mobile: cleanText(input.mobile), email: cleanText(input.email),
    isPrimary: Boolean(input.isPrimary), notes: String(input.notes ?? "").trim(),
  };
  const errors = {};
  if (!values.name) errors.name = "請輸入聯絡人姓名";
  if (values.phone && !PHONE.test(values.phone)) errors.phone = "電話格式不正確";
  if (values.mobile && !PHONE.test(values.mobile)) errors.mobile = "手機格式不正確";
  if (values.email && !EMAIL.test(values.email)) errors.email = "Email 格式不正確";
  return { ok: !Object.keys(errors).length, values, errors };
}

// Similar names only ever produce a warning; nothing here merges records.
export function duplicateCandidates(customer, customers = [], contactsByCustomer = new Map()) {
  const nameKey = companyKey(customer.name);
  const phoneKey = digitsOnly(customer.phone);
  const result = [];
  for (const other of customers) {
    if (other.id === customer.id || other.archivedAt) continue;
    const reasons = [];
    if (nameKey && companyKey(other.name) === nameKey) reasons.push("公司名稱相同或相似");
    else if (nameKey && nameKey.length >= 3 && (other.aliases || []).some((alias) => companyKey(alias) === nameKey)) reasons.push("與對方別名相同");
    if (customer.customerNo && other.customerNo && customer.customerNo === other.customerNo) reasons.push("客戶編號相同");
    if (customer.taxId && other.taxId && customer.taxId === other.taxId) reasons.push("統編相同");
    if (phoneKey.length >= 8 && digitsOnly(other.phone) === phoneKey) reasons.push("電話相同");
    if (!reasons.length) continue;
    const differentNumbers = customer.customerNo && other.customerNo && customer.customerNo !== other.customerNo;
    result.push({ id: other.id, name: other.name, customerNo: other.customerNo, reasons, note: differentNumbers ? "客戶編號不同，可能是同集團不同據點，請人工確認" : "", contacts: (contactsByCustomer.get(other.id) || []).length });
  }
  return result;
}

export function duplicateGroups(customers = []) {
  const groups = new Map();
  for (const customer of customers) {
    if (customer.archivedAt) continue;
    const key = companyKey(customer.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), customer]);
  }
  return [...groups.values()].filter((members) => members.length > 1);
}

function contactMatches(model, customer, queryKey, queryDigits) {
  return (model.contactsByCustomer.get(customer.id) || []).some((contact) => (queryKey && comparisonKey(contact.name).includes(queryKey))
    || (queryDigits.length >= 4 && [contact.phone, contact.mobile].some((phone) => digitsOnly(phone).includes(queryDigits)))
    || (queryKey && comparisonKey(contact.email).includes(queryKey)));
}

export function customerMatches(model, customer, query) {
  const queryKey = comparisonKey(query);
  if (!queryKey) return true;
  const queryDigits = digitsOnly(query);
  const fields = [customer.name, customer.customerNo, customer.taxId, ...(customer.aliases || []), ...(customer.areaTags || []), ...(customer.industryTags || []), ...(customer.productTags || []), ...(customer.segmentTags || [])];
  if (fields.some((value) => comparisonKey(value).includes(queryKey))) return true;
  if (queryDigits.length >= 4 && digitsOnly(customer.phone).includes(queryDigits)) return true;
  return contactMatches(model, customer, queryKey, queryDigits);
}

export function priorityScore(model, customer, today) {
  let score = 0;
  if (customer.important) score += 1000;
  const qualification = qualificationTotal(customer.qualification);
  if (qualification !== null) score += qualification >= 16 ? 250 : qualification >= 10 ? 80 : -50;
  if (customer.nextFollowUpDate && customer.nextFollowUpDate <= addDays(today, 3)) score += 300;
  const open = (model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  if (open.length) score += 200 + Math.min(200, open.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0), 0) / 5000);
  if ((model.ordersByCustomer.get(customer.id) || []).length) score += 50;
  if (customer.lastContactAt && customer.lastContactAt < addDays(today, -60)) score += 40;
  return score;
}

export function searchCustomers(model, { query = "", areas = [], importantOnly = false, myAreas = [], today, limit = 30 } = {}) {
  const hasQuery = Boolean(comparisonKey(query));
  const hasAreas = areas.length > 0;
  const outsideMine = (customer) => (customer.areaTags || []).length > 0 && !customerInAreas(customer, myAreas);
  let mode = "priority";
  let pool;
  if (hasQuery || hasAreas) {
    mode = "search";
    pool = model.customers.filter((customer) => (!hasAreas || customerInAreas(customer, areas)) && customerMatches(model, customer, query));
  } else {
    // Without a search we never list everyone: only my areas' important or actionable customers.
    pool = model.customers.filter((customer) => customerInAreas(customer, myAreas) && (customer.important || priorityScore(model, customer, today) >= 200));
  }
  if (importantOnly) pool = pool.filter((customer) => customer.important);
  const ranked = pool.map((customer) => ({ customer, score: priorityScore(model, customer, today) }))
    .sort((left, right) => right.score - left.score || String(right.customer.lastContactAt || "").localeCompare(String(left.customer.lastContactAt || "")) || left.customer.name.localeCompare(right.customer.name, "zh-Hant"));
  return {
    mode,
    total: ranked.length,
    items: ranked.slice(0, limit).map(({ customer }) => ({ customer, outsideMyAreas: outsideMine(customer), unclassified: !(customer.areaTags || []).length })),
    hasMore: ranked.length > limit,
  };
}

export function archiveImpact(model, customerId) {
  const opportunities = model.opportunitiesByCustomer.get(customerId) || [];
  return {
    contacts: (model.contactsByCustomer.get(customerId) || []).length,
    activities: (model.activitiesByCustomer.get(customerId) || []).length,
    openOpportunities: opportunities.filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage)).length,
    opportunities: opportunities.length,
    orders: (model.ordersByCustomer.get(customerId) || []).length,
    reminders: (model.remindersByCustomer.get(customerId) || []).filter((reminder) => reminder.status !== "完成").length,
  };
}

export function impactText(impact) {
  return `聯絡人 ${impact.contacts}、拜訪 ${impact.activities}、商機 ${impact.opportunities}（進行中 ${impact.openOpportunities}）、訂單 ${impact.orders}、未完成提醒 ${impact.reminders}`;
}

export async function createCustomer(db, input, { contact = null, requestId } = {}) {
  const validation = validateCustomer(input);
  const contactValidation = contact && Object.values(contact).some((value) => String(value ?? "").trim()) ? validateContact({ ...contact, isPrimary: true }) : null;
  if (!validation.ok || (contactValidation && !contactValidation.ok)) {
    return { ok: false, error: "validation", errors: { ...validation.errors, ...Object.fromEntries(Object.entries(contactValidation?.errors || {}).map(([key, message]) => [`contact.${key}`, message])) } };
  }
  return db.transact(requestId, async (tx) => {
    const customer = await tx.create("customer", { ...validation.values, aliases: [], important: Boolean(input.important), lastContactAt: "", mergedIntoId: "" });
    if (contactValidation) await tx.create("contact", { ...contactValidation.values, customerId: customer.id });
    return customer;
  });
}

export async function updateCustomer(db, id, input, { expectedRev, requestId } = {}) {
  const validation = validateCustomer(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  // Only fields the form actually sent are changed, so editing basics never wipes next steps.
  const patch = Object.fromEntries(Object.entries(validation.values).filter(([key]) => key in input));
  return db.transact(requestId, async (tx) => {
    const current = await tx.get("customer", id);
    if (!current || current.archivedAt) tx.fail("not-found");
    return tx.update("customer", id, patch, { expectedRev });
  });
}

export async function setImportant(db, id, important, requestId) {
  return db.update("customer", id, { important: Boolean(important) }, requestId);
}

export async function archiveCustomer(db, model, id, reason, requestId) {
  const impact = archiveImpact(model, id);
  return db.transact(requestId, async (tx) => {
    const customer = await tx.archive("customer", id, reason);
    await tx.create("archiveEvent", { eventType: "archive", entityType: "customer", entityId: id, relatedIds: [], reason: customer.archiveReason, snapshot: { name: customer.name, customerNo: customer.customerNo }, impactSummary: impactText(impact), undoneAt: null, undoneBy: "" });
    return customer;
  });
}

export async function restoreCustomer(db, id, requestId) {
  return db.transact(requestId, async (tx) => {
    const current = await tx.get("customer", id);
    if (!current) tx.fail("not-found");
    if (current.mergedIntoId) tx.fail("merged", { message: "這筆是合併後封存的客戶，請到封存區「取消合併」" });
    const customer = await tx.restore("customer", id);
    await tx.create("archiveEvent", { eventType: "restore", entityType: "customer", entityId: id, relatedIds: [], reason: "", snapshot: { name: customer.name }, impactSummary: "", undoneAt: null, undoneBy: "" });
    return customer;
  });
}

export async function saveContact(db, customerId, input, { id = null, expectedRev, requestId } = {}) {
  const validation = validateContact(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const customer = await tx.get("customer", customerId);
    if (!customer) tx.fail("not-found");
    if (validation.values.isPrimary) {
      for (const contact of await tx.list("contact")) {
        if (contact.customerId === customerId && contact.id !== id && contact.isPrimary) await tx.update("contact", contact.id, { isPrimary: false });
      }
    }
    if (id) return tx.update("contact", id, validation.values, { expectedRev });
    return tx.create("contact", { ...validation.values, customerId });
  });
}

export async function archiveContact(db, id, requestId) {
  return db.archive("contact", id, "聯絡人已離職或不再使用", requestId);
}

export function knownAreaLabels(model) {
  const labels = new Set();
  model.customers.forEach((customer) => (customer.areaTags || []).forEach((tag) => labels.add(canonicalArea(tag))));
  return [...labels].sort((left, right) => left.localeCompare(right, "zh-Hant"));
}

// The six standard statuses; an older imported value stays selectable on that
// customer only, so editing never silently rewrites it.
export function statusOptions(current = "") {
  const value = cleanText(current);
  const standard = RELATION_STATUSES.map((status) => ({ value: status, label: status }));
  return value && !RELATION_STATUSES.includes(value) ? [...standard, { value, label: `${value}（舊分類）` }] : standard;
}
