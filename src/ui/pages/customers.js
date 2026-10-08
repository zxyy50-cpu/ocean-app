import { daysBetween, formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { duplicateGroups, searchCustomers, setImportant } from "../../data/customers.js";
import { primaryContact } from "../../data/model.js";
import { areaOptions } from "../../data/tags.js";
import { qualificationTotal } from "../../data/qualification.js";
import { badge, emptyState, h } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";
import { openCustomerEditor } from "../forms/customer-forms.js";

const state = { query: "", areas: [], importantOnly: false, limit: 30 };

export function resetExploreState() {
  Object.assign(state, { query: "", areas: [], importantOnly: false, limit: 30 });
}

function lastContactLabel(customer, today) {
  if (!customer.lastContactAt) return "尚未聯絡";
  const days = daysBetween(customer.lastContactAt, today);
  return days === 0 ? "今天聯絡" : `${days} 天前聯絡`;
}

export function customerCard(ctx, customer, { outsideMyAreas = false, unclassified = false } = {}) {
  const today = ctx.today();
  const contact = primaryContact(ctx.model, customer.id);
  const open = (ctx.model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  const star = h("button", {
    type: "button", className: "star", "aria-pressed": String(Boolean(customer.important)),
    "aria-label": customer.important ? `取消重要標記：${customer.name}` : `標記為重要客戶：${customer.name}`,
    dataset: { star: customer.id }, text: customer.important ? "★" : "☆",
    onClick: async (event) => { event.preventDefault(); event.stopPropagation(); await setImportant(ctx.db, customer.id, !customer.important, requestId("important")); },
  });
  return h("article", { className: "customer-card", dataset: { customerCard: customer.id } }, [
    h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, className: "task-main" }, [
      h("strong", { text: customer.name }),
      h("span", { text: [customer.customerNo ? `#${customer.customerNo}` : "尚無客戶編號", contact?.name, lastContactLabel(customer, today)].filter(Boolean).join("・") }),
    ]),
    star,
    h("div", { className: "tags" }, [
      ...(customer.areaTags || []).slice(0, 3).map((area) => h("span", { className: `tag ${outsideMyAreas ? "other-area" : "area"}`, text: area })),
      ...(customer.industryTags || []).slice(0, 2).map((tag) => h("span", { className: "tag", text: tag })),
      ctx.model.sameNameCount(customer) ? h("span", { className: "badge badge-warn", dataset: { sameName: customer.id }, title: "還有其他同名客戶，看客戶編號與聯絡人分辨；確定是同一家可到客戶頁合併", text: `同名 ${ctx.model.sameNameCount(customer) + 1} 筆` }) : null,
      outsideMyAreas ? badge("非我的區域", "info") : null,
      unclassified ? badge("未分類區域") : null,
      open.length ? badge(`進行中商機 ${open.length}`, "accent") : null,
      qualificationTotal(customer.qualification) !== null ? badge(`評分 ${qualificationTotal(customer.qualification)}`, qualificationTotal(customer.qualification) >= 16 ? "ok" : "neutral") : null,
      customer.nextFollowUpDate ? badge(`追蹤 ${formatShortDate(customer.nextFollowUpDate)}`, customer.nextFollowUpDate < today ? "warn" : "neutral") : null,
    ]),
  ]);
}

function areaChips(options, onChange) {
  return options.map((option) => h("label", { className: "chip" }, [
    h("input", { type: "checkbox", value: option.area, checked: state.areas.includes(option.area), dataset: { areaFilter: option.area }, onChange }),
    h("span", { text: `${option.area} ${option.count}` }),
  ]));
}

export function renderCustomers(ctx) {
  const results = h("div", { dataset: { results: "" } });
  const options = areaOptions(ctx.model.customers, ctx.settings.myAreas);
  const groups = duplicateGroups(ctx.model.customers);

  const draw = () => {
    const found = searchCustomers(ctx.model, { query: state.query, areas: state.areas, importantOnly: state.importantOnly, myAreas: ctx.settings.myAreas, today: ctx.today(), limit: state.limit });
    const heading = found.mode === "priority"
      ? h("div", { className: "section-head" }, [h("h2", { text: "我的區域・重要與待跟進客戶" }), badge(`${found.total} 家`)])
      : h("div", { className: "section-head" }, [h("h2", { text: "搜尋結果" }), badge(`${found.total} 家`)]);
    const body = found.items.length
      ? h("div", { className: "result-list cards" }, found.items.map(({ customer, outsideMyAreas, unclassified }) => customerCard(ctx, customer, { outsideMyAreas, unclassified })))
      : emptyState(
        found.mode === "priority" ? "我的區域還沒有重要客戶" : "找不到符合的客戶",
        found.mode === "priority" ? "用上方搜尋找客戶，按 ☆ 標記重要，之後就會固定出現在這裡。" : "可以換個關鍵字（公司簡稱、聯絡人、電話後四碼），或直接新增客戶。",
        h("button", { type: "button", className: "primary", text: "＋ 新增客戶", onClick: () => openCustomerEditor(ctx, { onSaved: (customer) => ctx.navigate(`customer/${customer.id}`) }) }),
      );
    const more = found.hasMore ? h("button", { type: "button", className: "ghost", dataset: { loadMore: "" }, text: `顯示更多（還有 ${found.total - found.items.length} 家）`, onClick: () => { state.limit += 30; draw(); } }) : null;
    results.replaceChildren(...[heading, body, more].filter(Boolean));
  };

  const search = h("input", { type: "search", value: state.query, placeholder: "公司名稱、客戶編號、聯絡人或電話", "aria-label": "搜尋客戶", dataset: { customerSearch: "" }, enterkeyhint: "search" });
  search.addEventListener("input", () => { state.query = search.value; state.limit = 30; draw(); });
  const onAreaChange = () => {
    state.areas = [...document.querySelectorAll("[data-area-filter]:checked")].map((node) => node.value);
    state.limit = 30;
    draw();
  };
  const importantToggle = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.importantOnly, dataset: { importantOnly: "" }, onChange: (event) => { state.importantOnly = event.target.checked; draw(); } }), h("span", { text: "★ 只看重要" })]);
  const otherOpen = state.areas.some((area) => options.others.some((option) => option.area === area));

  draw();
  return h("div", { className: "stack" }, [
    pageHeader("客戶", "先找我的區域；需要時再搜尋全部客戶。", [h("button", { type: "button", className: "primary", dataset: { addCustomer: "" }, text: "＋ 新增客戶", onClick: () => openCustomerEditor(ctx, { onSaved: (customer) => ctx.navigate(`customer/${customer.id}`) }) })]),
    h("div", { className: "search-box" }, [search]),
    h("section", { className: "card", "aria-label": "區域篩選" }, [
      h("div", { className: "section-head" }, [h("h2", { text: "我的區域" }), h("a", { href: "#/settings", className: "small", text: "調整" })]),
      h("div", { className: "chip-group", dataset: { myAreaChips: "" } }, [...areaChips(options.mine, onAreaChange), importantToggle]),
      options.others.length ? h("details", { className: "other-areas", open: otherOpen }, [
        h("summary", { text: `其他區域（${options.others.length}）` }),
        h("div", { className: "chip-group", dataset: { otherAreaChips: "" } }, areaChips(options.others, onAreaChange)),
      ]) : null,
    ]),
    groups.length ? h("div", { className: "warning-banner", dataset: { duplicateWarning: "" } }, [h("span", { text: `有 ${groups.length} 組客戶名稱相同或相似。系統只提醒，不會自動合併。` }), h("a", { href: "#/dedupe", dataset: { openDedupe: "" }, text: "整理同名客戶 →" })]) : null,
    results,
  ]);
}

registerPage("customers", { title: "客戶", render: renderCustomers, keepOnDataChange: false });
