/**
 * Team calendar RSVP (practices / games) + optional email side-effect.
 * Email delivery: see supabase/migrations/016_rsvp_email_notification_queue.sql
 */
"use strict";

import supabase from "./supabase.js";

export function formatRsvpStatus(status) {
  if (status === "available") return "Available";
  if (status === "late") return "Late";
  if (status === "out") return "Out";
  return "Not responded";
}

export async function upsertMyEventRsvp({ eventId, userId, status }) {
  return supabase.from("calendar_event_rsvps").upsert(
    {
      event_id: eventId,
      user_id: userId,
      status,
      updated_at: new Date().toISOString()
    },
    { onConflict: "event_id,user_id" }
  );
}

/**
 * When migration 016 is applied and Edge Function `notify-rsvp-email` is deployed,
 * this notifies coaches (and optional player copy) via your mail provider.
 * Safe no-op if the function is missing.
 */
export async function notifyRsvpEmailSideEffect(body) {
  try {
    const { data, error } = await supabase.functions.invoke("notify-rsvp-email", { body });
    if (error) {
      console.warn("[RSVP email] Edge Function error:", error.message || error);
      return;
    }
    if (data?.skipped) {
      console.info("[RSVP email] skipped:", data.skipped, "(RSVP still saved.)");
      return;
    }
    if (data?.error) {
      console.warn("[RSVP email] provider/config:", data.error, data.detail || "");
      return;
    }
    console.info("[RSVP email] ok", data);
  } catch (e) {
    console.warn("[RSVP email] request failed:", e instanceof Error ? e.message : e);
  }
}
