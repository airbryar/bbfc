// Builds the site into _site/: the page with today's data baked in, plus small
// data files the page checks once a minute to know when to refresh itself.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const espn = JSON.parse(read("data/espn.json"));
const league = JSON.parse(read("data/league.json"));
const pod = JSON.parse(read("data/pod.json"));
const news = fs.existsSync("data/news.json") ? JSON.parse(read("data/news.json")) : { editions: [] };
const logos = JSON.parse(read("data/logos.json"));
const brand = fs.existsSync("data/brand.json") ? JSON.parse(read("data/brand.json")) : { custom: false, iconVersion: "1" };
// Trades come from scripts/fetch-trades.mjs; an empty list just shows "No trades yet".
const trades = fs.existsSync("data/trades.json") ? JSON.parse(read("data/trades.json")) : { through: null, deadline: null, trades: [] };

// Keeps "</script>" inside data from ever closing a script block early.
const safe = (obj, pretty) => JSON.stringify(obj, null, pretty ? 1 : 0).replace(/</g, "\\u003c");

const blocks = {
  __ESPN__: safe(espn),
  __PR__: safe(espn), // Power rankings use finished weeks only, so they change when a week goes final.
  __LEAGUE__: safe({ weights: league.weights, takes: league.takes || {} }, true),
  __POD__: safe(pod, true),
  __NEWS__: safe({ editions: (news.editions || []).slice(0, 6) }),
  __LOGOS__: safe(logos, true),
  __TRADES__: safe({ through: trades.through || null, deadline: trades.deadline || null, trades: trades.trades || [] }),
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

fs.rmSync("_site", { recursive: true, force: true });
fs.mkdirSync("_site/data", { recursive: true });
fs.cpSync("site/icons", "_site/icons", { recursive: true });
if (fs.existsSync("site/logos")) fs.cpSync("site/logos", "_site/logos", { recursive: true });
if (fs.existsSync("site/brand")) fs.cpSync("site/brand", "_site/brand", { recursive: true });
fs.writeFileSync("_site/index.html", html);
fs.writeFileSync("_site/data/espn.json", JSON.stringify(espn));
if (trades.fetchedAt) fs.writeFileSync("_site/data/trades.json", JSON.stringify(trades));
fs.writeFileSync("_site/data/stamp.json", JSON.stringify({ fetchedAt: espn.fetchedAt }));
fs.writeFileSync("_site/.nojekyll", "");
console.log(`Built site with data from ${espn.fetchedAt}`);
