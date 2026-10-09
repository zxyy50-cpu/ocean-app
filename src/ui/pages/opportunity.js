import { addWorkdays } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { searchCustomers } from "../../data/customers.js";
import { archiveOpportunity, createOpportunity, isOpen, markLost, markWon, prependNote, reopenOpportunity, restoreOpportunity, REVIEW_QUESTIONS, STAGE_DEFAULT_PROBABILITY, updateOpportunity } from "../../data/opportunities.js";
import { LOST_REASONS, OPEN_OPPORTUNITY_STAGES } from "../../data/schema.js";
import { opportunityTitle } from "../../data/products.js";
import { opportunityAttention } from "../../data/today.js";
import { badge, emptyState, field, formToObject, h, input, money, openDialog, select, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { caseAnalysisSection } from "../forms/case-analysis.js";
import { negotiationSection } from "../forms/negotiation.js";
import { competitionSection } from "../forms/competition.js";
import { aftercareSection } from "../forms/aftercare.js";

const FIELD_LABELS = { stage: "階段", amount: "金額", probability: "成交機率", expectedCloseDate: "預計結案日", name: "名稱", product: "產品", nextAction: "下一步", reminderDate: "提醒日", lostReason: "未成交原因", archivedAt: "封存" };

function editorForm(ctx, opportunity, { customerId, onSaved }) {
  const isNew = !opportunity;
  const values = opportunity || { stage: "接觸", customerId };
  const rid = requestId(isNew ? "opportunity-create" : "opportunity-edit");
  const contacts = ctx.model.contactsByCustomer.get(values.customerId) || [];
  const form = h("form", { className: "card form-card", novalidate: true, dataset: { form: "opportunity" } }, [
    h("h2", { text: isNew ? "商機內容" : "編輯內容" }),
    h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
    h("input", { type: "hidden", name: "customerId", value: values.customerId || "" }),
    h("div", { className: "form-grid" }, [
      field("商機名稱 *", input("name", values.name, { placeholder: "例如：沙門氏菌快篩導入" }), { className: "span-2" }),
      field("產品／服務", input("product", values.product)),
      isNew ? field("階段 *", select("stage", ["接觸", "提案", "議價"], values.stage), { hint: "提案以後需填金額" }) : null,
      field("預估金額（未稅）", input("amount", values.amount ?? "", { type: "number", min: 0, inputmode: "numeric" })),
      field("成交機率 %", input("probability", values.probability ?? "", { type: "number", min: 0, max: 100, placeholder: `預設 ${STAGE_DEFAULT_PROBABILITY[values.stage] ?? ""}` })),
      field("預計結案日", input("expectedCloseDate", values.expectedCloseDate || "", { type: "date" })),
      field("對口聯絡人", select("contactId", [{ value: "", label: "（未指定）" }, ...contacts.map((contact) => ({ value: contact.id, label: contact.name }))], values.contactId || "")),
      field("下一步", input("nextAction", values.nextAction)),
      field("提醒日期", input("reminderDate", values.reminderDate || "", { type: "date" })),
      field("備註", h("textarea", { name: "notes", rows: 3, value: values.notes || "" }), { className: "span-2" }),
    ]),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: isNew ? "建立商機" : "儲存變更" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formToObject(form);
    if (!data.customerId) { showErrors(form, { _: "請先選擇客戶" }); return; }
    const result = isNew
      ? await createOpportunity(ctx.db, data, rid, { source: "手動" })
      : await updateOpportunity(ctx.db, opportunity.id, data, `${rid}:${Date.now()}`, { expectedRev: opportunity.localRev });
    if (!result.ok) {
      showErrors(form, result.error === "stale" ? { _: "這筆商機剛剛被修改過，請重新整理後再編輯；你輸入的內容仍在畫面上。" } : result.errors || { _: result.message || "儲存失敗" });
      return;
    }
    form.removeAttribute("data-dirty");
    toast(isNew ? "已建立商機" : "已儲存商機");
    onSaved?.(result.value);
  });
  return form;
}

function customerPicker(ctx) {
  const results = h("div", { className: "picker-results" });
  const search = h("input", { type: "search", placeholder: "先找客戶：公司、聯絡人或電話", "aria-label": "選擇商機客戶", dataset: { opportunityCustomerSearch: "" } });
  search.addEventListener("input", () => {
    const found = search.value.trim() ? searchCustomers(ctx.model, { query: search.value, myAreas: ctx.settings.myAreas, today: ctx.today(), limit: 8 }).items : [];
    results.replaceChildren(...found.map(({ customer }) => h("button", { type: "button", dataset: { pickCustomer: customer.id }, text: customer.name, onClick: () => ctx.navigate(`opportunity/new?customer=${encodeURIComponent(customer.id)}`) })));
  });
  return h("section", { className: "card form-card" }, [h("h2", { text: "這個商機屬於哪位客戶？" }), h("div", { className: "search-box" }, [search]), results]);
}

export function lostDialog(ctx, opportunity) {
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: "lost" } }, [
      h("h2", { text: `「${opportunityTitle(opportunity, 30)}」未成交` }),
      field("主要原因", select("lostReason", LOST_REASONS, LOST_REASONS[0])),
      field("實際狀況（自己寫）", h("textarea", { name: "note", rows: 3, placeholder: "例如：總公司統一採購，改用原廠合約價" }), { hint: "會加上今天日期，放在備註最上面" }),
      reviewFields(opportunity.review),
      h("p", { className: "muted", text: "未成交的商機會保留在歷史紀錄，之後可以重新開啟。" }),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "danger", text: "標記未成交" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await markLost(ctx.db, opportunity.id, form.elements.lostReason.value, requestId("opportunity-lost"), { review: collectReview(form), notes: prependNote(opportunity.notes, form.elements.note.value, ctx.today()) });
      close();
      toast(result.ok ? "已標記未成交" : "更新失敗", { tone: result.ok ? "ok" : "error" });
    });
    return form;
  }, { label: "標記未成交" });
}

function reviewFields(existing = {}) {
  return h("fieldset", { className: "stack", dataset: { reviewFields: "" } }, [
    h("legend", { text: "檢討三問（選填，但最有價值）" }),
    ...REVIEW_QUESTIONS.map((question) => field(question.label, h("textarea", { name: `review.${question.key}`, rows: 2, value: existing?.[question.key] || "" }))),
  ]);
}

function collectReview(form) {
  return Object.fromEntries(REVIEW_QUESTIONS.map((question) => [question.key, form.elements[`review.${question.key}`]?.value || ""]));
}

export function wonDialog(ctx, opportunity) {
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: "won" } }, [
      h("h2", { text: `恭喜！「${opportunityTitle(opportunity, 30)}」成交` }),
      field("成交金額（未稅）", input("amount", opportunity.amount ?? "", { type: "number", min: 0, required: true })),
      field("成交狀況（自己寫）", h("textarea", { name: "note", rows: 2, placeholder: "例如：先買一台，明年再加第二台" })),
      reviewFields(opportunity.review),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "標記成交" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await markWon(ctx.db, opportunity.id, requestId("opportunity-won"), { amount: form.elements.amount.value, review: collectReview(form), notes: prependNote(opportunity.notes, form.elements.note.value, ctx.today()) });
      if (!result.ok) { showErrors(form, result.errors || { _: "更新失敗" }); return; }
      close();
      toast("已標記成交 🎉", { timeout: 8000, action: h("button", { type: "button", className: "small", text: "安排成交後經營", onClick: () => ctx.navigate(`opportunity/${encodeURIComponent(opportunity.id)}?tab=aftercare`) }) });
    });
    return form;
  }, { label: "標記成交" });
}

// Moving a stage asks only for what's missing: an amount from 提案 on, and a new
// close date when the old one has passed. Every move can be undone from the toast.
async function applyStage(ctx, opportunity, patch) {
  const previous = { stage: opportunity.stage, probability: opportunity.probability ?? "", expectedCloseDate: opportunity.expectedCloseDate || "" };
  const result = await updateOpportunity(ctx.db, opportunity.id, patch, requestId("opportunity-stage"));
  if (!result.ok) return result;
  toast(`已移到「${patch.stage}」`, { timeout: 8000, action: h("button", { type: "button", className: "small", dataset: { undoStage: "" }, text: "復原", onClick: async () => {
    const undone = await updateOpportunity(ctx.db, opportunity.id, previous, requestId("opportunity-stage-undo"));
    toast(undone.ok ? `已改回「${previous.stage}」` : "復原失敗", { tone: undone.ok ? "ok" : "error" });
  } }) });
  return result;
}

export function changeStage(ctx, opportunity, stage) {
  const today = ctx.today();
  const needsAmount = ["提案", "議價"].includes(stage) && !(Number(opportunity.amount) > 0);
  const overdue = Boolean(opportunity.expectedCloseDate && opportunity.expectedCloseDate < today);
  if (!needsAmount && !overdue) {
    applyStage(ctx, opportunity, { stage }).then((result) => { if (!result.ok) toast(Object.values(result.errors || {}).join("、") || "更新失敗", { tone: "error", timeout: 6000 }); });
    return;
  }
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "stage-change" } }, [
      h("h2", { text: `移到「${stage}」` }),
      h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
      needsAmount ? field("預估金額（未稅）*", input("amount", "", { type: "number", min: 0, inputmode: "numeric" }), { hint: "進入提案以後需要金額，才算得出加權預估" }) : null,
      overdue ? field("新的預計結案日", input("expectedCloseDate", addWorkdays(today, 30), { type: "date", min: today }), { hint: `原本是 ${opportunity.expectedCloseDate}，已經過了` }) : null,
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "確認" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const values = formToObject(form);
      const result = await applyStage(ctx, opportunity, { stage, ...values });
      if (!result.ok) { showErrors(form, result.errors || { _: result.message || "更新失敗" }); return; }
      close();
    });
    return form;
  }, { label: `移到${stage}` });
}

function historySlot(ctx, opportunity) {
  const slot = h("ol", { className: "timeline", dataset: { opportunityHistory: "" } });
  ctx.db.allChanges().then((changes) => {
    const relevant = changes.filter((change) => change.entityType === "opportunity" && change.entityId === opportunity.id).reverse().slice(0, 30);
    slot.replaceChildren(...relevant.map((change) => h("li", {}, [
      h("div", { className: "when", text: `${new Date(change.at).toLocaleString("zh-TW")}・${{ create: "建立", update: "修改", archive: "封存", restore: "復原", resolve: "解決衝突" }[change.operation] || change.operation}` }),
      h("div", { text: Object.entries(change.patch || {}).filter(([key]) => FIELD_LABELS[key]).map(([key, value]) => `${FIELD_LABELS[key]}：${value ?? "（清空）"}`).join("、") || "—" }),
    ])));
    if (!relevant.length) slot.replaceChildren(h("li", { className: "muted", text: "匯入時的資料，尚無修改紀錄。" }));
  }).catch(() => {});
  return slot;
}

export function renderOpportunity(ctx, route) {
  if (route.id === "new") {
    const customerId = route.query.get("customer") || "";
    const customer = ctx.model.customersById.get(customerId);
    return h("div", { className: "stack" }, [
      h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "新增商機" }), customer ? h("p", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name })]) : null])]),
      customer ? editorForm(ctx, null, { customerId, onSaved: (opportunity) => ctx.navigate(`opportunity/${opportunity.id}`) }) : customerPicker(ctx),
    ]);
  }
  const opportunity = ctx.model.opportunitiesById.get(route.id);
  if (!opportunity) return emptyState("找不到這個商機", "", h("a", { className: "button primary", href: "#/opportunities", text: "回到商機" }));
  const customer = ctx.model.customersById.get(opportunity.customerId);
  const attention = opportunityAttention(opportunity, ctx.today());
  const open = isOpen(opportunity);
  const activities = (ctx.model.activitiesByCustomer.get(opportunity.customerId) || []).filter((activity) => activity.opportunityId === opportunity.id);

  const stepper = open ? h("div", { className: "button-row", dataset: { stageStepper: "" } }, OPEN_OPPORTUNITY_STAGES.map((stage) => h("button", {
    type: "button", className: `small ${stage === opportunity.stage ? "primary" : "ghost"}`, "aria-pressed": String(stage === opportunity.stage), dataset: { stage },
    text: stage, onClick: () => { if (stage !== opportunity.stage) changeStage(ctx, opportunity, stage); },
  }))) : null;

  const header = h("section", { className: "card detail-head" }, [
    h("p", { className: "eyebrow" }, [customer ? h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name }) : "（未知客戶）"]),
    h("h1", { text: opportunity.name }),
    h("div", { className: "tags" }, [badge(opportunity.stage, open ? "accent" : opportunity.stage === "成交" ? "ok" : "neutral"), opportunity.amount ? badge(money(opportunity.amount)) : badge("金額未填", "warn"), attention ? badge(attention.label, "warn") : null, opportunity.source ? badge(`來源：${opportunity.source}`) : null, opportunity.archivedAt ? badge("已封存", "danger") : null]),
    attention ? h("div", { className: "warning-banner", text: "這個商機已逾期。請更新階段、延後預計結案日，或標記結果；系統不會自動結案。" }) : null,
    stepper,
    opportunity.archivedAt
      ? h("div", { className: "button-row" }, [h("button", { type: "button", className: "primary", dataset: { restoreOpportunity: "" }, text: "復原商機", onClick: async () => { const result = await restoreOpportunity(ctx.db, opportunity.id, requestId("opportunity-restore")); toast(result.ok ? "已復原商機" : "復原失敗", { tone: result.ok ? "ok" : "error" }); } })])
      : h("div", { className: "button-row" }, [
        h("a", { className: "button primary", href: `#/visit?customer=${encodeURIComponent(opportunity.customerId)}&opportunity=${encodeURIComponent(opportunity.id)}`, text: "記錄拜訪" }),
        open ? h("button", { type: "button", className: "ghost", dataset: { markWon: "" }, text: "標記成交", onClick: () => wonDialog(ctx, opportunity) }) : null,
        open ? h("button", { type: "button", className: "ghost", dataset: { markLost: "" }, text: "標記未成交", onClick: () => lostDialog(ctx, opportunity) }) : null,
        !open ? h("button", { type: "button", className: "ghost", dataset: { reopen: "" }, text: "重新開啟", onClick: async () => { const result = await reopenOpportunity(ctx.db, opportunity.id, "接觸", requestId("opportunity-reopen")); toast(result.ok ? "已重新開啟為「接觸」" : "更新失敗", { tone: result.ok ? "ok" : "error" }); } }) : null,
        h("button", { type: "button", className: "ghost", dataset: { archiveOpportunity: "" }, text: "封存", onClick: async () => {
          const result = await archiveOpportunity(ctx.db, opportunity.id, "使用者封存", requestId("opportunity-archive"));
          toast(result.ok ? "已封存商機，可在封存區復原" : "封存失敗", { tone: result.ok ? "ok" : "error" });
        } }),
      ]),
  ]);

  const won = opportunity.stage === "成交" && !opportunity.archivedAt;
  // Early contacts open on the plain details (date, next step); the B2B case
  // analysis becomes the starting tab once there is a proposal on the table.
  const analysisFirst = open && !opportunity.archivedAt && opportunity.stage !== "接觸";
  const tab = route.query.get("tab") || (analysisFirst ? "case" : won ? "aftercare" : "detail");
  const tabList = won ? [["aftercare", "成交後經營"], ["detail", "內容與紀錄"], ["case", "案況分析"]]
    : analysisFirst ? [["case", "案況分析"], ["negotiation", "談判準備"], ["competition", "競爭分析"], ["detail", "內容與紀錄"]]
    : [["detail", "內容與紀錄"], ["case", "案況分析"], ["negotiation", "談判準備"], ["competition", "競爭分析"]];
  const tabs = h("div", { className: "tabs", role: "tablist" }, tabList.map(([value, label]) => h("a", {
    href: `#/opportunity/${encodeURIComponent(opportunity.id)}?tab=${value}`, className: "button small ghost", role: "tab", "aria-selected": String(tab === value), dataset: { opportunityTab: value }, text: label,
  })));
  if (tab === "case") return h("div", { className: "stack" }, [header, tabs, caseAnalysisSection(ctx, opportunity)]);
  if (tab === "aftercare" && won) return h("div", { className: "stack" }, [header, tabs, aftercareSection(ctx, opportunity)]);
  if (tab === "negotiation") return h("div", { className: "stack" }, [header, tabs, negotiationSection(ctx, opportunity)]);
  if (tab === "competition") return h("div", { className: "stack" }, [header, tabs, competitionSection(ctx, opportunity)]);
  return h("div", { className: "stack" }, [
    header,
    tabs,
    h("div", { className: "grid-main" }, [
      opportunity.archivedAt ? h("section", { className: "card" }, [h("p", { className: "muted", text: "封存中的商機不能編輯，請先復原。" })]) : editorForm(ctx, opportunity, { customerId: opportunity.customerId }),
      h("div", { className: "stack" }, [
        h("section", { className: "card" }, [h("h2", { text: `相關拜訪（${activities.length}）` }), activities.length ? h("ol", { className: "timeline" }, activities.map((activity) => h("li", {}, [h("div", { className: "when", text: `${activity.activityDate}・${activity.channel || ""}` }), h("p", { className: "note", text: activity.detailedNote })]))) : h("p", { className: "muted", text: "尚無與此商機相關的拜訪。" })]),
        opportunity.review ? h("section", { className: "card", dataset: { reviewCard: "" } }, [h("h2", { text: opportunity.stage === "成交" ? "成交檢討" : "流失檢討" }), h("dl", { className: "kv" }, REVIEW_QUESTIONS.flatMap((question) => [h("dt", { text: question.label }), h("dd", { text: opportunity.review[question.key] || "—" })]))]) : null,
        h("section", { className: "card" }, [h("h2", { text: "修改紀錄" }), historySlot(ctx, opportunity)]),
      ]),
    ]),
  ]);
}

registerPage("opportunity", { title: "商機", render: renderOpportunity, keepOnDataChange: false });
