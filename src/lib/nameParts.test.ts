import { describe, expect, it } from "vitest";
import { abbreviateStreetTypes } from "./streetAbbrev";
import { getDisplayName, getSpeakName } from "./nameParts";

describe("abbreviateStreetTypes", () => {
  it("abbreviates German street-type suffixes", () => {
    expect(abbreviateStreetTypes("Hauptstraße")).toBe("Hauptstr.");
    expect(abbreviateStreetTypes("Bergstrasse")).toBe("Bergstr.");
    expect(abbreviateStreetTypes("Kirchweg")).toBe("Kirchw.");
    expect(abbreviateStreetTypes("Marktplatz")).toBe("Marktpl.");
    expect(abbreviateStreetTypes("Lindenallee")).toBe("Lindenal.");
    expect(abbreviateStreetTypes("Enger Gasse")).toBe("Enger g.");
  });

  it("abbreviates English street-type words", () => {
    expect(abbreviateStreetTypes("Main Street")).toBe("Main St.");
    expect(abbreviateStreetTypes("Oak Road")).toBe("Oak Rd.");
    expect(abbreviateStreetTypes("Park Avenue")).toBe("Park Ave.");
    expect(abbreviateStreetTypes("Cedar Lane")).toBe("Cedar Ln.");
    expect(abbreviateStreetTypes("Forest Path")).toBe("Forest P.");
    expect(abbreviateStreetTypes("Sunset Drive")).toBe("Sunset Dr.");
    expect(abbreviateStreetTypes("Maple Court")).toBe("Maple Ct.");
  });

  it("does not abbreviate unrelated trailing letters", () => {
    expect(abbreviateStreetTypes("Bergw")).toBe("Bergw");
    expect(abbreviateStreetTypes("Waldschneise")).toBe("Waldschneise");
  });
});

describe("getDisplayName / getSpeakName", () => {
  it("falls back to node.name without linked parts", () => {
    const node = { name: "Park", namePart1Id: null, namePart2Id: null, nameSeparator: "/" };
    expect(getDisplayName(node)).toBe("Park");
    expect(getSpeakName(node)).toBe("Park");
  });
});
