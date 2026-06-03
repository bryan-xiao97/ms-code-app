import type { SupabaseClient } from "@supabase/supabase-js";
import { type LLM, toPgVector, EMBED_DIM } from "@/lib/llm";
import { chunkText } from "@/lib/rag/chunk";

const BUCKET = "deal-documents";
const EMBED_BATCH = 50;

export interface ParsedDoc {
  text: string;
  pageCount: number | null;
}

export interface IngestDeps {
  supabase: SupabaseClient;
  llm: LLM;
  /**
   * Download raw bytes for a storage path. Optional — when omitted the real
   * Supabase storage bucket is used. Injected in tests to bypass real storage.
   */
  download?: (storagePath: string) => Promise<ArrayBuffer>;
  /** Parse raw bytes into text + page count. Injected for testability. */
  parse: (bytes: ArrayBuffer, mimeType: string) => Promise<ParsedDoc>;
}

export interface IngestArgs {
  documentId: string;
  deps: IngestDeps;
}

/**
 * Core ingestion pipeline: download → parse → chunk → embed → upsert.
 * Throws on failure after recording ingest_status='error' so Inngest can retry.
 */
export async function ingestDocument({ documentId, deps }: IngestArgs): Promise<void> {
  const { supabase, llm, parse } = deps;

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, deal_id, storage_path, mime_type")
    .eq("id", documentId)
    .single();
  if (docErr || !doc) throw new Error(`Document ${documentId} not found`);

  try {
    await setStatus(supabase, documentId, "parsing");

    // Use injected downloader if provided, otherwise hit real storage.
    let bytes: ArrayBuffer;
    if (deps.download) {
      bytes = await deps.download(doc.storage_path);
    } else {
      const { data: file, error: dlErr } = await supabase.storage
        .from(BUCKET)
        .download(doc.storage_path);
      if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);
      bytes = await file.arrayBuffer();
    }

    const parsed = await parse(bytes, doc.mime_type);

    const chunks = chunkText(parsed.text);
    if (chunks.length === 0) throw new Error("No extractable text in document");

    await supabase
      .from("documents")
      .update({ page_count: parsed.pageCount, ingest_status: "embedding" })
      .eq("id", documentId);

    // Embed all batches first. Only after every embedding succeeds do we replace
    // the existing chunks, so a mid-embed failure never leaves the document with
    // zero chunks (it stays queryable on its prior content until re-ingest succeeds).
    type ChunkRow = {
      document_id: string;
      deal_id: string;
      chunk_index: number;
      page: number | null;
      content: string;
      embedding: string;
    };
    const rows: ChunkRow[] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await llm.embed({ texts: batch.map((c) => c.content) });
      if (vectors.length !== batch.length) {
        throw new Error(
          `Embed returned ${vectors.length} vectors for ${batch.length} inputs`
        );
      }
      batch.forEach((c, j) => {
        rows.push({
          document_id: documentId,
          deal_id: doc.deal_id,
          chunk_index: c.index,
          page: null,
          content: c.content,
          embedding: toPgVector(vectors[j]!, EMBED_DIM),
        });
      });
    }

    // Replace prior chunks (idempotent re-ingest) now that embeddings are ready.
    await supabase.from("document_chunks").delete().eq("document_id", documentId);
    const { error: insErr } = await supabase.from("document_chunks").insert(rows);
    if (insErr) throw new Error(`Chunk insert failed: ${insErr.message}`);

    await setStatus(supabase, documentId, "ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ingestion error";
    await supabase
      .from("documents")
      .update({ ingest_status: "error", ingest_error: message })
      .eq("id", documentId);
    throw err;
  }
}

async function setStatus(
  supabase: SupabaseClient,
  documentId: string,
  status: string
): Promise<void> {
  await supabase.from("documents").update({ ingest_status: status }).eq("id", documentId);
}
