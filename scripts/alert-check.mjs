// Temporary: how OneSignal delivered recent alerts, and who is subscribed (no IDs printed).
import fs from "node:fs";
import zlib from "node:zlib";
const APP = JSON.parse(fs.readFileSync("data/league.json", "utf8")).onesignalAppId;
const KEY = (process.env.ONESIGNAL_API_KEY || "").trim();
const H = { "Content-Type": "application/json", Authorization: `Key ${KEY}` };
const et = (s) => (s ? new Date(typeof s === "number" ? s * 1000 : s).toLocaleString("en-US", { timeZone: "America/New_York" }) : "-");

const r = await fetch(`https://api.onesignal.com/notifications?app_id=${APP}&limit=20`, { headers: H });
const j = await r.json();
console.log("NOTIFICATIONS status", r.status, "total", j.total_count);
for (const n of j.notifications || []) {
  console.log(JSON.stringify({
    queued: et(n.queued_at), sent: et(n.send_after), done: et(n.completed_at),
    heading: n.headings?.en, text: (n.contents?.en || "").slice(0, 90),
    filters: n.filters, segments: n.included_segments,
    successful: n.successful, failed: n.failed, errored: n.errored, remaining: n.remaining,
    received: n.received, converted: n.converted, canceled: n.canceled,
    platform: n.platform_delivery_stats,
  }));
}

const ex = await fetch(`https://api.onesignal.com/players/csv_export?app_id=${APP}`, {
  method: "POST", headers: H, body: JSON.stringify({ extra_fields: ["notification_types"] }),
});
const exj = await ex.json().catch(() => ({}));
console.log("EXPORT status", ex.status, exj.errors ? JSON.stringify(exj.errors) : "");
if (!exj.csv_file_url) process.exit(0);
let buf = null;
for (let i = 0; i < 24 && !buf; i++) {
  await new Promise((res) => setTimeout(res, 10000));
  const f = await fetch(exj.csv_file_url);
  if (f.ok) buf = Buffer.from(await f.arrayBuffer());
}
if (!buf) { console.log("EXPORT never became ready"); process.exit(0); }
const text = zlib.gunzipSync(buf).toString("utf8");
const rows = []; let row = [], cell = "", q = false;
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
  else if (c === '"') q = true;
  else if (c === ",") { row.push(cell); cell = ""; }
  else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
  else if (c !== "\r") cell += c;
}
if (cell || row.length) { row.push(cell); rows.push(row); }
const [head, ...data] = rows;
console.log("COLUMNS", head.join("|"));
const col = (r, k) => r[head.indexOf(k)];
console.log("SUBSCRIPTIONS", data.length);
for (const d of data) {
  console.log(JSON.stringify({
    device_type: col(d, "device_type"), os: col(d, "device_os"), model: col(d, "device_model"),
    created: col(d, "created_at"), last_active: col(d, "last_active"), sessions: col(d, "session_count"),
    invalid: col(d, "invalid_identifier"), notification_types: col(d, "notification_types"),
    tags: col(d, "tags"),
  }));
}
