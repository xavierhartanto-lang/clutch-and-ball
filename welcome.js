import supabase from "./supabase.js";

const ENTER_APP_KEY = "cab-entering-app";
const HANDOFF_KEY = "cab-session-handoff";

function stashSessionHandoff(session) {
  if (!session?.access_token || !session?.refresh_token) return;
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }),
    );
  } catch (_) {
    /* ignore */
  }
}

async function goApp(prefetchedSession) {
  let s = prefetchedSession;
  if (!s?.access_token) {
    const { data } = await supabase.auth.getSession();
    s = data.session;
  }
  stashSessionHandoff(s);
  try {
    sessionStorage.setItem(ENTER_APP_KEY, String(Date.now()));
  } catch (_) {
    /* ignore */
  }
  window.location.assign(new URL("app.html", window.location.href).href);
}

function whenDomReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

/** Set by setupAuth so nav can switch tabs without duplicating logic.
 *  Declared before boot() so the deferred module run (DOM already ready) can't
 *  hit it in the temporal dead zone when setupAuth() runs synchronously. */
const landingAuthTab = { switchTo: null };

void (async function boot() {
  /* Do not auto-redirect on load — OAuth crawlers must see public home content. */
  whenDomReady(() => {
    setupParticles();
    setupLandingSparks();
    setupScrollReveal();
    setupCreateLeagueIntro();
    setupAuth();
    setupLandingDropdowns();
    setupLandingAuthJumpers();
    setupLandingPromoVideo();
  });
})();

function closeAllLandingDropdowns() {
  document.querySelectorAll("[data-dropdown].is-open").forEach((wrap) => {
    wrap.classList.remove("is-open");
    const btn = wrap.querySelector(".landing-dd-trigger");
    const panel = wrap.querySelector(".landing-dd-panel");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (panel) panel.hidden = true;
  });
}

function setupLandingDropdowns() {
  document.querySelectorAll("[data-dropdown]").forEach((wrap) => {
    const btn = wrap.querySelector(".landing-dd-trigger");
    const panel = wrap.querySelector(".landing-dd-panel");
    if (!btn || !panel) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = wrap.classList.contains("is-open");
      closeAllLandingDropdowns();
      if (!open) {
        wrap.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        panel.hidden = false;
      }
    });

    panel.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        closeAllLandingDropdowns();
      });
    });
  });

  document.addEventListener("click", () => {
    closeAllLandingDropdowns();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllLandingDropdowns();
  });
}

function scrollToAuthSection(whichTab) {
  const switchTo = landingAuthTab.switchTo;
  if (typeof switchTo === "function") {
    switchTo(whichTab === "signup" ? "signup" : "signin");
  }
  document.getElementById("authSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const focusId = whichTab === "signup" ? "signup-email" : "signin-email";
  window.setTimeout(() => {
    document.getElementById(focusId)?.focus();
  }, 400);
}

function setupLandingAuthJumpers() {
  document.querySelectorAll("[data-auth-jump]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAllLandingDropdowns();
      const which = el.getAttribute("data-auth-jump") === "signup" ? "signup" : "signin";
      scrollToAuthSection(which);
    });
  });
}

function setupLandingPromoVideo() {
  const video = document.getElementById("landingPromoVideo");
  if (!video) return;
  video.addEventListener("error", () => {
    const hint = document.querySelector(".landing-video-hint");
    if (hint) {
      hint.textContent =
        "Video file missing or unsupported—add assets/landing-promo.mp4 or ignore until you have a clip.";
    }
  });
}

function setupLandingSparks() {
  const canvas = document.getElementById("landing-sparks");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

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
    canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
    canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
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
      const grd = ctx.createRadialGradient(px, py, 0, px, py, d.r * 14 * (window.devicePixelRatio || 1));
      grd.addColorStop(0, `rgba(251,191,36,${d.a})`);
      grd.addColorStop(1, "rgba(251,191,36,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(px, py, d.r * 18 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  resize();
  window.addEventListener("resize", resize);
  frame();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else frame();
  });
}

function setupScrollReveal() {
  const sections = document.querySelectorAll(".section-reveal");
  const options = {
    root: null,
    rootMargin: "0px 0px -60px 0px",
    threshold: 0.08,
  };
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  }, options);

  sections.forEach((section) => {
    observer.observe(section);
    if (section.classList.contains("hidden")) return;
    const r = section.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top < vh * 0.92 && r.bottom > vh * 0.05) {
      section.classList.add("visible");
    }
  });
}

function setupParticles() {
  const container = document.getElementById("particles");
  if (!container || container.children.length > 0) return;
  for (let i = 0; i < 10; i += 1) {
    const p = document.createElement("span");
    p.className = "particle";
    container.appendChild(p);
  }
}

function setupCreateLeagueIntro() {
  document.getElementById("jumpAuthBtn")?.addEventListener("click", () => {
    scrollToAuthSection("signin");
  });
}

function setMessage(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showEl(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !show);
}

async function resolveSessionAfterSignIn() {
  const { data: { session: s1 } } = await supabase.auth.getSession();
  if (s1?.user) return s1;
  await new Promise((r) => setTimeout(r, 150));
  const { data: { session: s2 } } = await supabase.auth.getSession();
  if (s2?.user) return s2;
  return new Promise((resolve) => {
    const deadline = Date.now() + 2800;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        subscription.unsubscribe();
        resolve(session);
      }
    });
    const iv = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        clearInterval(iv);
        subscription.unsubscribe();
        resolve(session);
      } else if (Date.now() > deadline) {
        clearInterval(iv);
        subscription.unsubscribe();
        resolve(null);
      }
    }, 100);
  });
}

function setupAuth() {
  const tabSignin = document.getElementById("tab-signin");
  const tabSignup = document.getElementById("tab-signup");
  const signinForm = document.getElementById("form-signin");
  const signupForm = document.getElementById("form-signup");

  function switchAuthTab(which) {
    const isSignin = which === "signin";
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

  landingAuthTab.switchTo = switchAuthTab;

  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "signup" || hash === "signin") {
    switchAuthTab(hash);
  }

  tabSignin?.addEventListener("click", () => switchAuthTab("signin"));
  tabSignup?.addEventListener("click", () => switchAuthTab("signup"));

  document.querySelector(".auth-tabs")?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      switchAuthTab("signup");
      tabSignup?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      switchAuthTab("signin");
      tabSignin?.focus();
    }
  });

  function updateAuthUI(session) {
    const isSignedIn = !!session?.user;
    showEl("auth-signed-out", !isSignedIn);
    showEl("auth-signed-in", isSignedIn);
    const authEmail = document.getElementById("auth-email");
    if (authEmail && session?.user?.email) authEmail.textContent = session.user.email;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    updateAuthUI(session);
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    updateAuthUI(session);
  });

  signinForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("auth-message", "");
    const email = document.getElementById("signin-email")?.value.trim();
    const password = document.getElementById("signin-password")?.value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage("auth-message", error.message);
      return;
    }
    if (data?.session?.user) {
      await goApp(data.session);
      return;
    }
    const session = await resolveSessionAfterSignIn();
    if (session?.user) {
      await goApp(session);
      return;
    }
    setMessage(
      "auth-message",
      "Session did not finish saving in this browser. Try again, disable private mode, or allow site storage.",
    );
  });

  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMessage("auth-message", "");
    const email = document.getElementById("signup-email")?.value.trim();
    const password = document.getElementById("signup-password")?.value;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setMessage("auth-message", error.message);
      return;
    }
    if (data.session?.user) {
      await goApp(data.session);
      return;
    }
    const session = await resolveSessionAfterSignIn();
    if (session?.user) {
      await goApp(session);
      return;
    }
    setMessage("auth-message", "Check your email to confirm sign up, then sign in here.");
    switchAuthTab("signin");
  });

  document.getElementById("btn-signout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setMessage("auth-message", "");
  });

  document.getElementById("btn-go-app")?.addEventListener("click", async () => {
    const { data } = await supabase.auth.getSession();
    await goApp(data.session);
  });
}
