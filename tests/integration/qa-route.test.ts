import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";
import { buildStoragePath } from "@/app/(app)/deals/[id]/qa/storage-path";
import { answerQuestion } from "@/app/api/deals/[id]/qa/answer";
import type { LLM } from "@/lib/llm";

describe("buildStoragePath", () => {
  it("produces a deal-scoped original/{uuid}.{ext} key", () => {
    const path = buildStoragePath("11111111-1111-1111-1111-111111111111", "Q1 CIM.pdf");
    expect(path).toMatch(
      /^11111111-1111-1111-1111-111111111111\/original\/[0-9a-f-]+\.pdf$/
    );
  });

  it("defaults the extension to bin when the filename has none", () => {
    const path = buildStoragePath("d", "noext");
    expect(path).toMatch(/\/original\/[0-9a-f-]+\.bin$/);
  });
});

describe("documents insert respects RLS", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a member can insert a documents row for their deal", async () => {
    const { userId, client } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });

    const { error } = await client.from("documents").insert({
      deal_id: deal!.id,
      storage_path: `${deal!.id}/original/x.pdf`,
      filename: "x.pdf",
      mime_type: "application/pdf",
      uploaded_by: userId,
    });
    expect(error).toBeNull();
  });
});

const qaStub: LLM = {
  async chat() {
    return "Revenue was $50M [doc:DOC page:1].";
  },
  async embed({ texts }) {
    return texts.map(() => Array(768).fill(0.05));
  },
};

describe("answerQuestion", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retrieves chunks, calls the LLM, and writes a qa_log row", async () => {
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
        ingest_status: "ready",
        uploaded_by: userId,
      })
      .select()
      .single();
    await svc.from("document_chunks").insert({
      document_id: doc!.id,
      deal_id: deal!.id,
      chunk_index: 0,
      page: 1,
      content: "Revenue grew to $50M.",
      embedding: `[${Array(768).fill(0.05).join(",")}]`,
    });

    const result = await answerQuestion({
      dealId: deal!.id,
      userId,
      question: "What was revenue?",
      supabase: svc,
      llm: qaStub,
    });

    expect(result.answer).toMatch(/\$50M/);
    expect(result.citations.length).toBeGreaterThan(0);

    const { data: logged } = await svc
      .from("qa_log")
      .select("question, asked_by")
      .eq("deal_id", deal!.id);
    expect(logged).toHaveLength(1);
    expect(logged![0]!.asked_by).toBe(userId);
  });
});
