// Playoff odds: plays out the rest of the regular season many times and counts how often
// each team finishes in the playoff spots (and in the bye spots). Used by build.mjs, so
// the main page and the team pages show the same numbers.
//
// How a simulated week works:
// - Each team's score is drawn around its scoring average so far (pulled a little toward
//   the league average, since eight weeks is a small sample), with the league's typical
//   week-to-week swing.
// - For the week in progress, ESPN's live projection is the center and the swing shrinks
//   as games finish, so the odds move during games.
// - Head-to-head games come from the schedule; when the league plays median games, the
//   top half of the week's scores each win one too.
// Final order: wins, then the league's tiebreaker from ESPN (head-to-head record, then
// points scored, if the league breaks ties head-to-head; otherwise points scored).
// Seeded, so the same data gives the same odds.
//
// "Clinched" and "Eliminated" are only set when the math guarantees it, not from the
// simulation: clinched if at most (spots - 1) other teams can still reach this team's win
// total; eliminated if at least (spots) teams already have more wins than it can reach.
//
// "What it takes": each team's odds after each possible result this week (2-0, 1-1 or 0-2
// with median games; a win or a loss without), from the simulations where that happened.
// "in" / "out" replace the number when the math guarantees it, using the same tests with
// this week's result added (and, after a head-to-head win, one less win for the opponent).

const SIMS = 10000;
const SHRINK = 0.8; // how much of a team's difference from the league average to trust

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeOdds(E) {
  const reg = E.regSeasonWeeks || 14;
  const spots = E.playoffTeams || 6;
  const cur = E.currentWeek;
  if (!E.teams || !E.teams.length || cur > reg) return null;
  const ids = E.teams.map((t) => t.id);

  // Weekly scores so far (finished regular-season games)
  const scores = Object.fromEntries(ids.map((id) => [id, []]));
  let finishedWeeks = 0;
  for (const g of E.games || []) {
    if (g.p > reg) continue;
    scores[g.h[0]].push(g.h[1]);
    scores[g.a[0]].push(g.a[1]);
    finishedWeeks = Math.max(finishedWeeks, g.p);
  }
  const all = ids.flatMap((id) => scores[id]);
  if (all.length < ids.length) return null; // too early in the season to say anything
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const league = mean(all);
  const center = {};
  let sq = 0, n = 0;
  for (const id of ids) {
    const m = mean(scores[id]);
    center[id] = league + SHRINK * (m - league);
    for (const v of scores[id]) { sq += (v - m) ** 2; n++; }
  }
  const swing = Math.sqrt(sq / Math.max(1, n - ids.length));

  // Does this league play median games? (records have two games a week if so)
  const team = Object.fromEntries(E.teams.map((t) => [t.id, t]));
  const medianOn = E.teams.some((t) => t.w + t.l + (t.t || 0) > finishedWeeks + 0.5);

  // Weeks left: the week in progress (with live projections) and the ones after it
  const live = {};
  for (const m of E.current || []) for (const s of [m.h, m.a]) live[s[0]] = { pts: s[1], proj: s[2] };
  const weeks = {};
  for (const u of E.upcoming || []) if (u[0] >= cur && u[0] <= reg) (weeks[u[0]] = weeks[u[0]] || []).push([u[1], u[2]]);
  const weekList = Object.keys(weeks).map(Number).sort((a, b) => a - b);
  const left = weekList.length;

  // Tiebreaker: head-to-head wins between tied teams, when the league uses that
  const rule = E.seedingRule || "TOTAL_POINTS_SCORED";
  const byH2h = rule === "H2H_RECORD";
  const baseH2h = {}; // "x|y" -> times x beat y this season
  if (byH2h) for (const g of E.games || []) {
    if (g.p > reg || g.w === "T") continue;
    const [win, lose] = g.w === "H" ? [g.h[0], g.a[0]] : [g.a[0], g.h[0]];
    baseH2h[win + "|" + lose] = (baseH2h[win + "|" + lose] || 0) + 1;
  }

  const made = Object.fromEntries(ids.map((id) => [id, 0]));
  const bye = Object.fromEntries(ids.map((id) => [id, 0]));
  const winsSum = Object.fromEntries(ids.map((id) => [id, 0]));
  // This week's result in each simulation, and how often the team made it after each one
  const perWeek0 = medianOn ? 2 : 1;
  const wkCount = Object.fromEntries(ids.map((id) => [id, new Array(perWeek0 + 1).fill(0)]));
  const wkMade = Object.fromEntries(ids.map((id) => [id, new Array(perWeek0 + 1).fill(0)]));
  let pow = 1;
  while (pow < spots) pow *= 2;
  const byes = spots >= 3 ? pow - spots : 0;
  const rand = rng(20260 + cur * 101 + Math.round(league));
  const normal = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };

  for (let s = 0; s < SIMS; s++) {
    const w = {}, pf = {}, wk = {};
    for (const id of ids) { w[id] = team[id].w + (team[id].t || 0) / 2; pf[id] = team[id].pf; }
    const h2h = byH2h ? Object.assign({}, baseH2h) : null;
    for (const p of weekList) {
      const sc = {};
      for (const id of ids) {
        const L = p === cur ? live[id] : null;
        if (L && L.proj > 0) {
          const remaining = Math.min(1, Math.max(0, (L.proj - L.pts) / L.proj));
          sc[id] = L.proj + normal() * swing * Math.sqrt(remaining);
        } else {
          sc[id] = center[id] + normal() * swing;
        }
        pf[id] += sc[id];
      }
      const before = p === cur ? Object.assign({}, w) : null;
      for (const [h, a] of weeks[p]) {
        if (sc[h] > sc[a]) { w[h]++; if (h2h) h2h[h + "|" + a] = (h2h[h + "|" + a] || 0) + 1; }
        else if (sc[a] > sc[h]) { w[a]++; if (h2h) h2h[a + "|" + h] = (h2h[a + "|" + h] || 0) + 1; }
        else { w[h] += 0.5; w[a] += 0.5; }
      }
      if (medianOn) {
        const order = ids.slice().sort((x, y) => sc[y] - sc[x]);
        for (let i = 0; i < Math.floor(order.length / 2); i++) w[order[i]]++;
      }
      if (before) for (const id of ids) wk[id] = Math.floor(w[id] - before[id]); // a tie counts as no win
    }
    const final = ids.slice().sort((x, y) => w[y] - w[x] || (h2h ? (h2h[y + "|" + x] || 0) - (h2h[x + "|" + y] || 0) : 0) || pf[y] - pf[x]);
    final.forEach((id, i) => {
      if (id in wk) { wkCount[id][wk[id]]++; if (i < spots) wkMade[id][wk[id]]++; }
      if (i < spots) made[id]++;
      if (i < byes) bye[id]++;
      winsSum[id] += w[id];
    });
  }

  // Mathematical certainty, from wins alone (ties count against the team)
  const perWeek = medianOn ? 2 : 1;
  const maxGain = left * perWeek;
  const wins = (id) => team[id].w + (team[id].t || 0) / 2;
  const out = {};
  for (const id of ids) {
    const others = ids.filter((o) => o !== id);
    const canReach = others.filter((o) => wins(o) + maxGain >= wins(id)).length;
    const alreadyAbove = others.filter((o) => wins(o) > wins(id) + maxGain).length;
    const games = finishedWeeks * perWeek + maxGain;
    const projW = winsSum[id] / SIMS;
    // What it takes this week: index 0 is the best result (2-0), the last is the worst
    let week = null;
    if (left > 0 && weekList[0] === cur) {
      const opp = (weeks[cur].find(([h, a]) => h === id || a === id) || []).find((x) => x !== id);
      week = [];
      for (let k = perWeek; k >= 0; k--) {
        const mine = wins(id) + k;
        const reach = (o) => wins(o) + maxGain - (o === opp && k === perWeek ? 1 : 0);
        if (others.filter((o) => reach(o) >= mine).length <= spots - 1) { week.push("in"); continue; }
        if (others.filter((o) => wins(o) > mine + (left - 1) * perWeek).length >= spots) { week.push("out"); continue; }
        const nSims = wkCount[id][k];
        week.push(nSims >= SIMS / 100 ? Math.round((wkMade[id][k] / nSims) * 1000) / 1000 : null); // too rare to say
      }
    }
    out[id] = {
      playoffs: made[id] / SIMS,
      bye: byes ? bye[id] / SIMS : null,
      projW: Math.round(projW),
      projL: games - Math.round(projW),
      clinched: canReach <= spots - 1,
      eliminated: alreadyAbove >= spots,
      week,
    };
  }
  return { sims: SIMS, weeksLeft: left, week: cur, spots, byes, medianOn, tiebreak: rule, teams: out };
}
