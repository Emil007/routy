import { describe, expect, it } from "vitest";
import { isUpdateAvailable } from "./updateCheck";
import { APP_VERSION, formatVersionDisplay } from "./version";

describe("isUpdateAvailable", () => {
  it("treats current-generation s tag as not newer than package version", () => {
    expect(isUpdateAvailable(formatVersionDisplay(APP_VERSION))).toBe(false);
  });

  it("detects newer s-suffixed release tags", () => {
    const [major, minor] = APP_VERSION.split(".").map((n) => parseInt(n, 10));
    expect(isUpdateAvailable(`${major}.${minor + 1}s`)).toBe(true);
  });

  it("detects newer patch semver", () => {
    const [major, minor] = APP_VERSION.split(".").map((n) => parseInt(n, 10));
    expect(isUpdateAvailable(`${major}.${minor}.1`)).toBe(true);
  });
});
