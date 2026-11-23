// After a deploy that GitHub Pages reports as a success, makes sure the live site actually
// changed. On Nov 8, 2026, Pages reported every deploy as a success while the live site
// stayed on the 8:28 AM version for hours; a fresh, empty commit got it moving again.
//
// This compares the live data/stamp.json with the one just built, for up to 2 minutes. When
// they match it says so (step output current=true), and only then does the workflow send
// alerts (Nov 20, 2026). If the live site is 5+ minutes behind, it pushes an empty
// "Republish the site (automatic)" commit, at most once every 15 minutes, and starts a fresh
// run with a fresh trade read. A normal one-run lag isn't flagged.
import fs from "node:fs";
import { execSync } from "node:child_process";

const LIVE = process.env.LIVE_STAMP_URL || "https://airbryar.github.io/bbfc/data/stamp.json";
const BEHIND_MIN = 5;
const COOLDOWN_MIN = 15;

const built = JSON.parse(fs.readFileSync("_site/data/stamp.json", "utf8")).fetchedAt;

async function liveStamp() {
  try {
    const r = await fetch(`${LIVE}?ts=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return r.ok ? (await r.json()).fetchedAt : null;
  } catch {
    return null;
  }
}

const TRIES = Number(process.env.CHECK_LIVE_TRIES || 12);
let live = null;
for (let i = 0; i < TRIES; i++) {
  live = await liveStamp();
  if (live === built) break;
  if (i < TRIES - 1) await new Promise((done) => setTimeout(done, 10000));
}

if (live === built) {
  console.log(`Live site is current (${built})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "current=true\n");
} else if (!live) {
  console.log("::warning::Couldn't read the live site's stamp; not doing anything");
} else {
  const behind = (Date.parse(built) - Date.parse(live)) / 60000;
  if (!(behind >= BEHIND_MIN)) {
    console.log(`Live site is ${behind.toFixed(1)} min behind this build; normal`);
  } else {
    const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
    if (process.env.CHECK_LIVE_DRY) { console.log(`(dry run) would republish: ${behind.toFixed(1)} min behind`); process.exit(0); }
    sh("git fetch -q origin main");
    const recent = sh(`git log origin/main --since="${COOLDOWN_MIN} minutes ago" --grep="^Republish the site" --format=%H -1`);
    if (recent) {
      console.log(`::warning::Live site is ${Math.round(behind)} min behind, and a republish commit already went out in the last ${COOLDOWN_MIN} minutes`);
    } else {
      sh('git config user.name "github-actions[bot]"');
      sh('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
      sh("git pull -q --rebase --autostash origin main"); // keeps .espn-ok etc. for the next step
      sh('git commit -q --allow-empty -m "Republish the site (automatic: the live site stopped changing)"');
      sh("git push -q origin HEAD:main");
      console.log(`::warning::Live site was ${Math.round(behind)} min behind (live ${live}, built ${built}); pushed a fresh commit to republish`);
      // A push made with the workflow's own token doesn't start a run by itself
      const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/update.yml/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ ref: "main", inputs: { trades: "true" } }),
      }).catch(() => null);
      console.log(r && r.ok ? "Started a fresh run" : "::warning::Couldn't start a fresh run; the next scheduled one will republish");
    }
  }
}
