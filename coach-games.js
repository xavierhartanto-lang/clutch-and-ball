"use strict";

import supabase from "./supabase.js";
import { getSessionUser, showMsg, hasCoachHubAccess, fetchTeamsCoachedByUser } from "./coach-shared.js";

const mySelect = document.getElementById("my-team");
const oppInput = document.getElementById("opponent-name");
const msg = document.getElementById("game-msg");
const form = document.getElementById("form-game");

async function init() {
  const user = await getSessionUser();
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  if (!hasCoachHubAccess(user)) {
    showMsg(msg, "Only team owners (coach or parent) can log games. Enable that role under Account or the profile menu.", true);
    if (form) form.querySelectorAll("input, select, button").forEach((el) => { el.disabled = true; });
    return;
  }

  const { data: mine, error: e1 } = await fetchTeamsCoachedByUser(user.id);

  if (e1) {
    showMsg(msg, e1.message, true);
    return;
  }

  const myTeams = mine || [];
  if (mySelect) {
    mySelect.innerHTML = myTeams.length
      ? myTeams.map((t) => `<option value="${escapeAttr(t.id)}">${escapeAttr(t.name)}</option>`).join("")
      : '<option value="">No teams — create one on Home</option>';
    mySelect.disabled = myTeams.length === 0;
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg(msg, "");

  const user = await getSessionUser();
  if (!user || !hasCoachHubAccess(user)) return;

  const myId = mySelect?.value;
  const oppName = oppInput?.value.trim() || "";
  const sMy = parseInt(document.getElementById("score-my")?.value, 10);
  const sOpp = parseInt(document.getElementById("score-opp")?.value, 10);

  if (!myId) {
    showMsg(msg, "Select your team.", true);
    return;
  }
  if (!oppName) {
    showMsg(msg, "Enter the opponent name.", true);
    return;
  }
  if (Number.isNaN(sMy) || Number.isNaN(sOpp)) {
    showMsg(msg, "Enter valid scores.", true);
    return;
  }

  const { error: insErr } = await supabase.from("games").insert({
    team1_id: myId,
    team2_id: null,
    opponent_name: oppName,
    team1_score: sMy,
    team2_score: sOpp
  });

  if (insErr) {
    showMsg(msg, insErr.message, true);
    return;
  }

  const { data: t1 } = await supabase.from("teams").select("wins, losses").eq("id", myId).single();
  if (!t1) {
    showMsg(msg, "Game saved but could not reload your team record.", true);
    return;
  }

  const w1 = Number(t1.wins) || 0;
  const l1 = Number(t1.losses) || 0;
  let nw1 = w1;
  let nl1 = l1;

  if (sMy > sOpp) nw1 += 1;
  else if (sOpp > sMy) nl1 += 1;

  const { error: u1 } = await supabase.from("teams").update({ wins: nw1, losses: nl1 }).eq("id", myId);
  if (u1) {
    showMsg(msg, u1.message, true);
    return;
  }

  if (oppInput) oppInput.value = "";
  document.getElementById("score-my").value = "";
  document.getElementById("score-opp").value = "";
  showMsg(msg, sMy === sOpp ? "Tie recorded — no change to wins/losses." : "Game saved.");
});

init();
