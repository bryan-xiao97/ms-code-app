import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getLLM } from "@/lib/llm";
import { answerQuestion } from "./answer";

export const runtime = "nodejs";

const QuestionSchema = z.object({ question: z.string().min(3).max(2000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: dealId } = await params;

  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Explicit membership check → clear 403 instead of a silent empty result.
  const { data: member } = await supabase
    .from("deal_members")
    .select("deal_id")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "You are not a member of this deal." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = QuestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Question must be 3-2000 characters." }, { status: 400 });
  }

  try {
    const result = await answerQuestion({
      dealId,
      userId: userData.user.id,
      question: parsed.data.question,
      supabase,
      llm: getLLM(),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { error: "AI temporarily unavailable.", detail: message },
      { status: 502 }
    );
  }
}
