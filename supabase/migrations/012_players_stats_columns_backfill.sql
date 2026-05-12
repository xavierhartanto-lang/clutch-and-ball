-- Ensure roster stat columns exist for team page editor.

alter table public.players add column if not exists points int default 0;
alter table public.players add column if not exists assists int default 0;
alter table public.players add column if not exists rebounds int default 0;
