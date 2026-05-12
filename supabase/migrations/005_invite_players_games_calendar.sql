-- Team invite codes, roster via auth user, log games vs named opponent, calendar events.
-- Run in Supabase SQL Editor after 004_team_first_schema.sql.

alter table public.teams add column if not exists invite_code text;
create unique index if not exists teams_invite_code_key on public.teams (invite_code)
  where invite_code is not null;

alter table public.players add column if not exists user_id uuid references auth.users (id) on delete cascade;
create unique index if not exists players_team_user_unique on public.players (team_id, user_id)
  where user_id is not null;

alter table public.games drop constraint if exists games_different_teams;
alter table public.games alter column team2_id drop not null;
alter table public.games add column if not exists opponent_name text;

alter table public.games drop constraint if exists games_opponent_chk;
alter table public.games add constraint games_opponent_chk check (
  (
    team2_id is not null
    and team1_id is distinct from team2_id
    and (opponent_name is null or btrim(opponent_name) = '' )
  )
  or
  (
    team2_id is null
    and opponent_name is not null
    and length(btrim(opponent_name)) > 0
  )
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  title text not null,
  kind text not null default 'event',
  starts_at timestamptz not null,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint calendar_events_kind_check check (kind in ('event', 'game', 'practice', 'other'))
);

create index if not exists calendar_events_user_starts on public.calendar_events (user_id, starts_at);
create index if not exists calendar_events_team_starts on public.calendar_events (team_id, starts_at)
  where team_id is not null;

alter table public.calendar_events enable row level security;

create policy "calendar_events_select_authenticated" on public.calendar_events
  for select to authenticated using (true);
create policy "calendar_events_insert_authenticated" on public.calendar_events
  for insert to authenticated with check (auth.uid() = user_id);
create policy "calendar_events_update_authenticated" on public.calendar_events
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "calendar_events_delete_authenticated" on public.calendar_events
  for delete to authenticated using (auth.uid() = user_id);
