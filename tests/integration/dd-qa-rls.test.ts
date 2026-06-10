import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

describe("RLS: DD Q&A tables", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedDealForB() {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");
    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });
    return { a, clientA, b, dealId: dealB!.id, svc };
  }

  it("user A cannot read documents on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    await svc.from("documents").insert({
      deal_id: dealId,
      storage_path: `${dealId}/original/x.pdf`,
      filename: "x.pdf",
      mime_type: "application/pdf",
      uploaded_by: b,
    });
    const { data } = await clientA.from("documents").select();
    expect(data).toEqual([]);
  });

  it("user A cannot read document_chunks on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: dealId,
        storage_path: `${dealId}/original/x.pdf`,
        filename: "x.pdf",
        mime_type: "application/pdf",
        uploaded_by: b,
      })
      .select()
      .single();
    await svc.from("document_chunks").insert({
      document_id: doc!.id,
      deal_id: dealId,
      chunk_index: 0,
      content: "secret diligence text",
      embedding: `[${Array(768).fill(0.01).join(",")}]`,
    });
    const { data } = await clientA.from("document_chunks").select();
    expect(data).toEqual([]);
  });

  it("user A cannot read qa_log on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    await svc.from("qa_log").insert({
      deal_id: dealId,
      asked_by: b,
      question: "What is the EBITDA?",
      answer: "Confidential.",
      citations: [],
    });
    const { data } = await clientA.from("qa_log").select();
    expect(data).toEqual([]);
  });
});
