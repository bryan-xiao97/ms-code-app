import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";
import { ingestDocument } from "@/lib/rag/ingest";
import type { LLM } from "@/lib/llm";

// Deterministic stub: every text embeds to a fixed 768-dim vector.
const stubLLM: LLM = {
  async chat() {
    return "unused";
  },
  async embed({ texts }) {
    return texts.map(() => Array(768).fill(0.05));
  },
};

describe("ingestDocument", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("parses, chunks, embeds, and marks the document ready", async () => {
    const { userId } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });

    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: deal!.id,
        storage_path: `${deal!.id}/original/cim.pdf`,
        filename: "cim.pdf",
        mime_type: "application/pdf",
        uploaded_by: userId,
      })
      .select()
      .single();

    await ingestDocument({
      documentId: doc!.id,
      deps: {
        supabase: svc,
        llm: stubLLM,
        download: async () => new TextEncoder().encode("ignored").buffer as ArrayBuffer,
        parse: async () => ({
          text: "Section A. " + "lorem ipsum ".repeat(400),
          pageCount: 3,
        }),
      },
    });

    const { data: updated } = await svc
      .from("documents")
      .select("ingest_status, page_count")
      .eq("id", doc!.id)
      .single();
    expect(updated!.ingest_status).toBe("ready");
    expect(updated!.page_count).toBe(3);

    const { count } = await svc
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .eq("document_id", doc!.id);
    expect(count).toBeGreaterThan(1);
  });

  it("marks the document errored when parsing throws", async () => {
    const { userId } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Beta", target_company: "BetaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });
    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: deal!.id,
        storage_path: `${deal!.id}/original/broken.pdf`,
        filename: "broken.pdf",
        mime_type: "application/pdf",
        uploaded_by: userId,
      })
      .select()
      .single();

    await expect(
      ingestDocument({
        documentId: doc!.id,
        deps: {
          supabase: svc,
          llm: stubLLM,
          download: async () => new TextEncoder().encode("ignored").buffer as ArrayBuffer,
          parse: async () => {
            throw new Error("corrupt pdf");
          },
        },
      })
    ).rejects.toThrow(/corrupt pdf/);

    const { data: updated } = await svc
      .from("documents")
      .select("ingest_status, ingest_error")
      .eq("id", doc!.id)
      .single();
    expect(updated!.ingest_status).toBe("error");
    expect(updated!.ingest_error).toMatch(/corrupt pdf/);
  });
});
