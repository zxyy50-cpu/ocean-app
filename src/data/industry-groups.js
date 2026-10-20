// 產業群組: the handful of groups Ocean develops by, modelled on the kinds of customers he already has.
// The first group whose words appear wins; a company can belong to two groups at most.
// Used by the prospect build script and by the 開發計畫 filter, so both always agree.

export const INDUSTRY_GROUPS = Object.freeze([
  ["乳品", /乳品|乳製|牛乳|羊乳|牛奶|鮮奶|優格|優酪|奶粉|起司|乾酪/u],
  ["肉品禽蛋", /肉品|肉類|肉製|屠宰|禽|雞|鴨|鵝|豬|牛肉|羊肉|蛋品|雞蛋|液蛋|蛋類|香腸|火腿|肉乾|肉鬆|貢丸/u],
  ["水產", /水產|海鮮|海產|魚|蝦|蟹|貝|蚵|魷|鰻|漁|干貝|魚漿/u],
  ["調理冷凍・餐盒", /冷凍調理|調理食品|冷凍食品|即食|餐盒|便當|中央廚房|團膳|空廚|航空餐|水餃|包子|饅頭|鍋貼|微波/u],
  ["豆製品", /豆腐|豆干|豆乾|豆花|豆漿|豆製|豆皮/u],
  ["飲料・冰品", /非酒精飲料|飲料|飲品|茶飲|包裝水|礦泉水|冰品|冰淇淋|冰棒|果汁|咖啡|茶葉/u],
  ["烘焙點心", /烘焙|麵包|蛋糕|糕|餅|點心|休閒食品|糖果|巧克力|零食|米果|蜜餞|果凍/u],
  ["調味醬料", /調味|醬|醋|香料|釀造|湯底|味精|辛香/u],
  ["保健生技", /保健|益生菌|乳酸菌|酵素|機能|生醫|膠囊|錠|健康食品|生物科技|生技/u],
  ["蔬果農產加工", /蔬果|蔬菜|水果|農產|果乾|醃漬|罐頭|菇|筍|鳳梨|芒果/u],
  ["麵食", /麵條|麵食|製麵|麵|水餃皮|餛飩/u],
  ["穀物澱粉", /米|穀|澱粉|麥|粉/u],
  ["飼料寵物", /飼料|飼品|寵物|羽毛粉|魚粉/u],
  ["藥品", /藥品|製藥|藥/u],
  ["化粧品", /化粧|化妝|保養品|清潔用品/u],
  ["油脂", /油脂|食用油|魚油|麻油|沙拉油/u],
  ["酒類", /酒/u],
  ["其他食品", /其他食品|食品/u],
]);

export const GROUP_NAMES = Object.freeze(INDUSTRY_GROUPS.map(([name]) => name));

// What the company makes, most specific first: registry categories, then product lines, then its name.
export function industryGroups(...texts) {
  // 其他食品 is only the fallback when no text says anything more specific.
  let generic = false;
  // 「非酒精飲料」 is a drink, not liquor.
  for (const text of texts.map((value) => String(value || "").replace(/非酒精/gu, "")).filter(Boolean)) {
    const found = INDUSTRY_GROUPS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
    const specific = found.filter((name) => name !== "其他食品");
    if (specific.length) return specific.slice(0, 2);
    generic ||= found.length > 0;
  }
  return generic ? ["其他食品"] : [];
}

// Tagged groups when the list set them; otherwise worked out from the customer's own tags and name.
export function groupsOf(customer) {
  const tags = customer.industryTags || [];
  const tagged = tags.filter((tag) => GROUP_NAMES.includes(tag));
  return tagged.length ? tagged : industryGroups(tags.join(" "), customer.name);
}
