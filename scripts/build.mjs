// Builds the site into _site/: the page with today's data baked in, plus small
// data files the page checks once a minute to know when to refresh itself.
import fs from "node:fs";
import { computeOdds } from "./odds.mjs";
import { computePower } from "./power.mjs";
import { shownWeek } from "./show-week.mjs";
import { addFaab } from "./trade-faab.mjs";

const read = (p) => fs.readFileSync(p, "utf8");
const espn = JSON.parse(read("data/espn.json"));
const league = JSON.parse(read("data/league.json"));
const pod = JSON.parse(read("data/pod.json"));
const news = fs.existsSync("data/news.json") ? JSON.parse(read("data/news.json")) : { editions: [] };
const logos = JSON.parse(read("data/logos.json"));
const brand = fs.existsSync("data/brand.json") ? JSON.parse(read("data/brand.json")) : { custom: false, iconVersion: "1" };
// Past seasons for the Record Book, from scripts/fetch-history.mjs. Without it, no Record Book.
const history = fs.existsSync("data/history.json") ? JSON.parse(read("data/history.json")) : null;
// Trades come from scripts/fetch-trades.mjs; an empty list just shows "No trades yet".
const trades = fs.existsSync("data/trades.json") ? JSON.parse(read("data/trades.json")) : { through: null, deadline: null, trades: [] };
addFaab(trades, league); // FAAB amounts Bryar gave (tradeFaab in data/league.json)

// Playoff odds for the rest of the regular season (null once the playoffs start)
const odds = computeOdds(espn);
// On Tuesdays the pages keep showing the week that just finished (scripts/show-week.mjs)
const shown = shownWeek(espn);
if (shown !== espn) console.log(`Showing week ${shown.currentWeek} final scores until Wednesday (ESPN is on week ${espn.currentWeek})`);

// Team pages: power ranking (the same formula as the main page) and top players (from the
// Newspaper's data, refreshed Tuesday, Thursday and Saturday)
const newsroom = fs.existsSync("data/newsroom.json") ? JSON.parse(read("data/newsroom.json")) : null;
const reg = espn.regSeasonWeeks || 99;
const prWeek = espn.games.reduce((m, g) => (g.p <= reg ? Math.max(m, g.p) : m), 0);
const pr = prWeek ? computePower(espn, prWeek, league.weights) : null;
const teamx = { prWeek: pr ? prWeek : null, playersThrough: newsroom ? newsroom.lastFinishedWeek : null, teams: {} };
for (const t of espn.teams) teamx.teams[t.id] = {};
if (pr) pr.list.forEach((r, i) => { teamx.teams[r.id].rank = i + 1; });
for (const row of (newsroom && newsroom.standings) || []) {
  const t = espn.teams.find((x) => x.name === row.name);
  if (t) teamx.teams[t.id].top = (row.topPlayers || []).slice(0, 5);
}

// Keeps "</script>" inside data from ever closing a script block early.
const safe = (obj, pretty) => JSON.stringify(obj, null, pretty ? 1 : 0).replace(/</g, "\\u003c");

const blocks = {
  __ESPN__: safe(shown),
  __PR__: safe(espn), // Power rankings use finished weeks only, so they change when a week goes final.
  __LEAGUE__: safe({ weights: league.weights, takes: league.takes || {}, offline: league.offlineCopy !== false }, true),
  __POD__: safe(pod, true),
  __NEWS__: safe({ editions: (news.editions || []).slice(0, 6) }),
  __LOGOS__: safe(logos, true),
  __TRADES__: safe({ through: trades.through || null, deadline: trades.deadline || null, week: trades.week || null, trades: trades.trades || [], pending: trades.pending || [], faab: trades.faab || null, pickups: trades.pickups || [] }),
  __ODDS__: safe(odds),
  __ALERTS__: safe({ appId: league.onesignalAppId || null }),
  __ICONV__: brand.iconVersion || "1",
};

let html = read("site/template.html");
for (const [key, value] of Object.entries(blocks)) {
  if (!html.includes(key)) throw new Error(`template is missing ${key}`);
  html = html.split(key).join(value);
}

// The uploaded league logo replaces the built-in seal in the header.
if (brand.custom && brand.logo) {
  const start = html.indexOf("<!--crest-->");
  const end = html.indexOf("<!--/crest-->");
  if (start < 0 || end < 0) throw new Error("template is missing the crest markers");
  const img = `<img class="crest-img" src="${brand.logo}" width="${brand.logoWidth}" height="${brand.logoHeight}" alt="BBFC logo">`;
  html = html.slice(0, start) + img + html.slice(end + "<!--/crest-->".length);
}

// The Alerts part of Settings only appears once OneSignal is set up (onesignalAppId in data/league.json).
if (!league.onesignalAppId) html = html.replace(/<!--alerts-->[\s\S]*?<!--\/alerts-->/g, "");

// Record Book links (masthead pill, Standings card) are left out if there's no history.
if (!history) html = html.replace(/<!--book-->[\s\S]*?<!--\/book-->/g, "");

fs.rmSync("_site", { recursive: true, force: true });
fs.mkdirSync("_site/data", { recursive: true });
fs.cpSync("site/icons", "_site/icons", { recursive: true });
if (fs.existsSync("site/logos")) fs.cpSync("site/logos", "_site/logos", { recursive: true });
if (fs.existsSync("site/brand")) fs.cpSync("site/brand", "_site/brand", { recursive: true });
fs.writeFileSync("_site/index.html", html);
fs.writeFileSync("_site/data/espn.json", JSON.stringify(espn));
if (trades.fetchedAt) fs.writeFileSync("_site/data/trades.json", JSON.stringify(trades));
// Lineups for the matchup details sheet; the page downloads this only when a game is opened
if (fs.existsSync("data/lineups.json")) fs.copyFileSync("data/lineups.json", "_site/data/lineups.json");
fs.writeFileSync("_site/data/stamp.json", JSON.stringify({ fetchedAt: espn.fetchedAt }));
fs.writeFileSync("_site/.nojekyll", "");

// Home-screen app manifest: lets people add BBFC as an app (needed for alerts on iPhone).
// Keep "id" the same forever; changing it makes phones treat it as a different app.
const iconV = brand.iconVersion || "1";
fs.writeFileSync("_site/manifest.webmanifest", JSON.stringify({
  id: "./",
  name: "Boys and Bibles Football Club",
  short_name: "BBFC",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: "#13294B",
  theme_color: "#13294B",
  icons: [
    { src: `icons/icon-192.png?v=${iconV}`, sizes: "192x192", type: "image/png" },
    { src: `icons/icon-512.png?v=${iconV}`, sizes: "512x512", type: "image/png" },
  ],
}, null, 2));
// The site's one service worker, at the top of the site: OneSignal's alerts (once set up)
// plus the offline copy (site/sw-offline.js). "offlineCopy": false in data/league.json turns
// the offline copy off; phones then drop their saved copies on their next visit.
{
  const sw = [];
  if (league.onesignalAppId) sw.push(read("site/OneSignalSDKWorker.js"));
  if (league.offlineCopy !== false) sw.push(read("site/sw-offline.js"));
  else sw.push(`// Offline copy turned off: remove any saved copies\nself.addEventListener("install", function () { self.skipWaiting(); });\nself.addEventListener("activate", function (e) { e.waitUntil(caches.keys().then(function (k) { return Promise.all(k.filter(function (n) { return n.indexOf("bbfc-") === 0; }).map(function (n) { return caches.delete(n); })); })); });\n`);
  fs.writeFileSync("_site/OneSignalSDKWorker.js", sw.join("\n"));
}

// Team pages: one page that shows any team (team.html?t=ID)
if (fs.existsSync("site/team.html")) {
  let page = read("site/team.html");
  const teamBlocks = {
    __ESPN__: safe(shown), __ODDS__: safe(odds), __TEAMX__: safe(teamx), __LOGOS__: safe(logos, true), __ICONV__: brand.iconVersion || "1",
    __TRADES__: safe({ trades: trades.trades || [], faab: trades.faab || null, pickups: trades.pickups || [] }), __HISTORY__: safe(history),
  };
  for (const [key, value] of Object.entries(teamBlocks)) {
    if (!page.includes(key)) throw new Error(`team.html is missing ${key}`);
    page = page.split(key).join(value);
  }
  fs.writeFileSync("_site/team.html", page);
}

// The Record Book: past seasons plus this season so far, on its own page.
if (history && fs.existsSync("site/record-book.html")) {
  let book = read("site/record-book.html");
  const bookBlocks = { __HISTORY__: safe(history), __ESPN__: safe(espn), __LOGOS__: safe(logos, true), __ICONV__: brand.iconVersion || "1" };
  for (const [key, value] of Object.entries(bookBlocks)) {
    if (!book.includes(key)) throw new Error(`record-book.html is missing ${key}`);
    book = book.split(key).join(value);
  }
  fs.writeFileSync("_site/record-book.html", book);
}
console.log(`Built site with data from ${espn.fetchedAt}`);
