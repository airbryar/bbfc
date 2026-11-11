// Sends BBFC alerts through OneSignal when something new shows up in the league data:
// a trade, a Newspaper edition, an episode of The Poddy, or a week going final.
// Each alert goes only to people who switched that kind on in the site's Alerts panel
// (saved as OneSignal tags: trades, news, poddy, final, and team = their team's id).
//
// What has already been announced is kept in data/alerts-sent.json, which the update
// workflow saves to the repository, so nothing is sent twice. The first time this runs it
// only records what's there now and sends nothing, so old news never goes out.
//
// Quiet hours: nothing is sent between 10 PM and 7 AM Eastern. Anything new waits and goes
// out with the first update after 7 (the 5 AM Newspaper, overnight trades, Tuesday finals).
//
// `node scripts/notify.mjs --test` sends one test alert to everyone who has alerts on.
import fs from "node:fs";
import { addFaab, faabLabel } from "./trade-faab.mjs";

const LEDGER = "data/alerts-sent.json";
const SITE = "https://airbryar.github.io/bbfc/";
const league = JSON.parse(fs.readFileSync("data/league.json", "utf8"));
const APP_ID = league.onesignalAppId;
const KEY = (process.env.ONESIGNAL_API_KEY || "").trim();
const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };

if (!APP_ID || !KEY) {
  console.log("Alerts: not set up yet (needs onesignalAppId in data/league.json and the ONESIGNAL_API_KEY secret)");
  process.exit(0);
}

async function send({ heading, text, path, tag, value = "1", segments }) {
  const body = {
    app_id: APP_ID,
    target_channel: "push",
    headings: { en: heading },
    contents: { en: text },
    web_url: SITE + (path || ""),
    chrome_web_icon: SITE + "icons/icon-192.png",
  };
  if (segments) body.included_segments = segments;
  else body.filters = [{ field: "tag", key: tag, relation: "=", value: String(value) }];
  const r = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OneSignal answered ${r.status}: ${JSON.stringify(out.errors || out).slice(0, 200)}`);
  // A 200 with no id means nobody has that alert switched on yet; that still counts as sent
  const who = segments ? segments.join(", ") : tag + "=" + value;
  if (out.id) console.log(`Alerts: sent "${heading}" (${who})`);
  else console.log(`Alerts: "${heading}" had no one to go to (${who}): ${JSON.stringify(out.errors || "").slice(0, 160)}`);
  return out;
}

// --test: one alert to everyone with alerts on
if (process.argv.includes("--test")) {
  const test = { heading: "BBFC alerts are on", text: "This is a test. You'll get the alerts you picked in the Alerts panel.", path: "" };
  let out = null;
  try { out = await send({ ...test, segments: ["Total Subscriptions"] }); }
  catch (err) { console.log(`Alerts: ${err.message}`); }
  if (!out || !out.id) {
    console.log("Alerts: trying OneSignal's older name for everyone");
    out = await send({ ...test, segments: ["Subscribed Users"] });
  }
  if (!out.id) { console.log("::error::The test alert had no one to go to. Turn alerts on from the BBFC Home Screen icon first."); process.exit(1); }
  process.exit(0);
}

// What's in the data right now
const espn = read("data/espn.json", { teams: [], games: [] });
const tradesFile = addFaab(read("data/trades.json", { trades: [] }), league);
const news = read("data/news.json", { editions: [] });
const pod = read("data/pod.json", { episodes: [] });

const tradeKey = (t) => t.date + "|" + (t.received || []).map((r) => r.team + ":" + r.players.map((p) => p.player).join(",")).join("|");
// Who got whom, without the date
const dealKey = (t) => (t.received || []).map((r) => r.team + ":" + r.players.map((p) => p.player).sort().join(",")).sort().join("|");
const latestEdition = (news.editions || [])[0] || null;
const latestEpisode = (pod.episodes || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
const lastFinal = (espn.games || []).reduce((m, g) => Math.max(m, g.p), 0);
const now = {
  trades: (tradesFile.trades || []).map(tradeKey),
  news: latestEdition ? latestEdition.id : null,
  poddy: latestEpisode ? latestEpisode.url : null,
  final: lastFinal,
};

const sent = read(LEDGER, null);
if (!sent) {
  fs.writeFileSync(LEDGER, JSON.stringify({ ...now, startedAt: new Date().toISOString() }, null, 1) + "\n");
  console.log("Alerts: first run, recorded what's already out there; nothing sent");
  process.exit(0);
}

const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(new Date()));
if (etHour >= 22 || etHour < 7) {
  console.log(`Alerts: quiet hours (${etHour}:00 Eastern), anything new waits until 7 AM`);
  process.exit(0);
}

const teamName = Object.fromEntries((espn.teams || []).map((t) => [t.id, t.name]));
const pts = (n) => Number(n || 0).toFixed(2);
const names = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
const playerName = (p) => String(p.player).replace(/ \([A-Z\/]+\)$/, "");
let changed = false;
let failures = 0;
async function attempt(label, fn) {
  try { await fn(); return true; }
  catch (err) { failures++; console.log(`::warning::Alerts: couldn't send ${label} (${err.message})`); return false; }
}

// Trades (same wording as the site's ticker)
function tradeText(t) {
  const got = (t.received || []).filter((r) => r.players && r.players.length);
  let text = got.map((r) => `${names(r.players.map(playerName))} to ${r.team}`).join(" · ");
  if (got.length === 1 && (t.teams || []).length > 1) text += " for " + faabLabel(t);
  return text;
}
const known = new Set(sent.trades || []);
// A trade's date can change (UTC to Eastern in Nov 2026; then dated by acceptance, not when it
// went through), so a deal already sent is recognized by who got whom, whatever its date.
// Deals alerted while they were still "pending" (Nov 10-11, 2026) count too.
const dealOfKey = (k) => k.slice(k.indexOf("|") + 1).split("|").map((seg) => { const i = seg.indexOf(":"); return seg.slice(0, i) + ":" + seg.slice(i + 1).split(",").sort().join(","); }).sort().join("|");
const knownDeals = new Set([...[...known].map(dealOfKey), ...(sent.pending || [])]);
const isKnown = (t) => known.has(tradeKey(t)) || knownDeals.has(dealKey(t));
let fresh = (tradesFile.trades || []).filter((t) => !known.has(tradeKey(t)));
// Already sent under another date: just record the new key, no second alert
const quiet = fresh.filter(isKnown);
if (quiet.length) { quiet.forEach((t) => known.add(tradeKey(t))); sent.trades = [...known]; changed = true; }
fresh = fresh.filter((t) => !isKnown(t));
if (fresh.length > 3) {
  // A big batch (say, the list was rebuilt) gets one summary instead of a flood
  if (await attempt("trades", () => send({ heading: "Trade alert", text: `${fresh.length} new trades. See them in the Trade Center.`, path: "#trades", tag: "trades" }))) {
    fresh.forEach((t) => known.add(tradeKey(t)));
  }
} else {
  for (const t of fresh) {
    const text = tradeText(t);
    if (await attempt("a trade", () => send({ heading: "Trade alert", text, path: "#trades", tag: "trades" }))) known.add(tradeKey(t));
  }
}
if (fresh.length) { sent.trades = [...known]; changed = true; }

// Newspaper
if (now.news && now.news !== sent.news && latestEdition) {
  const lead = (latestEdition.stories || [])[0];
  const text = `${latestEdition.label}: ${lead ? lead.headline : "three new stories"}`;
  if (await attempt("the Newspaper", () => send({ heading: "BBFC Newspaper", text, path: "#news", tag: "news" }))) { sent.news = now.news; changed = true; }
}

// The Poddy
if (now.poddy && now.poddy !== sent.poddy && latestEpisode) {
  if (await attempt("The Poddy", () => send({ heading: "New episode of The Poddy", text: latestEpisode.title, path: "#podcast", tag: "poddy" }))) { sent.poddy = now.poddy; changed = true; }
}

// A week went final: a league-wide summary, then each team's own result
if (now.final > (sent.final || 0)) {
  const w = now.final;
  const games = (espn.games || []).filter((g) => g.p === w);
  const sides = games.flatMap((g) => [{ id: g.h[0], pts: g.h[1], opp: g.a[0], opp_pts: g.a[1], won: g.w === "H", tie: g.w === "T" }, { id: g.a[0], pts: g.a[1], opp: g.h[0], opp_pts: g.h[1], won: g.w === "A", tie: g.w === "T" }]);
  const reg = espn.regSeasonWeeks || 14;
  const scores = sides.map((s) => s.pts).sort((a, b) => b - a);
  const half = Math.floor(scores.length / 2);
  const median = w <= reg && half ? (scores[half - 1] + scores[half]) / 2 : null;
  const high = sides.slice().sort((a, b) => b.pts - a.pts)[0];
  let ok = true;
  if (high) {
    const text = `High score: ${teamName[high.id]}, ${pts(high.pts)}.` + (median != null ? ` Median: ${pts(median)}.` : "") + " See the standings and playoff odds.";
    ok = await attempt("the weekly results", () => send({ heading: `Week ${w} is final`, text, path: "#standings", tag: "final" }));
  }
  for (const s of sides) {
    const result = s.tie ? `You tied ${teamName[s.opp]} ${pts(s.pts)}–${pts(s.opp_pts)}` : s.won ? `You beat ${teamName[s.opp]} ${pts(s.pts)}–${pts(s.opp_pts)}` : `You lost to ${teamName[s.opp]} ${pts(s.pts)}–${pts(s.opp_pts)}`;
    const med = median == null ? "" : s.pts > median ? " and won your median game" : " and lost your median game";
    ok = (await attempt(`team ${s.id}'s result`, () => send({ heading: `Week ${w} final: ${teamName[s.id]}`, text: result + med + ".", path: `team.html?t=${s.id}`, tag: "team", value: s.id }))) && ok;
  }
  // Partial failures still count as sent, so a team's result never arrives twice
  sent.final = w;
  changed = true;
}

if (changed) {
  sent.updatedAt = new Date().toISOString();
  fs.writeFileSync(LEDGER, JSON.stringify(sent, null, 1) + "\n");
}
if (!changed && !failures) console.log("Alerts: nothing new");
