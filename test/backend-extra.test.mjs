import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/storage.js");
await import("../www/js/backend.js");
await import("../www/js/gauge.js");
const { gasStorage, gasBackend, gasGauge } = globalThis;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 1, 0xff, 0xd9]);

async function make() {
  const fs = gasStorage.memFS();
  globalThis.URL.createObjectURL ??= () => "blob:x";
  const be = gasBackend.createBackend(fs, {});
  await be.init();
  return { fs, be };
}

test("unknown routes are 404, server errors are 500 with a message", async () => {
  const { be } = await make();
  const r = await be.gasFetch("/api/nothing");
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /Нет такого адреса/);
  const broken = gasBackend.createBackend({ ...gasStorage.memFS(), readText: async () => { throw new Error("disk"); } }, {});
  const orig = console.error; console.error = () => {};
  try {
    const e = await broken.gasFetch("/api/data");
    assert.equal(e.status, 500);
    assert.equal((await e.json()).error, "disk");
  } finally { console.error = orig; }
});

test("suppliers: generated ids, broken files, use across tanks, export and import", async () => {
  const { be, fs } = await make();
  const call = async (method, path, body) => { const r = await be.gasFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  await fs.write("data/suppliers.json", new TextEncoder().encode('{"suppliers": 5}'));
  assert.deepEqual((await call("GET", "/api/data")).body.suppliers, []);
  await fs.write("data/suppliers.json", new TextEncoder().encode(JSON.stringify({ suppliers: [null, [], { id: "" }, { id: "k", short: "Ка", phone: 7 }] })));
  assert.deepEqual((await call("GET", "/api/data")).body.suppliers, [{ id: "k", short: "Ка", full: "", phone: "", email: "", telegram: "", whatsapp: "", messenger: "", address: "", minOrder: "", deliveryDays: "", note: "", logo: "" }]);
  const a = (await call("POST", "/api/suppliers", { short: "Бета" })).body;
  assert.match(a.id, /^s\d{14}/);
  await fs.mkdir("data/BAD");
  await fs.write("data/profiles.json", new TextEncoder().encode(JSON.stringify({ profiles: [{ id: "default", name: "Основной" }, { id: "BAD", name: "x" }] })));
  await call("POST", "/api/refuels", { id: "r1", date: "2026-01-02", liters: 10, supplier: "k" });
  assert.equal((await call("DELETE", "/api/suppliers?id=" + a.id)).status, 200);
  assert.equal((await call("DELETE", "/api/suppliers?id=k")).status, 409);
  const files = {};
  await call("POST", "/api/suppliers", { id: "u", short: "Без заправок" });
  await be.exportFiles("default", async (path, get) => { files[path] = new TextDecoder().decode(await get()); }, { photos: false, supplier: "u" });
  assert.deepEqual(JSON.parse(files["suppliers.json"]).suppliers.map((x) => x.id), ["u", "k"]);
  assert.deepEqual([JSON.parse(files["gazgolder.json"]).main, JSON.parse(files["gazgolder.json"]).currentSupplier], [true, "u"]);
  const other = {}, op = (await call("POST", "/api/profiles", { name: "Дача" })).body;
  await be.exportFiles(op.id, async (path, get) => { other[path] = new TextDecoder().decode(await get()); }, { photos: false, supplier: "nope" });
  assert.deepEqual(JSON.parse(other["gazgolder.json"]), { ...JSON.parse(other["gazgolder.json"]), main: false });
  assert.equal(JSON.parse(other["gazgolder.json"]).currentSupplier, undefined);
  const bare = {};
  await be.exportFiles("default", async (path) => { bare[path] = 1; }, { photos: false, data: false });
  assert.deepEqual(Object.keys(bare), ["gazgolder.json"]);
  const { be: be2, fs: fs2 } = await make();
  await fs2.write("data/suppliers.json", new TextEncoder().encode(JSON.stringify({ suppliers: [{ id: "k", short: "Своё" }] })));
  const imp = await be2.importBegin("Импорт");
  for (const [p, t] of Object.entries(files)) await imp.add(p, new TextEncoder().encode(t));
  await imp.add("suppliers.json", new TextEncoder().encode(JSON.stringify({ suppliers: [{ id: "n", short: "Новый" }, { id: "e", short: "" }, { id: "u", short: "Без заправок" }] })));
  assert.deepEqual(await imp.finish().then((r) => [r.main, r.supplier]), [true, "u"]);
  assert.deepEqual(JSON.parse(await fs2.readText("data/suppliers.json")).suppliers.map((x) => [x.id, x.short]), [["u", "Без заправок"], ["n", "Новый"], ["k", "Своё"]]);
  const imp2 = await be2.importBegin("Ещё");
  await imp2.add("suppliers.json", new TextEncoder().encode("{broken"));
  await imp2.add("suppliers.json", new TextEncoder().encode(JSON.stringify({ suppliers: [{ id: "k", short: "Дубль" }] })));
  await imp2.add("gazgolder.json", new TextEncoder().encode(JSON.stringify({ main: "yes", currentSupplier: "gone" })));
  assert.deepEqual(await imp2.finish().then((r) => [r.main, r.supplier]), [false, ""]);
  assert.equal(JSON.parse(await fs2.readText("data/suppliers.json")).suppliers.length, 3);
  const all = {};
  await be2.exportFiles("default", async (path, get) => { all[path] = new TextDecoder().decode(await get()); }, { photos: false });
  assert.deepEqual(JSON.parse(all["suppliers.json"]).suppliers.map((x) => x.id), ["u", "n", "k"]);
  const { be: be3 } = await make(), none = {};
  await be3.exportFiles("default", async (path) => { none[path] = 1; }, { photos: false });
  assert.equal(none["suppliers.json"], undefined);
});

test("image URLs for every kind, and safe names only", async () => {
  const { be, fs } = await make();
  await fs.write("media/default/img/a.jpg", JPEG);
  await fs.write("media/default/.thumbs/a.jpg", JPEG);
  await fs.write("media/default/passport/p.jpg", JPEG);
  await fs.write("media/default/.thumbs/passport/p.jpg", JPEG);
  for (const [kind, file] of [["img", "a.jpg"], ["thumb", "a.jpg"], ["pimg", "p.jpg"], ["pthumb", "p.jpg"]]) assert.match(be.imgUrl(kind, file), /^blob:/);
  assert.equal(be.imgUrl("other", "a.jpg"), "");
  assert.equal(be.imgUrl("img", "../x"), "");
  assert.equal(be.imgUrl("img", "a.jpg", "BAD ID"), "");
});

test("upload bodies: Uint8Array, ArrayBuffer, Blob, string, empty and unsupported", async () => {
  const { be } = await make();
  const up = async (name, body) => { const r = await be.gasFetch("/api/upload?name=" + name, { method: "POST", body }); return { status: r.status, body: await r.json() }; };
  assert.equal((await up("a.jpg", JPEG)).status, 200);
  assert.equal((await up("b.jpg", JPEG.buffer.slice(0))).status, 200);
  assert.equal((await up("c.jpg", new Blob([JPEG]))).status, 200);
  assert.match((await up("d.jpg", "text")).body.error, /не JPEG/);
  assert.match((await up("e.jpg", undefined)).body.error, /не JPEG/);
  assert.match((await up("f.jpg", { nope: 1 })).body.error, /Неподдерживаемое тело/);
  assert.match((await up("g.jpg", new Uint8Array(41 * 1024 * 1024))).body.error, /больше 40 МБ/);
  const bad = gasBackend.createBackend(gasStorage.memFS(), { verify: async () => { throw new Error("битый"); } });
  await bad.init();
  const r = await bad.gasFetch("/api/upload?name=x.jpg", { method: "POST", body: JPEG });
  assert.match((await r.json()).error, /битый/);
});

test("sync helpers: local snapshot, apply with a conflict check, photos in and out", async () => {
  const { be, fs } = await make();
  const S = be.sync;
  const loc = await S.local("default");
  assert.equal(loc.name, "Основной");
  const texts = { ...loc.texts, "settings.json": JSON.stringify({ ...JSON.parse(loc.texts["settings.json"]), minPct: 90, maxPct: 10 }) };
  const r = await S.apply("default", { texts, name: "Дом" }, loc.texts);
  assert.equal(r.changed, true);
  assert.equal(JSON.parse(r.texts["settings.json"]).minPct, 20, "invalid merged settings fall back to the local ones");
  assert.equal((await be.loadProfiles())[0].name, "Дом");
  await be.gasFetch("/api/readings", { method: "POST", body: JSON.stringify({ date: "2026-01-01", level: 50 }) });
  await assert.rejects(S.apply("default", { texts }, loc.texts), (e) => e.status === 409);
  assert.equal((await S.apply("default", { texts: (await S.local("default")).texts })).changed, false);
  assert.equal(await S.writePhoto("default", "img/new.jpg", JPEG), true);
  assert.equal(await S.writePhoto("default", "img/new.jpg", JPEG), true);
  assert.equal(await S.writePhoto("default", "img/../x.jpg", JPEG), false);
  assert.equal(await S.writePhoto("default", "img/x.jpg", new Uint8Array([1, 2, 3])), false);
  assert.equal(await S.writePhoto("default", "other/x.jpg", JPEG), false);
  assert.deepEqual(await S.readPhoto("default", "img/new.jpg"), JPEG);
  assert.equal(await S.readPhoto("default", "img/a/b.jpg"), null);
  await fs.write("media/default/img/.hidden.jpg", JPEG);
  await fs.write("media/default/img/notes.txt", "x");
  assert.deepEqual((await S.local("default")).photos, ["img/new.jpg"]);
  const p = await S.createProfile("  Баня  ");
  assert.equal((await be.loadProfiles()).find((x) => x.id === p.id).name, "Баня");
});

test("the recognition overlay draws the scale and the needle", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; calls.push(["set", k]); return true; } });
  gasGauge.drawOverlay(ctx, { ok: false });
  assert.equal(calls.length, 0);
  gasGauge.drawOverlay(ctx, { ok: true, scale: { cx: 100, cy: 100, r: 80, pts: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }, needle: { t: 1, r1: 0.2 } });
  const names = calls.map((c) => c[0]);
  assert.equal(names.filter((n) => n === "arc").length, 3);
  assert.ok(names.includes("lineTo"));
  assert.equal(names.at(-1), "restore");
});

test("EXIF reader stops at the end of segments without an image marker", async () => {
  await import("../www/js/exif.js");
  const { exifDateTime } = globalThis.gasExif;
  assert.equal(exifDateTime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2])), null);
  assert.equal(exifDateTime(new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0, 0])), null);
  assert.equal(exifDateTime(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x41, 0x41, 0, 0, 0, 0, 0, 0])), null);
});

test("service records: add, edit, sort, validation, delete; they keep a supplier in use and travel in services.json", async () => {
  const { be } = await make();
  const call = async (method, path, body) => { const r = await be.gasFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  await call("POST", "/api/suppliers", { id: "k", short: "Ка" });
  const a = (await call("POST", "/api/services", { date: "2026-03-01", supplier: "k", cost: "1500,5", works: " осмотр\r\nопрессовка ", note: "ок" })).body;
  assert.equal(a.services.length, 1);
  const x = a.services[0];
  assert.match(x.id, /^t\d{14}/);
  assert.deepEqual({ ...x, id: "" }, { id: "", date: "2026-03-01", supplier: "k", cost: 1500.5, works: "осмотр\nопрессовка", note: "ок" });
  await call("POST", "/api/services", { id: "z1", date: "2026-05-01" });
  const b = (await call("POST", "/api/services", { id: x.id, date: "2025-12-01", cost: "" })).body;
  assert.deepEqual(b.services.map((y) => [y.id, y.date, y.cost]), [["z1", "2026-05-01", null], [x.id, "2025-12-01", null]]);
  assert.equal((await call("POST", "/api/services", { date: "2026-13-01" })).status, 400);
  assert.equal((await call("POST", "/api/services", { date: "2026-01-01", cost: -1 })).status, 400);
  assert.equal((await call("POST", "/api/services", { date: "2026-01-01", supplier: "nope" })).status, 400);
  assert.equal((await call("POST", "/api/services", [])).status, 400);
  await call("POST", "/api/services", { id: "z2", date: "2026-06-01", supplier: "k" });
  assert.equal((await call("DELETE", "/api/suppliers?id=k")).status, 409);
  const files = {};
  await be.exportFiles("default", async (path, get) => { files[path] = new TextDecoder().decode(await get()); }, { photos: false });
  assert.deepEqual(JSON.parse(files["suppliers.json"]).suppliers.map((y) => y.id), ["k"]);
  assert.equal(JSON.parse(files["services.json"]).services.length, 3);
  assert.equal(files["passport.json"], undefined);
  assert.equal((await call("GET", "/api/data")).body.services.length, 3);
  const { be: be2, fs: fs2 } = await make();
  const imp = await be2.importBegin("Импорт");
  for (const [p, t] of Object.entries(files)) await imp.add(p, new TextEncoder().encode(t));
  const res = await imp.finish();
  assert.deepEqual(JSON.parse(await fs2.readText(`data/${res.id}/services.json`)).services.map((y) => y.id), ["z2", "z1", x.id]);
  assert.equal((await call("DELETE", "/api/services?id=nope")).status, 404);
  for (const id of ["z1", "z2", x.id]) await call("DELETE", "/api/services?id=" + id);
  assert.deepEqual((await call("GET", "/api/data")).body.services, []);
  assert.equal((await call("DELETE", "/api/suppliers?id=k")).status, 200);
  const fs = (await make()).fs, be3 = gasBackend.createBackend(fs, {});
  await be3.init();
  await fs.write("data/default/services.json", new TextEncoder().encode("[]"));
  assert.deepEqual((await (await be3.gasFetch("/api/data")).json()).services, []);
  await fs.write("data/default/services.json", new TextEncoder().encode(JSON.stringify({ services: [null, { id: "a b", date: "2026-01-01" }, { id: "ok", date: "2026-1-1" }, { id: "ok", date: "2026-01-02", cost: Infinity, works: 5 }] })));
  assert.deepEqual((await (await be3.gasFetch("/api/data")).json()).services, [{ id: "ok", date: "2026-01-02", supplier: "", cost: null, works: "5", note: "" }]);
});
