/**
 * Clutch & Ball — Google Calendar Edge Function helpers (OAuth + sync).
 */
"use strict";

import supabase, { edgeFunctionUrl, supabaseAnonKey } from "./supabase.js";

async function accessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function postJson(functionName, body, token) {
  try {
    const res = await fetch(edgeFunctionUrl(functionName), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* ignore */
    }
    return { res, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      res: { ok: false, status: 0 },
      data: { error: msg || "Network error (blocked, offline, or CORS)." }
    };
  }
}

/** Start Google OAuth (redirects user away). */
export async function startGoogleCalendarLink() {
  const token = await accessToken();
  if (!token) return { ok: false, error: "Sign in first." };
  const redirect_origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  const { res, data } = await postJson(
    "google-calendar-oauth",
    { op: "start", redirect_origin: redirect_origin || undefined },
    token
  );
  if (!res.ok) {
    const hint =
      res.status === 404
        ? "google-calendar-oauth not deployed (404). From mywebsite/: supabase functions deploy google-calendar-oauth --no-verify-jwt"
        : data.error || `Request failed (${res.status})`;
    return { ok: false, error: hint };
  }
  if (data.auth_url) {
    window.location.href = data.auth_url;
    return { ok: true, redirecting: true };
  }
  return { ok: false, error: data.error || "No auth URL returned." };
}

export async function fetchGoogleCalendarLinkStatus() {
  const token = await accessToken();
  if (!token) return { linked: false, google_email: null, error: "not_signed_in" };
  const { res, data } = await postJson("google-calendar-oauth", { op: "status" }, token);
  if (!res.ok) {
    const hint =
      res.status === 404
        ? "Edge function not deployed (404). Run: supabase functions deploy google-calendar-oauth --no-verify-jwt"
        : data.error || `HTTP ${res.status}`;
    return { linked: false, google_email: null, error: hint };
  }
  return {
    linked: !!data.linked,
    google_email: data.google_email || null
  };
}

/** Push one Clutch calendar row to the signed-in user’s linked Google Calendar. */
export async function invokeGoogleCalendarSync(eventId) {
  const token = await accessToken();
  if (!token || !eventId) return { ok: false, skipped: true };
  const { res, data } = await postJson(
    "google-calendar-sync",
    { op: "sync", event_id: eventId },
    token
  );
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true, skipped: !!data.skipped, ...data };
}

/** Remove Google copies for all users before deleting a Clutch event. */
export async function invokeGoogleCalendarPurge(eventId) {
  const token = await accessToken();
  if (!token || !eventId) return { ok: false, skipped: true };
  const { res, data } = await postJson(
    "google-calendar-sync",
    { op: "purge_event_google", event_id: eventId },
    token
  );
  if (res.status === 404) return { ok: true, skipped: true };
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true, ...data };
}

/** Disconnect Google Calendar (removes stored tokens and synced event maps). */
export async function invokeGoogleCalendarDisconnect() {
  const token = await accessToken();
  if (!token) return { ok: false, error: "Sign in first." };
  const { res, data } = await postJson("google-calendar-sync", { op: "disconnect" }, token);
  if (!res.ok) return { ok: false, error: data.error || res.statusText };
  return { ok: true, ...data };
}
