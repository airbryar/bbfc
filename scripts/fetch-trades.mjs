// Reads this season's trades from ESPN into data/trades.json for the Trades section:
// who got whom, the week of each deal, and the points each player has scored in his new
// team's starting lineup since (finished weeks only). Trades change rarely, so this only
// goes to ESPN about once an hour; in between, and whenever ESPN can't be reached, it
// keeps the last good copy (the live site's, if that's newer than the saved one).
// The trade logic matches scripts/fetch-newsroom.mjs, so the site and the Newspaper agree.
//
// It also saves the Waiver Wire for the Transactions section: each team's FAAB left, and
// every waiver claim and free-agent pickup from this week and last (team id, bid, players
// added and dropped).
import fs from "node:fs";

const OUT = "data/trades.json";
const LIVE_COPY = "https://airbryar.github.io/bbfc/data/trades.json";
const REFRESH_MINUTES = 55;

const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const { id: LEAGUE_ID, season: SEASON } = cfg.league;
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const LEAGUE = `${ROOT}/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`;

const s2 = (process.env.ESPN_S2 || "").trim();
const swid = (process.env.ESPN_SWID || "").trim();
const baseHeaders = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" };
if (s2 && swid) baseHeaders.Cookie = `espn_s2=${s2}; SWID=${swid}`;

async function get(url, filter) {
  const headers = { ...baseHeaders };
  if (filter) headers["X-Fantasy-Filter"] = JSON.stringify(filter);
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
      return await r.json();
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((done) => setTimeout(done, 1500));
    }
  }
}

const r1 = (n) => Math.round((n || 0) * 10) / 10;
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const BENCH = 20;
const IR = 21;
const day = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD, Eastern
const started = (p) => p.slot !== BENCH && p.slot !== IR;

async function fromEspn() {
  const a = await get(`${LEAGUE}?view=mTeam&view=mMatchupScore&view=mSettings&view=mStatus`);
  const REG = (a.settings.scheduleSettings || {}).matchupPeriodCount || 14;
  const CUR = a.status.currentMatchupPeriod;
  const teamName = {};
  for (const t of a.teams || []) teamName[t.id] = (t.name || "").trim();
  if (Object.keys(teamName).length < 8) throw new Error("ESPN returned too few teams");
  const tname = (id) => teamName[id] || `team ${id}`;
  const lastWeek = a.schedule
    .filter((m) => m.winner !== "UNDECIDED" && m.away && m.matchupPeriodId <= REG)
    .reduce((mx, m) => Math.max(mx, m.matchupPeriodId), 0);

  // Trades, from the league's activity feed (each trade is one topic; message 244 = a player traded)
  const topics = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const feed = await get(`${LEAGUE}/communication/?view=kona_league_communication`, {
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
    const page = feed.topics || [];
    topics.push(...page);
    if (page.length < 50) break;
  }

  // Trades accepted but still in the league's review period. In this league an accepted trade
  // always goes through (Bryar, Nov 2026), so these count as trades from the moment they're
  // accepted; ESPN only adds them to the activity feed once the review ends.
  let pendingRaw = [];
  try {
    const pv = await get(`${LEAGUE}?view=mPendingTransactions`);
    pendingRaw = (pv.pendingTransactions || []).filter((x) => x.type === "TRADE_ACCEPT" && x.status === "PENDING" && (x.items || []).some((i) => i.type === "TRADE"));
  } catch (err) {
    console.log(`::warning::Couldn't read pending trades (${err.message})`);
  }

  // Pickups (waiver claims and free agents), every week so far: they date the trades, and
  // this week's and last week's feed the Waiver Wire
  const windows = [];
  const moves = [];
  const accepts = []; // processed trade acceptances: when each trade was actually agreed
  const lastPeriod = Math.min(Math.max(CUR, lastWeek), REG + 4);
  for (let sp = 1; sp <= lastPeriod; sp++) {
    if (!topics.length && sp < CUR - 1) continue; // no trades to date: only the Waiver Wire's weeks
    const adds = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${sp}`, { transactions: { filterType: { value: ["WAIVER", "FREEAGENT"] }, filterStatus: { value: ["EXECUTED"] } } });
    for (const x of adds.transactions || []) {
      if (x.status !== "EXECUTED") continue;
      windows.push([x.proposedDate, sp]);
      if (sp >= CUR - 1) moves.push({ ...x, sp });
    }
    if (!topics.length) continue;
    const acc = await get(`${LEAGUE}?view=mTransactions2&scoringPeriodId=${sp}`, { transactions: { filterType: { value: ["TRADE_ACCEPT"] } } });
    for (const x of acc.transactions || []) {
      if (x.type === "TRADE_ACCEPT" && x.status === "EXECUTED") accepts.push(x);
    }
  }
  windows.sort((x, y) => x[0] - y[0]);
  function periodAt(ms) {
    let sp = 1;
    for (const [d, p] of windows) { if (d <= ms) sp = p; else break; }
    return sp;
  }

  // Box scores for the finished weeks since the first trade
  const playerName = {};
  const playerPos = {};
  const box = {};
  const firstWeek = topics.reduce((mn, t) => Math.min(mn, periodAt(t.date)), Infinity);
  for (let w = firstWeek; w <= lastWeek; w++) {
    const d = await get(`${LEAGUE}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${w}`, { schedule: { filterMatchupPeriodIds: { value: [w] } } });
    box[w] = {};
    for (const m of d.schedule || []) {
      if (m.matchupPeriodId !== w) continue;
      for (const side of [m.home, m.away]) {
        if (!side) continue;
        const ros = side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod || { entries: [] };
        box[w][side.teamId] = (ros.entries || []).map((e) => {
          const p = (e.playerPoolEntry || {}).player || {};
          if (p.fullName) { playerName[e.playerId] = p.fullName; playerPos[e.playerId] = POS[p.defaultPositionId] || ""; }
          return { id: e.playerId, slot: e.lineupSlotId, pts: (e.playerPoolEntry || {}).appliedStatTotal || 0 };
        });
      }
    }
  }

  // Names for players who never appeared in a box score
  const needed = [...new Set([
    ...topics.flatMap((t) => (t.messages || []).filter((m) => m.messageTypeId === 244).map((m) => m.targetId)),
    ...moves.flatMap((x) => (x.items || []).map((i) => i.playerId)),
    ...pendingRaw.flatMap((x) => (x.items || []).map((i) => i.playerId)),
  ])].filter((id) => !playerName[id]);
  for (let i = 0; i < needed.length; i += 50) {
    const ps = await get(`${ROOT}/seasons/${SEASON}/players?view=players_wl`, { filterIds: { value: needed.slice(i, i + 50) } });
    for (const p of Array.isArray(ps) ? ps : []) { playerName[p.id] = p.fullName; playerPos[p.id] = POS[p.defaultPositionId] || ""; }
  }
  const plabel = (id) => `${playerName[id] || `player ${id}`}${playerPos[id] ? " (" + playerPos[id] + ")" : ""}`;

  function startedPts(pid, tid, fromWeek) {
    let pts = 0, starts = 0;
    for (let w = fromWeek; w <= lastWeek; w++) {
      const p = ((box[w] || {})[tid] || []).find((x) => x.id === pid);
      if (p && started(p)) { pts += p.pts; starts++; }
    }
    return { pts: r1(pts), starts };
  }

  // When a trade was accepted: the feed dates it when it went through (after the review), so
  // match it to its acceptance (same players to the same teams, processed by then)
  const reviewMs = ((a.settings.tradeSettings || {}).revisionHours || 0) * 3600000;
  const acceptedAt = (x) => x.proposedDate || (x.processDate && reviewMs ? x.processDate - reviewMs : x.processDate);
  function agreedAt(msgs, processed) {
    const want = msgs.map((m) => `${m.targetId}>${m.to}`).sort().join(",");
    let best = null;
    for (const x of accepts) {
      const got = (x.items || []).filter((i) => i.type === "TRADE").map((i) => `${i.playerId}>${i.toTeamId}`).sort().join(",");
      const at = acceptedAt(x);
      if (got !== want || !at || at > processed + 60000) continue;
      if (!best || Math.abs((x.processDate || at) - processed) < Math.abs((best.processDate || acceptedAt(best)) - processed)) best = x;
    }
    if (process.env.DEBUG_TRADES) console.log(`agreed ${want} feed ${new Date(processed).toISOString()} accept ${best ? new Date(acceptedAt(best)).toISOString() + " (proposed " + best.proposedDate + ", processed " + best.processDate + ")" : "none"}`);
    return best ? acceptedAt(best) : processed;
  }

  const trades = topics
    .map((t) => {
      const msgs = (t.messages || []).filter((m) => m.messageTypeId === 244);
      if (!msgs.length) return null;
      const at = agreedAt(msgs, t.date);
      const week = periodAt(at);
      const sides = {};
      for (const m of msgs) {
        const since = startedPts(m.targetId, m.to, week);
        (sides[m.to] = sides[m.to] || []).push({ player: plabel(m.targetId), from: tname(m.from), ptsForNewTeamSince: since.pts, startsSince: since.starts });
      }
      return {
        date: day(at),
        at, // when it was accepted: for the ticker and the tab's "new" dot
        week,
        teams: [...new Set(msgs.flatMap((m) => [m.from, m.to]))].map(tname),
        received: Object.entries(sides).map(([tid, players]) => ({ team: tname(Number(tid)), players })),
      };
    })
    .filter(Boolean);

  // Accepted trades still in review join the list as they are (no "pending" label)
  const dealOf = (pairs) => pairs.map(([pid, to]) => `${pid}>${to}`).sort().join(",");
  const inFeed = new Set(topics.map((t) => dealOf((t.messages || []).filter((m) => m.messageTypeId === 244).map((m) => [m.targetId, m.to]))));
  for (const x of pendingRaw) {
    const items = x.items.filter((i) => i.type === "TRADE");
    if (inFeed.has(dealOf(items.map((i) => [i.playerId, i.toTeamId])))) continue;
    const at = acceptedAt(x);
    const week = periodAt(at);
    const sides = {};
    for (const i of items) {
      const since = startedPts(i.playerId, i.toTeamId, week);
      (sides[i.toTeamId] = sides[i.toTeamId] || []).push({ player: plabel(i.playerId), from: tname(i.fromTeamId), ptsForNewTeamSince: since.pts, startsSince: since.starts });
    }
    if (process.env.DEBUG_TRADES) console.log(`in review ${dealOf(items.map((i) => [i.playerId, i.toTeamId]))} proposed ${x.proposedDate} processes ${x.processDate}`);
    trades.push({
      date: day(at),
      at,
      week,
      teams: [...new Set(items.flatMap((i) => [i.fromTeamId, i.toTeamId]))].map(tname),
      received: Object.entries(sides).map(([tid, players]) => ({ team: tname(Number(tid)), players })),
    });
  }
  trades.sort((x, y) => y.at - x.at);

  // Waiver Wire: FAAB left for each team, and this week's and last week's pickups
  const acq = a.settings.acquisitionSettings || {};
  const budget = acq.isUsingAcquisitionBudget ? acq.acquisitionBudget || 0 : 0;
  const faab = budget
    ? { budget, left: Object.fromEntries((a.teams || []).map((t) => [t.id, Math.max(0, budget - ((t.transactionCounter || {}).acquisitionBudgetSpent || 0))])) }
    : null;
  const pickups = moves
    .map((x) => ({
      at: x.processDate || x.proposedDate,
      week: x.sp,
      type: x.type === "WAIVER" ? "W" : "FA",
      team: x.teamId,
      bid: x.bidAmount || 0,
      add: (x.items || []).filter((i) => i.type === "ADD").map((i) => plabel(i.playerId)),
      drop: (x.items || []).filter((i) => i.type === "DROP").map((i) => plabel(i.playerId)),
    }))
    .filter((x) => x.add.length)
    .sort((x, y) => y.at - x.at)
    .slice(0, 60);

  const deadline = (a.settings.tradeSettings || {}).deadlineDate;
  return { fetchedAt: new Date().toISOString(), through: lastWeek || null, week: CUR, deadline: deadline ? day(deadline) : null, trades, faab, pickups };
}

// The freshest copy we already have: the live site's, or the saved one
let last = null;
try { last = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
try {
  const live = await (await fetch(LIVE_COPY + "?ts=" + Date.now(), { signal: AbortSignal.timeout(10000) })).json();
  if (live && live.fetchedAt && Array.isArray(live.trades) && (!last || live.fetchedAt > last.fetchedAt)) last = live;
} catch {
  // The live site doesn't have a copy yet: the saved one is used.
}

// The Waiver Wire arrived after the trades did: a copy without it is refreshed right away.
// Same for a copy that still keeps trades in review apart under "pending" (before Nov 11, 2026).
if (last && (!("pickups" in last) || "pending" in last)) last.fetchedAt = "1970-01-01T00:00:00Z";
const ageMin = last ? (Date.now() - Date.parse(last.fetchedAt)) / 60000 : Infinity;
if (ageMin < REFRESH_MINUTES && !process.env.FORCE_TRADES) {
  fs.writeFileSync(OUT, JSON.stringify(last));
  console.log(`Trades: keeping the copy from ${Math.round(ageMin)} min ago (${last.trades.length} trades)`);
} else {
  try {
    if (!baseHeaders.Cookie) throw new Error("the ESPN_S2 / ESPN_SWID secrets aren't set");
    const data = await fromEspn();
    fs.writeFileSync(OUT, JSON.stringify(data));
    console.log(`Trades: ${data.trades.length} from ESPN, points through week ${data.through}, saved ${data.fetchedAt}`);
  } catch (err) {
    console.log(`::warning::Couldn't read trades from ESPN (${err.message}). Keeping the last good list.`);
    if (last) fs.writeFileSync(OUT, JSON.stringify(last));
  }
}
