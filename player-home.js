/**
 * Player hub on index: join team by code, list memberships.
 */
"use strict";

import supabase from "./supabase.js";
import { hasCoachHubAccess } from "./coach-shared.js";
import { fetchPlayerTeamsList, joinTeamByCode, notifyPlayerTeamsUpdated } from "./player-teams-api.js";
import { teamAvatarHtml } from "./ui.js";

const joinForm = document.getElementById("form-join-team");
const joinCodeInput = document.getElementById("team-join-code");
const joinMsg = document.getElementById("join-team-msg");
const listEl = document.getElementById("my-player-teams");
const noTeamsEl = document.getElementById("player-no-teams");

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function loadPlayerTeams() {
  if (!listEl) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  listEl.innerHTML = `<li class="app-list-skeleton-item" aria-hidden="true"><div class="app-skeleton-card app-skeleton-card--short"></div></li>`;

  const { error, items } = await fetchPlayerTeamsList(user.id);
  if (error) {
    listEl.innerHTML = "";
    if (joinMsg) joinMsg.textContent = error;
    return;
  }

  listEl.innerHTML = "";
  const teams = items || [];
  if (noTeamsEl) {
    noTeamsEl.classList.toggle("hidden", teams.length > 0);
    if (teams.length === 0) {
      const { data: { user: u2 } } = await supabase.auth.getUser();
      if (u2 && hasCoachHubAccess(u2)) {
        noTeamsEl.textContent =
          "No player rosters yet — enter your coach’s team code in Join with a code below.";
      } else {
        noTeamsEl.textContent = "You have not joined a team as a player yet.";
      }
    }
  }

  teams.forEach((row) => {
    const li = document.createElement("li");
    li.className = "manage-team-item";
    const av = teamAvatarHtml(row.teamName, row.logoUrl);
    li.innerHTML = `
      <div class="league-card league-card-row league-card-row--with-avatar">
        ${av}
        <span class="manage-team-name">${escapeHtml(row.teamName)}</span>
        <a href="team.html?id=${row.teamId}" class="nav-btn cab-hub-row-action">View team</a>
      </div>`;
    listEl.appendChild(li);
  });
}

if (joinForm && joinCodeInput) {
  document.addEventListener("clutch:signed-in", () => loadPlayerTeams());
  document.addEventListener("clutch:player-teams-updated", () => loadPlayerTeams());

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) loadPlayerTeams();
  });

  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (joinMsg) joinMsg.textContent = "";

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const result = await joinTeamByCode(user, joinCodeInput.value);
    if (!result.ok) {
      if (joinMsg) joinMsg.textContent = result.message;
      return;
    }

    joinCodeInput.value = "";
    if (joinMsg) joinMsg.textContent = result.message;
    notifyPlayerTeamsUpdated();
    await loadPlayerTeams();
  });
}
