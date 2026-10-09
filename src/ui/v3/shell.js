import { h, openDialog } from "../dom.js";
import { syncBadge } from "../shell.js";

// v3 frame: action first. Phones get a bottom bar with the four things done every day;
// everything else lives under 更多. Desktops get the same items in a side bar.
export const MAIN_ITEMS = Object.freeze([
  { name: "today", label: "今天", icon: "◎" },
  { name: "search", label: "搜尋", icon: "⌕" },
  { name: "capture", label: "記錄", icon: "＋", primary: true },
  { name: "cases", label: "案子", icon: "△" },
]);

export const MORE_ITEMS = Object.freeze([
  { name: "plan", label: "開發計畫", icon: "➚" },
  { name: "customers", label: "客戶探索", icon: "◇" },
  { name: "opportunities", label: "商機清單", icon: "▦" },
  { name: "orders", label: "訂單與首購", icon: "▢" },
  { name: "kpi", label: "KPI", icon: "▤" },
  { name: "toolkit", label: "裝備庫", icon: "✦" },
  { name: "dedupe", label: "整理同名客戶", icon: "⧉" },
  { name: "archive", label: "封存與復原", icon: "↺" },
  { name: "sync", label: "同步中心", icon: "⇅" },
  { name: "data", label: "資料工具", icon: "⤓" },
  { name: "settings", label: "設定", icon: "⚙" },
]);

// Which main tab a page belongs to, so the bar stays lit on detail pages.
const SECTION_OF = { customer: "search", prep: "today", triage: "today", visit: "capture", case: "cases", opportunity: "cases" };

function navLink(item, current) {
  return h("a", {
    href: `#/${item.name}`, className: `nav-link${item.primary ? " nav-primary" : ""}`,
    "aria-current": current === item.name ? "page" : null, dataset: { nav: item.name },
  }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: item.icon }), h("span", { className: "nav-text", text: item.label })]);
}

function classicLink() {
  return h("a", { className: "nav-link", href: "./classic.html", dataset: { nav: "classic" } }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: "⇠" }), h("span", { className: "nav-text", text: "舊版畫面" })]);
}

function openMoreMenu() {
  openDialog((close) => h("nav", { className: "sheet-body more-menu", "aria-label": "更多功能" }, [
    h("h2", { text: "更多" }),
    h("div", { className: "more-grid" }, [...MORE_ITEMS.map((item) => {
      const link = navLink(item, "");
      link.addEventListener("click", () => close());
      return link;
    }), classicLink()]),
  ]), { label: "更多功能" });
}

export function renderShell() {
  return h("div", { className: "shell v3" }, [
    h("a", { className: "skip-link", href: "#page", text: "跳到主要內容" }),
    h("aside", { className: "sidebar" }, [
      h("div", { className: "brand" }, [h("span", { className: "brand-mark", text: "O" }), h("div", {}, [h("strong", { text: "Ocean" }), h("small", { text: "個人業務助理" })])]),
      h("nav", { className: "side-nav", "aria-label": "主要功能", dataset: { sideNav: "" } }),
      h("div", { className: "sidebar-foot", dataset: { syncSlot: "side" } }),
    ]),
    h("header", { className: "topbar" }, [
      h("strong", { className: "topbar-title", dataset: { topTitle: "" }, text: "今天" }),
      h("div", { className: "topbar-actions" }, [
        h("a", { className: "icon-button", href: "#/search", "aria-label": "搜尋", dataset: { topSearch: "" }, text: "⌕" }),
        h("div", { dataset: { syncSlot: "top" } }),
      ]),
    ]),
    h("main", { id: "page", className: "page", tabindex: "-1" }),
    h("nav", { className: "bottom-nav", "aria-label": "主要功能（手機）", dataset: { bottomNav: "" } }),
  ]);
}

export function updateShell(root, ctx, page) {
  const current = SECTION_OF[ctx.route.name] || ctx.route.name;
  root.querySelector("[data-side-nav]")?.replaceChildren(
    ...MAIN_ITEMS.map((item) => navLink(item, current)),
    h("hr"),
    ...MORE_ITEMS.map((item) => navLink(item, current)),
    classicLink(),
  );
  const bottom = root.querySelector("[data-bottom-nav]");
  if (bottom) {
    const inMore = !MAIN_ITEMS.some((item) => item.name === current);
    const more = h("button", { type: "button", className: `nav-link${inMore ? " is-active" : ""}`, dataset: { nav: "more" }, onClick: openMoreMenu }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: "⋯" }), h("span", { className: "nav-text", text: "更多" })]);
    bottom.replaceChildren(...MAIN_ITEMS.map((item) => navLink(item, current)), more);
  }
  const title = root.querySelector("[data-top-title]");
  if (title) title.textContent = page?.title || "Ocean";
  root.querySelectorAll("[data-sync-slot]").forEach((slot) => slot.replaceChildren(syncBadge(ctx)));
}

export const v3Shell = { renderShell, updateShell };
