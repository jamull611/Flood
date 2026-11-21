-- Adjuster Claim Tracker: cloud sync tables.
-- Run once in your Supabase project: Dashboard > SQL Editor > New query > paste > Run.
-- Then run 2-backups.sql the same way.
-- Each person only ever sees their own rows (row level security below).

create table if not exists public.claims (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),   -- set by the device that made the change
  server_at  timestamptz not null default now(),   -- set by the database; devices pull changes newer than this
  primary key (user_id, id)
);

create table if not exists public.tracker_settings (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  settings   jsonb,
  last_plan  jsonb,
  updated_at timestamptz not null default now(),
  server_at  timestamptz not null default now()
);

create index if not exists claims_user_server_at on public.claims (user_id, server_at);

-- Stamp server_at on every write so devices can ask "what changed since X?".
create or replace function public.touch_server_at() returns trigger
language plpgsql as $$
begin
  new.server_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists claims_touch on public.claims;
create trigger claims_touch before insert or update on public.claims
  for each row execute function public.touch_server_at();

drop trigger if exists settings_touch on public.tracker_settings;
create trigger settings_touch before insert or update on public.tracker_settings
  for each row execute function public.touch_server_at();

-- Row level security: you can only read and write your own claims and settings.
alter table public.claims enable row level security;
alter table public.tracker_settings enable row level security;

drop policy if exists "own claims" on public.claims;
create policy "own claims" on public.claims for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own settings" on public.tracker_settings;
create policy "own settings" on public.tracker_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates: other open devices hear about changes right away.
do $$
begin
  begin alter publication supabase_realtime add table public.claims; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.tracker_settings; exception when duplicate_object then null; end;
end $$;
