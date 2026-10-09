import { formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { archiveContact, duplicateCandidates, restoreCustomer, setImportant } from "../../data/customers.js";
import { isOpportunityOverdue } from "../../data/today.js";
import { recommendToolkit } from "../../data/toolkit.js";
import { QUALIFICATION_ITEMS, qualificationTier, qualificationTotal, saveQualification } from "../../data/qualification.js";
import { RELATIONSHIP_DIMENSIONS, relationshipTotals, saveRelationshipScore } from "../../data/relationship.js";
import { customerIdentity, primaryContact } from "../../data/model.js";
import { opportunityCategory, opportunityTitle } from "../../data/products.js";
import { badge, chipGroup, confirmDialog, emptyState, formToObject, h, money, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { openArchiveCustomer, openContactEditor, openCustomerEditor } from "../forms/customer-forms.js";

function kv(rows) {
  return h("dl", { className: "kv" }, rows.filter(([, value]) => value !== undefined).flatMap(([label, value]) => [h("dt", { text: label }), h("dd", {}, [value || h("span", { className: "muted", text: "尚未填寫" })])]));
}

function tagList(values = [], className = "tag") {
  return values.length ? h("span", { className: "tags" }, values.map((value) => h("span", { className, text: value }))) : null;
}

function telLink(value) {
  return value ? h("a", { href: `tel:${String(value).replace(/[^\d+#]/g, "")}`, text: value }) : null;
}

export function phoneLinks(...values) {
  const numbers = values.flatMap(splitPhones).filter((value, index, list) => list.indexOf(value) === index);
  return numbers.flatMap((number, index) => [index ? "　" : null, telLink(number)]).filter(Boolean);
}

// Imported phone fields often hold several numbers ("(05)235-4516#111 (03)357-6168");
// each gets its own dial button. A space only splits before "(", "0" or "+".
export function splitPhones(value) {
  return String(value || "").split(/[、,，;；/／]|\s+(?=[(（0+])/).map((part) => part.trim()).filter((part) => /\d{6,}/.test(part.replace(/\D/g, "")));
}

// Who to call and the number, right under the name: what you need before dialing.
export function quickContact(ctx, customer) {
  const contact = primaryContact(ctx.model, customer.id);
  const numbers = [contact?.mobile, contact?.phone, customer.phone].flatMap(splitPhones).filter((value, index, list) => list.indexOf(value) === index);
  if (!contact && !numbers.length) return h("p", { className: "muted", dataset: { quickContact: "" } }, ["還沒有聯絡人或電話　", h("button", { type: "button", className: "small ghost", text: "＋ 聯絡人", onClick: () => openContactEditor(ctx, customer.id) })]);
  return h("div", { className: "quick-contact", dataset: { quickContact: "" } }, [
    contact ? h("strong", { text: [contact.name, contact.title].filter(Boolean).join("・") }) : null,
    ...numbers.map((number) => h("a", { className: "button small ghost", href: `tel:${String(number).replace(/[^\d+#]/g, "")}`, dataset: { dial: "" }, text: `☎ ${number}` })),
    contact?.email ? h("a", { className: "button small ghost", href: `mailto:${contact.email}`, text: "✉ Email" }) : null,
  ]);
}

export function qualificationCard(ctx, customer) {
  const current = customer.qualification || {};
  const total = qualificationTotal(current);
  const tier = qualificationTier(total);
  const form = h("form", { className: "stack", dataset: { form: "qualification" } }, [
    h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
    ...QUALIFICATION_ITEMS.map((item) => h("div", { className: "field", dataset: { field: item.key } }, [
      h("span", { className: "field-label", text: `${item.label}：${item.question}` }),
      chipGroup(item.key, ["1", "2", "3", "4", "5"], current[item.key] ? String(current[item.key]) : ""),
      h("small", { className: "muted", text: item.basis }),
    ])),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "small primary", text: "儲存評分" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveQualification(ctx.db, customer.id, formToObject(form), requestId("qualification"), ctx.today());
    if (!result.ok) { showErrors(form, result.errors); return; }
    form.removeAttribute("data-dirty");
    toast("已更新客戶評分");
  });
  return h("section", { className: "card", dataset: { section: "qualification" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "客戶篩選評分" }), total !== null ? badge(`${total} / 25`, tier.tone) : badge("尚未評分")]),
    tier ? h("p", { className: tier.tier === "A" ? "ok-text" : "muted", dataset: { qualificationTier: tier.tier }, text: tier.label }) : h("p", { className: "muted", text: "先評分、再拜訪：把 80% 的時間留給 16 分以上的客戶。" }),
    current.scoredAt ? h("small", { className: "muted", text: `評分日期：${current.scoredAt}` }) : null,
    h("details", {}, [h("summary", { text: total === null ? "開始評分" : "調整評分" }), form]),
  ]);
}

export function relationshipCard(ctx, customer) {
  const score = customer.relationshipScore || {};
  const totals = relationshipTotals(customer.relationshipScore);
  const form = h("form", { className: "stack", dataset: { form: "relationship" } }, [
    h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
    ...RELATIONSHIP_DIMENSIONS.map((dimension) => h("details", { dataset: { dimension: dimension.key } }, [
      h("summary", { text: `${dimension.label}${totals ? `：${totals.dimensions[dimension.key]} / 25` : ""}` }),
      ...dimension.items.map(([key, label]) => h("div", { className: "field" }, [h("span", { className: "field-label", text: label }), chipGroup(`${dimension.key}.${key}`, ["1", "2", "3", "4", "5"], score[dimension.key]?.[key] ? String(score[dimension.key][key]) : "")])),
    ])),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "small primary", text: "儲存損益表" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveRelationshipScore(ctx.db, customer.id, formToObject(form), requestId("relationship"), ctx.today());
    if (!result.ok) { showErrors(form, result.errors); return; }
    form.removeAttribute("data-dirty");
    toast("已更新客戶關係損益表");
  });
  return h("section", { className: "card", dataset: { section: "relationship" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "客戶關係損益表" }), totals ? badge(`${totals.total} / 125`, totals.tier.tone) : badge("尚未評估")]),
    totals ? h("div", { dataset: { relationshipTier: totals.tier.label } }, [h("strong", { text: totals.tier.label }), h("p", { className: "muted", text: totals.tier.strategy }), totals.complete ? null : h("small", { className: "muted", text: `已評 ${totals.scored} / 25 項，評完分數才準確` })]) : h("p", { className: "muted", text: "大客戶一年評一次：用事實打分，決定要積極投資、穩定經營還是降低投入。" }),
    customer.relationshipScore?.scoredAt ? h("small", { className: "muted", text: `評估日期：${customer.relationshipScore.scoredAt}` }) : null,
    h("details", {}, [h("summary", { text: totals ? "調整評分" : "開始評估" }), form]),
  ]);
}

export function contactsCard(ctx, customer) {
  const contacts = ctx.model.contactsByCustomer.get(customer.id) || [];
  return h("section", { className: "card", dataset: { section: "contacts" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `聯絡人（${contacts.length}）` }), h("button", { type: "button", className: "small ghost", dataset: { addContact: "" }, text: "＋ 聯絡人", onClick: () => openContactEditor(ctx, customer.id) })]),
    contacts.length ? h("ul", { className: "contact-list" }, [...contacts].sort((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary))).map((contact) => h("li", {}, [
      h("div", { className: "section-head" }, [
        h("strong", { text: `${contact.name}${contact.isPrimary ? "（主要）" : ""}` }),
        h("div", { className: "row-actions" }, [
          h("button", { type: "button", className: "small ghost", text: "編輯", onClick: () => openContactEditor(ctx, customer.id, contact) }),
          h("button", { type: "button", className: "small ghost", text: "封存", onClick: async () => {
            if (await confirmDialog({ title: `封存聯絡人 ${contact.name}？`, body: h("p", { text: "可在封存區復原。" }), confirmLabel: "封存" })) { await archiveContact(ctx.db, contact.id, requestId("contact-archive")); toast("已封存聯絡人"); }
          } }),
        ]),
      ]),
      [contact.title, contact.department].filter(Boolean).length ? h("span", { className: "muted", text: [contact.title, contact.department].filter(Boolean).join("・") }) : null,
      h("span", {}, phoneLinks(contact.mobile, contact.phone)),
      contact.email ? h("a", { href: `mailto:${contact.email}`, text: contact.email }) : null,
    ]))) : emptyState("尚未建立聯絡人", "", h("button", { type: "button", className: "small primary", text: "新增聯絡人", onClick: () => openContactEditor(ctx, customer.id) })),
  ]);
}

export function opportunitiesCard(ctx, customer) {
  const today = ctx.today();
  const all = ctx.model.opportunitiesByCustomer.get(customer.id) || [];
  const open = all.filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  const closed = all.filter((opportunity) => !open.includes(opportunity));
  const row = (opportunity) => h("a", { href: `#/opportunity/${encodeURIComponent(opportunity.id)}`, className: `opp-card${isOpportunityOverdue(opportunity, today) ? " overdue" : ""}` }, [
    h("strong", { text: opportunityTitle(opportunity, 34) }),
    opportunityCategory(opportunity) ? h("small", { className: "muted", text: opportunityCategory(opportunity) }) : null,
    h("span", { className: "meta", text: [opportunity.stage, opportunity.amount ? money(opportunity.amount) : null, opportunity.probability !== null && opportunity.probability !== undefined && opportunity.probability !== "" ? `${opportunity.probability}%` : null, opportunity.expectedCloseDate ? `預計 ${opportunity.expectedCloseDate}` : null].filter(Boolean).join("・") }),
    isOpportunityOverdue(opportunity, today) ? badge("已逾期，請更新", "warn") : null,
  ]);
  return h("section", { className: "card", dataset: { section: "opportunities" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `進行中商機（${open.length}）` }), h("a", { className: "button small ghost", href: `#/opportunity/new?customer=${encodeURIComponent(customer.id)}`, text: "＋ 商機" })]),
    open.length ? h("div", { className: "result-list" }, open.map(row)) : h("p", { className: "muted", text: "目前沒有進行中的商機。" }),
    closed.length ? h("details", {}, [h("summary", { text: `歷史商機（${closed.length}）` }), h("div", { className: "result-list" }, closed.map(row))]) : null,
  ]);
}

// A short note is shown once; only longer notes fold behind their summary line.
export function noteBlock(activity, open) {
  const note = String(activity.detailedNote || "").trim();
  const summary = activity.summary || note.split("\n")[0].slice(0, 60) || "（無摘要）";
  const shortNote = !note.includes("\n") && note.length <= 120;
  if (!note || shortNote) return h("p", { className: "note", dataset: { activityNote: "" }, text: note || summary });
  return h("details", { open }, [h("summary", { text: summary }), h("p", { className: "note", dataset: { activityNote: "" }, text: note })]);
}

function timelineCard(ctx, customer) {
  const activities = ctx.model.activitiesByCustomer.get(customer.id) || [];
  return h("section", { className: "card", dataset: { section: "activities" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `拜訪紀錄（${activities.length}）` }), h("a", { className: "button small primary", href: `#/visit?customer=${encodeURIComponent(customer.id)}`, text: "記錄拜訪" })]),
    activities.length ? h("ol", { className: "timeline" }, activities.slice(0, 30).map((activity) => h("li", {}, [
      h("div", { className: "when", text: [activity.activityDate, activity.channel, activity.purpose, activity.result].filter(Boolean).join("・") }),
      activity.reaction ? h("div", { className: "muted", text: `客戶反應：${activity.reaction}` }) : null,
      noteBlock(activity, activities.indexOf(activity) === 0),
      activity.nextAction ? h("div", { className: "muted", text: `下一步：${activity.nextAction}${activity.nextFollowUpDate ? `（${activity.nextFollowUpDate}）` : ""}` }) : null,
      activity.nextContactHint ? h("div", { className: "muted", text: `下一步找誰：${activity.nextContactHint}` }) : null,
      h("a", { className: "button small ghost", href: `#/lou/${encodeURIComponent(activity.id)}`, dataset: { louLink: activity.id }, text: "產生會後信" }),
    ]))) : h("p", { className: "muted", text: "還沒有拜訪紀錄。" }),
  ]);
}

export function ordersCard(ctx, customer) {
  const orders = ctx.model.ordersByCustomer.get(customer.id) || [];
  const rows = orders.flatMap((order) => (ctx.model.itemsByOrder.get(order.id) || []).map((item) => ({ order, item })));
  return h("section", { className: "card", dataset: { section: "orders" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `訂單與購買品項（${orders.length} 張）` }), h("a", { className: "small", href: `#/orders?customer=${encodeURIComponent(customer.id)}`, text: "訂單中心 →" })]),
    rows.length ? h("div", { className: "table-wrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["日期", "品項", "數量", "金額", ""].map((label, index) => h("th", { className: index >= 2 && index <= 3 ? "num" : "", text: label })))]),
      h("tbody", {}, rows.slice(0, 40).map(({ order, item }) => h("tr", {}, [
        h("td", { text: order.orderDate || "" }),
        h("td", {}, [h("div", { text: item.productName || item.productCode }), h("small", { className: "muted", text: item.productCode })]),
        h("td", { className: "num", text: item.quantity ?? "" }),
        h("td", { className: "num", text: item.amount ? money(item.amount) : "" }),
        h("td", {}, [item.classification === "首次購買" ? badge("首次購買", "accent") : item.classification === "資料待確認" ? badge("待確認", "warn") : null]),
      ]))),
    ])]) : h("p", { className: "muted", text: "還沒有訂單紀錄。" }),
  ]);
}

export function nextStepCard(ctx, customer) {
  const reminders = (ctx.model.remindersByCustomer.get(customer.id) || []).filter((reminder) => reminder.status !== "完成").sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));
  return h("section", { className: "card", dataset: { section: "next" } }, [
    h("h2", { text: "下一步" }),
    kv([["下一步行動", customer.nextAction], ["下次提醒", customer.nextFollowUpDate ? `${customer.nextFollowUpDate}（${formatShortDate(customer.nextFollowUpDate)}）` : ""]]),
    reminders.length ? h("ul", { className: "task-list" }, reminders.map((reminder) => h("li", { className: `task-row${reminder.dueDate < ctx.today() ? " warn" : ""}` }, [h("span", { className: "task-main" }, [h("strong", { text: reminder.title }), h("span", { text: reminder.kind || "追蹤" })]), h("span", { className: "due", text: reminder.dueDate })]))) : null,
  ]);
}

export function toolkitCard(ctx, customer) {
  const suggestions = recommendToolkit(customer, ctx.toolkit || []);
  return h("section", { className: "card", dataset: { section: "toolkit" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "建議產品資料／DM" }), h("a", { className: "small", href: "#/toolkit", text: "裝備庫 →" })]),
    suggestions.length ? h("ul", { className: "contact-list" }, suggestions.map((item) => h("li", {}, [h("strong", { text: item.name }), item.pitch ? h("span", { text: item.pitch }) : h("span", { className: "muted", text: item.summary }), item.dm ? h("small", { className: "muted", text: `DM：${item.dm}` }) : null]))) : h("p", { className: "muted", text: "替客戶加上產業或產品標籤後，這裡會推薦適合的資料。" }),
  ]);
}

export function renderCustomer(ctx, route) {
  const customer = ctx.model.customersById.get(route.id);
  if (!customer) return h("div", { className: "stack" }, [emptyState("找不到這位客戶", "可能已被合併或連結有誤。", h("a", { className: "button primary", href: "#/customers", text: "回到客戶" }))]);
  const duplicates = customer.archivedAt ? [] : duplicateCandidates(customer, ctx.model.customers, ctx.model.contactsByCustomer);
  const header = h("section", { className: "card detail-head" }, [
    h("div", { className: "section-head" }, [
      h("div", {}, [h("p", { className: "eyebrow", text: customer.customerNo ? `客戶編號 ${customer.customerNo}` : "尚無客戶編號" }), h("h1", { text: customer.name })]),
      h("button", { type: "button", className: "star", "aria-pressed": String(Boolean(customer.important)), "aria-label": customer.important ? "取消重要標記" : "標記為重要客戶", text: customer.important ? "★" : "☆", onClick: () => setImportant(ctx.db, customer.id, !customer.important, requestId("important")) }),
    ]),
    h("div", { className: "tags" }, [...(customer.areaTags || []).map((area) => h("span", { className: "tag area", text: area })), ...(customer.industryTags || []).map((tag) => h("span", { className: "tag", text: tag })), customer.relationStatus ? badge(customer.relationStatus) : null]),
    quickContact(ctx, customer),
    customer.archivedAt ? h("div", { className: "warning-banner", dataset: { archivedBanner: "" } }, [
      h("span", { text: `已封存：${customer.archiveReason || ""}` }),
      customer.mergedIntoId ? h("a", { href: "#/archive?view=merges", text: "到封存區取消合併" }) : h("button", { type: "button", className: "small", dataset: { restoreCustomer: "" }, text: "復原客戶", onClick: async () => {
        const result = await restoreCustomer(ctx.db, customer.id, requestId("customer-restore"));
        toast(result.ok ? "已復原客戶" : result.message || "復原失敗", { tone: result.ok ? "ok" : "error" });
      } }),
    ]) : h("div", { className: "button-row" }, [
      h("a", { className: "button primary", href: `#/visit?customer=${encodeURIComponent(customer.id)}`, text: "記錄拜訪" }),
      h("a", { className: "button ghost", href: `#/opportunity/new?customer=${encodeURIComponent(customer.id)}`, text: "新增商機" }),
      h("button", { type: "button", className: "ghost", dataset: { editCustomer: "" }, text: "編輯資料", onClick: () => openCustomerEditor(ctx, { customer }) }),
      h("button", { type: "button", className: "ghost", dataset: { archiveCustomer: "" }, text: "封存", onClick: () => openArchiveCustomer(ctx, customer, { onDone: () => ctx.navigate("customers") }) }),
    ]),
    duplicates.length ? h("div", { className: "warning-banner", dataset: { duplicateCandidates: "" } }, [
      h("div", {}, [
        h("strong", { text: `可能重複的客戶（${duplicates.length}）` }),
        h("p", { className: "muted", text: `這一筆：${customerIdentity(ctx.model, customer)}` }),
        h("ul", {}, duplicates.map((candidate) => h("li", {}, [
          h("a", { href: `#/customer/${encodeURIComponent(candidate.id)}`, text: `${candidate.name}${candidate.customerNo ? `（${candidate.customerNo}）` : ""}` }),
          ` — ${candidate.reasons.join("、")}${candidate.note ? `；${candidate.note}` : ""} `,
          h("a", { href: `#/merge?primary=${encodeURIComponent(customer.id)}&secondary=${encodeURIComponent(candidate.id)}`, text: "比較／合併" }),
          h("div", { className: "muted", dataset: { candidateIdentity: candidate.id }, text: customerIdentity(ctx.model, ctx.model.customersById.get(candidate.id)) }),
        ]))),
        h("small", { text: "系統只提醒，不會自動合併。看客戶編號、聯絡人和紀錄分辨；確定是同一家再合併，合併後也能復原。" }),
      ]),
    ]) : null,
  ]);
  const basics = h("section", { className: "card", dataset: { section: "basics" } }, [
    h("h2", { text: "基本資料" }),
    kv([
      ["客戶編號", customer.customerNo], ["統編", customer.taxId], ["電話", customer.phone ? h("span", {}, phoneLinks(customer.phone)) : ""], ["地址", customer.address],
      ["區域", tagList(customer.areaTags, "tag area")], ["產業／客群", tagList(customer.industryTags)], ["產品興趣", tagList(customer.productTags)], ["其他分類", tagList(customer.segmentTags)],
      ["最近聯絡", customer.lastContactAt], ["備註", customer.notes ? h("span", { className: "note", text: customer.notes }) : ""],
    ]),
  ]);
  return h("div", { className: "stack" }, [
    header,
    h("div", { className: "grid-main" }, [
      h("div", { className: "stack" }, [timelineCard(ctx, customer), opportunitiesCard(ctx, customer), ordersCard(ctx, customer)]),
      h("div", { className: "stack" }, [nextStepCard(ctx, customer), contactsCard(ctx, customer), basics, qualificationCard(ctx, customer), relationshipCard(ctx, customer), toolkitCard(ctx, customer)]),
    ]),
  ]);
}

registerPage("customer", { title: "客戶詳細", render: renderCustomer });
