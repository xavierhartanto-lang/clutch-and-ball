"use strict";

import supabase from "./supabase.js";
import { isCoachSignup } from "./coach-shared.js";
import {
  fetchCoachedTeamsList,
  fetchPlayerTeamsList,
  joinTeamByCode,
  leaveTeam,
  notifyPlayerTeamsUpdated
} from "./player-teams-api.js";
import { teamAvatarHtml } from "./ui.js";

const joinForm = document.getElementById("form-join-team");
const joinCodeInput = document.getElementById("team-join-code");
const joinMsg = document.getElementById("join-team-msg");
const joinAssistantForm = document.getElementById("form-join-assistant");
const joinAssistantInput = document.getElementById("assistant-join-code");
const joinAssistantMsg = document.getElementById("join-assistant-msg");
const coachedListEl = document.getElementById("manage-coached-list");
const noCoachedEl = document.getElementById("manage-no-coached");
const coachedErr = document.getElementById("coached-list-msg");
const listEl = document.getElementById("manage-team-list");
const noTeamsEl = document.getElementById("manage-no-teams");
const listErr = document.getElementById("manage-list-msg");

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

async function renderCoached() {
  if (!coachedListEl) return;
  if (coachedErr) coachedErr.textContent = "";

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  coachedListEl.innerHTML = `<li class="manage-team-item app-list-skeleton-item" aria-hidden="true"><div class="app-skeleton-card"></div></li>`;

  const { error, items } = await fetchCoachedTeamsList(user.id);
  if (error) {
    coachedListEl.innerHTML = "";
    if (coachedErr) coachedErr.textContent = error;
    return;
  }

  coachedListEl.innerHTML = "";
  const rows = items || [];
  const { data: assistantRows } = await supabase
    .from("teams")
    .select("id, name, logo_url")
    .eq("assistant_coach_id", user.id)
    .order("name");
  const combined = [
    ...rows.map((r) => ({ ...r, coachRole: "Coach" })),
    ...(assistantRows || []).map((r) => ({
      teamId: r.id,
      teamName: r.name,
      logoUrl: r.logo_url || null,
      coachRole: "Assistant Coach"
    }))
  ];
  const seen = new Set();
  const uniq = combined.filter((r) => {
    if (!r.teamId || seen.has(r.teamId)) return false;
    seen.add(r.teamId);
    return true;
  });
  if (noCoachedEl) noCoachedEl.classList.toggle("hidden", uniq.length > 0);

  uniq.forEach((row) => {
    const li = document.createElement("li");
    li.className = "manage-team-item";
    const av = teamAvatarHtml(row.teamName, row.logoUrl);
    li.innerHTML = `
      <div class="league-card league-card--stack">
        <div class="league-card-row league-card-row--with-avatar">
          ${av}
          <div class="league-card-text-col">
            <span class="manage-team-name">${escapeHtml(row.teamName)} <span class="team-role-badge">${escapeHtml(row.coachRole)}</span></span>
          </div>
          <span class="manage-team-actions">
            <a href="team.html?id=${row.teamId}" class="nav-btn">Open team</a>
          </span>
        </div>
      </div>`;
    coachedListEl.appendChild(li);
  });
}

async function renderPlayerRoster() {
  if (!listEl) return;
  if (listErr) listErr.textContent = "";

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  listEl.innerHTML = `<li class="manage-team-item app-list-skeleton-item" aria-hidden="true"><div class="app-skeleton-card"></div></li>`;

  const { error, items } = await fetchPlayerTeamsList(user.id);
  if (error) {
    listEl.innerHTML = "";
    if (listErr) listErr.textContent = error;
    return;
  }

  listEl.innerHTML = "";
  const rows = items || [];
  if (noTeamsEl) noTeamsEl.classList.toggle("hidden", rows.length > 0);

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.className = "manage-team-item";
    const av = teamAvatarHtml(row.teamName, row.logoUrl);
    li.innerHTML = `
      <div class="league-card league-card--stack">
        <div class="league-card-row league-card-row--with-avatar">
          ${av}
          <div class="league-card-text-col">
            <span class="manage-team-name">${escapeHtml(row.teamName)} <span class="team-role-badge">Player</span></span>
          </div>
          <span class="manage-team-actions">
            <a href="team.html?id=${row.teamId}" class="nav-btn">View</a>
            <button type="button" class="auth-submit auth-submit-secondary btn-leave-team" data-team-id="${row.teamId}" data-team-label="${escapeAttr(row.teamName)}">Leave roster</button>
          </span>
        </div>
      </div>`;
    listEl.appendChild(li);
  });
}

async function renderAll() {
  await renderCoached();
  await renderPlayerRoster();
  applyTeamFilter();
}

const teamFilterInput = document.getElementById("cab-teams-filter");

function applyTeamFilter() {
  const q = String(teamFilterInput?.value || "")
    .trim()
    .toLowerCase();
  document.querySelectorAll(".manage-team-list .manage-team-item").forEach((li) => {
    if (li.classList.contains("app-list-skeleton-item")) return;
    if (!q) {
      li.classList.remove("cab-filter-hidden");
      return;
    }
    const nameEl = li.querySelector(".manage-team-name");
    const t = (nameEl?.textContent || li.textContent || "").toLowerCase();
    li.classList.toggle("cab-filter-hidden", !t.includes(q));
  });
}

teamFilterInput?.addEventListener("input", applyTeamFilter);

listEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-leave-team");
  if (!btn?.dataset.teamId) return;
  const teamId = btn.dataset.teamId;
  const teamName = btn.dataset.teamLabel || "this team";
  if (!confirm(`Leave the roster for ${teamName}? You can rejoin with the team code.`)) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const res = await leaveTeam(user.id, teamId);
  if (!res.ok) {
    if (listErr) listErr.textContent = res.message;
    return;
  }
  if (listErr) listErr.textContent = "";
  notifyPlayerTeamsUpdated();
  await renderPlayerRoster();
});

joinForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (joinMsg) joinMsg.textContent = "";

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const raw = joinCodeInput?.value || "";
  const result = await joinTeamByCode(user, raw);
  if (!result.ok) {
    if (joinMsg) joinMsg.textContent = result.message;
    return;
  }

  if (joinMsg) joinMsg.textContent = result.message;
  if (joinCodeInput) joinCodeInput.value = "";
  notifyPlayerTeamsUpdated();
  await renderPlayerRoster();
});

joinAssistantForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (joinAssistantMsg) joinAssistantMsg.textContent = "";
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const code = String(joinAssistantInput?.value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (code.length < 4) {
    if (joinAssistantMsg) joinAssistantMsg.textContent = "Enter a valid assistant code.";
    return;
  }

  const { data: team, error: findErr } = await supabase
    .from("teams")
    .select("id, name, coach_id, owner_id, assistant_coach_id")
    .eq("assistant_invite_code", code)
    .maybeSingle();

  if (findErr) {
    if (joinAssistantMsg) joinAssistantMsg.textContent = findErr.message;
    return;
  }
  if (!team) {
    const { data: maybePlayerCode } = await supabase
      .from("teams")
      .select("id")
      .eq("invite_code", code)
      .maybeSingle();
    if (maybePlayerCode) {
      if (joinAssistantMsg) joinAssistantMsg.textContent = "That is the player join code. Use the assistant coach code from Team Settings (gear icon).";
      return;
    }
    if (joinAssistantMsg) joinAssistantMsg.textContent = "No team found for that assistant code. Ask coach to open Team Settings once and copy the assistant code there.";
    return;
  }
  if (team.assistant_coach_id && team.assistant_coach_id !== user.id) {
    if (joinAssistantMsg) joinAssistantMsg.textContent = "This team already has an assistant coach.";
    return;
  }
  if (team.coach_id === user.id || team.owner_id === user.id) {
    if (joinAssistantMsg) joinAssistantMsg.textContent = "You are already the coach for this team.";
    return;
  }

  const { error: updErr } = await supabase
    .from("teams")
    .update({ assistant_coach_id: user.id })
    .eq("id", team.id)
    .or(`assistant_coach_id.is.null,assistant_coach_id.eq.${user.id}`);

  if (updErr) {
    if (joinAssistantMsg) joinAssistantMsg.textContent = updErr.message;
    return;
  }
  if (joinAssistantMsg) joinAssistantMsg.textContent = `You are now assistant coach for ${team.name}.`;
  if (joinAssistantInput) joinAssistantInput.value = "";
  await renderCoached();
});

(async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const joinSection = document.getElementById("section-join-as-player");
  const assistantSection = document.getElementById("section-join-as-assistant");
  if (user && isCoachSignup(user) && joinSection) {
    joinSection.classList.add("hidden");
  }
  if (user && isCoachSignup(user) && assistantSection) {
    assistantSection.classList.add("hidden");
  }
  await renderAll();
})();
