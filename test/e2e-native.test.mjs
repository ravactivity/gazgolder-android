import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageOf, findChrome, launch, serve } from "../scripts/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome or Edge (set CHROME_PATH)" : false;
const MIN_COVERAGE = 90;
let srv, B, page;
const runs = [];
const goto = async (url) => { runs.push(await B.takeCoverage()); await B.goto(url); };

before(async () => {
  if (skip) return;
  page = readFileSync(join(here, "../www/index.html"), "utf8").replace('<script src="js/mobile.js"></script>',
    '<script src="/__test/fake-cloud.js"></script><script src="/__test/fake-capacitor.js"></script><script src="js/mobile.js"></script>');
  srv = await serve({ extra: {
    "/native.html": page,
    "/__test/fake-cloud.js": readFileSync(join(here, "fixtures/fake-cloud.js")),
    "/__test/fake-capacitor.js": readFileSync(join(here, "fixtures/fake-capacitor.js")),
  } });
  B = await launch();
  await B.startCoverage();
  await B.goto(`${srv.url}/native.html?lang=ru`);
  await B.eval(`
    window.wait = async (fn, ms = 6000) => { const t = Date.now(); for (;;) { let v; try { v = await fn(); } catch {} if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + fn); await new Promise((r) => setTimeout(r, 50)); } };
    window.$ = (id) => document.getElementById(id);
    window.called = (name) => __cap.calls.filter((c) => c[0] === name);
    window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.iso = (days) => { const d = new Date(Date.now() + days * 864e5); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    window.post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    window.confirm = () => true;
    window.submit = (id) => $(id).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    window.dial = async (value) => {
      const size = 400, cx = 200, cy = 200, r = 120, ang = (v) => 135 * Math.PI / 180 + 270 * Math.PI / 180 * ((v - 5) / 90);
      const cv = document.createElement("canvas"); cv.width = cv.height = size;
      const g = cv.getContext("2d");
      g.fillStyle = "#ebebeb"; g.fillRect(0, 0, size, size);
      g.fillStyle = "#1e1e1e"; g.beginPath(); g.arc(cx, cy, r * 0.1, 0, 7); g.fill();
      g.strokeStyle = "#141414"; g.lineWidth = r * 0.04; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang(value)) * r * 0.88, cy + Math.sin(ang(value)) * r * 0.88); g.stroke();
      const lines = [5, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95].map((v) => { const x = cx + Math.cos(ang(v)) * r, y = cy + Math.sin(ang(v)) * r; return { text: String(v), box: [x - 6, y - 5, x + 6, y + 5] }; });
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ocr: { width: size, height: size, lines } };
    };
    await wait(() => typeof profiles !== "undefined" && profiles.length && typeof state !== "undefined");
  `);
});

after(async () => {
  if (!B) return;
  const entries = [...runs.flat(), ...(await B.takeCoverage())];
  const c = coverageOf(entries, "/js/mobile.js", readFileSync(join(here, "../www/js/mobile.js"), "utf8"));
  console.log(`mobile.js line coverage in the phone-mode run: ${c.pct.toFixed(1)}% (${c.hit}/${c.lines}); missed lines: ${c.missed.join(", ")}`);
  const sh = coverageOf(entries, "/js/shell.js", readFileSync(join(here, "../www/js/shell.js"), "utf8"));
  console.log(`shell.js line coverage in the phone-mode run: ${sh.pct.toFixed(1)}% (${sh.hit}/${sh.lines}); missed lines: ${sh.missed.join(", ")}`);
  if (sh.pct < MIN_COVERAGE) { console.error(`shell.js coverage ${sh.pct.toFixed(1)}% is below ${MIN_COVERAGE}%`); process.exitCode = 1; }
  if (process.env.UI_COVERAGE) {
    const start = page.indexOf("<script>" + String.fromCharCode(10) + '"use strict";') + 8, src = page.slice(start, page.indexOf("</script>", start));
    const ui = entries.filter((e) => /native\.html/.test(e.url)).map((e) => ({ ...e, functions: e.functions.map((f) => ({ ...f, ranges: f.ranges.map((r) => ({ ...r, startOffset: r.startOffset - start, endOffset: r.endOffset - start })) })) }));
    const u = coverageOf(ui, "", src);
    console.log(`index.html script coverage: ${u.pct.toFixed(1)}% (${u.hit}/${u.lines}); missed: ${u.missed.join(", ")}`);
  }
  await B.close();
  srv.close();
  if (c.pct < MIN_COVERAGE) { console.error(`mobile.js coverage ${c.pct.toFixed(1)}% is below ${MIN_COVERAGE}%`); process.exitCode = 1; }
});

test("phone shell: tabs, home, journal, add sheets, suppliers, settings list, menu, back", { skip }, async () => {
  const r = await B.eval(`
    window.prompt = () => null;
    const pick = async (key) => { await wait(() => $("m-sheet").open); document.querySelector('#m-sheet-b [data-pick="' + key + '"]').click(); await sleep(150); };
    for (const [d, l] of [[-40, 80], [-20, 66], [-3, 50]]) await post("/api/readings", { date: iso(d), time: "09:00", level: l });
    await post("/api/suppliers", { id: "gs", short: "Газ-Сервис", full: "ООО «Газ-Сервис»", phone: "+7 900 123-45-67", messenger: "@gas_service", email: "gs@example.com", address: "ул. Заводская, 1", note: "мин. 2000 л" });
    await post("/api/suppliers", { id: "pl", short: "ПропанЛайн" });
    await post("/api/refuels", { id: "rs1", date: iso(-41), liters: 2000, price: 39.5, supplier: "gs" });
    state = await api("/api/data"); render(); await sleep(200);
    gasShell.show("home");
    const home = { days: $("m-days").textContent, status: $("m-status").className, order: $("m-order-h").textContent, sup: $("m-order-sup").textContent, rate: $("m-rate").textContent, ring: $("m-ring").innerHTML.length > 100, mini: $("m-mini").innerHTML.length > 100 };
    $("m-add").click(); await pick("manual"); await wait(() => $("editor").open); $("ed-close").click();
    const caps = called("GasNative.capture").length;
    $("m-add").click(); await pick("photo"); await sleep(300);
    const photo = called("GasNative.capture").length - caps;
    $("m-add").click(); await pick("gallery");
    $("m-add").click(); await wait(() => $("m-sheet").open); $("m-sheet").close();
    $("m-order").click(); await sleep(100);
    const fromOrder = gasShell.where;
    __cap.fire("App:backButton"); await sleep(50);
    $("m-nav").querySelector('[data-nav="log"]').click(); await sleep(100);
    const logAll = $("m-log").querySelectorAll(".m-li").length;
    $("m-log-chips").querySelector('[data-filter="refuels"]').click();
    const logRf = $("m-log").querySelectorAll(".m-li").length;
    $("m-log-chips").querySelector('[data-filter="readings"]').click();
    $("m-log").querySelector("[data-reading]").click(); await wait(() => $("editor").open); $("ed-close").click();
    $("m-log-chips").querySelector('[data-filter="all"]').click();
    $("m-log").querySelector("[data-refuel]").click(); await sleep(100);
    const rfScreen = gasShell.where + "|" + $("rf-id").value;
    $("rf-note").value = "из журнала"; submit("rf-form"); await wait(() => gasShell.where === "log");
    const snack = $("m-snack").textContent;
    $("m-fab").click(); await pick("refuel");
    $("rf-date").value = iso(-1); $("rf-liters").value = "100"; $("rf-supplier").value = "pl"; submit("rf-form"); await wait(() => gasShell.where === "log" && state.refuels.length === 2);
    $("m-fab").click(); await pick("reading"); await pick("manual"); await wait(() => $("editor").open); $("ed-close").click();
    $("m-nav").querySelector('[data-nav="more"]').click(); await sleep(100);
    const more = $("m-more").textContent;
    const item = (k) => $("m-more").querySelector('[data-more="' + k + '"]');
    item("rate").click(); await pick("year");
    const rate = $("m-rate").textContent + "|" + item("rate").textContent;
    item("unit").click(); await pick("pct");
    const pctRate = $("m-rate").textContent;
    item("unit").click(); await pick("l");
    item("rate").click(); await wait(() => $("m-sheet").open); $("m-sheet").close(); await sleep(100);
    const seen = [];
    for (const k of ["tank", "passport", "boiler", "look", "camera", "sync", "archive"]) { gasShell.show("more"); item(k).click(); await sleep(80); seen.push(gasShell.where); }
    gasShell.show("more"); item("notify").click(); await sleep(400);
    const notify = $("m-notify").checked;
    $("m-notify").click(); await sleep(100);
    gasShell.show("more"); item("suppliers").click(); await sleep(80);
    const supList = $("m-sup-list").textContent;
    $("m-sup-list").querySelector('[data-sup="gs"]').click(); await sleep(80);
    const card = { title: $("m-title-t").textContent, links: [...$("m-sup-card").querySelectorAll("a[href]")].map((a) => a.getAttribute("href")), orders: $("m-sup-card").querySelectorAll("[data-refuel]").length };
    $("m-sup-edit").click(); await sleep(80);
    const edit = gasShell.where + "|" + $("sp-short").value + "|" + !$("m-sup-del").hidden;
    $("sp-note").value = "доставка 2 дня"; submit("sp-form"); await wait(() => gasShell.where === "supplier");
    const noted = $("m-sup-card").textContent.includes("доставка 2 дня");
    $("m-sup-edit").click(); await sleep(50); $("m-sup-del").click(); await sleep(300);
    const inUse = $("m-snack").textContent;
    __cap.fire("App:backButton"); __cap.fire("App:backButton"); await sleep(50);
    $("m-fab").click(); await sleep(50);
    const newSup = gasShell.where + "|" + $("m-sup-del").hidden;
    $("sp-short").value = "Новый"; submit("sp-form"); await wait(() => gasShell.where === "supplier" && $("m-title-t").textContent === "Новый");
    const fresh = state.suppliers.find((x) => x.short === "Новый").id;
    const offActs = [...$("m-sup-card").querySelectorAll(".m-act.off")].length;
    $("m-sup-edit").click(); await sleep(50); $("m-sup-del").click(); await wait(() => gasShell.where === "suppliers");
    const gone = !state.suppliers.some((x) => x.id === fresh);
    gasShell.open("supplier"); await sleep(50);
    const missing = $("m-sup-card").textContent;
    gasShell.show("home");
    $("m-menu").click(); const pop = !$("m-menu-pop").hidden;
    __cap.fire("App:backButton"); const popClosed = $("m-menu-pop").hidden;
    $("m-menu").click(); document.body.click(); const popAway = $("m-menu-pop").hidden;
    $("m-menu").click(); $("m-menu-pop").querySelector('[data-menu="new"]').click();
    $("m-menu").click(); $("m-menu-pop").querySelector('[data-menu="share"]').click();
    await wait(() => called("Share.share").length);
    $("m-bell").click(); await sleep(80);
    const bell = gasShell.where;
    gasShell.show("home");
    $("m-tank").value = "__new"; $("m-tank").dispatchEvent(new Event("change")); await sleep(50);
    $("m-tank").value = "default"; $("m-tank").dispatchEvent(new Event("change")); await sleep(300);
    $("m-pf-new").click(); $("m-pf-ren").click(); $("m-pf-del").click();
    const reveal = [];
    for (const p of ["refuels", "readings", "plan", "level", "stats", "months", "calc", "passport", "phone", "suppliers", "summary", "other"]) { gasShell.reveal(p, "rf-liters"); reveal.push(gasShell.where); }
    gasShell.show("stats"); __cap.fire("App:backButton");
    const toHome = gasShell.where;
    return { home, photo, fromOrder, logAll, logRf, rfScreen, snack, more, rate, pctRate, seen, notify, supList, card, edit, noted, inUse, newSup, offActs, gone, missing, pop, popClosed, popAway, bell, reveal, toHome };`);
  assert.match(r.home.days, /\d+ (день|дня|дней)/);
  assert.match(r.home.status, /m-status (ok|warn|crit)/);
  assert.match(r.home.order, /Заказать/);
  assert.match(r.home.sup, /Газ-Сервис · 39,50 ₽\/л/);
  assert.match(r.home.rate, /л\/мес/);
  assert.ok(r.home.ring && r.home.mini);
  assert.equal(r.photo, 1);
  assert.equal(r.fromOrder, "supplier");
  assert.ok(r.logAll >= 4 && r.logRf === 1);
  assert.equal(r.rfScreen, "refuel|rs1");
  assert.match(r.snack, /Заправка сохранена/);
  assert.match(r.more, /Поставщики/);
  assert.match(r.rate, /\/год.*в год/);
  assert.match(r.pctRate, /%\/год/);
  assert.deepEqual(r.seen, ["tank", "passport", "boiler", "app", "app", "app", "app"]);
  assert.equal(r.notify, true);
  assert.match(r.supList, /Газ-Сервис[\s\S]*39,50 ₽\/л · 1 заказ/);
  assert.equal(r.card.title, "Газ-Сервис");
  assert.ok(r.card.links.includes("tel:+79001234567") && r.card.links.includes("https://t.me/gas_service") && r.card.links.includes("mailto:gs@example.com"));
  assert.equal(r.card.orders, 1);
  assert.equal(r.edit, "supplier-edit|Газ-Сервис|true");
  assert.equal(r.noted, true);
  assert.match(r.inUse, /указан в заправках/);
  assert.equal(r.newSup, "supplier-edit|true");
  assert.equal(r.offActs, 3);
  assert.equal(r.gone, true);
  assert.match(r.missing, /Нет такого поставщика/);
  assert.ok(r.pop && r.popClosed && r.popAway);
  assert.equal(r.bell, "app");
  assert.deepEqual(r.reveal, ["refuel", "readings", "stats", "stats", "stats", "stats", "boiler", "passport", "app", "suppliers", "home", "home"]);
  assert.equal(r.toHome, "home");
  assert.deepEqual(B.errors, []);
});

test("widget data and reminders are produced from the readings", { skip }, async () => {
  const r = await B.eval(`
    for (const [days, level] of [[-60, 82], [-45, 70], [-30, 61], [-15, 52], [-2, 45]]) await post("/api/readings", { date: iso(days), time: "10:00", level });
    await post("/api/refuels", { date: iso(-61), liters: 2000, price: 40 });
    await loadProfile();
    await wait(() => __cap.prefs.get("widget"));
    const w = JSON.parse(__cap.prefs.get("widget"));
    $("m-notify").checked = true; $("m-notify").dispatchEvent(new Event("change"));
    await wait(() => called("LocalNotifications.schedule").length);
    const sched = called("LocalNotifications.schedule").at(-1)[1].notifications;
    const next = $("m-next").textContent;
    $("m-photo-days").value = "1"; $("m-photo-days").dispatchEvent(new Event("change"));
    $("m-repeat-days").value = "0"; $("m-repeat-days").dispatchEvent(new Event("change"));
    await sleep(700);
    const sched2 = called("LocalNotifications.schedule").at(-1)[1].notifications;
    __cap.fire("LN:localNotificationActionPerformed", { notification: { extra: { profile: "default" } } });
    $("m-notify").checked = false; $("m-notify").dispatchEvent(new Event("change"));
    await sleep(700);
    return { w, sched, sched2, next, widget: called("GasNative.updateWidget").length, channel: called("LocalNotifications.createChannel").length, nextOff: $("m-next").textContent, sum: $("m-sum").textContent };`);
  assert.equal(r.w.name, "Основной");
  assert.ok(r.w.levels.length > 10);
  assert.equal(r.w.labels.liters, "л");
  assert.ok(r.widget >= 1);
  assert.ok(r.channel >= 1);
  assert.ok(r.sched.length >= 7, JSON.stringify(r.sched.map((n) => n.title)));
  assert.ok(r.sched.every((n) => n.channelId === "gas" && n.extra.profile === "default"));
  assert.match(r.next, /^Ближайшее: /);
  assert.ok(r.sched2.filter((n) => /Сфотографируйте/.test(n.title)).length === 1);
  assert.equal(r.nextOff, "");
  assert.match(r.sum, /^Основной: \d+%$/);
});

test("Google Drive: turn on, sync, share, stop sharing, per-tank switch, photos options, turn off", { skip }, async () => {
  const r = await B.eval(`
    $("m-sync").checked = true; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent));
    const files = [...__cap.cloud.files.values()].map((f) => f.name);
    const acc = $("m-sync-acc").textContent;
    $("m-mem-email").value = "b@example.com"; $("m-mem-add").click();
    await wait(() => /Доступ открыт/.test($("m-mem-st").textContent));
    await wait(() => document.querySelector("#m-mem .m-chip"));
    const chip = document.querySelector("#m-mem .m-chip").textContent;
    document.querySelector("#m-mem .m-chip").click();
    await wait(() => /Доступ закрыт/.test($("m-mem-st").textContent));
    $("m-mem-email").value = "bad"; $("m-mem-add").click();
    await wait(() => /Неверный адрес/.test($("m-mem-st").textContent));
    $("m-sync-photos").checked = false; $("m-sync-photos").dispatchEvent(new Event("change"));
    $("m-sync-wifi").checked = false; $("m-sync-wifi").dispatchEvent(new Event("change"));
    await sleep(300);
    const wifiDisabled = $("m-sync-wifi").disabled;
    $("m-sync-photos").checked = true; $("m-sync-photos").dispatchEvent(new Event("change"));
    $("m-sync-tank").checked = false; $("m-sync-tank").dispatchEvent(new Event("change"));
    await wait(() => /не синхронизируется/.test($("m-sync-st").textContent));
    $("m-sync-tank").checked = true; $("m-sync-tank").dispatchEvent(new Event("change"));
    await sleep(300);
    __cap.authFails = 1;
    const tok = called("GasDrive.clearToken").length;
    $("m-sync-now").click();
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent));
    $("pf-sel").dispatchEvent(new Event("change"));
    await sleep(400);
    return { files, acc, chip, wifiDisabled };`);
  assert.ok(r.files.includes("Gazgolder") && r.files.includes("Основной") && r.files.includes("Gazgolder — Основной.json"), r.files.join(", "));
  assert.equal(r.acc, "Аккаунт: me@example.com");
  assert.equal(r.chip, "b@example.com ×");
  assert.equal(r.wifiDisabled, true);
});

test("Google Drive: open a tank shared by someone else and allow access to their photos", { skip }, async () => {
  const r = await B.eval(`
    const other = __cap.cloud.client("other@example.com");
    const png = (await dial(30)).bytes;
    const photo = await other.create({ name: "n1.png", appProperties: { gazgolder: "photo", kind: "img" } }, png);
    const tables = { "gas_levels.csv": "\\uFEFFдата;время;фото;уровень_%;примечание\\r\\n" + iso(-3) + ";09:00:00;n1.png;66;\\r\\n" };
    const body = { format: "gazgolder-sync", version: 1, name: "Соседская", owner: "other@example.com", members: ["me@example.com"], tables, photos: { "img/n1.png": { id: photo.id } } };
    const f = await other.create({ name: "Gazgolder — Соседская.json", appProperties: { gazgolder: "data" } }, new TextEncoder().encode(JSON.stringify(body)));
    await other.share(f.id, "me@example.com");
    await other.share(photo.id, "me@example.com", { role: "reader" });
    __cap.picked = [f.id];
    $("m-join").click();
    await wait(() => /Готово/.test($("m-mem-st").textContent), 8000);
    const name = curProfile().name, levels = state.readings.map((x) => x.level);
    await wait(() => !$("m-sync-access").hidden);
    const label = $("m-sync-access").textContent, owner = $("m-mem").textContent;
    __cap.picked = [photo.id];
    $("m-sync-access").click();
    await wait(() => $("m-sync-access").hidden, 8000);
    const got = [...__cap.files.keys()].some((k) => k.endsWith("/img/n1.png"));
    __cap.picked = [f.id];
    $("m-join").click();
    await wait(() => /уже подключена/.test($("m-mem-st").textContent), 8000);
    await switchProfile("default");
    return { name, levels, label, owner, got };`);
  assert.equal(r.name, "Соседская");
  assert.deepEqual(r.levels, [66]);
  assert.equal(r.label, "Открыть доступ к фото (1)…");
  assert.match(r.owner, /Владелец: other@example.com/);
  assert.equal(r.got, true);
});

test("Google Drive: a deleted data file can be uploaded again; turning sync off keeps the files", { skip }, async () => {
  const r = await B.eval(`
    const id = JSON.parse(new TextDecoder().decode(__cap.files.get("/fake/data/data/.sync/default.json"))).fileId;
    __cap.cloud.trash(id);
    $("m-sync-now").click();
    await wait(() => !$("m-sync-reup").hidden);
    const gone = $("m-sync-st").textContent;
    $("m-sync-reup").click();
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    const live = [...__cap.cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data" && !f.trashed).length;
    $("m-sync").checked = false; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /выключена/.test($("m-sync-st").textContent));
    return { gone, live, hidden: $("m-sync-opts").hidden };`);
  assert.match(r.gone, /удалён или доступ к нему закрыт/);
  assert.equal(r.live, 2);
  assert.equal(r.hidden, true);
});

test("archive folder: choose, configure, save now", { skip }, async () => {
  const r = await B.eval(`
    $("m-arch").checked = true; $("m-arch").dispatchEvent(new Event("change"));
    await wait(() => /Сохранено архивов: 2/.test($("m-arch-st").textContent));
    $("m-arch-days").value = "30"; $("m-arch-days").dispatchEvent(new Event("change"));
    $("m-arch-keep").value = "500"; $("m-arch-keep").dispatchEvent(new Event("change"));
    $("m-arch-photos").checked = false; $("m-arch-photos").dispatchEvent(new Event("change"));
    await sleep(200);
    const cfg = JSON.parse(__cap.prefs.get("gas-archive"));
    $("m-arch-pick").click();
    await sleep(300);
    $("m-arch-st").textContent = "";
    $("m-arch-now").click();
    await wait(() => /Сохранено архивов/.test($("m-arch-st").textContent));
    return { cfg, dir: $("m-arch-dir").textContent, runs: called("GasFolder.run").length, sched: called("GasFolder.schedule").length };`);
  assert.deepEqual({ on: r.cfg.on, tree: r.cfg.tree, days: r.cfg.days, photos: r.cfg.photos, keep: r.cfg.keep, defaultName: r.cfg.defaultName },
    { on: true, tree: "content://tree/backups", days: 30, photos: false, keep: 5, defaultName: "Основной" });
  assert.equal(r.dir, "Backups");
  assert.ok(r.runs >= 2 && r.sched >= 1);
});

test("photos shared from another app open in the reading editor and leave the cache", { skip }, async () => {
  const r = await B.eval(`
    const d = await dial(52);
    __cap.ocr = null;
    const dir = "/fake/cache/shared/1/";
    __cap.put(dir + "IMG-20261108-WA0003.png", d.bytes);
    __cap.put(dir + "telegram-photo.png", d.bytes);
    __cap.shared = [
      { path: "file://" + dir + "IMG-20261108-WA0003.png", name: "IMG-20261108-WA0003.png", type: "image/png" },
      { path: "file://" + dir + "telegram-photo.png", name: "telegram-photo.png" },
      { path: "file://" + dir + "gone.png", name: "gone.png", type: "image/png" },
    ];
    __cap.fire("GasNative:shared", {});
    await wait(() => $("editor").open);
    const first = { file: $("ed-file").textContent, date: $("ed-date").value, queue: $("ed-queue").textContent };
    await sleep(700);
    if ($("m-recog-dlg").open) $("m-recog-dlg").close();
    $("ed-skip").click();
    const second = { file: $("ed-file").textContent, date: $("ed-date").value };
    $("ed-close").click();
    const left = [...__cap.files.keys()].filter((k) => k.startsWith(dir));
    __cap.sharedBroken = true; __cap.fire("GasNative:shared", {}); await sleep(200);
    __cap.sharedBroken = false; __cap.fire("GasNative:shared", {}); await sleep(200);
    return { first, second, left, quiet: !$("editor").open, taken: called("GasNative.takeShared").length };`);
  assert.deepEqual(r.first, { file: "telegram-photo.png", date: "", queue: "ещё в очереди: 1" });
  assert.deepEqual(r.second, { file: "IMG-20261108-WA0003.png", date: "2026-11-08" });
  assert.deepEqual(r.left, []);
  assert.equal(r.quiet, true);
  assert.ok(r.taken >= 4);
});

test("guided camera → automatic recognition → saved reading → recognition stats, export and clear", { skip }, async () => {
  const r = await B.eval(`
    const d = await dial(47);
    __cap.ocr = d.ocr;
    __cap.put("/fake/cache/camera/IMG_20261104_101010.png", d.bytes);
    __cap.capturePath = "/fake/cache/camera/IMG_20261104_101010.png";
    $("m-camera").click();
    await wait(() => $("m-recog-dlg").open, 10000);
    const res = $("m-recog-res").textContent;
    $("m-recog-use").click();
    const lvl = $("ed-level").value;
    $("ed-date").value = iso(0); $("ed-time").value = "10:10";
    $("ed-save").click();
    await wait(() => /Проверок: 1/.test($("m-smp-st").textContent), 8000);
    const stats = $("m-smp-st").textContent;
    $("m-smp-exp").click();
    await wait(() => called("Share.share").some((c) => /gauge-samples/.test(JSON.stringify(c[1]))));
    $("m-smp-clr").click();
    await wait(() => /пока нет/.test($("m-smp-st").textContent));
    __cap.capturePath = "";
    $("m-camera").click();
    await sleep(200);
    $("m-guided").checked = false; $("m-guided").dispatchEvent(new Event("change"));
    $("m-smp").checked = false; $("m-smp").dispatchEvent(new Event("change"));
    $("m-guided").checked = true; $("m-guided").dispatchEvent(new Event("change"));
    $("m-smp").checked = true; $("m-smp").dispatchEvent(new Event("change"));
    return { res, lvl, stats };`);
  assert.match(r.res, /Уровень по стрелке: 4[6-8]%/);
  assert.match(r.lvl, /^4[6-8]$/);
  assert.match(r.stats, /Проверок: 1\. Средняя ошибка: 0\.0%/);
});

test("recognition failure is explained; a broken photo gives an error message", { skip }, async () => {
  const r = await B.eval(`
    const d = await dial(60);
    __cap.ocr = { ...d.ocr, lines: d.ocr.lines.slice(0, 2) };
    await uploadFiles([new File([d.bytes], "few.png", { type: "image/png" })]);
    await wait(() => !$("m-recog-row").hidden);
    $("m-recog").click();
    await wait(() => /цифры шкалы/.test($("m-recog-st").textContent));
    const few = $("m-recog-st").textContent;
    __cap.ocr = null;
    $("m-recog").click();
    await wait(() => /Не удалось распознать/.test($("m-recog-st").textContent));
    const fail = $("m-recog-st").textContent;
    $("ed-close").click();
    return { few, fail };`);
  assert.match(r.few, /Не нашёл цифры шкалы/);
  assert.match(r.fail, /no text/);
});

test("receipt photo fills the refuel form", { skip }, async () => {
  const r = await B.eval(`
    const fill = async (lines) => {
      __cap.receiptLines = lines;
      const dt = new DataTransfer(); dt.items.add(new File([(await dial(1)).bytes], "check.jpg"));
      $("rf-err").textContent = ""; $("m-rf-receipt-file").files = dt.files;
      $("m-rf-receipt-file").dispatchEvent(new Event("change"));
      await wait(() => $("rf-err").textContent && !/Читаю/.test($("rf-err").textContent));
      return { l: $("rf-liters").value, p: $("rf-price").value, t: $("rf-total").value, d: $("rf-date").value, msg: $("rf-err").textContent };
    };
    $("m-rf-receipt").click();
    const a = await fill(["2 150,00 л x 32,50", "ИТОГО 69 875,00", "12.10.2026 14:31"]);
    const b = await fill(["Отпущено 2000 л", "ИТОГО 61000"]);
    const c = await fill(["Спасибо!"]);
    $("rf-form").reset();
    return { a, b, c };`);
  assert.deepEqual([+r.a.l, +r.a.p, +r.a.t, r.a.d], [2150, 32.5, 69875, "2026-10-12"]);
  assert.match(r.a.msg, /проверьте значения/);
  assert.match(r.b.msg, /частично/);
  assert.match(r.c.msg, /не нашлось/);
});

test("app links from shortcuts and the widget, back button, resume, Material You", { skip }, async () => {
  const r = await B.eval(`
    __cap.fire("App:appUrlOpen", { url: "gazgolder://refuel" });
    await wait(() => document.activeElement && document.activeElement.id === "rf-liters");
    __cap.fire("App:appUrlOpen", { url: "gazgolder://reading" });
    await wait(() => $("editor").open);
    __cap.fire("App:backButton");
    const closed = !$("editor").open;
    const where = gasShell.where;
    __cap.fire("App:backButton");
    const back1 = gasShell.where;
    __cap.fire("App:backButton");
    __cap.fire("App:appUrlOpen", { url: "gazgolder://nothing" });
    const caps = called("GasNative.capture").length;
    __cap.fire("App:appUrlOpen", { url: "gazgolder://photo" });
    await sleep(300);
    __cap.fire("App:resume");
    await sleep(300);
    const dynRow = !$("m-dyn-row").hidden;
    $("m-dyn").checked = true; $("m-dyn").dispatchEvent(new Event("change"));
    await wait(() => document.getElementById("m-dyn-css"));
    const css = document.getElementById("m-dyn-css").textContent;
    $("m-dyn").checked = false; $("m-dyn").dispatchEvent(new Event("change"));
    await sleep(200);
    return { where, back1, closed, minimized: called("App.minimizeApp").length, caps: called("GasNative.capture").length - caps, dynRow, css, cssGone: !document.getElementById("m-dyn-css") };`);
  assert.equal(r.closed, true);
  assert.equal(r.where, "refuel");
  assert.equal(r.back1, "home");
  assert.ok(r.minimized >= 1);
  assert.equal(r.caps, 1);
  assert.equal(r.dynRow, true);
  assert.match(r.css, /--accent:#3355AA/);
  assert.match(r.css, /--accent:#AABBFF/);
  assert.equal(r.cssGone, true);
});

test("send a tank archive and import it back as a new tank", { skip }, async () => {
  const r = await B.eval(`
    $("m-share-lite").click();
    await wait(() => called("Share.share").some((c) => /no-photos/.test(JSON.stringify(c[1]))));
    $("m-share").click();
    await wait(() => called("Share.share").filter((c) => /gazgolder-.*\\.zip/.test(JSON.stringify(c[1]))).length >= 2);
    __cap.shareCancel = true;
    $("m-share").click();
    await sleep(500);
    __cap.shareCancel = false;
    const fz = window.fflate;
    const zip = fz.zipSync({
      "Дача/gazgolder.json": fz.strToU8(JSON.stringify({ format: "gazgolder", version: 1, name: "Импортная" })),
      "Дача/gas_levels.csv": fz.strToU8("\\uFEFFдата;время;фото;уровень_%;примечание\\r\\n2026-10-01;09:00:00;a.png;55;\\r\\n"),
      "Дача/img/a.png": (await dial(55)).bytes,
      "Дача/img/../evil.png": (await dial(55)).bytes,
      "Дача/notes.txt": fz.strToU8("skip"),
    });
    const dt = new DataTransfer(); dt.items.add(new File([zip], "Дача.zip", { type: "application/zip" }));
    $("m-import").click();
    $("m-import-file").files = dt.files; $("m-import-file").dispatchEvent(new Event("change"));
    await wait(() => /Загружено/.test($("m-share-st").textContent), 8000);
    const msg = $("m-share-st").textContent, name = curProfile().name, levels = state.readings.map((x) => x.level);
    const bad = new DataTransfer(); bad.items.add(new File([new Uint8Array([1, 2, 3])], "bad.zip"));
    $("m-import-file").files = bad.files; $("m-import-file").dispatchEvent(new Event("change"));
    await wait(() => /В архиве нет данных газгольдера/.test($("m-share-st").textContent), 8000);
    const after = profiles.length;
    await switchProfile("default");
    return { msg, name, levels, after, count: (await api("/api/profiles")).profiles.length };`);
  assert.match(r.msg, /Загружено: «Импортная», файлов: 2/);
  assert.equal(r.name, "Импортная");
  assert.deepEqual(r.levels, [55]);
  assert.equal(r.count, r.after, "a broken archive leaves no empty tank");
});

test("theme and language buttons", { skip }, async () => {
  const r = await B.eval(`
    document.querySelector('#m-theme [data-theme-set="light"]').click();
    const light = document.documentElement.dataset.theme;
    document.querySelector('#m-theme [data-theme-set="system"]').click();
    return { light, bars: called("SystemBars.setStyle").length };`);
  assert.equal(r.light, "light");
  assert.ok(r.bars >= 2);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("Google sign-in: a failed sign-in, an expired token, a consent request and switching accounts", { skip }, async () => {
  const r = await B.eval(`
    __cap.authFails = 1;
    $("m-sync").checked = true; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /Не удалось войти/.test($("m-sync-st").textContent));
    const failed = $("m-sync-st").textContent;
    $("m-sync").checked = true; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    const clears = called("GasDrive.clearToken").length;
    __cap.expireOnce = true; __cap.authFails = 1;
    $("m-sync-st").textContent = "";
    $("m-sync-now").click();
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    const cleared = called("GasDrive.clearToken").length - clears;
    const interactive = called("GasDrive.authorize").filter((c) => c[1] && c[1].interactive).length;
    $("m-sync").checked = false; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /выключена/.test($("m-sync-st").textContent));
    __cap.user = "new@example.com";
    $("m-sync").checked = true; $("m-sync").dispatchEvent(new Event("change"));
    await wait(() => /new@example.com/.test($("m-sync-acc").textContent) && /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    const mine = [...__cap.cloud.files.values()].filter((f) => f.owner === "new@example.com" && f.appProperties.gazgolder === "data").length;
    __cap.expireOnce = true;
    $("m-sync-st").textContent = "";
    $("m-sync-now").click();
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    return { failed, cleared, interactive, mine };`);
  assert.match(r.failed, /Не удалось войти: Google access needs confirmation/);
  assert.equal(r.cleared, 1);
  assert.ok(r.interactive >= 3);
  assert.ok(r.mine >= 1);
});

test("archive errors are shown; the camera falls back to the system camera app", { skip }, async () => {
  const r = await B.eval(`
    __cap.archNoAccess = true; $("m-arch-now").click();
    await wait(() => /Нет доступа к папке/.test($("m-arch-st").textContent));
    const a = $("m-arch-st").textContent;
    __cap.archNoAccess = false; __cap.archFail = true; $("m-arch-now").click();
    await wait(() => /disk full/.test($("m-arch-st").textContent));
    const b = $("m-arch-st").textContent;
    __cap.archFail = false;
    let clicked = false; const inp = $("m-camera-file"), orig = inp.click; inp.click = () => { clicked = true; };
    __cap.captureBroken = true; $("m-camera").click(); await sleep(300); __cap.captureBroken = false;
    inp.click = orig;
    $("m-arch").checked = false; $("m-arch").dispatchEvent(new Event("change"));
    await sleep(200);
    return { a, b, clicked, off: JSON.parse(__cap.prefs.get("gas-archive")).on };`);
  assert.match(r.a, /выберите её заново/);
  assert.match(r.b, /Не удалось сохранить архив: disk full/);
  assert.equal(r.clicked, true);
  assert.equal(r.off, false);
});

test("data that arrives by sync while a dialog is open is reloaded after the dialog closes", { skip }, async () => {
  const r = await B.eval(`
    await switchProfile("default");
    const before = state.readings.length;
    const st = JSON.parse(new TextDecoder().decode(__cap.files.get("/fake/data/data/.sync/default.json")));
    const c = __cap.cloud.client(__cap.user);
    const d = JSON.parse(new TextDecoder().decode(await c.download(st.fileId)));
    d.tables["gas_levels.csv"] += iso(-1) + ";07:00:00;;33;с другого телефона" + String.fromCharCode(13, 10);
    await c.update(st.fileId, {}, new TextEncoder().encode(JSON.stringify(d)));
    $("manual").click();
    await wait(() => $("editor").open);
    $("m-sync-st").textContent = "";
    $("m-sync-now").click();
    await wait(() => /Синхронизировано/.test($("m-sync-st").textContent), 8000);
    const during = state.readings.length;
    $("ed-close").click();
    await wait(() => state.readings.length > before, 8000);
    return { before, during, after: state.readings.length };`);
  assert.equal(r.during, r.before);
  assert.equal(r.after, r.before + 1);
});

test("browser demo mode, first launch and language switch", { skip }, async () => {
  await goto(`${srv.url}/index.html?demo`);
  await B.eval("localStorage.clear(); sessionStorage.clear();");
  await goto(`${srv.url}/index.html?demo&lang=ru`);
  const web = await B.eval(`
    for (let i = 0; i < 100 && !(typeof profiles !== "undefined" && profiles.length); i++) await new Promise((r) => setTimeout(r, 50));
    const s = document.querySelector('section[data-panel="phone"]').textContent;
    let href = ""; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { href = this.download; };
    document.getElementById("m-share-lite").click();
    for (let i = 0; i < 100 && !href; i++) await new Promise((r) => setTimeout(r, 50));
    HTMLAnchorElement.prototype.click = orig;
    return { onlyApp: /только в приложении/.test(s), href };`);
  assert.equal(web.onlyApp, true);
  assert.match(web.href, /^gazgolder-.*-no-photos\.zip$/);
  await B.eval("localStorage.removeItem('gas-lang');");
  await goto(`${srv.url}/native.html`);
  const first = await B.eval(`
    for (let i = 0; i < 100 && !(document.getElementById("m-welcome") && document.getElementById("m-welcome").open); i++) await new Promise((r) => setTimeout(r, 50));
    const open = document.getElementById("m-welcome").open;
    document.querySelector('#m-welcome [data-theme-set="dark"]').click();
    document.querySelector('#m-welcome [data-lang-set="ru"]').click();
    document.getElementById("m-welcome").dispatchEvent(new Event("cancel", { cancelable: true }));
    document.getElementById("m-welcome-ok").click();
    return { open, closed: !document.getElementById("m-welcome").open, theme: document.documentElement.dataset.theme, lang: localStorage.getItem("gas-lang") };`);
  assert.deepEqual(first, { open: true, closed: true, theme: "dark", lang: "ru" });
  await goto(`${srv.url}/native.html?lang=ru`);
  const lang = await B.eval(`
    for (let i = 0; i < 100 && !(typeof profiles !== "undefined" && profiles.length); i++) await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#m-lang [data-lang-set="ru"]').click();
    window.dispatchEvent(Object.assign(new Event("error"), { message: "SyntaxError: Unexpected token" }));
    return document.body.textContent;`);
  assert.match(lang, /Android System WebView/);
  await goto(`${srv.url}/native.html?lang=ru`);
  await B.eval(`for (let i = 0; i < 100 && !(typeof profiles !== "undefined" && profiles.length); i++) await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#m-lang [data-lang-set="en"]').click();`);
  runs.push(await B.takeCoverage());
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await B.eval(`return localStorage.getItem("gas-lang");`), "en");
});
