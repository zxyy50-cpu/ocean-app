import { formatShortDate, weekdayLabel } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { buildActions } from "../../data/actions.js";
import { customerIdentity } from "../../data/model.js";
import { completeReminder, snoozeReminder } from "../../data/reminders.js";
import { badge, emptyState, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { splitPhones } from "../pages/customer.js";

function dialLink(contact, customer) {
  const number = [contact?.mobile, contact?.phone, customer?.phone].flatMap(splitPhones)[0];
  return number ? h("a", { className: "button small primary", href: `tel:${number.replace(/[^\d+#]/g, "")}`, dataset: { dial: "" } }, ["☎ 撥號"]) : null;
}

function captureHref(item) {
  const params = new URLSearchParams({ customer: item.customerId });
  if (item.kind === "reminder") params.set("reminder", item.id);
  if (item.opportunityId) params.set("opportunity", item.opportunityId);
  return `#/capture?${params}`;
}

async function run(promise, message) {
  const result = await promise;
  toast(result?.ok === false ? "沒有成功，請再試一次" : message, { tone: result?.ok === false ? "error" : "ok" });
}

function actionCard(ctx, item, { visit = false } = {}) {
  const customer = ctx.model.customersById.get(item.customerId);
  return h("article", { className: `action-card${item.late ? " is-late" : ""}`, dataset: { action: item.key } }, [
    h("a", { className: "action-main", href: `#/customer/${encodeURIComponent(item.customerId)}` }, [
      h("strong", { text: item.title }),
      item.why ? h("span", { text: item.why }) : null,
      item.last ? h("small", { className: "muted", text: `上次 ${item.last}` }) : h("small", { className: "muted", text: "還沒有聯絡紀錄" }),
      customer && ctx.model.sameNameCount(customer) ? h("small", { className: "muted", dataset: { identity: customer.id }, text: `同名之一：${customerIdentity(ctx.model, customer)}` }) : null,
    ]),
    item.late ? badge(`晚了 ${item.late} 天`, "warn") : null,
    h("div", { className: "action-buttons" }, [
      visit ? h("a", { className: "button small primary", href: `#/prep/${encodeURIComponent(item.customerId)}${item.opportunityId ? `?opportunity=${encodeURIComponent(item.opportunityId)}` : ""}`, text: "拜訪前準備" }) : dialLink(item.contact, customer),
      h("a", { className: "button small ghost", href: captureHref(item), dataset: { record: item.key }, text: "記錄" }),
      item.kind === "opportunity" ? h("a", { className: "button small ghost", href: `#/case/${encodeURIComponent(item.id)}`, text: "更新案子" }) : null,
      item.kind === "reminder" ? h("button", { type: "button", className: "small ghost", dataset: { done: item.id }, text: "完成", onClick: () => run(completeReminder(ctx.db, item.id, requestId("done")), "已完成") }) : null,
      item.kind === "reminder" ? h("button", { type: "button", className: "small ghost", dataset: { later: item.id }, text: "改天", onClick: () => run(snoozeReminder(ctx.db, item.id, 1, requestId("later"), ctx.today()), "已延到下個工作日") }) : null,
    ]),
  ]);
}

function summary(data) {
  const dueToday = data.now.filter((item) => !item.late).length + data.schedule.length;
  const late = data.now.filter((item) => item.late).length + data.overdue.count;
  if (!dueToday && !late) return "沒有急事，適合開發新客戶";
  if (!dueToday) return `今天沒有到期的，先清逾期（共 ${late} 件）`;
  return `今天 ${dueToday} 件${late ? `，另有逾期 ${late} 件` : ""}`;
}

export function renderHome(ctx) {
  const today = ctx.today();
  const data = buildActions(ctx.model, { today, myAreas: ctx.settings.myAreas });
  const hasCustomers = ctx.model.customers.length > 0;
  const { done, total } = data.progress;

  const head = h("section", { className: "home-head" }, [
    h("div", {}, [h("h1", { text: `今天 ${formatShortDate(today)} 週${weekdayLabel(today)}` }), h("p", { className: "muted", dataset: { homeSummary: "" }, text: summary(data) })]),
    h("div", { className: "home-progress", "aria-label": `今日完成 ${done} / ${total}` }, [h("strong", { text: `${done} / ${total}` }), h("small", { text: "完成" })]),
  ]);
  const captureEntry = h("a", { className: "capture-entry", href: "#/capture", dataset: { captureEntry: "" } }, [h("span", { "aria-hidden": "true", text: "🎙" }), h("span", { text: "說說剛剛的拜訪…" })]);

  const blocks = [];
  if (data.now.length) blocks.push(h("section", { className: "home-block", dataset: { homeSection: "now" } }, [h("h2", { text: "現在該做" }), ...data.now.map((item) => actionCard(ctx, item))]));
  if (data.schedule.length) blocks.push(h("section", { className: "home-block", dataset: { homeSection: "schedule" } }, [h("h2", { text: "今天要拜訪" }), ...data.schedule.map((item) => actionCard(ctx, item, { visit: true }))]));
  if (data.signals.length) {
    blocks.push(h("section", { className: "home-block", dataset: { homeSection: "signals" } }, [
      h("h2", { text: "新機會" }),
      ...data.signals.map((item) => {
        const order = ctx.model.ordersById.get(item.orderId);
        return h("a", { className: "action-card compact", href: "#/orders?view=signals" }, [h("div", { className: "action-main" }, [
          h("strong", { text: order ? ctx.model.customerName(order.customerId) : item.customerNo || "新客戶" }),
          h("span", { text: `第一次買 ${item.productName || item.productCode}` }),
        ])]);
      }),
      data.signalCount > data.signals.length ? h("a", { className: "more-link", href: "#/orders?view=signals", text: `還有 ${data.signalCount - data.signals.length} 個新購提醒 →` }) : null,
    ]));
  }
  const lines = [
    data.overdue.count ? h("a", { className: "summary-line warn", href: "#/triage", dataset: { overdueLine: "" } }, [h("span", { text: `逾期 ${data.overdue.count} 件` }), h("span", { text: "一次整理 →" })]) : null,
    data.redCases ? h("a", { className: "summary-line", href: "#/cases", dataset: { redCaseLine: "" } }, [h("span", { text: `${data.redCases} 個提案／議價的案子有紅燈` }), h("span", { text: "看案子 →" })]) : null,
  ].filter(Boolean);
  if (lines.length) blocks.push(h("section", { className: "home-block" }, lines));
  if (!blocks.length) {
    blocks.push(emptyState(
      hasCustomers ? "今天的事都做完了" : "還沒有客戶資料",
      hasCustomers ? "可以搜尋久沒聯絡的重要客戶，或整理同名客戶。" : "到「更多 → 資料工具」匯入客戶，或直接記錄第一次拜訪。",
      h("a", { className: "button primary", href: hasCustomers ? "#/customers" : "#/data", text: hasCustomers ? "找客戶" : "匯入資料" }),
    ));
  }
  return h("div", { className: "home stack" }, [head, captureEntry, ...blocks]);
}

registerPage("today", { title: "今天", render: renderHome });
