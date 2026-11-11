import fs from "node:fs";
import { execSync } from "node:child_process";
const cfg = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const ROOT = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const L = `${ROOT}/seasons/${cfg.league.season}/segments/0/leagues/${cfg.league.id}`;
const H = { Accept: "application/json", Cookie: `espn_s2=${process.env.ESPN_S2.trim()}; SWID=${process.env.ESPN_SWID.trim()}` };
const get = async (u, f) => (await fetch(u, { headers: f ? { ...H, "X-Fantasy-Filter": JSON.stringify(f) } : H })).json();
const a = await get(`${L}?view=mStatus`);
const CUR = a.status.currentMatchupPeriod;
const d = await get(`${L}?view=mTransactions2&scoringPeriodId=${CUR}`);
const xs = (d.transactions || []).filter((x) => String(x.type).startsWith("TRADE")).sort((p, q) => (q.processDate || q.proposedDate || 0) - (p.processDate || p.proposedDate || 0));
for (const x of xs.slice(0, 4)) {
  const y = { ...x }; delete y.memberId;
  console.log("RAW " + JSON.stringify(y).replace(/"memberId":"[^"]*",?/g, ""));
}
execSync("FORCE_TRADES=1 node scripts/fetch-trades.mjs", { stdio: "inherit", env: process.env });
const t = JSON.parse(fs.readFileSync("data/trades.json", "utf8"));
console.log("TOP " + JSON.stringify(t.trades[0]));
console.log("PENDING " + JSON.stringify(t.pending));
