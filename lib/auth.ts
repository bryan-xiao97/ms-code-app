import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** Returns the authenticated user, or redirects to /sign-in. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/sign-in");
  }
  return data.user;
}
