-- FHDC RecallDesk Supabase bridge schema
-- This first production bridge stores the existing RecallDesk application store in Supabase
-- so the hosted Render app does not depend on temporary local files.
-- A later migration can normalize these JSON arrays into separate relational tables.

create extension if not exists pgcrypto;

create table if not exists public.recalldesk_app_store (
  id text primary key check (id = 'main'),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recalldesk_app_store enable row level security;

-- No public RLS policies are created. The app uses the server-side Supabase secret/service key.
-- Do not expose the secret key in browser code or GitHub.

create or replace function public.set_recalldesk_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_recalldesk_app_store_updated_at on public.recalldesk_app_store;
create trigger trg_recalldesk_app_store_updated_at
before update on public.recalldesk_app_store
for each row execute function public.set_recalldesk_updated_at();

insert into public.recalldesk_app_store (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;
