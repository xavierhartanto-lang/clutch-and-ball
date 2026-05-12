/**
 * Top-right profile avatar + dropdown (signup type is fixed — no role switching).
 */
"use strict";

import supabase from "./supabase.js";
import { getSignupLabel, isCoachSignup } from "./coach-shared.js";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function avatarSvg() {
  return `<span class="profile-avatar-default" aria-hidden="true">
    <svg class="profile-avatar-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
      <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/>
    </svg>
  </span>`;
}

function renderSignedOut(mount) {
  mount.innerHTML = `
    <div class="profile-menu profile-menu--signed-out">
      <a href="welcome.html" class="profile-signin-link">Sign in</a>
    </div>`;
}

function bindDropdown(mount) {
  const trigger = mount.querySelector(".profile-menu-trigger");
  const dropdown = mount.querySelector(".profile-menu-dropdown");
  const wrap = mount.querySelector("[data-profile-menu]");

  function close() {
    dropdown?.classList.add("hidden");
    trigger?.setAttribute("aria-expanded", "false");
  }

  function open() {
    dropdown?.classList.remove("hidden");
    trigger?.setAttribute("aria-expanded", "true");
  }

  function toggle() {
    if (dropdown?.classList.contains("hidden")) open();
    else close();
  }

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  document.getElementById("profile-menu-signout")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "welcome.html";
  });

  document.addEventListener("click", (e) => {
    if (wrap && !wrap.contains(e.target)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function renderSignedInMenu(mount, user) {
  const email = user.email || "";
  const label = getSignupLabel(user);
  const coachNote = isCoachSignup(user)
    ? `<p class="profile-menu-hint">Team owners manage squads and invite codes from Home.</p>`
    : "";

  mount.innerHTML = `
    <div class="profile-menu" data-profile-menu>
      <button type="button" class="profile-menu-trigger" aria-label="Account menu" aria-expanded="false" aria-haspopup="true">
        ${avatarSvg()}
      </button>
      <div class="profile-menu-dropdown hidden" id="profile-menu-dropdown" role="menu">
        <div class="profile-menu-user">
          <span class="profile-menu-email">${escapeHtml(email)}</span>
          <span class="profile-menu-role-line profile-menu-role-static">Account: ${escapeHtml(label)}</span>
        </div>
        ${coachNote}
        <a href="account.html" class="profile-menu-item" role="menuitem">Account Settings</a>
        <button type="button" class="profile-menu-item profile-menu-item--danger" id="profile-menu-signout" role="menuitem">Sign Out</button>
      </div>
    </div>`;
  bindDropdown(mount);
}

export async function initProfileMenu() {
  const mount = document.getElementById("profile-menu-mount");
  if (!mount) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    renderSignedOut(mount);
    return;
  }

  renderSignedInMenu(mount, user);
}

document.addEventListener("DOMContentLoaded", () => {
  initProfileMenu();
});
