"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signInWithMagicLink(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
