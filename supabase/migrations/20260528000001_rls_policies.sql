-- Enable RLS on all deal-scoped tables.
alter table public.deals          enable row level security;
alter table public.deal_members   enable row level security;
alter table public.milestones     enable row level security;

-- Helper: is the calling user a member of the given deal?
create or replace function public.is_deal_member(deal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deal_members dm
    where dm.deal_id = deal
      and dm.user_id = auth.uid()
  );
$$;

-- deals: members see and write their deals.
create policy deals_select_member on public.deals
  for select
  using (public.is_deal_member(id));

create policy deals_update_member on public.deals
  for update
  using (public.is_deal_member(id))
  with check (public.is_deal_member(id));

-- INSERT is allowed for any authenticated user; the server action that calls this
-- also inserts the creator into deal_members atomically (see Task 15).
create policy deals_insert_authenticated on public.deals
  for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- deal_members: a user sees only their own membership rows.
-- Inserts/deletes are restricted to the service role (lead-management UX is out of scope for v1).
create policy dm_select_self on public.deal_members
  for select
  using (user_id = auth.uid());

-- milestones: full CRUD for members of the parent deal.
create policy milestones_all_member on public.milestones
  for all
  using (public.is_deal_member(deal_id))
  with check (public.is_deal_member(deal_id));
