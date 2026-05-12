/**
 * Per-league chat (Supabase + Realtime).
 */
"use strict";

import supabase from "./supabase.js";

export async function fetchLeagueMessages(leagueId) {
  let { data, error } = await supabase
    .from("league_messages")
    .select("id, user_id, message, created_at, sender_label, image_url")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: true });

  if (error && /sender_label|image_url|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const r2 = await supabase
      .from("league_messages")
      .select("id, user_id, message, created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true });
    data = r2.data;
    error = r2.error;
  }
  if (error) return [];
  return data || [];
}

export async function insertLeagueMessage(payload) {
  let { error } = await supabase.from("league_messages").insert(payload);
  if (error && /sender_label|image_url|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const { league_id, user_id, message } = payload;
    ({ error } = await supabase.from("league_messages").insert({ league_id, user_id, message }));
  }
  return { error };
}

export async function deleteLeagueMessage(msgId) {
  return supabase.from("league_messages").delete().eq("id", msgId);
}

export function subscribeLeagueMessages(leagueId, onChange) {
  return supabase
    .channel(`league_messages:${leagueId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "league_messages", filter: `league_id=eq.${leagueId}` },
      () => {
        if (typeof onChange === "function") onChange();
      }
    )
    .subscribe();
}

export function unsubscribeChannel(sub) {
  if (!sub) return;
  try {
    supabase.removeChannel(sub);
  } catch (_) {
    if (typeof sub.unsubscribe === "function") sub.unsubscribe();
  }
}
