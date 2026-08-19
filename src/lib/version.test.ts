import { describe, expect, it } from "vitest";
import { formatVersionDisplay } from "./version";

describe("formatVersionDisplay", () => {
  it("formats 0.21.0 as 0.21s", () => {
    expect(formatVersionDisplay("0.21.0")).toBe("0.21s");
  });

  it("formats 0.20.0 as 0.20s", () => {
    expect(formatVersionDisplay("0.20.0")).toBe("0.20s");
  });

  it("passes through an already-suffixed tag", () => {
    expect(formatVersionDisplay("0.21s")).toBe("0.21s");
  });
});
