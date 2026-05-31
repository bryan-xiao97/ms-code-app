-- Local dev seed. Runs after migrations on `supabase db reset`.
-- Creates a demo user and a sample deal so the UI is not empty on first boot.

do $$
declare
  demo_user_id uuid;
  demo_deal_id uuid;
begin
  -- Create demo user via auth schema (idempotent if email already exists).
  select id into demo_user_id from auth.users where email = 'demo@local.test';
  if demo_user_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      'demo@local.test', crypt('demo-password-12345', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}',
      now(), now(), '', '', '', ''
    ) returning id into demo_user_id;

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), demo_user_id,
      jsonb_build_object('sub', demo_user_id::text, 'email', 'demo@local.test'),
      'email', demo_user_id::text, now(), now(), now()
    );
  end if;

  -- Sample deal
  insert into public.deals (name, target_company, sector, stage, created_by)
  values ('Project Atlas', 'Atlas Robotics', 'Industrials', 'marketing_cim', demo_user_id)
  returning id into demo_deal_id;

  insert into public.deal_members (deal_id, user_id, role)
  values (demo_deal_id, demo_user_id, 'lead');

  insert into public.milestones (deal_id, name, due_date, status) values
    (demo_deal_id, 'Kickoff meeting',        current_date - 14, 'done'),
    (demo_deal_id, 'CIM draft v1',           current_date - 3,  'done'),
    (demo_deal_id, 'CIM final review',       current_date + 3,  'pending'),
    (demo_deal_id, 'Launch buyer outreach',  current_date + 21, 'pending');
end $$;
