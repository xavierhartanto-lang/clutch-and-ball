-- Clutch and Ball — team-first schema (no leagues)
-- Run in Supabase SQL Editor on a fresh project.
--
-- If old public tables exist, drop them first (order matters for FKs), e.g.:
--   drop table if exists public.games cascade;
--   drop table if exists public.players cascade;
--   drop table if exists public.teams cascade;

-- Ensure extension for gen_random_uuid()
create extension if not exists "pgcrypto";

-- 1. TEAMS
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  coach_id uuid references auth.users (id) on delete set null,
  wins int not null default 0,
  losses int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists teams_coach_id_idx on public.teams (coach_id);

-- 2. PLAYERS
create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_id uuid not null references public.teams (id) on delete cascade,
  points int not null default 0
);

create index if not exists players_team_id_idx on public.players (team_id);

-- 3. GAMES
create table public.games (
  id uuid primary key default gen_random_uuid(),
  team1_id uuid not null references public.teams (id) on delete cascade,
  team2_id uuid not null references public.teams (id) on delete cascade,
  team1_score int,
  team2_score int,
  game_date timestamptz not null default now(),
  constraint games_different_teams check (team1_id <> team2_id)
);

create index if not exists games_team1_idx on public.games (team1_id);
create index if not exists games_team2_idx on public.games (team2_id);

-- Row Level Security
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.games enable row level security;

-- Simple permissive policies for authenticated users (tighten later for production)
create policy "teams_select_all" on public.teams for select to authenticated using (true);
create policy "teams_insert_all" on public.teams for insert to authenticated with check (true);
create policy "teams_update_all" on public.teams for update to authenticated using (true) with check (true);
create policy "teams_delete_all" on public.teams for delete to authenticated using (true);

create policy "players_select_all" on public.players for select to authenticated using (true);
create policy "players_insert_all" on public.players for insert to authenticated with check (true);
create policy "players_update_all" on public.players for update to authenticated using (true) with check (true);
create policy "players_delete_all" on public.players for delete to authenticated using (true);

create policy "games_select_all" on public.games for select to authenticated using (true);
create policy "games_insert_all" on public.games for insert to authenticated with check (true);
create policy "games_update_all" on public.games for update to authenticated using (true) with check (true);
create policy "games_delete_all" on public.games for delete to authenticated using (true);
