// Adds new episodes of The Poddy from its SoundCloud podcast feed to data/pod.json.
// Episodes already listed are left alone; nothing is removed.
import fs from "node:fs";

const FILE = "data/pod.json";
const feed = JSON.parse(fs.readFileSync("data/league.json", "utf8")).podcastFeed;
const pod = JSON.parse(fs.readFileSync(FILE, "utf8"));

const decode = (s) =>
  s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

try {
  if (!feed) throw new Error("no podcast feed set in data/league.json");
  const r = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" } });
  if (!r.ok) throw new Error(`feed answered ${r.status}`);
  const xml = await r.text();
  const items = xml.split("<item>").slice(1).map((chunk) => chunk.split("</item>")[0]);
  const have = new Set((pod.episodes || []).map((e) => e.url));
  const added = [];
  for (const it of items) {
    const url = tag(it, "link").split("?")[0];
    const title = tag(it, "title");
    const when = new Date(tag(it, "pubDate"));
    if (!url || !title || isNaN(when) || have.has(url)) continue;
    added.push({ title, url, date: when.toISOString() });
  }
  if (added.length) {
    pod.episodes = [...(pod.episodes || []), ...added].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    fs.writeFileSync(FILE, JSON.stringify(pod, null, 2) + "\n");
    console.log(`Podcast: added ${added.map((e) => e.title).join(", ")}`);
  } else {
    console.log(`Podcast: no new episodes (${items.length} in the feed)`);
  }
} catch (err) {
  console.log(`::warning::Couldn't check the podcast feed (${err.message}). Keeping the current episode list.`);
}
