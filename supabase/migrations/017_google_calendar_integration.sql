-- Google Calendar OAuth + per-user sync maps (Edge Functions use service role).

create table if not exists public.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null unique,
  code_verifier text not null,
  redirect_origin text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists google_oauth_states_expires_idx on public.google_oauth_states (expires_at);

alter table public.google_oauth_states enable row level security;

-- No policies: only service role (Edge) reads/writes.

create table if not exists public.user_google_calendar_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  google_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_google_calendar_links enable row level security;

-- Users may disconnect their own link row (delete). Inserts/updates only via service role.

create policy "user_google_calendar_links_delete_own"
  on public.user_google_calendar_links for delete to authenticated
  using (auth.uid() = user_id);

create table if not exists public.user_calendar_google_event_maps (
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_event_id uuid not null references public.calendar_events (id) on delete cascade,
  google_event_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, calendar_event_id)
);

create index if not exists user_calendar_google_maps_event_idx
  on public.user_calendar_google_event_maps (calendar_event_id);

alter table public.user_calendar_google_event_maps enable row level security;

-- Users can read their own maps (optional UI). Writes only via service role.

create policy "user_calendar_google_maps_select_own"
  on public.user_calendar_google_event_maps for select to authenticated
  using (auth.uid() = user_id);

create policy "user_calendar_google_maps_delete_own"
  on public.user_calendar_google_event_maps for delete to authenticated
  using (auth.uid() = user_id);
