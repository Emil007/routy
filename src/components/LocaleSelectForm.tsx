"use client";

import { useRef } from "react";
import { setLocaleAction } from "@/app/actions";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";

export function LocaleSelectForm({ currentLocale }: { currentLocale: Locale }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={setLocaleAction} ref={formRef}>
      <select name="locale" defaultValue={currentLocale} onChange={() => formRef.current?.requestSubmit()}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </form>
  );
}
