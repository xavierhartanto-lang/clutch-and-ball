-- Assistant coach support + permissions for team chat and team calendar management.

alter table public.teams add column if not exists assistant_coach_id uuid references auth.users (id) on delete set null;
alter table public.teams add column if not exists assistant_invite_code text;

create index if not exists teams_assistant_coach_id_idx on public.teams (assistant_coach_id)
  where assistant_coach_id is not null;

create unique index if not exists teams_assistant_invite_code_key on public.teams (assistant_invite_code)
  where assistant_invite_code is not null;

drop policy if exists "team_messages_select_members" on public.team_messages;
create policy "team_messages_select_members" on public.team_messages
  for select to authenticated using (
    exists (
      select 1 from public.teams t
      where t.id = team_messages.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
    or exists (
      select 1 from public.players p
      where p.team_id = team_messages.team_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "team_messages_insert_members" on public.team_messages;
create policy "team_messages_insert_members" on public.team_messages
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.teams t
        where t.id = team_id and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
      )
      or exists (
        select 1 from public.players p
        where p.team_id = team_id and p.user_id = auth.uid()
      )
    )
  );

drop policy if exists "team_messages_delete_own_or_coach" on public.team_messages;
create policy "team_messages_delete_own_or_coach" on public.team_messages
  for delete to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = team_messages.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

drop policy if exists "calendar_events_insert_authenticated" on public.calendar_events;
create policy "calendar_events_insert_authenticated" on public.calendar_events
  for insert to authenticated with check (
    auth.uid() = user_id
    and (
      team_id is null
      or exists (
        select 1 from public.teams t
        where t.id = calendar_events.team_id
          and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
      )
    )
  );

drop policy if exists "calendar_events_update_authenticated" on public.calendar_events;
create policy "calendar_events_update_authenticated" on public.calendar_events
  for update to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = calendar_events.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = calendar_events.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );

drop policy if exists "calendar_events_delete_authenticated" on public.calendar_events;
create policy "calendar_events_delete_authenticated" on public.calendar_events
  for delete to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.teams t
      where t.id = calendar_events.team_id
        and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid())
    )
  );
