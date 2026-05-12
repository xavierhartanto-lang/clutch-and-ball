/**
 * Teams API (per league).
 */
"use strict";

import supabase from "./supabase.js";

export async function fetchTeamsForLeague(leagueId) {
  let q = supabase.from("teams").select("id, name, wins, losses, logo_url, league_id, owner_id").eq("league_id", leagueId);
  const { data, error } = await q;
  if (error && /logo_url|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const r2 = await supabase.from("teams").select("id, name, wins, losses, league_id, owner_id").eq("league_id", leagueId);
    return r2.data || [];
  }
  if (error) return [];
  return data || [];
}

export async function insertTeam({ name, leagueId, ownerId }) {
  const row = {
    name: name.trim(),
    league_id: leagueId,
    owner_id: ownerId,
    wins: 0,
    losses: 0
  };
  return supabase.from("teams").insert(row);
}

export async function deleteTeam(teamId) {
  return supabase.from("teams").delete().eq("id", teamId);
}

export async function fetchTeamRecord(teamId) {
  const { data, error } = await supabase.from("teams").select("wins, losses").eq("id", teamId).single();
  return { data, error };
}

export async function updateTeamRecord(teamId, wins, losses) {
  return supabase.from("teams").update({ wins, losses }).eq("id", teamId);
}

export async function updateTeamLogoUrl(teamId, logoUrl) {
  return supabase.from("teams").update({ logo_url: logoUrl }).eq("id", teamId);
}
