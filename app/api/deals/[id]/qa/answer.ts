import type { SupabaseClient } from "@supabase/supabase-js";
import { toPgVector, EMBED_DIM, type LLM } from "@/lib/llm";
import {
  buildQaPrompt,
  extractCitations,
  type Citation,
  type RetrievedChunk,
} from "@/lib/rag/prompt";
import { createServiceClient } from "@/lib/supabase/service";

const MATCH_COUNT = 8;

export interface AnswerArgs {
  dealId: string;
  userId: string;
  question: string;
  supabase: SupabaseClient;
  llm: LLM;
}

export interface AnswerResult {
  answer: string;
  citations: Citation[];
}

/** Core RAG logic, decoupled from HTTP for testability. */
export async function answerQuestion({
  dealId,
  userId,
  question,
  supabase,
  llm,
}: AnswerArgs): Promise<AnswerResult> {
  const [queryEmbedding] = await llm.embed({ texts: [question] });
  if (!queryEmbedding) throw new Error("Embedding failed");

  const { data: matches, error: matchErr } = await supabase.rpc("match_document_chunks", {
    p_deal_id: dealId,
    p_query_embedding: toPgVector(queryEmbedding, EMBED_DIM),
    p_match_count: MATCH_COUNT,
  });
  if (matchErr) throw new Error(`Retrieval failed: ${matchErr.message}`);

  const chunks = (matches ?? []) as RetrievedChunk[];
  if (chunks.length === 0) {
    return {
      answer: "I couldn't find anything in this deal's documents to answer that.",
      citations: [],
    };
  }

  const { system, user } = buildQaPrompt(question, chunks);
  const answer = await llm.chat({ system, messages: [{ role: "user", content: user }] });
  const citations = extractCitations(answer, chunks);

  // Privileged audit write attributed to the asker (service role).
  const svc = createServiceClient();
  await svc.from("qa_log").insert({
    deal_id: dealId,
    asked_by: userId,
    question,
    answer,
    citations,
  });

  return { answer, citations };
}
