// Turns the pictures in team-pictures/ into small square images for the site.
// Name each picture after its team, like "the-silly-geese.jpg". Teams without
// a picture get an initials badge on the site.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const SRC = "team-pictures";
const OUT = "site/logos";
const KINDS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"];

const teams = JSON.parse(fs.readFileSync("data/espn.json", "utf8")).teams;
const slug = (s) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const bySlug = Object.fromEntries(teams.map((t) => [slug(t.name), t]));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const map = {};
const notes = [];
for (const file of fs.readdirSync(SRC).sort()) {
  const ext = path.extname(file).toLowerCase();
  if (!KINDS.includes(ext)) continue;
  const team = bySlug[slug(path.basename(file, path.extname(file)))];
  if (!team) {
    notes.push(`"${file}" doesn't match a team name, so it was skipped`);
    continue;
  }
  try {
    const img = await sharp(path.join(SRC, file), { animated: false })
      .rotate()
      .resize(128, 128, { fit: "cover", position: "attention" })
      .webp({ quality: 80 })
      .toBuffer();
    const name = `${team.id}.webp`;
    fs.writeFileSync(path.join(OUT, name), img);
    const v = crypto.createHash("sha1").update(img).digest("hex").slice(0, 8);
    if (map[team.id]) notes.push(`more than one picture for ${team.name}; using "${file}"`);
    map[team.id] = `logos/${name}?v=${v}`;
    console.log(`${team.name}: ${file}`);
  } catch (err) {
    notes.push(`couldn't read "${file}" (${err.message.split("\n")[0]}); try saving it as a JPG or PNG`);
  }
}

fs.writeFileSync("data/logos.json", JSON.stringify(map, null, 2) + "\n");

// Keep the folder's instructions in step with the current team names.
const rows = teams
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((t) => `| ${t.name} | \`${slug(t.name)}.jpg\` | ${map[t.id] ? "Yes" : "No, shows initials"} |`);
fs.writeFileSync(
  `${SRC}/README.md`,
  `# Team pictures

To give a team a picture, upload an image here named after the team.
JPG or PNG works best. Any size is fine; the site trims it to a square.

1. Tap **Add file**, then **Upload files**
2. Add the picture, named as below (the ending can be .jpg, .png or .webp)
3. Tap **Commit changes**

The site shows it within a couple of minutes. To go back to the initials
badge, delete the team's picture from this folder.

| Team | File name | Has a picture |
| --- | --- | --- |
${rows.join("\n")}
`
);

for (const n of notes) console.log(`::warning::${n}`);
console.log(`${Object.keys(map).length} team pictures ready`);
