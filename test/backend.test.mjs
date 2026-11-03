import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
await import("../www/js/exif.js");
await import("../www/js/storage.js");
await import("../www/js/backend.js");
const { gasStorage, gasBackend, gasExif } = globalThis;

async function make() {
  const fs = gasStorage.memFS();
  const be = gasBackend.createBackend(fs, { exifDateTime: gasExif.exifDateTime });
  await be.init();
  const call = async (method, path, body, json = true) => {
    const res = await be.gasFetch(path, { method, body: json && body !== undefined ? JSON.stringify(body) : body });
    return { status: res.status, body: await res.json() };
  };
  return { fs, be, call };
}

function jpegWithExif(dt = "2024:01:21 12:38:29") {
  const s = [...dt].map((c) => c.charCodeAt(0)).concat(0);
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8,
    0, 1, 0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0,
    0, 1, 0x90, 0x03, 0, 2, 0, 0, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0,
    ...s];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

test("EXIF: capture time from a synthetic JPEG", () => {
  assert.deepEqual(gasExif.exifDateTime(jpegWithExif()), { date: "2024-01-21", time: "12:38:29" });
  assert.equal(gasExif.exifDateTime(new Uint8Array([1, 2, 3])), null);
});

test("CSV: quotes, semicolons, BOM", async () => {
  const { be } = await make();
  const { csvParse, csvText } = be._test;
  const rows = [["a", "b;c", 'd"e'], ["", "x\ny", "z"]];
  assert.deepEqual(csvParse(csvText(rows)), rows);
  assert.ok(csvText(rows).startsWith("﻿"));
});

test("numbers with a decimal comma", async () => {
  const { be } = await make();
  assert.equal(be._test.numIn(" 1 234,5 "), 1234.5);
  assert.equal(be._test.numOut(63.5), "63,5");
  assert.equal(be._test.numOut(2000), "2000");
});

test("readings: photo, EXIF, conflict, no photo, delete", async () => {
  const { call } = await make();
  const up = await call("POST", "/api/upload?name=IMG_1.jpg&p=default", jpegWithExif(), false);
  assert.equal(up.status, 200);
  assert.deepEqual([up.body.file, up.body.exif, up.body.date, up.body.time], ["IMG_1.jpg", true, "2024-01-21", "12:38:29"]);
  const r = await call("POST", "/api/readings?p=default", { file: "IMG_1.jpg", date: "2024-01-21", time: "12:38", level: "45", note: "a\nb" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: "IMG_1.jpg", date: "2024-01-21", time: "12:38:00", file: "IMG_1.jpg", level: 45, note: "a b" });
  assert.equal((await call("POST", "/api/upload?name=IMG_1.jpg", jpegWithExif("2024:01:22 10:00:00"), false)).body.file, "IMG_1_2.jpg");
  assert.equal((await call("POST", "/api/upload?name=IMG_1.jpg", jpegWithExif(), false)).body.existing.id, "IMG_1.jpg");
  assert.equal((await call("POST", "/api/upload?name=x.gif", jpegWithExif(), false)).status, 400);
  assert.equal((await call("POST", "/api/upload?name=x.jpg", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), false)).status, 400);

  const m = await call("POST", "/api/readings", { date: "2024-02-01", time: "10:00", level: 40 });
  assert.equal(m.body.id, "manual:2024-02-01T10:00:00");
  assert.equal((await call("POST", "/api/readings", { date: "2024-02-01", time: "10:00", level: 41 })).status, 409);
  assert.equal((await call("POST", "/api/readings", { date: "2024-02-01", time: "11:00" })).status, 400);
  assert.equal((await call("POST", "/api/readings", { date: "2024-02-31", level: 1 })).status, 400);
  assert.equal((await call("POST", "/api/readings", { date: "2024-02-01", level: 101 })).status, 400);
  const e = await call("POST", "/api/readings", { old: m.body.id, date: "2024-02-01", time: "12:00", level: 39 });
  assert.equal(e.body.id, "manual:2024-02-01T12:00:00");
  let d = (await call("GET", "/api/data")).body;
  assert.deepEqual(d.readings.map((x) => x.id), ["IMG_1.jpg", "manual:2024-02-01T12:00:00"]);
  assert.equal((await call("DELETE", "/api/readings?id=" + encodeURIComponent(e.body.id))).status, 200);
  assert.equal((await call("DELETE", "/api/readings?id=nope")).status, 404);
  d = (await call("GET", "/api/data")).body;
  assert.equal(d.readings.length, 1);
});

test("refuels: the third value is computed from two", async () => {
  const { call } = await make();
  const a = await call("POST", "/api/refuels", { date: "2025-10-01", total: "60 000", price: "30" });
  assert.equal(a.body.liters, 2000);
  const b = await call("POST", "/api/refuels", { date: "2025-11-01", liters: "1500", total: "48000,5" });
  assert.equal(b.body.price, 32);
  assert.equal((await call("POST", "/api/refuels", { date: "2025-11-01", price: 30 })).status, 400);
  const d = (await call("GET", "/api/data")).body;
  assert.equal(d.refuels.length, 2);
  assert.equal((await call("DELETE", "/api/refuels?id=" + a.body.id)).status, 200);
});

test("settings: partial update and validation", async () => {
  const { call } = await make();
  const s = await call("PUT", "/api/settings", { minPct: "25", junk: 1, modes: [{ date: "2025-05-15", mode: "dhw", tDhw: 50 }] });
  assert.equal(s.status, 200);
  assert.equal(s.body.minPct, 25);
  assert.equal(s.body.junk, undefined);
  assert.deepEqual(s.body.modes, [{ date: "2025-05-15", mode: "dhw", tDhw: 50 }]);
  assert.equal((await call("PUT", "/api/settings", { minPct: 90 })).status, 400);
  assert.equal((await call("PUT", "/api/settings", { monthThr: { v: 10, unit: "pct", per: "week" } })).body.monthThr.per, "week");
  assert.equal((await call("PUT", "/api/settings", { leadDays: "abc" })).status, 400);
});

test("profiles and passport", async () => {
  const { call, fs } = await make();
  const p = (await call("POST", "/api/profiles", { name: "Дача", volume: 2700 })).body;
  assert.match(p.id, /^p\d{14}$/);
  const d = (await call("GET", "/api/data?p=" + p.id)).body;
  assert.equal(d.settings.volume, 2700);
  assert.equal(d.settings.minDelivery, 2000);
  assert.equal((await call("GET", "/api/data?p=../x")).status, 404);
  const pp = await call("PUT", "/api/passport?p=" + p.id, { params: [{ k: "Производитель", v: "X" }, { k: "", v: "y" }], text: "a\r\nb" });
  assert.deepEqual(pp.body, { params: [{ k: "Производитель", v: "X" }], text: "a\nb", photos: [] });
  const ph = await call("POST", `/api/passport/photo?p=${p.id}&name=plate.jpg`, jpegWithExif(), false);
  assert.equal(ph.body.photos[0].file, "plate.jpg");
  const del = await call("DELETE", `/api/passport/photo?p=${p.id}&file=plate.jpg`);
  assert.equal(del.body.photos.length, 0);
  assert.ok((await fs.list(`media/${p.id}/passport/.deleted`)).length === 1);
  assert.equal((await call("PUT", "/api/profiles", { id: p.id, name: "Дача 2" })).body.name, "Дача 2");
  assert.equal((await call("DELETE", "/api/profiles?id=default")).status, 400);
  assert.equal((await call("DELETE", "/api/profiles?id=" + p.id)).status, 200);
  assert.deepEqual((await call("GET", "/api/profiles")).body.profiles.map((x) => x.id), ["default"]);
  assert.ok((await fs.list("data/.deleted")).length === 1);
});

test("export → import keeps the data", async () => {
  const { be, call } = await make();
  await call("POST", "/api/upload?name=a.jpg", jpegWithExif(), false);
  await call("POST", "/api/readings", { file: "a.jpg", date: "2024-01-21", time: "12:38:29", level: 50 });
  await call("POST", "/api/refuels", { date: "2024-01-20", liters: 2000, price: 29.5 });
  const files = {};
  await be.exportFiles("default", async (path, get) => { files[path] = await get(); });
  assert.deepEqual(Object.keys(files).sort(), ["gas_levels.csv", "gazgolder.json", "img/a.jpg", "refuels.csv", "settings.json"]);
  const imp = await be.importBegin("Импорт");
  for (const [k, v] of Object.entries(files)) await imp.add("Основной/" + k, v);
  await imp.add("../../evil.csv", new Uint8Array([1]));
  await imp.add("img/../x.jpg", jpegWithExif());
  const res = await imp.finish();
  assert.equal(res.name, "Основной");
  const d = (await call("GET", "/api/data?p=" + res.id)).body;
  assert.equal(d.readings[0].level, 50);
  assert.equal(d.refuels[0].total, 59000);
});

const ROOT = join(here, "../..");
test("real desktop CSVs: read/write round trip is byte-identical", { skip: !existsSync(join(ROOT, "gas_levels.csv")) }, async () => {
  const { fs, call } = await make();
  for (const f of ["gas_levels.csv", "refuels.csv"]) if (existsSync(join(ROOT, f))) await fs.write("data/default/" + f, new Uint8Array(readFileSync(join(ROOT, f))));
  const d = (await call("GET", "/api/data")).body;
  assert.ok(d.readings.length > 10);
  const r = d.refuels[0];
  if (r) {
    await call("DELETE", "/api/refuels?id=" + r.id);
    await call("POST", "/api/refuels", r);
    assert.equal(Buffer.from(await fs.read("data/default/refuels.csv")).toString("utf8"), readFileSync(join(ROOT, "refuels.csv"), "utf8"));
  }
  const x = d.readings.find((q) => q.file);
  await call("DELETE", "/api/readings?id=" + encodeURIComponent(x.id));
  await fs.write("media/default/img/" + x.file, readFileSync(join(ROOT, "img", x.file)));
  await call("POST", "/api/readings", x);
  assert.equal(Buffer.from(await fs.read("data/default/gas_levels.csv")).toString("utf8"), readFileSync(join(ROOT, "gas_levels.csv"), "utf8"));
});

test("EXIF of real photos matches the date in the file name", { skip: !existsSync(join(ROOT, "img")) }, () => {
  const names = readdirSync(join(ROOT, "img")).filter((n) => /^(IMG)?\d{8}_?\d{6}\.jpg$/i.test(n)).slice(0, 15);
  let ok = 0;
  for (const n of names) {
    const dt = gasExif.exifDateTime(new Uint8Array(readFileSync(join(ROOT, "img", n))));
    if (dt && n.replace(/\D/g, "").startsWith((dt.date + dt.time).replace(/\D/g, ""))) ok++;
  }
  assert.ok(ok >= names.length * 0.8, `matched ${ok} of ${names.length}`);
});
