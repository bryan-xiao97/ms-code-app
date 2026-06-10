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

-- NOTE: Phase 4 must CREATE OR REPLACE this view again to UNION ALL its event
-- sources (buyer_communications, generated buyers) alongside the qa events here.
-- Until then, deal_activity surfaces Q&A events only.
