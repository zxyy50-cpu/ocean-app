import { h, openDialog } from "../dom.js";
import { syncBadge } from "../shell.js";

// v3 frame: action first. Phones get a bottom bar with the five things done every day;
// everything else lives under 更多 as five groups. Desktops get the same items in a side bar.
export const MAIN_ITEMS = Object.freeze([
  { name: "today", label: "今天", icon: "◎" },
  { name: "search", label: "搜尋", icon: "⌕" },
  { name: "capture", label: "記錄", icon: "＋", primary: true },
  { name: "line-order", label: "訂單", icon: "✉" },
  { name: "cases", label: "案子", icon: "△" },
]);

export const MORE_ITEMS = Object.freeze([
  { name: "plan", label: "客戶開發", icon: "➚" },
  { name: "kpi", label: "KPI", icon: "▤" },
  { name: "toolkit", label: "裝備庫", icon: "✦" },
  { name: "dedupe", label: "資料整理", icon: "⧉" },
  { name: "settings", label: "設定", icon: "⚙" },
]);

// Pages that belong together share one entry and show tabs between them; old links keep working.
export const PAGE_GROUPS = Object.freeze([
  { name: "line-order", tabs: [["line-order", "LINE 訂單"], ["orders", "全部訂單與新購提醒"]] },
  { name: "cases", tabs: [["cases", "要注意的案子"], ["tidy", "商機整理"], ["opportunities", "完整清單"]] },
  { name: "plan", tabs: [["plan", "開發計畫"], ["costcheck", "成本健檢"], ["customers", "客戶探索"]] },
  { name: "dedupe", tabs: [["dedupe", "整理同名客戶"], ["archive", "封存與復原"], ["data", "資料工具"]] },
  { name: "settings", tabs: [["settings", "設定與外觀"], ["sync", "同步中心"], ["classic", "舊版畫面"]] },
]);

// Which main tab a page belongs to, so the bar stays lit on detail pages.
const SECTION_OF = {
  customer: "search", prep: "today", triage: "today", visit: "capture", case: "cases", opportunity: "cases",
  ...Object.fromEntries(PAGE_GROUPS.flatMap((group) => group.tabs.map(([page]) => [page, group.name]))),
};

export function groupOf(pageName) {
  return PAGE_GROUPS.find((group) => group.tabs.some(([page]) => page === pageName)) || null;
}

function navLink(item, current) {
  return h("a", {
    href: `#/${item.name}`, className: `nav-link${item.primary ? " nav-primary" : ""}`,
    "aria-current": current === item.name ? "page" : null, dataset: { nav: item.name },
  }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: item.icon }), h("span", { className: "nav-text", text: item.label })]);
}

function groupTabs(pageName) {
  const group = groupOf(pageName);
  if (!group) return [];
  return [h("nav", { className: "tabs group-tabs", "aria-label": "這一區的頁面", dataset: { groupTabs: group.name } }, group.tabs.map(([page, label]) => h("a", {
    href: page === "classic" ? "./classic.html" : `#/${page}`, className: "button small ghost", dataset: { groupTab: page },
    "aria-current": page === pageName ? "page" : null, "aria-selected": String(page === pageName), text: label,
  })))];
}

function openMoreMenu() {
  openDialog((close) => h("nav", { className: "sheet-body more-menu", "aria-label": "更多功能" }, [
    h("h2", { text: "更多" }),
    h("div", { className: "more-grid" }, MORE_ITEMS.map((item) => {
      const link = navLink(item, "");
      link.addEventListener("click", () => close());
      return link;
    })),
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
    h("div", { className: "signin-slot", dataset: { signinSlot: "" } }),
    h("div", { className: "group-tab-slot", dataset: { groupTabSlot: "" } }),
    h("main", { id: "page", className: "page", tabindex: "-1" }),
    h("nav", { className: "bottom-nav", "aria-label": "主要功能（手機）", dataset: { bottomNav: "" } }),
  ]);
}

// When Google's silent sign-in did not work, one visible button instead of hidden pop-ups.
function updateSignIn(root, ctx) {
  const slot = root.querySelector("[data-signin-slot]");
  if (!slot) return;
  if (!ctx.auth?.needsClick?.()) { slot.replaceChildren(); return; }
  if (slot.querySelector("[data-signin-banner]")) return;
  const button = h("div", { dataset: { signinButton: "" } });
  slot.replaceChildren(h("div", { className: "warning-banner", dataset: { signinBanner: "" } }, [
    h("span", { text: "Google 登入已過期，同步和 LINE 訂單暫停。按右邊登入後會自動繼續。" }), button,
  ]));
  ctx.auth.renderButton?.(button).catch(() => {});
}

export function updateShell(root, ctx, page) {
  const current = SECTION_OF[ctx.route.name] || ctx.route.name;
  root.querySelector("[data-side-nav]")?.replaceChildren(
    ...MAIN_ITEMS.map((item) => navLink(item, current)),
    h("hr"),
    ...MORE_ITEMS.map((item) => navLink(item, current)),
  );
  const bottom = root.querySelector("[data-bottom-nav]");
  if (bottom) {
    const inMore = !MAIN_ITEMS.some((item) => item.name === current);
    const more = h("button", { type: "button", className: `nav-link${inMore ? " is-active" : ""}`, dataset: { nav: "more" }, onClick: openMoreMenu }, [h("span", { className: "nav-icon", "aria-hidden": "true", text: "⋯" }), h("span", { className: "nav-text", text: "更多" })]);
    bottom.replaceChildren(...MAIN_ITEMS.map((item) => navLink(item, current)), more);
  }
  root.querySelector("[data-group-tab-slot]")?.replaceChildren(...groupTabs(ctx.route.name));
  updateSignIn(root, ctx);
  const title = root.querySelector("[data-top-title]");
  if (title) title.textContent = page?.title || "Ocean";
  root.querySelectorAll("[data-sync-slot]").forEach((slot) => slot.replaceChildren(syncBadge(ctx)));
}

export const v3Shell = { renderShell, updateShell };
