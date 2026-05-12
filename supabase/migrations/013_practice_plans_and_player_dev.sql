-- Practice plan templates + player development (goals + coach notes).

create table if not exists public.practice_plans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  title text not null,
  content text not null default '',
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists practice_plans_team_updated on public.practice_plans (team_id, updated_at desc);

alter table public.practice_plans enable row level security;

create policy "practice_plans_select_team_members" on public.practice_plans
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = practice_plans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.team_id = practice_plans.team_id and p.user_id = auth.uid()
    )
  );

create policy "practice_plans_insert_staff" on public.practice_plans
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = practice_plans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    and auth.uid() = created_by
  );

create policy "practice_plans_update_staff" on public.practice_plans
  for update to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = practice_plans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.teams t
      where t.id = practice_plans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "practice_plans_delete_staff" on public.practice_plans
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = practice_plans.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

-- Player goals (visible to staff + the player)
create table if not exists public.player_goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  goal_text text not null,
  status text not null default 'active',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint player_goals_status_check check (status in ('active', 'done'))
);

create index if not exists player_goals_team_player on public.player_goals (team_id, player_id);

alter table public.player_goals enable row level security;

create policy "player_goals_select_staff_or_self" on public.player_goals
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = player_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.id = player_goals.player_id and p.user_id = auth.uid()
    )
  );

create policy "player_goals_insert_staff" on public.player_goals
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = player_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "player_goals_update_staff" on public.player_goals
  for update to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = player_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.teams t
      where t.id = player_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "player_goals_delete_staff" on public.player_goals
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = player_goals.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

-- Coach-only progress notes (staff)
create table if not exists public.player_coach_notes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  body text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists player_coach_notes_team_player on public.player_coach_notes (team_id, player_id, created_at desc);

alter table public.player_coach_notes enable row level security;

create policy "player_coach_notes_select_staff" on public.player_coach_notes
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = player_coach_notes.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

create policy "player_coach_notes_insert_staff" on public.player_coach_notes
  for insert to authenticated with check (
    exists (
      select 1 from public.teams t
      where t.id = player_coach_notes.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    and auth.uid() = created_by
  );

create policy "player_coach_notes_delete_staff" on public.player_coach_notes
  for delete to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = player_coach_notes.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );
