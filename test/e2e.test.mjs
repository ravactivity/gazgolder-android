import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, launch, serve } from "../scripts/cdp.mjs";
import { demoFiles } from "../scripts/demo-data.mjs";

const skip = !findChrome() || typeof WebSocket === "undefined" ? "needs Chrome or Edge (set CHROME_PATH)" : false;
let srv, B;

before(async () => {
  if (skip) return;
  srv = await serve({ demo: await demoFiles() });
  B = await launch();
});
after(async () => { if (B) await B.close(); if (srv) srv.close(); });

const loaded = (extra = "") => B.eval(`
  for (let i = 0; i < 100; i++) { if (typeof state !== "undefined" && state.readings && state.readings.length && document.getElementById("m-sum").textContent) break; await new Promise((r) => setTimeout(r, 100)); }
  ${extra}`);
const open = async (q) => { await B.goto(`${srv.url}/index.html?${q}`); await loaded(); B.errors.length = 0; };

test("Russian UI with demo data: the App panel and its settings", { skip }, async () => {
  await B.goto(`${srv.url}/index.html?lang=ru&demo`);
  const r = await loaded(`
    const $ = (id) => document.getElementById(id);
    const panel = document.querySelector('section[data-panel="phone"]');
    return {
      cards: [...panel.querySelectorAll(".m-card h3")].map((h) => h.textContent),
      sum: $("m-sum").textContent,
      syncDisabled: $("m-sync").disabled,
      onlyApp: panel.textContent.includes("только в приложении"),
      archDisabled: $("m-arch").disabled,
      photoDays: $("m-photo-days").value, repeat: $("m-repeat-days").value,
      smp: $("m-smp-st").textContent, dyn: $("m-dyn-row").hidden,
      receipt: !!$("m-rf-receipt"), camera: !!$("m-camera"),
      readings: state.readings.length, refuels: state.refuels.length,
      demoWarn: !!document.querySelector(".m-demo"),
    };`);
  assert.deepEqual(r.cards, ["Язык и тема", "Напоминания", "Поделиться и перенести", "Google Диск", "Совместный доступ", "Архив в папку", "Распознавание", "Резервная копия", "Виджет"]);
  assert.match(r.sum, /^Основной: \d+%$/);
  assert.equal(r.syncDisabled, true);
  assert.equal(r.onlyApp, true);
  assert.equal(r.archDisabled, true);
  assert.equal(r.photoDays, "14");
  assert.equal(r.repeat, "3");
  assert.equal(r.smp, "Проверок пока нет.");
  assert.equal(r.dyn, true);
  assert.equal(r.receipt, false);
  assert.equal(r.camera, true);
  assert.ok(r.readings > 50 && r.refuels > 2, JSON.stringify(r));
  assert.equal(r.demoWarn, true);
  assert.deepEqual(B.errors, []);
});

test("settings are kept, the theme switches, tank switching updates the summary", { skip }, async () => {
  await open("lang=ru&demo");
  const r = await B.eval(`
    const $ = (id) => document.getElementById(id);
    $("m-repeat-days").value = "5"; $("m-repeat-days").dispatchEvent(new Event("change"));
    $("m-photo-days").value = "500"; $("m-photo-days").dispatchEvent(new Event("change"));
    $("m-autorecog").checked = false; $("m-autorecog").dispatchEvent(new Event("change"));
    document.querySelector('[data-theme-set="dark"]').click();
    const saved = JSON.parse(localStorage.getItem("gas-mobile"));
    const theme = document.documentElement.dataset.theme;
    document.querySelector('[data-theme-set="system"]').click();
    return { saved, theme, after: document.documentElement.dataset.theme || "", photo: $("m-photo-days").value };`);
  assert.equal(r.saved.repeatDays, 5);
  assert.equal(r.saved.photoDays, 14);
  assert.equal(r.photo, "14");
  assert.equal(r.saved.autoRecog, false);
  assert.equal(r.theme, "dark");
  assert.equal(r.after, "");
  assert.deepEqual(B.errors, []);
});

test("English UI: no Cyrillic left outside user data", { skip }, async () => {
  await open("lang=en&demo");
  const r = await B.eval(`
    const panel = document.querySelector('section[data-panel="phone"]');
    const walk = (root) => { const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) {
      const p = n.parentElement; if (!p || p.closest(".note, [data-noi18n], script, style, #ed-file, #pf-sel, textarea, .pp-v, td")) continue;
      if (/[А-Яа-яЁё]/.test(n.nodeValue)) out.push(n.nodeValue.trim()); } return out; };
    return { app: walk(panel), headings: [...document.querySelectorAll("h2, h3, button, label .label")].map((e) => e.textContent).filter((s) => /[А-Яа-яЁё]/.test(s)), sum: document.getElementById("m-sum").textContent };`);
  assert.deepEqual(r.app, []);
  assert.deepEqual(r.headings.filter((s) => !/Русский/.test(s)), []);
  assert.match(r.sum, /^Main: \d+%$/);
  assert.deepEqual(B.errors, []);
});

test("first launch asks for the language and theme", { skip }, async () => {
  await B.goto(`${srv.url}/index.html?demo`);
  await B.eval("localStorage.clear();");
  await B.goto(`${srv.url}/index.html?demo`);
  const r = await loaded(`
    await new Promise((r) => setTimeout(r, 300));
    const d = document.getElementById("m-welcome");
    const was = d && d.open;
    document.querySelector('#m-welcome [data-lang-set="ru"]').click();
    document.getElementById("m-welcome-ok").click();
    return { was, now: d.open, lang: localStorage.getItem("gas-lang") };`);
  assert.equal(r.was, true);
  assert.equal(r.now, false);
  assert.equal(r.lang, "ru");
});

test("helper modules are loaded on the page", { skip }, async () => {
  await open("lang=ru&demo");
  const r = await B.eval(`return { link: gasLink.parse("gazgolder://refuel"), rem: typeof gasReminders.plan, rc: gasReceipt.parseReceipt(["100 л x 40", "4000"]).total, smp: typeof gasSamples.createStore, sync: typeof gasSync.createSync };`);
  assert.deepEqual(r, { link: "refuel", rem: "function", rc: 4000, smp: "function", sync: "function" });
});
