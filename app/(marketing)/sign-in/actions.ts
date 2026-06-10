"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateEmail, type AuthResult } from "@/lib/auth/validation";
import { safeNext } from "@/lib/auth/safe-next";

export type SignInResult = AuthResult;

export async function signInWithPassword(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/deals"));

  const emailErr = validateEmail(email);
  if (emailErr) return { ok: false, error: emailErr };
  if (!password) return { ok: false, error: "Enter your password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Generic message — do not reveal whether the email exists.
    return { ok: false, error: "Invalid email or password." };
  }

  redirect(next);
}
