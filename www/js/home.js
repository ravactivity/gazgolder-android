"use strict";
(function (root) {
  const DAY = 864e5;
  const PERIODS = { day: { days: 1, avg: false }, month: { days: 30.44, avg: false }, half: { days: 182.62, avg: true }, year: { days: 365.25, avg: true } };

  function plural(n, one, few, many) {
    const a = Math.abs(Math.round(n)), m = a % 100, k = a % 10;
    if (m > 10 && m < 20) return many;
    if (k === 1) return one;
    return k > 1 && k < 5 ? few : many;
  }

  function status({ now, open, latest, hit }) {
    if (!hit) return "none";
    if (now >= hit) return "low";
    if (latest != null && now > latest) return "low";
    if (open != null && now >= open) return "order";
    return "ok";
  }

  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
  const refuelT = (r) => Date.parse(r.date + "T12:00:00");

  function lastSupplied(refuels, suppliers, id) {
    const known = new Set((suppliers || []).map((x) => x.id));
    const list = (refuels || []).filter((r) => (id ? r.supplier === id : r.supplier && known.has(r.supplier)));
    list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return list[0] || null;
  }

  function summary({ now, volume, nowLevel, lastT, rateNow, avgRate, period = "month", hit, open, latest, best, refuels, suppliers }) {
    const P = PERIODS[period] || PERIODS.month;
    const base = P.avg && avgRate ? avgRate : rateNow;
    const rate = base ? base * P.days : null;
    const ls = lastSupplied(refuels, suppliers);
    const sup = ls ? suppliers.find((x) => x.id === ls.supplier) : null;
    return {
      level: nowLevel,
      liters: nowLevel == null ? null : nowLevel * volume / 100,
      status: nowLevel == null ? "none" : status({ now, open, latest, hit }),
      daysLeft: hit ? Math.max(0, Math.round((hit - now) / DAY)) : null,
      hit: hit || null,
      period: PERIODS[period] ? period : "month",
      rateL: rate,
      ratePct: rate == null ? null : rate / volume * 100,
      agoDays: lastT == null ? null : Math.max(0, daysBetween(lastT, now)),
      order: best ? { t: Math.max(best.t, now), liters: best.liters, cost: best.cost ?? null } : null,
      supplier: sup ? { id: sup.id, short: sup.short, price: ls.price, t: refuelT(ls) } : null,
    };
  }

  function journal(readings, refuels, volume, filter = "all") {
    const rs = (readings || []).filter((r) => r.level != null).map((r) => ({ kind: "reading", id: r.id, t: Date.parse(`${r.date}T${r.time || "00:00:00"}`), date: r.date, time: r.time, level: r.level, liters: r.level * volume / 100, file: r.file || "", note: r.note || "" }));
    rs.sort((a, b) => b.t - a.t);
    rs.forEach((r, i) => { const prev = rs[i + 1]; if (prev) { r.delta = r.level - prev.level; r.days = daysBetween(prev.t, r.t); } });
    const fs = (refuels || []).map((r) => ({ kind: "refuel", id: r.id, t: refuelT(r), date: r.date, liters: r.liters, price: r.price, total: r.total, supplier: r.supplier || "", note: r.note || "" }));
    const items = (filter === "readings" ? rs : filter === "refuels" ? fs : rs.concat(fs)).sort((a, b) => b.t - a.t || (a.kind === "refuel" ? -1 : 1));
    const groups = [];
    for (const it of items) {
      const d = new Date(it.t), key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, year: d.getFullYear(), month: d.getMonth(), items: [] });
      groups[groups.length - 1].items.push(it);
    }
    return groups;
  }

  function supplierStats(id, refuels) {
    const own = (refuels || []).filter((r) => r.supplier === id);
    const last = lastSupplied(own, [{ id }], id);
    return { count: own.length, last: last ? { t: refuelT(last), price: last.price, liters: last.liters } : null };
  }

  function initials(name) {
    const words = String(name || "").replace(/[«»"'.,()]/g, " ").split(/[\s\-]+/).filter(Boolean);
    const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2);
    return s.toUpperCase();
  }

  function contacts(s) {
    const digits = (v) => String(v || "").replace(/[^\d+]/g, "");
    const out = {};
    if (s.phone && digits(s.phone).replace("+", "").length >= 5) { out.call = "tel:" + digits(s.phone); out.sms = "sms:" + digits(s.phone); }
    const m = String(s.messenger || "").trim();
    if (/^@[\w.]{3,}$/.test(m)) out.msg = "https://t.me/" + m.slice(1);
    else if (/^https:\/\//.test(m)) out.msg = m;
    else if (m.replace(/\D/g, "").length >= 10) out.msg = "https://wa.me/" + m.replace(/\D/g, "");
    if (s.email && /^[^@\s]+@[^@\s]+$/.test(s.email.trim())) out.mail = "mailto:" + s.email.trim();
    out.write = out.msg || out.sms || null;
    return out;
  }

  root.gasHome = { PERIODS, plural, status, summary, journal, supplierStats, lastSupplied, initials, contacts };
})(typeof window !== "undefined" ? window : globalThis);
