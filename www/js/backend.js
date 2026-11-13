"use strict";
(function (root) {
  const HEADER = ["дата", "время", "фото", "уровень_%", "примечание"];
  const REFUELS_HEADER = ["id", "дата", "литры", "цена_за_литр", "сумма", "примечание"];
  const SUPPLIERS_PATH = "data/suppliers.json";
  const SUPPLIER_FIELDS = { short: 40, full: 200, phone: 100, email: 100, messenger: 100, address: 200, note: 300 };
  const DEFAULT_SETTINGS = {
    volume: 4600, minPct: 20, maxPct: 85, minDelivery: 2000, leadDays: 14,
    heatOffFrom: 6, heatOffTo: 8, tDhw: 55, tHeat: 65, modes: [], monthThr: null,
  };
  const NON_NUMERIC = ["modes", "monthThr"];
  const MODES = ["both", "dhw", "heat", "off"];
  const MAX_UPLOAD = 40 * 1024 * 1024;
  const DEFAULT_PROFILE = { id: "default", name: "Основной" };
  const DATA_FILES = ["gas_levels.csv", "refuels.csv", "settings.json", "passport.json"];

  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const bad = (m) => new HttpError(400, m);
  const notFound = (m) => new HttpError(404, m);

  function csvParse(text) {
    text = String(text || "").replace(/^﻿/, "");
    const rows = [];
    let row = [], f = "", q = false, i = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"' && f === "") q = true;
      else if (c === ";") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => x !== ""));
  }
  const csvField = (v) => { const s = String(v ?? ""); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvText = (rows) => "﻿" + rows.map((r) => r.map(csvField).join(";") + "\r\n").join("");

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let idSeq = 0;
  const lt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cmpBy = (...keys) => (x, y) => { for (const k of keys) { const c = lt(x[k] ?? "", y[k] ?? ""); if (c) return c; } return 0; };

  function toFloat(v, what = "значение") {
    const n = typeof v === "number" ? v : typeof v === "boolean" ? +v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
    if (!Number.isFinite(n)) throw bad(`Неверное число: ${what}`);
    return n;
  }
  function numIn(s) {
    s = String(s ?? "").trim().replace(/[\s  ]/g, "").replace(",", ".");
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) throw bad(`Неверное число: «${s}»`);
    return n;
  }
  function numOut(v) {
    if (v == null) return "";
    v = Math.round(Number(v) * 100) / 100;
    return Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const oneLine = (v, n) => String(v ?? "").replace(/[\r\n]/g, " ").trim().slice(0, n);

  function safeName(name) {
    let n = String(name || "");
    try { n = decodeURIComponent(n); } catch {}
    n = n.split(/[\\/]/).pop();
    n = n.replace(/[^\p{L}\p{N}_.\-]/gu, "_");
    return n && !n.startsWith(".") ? n : null;
  }
  const stem = (n) => n.replace(/\.[^.]*$/, "");
  const ext = (n) => (/\.[^.]*$/.exec(n)?.[0] || "").toLowerCase();

  function parseDate(s, what = "дата") {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? "").trim());
    const d = m && new Date(+m[1], +m[2] - 1, +m[3]);
    if (!m || d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3]) throw bad(`Неверная ${what}: «${s ?? ""}»`);
    return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  }
  function parseTime(t) {
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
    if (!m || +m[1] > 23 || +m[2] > 59 || +(m[3] || 0) > 59) throw bad(`Неверное время: «${t}»`);
    return `${pad(+m[1])}:${pad(+m[2])}:${pad(+(m[3] || 0))}`;
  }
  function nameDateTime(name) {
    const s = stem(name);
    for (const rx of [/(?<!\d)(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)[-_. T]?(\d\d)[-_.:]?(\d\d)[-_.:]?(\d\d)/g, /(?<!\d)(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)(?!\d)/g]) {
      for (const m of s.matchAll(rx)) {
        const g = m.slice(1).map(Number), d = new Date(g[0], g[1] - 1, g[2]);
        if (d.getFullYear() !== g[0] || d.getMonth() !== g[1] - 1 || d.getDate() !== g[2]) continue;
        if (g.length > 3 && (g[3] > 23 || g[4] > 59 || g[5] > 59)) continue;
        return { date: `${g[0]}-${pad(g[1])}-${pad(g[2])}`, time: g.length > 3 ? `${pad(g[3])}:${pad(g[4])}:${pad(g[5])}` : "" };
      }
    }
    return { date: "", time: "" };
  }
  const isImage = (b) => b && b.length > 8 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));
  const sameBytes = (a, b) => { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

  function createBackend(fs, tools = {}) {
    const exifDateTime = tools.exifDateTime || (() => null);
    const thumbOf = tools.thumb || (async () => null);
    const verifyImage = tools.verify || (async () => true);

    let chain = Promise.resolve();
    const locked = (fn) => { const r = chain.then(fn); chain = r.catch(() => {}); return r; };

    async function writeAtomic(p, data) { await fs.write(p + ".tmp", data); await fs.rename(p + ".tmp", p); }
    async function readTextSafe(p) { const t = await fs.readText(p); return t != null ? t : fs.readText(p + ".tmp"); }
    async function readJSON(p) { const t = await readTextSafe(p); if (t == null) return null; try { return JSON.parse(t.replace(/^﻿/, "")); } catch { return null; } }
    const writeJSON = (p, obj) => writeAtomic(p, JSON.stringify(obj, null, 2));

    async function loadProfiles() {
      const d = await readJSON("data/profiles.json");
      const items = Array.isArray(d?.profiles) ? d.profiles : [];
      const def = items.find((p) => p?.id === "default") || {};
      const rest = [];
      for (const p of items) if (p && p.id != null && p.id !== "default" && (await fs.isDir("data/" + p.id))) rest.push(p);
      return [{ ...DEFAULT_PROFILE, ...def }, ...rest];
    }
    const saveProfiles = (items) => writeJSON("data/profiles.json", { profiles: items });
    function suppliersFrom(d) {
      const items = d && typeof d === "object" && Array.isArray(d.suppliers) ? d.suppliers : [];
      const out = [];
      for (const x of items) {
        if (!x || typeof x !== "object" || Array.isArray(x) || typeof x.id !== "string" || !x.id) continue;
        const row = { id: x.id };
        for (const k of Object.keys(SUPPLIER_FIELDS)) row[k] = typeof x[k] === "string" ? x[k] : "";
        out.push(row);
      }
      return out;
    }
    const loadSuppliers = async () => suppliersFrom(await readJSON(SUPPLIERS_PATH));
    const sortSuppliers = (items) => items.sort((a, b) => (a.short < b.short ? -1 : a.short > b.short ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const saveSuppliers = (items) => writeJSON(SUPPLIERS_PATH, { suppliers: sortSuppliers(items) });
    function cleanSupplier(b) {
      const out = {};
      for (const [k, n] of Object.entries(SUPPLIER_FIELDS)) {
        const v = b[k] ?? "";
        if (typeof v !== "string") throw bad(`Неверное поле поставщика: ${k}`);
        out[k] = v.replace(/\n/g, " ").trim().slice(0, n);
      }
      if (!out.short) throw bad("Укажите краткое название поставщика");
      return out;
    }
    async function supplierInUse(sid) {
      for (const pr of await loadProfiles()) {
        let P;
        try { P = await profilePaths(pr.id); } catch { continue; }
        if ((await loadRefuels(P)).some((r) => r.supplier === sid)) return true;
      }
      return false;
    }
    async function mergeSuppliers(list) {
      const have = await loadSuppliers(), ids = new Set(have.map((x) => x.id));
      const add = suppliersFrom({ suppliers: list }).filter((x) => !ids.has(x.id) && x.short);
      if (add.length) await saveSuppliers(have.concat(add));
    }

    async function profilePaths(pid) {
      pid = pid || "default";
      if (pid !== "default" && (!/^[a-z0-9_-]{1,40}$/.test(pid) || !(await fs.isDir("data/" + pid)))) throw notFound("Нет такого профиля");
      const d = "data/" + pid, m = "media/" + pid;
      return { id: pid, dir: d, media: m, csv: d + "/gas_levels.csv", refuels: d + "/refuels.csv", settings: d + "/settings.json",
        passport: d + "/passport.json", img: m + "/img", pimg: m + "/passport", thumbs: m + "/.thumbs", pthumbs: m + "/.thumbs/passport" };
    }
    function cleanName(name) {
      name = String(name ?? "").replace(/\n/g, " ").trim().slice(0, 60);
      if (!name) throw bad("Укажите название ёмкости");
      return name;
    }

    function cleanModes(items) {
      if (!Array.isArray(items)) throw bad("Неверный журнал режимов");
      const out = {};
      for (const it of items) {
        let d;
        try { d = parseDate(it?.date); } catch { throw bad("Неверная дата в журнале режимов"); }
        if (!MODES.includes(it.mode)) throw bad("Неизвестный режим котла");
        const rec = { date: d, mode: it.mode };
        for (const k of ["tDhw", "tHeat"]) {
          if (it[k] != null && it[k] !== "") {
            rec[k] = toFloat(it[k], "температура");
            if (!(rec[k] >= 20 && rec[k] <= 95)) throw bad("Температура должна быть от 20 до 95 °C");
          }
        }
        out[d] = rec;
      }
      return Object.keys(out).sort().map((k) => out[k]);
    }
    function cleanThr(t) {
      if (t == null || t === "") return null;
      const v = toFloat(t.v, "порог");
      if (!(v > 0)) throw bad("Порог должен быть больше нуля");
      if (!["l", "pct"].includes(t.unit) || !["day", "week", "month"].includes(t.per)) throw bad("Неверные единицы порога");
      return { v, unit: t.unit, per: t.per };
    }
    const loadSettings = async (P) => settingsFrom(await readJSON(P.settings));
    function settingsFrom(saved) {
      const out = structuredClone(DEFAULT_SETTINGS);
      if (saved && typeof saved === "object") for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in saved) out[k] = saved[k];
      return out;
    }
    function validateSettings(n) {
      for (const k of ["heatOffFrom", "heatOffTo"]) {
        n[k] = Math.trunc(n[k]);
        if (!(n[k] >= 1 && n[k] <= 12)) throw bad("Месяц должен быть от 1 до 12");
      }
      if (!(n.tDhw >= 20 && n.tDhw <= 95 && n.tHeat >= 20 && n.tHeat <= 95)) throw bad("Температуры ГВС и подачи — от 20 до 95 °C");
      if (!(n.volume > 0 && n.minPct >= 0 && n.minPct < n.maxPct && n.maxPct <= 100)) throw bad("Проверьте значения: объём > 0, 0 ≤ мин < макс ≤ 100");
      if (!(n.minDelivery >= 0 && n.minDelivery <= n.volume)) throw bad("Мин. доставка должна быть от 0 до объёма ёмкости");
      if (!(n.leadDays >= 0 && n.leadDays <= 180)) throw bad("Запас на доставку — от 0 до 180 дней");
      return n;
    }

    const emptyPassport = () => ({ params: [], text: "", photos: [] });
    const loadPassport = async (P) => passportFrom(await readJSON(P.passport));
    function passportFrom(d) {
      if (!d || typeof d !== "object") return emptyPassport();
      return {
        params: (Array.isArray(d.params) ? d.params : []).filter((x) => x && typeof x === "object").map((x) => ({ k: oneLine(x.k, 80), v: oneLine(x.v, 300) })),
        text: String(d.text || "").slice(0, 10000),
        photos: (Array.isArray(d.photos) ? d.photos : []).filter((x) => x && typeof x === "object" && x.file && safeName(x.file) === x.file)
          .map((x) => ({ file: x.file, caption: oneLine(x.caption, 200) })),
      };
    }
    function cleanPassport(b, old) {
      const n = { ...old };
      if ("params" in b) {
        const params = [], seen = new Set();
        for (const x of b.params || []) {
          const k = oneLine(x?.k, 80), v = oneLine(x?.v, 300);
          if (k && v && !seen.has(k)) { seen.add(k); params.push({ k, v }); }
        }
        n.params = params;
      }
      if ("text" in b) n.text = String(b.text ?? "").replace(/\r\n/g, "\n").trim().slice(0, 10000);
      if ("photos" in b) {
        const caps = new Map((b.photos || []).filter((x) => x && typeof x === "object").map((x) => [x.file, oneLine(x.caption, 200)]));
        n.photos = old.photos.map((p) => ({ file: p.file, caption: caps.has(p.file) ? caps.get(p.file) : p.caption }));
      }
      return n;
    }

    const readingRow = (date, time, file, level, note) => ({ id: file || `manual:${date}T${time}`, date, time, file, level, note });
    function parseReadings(t) {
      if (t == null) return [];
      return csvParse(t).slice(1).map((r) => {
        r = r.concat(["", "", "", "", ""]).slice(0, 5);
        const lv = r[3].trim() ? Number(r[3].replace(",", ".")) : null;
        return readingRow(r[0], r[1], r[2], Number.isFinite(lv) ? lv : null, r[4]);
      });
    }
    function readingsText(rows) {
      rows.sort(cmpBy("date", "time", "file"));
      return csvText([HEADER, ...rows.map((r) => [r.date, r.time, r.file, r.level == null ? "" : String(r.level), r.note || ""])]);
    }
    const loadReadings = async (P) => parseReadings(await readTextSafe(P.csv));
    const saveReadings = (P, rows) => writeAtomic(P.csv, readingsText(rows));
    function parseRefuels(t) {
      if (t == null) return [];
      return csvParse(t).slice(1).map((r) => {
        r = r.concat(["", "", "", "", "", "", ""]).slice(0, 7);
        const n = (s) => { try { return numIn(s); } catch { return null; } };
        return { id: r[0], date: r[1], liters: n(r[2]), price: n(r[3]), total: n(r[4]), note: r[5], supplier: r[6] };
      });
    }
    function refuelsText(items) {
      items.sort(cmpBy("date", "id"));
      const sup = items.some((r) => r.supplier);
      return csvText([sup ? [...REFUELS_HEADER, "поставщик"] : REFUELS_HEADER,
        ...items.map((r) => [r.id, r.date, numOut(r.liters), numOut(r.price), numOut(r.total), r.note || "", ...(sup ? [r.supplier || ""] : [])])]);
    }
    const loadRefuels = async (P) => parseRefuels(await readTextSafe(P.refuels));
    const saveRefuels = (P, items) => writeAtomic(P.refuels, refuelsText(items));

    async function makeThumb(tdir, folder, name) {
      const t = `${tdir}/${stem(name)}.jpg`;
      if (await fs.exists(t)) return;
      const data = await fs.read(`${folder}/${name}`);
      if (!data) return;
      const th = await thumbOf(data).catch(() => null);
      await fs.write(t, th || data);
    }
    async function storeImage(folder, name, data) {
      await fs.mkdir(folder);
      let target = name;
      if ((await fs.exists(`${folder}/${name}`)) && !sameBytes(await fs.read(`${folder}/${name}`), data)) {
        let i = 2;
        while (await fs.exists(`${folder}/${stem(name)}_${i}${/\.[^.]*$/.exec(name)?.[0] || ""}`)) i++;
        target = `${stem(name)}_${i}${/\.[^.]*$/.exec(name)?.[0] || ""}`;
      }
      if (!(await fs.exists(`${folder}/${target}`))) await fs.write(`${folder}/${target}`, data);
      return target;
    }
    async function readImageBody(q, body) {
      const name = safeName(q.get("name"));
      if (!name || ![".jpg", ".jpeg", ".png"].includes(ext(name))) throw bad("Нужен файл .jpg или .png");
      const data = await toBytes(body);
      if (data.length > MAX_UPLOAD) throw bad("Файл больше 40 МБ");
      if (!isImage(data)) throw bad("Не удалось прочитать изображение: это не JPEG и не PNG");
      try { await verifyImage(data); } catch (e) { throw bad("Не удалось прочитать изображение: " + (e.message || e)); }
      return { name, data };
    }

    async function route(method, url, body) {
      const q = url.searchParams, path = url.pathname;
      const json = () => { try { return JSON.parse(typeof body === "string" ? body || "{}" : "{}"); } catch { throw bad("Неверный JSON"); } };
      const P = () => profilePaths(q.get("p") || "");

      if (path === "/api/profiles/main" && method === "POST") {
        const pid = String(json().id ?? "");
        if (!pid) throw notFound("Нет такого профиля");
        if (pid === "default") throw bad("Эта ёмкость уже основная");
        const a = await profilePaths("default"), b = await profilePaths(pid), tmp = "swap-" + stamp();
        const swap = async (x, y) => {
          const hx = await fs.exists(x), hy = await fs.exists(y);
          if (hx) await fs.rename(x, `${x}.${tmp}`);
          if (hy) await fs.rename(y, x);
          if (hx) await fs.rename(`${x}.${tmp}`, y);
        };
        await swap(a.dir, b.dir);
        await swap(a.media, b.media);
        await swap("data/.sync/default.json", `data/.sync/${pid}.json`);
        const cfgText = await fs.readText("data/.sync/config.json");
        if (cfgText) {
          try {
            const c = JSON.parse(cfgText), ex = c.excluded || {}, da = "default" in ex, db = pid in ex, va = ex.default, vb = ex[pid];
            delete ex.default; delete ex[pid];
            if (db) ex.default = vb;
            if (da) ex[pid] = va;
            c.excluded = ex;
            await fs.write("data/.sync/config.json", JSON.stringify(c));
          } catch {}
        }
        const items = await loadProfiles(), ia = items.find((x) => x.id === "default"), ib = items.find((x) => x.id === pid);
        [ia.name, ib.name] = [ib.name, ia.name];
        await saveProfiles(items);
        return { profiles: await loadProfiles() };
      }
      if (path === "/api/profiles") {
        if (method === "GET") return { profiles: await loadProfiles() };
        if (method === "POST") {
          const b = json(), name = cleanName(b.name);
          const volume = b.volume ? toFloat(b.volume, "объём") : DEFAULT_SETTINGS.volume;
          if (!(volume > 0)) throw bad("Объём должен быть больше нуля");
          const { id } = await createProfile(name, { volume, minDelivery: Math.min(DEFAULT_SETTINGS.minDelivery, volume) });
          return { id, name };
        }
        if (method === "PUT") {
          const b = json(), pid = String(b.id ?? ""), name = cleanName(b.name);
          const items = await loadProfiles(), it = items.find((p) => p.id === pid);
          if (!it) throw notFound("Нет такого профиля");
          it.name = name; await saveProfiles(items);
          return it;
        }
        if (method === "DELETE") {
          const pid = q.get("id") || "";
          if (!pid) throw notFound("Нет такого профиля");
          if (pid === "default") throw bad("Основную ёмкость удалить нельзя");
          const p = await profilePaths(pid);
          const ts = stamp();
          await fs.rmrf(p.thumbs);
          await fs.rename(p.dir, `data/.deleted/${pid}-${ts}`);
          if (await fs.exists(p.media)) await fs.rename(p.media, `media/.deleted/${pid}-${ts}`);
          await saveProfiles((await loadProfiles()).filter((x) => x.id !== pid));
          return { ok: true };
        }
      }

      if (path === "/api/data" && method === "GET") {
        const p = await P();
        return { settings: await loadSettings(p), readings: await loadReadings(p), refuels: await loadRefuels(p), passport: await loadPassport(p), suppliers: await loadSuppliers() };
      }

      if (path === "/api/suppliers" && method === "POST") {
        const b = json();
        if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("Неверные данные поставщика");
        const row = { id: String(b.id || "").replace(/[^\p{L}\p{N}_\-]/gu, "") || `s${stamp()}${pad(new Date().getMilliseconds(), 3)}${pad(idSeq++ % 1000, 3)}`, ...cleanSupplier(b) };
        const items = (await loadSuppliers()).filter((x) => x.id !== row.id);
        items.push(row); await saveSuppliers(items);
        return row;
      }
      if (path === "/api/suppliers" && method === "DELETE") {
        const sid = q.get("id") || "", items = await loadSuppliers(), left = items.filter((x) => x.id !== sid);
        if (left.length === items.length) throw notFound("Нет такого поставщика");
        if (await supplierInUse(sid)) throw new HttpError(409, "Поставщик указан в заправках — сначала выберите в них другого");
        await saveSuppliers(left);
        return { ok: true };
      }

      if (path === "/api/settings" && method === "PUT") {
        const p = await P(), s = json(), n = await loadSettings(p);
        for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s && !NON_NUMERIC.includes(k)) n[k] = toFloat(s[k], k);
        if ("modes" in s) n.modes = cleanModes(s.modes);
        if ("monthThr" in s) n.monthThr = cleanThr(s.monthThr);
        validateSettings(n);
        await writeJSON(p.settings, n);
        return n;
      }

      if (path === "/api/passport" && method === "PUT") {
        const p = await P(), b = json();
        if (!b || typeof b !== "object") throw bad("Неверные данные паспорта");
        const n = cleanPassport(b, await loadPassport(p));
        await writeJSON(p.passport, n);
        return n;
      }
      if (path === "/api/passport/photo" && method === "POST") {
        const p = await P(), { name, data } = await readImageBody(q, body);
        const target = await storeImage(p.pimg, name, data);
        await makeThumb(p.pthumbs, p.pimg, target);
        const d = await loadPassport(p);
        if (!d.photos.some((x) => x.file === target)) { d.photos.push({ file: target, caption: "" }); await writeJSON(p.passport, d); }
        return d;
      }
      if (path === "/api/passport/photo" && method === "DELETE") {
        const p = await P(), name = safeName(q.get("file"));
        const d = await loadPassport(p), left = d.photos.filter((x) => x.file !== name);
        if (!name || left.length === d.photos.length) throw notFound("Нет такого фото");
        d.photos = left; await writeJSON(p.passport, d);
        if (await fs.exists(`${p.pimg}/${name}`)) await fs.rename(`${p.pimg}/${name}`, `${p.pimg}/.deleted/${stamp()}-${name}`);
        await fs.remove(`${p.pthumbs}/${stem(name)}.jpg`);
        return d;
      }

      if (path === "/api/upload" && method === "POST") {
        const p = await P(), { name, data } = await readImageBody(q, body);
        const target = await storeImage(p.img, name, data);
        await makeThumb(p.thumbs, p.img, target);
        const existing = (await loadReadings(p)).find((r) => r.file === target) || null;
        const dt = exifDateTime(data), nd = dt || nameDateTime(target);
        return { file: target, exif: !!dt, dateFrom: dt ? "exif" : nd.date ? "name" : "", date: nd.date, time: nd.time, existing };
      }

      if (path === "/api/readings" && method === "POST") {
        const p = await P(), b = json();
        const name = b.file ? safeName(b.file) : "";
        if (b.file && (!name || !(await fs.exists(`${p.img}/${name}`)))) throw bad("Фото не найдено на устройстве");
        const date = parseDate(b.date);
        const time = parseTime(String(b.time || "00:00").trim());
        let lvl = b.level == null || b.level === "" ? null : toFloat(b.level, "уровень");
        if (lvl != null && !(lvl >= 0 && lvl <= 100)) throw bad("Уровень должен быть от 0 до 100%");
        const note = String(b.note ?? "").replace(/\n/g, " ").trim();
        if (!name && lvl == null) throw bad("Для показания без фото укажите уровень");
        const row = readingRow(date, time, name, lvl, note);
        const old = String(b.old || (name ? row.id : ""));
        let rows = await loadReadings(p);
        if (old !== row.id && rows.some((r) => r.id === row.id))
          throw new HttpError(409, name ? "Это фото уже привязано к другому показанию" : "На эти дату и время уже есть показание без фото");
        rows = rows.filter((r) => r.id !== old && r.id !== row.id);
        rows.push(row); await saveReadings(p, rows);
        return row;
      }
      if (path === "/api/readings" && method === "DELETE") {
        const p = await P(), rid = q.get("id") ?? q.get("file") ?? "";
        const rows = await loadReadings(p), left = rows.filter((r) => r.id !== rid);
        if (left.length === rows.length) throw notFound("Нет такой записи");
        await saveReadings(p, left);
        return { ok: true };
      }

      if (path === "/api/refuels" && method === "POST") {
        const p = await P(), b = json();
        const date = parseDate(b.date);
        let [liters, price, total] = ["liters", "price", "total"].map((k) => numIn(b[k]));
        if (liters == null && price && total != null) liters = total / price;
        if (price == null && liters && total != null) price = total / liters;
        if (total == null && liters != null && price != null) total = liters * price;
        if (!liters || liters <= 0) throw bad("Укажите количество литров (или сумму и цену за литр)");
        if ([price, total].some((v) => v != null && v < 0)) throw bad("Цена и сумма не могут быть отрицательными");
        const note = String(b.note ?? "").replace(/\n/g, " ").trim();
        const rid = String(b.id || "").replace(/[^\p{L}\p{N}_\-]/gu, "") || `r${stamp()}${pad(new Date().getMilliseconds(), 3)}${pad(idSeq++ % 1000, 3)}`;
        const sup = String(b.supplier || "").trim();
        if (sup && !(await loadSuppliers()).some((x) => x.id === sup)) throw bad("Нет такого поставщика");
        const row = { id: rid, date, liters: round2(liters), note, supplier: sup, price: price == null ? null : round2(price), total: total == null ? null : round2(total) };
        const items = (await loadRefuels(p)).filter((r) => r.id !== rid);
        items.push(row); await saveRefuels(p, items);
        return row;
      }
      if (path === "/api/refuels" && method === "DELETE") {
        const p = await P(), rid = q.get("id") || "";
        const items = await loadRefuels(p), left = items.filter((r) => r.id !== rid);
        if (left.length === items.length) throw notFound("Нет такой заправки");
        await saveRefuels(p, left);
        return { ok: true };
      }
      throw notFound("Нет такого адреса: " + path);
    }

    async function createProfile(name, settings = {}) {
      let pid = "p" + stamp();
      while (await fs.exists("data/" + pid)) pid += "x";
      await fs.mkdir("data/" + pid);
      await fs.mkdir(`media/${pid}/img`);
      await writeJSON(`data/${pid}/settings.json`, { ...structuredClone(DEFAULT_SETTINGS), ...settings });
      const items = await loadProfiles();
      items.push({ id: pid, name });
      await saveProfiles(items);
      return { id: pid, name };
    }

    async function gasFetch(input, opts = {}) {
      const url = new URL(String(input), "https://localhost");
      const method = String(opts.method || "GET").toUpperCase();
      try {
        const res = await locked(() => route(method, url, opts.body));
        return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(e);
        return new Response(JSON.stringify({ error: e.message || String(e) }), { status, headers: { "Content-Type": "application/json" } });
      }
    }

    function imgUrl(kind, file, pid) {
      const name = safeName(file);
      if (!name || !/^[a-z0-9_-]{1,40}$/.test(pid || "default")) return "";
      const m = "media/" + (pid || "default");
      if (kind === "img") return fs.url(`${m}/img/${name}`);
      if (kind === "thumb") return fs.url(`${m}/.thumbs/${stem(name)}.jpg`);
      if (kind === "pimg") return fs.url(`${m}/passport/${name}`);
      if (kind === "pthumb") return fs.url(`${m}/.thumbs/passport/${stem(name)}.jpg`);
      return "";
    }

    async function ensureThumbs(pid, lockWrites = false) {
      const p = await profilePaths(pid);
      for (const [folder, tdir] of [[p.img, p.thumbs], [p.pimg, p.pthumbs]]) {
        for (const n of await fs.list(folder)) {
          if (n.startsWith(".") || ![".jpg", ".jpeg", ".png"].includes(ext(n))) continue;
          const th = `${tdir}/${stem(n)}.jpg`;
          if (await fs.exists(th)) continue;
          const data = await fs.read(`${folder}/${n}`);
          if (!data) continue;
          const small = (await thumbOf(data).catch(() => null)) || data;
          if (lockWrites) await locked(() => fs.write(th, small)); else await fs.write(th, small);
        }
      }
    }

    async function exportFiles(pid, onFile, { photos = true } = {}) {
      const p = await profilePaths(pid);
      const prof = (await loadProfiles()).find((x) => x.id === p.id);
      const meta = { format: "gazgolder", version: 1, name: prof?.name || "Ёмкость", exported: new Date().toISOString(), photos };
      await onFile("gazgolder.json", async () => new TextEncoder().encode(JSON.stringify(meta, null, 2)));
      for (const f of DATA_FILES) {
        if (f === "settings.json") await onFile(f, async () => new TextEncoder().encode(JSON.stringify(await loadSettings(p), null, 2)));
        else if (await fs.exists(`${p.dir}/${f}`)) await onFile(f, () => fs.read(`${p.dir}/${f}`));
      }
      const used = new Set((await loadRefuels(p)).map((r) => r.supplier).filter(Boolean));
      const sups = (await loadSuppliers()).filter((x) => used.has(x.id));
      if (sups.length) await onFile("suppliers.json", async () => new TextEncoder().encode(JSON.stringify({ suppliers: sups }, null, 2)));
      if (!photos) return meta;
      for (const [folder, prefix] of [[p.img, "img/"], [p.pimg, "passport/"]])
        for (const n of await fs.list(folder)) if (!n.startsWith(".") && [".jpg", ".jpeg", ".png"].includes(ext(n))) await onFile(prefix + n, () => fs.read(`${folder}/${n}`));
      return meta;
    }

    async function importBegin(fallbackName) {
      const { id } = await locked(() => createProfile(cleanName(fallbackName || "Импорт")));
      const p = await profilePaths(id);
      let meta = null, n = 0, sups = null;
      return {
        id,
        async add(path, bytes) {
          path = String(path).replace(/\\/g, "/").replace(/^\/+/, "");
          if (path.endsWith("/")) return;
          const parts = path.split("/");
          const known = (pp) => (pp.length === 1 && (DATA_FILES.includes(pp[0]) || pp[0] === "gazgolder.json" || pp[0] === "suppliers.json")) || (pp.length === 2 && ["img", "passport"].includes(pp[0]));
          const pp = known(parts) ? parts : known(parts.slice(1)) ? parts.slice(1) : null;
          if (!pp) return;
          if (pp[0] === "gazgolder.json") { try { meta = JSON.parse(new TextDecoder().decode(bytes)); } catch {} return; }
          if (pp[0] === "suppliers.json") { try { sups = JSON.parse(new TextDecoder().decode(bytes)).suppliers; } catch {} return; }
          if (pp.length === 1) { await locked(() => fs.write(`${p.dir}/${pp[0]}`, bytes)); n++; return; }
          const name = safeName(pp[1]);
          if (!name || name !== pp[1] || ![".jpg", ".jpeg", ".png"].includes(ext(name)) || !isImage(bytes)) return;
          await locked(() => fs.write(`${pp[0] === "img" ? p.img : p.pimg}/${name}`, bytes)); n++;
        },
        async finish() {
          return locked(async () => {
            const s = await loadSettings(p);
            try { validateSettings(s); } catch { Object.assign(s, structuredClone(DEFAULT_SETTINGS)); }
            await writeJSON(p.settings, s);
            await writeJSON(p.passport, await loadPassport(p));
            await saveReadings(p, await loadReadings(p));
            await saveRefuels(p, await loadRefuels(p));
            if (Array.isArray(sups)) await mergeSuppliers(sups);
            const name = meta?.name ? oneLine(meta.name, 60) : null;
            if (name) { const items = await loadProfiles(); const it = items.find((x) => x.id === id); if (it) { it.name = name; await saveProfiles(items); } }
            await ensureThumbs(id);
            return { id, name: name || fallbackName, files: n };
          });
        },
      };
    }

    const parseJSONText = (t) => { if (t == null) return null; try { return JSON.parse(String(t).replace(/^﻿/, "")); } catch { return null; } };
    function snapOf(texts = {}) {
      return {
        readings: parseReadings(texts["gas_levels.csv"] ?? null),
        refuels: parseRefuels(texts["refuels.csv"] ?? null),
        settings: settingsFrom(parseJSONText(texts["settings.json"])),
        passport: passportFrom(parseJSONText(texts["passport.json"])),
        suppliers: suppliersFrom(parseJSONText(texts["suppliers.json"])),
      };
    }
    function textsOf(snap) {
      return {
        "gas_levels.csv": readingsText([...snap.readings]),
        "refuels.csv": refuelsText([...snap.refuels]),
        "settings.json": JSON.stringify(snap.settings, null, 2),
        "passport.json": JSON.stringify(snap.passport, null, 2),
        "suppliers.json": JSON.stringify({ suppliers: sortSuppliers([...(snap.suppliers || [])]) }, null, 2),
      };
    }
    const SYNC_FILES = [...DATA_FILES, "suppliers.json"];
    const readSnap = async (P) => ({ readings: await loadReadings(P), refuels: await loadRefuels(P), settings: await loadSettings(P), passport: await loadPassport(P), suppliers: await loadSuppliers() });
    const PHOTO_DIRS = { img: "img", passport: "pimg" };
    const photoPath = (P, rel) => {
      const [dir, name, ...rest] = String(rel).split("/");
      if (!PHOTO_DIRS[dir] || rest.length || !name || safeName(name) !== name || ![".jpg", ".jpeg", ".png"].includes(ext(name))) return null;
      return { folder: P[PHOTO_DIRS[dir]], tdir: dir === "img" ? P.thumbs : P.pthumbs, name };
    };
    async function listPhotos(P) {
      const out = [];
      for (const dir of Object.keys(PHOTO_DIRS))
        for (const n of await fs.list(P[PHOTO_DIRS[dir]])) if (!n.startsWith(".") && photoPath(P, `${dir}/${n}`)) out.push(`${dir}/${n}`);
      return out.sort();
    }

    const sync = {
      snapOf, textsOf,
      local: (pid) => locked(async () => {
        const P = await profilePaths(pid);
        const prof = (await loadProfiles()).find((x) => x.id === P.id);
        return { id: P.id, name: prof?.name || "", texts: textsOf(await readSnap(P)), photos: await listPhotos(P) };
      }),
      apply: (pid, merged, expect) => locked(async () => {
        const P = await profilePaths(pid);
        const cur = await readSnap(P), curTexts = textsOf(cur);
        if (expect && SYNC_FILES.some((f) => curTexts[f] !== expect[f])) throw new HttpError(409, "Данные изменились во время синхронизации");
        const snap = snapOf(merged.texts);
        try { validateSettings(structuredClone(snap.settings)); } catch { snap.settings = cur.settings; }
        const texts = textsOf(snap), files = { "gas_levels.csv": P.csv, "refuels.csv": P.refuels, "settings.json": P.settings, "passport.json": P.passport };
        let changed = false;
        for (const f of DATA_FILES) if (texts[f] !== curTexts[f] || !(await fs.exists(files[f]))) { await writeAtomic(files[f], texts[f]); changed = true; }
        if (texts["suppliers.json"] !== curTexts["suppliers.json"]) {
          const used = new Set();
          for (const pr of await loadProfiles()) { try { for (const r of await loadRefuels(await profilePaths(pr.id))) if (r.supplier) used.add(r.supplier); } catch {} }
          const ids = new Set(snap.suppliers.map((x) => x.id));
          await saveSuppliers(snap.suppliers.concat(cur.suppliers.filter((x) => used.has(x.id) && !ids.has(x.id))));
          changed = true;
          texts["suppliers.json"] = textsOf({ ...snap, suppliers: await loadSuppliers() })["suppliers.json"];
        }
        const name = merged.name ? oneLine(merged.name, 60) : "";
        if (name) {
          const items = await loadProfiles(), it = items.find((x) => x.id === P.id);
          if (it && it.name !== name) { it.name = name; await saveProfiles(items); changed = true; }
        }
        return { changed, texts };
      }),
      readPhoto: (pid, rel) => locked(async () => { const P = await profilePaths(pid), x = photoPath(P, rel); return x ? fs.read(`${x.folder}/${x.name}`) : null; }),
      writePhoto: (pid, rel, data) => locked(async () => {
        const P = await profilePaths(pid), x = photoPath(P, rel);
        if (!x || !isImage(data) || data.length > MAX_UPLOAD) return false;
        if (await fs.exists(`${x.folder}/${x.name}`)) return true;
        await fs.mkdir(x.folder);
        await writeAtomic(`${x.folder}/${x.name}`, data);
        await makeThumb(x.tdir, x.folder, x.name);
        return true;
      }),
      createProfile: (name) => locked(() => createProfile(cleanName(name))),
    };

    async function init() {
      await fs.mkdir("data/default");
      await fs.mkdir("media/default/img");
      if (!(await fs.exists("data/profiles.json"))) await saveProfiles([DEFAULT_PROFILE]);
    }

    return {
      init: () => locked(init), gasFetch, imgUrl, exportFiles: (pid, onFile, o) => exportFiles(pid, onFile, o),
      importBegin, ensureThumbs: (pid) => ensureThumbs(pid, true),
      profilePaths, loadProfiles: () => locked(loadProfiles), fs, sync,
      _test: { csvParse, csvText, numIn, numOut, safeName },
    };
  }

  async function toBytes(body) {
    if (body == null) return new Uint8Array(0);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (typeof body.arrayBuffer === "function") return new Uint8Array(await body.arrayBuffer());
    throw bad("Неподдерживаемое тело запроса");
  }

  root.gasBackend = { createBackend, DEFAULT_SETTINGS };
})(typeof window !== "undefined" ? window : globalThis);
