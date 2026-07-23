/**
 * League page — teams, standings, schedule, chat (Supabase)
 * Permissions: UI only — owner via leagues.owner_id === auth user id
 */
"use strict";

import supabase from "./supabase.js";
import { fetchLeagueById, deleteLeagueById, updateLeagueHeroTagline, leaveLeagueMembership } from "./leagues.js";
import { fetchTeamsForLeague, insertTeam, deleteTeam, updateTeamLogoUrl } from "./teams.js";
import {
  fetchPlayersForTeamIds,
  insertPlayer,
  deletePlayer,
  movePlayerToTeam,
  updatePlayerStats
} from "./players.js";
import { fetchGamesForLeague, insertGame, deleteGameById, updateGameScoreAndStandings } from "./games.js";
import {
  fetchLeagueMessages,
  insertLeagueMessage,
  deleteLeagueMessage,
  subscribeLeagueMessages,
  unsubscribeChannel
} from "./chat.js";

const leagueId = () => new URLSearchParams(window.location.search).get("id");

let state = {
  user: null,
  league: null,
  role: null,
  teams: [],
  players: [],
  games: [],
  messagesSubscription: null,
  chatControlsBound: false,
  pageEffectsBound: false
};

/** League owner: match DB owner_id to signed-in user (frontend visibility only) */
const isOwner = () =>
  Boolean(state.user && state.league && state.user.id === state.league.owner_id);

const canEdit = () => isOwner();
const canChat = () => isOwner() || state.role === "member";

function senderDisplayFromRow(m, isOwn) {
  if (isOwn && state.user) {
    return (
      state.user.user_metadata?.username ||
      state.user.email ||
      state.user.user_metadata?.full_name ||
      state.user.user_metadata?.name ||
      "You"
    );
  }
  if (m.sender_label && String(m.sender_label).trim()) return String(m.sender_label).trim();
  if (m.user_id) return `Member · ${String(m.user_id).slice(0, 8)}…`;
  return "Member";
}

function getSenderLabelForInsert() {
  const u = state.user;
  if (!u) return null;
  return (
    u.email ||
    u.user_metadata?.username ||
    u.user_metadata?.full_name ||
    u.user_metadata?.name ||
    u.phone ||
    "Player"
  );
}

// ——— Styled confirm modal (replaces native confirm) ———
function confirmModal(opts) {
  const {
    title = "Confirm",
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    danger = false
  } = opts;
  const modal = document.getElementById("league-confirm-modal");
  const titleEl = document.getElementById("league-confirm-title");
  const messageEl = document.getElementById("league-confirm-message");
  const cancelBtn = document.getElementById("league-confirm-cancel");
  const okBtn = document.getElementById("league-confirm-ok");
  if (!modal || !titleEl || !messageEl || !cancelBtn || !okBtn) {
    return Promise.resolve(confirm(message || title));
  }
  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  okBtn.classList.toggle("danger", !!danger);
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const finish = (result) => {
      modal.classList.add("hidden");
      document.removeEventListener("keydown", handleKey);
      resolve(result);
    };
    const handleKey = (e) => {
      if (e.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", handleKey);
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    const backdrop = modal.querySelector(".league-modal-backdrop");
    if (backdrop) backdrop.onclick = () => finish(false);
  });
}

function promptModal(opts) {
  const { title = "Enter value", placeholder = "", defaultValue = "" } = opts;
  const modal = document.getElementById("league-prompt-modal");
  const titleEl = document.getElementById("league-prompt-title");
  const input = document.getElementById("league-prompt-input");
  const cancelBtn = document.getElementById("league-prompt-cancel");
  const okBtn = document.getElementById("league-prompt-ok");
  if (!modal || !titleEl || !input || !cancelBtn || !okBtn) {
    return Promise.resolve(prompt(title, defaultValue));
  }
  titleEl.textContent = title;
  input.placeholder = placeholder;
  input.value = defaultValue;
  modal.classList.remove("hidden");
  input.focus();
  return new Promise((resolve) => {
    const finish = (result) => {
      modal.classList.add("hidden");
      document.removeEventListener("keydown", handleKey);
      resolve(result);
    };
    const handleKey = (e) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") finish(input.value.trim());
    };
    document.addEventListener("keydown", handleKey);
    okBtn.onclick = () => finish(input.value.trim());
    cancelBtn.onclick = () => finish(null);
    const backdrop = modal.querySelector(".league-modal-backdrop");
    if (backdrop) backdrop.onclick = () => finish(null);
  });
}

// ——— Toast ———
function toast(text, type = "success") {
  const id = "league-toast";
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.id = id;
  el.className = `toast toast-${type}`;
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 2500);
}

// ——— Auth & role (member row for chat) ———
async function ensureUser() {
  const { data: { user } } = await supabase.auth.getUser();
  state.user = user;
  return user;
}

async function resolveRole(lid) {
  if (!state.user || !state.league) return null;
  if (isOwner()) return "owner";
  const { data: row } = await supabase
    .from("league_members")
    .select("role")
    .eq("league_id", lid)
    .eq("user_id", state.user.id)
    .maybeSingle();
  return row?.role || null;
}

// ——— Load league ———
async function loadLeague() {
  const id = leagueId();
  if (!id) return null;
  const { data, error } = await fetchLeagueById(id);
  if (error || !data) return null;
  state.league = data;
  state.role = await resolveRole(id);
  return data;
}

// ——— Load teams ———
async function loadTeams() {
  const id = leagueId();
  if (!id) return [];
  const data = await fetchTeamsForLeague(id);
  state.teams = data;
  return state.teams;
}

// ——— Load players ———
async function loadPlayers() {
  const id = leagueId();
  if (!id || !state.teams.length) return [];
  const teamIds = state.teams.map(t => t.id);
  const data = await fetchPlayersForTeamIds(teamIds);
  state.players = data;
  return state.players;
}

function buildStandings() {
  const sorted = [...state.teams].sort((a, b) => {
    const wA = Number(a.wins) || 0, lA = Number(a.losses) || 0;
    const wB = Number(b.wins) || 0, lB = Number(b.losses) || 0;
    if (wB !== wA) return wB - wA;
    const pctA = wA + lA > 0 ? wA / (wA + lA) : 0;
    const pctB = wB + lB > 0 ? wB / (wB + lB) : 0;
    return pctB - pctA;
  });
  return sorted;
}

async function loadGames() {
  const id = leagueId();
  if (!id) return [];
  const data = await fetchGamesForLeague(id);
  state.games = data;
  return state.games;
}

async function loadMessages() {
  const id = leagueId();
  if (!id) return [];
  return fetchLeagueMessages(id);
}

function subscribeMessages() {
  const id = leagueId();
  if (!id) return;
  if (state.messagesSubscription) unsubscribeChannel(state.messagesSubscription);
  state.messagesSubscription = subscribeLeagueMessages(id, () => {
    renderChat();
  });
}

async function uploadChatImage(file) {
  if (!file || !state.user || !state.league) return { url: null };
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${state.league.id}/${state.user.id}/${Date.now()}.${safeExt}`;
  const { error } = await supabase.storage.from("league-chat-images").upload(path, file, {
    upsert: false,
    contentType: file.type || "image/jpeg"
  });
  if (error) return { error };
  const { data } = supabase.storage.from("league-chat-images").getPublicUrl(path);
  return { url: data?.publicUrl || null };
}

async function sendMessage(text, imageUrl = null) {
  const id = leagueId();
  if (!id || !state.user || !canChat()) return;
  const trimmed = String(text).trim();
  if (!trimmed && !imageUrl) {
    toast("Type a message or attach an image first", "error");
    return;
  }
  const payload = {
    league_id: id,
    user_id: state.user.id,
    message: trimmed,
    sender_label: getSenderLabelForInsert(),
    image_url: imageUrl
  };
  const { error } = await insertLeagueMessage(payload);
  if (error) {
    toast(error.message, "error");
    return;
  }
  const input = document.getElementById("league-chat-input");
  if (input) input.value = "";
  await renderChat();
}

async function deleteMessage(msgId) {
  if (!canEdit()) return;
  const { error } = await deleteLeagueMessage(msgId);
  if (error) toast(error.message, "error");
  else await renderChat();
}

async function addTeam(name) {
  const id = leagueId();
  if (!id || !state.league || !canEdit() || !state.user) return;
  const { error } = await insertTeam({
    name,
    leagueId: id,
    ownerId: state.user.id
  });
  if (error) {
    toast(error.message, "error");
    return;
  }
  toast("Team added");
  await loadTeams();
  await loadPlayers();
  renderTeams();
  renderStandings();
  setupTeamTilt();
}

async function removeTeam(teamId) {
  if (!canEdit()) return;
  if (!(await confirmModal({ title: "Delete team", message: "Delete this team? This cannot be undone.", confirmText: "Delete", danger: true }))) return;
  const { error } = await deleteTeam(teamId);
  if (error) toast(error.message, "error");
  else {
    toast("Team removed");
    await loadTeams();
    await loadPlayers();
    renderTeams();
    renderStandings();
    renderSchedule();
    setupTeamTilt();
  }
}

async function addPlayer(teamId, name) {
  if (!canEdit()) return;
  const { error } = await insertPlayer({
    teamId,
    name,
    ownerId: state.user?.id || state.league?.owner_id
  });
  if (error) {
    toast(error.message, "error");
    return;
  }
  toast("Player added");
  await loadPlayers();
  renderTeams();
  setupTeamTilt();
}

async function removePlayer(playerId) {
  if (!canEdit()) return;
  const { error } = await deletePlayer(playerId);
  if (error) toast(error.message, "error");
  else {
    toast("Player removed");
    await loadPlayers();
    renderTeams();
    setupTeamTilt();
  }
}

async function movePlayer(playerId, newTeamId) {
  if (!canEdit()) return;
  const { error } = await movePlayerToTeam(playerId, newTeamId);
  if (error) toast(error.message, "error");
  else {
    toast("Player moved");
    await loadPlayers();
    renderTeams();
    setupTeamTilt();
  }
}

async function createGame(team1Id, team2Id, gameDetails) {
  const id = leagueId();
  if (!id || !canEdit()) return;
  const payload = {
    league_id: id,
    team1_id: team1Id,
    team2_id: team2Id,
    game_date: gameDetails?.date || null,
    completed: false,
    game_time: gameDetails?.time || null,
    game_location: gameDetails?.location || null,
    game_court: gameDetails?.court || null,
    team_format: gameDetails?.teamFormat || null
  };
  let { error } = await supabase
    .from("games")
    .insert(payload);
  if (error && /game_time|game_location|game_court|team_format|schema cache|PGRST204|42703/i.test(error.message || "")) {
    ({ error } = await supabase
      .from("games")
      .insert({
        league_id: id,
        team1_id: team1Id,
        team2_id: team2Id,
        game_date: gameDetails?.date || null,
        completed: false
      }));
  }
  if (error) {
    toast(error.message, "error");
    return;
  }
  toast("Game added");
  await loadGames();
  renderSchedule();
}

async function updateGameScore(gameId, score1, score2) {
  if (!canEdit()) return;
  const g = state.games.find(x => x.id === gameId);
  const { error } = await updateGameScoreAndStandings(gameId, score1, score2, g);
  if (error) toast(error.message, "error");
  else {
    await loadTeams();
    await loadGames();
    renderSchedule();
    renderStandings();
  }
}

async function deleteGame(gameId) {
  if (!canEdit()) return;
  if (!(await confirmModal({ title: "Delete game", message: "Delete this game?", confirmText: "Delete", danger: true }))) return;
  const { error } = await deleteGameById(gameId);
  if (error) toast(error.message, "error");
  else {
    toast("Game deleted");
    await loadGames();
    renderSchedule();
  }
}

async function deleteLeague() {
  if (!isOwner()) return;
  if (!(await confirmModal({ title: "Delete league", message: "Delete this league? All data will be removed.", confirmText: "Delete league", danger: true }))) return;
  const id = leagueId();
  const { error } = await deleteLeagueById(id);
  if (error) toast(error.message, "error");
  else {
    toast("League deleted");
    window.location.href = "app.html";
  }
}

function copyInviteCode() {
  const code = state.league?.invite_code;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => toast("Invite code copied")).catch(() => toast("Could not copy", "error"));
}

async function leaveLeague() {
  if (isOwner()) return;
  const id = leagueId();
  if (!id || !state.user) return;
  if (!(await confirmModal({ title: "Leave league", message: "Leave this league? You can rejoin with the invite code.", confirmText: "Leave" }))) return;
  const { error } = await leaveLeagueMembership(id, state.user.id);
  if (error) toast(error.message, "error");
  else {
    toast("You left the league");
    window.location.href = "app.html";
  }
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderDescription() {
  const el = document.getElementById("league-description");
  if (!el || !state.league) return;
  const text = (state.league.description && String(state.league.description).trim()) || "";
  el.innerHTML = text
    ? `<p class="league-description-text">${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    : `<p class="league-meta">No description yet.</p>`;
}

function renderHeader() {
  const title = document.getElementById("league-title");
  const inviteEl = document.getElementById("league-invite-code");
  const copyBtn = document.getElementById("league-copy-invite");
  const back = document.getElementById("league-back");
  const leaveBtn = document.getElementById("league-leave");
  const delBtn = document.getElementById("league-delete");
  const editTaglineBtn = document.getElementById("league-edit-tagline");
  const roleLine = document.getElementById("league-role-line");
  if (!state.league) return;
  if (title) title.textContent = state.league.name;
  const subtitleEl = document.getElementById("league-subtitle");
  if (subtitleEl) {
    const sport = (state.league.sport && String(state.league.sport).trim()) || "";
    const tagline = (state.league.hero_tagline && String(state.league.hero_tagline).trim()) || "";
    const text = tagline || (sport ? `${sport.charAt(0).toUpperCase() + sport.slice(1)} League` : "");
    subtitleEl.textContent = text;
    subtitleEl.classList.toggle("hidden", !text);
  }
  document.body.classList.remove("theme-default", "theme-ocean", "theme-violet", "sport-basketball", "sport-soccer");
  document.body.classList.add(`theme-${state.league.theme || "default"}`);
  document.body.classList.add(`sport-${state.league.sport || "basketball"}`);
  if (inviteEl) inviteEl.textContent = state.league.invite_code || "—";
  if (copyBtn) {
    copyBtn.classList.toggle("hidden", !state.league.invite_code);
    copyBtn.onclick = copyInviteCode;
  }
  if (back) back.href = "app.html";
  if (leaveBtn) {
    leaveBtn.classList.toggle("hidden", isOwner() || !state.role);
    leaveBtn.onclick = leaveLeague;
  }
  if (delBtn) {
    delBtn.classList.toggle("hidden", !isOwner());
    delBtn.onclick = deleteLeague;
  }
  if (editTaglineBtn) {
    editTaglineBtn.classList.toggle("hidden", !isOwner());
    editTaglineBtn.onclick = async () => {
      const next = await promptModal({
        title: "Set subtitle",
        placeholder: "e.g. Sunday Morning League",
        defaultValue: state.league.hero_tagline || ""
      });
      if (next == null) return;
      const value = next.trim();
      const { error } = await updateLeagueHeroTagline(state.league.id, value || null);
      if (error) {
        toast(error.message, "error");
        return;
      }
      state.league.hero_tagline = value || null;
      renderHeader();
      toast("Subtitle updated");
    };
  }
  if (roleLine) {
    if (!state.user) {
      roleLine.classList.add("hidden");
      roleLine.textContent = "";
    } else if (isOwner()) {
      roleLine.classList.remove("hidden");
      roleLine.innerHTML = `<span class="league-role-badge league-role-owner">Owner</span> — You can manage teams, games, and delete this league.`;
    } else if (state.role === "member") {
      roleLine.classList.remove("hidden");
      roleLine.innerHTML = `<span class="league-role-badge league-role-member">Member</span> — You can use league chat.`;
    } else {
      roleLine.classList.remove("hidden");
      roleLine.innerHTML = `<span class="league-role-badge league-role-guest">Guest</span> — Sign in and join with the invite code on Create League to chat.`;
    }
  }
  renderDescription();
}

function pickTeamLogoUpload(teamId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.className = "hidden";
  input.setAttribute("aria-hidden", "true");
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file || !state.league) return;
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${state.league.id}/${teamId}/${Date.now()}-${safe}`;
    const { error } = await supabase.storage.from("team-logos").upload(path, file, {
      upsert: true,
      contentType: file.type || "image/jpeg"
    });
    if (error) {
      toast(error.message || "Logo upload failed", "error");
      return;
    }
    const { data } = supabase.storage.from("team-logos").getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) return;
    const { error: uerr } = await updateTeamLogoUrl(teamId, url);
    if (uerr) toast(uerr.message, "error");
    else {
      toast("Team logo updated");
      await loadTeams();
      renderTeams();
      setupTeamTilt();
    }
  });
  document.body.appendChild(input);
  input.click();
}

async function openPlayerStatsModal(playerId, playerName) {
  if (!canEdit()) return;
  const p = state.players.find((x) => x.id === playerId);
  const pts = await promptModal({
    title: `Stats — ${playerName}`,
    placeholder: "Points",
    defaultValue: String(p?.points ?? 0)
  });
  if (pts == null) return;
  const ast = await promptModal({
    title: "Assists",
    placeholder: "Assists",
    defaultValue: String(p?.assists ?? 0)
  });
  if (ast == null) return;
  const reb = await promptModal({
    title: "Rebounds",
    placeholder: "Rebounds",
    defaultValue: String(p?.rebounds ?? 0)
  });
  if (reb == null) return;
  const { error } = await updatePlayerStats(playerId, {
    points: pts,
    assists: ast,
    rebounds: reb
  });
  if (error) toast(error.message, "error");
  else {
    toast("Player stats saved");
    await loadPlayers();
    renderTeams();
    setupTeamTilt();
  }
}

function renderTeams() {
  const container = document.getElementById("league-teams");
  if (!container) return;
  const owner = canEdit();
  if (!state.teams.length) {
    container.innerHTML = `<p class="league-meta league-teams-empty">${owner ? 'No teams yet. Use "+ Add team" above.' : "No teams yet."}</p>`;
    return;
  }
  const teamIds = state.teams.map(t => t.id);
  const playersByTeam = {};
  teamIds.forEach(tid => { playersByTeam[tid] = state.players.filter(p => p.team_id === tid); });
  container.innerHTML = state.teams.map((team, idx) => {
    const roster = playersByTeam[team.id] || [];
    const wins = Number(team.wins) || 0, losses = Number(team.losses) || 0;
    const pct = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : 0;
    const logoUrl = team.logo_url && String(team.logo_url).trim();
    const logoBlock = logoUrl
      ? `<div class="league-team-logo-wrap"><img class="league-team-logo" src="${escapeHtml(logoUrl)}" alt=""></div>`
      : "";
    const rosterHtml = roster.map(p => {
      const moveHtml = owner && state.teams.length > 1
        ? ` <span class="orange-action league-move-player" data-player-id="${p.id}" data-team-id="${team.id}">move</span>`
        : "";
      const removeHtml = owner ? ` <span class="orange-action league-message-delete" data-player-id="${p.id}">×</span>` : "";
      const hasStats = p.points != null || p.assists != null || p.rebounds != null;
      const statsHtml = hasStats
        ? `<div class="league-player-stats-line">PTS ${Number(p.points) || 0} · AST ${Number(p.assists) || 0} · REB ${Number(p.rebounds) || 0}</div>`
        : "";
      const statsBtn = owner
        ? ` <span class="orange-action league-player-stats-btn" data-player-id="${p.id}" data-player-name="${escapeHtml(p.name)}">stats</span>`
        : "";
      return `<div class="player" tabindex="0"><span class="league-player-name">${escapeHtml(p.name)}</span>${statsBtn}${moveHtml}${removeHtml}${statsHtml}</div>`;
    }).join("");
    const recordLine = `<div class="player league-team-record-line" tabindex="0"><span class="bio">${wins}W – ${losses}L · ${pct}%</span></div>`;
    const actions = owner
      ? `<div class="league-team-actions">
           <span class="orange-action" data-action="team-logo" data-team-id="${team.id}">Team logo</span>
           <span class="orange-action" data-action="add-player" data-team-id="${team.id}" data-team-name="${escapeHtml(team.name)}">+ Add player</span>
           <span class="orange-action danger" data-action="remove-team" data-team-id="${team.id}">Remove team</span>
         </div>`
      : "";
    return `
      <div class="team-card league-team-card-dynamic" data-team-id="${team.id}" style="animation-delay:${idx * 0.1}s">
        ${logoBlock}
        <h3>${escapeHtml(team.name)}</h3>
        ${recordLine}
        ${rosterHtml || `<div class="player"><span class="bio">No players yet</span></div>`}
        ${actions}
      </div>`;
  }).join("");
  container.querySelectorAll("[data-action='team-logo']").forEach(el => {
    el.addEventListener("click", () => pickTeamLogoUpload(el.dataset.teamId));
  });
  container.querySelectorAll("[data-action='add-player']").forEach(el => {
    el.addEventListener("click", () => openAddPlayerModal(el.dataset.teamId, el.dataset.teamName));
  });
  container.querySelectorAll("[data-action='remove-team']").forEach(el => {
    el.addEventListener("click", () => removeTeam(el.dataset.teamId));
  });
  container.querySelectorAll(".league-message-delete[data-player-id]").forEach(el => {
    el.addEventListener("click", () => removePlayer(el.dataset.playerId));
  });
  container.querySelectorAll(".league-move-player").forEach(el => {
    el.addEventListener("click", () => openMovePlayerModal(el.dataset.playerId, el.dataset.teamId));
  });
  container.querySelectorAll(".league-player-stats-btn").forEach(el => {
    el.addEventListener("click", () => openPlayerStatsModal(el.dataset.playerId, el.dataset.playerName));
  });
}

function renderStandings() {
  const wrap = document.getElementById("league-standings-table");
  if (!wrap) return;
  const sorted = buildStandings();
  if (!sorted.length) {
    wrap.innerHTML = "<p class='league-meta'>No standings yet.</p>";
    return;
  }
  wrap.innerHTML = `
    <table class="standings">
      <thead><tr><th>#</th><th>Team</th><th>Wins</th><th>Losses</th><th>PCT</th></tr></thead>
      <tbody>
        ${sorted.map((t, i) => {
          const w = Number(t.wins) || 0, l = Number(t.losses) || 0;
          const pct = w + l > 0 ? (w / (w + l)).toFixed(3) : "—";
          return `<tr><td>${i + 1}</td><td>${escapeHtml(t.name)}</td><td>${w}</td><td>${l}</td><td>${pct}</td></tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function renderSchedule() {
  const upcomingList = document.getElementById("league-schedule-upcoming");
  const completedList = document.getElementById("league-schedule-completed");
  if (!upcomingList || !completedList) return;
  const owner = canEdit();
  const teamMap = {};
  state.teams.forEach(t => { teamMap[t.id] = t.name; });

  const completed = (state.games || []).filter(g => g.completed || (g.score1 != null && g.score2 != null));
  const upcoming = (state.games || []).filter(g => !g.completed && (g.score1 == null || g.score2 == null));

  function gameItem(g) {
    const n1 = teamMap[g.team1_id] || "TBD", n2 = teamMap[g.team2_id] || "TBD";
    const s1 = g.score1 != null ? g.score1 : "–", s2 = g.score2 != null ? g.score2 : "–";
    const dateStr = g.game_date
      ? new Date(g.game_date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
      : "No date";
    const details = [g.game_time, g.game_location, g.game_court, g.team_format].filter(Boolean).join(" • ");
    const actions = owner
      ? `<span class="league-schedule-actions">
           <span class="orange-action" data-action="edit-score" data-game-id="${g.id}" data-team1="${escapeHtml(n1)}" data-team2="${escapeHtml(n2)}" data-score1="${g.score1 ?? ''}" data-score2="${g.score2 ?? ''}">Edit score</span>
           <span class="orange-action danger" data-action="delete-game" data-game-id="${g.id}">Delete</span>
         </span>`
      : "";
    return `
      <li class="league-schedule-item">
        <span class="league-schedule-matchup">${escapeHtml(n1)} vs ${escapeHtml(n2)}</span>
        <span class="league-schedule-score">${s1} – ${s2}</span>
        <span class="league-schedule-date">${dateStr}</span>
        ${details ? `<span class="league-schedule-date">${escapeHtml(details)}</span>` : ""}
        ${actions}
      </li>`;
  }

  if (!state.games.length) {
    upcomingList.innerHTML = `<p class="league-meta">No games yet.${owner ? ' Use "+ Add game" above.' : ""}</p>`;
    completedList.innerHTML = "";
    return;
  }
  upcomingList.innerHTML = upcoming.length ? upcoming.map(gameItem).join("") : "<p class='league-meta'>No upcoming games.</p>";
  completedList.innerHTML = completed.length ? completed.map(gameItem).join("") : "<p class='league-meta'>No completed games yet.</p>";

  [upcomingList, completedList].forEach(list => {
    list.querySelectorAll("[data-action='edit-score']").forEach(el => {
      el.addEventListener("click", () => openEditScoreModal(el.dataset.gameId, el.dataset.team1, el.dataset.team2, el.dataset.score1, el.dataset.score2));
    });
    list.querySelectorAll("[data-action='delete-game']").forEach(el => {
      el.addEventListener("click", () => deleteGame(el.dataset.gameId));
    });
  });
}

function scrollChatToBottom() {
  const container = document.getElementById("league-chat-messages");
  if (!container) return;
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

async function renderChat() {
  const container = document.getElementById("league-chat-messages");
  if (!container) return;
  const list = await loadMessages();
  container.innerHTML = list.map(m => {
    const isOwn = state.user && m.user_id === state.user.id;
    const label = senderDisplayFromRow(m, isOwn);
    const timeFull = m.created_at
      ? new Date(m.created_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
      : "";
    const deleteBtn = isOwner()
      ? `<span class="orange-action league-chat-message-delete" data-msg-id="${m.id}">Delete</span>`
      : "";
    const rowClass = isOwn ? "league-chat-row league-chat-row--own" : "league-chat-row league-chat-row--other";
    return `
      <div class="${rowClass}" data-msg-id="${m.id}">
        <div class="league-chat-bubble">
          <div class="league-chat-bubble-meta">
            <span class="league-chat-sender">${escapeHtml(label)}</span>
            <span class="league-chat-time">${escapeHtml(timeFull)}</span>
            ${deleteBtn}
          </div>
          ${m.message ? `<div class="league-chat-bubble-text">${escapeHtml(m.message)}</div>` : ""}
          ${m.image_url ? `<a href="${escapeHtml(m.image_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.image_url)}" alt="Chat upload" class="league-chat-image"></a>` : ""}
        </div>
      </div>`;
  }).join("");
  container.querySelectorAll(".league-chat-message-delete").forEach(el => {
    el.addEventListener("click", () => deleteMessage(el.dataset.msgId));
  });
  scrollChatToBottom();
}

async function openAddTeamModal() {
  const name = await promptModal({ title: "Add team", placeholder: "Team name" });
  if (name && name.trim()) addTeam(name.trim());
}

async function openAddPlayerModal(teamId, teamName) {
  const name = await promptModal({ title: `Add player to ${teamName}`, placeholder: "Player name" });
  if (name && name.trim()) addPlayer(teamId, name.trim());
}

async function openMovePlayerModal(playerId, currentTeamId) {
  const others = state.teams.filter(t => t.id !== currentTeamId);
  if (!others.length) return;
  const names = others.map(t => t.name).join(", ");
  const chosen = await promptModal({
    title: "Move player",
    placeholder: `Type one: ${names}`,
    defaultValue: others[0]?.name || ""
  });
  const team = others.find(t => t.name === chosen);
  if (team) movePlayer(playerId, team.id);
}

async function openAddGameModal() {
  if (state.teams.length < 2) {
    toast("Need at least 2 teams", "error");
    return;
  }
  const names = state.teams.map(t => t.name).join(", ");
  const t1Name = await promptModal({ title: "New game - Team 1", placeholder: `Pick team: ${names}` });
  const t2Name = await promptModal({ title: "New game - Team 2", placeholder: `Pick team: ${names}` });
  const t1 = state.teams.find(t => t.name === t1Name);
  const t2 = state.teams.find(t => t.name === t2Name);
  if (!t1 || !t2 || t1.id === t2.id) {
    toast("Pick two different teams", "error");
    return;
  }
  const date = await promptModal({ title: "Game date", placeholder: "YYYY-MM-DD" });
  const time = await promptModal({ title: "Game time", placeholder: "e.g. 18:30" });
  const location = await promptModal({ title: "Location", placeholder: "e.g. North Park" });
  const court = await promptModal({ title: "Court / field", placeholder: "e.g. Court 2, Field A" });
  const teamFormat = await promptModal({ title: "Team format", placeholder: "e.g. 3v3, 5v5, 11v11", defaultValue: "5v5" });
  createGame(t1.id, t2.id, {
    date: date && date.trim() ? date.trim() : null,
    time: time && time.trim() ? time.trim() : null,
    location: location && location.trim() ? location.trim() : null,
    court: court && court.trim() ? court.trim() : null,
    teamFormat: teamFormat && teamFormat.trim() ? teamFormat.trim() : null
  });
}

async function openEditScoreModal(gameId, team1, team2, score1, score2) {
  const s1 = await promptModal({ title: `${team1} score`, defaultValue: score1 ?? "0" });
  const s2 = await promptModal({ title: `${team2} score`, defaultValue: score2 ?? "0" });
  if (s1 != null && s2 != null) updateGameScore(gameId, s1, s2);
}

function setupSmoothScrollNav() {
  document.querySelectorAll("nav a").forEach(link => {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    link.addEventListener("click", e => {
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}

function setupScrollReveal() {
  const sections = document.querySelectorAll(".section-reveal");
  if (!sections.length) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  }, { threshold: 0.1 });
  sections.forEach(s => observer.observe(s));
}

function setupParallaxHero() {
  const hero = document.querySelector(".hero");
  const bg = document.querySelector(".hero-bg");
  if (!hero || !bg) return;
  window.addEventListener("scroll", () => {
    const rect = hero.getBoundingClientRect();
    const offset = Math.max(0, -rect.top) * 0.35;
    bg.style.transform = `translateY(${offset}px)`;
  });
}

function setupTeamTilt() {
  const cards = document.querySelectorAll("#league-teams .team-card");
  if (!cards.length) return;
  cards.forEach(card => {
    card.addEventListener("mousemove", e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rotateY = (x - rect.width / 2) / 15;
      const rotateX = -(y - rect.height / 2) / 15;
      card.style.transform =
        `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform =
        "perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)";
    });
  });
}

function runHeroIntroAnimation() {
  const h1 = document.querySelector("#league-hero h1");
  const p = document.querySelector("#league-hero .league-hero-tagline");
  if (h1) {
    h1.classList.remove("animate");
    void h1.offsetWidth;
    h1.classList.add("animate");
  }
  if (p) {
    p.classList.remove("animate");
    void p.offsetWidth;
    p.classList.add("animate");
  }
}

function bindPageEffectsOnce() {
  if (state.pageEffectsBound) return;
  state.pageEffectsBound = true;
  setupSmoothScrollNav();
  setupScrollReveal();
  setupParallaxHero();
}

function wireOwnerControls() {
  const addTeamBtn = document.getElementById("league-add-team");
  if (addTeamBtn) {
    addTeamBtn.classList.toggle("hidden", !canEdit());
    addTeamBtn.onclick = () => openAddTeamModal();
  }
  const addGameBtn = document.getElementById("league-add-game");
  if (addGameBtn) {
    addGameBtn.classList.toggle("hidden", !canEdit());
    addGameBtn.onclick = () => openAddGameModal();
  }
}

function wireChatControls() {
  if (state.chatControlsBound) return;
  state.chatControlsBound = true;
  const chatInput = document.getElementById("league-chat-input");
  const chatSend = document.getElementById("league-chat-send");
  const attachBtn = document.getElementById("league-chat-attach");
  const fileInput = document.getElementById("league-chat-image");
  const uploadHint = document.getElementById("league-chat-upload-hint");
  if (!chatInput || !chatSend) return;
  const send = async () => {
    let imageUrl = null;
    const file = fileInput?.files?.[0];
    if (file) {
      if (uploadHint) {
        uploadHint.classList.remove("hidden");
        uploadHint.textContent = "Uploading image...";
      }
      const { url, error } = await uploadChatImage(file);
      if (error) {
        toast(error.message || "Image upload failed", "error");
        if (uploadHint) uploadHint.classList.add("hidden");
        return;
      }
      imageUrl = url;
    }
    await sendMessage(chatInput.value, imageUrl);
    if (fileInput) fileInput.value = "";
    if (uploadHint) {
      uploadHint.classList.add("hidden");
      uploadHint.textContent = "";
    }
  };
  chatSend.addEventListener("click", send);
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (uploadHint) {
        if (file) {
          uploadHint.classList.remove("hidden");
          uploadHint.textContent = `Selected: ${file.name}`;
        } else {
          uploadHint.classList.add("hidden");
          uploadHint.textContent = "";
        }
      }
    });
  }
}

function updateChatAvailability() {
  const chatInput = document.getElementById("league-chat-input");
  const chatSend = document.getElementById("league-chat-send");
  if (!chatInput || !chatSend) return;
  if (!canChat()) {
    chatInput.disabled = true;
    chatInput.placeholder = "Sign in and join this league to chat";
    chatSend.classList.add("disabled");
  } else {
    chatInput.disabled = false;
    chatInput.placeholder = "Type a message...";
    chatSend.classList.remove("disabled");
  }
}

async function init() {
  const id = leagueId();
  if (!id) {
    const main = document.querySelector("main");
    if (main) main.innerHTML = "<p class='league-meta'>No league selected. <a class='orange-action' href='app.html'>Go home</a></p>";
    return;
  }
  await ensureUser();
  const league = await loadLeague();
  if (!league) {
    const title = document.getElementById("league-title");
    if (title) title.textContent = "League not found";
    return;
  }
  await loadTeams();
  await loadPlayers();
  await loadGames();
  renderHeader();
  renderTeams();
  renderStandings();
  renderSchedule();
  await renderChat();
  subscribeMessages();

  bindPageEffectsOnce();
  wireOwnerControls();
  wireChatControls();
  updateChatAvailability();
  runHeroIntroAnimation();
  setupTeamTilt();
}

document.addEventListener("DOMContentLoaded", init);
