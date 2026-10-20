import { daysBetween, formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import {
  clearWatch, reportText, savePlan, saveWeek, setGoalOverride, setWatch, sheetActualHint, weeklyReport,
} from "../../data/kpi-weekly.js";
import { badge, emptyState, field, h, input, money, openDialog, select, showErrors, shortMoney, toast } from "../dom.js";

// The weekly report shown at the meeting: the three goals at a glance, the manager's watched
// cases on top, what moved this week, the open cases per goal, and the weekly input form.
const view = { chartGoal: "G1", openGoal: "all", showAllOpen: false };
const SVG = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}, children = []) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined) element.setAttribute(key, String(value));
  for (const child of children.flat()) if (child) element.append(child);
  return element;
}

function signed(value) {
  if (value === null || value === undefined) return "—";
  return `${value >= 0 ? "+" : "−"}${shortMoney(Math.abs(value))}`;
}

function percentText(value) {
  return `${Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
}

// One bar per goal: solid = actual, light = actual + weighted open cases, ticks = tiers, line = where we should be by now.
function goalBar(goal) {
  const scale = Math.max(...goal.tiers.map((tier) => tier.amount), goal.projected, goal.actual, 1);
  const at = (amount) => `${Math.min(100, Math.max(0, amount / scale * 100))}%`;
  return h("div", { className: "kpi-bar", role: "img", "aria-label": `${goal.label} 實際 ${goal.actual}、預估 ${goal.projected}、目標 ${goal.target}` }, [
    h("i", { className: "kpi-bar-projected", style: { width: at(goal.projected) } }),
    h("i", { className: "kpi-bar-actual", style: { width: at(goal.actual) } }),
    ...goal.tiers.map((tier) => h("span", { className: "kpi-bar-tier", style: { left: at(tier.amount) }, title: `${tier.grade} ${money(tier.amount)}` }, [h("small", { text: tier.grade })])),
    h("span", { className: "kpi-bar-pace", style: { left: at(goal.paceAmount) }, title: `應有進度 ${money(goal.paceAmount)}` }),
  ]);
}

function goalCard(goal, filled) {
  const ahead = goal.behindPace >= 0;
  const paceText = filled ? `${ahead ? "超前" : "落後"}應有進度 ${shortMoney(Math.abs(goal.behindPace))}` : `應有進度 ${shortMoney(goal.paceAmount)}`;
  return h("article", { className: "kpi-goal", dataset: { kpiGoal: goal.key } }, [
    h("div", { className: "section-head" }, [h("strong", { text: goal.label }), h("div", { className: "button-row" }, [badge(`權重 ${goal.weight}`), badge(goal.grade, goal.actual >= goal.target ? "ok" : "accent")])]),
    h("div", { className: "kpi-goal-figures" }, [
      h("div", {}, [h("small", { className: "muted", text: "累計實際" }), h("strong", { className: "kpi-big", text: filled ? shortMoney(goal.actual) : "還沒填" }), h("small", { text: `達成 ${percentText(goal.percent)}・目標 ${shortMoney(goal.target)}` })]),
      h("div", {}, [h("small", { className: "muted", text: "本週增加" }), h("strong", { text: signed(goal.weekGain) }), h("small", { className: !filled ? "muted" : ahead ? "kpi-ok" : "kpi-warn", text: paceText })]),
      h("div", {}, [h("small", { className: "muted", text: "預估全年" }), h("strong", { text: shortMoney(goal.projected) }), h("small", { text: `${percentText(goal.projectedPercent)}・${goal.projectedGrade}` })]),
    ]),
    goalBar(goal),
    h("small", { className: "muted", text: `未結商機 ${goal.open.count} 件・金額 ${shortMoney(goal.open.amount)}・加權 ${shortMoney(goal.open.weighted)}${goal.open.noCloseDate ? `（${goal.open.noCloseDate} 件未填結案日也算入）` : ""}・距目標 ${shortMoney(Math.max(0, goal.gap))}` }),
    goal.notes.gap || goal.notes.next ? h("dl", { className: "kpi-notes" }, [
      goal.notes.gap ? [h("dt", { text: "差異原因" }), h("dd", { text: goal.notes.gap })] : null,
      goal.notes.next ? [h("dt", { text: "接下來怎麼做" }), h("dd", { text: goal.notes.next })] : null,
    ]) : null,
  ]);
}

// Cumulative actual per week against the straight pace line from 1/1 to the deadline.
function trendChart(ctx, report) {
  const goal = report.goals.find((item) => item.key === view.chartGoal) || report.goals[0];
  const width = 640; const height = 240; const left = 52; const right = 12; const top = 14; const bottom = 28;
  const yearStart = `${report.plan.year}-01-01`;
  const span = Math.max(1, daysBetween(yearStart, goal.deadline));
  const max = Math.max(...goal.tiers.map((tier) => tier.amount), ...report.weeks.map((week) => Number(week.actuals?.[goal.key]) || 0), 1) * 1.05;
  const x = (date) => left + Math.min(1, Math.max(0, daysBetween(yearStart, date) / span)) * (width - left - right);
  const y = (amount) => top + (1 - amount / max) * (height - top - bottom);
  const points = report.weeks.filter((week) => Number.isFinite(Number(week.actuals?.[goal.key])));
  const months = Array.from({ length: 12 }, (_, index) => `${report.plan.year}-${String(index + 1).padStart(2, "0")}-01`);
  const svg = s("svg", { viewBox: `0 0 ${width} ${height}`, class: "kpi-chart", role: "img", "aria-label": `${goal.label} 每週累計與應有進度` }, [
    ...months.map((month) => s("text", { x: x(month), y: height - 8, class: "kpi-axis" }, [document.createTextNode(`${Number(month.slice(5, 7))}月`)])),
    ...goal.tiers.map((tier) => [
      s("line", { x1: left, x2: width - right, y1: y(tier.amount), y2: y(tier.amount), class: "kpi-tier-line" }),
      s("text", { x: left - 6, y: y(tier.amount) + 4, class: "kpi-axis kpi-axis-y" }, [document.createTextNode(`${tier.grade} ${shortMoney(tier.amount)}`)]),
    ]),
    s("line", { x1: x(yearStart), y1: y(0), x2: x(goal.deadline), y2: y(goal.target), class: "kpi-pace-line" }),
    points.length > 1 ? s("polyline", { points: points.map((week) => `${x(week.date)},${y(Number(week.actuals[goal.key]))}`).join(" "), class: "kpi-actual-line" }) : null,
    ...points.map((week) => s("circle", { cx: x(week.date), cy: y(Number(week.actuals[goal.key])), r: 4, class: "kpi-actual-dot" }, [s("title", {}, [document.createTextNode(`${week.date}：${money(week.actuals[goal.key])}`)])])),
  ]);
  return h("section", { className: "card", dataset: { kpiTrend: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "每週累計 vs 應有進度" }), h("div", { className: "tabs", role: "tablist" }, report.goals.map((item) => h("button", {
      type: "button", className: "small ghost", role: "tab", "aria-selected": String(item.key === goal.key), dataset: { kpiChartGoal: item.key }, text: item.key, onClick: () => { view.chartGoal = item.key; ctx.render(); },
    })))]),
    points.length ? svg : h("p", { className: "muted", text: "填了第一週的累計業績後，這裡會畫出每週走勢。" }),
    h("div", { className: "kpi-legend" }, [h("span", { className: "kpi-legend-actual", text: "實際累計" }), h("span", { className: "kpi-legend-pace", text: "應有進度（平均分攤到截止日）" }), h("span", { className: "kpi-legend-tier", text: "級距" })]),
  ]);
}

// Imported cases are named by category (公告檢驗…); the first line of 重點摘要 tells them apart.
function gist(opportunity) {
  const notes = String(opportunity.notes || "");
  const line = (notes.match(/重點摘要：([^\n]+)/)?.[1] || (opportunity.source === "匯入" ? "" : notes.split("\n")[0]) || "").trim();
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

function opportunityName(ctx, opportunity) {
  const summary = gist(opportunity);
  return h("a", { href: `#/case/${encodeURIComponent(opportunity.id)}`, className: "kpi-opp-name" }, [
    h("strong", { text: `${ctx.model.customerName(opportunity.customerId) || "（客戶不明）"}・${opportunity.name || opportunity.product || "未命名商機"}` }),
    summary ? h("small", { className: "muted", text: summary }) : null,
  ]);
}

function facts(opportunity) {
  return [opportunity.stage, opportunity.amount ? money(opportunity.amount) : "金額未填", `${Number(opportunity.probability) || 0}%`, opportunity.expectedCloseDate ? `預計 ${formatShortDate(opportunity.expectedCloseDate)}` : "未填結案日"].join("・");
}

function sinceFlag(row) {
  const base = row.flag.base || {};
  const changes = [];
  if (base.stage && base.stage !== row.now.stage) changes.push(`階段 ${base.stage} → ${row.now.stage}`);
  if (base.amount !== undefined && base.amount !== row.now.amount) changes.push(`金額 ${shortMoney(base.amount)} → ${shortMoney(row.now.amount)}`);
  if (base.probability !== undefined && base.probability !== row.now.probability) changes.push(`機率 ${base.probability}% → ${row.now.probability}%`);
  if (base.expectedCloseDate !== undefined && base.expectedCloseDate !== row.now.expectedCloseDate) changes.push(`結案日 ${base.expectedCloseDate || "未填"} → ${row.now.expectedCloseDate || "未填"}`);
  return changes.length ? changes.join("、") : "標記後還沒有變化";
}

function askWatch(ctx, opportunity, current = "") {
  openDialog((close) => {
    const note = h("textarea", { name: "note", rows: 3, value: current, placeholder: "例如：主管想知道這案何時能報價、競爭對手是誰" });
    const form = h("form", { className: "sheet-body stack", onSubmit: async (event) => {
      event.preventDefault();
      const result = await setWatch(ctx.db, ctx.model.all, opportunity, note.value, ctx.today(), requestId("kpi-watch"));
      if (result?.ok === false) { toast("沒有存成功，請再試一次", { tone: "error" }); return; }
      close(); toast("已標記主管關注，下次週報會置頂"); ctx.render();
    } }, [
      h("h2", { text: "主管關注" }), h("p", { className: "muted", text: opportunity.name || "" }),
      field("主管想追什麼（可空白）", note),
      h("div", { className: "button-row" }, [h("button", { type: "submit", className: "primary", dataset: { kpiWatchSave: "" }, text: "標記" }), h("button", { type: "button", className: "ghost", text: "取消", onClick: () => close() })]),
    ]);
    return form;
  }, { label: "主管關注" });
}

function watchSection(ctx, report) {
  if (!report.watched.length) return null;
  return h("section", { className: "card kpi-watch", dataset: { kpiWatch: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `★ 主管關注（${report.watched.length}）` }), h("small", { className: "muted", text: "上次週報時主管想追的案子" })]),
    h("ul", { className: "kpi-list" }, report.watched.map((row) => h("li", { className: row.updated ? "" : "is-stale", dataset: { kpiWatchRow: row.opportunity.id } }, [
      h("div", { className: "kpi-row-main" }, [
        opportunityName(ctx, row.opportunity),
        h("small", { text: facts(row.opportunity) }),
        row.flag.note ? h("small", { className: "kpi-watch-note", text: `主管問：${row.flag.note}` }) : null,
        h("small", { className: "muted", text: `${formatShortDate(row.flag.since)} 標記以來：${sinceFlag(row)}` }),
      ]),
      h("div", { className: "kpi-row-side" }, [
        row.updated ? badge("本週已更新", "ok") : badge("本週還沒更新", "warn"),
        h("a", { className: "button small ghost", href: `#/case/${encodeURIComponent(row.opportunity.id)}`, text: "更新案子" }),
        h("button", { type: "button", className: "small ghost", text: "改備註", onClick: () => askWatch(ctx, row.opportunity, row.flag.note) }),
        h("button", { type: "button", className: "small ghost", dataset: { kpiUnwatch: row.opportunity.id }, text: "取消關注", onClick: async () => {
          const result = await clearWatch(ctx.db, ctx.model.all, row.opportunity.id, requestId("kpi-unwatch"));
          toast(result?.ok === false ? "沒有成功，請再試一次" : "已取消主管關注", { tone: result?.ok === false ? "error" : "ok" });
          ctx.render();
        } }),
      ]),
    ]))),
  ]);
}

function highlightSection(ctx, report) {
  const { rows, since } = report.highlights;
  return h("section", { className: "card", dataset: { kpiHighlights: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "本週商機更新重點" }), h("small", { className: "muted", text: since ? `與 ${formatShortDate(since)} 週報相比` : `${formatShortDate(report.period.start)}–${formatShortDate(report.period.end)} 有動的商機` })]),
    rows.length ? h("ul", { className: "kpi-list" }, rows.slice(0, 20).map((row) => h("li", { dataset: { kpiHighlight: row.opportunity.id } }, [
      h("div", { className: "kpi-row-main" }, [
        opportunityName(ctx, row.opportunity),
        h("div", { className: "chip-row" }, row.changes.map((change) => badge(change.text, { won: "ok", new: "accent", lost: "warn", stage: "accent" }[change.kind] || "neutral"))),
        ...row.changes.filter((change) => change.detail).map((change) => h("small", { className: "muted", text: change.detail })),
      ]),
      h("small", { className: "kpi-row-side muted", text: facts(row.opportunity) }),
    ]))) : h("p", { className: "muted", text: "這週還沒有商機變動。拜訪後記得在「記錄」連到商機，或到案子更新階段與金額。" }),
    rows.length > 20 ? h("small", { className: "muted", text: `另有 ${rows.length - 20} 件，請到案子清單查看。` }) : null,
  ]);
}

function openSection(ctx, report) {
  const watched = new Set(report.watched.map((row) => row.opportunity.id));
  const rows = report.open.filter((row) => view.openGoal === "all" || row.goals.includes(view.openGoal)).sort((a, b) => b.weighted - a.weighted || (Number(b.opportunity.amount) || 0) - (Number(a.opportunity.amount) || 0));
  const shown = view.showAllOpen ? rows : rows.slice(0, 15);
  const total = rows.reduce((sum, row) => sum + (Number(row.opportunity.amount) || 0), 0);
  const weightedTotal = rows.reduce((sum, row) => sum + row.weighted, 0);
  const goalChoices = [{ value: "", label: "自動分類" }, ...report.plan.goals.filter((goal) => !goal.all).map((goal) => ({ value: goal.key, label: `算 ${goal.key}` })), { value: "none", label: "只算 G1" }];
  return h("section", { className: "card", dataset: { kpiOpen: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "未結案商機（今年預計結案）" }), h("div", { className: "tabs", role: "tablist" }, [["all", "全部"], ...report.plan.goals.map((goal) => [goal.key, goal.key])].map(([value, label]) => h("button", {
      type: "button", className: "small ghost", role: "tab", "aria-selected": String(view.openGoal === value), dataset: { kpiOpenGoal: value }, text: label, onClick: () => { view.openGoal = value; ctx.render(); },
    })))]),
    h("p", { className: "kpi-open-total", text: `${rows.length} 件・金額 ${money(total)}・加權（金額 × 機率）${money(weightedTotal)}` }),
    (() => {
      const overdue = rows.filter((row) => row.opportunity.expectedCloseDate && row.opportunity.expectedCloseDate < ctx.today()).length;
      return overdue ? h("small", { className: "kpi-warn", dataset: { kpiOpenOverdue: "" }, text: `其中 ${overdue} 件預計結案日已過（紅字）。週會前建議更新結案日或標記結果，預估全年才準。` }) : null;
    })(),
    rows.length ? h("ul", { className: "kpi-list" }, shown.map((row) => h("li", { dataset: { kpiOpenRow: row.opportunity.id } }, [
      h("button", { type: "button", className: `kpi-star${watched.has(row.opportunity.id) ? " is-on" : ""}`, "aria-label": watched.has(row.opportunity.id) ? "已是主管關注" : "標記主管關注", "aria-pressed": String(watched.has(row.opportunity.id)), dataset: { kpiStar: row.opportunity.id }, text: watched.has(row.opportunity.id) ? "★" : "☆",
        onClick: () => (watched.has(row.opportunity.id) ? toast("已在主管關注，可在上方取消") : askWatch(ctx, row.opportunity)) }),
      h("div", { className: "kpi-row-main" }, [
        opportunityName(ctx, row.opportunity),
        h("small", { className: row.opportunity.expectedCloseDate && row.opportunity.expectedCloseDate < ctx.today() ? "kpi-warn" : "", text: facts(row.opportunity) }),
      ]),
      h("div", { className: "kpi-row-side" }, [
        h("strong", { text: shortMoney(row.weighted) }), h("small", { className: "muted", text: row.goals.join("・") }),
        select("goal", goalChoices, row.manual, { "aria-label": "算在哪個目標", className: "kpi-goal-select", dataset: { kpiGoalOverride: row.opportunity.id }, onChange: async (event) => {
          await setGoalOverride(ctx.db, ctx.model.all, row.opportunity.id, event.target.value, requestId("kpi-group"));
          ctx.render();
        } }),
      ]),
    ]))) : emptyState("沒有今年預計結案的商機", "在案子裡填上預計結案日，這裡就會出現。"),
    rows.length > shown.length ? h("button", { type: "button", className: "ghost small", text: `顯示全部 ${rows.length} 件`, onClick: () => { view.showAllOpen = true; ctx.render(); } }) : null,
    h("small", { className: "muted", text: "品牌關鍵字自動分到 G2／G3（G1 包含全部）；分錯可在右邊改。按 ☆ 標記主管關注，下次週報會置頂並提醒更新。" }),
  ]);
}

function weekForm(ctx, report) {
  const source = report.current;
  const hint = sheetActualHint(ctx.reference?.kpis || []);
  const goalFields = report.plan.goals.map((goal) => {
    const last = report.previous?.actuals?.[goal.key];
    const amount = input(`actual-${goal.key}`, source?.actuals?.[goal.key] ?? "", { inputmode: "numeric", placeholder: last !== undefined ? `上次 ${Number(last).toLocaleString("zh-TW")}` : "例如 10322729", dataset: { kpiActual: goal.key } });
    return h("fieldset", { className: "kpi-week-goal" }, [
      h("legend", { text: goal.label }),
      field("今年累計實際業績（未稅）", amount, { hint: last !== undefined ? `上次（${formatShortDate(report.previous.date)}）${money(last)}` : "" }),
      goal.all && hint && !source ? h("button", { type: "button", className: "small ghost", dataset: { kpiSheetHint: "" }, text: `帶入 KPI 表 1–${hint.months} 月實績 ${money(hint.amount)}`, onClick: () => { amount.value = String(hint.amount); amount.closest("form")?.setAttribute("data-dirty", ""); } }) : null,
      field("差異原因", h("textarea", { name: `gap-${goal.key}`, rows: 2, value: source?.notes?.[goal.key]?.gap || "", placeholder: report.previous?.notes?.[goal.key]?.gap || "例如：大案延到明年採購" })),
      field("接下來怎麼做", h("textarea", { name: `next-${goal.key}`, rows: 2, value: source?.notes?.[goal.key]?.next || "", placeholder: report.previous?.notes?.[goal.key]?.next || "例如：11 月前完成 3 家 Demo" })),
    ]);
  });
  const form = h("form", { className: "stack", dataset: { kpiWeekForm: "" }, onSubmit: async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      date: data.get("date"),
      actuals: Object.fromEntries(report.plan.goals.map((goal) => [goal.key, data.get(`actual-${goal.key}`)])),
      notes: Object.fromEntries(report.plan.goals.map((goal) => [goal.key, { gap: data.get(`gap-${goal.key}`), next: data.get(`next-${goal.key}`) }])),
    };
    const result = await saveWeek(ctx.db, ctx.model, ctx.model.all, payload, ctx.today(), requestId("kpi-week"));
    if (result?.ok === false) { showErrors(form, result.errors || {}); if (result.error !== "validation") toast("沒有存成功，請再試一次", { tone: "error" }); return; }
    toast("本週 KPI 已更新");
    ctx.render();
  } }, [
    h("p", { className: "form-errors", dataset: { formErrors: "" }, hidden: true }),
    field("週會日期", input("date", source?.date || report.period.date, { type: "date" })),
    ...goalFields,
    h("div", { className: "button-row" }, [h("button", { type: "submit", className: "primary", dataset: { kpiWeekSave: "" }, text: source ? "更新這週" : "存這週" })]),
  ]);
  return h("details", { className: "card", open: !source, dataset: { kpiWeekInput: "" } }, [
    h("summary", { className: "section-head" }, [h("h2", { text: source ? `本週已填（${formatShortDate(source.date)}）・修改` : "填本週累計業績" })]),
    form,
  ]);
}

function planForm(ctx, report) {
  const plan = report.plan;
  const form = h("form", { className: "stack", dataset: { kpiPlanForm: "" }, onSubmit: async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const payload = {
      meetingDay: data.get("meetingDay"),
      tiers: Object.fromEntries(plan.goals.map((goal) => [goal.key, Object.fromEntries(goal.tiers.map((tier) => [tier.grade, data.get(`tier-${goal.key}-${tier.grade}`)]))])),
      keywords: Object.fromEntries(plan.goals.filter((goal) => !goal.all).map((goal) => [goal.key, data.get(`keywords-${goal.key}`)])),
    };
    const result = await savePlan(ctx.db, ctx.model.all, payload, ctx.today(), requestId("kpi-plan"));
    if (result?.ok === false) { showErrors(form, result.errors || {}); return; }
    toast("目標設定已更新");
    ctx.render();
  } }, [
    h("p", { className: "form-errors", dataset: { formErrors: "" }, hidden: true }),
    field("週會是星期幾", select("meetingDay", ["日", "一", "二", "三", "四", "五", "六"].map((label, index) => ({ value: index, label: `星期${label}` })), plan.meetingDay), { hint: "週會前一天和當天，今天頁會提醒更新" }),
    ...plan.goals.map((goal) => h("fieldset", { className: "kpi-week-goal" }, [
      h("legend", { text: `${goal.label}・截止 ${goal.deadline}` }),
      h("div", { className: "kpi-tier-inputs" }, goal.tiers.map((tier) => field(`${tier.grade} 標`, input(`tier-${goal.key}-${tier.grade}`, tier.amount, { inputmode: "numeric" })))),
      goal.all ? h("small", { className: "muted", text: "包含全部商機" }) : field("品牌關鍵字（逗號分隔）", input(`keywords-${goal.key}`, goal.keywords.join("、"))),
    ])),
    h("div", { className: "button-row" }, [h("button", { type: "submit", className: "ghost", dataset: { kpiPlanSave: "" }, text: "存目標設定" })]),
  ]);
  return h("details", { className: "card", dataset: { kpiPlan: "" } }, [h("summary", { className: "section-head" }, [h("h2", { text: "目標與級距設定" })]), form]);
}

async function copyReport(ctx, report) {
  const text = reportText(report, (id) => ctx.model.customerName(id));
  try { await navigator.clipboard.writeText(text); toast("週報文字已複製，可以貼到 LINE"); }
  catch { openDialog(() => h("div", { className: "sheet-body stack" }, [h("h2", { text: "週報文字" }), h("textarea", { rows: 14, value: text, readonly: true })]), { label: "週報文字" }); }
}

export function weeklySection(ctx) {
  const report = weeklyReport(ctx.model, ctx.model.all, ctx.today());
  const head = h("section", { className: "card kpi-report-head", dataset: { kpiReportHead: "" } }, [
    h("div", { className: "section-head" }, [
      h("div", {}, [h("h2", { text: `${report.period.label}週報` }), h("small", { className: "muted", text: `本期 ${formatShortDate(report.period.start)}–${formatShortDate(report.period.end)}${report.latest ? `・金額更新到 ${formatShortDate(report.latest.date)}` : ""}` })]),
      h("div", { className: "button-row" }, [
        report.current ? badge("本週已更新", "ok") : badge("本週還沒更新", "warn"),
        h("button", { type: "button", className: "small ghost", dataset: { kpiCopy: "" }, text: "複製週報文字", onClick: () => copyReport(ctx, report) }),
      ]),
    ]),
    report.latest ? null : h("p", { className: "muted", text: "還沒有填過每週業績。先在下方「填本週累計業績」輸入三項金額。" }),
  ]);
  return h("div", { className: "stack kpi-weekly", dataset: { kpiWeekly: "" } }, [
    head,
    watchSection(ctx, report),
    h("section", { className: "kpi-goals" }, report.goals.map((goal) => goalCard(goal, Boolean(report.latest)))),
    trendChart(ctx, report),
    highlightSection(ctx, report),
    openSection(ctx, report),
    weekForm(ctx, report),
    planForm(ctx, report),
  ]);
}

export function resetKpiWeeklyView() {
  Object.assign(view, { chartGoal: "G1", openGoal: "all", showAllOpen: false });
}
