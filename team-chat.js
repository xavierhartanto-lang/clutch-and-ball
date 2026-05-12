/**
 * Team chat (team page) — messages for coaches + roster members.
 */
"use strict";

import supabase from "./supabase.js";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function initTeamChat({
  teamId,
  getSessionUser,
  coachUserId = null,
  assistantCoachUserId = null,
  canModerate = false
}) {
  const logEl = document.getElementById("team-chat-log");
  const form = document.getElementById("team-chat-form");
  const input = document.getElementById("team-chat-input");
  const msgEl = document.getElementById("team-chat-msg");
  const section = document.getElementById("team-chat-section");

  if (!logEl || !form || !input || !teamId || !section) return;

  let channel = null;

  async function loadMessages() {
    const me = await getSessionUser();
    if (!me) return;

    const { data, error } = await supabase
      .from("team_messages")
      .select("id, body, created_at, user_id")
      .eq("team_id", teamId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      if (msgEl) msgEl.textContent = error.message.includes("team_messages") || error.message.includes("does not exist")
        ? "Run the latest database migration to enable team chat."
        : error.message;
      return;
    }

    logEl.innerHTML = "";
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    let nameMap = {};
    if (ids.length) {
      const { data: names } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      nameMap = Object.fromEntries((names || []).map((r) => [r.id, (r.full_name || "").trim()]));
    }

    rows.forEach((row) => {
      const roleClass =
        row.user_id === coachUserId
          ? "team-chat-author--coach"
          : row.user_id === assistantCoachUserId
            ? "team-chat-author--assistant"
            : "team-chat-author--member";
      const roleLabel =
        row.user_id === coachUserId ? "Coach" : row.user_id === assistantCoachUserId ? "Assistant Coach" : "Member";
      const fallbackId = row.user_id ? ` (${String(row.user_id).slice(0, 6)})` : "";
      const displayName = nameMap[row.user_id] || `${roleLabel}${fallbackId}`;
      const canDelete = canModerate || row.user_id === me.id;
      const li = document.createElement("div");
      li.className = "team-chat-msg";
      li.innerHTML = `
        <div class="team-chat-msg-top">
          <span class="team-chat-author ${roleClass}">${escapeHtml(displayName)}</span>
          <span class="team-chat-msg-meta">${escapeHtml(formatTime(row.created_at))}</span>
        </div>
        <p class="team-chat-msg-body">${escapeHtml(row.body)}</p>
        ${canDelete ? `<button type="button" class="team-chat-delete-btn" data-message-id="${row.id}">Delete</button>` : ""}`;
      logEl.appendChild(li);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = await getSessionUser();
    if (!user) return;
    const body = input.value.trim();
    if (!body) return;

    const { error } = await supabase.from("team_messages").insert({
      team_id: teamId,
      user_id: user.id,
      body
    });

    if (error) {
      if (msgEl) msgEl.textContent = error.message;
      return;
    }
    input.value = "";
    if (msgEl) msgEl.textContent = "";
    await loadMessages();
  });

  logEl.addEventListener("click", async (e) => {
    const btn = e.target.closest(".team-chat-delete-btn");
    if (!btn?.dataset.messageId) return;
    const id = btn.dataset.messageId;
    const me = await getSessionUser();
    if (!me) return;
    const { error } = await supabase.from("team_messages").delete().eq("id", id);
    if (error) {
      if (msgEl) msgEl.textContent = error.message;
      return;
    }
    if (msgEl) msgEl.textContent = "";
    await loadMessages();
  });

  loadMessages();

  const poll = window.setInterval(loadMessages, 6000);

  try {
    channel = supabase
      .channel(`team-chat:${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`
        },
        () => {
          loadMessages();
        }
      )
      .subscribe();
  } catch {
    /* Realtime optional */
  }

  window.addEventListener("beforeunload", () => {
    window.clearInterval(poll);
    if (channel) supabase.removeChannel(channel);
  });
}
