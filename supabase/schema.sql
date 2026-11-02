-- Run once in Supabase: SQL Editor → New query → paste → Run.
-- One row per user holding their whole tracker as JSON.
create table if not exists public.trackers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.trackers enable row level security;

-- Each signed-in user can only see and change their own row.
drop policy if exists "read own tracker" on public.trackers;
drop policy if exists "insert own tracker" on public.trackers;
drop policy if exists "update own tracker" on public.trackers;
create policy "read own tracker"   on public.trackers for select to authenticated using (auth.uid() = user_id);
create policy "insert own tracker" on public.trackers for insert to authenticated with check (auth.uid() = user_id);
create policy "update own tracker" on public.trackers for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
