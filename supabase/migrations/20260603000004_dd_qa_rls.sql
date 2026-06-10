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
