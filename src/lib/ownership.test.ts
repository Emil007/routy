import { describe, expect, it } from "vitest";
import { canEdit } from "./ownership";

describe("canEdit", () => {
  it("lets an admin edit anything, regardless of owner", () => {
    expect(canEdit({ id: 1, role: "admin" }, 2)).toBe(true);
    expect(canEdit({ id: 1, role: "admin" }, null)).toBe(true);
  });

  it("lets a user edit their own content", () => {
    expect(canEdit({ id: 2, role: "user" }, 2)).toBe(true);
  });

  it("blocks a user from editing someone else's content", () => {
    expect(canEdit({ id: 2, role: "user" }, 3)).toBe(false);
  });

  it("blocks a user from editing ownerless content", () => {
    expect(canEdit({ id: 2, role: "user" }, null)).toBe(false);
  });
});
