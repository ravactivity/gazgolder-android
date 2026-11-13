import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "../../app");
const python = process.platform === "win32" ? "python" : "python3";
const hasPython = existsSync(join(desktop, "server.py")) && spawnSync(python, ["-c", "import PIL"]).status === 0;

await import("../www/js/storage.js");
await import("../www/js/backend.js");
const { gasStorage, gasBackend } = globalThis;

const JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgKKKK+eP2E//Z", "base64"));

const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

test("a tank exported on the phone imports into the desktop server.py as a new tank or over an existing one", { skip: !hasPython && "needs ../app/server.py and Python with Pillow" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "gazgolder-import-"));
  cpSync(join(desktop, "server.py"), join(root, "app/server.py"));
  cpSync(join(desktop, "static"), join(root, "app/static"), { recursive: true });
  const port = await freePort();
  const proc = spawn(python, [join(root, "app/server.py"), "--port", String(port)], { stdio: "ignore" });
  t.after(() => { proc.kill(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/profiles")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const server = async (method, path, body) => {
    const res = await fetch(base + path, { method, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  const phone = async (method, path, body) => {
    const res = await be.gasFetch(path, { method, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    return res.json();
  };
  const sup = await phone("POST", "/api/suppliers", { short: "Газ-Сервис", phone: "+7 900 000-00-00" });
  await phone("PUT", "/api/settings", { volume: 2700, minDelivery: 1000, modes: [{ date: "2026-05-15", mode: "dhw", tDhw: 50 }], monthThr: { v: 5, unit: "pct", per: "week" } });
  const up = await phone("POST", "/api/upload?name=gauge_1.jpg", JPEG);
  await phone("POST", "/api/readings", { file: up.file, date: "2026-10-01", time: "09:05", level: 61.5, note: "фото" });
  await phone("POST", "/api/readings", { date: "2026-10-20", time: "18:00", level: 48, note: 'без фото; "кавычки"' });
  await phone("POST", "/api/refuels", { date: "2026-09-01", liters: "1500,5", price: "31,2", supplier: sup.id, note: "накладная" });
  await phone("PUT", "/api/passport", { params: [{ k: "Объём", v: "2700 л" }], text: "Заметки" });
  await phone("POST", "/api/passport/photo?name=plate.jpg", JPEG);
  const want = await phone("GET", "/api/data");

  const files = {};
  await be.exportFiles("default", async (p, get) => { files["gazgolder-Дом/" + p] = await get(); }, { photos: true });
  const archive = zipSync(files);

  const added = await server("POST", "/api/import?name=" + encodeURIComponent("gazgolder-Дом.zip"), archive);
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual({ ...added.body, id: "" }, { id: "", name: "Основной", files: 6, readings: 2, refuels: 1 });
  const pid = added.body.id;
  const got = (await server("GET", "/api/data?p=" + pid)).body;
  for (const k of ["settings", "readings", "refuels", "passport", "suppliers"]) assert.deepEqual(got[k], want[k], k);
  for (const f of ["gas_levels.csv", "refuels.csv"]) assert.deepEqual(new Uint8Array(readFileSync(join(root, "profiles", pid, f))), await fs.read("data/default/" + f), f);
  assert.deepEqual(new Uint8Array(readFileSync(join(root, "profiles", pid, "img", up.file))), JPEG);
  assert.equal((await fetch(`${base}/thumb/${up.file}?p=${pid}`)).status, 200);
  assert.equal((await fetch(`${base}/pthumb/plate.jpg?p=${pid}`)).status, 200);

  await server("POST", "/api/readings", { date: "2020-01-01", time: "10:00", level: 50, note: "старое" });
  const before = readFileSync(join(root, "gas_levels.csv"));
  const broken = zipSync({ "gas_levels.csv": strToU8("дата;время;фото;уровень_%;примечание\n2020-01-01;10:00;;abc;\n") });
  const bad = await server("POST", "/api/import?name=b.zip&replace=default", broken);
  assert.deepEqual(bad, { status: 400, body: { error: "Не удалось импортировать архив: Таблица показаний в архиве повреждена" } });
  assert.deepEqual(readFileSync(join(root, "gas_levels.csv")), before);
  assert.deepEqual(await server("POST", "/api/import?name=x.zip", strToU8("not a zip")), { status: 400, body: { error: "Это не архив .zip" } });
  assert.deepEqual(await server("POST", "/api/import?name=x.zip", zipSync({ "readme.txt": strToU8("x") })),
    { status: 400, body: { error: "Не удалось импортировать архив: В архиве нет таблиц газгольдера (gas_levels.csv, refuels.csv)" } });
  assert.equal((await server("POST", "/api/import?name=x.zip&replace=nope", archive)).status, 404);

  const replaced = await server("POST", "/api/import?name=phone.zip&replace=default", archive);
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.equal(replaced.body.id, "default");
  assert.match(replaced.body.backup, /^profiles\/\.deleted\/default-replaced-\d{14}$/);
  const main = (await server("GET", "/api/data")).body;
  for (const k of ["settings", "readings", "refuels", "passport"]) assert.deepEqual(main[k], want[k], k);
  assert.deepEqual(readFileSync(join(root, replaced.body.backup, "gas_levels.csv")), before);
  assert.deepEqual((await server("GET", "/api/profiles")).body.profiles.map((p) => p.id), ["default", pid]);
  assert.deepEqual((await server("GET", "/api/data")).body.suppliers.map((s) => s.short), ["Газ-Сервис"]);
  assert.deepEqual(readdirSync(join(root, "profiles")).filter((n) => n.startsWith(".import-")), []);
});
