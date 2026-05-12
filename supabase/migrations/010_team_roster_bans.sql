-- Ban / unban support for roster management (testing + moderation).

create table if not exists public.team_bans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  banned_by uuid not null references auth.users (id) on delete cascade,
  banned_name text,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists team_bans_team_user_unique on public.team_bans (team_id, user_id);
create index if not exists team_bans_team_created_idx on public.team_bans (team_id, created_at desc);

alter table public.team_bans enable row level security;

create policy "team_bans_select_self_or_staff" on public.team_bans
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = team_bans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_bans_insert_staff" on public.team_bans
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = team_bans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_bans_delete_staff" on public.team_bans
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_bans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );
