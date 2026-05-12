"use strict";

import supabase from "./supabase.js";
import { showMsg, fetchTeamsCoachedByUser, randomInviteCode } from "./coach-shared.js";

const authSection = document.getElementById("section-auth");
const appSection = document.getElementById("section-app");
const authMsg = document.getElementById("auth-msg");
const createMsg = document.getElementById("create-msg");
const teamList = document.getElementById("team-list");
const noTeams = document.getElementById("no-teams");

function showApp(user) {
  authSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email || user.id;
}

function showAuthForm() {
  appSection.classList.add("hidden");
  authSection.classList.remove("hidden");
}

async function loadMyTeams(userId) {
  const { data, error } = await fetchTeamsCoachedByUser(userId);

  if (error) {
    showMsg(createMsg, error.message, true);
    return;
  }

  teamList.innerHTML = "";
  const rows = data || [];
  noTeams.classList.toggle("hidden", rows.length > 0);

  rows.forEach((t) => {
    const li = document.createElement("li");
    const w = Number(t.wins) || 0;
    const l = Number(t.losses) || 0;
    li.innerHTML = `
      <a href="team.html?id=${t.id}">${escapeHtml(t.name)}</a>
      <span class="coach-record">${w}–${l}</span>`;
    teamList.appendChild(li);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

document.getElementById("toggle-signup").addEventListener("click", () => {
  document.getElementById("form-signup").classList.toggle("hidden");
});

document.getElementById("form-signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  showMsg(authMsg, "");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showMsg(authMsg, error.message, true);
    return;
  }
  window.location.reload();
});

document.getElementById("form-signup-inner").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  showMsg(authMsg, "");
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    showMsg(authMsg, error.message, true);
    return;
  }
  showMsg(authMsg, "Check your email if confirmation is required, then sign in.");
});

document.getElementById("btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showAuthForm();
  window.location.reload();
});

document.getElementById("form-create-team").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const name = document.getElementById("new-team-name").value.trim();
  showMsg(createMsg, "");
  let error = null;
  const code = randomInviteCode();
  const assistantCode = randomInviteCode();
  const first = await supabase.from("teams").insert({
    name,
    coach_id: user.id,
    wins: 0,
    losses: 0,
    invite_code: code,
    assistant_invite_code: assistantCode
  });
  error = first.error;
  if (error && /assistant_invite_code|column.*does not exist|42703/i.test(String(error.message || ""))) {
    const fallback = await supabase.from("teams").insert({
      name,
      coach_id: user.id,
      wins: 0,
      losses: 0,
      invite_code: code
    });
    error = fallback.error;
  }
  if (error) {
    showMsg(createMsg, error.message, true);
    return;
  }
  document.getElementById("new-team-name").value = "";
  showMsg(createMsg, "Team created.");
  await loadMyTeams(user.id);
});

supabase.auth.getSession().then(({ data: { session } }) => {
  if (session?.user) {
    showApp(session.user);
    loadMyTeams(session.user.id);
  }
});
