/** Number, date and duration formatting for the UI. */
import type { Lang, Translate } from "./i18n.ts";

const locale = (lang: Lang) => (lang === "zh" ? "zh-CN" : "en");

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(n);
}

export function formatPercent(p: number | null, lang: Lang, digits = 0): string {
  if (p === null || !Number.isFinite(p)) return "—";
  return new Intl.NumberFormat(locale(lang), { style: "percent", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(p);
}

/** Days as a short human span: "3.2 d", "5.1 mo", "1.4 y" (Anki-like, used for stability). */
export function formatDays(days: number, lang: Lang): string {
  const zh = lang === "zh";
  if (days < 1) {
    const h = days * 24;
    if (h < 1) return zh ? `${Math.max(1, Math.round(h * 60))} 分钟` : `${Math.max(1, Math.round(h * 60))} min`;
    return zh ? `${h.toFixed(h < 10 ? 1 : 0)} 小时` : `${h.toFixed(h < 10 ? 1 : 0)} h`;
  }
  if (days < 30) return zh ? `${trim(days)} 天` : `${trim(days)} d`;
  if (days < 365) return zh ? `${trim(days / 30.4)} 个月` : `${trim(days / 30.4)} mo`;
  return zh ? `${trim(days / 365)} 年` : `${trim(days / 365)} y`;
}

function trim(n: number): string {
  return n >= 10 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
}

export function formatDate(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { year: "numeric", month: "short", day: "numeric" }).format(ms);
}

export function formatDateTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
}

export function formatTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: "2-digit", minute: "2-digit" }).format(ms);
}

/** When something is due, relative to now: "today", "in 3 days", "Mar 4". */
export function formatDue(ms: number, lang: Lang, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  if (abs < 45 * 86400_000) return rtf.format(Math.round(diff / 86400_000), "day");
  return formatDate(ms, lang);
}

export function formatDuration(ms: number, t: Translate): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return t("time.sec", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("time.min", { n: m });
  return t("time.hm", { h: Math.floor(m / 60), m: m % 60 });
}

export function formatBytes(n: number, lang: Lang): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale(lang), { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}
