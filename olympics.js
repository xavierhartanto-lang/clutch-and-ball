"use strict";

import supabase from "./supabase.js";

const TEAMS = {
  asia: {
    id: "asia",
    label: "Asia",
    region: "Pacific Rim squad",
    players: [
      { id: "hartanto", last: "Hartanto", first: "Xavier", tag: '“The Arc” — Clutch & Ball' },
      { id: "askari", last: "Askari", first: "Mason", tag: '“The Problem” — hustle machine' },
      { id: "griffin", last: "Griffin", first: "Jack", tag: '“The King” — lightning driver' },
      { id: "enersen-k", last: "Enersen", first: "Kyle", tag: '“The Passer” — left wing' },
      { id: "enersen-o", last: "Enersen", first: "Owen", tag: '“The Rookie” — rising' }
    ]
  },
  america: {
    id: "america",
    label: "America",
    region: "North America stack",
    players: [
      { id: "beser", last: "Beser", first: "Jack", tag: '“The Crazy” — STE / wild shot-making' },
      { id: "dunn", last: "Dunn", first: "Graham", tag: '“The Truth” — Green Giants' },
      { id: "louridas", last: "Louridas", first: "Gregory", tag: '“The Marvelous” — HBD big' },
      { id: "silk", last: "Silk", first: "Zach", tag: '“The Giant” — LOC boards' },
      { id: "abraham", last: "Abraham", first: "Chris", tag: '“The Schedule” — TGG clutch' }
    ]
  },
  india: {
    id: "india",
    label: "India",
    region: "Subcontinent crew",
    players: [
      { id: "moorthy", last: "Moorthy", first: "Vivek", tag: '“The Grandpa” — Showtime Elite IQ' },
      { id: "kazi", last: "Kazi", first: "Zairaan", tag: '“The Warning” — consistent shot' },
      { id: "singh", last: "Singh", first: "Vikram", tag: '“The Nonchalant” — midrange' },
      { id: "mujumdar", last: "Mujumdar", first: "Amar", tag: '“The Censored” — paint presence' },
      { id: "sud", last: "Sud", first: "Vedaant", tag: '“The Beast” — bounce' }
    ]
  }
};

const EVENTS = [
  {
    id: "three",
    title: "3-Point Contest",
    slots: 2,
    blurb: "Heaters only. Shooter vs. shooter from deep."
  },
  {
    id: "impact",
    title: "Impact Challenge",
    slots: 4,
    blurb: "Team energy drill — who shifts momentum when it matters."
  },
  {
    id: "race",
    title: "Race",
    slots: 2,
    blurb: "Straight-line speed — track meet meets hardwood."
  },
  {
    id: "freethrow",
    title: "Free Throws (10 shots)",
    slots: 1,
    blurb: "One rep, ten shots — ice in the veins."
  },
  {
    id: "layup",
    title: "Layup Contest",
    slots: 2,
    blurb: "Creativity and finish at the rim."
  },
  {
    id: "trivia",
    title: "NBA Trivia",
    slots: 5,
    blurb: "Full squad — whole team locks in on league knowledge."
  }
];

const TEAM_IDS = ["asia", "america", "india"];
const EMPTY_ASSIGNMENTS = {};
let assignmentsCache = {};
let currentUserId = null;
let realtimeChannel = null;

function closeAllPickers(exceptEl = null) {
  document.querySelectorAll(".oly-picker[open]").forEach((el) => {
    if (exceptEl && el === exceptEl) return;
    el.open = false;
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function showOlympicsMsg(text, isError = false) {
  const msgEl = document.getElementById("oly-msg");
  if (!msgEl) return;
  msgEl.textContent = text || "";
  msgEl.classList.remove("auth-message--error");
  if (isError) msgEl.classList.add("auth-message--error");
}

function ensureAssignmentsShape(base) {
  const shaped = typeof base === "object" && base ? { ...base } : {};
  EVENTS.forEach((ev) => {
    const row = shaped[ev.id] && typeof shaped[ev.id] === "object" ? { ...shaped[ev.id] } : {};
    TEAM_IDS.forEach((tid) => {
      const arr = Array.isArray(row[tid]) ? row[tid].slice(0, ev.slots) : [];
      while (arr.length < ev.slots) arr.push("");
      row[tid] = arr;
    });
    shaped[ev.id] = row;
  });
  return shaped;
}

async function loadAssignmentsFromDb() {
  const { data, error } = await supabase
    .from("olympics_event_signups")
    .select("event_key, team_key, slot_index, player_id");

  if (error) {
    showOlympicsMsg(error.message, true);
    assignmentsCache = ensureAssignmentsShape(EMPTY_ASSIGNMENTS);
    return;
  }

  const out = {};
  (data || []).forEach((row) => {
    if (!row?.event_key || !TEAM_IDS.includes(row.team_key)) return;
    const ev = EVENTS.find((e) => e.id === row.event_key);
    if (!ev) return;
    if (Number(row.slot_index) < 0 || Number(row.slot_index) >= ev.slots) return;
    if (!out[row.event_key]) out[row.event_key] = {};
    if (!Array.isArray(out[row.event_key][row.team_key])) out[row.event_key][row.team_key] = [];
    out[row.event_key][row.team_key][row.slot_index] = row.player_id || "";
  });

  assignmentsCache = ensureAssignmentsShape(out);
}

function buildPickerOptions(teamId, eventId, currentSlotIndex) {
  const team = TEAMS[teamId];
  const assignments = assignmentsCache[eventId] || { asia: [], america: [], india: [] };
  const curPid = (assignments[teamId] || [])[currentSlotIndex] || "";
  const taken = new Set();
  Object.keys(assignments).forEach((tid) => {
    (assignments[tid] || []).forEach((pid, idx) => {
      if (pid && !(tid === teamId && idx === currentSlotIndex)) taken.add(pid);
    });
  });

  const items = [
    `<button type="button" class="oly-picker-option ${!curPid ? "is-active" : ""}" data-pick="" data-event="${eventId}" data-team="${teamId}" data-slot="${currentSlotIndex}">Unassigned</button>`
  ];
  team.players.forEach((p) => {
    const isDisabled = taken.has(p.id);
    const isActive = p.id === curPid;
    items.push(
      `<button type="button" class="oly-picker-option ${isActive ? "is-active" : ""}" data-pick="${p.id}" data-event="${eventId}" data-team="${teamId}" data-slot="${currentSlotIndex}" ${isDisabled ? "disabled" : ""}>${p.last}, ${p.first}</button>`
    );
  });
  return items.join("");
}

function renderTeamCards() {
  const root = document.getElementById("olympics-teams-root");
  if (!root) return;
  const cls = { asia: "olympics-team-card--asia", america: "olympics-team-card--america", india: "olympics-team-card--india" };
  root.innerHTML = ["asia", "america", "india"]
    .map((tid) => {
      const t = TEAMS[tid];
      const players = t.players
        .map(
          (p) => `
        <div class="olympics-player">
          <div>
            <span class="oly-first">${escapeHtml(p.first)}</span>
            <span class="oly-name">${escapeHtml(p.last)}</span>
          </div>
          <span class="oly-tag">${escapeHtml(p.tag)}</span>
        </div>`
        )
        .join("");
      return `
      <article class="olympics-team-card ${cls[tid]}">
        <h3>${escapeHtml(t.label)}</h3>
        <p class="oly-region">${escapeHtml(t.region)}</p>
        ${players}
      </article>`;
    })
    .join("");
}

function renderEvents() {
  const root = document.getElementById("olympics-events-root");
  if (!root) return;

  const assignments = assignmentsCache;

  root.innerHTML = EVENTS.map((ev) => {
    const cols = ["asia", "america", "india"]
      .map((tid) => {
        const team = TEAMS[tid];
        const row = assignments[ev.id] || {};
        const selects = [];
        for (let i = 0; i < ev.slots; i++) {
          const pick = (row[tid] || [])[i] || "";
          const pickedPlayer = pick ? team.players.find((p) => p.id === pick) : null;
          selects.push(`
            <label class="oly-slot-row" data-team="${tid}">
              <span class="oly-slot-pill">Slot ${i + 1}</span>
              <details class="oly-picker" data-event="${ev.id}" data-team="${tid}" data-slot="${i}">
                <summary class="oly-picker-trigger">${pickedPlayer ? `${pickedPlayer.last}, ${pickedPlayer.first}` : "Choose player"}</summary>
                <div class="oly-picker-menu" role="listbox" aria-label="${team.label} slot ${i + 1} for ${ev.title}">
                  ${buildPickerOptions(tid, ev.id, i)}
                </div>
              </details>
              <span class="oly-slot-preview">${pickedPlayer ? `${pickedPlayer.last}, ${pickedPlayer.first}` : "Unassigned"}</span>
            </label>
          `);
        }
        return `
          <div class="olympics-slot-col">
            <h4>${team.label}</h4>
            ${selects.join("")}
          </div>`;
      })
      .join("");

    return `
      <article class="olympics-event" data-event-id="${ev.id}">
        <h3>${ev.title}</h3>
        <p class="oly-ev-meta">${ev.blurb} · ${ev.slots} roster spot${ev.slots === 1 ? "" : "s"} per team.</p>
        <div class="olympics-slots">${cols}</div>
      </article>`;
  }).join("");

  root.querySelectorAll(".oly-picker-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const eventId = btn.dataset.event;
      const teamId = btn.dataset.team;
      const slot = parseInt(btn.dataset.slot || "0", 10);
      const nextPlayerId = btn.dataset.pick || null;
      const { error } = await supabase
        .from("olympics_event_signups")
        .upsert(
          {
            event_key: eventId,
            team_key: teamId,
            slot_index: slot,
            player_id: nextPlayerId,
            updated_by: currentUserId,
            updated_at: new Date().toISOString()
          },
          { onConflict: "event_key,team_key,slot_index" }
        );
      if (error) {
        showOlympicsMsg(error.message, true);
        await loadAssignmentsFromDb();
      } else {
        showOlympicsMsg("Signup updated.");
        if (!assignmentsCache[eventId]) assignmentsCache[eventId] = {};
        if (!assignmentsCache[eventId][teamId]) assignmentsCache[eventId][teamId] = [];
        assignmentsCache[eventId][teamId][slot] = nextPlayerId || "";
      }
      renderEvents();

      const detailsEl = btn.closest(".oly-picker");
      if (detailsEl) detailsEl.open = false;
    });
  });
}

document.getElementById("oly-clear-signups")?.addEventListener("click", () => {
  if (!window.confirm("Clear all shared signups for everyone?")) return;
  (async () => {
    const { error } = await supabase.from("olympics_event_signups").delete().gt("slot_index", -1);
    if (error) {
      showOlympicsMsg(error.message, true);
      return;
    }
    showOlympicsMsg("All signups cleared.");
    assignmentsCache = ensureAssignmentsShape(EMPTY_ASSIGNMENTS);
    renderEvents();
  })();
});

async function init() {
  const { data } = await supabase.auth.getUser();
  currentUserId = data?.user?.id || null;

  assignmentsCache = ensureAssignmentsShape(EMPTY_ASSIGNMENTS);
  await loadAssignmentsFromDb();
  renderTeamCards();
  renderEvents();

  realtimeChannel = supabase
    .channel("olympics-signups-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "olympics_event_signups" },
      async () => {
        await loadAssignmentsFromDb();
        renderEvents();
      }
    )
    .subscribe();

  document.addEventListener("click", (e) => {
    const within = e.target.closest(".oly-picker");
    if (!within) {
      closeAllPickers();
      return;
    }
    // Keep only one picker open at a time.
    closeAllPickers(within);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllPickers();
  });
}

void init();
