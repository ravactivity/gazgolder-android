"use strict";
(function () {
  const H = window.gasHome;
  const I = window.gasI18n;
  const t = I.t;
  const q = (id) => document.getElementById(id);
  const DAY = 864e5;
  const ic = (n, fill) => `<span class="ms${fill ? " f" : ""}" aria-hidden="true">${n}</span>`;
  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (v, d = 0) => Number(v).toLocaleString(I.locale, { minimumFractionDigits: d, maximumFractionDigits: d });
  const dm = (tm) => new Date(tm).toLocaleDateString(I.locale, { day: "numeric", month: "short" });
  const dmy = (tm) => new Date(tm).toLocaleDateString(I.locale, { day: "numeric", month: "short", year: "numeric" });
  const days = (n) => `${nf(n)} ${t(H.plural(n, "день", "дня", "дней"))}`;
  const RATE_LABEL = { day: "в сутки", week: "в неделю", month: "в месяц", half: "за 6 месяцев", year: "в год" };
  const RANGE = { week: [7, "Неделя"], month: [30, "Месяц"], half: [183, "6 мес."], year: [365, "Год"] };
  const RATE_SHORT = { day: "/сут", week: "/нед", month: "/мес", half: "/6 мес", year: "/год" };
  const TABS = [["home", "home", "Главная"], ["log", "receipt_long", "Журнал"], ["stats", "monitoring", "Аналитика"], ["more", "menu", "Ещё"]];
  const SCREENS = { refuel: "Заправка", readings: "Показания", tank: "Ёмкость", passport: "Паспорт ёмкости", boiler: "Котёл и режимы", suppliers: "Поставщики", settings: "Настройки", supplier: "", "supplier-edit": "Поставщик", inbox: "Уведомления", services: "ТО", "service-edit": "Запись о ТО",
    look: "Язык и тема", camera: "Камера и распознавание", notify: "Напоминания", widget: "Виджет", archive: "Архив", storage: "Хранение", transfer: "Поделиться и перенести" };
  const PANES = ["look", "camera", "notify", "widget", "archive", "storage", "transfer"];
  let tankParams = null;
  let ctx = null, tab = "home", stack = [], filter = "all", lastA = null, supId = null, pending = null, sel = null;

  const P = () => ({
    state: typeof state !== "undefined" ? state : null,
    view: typeof view !== "undefined" ? view : {},
    profiles: typeof profiles !== "undefined" ? profiles : [],
    curProfile: typeof curProfile === "function" ? curProfile() : null,
    fillRefuel: typeof fillRefuel === "function" ? fillRefuel : () => {},
    fillSupplier: typeof fillSupplier === "function" ? fillSupplier : () => {},
    openEditor: typeof openEditor === "function" ? openEditor : () => {},
    switchProfile: typeof switchProfile === "function" ? switchProfile : async () => {},
    render: typeof render === "function" ? render : () => {},
    api: typeof api === "function" ? api : async () => ({}),
    makeMain: typeof makeMain === "function" ? makeMain : async () => false,
    setProfiles: (list) => { if (typeof profiles !== "undefined") profiles = list; if (typeof renderProfiles === "function") renderProfiles(); },
  });
  const S = () => P().state || { settings: { volume: 4600, minPct: 20, maxPct: 85 }, readings: [], refuels: [], suppliers: [] };
  const sec = (name) => document.querySelector(`section[data-panel="${name}"]`);

  function build() {
    const html = document.documentElement;
    html.classList.add("m-app");
    const wrap = document.querySelector(".wrap") || document.body;
    const top = document.createElement("div");
    top.className = "m-top"; top.id = "m-top";
    top.innerHTML = `<button type="button" class="m-ib" id="m-back" hidden aria-label="${t("Назад")}">${ic("arrow_back")}</button>
      <div class="m-title" id="m-title"><span class="m-tt"><span id="m-title-t"></span><span class="m-title-sub" id="m-title-sub" hidden></span></span><span id="m-title-dd">${ic("arrow_drop_down")}</span></div>
      <button type="button" class="m-ib m-sel-tg" id="m-log-sel" hidden aria-pressed="false" aria-label="${t("Выбрать")}">${ic("check_box")}</button>
      <button type="button" class="m-ib" id="m-sel-all" hidden aria-label="${t("Выбрать все")}">${ic("select_all")}</button>
      <button type="button" class="m-ib" id="m-sel-del" hidden aria-label="${t("Удалить выбранные")}">${ic("delete")}</button>
      <button type="button" class="m-ib m-bell" id="m-bell" aria-label="${t("Уведомления")}">${ic("notifications")}<span class="m-badge" id="m-bell-n" hidden></span></button>
      <button type="button" class="m-ib" id="m-gear" aria-label="${t("Настройки")}">${ic("settings")}</button>
      <button type="button" class="m-ib" id="m-menu" aria-label="${t("Меню")}">${ic("more_vert")}</button>`;
    const main = document.createElement("main");
    main.className = "m-main"; main.id = "m-main";
    main.innerHTML = TABS.map(([k]) => `<div class="m-tab" data-tab="${k}" id="m-tab-${k}"></div>`).join("")
      + Object.keys(SCREENS).map((k) => `<div class="m-screen" data-screen="${k}" id="m-scr-${k}" hidden></div>`).join("");
    const nav = document.createElement("nav");
    nav.className = "m-nav"; nav.id = "m-nav";
    nav.innerHTML = TABS.map(([k, icon, label]) => `<button type="button" data-nav="${k}"><i>${ic(icon)}</i><span>${t(label)}</span></button>`).join("");
    const extra = document.createElement("div");
    extra.innerHTML = `<button type="button" class="m-fab" id="m-fab" hidden></button>
      <div class="m-snack" id="m-snack" hidden></div>
      <div class="m-menu-pop" id="m-menu-pop" hidden></div>
      <dialog class="m-sheet" id="m-sheet" tabindex="-1"><div class="m-sheet-h" id="m-sheet-h"></div><div id="m-sheet-b"></div></dialog>`;
    wrap.prepend(top, main);
    document.body.append(nav, ...extra.children);

    q("m-tab-home").innerHTML = homeSkeleton();
    q("m-tab-log").innerHTML = `<div class="m-chips" id="m-log-chips">${[["all", "Все"], ["readings", "Показания"], ["refuels", "Заправки"]].map(([k, l]) => `<button type="button" class="x-chip" data-filter="${k}">${t(l)}</button>`).join("")}</div><div id="m-log"></div>`;
    q("m-tab-more").innerHTML = `<div id="m-more"></div>`;
    for (const name of ["plan", "level", "stats", "months"]) { const s = sec(name); if (s) q("m-tab-stats").append(s); }
    const move = (name, screen) => { const s = sec(name); if (s) q("m-scr-" + screen).append(s); };
    move("refuels", "refuel"); move("readings", "readings"); move("passport", "passport"); move("calc", "boiler");
    for (const k of PANES) { const el = q("m-p-" + k); if (el) q("m-scr-" + k).append(el); }
    const header = wrap.querySelector("header");
    if (header) { header.classList.add("m-tank-head"); q("m-scr-tank").append(header); }
    q("unit")?.closest("label")?.classList.add("m-unit");
    const act = (id, icon, label, aria, cls = "") => `<button type="button" class="m-tact${cls}" id="${id}" aria-label="${t(aria)}">${ic(icon)}<span>${t(label)}</span></button>`;
    q("m-scr-tank").insertAdjacentHTML("beforeend", `<div class="m-tacts">${act("m-pf-save", "save", "Сохранить", "Сохранить настройки ёмкости")}${act("m-pf-new", "add", "Новая", "Новая ёмкость")}${act("m-pf-ren", "edit", "Название", "Переименовать")}${act("m-pf-del", "delete", "Удалить", "Удалить ёмкость", " danger")}</div>
      <div class="m-list" id="m-tank-more"><button type="button" class="m-li set" data-more="passport"><span class="m-lead">${ic("description")}</span><span class="m-mid"><span class="m-h">${t("Паспорт ёмкости")}</span><span class="m-s">${t("параметры, документы, фото таблички")}</span></span>${ic("chevron_right")}</button></div>`);
    q("m-scr-settings").innerHTML = `<div id="m-settings"></div>`;
    q("m-scr-inbox").innerHTML = `<div id="m-inbox"></div>`;
    q("m-scr-services").innerHTML = `<div id="m-svc"></div>`;
    q("m-scr-service-edit").innerHTML = `<form class="rf-form m-pad" id="m-svc-form"><input type="hidden" id="m-svc-id">
        <label class="m-full"><span class="label">${t("Поставщик")}</span><select id="m-svc-sup"></select></label>
        <label><span class="label">${t("Дата")}</span><input id="m-svc-date" type="date" required></label>
        <label><span class="label">${t("Стоимость, ₽")}</span><input id="m-svc-cost" type="number" min="0" step="0.01" inputmode="decimal"></label>
        <label class="m-full"><span class="label">${t("Выполненные работы")}</span><textarea id="m-svc-works" rows="5" placeholder="${t("по одной работе в строке")}"></textarea></label>
        <label class="m-full"><span class="label">${t("Комментарий")}</span><input id="m-svc-note" type="text"></label>
        <button class="primary" type="submit">${t("Сохранить")}</button><div class="err" id="m-svc-err"></div></form>
      <div class="m-btns m-pad"><button type="button" class="danger" id="m-svc-del" hidden>${ic("delete")}${t("Удалить запись")}</button></div>`;
    q("m-scr-suppliers").innerHTML = `<div class="m-list" id="m-sup-list"></div><p class="m-hint">${t("Поставщика можно выбрать при добавлении заправки. На главной показывается поставщик последнего заказа.")}</p>`;
    q("m-scr-supplier").innerHTML = `<div id="m-sup-card"></div>`;
    const sp = sec("suppliers");
    if (sp) { q("m-scr-supplier-edit").append(sp); sp.querySelector(".table-wrap")?.setAttribute("hidden", ""); }
    q("m-scr-refuel").insertAdjacentHTML("beforeend", `<div class="m-btns m-pad"><button type="button" class="danger" id="m-rf-del" hidden>${ic("delete")}${t("Удалить заправку")}</button></div>`);
    q("m-scr-supplier-edit").insertAdjacentHTML("beforeend", `<div class="m-btns m-pad"><button type="button" class="danger" id="m-sup-del" hidden>${ic("delete")}${t("Удалить поставщика")}</button></div>`);
    const sum = sec("summary");
    if (sum) sum.hidden = true;
    applyOrder();
    wire();
    wireDrag();
    show("home");
  }

  function applyOrder() {
    if (!ctx) return;
    const box = q("m-tab-home");
    for (const k of H.homeOrder(ctx.mset.homeOrder)) box.append(box.querySelector(`[data-card="${k}"]`));
  }
  function wireDrag() {
    const box = q("m-tab-home");
    let start = null, drag = null, tm = null, eat = false;
    const stop = () => { clearTimeout(tm); tm = null; start = null; };
    const moveTo = (y) => {
      const next = [...box.querySelectorAll("[data-card]")].filter((x) => x !== drag.c && !x.hidden).find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (next) { if (drag.c.nextElementSibling !== next) box.insertBefore(drag.c, next); } else if (box.lastElementChild !== drag.c) box.append(drag.c);
    };
    box.addEventListener("pointerdown", (ev) => {
      const c = ev.target.closest("[data-card]");
      if (!c || ev.button > 0) return;
      stop();
      start = { x: ev.clientX, y: ev.clientY, c, id: ev.pointerId };
      tm = setTimeout(() => {
        drag = start;
        drag.c.classList.add("m-drag"); box.classList.add("m-dragging");
        try { box.setPointerCapture(drag.id); } catch {}
        if (navigator.vibrate) navigator.vibrate(15);
      }, 450);
    });
    box.addEventListener("pointermove", (ev) => {
      if (drag) { ev.preventDefault(); moveTo(ev.clientY); return; }
      if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) stop();
    });
    const end = () => {
      stop();
      if (!drag) return;
      drag.c.classList.remove("m-drag"); box.classList.remove("m-dragging");
      drag = null; eat = true; setTimeout(() => { eat = false; }, 400);
      ctx.mset.homeOrder = [...box.querySelectorAll("[data-card]")].map((x) => x.dataset.card);
      ctx.saveM();
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
    box.addEventListener("touchmove", (ev) => { if (drag) ev.preventDefault(); }, { passive: false });
    box.addEventListener("contextmenu", (ev) => { if (ev.target.closest("[data-card]")) ev.preventDefault(); });
    box.addEventListener("click", (ev) => { if (eat) { eat = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
  }

  function homeSkeleton() {
    return `<div class="m-hero" id="m-hero" data-card="hero">
        <div class="m-ring" id="m-ring"></div>
        <div class="m-hero-t"><span class="m-status" id="m-status"></span>
          <div class="m-days"><span class="m-big" id="m-days"></span><span class="m-muted" id="m-until"></span></div>
          <div class="m-rate" id="m-rate"></div></div>
        <button type="button" class="m-btn fill m-wide" id="m-add">${ic("add_a_photo")}${t("Добавить показания")}</button>
        <div class="m-small m-center" id="m-ago"></div>
      </div>
      <button type="button" class="x-card m-order" id="m-order" data-card="order">
        <span class="m-av">${tanker()}</span>
        <span class="m-order-t"><b id="m-order-h"></b><span class="m-small" id="m-order-s"></span><span class="m-small m-sup" id="m-order-sup"></span></span>
        ${ic("chevron_right")}
      </button>
      <button type="button" class="x-card m-order m-to" id="m-to" data-card="to" hidden>
        <span class="m-av" id="m-to-ic"></span>
        <span class="m-order-t"><b id="m-to-h"></b><span class="m-small" id="m-to-s"></span><span class="m-small m-sup" id="m-to-org" data-noi18n></span></span>
        ${ic("chevron_right")}
      </button>
      <div class="x-card m-chart" data-card="level"><div class="x-card-h"><b>${t("Уровень")}</b><span class="m-range" id="m-range">${Object.entries(RANGE).map(([k, [, l]]) => `<button type="button" class="x-chip" data-range="${k}">${t(l)}</button>`).join("")}</span></div><div id="m-mini"></div></div>`;
  }

  function tanker() {
    return `<svg width="32" height="32" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><rect x="1.5" y="8" width="19" height="11" rx="5.5"/>
      <text x="11" y="15.9" text-anchor="middle" class="m-gas">GAS</text>
      <path d="M22 11.5h4.2c.5 0 1 .3 1.2.7l2.3 3.9c.2.3.3.6.3 1V21a1 1 0 0 1-1 1H22z"/><path class="m-cut" d="M23.6 13.2h2.4l1.7 2.9h-4.1z"/>
      <rect x="1.5" y="20" width="21" height="2" rx="1"/><circle class="m-wheel" cx="7" cy="23.5" r="3"/><circle class="m-wheel" cx="25" cy="23.5" r="3"/></svg>`;
  }

  function ring(pct, minPct) {
    const size = 112, c = size / 2, r = c - 10, len = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct ?? 0));
    const arc = (v, cls) => `<circle cx="${c}" cy="${c}" r="${r}" class="${cls}" stroke-dasharray="${(len * 0.75 * v / 100).toFixed(1)} ${len.toFixed(1)}" transform="rotate(135 ${c} ${c})"/>`;
    const a = (135 + 270 * minPct / 100) * Math.PI / 180, x = (k) => c + (r + k) * Math.cos(a), y = (k) => c + (r + k) * Math.sin(a);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${arc(100, "m-ring-bg")}${pct == null ? "" : arc(p, "m-ring-fg")}
      <line x1="${x(-9)}" y1="${y(-9)}" x2="${x(9)}" y2="${y(9)}" class="m-ring-min"/>
      <text x="${c}" y="${c + 6}" text-anchor="middle" class="m-ring-v">${pct == null ? "—" : nf(Math.round(p))}<tspan class="m-ring-u">%</tspan></text>
      <text x="${c}" y="${c + 27}" text-anchor="middle" class="m-ring-l">${pct == null ? "" : nf(Math.round(p * S().settings.volume / 1000) * 10) + " " + t("л")}</text></svg>`;
  }

  function mini(A) {
    const w = 312, h = 92, m = { l: 26, r: 6, t: 6, b: 18 }, st = S().settings, now = Date.now();
    const rk = RANGE[ctx.mset.homeRange] ? ctx.mset.homeRange : "half", R = RANGE[rk][0] * DAY;
    const f = A.forecast, t1 = now + Math.min(Math.max(((f && f.hit) || now) - now, 0) + 6 * DAY, R), t0 = now - R;
    document.querySelectorAll("#m-range [data-range]").forEach((b) => { b.classList.toggle("on", b.dataset.range === rk); b.setAttribute("aria-pressed", b.dataset.range === rk); });
    const x = (tm) => m.l + (tm - t0) / (t1 - t0) * (w - m.l - m.r), y = (p) => m.t + (100 - p) / 100 * (h - m.t - m.b);
    const pts = (A.pts || []).filter((p) => p.t >= t0 - 60 * DAY);
    const path = (arr) => arr.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.level).toFixed(1)).join("");
    let s = `<svg viewBox="0 0 ${w} ${h}" class="m-mini" aria-hidden="true"><clipPath id="m-clip"><rect x="${m.l}" y="0" width="${w - m.l - m.r}" height="${h}"/></clipPath>`;
    s += `<rect x="${m.l}" y="${y(st.minPct)}" width="${w - m.l - m.r}" height="${y(0) - y(st.minPct)}" class="m-low"/>`;
    for (const p of [0, 50, 100]) s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(p)}" y2="${y(p)}" class="m-grid"/><text x="${m.l - 5}" y="${y(p) + 4}" text-anchor="end">${p}</text>`;
    s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(st.minPct)}" y2="${y(st.minPct)}" class="m-minline"/><g clip-path="url(#m-clip)">`;
    if (pts.length) s += `<path d="${path(pts)}" class="m-line"/>`;
    if (f && f.path && f.path.length > 1 && A.last) s += `<path d="${path([A.last, ...f.path.filter((p) => p.t > A.last.t)])}" class="m-fc"/>`;
    s += "</g>";
    const lvl = A.nowLevel ?? (A.last && A.last.level);
    if (lvl != null) s += `<circle cx="${x(now)}" cy="${y(lvl)}" r="4.5" class="m-now"/>`;
    const best = A.plan && !A.plan.infeasible && A.plan.best;
    if (best) s += `<circle cx="${x(Math.max(best.t, now))}" cy="${y(best.level)}" r="4.5" class="m-best"/>`;
    const label = (tm, txt) => { if (x(tm) > m.l + 8 && x(tm) < w - m.r - 8) s += `<text x="${x(tm)}" y="${h - 3}" text-anchor="middle">${txt}</text>`; };
    const d = new Date(t0); d.setHours(0, 0, 0, 0);
    if (rk === "week") for (d.setDate(d.getDate() + 1); +d < t1; d.setDate(d.getDate() + 2)) label(+d, d.getDate());
    else if (rk === "month") for (d.setDate(d.getDate() + 3); +d < t1; d.setDate(d.getDate() + 7)) label(+d, `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`);
    else for (d.setDate(1), d.setMonth(d.getMonth() + 1); +d < t1; d.setMonth(d.getMonth() + (rk === "year" ? 3 : 2))) label(+d, d.getMonth() === 0 ? d.getFullYear() : d.toLocaleDateString(I.locale, { month: "short" }).replace(".", ""));
    return s + "</svg>";
  }

  function volPer(l, per) {
    const V = S().settings.volume, pct = `${nf(l / V * 100, 1)} %`, lit = `${nf(l < 100 ? Math.round(l * 10) / 10 : Math.round(l / 10) * 10, l < 100 ? 1 : 0)} ${t("л")}`;
    return P().view.unit === "pct" ? `≈ ${pct}${per} <span class="m-muted">(${lit})</span>` : `≈ ${lit}${per} <span class="m-muted">(${pct})</span>`;
  }

  function renderHome(A) {
    const st = S(), set = st.settings, now = Date.now(), view = P().view;
    const PL = A.plan && !A.plan.infeasible ? A.plan : null;
    const m = new Date().getMonth();
    const rateNow = view.method === "recent" && A.recentRate != null ? A.recentRate : A.C ? A.C.rateFor(now) : (A.seasonRate || [])[m];
    const s = H.summary({ now, volume: set.volume, nowLevel: A.nowLevel ?? (A.last ? A.last.level : null), lastT: A.last ? A.last.t : null, rateNow, avgRate: A.avgRate,
      period: ctx.mset.homeRate || "month", hit: A.forecast && A.forecast.hit, open: PL && PL.open, latest: PL && PL.latest, best: PL && PL.best, refuels: st.refuels, suppliers: st.suppliers });
    q("m-ring").innerHTML = ring(s.level, set.minPct);
    const ST = { ok: ["ok", "check_circle", "Всё в порядке"], order: ["warn", "schedule", "Пора заказывать"], low: ["crit", "warning", "Мало газа"], none: ["none", "info", "Мало данных"] }[s.status];
    q("m-status").className = "m-status " + ST[0];
    q("m-status").innerHTML = ic(ST[1], 1) + t(ST[2]);
    q("m-days").textContent = s.daysLeft == null ? "—" : days(s.daysLeft);
    q("m-until").textContent = s.hit ? `(${t("до")} ${dm(s.hit)})` : "";
    q("m-rate").innerHTML = s.rateL == null ? "" : `${ic("local_fire_department")}<span>${volPer(s.rateL, t(RATE_SHORT[s.period]))}</span>`;
    q("m-ago").textContent = s.agoDays == null ? t("показаний пока нет") : s.agoDays === 0 ? t("последнее показание сегодня") : `${t("последнее показание")} ${days(s.agoDays)} ${t("назад")}`;
    const o = s.order;
    q("m-order-h").textContent = !o ? t("Мало данных для прогноза") : o.t <= now + DAY ? t("Заказать сейчас") : `${t("Заказать")} ${dm(o.t)}`;
    q("m-order-s").textContent = o ? `≈ ${nf(Math.round(o.liters / 10) * 10)} ${t("л")}` + (o.cost ? ` · ≈ ${nf(Math.round(o.cost / 1000))} ${t("тыс. ₽")}` : "") : t("добавьте ещё показаний");
    const cs = curSupplier(), last = cs && H.supplierStats(cs.id, st.refuels).last;
    q("m-order-sup").innerHTML = cs ? `${ic("storefront")}${e(cs.short)}${last && last.price != null ? ` · ${nf(last.price, 2)} ₽/${t("л")}` : ""}${last ? ` <span class="m-muted">(${dm(last.t)})</span>` : ""}` : "";
    q("m-order").dataset.curSup = cs ? cs.id : "";
    const period = set.servicePeriod, pp = st.passport || {}, info = H.serviceInfo(pp.params, period, st.services), to = H.serviceDue(pp.params, now, period, st.services);
    q("m-to").hidden = !!period && !to && !!info;
    q("m-to").classList.toggle("off", !period || !info);
    if (!period || !info) {
      q("m-to").classList.remove("over");
      q("m-to-ic").innerHTML = ic(!period ? "info" : "schedule");
      q("m-to-h").textContent = t(!period ? "ТО не проводится" : "Когда следующее ТО?");
      q("m-to-s").textContent = t(!period ? "период ТО не указан в настройках ёмкости" : "добавьте запись о последнем ТО");
      q("m-to-org").textContent = "";
    } else if (to) {
      q("m-to").classList.toggle("over", to.over);
      q("m-to-ic").innerHTML = ic(to.over ? "warning" : "schedule");
      q("m-to-h").textContent = t(to.over ? "ТО просрочено" : to.days === 0 ? "ТО сегодня" : "Скоро ТО");
      q("m-to-s").innerHTML = (to.over ? `${days(-to.days)} ${t("назад")} · ` : to.days ? `${t("через")} ${days(to.days)} · ` : "") + `<span data-noi18n>${e(to.text)}</span>`;
      q("m-to-org").textContent = to.org;
    }
    q("m-mini").innerHTML = mini(A);
  }

  function renderLog() {
    const st = S(), V = st.settings.volume;
    document.querySelectorAll("#m-log-chips [data-filter]").forEach((b) => b.classList.toggle("on", b.dataset.filter === filter));
    const groups = H.journal(st.readings, st.refuels, V, filter);
    const sup = (id) => (st.suppliers || []).find((x) => x.id === id);
    const keys = groups.flatMap((gr) => gr.items.map(keyOf));
    if (sel) for (const k of [...sel]) if (!keys.includes(k)) sel.delete(k);
    const lead = (it, icon, cls) => sel ? `<span class="m-lead m-check">${ic(sel.has(keyOf(it)) ? "check_box" : "check_box_outline_blank", sel.has(keyOf(it)))}</span>` : `<span class="m-lead${cls}">${ic(icon, cls === " ph")}</span>`;
    const on = (it) => (sel && sel.has(keyOf(it)) ? " sel" : "");
    q("m-log").innerHTML = groups.length ? groups.map((gr) => `<div class="m-sect">${e(new Date(gr.year, gr.month, 1).toLocaleDateString(I.locale, { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()).replace(/\s*г\.$/, ""))}</div>
      <div class="m-list">${gr.items.map((it) => it.kind === "reading"
        ? `<button type="button" class="m-li${on(it)}" data-reading="${e(it.id)}" data-key="${e(keyOf(it))}">${lead(it, it.file ? "photo_camera" : "edit_note", it.file ? " ph" : "")}
            <span class="m-mid"><span class="m-h">${nf(it.level)} % · ${nf(Math.round(it.liters / 10) * 10)} ${t("л")}</span><span class="m-s">${dm(it.t)}, ${e((it.time || "").slice(0, 5))} · ${t(it.file ? "фото" : "вручную")}${it.note ? " · " + e(it.note) : ""}</span></span>
            ${it.delta == null ? "" : `<span class="m-trail"><b>${it.delta > 0 ? "+" : it.delta < 0 ? "−" : ""}${nf(Math.abs(it.delta))} %</b>${t("за")} ${nf(it.days)} ${t("дн.")}</span>`}</button>`
        : `<button type="button" class="m-li${on(it)}" data-refuel="${e(it.id)}" data-key="${e(keyOf(it))}">${lead(it, "local_gas_station", " pr")}
            <span class="m-mid"><span class="m-h">${t("Заправка")} +${nf(it.liters)} ${t("л")}</span><span class="m-s">${dm(it.t)}${it.price != null ? ` · ${nf(it.price, 2)} ₽/${t("л")}` : ""}${sup(it.supplier) ? " · " + e(sup(it.supplier).short) : ""}</span></span>
            ${it.total != null ? `<span class="m-trail"><b>${nf(Math.round(it.total))} ₽</b></span>` : ""}</button>`).join("")}</div>`).join("")
      : `<p class="m-hint">${t("Записей пока нет. Нажмите «+», чтобы добавить показание или заправку.")}</p>`;
    q("m-log").dataset.empty = keys.length ? "" : "1";
    title();
  }

  const keyOf = (it) => (it.kind === "reading" ? "r:" : "f:") + it.id;
  function select(key) {
    if (!sel) sel = new Set();
    if (key) { if (sel.has(key)) sel.delete(key); else sel.add(key); }
    renderLog(); title();
  }
  function endSelect() { sel = null; renderLog(); title(); }
  function selectAll() {
    const all = [...q("m-log").querySelectorAll("[data-key]")].map((b) => b.dataset.key);
    sel = new Set(all.every((k) => sel.has(k)) ? [] : all);
    renderLog(); title();
  }
  async function deleteSelected() {
    const keys = [...sel];
    if (!keys.length) { snack(t("Ничего не выбрано")); return; }
    if (!(await uiAsk(t("Удалить записей: {n}? Фото уровнемера останутся в памяти телефона.", { n: keys.length }), { ok: t("Удалить"), danger: true }))) return;
    const st = S();
    let done = 0, err = null;
    for (const k of keys) {
      const id = k.slice(2), reading = k[0] === "r";
      try {
        await P().api(`/api/${reading ? "readings" : "refuels"}?id=` + encodeURIComponent(id), { method: "DELETE" });
        if (reading) st.readings = st.readings.filter((x) => x.id !== id); else st.refuels = st.refuels.filter((x) => x.id !== id);
        sel.delete(k); done++;
      } catch (ex) { err = ex; }
    }
    if (!sel.size) sel = null;
    P().render();
    renderLog(); title();
    snack(err ? t("Удалено: {n}. Ошибка: {e}", { n: done, e: err.message }) : t("Удалено: {n}", { n: done }));
  }

  const moreItem = (key, icon, h, s, trail = ic("chevron_right")) => `<button type="button" class="m-li set" data-more="${key}"><span class="m-lead">${ic(icon)}</span><span class="m-mid"><span class="m-h">${h}</span>${s ? `<span class="m-s">${s}</span>` : ""}</span>${trail}</button>`;
  function renderMore() {
    const st = S(), set = st.settings, n = (st.suppliers || []).length, it = moreItem;
    const cur = P().view.profile || "default";
    const tanks = P().profiles.map((p) => {
      const on = p.id === cur, main = p.id === "default";
      const sub = [main ? t("основная") : "", on ? `${t("текущая")} · ${nf(set.volume)} ${t("л")}` : ""].filter(Boolean).join(" · ");
      return `<div class="m-li m-tank-li${on ? " cur" : ""}"><button type="button" class="m-tank-sw" data-tank-sw="${e(p.id)}" aria-pressed="${on}" aria-label="${t("Сделать текущей")}">${ic(on ? "radio_button_checked" : "radio_button_unchecked", on)}</button><button type="button" class="m-tank-pick" data-tank="${e(p.id)}"><span class="m-mid"><span class="m-h" data-noi18n>${e(tankName(p))}</span>${sub ? `<span class="m-s">${sub}</span>` : ""}</span></button>${main ? "" : `<button type="button" class="m-tank-btn" data-tank-main="${e(p.id)}" aria-label="${t("Сделать основной")}">${ic("home")}</button><button type="button" class="m-tank-btn m-tank-del" data-tank-del="${e(p.id)}" aria-label="${t("Удалить ёмкость")}">${ic("delete")}</button>`}</div>`;
    }).join("");
    q("m-more").innerHTML = `<div class="m-sect">${t("Ёмкости")}</div><div class="m-list" id="m-tanks">${tanks}
        ${it("tank-new", "add", t("Новая ёмкость"), "", "")}</div>
      <p class="m-hint">${t("Нажмите на ёмкость, чтобы открыть её настройки и паспорт.")}</p>
      <div class="m-list">
        ${it("suppliers", "storefront", t("Поставщики"), n ? (st.suppliers[0].short + (n > 1 ? ` ${t("и ещё")} ${n - 1}` : "")) : t("пока нет"))}
        ${it("boiler", "mode_heat", t("Котёл и режимы"), t("расчёт, режимы котла, сценарии"))}</div>`;
  }

  function renderSettings() {
    const it = moreItem, unit = P().view.unit === "pct" ? "проценты (литры в скобках)" : "литры (проценты в скобках)";
    const val = (id) => { const el = q(id), o = el && el.selectedOptions[0]; return o ? e(o.textContent) : ""; };
    q("m-settings").innerHTML = `<div class="m-sect">${t("Приложение")}</div><div class="m-list">
        ${it("look", "language", t("Язык и тема"), `<span data-noi18n>${val("m-lang")}</span> · ${val("m-theme")}`)}
        ${it("unit", "straighten", t("Единицы"), t(unit), "")}
        ${it("rate", "local_fire_department", t("Расход на главной"), t(RATE_LABEL[ctx.mset.homeRate] || RATE_LABEL.month), "")}
        ${it("camera", "photo_camera", t("Камера и распознавание"), "")}
        ${it("notify", "notifications", t("Напоминания"), "", `<span class="m-sw${ctx.mset.notify ? " on" : ""}" id="m-sw-notify"></span>`)}
        ${it("widget", "widgets", t("Виджет"), "")}</div>
      <div class="m-sect">${t("Данные")}</div><div class="m-list">
        ${it("archive", "folder_zip", t("Архив"), "")}
        ${it("storage", "cloud_sync", t("Хранение"), "")}
        ${it("transfer", "ios_share", t("Поделиться и перенести"), "")}</div>`;
  }
  const refreshLists = () => { if (tab === "more" && !stack.length) renderMore(); if (stack[stack.length - 1] === "settings") renderSettings(); };

  function renderSuppliers() {
    const st = S(), list = st.suppliers || [];
    q("m-sup-list").innerHTML = list.length ? list.map((x) => {
      const s = H.supplierStats(x.id, st.refuels);
      return `<button type="button" class="m-li" data-sup="${e(x.id)}">${logo(x, "m-lead pr m-ini")}<span class="m-mid"><span class="m-h">${e(x.short)}</span>${x.full ? `<span class="m-s">${e(x.full)}</span>` : ""}
        <span class="m-s m-small">${s.last ? `${dm(s.last.t)}${s.last.price != null ? ` · ${nf(s.last.price, 2)} ₽/${t("л")}` : ""} · ${s.count} ${t(H.plural(s.count, "заказ", "заказа", "заказов"))}` : t("заказов ещё не было")}</span></span>${ic("chevron_right")}</button>`;
    }).join("") : `<p class="m-hint">${t("Поставщиков пока нет.")}</p>`;
  }

  const BRAND = { wa: '<svg class="m-brand" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.1a8.9 8.9 0 0 0-7.7 13.4L3.1 20.9l4.5-1.2A8.9 8.9 0 1 0 12 3.1z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path fill="currentColor" d="M9.1 7.5c.2-.4.4-.4.6-.4h.5c.2 0 .4 0 .5.4l.7 1.7c.1.2.1.4 0 .5l-.4.6c-.1.2-.2.3 0 .5.4.8 1.1 1.5 1.9 2 .2.1.4.1.5 0l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.3 0 .2 0 .8-.2 1.4-.3.6-1.4 1.2-2 1.2-.5 0-1.1.2-3.5-.8-2.9-1.3-4.5-4.2-4.7-4.4-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9 1-2.3z"/></svg>', tg: '<svg class="m-brand" viewBox="1.6 2.6 20 20" aria-hidden="true"><path fill="currentColor" d="M3.4 11.4 19.6 5.2c.8-.3 1.5.2 1.2 1.4l-2.8 13c-.2.9-.8 1.2-1.5.7l-4.2-3.1-2 2c-.2.2-.4.4-.9.4l.3-4.3 7.8-7c.3-.3-.1-.5-.5-.2l-9.6 6.1-4.1-1.3c-.9-.3-.9-.9.2-1.3z"/></svg>' };
  const logo = (x, cls) => (/^data:image\/(png|jpeg|webp);base64,/.test(x.logo || "") ? `<span class="${cls} m-logo"><img src="${e(x.logo)}" alt=""></span>` : `<span class="${cls}">${e(H.initials(x.short))}</span>`);
  function renderSupplier() {
    const st = S(), x = (st.suppliers || []).find((y) => y.id === supId);
    if (!x) { q("m-sup-card").innerHTML = `<p class="m-hint">${t("Нет такого поставщика")}</p>`; return; }
    const c = H.contacts(x), own = (st.refuels || []).filter((r) => r.supplier === x.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const act = (href, icon, label, main) => `<a class="m-act${main ? " main" : ""}${BRAND[icon] ? " " + icon : ""}${href ? "" : " off"}" ${href ? `href="${e(href)}"` : 'aria-disabled="true"'}><span>${BRAND[icon] || ic(icon, 1)}</span>${t(label)}</a>`;
    const row = (icon, h, s, href) => `<${href ? `a href="${e(href)}"` : "div"} class="m-li"><span class="m-lead${BRAND[icon] ? " " + icon : ""}">${BRAND[icon] || ic(icon)}</span><span class="m-mid"><span class="m-h">${e(h)}</span>${s ? `<span class="m-s">${e(s)}</span>` : ""}</span></${href ? "a" : "div"}>`;
    const rows = [x.phone && row("call", x.phone, t("телефон"), c.call), x.telegram && row("tg", x.telegram, "Telegram", c.tg), x.whatsapp && row("wa", x.whatsapp, "WhatsApp", c.wa),
      x.messenger && row("send", x.messenger, t("мессенджер"), c.msg), x.email && row("mail", x.email, "e-mail", c.mail), x.address && row("location_on", x.address, ""),
      x.minOrder && row("local_gas_station", `${nf(+x.minOrder)} ${t("л")}`, t("минимальный заказ")), x.deliveryDays && row("schedule", `${x.deliveryDays} ${t("дн.")}`, t("срок доставки")),
      x.note && row("info", x.note, t("комментарий"))].filter(Boolean);
    q("m-sup-card").innerHTML = `<div class="m-sup-head">${logo(x, "m-ava")}<div class="m-sup-name">${e(x.short)}</div>${x.full ? `<div class="m-muted">${e(x.full)}</div>` : ""}</div>
      <div class="m-acts">${act(c.call, "call", "Позвонить", true)}${act(c.wa, "wa", "WhatsApp")}${act(c.tg || (String(c.msg).startsWith("https://t.me/") ? c.msg : null), "tg", "Telegram")}${act(c.mail, "mail", "Почта")}</div>
      <div class="m-center m-sup-btns"><button type="button" class="m-btn tonal" id="m-sup-edit">${ic("edit")}${t("Изменить")}</button>${(curSupplier() || {}).id === x.id ? `<span class="m-btn m-cur">${ic("check", 1)}${t("Текущий поставщик")}</span>` : `<button type="button" class="m-btn tonal" id="m-sup-cur">${ic("star")}${t("Сделать текущим")}</button>`}</div>
      ${rows.length ? `<div class="m-sect">${t("Контакты")}</div><div class="m-list">${rows.join("")}</div>` : ""}
      <div id="m-sup-tanks">${supTanks(x)}</div>
      <div class="m-sect">${t("Заказы")}</div><div class="m-list">${own.length ? own.map((r) => `<button type="button" class="m-li" data-refuel="${e(r.id)}"><span class="m-lead pr">${ic("local_gas_station")}</span><span class="m-mid"><span class="m-h">${dmy(Date.parse(r.date + "T12:00:00"))} · ${nf(r.liters)} ${t("л")}</span><span class="m-s">${r.price != null ? `${nf(r.price, 2)} ₽/${t("л")}` : "—"}</span></span>${r.total != null ? `<span class="m-trail"><b>${nf(Math.round(r.total))} ₽</b></span>` : ""}</button>`).join("") : `<p class="m-hint">${t("заказов ещё не было")}</p>`}</div>`;
    q("m-title-t").textContent = x.short;
  }

  function supTanks(x) {
    if (!tankParams) return "";
    const list = H.servedTanks(x, tankParams);
    if (!list.length) return "";
    const due = (v) => { const st = H.dueState(v, Date.now()); return `<span class="m-s m-due ${st}">${ic(st === "over" ? "warning" : "schedule")}${t(st === "over" ? "ТО просрочено" : "следующее ТО")}: <span data-noi18n>${e(v)}</span></span>`; };
    const role = (r) => t(r.service && r.mount ? "монтаж и обслуживание" : r.service ? "обслуживание" : "монтаж");
    return `<div class="m-sect">${t("Ёмкости")}</div><div class="m-list">${list.map((r) => `<button type="button" class="m-li" data-sup-tank="${e(r.id)}"><span class="m-lead${r.service ? " pr" : ""}">${ic("propane_tank")}</span><span class="m-mid"><span class="m-h" data-noi18n>${e(r.name)}</span><span class="m-s">${role(r)}</span>${r.next ? due(r.next) : ""}</span>${ic("chevron_right")}</button>`).join("")}</div>`;
  }
  async function loadTankParams() {
    const cur = P().view.profile || "default", periods = {};
    const out = await Promise.all(P().profiles.map(async (p) => {
      const d = p.id === cur ? S() : await P().api("/api/data", {}, p.id).catch(() => ({}));
      return { id: p.id, name: tankName(p), params: (d.passport || {}).params || [], services: d.services || [], period: (d.settings || {}).servicePeriod };
    }));
    tankParams = out;
    if (stack[stack.length - 1] === "supplier") { const x = (S().suppliers || []).find((y) => y.id === supId); if (x) q("m-sup-tanks").innerHTML = supTanks(x); }
  }

  function title() {
    const top = stack[stack.length - 1];
    const prof = P().curProfile;
    const selecting = !!sel && !top && tab === "log";
    q("m-sel-all").hidden = q("m-sel-del").hidden = !selecting;
    q("m-log-sel").hidden = top || tab !== "log" || (!selecting && !!q("m-log").dataset.empty);
    q("m-log-sel").classList.toggle("on", selecting);
    q("m-log-sel").setAttribute("aria-pressed", selecting);
    q("m-log-sel").setAttribute("aria-label", t(selecting ? "Отменить выбор" : "Выбрать"));
    q("m-log-sel").innerHTML = ic("check_box", selecting);
    q("m-back").innerHTML = ic(selecting ? "close" : "arrow_back");
    q("m-back").setAttribute("aria-label", t(selecting ? "Отменить выбор" : "Назад"));
    if (selecting) {
      q("m-title-t").textContent = t("Выбрано: {n}", { n: sel.size });
      q("m-title").classList.remove("pick"); q("m-title-sub").hidden = true;
      q("m-back").hidden = false; q("m-bell").hidden = q("m-gear").hidden = q("m-menu").hidden = q("m-fab").hidden = true;
      return;
    }
    const txt = top ? (top === "supplier" ? (((S().suppliers || []).find((x) => x.id === supId) || {}).short || "") : t(SCREENS[top])) : tab === "home" ? (prof ? tankName(prof) : t("Газгольдер")) : t(TABS.find((x) => x[0] === tab)[2]);
    q("m-title-t").textContent = txt;
    const tankPick = !top;
    q("m-title").classList.toggle("pick", tankPick);
    q("m-title-sub").hidden = !prof || (top !== "tank" && (!tankPick || tab === "home" || P().profiles.length < 2));
    q("m-title-sub").textContent = prof ? tankName(prof) : "";
    q("m-title").setAttribute("role", tankPick ? "button" : "heading");
    q("m-title").setAttribute("aria-label", tankPick ? t("Сменить ёмкость") : "");
    q("m-back").hidden = !top;
    q("m-bell").hidden = q("m-gear").hidden = !!top;
    q("m-menu").hidden = !!top;
    const fab = q("m-fab");
    const mode = top ? (top === "suppliers" ? "sup" : top === "services" ? "svc" : "") : tab === "log" ? "log" : "";
    fab.hidden = !mode;
    fab.dataset.mode = mode;
    fab.innerHTML = ic("add");
    fab.setAttribute("aria-label", t(mode === "sup" ? "Добавить поставщика" : mode === "svc" ? "Добавить запись о ТО" : "Добавить"));
    bell();
  }

  function bell() {
    if (!ctx) return;
    const R = window.gasReminders, n = R.unread(ctx.mset.inbox), off = !R.anyOn(ctx.mset.rem), b = q("m-bell");
    b.querySelector(".ms").textContent = off ? "notifications_off" : "notifications";
    b.classList.toggle("off", off);
    q("m-bell-n").hidden = !n;
    q("m-bell-n").textContent = n > 99 ? "99+" : String(n);
    b.setAttribute("aria-label", t(off ? "Уведомления выключены" : "Уведомления") + (n ? " · " + t("непрочитанных: {n}", { n }) : ""));
    if (stack[stack.length - 1] === "inbox") renderInbox();
  }
  const KIND_IC = { photo: "photo_camera", level: "propane_tank", "level-repeat": "propane_tank", "service-week": "build", "service-day": "build", "service-over": "build" };
  function renderInbox() {
    const R = window.gasReminders, list = R.inboxView(ctx.mset.inbox);
    const row = (x) => `<button type="button" class="m-li${x.read ? "" : " unread"}" data-inbox="${e(R.inboxKey(x))}"><span class="m-lead${x.read ? "" : " pr"}">${ic(KIND_IC[x.kind] || "local_shipping")}</span><span class="m-mid"><span class="m-h" data-noi18n>${e(x.title)}</span><span class="m-s" data-noi18n>${e(x.body)}</span><span class="m-s m-small">${dmy(x.at)}</span></span>${x.read ? "" : '<span class="m-dot" aria-hidden="true"></span>'}</button>`;
    const unread = list.filter((x) => !x.read), read = list.filter((x) => x.read);
    q("m-inbox").innerHTML = (unread.length ? `<div class="m-sect">${t("Непрочитанные")}</div><div class="m-list">${unread.map(row).join("")}</div><div class="m-center m-pad"><button type="button" class="m-btn tonal" id="m-inbox-all">${ic("done_all")}${t("Отметить все прочитанными")}</button></div>` : "")
      + (read.length ? `<div class="m-sect">${t("Прочитанные")}</div><div class="m-list">${read.map(row).join("")}</div>` : "");
  }
  async function openInbox(key) {
    const x = (ctx.mset.inbox || []).find((y) => window.gasReminders.inboxKey(y) === key);
    if (!x) return;
    ctx.readInbox(key);
    if (x.pid && x.pid !== (P().view.profile || "default") && P().profiles.some((p) => p.id === x.pid)) await switchTank(x.pid);
    if (/^service/.test(x.kind || "") || x.open === "services") open("services");
    else if (x.kind === "photo") addReading();
    else if (x.kind) orderNow();
  }
  async function muteToggle() {
    const on = await ctx.toggleMute();
    if (on == null) return;
    bell();
    snack(t(on ? "Напоминания включены" : "Все напоминания выключены"));
  }

  const curSupplier = () => { const st = S(); return H.currentSupplier(st.refuels, st.suppliers, (ctx.mset.curSup || {})[P().view.profile || "default"]); };
  function go(href) {
    const a = document.createElement("a");
    a.href = href; a.rel = "noopener";
    if (/^https?:/.test(href)) a.target = "_blank";
    document.body.append(a); a.click(); a.remove();
  }
  async function orderNow() {
    const x = curSupplier();
    if (!x) { open("suppliers"); return; }
    const c = H.contacts(x);
    const opts = [["call", "call", "Позвонить"], ["sms", "sms", "SMS"], ["wa", "chat", "WhatsApp"], ["tg", "send", "Telegram"], ["msg", "forum", "Мессенджер"], ["mail", "mail", "Почта"]]
      .filter(([k]) => c[k] && (k !== "msg" || (c.msg !== c.tg && c.msg !== c.wa)));
    const v = await sheet(t("Связаться: {n}", { n: x.short }), [...opts, ["card", "storefront", "Карточка поставщика"]]);
    if (v === "card") { supId = x.id; open("supplier"); }
    else if (v) go(c[v]);
  }

  const PU = { day: ["день", "дня", "дней"], month: ["месяц", "месяца", "месяцев"], year: ["год", "года", "лет"] };
  const isoDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const servicesOf = () => S().services || [];
  function renderServices() {
    const st = S(), list = servicesOf(), sup = (id) => (st.suppliers || []).find((x) => x.id === id);
    const period = st.settings.servicePeriod, info = H.serviceInfo((st.passport || {}).params, period, list);
    const head = !period ? `${t("ТО не проводится: период ТО не указан в настройках ёмкости.")} <button type="button" class="link" data-more="tank">${t("Указать")}</button>`
      : `${t("Период ТО")}: ${nf(period.n)} ${t(H.plural(period.n, ...PU[period.unit]))}${info ? ` · ${t("следующее ТО")}: <span data-noi18n>${e(info.text)}</span>` : ""}`;
    q("m-svc").innerHTML = `<p class="m-hint">${head}</p>` + (list.length ? `<div class="m-list">${list.map((x) => `<button type="button" class="m-li" data-svc="${e(x.id)}"><span class="m-lead pr">${ic("build")}</span><span class="m-mid"><span class="m-h">${dmy(Date.parse(x.date + "T12:00:00"))}${sup(x.supplier) ? ` · <span data-noi18n>${e(sup(x.supplier).short)}</span>` : ""}</span>${x.works ? `<span class="m-s" data-noi18n>${e(x.works.split("\n")[0])}</span>` : ""}${x.note ? `<span class="m-s m-small" data-noi18n>${e(x.note)}</span>` : ""}</span>${x.cost != null ? `<span class="m-trail"><b>${nf(Math.round(x.cost))} ₽</b></span>` : ""}</button>`).join("")}</div>`
      : `<p class="m-hint">${t("Записей о ТО пока нет. Нажмите «+», чтобы добавить.")}</p>`);
  }
  function openService(x) {
    const st = S(), cur = curSupplier();
    q("m-svc-sup").innerHTML = `<option value="">${t("— не указан —")}</option>` + (st.suppliers || []).map((y) => `<option value="${e(y.id)}" data-noi18n>${e(y.short)}</option>`).join("");
    q("m-svc-id").value = x ? x.id : "";
    q("m-svc-sup").value = x ? x.supplier : cur ? cur.id : "";
    q("m-svc-date").value = x ? x.date : isoDay();
    q("m-svc-cost").value = x && x.cost != null ? x.cost : "";
    q("m-svc-works").value = x ? x.works : "";
    q("m-svc-note").value = x ? x.note : "";
    q("m-svc-err").textContent = "";
    q("m-svc-del").hidden = !x;
    open("service-edit");
  }
  async function saveService(ev) {
    ev.preventDefault();
    const body = { id: q("m-svc-id").value, supplier: q("m-svc-sup").value, date: q("m-svc-date").value, cost: q("m-svc-cost").value, works: q("m-svc-works").value, note: q("m-svc-note").value };
    try {
      S().services = (await P().api("/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).services;
      back(); P().render(); snack(t("Запись о ТО сохранена"));
    } catch (err) { q("m-svc-err").textContent = err.message; }
  }
  async function deleteService() {
    const id = q("m-svc-id").value;
    if (!id || !(await uiAsk(t("Удалить запись о ТО?"), { ok: t("Удалить"), danger: true }))) return;
    try {
      S().services = (await P().api("/api/services?id=" + encodeURIComponent(id), { method: "DELETE" })).services;
      back(); P().render(); snack(t("Запись о ТО удалена"));
    } catch (err) { q("m-svc-err").textContent = err.message; }
  }

  function show(name) {
    tab = name; stack = []; sel = null;
    document.querySelectorAll(".m-tab").forEach((el) => { el.hidden = el.dataset.tab !== name; });
    document.querySelectorAll(".m-screen").forEach((el) => { el.hidden = true; });
    document.querySelectorAll("#m-nav [data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === name));
    if (name === "log") renderLog();
    if (name === "more") renderMore();
    title();
    window.scrollTo(0, 0);
  }

  function open(screen, scrollTo) {
    sel = null;
    if (screen === "tank") q("m-pf-del").hidden = (P().view.profile || "default") === "default";
    if (stack[stack.length - 1] !== screen) stack.push(screen);
    document.querySelectorAll(".m-tab").forEach((el) => { el.hidden = true; });
    document.querySelectorAll(".m-screen").forEach((el) => { el.hidden = el.dataset.screen !== screen; });
    if (screen === "suppliers") renderSuppliers();
    if (screen === "settings") renderSettings();
    if (screen === "supplier") { renderSupplier(); loadTankParams(); }
    if (screen === "inbox") renderInbox();
    if (screen === "services") renderServices();
    title();
    if (screen === "supplier") q("m-title-t").textContent = ((S().suppliers || []).find((x) => x.id === supId) || {}).short || "";
    const el = scrollTo && q(scrollTo);
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); else window.scrollTo(0, 0);
  }

  function back() {
    if (!q("m-menu-pop").hidden) { q("m-menu-pop").hidden = true; return true; }
    if (sel && !stack.length) { endSelect(); return true; }
    if (stack.length) {
      stack.pop();
      const top = stack[stack.length - 1];
      if (top) { stack.pop(); open(top); } else show(tab);
      return true;
    }
    if (tab !== "home") { show("home"); return true; }
    return false;
  }

  function snack(msg) {
    const s = q("m-snack");
    clearTimeout(snack.tm);
    if (!msg) { s.hidden = true; return; }
    s.textContent = msg; s.hidden = false;
    snack.tm = setTimeout(() => { s.hidden = true; }, 3500);
  }

  function sheet(head, items) {
    q("m-sheet-h").textContent = head;
    q("m-sheet-b").innerHTML = items.map(([key, icon, label, raw]) => `<button type="button" class="m-li" data-pick="${e(key)}"><span class="m-lead">${ic(icon)}</span><span class="m-mid"><span class="m-h"${raw ? " data-noi18n" : ""}>${raw ? e(label) : t(label)}</span></span></button>`).join("");
    return new Promise((resolve) => {
      const d = q("m-sheet");
      const done = (v) => { d.removeEventListener("close", onClose); q("m-sheet-b").onclick = null; resolve(v); };
      const onClose = () => done(d.returnValue || null);
      d.returnValue = "";
      d.addEventListener("close", onClose);
      q("m-sheet-b").onclick = (ev) => { const b = ev.target.closest("[data-pick]"); if (b) d.close(b.dataset.pick); };
      d.showModal();
      d.focus();
    });
  }

  const tankName = (p) => (p.id === "default" && p.name === "Основной" ? t(p.name) : p.name);
  async function pickTank() {
    const list = P().profiles, cur = P().view.profile || "default";
    const v = await sheet(t("Ёмкость"), [...list.map((p) => ["p:" + p.id, p.id === cur ? "radio_button_checked" : "radio_button_unchecked", tankName(p), true]),
      ["new", "add", "Новая ёмкость"], ["share", "ios_share", "Поделиться"], ["import", "upload_file", "Загрузить"]]);
    if (v === "new") q("pf-new").click();
    if (v === "share") await shareTank();
    if (v === "import") q("m-import").click();
    if (v && v.startsWith("p:") && v.slice(2) !== cur) await switchTank(v.slice(2));
  }

  const SHARE_TYPES = { full: { app: true, data: true, photos: true }, both: { app: false, data: true, photos: true }, data: { app: false, data: true, photos: false }, photos: { app: false, data: false, photos: true }, app: { app: true, data: false, photos: false } };
  async function shareTank() {
    const v = await sheet(t("Поделиться: {n}", { n: tankName(P().curProfile || { id: "", name: "" }) }), [["full", "folder_zip", "Полный архив: данные, фото и настройки приложения"], ["both", "inventory_2", "Данные и фото"], ["data", "description", "Только данные, без фото"], ["photos", "photo_library", "Только фото"], ["app", "settings", "Только настройки приложения"]]);
    if (v) await ctx.shareTank({ ...SHARE_TYPES[v] });
  }

  async function switchTank(id) {
    await P().switchProfile(id);
    refreshLists();
    snack(t("Ёмкость: {n}", { n: tankName(P().curProfile || { id: "", name: "" }) }));
  }
  async function renameTank() {
    const id = P().view.profile || "default", p = P().profiles.find((x) => x.id === id);
    if (!p) return;
    const name = await uiPrompt(t("Новое название ёмкости:"), tankName(p), { ok: t("Сохранить") });
    if (!name || !name.trim() || name.trim() === tankName(p)) return;
    try {
      const r = await P().api("/api/profiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) });
      p.name = r.name; P().setProfiles(P().profiles);
      refreshLists();
      title(); snack(t("Название сохранено"));
    } catch (err) { snack(err.message); }
  }
  async function deleteTank(id) {
    const p = P().profiles.find((x) => x.id === id);
    if (!p || id === "default") return;
    if (!(await uiAsk(t("Показания, заправки, паспорт и фото этой ёмкости будут удалены из приложения."), { title: t("Удалить ёмкость «{n}»?", { n: tankName(p) }), ok: t("Удалить"), danger: true }))) return;
    try { await P().api("/api/profiles?id=" + encodeURIComponent(id), { method: "DELETE" }); }
    catch (err) { snack(err.message); return; }
    P().setProfiles(P().profiles.filter((x) => x.id !== id));
    if ((P().view.profile || "default") === id) { stack = []; await P().switchProfile("default"); show("more"); }
    else { P().render(); renderMore(); }
    snack(t("Ёмкость «{n}» удалена", { n: tankName(p) }));
  }

  function radio(head, options, cur) {
    return sheet(head, options.map(([k, l]) => [k, k === cur ? "radio_button_checked" : "radio_button_unchecked", l]));
  }

  async function addReading() {
    const v = await sheet(t("Добавить показания"), [["photo", "photo_camera", "Сфотографировать уровнемер"], ["gallery", "photo_library", "Выбрать фото из галереи"], ["manual", "edit_note", "Ввести уровень вручную"]]);
    if (v === "photo") ctx.takePhoto();
    if (v === "gallery") q("file").click();
    if (v === "manual") q("manual").click();
  }

  function openRefuel(r) {
    P().fillRefuel(r || null);
    q("m-rf-del").hidden = !r;
    open("refuel");
    pending = { kind: "refuel" };
  }

  function wire() {
    q("m-nav").addEventListener("click", (ev) => { const b = ev.target.closest("[data-nav]"); if (b) show(b.dataset.nav); });
    q("m-back").onclick = () => back();
    let bellTm = null, bellLong = false;
    q("m-bell").addEventListener("pointerdown", () => { bellLong = false; clearTimeout(bellTm); bellTm = setTimeout(() => { bellLong = true; muteToggle(); }, 600); });
    for (const k of ["pointerup", "pointerleave", "pointercancel"]) q("m-bell").addEventListener(k, () => clearTimeout(bellTm));
    q("m-bell").addEventListener("contextmenu", (ev) => ev.preventDefault());
    q("m-bell").onclick = () => { if (bellLong) { bellLong = false; return; } open("inbox"); };
    q("m-gear").onclick = () => open("settings");
    q("m-menu").onclick = (ev) => {
      ev.stopPropagation();
      const pop = q("m-menu-pop");
      const sync = q("m-sync") && q("m-sync").checked;
      pop.innerHTML = [["new", "add", "Новая ёмкость"], ["share", "ios_share", "Поделиться"], ["import", "upload_file", "Загрузить"], ...(sync ? [["sync", "cloud_sync", "Синхронизировать сейчас"]] : [])]
        .map(([k, icon, l]) => `<button type="button" data-menu="${k}">${ic(icon)}${t(l)}</button>`).join("");
      pop.hidden = !pop.hidden;
    };
    document.addEventListener("click", (ev) => {
      const pop = q("m-menu-pop");
      const b = ev.target.closest("#m-menu-pop [data-menu]");
      if (b && b.dataset.menu === "share") open("transfer");
      else if (b) q({ import: "m-import", sync: "m-sync-now", new: "pf-new" }[b.dataset.menu]).click();
      if (!pop.hidden && !ev.target.closest("#m-menu")) pop.hidden = true;
    });
    q("m-title").addEventListener("click", () => { if (q("m-title").classList.contains("pick")) pickTank(); });
    q("m-add").onclick = () => addReading();
    q("m-to").onclick = () => open("services");
    q("m-order").onclick = () => orderNow();
    q("m-svc-form").addEventListener("submit", saveService);
    q("m-svc-del").onclick = () => deleteService();
    q("m-fab").onclick = async () => {
      const mode = q("m-fab").dataset.mode;
      if (mode === "sup") { P().fillSupplier(null); q("m-sup-del").hidden = true; open("supplier-edit"); pending = { kind: "supplier" }; return; }
      if (mode === "svc") { openService(null); return; }
      const v = await sheet(t("Добавить"), [["reading", "add_a_photo", "Показание"], ["refuel", "local_gas_station", "Заправка"]]);
      if (v === "reading") addReading();
      if (v === "refuel") openRefuel(null);
    };
    q("m-log-chips").addEventListener("click", (ev) => { const b = ev.target.closest("[data-filter]"); if (b) { filter = b.dataset.filter; renderLog(); } });
    q("m-log-sel").onclick = () => (sel ? endSelect() : select(null));
    q("m-range").addEventListener("click", (ev) => { const b = ev.target.closest("[data-range]"); if (b) { ctx.mset.homeRange = b.dataset.range; ctx.saveM(); if (lastA) q("m-mini").innerHTML = mini(lastA); } });
    q("m-sel-all").onclick = () => selectAll();
    q("m-sel-del").onclick = () => deleteSelected();
    q("m-log").addEventListener("contextmenu", (ev) => {
      const b = ev.target.closest("[data-key]");
      if (!b) return;
      ev.preventDefault();
      if (!sel || !sel.has(b.dataset.key)) select(b.dataset.key);
    });
    q("m-rf-del").onclick = async () => {
      const id = q("rf-id").value;
      if (!id || !(await uiAsk(t("Удалить заправку?"), { ok: t("Удалить"), danger: true }))) return;
      try {
        await P().api("/api/refuels?id=" + encodeURIComponent(id), { method: "DELETE" });
        const st = S(); st.refuels = st.refuels.filter((x) => x.id !== id);
        pending = null; P().fillRefuel(null); back(); P().render(); snack(t("Заправка удалена"));
      } catch (err) { snack(err.message); }
    };
    const main = q("m-main");
    main.addEventListener("click", async (ev) => {
      const pk = ev.target.closest(".m-pick");
      if (pk) { ev.preventDefault(); await choose(pk); return; }
      const pickRow = sel && ev.target.closest("#m-log [data-key]");
      if (pickRow) { select(pickRow.dataset.key); return; }
      const rd = ev.target.closest("[data-reading]"), rf = ev.target.closest("[data-refuel]"), sp = ev.target.closest("[data-sup]"), mo = ev.target.closest("[data-more]");
      if (ev.target.closest("#m-sup-edit")) editSupplier();
      if (ev.target.closest("#m-sup-cur")) { ctx.mset.curSup[P().view.profile || "default"] = supId; ctx.saveM(); renderSupplier(); if (lastA) renderHome(lastA); snack(t("Текущий поставщик выбран")); }
      const ib = ev.target.closest("[data-inbox]"), sv = ev.target.closest("[data-svc]");
      if (ev.target.closest("#m-inbox-all")) ctx.readInbox(null);
      if (ib) await openInbox(ib.dataset.inbox);
      if (sv) openService(servicesOf().find((x) => x.id === sv.dataset.svc));
      if (rd) { const r = S().readings.find((x) => x.id === rd.dataset.reading); if (r) P().openEditor({ file: r.file, existing: r, date: r.date, time: r.time }); }
      if (rf) openRefuel(S().refuels.find((x) => x.id === rf.dataset.refuel));
      if (sp) { supId = sp.dataset.sup; open("supplier"); }
      const st = ev.target.closest("[data-sup-tank]");
      if (st) { const id = st.dataset.supTank; stack = []; if (id !== (P().view.profile || "default")) await switchTank(id); show("more"); open("tank"); open("passport"); }
      if (mo) await more(mo.dataset.more, ev);
      const tk = ev.target.closest("[data-tank]"), sw = ev.target.closest("[data-tank-sw]"), tm = ev.target.closest("[data-tank-main]"), td = ev.target.closest("[data-tank-del]");
      if (sw && sw.dataset.tankSw !== (P().view.profile || "default")) await switchTank(sw.dataset.tankSw);
      if (tk) { if (tk.dataset.tank !== (P().view.profile || "default")) await switchTank(tk.dataset.tank); open("tank"); }
      if (tm) await makeMainTank(tm.dataset.tankMain);
      if (td) await deleteTank(td.dataset.tankDel);
    });
    q("m-sup-del").onclick = async () => {
      const id = q("sp-id").value;
      if (!id || !(await uiAsk(t("Удалить поставщика?"), { ok: t("Удалить"), danger: true }))) return;
      try {
        await P().api("/api/suppliers?id=" + encodeURIComponent(id), { method: "DELETE" });
        const st = S(); st.suppliers = st.suppliers.filter((x) => x.id !== id);
        stack = ["suppliers"]; open("suppliers"); P().render();
      } catch (err) { snack(err.message); }
    };
    document.addEventListener("submit", (ev) => {
      if (ev.target.id === "rf-form") pending = { kind: "refuel", n: S().refuels.length, id: q("rf-id").value };
      if (ev.target.id === "sp-form") pending = { kind: "supplier", id: q("sp-id").value, n: (S().suppliers || []).length, ids: new Set((S().suppliers || []).map((x) => x.id)) };
    }, true);
    q("m-pf-new").onclick = () => q("pf-new").click();
    q("m-pf-save").onclick = () => q("settings").requestSubmit();
    q("m-pf-ren").onclick = () => renameTank();
    q("m-pf-del").onclick = () => deleteTank(P().view.profile || "default");
  }

  function editSupplier() {
    const x = (S().suppliers || []).find((y) => y.id === supId);
    if (!x) return;
    P().fillSupplier(x); q("m-sup-del").hidden = false; open("supplier-edit"); pending = { kind: "supplier" };
  }

  async function makeMainTank(id) {
    const p = P().profiles.find((x) => x.id === id);
    if (!p) return;
    const name = tankName(p);
    if (await P().makeMain(id)) { show("more"); snack(t("«{n}» — теперь основная ёмкость", { n: name })); }
  }

  async function choose(row) {
    const sel = row.querySelector("select");
    const v = await sheet(row.querySelector(".m-h").textContent, [...sel.options].map((o) => [o.value, o.value === sel.value ? "radio_button_checked" : "radio_button_unchecked", o.textContent, true]));
    if (v == null || v === sel.value) return;
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function more(key) {
    if (["tank", "passport", "boiler", "suppliers", ...PANES].includes(key)) return open(key);
    if (key === "tank-new") return q("pf-new").click();
    if (key === "rate") {
      const v = await radio(t("Расход на главной"), Object.entries(RATE_LABEL), ctx.mset.homeRate || "month");
      if (v) { ctx.mset.homeRate = v; ctx.saveM(); renderSettings(); if (lastA) renderHome(lastA); }
      return;
    }
    if (key === "unit") {
      const v = await radio(t("Единицы"), [["l", "литры (проценты в скобках)"], ["pct", "проценты (литры в скобках)"]], P().view.unit || "l");
      const b = v && document.querySelector(`#unit [data-u="${v}"]`);
      if (b) { b.click(); renderSettings(); }
    }
  }

  function update(A) {
    if (!ctx) return;
    lastA = A;
    document.querySelectorAll("section.panel.folded").forEach((x) => x.classList.remove("folded"));
    renderHome(A);
    if (tab === "log" && !stack.length) renderLog();
    refreshLists();
    const top = stack[stack.length - 1];
    if (top === "suppliers") renderSuppliers();
    if (top === "supplier") renderSupplier();
    if (top === "services") renderServices();
    if (pending && pending.n != null) {
      const st = S();
      if (pending.kind === "refuel" && top === "refuel" && !q("rf-err").textContent && (st.refuels.length !== pending.n || pending.id) && !q("rf-id").value) { pending = null; back(); snack(t("Заправка сохранена")); }
      else if (pending.kind === "supplier" && top === "supplier-edit" && !q("sp-err").textContent && !q("sp-id").value) {
        const fresh = (st.suppliers || []).find((x) => !pending.ids.has(x.id));
        pending = null; back();
        if (fresh) { supId = fresh.id; open("supplier"); }
        if (stack[stack.length - 1] === "supplier") renderSupplier();
        snack(t("Поставщик сохранён"));
      }
    }
    title();
  }

  function reveal(panel, focusId) {
    const map = { refuels: () => openRefuel(null), readings: () => open("readings"), plan: () => show("stats"), level: () => show("stats"), stats: () => show("stats"), months: () => show("stats"), calc: () => open("boiler"), passport: () => open("passport"), phone: () => open("settings"), suppliers: () => open("suppliers"), summary: () => show("home") };
    (map[panel] || (() => show("home")))();
    if (focusId) setTimeout(() => { const el = q(focusId); if (el) el.focus(); }, 300);
  }

  window.gasShell = {
    init(c) { ctx = c; build(); window.gasStatus = snack; },
    update, back, reveal, openRefuel, addReading, show, open, pickTank, bell, snack, orderNow, applyOrder,
    get active() { return !!ctx; },
    get where() { return stack[stack.length - 1] || tab; },
    get selected() { return sel ? [...sel] : null; },
  };
})();
