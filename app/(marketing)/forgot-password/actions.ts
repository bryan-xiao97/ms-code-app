"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { validateEmail, type AuthResult } from "@/lib/auth/validation";

export type ForgotPasswordResult = AuthResult;

export async function requestPasswordReset(
  formData: FormData
): Promise<ForgotPasswordResult> {
  const email = String(formData.get("email") ?? "").trim();
  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };

  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?type=recovery`,
  });
  // Always succeed — do not reveal whether the email is registered.
  return { ok: true };
}
