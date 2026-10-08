import { buildKpi, overviewTargets } from "../../data/kpi.js";
import { funnelConversion, lossReasonSummary } from "../../data/opportunities.js";
import { badge, emptyState, h, money, shortMoney } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const state = { period: "month", mineOnly: false };

function bar(value, max, label) {
  const percent = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return h("div", { className: "meter", role: "img", "aria-label": label }, [h("i", { style: { width: `${percent}%` } })]);
}

export function renderKpi(ctx) {
  const today = ctx.today();
  const data = buildKpi(ctx.model, { period: state.period, today, myAreas: ctx.settings.myAreas, mineOnly: state.mineOnly });
  const targets = overviewTargets(ctx.reference?.kpis || []);
  const periodTabs = h("div", { className: "tabs", role: "tablist" }, [["month", "本月"], ["quarter", "本季"], ["year", "今年"]].map(([value, label]) => h("button", {
    type: "button", className: "small ghost", role: "tab", "aria-selected": String(state.period === value), dataset: { period: value }, text: label, onClick: () => { state.period = value; ctx.render(); },
  })));
  const mine = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.mineOnly, onChange: (event) => { state.mineOnly = event.target.checked; ctx.render(); } }), h("span", { text: "只算我的區域" })]);

  const targetSection = h("section", { className: "card", dataset: { kpiTargets: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "年度目標" }), ctx.reference?.capturedAt ? badge(`KPI 表快照 ${String(ctx.reference.capturedAt).slice(0, 10)}`) : null]),
    targets.length ? h("div", { className: "stack" }, targets.map((target) => h("div", { className: "stack", dataset: { kpiTarget: target.id } }, [
      h("div", { className: "section-head" }, [h("strong", { text: target.label }), badge(`${target.progressPercent}%${target.grade ? `・${target.grade}` : ""}`, target.progressPercent >= 100 ? "ok" : "accent")]),
      h("div", { className: "meter" }, [h("i", { style: { width: `${Math.min(100, target.progressPercent)}%` } })]),
      h("small", { className: "muted", text: `A 標 ${money(target.target)}・目前／預估 ${money(target.actual)}・距 C 標 ${money(target.gapToC)}` }),
    ]))) : emptyState("尚未匯入 KPI 目標", "匯入 KPI 試算表快照後，年度與各策略目標會顯示在這裡。"),
  ]);

  const a = data.activity;
  const activitySection = h("section", { className: "card", dataset: { kpiActivity: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `我的行動・${data.range.label}` })]),
    h("div", { className: "kpi-strip" }, [
      ["拜訪紀錄", `${a.visits} 次`, `親訪 ${a.onSite}`], ["接觸客戶", `${a.customersContacted} 家`, ""], ["新增商機", `${a.opportunitiesCreated} 件`, ""], ["成交金額", shortMoney(a.wonAmount), `${a.wonCount} 件`],
      ["加權商機", shortMoney(a.weightedPipeline), "進行中"], ["逾期商機", `${a.overdue} 件`, "需要更新"], ["首購提醒處理", `${a.signalsHandled} 件`, ""], ["重要客戶久未聯絡", `${a.idleImportant} 家`, "超過 60 天"],
    ].map(([label, value, note]) => h("div", { className: "kpi-mini" }, [h("small", { text: label }), h("strong", { text: value }), note ? h("small", { className: "muted", text: note }) : null]))),
  ]);

  const maxFunnel = Math.max(...data.funnel.map((row) => row.amount), 1);
  const funnelSection = h("section", { className: "card", dataset: { kpiFunnel: "" } }, [
    h("h2", { text: "商機分布（目前全部）" }),
    conversionBlock(ctx),
    h("div", { className: "stack" }, data.funnel.map((row) => h("div", { className: "stack" }, [
      h("div", { className: "section-head" }, [h("span", { text: row.stage }), h("small", { className: "muted", text: `${row.count} 件・${money(row.amount)}` })]),
      bar(row.amount, maxFunnel, `${row.stage} ${row.amount}`),
    ]))),
  ]);

  const maxMonth = Math.max(...data.monthly.map((row) => row.amount), 1);
  const monthlySection = h("section", { className: "card", dataset: { kpiMonthly: "" } }, [
    h("h2", { text: `${today.slice(0, 4)} 年每月訂單金額` }),
    h("div", { className: "table-wrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, [h("th", { text: "月份" }), h("th", { className: "num", text: "金額" }), h("th", { text: "" })])]),
      h("tbody", {}, data.monthly.filter((row) => row.month <= Number(today.slice(5, 7))).map((row) => h("tr", {}, [
        h("td", { text: `${row.month} 月` }), h("td", { className: "num", text: money(row.amount) }), h("td", { style: { width: "45%" } }, [bar(row.amount, maxMonth, `${row.month} 月 ${row.amount}`)]),
      ]))),
    ])]),
    h("small", { className: "muted", text: "依 APP 內的訂單品項金額加總（未稅），不含已取消訂單。" }),
  ]);

  return h("div", { className: "stack" }, [
    pageHeader("KPI", "完整目標與行動統計；今日頁只放摘要。"),
    h("div", { className: "button-row" }, [periodTabs, mine]),
    targetSection,
    activitySection,
    h("div", { className: "grid-2" }, [funnelSection, monthlySection]),
    lossSection(ctx),
  ]);
}

function conversionBlock(ctx) {
  const conversion = funnelConversion(ctx.model.all.opportunity || []);
  return h("div", { className: "stack", dataset: { conversion: "" } }, [
    h("div", { className: "kpi-strip" }, [
      ...conversion.steps.map((step) => h("div", { className: "kpi-mini", dataset: { conversionStep: `${step.from}-${step.to}` } }, [h("small", { text: `${step.from} → ${step.to}` }), h("strong", { text: step.rate === null ? "—" : `${step.rate}%` }), h("small", { className: "muted", text: `${step.advanced} / ${step.reached} 件` })])),
      h("div", { className: "kpi-mini", dataset: { winRate: "" } }, [h("small", { text: "結案勝率" }), h("strong", { text: conversion.winRate === null ? "—" : `${conversion.winRate}%` }), h("small", { className: "muted", text: `成交 ${conversion.won}・未成交 ${conversion.lost}` })]),
    ]),
    h("small", { className: "muted", text: "看得出卡在哪一段，比只看總量更有用。匯入的舊商機不知道在哪一段流失，一律算在「接觸」。" }),
  ]);
}

function lossSection(ctx) {
  const reasons = lossReasonSummary(ctx.model.all.opportunity || []);
  const reviewed = (ctx.model.all.opportunity || []).filter((opportunity) => !opportunity.archivedAt && ["成交", "失敗"].includes(opportunity.stage) && opportunity.review).length;
  const max = Math.max(...reasons.map((row) => row.count), 1);
  return h("section", { className: "card", dataset: { kpiLoss: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "輸單原因" }), badge(`已檢討 ${reviewed} 件`)]),
    reasons.length ? h("div", { className: "stack" }, reasons.map((row) => h("div", { className: "stack" }, [h("div", { className: "section-head" }, [h("span", { text: row.reason }), h("small", { className: "muted", text: `${row.count} 件` })]), bar(row.count, max, `${row.reason} ${row.count}`)]))) : h("p", { className: "muted", text: "還沒有未成交的商機。" }),
    h("small", { className: "muted", text: "標記成交或未成交時填寫「檢討三問」，這裡的原因才會越來越準。" }),
  ]);
}

registerPage("kpi", { title: "KPI", render: renderKpi });
