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
  window.gasFetch = async (path, opts) => {
    await ready;
    const res = await backend.gasFetch(path, opts);
    const method = String((opts && opts.method) || "GET").toUpperCase();
    if (method !== "GET" && res.ok) syncSoon(8000);
    if (method === "POST" && res.ok && String(path).startsWith("/api/readings") && lastRecog) {
      try { const b = JSON.parse(opts.body); if (b.file === lastRecog.file && b.level !== "" && b.level != null) saveSample(+b.level).catch((e) => console.warn("sample", e)); } catch {}
    }
    return res;
  };
  window.gasImgUrl = (kind, file, pid) => (backend ? backend.imgUrl(kind, file, pid) : "");

  const MKEY = "gas-mobile";
  const REM = window.gasReminders;
  const mset = Object.assign({ sched: {} }, (() => { try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch { return {}; } })());
  mset.arch = Object.assign({ on: false, tree: "", dir: "", days: 7, photos: true, keep: 5, last: {}, sig: {} }, mset.arch || {});
  if (!mset.arch.where) mset.arch.where = mset.arch.tree ? "tree" : "default";
  if (!mset.arch.parts) mset.arch.parts = { app: false, data: true, photos: mset.arch.photos !== false };
  mset.arch.tanks = mset.arch.tanks || "all";
  mset.share = Object.assign({ tanks: "current", ids: [], parts: { app: false, data: true, photos: true } }, mset.share || {});
  if (!mset.gallery) mset.gallery = mset.saveGallery === false ? "off" : "camera";
  mset.rem = REM.cleanRem(mset.rem, mset);
  mset.notify = REM.anyOn(mset.rem);
  mset.inboxDays = REM.keepDays(mset.inboxDays);
  if (!Array.isArray(mset.inbox)) mset.inbox = [];
  if (!mset.curSup || typeof mset.curSup !== "object") mset.curSup = {};
  for (const k of ["photoDays", "repeatDays", "serviceRem", "saveGallery", "dynamic"]) delete mset[k];
  const saveM = () => { try { localStorage.setItem(MKEY, JSON.stringify(mset)); } catch {} };

  const LANG_NAMES = { en: { en: "English", ru: "Russian" }, ru: { en: "Английский", ru: "Русский" } };
  const langName = (v) => (LANG_NAMES[I.lang] || LANG_NAMES.en)[v] || v;
  const THEME_LABEL = { system: "Как в системе", light: "Светлая", dark: "Тёмная" };
  const langButtons = () => `<button type="button" data-lang-set="ru" data-noi18n>Русский</button><button type="button" data-lang-set="en">English</button>`;
  const ms = (n) => `<span class="ms" aria-hidden="true">${n}</span>`;
  const sw = (id, label) => `<label class="m-li m-tg"><span class="m-mid"><span class="m-h">${label}</span></span><input type="checkbox" id="${id}"></label>`;
  const opt = ([v, l, raw]) => `<option value="${v}"${raw ? " data-noi18n" : ""}>${l}</option>`;
  const pick = (id, label, opts) => `<label class="m-li m-pick"><span class="m-mid"><span class="m-h">${label}</span><span class="m-s" data-pick-v></span></span><select id="${id}">${opts.map(opt).join("")}</select></label>`;
  const num = (id, label, unit, attrs = "") => `<label class="m-li m-num"><span class="m-mid"><span class="m-h">${label}</span></span><input type="number" id="${id}" min="0" step="1" inputmode="numeric" ${attrs}><span class="m-u" id="${id}-u">${unit}</span></label>`;
  const act = (id, icon, label) => `<button type="button" class="m-li m-act-row" id="${id}"><span class="m-lead">${ms(icon)}</span><span class="m-mid"><span class="m-h">${label}</span></span></button>`;
  const sect = (h) => `<div class="m-sect">${h}</div>`;
  const list = (rows, id = "") => `<div class="m-list"${id ? ` id="${id}"` : ""}>${rows}</div>`;
  const TANK_OPTS = [["all", t("все")], ["main", t("основная")], ["current", t("текущая")], ["list", t("выбрать из списка")]];
  const parts = (p) => sw(p + "-full", t("Полный")) + sw(p + "-app", t("Настройки приложения")) + sw(p + "-data", t("Данные ёмкости")) + sw(p + "-photos", t("Фото"));
  const DEFAULT_DIR = "Documents/Gazgolder";

  const panel = document.createElement("section");
  panel.className = "panel"; panel.dataset.panel = "phone"; panel.setAttribute("aria-label", t("Приложение"));
  panel.innerHTML = `
    <div class="panel-head"><h2>${t("Приложение")}</h2><span class="muted" id="m-sum"></span></div>
    <div class="m-grid">
      <div class="m-card m-pane" id="m-p-look"><h3>${t("Язык и тема")}</h3>
        ${list(pick("m-lang", t("Язык"), I.LANGS.map((v) => [v, langName(v), true])) + pick("m-theme", t("Тема"), THEMES.map((v) => [v, t(THEME_LABEL[v])])))}
      </div>
      <div class="m-card m-pane" id="m-p-camera"><h3>${t("Камера и распознавание")}</h3>
        ${list(sw("m-guided", t("Камера с подсказкой-кругом")) + sw("m-autorecog", t("Распознавать уровень сразу после съёмки"))
          + pick("m-gallery", t("Сохранять снимки"), [["camera", t("в галерею, к снимкам камеры")], ["app", t("в галерею, в отдельную папку «Gazgolder»")], ["off", t("не сохранять")]]))}
      </div>
      <div class="m-card m-pane" id="m-p-notify"><h3>${t("Напоминания")}</h3>
        ${list(sw("m-notify", t("Все напоминания")))}
        ${sect(t("Фото уровнемера"))}${list(sw("m-rem-photo", t("Сделать фото")) + num("m-photo-days", t("Каждые"), t("дн."), 'max="365"'))}
        ${sect(t("Заправка"))}${list(sw("m-rem-refuel", t("Напоминание о заправке")) + num("m-rem-level", t("Когда уровень не выше"), "%", 'step="any"') + `<div class="m-li"><span class="m-mid"><span class="m-h">${t("Когда напоминать")}</span><span class="m-s" id="m-refuel-when"></span></span></div>` + num("m-repeat-days", t("Повторять каждые"), t("дн."), 'max="365"'))}
        ${sect(t("ТО"))}${list(sw("m-service-rem", t("Напоминание о ТО")) + num("m-service-days", t("Повторять каждые"), t("дн."), 'max="365"'))}
        ${sect(t("Уведомления"))}${list(num("m-inbox-days", t("Хранить уведомления"), t("дн."), 'min="1" max="365"'))}
        <div class="muted m-small m-pad" id="m-next"></div>
      </div>
      <div class="m-card m-pane" id="m-p-widget"><h3>${t("Виджет")}</h3>
        ${list(pick("m-widget-tank", t("Ёмкость на виджете"), [["current", t("текущая")], ["main", t("основная")]]) + act("m-widget-add", "widgets", t("Добавить виджет")) + act("m-widget-add-small", "widgets", t("Добавить маленький виджет 1×1")))}
        <div class="status" id="m-widget-st"></div>
      </div>
      <div class="m-card m-pane" id="m-p-archive"><h3>${t("Архив")}</h3>
        ${list(pick("m-arch-tanks", t("Ёмкости"), TANK_OPTS))}${list("", "m-arch-ids")}
        ${sect(t("Тип архива"))}${list(parts("m-arch"))}
      </div>
      <div class="m-card m-pane" id="m-p-storage"><h3>${t("Хранение")}</h3>
        ${sect(t("В папку"))}${list(sw("m-arch", t("Сохранять архив автоматически"))
          + pick("m-arch-where", t("Место хранения"), [["default", DEFAULT_DIR, true], ["tree", t("выбранная папка")]])
          + `<button type="button" class="m-li" id="m-arch-pick"><span class="m-mid"><span class="m-h">${t("Папка")}</span><span class="m-s" id="m-arch-dir" data-noi18n></span></span>${ms("chevron_right")}</button>`
          + pick("m-arch-days", t("Как часто"), [["1", t("каждый день")], ["7", t("раз в неделю")], ["30", t("раз в месяц")]])
          + num("m-arch-keep", t("Хранить последних архивов"), "", 'min="1" max="100"') + act("m-arch-now", "save", t("Сохранить сейчас")))}
        <div class="status m-pad" id="m-arch-st"></div>
        ${sect(t("Google Диск"))}${list(sw("m-sync", t("Синхронизировать с Google Диском")))}
        <div id="m-sync-opts" class="m-sub" hidden>
          <div class="muted m-small" id="m-sync-acc"></div>
          ${list(`<label class="m-li m-tg"><span class="m-mid"><span class="m-h" id="m-sync-tank-l"></span></span><input type="checkbox" id="m-sync-tank"></label>` + sw("m-sync-photos", t("Синхронизировать фото")) + sw("m-sync-wifi", t("Фото — только через Wi-Fi")))}
          <div class="m-btns">
            <button type="button" id="m-sync-now">${t("Синхронизировать сейчас")}</button>
            <button type="button" id="m-sync-access" hidden></button>
            <button type="button" id="m-sync-reup" hidden>${t("Выгрузить заново")}</button>
          </div>
          <div class="status" id="m-sync-st"></div>
          ${sect(t("Совместный доступ"))}
          <div class="muted m-small" id="m-mem"></div>
          <div class="m-inline m-share-row"><input type="email" id="m-mem-email" autocomplete="email" inputmode="email" placeholder="${t("почта второго человека")}"><button type="button" id="m-mem-add">${t("Открыть доступ")}</button></div>
          <div class="m-btns"><button type="button" id="m-join">${t("Открыть общую ёмкость…")}</button></div>
          <div class="status" id="m-mem-st"></div>
        </div>
      </div>
      <div class="m-card m-pane" id="m-p-transfer"><h3>${t("Поделиться и перенести")}</h3>
        ${sect(t("Поделиться"))}${list(pick("m-shr-tanks", t("Ёмкости"), TANK_OPTS))}${list("", "m-shr-ids")}${list(parts("m-shr"))}${list(act("m-share", "ios_share", t("Поделиться")))}
        ${sect(t("Загрузить"))}${list(act("m-import", "upload_file", t("Загрузить архив…")))}
        <input type="file" id="m-import-file" accept=".zip,application/zip,application/x-zip-compressed" hidden>
        <div class="status m-pad" id="m-share-st"></div>
      </div>
    </div>`;
  const before = document.querySelector('section[data-panel="passport"]');
  if (before) before.parentNode.insertBefore(panel, before);
  const shell = () => (native && window.gasShell && window.gasShell.active ? window.gasShell : null);
  if (native && window.gasShell) window.gasShell.init({ takePhoto: () => takePhoto(), mset, saveM, shareTank: (parts) => share({ tanks: "current", ids: [], parts }), toggleMute: () => toggleMute(), readInbox: (key) => readInbox(key) });

  function syncPicks() {
    document.querySelectorAll(".m-pick select").forEach((sel) => {
      const o = sel.selectedOptions[0], v = sel.closest(".m-pick").querySelector("[data-pick-v]");
      v.toggleAttribute("data-noi18n", !!(o && o.hasAttribute("data-noi18n")));
      v.textContent = o ? o.textContent : "";
    });
  }
  document.addEventListener("change", (e) => { if (e.target.closest && e.target.closest(".m-pick")) syncPicks(); });
  function markChoice() {
    const th = getTheme();
    document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === th)));
    document.querySelectorAll("[data-lang-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.langSet === (welcomeLang || I.lang))));
    q("m-theme").value = th; q("m-lang").value = I.lang;
    syncPicks();
  }
  let welcomeLang = null;
  document.addEventListener("click", (e) => {
    const th = e.target.closest("[data-theme-set]"), lg = e.target.closest("[data-lang-set]");
    if (th) { setTheme(th.dataset.themeSet); markChoice(); }
    if (lg) { welcomeLang = lg.dataset.langSet; markChoice(); }
  });
  q("m-theme").onchange = (e) => { setTheme(e.target.value); markChoice(); };
  q("m-lang").onchange = (e) => setLang(e.target.value);

  if (!I.chosen) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="m-welcome" class="m-welcome" data-noi18n>
        <h2>Газгольдер · Gazgolder</h2>
        <div class="m-row"><span class="label">Язык · Language</span><div class="seg">${langButtons()}</div></div>
        <div class="m-row"><span class="label">Тема · Theme</span><div class="seg">
          <button type="button" data-theme-set="system">Как в системе · System</button>
          <button type="button" data-theme-set="light">Светлая · Light</button>
          <button type="button" data-theme-set="dark">Тёмная · Dark</button></div></div>
        <div class="muted m-small">Язык и тему можно поменять позже в настройках.<br>You can change them later in Settings.</div>
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
    cam.querySelector("#m-camera").onclick = () => takePhoto();
    cam.querySelector("#m-camera-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) { autoRecog = mset.autoRecog !== false; withGallery(f.map((x) => toGallery(null, x)), uploadFiles(f)); } };
  }
  let autoRecog = false;
  async function withGallery(saves, upload) {
    await upload;
    const err = (await Promise.all(saves)).find(Boolean);
    if (err && window.gasStatus) window.gasStatus(err);
  }
  async function toGallery(path, file) {
    if (!native || mset.gallery === "off" || !Pl.GasNative) return "";
    const name = path ? path.split("/").pop() : file.name || "photo.jpg";
    let tmp = "";
    try {
      if (!path) {
        tmp = "gallery/" + Date.now() + "-" + name.replace(/[^\w.-]/g, "_");
        await cacheFS.write(tmp, new Uint8Array(await file.arrayBuffer()));
        path = (await Pl.Filesystem.getUri({ path: tmp, directory: "CACHE" })).uri;
      }
      await Pl.GasNative.saveToGallery({ path, name, album: mset.gallery });
      return "";
    } catch (e) {
      return e && e.code === "UNSUPPORTED" ? t("Сохранение в галерею работает на Android 10 и новее") : t("Не удалось сохранить фото в галерею: {e}", { e: (e && e.message) || e });
    } finally {
      if (tmp) await cacheFS.rmrf(tmp).catch(() => {});
    }
  }
  async function takePhoto() {
    if (native && Pl.GasNative && mset.guidedCamera !== false) {
      try {
        const r = await Pl.GasNative.capture({ hint: t("Поместите уровнемер в круг") });
        const raw = await Pl.Filesystem.readFile({ path: r.path });
        const bytes = typeof raw.data === "string" ? window.gasStorage.b64ToBytes(raw.data) : new Uint8Array(await raw.data.arrayBuffer());
        autoRecog = mset.autoRecog !== false;
        const name = r.path.split("/").pop();
        await withGallery([toGallery(r.path, name)], uploadFiles([new File([bytes], name, { type: "image/jpeg" })]));
        return;
      } catch (e) {
        if (e && e.code === "CANCELLED") return;
      }
    }
    q("m-camera-file").click();
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
    const toggle = () => {
      q("m-recog-row").hidden = !(native && Pl.GasNative && q("ed-img").getAttribute("src"));
      q("m-recog-st").textContent = "";
      if (autoRecog && !q("m-recog-row").hidden) { autoRecog = false; setTimeout(() => recognize().catch(() => {}), 400); }
    };
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
      try { grabSample(file, ocr, cv, R); } catch (e) { console.warn("sample", e); }
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
  window.gasOnMain = (id) => { const c = mset.curSup, a = c[id], b = c.default; delete c[id]; delete c.default; if (a) c.default = a; if (b) c[id] = b; saveM(); };
  window.gasOnRender = (A) => { if (shell()) shell().update(A); clearTimeout(renderTimer); renderTimer = setTimeout(() => afterRender(A).catch((e) => console.error(e)), 400); };

  const profileName = () => { const p = typeof curProfile === "function" && curProfile(); const n = (p && p.name) || "Газгольдер"; return p && p.id === "default" && n === "Основной" ? t(n) : n; };

  const WKEY = "gas-widget";
  const wcache = () => { try { return JSON.parse(localStorage.getItem(WKEY) || "{}") || {}; } catch { return {}; } };
  const tankList = () => (typeof profiles !== "undefined" && Array.isArray(profiles) ? profiles : []);
  const nameOf = (pid) => { const p = tankList().find((x) => x.id === pid); const n = (p && p.name) || "Газгольдер"; return pid === "default" && n === "Основной" ? t(n) : n; };
  function widgetPid() {
    const v = mset.widgetTank || "current", cur = view.profile || "default";
    if (v === "current") return cur;
    if (v === "main") return "default";
    return tankList().some((p) => p.id === v) ? v : cur;
  }
  async function pushWidget(w) {
    const c = wcache();
    if (w) { c[view.profile || "default"] = w; try { localStorage.setItem(WKEY, JSON.stringify(c)); } catch {} }
    const data = c[widgetPid()] || w;
    if (!native || !data) return;
    try {
      await Pl.Preferences.set({ key: "widget", value: JSON.stringify(data) });
      if (Pl.GasNative) await Pl.GasNative.updateWidget();
    } catch (e) { console.warn("widget", e); }
  }

  async function afterRender(A) {
    const pid = view.profile || "default";
    const name = profileName();
    const s = state.settings, f = A.forecast, plan = A.plan;
    const level = A.nowLevel != null ? A.nowLevel : A.last ? A.last.level : null;
    q("m-sum").textContent = level == null ? "" : `${name}: ${Math.round(level)}%`;
    renderTankLists();
    renderRem();
    pushArchConfig().catch(() => {});
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
    await pushWidget(w);
    await scheduleFor(pid, name, A);
  }

  const LN = () => Pl.LocalNotifications;
  const fmtD = (tm) => new Date(tm).toLocaleDateString(I.locale, { day: "numeric", month: "long" });
  const unitL = () => view.unit === "l";
  const fmtN = (v) => Number(v).toLocaleString(I.locale, { maximumFractionDigits: 1 });

  function collectInbox() {
    const now = Date.now(), fired = [];
    for (const [pid, list] of Object.entries(mset.sched)) for (const n of list || []) if (n.at <= now && n.id != null) fired.push({ ...n, pid });
    mset.inbox = REM.inboxAdd(mset.inbox, fired, now, mset.inboxDays);
    for (const pid of Object.keys(mset.sched)) mset.sched[pid] = (mset.sched[pid] || []).filter((n) => n.at > now);
    saveM();
    if (shell()) shell().bell();
  }
  function readInbox(key) {
    REM.markRead(mset.inbox, key);
    saveM();
    if (shell()) shell().bell();
  }
  async function toggleMute() {
    const on = REM.anyOn(mset.rem);
    if (on) { const m = REM.mute(mset.rem); mset.rem = m.rem; mset.remSaved = m.saved; }
    else {
      if (!(await allowNotify())) return null;
      mset.rem = REM.unmute(mset.rem, mset.remSaved);
    }
    remChanged();
    return !on;
  }
  async function scheduleFor(pid, name, A) {
    if (!LN()) return;
    collectInbox();
    try { await LN().cancel({ notifications: REM.idsFor(pid).map((id) => ({ id })) }); } catch {}
    if (!REM.anyOn(mset.rem)) { delete mset.sched[pid]; saveM(); renderNext(); return; }
    const V = state.settings.volume;
    const service = window.gasHome.serviceInfo((state.passport || {}).params, state.settings.servicePeriod);
    const levelText = (p) => (unitL() ? `${fmtN(Math.round(p * V / 100))} ${t("л")}` : `${fmtN(Math.round(p * 10) / 10)}%`);
    const out = REM.plan({ pid, name, A, settings: state.settings, rem: mset.rem, service, refuels: state.refuels, levelText, t, fmtD });
    if (out.length) {
      try {
        await LN().schedule({ notifications: out.map((n) => ({ id: n.id, title: n.title, body: n.body, channelId: "gas", isExactNotification: false, schedule: { at: new Date(n.at), allowWhileIdle: true }, extra: { profile: pid, open: n.open || "" } })) });
      } catch (e) { console.warn("notify", e); }
    }
    mset.sched[pid] = out.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.at, open: n.open || "" }));
    saveM(); renderNext();
  }
  function renderNext() {
    const all = Object.values(mset.sched).flat().filter((n) => n.at > Date.now()).sort((a, b) => a.at - b.at);
    q("m-next").textContent = !REM.anyOn(mset.rem) ? "" : all.length ? t("Ближайшее: {d} — «{t}»", { d: fmtD(all[0].at), t: all[0].title }) : t("Запланированных напоминаний нет");
  }
  async function ensureChannel() {
    try { await LN().createChannel({ id: "gas", name: t("Напоминания о газе"), description: t("Когда заказывать газ, фотографировать уровнемер и проводить ТО"), importance: 4 }); } catch {}
  }

  const REM_KEYS = [["m-rem-photo", "photo"], ["m-rem-refuel", "refuel"], ["m-service-rem", "service"]];
  const DAY_INPUTS = [["m-photo-days", "photo"], ["m-repeat-days", "refuel"], ["m-service-days", "service"]];
  function renderRem() {
    const r = mset.rem, st = typeof state !== "undefined" && state && state.settings ? state.settings : { volume: 4600, minPct: 20 };
    for (const [id, k] of REM_KEYS) q(id).checked = r[k].on;
    q("m-notify").checked = REM_KEYS.every(([, k]) => r[k].on);
    for (const [id, k] of DAY_INPUTS) if (document.activeElement !== q(id)) q(id).value = r[k].days;
    const L = unitL(), V = st.volume || 1, lv = r.refuel.level;
    const shown = lv == null ? null : r.refuel.unit === (L ? "l" : "pct") ? lv : L ? lv * V / 100 : lv / V * 100;
    if (document.activeElement !== q("m-rem-level")) q("m-rem-level").value = shown == null ? "" : Math.round(shown * 10) / 10;
    q("m-rem-level").placeholder = L ? String(Math.round(st.minPct * V / 100)) : String(st.minPct);
    q("m-rem-level-u").textContent = L ? t("л") : "%";
    const pct = REM.levelPct(r.refuel, { minPct: st.minPct, volume: V });
    q("m-refuel-when").textContent = t("за {n} дн. до уровня {p} (запас на заправку)", { n: st.leadDays ?? 14, p: L ? `${fmtN(Math.round(pct * V / 100))} ${t("л")}` : `${fmtN(Math.round(pct * 10) / 10)}%` });
    if (document.activeElement !== q("m-inbox-days")) q("m-inbox-days").value = mset.inboxDays;
    if (shell()) shell().bell();
  }
  const remChanged = () => { mset.notify = REM.anyOn(mset.rem); saveM(); renderRem(); renderNext(); if (typeof render === "function") render(); };
  async function allowNotify() {
    if (!(native && LN())) return true;
    let p = await LN().checkPermissions().catch(() => ({ display: "denied" }));
    if (p.display !== "granted") p = await LN().requestPermissions().catch(() => ({ display: "denied" }));
    if (p.display !== "granted") { q("m-next").textContent = t("Уведомления запрещены — разрешите их в настройках телефона для приложения «Газгольдер»."); return false; }
    await ensureChannel();
    return true;
  }
  async function setRem(keys, on) {
    if (on && !(await allowNotify())) { renderRem(); return; }
    for (const k of keys) mset.rem[k].on = on;
    remChanged();
  }
  q("m-notify").onchange = (e) => setRem(REM_KEYS.map(([, k]) => k), e.target.checked);
  for (const [id, k] of REM_KEYS) q(id).onchange = (e) => setRem([k], e.target.checked);
  for (const [id, k] of DAY_INPUTS) q(id).onchange = (e) => { const v = Math.round(+e.target.value); mset.rem[k].days = e.target.value !== "" && v >= 0 && v <= 365 ? v : REM.DEFAULTS[k].days; e.target.blur(); remChanged(); };
  q("m-inbox-days").onchange = (e) => { mset.inboxDays = REM.keepDays(e.target.value); e.target.blur(); collectInbox(); renderRem(); };
  q("m-rem-level").onchange = (e) => {
    const v = +String(e.target.value).replace(",", ".");
    const ok = e.target.value !== "" && Number.isFinite(v) && v >= 0 && (unitL() || v <= 100);
    Object.assign(mset.rem.refuel, { level: ok ? v : null, unit: unitL() ? "l" : "pct" });
    e.target.blur(); remChanged();
  };

  const inboxOf = (n) => { const x = (n && n.extra) || {}, list = mset.sched[x.profile] || [], s = list.find((y) => y.id === n.id); return s ? { ...s, pid: x.profile } : null; };
  const fired = (it, read) => {
    const now = Date.now(), x = { ...it, at: Math.min(it.at, now), read };
    mset.inbox = REM.inboxAdd(mset.inbox, [x], now, mset.inboxDays);
    if (read) REM.markRead(mset.inbox, REM.inboxKey(x));
    mset.sched[it.pid] = (mset.sched[it.pid] || []).filter((y) => y.id !== it.id);
    saveM();
  };
  if (native && LN()) LN().addListener("localNotificationReceived", (n) => { const it = inboxOf(n); if (it) { fired(it, false); if (shell()) shell().bell(); } });
  if (native && LN()) LN().addListener("localNotificationActionPerformed", async (ev) => {
    const n = (ev && ev.notification) || {}, x = n.extra || {}, pid = x.profile, it = inboxOf(n);
    if (it) fired(it, true);
    else { const old = (mset.inbox || []).find((y) => y.pid === pid && y.id === n.id); if (old) { old.read = true; saveM(); } }
    if (pid && typeof switchProfile === "function" && pid !== view.profile) await switchProfile(pid);
    if ((x.open === "passport" || x.open === "services") && window.gasShell) { window.gasShell.show("home"); window.gasShell.open("services"); }
    if (shell()) shell().bell();
  });

  const st = (s) => { q("m-share-st").textContent = s; };
  const safeFile = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "gazgolder";
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));
  function appSettings() {
    const m = JSON.parse(JSON.stringify(mset));
    delete m.sched; delete m.notify; delete m.inbox; delete m.curSup; delete m.remSaved;
    for (const k of ["on", "tree", "dir", "where", "last", "sig", "photos"]) delete m.arch[k];
    let v = {};
    try { v = JSON.parse(localStorage.getItem("gas-view") || "{}") || {}; } catch {}
    delete v.profile;
    return { format: "gazgolder-app", version: 1, lang: I.lang, theme: getTheme(), view: v, mobile: m };
  }
  function applyAppSettings(x) {
    const m = (x && x.mobile) || {};
    for (const k of ["guidedCamera", "autoRecog", "gallery", "homeRate", "homeRange", "homeOrder", "inboxDays", "rem", "widgetTank", "share", "samples"]) if (k in m) mset[k] = m[k];
    if (m.arch) for (const k of ["days", "keep", "tanks", "ids", "parts"]) if (k in m.arch) mset.arch[k] = m.arch[k];
    mset.rem = REM.cleanRem(mset.rem);
    mset.notify = REM.anyOn(mset.rem);
    mset.inboxDays = REM.keepDays(mset.inboxDays);
    saveM();
    if (x.view && typeof x.view === "object") { Object.assign(view, x.view, { profile: view.profile }); if (typeof saveView === "function") saveView(); }
    if (THEMES.includes(x.theme)) setTheme(x.theme);
    markChoice(); renderArch(); renderTankLists(); renderRem();
    if (shell()) shell().applyOrder();
    if (typeof render === "function") render();
    if (I.LANGS.includes(x.lang)) setLang(x.lang);
  }
  function resolveTanks(mode, ids) {
    const all = tankList().map((p) => p.id), cur = view.profile || "default";
    if (mode === "all") return all.length ? all : [cur];
    if (mode === "main") return ["default"];
    if (mode === "list") { const pick = (ids || []).filter((id) => all.includes(id)); return pick.length ? pick : [cur]; }
    return [cur];
  }

  async function exportZip({ pid = view.profile || "default", name = nameOf(pid), photos = true, data = true, app = false, dir = "export", fname = null, progress = st, clean = true } = {}) {
    await ready;
    const fz = window.fflate, only = !data && !photos;
    fname = fname || (only ? `gazgolder-settings-${today()}.zip` : `gazgolder-${safeFile(name)}-${today()}${!data ? "-photos" : photos ? "" : "-no-photos"}.zip`);
    const path = dir + "/" + fname;
    if (clean) await cacheFS.rmrf(dir);
    await cacheFS.write(path, new Uint8Array(0));
    let buf = [], size = 0, writes = Promise.resolve(), failed = null;
    const flush = () => { if (!size) return; const all = new Uint8Array(size); let o = 0; for (const b of buf) { all.set(b, o); o += b.length; } buf = []; size = 0; writes = writes.then(() => cacheFS.append(path, all)).catch((e) => { failed = e; }); };
    const zip = new fz.Zip((err, chunk, final) => { if (err) { failed = err; return; } buf.push(chunk); size += chunk.length; if (size > 2 << 20 || final) flush(); });
    let n = 0;
    const add = async (p, bytes) => {
      const entry = /\.(jpe?g|png)$/i.test(p) ? new fz.ZipPassThrough(p) : new fz.ZipDeflate(p, { level: 6 });
      zip.add(entry); entry.push(bytes, true);
      progress(t("Собираю архив: {n} файлов…", { n: ++n }));
      await writes;
      if (failed) throw failed;
    };
    if (only) await add("gazgolder.json", enc({ format: "gazgolder", version: 1, kind: "app", exported: new Date().toISOString() }));
    else await backend.exportFiles(pid, async (p, get) => { const bytes = await get(); if (bytes) await add(p, bytes); }, { photos, data, supplier: mset.curSup[pid] || "" });
    if (app) await add("app-settings.json", enc(appSettings()));
    zip.end();
    await writes;
    if (failed) throw failed;
    return { path, fname, name };
  }
  async function share(S = mset.share) {
    const b = q("m-share"), P = S.parts;
    b.disabled = true; st(t("Собираю архив…"));
    if (shell() && S !== mset.share) shell().snack(t("Собираю архив…"));
    try {
      await cacheFS.rmrf("export");
      const outs = [];
      if (!P.data && !P.photos) outs.push(await exportZip({ data: false, photos: false, app: true, dir: "export/0", clean: false }));
      else for (const [i, pid] of resolveTanks(S.tanks, S.ids).entries()) outs.push(await exportZip({ pid, photos: P.photos, data: P.data, app: P.app, dir: "export/" + i, clean: false }));
      if (native) {
        const files = [];
        for (const o of outs) files.push((await Pl.Filesystem.getUri({ path: o.path, directory: "CACHE" })).uri);
        st("");
        if (shell() && S !== mset.share) shell().snack("");
        const name = outs.length === 1 && P.data ? outs[0].name : t("Газгольдер");
        await Pl.Share.share({ title: t("Газгольдер — {name}", { name }), text: t("Данные из приложения «Газгольдер»."), files, dialogTitle: t("Отправить архив") });
      } else {
        for (const o of outs) {
          const data = await cacheFS.read(o.path), a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([data], { type: "application/zip" })); a.download = o.fname; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
        }
        st("");
      }
    } catch (e) {
      const msg = /cancel/i.test(String(e && e.message)) ? "" : t("Не удалось: {e}", { e: e.message || e });
      st(msg);
      if (shell() && S !== mset.share) shell().snack(msg);
    } finally { b.disabled = false; }
  }
  q("m-share").onclick = () => share();

  const PARTS = ["app", "data", "photos"];
  function renderParts(prefix, P) {
    for (const k of PARTS) q(`${prefix}-${k}`).checked = !!P[k];
    q(`${prefix}-full`).checked = PARTS.every((k) => P[k]);
  }
  function wireParts(prefix, get, changed) {
    q(`${prefix}-full`).onchange = (e) => { const P = get(); for (const k of PARTS) P[k] = e.target.checked || k === "data"; renderParts(prefix, P); changed(); };
    for (const k of PARTS) q(`${prefix}-${k}`).onchange = (e) => { const P = get(); P[k] = e.target.checked; if (!PARTS.some((x) => P[x])) P.data = true; renderParts(prefix, P); changed(); };
  }
  function renderIds(boxId, cfg) {
    const box = q(boxId);
    box.hidden = cfg.tanks !== "list";
    const ids = new Set(cfg.ids || []);
    box.innerHTML = cfg.tanks !== "list" ? "" : tankList().map((p) => `<label class="m-li m-tg"><span class="m-mid"><span class="m-h" data-noi18n>${String(nameOf(p.id)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))}</span></span><input type="checkbox" data-tank-id="${p.id}"${ids.has(p.id) ? " checked" : ""}></label>`).join("");
  }
  function wireIds(boxId, get, changed) {
    q(boxId).addEventListener("change", (e) => {
      const id = e.target.dataset && e.target.dataset.tankId;
      if (!id) return;
      const cfg = get(), ids = new Set(cfg.ids || []);
      if (e.target.checked) ids.add(id); else ids.delete(id);
      cfg.ids = [...ids]; changed();
    });
  }
  function renderTankLists() {
    q("m-arch-tanks").value = mset.arch.tanks; q("m-shr-tanks").value = mset.share.tanks;
    renderIds("m-arch-ids", mset.arch); renderIds("m-shr-ids", mset.share);
    renderParts("m-arch", mset.arch.parts); renderParts("m-shr", mset.share.parts);
    const sel = q("m-widget-tank");
    sel.innerHTML = [["current", t("текущая")], ["main", t("основная")], ...tankList().map((p) => [p.id, nameOf(p.id), true])].map(([v, l, raw]) => `<option value="${v}"${raw ? " data-noi18n" : ""}></option>`).join("");
    [...sel.options].forEach((o, i) => { o.textContent = i === 0 ? t("текущая") : i === 1 ? t("основная") : nameOf(o.value); });
    sel.value = [...sel.options].some((o) => o.value === mset.widgetTank) ? mset.widgetTank : "current";
    syncPicks();
  }
  const shareChanged = () => { saveM(); renderTankLists(); };
  q("m-shr-tanks").onchange = (e) => { mset.share.tanks = e.target.value; shareChanged(); };
  wireParts("m-shr", () => mset.share.parts, shareChanged);
  wireIds("m-shr-ids", () => mset.share, shareChanged);
  q("m-widget-tank").onchange = (e) => { mset.widgetTank = e.target.value; saveM(); pushWidget(null); };
  async function pin(small) {
    const ok = native && Pl.GasNative ? (await Pl.GasNative.pinWidget({ small }).catch(() => ({ ok: false }))).ok : false;
    q("m-widget-st").textContent = ok ? "" : t("Добавьте виджет вручную: долгое нажатие на рабочем столе → «Виджеты» → «Газгольдер».");
  }
  q("m-widget-add").onclick = () => pin(false);
  q("m-widget-add-small").onclick = () => pin(true);

  q("m-import").onclick = () => q("m-import-file").click();
  q("m-import-file").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    await ready;
    st(t("Читаю архив…"));
    let imp = null, done = false, appJson = null;
    try {
      imp = await backend.importBegin(file.name.replace(/\.zip$/i, "").slice(0, 60) || "Импорт");
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
            if (/(^|\/)app-settings\.json$/.test(f.name)) { try { appJson = JSON.parse(new TextDecoder().decode(all)); } catch {} return; }
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
      const app = appJson && appJson.format === "gazgolder-app" ? appJson : null;
      if (!res.files && !app) throw new Error(t("В архиве нет данных газгольдера"));
      if (!res.files) {
        await api("/api/profiles?id=" + encodeURIComponent(imp.id), { method: "DELETE" }).catch(() => {});
        done = true;
        st("");
        if (await uiAsk(t("Применить настройки приложения из архива?"), { ok: t("Применить") })) applyAppSettings(app);
        return;
      }
      done = true;
      st(t("Загружено: «{name}», файлов: {n}", { name: res.name, n: res.files }));
      if (res.supplier) { mset.curSup[res.id] = res.supplier; saveM(); }
      profiles = (await api("/api/profiles")).profiles;
      await switchProfile(res.id);
      if (app && (await uiAsk(t("Применить настройки приложения из архива?"), { ok: t("Применить") }))) applyAppSettings(app);
      if (res.main) await makeMain(res.id);
    } catch (err) {
      if (imp && !done) await api("/api/profiles?id=" + encodeURIComponent(imp.id), { method: "DELETE" }).catch(() => {});
      st(t("Не удалось загрузить архив: {e}", { e: err.message || err }));
    }
  };

  if (native && Pl.App) {
    Pl.App.addListener("backButton", () => {
      const open = [...document.querySelectorAll("dialog[open]")].filter((d) => d.id !== "m-welcome").pop();
      if (open) open.close(); else if (!(shell() && shell().back())) Pl.App.minimizeApp();
    });
    Pl.App.addListener("resume", () => {
      collectInbox();
      if (typeof render === "function" && backend) render();
      syncSoon(1500, 60e3);
      setTimeout(() => runArchive().catch(() => {}), 4000);
    });
  }

  window.addEventListener("load", () => ready.then(async () => {
    markChoice();
    collectInbox();
    renderNext();
    if (native && Pl.GasNative && I.chosen) {
      try {
        const sys = ((await Pl.GasNative.getLanguage()).lang || "").slice(0, 2);
        if (I.LANGS.includes(sys) && sys !== I.lang) { I.setLang(sys); location.reload(); return; }
        if (!sys) Pl.GasNative.setLanguage({ lang: I.lang }).catch(() => {});
      } catch {}
    }
    if (native && LN() && REM.anyOn(mset.rem)) await ensureChannel();
    backend.ensureThumbs(view.profile || "default").then(() => { if (typeof render === "function") render(); }).catch(() => {});
    await initSync();
    syncSoon(500);
    renderArch();
    renderTankLists();
    renderRem();
    setTimeout(() => runArchive().catch(() => {}), 6000);
  }).catch(() => {}));

  const SYNC = window.gasSync;
  let syncer = null, gToken = null, syncTimer = null, lastSync = 0, reloadWanted = false;
  const sst = (s) => { q("m-sync-st").textContent = s; };
  const mst = (s) => { q("m-mem-st").textContent = s; };
  const curPid = () => view.profile || "default";
  const errText = (e) => (e && (e.message || e.errorMessage)) || String(e);
  const cancelled = (e) => /cancel/i.test(String(e && (e.code || e.message)));
  const hasDrive = () => !!(native && Pl.GasDrive && syncer);
  async function token(force) {
    if (force && gToken) { await Pl.GasDrive.clearToken({ token: gToken }).catch(() => {}); gToken = null; }
    if (gToken) return gToken;
    const cfg = await syncer.loadConfig();
    gToken = (await Pl.GasDrive.authorize({ interactive: false, account: cfg.account })).accessToken;
    return gToken;
  }
  const driveApi = () => SYNC.driveClient({ token: (f) => token(f) });
  const onWifi = () => { const c = navigator.connection, ty = c && c.type; return !ty || ["wifi", "ethernet", "unknown", "other", "wimax"].includes(ty); };
  async function initSync() {
    if (!SYNC || !backend) return;
    syncer = SYNC.createSync({
      backend, fs: backend.fs, drive: driveApi(),
      photosAllowed: (cfg) => !cfg.wifiOnly || onWifi(),
      shareMessage: () => t("Приглашаю вести общий учёт газа в приложении «Газгольдер». Установите его, включите синхронизацию с Google Диском и нажмите «Открыть общую ёмкость…»."),
    });
    if (!(native && Pl.GasDrive)) {
      q("m-sync").disabled = true;
      q("m-sync").closest("label").insertAdjacentHTML("afterend", `<div class="muted m-small">${t("Синхронизация работает только в приложении на телефоне.")}</div>`);
      return;
    }
    await renderSync();
  }
  function syncSoon(ms, minGap = 0) {
    if (!hasDrive()) return;
    if (minGap && Date.now() - lastSync < minGap) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => runSync().catch((e) => { sst(t("Ошибка: {e}", { e: errText(e) })); }), ms);
  }
  async function runSync({ interactive = false } = {}) {
    if (!hasDrive()) return null;
    const cfg = await syncer.loadConfig();
    if (!cfg.enabled) return null;
    sst(t("Синхронизирую…"));
    let res = await syncer.syncAll();
    if (res.needConsent && interactive) {
      gToken = (await Pl.GasDrive.authorize({ interactive: true, account: cfg.account })).accessToken;
      res = await syncer.syncAll();
    }
    lastSync = Date.now();
    if ((res.changed && res.changed.length) || (res.created && res.created.length)) await reloadAfterSync(res);
    await renderSync(res);
    return res;
  }
  async function reloadAfterSync(res) {
    if (document.querySelector("dialog[open]")) {
      if (!reloadWanted) {
        reloadWanted = true;
        const tm = setInterval(() => { if (!document.querySelector("dialog[open]")) { clearInterval(tm); reloadWanted = false; reloadAfterSync(res); } }, 3000);
      }
      return;
    }
    try { profiles = (await api("/api/profiles")).profiles; } catch {}
    if (typeof renderProfiles === "function") renderProfiles();
    if ((res.changed || []).includes(curPid()) && typeof loadProfile === "function") await loadProfile();
  }
  const fmtDT = (tm) => new Date(tm).toLocaleString(I.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  async function renderSync(res) {
    if (!hasDrive()) return;
    const cfg = await syncer.loadConfig(), pid = curPid();
    q("m-sync").checked = cfg.enabled;
    q("m-sync-opts").hidden = !cfg.enabled;
    if (!cfg.enabled) return;
    q("m-sync-acc").textContent = cfg.account ? t("Аккаунт: {a}", { a: cfg.account }) : "";
    q("m-sync-photos").checked = cfg.photos;
    q("m-sync-wifi").checked = cfg.wifiOnly;
    q("m-sync-wifi").disabled = !cfg.photos;
    const excluded = pid in cfg.excluded;
    q("m-sync-tank").checked = !excluded;
    q("m-sync-tank-l").textContent = t("Синхронизировать ёмкость «{name}»", { name: profileName() });
    const stt = await syncer.loadState(pid);
    const need = await syncer.needAccess();
    q("m-sync-access").hidden = !need.length;
    q("m-sync-access").textContent = t("Открыть доступ к фото ({n})…", { n: need.length });
    q("m-sync-reup").hidden = !(stt && stt.gone);
    let line;
    if (res && res.needConsent) line = t("Нужно заново разрешить доступ к Google Диску — нажмите «Синхронизировать сейчас».");
    else if (excluded) line = t("Эта ёмкость не синхронизируется.");
    else if (stt && stt.gone) line = t("Файл этой ёмкости на Google Диске удалён или доступ к нему закрыт — синхронизация остановлена.");
    else if (stt && stt.error) line = t("Ошибка: {e}", { e: stt.error });
    else if (cfg.error && !stt) line = t("Ошибка: {e}", { e: cfg.error });
    else if (stt && stt.synced) line = t("Синхронизировано: {d}", { d: fmtDT(stt.synced) });
    else line = t("Ещё не синхронизировалась.");
    if (need.length) line += " " + t("Часть фото добавил другой человек — чтобы их скачать, откройте к ним доступ.");
    sst(line);
    const box = q("m-mem");
    box.textContent = "";
    if (stt && stt.owner && stt.owner !== cfg.account) box.append(t("Владелец: {a}", { a: stt.owner }), document.createElement("br"));
    const mem = (stt && stt.members) || [];
    const owner = await syncer.canManage(pid);
    if (mem.length) {
      box.append(t("Доступ открыт:") + " ");
      if (!owner) {
        const s = document.createElement("span");
        s.dataset.noi18n = ""; s.textContent = mem.join(", ");
        box.append(s, document.createElement("br"), t("Закрывать доступ может только владелец ёмкости."));
      }
      for (const m of owner ? mem : []) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "m-chip"; b.dataset.noi18n = ""; b.textContent = m + " ×"; b.title = t("Закрыть доступ");
        b.onclick = async () => {
          if (!(await uiAsk(t("Закрыть доступ для {a}?", { a: m }), { ok: t("Закрыть доступ"), danger: true }))) return;
          try { await syncer.unshare(pid, m); mst(t("Доступ закрыт.")); } catch (e) { mst(t("Не удалось: {e}", { e: errText(e) })); }
          renderSync();
        };
        box.append(b, " ");
      }
    }
    q("m-mem-add").disabled = q("m-mem-email").disabled = !stt || !!stt.gone || excluded;
  }

  q("m-sync").onchange = async (e) => {
    if (!hasDrive()) { e.target.checked = false; return; }
    const cfg = await syncer.loadConfig();
    if (!e.target.checked) {
      await syncer.updateConfig((c) => { c.enabled = false; }); gToken = null; clearTimeout(syncTimer);
      await renderSync();
      sst(t("Синхронизация выключена. Файлы на Google Диске остаются, отозвать доступ приложения можно в настройках Google-аккаунта."));
      return;
    }
    e.target.checked = false;
    try {
      sst(t("Вход в Google…"));
      gToken = (await Pl.GasDrive.authorize({ interactive: true, selectAccount: true })).accessToken;
      const who = await driveApi().about();
      const linked = Object.keys(await syncer.states());
      const switched = !!(cfg.account && who.email && cfg.account !== who.email && linked.length);
      if (switched) {
        if (!(await uiAsk(t("Раньше синхронизация шла с аккаунтом {a}. Переключиться на {b}? Ёмкости будут выгружены на новый аккаунт заново.", { a: cfg.account, b: who.email }), { ok: t("Переключиться") }))) { gToken = null; sst(""); return; }
        for (const pid of linked) await syncer.forget(pid, { ignore: false });
      }
      await syncer.updateConfig((c) => { Object.assign(c, { enabled: true, account: who.email || c.account, error: "" }); if (switched) { c.rootId = ""; c.ignored = []; } });
      await renderSync();
      await runSync({ interactive: true });
    } catch (err) {
      gToken = null;
      sst(cancelled(err) ? "" : t("Не удалось войти: {e}", { e: errText(err) }));
    }
  };
  for (const [id, key] of [["m-sync-photos", "photos"], ["m-sync-wifi", "wifiOnly"]]) {
    q(id).onchange = async (e) => { const v = e.target.checked; await syncer.updateConfig((c) => { c[key] = v; }); await renderSync(); syncSoon(1000); };
  }
  q("m-sync-tank").onchange = async (e) => {
    try { await syncer.setExcluded(curPid(), !e.target.checked); } catch (err) { sst(t("Не удалось: {e}", { e: errText(err) })); }
    await renderSync(); syncSoon(500);
  };
  q("m-sync-now").onclick = async () => {
    const b = q("m-sync-now"); b.disabled = true;
    try { await runSync({ interactive: true }); } catch (e) { sst(cancelled(e) ? "" : t("Ошибка: {e}", { e: errText(e) })); } finally { b.disabled = false; }
  };
  q("m-sync-reup").onclick = async () => {
    if (!(await uiAsk(t("Выгрузить ёмкость «{name}» на Google Диск заново, новым файлом?", { name: profileName() }), { ok: t("Выгрузить") }))) return;
    await syncer.forget(curPid(), { ignore: false });
    await runSync({ interactive: true }).catch((e) => sst(t("Ошибка: {e}", { e: errText(e) })));
  };
  q("m-sync-access").onclick = async () => {
    try {
      const cfg = await syncer.loadConfig(), ids = await syncer.needAccess();
      if (!ids.length) return;
      const r = await Pl.GasDrive.pick({ fileIds: ids.slice(0, 100), multiple: true, account: cfg.account });
      if (r.accessToken) gToken = r.accessToken;
      await runSync({ interactive: true });
    } catch (e) { if (!cancelled(e)) sst(t("Не удалось: {e}", { e: errText(e) })); }
  };
  q("m-join").onclick = async () => {
    try {
      const cfg = await syncer.loadConfig();
      const r = await Pl.GasDrive.pick({ mimeTypes: SYNC.DATA_MIME, multiple: true, account: cfg.account });
      if (r.accessToken) gToken = r.accessToken;
      if (!r.picked || !r.picked.length) return;
      mst(t("Подключаю…"));
      const ids = await syncer.join(r.picked);
      await runSync({ interactive: true });
      try { profiles = (await api("/api/profiles")).profiles; } catch {}
      if (ids.length) { await switchProfile(ids[ids.length - 1]); mst(t("Готово: общая ёмкость добавлена.")); }
      else mst(t("Эта ёмкость уже подключена."));
      await renderSync();
    } catch (e) { mst(cancelled(e) ? "" : t("Не удалось: {e}", { e: errText(e) })); }
  };
  q("m-mem-add").onclick = async () => {
    const email = q("m-mem-email").value.trim();
    if (!email) return;
    q("m-mem-add").disabled = true;
    try {
      await syncer.share(curPid(), email);
      q("m-mem-email").value = "";
      mst(t("Доступ открыт, Google отправил приглашение на {a}.", { a: email }));
      syncSoon(500);
    } catch (e) { mst(t("Не удалось: {e}", { e: errText(e) })); }
    finally { q("m-mem-add").disabled = false; renderSync(); }
  };
  const pfSel = q("pf-sel");
  if (pfSel) pfSel.addEventListener("change", () => setTimeout(() => { mst(""); renderSync(); }, 300));

  const ast = (s) => { q("m-arch-st").textContent = s; };
  let archBusy = false, archSent = "";
  async function pushArchConfig() {
    const a = mset.arch, P = a.parts;
    if (!native || !Pl.Preferences) return;
    const value = JSON.stringify({ on: a.on, where: a.where, tree: a.tree, days: a.days, keep: a.keep, photos: !!P.photos, data: !!P.data, app: P.app ? JSON.stringify(appSettings()) : "", pids: resolveTanks(a.tanks, a.ids), curSup: mset.curSup, defaultName: t("Основной") });
    if (value === archSent) return;
    archSent = value;
    await Pl.Preferences.set({ key: "gas-archive", value });
    if (Pl.GasFolder) await Pl.GasFolder.schedule().catch(() => {});
  }
  async function archState() {
    try { return JSON.parse((await Pl.Preferences.get({ key: "gas-archive-state" })).value || "{}"); } catch { return {}; }
  }
  async function renderArch() {
    const a = mset.arch;
    q("m-arch").checked = a.on;
    q("m-arch").disabled = !(native && Pl.GasFolder);
    q("m-arch-where").value = a.where;
    q("m-arch-pick").hidden = a.where !== "tree";
    q("m-arch-days").value = String(a.days);
    q("m-arch-keep").value = a.keep;
    q("m-arch-tanks").value = a.tanks;
    let dir = a.dir || t("не выбрана");
    if (a.tree && native && Pl.GasFolder) {
      try {
        const i = await Pl.GasFolder.info({ tree: a.tree });
        if (!i.ok) dir = t("нет доступа — выберите папку заново");
        else if (i.name) { a.dir = i.name; dir = i.name; }
      } catch {}
    }
    q("m-arch-dir").textContent = dir;
    syncPicks();
    const last = native && Pl.Preferences ? (await archState()).time : 0;
    if (!q("m-arch-st").textContent && last) ast(t("Последний архив: {d}", { d: fmtDT(last) }));
  }
  async function pickArchDir() {
    const r = await Pl.GasFolder.pick();
    if (mset.arch.tree && mset.arch.tree !== r.uri) await Pl.GasFolder.release({ tree: mset.arch.tree }).catch(() => {});
    Object.assign(mset.arch, { tree: r.uri, dir: r.name || "", where: "tree" });
    saveM();
  }
  async function runArchive(force = false) {
    const a = mset.arch;
    if (!native || !Pl.GasFolder || !a.on || (a.where === "tree" && !a.tree) || archBusy) return;
    archBusy = true;
    try {
      await pushArchConfig();
      if (force) ast(t("Собираю архив…"));
      const r = await Pl.GasFolder.run({ force });
      if (r.saved || force) ast(t("Сохранено архивов: {n} · {d}", { n: r.saved, d: fmtDT(r.time || Date.now()) }));
    } catch (e) {
      ast(e && e.code === "NO_ACCESS" ? t("Нет доступа к папке — выберите её заново.") : /UNSUPPORTED/.test(errText(e)) ? t("Папка по умолчанию работает на Android 10 и новее — выберите папку.") : t("Не удалось сохранить архив: {e}", { e: errText(e) }));
    } finally { archBusy = false; }
  }
  const archChanged = () => { saveM(); renderTankLists(); pushArchConfig().catch(() => {}); };
  q("m-arch").onchange = async (e) => {
    if (e.target.checked && mset.arch.where === "tree" && !mset.arch.tree) {
      try { await pickArchDir(); } catch { e.target.checked = false; return; }
    }
    mset.arch.on = e.target.checked; archChanged();
    await renderArch();
    if (mset.arch.on) runArchive();
  };
  q("m-arch-where").onchange = async (e) => {
    if (e.target.value === "tree" && !mset.arch.tree) {
      try { await pickArchDir(); } catch { e.target.value = "default"; syncPicks(); return; }
    }
    mset.arch.where = e.target.value; archChanged(); ast("");
    await renderArch();
  };
  q("m-arch-pick").onclick = async () => { try { await pickArchDir(); ast(""); archChanged(); await renderArch(); runArchive(true); } catch {} };
  q("m-arch-days").onchange = (e) => { mset.arch.days = [1, 7, 30].includes(+e.target.value) ? +e.target.value : 7; archChanged(); };
  q("m-arch-keep").onchange = (e) => { const v = Math.round(+e.target.value); mset.arch.keep = v >= 1 && v <= 100 ? v : 5; e.target.value = mset.arch.keep; archChanged(); };
  q("m-arch-tanks").onchange = (e) => { mset.arch.tanks = e.target.value; archChanged(); };
  wireParts("m-arch", () => mset.arch.parts, archChanged);
  wireIds("m-arch-ids", () => mset.arch, archChanged);
  q("m-arch-now").onclick = async () => { const b = q("m-arch-now"); b.disabled = true; try { await runArchive(true); } finally { b.disabled = false; renderArch(); } };

  const SMP = window.gasSamples;
  let lastRecog = null, store = null;
  const samples = () => store || (store = SMP.createStore(backend.fs, { zlib: (b) => window.fflate.zlibSync(b, { level: 6 }), unzlib: (b) => window.fflate.unzlibSync(b) }));
  function grabSample(file, ocr, cv, R) {
    if (mset.samples === false) { lastRecog = null; return; }
    const k = SMP.factor(ocr.width, ocr.height), o = SMP.scaleOcr(ocr, k);
    const c2 = document.createElement("canvas");
    c2.width = o.width; c2.height = o.height;
    const x2 = c2.getContext("2d", { willReadFrequently: true });
    x2.drawImage(cv, 0, 0, o.width, o.height);
    lastRecog = { file, gray: SMP.grayFromRGBA(x2.getImageData(0, 0, o.width, o.height).data),
      meta: { ocr: o, recognized: R.ok ? R.value : null, raw: R.ok ? Math.round(R.raw * 10) / 10 : null, confidence: R.ok ? Math.round(R.confidence * 100) / 100 : 0, reason: R.ok ? "" : R.reason } };
  }
  async function saveSample(level) {
    const s = lastRecog;
    lastRecog = null;
    if (!s || mset.samples === false) return;
    await samples().add({ level, ...s.meta }, s.gray);
  }
  q("m-guided").checked = mset.guidedCamera !== false;
  q("m-autorecog").checked = mset.autoRecog !== false;
  q("m-gallery").value = mset.gallery;
  q("m-gallery").onchange = (e) => { mset.gallery = e.target.value; saveM(); };
  q("m-guided").onchange = (e) => { mset.guidedCamera = e.target.checked; saveM(); };
  q("m-autorecog").onchange = (e) => { mset.autoRecog = e.target.checked; saveM(); };

  const rfForm = q("rf-form");
  if (rfForm && native && Pl.GasNative) {
    const save = q("rf-save");
    save.insertAdjacentHTML("beforebegin", `<button type="button" id="m-rf-receipt">${t("По фото чека")}</button><input type="file" id="m-rf-receipt-file" accept="image/*" hidden>`);
    q("m-rf-receipt").onclick = () => q("m-rf-receipt-file").click();
    q("m-rf-receipt-file").onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const err = q("rf-err");
      err.textContent = t("Читаю чек…");
      try {
        const p = "receipt/" + (/\.png$/i.test(file.name) ? "r.png" : "r.jpg");
        await cacheFS.rmrf("receipt");
        await cacheFS.write(p, new Uint8Array(await file.arrayBuffer()));
        const ocr = await Pl.GasNative.recognizeText({ path: await cacheFS.nativeUri(p) });
        const r = window.gasReceipt.parseReceipt(ocr);
        await cacheFS.rmrf("receipt");
        const set = (id, v) => { if (v == null || v === "") return; const el = q(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
        set("rf-liters", r.liters); set("rf-price", r.price); set("rf-total", r.total); set("rf-date", r.date);
        err.textContent = r.liters == null && r.total == null ? t("На фото не нашлось литров и суммы — введите их вручную.")
          : r.sure ? t("Заполнено по чеку — проверьте значения перед сохранением.") : t("Заполнено по чеку частично — проверьте и дополните.");
      } catch (ex) { err.textContent = t("Не удалось прочитать чек: {e}", { e: errText(ex) }); }
    };
  }

  function openPanel(name, focusId) {
    if (shell()) shell().reveal(name, focusId);
  }
  function routeLink(url) {
    const a = window.gasLink.parse(url);
    if (a === "photo") takePhoto();
    else if (a === "reading") { const b = q("manual"); if (b) b.click(); }
    else if (a === "refuel") openPanel("refuels", "rf-liters");
  }
  if (native && Pl.App) {
    Pl.App.addListener("appUrlOpen", (ev) => ready.then(() => routeLink(ev && ev.url)));
    window.addEventListener("load", () => ready.then(async () => {
      try { const r = await Pl.App.getLaunchUrl(); if (r && r.url) setTimeout(() => routeLink(r.url), 800); } catch {}
    }));
  }

  async function takeShared() {
    let list = [];
    try { list = (await Pl.GasNative.takeShared()).files || []; } catch { return; }
    const files = [];
    for (const f of list) {
      try {
        const raw = await Pl.Filesystem.readFile({ path: f.path });
        const bytes = typeof raw.data === "string" ? window.gasStorage.b64ToBytes(raw.data) : new Uint8Array(await raw.data.arrayBuffer());
        files.push(new File([bytes], f.name, { type: f.type || "image/jpeg" }));
      } catch {}
      Pl.Filesystem.deleteFile({ path: f.path }).catch(() => {});
    }
    if (!files.length) return;
    autoRecog = mset.autoRecog !== false;
    await uploadFiles(files);
  }
  if (native && Pl.GasNative) {
    Pl.GasNative.addListener("shared", () => ready.then(takeShared));
    window.addEventListener("load", () => ready.then(takeShared));
  }

  window.addEventListener("load", () => ready.then(() => { pushArchConfig().catch(() => {}); }));
})();
