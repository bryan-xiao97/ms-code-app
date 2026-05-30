"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const CreateDealSchema = z.object({
  name: z.string().min(1, "Deal name is required").max(120),
  target_company: z.string().min(1, "Target company is required").max(120),
  sector: z.string().max(80).optional().or(z.literal("")),
});

export type CreateDealResult =
  | { ok: true; dealId: string }
  | { ok: false; error: string };

export async function createDeal(formData: FormData): Promise<CreateDealResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Not authenticated." };
  }

  const parsed = CreateDealSchema.safeParse({
    name: formData.get("name"),
    target_company: formData.get("target_company"),
    sector: formData.get("sector") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Use service role to insert both rows atomically (RLS allows the deal insert
  // for any authenticated user, but the deal_members insert requires service role).
  const svc = createServiceClient();
  const { data: deal, error: dealErr } = await svc
    .from("deals")
    .insert({
      name: parsed.data.name,
      target_company: parsed.data.target_company,
      sector: parsed.data.sector || null,
      created_by: userData.user.id,
    })
    .select("id")
    .single();
  if (dealErr || !deal) {
    return { ok: false, error: dealErr?.message ?? "Failed to create deal" };
  }

  const { error: memErr } = await svc
    .from("deal_members")
    .insert({ deal_id: deal.id, user_id: userData.user.id, role: "lead" });
  if (memErr) {
    // Best-effort rollback of the deal row
    await svc.from("deals").delete().eq("id", deal.id);
    return { ok: false, error: memErr.message };
  }

  revalidatePath("/deals");
  redirect(`/deals/${deal.id}`);
}
