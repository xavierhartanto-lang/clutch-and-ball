/**
 * Home dashboard after sign-in (index.html).
 */
"use strict";

import { getCurrentUser } from "./auth.js";
import { fetchUserLeaguesBundle } from "./leagues.js";
import { fetchUpcomingGamesForLeagues } from "./games.js";
import supabase from "./supabase.js";
import { teamAvatarHtml, downloadCalendarIcs, escapeAttr, showToast } from "./ui.js";
import { accountDisplayName } from "./coach-shared.js";
import { formatRsvpStatus, upsertMyEventRsvp, notifyRsvpEmailSideEffect } from "./rsvp.js";

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatCountdown(gameDateStr, gameTimeStr) {
  if (!gameDateStr) return "";
  const datePart = gameDateStr.includes("T") ? gameDateStr : `${gameDateStr}T12:00:00`;
  let when = new Date(datePart);
  if (gameTimeStr && /^\d{1,2}:\d{2}/.test(gameTimeStr)) {
    const [h, m] = gameTimeStr.split(":").map((x) => parseInt(x, 10));
    when = new Date(datePart);
    if (!Number.isNaN(when.getTime()) && !Number.isNaN(h)) {
      when.setHours(h, m || 0, 0, 0);
    }
  }
  if (Number.isNaN(when.getTime())) return "";
  const diff = when - Date.now();
  if (diff <= 0) return "Starting soon";
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs >= 48) return `${Math.floor(hrs / 24)}d left`;
  if (hrs >= 1) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatStartsAt(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "TBD";
  }
}

function upcomingBucket(iso) {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return "Later";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);
  if (start < in7 && start >= today) {
    const sameDay = start.getDate() === now.getDate() && start.getMonth() === now.getMonth() && start.getFullYear() === now.getFullYear();
    return sameDay ? "Today" : "This Week";
  }
  return "Later";
}

function buildMergedSchedule(eventRows, upcomingGames, teamMap, leagueNameById, myRsvp) {
  const rsvp = myRsvp || {};
  const eventCards = eventRows.map((ev) => ({
    type: "event",
    id: ev.id,
    title: ev.title || "Event",
    kind: ev.kind || "event",
    when: ev.starts_at,
    endsAt: ev.ends_at || null,
    notes: ev.notes || "",
    teamName: ev.team_id ? teamMap[ev.team_id] || "Team" : "Personal",
    teamId: ev.team_id || null,
    leagueId: null,
    myStatus: rsvp[ev.id] || null
  }));
  const gameCards = upcomingGames.map((g) => ({
    type: "game",
    id: g.id,
    title: `${teamMap[g.team1_id] || "TBD"} vs ${teamMap[g.team2_id] || "TBD"}`,
    kind: "game",
    when: g.game_date,
    endsAt: null,
    notes: "",
    teamName: leagueNameById[g.league_id] || "League",
    teamId: null,
    leagueId: g.league_id,
    gameTime: g.game_time || "",
    myStatus: null
  }));
  return [...eventCards, ...gameCards]
    .filter((x) => x.when)
    .sort((a, b) => new Date(a.when) - new Date(b.when));
}

function paintDashboardSkeleton() {
  const statsEl = document.getElementById("dashboard-stats");
  const nextEl = document.getElementById("dashboard-next-event");
  const upcomingEl = document.getElementById("dashboard-upcoming");
  const leaguesEl = document.getElementById("dashboard-leagues-grid");
  const activityEl = document.getElementById("dashboard-activity");
  const annEl = document.getElementById("dashboard-announcements");
  const sk = (cls) => `<div class="cab-skeleton ${cls}" aria-hidden="true"></div>`;
  if (statsEl) {
    statsEl.innerHTML = `<div class="cab-skeleton-row">${sk("cab-skeleton-stat")}${sk("cab-skeleton-stat")}${sk("cab-skeleton-stat")}${sk(
      "cab-skeleton-stat"
    )}</div>`;
  }
  if (nextEl) nextEl.innerHTML = sk("cab-skeleton-card-lg");
  if (upcomingEl) {
    upcomingEl.innerHTML = `<div class="cab-skeleton-list">${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}</div>`;
  }
  if (leaguesEl) {
    leaguesEl.innerHTML = `<div class="cab-skeleton-list">${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}</div>`;
  }
  if (activityEl) {
    activityEl.innerHTML = `<div class="cab-skeleton-list">${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}</div>`;
  }
  if (annEl) {
    annEl.innerHTML = `<div class="cab-skeleton-list">${sk("cab-skeleton-line")}${sk("cab-skeleton-line")}</div>`;
  }
}

function renderAnnouncementsPanel({ pendingRsvp, leagueCount, teamCount }) {
  const el = document.getElementById("dashboard-announcements");
  if (!el) return;
  const cards = [];
  if (pendingRsvp > 0) {
    cards.push({
      k: "rsvp",
      title: "RSVPs need you",
      body: `${pendingRsvp} team event${pendingRsvp > 1 ? "s" : ""} still need your availability.`,
      href: "calendar.html",
      cta: "Open calendar"
    });
  }
  cards.push({
    k: "log",
    title: "After the buzzer",
    body: "Log scores so standings and match history stay honest for your league.",
    href: "games.html",
    cta: "Log a game"
  });
  if (!leagueCount && !teamCount) {
    cards.push({
      k: "onboard",
      title: "First touch",
      body: "Create a team or join with an invite code from your coach or commissioner.",
      href: "#cab-home-hubs-wrap",
      cta: "Open workspace"
    });
  }
  el.innerHTML = cards
    .map(
      (c) => `
    <article class="cab-dash-pulse-card" data-pulse="${escapeAttr(c.k)}">
      <p class="cab-dash-pulse-kicker">Pulse</p>
      <h4 class="cab-dash-pulse-title">${escapeHtml(c.title)}</h4>
      <p class="cab-dash-pulse-body">${escapeHtml(c.body)}</p>
      <a href="${escapeAttr(c.href)}" class="cab-dash-pulse-cta">${escapeHtml(c.cta)}</a>
    </article>`
    )
    .join("");
}

function renderActivityFeed(rows) {
  const el = document.getElementById("dashboard-activity");
  if (!el) return;
  const slice = rows.slice(0, 10);
  if (!slice.length) {
    el.innerHTML = `<p class="cab-activity-empty">No upcoming games or calendar events yet. <a href="calendar.html" class="orange-action">Plan something</a>.</p>`;
    return;
  }
  el.innerHTML = slice
    .map((row) => {
      const whenLine =
        row.type === "game"
          ? `${escapeHtml(formatStartsAt(row.when))}${row.gameTime ? ` · ${escapeHtml(row.gameTime)}` : ""}`
          : escapeHtml(formatStartsAt(row.when));
      const meta =
        row.type === "game"
          ? `League game · ${escapeHtml(row.teamName)}`
          : `${escapeHtml(row.kind)} · ${escapeHtml(row.teamName)}`;
      const title = escapeHtml(row.title);
      const href =
        row.type === "game" && row.leagueId
          ? `league.html?id=${encodeURIComponent(row.leagueId)}`
          : row.teamId
            ? `team.html?id=${encodeURIComponent(row.teamId)}`
            : "calendar.html";
      return `<a class="cab-activity-item" href="${escapeAttr(href)}">
        <span class="cab-activity-dot" aria-hidden="true"></span>
        <div>
          <p class="cab-activity-title">${title}</p>
          <p class="cab-activity-meta">${meta}</p>
        </div>
        <span class="cab-activity-when">${whenLine}</span>
      </a>`;
    })
    .join("");
}

export async function refreshDashboard() {
  const root = document.getElementById("dashboard-app");
  if (!root) return;

  const user = await getCurrentUser();
  if (!user) {
    root.classList.add("hidden");
    return;
  }

  root.classList.remove("hidden");

  const loading = document.getElementById("dashboard-loading");
  const statsEl = document.getElementById("dashboard-stats");
  const nextEl = document.getElementById("dashboard-next-event");
  const upcomingEl = document.getElementById("dashboard-upcoming");
  const leaguesEl = document.getElementById("dashboard-leagues-grid");
  const notifyEl = document.getElementById("dashboard-notifications");
  const activityEl = document.getElementById("dashboard-activity");
  const annEl = document.getElementById("dashboard-announcements");

  if (loading) loading.classList.remove("hidden");
  if (statsEl) statsEl.innerHTML = "";
  if (nextEl) nextEl.innerHTML = "";
  if (upcomingEl) upcomingEl.innerHTML = "";
  if (leaguesEl) leaguesEl.innerHTML = "";
  if (activityEl) activityEl.innerHTML = "";
  if (annEl) annEl.innerHTML = "";
  if (notifyEl) {
    notifyEl.innerHTML = "";
    notifyEl.classList.add("hidden");
  }

  try {
    paintDashboardSkeleton();
    const dashHeading = document.getElementById("dashboard-heading");
    const dashSub = document.getElementById("dashboard-subline");
    const display = accountDisplayName(user).trim();
    if (dashHeading) {
      if (display) {
        const first = display.split(/\s+/)[0] || display;
        dashHeading.textContent = `Welcome back, ${first}`;
      } else {
        dashHeading.textContent = "Command center";
      }
    }
    if (dashSub) {
      dashSub.textContent = display
        ? "Leagues, teams, schedule, and RSVPs — prioritized for game week."
        : "Sign in to sync your leagues, teams, and calendar.";
    }

    const bundle = await fetchUserLeaguesBundle(user.id);
    const allLeagues = [...bundle.owned, ...bundle.member];
    const leagueIds = allLeagues.map((l) => l.id);
    const leagueNameById = {};
    allLeagues.forEach((l) => {
      leagueNameById[l.id] = l.name;
    });

    let teams = [];
    if (leagueIds.length) {
      let { data: tdata, error: terr } = await supabase
        .from("teams")
        .select("id, name, league_id, wins, losses, logo_url")
        .in("league_id", leagueIds);
      if (terr && /logo_url|schema cache|PGRST204|42703/i.test(String(terr.message || ""))) {
        const retry = await supabase
          .from("teams")
          .select("id, name, league_id, wins, losses")
          .in("league_id", leagueIds);
        tdata = retry.data;
      }
      teams = tdata || [];
    }

    let totalW = 0;
    let totalL = 0;
    teams.forEach((t) => {
      totalW += Number(t.wins) || 0;
      totalL += Number(t.losses) || 0;
    });
    const teamsByLeague = {};
    teams.forEach((t) => {
      const lid = t.league_id;
      if (lid) teamsByLeague[lid] = (teamsByLeague[lid] || 0) + 1;
    });
    const pct = totalW + totalL > 0 ? ((totalW / (totalW + totalL)) * 100).toFixed(1) : "—";

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="dashboard-stat-card">
          <span class="dashboard-stat-value">${allLeagues.length}</span>
          <span class="dashboard-stat-label">Leagues</span>
        </div>
        <div class="dashboard-stat-card">
          <span class="dashboard-stat-value">${teams.length}</span>
          <span class="dashboard-stat-label">Teams</span>
        </div>
        <div class="dashboard-stat-card">
          <span class="dashboard-stat-value">${totalW}–${totalL}</span>
          <span class="dashboard-stat-label">League W–L (all teams)</span>
        </div>
        <div class="dashboard-stat-card">
          <span class="dashboard-stat-value">${pct === "—" ? "—" : pct + "%"}</span>
          <span class="dashboard-stat-label">Combined win %</span>
        </div>`;
    }

    const upcomingGames = await fetchUpcomingGamesForLeagues(leagueIds, 6);
    const teamMap = {};
    const teamLogoById = {};
    teams.forEach((t) => {
      teamMap[t.id] = t.name;
      teamLogoById[t.id] = t.logo_url || null;
    });

    const teamIds = teams.map((t) => t.id);
    let eventRows = [];
    const nowIso = new Date().toISOString();
    let eventsQuery = supabase
      .from("calendar_events")
      .select("id, team_id, title, kind, starts_at, ends_at, notes")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(16);
    if (teamIds.length) {
      eventsQuery = eventsQuery.or(`user_id.eq.${user.id},team_id.in.(${teamIds.join(",")})`);
    } else {
      eventsQuery = eventsQuery.eq("user_id", user.id);
    }
    const { data: eventsData } = await eventsQuery;
    eventRows = eventsData || [];
    const eventIds = eventRows.map((e) => e.id);
    let myRsvp = {};
    if (eventIds.length) {
      const { data: rsvpRows } = await supabase
        .from("calendar_event_rsvps")
        .select("event_id, status")
        .in("event_id", eventIds)
        .eq("user_id", user.id);
      myRsvp = Object.fromEntries((rsvpRows || []).map((r) => [r.event_id, r.status]));
    }

    const nextEvent = eventRows[0] || null;
    if (nextEl) {
      if (!nextEvent) {
        nextEl.innerHTML = `<p class="dashboard-empty">No upcoming events yet. <a href="calendar.html" class="orange-action">Open Calendar</a> to add practices or games.</p>`;
      } else {
        const teamName = nextEvent.team_id ? (teamMap[nextEvent.team_id] || "Team event") : "Personal";
        const nextAv = nextEvent.team_id
          ? teamAvatarHtml(teamName, teamLogoById[nextEvent.team_id] || null, "team-avatar--sm")
          : "";
        const mine = myRsvp[nextEvent.id] || null;
        const rsvpActions = nextEvent.team_id
          ? `<p class="dashboard-next-rsvp-hint">Are you coming?</p><div class="dashboard-rsvp-inline" data-event-id="${nextEvent.id}">
               <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "available" ? "is-active" : ""}" data-status="available">Available</button>
               <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "late" ? "is-active" : ""}" data-status="late">Late</button>
               <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "out" ? "is-active" : ""}" data-status="out">Out</button>
             </div>`
          : "";
        const icsBtn = `
            <button type="button" class="auth-submit auth-submit-secondary dashboard-ics-btn"
              data-ics-title="${escapeAttr(nextEvent.title || "Event")}"
              data-ics-start="${escapeAttr(nextEvent.starts_at)}"
              data-ics-end="${escapeAttr(nextEvent.ends_at || "")}"
              data-ics-notes="${escapeAttr(nextEvent.notes || "")}"
            >Add to calendar (.ics)</button>`;
        nextEl.innerHTML = `
          <article class="dashboard-next-card" data-event-id="${nextEvent.id}">
            <div class="dashboard-next-head">
              ${nextAv}
              <div class="dashboard-next-head-main">
                <div class="dashboard-upcoming-meta">
                  <span class="dashboard-upcoming-league">${escapeHtml(teamName)}</span>
                  <span class="dashboard-next-kind">${escapeHtml(nextEvent.kind || "event")}</span>
                </div>
                <h4 class="dashboard-next-title">${escapeHtml(nextEvent.title || "Event")}</h4>
                <p class="dashboard-next-when">${escapeHtml(formatStartsAt(nextEvent.starts_at))}</p>
                ${
                  nextEvent.team_id
                    ? `<p class="dashboard-next-status">Your RSVP: <strong>${escapeHtml(formatRsvpStatus(mine))}</strong></p>`
                    : ""
                }
              </div>
            </div>
            <div class="dashboard-next-toolbar">
              <a href="calendar.html" class="orange-action">Open calendar</a>
              ${icsBtn}
            </div>
            ${rsvpActions}
          </article>`;
      }
    }

    const mergedFull = buildMergedSchedule(eventRows, upcomingGames, teamMap, leagueNameById, myRsvp);
    const merged = mergedFull.slice(0, 10);
    renderActivityFeed(mergedFull);

    if (upcomingEl) {
      if (!merged.length) {
        upcomingEl.innerHTML = `<p class="dashboard-empty">No upcoming events or games yet.</p>`;
      } else {
        const bucketOrder = ["Today", "This Week", "Later"];
        const grouped = Object.fromEntries(bucketOrder.map((k) => [k, []]));
        merged.forEach((row) => grouped[upcomingBucket(row.when)].push(row));
        upcomingEl.innerHTML = bucketOrder
          .filter((k) => grouped[k].length)
          .map((bucket) => {
            const rowsHtml = grouped[bucket]
              .map((row) => {
                if (row.type === "game") {
                  const cd = formatCountdown(row.when, row.gameTime);
                  return `<div class="dashboard-upcoming-card">
                    <div class="dashboard-upcoming-meta">
                      <span class="dashboard-upcoming-league">${escapeHtml(row.teamName)}</span>
                      ${cd ? `<span class="dashboard-upcoming-countdown">${escapeHtml(cd)}</span>` : ""}
                    </div>
                    <div class="dashboard-upcoming-match">${escapeHtml(row.title)}</div>
                    <div class="dashboard-upcoming-when">${escapeHtml(formatStartsAt(row.when))}${row.gameTime ? ` · ${escapeHtml(row.gameTime)}` : ""}</div>
                    <a class="orange-action dashboard-open-league" href="league.html?id=${row.leagueId}">Open league</a>
                  </div>`;
                }
                const mine = row.myStatus;
                const rowAv = row.teamId
                  ? teamAvatarHtml(row.teamName, teamLogoById[row.teamId] || null, "team-avatar--xs")
                  : "";
                const evIcs = `<button type="button" class="auth-submit auth-submit-secondary dashboard-ics-btn"
                  data-ics-title="${escapeAttr(row.title)}"
                  data-ics-start="${escapeAttr(row.when)}"
                  data-ics-end="${escapeAttr(row.endsAt || "")}"
                  data-ics-notes="${escapeAttr(row.notes || "")}"
                >Add .ics</button>`;
                return `<div class="dashboard-upcoming-card" data-event-id="${row.id}">
                  <div class="dashboard-upcoming-card-top">
                    ${rowAv}
                    <div class="dashboard-upcoming-card-text">
                      <div class="dashboard-upcoming-meta">
                        <span class="dashboard-upcoming-league">${escapeHtml(row.teamName)}</span>
                        <span class="dashboard-upcoming-countdown">${escapeHtml(row.kind)}</span>
                      </div>
                      <div class="dashboard-upcoming-match">${escapeHtml(row.title)}</div>
                      <div class="dashboard-upcoming-when">${escapeHtml(formatStartsAt(row.when))}</div>
                      <div class="dashboard-upcoming-toolbar">${evIcs}</div>
                    </div>
                  </div>
                  ${
                    row.teamId
                      ? `<p class="dashboard-next-rsvp-hint">Are you coming?</p><div class="dashboard-rsvp-inline" data-event-id="${row.id}">
                           <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "available" ? "is-active" : ""}" data-status="available">Available</button>
                           <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "late" ? "is-active" : ""}" data-status="late">Late</button>
                           <button type="button" class="auth-submit auth-submit-secondary dashboard-rsvp-btn ${mine === "out" ? "is-active" : ""}" data-status="out">Out</button>
                         </div>`
                      : ""
                  }
                </div>`;
              })
              .join("");
            return `<div class="dashboard-upcoming-group"><h4 class="dashboard-upcoming-group-title">${bucket}</h4><div class="dashboard-upcoming-row">${rowsHtml}</div></div>`;
          })
          .join("");
      }
    }

    if (leaguesEl) {
      if (!allLeagues.length) {
        leaguesEl.innerHTML = `<p class="dashboard-empty">You’re not in any leagues yet. Create one or join with an invite code below.</p>`;
      } else {
        leaguesEl.innerHTML = allLeagues
          .map((l) => {
            const isOwner = l.owner_id === user.id;
            const badge = isOwner ? "Owner" : "Member";
            const sport = l.sport ? String(l.sport) : "League";
            const tc = teamsByLeague[l.id] || 0;
            const teamLine = `${tc} team${tc === 1 ? "" : "s"}`;
            return `
              <article class="dashboard-league-card">
                <div class="dashboard-league-card-head">
                  <h3 class="dashboard-league-name">${escapeHtml(l.name)}</h3>
                  <span class="dashboard-league-badge">${badge}</span>
                </div>
                <p class="dashboard-league-meta">${escapeHtml(sport)} · ${escapeHtml(teamLine)}${l.invite_code && isOwner ? ` · Code <code class="dashboard-code">${escapeHtml(l.invite_code)}</code>` : ""}</p>
                <a href="league.html?id=${l.id}" class="auth-submit dashboard-league-open">Open league</a>
              </article>`;
          })
          .join("");
      }
    }

    const pendingRsvp = eventRows.filter((ev) => ev.team_id && !myRsvp[ev.id]).length;
    renderAnnouncementsPanel({
      pendingRsvp,
      leagueCount: allLeagues.length,
      teamCount: teams.length
    });

    if (notifyEl) {
      const needsRsvp = pendingRsvp;
      const soon = eventRows.filter((ev) => {
        const diff = new Date(ev.starts_at) - Date.now();
        return diff > 0 && diff <= 86400000;
      }).length;
      if (needsRsvp || soon) {
        notifyEl.classList.remove("hidden");
        notifyEl.innerHTML = `
          <div class="dashboard-notify-inner">
            <strong>Heads up</strong>
            <p>${needsRsvp ? `${needsRsvp} team event${needsRsvp > 1 ? "s" : ""} still need your RSVP.` : ""}${needsRsvp && soon ? " " : ""}${soon ? `${soon} event${soon > 1 ? "s are" : " is"} within 24h.` : ""}</p>
          </div>`;
      }
    }

    if (!root.dataset.rsvpBound) {
      root.dataset.rsvpBound = "1";
      root.addEventListener("click", async (e) => {
        const icsBtn = e.target.closest(".dashboard-ics-btn");
        if (icsBtn?.dataset.icsStart) {
          downloadCalendarIcs({
            filename: (icsBtn.dataset.icsTitle || "event").replace(/\s+/g, "_").slice(0, 72),
            title: icsBtn.dataset.icsTitle || "Event",
            startIso: icsBtn.dataset.icsStart,
            endIso: icsBtn.dataset.icsEnd || undefined,
            description: icsBtn.dataset.icsNotes || ""
          });
          return;
        }
        const btn = e.target.closest(".dashboard-rsvp-btn");
        if (!btn) return;
        const wrap = btn.closest("[data-event-id]");
        const eventId = wrap?.dataset.eventId;
        const status = btn.dataset.status;
        if (!eventId || !status || !user?.id) return;
        const rowBtns = wrap?.querySelectorAll(".dashboard-rsvp-btn");
        rowBtns?.forEach((b) => {
          b.disabled = true;
        });
        try {
          const { error } = await upsertMyEventRsvp({ eventId, userId: user.id, status });
          if (error) {
            console.error(error);
            showToast(error.message || "Could not save RSVP", "error");
            rowBtns?.forEach((b) => {
              b.disabled = false;
            });
            return;
          }
          await notifyRsvpEmailSideEffect({ event_id: eventId, user_id: user.id, status });
          showToast(`RSVP saved · ${formatRsvpStatus(status)}`);
          await refreshDashboard();
        } catch (err) {
          console.error(err);
          showToast(err?.message || "Could not save RSVP", "error");
          rowBtns?.forEach((b) => {
            b.disabled = false;
          });
        }
      });
    }
  } catch (e) {
    console.error(e);
    if (statsEl) statsEl.innerHTML = `<p class="auth-message">Could not load dashboard.</p>`;
    if (nextEl) nextEl.innerHTML = "";
    if (upcomingEl) upcomingEl.innerHTML = "";
    if (leaguesEl) leaguesEl.innerHTML = "";
    if (activityEl) activityEl.innerHTML = "";
    const annOnErr = document.getElementById("dashboard-announcements");
    if (annOnErr) annOnErr.innerHTML = "";
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}
