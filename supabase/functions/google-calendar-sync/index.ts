/**
 * Sync Clutch & Ball calendar_events ↔ Google Calendar (per linked user).
 *
 * Deploy: supabase functions deploy google-calendar-sync --no-verify-jwt
 *
 * Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (same as oauth function)
 */

const ALLOWED_ORIGINS = new Set([
  "https://clutchandball.com",
  "https://www.clutchandball.com",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://clutchandball.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token?: string; error?: string }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok) {
    return { error: j.error_description || j.error || "refresh_failed" };
  }
  return { access_token: j.access_token };
}

type CalRow = {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  kind: string;
};

function buildGoogleEvent(row: CalRow): Record<string, unknown> {
  const endIso =
    row.ends_at ||
    new Date(new Date(row.starts_at).getTime() + 60 * 60 * 1000).toISOString();
  const descParts = [
    row.notes || "",
    "",
    `Clutch & Ball · ${row.kind}`,
    `Event ID: ${row.id}`,
  ].filter(Boolean);
  return {
    summary: row.title || "Event",
    description: descParts.join("\n").slice(0, 8000),
    start: { dateTime: row.starts_at },
    end: { dateTime: endIso },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim() ?? "";

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json(req, { error: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "Missing authorization" }, 401);
  }

  let body: { op?: string; event_id?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return json(req, { error: "Invalid session" }, 401);
  }

  const op = String(body.op ?? "").trim();

  async function accessForUser(userId: string): Promise<string | null> {
    const { data: link } = await admin
      .from("user_google_calendar_links")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (!link?.refresh_token || !clientId || !clientSecret) return null;
    const r = await refreshAccessToken(clientId, clientSecret, String(link.refresh_token));
    return r.access_token ?? null;
  }

  async function deleteGooglePrimaryEvent(access: string, googleEventId: string) {
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${access}` } },
    );
  }

  // --- disconnect ---
  if (op === "disconnect") {
    const access = await accessForUser(user.id);
    const { data: maps } = await admin
      .from("user_calendar_google_event_maps")
      .select("calendar_event_id, google_event_id")
      .eq("user_id", user.id);

    if (access) {
      for (const m of maps || []) {
        if (m.google_event_id) {
          await deleteGooglePrimaryEvent(access, String(m.google_event_id));
        }
      }
    }
    await admin.from("user_calendar_google_event_maps").delete().eq("user_id", user.id);
    await admin.from("user_google_calendar_links").delete().eq("user_id", user.id);
    return json(req, { ok: true }, 200);
  }

  const eventId = String(body.event_id ?? "").trim();
  if (!eventId) {
    return json(req, { error: "event_id required" }, 400);
  }

  // --- purge all Google copies for an event (before deleting the Clutch row) ---
  if (op === "purge_event_google") {
    const { data: ev, error: evErr } = await userClient
      .from("calendar_events")
      .select("id")
      .eq("id", eventId)
      .maybeSingle();
    if (evErr || !ev) {
      return json(req, { error: "Event not found or access denied" }, 403);
    }

    const { data: maps } = await admin
      .from("user_calendar_google_event_maps")
      .select("user_id, google_event_id")
      .eq("calendar_event_id", eventId);

    for (const m of maps || []) {
      const access = await accessForUser(String(m.user_id));
      if (access && m.google_event_id) {
        await deleteGooglePrimaryEvent(access, String(m.google_event_id));
      }
    }
    await admin.from("user_calendar_google_event_maps").delete().eq("calendar_event_id", eventId);
    return json(req, { ok: true, purged: (maps || []).length }, 200);
  }

  // --- sync one event for current user ---
  if (op === "sync") {
    const { data: row, error: rErr } = await userClient
      .from("calendar_events")
      .select("id, title, notes, starts_at, ends_at, kind")
      .eq("id", eventId)
      .maybeSingle();

    if (rErr || !row) {
      return json(req, { error: "Event not found or access denied" }, 403);
    }

    const { data: link } = await admin
      .from("user_google_calendar_links")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!link?.refresh_token) {
      return json(req, { ok: true, skipped: true }, 200);
    }

    if (!clientId || !clientSecret) {
      return json(req, { error: "Google client not configured" }, 500);
    }

    const access = await accessForUser(user.id);
    if (!access) {
      return json(req, { error: "Could not refresh Google token" }, 500);
    }

    const calRow = row as CalRow;
    const payload = buildGoogleEvent(calRow);

    const { data: existingMap } = await admin
      .from("user_calendar_google_event_maps")
      .select("google_event_id")
      .eq("user_id", user.id)
      .eq("calendar_event_id", eventId)
      .maybeSingle();

    let googleEventId = existingMap?.google_event_id as string | undefined;

    if (googleEventId) {
      const patchRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!patchRes.ok) {
        const t = await patchRes.text();
        if (patchRes.status === 404) {
          googleEventId = undefined;
        } else {
          return json(req, { error: `Google update failed: ${t.slice(0, 400)}` }, 502);
        }
      }
    }

    if (!googleEventId) {
      const insRes = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      const insTxt = await insRes.text();
      let insJson: { id?: string; error?: { message?: string } } = {};
      try {
        insJson = JSON.parse(insTxt) as typeof insJson;
      } catch {
        /* ignore */
      }
      if (!insRes.ok) {
        return json(req, { error: insJson.error?.message || insTxt.slice(0, 400) }, 502);
      }
      googleEventId = insJson.id;
      if (!googleEventId) {
        return json(req, { error: "Google did not return event id" }, 502);
      }
    }

    const now = new Date().toISOString();
    const { error: mapErr } = await admin.from("user_calendar_google_event_maps").upsert(
      {
        user_id: user.id,
        calendar_event_id: eventId,
        google_event_id: googleEventId,
        updated_at: now,
      },
      { onConflict: "user_id,calendar_event_id" },
    );

    if (mapErr) {
      return json(req, { error: mapErr.message }, 500);
    }

    return json(req, { ok: true, google_event_id: googleEventId }, 200);
  }

  return json(req, { error: "Unknown op" }, 400);
});
