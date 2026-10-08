const COMPANY_SUFFIX = /(股份有限公司|有限公司|股份公司|企業社|公司)$/u;

// Keeps what the user typed (full-width punctuation, 臺) and only trims.
export function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/　/g, " ").trim();
}

// Canonical spelling for tags and areas, where 臺中 and 台中 must be one label.
export function canonicalLabel(value) {
  return cleanText(value).normalize("NFKC").replaceAll("臺", "台");
}

export function comparisonKey(value) {
  return canonicalLabel(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function companyKey(value) {
  return comparisonKey(value).replace(COMPANY_SUFFIX, "");
}

export function splitList(value) {
  if (Array.isArray(value)) return uniqueList(value);
  return uniqueList(cleanText(value).split(/[、,，;；/\n]+/u));
}

export function uniqueList(values = []) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const value = cleanText(raw);
    const key = comparisonKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function digitsOnly(value) {
  return cleanText(value).replace(/\D+/g, "");
}

export function includesText(haystack, needle) {
  const key = comparisonKey(needle);
  return !key || comparisonKey(haystack).includes(key);
}
