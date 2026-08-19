import { describe, expect, it } from "vitest";
import { formatVersionDisplay } from "./version";

describe("formatVersionDisplay", () => {
  it("formats 0.21.0 as 0.21", () => {
    expect(formatVersionDisplay("0.21.0")).toBe("0.21");
  });

  it("formats 0.20.0 as 0.2", () => {
    expect(formatVersionDisplay("0.20.0")).toBe("0.2");
  });
});
