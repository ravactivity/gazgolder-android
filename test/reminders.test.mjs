import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/reminders.js");
await import("../www/js/applink.js");
const R = globalThis.gasReminders, L = globalThis.gasLink;
const D = R.DAY;
const now = new Date(2026, 10, 4, 12, 0, 0).getTime();
const base = { pid: "default", name: "Дом", settings: { maxPct: 85, minPct: 20 }, now };
const hour = (tm) => new Date(tm).getHours();

const ON = { photo: { on: true, days: 14 }, refuel: { on: true, days: 3 }, service: { on: true, days: 7 } };
const only = (k, extra = {}) => ({ photo: { on: false }, refuel: { on: false }, service: { on: false }, [k]: { on: true, ...extra } });

test("ids are stable per tank, unique across tanks and cover all twenty-three slots", () => {
  assert.deepEqual(R.idsFor("default"), R.idsFor("default"));
  assert.equal(new Set(R.idsFor("default")).size, 23);
  assert.ok(R.idsFor("zzzzzzzz").every((id) => id < 2 ** 31));
  assert.equal(R.idsFor("default").filter((id) => R.idsFor("p1").includes(id)).length, 0);
});

test("settings are cleaned, old flags migrate, nothing is planned while all are off", () => {
  assert.deepEqual(R.cleanRem(null), { photo: { on: false, days: 14 }, refuel: { on: false, days: 3, unit: "pct", level: null }, service: { on: false, days: 7 } });
  assert.equal(R.cleanRem({ delivery: { on: true } }).refuel.on, true, "the old delivery reminder turns into the refuel one");
  const old = R.cleanRem(undefined, { notify: true, photoDays: 10, serviceRem: false });
  assert.deepEqual([old.photo, old.refuel.on, old.service.on], [{ on: true, days: 10 }, true, false]);
  const c = R.cleanRem({ photo: { on: 1, days: "-4" }, refuel: { on: true, days: "x", level: "900", unit: "l" }, service: { days: 9999 } });
  assert.deepEqual([c.photo.days, c.refuel.days, c.refuel.level, c.refuel.unit, c.service.days], [0, 3, 900, "l", 365]);
  assert.equal(R.cleanRem({ refuel: { level: -1 } }).refuel.level, null);
  assert.equal(R.anyOn(c), true);
  assert.equal(R.anyOn(R.cleanRem(null)), false);
  assert.equal(R.plan({ ...base, A: { last: { t: now - 20 * D }, plan: { best: { t: now, liters: 10 } } } }).length, 0);
});

test("photo reminder every N days counted from the last photo; 0 turns it off", () => {
  const photo = R.plan({ ...base, A: { last: { t: now - 20 * D } }, rem: only("photo", { days: 14 }) }).filter((n) => n.kind === "photo");
  assert.equal(photo.length, 7);
  assert.equal(hour(photo[0].at), 19);
  assert.equal(new Date(photo[0].at).getDate(), new Date(now + 8 * D).getDate());
  for (let k = 1; k < photo.length; k++) assert.equal(photo[k].at - photo[k - 1].at, 14 * D);
  assert.match(photo[0].title, /Сфотографируйте уровнемер — Дом/);
  const fresh = R.plan({ ...base, A: { last: { t: now - D } }, rem: only("photo", { days: 14 }) })[0];
  assert.equal(new Date(fresh.at).getDate(), new Date(now + 13 * D).getDate());
  assert.equal(R.plan({ ...base, A: {}, rem: only("photo") }).length, 0);
  assert.equal(R.plan({ ...base, A: { last: { t: now } }, rem: only("photo", { days: 0 }) }).length, 0);
});

test("order reminder: on the best day", () => {
  const A = { plan: { best: { t: now + 5 * D, liters: 2030 }, latest: now + 12 * D } };
  const out = R.plan({ ...base, A, rem: ON });
  const order = out.filter((n) => n.kind.startsWith("order"));
  assert.equal(order.length, 1);
  assert.equal(hour(order[0].at), 10);
  assert.match(order[0].body, /≈ 2050 л до 85%/);
});

test("an overdue best day moves to the last comfortable day, or to tomorrow when that passed too", () => {
  const rem = only("refuel", { days: 0 });
  const late = R.plan({ ...base, rem, A: { plan: { best: { t: now - 3 * D, liters: 1000 }, latest: now + 2 * D } } }).find((n) => n.kind === "order");
  assert.equal(new Date(late.at).getDate(), new Date(now + 2 * D).getDate());
  assert.match(late.body, /Последний спокойный день/);
  const gone = R.plan({ ...base, rem, A: { plan: { best: { t: now - 3 * D, liters: 1000 }, latest: now - D } } }).find((n) => n.kind === "order");
  assert.ok(gone.at > now && gone.at < now + 2 * D);
  assert.match(gone.body, /Газ на исходе/);
  assert.equal(R.plan({ ...base, rem, A: { plan: { infeasible: true, best: { t: now, liters: 1 } } } }).length, 0);
});

const daily = (from, level, perDay, n) => Array.from({ length: n }, (_, i) => ({ t: from + i * D, level: level - perDay * i }));

test("level reminder: when the forecast reaches the set level, then every N days", () => {
  const A = { last: { t: now - D, level: 40 }, forecast: { daily: daily(now - D, 40, 2, 11) } };
  const lv = R.plan({ ...base, A, rem: only("refuel", { days: 3, level: 30 }) });
  assert.deepEqual(lv.map((n) => n.kind), ["level", "level-repeat", "level-repeat", "level-repeat", "level-repeat", "level-repeat"]);
  assert.equal(new Date(lv[0].at).getDate(), new Date(now + 4 * D).getDate());
  assert.equal(hour(lv[0].at), 10);
  assert.equal(lv[1].at - lv[0].at, 3 * D);
  assert.match(lv[0].body, /уровень дойдёт до 30%/);
  assert.match(lv[1].body, /Уровень газа ниже 30%/);
  assert.deepEqual(lv.map((n) => n.id), [R.idsFor("default")[1], ...R.idsFor("default").slice(13, 18)]);
  const minimum = R.plan({ ...base, A, rem: only("refuel", { days: 3 }) })[0];
  assert.equal(new Date(minimum.at).getDate(), new Date(now + 9 * D).getDate());
  const liters = R.plan({ ...base, settings: { ...base.settings, volume: 1000 }, A, rem: only("refuel", { days: 3, level: 360, unit: "l" }), levelText: (p) => Math.round(p * 10) + " л" })[0];
  assert.equal(new Date(liters.at).getDate(), new Date(now + 1 * D).getDate());
  assert.match(liters.body, /360 л/);
  const below = R.plan({ ...base, A, rem: only("refuel", { days: 3, level: 10 }) })[0];
  assert.equal(new Date(below.at).getDate(), new Date(now + 14 * D).getDate());
  assert.equal(R.plan({ ...base, A, rem: only("refuel", { days: 0 }) }).length, 0);
});

test("level reminder: already below the level today; counted from a refuel newer than the last reading", () => {
  const A = { last: { t: now - 2 * D, level: 15 }, forecast: { daily: daily(now - 2 * D, 15, 1, 2) } };
  const now1 = R.plan({ ...base, A, rem: only("refuel", { days: 2 }) })[0];
  assert.ok(now1.at > now && now1.at < now + D);
  assert.match(now1.body, /Уровень газа ниже 20%/);
  const after = R.plan({ ...base, A, refuels: [{ date: "2026-11-01" }, { date: "2026-11-05" }], rem: only("refuel", { days: 4 }) })[0];
  assert.equal(new Date(after.at).getDate(), 9);
  assert.deepEqual(R.plan({ ...base, A: { last: { t: now, level: 50 } }, rem: only("refuel") }), []);
  assert.deepEqual(R.plan({ ...base, A: { last: { t: now, level: 50 }, forecast: { daily: [{ t: now, level: 50 }, { t: now + D, level: 50 }] } }, rem: only("refuel") }), []);
  assert.deepEqual(R.plan({ ...base, A: {}, rem: only("refuel") }), []);
});

test("order and level reminders are one notification: same title, the order day is dropped when the level chain covers it", () => {
  const A = { last: { t: now - D, level: 40 }, forecast: { daily: daily(now - D, 40, 2, 11) } };
  const near = R.plan({ ...base, A: { ...A, plan: { best: { t: now + 3 * D, liters: 1000 }, latest: now + 6 * D } }, rem: only("refuel", { days: 3, level: 30 }) });
  assert.deepEqual(near.map((n) => n.kind), ["level", "level-repeat", "level-repeat", "level-repeat", "level-repeat", "level-repeat"]);
  assert.ok(near.every((n) => n.title === "Пора заказывать газ — Дом"));
  const early = R.plan({ ...base, A: { ...A, plan: { best: { t: now + D, liters: 1000 }, latest: now + 6 * D } }, rem: only("refuel", { days: 2, level: 10 }) });
  assert.equal(early[0].kind, "order");
  assert.equal(early[0].title, early[1].title);
});

test("a custom translator and date formatter are used", () => {
  const out = R.plan({ ...base, A: { last: { t: now - 20 * D } }, rem: only("photo"), t: (s) => "EN:" + s, fmtD: () => "X" });
  assert.match(out[0].title, /^EN:/);
});

test("app links from shortcuts and the widget", () => {
  assert.equal(L.parse("gazgolder://photo"), "photo");
  assert.equal(L.parse("gazgolder://Reading/"), "reading");
  assert.equal(L.parse("gazgolder://refuel?from=widget"), "refuel");
  assert.equal(L.parse("gazgolder://delete"), null);
  assert.equal(L.parse("https://example.com"), null);
  assert.equal(L.parse(null), null);
});

test("service reminders: a week before, on the day, then every N days until a new date; only in the future, opening the passport", () => {
  const svc = (days, org = "") => ({ text: "дата", t: new Date(2026, 10, 4 + days).getTime(), org });
  const rem = only("service", { days: 7 });
  const kinds = (o) => o.filter((n) => n.kind.startsWith("service")).map((n) => n.kind);
  const far = R.plan({ ...base, A: {}, rem, service: svc(20, "Газ-Сервис") });
  assert.deepEqual(kinds(far), ["service-week", "service-day", "service-over", "service-over", "service-over", "service-over", "service-over"]);
  assert.ok(far.every((n) => hour(n.at) === 10 && n.open === "services"));
  assert.equal(new Date(far[0].at).getDate(), new Date(2026, 10, 17).getDate());
  assert.equal(far[3].at - far[2].at, 7 * D);
  assert.equal(new Date(far[2].at).getDate(), new Date(2026, 10, 4 + 27).getDate());
  assert.match(far[0].title, /Через неделю ТО — Дом/);
  assert.match(far[0].body, /дата · Газ-Сервис/);
  const ids = R.idsFor("default");
  assert.deepEqual(far.map((n) => n.id), [ids[10], ids[11], ids[12], ...ids.slice(18, 22)]);
  assert.deepEqual(kinds(R.plan({ ...base, A: {}, rem, service: svc(3) })).slice(0, 2), ["service-day", "service-over"]);
  assert.deepEqual(kinds(R.plan({ ...base, A: {}, rem, service: svc(0) }))[0], "service-over");
  const over = R.plan({ ...base, A: {}, rem, service: svc(-30) });
  assert.match(over[0].body, /Срок был дата/);
  assert.equal(over.length, 5);
  assert.ok(over[0].at > now && over[0].at <= now + 7 * D);
  assert.deepEqual(kinds(R.plan({ ...base, A: {}, rem: only("service", { days: 0 }), service: svc(3) })), []);
  assert.deepEqual(kinds(R.plan({ ...base, A: {}, rem, service: { text: "весной", t: null } })), []);
  assert.deepEqual(kinds(R.plan({ ...base, A: {}, rem })), []);
});

test("refuel reminder: the refill lead time before the forecast reaches the level, then every N days", () => {
  const A = { last: { t: now - D, level: 40 }, forecast: { daily: daily(now - D, 40, 2, 11) } };
  const settings = { ...base.settings, leadDays: 3 };
  const out = R.plan({ ...base, settings, A, rem: only("refuel", { days: 2 }) });
  assert.deepEqual(out.map((n) => n.kind), ["level", "level-repeat", "level-repeat", "level-repeat", "level-repeat", "level-repeat"]);
  assert.equal(new Date(out[0].at).getDate(), new Date(now + 6 * D).getDate());
  assert.equal(out[1].at - out[0].at, 2 * D);
  assert.match(out[0].body, /уровень дойдёт до 20%, запас на заправку — 3 дн\./);
  assert.match(out[3].body, /Уровень газа ниже 20%/);
  const late = R.plan({ ...base, settings: { ...settings, leadDays: 30 }, A, rem: only("refuel", { days: 2 }) });
  assert.ok(late[0].at > now && late[0].at < now + D);
});

test("muting turns every reminder off and remembers them; unmuting brings them back, or all on", () => {
  const rem = R.cleanRem(only("photo", { days: 5 }));
  const m = R.mute(rem);
  assert.equal(R.anyOn(m.rem), false);
  assert.equal(m.saved.photo.on, true);
  assert.equal(m.rem.photo.days, 5);
  assert.deepEqual(R.unmute(m.rem, m.saved), rem);
  const all = R.unmute(m.rem, null);
  assert.ok(Object.keys(R.DEFAULTS).every((k) => all[k].on));
  assert.ok(Object.keys(R.DEFAULTS).every((k) => R.unmute(m.rem, R.mute(R.cleanRem(null)).saved)[k].on));
});

test("notification inbox: fired ones are added once, unread first, old ones dropped after the keep period", () => {
  const n = (id, at, extra = {}) => ({ pid: "default", id, kind: "photo", title: "T" + id, body: "B", at, ...extra });
  let box = R.inboxAdd(null, [n(1, now - 2 * D), n(2, now - D), n(3, now + D)], now);
  assert.deepEqual(box.map((x) => x.id), [2, 1]);
  assert.equal(R.unread(box), 2);
  box = R.inboxAdd([...box, null, { at: "x" }], [n(2, now - D), n(4, now - 40 * D), n(5, now - 3 * D, { read: true, open: "services" })], now);
  assert.deepEqual(box.map((x) => x.id), [2, 1, 5]);
  assert.equal(box[2].open, "services");
  R.markRead(box, R.inboxKey(box[1]));
  assert.deepEqual(R.inboxView(box).map((x) => [x.id, x.read]), [[2, false], [1, true], [5, true]]);
  R.markRead(box, null);
  assert.equal(R.unread(box), 0);
  assert.equal(R.unread(null), 0);
  assert.deepEqual(R.inboxView(null), []);
  assert.deepEqual(R.inboxAdd(box, [], now, 1).map((x) => x.id), [2]);
  assert.equal(R.inboxAdd([n(9, now - D, { kind: undefined, title: undefined, body: undefined })], [n(9, now - D)], now)[0].id, 9);
  assert.equal(R.inboxAdd(null, [{ pid: "p", id: 1, at: now - D }], now)[0].kind, "");
  assert.deepEqual([R.keepDays(""), R.keepDays("x"), R.keepDays(0), R.keepDays(999), R.keepDays("14")], [30, 30, 1, 365, 14]);
});
