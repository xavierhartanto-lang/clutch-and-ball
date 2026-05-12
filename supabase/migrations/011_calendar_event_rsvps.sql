-- Attendance / availability for team calendar events.

create table if not exists public.calendar_event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_rsvps_status_check check (status in ('available', 'late', 'out'))
);

create unique index if not exists calendar_event_rsvps_event_user_unique on public.calendar_event_rsvps (event_id, user_id);
create index if not exists calendar_event_rsvps_event_idx on public.calendar_event_rsvps (event_id);

alter table public.calendar_event_rsvps enable row level security;

create policy "calendar_event_rsvps_select_team_participants" on public.calendar_event_rsvps
  for select to authenticated using (
    exists (
      select 1
      from public.calendar_events ev
      left join public.teams t on t.id = ev.team_id
      where ev.id = calendar_event_rsvps.event_id
        and (
          ev.user_id = auth.uid()
          or (t.id is not null and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid()))
          or exists (
            select 1 from public.players p
            where p.team_id = ev.team_id and p.user_id = auth.uid()
          )
        )
    )
  );

create policy "calendar_event_rsvps_insert_own" on public.calendar_event_rsvps
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.calendar_events ev
      left join public.teams t on t.id = ev.team_id
      where ev.id = calendar_event_rsvps.event_id
        and (
          ev.user_id = auth.uid()
          or (t.id is not null and (t.coach_id = auth.uid() or t.owner_id = auth.uid() or t.assistant_coach_id = auth.uid()))
          or exists (
            select 1 from public.players p
            where p.team_id = ev.team_id and p.user_id = auth.uid()
          )
        )
    )
  );

create policy "calendar_event_rsvps_update_own" on public.calendar_event_rsvps
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "calendar_event_rsvps_delete_own" on public.calendar_event_rsvps
  for delete to authenticated using (auth.uid() = user_id);
