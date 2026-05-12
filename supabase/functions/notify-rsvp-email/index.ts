/**
 * After a player/parent saves an RSVP, the browser calls this function.
 * It emails the team coach (and owner / assistant if different) via Resend.
 *
 * Deploy (CORS / OPTIONS — same pattern as delete-account):
 *   supabase functions deploy notify-rsvp-email --no-verify-jwt
 *
 * Secrets (Dashboard → Edge Functions → Secrets, or CLI):
 *   RESEND_API_KEY           — from resend.com
 *   RSVP_FROM_EMAIL          — optional, e.g. "Clutch & Ball <noreply@yourdomain.com>"
 *                              If unset, uses Resend test sender (see step doc).
 *   RSVP_RESEND_TEMPLATE_ID  — optional. If set, email body comes from your **published**
 *                              Resend dashboard template (same id or alias as in Resend).
 *                              Omit to use bundled HTML (rsvp-coach-notification.html).
 *                              Variable keys in the template must match the object below.
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
]);

function isWorkersDevOrigin(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h.endsWith(".workers.dev") || h === "workers.dev";
  } catch {
    return false;
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow =
    ALLOWED_ORIGINS.has(origin) || isWorkersDevOrigin(origin) ? origin : "https://clutchandball.com";
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

function formatWhen(iso: string | null): string {
  if (!iso) return "TBD";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusLabel(s: string): string {
  if (s === "available") return "Available";
  if (s === "late") return "Late";
  if (s === "out") return "Out";
  return s;
}

function normId(id: string): string {
  return String(id).replace(/-/g, "").toLowerCase();
}

function uuidList(...vals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s.length >= 32) out.push(s);
  }
  return [...new Set(out)];
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fillPlaceholders(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

let coachRsvpTemplateCache: string | undefined;

async function getCoachRsvpTemplateHtml(): Promise<string> {
  if (coachRsvpTemplateCache !== undefined) return coachRsvpTemplateCache;
  try {
    const raw = await Deno.readTextFile(new URL("./rsvp-coach-notification.html", import.meta.url));
    coachRsvpTemplateCache = raw.replace(/<!--[\s\S]*?-->/g, "");
  } catch {
    coachRsvpTemplateCache = "";
  }
  return coachRsvpTemplateCache;
}

function fallbackCoachRsvpHtml(
  actorName: string,
  st: string,
  teamName: string,
  eventTitle: string,
  whenLine: string,
): string {
  return `<p><strong>${escapeHtml(actorName)}</strong> set their availability to <strong>${escapeHtml(
    statusLabel(st),
  )}</strong> for <strong>${escapeHtml(teamName)}</strong>.</p>
      <p><strong>Event:</strong> ${escapeHtml(eventTitle)}<br/>
      <strong>When:</strong> ${escapeHtml(whenLine)}</p>
      <p style="color:#666;font-size:13px">This message was sent because you are listed as coach/owner/assistant for the team.</p>`;
}

async function buildCoachRsvpEmailHtml(params: {
  actorName: string;
  status: string;
  teamName: string;
  eventTitle: string;
  whenLine: string;
}): Promise<string> {
  const tpl = (await getCoachRsvpTemplateHtml()).trim();
  if (!tpl) {
    return fallbackCoachRsvpHtml(
      params.actorName,
      params.status,
      params.teamName,
      params.eventTitle,
      params.whenLine,
    );
  }
  return fillPlaceholders(tpl, {
    actor_name: escapeHtml(params.actorName),
    status_label: escapeHtml(statusLabel(params.status)),
    team_name: escapeHtml(params.teamName),
    event_title: escapeHtml(params.eventTitle),
    when_line: escapeHtml(params.whenLine),
    calendar_url: "https://clutchandball.com/calendar.html",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      return json(req, { error: "Method not allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(req, { error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json(req, { error: "Server misconfigured" }, 500);
    }

    if (!resendKey) {
      return json(req, { error: "RESEND_API_KEY not set on project" }, 503);
    }

    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.49.1"
    );

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !caller) {
      return json(req, { error: "Invalid session" }, 401);
    }

    let body: { event_id?: string; user_id?: string; status?: string };
    try {
      body = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON" }, 400);
    }

    const eventId = body.event_id;
    const userId = body.user_id;
    const status = body.status;

    if (!eventId || !userId || !status) {
      return json(req, { error: "event_id, user_id, and status required" }, 400);
    }

    if (caller.id !== userId) {
      return json(req, { error: "user_id must match signed-in user" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: ev, error: evErr } = await admin
      .from("calendar_events")
      .select("id, title, starts_at, team_id")
      .eq("id", eventId)
      .maybeSingle();

    if (evErr || !ev) {
      return json(req, { error: "Event not found" }, 404);
    }

    if (!ev.team_id) {
      return json(req, { ok: true, skipped: "personal_event" }, 200);
    }

    const { data: team, error: teamErr } = await admin
      .from("teams")
      .select("id, name, coach_id, owner_id, assistant_coach_id")
      .eq("id", ev.team_id)
      .maybeSingle();

    if (teamErr || !team) {
      return json(req, { error: "Team not found" }, 404);
    }

    const coachIds = uuidList(team.coach_id, team.owner_id, team.assistant_coach_id);
    const callerNorm = normId(caller.id);

    const toEmails: string[] = [];
    for (const cid of coachIds) {
      if (normId(cid) === callerNorm) continue;
      const { data: uData, error: adminErr } = await admin.auth.admin.getUserById(cid);
      if (!adminErr && uData?.user?.email) {
        toEmails.push(uData.user.email);
      }
    }

    const uniqueTo = [...new Set(toEmails)];
    if (!uniqueTo.length) {
      return json(req, { ok: true, skipped: "no_coach_recipient" }, 200);
    }

    const meta = (caller.user_metadata || {}) as Record<string, unknown>;
    const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
    const actorName = fullName || caller.email || "A player";

    const subject = `RSVP: ${actorName} → ${statusLabel(status)} — ${team.name}`;
    const whenLine = formatWhen(ev.starts_at);
    const resendTemplateId = Deno.env.get("RSVP_RESEND_TEMPLATE_ID")?.trim() ?? "";

    /** Must match variable names in the Resend template editor (published template only). */
    const resendTemplateVariables: Record<string, string> = {
      actor_name: actorName,
      status_label: statusLabel(status),
      team_name: team.name,
      event_title: ev.title || "Event",
      when_line: whenLine,
      calendar_url: "https://clutchandball.com/calendar.html",
    };

    const from =
      Deno.env.get("RSVP_FROM_EMAIL")?.trim() || "Clutch & Ball <onboarding@resend.dev>";

    const emailBody: Record<string, unknown> = {
      from,
      to: uniqueTo,
      subject,
    };

    if (resendTemplateId) {
      emailBody.template = {
        id: resendTemplateId,
        variables: resendTemplateVariables,
      };
    } else {
      emailBody.html = await buildCoachRsvpEmailHtml({
        actorName,
        status,
        teamName: team.name,
        eventTitle: ev.title || "Event",
        whenLine,
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    const resText = await res.text();
    if (!res.ok) {
      console.error("Resend error:", res.status, resText);
      return json(req, { error: "Email provider rejected request", detail: resText }, 502);
    }

    const { error: markErr } = await admin
      .from("rsvp_email_notification_queue")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("event_id", eventId)
      .eq("actor_user_id", caller.id)
      .is("processed_at", null);
    if (markErr && !/relation|does not exist/i.test(markErr.message || "")) {
      console.warn("rsvp queue mark:", markErr.message);
    }

    return json(req, { ok: true }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(req, { error: msg }, 500);
  }
});

