import { cleanText, companyKey, uniqueList } from "../core/text.js";
import { areaFamily, normalizeAreas } from "./tags.js";

// Bulk import of prospects (public factory registry + Ocean's own lists).
// Exact matches (tax ID, customer number, same company name) only fill in what the existing
// customer is missing; similar names are listed for Ocean to decide (default: a new customer);
// everything else is added as a new, not-yet-contacted customer.

const COUNTIES = ["雲林", "嘉義", "高雄", "屏東"];
const countyOf = (tags = []) => tags.flatMap(areaFamily).find((area) => COUNTIES.includes(area)) || "";
const isZone = (tag) => !COUNTIES.includes(tag);

function activityScore(model, customer) {
  return (customer.customerNo ? 100 : 0) + (model.activitiesByCustomer.get(customer.id) || []).length * 5 + (model.ordersByCustomer.get(customer.id) || []).length;
}

function best(model, customers = []) {
  return [...customers].sort((left, right) => activityScore(model, right) - activityScore(model, left))[0] || null;
}

// What an existing customer gains from a prospect record: only empty fields and new tags.
export function enrichPatch(customer, prospect) {
  const patch = {};
  for (const field of ["taxId", "customerNo", "phone", "address"]) {
    if (prospect[field] && !cleanText(customer[field])) patch[field] = prospect[field];
  }
  const areas = customer.areaTags || [];
  const zone = (prospect.areaTags || []).find(isZone);
  if (zone && !areas.some(isZone)) patch.areaTags = normalizeAreas([...areas, zone]);
  else if (!areas.length && (prospect.areaTags || []).length) patch.areaTags = normalizeAreas(prospect.areaTags);
  const industry = uniqueList([...(customer.industryTags || []), ...(prospect.industryTags || [])]);
  if (industry.length !== (customer.industryTags || []).length) patch.industryTags = industry;
  const segments = uniqueList([...(customer.segmentTags || []), ...(prospect.segmentTags || [])]);
  if (segments.length !== (customer.segmentTags || []).length) patch.segmentTags = segments;
  const note = cleanText(prospect.notes);
  if (note && !String(customer.notes || "").includes(note)) patch.notes = [customer.notes, `【名單】${prospect.notes}`].filter(Boolean).join("\n");
  return patch;
}

export function planProspectImport(prospects = [], model) {
  const customers = model.customers;
  const knownRefs = new Set(Object.values(model.all).flat().map((record) => record.sourceRef).filter(Boolean));
  const byNo = new Map(customers.filter((customer) => customer.customerNo).map((customer) => [customer.customerNo, customer]));
  const byTax = new Map(customers.filter((customer) => customer.taxId).map((customer) => [customer.taxId, customer]));
  const byKey = new Map();
  for (const customer of customers) {
    const key = companyKey(customer.name);
    if (key) byKey.set(key, [...(byKey.get(key) || []), customer]);
  }
  const keys = [...byKey.keys()].filter((key) => key.length >= 4);
  const plan = { add: [], enrich: [], similar: [], unchanged: 0, skipped: 0, areas: {} };
  for (const prospect of prospects) {
    if ((prospect.refs || [prospect.ref]).some((ref) => knownRefs.has(ref))) { plan.skipped += 1; continue; }
    const key = companyKey(prospect.name);
    const exact = (prospect.customerNo && byNo.get(prospect.customerNo)) || (prospect.taxId && byTax.get(prospect.taxId)) || best(model, byKey.get(key));
    if (exact) {
      const patch = enrichPatch(exact, prospect);
      if (Object.keys(patch).length) plan.enrich.push({ prospect, customer: exact, patch });
      else plan.unchanged += 1;
      continue;
    }
    // "勤億蛋品" vs "勤億蛋品科技": one name starts with the other, in the same county.
    const county = countyOf(prospect.areaTags);
    const similarKey = key.length >= 4 && keys.find((other) => (other.startsWith(key) || key.startsWith(other)) && other !== key
      && byKey.get(other).some((customer) => !countyOf(customer.areaTags) || !county || countyOf(customer.areaTags) === county));
    if (similarKey) {
      plan.similar.push({ prospect, customer: best(model, byKey.get(similarKey)) });
      continue;
    }
    plan.add.push({ prospect });
  }
  for (const { prospect } of [...plan.add, ...plan.similar]) {
    const area = prospect.areaTags?.[0] || "未分類";
    plan.areas[area] = (plan.areas[area] || 0) + 1;
  }
  return plan;
}

function newCustomer(prospect) {
  return {
    name: prospect.name, customerNo: prospect.customerNo || "", taxId: prospect.taxId || "", phone: prospect.phone || "", address: prospect.address || "",
    areaTags: normalizeAreas(prospect.areaTags || []), industryTags: uniqueList(prospect.industryTags || []), productTags: [], segmentTags: uniqueList(prospect.segmentTags || []),
    aliases: [], important: false, relationStatus: "未接觸", nextAction: "", nextFollowUpDate: "", lastContactAt: "", notes: prospect.notes || "", mergedIntoId: "",
    sourceRef: prospect.ref,
  };
}

// Applied in chunks so thousands of rows never sit in one huge transaction; each chunk is all-or-nothing.
export async function applyProspectPlan(db, plan, { mergeSimilar = new Set(), requestId, chunk = 200, onProgress = () => {} } = {}) {
  const work = [
    ...plan.add.map((item) => ({ kind: "add", prospect: item.prospect })),
    ...plan.similar.map((item, index) => (mergeSimilar.has(index) ? { kind: "enrich", customer: item.customer, patch: enrichPatch(item.customer, item.prospect) } : { kind: "add", prospect: item.prospect })),
    ...plan.enrich.map((item) => ({ kind: "enrich", customer: item.customer, patch: item.patch })),
  ];
  const done = { added: 0, enriched: 0, contacts: 0, failed: 0 };
  for (let start = 0; start < work.length; start += chunk) {
    const slice = work.slice(start, start + chunk);
    const counts = { added: 0, enriched: 0, contacts: 0 };
    const result = await db.transact(`${requestId}:${start}`, async (tx) => {
      for (const item of slice) {
        if (item.kind === "add") {
          const customer = await tx.create("customer", newCustomer(item.prospect));
          counts.added += 1;
          const contact = item.prospect.contact || {};
          if (cleanText(contact.name)) { await tx.create("contact", { name: cleanText(contact.name), title: "", department: "", phone: cleanText(contact.phone || item.prospect.phone), mobile: "", email: cleanText(contact.email), isPrimary: true, notes: "", customerId: customer.id }); counts.contacts += 1; }
        } else if (Object.keys(item.patch).length) {
          await tx.update("customer", item.customer.id, item.patch);
          counts.enriched += 1;
        }
      }
    });
    if (result.ok) Object.keys(counts).forEach((key) => { done[key] += counts[key]; });
    else done.failed += slice.length;
    onProgress({ done: Math.min(start + chunk, work.length), total: work.length });
  }
  return done;
}
