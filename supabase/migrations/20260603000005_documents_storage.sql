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
