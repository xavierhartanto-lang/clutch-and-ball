# Supabase Setup for League Website

This document explains how to configure your Supabase database and Row-Level Security (RLS) to fix the **"new row violates row-level security policy"** error and ensure the league page works correctly.

---

## Database Structure

Create these tables in Supabase (Table Editor):

### 1. `leagues` (may already exist)

| Column     | Type      | Notes                  |
|------------|-----------|------------------------|
| id         | uuid      | Primary key, default `gen_random_uuid()` |
| name       | text      |                        |
| slug       | text      |                        |
| owner_id   | uuid      | References `auth.users(id)` |
| invite_code| text      | Unique 6-char code for joining (e.g. `AB12CD`) |
| sport      | text      | Optional — shown as subtitle on the league page |
| description| text      | Optional — rules / notes (HTML escaped in the app) |

Add `invite_code` as a unique column if the table already exists; the app generates it when creating a league.

**Add `sport` and `description` to an existing project** (no RLS changes):

```sql
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS sport text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS description text;
```

### 2. `teams`

| Column    | Type      | Notes                  |
|-----------|-----------|------------------------|
| id        | uuid      | Primary key, default `gen_random_uuid()` |
| name      | text      |                        |
| league_id | uuid      | References `leagues(id)` |
| owner_id  | uuid      | **Required for RLS** – same as `leagues.owner_id` for the league |
| wins      | int       | Default `0`            |
| losses    | int       | Default `0`            |

**Why `owner_id` on teams?**  
RLS policies must reference `auth.uid()` directly. The league owner is stored in `leagues.owner_id`, but RLS can't easily check "is the league's owner" in a single policy. By copying `owner_id` onto each team row when inserting, the policy can simply check `auth.uid() = owner_id`.

**Why `league_id`?**  
This links each team to a specific league so data is loaded only for the correct league.

### 3. `players`

| Column    | Type      | Notes                  |
|-----------|-----------|------------------------|
| id        | uuid      | Primary key, default `gen_random_uuid()` |
| team_id   | uuid      | References `teams(id)` |
| name      | text      |                        |

### 4. `games` (for schedule and results)

| Column        | Type      | Notes                  |
|---------------|-----------|------------------------|
| id            | uuid      | Primary key, default `gen_random_uuid()` |
| league_id     | uuid      | References `leagues(id)` |
| home_team_id  | uuid      | References `teams(id)` |
| away_team_id  | uuid      | References `teams(id)` |
| scheduled_at  | timestamptz | Nullable – game date/time |
| home_score    | int       | Nullable – home team score |
| away_score    | int       | Nullable – away team score |

Add these columns if the table already exists:
- `scheduled_at` – type `timestamptz`
- `home_score` – type `int4`
- `away_score` – type `int4`

---

## Adding `owner_id` and `wins`/`losses` to `teams`

If `teams` already exists but lacks these columns:

1. Open **Supabase Dashboard** → **Table Editor**
2. Select the **teams** table
3. Click **New column**
4. Add:
   - `owner_id` – type `uuid`
   - `wins` – type `int4`, default `0`
   - `losses` – type `int4`, default `0`
5. Save

For existing rows, set `owner_id` from the league:

```sql
UPDATE teams t
SET owner_id = l.owner_id
FROM leagues l
WHERE t.league_id = l.id
  AND t.owner_id IS NULL;
```

---

## Row-Level Security (RLS) – Fixing the Error

The error **"new row violates row-level security policy for table teams"** occurs when RLS is on but no policy allows the insert. Configure policies as follows.

### Step 1: Open Supabase Dashboard

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Log in and select your project

### Step 2: Enable RLS (if not already on)

1. Go to **Authentication** → **Policies**, or **Table Editor** → choose a table → **RLS**
2. Ensure RLS is **enabled** on `teams`, `leagues`, and `players`

### Step 3: Policies for `teams`

1. Go to **Table Editor** → **teams**
2. Open **RLS** / **Policies**
3. Add these policies:

**Select (read):**

- Name: `teams_select_own_league`
- Allowed operation: **SELECT**
- Target roles: `authenticated`
- Policy definition:

```sql
true
```

Or restrict to leagues the user owns:

```sql
EXISTS (
  SELECT 1 FROM leagues
  WHERE leagues.id = teams.league_id
    AND leagues.owner_id = auth.uid()
)
```

**Insert:**

- Name: `teams_insert_owner`
- Allowed operation: **INSERT**
- Target roles: `authenticated`
- Policy definition:

```sql
auth.uid() = owner_id
```

This requires `owner_id` on the inserted row to match the current user.

**Update:**

- Name: `teams_update_owner`
- Allowed operation: **UPDATE**
- Target roles: `authenticated`
- Policy definition:

```sql
auth.uid() = owner_id
```

**Delete:**

- Name: `teams_delete_owner`
- Allowed operation: **DELETE**
- Target roles: `authenticated`
- Policy definition:

```sql
auth.uid() = owner_id
```

### Step 4: Policies for `leagues`

**Select:**

- Name: `leagues_select_all` (or restrict by owner if you prefer)
- Allowed operation: **SELECT**
- Policy: `true`

**Insert:**

- Name: `leagues_insert_owner`
- Allowed operation: **INSERT**
- Policy: `auth.uid() = owner_id`

**Update:**

- Name: `leagues_update_owner`
- Allowed operation: **UPDATE**
- Policy: `auth.uid() = owner_id`

**Delete:**

- Name: `leagues_delete_owner`
- Allowed operation: **DELETE**
- Policy: `auth.uid() = owner_id`

### Step 5: Policies for `players`

**Select:**

- Policy: `true` (or restrict via `teams.owner_id` if you add a join)

**Insert / Update / Delete:**

Use policies that enforce ownership via teams, for example:

```sql
EXISTS (
  SELECT 1 FROM teams
  WHERE teams.id = players.team_id
    AND teams.owner_id = auth.uid()
)
```

Apply the same condition for UPDATE and DELETE as needed.

---

## Quick Policy Summary

| Table   | Operation | Policy condition                          |
|---------|-----------|-------------------------------------------|
| teams   | INSERT    | `auth.uid() = owner_id`                   |
| teams   | UPDATE    | `auth.uid() = owner_id`                   |
| teams   | DELETE    | `auth.uid() = owner_id`                   |
| leagues | INSERT    | `auth.uid() = owner_id`                   |
| leagues | UPDATE    | `auth.uid() = owner_id`                   |
| leagues | DELETE    | `auth.uid() = owner_id`                   |
| players | INSERT    | via `teams.owner_id = auth.uid()`         |
| players | UPDATE    | via `teams.owner_id = auth.uid()`         |
| players | DELETE    | via `teams.owner_id = auth.uid()`         |
| games   | SELECT    | `true` (or restrict by league)            |
| games   | INSERT    | league owner (see below)                  |
| games   | UPDATE    | league owner (see below)                  |
| games   | DELETE    | league owner (see below)                  |

For `games`, use a policy that checks league ownership:

```sql
EXISTS (
  SELECT 1 FROM leagues
  WHERE leagues.id = games.league_id
    AND leagues.owner_id = auth.uid()
)
```

---

## What the App Sends When Creating a Team

On "Add Team", the frontend sends:

```js
{
  name: "Team Alpha",
  league_id: "<league-uuid>",
  owner_id: "<current-user-uuid>",  // from league.owner_id
  wins: 0,
  losses: 0
}
```

Because `owner_id` equals `auth.uid()`, the RLS policy `auth.uid() = owner_id` allows the insert.

---

## Checklist

- [ ] `teams` has `owner_id`, `wins`, `losses`
- [ ] RLS enabled on `teams`, `leagues`, `players`
- [ ] INSERT policy on `teams`: `auth.uid() = owner_id`
- [ ] UPDATE/DELETE policies on `teams`: `auth.uid() = owner_id`
- [ ] Policies on `leagues` for INSERT/UPDATE/DELETE: `auth.uid() = owner_id`
- [ ] Policies on `players` referencing `teams.owner_id = auth.uid()` for INSERT/UPDATE/DELETE

---

## Expanded League Page (Roles, Chat, Schedule)

The league page uses these additional tables. Create them in Table Editor.

### `league_members`

| Column    | Type | Notes |
|-----------|------|--------|
| id        | uuid | Primary key, default `gen_random_uuid()` |
| league_id | uuid | References `leagues(id)` |
| user_id   | uuid | References `auth.users(id)` |
| role      | text | `'owner'` or `'member'` |

Add a **unique constraint** on `(league_id, user_id)` so the same user cannot join a league twice; duplicate-join attempts can be handled in the app.

Owner is also determined by `leagues.owner_id`; this table stores **members** (and optionally owner for consistency).

### `league_messages`

| Column    | Type      | Notes |
|-----------|-----------|--------|
| id        | uuid      | Primary key, default `gen_random_uuid()` |
| league_id | uuid      | References `leagues(id)` |
| user_id   | uuid      | References `auth.users(id)` |
| message   | text      | |
| created_at| timestamptz | Default `now()` |
| sender_label | text   | Optional — email or display name at send time (for chat UI) |

Enable **Realtime** for this table (Database → Replication) so chat updates live.

**Add `sender_label` without changing policies:**

```sql
ALTER TABLE league_messages ADD COLUMN IF NOT EXISTS sender_label text;
```

The app still works if this column is missing (it falls back for older rows and inserts).

### `games` (alternative schema for league page)

The league page can use either column naming. For the **expanded league page** (league.js), use:

| Column     | Type      | Notes |
|------------|-----------|--------|
| id         | uuid      | Primary key |
| league_id  | uuid      | References `leagues(id)` |
| team1_id   | uuid      | References `teams(id)` |
| team2_id   | uuid      | References `teams(id)` |
| score1     | int       | Nullable |
| score2     | int       | Nullable |
| game_date  | date or timestamptz | Nullable |
| completed  | boolean   | Default `false` |

If you already have `home_team_id`/`away_team_id`/`home_score`/`away_score`, you can add `team1_id`, `team2_id`, `score1`, `score2`, `game_date`, `completed` and use the same table, or rename columns to match league.js.

### `players` — add `owner_id`

For the expanded league page, add an `owner_id` (uuid) column to `players` so RLS can allow league owner to manage players.

---

## Team dashboard, member access, player stats, logos (`003_teamsnap_upgrade.sql`)

Run **`supabase/migrations/003_teamsnap_upgrade.sql`** in the SQL Editor to:

- Add optional **`points`**, **`assists`**, **`rebounds`** on `players`
- Add **`logo_url`** on `teams` (use with Storage bucket below)
- Add **`created_at`** on `games` (optional, for future notifications)
- Create **`lookup_league_invite(p_code)`** so join-by-code works without exposing every league row
- Broaden **`leagues` SELECT** so **owners and `league_members`** can read league rows (dashboard + league page for members)

**Storage:** create a **public** bucket named **`team-logos`** (same idea as `league-chat-images`). Owners upload from the league page “Team logo” action.

If your existing `leagues` SELECT policy uses a **different name** than `Users can select their own leagues`, drop that policy manually before running the migration, or edit the `DROP POLICY` lines to match.

---

## Fix: League Deletion Foreign Key Error

If you get **"violates foreign key constraint"** when deleting a league (e.g. `league_messages_league_id_fkey`), run the CASCADE migration:

**Run in Supabase SQL Editor:** Copy and paste the contents of `supabase/migrations/002_cascade_delete_leagues.sql`

This adds `ON DELETE CASCADE` to foreign keys so deleting a league automatically removes all related data (messages, members, games, teams, players).

---

## New Features SQL (copy/paste)

Run this safely in Supabase SQL Editor:

```sql
-- leagues customization
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS theme text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS hero_tagline text;

-- set default values for existing rows
UPDATE leagues SET sport = COALESCE(sport, 'basketball');
UPDATE leagues SET theme = COALESCE(theme, 'default');

-- games extended details
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_time text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_location text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_court text;
ALTER TABLE games ADD COLUMN IF NOT EXISTS team_format text;

-- chat image support
ALTER TABLE league_messages ADD COLUMN IF NOT EXISTS image_url text;

-- avoid duplicate joins
WITH ranked AS (
  SELECT ctid, ROW_NUMBER() OVER (
    PARTITION BY league_id, user_id
    ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, ctid
  ) AS rn
  FROM league_members
)
DELETE FROM league_members lm
USING ranked r
WHERE lm.ctid = r.ctid
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS league_members_league_user_unique_idx
ON league_members (league_id, user_id);
```

### Chat Image Storage Setup

1. Go to **Storage** in Supabase.
2. Create bucket: `league-chat-images`.
3. Set it as **Public**.
4. (Optional) Add file size limit / image MIME restrictions in bucket settings.

The app uploads chat images to this bucket and stores public URLs in `league_messages.image_url`.

---

### Team-first app (coach / players / calendar)

If you use the home page coach flow, **Log Game**, **Calendar**, and team codes, run the SQL in **`supabase/migrations/005_invite_players_games_calendar.sql`** in the Supabase SQL Editor (after `004_team_first_schema.sql`).

It adds:

- `teams.invite_code` — shareable join code for players  
- `players.user_id` — links roster rows to `auth.users` when someone joins with a code  
- `games.opponent_name` and nullable `team2_id` — log a game vs a named opponent (no second team row)  
- `calendar_events` — personal/team events for the Calendar page
