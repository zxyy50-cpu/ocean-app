import { toDateOnly } from "../core/dates.js";
import { cleanText, companyKey } from "../core/text.js";
import { editableValues } from "./db.js";
import { ENTITY_TYPES } from "./schema.js";
import { normalizeAreas } from "./tags.js";
import { excelSerialToDate } from "./xlsx.js";

export const BACKUP_FORMAT = "ocean-app-backup";

// ---------- JSON backup ----------
export async function createBackup(db) {
  const data = await db.exportAll();
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), entities: data.entities, changes: data.changes, meta: { visitDrafts: data.meta.visitDrafts || {}, orderSignalSince: data.meta.orderSignalSince || null } };
}

export function previewBackup(backup, all) {
  if (!backup || backup.format !== BACKUP_FORMAT || !Array.isArray(backup.entities)) return { ok: false, error: "這不是 Ocean 業務助理的備份檔" };
  const invalid = backup.entities.filter((record) => !record || !ENTITY_TYPES.includes(record.type) || !record.id);
  const current = new Map(Object.values(all).flat().map((record) => [`${record.type}:${record.id}`, record]));
  const counts = Object.fromEntries(ENTITY_TYPES.map((type) => [type, { missing: 0, different: 0, same: 0 }]));
  const missing = [];
  const different = [];
  for (const record of backup.entities) {
    if (!record || !ENTITY_TYPES.includes(record.type) || !record.id) continue;
    const local = current.get(`${record.type}:${record.id}`);
    if (!local) { counts[record.type].missing += 1; missing.push(record); }
    else if (JSON.stringify(editableValues(local)) !== JSON.stringify(editableValues(record))) { counts[record.type].different += 1; different.push(record); }
    else counts[record.type].same += 1;
  }
  return { ok: true, exportedAt: backup.exportedAt, counts, missing, different, invalid: invalid.length, drafts: Object.keys(backup.meta?.visitDrafts || {}).length, backup };
}

// Restoring never removes anything that exists now; it only brings records back
// (and optionally overwrites differing ones). Every write is a normal change so it syncs.
export async function applyBackup(db, preview, { overwrite = false, requestId } = {}) {
  const result = await db.transact(requestId, async (tx) => {
    let added = 0;
    let replaced = 0;
    for (const record of preview.missing) {
      await tx.create(record.type, editableValues(record), { id: record.id });
      added += 1;
    }
    if (overwrite) {
      for (const record of preview.different) {
        await tx.update(record.type, record.id, editableValues(record));
        replaced += 1;
      }
    }
    return { added, replaced };
  });
  if (result.ok && preview.backup.meta?.visitDrafts) {
    const drafts = await db.getMeta("visitDrafts", {});
    await db.setMeta("visitDrafts", { ...preview.backup.meta.visitDrafts, ...drafts });
  }
  return result;
}

// ---------- spreadsheet import ----------
const pickField = (record, names) => {
  for (const name of names) if (record[name] !== undefined && String(record[name]).trim() !== "") return record[name];
  return "";
};
const CUSTOMER_COLUMNS = {
  name: ["客戶名稱", "公司名稱", "客戶／機構名稱", "客戶/機構名稱", "客戶／公司", "工廠／公司", "公司簡稱"],
  customerNo: ["客戶編號"], taxId: ["統編", "統一編號"], phone: ["電話", "公司電話", "聯絡電話"],
  address: ["地址", "地址／區域", "廠址", "地址／工廠地區"], area: ["區域", "地區", "縣市"],
  industry: ["產業", "產業／客戶類型", "客戶類型", "客戶類別"], contactName: ["聯絡人", "聯絡窗口", "客戶窗口", "建議窗口"],
  contactTitle: ["職稱", "職稱／角色"], mobile: ["手機"], email: ["Email", "信箱", "E-mail", "email"],
};
const ORDER_COLUMNS = {
  date: ["日期", "訂單日期"], customerNo: ["客戶編號"], customerName: ["客戶姓名", "客戶簡稱", "客戶名稱"],
  productCode: ["產品編號", "料號", "產品代碼"], productName: ["訂購品項", "品名", "產品名稱"], spec: ["規格"],
  quantity: ["數量", "出貨數量"], unitPrice: ["價格", "單價", "出貨未稅單價"], amount: ["金額", "出貨未稅金額(本幣)"],
  orderNo: ["訂單單號", "訂單編號"], delivery: ["配送方式"], tax: ["稅額", "稅別"], raw: ["原始訊息"], notes: ["備註"], status: ["狀態"],
};

export function detectImportKind(headers = []) {
  const has = (names) => names.some((name) => headers.includes(name));
  if (has(ORDER_COLUMNS.productCode) && has(ORDER_COLUMNS.date)) return "orders";
  if (has(CUSTOMER_COLUMNS.name)) return "customers";
  return null;
}

function dateValue(value) {
  return excelSerialToDate(value) || toDateOnly(typeof value === "string" ? value.trim().replace(/T.*$/, "") : value);
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/NT\$|,/g, ""));
  return Number.isFinite(number) ? number : Number.NaN;
}

export function planCustomerImport(records, model) {
  const plan = { kind: "customers", add: [], update: [], unchanged: [], duplicate: [], invalid: [] };
  const byNo = new Map(model.customers.filter((customer) => customer.customerNo).map((customer) => [customer.customerNo, customer]));
  const byName = new Map(model.customers.map((customer) => [companyKey(customer.name), customer]));
  const seenInFile = new Set();
  for (const record of records) {
    const name = cleanText(pickField(record, CUSTOMER_COLUMNS.name));
    const customerNo = cleanText(pickField(record, CUSTOMER_COLUMNS.customerNo));
    if (!name) { plan.invalid.push({ row: record.__row, reason: "缺少公司名稱", record }); continue; }
    const fileKey = customerNo || companyKey(name);
    if (seenInFile.has(fileKey)) { plan.duplicate.push({ row: record.__row, reason: "檔案內重複出現", name }); continue; }
    seenInFile.add(fileKey);
    const values = {
      name, customerNo, taxId: cleanText(pickField(record, CUSTOMER_COLUMNS.taxId)), phone: cleanText(pickField(record, CUSTOMER_COLUMNS.phone)),
      address: cleanText(pickField(record, CUSTOMER_COLUMNS.address)), areaTags: normalizeAreas(pickField(record, CUSTOMER_COLUMNS.area)),
      industryTags: cleanText(pickField(record, CUSTOMER_COLUMNS.industry)) ? [cleanText(pickField(record, CUSTOMER_COLUMNS.industry))] : [],
    };
    const contact = { name: cleanText(pickField(record, CUSTOMER_COLUMNS.contactName)), title: cleanText(pickField(record, CUSTOMER_COLUMNS.contactTitle)), phone: values.phone, mobile: cleanText(pickField(record, CUSTOMER_COLUMNS.mobile)), email: cleanText(pickField(record, CUSTOMER_COLUMNS.email)) };
    const existing = customerNo ? byNo.get(customerNo) : null;
    if (existing) {
      const patch = {};
      for (const field of ["name", "taxId", "phone", "address"]) if (values[field] && values[field] !== existing[field]) patch[field] = values[field];
      const areas = normalizeAreas([...(existing.areaTags || []), ...values.areaTags]);
      if (areas.length !== (existing.areaTags || []).length) patch.areaTags = areas;
      if (Object.keys(patch).length) plan.update.push({ row: record.__row, id: existing.id, name: existing.name, patch, contact });
      else plan.unchanged.push({ row: record.__row, name });
      continue;
    }
    const sameName = byName.get(companyKey(name));
    if (sameName) { plan.duplicate.push({ row: record.__row, reason: `與既有客戶「${sameName.name}」名稱相同`, name, values, contact, existingId: sameName.id }); continue; }
    plan.add.push({ row: record.__row, name, values, contact });
  }
  return plan;
}

export function planOrderImport(records, model) {
  const plan = { kind: "orders", add: [], update: [], unchanged: [], duplicate: [], invalid: [] };
  const byNo = new Map(model.customers.filter((customer) => customer.customerNo).map((customer) => [customer.customerNo, customer]));
  const byName = new Map(model.customers.map((customer) => [companyKey(customer.name), customer]));
  const existingKeys = new Set((model.all.order || []).filter((order) => !order.archivedAt).flatMap((order) => [order.orderNo ? `no:${order.orderNo}` : null, `raw:${order.customerId}|${order.orderDate}|${cleanText(order.rawMessage)}`].filter(Boolean)));
  const groups = new Map();
  for (const record of records) {
    const date = dateValue(pickField(record, ORDER_COLUMNS.date));
    const customerNo = cleanText(pickField(record, ORDER_COLUMNS.customerNo));
    const customerName = cleanText(pickField(record, ORDER_COLUMNS.customerName));
    const customer = (customerNo && byNo.get(customerNo)) || (customerName && byName.get(companyKey(customerName))) || null;
    if (!date) { plan.invalid.push({ row: record.__row, reason: "日期無法辨識" }); continue; }
    if (!customer) { plan.invalid.push({ row: record.__row, reason: `找不到客戶「${customerName || customerNo || "未填"}」，請先建立客戶或補客戶編號` }); continue; }
    const orderNo = cleanText(pickField(record, ORDER_COLUMNS.orderNo));
    const raw = cleanText(pickField(record, ORDER_COLUMNS.raw));
    const key = orderNo ? `no:${orderNo}` : `raw:${customer.id}|${date}|${raw}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, row: record.__row, problems: [],
        order: { orderNo, customerId: customer.id, customerNo: customer.customerNo || customerNo, customerName: customer.name, orderDate: date, status: ["待確認", "待交客服", "已交客服", "處理中", "已出貨", "已完成", "已取消"].includes(cleanText(pickField(record, ORDER_COLUMNS.status))) ? cleanText(pickField(record, ORDER_COLUMNS.status)) : (orderNo ? "已出貨" : "待確認"), source: orderNo ? "ERP出貨" : "LINE", deliveryMethod: cleanText(pickField(record, ORDER_COLUMNS.delivery)), taxType: cleanText(pickField(record, ORDER_COLUMNS.tax)), notes: cleanText(pickField(record, ORDER_COLUMNS.notes)), rawMessage: raw },
        items: [],
      });
    }
    const group = groups.get(key);
    const quantity = numberValue(pickField(record, ORDER_COLUMNS.quantity));
    const unitPrice = numberValue(pickField(record, ORDER_COLUMNS.unitPrice));
    const amount = numberValue(pickField(record, ORDER_COLUMNS.amount));
    if (quantity === null || Number.isNaN(quantity)) group.problems.push(`第 ${record.__row} 列數量無法辨識`);
    if (Number.isNaN(unitPrice)) group.problems.push(`第 ${record.__row} 列單價無法辨識`);
    const safeQuantity = Number.isNaN(quantity) ? null : quantity;
    const safePrice = Number.isNaN(unitPrice) ? null : unitPrice;
    group.items.push({ customerNo: group.order.customerNo, productCode: cleanText(pickField(record, ORDER_COLUMNS.productCode)), productName: cleanText(pickField(record, ORDER_COLUMNS.productName)), spec: cleanText(pickField(record, ORDER_COLUMNS.spec)), quantity: safeQuantity, unit: "", unitPrice: safePrice, amount: amount !== null && !Number.isNaN(amount) ? amount : (safeQuantity !== null && safePrice !== null ? safeQuantity * safePrice : null) });
  }
  for (const group of groups.values()) {
    if (existingKeys.has(group.key)) { plan.duplicate.push({ row: group.row, reason: "這張訂單已經匯入過", name: `${group.order.customerName} ${group.order.orderDate}` }); continue; }
    if (group.problems.length) {
      // A partly broken order is still kept whole, as a draft that needs checking.
      group.order.status = "待確認";
      group.order.notes = [group.order.notes, `匯入時待確認：${group.problems.join("；")}`].filter(Boolean).join("\n");
    }
    plan.add.push({ row: group.row, name: `${group.order.customerName} ${group.order.orderDate}（${group.items.length} 項）${group.problems.length ? "・需確認" : ""}`, order: group.order, items: group.items });
  }
  return plan;
}

export async function applyImportPlan(db, plan, { includeDuplicates = false, requestId } = {}) {
  return db.transact(requestId, async (tx) => {
    const created = { customer: 0, contact: 0, order: 0, orderItem: 0, updated: 0 };
    if (plan.kind === "customers") {
      const toAdd = [...plan.add, ...(includeDuplicates ? plan.duplicate.filter((item) => item.values) : [])];
      for (const item of toAdd) {
        const customer = await tx.create("customer", { ...item.values, aliases: [], productTags: [], segmentTags: [], important: false, relationStatus: "未接觸", nextAction: "", nextFollowUpDate: "", lastContactAt: "", notes: "", mergedIntoId: "", sourceRef: `import:row:${item.row}` });
        created.customer += 1;
        if (item.contact?.name) { await tx.create("contact", { ...item.contact, department: "", isPrimary: true, notes: "", customerId: customer.id }); created.contact += 1; }
      }
      for (const item of plan.update) { await tx.update("customer", item.id, item.patch); created.updated += 1; }
    } else {
      for (const item of plan.add) {
        const order = await tx.create("order", item.order);
        created.order += 1;
        for (const line of item.items) {
          await tx.create("orderItem", { ...line, orderId: order.id, classification: "", basis: "", signalStatus: "", signalNote: "", handledAt: null, handledBy: "", linkedOpportunityId: "" });
          created.orderItem += 1;
        }
      }
    }
    return created;
  });
}

// ---------- export in the current spreadsheet layouts ----------
const STAGE_EXPORT = { 接觸: "客戶需求訪查", 提案: "提案報價", 議價: "議價階段", 成交: "結案贏", 失敗: "結案輸", 封存: "封存" };

export function buildExportSheets(model) {
  const primary = (customerId) => {
    const contacts = model.contactsByCustomer.get(customerId) || [];
    return contacts.find((contact) => contact.isPrimary) || contacts[0] || {};
  };
  const customers = [["客戶編號", "客戶名稱", "聯絡人", "電話", "地址", "信箱", "區域", "產業／客戶類型", "重要", "下一步", "下次跟進日"],
    ...model.customers.map((customer) => { const contact = primary(customer.id); return [customer.customerNo, customer.name, contact.name || "", customer.phone || contact.phone || "", customer.address, contact.email || "", (customer.areaTags || []).join("、"), (customer.industryTags || []).join("、"), customer.important ? "★" : "", customer.nextAction, customer.nextFollowUpDate]; })];
  const contactName = (id) => (model.all.contact || []).find((contact) => contact.id === id)?.name || "";
  const activities = [["日期", "接觸方式", "客戶名稱", "區域", "產業／客戶類型", "聯絡人", "拜訪主題", "客戶反應", "結果", "完整紀錄", "我方下一步", "下次跟進日"],
    ...(model.all.activity || []).filter((activity) => !activity.archivedAt).sort((left, right) => String(right.activityDate).localeCompare(String(left.activityDate))).map((activity) => {
      const customer = model.customersById.get(activity.customerId) || {};
      return [activity.activityDate, activity.channel, customer.name || "", (customer.areaTags || []).join("、"), (customer.industryTags || []).join("、"), contactName(activity.contactId), activity.purpose, activity.reaction, activity.result, activity.detailedNote, activity.nextAction, activity.nextFollowUpDate];
    })];
  const opportunities = [["公司簡稱", "客戶窗口", "交易類別", "試驗項目", "金額(未稅)", "商機階段", "贏率", "預計結案", "最後更新", "重點摘要", "下一步建議"],
    ...(model.all.opportunity || []).filter((opportunity) => !opportunity.archivedAt).map((opportunity) => [
      model.customerName(opportunity.customerId), contactName(opportunity.contactId), opportunity.source || "", opportunity.product || opportunity.name, opportunity.amount ?? "", STAGE_EXPORT[opportunity.stage] || opportunity.stage,
      opportunity.probability === null || opportunity.probability === undefined || opportunity.probability === "" ? "" : Number(opportunity.probability) / 100, opportunity.expectedCloseDate, String(opportunity.updatedAt || "").slice(0, 10), [opportunity.name, opportunity.notes].filter(Boolean).join("\n"), opportunity.nextAction,
    ])];
  const orders = [["日期", "客戶姓名", "客戶編號", "產品編號", "訂購品項", "規格", "數量", "價格", "配送方式", "稅額", "原始訊息", "備註", "狀態", "首次購買判斷"],
    ...(model.all.order || []).filter((order) => !order.archivedAt).sort((left, right) => String(right.orderDate).localeCompare(String(left.orderDate))).flatMap((order) => (model.itemsByOrder.get(order.id) || []).map((item) => [
      order.orderDate, model.customersById.get(order.customerId)?.name || order.customerName, order.customerNo || item.customerNo, item.productCode, item.productName, item.spec, item.quantity ?? "", item.unitPrice ?? "", order.deliveryMethod, order.taxType, order.rawMessage, order.notes, order.status, item.classification,
    ]))];
  return [
    { name: "客戶資料", rows: customers },
    { name: "拜訪電訪紀錄", rows: activities },
    { name: "2026 商機重點整理", rows: opportunities },
    { name: "LINE訂單整理", rows: orders },
  ];
}
