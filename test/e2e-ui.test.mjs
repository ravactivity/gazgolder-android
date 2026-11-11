import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageOf, findChrome, launch, serve } from "../scripts/cdp.mjs";
import { demoFiles } from "../scripts/demo-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome or Edge (set CHROME_PATH)" : false;
const MIN_COVERAGE = 90;
let srv, B;

before(async () => {
  if (skip) return;
  srv = await serve({ demo: await demoFiles() });
  B = await launch({ width: 1280, height: 900 });
  await B.startCoverage();
  await B.goto(`${srv.url}/index.html?lang=ru&demo`);
  await B.eval(`
    window.wait = async (fn, ms = 6000) => { const t = Date.now(); for (;;) { let v; try { v = await fn(); } catch {} if (v) return v; if (Date.now() - t > ms) throw new Error("timeout: " + fn); await new Promise((r) => setTimeout(r, 30)); } };
    window.$ = (id) => document.getElementById(id);
    window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.clickAll = async (sel) => { for (const b of [...document.querySelectorAll(sel)]) { b.click(); await sleep(30); } };
    window.prompts = []; window.prompt = () => prompts.shift() ?? null; window.confirm = () => true; window.alert = () => {};
    window.png = async (w = 64, h = 48, color = "#c33", name) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
      return new File([await new Promise((ok) => c.toBlob(ok, "image/png"))], name || "photo_" + Math.random().toString(36).slice(2, 7) + ".png", { type: "image/png" }); };
    window.submit = (id) => $(id).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    window.hover = (svg) => { if (!svg) return; const r = svg.getBoundingClientRect(); for (const f of [0.1, 0.3, 0.5, 0.7, 0.95]) for (const el of svg.querySelectorAll("*")) {
      el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: r.left + r.width * f, clientY: r.top + r.height * 0.5 })); }
      for (const el of svg.querySelectorAll("*")) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })); };
    await wait(() => typeof state !== "undefined" && state.readings.length > 50);
    await sleep(300);
  `);
});

after(async () => {
  if (!B) return;
  const page = readFileSync(join(here, "../www/index.html"), "utf8");
  const start = page.indexOf("<script>" + String.fromCharCode(10) + '"use strict";') + 8, src = page.slice(start, page.indexOf("</script>", start));
  const entries = (await B.takeCoverage()).filter((e) => /index\.html/.test(e.url))
    .map((e) => ({ ...e, functions: e.functions.map((f) => ({ ...f, ranges: f.ranges.map((r) => ({ ...r, startOffset: r.startOffset - start, endOffset: r.endOffset - start })) })) }));
  const c = coverageOf(entries, "", src);
  console.log(`shared UI script coverage: ${c.pct.toFixed(1)}% (${c.hit}/${c.lines}); missed lines: ${c.missed.join(", ")}`);
  await B.close();
  srv.close();
  if (c.pct < MIN_COVERAGE) { console.error(`shared UI coverage ${c.pct.toFixed(1)}% is below ${MIN_COVERAGE}%`); process.exitCode = 1; }
});

test("summary, forecast, plan and statistics are computed from two years of data", { skip }, async () => {
  const r = await B.eval(`return {
    now: $("t-now").textContent, rate: $("t-rate").textContent, next: $("t-next").textContent,
    plan: $("plan-kpis").textContent.length, rows: document.querySelectorAll("#stats tr").length, years: $("years").textContent.length,
    level: !!document.querySelector("#level-chart svg, #level-chart path"), month: !!document.querySelector("#month-chart svg, #month-chart path"),
    cons: $("cons-kpis").textContent.length, sc: $("sc-kpis").textContent.length, refuels: document.querySelectorAll("#rf-rows tr").length, readings: document.querySelectorAll("#rows tr").length };`);
  assert.match(r.now, /\d/);
  assert.match(r.rate, /\d/);
  assert.ok(r.next.length > 0);
  assert.ok(r.plan > 10 && r.rows > 2 && r.years > 10 && r.cons > 10 && r.sc > 10, JSON.stringify(r));
  assert.ok(r.level && r.month);
  assert.ok(r.refuels >= 3 && r.readings > 50);
  assert.deepEqual(B.errors, []);
});

test("units, periods, methods, ranges, threshold, plan modes and chart tooltips", { skip }, async () => {
  const r = await B.eval(`
    const seen = new Set();
    for (const u of ["pct", "l"]) for (const per of ["week", "month", "day"]) {
      document.querySelector('[data-u="' + u + '"]').click(); document.querySelector('[data-per="' + per + '"]').click(); await sleep(40);
      seen.add($("t-rate").textContent);
    }
    for (const o of [...$("method").options]) { $("method").value = o.value; $("method").dispatchEvent(new Event("change")); await sleep(40); }
    await clickAll("[data-m]"); await clickAll("[data-mr]");
    $("m-thr").value = "3"; $("m-thr").dispatchEvent(new Event("change")); $("m-thr").dispatchEvent(new Event("input"));
    const over = document.querySelectorAll("#month-chart [fill='var(--over)'], #month-chart .over").length;
    $("m-thr").value = ""; $("m-thr").dispatchEvent(new Event("change"));
    document.querySelector('[data-pm="annual"]').click(); await sleep(100);
    const annual = $("plan-rows").textContent.length + $("plan-kpis").textContent.length;
    await clickAll("[data-am]");
    if ($("am-month")) { for (const o of [...$("am-month").options || []]) { $("am-month").value = o.value; $("am-month").dispatchEvent(new Event("change")); await sleep(30); } }
    for (const svg of document.querySelectorAll("svg")) hover(svg);
    document.querySelector('[data-pm="normal"]').click(); await sleep(80);
    for (const svg of document.querySelectorAll("svg")) hover(svg);
    await clickAll("[data-rf-fill]");
    return { rates: seen.size, over, annual };`);
  assert.ok(r.rates >= 4, JSON.stringify(r));
  assert.ok(r.annual > 20);
  assert.deepEqual(B.errors, []);
});

test("settings, consumers, boiler mode log and scenarios", { skip }, async () => {
  const r = await B.eval(`
    $("s-volume").value = "4000"; $("s-min").value = "15"; $("s-max").value = "80"; $("s-delivery").value = "1500"; $("s-lead").value = "10";
    submit("settings"); await wait(() => $("s-status").textContent);
    const ok = $("s-status").textContent;
    $("s-min").value = "90"; submit("settings"); await sleep(300);
    const bad = $("s-status").textContent;
    $("s-min").value = "20"; $("s-max").value = "85"; $("s-volume").value = "4600"; submit("settings"); await sleep(300);
    $("c-dhw").value = "50"; $("c-heat").value = "60"; $("c-off-from").value = "5"; $("c-off-to").value = "9";
    submit("cons-form"); await wait(() => $("c-status").textContent);
    $("c-dhw").value = "5"; submit("cons-form"); await sleep(300);
    const cbad = $("c-status").textContent;
    $("c-dhw").value = "55"; submit("cons-form"); await sleep(300);
    const mdBefore = document.querySelectorAll("#md-rows tr").length;
    for (const [d, m] of [["2025-06-01", "dhw"], ["2025-09-15", "both"], ["2026-05-01", "off"], ["2026-06-01", "heat"]]) {
      $("md-date").value = d; $("md-mode").value = m; $("md-dhw").value = "50"; $("md-heat").value = "60"; submit("md-form"); await sleep(250);
    }
    $("md-date").value = ""; submit("md-form"); await sleep(200);
    const mdAfter = document.querySelectorAll("#md-rows tr").length;
    for (const b of [...document.querySelectorAll("[data-md-del]")].slice(0, 2)) { b.click(); await sleep(250); }
    await clickAll("[data-preset]");
    for (const id of ["sc-heat", "sc-dhw", "sc-tdhw", "sc-theat"]) { const el = $(id); if (el.type === "checkbox") el.checked = !el.checked; else el.value = el.value ? String(+el.value - 5) : "50"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); await sleep(40); }
    submit("sc-form"); await sleep(100);
    hover(document.querySelector("#sc-chart svg"));
    return { ok, bad, cbad, mdBefore, mdAfter, sc: $("sc-kpis").textContent.length };`);
  assert.match(r.ok, /Сохранено/);
  assert.notEqual(r.bad, r.ok);
  assert.ok(r.mdAfter > r.mdBefore, JSON.stringify(r));
  assert.ok(r.sc > 10);
  assert.deepEqual(B.errors, []);
});

test("refuels: computed fields, add, edit, cancel, delete", { skip }, async () => {
  const r = await B.eval(`
    const n0 = document.querySelectorAll("#rf-rows tr").length;
    $("rf-date").value = "2026-10-20"; $("rf-liters").value = "1000"; $("rf-price").value = "42"; $("rf-liters").dispatchEvent(new Event("input", { bubbles: true })); $("rf-price").dispatchEvent(new Event("input", { bubbles: true }));
    const total = $("rf-total").value || $("rf-total").placeholder;
    $("rf-total").value = "45000"; $("rf-total").dispatchEvent(new Event("input", { bubbles: true })); $("rf-price").value = ""; $("rf-price").dispatchEvent(new Event("input", { bubbles: true }));
    $("rf-price").value = ""; $("rf-total").value = "42000"; $("rf-note").value = "тест";
    submit("rf-form"); await wait(() => document.querySelectorAll("#rf-rows tr").length > n0);
    document.querySelector("[data-rf-edit]").click(); await sleep(100);
    const editing = !$("rf-cancel").hidden;
    $("rf-cancel").click(); await sleep(100);
    document.querySelector("[data-rf-edit]").click(); await sleep(100);
    $("rf-note").value = "изменено"; submit("rf-form"); await sleep(300);
    $("rf-liters").value = ""; $("rf-total").value = ""; $("rf-price").value = ""; $("rf-date").value = "2026-10-21"; submit("rf-form"); await sleep(300);
    const err = $("rf-err").textContent;
    const del = [...document.querySelectorAll("[data-rf-del]")].find((b) => b.closest("tr").textContent.includes("изменено"));
    del.click(); await sleep(100); if (document.querySelectorAll("#rf-rows tr").length > n0) { del.click(); await sleep(300); }
    return { n0, total, editing, err, n1: document.querySelectorAll("#rf-rows tr").length };`);
  assert.equal(r.editing, true);
  assert.match(r.err, /литров/);
  assert.equal(r.n1, r.n0);
  assert.deepEqual(B.errors, []);
});

test("suppliers: add, edit, contacts, pick in a refuel, plan line, protected delete", { skip }, async () => {
  const r = await B.eval(`
    const empty = $("sp-rows").textContent;
    const add = async (v) => { for (const [k, x] of Object.entries(v)) $("sp-" + k).value = x; submit("sp-form"); await wait(() => !$("sp-save").disabled && state.suppliers.some((s) => s.short === v.short)); };
    await add({ short: "Газ-Сервис", full: "ООО «Газ-Сервис»", phone: "+7 900 123-45-67", messenger: "@gas_service", email: "gs@example.com", address: "ул. Заводская, 1", note: "мин. 2000 л" });
    await add({ short: "Бета", messenger: "+7 (901) 222-33-44" });
    await add({ short: "Гамма", messenger: "https://example.com/chat" });
    await add({ short: "Дельта", messenger: "по звонку" });
    $("sp-short").value = ""; submit("sp-form"); await sleep(200);
    const spErr = $("sp-err").textContent;
    const links = [...$("sp-rows").querySelectorAll("a")].map((a) => a.getAttribute("href"));
    const gs = state.suppliers.find((s) => s.short === "Газ-Сервис");
    $("sp-rows").querySelector('[data-sp-edit="' + gs.id + '"]').click(); await sleep(100);
    const editing = !$("sp-cancel").hidden && $("sp-short").value === "Газ-Сервис";
    $("sp-cancel").click();
    $("sp-rows").querySelector('[data-sp-edit="' + gs.id + '"]').click(); await sleep(100);
    $("sp-note").value = "доставка 2 дня"; submit("sp-form"); await wait(() => supById(gs.id).note === "доставка 2 дня");
    fillRefuel(null);
    $("rf-date").value = "2026-10-28"; $("rf-liters").value = "1500"; $("rf-price").value = "39.5"; $("rf-supplier").value = gs.id;
    submit("rf-form"); await wait(() => state.refuels.some((x) => x.supplier === gs.id));
    const def = $("rf-supplier").value;
    const cell = [...$("rf-rows").querySelectorAll("tr")].find((tr) => tr.textContent.includes("Газ-Сервис")) ? 1 : 0;
    const plan = $("plan-text").textContent;
    const row = [...$("sp-rows").querySelectorAll("tr")].find((tr) => tr.textContent.includes("Газ-Сервис")).textContent;
    state.refuels.push({ id: "ghost", date: "2020-01-01", liters: 1, price: null, total: null, note: "", supplier: "gone" }); render();
    fillRefuel(state.refuels.find((x) => x.id === "ghost"));
    const ghost = $("rf-supplier").value + "|" + $("rf-rows").textContent.includes("gone");
    state.refuels = state.refuels.filter((x) => x.id !== "ghost"); fillRefuel(null); render();
    const del = (id) => $("sp-rows").querySelector('[data-sp-del="' + id + '"]');
    del(gs.id).click(); del(gs.id).click(); await wait(() => $("sp-err").textContent);
    const inUse = $("sp-err").textContent;
    const beta = state.suppliers.find((s) => s.short === "Бета").id;
    del(beta).click(); await sleep(50); del(beta).click(); await wait(() => !supById(beta));
    del(gs.id).click(); await sleep(3200); const reset = del(gs.id).textContent;
    return { empty, spErr, links, editing, def, cell, plan, row, ghost, inUse, reset, n: state.suppliers.length };`);
  assert.match(r.empty, /Поставщиков пока нет/);
  assert.match(r.spErr, /краткое название/);
  assert.ok(r.links.includes("tel:+79001234567") && r.links.includes("https://t.me/gas_service") && r.links.includes("mailto:gs@example.com"));
  assert.ok(r.links.includes("https://wa.me/79012223344") && r.links.includes("https://example.com/chat"));
  assert.equal(r.editing, true);
  assert.ok(r.def && r.cell === 1);
  assert.match(r.plan, /Последний поставщик: Газ-Сервис · 39,50 ₽\/л/);
  assert.match(r.row, /доставка 2 дня/);
  assert.equal(r.ghost, "gone|true");
  assert.match(r.inUse, /указан в заправках/);
  assert.equal(r.reset, "Удалить");
  assert.equal(r.n, 3);
  assert.deepEqual(B.errors, []);
});

test("readings: manual entry, photo upload with quick levels, edit, attach, detach, skip, delete", { skip }, async () => {
  const r = await B.eval(`
    const n0 = state.readings.length;
    $("manual").click(); await wait(() => $("editor").open);
    $("ed-date").value = "2026-10-25"; $("ed-time").value = "11:30"; $("ed-level").value = "44"; $("ed-note").value = "вручную";
    $("ed-save").click(); await wait(() => state.readings.length === n0 + 1);
    const f1 = await png(), f2 = await png(80, 60, "#3c3");
    await uploadFiles([f1, f2]); await wait(() => $("editor").open);
    const queue = $("ed-queue").textContent;
    await clickAll("#ed-quick [data-v]");
    $("ed-date").value = "2026-10-26"; $("ed-time").value = "12:00";
    $("ed-save").click(); await wait(() => /photo_/.test($("ed-file").textContent) && state.readings.length === n0 + 2);
    $("ed-skip").click(); await sleep(300);
    if ($("editor").open) $("ed-close").click();
    const withPhoto = state.readings.find((x) => x.file);
    document.querySelector('[data-open="' + CSS.escape(withPhoto.id) + '"]').click(); await wait(() => $("editor").open);
    if (!$("ed-exifdiff").hidden) $("ed-exifuse").click();
    if (!$("ed-detach").hidden) { $("ed-detach-btn").click(); await sleep(400); }
    if ($("editor").open) $("ed-close").click();
    const manual = state.readings.find((x) => !x.file && x.note === "вручную");
    const att = document.querySelector('[data-attach="' + CSS.escape(manual.id) + '"]');
    if (att) {
      att.click(); await wait(() => $("editor").open);
      const dt = new DataTransfer(); dt.items.add(await png(50, 50, "#33c")); $("ed-attach-file").files = dt.files; $("ed-attach-file").dispatchEvent(new Event("change"));
      await sleep(500); if ($("editor").open) { $("ed-level").value = "43"; $("ed-save").click(); await sleep(400); }
      if ($("editor").open) $("ed-close").click();
    }
    $("manual").click(); await wait(() => $("editor").open);
    $("ed-date").value = "2026-10-27"; $("ed-time").value = "08:00"; $("ed-level").value = "41";
    $("ed-save").click(); await wait(() => !$("editor").open);
    $("manual").click(); await wait(() => $("editor").open);
    $("ed-date").value = "2026-10-27"; $("ed-time").value = "08:00"; $("ed-level").value = "40";
    $("ed-save").click(); await sleep(400);
    const dup = $("ed-err").textContent;
    $("ed-level").value = ""; $("ed-save").click(); await sleep(300);
    const nolvl = $("ed-err").textContent;
    $("ed-close").click();
    const drop = new DataTransfer(); drop.items.add(await png(40, 40, "#999"));
    $("drop").dispatchEvent(new DragEvent("dragover", { dataTransfer: drop, bubbles: true, cancelable: true }));
    $("drop").dispatchEvent(new DragEvent("dragleave", { dataTransfer: drop, bubbles: true }));
    $("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: drop, bubbles: true, cancelable: true }));
    await wait(() => $("editor").open); $("ed-close").click();
    const dt2 = new DataTransfer(); dt2.items.add(await png()); $("file").files = dt2.files; $("file").dispatchEvent(new Event("change")); await wait(() => $("editor").open); $("ed-close").click();
    for (const b of [...document.querySelectorAll("[data-del]")].slice(0, 2)) { b.click(); await sleep(150); if (document.contains(b)) { b.click(); await sleep(300); } }
    return { n0, queue, dup, nolvl, n1: state.readings.length };`);
  assert.match(r.queue, /очереди: 1/);
  assert.match(r.dup, /уже есть показание/);
  assert.match(r.nolvl, /укажите уровень/);
  assert.ok(r.n1 >= r.n0, JSON.stringify(r));
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("readings: photos without EXIF take the date from the file name or need it entered by hand", { skip }, async () => {
  const r = await B.eval(`
    const n0 = state.readings.length;
    await uploadFiles([await png(40, 40, "#c3c", "IMG-20261108-WA0003.png")]); await wait(() => $("editor").open);
    const a = { date: $("ed-date").value, time: $("ed-time").value, warn: $("ed-exif").hidden ? "" : $("ed-exif").textContent, req: $("ed-time").required };
    $("ed-close").click();
    await uploadFiles([await png(40, 40, "#3cc", "photo_2026-11-08_18-21-03.png")]); await wait(() => $("editor").open);
    const b = { date: $("ed-date").value, time: $("ed-time").value, req: $("ed-time").required };
    $("ed-close").click();
    await uploadFiles([await png(40, 40, "#cc3", "telegram-photo.png")]); await wait(() => $("editor").open);
    const c = { date: $("ed-date").value, warn: $("ed-exif").textContent, req: $("ed-time").required, valid: $("ed-form").checkValidity() };
    $("ed-level").value = "40"; $("ed-save").click(); await sleep(300);
    const blocked = $("editor").open && state.readings.length === n0;
    $("ed-date").value = "2026-11-09"; $("ed-time").value = "10:15"; $("ed-save").click();
    await wait(() => state.readings.length === n0 + 1);
    const saved = state.readings.find((x) => x.file === "telegram-photo.png");
    return { a, b, c, blocked, saved: saved && saved.date + " " + saved.time };
  `);
  assert.deepEqual(r.a, { date: "2026-11-08", time: "", warn: "В фото нет даты съёмки — дата взята из имени файла, проверьте её.", req: true });
  assert.deepEqual(r.b, { date: "2026-11-08", time: "18:21:03", req: false });
  assert.deepEqual(r.c, { date: "", warn: "В фото и в имени файла нет даты съёмки — укажите дату и время вручную.", req: true, valid: false });
  assert.equal(r.blocked, true);
  assert.equal(r.saved, "2026-11-09 10:15:00");
  assert.deepEqual(B.errors, []);
});

test("passport: parameters, text, photos with captions, viewer, delete", { skip }, async () => {
  const r = await B.eval(`
    $("pp-add").click(); $("pp-add").click(); await sleep(50);
    const rows = $("pp-params").querySelectorAll("input");
    if (rows.length >= 2) { rows[rows.length - 2].value = "Давление"; rows[rows.length - 1].value = "1,6 МПа"; rows[rows.length - 1].dispatchEvent(new Event("input", { bubbles: true })); }
    $("pp-text").value = "Заметки о ёмкости"; $("pp-text").dispatchEvent(new Event("input", { bubbles: true }));
    submit("pp-form"); await wait(() => $("pp-status").textContent); await sleep(200);
    for (const k of document.querySelectorAll("#pp-params [data-key]")) { k.click(); await sleep(20); }
    const dt = new DataTransfer(); dt.items.add(await png(120, 90, "#a5a")); dt.items.add(await png(90, 120, "#5aa"));
    $("pp-file").files = dt.files; $("pp-file").dispatchEvent(new Event("change"));
    await wait(() => document.querySelectorAll("[data-pp-open]").length >= 2, 8000);
    const cap = document.querySelector("[data-pp-cap]"); cap.value = "Табличка"; cap.dispatchEvent(new Event("input", { bubbles: true })); cap.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(400);
    document.querySelector("[data-pp-open]").click(); await wait(() => $("pp-view").open);
    $("pp-next").click(); $("pp-prev").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    const viewCap = $("pp-view-cap").textContent;
    $("pp-view-close").click();
    const ppd = new DataTransfer(); ppd.items.add(await png(30, 30, "#000"));
    $("pp-drop").dispatchEvent(new DragEvent("dragover", { dataTransfer: ppd, bubbles: true, cancelable: true }));
    $("pp-drop").dispatchEvent(new DragEvent("drop", { dataTransfer: ppd, bubbles: true, cancelable: true }));
    await sleep(600);
    const del = document.querySelector("[data-pp-del]"); del.click(); await sleep(50); del.click();
    await sleep(500);
    return { status: $("pp-status").textContent, viewCap, photos: document.querySelectorAll("[data-pp-open]").length, sum: $("pp-sum").textContent };`);
  assert.ok(r.photos >= 2, JSON.stringify(r));
  assert.match(r.viewCap, /Табличка|photo_/);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("tanks: create, switch, rename, delete; fold and unfold panels", { skip }, async () => {
  const r = await B.eval(`
    prompts.push("Дача", "1000"); $("pf-new").click(); await wait(() => curProfile().name === "Дача");
    const empty = $("sub").textContent + $("t-now").textContent;
    prompts.push("Дача у реки"); $("pf-ren").click(); await wait(() => curProfile().name === "Дача у реки");
    prompts.push("", null); $("pf-new").click(); await sleep(100);
    prompts.push("X", "abc"); $("pf-new").click(); await sleep(100);
    $("pf-del").click(); await wait(() => curProfile().id === "default");
    $("pf-sel").value = "default"; $("pf-sel").dispatchEvent(new Event("change")); await sleep(200);
    await clickAll(".fold"); await clickAll(".fold");
    document.querySelector('[data-fold-all="1"]').click(); await sleep(50);
    for (const h of document.querySelectorAll(".fold-title h2")) { h.click(); await sleep(10); }
    document.querySelector('[data-fold-all="0"]').click(); await sleep(50);
    return { empty, profiles: profiles.length, folded: document.querySelectorAll(".panel.folded").length };`);
  assert.ok(r.empty.length > 0);
  assert.equal(r.profiles, 1);
  assert.equal(r.folded, 0);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});
