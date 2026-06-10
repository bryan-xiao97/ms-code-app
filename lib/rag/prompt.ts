export interface RetrievedChunk {
  id: string;
  document_id: string;
  page: number | null;
  chunk_index: number;
  content: string;
  similarity: number;
}

export interface Citation {
  document_id: string;
  page: number | null;
  chunk_id: string;
  snippet: string;
  score: number;
}

const SYSTEM_PROMPT =
  "You are a sell-side M&A diligence assistant. Answer using only the provided " +
  "excerpts from deal documents. Cite each claim inline with the marker " +
  "[doc:DOCUMENT_ID page:PAGE] using the ids shown on each excerpt. If the " +
  "excerpts do not contain the answer, say you cannot find it in the documents.";

export function buildQaPrompt(
  question: string,
  chunks: RetrievedChunk[]
): { system: string; user: string } {
  const excerpts = chunks
    .map(
      (c) =>
        `[doc:${c.document_id} page:${c.page ?? "?"}]\n${c.content.trim()}`
    )
    .join("\n\n---\n\n");
  const user =
    `Question: ${question}\n\n` +
    `Excerpts:\n\n${excerpts}\n\n` +
    `Answer the question using only these excerpts, with inline [doc:.. page:..] citations.`;
  return { system: SYSTEM_PROMPT, user };
}

/**
 * Pull [doc:ID page:N] markers from the answer and resolve them to retrieved
 * chunks. Falls back to the single top-ranked chunk if the model emitted no
 * markers, so the UI always has at least one source to show.
 */
export function extractCitations(
  answer: string,
  chunks: RetrievedChunk[]
): Citation[] {
  const byDocPage = new Map<string, RetrievedChunk>();
  for (const c of chunks) byDocPage.set(`${c.document_id}:${c.page ?? "?"}`, c);

  const re = /\[doc:([^\s\]]+)\s+page:(\d+|\?)\]/g;
  const seen = new Set<string>();
  const cites: Citation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const docId = m[1] ?? "";
    const pageRaw = (m[2] ?? "").trim();
    const key = `${docId}:${pageRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = byDocPage.get(key) ?? chunks.find((c) => c.document_id === docId);
    if (chunk) {
      cites.push(toCitation(chunk));
    }
  }

  const first = chunks[0];
  if (cites.length === 0 && first !== undefined) {
    cites.push(toCitation(first));
  }
  return cites;
}

function toCitation(c: RetrievedChunk): Citation {
  return {
    document_id: c.document_id,
    page: c.page,
    chunk_id: c.id,
    snippet: c.content.slice(0, 240),
    score: c.similarity,
  };
}
