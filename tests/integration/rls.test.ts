import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

describe("RLS: deal isolation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("user A sees only deals where they are a deal_members row", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealA } = await svc
      .from("deals")
      .insert({ name: "Project Alpha", target_company: "AlphaCo", created_by: a })
      .select()
      .single();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealA!.id, user_id: a, role: "lead" });
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });

    const { data: visible, error } = await clientA.from("deals").select();
    expect(error).toBeNull();
    expect(visible).toHaveLength(1);
    expect(visible![0].id).toBe(dealA!.id);
  });

  it("user A cannot update user B's deal stage", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });

    const { data: updated } = await clientA
      .from("deals")
      .update({ stage: "close" })
      .eq("id", dealB!.id)
      .select();
    // RLS makes this return zero rows instead of throwing — same effect.
    expect(updated).toEqual([]);
  });

  it("user A cannot read milestones on user B's deal", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });
    await svc.from("milestones").insert({
      deal_id: dealB!.id,
      name: "Kickoff",
      due_date: "2026-06-01",
    });

    const { data: visible } = await clientA.from("milestones").select();
    expect(visible).toEqual([]);
  });
});
