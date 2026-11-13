import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

test("making a tank the main one swaps its data, photos and name with the main tank on both backends", { skip: !hasPython && "needs ../app/server.py and Python with Pillow" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "gazgolder-main-"));
  cpSync(join(desktop, "server.py"), join(root, "app/server.py"));
  cpSync(join(desktop, "static"), join(root, "app/static"), { recursive: true });
  const port = await freePort();
  const proc = spawn(python, [join(root, "app/server.py"), "--port", String(port)], { stdio: "ignore" });
  t.after(() => { proc.kill(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/profiles")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }

  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  const call = async (side, method, path, body) => {
    const opts = { method, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } };
    const res = side === "server" ? await fetch(base + path, opts) : await be.gasFetch(path, opts);
    return { status: res.status, body: await res.json() };
  };
  const both = async (method, path, body) => [await call("server", method, path, body), await call("mobile", method, path, body)];
  const ids = {};
  for (const side of ["server", "mobile"]) {
    await call(side, "PUT", "/api/settings", { volume: 4600 });
    await call(side, "POST", "/api/readings", { date: "2026-10-01", time: "09:00", level: 55, note: "дом" });
    const b = (await call(side, "POST", "/api/profiles", { name: "Дача", volume: 2700 })).body;
    ids[side] = b.id;
    const up = (await call(side, "POST", `/api/upload?name=gauge.jpg&p=${b.id}`, JPEG)).body;
    await call(side, "POST", `/api/readings?p=${b.id}`, { file: up.file, date: "2026-10-02", time: "10:00", level: 70, note: "дача" });
    await call(side, "POST", `/api/refuels?p=${b.id}`, { id: "rf1", date: "2026-09-01", liters: 1000, price: 40 });
  }
  const norm = (o, side) => JSON.parse(JSON.stringify(o).split(ids[side]).join("{dacha}"));

  const [already, alreadyM] = await both("POST", "/api/profiles/main", { id: "default" });
  assert.deepEqual(alreadyM, already);
  assert.deepEqual(already, { status: 400, body: { error: "Эта ёмкость уже основная" } });
  const [missing, missingM] = await both("POST", "/api/profiles/main", { id: "nope" });
  assert.equal(missing.status, 404);
  assert.deepEqual(missingM, missing);

  await fs.mkdir("data/.sync");
  await fs.write("data/.sync/default.json", new TextEncoder().encode(JSON.stringify({ fileId: "F-main" })));
  await fs.write(`data/.sync/${ids.mobile}.json`, new TextEncoder().encode(JSON.stringify({ fileId: "F-dacha" })));
  await fs.write("data/.sync/config.json", new TextEncoder().encode(JSON.stringify({ enabled: true, excluded: { default: "F-old" } })));

  const s = await call("server", "POST", "/api/profiles/main", { id: ids.server });
  const m = await call("mobile", "POST", "/api/profiles/main", { id: ids.mobile });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(norm(m, "mobile"), norm(s, "server"));
  assert.deepEqual(s.body.profiles.map((p) => p.name), ["Дача", "Основной"]);

  for (const side of ["server", "mobile"]) {
    const main = (await call(side, "GET", "/api/data")).body, other = (await call(side, "GET", `/api/data?p=${ids[side]}`)).body;
    assert.equal(main.settings.volume, 2700, side);
    assert.deepEqual(main.readings.map((r) => r.note), ["дача"], side);
    assert.equal(main.refuels.length, 1, side);
    assert.equal(other.settings.volume, 4600, side);
    assert.deepEqual(other.readings.map((r) => r.note), ["дом"], side);
    assert.equal(other.refuels.length, 0, side);
  }
  const sm = (await call("server", "GET", "/api/data")).body, mm = (await call("mobile", "GET", "/api/data")).body;
  assert.deepEqual(norm(mm, "mobile"), norm(sm, "server"));
  for (const f of ["gas_levels.csv", "refuels.csv"]) assert.deepEqual(new Uint8Array(readFileSync(join(root, f))), await fs.read("data/default/" + f), f);
  assert.deepEqual(new Uint8Array(readFileSync(join(root, "img", "gauge.jpg"))), JPEG);
  assert.equal((await fetch(`${base}/thumb/gauge.jpg`)).status, 200);
  assert.deepEqual(await fs.read("media/default/img/gauge.jpg"), JPEG);
  assert.deepEqual(readdirSync(join(root, "profiles")).filter((n) => n.startsWith(".swap-")), []);

  const st = async (n) => JSON.parse(new TextDecoder().decode(await fs.read(`data/.sync/${n}.json`)));
  assert.equal((await st("default")).fileId, "F-dacha");
  assert.equal((await st(ids.mobile)).fileId, "F-main");
  assert.deepEqual((await st("config")).excluded, { [ids.mobile]: "F-old" });

  const empty = await both("DELETE", "/api/profiles?id=", undefined);
  assert.deepEqual(empty.map((x) => x.status), [404, 404]);
  const emptyMain = await both("POST", "/api/profiles/main", { id: "" });
  assert.deepEqual(emptyMain.map((x) => x.status), [404, 404]);
  assert.equal(existsSync(join(root, "gas_levels.csv")) && existsSync(join(root, "app", "server.py")), true);
  const gone = [await call("server", "DELETE", `/api/profiles?id=${ids.server}`), await call("mobile", "DELETE", `/api/profiles?id=${ids.mobile}`)];
  assert.deepEqual(gone.map((g) => g.status), [200, 200]);
  assert.deepEqual((await call("server", "GET", "/api/data")).body.readings.map((r) => r.note), ["дача"]);
  assert.deepEqual((await call("mobile", "GET", "/api/profiles")).body.profiles, [{ id: "default", name: "Дача" }]);
});
