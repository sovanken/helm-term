// Interface languages: the same 11 Claude's apps offer. English is built in; the others load when
// picked. "auto" follows the Windows display language when Helm has it, otherwise English.
// Text lives in locales/<code>/<area>.json (one file per part of the app, merged at start-up);
// corrections from native speakers are welcome on GitHub. See README.md for how keys are named.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

type Tree = Record<string, unknown>;

function merge(parts: Tree[]): Tree {
  const out: Tree = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge([out[k] as Tree, v as Tree]) : v;
    }
  }
  return out;
}

const en = merge(Object.values(import.meta.glob<Tree>("./locales/en/*.json", { eager: true, import: "default" })));

/** Every language Helm is being translated into. */
const ALL_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "hi", name: "हिन्दी" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "es-419", name: "Español (Latinoamérica)" },
  { code: "es-ES", name: "Español (España)" },
] as const;

export type LanguageCode = (typeof ALL_LANGUAGES)[number]["code"];

/**
 * Languages whose translation is complete and checked. Only these are offered; the others are still
 * being translated and come in a later release.
 */
const READY: LanguageCode[] = ["en", "fr", "de", "hi", "id", "it", "ja", "ko", "pt-BR", "es-419", "es-ES"];

export const LANGUAGES = ALL_LANGUAGES.filter((l) => READY.includes(l.code));
const CODES = LANGUAGES.map((l) => l.code) as string[];

const loaders = import.meta.glob<Tree>(["./locales/*/*.json", "!./locales/en/*.json"], { import: "default" });

/** The Helm language closest to a system language tag such as "es-MX" or "pt-PT". */
export function matchLanguage(tag: string): LanguageCode {
  const code = closestLanguage(tag);
  // A Windows language Helm doesn't offer yet falls back to English.
  return CODES.includes(code) ? code : "en";
}

function closestLanguage(tag: string): LanguageCode {
  const t = tag.toLowerCase();
  if (t === "es-es" || t === "es") return "es-ES";
  if (t.startsWith("es-")) return "es-419";
  if (t.startsWith("pt")) return "pt-BR";
  const base = t.split("-")[0];
  return (ALL_LANGUAGES.find((l) => l.code.toLowerCase() === base)?.code as LanguageCode | undefined) ?? "en";
}

export function resolveLanguage(setting: string): LanguageCode {
  if (setting && setting !== "auto" && CODES.includes(setting)) return setting as LanguageCode;
  return matchLanguage(navigator.languages?.[0] ?? navigator.language ?? "en");
}

export async function setLanguage(setting: string) {
  const code = resolveLanguage(setting);
  if (code !== "en" && !i18n.hasResourceBundle(code, "translation")) {
    const files = Object.entries(loaders).filter(([path]) => path.startsWith(`./locales/${code}/`));
    const parts = await Promise.all(files.map(([, load]) => load()));
    if (parts.length) i18n.addResourceBundle(code, "translation", merge(parts), true, true);
  }
  await i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React escapes already
  returnNull: false,
});

/** Translate outside React components (toasts, menus built in plain functions). */
export const t: typeof i18n.t = ((...args: Parameters<typeof i18n.t>) => i18n.t(...args)) as typeof i18n.t;

/** The current language code, for Intl number and date formatting. */
export const locale = () => i18n.language || "en";

export default i18n;
