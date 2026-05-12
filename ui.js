/**
 * Shared toast for index / dashboard (Clutch and Ball).
 */
"use strict";

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

export function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeIcsText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** UTC datetime for ICS (basic). */
function toIcsUtc(dt) {
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`;
}

/**
 * Circular team mark: logo image or initials on dark gradient (matches app cards).
 */
export function teamAvatarHtml(teamName, logoUrl, extraClass = "") {
  const name = String(teamName || "Team").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  let initials = "T";
  if (parts.length >= 2) {
    initials = `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase().slice(0, 2);
  } else if (parts[0]) {
    initials = parts[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 2) || "T";
  }
  const safeTitle = escapeAttr(name);
  const cls = `team-avatar ${extraClass}`.trim();
  const initialsInner = `<span class="team-avatar__initials">${escapeHtml(initials)}</span>`;
  if (logoUrl && /^https?:\/\//i.test(String(logoUrl).trim())) {
    const src = escapeAttr(String(logoUrl).trim());
    return `<span class="${cls} team-avatar--has-img" title="${safeTitle}">${initialsInner}<img class="team-avatar__img" src="${src}" alt="" loading="lazy" width="40" height="40" onerror="this.closest('.team-avatar')?.classList.add('team-avatar--broken')"></span>`;
  }
  return `<span class="${cls} team-avatar--initials" title="${safeTitle}">${initialsInner}</span>`;
}

/**
 * Download a single calendar event as .ics (Apple / Google / Outlook).
 */
export function downloadCalendarIcs({ filename, title, startIso, endIso, description }) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return;
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + 3600000);
  const endOk = Number.isNaN(end.getTime()) ? new Date(start.getTime() + 3600000) : end;
  const uid = `${start.getTime()}-${Math.random().toString(36).slice(2, 10)}@clutchball.local`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Clutch and Ball//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(endOk)}`,
    `SUMMARY:${escapeIcsText(title || "Event")}`,
    description ? `DESCRIPTION:${escapeIcsText(description)}` : "",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);
  const ics = lines.join("\r\n");
  const safeName = String(filename || "event")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 80);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.ics`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function showToast(text, type = "success") {
  const existing = document.getElementById("toast-message");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast-message";
  toast.className = `toast toast-${type}`;
  toast.textContent = text;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
