-- TeamSnap-style upgrade: member league access, invite RPC, player stats, team logos.
-- Run in Supabase SQL Editor after reviewing policy names in your project.

-- Optional stats on roster players (basketball)
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS points int DEFAULT 0;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS assists int DEFAULT 0;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS rebounds int DEFAULT 0;

-- Public URL after upload to Storage bucket `team-logos`
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo_url text;

-- Track insert time for dashboards / notifications
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Resolve invite code to league id without listing all leagues (join flow)
CREATE OR REPLACE FUNCTION public.lookup_league_invite(p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM public.leagues l
  WHERE upper(trim(l.invite_code::text)) = upper(trim(p_code))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_league_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_league_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_league_invite(text) TO anon;

-- Members can read leagues they belong to (dashboard + league page)
DROP POLICY IF EXISTS "Users can select their own leagues" ON public.leagues;
DROP POLICY IF EXISTS "leagues_select_owner_or_member" ON public.leagues;

CREATE POLICY "leagues_select_owner_or_member"
  ON public.leagues FOR SELECT TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = leagues.id AND lm.user_id = (select auth.uid())
    )
  );

-- Owner can insert their own row as league owner in league_members (idempotent)
DROP POLICY IF EXISTS "league_members_insert_owner_row" ON public.league_members;

CREATE POLICY "league_members_insert_owner_row"
  ON public.league_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.leagues l
      WHERE l.id = league_members.league_id AND l.owner_id = (select auth.uid())
    )
  );
