import { comparisonKey, uniqueList } from "../core/text.js";

export const MERGE_FIELDS = Object.freeze([
  ["name", "公司名稱"], ["customerNo", "客戶編號"], ["taxId", "統編"], ["phone", "電話"], ["address", "地址"],
  ["relationStatus", "關係狀態"], ["nextAction", "下一步"], ["nextFollowUpDate", "下次提醒"], ["notes", "備註"],
]);
const UNION_FIELDS = ["areaTags", "industryTags", "productTags", "segmentTags"];
const RELATED_TYPES = ["contact", "activity", "opportunity", "order", "reminder", "stakeholder"];
const TYPE_LABELS = { contact: "聯絡人", activity: "拜訪", opportunity: "商機", order: "訂單", reminder: "提醒", stakeholder: "關鍵人物" };

function relatedOf(all, customerId) {
  return RELATED_TYPES.flatMap((type) => (all[type] || []).filter((record) => record.customerId === customerId).map((record) => ({ type, record })));
}

export function mergeImpact(all, customerId) {
  const counts = Object.fromEntries(RELATED_TYPES.map((type) => [type, 0]));
  relatedOf(all, customerId).forEach(({ type }) => { counts[type] += 1; });
  return counts;
}

export function impactLabel(counts) {
  return RELATED_TYPES.map((type) => `${TYPE_LABELS[type]} ${counts[type] || 0}`).join("、");
}

export function mergePreview(all, primaryId, secondaryId) {
  const byId = new Map((all.customer || []).map((customer) => [customer.id, customer]));
  const primary = byId.get(primaryId);
  const secondary = byId.get(secondaryId);
  if (!primary || !secondary) return { ok: false, error: "找不到要合併的客戶" };
  if (primaryId === secondaryId) return { ok: false, error: "不能和自己合併" };
  if (primary.archivedAt || secondary.archivedAt) return { ok: false, error: "已封存的客戶不能合併，請先復原" };
  const fields = MERGE_FIELDS.map(([field, label]) => ({ field, label, primary: primary[field] ?? "", secondary: secondary[field] ?? "", differs: String(primary[field] ?? "") !== String(secondary[field] ?? "") }));
  const defaults = Object.fromEntries(fields.map((item) => [item.field, !String(item.primary).trim() && String(item.secondary).trim() ? "secondary" : "primary"]));
  return { ok: true, primary, secondary, fields, defaults, impact: mergeImpact(all, secondaryId), primaryImpact: mergeImpact(all, primaryId) };
}

// "林文聖" and "林文聖課長" / "林文聖 先生" are the same person; two different
// names never are, even if one is short.
const TITLE_SUFFIX = /(先生|小姐|女士|經理|副理|課長|組長|主任|廠長|老師|教授|博士|專員|技術員|研究員)+$/u;
export function samePerson(left, right) {
  const key = (value) => comparisonKey(value).replace(TITLE_SUFFIX, "");
  const a = key(left);
  const b = key(right);
  return a.length >= 2 && a === b;
}

function pick(record, fields) {
  return Object.fromEntries(fields.map((field) => [field, record[field] ?? null]));
}

// Everything happens in one transaction; the event keeps what undo needs.
export async function mergeCustomers(db, { primaryId, secondaryId, selections = {} }, requestId) {
  if (!primaryId || !secondaryId || primaryId === secondaryId) return { ok: false, error: "invalid-merge" };
  return db.transact(requestId, async (tx) => {
    const primary = await tx.get("customer", primaryId);
    const secondary = await tx.get("customer", secondaryId);
    if (!primary || !secondary || primary.archivedAt || secondary.archivedAt) tx.fail("customer-unavailable", { message: "客戶不存在或已封存" });

    const touched = [...MERGE_FIELDS.map(([field]) => field), ...UNION_FIELDS, "aliases", "important", "lastContactAt"];
    const primaryBefore = pick(primary, touched);
    const patch = {};
    for (const [field] of MERGE_FIELDS) patch[field] = selections[field] === "secondary" ? secondary[field] ?? "" : primary[field] ?? "";
    for (const field of UNION_FIELDS) patch[field] = uniqueList([...(primary[field] || []), ...(secondary[field] || [])]);
    patch.aliases = uniqueList([...(primary.aliases || []), ...(secondary.aliases || []), primary.name, secondary.name].filter((name) => name && name !== patch.name));
    patch.important = Boolean(primary.important || secondary.important);
    patch.lastContactAt = [primary.lastContactAt, secondary.lastContactAt].filter(Boolean).sort().pop() || "";
    await tx.update("customer", primaryId, patch);

    const primaryContacts = (await tx.list("contact")).filter((contact) => contact.customerId === primaryId);
    const primaryHasMainContact = primaryContacts.some((contact) => contact.isPrimary);
    const moved = [];
    for (const type of RELATED_TYPES) {
      for (const record of await tx.list(type, { includeArchived: true })) {
        if (record.customerId !== secondaryId) continue;
        const change = { customerId: primaryId };
        if (type === "contact" && record.isPrimary && primaryHasMainContact) change.isPrimary = false;
        // The same person typed into two sheets: keep the kept customer's copy, archive this one.
        const sameContact = type === "contact" && !record.archivedAt && primaryContacts.some((contact) => samePerson(contact.name, record.name));
        moved.push({ type, id: record.id, before: pick(record, Object.keys(change)), archivedByMerge: sameContact });
        await tx.update(type, record.id, change);
        if (sameContact) await tx.archive(type, record.id, "合併時重複的聯絡人");
        else if (type === "contact" && !record.archivedAt) primaryContacts.push({ ...record, ...change });
      }
    }
    await tx.update("customer", secondaryId, { mergedIntoId: primaryId });
    await tx.archive("customer", secondaryId, `合併至「${patch.name}」`);
    const counts = Object.fromEntries(RELATED_TYPES.map((type) => [type, moved.filter((item) => item.type === type).length]));
    const event = await tx.create("archiveEvent", {
      eventType: "merge", entityType: "customer", entityId: secondaryId, relatedIds: [primaryId], reason: `「${secondary.name}」合併至「${primary.name}」`,
      snapshot: { primaryId, secondaryId, primaryBefore, secondaryName: secondary.name, moved, selections: { ...selections } },
      impactSummary: impactLabel(counts), undoneAt: null, undoneBy: "",
    });
    return { eventId: event.id, moved: moved.length, counts };
  });
}

export async function undoMerge(db, eventId, requestId) {
  return db.transact(requestId, async (tx) => {
    const event = await tx.get("archiveEvent", eventId);
    if (!event || event.eventType !== "merge") tx.fail("not-found", { message: "找不到這筆合併紀錄" });
    if (event.undoneAt) tx.fail("already-undone", { message: "這筆合併已經取消過了" });
    const { primaryId, secondaryId, primaryBefore, moved = [] } = event.snapshot || {};
    const primary = await tx.get("customer", primaryId);
    const secondary = await tx.get("customer", secondaryId);
    if (!primary || !secondary) tx.fail("customer-unavailable", { message: "合併相關的客戶已不存在" });
    if (primary.archivedAt) tx.fail("primary-archived", { message: "主要客戶目前是封存狀態，請先復原主要客戶再取消合併" });

    await tx.update("customer", primaryId, primaryBefore);
    if (secondary.archivedAt) await tx.restore("customer", secondaryId);
    await tx.update("customer", secondaryId, { mergedIntoId: "" });
    let restored = 0;
    for (const item of moved) {
      const record = await tx.get(item.type, item.id);
      if (!record) continue;
      if (item.archivedByMerge && record.archivedAt) await tx.restore(item.type, item.id);
      await tx.update(item.type, item.id, { ...item.before, customerId: secondaryId });
      restored += 1;
    }
    await tx.update("archiveEvent", eventId, { undoneAt: tx.now(), undoneBy: tx.actor });
    await tx.create("archiveEvent", { eventType: "unmerge", entityType: "customer", entityId: secondaryId, relatedIds: [primaryId, eventId], reason: `取消合併：${event.reason}`, snapshot: { restored }, impactSummary: `已移回 ${restored} 筆關聯資料`, undoneAt: null, undoneBy: "" });
    return { restored };
  });
}
