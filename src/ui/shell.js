import { h, openDialog } from "./dom.js";

export const NAV_ITEMS = Object.freeze([
  { name: "today", label: "今日", icon: "◎" },
  { name: "customers", label: "客戶", icon: "◇" },
  { name: "visit", label: "記錄拜訪", icon: "＋", primary: true },
  { name: "opportunities", label: "商機", icon: "△" },
  { name: "orders", label: "訂單", icon: "▢" },
  { name: "kpi", label: "KPI", icon: "▤" },
  { name: "toolkit", label: "裝備庫", icon: "✦" },
  { name: "archive", label: "封存與復原", icon: "↺" },
  { name: "sync", label: "同步中心", icon: "⇅" },
  { name: "data", label: "資料工具", icon: "⤓" },
  { name: "settings", label: "設定", icon: "⚙" },
]);

const MOBILE_MAIN = ["today", "customers", "visit", "opportunities"];

function navLink(item, current) {
  return h("a", {
    href: `#/${item.name}`, className: `nav-link${item.primary ? " nav-primary" : ""}`,
    "aria-current": current === item.name ? "page" : null, dataset: { nav: item.name },
  }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: item.icon }), h("span", { className: "nav-text", text: item.label })]);
}

function openMoreMenu() {
  const items = NAV_ITEMS.filter((item) => !MOBILE_MAIN.includes(item.name));
  openDialog((close) => h("nav", { className: "sheet-body more-menu", "aria-label": "更多功能" }, [
    h("h2", { text: "更多功能" }),
    h("div", { className: "more-grid" }, items.map((item) => {
      const link = navLink(item, "");
      link.addEventListener("click", () => close());
      return link;
    })),
  ]), { label: "更多功能" });
}

export function renderShell(ctx) {
  return h("div", { className: "shell" }, [
    h("a", { className: "skip-link", href: "#page", text: "跳到主要內容" }),
    h("aside", { className: "sidebar" }, [
      h("div", { className: "brand" }, [h("span", { className: "brand-mark", text: "O" }), h("div", {}, [h("strong", { text: "Ocean" }), h("small", { text: "個人業務助理" })])]),
      h("nav", { className: "side-nav", "aria-label": "主要功能", dataset: { sideNav: "" } }),
      h("div", { className: "sidebar-foot", dataset: { syncSlot: "side" } }),
    ]),
    h("header", { className: "topbar" }, [
      h("strong", { className: "topbar-title", dataset: { topTitle: "" }, text: "今日" }),
      h("div", { dataset: { syncSlot: "top" } }),
    ]),
    h("main", { id: "page", className: "page", tabindex: "-1" }),
    h("nav", { className: "bottom-nav", "aria-label": "主要功能（手機）", dataset: { bottomNav: "" } }),
  ]);
}

export function syncBadge(ctx) {
  const state = ctx.syncState || { state: "synced", label: "已同步" };
  const transport = state.transport;
  const offline = transport?.online === false;
  // Without a connection nothing is "synced": say plainly that data lives on this device only.
  const localOnly = transport?.configured === false;
  const unsent = (state.counts?.pending || 0) + (state.counts?.failed || 0);
  const label = offline ? `離線・${state.counts?.pending ? `${state.counts.pending} 筆待上傳` : "本機可用"}` : localOnly ? `僅存本機${unsent ? `・${unsent} 筆` : ""}` : state.label;
  return h("a", { href: "#/sync", className: `sync-badge sync-${offline ? "offline" : localOnly ? "pending" : state.state}`, dataset: { syncState: state.state }, "aria-label": `同步狀態：${label}` }, [h("i", { "aria-hidden": "true" }), h("span", { text: label })]);
}

export function updateShell(root, ctx, page) {
  const current = ctx.route.name;
  root.querySelector("[data-side-nav]")?.replaceChildren(...NAV_ITEMS.map((item) => navLink(item, current)));
  const bottom = root.querySelector("[data-bottom-nav]");
  if (bottom) {
    const more = h("button", { type: "button", className: `nav-link${MOBILE_MAIN.includes(current) ? "" : " is-active"}`, dataset: { nav: "more" }, onClick: openMoreMenu }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: "⋯" }), h("span", { className: "nav-text", text: "更多" })]);
    bottom.replaceChildren(...NAV_ITEMS.filter((item) => MOBILE_MAIN.includes(item.name)).map((item) => navLink(item, current)), more);
  }
  const title = root.querySelector("[data-top-title]");
  if (title) title.textContent = page?.title || "Ocean";
  root.querySelectorAll("[data-sync-slot]").forEach((slot) => slot.replaceChildren(syncBadge(ctx)));
}

export function pageHeader(title, subtitle = "", actions = []) {
  return h("header", { className: "page-header" }, [
    h("div", {}, [h("h1", { text: title }), subtitle ? h("p", { text: subtitle }) : null]),
    actions.length ? h("div", { className: "page-actions" }, actions) : null,
  ]);
}
