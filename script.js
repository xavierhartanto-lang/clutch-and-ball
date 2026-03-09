"use strict";
import supabase from "./supabase.js";

/* ============================
   PAGE LOAD
============================ */

document.addEventListener("DOMContentLoaded", () => {
    testSupabaseConnection();
    loadStandings();
    setupSmoothScroll();
    startCountdown();
    setupScrollReveal();
    setupParallaxHero();
    setupParticles();
    setupAuth();
    setupLeagues();

    setInterval(loadStandings, 60000);

    /* Hero entrance animation on initial load */
    const heroH1 = document.querySelector(".hero h1");
    const heroP = document.querySelector(".hero p");
    if (heroH1) heroH1.classList.add("animate");
    if (heroP) heroP.classList.add("animate");

    /* TEAM CARD 3D TILT */

    const cards = document.querySelectorAll(".team-card");

    cards.forEach(card => {

      card.addEventListener("mousemove", (e) => {

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
          `perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)`;
      });

    });

});


/* ============================
   SUPABASE CONNECTION TEST
============================ */

async function testSupabaseConnection() {
    try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        console.log("Supabase connection OK");
        return true;
    } catch (err) {
        console.error("Supabase connection failed:", err);
        return false;
    }
}

/* ============================
   AUTH & LEAGUES
============================ */

function showEl(id, show) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", !show);
}

function setMessage(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setupAuth() {
    const authEmail = document.getElementById("auth-email");

    function updateAuthUI(session) {
        const isSignedIn = !!session?.user;
        showEl("auth-signed-out", !isSignedIn);
        showEl("auth-signed-in", isSignedIn);
        showEl("create-league-form", isSignedIn);
        showEl("my-leagues", isSignedIn);
        if (authEmail && session?.user?.email) authEmail.textContent = session.user.email;
        if (isSignedIn) loadMyLeagues();
    }

    supabase.auth.onAuthStateChange((_event, session) => {
        updateAuthUI(session);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
        updateAuthUI(session);
    });

    document.getElementById("tab-signin")?.addEventListener("click", () => switchAuthTab("signin"));
    document.getElementById("tab-signup")?.addEventListener("click", () => switchAuthTab("signup"));

    document.querySelector(".auth-tabs")?.addEventListener("keydown", (e) => {
        const tabs = e.currentTarget.querySelectorAll("[role=tab]");
        const idx = Array.from(tabs).indexOf(document.activeElement);
        if (idx === -1) return;
        if (e.key === "ArrowRight" && idx < tabs.length - 1) {
            e.preventDefault();
            switchAuthTab("signup");
            tabs[idx + 1].focus();
        } else if (e.key === "ArrowLeft" && idx > 0) {
            e.preventDefault();
            switchAuthTab("signin");
            tabs[idx - 1].focus();
        }
    });

    function switchAuthTab(which) {
        const isSignin = which === "signin";
        const signinForm = document.getElementById("form-signin");
        const signupForm = document.getElementById("form-signup");
        const tabSignin = document.getElementById("tab-signin");
        const tabSignup = document.getElementById("tab-signup");
        signinForm?.classList.toggle("hidden", !isSignin);
        signupForm?.classList.toggle("hidden", isSignin);
        tabSignin?.classList.toggle("active", isSignin);
        tabSignup?.classList.toggle("active", !isSignin);
        tabSignin?.setAttribute("aria-selected", isSignin ? "true" : "false");
        tabSignup?.setAttribute("aria-selected", !isSignin ? "true" : "false");
        signinForm?.setAttribute("aria-hidden", isSignin ? "false" : "true");
        signupForm?.setAttribute("aria-hidden", !isSignin ? "false" : "true");
        setMessage("auth-message", "");
    }

    document.getElementById("form-signin")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setMessage("auth-message", "");
        const email = document.getElementById("signin-email").value.trim();
        const password = document.getElementById("signin-password").value;
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setMessage("auth-message", error.message);
            return;
        }
        setMessage("auth-message", "Signed in.");
    });

    document.getElementById("form-signup")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setMessage("auth-message", "");
        const email = document.getElementById("signup-email").value.trim();
        const password = document.getElementById("signup-password").value;
        
        const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password
    });
    if (error) {
            setMessage("auth-message", error.message);
            return;
        }
        setMessage("auth-message", "Account created. Signing you in...");    });

    document.getElementById("btn-signout")?.addEventListener("click", async () => {
        await supabase.auth.signOut();
        setMessage("auth-message", "");
    });
}

function setupLeagues() {
    document.getElementById("form-create-league")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        setMessage("league-form-message", "");
        const name = document.getElementById("league-name").value.trim();
        let slug = document.getElementById("league-slug").value.trim().toLowerCase().replace(/\s+/g, "-");
        if (!name || !slug) {
            setMessage("league-form-message", "Name and slug are required.");
            return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setMessage("league-form-message", "You must be signed in to create a league.");
            return;
        }
        const { data, error } = await supabase
            .from("leagues")
            .insert({ name, slug, owner_id: user.id })
            .select()
            .single();
        if (error) {
            setMessage("league-form-message", error.message || "Failed to create league.");
            return;
        }
        setMessage("league-form-message", "League created. Opening league...");

        window.location.href = `/league.html?id=${data.id}`;
    });
}

async function loadMyLeagues() {
    const list = document.getElementById("my-leagues-list");
    if (!list) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        list.innerHTML = "";
        return;
    }
    const { data, error } = await supabase
        .from("leagues")
        .select("id, name, slug, created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
    if (error) {
        list.innerHTML = "<li>Could not load leagues.</li>";
        return;
    }
    list.innerHTML = (data || []).map((l) => {
        const date = new Date(l.created_at).toLocaleDateString();
        return `<li><strong>${escapeHtml(l.name)}</strong> <span class="league-slug">/${escapeHtml(l.slug)}</span> <span class="league-date">${date}</span></li>`;
    }).join("") || "<li>No leagues yet. Create one above.</li>";
}

function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

/* ============================
   STANDINGS SYSTEM
============================ */

const sheetURL =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQpKNTrOZ3HuunOBb17pdLvjBVtXtCV89pjkdjXb6aXnXzvOJ6l_a6zqADX3kW2llt2NStNrTluadzY/pub?output=csv';

async function loadStandings() {
    const table = document.querySelector(".standings");
    if (!table) return;

    try {
        const res = await fetch(sheetURL);
        const text = await res.text();
        const rows = text.split('\n').slice(1);

        table.querySelectorAll("tr:not(:first-child)").forEach(r => r.remove());

        rows.forEach((row, i) => {

            if (!row.trim()) return;

            const cols = row.split(',');

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${i+1}</td>
                <td>${cols[0].trim()}</td>
                <td>${cols[1].trim()}</td>
                <td>${cols[2].trim()}</td>
                <td>${parseFloat(cols[3]).toFixed(3)}</td>
            `;

            if(i === 0) tr.classList.add("gold");
            else if(i === 1) tr.classList.add("silver");
            else if(i === 2) tr.classList.add("bronze");
            else if(i === rows.length - 1) tr.classList.add("last");

            table.appendChild(tr);

        });

    } catch(err) {

        console.error("Standings failed to load:", err);

    }

}


/* ============================
   PARALLAX HERO
============================ */

function setupParallaxHero() {
    const heroBg = document.querySelector(".hero-bg");
    const hero = document.querySelector(".hero");
    if (!heroBg || !hero) return;

    function onScroll() {
        if (window.innerWidth <= 768) return;
        const rect = hero.getBoundingClientRect();
        const scrolled = Math.max(0, -rect.top);
        const parallaxOffset = scrolled * 0.35;
        heroBg.style.transform = `translate3d(0, ${parallaxOffset}px, 0)`;
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
}

/* ============================
   FLOATING PARTICLES
============================ */

function setupParticles() {
    const container = document.getElementById("particles");
    if (!container) return;

    for (let i = 0; i < 10; i++) {
        const p = document.createElement("span");
        p.className = "particle";
        container.appendChild(p);
    }
}

/* ============================
   SCROLL REVEAL
============================ */

function setupScrollReveal() {
    const sections = document.querySelectorAll(".section-reveal");
    const options = {
        root: null,
        rootMargin: "0px 0px -80px 0px",
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
            }
        });
    }, options);

    sections.forEach((section) => observer.observe(section));
}

/* ============================
   SMOOTH SCROLL NAV
============================ */

function setupSmoothScroll() {
    document.querySelectorAll("nav a").forEach(link => {
        link.addEventListener("click", (e) => {
            const href = link.getAttribute("href") || "";
            if (href.startsWith("#")) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            }
        });
    });
}

function restartAnimation(selector) {
  const elements = document.querySelectorAll(selector);

  elements.forEach(el => {
    el.classList.remove("animate");
    void el.offsetWidth; // forces reflow
    el.classList.add("animate");
  });
}

document.getElementById("home-link")?.addEventListener("click", () => {
  restartAnimation(".hero h1");
  restartAnimation(".hero p");
});

const TEAM_REVEAL_DURATION_MS = 700;

document.getElementById("teams-link")?.addEventListener("click", () => {
  restartAnimation(".team-card");
  setTimeout(() => {
    document.querySelectorAll(".team-card").forEach((card) => {
      card.classList.remove("animate");
    });
  }, TEAM_REVEAL_DURATION_MS);
});

document.getElementById("rules-link")?.addEventListener("click", () => {
  restartAnimation(".hero h1");
  restartAnimation(".hero p");
});


/* ============================
   GAME COUNTDOWN
============================ */

const gameSchedule = {

    1:{ lunchHour:13,lunchMinute:4 },
    2:{ lunchHour:12,lunchMinute:45 },
    3:{ lunchHour:13,lunchMinute:45 },
    4:{ lunchHour:13,lunchMinute:4 },
    5:{ lunchHour:13,lunchMinute:4 }

};

function getNextGame(){

    const now = new Date();

    for(let i = 0; i <= 7; i++){

        const check = new Date(now);

        check.setDate(now.getDate() + i);

        const day = check.getDay();

        if(gameSchedule[day]){

            const { lunchHour, lunchMinute } = gameSchedule[day];

            const gameDate = new Date(check);

            gameDate.setHours(lunchHour);
            gameDate.setMinutes(lunchMinute + 10);
            gameDate.setSeconds(0);

            if(gameDate > now) return gameDate;

        }

    }

    return null;

}


function startCountdown(){

    const el = document.getElementById("next-game");

    if(!el) return;

    function update(){

        const next = getNextGame();

        if(!next){
            el.textContent = "No upcoming games.";
            return;
        }

        const diff = next - new Date();

        if(diff <= 0){
            el.textContent = "Game is happening now!";
            return;
        }

        const hours = Math.floor(diff/3600000);
        const minutes = Math.floor((diff%3600000)/60000);
        const seconds = Math.floor((diff%60000)/1000);

        const options = {
            weekday: "long",
            hour: "numeric",
            minute: "2-digit"
        };

        const dayTime = next.toLocaleString("en-US", options);

        el.textContent =
        `Next Game: ${dayTime} (${hours}h ${minutes}m ${seconds}s)`;

    }

    update();

    setInterval(update,1000);

}

/* ============================
   TEAM CARD 3D TILT EFFECT
============================ */

