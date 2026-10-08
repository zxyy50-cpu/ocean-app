import { daysBetween, formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { customerIdentity } from "../../data/model.js";
import { buildToday } from "../../data/today.js";
import { riskyCases } from "../../data/case-analysis.js";
import { clearCustomerFollowUp, completeReminder, snoozeReminder } from "../../data/reminders.js";
import { badge, emptyState, h, shortMoney, toast } from "../dom.js";
import { registerPage } from "../app.js";

const LIMIT = 5;

function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 11) return "早安";
  if (hour < 14) return "午安";
  if (hour < 18) return "午後好";
  return "晚安";
}

function progressRing(done, total) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const circumference = 2 * Math.PI * 26;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", "ring");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<circle cx="32" cy="32" r="26" class="ring-track"/><circle cx="32" cy="32" r="26" class="ring-value" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - percent / 100)}"/>`;
  return h("div", { className: "ring-wrap", role: "img", "aria-label": `今日完成 ${done} / ${total}` }, [svg, h("div", { className: "ring-label" }, [h("strong", { text: `${done}/${total}` }), h("small", { text: "今日完成" })])]);
}

function summaryText(data) {
  const dueToday = data.followUps.length + data.plannedVisits.length;
  const overdue = data.overdueReminders.length + data.overdueOpportunities.length;
  if (!dueToday && !overdue) return "今天沒有到期事項，適合開發新客戶或補齊資料。";
  const parts = [];
  if (dueToday) parts.push(`今天到期 ${dueToday} 件`);
  if (overdue) parts.push(`逾期 ${overdue} 件`);
  return `${parts.join("，")}。先從最上面開始。`;
}

function dueLabel(dueDate, today) {
  const diff = daysBetween(today, dueDate);
  if (diff === null) return "";
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  return formatShortDate(dueDate);
}

function taskRow(ctx, item, { tone = "", actions = true } = {}) {
  const today = ctx.today();
  const customer = ctx.model.customersById.get(item.customerId);
  const run = async (promise, message) => {
    const result = await promise;
    if (result?.ok === false) toast("操作失敗，請再試一次", { tone: "error" });
    else toast(message);
  };
  const visitLink = `visit?customer=${encodeURIComponent(item.customerId)}${item.kind === "reminder" ? `&reminder=${encodeURIComponent(item.id)}` : ""}${item.kind === "opportunity" ? `&opportunity=${encodeURIComponent(item.id)}` : ""}`;
  const controls = actions ? h("div", { className: "row-actions" }, [
    h("button", { type: "button", className: "small primary", text: "記錄拜訪", onClick: () => ctx.navigate(visitLink) }),
    item.kind === "opportunity"
      ? h("a", { className: "button small ghost", href: `#/opportunity/${encodeURIComponent(item.id)}`, text: "更新商機" })
      : item.kind === "reminder"
      ? h("button", { type: "button", className: "small ghost", text: "完成", dataset: { complete: item.id }, onClick: () => run(completeReminder(ctx.db, item.id, requestId("complete")), "已標記完成") })
      : h("button", { type: "button", className: "small ghost", text: "已處理", onClick: () => run(clearCustomerFollowUp(ctx.db, item.customerId, requestId("follow-up")), "已清除追蹤日") }),
    item.kind === "reminder" ? h("button", { type: "button", className: "small ghost", text: "延到明天", onClick: () => run(snoozeReminder(ctx.db, item.id, 1, requestId("snooze"), today), "已延到明天") }) : null,
  ]) : null;
  return h("li", { className: `task-row ${tone}`.trim() }, [
    h("a", { href: `#/customer/${encodeURIComponent(item.customerId)}`, className: "task-main" }, [
      h("strong", { text: customer?.name || "（未知客戶）" }),
      h("span", { text: item.title }),
      // Same-name customers look identical here, so say which record this is.
      customer && ctx.model.sameNameCount(customer) ? h("small", { className: "muted", dataset: { identity: customer.id }, text: `同名客戶之一：${customerIdentity(ctx.model, customer)}` }) : null,
    ]),
    h("span", { className: "due", text: dueLabel(item.dueDate, today) }),
    controls,
  ]);
}

function section(title, count, children, { tone = "", id } = {}) {
  return h("section", { className: `card section ${tone}`.trim(), dataset: { todaySection: id } }, [
    h("div", { className: "section-head" }, [h("h2", { text: title }), badge(String(count), tone === "warn" ? "warn" : "neutral")]),
    children,
  ]);
}

export function renderToday(ctx) {
  const today = ctx.today();
  const data = buildToday(ctx.model, { today, myAreas: ctx.settings.myAreas });
  const hasCustomers = ctx.model.customers.length > 0;

  const hero = h("section", { className: "hero card" }, [
    h("div", { className: "hero-copy" }, [
      h("p", { className: "eyebrow", text: new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${today}T04:00:00Z`)) }),
      h("h1", { text: `${greeting()}，Ocean` }),
      h("p", { dataset: { todaySummary: "" }, text: summaryText(data) }),
      h("div", { className: "explore-meter", title: "我的區域重要客戶中，近 90 天有接觸的比例" }, [
        h("span", { text: `我的區域探索度 ${data.exploration.percent}%` }),
        h("div", { className: "meter" }, [h("i", { style: { width: `${data.exploration.percent}%` } })]),
        h("small", { text: `${data.exploration.touched} / ${data.exploration.total} 家重要客戶近 90 天有接觸` }),
      ]),
    ]),
    progressRing(data.progress.done, data.progress.total),
  ]);

  const kpis = h("a", { href: "#/kpi", className: "kpi-strip", "aria-label": "查看完整 KPI" }, [
    ["本週拜訪", `${data.kpi.visitsThisWeek} 次`],
    ["進行中商機", `${data.kpi.openOpportunities} 件`],
    ["加權預估", shortMoney(data.kpi.weightedPipeline)],
    ["本月成交", shortMoney(data.kpi.wonThisMonth)],
  ].map(([label, value]) => h("div", { className: "kpi-mini" }, [h("small", { text: label }), h("strong", { text: value })])));

  const overdueCount = data.overdueReminders.length + data.overdueOpportunities.length;
  const blocks = [];
  if (overdueCount) {
    const shownReminders = data.overdueReminders.slice(0, LIMIT);
    const shownOpportunities = data.overdueOpportunities.slice(0, Math.max(0, LIMIT - shownReminders.length));
    const hiddenOpportunities = data.overdueOpportunities.length - shownOpportunities.length;
    const hiddenReminders = data.overdueReminders.length - shownReminders.length;
    blocks.push(section("已逾期", overdueCount, h("ul", { className: "task-list" }, [
      ...shownReminders.map((reminder) => taskRow(ctx, { kind: "reminder", id: reminder.id, customerId: reminder.customerId, title: reminder.title, dueDate: reminder.dueDate }, { tone: "warn" })),
      ...shownOpportunities.map((opportunity) => h("li", { className: "task-row warn" }, [
        h("a", { href: `#/opportunity/${encodeURIComponent(opportunity.id)}`, className: "task-main" }, [h("strong", { text: ctx.model.customerName(opportunity.customerId) }), h("span", { text: `商機「${opportunity.name}」・${opportunity.stage}` })]),
        h("span", { className: "due", text: opportunity.attention?.label || "" }),
        h("div", { className: "row-actions" }, [h("a", { className: "button small primary", href: `#/opportunity/${encodeURIComponent(opportunity.id)}`, text: "更新商機" })]),
      ])),
      hiddenOpportunities > 0 ? h("li", { className: "more-row" }, [h("a", { href: "#/opportunities?filter=overdue", dataset: { moreOverdue: "" }, text: `還有 ${hiddenOpportunities} 件逾期商機，到商機頁批次整理 →` })]) : null,
      hiddenReminders > 0 ? h("li", { className: "more-row muted", text: `另有 ${hiddenReminders} 件逾期提醒，完成上面幾件後會補上。` }) : null,
    ]), { tone: "warn", id: "overdue" }));
  }
  if (data.followUps.length) blocks.push(section("今天要追蹤", data.followUps.length, h("ul", { className: "task-list" }, [
    ...data.followUps.slice(0, LIMIT * 2).map((item) => taskRow(ctx, item)),
    data.followUps.length > LIMIT * 2 ? h("li", { className: "more-row muted", text: `另有 ${data.followUps.length - LIMIT * 2} 件，完成上面幾件後會補上。` }) : null,
  ]), { id: "follow-ups" }));
  if (data.plannedVisits.length) blocks.push(section("今天預定拜訪", data.plannedVisits.length, h("ul", { className: "task-list" }, data.plannedVisits.map((reminder) => taskRow(ctx, { kind: "reminder", ...reminder }))), { id: "visits" }));
  const risky = riskyCases(ctx.model, today);
  if (risky.length) {
    // When most cases share the same top gap, say it once instead of on every row.
    const counts = new Map();
    risky.forEach(({ flags }) => counts.set(flags[0].text, (counts.get(flags[0].text) || 0) + 1));
    const [commonText, commonCount] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    const shared = commonCount > 1 ? risky.find(({ flags }) => flags[0].text === commonText).flags[0] : null;
    blocks.push(section("案子的最大風險", risky.length, h("div", { className: "stack" }, [
      shared ? h("p", { className: "muted", dataset: { sharedRisk: "" }, text: `其中 ${commonCount} 件都是「${shared.text}」：${shared.hint}` }) : null,
      h("ul", { className: "task-list" }, risky.map(({ opportunity, flags }) => {
        const own = shared && flags[0].text === shared.text ? flags.find((flag) => flag.text !== shared.text) : flags[0];
        return h("li", { className: "task-row" }, [
          h("a", { href: `#/opportunity/${encodeURIComponent(opportunity.id)}?tab=case`, className: "task-main" }, [
            h("strong", { text: `${ctx.model.customerName(opportunity.customerId)}・${opportunity.name}` }),
            h("span", { text: own ? `★ ${own.text}` : `★ ${shared.text}` }),
          ]),
          h("span", { className: "due", text: opportunity.stage }),
        ]);
      })),
    ]), { id: "case-risks" }));
  }
  if (data.newOrderSignals.length) {
    blocks.push(section("新訂單機會", data.newOrderSignals.length, h("ul", { className: "task-list" }, data.newOrderSignals.slice(0, 5).map((item) => {
      const order = ctx.model.ordersById.get(item.orderId);
      return h("li", { className: "task-row" }, [
        h("a", { href: "#/orders?view=signals", className: "task-main" }, [h("strong", { text: order ? ctx.model.customerName(order.customerId) || order.customerName : item.customerNo }), h("span", { text: `首次購買：${item.productName || item.productCode}` })]),
        h("span", { className: "due", text: order?.orderDate ? formatShortDate(order.orderDate) : "" }),
      ]);
    })), { id: "signals" }));
  }
  if (!blocks.length) {
    blocks.push(h("section", { className: "card calm" }, [emptyState(
      hasCustomers ? "今天的待辦都清空了" : "還沒有客戶資料",
      hasCustomers ? "可以到「客戶」挑一個我的區域，找久未聯絡的重要客戶。" : "到「資料工具」匯入既有的客戶名單，或直接新增第一位客戶。",
      h("a", { className: "button primary", href: hasCustomers ? "#/customers" : "#/data", text: hasCustomers ? "探索客戶" : "前往匯入" }),
    )]));
  }
  if (data.upcoming.length) {
    blocks.push(h("details", { className: "card section upcoming" }, [
      h("summary", {}, [h("span", { text: "未來 7 天" }), badge(String(data.upcoming.length))]),
      h("ul", { className: "task-list" }, data.upcoming.map((reminder) => taskRow(ctx, { kind: "reminder", ...reminder }, { actions: false }))),
    ]));
  }

  return h("div", { className: "today" }, [hero, kpis, ...blocks]);
}

registerPage("today", { title: "今日", render: renderToday });
