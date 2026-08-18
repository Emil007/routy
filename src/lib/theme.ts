export const THEMES = ["auto", "light", "dark", "contrast", "dog", "cat"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: string | null | undefined): value is Theme {
  return !!value && (THEMES as readonly string[]).includes(value);
}
