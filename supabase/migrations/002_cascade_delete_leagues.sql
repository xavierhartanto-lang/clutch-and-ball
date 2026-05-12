-- Add ON DELETE CASCADE so deleting a league removes all related data.
-- Run in Supabase SQL Editor if you get "violates foreign key constraint" when deleting a league.

-- league_members
ALTER TABLE public.league_members
  DROP CONSTRAINT IF EXISTS league_members_league_id_fkey;

ALTER TABLE public.league_members
  ADD CONSTRAINT league_members_league_id_fkey
  FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

-- league_messages
ALTER TABLE public.league_messages
  DROP CONSTRAINT IF EXISTS league_messages_league_id_fkey;

ALTER TABLE public.league_messages
  ADD CONSTRAINT league_messages_league_id_fkey
  FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

-- games
ALTER TABLE public.games
  DROP CONSTRAINT IF EXISTS games_league_id_fkey;

ALTER TABLE public.games
  ADD CONSTRAINT games_league_id_fkey
  FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

-- teams
ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_league_id_fkey;

ALTER TABLE public.teams
  ADD CONSTRAINT teams_league_id_fkey
  FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;

-- players (cascade when team is deleted)
ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_team_id_fkey;

ALTER TABLE public.players
  ADD CONSTRAINT players_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
