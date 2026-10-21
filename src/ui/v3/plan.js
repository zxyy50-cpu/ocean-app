import { formatShortDate } from "../../core/dates.js";
import { priorityList, zoneFunnel } from "../../data/devplan.js";
import { GROUP_NAMES } from "../../data/industry-groups.js";
import { mapsRouteUrl, routeOrder } from "../../data/brief.js";
import { badge, emptyState, h } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";
import { openHoldDialog } from "../forms/hold.js";

const PAGE = 40;
let lastCounts = { total: 0, a: 0 };
const state = { view: "list", area: "", tier: "", grade: "", group: "", smallOnly: false, notContactedOnly: true, mineOnly: true, limit: PAGE };

export function resetPlanState() {
  Object.assign(state, { view: "list", area: "", tier: "", grade: "", group: "", smallOnly: false, notContactedOnly: true, mineOnly: true, limit: PAGE });
}

function filterSelect(label, key, options, ctx) {
  return h("select", { "aria-label": label, dataset: { planFilter: key }, onChange: (event) => { state[key] = event.target.value; state.limit = PAGE; ctx.render(); } },
    options.map(([value, text]) => h("option", { value, text, selected: value === state[key] })));
}

function chip(label, checked, data, onChange) {
  return h("label", { className: "chip" }, [h("input", { type: "checkbox", checked, dataset: data, onChange: (event) => onChange(event.target.checked) }), h("span", { text: label })]);
}

function prospectCard(ctx, item, selected, refreshBar) {
  const { customer } = item;
  const box = h("input", { type: "checkbox", checked: selected.has(customer.id), "aria-label": `選取 ${customer.name}`, dataset: { planPick: customer.id }, onChange: (event) => { if (event.target.checked) selected.add(customer.id); else selected.delete(customer.id); refreshBar(); } });
  const status = item.holdExpired ? "不開發到期，再看一次" : item.contacted ? `最近聯絡 ${customer.lastContactAt ? formatShortDate(customer.lastContactAt) : "—"}` : customer.customerNo ? `#${customer.customerNo}・還沒有拜訪紀錄` : "未接觸";
  return h("li", { className: "plan-card", dataset: { planCustomer: customer.id } }, [
    box,
    h("div", { className: "plan-main" }, [
      h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, className: "plan-name" }, [h("strong", { text: customer.name })]),
      h("small", { className: "plan-reasons", text: item.reasons.join("・") }),
      h("small", { className: "muted", text: [item.zone, status].join("・") }),
      h("div", { className: "plan-badges" }, [
        h("span", { className: `badge plan-grade grade-${item.grade}`, dataset: { planGrade: item.grade }, text: `${item.grade} 級` }),
        ...item.groups.map((group) => badge(group)),
        item.costco ? badge("Costco 供應", "accent") : null,
        item.small ? badge("規模小", "warn") : null,
        item.holdExpired ? badge("到期再看", "accent") : null,
      ]),
    ]),
    h("div", { className: "plan-side" }, [
      h("span", { className: `plan-score tier-${item.micro.level}`, title: "優先分數（滿分 100）", text: String(item.score) }),
      h("a", { className: "button small ghost", href: `#/capture?customer=${encodeURIComponent(customer.id)}`, text: "記錄" }),
      h("button", { type: "button", className: "small ghost", dataset: { planHold: customer.id }, text: "不開發", onClick: () => openHoldDialog(ctx, [customer], { onDone: () => ctx.render() }) }),
    ]),
  ]);
}

function listView(ctx, areas) {
  const today = ctx.today();
  const items = priorityList(ctx.model, { today, areas, area: state.area, tier: state.tier, grade: state.grade, group: state.group, smallOnly: state.smallOnly, notContactedOnly: state.notContactedOnly });
  lastCounts = { total: items.length, a: items.filter((item) => item.grade === "A").length };
  const shown = items.slice(0, state.limit);
  const selected = new Set();
  const bar = h("div", { className: "plan-bulk", dataset: { planBulk: "" } });
  const refreshBar = () => {
    const picked = [...selected].map((id) => ctx.model.customersById.get(id)).filter(Boolean);
    bar.replaceChildren(...(selected.size ? [
      h("span", { text: `已選 ${selected.size} 家` }),
      // Up to 10 stops: Google Maps takes the route from where you are, in a rough township/road order.
      picked.length >= 1 && picked.length <= 10 ? h("a", { className: "button small primary", href: mapsRouteUrl(routeOrder(picked)), target: "_blank", rel: "noopener", dataset: { planRoute: "" }, text: `➤ 開路線（${picked.length} 家）` }) : h("small", { className: "muted", text: "開路線最多 10 家" }),
      h("button", { type: "button", className: "small ghost", text: "取消選取", onClick: () => { selected.clear(); document.querySelectorAll("[data-plan-pick]").forEach((node) => { node.checked = false; }); refreshBar(); } }),
      h("button", { type: "button", className: "small ghost", dataset: { planHoldSelected: "" }, text: "標為不開發", onClick: () => openHoldDialog(ctx, [...selected].map((id) => ctx.model.customersById.get(id)).filter(Boolean), { onDone: () => ctx.render() }) }),
    ] : []));
    bar.hidden = !selected.size;
  };
  refreshBar();

  const areaOptions = zoneFunnel(ctx.model, { today, areas }).flatMap((county) => [
    { value: county.filter, label: `${county.area}（${county.total}）` },
    ...county.zones.filter((zone) => zone.filter !== county.filter).map((zone) => ({ value: zone.filter, label: `　${zone.area}（${zone.total}）` })),
  ]);
  const areaSelect = h("select", { "aria-label": "區域", dataset: { planArea: "" }, onChange: (event) => { state.area = event.target.value; state.limit = PAGE; ctx.render(); } },
    [{ value: "", label: "全部區域" }, ...areaOptions].map((option) => h("option", { value: option.value, text: option.label, selected: option.value === state.area })));
  const tierSelect = h("select", { "aria-label": "微生物檢驗需求", dataset: { planTier: "" }, onChange: (event) => { state.tier = event.target.value; state.limit = PAGE; ctx.render(); } },
    [["", "全部檢驗需求"], ["高", "檢驗需求高"], ["中", "檢驗需求中"], ["低", "檢驗需求低"], ["不明", "產業不明"]].map(([value, label]) => h("option", { value, text: label, selected: value === state.tier })));
  const selectSmall = state.smallOnly && shown.length ? h("button", { type: "button", className: "small ghost", dataset: { planPickAll: "" }, text: `全選這頁 ${shown.length} 家`, onClick: () => { shown.forEach((item) => selected.add(item.customer.id)); document.querySelectorAll("[data-plan-pick]").forEach((node) => { node.checked = true; }); refreshBar(); } }) : null;

  return h("div", { className: "stack" }, [
    h("div", { className: "plan-filters" }, [
      filterSelect("優先級", "grade", [["", "全部優先級"], ["A", "A 級：先開發"], ["B", "B 級"], ["C", "C 級"]], ctx),
      areaSelect,
      filterSelect("產業群組", "group", [["", "全部產業"], ...GROUP_NAMES.map((name) => [name, name])], ctx),
      tierSelect,
      chip("只看未接觸", state.notContactedOnly, { planNotContacted: "" }, (value) => { state.notContactedOnly = value; state.limit = PAGE; ctx.render(); }),
      chip("只看規模小", state.smallOnly, { planSmall: "" }, (value) => { state.smallOnly = value; state.limit = PAGE; ctx.render(); }),
      selectSmall,
    ]),
    h("p", { className: "muted", dataset: { planCount: "" }, text: `${items.length} 家可開發（A ${items.filter((item) => item.grade === "A").length}・B ${items.filter((item) => item.grade === "B").length}・C ${items.filter((item) => item.grade === "C").length}），A 級在前。勾選幾家可以開 Google 地圖路線。` }),
    bar,
    shown.length ? h("ul", { className: "plan-list" }, shown.map((item) => prospectCard(ctx, item, selected, refreshBar))) : h("section", { className: "card" }, [emptyState("這個條件下沒有要開發的客戶", "換個區域，或取消「只看未接觸」。")]),
    items.length > state.limit ? h("button", { type: "button", className: "ghost", text: `顯示更多（還有 ${items.length - state.limit} 家）`, onClick: () => { state.limit += PAGE; ctx.render(); } }) : null,
  ]);
}

function funnelCells(row) {
  return [
    h("td", { className: "num", text: String(row.total) }),
    h("td", { className: "num" }, [h("strong", { text: `${row.contactedRate}%` }), h("small", { className: "muted", text: ` ${row.contacted}` })]),
    h("td", { className: "num" }, [h("span", { text: `${row.opportunityRate}%` }), h("small", { className: "muted", text: ` ${row.withOpportunity}` })]),
    h("td", { className: "num" }, [h("span", { text: `${row.customerRate}%` }), h("small", { className: "muted", text: ` ${row.customers}` })]),
    h("td", { className: "num muted", text: row.held ? String(row.held) : "—" }),
  ];
}

function zonesView(ctx, areas) {
  const groups = zoneFunnel(ctx.model, { today: ctx.today(), areas });
  if (!groups.length) return h("section", { className: "card" }, [emptyState("還沒有客戶資料")]);
  const open = (filter) => { state.area = filter; state.view = "list"; state.limit = PAGE; ctx.render(); };
  const row = (item, county) => h("tr", { className: county ? "county-row" : "zone-row", dataset: { funnelArea: item.filter } }, [
    h("th", { scope: "row" }, [h("button", { type: "button", className: "link-button", text: item.area, onClick: () => open(item.filter) }), h("div", { className: "bar", "aria-hidden": "true" }, [h("span", { style: { width: `${item.contactedRate}%` } })])]),
    ...funnelCells(item),
  ]);
  return h("section", { className: "card" }, [
    h("p", { className: "muted", text: "達成率都以「應開發」為分母；標為不開發的不算在內。點區域名稱看那一區該先找誰。" }),
    h("div", { className: "table-wrap" }, [h("table", { className: "funnel-table", dataset: { funnel: "" } }, [
      h("thead", {}, [h("tr", {}, ["區域", "應開發", "已接觸", "有商機", "往來中", "不開發"].map((label) => h("th", { scope: "col", text: label })))]),
      h("tbody", {}, groups.flatMap((group) => [row(group, true), ...(group.zones.length > 1 || group.zones[0]?.filter !== group.filter ? group.zones.map((zone) => row(zone, false)) : [])])),
    ])]),
  ]);
}

export function renderPlan(ctx, route) {
  if (route.query.get("area") !== null) { state.area = route.query.get("area"); state.view = "list"; }
  const areas = state.mineOnly ? ctx.settings.myAreas || [] : [];
  const tabs = h("div", { className: "tabs", role: "tablist" }, [["list", "優先清單"], ["zones", "各區達成率"]].map(([value, label]) => h("button", {
    type: "button", className: "button small ghost", role: "tab", "aria-selected": String(state.view === value), dataset: { planView: value }, text: label,
    onClick: () => { state.view = value; ctx.render(); },
  })));
  const body = state.view === "zones" ? zonesView(ctx, areas) : listView(ctx, areas);
  return h("div", { className: "stack" }, [
    pageHeader("開發計畫", "", [], {
      figure: state.view === "zones" ? "各區達成率" : `A 級 ${lastCounts.a} 家先開發`,
      note: state.view === "zones" ? "" : `符合條件共 ${lastCounts.total} 家`,
      help: "先找值得開發的；規模太小或不適合的標「不開發」，就不會再出現。A 級＝檢驗需求高且資本 5 千萬以上，或 2025 衰退客戶、Costco 供應商；B 級＝需求高＋資本 1 千萬以上，或需求中＋5 千萬以上；其餘 C 級。分數＝檢驗需求（40）＋資本額（30）＋舊客戶（最多 30）。",
    }),
    h("div", { className: "button-row" }, [tabs, chip("只看我的區域", state.mineOnly, { planMineOnly: "" }, (value) => { state.mineOnly = value; state.area = ""; ctx.render(); })]),
    body,
  ]);
}

registerPage("plan", { title: "開發計畫", render: renderPlan, keepOnDataChange: true });
