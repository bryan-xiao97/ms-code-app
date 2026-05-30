-- Activity feed view.
-- Phase 2 ships this view but it returns empty until Phase 3 (qa_log) and
-- Phase 4 (buyer_communications, buyers) populate their tables.
--
-- We can't reference tables that don't exist yet, so we ship the view in
-- a Phase-1+2 friendly form: it sources only from a placeholder query that
-- returns no rows. Phase 3 and 4 migrations will REPLACE this view with the
-- full UNION ALL definition once their tables exist.

create or replace view public.deal_activity as
  select
    'placeholder'::text as kind,
    gen_random_uuid()    as id,
    d.id                 as deal_id,
    d.created_at         as occurred_at,
    jsonb_build_object() as payload
  from public.deals d
  where false;  -- always empty until Phase 3/4 redefine this view

-- Inherit RLS via the underlying deals table.
alter view public.deal_activity owner to postgres;
