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
    const tg = String(s.telegram || "").trim(), tgDigits = tg.replace(/[^0-9]/g, "");
    if (/^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(tg)) out.tg = "https://t.me/" + tg.replace(/^@/, "");
    else if (/t\.me\//.test(tg)) out.tg = "https://" + tg.replace(/^https?:\/\//, "");
    else if (tgDigits.length >= 10) out.tg = "https://t.me/+" + tgDigits;
    let wa = String(s.whatsapp || "").replace(/[^0-9]/g, "");
    if (wa.length === 11 && wa[0] === "8") wa = "7" + wa.slice(1);
    if (wa.length >= 10) out.wa = "https://wa.me/" + wa;
    const m = String(s.messenger || "").trim();
    if (/^@[\w.]{3,}$/.test(m)) out.msg = "https://t.me/" + m.slice(1);
    else if (/^https:\/\//.test(m)) out.msg = m;
    else if (m.replace(/\D/g, "").length >= 10) out.msg = "https://wa.me/" + m.replace(/\D/g, "");
    if (s.email && /^[^@\s]+@[^@\s]+$/.test(s.email.trim())) out.mail = "mailto:" + s.email.trim();
    out.write = out.tg || out.wa || out.msg || out.sms || null;
    return out;
  }

  const SERVICE = "Обслуживание, контакты", MOUNT = "Монтажная организация", NEXT = "Следующее ТО / освидетельствование", LAST = "Последнее ТО / освидетельствование";
  function parseDay(v) {
    const s = String(v || "").trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return new Date(+m[1], m[2] - 1, +m[3]).getTime();
    m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})\b/.exec(s);
    if (m) return new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], m[2] - 1, +m[1]).getTime();
    m = /^(\d{1,2})[./](\d{4})\b/.exec(s);
    if (m) return new Date(+m[2], m[1] - 1, 1).getTime();
    return null;
  }
  const SOON_DAYS = 30;
  function daysTo(t, now) {
    const d0 = new Date(now);
    d0.setHours(0, 0, 0, 0);
    return Math.round((t - d0.getTime()) / DAY);
  }
  function dueState(v, now) {
    const t = parseDay(v);
    if (t == null) return "";
    const d = daysTo(t, now);
    return d < 0 ? "over" : d <= SOON_DAYS ? "soon" : "ok";
  }
  const val = (params, k) => ((params || []).find((p) => p.k === k) || {}).v;
  function addPeriod(t, p) {
    const d = new Date(t);
    if (p.unit === "day") { d.setDate(d.getDate() + p.n); return d.getTime(); }
    const day = d.getDate();
    d.setDate(1);
    if (p.unit === "month") d.setMonth(d.getMonth() + p.n); else d.setFullYear(d.getFullYear() + p.n);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d.getTime();
  }
  const fmtDay = (t) => { const d = new Date(t), p2 = (n) => String(n).padStart(2, "0"); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  function serviceInfo(params, period) {
    if (!period || !(period.n > 0)) return null;
    const org = String(val(params, SERVICE) || "").trim();
    const text = String(val(params, NEXT) || "").trim(), t = parseDay(text);
    if (t != null) return { text, t, org, computed: false };
    const last = parseDay(String(val(params, LAST) || "").trim());
    if (last == null) return null;
    const next = addPeriod(last, period);
    return { text: fmtDay(next), t: next, org, computed: true };
  }
  function serviceDue(params, now, period) {
    const s = serviceInfo(params, period);
    if (!s) return null;
    const days = daysTo(s.t, now);
    if (days > SOON_DAYS) return null;
    return { text: s.text, t: s.t, days, over: days < 0, org: s.org };
  }
  function orgIs(value, short) {
    const v = String(value || "").trim().toLowerCase(), s = String(short || "").trim().toLowerCase();
    return !!s && (v === s || v.startsWith(s + ",") || v.startsWith(s + " ") || v.startsWith(s + ";"));
  }
  function servedTanks(supplier, tanks) {
    return (tanks || []).map((x) => ({ id: x.id, name: x.name, service: orgIs(val(x.params, SERVICE), supplier.short), mount: orgIs(val(x.params, MOUNT), supplier.short), next: (serviceInfo(x.params, x.period) || {}).text || "" }))
      .filter((x) => x.service || x.mount)
      .sort((a, b) => (b.service - a.service) || a.name.localeCompare(b.name));
  }

  root.gasHome = { PERIODS, plural, status, summary, journal, supplierStats, lastSupplied, initials, contacts, orgIs, servedTanks, parseDay, dueState, addPeriod, serviceInfo, serviceDue };
})(typeof window !== "undefined" ? window : globalThis);
