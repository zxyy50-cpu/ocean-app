import { formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { opportunityCategory, opportunityTitle } from "../../data/products.js";
import { LOST_REASONS, OPEN_OPPORTUNITY_STAGES } from "../../data/schema.js";
import { laterDate, tidyAction, tidyQueue, tidyReasons } from "../../data/tidy.js";
import { badge, emptyState, h, input, money, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

// 商機整理: one case per card, one tap per decision, then straight on to the next one.
const view = { mineOnly: true, skipped: new Set(), panel: "" };

export function resetTidyState() {
  Object.assign(view, { mineOnly: true, skipped: new Set(), panel: "" });
}

function noteLines(notes) {
  return String(notes || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function lastContact(ctx, opportunity) {
  const activities = (ctx.model.activitiesByCustomer?.get(opportunity.customerId) || []).filter((activity) => !activity.archivedAt);
  const latest = activities.map((activity) => activity.activityDate).filter(Boolean).sort().at(-1);
  return latest ? `上次聯絡 ${latest}` : "還沒有聯絡紀錄";
}

export function renderTidy(ctx) {
  const today = ctx.today();
  const areas = view.mineOnly ? ctx.settings.myAreas || [] : [];
  const { queue, done, total } = tidyQueue(ctx.model, ctx.model.all, { today, areas });
  const waiting = queue.filter((opportunity) => !view.skipped.has(opportunity.id));
  const opportunity = waiting[0] || null;

  const mine = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: view.mineOnly, dataset: { tidyMineOnly: "" }, onChange: (event) => { view.mineOnly = event.target.checked; ctx.render(); } }), h("span", { text: "只看我的區域" })]);
  const percent = total ? Math.round((done / total) * 100) : 100;
  const head = pageHeader("商機整理", "", [mine], {
    figure: `已整理 ${done} / ${total}`,
    note: `還剩 ${queue.length} 件${view.skipped.size ? `（跳過 ${view.skipped.size} 件）` : ""}`,
    progress: percent,
    help: "一件一張：還要追就延後結案日，結束的就標成交或沒成，不是商機的封存。每一步都可以復原。",
  });
  head.dataset.tidyProgress = "";

  if (!opportunity) {
    return h("div", { className: "stack tidy" }, [head, h("section", { className: "card" }, [emptyState(
      queue.length ? "跳過的都在後面了" : "都整理好了 🎉",
      queue.length ? `還有 ${queue.length} 件剛才跳過，要再看一次嗎？` : "沒有逾期、沒填結案日或匯入後沒整理的商機了。",
      queue.length ? h("button", { type: "button", className: "primary", dataset: { tidyRestart: "" }, text: "再看跳過的", onClick: () => { view.skipped.clear(); ctx.render(); } }) : h("a", { className: "button primary", href: "#/cases", text: "回到案子" }),
    )])]);
  }

  const customer = ctx.model.customersById.get(opportunity.customerId);
  const lines = noteLines(opportunity.notes);
  const stagePick = { value: opportunity.stage };
  const amountInput = input("amount", opportunity.amount ?? "", { type: "number", min: 0, inputmode: "numeric", placeholder: "未填", "aria-label": "預估金額（未稅）", dataset: { tidyAmount: "" } });
  const error = h("p", { className: "field-error", role: "alert", hidden: true, dataset: { tidyError: "" } });
  const noteBox = h("textarea", { rows: 2, placeholder: "（選填）一句話記下現況，例如：客戶說明年 3 月再談", dataset: { tidyNote: "" } });

  const act = async (action, options = {}) => {
    error.hidden = true;
    const result = await tidyAction(ctx.db, ctx.model, opportunity, action, { today, requestId: requestId(`tidy-${action}`), stage: stagePick.value, amount: amountInput.value, note: noteBox.value, ...options });
    if (!result.ok) {
      error.hidden = false;
      error.textContent = Object.values(result.errors || {}).join("、") || result.message || "沒有存成功，請再試一次";
      return;
    }
    view.panel = "";
    toast(result.message, { timeout: 8000, action: h("button", { type: "button", className: "small", dataset: { tidyUndo: "" }, text: "復原", onClick: async () => { await result.undo(); toast("已復原"); ctx.render(); } }) });
    ctx.render();
  };

  const stageChips = h("div", { className: "button-row", role: "radiogroup", "aria-label": "階段", dataset: { tidyStages: "" } }, OPEN_OPPORTUNITY_STAGES.map((stage) => h("button", {
    type: "button", className: `small ${stage === stagePick.value ? "primary" : "ghost"}`, role: "radio", "aria-checked": String(stage === stagePick.value), dataset: { tidyStage: stage }, text: stage,
    onClick: (event) => { stagePick.value = stage; event.currentTarget.parentElement.querySelectorAll("button").forEach((node) => { const on = node.dataset.tidyStage === stage; node.className = `small ${on ? "primary" : "ghost"}`; node.setAttribute("aria-checked", String(on)); }); },
  })));

  const panels = {
    postpone: () => h("div", { className: "tidy-panel", dataset: { tidyPanel: "postpone" } }, [
      h("strong", { text: "預計什麼時候結案？" }),
      h("div", { className: "button-row" }, [
        ...[[1, "1 個月後"], [3, "3 個月後"], [6, "半年後"]].map(([months, label]) => h("button", { type: "button", className: "primary", dataset: { tidyLater: months }, text: `${label}（${formatShortDate(laterDate(today, months))}）`, onClick: () => act("postpone", { months }) })),
      ]),
      h("div", { className: "button-row" }, [
        input("date", "", { type: "date", min: today, "aria-label": "自己選日期", dataset: { tidyDate: "" } }),
        h("button", { type: "button", className: "ghost", text: "用這天", onClick: (event) => act("postpone", { date: event.currentTarget.parentElement.querySelector("input").value }) }),
      ]),
    ]),
    won: () => h("div", { className: "tidy-panel", dataset: { tidyPanel: "won" } }, [
      h("strong", { text: "成交金額（未稅）對嗎？" }),
      h("div", { className: "button-row" }, [
        input("wonAmount", opportunity.amount ?? amountInput.value ?? "", { type: "number", min: 0, inputmode: "numeric", "aria-label": "成交金額", dataset: { tidyWonAmount: "" } }),
        h("button", { type: "button", className: "primary", dataset: { tidyWonConfirm: "" }, text: "確認成交", onClick: (event) => act("won", { amount: event.currentTarget.parentElement.querySelector("input").value }) }),
      ]),
    ]),
    lost: () => h("div", { className: "tidy-panel", dataset: { tidyPanel: "lost" } }, [
      h("strong", { text: "為什麼沒成？點一個就完成" }),
      h("div", { className: "button-row" }, LOST_REASONS.map((reason) => h("button", { type: "button", className: "ghost", dataset: { tidyLostReason: reason }, text: reason, onClick: () => act("lost", { reason }) }))),
    ]),
  };

  const card = h("article", { className: "card stack tidy-card", dataset: { tidyCard: opportunity.id } }, [
    h("div", { className: "section-head" }, [
      h("div", {}, [
        customer ? h("a", { className: "eyebrow", href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name }) : h("span", { className: "eyebrow", text: "（未知客戶）" }),
        h("h2", { text: opportunityTitle(opportunity, 40) }),
        h("small", { className: "muted", text: [opportunityCategory(opportunity), lastContact(ctx, opportunity)].filter(Boolean).join("・") }),
      ]),
      h("a", { className: "small", href: `#/case/${encodeURIComponent(opportunity.id)}`, text: "開案子 →" }),
    ]),
    h("div", { className: "tags" }, tidyReasons(opportunity, today).map((reason) => badge(reason, "warn"))),
    lines.length ? h("div", { className: "tidy-notes" }, [
      ...lines.slice(0, 3).map((line) => h("p", { text: line })),
      lines.length > 3 ? h("details", {}, [h("summary", { text: `其餘 ${lines.length - 3} 行備註` }), ...lines.slice(3).map((line) => h("p", { text: line }))]) : null,
    ]) : h("p", { className: "muted", text: "沒有備註。" }),
    h("div", { className: "tidy-facts" }, [
      h("div", {}, [h("small", { className: "muted", text: "階段" }), stageChips]),
      h("label", {}, [h("small", { className: "muted", text: "預估金額（未稅）" }), amountInput]),
      h("div", {}, [h("small", { className: "muted", text: "預計結案" }), h("strong", { className: opportunity.expectedCloseDate && opportunity.expectedCloseDate < today ? "kpi-warn" : "", text: opportunity.expectedCloseDate || "未填" }), opportunity.amount ? h("small", { className: "muted", text: money(opportunity.amount) }) : null]),
    ]),
    h("details", {}, [h("summary", { text: "想多寫一點" }), noteBox]),
    h("div", { className: "tidy-actions" }, [
      h("button", { type: "button", className: view.panel === "postpone" ? "primary" : "ghost", dataset: { tidyAction: "postpone" }, text: "⟳ 繼續追", onClick: () => { view.panel = view.panel === "postpone" ? "" : "postpone"; drawPanel(); } }),
      h("button", { type: "button", className: view.panel === "won" ? "primary" : "ghost", dataset: { tidyAction: "won" }, text: "✓ 成交", onClick: () => { view.panel = view.panel === "won" ? "" : "won"; drawPanel(); } }),
      h("button", { type: "button", className: view.panel === "lost" ? "primary" : "ghost", dataset: { tidyAction: "lost" }, text: "✕ 沒成", onClick: () => { view.panel = view.panel === "lost" ? "" : "lost"; drawPanel(); } }),
      h("button", { type: "button", className: "ghost", dataset: { tidyAction: "archive" }, text: "不是商機（封存）", onClick: () => act("archive") }),
      h("button", { type: "button", className: "ghost", dataset: { tidyAction: "skip" }, text: "先跳過", onClick: () => { view.skipped.add(opportunity.id); view.panel = ""; ctx.render(); } }),
    ]),
    error,
  ]);
  const panelSlot = h("div", { dataset: { tidyPanelSlot: "" } });
  function drawPanel() {
    panelSlot.replaceChildren(view.panel && panels[view.panel] ? panels[view.panel]() : "");
    card.querySelectorAll("[data-tidy-action]").forEach((node) => { if (["postpone", "won", "lost"].includes(node.dataset.tidyAction)) node.className = node.dataset.tidyAction === view.panel ? "primary" : "ghost"; });
  }
  card.append(panelSlot);
  drawPanel();

  const next = waiting.slice(1, 4);
  return h("div", { className: "stack tidy" }, [
    head,
    card,
    next.length ? h("section", { className: "card", dataset: { tidyNext: "" } }, [
      h("h2", { text: "接下來" }),
      h("ul", { className: "result-rows" }, next.map((item) => h("li", {}, [h("span", {}, [h("strong", { text: `${ctx.model.customerName(item.customerId)}・${opportunityTitle(item, 24)}` }), h("small", { className: "muted", text: ` ${item.stage}・${item.amount ? money(item.amount) : "金額未填"}` })])]))),
    ]) : null,
  ]);
}

registerPage("tidy", { title: "商機整理", render: renderTidy, keepOnDataChange: true });
