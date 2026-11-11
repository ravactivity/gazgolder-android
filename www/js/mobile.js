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
  const mset = Object.assign({ notify: false, photoDays: 14, repeatDays: 3, sched: {} }, (() => { try { return JSON.parse(localStorage.getItem(MKEY) || "{}"); } catch { return {}; } })());
  mset.arch = Object.assign({ on: false, tree: "", dir: "", days: 7, photos: true, keep: 5, last: {}, sig: {} }, mset.arch || {});
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
        <label class="m-check" id="m-dyn-row" hidden><input type="checkbox" id="m-dyn"> ${t("Цвета из обоев (Material You)")}</label>
      </div>
      <div class="m-card">
        <h3>${t("Напоминания")}</h3>
        <label class="m-check"><input type="checkbox" id="m-notify"> ${t("Присылать уведомления")}</label>
        <label class="m-inline">${t("Напомнить сфотографировать уровнемер, если нет показаний")}
          <input type="number" id="m-photo-days" min="1" max="120" step="1" inputmode="numeric"> ${t("дн.")}</label>
        <label class="m-inline">${t("Повторять напоминание о фото каждые")}
          <input type="number" id="m-repeat-days" min="0" max="30" step="1" inputmode="numeric"> ${t("дн. (0 — не повторять)")}</label>
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
      <div class="m-card" id="m-sync-card">
        <h3>${t("Google Диск")}</h3>
        <label class="m-check"><input type="checkbox" id="m-sync"> ${t("Синхронизировать с Google Диском")}</label>
        <div class="muted m-small">${t("Выключено, пока вы сами не включите. Ёмкости, показания, заправки, паспорт и фото хранятся в папке «Gazgolder» на вашем Google Диске; приложение видит только свои файлы. Включите синхронизацию на другом телефоне с тем же аккаунтом — данные появятся и там.")}</div>
        <div id="m-sync-opts" class="m-sub" hidden>
          <div class="muted m-small" id="m-sync-acc"></div>
          <label class="m-check"><input type="checkbox" id="m-sync-tank"> <span id="m-sync-tank-l"></span></label>
          <label class="m-check"><input type="checkbox" id="m-sync-photos"> ${t("Синхронизировать фото")}</label>
          <label class="m-check"><input type="checkbox" id="m-sync-wifi"> ${t("Фото — только через Wi-Fi")}</label>
          <div class="m-btns">
            <button type="button" id="m-sync-now">${t("Синхронизировать сейчас")}</button>
            <button type="button" id="m-sync-access" hidden></button>
            <button type="button" id="m-sync-reup" hidden>${t("Выгрузить заново")}</button>
          </div>
          <div class="status" id="m-sync-st"></div>
          <h3 style="margin-top:12px">${t("Совместный доступ")}</h3>
          <div class="muted m-small" id="m-mem"></div>
          <div class="m-inline m-share-row"><input type="email" id="m-mem-email" autocomplete="email" inputmode="email" placeholder="${t("почта второго человека")}"><button type="button" id="m-mem-add">${t("Открыть доступ")}</button></div>
          <div class="m-btns"><button type="button" id="m-join">${t("Открыть общую ёмкость…")}</button></div>
          <div class="muted m-small">${t("Google пришлёт приглашение на указанную почту. Второй человек ставит «Газгольдер», включает синхронизацию, нажимает «Открыть общую ёмкость…» и выбирает файл «Gazgolder — название.json» (на Диске он в разделе «Доступные мне»). Дальше все участники видят и дополняют одни и те же данные. Приглашать можно сколько угодно людей; любой участник может пригласить ещё кого-то и так же открыть другим свои ёмкости.")}</div>
          <div class="status" id="m-mem-st"></div>
        </div>
      </div>
      <div class="m-card">
        <h3>${t("Архив в папку")}</h3>
        <label class="m-check"><input type="checkbox" id="m-arch"> ${t("Сохранять архив автоматически")}</label>
        <div id="m-arch-opts" class="m-sub" hidden>
          <div class="m-dir"><span class="label">${t("Папка")}</span><span id="m-arch-dir" class="m-small"></span> <button type="button" id="m-arch-pick">${t("Выбрать папку…")}</button></div>
          <label class="m-inline">${t("Как часто")}
            <select id="m-arch-days"><option value="1">${t("каждый день")}</option><option value="7">${t("раз в неделю")}</option><option value="30">${t("раз в месяц")}</option></select></label>
          <label class="m-check"><input type="checkbox" id="m-arch-photos"> ${t("С фото")}</label>
          <label class="m-inline">${t("Хранить последних архивов каждой ёмкости")}
            <input type="number" id="m-arch-keep" min="1" max="100" step="1" inputmode="numeric"></label>
          <div class="m-btns"><button type="button" id="m-arch-now">${t("Сохранить сейчас")}</button></div>
          <div class="status" id="m-arch-st"></div>
        </div>
        <div class="muted m-small">${t("Архив .zip каждой ёмкости сохраняется в выбранную папку (на телефоне, на карте памяти или в облаке, которое поддерживает выбор папки) в фоне, примерно дважды в сутки, и при открытии приложения — если прошёл срок и данные изменились. Старые архивы сверх указанного числа удаляются.")}</div>
      </div>
      <div class="m-card">
        <h3>${t("Распознавание")}</h3>
        <label class="m-check"><input type="checkbox" id="m-guided"> ${t("Камера с подсказкой-кругом")}</label>
        <label class="m-check"><input type="checkbox" id="m-autorecog"> ${t("Распознавать уровень сразу после съёмки")}</label>
        <label class="m-check"><input type="checkbox" id="m-smp"> ${t("Запоминать проверки распознавания на телефоне")}</label>
        <div class="muted m-small" id="m-smp-st"></div>
        <div class="m-btns"><button type="button" id="m-smp-exp">${t("Экспорт проверок")}</button><button type="button" id="m-smp-clr">${t("Очистить")}</button></div>
        <div class="muted m-small">${t("Когда вы распознаёте фото и сохраняете показание, приложение запоминает уменьшенную чёрно-белую копию фото, найденные цифры и итоговый уровень. По ним видно, насколько точно работает распознавание. Набор хранится только на телефоне; его можно выгрузить архивом, чтобы проверить новые версии распознавания.")}</div>
        <div class="status" id="m-smp-msg"></div>
      </div>
      <div class="m-card">
        <h3>${t("Резервная копия")}</h3>
        <div class="muted m-small">${t("Таблицы и настройки (без фото) входят в резервную копию Android в вашем Google-аккаунте, если она включена в настройках телефона, и восстанавливаются на новом телефоне. Фото сохраняйте архивом.")}</div>
        <h3 style="margin-top:12px">${t("Виджет")}</h3>
        <div class="muted m-small">${t("Долгое нажатие на рабочем столе → «Виджеты» → «Газгольдер»: уровень сейчас и сколько дней до минимума; кнопка с камерой сразу открывает съёмку. Есть и маленький виджет 1×1. Долгое нажатие на значке приложения — быстрые действия: фото, показание, заправка.")}</div>
      </div>
    </div>`;
  const before = document.querySelector('section[data-panel="passport"]');
  if (before) before.parentNode.insertBefore(panel, before);
  const shell = () => (native && window.gasShell && window.gasShell.active ? window.gasShell : null);
  if (native && window.gasShell) window.gasShell.init({ takePhoto: () => takePhoto(), mset, saveM });

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
    cam.querySelector("#m-camera").onclick = () => takePhoto();
    cam.querySelector("#m-camera-file").onchange = (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) { autoRecog = mset.autoRecog !== false; uploadFiles(f); } };
  }
  let autoRecog = false;
  async function takePhoto() {
    if (native && Pl.GasNative && mset.guidedCamera !== false) {
      try {
        const r = await Pl.GasNative.capture({ hint: t("Поместите уровнемер в круг") });
        const raw = await Pl.Filesystem.readFile({ path: r.path });
        const bytes = typeof raw.data === "string" ? window.gasStorage.b64ToBytes(raw.data) : new Uint8Array(await raw.data.arrayBuffer());
        autoRecog = mset.autoRecog !== false;
        await uploadFiles([new File([bytes], r.path.split("/").pop(), { type: "image/jpeg" })]);
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
  window.gasOnRender = (A) => { if (shell()) shell().update(A); clearTimeout(renderTimer); renderTimer = setTimeout(() => afterRender(A).catch((e) => console.error(e)), 400); };

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
  const fmtD = (tm) => new Date(tm).toLocaleDateString(I.locale, { day: "numeric", month: "long" });
  const REM = window.gasReminders;

  async function scheduleFor(pid, name, A) {
    if (!LN()) return;
    try { await LN().cancel({ notifications: REM.idsFor(pid).map((id) => ({ id })) }); } catch {}
    if (!mset.notify) { delete mset.sched[pid]; saveM(); renderNext(); return; }
    const out = REM.plan({ pid, name, A, settings: state.settings, photoDays: mset.photoDays, repeatDays: mset.repeatDays, t, fmtD });
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
  q("m-repeat-days").value = mset.repeatDays;
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
  q("m-repeat-days").onchange = (e) => { const v = Math.round(+e.target.value); mset.repeatDays = v >= 0 && v <= 30 ? v : 3; e.target.value = mset.repeatDays; saveM(); if (typeof render === "function") render(); };
  q("m-photo-days").onchange = (e) => { const v = Math.round(+e.target.value); mset.photoDays = v >= 1 && v <= 120 ? v : 14; e.target.value = mset.photoDays; saveM(); if (typeof render === "function") render(); };

  if (native && LN()) LN().addListener("localNotificationActionPerformed", (ev) => {
    const pid = ev && ev.notification && ev.notification.extra && ev.notification.extra.profile;
    if (pid && typeof switchProfile === "function" && pid !== view.profile) switchProfile(pid);
  });

  const st = (s) => { q("m-share-st").textContent = s; };
  const safeFile = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "gazgolder";
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  async function exportZip(photos, { pid = view.profile || "default", name = profileName(), dir = "export", fname = null, progress = st } = {}) {
    await ready;
    const fz = window.fflate;
    fname = fname || `gazgolder-${safeFile(name)}-${today()}${photos ? "" : "-no-photos"}.zip`;
    const path = dir + "/" + fname;
    await cacheFS.rmrf(dir);
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
      progress(t("Собираю архив: {n} файлов…", { n: ++n }));
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
    let imp = null, done = false;
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
      if (!res.files) throw new Error(t("В архиве нет данных газгольдера"));
      done = true;
      st(t("Загружено: «{name}», файлов: {n}", { name: res.name, n: res.files }));
      profiles = (await api("/api/profiles")).profiles;
      await switchProfile(res.id);
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
      if (typeof render === "function" && backend) render();
      syncSoon(1500, 60e3);
      setTimeout(() => runArchive().catch(() => {}), 4000);
    });
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
    await initSync();
    syncSoon(500);
    renderArch();
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
          if (!confirm(t("Закрыть доступ для {a}?", { a: m }))) return;
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
        if (!confirm(t("Раньше синхронизация шла с аккаунтом {a}. Переключиться на {b}? Ёмкости будут выгружены на новый аккаунт заново.", { a: cfg.account, b: who.email }))) { gToken = null; sst(""); return; }
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
    if (!confirm(t("Выгрузить ёмкость «{name}» на Google Диск заново, новым файлом?", { name: profileName() }))) return;
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
  let archBusy = false;
  async function pushArchConfig() {
    const a = mset.arch;
    if (!native || !Pl.Preferences) return;
    await Pl.Preferences.set({ key: "gas-archive", value: JSON.stringify({ on: a.on, tree: a.tree, days: a.days, photos: a.photos, keep: a.keep, defaultName: t("Основной") }) });
    if (Pl.GasFolder) await Pl.GasFolder.schedule().catch(() => {});
  }
  async function archState() {
    try { return JSON.parse((await Pl.Preferences.get({ key: "gas-archive-state" })).value || "{}"); } catch { return {}; }
  }
  async function renderArch() {
    const a = mset.arch;
    q("m-arch").checked = a.on;
    q("m-arch").disabled = !(native && Pl.GasFolder);
    q("m-arch-opts").hidden = !a.on;
    q("m-arch-days").value = String(a.days);
    q("m-arch-photos").checked = a.photos;
    q("m-arch-keep").value = a.keep;
    let dir = a.dir || t("не выбрана");
    if (a.tree && native && Pl.GasFolder) {
      try {
        const i = await Pl.GasFolder.info({ tree: a.tree });
        if (!i.ok) dir = t("нет доступа — выберите папку заново");
        else if (i.name) { a.dir = i.name; dir = i.name; }
      } catch {}
    }
    q("m-arch-dir").textContent = dir;
    const last = native && Pl.Preferences ? (await archState()).time : 0;
    if (!q("m-arch-st").textContent && last) ast(t("Последний архив: {d}", { d: fmtDT(last) }));
  }
  async function pickArchDir() {
    const r = await Pl.GasFolder.pick();
    if (mset.arch.tree && mset.arch.tree !== r.uri) await Pl.GasFolder.release({ tree: mset.arch.tree }).catch(() => {});
    Object.assign(mset.arch, { tree: r.uri, dir: r.name || "" });
    saveM();
  }
  async function runArchive(force = false) {
    const a = mset.arch;
    if (!native || !Pl.GasFolder || !a.on || !a.tree || archBusy) return;
    archBusy = true;
    try {
      await pushArchConfig();
      if (force) ast(t("Собираю архив…"));
      const r = await Pl.GasFolder.run({ force });
      if (r.saved || force) ast(t("Сохранено архивов: {n} · {d}", { n: r.saved, d: fmtDT(r.time || Date.now()) }));
    } catch (e) {
      ast(e && e.code === "NO_ACCESS" ? t("Нет доступа к папке — выберите её заново.") : t("Не удалось сохранить архив: {e}", { e: errText(e) }));
    } finally { archBusy = false; }
  }
  const archChanged = () => { saveM(); pushArchConfig().catch(() => {}); };
  q("m-arch").onchange = async (e) => {
    if (e.target.checked && !mset.arch.tree) {
      try { await pickArchDir(); } catch { e.target.checked = false; return; }
    }
    mset.arch.on = e.target.checked; archChanged();
    await renderArch();
    if (mset.arch.on) runArchive();
  };
  q("m-arch-pick").onclick = async () => { try { await pickArchDir(); ast(""); await renderArch(); runArchive(true); } catch {} };
  q("m-arch-days").onchange = (e) => { mset.arch.days = [1, 7, 30].includes(+e.target.value) ? +e.target.value : 7; archChanged(); };
  q("m-arch-photos").onchange = (e) => { mset.arch.photos = e.target.checked; archChanged(); };
  q("m-arch-keep").onchange = (e) => { const v = Math.round(+e.target.value); mset.arch.keep = v >= 1 && v <= 100 ? v : 5; e.target.value = mset.arch.keep; archChanged(); };
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
    renderSamples(await samples().add({ level, ...s.meta }, s.gray));
  }
  const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
  async function renderSamples(list) {
    if (!backend) return;
    list = list || (await samples().list());
    const S = SMP.stats(list);
    q("m-smp-st").textContent = !S.total ? t("Проверок пока нет.")
      : t("Проверок: {n}. Средняя ошибка: {e}%. Точно (±2%): {w}. Не распознано: {f}.", { n: S.total, e: S.mean == null ? "—" : S.mean.toFixed(1), w: pct(S.within2), f: S.failed });
    q("m-smp-exp").disabled = q("m-smp-clr").disabled = !S.total;
  }
  q("m-guided").checked = mset.guidedCamera !== false;
  q("m-autorecog").checked = mset.autoRecog !== false;
  q("m-smp").checked = mset.samples !== false;
  q("m-guided").onchange = (e) => { mset.guidedCamera = e.target.checked; saveM(); };
  q("m-autorecog").onchange = (e) => { mset.autoRecog = e.target.checked; saveM(); };
  q("m-smp").onchange = (e) => { mset.samples = e.target.checked; saveM(); };
  q("m-smp-clr").onclick = async () => {
    if (!confirm(t("Удалить все сохранённые проверки распознавания?"))) return;
    await samples().clear(); renderSamples([]);
  };
  q("m-smp-exp").onclick = async () => {
    const msg = (s) => { q("m-smp-msg").textContent = s; };
    try {
      msg(t("Собираю архив…"));
      const fz = window.fflate, path = "samples/gazgolder-gauge-samples-" + today() + ".zip";
      await cacheFS.rmrf("samples");
      const parts = [];
      const zip = new fz.Zip((err, chunk) => { if (!err) parts.push(chunk); });
      await samples().entries(async (name, bytes) => { const f = new fz.ZipPassThrough(name); zip.add(f); f.push(bytes, true); });
      zip.end();
      let size = 0; for (const p of parts) size += p.length;
      const all = new Uint8Array(size); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      await cacheFS.write(path, all);
      msg("");
      if (native) await Pl.Share.share({ title: t("Проверки распознавания"), files: [(await Pl.Filesystem.getUri({ path, directory: "CACHE" })).uri], dialogTitle: t("Отправить архив") });
    } catch (e) { msg(cancelledShare(e) ? "" : t("Не удалось: {e}", { e: errText(e) })); }
  };
  const cancelledShare = (e) => /cancel/i.test(String(e && e.message));

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

  async function applyDynamic() {
    const old = document.getElementById("m-dyn-css");
    if (old) old.remove();
    if (!native || !Pl.GasNative) return;
    const c = await Pl.GasNative.systemColors().catch(() => ({ ok: false }));
    q("m-dyn-row").hidden = !c.ok;
    if (!c.ok || !mset.dynamic) return;
    const v = (a, s) => `--accent:${a};--crit:${a};--series:${s};--forecast:${s}`;
    const css = `:root{${v(c.light, c.lightSeries)}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${v(c.dark, c.darkSeries)}}}:root[data-theme="dark"]{${v(c.dark, c.darkSeries)}}`;
    const st = document.createElement("style");
    st.id = "m-dyn-css"; st.textContent = css;
    document.head.append(st);
  }
  q("m-dyn").checked = !!mset.dynamic;
  q("m-dyn").onchange = (e) => { mset.dynamic = e.target.checked; saveM(); applyDynamic(); if (typeof render === "function") try { render(); } catch {} };
  applyDynamic();
  window.addEventListener("load", () => ready.then(() => { renderSamples().catch(() => {}); pushArchConfig().catch(() => {}); }));
})();
