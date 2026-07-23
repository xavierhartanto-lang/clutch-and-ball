"use strict";

import supabase from "./supabase.js";
import { getSessionUser, showMsg, fetchTeamsCoachedByUser } from "./coach-shared.js";
import { downloadCalendarIcs, escapeAttr, googleCalendarTemplateUrl, showToast } from "./ui.js";
import { formatRsvpStatus, upsertMyEventRsvp, notifyRsvpEmailSideEffect } from "./rsvp.js";
import { invokeGoogleCalendarPurge, invokeGoogleCalendarSync, fetchGoogleCalendarLinkStatus } from "./google-calendar-client.js";

const gridEl = document.getElementById("cal-grid");
const monthLabel = document.getElementById("cal-month-label");
const btnPrev = document.getElementById("cal-prev");
const btnNext = document.getElementById("cal-next");
const selectedTitle = document.getElementById("cal-selected-title");
const dayList = document.getElementById("cal-day-list");
const addForm = document.getElementById("cal-add-form");
const formDate = document.getElementById("cal-form-date");
const teamSelect = document.getElementById("cal-team");
const msgEl = document.getElementById("cal-msg");

let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth();
let selectedYmd = null;
let monthEvents = [];
let teamAccessMap = new Map();
let currentUserId = null;
let rsvpMap = new Map();
let rsvpSavingEventId = null;
let googleCalendarLinked = false;

const monthNames = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function truncateCalTitle(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

function formatCalCellTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function eventsForDay(ymdStr) {
  return monthEvents.filter((ev) => {
    const t = new Date(ev.starts_at);
    return ymd(t) === ymdStr;
  });
}

async function loadTeamOptions(userId) {
  if (!teamSelect) return;
  teamSelect.innerHTML = '<option value="">— Personal —</option>';
  teamAccessMap = new Map();

  const { data: coachedRows } = await fetchTeamsCoachedByUser(userId);
  const coached = coachedRows || [];
  const { data: assistantRows } = await supabase
    .from("teams")
    .select("id, name")
    .eq("assistant_coach_id", userId)
    .order("name");

  const { data: played } = await supabase
    .from("players")
    .select("team_id")
    .eq("user_id", userId);

  const seen = new Set();
  (coached || []).forEach((t) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (coach)`;
    teamSelect.appendChild(opt);
    teamAccessMap.set(t.id, "coach");
  });

  (assistantRows || []).forEach((t) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = `${t.name} (assistant)`;
    teamSelect.appendChild(opt);
    teamAccessMap.set(t.id, "assistant");
  });

  const pids = [...new Set((played || []).map((r) => r.team_id).filter(Boolean))];
  if (pids.length) {
    const { data: pteams } = await supabase.from("teams").select("id, name").in("id", pids).order("name");
    (pteams || []).forEach((t) => {
      if (seen.has(t.id)) return;
      seen.add(t.id);
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.name} (member)`;
      teamSelect.appendChild(opt);
      teamAccessMap.set(t.id, "member");
    });
  }
}

async function loadMonthEvents(userId) {
  const start = new Date(viewYear, viewMonth, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(viewYear, viewMonth + 1, 0);
  end.setHours(23, 59, 59, 999);

  const teamIds = [...teamAccessMap.keys()];
  let q = supabase
    .from("calendar_events")
    .select("id, title, kind, starts_at, ends_at, notes, team_id, user_id")
    .gte("starts_at", start.toISOString())
    .lte("starts_at", end.toISOString())
    .order("starts_at");

  if (teamIds.length) {
    q = q.or(`user_id.eq.${userId},team_id.in.(${teamIds.join(",")})`);
  } else {
    q = q.eq("user_id", userId);
  }
  const { data, error } = await q;

  if (error) {
    showMsg(msgEl, error.message, true);
    monthEvents = [];
    return;
  }
  monthEvents = data || [];
}

async function loadMonthRsvps() {
  rsvpMap = new Map();
  const eventIds = monthEvents.map((e) => e.id).filter(Boolean);
  if (!eventIds.length) return;
  const { data, error } = await supabase
    .from("calendar_event_rsvps")
    .select("event_id, user_id, status")
    .in("event_id", eventIds);
  if (error && !/calendar_event_rsvps|does not exist/i.test(error.message || "")) {
    showMsg(msgEl, error.message, true);
    return;
  }
  (data || []).forEach((row) => {
    const arr = rsvpMap.get(row.event_id) || [];
    arr.push(row);
    rsvpMap.set(row.event_id, arr);
  });
}

function renderGrid() {
  if (!gridEl || !monthLabel) return;
  monthLabel.textContent = `${monthNames[viewMonth]} ${viewYear}`;

  const first = new Date(viewYear, viewMonth, 1);
  const startPad = first.getDay();
  const days = new Date(viewYear, viewMonth + 1, 0).getDate();

  gridEl.innerHTML = "";
  const today = ymd(new Date());

  for (let i = 0; i < startPad; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-cell cal-cell--empty";
    gridEl.appendChild(cell);
  }

  for (let d = 1; d <= days; d++) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-cell";
    const dateObj = new Date(viewYear, viewMonth, d);
    const key = ymd(dateObj);
    cell.dataset.ymd = key;
    cell.setAttribute("role", "gridcell");
    if (key === today) cell.classList.add("cal-cell--today");
    if (key === selectedYmd) cell.classList.add("cal-cell--selected");

    const num = document.createElement("span");
    num.className = "cal-cell-num";
    num.textContent = String(d);
    cell.appendChild(num);

    const dayEvs = eventsForDay(key).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const maxLines = 3;
    if (dayEvs.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "cal-cell-events";
      dayEvs.slice(0, maxLines).forEach((ev) => {
        const line = document.createElement("span");
        line.className = "cal-cell-event-line";
        const timeStr = formatCalCellTime(ev.starts_at);
        line.textContent = `${timeStr} ${truncateCalTitle(ev.title, 24)}`;
        line.title = `${ev.title} — ${timeStr}`;
        wrap.appendChild(line);
      });
      if (dayEvs.length > maxLines) {
        const more = document.createElement("span");
        more.className = "cal-cell-event-more";
        more.textContent = `+${dayEvs.length - maxLines} more`;
        wrap.appendChild(more);
      }
      cell.appendChild(wrap);
    }

    cell.addEventListener("click", () => selectDay(key));
    gridEl.appendChild(cell);
  }
}

function renderDayPanel() {
  if (!selectedTitle || !dayList || !addForm || !formDate) return;

  if (!selectedYmd) {
    selectedTitle.textContent = "Select a Date";
    dayList.innerHTML = `<li class="auth-hint cal-day-empty">Choose a day to review events and RSVP quickly.</li>`;
    addForm.classList.add("hidden");
    formDate.value = "";
    return;
  }

  const pretty = parseYmd(selectedYmd).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  selectedTitle.textContent = pretty;
  formDate.value = selectedYmd;
  addForm.classList.remove("hidden");

  const evs = eventsForDay(selectedYmd);
  dayList.innerHTML = "";

  if (!evs.length) {
    const li = document.createElement("li");
    li.className = "auth-hint cal-day-empty";
    li.textContent = "No events yet — add one below.";
    dayList.appendChild(li);
  } else {
    evs.forEach((ev) => {
      const canManageTeamEvent = !!ev.team_id && ["coach", "assistant"].includes(teamAccessMap.get(ev.team_id));
      const canManage = ev.user_id === currentUserId || canManageTeamEvent;
      const evRsvps = rsvpMap.get(ev.id) || [];
      const mine = evRsvps.find((r) => r.user_id === currentUserId);
      const counts = {
        available: evRsvps.filter((r) => r.status === "available").length,
        late: evRsvps.filter((r) => r.status === "late").length,
        out: evRsvps.filter((r) => r.status === "out").length
      };
      const mineLabel = formatRsvpStatus(mine?.status);
      const gSyncBtn = googleCalendarLinked
        ? `<button type="button" class="cal-google-sync" data-event-id="${escapeAttr(ev.id)}">Save to my Google Calendar</button>`
        : "";
      const gcalUrl = googleCalendarTemplateUrl({
        title: ev.title || "Event",
        startIso: ev.starts_at,
        endIso: ev.ends_at || "",
        description: ev.notes || ""
      });
      const gcalBtn = gcalUrl
        ? `<a class="cal-gcal-open" href="${escapeAttr(gcalUrl)}" target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>`
        : "";
      const icsBtn = `<button type="button" class="cal-ics-download" data-ics-title="${escapeAttr(ev.title || "Event")}" data-ics-start="${escapeAttr(ev.starts_at)}" data-ics-end="${escapeAttr(ev.ends_at || "")}" data-ics-notes="${escapeAttr(ev.notes || "")}">Add to calendar (.ics)</button>`;
      const rsvpBlock = ev.team_id
        ? `<div class="cal-rsvp-wrap${rsvpSavingEventId === ev.id ? " cal-rsvp-wrap--saving" : ""}">
             <p class="cal-rsvp-hint">Are you coming?</p>
             <p class="cal-rsvp-my-status">Your status: <strong>${escapeHtml(mineLabel)}</strong></p>
             <div class="cal-rsvp-actions" role="group" aria-label="RSVP for this event">
               <button type="button" class="cal-rsvp-btn ${mine?.status === "available" ? "cal-rsvp-btn--active" : ""}" data-event-id="${ev.id}" data-status="available" ${rsvpSavingEventId === ev.id ? "disabled" : ""}>Available</button>
               <button type="button" class="cal-rsvp-btn ${mine?.status === "late" ? "cal-rsvp-btn--active" : ""}" data-event-id="${ev.id}" data-status="late" ${rsvpSavingEventId === ev.id ? "disabled" : ""}>Late</button>
               <button type="button" class="cal-rsvp-btn ${mine?.status === "out" ? "cal-rsvp-btn--active" : ""}" data-event-id="${ev.id}" data-status="out" ${rsvpSavingEventId === ev.id ? "disabled" : ""}>Out</button>
             </div>
             <p class="auth-hint cal-rsvp-counts">
               <span class="cal-rsvp-count-chip">Available ${counts.available}</span>
               <span class="cal-rsvp-count-chip">Late ${counts.late}</span>
               <span class="cal-rsvp-count-chip">Out ${counts.out}</span>
             </p>
           </div>`
        : "";
      const li = document.createElement("li");
      li.className = "cal-event-row";
      const t = new Date(ev.starts_at);
      const timeStr = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      li.innerHTML = `
        <div class="cal-event-main">
          <span class="cal-event-kind">${escapeHtml(ev.kind)}</span>
          <strong>${escapeHtml(ev.title)}</strong>
          <span class="cal-event-time">${escapeHtml(timeStr)}${ev.notes ? ` · ${escapeHtml(ev.notes)}` : ""}</span>
          <div class="cal-event-ics-row">${icsBtn}${gcalBtn}${gSyncBtn}</div>
        </div>
        <span>
          ${canManage ? `<button type="button" class="cal-event-edit" data-id="${ev.id}" aria-label="Edit event">Edit</button>` : ""}
          ${canManage ? `<button type="button" class="cal-event-delete" data-id="${ev.id}" aria-label="Delete event">×</button>` : ""}
        </span>
        ${rsvpBlock}`;
      dayList.appendChild(li);
    });
  }
}

function selectDay(key) {
  selectedYmd = key;
  renderGrid();
  renderDayPanel();
}

async function refresh() {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = "app.html";
    return;
  }
  currentUserId = user.id;
  dayList.innerHTML = `<li class="auth-hint cal-day-empty">Loading events…</li>`;
  await loadMonthEvents(user.id);
  await loadMonthRsvps();
  const gst = await fetchGoogleCalendarLinkStatus();
  googleCalendarLinked = !!gst.linked;
  renderGrid();
  renderDayPanel();
}

btnPrev?.addEventListener("click", () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  selectedYmd = null;
  refresh();
});

btnNext?.addEventListener("click", () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  selectedYmd = null;
  refresh();
});

dayList?.addEventListener("click", async (e) => {
  const gSync = e.target.closest(".cal-google-sync");
  if (gSync?.dataset.eventId) {
    const r = await invokeGoogleCalendarSync(gSync.dataset.eventId);
    if (r.ok && !r.skipped) showToast("Saved to your Google Calendar.");
    else if (r.ok && r.skipped) {
      showMsg(
        msgEl,
        "Connect Google Calendar under Account to sync automatically.",
        true
      );
      showToast("Connect Google under Account first.", "error");
    } else {
      showToast(r.error || "Google sync failed", "error");
    }
    return;
  }
  const icsBtn = e.target.closest(".cal-ics-download");
  if (icsBtn?.dataset.icsStart) {
    downloadCalendarIcs({
      filename: (icsBtn.dataset.icsTitle || "event").replace(/\s+/g, "_").slice(0, 72),
      title: icsBtn.dataset.icsTitle || "Event",
      startIso: icsBtn.dataset.icsStart,
      endIso: icsBtn.dataset.icsEnd || undefined,
      description: icsBtn.dataset.icsNotes || ""
    });
    return;
  }
  const rsvpBtn = e.target.closest(".cal-rsvp-btn");
  if (rsvpBtn?.dataset.eventId && rsvpBtn?.dataset.status) {
    const user = await getSessionUser();
    if (!user) return;
    const eventId = rsvpBtn.dataset.eventId;
    const status = rsvpBtn.dataset.status;
    rsvpSavingEventId = eventId;
    renderDayPanel();
    const { error } = await upsertMyEventRsvp({ eventId, userId: user.id, status });
    if (error) {
      rsvpSavingEventId = null;
      renderDayPanel();
      if (/calendar_event_rsvps|does not exist/i.test(error.message || "")) {
        showMsg(msgEl, "Run latest migration to enable attendance RSVP.", true);
      } else {
        showMsg(msgEl, error.message, true);
      }
      showToast(error.message || "Could not save RSVP", "error");
      return;
    }
    await notifyRsvpEmailSideEffect({ event_id: eventId, user_id: user.id, status });
    showToast(`RSVP saved · ${formatRsvpStatus(status)}`);
    showMsg(msgEl, `Saved: ${formatRsvpStatus(status)} for this event.`);
    await loadMonthRsvps();
    rsvpSavingEventId = null;
    renderDayPanel();
    return;
  }

  const editBtn = e.target.closest(".cal-event-edit");
  if (editBtn?.dataset.id) {
    const ev = monthEvents.find((r) => r.id === editBtn.dataset.id);
    if (!ev) return;
    const eventIdEl = document.getElementById("cal-event-id");
    const titleEl = document.getElementById("cal-title");
    const kindEl = document.getElementById("cal-kind");
    const startEl = document.getElementById("cal-start-time");
    const endEl = document.getElementById("cal-end-time");
    const notesEl = document.getElementById("cal-notes");
    const submitBtn = document.getElementById("cal-submit-btn");
    const cancelBtn = document.getElementById("cal-cancel-edit");
    if (eventIdEl) eventIdEl.value = ev.id;
    if (titleEl) titleEl.value = ev.title || "";
    if (kindEl) kindEl.value = ev.kind || "event";
    if (notesEl) notesEl.value = ev.notes || "";
    if (teamSelect) teamSelect.value = ev.team_id || "";
    const s = new Date(ev.starts_at);
    if (startEl) startEl.value = `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`;
    if (endEl) {
      if (ev.ends_at) {
        const ee = new Date(ev.ends_at);
        endEl.value = `${String(ee.getHours()).padStart(2, "0")}:${String(ee.getMinutes()).padStart(2, "0")}`;
      } else {
        endEl.value = "";
      }
    }
    if (submitBtn) submitBtn.textContent = "Save changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    showMsg(msgEl, "Editing event. Update details and save.");
    return;
  }

  const btn = e.target.closest(".cal-event-delete");
  if (!btn?.dataset.id) return;
  const user = await getSessionUser();
  if (!user) return;
  const ev = monthEvents.find((r) => r.id === btn.dataset.id);
  if (!ev) return;
  const canManageTeamEvent = !!ev.team_id && ["coach", "assistant"].includes(teamAccessMap.get(ev.team_id));
  const purge = await invokeGoogleCalendarPurge(btn.dataset.id);
  if (!purge.ok && purge.error && !/404|not deployed|functions|Failed to fetch/i.test(String(purge.error))) {
    console.warn("[Google Calendar]", purge.error);
  }
  const delQuery = supabase.from("calendar_events").delete().eq("id", btn.dataset.id);
  if (!canManageTeamEvent) {
    delQuery.eq("user_id", user.id);
  }
  const { error } = await delQuery;
  if (error) {
    showMsg(msgEl, error.message, true);
    return;
  }
  await refresh();
});

document.getElementById("cal-cancel-edit")?.addEventListener("click", () => {
  const eventIdEl = document.getElementById("cal-event-id");
  const submitBtn = document.getElementById("cal-submit-btn");
  const cancelBtn = document.getElementById("cal-cancel-edit");
  if (eventIdEl) eventIdEl.value = "";
  if (submitBtn) submitBtn.textContent = "Add to Calendar";
  if (cancelBtn) cancelBtn.classList.add("hidden");
  showMsg(msgEl, "");
});

addForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg(msgEl, "");
  const user = await getSessionUser();
  if (!user) return;

  const dateStr = formDate.value;
  const title = document.getElementById("cal-title")?.value.trim();
  const kind = document.getElementById("cal-kind")?.value || "event";
  const startT = document.getElementById("cal-start-time")?.value;
  const endT = document.getElementById("cal-end-time")?.value;
  const notes = document.getElementById("cal-notes")?.value.trim() || null;
  const teamId = teamSelect?.value || null;
  const eventId = document.getElementById("cal-event-id")?.value || "";

  if (!dateStr || !title || !startT) return;

  const startsAt = new Date(`${dateStr}T${startT}:00`);
  let endsAt = null;
  if (endT) {
    endsAt = new Date(`${dateStr}T${endT}:00`);
    if (endsAt <= startsAt) endsAt = null;
  }

  const row = {
    user_id: user.id,
    team_id: teamId,
    title,
    kind,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    notes
  };
  const canManageTeamEvent = !!teamId && ["coach", "assistant"].includes(teamAccessMap.get(teamId));
  let error = null;
  let syncedEventId = null;
  if (eventId) {
    let q = supabase.from("calendar_events").update(row).eq("id", eventId);
    if (!canManageTeamEvent) q = q.eq("user_id", user.id);
    ({ error } = await q);
    if (!error) syncedEventId = eventId;
  } else {
    const ins = await supabase.from("calendar_events").insert(row).select("id").single();
    error = ins.error;
    if (!error && ins.data?.id) syncedEventId = ins.data.id;
  }

  if (error) {
    showMsg(msgEl, error.message, true);
    return;
  }

  if (syncedEventId) {
    const g = await invokeGoogleCalendarSync(syncedEventId);
    if (!g.ok && g.error && !/not deployed|404|functions/i.test(String(g.error))) {
      console.warn("[Google Calendar sync]", g.error);
    } else if (g.ok && !g.skipped) {
      showToast("Synced to your Google Calendar.");
    }
  }

  addForm.reset();
  document.getElementById("cal-event-id").value = "";
  document.getElementById("cal-start-time").value = "12:00";
  document.getElementById("cal-end-time").value = "";
  document.getElementById("cal-submit-btn").textContent = "Add to Calendar";
  document.getElementById("cal-cancel-edit").classList.add("hidden");
  formDate.value = dateStr;
  await refresh();
  selectDay(dateStr);
});

(async function init() {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = "app.html";
    return;
  }
  await loadTeamOptions(user.id);
  const presetTeam = new URLSearchParams(window.location.search).get("team");
  if (presetTeam && teamSelect) {
    const match = [...teamSelect.options].some((o) => o.value === presetTeam);
    if (match) teamSelect.value = presetTeam;
  }
  await refresh();
})();
