import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/rag/chunk";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("hello world", { chunkSize: 100, overlap: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("hello world");
    expect(chunks[0].index).toBe(0);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(2500);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(1000);
    const tail = chunks[0].content.slice(-200);
    expect(chunks[1].content.startsWith(tail)).toBe(true);
  });

  it("ignores whitespace-only input", () => {
    expect(chunkText("   \n  \n ", { chunkSize: 100, overlap: 20 })).toEqual([]);
  });
});
