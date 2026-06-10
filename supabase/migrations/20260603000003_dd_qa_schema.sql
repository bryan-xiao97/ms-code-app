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
