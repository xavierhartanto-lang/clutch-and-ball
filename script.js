"use strict";
/* ============================
   PAGE LOAD
============================ */

document.addEventListener("DOMContentLoaded", () => {
    loadStandings();
    setupSmoothScroll();
    startCountdown();
    setupScrollReveal();
    setupParallaxHero();
    setupParticles();

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
   STANDINGS SYSTEM
============================ */

const sheetURL =
'https://docs.google.com/spreadsheets/d/e/2PACX-1vQpKNTrOZ3HuunOBb17pdLvjBVtXtCV89pjkdjXb6aXnXzvOJ6l_a6zqADX3kW2llt2NStNrTluadzY/pub?output=csv';

async function loadStandings() {

    try {

        const res = await fetch(sheetURL);
        const text = await res.text();

        const rows = text.split('\n').slice(1);

        const table = document.querySelector(".standings");

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

function setupSmoothScroll(){

    document.querySelectorAll("nav a").forEach(link => {

        link.addEventListener("click", e => {

            e.preventDefault();

            const target = document.querySelector(link.getAttribute("href"));

            if(target){
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
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

document.getElementById("home-link").addEventListener("click", () => {
  restartAnimation(".hero h1");
  restartAnimation(".hero p");
});

const TEAM_REVEAL_DURATION_MS = 700;

document.getElementById("teams-link").addEventListener("click", () => {
  restartAnimation(".team-card");

  // Remove .animate after animation ends so CSS no longer controls transform.
  // This restores 3D tilt (mousemove/mouseleave) which uses inline transform.
  setTimeout(() => {
    document.querySelectorAll(".team-card").forEach((card) => {
      card.classList.remove("animate");
    });
  }, TEAM_REVEAL_DURATION_MS);
});

document.getElementById("rules-link").addEventListener("click", () => {
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

