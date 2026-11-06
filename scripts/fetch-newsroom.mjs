// Gathers everything the Newspaper writer needs from ESPN into data/newsroom.json:
// managers' first names, weekly results and medians, player box scores, trades,
// waiver and free-agent pickups, power rankings, the schedule ahead, and league
// history from past seasons. Run by the Newsroom workflow before each edition.
import fs from "node:fs";
import { computePower } from "./power.mjs";

const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const { id: LEAGUE_ID, season: SEASON } = cfg.league;
const W = cfg.weights;
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const leagueUrl = (season) => `${ROOT}/seasons/${season}/segments/0/leagues/${LEAGUE_ID}`;

const s2 = (process.env.ESPN_S2 || "").trim();
const swid = (process.env.ESPN_SWID || "").trim();
if (!s2 || !swid) {
  console.log("::error::The ESPN_S2 and ESPN_SWID secrets are needed to read the league.");
  process.exit(1);
}
const baseHeaders = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-newsroom)", Cookie: `espn_s2=${s2}; SWID=${swid}` };

async function get(url, filter) {
  const headers = { ...baseHeaders };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`ESPN answered ${r.status} for ${url.replace(ROOT, "")}`);
      return await r.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((done) => setTimeout(done, 1500 * attempt));
    }
  }
}

const r1 = (n) => Math.round((n || 0) * 10) / 10;
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const PRO = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET", 9: "GB", 10: "TEN", 11: "IND",
  12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
const BENCH = 20;
const IR = 21;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- This season ----------
const a = await get(`${leagueUrl(SEASON)}?view=mTeam&view=mStandings&view=mMatchupScore&view=mSettings&view=mStatus`);
const live = await get(`${leagueUrl(SEASON)}?view=mScoreboard&view=mMatchupScore`);

const firstName = {};
for (const m of a.members || []) firstName[m.id] = cap((m.firstName || "").trim()) || null;

const ss = a.settings.scheduleSettings || {};
const REG = ss.matchupPeriodCount || 14;
const PLAYOFF_TEAMS = ss.playoffTeamCount || 6;
const CUR = a.status.currentMatchupPeriod;

const teamById = {};
const teams = a.teams.map((t) => {
  const rec = t.record.overall;
  const row = {
    id: t.id,
    name: (t.name || "").trim(),
    manager: firstName[t.primaryOwner] || null,
    managerId: t.primaryOwner,
    seed: t.playoffSeed,
    record: `${rec.wins}-${rec.losses}${rec.ties ? "-" + rec.ties : ""}`,
    w: rec.wins,
    l: rec.losses,
    t: rec.ties,
    pf: r2(rec.pointsFor),
    pa: r2(rec.pointsAgainst),
    streak: rec.streakLength ? `${rec.streakType === "WIN" ? "W" : rec.streakType === "LOSS" ? "L" : "T"}${rec.streakLength}` : null,
    trades: (t.transactionCounter || {}).trades || 0,
    pickups: (t.transactionCounter || {}).acquisitions || 0,
    faabSpent: (t.transactionCounter || {}).acquisitionBudgetSpent || 0,
  };
  teamById[t.id] = row;
  return row;
});
const tname = (id) => (teamById[id] ? teamById[id].name : id === 0 ? "free agency" : `team ${id}`);

// Weekly results, medians and head-to-head / median splits
const finished = a.schedule.filter((m) => m.winner !== "UNDECIDED" && m.away && m.matchupPeriodId <= REG);
const lastWeek = finished.reduce((mx, m) => Math.max(mx, m.matchupPeriodId), 0);
const split = Object.fromEntries(teams.map((t) => [t.id, { h2h: [0, 0, 0], med: [0, 0] }]));
const weeks = [];
for (let w = 1; w <= lastWeek; w++) {
  const games = finished.filter((m) => m.matchupPeriodId === w);
  const scores = games.flatMap((m) => [[m.home.teamId, m.home.totalPoints], [m.away.teamId, m.away.totalPoints]]).sort((x, y) => y[1] - x[1]);
  const half = Math.floor(scores.length / 2);
  const median = (scores[half - 1][1] + scores[half][1]) / 2;
  const top = new Set(scores.slice(0, half).map((s) => s[0]));
  for (const [tid] of scores) split[tid].med[top.has(tid) ? 0 : 1]++;
  for (const m of games) {
    const h = m.home.teamId, aw = m.away.teamId;
    if (m.winner === "HOME") { split[h].h2h[0]++; split[aw].h2h[1]++; }
    else if (m.winner === "AWAY") { split[aw].h2h[0]++; split[h].h2h[1]++; }
    else { split[h].h2h[2]++; split[aw].h2h[2]++; }
  }
  weeks.push({
    week: w,
    median: r2(median),
    high: { team: tname(scores[0][0]), pts: r2(scores[0][1]) },
    low: { team: tname(scores[scores.length - 1][0]), pts: r2(scores[scores.length - 1][1]) },
    games: games.map((m) => {
      const hp = m.home.totalPoints, ap = m.away.totalPoints;
      const winner = m.winner === "HOME" ? m.home.teamId : m.winner === "AWAY" ? m.away.teamId : null;
      return {
        home: tname(m.home.teamId),
        away: tname(m.away.teamId),
        score: `${r2(hp)}-${r2(ap)}`,
        winner: winner ? tname(winner) : "tie",
        margin: r2(Math.abs(hp - ap)),
        homeAboveMedian: hp > median,
        awayAboveMedian: ap > median,
      };
    }),
  });
}
for (const t of teams) {
  const s = split[t.id];
  t.h2h = `${s.h2h[0]}-${s.h2h[1]}${s.h2h[2] ? "-" + s.h2h[2] : ""}`;
  t.vsMedian = `${s.med[0]}-${s.med[1]}`;
}

// ---------- Player box scores ----------
const playerName = {};
const playerInfo = {};
function readRoster(side) {
  const ros = side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod || { entries: [] };
  return (ros.entries || []).map((e) => {
    const p = (e.playerPoolEntry || {}).player || {};
    playerName[e.playerId] = p.fullName;
    playerInfo[e.playerId] = { pos: POS[p.defaultPositionId] || "", nfl: PRO[p.proTeamId] || "" };
    return { id: e.playerId, name: p.fullName, pos: POS[p.defaultPositionId] || "", nfl: PRO[p.proTeamId] || "", slot: e.lineupSlotId, pts: r2((e.playerPoolEntry || {}).appliedStatTotal) };
  });
}
async function boxWeek(w) {
  const d = await get(`${leagueUrl(SEASON)}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${w}`, { schedule: { filterMatchupPeriodIds: { value: [w] } } });
  const out = {};
  for (const m of d.schedule || []) {
    if (m.matchupPeriodId !== w) continue;
    for (const side of [m.home, m.away]) if (side) out[side.teamId] = readRoster(side);
  }
  return out;
}
const box = {};
for (let w = 1; w <= Math.max(lastWeek, CUR); w++) {
  if (w > REG && w > lastWeek) break;
  box[w] = await boxWeek(w);
}
const started = (p) => p.slot !== BENCH && p.slot !== IR;

// Season contributors: points each player scored in a team's starting lineup
const contrib = {};
for (let w = 1; w <= lastWeek; w++) {
  for (const [tid, ros] of Object.entries(box[w] || {})) {
    for (const p of ros.filter(started)) {
      const k = `${tid}:${p.id}`;
      contrib[k] = contrib[k] || { team: Number(tid), id: p.id, pts: 0, starts: 0 };
      contrib[k].pts += p.pts;
      contrib[k].starts++;
    }
  }
}
for (const t of teams) {
  t.topPlayers = Object.values(contrib)
    .filter((c) => c.team === t.id)
    .sort((x, y) => y.pts - x.pts)
    .slice(0, 3)
    .map((c) => ({ player: playerName[c.id], pos: playerInfo[c.id].pos, ptsWhileStarted: r1(c.pts), starts: c.starts }));
}

// Week detail for the most recent finished weeks: standouts and bench points
function weekDetail(w) {
  const b = box[w] || {};
  const starters = [];
  const perTeam = [];
  for (const [tid, ros] of Object.entries(b)) {
    const st = ros.filter(started);
    const bench = ros.filter((p) => p.slot === BENCH);
    st.forEach((p) => starters.push({ team: tname(Number(tid)), player: p.name, pos: p.pos, pts: p.pts }));
    const bestBench = bench.slice().sort((x, y) => y.pts - x.pts)[0];
    const flexy = st.filter((p) => ["RB", "WR", "TE"].includes(p.pos)).sort((x, y) => x.pts - y.pts)[0];
    perTeam.push({
      team: tname(Number(tid)),
      starterPts: r2(st.reduce((s, p) => s + p.pts, 0)),
      benchPts: r2(bench.reduce((s, p) => s + p.pts, 0)),
      topStarter: st.slice().sort((x, y) => y.pts - x.pts).slice(0, 2).map((p) => `${p.name} (${p.pos}) ${p.pts}`),
      bestBench: bestBench ? `${bestBench.name} (${bestBench.pos}) ${bestBench.pts}` : null,
      lowestFlexStarter: flexy ? `${flexy.name} (${flexy.pos}) ${flexy.pts}` : null,
    });
  }
  return {
    week: w,
    topPerformances: starters.sort((x, y) => y.pts - x.pts).slice(0, 8),
    duds: starters.filter((p) => !["K", "D/ST"].includes(p.pos)).sort((x, y) => x.pts - y.pts).slice(0, 5),
    teams: perTeam,
  };
}
const recentWeeks = [];
for (let w = lastWeek; w >= Math.max(1, lastWeek - 2); w--) recentWeeks.push(weekDetail(w));

// ---------- Transactions ----------
const moves = [];
const lastPeriod = Math.min(Math.max(CUR, lastWeek), REG + 4);
for (let sp = 1; sp <= lastPeriod; sp++) {
  const adds = await get(`${leagueUrl(SEASON)}?view=mTransactions2&scoringPeriodId=${sp}`, { transactions: { filterType: { value: ["WAIVER", "FREEAGENT"] }, filterStatus: { value: ["EXECUTED"] } } });
  for (const x of adds.transactions || []) if (x.status === "EXECUTED") moves.push({ ...x, sp });
}

// Trades, from the league's activity feed (each trade is one topic; message 244 = a player traded)
const tradeTopics = [];
for (let offset = 0; offset < 500; offset += 50) {
  const feed = await get(`${leagueUrl(SEASON)}/communication/?view=kona_league_communication`, {
    topics: {
      filterType: { value: ["ACTIVITY_TRANSACTIONS"] },
      limit: 50,
      limitPerMessageSet: { value: 25 },
      offset,
      sortMessageDate: { sortPriority: 1, sortAsc: false },
      sortFor: { sortPriority: 2, sortAsc: false },
      filterIncludeMessageTypeIds: { value: [244] },
    },
  });
  const topics = feed.topics || [];
  tradeTopics.push(...topics);
  if (topics.length < 50) break;
}

// The scoring period a date falls in, judged from the pickups around it
const windows = moves.map((x) => [x.proposedDate, x.sp]).sort((x, y) => x[0] - y[0]);
function periodAt(ms) {
  let sp = 1;
  for (const [d, p] of windows) { if (d <= ms) sp = p; else break; }
  return sp;
}

// Names for players who never appeared in a box score
const needed = new Set();
for (const x of moves) for (const i of x.items || []) if (!playerName[i.playerId]) needed.add(i.playerId);
for (const t of tradeTopics) for (const m of t.messages || []) if (m.messageTypeId === 244 && !playerName[m.targetId]) needed.add(m.targetId);
const ids = [...needed];
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  const ps = await get(`${ROOT}/seasons/${SEASON}/players?view=players_wl`, { filterIds: { value: chunk } });
  for (const p of Array.isArray(ps) ? ps : []) {
    playerName[p.id] = p.fullName;
    playerInfo[p.id] = { pos: POS[p.defaultPositionId] || "", nfl: PRO[p.proTeamId] || "" };
  }
}
const pname = (id) => playerName[id] || `player ${id}`;
const plabel = (id) => `${pname(id)}${playerInfo[id] && playerInfo[id].pos ? " (" + playerInfo[id].pos + ")" : ""}`;

// Starter points a player scored for a team in a range of weeks
function startedPts(pid, tid, fromWeek, toWeek) {
  let pts = 0, starts = 0;
  for (let w = fromWeek; w <= toWeek; w++) {
    const p = ((box[w] || {})[tid] || []).find((x) => x.id === pid);
    if (p && started(p)) { pts += p.pts; starts++; }
  }
  return { pts: r1(pts), starts };
}

const tradeList = tradeTopics
  .map((t) => {
    const msgs = (t.messages || []).filter((m) => m.messageTypeId === 244);
    if (!msgs.length) return null;
    const effective = periodAt(t.date);
    const sides = {};
    for (const m of msgs) {
      const since = startedPts(m.targetId, m.to, effective, lastWeek);
      const before = startedPts(m.targetId, m.from, 1, effective - 1);
      sides[m.to] = sides[m.to] || [];
      sides[m.to].push({ player: plabel(m.targetId), from: tname(m.from), ptsForNewTeamSince: since.pts, startsSince: since.starts, ptsForOldTeamBefore: before.pts });
    }
    const teamsIn = [...new Set(msgs.flatMap((m) => [m.from, m.to]))];
    return {
      date: day(t.date),
      week: effective,
      teams: teamsIn.map((id) => tname(id)),
      received: Object.entries(sides).map(([tid, players]) => ({ team: tname(Number(tid)), manager: (teamById[tid] || {}).manager || null, players })),
      note: teamsIn.length === 2 && Object.keys(sides).length === 1 ? "Only one side received players in this trade." : undefined,
    };
  })
  .filter(Boolean)
  .sort((x, y) => y.date.localeCompare(x.date));

const pickupsAll = moves.map((x) => ({
  date: day(x.proposedDate),
  week: x.sp,
  type: x.type === "WAIVER" ? "waiver claim" : "free agent",
  team: tname(x.teamId),
  bid: x.bidAmount || 0,
  added: (x.items || []).filter((i) => i.type === "ADD").map((i) => plabel(i.playerId)),
  dropped: (x.items || []).filter((i) => i.type === "DROP").map((i) => plabel(i.playerId)),
  addedIds: (x.items || []).filter((i) => i.type === "ADD").map((i) => i.playerId),
}));
const cutoff = Date.now() - 9 * 86400000;
const recentPickups = pickupsAll
  .filter((p) => new Date(p.date).getTime() >= cutoff)
  .sort((x, y) => y.date.localeCompare(x.date) || y.bid - x.bid)
  .slice(0, 30)
  .map(({ addedIds, ...rest }) => rest);
const biggestBids = pickupsAll
  .filter((p) => p.bid > 0)
  .sort((x, y) => y.bid - x.bid)
  .slice(0, 8)
  .map(({ addedIds, ...rest }) => rest);
// Pickups that paid off: starter points since the pickup, for the team that added them
const bestPickups = pickupsAll
  .flatMap((p) => p.addedIds.map((pid) => {
    const tid = teams.find((t) => t.name === p.team)?.id;
    const s = tid ? startedPts(pid, tid, p.week, lastWeek) : { pts: 0, starts: 0 };
    return { player: plabel(pid), team: p.team, date: p.date, bid: p.bid, ptsSinceAsStarter: s.pts, starts: s.starts };
  }))
  .filter((x) => x.starts > 0)
  .sort((x, y) => y.ptsSinceAsStarter - x.ptsSinceAsStarter)
  .slice(0, 8);

// ---------- Power rankings ----------
const espnShape = {
  regSeasonWeeks: REG,
  teams: teams.map((t) => ({ id: t.id })),
  games: finished.map((m) => ({ p: m.matchupPeriodId, w: m.winner === "HOME" ? "H" : m.winner === "AWAY" ? "A" : "T", h: [m.home.teamId, r2(m.home.totalPoints)], a: [m.away.teamId, r2(m.away.totalPoints)] })),
  upcoming: a.schedule.filter((m) => m.winner === "UNDECIDED" && m.away && m.matchupPeriodId <= REG).map((m) => [m.matchupPeriodId, m.home.teamId, m.away.teamId]),
};
const prNow = lastWeek ? computePower(espnShape, lastWeek, W) : null;
const prPrev = lastWeek > 1 ? computePower(espnShape, lastWeek - 1, W) : null;
const prevRank = {};
if (prPrev) prPrev.list.forEach((r, i) => { prevRank[r.id] = i + 1; });
const powerRankings = prNow
  ? prNow.list.map((r, i) => ({
      rank: i + 1,
      lastWeek: prevRank[r.id] || null,
      team: tname(r.id),
      score: r1(r.score),
      record: r1(r.rec),
      scoring: r1(r.scr),
      form: r1(r.frm),
      schedule: r.sch == null ? null : r1(r.sch),
      ppg: r1(r.raw.ppg),
      last3ppg: r1(r.raw.form),
      oppPpgLeft: r.raw.opp == null ? null : r1(r.raw.opp),
    }))
  : [];

// ---------- League history ----------
const history = [];
const h2h = {}; // "managerA|managerB" -> [winsA, winsB, ties]
const allTime = {};
function addH2h(ma, mb, winner) {
  if (!ma || !mb) return;
  const [x, y] = ma < mb ? [ma, mb] : [mb, ma];
  const k = `${x}|${y}`;
  h2h[k] = h2h[k] || [0, 0, 0];
  if (winner === null) h2h[k][2]++;
  else h2h[k][winner === x ? 0 : 1]++;
}
function seasonGames(schedule, ownerOf) {
  for (const m of schedule || []) {
    if (!m.away || m.winner === "UNDECIDED") continue;
    const ma = ownerOf[m.home.teamId], mb = ownerOf[m.away.teamId];
    const winner = m.winner === "HOME" ? ma : m.winner === "AWAY" ? mb : null;
    addH2h(ma, mb, winner);
  }
}
const prevSeasons = (a.status.previousSeasons || []).filter((y) => y < SEASON).sort();
for (const year of prevSeasons) {
  let h;
  try {
    h = await get(`${leagueUrl(year)}?view=mTeam&view=mMatchupScore&view=mSettings`);
  } catch (err) {
    console.log(`::warning::Couldn't read the ${year} season (${err.message})`);
    continue;
  }
  const ownerOf = Object.fromEntries(h.teams.map((t) => [t.id, t.primaryOwner]));
  seasonGames(h.schedule, ownerOf);
  const pTeams = (h.settings.scheduleSettings || {}).playoffTeamCount || PLAYOFF_TEAMS;
  const rows = h.teams
    .map((t) => {
      const rec = t.record.overall;
      const mid = t.primaryOwner;
      const who = firstName[mid] || null;
      const at = (allTime[mid] = allTime[mid] || { manager: who, seasons: 0, titles: 0, runnerUps: 0, playoffs: 0, w: 0, l: 0, t: 0, pf: 0 });
      at.seasons++;
      if (t.rankCalculatedFinal === 1) at.titles++;
      if (t.rankCalculatedFinal === 2) at.runnerUps++;
      if (t.playoffSeed && t.playoffSeed <= pTeams) at.playoffs++;
      at.w += rec.wins; at.l += rec.losses; at.t += rec.ties; at.pf += rec.pointsFor;
      return { manager: who || "a former manager", finish: t.rankCalculatedFinal, seed: t.playoffSeed, record: `${rec.wins}-${rec.losses}${rec.ties ? "-" + rec.ties : ""}`, pf: r1(rec.pointsFor) };
    })
    .sort((x, y) => (x.finish || 99) - (y.finish || 99));
  history.push({ season: year, champion: rows[0] && rows[0].manager, runnerUp: rows[1] && rows[1].manager, finalStandings: rows });
}
// This season's games count toward head-to-head history too
seasonGames(a.schedule.filter((m) => m.matchupPeriodId <= REG), Object.fromEntries(teams.map((t) => [t.id, t.managerId])));

const byManager = Object.fromEntries(teams.map((t) => [t.managerId, t]));
const rivalry = (ma, mb) => {
  const [x, y] = ma < mb ? [ma, mb] : [mb, ma];
  const r = h2h[`${x}|${y}`];
  if (!r) return null;
  const [wx, wy, ties] = r;
  const wa = ma === x ? wx : wy, wb = ma === x ? wy : wx;
  return `${(byManager[ma] || {}).manager || "?"} ${wa}-${wb}${ties ? "-" + ties : ""} vs ${(byManager[mb] || {}).manager || "?"}`;
};
const allTimeCurrent = teams.map((t) => {
  const at = allTime[t.managerId] || { seasons: 0, titles: 0, runnerUps: 0, playoffs: 0, w: 0, l: 0, t: 0, pf: 0 };
  return {
    manager: t.manager,
    team: t.name,
    pastSeasons: at.seasons,
    titles: at.titles,
    runnerUps: at.runnerUps,
    playoffTrips: at.playoffs,
    pastRecord: `${at.w}-${at.l}${at.t ? "-" + at.t : ""}`,
    pastPointsFor: r1(at.pf),
  };
});

// ---------- This week and what's next ----------
const liveSide = (s) => ({ pts: r2(s.totalPointsLive ?? s.totalPoints), proj: r2(s.totalProjectedPointsLive ?? s.totalProjectedPoints) });
const thisWeek = (live.schedule || [])
  .filter((m) => m.matchupPeriodId === CUR && m.away)
  .map((m) => {
    const hs = liveSide(m.home), as = liveSide(m.away);
    return {
      home: tname(m.home.teamId),
      away: tname(m.away.teamId),
      livePoints: `${hs.pts}-${as.pts}`,
      projected: `${hs.proj}-${as.proj}`,
      allTimeHeadToHead: rivalry(teamById[m.home.teamId].managerId, teamById[m.away.teamId].managerId),
      homeRecord: teamById[m.home.teamId].record,
      awayRecord: teamById[m.away.teamId].record,
    };
  });
const thisWeekPlayed = CUR > lastWeek && box[CUR] ? weekDetail(CUR).topPerformances.filter((p) => p.pts > 0).slice(0, 6) : [];
const nextWeek = a.schedule
  .filter((m) => m.matchupPeriodId === CUR + 1 && m.away && m.matchupPeriodId <= REG)
  .map((m) => ({ home: tname(m.home.teamId), away: tname(m.away.teamId), allTimeHeadToHead: rivalry(teamById[m.home.teamId].managerId, teamById[m.away.teamId].managerId) }));

const tradeDeadline = (a.settings.tradeSettings || {}).deadlineDate;

const out = {
  fetchedAt: new Date().toISOString(),
  notes: [
    "Each week a team plays two games: its head-to-head matchup, plus a game against the league median (the top 6 scores of the week win it). 'record' combines both; 'h2h' and 'vsMedian' split them.",
    `The top ${PLAYOFF_TEAMS} seeds make the playoffs. The regular season is ${REG} weeks.`,
    "Points are fantasy points. 'ptsWhileStarted' and similar fields only count weeks the player was in that team's starting lineup.",
    "Managers are listed by first name. Past seasons list managers, not team names.",
    "allTimeHeadToHead covers every past season plus this one, playoffs included.",
  ],
  season: SEASON,
  currentWeek: CUR,
  lastFinishedWeek: lastWeek,
  regularSeasonWeeks: REG,
  playoffTeams: PLAYOFF_TEAMS,
  tradeDeadline: tradeDeadline ? day(tradeDeadline) : null,
  standings: teams
    .slice()
    .sort((x, y) => (x.seed || 99) - (y.seed || 99))
    .map(({ managerId, ...t }) => t),
  powerRankings,
  weeks,
  recentWeeks,
  thisWeek: { week: CUR, matchups: thisWeek, alreadyPlayedStandouts: thisWeekPlayed },
  nextWeek: { week: CUR + 1, matchups: nextWeek },
  trades: tradeList,
  recentPickups,
  biggestFaabBids: biggestBids,
  pickupsThatPaidOff: bestPickups,
  history: { seasons: history, allTimeCurrentManagers: allTimeCurrent },
};

fs.writeFileSync("data/newsroom.json", JSON.stringify(out, null, 1) + "\n");
console.log(
  `Newsroom data saved: week ${CUR}, ${lastWeek} finished weeks, ${tradeList.length} trades, ${recentPickups.length} recent pickups, ${history.length} past seasons (${Math.round(fs.statSync("data/newsroom.json").size / 1024)} KB)`
);
