import type { InventoryItem, ItemStatus } from "./types";

const nf0 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 30,10 Kč, 1 259 Kč */
export function czk(value: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const whole = opts.whole ?? (Number.isInteger(value) || Math.abs(value) >= 1000);
  return `${whole ? nf0.format(Math.round(value)) : nf2.format(value)} Kč`;
}

export function num(value: number, digits = 1): string {
  return digits === 0 ? nf0.format(value) : nf1.format(value);
}

/** 280 m, 1,1 km */
export function distance(m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${nf1.format(m / 1000)} km`;
}

/** Česká množná čísla: 1 den, 2 dny, 5 dní */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4 && Number.isInteger(a)) return few;
  return many;
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "bez data";
  if (days < 0) return days === -1 ? "prošlé včera" : `prošlé ${-days} ${plural(-days, "den", "dny", "dní")}`;
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  return `za ${days} ${plural(days, "den", "dny", "dní")}`;
}

export function daysShort(days: number | null | undefined): string {
  if (days === null || days === undefined) return "–";
  if (days < 0) return "prošlé";
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  if (days > 99) return "99+ d";
  return `${days} d`;
}

const UNIT_LABEL: Record<string, string> = { ks: "ks", g: "g", kg: "kg", ml: "ml", l: "l", bal: "bal." };

export function quantity(q: number, unit: string): string {
  const v = Number.isInteger(q) ? nf0.format(q) : nf1.format(q);
  return `${v} ${UNIT_LABEL[unit] ?? unit}`;
}

export function itemAmount(item: Pick<InventoryItem, "quantity" | "unit" | "fill_level">): string {
  const base = quantity(item.quantity, item.unit);
  if (item.fill_level !== null && item.fill_level !== undefined && item.fill_level < 0.98) {
    return `${base}, zbývá ${Math.round(item.fill_level * 100)} %`;
  }
  return base;
}

const dtf = new Intl.DateTimeFormat("cs-CZ", { day: "numeric", month: "numeric" });
const tf = new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const wdf = new Intl.DateTimeFormat("cs-CZ", { weekday: "short" });
const mf = new Intl.DateTimeFormat("cs-CZ", { month: "short" });

export function parseDate(iso: string): Date {
  // čisté datum bez času bereme v místním čase, jinak by v UTC−x uteklo o den
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return "";
  return dtf.format(parseDate(iso)).replace(/\s/g, " ");
}

export function timeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  return tf.format(parseDate(iso));
}

export function weekday(iso: string): string {
  return wdf.format(parseDate(iso));
}

export function monthShort(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return mf.format(new Date(y, m - 1, 1)).replace(".", "");
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = parseDate(iso).getTime();
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "teď";
  const m = Math.round(s / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "včera";
  if (d < 7) return `před ${d} ${plural(d, "dnem", "dny", "dny")}`;
  return dateShort(iso);
}

export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Jedna stupnice čerstvosti pro celou aplikaci. */
export type Freshness = "fresh" | "soon" | "today" | "expired" | "none";

export function freshness(days: number | null | undefined): Freshness {
  if (days === null || days === undefined) return "none";
  if (days < 0) return "expired";
  if (days <= 1) return "today";
  if (days <= 4) return "soon";
  return "fresh";
}

export const FRESH_COLOR: Record<Freshness, string> = {
  fresh: "var(--color-glacier)",
  soon: "var(--color-butter)",
  today: "var(--color-apricot)",
  expired: "var(--color-tomato)",
  none: "var(--color-mist)",
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ok: "v pohodě",
  low: "dochází",
  out: "došlo",
  expiring: "končí",
  expired: "prošlé",
};

export function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const LEADING_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*(.*)$/su;

/** Rozdělí "🥛 Došlo: Mléko" na emoji a text, aby šlo emoji odsadit. */
export function splitEmoji(text: string): [string | null, string] {
  const m = LEADING_EMOJI.exec(text);
  return m && m[2] ? [m[1], m[2]] : [null, text];
}
