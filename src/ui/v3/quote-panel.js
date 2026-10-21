import { customerChoices } from "../../data/order-intake.js";
import { customerDeal, quoteCandidates, quoteProduct, quoteText, recentDeals } from "../../data/quote.js";
import { badge, h, money } from "../dom.js";

// 產品報價 (a tab of the 訂單 page): find products by code or name, see the list price and what
// customers recently paid, set the price to quote, and copy one block for LINE.
const quote = { query: "", items: [], customer: null, pending: "" };

export function resetQuoteState() {
  Object.assign(quote, { query: "", items: [], customer: null, pending: "" });
}

// From the search page: 「#/line-order?mode=quote&code=…」 adds that product once the catalog is loaded.
export function queueQuoteCode(code) {
  if (code) quote.pending = code;
}

// From a customer page: quote for this customer (their last prices show up next to each product).
export function queueQuoteCustomer(customer) {
  if (customer && quote.customer?.customerId !== customer.id) quote.customer = { customerNo: customer.customerNo || "", company: customer.name, customerId: customer.id, contact: "" };
}

function priceText(value, unit) {
  return value === null || value === undefined ? "定價未填" : `${money(value)}${unit ? `／${unit}` : ""}`;
}

export function drawQuote(box, { ctx, reference }) {
  if (quote.pending) {
    const product = quoteProduct(reference, quote.pending);
    if (product && !quote.items.some((item) => item.code === product.code)) quote.items.push({ ...product, price: product.listPrice });
    if (product || reference.productList.length) quote.pending = "";
  }
  const redraw = () => drawQuote(box, { ctx, reference });

  const add = (product) => {
    if (!quote.items.some((item) => item.code === product.code)) quote.items.push({ ...product, price: customerDeal(reference, quote.customer?.customerNo, product.code)?.unitPrice ?? product.listPrice });
    redraw();
  };

  // Optional: whose price history to show (and to start from).
  const customerSearch = h("input", { type: "search", placeholder: "（選填）客戶：看這位客戶上次成交價", "aria-label": "報價客戶", dataset: { quoteCustomerSearch: "" } });
  const customerResults = h("div", { className: "picker-results" });
  customerSearch.addEventListener("input", () => {
    customerResults.replaceChildren(...customerChoices(customerSearch.value, { model: ctx.model, reference }).filter((choice) => choice.customerNo).slice(0, 6).map((choice) => h("button", {
      type: "button", className: "small ghost", text: `${choice.company || choice.name || ""} #${choice.customerNo}`,
      onClick: () => { quote.customer = choice; redraw(); },
    })));
  });
  const customerRow = quote.customer
    ? h("div", { className: "button-row" }, [badge(`客戶：${quote.customer.company || quote.customer.name || ""} #${quote.customer.customerNo}`, "accent"), h("button", { type: "button", className: "small ghost", text: "不指定客戶", onClick: () => { quote.customer = null; redraw(); } })])
    : h("div", { className: "stack" }, [h("div", { className: "search-box" }, [customerSearch]), customerResults]);

  const results = h("ul", { className: "quote-results", dataset: { quoteResults: "" } });
  const drawResults = () => {
    const query = quote.query.trim();
    if (!query) { results.replaceChildren(); return; }
    if (!reference.productList.length) { results.replaceChildren(h("li", { className: "muted", text: "還沒有商品清單，請先按「更新商品與購買紀錄」。" })); return; }
    const found = quoteCandidates(reference, query, 8);
    if (!found.length) { results.replaceChildren(h("li", { className: "muted", text: `商品清單裡找不到「${query}」，試試料號或英文品名的一部分。` })); return; }
    results.replaceChildren(...found.map((product) => {
      const mine = customerDeal(reference, quote.customer?.customerNo, product.code);
      const deals = recentDeals(reference, product.code, 3);
      const added = quote.items.some((item) => item.code === product.code);
      return h("li", { className: "quote-result", dataset: { quoteResult: product.code } }, [
        h("div", { className: "quote-main" }, [
          h("strong", { text: `${product.code}｜${product.name}` }),
          product.nameZh ? h("small", { text: product.nameZh }) : null,
          h("small", { className: "muted", text: [product.spec, product.brand].filter(Boolean).join("・") }),
          h("span", { className: "quote-list-price", dataset: { quoteListPrice: product.code }, text: `定價 ${priceText(product.listPrice, product.unit)}（未稅）${product.listSource ? `・商品清單沒填，取自${product.listSource}` : ""}` }),
          mine ? h("small", { className: "quote-deal-mine", text: `這位客戶上次 ${money(mine.unitPrice)}（${String(mine.date).replaceAll("-", "/")}）` }) : null,
          deals.length ? h("small", { className: "muted", text: `最近成交：${deals.map((deal) => `${deal.customerName} ${money(deal.unitPrice)}（${String(deal.date).slice(0, 7).replace("-", "/")}）`).join("、")}` }) : null,
          product.discontinued ? badge("規格註記停產", "warn") : null,
          product.notInCatalog ? badge("商品清單沒有，資料來自購買紀錄", "warn") : null,
        ]),
        h("button", { type: "button", className: added ? "small ghost" : "small primary", disabled: added, dataset: { quoteAdd: product.code }, text: added ? "已加入" : "加入", onClick: () => add(product) }),
      ]);
    }));
  };

  const search = h("input", { type: "search", value: quote.query, placeholder: "料號或品名，例如 CMP0100131、MacConkey、血液培養基", "aria-label": "查產品", dataset: { quoteSearch: "" }, autocomplete: "off" });
  let timer = null;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { quote.query = search.value; drawResults(); }, 120); });

  const preview = h("pre", { className: "line-output", dataset: { quoteText: "" }, text: quoteText(quote.items) });
  const refreshPreview = () => { preview.textContent = quoteText(quote.items); };
  const basket = quote.items.length ? h("section", { className: "card stack", dataset: { quoteBasket: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: `報價內容（${quote.items.length} 項）` }), h("button", { type: "button", className: "small ghost", text: "全部清除", onClick: () => { quote.items = []; redraw(); } })]),
    h("ul", { className: "quote-items" }, quote.items.map((item, index) => h("li", { className: "quote-item", dataset: { quoteItem: item.code } }, [
      h("div", { className: "quote-main" }, [
        h("strong", { text: `${item.code}｜${item.name}` }),
        h("small", { className: "muted", text: item.spec }),
        h("small", { text: `定價 ${priceText(item.listPrice, item.unit)}` }),
      ]),
      h("label", { className: "quote-price" }, [h("span", { text: "報價 $" }), h("input", {
        type: "number", inputmode: "decimal", min: "0", step: "any", value: item.price ?? "", "aria-label": `${item.code} 報價`, dataset: { quotePrice: item.code },
        onInput: (event) => { const value = event.target.value.trim(); quote.items[index].price = value === "" ? null : Number(value); refreshPreview(); },
      })]),
      h("button", { type: "button", className: "small ghost", "aria-label": `移除 ${item.code}`, text: "移除", onClick: () => { quote.items.splice(index, 1); redraw(); } }),
    ]))),
    preview,
    h("div", { className: "button-row" }, [h("button", { type: "button", className: "primary", dataset: { quoteCopy: "" }, text: "複製給客戶", onClick: async (event) => {
      const button = event.currentTarget;
      try { await navigator.clipboard.writeText(quoteText(quote.items)); button.textContent = "已複製"; } catch { button.textContent = "請長按上面文字複製"; }
      setTimeout(() => { button.textContent = "複製給客戶"; }, 1500);
    } })]),
  ]) : null;

  box.replaceChildren(
    h("section", { className: "card stack" }, [h("div", { className: "search-box" }, [search]), results, customerRow]),
    ...(basket ? [basket] : []),
  );
  drawResults();
}
