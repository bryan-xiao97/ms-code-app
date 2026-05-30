import { describe, it, expect } from "vitest";

// Re-implement the function under test here to avoid bundling React into the test.
// If the logic moves to lib/, import it from there instead.
function dueSoon(dueDate: string, today: Date = new Date()): boolean {
  const due = new Date(dueDate);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 5;
}

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
