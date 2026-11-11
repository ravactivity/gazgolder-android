"use strict";
(function (root) {
  const DIR = "media/.gauge";
  const LIST = DIR + "/samples.json";
  const MAX = 200;
  const SIDE = 1000;

  const scaleBox = (b, k) => (Array.isArray(b) ? b.map((v) => Math.round(v * k)) : b);
  function scaleOcr(ocr, k) {
    return {
      width: Math.max(1, Math.round(ocr.width * k)), height: Math.max(1, Math.round(ocr.height * k)),
      lines: (ocr.lines || []).map((l) => ({ text: l.text, box: scaleBox(l.box, k), elements: (l.elements || []).map((e) => ({ text: e.text, box: scaleBox(e.box, k) })) })),
    };
  }
  const factor = (w, h) => Math.min(1, SIDE / Math.max(w, h));
  function grayFromRGBA(data) {
    const g = new Uint8Array(data.length >> 2);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = Math.max(data[j], data[j + 1], data[j + 2]);
    return g;
  }
  const pixelOf = (gray, w) => (x, y) => { const v = gray[y * w + x]; return [v, v, v]; };

  function stats(list) {
    const done = list.filter((s) => s.recognized != null && s.level != null);
    const err = done.map((s) => Math.abs(s.recognized - s.level));
    const mean = err.length ? err.reduce((a, b) => a + b, 0) / err.length : null;
    const within = (d) => (err.length ? err.filter((e) => e <= d).length / err.length : null);
    return { total: list.length, recognized: done.length, failed: list.length - done.length, mean, within2: within(2), within5: within(5) };
  }

  function createStore(fs, { zlib, unzlib, max = MAX, now = () => Date.now() }) {
    async function list() {
      const t = await fs.readText(LIST);
      if (!t) return [];
      try { const d = JSON.parse(t); return Array.isArray(d) ? d : []; } catch { return []; }
    }
    const save = (items) => fs.write(LIST, JSON.stringify(items));
    let seq = 0;
    async function add(meta, gray) {
      const items = await list();
      const id = "s" + now().toString(36) + (seq++ % 36).toString(36);
      await fs.mkdir(DIR);
      await fs.write(`${DIR}/${id}.gray`, zlib(gray));
      items.push({ id, date: new Date(now()).toISOString(), ...meta });
      while (items.length > max) { const old = items.shift(); await fs.remove(`${DIR}/${old.id}.gray`); }
      await save(items);
      return items;
    }
    async function clear() { await fs.rmrf(DIR); }
    async function gray(id) { const b = await fs.read(`${DIR}/${id}.gray`); return b ? unzlib(b) : null; }
    async function entries(onFile) {
      const items = await list();
      await onFile("samples.json", new TextEncoder().encode(JSON.stringify(items, null, 1)));
      for (const s of items) { const b = await fs.read(`${DIR}/${s.id}.gray`); if (b) await onFile(`${s.id}.gray`, b); }
      return items.length;
    }
    return { list, add, clear, gray, entries };
  }

  function evaluate(items, grays, readGauge) {
    const rows = [];
    for (const s of items) {
      const g = grays[s.id];
      if (!g || s.level == null) continue;
      const R = readGauge(s.ocr, pixelOf(g, s.ocr.width));
      rows.push({ id: s.id, level: s.level, device: s.recognized, now: R.ok ? R.value : null, reason: R.ok ? "" : R.reason });
    }
    const errs = (k) => rows.filter((r) => r[k] != null).map((r) => Math.abs(r[k] - r.level));
    const sum = (e) => ({ n: e.length, mean: e.length ? e.reduce((a, b) => a + b, 0) / e.length : null, within2: e.length ? e.filter((x) => x <= 2).length / e.length : null });
    return { rows, device: sum(errs("device")), now: sum(errs("now")), failedNow: rows.filter((r) => r.now == null).length };
  }

  root.gasSamples = { createStore, stats, scaleOcr, factor, grayFromRGBA, pixelOf, evaluate, DIR, MAX };
})(typeof window !== "undefined" ? window : globalThis);
