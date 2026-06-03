import { describe, it, expect } from "vitest";
import { buildQaPrompt, extractCitations, type RetrievedChunk } from "@/lib/rag/prompt";

const chunks: RetrievedChunk[] = [
  {
    id: "c1",
    document_id: "d1",
    page: 4,
    chunk_index: 0,
    content: "Revenue grew 20% YoY to $50M.",
    similarity: 0.91,
  },
  {
    id: "c2",
    document_id: "d2",
    page: 2,
    chunk_index: 3,
    content: "EBITDA margin was 18%.",
    similarity: 0.85,
  },
];

describe("buildQaPrompt", () => {
  it("includes the question, instructions, and tagged excerpts", () => {
    const { system, user } = buildQaPrompt("What was revenue?", chunks);
    expect(system).toMatch(/sell-side M&A diligence assistant/i);
    expect(system).toMatch(/only the provided excerpts/i);
    expect(user).toContain("What was revenue?");
    expect(user).toContain("[doc:d1 page:4]");
    expect(user).toContain("Revenue grew 20% YoY to $50M.");
  });
});

describe("extractCitations", () => {
  it("maps [doc:x page:y] markers in the answer back to retrieved chunks", () => {
    const answer = "Revenue was $50M [doc:d1 page:4].";
    const cites = extractCitations(answer, chunks);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ document_id: "d1", page: 4, chunk_id: "c1" });
  });

  it("falls back to the top chunk when no markers are present", () => {
    const cites = extractCitations("Revenue was strong.", chunks);
    expect(cites).toHaveLength(1);
    expect(cites[0].chunk_id).toBe("c1");
  });
});
