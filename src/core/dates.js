const TAIPEI = "Asia/Taipei";

export function toDateOnly(value, timeZone = TAIPEI) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const slashed = typeof value === "string" ? value.match(/^(\d{4})[/.](\d{1,2})(?:[/.](\d{1,2}))?$/) : null;
  if (slashed) return `${slashed[1]}-${slashed[2].padStart(2, "0")}-${(slashed[3] || "1").padStart(2, "0")}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Saturday and Sunday roll forward to Monday (public holidays are not known here).
export function nextWorkday(dateOnly) {
  const weekday = new Date(`${dateOnly}T00:00:00Z`).getUTCDay();
  return weekday === 6 ? addDays(dateOnly, 2) : weekday === 0 ? addDays(dateOnly, 1) : dateOnly;
}

export function addWorkdays(dateOnly, days) {
  return nextWorkday(addDays(dateOnly, days));
}

export function weekdayLabel(dateOnly) {
  if (!isDateOnly(dateOnly)) return "";
  return ["日", "一", "二", "三", "四", "五", "六"][new Date(`${dateOnly}T00:00:00Z`).getUTCDay()];
}

export function daysBetween(fromDateOnly, toDateOnlyValue) {
  if (!isDateOnly(fromDateOnly) || !isDateOnly(toDateOnlyValue)) return null;
  return Math.round((Date.parse(`${toDateOnlyValue}T00:00:00Z`) - Date.parse(`${fromDateOnly}T00:00:00Z`)) / 86400000);
}

export function formatShortDate(dateOnly) {
  if (!isDateOnly(dateOnly)) return "";
  const [, month, day] = dateOnly.split("-");
  return `${Number(month)}/${Number(day)}`;
}
