import { describe, expect, it } from "vitest";
import { getBootstrapVersion } from "./bootstrapVersion";

describe("getBootstrapVersion", () => {
  it("returns a stable 16-char hex string", () => {
    const v = getBootstrapVersion(1);
    expect(v).toMatch(/^[a-f0-9]{16}$/);
    expect(getBootstrapVersion(1)).toBe(v);
  });

  it("differs per user", () => {
    expect(getBootstrapVersion(1)).not.toBe(getBootstrapVersion(2));
  });
});

describe("getNetworkVersion", () => {
  it("returns a stable 16-char hex string", async () => {
    const { getNetworkVersion } = await import("./networkVersion");
    const v = getNetworkVersion();
    expect(v).toMatch(/^[a-f0-9]{16}$/);
  });
});
