import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/gauge.js");
const G = globalThis.gasGauge;
const SCALE = [5, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95];
const deg = Math.PI / 180;

function dial({ value, rot = 0, dir = 1, size = 800, r = 250, curve = 1.15, noise = false, needleW = 0.018, extra = [] }) {
  const cx = size / 2 + 13, cy = size / 2 - 7;
  const angle = (v) => (135 * deg + rot * deg) + dir * 270 * deg * Math.pow((v - 5) / 90, curve);
  const lines = [];
  const word = (text, x, y) => ({ text, box: [x - 12, y - 9, x + 12, y + 9] });
  for (const v of SCALE) {
    const a = angle(v), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    lines.push({ text: String(v), box: word(v, x, y).box, elements: [word(String(v), x, y)] });
  }
  for (const [text, x, y] of extra) lines.push({ text, box: word(text, x, y).box, elements: [word(text, x, y)] });
  const na = angle(value), ux = Math.cos(na), uy = Math.sin(na);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pixel = (x, y) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
    let g = d < r * 1.25 ? 235 : 170;
    if (d < r * 0.1) g = 35;
    const along = dx * ux + dy * uy, across = Math.abs(-dx * uy + dy * ux);
    if (along > -r * 0.15 && along < r * 0.88 && across < r * needleW) g = 25;
    if (along < 0 && along > -r * 0.3 && across < r * 0.06) g = 60;
    if (noise) g = Math.max(0, Math.min(255, g + (rnd() - 0.5) * 30));
    return [g, g, g];
  };
  return { ocr: { width: size, height: size, lines }, pixel };
}

for (const rot of [0, 35, -60, 170]) {
  test(`needle value on a non-linear dial rotated by ${rot}°`, () => {
    for (const value of [8, 23, 47, 63, 82, 92]) {
      const { ocr, pixel } = dial({ value, rot });
      const R = G.readGauge(ocr, pixel);
      assert.ok(R.ok, `value ${value}: ${R.reason}`);
      assert.ok(Math.abs(R.raw - value) <= 1.5, `value ${value} read as ${R.raw.toFixed(2)}`);
    }
  });
}

test("a counter-clockwise scale is read in the right direction", () => {
  for (const value of [15, 55, 88]) {
    const { ocr, pixel } = dial({ value, dir: -1, rot: 20 });
    const R = G.readGauge(ocr, pixel);
    assert.ok(R.ok);
    assert.equal(R.scale.s, -1);
    assert.ok(Math.abs(R.raw - value) <= 1.5, `value ${value} read as ${R.raw.toFixed(2)}`);
  }
});

test("noise, stray OCR words and a wrong digit far from the dial do not break the result", () => {
  const { ocr, pixel } = dial({ value: 41, noise: true, extra: [["8", 100, 700], ["ROCHESTER", 400, 300], ["50", 760, 40], ["l0", 30, 30]] });
  const R = G.readGauge(ocr, pixel);
  assert.ok(R.ok);
  assert.ok(Math.abs(R.raw - 41) <= 2, `read as ${R.raw.toFixed(2)}`);
  assert.ok(R.confidence > 0.6, `confidence ${R.confidence}`);
});

test("OCR look-alikes (O for 0, l for 1) are accepted as scale digits", () => {
  const labels = G.labelsFrom({ lines: [{ text: "5O", box: [0, 0, 10, 10] }, { text: "l0", box: [0, 0, 10, 10] }, { text: "37", box: [0, 0, 10, 10] }] });
  assert.deepEqual(labels.map((l) => l.v), [50, 10]);
});

test("too few digits gives a clear reason instead of a guess", () => {
  const { ocr, pixel } = dial({ value: 50 });
  ocr.lines = ocr.lines.slice(0, 2);
  const R = G.readGauge(ocr, pixel);
  assert.equal(R.ok, false);
  assert.match(R.reason, /Не нашёл цифры шкалы/);
});

test("valueAt interpolates between detected digits", () => {
  const S = { pts: [{ v: 10, a: 0 }, { v: 20, a: 1 }, { v: 40, a: 2 }] };
  assert.equal(G.valueAt(S, 0.5), 15);
  assert.equal(G.valueAt(S, 1.5), 30);
  assert.ok(Math.abs(G.valueAt(S, 2.5) - 50) < 1e-9);
});
