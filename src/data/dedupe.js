import { companyKey } from "../core/text.js";
import { duplicateGroups } from "./customers.js";
import { mergeCustomers, mergeImpact, mergePreview, MERGE_FIELDS } from "./merge.js";
import { groupInMyAreas } from "./tags.js";

const FIELD_LABELS = Object.fromEntries(MERGE_FIELDS);

// Batch clean-up of same-name customers. Only the safe case is suggested: exactly one
// record in the group has an ERP customer number, so it is the one to keep and the
// others (typed into separate spreadsheets) fold into it. Groups where several records
// carry different numbers are often different plants and are never suggested.
export function mergeSuggestions(model, { myAreas = [], mineOnly = true } = {}) {
  const suggestions = [];
  let skippedSeveralNumbers = 0;
  let skippedNoNumber = 0;
  for (const members of withAliasMatches(model.customers, duplicateGroups(model.customers))) {
    const numbered = members.filter((customer) => String(customer.customerNo || "").trim());
    if (numbered.length > 1) { skippedSeveralNumbers += 1; continue; }
    if (!numbered.length) { skippedNoNumber += 1; continue; }
    const inMine = groupInMyAreas(members, myAreas);
    if (mineOnly && !inMine) continue;
    const primary = numbered[0];
    const secondaries = members.filter((customer) => customer.id !== primary.id).map((customer) => {
      const preview = mergePreview(model.all, primary.id, customer.id);
      const filled = preview.ok ? Object.entries(preview.defaults).filter(([, side]) => side === "secondary").map(([field]) => FIELD_LABELS[field]) : [];
      return { customer, impact: mergeImpact(model.all, customer.id), filled };
    });
    suggestions.push({ key: companyKey(primary.name), primary, secondaries, inMine });
  }
  suggestions.sort((left, right) => Number(right.inMine) - Number(left.inMine) || left.primary.name.localeCompare(right.primary.name, "zh-Hant"));
  return { suggestions, skippedSeveralNumbers, skippedNoNumber };
}

// A numbered customer renamed to its 簡稱 keeps the old name as an alias (「雲乳食品」 was
// 「雲乳食品科技股份有限公司」); a record without a number still called by that old name is the same
// customer. Only an alias that belongs to exactly one numbered customer counts.
function withAliasMatches(customers, groups) {
  const live = customers.filter((customer) => !customer.archivedAt);
  const owners = new Map();
  for (const customer of live) {
    if (!String(customer.customerNo || "").trim()) continue;
    for (const key of new Set([customer.name, ...(customer.aliases || [])].map(companyKey))) {
      if (key.length < 4) continue;
      owners.set(key, owners.has(key) && owners.get(key)?.id !== customer.id ? null : customer);
    }
  }
  const grouped = new Set(groups.flat().map((customer) => customer.id));
  const extra = new Map();
  for (const customer of live) {
    if (grouped.has(customer.id) || String(customer.customerNo || "").trim()) continue;
    const owner = owners.get(companyKey(customer.name));
    if (!owner) continue;
    extra.set(owner.id, [...(extra.get(owner.id) || []), customer]);
  }
  const merged = groups.map((members) => {
    const owner = members.find((customer) => extra.has(customer.id));
    if (!owner) return members;
    const added = extra.get(owner.id);
    extra.delete(owner.id);
    return [...members, ...added];
  });
  for (const [ownerId, added] of extra) merged.push([live.find((customer) => customer.id === ownerId), ...added]);
  return merged;
}

// Merges each secondary into the kept record as its own undoable merge event.
// Empty fields on the kept record are filled from the other record; nothing filled is overwritten.
export async function mergeSuggestion(db, suggestion, requestId) {
  const results = [];
  for (const { customer } of suggestion.secondaries) {
    const preview = mergePreview(db.peekAll(), suggestion.primary.id, customer.id);
    if (!preview.ok) { results.push({ ok: false, id: customer.id, error: preview.error }); continue; }
    const result = await mergeCustomers(db, { primaryId: suggestion.primary.id, secondaryId: customer.id, selections: preview.defaults }, `${requestId}:${customer.id}`);
    results.push({ ok: result.ok, id: customer.id, error: result.message || result.error });
  }
  return { ok: results.every((result) => result.ok), merged: results.filter((result) => result.ok).length, results };
}

export async function applyMergeSuggestions(db, suggestions, requestId, onProgress = () => {}) {
  let merged = 0;
  let failed = 0;
  for (const [index, suggestion] of suggestions.entries()) {
    const result = await mergeSuggestion(db, suggestion, `${requestId}:${suggestion.primary.id}`);
    merged += result.merged;
    failed += result.results.length - result.merged;
    onProgress({ done: index + 1, total: suggestions.length });
  }
  return { groups: suggestions.length, merged, failed };
}
