"use strict";
(function (root) {
  const FORMAT = "gazgolder-sync";
  const VERSION = 1;
  const DATA_MIME = "application/json";
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const FIELDS = "id,name,version,trashed,parents,appProperties,mimeType,ownedByMe";
  const ROOT_NAME = "Gazgolder";
  const DATA_PREFIX = "Gazgolder — ";
  const TABLES = ["gas_levels.csv", "refuels.csv", "settings.json", "passport.json", "suppliers.json"];
  const REL = /^(img|passport)\/[^/]+\.(jpe?g|png)$/i;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function pick3(b, l, r) {
    if (eq(l, r)) return l;
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
    return l !== undefined ? l : r;
  }
  function mergeKeyed(b = [], l = [], r = [], key) {
    const mb = new Map(b.map((x) => [x[key], x])), ml = new Map(l.map((x) => [x[key], x])), mr = new Map(r.map((x) => [x[key], x]));
    const keys = [...new Set([...ml.keys(), ...mr.keys(), ...mb.keys()])];
    const out = [];
    for (const k of keys) { const v = pick3(mb.get(k), ml.get(k), mr.get(k)); if (v !== undefined) out.push(v); }
    return out;
  }
  function merge3(base, local, remote) {
    const settings = {};
    for (const k of new Set([...Object.keys(local.settings), ...Object.keys(remote.settings)])) {
      const v = pick3(base.settings[k], local.settings[k], remote.settings[k]);
      if (v !== undefined) settings[k] = v;
    }
    const bp = base.passport, lp = local.passport, rp = remote.passport;
    return {
      readings: mergeKeyed(base.readings, local.readings, remote.readings, "id"),
      refuels: mergeKeyed(base.refuels, local.refuels, remote.refuels, "id"),
      suppliers: mergeKeyed(base.suppliers, local.suppliers, remote.suppliers, "id"),
      settings,
      passport: { params: pick3(bp.params, lp.params, rp.params), text: pick3(bp.text, lp.text, rp.text), photos: mergeKeyed(bp.photos, lp.photos, rp.photos, "file") },
    };
  }
  const low = (s) => String(s || "").trim().toLowerCase();
  function mergeSet(b, l, r) {
    const B = new Set(b), L = new Set(l), R = new Set(r), out = [];
    for (const x of new Set([...B, ...L, ...R])) if (pick3(B.has(x), L.has(x), R.has(x))) out.push(x);
    return out.sort();
  }
  const sameTexts =(a, b) => !!a && !!b && TABLES.every((f) => a[f] === b[f]);
  const cleanFile = (s) => String(s || "").replace(/[\\/]/g, "_");
  const dataFileName = (name, prefix = DATA_PREFIX) => prefix + cleanFile(name) + ".json";
  const nameFromFile = (n) => String(n || "").replace(/\.json$/i, "").replace(/^[^—]*—\s*/, "").trim().slice(0, 60) || ROOT_NAME;
  const qs = (o) => Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  function parseRemote(bytes) {
    let d;
    try { d = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, "")); } catch { throw new Error("Файл синхронизации повреждён"); }
    if (!d || d.format !== FORMAT || typeof d.tables !== "object" || !d.tables) throw new Error("Это не файл синхронизации «Газгольдера»");
    if (+d.version > VERSION) throw new Error("Файл записан более новой версией приложения — обновите приложение");
    const tables = {};
    for (const f of TABLES) if (typeof d.tables[f] === "string") tables[f] = d.tables[f];
    const photos = {};
    for (const [rel, m] of Object.entries(d.photos && typeof d.photos === "object" ? d.photos : {}))
      if (REL.test(rel) && m && typeof m.id === "string" && /^[\w-]{10,200}$/.test(m.id)) photos[rel] = { id: m.id };
    const members = (Array.isArray(d.members) ? d.members : []).filter((x) => typeof x === "string" && EMAIL.test(x)).map((x) => x.toLowerCase());
    return { name: typeof d.name === "string" ? d.name.slice(0, 60) : "", tables, photos, members, owner: typeof d.owner === "string" ? d.owner : "" };
  }

  class DriveError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

  function driveClient({ token, fetchFn }) {
    const doFetch = fetchFn || ((...a) => fetch(...a));
    async function req(method, url, { body, headers = {}, raw = false } = {}, retry = true) {
      const t = await token(false);
      let res;
      try { res = await doFetch(url, { method, body, headers: { Authorization: "Bearer " + t, ...headers } }); }
      catch (e) { throw new DriveError(0, "Нет связи с Google Диском"); }
      if (res.status === 401 && retry) { await token(true); return req(method, url, { body, headers, raw }, false); }
      if (!res.ok) {
        let msg = "";
        try { const j = await res.json(); msg = (j.error && j.error.message) || ""; } catch {}
        throw new DriveError(res.status, msg || "Google Диск: ошибка " + res.status);
      }
      if (raw) return new Uint8Array(await res.arrayBuffer());
      if (res.status === 204) return null;
      return res.json();
    }
    const json = (o) => ({ body: JSON.stringify(o), headers: { "Content-Type": "application/json; charset=UTF-8" } });
    function multipart(meta, bytes, mime) {
      const b = "gazgolder" + Math.random().toString(36).slice(2);
      const head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`;
      return { body: new Blob([head, bytes, `\r\n--${b}--`]), headers: { "Content-Type": `multipart/related; boundary=${b}` } };
    }
    return {
      about: () => req("GET", `${API}/about?fields=user(emailAddress)`).then((r) => ({ email: (r.user && r.user.emailAddress) || "" })),
      get: (id) => req("GET", `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`),
      download: (id) => req("GET", `${API}/files/${encodeURIComponent(id)}?alt=media`, { raw: true }),
      async list(q) {
        const out = [];
        let pageToken = null;
        do {
          const r = await req("GET", `${API}/files?${qs({ q, fields: `nextPageToken,files(${FIELDS})`, pageSize: 200, spaces: "drive", pageToken })}`);
          out.push(...(r.files || []));
          pageToken = r.nextPageToken || null;
        } while (pageToken);
        return out;
      },
      createFolder: (name, parent, appProperties) => req("POST", `${API}/files?fields=${FIELDS}`, json({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined, appProperties })),
      create: (meta, bytes, mime) => req("POST", `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, multipart(meta, bytes, mime)),
      update: (id, meta, bytes, mime) => req("PATCH", `${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}`, multipart(meta, bytes, mime)),
      share: (id, email, { notify = true, message = "", role = "writer" } = {}) =>
        req("POST", `${API}/files/${encodeURIComponent(id)}/permissions?${qs({ sendNotificationEmail: notify, emailMessage: notify && message ? message : null, fields: "id,emailAddress,role" })}`, json({ type: "user", role, emailAddress: email })),
      permissions: (id) => req("GET", `${API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,emailAddress,role,type)`).then((r) => r.permissions || []),
      rename: (id, name) => req("PATCH", `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}`, json({ name })),
      unshare: (id, permId) => req("DELETE", `${API}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permId)}`),
    };
  }

  function createSync({ backend, fs, drive, now = () => Date.now(), photosAllowed = () => true, shareMessage = () => "",
    rootName = ROOT_NAME, dataPrefix = DATA_PREFIX, displayName = (n) => n }) {
    const fileName = (name) => dataFileName(displayName(name), dataPrefix);
    const S = backend.sync;
    const EMPTY = S.textsOf(S.snapOf({}));
    const DIR = "data/.sync";
    const CFG = DIR + "/config.json";
    const DEFAULT_CFG = { enabled: false, account: "", rootId: "", photos: true, wifiOnly: true, ignored: [], excluded: {}, last: 0, error: "" };

    async function readJSON(p) { const t = await fs.readText(p); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } }
    const chains = new Map();
    function serial(key, fn) { const r = (chains.get(key) || Promise.resolve()).then(fn); chains.set(key, r.catch(() => {})); return r; }
    const writeJSON = (p, o) => serial(p, async () => { await fs.mkdir(DIR); await fs.write(p + ".tmp", JSON.stringify(o)); await fs.rename(p + ".tmp", p); });
    const statePath = (pid) => `${DIR}/${pid}.json`;
    const loadConfig = async () => ({ ...DEFAULT_CFG, ...((await readJSON(CFG)) || {}) });
    const updateConfig = (fn) => serial("config", async () => { const c = await loadConfig(); await fn(c); await writeJSON(CFG, c); return c; });
    const saveConfig = (c) => updateConfig((x) => { Object.assign(x, c); });
    const addIgnored = (ids) => updateConfig((c) => { for (const id of ids) if (id && !c.ignored.includes(id)) c.ignored.push(id); });
    const loadState = (pid) => readJSON(statePath(pid));
    const saveState = (pid, st) => writeJSON(statePath(pid), st);
    async function states() {
      const out = {};
      for (const n of await fs.list(DIR)) {
        const m = /^([a-z0-9_-]{1,40})\.json$/.exec(n);
        if (m && m[1] !== "config") { const st = await readJSON(`${DIR}/${n}`); if (st && st.fileId) out[m[1]] = st; }
      }
      return out;
    }

    async function ensureRoot(cfg) {
      if (cfg.rootId) {
        try { const m = await drive.get(cfg.rootId); if (!m.trashed) return cfg.rootId; } catch (e) { if (e.status !== 404) throw e; }
      }
      const found = (await drive.list(`mimeType='${FOLDER_MIME}' and appProperties has { key='gazgolder' and value='root' } and trashed=false`)).find((f) => f.ownedByMe !== false);
      const rootId = (cfg.rootId = found ? found.id : (await drive.createFolder(rootName, null, { gazgolder: "root" })).id);
      await updateConfig((c) => { c.rootId = rootId; });
      return cfg.rootId;
    }
    const body = (o) => new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: VERSION, app: "io.rav.gazgolder", ...o }));

    async function createRemote(cfg, pid, name) {
      const rootId = await ensureRoot(cfg);
      const folder = await drive.createFolder(cleanFile(displayName(name)), rootId, { gazgolder: "tank" });
      const f = await drive.create({ name: fileName(name), parents: [folder.id], appProperties: { gazgolder: "data", pid }, mimeType: DATA_MIME },
        body({ name, owner: cfg.account, members: [], updated: new Date(now()).toISOString(), tables: EMPTY, photos: {} }), DATA_MIME);
      return { fileId: f.id, folderId: folder.id, version: f.version, base: EMPTY, name, photos: {}, members: [], owner: cfg.account, pending: {}, needAccess: [] };
    }
    const linkState = (meta) => ({ fileId: meta.id, folderId: (meta.parents && meta.parents[0]) || "", version: null, base: null, photos: {}, members: [], pending: {}, needAccess: [] });

    async function uploadPhoto(cfg, st, rel, data) {
      const [kind, name] = rel.split("/");
      const meta = { name, appProperties: { gazgolder: "photo", kind }, mimeType: /\.png$/i.test(name) ? "image/png" : "image/jpeg" };
      if (st.folderId) {
        try { return await drive.create({ ...meta, parents: [st.folderId] }, data, meta.mimeType); }
        catch (e) { if (e.status !== 403 && e.status !== 404) throw e; }
      }
      const f = await drive.create({ ...meta, parents: [await ensureRoot(cfg)] }, data, meta.mimeType);
      if (!st.mineTo) st.mineTo = others(cfg, st, st.members || []);
      for (const email of st.mineTo) await drive.share(f.id, email, { notify: false, role: "reader" }).catch(() => {});
      st.mine = [...(st.mine || []), f.id];
      return f;
    }
    const isOwner = (cfg, st) => st.ownedByMe === true || (!!st.owner && low(st.owner) === low(cfg.account));
    const others = (cfg, st, members) => [...new Set([low(st.owner), ...members])].filter((e) => e && e !== low(cfg.account)).sort();

    async function revoke(id, emails) {
      if (!id || !emails.length) return;
      let perms = [];
      try { perms = await drive.permissions(id); } catch { return; }
      for (const p of perms) if (emails.includes(low(p.emailAddress)) && p.role !== "owner") await drive.unshare(id, p.id).catch(() => {});
    }

    async function reconcile(cfg, st, members) {
      if (st.folderId && !eq(members, st.reconciled)) {
        const me = low(cfg.account);
        let fm = null;
        try { fm = await drive.get(st.folderId); } catch (e) { if (e.status !== 403 && e.status !== 404) throw e; }
        if (fm && fm.ownedByMe) {
          const perms = (await drive.permissions(st.folderId)).filter((p) => p.role !== "owner" && p.emailAddress);
          const has = new Set(perms.map((p) => low(p.emailAddress)));
          for (const e of members) if (e !== me && !has.has(e)) { await drive.share(st.folderId, e, { notify: false }); has.add(e); }
          members = [...has].filter((e) => e !== me).sort();
        }
        st.reconciled = members;
      }
      const everyone = others(cfg, st, members);
      if ((st.mine || []).length && !eq(everyone, st.mineTo)) {
        const done = new Set(st.mineTo || []);
        for (const e of everyone) if (!done.has(e)) for (const id of st.mine) await drive.share(id, e, { notify: false, role: "reader" }).catch(() => {});
        st.mineTo = everyone;
      }
      return members;
    }

    async function syncOnce(cfg, pid) {
      const st = await loadState(pid);
      if (!st || st.gone) return { skipped: true };
      const loc = await S.local(pid);
      let meta;
      try { meta = await drive.get(st.fileId); }
      catch (e) { if (e.status === 404) { st.gone = true; await saveState(pid, st); return { gone: true }; } throw e; }
      if (meta.trashed) { st.gone = true; await saveState(pid, st); return { gone: true }; }
      const remote = meta.version !== st.version || !st.base ? parseRemote(await drive.download(st.fileId)) : null;
      const base = st.base || EMPTY;
      const rTexts = remote ? { ...EMPTY, ...remote.tables } : base;
      const rName = remote ? remote.name || st.name : st.name;
      const merged = merge3(S.snapOf(base), S.snapOf(loc.texts), S.snapOf(rTexts));
      const name = pick3(st.name, loc.name, rName) || loc.name;
      let texts = S.textsOf(merged), localChanged = false;
      if (!sameTexts(texts, loc.texts) || name !== loc.name) {
        try { const r = await S.apply(pid, { texts, name }, loc.texts); localChanged = r.changed; texts = r.texts; }
        catch (e) { if (e.status === 409) e.retry = true; throw e; }
      }
      if (remote && remote.owner) st.owner = remote.owner;
      const baseM = st.baseMembers || [], remM = remote ? remote.members : baseM;
      st.ownedByMe = meta.ownedByMe === true;
      const members = (await reconcile(cfg, st, mergeSet(baseM, st.members || [], remM))).filter((e) => e !== low(st.owner));
      const manifest = { ...(remote ? remote.photos : st.photos || {}), ...(st.pending || {}) };
      const keepP = new Set(merged.passport.photos.map((p) => "passport/" + p.file));
      const wanted = (rel) => !rel.startsWith("passport/") || keepP.has(rel);
      let manifestChanged = Object.keys(st.pending || {}).length > 0;
      for (const rel of Object.keys(manifest)) if (!wanted(rel)) { delete manifest[rel]; manifestChanged = true; }
      const needAccess = new Set();
      if (cfg.photos && photosAllowed(cfg)) {
        const have = new Set(loc.photos);
        for (const rel of loc.photos) {
          if (manifest[rel] || !wanted(rel)) continue;
          const data = await S.readPhoto(pid, rel);
          if (!data) continue;
          const f = await uploadPhoto(cfg, st, rel, data);
          manifest[rel] = { id: f.id };
          st.pending = { ...(st.pending || {}), [rel]: { id: f.id } };
          await saveState(pid, st);
          manifestChanged = true;
        }
        for (const [rel, m] of Object.entries(manifest)) {
          if (have.has(rel)) continue;
          try { if (await S.writePhoto(pid, rel, await drive.download(m.id))) localChanged = true; }
          catch (e) { if (e.status === 403 || e.status === 404) needAccess.add(m.id); else throw e; }
        }
      }
      const needUpload = !sameTexts(texts, rTexts) || name !== rName || manifestChanged || !eq(members, [...remM].sort());
      let version = meta.version;
      if (needUpload) {
        const m2 = await drive.get(st.fileId);
        if (m2.version !== meta.version) { const e = new Error("Файл на Диске изменился во время синхронизации"); e.retry = true; throw e; }
        const up = await drive.update(st.fileId, { name: fileName(name) },
          body({ name, owner: st.owner || "", members, updated: new Date(now()).toISOString(), tables: texts, photos: manifest }), DATA_MIME);
        version = up.version;
      }
      const folderName = cleanFile(displayName(name));
      if (st.folderId && st.folderName !== folderName && isOwner(cfg, st)) {
        try {
          const fm = await drive.get(st.folderId);
          if (fm.ownedByMe && fm.name !== folderName) await drive.rename(st.folderId, folderName);
          st.folderName = folderName;
        } catch (e) { if (e.status !== 403 && e.status !== 404) throw e; }
      }
      Object.assign(st, { version, base: texts, name, photos: manifest, members, baseMembers: members, pending: {}, needAccess: [...needAccess], error: "", synced: now() });
      await saveState(pid, st);
      return { localChanged, uploaded: needUpload, needAccess: st.needAccess.length };
    }

    async function syncProfile(cfg, pid) {
      for (let attempt = 0; ; attempt++) {
        try { return await syncOnce(cfg, pid); }
        catch (e) { if (!e.retry || attempt >= 2) throw e; }
      }
    }

    let running = null;
    function syncAll() {
      if (running) return running;
      running = (async () => {
        const cfg = await loadConfig();
        if (!cfg.enabled) return { off: true };
        const res = { changed: [], created: [], errors: {}, needAccess: 0 };
        try {
          const profiles = await backend.loadProfiles();
          const sts = await states();
          const goneEx = Object.keys(cfg.excluded).filter((pid) => !profiles.some((p) => p.id === pid)), dropped = [];
          for (const pid of goneEx) delete cfg.excluded[pid];
          for (const pid of Object.keys(sts)) {
            if (profiles.some((p) => p.id === pid)) continue;
            dropped.push(sts[pid].fileId);
            if (!cfg.ignored.includes(sts[pid].fileId)) cfg.ignored.push(sts[pid].fileId);
            await fs.remove(statePath(pid));
            delete sts[pid];
          }
          if (goneEx.length || dropped.length) await updateConfig((c) => { for (const pid of goneEx) delete c.excluded[pid]; for (const id of dropped) if (!c.ignored.includes(id)) c.ignored.push(id); });
          const linked = new Set(Object.values(sts).map((s) => s.fileId));
          const free = (await drive.list(`appProperties has { key='gazgolder' and value='data' } and trashed=false`))
            .filter((r) => !linked.has(r.id) && !cfg.ignored.includes(r.id));
          for (const p of profiles) {
            if (sts[p.id] || p.id in cfg.excluded) continue;
            const own = (r) => r.ownedByMe !== false;
            let i = p.id === "default" ? free.findIndex((r) => own(r) && r.appProperties && r.appProperties.pid === "default") : -1;
            if (i < 0) i = free.findIndex((r) => own(r) && [p.name, displayName(p.name)].includes(nameFromFile(r.name)));
            sts[p.id] = i >= 0 ? linkState(free.splice(i, 1)[0]) : await createRemote(cfg, p.id, p.name);
            await saveState(p.id, sts[p.id]);
          }
          for (const r of free) {
            const { id } = await S.createProfile(nameFromFile(r.name));
            sts[id] = linkState(r);
            await saveState(id, sts[id]);
            res.created.push(id);
          }
          for (const pid of Object.keys(sts)) {
            try {
              const r = await syncProfile(cfg, pid);
              if (r.localChanged) res.changed.push(pid);
              res.needAccess += r.needAccess || 0;
            } catch (e) {
              res.errors[pid] = e.message || String(e);
              const st = await loadState(pid);
              if (st) { st.error = res.errors[pid]; await saveState(pid, st); }
            }
          }
          cfg.last = now();
          cfg.error = Object.values(res.errors)[0] || "";
        } catch (e) {
          cfg.error = e.message || String(e);
          res.error = e;
          res.needConsent = e.code === "NEED_CONSENT";
        }
        await updateConfig((c) => { c.last = cfg.last; c.error = cfg.error; });
        return res;
      })().finally(() => { running = null; });
      return running;
    }

    async function join(fileIds) {
      const sts = await states(), linked = new Set(Object.values(sts).map((s) => s.fileId)), out = [], ids = [];
      for (const id of fileIds) {
        if (linked.has(id)) continue;
        const meta = await drive.get(id);
        if (meta.mimeType === FOLDER_MIME) continue;
        const remote = parseRemote(await drive.download(id));
        const { id: pid } = await S.createProfile(remote.name || nameFromFile(meta.name));
        await saveState(pid, linkState(meta));
        ids.push(id);
        out.push(pid);
      }
      if (ids.length) await updateConfig((c) => { c.ignored = c.ignored.filter((x) => !ids.includes(x)); });
      return out;
    }

    async function share(pid, email, { message } = {}) {
      email = String(email || "").trim().toLowerCase();
      if (!EMAIL.test(email)) throw new Error("Неверный адрес почты");
      const st = await loadState(pid);
      if (!st || st.gone) throw new Error("Эта ёмкость не синхронизируется с Google Диском");
      const cfg = await loadConfig();
      if (email === low(cfg.account)) throw new Error("Это ваш собственный адрес");
      if (email === low(st.owner) || (st.members || []).includes(email)) throw new Error("У этого человека уже есть доступ");
      let folder = null;
      if (st.folderId) { try { folder = await drive.get(st.folderId); } catch {} }
      const msg = message != null ? message : shareMessage(st);
      if (folder && folder.ownedByMe) {
        await drive.share(st.folderId, email, { notify: true, message: msg });
      } else {
        await drive.share(st.fileId, email, { notify: true, message: msg });
        for (const m of Object.values(st.photos || {})) await drive.share(m.id, email, { notify: false, role: "reader" }).catch(() => {});
      }
      st.members = [...new Set([...(st.members || []), email])].sort();
      await saveState(pid, st);
      return st.members;
    }

    async function unshare(pid, email) {
      email = low(email);
      const st = await loadState(pid);
      if (!st) return [];
      if (!isOwner(await loadConfig(), st)) throw new Error("Закрывать доступ может только владелец ёмкости");
      await revoke(st.folderId, [email]);
      await revoke(st.fileId, [email]);
      st.members = (st.members || []).filter((x) => x !== email);
      await saveState(pid, st);
      return st.members;
    }

    async function needAccess() {
      const ids = new Set();
      for (const st of Object.values(await states())) for (const id of st.needAccess || []) ids.add(id);
      return [...ids];
    }

    async function forget(pid, { ignore = true } = {}) {
      const st = await loadState(pid);
      if (!st) return;
      await fs.remove(statePath(pid));
      if (ignore) await addIgnored([st.fileId]);
    }

    const setExcluded = (pid, off) => updateConfig(async (cfg) => {
      if (off) {
        const st = await loadState(pid);
        cfg.excluded[pid] = st ? st.fileId : "";
        if (st) { await fs.remove(statePath(pid)); if (!cfg.ignored.includes(st.fileId)) cfg.ignored.push(st.fileId); }
      } else if (pid in cfg.excluded) {
        const fileId = cfg.excluded[pid];
        delete cfg.excluded[pid];
        if (fileId) {
          cfg.ignored = cfg.ignored.filter((x) => x !== fileId);
          try { const meta = await drive.get(fileId); if (!meta.trashed) await saveState(pid, linkState(meta)); } catch {}
        }
      }
    });

    const canManage = async (pid) => { const st = await loadState(pid); return !!st && isOwner(await loadConfig(), st); };

    return { loadConfig, saveConfig, updateConfig, loadState, states, syncAll, join, share, unshare, canManage, needAccess, forget, setExcluded, fileName };
  }

  root.gasSync = { createSync, driveClient, merge3, pick3, parseRemote, dataFileName, nameFromFile, FORMAT, DATA_MIME };
})(typeof window !== "undefined" ? window : globalThis);
