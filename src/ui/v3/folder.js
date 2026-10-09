import { toDateOnly } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { duplicateCandidates, restoreCustomer, setImportant } from "../../data/customers.js";
import { customerIdentity } from "../../data/model.js";
import { opportunityTitle } from "../../data/products.js";
import { badge, emptyState, h, money, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { openArchiveCustomer, openCustomerEditor } from "../forms/customer-forms.js";
import { openMergeGroupDialog } from "../forms/merge-group.js";
import { contactsCard, nextStepCard, noteBlock, opportunitiesCard, ordersCard, qualificationCard, quickContact, relationshipCard, toolkitCard } from "../pages/customer.js";

const TABS = [["timeline", "時間軸"], ["opportunities", "商機"], ["orders", "訂單"], ["contacts", "聯絡人"], ["info", "資料"]];

// Visits, orders and opportunity milestones in one list, newest first.
export function customerTimeline(model, customerId) {
  const entries = [];
  for (const activity of model.activitiesByCustomer.get(customerId) || []) entries.push({ date: activity.activityDate, kind: "visit", activity });
  for (const order of model.ordersByCustomer.get(customerId) || []) entries.push({ date: order.orderDate, kind: "order", order, items: model.itemsByOrder.get(order.id) || [] });
  for (const opportunity of model.opportunitiesByCustomer.get(customerId) || []) {
    // Imported opportunities were "created" on import day, which says nothing about the case.
    if (opportunity.createdAt && opportunity.source !== "匯入") entries.push({ date: toDateOnly(opportunity.createdAt), kind: "opportunity-open", opportunity });
    if (opportunity.closedAt) entries.push({ date: toDateOnly(opportunity.closedAt), kind: opportunity.stage === "成交" ? "won" : "lost", opportunity });
  }
  return entries.filter((entry) => entry.date).sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function entryRow(ctx, entry, first) {
  if (entry.kind === "visit") {
    const activity = entry.activity;
    return h("li", { dataset: { timelineVisit: activity.id } }, [
      h("div", { className: "when", text: [activity.activityDate, activity.channel, activity.purpose, activity.reaction].filter(Boolean).join("・") }),
      noteBlock(activity, first),
      activity.nextAction ? h("small", { className: "muted", text: `下一步：${activity.nextAction}${activity.nextFollowUpDate ? `（${activity.nextFollowUpDate}）` : ""}` }) : null,
      h("a", { className: "small", href: `#/lou/${encodeURIComponent(activity.id)}`, text: "會後信" }),
    ]);
  }
  if (entry.kind === "order") {
    const names = entry.items.map((item) => item.productName || item.productCode).filter(Boolean);
    const total = entry.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    return h("li", { dataset: { timelineOrder: entry.order.id } }, [
      h("div", { className: "when", text: `${entry.date}・訂單${entry.order.status ? `・${entry.order.status}` : ""}` }),
      h("div", { text: `${names.slice(0, 3).join("、")}${names.length > 3 ? ` 等 ${names.length} 項` : ""}${total ? `・${money(total)}` : ""}` }),
    ]);
  }
  const opportunity = entry.opportunity;
  const label = { "opportunity-open": "建立商機", won: "成交", lost: "未成交" }[entry.kind];
  return h("li", {}, [
    h("div", { className: "when", text: `${entry.date}・${label}` }),
    h("a", { href: `#/case/${encodeURIComponent(opportunity.id)}`, text: `${opportunityTitle(opportunity, 30)}${opportunity.amount ? `・${money(opportunity.amount)}` : ""}` }),
  ]);
}

function timeline(ctx, customer) {
  const entries = customerTimeline(ctx.model, customer.id);
  if (!entries.length) return emptyState("還沒有任何紀錄", "記錄第一次聯絡後，拜訪、訂單和商機都會依時間排在這裡。");
  const months = new Map();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(entry);
  }
  // The two most recent months are open; older months fold so a long history stays short.
  return h("div", { className: "stack", dataset: { timeline: "" } }, [...months.entries()].map(([month, list], index) => {
    const [year, mon] = month.split("-");
    const body = h("ol", { className: "timeline" }, list.map((entry, position) => entryRow(ctx, entry, index === 0 && position === 0)));
    const title = `${year} 年 ${Number(mon)} 月（${list.length}）`;
    return index < 2 ? h("section", { className: "month" }, [h("h3", { className: "month-head", text: title }), body]) : h("details", { className: "month" }, [h("summary", { className: "month-head", text: title }), body]);
  }));
}

export function renderFolder(ctx, route) {
  const customer = ctx.model.customersById.get(route.id);
  if (!customer) return emptyState("找不到這位客戶", "可能已被合併。", h("a", { className: "button primary", href: "#/search", text: "搜尋客戶" }));
  const tab = TABS.some(([value]) => value === route.query.get("tab")) ? route.query.get("tab") : "timeline";
  const duplicates = customer.archivedAt ? [] : duplicateCandidates(customer, ctx.model.customers, ctx.model.contactsByCustomer);
  const open = (ctx.model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  const prepHref = `#/prep/${encodeURIComponent(customer.id)}${open.length === 1 ? `?opportunity=${encodeURIComponent(open[0].id)}` : ""}`;

  const head = h("section", { className: "card folder-head" }, [
    h("div", { className: "section-head" }, [
      h("div", {}, [h("h1", { text: customer.name }), h("p", { className: "muted", dataset: { folderIdentity: "" }, text: customerIdentity(ctx.model, customer) })]),
      h("button", { type: "button", className: "star", "aria-pressed": String(Boolean(customer.important)), "aria-label": customer.important ? "取消重要標記" : "標記為重要客戶", text: customer.important ? "★" : "☆", onClick: () => setImportant(ctx.db, customer.id, !customer.important, requestId("important")) }),
    ]),
    quickContact(ctx, customer),
    customer.archivedAt ? h("div", { className: "warning-banner" }, [
      h("span", { text: `已封存：${customer.archiveReason || ""}` }),
      customer.mergedIntoId ? h("a", { href: "#/archive?view=merges", text: "到合併紀錄取消合併" }) : h("button", { type: "button", className: "small", text: "復原客戶", onClick: async () => { const result = await restoreCustomer(ctx.db, customer.id, requestId("restore")); toast(result.ok ? "已復原" : result.message || "復原失敗", { tone: result.ok ? "ok" : "error" }); } }),
    ]) : h("div", { className: "button-row" }, [
      h("a", { className: "button primary", href: `#/capture?customer=${encodeURIComponent(customer.id)}`, dataset: { folderCapture: "" }, text: "＋ 記錄" }),
      h("a", { className: "button ghost", href: prepHref, dataset: { folderPrep: "" }, text: "拜訪前準備" }),
      h("details", { className: "more-actions", dataset: { folderMore: "" } }, [
        h("summary", { className: "button ghost", "aria-label": "更多動作", text: "⋯" }),
        h("div", { className: "more-actions-menu" }, [
          h("a", { className: "button small ghost", href: `#/opportunity/new?customer=${encodeURIComponent(customer.id)}`, text: "新商機" }),
          h("button", { type: "button", className: "small ghost", dataset: { editCustomer: "" }, text: "編輯資料", onClick: () => openCustomerEditor(ctx, { customer }) }),
          h("button", { type: "button", className: "small ghost", dataset: { archiveCustomer: "" }, text: "封存", onClick: () => openArchiveCustomer(ctx, customer, { onDone: () => ctx.navigate("search") }) }),
        ]),
      ]),
    ]),
    duplicates.length ? h("button", { type: "button", className: "summary-line warn", dataset: { folderDuplicates: "" }, onClick: () => {
      const group = [customer, ...duplicates.map((item) => ctx.model.customersById.get(item.id)).filter(Boolean)];
      openMergeGroupDialog(ctx, group, { onDone: (keepId) => ctx.navigate(`customer/${encodeURIComponent(keepId)}`) });
    } }, [h("span", { text: `可能還有 ${duplicates.length} 筆同一家的資料` }), h("span", { text: "整理 →" })]) : null,
  ]);

  const counts = { opportunities: open.length, orders: (ctx.model.ordersByCustomer.get(customer.id) || []).length, contacts: (ctx.model.contactsByCustomer.get(customer.id) || []).length };
  const tabs = h("div", { className: "tabs", role: "tablist" }, TABS.map(([value, label]) => h("a", {
    href: `#/customer/${encodeURIComponent(customer.id)}${value === "timeline" ? "" : `?tab=${value}`}`, className: "button small ghost", role: "tab", "aria-selected": String(tab === value), dataset: { folderTab: value },
    text: counts[value] ? `${label} ${counts[value]}` : label,
  })));
  const body = {
    timeline: () => h("section", { className: "card" }, [timeline(ctx, customer)]),
    opportunities: () => opportunitiesCard(ctx, customer),
    orders: () => ordersCard(ctx, customer),
    contacts: () => contactsCard(ctx, customer),
    info: () => h("div", { className: "stack" }, [nextStepCard(ctx, customer), qualificationCard(ctx, customer), relationshipCard(ctx, customer), toolkitCard(ctx, customer), h("section", { className: "card" }, [h("h2", { text: "基本資料" }), h("dl", { className: "kv" }, [
      ["客戶編號", customer.customerNo], ["統編", customer.taxId], ["地址", customer.address], ["區域", (customer.areaTags || []).join("、")],
      ["產業／客群", (customer.industryTags || []).join("、")], ["產品興趣", (customer.productTags || []).join("、")], ["關係狀態", customer.relationStatus], ["備註", customer.notes],
    ].flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value || "—" })]))])]),
  }[tab]();
  return h("div", { className: "stack" }, [head, tabs, body, customer.archivedAt ? badge("已封存", "danger") : null].filter(Boolean));
}

registerPage("customer", { title: "客戶", render: renderFolder });
