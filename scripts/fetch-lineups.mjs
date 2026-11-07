// Reads both lineups for every game this week from ESPN into data/lineups.json, for the
// matchup details sheet (tap a game on the Scoreboard). The page only downloads this file
// when someone opens a game, so it never slows the main page down.
//
// Each player: lineup slot, name, position, NFL team and opponent, kickoff, the NFL game's
// state (pre / in / post / bye) and clock, fantasy points so far and projection.
// Game states come from ESPN's public NFL scoreboard; if that can't be reached, they're
// estimated from kickoff times. If the fantasy data can't be read, the last good file stays.
import fs from "node:fs";

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
const IR = 21;

async function build() {
  if (!baseHeaders.Cookie) throw new Error("the ESPN_S2 / ESPN_SWID secrets aren't set");
  const st = await get(`${LEAGUE}?view=mStatus&view=mSettings`);
  const week = st.status.currentMatchupPeriod;
  const sp = st.status.currentScoringPeriod || st.status.latestScoringPeriod || week;

  // Lineups for this matchup period
  const box = await get(`${LEAGUE}?view=mMatchupScore&view=mBoxscore&view=mScoreboard&scoringPeriodId=${sp}`, { schedule: { filterMatchupPeriodIds: { value: [week] } } });

  // NFL schedule: each pro team's opponent and kickoff this week
  const pro = await get(`${ROOT}/seasons/${SEASON}?view=proTeamSchedules_wl`, null, false);
  const proTeams = (pro.settings && pro.settings.proTeams) || [];
  const abbrev = { 0: "FA" };
  const gameOf = {}; // pro team id -> { opp, home, kickoff }
  for (const t of proTeams) {
    abbrev[t.id] = String(t.abbrev || "").toUpperCase();
    const g = ((t.proGamesByScoringPeriod || {})[sp] || [])[0];
    if (g) gameOf[t.id] = { opp: g.homeProTeamId === t.id ? g.awayProTeamId : g.homeProTeamId, home: g.homeProTeamId === t.id, kickoff: g.date };
  }

  // Live NFL game state from ESPN's public scoreboard (team ids match the fantasy ones)
  const stateOf = {}; // pro team id -> { g: pre|in|post, c: clock text }
  try {
    const nfl = await get(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${sp}`, null, false);
    for (const ev of nfl.events || []) {
      const s = (ev.status && ev.status.type) || {};
      const c = s.state === "in" ? (s.shortDetail || "").replace(/ - /, " ") : s.state === "post" ? "Final" : "";
      for (const comp of ((ev.competitions || [])[0] || {}).competitors || []) stateOf[Number(comp.team && comp.team.id)] = { g: s.state, c };
    }
  } catch (err) {
    console.log(`::warning::Lineups: couldn't read the NFL scoreboard (${err.message}); estimating game states from kickoff times`);
  }
  const now = Date.now();
  function gameState(proId) {
    const g = gameOf[proId];
    if (!g) return { g: "bye", c: "Bye" };
    const s = stateOf[proId];
    if (s && s.g) return s;
    if (now < g.kickoff) return { g: "pre", c: "" };
    return now > g.kickoff + 3.75 * 3600e3 ? { g: "post", c: "Final" } : { g: "in", c: "Live" };
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
}
