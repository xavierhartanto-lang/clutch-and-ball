-- Team chat, profile bio / highlight reels, coaches viewing roster profiles

alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists highlight_reel_urls text;

-- Coaches can view profiles of players on their teams (in addition to teammate policy)
create policy "profiles_select_team_coach" on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.players p
      inner join public.teams t on t.id = p.team_id
      where p.user_id = profiles.id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid())
    )
  );

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_messages_team_created on public.team_messages (team_id, created_at desc);

alter table public.team_messages enable row level security;

create policy "team_messages_select_members" on public.team_messages
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_messages.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.team_id = team_messages.team_id and p.user_id = auth.uid()
    )
  );

create policy "team_messages_insert_members" on public.team_messages
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.teams t
        where t.id = team_id and (t.coach_id = auth.uid() or t.owner_id = auth.uid())
      )
      or exists (
        select 1 from public.players p
        where p.team_id = team_id and p.user_id = auth.uid()
      )
    )
  );

create policy "team_messages_delete_own_or_coach" on public.team_messages
  for delete to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = team_messages.team_id and (t.coach_id = auth.uid() or t.owner_id = auth.uid())
    )
  );
