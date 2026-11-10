// Reads both lineups for every game this week from ESPN into data/lineups.json, for the
// matchup details sheet (tap a game on the Scoreboard). The page only downloads this file
// when someone opens a game, so it never slows the main page down.
//
// Each player: lineup slot, name, position, NFL team and opponent, kickoff, the NFL game's
// state (pre / in / post / bye) and clock, fantasy points so far and projection.
// Game states come from ESPN's public NFL scoreboard; if that can't be reached, they're
// estimated from kickoff times. If the fantasy data can't be read, the live site's last
// good copy is kept.
import fs from "node:fs";
import { holdingLastWeek } from "./show-week.mjs";

const OUT = "data/lineups.json";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const { id: LEAGUE_ID, season: SEASON } = cfg.league;
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const LEAGUE = `${ROOT}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;

const s2 = (process.env.ESPN_S2 || "").trim();
const swid = (process.env.ESPN_SWID || "").trim();
const baseHeaders = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" };
if (s2 && swid) baseHeaders.Cookie = `espn_s2=${s2}; SWID=${swid}`;

async function get(url, filter, auth = true) {
  const headers = auth ? { ...baseHeaders } : { Accept: "application/json", "User-Agent": baseHeaders["User-Agent"] };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((done) => setTimeout(done, 1500));
    }
  }
}

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const SLOT = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K", 23: "FLEX", 20: "BE", 21: "IR" };
const ORDER = [0, 2, 3, 4, 5, 6, 23, 7, 16, 17]; // starting slots, top to bottom
const BENCH = 20;
// NFL team abbreviations by ESPN team id, for players whose team has a bye (no game listed)
const NFL = { 0: "FA", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU" };
const IR = 21;

async function build() {
  if (!baseHeaders.Cookie) throw new Error("the ESPN_S2 / ESPN_SWID secrets aren't set");
  const st = await get(`${LEAGUE}?view=mStatus&view=mSettings`);
  let week = st.status.currentMatchupPeriod;
  let sp = st.status.currentScoringPeriod || st.status.latestScoringPeriod || week;
  // On Tuesdays the site still shows the week that just finished (scripts/show-week.mjs)
  if (holdingLastWeek() && week > 1) {
    const periods = ((st.settings || {}).scheduleSettings || {}).matchupPeriods || {};
    const spans = periods[week - 1] || periods[String(week - 1)] || [week - 1];
    week = week - 1;
    sp = spans[spans.length - 1];
    console.log(`Lineups: showing week ${week} until Wednesday`);
  }

  // Lineups for this matchup period
  const box = await get(`${LEAGUE}?view=mMatchupScore&view=mBoxscore&view=mScoreboard&scoringPeriodId=${sp}`, { schedule: { filterMatchupPeriodIds: { value: [week] } } });

  // NFL games this week: opponent, kickoff and live state for each pro team. ESPN's public
  // NFL scoreboard is small and live, so it's read every time (its team ids match the fantasy
  // ones). If it can't be reached, the fantasy schedule fills in and states are estimated.
  const abbrev = { ...NFL };
  const gameOf = {}; // pro team id -> { opp, home, kickoff, g, c }
  try {
    const nfl = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${sp}`, null, false);
    for (const ev of nfl.events || []) {
      const comp = (ev.competitions || [])[0] || {};
      const st = ev.status || comp.status || {};
      const type = st.type || {};
      let c = "";
      if (type.state === "post") c = "Final";
      else if (type.state === "in") {
        const q = st.period > 4 ? "OT" : "Q" + st.period;
        c = type.name === "STATUS_HALFTIME" ? "Half" : /^End/i.test(type.shortDetail || "") ? "End " + q : q + " " + (st.displayClock || "");
      }
      const teams = (comp.competitors || []).map((x) => ({ id: Number(x.team && x.team.id), home: x.homeAway === "home", ab: x.team && x.team.abbreviation }));
      for (const t of teams) {
        if (t.ab) abbrev[t.id] = String(t.ab).toUpperCase();
        const opp = teams.find((x) => x.id !== t.id);
        gameOf[t.id] = { opp: opp ? opp.id : 0, home: t.home, kickoff: Date.parse(ev.date), g: type.state || "pre", c };
      }
    }
    if (!Object.keys(gameOf).length) throw new Error("no NFL games listed");
  } catch (err) {
    console.log(`::warning::Lineups: couldn't read the NFL scoreboard (${err.message}); using the fantasy schedule instead`);
    const pro = await get(`${ROOT}/seasons/${SEASON}?view=proTeamSchedules_wl`, null, false);
    const now = Date.now();
    for (const t of (pro.settings && pro.settings.proTeams) || []) {
      if (t.abbrev) abbrev[t.id] = String(t.abbrev).toUpperCase();
      const g = ((t.proGamesByScoringPeriod || {})[sp] || [])[0];
      if (!g) continue;
      const state = now < g.date ? "pre" : now > g.date + 3.75 * 3600e3 ? "post" : "in";
      gameOf[t.id] = { opp: g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId, home: g.homeProTeamId === t.id, kickoff: g.date, g: state, c: state === "post" ? "Final" : state === "in" ? "Live" : "" };
    }
  }
  function gameState(proId) {
    const g = gameOf[proId];
    return g ? { g: g.g, c: g.c } : { g: "bye", c: "Bye" };
  }

  const games = [];
  for (const m of box.schedule || []) {
    if (m.matchupPeriodId !== week || !m.away) continue;
    const side = (s) => {
      const entries = ((s.rosterForCurrentScoringPeriod || s.rosterForMatchupPeriod || {}).entries) || [];
      const players = entries.map((e) => {
        const pl = (e.playerPoolEntry || {}).player || {};
        const stats = pl.stats || [];
        const proj = stats.find((x) => x.statSourceId === 1 && x.scoringPeriodId === sp && x.statSplitTypeId === 1);
        const proId = pl.proTeamId || 0;
        const g = gameOf[proId];
        const state = gameState(proId);
        return {
          s: e.lineupSlotId,
          n: pl.fullName || "Player " + e.playerId,
          p: POS[pl.defaultPositionId] || "",
          t: abbrev[proId] || "",
          o: g ? (g.home ? "vs " : "@ ") + (abbrev[g.opp] || "") : "",
          k: g ? g.kickoff : null,
          g: state.g,
          c: state.c,
          pts: r2((e.playerPoolEntry || {}).appliedStatTotal),
          pr: proj ? r2(proj.appliedTotal) : null,
          inj: pl.injuryStatus && !/^(ACTIVE|NORMAL)$/.test(pl.injuryStatus) ? pl.injuryStatus : null,
        };
      });
      const starters = players.filter((x) => x.s !== BENCH && x.s !== IR).sort((a, b) => ORDER.indexOf(a.s) - ORDER.indexOf(b.s));
      const bench = players.filter((x) => x.s === BENCH || x.s === IR).sort((a, b) => (a.s === IR) - (b.s === IR) || (b.pr || 0) - (a.pr || 0));
      return {
        id: s.teamId,
        pts: r2(s.totalPointsLive ?? s.totalPoints),
        proj: r2(s.totalProjectedPointsLive ?? s.totalProjectedPoints),
        starters: starters.map((x) => ({ ...x, slot: SLOT[x.s] || "" })),
        bench: bench.map((x) => ({ ...x, slot: SLOT[x.s] || "BE" })),
      };
    };
    games.push({ h: side(m.home), a: side(m.away) });
  }
  if (!games.length) throw new Error("no games this week");
  return { fetchedAt: new Date().toISOString(), week, games };
}

try {
  const data = await build();
  fs.writeFileSync(OUT, JSON.stringify(data));
  const n = data.games.reduce((x, g) => x + g.h.starters.length + g.a.starters.length + g.h.bench.length + g.a.bench.length, 0);
  console.log(`Lineups: week ${data.week}, ${data.games.length} games, ${n} players, ${Math.round(fs.statSync(OUT).size / 1024)} KB`);
} catch (err) {
  console.log(`::warning::Couldn't read lineups from ESPN (${err.message}). Keeping the last good file.`);
  if (!fs.existsSync(OUT)) {
    try {
      const live = await (await fetch("https://airbryar.github.io/bbfc/data/lineups.json?ts=" + Date.now(), { signal: AbortSignal.timeout(10000) })).json();
      if (live && live.games) fs.writeFileSync(OUT, JSON.stringify(live));
    } catch {
      // No copy yet: the sheet says lineups aren't available
    }
  }
}
