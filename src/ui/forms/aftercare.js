import { requestId } from "../../core/ids.js";
import { CARE_CADENCE, closeoutProgress, DELIVERY_ITEMS, saveCloseout, SIGN_ITEMS, startCare } from "../../data/aftercare.js";
import { completeReminder } from "../../data/reminders.js";
import { badge, formToObject, h, toast } from "../dom.js";

function checklist(group, title, items, values = {}) {
  return h("fieldset", { className: "stack", dataset: { checklist: group } }, [
    h("legend", { text: title }),
    ...items.map((item) => h("label", { className: "chip", style: { justifyContent: "flex-start" } }, [
      h("input", { type: "checkbox", name: `${group}.${item.key}`, value: "yes", checked: Boolean(values[item.key]) }),
      h("span", { text: `${item.label}：${item.hint}` }),
    ])),
  ]);
}

export function aftercareSection(ctx, opportunity) {
  const closeout = opportunity.closeout || {};
  const progress = closeoutProgress(closeout);
  const form = h("form", { className: "card form-card", dataset: { form: "closeout" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "簽約與交付檢核" }), badge(`${progress.done} / ${progress.total}`, progress.done === progress.total ? "ok" : "neutral")]),
    h("p", { className: "muted", text: "簽約不是終點：交付品質與感謝函，決定客戶願不願意擴案與轉介紹。" }),
    checklist("sign", "簽約／合約", SIGN_ITEMS, closeout.sign),
    checklist("delivery", "出貨／交付", DELIVERY_ITEMS, closeout.delivery),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: "儲存檢核" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveCloseout(ctx.db, opportunity.id, formToObject(form), requestId("closeout"));
    form.removeAttribute("data-dirty");
    toast(result.ok ? "已儲存檢核" : "儲存失敗", { tone: result.ok ? "ok" : "error" });
  });

  const care = (ctx.model.remindersByOpportunity.get(opportunity.id) || []).filter((reminder) => reminder.kind === "經營");
  const open = care.filter((reminder) => reminder.status !== "完成").sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));
  const careCard = h("section", { className: "card", dataset: { careCard: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "長期經營節奏" }), care.length ? badge(`完成 ${care.length - open.length} 次`) : null]),
    h("p", { className: "muted", text: "節奏固定，關係才會複利：把一張單變成一條長期營收。完成一次後，系統會自動排下一次。" }),
    care.length ? h("ul", { className: "task-list" }, open.map((reminder) => h("li", { className: `task-row${reminder.dueDate < ctx.today() ? " warn" : ""}`, dataset: { care: reminder.id } }, [
      h("div", { className: "task-main" }, [h("strong", { text: reminder.title }), h("span", { text: reminder.repeatDays ? `每 ${reminder.repeatDays} 天一次` : "一次性" })]),
      h("span", { className: "due", text: reminder.dueDate }),
      h("div", { className: "row-actions" }, [
        h("a", { className: "button small primary", href: `#/visit?customer=${encodeURIComponent(opportunity.customerId)}&reminder=${encodeURIComponent(reminder.id)}`, text: "記錄拜訪" }),
        h("button", { type: "button", className: "small ghost", dataset: { completeCare: reminder.id }, text: "完成", onClick: async () => { await completeReminder(ctx.db, reminder.id, requestId("care-done")); toast(reminder.repeatDays ? "已完成，下一次已排好" : "已完成"); } }),
      ]),
    ]))) : h("div", { className: "stack" }, [
      h("ul", {}, CARE_CADENCE.map((step) => h("li", { text: `${step.title}（${step.repeatDays ? `每 ${step.repeatDays} 天` : "成交隔天"}）` }))),
      h("button", { type: "button", className: "primary", dataset: { startCare: "" }, text: "啟動長期經營節奏", onClick: async () => {
        const result = await startCare(ctx.db, opportunity.id, ctx.today(), requestId("start-care"));
        toast(result.ok ? `已排好 ${result.value.created} 個經營提醒` : "啟動失敗", { tone: result.ok ? "ok" : "error" });
      } }),
    ]),
  ]);
  return h("div", { className: "stack", dataset: { aftercareSection: "" } }, [form, careCard]);
}
