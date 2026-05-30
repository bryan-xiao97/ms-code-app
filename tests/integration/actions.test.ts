import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
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

const ValidStage = z.enum(["preparation", "marketing_cim", "buyer_gtm", "detailed_dd", "close"]);

describe("updateStage pattern", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a member can change their deal's stage; a non-member cannot", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b, client: clientB } = await createTestUser("b@test.local");
    const svc = serviceClient();

    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: a })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: a, role: "lead" });

    // A succeeds
    const newStage = ValidStage.parse("marketing_cim");
    const { data: updatedA } = await clientA
      .from("deals")
      .update({ stage: newStage })
      .eq("id", deal!.id)
      .select("stage");
    expect(updatedA?.[0]?.stage).toBe("marketing_cim");

    // B fails (zero rows affected via RLS)
    const { data: updatedB } = await clientB
      .from("deals")
      .update({ stage: "close" })
      .eq("id", deal!.id)
      .select("stage");
    expect(updatedB).toEqual([]);
  });
});
