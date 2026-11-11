import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../app");
const python = process.platform === "win32" ? "python" : "python3";
const hasPython = existsSync(join(desktop, "server.py")) && spawnSync(python, ["-c", "import PIL"]).status === 0;

await import("../www/js/storage.js");
await import("../www/js/backend.js");
const { gasStorage, gasBackend } = globalThis;

const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z", "base64"));

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

test("backend.js answers like the desktop server.py and writes the same files", { skip: !hasPython && "needs ../app/server.py and Python with Pillow" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "gazgolder-parity-"));
  cpSync(join(desktop, "server.py"), join(root, "app/server.py"));
  cpSync(join(desktop, "static"), join(root, "app/static"), { recursive: true });
  const port = await freePort();
  const proc = spawn(python, [join(root, "app/server.py"), "--port", String(port)], { stdio: "ignore" });
  t.after(() => { proc.kill(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/profiles")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  const ids = { server: {}, mobile: {} };
  const send = async (side, method, path, body) => {
    const map = ids[side];
    path = path.replace(/\{(\w+)\}/g, (_, k) => map[k]);
    const opts = { method, body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body) };
    if (body !== undefined && !(body instanceof Uint8Array)) opts.headers = { "Content-Type": "application/json" };
    const res = side === "server" ? await fetch(base + path, opts) : await be.gasFetch(path, opts);
    let j = await res.json();
    const norm = (v) => (typeof v === "string" ? Object.entries(map).reduce((s, [k, id]) => s.split(id).join(`{${k}}`), v) : Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v);
    return { status: res.status, body: norm(j) };
  };
  const both = async (method, path, body, check) => {
    const [s, m] = [await send("server", method, path, body), await send("mobile", method, path, body)];
    m.body = JSON.parse(JSON.stringify(m.body).replace("Фото не найдено на устройстве", "Фото не найдено на сервере"));
    if (check) { check("server", s); check("mobile", m); }
    assert.deepEqual(m, s, `${method} ${path}`);
    return s;
  };

  await both("GET", "/api/profiles");
  await both("PUT", "/api/settings", { volume: 2700, minDelivery: 1000, leadDays: "10", modes: [{ date: "2026-01-05", mode: "dhw", tDhw: 50 }], monthThr: { v: 5, unit: "pct", per: "week" }, unknown: 1 });
  await both("PUT", "/api/settings", { minPct: 90 });
  await both("PUT", "/api/settings", { modes: [{ date: "2026-13-01", mode: "dhw" }] });
  await both("POST", "/api/readings", { date: "2026-10-01", time: "9:5", level: 61.5, note: 'тест; "кавычки"\nвторая строка' });
  await both("POST", "/api/readings", { date: "2026-10-01", time: "09:05:00", level: 60 });
  await both("POST", "/api/readings", { date: "2026-02-30", level: 5 });
  await both("POST", "/api/readings", { date: "2026-03-01", level: 101 });
  await both("POST", "/api/readings", { date: "2026-03-01" });
  await both("POST", "/api/upload?name=" + encodeURIComponent("g 1.jpg"), JPEG);
  const named = {
    "IMG-20261108-WA0003.jpg": "2026-11-08 ", "photo_2026-11-08_18-21-03.jpg": "2026-11-08 18:21:03",
    "PXL_20261108_182103123.jpg": "2026-11-08 18:21:03", "IMG_20261108_256103.jpg": "2026-11-08 ",
    "20261332_101010.jpg": " ", "x2026-01-01 y2025-02-03.jpg": "2026-01-01 ", "telegram 1699999999.jpg": " ",
  };
  for (const [n, want] of Object.entries(named))
    await both("POST", "/api/upload?name=" + encodeURIComponent(n), JPEG, (side, r) => {
      assert.equal(`${r.body.date} ${r.body.time}`, want, `${side} ${n}`);
      assert.equal(r.body.dateFrom, want.trim() ? "name" : "", `${side} ${n}`);
    });
  await both("POST", "/api/upload?name=g.txt", JPEG);
  await both("POST", "/api/upload?name=bad.jpg", new TextEncoder().encode("not an image"));
  await both("POST", "/api/readings", { file: "g_1.jpg", date: "2026-10-03", time: "08:00", level: 59 });
  await both("POST", "/api/readings", { file: "missing.jpg", date: "2026-10-03", level: 59 });
  await both("POST", "/api/readings", { old: "manual:2026-10-01T09:05:00", date: "2026-10-02", time: "10:00", level: 60.5, note: "перенесено" });
  await both("POST", "/api/refuels", { id: "r1", date: "2026-09-01", liters: "2 000,5", price: "40,1" });
  await both("POST", "/api/refuels", { id: "r2", date: "2026-09-15", total: 5000, price: 50 });
  await both("POST", "/api/refuels", { id: "r3", date: "2026-09-20", liters: 100, total: 3333.333 });
  await both("POST", "/api/refuels", { id: "r4", date: "2026-09-20", price: 40 });
  await both("POST", "/api/refuels", { id: "r5", date: "2026-09-20", liters: 10, price: -1 });
  await both("POST", "/api/refuels", { id: "r6", date: "2026-09-20", liters: "abc" });
  await both("PUT", "/api/passport", { params: [{ k: "Объём", v: "4,6 м³" }, { k: "", v: "x" }, { k: "Объём", v: "дубль" }], text: "  Паспорт\r\nвторая  " });
  await both("POST", "/api/passport/photo?name=plate.jpg", JPEG);
  await both("PUT", "/api/passport", { photos: [{ file: "plate.jpg", caption: "Табличка\nс номером" }] });
  await both("DELETE", "/api/passport/photo?file=plate.jpg");
  await both("DELETE", "/api/passport/photo?file=nope.jpg");
  await both("DELETE", "/api/readings?id=" + encodeURIComponent("manual:2026-10-02T10:00:00"));
  await both("DELETE", "/api/readings?id=nope");
  await both("POST", "/api/suppliers", { id: "s1", short: "  Газ-Сервис ", full: "ООО «Газ-Сервис»", phone: "+7 900 123-45-67", note: "мин.\nзаказ" });
  await both("POST", "/api/suppliers", { id: "s0", short: "Альфа", email: "a@example.com", address: null });
  await both("POST", "/api/suppliers", { short: " " });
  await both("POST", "/api/suppliers", { short: "Икс", phone: 5 });
  await both("POST", "/api/suppliers", [1]);
  await both("POST", "/api/refuels", { id: "r3", date: "2026-09-20", liters: 100, price: 40, supplier: "s1" });
  await both("POST", "/api/refuels", { id: "r4", date: "2026-09-21", liters: 100, supplier: "nope" });
  await both("GET", "/api/data");
  await both("DELETE", "/api/suppliers?id=s1");
  await both("DELETE", "/api/suppliers?id=nope");
  await both("DELETE", "/api/suppliers?id=s0");
  await both("DELETE", "/api/refuels?id=r2");
  await both("DELETE", "/api/refuels?id=nope");

  for (const side of ["server", "mobile"]) {
    const r = await send(side, "POST", "/api/profiles", { name: "  Дача  ", volume: "1000" });
    assert.equal(r.status, 200);
    ids[side].dacha = r.body.id;
  }
  await both("GET", "/api/profiles");
  await both("POST", "/api/profiles", { name: "  " });
  await both("PUT", "/api/profiles", { id: "{dacha}", name: "Дача у реки" });
  await both("POST", "/api/readings?p={dacha}", { date: "2026-10-05", time: "12:00", level: 33 });
  await both("GET", "/api/data?p={dacha}");
  await both("GET", "/api/data?p=nope");
  await both("DELETE", "/api/profiles?id=default");
  await both("DELETE", "/api/profiles?id={dacha}");
  await both("GET", "/api/profiles");
  await both("GET", "/api/data");

  const text = (p) => readFileSync(join(root, p));
  assert.deepEqual(await fs.read("data/default/gas_levels.csv"), new Uint8Array(text("gas_levels.csv")), "gas_levels.csv");
  assert.deepEqual(await fs.read("data/default/refuels.csv"), new Uint8Array(text("refuels.csv")), "refuels.csv");
  assert.equal(await fs.readText("data/suppliers.json"), text("suppliers.json").toString("utf8"), "suppliers.json");
  assert.deepEqual(JSON.parse(await fs.readText("data/default/settings.json")), JSON.parse(text("app/settings.json")), "settings.json");
  assert.deepEqual(JSON.parse(await fs.readText("data/default/passport.json")), JSON.parse(text("passport.json")), "passport.json");
});
