// Checks a Newspaper draft and adds it to data/news.json as the newest edition.
// Usage: node scripts/add-edition.mjs draft.json
//
// The draft looks like:
// { "stories": [ { "kicker": "Trade Watch", "headline": "...", "dek": "...", "body": ["paragraph", ...] }, x3 ] }
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/add-edition.mjs draft.json");
  process.exit(1);
}
const draft = JSON.parse(fs.readFileSync(file, "utf8"));
const newsroom = JSON.parse(fs.readFileSync("data/newsroom.json", "utf8"));
const NEWS = "data/news.json";
const news = fs.existsSync(NEWS) ? JSON.parse(fs.readFileSync(NEWS, "utf8")) : { editions: [] };

const problems = [];
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const clean = (s) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const stories = (draft.stories || []).map((st, i) => {
  const n = `Story ${i + 1}`;
  const kicker = clean(st.kicker);
  const headline = clean(st.headline);
  const dek = clean(st.dek);
  const body = (Array.isArray(st.body) ? st.body : []).map(clean).filter(Boolean);
  const total = body.reduce((s, p) => s + words(p), 0);
  if (!kicker || kicker.length > 32) problems.push(`${n}: kicker should be 1-32 characters`);
  if (headline.length < 10 || headline.length > 90) problems.push(`${n}: headline should be 10-90 characters (it's ${headline.length})`);
  if (!dek || dek.length > 170) problems.push(`${n}: dek should be 1-170 characters (it's ${dek.length})`);
  if (body.length < 3 || body.length > 8) problems.push(`${n}: body should have 3-8 paragraphs (it has ${body.length})`);
  if (total < 250 || total > 520) problems.push(`${n}: body should be 250-520 words (it's ${total})`);
  return { kicker, headline, dek, body };
});
if (stories.length !== 3) problems.push(`An edition needs exactly 3 stories (this has ${stories.length})`);
const heads = new Set(stories.map((s) => s.headline.toLowerCase()));
if (heads.size !== stories.length) problems.push("Two stories have the same headline");

if (problems.length) {
  console.error("Draft not added:\n- " + problems.join("\n- "));
  process.exit(1);
}

// Date and edition name in Eastern time
const now = new Date();
const et = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })
    .formatToParts(now)
    .map((p) => [p.type, p.value])
);
const date = `${et.year}-${et.month}-${et.day}`;
const edition = {
  id: date,
  date,
  label: `${et.weekday} Edition`,
  week: newsroom.currentWeek,
  publishedAt: now.toISOString(),
  stories,
};

news.editions = [edition, ...(news.editions || []).filter((e) => e.id !== date)];
fs.writeFileSync(NEWS, JSON.stringify(news, null, 2) + "\n");
console.log(`Added the ${edition.label} for ${date} (week ${edition.week}):`);
for (const s of stories) console.log(`- ${s.headline} (${s.body.reduce((n, p) => n + words(p), 0)} words)`);
