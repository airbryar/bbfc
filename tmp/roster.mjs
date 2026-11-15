// Temporary: reads The Mouse Rats' roster and NFL bye weeks, writes tmp/roster.json.
import fs from "node:fs";
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const LEAGUE = `${ROOT}/seasons/2026/segments/0/leagues/965722644`;
const H = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" };
const auth = { ...H, Cookie: `espn_s2=${(process.env.ESPN_S2 || "").trim()}; SWID=${(process.env.ESPN_SWID || "").trim()}` };
const get = async (u, h) => { const r = await fetch(u, { headers: h }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
const lg = await get(`${LEAGUE}?view=mRoster&view=mTeam&view=mStatus`, auth);
const pro = await get(`${ROOT}/seasons/2026?view=proTeamSchedules_wl`, H);
const teamsPro = {};
for (const t of pro.settings.proTeams) teamsPro[t.id] = { ab: t.abbrev, bye: t.byeWeek };
const POS = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };
const SLOT = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 16: "D/ST", 17: "K", 23: "FLEX", 20: "BE", 21: "IR" };
const out = { at: new Date().toISOString(), week: lg.status && lg.status.currentMatchupPeriod, byes: {}, teams: [] };
for (const [id, t] of Object.entries(teamsPro)) if (t.bye) (out.byes[t.bye] = out.byes[t.bye] || []).push(t.ab);
for (const tm of lg.teams) {
  const name = tm.name || `${tm.location || ""} ${tm.nickname || ""}`.trim();
  out.teams.push({ id: tm.id, name, players: (tm.roster?.entries || []).map((e) => {
    const p = e.playerPoolEntry.player; const pt = teamsPro[p.proTeamId] || {};
    return { n: p.fullName, pos: POS[p.defaultPositionId] || "", slot: SLOT[e.lineupSlotId] || String(e.lineupSlotId), nfl: pt.ab || "FA", bye: pt.bye || null, inj: p.injuryStatus || null };
  }) });
}
fs.writeFileSync("tmp/roster.json", JSON.stringify(out, null, 1));
console.log("ok", out.teams.length, "teams");
