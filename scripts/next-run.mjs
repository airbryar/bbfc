// During game windows, starts the next update as soon as this one finishes,
// so scores refresh about once a minute instead of every 5 minutes.
// Outside game windows (or if ESPN couldn't be read) it does nothing, and the
// regular schedule takes over again.
import fs from "node:fs";

const league = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
if (league.liveEveryMinute === false) {
  console.log("Minute-by-minute updates are turned off in data/league.json");
  process.exit(0);
}
if (!fs.existsSync(".espn-ok")) {
  console.log("ESPN wasn't read this run, so not starting another right away");
  process.exit(0);
}

// Eastern time, whatever the runner's clock says
const parts = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    .formatToParts(new Date())
    .map((p) => [p.type, p.value])
);
const day = parts.weekday; // Sun, Mon, ...
const mins = Number(parts.hour) * 60 + Number(parts.minute);
const at = (h, m = 0) => h * 60 + m;

// Game windows in Eastern time, with a little room for late finishes.
const live =
  (day === "Thu" && mins >= at(19, 45)) ||
  (day === "Fri" && mins < at(1, 15)) ||
  (day === "Sun" && mins >= at(9, 15)) || // includes the London morning games
  (day === "Mon" && (mins < at(1, 15) || mins >= at(19, 45))) ||
  (day === "Tue" && mins < at(1, 15)) ||
  (day === "Sat" && mins >= at(12, 45)) ||
  (day === "Sun" && mins < at(1, 15));

if (!live) {
  console.log(`Not a game window (${day} ${parts.hour}:${parts.minute} ET); back to the regular schedule`);
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/update.yml/dispatches`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  body: JSON.stringify({ ref: "main" }),
});
console.log(r.ok ? `Game window (${day} ${parts.hour}:${parts.minute} ET): next update queued` : `::warning::Couldn't queue the next update (${r.status})`);
