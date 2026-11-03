"use strict";
(function (root) {
  const enc = new TextEncoder(), dec = new TextDecoder();

  function bytesToB64(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(s) {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const parentOf = (p) => p.split("/").slice(0, -1).join("/");

  function memFS() {
    const files = new Map(), dirs = new Set([""]);
    const mkdirs = (p) => { const parts = p.split("/").filter(Boolean); for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/")); };
    const under = (p, k) => k === p || k.startsWith(p + "/");
    return {
      kind: "memory",
      async read(p) { const v = files.get(p); return v ? v.slice() : null; },
      async readText(p) { const v = files.get(p); return v ? dec.decode(v) : null; },
      async write(p, data) { mkdirs(parentOf(p)); files.set(p, typeof data === "string" ? enc.encode(data) : new Uint8Array(data)); },
      async exists(p) { return files.has(p) || dirs.has(p); },
      async isDir(p) { return dirs.has(p); },
      async mkdir(p) { mkdirs(p); },
      async list(p) {
        const out = new Set(), pre = p ? p + "/" : "";
        for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== p) out.add(k.slice(pre.length).split("/")[0]);
        return [...out].filter(Boolean);
      },
      async rename(a, b) {
        if (files.has(a)) { mkdirs(parentOf(b)); files.set(b, files.get(a)); files.delete(a); return; }
        for (const k of [...files.keys()]) if (under(a, k)) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
        for (const k of [...dirs]) if (under(a, k)) { dirs.delete(k); mkdirs(b + k.slice(a.length)); }
        mkdirs(b);
      },
      async remove(p) { files.delete(p); },
      async rmrf(p) { for (const k of [...files.keys()]) if (under(p, k)) files.delete(k); for (const k of [...dirs]) if (under(p, k)) dirs.delete(k); },
      async append(p, data) { const old = files.get(p) || new Uint8Array(0), add = typeof data === "string" ? enc.encode(data) : data, n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); mkdirs(parentOf(p)); files.set(p, n); },
      url(p) { const v = files.get(p); return v ? URL.createObjectURL(new Blob([v])) : ""; },
      async nativeUri(p) { return null; },
    };
  }

  async function capFS(Filesystem, Capacitor, D = "DATA") {
    const base = (await Filesystem.getUri({ path: "", directory: D })).uri.replace(/\/$/, "");
    const stat = async (p) => { try { return await Filesystem.stat({ path: p, directory: D }); } catch { return null; } };
    const fs = {
      kind: "device",
      async read(p) {
        try { const r = await Filesystem.readFile({ path: p, directory: D }); return typeof r.data === "string" ? b64ToBytes(r.data) : new Uint8Array(await r.data.arrayBuffer()); }
        catch { return null; }
      },
      async readText(p) {
        try { const r = await Filesystem.readFile({ path: p, directory: D, encoding: "utf8" }); return typeof r.data === "string" ? r.data : await r.data.text(); }
        catch { return null; }
      },
      async write(p, data) {
        if (typeof data === "string") await Filesystem.writeFile({ path: p, directory: D, data, encoding: "utf8", recursive: true });
        else await Filesystem.writeFile({ path: p, directory: D, data: bytesToB64(data), recursive: true });
      },
      async append(p, data) {
        if (typeof data === "string") await Filesystem.appendFile({ path: p, directory: D, data, encoding: "utf8" });
        else await Filesystem.appendFile({ path: p, directory: D, data: bytesToB64(data) });
      },
      async exists(p) { return !!(await stat(p)); },
      async isDir(p) { const s = await stat(p); return !!s && s.type === "directory"; },
      async mkdir(p) { if (!(await stat(p))) await Filesystem.mkdir({ path: p, directory: D, recursive: true }); },
      async list(p) { try { return (await Filesystem.readdir({ path: p, directory: D })).files.map((f) => (typeof f === "string" ? f : f.name)); } catch { return []; } },
      async rename(a, b) {
        const pb = parentOf(b);
        if (pb) await fs.mkdir(pb);
        if (await stat(b)) await fs.rmrf(b);
        await Filesystem.rename({ from: a, to: b, directory: D, toDirectory: D });
      },
      async remove(p) { try { await Filesystem.deleteFile({ path: p, directory: D }); } catch {} },
      async rmrf(p) {
        const s = await stat(p);
        if (!s) return;
        if (s.type === "directory") await Filesystem.rmdir({ path: p, directory: D, recursive: true });
        else await Filesystem.deleteFile({ path: p, directory: D });
      },
      url(p) { return Capacitor.convertFileSrc(base + "/" + p.split("/").map(encodeURIComponent).join("/")); },
      async nativeUri(p) { return base + "/" + p; },
    };
    return fs;
  }

  root.gasStorage = { memFS, capFS, bytesToB64, b64ToBytes };
})(typeof window !== "undefined" ? window : globalThis);
