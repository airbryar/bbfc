// Runs only when both deploy tries in "Update the BBFC site" failed.
//
// A missed deploy isn't an emergency: the live site keeps showing the last version, and the
// next run (a minute later during games, otherwise within the hour) tries again. Nearly all
// misses are GitHub hiccups, like "No artifacts named github-pages were found" a few seconds
// after the upload (Nov 2026). Until Nov 21, 2026 the workflow failed the run here whenever
// the latest commit was already a "Republish" one, which check-live.mjs makes often, so
// GitHub emailed Bryar about almost every hiccup.
//
// Now this:
// 1. Pushes an empty "Republish the site (automatic)" commit and starts a fresh run, at most
//    once every 15 minutes (the same cooldown check-live.mjs uses). A fresh commit has
//    always gotten a stuck Pages site moving.
// 2. Fails the run (so GitHub emails Bryar) only when the live site has fallen 3+ hours
//    behind, and only if the last finished run didn't already fail, so a long outage sends
//    one email instead of one per run.
import fs from "node:fs";
import { execSync } from "node:child_process";

const LIVE = process.env.LIVE_STAMP_URL || "https://airbryar.github.io/bbfc/data/stamp.json";
const ALERT_HOURS = 3;
const COOLDOWN_MIN = 15;

const repo = process.env.GITHUB_REPOSITORY;
const api = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(10000),
  });
const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

// How far behind this build the live site is
const built = JSON.parse(fs.readFileSync("_site/data/stamp.json", "utf8")).fetchedAt;
let live = null;
try {
  const r = await fetch(`${LIVE}?ts=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (r.ok) live = (await r.json()).fetchedAt;
} catch {}
const behindH = live ? (Date.parse(built) - Date.parse(live)) / 3600e3 : null;
const behind = behindH === null ? "unknown" : behindH < 1 ? `${Math.max(0, Math.round(behindH * 60))} min` : `${behindH.toFixed(1)} hours`;

// 1. Republish with a fresh commit, at most once every 15 minutes. During games the live site
//    is only a run or two behind and the 5-minute schedule tries again soon, so it's only
//    worth it once the live site is 5+ minutes behind (or can't be read).
if (process.env.MISSED_DEPLOY_DRY) {
  console.log(`(dry run) live site behind: ${behind}`);
} else if (behindH !== null && behindH * 60 < 5) {
  console.log(`Live site is only ${behind} behind; the next run will try again`);
} else {
  try {
    sh("git fetch -q origin main");
    const recent = sh(`git log origin/main --since="${COOLDOWN_MIN} minutes ago" --grep="^Republish the site" --format=%H -1`);
    if (recent) {
      console.log(`A republish commit already went out in the last ${COOLDOWN_MIN} minutes; the next run will try again`);
    } else {
      sh('git config user.name "github-actions[bot]"');
      sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
      sh("git stash push --include-untracked -q || true");
      sh("git pull -q --rebase origin main");
      sh('git commit -q --allow-empty -m "Republish the site (automatic)"');
      sh("git push -q origin HEAD:main");
      // The fresh run re-reads trades from ESPN. Otherwise it keeps the live site's copy, which
      // this missed deploy never updated (Nov 20, 2026: a new trade dropped back off the site).
      const r = await api("/actions/workflows/update.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { trades: "true" } }) }).catch(() => null);
      console.log(r && r.ok ? "Pushed a fresh commit and started a new run" : `Pushed a fresh commit; couldn't start a new run (${r ? r.status : "no answer"})`);
    }
  } catch (err) {
    console.log(`Couldn't push a fresh commit (${err.message}); the next run will try again`);
  }
}

// 2. Only a long outage fails the run
if (behindH === null || behindH < ALERT_HOURS) {
  console.log(`::warning::GitHub Pages didn't take this deploy (live site behind: ${behind}). The site still works; the next run tries again.`);
  process.exit(0);
}
let alreadyReported = false;
try {
  const r = await api("/actions/workflows/update.yml/runs?status=completed&per_page=20");
  if (r.ok) {
    const last = ((await r.json()).workflow_runs || []).find((x) => x.conclusion === "success" || x.conclusion === "failure");
    alreadyReported = !!last && last.conclusion === "failure";
  }
} catch {}
if (alreadyReported) {
  console.log(`::warning::The live site is still ${behind} behind; the email about it already went out.`);
  process.exit(0);
}
console.log(`::error::The live site hasn't updated in ${behind}: GitHub Pages keeps refusing to deploy. Check githubstatus.com, then the latest runs.`);
process.exit(1);
