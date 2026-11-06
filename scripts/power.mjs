// Power rankings formula, the same one the site uses.
export function computePower(P, throughWeek, W) {
  var reg = P.regSeasonWeeks || 99;
  var ids = P.teams.map(function (t) { return t.id; });
  var st = {};
  ids.forEach(function (id) { st[id] = { w: 0, l: 0, t: 0, pts: {} }; });
  var pairs = {}, weekly = {};
  P.games.forEach(function (g) { if (g.p <= reg) pairs[g.p + ":" + g.h[0]] = [g.p, g.h[0], g.a[0]]; });
  (P.upcoming || []).forEach(function (u) { if (u[0] <= reg) pairs[u[0] + ":" + u[1]] = u; });
  P.games.forEach(function (g) {
    if (g.p > throughWeek || g.p > reg) return;
    var h = st[g.h[0]], a = st[g.a[0]];
    h.pts[g.p] = g.h[1]; a.pts[g.p] = g.a[1];
    (weekly[g.p] = weekly[g.p] || []).push([g.h[0], g.h[1]], [g.a[0], g.a[1]]);
    if (g.w === "H") { h.w++; a.l++; } else if (g.w === "A") { a.w++; h.l++; } else { h.t++; a.t++; }
  });
  var weeks = Object.keys(weekly).map(Number).sort(function (a, b) { return a - b; });
  if (!weeks.length) return null;
  weeks.forEach(function (p) {
    var arr = weekly[p].slice().sort(function (x, y) { return y[1] - x[1]; });
    var half = Math.floor(arr.length / 2);
    arr.forEach(function (x, i) { if (i < half) st[x[0]].w++; else st[x[0]].l++; });
  });
  var formWeeks = weeks.slice(-(W.formWeeks || 3));
  function avg(list) { return list.length ? list.reduce(function (s, v) { return s + v; }, 0) / list.length : 0; }
  var raw = {};
  ids.forEach(function (id) {
    var s = st[id];
    var g = s.w + s.l + s.t;
    raw[id] = {
      w: s.w, l: s.l, t: s.t,
      pct: g ? (s.w + 0.5 * s.t) / g : 0,
      ppg: avg(weeks.map(function (p) { return s.pts[p] || 0; })),
      form: avg(formWeeks.map(function (p) { return s.pts[p] || 0; }))
    };
  });
  var rem = Object.keys(pairs).map(function (k) { return pairs[k]; }).filter(function (u) { return u[0] > throughWeek; });
  var hasRem = rem.length > 0;
  ids.forEach(function (id) {
    var opp = [];
    rem.forEach(function (u) { if (u[1] === id) opp.push(raw[u[2]].ppg); else if (u[2] === id) opp.push(raw[u[1]].ppg); });
    raw[id].opp = opp.length ? avg(opp) : null;
    raw[id].left = opp.length;
  });
  function scale(key, invert) {
    var vals = ids.map(function (id) { return raw[id][key]; }).filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var out = {};
    ids.forEach(function (id) {
      var v = raw[id][key];
      if (v == null) { out[id] = null; return; }
      var x = hi === lo ? 50 : (v - lo) / (hi - lo) * 100;
      out[id] = invert ? 100 - x : x;
    });
    return out;
  }
  var R = scale("pct"), S = scale("ppg"), F = scale("form"), O = hasRem ? scale("opp", true) : null;
  var list = ids.map(function (id) {
    var parts = [[W.record, R[id]], [W.scoring, S[id]], [W.form, F[id]]];
    if (O && O[id] != null) parts.push([W.schedule, O[id]]);
    var wsum = parts.reduce(function (s, p) { return s + p[0]; }, 0);
    var score = parts.reduce(function (s, p) { return s + p[0] * p[1]; }, 0) / wsum;
    return { id: id, score: score, rec: R[id], scr: S[id], frm: F[id], sch: O ? O[id] : null, raw: raw[id] };
  });
  list.sort(function (a, b) { return b.score - a.score || b.raw.ppg - a.raw.ppg; });
  return { week: weeks[weeks.length - 1], formWeeks: formWeeks, list: list };
}
