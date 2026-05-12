/**
 * Players API (per team roster).
 */
"use strict";

import supabase from "./supabase.js";

export async function fetchPlayersForTeamIds(teamIds) {
  if (!teamIds.length) return [];
  let { data, error } = await supabase
    .from("players")
    .select("id, team_id, name, points, assists, rebounds, owner_id")
    .in("team_id", teamIds);

  if (error && /points|assists|rebounds|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const r2 = await supabase.from("players").select("id, team_id, name, owner_id").in("team_id", teamIds);
    data = r2.data;
    error = r2.error;
  }
  if (error) return [];
  return data || [];
}

export async function insertPlayer({ teamId, name, ownerId }) {
  const row = { team_id: teamId, name: name.trim(), owner_id: ownerId };
  return supabase.from("players").insert(row);
}

export async function deletePlayer(playerId) {
  return supabase.from("players").delete().eq("id", playerId);
}

export async function movePlayerToTeam(playerId, newTeamId) {
  return supabase.from("players").update({ team_id: newTeamId }).eq("id", playerId);
}

export async function updatePlayerStats(playerId, stats) {
  const payload = {};
  if (stats.points != null) payload.points = Number(stats.points) || 0;
  if (stats.assists != null) payload.assists = Number(stats.assists) || 0;
  if (stats.rebounds != null) payload.rebounds = Number(stats.rebounds) || 0;
  return supabase.from("players").update(payload).eq("id", playerId);
}
