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
  const RATE_LABEL = { day: "в сутки", month: "в месяц", half: "за 6 месяцев", year: "в год" };
  const RATE_SHORT = { day: "/сут", month: "/мес", half: "/6 мес", year: "/год" };
  const TABS = [["home", "home", "Главная"], ["log", "receipt_long", "Журнал"], ["stats", "monitoring", "Аналитика"], ["more", "settings", "Ещё"]];
  const SCREENS = { refuel: "Заправка", readings: "Показания", tank: "Ёмкость", passport: "Паспорт ёмкости", boiler: "Котёл и режимы", suppliers: "Поставщики", supplier: "", "supplier-edit": "Поставщик", app: "Приложение" };
  let ctx = null, tab = "home", stack = [], filter = "all", lastA = null, supId = null, pending = null;

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
      <div class="m-title" id="m-title"><span id="m-title-t"></span><span id="m-title-dd">${ic("arrow_drop_down")}</span><select id="m-tank" aria-label="${t("Ёмкость")}"></select></div>
      <button type="button" class="m-ib" id="m-bell" aria-label="${t("Напоминания")}">${ic("notifications")}</button>
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
    move("refuels", "refuel"); move("readings", "readings"); move("passport", "passport"); move("calc", "boiler"); move("phone", "app");
    const header = wrap.querySelector("header");
    if (header) { header.classList.add("m-tank-head"); q("m-scr-tank").append(header); }
    q("m-scr-tank").insertAdjacentHTML("beforeend", `<div class="m-btns m-pad"><button type="button" id="m-pf-new">${ic("add")}${t("Новая ёмкость")}</button><button type="button" id="m-pf-ren">${ic("edit")}${t("Переименовать")}</button><button type="button" class="danger" id="m-pf-del">${ic("delete")}${t("Удалить ёмкость")}</button></div>`);
    q("m-scr-suppliers").innerHTML = `<div class="m-list" id="m-sup-list"></div><p class="m-hint">${t("Поставщика можно выбрать при добавлении заправки. На главной показывается поставщик последнего заказа.")}</p>`;
    q("m-scr-supplier").innerHTML = `<div id="m-sup-card"></div>`;
    const sp = sec("suppliers");
    if (sp) { q("m-scr-supplier-edit").append(sp); sp.querySelector(".table-wrap")?.setAttribute("hidden", ""); }
    q("m-scr-supplier-edit").insertAdjacentHTML("beforeend", `<div class="m-btns m-pad"><button type="button" class="danger" id="m-sup-del" hidden>${ic("delete")}${t("Удалить поставщика")}</button></div>`);
    const sum = sec("summary");
    if (sum) sum.hidden = true;
    wire();
    show("home");
  }

  function homeSkeleton() {
    return `<div class="m-hero" id="m-hero">
        <div class="m-ring" id="m-ring"></div>
        <div class="m-hero-t"><span class="m-status" id="m-status"></span>
          <div class="m-days"><span class="m-big" id="m-days"></span><span class="m-muted" id="m-until"></span></div>
          <div class="m-rate" id="m-rate"></div></div>
        <button type="button" class="m-btn fill m-wide" id="m-add">${ic("add_a_photo")}${t("Добавить показания")}</button>
        <div class="m-small m-center" id="m-ago"></div>
      </div>
      <button type="button" class="x-card m-order" id="m-order">
        <span class="m-av">${tanker()}</span>
        <span class="m-order-t"><b id="m-order-h"></b><span class="m-small" id="m-order-s"></span><span class="m-small m-sup" id="m-order-sup"></span></span>
        ${ic("chevron_right")}
      </button>
      <div class="x-card m-chart"><div class="x-card-h"><b>${t("Уровень")}</b><span class="m-small">${t("6 мес. и прогноз")}</span></div><div id="m-mini"></div></div>`;
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
    const f = A.forecast, t1 = Math.max((f && f.hit) || now, now) + 6 * DAY, t0 = now - 183 * DAY;
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
    const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1);
    for (; +d < t1; d.setMonth(d.getMonth() + 2)) s += `<text x="${x(+d)}" y="${h - 3}" text-anchor="middle">${d.getMonth() === 0 ? d.getFullYear() : d.toLocaleDateString(I.locale, { month: "short" }).replace(".", "")}</text>`;
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
    const sup = s.supplier;
    q("m-order-sup").innerHTML = sup ? `${ic("storefront")}${e(sup.short)}${sup.price != null ? ` · ${nf(sup.price, 2)} ₽/${t("л")}` : ""} <span class="m-muted">(${dm(sup.t)})</span>` : "";
    q("m-order").dataset.sup = sup ? sup.id : "";
    q("m-mini").innerHTML = mini(A);
  }

  function renderLog() {
    const st = S(), V = st.settings.volume;
    document.querySelectorAll("#m-log-chips [data-filter]").forEach((b) => b.classList.toggle("on", b.dataset.filter === filter));
    const groups = H.journal(st.readings, st.refuels, V, filter);
    const sup = (id) => (st.suppliers || []).find((x) => x.id === id);
    q("m-log").innerHTML = groups.length ? groups.map((gr) => `<div class="m-sect">${e(new Date(gr.year, gr.month, 1).toLocaleDateString(I.locale, { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase()).replace(/\s*г\.$/, ""))}</div>
      <div class="m-list">${gr.items.map((it) => it.kind === "reading"
        ? `<button type="button" class="m-li" data-reading="${e(it.id)}"><span class="m-lead">${ic(it.file ? "photo_camera" : "edit_note")}</span>
            <span class="m-mid"><span class="m-h">${nf(it.level)} % · ${nf(Math.round(it.liters / 10) * 10)} ${t("л")}</span><span class="m-s">${dm(it.t)}, ${e((it.time || "").slice(0, 5))} · ${t(it.file ? "фото" : "вручную")}${it.note ? " · " + e(it.note) : ""}</span></span>
            ${it.delta == null ? "" : `<span class="m-trail"><b>${it.delta > 0 ? "+" : it.delta < 0 ? "−" : ""}${nf(Math.abs(it.delta))} %</b>${t("за")} ${nf(it.days)} ${t("дн.")}</span>`}</button>`
        : `<button type="button" class="m-li" data-refuel="${e(it.id)}"><span class="m-lead pr">${ic("local_gas_station")}</span>
            <span class="m-mid"><span class="m-h">${t("Заправка")} +${nf(it.liters)} ${t("л")}</span><span class="m-s">${dm(it.t)}${it.price != null ? ` · ${nf(it.price, 2)} ₽/${t("л")}` : ""}${sup(it.supplier) ? " · " + e(sup(it.supplier).short) : ""}</span></span>
            ${it.total != null ? `<span class="m-trail"><b>${nf(Math.round(it.total))} ₽</b></span>` : ""}</button>`).join("")}</div>`).join("")
      : `<p class="m-hint">${t("Записей пока нет. Нажмите «+», чтобы добавить показание или заправку.")}</p>`;
  }

  function renderMore() {
    const st = S(), set = st.settings, prof = P().curProfile || { name: t("Основной") };
    const n = (st.suppliers || []).length, unit = P().view.unit === "pct" ? "проценты (литры в скобках)" : "литры (проценты в скобках)";
    const it = (key, icon, h, s, trail = ic("chevron_right")) => `<button type="button" class="m-li set" data-more="${key}"><span class="m-lead">${ic(icon)}</span><span class="m-mid"><span class="m-h">${h}</span>${s ? `<span class="m-s">${s}</span>` : ""}</span>${trail}</button>`;
    q("m-more").innerHTML = `<div class="m-sect">${t("Ёмкость")}</div><div class="m-list">
        ${it("tank", "propane_tank", e(prof.name), `${nf(set.volume)} ${t("л")} · ${t("мин")} ${nf(set.minPct)} % · ${t("макс")} ${nf(set.maxPct)} %`)}
        ${it("passport", "description", t("Паспорт ёмкости"), t("параметры, документы, фото таблички"))}
        ${it("boiler", "mode_heat", t("Котёл и режимы"), t("расчёт, режимы котла, сценарии"))}
        ${it("suppliers", "storefront", t("Поставщики"), n ? (st.suppliers[0].short + (n > 1 ? ` ${t("и ещё")} ${n - 1}` : "")) : t("пока нет"))}</div>
      <div class="m-sect">${t("Приложение")}</div><div class="m-list">
        ${it("notify", "notifications", t("Напоминания"), t("заказ газа и фото уровнемера"), `<span class="m-sw${ctx.mset.notify ? " on" : ""}" id="m-sw-notify"></span>`)}
        ${it("rate", "local_fire_department", t("Расход на главной"), t(RATE_LABEL[ctx.mset.homeRate || "month"]), "")}
        ${it("unit", "straighten", t("Единицы"), t(unit), "")}
        ${it("look", "palette", t("Тема и язык"), "")}
        ${it("camera", "photo_camera", t("Камера и распознавание"), "")}</div>
      <div class="m-sect">${t("Данные")}</div><div class="m-list">
        ${it("sync", "cloud_sync", t("Google Диск"), t("синхронизация и совместный доступ"))}
        ${it("archive", "folder_zip", t("Архив и перенос"), t("архив в папку, отправить, загрузить"))}</div>`;
  }

  function renderSuppliers() {
    const st = S(), list = st.suppliers || [];
    q("m-sup-list").innerHTML = list.length ? list.map((x) => {
      const s = H.supplierStats(x.id, st.refuels);
      return `<button type="button" class="m-li" data-sup="${e(x.id)}"><span class="m-lead pr m-ini">${e(H.initials(x.short))}</span><span class="m-mid"><span class="m-h">${e(x.short)}</span>${x.full ? `<span class="m-s">${e(x.full)}</span>` : ""}
        <span class="m-s m-small">${s.last ? `${dm(s.last.t)}${s.last.price != null ? ` · ${nf(s.last.price, 2)} ₽/${t("л")}` : ""} · ${s.count} ${t(H.plural(s.count, "заказ", "заказа", "заказов"))}` : t("заказов ещё не было")}</span></span>${ic("chevron_right")}</button>`;
    }).join("") : `<p class="m-hint">${t("Поставщиков пока нет.")}</p>`;
  }

  function renderSupplier() {
    const st = S(), x = (st.suppliers || []).find((y) => y.id === supId);
    if (!x) { q("m-sup-card").innerHTML = `<p class="m-hint">${t("Нет такого поставщика")}</p>`; return; }
    const c = H.contacts(x), own = (st.refuels || []).filter((r) => r.supplier === x.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    const act = (href, icon, label, main) => `<a class="m-act${main ? " main" : ""}${href ? "" : " off"}" ${href ? `href="${e(href)}"` : 'aria-disabled="true"'}><span>${ic(icon, 1)}</span>${t(label)}</a>`;
    const row = (icon, h, s, href) => `<${href ? `a href="${e(href)}"` : "div"} class="m-li"><span class="m-lead">${ic(icon)}</span><span class="m-mid"><span class="m-h">${e(h)}</span>${s ? `<span class="m-s">${e(s)}</span>` : ""}</span></${href ? "a" : "div"}>`;
    const rows = [x.phone && row("call", x.phone, t("телефон"), c.call), x.messenger && row("send", x.messenger, t("мессенджер"), c.msg), x.email && row("mail", x.email, "e-mail", c.mail), x.address && row("location_on", x.address, ""), x.note && row("info", x.note, "")].filter(Boolean);
    q("m-sup-card").innerHTML = `<div class="m-sup-head"><span class="m-ava">${e(H.initials(x.short))}</span><div class="m-sup-name">${e(x.short)}</div>${x.full ? `<div class="m-muted">${e(x.full)}</div>` : ""}</div>
      <div class="m-acts">${act(c.call, "call", "Позвонить", true)}${act(c.write, "chat", "Написать")}${act(c.mail, "mail", "Почта")}</div>
      <div class="m-center"><button type="button" class="m-btn tonal" id="m-sup-edit">${ic("edit")}${t("Изменить")}</button></div>
      ${rows.length ? `<div class="m-sect">${t("Контакты")}</div><div class="m-list">${rows.join("")}</div>` : ""}
      <div class="m-sect">${t("Заказы")}</div><div class="m-list">${own.length ? own.map((r) => `<button type="button" class="m-li" data-refuel="${e(r.id)}"><span class="m-lead pr">${ic("local_gas_station")}</span><span class="m-mid"><span class="m-h">${dmy(Date.parse(r.date + "T12:00:00"))} · ${nf(r.liters)} ${t("л")}</span><span class="m-s">${r.price != null ? `${nf(r.price, 2)} ₽/${t("л")}` : "—"}</span></span>${r.total != null ? `<span class="m-trail"><b>${nf(Math.round(r.total))} ₽</b></span>` : ""}</button>`).join("") : `<p class="m-hint">${t("заказов ещё не было")}</p>`}</div>`;
    q("m-title-t").textContent = x.short;
  }

  function title() {
    const top = stack[stack.length - 1];
    const prof = P().curProfile;
    const txt = top ? (top === "supplier" ? (((S().suppliers || []).find((x) => x.id === supId) || {}).short || "") : t(SCREENS[top])) : tab === "home" ? (prof ? prof.name : t("Газгольдер")) : t(TABS.find((x) => x[0] === tab)[2]);
    q("m-title-t").textContent = txt;
    const tankPick = !top && tab === "home";
    q("m-title").classList.toggle("pick", tankPick);
    q("m-back").hidden = !top;
    q("m-bell").hidden = !!top;
    q("m-menu").hidden = !!top;
    const fab = q("m-fab");
    const mode = top ? (top === "suppliers" ? "sup" : "") : tab === "log" ? "log" : "";
    fab.hidden = !mode;
    fab.dataset.mode = mode;
    fab.innerHTML = mode === "sup" ? `${ic("add")}<span>${t("Поставщик")}</span>` : ic("add");
    fab.classList.toggle("ext", mode === "sup");
  }

  function show(name) {
    tab = name; stack = [];
    document.querySelectorAll(".m-tab").forEach((el) => { el.hidden = el.dataset.tab !== name; });
    document.querySelectorAll(".m-screen").forEach((el) => { el.hidden = true; });
    document.querySelectorAll("#m-nav [data-nav]").forEach((b) => b.classList.toggle("on", b.dataset.nav === name));
    if (name === "log") renderLog();
    if (name === "more") renderMore();
    title();
    window.scrollTo(0, 0);
  }

  function open(screen, scrollTo) {
    if (stack[stack.length - 1] !== screen) stack.push(screen);
    document.querySelectorAll(".m-tab").forEach((el) => { el.hidden = true; });
    document.querySelectorAll(".m-screen").forEach((el) => { el.hidden = el.dataset.screen !== screen; });
    if (screen === "suppliers") renderSuppliers();
    if (screen === "supplier") renderSupplier();
    title();
    if (screen === "supplier") q("m-title-t").textContent = ((S().suppliers || []).find((x) => x.id === supId) || {}).short || "";
    const el = scrollTo && q(scrollTo);
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 50); else window.scrollTo(0, 0);
  }

  function back() {
    if (!q("m-menu-pop").hidden) { q("m-menu-pop").hidden = true; return true; }
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
    s.textContent = msg; s.hidden = false;
    clearTimeout(snack.tm); snack.tm = setTimeout(() => { s.hidden = true; }, 3500);
  }

  function sheet(head, items) {
    q("m-sheet-h").textContent = head;
    q("m-sheet-b").innerHTML = items.map(([key, icon, label]) => `<button type="button" class="m-li" data-pick="${key}"><span class="m-lead">${ic(icon)}</span><span class="m-mid"><span class="m-h">${t(label)}</span></span></button>`).join("");
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
    open("refuel");
    pending = { kind: "refuel" };
  }

  function wire() {
    q("m-nav").addEventListener("click", (ev) => { const b = ev.target.closest("[data-nav]"); if (b) show(b.dataset.nav); });
    q("m-back").onclick = () => back();
    q("m-bell").onclick = () => open("app", "m-notify");
    q("m-menu").onclick = (ev) => {
      ev.stopPropagation();
      const pop = q("m-menu-pop");
      const sync = q("m-sync") && q("m-sync").checked;
      pop.innerHTML = [["share", "ios_share", "Отправить архив ёмкости"], ["import", "upload_file", "Загрузить архив…"], ...(sync ? [["sync", "cloud_sync", "Синхронизировать сейчас"]] : []), ["new", "add", "Новая ёмкость"]]
        .map(([k, icon, l]) => `<button type="button" data-menu="${k}">${ic(icon)}${t(l)}</button>`).join("");
      pop.hidden = !pop.hidden;
    };
    document.addEventListener("click", (ev) => {
      const pop = q("m-menu-pop");
      const b = ev.target.closest("#m-menu-pop [data-menu]");
      if (b) q({ share: "m-share", import: "m-import", sync: "m-sync-now", new: "pf-new" }[b.dataset.menu]).click();
      if (!pop.hidden && !ev.target.closest("#m-menu")) pop.hidden = true;
    });
    q("m-tank").addEventListener("change", async (ev) => {
      const v = ev.target.value;
      if (v === "__new") { q("pf-new").click(); fillTanks(); return; }
      await P().switchProfile(v);
    });
    q("m-add").onclick = () => addReading();
    q("m-order").onclick = () => { const id = q("m-order").dataset.sup; if (id) { supId = id; open("supplier"); } else show("stats"); };
    q("m-fab").onclick = async () => {
      const mode = q("m-fab").dataset.mode;
      if (mode === "sup") { P().fillSupplier(null); q("m-sup-del").hidden = true; open("supplier-edit"); pending = { kind: "supplier" }; return; }
      const v = await sheet(t("Добавить"), [["reading", "add_a_photo", "Показание"], ["refuel", "local_gas_station", "Заправка"]]);
      if (v === "reading") addReading();
      if (v === "refuel") openRefuel(null);
    };
    q("m-log-chips").addEventListener("click", (ev) => { const b = ev.target.closest("[data-filter]"); if (b) { filter = b.dataset.filter; renderLog(); } });
    const main = q("m-main");
    main.addEventListener("click", async (ev) => {
      const rd = ev.target.closest("[data-reading]"), rf = ev.target.closest("[data-refuel]"), sp = ev.target.closest("[data-sup]"), mo = ev.target.closest("[data-more]");
      if (ev.target.closest("#m-sup-edit")) editSupplier();
      if (rd) { const r = S().readings.find((x) => x.id === rd.dataset.reading); if (r) P().openEditor({ file: r.file, existing: r, date: r.date, time: r.time }); }
      if (rf) openRefuel(S().refuels.find((x) => x.id === rf.dataset.refuel));
      if (sp) { supId = sp.dataset.sup; open("supplier"); }
      if (mo) await more(mo.dataset.more, ev);
    });
    q("m-sup-del").onclick = async () => {
      const id = q("sp-id").value;
      if (!id || !confirm(t("Удалить поставщика?"))) return;
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
    q("m-pf-ren").onclick = () => q("pf-ren").click();
    q("m-pf-del").onclick = () => q("pf-del").click();
  }

  function editSupplier() {
    const x = (S().suppliers || []).find((y) => y.id === supId);
    if (!x) return;
    P().fillSupplier(x); q("m-sup-del").hidden = false; open("supplier-edit"); pending = { kind: "supplier" };
  }

  async function more(key) {
    if (["tank", "passport", "boiler", "suppliers"].includes(key)) return open(key);
    if (key === "look") return open("app", "m-lang");
    if (key === "camera") return open("app", "m-guided");
    if (key === "sync") return open("app", "m-sync-card");
    if (key === "archive") return open("app", "m-share");
    if (key === "notify") { q("m-notify").click(); setTimeout(renderMore, 300); return; }
    if (key === "rate") {
      const v = await radio(t("Расход на главной"), Object.entries(RATE_LABEL), ctx.mset.homeRate || "month");
      if (v) { ctx.mset.homeRate = v; ctx.saveM(); renderMore(); if (lastA) renderHome(lastA); }
      return;
    }
    if (key === "unit") {
      const v = await radio(t("Единицы"), [["l", "литры (проценты в скобках)"], ["pct", "проценты (литры в скобках)"]], P().view.unit || "l");
      const b = v && document.querySelector(`#unit [data-u="${v}"]`);
      if (b) { b.click(); renderMore(); }
    }
  }

  function fillTanks() {
    const list = P().profiles, view = P().view;
    q("m-tank").innerHTML = list.map((p) => `<option value="${e(p.id)}"${p.id === view.profile ? " selected" : ""}>${e(p.name)}</option>`).join("") + `<option value="__new">${t("+ Новая ёмкость…")}</option>`;
    q("m-tank").value = view.profile || "default";
  }

  function update(A) {
    if (!ctx) return;
    lastA = A;
    document.querySelectorAll("section.panel.folded").forEach((x) => x.classList.remove("folded"));
    renderHome(A);
    fillTanks();
    if (tab === "log" && !stack.length) renderLog();
    if (tab === "more" && !stack.length) renderMore();
    const top = stack[stack.length - 1];
    if (top === "suppliers") renderSuppliers();
    if (top === "supplier") renderSupplier();
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
    const map = { refuels: () => openRefuel(null), readings: () => open("readings"), plan: () => show("stats"), level: () => show("stats"), stats: () => show("stats"), months: () => show("stats"), calc: () => open("boiler"), passport: () => open("passport"), phone: () => open("app"), suppliers: () => open("suppliers"), summary: () => show("home") };
    (map[panel] || (() => show("home")))();
    if (focusId) setTimeout(() => { const el = q(focusId); if (el) el.focus(); }, 300);
  }

  window.gasShell = {
    init(c) { ctx = c; build(); },
    update, back, reveal, openRefuel, addReading, show, open,
    get active() { return !!ctx; },
    get where() { return stack[stack.length - 1] || tab; },
  };
})();
