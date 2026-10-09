import { createDatabase, createIndexedDbAdapter } from "./data/db.js";
import { connectSync, loadSyncConfig } from "./sync/setup.js";
import { createApp } from "./ui/app.js";
import { v3Shell } from "./ui/v3/shell.js";
import "./ui/pages/today.js";
import "./ui/pages/settings.js";
import "./ui/pages/data.js";
import "./ui/pages/customers.js";
import "./ui/pages/customer.js";
import "./ui/pages/visit.js";
import "./ui/pages/opportunities.js";
import "./ui/pages/opportunity.js";
import "./ui/pages/archive.js";
import "./ui/pages/merge.js";
import "./ui/pages/dedupe.js";
import "./ui/pages/orders.js";
import "./ui/pages/data-tools.js";
import "./ui/pages/prospects-import.js";
import "./ui/pages/sync.js";
import "./ui/pages/kpi.js";
import "./ui/pages/toolkit.js";
import "./ui/pages/lou.js";
// v3 pages register after the classic ones so "today" and "customer" use the new screens;
// every other classic page stays reachable from 更多.
import "./ui/v3/home.js";
import "./ui/v3/search.js";
import "./ui/v3/folder.js";
import "./ui/v3/capture.js";
import "./ui/v3/prep.js";
import "./ui/v3/cases.js";
import "./ui/v3/triage.js";
import "./ui/v3/appearance.js";
import "./ui/v3/plan.js";

async function start() {
  const root = document.getElementById("app");
  try {
    const db = createDatabase({ adapter: createIndexedDbAdapter(), actor: "Ocean" });
    await db.ready();
    const app = createApp({ db, root, shell: v3Shell, homePage: "today" });
    globalThis.oceanApp = app;
    const config = await loadSyncConfig(db);
    if (config) connectSync(app, config).catch(() => {});
  } catch (error) {
    root.textContent = "";
    const message = document.createElement("p");
    message.style.padding = "24px";
    message.textContent = `無法開啟本機資料庫：${error?.message || error}。請確認瀏覽器沒有使用無痕模式，或允許網站儲存資料。`;
    root.append(message);
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

start();
