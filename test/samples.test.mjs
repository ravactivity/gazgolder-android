import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zlibSync, unzlibSync, zipSync } from "fflate";

await import("../www/js/storage.js");
await import("../www/js/gauge.js");
await import("../www/js/samples.js");
const { gasStorage, gasGauge, gasSamples: S } = globalThis;
const here = dirname(fileURLToPath(import.meta.url));

function dialSample(value, size = 400) {
  const cx = size / 2, cy = size / 2, r = size * 0.3;
  const angle = (v) => 135 * Math.PI / 180 + 270 * Math.PI / 180 * ((v - 5) / 90);
  const lines = [5, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95].map((v) => {
    const x = cx + Math.cos(angle(v)) * r, y = cy + Math.sin(angle(v)) * r;
    return { text: String(v), box: [x - 6, y - 5, x + 6, y + 5] };
  });
  const gray = new Uint8Array(size * size), a = angle(value), ux = Math.cos(a), uy = Math.sin(a);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - cx, dy = y - cy, al = dx * ux + dy * uy, ac = Math.abs(-dx * uy + dy * ux);
    gray[y * size + x] = Math.hypot(dx, dy) < r * 0.1 ? 30 : al > 0 && al < r * 0.88 && ac < r * 0.02 ? 20 : 235;
  }
  return { ocr: { width: size, height: size, lines }, gray };
}

test("scaling OCR boxes, the downscale factor and RGBA → darkest-channel gray", () => {
  const o = S.scaleOcr({ width: 2000, height: 1000, lines: [{ text: "50", box: [100, 200, 300, 400], elements: [{ text: "50", box: [100, 200, 300, 400] }] }, { text: "x" }] }, 0.5);
  assert.deepEqual([o.width, o.height], [1000, 500]);
  assert.deepEqual(o.lines[0].box, [50, 100, 150, 200]);
  assert.deepEqual(o.lines[0].elements[0].box, [50, 100, 150, 200]);
  assert.deepEqual(o.lines[1].elements, []);
  assert.equal(S.factor(2000, 1000), 0.5);
  assert.equal(S.factor(800, 600), 1);
  assert.deepEqual([...S.grayFromRGBA(new Uint8Array([10, 200, 30, 255, 5, 5, 5, 0]))], [200, 5]);
  assert.deepEqual(S.pixelOf(new Uint8Array([1, 2, 3, 4]), 2)(1, 1), [4, 4, 4]);
});

test("stats: mean error, share within 2% and 5%, failed recognitions", () => {
  assert.deepEqual(S.stats([]), { total: 0, recognized: 0, failed: 0, mean: null, within2: null, within5: null });
  const s = S.stats([{ recognized: 50, level: 51 }, { recognized: 40, level: 44 }, { recognized: null, level: 30 }, { recognized: 70, level: 70 }]);
  assert.equal(s.total, 4);
  assert.equal(s.failed, 1);
  assert.ok(Math.abs(s.mean - 5 / 3) < 1e-9);
  assert.ok(Math.abs(s.within2 - 2 / 3) < 1e-9);
  assert.equal(s.within5, 1);
});

test("the store keeps samples on disk, caps their number, exports and clears them", async () => {
  const fs = gasStorage.memFS();
  let t = 1000;
  const st = S.createStore(fs, { zlib: zlibSync, unzlib: unzlibSync, max: 3, now: () => (t += 1000) });
  assert.deepEqual(await st.list(), []);
  for (let i = 0; i < 5; i++) await st.add({ level: 40 + i, recognized: 40 + i, ocr: { width: 2, height: 2, lines: [] } }, new Uint8Array([i, i, i, i]));
  const items = await st.list();
  assert.deepEqual(items.map((s) => s.level), [42, 43, 44]);
  assert.deepEqual([...(await st.gray(items[0].id))], [2, 2, 2, 2]);
  assert.equal(await st.gray("nope"), null);
  assert.equal((await fs.list(S.DIR)).filter((n) => n.endsWith(".gray")).length, 3);
  const files = {};
  assert.equal(await st.entries(async (n, b) => { files[n] = b; }), 3);
  assert.equal(Object.keys(files).length, 4);
  assert.equal(JSON.parse(new TextDecoder().decode(files["samples.json"])).length, 3);
  await fs.write(S.DIR + "/samples.json", "{broken");
  assert.deepEqual(await st.list(), []);
  await fs.write(S.DIR + "/samples.json", "{}");
  assert.deepEqual(await st.list(), []);
  await st.clear();
  assert.deepEqual(await fs.list(S.DIR), []);
});

test("evaluate re-runs recognition on stored samples and compares with the phone's result", () => {
  const a = dialSample(37), b = dialSample(72), bad = dialSample(50);
  bad.ocr.lines = bad.ocr.lines.slice(0, 2);
  const items = [
    { id: "a", level: 37, recognized: 39, ocr: a.ocr },
    { id: "b", level: 72, recognized: 72, ocr: b.ocr },
    { id: "c", level: 50, recognized: null, ocr: bad.ocr },
    { id: "d", level: null, recognized: 10, ocr: a.ocr },
    { id: "e", level: 10, recognized: 10, ocr: a.ocr },
  ];
  const r = S.evaluate(items, { a: a.gray, b: b.gray, c: bad.gray, d: a.gray }, gasGauge.readGauge);
  assert.equal(r.rows.length, 3);
  assert.equal(r.failedNow, 1);
  assert.equal(r.device.n, 2);
  assert.equal(r.device.mean, 1);
  assert.equal(r.now.n, 2);
  assert.ok(r.now.mean <= 1.5, `mean ${r.now.mean}`);
  assert.equal(S.evaluate([], {}, gasGauge.readGauge).now.mean, null);
});

test("npm run gauge-eval reads an exported archive and a folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauge-eval-"));
  try {
    const a = dialSample(55);
    const files = { "samples.json": new TextEncoder().encode(JSON.stringify([{ id: "s1", level: 55, recognized: 56, ocr: a.ocr }])), "s1.gray": zlibSync(a.gray) };
    writeFileSync(join(dir, "set.zip"), zipSync(files));
    const run = (arg) => spawnSync(process.execPath, [join(here, "../scripts/gauge-eval.mjs"), arg], { encoding: "utf8" });
    const z = run(join(dir, "set.zip"));
    assert.equal(z.status, 0, z.stderr);
    assert.match(z.stdout, /samples: 1/);
    assert.match(z.stdout, /on the phone: mean error 1\.00%/);
    assert.match(z.stdout, /this version: mean error/);
    const folder = join(dir, "f");
    spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(folder)})`]);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(folder, n), b);
    assert.equal(run(folder).status, 0);
    const empty = join(dir, "e");
    spawnSync(process.execPath, ["-e", `require("fs").mkdirSync(${JSON.stringify(empty)})`]);
    assert.equal(run(empty).status, 2);
    assert.equal(spawnSync(process.execPath, [join(here, "../scripts/gauge-eval.mjs")]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
