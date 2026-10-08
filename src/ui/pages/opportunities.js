import { addWorkdays } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { filterOpportunities, markLostMany, postponeOpportunities } from "../../data/opportunities.js";
import { LOST_REASONS, OPEN_OPPORTUNITY_STAGES } from "../../data/schema.js";
import { customerInAreas } from "../../data/tags.js";
import { opportunityAttention } from "../../data/today.js";
import { caseRedFlags } from "../../data/case-analysis.js";
import { badge, emptyState, field, h, input, money, openDialog, select, shortMoney, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const VIEWS = [
  { value: "open", label: "進行中" }, { value: "overdue", label: "已逾期" }, { value: "won", label: "已成交" }, { value: "lost", label: "未成交" },
];
const state = { layout: "board", query: "", mineOnly: true };

export function resetOpportunityListState() {
  Object.assign(state, { layout: "board", query: "", mineOnly: true });
}

function opportunityCard(ctx, opportunity, { selectable = false, selected = null } = {}) {
  const today = ctx.today();
  const attention = opportunityAttention(opportunity, today);
  const link = h("a", { href: `#/opportunity/${encodeURIComponent(opportunity.id)}`, className: "task-main" }, [
    h("strong", { text: opportunity.name }),
    h("span", { text: ctx.model.customerName(opportunity.customerId) }),
  ]);
  return h("article", { className: `opp-card${attention ? " overdue" : ""}`, dataset: { opportunityCard: opportunity.id } }, [
    selectable ? h("label", { className: "chip" }, [h("input", { type: "checkbox", value: opportunity.id, checked: selected?.has(opportunity.id), dataset: { selectOpportunity: opportunity.id }, onChange: (event) => { if (event.target.checked) selected.add(opportunity.id); else selected.delete(opportunity.id); } }), h("span", { text: "選取" })]) : null,
    link,
    h("span", { className: "meta", text: [opportunity.stage, opportunity.amount ? money(opportunity.amount) : "金額未填", opportunity.probability !== null && opportunity.probability !== undefined && opportunity.probability !== "" ? `${opportunity.probability}%` : null, opportunity.expectedCloseDate ? `預計 ${opportunity.expectedCloseDate}` : null].filter(Boolean).join("・") }),
    opportunity.nextAction ? h("span", { className: "meta", text: `下一步：${opportunity.nextAction}` }) : null,
    attention ? badge(attention.label, "warn") : null,
    (() => { if (!["提案", "議價"].includes(opportunity.stage)) return null; const red = caseRedFlags(ctx.model, opportunity, today).filter((flag) => flag.level === "red"); return red.length ? badge(`★ ${red[0].text}${red.length > 1 ? ` 等 ${red.length} 項` : ""}`, "danger") : null; })(),
    opportunity.stage === "失敗" && opportunity.lostReason ? badge(`原因：${opportunity.lostReason}`) : null,
  ]);
}

function openBatchDialog(ctx, ids, mode) {
  return openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: `batch-${mode}` } }, [
      h("h2", { text: mode === "postpone" ? `延後 ${ids.length} 件商機的預計結案日` : `將 ${ids.length} 件商機標記為未成交` }),
      h("p", { className: "muted", text: "這是一次性的整批更新；每件商機都會留下修改紀錄，之後仍可個別調整或重新開啟。" }),
      mode === "postpone"
        ? field("新的預計結案日", input("expectedCloseDate", addWorkdays(ctx.today(), 30), { type: "date", min: ctx.today() }))
        : field("未成交原因", select("lostReason", LOST_REASONS, "需求消失")),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: mode === "postpone" ? "primary" : "danger", text: "確認更新" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = mode === "postpone"
        ? await postponeOpportunities(ctx.db, ids, form.elements.expectedCloseDate.value, requestId("batch-postpone"))
        : await markLostMany(ctx.db, ids, form.elements.lostReason.value, requestId("batch-lost"));
      if (!result.ok) {
        const message = form.querySelector("[data-form-errors]");
        message.hidden = false;
        message.textContent = Object.values(result.errors || {}).join("、") || result.message || "更新失敗，沒有任何商機被修改";
        return;
      }
      close();
      toast(`已更新 ${ids.length} 件商機`);
    });
    return form;
  }, { label: "批次整理商機" });
}

export function renderOpportunities(ctx, route) {
  const view = VIEWS.some((item) => item.value === route.query.get("filter")) ? route.query.get("filter") : "open";
  const today = ctx.today();
  // "My areas" also keeps customers that have no area yet, so nothing silently disappears.
  const mineIds = state.mineOnly ? new Set(ctx.model.customers.filter((customer) => !(customer.areaTags || []).length || customerInAreas(customer, ctx.settings.myAreas)).map((customer) => customer.id)) : null;
  const list = filterOpportunities(ctx.model, { view, query: state.query, today, customerIds: mineIds });
  const total = list.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0), 0);
  const weighted = list.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0) * ((Number(opportunity.probability) || 0) / 100), 0);
  const selected = new Set();

  const tabs = h("div", { className: "tabs", role: "tablist" }, VIEWS.map((item) => h("a", {
    href: `#/opportunities?filter=${item.value}`, className: "button small ghost", role: "tab", "aria-selected": String(item.value === view), dataset: { view: item.value },
    text: `${item.label} ${filterOpportunities(ctx.model, { view: item.value, today, customerIds: mineIds }).length}`,
  })));
  const search = h("input", { type: "search", value: state.query, placeholder: "搜尋商機、產品或客戶", "aria-label": "搜尋商機" });
  search.addEventListener("change", () => { state.query = search.value; ctx.render(); });
  const layoutToggle = view === "open" ? h("div", { className: "button-row" }, [
    h("button", { type: "button", className: "small ghost", "aria-pressed": String(state.layout === "board"), text: "看板", onClick: () => { state.layout = "board"; ctx.render(); } }),
    h("button", { type: "button", className: "small ghost", "aria-pressed": String(state.layout === "list"), text: "清單", onClick: () => { state.layout = "list"; ctx.render(); } }),
  ]) : null;
  const mine = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.mineOnly, onChange: (event) => { state.mineOnly = event.target.checked; ctx.render(); } }), h("span", { text: "只看我的區域（含未分類）" })]);

  let body;
  if (!list.length) body = h("section", { className: "card" }, [emptyState(view === "overdue" ? "沒有逾期的商機" : "這裡目前是空的", view === "open" ? "可以從客戶頁或拜訪紀錄建立商機。" : "")]);
  else if (view === "open" && state.layout === "board") {
    body = h("div", { className: "board" }, OPEN_OPPORTUNITY_STAGES.map((stage) => {
      const items = list.filter((opportunity) => opportunity.stage === stage).sort((left, right) => Number(Boolean(opportunityAttention(right, today))) - Number(Boolean(opportunityAttention(left, today))) || String(left.expectedCloseDate || "9").localeCompare(String(right.expectedCloseDate || "9")));
      return h("section", { className: "board-col", dataset: { stageColumn: stage } }, [
        h("div", { className: "section-head" }, [h("h2", { text: stage }), badge(`${items.length}・${shortMoney(items.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0), 0))}`)]),
        ...items.slice(0, 60).map((opportunity) => opportunityCard(ctx, opportunity)),
        items.length > 60 ? h("p", { className: "muted", text: `另有 ${items.length - 60} 件，請用搜尋縮小範圍。` }) : null,
      ]);
    }));
  } else {
    const selectable = view === "overdue";
    body = h("div", { className: "stack" }, [
      selectable ? h("div", { className: "warning-banner", dataset: { batchBar: "" } }, [
        h("span", { text: "逾期商機不會被自動結案。勾選後可以一次延後結案日，或標記未成交。" }),
        h("div", { className: "button-row" }, [
          h("button", { type: "button", className: "small ghost", text: "全選", onClick: () => { list.forEach((opportunity) => selected.add(opportunity.id)); document.querySelectorAll("[data-select-opportunity]").forEach((node) => { node.checked = true; }); } }),
          h("button", { type: "button", className: "small primary", dataset: { batchPostpone: "" }, text: "延後結案日", onClick: () => selected.size ? openBatchDialog(ctx, [...selected], "postpone") : toast("請先勾選商機", { tone: "error" }) }),
          h("button", { type: "button", className: "small danger", dataset: { batchLost: "" }, text: "標記未成交", onClick: () => selected.size ? openBatchDialog(ctx, [...selected], "lost") : toast("請先勾選商機", { tone: "error" }) }),
        ]),
      ]) : null,
      h("div", { className: "result-list cards" }, list.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, 200).map((opportunity) => opportunityCard(ctx, opportunity, { selectable, selected }))),
    ]);
  }

  return h("div", { className: "stack" }, [
    pageHeader("商機", `${list.length} 件・總額 ${shortMoney(total)}・加權 ${shortMoney(weighted)}`, [layoutToggle, h("a", { className: "button primary", href: "#/opportunity/new", text: "＋ 新增商機" })].filter(Boolean)),
    tabs,
    h("div", { className: "button-row" }, [h("div", { className: "search-box", style: { flex: "1 1 240px" } }, [search]), mine]),
    body,
  ]);
}

registerPage("opportunities", { title: "商機", render: renderOpportunities });
