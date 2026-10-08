import { daysBetween } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { buildActions } from "../../data/actions.js";
import { customerIdentity } from "../../data/model.js";
import { completeReminder, snoozeReminder } from "../../data/reminders.js";
import { badge, emptyState, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

// One place to clear the backlog: tick several overdue reminders and finish or move
// them together. Overdue opportunities use the existing batch tools on the list page.
export function renderTriage(ctx) {
  const today = ctx.today();
  const { overdue } = buildActions(ctx.model, { today, myAreas: ctx.settings.myAreas });
  const reminders = [...overdue.allReminders].sort((left, right) => String(right.dueDate).localeCompare(String(left.dueDate)));
  const selected = new Set();
  const count = h("span", { className: "muted", dataset: { triageCount: "" }, text: "還沒勾選" });
  const refresh = () => { count.textContent = selected.size ? `已勾選 ${selected.size} 件` : "還沒勾選"; };

  const apply = async (label, work) => {
    if (!selected.size) { toast("先勾選要處理的提醒", { tone: "error" }); return; }
    let failed = 0;
    for (const id of selected) { const result = await work(id); if (result?.ok === false) failed += 1; }
    toast(failed ? `${label}，其中 ${failed} 件沒有成功` : `${label} ${selected.size} 件`, { tone: failed ? "error" : "ok" });
    ctx.render();
  };

  const list = reminders.length ? h("ul", { className: "task-list" }, reminders.map((reminder) => {
    const customer = ctx.model.customersById.get(reminder.customerId);
    return h("li", { className: "task-row", dataset: { triageReminder: reminder.id } }, [
      h("label", { className: "chip" }, [h("input", { type: "checkbox", dataset: { pick: reminder.id }, onChange: (event) => { if (event.target.checked) selected.add(reminder.id); else selected.delete(reminder.id); refresh(); } })]),
      h("a", { className: "task-main", href: `#/customer/${encodeURIComponent(reminder.customerId)}` }, [
        h("strong", { text: `${customer?.name || "（未知客戶）"}・${reminder.title}` }),
        h("small", { className: "muted", text: customerIdentity(ctx.model, customer) }),
      ]),
      badge(`晚了 ${daysBetween(reminder.dueDate, today)} 天`, "warn"),
    ]);
  })) : emptyState("沒有逾期的提醒", "");

  return h("div", { className: "stack" }, [
    pageHeader("一次整理逾期", "勾選後一起處理；改天會排到下一個工作日。"),
    h("section", { className: "card" }, [
      h("div", { className: "section-head" }, [h("h2", { text: `逾期提醒（${reminders.length}）` }), count]),
      reminders.length ? h("div", { className: "button-row" }, [
        h("button", { type: "button", className: "small ghost", dataset: { pickAll: "" }, text: "全選", onClick: () => { reminders.forEach((reminder) => selected.add(reminder.id)); document.querySelectorAll("[data-pick]").forEach((node) => { node.checked = true; }); refresh(); } }),
        h("button", { type: "button", className: "small primary", dataset: { batchDone: "" }, text: "標記完成", onClick: () => apply("已完成", (id) => completeReminder(ctx.db, id, requestId("triage-done"))) }),
        h("button", { type: "button", className: "small ghost", dataset: { batchLater: "" }, text: "改到下個工作日", onClick: () => apply("已延後", (id) => snoozeReminder(ctx.db, id, 1, requestId("triage-later"), today)) }),
        h("button", { type: "button", className: "small ghost", dataset: { batchWeek: "" }, text: "延一週", onClick: () => apply("已延一週", (id) => snoozeReminder(ctx.db, id, 7, requestId("triage-week"), today)) }),
      ]) : null,
      list,
    ]),
    overdue.allOpportunities.length ? h("a", { className: "summary-line warn", href: "#/opportunities?filter=overdue", dataset: { overdueOpportunities: "" } }, [h("span", { text: `另有 ${overdue.allOpportunities.length} 件商機的預計結案日已過` }), h("span", { text: "到商機清單批次整理 →" })]) : null,
  ]);
}

registerPage("triage", { title: "一次整理", render: renderTriage, keepOnDataChange: true });
