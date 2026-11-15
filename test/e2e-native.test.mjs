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
    window.confirm = () => true; window.prompt = () => null; window.alert = () => {};
    new MutationObserver(() => {
      const d = $("ui-dlg");
      if (!d.open || window.dlgManual) return;
      const text = [$("ui-dlg-h").hidden ? "" : $("ui-dlg-h").textContent, ...[...$("ui-dlg-t").children].map((x) => x.textContent)].filter(Boolean).join(String.fromCharCode(10));
      const inp = $("ui-dlg-in");
      let ok;
      if (!inp.hidden) { const v = window.prompt(text, inp.value); ok = v != null; if (ok) inp.value = v; }
      else if ($("ui-dlg-no").hidden) { window.alert(text); ok = true; }
      else ok = window.confirm(text);
      (ok ? $("ui-dlg-ok") : $("ui-dlg-no")).click();
    }).observe($("ui-dlg"), { attributes: true, attributeFilter: ["open"] });
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
    const ranges = [];
    for (const k of ["week", "month", "year", "half"]) { $("m-range").querySelector('[data-range="' + k + '"]').click(); await sleep(20); ranges.push([k, $("m-range").querySelector(".on").dataset.range, $("m-mini").querySelectorAll("text").length > 3, JSON.parse(localStorage.getItem("gas-mobile")).homeRange].join(":")); }
    $("m-range").click();
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
    const moreKeys = [...$("m-more").querySelectorAll("[data-more]")].map((b) => b.dataset.more).join(",");
    const navIcon = $("m-nav").querySelector('[data-nav="more"] .ms').textContent;
    $("m-gear").click(); await sleep(80);
    const gear = { where: gasShell.where, title: $("m-title-t").textContent, bell: $("m-bell").hidden && $("m-gear").hidden, keys: [...$("m-settings").querySelectorAll("[data-more]")].map((b) => b.dataset.more).join(",") };
    const item = (k) => document.querySelector('#m-main :not([hidden]) [data-more="' + k + '"]');
    item("rate").click(); await pick("year");
    const rate = $("m-rate").textContent + "|" + item("rate").textContent;
    item("unit").click(); await pick("pct");
    const pctRate = $("m-rate").textContent;
    item("unit").click(); await pick("l");
    item("rate").click(); await wait(() => $("m-sheet").open); $("m-sheet").close(); await sleep(100);
    const seen = [];
    const toSet = () => { gasShell.show("home"); $("m-gear").click(); };
    gasShell.show("more"); $("m-tanks").querySelector('[data-tank="default"]').click(); await sleep(80); seen.push(gasShell.where);
    item("passport").click(); await sleep(80); seen.push(gasShell.where + "<" + (__cap.fire("App:backButton"), await sleep(50), gasShell.where));
    for (const k of ["boiler"]) { gasShell.show("more"); item(k).click(); await sleep(80); seen.push(gasShell.where); }
    for (const k of ["look", "camera", "sync", "archive", "app"]) { toSet(); item(k).click(); await sleep(80); seen.push(gasShell.where); }
    toSet(); item("notify").click(); await sleep(400);
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
    $("m-title").click(); await pick("new");
    $("m-pf-new").click(); $("m-pf-ren").click(); $("m-pf-del").click();
    const reveal = [];
    for (const p of ["refuels", "readings", "plan", "level", "stats", "months", "calc", "passport", "phone", "suppliers", "summary", "other"]) { gasShell.reveal(p, "rf-liters"); reveal.push(gasShell.where); }
    gasShell.show("stats"); __cap.fire("App:backButton");
    const toHome = gasShell.where;
    return { ranges, home, photo, fromOrder, logAll, logRf, rfScreen, snack, more, moreKeys, navIcon, gear, rate, pctRate, seen, notify, supList, card, edit, noted, inUse, newSup, offActs, gone, missing, pop, popClosed, popAway, bell, reveal, toHome };`);
  assert.match(r.home.days, /\d+ (день|дня|дней)/);
  assert.match(r.home.status, /m-status (ok|warn|crit)/);
  assert.match(r.home.order, /Заказать/);
  assert.match(r.home.sup, /Газ-Сервис · 39,50 ₽\/л/);
  assert.match(r.home.rate, /л\/мес/);
  assert.ok(r.home.ring && r.home.mini);
  assert.deepEqual(r.ranges, ["week:week:true:week", "month:month:true:month", "year:year:true:year", "half:half:true:half"]);
  assert.equal(r.photo, 1);
  assert.equal(r.fromOrder, "supplier");
  assert.ok(r.logAll >= 4 && r.logRf === 1);
  assert.equal(r.rfScreen, "refuel|rs1");
  assert.match(r.snack, /Заправка сохранена/);
  assert.match(r.more, /Поставщики/);
  assert.equal(r.moreKeys, "tank-new,suppliers,boiler");
  assert.equal(r.navIcon, "menu");
  assert.deepEqual(r.gear, { where: "settings", title: "Настройки", bell: true, keys: "notify,rate,unit,look,camera,sync,archive,app" });
  assert.match(r.rate, /\/год.*в год/);
  assert.match(r.pctRate, /%\/год/);
  assert.deepEqual(r.seen, ["tank", "passport<tank", "boiler", "app", "app", "app", "app", "app"]);
  assert.equal(r.notify, true);
  assert.match(r.supList, /Газ-Сервис[\s\S]*39,50 ₽\/л · 1 заказ/);
  assert.equal(r.card.title, "Газ-Сервис");
  assert.ok(r.card.links.includes("tel:+79001234567") && r.card.links.includes("https://t.me/gas_service") && r.card.links.includes("mailto:gs@example.com"));
  assert.equal(r.card.orders, 1);
  assert.equal(r.edit, "supplier-edit|Газ-Сервис|true");
  assert.equal(r.noted, true);
  assert.match(r.inUse, /указан в заправках/);
  assert.equal(r.newSup, "supplier-edit|true");
  assert.equal(r.offActs, 4);
  assert.equal(r.gone, true);
  assert.match(r.missing, /Нет такого поставщика/);
  assert.ok(r.pop && r.popClosed && r.popAway);
  assert.equal(r.bell, "app");
  assert.deepEqual(r.reveal, ["refuel", "readings", "stats", "stats", "stats", "stats", "boiler", "passport", "app", "suppliers", "home", "home"]);
  assert.equal(r.toHome, "home");
  assert.deepEqual(B.errors, []);
});

test("journal: select entries, select all, delete several; long press; delete a refuel from its screen", { skip }, async () => {
  const r = await B.eval(`
    const pick = async (key) => { await wait(() => $("m-sheet").open); document.querySelector('#m-sheet-b [data-pick="' + key + '"]').click(); await sleep(150); };
    const keep = { readings: state.readings.map((x) => x.id), refuels: state.refuels.map((x) => x.id) };
    for (const [d, l] of [[-9, 70], [-8, 69], [-7, 68]]) await post("/api/readings", { date: iso(d), time: "08:00", level: l, note: "на удаление" });
    await post("/api/refuels", { id: "del1", date: iso(-9), liters: 300, price: 40 });
    await post("/api/refuels", { id: "del2", date: iso(-8), liters: 200, price: 40 });
    state = await api("/api/data"); render(); await sleep(200);
    gasShell.show("log"); await sleep(100);
    const extra = (sel) => [...$("m-log").querySelectorAll(sel)].filter((b) => !keep.readings.includes(b.dataset.reading) && !keep.refuels.includes(b.dataset.refuel));
    const btnShown = !$("m-log-sel").hidden;
    $("m-log-sel").click(); await sleep(50);
    const mode = { title: $("m-title-t").textContent, back: !$("m-back").hidden, del: !$("m-sel-del").hidden, all: !$("m-sel-all").hidden, fab: $("m-fab").hidden, chip: !$("m-log-sel").hidden && $("m-log-sel").classList.contains("on") && $("m-log-sel").getAttribute("aria-pressed") === "true", boxes: $("m-log").querySelectorAll(".m-check").length > 0 };
    extra("[data-reading]")[0].click(); await sleep(30);
    const one = { title: $("m-title-t").textContent, sel: $("m-log").querySelectorAll(".m-li.sel").length, editor: $("editor").open };
    extra("[data-reading]")[0].click(); await sleep(30);
    const none = $("m-title-t").textContent;
    window.confirm = () => true; $("m-sel-del").click(); await sleep(50);
    const empty = $("m-snack").textContent;
    for (const b of [...extra("[data-reading]"), ...extra("[data-refuel]")].slice(0, 4)) { $("m-log").querySelector('[data-key="' + b.dataset.key + '"]').click(); await sleep(20); }
    const chosen = gasShell.selected.length;
    window.confirm = () => false; $("m-sel-del").click(); await sleep(100);
    const kept = state.readings.length + state.refuels.length;
    window.confirm = () => true; $("m-sel-del").click();
    await wait(() => /Удалено: 4/.test($("m-snack").textContent));
    const after = { left: extra("[data-reading]").length + extra("[data-refuel]").length, mode: gasShell.selected, title: $("m-title-t").textContent, chip: !$("m-log-sel").hidden && !$("m-log-sel").classList.contains("on") };
    $("m-sel-all").hidden || $("m-sel-all").click();
    $("m-log").querySelector("[data-key]").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await sleep(30);
    const longPress = gasShell.selected.length;
    $("m-sel-all").click(); await sleep(30);
    const all = gasShell.selected.length === $("m-log").querySelectorAll("[data-key]").length;
    $("m-sel-all").click(); await sleep(30);
    const cleared = gasShell.selected.length;
    $("m-log-sel").click(); await sleep(30);
    const toggledOff = { mode: gasShell.selected, boxes: $("m-log").querySelectorAll(".m-check").length, all: $("m-sel-all").hidden, del: $("m-sel-del").hidden, on: $("m-log-sel").classList.contains("on"), title: $("m-title-t").textContent };
    $("m-log-sel").click(); await sleep(30);
    __cap.fire("App:backButton"); await sleep(50);
    const backOut = { mode: gasShell.selected, where: gasShell.where, bell: !$("m-bell").hidden };
    const rest = extra("[data-refuel]")[0];
    rest.click(); await sleep(100);
    const rfScreen = { where: gasShell.where, del: !$("m-rf-del").hidden };
    window.confirm = () => false; $("m-rf-del").click(); await sleep(50);
    const still = gasShell.where;
    window.confirm = () => true; $("m-rf-del").click();
    await wait(() => gasShell.where === "log" && /Заправка удалена/.test($("m-snack").textContent));
    const gone = extra("[data-refuel]").length + extra("[data-reading]").length;
    $("m-fab").click(); await pick("refuel");
    const newRf = $("m-rf-del").hidden;
    __cap.fire("App:backButton"); await sleep(50);
    const photos = { ph: $("m-log").querySelectorAll(".m-lead.ph").length, files: state.readings.filter((x) => x.file).length };
    gasShell.show("home"); await sleep(50);
    const selHome = $("m-log-sel").hidden;
    return { photos, selHome, toggledOff, btnShown, mode, one, none, empty, chosen, kept, after, longPress, all, cleared, backOut, rfScreen, still, gone, newRf,
      intact: keep.readings.every((id) => state.readings.some((x) => x.id === id)) && keep.refuels.every((id) => state.refuels.some((x) => x.id === id)) };`);
  assert.equal(r.btnShown, true);
  assert.deepEqual(r.mode, { title: "Выбрано: 0", back: true, del: true, all: true, fab: true, chip: true, boxes: true });
  assert.deepEqual(r.toggledOff, { mode: null, boxes: 0, all: true, del: true, on: false, title: "Журнал" });
  assert.equal(r.photos.ph, r.photos.files);
  assert.equal(r.selHome, true);
  assert.deepEqual(r.one, { title: "Выбрано: 1", sel: 1, editor: false });
  assert.equal(r.none, "Выбрано: 0");
  assert.equal(r.empty, "Ничего не выбрано");
  assert.equal(r.chosen, 4);
  assert.equal(r.kept > 0, true);
  assert.deepEqual(r.after, { left: 1, mode: null, title: "Журнал", chip: true });
  assert.equal(r.longPress, 1);
  assert.equal(r.all, true);
  assert.equal(r.cleared, 0);
  assert.deepEqual(r.backOut, { mode: null, where: "log", bell: true });
  assert.deepEqual(r.rfScreen, { where: "refuel", del: true });
  assert.equal(r.still, "refuel");
  assert.equal(r.gone, 0);
  assert.equal(r.newRf, true);
  assert.equal(r.intact, true);
});

test("supplier list shows the logo; the card has Telegram, WhatsApp, min. order, delivery time and comment", { skip }, async () => {
  const r = await B.eval(`
    const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await post("/api/suppliers", { id: "lg", short: "ЛогоГаз", telegram: "@logo_gas", whatsapp: "+7 900 555-44-33", minOrder: "2500", deliveryDays: "3", note: "только безнал", logo: LOGO });
    state = await api("/api/data"); render();
    gasShell.show("more"); gasShell.open("suppliers"); await sleep(50);
    const item = $("m-sup-list").querySelector('[data-sup="lg"]');
    const list = { img: !!item.querySelector(".m-logo img"), plain: !!$("m-sup-list").querySelector('[data-sup="pl"] .m-ini:not(.m-logo)') };
    item.click(); await sleep(80);
    const card = { head: !!$("m-sup-card").querySelector(".m-ava.m-logo img"), rows: [...$("m-sup-card").querySelectorAll(".m-li .m-mid")].map((x) => x.textContent.trim().replace(/[\\u00a0\\u202f]/g, " ")).slice(0, 5),
      acts: [...$("m-sup-card").querySelectorAll(".m-act")].map((a) => a.lastChild.textContent + "=" + (a.getAttribute("href") || "off")),
      write: $("m-sup-card").querySelectorAll(".m-act")[2].getAttribute("href"), wa: [...$("m-sup-card").querySelectorAll("a.m-li")].map((a) => a.getAttribute("href")) };
    await api("/api/suppliers?id=lg", { method: "DELETE" }); state = await api("/api/data"); render(); gasShell.show("home");
    return { list, card };`);
  assert.deepEqual(r.list, { img: true, plain: true });
  assert.equal(r.card.head, true);
  assert.deepEqual(r.card.rows, ["@logo_gasTelegram", "+7 900 555-44-33WhatsApp", "2 500 лминимальный заказ", "3 дн.срок доставки", "только безналкомментарий"]);
  assert.equal(r.card.write, "https://t.me/logo_gas");
  assert.deepEqual(r.card.acts, ["Позвонить=off", "WhatsApp=https://wa.me/79005554433", "Telegram=https://t.me/logo_gas", "Почта=off"]);
  assert.ok(r.card.wa.includes("https://wa.me/79005554433"));
});

test("supplier card lists the tanks it services or installed, from every tank passport; a tap opens that passport", { skip }, async () => {
  const r = await B.eval(`
    const put = (path, body, pid) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, pid);
    await post("/api/suppliers", { id: "svc", short: "ТехГаз", phone: "+7 900 000-00-01" });
    const a = await post("/api/profiles", { name: "Дача", volume: 2700 });
    const b = await post("/api/profiles", { name: "Баня", volume: 1000 });
    const old = (state.passport && state.passport.params) || [];
    state.passport = await put("/api/passport", { params: [...old.filter((p) => !/организация|Обслуживание/.test(p.k)), { k: "Обслуживание, контакты", v: "ТехГаз, +7 900 000-00-01" }] });
    await put("/api/passport", { params: [{ k: "Монтажная организация", v: "ТехГаз" }, { k: "Обслуживание, контакты", v: "техгаз" }, { k: "Следующее ТО / освидетельствование", v: "01.02.2020" }] }, a.id);
    await put("/api/settings", { servicePeriod: { n: 1, unit: "year" } }, a.id);
    await put("/api/passport", { params: [{ k: "Монтажная организация", v: "ТехГазСтрой" }] }, b.id);
    profiles = (await api("/api/profiles")).profiles; state = await api("/api/data"); render();
    gasShell.show("more"); gasShell.open("suppliers"); await sleep(50);
    $("m-sup-list").querySelector('[data-sup="svc"]').click();
    await wait(() => $("m-sup-tanks").querySelectorAll("[data-sup-tank]").length);
    const list = [...$("m-sup-tanks").querySelectorAll("[data-sup-tank]")].map((x) => x.querySelector(".m-h").textContent + ": " + [...x.querySelectorAll(".m-s")].map((y) => y.textContent + (y.classList.contains("over") ? " [over]" : "")).join(" / "));
    $("m-sup-tanks").querySelector('[data-sup-tank="' + a.id + '"]').click();
    await wait(() => view.profile === a.id && gasShell.where === "passport");
    const opened = { where: gasShell.where, tank: view.profile === a.id, mount: document.querySelector('#pp-params input[data-key="Монтажная организация"]').value };
    gasShell.show("more"); gasShell.open("suppliers"); await sleep(50);
    $("m-sup-list").querySelector('[data-sup="svc"]').click();
    await wait(() => $("m-sup-tanks").querySelectorAll("[data-sup-tank]").length === 2);
    $("m-sup-tanks").querySelector('[data-sup-tank="' + a.id + '"]').click();
    await wait(() => gasShell.where === "passport");
    const same = view.profile === a.id;
    const real = window.gasFetch;
    window.gasFetch = async (url, o) => (url.includes("p=default") ? new Response("{}", { status: 500 }) : real(url, o));
    gasShell.show("more"); gasShell.open("suppliers"); await sleep(50);
    $("m-sup-list").querySelector('[data-sup="gs"]').click(); await sleep(200);
    const other = $("m-sup-tanks").textContent;
    gasShell.back(); $("m-sup-list").querySelector('[data-sup="svc"]').click();
    await wait(() => $("m-sup-tanks").querySelectorAll("[data-sup-tank]").length === 1);
    const failed = $("m-sup-tanks").querySelectorAll("[data-sup-tank]").length;
    window.gasFetch = real;
    await switchProfile("default");
    for (const id of [a.id, b.id]) await api("/api/profiles?id=" + encodeURIComponent(id), { method: "DELETE" });
    profiles = (await api("/api/profiles")).profiles;
    state.passport = await put("/api/passport", { params: old });
    await api("/api/suppliers?id=svc", { method: "DELETE" });
    state = await api("/api/data"); render(); gasShell.show("home");
    return { list, opened, same, other, failed };`);
  assert.deepEqual(r.list, ["Дача: монтаж и обслуживание / warningТО просрочено: 01.02.2020 [over]", "Основной: обслуживание"]);
  assert.deepEqual(r.opened, { where: "passport", tank: true, mount: "ТехГаз" });
  assert.equal(r.same, true);
  assert.equal(r.other, "");
  assert.equal(r.failed, 1);
});

test("home shows a reminder about the next service from the passport: soon, today, overdue, far away", { skip }, async () => {
  const r = await B.eval(`
    const put = (body) => api("/api/passport", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const old = (state.passport && state.passport.params) || [];
    const ru = (d) => { const x = new Date(Date.now() + d * 864e5); return String(x.getDate()).padStart(2, "0") + "." + String(x.getMonth() + 1).padStart(2, "0") + "." + x.getFullYear(); };
    const period = async (p) => { state.settings = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servicePeriod: p }) }); fillSettings(); render(); };
    const set = async (next, org) => { state.passport = await put({ params: [{ k: "Следующее ТО / освидетельствование", v: next }, ...(org ? [{ k: "Обслуживание, контакты", v: org }] : [])] }); render(); gasShell.show("home"); await sleep(50); };
    const card = () => ({ shown: !$("m-to").hidden, over: $("m-to").classList.contains("over"), h: $("m-to-h").textContent, s: $("m-to-s").textContent, org: $("m-to-org").textContent });
    await set(ru(10)); await period(null); gasShell.show("home"); await sleep(50);
    const none = { ...card(), off: $("m-to").classList.contains("off") };
    $("m-to").click(); await sleep(80); const toTank = gasShell.where;
    $("s-svc-n").value = "6"; $("s-svc-u").value = "month"; $("m-pf-save").click(); await wait(() => state.settings.servicePeriod && state.settings.servicePeriod.n === 6);
    const saved = state.settings.servicePeriod;
    $("s-svc-n").value = ""; $("m-pf-save").click(); await wait(() => state.settings.servicePeriod === null);
    $("s-svc-n").value = "1"; $("s-svc-u").value = "year"; $("m-pf-save").click(); await wait(() => state.settings.servicePeriod && state.settings.servicePeriod.unit === "year");
    await set("");
    const noDate = { ...card(), off: $("m-to").classList.contains("off") };
    $("m-to").click(); await sleep(80); const toPassport = gasShell.where;
    state.passport = await put({ params: [{ k: "Последнее ТО / освидетельствование", v: ru(-360) }] }); render(); gasShell.show("home"); await sleep(50);
    const computed = card();
    await set(ru(10), "Газ-Сервис, +7 900 123-45-67"); const soon = card();
    await set(ru(0)); const today = card();
    await set(ru(-3)); const over = card();
    $("m-to").click(); await sleep(80); const where = gasShell.where;
    await set(ru(60)); const far = card().shown;
    await set("после зимы"); const text = card().shown;
    state.passport = await put({ params: old }); await period(null); gasShell.show("home");
    return { none, toTank, saved, noDate, toPassport, computed, soon, today, over, where, far, text, d10: ru(10), d0: ru(0), d3: ru(-3) };`);
  assert.deepEqual(r.none, { shown: true, over: false, h: "ТО не проводится", s: "период ТО не указан в настройках ёмкости", org: "", off: true });
  assert.equal(r.toTank, "tank");
  assert.deepEqual(r.saved, { n: 6, unit: "month" });
  assert.deepEqual(r.noDate, { shown: true, over: false, h: "Когда следующее ТО?", s: "укажите в паспорте дату последнего ТО", org: "", off: true });
  assert.equal(r.toPassport, "passport");
  assert.equal(r.computed.h, "Скоро ТО");
  assert.match(r.computed.s, /^через [45] дн(я|ей) · \d\d\.\d\d\.\d{4}$/);
  assert.deepEqual(r.soon, { shown: true, over: false, h: "Скоро ТО", s: "через 10 дней · " + r.d10, org: "Газ-Сервис, +7 900 123-45-67" });
  assert.deepEqual(r.today, { shown: true, over: false, h: "ТО сегодня", s: r.d0, org: "" });
  assert.deepEqual(r.over, { shown: true, over: true, h: "ТО просрочено", s: "3 дня назад · " + r.d3, org: "" });
  assert.equal(r.where, "passport");
  assert.equal(r.far, false);
  assert.equal(r.text, true);
});

test("switch tanks from the title on every tab and from «Ещё»", { skip }, async () => {
  const r = await B.eval(`
    const pick = async (key) => { await wait(() => $("m-sheet").open); document.querySelector('#m-sheet-b [data-pick="' + key + '"]').click(); await sleep(150); };
    const sheetItems = () => [...$("m-sheet-b").querySelectorAll("[data-pick]")].map((b) => b.dataset.pick + "=" + b.querySelector(".m-h").textContent + (b.querySelector(".ms").textContent === "radio_button_checked" ? "*" : ""));
    gasShell.show("home");
    const single = { sub: $("m-title-sub").hidden, pick: $("m-title").classList.contains("pick") };
    const dacha = await post("/api/profiles", { name: "Дача", volume: 2700 });
    await post("/api/readings?p=" + dacha.id, { date: iso(-1), time: "10:00", level: 77 });
    profiles = (await api("/api/profiles")).profiles; render(); await sleep(100);
    const n0 = state.readings.length;
    $("m-title").click(); await wait(() => $("m-sheet").open);
    const items = sheetItems();
    await pick("p:" + dacha.id);
    await wait(() => view.profile === dacha.id && state.readings.length === 1);
    const home = { title: $("m-title-t").textContent, snack: $("m-snack").textContent, ring: $("m-ring").textContent.includes("77") };
    gasShell.show("log"); await sleep(50);
    const log = { title: $("m-title-t").textContent, sub: $("m-title-sub").hidden ? "" : $("m-title-sub").textContent, rows: $("m-log").querySelectorAll("[data-reading]").length };
    $("m-title").click(); await pick("p:" + dacha.id);
    const same = view.profile === dacha.id && gasShell.where === "log";
    $("m-title").click(); await pick("p:default");
    await wait(() => view.profile === "default" && state.readings.length === n0);
    const back = { where: gasShell.where, rows: $("m-log").querySelectorAll("[data-reading]").length === state.readings.length };
    gasShell.show("more"); await sleep(50);
    const moreItem = [...$("m-tanks").querySelectorAll("[data-tank]")].map((b) => b.querySelector(".m-mid").textContent).join("|") + "|del:" + $("m-tanks").querySelectorAll("[data-tank-del]").length;
    $("m-tanks").querySelector('[data-tank-sw="default"]').click(); await sleep(100);
    const sameTank = view.profile + "|" + gasShell.where;
    $("m-tanks").querySelector('[data-tank-sw="' + dacha.id + '"]').click();
    await wait(() => view.profile === dacha.id && $("m-more").textContent.replace(/[^0-9]/g, "").includes("2700"));
    const fromMore = $("m-more").textContent + "|" + gasShell.where;
    $("m-tanks").querySelector('[data-tank="default"]').click(); await wait(() => view.profile === "default" && gasShell.where === "tank");
    const detail = gasShell.where + "|" + $("m-title-sub").textContent;
    gasShell.show("more"); $("m-tanks").querySelector('[data-tank-sw="' + dacha.id + '"]').click(); await wait(() => view.profile === dacha.id);
    gasShell.show("stats"); await sleep(50);
    const stats = $("m-title-sub").textContent;
    gasShell.open("passport");
    const inScreen = $("m-title").classList.contains("pick");
    $("m-title").click(); await sleep(100);
    const noSheet = !$("m-sheet").open;
    gasShell.show("home");
    const clicked = []; const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { clicked.push(this.id); };
    $("m-title").click(); await pick("import");
    HTMLInputElement.prototype.click = orig;
    $("m-title").click(); await wait(() => $("m-sheet").open); $("m-sheet").close(); await sleep(50);
    await switchProfile("default");
    await api("/api/profiles?id=" + dacha.id, { method: "DELETE" });
    profiles = (await api("/api/profiles")).profiles; render(); await sleep(100);
    return { single, items, home, log, same, back, moreItem, sameTank, fromMore, detail, stats, inScreen, noSheet, clicked, after: profiles.length, subGone: $("m-title-sub").hidden };`);
  assert.deepEqual(r.single, { sub: true, pick: true });
  assert.ok(r.items.includes("p:default=Основной*") && r.items.some((x) => /^p:p\w+=Дача$/.test(x)) && r.items.includes("new=Новая ёмкость") && r.items.includes("import=Загрузить архив…"), JSON.stringify(r.items));
  assert.equal(r.home.title, "Дача");
  assert.equal(r.home.snack, "Ёмкость: Дача");
  assert.equal(r.home.ring, true);
  assert.deepEqual(r.log, { title: "Журнал", sub: "Дача", rows: 1 });
  assert.equal(r.same, true);
  assert.deepEqual(r.back, { where: "log", rows: true });
  assert.match(r.moreItem, /^Основнойосновная · текущая · [\d\s\u00a0\u202f]+ л\|Дача\|del:1$/);
  assert.equal(r.sameTank, "default|more");
  assert.match(r.fromMore, /Ёмкости[\s\S]*Основнойосновная[\s\S]*Дачатекущая · 2\s700 л[\s\S]*Новая ёмкость[\s\S]*\|more$/);
  assert.equal(r.detail, "tank|Основной");
  assert.equal(r.stats, "Дача");
  assert.equal(r.inScreen, false);
  assert.equal(r.noSheet, true);
  assert.deepEqual(r.clicked, ["m-import-file"]);
  assert.equal(r.after, 1);
  assert.equal(r.subGone, true);
  assert.deepEqual(B.errors, []);
});

test("delete a tank from the «Ещё» list and from its settings screen; the main tank cannot be deleted", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch;
    const a = await post("/api/profiles", { name: "Склад", volume: 1000 });
    const b = await post("/api/profiles", { name: "Баня", volume: 500 });
    profiles = (await api("/api/profiles")).profiles; render();
    gasShell.show("more"); await sleep(100);
    const rows = $("m-tanks").querySelectorAll("[data-tank]").length;
    const noDelForMain = !$("m-tanks").querySelector('[data-tank-del="default"]');
    window.dlgManual = true;
    const answer = async (ok) => { await wait(() => $("ui-dlg").open); $(ok ? "ui-dlg-ok" : "ui-dlg-no").click(); await sleep(50); };
    $("m-tanks").querySelector('[data-tank-del="' + a.id + '"]').click();
    await wait(() => $("ui-dlg").open);
    const askText = $("ui-dlg-h").textContent + " | " + $("ui-dlg-t").textContent + " | " + $("ui-dlg-ok").textContent + " | " + $("ui-dlg-ok").classList.contains("danger");
    await answer(false);
    const kept = profiles.some((p) => p.id === a.id);
    window.gasFetch = async (url, o) => (url.startsWith("/api/profiles?id=") ? new Response(JSON.stringify({ error: "сбой сервера" }), { status: 500 }) : real(url, o));
    $("m-tanks").querySelector('[data-tank-del="' + a.id + '"]').click(); await answer(true); await wait(() => /сбой/.test($("m-snack").textContent));
    const failed = { snack: $("m-snack").textContent, kept: profiles.some((p) => p.id === a.id) };
    window.gasFetch = real;
    $("m-tanks").querySelector('[data-tank-del="' + a.id + '"]').click(); await answer(true);
    await wait(() => !profiles.some((p) => p.id === a.id) && /удалена/.test($("m-snack").textContent));
    const other = { snack: $("m-snack").textContent, cur: view.profile, rows: $("m-tanks").querySelectorAll("[data-tank]").length, sel: [...$("pf-sel").options].map((o) => o.value).includes(a.id) };
    $("m-tanks").querySelector('[data-tank="' + b.id + '"]').click(); await wait(() => view.profile === b.id && gasShell.where === "tank"); await sleep(80);
    const screen = { where: gasShell.where, del: !$("m-pf-del").hidden, sub: $("m-title-sub").hidden ? "" : $("m-title-sub").textContent, title: $("m-title-t").textContent };
    $("s-lead").value = "21"; $("m-pf-save").click(); await wait(() => state.settings.leadDays === 21);
    $("m-pf-del").click(); await answer(true);
    await wait(() => view.profile === "default" && !profiles.some((p) => p.id === b.id));
    const current = { where: gasShell.where, snack: $("m-snack").textContent, rows: $("m-tanks").querySelectorAll("[data-tank]").length };
    $("m-tanks").querySelector('[data-tank="default"]').click(); await sleep(80);
    const mainScreen = $("m-pf-del").hidden;
    $("m-pf-del").click(); await sleep(100);
    const mainKept = profiles.some((p) => p.id === "default") && view.profile === "default";
    $("m-more").querySelector('[data-more="tank-new"]') || 0;
    gasShell.show("more"); await sleep(50);
    const created = [];
    window.dlgManual = false;
    window.prompt = (() => { const ans = ["Гараж", "800"]; return () => ans.shift() ?? null; })();
    $("m-more").querySelector('[data-more="tank-new"]').click();
    await wait(() => profiles.some((p) => p.name === "Гараж") && view.profile !== "default");
    window.dlgManual = true;
    const garage = view.profile;
    window.prompt = () => null;
    gasShell.show("more"); await sleep(50);
    $("m-tanks").querySelector('[data-tank-del="' + garage + '"]').click(); await answer(true);
    await wait(() => view.profile === "default" && !profiles.some((p) => p.id === garage));
    gasShell.show("home");
    window.dlgManual = false;
    return { askText, rows, noDelForMain, kept, failed, other, screen, current, mainScreen, mainKept, garage: !!garage, left: profiles.length };`);
  assert.equal(r.rows, 3);
  assert.equal(r.noDelForMain, true);
  assert.equal(r.kept, true);
  assert.deepEqual(r.failed, { snack: "сбой сервера", kept: true });
  assert.deepEqual(r.other, { snack: "Ёмкость «Склад» удалена", cur: "default", rows: 2, sel: false });
  assert.deepEqual(r.screen, { where: "tank", del: true, sub: "Баня", title: "Ёмкость" });
  assert.equal(r.askText, "Удалить ёмкость «Склад»? | Показания, заправки, паспорт и фото этой ёмкости будут удалены из приложения. | Удалить | true");
  assert.deepEqual(r.current, { where: "more", snack: "Ёмкость «Баня» удалена", rows: 1 });
  assert.equal(r.mainScreen, true);
  assert.equal(r.mainKept, true);
  assert.equal(r.garage, true);
  assert.equal(r.left, 1);
  assert.deepEqual(B.errors, []);
});

test("rename the main tank and make another tank the main one from «Ещё»", { skip }, async () => {
  const r = await B.eval(`
    const n0 = state.readings.length;
    const d = await post("/api/profiles", { name: "Дача", volume: 2700 });
    await post("/api/readings?p=" + d.id, { date: iso(-2), time: "10:00", level: 64, note: "дача" });
    profiles = (await api("/api/profiles")).profiles; render();
    gasShell.show("more"); await sleep(80);
    const mainRow = $("m-tanks").querySelector('[data-tank="default"]').textContent;
    const noMainItem = !$("m-tanks").querySelector('[data-tank-main="default"]');
    window.prompt = (() => { const a = ["Дом"]; return () => a.shift() ?? null; })();
    $("m-tanks").querySelector('[data-tank="default"]').click(); await sleep(80);
    $("m-pf-ren").click();
    await wait(() => profiles.find((p) => p.id === "default").name === "Дом" && $("m-title-sub").textContent === "Дом");
    gasShell.show("more"); await sleep(50);
    const renamed = { title: $("m-title-sub").textContent, row: $("m-tanks").querySelector('[data-tank="default"]').textContent };
    window.confirm = () => false;
    $("m-tanks").querySelector('[data-tank-main="' + d.id + '"]').click(); await sleep(150);
    const declined = view.profile === "default" && profiles.find((p) => p.id === "default").name === "Дом";
    window.confirm = () => true;
    $("m-tanks").querySelector('[data-tank-main="' + d.id + '"]').click();
    await wait(() => view.profile === "default" && /теперь основная/.test($("m-snack").textContent));
    const swapped = { snack: $("m-snack").textContent, names: profiles.map((p) => p.id === "default" ? "*" + p.name : p.name).join("|"), notes: state.readings.map((x) => x.note).join("|"),
      row: $("m-tanks").querySelector('[data-tank="default"]').textContent, delOld: !!$("m-tanks").querySelector('[data-tank-del="' + d.id + '"]'), noMainItem: !$("m-tanks").querySelector('[data-tank-main="default"]') && !!$("m-tanks").querySelector('[data-tank-main="' + d.id + '"]'), where: gasShell.where };
    const back = await api("/api/profiles/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) });
    await api("/api/profiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "default", name: "Основной" }) });
    await api("/api/profiles?id=" + d.id, { method: "DELETE" });
    profiles = (await api("/api/profiles")).profiles; await switchProfile("default");
    window.prompt = () => null;
    gasShell.show("home");
    return { mainRow, noMainItem, renamed, declined, swapped, backNames: back.profiles.map((p) => p.name).join("|"), restored: state.readings.length === n0 && profiles.length === 1 && profiles[0].name === "Основной" };`);
  assert.match(r.mainRow, /Основной\s*основная · текущая/);
  assert.equal(r.noMainItem, true);
  assert.equal(r.renamed.title, "Дом");
  assert.match(r.renamed.row, /Дом/);
  assert.equal(r.declined, true);
  assert.equal(r.swapped.snack, "«Дача» — теперь основная ёмкость");
  assert.equal(r.swapped.names, "*Дача|Дом");
  assert.equal(r.swapped.notes, "дача");
  assert.match(r.swapped.row, /Дача\s*основная · текущая/);
  assert.equal(r.swapped.delOld, true);
  assert.equal(r.swapped.noMainItem, true);
  assert.equal(r.swapped.where, "more");
  assert.equal(r.backNames, "Дом|Дача");
  assert.equal(r.restored, true);
  assert.deepEqual(B.errors, []);
});

test("several photos from the gallery: names without an extension, progress and errors are shown on any screen", { skip }, async () => {
  const r = await B.eval(`
    const pick = async (key) => { await wait(() => $("m-sheet").open); document.querySelector('#m-sheet-b [data-pick="' + key + '"]').click(); await sleep(150); };
    const png = async (c, name, type) => { const cv = document.createElement("canvas"); cv.width = cv.height = 40; const g = cv.getContext("2d"); g.fillStyle = c; g.fillRect(0, 0, 40, 40);
      const bytes = await new Promise((o) => cv.toBlob(o, "image/png")); return new File([bytes], name, { type }); };
    const n0 = state.readings.length;
    gasShell.show("log"); await sleep(50);
    const status = []; const real = window.gasStatus; window.gasStatus = (m) => { status.push(m); real(m); };
    const clicked = []; const origClick = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { clicked.push(this.id); };
    $("m-fab").click(); await pick("reading"); await pick("gallery");
    HTMLInputElement.prototype.click = origClick;
    const dt = new DataTransfer();
    dt.items.add(await png("#f00", "IMG_20261101_100000.png", "image/png"));
    dt.items.add(await png("#0f0", "1000012345", ""));
    dt.items.add(await png("#00f", "1000012346", "image/png"));
    $("file").files = dt.files; $("file").dispatchEvent(new Event("change"));
    await wait(() => $("editor").open);
    const first = { queue: $("ed-queue").textContent, file: $("ed-file").textContent, del: $("ed-del").hidden };
    const names = [];
    for (let i = 0; i < 3; i++) { names.push($("ed-file").textContent); $("ed-date").value = iso(-5 + i); $("ed-time").value = "10:00"; $("ed-level").value = String(60 - i); $("ed-save").click(); await sleep(250); }
    await wait(() => !$("editor").open && state.readings.length === n0 + 3);
    const bad = new DataTransfer(); bad.items.add(new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], "note.txt", { type: "" }));
    $("file").files = bad.files; $("file").dispatchEvent(new Event("change"));
    await wait(() => /Не загружено фото: 1 из 1/.test($("m-snack").textContent), 8000);
    const err = $("m-snack").textContent;
    window.gasStatus = real;
    const mine = state.readings.filter((x) => names.includes(x.file));
    $("m-log").querySelector('[data-reading="' + mine[0].id + '"]').click(); await wait(() => $("editor").open);
    const delShown = !$("ed-del").hidden;
    $("ed-del").click(); await sleep(30);
    const armed = $("ed-del").textContent;
    $("ed-del").click(); await wait(() => !$("editor").open);
    const removed = !state.readings.some((x) => x.id === mine[0].id);
    for (const x of mine.slice(1)) await api("/api/readings?id=" + encodeURIComponent(x.id), { method: "DELETE" });
    state = await api("/api/data"); render(); gasShell.show("home");
    return { clicked, first, names, status: status.filter(Boolean)[0], err, delShown, armed, removed };`);
  assert.deepEqual(r.clicked, ["file"]);
  assert.deepEqual({ ...r.first, file: "" }, { queue: "ещё в очереди: 2", file: "", del: true });
  assert.deepEqual([...r.names].sort(), ["1000012345.png", "1000012346.png", "IMG_20261101_100000.png"]);
  assert.match(r.status, /^Загружаю 1 из 3: /);
  assert.match(r.err, /^Не загружено фото: 1 из 1\. note\.txt: /);
  assert.equal(r.delShown, true);
  assert.equal(r.armed, "Точно удалить?");
  assert.equal(r.removed, true);
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
    const putP = (params) => api("/api/passport", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
    const oldP = (state.passport && state.passport.params) || [];
    const due = new Date(Date.now() + 20 * 864e5), dueText = String(due.getDate()).padStart(2, "0") + "." + String(due.getMonth() + 1).padStart(2, "0") + "." + due.getFullYear();
    const nCalls0 = called("LocalNotifications.schedule").length;
    state.passport = await putP([{ k: "Следующее ТО / освидетельствование", v: dueText }, { k: "Обслуживание, контакты", v: "ТехГаз" }]); render();
    await wait(() => called("LocalNotifications.schedule").length > nCalls0);
    const noPeriod = called("LocalNotifications.schedule").at(-1)[1].notifications.filter((n) => /ТО/.test(n.title)).length;
    state.settings = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servicePeriod: { n: 1, unit: "year" } }) }); render();
    await wait(() => called("LocalNotifications.schedule").at(-1)[1].notifications.some((n) => /ТО/.test(n.title)));
    const svc = called("LocalNotifications.schedule").at(-1)[1].notifications.filter((n) => /ТО/.test(n.title)).map((n) => n.title + " | " + n.body + " | " + n.extra.open);
    const nCalls = called("LocalNotifications.schedule").length;
    $("m-service-rem").checked = false; $("m-service-rem").dispatchEvent(new Event("change"));
    await wait(() => called("LocalNotifications.schedule").length > nCalls);
    const svcOff = called("LocalNotifications.schedule").at(-1)[1].notifications.filter((n) => /ТО/.test(n.title)).length;
    $("m-service-rem").checked = true; $("m-service-rem").dispatchEvent(new Event("change"));
    gasShell.show("home");
    __cap.fire("LN:localNotificationActionPerformed", { notification: { extra: { profile: "default", open: "passport" } } });
    await wait(() => gasShell.where === "passport");
    const tapped = gasShell.where;
    state.settings = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ servicePeriod: null }) });
    state.passport = await putP(oldP); render(); gasShell.show("home");
    $("m-notify").checked = false; $("m-notify").dispatchEvent(new Event("change"));
    await sleep(700);
    return { noPeriod, svc, svcOff, tapped, dueText, w, sched, sched2, next, widget: called("GasNative.updateWidget").length, channel: called("LocalNotifications.createChannel").length, nextOff: $("m-next").textContent, sum: $("m-sum").textContent };`);
  assert.deepEqual(r.svc, [
    "Через неделю ТО — Основной | Следующее ТО / освидетельствование: " + r.dueText + " · ТехГаз. | passport",
    "Сегодня ТО — Основной | Следующее ТО / освидетельствование: " + r.dueText + " · ТехГаз. | passport",
    "ТО просрочено — Основной | Срок был " + r.dueText + ". После ТО укажите новую дату в паспорте ёмкости. | passport",
  ]);
  assert.equal(r.svcOff, 0);
  assert.equal(r.noPeriod, 0);
  assert.equal(r.tapped, "passport");
  assert.equal(r.w.name, "Основной");
  assert.ok(r.w.levels.length > 10);
  assert.equal(r.w.labels.liters, "л");
  assert.ok(r.widget >= 1);
  assert.ok(r.channel >= 1);
  assert.ok(r.sched.length >= 7, JSON.stringify(r.sched.map((n) => n.title)));
  assert.ok(r.sched.every((n) => n.channelId === "gas" && n.extra.profile === "default"));
  assert.ok([...r.sched, ...r.sched2].every((n) => n.isExactNotification === false), "reminders must not ask for the exact-alarm permission");
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

test("camera shots are saved to the phone gallery: guided camera, system camera, switched off, errors", { skip }, async () => {
  const r = await B.eval(`
    __cap.gallery = [];
    const d = await dial(55);
    __cap.ocr = null;
    __cap.put("/fake/cache/camera/IMG_20261114_090000.png", d.bytes);
    __cap.capturePath = "/fake/cache/camera/IMG_20261114_090000.png";
    $("m-camera").click();
    await wait(() => __cap.gallery.length === 1 && $("editor").open);
    $("ed-close").click();
    const guided = __cap.gallery[0];
    const shot = new File([d.bytes], "камера 1.png", { type: "image/png" });
    const inp = $("m-camera-file"), dt = new DataTransfer(); dt.items.add(shot); inp.files = dt.files; inp.dispatchEvent(new Event("change"));
    await wait(() => __cap.gallery.length === 2 && $("editor").open);
    $("ed-close").click(); await sleep(100);
    const sys = __cap.gallery[1];
    const left = [...__cap.files.keys()].filter((k) => k.includes("/cache/gallery/")).length;
    __cap.galleryFail = "UNSUPPORTED"; $("m-camera").click();
    await wait(() => /Android 10/.test($("m-snack").textContent)); const old = $("m-snack").textContent;
    await wait(() => $("editor").open); $("ed-close").click();
    __cap.galleryFail = "FAILED"; $("m-camera").click();
    await wait(() => /галерею: no space/.test($("m-snack").textContent)); const failed = $("m-snack").textContent;
    await wait(() => $("editor").open); $("ed-close").click();
    __cap.galleryFail = "";
    $("m-gallery").checked = false; $("m-gallery").dispatchEvent(new Event("change"));
    const n = __cap.gallery.length;
    $("m-camera").click(); await wait(() => $("editor").open); $("ed-close").click(); await sleep(100);
    const off = { calls: __cap.gallery.length - n, saved: JSON.parse(localStorage.getItem("gas-mobile")).saveGallery };
    $("m-gallery").checked = true; $("m-gallery").dispatchEvent(new Event("change"));
    __cap.capturePath = "";
    return { guided, sys, left, old, failed, off };`);
  assert.deepEqual(r.guided, { path: "file:///fake/cache/camera/IMG_20261114_090000.png", name: "IMG_20261114_090000.png", exists: true });
  assert.equal(r.sys.name, "камера 1.png");
  assert.match(r.sys.path, /^file:\/\/\/fake\/cache\/gallery\/\d+-_+_1\.png$/);
  assert.equal(r.sys.exists, true);
  assert.equal(r.left, 0);
  assert.match(r.old, /Android 10 и новее/);
  assert.match(r.failed, /Не удалось сохранить фото в галерею: no space/);
  assert.deepEqual(r.off, { calls: 0, saved: false });
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
