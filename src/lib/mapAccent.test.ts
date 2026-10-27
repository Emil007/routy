import { describe, expect, it } from "vitest";
import { mapAccentHex } from "./mapAccent";

describe("mapAccentHex", () => {
  it("light theme uses the routy green", () => {
    expect(mapAccentHex("light", false)).toBe("#2e6b49");
  });

  it("auto/undefined at a dark system uses the dark green", () => {
    expect(mapAccentHex(undefined, true)).toBe("#6fc08c");
    expect(mapAccentHex("auto", true)).toBe("#6fc08c");
  });

  it("light at a dark system stays light", () => {
    expect(mapAccentHex("light", true)).toBe("#2e6b49");
  });

  it("dark and auto-light differ", () => {
    expect(mapAccentHex("dark", false)).not.toBe(mapAccentHex("light", false));
  });

  it("contrast differs from light and dark", () => {
    expect(mapAccentHex("contrast", false)).not.toBe(mapAccentHex("light", false));
    expect(mapAccentHex("contrast", false)).not.toBe(mapAccentHex("dark", false));
  });

  it("dog and cat differ and are not green", () => {
    expect(mapAccentHex("dog", false)).toBe("#c9791f");
    expect(mapAccentHex("cat", false)).toBe("#a855c9");
    expect(mapAccentHex("dog", false)).not.toBe(mapAccentHex("cat", false));
  });
});
