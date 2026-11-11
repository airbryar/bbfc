import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const L = `${ROOT}/seasons/${cfg.league.season}/segments/0/leagues/${cfg.league.id}`;
const H = { Accept: "application/json", Cookie: `espn_s2=${process.env.ESPN_S2.trim()}; SWID=${process.env.ESPN_SWID.trim()}` };
const get = async (u, f) => (await fetch(u, { headers: f ? { ...H, "X-Fantasy-Filter": JSON.stringify(f) } : H })).json();
for (const sp of [8, 9, 10]) {
  for (const f of [{ transactions: { filterType: { value: ["TRADE_ACCEPT"] } } }, { transactions: { filterType: { value: ["TRADE_ACCEPT", "TRADE_PROPOSAL", "TRADE_UPHOLD", "TRADE_VETO", "TRADE_DECLINE"] }, filterStatus: { value: ["EXECUTED", "PENDING", "CANCELED", "FAILED_INVALIDPLAYERSOURCE", "VETOED"] } } }, null]) {
    const d = await get(`${L}?view=mTransactions2&scoringPeriodId=${sp}`, f || undefined);
    const xs = (d.transactions || []).filter((x) => String(x.type).startsWith("TRADE"));
    console.log(`CHK sp=${sp} filter=${f ? (f.transactions.filterStatus ? "typed+status" : "typed") : "none"} n=${(d.transactions || []).length} trades=` + xs.map((x) => `${x.type}/${x.status}/p${x.proposedDate}/x${x.processDate}/${(x.items || []).filter((i) => i.type === "TRADE").map((i) => i.playerId + ">" + i.toTeamId).join("+")}`).join(" ; "));
  }
}
