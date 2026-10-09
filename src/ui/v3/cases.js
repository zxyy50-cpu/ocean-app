import { formatShortDate, weekdayLabel } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { caseRedFlags, opportunityContext } from "../../data/case-analysis.js";
import { isOpen, updateOpportunity } from "../../data/opportunities.js";
import { opportunityCategory, opportunityTitle, productOptions } from "../../data/products.js";
import { customerInAreas } from "../../data/tags.js";
import { isOpportunityOverdue, opportunityAttention } from "../../data/today.js";
import { OPEN_OPPORTUNITY_STAGES } from "../../data/schema.js";
import { badge, emptyState, field, formToObject, h, input, money, select, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { changeStage, lostDialog, wonDialog } from "../pages/opportunity.js";
import { openContactEditor } from "../forms/customer-forms.js";

const state = { mineOnly: true, query: "" };
const ATTENTION_LIMIT = 7;

export function resetCasesState() {
  Object.assign(state, { mineOnly: true, query: "" });
}

function caseRow(ctx, opportunity, today, note = "") {
  const attention = opportunityAttention(opportunity, today);
  return h("li", { dataset: { caseRow: opportunity.id } }, [h("a", { href: `#/case/${encodeURIComponent(opportunity.id)}` }, [
    h("strong", { text: `${ctx.model.customerName(opportunity.customerId)}・${opportunityTitle(opportunity, 30)}` }),
    h("small", { className: "muted", text: [opportunityCategory(opportunity), opportunity.stage, opportunity.amount ? money(opportunity.amount) : "金額未填", note || attention?.label, opportunity.nextAction ? `下一步：${opportunity.nextAction}` : null].filter(Boolean).join("・") }),
  ])]);
}

// Cases worth a look first (late or with a red flag, biggest first), then the rest by stage.
export function renderCases(ctx) {
  const today = ctx.today();
  const query = state.query.trim().toLocaleLowerCase();
  const pool = ctx.model.openOpportunities.filter((opportunity) => {
    const customer = ctx.model.customersById.get(opportunity.customerId);
    if (!customer || customer.archivedAt) return false;
    if (state.mineOnly && (customer.areaTags || []).length && !customerInAreas(customer, ctx.settings.myAreas)) return false;
    return !query || `${customer.name}${opportunity.name}${opportunity.product || ""}`.toLocaleLowerCase().includes(query);
  });
  const flagged = pool.map((opportunity) => ({ opportunity, red: ["提案", "議價"].includes(opportunity.stage) ? caseRedFlags(ctx.model, opportunity, today).find((flag) => flag.level === "red") : null }))
    .filter(({ opportunity, red }) => red || (["提案", "議價"].includes(opportunity.stage) && isOpportunityOverdue(opportunity, today)))
    .sort((left, right) => (Number(right.opportunity.amount) || 0) - (Number(left.opportunity.amount) || 0));
  const attentionIds = new Set(flagged.slice(0, ATTENTION_LIMIT).map(({ opportunity }) => opportunity.id));
  const byStage = (stage) => pool.filter((opportunity) => opportunity.stage === stage && !attentionIds.has(opportunity.id)).sort((left, right) => (Number(right.amount) || 0) - (Number(left.amount) || 0));

  const search = h("input", { type: "search", value: state.query, placeholder: "找案子：客戶或商機名稱", "aria-label": "搜尋案子", dataset: { caseSearch: "" } });
  search.addEventListener("change", () => { state.query = search.value; ctx.render(); });
  const mine = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.mineOnly, dataset: { casesMineOnly: "" }, onChange: (event) => { state.mineOnly = event.target.checked; ctx.render(); } }), h("span", { text: "只看我的區域" })]);
  const total = pool.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0), 0);

  const stageBlock = (stage, openByDefault) => {
    const list = byStage(stage);
    if (!list.length) return null;
    const body = h("ul", { className: "result-rows" }, list.slice(0, 40).map((opportunity) => caseRow(ctx, opportunity, today)));
    const title = `${stage}（${list.length}）`;
    return openByDefault ? h("section", { className: "card", dataset: { caseStage: stage } }, [h("h2", { text: title }), body]) : h("details", { className: "card", dataset: { caseStage: stage } }, [h("summary", { text: title }), body, list.length > 40 ? h("a", { className: "small", href: "#/opportunities", text: `其餘 ${list.length - 40} 件到商機清單看 →` }) : null]);
  };

  return h("div", { className: "stack" }, [
    h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "案子" }), h("p", { text: `進行中 ${pool.length} 件・${money(total)}` })]), h("div", { className: "page-actions" }, [h("a", { className: "button ghost", href: "#/opportunities", text: "完整清單與批次整理" })])]),
    h("div", { className: "search-box" }, [search]),
    mine,
    flagged.length ? h("section", { className: "card", dataset: { caseAttention: "" } }, [
      h("div", { className: "section-head" }, [h("h2", { text: "先看這幾件" }), badge(String(Math.min(flagged.length, ATTENTION_LIMIT)), "warn")]),
      h("ul", { className: "result-rows" }, flagged.slice(0, ATTENTION_LIMIT).map(({ opportunity, red }) => caseRow(ctx, opportunity, today, red ? `★ ${red.text}` : ""))),
    ]) : null,
    stageBlock("議價", true),
    stageBlock("提案", true),
    stageBlock("接觸", false),
    pool.length ? null : emptyState("沒有進行中的案子", "從客戶資料夾或記錄時都可以建立商機。"),
  ]);
}

// One case on one screen: where it stands, who matters, what's blocking, and the next step.
export function renderCase(ctx, route) {
  const opportunity = ctx.model.opportunitiesById.get(route.id);
  if (!opportunity) return emptyState("找不到這個案子", "", h("a", { className: "button primary", href: "#/cases", text: "回到案子" }));
  const today = ctx.today();
  const customer = ctx.model.customersById.get(opportunity.customerId);
  const open = isOpen(opportunity) && !opportunity.archivedAt;
  const attention = opportunityAttention(opportunity, today);
  const { stakeholders } = opportunityContext(ctx.model, opportunity);
  const flags = open ? caseRedFlags(ctx.model, opportunity, today).filter((flag) => flag.level !== "info").slice(0, 3) : [];

  // One form for everything that changes as the case moves: who we talk to, what we're
  // selling, the money, the next step, and a free-text update stamped with today's date.
  const contacts = ctx.model.contactsByCustomer.get(opportunity.customerId) || [];
  const listId = `products-${opportunity.id}`;
  const nextForm = h("form", { className: "form-grid", novalidate: true, dataset: { form: "case-next" } }, [
    h("p", { className: "field-error span-2", role: "alert", hidden: true, dataset: { formErrors: "" } }),
    field("推的產品（品牌＋名稱）", input("product", opportunity.product && opportunity.product !== opportunity.name ? opportunity.product : "", { list: listId, placeholder: "例如：bioMérieux VIDAS" }), { className: "span-2" }),
    h("datalist", { id: listId }, productOptions(ctx.toolkit || []).map((value) => h("option", { value }))),
    h("div", { className: "stack", style: { gap: "4px" } }, [
      field("對口聯絡人", select("contactId", [{ value: "", label: "（未指定）" }, ...contacts.map((contact) => ({ value: contact.id, label: [contact.name, contact.title].filter(Boolean).join("・") }))], opportunity.contactId || "")),
      h("button", { type: "button", className: "small ghost", dataset: { caseAddContact: "" }, text: "＋ 新增聯絡人", onClick: () => openContactEditor(ctx, opportunity.customerId) }),
    ]),
    field("預估金額（未稅）", input("amount", opportunity.amount ?? "", { type: "number", min: 0, inputmode: "numeric" })),
    field("下一步", input("nextAction", opportunity.nextAction, { placeholder: "對誰、做什麼" }), { className: "span-2" }),
    field("提醒日期", input("reminderDate", opportunity.reminderDate || "", { type: "date", min: today })),
    field("預計結案日", input("expectedCloseDate", opportunity.expectedCloseDate || "", { type: "date" })),
    field("最新狀況（自己寫）", h("textarea", { name: "update", rows: 3, placeholder: "例如：廠長同意先試用一條線，預算要等 11 月確認" }), { className: "span-2", hint: "會加上今天日期，放在備註最上面" }),
    opportunity.notes ? h("details", { className: "span-2" }, [h("summary", { text: "之前的狀況與備註" }), h("p", { className: "note", text: opportunity.notes })]) : null,
    h("div", { className: "form-actions span-2" }, [h("button", { type: "submit", className: "small primary", text: "更新案子" })]),
  ]);
  nextForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const { update, ...values } = formToObject(nextForm);
    const note = String(update || "").trim();
    if (note) values.notes = [`${today}：${note}`, opportunity.notes].filter(Boolean).join("\n");
    if (!values.product) delete values.product;
    const result = await updateOpportunity(ctx.db, opportunity.id, values, requestId("case-next"), { expectedRev: opportunity.localRev });
    if (!result.ok) { showErrors(nextForm, result.error === "stale" ? { _: "這個案子剛被改過，重新整理後再試；你輸入的還在。" } : result.errors || { _: "更新失敗" }); return; }
    nextForm.removeAttribute("data-dirty");
    toast(opportunity.reminderDate !== result.value.reminderDate && result.value.reminderDate ? `已更新，${formatShortDate(result.value.reminderDate)} 週${weekdayLabel(result.value.reminderDate)} 提醒` : "已更新");
  });

  return h("div", { className: "stack case" }, [
    h("section", { className: "card" }, [
      h("p", { className: "eyebrow" }, [customer ? h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name }) : "（未知客戶）"]),
      h("h1", { text: opportunityTitle(opportunity, 40) }),
      opportunityCategory(opportunity) ? h("p", { className: "muted", dataset: { caseCategory: "" }, text: `類別：${opportunityCategory(opportunity)}` }) : null,
      opportunity.name.length > 40 ? h("details", {}, [h("summary", { text: "完整名稱" }), h("p", { className: "note", text: opportunity.name })]) : null,
      h("div", { className: "tags" }, [badge(opportunity.stage, open ? "accent" : opportunity.stage === "成交" ? "ok" : "neutral"), badge(opportunity.amount ? money(opportunity.amount) : "金額未填", opportunity.amount ? "neutral" : "warn"), attention ? badge(attention.label, "warn") : null]),
      open ? h("div", { className: "button-row", dataset: { stageStepper: "" } }, OPEN_OPPORTUNITY_STAGES.map((stage) => h("button", { type: "button", className: `small ${stage === opportunity.stage ? "primary" : "ghost"}`, "aria-pressed": String(stage === opportunity.stage), dataset: { stage }, text: stage, onClick: () => { if (stage !== opportunity.stage) changeStage(ctx, opportunity, stage); } }))) : null,
      h("div", { className: "button-row" }, [
        h("a", { className: "button primary", href: `#/capture?customer=${encodeURIComponent(opportunity.customerId)}&opportunity=${encodeURIComponent(opportunity.id)}`, text: "＋ 記錄" }),
        open ? h("a", { className: "button ghost", href: `#/prep/${encodeURIComponent(opportunity.customerId)}?opportunity=${encodeURIComponent(opportunity.id)}`, text: "拜訪前準備" }) : null,
        open ? h("button", { type: "button", className: "ghost", dataset: { markWon: "" }, text: "成交", onClick: () => wonDialog(ctx, opportunity) }) : null,
        open ? h("button", { type: "button", className: "ghost", dataset: { markLost: "" }, text: "未成交", onClick: () => lostDialog(ctx, opportunity) }) : null,
      ]),
    ]),
    flags.length ? h("section", { className: "card", dataset: { caseFlags: "" } }, [h("h2", { text: "卡在哪" }), h("ul", {}, flags.map((flag) => h("li", {}, [h("strong", { text: flag.text }), h("div", { className: "muted", text: flag.hint })])))]) : null,
    h("section", { className: "card", dataset: { casePeople: "" } }, [
      h("div", { className: "section-head" }, [h("h2", { text: `關鍵人物（${stakeholders.length}）` }), h("a", { className: "small", href: `#/opportunity/${encodeURIComponent(opportunity.id)}?tab=case`, text: "＋ 標記" })]),
      stakeholders.length ? h("ul", { className: "result-rows" }, stakeholders.map((person) => h("li", {}, [h("strong", { text: person.name }), h("small", { className: "muted", text: [person.role, person.stance ? `看法：${person.stance}` : "看法未知", person.relation].filter(Boolean).join("・") })]))) : h("p", { className: "muted", text: "還不知道誰拍板、誰使用、誰把關。" }),
    ]),
    open ? h("section", { className: "card" }, [h("h2", { text: "更新案子" }), nextForm]) : null,
    h("a", { className: "summary-line", href: `#/opportunity/${encodeURIComponent(opportunity.id)}${open ? "?tab=case" : ""}`, dataset: { deepAnalysis: "" } }, [h("span", { text: "深入分析：案況、談判、競爭、修改紀錄" }), h("span", { text: "→" })]),
  ]);
}

registerPage("cases", { title: "案子", render: renderCases });
registerPage("case", { title: "案子", render: renderCase });
