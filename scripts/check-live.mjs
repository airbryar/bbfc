// After a deploy that GitHub Pages reports as a success, makes sure the live site actually
// changed. On Nov 8, 2026, Pages reported every deploy as a success while the live site
// stayed on the 8:28 AM version for hours; a fresh, empty commit got it moving again.
//
// This compares the live data/stamp.json with the one just built. If the live site is 5+
// minutes behind, it pushes an empty "Republish the site (automatic)" commit, at most once
// every 15 minutes, which starts a fresh run. A normal one-run lag isn't flagged.
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

let live = null;
for (let i = 0; i < 3; i++) {
  live = await liveStamp();
  if (live === built) break;
  await new Promise((done) => setTimeout(done, 4000));
}

if (live === built) {
  console.log(`Live site is current (${built})`);
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
      sh("git stash push --include-untracked -q || true");
      sh("git pull -q --rebase origin main");
      sh('git commit -q --allow-empty -m "Republish the site (automatic: the live site stopped changing)"');
      sh("git push -q origin HEAD:main");
      console.log(`::warning::Live site was ${Math.round(behind)} min behind (live ${live}, built ${built}); pushed a fresh commit to republish`);
    }
  }
}
