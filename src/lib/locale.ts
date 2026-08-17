import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./i18n";

/** Resolves the active locale: the signed-in user's preference, else the cookie, else the default. */
export async function resolveLocale(userLocale?: string | null): Promise<Locale> {
  if (isLocale(userLocale)) return userLocale;
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
}
