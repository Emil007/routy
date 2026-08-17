import de from "./de.json";
import en from "./en.json";

export type Locale = "de" | "en";
export const LOCALES: Locale[] = ["de", "en"];
export const DEFAULT_LOCALE: Locale = "de";
export const LOCALE_COOKIE = "routy_locale";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dictionaries: Record<Locale, any> = { de, en };

function lookup(dict: unknown, key: string): string | undefined {
  const value = key
    .split(".")
    .reduce<unknown>(
      (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
      dict,
    );
  return typeof value === "string" ? value : undefined;
}

/** Pure, dependency-free translation lookup — safe to import from client or server code. */
export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
  let str = lookup(dict, key) ?? lookup(dictionaries[DEFAULT_LOCALE], key) ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as string[]).includes(value);
}
