import { requestId } from "../../core/ids.js";
import { HOLD_PERIODS, HOLD_REASONS, holdCustomers, restoreHolds } from "../../data/devplan.js";
import { field, h, input, openDialog, toast } from "../dom.js";

// 「不開發」 for one or many customers: a reason (pick or type) and when to look again.
// The toast offers an exact undo; later it can be lifted from the customer page.
export function openHoldDialog(ctx, customers, { onDone } = {}) {
  const openCases = customers.filter((customer) => (ctx.model.opportunitiesByCustomer.get(customer.id) || []).some((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage)));
  return openDialog((close) => {
    let reason = HOLD_REASONS[0];
    let months = 0;
    const other = input("reason", "", { placeholder: "或自己寫原因，例如：只做代工、沒有實驗室", dataset: { holdOther: "" } });
    const reasonChips = h("div", { className: "chip-group", role: "radiogroup" }, HOLD_REASONS.map((value, index) => h("label", { className: "chip" }, [
      h("input", { type: "radio", name: "holdReason", value, checked: index === 0, dataset: { holdReason: value }, onChange: () => { reason = value; other.value = ""; } }),
      h("span", { text: value }),
    ])));
    other.addEventListener("input", () => { if (other.value.trim()) reasonChips.querySelectorAll("input").forEach((node) => { node.checked = false; }); });
    const periodChips = h("div", { className: "chip-group", role: "radiogroup" }, HOLD_PERIODS.map((period) => h("label", { className: "chip" }, [
      h("input", { type: "radio", name: "holdPeriod", value: period.value, checked: period.value === 0, dataset: { holdPeriod: period.value }, onChange: () => { months = period.value; } }),
      h("span", { text: period.label }),
    ])));
    const form = h("form", { className: "sheet-body", dataset: { form: "hold" } }, [
      h("h2", { text: customers.length === 1 ? `「${customers[0].name}」不開發` : `${customers.length} 家標為不開發` }),
      h("p", { className: "muted", text: "標記後不會出現在開發計畫，也不算進達成率；資料都保留，隨時可以取消。" }),
      openCases.length ? h("p", { className: "field-error", text: `其中 ${openCases.length} 家還有進行中的案子，案子不會被關掉。` }) : null,
      field("原因", h("div", { className: "stack" }, [reasonChips, other])),
      field("之後", periodChips),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", dataset: { holdConfirm: "" }, text: "標為不開發" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await holdCustomers(ctx.db, customers, { reason: other.value.trim() || reason, months, today: ctx.today() }, requestId("hold"));
      close();
      if (!result.ok) { toast("沒有存到，請再試一次", { tone: "error" }); return; }
      const undo = h("button", { type: "button", className: "small ghost", dataset: { holdUndo: "" }, text: "復原", onClick: async () => {
        undo.disabled = true;
        await restoreHolds(ctx.db, result.previous, requestId("hold-undo"));
        toast("已復原");
        onDone?.();
      } });
      toast(`已標為不開發 ${customers.length} 家${result.until ? `，${result.until} 再看` : ""}`, { action: undo, timeout: 10000 });
      onDone?.();
    });
    return form;
  }, { label: "標為不開發" });
}
