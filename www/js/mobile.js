"use strict";
(function () {
  const Cap = window.Capacitor;
  const native = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const Pl = (Cap && Cap.Plugins) || {};
  const q = (id) => document.getElementById(id);
  const DAY = 864e5;
  const I = window.gasI18n;
  const t = I.t;

  window.addEventListener("error", (e) => {
    if (!/SyntaxError|Unexpected token/i.test(String(e.message))) return;
    document.body.innerHTML = '<div style="padding:24px;font:16px sans-serif">' + t("Нужно обновить «Android System WebView» (или Chrome) в Google Play — текущая версия слишком старая для приложения.") + "</div>";
  });
  document.documentElement.classList.add(native ? "is-native" : "is-web");

  const THEME_KEY = "gas-theme";
  const THEMES = ["system", "light", "dark"];
  const themeParam = new URLSearchParams(location.search).get("theme");
  const getTheme = () => { if (THEMES.includes(themeParam)) return themeParam; try { const v = localStorage.getItem(THEME_KEY); return THEMES.includes(v) ? v : "system"; } catch { return "system"; } };
  function applyTheme(v) {
    const root = document.documentElement;
    if (v === "light" || v === "dark") root.dataset.theme = v; else delete root.dataset.theme;
    const dark = v === "dark" || (v === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    if (Pl.SystemBars) Pl.SystemBars.setStyle({ style: v === "system" ? "DEFAULT" : dark ? "DARK" : "LIGHT" }).catch(() => {});
  }
  function setTheme(v) { try { localStorage.setItem(THEME_KEY, v); } catch {} applyTheme(v); if (typeof render === "function") try { render(); } catch {} }
  applyTheme(getTheme());
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (getTheme() === "system") applyTheme("system"); });

  function setLang(v) {
    if (v === I.lang) return;
    I.setLang(v);
    if (native && Pl.GasNative) Pl.GasNative.setLanguage({ lang: v }).catch(() => {});
    setTimeout(() => location.reload(), 50);
  }

  let backend = null, cacheFS = null;
  const tools = {
    exifDateTime: window.gasExif.exifDateTime,
    async verify(bytes) { const bm = await createImageBitmap(new Blob([bytes])); bm.close && bm.close(); },
    async thumb(bytes) {
      const bm = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
      const k = Math.min(1, 160 / Math.max(bm.width, bm.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bm.width * k)); cv.height = Math.max(1, Math.round(bm.height * k));
      cv.getContext("2d").drawImage(bm, 0, 0, cv.width, cv.height);
      bm.close && bm.close();
      const blob = await new Promise((res) => { const tm = setTimeout(() => res(null), 5000); cv.toBlob((b) => { clearTimeout(tm); res(b); }, "image/jpeg", 0.8); });
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  };
  async function loadDemo(fs) {
    try {
      const list = await (await fetch("demo/files.json")).json();
      for (const p of list) {
        const r = await fetch("demo/" + p);
        if (r.ok) await fs.write(/\.(jpe?g|png)$/i.test(p) ? "media/default/img/" + p.split("/").pop() : "data/default/" + p, new Uint8Array(await r.arrayBuffer()));
      }
    } catch (e) { console.warn("demo", e); }
  }
  const ready = (async () => {
    const S = window.gasStorage;
    const fs = native ? await S.capFS(Pl.Filesystem, Cap, "DATA") : S.memFS();
    cacheFS = native ? await S.capFS(Pl.Filesystem, Cap, "CACHE") : S.memFS();
    backend = window.gasBackend.createBackend(fs, tools);
    await backend.init();
    if (!native && new URLSearchParams(location.search).has("demo")) await loadDemo(fs);
    if (!native) setTimeout(() => { const s = q("sub"); if (s) s.insertAdjacentHTML("afterend", `<div class="warn m-demo">${t("Демо-режим в браузере: данные хранятся только до перезагрузки страницы.")}</div>`); }, 0);
  })();
  window.gasReady = ready;
  window.gasFetch = async (path, opts) => { await ready; return backend.gasFetch(path, opts); };
  window.gasImgUrl = (kind, file, pid) => (backend ? backend.imgUrl(kind, file, pid) : "");

  const MKEY = "gas-mobile";
  const mset = Object.assign({ notify: false, photoDays: 14, sched: {} }, (() => { try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch { return {}; } })());
  const saveM = () => { try { localStorage.setItem(MKEY, JSON.stringify(mset)); } catch {} };

  const themeButtons = () => THEMES.map((v) => `<button type="button" data-theme-set="${v}">${t({ system: "Как в системе", light: "Светлая", dark: "Тёмная" }[v])}</button>`).join("");
  const langButtons = () => `<button type="button" data-lang-set="ru" data-noi18n>Русский</button><button type="button" data-lang-set="en">English</button>`;

  const panel = document.createElement("section");
  panel.className = "panel"; panel.dataset.panel = "phone"; panel.setAttribute("aria-label", t("Приложение"));
  panel.innerHTML = `
    <div class="panel-head"><h2>${t("Приложение")}</h2><span class="muted" id="m-sum"></span></div>
    <div class="m-grid">
      <div class="m-card">
        <h3>${t("Язык и тема")}</h3>
        <div class="m-row"><span class="label">${t("Язык")}</span><div class="seg" id="m-lang">${langButtons()}</div></div>
        <div class="m-row"><span class="label">${t("Тема")}</span><div class="seg" id="m-theme">${themeButtons()}</div></div>
      </div>
      <div class="m-card">
        <h3>${t("Напоминания")}</h3>
        <label class="m-check"><input type="checkbox" id="m-notify"> ${t("Присылать уведомления")}</label>
        <label class="m-inline">${t("Напомнить сфотографировать уровнемер, если нет показаний")}
          <input type="number" id="m-photo-days" min="1" max="120" step="1" inputmode="numeric"> ${t("дн.")}</label>
        <div class="muted m-small">${t("Когда пора заказывать газ, когда уровень подходит к минимуму. Считается на телефоне, без интернета.")}</div>
        <div class="muted m-small" id="m-next"></div>
      </div>
      <div class="m-card">
        <h3>${t("Поделиться и перенести")}</h3>
        <div class="m-btns">
          <button type="button" id="m-share">${t("Отправить архив ёмкости")}</button>
          <button type="button" id="m-share-lite">${t("Без фото (маленький)")}</button>
          <button type="button" id="m-import">${t("Загрузить архив…")}</button>
          <input type="file" id="m-import-file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
        </div>
        <div class="muted m-small">${t("Архив .zip — тот же набор файлов, что у настольной версии (таблицы CSV, паспорт, фото). Его можно отправить почтой или в мессенджер, другой человек загрузит его как новую ёмкость.")}</div>
        <div class="status" id="m-share-st"></div>
      </div>
      <div class="m-card">
        <h3>${t("Резервная копия")}</h3>
        <div class="muted m-small">${t("Таблицы и настройки (без фото) входят в резервную копию Android в вашем Google-аккаунте, если она включена в настройках телефона, и восстанавливаются на новом телефоне. Фото сохраняйте архивом.")}</div>
        <div class="muted m-small">${t("Синхронизация через ваш Google Диск — в следующих версиях.")}</div>
        <h3 style="margin-top:12px">${t("Виджет")}</h3>
        <div class="muted m-small">${t("Долгое нажатие на рабочем столе → «Виджеты» → «Газгольдер»: уровень сейчас и сколько дней до минимума.")}</div>
      </div>
    </div>`;
  const before = document.querySelector('section[data-panel="passport"]');
  if (before) before.parentNode.insertBefore(panel, before);

  function markChoice() {
    const th = getTheme();
    document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === th)));
    document.querySelectorAll("[data-lang-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.langSet === (welcomeLang || I.lang))));
  }
  let welcomeLang = null;
  document.addEventListener("click", (e) => {
    const th = e.target.closest("[data-theme-set]"), lg = e.target.closest("[data-lang-set]");
    if (th) { setTheme(th.dataset.themeSet); markChoice(); }
    if (lg && !lg.closest("#m-welcome")) setLang(lg.dataset.langSet);
    if (lg && lg.closest("#m-welcome")) { welcomeLang = lg.dataset.langSet; markChoice(); }
  });

  if (!I.chosen) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="m-welcome" class="m-welcome" data-noi18n>
        <h2>Газгольдер · Gazgolder</h2>
        <div class="m-row"><span class="label">Язык · Language</span><div class="seg">${langButtons()}</div></div>
        <div class="m-row"><span class="label">Тема · Theme</span><div class="seg">
          <button type="button" data-theme-set="system">Как в системе · System</button>
          <button type="button" data-theme-set="light">Светлая · Light</button>
          <button type="button" data-theme-set="dark">Тёмная · Dark</button></div></div>
        <div class="muted m-small">Язык и тему можно поменять позже в панели «Приложение».<br>You can change them later in the «App» panel.</div>
        <div class="actions"><button type="button" class="primary" id="m-welcome-ok">Начать · Start</button></div>
      </dialog>`);
    welcomeLang = I.lang;
    q("m-welcome").addEventListener("cancel", (e) => e.preventDefault());
    q("m-welcome-ok").onclick = () => {
      I.setLang(welcomeLang);
      q("m-welcome").close();
      if (native && Pl.GasNative) Pl.GasNative.setLanguage({ lang: welcomeLang }).catch(() => {});
      if (welcomeLang !== I.lang) location.reload();
    };
    window.addEventListener("load", async () => {
      if (native && Pl.GasNative) {
        try { const sys = ((await Pl.GasNative.getLanguage()).lang || "").slice(0, 2); if (I.LANGS.includes(sys)) welcomeLang = sys; } catch {}
      }
      markChoice();
      q("m-welcome").showModal();
    });
  }

  const drop = q("drop");
  if (drop) {
    const pick = q("pick");
    const cam = document.createElement("span");
    cam.innerHTML = ` <button type="button" class="primary" id="m-camera">${t("Сфотографировать")}</button><input type="file" id="m-camera-file" accept="image/*" capture="environment" hidden>`;
    pick.insertAdjacentElement("beforebegin", cam);
    pick.classList.remove("primary");
    cam.querySelector("#m-camera").onclick = () => q("m-camera-file").click();
    cam.querySelector("#m-camera-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) uploadFiles(f); };
  }

  const lvlLabel = q("ed-level") && q("ed-level").closest("label");
  if (lvlLabel) {
    lvlLabel.insertAdjacentHTML("afterend", `<div class="m-recog" id="m-recog-row" hidden><button type="button" id="m-recog">${t("Распознать по фото")}</button> <span class="muted m-small" id="m-recog-st"></span></div>`);
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="m-recog-dlg" class="m-recog-dlg">
        <canvas id="m-recog-cv"></canvas>
        <div class="m-recog-res" id="m-recog-res"></div>
        <div class="m-small muted">${t("Синяя окружность — найденная шкала, розовая линия — стрелка. Если разметка неверная, введите уровень вручную.")}</div>
        <div class="actions"><button type="button" class="primary" id="m-recog-use">${t("Подставить")}</button><button type="button" id="m-recog-cancel">${t("Отмена")}</button></div>
      </dialog>`);
    const toggle = () => { q("m-recog-row").hidden = !(native && Pl.GasNative && q("ed-img").getAttribute("src")); q("m-recog-st").textContent = ""; };
    new MutationObserver(toggle).observe(q("ed-img"), { attributes: true, attributeFilter: ["src"] });
    q("m-recog").onclick = recognize;
    q("m-recog-cancel").onclick = () => q("m-recog-dlg").close();
    q("m-recog-use").onclick = () => { const v = q("m-recog-use").dataset.v; if (v) q("ed-level").value = v; q("m-recog-dlg").close(); q("ed-level").focus(); };
  }

  async function recognize() {
    const st = q("m-recog-st"), btn = q("m-recog");
    const file = typeof current !== "undefined" && current && current.file;
    if (!file) return;
    btn.disabled = true; st.textContent = t("Распознаю…");
    try {
      const pid = view.profile || "default";
      const uri = await backend.fs.nativeUri(`media/${pid}/img/${file}`);
      const ocr = await Pl.GasNative.recognizeText({ path: uri });
      const img = new Image();
      img.src = window.gasImgUrl("img", file, pid);
      await img.decode();
      const w = ocr.width, h = ocr.height, cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const R = window.gasGauge.readGauge(ocr, (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; });
      if (!R.ok) { st.textContent = t(R.reason); return; }
      st.textContent = "";
      const S = R.scale, half = S.r * 1.5, sx = Math.max(0, S.cx - half), sy = Math.max(0, S.cy - half);
      const sw = Math.min(w - sx, half * 2), sh = Math.min(h - sy, half * 2);
      const out = q("m-recog-cv"), k = Math.min(1, 640 / Math.max(sw, sh));
      out.width = Math.round(sw * k); out.height = Math.round(sh * k);
      const oc = out.getContext("2d");
      oc.drawImage(cv, sx, sy, sw, sh, 0, 0, out.width, out.height);
      oc.setTransform(k, 0, 0, k, -sx * k, -sy * k);
      window.gasGauge.drawOverlay(oc, R);
      oc.setTransform(1, 0, 0, 1, 0, 0);
      const conf = t(R.confidence >= 0.8 ? "высокая" : R.confidence >= 0.55 ? "средняя" : "низкая — проверьте");
      q("m-recog-res").innerHTML = `${t("Уровень по стрелке: {v}%", { v: `<b>${R.value}</b>` })} <span class="muted">· ${t("уверенность {c}", { c: conf })}</span>`;
      q("m-recog-use").dataset.v = R.value;
      q("m-recog-use").textContent = t("Подставить {v}%", { v: R.value });
      q("m-recog-dlg").showModal();
    } catch (e) {
      st.textContent = t("Не удалось распознать: {e}", { e: e.message || e });
    } finally { btn.disabled = false; }
  }

  let renderTimer = null;
  window.gasOnRender = (A) => { clearTimeout(renderTimer); renderTimer = setTimeout(() => afterRender(A).catch((e) => console.error(e)), 400); };

  const profileName = () => { const p = typeof curProfile === "function" && curProfile(); const n = (p && p.name) || "Газгольдер"; return p && p.id === "default" && n === "Основной" ? t(n) : n; };

  async function afterRender(A) {
    const pid = view.profile || "default";
    const name = profileName();
    const s = state.settings, f = A.forecast, plan = A.plan;
    const level = A.nowLevel != null ? A.nowLevel : A.last ? A.last.level : null;
    q("m-sum").textContent = level == null ? "" : `${name}: ${Math.round(level)}%`;
    if (!native) return;
    const w = {
      name, lang: I.lang, volume: s.volume, minPct: s.minPct, maxPct: s.maxPct, updated: Date.now(),
      lastT: A.last ? A.last.t : null, lastLevel: A.last ? A.last.level : null,
      start: f && f.daily.length ? f.daily[0].t : null,
      levels: f ? f.daily.slice(0, 500).map((d) => Math.round(d.level * 10) / 10) : [],
      hit: f && f.hit ? f.hit : null,
      orderBy: plan && !plan.infeasible ? plan.latest : null,
      labels: {
        toMin: t("до минимума {n} дн."), refill: t("Пора заправляться").toLowerCase(), orderBy: t("заказать до {d}"),
        photo: t("фото от {d}"), noData: t("нет показаний — добавьте фото уровнемера"), liters: t("л"),
      },
    };
    try {
      await Pl.Preferences.set({ key: "widget", value: JSON.stringify(w) });
      if (Pl.GasNative) await Pl.GasNative.updateWidget();
    } catch (e) { console.warn("widget", e); }
    await scheduleFor(pid, name, A);
  }

  const LN = () => Pl.LocalNotifications;
  const at = (tm, hour) => { const d = new Date(tm); d.setHours(hour, 0, 0, 0); return +d; };
  const nextAt = (hour) => { let tm = at(Date.now(), hour); if (tm < Date.now() + 60e3) tm += DAY; return tm; };
  const fmtD = (tm) => new Date(tm).toLocaleDateString(I.locale, { day: "numeric", month: "long" });
  const pidNum = (pid) => { let h = 7; for (const c of pid) h = (h * 31 + c.charCodeAt(0)) % 200000; return h; };

  async function scheduleFor(pid, name, A) {
    if (!LN()) return;
    const ids = [1, 2, 3].map((k) => pidNum(pid) * 10 + k);
    try { await LN().cancel({ notifications: ids.map((id) => ({ id })) }); } catch {}
    if (!mset.notify) { delete mset.sched[pid]; saveM(); renderNext(); return; }
    const out = [], now = Date.now(), f = A.forecast, plan = A.plan;
    if (plan && !plan.infeasible && plan.best) {
      let tm = at(plan.best.t, 10), body = t("Выгодно заказать ≈ {l} л до {p}%.", { l: Math.round(plan.best.liters / 50) * 50, p: state.settings.maxPct });
      if (tm < now) { tm = plan.latest > now ? at(plan.latest, 10) : nextAt(10); body = t(plan.latest > now ? "Последний спокойный день для заказа с учётом доставки." : "Газ на исходе — закажите доставку."); }
      if (tm < now) tm = nextAt(10);
      out.push({ id: ids[0], title: t("Пора заказывать газ — {name}", { name }), body, at: tm });
    }
    if (f && f.hit) {
      const tm = Math.max(at(f.hit - 3 * DAY, 10), nextAt(10));
      if (f.hit > now) out.push({ id: ids[1], title: t("Газ подходит к минимуму — {name}", { name }), body: t("По прогнозу {d} уровень дойдёт до {p}%.", { d: fmtD(f.hit), p: state.settings.minPct }), at: tm });
    }
    if (A.last && mset.photoDays > 0) {
      const tm = Math.max(at(A.last.t + mset.photoDays * DAY, 19), nextAt(19));
      out.push({ id: ids[2], title: t("Сфотографируйте уровнемер — {name}", { name }), body: t("Последнее показание — {d}. Свежее фото уточнит прогноз.", { d: fmtD(A.last.t) }), at: tm });
    }
    if (out.length) {
      try {
        await LN().schedule({ notifications: out.map((n) => ({ id: n.id, title: n.title, body: n.body, channelId: "gas", schedule: { at: new Date(n.at), allowWhileIdle: true }, extra: { profile: pid } })) });
      } catch (e) { console.warn("notify", e); }
    }
    mset.sched[pid] = out.map((n) => ({ title: n.title, at: n.at }));
    saveM(); renderNext();
  }
  function renderNext() {
    const all = Object.values(mset.sched).flat().filter((n) => n.at > Date.now()).sort((a, b) => a.at - b.at);
    q("m-next").textContent = !mset.notify ? "" : all.length ? t("Ближайшее: {d} — «{t}»", { d: fmtD(all[0].at), t: all[0].title }) : t("Запланированных напоминаний нет");
  }
  async function ensureChannel() {
    try { await LN().createChannel({ id: "gas", name: t("Напоминания о газе"), description: t("Когда заказывать газ и фотографировать уровнемер"), importance: 4 }); } catch {}
  }

  q("m-notify").checked = mset.notify;
  q("m-photo-days").value = mset.photoDays;
  q("m-notify").onchange = async (e) => {
    if (e.target.checked && native && LN()) {
      let p = await LN().checkPermissions().catch(() => ({ display: "denied" }));
      if (p.display !== "granted") p = await LN().requestPermissions().catch(() => ({ display: "denied" }));
      if (p.display !== "granted") { e.target.checked = false; q("m-next").textContent = t("Уведомления запрещены — разрешите их в настройках телефона для приложения «Газгольдер»."); return; }
      await ensureChannel();
    }
    mset.notify = e.target.checked; saveM();
    if (typeof render === "function") render();
  };
  q("m-photo-days").onchange = (e) => { const v = Math.round(+e.target.value); mset.photoDays = v >= 1 && v <= 120 ? v : 14; e.target.value = mset.photoDays; saveM(); if (typeof render === "function") render(); };

  if (native && LN()) LN().addListener("localNotificationActionPerformed", (ev) => {
    const pid = ev && ev.notification && ev.notification.extra && ev.notification.extra.profile;
    if (pid && typeof switchProfile === "function" && pid !== view.profile) switchProfile(pid);
  });

  const st = (s) => { q("m-share-st").textContent = s; };
  const safeFile = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "gazgolder";
  async function exportZip(photos) {
    await ready;
    const fz = window.fflate, pid = view.profile || "default";
    const name = profileName();
    const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fname = `gazgolder-${safeFile(name)}-${stamp}${photos ? "" : "-no-photos"}.zip`, path = "export/" + fname;
    await cacheFS.rmrf("export");
    await cacheFS.write(path, new Uint8Array(0));
    let buf = [], size = 0, writes = Promise.resolve(), failed = null;
    const flush = () => { if (!size) return; const all = new Uint8Array(size); let o = 0; for (const b of buf) { all.set(b, o); o += b.length; } buf = []; size = 0; writes = writes.then(() => cacheFS.append(path, all)).catch((e) => { failed = e; }); };
    const zip = new fz.Zip((err, chunk, final) => { if (err) { failed = err; return; } buf.push(chunk); size += chunk.length; if (size > 2 << 20 || final) flush(); });
    let n = 0;
    await backend.exportFiles(pid, async (p, get) => {
      const data = await get();
      if (!data) return;
      const entry = /\.(jpe?g|png)$/i.test(p) ? new fz.ZipPassThrough(p) : new fz.ZipDeflate(p, { level: 6 });
      zip.add(entry); entry.push(data, true);
      st(t("Собираю архив: {n} файлов…", { n: ++n }));
      await writes;
      if (failed) throw failed;
    }, { photos });
    zip.end();
    await writes;
    if (failed) throw failed;
    return { path, fname, name };
  }
  async function share(photos) {
    const b1 = q("m-share"), b2 = q("m-share-lite");
    b1.disabled = b2.disabled = true; st(t("Собираю архив…"));
    try {
      const { path, fname, name } = await exportZip(photos);
      if (native) {
        const uri = (await Pl.Filesystem.getUri({ path, directory: "CACHE" })).uri;
        st("");
        await Pl.Share.share({ title: t("Газгольдер — {name}", { name }), text: t("Данные ёмкости «{name}» из приложения «Газгольдер».", { name }), files: [uri], dialogTitle: t("Отправить архив") });
      } else {
        const data = await cacheFS.read(path), a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([data], { type: "application/zip" })); a.download = fname; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
        st("");
      }
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) st(t("Не удалось: {e}", { e: e.message || e })); else st("");
    } finally { b1.disabled = b2.disabled = false; }
  }
  q("m-share").onclick = () => share(true);
  q("m-share-lite").onclick = () => share(false);

  q("m-import").onclick = () => q("m-import-file").click();
  q("m-import-file").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    await ready;
    st(t("Читаю архив…"));
    try {
      const imp = await backend.importBegin(file.name.replace(/\.zip$/i, "").slice(0, 60) || "Импорт");
      const fz = window.fflate, uz = new fz.Unzip(), pending = [];
      let failed = null, total = 0;
      uz.register(fz.UnzipInflate);
      uz.onfile = (f) => {
        if (f.name.endsWith("/")) return;
        const parts = [];
        let size = 0;
        f.ondata = (err, chunk, final) => {
          if (err) { failed = err; return; }
          size += chunk.length; total += chunk.length;
          if (size > 40 * 1024 * 1024 || total > 2 * 1024 ** 3) { failed = new Error(t("Слишком большой файл в архиве")); f.terminate(); return; }
          parts.push(chunk);
          if (final) {
            const all = new Uint8Array(size); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
            pending.push(imp.add(f.name, all).catch((er) => { failed = er; }));
          }
        };
        f.start();
      };
      const reader = file.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) { uz.push(new Uint8Array(0), true); break; }
        uz.push(value);
        if (failed) throw failed;
        if (pending.length > 8) { await Promise.all(pending.splice(0)); st(t("Загружаю… {n} МБ", { n: Math.round(total / 1048576) })); }
      }
      await Promise.all(pending);
      if (failed) throw failed;
      const res = await imp.finish();
      st(t("Загружено: «{name}», файлов: {n}", { name: res.name, n: res.files }));
      profiles = (await api("/api/profiles")).profiles;
      await switchProfile(res.id);
    } catch (err) { st(t("Не удалось загрузить архив: {e}", { e: err.message || err })); }
  };

  if (native && Pl.App) {
    Pl.App.addListener("backButton", () => {
      const open = [...document.querySelectorAll("dialog[open]")].filter((d) => d.id !== "m-welcome").pop();
      if (open) open.close(); else Pl.App.minimizeApp();
    });
    Pl.App.addListener("resume", () => { if (typeof render === "function" && backend) render(); });
  }

  window.addEventListener("load", () => ready.then(async () => {
    markChoice();
    renderNext();
    if (native && Pl.GasNative && I.chosen) {
      try {
        const sys = ((await Pl.GasNative.getLanguage()).lang || "").slice(0, 2);
        if (I.LANGS.includes(sys) && sys !== I.lang) { I.setLang(sys); location.reload(); return; }
        if (!sys) Pl.GasNative.setLanguage({ lang: I.lang }).catch(() => {});
      } catch {}
    }
    if (native && LN() && mset.notify) await ensureChannel();
    backend.ensureThumbs(view.profile || "default").then(() => { if (typeof render === "function") render(); }).catch(() => {});
  }).catch(() => {}));
})();
