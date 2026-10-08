import { applyPlan, customerIdBySourceRef, existingSourceRefs, idsBySourceRef, planLegacyImport, planSnapshotImport, readLegacyState } from "./migration.js";

export function validateSnapshot(value) {
  if (!value || typeof value !== "object") return "檔案內容不是快照格式";
  if (value.schemaVersion !== 2) return "只支援第 2 版快照（schemaVersion 2）";
  if (!Array.isArray(value.customers)) return "快照缺少客戶清單";
  return null;
}

export async function previewSnapshotImport(db, snapshot) {
  const problem = validateSnapshot(snapshot);
  if (problem) return { ok: false, error: problem };
  const plan = planSnapshotImport(snapshot, { existingIdsBySourceRef: await idsBySourceRef(db) });
  return { ok: true, plan, counts: plan.counts, skipped: plan.skipped, issues: plan.issues, snapshotId: snapshot.snapshotId || "snapshot", snapshot: { toolkit: snapshot.toolkit || [], kpis: snapshot.kpis || [], generatedAt: snapshot.generatedAt } };
}

export async function applySnapshotImport(db, preview, { storage = globalThis.localStorage } = {}) {
  const result = await applyPlan(db, preview.plan, `import:${preview.snapshotId}:${preview.plan.customer[0]?.id || "empty"}`);
  if (!result.ok) return result;
  const legacy = planLegacyImport(readLegacyState(storage), await customerIdBySourceRef(db), { existingSourceRefs: await existingSourceRefs(db) });
  let legacyResult = { ok: true, value: { created: {} } };
  if (legacy.activity.length || legacy.reminder.length || legacy.importantCustomerIds.length) {
    legacyResult = await applyPlan(db, legacy, `import:legacy:${legacy.activity[0]?.id || legacy.reminder[0]?.id || "flags"}`);
  }
  const snapshot = preview.snapshot || {};
  if ((snapshot.toolkit || []).length || (snapshot.kpis || []).length) {
    await db.setMeta("reference", { toolkit: snapshot.toolkit || [], kpis: snapshot.kpis || [], transactions: [], capturedAt: snapshot.generatedAt || null });
  }
  const drafts = await db.getMeta("visitDrafts", {});
  await db.setMeta("visitDrafts", { ...legacy.drafts, ...drafts });
  return { ok: true, created: result.value.created, legacy: { created: legacyResult.value?.created || {}, issues: legacy.issues, drafts: Object.keys(legacy.drafts).length } };
}
