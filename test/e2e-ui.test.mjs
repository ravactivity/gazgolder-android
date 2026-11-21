import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageOf, findChrome, launch, serve } from "../scripts/cdp.mjs";
import { demoFiles } from "../scripts/demo-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome or Edge (set CHROME_PATH)" : false;
const MIN_COVERAGE = 97;
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
    window.png = async (w = 64, h = 48, color = "#c33", name) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = color; g.fillRect(0, 0, w, h);
      return new File([await new Promise((ok) => c.toBlob(ok, "image/png"))], name || "photo_" + Math.random().toString(36).slice(2, 7) + ".png", { type: "image/png" }); };
    window.submit = (id) => $(id).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    window.hover = (svg) => { if (!svg) return; const r = svg.getBoundingClientRect(); for (const f of [0.1, 0.3, 0.5, 0.7, 0.95]) for (const el of svg.querySelectorAll("*")) {
      el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: r.left + r.width * f, clientY: r.top + r.height * 0.5 })); }
      for (const el of svg.querySelectorAll("*")) { el.dispatchEvent(new PointerEvent("pointerenter")); el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })); } };
    await wait(() => typeof state !== "undefined" && state.readings.length > 50);
    await sleep(300);
  `);
});

after(async () => {
  if (!B) return;
  const page = readFileSync(join(here, "../www/index.html"), "utf8");
  const start = page.indexOf("<script>" + String.fromCharCode(10) + '"use strict";') + 8, src = page.slice(start, page.indexOf("</script>", start));
  const top = (e) => e.functions.find((f) => f.functionName === "" && f.ranges[0].startOffset <= f.ranges[0].endOffset)?.ranges[0];
  const entries = (await B.takeCoverage()).filter((e) => /index\.html/.test(e.url))
    .filter((e) => { const r = top(e); return r && r.endOffset - r.startOffset === src.length; })
    .map((e) => { const shift = top(e).startOffset;
      return { ...e, functions: e.functions.map((f) => ({ ...f, ranges: f.ranges.map((r) => ({ ...r, startOffset: r.startOffset - shift, endOffset: r.endOffset - shift })) })) }; });
  assert.ok(entries.length, "no coverage entry matches the page script");
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

test("app-style dialogs replace confirm/alert/prompt: title, danger button, Escape, Enter, a queue of dialogs", { skip }, async () => {
  const r = await B.eval(`
    window.dlgManual = true;
    const view = () => ({ open: $("ui-dlg").open, h: $("ui-dlg-h").hidden ? "" : $("ui-dlg-h").textContent, t: [...$("ui-dlg-t").children].map((x) => x.textContent), ok: $("ui-dlg-ok").textContent, danger: $("ui-dlg-ok").classList.contains("danger"), no: !$("ui-dlg-no").hidden, input: !$("ui-dlg-in").hidden });
    const p1 = uiAsk("Удалить всё?" + String.fromCharCode(10) + "Строка один" + String.fromCharCode(10) + "Строка два", { ok: "Удалить", danger: true });
    const p2 = uiSay("Готово.");
    const p3 = uiPrompt("Новое название:", "Дача", { ok: "Сохранить" });
    const p4 = uiAsk("Продолжить?");
    await wait(() => $("ui-dlg").open);
    const a = view();
    $("ui-dlg-ok").click(); const r1 = await p1;
    await wait(() => $("ui-dlg").open && $("ui-dlg-no").hidden);
    const b = view();
    $("ui-dlg-ok").click(); const r2 = await p2;
    await wait(() => $("ui-dlg").open && !$("ui-dlg-in").hidden);
    const c = { ...view(), value: $("ui-dlg-in").value, focus: document.activeElement === $("ui-dlg-in") };
    $("ui-dlg-in").value = "Баня";
    $("ui-dlg-in").form.requestSubmit($("ui-dlg-ok")); const r3 = await p3;
    await wait(() => $("ui-dlg").open);
    const d = view();
    $("ui-dlg").dispatchEvent(new Event("cancel", { cancelable: true })); $("ui-dlg").close(); const r4 = await p4;
    const p5 = uiPrompt("Имя:", null); await wait(() => $("ui-dlg").open);
    const empty = $("ui-dlg-in").value;
    $("ui-dlg-no").click(); const r5 = await p5;
    window.dlgManual = false;
    return { a, r1, b, r2, c, r3, d, r4, empty, r5, closed: !$("ui-dlg").open };`);
  assert.deepEqual(r.a, { open: true, h: "Удалить всё?", t: ["Строка один", "Строка два"], ok: "Удалить", danger: true, no: true, input: false });
  assert.equal(r.r1, true);
  assert.deepEqual(r.b, { open: true, h: "", t: ["Готово."], ok: "ОК", danger: false, no: false, input: false });
  assert.equal(r.r2, undefined);
  assert.deepEqual(r.c, { open: true, h: "", t: ["Новое название:"], ok: "Сохранить", danger: false, no: true, input: true, value: "Дача", focus: true });
  assert.equal(r.r3, "Баня");
  assert.deepEqual(r.d, { open: true, h: "", t: ["Продолжить?"], ok: "ОК", danger: false, no: true, input: false });
  assert.equal(r.r4, false);
  assert.equal(r.empty, "");
  assert.equal(r.r5, null);
  assert.equal(r.closed, true);
});

test("reading editor: the photo zooms with buttons, wheel, double click, pinch and drag; reset on the next photo", { skip }, async () => {
  const r = await B.eval(`
    await uploadFiles([await png(400, 300, "#36c")]); await wait(() => $("editor").open);
    const img = $("ed-img"); await wait(() => img.complete && img.naturalWidth > 0 && img.offsetWidth > 0);
    const st = () => ({ v: $("ed-zoom-v").textContent, z: $("ed-photo").classList.contains("zoomed"), out: $("ed-zoom-out").disabled, in: $("ed-zoom-in").disabled });
    const start = st();
    $("ed-zoom-in").click(); const in1 = st();
    for (let i = 0; i < 8; i++) $("ed-zoom-in").click();
    const max = st();
    $("ed-zoom-out").click(); const out1 = st().v;
    $("ed-zoom-fit").click(); const fit = st();
    const r0 = img.getBoundingClientRect(), cx = r0.left + r0.width * 0.7, cy = r0.top + r0.height * 0.4;
    $("ed-photo").dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    const wheelIn = st().v, moved = img.style.transform;
    $("ed-photo").dispatchEvent(new WheelEvent("wheel", { deltaY: 100, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
    const wheelOut = st();
    img.dispatchEvent(new MouseEvent("dblclick", { clientX: cx, clientY: cy, bubbles: true }));
    const dbl = st().v;
    const ev = (type, id, x, y, pointerType = "mouse") => img.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType, bubbles: true }));
    const before = img.style.transform;
    ev("pointerdown", 1, cx, cy); ev("pointermove", 1, cx - 30, cy - 20); ev("pointerup", 1, cx - 30, cy - 20);
    const panned = img.style.transform !== before;
    ev("pointermove", 9, cx, cy);
    img.dispatchEvent(new MouseEvent("dblclick", { clientX: cx, clientY: cy, bubbles: true }));
    const dblOut = st();
    ev("pointerdown", 2, cx - 20, cy, "touch"); ev("pointerdown", 3, cx + 20, cy, "touch");
    ev("pointermove", 3, cx + 60, cy, "touch");
    const pinched = st().v;
    ev("pointerup", 2, cx - 20, cy, "touch"); ev("pointercancel", 3, cx + 60, cy, "touch");
    $("ed-zoom-fit").click();
    const dlg = $("editor"); dlg.scrollTop = 50; const top0 = dlg.scrollTop;
    ev("pointerdown", 4, cx, cy + 40, "touch"); ev("pointermove", 4, cx, cy, "touch"); ev("pointerup", 4, cx, cy, "touch");
    const scrolled = dlg.scrollTop - top0;
    $("ed-zoom-in").click();
    if (!$("ed-skip").hidden) $("ed-skip").click(); else $("ed-close").click();
    $("manual").click(); await wait(() => $("editor").open);
    const reset = st(); $("ed-close").click();
    return { start, in1, max, out1, fit, wheelIn, moved: !!moved, wheelOut, dbl, panned, dblOut, pinched, scrolled, top0, reset };`);
  assert.deepEqual(r.start, { v: "100%", z: false, out: true, in: false });
  assert.deepEqual(r.in1, { v: "150%", z: true, out: false, in: false });
  assert.deepEqual(r.max, { v: "800%", z: true, out: false, in: true });
  assert.equal(r.out1, "533%");
  assert.deepEqual(r.fit, { v: "100%", z: false, out: true, in: false });
  assert.equal(r.wheelIn, "125%");
  assert.ok(r.moved);
  assert.equal(r.wheelOut.v, "100%");
  assert.equal(r.dbl, "250%");
  assert.ok(r.panned);
  assert.equal(r.dblOut.v, "100%");
  assert.equal(r.pinched, "200%");
  assert.ok(r.top0 === 0 || r.scrolled > 0, JSON.stringify(r));
  assert.deepEqual(r.reset, { v: "100%", z: false, out: true, in: false });
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

test("supplier form: phone mask, e-mail and Telegram formats, separate WhatsApp, min. order and delivery, comment, logo, old messenger field", { skip }, async () => {
  const r = await B.eval(`
    const type = (el, text) => { el.value = ""; for (const ch of text) { el.value += ch; el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: ch, bubbles: true })); } return el.value; };
    const typed = { ru: type($("sp-phone"), "89001234567"), plus: type($("sp-phone"), "+79001234567"), nine: type($("sp-phone"), "900123"), intl: type($("sp-phone"), "+375291234567"), empty: type($("sp-phone"), "+") };
    $("sp-phone").value = "+7 900 123-45-6"; $("sp-phone").dispatchEvent(new InputEvent("input", { inputType: "deleteContentBackward", bubbles: true }));
    const del = $("sp-phone").value;
    $("sp-phone").value = "8 (900) 123 45 67"; $("sp-phone").dispatchEvent(new Event("blur"));
    const blur = $("sp-phone").value;
    $("sp-phone").value = "12345"; $("sp-phone").dispatchEvent(new Event("blur"));
    const short = $("sp-phone").value;
    $("sp-telegram").value = "https://t.me/gas_srv"; $("sp-telegram").dispatchEvent(new Event("blur")); const tg1 = $("sp-telegram").value;
    $("sp-telegram").value = "gas_srv"; $("sp-telegram").dispatchEvent(new Event("blur")); const tg2 = $("sp-telegram").value;
    fillSupplier(null);
    const set = (v) => { for (const [k, x] of Object.entries(v)) $("sp-" + k).value = x; };
    set({ short: "Логотип", phone: "89001112233", email: "bad@", telegram: "gas_srv", whatsapp: "9001112233", minOrder: "1500", deliveryDays: "1-2", note: "оплата картой" });
    submit("sp-form"); await wait(() => $("sp-err").textContent);
    const mailErr = $("sp-err").textContent;
    $("sp-email").value = "info@logo.ru";
    const pic = await png(400, 200, "#2a7", "logo.png");
    const dt = new DataTransfer(); dt.items.add(pic); $("sp-logo-file").files = dt.files; $("sp-logo-file").dispatchEvent(new Event("change"));
    await wait(() => !$("sp-logo-img").hidden);
    const logo = { src: $("sp-logo").value.slice(0, 22), del: !$("sp-logo-del").hidden };
    const im = new Image(); im.src = $("sp-logo").value; await im.decode(); const size = im.naturalWidth + "x" + im.naturalHeight;
    const bad = new DataTransfer(); bad.items.add(new File(["not an image"], "x.png", { type: "image/png" })); $("sp-logo-file").files = bad.files; $("sp-logo-file").dispatchEvent(new Event("change"));
    await wait(() => /картинку/.test($("sp-err").textContent)); const badLogo = $("sp-err").textContent;
    $("sp-logo-file").dispatchEvent(new Event("change"));
    submit("sp-form"); await wait(() => state.suppliers.some((s) => s.short === "Логотип"));
    const saved = state.suppliers.find((s) => s.short === "Логотип");
    const row = [...$("sp-rows").querySelectorAll("tr")].find((tr) => tr.textContent.includes("Логотип"));
    const table = { img: !!row.querySelector("img.sp-ava"), text: row.querySelector(".note").textContent.replace(/[\\u00a0\\u202f]/g, " "), links: [...row.querySelectorAll("a")].map((a) => a.getAttribute("href")) };
    $("sp-rows").querySelector('[data-sp-edit="' + saved.id + '"]').click(); await sleep(50);
    const edit = { logo: !$("sp-logo-img").hidden };
    $("sp-logo-del").click(); const removed = $("sp-logo-img").hidden && $("sp-logo").value === "";
    submit("sp-form"); await wait(() => state.suppliers.find((s) => s.id === saved.id).logo === "");
    const old = [];
    for (const [short, messenger] of [["Старый-ТГ", "@old_tg"], ["Старый-ВА", "+7 (901) 222-33-44"], ["Старый-текст", "по звонку"]]) {
      await api("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ short, messenger, note: "заметка" }) });
      state = await api("/api/data"); render();
      fillSupplier(state.suppliers.find((s) => s.short === short));
      old.push([$("sp-telegram").value, $("sp-whatsapp").value, $("sp-note").value, $("sp-messenger").value].join("|"));
      submit("sp-form"); await wait(() => state.suppliers.find((s) => s.short === short).messenger === "");
    }
    for (const s of state.suppliers.filter((x) => /Логотип|Старый/.test(x.short))) await api("/api/suppliers?id=" + s.id, { method: "DELETE" });
    state = await api("/api/data"); fillSupplier(null); render();
    return { typed, del, blur, short, tg1, tg2, mailErr, logo, size, badLogo, saved: { phone: saved.phone, whatsapp: saved.whatsapp, telegram: saved.telegram, minOrder: saved.minOrder, deliveryDays: saved.deliveryDays, note: saved.note, logo: saved.logo.slice(0, 15) }, table, edit, removed, old };`);
  assert.deepEqual(r.typed, { ru: "+7 900 123-45-67", plus: "+7 900 123-45-67", nine: "+7 900 123", intl: "+375291234567", empty: "+" });
  assert.equal(r.del, "+7 900 123-45-6");
  assert.equal(r.blur, "+7 900 123-45-67");
  assert.equal(r.short, "12345");
  assert.equal(r.tg1, "@gas_srv");
  assert.equal(r.tg2, "@gas_srv");
  assert.match(r.mailErr, /e-mail/);
  assert.deepEqual(r.logo, { src: "data:image/webp;base64", del: true });
  assert.equal(r.size, "128x64");
  assert.match(r.badLogo, /Не удалось открыть картинку/);
  assert.deepEqual(r.saved, { phone: "+7 900 111-22-33", whatsapp: "+7 900 111-22-33", telegram: "@gas_srv", minOrder: "1500", deliveryDays: "1-2", note: "оплата картой", logo: "data:image/webp" });
  assert.equal(r.table.img, true);
  assert.equal(r.table.text, "мин. заказ 1 500 л; доставка 1-2 дн.; оплата картой");
  assert.ok(r.table.links.includes("https://t.me/gas_srv") && r.table.links.includes("https://wa.me/79001112233"));
  assert.deepEqual(r.edit, { logo: true });
  assert.equal(r.removed, true);
  assert.deepEqual(r.old, ["@old_tg||заметка|", "|+7 901 222-33-44|заметка|", "||заметка; по звонку|"]);
});

test("passport: organisations are picked from the suppliers; the service one can be the same as the installer", { skip }, async () => {
  const r = await B.eval(`
    const put = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await put("/api/suppliers", { id: "o1", short: "Монтаж-Газ", full: "ООО «Монтаж-Газ»", phone: "+7 900 111-22-33" });
    await put("/api/suppliers", { id: "o2", short: "Сервис-Пропан" });
    state = await api("/api/data"); renderPassport(); render();
    const inp = (k) => document.querySelector('#pp-params input[data-key="' + k + '"]');
    const box = (k) => document.querySelector('#pp-params [data-orgs="' + k + '"]');
    const M = "Монтажная организация", S = "Обслуживание, контакты";
    const chips = [...box(M).querySelectorAll("[data-pp-org]")].map((b) => b.textContent);
    box(M).querySelector('[data-pp-org="o1"]').click();
    const mount = { v: inp(M).value, on: box(M).querySelector(".on")?.dataset.ppOrg };
    box(S).querySelector('[data-pp-org="o1"]').click();
    const svc = inp(S).value;
    box(S).querySelector('[data-pp-org="o2"]').click();
    const svc2 = inp(S).value;
    const same = box(S).querySelector("[data-pp-same]"); same.checked = true; same.dispatchEvent(new Event("change", { bubbles: true }));
    const linked = { v: inp(S).value, ro: inp(S).readOnly, chips: box(S).querySelectorAll("[data-pp-org]").length };
    inp(M).value = "Монтаж-Газ, бригада 2"; inp(M).dispatchEvent(new Event("input", { bubbles: true }));
    const follows = inp(S).value;
    $("pp-form").requestSubmit(); await wait(() => state.passport.params.some((p) => p.k === S && p.v === "Монтаж-Газ, бригада 2"));
    const saved = state.passport.params.filter((p) => p.k === M || p.k === S).map((p) => p.v);
    renderPassport();
    const after = { same: box(S).querySelector("[data-pp-same]").checked, ro: inp(S).readOnly };
    const s2 = box(S).querySelector("[data-pp-same]"); s2.checked = false; s2.dispatchEvent(new Event("change", { bubbles: true }));
    const unlinked = { v: inp(S).value, ro: inp(S).readOnly, chips: box(S).querySelectorAll("[data-pp-org]").length };
    inp(S).value = "Другая"; inp(S).dispatchEvent(new Event("input", { bubbles: true }));
    $("pp-form").requestSubmit(); await wait(() => state.passport.params.some((p) => p.k === S && p.v === "Другая"));
    for (const id of ["o1", "o2"]) await api("/api/suppliers?id=" + id, { method: "DELETE" });
    state = await api("/api/data"); render();
    const none = box(M).textContent;
    return { chips, mount, svc, svc2, linked, follows, saved, after, unlinked, none };`);
  assert.ok(r.chips.includes("Монтаж-Газ") && r.chips.includes("Сервис-Пропан"));
  assert.deepEqual(r.mount, { v: "Монтаж-Газ", on: "o1" });
  assert.equal(r.svc, "Монтаж-Газ, +7 900 111-22-33");
  assert.equal(r.svc2, "Сервис-Пропан");
  assert.deepEqual(r.linked, { v: "Монтаж-Газ", ro: true, chips: 0 });
  assert.equal(r.follows, "Монтаж-Газ, бригада 2");
  assert.deepEqual(r.saved, ["Монтаж-Газ, бригада 2", "Монтаж-Газ, бригада 2"]);
  assert.deepEqual(r.after, { same: true, ro: true });
  assert.equal(r.unlinked.v, "");
  assert.equal(r.unlinked.ro, false);
  assert.ok(r.unlinked.chips >= 2);
  assert.equal(r.none.includes("Монтаж-Газ"), false);
});

test("tanks: create, switch, rename, delete; fold and unfold panels", { skip }, async () => {
  const r = await B.eval(`
    prompts.push("Дача", "1000", "150", "15", "10", "90", "500", "7", "сто", "6 мес"); $("pf-new").click(); await wait(() => curProfile().name === "Дача" && state.settings.volume === 1000);
    const made = [state.settings.minPct, state.settings.maxPct, state.settings.minDelivery, state.settings.leadDays, JSON.stringify(state.settings.servicePeriod), prompts.length].join("|");
    const empty = $("sub").textContent + $("t-now").textContent;
    prompts.push("Дача у реки"); $("pf-ren").click(); await wait(() => curProfile().name === "Дача у реки");
    prompts.push("", null); $("pf-new").click(); await sleep(100);
    prompts.push("X", "abc"); $("pf-new").click(); await sleep(100);
    for (let k = 2; k < 7; k++) { prompts.length = 0; prompts.push(...["X", "100", "20", "85", "50", "3"].slice(0, k)); $("pf-new").click(); await sleep(150); }
    const n1 = profiles.length;
    prompts.length = 0; prompts.push("Без ТО", "100", "20", "85", "50", "3", ""); $("pf-new").click(); await wait(() => curProfile().name === "Без ТО");
    const noSvc = JSON.stringify(state.settings.servicePeriod) + "|" + (profiles.length - n1);
    $("pf-del").click(); await wait(() => !profiles.some((p) => p.name === "Без ТО"));
    $("pf-sel").value = profiles.find((p) => p.name === "Дача у реки").id; $("pf-sel").dispatchEvent(new Event("change")); await wait(() => curProfile().name === "Дача у реки");
    $("pf-del").click(); await wait(() => curProfile().id === "default");
    $("pf-sel").value = "default"; $("pf-sel").dispatchEvent(new Event("change")); await sleep(200);
    await clickAll(".fold"); await clickAll(".fold");
    document.querySelector('[data-fold-all="1"]').click(); await sleep(50);
    for (const h of document.querySelectorAll(".fold-title h2")) { h.click(); await sleep(10); }
    document.querySelector('[data-fold-all="0"]').click(); await sleep(50);
    return { made, noSvc, empty, profiles: profiles.length, folded: document.querySelectorAll(".panel.folded").length };`);
  assert.equal(r.made, '15|90|500|7|{"n":6,"unit":"month"}|0');
  assert.equal(r.noSvc, "null|1");
  assert.ok(r.empty.length > 0);
  assert.equal(r.profiles, 1);
  assert.equal(r.folded, 0);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("tanks: import archive as a new tank or over the current one", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch, calls = []; window.alerts = [];
    window.alert = (m) => alerts.push(String(m));
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
    window.gasFetch = async (url, opts = {}) => {
      if (!url.startsWith("/api/import")) return real(url, opts);
      calls.push(url);
      if (/name=bad/.test(url)) return json({ error: "Это не архив .zip" }, 400);
      const rep = new URL(url, location.href).searchParams.get("replace");
      if (rep) return json({ id: rep, name: curProfile().name, files: 3, readings: 2, refuels: 1, backup: "profiles/.deleted/x" });
      const p = await (await real("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "С телефона", volume: 4600 }) })).json();
      return json({ ...p, files: 5, readings: 96, refuels: 9, main: /phone/.test(url) });
    };
    const pick = async (name, choice) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([80, 75, 3, 4])], name, { type: "application/zip" }));
      $("pf-imp-file").files = dt.files; $("pf-imp-file").dispatchEvent(new Event("change"));
      await wait(() => $("imp-dlg").open);
      const shown = $("imp-file").textContent + " " + $("imp-cur").textContent;
      $("imp-dlg").close(choice); await sleep(60);
      await wait(() => !$("pf-imp").disabled);
      return shown;
    };
    const hidden = $("pf-imp").hidden;
    $("pf-imp").click();
    $("pf-imp-file").dispatchEvent(new Event("change"));
    const shown = await pick("cancel.zip", "cancel");
    const afterCancel = calls.length;
    let asked = "";
    window.confirm = (m) => { asked = String(m); return false; };
    await pick("gazgolder-phone.zip", "new"); await wait(() => curProfile().name === "С телефона"); await wait(() => asked);
    window.confirm = () => true;
    const added = alerts.at(-1), newId = curProfile().id;
    window.confirm = () => false; await pick("no.zip", "replace"); window.confirm = () => true;
    const afterNo = calls.length;
    await pick("over.zip", "replace"); await wait(() => /заменены/.test(alerts.at(-1)));
    const replaced = alerts.at(-1), repUrl = calls.at(-1);
    await pick("bad.zip", "new"); await wait(() => /не архив/.test(alerts.at(-1)));
    const label = $("pf-imp").textContent;
    $("pf-del").click(); await wait(() => curProfile().id === "default");
    window.gasFetch = real;
    return { asked, hidden, shown, afterCancel, added, afterNo, replaced, repOk: repUrl.includes("replace=" + newId), bad: alerts.at(-1), label, profiles: profiles.length };`);
  assert.match(r.asked, /^Сделать «С телефона» основной ёмкостью\?/);
  assert.equal(r.hidden, true);
  assert.equal(r.shown, "cancel.zip «Основной»");
  assert.equal(r.afterCancel, 0);
  assert.equal(r.added, "Добавлена ёмкость «С телефона»: показаний 96, заправок 9, файлов 5.");
  assert.equal(r.afterNo, 1);
  assert.match(r.replaced, /^Данные ёмкости «С телефона» заменены: показаний 2, заправок 1, файлов 3\.\nПрежние файлы — в папке profiles\/\.deleted\/x\.$/);
  assert.equal(r.repOk, true);
  assert.equal(r.bad, "Это не архив .zip");
  assert.equal(r.label, "импорт архива");
  assert.equal(r.profiles, 1);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("server errors are shown next to the action and nothing changes", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch; window.alerts = []; window.alert = (m) => alerts.push(String(m));
    let fail = null;
    window.gasFetch = async (url, opts = {}) => {
      if (fail && url.startsWith(fail)) { fail = null; return new Response(JSON.stringify({ error: "сбой сервера" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
      return real(url, opts);
    };
    const n0 = { profiles: profiles.length, readings: state.readings.length, refuels: state.refuels.length, photos: state.passport.photos.length };
    prompts.length = 0; fail = "/api/profiles"; prompts.push("Склад", "500", "20", "85", "500", "14", "1 год"); $("pf-new").click(); await wait(() => alerts.length === 1);
    prompts.push("Дом"); fail = "/api/profiles"; $("pf-ren").click(); await wait(() => alerts.length === 2);
    fail = "/api/settings"; $("m-thr").value = "5"; $("m-thr").dispatchEvent(new Event("change")); await wait(() => alerts.length === 3);
    $("m-thr").value = "";
    const armed = async (sel, re) => { const b = document.querySelector(sel); b.click(); await sleep(20); fail = re; b.click(); await wait(() => /сбой/.test(b.textContent)); return b.textContent; };
    const rd = await armed("[data-del]", "/api/readings");
    const rf = await armed("[data-rf-del]", "/api/refuels");
    const pp = await armed("[data-pp-del]", "/api/passport/photo");
    const cap = document.querySelector("[data-pp-cap]"); cap.value = "Шильдик"; fail = "/api/passport";
    cap.dispatchEvent(new Event("change", { bubbles: true })); await wait(() => alerts.length === 4);
    $("pp-add").click(); await sleep(30);
    const before = $("pp-params").querySelectorAll("[data-pk]").length;
    document.querySelector("[data-pp-rm]").click(); await sleep(30);
    const removed = before - $("pp-params").querySelectorAll("[data-pk]").length;
    fail = "/api/passport"; submit("pp-form"); await wait(() => /сбой/.test($("pp-status").textContent));
    const ppForm = $("pp-status").textContent;
    const pdt = new DataTransfer(); pdt.items.add(await png(20, 20, "#0a0", "plate.png"));
    fail = "/api/passport/photo"; $("pp-file").files = pdt.files; $("pp-file").dispatchEvent(new Event("change"));
    await wait(() => /сбой/.test($("pp-drop-note").textContent));
    const upload = $("pp-drop-note").textContent;
    await sleep(1600);
    prompts.push("Склад", "500", "20", "85", "500", "14", "1 год"); $("pf-new").click(); await wait(() => curProfile().name === "Склад");
    fail = "/api/profiles"; $("pf-del").click(); await wait(() => alerts.length === 5);
    const kept = curProfile().name;
    $("pf-del").click(); await wait(() => curProfile().id === "default");
    fail = "/api/data"; $("pf-sel").dispatchEvent(new Event("change")); await wait(() => /Не удалось загрузить/.test($("sub").textContent));
    const sub = $("sub").textContent;
    window.gasFetch = real; $("pf-sel").dispatchEvent(new Event("change")); await wait(() => state.readings.length === n0.readings);
    return { alerts, rd, rf, pp, removed, ppForm, upload, kept, sub, name: curProfile().name,
      same: profiles.length === n0.profiles && state.refuels.length === n0.refuels && state.passport.photos.length === n0.photos };`);
  assert.deepEqual(r.alerts, Array(5).fill("сбой сервера"));
  assert.equal(r.ppForm, "сбой сервера");
  assert.equal(r.upload, "plate.png: сбой сервера");
  assert.equal(r.kept, "Склад");
  assert.deepEqual([r.rd, r.rf, r.pp], ["сбой сервера", "сбой сервера", "сбой сервера"]);
  assert.equal(r.removed, 1);
  assert.equal(r.sub, "Не удалось загрузить данные: сбой сервера");
  assert.equal(r.name, "Основной");
  assert.equal(r.same, true);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("a refill seen on photos without a refuel record offers to fill the refuel form", { skip }, async () => {
  const r = await B.eval(`
    const last = state.readings.filter((x) => x.level != null).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).at(-1);
    const d = new Date(Date.parse(last.date + "T12:00:00") + 86400000).toISOString().slice(0, 10);
    const saved = await api("/api/readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: d, time: "12:00", level: Math.min(100, last.level + 40), note: "" }) });
    state.readings.push(saved); render(); await sleep(100);
    const btn = document.querySelector("[data-rf-fill]"); btn.click(); await sleep(100);
    const form = { date: $("rf-date").value, liters: $("rf-liters").value, focused: document.activeElement === $("rf-liters") };
    await api("/api/readings?id=" + encodeURIComponent(saved.id), { method: "DELETE" });
    state.readings = state.readings.filter((x) => x.id !== saved.id); fillRefuel(null); render();
    return { d, form, hints: !!btn };`);
  assert.equal(r.hints, true);
  assert.equal(r.form.date, r.d);
  assert.ok(+r.form.liters > 0, JSON.stringify(r));
  assert.equal(r.form.focused, true);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("reading editor: delete with confirmation, server error; photo names get an extension from the file type or contents", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch;
    const n0 = state.readings.length;
    const row = await api("/api/readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-01-02", time: "07:00", level: 33 }) });
    state.readings.push(row); render();
    openEditor({ file: "", existing: row, date: row.date, time: row.time });
    const shown = !$("ed-del").hidden;
    $("ed-del").click();
    const armed = $("ed-del").textContent;
    window.gasFetch = async (url, o) => url.startsWith("/api/readings?id=") ? new Response(JSON.stringify({ error: "сбой сервера" }), { status: 500 }) : real(url, o);
    $("ed-del").click(); await wait(() => $("ed-err").textContent);
    const err = $("ed-err").textContent;
    window.gasFetch = real;
    $("ed-del").click(); await wait(() => !$("editor").open);
    const removed = state.readings.length === n0 && !state.readings.some((x) => x.id === row.id);
    openEditor({ file: "", date: "2026-01-03", time: "08:00" });
    const hiddenForNew = $("ed-del").hidden;
    current = null; $("ed-del").click(); $("ed-close").click();
    const jpg = new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2])], "1000012347", { type: "" });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2])], "", { type: "" });
    const typed = new File([new Uint8Array([1])], "photo.heic", { type: "image/jpeg" });
    const other = new File([new Uint8Array([1, 2, 3, 4])], "x.bin", { type: "" });
    return { shown, armed, err, removed, hiddenForNew, names: [await photoName(jpg), await photoName(png), await photoName(typed), await photoName(other), await photoName(new File([1], "a.JPG"))] };`);
  assert.equal(r.shown, true);
  assert.equal(r.armed, "Точно удалить?");
  assert.equal(r.err, "сбой сервера");
  assert.equal(r.removed, true);
  assert.equal(r.hiddenForNew, true);
  assert.deepEqual(r.names, ["1000012347.jpg", "photo.png", "photo.jpg", "x.bin", "a.JPG"]);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("bulk delete: checkboxes, Shift range, select all, clear, cancel, partial failure, readings and refuels", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch;
    const post = (p, b) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const n0 = { rd: state.readings.length, rf: state.refuels.length };
    const mine = [];
    for (let d = 1; d <= 5; d++) mine.push(await post("/api/readings", { date: "2030-01-0" + d, time: "09:00", level: 50 - d, note: "bulk" }));
    const rfs = [await post("/api/refuels", { id: "bulk1", date: "2030-01-01", liters: 100, price: 40 }), await post("/api/refuels", { id: "bulk2", date: "2030-01-02", liters: 100, price: 40 })];
    state = await api("/api/data"); render(); await sleep(50);
    const box = (kind, id) => document.querySelector('[data-bulk="' + kind + '"][value="' + id + '"]');
    const click = (el, shift) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: !!shift }));
    const hidden0 = $("rd-bulk").hidden;
    box("rd", mine[4].id).click();
    click(box("rd", mine[1].id), true);
    const range = { n: picked.rd.size, bar: $("rd-bulk").textContent, rows: document.querySelectorAll("#rows tr.picked").length, ind: document.querySelector('[data-bulk-all="rd"]').indeterminate };
    box("rd", mine[2].id).click();
    const unpicked = picked.rd.has(mine[2].id);
    document.querySelector('[data-bulk-clear="rd"]').click();
    const cleared = { n: picked.rd.size, hidden: $("rd-bulk").hidden };
    document.querySelector('[data-bulk-all="rd"]').click();
    const all = picked.rd.size === state.readings.length && document.querySelector('[data-bulk-all="rd"]').checked;
    document.querySelector('[data-bulk-all="rd"]').click();
    for (const x of mine) box("rd", x.id).click();
    window.confirm = () => false; document.querySelector('[data-bulk-del="rd"]').click(); await sleep(100);
    const afterCancel = state.readings.length;
    window.confirm = () => true;
    let n = 0;
    window.gasFetch = async (url, o) => (url.startsWith("/api/readings?id=") && ++n === 2 ? new Response(JSON.stringify({ error: "сбой сервера" }), { status: 500 }) : real(url, o));
    document.querySelector('[data-bulk-del="rd"]').click();
    await wait(() => /Не удалось удалить/.test($("rd-bulk").textContent));
    const partial = { left: picked.rd.size, err: $("rd-bulk").querySelector(".err").textContent, count: state.readings.length };
    window.gasFetch = real;
    document.querySelector('[data-bulk-del="rd"]').click();
    await wait(() => $("rd-bulk").hidden);
    box("rf", "bulk1").click(); box("rf", "bulk2").click();
    const rfBar = $("rf-bulk").textContent;
    document.querySelector('[data-bulk-del="rf"]').click();
    await wait(() => state.refuels.length === n0.rf);
    return { hidden0, range, unpicked, cleared, all, afterCancel, partial, rfBar,
      rd: state.readings.length === n0.rd && !mine.some((x) => state.readings.some((y) => y.id === x.id)), rf: !state.refuels.some((x) => x.id.startsWith("bulk")), hiddenEnd: $("rd-bulk").hidden && $("rf-bulk").hidden };`);
  assert.equal(r.hidden0, true);
  assert.equal(r.range.n, 4);
  assert.equal(r.range.rows, 4);
  assert.equal(r.range.ind, true);
  assert.match(r.range.bar, /Выбрано показаний: 4/);
  assert.equal(r.unpicked, false);
  assert.deepEqual(r.cleared, { n: 0, hidden: true });
  assert.equal(r.all, true);
  assert.equal(r.afterCancel > 0, true);
  assert.equal(r.partial.left, 1);
  assert.equal(r.partial.err, "Не удалось удалить: 1 из 5 — сбой сервера");
  assert.match(r.rfBar, /Выбрано заправок: 2/);
  assert.equal(r.rd, true);
  assert.equal(r.rf, true);
  assert.equal(r.hiddenEnd, true);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("desktop: «сделать основной» swaps the current tank with the main one; declined and failed attempts change nothing", { skip }, async () => {
  const r = await B.eval(`
    const real = window.gasFetch; window.alerts = []; window.alert = (m) => alerts.push(String(m));
    const n0 = state.readings.length;
    prompts.length = 0; prompts.push("Дача", "2700", "20", "85", "1000", "14", "1 год"); $("pf-new").click(); await wait(() => curProfile().name === "Дача");
    const id = curProfile().id;
    await api("/api/readings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-01-05", time: "10:00", level: 64, note: "дача" }) });
    const shown = !$("pf-main").hidden;
    window.confirm = () => false; $("pf-main").click(); await sleep(100);
    const declined = view.profile === id;
    window.confirm = () => true;
    window.gasFetch = async (url, o) => (url.startsWith("/api/profiles/main") ? new Response(JSON.stringify({ error: "сбой сервера" }), { status: 500 }) : real(url, o));
    $("pf-main").click(); await wait(() => alerts.length === 1);
    window.gasFetch = real;
    $("pf-main").click(); await wait(() => view.profile === "default" && state.readings.length === 1);
    const swapped = { names: profiles.map((p) => p.name).join("|"), hidden: $("pf-main").hidden && $("pf-del").hidden, title: document.title, sel: $("pf-sel").selectedOptions[0].textContent };
    await makeMain(id);
    await switchProfile(id); $("pf-del").click(); await wait(() => view.profile === "default" && profiles.length === 1);
    return { shown, declined, alerts, swapped, restored: profiles[0].name === "Основной" && state.readings.length === n0, noop: await makeMain("default") };`);
  assert.equal(r.shown, true);
  assert.equal(r.declined, true);
  assert.deepEqual(r.alerts, ["сбой сервера"]);
  assert.deepEqual(r.swapped, { names: "Дача|Основной", hidden: true, title: "Газгольдер — Дача", sel: "Дача" });
  assert.equal(r.restored, true);
  assert.equal(r.noop, false);
  assert.deepEqual(B.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test("passport: fields renamed with units keep the old values and save them under the new names", { skip }, async () => {
  const r = await B.eval(`
    const put = (params) => api("/api/passport", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
    const old = state.passport.params;
    state.passport = await put([{ k: "Масса", v: "950" }, { k: "Год изготовления", v: "2019" }, { k: "Рабочее давление", v: "1,6" }, { k: "Масса, кг", v: "" }, { k: "Своё", v: "x" }]);
    renderPassport();
    const shown = ["Масса, кг", "Год выпуска", "Рабочее давление, МПа", "Расчётное давление, МПа"].map((k) => $("pp-params").querySelector('input[data-key="' + k + '"]').value);
    const custom = [...$("pp-params").querySelectorAll("input[data-pk]")].map((x) => x.value);
    const first = [...$("pp-params").querySelectorAll(".k")].slice(0, 6).map((x) => x.textContent).join("|");
    submit("pp-form"); await wait(() => /Сохранено/.test($("pp-status").textContent));
    const saved = state.passport.params.map((p) => p.k + "=" + p.v).join(",");
    state.passport = await put(old); renderPassport();
    return { shown, custom, first, saved };`);
  assert.deepEqual(r.shown, ["950", "2019", "1,6", ""]);
  assert.deepEqual(r.custom, ["Своё"]);
  assert.equal(r.first, "Производитель|Заводской номер|Рабочее давление, МПа|Расчётное давление, МПа|Масса, кг|Год выпуска");
  assert.equal(r.saved, "Рабочее давление, МПа=1,6,Масса, кг=950,Год выпуска=2019,Своё=x");
});
