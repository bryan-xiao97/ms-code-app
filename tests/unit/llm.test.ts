import { describe, it, expect } from "vitest";
import { EMBED_DIM, toPgVector } from "@/lib/llm";

describe("lib/llm helpers", () => {
  it("EMBED_DIM is 768 (Gemini text-embedding-004)", () => {
    expect(EMBED_DIM).toBe(768);
  });

  it("toPgVector formats a number array as a pgvector literal", () => {
    expect(toPgVector([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("toPgVector throws on the wrong dimension", () => {
    expect(() => toPgVector([1, 2, 3], 768)).toThrow(/dimension/i);
  });
});
