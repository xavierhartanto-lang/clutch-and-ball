/**
 * Games / schedule API.
 */
"use strict";

import supabase from "./supabase.js";
import { fetchTeamRecord, updateTeamRecord } from "./teams.js";

export async function fetchGamesForLeague(leagueId) {
  let { data, error } = await supabase
    .from("games")
    .select("id, league_id, team1_id, team2_id, score1, score2, game_date, completed, game_time, game_location, game_court, team_format, created_at")
    .eq("league_id", leagueId)
    .order("game_date", { ascending: true, nullsFirst: false });

  if (error && /game_time|game_location|game_court|team_format|created_at|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const r2 = await supabase
      .from("games")
      .select("id, league_id, team1_id, team2_id, score1, score2, game_date, completed")
      .eq("league_id", leagueId)
      .order("game_date", { ascending: true, nullsFirst: false });
    data = r2.data;
    error = r2.error;
  }
  if (error) return [];
  return data || [];
}

export async function insertGame(payload) {
  let { error } = await supabase.from("games").insert(payload);
  if (error && /game_time|game_location|game_court|team_format|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const minimal = {
      league_id: payload.league_id,
      team1_id: payload.team1_id,
      team2_id: payload.team2_id,
      game_date: payload.game_date ?? null,
      completed: payload.completed ?? false
    };
    ({ error } = await supabase.from("games").insert(minimal));
  }
  return { error };
}

export async function deleteGameById(gameId) {
  return supabase.from("games").delete().eq("id", gameId);
}

/**
 * Set final score, mark complete, increment team W/L (simple: always adds one result per submit).
 */
export async function updateGameScoreAndStandings(gameId, score1, score2, gameRow) {
  const s1 = Number(score1) || 0;
  const s2 = Number(score2) || 0;

  const { error: upErr } = await supabase
    .from("games")
    .update({ score1: s1, score2: s2, completed: true })
    .eq("id", gameId);

  if (upErr) return { error: upErr };

  if (!gameRow?.team1_id || !gameRow?.team2_id) return { error: null };

  const { data: t1 } = await fetchTeamRecord(gameRow.team1_id);
  const { data: t2 } = await fetchTeamRecord(gameRow.team2_id);
  if (t1 && t2) {
    const w1 = Number(t1.wins) || 0;
    const l1 = Number(t1.losses) || 0;
    const w2 = Number(t2.wins) || 0;
    const l2 = Number(t2.losses) || 0;
    await updateTeamRecord(gameRow.team1_id, w1 + (s1 > s2 ? 1 : 0), l1 + (s1 < s2 ? 1 : 0));
    await updateTeamRecord(gameRow.team2_id, w2 + (s2 > s1 ? 1 : 0), l2 + (s2 < s1 ? 1 : 0));
  }
  return { error: null };
}

export async function fetchUpcomingGamesForLeagues(leagueIds, limit = 8) {
  if (!leagueIds.length) return [];

  const { data, error } = await supabase
    .from("games")
    .select("id, league_id, team1_id, team2_id, game_date, game_time, completed, score1, score2")
    .in("league_id", leagueIds)
    .eq("completed", false)
    .order("game_date", { ascending: true, nullsFirst: false })
    .limit(80);

  if (error) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const open = (data || []).filter((g) => g.score1 == null && g.score2 == null);
  const scored = open.filter((g) => {
    if (!g.game_date) return true;
    const d = new Date(g.game_date);
    return !Number.isNaN(d.getTime()) && d >= today;
  });

  return scored.slice(0, limit);
}
