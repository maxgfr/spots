/**
 * Two languages, English and French. Every user-facing string is an `L10n`
 * written next to the code that shows it, through `l(en, fr)`; `tr()` picks the
 * current one. The language follows the browser (English when it is neither),
 * and a choice made in the menu is remembered.
 */
import { effect, signal } from "@preact/signals";

export type Lang = "en" | "fr";

export const LANGS: { id: Lang; name: string; locale: string }[] = [
  { id: "en", name: "English", locale: "en-GB" },
  { id: "fr", name: "Français", locale: "fr-FR" },
];

export interface L10n {
  en: string;
  fr: string;
}

const KEY = "spots:lang";

function isLang(v: unknown): v is Lang {
  return LANGS.some((x) => x.id === v);
}

/** The first of the browser's preferred languages that spots speaks, or English. */
export function detectLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLang(base)) return base;
  }
  return "en";
}

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {}
  if (typeof navigator === "undefined") return "en";
  return detectLang(navigator.languages?.length ? navigator.languages : [navigator.language ?? ""]);
}

export const lang = signal<Lang>(typeof window === "undefined" ? "en" : initial());

if (typeof document !== "undefined") {
  effect(() => {
    document.documentElement.lang = lang.value;
  });
}

/** Switches language and remembers the choice. */
export function setLang(next: Lang): void {
  lang.value = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
}

/** The current language's version of a string. */
export function tr(s: L10n): string {
  return s[lang.value] ?? s.en;
}

/** Shorthand to write a string inline: `l("Save", "Enregistrer")`. */
export function l(en: string, fr: string): L10n {
  return { en, fr };
}

/** Fills `{name}` placeholders: `fmt(l("{n} places", "{n} lieux"), { n: 3 })`. */
export function fmt(s: L10n, vars: Record<string, string | number>): string {
  return tr(s).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Picks the singular or plural form: `plural(n, l("place", "lieu"), l("places", "lieux"))`. */
export function plural(n: number, one: L10n, many: L10n): string {
  // French uses the singular for 0 and 1, English only for 1.
  const single = lang.value === "fr" ? Math.abs(n) < 2 : Math.abs(n) === 1;
  return tr(single ? one : many);
}

/** The BCP 47 locale of the current language, for Intl formatting. */
export function locale(): string {
  const id = lang.value;
  return LANGS.find((x) => x.id === id)?.locale ?? "en-GB";
}

/** A distance in metres, as the current language writes it ("350 m", "1.2 km" / "1,2 km"). */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  const km = m / 1000;
  return `${km.toLocaleString(locale(), { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}
