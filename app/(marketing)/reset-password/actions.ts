"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validatePassword, passwordsMatch, type AuthResult } from "@/lib/auth/validation";

export type ResetPasswordResult = AuthResult;

export async function updatePassword(formData: FormData): Promise<ResetPasswordResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (!passwordsMatch(password, confirm)) {
    return { ok: false, error: "Passwords do not match." };
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { ok: false, error: "Reset link is invalid or expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: error.message };
  }

  redirect("/deals");
}
