import { describe, expect, it } from "vitest";
import { navChromeVisibility } from "./navChrome";

describe("navChromeVisibility", () => {
  it("shows full chrome in the browser", () => {
    expect(navChromeVisibility(false)).toEqual({ showHeaderChrome: true, showUserbar: true });
  });

  it("hides all chrome in the admin WebView (native app session)", () => {
    expect(navChromeVisibility(true)).toEqual({ showHeaderChrome: false, showUserbar: false });
  });
});
