"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const StageSchema = z.enum([
  "preparation",
  "marketing_cim",
  "buyer_gtm",
  "detailed_dd",
  "close",
]);

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

export async function updateStage(
  dealId: string,
  nextStage: string
): Promise<UpdateStageResult> {
  const parsed = StageSchema.safeParse(nextStage);
  if (!parsed.success) return { ok: false, error: "Invalid stage." };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("deals")
    .update({ stage: parsed.data })
    .eq("id", dealId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not allowed or deal not found." };
  }

  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}
