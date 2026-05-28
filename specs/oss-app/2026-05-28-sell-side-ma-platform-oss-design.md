# Sell-Side M&A Platform — Open-Source Stack Design Spec
_Date: 2026-05-28 | Author: Bryan Xiao_

> This spec describes an open-source / mostly-free reconstruction of the Sell-Side M&A Platform originally designed for the Microsoft stack (`specs/code-app/2026-05-20-sell-side-ma-platform-code-app-design.md`). The product surface — Deal PM shell, Buyers module, DD Q&A, activity feed — is identical. This document defines the alternative technical foundation: Next.js 16 on Vercel, Supabase (Postgres + Auth + Storage + pgvector), Inngest for background workflows, and a hosted-LLM API behind a provider-agnostic interface. Target deployment is a functional demo / prototype runnable on free tiers.

## Key Decisions

| Decision | Resolution |
|---|---|
| Project purpose | **Functional demo / prototype** — end-to-end fidelity with real RAG, free-tier hostable |
| Implementation path | **Next.js 16 App Router** on Vercel free tier |
| Backend platform | **Supabase** — Postgres + pgvector, Auth, Storage, optional Edge Functions |
| Background workflows | **Inngest** free tier (50k function runs/month) |
| LLM provider (default) | **Gemini 2.5 Flash** for chat, `text-embedding-004` (768-dim) for embeddings; abstracted via `lib/llm.ts` so Claude Haiku or gpt-4o-mini can be swapped in with a one-file change |
| Deal access control | **Postgres Row-Level Security** keyed off `deal_members(deal_id, user_id)` — replaces Dataverse Business Units + OBO flow |
| VDR equivalent | **Supabase Storage** bucket `deal-documents/{deal_id}/...` with RLS mirroring the documents table |
| Buyer-log source | **IMAP polling** via per-user App Password, encrypted at rest in Supabase Vault — replaces Outlook/Teams monitoring |
| Microsoft data sources (Outlook/Teams/SharePoint/DealCloud) | **Replaced with open-source equivalents** — IMAP, S3-compatible storage, no CRM (DealCloud dropped for v1) |
| CI/CD | **GitHub Actions** — replaces Azure DevOps |
| Scope shape | **Demo-optimized** — Phase 1 infra shrinks (Supabase collapses most of it), DD Q&A promoted ahead of Buyers as the most demo-worthy module |

---

## Problem Statement

The Solomon Partners sell-side M&A workflow involves significant manual, repetitive work across buyer research, due diligence response, and buyer relationship tracking. The original Code App spec defined a code-first technical foundation on the Microsoft stack (Azure Static Web Apps + Functions, Dataverse, Azure AD, Azure AI Foundry, Power Automate, SharePoint, DealCloud). This spec defines an alternative foundation that delivers the same banker-facing surface — Deal PM, Buyers, DD Q&A — on open-source / free-tier components, suitable for a portable functional prototype.

## Scope

**In scope:**
- React (Next.js 16 App Router) SPA + RSC front-end on Vercel
- Server-side layer via Next.js Server Actions and Route Handlers for any operation needing secrets (LLM calls, IMAP, privileged writes)
- Supabase Postgres for relational + vector data; Supabase Auth for identity; Supabase Storage for the VDR equivalent
- Inngest workflows for document ingestion, buyer list generation, and IMAP polling
- Hosted-LLM API integration (Gemini default) behind a provider-agnostic interface
- Postgres RLS as the sole deal-isolation mechanism
- Phase-mapped build sequencing and CI/CD via GitHub Actions

**Out of scope (v1):**
- DealCloud-equivalent CRM integration (buyers data is manual or LLM-generated)
- Native Outlook/Teams APIs (IMAP only)
- Automated VDR-vendor sync (Intralinks/Datasite/Ansarada API integration)
- Self-hosted Supabase docker-compose packaging (listed under Phase 5 polish)
- Teams app embedding or PWA install flow

---

## Platform Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONT-END                                                       │
│  Next.js 16 App Router (React Server Components + Client comps)  │
│  Hosted: Vercel free tier                                        │
│  Auth: Supabase Auth JS client (JWT in HTTP-only cookies)        │
└────────────┬─────────────────────────────────────────────────────┘
             │
   ┌─────────┴───────────┐
   │                     │
   │ Client → Supabase   │ Client → Next.js Server Actions / Routes
   │  (direct, RLS-gated)│  (when secrets are needed: LLM, IMAP)
   │                     │
   ▼                     ▼
┌──────────────────┐  ┌──────────────────────────────────────────┐
│  SUPABASE        │  │  NEXT.JS SERVER LAYER                     │
│  • Postgres +    │  │  • Server Actions / Route Handlers        │
│    pgvector      │  │  • Calls LLM API (Gemini/Claude/OpenAI)   │
│  • Auth          │  │  • Emits Inngest events                   │
│  • Storage (VDR) │  │  • Uses Supabase service role for         │
│  • RLS enforces  │  │    privileged writes (qa_log etc.)        │
│    deal access   │  └──────────────────────────────────────────┘
└──────────────────┘                  │
        ▲                             │  events
        │                             ▼
        │                  ┌──────────────────────────┐
        │ writes from      │  INNGEST (free tier)     │
        │ background       │  • doc.ingest workflow   │
        │ workers          │  • buyer.generate flow   │
        └──────────────────┤  • imap.poll (cron 15m)  │
                           │  • Step retries + obs.   │
                           └─────────────┬────────────┘
                                         │
                                         ▼
                                    LLM API
                                  (Gemini / Claude)
```

### Two-channel client pattern

Simple CRUD (list deals, edit milestones, edit buyer fields) goes from the browser straight to Supabase. RLS policies enforce deal isolation in the database. Operations that need secrets — calling Gemini, decrypting IMAP credentials, emitting Inngest events, writing privileged audit rows like `qa_log` — go through Next.js Server Actions or Route Handlers. This is the open-source mirror of the original spec's "front-end never touches Dataverse directly" rule, except the trust boundary moves *into Postgres* via RLS instead of being enforced at an API layer above the DB.

---

## Authentication & Deal Access Control

**Front-end (Supabase Auth JS):**
The Next.js app uses `@supabase/ssr` to authenticate users via email magic link and Google OAuth. Auth state lives in HTTP-only cookies; both Server Components and Server Actions can read it. The same browser client object is used for RLS-gated direct queries.

**Backend (service role used sparingly):**
The Next.js server layer holds the Supabase service role key in a Vercel env var. It is used only by:
- Server Actions / Route Handlers that need to write audit rows attributed to a specific user (e.g., `qa_log.asked_by`)
- Inngest workers, which run outside any user session
The default for every other server-side operation is the user-scoped Supabase server client so RLS applies.

**Deal isolation — Postgres RLS:**
Each deal has a `deal_members` row per banker on the team. RLS policies on every deal-scoped table check `auth.uid()` against `deal_members` for that `deal_id`. A user added to a deal by inserting a `deal_members` row gains read/write access; removing the row revokes access. There are no Business Units, no OBO flow, no per-deal access control logic outside the SQL policies.

```
Browser (banker A, session token)
  → supabase-js direct query OR Next.js server action
  → Postgres receives auth.uid() = banker A
  → RLS policy filters: WHERE deal_id IN (
       SELECT deal_id FROM deal_members WHERE user_id = banker A
    )
  → returns only banker A's deals
```

**IMAP credentials:**
Stored encrypted in Supabase Vault (`vault.secrets`). The app stores a reference, not the password. Only the Inngest `imap.poll` worker (running with service-role key) can decrypt.

---

## Front-End Structure

```
app/
  (marketing)/                 ← public sign-in landing
  (app)/                       ← protected routes (Auth middleware)
    deals/page.tsx             ← DealList
    deals/[id]/
      layout.tsx               ← DealWorkspace shell (header + tabs)
      page.tsx                 ← Overview tab (stage, milestones, activity)
      buyers/page.tsx          ← Buyers tab
      qa/page.tsx              ← DD Q&A tab
    settings/page.tsx          ← IMAP credential entry
  api/
    deals/[id]/qa/route.ts     ← RAG query endpoint
  actions/                     ← Server Actions
    deals.ts                   ← createDeal, updateStage
    milestones.ts              ← milestone CRUD
    buyers.ts                  ← buyer CRUD + requestBuyerGeneration
    documents.ts               ← upload → emit Inngest event
  inngest/route.ts             ← Inngest webhook handler

components/
  deal/
    DealList.tsx
    StageSelector.tsx
    MilestoneList.tsx
    ActivityFeed.tsx
    BuyerTable.tsx
    QAPanel.tsx
  ui/                          ← primitives (Button, Surface, etc.)

lib/
  supabase/
    client.ts                  ← browser client (anon key)
    server.ts                  ← RSC/server-action client (user JWT)
    service.ts                 ← service-role client (workers + privileged writes)
  llm.ts                       ← provider-agnostic chat + embed
  rag/
    chunk.ts
    retrieve.ts
    prompt.ts
  imap.ts
  auth.ts
```

The front-end holds no business logic beyond display and user interaction. All AI calls and privileged writes go through Server Actions / Route Handlers; all simple reads/writes use `supabase-js` directly under RLS.

---

## Data Model (Postgres)

```sql
-- Identity reuses Supabase's built-in auth.users table.

create table deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_company text not null,
  sector text,
  stage text not null check (stage in
    ('preparation','marketing_cim','buyer_gtm','detailed_dd','close')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

-- Deal membership: open-source equivalent of Dataverse Business Units.
create table deal_members (
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('lead','member','viewer')),
  added_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  name text not null,
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  created_at timestamptz not null default now()
);

create table buyers (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  firm_name text not null,
  contact_name text,
  contact_email text,
  buyer_type text check (buyer_type in ('financial','strategic')),
  status text not null default 'identified'
    check (status in ('identified','outreach','nda','cim_sent','ioi','loi','passed','dropped')),
  notes text,
  next_steps text,
  source text not null default 'manual'
    check (source in ('manual','generated','imported')),
  last_touch_at timestamptz,
  created_at timestamptz not null default now()
);

create table buyer_communications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  buyer_id uuid references buyers(id) on delete set null,
  occurred_at timestamptz not null,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('email','manual','meeting_note')),
  subject text,
  summary text not null,         -- LLM-summarized
  raw_excerpt text,              -- truncated original
  message_id text                -- IMAP Message-ID for dedupe
);

create table qa_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  asked_by uuid not null references auth.users(id),
  question text not null,
  answer text not null,
  citations jsonb not null,       -- [{document_id, page, chunk_id, score}]
  asked_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
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

create extension if not exists vector;

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade, -- denormalized for RLS
  chunk_index int not null,
  page int,
  content text not null,
  embedding vector(768) not null
);

create index on document_chunks
  using hnsw (embedding vector_cosine_ops);
```

### Row-Level Security policies

All deal-scoped tables enable RLS. The pattern is uniform: a user can see/touch a row iff they have a `deal_members` row for that `deal_id`.

```sql
alter table deals enable row level security;
alter table milestones enable row level security;
alter table buyers enable row level security;
alter table buyer_communications enable row level security;
alter table qa_log enable row level security;
alter table documents enable row level security;
alter table document_chunks enable row level security;
alter table deal_members enable row level security;

create policy deals_select_member on deals for select
  using (exists (
    select 1 from deal_members dm
    where dm.deal_id = deals.id and dm.user_id = auth.uid()
  ));

create policy milestones_all_member on milestones for all
  using (exists (
    select 1 from deal_members dm
    where dm.deal_id = milestones.deal_id and dm.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from deal_members dm
    where dm.deal_id = milestones.deal_id and dm.user_id = auth.uid()
  ));

-- Analogous policies for buyers, buyer_communications,
-- qa_log, documents, document_chunks. deal_members itself:
create policy dm_self on deal_members for select
  using (user_id = auth.uid());
```

### Storage layout (VDR equivalent)

```
deal-documents/                  ← single bucket
  {deal_id}/
    original/{uuid}.{ext}         ← uploaded source files
    derived/                      ← parsed text, OCR output (optional cache)
```

Bucket RLS mirrors the `documents` table policy: a user can read/write only objects under a deal they're a member of. Signed URLs with 60-second TTL are used for downloads from the browser.

### Activity feed view

```sql
create view deal_activity as
  select 'qa' as kind, id, deal_id, asked_at as occurred_at,
         jsonb_build_object('question', question) as payload
  from qa_log
union all
  select 'buyer_comm', id, deal_id, occurred_at,
         jsonb_build_object('summary', summary, 'buyer_id', buyer_id) from buyer_communications
union all
  select 'buyer_generated', id, deal_id, created_at,
         jsonb_build_object('firm_name', firm_name) from buyers
  where source = 'generated';
```

UI query: `select * from deal_activity where deal_id = $1 order by occurred_at desc limit 10`. RLS on the underlying tables flows through the view automatically.

### Mapping back to the original spec

| Original concept | New mechanism |
|---|---|
| Dataverse Deals table | `deals` |
| Business Units assignment | `deal_members` row |
| Dataverse RLS via OBO | Postgres RLS on `auth.uid()` |
| SharePoint site for deal | `deal-documents/{deal_id}/` prefix in Supabase Storage |
| Foundry index over SharePoint | `document_chunks` rows with pgvector embeddings |
| Activity feed merge | `deal_activity` view |

---

## Backend API Layer

Two surfaces: **Supabase direct** (RLS-gated CRUD from the client) and **Next.js Server Actions / Route Handlers** (privileged operations).

### Supabase-direct operations (no server code)

| Operation | Path |
|---|---|
| List my deals | `supabase.from('deals').select(...)` |
| List milestones for a deal | `supabase.from('milestones').select(...).eq('deal_id', id)` |
| Milestone CRUD | direct table operations on `milestones` |
| List/edit buyers | direct table operations on `buyers` |
| Read activity feed | `supabase.from('deal_activity').select(...).eq('deal_id', id).order(...).limit(10)` |
| Document metadata list | `supabase.from('documents').select(...).eq('deal_id', id)` |
| Download document | `supabase.storage.from('deal-documents').createSignedUrl(...)` |

### Server Actions / Route Handlers (server-side)

| Endpoint / Action | Method | Action |
|---|---|---|
| `actions.createDeal` | Server Action | Insert `deals` + `deal_members` (creator as lead) |
| `actions.updateStage` | Server Action | Update `deals.stage` for a deal the caller belongs to |
| `actions.uploadDocument` | Server Action | Upload to Storage, insert `documents` row, emit `document.uploaded` Inngest event |
| `actions.requestBuyerGeneration` | Server Action | Emit `buyer.generate.requested` Inngest event |
| `POST /api/deals/{id}/qa` | Route Handler | RAG retrieval + LLM call; write `qa_log` row; return `{ answer, citations }` |

### Error handling

| Surface | Mechanism |
|---|---|
| Supabase SQL/RLS errors | Returned by `supabase-js` as `{ data, error }`; UI shows inline error toast |
| Server Action / Route Handler errors | Caught, logged to Sentry (free tier), structured JSON `{ error, code }` returned to client |
| Inngest step failures | Inngest retries with exponential backoff; persistent failure → step visible in Inngest dashboard; `documents.ingest_status='error'` so the UI can show "retry" |
| LLM provider 429/5xx | Wrapped in `lib/llm.ts` with retry + timeout; falls back to a user-readable "AI temporarily unavailable" message |
| Auth failures | Supabase Auth redirects to `/sign-in` with reason in query string |
| Client uncaught exceptions | Next.js error boundaries per route segment; Sentry browser SDK |

---

## AI Modules

### DD Q&A — RAG over deal documents

**Ingestion (Inngest workflow `doc.ingest`, triggered on upload):**

```
event 'document.uploaded' fires when documents row is inserted

step "download"  → fetch object bytes via signed URL
step "parse"     → pdf-parse for text PDFs; tesseract.js (or Gemini vision)
                   for scans; update documents.page_count and ingest_status='parsing'
step "chunk"     → recursive character splitter, ~1000 tokens, 200 overlap
step "embed"     → batch-call Gemini text-embedding-004 (768-dim, free tier)
step "upsert"    → insert document_chunks rows (deal_id denormalized for RLS)
                   update documents.ingest_status='ready'

On any step failure: documents.ingest_status='error' + ingest_error message.
Inngest retries each step with exponential backoff.
```

**Query (`POST /api/deals/{id}/qa`):**

```
1. Auth: verify caller is in deal_members for {id} (RLS would block otherwise,
   but explicit check returns a 403 with a clear message instead of 0 rows)
2. Embed question (text-embedding-004)
3. Postgres similarity search:
     select * from document_chunks
     where deal_id = $1
     order by embedding <=> $2
     limit 8
4. Compose prompt:
     "You are a sell-side M&A diligence assistant. Use only the
      provided excerpts. Cite each claim with [doc:page]. If the
      excerpts do not answer the question, say so."
     + concatenated chunks (with doc + page tags)
5. Call Gemini 2.5 Flash via lib/llm.ts
6. Parse citations from response or attach top-K chunk IDs as citations
7. Insert qa_log row (service-role write, asked_by = auth.uid())
8. Return { answer, citations: [{document_id, page, snippet, score}] }
```

**Why pgvector instead of a dedicated vector DB?** One database to back up; RLS automatically applies to vector search via the `deal_id` column on `document_chunks`; HNSW index on free Supabase tier handles tens of thousands of chunks comfortably. The original Foundry index also lived inside its own vendor silo — this is no worse and is portable.

### Buyer list generation — agentic workflow

**Inngest workflow `buyer.generate`:**

```
event 'buyer.generate.requested' { deal_id, prompt_context }

step "gather_context"
  Read deal row + existing buyers + sector → build context block.

step "draft_buyers"  (model call)
  Prompt: "Propose 15-25 plausible buyers for this target across financial
   sponsors and strategics. Output JSON conforming to:
   { firms: [{ firm_name, contact_name?, contact_email?, buyer_type,
                rationale, source_hint }] }"
  Model: Gemini 2.5 Flash with structured-output mode (responseSchema)
         or Claude Haiku with tool-use schema.

step "validate"
  Zod schema parse; reject malformed; on reject, retry up to 2x with
  the validation error appended to the prompt.

step "persist"
  Insert buyers rows (source='generated'); emit realtime ping via
  Supabase channel 'deal:{deal_id}:buyers' so UI updates live.
```

**Honesty note.** Without real CRM data (DealCloud-equivalent), the LLM proposes plausible candidates from training knowledge. Adequate for a demo; for production-grade fidelity, `step "gather_context"` is the integration point for Crunchbase / Apollo / public filings.

### Buyer log auto-recording — IMAP polling

**Setup (one-time per user):** Settings → Email Sync → enter IMAP host, username, App Password. Credentials encrypted in Supabase Vault.

**Inngest cron `imap.poll` (every 15 minutes):**

```
For each user with an imap_credentials row:
  step "fetch_creds"  → decrypt App Password via service role
  step "imap_pull"    → connect (imapflow lib), search messages since
                        last_seen_uid, fetch envelope + plain-text body
  step "match_buyers" → for each message, look up buyers by contact_email
                        across all deals the user is a member of
  step "summarize"    → LLM call: "Summarize this email in 2 sentences,
                        from the perspective of a sell-side M&A banker"
  step "persist"      → insert buyer_communications (channel='email',
                        direction inferred from From/To, message_id for dedupe)
  step "update_buyer" → update buyers.last_touch_at to message timestamp
```

**Privacy guardrail.** Only emails with a From or To address matching a row in `buyers.contact_email` (across the user's deals) are processed. Everything else is ignored — no other inbox content is read or stored.

### Provider-agnostic LLM layer

```ts
// lib/llm.ts
export interface LLM {
  chat(opts: { messages: Message[]; schema?: ZodSchema }): Promise<string | object>;
  embed(opts: { texts: string[] }): Promise<number[][]>;
}

// Default: Gemini. Swap by changing one factory line.
// Constraints: embedding dimension is fixed at 768 (Gemini). Moving to
// OpenAI 1536-dim requires re-embedding all document_chunks.
```

---

## Inngest Function Inventory

| Function | Trigger | Steps |
|---|---|---|
| `doc.ingest` | event `document.uploaded` | download → parse → chunk → embed → upsert |
| `buyer.generate` | event `buyer.generate.requested` | gather_context → draft_buyers → validate → persist |
| `imap.poll` | cron `*/15 * * * *` | per-user fan-out → imap_pull → match → summarize → persist |
| `deal.created` (optional) | event `deal.created` | seed default milestones for the 5 standard process phases |

Inngest's local dev server (`npx inngest-cli@latest dev`) runs alongside `next dev` for live workflow iteration.

---

## Observability

Logs land in three places intentionally — workflow telemetry, DB telemetry, and exception telemetry stay separate:

| Tool | Role |
|---|---|
| Supabase dashboard | SQL queries, RLS denials, Auth events |
| Inngest dashboard | Workflow runs, step retries, dead-letter inspection |
| Sentry (free tier) | Server + client uncaught exceptions |

---

## Testing Strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | `lib/llm.ts` shape, prompt builders, chunker, citation parser |
| Component | Vitest + Testing Library | MilestoneList, StageSelector, BuyerTable inline editing |
| Integration | Vitest against a local Supabase (`supabase start`) | Server actions, **RLS policy correctness (must prove user A cannot see deal B)**, Inngest function tests via the SDK's test harness |
| E2E | Playwright | Sign-in → create deal → upload doc → wait for ingest → ask question → see answer with citation. One golden path per module. |
| AI evals (optional) | Promptfoo | Fixed Q/A pairs to detect regressions when swapping LLM providers or changing prompts |

Coverage target: **80%** per project rules, with hard focus on RLS policies and the LLM-adjacent pipelines.

---

## Build Sequencing

Mirrors the original spec's phasing but compressed because Supabase collapses most of Phase 1, and DD Q&A is promoted ahead of Buyers as the most demo-worthy module. The Buyers module then reuses Inngest/LLM patterns already proven in Phase 3.

```
Phase 1 — Foundation
  - Supabase project (free tier): enable pgvector, configure Auth providers
  - Vercel project: connect repo, set env vars
  - GitHub Actions: lint + type-check + Vitest on PR
  - Schema migration: deals, deal_members, milestones (initial slice)
  - RLS policies for that slice + RLS integration tests
  - Sign-in / sign-up flow + a /deals empty list

Phase 2 — Deal PM shell  (matches original Phase 2)
  - DealList page (RSC reading deals via supabase-server client)
  - DealWorkspace shell (tabs: Overview, Buyers stub, DD Q&A stub)
  - StageSelector with optimistic update via server action
  - MilestoneList CRUD (client component, direct supabase-js + RLS)
  - ActivityFeed component (reads deal_activity view; empty until later)
  - Seed script: sample deal with a fake banker for local demo

Phase 3 — DD Q&A (RAG)   (PROMOTED — most impressive demo surface)
  - documents + document_chunks tables + RLS
  - Supabase Storage bucket + bucket policies
  - Upload UI + signed-URL flow
  - Inngest doc.ingest workflow (download/parse/chunk/embed/upsert)
  - DD Q&A tab UI: question input, streaming answer, citation chips
  - /api/deals/{id}/qa route handler (RAG retrieval + LLM call)
  - qa_log writes; activity feed surfaces Q&A events
  - Vitest: ingestion pipeline; Promptfoo: a few canonical questions

Phase 4 — Buyers module + IMAP buyer log  (matches original Phase 3)
  - buyers + buyer_communications tables + RLS
  - Buyers tab UI: inline editing, status pills, overdue indicator (>14d)
  - Manual buyer add + buyer.generate Inngest workflow
  - Settings page: IMAP credential entry (Vault-stored)
  - imap.poll Inngest cron + summarization
  - Activity feed surfaces communications + generation events

Optional Phase 5 — Polish
  - Realtime updates via Supabase channels (live milestone changes)
  - Export to PDF (CIM-style summary doc)
  - Self-host docker-compose (Supabase self-host + the app)
```

---

## Repository Structure

```
ms-code-app/
├── app/                            ← Next.js 16 App Router
│   ├── (marketing)/                ← public sign-in landing
│   ├── (app)/                      ← protected routes
│   │   ├── deals/page.tsx
│   │   ├── deals/[id]/
│   │   │   ├── layout.tsx          ← DealWorkspace shell
│   │   │   ├── page.tsx            ← Overview tab
│   │   │   ├── buyers/page.tsx
│   │   │   └── qa/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   └── deals/[id]/qa/route.ts  ← RAG query endpoint
│   ├── actions/                    ← Server Actions
│   │   ├── deals.ts
│   │   ├── milestones.ts
│   │   ├── buyers.ts
│   │   └── documents.ts
│   └── inngest/route.ts            ← Inngest webhook handler
├── components/
│   ├── deal/
│   │   ├── DealList.tsx
│   │   ├── StageSelector.tsx
│   │   ├── MilestoneList.tsx
│   │   ├── ActivityFeed.tsx
│   │   ├── BuyerTable.tsx
│   │   └── QAPanel.tsx
│   └── ui/                         ← primitives
├── inngest/                        ← Inngest function definitions
│   ├── client.ts
│   ├── doc-ingest.ts
│   ├── buyer-generate.ts
│   └── imap-poll.ts
├── lib/
│   ├── supabase/
│   │   ├── client.ts               ← browser client (anon key)
│   │   ├── server.ts               ← RSC/server-action client (user JWT)
│   │   └── service.ts              ← service-role client (workers only)
│   ├── llm.ts                      ← provider-agnostic chat + embed
│   ├── rag/
│   │   ├── chunk.ts
│   │   ├── retrieve.ts
│   │   └── prompt.ts
│   ├── imap.ts
│   └── auth.ts
├── supabase/
│   ├── migrations/                 ← SQL migrations (versioned)
│   ├── seed.sql                    ← demo deal + sample docs
│   └── config.toml
├── tests/
│   ├── unit/
│   ├── integration/                ← RLS proofs, Inngest fn tests
│   └── e2e/                        ← Playwright
├── .github/workflows/
│   ├── ci.yml                      ← lint + types + Vitest
│   └── e2e.yml                     ← Playwright on push to main
├── specs/                          ← existing specs preserved
│   ├── canvas-app/                 ← original trade-off artifact
│   ├── code-app/                   ← original Microsoft-stack spec
│   └── oss-app/                    ← this spec
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── README.md
```

---

## Integration Points

| System | Direction | Used By | Notes |
|---|---|---|---|
| Supabase Auth | Auth | Front-end ↔ Supabase | JWT in HTTP-only cookies; OIDC + magic link |
| Supabase Postgres | Read/Write | Client (RLS) + server + Inngest workers | RLS enforces deal access |
| Supabase Storage | Read/Write | Client (signed URL) + Inngest `doc.ingest` | Bucket policy mirrors documents RLS |
| Supabase Vault | Read | Inngest `imap.poll` | Decrypts user IMAP App Passwords |
| Inngest | Event sink + worker | Next.js server emits events; Inngest invokes the `/api/inngest` webhook | Free tier: 50k runs/month |
| LLM API (Gemini default) | Read | Next.js Route Handler + Inngest workers | Via `lib/llm.ts`; provider-agnostic |
| IMAP (user's mailbox) | Read | Inngest `imap.poll` | Per-user App Password; matched by buyer email |
| Sentry (optional) | Write | Browser + server | Free tier; error telemetry |
| GitHub Actions | CI/CD | Pull requests + main | lint, type-check, Vitest; Playwright on main |

---

## Comparison: Original (Microsoft) vs. Open-Source Stack

| Dimension | Microsoft Code App | Open-Source Stack |
|---|---|---|
| UI framework | React (SPA) | React (Next.js 16 App Router; RSC + client) |
| Hosting | Azure Static Web Apps + Azure Functions | Vercel free tier |
| Database | Dataverse | Supabase Postgres |
| Auth | Azure AD / MSAL + OBO | Supabase Auth (magic link + OAuth) |
| Deal isolation | Business Units enforced by Dataverse RLS | Postgres RLS keyed off `deal_members` |
| VDR | SharePoint site (manual provisioning) | Supabase Storage bucket per deal |
| AI / RAG | Azure AI Foundry index | pgvector + hosted-LLM API |
| Background workflows | Power Automate flows | Inngest workflows |
| Buyer-log source | Outlook/Teams (M365 APIs) | IMAP polling |
| CRM data source | DealCloud (Fabric Data Agent) | None in v1 |
| Secrets | Azure Key Vault | Supabase Vault + Vercel env vars |
| Observability | Application Insights | Supabase + Inngest + Sentry |
| CI/CD | Azure DevOps | GitHub Actions |
| Licensing | Microsoft licensing footprint | Free tiers; no per-user licenses |
| Build complexity | Higher (multiple Azure services) | Lower (Supabase collapses several services) |
| Native M365 integration | Yes | Manual (IMAP only) |

---

## Open Questions

- **Real buyer data source.** For production fidelity beyond demo, integrate Crunchbase / Apollo / public filings into `step "gather_context"` of `buyer.generate`. Deferred for v1.
- **OCR for scanned PDFs.** `tesseract.js` works but is slow; alternative is using Gemini vision on the first page to detect a scan, then routing to a cloud OCR with a free tier. Deferred until real scan-heavy demo documents demand it.
- **Embedding model lock-in.** Moving from Gemini's 768-dim to OpenAI's 1536-dim requires re-embedding all `document_chunks`. Acceptable for a demo; documented as a known migration cost.
- **Self-hosting story.** Supabase is self-hostable; a `docker-compose.yml` packaging the full local stack (Supabase + the app + Inngest dev server) is listed as Phase 5 polish, not v1.
- **Activity feed limit:** 10 most recent events (unchanged from original).
- **Status thresholds (unchanged):** Milestone Due Soon = 5 days before due date; Buyer follow-up overdue = 14 days since last touch.
