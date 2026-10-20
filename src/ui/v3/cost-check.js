import { requestId } from "../../core/ids.js";
import { DEFAULT_WAGE, checkSummary, checkText, referencePrices, saveCheck, savePrices, savedChecks, testsPerUnit } from "../../data/cost-check.js";
import { searchCustomers } from "../../data/customers.js";
import { loadReference } from "../../data/line-orders.js";
import { quoteCandidates } from "../../data/quote.js";
import { badge, h, input, toast } from "../dom.js";
import { registerPage } from "../app.js";

// 檢驗成本健檢: type the customer's monthly tests, compare "now" with our products, and hand over
// a one-page report (picture or text). Typing never re-draws the page, so nothing typed is lost.
const DRAFT_META = "costCheckDraft";
const ITEMS = ["總生菌數", "大腸桿菌群", "大腸桿菌", "金黃色葡萄球菌", "沙門氏菌", "李斯特菌", "黴菌酵母菌", "腸桿菌科", "抗生素殘留", "環境採檢（EMP）"];
const view = { tab: "check", check: null, loaded: false };
let catalog = null;

export function resetCostCheckState() {
  Object.assign(view, { tab: "check", check: null, loaded: false });
  catalog = null;
}

const blankLine = () => ({ item: "", volume: "", current: { brand: "", product: "", perTest: "", confirm: "", confirmRate: "", minutes: "", days: "" }, ours: { code: "", product: "", perTest: "", confirm: "", confirmRate: "", minutes: "", days: "" } });
const newCheck = (customer = null) => ({ id: `check-${Date.now().toString(36)}`, customerId: customer?.id || "", customerName: customer?.name || "", date: new Date().toISOString().slice(0, 10), wage: DEFAULT_WAGE, lines: [blankLine()] });

const yuan = (value) => (value === null || value === undefined ? "—" : `${Math.round(value).toLocaleString("en-US")} 元`);

function persist(ctx) {
  ctx.db.setMeta(DRAFT_META, view.check).catch(() => {});
}

// One number field bound to an object key; updates the results without re-drawing the form.
function numberField(label, target, key, onChange, attrs = {}) {
  return h("label", { className: "cc-field" }, [
    h("small", { className: "muted", text: label }),
    input("", target[key] ?? "", { type: "number", min: 0, step: "any", inputmode: "decimal", ...attrs, onInput: (event) => { target[key] = event.target.value; onChange(); } }),
  ]);
}

// Bars per test item: now vs ours, per month.
function chartSvg(summary, { width = 640 } = {}) {
  const rows = summary.lines.filter((row) => row.now.total !== null || row.ours.total !== null);
  const max = Math.max(1, ...rows.flatMap((row) => [row.now.total || 0, row.ours.total || 0]));
  const left = 150; const barArea = width - left - 90; const rowHeight = 46;
  const height = rows.length * rowHeight + 30;
  const bars = rows.map((row, index) => {
    const y = 10 + index * rowHeight;
    const nowWidth = ((row.now.total || 0) / max) * barArea;
    const oursWidth = ((row.ours.total || 0) / max) * barArea;
    return `<text x="${left - 8}" y="${y + 18}" text-anchor="end" font-size="13" fill="#24333a">${escapeXml(row.line.item || "（未命名）")}</text>
      <rect x="${left}" y="${y + 4}" width="${nowWidth}" height="16" rx="3" fill="#b8c4ca"/><text x="${left + nowWidth + 6}" y="${y + 17}" font-size="12" fill="#4a5a61">${row.now.total === null ? "待確認" : yuan(row.now.total)}</text>
      <rect x="${left}" y="${y + 23}" width="${oursWidth}" height="16" rx="3" fill="#0f7f9c"/><text x="${left + oursWidth + 6}" y="${y + 36}" font-size="12" fill="#0f7f9c" font-weight="700">${row.ours.total === null ? "待確認" : yuan(row.ours.total)}</text>`;
  }).join("");
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif">${bars}<rect x="${left}" y="${height - 16}" width="12" height="10" fill="#b8c4ca"/><text x="${left + 16}" y="${height - 7}" font-size="11" fill="#4a5a61">現在（每月）</text><rect x="${left + 110}" y="${height - 16}" width="12" height="10" fill="#0f7f9c"/><text x="${left + 126}" y="${height - 7}" font-size="11" fill="#4a5a61">改用我們的方案（每月）</text></svg>`, height };
}

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
}

// The whole one-page report as one SVG, so it can become a picture for LINE.
function reportSvg(check, summary) {
  const width = 760;
  const chart = chartSvg(summary, { width: width - 40 });
  const top = 150;
  const height = top + chart.height + 120;
  const saving = summary.yearly.saving;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect width="100%" height="92" fill="#0f7f9c"/>
    <text x="24" y="40" font-size="24" font-weight="700" fill="#ffffff">檢驗成本健檢報告</text>
    <text x="24" y="70" font-size="15" fill="#e3f3f7">${escapeXml(check.customerName || "")}　${escapeXml(check.date)}　（以每月檢驗量估算，未稅）</text>
    <text x="24" y="124" font-size="15" fill="#24333a">每月 ${yuan(summary.monthly.now)} → ${yuan(summary.monthly.ours)}</text>
    <text x="${width - 24}" y="124" text-anchor="end" font-size="22" font-weight="700" fill="${saving >= 0 ? "#127a3f" : "#b4501e"}">${saving >= 0 ? "一年約省" : "一年約多"} ${yuan(Math.abs(saving))}</text>
    <g transform="translate(20 ${top})">${chart.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>
    <text x="24" y="${top + chart.height + 34}" font-size="14" fill="#24333a">${summary.hoursSaved > 0 ? `每月省 ${summary.hoursSaved} 小時人工（時薪 ${summary.wage} 元計）` : ""}</text>
    <text x="24" y="${top + chart.height + 60}" font-size="12" fill="#6b7b82">成本包含：耗材、陽性確認試驗、操作人工。數字依提供的用量與目前報價估算，實際以正式報價為準。</text>
    ${summary.incomplete.length ? `<text x="24" y="${top + chart.height + 82}" font-size="12" fill="#b4501e">${escapeXml(`${summary.incomplete.join("、")} 價格待確認，未計入`)}</text>` : ""}
  </svg>`;
}

async function svgToPng(svg) {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = image.width * 2;
  canvas.height = image.height * 2;
  const context = canvas.getContext("2d");
  context.scale(2, 2);
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(url);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function customerPicker(ctx, onPick) {
  const box = h("div", { className: "stack" });
  const results = h("div", { className: "picker-results" });
  const search = input("", "", { type: "search", placeholder: "客戶（選填）：公司名稱", "aria-label": "選客戶", dataset: { ccCustomerSearch: "" } });
  search.addEventListener("input", () => {
    const found = searchCustomers(ctx.model, { query: search.value, myAreas: ctx.settings.myAreas, limit: 6 }).items;
    results.replaceChildren(...found.map(({ customer }) => h("button", { type: "button", className: "small ghost", text: customer.name, onClick: () => onPick(customer) })));
  });
  box.append(h("div", { className: "search-box" }, [search]), results);
  return box;
}

function checkView(ctx) {
  const check = view.check;
  const prices = referencePrices(ctx.model.all).filter((row) => !row.hidden);
  const results = h("div", { className: "stack", dataset: { ccReport: "" } });
  const lineBox = h("div", { className: "stack" });

  const refresh = () => { persist(ctx); drawResults(); lineBox.querySelectorAll("[data-cc-line-result]").forEach((node, index) => { node.textContent = lineSummary(index); }); };
  const lineSummary = (index) => {
    const row = checkSummary({ ...check, lines: [check.lines[index]] }).lines[0];
    if (!row) return "";
    return `每月：現在 ${yuan(row.now.total)}・改用 ${yuan(row.ours.total)}${row.saving !== null ? `・${row.saving >= 0 ? "省" : "多"} ${yuan(Math.abs(row.saving))}` : ""}`;
  };

  function lineCard(line, index) {
    const ourResults = h("div", { className: "picker-results" });
    const ourSearch = input("", "", { type: "search", placeholder: "我們的產品：料號或品名", "aria-label": "我們的產品", dataset: { ccOurSearch: index } });
    const ourLabel = h("small", { className: "muted", dataset: { ccOurLabel: index }, text: line.ours.product ? `已選：${line.ours.product}` : "還沒選產品（也可以直接填單價）" });
    const ourPrice = numberField("每件單價（元）", line.ours, "perTest", refresh, { dataset: { ccOurPrice: index } });
    ourSearch.addEventListener("input", () => {
      if (!catalog) { ourResults.replaceChildren(h("small", { className: "muted", text: "商品清單讀取中…" })); return; }
      ourResults.replaceChildren(...quoteCandidates(catalog, ourSearch.value, 6).map((product) => h("button", {
        type: "button", className: "small ghost", text: `${product.code}｜${product.name}`,
        onClick: () => {
          const per = testsPerUnit(product.spec, product.unit);
          line.ours.code = product.code;
          line.ours.product = `${product.name}（${product.code}）`;
          // Without a pack size the list price is per box, not per test: leave it for Ocean to fill in.
          line.ours.perTest = product.listPrice && per ? Math.round((product.listPrice / per) * 100) / 100 : "";
          ourPrice.querySelector("input").value = line.ours.perTest;
          ourLabel.textContent = `已選：${line.ours.product}・定價 ${product.listPrice ?? "未填"}${product.unit ? `／${product.unit}` : ""}${per ? `，${per} 件，每件 ${line.ours.perTest} 元` : "。規格看不出一包幾件，請自己填「每件單價」"}`;
          ourPrice.querySelector("input").classList.toggle("needs-check", !per);
          ourResults.replaceChildren();
          refresh();
        },
      })));
    });
    const refSelect = h("select", { "aria-label": "帶入競品參考價", dataset: { ccRef: index }, onChange: (event) => {
      const row = prices.find((item) => item.id === event.target.value);
      if (!row) return;
      Object.assign(line.current, { brand: row.brand, product: row.product, perTest: row.perTest ?? "", confirm: row.confirm ?? "", minutes: row.minutes ?? "", days: row.days ?? "" });
      card.querySelectorAll("[data-cc-current] input[data-key]").forEach((node) => { node.value = line.current[node.dataset.key] ?? ""; });
      const brandInput = card.querySelector("[data-cc-brand]");
      if (brandInput) brandInput.value = [row.brand, row.product].filter(Boolean).join(" ");
      refresh();
    } }, [h("option", { value: "", text: "帶入競品參考價…" }), ...prices.map((row) => h("option", { value: row.id, text: `${row.brand}・${row.item || row.product || "（未填）"}${row.perTest !== null ? `・${row.perTest} 元` : ""}` }))]);
    const currentFields = [["每件單價（元）", "perTest"], ["需確認比例（%）", "confirmRate"], ["確認試驗每件（元）", "confirm"], ["每件操作（分鐘）", "minutes"], ["出結果（天）", "days"]].map(([label, key]) => {
      const node = numberField(label, line.current, key, refresh);
      node.querySelector("input").dataset.key = key;
      return node;
    });
    const card = h("article", { className: "card stack cc-line", dataset: { ccLine: index } }, [
      h("div", { className: "cc-line-head" }, [
        h("label", { className: "cc-field" }, [h("small", { className: "muted", text: "檢驗項目" }), input("", line.item, { list: "cc-items", placeholder: "例如：沙門氏菌", dataset: { ccItem: index }, onInput: (event) => { line.item = event.target.value; refresh(); } })]),
        numberField("每月檢驗量（件）", line, "volume", refresh, { dataset: { ccVolume: index } }),
        check.lines.length > 1 ? h("button", { type: "button", className: "small ghost", text: "移除這項", onClick: () => { check.lines.splice(index, 1); persist(ctx); drawLines(); drawResults(); } }) : null,
      ]),
      h("div", { className: "cc-columns" }, [
        h("section", { className: "cc-side", dataset: { ccCurrent: index } }, [
          h("strong", { text: "現在" }),
          refSelect,
          h("label", { className: "cc-field" }, [h("small", { className: "muted", text: "品牌／產品" }), input("", [line.current.brand, line.current.product].filter(Boolean).join(" "), { placeholder: "例如：3M 快檢片", dataset: { ccBrand: index }, onInput: (event) => { line.current.brand = event.target.value; line.current.product = ""; persist(ctx); } })]),
          h("div", { className: "cc-grid" }, currentFields),
        ]),
        h("section", { className: "cc-side ours" }, [
          h("strong", { text: "改用我們的方案" }),
          h("div", { className: "search-box" }, [ourSearch]), ourResults, ourLabel,
          h("div", { className: "cc-grid" }, [ourPrice, ...[["需確認比例（%）", "confirmRate"], ["確認試驗每件（元）", "confirm"], ["每件操作（分鐘）", "minutes"], ["出結果（天）", "days"]].map(([label, key]) => numberField(label, line.ours, key, refresh))]),
        ]),
      ]),
      h("p", { className: "cc-line-result", dataset: { ccLineResult: index }, text: lineSummary(index) }),
    ]);
    return card;
  }

  function drawLines() {
    lineBox.replaceChildren(...check.lines.map(lineCard), h("button", { type: "button", className: "ghost", dataset: { ccAddLine: "" }, text: "＋ 再加一個檢驗項目", onClick: () => { check.lines.push(blankLine()); persist(ctx); drawLines(); } }));
  }

  function drawResults() {
    const summary = checkSummary(check);
    const seller = "啟新生技 Ocean";
    const text = checkText(check, { customerName: check.customerName, seller });
    const chart = chartSvg(summary);
    const holder = h("div", { className: "cc-chart" });
    holder.innerHTML = chart.svg;
    results.replaceChildren(...[
      h("div", { className: "cc-totals" }, [
        h("div", {}, [h("small", { className: "muted", text: "現在每月" }), h("strong", { text: yuan(summary.monthly.now) })]),
        h("div", {}, [h("small", { className: "muted", text: "改用後每月" }), h("strong", { text: yuan(summary.monthly.ours) })]),
        h("div", { className: summary.yearly.saving >= 0 ? "good" : "bad" }, [h("small", { text: summary.yearly.saving >= 0 ? "一年約省" : "一年約多" }), h("strong", { dataset: { ccYearly: "" }, text: yuan(Math.abs(summary.yearly.saving)) })]),
        summary.hoursSaved > 0 ? h("div", {}, [h("small", { className: "muted", text: "每月省人工" }), h("strong", { text: `${summary.hoursSaved} 小時` })]) : null,
      ]),
      summary.incomplete.length ? h("p", { className: "kpi-warn", text: `${summary.incomplete.join("、")} 還有單價沒填，未計入合計。` }) : null,
      holder,
      h("details", {}, [h("summary", { text: "文字版（給 LINE）" }), h("pre", { className: "line-output", dataset: { ccText: "" }, text })]),
      h("div", { className: "button-row" }, [
        h("button", { type: "button", className: "primary", dataset: { ccImage: "" }, text: "存成圖片／分享", onClick: async () => {
          try {
            const blob = await svgToPng(reportSvg(check, summary));
            const file = new File([blob], `檢驗成本健檢-${check.customerName || "客戶"}-${check.date}.png`, { type: "image/png" });
            if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "檢驗成本健檢報告" });
            else { const link = h("a", { href: URL.createObjectURL(blob), download: file.name }); link.click(); }
          } catch { toast("圖片產生失敗，可以改用文字版", { tone: "error" }); }
        } }),
        h("button", { type: "button", className: "ghost", dataset: { ccCopy: "" }, text: "複製文字", onClick: async (event) => {
          const button = event.currentTarget;
          try { await navigator.clipboard.writeText(text); button.textContent = "已複製"; } catch { button.textContent = "請打開文字版長按複製"; }
          setTimeout(() => { button.textContent = "複製文字"; }, 1500);
        } }),
        h("button", { type: "button", className: "ghost", dataset: { ccSave: "" }, text: "存這次健檢", onClick: async () => {
          const result = await saveCheck(ctx.db, ctx.model.all, { ...check, savedAt: new Date().toISOString() }, requestId("cost-check"));
          toast(result?.ok === false ? "沒有存成功，請再試一次" : "已存，客戶頁和這裡都看得到", { tone: result?.ok === false ? "error" : "ok" });
        } }),
      ]),
    ].filter(Boolean));
  }

  const wage = numberField("人工時薪（元，用來換算人力成本）", check, "wage", refresh, { dataset: { ccWage: "" } });
  const customerRow = check.customerName
    ? h("div", { className: "button-row" }, [badge(`客戶：${check.customerName}`, "accent"), h("button", { type: "button", className: "small ghost", text: "換客戶", onClick: () => { check.customerId = ""; check.customerName = ""; persist(ctx); ctx.render(); } })])
    : customerPicker(ctx, (customer) => { check.customerId = customer.id; check.customerName = customer.name; persist(ctx); ctx.render(); });
  const history = check.customerId ? savedChecks(ctx.model.all, check.customerId) : [];

  drawLines();
  drawResults();
  return h("div", { className: "stack" }, [
    h("section", { className: "card stack" }, [
      customerRow,
      h("div", { className: "button-row" }, [wage, h("button", { type: "button", className: "small ghost", text: "重新開始", onClick: () => { view.check = newCheck(); persist(ctx); ctx.render(); } })]),
      history.length ? h("details", {}, [h("summary", { text: `這位客戶之前的健檢（${history.length}）` }), h("ul", { className: "result-rows" }, history.map((saved) => h("li", {}, [h("button", { type: "button", className: "link-button", text: `${saved.date}・${saved.lines.map((line) => line.item).filter(Boolean).join("、")}`, onClick: () => { view.check = structuredClone(saved); persist(ctx); ctx.render(); } })])))]) : null,
    ]),
    h("datalist", { id: "cc-items" }, ITEMS.map((value) => h("option", { value }))),
    lineBox,
    h("section", { className: "card stack" }, [h("h2", { text: "健檢結果" }), results]),
  ]);
}

function pricesView(ctx) {
  const rows = referencePrices(ctx.model.all).map((row) => ({ ...row }));
  const table = h("div", { className: "stack" });
  const draw = () => table.replaceChildren(...rows.map((row, index) => h("article", { className: `card cc-price${row.hidden ? " is-hidden" : ""}`, dataset: { ccPrice: row.id } }, [
    h("div", { className: "cc-grid" }, [
      ...[["品牌", "brand"], ["檢驗項目", "item"], ["產品", "product"]].map(([label, key]) => h("label", { className: "cc-field" }, [h("small", { className: "muted", text: label }), input("", row[key] || "", { onInput: (event) => { row[key] = event.target.value; } })])),
      ...[["每件單價（元）", "perTest"], ["確認試驗每件（元）", "confirm"], ["每件操作（分鐘）", "minutes"], ["出結果（天）", "days"]].map(([label, key]) => numberField(label, row, key, () => {})),
    ]),
    h("label", { className: "cc-field" }, [h("small", { className: "muted", text: "資料來源（誰說的、哪一天）" }), input("", row.source || "", { onInput: (event) => { row.source = event.target.value; } })]),
    h("button", { type: "button", className: "small ghost", text: row.hidden ? "重新顯示" : "不用這筆（隱藏）", onClick: () => { rows[index].hidden = !row.hidden; draw(); } }),
  ])));
  draw();
  return h("div", { className: "stack" }, [
    h("p", { className: "muted", text: "這份參考價只存在你的 App 裡。每次從客戶或拜訪聽到新價格，記在這裡，並寫上來源；做健檢時可以一鍵帶入。" }),
    table,
    h("div", { className: "button-row" }, [
      h("button", { type: "button", className: "ghost", text: "＋ 新增一筆", onClick: () => { rows.push({ id: `ref-${Date.now().toString(36)}`, brand: "", item: "", product: "", perTest: null, confirm: null, minutes: null, days: null, source: "" }); draw(); } }),
      h("button", { type: "button", className: "primary", dataset: { ccSavePrices: "" }, text: "存參考價", onClick: async () => {
        const result = await savePrices(ctx.db, rows, requestId("cost-prices"));
        toast(result?.ok === false ? "沒有存成功，請再試一次" : "參考價已存");
      } }),
    ]),
  ]);
}

export function renderCostCheck(ctx, route) {
  const customerId = route?.query?.get?.("customer");
  if (!view.loaded) {
    view.loaded = true;
    ctx.db.getMeta(DRAFT_META, null).then((draft) => { if (draft && !view.check?.lines?.some((line) => line.item || line.volume) && !customerId) { view.check = draft; ctx.render(); } }).catch(() => {});
  }
  if (customerId && view.check?.customerId !== customerId) {
    const customer = ctx.model.customersById.get(customerId);
    view.check = newCheck(customer);
  }
  if (!view.check) view.check = newCheck();
  if (!catalog) loadReference(ctx.db).then((loaded) => { catalog = loaded.reference; }).catch(() => {});

  const tabs = h("div", { className: "tabs", role: "tablist" }, [["check", "做健檢"], ["prices", "競品參考價"]].map(([value, label]) => h("button", {
    type: "button", className: "button small ghost", role: "tab", "aria-selected": String(view.tab === value), dataset: { ccTab: value }, text: label, onClick: () => { view.tab = value; ctx.render(); },
  })));
  return h("div", { className: "stack cost-check" }, [
    h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "檢驗成本健檢" }), h("p", { text: "算給客戶看：每月檢驗花多少、改用我們的方案省多少錢和人力、快幾天出結果。" })])]),
    tabs,
    view.tab === "prices" ? pricesView(ctx) : checkView(ctx),
  ]);
}

registerPage("costcheck", { title: "成本健檢", render: renderCostCheck, keepOnDataChange: true });
