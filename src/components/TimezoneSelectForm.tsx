"use client";

import { useRef } from "react";
import { setTimezoneAction } from "@/app/actions";
import { TIMEZONES } from "@/lib/timezone";

export function TimezoneSelectForm({ currentTimezone, locale }: { currentTimezone: string; locale: "de" | "en" }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={setTimezoneAction} ref={formRef}>
      <select name="timezone" defaultValue={currentTimezone} onChange={() => formRef.current?.requestSubmit()}>
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </select>
    </form>
  );
}
