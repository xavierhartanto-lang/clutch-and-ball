/**
 * Google Calendar OAuth (PKCE) for Clutch & Ball.
 *
 * Deploy: supabase functions deploy google-calendar-oauth --no-verify-jwt
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Google Cloud Console → OAuth client → Authorized redirect URIs must include:
 *   https://<project-ref>.supabase.co/functions/v1/google-calendar-oauth
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

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "https://clutchandball.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function redirect(origin: string, query: string) {
  const base = origin.replace(/\/$/, "");
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/account.html${query}` },
  });
}

function randomVerifier(): string {
  const b = new Uint8Array(48);
  crypto.getRandomValues(b);
  const s = String.fromCharCode(...b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 64);
}

async function sha256Base64Url(verifier: string): Promise<string> {
  const enc = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(hash);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders(req) });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim() ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")?.trim() ?? "";

  if (!supabaseUrl || !serviceKey || !anonKey) {
    return new Response("Server misconfigured", { status: 500 });
  }

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-oauth`;

  // --- GET: OAuth callback (no Authorization header) ---
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) {
      return redirect("https://clutchandball.com", `?cab_google=error&reason=${encodeURIComponent(err)}`);
    }
    if (!code || !state) {
      return redirect("https://clutchandball.com", "?cab_google=error&reason=missing_code");
    }

    const { data: row, error: stErr } = await admin
      .from("google_oauth_states")
      .select("user_id, code_verifier, redirect_origin, expires_at")
      .eq("state", state)
      .maybeSingle();

    if (stErr || !row) {
      return redirect("https://clutchandball.com", "?cab_google=error&reason=invalid_state");
    }
    if (new Date(String(row.expires_at)).getTime() < Date.now()) {
      await admin.from("google_oauth_states").delete().eq("state", state);
      return redirect("https://clutchandball.com", "?cab_google=error&reason=state_expired");
    }

    const originRaw = String(row.redirect_origin ?? "").replace(/\/$/, "");
    const safeOrigin = ALLOWED_ORIGINS.has(originRaw) ? originRaw : "https://clutchandball.com";

    if (!clientId || !clientSecret) {
      return redirect(safeOrigin, "?cab_google=error&reason=missing_google_config");
    }

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: String(row.code_verifier),
    });

    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokJson = (await tokRes.json()) as Record<string, unknown>;
    if (!tokRes.ok) {
      const desc = typeof tokJson.error_description === "string" ? tokJson.error_description : "token_exchange_failed";
      return redirect(safeOrigin, `?cab_google=error&reason=${encodeURIComponent(desc)}`);
    }

    const refresh = typeof tokJson.refresh_token === "string" ? tokJson.refresh_token : null;
    const access = typeof tokJson.access_token === "string" ? tokJson.access_token : null;
    if (!refresh) {
      return redirect(
        safeOrigin,
        "?cab_google=error&reason=no_refresh_token_try_again_with_prompt",
      );
    }

    let googleEmail: string | null = null;
    if (access) {
      const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (ui.ok) {
        const uj = (await ui.json()) as { email?: string };
        googleEmail = uj.email ?? null;
      }
    }

    const uid = String(row.user_id);
    await admin.from("google_oauth_states").delete().eq("state", state);

    const { error: upErr } = await admin.from("user_google_calendar_links").upsert(
      {
        user_id: uid,
        refresh_token: refresh,
        google_email: googleEmail,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upErr) {
      return redirect(safeOrigin, `?cab_google=error&reason=${encodeURIComponent(upErr.message)}`);
    }

    return redirect(safeOrigin, "?cab_google=connected");
  }

  // --- POST: start / status ---
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  let payload: { op?: string; redirect_origin?: string } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json(req, { error: "Missing authorization" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return json(req, { error: "Invalid session" }, 401);
  }

  await admin.from("google_oauth_states").delete().lt("expires_at", new Date().toISOString());

  const op = String(payload.op ?? "").trim();

  if (op === "status") {
    const { data: link } = await admin
      .from("user_google_calendar_links")
      .select("google_email")
      .eq("user_id", user.id)
      .maybeSingle();
    return json(req, { linked: !!link, google_email: link?.google_email ?? null }, 200);
  }

  if (op === "start") {
    if (!clientId) {
      return json(req, { error: "GOOGLE_CLIENT_ID not set on project" }, 500);
    }
    const ro = String(payload.redirect_origin ?? "").replace(/\/$/, "");
    if (!ALLOWED_ORIGINS.has(ro)) {
      return json(req, { error: "redirect_origin not allowed" }, 400);
    }

    const codeVerifier = randomVerifier();
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const state = crypto.randomUUID();

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: insErr } = await admin.from("google_oauth_states").insert({
      user_id: user.id,
      state,
      code_verifier: codeVerifier,
      redirect_origin: ro,
      expires_at: expiresAt,
    });

    if (insErr) {
      return json(req, { error: insErr.message }, 500);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: CAL_SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return json(req, { auth_url: authUrl }, 200);
  }

  return json(req, { error: "Unknown op" }, 400);
});
