"use client";

import { useRef } from "react";
import { setThemeAction } from "@/app/actions";
import { THEMES } from "@/lib/theme";
import { t, type Locale } from "@/lib/i18n";

export function ThemeSelectForm({ currentTheme, locale }: { currentTheme: string; locale: Locale }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={setThemeAction} ref={formRef}>
      <select name="theme" defaultValue={currentTheme} onChange={() => formRef.current?.requestSubmit()}>
        {THEMES.map((theme) => (
          <option key={theme} value={theme}>
            {t(locale, `settings.theme.${theme}`)}
          </option>
        ))}
      </select>
    </form>
  );
}
