// Pulls the latest league data from ESPN and saves it to data/espn.json.
// The league is private, so it signs in with the ESPN_S2 and ESPN_SWID secrets.
// If ESPN can't be reached, the last good data is kept so the site never breaks.
import fs from "node:fs";

const league = JSON.parse(fs.readFileSync("data/league.json", "utf8")).league;
const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${league.season}/segments/0/leagues/${league.id}`;
const OUT = "data/espn.json";
const LIVE_COPY = "https://airbryar.github.io/bbfc/data/espn.json";

const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" };
const s2 = (process.env.ESPN_S2 || "").trim();
const swid = (process.env.ESPN_SWID || "").trim();
if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;

async function get(query) {
  const r = await fetch(base + query, { headers });
  if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
  return r.json();
}

const r2 = (n) => Math.round((n || 0) * 100) / 100;

async function fromEspn() {
  const a = await get("?view=mTeam&view=mStandings&view=mMatchupScore&view=mSettings");
  const b = await get("?view=mScoreboard&view=mMatchupScore");
  const cur = a.status.currentMatchupPeriod;
  const ss = (a.settings && a.settings.scheduleSettings) || {};
  const reg = ss.matchupPeriodCount || 99;
  const games = a.schedule
    .filter((m) => m.winner !== "UNDECIDED" && m.away)
    .map((m) => ({
      p: m.matchupPeriodId,
      w: m.winner === "HOME" ? "H" : m.winner === "AWAY" ? "A" : "T",
      h: [m.home.teamId, r2(m.home.totalPoints)],
      a: [m.away.teamId, r2(m.away.totalPoints)],
    }));
  const side = (s) => [s.teamId, r2(s.totalPointsLive ?? s.totalPoints), r2(s.totalProjectedPointsLive ?? s.totalProjectedPoints)];
  const current = b.schedule
    .filter((m) => m.matchupPeriodId === cur && m.away)
    .map((m) => ({ h: side(m.home), a: side(m.away) }));
  const upcoming = a.schedule
    .filter((m) => m.winner === "UNDECIDED" && m.away && m.matchupPeriodId >= cur && m.matchupPeriodId <= reg)
    .map((m) => [m.matchupPeriodId, m.home.teamId, m.away.teamId]);
  const teams = a.teams.map((t) => ({
    id: t.id,
    name: (t.name || "").trim(),
    seed: t.playoffSeed,
    w: t.record.overall.wins,
    l: t.record.overall.losses,
    t: t.record.overall.ties,
    pf: r2(t.record.overall.pointsFor),
    pa: r2(t.record.overall.pointsAgainst),
  }));
  if (teams.length < 8) throw new Error("ESPN returned too few teams");
  return {
    fetchedAt: new Date().toISOString(),
    season: a.seasonId,
    currentWeek: cur,
    regSeasonWeeks: ss.matchupPeriodCount,
    playoffTeams: ss.playoffTeamCount,
    teams,
    games,
    current,
    upcoming,
  };
}

try {
  const data = await fromEspn();
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`ESPN: week ${data.currentWeek}, ${data.games.length} finished games, saved ${data.fetchedAt}`);
} catch (err) {
  const reason = !headers.Cookie ? "the ESPN_S2 / ESPN_SWID secrets aren't set yet" : err.message;
  console.log(`::warning::Couldn't read ESPN (${reason}). Keeping the last good data.`);
  // Prefer whatever the live site last showed, if it's newer than the saved copy.
  try {
    const live = await (await fetch(LIVE_COPY + "?ts=" + Date.now())).json();
    const saved = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (live && live.fetchedAt && live.teams && live.fetchedAt > saved.fetchedAt) {
      fs.writeFileSync(OUT, JSON.stringify(live));
      console.log(`Using the live site's data from ${live.fetchedAt}`);
    }
  } catch {
    // First run, or the live site isn't up yet: the saved copy is used as is.
  }
}
