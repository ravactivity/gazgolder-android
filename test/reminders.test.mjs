import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/reminders.js");
await import("../www/js/applink.js");
const R = globalThis.gasReminders, L = globalThis.gasLink;
const D = R.DAY;
const now = new Date(2026, 10, 4, 12, 0, 0).getTime();
const base = { pid: "default", name: "Дом", settings: { maxPct: 85, minPct: 20 }, now };
const hour = (tm) => new Date(tm).getHours();

test("ids are stable per tank, unique across tanks and cover all ten slots", () => {
  assert.deepEqual(R.idsFor("default"), R.idsFor("default"));
  assert.equal(new Set(R.idsFor("default")).size, 10);
  assert.equal(R.idsFor("default").filter((id) => R.idsFor("p1").includes(id)).length, 0);
});

test("photo reminder repeats every N days until a new photo arrives", () => {
  const out = R.plan({ ...base, A: { last: { t: now - 20 * D } }, photoDays: 14, repeatDays: 3 });
  const photo = out.filter((n) => n.kind === "photo");
  assert.equal(photo.length, 7);
  assert.equal(hour(photo[0].at), 19);
  assert.ok(photo[0].at > now);
  for (let k = 1; k < photo.length; k++) assert.equal(photo[k].at - photo[k - 1].at, 3 * D);
  assert.match(photo[0].title, /Сфотографируйте уровнемер — Дом/);
});

test("no repeats when the repeat interval is 0; no photo reminder without readings or when off", () => {
  assert.equal(R.plan({ ...base, A: { last: { t: now - D } }, photoDays: 14, repeatDays: 0 }).filter((n) => n.kind === "photo").length, 1);
  const first = R.plan({ ...base, A: { last: { t: now - D } }, photoDays: 14, repeatDays: 0 })[0];
  assert.equal(new Date(first.at).getDate(), new Date(now - D + 14 * D).getDate());
  assert.equal(R.plan({ ...base, A: {}, photoDays: 14 }).length, 0);
  assert.equal(R.plan({ ...base, A: { last: { t: now } }, photoDays: 0 }).length, 0);
});

test("order reminder: on the best day, plus the last comfortable day when it is later", () => {
  const A = { plan: { best: { t: now + 5 * D, liters: 2030 }, latest: now + 12 * D } };
  const out = R.plan({ ...base, A });
  const order = out.filter((n) => n.kind.startsWith("order"));
  assert.equal(order.length, 2);
  assert.equal(hour(order[0].at), 10);
  assert.match(order[0].body, /≈ 2050 л до 85%/);
  assert.match(order[1].body, /Последний спокойный день/);
});

test("an overdue best day moves to the last comfortable day, or to tomorrow when that passed too", () => {
  const late = R.plan({ ...base, A: { plan: { best: { t: now - 3 * D, liters: 1000 }, latest: now + 2 * D } } }).find((n) => n.kind === "order");
  assert.equal(new Date(late.at).getDate(), new Date(now + 2 * D).getDate());
  assert.match(late.body, /Последний спокойный день/);
  const gone = R.plan({ ...base, A: { plan: { best: { t: now - 3 * D, liters: 1000 }, latest: now - D } } }).find((n) => n.kind === "order");
  assert.ok(gone.at > now && gone.at < now + 2 * D);
  assert.match(gone.body, /Газ на исходе/);
  assert.equal(R.plan({ ...base, A: { plan: { infeasible: true, best: { t: now, liters: 1 } } } }).length, 0);
});

test("minimum warning three days before the forecast hit, never in the past", () => {
  const out = R.plan({ ...base, A: { forecast: { hit: now + 10 * D } } });
  const min = out.find((n) => n.kind === "min");
  assert.equal(new Date(min.at).getDate(), new Date(now + 7 * D).getDate());
  assert.match(min.body, /уровень дойдёт до 20%/);
  const soon = R.plan({ ...base, A: { forecast: { hit: now + D } } }).find((n) => n.kind === "min");
  assert.ok(soon.at > now);
  assert.equal(R.plan({ ...base, A: { forecast: { hit: now - D } } }).length, 0);
});

test("a custom translator and date formatter are used", () => {
  const out = R.plan({ ...base, A: { last: { t: now - 20 * D } }, repeatDays: 0, t: (s) => "EN:" + s, fmtD: () => "X" });
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
