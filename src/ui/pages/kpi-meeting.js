import { formatShortDate } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { briefText, hideBlocker, meetingBrief, saveAsk, showHiddenBlockers } from "../../data/meeting-brief.js";
import { emptyState, h, money, openDialog, shortMoney, toast } from "../dom.js";
import { pageHeader } from "../shell.js";

// 週會一頁: what Ocean shares on Teams. Four numbered sections, big type, one copy button,
// and a presentation mode that hides the app around it.

const LIGHT = { green: ["🟢", "照進度"], yellow: ["🟡", "落後，但商機補得回來"], red: ["🔴", "落後，需要加把勁"] };

export function setPresenting(on) {
  if (on) document.documentElement.dataset.present = "";
  else delete document.documentElement.dataset.present;
}

// Leaving the KPI page (or pressing Esc) always ends presentation mode.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => { if (!String(window.location.hash).startsWith("#/kpi")) setPresenting(false); });
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") setPresenting(false); });
}

function section(number, title, note, children, data) {
  return h("section", { className: "card meet-section", dataset: { meetSection: data } }, [
    h("div", { className: "meet-head" }, [h("span", { className: "meet-number", text: number }), h("h2", { text: title }), note ? h("small", { className: "muted", text: note }) : null]),
    ...children,
  ]);
}

function results(brief) {
  if (!brief.filled) {
    return section("①", "結果", "", [emptyState("本週業績還沒填", "到「業績與商機」分頁填三個目標的累計業績，這裡就會出現。", h("a", { className: "button primary", href: "#/kpi?view=weekly", text: "去填業績" }))], "results");
  }
  return section("①", "結果", `金額更新到 ${formatShortDate(brief.report.latest.date)}`, [
    h("div", { className: "meet-goals" }, brief.goals.map((goal) => h("article", { className: `meet-goal light-${goal.light}`, dataset: { meetGoal: goal.key, meetLight: goal.light } }, [
      h("div", { className: "meet-goal-top" }, [h("strong", { text: goal.label }), h("span", { title: LIGHT[goal.light][1], text: LIGHT[goal.light][0] })]),
      h("div", { className: "meet-big", text: `${goal.percent}%` }),
      h("div", { className: "meter" }, [h("i", { style: { width: `${Math.min(100, goal.percent)}%` } })]),
      h("small", { text: `累計 ${shortMoney(goal.actual)} ／ 目標 ${shortMoney(goal.target)}` }),
      h("small", { text: `${goal.weekGain === null ? "" : `本週 ${goal.weekGain >= 0 ? "+" : "−"}${shortMoney(Math.abs(goal.weekGain))}・`}${goal.behindPace >= 0 ? "超前" : "落後"}進度 ${shortMoney(Math.abs(goal.behindPace))}` }),
      h("small", { className: "muted", text: `預估全年 ${shortMoney(goal.projected)}（${goal.projectedGrade}）` }),
      goal.notes.gap ? h("p", { className: "meet-note", text: `差異原因：${goal.notes.gap}` }) : null,
    ]))),
  ], "results");
}

function figure(label, value, note, data) {
  return h("div", { className: "meet-figure", dataset: { meetFigure: data } }, [h("small", { text: label }), h("strong", { text: value }), note ? h("small", { className: "muted", text: note }) : null]);
}

function workDone(ctx, brief) {
  const { work: w, cases } = brief;
  const name = (opportunity) => [opportunity.name, ctx.model.customerName(opportunity.customerId)].filter(Boolean).join("・");
  return section("②", "這週做了什麼", `${formatShortDate(brief.period.start)}–${formatShortDate(brief.period.end)}`, [
    h("div", { className: "meet-figures" }, [
      figure("聯絡", `${w.activities} 次`, `親訪 ${w.onSite}・電話 ${w.calls}${w.others ? `・其他 ${w.others}` : ""}`, "activities"),
      figure("客戶", `${w.customers} 家`, w.newCustomers ? `新客 ${w.newCustomers} 家` : "", "customers"),
      figure("更新案子", `${cases.rows.length} 件`, `合計 ${shortMoney(cases.amount)}`, "cases"),
      figure("成交", cases.won.count ? shortMoney(cases.won.amount) : "—", cases.won.count ? `${cases.won.count} 件${cases.lost.count ? `・未成交 ${cases.lost.count}` : ""}` : cases.lost.count ? `未成交 ${cases.lost.count} 件` : "", "won"),
      w.orders ? figure("LINE 訂單", `${w.orders} 張`, shortMoney(w.orderAmount), "orders") : null,
    ]),
    cases.rows.length ? h("ul", { className: "meet-cases", dataset: { meetCases: "" } }, cases.rows.map((row) => h("li", { dataset: { meetCase: row.opportunity.id } }, [
      h("a", { href: `#/case/${encodeURIComponent(row.opportunity.id)}`, text: name(row.opportunity) }),
      h("span", { className: "meet-change", text: row.changes.map((change) => change.text).join("、") }),
      h("strong", { className: "num", text: shortMoney(row.opportunity.amount) }),
    ]))) : h("p", { className: "muted", text: "這週還沒有案子更新。拜訪後在「記錄」連到案子，或到案子更新階段與金額，這裡就會列出來。" }),
  ], "work");
}

function askRow(ctx, brief, row) {
  const name = [row.opportunity.name, ctx.model.customerName(row.opportunity.customerId)].filter(Boolean).join("・");
  const box = h("input", { type: "text", value: row.ask, placeholder: "需要主管幫什麼？例如：一起拜訪廠長、核准特價", "aria-label": `${name} 需要的協助`, dataset: { meetAsk: row.opportunity.id } });
  const save = async () => {
    if (box.value.trim() === row.ask) return;
    const result = await saveAsk(ctx.db, ctx.model.all, brief.period.date, row.opportunity.id, box.value, requestId("meet-ask"));
    if (result?.ok === false) toast("沒有存成功，請再試一次", { tone: "error" });
  };
  box.addEventListener("change", save);
  box.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); box.blur(); } });
  return h("li", { className: "meet-ask", dataset: { meetBlocker: row.opportunity.id } }, [
    h("div", { className: "meet-ask-head" }, [
      h("a", { href: `#/case/${encodeURIComponent(row.opportunity.id)}` }, [h("strong", { text: name })]),
      h("strong", { className: "num", text: shortMoney(row.opportunity.amount) }),
    ]),
    h("small", { className: "kpi-warn", text: row.reason }),
    h("div", { className: "meet-ask-input" }, [
      box,
      h("button", { type: "button", className: "small ghost meet-hide", dataset: { meetHide: row.opportunity.id }, text: "這件不報告", onClick: async () => {
        await hideBlocker(ctx.db, ctx.model.all, brief.period.date, row.opportunity.id, requestId("meet-hide"));
        ctx.render();
      } }),
    ]),
  ]);
}

function blockers(ctx, brief) {
  const { rows, more, hiddenCount } = brief.blockers;
  return section("③", "需要主管協助", "系統挑出最該討論的 3 件，各補一句需要什麼幫忙", [
    rows.length ? h("ul", { className: "meet-asks" }, rows.map((row) => askRow(ctx, brief, row))) : h("p", { className: "muted", text: "沒有卡住的案子。" }),
    more || hiddenCount ? h("div", { className: "button-row" }, [
      more ? h("small", { className: "muted", text: `另有 ${more} 件也可以談` }) : null,
      hiddenCount ? h("button", { type: "button", className: "small ghost", dataset: { meetUnhide: "" }, text: `顯示不報告的 ${hiddenCount} 件`, onClick: async () => { await showHiddenBlockers(ctx.db, ctx.model.all, brief.period.date, requestId("meet-unhide")); ctx.render(); } }) : null,
    ]) : null,
  ], "asks");
}

function nextWeek(ctx, brief) {
  const plan = brief.plans;
  const nexts = brief.goals.filter((goal) => goal.notes.next);
  return section("④", "下週計畫", `${formatShortDate(plan.start)}–${formatShortDate(plan.end)}`, [
    plan.planned ? h("p", { className: "meet-check", dataset: { meetDone: "" }, text: `本週排定的 ${plan.planned} 件，完成 ${plan.done} 件` }) : null,
    plan.next.length ? h("ul", { className: "meet-plan", dataset: { meetPlan: "" } }, plan.next.slice(0, 12).map((row) => h("li", {}, [
      h("span", { className: "meet-date", text: formatShortDate(row.date) }),
      h("a", { href: `#/customer/${encodeURIComponent(row.customerId)}`, text: ctx.model.customerName(row.customerId) }),
      h("span", { text: row.text }),
    ]))) : h("p", { className: "muted", text: "下週還沒有排定的聯絡。在記錄或案子裡設提醒日，這裡就會出現。" }),
    plan.next.length > 12 ? h("small", { className: "muted", text: `另有 ${plan.next.length - 12} 件` }) : null,
    nexts.length ? h("dl", { className: "kpi-notes" }, nexts.flatMap((goal) => [h("dt", { text: goal.label.split(" ")[0] }), h("dd", { text: goal.notes.next })])) : null,
  ], "next");
}

async function copyBrief(ctx, brief) {
  const text = briefText(brief, (id) => ctx.model.customerName(id));
  try { await navigator.clipboard.writeText(text); toast("週會報告已複製，可以貼到 Teams 或 LINE"); }
  catch { openDialog(() => h("div", { className: "sheet-body stack" }, [h("h2", { text: "週會報告" }), h("textarea", { rows: 18, value: text, readonly: true })]), { label: "週會報告" }); }
}

export function meetingSection(ctx) {
  const brief = meetingBrief(ctx.model, ctx.model.all, ctx.today());
  return h("div", { className: "stack meet", dataset: { meeting: "" } }, [
    pageHeader("KPI", "", [
      h("button", { type: "button", className: "small ghost", dataset: { meetCopy: "" }, text: "複製文字", onClick: () => copyBrief(ctx, brief) }),
      // The label follows :root[data-present] in CSS, so Esc (which does not re-render) keeps it right.
      h("button", { type: "button", className: "small primary meet-present", dataset: { meetPresent: "" }, onClick: () => setPresenting(document.documentElement.dataset.present === undefined) }, [
        h("span", { className: "when-off", text: "簡報模式" }), h("span", { className: "when-on", text: "結束簡報（Esc）" }),
      ]),
    ], {
      figure: `${brief.period.label}報告`,
      note: "依序講：結果 → 做了什麼 → 需要協助 → 下週計畫",
      help: "Teams 分享這個視窗，按「簡報模式」只留報告內容、字放大；按 Esc 結束。「需要主管協助」每件補一句，會記住到下次週會。",
    }),
    results(brief),
    workDone(ctx, brief),
    blockers(ctx, brief),
    nextWeek(ctx, brief),
    h("small", { className: "muted", text: `業績金額在「業績與商機」分頁更新；案子與下週計畫來自你的記錄。合計金額為案子金額（${money(brief.cases.amount)}），不是加權。` }),
  ]);
}
