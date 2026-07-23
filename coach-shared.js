/**
 * Shared helpers — Clutch and Ball (team-first coach app)
 */
"use strict";

import supabase from "./supabase.js";

export function randomInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** @typedef {"coach"|"parent"|"player"} SignupIntent */

/**
 * Single signup type per account (no role switching).
 * Legacy: coach_owner, coach → coach; is_coach metadata.
 */
export function getSignupIntent(user) {
  const m = user?.user_metadata || {};
  const i = m.signup_intent;
  if (i === "coach" || i === "coach_owner") return "coach";
  if (i === "parent") return "parent";
  if (i === "player") return "player";
  const ic = m.is_coach;
  if (ic === false || ic === "false") return "player";
  if (ic === true || ic === "true") return "coach";
  return "coach";
}

export function isCoachSignup(user) {
  return getSignupIntent(user) === "coach";
}

export function isParentSignup(user) {
  return getSignupIntent(user) === "parent";
}

export function isPlayerSignup(user) {
  return getSignupIntent(user) === "player";
}

/** @deprecated use isCoachSignup */
export const isCoachOwnerSignup = isCoachSignup;

export function hasCoachHubAccess(user) {
  return isCoachSignup(user);
}

/** Everyone signed in can appear on another team’s roster (coach, parent, or player). */
export function hasPlayerHubAccess(user) {
  if (!user) return false;
  return isCoachSignup(user) || isParentSignup(user) || isPlayerSignup(user);
}

export function getSignupLabel(user) {
  const t = getSignupIntent(user);
  if (t === "coach") return "Coach";
  if (t === "parent") return "Parent";
  return "Player";
}

export function isCoachUser(user) {
  return hasCoachHubAccess(user);
}

/** Display name on rosters: full name from signup/account first. */
export function rosterDisplayName(user) {
  const m = user?.user_metadata || {};
  const fn = m.full_name && String(m.full_name).trim();
  if (fn) return fn;
  if (m.username && String(m.username).trim()) return String(m.username).trim();
  return user?.email?.split("@")[0] || "Player";
}

/** Shown in header / welcome — prefers full name. */
export function accountDisplayName(user) {
  const m = user?.user_metadata || {};
  const fn = m.full_name && String(m.full_name).trim();
  if (fn) return fn;
  if (m.username && String(m.username).trim()) return String(m.username).trim();
  return user?.email || "";
}

function escapeHtmlStr(s) {
  if (s == null || s === "") return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Signed-in home hero (app.html #coach-hub-section): title + intro HTML with links.
 */
export function homeHeroForSignedInUser(user) {
  const rawName = accountDisplayName(user).trim() || "there";
  const name = escapeHtmlStr(rawName);
  const intent = getSignupIntent(user);
  if (intent === "coach") {
    return {
      title: `Hi, ${rawName}`,
      introHtml: `${name}, your signed-in hub mirrors the <a href="preview.html" class="cab-inline-preview-link">product preview</a>: leagues, teams, schedule, and RSVPs. <strong>Create a team</strong> in the Coach block below, or <strong>join another squad as a player</strong> with their team code in the Player block. Open <a href="calendar.html" class="cab-inline-preview-link">Calendar</a> or <a href="my-teams.html" class="cab-inline-preview-link">My Teams</a> anytime.`
    };
  }
  if (intent === "parent") {
    return {
      title: `Welcome, ${rawName}`,
      introHtml: `Join a roster with your coach’s team code below, then use <a href="calendar.html" class="cab-inline-preview-link">Calendar</a> for practices and games. <a href="my-teams.html" class="cab-inline-preview-link">My Teams</a> lists every squad you follow — same hierarchy as the <a href="preview.html" class="cab-inline-preview-link">preview</a>.`
    };
  }
  return {
    title: `Hey, ${rawName}`,
    introHtml: `Use your coach’s code to join below, then RSVP on <a href="calendar.html" class="cab-inline-preview-link">Calendar</a>. <a href="my-teams.html" class="cab-inline-preview-link">My Teams</a> has your rosters. See the full flow in the <a href="preview.html" class="cab-inline-preview-link">preview</a>.`
  };
}

export function sameUserId(a, b) {
  if (a == null || b == null) return false;
  const x = String(a).replace(/-/g, "").toLowerCase();
  const y = String(b).replace(/-/g, "").toLowerCase();
  return x.length > 0 && x === y;
}

export function teamCoachOrOwnerId(team) {
  if (!team || typeof team !== "object") return null;
  const c = team.coach_id;
  const o = team.owner_id;
  return c != null ? c : o != null ? o : null;
}

export async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function fetchTeamsCoachedByUser(userId) {
  let sel = "id, name, wins, losses, invite_code, assistant_invite_code, created_at, logo_url";
  let { data: byCoach, error: e1 } = await supabase.from("teams").select(sel).eq("coach_id", userId);

  if (e1 && /logo_url|schema cache|PGRST204|42703/i.test(String(e1.message || ""))) {
    sel = "id, name, wins, losses, invite_code, assistant_invite_code, created_at";
    const retry = await supabase.from("teams").select(sel).eq("coach_id", userId);
    byCoach = retry.data;
    e1 = retry.error;
  }

  if (e1) return { data: null, error: e1 };

  let byOwner = [];
  let { data: odata, error: e2 } = await supabase.from("teams").select(sel).eq("owner_id", userId);
  if (e2 && /logo_url|schema cache|PGRST204|42703/i.test(String(e2.message || ""))) {
    sel = "id, name, wins, losses, invite_code, assistant_invite_code, created_at";
    const retry = await supabase.from("teams").select(sel).eq("owner_id", userId);
    odata = retry.data;
    e2 = retry.error;
  }

  if (!e2 && odata?.length) byOwner = odata;

  const seen = new Set();
  const merged = [];
  for (const t of [...(byCoach || []), ...byOwner]) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    merged.push(t);
  }
  merged.sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });
  return { data: merged, error: null };
}

export function requireAuth() {
  return getSessionUser().then((u) => {
    if (!u) {
      window.location.href = "app.html";
      return null;
    }
    return u;
  });
}

export function showMsg(el, text, isError = false) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("auth-message--error", !!isError);
}

/** Home hub: player/parent sections listed first in the stack. */
export function syncHomeHubLayout(user) {
  const stack = document.getElementById("hub-stack");
  if (stack && user) {
    const playerFirst = isPlayerSignup(user) || isParentSignup(user);
    stack.classList.toggle("hub-stack--player-first", playerFirst);
  }
}
