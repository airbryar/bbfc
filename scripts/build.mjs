// Builds the site into _site/: the page with today's data baked in, plus small
// data files the page checks once a minute to know when to refresh itself.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const espn = JSON.parse(read("data/espn.json"));
const league = JSON.parse(read("data/league.json"));
const pod = JSON.parse(read("data/pod.json"));
const logos = JSON.parse(read("data/logos.json"));

// Keeps "</script>" inside data from ever closing a script block early.
const safe = (obj, pretty) => JSON.stringify(obj, null, pretty ? 1 : 0).replace(/</g, "\\u003c");

const blocks = {
  __ESPN__: safe(espn),
  __PR__: safe(espn), // Power rankings use finished weeks only, so they change when a week goes final.
  __LEAGUE__: safe({ weights: league.weights, takes: league.takes || {} }, true),
  __POD__: safe(pod, true),
  __LOGOS__: safe(logos, true),
};

let html = read("site/template.html");
for (const [key, value] of Object.entries(blocks)) {
  if (!html.includes(key)) throw new Error(`template is missing ${key}`);
  html = html.split(key).join(value);
}

fs.rmSync("_site", { recursive: true, force: true });
fs.mkdirSync("_site/data", { recursive: true });
fs.cpSync("site/icons", "_site/icons", { recursive: true });
if (fs.existsSync("site/logos")) fs.cpSync("site/logos", "_site/logos", { recursive: true });
fs.writeFileSync("_site/index.html", html);
fs.writeFileSync("_site/data/espn.json", JSON.stringify(espn));
fs.writeFileSync("_site/data/stamp.json", JSON.stringify({ fetchedAt: espn.fetchedAt }));
fs.writeFileSync("_site/.nojekyll", "");
console.log(`Built site with data from ${espn.fetchedAt}`);
