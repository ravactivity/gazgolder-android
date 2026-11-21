"use strict";
(function (root) {
  const DAY = 864e5;
  const at = (tm, hour) => { const d = new Date(tm); d.setHours(hour, 0, 0, 0); return +d; };
  const nextAt = (now, hour) => { let tm = at(now, hour); if (tm < now + 60e3) tm += DAY; return tm; };
  const pidNum = (pid) => { let h = 7; for (const c of String(pid)) h = (h * 31 + c.charCodeAt(0)) % 200000; return h; };
  const idsFor = (pid) => [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((k) => pidNum(pid) * 10 + k), ...[0, 1, 2].map((k) => 2000000 + pidNum(pid) * 3 + k),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => 3000000 + pidNum(pid) * 10 + k)];
  const PHOTO_REPEATS = 7, REPEATS = 5;
  const DEFAULTS = { photo: { on: false, days: 14 }, refuel: { on: false, days: 3, level: null, unit: "pct" }, service: { on: false, days: 7 } };

  const days = (v, def) => { const n = Math.round(+v); return v === "" || v == null || !Number.isFinite(n) ? def : Math.max(0, Math.min(365, n)); };
  function cleanRem(r, legacy = {}) {
    r = r && typeof r === "object" ? r : null;
    const on = !!legacy.notify;
    const src = r || { photo: { on, days: legacy.photoDays }, refuel: { on }, service: { on: on && legacy.serviceRem !== false } };
    const out = {};
    for (const k of Object.keys(DEFAULTS)) {
      const x = src[k] && typeof src[k] === "object" ? src[k] : {};
      out[k] = { on: !!x.on, days: days(x.days, DEFAULTS[k].days) };
    }
    const x = src.refuel || {}, lv = x.level === "" || x.level == null ? null : +x.level;
    out.refuel.unit = x.unit === "l" ? "l" : "pct";
    if (src.delivery && src.delivery.on) out.refuel.on = true;
    out.refuel.level = lv != null && Number.isFinite(lv) && lv >= 0 ? lv : null;
    return out;
  }
  const anyOn = (r) => Object.keys(DEFAULTS).some((k) => r[k].on);

  function levelPct(rem, settings) {
    const v = rem.level;
    if (v == null) return settings.minPct;
    return rem.unit === "l" ? (v / (settings.volume || 1)) * 100 : v;
  }
  function hitTime(A, pct) {
    const f = A.forecast, last = A.last;
    if (!last) return null;
    if (last.level <= pct) return last.t;
    if (!f || !f.daily || f.daily.length < 2) return null;
    const d = f.daily;
    for (let i = 1; i < d.length; i++) {
      if (d[i].level <= pct) { const a = d[i - 1], b = d[i]; return a.t + (b.t - a.t) * (a.level - pct) / ((a.level - b.level) || 1); }
    }
    const a = d[d.length - 2], b = d[d.length - 1], step = a.level - b.level;
    return step > 0 ? b.t + (b.level - pct) / step * (b.t - a.t) : null;
  }

  function plan({ pid, name, A, settings, rem = DEFAULTS, service = null, refuels = [], levelText = (p) => Math.round(p) + "%", now = Date.now(), t = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k]), fmtD = (tm) => new Date(tm).toISOString().slice(0, 10) }) {
    rem = cleanRem(rem);
    const ids = idsFor(pid), out = [], p = A.plan;
    if (rem.refuel.on && p && !p.infeasible && p.best) {
      let tm = at(p.best.t, 10);
      let body = t("Выгодно заказать ≈ {l} л до {p}%.", { l: Math.round(p.best.liters / 50) * 50, p: settings.maxPct });
      if (tm < now) {
        tm = p.latest > now ? at(p.latest, 10) : nextAt(now, 10);
        body = t(p.latest > now ? "Последний спокойный день для заказа с учётом доставки." : "Газ на исходе — закажите доставку.");
      }
      if (tm < now) tm = nextAt(now, 10);
      out.push({ id: ids[0], kind: "order", title: t("Пора заказывать газ — {name}", { name }), body, at: tm });
    }
    const R = rem.refuel;
    if (R.on && R.days > 0) {
      const pct = levelPct(R, settings), hit = hitTime(A, pct);
      if (hit != null) {
        const lead = Math.max(0, Math.round(settings.leadDays || 0)), due = hit - lead * DAY;
        const refill = (refuels || []).map((r) => Date.parse(r.date + "T12:00:00")).filter((x) => x > A.last.t).sort((a, b) => b - a)[0];
        const start = Math.max(at(refill ? Math.max(due, refill + R.days * DAY) : due, 10), nextAt(now, 10));
        const lv = levelText(pct);
        for (let k = 0; k <= REPEATS; k++) {
          const tm = start + k * R.days * DAY;
          out.push({ id: k ? ids[12 + k] : ids[1], kind: k ? "level-repeat" : "level", title: t("Пора заправиться — {name}", { name }),
            body: tm < hit ? t("По прогнозу {d} уровень дойдёт до {p}, запас на заправку — {n} дн.", { d: fmtD(hit), p: lv, n: lead }) : t("Уровень газа ниже {p} — закажите доставку.", { p: lv }), at: tm });
        }
      }
    }
    const P = rem.photo;
    if (P.on && A.last && P.days > 0) {
      let first = at(A.last.t + P.days * DAY, 19);
      while (first < now + 60e3) first += P.days * DAY;
      for (let k = 0; k < PHOTO_REPEATS; k++)
        out.push({ id: ids[2 + k], kind: "photo", title: t("Сфотографируйте уровнемер — {name}", { name }),
          body: t("Последнее показание — {d}. Свежее фото уточнит прогноз.", { d: fmtD(A.last.t) }), at: first + k * P.days * DAY });
    }
    const S = rem.service;
    if (S.on && S.days > 0 && service && service.t != null) {
      const when = service.text + (service.org ? " · " + service.org : "");
      const items = [
        [service.t - 7 * DAY, "service-week", ids[10], t("Через неделю ТО — {name}", { name }), t("Следующее ТО / освидетельствование: {d}.", { d: when })],
        [service.t, "service-day", ids[11], t("Сегодня ТО — {name}", { name }), t("Следующее ТО / освидетельствование: {d}.", { d: when })],
      ];
      let k0 = 1;
      while (at(service.t + k0 * S.days * DAY, 10) <= now) k0++;
      for (let k = 0; k < REPEATS; k++)
        items.push([service.t + (k0 + k) * S.days * DAY, "service-over", k ? ids[17 + k] : ids[12], t("ТО просрочено — {name}", { name }), t("Срок был {d}. После ТО добавьте запись о нём.", { d: service.text })]);
      items.forEach(([tm, kind, id, title, body]) => { if (at(tm, 10) > now) out.push({ id, kind, title, body, at: at(tm, 10), open: "services" }); });
    }
    return out;
  }

  const clone = (r) => JSON.parse(JSON.stringify(r));
  function mute(rem) {
    const r = cleanRem(rem), saved = clone(r);
    for (const k of Object.keys(DEFAULTS)) r[k].on = false;
    return { rem: r, saved };
  }
  function unmute(rem, saved) {
    const s = saved ? cleanRem(saved) : null;
    if (s && anyOn(s)) return s;
    const r = cleanRem(rem);
    for (const k of Object.keys(DEFAULTS)) r[k].on = true;
    return r;
  }

  const KEEP = 30, MAX_INBOX = 300;
  const keepDays = (v) => { const n = Math.round(+v); return v === "" || v == null || !Number.isFinite(n) ? KEEP : Math.max(1, Math.min(365, n)); };
  const inboxKey = (x) => `${x.pid}:${x.id}:${x.at}`;
  function inboxAdd(inbox, items, now, keep = KEEP) {
    const list = (Array.isArray(inbox) ? inbox : []).filter((x) => x && typeof x === "object" && Number.isFinite(x.at));
    const seen = new Set(list.map(inboxKey));
    for (const x of items || []) {
      if (!(x.at <= now) || seen.has(inboxKey(x))) continue;
      seen.add(inboxKey(x));
      list.push({ pid: x.pid, id: x.id, kind: x.kind || "", at: x.at, title: String(x.title || ""), body: String(x.body || ""), open: x.open || "", read: !!x.read });
    }
    const from = now - keepDays(keep) * DAY;
    return list.filter((x) => x.at >= from).sort((a, b) => b.at - a.at).slice(0, MAX_INBOX);
  }
  const inboxView = (inbox) => [...(inbox || []).filter((x) => !x.read), ...(inbox || []).filter((x) => x.read)];
  const unread = (inbox) => (inbox || []).filter((x) => !x.read).length;
  function markRead(inbox, key) {
    for (const x of inbox || []) if (key == null || inboxKey(x) === key) x.read = true;
    return inbox;
  }

  root.gasReminders = { plan, idsFor, pidNum, at, nextAt, cleanRem, anyOn, levelPct, hitTime, mute, unmute, inboxAdd, inboxView, inboxKey, unread, markRead, keepDays, DEFAULTS, DAY };
})(typeof window !== "undefined" ? window : globalThis);
