// Turns the picture in league-logo/ into the site's header logo and the icons
// people see in the browser tab and on their home screen.
// With no picture there, the site uses the built-in BBFC seal.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const SRC = "league-logo";
const KINDS = [".png", ".webp", ".jpg", ".jpeg", ".gif", ".avif", ".heic", ".heif"];
const ICONS = "site/icons";
const DEFAULTS = "site/icons/default";
const BRAND = "site/brand";

// Home-screen icon background. iPhones fill see-through areas with black,
// so the logo sits on a solid tile.
const TILE = "#FFFFFF";

const hash = (buf) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 8);

const files = fs.existsSync(SRC)
  ? fs.readdirSync(SRC).filter((f) => KINDS.includes(path.extname(f).toLowerCase())).sort()
  : [];
const pick = files.find((f) => /^logo\./i.test(f)) || files[0];
if (files.length > 1) console.log(`::warning::More than one picture in ${SRC}/; using "${pick}". Delete the others to avoid mix-ups.`);

fs.rmSync(BRAND, { recursive: true, force: true });
let brand;

if (pick) {
  try {
    fs.mkdirSync(BRAND, { recursive: true });
    // Trim empty edges so the logo fills its space.
    const trimmed = await sharp(path.join(SRC, pick), { animated: false })
      .rotate()
      .ensureAlpha()
      .trim({ threshold: 8 })
      .png()
      .toBuffer();

    // Header logo, sharp on high-resolution screens.
    const header = await sharp(trimmed).resize(240, 240, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    const meta = await sharp(header).metadata();
    fs.writeFileSync(path.join(BRAND, "logo.png"), header);

    // Home-screen icon: logo centered on a solid square with room around it,
    // so iPhone's rounded corners never clip it.
    const inner = await sharp(trimmed).resize(144, 144, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const touch = await sharp({ create: { width: 180, height: 180, channels: 4, background: TILE } })
      .composite([{ input: inner, gravity: "center" }])
      .flatten({ background: TILE })
      .png()
      .toBuffer();
    fs.writeFileSync(path.join(ICONS, "apple-touch-icon.png"), touch);

    // Home-screen app icons (the web app manifest asks for 192 and 512), made the same way.
    for (const size of [192, 512]) {
      const art = await sharp(trimmed).resize(Math.round(size * 0.8), Math.round(size * 0.8), { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const icon = await sharp({ create: { width: size, height: size, channels: 4, background: TILE } }).composite([{ input: art, gravity: "center" }]).flatten({ background: TILE }).png().toBuffer();
      fs.writeFileSync(path.join(ICONS, `icon-${size}.png`), icon);
    }

    // Browser tab icon.
    const fav = await sharp(trimmed).resize(32, 32, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    fs.writeFileSync(path.join(ICONS, "favicon-32.png"), fav);

    brand = {
      custom: true,
      source: pick,
      logo: `brand/logo.png?v=${hash(header)}`,
      logoWidth: meta.width,
      logoHeight: meta.height,
      iconVersion: hash(Buffer.concat([touch, fav])),
    };
    console.log(`League logo: using "${pick}" (${meta.width}x${meta.height})`);
  } catch (err) {
    console.log(`::warning::Couldn't read "${pick}" (${err.message.split("\n")[0]}). Try saving it as a PNG. Using the BBFC seal for now.`);
    brand = null;
  }
}

if (!brand) {
  fs.rmSync(BRAND, { recursive: true, force: true });
  const touch = fs.readFileSync(path.join(DEFAULTS, "apple-touch-icon.png"));
  const fav = fs.readFileSync(path.join(DEFAULTS, "favicon-32.png"));
  fs.writeFileSync(path.join(ICONS, "apple-touch-icon.png"), touch);
  fs.writeFileSync(path.join(ICONS, "favicon-32.png"), fav);
  for (const size of [192, 512]) {
    fs.writeFileSync(path.join(ICONS, `icon-${size}.png`), await sharp(touch).resize(size, size).png().toBuffer());
  }
  brand = { custom: false, iconVersion: hash(Buffer.concat([touch, fav])) };
  if (!pick) console.log("No league logo uploaded; using the BBFC seal");
}

fs.writeFileSync("data/brand.json", JSON.stringify(brand, null, 2) + "\n");
