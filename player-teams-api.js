/**
 * Shared: player roster — list, join by code, leave team.
 */
"use strict";

import supabase from "./supabase.js";
import { rosterDisplayName, fetchTeamsCoachedByUser } from "./coach-shared.js";

function normalizeCode(raw) {
  return String(raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Teams you created as coach (no `players` row required). Uses coach_id or legacy owner_id. */
export async function fetchCoachedTeamsList(userId) {
  const { data, error } = await fetchTeamsCoachedByUser(userId);

  if (error) return { error: error.message, items: [] };

  const items = (data || []).map((t) => ({
    teamId: t.id,
    teamName: t.name,
    logoUrl: t.logo_url || null,
    role: "coach"
  }));

  return { items };
}

export async function fetchPlayerTeamsList(userId) {
  const { data: rows, error } = await supabase
    .from("players")
    .select("id, team_id")
    .eq("user_id", userId);

  if (error) return { error: error.message, items: [] };

  const pr = rows || [];
  if (!pr.length) return { items: [] };

  const ids = [...new Set(pr.map((r) => r.team_id).filter(Boolean))];
  let { data: trows, error: terr } = await supabase
    .from("teams")
    .select("id, name, logo_url")
    .in("id", ids)
    .order("name");

  if (terr && /logo_url|schema cache|PGRST204|42703/i.test(String(terr.message || ""))) {
    const retry = await supabase.from("teams").select("id, name").in("id", ids).order("name");
    trows = retry.data;
    terr = retry.error;
  }

  if (terr) return { error: terr.message, items: [] };

  const rowByTeam = Object.fromEntries(pr.map((r) => [r.team_id, r.id]));
  const items = (trows || []).map((t) => ({
    teamId: t.id,
    teamName: t.name,
    logoUrl: t.logo_url || null,
    membershipId: rowByTeam[t.id],
    role: "player"
  }));

  return { items };
}

export async function joinTeamByCode(user, rawCode) {
  const code = normalizeCode(rawCode);
  if (code.length < 4) return { ok: false, message: "Enter a valid team code." };

  const { data: team, error: findErr } = await supabase
    .from("teams")
    .select("id, name, invite_code")
    .eq("invite_code", code)
    .maybeSingle();

  if (findErr) return { ok: false, message: findErr.message };
  if (!team) return { ok: false, message: "No team found for that code." };

  const { data: banRow, error: banErr } = await supabase
    .from("team_bans")
    .select("id")
    .eq("team_id", team.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (banErr && !/team_bans|does not exist/i.test(banErr.message || "")) {
    return { ok: false, message: banErr.message };
  }
  if (banRow) {
    return { ok: false, message: "You were removed from this roster and cannot rejoin right now." };
  }

  const name = rosterDisplayName(user);
  const { error: insErr } = await supabase.from("players").insert({
    team_id: team.id,
    user_id: user.id,
    name,
    points: 0
  });

  if (insErr) {
    if (/duplicate|unique/i.test(insErr.message)) {
      return { ok: false, message: "You are already on that team." };
    }
    return { ok: false, message: insErr.message };
  }

  const { error: profErr } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      full_name: name,
      email: user.email || null
    },
    { onConflict: "id" }
  );
  if (profErr && /profiles|relation|does not exist/i.test(profErr.message || "")) {
    /* optional until migration 006 */
  }

  return { ok: true, message: `Joined ${team.name}.`, team };
}

export async function leaveTeam(userId, teamId) {
  const { error } = await supabase
    .from("players")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export function notifyPlayerTeamsUpdated() {
  document.dispatchEvent(new CustomEvent("clutch:player-teams-updated"));
}

export function notifyCoachedTeamsUpdated() {
  document.dispatchEvent(new CustomEvent("clutch:coached-teams-updated"));
}

/** Keep `players.name` in sync with Account name so sorting and fallbacks stay correct. */
export async function syncPlayerRosterNames(userId, displayName) {
  const name = String(displayName || "").trim();
  if (!userId || !name) return { error: null };
  const { error } = await supabase.from("players").update({ name }).eq("user_id", userId);
  return { error };
}
