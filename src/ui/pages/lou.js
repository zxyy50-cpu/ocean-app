import { requestId } from "../../core/ids.js";
import { primaryContact } from "../../data/model.js";
import { buildLou, mailtoHref } from "../../data/lou.js";
import { completeReminder } from "../../data/reminders.js";
import { emptyState, field, h, input, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h("textarea", { value: text, style: { position: "fixed", opacity: "0" } });
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function renderLou(ctx, route) {
  const activity = (ctx.model.all.activity || []).find((item) => item.id === route.id);
  if (!activity) return emptyState("找不到這次拜訪", "", h("a", { className: "button", href: "#/today", text: "回到今日" }));
  const customer = ctx.model.customersById.get(activity.customerId);
  const contact = (ctx.model.contactsByCustomer.get(activity.customerId) || []).find((item) => item.id === activity.contactId) || primaryContact(ctx.model, activity.customerId);
  const opportunity = activity.opportunityId ? ctx.model.opportunitiesById.get(activity.opportunityId) : null;
  const actions = opportunity ? (ctx.model.remindersByOpportunity.get(opportunity.id) || []) : (ctx.model.remindersByCustomer.get(activity.customerId) || []).filter((item) => item.activityId === activity.id && item.kind !== "會後信");
  const draft = buildLou({ activity, customer, contact, opportunity, actions });
  const pendingLetters = (ctx.model.remindersByCustomer.get(activity.customerId) || []).filter((item) => item.kind === "會後信" && item.status !== "完成" && item.activityId === activity.id);

  const to = input("to", draft.to, { type: "email", placeholder: "收件人 Email" });
  const subject = input("subject", draft.subject);
  const body = h("textarea", { name: "body", rows: 22, value: draft.body, dataset: { louBody: "" } });
  const mail = h("a", { className: "button primary", href: mailtoHref(draft), dataset: { louMail: "" }, text: "用郵件開啟" });
  const refresh = () => { mail.href = mailtoHref({ to: to.value, subject: subject.value, body: body.value }); };
  [to, subject, body].forEach((node) => node.addEventListener("input", refresh));

  return h("div", { className: "stack" }, [
    pageHeader("會後信（LOU）", `${customer?.name || ""}・${activity.activityDate || ""}`, [h("a", { className: "button ghost", href: `#/customer/${encodeURIComponent(activity.customerId)}`, text: "回客戶頁" })]),
    h("div", { className: "info-banner", text: "會後 24 小時內寄出最有效：挑戰用客戶的話寫、方案用效益寫、時程用日期寫，窗口就能直接拿去向上報告。" }),
    draft.missing.length ? h("div", { className: "warning-banner", dataset: { louMissing: "" }, text: `拜訪紀錄裡還缺：${draft.missing.join("、")}。可以在下面直接補寫，或下次拜訪用 SPIN 提示問清楚。` }) : null,
    h("section", { className: "card form-card" }, [
      field("收件人", to), field("主旨", subject), field("內容（可直接修改）", body),
      h("div", { className: "button-row" }, [
        h("button", { type: "button", className: "ghost", dataset: { louCopy: "" }, text: "複製全文", onClick: async () => {
          const ok = await copyText(`${subject.value}\n\n${body.value}`);
          toast(ok ? "已複製，可以貼到 Outlook 或 LINE" : "無法自動複製，請手動選取文字", { tone: ok ? "ok" : "error" });
        } }),
        mail,
        pendingLetters.length ? h("button", { type: "button", className: "ghost", dataset: { louDone: "" }, text: "已寄出，完成提醒", onClick: async () => {
          for (const reminder of pendingLetters) await completeReminder(ctx.db, reminder.id, requestId("lou-done"), { activityId: activity.id });
          toast("已標記會後信完成");
        } }) : null,
      ]),
    ]),
  ]);
}

registerPage("lou", { title: "會後信", render: renderLou, keepOnDataChange: true });
