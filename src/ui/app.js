import { toDateOnly } from "../core/dates.js";
import { buildModel } from "../data/model.js";
import { readSetting } from "../data/settings.js";
import { normalizeToolkit } from "../data/toolkit.js";
import { h } from "./dom.js";
import { renderShell, updateShell } from "./shell.js";

const pages = new Map();

export function registerPage(name, definition) {
  pages.set(name, definition);
}

export function parseHash(hash = "", home = "today") {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const [path, queryString = ""] = raw.split("?");
  const [name = "today", id = ""] = path.split("/").map(decodeURIComponent);
  return { name: name || "today", id, query: new URLSearchParams(queryString) };
}

export function syncSummary(all) {
  const counts = { pending: 0, failed: 0, conflict: 0 };
  Object.values(all).flat().forEach((record) => {
    if (record.syncStatus === "pending") counts.pending += 1;
    else if (record.syncStatus === "failed") counts.failed += 1;
    else if (record.syncStatus === "conflict") counts.conflict += 1;
  });
  if (counts.conflict) return { state: "conflict", label: `資料衝突 ${counts.conflict}`, counts };
  if (counts.failed) return { state: "failed", label: `同步失敗 ${counts.failed}`, counts };
  if (counts.pending) return { state: "pending", label: `等待同步 ${counts.pending}`, counts };
  return { state: "synced", label: "已同步", counts };
}

// `shell` lets a different frame (navigation, header) wrap the same pages and data;
// `homePage` is where an empty or unknown route lands.
export function createApp({ db, root = document.getElementById("app"), today = () => toDateOnly(new Date()), sync = null, window: win = globalThis.window, shell = { renderShell, updateShell }, homePage = "today" } = {}) {
  const ctx = {
    db, sync, today, model: null, settings: {}, route: parseHash(win?.location?.hash, homePage), homePage,
    reference: { toolkit: [], kpis: [] }, toolkit: [],
    async loadReference() {
      ctx.reference = await db.getMeta("reference", { toolkit: [], kpis: [] }) || { toolkit: [], kpis: [] };
      ctx.toolkit = normalizeToolkit(ctx.reference.toolkit || []);
    },
    navigate(path) {
      const target = path.startsWith("#") ? path : `#/${path}`;
      if (win.location.hash === target) ctx.render();
      else win.location.hash = target;
    },
    rebuild() {
      const all = db.peekAll();
      ctx.model = buildModel(all);
      ctx.settings = { myAreas: readSetting(all, "myAreas"), visitOptions: readSetting(all, "visitOptions") };
      ctx.syncState = syncSummary(all);
      ctx.syncState = { ...ctx.syncState, transport: ctx.sync?.status ? ctx.sync.status() : { configured: false } };
    },
    setSync(client) {
      ctx.sync?.stop?.();
      ctx.sync = client;
      ctx.refreshChrome();
    },
    refreshChrome() {
      ctx.rebuild();
      shell.updateShell(root, ctx, pages.get(ctx.route.name));
    },
    render() {
      ctx.rebuild();
      const page = pages.get(ctx.route.name) || pages.get(homePage);
      const container = root.querySelector("#page");
      shell.updateShell(root, ctx, page);
      const content = page ? page.render(ctx, ctx.route) : h("p", { text: "找不到頁面" });
      container.replaceChildren(content);
      container.dataset.page = ctx.route.name;
      if (page?.title && win?.document) win.document.title = `${page.title}｜Ocean 業務助理`;
    },
  };

  root.replaceChildren(shell.renderShell(ctx));
  let pendingRefresh = null;
  db.onChange(() => {
    const page = pages.get(ctx.route.name);
    if (pendingRefresh) return;
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null;
      // Never wipe a form the user is typing in; only refresh the chrome around it.
      const editing = root.querySelector("#page form[data-dirty]");
      if (page?.keepOnDataChange || editing) { ctx.rebuild(); shell.updateShell(root, ctx, page); return; }
      ctx.render();
    }, 30);
  });
  root.addEventListener("input", (event) => {
    const form = event.target?.closest?.("#page form");
    if (form && !event.target.matches?.('[type="search"]')) form.setAttribute("data-dirty", "");
  });
  win?.addEventListener?.("hashchange", () => {
    ctx.route = parseHash(win.location.hash, homePage);
    ctx.render();
    root.querySelector("#page")?.focus?.({ preventScroll: true });
    win.scrollTo?.(0, 0);
  });
  ctx.render();
  ctx.ready = ctx.loadReference().then(() => { if (ctx.reference.toolkit?.length || ctx.reference.kpis?.length) ctx.render(); }).catch(() => {});
  return ctx;
}
