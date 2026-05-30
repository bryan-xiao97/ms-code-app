-- Initial schema: deals, deal_members, milestones.
-- Identity reuses Supabase's built-in auth.users table.

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_company text not null,
  sector text,
  stage text not null default 'preparation'
    check (stage in ('preparation','marketing_cim','buyer_gtm','detailed_dd','close')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create index deals_created_by_idx on public.deals (created_by);

create table public.deal_members (
  deal_id uuid not null references public.deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('lead','member','viewer')),
  added_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);

create index deal_members_user_idx on public.deal_members (user_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  name text not null,
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  created_at timestamptz not null default now()
);

create index milestones_deal_idx on public.milestones (deal_id);

-- pgvector extension enabled now so later phases don't require an extra migration.
create extension if not exists vector;
