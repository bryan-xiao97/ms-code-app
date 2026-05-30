import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL("/sign-in", request.url);
  return NextResponse.redirect(url, { status: 303 });
}
