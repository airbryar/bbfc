import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const { id: LID, season: S } = cfg.league;
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const L = `${ROOT}/seasons/${S}/segments/0/leagues/${LID}`;
const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0", Cookie: `espn_s2=${process.env.ESPN_S2.trim()}; SWID=${process.env.ESPN_SWID.trim()}` };
const get = async (u, f) => { const h = { ...H }; if (f) h["X-Fantasy-Filter"] = JSON.stringify(f); const r = await fetch(u, { headers: h }); if (!r.ok) throw new Error(r.status + " " + u); return r.json(); };
const pv = await get(`${L}?view=mPendingTransactions&view=mTeam&view=mSettings`);
const tn = Object.fromEntries(pv.teams.map((t) => [t.id, t.name.trim()]));
console.log("reviewHours", (pv.settings.tradeSettings || {}).revisionHours);
const pend = (pv.pendingTransactions || []).filter((x) => (x.items || []).some((i) => i.type === "TRADE"));
const ids = new Set();
for (const x of pend) {
  console.log("PENDING", x.type, x.status, "proposed", new Date(x.proposedDate).toISOString(), "process", x.processDate ? new Date(x.processDate).toISOString() : null);
  for (const i of x.items) { if (i.type === "TRADE") { ids.add(i.playerId); console.log("  ", i.playerId, tn[i.fromTeamId], "->", tn[i.toTeamId]); } }
}
const teams = new Set();
for (const x of pend) for (const i of x.items) { teams.add(i.fromTeamId); teams.add(i.toTeamId); }
for (let w = 1; w <= 11; w++) {
  const d = await get(`${L}?view=mMatchupScore&view=mScoreboard&scoringPeriodId=${w}`, { schedule: { filterMatchupPeriodIds: { value: [w] } } });
  for (const m of d.schedule || []) {
    if (m.matchupPeriodId !== w) continue;
    for (const side of [m.home, m.away]) {
      if (!side) continue;
      const ros = side.rosterForCurrentScoringPeriod || { entries: [] };
      for (const e of ros.entries || []) {
        if (!ids.has(e.playerId)) continue;
        const pe = e.playerPoolEntry || {}; const p = pe.player || {};
        const proj = ((p.stats || []).find((s) => s.statSourceId === 1 && s.scoringPeriodId === w) || {}).appliedTotal;
        console.log(`W${w}`, p.fullName, "|", tn[side.teamId], "| slot", e.lineupSlotId, "| pts", pe.appliedStatTotal, "| proj", proj, "| inj", p.injuryStatus);
      }
    }
  }
}
