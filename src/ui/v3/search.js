import { globalSearch, snippet } from "../../data/search.js";
import { opportunityTitle } from "../../data/products.js";
import { customerIdentity } from "../../data/model.js";
import { badge, emptyState, h, money } from "../dom.js";
import { registerPage } from "../app.js";

const state = { query: "" };

export function resetSearchState() {
  state.query = "";
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
    if (!query.trim()) { results.replaceChildren(recent(ctx)); return; }
    const found = globalSearch(ctx.model, query, { myAreas: ctx.settings.myAreas, today: ctx.today() });
    const sections = [
      group("客戶", found.totals.customers, found.customers.length, found.customers.map(({ customer, outsideMyAreas }) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}` }, [
        h("strong", {}, highlight(customer.name, query)),
        h("small", { className: "muted", text: [customerIdentity(ctx.model, customer), outsideMyAreas ? "非我的區域" : ""].filter(Boolean).join("・") }),
      ])]))),
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
      group("買過的產品", found.totals.items, found.items.length, found.items.map(({ item, order }) => h("li", {}, [h("a", { href: `#/customer/${encodeURIComponent(order.customerId)}?tab=orders` }, [
        h("strong", {}, highlight(item.productName || item.productCode, query)),
        h("small", { className: "muted", text: [ctx.model.customerName(order.customerId), order.orderDate, item.productCode].filter(Boolean).join("・") }),
      ])]))),
    ].filter(Boolean);
    results.replaceChildren(...(sections.length ? sections : [emptyState(`找不到「${query}」`, "換個關鍵字試試：公司簡稱、聯絡人、電話後四碼、產品名稱。")]));
  };
  const input = h("input", { type: "search", value: state.query, placeholder: "公司、人名、電話、產品或拜訪內容", "aria-label": "搜尋全部資料", dataset: { globalSearch: "" }, enterkeyhint: "search", autocomplete: "off" });
  let timer = null;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.query = input.value; draw(); }, 150); });
  draw();
  setTimeout(() => { if (!state.query) input.focus?.(); }, 0);
  return h("div", { className: "stack" }, [h("div", { className: "search-box sticky-search" }, [input]), results]);
}

registerPage("search", { title: "搜尋", render: renderSearch, keepOnDataChange: true });
