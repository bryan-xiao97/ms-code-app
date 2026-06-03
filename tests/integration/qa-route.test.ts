import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";
import { buildStoragePath } from "@/app/(app)/deals/[id]/qa/storage-path";

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
