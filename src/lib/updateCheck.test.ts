import { describe, expect, it } from "vitest";
import { isUpdateAvailable } from "./updateCheck";

describe("isUpdateAvailable", () => {
  it("treats 0.21s tag as same generation as 0.21.0 package version", () => {
    expect(isUpdateAvailable("0.21s")).toBe(false);
  });

  it("detects newer s-suffixed release tags", () => {
    expect(isUpdateAvailable("0.22s")).toBe(true);
    expect(isUpdateAvailable("0.21.1")).toBe(true);
  });
});
