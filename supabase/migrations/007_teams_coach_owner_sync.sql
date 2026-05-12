-- Align legacy `owner_id` with Clutch `coach_id` so team pages recognize coaches either way.

alter table public.teams add column if not exists owner_id uuid references auth.users (id) on delete set null;

-- Backfill: whichever side was set first
update public.teams
set coach_id = owner_id
where coach_id is null and owner_id is not null;

update public.teams
set owner_id = coach_id
where owner_id is null and coach_id is not null;

create index if not exists teams_owner_id_idx on public.teams (owner_id)
  where owner_id is not null;
