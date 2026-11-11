import fs from "node:fs";
import { execSync } from "node:child_process";
execSync("FORCE_TRADES=1 DEBUG_TRADES=1 node scripts/fetch-trades.mjs", { stdio: "inherit", env: process.env });
const t = JSON.parse(fs.readFileSync("data/trades.json", "utf8"));
for (const x of t.trades) console.log("TRADE " + JSON.stringify({ date: x.date, at: new Date(x.at).toISOString(), week: x.week, got: x.received.map((r) => r.team + ": " + r.players.map((p) => p.player + " " + p.ptsForNewTeamSince).join(", ")) }));
console.log("TOTAL " + t.trades.length + " pending-field " + ("pending" in t));
