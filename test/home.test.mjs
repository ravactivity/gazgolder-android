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
  assert.equal(Math.round(H.summary({ ...args, period: "week" }).rateL), 137);
  const odd = H.summary({ ...args, period: "fortnight", nowLevel: null, lastT: null, rateNow: null, hit: null, best: { t: now - DAY, liters: 1 }, refuels: [], suppliers: [] });
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
  assert.deepEqual(H.contacts({ telegram: "@gas_srv", whatsapp: "8 900 123-45-67", messenger: "@old_one" }),
    { tg: "https://t.me/gas_srv", wa: "https://wa.me/79001234567", msg: "https://t.me/old_one", write: "https://t.me/gas_srv" });
  assert.deepEqual(H.contacts({ telegram: "t.me/gas_srv" }), { tg: "https://t.me/gas_srv", write: "https://t.me/gas_srv" });
  assert.deepEqual(H.contacts({ telegram: "+7 900 123-45-67" }), { tg: "https://t.me/+79001234567", write: "https://t.me/+79001234567" });
  assert.deepEqual(H.contacts({ telegram: "??", whatsapp: "+375 29 123-45-67" }), { wa: "https://wa.me/375291234567", write: "https://wa.me/375291234567" });
  assert.deepEqual(H.contacts({ whatsapp: "123" }), { write: null });
  assert.deepEqual(H.contacts({ phone: "+7 900 1" }), { call: "tel:+79001", sms: "sms:+79001", write: "sms:+79001" });
});

test("organisation names in the passport match a supplier; tanks it services or installed", () => {
  assert.equal(H.orgIs("ТехГаз", "техгаз"), true);
  assert.equal(H.orgIs("ТехГаз, +7 900", "ТехГаз"), true);
  assert.equal(H.orgIs("ТехГаз бригада 2", "ТехГаз"), true);
  assert.equal(H.orgIs("ТехГаз; Иван", "ТехГаз"), true);
  assert.equal(H.orgIs("ТехГазСтрой", "ТехГаз"), false);
  assert.equal(H.orgIs("", "ТехГаз"), false);
  assert.equal(H.orgIs("ТехГаз", ""), false);
  assert.equal(H.orgIs(undefined, undefined), false);
  const tanks = [
    { id: "b", name: "Баня", params: [{ k: "Монтажная организация", v: "ТехГаз" }] },
    { id: "a", name: "Дача", period: { n: 1, unit: "year" }, params: [{ k: "Обслуживание, контакты", v: "ТехГаз, +7" }, { k: "Следующее ТО / освидетельствование", v: " 15.06.2027 " }] },
    { id: "c", name: "Гараж", params: [{ k: "Монтажная организация", v: "ТехГаз" }, { k: "Обслуживание, контакты", v: "ТехГаз" }, { k: "Следующее ТО / освидетельствование", v: "15.06.2027" }] },
    { id: "d", name: "Дом", params: [{ k: "Обслуживание, контакты", v: "Другая" }] },
    { id: "e", name: "Склад" },
  ];
  assert.deepEqual(H.servedTanks({ short: "ТехГаз" }, tanks), [
    { id: "c", name: "Гараж", service: true, mount: true, next: "" },
    { id: "a", name: "Дача", service: true, mount: false, next: "15.06.2027" },
    { id: "b", name: "Баня", service: false, mount: true, next: "" },
  ]);
  assert.deepEqual(H.servedTanks({ short: "ТехГаз" }, undefined), []);
});

test("the next service date is read from free text and marked overdue or soon", () => {
  const D = (y, m, d) => new Date(y, m - 1, d).getTime();
  assert.equal(H.parseDay("2027-06-15"), D(2027, 6, 15));
  assert.equal(H.parseDay("15.06.2027"), D(2027, 6, 15));
  assert.equal(H.parseDay("5/6/27 до обеда"), D(2027, 6, 5));
  assert.equal(H.parseDay("06.2027"), D(2027, 6, 1));
  assert.equal(H.parseDay("весной"), null);
  assert.equal(H.parseDay(undefined), null);
  const now = D(2026, 11, 14);
  assert.equal(H.dueState("01.11.2026", now), "over");
  assert.equal(H.dueState("13.11.2026", now), "over");
  assert.equal(H.dueState("14.11.2026", now), "soon");
  assert.equal(H.dueState("12.11.2026", now), "over");
  assert.equal(H.dueState("10.12.2026", now), "soon");
  assert.equal(H.dueState("2027-06-15", now), "ok");
  assert.equal(H.dueState("после зимы", now), "");
});

test("the home card about the next service shows only when it is due within 30 days or overdue", () => {
  const now = new Date(2026, 10, 14, 15, 30).getTime();
  const P = (next, org) => [{ k: "Следующее ТО / освидетельствование", v: next }, ...(org ? [{ k: "Обслуживание, контакты", v: org }] : [])];
  const Y = { n: 1, unit: "year" };
  assert.deepEqual(H.serviceDue(P("20.11.2026", "Газ-Сервис, +7 900"), now, Y), { text: "20.11.2026", t: new Date(2026, 10, 20).getTime(), days: 6, over: false, org: "Газ-Сервис, +7 900" });
  assert.equal(H.serviceDue(P("14.11.2026"), now, Y).days, 0);
  assert.deepEqual(H.serviceDue(P("01.10.2026"), now, Y), { text: "01.10.2026", t: new Date(2026, 9, 1).getTime(), days: -44, over: true, org: "" });
  assert.equal(H.serviceDue(P("14.12.2026"), now, Y).days, 30);
  assert.equal(H.serviceDue(P("15.12.2026"), now, Y), null);
  assert.equal(H.serviceDue(P("весной"), now, Y), null);
  assert.equal(H.serviceDue(undefined, now, Y), null);
  assert.equal(H.serviceDue(P("20.11.2026"), now, null), null);
  assert.deepEqual(H.serviceInfo(P("15.06.2030", "Газ-Сервис"), Y), { text: "15.06.2030", t: new Date(2030, 5, 15).getTime(), org: "Газ-Сервис", computed: false });
  assert.equal(H.serviceInfo(P("не знаю"), Y), null);
  assert.equal(H.serviceInfo(P("15.06.2030"), null), null);
  assert.equal(H.serviceInfo(P("15.06.2030"), { n: 0, unit: "year" }), null);
  const last = (v) => [{ k: "Последнее ТО / освидетельствование", v }, { k: "Обслуживание, контакты", v: "ТехГаз" }];
  assert.deepEqual(H.serviceInfo(last("10.03.2026"), Y), { text: "10.03.2027", t: new Date(2027, 2, 10).getTime(), org: "ТехГаз", computed: true });
  assert.equal(H.serviceInfo(last("31.01.2026"), { n: 1, unit: "month" }).text, "28.02.2026");
  assert.equal(H.serviceInfo(last("2026-11-01"), { n: 10, unit: "day" }).text, "11.11.2026");
  assert.equal(H.serviceInfo(last("29.02.2028"), { n: 1, unit: "year" }).text, "28.02.2029");
  assert.equal(H.serviceDue(last("10.11.2025"), now, Y).over, true);
});

test("service records move the last service date; a passport next date older than a record is ignored", () => {
  const Y = { n: 1, unit: "year" }, now = new Date(2026, 10, 14, 12).getTime();
  const P = [{ k: "Следующее ТО / освидетельствование", v: "20.11.2026" }, { k: "Последнее ТО / освидетельствование", v: "20.11.2025" }];
  assert.equal(H.lastService(P, [{ date: "2026-03-01" }, { date: "bad" }]), new Date(2026, 2, 1).getTime());
  assert.equal(H.lastService([], []), null);
  assert.equal(H.serviceInfo(P, Y, [{ date: "2025-06-01" }]).text, "20.11.2026");
  assert.deepEqual(H.serviceInfo(P, Y, [{ date: "2026-11-14" }]), { text: "14.11.2027", t: new Date(2027, 10, 14).getTime(), org: "", computed: true });
  assert.equal(H.serviceDue(P, now, Y, [{ date: "2026-11-14" }]), null);
  assert.equal(H.serviceInfo([], Y, [{ date: "2026-01-10" }]).text, "10.01.2027");
  assert.equal(H.servedTanks({ short: "ТехГаз" }, [{ id: "a", name: "A", params: [{ k: "Обслуживание, контакты", v: "ТехГаз" }], period: Y, services: [{ date: "2026-05-05" }] }])[0].next, "05.05.2027");
});

test("the current supplier: the chosen one, else the one who delivered last", () => {
  const sups = [{ id: "a", short: "А" }, { id: "b", short: "Б" }];
  const rf = [{ id: "1", date: "2026-01-01", supplier: "a" }, { id: "2", date: "2026-02-01", supplier: "b" }];
  assert.equal(H.currentSupplier(rf, sups, null).id, "b");
  assert.equal(H.currentSupplier(rf, sups, "a").id, "a");
  assert.equal(H.currentSupplier(rf, sups, "gone").id, "b");
  assert.equal(H.currentSupplier([], sups, null), null);
  assert.equal(H.currentSupplier(rf, null, null), null);
});

test("home cards order: saved order first, unknown and repeated keys dropped, missing ones appended", () => {
  assert.deepEqual(H.homeOrder(null), ["hero", "level", "order", "to"]);
  assert.deepEqual(H.homeOrder(["to", "x", "to", "hero"]), ["to", "hero", "level", "order"]);
});
