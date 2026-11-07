// Adds new episodes of The Poddy from its SoundCloud podcast feed to data/pod.json,
// with each episode's audio file and length so the site can play it in place.
// Episodes already listed keep their place; ones missing audio get it filled in.
// Nothing is removed.
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
const attr = (block, name, key) => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*?\\b${key}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};
// "1:02:03", "62:03" or "3723" -> seconds
const seconds = (d) => {
  if (!d) return null;
  const parts = d.split(":").map(Number);
  if (parts.some((n) => isNaN(n))) return null;
  return parts.reduce((s, n) => s * 60 + n, 0) || null;
};

try {
  if (!feed) throw new Error("no podcast feed set in data/league.json");
  const r = await fetch(feed, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BBFC-site-updater)" } });
  if (!r.ok) throw new Error(`feed answered ${r.status}`);
  const xml = await r.text();
  const items = xml.split("<item>").slice(1).map((chunk) => chunk.split("</item>")[0]);
  const byUrl = new Map((pod.episodes || []).map((e) => [e.url, e]));
  const added = [];
  let filled = 0;
  for (const it of items) {
    const url = tag(it, "link").split("?")[0];
    const title = tag(it, "title");
    const when = new Date(tag(it, "pubDate"));
    let audio = attr(it, "enclosure", "url");
    if (!/^https:\/\//.test(audio)) audio = ""; // only play files served over https
    const duration = seconds(tag(it, "itunes:duration"));
    if (!url || !title || isNaN(when)) continue;
    const have = byUrl.get(url);
    if (have) {
      if (audio && have.audio !== audio) { have.audio = audio; filled++; }
      if (duration && !have.duration) have.duration = duration;
      continue;
    }
    const ep = { title, url, date: when.toISOString() };
    if (audio) ep.audio = audio;
    if (duration) ep.duration = duration;
    added.push(ep);
  }
  if (added.length || filled) {
    pod.episodes = [...(pod.episodes || []), ...added].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    fs.writeFileSync(FILE, JSON.stringify(pod, null, 2) + "\n");
  }
  if (added.length) console.log(`Podcast: added ${added.map((e) => e.title).join(", ")}`);
  if (filled) console.log(`Podcast: found audio for ${filled} episode(s)`);
  if (!added.length && !filled) console.log(`Podcast: no new episodes (${items.length} in the feed)`);
} catch (err) {
  console.log(`::warning::Couldn't check the podcast feed (${err.message}). Keeping the current episode list.`);
}
