import { describe, it, expect } from "vitest";
import { dueSoon } from "@/lib/milestone";

describe("dueSoon", () => {
  const today = new Date("2026-05-28T12:00:00Z");

  it("is true within 5 days", () => {
    expect(dueSoon("2026-06-01", today)).toBe(true);
  });

  it("is false when more than 5 days away", () => {
    expect(dueSoon("2026-06-10", today)).toBe(false);
  });

  it("is false for past dates", () => {
    expect(dueSoon("2026-05-01", today)).toBe(false);
  });
});
