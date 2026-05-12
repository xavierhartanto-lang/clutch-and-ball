-- Shared Clutch & Ball Olympics event signups.
-- Stores one row per event/team/slot so all visitors see same picks.

create table if not exists public.olympics_event_signups (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  team_key text not null,
  slot_index int not null,
  player_id text,
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint olympics_event_signups_event_check
    check (event_key in ('three', 'impact', 'race', 'freethrow', 'layup', 'trivia')),
  constraint olympics_event_signups_team_check
    check (team_key in ('asia', 'america', 'india')),
  constraint olympics_event_signups_slot_check
    check (slot_index >= 0 and slot_index <= 4),
  constraint olympics_event_signups_unique_slot
    unique (event_key, team_key, slot_index)
);

create index if not exists olympics_event_signups_lookup
  on public.olympics_event_signups (event_key, team_key, slot_index);

alter table public.olympics_event_signups enable row level security;

create policy "olympics_signups_select_all" on public.olympics_event_signups
  for select to anon, authenticated using (true);

create policy "olympics_signups_insert_all" on public.olympics_event_signups
  for insert to anon, authenticated with check (true);

create policy "olympics_signups_update_all" on public.olympics_event_signups
  for update to anon, authenticated using (true) with check (true);

create policy "olympics_signups_delete_all" on public.olympics_event_signups
  for delete to anon, authenticated using (true);
