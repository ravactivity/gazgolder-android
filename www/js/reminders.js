"use strict";
(function (root) {
  const DAY = 864e5;
  const at = (tm, hour) => { const d = new Date(tm); d.setHours(hour, 0, 0, 0); return +d; };
  const nextAt = (now, hour) => { let tm = at(now, hour); if (tm < now + 60e3) tm += DAY; return tm; };
  const pidNum = (pid) => { let h = 7; for (const c of String(pid)) h = (h * 31 + c.charCodeAt(0)) % 200000; return h; };
  const idsFor = (pid) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((k) => pidNum(pid) * 10 + k);
  const PHOTO_REPEATS = 7;

  function plan({ pid, name, A, settings, photoDays = 14, repeatDays = 3, now = Date.now(), t = (s, p) => s.replace(/\{(\w+)\}/g, (_, k) => p[k]), fmtD = (tm) => new Date(tm).toISOString().slice(0, 10) }) {
    const ids = idsFor(pid), out = [], f = A.forecast, p = A.plan;
    if (p && !p.infeasible && p.best) {
      let tm = at(p.best.t, 10);
      let body = t("Выгодно заказать ≈ {l} л до {p}%.", { l: Math.round(p.best.liters / 50) * 50, p: settings.maxPct });
      if (tm < now) {
        tm = p.latest > now ? at(p.latest, 10) : nextAt(now, 10);
        body = t(p.latest > now ? "Последний спокойный день для заказа с учётом доставки." : "Газ на исходе — закажите доставку.");
      }
      if (tm < now) tm = nextAt(now, 10);
      out.push({ id: ids[0], kind: "order", title: t("Пора заказывать газ — {name}", { name }), body, at: tm });
      const last = p.latest ? at(p.latest, 10) : 0;
      if (last > tm + DAY) out.push({ id: ids[9], kind: "order-last", title: t("Пора заказывать газ — {name}", { name }), body: t("Последний спокойный день для заказа с учётом доставки."), at: last });
    }
    if (f && f.hit && f.hit > now) {
      out.push({ id: ids[1], kind: "min", title: t("Газ подходит к минимуму — {name}", { name }),
        body: t("По прогнозу {d} уровень дойдёт до {p}%.", { d: fmtD(f.hit), p: settings.minPct }), at: Math.max(at(f.hit - 3 * DAY, 10), nextAt(now, 10)) });
    }
    if (A.last && photoDays > 0) {
      const first = Math.max(at(A.last.t + photoDays * DAY, 19), nextAt(now, 19));
      const times = repeatDays > 0 ? PHOTO_REPEATS : 1;
      for (let k = 0; k < times; k++)
        out.push({ id: ids[2 + k], kind: "photo", title: t("Сфотографируйте уровнемер — {name}", { name }),
          body: t("Последнее показание — {d}. Свежее фото уточнит прогноз.", { d: fmtD(A.last.t) }), at: first + k * repeatDays * DAY });
    }
    return out;
  }

  root.gasReminders = { plan, idsFor, pidNum, at, nextAt, DAY };
})(typeof window !== "undefined" ? window : globalThis);
