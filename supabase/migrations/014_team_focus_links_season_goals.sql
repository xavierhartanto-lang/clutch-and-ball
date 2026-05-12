-- Team bulletin (focus), quick links, and season-wide goals visible to the whole team.

alter table public.teams add column if not exists team_focus text;
alter table public.teams add column if not exists team_focus_updated_at timestamptz;

create table if not exists public.team_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  label text not null,
  url text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists team_links_team_sort on public.team_links (team_id, sort_order, created_at);

alter table public.team_links enable row level security;

create policy "team_links_select_team_members" on public.team_links
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_links.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.team_id = team_links.team_id and p.user_id = auth.uid()
    )
  );

create policy "team_links_insert_staff" on public.team_links
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = team_links.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_links_update_staff" on public.team_links
  for update to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_links.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.teams t
      where t.id = team_links.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_links_delete_staff" on public.team_links
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_links.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create table if not exists public.team_season_goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  goal_text text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint team_season_goals_status_check check (status in ('active', 'done'))
);

create index if not exists team_season_goals_team on public.team_season_goals (team_id, created_at desc);

alter table public.team_season_goals enable row level security;

create policy "team_season_goals_select_team_members" on public.team_season_goals
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_season_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.team_id = team_season_goals.team_id and p.user_id = auth.uid()
    )
  );

create policy "team_season_goals_insert_staff" on public.team_season_goals
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = team_season_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_season_goals_update_staff" on public.team_season_goals
  for update to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_season_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.teams t
      where t.id = team_season_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "team_season_goals_delete_staff" on public.team_season_goals
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_season_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );
