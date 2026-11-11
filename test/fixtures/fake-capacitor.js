"use strict";
(function () {
  const files = new Map(), dirs = new Set();
  const calls = [];
  const rec = (name, arg) => { calls.push([name, arg === undefined ? null : JSON.parse(JSON.stringify(arg, (k, v) => (v instanceof Uint8Array ? "[bytes]" : v)))]); };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const full = (o) => (o.path.startsWith("file://") ? o.path.slice(7) : `/fake/${(o.directory || "DATA").toLowerCase()}/${o.path}`).replace(/\/+$/, "");
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const mk = (p) => { const parts = p.split("/"); for (let i = 2; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/")); };
  const fail = (m) => Promise.reject(Object.assign(new Error(m), { code: "OS-PLUG-FILE-0008" }));
  const blobs = new Map();
  const listeners = {};
  const prefs = new Map();
  const H = (window.__cap = { calls, files, prefs, listeners, ocr: null, receiptLines: [], picked: [], cloud: window.gasFakeCloud(), user: "me@example.com", capturePath: "", authFails: 0, shared: [],
    fire(name, ev) { for (const f of listeners[name] || []) f(ev); },
    put(path, bytes) { mk(parent(path)); files.set(path, bytes); },
  });

  const Filesystem = {
    async getUri(o) { return { uri: "file://" + full(o) }; },
    async stat(o) { const p = full(o); if (files.has(p)) return { type: "file", size: files.get(p).length }; if (dirs.has(p)) return { type: "directory" }; return fail("no such file"); },
    async readFile(o) { const p = full(o), v = files.get(p); if (!v) return fail("missing " + p); return { data: o.encoding === "utf8" ? dec.decode(v) : b64(v) }; },
    async writeFile(o) { const p = full(o); mk(parent(p)); files.set(p, o.encoding === "utf8" ? enc.encode(o.data) : unb64(o.data)); return { uri: "file://" + p }; },
    async appendFile(o) { const p = full(o), old = files.get(p) || new Uint8Array(0), add = o.encoding === "utf8" ? enc.encode(o.data) : unb64(o.data); const n = new Uint8Array(old.length + add.length); n.set(old); n.set(add, old.length); files.set(p, n); },
    async mkdir(o) { mk(full(o)); },
    async readdir(o) {
      const p = full(o), pre = p + "/", out = new Set();
      if (!dirs.has(p)) return fail("no dir");
      for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre)) out.add(k.slice(pre.length).split("/")[0]);
      return { files: [...out].filter(Boolean).map((name) => ({ name })) };
    },
    async rename(o) {
      const a = full({ path: o.from, directory: o.directory }), b = full({ path: o.to, directory: o.toDirectory || o.directory });
      if (files.has(a)) { mk(parent(b)); files.set(b, files.get(a)); files.delete(a); return; }
      for (const k of [...files.keys()]) if (k.startsWith(a + "/")) { mk(parent(b + k.slice(a.length))); files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      for (const k of [...dirs]) if (k === a || k.startsWith(a + "/")) { dirs.delete(k); dirs.add(b + k.slice(a.length)); }
    },
    async deleteFile(o) { if (!files.delete(full(o))) return fail("missing"); },
    async rmdir(o) { const a = full(o); for (const k of [...files.keys()]) if (k.startsWith(a + "/")) files.delete(k); for (const k of [...dirs]) if (k === a || k.startsWith(a + "/")) dirs.delete(k); },
  };

  const plugin = (name, impl) => new Proxy(impl, { get: (o, k) => (k in o ? (...a) => { rec(name + "." + k, a[0]); return o[k](...a); } : undefined) });
  const addListener = (name) => async (ev, fn) => { (listeners[name + ":" + ev] ||= []).push(fn); return { remove() {} }; };
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc(u) {
      const p = u.replace(/^file:\/\//, "").split("/").map(decodeURIComponent).join("/");
      const v = files.get(p);
      if (!v) return "";
      const key = p + ":" + v.length;
      if (!blobs.has(key)) blobs.set(key, URL.createObjectURL(new Blob([v])));
      return blobs.get(key);
    },
    Plugins: {
      Filesystem,
      Preferences: plugin("Preferences", { async get({ key }) { return { value: prefs.has(key) ? prefs.get(key) : null }; }, async set({ key, value }) { prefs.set(key, value); } }),
      LocalNotifications: plugin("LocalNotifications", {
        async checkPermissions() { return { display: "prompt" }; }, async requestPermissions() { return { display: "granted" }; },
        async createChannel() {}, async schedule() {}, async cancel() {}, addListener: addListener("LN"),
      }),
      Share: plugin("Share", { async share() { if (H.shareCancel) throw new Error("Share canceled"); } }),
      SystemBars: plugin("SystemBars", { async setStyle() {} }),
      App: plugin("App", { addListener: addListener("App"), async getLaunchUrl() { return { url: H.launchUrl || "" }; }, async minimizeApp() {} }),
      GasNative: plugin("GasNative", {
        addListener: addListener("GasNative"),
        async takeShared() { if (H.sharedBroken) throw new Error("no inbox"); const files = H.shared; H.shared = []; return { files }; },
        async updateWidget() {}, async getLanguage() { return { lang: "" }; }, async setLanguage() {},
        async recognizeText({ path }) {
          if (/\/receipt\//.test(path)) return { width: 100, height: 100, lines: H.receiptLines.map((text) => ({ text, box: [0, 0, 1, 1] })) };
          if (!H.ocr) throw new Error("no text");
          return H.ocr;
        },
        async capture() { if (H.captureBroken) throw Object.assign(new Error("NO_CAMERA"), { code: "NO_CAMERA" }); if (!H.capturePath) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" }); return { path: "file://" + H.capturePath }; },
        async systemColors() { return { ok: true, light: "#3355AA", dark: "#AABBFF", lightSeries: "#227744", darkSeries: "#88DDAA" }; },
      }),
      GasDrive: plugin("GasDrive", {
        async authorize() { if (H.authFails) { H.authFails--; throw Object.assign(new Error("Google access needs confirmation"), { code: "NEED_CONSENT" }); } return { accessToken: "token" }; },
        async pick() { const ids = H.picked; H.cloud.pick(H.user, ids); return { accessToken: "token", picked: ids }; },
        async clearToken() {},
      }),
      GasFolder: plugin("GasFolder", {
        async pick() { return { uri: "content://tree/backups", name: "Backups" }; }, async info() { return { ok: true, name: "Backups" }; },
        async release() {}, async schedule() {},
        async run() { if (H.archNoAccess) throw Object.assign(new Error("No access to the folder"), { code: "NO_ACCESS" }); if (H.archFail) throw new Error("disk full"); const st = { time: Date.now(), last: {}, sig: {} }; prefs.set("gas-archive-state", JSON.stringify(st)); return { saved: 2, time: st.time }; },
      }),
    },
  };
  const real = window.gasSync.driveClient;
  window.gasSync.driveClient = (o) => {
    H.realDrive = real(o);
    const c = H.cloud.client(H.user);
    const w = {};
    for (const k of Object.keys(c)) w[k] = async (...a) => { await o.token(H.expireOnce ? !(H.expireOnce = false) : false); return H.cloud.client(H.user)[k].apply(w, a); };
    w.about = async () => { await o.token(false); return { email: H.user }; };
    return w;
  };
})();
