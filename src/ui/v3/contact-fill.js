import { requestId } from "../../core/ids.js";
import { addContacts, contactSuggestions, fillableCustomers, parseContactText } from "../../data/contact-fill.js";
import { forgetReference, loadReference } from "../../data/line-orders.js";
import { loadDirectory, parseDirectory, renameToShortNames, saveDirectory, shortNameChanges } from "../../data/customer-directory.js";
import { confirmDialog, h, openDialog, toast } from "../dom.js";
import { registerDataSection } from "../pages/data.js";

const describe = (contact) => [contact.title, contact.department, contact.mobile, contact.phone, contact.email].filter(Boolean).join("・");

// Ticked rows, all on by default; returns the box and a getter for what is still ticked.
function pickRows(people, { address = false } = {}) {
  const ticked = new Set(people.map((_, index) => index));
  const list = h("ul", { className: "task-list" }, people.map((person, index) => h("li", { className: "task-row pickable" }, [
    h("label", { className: "pick-box", "aria-label": `勾選 ${person.name}` }, [h("input", { type: "checkbox", checked: true, onChange: (event) => { if (event.target.checked) ticked.add(index); else ticked.delete(index); } })]),
    h("div", { className: "task-main" }, [
      h("strong", { text: person.name }),
      h("small", { className: "muted", text: [describe(person), address ? person.address : "", person.notes].filter(Boolean).join("・") || "只有名字" }),
    ]),
  ])));
  return { list, picked: () => people.filter((_, index) => ticked.has(index)) };
}

// On the 聯絡人 tab: what the company 客戶資料 sheet knows about this customer number, one tap to add.
export function contactFillSlot(ctx, customer) {
  const slot = h("div", { className: "stack", dataset: { contactFill: "" } });
  const pasteButton = h("button", { type: "button", className: "small ghost", dataset: { contactPaste: "" }, text: "從 ERP 貼上聯絡人", onClick: () => openPasteContacts(ctx, customer) });
  slot.append(h("div", { className: "button-row" }, [pasteButton]));
  loadReference(ctx.db).then(({ reference }) => {
    const found = contactSuggestions(ctx.model, reference, customer);
    if (!found.contacts.length && !found.phone && !found.address) return;
    const rows = pickRows(found.contacts);
    const fills = [found.phone ? `電話 ${found.phone}` : "", found.address ? `地址 ${found.address}` : ""].filter(Boolean);
    slot.prepend(h("div", { className: "info-banner stack", dataset: { contactSuggest: "" } }, [
      h("strong", { text: `公司客戶資料（#${customer.customerNo}）有這些，勾選後一次加入：` }),
      found.contacts.length ? rows.list : null,
      fills.length ? h("small", { text: `也會補上空著的${fills.join("、")}` }) : null,
      h("div", { className: "button-row" }, [h("button", { type: "button", className: "small primary", dataset: { contactSuggestAdd: "" }, text: "加入", onClick: async () => {
        const result = await addContacts(ctx.db, ctx.model, customer, { contacts: rows.picked(), phone: found.phone, address: found.address }, requestId("contact-fill"));
        toast(result.ok ? `已加入 ${result.added} 位聯絡人${result.filled.length ? `，補上${result.filled.join("、")}` : ""}` : "加入失敗，沒有任何變更", { tone: result.ok ? "ok" : "error" });
      } })]),
    ]));
  }).catch(() => {});
  return slot;
}

// Copy the rows out of the ERP 聯絡人 grid (or type them), check the preview, add.
export function openPasteContacts(ctx, customer) {
  openDialog((close) => {
    const area = h("textarea", { rows: 6, placeholder: "在 ERP 聯絡人表選取那幾列，按 Ctrl+C，再貼到這裡。\n也可以自己打：王大明 老師 0912345678 (08)7701234#100", "aria-label": "貼上聯絡人", dataset: { contactPasteText: "" } });
    const preview = h("div", { className: "stack", "aria-live": "polite" });
    let rows = null;
    const draw = () => {
      const people = parseContactText(area.value);
      rows = people.length ? pickRows(people, { address: true }) : null;
      preview.replaceChildren(area.value.trim() ? (rows ? h("div", { className: "stack" }, [h("small", { className: "muted", text: `看到 ${people.length} 位，請確認名字和電話對不對：` }), rows.list]) : h("p", { className: "field-error", text: "看不出聯絡人姓名，請確認有貼到「聯絡人」那一欄" })) : "");
    };
    area.addEventListener("input", draw);
    return h("div", { className: "sheet-body" }, [
      h("h2", { text: `貼上聯絡人：${customer.name}` }),
      area,
      preview,
      h("div", { className: "sheet-actions" }, [
        h("button", { type: "button", className: "ghost", text: "取消", onClick: close }),
        h("button", { type: "button", className: "primary", dataset: { contactPasteAdd: "" }, text: "加入", onClick: async () => {
          const people = rows?.picked() || [];
          if (!people.length) { toast("沒有可以加入的聯絡人", { tone: "error" }); return; }
          const result = await addContacts(ctx.db, ctx.model, customer, { contacts: people }, requestId("contact-paste"));
          toast(result.ok ? `已加入 ${result.added} 位聯絡人${result.added < people.length ? `（${people.length - result.added} 位已經有了）` : ""}${result.filled.length ? `，補上${result.filled.join("、")}` : ""}` : "加入失敗，沒有任何變更", { tone: result.ok ? "ok" : "error" });
          if (result.ok) close();
        } }),
      ]),
    ]);
  }, { label: "貼上聯絡人" });
}

// 資料工具: fill every customer the 客戶資料 sheet can, after showing how many.
function bulkFillCard(ctx) {
  const region = h("div", { className: "stack", "aria-live": "polite" });
  const button = h("button", { type: "button", className: "primary", dataset: { contactBulk: "" }, text: "檢查可以補的客戶", onClick: async () => {
    const { reference } = await loadReference(ctx.db);
    if (!reference.customers?.size) { region.replaceChildren(h("p", { className: "field-error", text: "還沒有客戶資料：先在上面貼上「客戶資料」分頁，或到 LINE 訂單頁按「更新資料」" })); return; }
    const entries = fillableCustomers(ctx.model, reference);
    if (!entries.length) { region.replaceChildren(h("p", { className: "muted", text: "公司客戶資料沒有可以再補的了。其他客戶請在客戶頁用「從 ERP 貼上聯絡人」。" })); return; }
    const people = entries.reduce((sum, entry) => sum + entry.contacts.length, 0);
    const phones = entries.filter((entry) => entry.phone).length;
    const addresses = entries.filter((entry) => entry.address).length;
    const ok = await confirmDialog({
      title: `從公司客戶資料補 ${entries.length} 位客戶？`,
      body: [
        h("p", { text: `會加入 ${people} 位聯絡人，補上 ${phones} 個電話、${addresses} 個地址。只補空著的，已經填的不會改；之後也可以在客戶頁封存不要的聯絡人。` }),
        h("ul", {}, entries.slice(0, 8).map((entry) => h("li", { text: `${entry.customer.name}：${[...entry.contacts.map((contact) => contact.name), entry.phone ? "電話" : "", entry.address ? "地址" : ""].filter(Boolean).join("、")}` }))),
        entries.length > 8 ? h("p", { className: "muted", text: `…還有 ${entries.length - 8} 位` }) : null,
      ],
      confirmLabel: "全部補上",
    });
    if (!ok) return;
    let added = 0; let failed = 0;
    for (const entry of entries) {
      const result = await addContacts(ctx.db, ctx.model, entry.customer, entry, requestId("contact-bulk"));
      if (result.ok) added += result.added; else failed += 1;
    }
    region.replaceChildren(h("p", { className: failed ? "field-error" : "ok-text", text: `補好了：加入 ${added} 位聯絡人${failed ? `，${failed} 位客戶沒有成功` : ""}。` }));
  } });
  return h("section", { className: "card form-card", dataset: { contactBulkCard: "" } }, [
    h("h2", { text: "補齊客戶聯絡人" }),
    h("p", { className: "muted", text: "用客戶編號對公司「客戶資料」試算表，把還沒有聯絡人、電話或地址的客戶一次補上。會先告訴你補幾筆。" }),
    button,
    region,
  ]);
}

// 資料工具: paste the 「Ocean 客戶資料」 客戶資料 tab so the app knows every 簡稱 and contact.
function directoryCard(ctx) {
  const status = h("p", { className: "muted", dataset: { directoryStatus: "" } });
  const showSaved = (saved) => { status.textContent = saved?.rows?.length ? `已有 ${saved.rows.length} 位客戶的簡稱與聯絡人（${String(saved.loadedAt).slice(0, 10)} 貼上）。試算表有改時再貼一次就會更新。` : "還沒貼過。"; };
  loadDirectory(ctx.db).then(showSaved).catch(() => {});
  const region = h("div", { className: "stack", "aria-live": "polite" });
  const area = h("textarea", { rows: 4, placeholder: "打開「Ocean 客戶資料」→「客戶資料」分頁，點任一格後按 ⌘A 全選、⌘C 複製，再貼到這裡", "aria-label": "貼上客戶資料", dataset: { directoryText: "" } });
  area.addEventListener("input", () => {
    const parsed = parseDirectory(area.value);
    if (!area.value.trim()) { region.replaceChildren(); return; }
    if (!parsed.ok) { region.replaceChildren(h("p", { className: "field-error", text: parsed.message })); return; }
    const known = new Set(ctx.model.customers.filter((customer) => !customer.archivedAt).map((customer) => String(customer.customerNo || "")));
    const matched = parsed.rows.filter((row) => row.numbers.some((no) => known.has(no))).length;
    const withShort = parsed.rows.filter((row) => row.shortName).length;
    region.replaceChildren(
      h("p", { text: `讀到 ${parsed.rows.length} 位客戶（${withShort} 位有簡稱），其中 ${matched} 位對得上 App 裡的客戶編號。` }),
      h("ul", {}, parsed.rows.slice(0, 5).map((row) => h("li", { text: `${row.numbers.join("／")}　${row.shortName || row.fullName}${row.contact ? `・${row.contact}` : ""}` }))),
      h("button", { type: "button", className: "primary", dataset: { directorySave: "" }, text: "儲存", onClick: async () => {
        const saved = await saveDirectory(ctx.db, parsed.rows);
        forgetReference();
        area.value = "";
        region.replaceChildren(h("p", { className: "ok-text", text: `已儲存。搜尋和客戶頁會顯示簡稱；要補聯絡人請按下面的「檢查可以補的客戶」。` }));
        showSaved(saved);
      } }),
    );
  });
  const renameRegion = h("div", { className: "stack", "aria-live": "polite" });
  const renameButton = h("button", { type: "button", className: "ghost", dataset: { directoryRename: "" }, text: "客戶名稱改成簡稱", onClick: async () => {
    const changes = shortNameChanges(ctx.model, await loadDirectory(ctx.db));
    if (!changes.length) { renameRegion.replaceChildren(h("p", { className: "muted", text: "沒有要改的：先貼上客戶資料，或名稱已經都是簡稱了。" })); return; }
    const ok = await confirmDialog({
      title: `把 ${changes.length} 位客戶的名稱改成簡稱？`,
      body: [
        h("p", { text: "原本的名稱會留作別名，用舊名稱搜尋一樣找得到；之後也可以在客戶頁「編輯」改回來。" }),
        h("ul", {}, changes.slice(0, 8).map((change) => h("li", { text: `${change.from} → ${change.to}（#${change.customer.customerNo}）` }))),
        changes.length > 8 ? h("p", { className: "muted", text: `…還有 ${changes.length - 8} 位` }) : null,
      ],
      confirmLabel: "全部改成簡稱",
    });
    if (!ok) return;
    const result = await renameToShortNames(ctx.db, changes, requestId("rename-short"));
    renameRegion.replaceChildren(h("p", { className: result.ok ? "ok-text" : "field-error", text: result.ok ? `已改好 ${result.renamed} 位客戶的名稱。` : "改名失敗，沒有任何變更" }));
  } });
  return h("section", { className: "card form-card", dataset: { directoryCard: "" } }, [
    h("h2", { text: "客戶簡稱與聯絡人（Ocean 客戶資料）" }),
    status,
    area,
    region,
    h("div", { className: "button-row" }, [renameButton]),
    renameRegion,
  ]);
}

registerDataSection(directoryCard);
registerDataSection(bulkFillCard);
