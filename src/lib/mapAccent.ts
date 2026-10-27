import type { Theme } from "@/lib/theme";

/**
 * One source of truth for map vector colors across themes.
 * Values mirror docs/UNIFIED-REDESIGN.md §6 and globals.css.
 * Leaflet needs hex strings (CSS vars are unreliable in all paths).
 */
export function mapAccentHex(theme: string | undefined, prefersDark: boolean): string {
  if (theme === "contrast") return "#005a2b";
  if (theme === "dog") return "#c9791f";
  if (theme === "cat") return "#a855c9";
  if (theme === "dark" || ((theme === "auto" || !theme) && prefersDark)) return "#6fc08c";
  return "#2e6b49";
}

export function isThemeValue(v: string | undefined | null): v is Theme {
  return !!v && ["auto", "light", "dark", "contrast", "dog", "cat"].includes(v);
}
