# Phase 3 — DD Q&A (RAG over deal documents) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DD Q&A module — upload deal documents to Supabase Storage, ingest them into pgvector via an Inngest workflow (parse → chunk → embed), and answer banker questions with a RAG route handler that cites its sources, all gated by the existing `deal_members` RLS.

**Architecture:** Documents land in the `deal-documents` Storage bucket and a `documents` row. Inserting that row emits a `document.uploaded` Inngest event; the `doc.ingest` workflow downloads, parses (pdf-parse), chunks, embeds (Gemini `text-embedding-004`, 768-dim), and upserts `document_chunks` rows with a denormalized `deal_id` for RLS. The QA tab calls `POST /api/deals/{id}/qa`, which embeds the question, runs a pgvector similarity search via an RPC under the caller's RLS, composes a grounded prompt, calls Gemini 2.5 Flash through `lib/llm.ts`, writes a `qa_log` row (service role, `asked_by = auth.uid()`), and returns `{ answer, citations }`. The `deal_activity` view is redefined to surface Q&A events in the existing ActivityFeed.

**Tech Stack:** Next.js 16 App Router (TypeScript strict), Supabase (Postgres + pgvector + Storage + RLS), Inngest (background workflow), Gemini via `@google/genai` behind `lib/llm.ts`, `pdf-parse` for text extraction, Vitest (unit + integration against local Supabase), Playwright (E2E).

---

## File Structure

**New files:**

- `supabase/migrations/20260603000003_dd_qa_schema.sql` — `documents`, `document_chunks`, `qa_log` tables; HNSW index; `match_document_chunks` RPC.
- `supabase/migrations/20260603000004_dd_qa_rls.sql` — RLS policies for the three new tables (reuse `public.is_deal_member`).
- `supabase/migrations/20260603000005_documents_storage.sql` — create `deal-documents` bucket + Storage RLS policies.
- `supabase/migrations/20260603000006_deal_activity_qa.sql` — redefine `deal_activity` view to UNION `qa_log`.
- `lib/llm.ts` — provider-agnostic `LLM` interface; Gemini default; `EMBED_DIM`, `toPgVector` helper.
- `lib/rag/chunk.ts` — `chunkText` recursive character splitter.
- `lib/rag/prompt.ts` — `buildQaPrompt`, `extractCitations`.
- `lib/rag/ingest.ts` — `ingestDocument` core pipeline (dependency-injected, Inngest-agnostic so it is unit-testable).
- `inngest/client.ts` — Inngest client + typed event registry.
- `inngest/doc-ingest.ts` — `docIngest` Inngest function (thin wrapper over `ingestDocument`).
- `app/api/inngest/route.ts` — Inngest webhook handler (`serve`).
- `app/api/deals/[id]/qa/route.ts` — RAG query Route Handler.
- `app/(app)/deals/[id]/qa/actions.ts` — `uploadDocument` Server Action.
- `components/deal/DocumentUpload.tsx` — upload form (client).
- `components/deal/DocumentList.tsx` — document list with ingest-status badges + signed-URL download (client).
- `components/deal/QAPanel.tsx` — question box, answer, citation chips (client).
- `tests/unit/chunk.test.ts`, `tests/unit/prompt.test.ts`, `tests/unit/llm.test.ts` — unit tests.
- `tests/integration/dd-qa-rls.test.ts` — RLS isolation proofs for new tables.
- `tests/integration/ingest.test.ts` — `ingestDocument` pipeline against local Supabase with a stub LLM.
- `tests/integration/qa-route.test.ts` — RAG route logic with a stub LLM.
- `tests/e2e/dd-qa.spec.ts` — golden path: upload → ingest → ask → cited answer.

**Modified files:**

- `package.json` — add `inngest`, `@google/genai`, `pdf-parse` deps; add `inngest:dev` script.
- `.env.example` / `.env.local` — add `GEMINI_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`.
- `tests/helpers/supabase-test.ts` — extend `resetDb` to clear new tables + storage objects.
- `app/(app)/deals/[id]/qa/page.tsx` — replace the Phase 3 stub with the real tab UI.
- `CLAUDE.md` — flip Phase 3 status to shipped; extend the Module map.

---

## Task 1: Install Phase 3 dependencies and env vars

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `.env.local`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add inngest @google/genai pdf-parse
pnpm add -D @types/pdf-parse
```
Expected: `package.json` `dependencies` now include `inngest`, `@google/genai`, `pdf-parse`; lockfile updated.

- [ ] **Step 2: Add the Inngest dev script**

In `package.json`, add to `scripts` (after `"supabase:status"`):
```json
    "inngest:dev": "inngest-cli dev -u http://localhost:3000/api/inngest"
```

- [ ] **Step 3: Add env var placeholders**

Append to `.env.example`:
```bash
# DD Q&A (Phase 3)
GEMINI_API_KEY=
# Inngest — leave blank for local dev (inngest-cli dev needs no keys); set in prod.
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
```

Append the same keys to `.env.local`, setting `GEMINI_API_KEY` to a real key from https://aistudio.google.com/apikey (free tier). Leave the two Inngest keys blank for local dev.

- [ ] **Step 4: Verify the build still type-checks**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no new files reference the deps yet).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "chore(qa): add inngest, gemini SDK, pdf-parse deps and env scaffolding"
```

---

## Task 2: DD Q&A schema migration

**Files:**
- Create: `supabase/migrations/20260603000003_dd_qa_schema.sql`

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/20260603000003_dd_qa_schema.sql`:
```sql
-- Phase 3: DD Q&A — documents, chunks, qa_log, and the vector search RPC.
-- pgvector was already enabled in 20260528000000_initial_schema.sql.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  page_count int,
  ingest_status text not null default 'pending'
    check (ingest_status in ('pending','parsing','embedding','ready','error')),
  ingest_error text,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now()
);

create index documents_deal_idx on public.documents (deal_id);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade, -- denormalized for RLS
  chunk_index int not null,
  page int,
  content text not null,
  embedding vector(768) not null
);

create index document_chunks_deal_idx on public.document_chunks (deal_id);
create index document_chunks_doc_idx on public.document_chunks (document_id);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

create table public.qa_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  asked_by uuid not null references auth.users(id),
  question text not null,
  answer text not null,
  citations jsonb not null default '[]'::jsonb,
  asked_at timestamptz not null default now()
);

create index qa_log_deal_idx on public.qa_log (deal_id);

-- Vector similarity search. STABLE (not security definer) so the caller's RLS
-- on document_chunks applies — deal isolation flows automatically.
create or replace function public.match_document_chunks(
  p_deal_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  page int,
  chunk_index int,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.page,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> p_query_embedding) as similarity
  from public.document_chunks dc
  where dc.deal_id = p_deal_id
  order by dc.embedding <=> p_query_embedding
  limit p_match_count;
$$;
```

- [ ] **Step 2: Apply the migration to local Supabase**

Run: `pnpm supabase:reset`
Expected: reset completes; output lists the new migration applied with no SQL errors.

- [ ] **Step 3: Verify the tables and function exist**

Run:
```bash
pnpm supabase status >/dev/null && \
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.document_chunks" -c "\df public.match_document_chunks"
```
Expected: `document_chunks` shows an `embedding` column of type `vector(768)`; the function `match_document_chunks` is listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000003_dd_qa_schema.sql
git commit -m "feat(db): documents, document_chunks, qa_log schema + vector search RPC"
```

---

## Task 3: DD Q&A RLS policies migration

**Files:**
- Create: `supabase/migrations/20260603000004_dd_qa_rls.sql`

- [ ] **Step 1: Write the RLS migration**

Create `supabase/migrations/20260603000004_dd_qa_rls.sql`:
```sql
-- Phase 3 RLS: documents, document_chunks, qa_log.
-- Reuses public.is_deal_member(uuid) defined in 20260528000001_rls_policies.sql.

alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.qa_log          enable row level security;

-- documents: full CRUD for members of the parent deal.
create policy documents_all_member on public.documents
  for all
  using (public.is_deal_member(deal_id))
  with check (public.is_deal_member(deal_id));

-- document_chunks: members may read; writes happen via service role (Inngest worker).
create policy document_chunks_select_member on public.document_chunks
  for select
  using (public.is_deal_member(deal_id));

-- qa_log: members may read their deal's history; writes happen via service role
-- (the route handler attributes asked_by explicitly).
create policy qa_log_select_member on public.qa_log
  for select
  using (public.is_deal_member(deal_id));
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm supabase:reset`
Expected: reset completes with the new RLS migration applied, no errors.

- [ ] **Step 3: Verify RLS is enabled**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select relname, relrowsecurity from pg_class where relname in ('documents','document_chunks','qa_log');"
```
Expected: all three rows show `relrowsecurity = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000004_dd_qa_rls.sql
git commit -m "feat(db): RLS policies for documents, document_chunks, qa_log"
```

---

## Task 4: Storage bucket + Storage RLS migration

**Files:**
- Create: `supabase/migrations/20260603000005_documents_storage.sql`

- [ ] **Step 1: Write the storage migration**

Create `supabase/migrations/20260603000005_documents_storage.sql`. Object paths are `{deal_id}/original/{uuid}.{ext}`, so `storage.foldername(name)[1]` is the `deal_id`:
```sql
-- Phase 3: VDR-equivalent Storage bucket + RLS mirroring the documents table.
-- Object key convention: '{deal_id}/original/{uuid}.{ext}'.

insert into storage.buckets (id, name, public)
values ('deal-documents', 'deal-documents', false)
on conflict (id) do nothing;

-- A user may read/write objects only under a deal they are a member of.
-- The first path segment is the deal_id.
create policy "deal_docs_select_member"
  on storage.objects for select
  using (
    bucket_id = 'deal-documents'
    and public.is_deal_member(((storage.foldername(name))[1])::uuid)
  );

create policy "deal_docs_insert_member"
  on storage.objects for insert
  with check (
    bucket_id = 'deal-documents'
    and public.is_deal_member(((storage.foldername(name))[1])::uuid)
  );

create policy "deal_docs_delete_member"
  on storage.objects for delete
  using (
    bucket_id = 'deal-documents'
    and public.is_deal_member(((storage.foldername(name))[1])::uuid)
  );
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm supabase:reset`
Expected: reset completes; the `deal-documents` bucket is created.

- [ ] **Step 3: Verify the bucket exists**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select id, public from storage.buckets where id = 'deal-documents';"
```
Expected: one row, `public = f`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000005_documents_storage.sql
git commit -m "feat(db): deal-documents storage bucket with member-scoped RLS"
```

---

## Task 5: Redefine the activity feed view to surface Q&A events

**Files:**
- Create: `supabase/migrations/20260603000006_deal_activity_qa.sql`

- [ ] **Step 1: Write the view migration**

The Phase 2 view was an always-empty placeholder (`20260528000002`). Replace it with a real UNION over `qa_log`. (Phase 4 will extend this further with buyer events.) Create `supabase/migrations/20260603000006_deal_activity_qa.sql`:
```sql
-- Phase 3: redefine deal_activity to surface Q&A events.
-- RLS on qa_log flows through the view automatically.

create or replace view public.deal_activity as
  select
    'qa'::text                                   as kind,
    q.id                                          as id,
    q.deal_id                                     as deal_id,
    q.asked_at                                    as occurred_at,
    jsonb_build_object('question', q.question)    as payload
  from public.qa_log q;

alter view public.deal_activity owner to postgres;
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm supabase:reset`
Expected: reset completes; view redefined.

- [ ] **Step 3: Verify the view selects from qa_log**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from public.deal_activity;"
```
Expected: `0` (no qa_log rows yet) and no error — proves the view compiles against the new table.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260603000006_deal_activity_qa.sql
git commit -m "feat(db): deal_activity view surfaces qa_log events"
```

---

## Task 6: Extend the test harness, then prove RLS isolation (TDD)

**Files:**
- Modify: `tests/helpers/supabase-test.ts:48-60`
- Test: `tests/integration/dd-qa-rls.test.ts`

- [ ] **Step 1: Extend `resetDb` to clear the new tables and storage**

In `tests/helpers/supabase-test.ts`, replace the `tables` / `keyCol` block (currently lines 48-50) so the new tables are wiped before `deals`. Replace:
```ts
  const tables = ["milestones", "deal_members", "deals"] as const;
  const keyCol: Record<(typeof tables)[number], string> = {
    milestones: "id",
    deal_members: "deal_id",
    deals: "id",
  };
```
with:
```ts
  const tables = [
    "qa_log",
    "document_chunks",
    "documents",
    "milestones",
    "deal_members",
    "deals",
  ] as const;
  const keyCol: Record<(typeof tables)[number], string> = {
    qa_log: "id",
    document_chunks: "id",
    documents: "id",
    milestones: "id",
    deal_members: "deal_id",
    deals: "id",
  };
```

Then, immediately after the `for (const t of tables) { ... }` loop and before the "Clear auth users" comment, add storage cleanup:
```ts
  // Clear storage objects so signed-URL/download tests start clean.
  const { data: objs } = await svc.storage.from("deal-documents").list("", {
    limit: 1000,
  });
  if (objs && objs.length > 0) {
    // Top-level entries are deal_id folders; remove recursively by listing each.
    for (const top of objs) {
      const { data: inner } = await svc.storage
        .from("deal-documents")
        .list(top.name, { limit: 1000 });
      const paths = (inner ?? []).map((f) => `${top.name}/${f.name}`);
      if (paths.length > 0) await svc.storage.from("deal-documents").remove(paths);
    }
  }
```

- [ ] **Step 2: Write the failing RLS test**

Create `tests/integration/dd-qa-rls.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

describe("RLS: DD Q&A tables", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedDealForB() {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");
    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });
    return { a, clientA, b, dealId: dealB!.id, svc };
  }

  it("user A cannot read documents on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    await svc.from("documents").insert({
      deal_id: dealId,
      storage_path: `${dealId}/original/x.pdf`,
      filename: "x.pdf",
      mime_type: "application/pdf",
      uploaded_by: b,
    });
    const { data } = await clientA.from("documents").select();
    expect(data).toEqual([]);
  });

  it("user A cannot read document_chunks on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: dealId,
        storage_path: `${dealId}/original/x.pdf`,
        filename: "x.pdf",
        mime_type: "application/pdf",
        uploaded_by: b,
      })
      .select()
      .single();
    await svc.from("document_chunks").insert({
      document_id: doc!.id,
      deal_id: dealId,
      chunk_index: 0,
      content: "secret diligence text",
      embedding: `[${Array(768).fill(0.01).join(",")}]`,
    });
    const { data } = await clientA.from("document_chunks").select();
    expect(data).toEqual([]);
  });

  it("user A cannot read qa_log on user B's deal", async () => {
    const { clientA, b, dealId, svc } = await seedDealForB();
    await svc.from("qa_log").insert({
      deal_id: dealId,
      asked_by: b,
      question: "What is the EBITDA?",
      answer: "Confidential.",
      citations: [],
    });
    const { data } = await clientA.from("qa_log").select();
    expect(data).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm test tests/integration/dd-qa-rls.test.ts`
Expected: 3 passing tests. (The migrations from Tasks 2-4 already enforce the isolation; this proves it.)

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/supabase-test.ts tests/integration/dd-qa-rls.test.ts
git commit -m "test(qa): RLS isolation proofs for documents, chunks, qa_log"
```

---

## Task 7: Provider-agnostic LLM layer

**Files:**
- Create: `lib/llm.ts`
- Test: `tests/unit/llm.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/llm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EMBED_DIM, toPgVector } from "@/lib/llm";

describe("lib/llm helpers", () => {
  it("EMBED_DIM is 768 (Gemini text-embedding-004)", () => {
    expect(EMBED_DIM).toBe(768);
  });

  it("toPgVector formats a number array as a pgvector literal", () => {
    expect(toPgVector([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("toPgVector throws on the wrong dimension", () => {
    expect(() => toPgVector([1, 2, 3], 768)).toThrow(/dimension/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/llm.test.ts`
Expected: FAIL — cannot resolve `@/lib/llm`.

- [ ] **Step 3: Implement `lib/llm.ts`**

Create `lib/llm.ts`:
```ts
import { GoogleGenAI } from "@google/genai";

export const EMBED_DIM = 768;
const EMBED_MODEL = "text-embedding-004";
const CHAT_MODEL = "gemini-2.5-flash";

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface LLM {
  chat(opts: { system?: string; messages: ChatMessage[] }): Promise<string>;
  embed(opts: { texts: string[] }): Promise<number[][]>;
}

/** Format a number[] as a Postgres pgvector literal: "[0.1,0.2,...]". */
export function toPgVector(values: number[], expectedDim?: number): string {
  if (expectedDim != null && values.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: got ${values.length}, expected ${expectedDim}`
    );
  }
  return `[${values.join(",")}]`;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM call failed");
}

function geminiLLM(): LLM {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async chat({ system, messages }) {
      const contents = messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));
      const res = await withRetry(() =>
        ai.models.generateContent({
          model: CHAT_MODEL,
          contents,
          config: system ? { systemInstruction: system } : undefined,
        })
      );
      return res.text ?? "";
    },
    async embed({ texts }) {
      const res = await withRetry(() =>
        ai.models.embedContent({
          model: EMBED_MODEL,
          contents: texts,
        })
      );
      return (res.embeddings ?? []).map((e) => e.values ?? []);
    },
  };
}

let _llm: LLM | null = null;

/** Lazily-constructed default LLM. Swap the factory here to change providers. */
export function getLLM(): LLM {
  if (!_llm) _llm = geminiLLM();
  return _llm;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/llm.test.ts`
Expected: 3 passing tests. (`toPgVector` and `EMBED_DIM` are pure; no network or API key needed.)

- [ ] **Step 5: Commit**

```bash
git add lib/llm.ts tests/unit/llm.test.ts
git commit -m "feat(qa): provider-agnostic LLM layer (Gemini default)"
```

---

## Task 8: Recursive character chunker

**Files:**
- Create: `lib/rag/chunk.ts`
- Test: `tests/unit/chunk.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/chunk.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/rag/chunk";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("hello world", { chunkSize: 100, overlap: 20 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("hello world");
    expect(chunks[0].index).toBe(0);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(2500);
    const chunks = chunkText(text, { chunkSize: 1000, overlap: 200 });
    expect(chunks.length).toBeGreaterThan(2);
    // Sequential indices starting at 0
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    // Each chunk is at most chunkSize
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(1000);
    // Overlap: end of chunk 0 reappears at start of chunk 1
    const tail = chunks[0].content.slice(-200);
    expect(chunks[1].content.startsWith(tail)).toBe(true);
  });

  it("ignores whitespace-only input", () => {
    expect(chunkText("   \n  \n ", { chunkSize: 100, overlap: 20 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/chunk.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/chunk`.

- [ ] **Step 3: Implement `lib/rag/chunk.ts`**

Create `lib/rag/chunk.ts`:
```ts
export interface Chunk {
  index: number;
  content: string;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

/**
 * Character-based sliding-window splitter. ~1000 chars (≈250 tokens) with
 * 200-char overlap by default. Prefers to break on the nearest newline or
 * space before the hard limit so chunks land on natural boundaries.
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const chunkSize = opts.chunkSize ?? 1000;
  const overlap = opts.overlap ?? 200;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= chunkSize) return [{ index: 0, content: normalized }];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    // Try to break on a boundary if we are not at the very end.
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
      if (lastBreak > chunkSize - overlap) {
        end = start + lastBreak + 1;
      }
    }
    chunks.push({ index, content: normalized.slice(start, end).trim() });
    index += 1;
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter((c) => c.content.length > 0);
}
```

Note: the "overlap" test asserts that chunk 1 starts with chunk 0's last 200 chars. With all-`a` input there are no break characters, so `end` stays at `start + chunkSize` and `start` advances by `chunkSize - overlap`, producing exact 200-char overlap. The boundary logic only shifts `end` when a space/newline exists, which the all-`a` case does not contain.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/chunk.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/chunk.ts tests/unit/chunk.test.ts
git commit -m "feat(qa): recursive character chunker for document ingestion"
```

---

## Task 9: Prompt builder and citation extractor

**Files:**
- Create: `lib/rag/prompt.ts`
- Test: `tests/unit/prompt.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/prompt.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildQaPrompt, extractCitations, type RetrievedChunk } from "@/lib/rag/prompt";

const chunks: RetrievedChunk[] = [
  {
    id: "c1",
    document_id: "d1",
    page: 4,
    chunk_index: 0,
    content: "Revenue grew 20% YoY to $50M.",
    similarity: 0.91,
  },
  {
    id: "c2",
    document_id: "d2",
    page: 2,
    chunk_index: 3,
    content: "EBITDA margin was 18%.",
    similarity: 0.85,
  },
];

describe("buildQaPrompt", () => {
  it("includes the question, instructions, and tagged excerpts", () => {
    const { system, user } = buildQaPrompt("What was revenue?", chunks);
    expect(system).toMatch(/sell-side M&A diligence assistant/i);
    expect(system).toMatch(/only the provided excerpts/i);
    expect(user).toContain("What was revenue?");
    expect(user).toContain("[doc:d1 page:4]");
    expect(user).toContain("Revenue grew 20% YoY to $50M.");
  });
});

describe("extractCitations", () => {
  it("maps [doc:x page:y] markers in the answer back to retrieved chunks", () => {
    const answer = "Revenue was $50M [doc:d1 page:4].";
    const cites = extractCitations(answer, chunks);
    expect(cites).toHaveLength(1);
    expect(cites[0]).toMatchObject({ document_id: "d1", page: 4, chunk_id: "c1" });
  });

  it("falls back to the top chunk when no markers are present", () => {
    const cites = extractCitations("Revenue was strong.", chunks);
    expect(cites).toHaveLength(1);
    expect(cites[0].chunk_id).toBe("c1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/unit/prompt.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/prompt`.

- [ ] **Step 3: Implement `lib/rag/prompt.ts`**

Create `lib/rag/prompt.ts`:
```ts
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

  const re = /\[doc:([^\s\]]+)\s+page:([^\]]+)\]/g;
  const seen = new Set<string>();
  const cites: Citation[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const docId = m[1];
    const pageRaw = m[2].trim();
    const key = `${docId}:${pageRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = byDocPage.get(key) ?? chunks.find((c) => c.document_id === docId);
    if (chunk) {
      cites.push(toCitation(chunk));
    }
  }

  if (cites.length === 0 && chunks.length > 0) {
    cites.push(toCitation(chunks[0]));
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/unit/prompt.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/prompt.ts tests/unit/prompt.test.ts
git commit -m "feat(qa): RAG prompt builder and citation extractor"
```

---

## Task 10: Document ingestion core pipeline

**Files:**
- Create: `lib/rag/ingest.ts`
- Test: `tests/integration/ingest.test.ts`

The Inngest function (Task 11) is a thin wrapper; the testable logic lives here with injectable `llm`, `parse`, and `supabase` dependencies so it runs against local Supabase with a stub LLM (no network).

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/ingest.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";
import { ingestDocument } from "@/lib/rag/ingest";
import type { LLM } from "@/lib/llm";

// Deterministic stub: every text embeds to a fixed 768-dim vector.
const stubLLM: LLM = {
  async chat() {
    return "unused";
  },
  async embed({ texts }) {
    return texts.map(() => Array(768).fill(0.05));
  },
};

describe("ingestDocument", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("parses, chunks, embeds, and marks the document ready", async () => {
    const { userId } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });

    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: deal!.id,
        storage_path: `${deal!.id}/original/cim.pdf`,
        filename: "cim.pdf",
        mime_type: "application/pdf",
        uploaded_by: userId,
      })
      .select()
      .single();

    await ingestDocument({
      documentId: doc!.id,
      deps: {
        supabase: svc,
        llm: stubLLM,
        parse: async () => ({
          text: "Section A. " + "lorem ipsum ".repeat(400),
          pageCount: 3,
        }),
      },
    });

    const { data: updated } = await svc
      .from("documents")
      .select("ingest_status, page_count")
      .eq("id", doc!.id)
      .single();
    expect(updated!.ingest_status).toBe("ready");
    expect(updated!.page_count).toBe(3);

    const { count } = await svc
      .from("document_chunks")
      .select("*", { count: "exact", head: true })
      .eq("document_id", doc!.id);
    expect(count).toBeGreaterThan(1);
  });

  it("marks the document errored when parsing throws", async () => {
    const { userId } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Beta", target_company: "BetaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });
    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: deal!.id,
        storage_path: `${deal!.id}/original/broken.pdf`,
        filename: "broken.pdf",
        mime_type: "application/pdf",
        uploaded_by: userId,
      })
      .select()
      .single();

    await expect(
      ingestDocument({
        documentId: doc!.id,
        deps: {
          supabase: svc,
          llm: stubLLM,
          parse: async () => {
            throw new Error("corrupt pdf");
          },
        },
      })
    ).rejects.toThrow(/corrupt pdf/);

    const { data: updated } = await svc
      .from("documents")
      .select("ingest_status, ingest_error")
      .eq("id", doc!.id)
      .single();
    expect(updated!.ingest_status).toBe("error");
    expect(updated!.ingest_error).toMatch(/corrupt pdf/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/integration/ingest.test.ts`
Expected: FAIL — cannot resolve `@/lib/rag/ingest`.

- [ ] **Step 3: Implement `lib/rag/ingest.ts`**

Create `lib/rag/ingest.ts`:
```ts
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

    const { data: file, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(doc.storage_path);
    if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);

    const parsed = await parse(await file.arrayBuffer(), doc.mime_type);

    const chunks = chunkText(parsed.text);
    if (chunks.length === 0) throw new Error("No extractable text in document");

    await supabase
      .from("documents")
      .update({ page_count: parsed.pageCount, ingest_status: "embedding" })
      .eq("id", documentId);

    // Clear any prior chunks (idempotent re-ingest).
    await supabase.from("document_chunks").delete().eq("document_id", documentId);

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await llm.embed({ texts: batch.map((c) => c.content) });
      const rows = batch.map((c, j) => ({
        document_id: documentId,
        deal_id: doc.deal_id,
        chunk_index: c.index,
        page: null as number | null,
        content: c.content,
        embedding: toPgVector(vectors[j], EMBED_DIM),
      }));
      const { error: insErr } = await supabase.from("document_chunks").insert(rows);
      if (insErr) throw new Error(`Chunk insert failed: ${insErr.message}`);
    }

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/integration/ingest.test.ts`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/rag/ingest.ts tests/integration/ingest.test.ts
git commit -m "feat(qa): document ingestion pipeline (download/parse/chunk/embed/upsert)"
```

---

## Task 11: Inngest client, function, and webhook route

**Files:**
- Create: `inngest/client.ts`
- Create: `inngest/doc-ingest.ts`
- Create: `app/api/inngest/route.ts`

- [ ] **Step 1: Create the Inngest client with typed events**

Create `inngest/client.ts`:
```ts
import { Inngest, EventSchemas } from "inngest";

type Events = {
  "document.uploaded": {
    data: { documentId: string; dealId: string };
  };
};

export const inngest = new Inngest({
  id: "sellside-ma",
  schemas: new EventSchemas().fromRecord<Events>(),
});
```

- [ ] **Step 2: Create the `doc.ingest` function**

Create `inngest/doc-ingest.ts`. It wraps the tested `ingestDocument` core with the real service client, the real Gemini LLM, and the real PDF parser:
```ts
import pdf from "pdf-parse";
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/service";
import { getLLM } from "@/lib/llm";
import { ingestDocument, type ParsedDoc } from "@/lib/rag/ingest";

async function parsePdf(bytes: ArrayBuffer, mimeType: string): Promise<ParsedDoc> {
  if (mimeType === "application/pdf") {
    const result = await pdf(Buffer.from(bytes));
    return { text: result.text, pageCount: result.numpages };
  }
  // Plain text fallback (txt/markdown).
  return { text: new TextDecoder().decode(bytes), pageCount: null };
}

export const docIngest = inngest.createFunction(
  { id: "doc-ingest", retries: 3 },
  { event: "document.uploaded" },
  async ({ event, step }) => {
    await step.run("ingest", async () => {
      await ingestDocument({
        documentId: event.data.documentId,
        deps: {
          supabase: createServiceClient(),
          llm: getLLM(),
          parse: parsePdf,
        },
      });
      return { documentId: event.data.documentId };
    });
    return { ok: true };
  }
);
```

- [ ] **Step 3: Create the webhook route**

Create `app/api/inngest/route.ts`:
```ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { docIngest } from "@/inngest/doc-ingest";

export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [docIngest],
});
```

- [ ] **Step 4: Verify it type-checks and the route compiles**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. If `pdf-parse` types are missing, confirm `@types/pdf-parse` was installed in Task 1.

- [ ] **Step 5: Smoke-test the Inngest endpoint loads**

In one terminal: `pnpm dev`. In another:
```bash
curl -s http://localhost:3000/api/inngest | head -c 200
```
Expected: a JSON body describing the Inngest handler (function count 1), not a 404.

- [ ] **Step 6: Commit**

```bash
git add inngest/client.ts inngest/doc-ingest.ts app/api/inngest/route.ts
git commit -m "feat(qa): Inngest client, doc.ingest workflow, and webhook route"
```

---

## Task 12: uploadDocument Server Action

**Files:**
- Create: `app/(app)/deals/[id]/qa/actions.ts`
- Test: `tests/integration/qa-route.test.ts` (shared file; created here, extended in Task 13)

The action uploads bytes to Storage under the caller's RLS, inserts a `documents` row, and emits the `document.uploaded` event.

- [ ] **Step 1: Write the failing integration test for the document insert + path convention**

Create `tests/integration/qa-route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";
import { buildStoragePath } from "@/app/(app)/deals/[id]/qa/actions";

describe("buildStoragePath", () => {
  it("produces a deal-scoped original/{uuid}.{ext} key", () => {
    const path = buildStoragePath("11111111-1111-1111-1111-111111111111", "Q1 CIM.pdf");
    expect(path).toMatch(
      /^11111111-1111-1111-1111-111111111111\/original\/[0-9a-f-]+\.pdf$/
    );
  });

  it("defaults the extension to bin when the filename has none", () => {
    const path = buildStoragePath("d", "noext");
    expect(path).toMatch(/\/original\/[0-9a-f-]+\.bin$/);
  });
});

describe("documents insert respects RLS", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a member can insert a documents row for their deal", async () => {
    const { userId, client } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });

    const { error } = await client.from("documents").insert({
      deal_id: deal!.id,
      storage_path: `${deal!.id}/original/x.pdf`,
      filename: "x.pdf",
      mime_type: "application/pdf",
      uploaded_by: userId,
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/integration/qa-route.test.ts`
Expected: FAIL — cannot resolve `buildStoragePath` from the actions module.

- [ ] **Step 3: Implement `app/(app)/deals/[id]/qa/actions.ts`**

Create `app/(app)/deals/[id]/qa/actions.ts`:
```ts
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

const BUCKET = "deal-documents";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = new Set(["application/pdf", "text/plain", "text/markdown"]);

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: string };

/** Build the deal-scoped storage key: '{dealId}/original/{uuid}.{ext}'. */
export function buildStoragePath(dealId: string, filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "bin";
  return `${dealId}/original/${randomUUID()}.${ext}`;
}

export async function uploadDocument(
  dealId: string,
  formData: FormData
): Promise<UploadDocumentResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return { ok: false, error: "Not authenticated." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "File exceeds the 25 MB limit." };
  }
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED.has(mimeType)) {
    return { ok: false, error: "Only PDF, text, or markdown files are supported." };
  }

  const storagePath = buildStoragePath(dealId, file.name);

  // RLS on storage.objects blocks uploads to deals the caller isn't a member of.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: mimeType, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const { data: doc, error: insErr } = await supabase
    .from("documents")
    .insert({
      deal_id: dealId,
      storage_path: storagePath,
      filename: file.name,
      mime_type: mimeType,
      uploaded_by: userData.user.id,
    })
    .select("id")
    .single();
  if (insErr || !doc) {
    // Roll back the orphaned object.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: insErr?.message ?? "Failed to record document." };
  }

  await inngest.send({
    name: "document.uploaded",
    data: { documentId: doc.id, dealId },
  });

  revalidatePath(`/deals/${dealId}/qa`);
  return { ok: true, documentId: doc.id };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/integration/qa-route.test.ts`
Expected: the `buildStoragePath` and RLS-insert tests pass. (`uploadDocument` itself is exercised in E2E; the pure helper and the RLS contract are covered here.)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/deals/[id]/qa/actions.ts" tests/integration/qa-route.test.ts
git commit -m "feat(qa): uploadDocument server action with storage + Inngest emit"
```

---

## Task 13: RAG query Route Handler

**Files:**
- Create: `app/api/deals/[id]/qa/route.ts`
- Modify: `tests/integration/qa-route.test.ts`

The handler is HTTP-shaped, so we extract the retrieval+compose logic into a testable `answerQuestion` function exported from the route module and unit-test it against local Supabase with a stub LLM.

- [ ] **Step 1: Add the failing test for `answerQuestion`**

Append to `tests/integration/qa-route.test.ts`:
```ts
import { answerQuestion } from "@/app/api/deals/[id]/qa/route";
import type { LLM } from "@/lib/llm";

const qaStub: LLM = {
  async chat() {
    return "Revenue was $50M [doc:DOC page:1].";
  },
  async embed({ texts }) {
    return texts.map(() => Array(768).fill(0.05));
  },
};

describe("answerQuestion", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retrieves chunks, calls the LLM, and writes a qa_log row", async () => {
    const { userId } = await createTestUser("owner@test.local");
    const svc = serviceClient();
    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: userId })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: userId, role: "lead" });
    const { data: doc } = await svc
      .from("documents")
      .insert({
        deal_id: deal!.id,
        storage_path: `${deal!.id}/original/cim.pdf`,
        filename: "cim.pdf",
        mime_type: "application/pdf",
        ingest_status: "ready",
        uploaded_by: userId,
      })
      .select()
      .single();
    await svc.from("document_chunks").insert({
      document_id: doc!.id,
      deal_id: deal!.id,
      chunk_index: 0,
      page: 1,
      content: "Revenue grew to $50M.",
      embedding: `[${Array(768).fill(0.05).join(",")}]`,
    });

    const result = await answerQuestion({
      dealId: deal!.id,
      userId,
      question: "What was revenue?",
      supabase: svc,
      llm: qaStub,
    });

    expect(result.answer).toMatch(/\$50M/);
    expect(result.citations.length).toBeGreaterThan(0);

    const { data: logged } = await svc
      .from("qa_log")
      .select("question, asked_by")
      .eq("deal_id", deal!.id);
    expect(logged).toHaveLength(1);
    expect(logged![0].asked_by).toBe(userId);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test tests/integration/qa-route.test.ts`
Expected: FAIL — cannot resolve `answerQuestion`.

- [ ] **Step 3: Implement `app/api/deals/[id]/qa/route.ts`**

Create `app/api/deals/[id]/qa/route.ts`:
```ts
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getLLM, toPgVector, EMBED_DIM, type LLM } from "@/lib/llm";
import { buildQaPrompt, extractCitations, type RetrievedChunk } from "@/lib/rag/prompt";

export const runtime = "nodejs";

const MATCH_COUNT = 8;
const QuestionSchema = z.object({ question: z.string().min(3).max(2000) });

export interface AnswerArgs {
  dealId: string;
  userId: string;
  question: string;
  supabase: SupabaseClient;
  llm: LLM;
}

export interface AnswerResult {
  answer: string;
  citations: ReturnType<typeof extractCitations>;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test tests/integration/qa-route.test.ts`
Expected: all tests in the file pass, including `answerQuestion`.

- [ ] **Step 5: Commit**

```bash
git add "app/api/deals/[id]/qa/route.ts" tests/integration/qa-route.test.ts
git commit -m "feat(qa): RAG query route handler with citations and qa_log audit"
```

---

## Task 14: DD Q&A tab UI

**Files:**
- Create: `components/deal/DocumentUpload.tsx`
- Create: `components/deal/DocumentList.tsx`
- Create: `components/deal/QAPanel.tsx`
- Modify: `app/(app)/deals/[id]/qa/page.tsx`

- [ ] **Step 1: Create the upload component**

Create `components/deal/DocumentUpload.tsx`:
```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { uploadDocument } from "@/app/(app)/deals/[id]/qa/actions";

export function DocumentUpload({
  dealId,
  onUploaded,
}: {
  dealId: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await uploadDocument(dealId, data);
      if (!res.ok) {
        setError(res.error);
      } else {
        form.reset();
        if (inputRef.current) inputRef.current.value = "";
        onUploaded();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".pdf,.txt,.md"
        className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </Button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Create the document list with status badges**

Create `components/deal/DocumentList.tsx`. It polls every 3s while any document is still ingesting so the badge flips to "Ready" without a manual refresh:
```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Doc = {
  id: string;
  filename: string;
  ingest_status: "pending" | "parsing" | "embedding" | "ready" | "error";
  ingest_error: string | null;
  storage_path: string;
  uploaded_at: string;
};

const STATUS_STYLES: Record<Doc["ingest_status"], string> = {
  pending: "bg-slate-100 text-slate-600",
  parsing: "bg-amber-50 text-amber-700",
  embedding: "bg-amber-50 text-amber-700",
  ready: "bg-emerald-50 text-emerald-700",
  error: "bg-rose-50 text-rose-700",
};

export function DocumentList({ dealId, refreshKey }: { dealId: string; refreshKey: number }) {
  const supabase = createClient();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("documents")
      .select("id, filename, ingest_status, ingest_error, storage_path, uploaded_at")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
    setLoading(false);
  }, [dealId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const stillWorking = docs.some(
      (d) => d.ingest_status !== "ready" && d.ingest_status !== "error"
    );
    if (stillWorking) {
      timer.current = setTimeout(load, 3000);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }
  }, [docs, load]);

  async function download(d: Doc) {
    const { data } = await supabase.storage
      .from("deal-documents")
      .createSignedUrl(d.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  if (loading) return <p className="text-sm text-slate-500">Loading documents…</p>;
  if (docs.length === 0)
    return <p className="text-sm text-slate-500">No documents uploaded yet.</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-2">
          <button
            type="button"
            onClick={() => download(d)}
            className="text-sm text-indigo-700 hover:underline"
          >
            {d.filename}
          </button>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[d.ingest_status]}`}
            title={d.ingest_error ?? undefined}
          >
            {d.ingest_status === "ready" ? "Ready" : d.ingest_status}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Create the Q&A panel**

Create `components/deal/QAPanel.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Citation = {
  document_id: string;
  page: number | null;
  chunk_id: string;
  snippet: string;
  score: number;
};

type Answer = { answer: string; citations: Citation[] };

export function QAPanel({ dealId }: { dealId: string }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await fetch(`/api/deals/${dealId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Something went wrong.");
        return;
      }
      setResult(json as Answer);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={ask} className="flex gap-2">
        <Input
          placeholder="Ask a question about the deal documents…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
        />
        <Button type="submit" disabled={pending || question.trim().length < 3}>
          {pending ? "Thinking…" : "Ask"}
        </Button>
      </form>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {result && (
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="whitespace-pre-wrap text-sm text-slate-800">{result.answer}</p>
          {result.citations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.citations.map((c) => (
                <span
                  key={c.chunk_id}
                  title={c.snippet}
                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                >
                  doc {c.document_id.slice(0, 8)}
                  {c.page != null ? ` · p.${c.page}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace the stub tab page**

Replace the entire contents of `app/(app)/deals/[id]/qa/page.tsx` with a client page that wires upload → list → ask:
```tsx
"use client";

import { use, useState } from "react";
import { DocumentUpload } from "@/components/deal/DocumentUpload";
import { DocumentList } from "@/components/deal/DocumentList";
import { QAPanel } from "@/components/deal/QAPanel";

export default function QATab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Ask the documents</h2>
        <QAPanel dealId={id} />
      </section>
      <aside className="rounded-md border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Documents</h2>
        <div className="mb-4">
          <DocumentUpload dealId={id} onUploaded={() => setRefreshKey((k) => k + 1)} />
        </div>
        <DocumentList dealId={id} refreshKey={refreshKey} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Verify type-check and lint pass**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Start the stack — terminal 1: `pnpm supabase:start`; terminal 2: `pnpm dev`; terminal 3: `pnpm inngest:dev`. Sign in as the seeded demo user, open the seeded deal's **DD Q&A** tab, upload a small PDF, watch the badge go `parsing → embedding → Ready`, then ask a question and confirm an answer with citation chips renders.

- [ ] **Step 7: Commit**

```bash
git add "components/deal/DocumentUpload.tsx" "components/deal/DocumentList.tsx" "components/deal/QAPanel.tsx" "app/(app)/deals/[id]/qa/page.tsx"
git commit -m "feat(qa): DD Q&A tab — upload, ingest status, ask with citations"
```

---

## Task 15: E2E golden path

**Files:**
- Create: `tests/e2e/dd-qa.spec.ts`
- Create: `tests/e2e/fixtures/sample.pdf` (tiny text PDF)

This test runs against the full local stack. It requires `pnpm dev`, local Supabase, **and** `pnpm inngest:dev` running so ingestion fires, plus a real `GEMINI_API_KEY` in `.env.local`. Document this prerequisite at the top of the spec.

- [ ] **Step 1: Create a tiny fixture PDF**

Run (generates a minimal valid one-page text PDF):
```bash
mkdir -p tests/e2e/fixtures
python3 - <<'PY'
pdf = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 64>>stream
BT /F1 12 Tf 20 150 Td (Acme Corp revenue was 50 million dollars.) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
trailer<</Root 1 0 R/Size 6>>
startxref
0
%%EOF"""
open("tests/e2e/fixtures/sample.pdf","wb").write(pdf)
print("wrote", len(pdf), "bytes")
PY
```
Expected: prints the byte count; file exists.

- [ ] **Step 2: Write the E2E spec**

Create `tests/e2e/dd-qa.spec.ts`:
```ts
import path from "node:path";
import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

// Prerequisites: local Supabase running, `pnpm dev`, `pnpm inngest:dev`,
// and a real GEMINI_API_KEY in .env.local. Skips if no key is configured.
test.skip(!process.env.GEMINI_API_KEY, "GEMINI_API_KEY required for DD Q&A E2E");

test.beforeEach(async () => {
  await clearInbucket();
});

test("upload a document, ingest it, and get a cited answer", async ({ page }) => {
  const email = `qa-${Date.now()}@test.local`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);

  // Create a deal
  await page.getByLabel("Deal name").fill("Project QA");
  await page.getByLabel("Target company").fill("Acme Corp");
  await page.getByRole("button", { name: /create deal/i }).click();
  await expect(page.getByRole("heading", { name: "Project QA" })).toBeVisible();

  // Go to DD Q&A tab
  await page.getByRole("link", { name: "DD Q&A" }).click();

  // Upload the fixture PDF
  await page.setInputFiles(
    'input[type="file"]',
    path.join(__dirname, "fixtures", "sample.pdf")
  );
  await page.getByRole("button", { name: /upload/i }).click();

  // Wait for ingestion to finish (badge → Ready); generous timeout for embed call.
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 60000 });

  // Ask a question
  await page.getByPlaceholder(/ask a question/i).fill("What was Acme Corp revenue?");
  await page.getByRole("button", { name: /^ask$/i }).click();

  // Expect an answer mentioning the figure and at least one citation chip
  await expect(page.getByText(/50 million|\$50/i)).toBeVisible({ timeout: 30000 });
  await expect(page.locator("text=/^doc /")).toBeVisible();
});
```

- [ ] **Step 3: Run the E2E test**

With the full stack + Inngest dev server running:
```bash
pnpm e2e tests/e2e/dd-qa.spec.ts
```
Expected: PASS (or SKIPPED if `GEMINI_API_KEY` is unset). If it times out on "Ready", check the `pnpm inngest:dev` terminal for `doc-ingest` run errors.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dd-qa.spec.ts tests/e2e/fixtures/sample.pdf
git commit -m "test(e2e): DD Q&A golden path — upload, ingest, ask, cite"
```

---

## Task 16: Update CLAUDE.md and run the full gate

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Flip the Phase 3 status**

In `CLAUDE.md`, under "Phase build status", replace:
```
- Phase 3 (DD Q&A RAG): ⏳ separate plan to be drafted
```
with:
```
- Phase 3 (DD Q&A RAG): ✅ shipped — see plans/oss-app/2026-06-03-phase-3-dd-qa-rag.md
```

- [ ] **Step 2: Extend the Module map**

In `CLAUDE.md`, under "Module map and build phases", add these bullets to the source-layout list (after the `lib/supabase/` line):
```
- `lib/llm.ts` — provider-agnostic LLM (Gemini default); `lib/rag/` — chunk, prompt, ingest.
- `inngest/` — Inngest client + `doc.ingest` workflow; `app/api/inngest/route.ts` is the webhook.
- `app/api/deals/[id]/qa/route.ts` — RAG query endpoint; `app/(app)/deals/[id]/qa/` — DD Q&A tab + uploadDocument action.
- `components/deal/` — DocumentUpload, DocumentList, QAPanel (Phase 3).
```

- [ ] **Step 3: Note the new local-dev dependency**

In `CLAUDE.md`, under "Stack constraints", append:
```
- DD Q&A (Phase 3) requires the Inngest dev server (`pnpm inngest:dev`) and a `GEMINI_API_KEY` for local document ingestion and RAG.
```

- [ ] **Step 4: Run the full CI gate**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: lint clean, no type errors, all Vitest suites green (unit + integration, including the new chunk/prompt/llm/ingest/qa-route/dd-qa-rls tests).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Phase 3 DD Q&A shipped; update module map and stack notes"
```

---

## Self-Review

**1. Spec coverage** (against `specs/oss-app` §"DD Q&A — RAG over deal documents" and the Phase 3 build-sequencing block):

| Spec requirement | Task |
|---|---|
| `documents` + `document_chunks` tables + pgvector HNSW | Task 2 |
| `qa_log` table | Task 2 |
| RLS on the three tables | Task 3 + proven in Task 6 |
| Supabase Storage bucket + bucket policies | Task 4 |
| Upload UI + signed-URL flow | Task 14 (DocumentUpload, DocumentList download) |
| Inngest `doc.ingest` (download/parse/chunk/embed/upsert) | Tasks 10 (core) + 11 (Inngest wrapper) |
| Provider-agnostic `lib/llm.ts`, Gemini default, 768-dim | Task 7 |
| DD Q&A tab UI: question input, answer, citation chips | Task 14 (QAPanel) |
| `POST /api/deals/{id}/qa` retrieval + LLM + explicit 403 | Task 13 |
| `qa_log` write (service role, `asked_by`) | Task 13 |
| Activity feed surfaces Q&A events | Task 5 (view) — ActivityFeed already reads `deal_activity` |
| Vitest: ingestion pipeline; unit tests on chunker/prompt/llm | Tasks 7, 8, 9, 10 |
| E2E golden path (upload → ingest → ask → answer with citation) | Task 15 |

Promptfoo evals (§Testing "AI evals (optional)") are explicitly optional in the spec and deferred — not blocking for Phase 3.

**2. Placeholder scan:** No "TBD/TODO/implement later" or bare instructions without code. Every code step shows complete code; every command lists expected output.

**3. Type consistency:**
- `LLM` interface (`chat({ system?, messages })`, `embed({ texts })`) — defined in Task 7, consumed identically in Tasks 10 (`ingest.ts`), 13 (`route.ts`), and the stubs in Tasks 10/13 tests.
- `toPgVector(values, expectedDim?)` and `EMBED_DIM = 768` — defined Task 7, used in Tasks 10 and 13.
- `RetrievedChunk` (`id, document_id, page, chunk_index, content, similarity`) — defined Task 9; the `match_document_chunks` RPC (Task 2) returns exactly these columns; consumed in Task 13.
- `Chunk` (`index, content`) — defined Task 8, consumed in Task 10.
- `Citation` (`document_id, page, chunk_id, snippet, score`) — defined Task 9, returned by Task 13, rendered in Task 14 `QAPanel`.
- `document.uploaded` event shape (`{ documentId, dealId }`) — typed in Task 11 `inngest/client.ts`, emitted in Task 12, consumed in Task 11 `doc-ingest.ts`.
- `buildStoragePath` / `uploadDocument` — defined and tested in Task 12, imported by Task 14.
- `answerQuestion` — defined and tested in Task 13, called by the route's `POST` in the same file.

---

## Execution Handoff

Plan complete and saved to `superpowers/plans/oss-app/2026-06-03-phase-3-dd-qa-rag.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
