"use strict";

import supabase from "./supabase.js";
import { showToast } from "./ui.js";
import {
  generateInviteCode,
  joinLeagueByCode,
  ensureOwnerMembershipRow,
  fetchUserLeaguesBundle
} from "./leagues.js";
import { refreshDashboard } from "./dashboard.js";
import {
  hasCoachHubAccess,
  hasPlayerHubAccess,
  syncHomeHubLayout,
  accountDisplayName,
  homeHeroForSignedInUser
} from "./coach-shared.js";

/* ============================
   GAME SCHEDULE
============================ */

const gameSchedule = {
  1:{ lunchHour:13,lunchMinute:4 },
  2:{ lunchHour:12,lunchMinute:45 },
  3:{ lunchHour:13,lunchMinute:45 },
  4:{ lunchHour:13,lunchMinute:4 },
  5:{ lunchHour:13,lunchMinute:4 }
};

/* ============================
   PAGE LOAD
============================ */

/* ============================
   SUPABASE TEST
============================ */

async function testSupabaseConnection(){
  try{
    const { data, error } = await supabase.auth.getSession();
    if(error) throw error;
    console.log("Supabase connected");
  }catch(err){
    console.error("Supabase failed:",err);
  }
}

/* ============================
   SMOOTH SCROLL
============================ */

function setupSmoothScroll(){

  const navLinks = document.querySelectorAll("nav a");
  if (!navLinks.length) return;

  navLinks.forEach(link=>{

    link.addEventListener("click",e=>{

      const href = link.getAttribute("href");

      if(!href || !href.startsWith("#")) return;

      const target = document.querySelector(href);

      if(target){
        e.preventDefault();
        target.scrollIntoView({
          behavior:"smooth"
        });
      }

    });

  });

}

/* ============================
   SCROLL REVEAL
============================ */

function setupScrollReveal(){

  const sections = document.querySelectorAll(".section-reveal");
  if (!sections.length) return;

  const observer = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add("visible");
      }
    });
  },{
    threshold:0.1
  });

  sections.forEach(s=>observer.observe(s));

}

/* ============================
   HERO PARALLAX
============================ */

function setupParallaxHero(){

  const hero = document.querySelector(".hero");
  const bg = document.querySelector(".hero-bg");

  if(!hero || !bg) return;

  window.addEventListener("scroll",()=>{

    const rect = hero.getBoundingClientRect();

    const offset = Math.max(0,-rect.top)*0.35;

    bg.style.transform = `translateY(${offset}px)`;

  });

}

/* ============================
   FLOATING PARTICLES
============================ */

function setupParticles(){

  const container = document.getElementById("particles");

  if(!container) return;

  for(let i=0;i<10;i++){

    const p=document.createElement("span");

    p.className="particle";

    container.appendChild(p);

  }

}

/* ============================
   TEAM CARD 3D TILT
============================ */

function setupTeamTilt(){

  const cards=document.querySelectorAll(".team-card");
  if (!cards.length) return;

  cards.forEach(card=>{

    card.addEventListener("mousemove",e=>{

      const rect=card.getBoundingClientRect();

      const x=e.clientX-rect.left;
      const y=e.clientY-rect.top;

      const rotateY=(x-rect.width/2)/15;
      const rotateX=-(y-rect.height/2)/15;

      card.style.transform=
      `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;

    });

    card.addEventListener("mouseleave",()=>{

      card.style.transform=
      `perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)`;

    });

  });

}

/* ============================
   NAV ANIMATION RESTART
============================ */

function restartAnimation(selector){

  document.querySelectorAll(selector).forEach(el=>{

    el.classList.remove("animate");

    void el.offsetWidth;

    el.classList.add("animate");

  });

}

function setupNavAnimations(){

  const home=document.getElementById("home-link");
  const teams=document.getElementById("teams-link");
  const rules=document.getElementById("rules-link");

  if(home){
    home.addEventListener("click",()=>{
      restartAnimation(".hero h1");
      restartAnimation(".hero p");
    });
  }

  if(teams){
    teams.addEventListener("click",()=>{
      restartAnimation(".team-card");
    });
  }

  if(rules){
    rules.addEventListener("click",()=>{
      restartAnimation(".hero h1");
      restartAnimation(".hero p");
    });
  }

}

/* ============================
   STANDINGS (GOOGLE SHEETS)
============================ */

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQpKNTrOZ3HuunOBb17pdLvjBVtXtCV89pjkdjXb6aXnXzvOJ6l_a6zqADX3kW2llt2NStNrTluadzY/pub?output=csv";

async function loadStandings(){

  const container = document.querySelector(".standings");
  if (!container) return;

  const tableEl = document.getElementById("standings-table");
  if (!tableEl) return;

  try{

    const res = await fetch(SHEET_CSV_URL);
    const text = await res.text();

    const lines = text.trim().split("\n");
    if (!lines.length) {
      tableEl.innerHTML = "<p class='auth-message'>No standings data</p>";
      return;
    }

    function parseCSVLine(str) {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === "," && !inQuotes) {
          out.push(cur.trim());
          cur = "";
        } else {
          cur += c;
        }
      }
      out.push(cur.trim());
      return out;
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      const cols = parseCSVLine(line);
      if (cols.some(c => c)) rows.push(cols);
    }

    tableEl.innerHTML = "";

    const table = document.createElement("table");
    table.className = "standings";
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>Wins</th>
          <th>Losses</th>
          <th>PCT</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td colspan='5'>No standings yet</td>";
      tbody.appendChild(tr);
    } else {

      rows.forEach((cols, i) => {
        const team = cols[0] || "";
        const wins = parseInt(cols[1], 10) || 0;
        const losses = parseInt(cols[2], 10) || 0;
        const pctRaw = cols[3];
        const total = wins + losses;
        const pct = pctRaw ? parseFloat(pctRaw).toFixed(3) : (total > 0 ? (wins / total).toFixed(3) : "0.000");

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${i + 1}</td>
          <td>${team}</td>
          <td>${wins}</td>
          <td>${losses}</td>
          <td>${pct}</td>
        `;
        tbody.appendChild(tr);
      });

    }

    tableEl.appendChild(table);

  } catch (err) {
    console.error("Standings failed:", err);
    tableEl.innerHTML = "<p class='auth-message'>Could not load standings. Check your connection.</p>";
  }

}

/* ============================
   COUNTDOWN
============================ */

function getNextGame(){

  const now=new Date();

  for(let i=0;i<=7;i++){

    const check=new Date(now);

    check.setDate(now.getDate()+i);

    const day=check.getDay();

    if(gameSchedule[day]){

      const { lunchHour,lunchMinute }=gameSchedule[day];

      const gameDate=new Date(check);

      gameDate.setHours(lunchHour);
      gameDate.setMinutes(lunchMinute+10);
      gameDate.setSeconds(0);

      if(gameDate>now) return gameDate;

    }

  }

  return null;

}

function startCountdown() {

  const countdownEl = document.getElementById("next-game");
  if (!countdownEl) return;

  function updateCountdown() {
    const now = new Date();
    const nextGame = getNextGame();

    if (!nextGame) {
      countdownEl.textContent = "No upcoming games";
      return;
    }

    let diff = nextGame - now;

    if (diff < 0) {
      countdownEl.textContent = "Game in progress or finished";
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    countdownEl.textContent = `${hours}h ${minutes}m ${seconds}s`;
  }

  updateCountdown();
  setInterval(updateCountdown, 1000);
}
/* ============================
   AUTH
============================ */

function setupAuth(){

  const signinForm = document.getElementById("form-signin");
  const signupForm = document.getElementById("form-signup");
  const message = document.getElementById("auth-message");

  const signedOut = document.getElementById("auth-signed-out");
  const signedIn = document.getElementById("auth-signed-in");

  const signout = document.getElementById("btn-signout");

  // CHECK SESSION
  supabase.auth.getSession().then(({ data }) => {

    const session = data.session;

    if(session){

      if(signedOut){
        signedOut.classList.add("hidden");
      }

      if(signedIn){
        signedIn.classList.remove("hidden");
      }

      const displayNameEl = document.getElementById("auth-display-name");
      if (displayNameEl) {
        displayNameEl.textContent = accountDisplayName(session.user) || session.user.email || "";
      }

      const leagueForm = document.getElementById("create-league-form");

      if (leagueForm) {
        leagueForm.classList.remove("hidden");
      }

      const myLeagues = document.getElementById("my-leagues");

      if (myLeagues) {
        myLeagues.classList.remove("hidden");
      }

      const joinLeagueForm = document.getElementById("join-league-form");
      if (joinLeagueForm) {
        joinLeagueForm.classList.remove("hidden");
      }

      const coachHub = document.getElementById("coach-hub");
      if (coachHub) {
        coachHub.classList.toggle("hidden", !hasCoachHubAccess(session.user));
      }

      const playerHub = document.getElementById("player-hub");
      if (playerHub) {
        playerHub.classList.toggle("hidden", !hasPlayerHubAccess(session.user));
      }

      syncHomeHubLayout(session.user);

      const hubSection = document.getElementById("coach-hub-section");
      if (hubSection) {
        const hh = document.getElementById("hub-heading");
        const intro = hubSection.querySelector(".section-league-intro");
        if (hh && intro) {
          const hero = homeHeroForSignedInUser(session.user);
          hh.textContent = hero.title;
          intro.innerHTML = hero.introHtml;
        }
      }

      refreshDashboard();
      document.dispatchEvent(new CustomEvent("clutch:signed-in"));
    }

  });



  // SIGN IN
  if(signinForm){
    signinForm.addEventListener("submit", async (e)=>{
      e.preventDefault();

      const emailEl = document.getElementById("signin-email");
      const passwordEl = document.getElementById("signin-password");
      if (!emailEl || !passwordEl) return;
      const email = emailEl.value;
      const password = passwordEl.value;

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if(error){
        message.textContent = error.message;
      }else{
        location.reload();
      }
    });
  }

  // SIGN UP
  if(signupForm){
    signupForm.addEventListener("submit", async (e)=>{
      e.preventDefault();

      const fullNameEl = document.getElementById("signup-full-name");
      const emailEl = document.getElementById("signup-email");
      const passwordEl = document.getElementById("signup-password");
      if (!fullNameEl || !emailEl || !passwordEl) return;
      const fullName = fullNameEl.value.trim();
      const email = emailEl.value;
      const password = passwordEl.value;
      if (!fullName || fullName.length < 2) {
        if (message) message.textContent = "Please enter your name.";
        return;
      }

      const roleInput = signupForm.querySelector('input[name="signup-role"]:checked');
      if (!roleInput) {
        if (message) message.textContent = "Choose Coach, Parent, or Player.";
        return;
      }
      const signup_intent = roleInput.value;
      const is_coach = signup_intent === "coach";
      const slug = fullName.replace(/\s+/g, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || (email.split("@")[0] || "user");

      if (message) message.textContent = "";

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.href,
          data: {
            full_name: fullName,
            username: slug,
            is_coach,
            signup_intent
          }
        }
      });

      if (error) {
        if (message) message.textContent = error.message;
        return;
      }

      if (data?.session) {
        if (message) message.textContent = "Account created! Signing you in...";
        location.reload();
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (message) message.textContent = "Account created! Please check your email to confirm, then sign in.";
        return;
      }
      if (message) message.textContent = "Account created! Signing you in...";
      location.reload();
    });
  }

  // TAB SWITCHING
  const tabSignin = document.getElementById("tab-signin");
  const tabSignup = document.getElementById("tab-signup");
  if (tabSignin && tabSignup) {
    tabSignin.addEventListener("click", () => {
      tabSignin.classList.add("active");
      tabSignin.setAttribute("aria-selected", "true");
      tabSignup.classList.remove("active");
      tabSignup.setAttribute("aria-selected", "false");
      if (signinForm) {
        signinForm.classList.remove("hidden");
        signinForm.setAttribute("aria-hidden", "false");
      }
      if (signupForm) {
        signupForm.classList.add("hidden");
        signupForm.setAttribute("aria-hidden", "true");
      }
      if (message) message.textContent = "";
    });
    tabSignup.addEventListener("click", () => {
      tabSignup.classList.add("active");
      tabSignup.setAttribute("aria-selected", "true");
      tabSignin.classList.remove("active");
      tabSignin.setAttribute("aria-selected", "false");
      if (signupForm) {
        signupForm.classList.remove("hidden");
        signupForm.setAttribute("aria-hidden", "false");
      }
      if (signinForm) {
        signinForm.classList.add("hidden");
        signinForm.setAttribute("aria-hidden", "true");
      }
      if (message) message.textContent = "";
    });
  }

  // SIGN OUT
  if(signout){
    signout.addEventListener("click", async ()=>{
      await supabase.auth.signOut();
      location.reload();
    });
  }

}

/* ============================
   LEAGUES
============================ */

function setupLeagues(){

  const form = document.getElementById("form-create-league");
  if(!form) return;

  form.addEventListener("submit", async e => {

    e.preventDefault();

    const nameEl = document.getElementById("league-name");
    const slugEl = document.getElementById("league-slug");
    const sportEl = document.getElementById("league-sport");
    const themeEl = document.getElementById("league-theme");
    const heroTaglineEl = document.getElementById("league-hero-tagline");
    const descEl = document.getElementById("league-description");
    if (!nameEl || !slugEl) return;
    const name = nameEl.value.trim();
    const slug = slugEl.value.trim();
    const sport = sportEl?.value?.trim() || "basketball";
    const theme = themeEl?.value?.trim() || "default";
    const hero_tagline = heroTaglineEl?.value?.trim() || null;
    const description = descEl?.value?.trim() || null;

    const { data:{ user } } = await supabase.auth.getUser();
    if(!user){
      alert("You must be signed in.");
      return;
    }

    const inviteCode = generateInviteCode();
    const insertRow = {
      name,
      slug,
      owner_id: user.id,
      invite_code: inviteCode,
      ...(sport ? { sport } : {}),
      ...(theme ? { theme } : {}),
      ...(hero_tagline ? { hero_tagline } : {}),
      ...(description ? { description } : {})
    };
    let { data: leagueData, error } = await supabase
      .from("leagues")
      .insert(insertRow)
      .select("id")
      .single();
    if (error && /sport|description|theme|hero_tagline|schema cache|PGRST204|42703/i.test(error.message || "")) {
      const retry = await supabase
        .from("leagues")
        .insert({
          name,
          slug,
          owner_id: user.id,
          invite_code: inviteCode,
          ...(sport ? { sport } : {})
        })
        .select("id")
        .single();
      leagueData = retry.data;
      error = retry.error;
    }

    if (error) {
      const msg = document.getElementById("league-form-message");
      if (msg) msg.textContent = error.message;
      return;
    }

    if (leagueData?.id) {
      await ensureOwnerMembershipRow(leagueData.id, user.id);
    }

    form.reset();
    const msg = document.getElementById("league-form-message");
    if (msg) msg.textContent = "";
    showToast("League created!");
    loadLeagues();
    refreshDashboard();
    if (leagueData?.id) showLeagueCreated(leagueData.id);

  });

}

function checkPassword() {

  const inputEl = document.getElementById("password-input");
  if(!inputEl) return;

  const correctPassword = "xavisotuff";
  const input = inputEl.value;

  const screen = document.getElementById("password-screen");
  const content = document.getElementById("protected-content");
  const error = document.getElementById("error-msg");

  if (input === correctPassword) {

    localStorage.setItem("siteUnlocked", "true");

    if(screen) screen.style.display = "none";
    if(content) content.style.display = "block";

  } else {

    if(error) error.textContent = "Wrong password";

  }

}

async function loadLeagues() {

  const container = document.getElementById("my-leagues-list");
  if (!container) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const bundle = await fetchUserLeaguesBundle(user.id);
  const seen = new Set();
  const rows = [];
  bundle.owned.forEach((l) => {
    if (!seen.has(l.id)) {
      seen.add(l.id);
      rows.push({ ...l, _badge: "Owner" });
    }
  });
  bundle.member.forEach((l) => {
    if (!seen.has(l.id)) {
      seen.add(l.id);
      rows.push({ ...l, _badge: "Member" });
    }
  });

  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = "<li>No leagues yet — create one or join with a code.</li>";
    refreshDashboard();
    return;
  }

  rows.forEach((league) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="league-card">
        <span>${league.name} <small class="league-role-pill">${league._badge}</small></span>
        <a href="league.html?id=${league.id}" class="nav-btn">
          Open League
        </a>
      </div>
    `;
    container.appendChild(li);
  });

  refreshDashboard();
}

function openLeague(id){
  window.location.href = `league.html?id=${id}`;
}

window.openLeague = openLeague;

function setupJoinLeague() {
  const btn = document.getElementById("btn-join-league");
  const form = document.getElementById("form-join-league");
  const input = document.getElementById("invite-code");
  const msg = document.getElementById("join-league-message");
  if (!btn || !input) return;
  input.addEventListener("input", () => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    try {
      input.setSelectionRange(start, end);
    } catch (_) { /* ignore */ }
  });
  function handleJoin() {
    if (msg) msg.textContent = "";
    joinLeagueByCode(input.value).then((result) => {
      if (result.error) {
        if (msg) msg.textContent = result.error;
        return;
      }
      if (result.leagueId) {
        window.location.href = `league.html?id=${result.leagueId}`;
      }
    });
  }
  btn.addEventListener("click", handleJoin);
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); handleJoin(); });
}

/* ============================
   LEAGUE PAGE
============================ */

let currentLeague = null;
let isLeagueOwner = false;

function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }
}

function setupLeagueModals() {
  const btnAddTeam = document.getElementById("btn-add-team");
  const modalAddTeam = document.getElementById("modal-add-team");
  const modalAddTeamCancel = document.getElementById("modal-add-team-cancel");
  const formAddTeam = document.getElementById("form-add-team");
  const modalAddTeamBackdrop = modalAddTeam?.querySelector(".modal-backdrop");

  if (btnAddTeam) {
    btnAddTeam.addEventListener("click", () => {
      if (!isLeagueOwner) {
        showToast("Only the league owner can add teams.", "error");
        return;
      }
      const input = document.getElementById("modal-team-name");
      if (input) input.value = "";
      openModal("modal-add-team");
    });
  }
  if (modalAddTeamCancel) {
    modalAddTeamCancel.addEventListener("click", () => closeModal("modal-add-team"));
  }
  if (modalAddTeamBackdrop) {
    modalAddTeamBackdrop.addEventListener("click", () => closeModal("modal-add-team"));
  }
  if (formAddTeam) {
    formAddTeam.addEventListener("submit", handleAddTeam);
  }

  const modalAddPlayer = document.getElementById("modal-add-player");
  const modalAddPlayerCancel = document.getElementById("modal-add-player-cancel");
  const formAddPlayer = document.getElementById("form-add-player");
  const modalAddPlayerBackdrop = modalAddPlayer?.querySelector(".modal-backdrop");

  if (modalAddPlayerCancel) {
    modalAddPlayerCancel.addEventListener("click", () => closeModal("modal-add-player"));
  }
  if (modalAddPlayerBackdrop) {
    modalAddPlayerBackdrop.addEventListener("click", () => closeModal("modal-add-player"));
  }
  if (formAddPlayer) {
    formAddPlayer.addEventListener("submit", handleAddPlayer);
  }

  const modalEditGame = document.getElementById("modal-edit-game");
  const modalEditGameCancel = document.getElementById("modal-edit-game-cancel");
  const formEditGame = document.getElementById("form-edit-game");
  if (modalEditGameCancel) modalEditGameCancel.addEventListener("click", () => closeModal("modal-edit-game"));
  if (modalEditGame?.querySelector(".modal-backdrop")) {
    modalEditGame.querySelector(".modal-backdrop").addEventListener("click", () => closeModal("modal-edit-game"));
  }
  if (formEditGame) formEditGame.addEventListener("submit", handleEditGameTime);

  const modalRecordResult = document.getElementById("modal-record-result");
  const modalRecordResultCancel = document.getElementById("modal-record-result-cancel");
  if (modalRecordResultCancel) modalRecordResultCancel.addEventListener("click", () => closeModal("modal-record-result"));
  if (modalRecordResult?.querySelector(".modal-backdrop")) {
    modalRecordResult.querySelector(".modal-backdrop").addEventListener("click", () => closeModal("modal-record-result"));
  }
  const resultWinnerBtns = document.querySelectorAll(".result-winner-btn");
  resultWinnerBtns.forEach(btn => {
    btn.addEventListener("click", () => handleRecordResultSubmit(btn.dataset.side));
  });
}

async function handleAddTeam(e) {
  e.preventDefault();
  const input = document.getElementById("modal-team-name");
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;

  const params = new URLSearchParams(window.location.search);
  const leagueId = params.get("id");
  if (!leagueId || !currentLeague) return;
  if (!isLeagueOwner) {
    showToast("Only the league owner can add teams.", "error");
    return;
  }

  const { error } = await supabase
    .from("teams")
    .insert({
      name,
      league_id: leagueId,
      owner_id: currentLeague.owner_id,
      wins: 0,
      losses: 0
    });

  if (error) {
    showToast(error.message, "error");
    return;
  }
  closeModal("modal-add-team");
  input.value = "";
  showToast("Team added!");
  loadLeaguePage();
}

function openAddPlayerModal(teamId, teamName) {
  const teamIdInput = document.getElementById("modal-player-team-id");
  const playerNameInput = document.getElementById("modal-player-name");
  const teamLabel = document.getElementById("modal-add-player-team");
  if (teamIdInput) teamIdInput.value = teamId;
  if (playerNameInput) playerNameInput.value = "";
  if (teamLabel) teamLabel.textContent = `Adding to: ${teamName}`;
  openModal("modal-add-player");
}

async function handleAddPlayer(e) {
  e.preventDefault();
  const teamIdInput = document.getElementById("modal-player-team-id");
  const nameInput = document.getElementById("modal-player-name");
  if (!teamIdInput || !nameInput) return;
  const teamId = teamIdInput.value;
  const name = nameInput.value.trim();
  if (!teamId || !name) return;

  if (!isLeagueOwner) {
    showToast("Only the league owner can add players.", "error");
    return;
  }

  try {
    const { error } = await supabase
      .from("players")
      .insert({ team_id: teamId, name });

    if (error) {
      showToast(error.message, "error");
      return;
    }
    closeModal("modal-add-player");
    nameInput.value = "";
    showToast("Player added!");
    const leagueId = new URLSearchParams(window.location.search).get("id");
    if (leagueId) loadPlayers(leagueId);
  } catch (err) {
    showToast("Add a 'players' table in Supabase (team_id, name).", "error");
  }
}

async function loadLeaguePage() {
  const params = new URLSearchParams(window.location.search);
  const leagueId = params.get("id");

  if (!leagueId) return;

  const title = document.getElementById("league-title");
  const ownerEl = document.getElementById("league-owner");
  const teamCountEl = document.getElementById("league-team-count");
  const teamsContainer = document.getElementById("teams-container");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();

  currentLeague = league;
  isLeagueOwner = !!(user && league && league.owner_id === user.id);

  if (!league) {
    if (title) title.textContent = "League not found";
    if (teamsContainer) teamsContainer.innerHTML = "<p class='auth-message'>This league does not exist.</p>";
    return;
  }

  if (title) title.textContent = league.name;
  if (ownerEl) ownerEl.textContent = isLeagueOwner ? "Owner: You" : "Owner: League creator";
  if (teamCountEl) teamCountEl.textContent = "";

  const btnAddTeam = document.getElementById("btn-add-team");
  if (btnAddTeam) {
    btnAddTeam.disabled = !isLeagueOwner;
    btnAddTeam.title = isLeagueOwner ? "Add a new team" : "Only the league owner can add teams";
  }

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, wins, losses")
    .eq("league_id", leagueId);

  if (teamCountEl) teamCountEl.textContent = `${teams?.length || 0} team(s)`;

  if (!teamsContainer) return;

  teamsContainer.innerHTML = "";

  if (!teams || teams.length === 0) {
    teamsContainer.innerHTML = "<p class='auth-message'>No teams yet. Click Add Team above!</p>";
    const genScheduleBtn = document.getElementById("generate-schedule");
    if (genScheduleBtn) genScheduleBtn.disabled = true;
    loadLeagueStandings(leagueId);
    loadSchedule(leagueId);
    return;
  }

  const sortedTeams = [...teams].sort((a, b) => {
    const winsA = Number(a.wins) || 0;
    const winsB = Number(b.wins) || 0;
    if (winsB !== winsA) return winsB - winsA;
    const pctA = winsA + (Number(a.losses) || 0) ? winsA / (winsA + (Number(a.losses) || 0)) : 0;
    const pctB = winsB + (Number(b.losses) || 0) ? winsB / (winsB + (Number(b.losses) || 0)) : 0;
    return pctB - pctA;
  });

  sortedTeams.forEach(team => {
    const wins = Number(team.wins) || 0;
    const losses = Number(team.losses) || 0;
    const total = wins + losses;
    const pct = total > 0 ? ((wins / total) * 100).toFixed(0) : 0;

    const div = document.createElement("div");
    div.className = "team-card league-team-card";
    div.dataset.teamId = team.id;

    const nameSpan = document.createElement("span");
    nameSpan.className = "team-name-display";
    nameSpan.textContent = team.name;

    const h3 = document.createElement("h3");
    h3.appendChild(nameSpan);

    const recordEl = document.createElement("p");
    recordEl.className = "team-record";
    recordEl.textContent = `${wins}W - ${losses}L (${pct}%)`;

    const actions = document.createElement("div");
    actions.className = "team-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon btn-edit";
    editBtn.textContent = "Edit";
    editBtn.setAttribute("aria-label", "Edit team name");
    editBtn.type = "button";
    if (isLeagueOwner) {
      editBtn.addEventListener("click", () => editTeamName(team.id, nameSpan));
    } else {
      editBtn.disabled = true;
      editBtn.title = "Only owner can edit";
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon btn-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", "Delete team");
    deleteBtn.type = "button";
    if (isLeagueOwner) {
      deleteBtn.addEventListener("click", () => deleteTeam(team.id));
    } else {
      deleteBtn.disabled = true;
      deleteBtn.title = "Only owner can delete";
    }

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    const playersContainer = document.createElement("div");
    playersContainer.className = "team-players";
    playersContainer.dataset.teamId = team.id;

    const addPlayerBtn = document.createElement("button");
    addPlayerBtn.className = "btn-icon btn-add-player";
    addPlayerBtn.textContent = "+ Add Player";
    addPlayerBtn.type = "button";
    if (isLeagueOwner) {
      addPlayerBtn.addEventListener("click", () => openAddPlayerModal(team.id, team.name));
    } else {
      addPlayerBtn.disabled = true;
    }

    div.appendChild(h3);
    div.appendChild(recordEl);
    div.appendChild(actions);
    div.appendChild(playersContainer);
    div.appendChild(addPlayerBtn);

    teamsContainer.appendChild(div);
  });

  const genScheduleBtn = document.getElementById("generate-schedule");
  if (genScheduleBtn) genScheduleBtn.disabled = teams.length < 2;

  loadPlayers(leagueId);
  loadLeagueStandings(leagueId);
  loadSchedule(leagueId);
}

async function loadLeagueStandings(leagueId) {
  const container = document.getElementById("league-standings-table");
  if (!container) return;

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, wins, losses")
    .eq("league_id", leagueId);

  container.innerHTML = "";

  if (!teams || teams.length === 0) {
    container.innerHTML = "<p class='auth-message'>No standings yet. Add teams first.</p>";
    return;
  }

  const sorted = [...teams].sort((a, b) => {
    const winsA = Number(a.wins) || 0;
    const lossesA = Number(a.losses) || 0;
    const winsB = Number(b.wins) || 0;
    const lossesB = Number(b.losses) || 0;
    const pctA = winsA + lossesA > 0 ? winsA / (winsA + lossesA) : 0;
    const pctB = winsB + lossesB > 0 ? winsB / (winsB + lossesB) : 0;
    if (winsB !== winsA) return winsB - winsA;
    return pctB - pctA;
  });

  const table = document.createElement("table");
  table.className = "standings";
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Team</th>
        <th>Wins</th>
        <th>Losses</th>
        <th>PCT</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  sorted.forEach((t, i) => {
    const wins = Number(t.wins) || 0;
    const losses = Number(t.losses) || 0;
    const total = wins + losses;
    const pct = total > 0 ? (wins / total).toFixed(3) : "0.000";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${(t.name || "").toString()}</td>
      <td>${wins}</td>
      <td>${losses}</td>
      <td>${pct}</td>
    `;
    tbody.appendChild(tr);
  });

  container.appendChild(table);
}

async function editTeamName(teamId, nameEl) {
  if (!isLeagueOwner) return;
  const newName = prompt("Enter new team name:", nameEl.textContent);
  if (!newName || !newName.trim()) return;

  const { error } = await supabase
    .from("teams")
    .update({ name: newName.trim() })
    .eq("id", teamId);

  if (error) {
    showToast(error.message, "error");
    return;
  }
  nameEl.textContent = newName.trim();
  showToast("Team renamed!");
  const leagueId = new URLSearchParams(window.location.search).get("id");
  if (leagueId) loadLeagueStandings(leagueId);
}

async function deleteTeam(teamId) {
  if (!isLeagueOwner) return;
  if (!confirm("Delete this team? This cannot be undone.")) return;

  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) {
    showToast(error.message, "error");
    return;
  }
  showToast("Team deleted.");
  loadLeaguePage();
}

async function loadPlayers(leagueId) {
  try {
    const { data: teams } = await supabase
      .from("teams")
      .select("id")
      .eq("league_id", leagueId);
    if (!teams?.length) return;

    const teamIds = teams.map(t => t.id);
    const { data: players } = await supabase
      .from("players")
      .select("id, team_id, name")
      .in("team_id", teamIds);

    const containers = document.querySelectorAll(".team-players");
    containers.forEach(c => {
      c.innerHTML = "";
      const list = players?.filter(p => p.team_id === c.dataset.teamId) || [];
      list.forEach(p => {
        const wrap = document.createElement("span");
        wrap.className = "player-tag";
        wrap.textContent = p.name;
        if (isLeagueOwner) {
          const removeBtn = document.createElement("button");
          removeBtn.className = "player-remove";
          removeBtn.innerHTML = "&times;";
          removeBtn.setAttribute("aria-label", `Remove ${p.name}`);
          removeBtn.type = "button";
          removeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            removePlayer(p.id);
          });
          wrap.appendChild(removeBtn);
        }
        c.appendChild(wrap);
      });
    });
  } catch (_) {
    /* players table may not exist */
  }
}

async function removePlayer(playerId) {
  if (!isLeagueOwner) return;
  try {
    const { error } = await supabase.from("players").delete().eq("id", playerId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast("Player removed.");
    const leagueId = new URLSearchParams(window.location.search).get("id");
    if (leagueId) loadPlayers(leagueId);
  } catch (err) {
    showToast("Could not remove player.", "error");
  }
}

async function generateSchedule(leagueId) {
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId);
  if (!teams || teams.length < 2) {
    showToast("Need at least 2 teams to generate a schedule.", "error");
    return;
  }

  const games = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      games.push({
        league_id: leagueId,
        home_team_id: teams[i].id,
        away_team_id: teams[j].id
      });
    }
  }

  try {
    const { error } = await supabase.from("games").insert(games);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast(`Schedule generated: ${games.length} games!`);
    loadSchedule(leagueId);
  } catch (err) {
    showToast("Add a 'games' table in Supabase (league_id, home_team_id, away_team_id).", "error");
  }
}

async function loadSchedule(leagueId) {
  const list = document.getElementById("schedule-list");
  if (!list) return;

  try {
    const { data: games } = await supabase
      .from("games")
      .select("id, home_team_id, away_team_id, scheduled_at, home_score, away_score")
      .eq("league_id", leagueId)
      .order("scheduled_at", { ascending: true })

    list.innerHTML = "";
    if (!games || games.length === 0) {
      list.innerHTML = "<p class='auth-message'>No schedule yet. Click Generate Schedule above.</p>";
      return;
    }

    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .eq("league_id", leagueId);

    const teamMap = {};
    (teams || []).forEach(t => { teamMap[t.id] = t.name; });

    games.forEach(g => {
      const home = teamMap[g.home_team_id] || "TBD";
      const away = teamMap[g.away_team_id] || "TBD";
      let timeStr = "";
      if (g.scheduled_at) {
        const d = new Date(g.scheduled_at);
        timeStr = ` — ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
      const scoreStr = (g.home_score != null && g.away_score != null)
        ? ` (${g.home_score}–${g.away_score})`
        : "";

      const li = document.createElement("li");
      li.className = "schedule-item";
      li.innerHTML = `
        <span class="schedule-matchup">${home} vs ${away}${scoreStr}</span>
        <span class="schedule-time">${timeStr || " — No time set"}</span>
        ${isLeagueOwner ? `
          <div class="schedule-item-actions">
            <button type="button" class="btn-icon btn-edit-game" data-game-id="${g.id}" data-home="${home}" data-away="${away}">Set time</button>
            <button type="button" class="btn-icon btn-record-result" data-game-id="${g.id}" data-home-id="${g.home_team_id}" data-away-id="${g.away_team_id}" data-home="${home}" data-away="${away}">Record result</button>
          </div>
        ` : ""}
      `;

      const editBtn = li.querySelector(".btn-edit-game");
      if (editBtn) {
        editBtn.addEventListener("click", () => openEditGameModal(g.id, home, away, g.scheduled_at));
      }
      const recordBtn = li.querySelector(".btn-record-result");
      if (recordBtn) {
        recordBtn.addEventListener("click", () => openRecordResultModal(g.id, g.home_team_id, g.away_team_id, home, away));
      }
      list.appendChild(li);
    });
  } catch (_) {
    list.innerHTML = "<p class='auth-message'>Could not load schedule. Add a games table in Supabase.</p>";
  }
}

function openEditGameModal(gameId, homeName, awayName, scheduledAt) {
  const gameIdInput = document.getElementById("modal-game-id");
  const matchupEl = document.getElementById("modal-edit-game-matchup");
  const dateInput = document.getElementById("modal-game-date");
  const timeInput = document.getElementById("modal-game-time");
  if (!gameIdInput || !matchupEl || !dateInput || !timeInput) return;

  gameIdInput.value = gameId;
  matchupEl.textContent = `${homeName} vs ${awayName}`;

  if (scheduledAt) {
    const d = new Date(scheduledAt);
    dateInput.value = d.toISOString().slice(0, 10);
    timeInput.value = d.toTimeString().slice(0, 5);
  } else {
    const today = new Date();
    dateInput.value = today.toISOString().slice(0, 10);
    timeInput.value = "18:00";
  }
  openModal("modal-edit-game");
}

async function handleEditGameTime(e) {
  e.preventDefault();
  const gameIdInput = document.getElementById("modal-game-id");
  const dateInput = document.getElementById("modal-game-date");
  const timeInput = document.getElementById("modal-game-time");
  if (!gameIdInput || !dateInput || !timeInput) return;

  const gameId = gameIdInput.value;
  const date = dateInput.value;
  const time = timeInput.value;
  const scheduledAt = `${date}T${time}:00`;

  const { error } = await supabase
    .from("games")
    .update({ scheduled_at: scheduledAt })
    .eq("id", gameId);

  if (error) {
    showToast(error.message, "error");
    return;
  }
  closeModal("modal-edit-game");
  showToast("Game time saved!");
  const leagueId = new URLSearchParams(window.location.search).get("id");
  if (leagueId) loadSchedule(leagueId);
}

function openRecordResultModal(gameId, homeTeamId, awayTeamId, homeName, awayName) {
  const gameIdInput = document.getElementById("modal-result-game-id");
  const matchupEl = document.getElementById("modal-record-result-matchup");
  if (!gameIdInput || !matchupEl) return;

  gameIdInput.value = gameId;
  gameIdInput.dataset.homeTeamId = homeTeamId;
  gameIdInput.dataset.awayTeamId = awayTeamId;
  matchupEl.textContent = `${homeName} vs ${awayName}`;
  openModal("modal-record-result");
}

async function handleRecordResultSubmit(winnerSide) {
  const gameIdInput = document.getElementById("modal-result-game-id");
  if (!gameIdInput) return;

  const gameId = gameIdInput.value;
  const homeTeamId = gameIdInput.dataset.homeTeamId;
  const awayTeamId = gameIdInput.dataset.awayTeamId;

  const homeScore = winnerSide === "home" ? 21 : 0;
  const awayScore = winnerSide === "away" ? 21 : 0;

  const { error: gameError } = await supabase
    .from("games")
    .update({ home_score: homeScore, away_score: awayScore })
    .eq("id", gameId);

  if (gameError) {
    showToast(gameError.message, "error");
    return;
  }

  const { data: homeTeam } = await supabase.from("teams").select("wins, losses").eq("id", homeTeamId).single();
  const { data: awayTeam } = await supabase.from("teams").select("wins, losses").eq("id", awayTeamId).single();

  const homeWins = (Number(homeTeam?.wins) || 0) + (winnerSide === "home" ? 1 : 0);
  const homeLosses = (Number(homeTeam?.losses) || 0) + (winnerSide === "home" ? 0 : 1);
  const awayWins = (Number(awayTeam?.wins) || 0) + (winnerSide === "away" ? 1 : 0);
  const awayLosses = (Number(awayTeam?.losses) || 0) + (winnerSide === "away" ? 0 : 1);

  await supabase.from("teams").update({ wins: homeWins, losses: homeLosses }).eq("id", homeTeamId);
  await supabase.from("teams").update({ wins: awayWins, losses: awayLosses }).eq("id", awayTeamId);

  closeModal("modal-record-result");
  showToast("Result recorded!");
  const leagueId = new URLSearchParams(window.location.search).get("id");
  if (leagueId) {
    loadSchedule(leagueId);
    loadLeaguePage();
  }
}

function showLeagueCreated(leagueId) {

  const popup = document.getElementById("leagueSuccess");
  if(!popup) return;

  popup.classList.add("show");

  const goBtn = document.getElementById("goToLeagueBtn");
  if(goBtn){
    goBtn.onclick = () => {
      window.location.href = `league.html?id=${leagueId}`;
    };
  }

}

function closeLeaguePopup() {
  const el = document.getElementById("leagueSuccess");
  if (el) el.classList.remove("show");
}

document.addEventListener("DOMContentLoaded", () => {

  setupSmoothScroll();
  setupScrollReveal();
  setupParallaxHero();
  setupParticles();
  setupTeamTilt();
  setupNavAnimations();

  const unlocked = localStorage.getItem("siteUnlocked");

  if(unlocked === "true"){
  
    const screen = document.getElementById("password-screen");
    const content = document.getElementById("protected-content");
  
    if(screen) screen.style.display = "none";
    if(content) content.style.display = "block";
  
  }

  setupAuth();
  setupLeagues();
  setupJoinLeague();
  loadLeagues();
  loadLeaguePage();

  if (document.querySelector(".standings")) {
    loadStandings();
  }

  startCountdown();

  setupLeagueModals();

  const deleteBtn = document.getElementById("delete-league");

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const params = new URLSearchParams(window.location.search);
      const leagueId = params.get("id");
      if (!leagueId) return;

      if (!currentLeague || !isLeagueOwner) {
        showToast("Only the league owner can delete this league.", "error");
        return;
      }

      const confirmDelete = confirm("Delete this league? All teams and data will be removed.");
      if (!confirmDelete) return;

      const { error } = await supabase
        .from("leagues")
        .delete()
        .eq("id", leagueId);

      if (error) {
        showToast(error.message, "error");
        return;
      }
      showToast("League deleted.");
      window.location.href = "app.html";
    });
  }

  const backBtn = document.getElementById("back-home");

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "app.html";
    });
  }

  const genScheduleBtn = document.getElementById("generate-schedule");
  if (genScheduleBtn) {
    genScheduleBtn.addEventListener("click", async () => {
      const params = new URLSearchParams(window.location.search);
      const leagueId = params.get("id");
      if (!leagueId) return;
      if (!isLeagueOwner) {
        showToast("Only the league owner can generate the schedule.", "error");
        return;
      }
      await generateSchedule(leagueId);
    });
  }

});




