import { requestId } from "../../core/ids.js";
import { searchCustomers } from "../../data/customers.js";
import { buildOpportunityDraft, createOpportunityFromSignal, createOrder, defaultSignalSince, dismissSignal, orderTotal, refreshClassifications, reopenSignal, updateOrderStatus } from "../../data/orders.js";
import { ORDER_STATUSES } from "../../data/schema.js";
import { signalInMyAreas } from "../../data/today.js";
import { badge, emptyState, field, formToObject, h, input, money, openDialog, select, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const VIEWS = [{ value: "signals", label: "新購提醒" }, { value: "orders", label: "全部訂單" }, { value: "handled", label: "已處理提醒" }];
let refreshing = null;
const state = { mineOnly: true };

export function resetOrdersState() {
  state.mineOnly = true;
}

export async function ensureClassified(ctx) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    let since = await ctx.db.getMeta("orderSignalSince", null);
    if (!since) { since = defaultSignalSince(ctx.today()); await ctx.db.setMeta("orderSignalSince", since); }
    return refreshClassifications(ctx.db, { signalSince: since });
  })().finally(() => { refreshing = null; });
  return refreshing;
}

function classificationBadge(item) {
  if (item.classification === "首次購買") return badge("首次購買", "accent");
  if (item.classification === "回購") return badge("回購");
  if (item.classification === "資料待確認") return badge("資料待確認", "warn");
  return badge("比對中");
}

function opportunityDialog(ctx, order, item) {
  const draft = buildOpportunityDraft(order, item, ctx.today());
  const rid = requestId("signal-opportunity");
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "signal-opportunity" } }, [
      h("h2", { text: "從首次購買建立商機" }),
      h("p", { className: "muted", text: item.basis }),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      h("input", { type: "hidden", name: "customerId", value: draft.customerId || "" }),
      h("div", { className: "form-grid" }, [
        field("商機名稱", input("name", draft.name), { className: "span-2" }),
        field("產品", input("product", draft.product)),
        field("階段", select("stage", ["接觸", "提案", "議價"], draft.stage)),
        field("預估金額", input("amount", draft.amount, { type: "number", min: 0 })),
        field("預計結案日", input("expectedCloseDate", draft.expectedCloseDate, { type: "date" })),
        field("備註", h("textarea", { name: "notes", rows: 2, value: draft.notes }), { className: "span-2" }),
      ]),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "確認建立商機" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!draft.customerId) { showErrors(form, { _: "這張訂單還沒有對應到客戶，請先在訂單上指定客戶。" }); return; }
      const result = await createOpportunityFromSignal(ctx.db, item.id, formToObject(form), rid);
      if (!result.ok) { showErrors(form, result.errors || { _: "建立失敗" }); return; }
      close();
      toast(result.value.duplicate ? "這個品項已經建立過商機，已為你開啟" : "已建立商機");
      ctx.navigate(`opportunity/${encodeURIComponent(result.value.opportunity.id)}`);
    });
    return form;
  }, { label: "建立商機" });
}

function dismissDialog(ctx, item) {
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: "dismiss-signal" } }, [
      h("h2", { text: "標記為不處理" }),
      field("原因", select("note", ["試用／樣品", "臨時代購", "料號錯誤", "客戶已知，不需跟進", "其他"], "試用／樣品")),
      h("p", { className: "muted", text: "之後不會再提醒這個品項；需要時可以在「已處理提醒」重新打開。" }),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "確認" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await dismissSignal(ctx.db, item.id, form.elements.note.value, requestId("signal-dismiss"));
      close();
      toast("已標記不處理");
    });
    return form;
  }, { label: "不處理" });
}

function signalRow(ctx, item, { handled = false } = {}) {
  const order = ctx.model.ordersById.get(item.orderId);
  const customerName = order?.customerId ? ctx.model.customerName(order.customerId) : order?.customerName || item.customerNo;
  return h("li", { className: "task-row", dataset: { signal: item.id } }, [
    h("div", { className: "task-main" }, [
      h("strong", { text: `${customerName}・${item.productName || item.productCode}` }),
      h("span", { text: `${order?.orderDate || ""}・${item.productCode}・數量 ${item.quantity ?? "—"}・${item.amount ? money(item.amount) : "金額未填"}` }),
      h("small", { className: "muted", dataset: { basis: "" }, text: `判斷依據：${item.basis}` }),
      handled ? h("small", { className: "muted", text: `${item.signalStatus}・${item.signalNote || ""}・${item.handledAt ? new Date(item.handledAt).toLocaleDateString("zh-TW") : ""}` }) : null,
    ]),
    handled ? badge(item.signalStatus, item.signalStatus === "已建商機" ? "ok" : "neutral") : badge("首次購買", "accent"),
    h("div", { className: "row-actions" }, handled
      ? [item.linkedOpportunityId ? h("a", { className: "button small ghost", href: `#/opportunity/${encodeURIComponent(item.linkedOpportunityId)}`, text: "查看商機" }) : null,
        item.signalStatus === "不處理" ? h("button", { type: "button", className: "small ghost", text: "重新提醒", onClick: async () => { await reopenSignal(ctx.db, item.id, requestId("signal-reopen")); toast("已重新加入提醒"); } }) : null]
      : [h("button", { type: "button", className: "small primary", dataset: { createFromSignal: item.id }, text: "建立商機", onClick: () => opportunityDialog(ctx, order, item) }),
        h("button", { type: "button", className: "small ghost", dataset: { dismissSignal: item.id }, text: "不處理", onClick: () => dismissDialog(ctx, item) })]),
  ]);
}

function orderCard(ctx, order) {
  const items = ctx.model.itemsByOrder.get(order.id) || [];
  const status = select("status", ORDER_STATUSES, order.status, { "aria-label": "訂單狀態", dataset: { orderStatus: order.id } });
  status.addEventListener("change", async () => {
    const result = await updateOrderStatus(ctx.db, order.id, status.value, requestId("order-status"));
    toast(result.ok ? `訂單狀態改為「${status.value}」` : "更新失敗", { tone: result.ok ? "ok" : "error" });
  });
  return h("article", { className: "card", dataset: { order: order.id } }, [
    h("div", { className: "section-head" }, [
      h("div", {}, [
        h("strong", {}, [order.customerId ? h("a", { href: `#/customer/${encodeURIComponent(order.customerId)}`, text: ctx.model.customerName(order.customerId) }) : order.customerName || "（未對應客戶）"]),
        h("div", { className: "muted", text: [order.orderDate, order.source, order.orderNo, `${items.length} 項`, money(orderTotal(items))].filter(Boolean).join("・") }),
      ]),
      h("div", { style: { minWidth: "140px" } }, [status]),
    ]),
    !order.customerId ? h("div", { className: "warning-banner", text: "這張訂單還沒有對應到客戶，首次購買判斷會標為「資料待確認」。" }) : null,
    h("div", { className: "table-wrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["料號", "品名", "數量", "單價", "金額", "判斷"].map((label, index) => h("th", { className: index >= 2 && index <= 4 ? "num" : "", text: label })))]),
      h("tbody", {}, items.map((item) => h("tr", {}, [
        h("td", { text: item.productCode || "—" }), h("td", { text: item.productName || "" }),
        h("td", { className: "num", text: item.quantity ?? "" }), h("td", { className: "num", text: item.unitPrice ? money(item.unitPrice) : "" }),
        h("td", { className: "num", text: item.amount ? money(item.amount) : "" }), h("td", { title: item.basis || "" }, [classificationBadge(item)]),
      ]))),
    ])]),
    order.notes ? h("p", { className: "muted", text: order.notes }) : null,
  ]);
}

function newOrderDialog(ctx, presetCustomerId = "") {
  const rid = requestId("order-create");
  openDialog((close) => {
    const customerHidden = h("input", { type: "hidden", name: "customerId", value: presetCustomerId });
    const chosen = h("div", { className: "selected-customer", hidden: !presetCustomerId, text: presetCustomerId ? ctx.model.customerName(presetCustomerId) : "" });
    const results = h("div", { className: "picker-results" });
    const search = h("input", { type: "search", placeholder: "搜尋客戶", "aria-label": "訂單客戶", dataset: { orderCustomerSearch: "" } });
    search.addEventListener("input", () => {
      const found = search.value.trim() ? searchCustomers(ctx.model, { query: search.value, myAreas: ctx.settings.myAreas, today: ctx.today(), limit: 6 }).items : [];
      results.replaceChildren(...found.map(({ customer }) => h("button", { type: "button", text: `${customer.name}${customer.customerNo ? `（${customer.customerNo}）` : ""}`, dataset: { pickCustomer: customer.id }, onClick: () => { customerHidden.value = customer.id; chosen.hidden = false; chosen.textContent = customer.name; results.replaceChildren(); search.value = ""; } })));
    });
    const itemsBody = h("div", { className: "stack", dataset: { orderItems: "" } });
    let index = 0;
    const addRow = () => {
      const i = index++;
      itemsBody.append(h("div", { className: "form-grid card", dataset: { itemRow: i } }, [
        field("料號", input(`items.${i}.productCode`, "")), field("品名", input(`items.${i}.productName`, "")),
        field("數量", input(`items.${i}.quantity`, "1", { type: "number", min: 0 })), field("單價（未稅）", input(`items.${i}.unitPrice`, "", { type: "number", min: 0 })),
      ]));
    };
    addRow();
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "order" } }, [
      h("h2", { text: "新增訂單" }),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      customerHidden, chosen, h("div", { className: "search-box" }, [search]), results,
      h("div", { className: "form-grid" }, [
        field("訂單日期", input("orderDate", ctx.today(), { type: "date" })),
        field("來源", select("source", ["LINE", "電話", "Email", "ERP出貨", "手動"], "LINE")),
        field("訂單編號", input("orderNo", "")),
        field("狀態", select("status", ORDER_STATUSES, "待確認")),
      ]),
      h("h3", { text: "品項" }), itemsBody,
      h("button", { type: "button", className: "small ghost", text: "＋ 再加一項", onClick: addRow }),
      field("備註／原始訊息", h("textarea", { name: "rawMessage", rows: 3 })),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "儲存訂單" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const raw = formToObject(form);
      const items = [];
      for (const [key, value] of Object.entries(raw)) {
        const match = key.match(/^items\.(\d+)\.(\w+)$/);
        if (match) { items[Number(match[1])] ||= {}; items[Number(match[1])][match[2]] = value; }
      }
      const result = await createOrder(ctx.db, { ...raw, items: items.filter(Boolean) }, rid);
      if (!result.ok) {
        const errors = Object.fromEntries(Object.entries(result.errors || {}).map(([key, message]) => [key.replace(/^items\.(\d+)\.productName$/, "items.$1.productName"), message]));
        showErrors(form, errors);
        return;
      }
      close();
      await ensureClassified(ctx);
      toast("已新增訂單，已完成首次購買比對");
    });
    return form;
  }, { label: "新增訂單" });
}

export function renderOrders(ctx, route) {
  const view = VIEWS.some((item) => item.value === route.query.get("view")) ? route.query.get("view") : "signals";
  const customerFilter = route.query.get("customer") || "";
  const allItems = (ctx.model.all.orderItem || []).filter((item) => !item.archivedAt);
  if (allItems.some((item) => !item.classification)) ensureClassified(ctx).catch(() => {});
  const allPending = allItems.filter((item) => item.signalStatus === "待處理");
  const pending = state.mineOnly && !customerFilter ? allPending.filter((item) => signalInMyAreas(ctx.model, item, ctx.settings.myAreas)) : allPending;
  const hiddenOutside = allPending.length - pending.length;
  const mineToggle = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.mineOnly, dataset: { signalsMineOnly: "" }, onChange: (event) => { state.mineOnly = event.target.checked; ctx.render(); } }), h("span", { text: `只看我的區域${hiddenOutside ? `（另有 ${hiddenOutside} 筆在其他區域）` : ""}` })]);
  const handled = allItems.filter((item) => ["已建商機", "不處理"].includes(item.signalStatus));
  const tabs = h("div", { className: "tabs", role: "tablist" }, VIEWS.map((item) => h("a", {
    href: `#/orders?view=${item.value}${customerFilter ? `&customer=${encodeURIComponent(customerFilter)}` : ""}`, className: "button small ghost", role: "tab", "aria-selected": String(item.value === view),
    text: item.value === "signals" ? `${item.label} ${pending.length}` : item.value === "handled" ? `${item.label} ${handled.length}` : item.label,
  })));
  let body;
  if (view === "signals") {
    body = pending.length
      ? h("section", { className: "card" }, [h("p", { className: "muted", text: "客戶第一次購買這個料號。系統只提醒，由你決定要建立商機或不處理。" }), mineToggle, h("ul", { className: "task-list" }, pending.map((item) => signalRow(ctx, item)))])
      : h("section", { className: "card" }, [mineToggle, emptyState("目前沒有新的首次購買", "有新訂單進來時，系統會用「客戶編號＋產品代碼」比對歷史購買並提醒你。")]);
  } else if (view === "handled") {
    body = handled.length ? h("section", { className: "card" }, [h("ul", { className: "task-list" }, handled.map((item) => signalRow(ctx, item, { handled: true })))]) : h("section", { className: "card" }, [emptyState("還沒有處理過的提醒")]);
  } else {
    const orders = (ctx.model.all.order || []).filter((order) => !order.archivedAt && (!customerFilter || order.customerId === customerFilter)).sort((left, right) => String(right.orderDate).localeCompare(String(left.orderDate)));
    body = orders.length ? h("div", { className: "stack" }, ORDER_STATUSES.map((status) => {
      const group = orders.filter((order) => order.status === status);
      if (!group.length) return null;
      return h("details", { className: "card section", open: !["已完成", "已出貨", "已取消"].includes(status), dataset: { statusGroup: status } }, [
        h("summary", {}, [h("span", { text: status }), badge(`${group.length} 張`)]),
        h("div", { className: "stack" }, group.slice(0, 50).map((order) => orderCard(ctx, order))),
      ]);
    }).filter(Boolean)) : h("section", { className: "card" }, [emptyState("沒有訂單")]);
  }
  return h("div", { className: "stack" }, [
    pageHeader("訂單中心", customerFilter ? `只看：${ctx.model.customerName(customerFilter)}` : "訂單、品項與首次購買提醒。", [h("button", { type: "button", className: "primary", dataset: { addOrder: "" }, text: "＋ 新增訂單", onClick: () => newOrderDialog(ctx, customerFilter) })]),
    tabs,
    body,
  ]);
}

registerPage("orders", { title: "訂單中心", render: renderOrders });
