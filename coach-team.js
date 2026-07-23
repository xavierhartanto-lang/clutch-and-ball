"use strict";

import supabase from "./supabase.js";
import {
  getSessionUser,
  showMsg,
  randomInviteCode,
  sameUserId,
  teamCoachOrOwnerId
} from "./coach-shared.js";
import { initTeamChat } from "./team-chat.js";

const params = new URLSearchParams(window.location.search);
const teamId = (params.get("id") || "").trim() || null;

const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("content");
const errorFull = document.getElementById("error-full");
const coachBlock = document.getElementById("coach-team-tools");
const inviteCodeEl = document.getElementById("team-invite-code");
const btnCopy = document.getElementById("btn-copy-invite");
const playerNote = document.getElementById("player-team-note");
const sheet = document.getElementById("player-bottom-sheet");
const sheetBackdrop = document.getElementById("player-bottom-sheet-backdrop");
const sheetCompact = document.getElementById("player-sheet-compact");
const sheetFull = document.getElementById("player-sheet-full");
const sheetFullBtn = document.getElementById("player-sheet-full-btn");
const sheetClose = document.getElementById("player-bottom-sheet-close");
const settingsBtn = document.getElementById("team-settings-btn");
const settingsModal = document.getElementById("team-settings-modal");
const settingsBackdrop = document.getElementById("team-settings-backdrop");
const settingsClose = document.getElementById("team-settings-close");
let copyHandlerAttached = false;
let deleteHandlerAttached = false;
let chatInited = false;
let settingsCopyAttached = false;
let rosterActionsBound = false;
let teamPageContext = { teamId: null, team: null, user: null, isStaff: false, effectiveCoachId: null };
let lastOpenedPlayerRow = null;
let practicePlansUiBound = false;
let playerSheetDevBound = false;
let teamFocusUiBound = false;
let teamLinksUiBound = false;
let teamSeasonGoalsUiBound = false;
let exportRosterClickBound = false;
/** @type {{ plist: Array, teamName: string, teamId: string|null }} */
let lastRosterExport = { plist: [], teamName: "Team", teamId: null };

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function isSchemaOrMissingTable(err) {
  return /PGRST204|does not exist|schema cache|42P01|42703/i.test(String(err?.message || ""));
}

function normalizeExternalUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) {
    s = `https://${s.replace(/^\/+/, "")}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch {
    return "";
  }
}

function exportRosterCsv() {
  const { plist, teamName } = lastRosterExport;
  if (!plist?.length) return;
  const lines = [['"Name"', "Points", "Assists", "Rebounds"].join(",")];
  for (const p of plist) {
    const name = String(p.display_name || "").replace(/"/g, '""');
    lines.push(
      [`"${name}"`, Number(p.points) || 0, Number(p.assists) || 0, Number(p.rebounds) || 0].join(",")
    );
  }
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const safe = String(teamName || "team")
    .replace(/[^\w\-.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "team";
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}-roster.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildGoalsHtml(goals, canEdit, playerId) {
  const rows = (goals || [])
    .map((g) => {
      const actions = canEdit
        ? `<span class="player-goal-actions">
            ${
              g.status === "active"
                ? `<button type="button" class="auth-submit auth-submit-secondary btn-goal-done" data-goal-id="${g.id}" data-player-id="${playerId}">Mark done</button>`
                : ""
            }
            <button type="button" class="auth-submit auth-submit-secondary btn-goal-delete" data-goal-id="${g.id}" data-player-id="${playerId}">Delete</button>
          </span>`
        : "";
      return `<li class="player-goal-row ${g.status === "done" ? "player-goal-row--done" : ""}">
        <span class="player-goal-text">${escapeHtml(g.goal_text)}</span>
        ${actions}
      </li>`;
    })
    .join("");

  const addForm = canEdit
    ? `<form class="player-goal-add-form auth-form" data-player-id="${playerId}">
        <input type="text" class="player-goal-input" maxlength="500" placeholder="New development goal…" required>
        <button type="submit" class="auth-submit">Add goal</button>
      </form>`
    : "";

  return `<div class="player-sheet-section player-sheet-section--goals">
    <h3 class="player-sheet-sub">Development goals</h3>
    ${rows ? `<ul class="player-goals-list">${rows}</ul>` : `<p class="auth-hint">No goals yet.</p>`}
    ${addForm}
  </div>`;
}

function buildCoachNotesHtml(notes, playerId) {
  const rows = (notes || [])
    .map(
      (n) => `<li class="player-coach-note-item">
      <p class="player-coach-note-body">${escapeHtml(n.body).replace(/\n/g, "<br>")}</p>
      <div class="player-coach-note-foot">
        <span class="auth-hint player-coach-note-meta">${escapeHtml(formatCreatedAt(n.created_at))}</span>
        <button type="button" class="auth-submit auth-submit-secondary btn-coach-note-delete" data-note-id="${n.id}" data-player-id="${playerId}">Delete</button>
      </div>
    </li>`
    )
    .join("");

  return `<div class="player-sheet-section player-sheet-section--notes">
    <h3 class="player-sheet-sub">Coach notes (staff only)</h3>
    ${rows ? `<ul class="player-coach-notes-list">${rows}</ul>` : `<p class="auth-hint">No notes yet.</p>`}
    <form class="player-coach-note-form auth-form" data-player-id="${playerId}">
      <label class="auth-label" for="player-coach-note-field">Add private note</label>
      <textarea id="player-coach-note-field" class="player-coach-note-input" rows="3" maxlength="2000" placeholder="Observations for staff…"></textarea>
      <button type="submit" class="auth-submit">Save note</button>
    </form>
  </div>`;
}

function showPlayerSheet() {
  sheet?.classList.remove("hidden");
  sheet?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function hidePlayerSheet() {
  sheet?.classList.add("hidden");
  sheet?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  if (sheetFull) sheetFull.classList.add("hidden");
  if (sheetFullBtn) sheetFullBtn.classList.add("hidden");
}

function openSettingsModal() {
  settingsModal?.classList.remove("hidden");
  settingsModal?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function hideSettingsModal() {
  settingsModal?.classList.add("hidden");
  settingsModal?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function renderBannedList(teamRow, isStaff) {
  const list = document.getElementById("team-banned-list");
  const empty = document.getElementById("team-banned-empty");
  if (!list || !empty) return;
  if (!isStaff) {
    list.innerHTML = "";
    empty.textContent = "Only staff can view bans.";
    return;
  }
  const { data: bans, error } = await supabase
    .from("team_bans")
    .select("id, user_id, banned_name, created_at")
    .eq("team_id", teamRow.id)
    .order("created_at", { ascending: false });
  if (error) {
    list.innerHTML = "";
    empty.textContent = error.message;
    return;
  }
  const rows = bans || [];
  list.innerHTML = "";
  empty.classList.toggle("hidden", rows.length > 0);
  rows.forEach((b) => {
    const li = document.createElement("li");
    li.className = "coach-list-row";
    li.innerHTML = `
      <div class="league-card league-card--stack">
        <div class="league-card-row">
          <span>${escapeHtml(b.banned_name || `User ${String(b.user_id || "").slice(0, 6)}`)}</span>
          <button type="button" class="auth-submit auth-submit-secondary btn-unban-player" data-ban-id="${b.id}">Unban</button>
        </div>
      </div>`;
    list.appendChild(li);
  });
}

function parseYoutubeId(url) {
  const u = String(url || "").trim();
  const m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function highlightEmbeds(raw) {
  if (!raw || !String(raw).trim()) {
    return '<p class="auth-hint">No highlight links added yet.</p>';
  }
  const lines = String(raw)
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const parts = [];
  for (const line of lines) {
    const id = parseYoutubeId(line);
    if (id) {
      parts.push(
        `<div class="player-highlight-embed"><iframe class="player-highlight-iframe" src="https://www.youtube.com/embed/${id}" title="Highlight reel" allowfullscreen loading="lazy"></iframe></div>`
      );
    } else if (/^https?:\/\//i.test(line)) {
      parts.push(`<p><a href="${escapeHtml(line)}" target="_blank" rel="noopener noreferrer">${escapeHtml(line)}</a></p>`);
    }
  }
  return parts.length ? parts.join("") : '<p class="auth-hint">Add YouTube links in Account → Showcase.</p>';
}

function openPlayerSheet(playerRow) {
  if (!sheet || !sheetCompact) return;
  void loadPlayerSheetContent(playerRow);
}

async function loadPlayerSheetContent(playerRow) {
  if (!sheet || !sheetCompact) return;
  lastOpenedPlayerRow = playerRow;
  const ctx = teamPageContext;
  const rosterName = playerRow.display_name || playerRow.name || "Player";

  if (!playerRow.user_id) {
    let goalsBlock = "";
    let notesBlockRoster = "";
    if (ctx.isStaff && ctx.teamId && playerRow.id) {
      const { data: goals, error: gErr } = await supabase
        .from("player_goals")
        .select("id, goal_text, status, created_at")
        .eq("team_id", ctx.teamId)
        .eq("player_id", playerRow.id)
        .order("created_at", { ascending: false });
      if (!gErr && goals) {
        goalsBlock = buildGoalsHtml(goals, true, playerRow.id);
      } else if (gErr && !isSchemaOrMissingTable(gErr)) {
        goalsBlock = `<p class="auth-message auth-message--error">${escapeHtml(gErr.message)}</p>`;
      }

      const { data: notes, error: nErr } = await supabase
        .from("player_coach_notes")
        .select("id, body, created_at")
        .eq("team_id", ctx.teamId)
        .eq("player_id", playerRow.id)
        .order("created_at", { ascending: false });
      if (!nErr && notes) {
        notesBlockRoster = buildCoachNotesHtml(notes, playerRow.id);
      } else if (nErr && !isSchemaOrMissingTable(nErr)) {
        notesBlockRoster = `<p class="auth-message auth-message--error">${escapeHtml(nErr.message)}</p>`;
      }
    }
    sheetCompact.innerHTML = `
      <p class="player-sheet-name">${escapeHtml(rosterName)}</p>
      <p class="auth-hint">No linked account — roster name only.</p>
      ${goalsBlock}
      ${notesBlockRoster}`;
    if (sheetFullBtn) sheetFullBtn.classList.add("hidden");
    if (sheetFull) sheetFull.innerHTML = "";
    showPlayerSheet();
    return;
  }

  const uid = playerRow.user_id;

  sheetCompact.innerHTML = `<p class="auth-hint">Loading…</p>`;
  if (sheetFullBtn) sheetFullBtn.classList.add("hidden");
  if (sheetFull) {
    sheetFull.classList.add("hidden");
    sheetFull.innerHTML = "";
  }
  showPlayerSheet();

  const { data: prof, error } = await supabase
    .from("profiles")
    .select("full_name, birthday, phone, email, bio, highlight_reel_urls")
    .eq("id", uid)
    .maybeSingle();

  if (error) {
    sheetCompact.innerHTML = `<p class="auth-message auth-message--error">${escapeHtml(error.message)}</p>`;
    return;
  }

  const sessionUser = await getSessionUser();
  const isSelf = sessionUser && sameUserId(uid, sessionUser.id);
  const canViewGoals = ctx.isStaff || isSelf;
  const canEditGoals = ctx.isStaff;

  let goalsBlock = "";
  let notesBlock = "";

  if (ctx.teamId && playerRow.id && canViewGoals) {
    const { data: goals, error: gErr } = await supabase
      .from("player_goals")
      .select("id, goal_text, status, created_at")
      .eq("team_id", ctx.teamId)
      .eq("player_id", playerRow.id)
      .order("created_at", { ascending: false });
    if (!gErr && goals) {
      goalsBlock = buildGoalsHtml(goals, canEditGoals, playerRow.id);
    } else if (gErr && !isSchemaOrMissingTable(gErr)) {
      goalsBlock = `<p class="auth-message auth-message--error">${escapeHtml(gErr.message)}</p>`;
    }
  }

  if (ctx.teamId && playerRow.id && ctx.isStaff) {
    const { data: notes, error: nErr } = await supabase
      .from("player_coach_notes")
      .select("id, body, created_at")
      .eq("team_id", ctx.teamId)
      .eq("player_id", playerRow.id)
      .order("created_at", { ascending: false });
    if (!nErr && notes) {
      notesBlock = buildCoachNotesHtml(notes, playerRow.id);
    } else if (nErr && !isSchemaOrMissingTable(nErr)) {
      notesBlock = `<p class="auth-message auth-message--error">${escapeHtml(nErr.message)}</p>`;
    }
  }

  const displayName = (prof?.full_name && String(prof.full_name).trim()) || rosterName;
  const phone = prof?.phone ? escapeHtml(prof.phone) : "—";
  const email = prof?.email ? escapeHtml(prof.email) : "—";
  const bday = prof?.birthday ? escapeHtml(prof.birthday) : "—";

  sheetCompact.innerHTML = `
    <p class="player-sheet-name">${escapeHtml(displayName)}</p>
    <ul class="player-sheet-facts">
      <li><span class="player-sheet-label">Phone</span> ${phone}</li>
      <li><span class="player-sheet-label">Email</span> ${email}</li>
      <li><span class="player-sheet-label">Birthday</span> ${bday}</li>
    </ul>
    ${goalsBlock}
    ${notesBlock}`;

  if (sheetFullBtn) {
    sheetFullBtn.classList.remove("hidden");
    sheetFullBtn.onclick = () => {
      if (!sheetFull) return;
      const bio = prof?.bio
        ? `<div class="player-sheet-bio"><h3 class="player-sheet-sub">Bio</h3><p>${escapeHtml(prof.bio).replace(/\n/g, "<br>")}</p></div>`
        : "";
      const highs = `<div class="player-sheet-highlights"><h3 class="player-sheet-sub">Highlight Reels</h3>${highlightEmbeds(prof?.highlight_reel_urls)}</div>`;
      sheetFull.innerHTML = bio + highs;
      sheetFull.classList.remove("hidden");
      sheetFullBtn.classList.add("hidden");
    };
  }
}

sheetClose?.addEventListener("click", hidePlayerSheet);
sheetBackdrop?.addEventListener("click", hidePlayerSheet);
settingsClose?.addEventListener("click", hideSettingsModal);
settingsBackdrop?.addEventListener("click", hideSettingsModal);

async function ensureInviteCode(teamRow) {
  if (teamRow.invite_code) return teamRow.invite_code;
  for (let i = 0; i < 12; i++) {
    const code = randomInviteCode();
    const { error } = await supabase.from("teams").update({ invite_code: code }).eq("id", teamRow.id).is("invite_code", null);
    if (!error) return code;
    if (!/unique|duplicate/i.test(String(error.message))) break;
  }
  return null;
}

async function ensureAssistantInviteCode(teamRow) {
  if (teamRow.assistant_invite_code) return teamRow.assistant_invite_code;
  for (let i = 0; i < 12; i++) {
    const code = randomInviteCode();
    const { error } = await supabase
      .from("teams")
      .update({ assistant_invite_code: code })
      .eq("id", teamRow.id)
      .is("assistant_invite_code", null);
    if (!error) return code;
    if (!/unique|duplicate/i.test(String(error.message))) break;
  }
  return null;
}

function formatCreatedAt(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function hideLoadingBanner() {
  if (!loadingEl) return;
  loadingEl.classList.add("hidden");
  loadingEl.setAttribute("aria-hidden", "true");
  loadingEl.hidden = true;
}

function calendarKindLabel(k) {
  const map = { game: "Game", practice: "Practice", event: "Event", other: "Other" };
  return map[k] || k || "Event";
}

function calendarRsvpStatusLabel(status) {
  const map = { available: "Available", late: "Late", out: "Out" };
  return map[status] || status || "—";
}

async function fetchNextCalendarEventForTeam(teamIdForQuery) {
  const nowIso = new Date().toISOString();
  return supabase
    .from("calendar_events")
    .select("id, title, kind, starts_at, ends_at, notes")
    .eq("team_id", teamIdForQuery)
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
}

async function renderUpNext(teamIdForQuery, isCoachUser) {
  const body = document.getElementById("team-up-next-body");
  const hintCoach = document.getElementById("team-up-next-hint-coach");
  if (!body) return;

  const { data: ev, error } = await fetchNextCalendarEventForTeam(teamIdForQuery);

  if (error) {
    body.innerHTML = `<p class="auth-hint">Schedule unavailable (${escapeHtml(error.message)}).</p>`;
    if (hintCoach) hintCoach.classList.add("hidden");
    return;
  }

  if (!ev) {
    body.innerHTML = `<p class="auth-hint">No upcoming games or practices for this team.</p>`;
    if (hintCoach) hintCoach.classList.toggle("hidden", !isCoachUser);
    return;
  }

  if (hintCoach) hintCoach.classList.add("hidden");

  const start = new Date(ev.starts_at);
  const end = ev.ends_at ? new Date(ev.ends_at) : null;
  const dateStr = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const endStr =
    end && end.getTime() !== start.getTime()
      ? ` – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
      : "";
  const notes = ev.notes ? `<p class="auth-hint team-up-next-notes">${escapeHtml(ev.notes)}</p>` : "";
  const whenLine = escapeHtml(dateStr + endStr);

  body.innerHTML = `
    <p class="team-up-next-kind">${escapeHtml(calendarKindLabel(ev.kind))}</p>
    <p class="team-up-next-title">${escapeHtml(ev.title)}</p>
    <p class="team-up-next-when">${whenLine}</p>
    ${notes}`;
}

async function renderAttendanceSnapshot(teamIdForQuery) {
  const section = document.getElementById("team-attendance-section");
  const body = document.getElementById("team-attendance-body");
  if (!section || !body) return;

  const { data: ev, error } = await fetchNextCalendarEventForTeam(teamIdForQuery);

  if (error) {
    if (isSchemaOrMissingTable(error)) {
      section.classList.add("hidden");
      return;
    }
    body.innerHTML = `<p class="auth-hint">RSVP snapshot unavailable (${escapeHtml(error.message)}).</p>`;
    section.classList.remove("hidden");
    return;
  }

  if (!ev) {
    section.classList.add("hidden");
    body.innerHTML = "";
    return;
  }

  const { data: rsvps, error: rErr } = await supabase
    .from("calendar_event_rsvps")
    .select("user_id, status")
    .eq("event_id", ev.id);

  if (rErr) {
    if (isSchemaOrMissingTable(rErr)) {
      section.classList.add("hidden");
      return;
    }
    body.innerHTML = `<p class="auth-hint">${escapeHtml(rErr.message)}</p>`;
    section.classList.remove("hidden");
    return;
  }

  const rows = rsvps || [];
  const uids = [...new Set(rows.map((r) => r.user_id))];
  let names = {};
  if (uids.length) {
    const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", uids);
    names = Object.fromEntries(
      (profs || []).map((p) => [p.id, (p.full_name && String(p.full_name).trim()) || "Player"])
    );
  }

  const byStatus = { available: [], late: [], out: [] };
  rows.forEach((r) => {
    const label = names[r.user_id] || "Player";
    if (byStatus[r.status]) byStatus[r.status].push(label);
  });

  const { data: rosterRows } = await supabase.from("players").select("user_id").eq("team_id", teamIdForQuery);
  const rosterUids = [...new Set((rosterRows || []).map((p) => p.user_id).filter(Boolean))];
  const responded = new Set(rows.map((r) => r.user_id));
  const missingIds = rosterUids.filter((id) => !responded.has(id));
  let noResponseLine = "";
  if (missingIds.length) {
    let missNames = {};
    const { data: missProfs } = await supabase.from("profiles").select("id, full_name").in("id", missingIds);
    missNames = Object.fromEntries(
      (missProfs || []).map((p) => [p.id, (p.full_name && String(p.full_name).trim()) || "Player"])
    );
    const missList = missingIds.map((id) => missNames[id] || `User ${String(id).slice(0, 6)}…`);
    noResponseLine = `<p class="team-rsvp-line team-rsvp-line--muted"><strong>No response yet</strong> — ${missList.map(escapeHtml).join(", ")}</p>`;
  }

  const start = new Date(ev.starts_at);
  const whenShort = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });

  const total = rows.length;
  const summary = `Available ${byStatus.available.length} · Late ${byStatus.late.length} · Out ${byStatus.out.length}${
    total ? ` · ${total} response${total === 1 ? "" : "s"}` : ""
  }`;

  const breakdown = ["available", "late", "out"]
    .map((k) => {
      const people = byStatus[k];
      const head = calendarRsvpStatusLabel(k);
      if (!people.length) {
        return `<p class="team-rsvp-line"><strong>${head}</strong> <span class="auth-hint">—</span></p>`;
      }
      return `<p class="team-rsvp-line"><strong>${head}</strong> — ${people.map(escapeHtml).join(", ")}</p>`;
    })
    .join("");

  body.innerHTML = `
    <p class="team-attendance-event-line"><span class="team-up-next-kind">${escapeHtml(calendarKindLabel(ev.kind))}</span></p>
    <p class="team-attendance-title">${escapeHtml(ev.title)}</p>
    <p class="auth-hint team-attendance-when">${escapeHtml(whenShort)}</p>
    <p class="team-rsvp-summary">${escapeHtml(summary)}</p>
    <div class="team-rsvp-breakdown">${breakdown}${noResponseLine}</div>`;
  section.classList.remove("hidden");
}

async function renderPracticePlans() {
  const ctx = teamPageContext;
  const teamRef = ctx.team;
  const section = document.getElementById("practice-plans-section");
  const listEl = document.getElementById("practice-plans-list");
  const form = document.getElementById("practice-plan-form");
  const msg = document.getElementById("practice-plans-msg");
  const cancelEdit = document.getElementById("practice-plan-cancel-edit");
  if (!section || !listEl) return;

  if (!teamRef?.id) {
    section.classList.add("hidden");
    return;
  }

  const { data: plans, error } = await supabase
    .from("practice_plans")
    .select("id, title, content, updated_at")
    .eq("team_id", teamRef.id)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isSchemaOrMissingTable(error)) {
      section.classList.add("hidden");
      return;
    }
    if (msg) showMsg(msg, error.message, true);
    listEl.innerHTML = "";
    section.classList.remove("hidden");
    return;
  }

  section.classList.remove("hidden");
  if (msg) msg.textContent = "";

  const rows = plans || [];
  if (!rows.length) {
    listEl.innerHTML = `<p class="auth-hint">No practice plans yet.</p>`;
  } else {
    listEl.innerHTML = rows
      .map((plan) => {
        const staffActions = ctx.isStaff
          ? `<div class="practice-plan-actions">
              <button type="button" class="auth-submit auth-submit-secondary btn-practice-plan-edit" data-plan-id="${plan.id}">Edit</button>
              <button type="button" class="auth-submit auth-submit-secondary btn-practice-plan-delete" data-plan-id="${plan.id}">Delete</button>
            </div>`
          : "";
        return `<li class="practice-plan-item">
          <div class="practice-plan-card">
            <h4 class="practice-plan-title">${escapeHtml(plan.title)}</h4>
            <div class="practice-plan-body">${escapeHtml(plan.content || "").replace(/\n/g, "<br>")}</div>
            <p class="auth-hint practice-plan-updated">Updated ${escapeHtml(formatCreatedAt(plan.updated_at))}</p>
            ${staffActions}
          </div>
        </li>`;
      })
      .join("");
  }

  if (form) {
    form.classList.toggle("hidden", !ctx.isStaff);
    if (!ctx.isStaff) {
      if (cancelEdit) cancelEdit.classList.add("hidden");
      const editId = document.getElementById("practice-plan-edit-id");
      const titleIn = document.getElementById("practice-plan-title");
      const contentIn = document.getElementById("practice-plan-content");
      if (editId) editId.value = "";
      if (titleIn) titleIn.value = "";
      if (contentIn) contentIn.value = "";
    }
  }
}

async function renderTeamFocus() {
  const ctx = teamPageContext;
  const team = ctx.team;
  const isStaff = ctx.isStaff;
  const section = document.getElementById("team-focus-section");
  const display = document.getElementById("team-focus-display");
  const form = document.getElementById("team-focus-form");
  const msg = document.getElementById("team-focus-msg");
  if (!section || !display) return;

  if (msg) msg.textContent = "";
  section.classList.remove("hidden");

  const raw = team?.team_focus != null ? String(team.team_focus) : "";
  const focus = raw.trim();
  if (focus) {
    display.innerHTML = `<div class="team-focus-body">${escapeHtml(focus).replace(/\n/g, "<br>")}</div>`;
  } else {
    display.innerHTML = `<p class="auth-hint">No team focus posted yet${isStaff ? " — add one below." : "."}</p>`;
  }
  const updatedAt = team?.team_focus_updated_at;
  if (updatedAt && focus) {
    display.insertAdjacentHTML(
      "beforeend",
      `<p class="auth-hint team-focus-meta">Updated ${escapeHtml(formatCreatedAt(updatedAt))}</p>`
    );
  }

  if (form) {
    form.classList.toggle("hidden", !isStaff);
    const ta = document.getElementById("team-focus-textarea");
    if (ta && isStaff) ta.value = raw;
  }
}

async function renderTeamLinks() {
  const ctx = teamPageContext;
  const section = document.getElementById("team-links-section");
  const listEl = document.getElementById("team-links-list");
  const form = document.getElementById("team-link-add-form");
  const msg = document.getElementById("team-links-msg");
  if (!section || !listEl || !ctx.teamId) return;

  if (msg) msg.textContent = "";

  const { data: links, error } = await supabase
    .from("team_links")
    .select("id, label, url, sort_order, created_at")
    .eq("team_id", ctx.teamId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (isSchemaOrMissingTable(error)) {
      section.classList.add("hidden");
      return;
    }
    showMsg(msg, error.message, true);
    section.classList.remove("hidden");
    return;
  }

  section.classList.remove("hidden");
  const rows = links || [];
  if (!rows.length) {
    listEl.innerHTML = `<p class="auth-hint">No links yet${ctx.isStaff ? " — add one below." : "."}</p>`;
  } else {
    listEl.innerHTML = rows
      .map((link) => {
        const href = normalizeExternalUrl(link.url);
        const label = escapeHtml(link.label || "Link");
        const inner = href
          ? `<a class="team-link-anchor" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : `<span class="team-link-bad">${label}</span> <span class="auth-hint">(invalid URL)</span>`;
        const staffDel = ctx.isStaff
          ? `<button type="button" class="auth-submit auth-submit-secondary btn-team-link-delete" data-link-id="${link.id}" aria-label="Remove link">Remove</button>`
          : "";
        return `<li class="team-link-item">
          <div class="team-link-row">
            <span class="team-link-icon" aria-hidden="true">↗</span>
            <div class="team-link-main">${inner}</div>
            ${staffDel}
          </div>
        </li>`;
      })
      .join("");
  }

  if (form) form.classList.toggle("hidden", !ctx.isStaff);
}

async function renderTeamSeasonGoals() {
  const ctx = teamPageContext;
  const section = document.getElementById("team-season-goals-section");
  const listEl = document.getElementById("team-season-goals-list");
  const form = document.getElementById("team-season-goal-form");
  const msg = document.getElementById("team-season-goals-msg");
  if (!section || !listEl || !ctx.teamId) return;

  if (msg) msg.textContent = "";

  const { data: goals, error } = await supabase
    .from("team_season_goals")
    .select("id, goal_text, status, created_at")
    .eq("team_id", ctx.teamId)
    .order("created_at", { ascending: false });

  if (error) {
    if (isSchemaOrMissingTable(error)) {
      section.classList.add("hidden");
      return;
    }
    showMsg(msg, error.message, true);
    section.classList.remove("hidden");
    return;
  }

  section.classList.remove("hidden");
  const rows = goals || [];
  if (!rows.length) {
    listEl.innerHTML = `<p class="auth-hint">No season goals yet${ctx.isStaff ? " — add one below." : "."}</p>`;
  } else {
    listEl.innerHTML = rows
      .map((g) => {
        const done = g.status === "done";
        const staff = ctx.isStaff
          ? `<span class="team-season-goal-actions">
              ${
                !done
                  ? `<button type="button" class="auth-submit auth-submit-secondary btn-team-season-goal-done" data-goal-id="${g.id}">Mark done</button>`
                  : ""
              }
              <button type="button" class="auth-submit auth-submit-secondary btn-team-season-goal-delete" data-goal-id="${g.id}">Delete</button>
            </span>`
          : "";
        return `<li class="team-season-goal-row ${done ? "team-season-goal-row--done" : ""}">
          <p class="team-season-goal-text">${escapeHtml(g.goal_text)}</p>
          ${staff}
        </li>`;
      })
      .join("");
  }

  if (form) form.classList.toggle("hidden", !ctx.isStaff);
}

function bindTeamFocusUi() {
  if (teamFocusUiBound) return;
  const form = document.getElementById("team-focus-form");
  if (!form) return;
  teamFocusUiBound = true;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tid = teamPageContext.teamId;
    if (!tid || !teamPageContext.isStaff) return;
    const ta = document.getElementById("team-focus-textarea");
    const raw = (ta?.value || "").trim();
    const now = new Date().toISOString();
    const msgEl = document.getElementById("team-focus-msg");
    const { error } = await supabase
      .from("teams")
      .update({ team_focus: raw || null, team_focus_updated_at: raw ? now : null })
      .eq("id", tid);
    if (error) {
      showMsg(msgEl, error.message, true);
      return;
    }
    showMsg(msgEl, "Team focus saved.");
    const { data: fresh } = await supabase.from("teams").select("*").eq("id", tid).single();
    if (fresh) teamPageContext.team = fresh;
    await renderTeamFocus();
  });
}

function bindTeamLinksUi() {
  if (teamLinksUiBound) return;
  const form = document.getElementById("team-link-add-form");
  const list = document.getElementById("team-links-list");
  if (!form || !list) return;
  teamLinksUiBound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tid = teamPageContext.teamId;
    if (!tid || !teamPageContext.isStaff) return;
    const label = (document.getElementById("team-link-label-input")?.value || "").trim();
    const urlRaw = (document.getElementById("team-link-url-input")?.value || "").trim();
    const msgEl = document.getElementById("team-links-msg");
    if (!label) {
      showMsg(msgEl, "Add a name for the link.", true);
      return;
    }
    const url = normalizeExternalUrl(urlRaw);
    if (!url) {
      showMsg(msgEl, "Enter a valid URL (http or https).", true);
      return;
    }

    const { data: top } = await supabase
      .from("team_links")
      .select("sort_order")
      .eq("team_id", tid)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (top?.sort_order != null ? Number(top.sort_order) : -1) + 1;

    const { error } = await supabase.from("team_links").insert({
      team_id: tid,
      label,
      url,
      sort_order: sortOrder
    });
    if (error) {
      showMsg(msgEl, error.message, true);
      return;
    }
    showMsg(msgEl, "Link added.");
    document.getElementById("team-link-label-input").value = "";
    document.getElementById("team-link-url-input").value = "";
    await renderTeamLinks();
  });

  list.addEventListener("click", async (e) => {
    const del = e.target.closest(".btn-team-link-delete");
    if (!del?.dataset.linkId) return;
    const tid = teamPageContext.teamId;
    if (!tid || !teamPageContext.isStaff) return;
    if (!window.confirm("Remove this link?")) return;
    const { error } = await supabase.from("team_links").delete().eq("id", del.dataset.linkId).eq("team_id", tid);
    if (error) {
      showMsg(document.getElementById("team-links-msg"), error.message, true);
      return;
    }
    await renderTeamLinks();
  });
}

function bindTeamSeasonGoalsUi() {
  if (teamSeasonGoalsUiBound) return;
  const form = document.getElementById("team-season-goal-form");
  const list = document.getElementById("team-season-goals-list");
  if (!form || !list) return;
  teamSeasonGoalsUiBound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tid = teamPageContext.teamId;
    if (!tid || !teamPageContext.isStaff) return;
    const input = document.getElementById("team-season-goal-input");
    const text = (input?.value || "").trim();
    const msgEl = document.getElementById("team-season-goals-msg");
    if (!text) {
      showMsg(msgEl, "Enter a goal.", true);
      return;
    }
    const { error } = await supabase.from("team_season_goals").insert({
      team_id: tid,
      goal_text: text,
      status: "active"
    });
    if (error) {
      showMsg(msgEl, error.message, true);
      return;
    }
    showMsg(msgEl, "Goal added.");
    if (input) input.value = "";
    await renderTeamSeasonGoals();
  });

  list.addEventListener("click", async (e) => {
    const doneBtn = e.target.closest(".btn-team-season-goal-done");
    const delBtn = e.target.closest(".btn-team-season-goal-delete");
    const tid = teamPageContext.teamId;
    if (!tid || !teamPageContext.isStaff) return;
    const msgEl = document.getElementById("team-season-goals-msg");

    if (doneBtn?.dataset.goalId) {
      const { error } = await supabase
        .from("team_season_goals")
        .update({ status: "done" })
        .eq("id", doneBtn.dataset.goalId)
        .eq("team_id", tid);
      if (error) {
        showMsg(msgEl, error.message, true);
        return;
      }
      await renderTeamSeasonGoals();
      return;
    }

    if (delBtn?.dataset.goalId) {
      if (!window.confirm("Delete this season goal?")) return;
      const { error } = await supabase.from("team_season_goals").delete().eq("id", delBtn.dataset.goalId).eq("team_id", tid);
      if (error) {
        showMsg(msgEl, error.message, true);
        return;
      }
      await renderTeamSeasonGoals();
    }
  });
}

function bindPracticePlansUi() {
  if (practicePlansUiBound) return;
  const form = document.getElementById("practice-plan-form");
  const list = document.getElementById("practice-plans-list");
  const cancelEdit = document.getElementById("practice-plan-cancel-edit");
  if (!form || !list) return;
  practicePlansUiBound = true;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tid = teamPageContext.teamId;
    const u = teamPageContext.user;
    if (!tid || !u) return;
    const title = (document.getElementById("practice-plan-title")?.value || "").trim();
    const content = (document.getElementById("practice-plan-content")?.value || "").trim();
    const editId = (document.getElementById("practice-plan-edit-id")?.value || "").trim();
    const msgEl = document.getElementById("practice-plans-msg");
    if (!title) {
      showMsg(msgEl, "Add a plan name.", true);
      return;
    }
    const nowIso = new Date().toISOString();
    if (editId) {
      const { error } = await supabase
        .from("practice_plans")
        .update({ title, content, updated_at: nowIso })
        .eq("id", editId)
        .eq("team_id", tid);
      if (error) {
        showMsg(msgEl, error.message, true);
        return;
      }
      showMsg(msgEl, "Plan updated.");
    } else {
      const { error } = await supabase.from("practice_plans").insert({
        team_id: tid,
        title,
        content,
        created_by: u.id
      });
      if (error) {
        showMsg(msgEl, error.message, true);
        return;
      }
      showMsg(msgEl, "Plan saved.");
    }
    const editField = document.getElementById("practice-plan-edit-id");
    const titleIn = document.getElementById("practice-plan-title");
    const contentIn = document.getElementById("practice-plan-content");
    if (editField) editField.value = "";
    if (titleIn) titleIn.value = "";
    if (contentIn) contentIn.value = "";
    if (cancelEdit) cancelEdit.classList.add("hidden");
    await renderPracticePlans();
  });

  cancelEdit?.addEventListener("click", () => {
    const editField = document.getElementById("practice-plan-edit-id");
    const titleIn = document.getElementById("practice-plan-title");
    const contentIn = document.getElementById("practice-plan-content");
    if (editField) editField.value = "";
    if (titleIn) titleIn.value = "";
    if (contentIn) contentIn.value = "";
    cancelEdit.classList.add("hidden");
  });

  list.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".btn-practice-plan-edit");
    const delBtn = e.target.closest(".btn-practice-plan-delete");
    const tid = teamPageContext.teamId;
    if (!tid) return;

    if (editBtn?.dataset.planId) {
      const { data: row } = await supabase
        .from("practice_plans")
        .select("title, content")
        .eq("id", editBtn.dataset.planId)
        .eq("team_id", tid)
        .maybeSingle();
      if (row) {
        const editField = document.getElementById("practice-plan-edit-id");
        const titleIn = document.getElementById("practice-plan-title");
        const contentIn = document.getElementById("practice-plan-content");
        if (editField) editField.value = editBtn.dataset.planId;
        if (titleIn) titleIn.value = row.title || "";
        if (contentIn) contentIn.value = row.content || "";
        cancelEdit?.classList.remove("hidden");
        form.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }

    if (delBtn?.dataset.planId) {
      if (!window.confirm("Delete this practice plan?")) return;
      const { error } = await supabase.from("practice_plans").delete().eq("id", delBtn.dataset.planId).eq("team_id", tid);
      if (error) {
        showMsg(document.getElementById("practice-plans-msg"), error.message, true);
        return;
      }
      await renderPracticePlans();
    }
  });
}

function bindPlayerSheetDevUi() {
  if (playerSheetDevBound || !sheet) return;
  playerSheetDevBound = true;

  sheet.addEventListener("submit", async (e) => {
    const goalForm = e.target.closest(".player-goal-add-form");
    if (goalForm) {
      e.preventDefault();
      const pid = goalForm.dataset.playerId;
      const input = goalForm.querySelector(".player-goal-input");
      const text = (input?.value || "").trim();
      const tid = teamPageContext.teamId;
      const u = teamPageContext.user;
      if (!text || !pid || !tid || !u) return;
      const { error } = await supabase.from("player_goals").insert({
        team_id: tid,
        player_id: pid,
        goal_text: text,
        status: "active",
        created_by: u.id
      });
      if (error) {
        if (!isSchemaOrMissingTable(error)) {
          console.error(error);
        }
        return;
      }
      if (lastOpenedPlayerRow) await loadPlayerSheetContent(lastOpenedPlayerRow);
      return;
    }

    const noteForm = e.target.closest(".player-coach-note-form");
    if (noteForm) {
      e.preventDefault();
      const pid = noteForm.dataset.playerId;
      const ta = noteForm.querySelector(".player-coach-note-input");
      const body = (ta?.value || "").trim();
      const tid = teamPageContext.teamId;
      const u = teamPageContext.user;
      if (!body || !pid || !tid || !u) return;
      const { error } = await supabase.from("player_coach_notes").insert({
        team_id: tid,
        player_id: pid,
        body,
        created_by: u.id
      });
      if (error) {
        if (!isSchemaOrMissingTable(error)) {
          console.error(error);
        }
        return;
      }
      if (ta) ta.value = "";
      if (lastOpenedPlayerRow) await loadPlayerSheetContent(lastOpenedPlayerRow);
    }
  });

  sheet.addEventListener("click", async (e) => {
    const doneBtn = e.target.closest(".btn-goal-done");
    if (doneBtn?.dataset.goalId) {
      const { error } = await supabase.from("player_goals").update({ status: "done" }).eq("id", doneBtn.dataset.goalId);
      if (error) {
        if (!isSchemaOrMissingTable(error)) console.error(error);
        return;
      }
      if (lastOpenedPlayerRow) await loadPlayerSheetContent(lastOpenedPlayerRow);
      return;
    }

    const delGoal = e.target.closest(".btn-goal-delete");
    if (delGoal?.dataset.goalId) {
      if (!window.confirm("Remove this goal?")) return;
      const { error } = await supabase.from("player_goals").delete().eq("id", delGoal.dataset.goalId);
      if (error) {
        if (!isSchemaOrMissingTable(error)) console.error(error);
        return;
      }
      if (lastOpenedPlayerRow) await loadPlayerSheetContent(lastOpenedPlayerRow);
      return;
    }

    const delNote = e.target.closest(".btn-coach-note-delete");
    if (delNote?.dataset.noteId) {
      if (!window.confirm("Delete this note?")) return;
      const { error } = await supabase.from("player_coach_notes").delete().eq("id", delNote.dataset.noteId);
      if (error) {
        if (!isSchemaOrMissingTable(error)) console.error(error);
        return;
      }
      if (lastOpenedPlayerRow) await loadPlayerSheetContent(lastOpenedPlayerRow);
    }
  });
}

async function loadTeam() {
  let showContent = false;
  try {
    if (!loadingEl || !contentEl) return;

    if (!teamId) {
      if (errorFull) {
        errorFull.textContent = "Missing team id.";
        errorFull.classList.remove("hidden");
        errorFull.classList.add("auth-message--error");
      }
      return;
    }

    const user = await getSessionUser();
    if (!user) {
      window.location.href = "app.html";
      return;
    }

    const { data: team, error } = await supabase
      .from("teams")
      .select("*")
      .eq("id", teamId)
      .single();

    if (error || !team) {
      if (errorFull) {
        errorFull.textContent = error?.message || "Team not found.";
        errorFull.classList.remove("hidden");
        errorFull.classList.add("auth-message--error");
      }
      return;
    }

    const { data: membership } = await supabase
      .from("players")
      .select("id")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle();

    const effectiveCoachId = teamCoachOrOwnerId(team);
    const isCoach = sameUserId(effectiveCoachId, user.id);
    const isAssistantCoach = sameUserId(team.assistant_coach_id, user.id);
    const isPlayer = !!membership;

    if (!isCoach && !isAssistantCoach && !isPlayer) {
      if (errorFull) {
        errorFull.textContent = "You do not have access to this team.";
        errorFull.classList.remove("hidden");
      }
      return;
    }

    const teamNameEl = document.getElementById("team-name");
    if (teamNameEl) teamNameEl.textContent = team.name;
    const w = Number(team.wins) || 0;
    const l = Number(team.losses) || 0;
    const pct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : "—";
    const recEl = document.getElementById("team-record");
    if (recEl) recEl.textContent = `Record ${w}–${l} · Win % ${pct}`;

    const isStaff = isCoach || isAssistantCoach;
    teamPageContext = { teamId, team, user, isStaff, effectiveCoachId };

    await renderPracticePlans();
    await renderTeamFocus();
    await renderTeamLinks();
    await renderTeamSeasonGoals();

    if (isCoach && coachBlock && inviteCodeEl) {
      coachBlock.classList.remove("hidden");
      const code = await ensureInviteCode(team);
      inviteCodeEl.textContent = code || "—";
      if (btnCopy && !copyHandlerAttached) {
        copyHandlerAttached = true;
        btnCopy.addEventListener("click", async () => {
          const t = inviteCodeEl.textContent.trim();
          if (!t || t === "—") return;
          try {
            await navigator.clipboard.writeText(t);
            showMsg(document.getElementById("invite-copy-msg"), "Copied to clipboard.");
          } catch {
            showMsg(document.getElementById("invite-copy-msg"), "Could not copy — select the code manually.", true);
          }
        });
      }
    }

    if (playerNote) {
      playerNote.classList.toggle("hidden", isStaff || !isPlayer);
    }

    const calLink = document.getElementById("team-calendar-link");
    if (calLink && teamId) {
      calLink.href = `calendar.html?team=${encodeURIComponent(teamId)}`;
    }

    await renderUpNext(teamId, isStaff);
    await renderAttendanceSnapshot(teamId);

    if (settingsBtn) {
      settingsBtn.classList.toggle("hidden", !isStaff);
      if (isStaff) {
        settingsBtn.onclick = () => openSettingsModal();
      }
    }

    if (isStaff) {
      const createdEl = document.getElementById("team-settings-created");
      const recordEl = document.getElementById("team-settings-record");
      const coachEl = document.getElementById("team-settings-coach");
      const assistantEl = document.getElementById("team-settings-assistant");
      const aCodeEl = document.getElementById("assistant-invite-code");
      if (createdEl) createdEl.textContent = formatCreatedAt(team.created_at);
      if (recordEl) recordEl.textContent = `${w}–${l} (Win % ${pct})`;

      const ids = [effectiveCoachId, team.assistant_coach_id].filter(Boolean);
      let nameMap = {};
      if (ids.length) {
        const { data: profileRows } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        nameMap = Object.fromEntries(
          (profileRows || []).map((r) => [r.id, r.full_name && String(r.full_name).trim()])
        );
      }
      if (coachEl) coachEl.textContent = (effectiveCoachId && nameMap[effectiveCoachId]) || "Coach account";
      if (assistantEl) {
        assistantEl.textContent = team.assistant_coach_id
          ? (nameMap[team.assistant_coach_id] || "Assistant coach account")
          : "Not assigned";
      }

      const assistantCode = await ensureAssistantInviteCode(team);
      if (aCodeEl) aCodeEl.textContent = assistantCode || "—";
      const btnCopyAssistant = document.getElementById("btn-copy-assistant-invite");
      const copyAssistantMsg = document.getElementById("assistant-invite-copy-msg");
      if (btnCopyAssistant && !settingsCopyAttached) {
        settingsCopyAttached = true;
        btnCopyAssistant.addEventListener("click", async () => {
          const t = (aCodeEl?.textContent || "").trim();
          if (!t || t === "—") return;
          try {
            await navigator.clipboard.writeText(t);
            showMsg(copyAssistantMsg, "Copied to clipboard.");
          } catch {
            showMsg(copyAssistantMsg, "Could not copy — select code manually.", true);
          }
        });
      }

      await renderBannedList(team, isStaff);
    }

    if (isCoach) {
      const btnDel = document.getElementById("btn-delete-team");
      const delMsg = document.getElementById("delete-team-msg");
      if (btnDel && delMsg && !deleteHandlerAttached) {
        deleteHandlerAttached = true;
        btnDel.addEventListener("click", async () => {
          const ok = window.confirm(
            `Delete “${team.name}” permanently?\n\nThis removes the team, roster, and linked games. This cannot be undone.`
          );
          if (!ok) return;
          showMsg(delMsg, "Deleting…");
          const { error: delErr } = await supabase.from("teams").delete().eq("id", teamId);
          if (delErr) {
            showMsg(delMsg, delErr.message, true);
            return;
          }
          window.location.href = "my-teams.html";
        });
      }
    }

    let { data: players, error: pErr } = await supabase
      .from("players")
      .select("id, name, points, assists, rebounds, user_id")
      .eq("team_id", teamId);

    if (pErr && /assists|rebounds|schema cache|PGRST204|42703/i.test(String(pErr.message || ""))) {
      const fallback = await supabase
        .from("players")
        .select("id, name, points, user_id")
        .eq("team_id", teamId);
      players = (fallback.data || []).map((r) => ({ ...r, assists: 0, rebounds: 0 }));
      pErr = fallback.error;
    }

    if (pErr) {
      showMsg(document.getElementById("roster-msg"), pErr.message, true);
    }

    const plistRaw = players || [];
    const uids = [...new Set(plistRaw.map((p) => p.user_id).filter(Boolean))];
    let profileNames = {};
    if (uids.length) {
      const { data: profRows } = await supabase.from("profiles").select("id, full_name").in("id", uids);
      profileNames = Object.fromEntries(
        (profRows || []).map((r) => [r.id, r.full_name && String(r.full_name).trim()])
      );
    }

    const plist = plistRaw
      .map((p) => ({
        ...p,
        display_name:
          (p.user_id && profileNames[p.user_id]) || (p.name && String(p.name).trim()) || "Player"
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }));

    const list = document.getElementById("player-list");
    const noPlayers = document.getElementById("no-players");
    if (list) list.innerHTML = "";
    if (noPlayers) noPlayers.classList.toggle("hidden", plist.length > 0);

    plist.forEach((p) => {
      const li = document.createElement("li");
      li.className = "coach-list-row";
      const actions = isStaff
        ? `<span class="roster-admin-actions">
            <button type="button" class="auth-submit auth-submit-secondary btn-kick-player" data-player-id="${p.id}" data-player-name="${escapeHtml(p.display_name)}">Kick</button>
            ${p.user_id ? `<button type="button" class="auth-submit auth-submit-secondary btn-ban-player" data-player-id="${p.id}" data-user-id="${p.user_id}" data-player-name="${escapeHtml(p.display_name)}">Ban</button>` : ""}
          </span>`
        : "";
      const statsEditor = isStaff
        ? `<div class="roster-stats-editor" data-player-id="${p.id}">
             <div class="roster-stats-fields" role="group" aria-label="Stats for ${escapeHtml(p.display_name)}">
               <div class="roster-stat-field">
                 <span class="roster-stat-label">PTS</span>
                 <input type="number" inputmode="numeric" class="roster-stat-input" data-stat="points" value="${Number(p.points) || 0}" aria-label="Points">
               </div>
               <div class="roster-stat-field">
                 <span class="roster-stat-label">AST</span>
                 <input type="number" inputmode="numeric" class="roster-stat-input" data-stat="assists" value="${Number(p.assists) || 0}" aria-label="Assists">
               </div>
               <div class="roster-stat-field">
                 <span class="roster-stat-label">REB</span>
                 <input type="number" inputmode="numeric" class="roster-stat-input" data-stat="rebounds" value="${Number(p.rebounds) || 0}" aria-label="Rebounds">
               </div>
             </div>
             <button type="button" class="auth-submit auth-submit-secondary btn-save-stats roster-stats-save" data-player-id="${p.id}">Save stats</button>
           </div>`
        : "";
      li.innerHTML = `
        <div class="roster-row-head">
          <button type="button" class="coach-list-player-btn" data-player-id="${p.id}">
            <span class="roster-player-name">${escapeHtml(p.display_name)}</span>
            <span class="coach-record roster-player-stats-line">PTS ${Number(p.points) || 0} · AST ${Number(p.assists) || 0} · REB ${Number(p.rebounds) || 0}</span>
          </button>
          ${actions}
        </div>
        ${statsEditor}`;
      const btn = li.querySelector(".coach-list-player-btn");
      btn?.addEventListener("click", () => openPlayerSheet(p));
      list?.appendChild(li);
    });

    lastRosterExport = { plist, teamName: team.name || "Team", teamId };
    const btnExport = document.getElementById("btn-export-roster");
    if (btnExport) {
      btnExport.classList.toggle("hidden", !isStaff);
      if (isStaff && !exportRosterClickBound) {
        exportRosterClickBound = true;
        btnExport.addEventListener("click", exportRosterCsv);
      }
    }

    if (isStaff && list && !rosterActionsBound) {
      rosterActionsBound = true;
      list.addEventListener("click", async (e) => {
        const kickBtn = e.target.closest(".btn-kick-player");
        if (kickBtn?.dataset.playerId) {
          const pname = kickBtn.dataset.playerName || "this player";
          if (!window.confirm(`Kick ${pname} from roster? They can join back with a team code.`)) return;
          const { error: kickErr } = await supabase.from("players").delete().eq("id", kickBtn.dataset.playerId);
          if (kickErr) {
            showMsg(document.getElementById("roster-msg"), kickErr.message, true);
            return;
          }
          await loadTeam();
          return;
        }

        const banBtn = e.target.closest(".btn-ban-player");
        if (banBtn?.dataset.playerId && banBtn?.dataset.userId) {
          const pname = banBtn.dataset.playerName || "this player";
          if (!window.confirm(`Ban ${pname}? They will be removed and blocked from rejoining until unbanned.`)) return;
          const uid = banBtn.dataset.userId;
          const { error: banErr } = await supabase.from("team_bans").upsert(
            {
              team_id: team.id,
              user_id: uid,
              banned_by: user.id,
              banned_name: pname
            },
            { onConflict: "team_id,user_id" }
          );
          if (banErr) {
            showMsg(document.getElementById("roster-msg"), banErr.message, true);
            return;
          }
          await supabase.from("players").delete().eq("id", banBtn.dataset.playerId);
          await loadTeam();
        }

        const saveStatsBtn = e.target.closest(".btn-save-stats");
        if (saveStatsBtn?.dataset.playerId) {
          const root = saveStatsBtn.closest(".roster-stats-editor");
          const pts = Number(root?.querySelector('[data-stat="points"]')?.value || 0) || 0;
          const ast = Number(root?.querySelector('[data-stat="assists"]')?.value || 0) || 0;
          const reb = Number(root?.querySelector('[data-stat="rebounds"]')?.value || 0) || 0;
          let { error: statsErr } = await supabase
            .from("players")
            .update({ points: pts, assists: ast, rebounds: reb })
            .eq("id", saveStatsBtn.dataset.playerId);
          if (statsErr && /assists|rebounds|schema cache|PGRST204|42703/i.test(String(statsErr.message || ""))) {
            const fallback = await supabase
              .from("players")
              .update({ points: pts })
              .eq("id", saveStatsBtn.dataset.playerId);
            statsErr = fallback.error;
            if (!statsErr) {
              showMsg(
                document.getElementById("roster-msg"),
                "Saved points. Run migration 003 (or latest schema) to enable assists/rebounds."
              );
              await loadTeam();
              return;
            }
          }
          if (statsErr) {
            showMsg(document.getElementById("roster-msg"), statsErr.message, true);
            return;
          }
          showMsg(document.getElementById("roster-msg"), "Stats saved.");
          await loadTeam();
        }
      });
    }

    const bannedList = document.getElementById("team-banned-list");
    if (isStaff && bannedList) {
      bannedList.onclick = async (e) => {
        const btn = e.target.closest(".btn-unban-player");
        if (!btn?.dataset.banId) return;
        const { error: unErr } = await supabase.from("team_bans").delete().eq("id", btn.dataset.banId);
        if (unErr) {
          showMsg(document.getElementById("assistant-invite-copy-msg"), unErr.message, true);
          return;
        }
        await renderBannedList(team, isStaff);
      };
    }

    if (!chatInited) {
      chatInited = true;
      initTeamChat({
        teamId,
        getSessionUser,
        coachUserId: effectiveCoachId,
        assistantCoachUserId: team.assistant_coach_id,
        canModerate: isStaff
      });
    }

    showContent = true;
  } catch (err) {
    console.error(err);
    if (errorFull) {
      errorFull.textContent = err?.message || "Something went wrong loading this team.";
      errorFull.classList.remove("hidden");
      errorFull.classList.add("auth-message--error");
    }
  } finally {
    hideLoadingBanner();
    if (showContent) {
      contentEl?.classList.remove("hidden");
      if (errorFull) {
        errorFull.classList.add("hidden");
        errorFull.textContent = "";
      }
    }
  }
}

bindPracticePlansUi();
bindTeamFocusUi();
bindTeamLinksUi();
bindTeamSeasonGoalsUi();
bindPlayerSheetDevUi();
loadTeam();
