import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/sync.js");
const { driveClient, dataFileName, nameFromFile, pick3 } = globalThis.gasSync;

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    const u = new URL(url);
    const call = { method: opts.method, path: u.pathname, q: Object.fromEntries(u.searchParams), auth: opts.headers.Authorization, ctype: opts.headers["Content-Type"], body: opts.body };
    calls.push(call);
    const r = await handler(call, calls.length);
    if (r instanceof Error) throw r;
    const { status = 200, json, bytes, text } = r;
    return {
      status, ok: status >= 200 && status < 300,
      json: async () => { if (json === undefined) throw new SyntaxError("no json"); return json; },
      arrayBuffer: async () => (bytes || new TextEncoder().encode(text || "")).buffer,
    };
  };
  fn.calls = calls;
  return fn;
}
const tokens = () => { let n = 0; const t = async (force) => { if (force) n++; return "tok" + n; }; return t; };

test("requests carry the token, the right URLs and fields", async () => {
  const f = fakeFetch((c) => {
    if (c.path.endsWith("/about")) return { json: { user: { emailAddress: "a@b.c" } } };
    if (c.q.alt === "media") return { bytes: new Uint8Array([1, 2]) };
    if (c.path.endsWith("/permissions") && c.method === "GET") return { json: { permissions: [{ id: "p1" }] } };
    if (c.method === "DELETE") return { status: 204 };
    return { json: { id: "x", version: "3" } };
  });
  const d = driveClient({ token: tokens(), fetchFn: f });
  assert.deepEqual(await d.about(), { email: "a@b.c" });
  assert.deepEqual(await d.get("id/1"), { id: "x", version: "3" });
  assert.equal(f.calls.at(-1).path, "/drive/v3/files/id%2F1");
  assert.match(f.calls.at(-1).q.fields, /appProperties/);
  assert.deepEqual(await d.download("f1"), new Uint8Array([1, 2]));
  await d.createFolder("Gazgolder", null, { gazgolder: "root" });
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { name: "Gazgolder", mimeType: "application/vnd.google-apps.folder", appProperties: { gazgolder: "root" } });
  await d.createFolder("Дача", "root1", { gazgolder: "tank" });
  assert.deepEqual(JSON.parse(f.calls.at(-1).body).parents, ["root1"]);
  await d.rename("f1", "Новое");
  assert.equal(f.calls.at(-1).method, "PATCH");
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { name: "Новое" });
  await d.share("f1", "b@c.d", { message: "привет" });
  assert.equal(f.calls.at(-1).q.sendNotificationEmail, "true");
  assert.equal(f.calls.at(-1).q.emailMessage, "привет");
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), { type: "user", role: "writer", emailAddress: "b@c.d" });
  await d.share("f1", "b@c.d", { notify: false, role: "reader", message: "x" });
  assert.equal(f.calls.at(-1).q.sendNotificationEmail, "false");
  assert.equal(f.calls.at(-1).q.emailMessage, undefined);
  assert.deepEqual(await d.permissions("f1"), [{ id: "p1" }]);
  assert.equal(await d.unshare("f1", "p1"), null);
  assert.ok(f.calls.every((c) => c.auth === "Bearer tok0"));
});

test("uploads are multipart with metadata and the file body", async () => {
  const f = fakeFetch(() => ({ json: { id: "n", version: "1" } }));
  const d = driveClient({ token: tokens(), fetchFn: f });
  await d.create({ name: "a.json", parents: ["p"] }, new TextEncoder().encode('{"x":1}'), "application/json");
  let c = f.calls.at(-1);
  assert.equal(c.path, "/upload/drive/v3/files");
  assert.equal(c.q.uploadType, "multipart");
  const boundary = /boundary=(\S+)/.exec(c.ctype)[1];
  const text = await c.body.text();
  assert.ok(text.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json","parents":["p"]}`));
  assert.ok(text.includes('Content-Type: application/json\r\n\r\n{"x":1}\r\n'));
  assert.ok(text.endsWith(`--${boundary}--`));
  await d.update("n", { name: "b.json" }, new Uint8Array([0xff, 0xd8]), "image/jpeg");
  c = f.calls.at(-1);
  assert.equal(c.method, "PATCH");
  assert.equal(c.path, "/upload/drive/v3/files/n");
});

test("list follows pages", async () => {
  const f = fakeFetch((c) => (c.q.pageToken ? { json: { files: [{ id: "b" }] } } : { json: { files: [{ id: "a" }], nextPageToken: "t2" } }));
  const d = driveClient({ token: tokens(), fetchFn: f });
  assert.deepEqual((await d.list("trashed=false")).map((x) => x.id), ["a", "b"]);
  assert.equal(f.calls[0].q.q, "trashed=false");
  assert.equal(f.calls[1].q.pageToken, "t2");
  const g = fakeFetch(() => ({ json: {} }));
  assert.deepEqual(await driveClient({ token: tokens(), fetchFn: g }).list("x"), []);
  assert.deepEqual(await driveClient({ token: tokens(), fetchFn: fakeFetch(() => ({ json: {} })) }).permissions("x"), []);
  assert.deepEqual(await driveClient({ token: tokens(), fetchFn: fakeFetch(() => ({ json: {} })) }).about(), { email: "" });
});

test("an expired token is refreshed once; errors carry the status and Google's message", async () => {
  const f = fakeFetch((c, n) => (n === 1 ? { status: 401, json: {} } : { json: { id: "ok" } }));
  const d = driveClient({ token: tokens(), fetchFn: f });
  assert.deepEqual(await d.get("x"), { id: "ok" });
  assert.deepEqual(f.calls.map((c) => c.auth), ["Bearer tok0", "Bearer tok1"]);

  const always401 = driveClient({ token: tokens(), fetchFn: fakeFetch(() => ({ status: 401, json: { error: { message: "Invalid Credentials" } } })) });
  await assert.rejects(always401.get("x"), (e) => e.status === 401 && e.message === "Invalid Credentials");
  const notFound = driveClient({ token: tokens(), fetchFn: fakeFetch(() => ({ status: 404 })) });
  await assert.rejects(notFound.get("x"), (e) => e.status === 404 && /ошибка 404/.test(e.message));
  const offline = driveClient({ token: tokens(), fetchFn: fakeFetch(() => new TypeError("Failed to fetch")) });
  await assert.rejects(offline.get("x"), (e) => e.status === 0 && /Нет связи/.test(e.message));
  const noToken = driveClient({ token: async () => { throw Object.assign(new Error("needs consent"), { code: "NEED_CONSENT" }); }, fetchFn: fakeFetch(() => ({ json: {} })) });
  await assert.rejects(noToken.get("x"), (e) => e.code === "NEED_CONSENT");
});

test("the default fetch is the global one", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = fakeFetch(() => ({ json: { id: "g" } }));
  try { assert.deepEqual(await driveClient({ token: tokens() }).get("x"), { id: "g" }); } finally { globalThis.fetch = orig; }
});

test("names and three-way choice", () => {
  assert.equal(dataFileName("Дача/1"), "Gazgolder — Дача_1.json");
  assert.equal(dataFileName("X", "Газгольдер — "), "Газгольдер — X.json");
  assert.equal(nameFromFile("Gazgolder — Дача.json"), "Дача");
  assert.equal(nameFromFile("Газгольдер — Основной.json"), "Основной");
  assert.equal(nameFromFile(".json"), "Gazgolder");
  assert.equal(pick3(1, 1, 2), 2);
  assert.equal(pick3(1, 2, 1), 2);
  assert.equal(pick3(1, 2, 3), 2);
  assert.equal(pick3(1, undefined, 3), 3);
  assert.equal(pick3(1, 4, 4), 4);
});
