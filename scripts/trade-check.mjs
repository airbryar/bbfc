import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const L = `${ROOT}/seasons/${cfg.league.season}/segments/0/leagues/${cfg.league.id}`;
const H = { Accept: "application/json", Cookie: `espn_s2=${process.env.ESPN_S2.trim()}; SWID=${process.env.ESPN_SWID.trim()}` };
const get = async (u, f) => (await fetch(u, { headers: f ? { ...H, "X-Fantasy-Filter": JSON.stringify(f) } : H })).json();
const a = await get(`${L}?view=mTeam&view=mStatus&view=mSettings`);
const tn = Object.fromEntries(a.teams.map((t) => [t.id, t.name.trim()]));
const CUR = a.status.currentMatchupPeriod;
console.log("Week", CUR, "review:", JSON.stringify({ veto: a.settings.tradeSettings?.vetoVotesRequired, revHrs: a.settings.tradeSettings?.revisionHours, allowOutOfUniverse: undefined }));
const et = (ms) => ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }) : "-";
const ids = new Set(); const rows = [];
for (const sp of [CUR - 1, CUR]) {
  const d = await get(`${L}?view=mTransactions2&scoringPeriodId=${sp}`, { transactions: { filterType: { value: ["TRADE_PROPOSAL","TRADE_ACCEPT","TRADE_UPHOLD","TRADE_VETO"] } } });
  for (const x of d.transactions || []) {
    if (!String(x.type).startsWith("TRADE")) continue;
    for (const i of x.items || []) ids.add(i.playerId);
    rows.push({ sp, ...x });
  }
}
const ps = ids.size ? await get(`${ROOT}/seasons/${cfg.league.season}/players?view=players_wl`, { filterIds: { value: [...ids] } }) : [];
const pn = Object.fromEntries((Array.isArray(ps) ? ps : []).map((p) => [p.id, p.fullName]));
rows.sort((x, y) => (y.proposedDate || 0) - (x.proposedDate || 0));
for (const x of rows.slice(0, 15)) {
  console.log(`[wk ${x.sp}] ${x.type} ${x.status} id=${String(x.id).slice(0,8)} rel=${String(x.relatedTransactionId||'').slice(0,8)} skip=${x.skipTransactionCounters} proposed ${et(x.proposedDate)} | process ${et(x.processDate)} | ` +
    (x.items || []).map((i) => `${pn[i.playerId] || i.playerId}: ${tn[i.fromTeamId] || i.fromTeamId} -> ${tn[i.toTeamId] || i.toTeamId}`).join("; "));
}
