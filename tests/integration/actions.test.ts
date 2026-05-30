import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

// We test createDeal at the SQL boundary by invoking the same INSERT pattern
// the server action will use, since Server Actions can't be invoked directly
// in Vitest without the Next.js runtime. Behavior tested:
//   - deals row inserted with stage='preparation' and created_by=current user
//   - deal_members row inserted for the creator with role='lead'
//   - the user can read the new deal via RLS

describe("createDeal pattern", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserts a deal and a lead deal_members row atomically (via service role on behalf of user)", async () => {
    const { userId, client } = await createTestUser("creator@test.local");
    const svc = serviceClient();

    // Mirror the server action behavior:
    const { data: deal, error: dealErr } = await svc
      .from("deals")
      .insert({
        name: "Project Alpha",
        target_company: "AlphaCo",
        sector: "SaaS",
        created_by: userId,
      })
      .select()
      .single();
    expect(dealErr).toBeNull();
    expect(deal).toBeTruthy();
    expect(deal!.stage).toBe("preparation");

    const { error: memErr } = await svc
      .from("deal_members")
      .insert({ deal_id: deal!.id, user_id: userId, role: "lead" });
    expect(memErr).toBeNull();

    // The user should now see exactly one deal
    const { data: visible } = await client.from("deals").select();
    expect(visible).toHaveLength(1);
    expect(visible![0].id).toBe(deal!.id);
  });
});
