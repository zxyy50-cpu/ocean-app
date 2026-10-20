import { companyKey, comparisonKey } from "../core/text.js";
import { mergeImpact, mergePreview, MERGE_FIELDS } from "./merge.js";
import { areaFamily, customerInAreas } from "./tags.js";

// 同一家公司: the imported lists brought the same company in under several names
// (「第一生化」, 「台灣第一生化科技」, 「台灣第一生化科技股份有限公司嘉義保健飲料廠」).
// Records belong to one family when they share a tax ID, or one name is contained in the
// other within the same county. Families only group the search; merging is suggested just
// for the clear cases inside a family (same address, or an empty list entry).

const COUNTIES = ["雲林", "嘉義", "高雄", "屏東", "台南", "台中"];
const FIELD_LABELS = Object.fromEntries(MERGE_FIELDS);

// 「台灣第一生化科技股份有限公司嘉義保健飲料廠」→「第一生化科技」
export function companyCore(name) {
  const whole = companyKey(name).replace(/^(台灣|臺灣)/u, "");
  let key = whole;
  for (let i = 0; i < 3; i += 1) {
    key = key.replace(/(第?[一二三四五六七八九十\d]+廠|[^廠]{0,8}(分公司|工廠|總廠|廠))$/u, "");
  }
  key = key.replace(/(股份有限公司|有限公司|股份公司|公司)$/u, "");
  // 「福義軒食品廠」 is the company's own name, not a factory suffix.
  return key.length >= 3 ? key : whole;
}

// The street and number, so 「工業二路12-1號」 and 「工業二路１２－１號」 match.
export function streetKey(address) {
  const text = comparisonKey(String(address || "").normalize("NFKC").replace(/臺/g, "台"));
  const match = text.match(/([^縣市鄉鎮區村里]{1,8}(路|街|大道)(\d+段)?(\d+巷)?(\d+弄)?\d+(之\d+)?(\d+)?號)/u);
  return match ? match[1] : "";
}

function countyOf(customer) {
  return (customer.areaTags || []).flatMap(areaFamily).find((area) => COUNTIES.includes(area)) || "";
}

const cache = new WeakMap();

// Union-find over all live customers; cached per model.
export function familyIndex(model) {
  if (cache.has(model)) return cache.get(model);
  const customers = model.customers.filter((customer) => !customer.archivedAt);
  const parent = new Map(customers.map((customer) => [customer.id, customer.id]));
  const find = (id) => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  const join = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const byTax = new Map();
  const byCore = new Map();
  for (const customer of customers) {
    const tax = String(customer.taxId || "").trim();
    if (/^\d{8}$/.test(tax)) byTax.set(tax, [...(byTax.get(tax) || []), customer.id]);
    const core = companyCore(customer.name);
    if (core.length >= 3) byCore.set(core, [...(byCore.get(core) || []), customer]);
  }
  // Not the address alone: in industrial zones several different companies share one.
  for (const ids of byTax.values()) ids.slice(1).forEach((id) => join(ids[0], id));
  // One name inside another (at least 3 characters), in the same county or where one has none.
  for (const customer of customers) {
    const core = companyCore(customer.name);
    const county = countyOf(customer);
    for (let start = 0; start < core.length; start += 1) {
      for (let end = start + 3; end <= core.length; end += 1) {
        for (const other of byCore.get(core.slice(start, end)) || []) {
          if (other.id === customer.id) continue;
          const otherCounty = countyOf(other);
          if (county && otherCounty && county !== otherCounty) continue;
          join(customer.id, other.id);
        }
      }
    }
  }
  const members = new Map();
  for (const customer of customers) {
    const root = find(customer.id);
    members.set(root, [...(members.get(root) || []), customer]);
  }
  const familyOf = new Map();
  for (const list of members.values()) for (const customer of list) familyOf.set(customer.id, list);
  const index = { familyOf, families: [...members.values()].filter((list) => list.length > 1) };
  cache.set(model, index);
  return index;
}

function weight(model, customer) {
  return (customer.customerNo ? 1000 : 0)
    + ((model.activitiesByCustomer.get(customer.id) || []).length + (model.opportunitiesByCustomer.get(customer.id) || []).length + (model.ordersByCustomer.get(customer.id) || []).length) * 10
    + (customer.address ? 3 : 0) + (customer.taxId ? 2 : 0);
}

// The record to show first (and keep): customer number, then the most history.
// With `hit`, a family where nobody has a number or history shows the record that was found.
export function familyLead(model, members, hit = null) {
  const lead = [...members].sort((a, b) => weight(model, b) - weight(model, a) || a.name.length - b.name.length)[0];
  return hit && weight(model, lead) < 10 ? hit : lead;
}

function isShell(model, customer) {
  return !customer.address && !customer.customerNo && !customer.taxId
    && !(model.activitiesByCustomer.get(customer.id) || []).length && !(model.opportunitiesByCustomer.get(customer.id) || []).length && !(model.ordersByCustomer.get(customer.id) || []).length;
}

// Clear duplicates only: the same address as the kept record, or a list entry with nothing of
// its own. Factories at other addresses (same tax ID) stay separate customers.
export function familyMergeSuggestions(model, { myAreas = [], mineOnly = true } = {}) {
  const suggestions = [];
  for (const members of familyIndex(model).families) {
    if (mineOnly && !members.some((customer) => customerInAreas(customer, myAreas))) continue;
    const primary = familyLead(model, members);
    const street = streetKey(primary.address);
    const primaryKey = companyKey(primary.name);
    const secondaries = members.filter((customer) => {
      if (customer.id === primary.id || companyKey(customer.name) === primaryKey) return false; // same name: 整理同名客戶 handles it
      if (customer.customerNo && primary.customerNo && customer.customerNo !== primary.customerNo) return false;
      const theirs = streetKey(customer.address);
      if (theirs && street) return theirs === street;
      // 「光泉牧場股份有限公司 大園廠」 names another plant: same company, different site.
      const plant = String(customer.name).match(/([^\s　]{1,4})(?:廠|分公司)/u)?.[1];
      if (plant && !String(primary.name).includes(plant)) return false;
      return isShell(model, customer);
    }).map((customer) => {
      const preview = mergePreview(model.all, primary.id, customer.id);
      const filled = preview.ok ? Object.entries(preview.defaults).filter(([, side]) => side === "secondary").map(([field]) => FIELD_LABELS[field]) : [];
      return { customer, impact: mergeImpact(model.all, customer.id), filled, why: streetKey(customer.address) ? "同一個地址" : "名單上只有名稱，沒有其他資料" };
    });
    if (secondaries.length) suggestions.push({ key: `family:${primary.id}`, primary, secondaries, inMine: members.some((customer) => customerInAreas(customer, myAreas)) });
  }
  return suggestions.sort((a, b) => a.primary.name.localeCompare(b.primary.name, "zh-Hant"));
}
