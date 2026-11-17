import { addWorkdays, daysBetween } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { buildActions } from "../../data/actions.js";
import { customerIdentity } from "../../data/model.js";
import { postponeOpportunities } from "../../data/opportunities.js";
import { opportunityTitle } from "../../data/products.js";
import { completeReminder, snoozeReminder } from "../../data/reminders.js";
import { badge, emptyState, h, money, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { openBatchDialog } from "../pages/opportunities.js";
import { pageHeader } from "../shell.js";

// Opportunities this late are usually no longer moving; one tap ticks them for 未成交 or a new date.
const STALE_DAYS = 90;

// One place to clear the backlog: the 「先清逾期」 count on 今天 is reminders plus
// opportunities, so both are ticked and finished or moved together here.
export function renderTriage(ctx) {
  const today = ctx.today();
  const { overdue } = buildActions(ctx.model, { today, myAreas: ctx.settings.myAreas });
  const reminders = [...overdue.allReminders].sort((left, right) => String(right.dueDate).localeCompare(String(left.dueDate)));
  const opportunities = overdue.allOpportunities;

  // A checkbox list with 全選 and a count, shared by both sections.
  function pickList(kind, items, row) {
    const selected = new Set();
    const count = h("span", { className: "muted", dataset: { triageCount: kind }, text: "還沒勾選" });
    const refresh = () => { count.textContent = selected.size ? `已勾選 ${selected.size} 件` : "還沒勾選"; };
    const boxes = new Map();
    const pick = (id, on) => { if (on) selected.add(id); else selected.delete(id); boxes.get(id).checked = on; refresh(); };
    const list = h("ul", { className: "task-list" }, items.map((item) => {
      const box = h("input", { type: "checkbox", dataset: { pick: item.id }, onChange: (event) => pick(item.id, event.target.checked) });
      boxes.set(item.id, box);
      return h("li", { className: "task-row pickable", dataset: { [kind === "reminder" ? "triageReminder" : "triageOpportunity"]: item.id } }, [h("label", { className: "pick-box", "aria-label": "勾選" }, [box]), ...row(item)]);
    }));
    const pickAll = h("button", { type: "button", className: "small ghost", dataset: { pickAll: kind }, text: "全選", onClick: () => items.forEach((item) => pick(item.id, true)) });
    return { selected, count, list, pickAll, pick };
  }

  const apply = async (selected, label, work) => {
    if (!selected.size) { toast("先勾選要處理的項目", { tone: "error" }); return; }
    let failed = 0;
    for (const id of selected) { const result = await work(id); if (result?.ok === false) failed += 1; }
    toast(failed ? `${label}，其中 ${failed} 件沒有成功` : `${label} ${selected.size} 件`, { tone: failed ? "error" : "ok" });
    ctx.render();
  };

  const reminderPicks = pickList("reminder", reminders, (reminder) => {
    const customer = ctx.model.customersById.get(reminder.customerId);
    return [
      h("a", { className: "task-main", href: `#/customer/${encodeURIComponent(reminder.customerId)}` }, [
        h("strong", { text: `${customer?.name || "（未知客戶）"}・${reminder.title}` }),
        h("small", { className: "muted", text: customerIdentity(ctx.model, customer) }),
      ]),
      badge(`晚了 ${daysBetween(reminder.dueDate, today)} 天`, "warn"),
    ];
  });

  const opportunityPicks = pickList("opportunity", opportunities, (opportunity) => {
    const customer = ctx.model.customersById.get(opportunity.customerId);
    return [
      h("a", { className: "task-main", href: `#/case/${encodeURIComponent(opportunity.id)}` }, [
        h("strong", { text: `${customer?.name || "（未知客戶）"}・${opportunityTitle(opportunity, 30)}` }),
        h("small", { className: "muted", text: [opportunity.stage, opportunity.amount ? money(opportunity.amount) : "", opportunity.expectedCloseDate ? `預計 ${opportunity.expectedCloseDate}` : ""].filter(Boolean).join("・") }),
      ]),
      badge(opportunity.attention?.label || "已逾期", (opportunity.attention?.days || 0) > STALE_DAYS ? "danger" : "warn"),
    ];
  });
  const stale = opportunities.filter((opportunity) => (opportunity.attention?.days || 0) > STALE_DAYS);
  // 30 days on, moved off a weekend: the same date the 延到指定日期 dialog starts with.
  const postponeMonth = async () => {
    const ids = [...opportunityPicks.selected];
    if (!ids.length) { toast("先勾選要處理的商機", { tone: "error" }); return; }
    const result = await postponeOpportunities(ctx.db, ids, addWorkdays(today, 30), requestId("triage-month"));
    toast(result.ok ? `已延一個月 ${ids.length} 件` : "延後失敗，沒有任何商機被修改", { tone: result.ok ? "ok" : "error" });
    ctx.render();
  };
  const batch = (mode) => (opportunityPicks.selected.size
    ? openBatchDialog(ctx, [...opportunityPicks.selected], mode, { onDone: () => ctx.render() })
    : toast("先勾選要處理的商機", { tone: "error" }));

  return h("div", { className: "stack" }, [
    pageHeader("一次整理逾期", "勾選後一起處理；提醒改天會排到下一個工作日，商機可以延後或結案。"),
    h("section", { className: "card" }, [
      h("div", { className: "section-head" }, [h("h2", { text: `逾期提醒（${reminders.length}）` }), reminderPicks.count]),
      reminders.length ? h("div", { className: "button-row" }, [
        reminderPicks.pickAll,
        h("button", { type: "button", className: "small primary", dataset: { batchDone: "" }, text: "標記完成", onClick: () => apply(reminderPicks.selected, "已完成", (id) => completeReminder(ctx.db, id, requestId("triage-done"))) }),
        h("button", { type: "button", className: "small ghost", dataset: { batchLater: "" }, text: "改到下個工作日", onClick: () => apply(reminderPicks.selected, "已延後", (id) => snoozeReminder(ctx.db, id, 1, requestId("triage-later"), today)) }),
        h("button", { type: "button", className: "small ghost", dataset: { batchWeek: "" }, text: "延一週", onClick: () => apply(reminderPicks.selected, "已延一週", (id) => snoozeReminder(ctx.db, id, 7, requestId("triage-week"), today)) }),
      ]) : null,
      reminders.length ? reminderPicks.list : emptyState("沒有逾期的提醒", ""),
    ]),
    h("section", { className: "card", dataset: { triageOpportunities: "" } }, [
      h("div", { className: "section-head" }, [h("h2", { text: `逾期商機（${opportunities.length}）` }), opportunityPicks.count]),
      stale.length ? h("p", { className: "muted", text: `其中 ${stale.length} 件晚了超過 ${STALE_DAYS} 天，多半已經沒在進行：勾起來標記未成交，或延到真正會談的日子。` }) : null,
      opportunities.length ? h("div", { className: "button-row" }, [
        opportunityPicks.pickAll,
        stale.length ? h("button", { type: "button", className: "small ghost", dataset: { pickStale: "" }, text: `勾選晚超過 ${STALE_DAYS} 天的`, onClick: () => stale.forEach((opportunity) => opportunityPicks.pick(opportunity.id, true)) }) : null,
        h("button", { type: "button", className: "small primary", dataset: { batchMonth: "" }, text: "延一個月", onClick: postponeMonth }),
        h("button", { type: "button", className: "small ghost", dataset: { batchPostpone: "" }, text: "延到指定日期…", onClick: () => batch("postpone") }),
        h("button", { type: "button", className: "small danger", dataset: { batchLost: "" }, text: "標記未成交…", onClick: () => batch("lost") }),
      ]) : null,
      opportunities.length ? opportunityPicks.list : emptyState("沒有逾期的商機", ""),
    ]),
  ]);
}

registerPage("triage", { title: "一次整理", render: renderTriage, keepOnDataChange: true });
