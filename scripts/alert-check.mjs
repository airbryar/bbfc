// Temporary: which phones received/tapped recent alerts, then one test to the most-used subscription.
// Prints no subscription IDs (labels A, B, C by sign-up date instead).
import fs from "node:fs";
import zlib from "node:zlib";
const APP = JSON.parse(fs.readFileSync("data/league.json", "utf8")).onesignalAppId;
const KEY = (process.env.ONESIGNAL_API_KEY || "").trim();
const H = { "Content-Type": "application/json", Authorization: `Key ${KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const et = (s) => (s ? new Date(typeof s === "number" ? s * 1000 : s).toLocaleString("en-US", { timeZone: "America/New_York" }) : "-");
function csv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function download(url) {
  for (let i = 0; i < 30; i++) {
    await sleep(6000);
    const f = await fetch(url);
    if (f.ok) { const b = Buffer.from(await f.arrayBuffer()); try { return zlib.gunzipSync(b).toString("utf8"); } catch { return b.toString("utf8"); } }
  }
  return null;
}

// Subscriptions, labeled by sign-up order
const ex = await (await fetch(`https://api.onesignal.com/players/csv_export?app_id=${APP}`, { method: "POST", headers: H, body: JSON.stringify({ extra_fields: ["notification_types", "web_auth", "web_p256"] }) })).json();
const subRows = csv(await download(ex.csv_file_url));
const sh = subRows[0];
const subs = subRows.slice(1).filter((r) => r.length > 3).map((r) => Object.fromEntries(sh.map((k, i) => [k, r[i]])));
subs.sort((a, b) => a.created_at.localeCompare(b.created_at));
const label = {}; subs.forEach((s, i) => { label[s.id] = "ABCDEFGH"[i]; });
for (const s of subs) console.log(`SUB ${label[s.id]}: created ${s.created_at} UTC, last active ${s.last_active} UTC, sessions ${s.session_count}, types ${s.notification_types}, endpoint host ${(() => { try { return new URL(s.identifier).host; } catch { return "?"; } })()}, has keys ${!!s.web_auth && !!s.web_p256}, tags ${s.tags}`);

// Who was sent / who tapped each recent alert
const list = await (await fetch(`https://api.onesignal.com/notifications?app_id=${APP}&limit=20`, { headers: H })).json();
for (const n of (list.notifications || []).slice(0, 10)) {
  const line = [`${et(n.queued_at)} ${n.headings?.en}`];
  for (const ev of ["sent", "clicked"]) {
    const r = await fetch(`https://api.onesignal.com/notifications/${n.id}/history`, { method: "POST", headers: H, body: JSON.stringify({ events: ev, app_id: APP }) });
    const j = await r.json().catch(() => ({}));
    if (!j.destination_url) { line.push(`${ev}: (${r.status} ${JSON.stringify(j.errors || j).slice(0, 120)})`); continue; }
    const t = await download(j.destination_url);
    if (t == null) { line.push(`${ev}: file never ready`); continue; }
    const rows = csv(t); const h = rows[0] || [];
    const idCol = h.findIndex((k) => /player_id|subscription_id|^id$/i.test(k));
    const who = rows.slice(1).filter((r) => r[idCol]).map((r) => label[r[idCol]] || "?");
    line.push(`${ev}: [${who.join(",")}] (cols ${h.join("|")})`);
  }
  console.log("ALERT", line.join(" — "));
}

// One test, only to the subscription with the most visits, if it's the one that signed up Nov 7
const top = [...subs].sort((a, b) => Number(b.session_count) - Number(a.session_count))[0];
if (top && top.created_at.startsWith("2026-11-07")) {
  const r = await fetch("https://api.onesignal.com/notifications", { method: "POST", headers: H, body: JSON.stringify({
    app_id: APP, target_channel: "push", include_subscription_ids: [top.id],
    headings: { en: "BBFC alert test" }, contents: { en: "Checking that alerts reach this phone. Nothing new on the site." },
    web_url: "https://airbryar.github.io/bbfc/", chrome_web_icon: "https://airbryar.github.io/bbfc/icons/icon-192.png",
  }) });
  const j = await r.json().catch(() => ({}));
  console.log(`TEST to ${label[top.id]}: status ${r.status}, id? ${!!j.id}, errors ${JSON.stringify(j.errors || null)}`);
  if (j.id) {
    for (const wait of [5000, 20000]) {
      await sleep(wait);
      const n = await (await fetch(`https://api.onesignal.com/notifications/${j.id}?app_id=${APP}`, { headers: H })).json();
      console.log(`TEST stats: successful ${n.successful} failed ${n.failed} errored ${n.errored} remaining ${n.remaining} received ${n.received} platform ${JSON.stringify(n.platform_delivery_stats)}`);
    }
  }
} else console.log("TEST skipped: most-used subscription isn't the Nov 7 one");
