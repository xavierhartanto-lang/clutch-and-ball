/**
 * Coach team hub on index.html (uses Clutch theme + supabase teams table).
 */
"use strict";

import supabase from "./supabase.js";
import { randomInviteCode, hasCoachHubAccess, fetchTeamsCoachedByUser } from "./coach-shared.js";
import { notifyCoachedTeamsUpdated } from "./player-teams-api.js";
import { teamAvatarHtml } from "./ui.js";

const listEl = document.getElementById("coach-team-list");
const noTeamsEl = document.getElementById("coach-no-teams");
const msgEl = document.getElementById("coach-team-msg");
const form = document.getElementById("form-create-team");

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function ensureInviteCodeForTeam(teamId) {
  for (let i = 0; i < 12; i++) {
    const code = randomInviteCode();
    const { error } = await supabase.from("teams").update({ invite_code: code }).eq("id", teamId).is("invite_code", null);
    if (!error) return code;
    if (!/unique|duplicate/i.test(String(error.message))) return null;
  }
  return null;
}

async function loadCoachTeams() {
  if (!listEl) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !hasCoachHubAccess(user)) return;

  listEl.innerHTML = `<li class="manage-team-item app-list-skeleton-item" aria-hidden="true"><div class="app-skeleton-card"></div></li><li class="manage-team-item app-list-skeleton-item" aria-hidden="true"><div class="app-skeleton-card"></div></li>`;

  const { data, error } = await fetchTeamsCoachedByUser(user.id);

  if (error) {
    listEl.innerHTML = "";
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  const rows = data || [];
  for (const t of rows) {
    if (!t.invite_code) {
      const c = await ensureInviteCodeForTeam(t.id);
      if (c) t.invite_code = c;
    }
  }

  listEl.innerHTML = "";
  if (noTeamsEl) noTeamsEl.classList.toggle("hidden", rows.length > 0);

  rows.forEach((t) => {
    const li = document.createElement("li");
    li.className = "manage-team-item";
    const code = t.invite_code ? escapeHtml(t.invite_code) : "—";
    const av = teamAvatarHtml(t.name, t.logo_url);
    li.innerHTML = `
      <div class="league-card league-card--stack">
        <div class="league-card-row league-card-row--with-avatar">
          ${av}
          <div class="league-card-text-col">
            <span class="manage-team-name">${escapeHtml(t.name)}</span>
            <p class="team-code-line">Player code: <strong class="team-code">${code}</strong></p>
          </div>
          <a href="team.html?id=${t.id}" class="nav-btn cab-hub-row-action">Open team</a>
        </div>
      </div>`;
    listEl.appendChild(li);
  });
}

function bind() {
  if (!listEl) return;

  document.addEventListener("clutch:signed-in", () => {
    loadCoachTeams();
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user && hasCoachHubAccess(session.user)) loadCoachTeams();
  });

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("new-team-name");
      if (!nameInput || !msgEl) return;
      const name = nameInput.value.trim();
      msgEl.textContent = "";

      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !hasCoachHubAccess(user)) return;

      let code = randomInviteCode();
      let assistantCode = randomInviteCode();
      let error;
      for (let i = 0; i < 12; i++) {
        const res = await supabase.from("teams").insert({
          name,
          coach_id: user.id,
          wins: 0,
          losses: 0,
          invite_code: code,
          assistant_invite_code: assistantCode
        });
        error = res.error;
        if (!error) break;
        if (/assistant_invite_code|column.*does not exist|42703/i.test(String(error.message || ""))) {
          const fallback = await supabase.from("teams").insert({
            name,
            coach_id: user.id,
            wins: 0,
            losses: 0,
            invite_code: code
          });
          error = fallback.error;
          if (!error) break;
        }
        if (/unique|duplicate/i.test(String(error.message))) code = randomInviteCode();
        else break;
        if (/unique|duplicate/i.test(String(error.message))) assistantCode = randomInviteCode();
      }

      if (error) {
        msgEl.textContent = error.message;
        return;
      }

      nameInput.value = "";
      msgEl.textContent = "Team created.";
      await loadCoachTeams();
      notifyCoachedTeamsUpdated();
    });
  }
}

bind();
