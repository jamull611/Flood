-- Update 3: "On my way" reminders (phone notifications when you're about 20 minutes out).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to run more than once.
-- Do this AFTER deploying the "reminders" Edge Function (see README).

-- Phones that can receive reminders (one row per phone/browser, per person).
create table if not exists public.push_subscriptions (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  endpoint   text        not null,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reminders waiting to be sent.
create table if not exists public.reminders (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  claim_id   text,
  fire_at    timestamptz not null,
  title      text        not null,
  body       text,
  url        text,
  cancelled  boolean     not null default false,
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now()
);
create index if not exists reminders_due on public.reminders (fire_at) where sent_at is null and not cancelled;
alter table public.reminders enable row level security;
drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The server's notification keys. No policies: only the Edge Function (service role) can read it.
create table if not exists public.push_config (
  id          integer primary key check (id = 1),
  public_key  text not null,
  private_key text not null
);
alter table public.push_config enable row level security;

-- Every minute, ask the Edge Function to send any reminders that are due.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'send-reminders';
select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://xvhhhhugwsoxytovhhbb.supabase.co/functions/v1/reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
