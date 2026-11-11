import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/storage.js");
const { capFS, memFS, bytesToB64, b64ToBytes } = globalThis.gasStorage;

function fakeFilesystem() {
  const files = new Map(), dirs = new Set([""]);
  const key = (o) => `${o.directory}:${o.path}`;
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const err = (m) => Object.assign(new Error(m), { code: "OS-PLUG-FILE-0008" });
  const mk = (D, p) => { const parts = p.split("/").filter(Boolean); for (let i = 1; i <= parts.length; i++) dirs.add(`${D}:${parts.slice(0, i).join("/")}`); };
  const calls = [];
  const FS = {
    calls,
    async getUri({ path, directory }) { return { uri: `file:///data/${directory.toLowerCase()}/${path}` }; },
    async stat(o) { calls.push("stat"); if (files.has(key(o))) return { type: "file" }; if (dirs.has(key(o)) || o.path === "") return { type: "directory" }; throw err("no"); },
    async readFile(o) {
      const v = files.get(key(o));
      if (!v) throw err("missing");
      if (o.encoding === "utf8") return { data: new TextDecoder().decode(v) };
      return o.path.endsWith(".blob") ? { data: new Blob([v]) } : { data: bytesToB64(v) };
    },
    async writeFile(o) {
      if (!o.recursive && !dirs.has(`${o.directory}:${parent(o.path)}`) && parent(o.path)) throw err("no dir");
      mk(o.directory, parent(o.path));
      files.set(key(o), o.encoding === "utf8" ? new TextEncoder().encode(o.data) : b64ToBytes(o.data));
    },
    async appendFile(o) {
      const old = files.get(key(o)) || new Uint8Array(0);
      const add = o.encoding === "utf8" ? new TextEncoder().encode(o.data) : b64ToBytes(o.data);
      const n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); files.set(key(o), n);
    },
    async mkdir(o) { mk(o.directory, o.path); },
    async readdir(o) {
      if (!dirs.has(key(o)) && o.path !== "") throw err("no dir");
      const pre = o.path ? o.path + "/" : "", out = new Set();
      for (const k of [...files.keys(), ...dirs]) {
        const [d, p] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
        if (d === o.directory && p.startsWith(pre) && p !== o.path) out.add(p.slice(pre.length).split("/")[0]);
      }
      return { files: [...out].filter(Boolean).map((name, i) => (i % 2 ? name : { name })) };
    },
    async rename(o) {
      const a = `${o.directory}:${o.from}`, b = `${o.toDirectory}:${o.to}`;
      if (files.has(a)) { files.set(b, files.get(a)); files.delete(a); return; }
      for (const k of [...files.keys()]) if (k.startsWith(a + "/")) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      for (const k of [...dirs]) if (k === a || k.startsWith(a + "/")) { dirs.delete(k); dirs.add(b + k.slice(a.length)); }
    },
    async deleteFile(o) { if (!files.delete(key(o))) throw err("missing"); },
    async rmdir(o) { const a = key(o); for (const k of [...files.keys()]) if (k.startsWith(a + "/")) files.delete(k); for (const k of [...dirs]) if (k === a || k.startsWith(a + "/")) dirs.delete(k); },
  };
  return FS;
}
const Capacitor = { convertFileSrc: (u) => u.replace("file://", "https://localhost/_capacitor_file_") };

test("base64 helpers round-trip large binary data", () => {
  const b = new Uint8Array(100000).map((_, i) => (i * 7) & 255);
  assert.deepEqual(b64ToBytes(bytesToB64(b)), b);
});

test("device storage: read/write text and bytes, append, list, rename, delete", async () => {
  const F = fakeFilesystem(), fs = await capFS(F, Capacitor, "DATA");
  assert.equal(fs.kind, "device");
  await fs.write("data/default/a.csv", "привет");
  assert.equal(await fs.readText("data/default/a.csv"), "привет");
  await fs.write("media/x/img/p.jpg", new Uint8Array([1, 2, 3]));
  assert.deepEqual(await fs.read("media/x/img/p.jpg"), new Uint8Array([1, 2, 3]));
  await fs.write("media/x/img/q.blob", new Uint8Array([9]));
  assert.deepEqual(await fs.read("media/x/img/q.blob"), new Uint8Array([9]));
  assert.equal(await fs.read("nope"), null);
  assert.equal(await fs.readText("nope"), null);
  await fs.append("log.bin", new Uint8Array([1]));
  await fs.append("log.bin", new Uint8Array([2]));
  await fs.append("log.txt", "a");
  await fs.append("log.txt", "b");
  assert.deepEqual(await fs.read("log.bin"), new Uint8Array([1, 2]));
  assert.equal(await fs.readText("log.txt"), "ab");
  assert.equal(await fs.exists("data/default"), true);
  assert.equal(await fs.isDir("data/default"), true);
  assert.equal(await fs.isDir("data/default/a.csv"), false);
  assert.equal(await fs.exists("zzz"), false);
  await fs.mkdir("data/p1");
  await fs.mkdir("data/p1");
  assert.deepEqual((await fs.list("data")).sort(), ["default", "p1"]);
  assert.deepEqual(await fs.list("missing"), []);
  await fs.write("data/default/b.csv", "old");
  await fs.rename("data/default/a.csv", "data/default/b.csv");
  assert.equal(await fs.readText("data/default/b.csv"), "привет");
  await fs.rename("data/p1", "data/.deleted/p1-x");
  assert.equal(await fs.isDir("data/.deleted/p1-x"), true);
  await fs.remove("data/default/b.csv");
  await fs.remove("data/default/b.csv");
  await fs.rmrf("media/x");
  assert.equal(await fs.exists("media/x/img/p.jpg"), false);
  await fs.rmrf("log.bin");
  await fs.rmrf("never-existed");
  assert.equal(await fs.exists("log.bin"), false);
  assert.equal(fs.url("media/x/img/фото 1.jpg"), "https://localhost/_capacitor_file_/data/data/media/x/img/%D1%84%D0%BE%D1%82%D0%BE%201.jpg");
  assert.equal(await fs.nativeUri("media/x/img/p.jpg"), "file:///data/data/media/x/img/p.jpg");
});

test("memory storage: the same operations, used by tests and the browser demo", async () => {
  const fs = memFS();
  await fs.write("a/b/c.txt", "x");
  await fs.append("a/b/c.txt", "y");
  await fs.append("a/b/d.bin", new Uint8Array([5]));
  assert.equal(await fs.readText("a/b/c.txt"), "xy");
  assert.equal(await fs.readText("nope"), null);
  assert.deepEqual((await fs.list("a/b")).sort(), ["c.txt", "d.bin"]);
  await fs.rename("a/b", "z");
  assert.deepEqual((await fs.list("z")).sort(), ["c.txt", "d.bin"]);
  await fs.rename("z/c.txt", "y/c.txt");
  assert.equal(await fs.readText("y/c.txt"), "xy");
  await fs.remove("y/c.txt");
  assert.equal(await fs.exists("y/c.txt"), false);
  assert.equal(fs.url("nope"), "");
  assert.equal(await fs.nativeUri("x"), null);
  globalThis.URL.createObjectURL ??= () => "blob:x";
  assert.match(fs.url("z/d.bin"), /^blob:/);
});
