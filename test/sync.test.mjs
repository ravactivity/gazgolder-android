import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/exif.js");
await import("../www/js/storage.js");
await import("../www/js/backend.js");
await import("../www/js/sync.js");
await import("./fixtures/fake-cloud.js");
const { gasStorage, gasBackend, gasSync } = globalThis;

const fakeCloud = () => globalThis.gasFakeCloud();

function jpeg(tag) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, tag, tag, 0xff, 0xd9]);
}

async function device(cloud, user) {
  const fs = gasStorage.memFS();
  const be = gasBackend.createBackend(fs, {});
  await be.init();
  const call = async (method, path, body, json = true) => {
    const res = await be.gasFetch(path, { method, body: json && body !== undefined ? JSON.stringify(body) : body });
    const b = await res.json();
    if (!res.ok) throw new Error(b.error);
    return b;
  };
  const sync = gasSync.createSync({ backend: be, fs, drive: cloud.client(user), now: () => Date.now() });
  const cfg = await sync.loadConfig();
  await sync.saveConfig({ ...cfg, enabled: true, account: user });
  return { fs, be, call, sync, data: (p = "default") => call("GET", "/api/data?p=" + p) };
}

test("merge3: both sides add, edit and delete different rows", () => {
  const row = (id, level) => ({ id, date: "2026-01-01", time: "10:00:00", file: id, level, note: "" });
  const S = (rows) => ({ readings: rows, refuels: [], settings: { volume: 4600, minPct: 20 }, passport: { params: [], text: "", photos: [] } });
  const base = S([row("a", 50), row("b", 40), row("c", 30)]);
  const local = S([row("a", 51), row("c", 30), row("d", 20)]);
  const remote = S([row("a", 50), row("b", 40), row("e", 10)]);
  remote.settings.minPct = 25;
  const m = gasSync.merge3(base, local, remote);
  assert.deepEqual(m.readings.map((r) => [r.id, r.level]).sort(), [["a", 51], ["d", 20], ["e", 10]]);
  assert.equal(m.settings.minPct, 25);
  assert.equal(m.settings.volume, 4600);
});

test("merge3: a conflicting edit keeps the local value, delete vs edit keeps the edit", () => {
  const S = (rows) => ({ readings: [], refuels: rows, settings: {}, passport: { params: [], text: "x", photos: [] } });
  const r = (id, liters) => ({ id, date: "2026-01-01", liters, price: 50, total: liters * 50, note: "" });
  const m = gasSync.merge3(S([r("1", 100), r("2", 200)]), S([r("1", 110)]), S([r("1", 120), r("2", 250)]));
  assert.deepEqual(m.refuels.map((x) => [x.id, x.liters]), [["1", 110], ["2", 250]]);
});

test("two phones of one account: data, photos, edits and deletes travel both ways", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  await A.call("POST", "/api/upload?p=default&name=g1.jpg", jpeg(1), false);
  await A.call("POST", "/api/readings?p=default", { file: "g1.jpg", date: "2026-10-01", time: "09:00", level: 62 });
  await A.call("POST", "/api/readings?p=default", { date: "2026-10-05", time: "09:00", level: 58 });
  await A.call("POST", "/api/refuels?p=default", { id: "r1", date: "2026-09-01", liters: 2000, price: 40 });
  await A.call("PUT", "/api/settings?p=default", { volume: 2700, minDelivery: 1000 });
  const r1 = await A.sync.syncAll();
  assert.deepEqual(r1.errors, {});

  const B = await device(cloud, "me@example.com");
  const r2 = await B.sync.syncAll();
  assert.deepEqual(r2.errors, {});
  let d = await B.data();
  assert.equal(d.settings.volume, 2700);
  assert.deepEqual(d.readings.map((r) => r.level), [62, 58]);
  assert.equal(d.refuels[0].total, 80000);
  assert.ok(await B.fs.exists("media/default/img/g1.jpg"));
  assert.ok(await B.fs.exists("media/default/.thumbs/g1.jpg"));
  assert.deepEqual(await B.fs.read("data/default/gas_levels.csv"), await A.fs.read("data/default/gas_levels.csv"));

  await B.call("DELETE", "/api/readings?p=default&id=" + encodeURIComponent("manual:2026-10-05T09:00:00"));
  await A.call("POST", "/api/readings?p=default", { date: "2026-10-09", time: "08:00", level: 55, note: "А" });
  await B.sync.syncAll();
  await A.sync.syncAll();
  await B.sync.syncAll();
  for (const X of [A, B]) assert.deepEqual((await X.data()).readings.map((r) => r.level), [62, 55]);

  const dataFiles = [...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data");
  assert.equal(dataFiles.length, 1);
  assert.equal(dataFiles[0].name, "Gazgolder — Основной.json");
  assert.equal([...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "photo").length, 1);
});

test("suppliers travel with the data: added, edited, deleted; one used in refuels is never dropped", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  await A.call("POST", "/api/suppliers", { id: "gs", short: "Газ-Сервис", phone: "+7 900 000-00-00" });
  await A.call("POST", "/api/suppliers", { id: "pl", short: "ПропанЛайн" });
  await A.call("POST", "/api/refuels?p=default", { id: "r1", date: "2026-09-01", liters: 2000, price: 40, supplier: "gs" });
  await A.sync.syncAll();
  const B = await device(cloud, "me@example.com");
  await B.sync.syncAll();
  let d = await B.data();
  assert.deepEqual(d.suppliers.map((x) => x.id), ["gs", "pl"]);
  assert.equal(d.refuels[0].supplier, "gs");

  await B.call("POST", "/api/suppliers", { id: "gs", short: "Газ-Сервис", phone: "+7 900 111-11-11" });
  await B.call("DELETE", "/api/suppliers?id=pl");
  await B.call("POST", "/api/suppliers", { id: "nv", short: "Новый" });
  await B.sync.syncAll();
  await A.sync.syncAll();
  d = await A.data();
  assert.deepEqual(d.suppliers.map((x) => [x.id, x.phone]), [["gs", "+7 900 111-11-11"], ["nv", ""]]);

  await A.call("POST", "/api/refuels?p=default", { id: "r2", date: "2026-10-01", liters: 100, supplier: "nv" });
  const text = await B.fs.readText("data/suppliers.json");
  await B.fs.write("data/suppliers.json", new TextEncoder().encode(JSON.stringify({ suppliers: JSON.parse(text).suppliers.filter((x) => x.id !== "nv") })));
  await B.sync.syncAll();
  await A.sync.syncAll();
  await B.sync.syncAll();
  for (const X of [A, B]) assert.deepEqual((await X.data()).suppliers.map((x) => x.id), ["gs", "nv"]);
});

test("a second tank created on one phone appears on the other; deleting it locally stops its sync", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com"), B = await device(cloud, "me@example.com");
  const { id } = await A.call("POST", "/api/profiles", { name: "Дача", volume: 1000 });
  await A.call("POST", `/api/readings?p=${id}`, { date: "2026-10-01", time: "09:00", level: 40 });
  await A.sync.syncAll();
  const r = await B.sync.syncAll();
  assert.equal(r.created.length, 1);
  const prof = (await B.call("GET", "/api/profiles")).profiles.find((p) => p.name === "Дача");
  assert.ok(prof);
  assert.equal((await B.data(prof.id)).settings.volume, 1000);
  await B.call("DELETE", "/api/profiles?id=" + prof.id);
  const r2 = await B.sync.syncAll();
  assert.equal(r2.created.length, 0);
  assert.equal((await B.call("GET", "/api/profiles")).profiles.length, 1);
});

test("renaming a tank travels through the data file", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com"), B = await device(cloud, "me@example.com");
  await A.sync.syncAll(); await B.sync.syncAll();
  await A.call("PUT", "/api/profiles", { id: "default", name: "Дом" });
  await A.sync.syncAll(); await B.sync.syncAll();
  assert.equal((await B.call("GET", "/api/profiles")).profiles[0].name, "Дом");
  assert.ok([...cloud.files.values()].some((f) => f.name === "Gazgolder — Дом.json"));
  assert.deepEqual([...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "tank").map((f) => f.name), ["Дом"]);
});

test("shared access: the partner picks the file, both edit, photos need a one-time grant", async () => {
  const cloud = fakeCloud();
  const owner = await device(cloud, "owner@example.com");
  await owner.call("POST", "/api/upload?p=default&name=o1.jpg", jpeg(2), false);
  await owner.call("POST", "/api/readings?p=default", { file: "o1.jpg", date: "2026-10-01", time: "09:00", level: 70 });
  await owner.sync.syncAll();
  const ownerState = await owner.sync.loadState("default");
  const members = await owner.sync.share("default", "Partner@Example.com", { message: "" });
  assert.deepEqual(members, ["partner@example.com"]);
  await owner.sync.syncAll();

  const partner = await device(cloud, "partner@example.com");
  await partner.call("POST", "/api/readings?p=default", { date: "2026-01-01", time: "10:00", level: 11 });
  await partner.sync.syncAll();
  cloud.pick("partner@example.com", [ownerState.fileId]);
  const joined = await partner.sync.join([ownerState.fileId]);
  assert.equal(joined.length, 1);
  const r = await partner.sync.syncAll();
  assert.deepEqual(r.errors, {});
  assert.equal(r.needAccess, 1);
  const shared = (await partner.call("GET", "/api/profiles")).profiles.find((p) => p.id === joined[0]);
  assert.equal(shared.name, "Основной");
  assert.deepEqual((await partner.data(joined[0])).readings.map((x) => x.level), [70]);
  assert.deepEqual((await partner.data("default")).readings.map((x) => x.level), [11]);

  const ids = await partner.sync.needAccess();
  cloud.pick("partner@example.com", ids);
  const r2 = await partner.sync.syncAll();
  assert.equal(r2.needAccess, 0);
  assert.ok(await partner.fs.exists(`media/${joined[0]}/img/o1.jpg`));

  await partner.call("POST", `/api/upload?p=${joined[0]}&name=p1.jpg`, jpeg(3), false);
  await partner.call("POST", `/api/readings?p=${joined[0]}`, { file: "p1.jpg", date: "2026-10-10", time: "09:00", level: 66 });
  await partner.sync.syncAll();
  const r3 = await owner.sync.syncAll();
  assert.deepEqual(r3.errors, {});
  assert.deepEqual((await owner.data()).readings.map((x) => x.level), [70, 66]);
  assert.equal(r3.needAccess, 1);
  cloud.pick("owner@example.com", await owner.sync.needAccess());
  await owner.sync.syncAll();
  assert.ok(await owner.fs.exists("media/default/img/p1.jpg"));
  assert.equal((await owner.sync.loadState("default")).needAccess.length, 0);

  await owner.sync.unshare("default", "partner@example.com");
  assert.deepEqual((await owner.sync.loadState("default")).members, []);
});

test("many members: an invitee shares further, has an own tank shared back, and stop-sharing sticks", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "a@example.com"), B = await device(cloud, "b@example.com"), C = await device(cloud, "c@example.com");
  const levels = async (X, pid) => (await X.data(pid)).readings.map((r) => r.level);
  const joinTank = async (X, user, fileId) => { cloud.pick(user, [fileId]); const [pid] = await X.sync.join([fileId]); await X.sync.syncAll(); return pid; };
  const grantPhotos = async (X, user) => { cloud.pick(user, await X.sync.needAccess()); await X.sync.syncAll(); };

  await A.call("POST", "/api/upload?p=default&name=a1.jpg", jpeg(1), false);
  await A.call("POST", "/api/readings?p=default", { file: "a1.jpg", date: "2026-10-01", time: "09:00", level: 80 });
  await A.sync.syncAll();
  const aFile = (await A.sync.loadState("default")).fileId;
  await A.sync.share("default", "b@example.com");
  await A.sync.syncAll();
  const bShared = await joinTank(B, "b@example.com", aFile);
  await grantPhotos(B, "b@example.com");
  assert.ok(await B.fs.exists(`media/${bShared}/img/a1.jpg`));

  await B.sync.share(bShared, "c@example.com");
  await assert.rejects(B.sync.share(bShared, "a@example.com"), /уже есть доступ/);
  await B.sync.syncAll();
  await A.sync.syncAll();
  const cShared = await joinTank(C, "c@example.com", aFile);
  await grantPhotos(C, "c@example.com");
  assert.deepEqual(await levels(C, cShared), [80]);
  assert.ok(await C.fs.exists(`media/${cShared}/img/a1.jpg`));

  await C.call("POST", `/api/upload?p=${cShared}&name=c1.jpg`, jpeg(4), false);
  await C.call("POST", `/api/readings?p=${cShared}`, { file: "c1.jpg", date: "2026-10-05", time: "09:00", level: 75 });
  await C.sync.syncAll();
  await A.sync.syncAll(); await B.sync.syncAll();
  await grantPhotos(A, "a@example.com"); await grantPhotos(B, "b@example.com");
  assert.deepEqual(await levels(A, "default"), [80, 75]);
  assert.ok(await A.fs.exists("media/default/img/c1.jpg"));
  assert.ok(await B.fs.exists(`media/${bShared}/img/c1.jpg`));

  const { id: bOwn } = await B.call("POST", "/api/profiles", { name: "Баня", volume: 300 });
  await B.call("POST", `/api/readings?p=${bOwn}`, { date: "2026-10-03", time: "09:00", level: 50 });
  await B.sync.syncAll();
  await B.sync.share(bOwn, "a@example.com");
  await B.sync.share(bOwn, "c@example.com");
  const bFile = (await B.sync.loadState(bOwn)).fileId;
  const aBanya = await joinTank(A, "a@example.com", bFile);
  const cBanya = await joinTank(C, "c@example.com", bFile);
  await A.call("POST", `/api/readings?p=${aBanya}`, { date: "2026-10-04", time: "09:00", level: 45 });
  await A.sync.syncAll(); await C.sync.syncAll();
  assert.deepEqual(await levels(C, cBanya), [50, 45]);
  assert.equal((await A.call("GET", "/api/profiles")).profiles.find((p) => p.id === aBanya).name, "Баня");

  await assert.rejects(B.sync.unshare(bShared, "c@example.com"), /только владелец/);
  assert.equal(await B.sync.canManage(bShared), false);
  assert.equal(await A.sync.canManage("default"), true);
  const bst = await B.sync.loadState(bShared);
  await B.fs.write(`data/.sync/${bShared}.json`, JSON.stringify({ ...bst, members: ["b@example.com"] }));
  await B.sync.syncAll(); await A.sync.syncAll(); await B.sync.syncAll();
  assert.deepEqual((await A.sync.loadState("default")).members, ["b@example.com", "c@example.com"]);
  assert.deepEqual((await B.sync.loadState(bShared)).members, ["b@example.com", "c@example.com"]);

  await A.sync.unshare("default", "c@example.com");
  await A.sync.syncAll(); await B.sync.syncAll(); await A.sync.syncAll();
  assert.deepEqual((await A.sync.loadState("default")).members, ["b@example.com"]);
  assert.deepEqual((await B.sync.loadState(bShared)).members, ["b@example.com"]);
  const r = await C.sync.syncAll();
  assert.equal((await C.sync.loadState(cShared)).gone, true);
  assert.deepEqual(r.errors, {});
});

test("the owner's removal from one phone is not undone by the owner's other phone", async () => {
  const cloud = fakeCloud();
  const A1 = await device(cloud, "a@example.com"), A2 = await device(cloud, "a@example.com");
  await A1.sync.syncAll();
  await A1.sync.share("default", "b@example.com");
  await A1.sync.syncAll(); await A2.sync.syncAll();
  assert.deepEqual((await A2.sync.loadState("default")).members, ["b@example.com"]);
  assert.equal(await A2.sync.canManage("default"), true);
  await A1.sync.unshare("default", "b@example.com");
  await A1.sync.syncAll(); await A2.sync.syncAll(); await A1.sync.syncAll();
  for (const X of [A1, A2]) assert.deepEqual((await X.sync.loadState("default")).members, []);
  const folder = cloud.files.get((await A1.sync.loadState("default")).folderId);
  assert.equal(folder.perms.length, 0);
});

test("Drive folders are named after the tanks; tanks with the same name stay separate", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  const t1 = (await A.call("POST", "/api/profiles", { name: "Дача", volume: 1000 })).id;
  const t2 = (await A.call("POST", "/api/profiles", { name: "Дача", volume: 2000 })).id;
  await A.sync.syncAll();
  const folders = [...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "tank").map((f) => f.name).sort();
  assert.deepEqual(folders, ["Дача", "Дача", "Основной"]);
  assert.notEqual((await A.sync.loadState(t1)).fileId, (await A.sync.loadState(t2)).fileId);
  const B = await device(cloud, "me@example.com");
  await B.sync.syncAll();
  const dachas = (await B.call("GET", "/api/profiles")).profiles.filter((p) => p.name === "Дача");
  assert.equal(dachas.length, 2);
  assert.deepEqual((await Promise.all(dachas.map((p) => B.data(p.id)))).map((d) => d.settings.volume).sort(), [1000, 2000]);
});

test("a data file trashed on Drive is not recreated silently", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  await A.sync.syncAll();
  const st = await A.sync.loadState("default");
  cloud.trash(st.fileId);
  await A.sync.syncAll();
  assert.equal((await A.sync.loadState("default")).gone, true);
  assert.equal([...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data").length, 1);
  await A.sync.forget("default", { ignore: false });
  await A.sync.syncAll();
  assert.equal([...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data" && !f.trashed).length, 1);
});

test("a tank excluded from sync is not uploaded, and including it again relinks the same file", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  const { id } = await A.call("POST", "/api/profiles", { name: "Личная", volume: 500 });
  await A.sync.setExcluded(id, true);
  await A.sync.syncAll();
  const names = () => [...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data").map((f) => f.name).sort();
  assert.deepEqual(names(), ["Gazgolder — Основной.json"]);
  await A.sync.setExcluded("default", true);
  await A.call("POST", "/api/readings?p=default", { date: "2026-10-01", time: "09:00", level: 40 });
  await A.sync.syncAll();
  await A.sync.setExcluded("default", false);
  await A.sync.syncAll();
  assert.deepEqual(names(), ["Gazgolder — Основной.json"]);
  const B = await device(cloud, "me@example.com");
  await B.sync.syncAll();
  assert.deepEqual((await B.data()).readings.map((r) => r.level), [40]);
});

test("photos wait for Wi-Fi when asked", async () => {
  const cloud = fakeCloud();
  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  let wifi = false;
  const s = gasSync.createSync({ backend: be, fs, drive: cloud.client("me@example.com"), photosAllowed: (cfg) => !cfg.wifiOnly || wifi });
  await s.saveConfig({ ...(await s.loadConfig()), enabled: true, account: "me@example.com" });
  await be.gasFetch("/api/upload?p=default&name=w.jpg", { method: "POST", body: jpeg(9) });
  await s.syncAll();
  const photos = () => [...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "photo").length;
  assert.equal(photos(), 0);
  wifi = true;
  await s.syncAll();
  assert.equal(photos(), 1);
});

test("two phones that both had data before the first sync share the same files; Drive names are English", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  await A.call("POST", "/api/readings?p=default", { date: "2026-10-01", time: "09:00", level: 40 });
  const { id } = await A.call("POST", "/api/profiles", { name: "Дача", volume: 1000 });
  await A.sync.syncAll();
  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  await be.gasFetch("/api/readings?p=default", { method: "POST", body: JSON.stringify({ date: "2026-10-02", time: "09:00", level: 38 }) });
  await be.gasFetch("/api/profiles", { method: "POST", body: JSON.stringify({ name: "Дача" }) });
  const en = gasSync.createSync({ backend: be, fs, drive: cloud.client("me@example.com") });
  await en.saveConfig({ ...(await en.loadConfig()), enabled: true, account: "me@example.com" });
  const r = await en.syncAll();
  assert.deepEqual(r.errors, {});
  assert.equal(r.created.length, 0);
  const data = [...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data");
  assert.equal(data.length, 2);
  assert.ok(data.some((f) => f.name === "Gazgolder — Основной.json"));
  const d = JSON.parse(await (await be.gasFetch("/api/data?p=default")).text());
  assert.deepEqual(d.readings.map((x) => x.level), [40, 38]);
  await A.sync.syncAll();
  assert.equal((await A.data(id)).settings.volume, 1000);
  assert.equal((await A.call("GET", "/api/profiles")).profiles[0].name, "Основной");
});

test("sync is off by default and does nothing", async () => {
  const cloud = fakeCloud();
  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  const s = gasSync.createSync({ backend: be, fs, drive: cloud.client("x@example.com") });
  assert.equal((await s.loadConfig()).enabled, false);
  assert.deepEqual(await s.syncAll(), { off: true });
  assert.equal(cloud.files.size, 0);
});

test("parseRemote rejects foreign and newer files", () => {
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  assert.throws(() => gasSync.parseRemote(enc({ hello: 1 })), /не файл синхронизации/);
  assert.throws(() => gasSync.parseRemote(enc({ format: "gazgolder-sync", version: 99, tables: {} })), /более новой версией/);
  const r = gasSync.parseRemote(enc({ format: "gazgolder-sync", version: 1, name: "Х", tables: { "refuels.csv": "x" }, photos: { "img/a.jpg": { id: "abcdefghijk" }, "../x": { id: "abcdefghijk" } }, members: ["A@B.CO", "bad"] }));
  assert.deepEqual(Object.keys(r.photos), ["img/a.jpg"]);
  assert.deepEqual(r.members, ["a@b.co"]);
});

test("errors: one failing tank is reported without stopping others; a consent problem stops the run", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  const { id } = await A.call("POST", "/api/profiles", { name: "Дача" });
  await A.sync.syncAll();
  const bad = (await A.sync.loadState(id)).fileId;
  const base = cloud.client("me@example.com");
  const flaky = { ...base, get: async (fid) => { if (fid === bad) { const e = new Error("backend error"); e.status = 500; throw e; } return base.get(fid); } };
  const S1 = gasSync.createSync({ backend: A.be, fs: A.fs, drive: flaky });
  const r = await S1.syncAll();
  assert.equal(r.errors[id], "backend error");
  assert.equal(r.errors.default, undefined);
  assert.equal((await S1.loadState(id)).error, "backend error");
  assert.equal((await S1.loadConfig()).error, "backend error");
  const noConsent = { ...base, list: async () => { throw Object.assign(new Error("Google access needs confirmation"), { code: "NEED_CONSENT" }); } };
  const S2 = gasSync.createSync({ backend: A.be, fs: A.fs, drive: noConsent });
  const r2 = await S2.syncAll();
  assert.equal(r2.needConsent, true);
  assert.match((await S2.loadConfig()).error, /confirmation/);
  const [p1, p2] = [S2.syncAll(), S2.syncAll()];
  assert.equal(p1, p2, "concurrent runs share one sync");
  await p1;
});

test("forget with ignore keeps a tank off Drive until it is linked again", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "me@example.com");
  await A.sync.syncAll();
  await A.sync.forget("default");
  await A.sync.forget("nope");
  await A.sync.syncAll();
  assert.equal([...cloud.files.values()].filter((f) => f.appProperties.gazgolder === "data").length, 2);
  assert.ok((await A.sync.loadConfig()).ignored.length >= 1);
  await assert.rejects(A.sync.share("nope", "x@example.com"), /не синхронизируется/);
  await assert.rejects(A.sync.share("default", "bad"), /Неверный адрес/);
  await assert.rejects(A.sync.share("default", "me@example.com"), /собственный адрес/);
  assert.deepEqual(await A.sync.unshare("nope", "x@example.com"), []);
  assert.equal(await A.sync.canManage("nope"), false);
  assert.deepEqual(await A.sync.join([]), []);
});

test("a member invited later also gets the photos a member stored in their own folder", async () => {
  const cloud = fakeCloud();
  const A = await device(cloud, "a@example.com"), B = await device(cloud, "b@example.com"), D = await device(cloud, "d@example.com");
  await A.sync.syncAll();
  const file = (await A.sync.loadState("default")).fileId;
  await A.sync.share("default", "b@example.com");
  await A.sync.syncAll();
  cloud.pick("b@example.com", [file]);
  const [bp] = await B.sync.join([file]);
  await B.sync.syncAll();
  await B.call("POST", `/api/upload?p=${bp}&name=b1.jpg`, jpeg(7), false);
  await B.sync.syncAll();
  assert.equal((await B.sync.loadState(bp)).mine.length, 1);
  await A.sync.share("default", "d@example.com");
  await A.sync.syncAll(); await B.sync.syncAll();
  cloud.pick("d@example.com", [file]);
  const [dp] = await D.sync.join([file]);
  await D.sync.syncAll();
  cloud.pick("d@example.com", await D.sync.needAccess());
  await D.sync.syncAll();
  assert.ok(await D.fs.exists(`media/${dp}/img/b1.jpg`));
  assert.deepEqual(await D.sync.join([file]), []);
});
