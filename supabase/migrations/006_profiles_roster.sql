-- Public profiles for roster contact info (readable by teammates).
-- Run in Supabase SQL Editor after 005.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  birthday date,
  phone text,
  email text,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_id_idx on public.profiles (id);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "profiles_select_teammates" on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.players p_self
      inner join public.players p_other on p_self.team_id = p_other.team_id
      where p_self.user_id = auth.uid()
        and p_other.user_id = profiles.id
    )
  );

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
