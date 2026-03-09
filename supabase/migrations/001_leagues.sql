-- Leagues table: one row per user-created league.
-- Run this in the Supabase Dashboard → SQL Editor.

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  owner_id uuid references auth.users (id) on delete cascade
);

-- Index for RLS and lookups by owner
create index if not exists leagues_owner_id_idx on public.leagues (owner_id);
create index if not exists leagues_slug_idx on public.leagues (slug);

-- Enable Row Level Security
alter table public.leagues enable row level security;

-- Drop policies if they exist so this script is safe to re-run.
drop policy if exists "Users can select their own leagues" on public.leagues;
drop policy if exists "Users can insert their own leagues" on public.leagues;
drop policy if exists "Users can update their own leagues" on public.leagues;
drop policy if exists "Users can delete their own leagues" on public.leagues;

-- Policies: authenticated users can only access their own leagues.
-- No one can see other people's leagues (select only where owner_id = auth.uid()).
create policy "Users can select their own leagues"
  on public.leagues for select to authenticated
  using (auth.uid() = owner_id);

create policy "Users can insert their own leagues"
  on public.leagues for insert to authenticated
  with check (auth.uid() = owner_id);

create policy "Users can update their own leagues"
  on public.leagues for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete their own leagues"
  on public.leagues for delete to authenticated
  using (auth.uid() = owner_id);

-- Optional: allow anonymous read for public leagues (e.g. browse without login).
-- Uncomment if you want everyone to see all leagues:
-- create policy "Anyone can view leagues"
--   on public.leagues for select to anon
--   using (true);
