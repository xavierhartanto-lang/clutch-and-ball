/**
 * Account — profile, showcase (players/parents), stats
 */
"use strict";

import supabase, { edgeFunctionUrl, supabaseAnonKey } from "./supabase.js";
import { hasPlayerHubAccess, rosterDisplayName } from "./coach-shared.js";
import { syncPlayerRosterNames } from "./player-teams-api.js";

function msg(el, text) {
  if (!el) return;
  el.textContent = text || "";
  el.setAttribute("aria-live", "polite");
}

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  const signedOut = document.getElementById("account-signed-out");
  const signedIn = document.getElementById("account-signed-in");
  const messageEl = document.getElementById("account-message");

  if (!user) {
    if (signedOut) signedOut.classList.remove("hidden");
    if (signedIn) signedIn.classList.add("hidden");
    return;
  }

  if (signedOut) signedOut.classList.add("hidden");
  if (signedIn) signedIn.classList.remove("hidden");

  const fullNameInput = document.getElementById("account-full-name");
  const birthdayInput = document.getElementById("account-birthday");
  const phoneInput = document.getElementById("account-phone");
  const emailEl = document.getElementById("account-email");
  const saveNameBtn = document.getElementById("account-save-name");
  const saveProfileBtn = document.getElementById("account-save-profile");
  const signoutBtn = document.getElementById("account-signout");
  const showcaseSection = document.getElementById("account-athlete-showcase");
  const bioInput = document.getElementById("account-bio");
  const highlightsInput = document.getElementById("account-highlights");
  const saveShowcaseBtn = document.getElementById("account-save-showcase");
  const deleteStartBtn = document.getElementById("account-delete-start");
  const deleteConfirmPanel = document.getElementById("account-delete-confirm-panel");
  const deleteCancelBtn = document.getElementById("account-delete-cancel");
  const deleteConfirmBtn = document.getElementById("account-delete-confirm");
  const deleteMsgEl = document.getElementById("account-delete-message");

  if (emailEl) emailEl.textContent = user.email || "—";

  if (hasPlayerHubAccess(user) && showcaseSection) {
    showcaseSection.classList.remove("hidden");
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("full_name, birthday, phone, bio, highlight_reel_urls")
    .eq("id", user.id)
    .maybeSingle();

  const nameFromProfile = prof?.full_name && String(prof.full_name).trim();
  if (fullNameInput) {
    fullNameInput.value = nameFromProfile || user.user_metadata?.full_name || "";
  }
  if (birthdayInput && prof?.birthday) birthdayInput.value = prof.birthday;
  if (phoneInput) phoneInput.value = prof?.phone || "";
  if (bioInput) bioInput.value = prof?.bio || "";
  if (highlightsInput) highlightsInput.value = prof?.highlight_reel_urls || "";

  async function saveFullNameOnly() {
    const value = fullNameInput?.value?.trim() ?? "";
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) return;
    const { error } = await supabase.auth.updateUser({
      data: { ...u.user_metadata, full_name: value || null }
    });
    if (error) {
      msg(messageEl, error.message);
      return;
    }
    const { data: { user: uFresh } } = await supabase.auth.getUser();
    if (uFresh) {
      const { error: syncErr } = await syncPlayerRosterNames(uFresh.id, rosterDisplayName(uFresh));
      if (syncErr && !/players|relation|does not exist/i.test(syncErr.message || "")) {
        msg(messageEl, syncErr.message);
        return;
      }
    }
    msg(messageEl, "Name saved.");
    setTimeout(() => msg(messageEl, ""), 2500);
  }

  async function saveProfileBlock() {
    const value = fullNameInput?.value?.trim() ?? "";
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) return;

    const { error: uerr } = await supabase.auth.updateUser({
      data: { ...u.user_metadata, full_name: value || null }
    });
    if (uerr) {
      msg(messageEl, uerr.message);
      return;
    }

    const bday = birthdayInput?.value || null;
    const phone = phoneInput?.value?.trim() || null;

    const row = {
      id: u.id,
      full_name: value || u.user_metadata?.full_name || u.email?.split("@")[0] || "User",
      birthday: bday || null,
      phone,
      email: u.email || null,
      updated_at: new Date().toISOString()
    };
    if (hasPlayerHubAccess(u)) {
      row.bio = bioInput?.value?.trim() || null;
      row.highlight_reel_urls = highlightsInput?.value?.trim() || null;
    }

    const { error: perr } = await supabase.from("profiles").upsert(row, { onConflict: "id" });

    if (perr && !/profiles|relation|does not exist/i.test(perr.message || "")) {
      msg(messageEl, perr.message);
      return;
    }

    const { data: { user: uFresh } } = await supabase.auth.getUser();
    if (uFresh) {
      const { error: syncErr } = await syncPlayerRosterNames(uFresh.id, rosterDisplayName(uFresh));
      if (syncErr && !/players|relation|does not exist/i.test(syncErr.message || "")) {
        msg(messageEl, syncErr.message);
        return;
      }
    }

    msg(messageEl, "Profile saved.");
    setTimeout(() => msg(messageEl, ""), 2500);
  }

  async function saveShowcaseOnly() {
    const { data: { user: u } } = await supabase.auth.getUser();
    if (!u) return;

    const showcaseName =
      (fullNameInput?.value?.trim()) ||
      u.user_metadata?.full_name ||
      u.email?.split("@")[0] ||
      "User";
    const { error: perr } = await supabase.from("profiles").upsert(
      {
        id: u.id,
        full_name: showcaseName,
        bio: bioInput?.value?.trim() || null,
        highlight_reel_urls: highlightsInput?.value?.trim() || null,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    );

    if (perr && !/profiles|relation|does not exist/i.test(perr.message || "")) {
      msg(messageEl, perr.message);
      return;
    }

    const { error: syncErr } = await syncPlayerRosterNames(u.id, showcaseName);
    if (syncErr && !/players|relation|does not exist/i.test(syncErr.message || "")) {
      msg(messageEl, syncErr.message);
      return;
    }

    msg(messageEl, "Showcase saved.");
    setTimeout(() => msg(messageEl, ""), 2500);
  }

  if (saveNameBtn) saveNameBtn.addEventListener("click", saveFullNameOnly);
  if (saveProfileBtn) saveProfileBtn.addEventListener("click", saveProfileBlock);
  if (saveShowcaseBtn && hasPlayerHubAccess(user)) {
    saveShowcaseBtn.addEventListener("click", saveShowcaseOnly);
  }

  if (signoutBtn) {
    signoutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.href = "index.html";
    });
  }

  function msgDelete(text, isError = false) {
    if (!deleteMsgEl) return;
    deleteMsgEl.textContent = text || "";
    deleteMsgEl.classList.toggle("auth-message--error", !!isError);
  }

  function showDeleteConfirmPanel(show) {
    if (!deleteConfirmPanel) return;
    deleteConfirmPanel.classList.toggle("hidden", !show);
    deleteConfirmPanel.setAttribute("aria-hidden", show ? "false" : "true");
  }

  if (deleteStartBtn) {
    deleteStartBtn.addEventListener("click", () => {
      msgDelete("");
      showDeleteConfirmPanel(true);
      deleteConfirmBtn?.focus();
    });
  }

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener("click", () => {
      msgDelete("");
      showDeleteConfirmPanel(false);
    });
  }

  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener("click", async () => {
      msgDelete("");
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        msgDelete("You are not signed in.", true);
        return;
      }

      deleteConfirmBtn.disabled = true;
      let res;
      try {
        res = await fetch(edgeFunctionUrl("delete-account"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: supabaseAnonKey,
            "Content-Type": "application/json"
          }
        });
      } catch (e) {
        deleteConfirmBtn.disabled = false;
        msgDelete(e?.message || "Network error.", true);
        return;
      }

      let body = {};
      try {
        body = await res.json();
      } catch {
        /* ignore */
      }

      if (!res.ok) {
        deleteConfirmBtn.disabled = false;
        const hint =
          res.status === 404
            ? "Delete service not deployed. Run: supabase functions deploy delete-account"
            : body.error || `Request failed (${res.status}).`;
        msgDelete(hint, true);
        return;
      }

      await supabase.auth.signOut();
      window.location.href = "index.html?deleted=1";
    });
  }

  const [leaguesRes, messagesRes, membersRes] = await Promise.all([
    supabase.from("leagues").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
    supabase.from("league_messages").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("league_members").select("id", { count: "exact", head: true }).eq("user_id", user.id)
  ]);

  const statLeagues = document.getElementById("stat-leagues");
  const statMessages = document.getElementById("stat-messages");
  const statJoined = document.getElementById("stat-leagues-joined");

  if (statLeagues) statLeagues.textContent = leaguesRes.count ?? 0;
  if (statMessages) statMessages.textContent = messagesRes.count ?? 0;
  if (statJoined) statJoined.textContent = membersRes.count ?? 0;

}

document.addEventListener("DOMContentLoaded", init);
