"use strict";
(function (root) {
  const KW = {
    liters: /(^|[^a-zа-я])(л|l|литр|lit|кол|qty|объ[её]м|vol)/i,
    price: /(цен|price|руб\s*\/|₽\s*\/|\/\s*л|за\s*л|x|х|\*)/i,
    total: /(итог|сумм|всего|оплат|total|amount|=)/i,
  };
  const NUM = /\d{1,3}(?:[   ]\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?/g;

  function linesOf(ocr) {
    if (Array.isArray(ocr)) return ocr.map(String);
    return ((ocr && ocr.lines) || []).map((l) => String(l.text || ""));
  }

  function numbers(lines) {
    const out = [];
    lines.forEach((text, li) => {
      const clean = text.replace(/(\d)[oOоО](?=\d)/g, "$10");
      for (const m of clean.matchAll(NUM)) {
        const s = m[0].replace(/[   ]/g, "").replace(",", ".");
        const v = Number(s);
        if (!Number.isFinite(v)) continue;
        const before = clean.slice(Math.max(0, m.index - 12), m.index), after = clean.slice(m.index + m[0].length, m.index + m[0].length + 8);
        if (/\d[.,:/-]$/.test(before) || /^[.,:/-]\d/.test(after)) continue;
        out.push({ v, li, text: clean, before, after });
      }
    });
    return out;
  }

  function findDate(lines) {
    for (const s of lines) {
      const m = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/.exec(s);
      if (!m) continue;
      let [d, mo, y] = [+m[1], +m[2], +m[3]];
      if (y < 100) y += 2000;
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d && y >= 2000 && y <= 2100)
        return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return "";
  }

  const near = (n, re) => re.test(n.before + " " + n.after) || re.test(n.text);
  const round2 = (v) => Math.round(v * 100) / 100;

  function parseReceipt(ocr) {
    const lines = linesOf(ocr), nums = numbers(lines);
    const res = { liters: null, price: null, total: null, date: findDate(lines), sure: false };
    const L = nums.filter((n) => n.v >= 10 && n.v <= 20000);
    const P = nums.filter((n) => n.v >= 5 && n.v <= 500);
    const T = nums.filter((n) => n.v >= 50 && n.v <= 10000000);
    let best = null;
    for (const l of L) for (const p of P) {
      if (p === l) continue;
      const want = l.v * p.v;
      for (const t of T) {
        if (t === l || t === p) continue;
        if (Math.abs(want - t.v) > Math.max(1, t.v * 0.005)) continue;
        let score = 0;
        if (near(l, KW.liters)) score += 2;
        if (near(p, KW.price)) score += 1;
        if (near(t, KW.total)) score += 2;
        if (l.v > p.v) score += 1;
        if (l.li === p.li) score += 1;
        score -= Math.abs(want - t.v) / Math.max(1, t.v) * 100;
        if (!best || score > best.score || (score === best.score && t.v > best.t.v)) best = { l, p, t, score };
      }
    }
    if (best) return { ...res, liters: round2(best.l.v), price: round2(best.p.v), total: round2(best.t.v), sure: true };
    const kw = (list, re) => list.filter((n) => near(n, re)).sort((a, b) => b.v - a.v)[0];
    const tl = kw(T, KW.total), ll = nums.find((n) => n.v >= 10 && n.v <= 20000 && /^\s*(л|l)(?![a-zа-я])/i.test(n.after));
    if (tl) res.total = round2(tl.v);
    if (ll) res.liters = round2(ll.v);
    if (res.total != null && res.liters) res.price = round2(res.total / res.liters);
    return res;
  }

  root.gasReceipt = { parseReceipt, findDate, numbers };
})(typeof window !== "undefined" ? window : globalThis);
