// Reads every past BBFC season from ESPN into data/history.json for the Record Book:
// each season's final standings and every game's score. Past seasons don't change, so
// this only needs to run when a season ends (the History workflow also runs monthly).
// The current season isn't stored here; the Record Book adds it from data/espn.json.
//
// Managers are saved under short keys (m1, m2, ...) with first names only. ESPN's member
// IDs are never written out: they are tied to people's ESPN sign-ins, and this repository
// is public. Managers who have left the league have no name ("a former manager").
import fs from "node:fs";

const OUT = "data/history.json";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const { id: LEAGUE_ID, season: SEASON } = cfg.league;
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const leagueUrl = (season) => `${ROOT}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}`;

const s2 = (process.env.ESPN_S2 || "").trim();
const swid = (process.env.ESPN_SWID || "").trim();
if (!s2 || !swid) {
  console.log("::error::The ESPN_S2 and ESPN_SWID secrets are needed to read the league.");
  process.exit(1);
}
const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-history)", Cookie: `espn_s2=${s2}; SWID=${swid}` };

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((done) => setTimeout(done, 2000 * attempt));
    }
  }
}

const r2 = (n) => Math.round((n || 0) * 100) / 100;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// This season: who manages each team now, and the managers' first names
const cur = await get(`${leagueUrl(SEASON)}?view=mTeam&view=mSettings&view=mStatus`);
const firstName = {};
for (const m of cur.members || []) firstName[m.id] = cap((m.firstName || "").trim()) || null;

const keyOf = {}; // ESPN member id -> short key; kept in memory only
const managers = {};
function key(memberId) {
  if (!memberId) return null;
  if (!keyOf[memberId]) {
    const k = "m" + (Object.keys(keyOf).length + 1);
    keyOf[memberId] = k;
    managers[k] = firstName[memberId] || null;
  }
  return keyOf[memberId];
}
// Current managers first, in team order, so their keys stay stable from run to run
const currentTeams = {};
for (const t of [...cur.teams].sort((x, y) => x.id - y.id)) currentTeams[t.id] = key(t.primaryOwner);

const prev = (cur.status.previousSeasons || []).filter((y) => y < SEASON).sort();
const seasons = [];
for (const year of prev) {
  const h = await get(`${leagueUrl(year)}?view=mTeam&view=mMatchupScore&view=mSettings`);
  const ss = h.settings.scheduleSettings || {};
  const reg = ss.matchupPeriodCount || 14;
  const owner = Object.fromEntries(h.teams.map((t) => [t.id, key(t.primaryOwner)]));
  const teams = h.teams
    .map((t) => {
      const rec = t.record.overall;
      return { m: owner[t.id], w: rec.wins, l: rec.losses, t: rec.ties, pf: r2(rec.pointsFor), pa: r2(rec.pointsAgainst), seed: t.playoffSeed, finish: t.rankCalculatedFinal };
    })
    .sort((x, y) => (x.finish || 99) - (y.finish || 99));
  // Each game: [week, home, home points, away, away points, winner H/A/T, kind]
  // kind 0 = regular season, 1 = playoffs (winners bracket), 2 = consolation
  const games = (h.schedule || [])
    .filter((m) => m.away && m.winner !== "UNDECIDED")
    .map((m) => {
      const tier = m.playoffTierType || "NONE";
      const kind = m.matchupPeriodId <= reg ? 0 : tier === "WINNERS_BRACKET" ? 1 : 2;
      return [m.matchupPeriodId, owner[m.home.teamId], r2(m.home.totalPoints), owner[m.away.teamId], r2(m.away.totalPoints), m.winner === "HOME" ? "H" : m.winner === "AWAY" ? "A" : "T", kind];
    })
    .sort((x, y) => x[0] - y[0]);
  seasons.push({ season: year, regWeeks: reg, playoffTeams: ss.playoffTeamCount || 6, teams, games });
  console.log(`${year}: ${teams.length} teams, ${games.length} games`);
}
if (!seasons.length) throw new Error("ESPN returned no past seasons");

fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), managers, current: { season: SEASON, teams: currentTeams }, seasons }));
console.log(`History saved: ${seasons.length} seasons, ${Object.keys(managers).length} managers`);
