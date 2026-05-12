/**
 * League CRUD, invite/join, membership helpers.
 */
"use strict";

import supabase from "./supabase.js";

export function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Resolve league id by invite code (prefers RPC if migration applied).
 */
export async function findLeagueIdByInviteCode(trimmedUpper) {
  const trimmed = String(trimmedUpper).trim().toUpperCase();
  if (!trimmed || trimmed.length !== 6) return { leagueId: null, error: "Enter a 6-character invite code." };

  const rpc = await supabase.rpc("lookup_league_invite", { p_code: trimmed });
  if (!rpc.error && rpc.data != null && rpc.data !== "") {
    let id = rpc.data;
    if (Array.isArray(id)) id = id[0];
    if (id && typeof id === "object" && "id" in id) id = id.id;
    if (typeof id === "string" && id.length > 0) return { leagueId: id, error: null };
  }

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id")
    .eq("invite_code", trimmed)
    .maybeSingle();

  if (leagueError || !league) return { leagueId: null, error: "Invalid or expired invite code." };
  return { leagueId: league.id, error: null };
}

export async function joinLeagueByCode(code) {
  const trimmed = String(code).trim().toUpperCase();
  if (!trimmed || trimmed.length !== 6) return { error: "Enter a 6-character invite code." };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to join a league." };

  const { leagueId, error: lookupError } = await findLeagueIdByInviteCode(trimmed);
  if (lookupError || !leagueId) return { error: lookupError || "Invalid or expired invite code." };

  const { error: memberError } = await supabase
    .from("league_members")
    .insert({ league_id: leagueId, user_id: user.id, role: "member" });

  if (memberError) {
    if (memberError.code === "23505") return { leagueId };
    return { error: memberError.message };
  }
  return { leagueId };
}

/**
 * Insert owner row into league_members (optional; ignore duplicate / RLS errors).
 */
export async function ensureOwnerMembershipRow(leagueId, userId) {
  const { error } = await supabase
    .from("league_members")
    .insert({ league_id: leagueId, user_id: userId, role: "owner" });
  if (error && error.code !== "23505") {
    console.warn("ensureOwnerMembershipRow:", error.message);
  }
}

export async function fetchLeagueById(leagueId) {
  let { data, error } = await supabase
    .from("leagues")
    .select("id, name, owner_id, invite_code, sport, description, theme, hero_tagline")
    .eq("id", leagueId)
    .single();

  if (error && /sport|description|theme|hero_tagline|schema cache|PGRST204|42703/i.test(error.message || "")) {
    const r2 = await supabase
      .from("leagues")
      .select("id, name, owner_id, invite_code")
      .eq("id", leagueId)
      .single();
    data = r2.data;
    error = r2.error;
  }
  return { data, error };
}

export async function deleteLeagueById(leagueId) {
  return supabase.from("leagues").delete().eq("id", leagueId);
}

export async function updateLeagueHeroTagline(leagueId, heroTagline) {
  return supabase.from("leagues").update({ hero_tagline: heroTagline || null }).eq("id", leagueId);
}

/**
 * Leagues the user owns plus leagues they joined as member.
 */
export async function fetchUserLeaguesBundle(userId) {
  const { data: owned, error: ownedErr } = await supabase
    .from("leagues")
    .select("id, name, slug, invite_code, sport, theme, owner_id, created_at")
    .eq("owner_id", userId);

  if (ownedErr) {
    console.warn("fetchUserLeaguesBundle (owned leagues):", ownedErr.message || String(ownedErr));
  }

  const { data: memberships, error: memErr } = await supabase
    .from("league_members")
    .select("league_id, role")
    .eq("user_id", userId);

  if (memErr) {
    console.warn("fetchUserLeaguesBundle (league_members):", memErr.message || String(memErr));
  }

  const ownedRows = owned || [];
  const ownedIds = new Set(ownedRows.map((r) => r.id));
  const memberIds = (memberships || [])
    .map((m) => m.league_id)
    .filter((id) => id && !ownedIds.has(id));

  let memberRows = [];
  if (memberIds.length) {
    const { data: mLeagues, error: mlErr } = await supabase
      .from("leagues")
      .select("id, name, slug, invite_code, sport, theme, owner_id, created_at")
      .in("id", memberIds);
    if (mlErr) console.error(mlErr);
    memberRows = mLeagues || [];
  }

  const roleByLeague = {};
  (memberships || []).forEach((m) => {
    roleByLeague[m.league_id] = m.role;
  });

  return {
    owned: ownedRows,
    member: memberRows,
    roleByLeague
  };
}

export async function leaveLeagueMembership(leagueId, userId) {
  return supabase
    .from("league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", userId);
}
