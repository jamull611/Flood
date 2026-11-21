-- Update 2: daily cloud backups.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run more than once.
-- The tracker saves one copy of all your claims and settings per day and keeps the last 30 days.

create table if not exists public.snapshots (
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  day         date        not null,
  data        jsonb       not null,
  claim_count integer,
  created_at  timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.snapshots enable row level security;

drop policy if exists "own snapshots" on public.snapshots;
create policy "own snapshots" on public.snapshots for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Helps the "Recently deleted claims" list.
create index if not exists claims_user_deleted on public.claims (user_id, deleted, updated_at);
