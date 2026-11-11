import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/home.js");
const H = globalThis.gasHome;
const DAY = 864e5;
const T = (s) => Date.parse(s);

test("plural forms of Russian numerals", () => {
  const f = (n) => H.plural(n, "день", "дня", "дней");
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 101, 0].map(f), ["день", "дня", "дня", "дней", "дней", "дней", "дней", "день", "дня", "дней", "дней", "день", "дней"]);
});

test("status: fine, order window, low and unknown", () => {
  const base = { open: T("2026-11-24"), latest: T("2026-12-21"), hit: T("2027-01-04") };
  assert.equal(H.status({ ...base, now: T("2026-11-11") }), "ok");
  assert.equal(H.status({ ...base, now: T("2026-12-01") }), "order");
  assert.equal(H.status({ ...base, now: T("2026-12-25") }), "low");
  assert.equal(H.status({ ...base, now: T("2027-01-05") }), "low");
  assert.equal(H.status({ now: 0, hit: null }), "none");
  assert.equal(H.status({ now: T("2026-12-01"), hit: T("2027-01-04") }), "ok");
});

test("summary: level, days left, consumption per period, order and last supplier", () => {
  const suppliers = [{ id: "gs", short: "Газ-Сервис" }, { id: "pl", short: "ПропанЛайн" }];
  const refuels = [
    { id: "r1", date: "2025-12-05", liters: 2900, price: 38.93, supplier: "gs" },
    { id: "r2", date: "2026-03-30", liters: 2900, price: 37.64, supplier: "gs" },
    { id: "r3", date: "2026-03-30", liters: 10, price: 50, supplier: "pl" },
    { id: "r4", date: "2026-06-01", liters: 10, price: 50, supplier: "gone" },
    { id: "r5", date: "2026-07-01", liters: 10, price: 50 },
  ];
  const now = T("2026-11-11T10:00:00");
  const args = { now, volume: 4600, nowLevel: 47.2, lastT: T("2026-11-02T10:23:00"), rateNow: 19.5, avgRate: 13.6, hit: now + 54.3 * DAY, open: now + 13 * DAY, latest: now + 40 * DAY,
    best: { t: now + 40 * DAY, liters: 2632, cost: 105040 }, refuels, suppliers };
  const s = H.summary(args);
  assert.equal(Math.round(s.liters), 2171);
  assert.equal(s.status, "ok");
  assert.equal(s.daysLeft, 54);
  assert.equal(s.agoDays, 9);
  assert.equal(s.period, "month");
  assert.equal(Math.round(s.rateL), 594);
  assert.equal(s.ratePct.toFixed(1), "12.9");
  assert.deepEqual(s.order, { t: now + 40 * DAY, liters: 2632, cost: 105040 });
  assert.deepEqual(s.supplier, { id: "pl", short: "ПропанЛайн", price: 50, t: T("2026-03-30T12:00:00") });
  assert.equal(Math.round(H.summary({ ...args, period: "day" }).rateL * 10), 195);
  assert.equal(Math.round(H.summary({ ...args, period: "year" }).rateL), 4967);
  assert.equal(Math.round(H.summary({ ...args, period: "half", avgRate: null }).rateL), 3561);
  const odd = H.summary({ ...args, period: "week", nowLevel: null, lastT: null, rateNow: null, hit: null, best: { t: now - DAY, liters: 1 }, refuels: [], suppliers: [] });
  assert.equal(odd.period, "month");
  assert.equal(odd.liters, null);
  assert.equal(odd.status, "none");
  assert.equal(odd.daysLeft, null);
  assert.equal(odd.rateL, null);
  assert.equal(odd.ratePct, null);
  assert.equal(odd.agoDays, null);
  assert.deepEqual(odd.order, { t: now, liters: 1, cost: null });
  assert.equal(odd.supplier, null);
  assert.equal(H.summary({ ...args, best: null, refuels: undefined, suppliers: undefined }).order, null);
});

test("journal: readings with changes, refuels, month groups and filters", () => {
  const readings = [
    { id: "a", date: "2026-11-02", time: "10:23:00", file: "", level: 51, note: "" },
    { id: "b.jpg", date: "2026-10-23", time: "13:29:00", file: "b.jpg", level: 55, note: "n" },
    { id: "c", date: "2026-10-10", time: "", level: 58 },
    { id: "x", date: "2026-10-11", time: "10:00:00", file: "x.jpg", level: null },
  ];
  const refuels = [{ id: "r1", date: "2026-10-23", liters: 2900, price: 37.64, total: 109156, supplier: "gs", note: "" }, { id: "r2", date: "2026-03-30", liters: 100, price: null, total: null }];
  const g = H.journal(readings, refuels, 4600);
  assert.deepEqual(g.map((x) => [x.key, x.items.map((i) => i.id)]), [["2026-11", ["a"]], ["2026-10", ["b.jpg", "r1", "c"]], ["2026-03", ["r2"]]]);
  const a = g[0].items[0];
  assert.equal(a.delta, -4);
  assert.equal(a.days, 10);
  assert.equal(a.liters, 2346);
  assert.equal(g[1].items[2].delta, undefined);
  assert.equal(g[1].items[1].supplier, "gs");
  assert.equal(g[2].items[0].supplier, "");
  assert.deepEqual(H.journal(readings, refuels, 4600, "readings").flatMap((x) => x.items.map((i) => i.kind)), ["reading", "reading", "reading"]);
  assert.deepEqual(H.journal(readings, refuels, 4600, "refuels").flatMap((x) => x.items.map((i) => i.id)), ["r1", "r2"]);
  assert.deepEqual(H.journal(null, null, 4600), []);
  const same = H.journal([{ id: "s", date: "2026-10-23", time: "12:00:00", level: 50 }], [{ id: "r", date: "2026-10-23", liters: 1 }], 4600);
  assert.deepEqual(same[0].items.map((i) => i.kind), ["refuel", "reading"]);
});

test("supplier stats, last supplied, initials and contact links", () => {
  const refuels = [{ id: "r1", date: "2025-12-05", liters: 2900, price: 38.93, supplier: "gs" }, { id: "r2", date: "2026-03-30", liters: 2800, price: 37.64, supplier: "gs" }, { id: "r0", date: "2026-03-30", liters: 1, price: 1, supplier: "gs" }];
  assert.deepEqual(H.supplierStats("gs", refuels), { count: 3, last: { t: T("2026-03-30T12:00:00"), price: 37.64, liters: 2800 } });
  assert.deepEqual(H.supplierStats("nope", undefined), { count: 0, last: null });
  assert.equal(H.lastSupplied(refuels, null), null);
  assert.equal(H.initials("Газ-Сервис"), "ГС");
  assert.equal(H.initials("ООО «Пропан»"), "ОП");
  assert.equal(H.initials("пропан"), "ПР");
  assert.equal(H.initials(""), "?");
  assert.deepEqual(H.contacts({ phone: "+7 (900) 123-45-67", messenger: "@gas_service", email: " a@b.ru " }),
    { call: "tel:+79001234567", sms: "sms:+79001234567", msg: "https://t.me/gas_service", mail: "mailto:a@b.ru", write: "https://t.me/gas_service" });
  assert.deepEqual(H.contacts({ messenger: "https://example.com/c" }), { msg: "https://example.com/c", write: "https://example.com/c" });
  assert.deepEqual(H.contacts({ messenger: "8 901 222-33-44" }), { msg: "https://wa.me/89012223344", write: "https://wa.me/89012223344" });
  assert.deepEqual(H.contacts({ phone: "112", messenger: "по звонку", email: "нет" }), { write: null });
  assert.deepEqual(H.contacts({ phone: "+7 900 1" }), { call: "tel:+79001", sms: "sms:+79001", write: "sms:+79001" });
});
