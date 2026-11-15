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
// simulation, and the math counts who still plays whom (certainty(), at the bottom):
// clinched if, even losing every game left, no (spots) other teams can all reach this
// team's win total; eliminated if, even winning every game left, (spots) other teams
// would still have more wins.
//
// "What it takes": each team's odds after each possible result this week (2-0, 1-1 or 0-2
// with median games; a win or a loss without), from the simulations where that happened.
// "in" / "out" replace the number when the math guarantees it, using the same tests with
// this week's result fixed (every way of getting it: a 1-1 week can be a head-to-head win
// or a median win).

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

  // Mathematical certainty (ties count against the team), using the schedule: see sure()
  const perWeek = medianOn ? 2 : 1;
  const maxGain = left * perWeek;
  const wins = (id) => team[id].w + (team[id].t || 0) / 2;
  const sure = certainty({ ids, wins, weeks, weekList, spots, medianOn });
  const LOSE = { h: false, m: false }, WIN = { h: true, m: !!medianOn };
  // The ways a team can have a given result this week: [won head-to-head, won median]
  const waysTo = (k) => !medianOn ? [{ h: k === 1, m: false }] : k === 2 ? [WIN] : k === 1 ? [{ h: true, m: false }, { h: false, m: true }] : [LOSE];
  const out = {};
  for (const id of ids) {
    const rest = (r) => weekList.slice(1).map(() => r);
    const clinched = sure.clinched(id, weekList.map(() => LOSE));
    const eliminated = !clinched && sure.eliminated(id, weekList.map(() => WIN));
    const games = finishedWeeks * perWeek + maxGain;
    const projW = winsSum[id] / SIMS;
    // What it takes this week: index 0 is the best result (2-0), the last is the worst.
    // A better result can only help, so once one result doesn't clinch, worse ones don't either.
    let week = null;
    if (left > 0 && weekList[0] === cur) {
      const ks = []; for (let k = perWeek; k >= 0; k--) ks.push(k);
      const isIn = {}, isOut = {};
      let still = true;
      for (const k of ks) {
        still = still && (clinched || waysTo(k).every((x) => sure.clinched(id, [x, ...rest(LOSE)])));
        isIn[k] = still;
      }
      still = true;
      for (const k of ks.slice().reverse()) {
        still = still && !isIn[k] && (eliminated || waysTo(k).every((x) => sure.eliminated(id, [x, ...rest(WIN)])));
        isOut[k] = still;
      }
      week = ks.map((k) => {
        if (isIn[k]) return "in";
        if (isOut[k]) return "out";
        const nSims = wkCount[id][k];
        return nSims >= SIMS / 100 ? Math.round((wkMade[id][k] / nSims) * 1000) / 1000 : null; // too rare to say
      });
    }
    out[id] = {
      playoffs: made[id] / SIMS,
      bye: byes ? bye[id] / SIMS : null,
      projW: Math.round(projW),
      projL: games - Math.round(projW),
      clinched,
      eliminated,
      week,
    };
  }
  return { sims: SIMS, weeksLeft: left, week: cur, spots, byes, medianOn, tiebreak: rule, teams: out };
}

// ---- Clinched and eliminated, counting who still plays whom ----
//
// Each remaining head-to-head game gives one win to one of its two teams, and each week the
// top half of the league wins a median game (one per team). So whether `spots` teams can all
// pass a team, or whether enough teams can be kept behind it, is a small flow problem, tried
// for every group of teams that could matter. This is what catches cases like two chasing
// teams who play each other, so they can't both win out.
//
// Left out to keep it a flow problem: the head-to-head winner always outscored the loser,
// so the loser can't win the median unless the winner did (between two other teams), and
// head-to-head ties. Leaving them out can only make it more cautious: a team might show
// Clinched or Eliminated a little later than the math allows, never too early.
//
// A plan gives the team's own results week by week: { h: won head-to-head, m: won median }.
// clinched(X, plan): no `spots` other teams can all finish with at least as many wins as X.
// eliminated(X, plan): there's no way to keep fewer than `spots` other teams above X
//   (a tie on wins might go X's way, so ties don't count against it here).
function certainty({ ids, wins, weeks, weekList, spots, medianOn }) {
  const half = medianOn ? Math.floor(ids.length / 2) : 0;
  const EPS = 1e-9, BIG = 1e9;

  // Team X's situation under a plan: its final wins, the wins its results hand to opponents,
  // the games left between other teams, and each week's open median spots.
  function scene(X, plan) {
    const T = wins(X) + plan.reduce((s, r) => s + (r.h ? 1 : 0) + (r.m ? 1 : 0), 0);
    const base = {}, games = [], slots = [], barred = [];
    weekList.forEach((p, i) => {
      const r = plan[i];
      let open = half - (r.m ? 1 : 0), bar = null;
      for (const [h, a] of weeks[p]) {
        if (h !== X && a !== X) { games.push([h, a]); continue; }
        const o = h === X ? a : h;
        if (!r.h) base[o] = (base[o] || 0) + 1; // X lost, so the opponent won
        if (medianOn && r.h && !r.m) bar = o; // X won but missed the median: the opponent scored less, so it missed too
        if (medianOn && !r.h && r.m) { base[o]++; open--; bar = o; } // X lost but made the median: the opponent made it too
      }
      slots.push(Math.max(0, open));
      barred.push(bar);
    });
    const others = ids.filter((o) => o !== X);
    const room = {}; // the most wins each other team can still add
    for (const o of others) room[o] = games.filter(([h, a]) => h === o || a === o).length + slots.filter((n, i) => n > 0 && barred[i] !== o).length;
    return { T, base, games, slots, barred, others, room };
  }

  // Can `spots` other teams all reach X's final wins?
  function canBePassed(X, plan) {
    const s = scene(X, plan);
    const need = {};
    for (const o of s.others) need[o] = Math.max(0, Math.ceil(s.T - wins(o) - (s.base[o] || 0) - EPS));
    const already = s.others.filter((o) => need[o] === 0).length;
    if (already >= spots) return true;
    const cand = s.others.filter((o) => need[o] > 0 && need[o] <= s.room[o]);
    const k = spots - already;
    if (cand.length < k) return false;
    for (const pick of choose(cand, k)) {
      const G = flow(), SRC = G.node(), SNK = G.node(), node = {};
      let total = 0;
      for (const o of pick) { node[o] = G.node(); G.add(node[o], SNK, need[o]); total += need[o]; }
      for (const [h, a] of s.games) {
        if (!(h in node) && !(a in node)) continue;
        const g = G.node(); G.add(SRC, g, 1);
        if (h in node) G.add(g, node[h], 1);
        if (a in node) G.add(g, node[a], 1);
      }
      s.slots.forEach((n, i) => {
        if (!n) return;
        const wk = G.node(); G.add(SRC, wk, n);
        for (const o of pick) if (s.barred[i] !== o) G.add(wk, node[o], 1);
      });
      if (G.run(SRC, SNK) >= total) return true;
    }
    return false;
  }

  // Can enough other teams be kept at or below X's final wins? Every remaining game's win and
  // every open median spot has to go to someone.
  function canStayAlive(X, plan) {
    const s = scene(X, plan);
    const size = ids.length - spots; // how many others must stay at or below X
    const cap = {};
    for (const o of s.others) cap[o] = Math.floor(s.T - wins(o) - (s.base[o] || 0) + EPS);
    const ok = s.others.filter((o) => cap[o] >= 0);
    if (ok.length < size) return false;
    const easy = ok.filter((o) => cap[o] >= s.room[o]); // can't pass X even winning everything
    if (easy.length >= size) return true;
    const hard = ok.filter((o) => cap[o] < s.room[o]);
    const total = s.games.length + s.slots.reduce((t, n) => t + n, 0);
    for (const pick of choose(hard, size - easy.length)) {
      const held = new Set(pick);
      const G = flow(), SRC = G.node(), SNK = G.node(), node = {};
      for (const o of s.others) { node[o] = G.node(); G.add(node[o], SNK, held.has(o) ? cap[o] : BIG); }
      for (const [h, a] of s.games) { const g = G.node(); G.add(SRC, g, 1); G.add(g, node[h], 1); G.add(g, node[a], 1); }
      s.slots.forEach((n, i) => {
        if (!n) return;
        const wk = G.node(); G.add(SRC, wk, n);
        for (const o of s.others) if (s.barred[i] !== o) G.add(wk, node[o], 1);
      });
      if (G.run(SRC, SNK) >= total) return true;
    }
    return false;
  }

  return {
    clinched: (X, plan) => !canBePassed(X, plan),
    eliminated: (X, plan) => !canStayAlive(X, plan),
  };
}

function* choose(arr, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    yield* choose(arr, k, i + 1, acc);
    acc.pop();
  }
}

// Max flow (Dinic's algorithm) on a small graph
function flow() {
  const head = [], to = [], cap = [], nxt = [];
  return {
    node() { head.push(-1); return head.length - 1; },
    add(u, v, c) {
      to.push(v); cap.push(c); nxt.push(head[u]); head[u] = to.length - 1;
      to.push(u); cap.push(0); nxt.push(head[v]); head[v] = to.length - 1;
    },
    run(s, t) {
      let total = 0;
      for (;;) {
        const level = new Array(head.length).fill(-1);
        level[s] = 0;
        const q = [s];
        for (let qi = 0; qi < q.length; qi++) {
          const u = q[qi];
          for (let e = head[u]; e !== -1; e = nxt[e]) if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; q.push(to[e]); }
        }
        if (level[t] < 0) return total;
        const it = head.slice();
        const push = (u, f) => {
          if (u === t) return f;
          for (; it[u] !== -1; it[u] = nxt[it[u]]) {
            const e = it[u], v = to[e];
            if (cap[e] > 0 && level[v] === level[u] + 1) {
              const d = push(v, Math.min(f, cap[e]));
              if (d > 0) { cap[e] -= d; cap[e ^ 1] += d; return d; }
            }
          }
          return 0;
        };
        let f;
        while ((f = push(s, Infinity)) > 0) total += f;
      }
    },
  };
}
