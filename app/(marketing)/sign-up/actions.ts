"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  validateEmail,
  validatePassword,
  passwordsMatch,
  type AuthResult,
} from "@/lib/auth/validation";

export type SignUpResult = AuthResult;

export async function signUp(formData: FormData): Promise<SignUpResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (!passwordsMatch(password, confirm)) {
    return { ok: false, error: "Passwords do not match." };
  }

  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
