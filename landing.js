/* Clutch & Ball — public home page interactions.
   Intentionally dependency-free (no Supabase / no auth) so the public
   home page stays fast and OAuth crawlers see static content with no redirects. */

(function () {
  "use strict";

  function whenDomReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  /* ---------- Nav dropdowns (Clubs & leagues, Coaches & families) ---------- */
  function closeAllDropdowns() {
    document.querySelectorAll("[data-dropdown].is-open").forEach((wrap) => {
      wrap.classList.remove("is-open");
      const btn = wrap.querySelector(".landing-dd-trigger");
      const panel = wrap.querySelector(".landing-dd-panel");
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
    });
  }

  function setupDropdowns() {
    const wraps = document.querySelectorAll("[data-dropdown]");
    if (!wraps.length) return;

    wraps.forEach((wrap) => {
      const btn = wrap.querySelector(".landing-dd-trigger");
      const panel = wrap.querySelector(".landing-dd-panel");
      if (!btn || !panel) return;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = wrap.classList.contains("is-open");
        closeAllDropdowns();
        if (!isOpen) {
          wrap.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
          panel.hidden = false;
        }
      });

      // Clicking a link inside should close the menu.
      panel.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", () => closeAllDropdowns());
      });
    });

    // Click outside / Escape closes any open menu.
    document.addEventListener("click", () => closeAllDropdowns());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllDropdowns();
    });
  }

  /* ---------- Ambient particles ---------- */
  function setupParticles() {
    const container = document.getElementById("particles");
    if (!container || container.children.length > 0) return;
    for (let i = 0; i < 10; i += 1) {
      const p = document.createElement("span");
      p.className = "particle";
      container.appendChild(p);
    }
  }

  /* ---------- Floating sparks canvas ---------- */
  function setupSparks() {
    const canvas = document.getElementById("landing-sparks");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const dots = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.3 + Math.random() * 1.2,
      vx: (Math.random() - 0.5) * 0.00035,
      vy: (Math.random() - 0.5) * 0.00035,
      a: 0.15 + Math.random() * 0.35,
    }));

    let raf = 0;

    function resize() {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    }

    function frame() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > 1) d.vx *= -1;
        if (d.y < 0 || d.y > 1) d.vy *= -1;
        const px = d.x * w;
        const py = d.y * h;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, d.r * 14 * dpr);
        grd.addColorStop(0, `rgba(251,191,36,${d.a})`);
        grd.addColorStop(1, "rgba(251,191,36,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, d.r * 18 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    frame();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else frame();
    });
  }

  /* ---------- Scroll reveal (content is visible by default; this just animates it in) ---------- */
  function setupScrollReveal() {
    const sections = document.querySelectorAll(".section-reveal");
    if (!sections.length || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      },
      { root: null, rootMargin: "0px 0px -60px 0px", threshold: 0.08 }
    );

    sections.forEach((section) => observer.observe(section));
  }

  /* ---------- Promo video graceful fallback ---------- */
  function setupPromoVideo() {
    const video = document.getElementById("landingPromoVideo");
    if (!video) return;
    video.addEventListener("error", () => {
      const hint = document.querySelector(".landing-video-hint");
      if (hint) {
        hint.textContent =
          "Video file missing or unsupported — add assets/landing-promo.mp4 when you have a clip.";
      }
    });
  }

  whenDomReady(() => {
    setupDropdowns();
    setupParticles();
    setupSparks();
    setupScrollReveal();
    setupPromoVideo();
  });
})();
