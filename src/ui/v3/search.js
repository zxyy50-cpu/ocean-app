import { globalSearch, snippet } from "../../data/search.js";
import { loadReference } from "../../data/line-orders.js";
import { quoteCandidates } from "../../data/quote.js";
import { familyIndex, familyLead } from "../../data/company-family.js";
import { comparisonKey } from "../../core/text.js";
import { opportunityTitle } from "../../data/products.js";
import { openMergeGroupDialog } from "../forms/merge-group.js";
import { customerIdentity } from "../../data/model.js";
import { badge, emptyState, h, money } from "../dom.js";
import { searchCustomers } from "../../data/customers.js";
import { AREA_PARENTS, areaOptions } from "../../data/tags.js";
import { openCustomerEditor } from "../forms/customer-forms.js";
import { registerPage } from "../app.js";

// 搜尋 also does what 客戶探索 did: filter by area or ★, and add a customer.
const state = { query: "", areas: [], importantOnly: false };
let catalog = null;

export function resetSearchState() {
  Object.assign(state, { query: "", areas: [], importantOnly: false });
  catalog = null;
}

// Records of one company (factories, names from other lists) show as one row, the main record first.
function companyRows(ctx, hits) {
  const { familyOf } = familyIndex(ctx.model);
  const seen = new Set();
  const rows = [];
  for (const { customer, outsideMyAreas } of hits) {
    if (seen.has(customer.id)) continue;
    const members = familyOf.get(customer.id) || [customer];
    members.forEach((member) => seen.add(member.id));
    const lead = familyLead(ctx.model, members, customer);
    rows.push({ lead, others: members.filter((member) => member.id !== lead.id), outsideMyAreas });
  }
  return rows;
}

// 產品 (商品清單): each row opens 產品報價 with that product already added.
// Only products whose text contains the whole query: 「第一」 must not match 「一次增殖」.
function productGroup(query) {
  if (!catalog?.productList?.length) return null;
  const key = comparisonKey(query);
  const found = quoteCandidates(catalog, query, 12).filter((product) => comparisonKey(`${product.code} ${product.name} ${product.nameZh} ${product.spec}`).includes(key)).slice(0, 6);
  if (!found.length) return null;
  return group("產品（報價）", found.length, found.length, found.map((product) => h("li", {}, [h("a", { href: `#/line-order?mode=quote&code=${encodeURIComponent(product.code)}`, dataset: { searchProduct: product.code } }, [
    h("strong", {}, highlight(`${product.code}｜${product.name}`, query)),
    h("small", { className: "muted", text: [product.nameZh, product.spec, product.listPrice !== null ? `定價 ${money(product.listPrice)}` : "定價未填"].filter(Boolean).join("・") }),
  ])])));
}

// Wraps every occurrence of the query in <mark>, without touching HTML.
export function highlight(text, query) {
  const value = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return [value];
  const parts = [];
  const lower = value.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  let from = 0;
  for (let at = lower.indexOf(target); at >= 0; at = lower.indexOf(target, from)) {
    if (at > from) parts.push(value.slice(from, at));
    parts.push(h("mark", { text: value.slice(at, at + needle.length) }));
    from = at + needle.length;
  }
  if (from < value.length) parts.push(value.slice(from));
  return parts;
}

function group(title, total, shown, rows) {
  if (!rows.length) return null;
  return h("section", { className: "search-group", dataset: { searchGroup: title } }, [
    h("div", { className: "section-head" }, [h("h2", { text: title }), badge(total > shown ? `${shown} / ${total}` : String(total))]),
    h("ul", { className: "result-rows" }, rows),
  ]);
}

function recent(ctx) {
  const customers = [...ctx.model.customers].filter((customer) => customer.lastContactAt).sort((left, right) => String(right.lastContactAt).localeCompare(String(left.lastContactAt))).slice(0, 8);
  if (!customers.length) return emptyState("輸入公司、人名、電話或任何關鍵字", "連拜訪紀錄裡寫過的內容都找得到。");
  return group("最近聯絡", customers.length, customers.length, customers.map((customer) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}` }, [h("strong", { text: customer.name }), h("small", { className: "muted", text: customerIdentity(ctx.model, customer) })])])));
}

export function renderSearch(ctx, route) {
  if (route.query.get("q") !== null && route.query.get("q") !== state.query) state.query = route.query.get("q");
  const results = h("div", { className: "stack", dataset: { searchResults: "" } });
  const draw = () => {
    const query = state.query;
    const filtering = state.areas.length > 0 || state.importantOnly;
    if (!query.trim() && !filtering) {
      const priority = searchCustomers(ctx.model, { myAreas: ctx.settings.myAreas, today: ctx.today(), limit: 8 });
      results.replaceChildren(...[
        priority.items.length ? group("重要與待跟進", priority.total, priority.items.length, priority.items.map(({ customer }) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}` }, [h("strong", { text: `${customer.important ? "★ " : ""}${customer.name}` }), h("small", { className: "muted", text: customerIdentity(ctx.model, customer) })])]))) : null,
        recent(ctx),
      ].filter(Boolean));
      return;
    }
    const found = query.trim() ? globalSearch(ctx.model, query, { myAreas: ctx.settings.myAreas, today: ctx.today() }) : { customers: [], activities: [], opportunities: [], items: [], totals: { customers: 0, activities: 0, opportunities: 0, items: 0 } };
    // With an area or ★ chosen, the customer list follows the filters (what 客戶探索 used to show).
    if (filtering) {
      const filtered = searchCustomers(ctx.model, { query, areas: state.areas, importantOnly: state.importantOnly, myAreas: ctx.settings.myAreas, today: ctx.today(), limit: 60 });
      found.customers = filtered.items;
      found.totals = { ...found.totals, customers: filtered.total };
    }
    // Same-name records get one 「整理」 button (on the first of them shown).
    const offered = new Set();
    const tidyButton = (customer) => {
      const twins = ctx.model.sameNameGroup(customer);
      const key = twins.map((item) => item.id).sort().join(",");
      if (twins.length < 2 || offered.has(key)) return null;
      offered.add(key);
      return h("button", { type: "button", className: "small ghost", dataset: { tidyGroup: customer.id }, text: `同名 ${twins.length} 筆・整理`, onClick: () => openMergeGroupDialog(ctx, twins, { onDone: () => { ctx.rebuild(); draw(); } }) });
    };
    const sections = [
      (() => {
        const rows = companyRows(ctx, found.customers);
        return group("客戶", found.totals.customers, found.customers.length, rows.map(({ lead, others, outsideMyAreas }) => h("li", { className: "result-with-action", dataset: { searchCompany: lead.id } }, [
          h("div", { className: "search-company" }, [
            h("a", { href: `#/customer/${encodeURIComponent(lead.id)}` }, [
              h("strong", {}, highlight(lead.name, query)),
              h("small", { className: "muted", text: [customerIdentity(ctx.model, lead), outsideMyAreas ? "非我的區域" : ""].filter(Boolean).join("・") }),
            ]),
            others.length ? h("details", { className: "search-family", dataset: { searchFamily: lead.id } }, [
              h("summary", { text: `同公司另有 ${others.length} 筆（工廠或其他名單上的名稱）` }),
              h("ul", {}, others.map((customer) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}` }, [h("span", {}, highlight(customer.name, query)), h("small", { className: "muted", text: customerIdentity(ctx.model, customer) })])]))),
            ]) : null,
          ]),
          tidyButton(lead),
        ])));
      })(),
      group("拜訪內容", found.totals.activities, found.activities.length, found.activities.map(({ activity, text }) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(activity.customerId)}` }, [
        h("strong", { text: `${ctx.model.customerName(activity.customerId)}・${activity.activityDate} ${activity.channel || ""}` }),
        h("span", {}, highlight(text, query)),
      ])]))),
      group("商機", found.totals.opportunities, found.opportunities.length, found.opportunities.map((opportunity) => {
        // Some imported names are whole paragraphs: show a short name, and where the keyword was found.
        const name = opportunityTitle(opportunity, 30);
        const where = [opportunity.name, opportunity.product, opportunity.nextAction, opportunity.notes].find((value) => String(value || "").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
        return h("li", {}, [h("a", { href: `#/case/${encodeURIComponent(opportunity.id)}` }, [
          h("strong", {}, highlight(name, query)),
          where && where !== opportunity.name ? h("span", {}, highlight(snippet(where, query), query)) : null,
          h("small", { className: "muted", text: [ctx.model.customerName(opportunity.customerId), opportunity.stage, opportunity.amount ? money(opportunity.amount) : null].filter(Boolean).join("・") }),
        ])]);
      })),
      productGroup(query),
      group("買過的產品", found.totals.items, found.items.length, found.items.map(({ item, order }) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(order.customerId)}?tab=orders` }, [
        h("strong", {}, highlight(item.productName || item.productCode, query)),
        h("small", { className: "muted", text: [ctx.model.customerName(order.customerId), order.orderDate, item.productCode].filter(Boolean).join("・") }),
      ])]))),
    ].filter(Boolean);
    results.replaceChildren(...(sections.length ? sections : [emptyState(query.trim() ? `找不到「${query}」` : "這個條件下沒有客戶", "換個關鍵字或區域試試：公司簡稱、聯絡人、電話後四碼、產品名稱。", addCustomerButton(ctx))]));
  };
  const options = areaOptions(ctx.model.customers, ctx.settings.myAreas);
  const areaChip = (option) => h("label", { className: "chip" }, [
    h("input", { type: "checkbox", value: option.area, checked: state.areas.includes(option.area), dataset: { areaFilter: option.area }, onChange: (event) => {
      state.areas = event.target.checked ? [...state.areas, option.area] : state.areas.filter((area) => area !== option.area);
      draw();
    } }),
    h("span", { text: `${option.area} ${option.count}` }),
  ]);
  // Counties up front; the many industrial zones and other areas fold away.
  const counties = options.mine.filter((option) => !AREA_PARENTS[option.area]);
  const zones = options.mine.filter((option) => AREA_PARENTS[option.area]);
  const zoneOpen = state.areas.some((area) => zones.some((option) => option.area === area));
  const otherOpen = state.areas.some((area) => options.others.some((option) => option.area === area));
  const filters = h("div", { className: "search-filters", dataset: { searchFilters: "" } }, [
    ...counties.map(areaChip),
    h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.importantOnly, dataset: { importantOnly: "" }, onChange: (event) => { state.importantOnly = event.target.checked; draw(); } }), h("span", { text: "★ 只看重要" })]),
    addCustomerButton(ctx),
    zones.length ? h("details", { className: "other-areas", open: zoneOpen }, [h("summary", { text: `工業區（${zones.length}）` }), h("div", { className: "chip-group" }, zones.map(areaChip))]) : null,
    options.others.length ? h("details", { className: "other-areas", open: otherOpen }, [h("summary", { text: `其他區域（${options.others.length}）` }), h("div", { className: "chip-group" }, options.others.map(areaChip))]) : null,
  ]);
  // 商品清單 lives in the order reference; once it is loaded, products show up too.
  loadReference(ctx.db).then((loaded) => {
    if (loaded.reference === catalog) return;
    catalog = loaded.reference;
    if (state.query.trim()) draw();
  }).catch(() => {});
  const input = h("input", { type: "search", value: state.query, placeholder: "公司、人名、電話、料號、產品或拜訪內容", "aria-label": "搜尋全部資料", dataset: { globalSearch: "" }, enterkeyhint: "search", autocomplete: "off" });
  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.query = input.value; draw(); }, 150); });
  draw();
  setTimeout(() => { if (!state.query) input.focus?.(); }, 0);
  return h("div", { className: "stack" }, [h("div", { className: "search-box sticky-search" }, [input]), filters, results]);
}

function addCustomerButton(ctx) {
  return h("button", { type: "button", className: "small ghost", dataset: { addCustomer: "" }, text: "＋ 新增客戶", onClick: () => openCustomerEditor(ctx, { onSaved: (customer) => ctx.navigate(`customer/${customer.id}`) }) });
}

registerPage("search", { title: "搜尋", render: renderSearch, keepOnDataChange: true });
// 客戶探索 now lives here; its old link opens this page.
registerPage("customers", { title: "搜尋", render: renderSearch, keepOnDataChange: true });
