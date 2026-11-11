import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { unzipSync } from "fflate";

await import("../www/js/gauge.js");
await import("../www/js/samples.js");
const { gasGauge, gasSamples } = globalThis;

const src = process.argv[2];
if (!src) {
  console.log("usage: npm run gauge-eval -- <exported gauge-samples.zip | folder>");
  process.exit(2);
}
const files = {};
if (statSync(src).isDirectory()) for (const n of readdirSync(src)) files[n] = new Uint8Array(readFileSync(join(src, n)));
else Object.assign(files, unzipSync(new Uint8Array(readFileSync(src))));
if (!files["samples.json"]) { console.error("samples.json not found"); process.exit(2); }
const items = JSON.parse(new TextDecoder().decode(files["samples.json"]));
const grays = {};
for (const s of items) if (files[`${s.id}.gray`]) grays[s.id] = new Uint8Array(inflateSync(files[`${s.id}.gray`]));
const r = gasSamples.evaluate(items, grays, gasGauge.readGauge);
const pct = (v) => (v == null ? "—" : (v * 100).toFixed(0) + "%");
const num = (v) => (v == null ? "—" : v.toFixed(2));
for (const row of r.rows) console.log(`${row.id}\tlevel ${row.level}\tdevice ${row.device ?? "—"}\tnow ${row.now ?? "— " + row.reason}`);
console.log(`\nsamples: ${r.rows.length}`);
console.log(`on the phone: mean error ${num(r.device.mean)}%, within 2%: ${pct(r.device.within2)} (${r.device.n} recognized)`);
console.log(`this version: mean error ${num(r.now.mean)}%, within 2%: ${pct(r.now.within2)} (${r.now.n} recognized, ${r.failedNow} failed)`);
