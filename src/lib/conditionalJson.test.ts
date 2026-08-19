import { describe, expect, it } from "vitest";
import { conditionalJson } from "./conditionalJson";

describe("conditionalJson", () => {
  it("returns 304 when If-None-Match matches", () => {
    const request = new Request("http://localhost/api/nodes", {
      headers: { "if-none-match": '"abc123"' },
    });
    const response = conditionalJson(request, "abc123", { nodes: [] });
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"abc123"');
  });

  it("returns JSON with ETag when cache miss", () => {
    const request = new Request("http://localhost/api/nodes");
    const response = conditionalJson(request, "def456", { nodes: [{ id: 1 }] });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"def456"');
  });
});
