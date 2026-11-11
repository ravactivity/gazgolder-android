import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, serve } from "./cdp.mjs";
import { demoFiles } from "./demo-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const RED = "#B8332A";
const ARC = "M37.03,72.97A24,24 0,1 1,70.97 72.97", TICK = "M54,26.5L54,31.5", NEEDLE = "M54,56L66.99,40.79", HUB = "M49,56a5,5 0,1 0,10 0a5,5 0,1 0,-10 0Z";
const gauge = (color = "#fff") => `<g fill="none" stroke="${color}" stroke-linecap="round"><path d="${ARC}" stroke-width="6"/><path d="${TICK}" stroke-width="3"/><path d="${NEEDLE}" stroke-width="4.5"/></g><path d="${HUB}" fill="${color}"/>`;
const iconSvg = (px, shape) => {
  const bg = shape === "round" ? `<circle cx="54" cy="54" r="36" fill="${RED}"/>` : shape === "rounded" ? `<rect x="18" y="18" width="72" height="72" rx="14" fill="${RED}"/>` : `<rect x="0" y="0" width="108" height="108" fill="${RED}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${shape === "full" ? "14 14 80 80" : "18 18 72 72"}">${bg}${gauge()}</svg>`;
};
const TEXT = {
  "ru-RU": {
    title: "Газгольдер — учёт газа", short: "Уровень газа по фото уровнемера, прогноз расхода и когда заказывать заправку.",
    tagline: "Уровень газа по фото уровнемера, прогноз и лучший момент для заказа",
    full: `«Газгольдер» помогает следить за газом в ёмкости (газгольдере) частного дома.

• Показания по фото уровнемера: время съёмки берётся из фото, уровень можно распознать прямо на телефоне — без интернета.
• Журнал заправок с ценами: из любых двух значений (литры, цена, сумма) считается третье; заправку можно заполнить по фото чека.
• Прогноз расхода по сезонам и режимам котла, дата, когда уровень дойдёт до минимума.
• Когда и сколько заказывать: лучший момент с учётом минимальной доставки, запаса на доставку и сезонных цен; режим «одна заправка в год».
• Сценарии: сколько газа уходит на отопление и на горячую воду, что изменится при другой температуре подачи.
• Несколько ёмкостей, паспорт ёмкости с фото документов.
• Напоминания: пора заказывать газ, уровень у минимума, давно не было фото.
• Виджеты на рабочем столе и быстрые действия на значке.
• По желанию — синхронизация с вашим Google Диском и совместный учёт с семьёй или соседями; автоматический архив в выбранную папку.

Регистрация не нужна. Данные хранятся на телефоне и уходят только туда, куда вы сами их отправите. Открытый исходный код.`,
  },
  "en-US": {
    title: "Gazgolder: LPG tank tracker", short: "LPG tank level from gauge photos, consumption forecast and when to order gas.",
    tagline: "Tank level from gauge photos, a forecast and the best time to order",
    full: `Gazgolder helps you keep track of the gas in the LPG tank of your house.

• Readings from gauge photos: the time comes from the photo, and the level can be recognized right on the phone, offline.
• A refuel log with prices: any two of liters, price and total give the third; a refuel can be filled in from a receipt photo.
• A consumption forecast by season and boiler mode, and the date the level reaches the minimum.
• When and how much to order: the best moment given the minimum delivery, the delivery lead time and seasonal prices; a "one refill a year" mode.
• Scenarios: how much gas goes to heating and to hot water, and what changes with another supply temperature.
• Several tanks and a tank passport with photos of the documents.
• Reminders: time to order gas, the level near the minimum, no photo for a while.
• Home-screen widgets and quick actions on the app icon.
• Optional sync with your own Google Drive and a shared log with family or neighbours; an automatic archive to a folder you choose.

No sign-up. Your data stays on the phone and goes only where you send it. Open source.`,
  },
};

const out = (...p) => { const f = join(root, ...p); mkdirSync(dirname(f), { recursive: true }); return f; };

async function render(B, html, w, h, transparent) {
  await B.cmd("Emulation.setDefaultBackgroundColorOverride", transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  await B.cmd("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await B.goto("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`));
  return B.screenshot({ x: 0, y: 0, width: w, height: h });
}

async function icons(B) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, px] of Object.entries(sizes)) {
    writeFileSync(out(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`), await render(B, iconSvg(px, "rounded"), px, px, true));
    writeFileSync(out(`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`), await render(B, iconSvg(px, "round"), px, px, true));
  }
  const play = await render(B, iconSvg(512, "full"), 512, 512, false);
  for (const lang of Object.keys(TEXT)) writeFileSync(out(`fastlane/metadata/android/${lang}/images/icon.png`), play);
  for (const [lang, T] of Object.entries(TEXT)) {
    const name = lang === "ru-RU" ? "Газгольдер" : "Gazgolder";
    const html = `<div style="width:1024px;height:500px;background:${RED};display:flex;align-items:center;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#fff">
      <svg width="360" height="360" viewBox="18 18 72 72" style="margin-left:56px;flex:none">${gauge()}</svg>
      <div style="margin-left:24px;margin-right:56px"><div style="font-size:84px;font-weight:700;letter-spacing:-1px">${name}</div>
      <div style="font-size:30px;line-height:1.3;opacity:.92;margin-top:12px">${T.tagline}</div></div></div>`;
    writeFileSync(out(`fastlane/metadata/android/${lang}/images/featureGraphic.png`), await render(B, html, 1024, 500, false));
  }
}

const BAR = 24, NAV = 20;
const phoneChrome = `
  const st = document.createElement("style");
  st.textContent = \`:root { --font-body: Roboto, sans-serif; --font-display: "Roboto Condensed", Roboto, sans-serif; --safe-area-inset-top: ${BAR}px; --safe-area-inset-bottom: ${NAV}px; }
    #ph-bar, #ph-nav { position: fixed; left: 0; right: 0; z-index: 99999; pointer-events: none; color: #1b1f22; }
    #ph-bar { top: 0; height: ${BAR}px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px 0 16px; font: 500 13px/1 Roboto, sans-serif; letter-spacing: .02em; }
    #ph-bar svg { display: block; } #ph-bar .ic { display: flex; gap: 6px; align-items: center; }
    #ph-nav { bottom: 0; height: ${NAV}px; display: flex; align-items: center; justify-content: center; }
    #ph-nav i { width: 108px; height: 4px; border-radius: 2px; background: currentColor; opacity: .75; }
    html[data-theme="dark"] #ph-bar, html[data-theme="dark"] #ph-nav { color: #eef1f3; }\`;
  document.head.append(st);
  const bar = document.createElement("div"); bar.id = "ph-bar";
  bar.innerHTML = '<span>12:30</span><span class="ic">'
    + '<svg width="16" height="12" viewBox="0 0 16 12"><path fill="currentColor" d="M8 12 0 3.4A11.5 11.5 0 0 1 16 3.4z"/></svg>'
    + '<svg width="13" height="13" viewBox="0 0 13 13"><path fill="currentColor" d="M13 0v13H0z"/></svg>'
    + '<svg width="8" height="14" viewBox="0 0 8 14"><rect x="2.5" y="0" width="3" height="1.5" fill="currentColor"/><rect x=".75" y="1.5" width="6.5" height="11.75" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="5" width="4" height="7" fill="currentColor"/></svg></span>';
  const nav = document.createElement("div"); nav.id = "ph-nav"; nav.innerHTML = "<i></i>";
  document.body.append(bar, nav);
  await document.fonts.ready;`;

async function screenshots(srv, lang) {
  const B = await launch({ width: 360, height: 640, scale: 3 });
  try {
    await B.cmd("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
    await B.cmd("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await B.cmd("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36" });
    await B.goto(`${srv.url}/store.html?lang=${lang.slice(0, 2)}`);
    await B.eval(`
      for (let i = 0; i < 200 && !(typeof state !== "undefined" && state.readings.length > 50 && document.getElementById("m-sum").textContent); i++) await new Promise((r) => setTimeout(r, 50));
      const s = document.createElement("style"); s.textContent = ".m-demo{display:none!important}"; document.head.append(s);
      ${phoneChrome}
      await new Promise((r) => setTimeout(r, 400));`);
    const shots = [
      ["light", 'gasShell.show("home")'],
      ["light", 'gasShell.show("log")'],
      ["light", 'gasShell.show("stats")'],
      ["light", 'gasShell.show("stats"); const el = document.querySelector(\'section[data-panel="level"]\'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 64 - ' + BAR + ')'],
      ["light", 'gasShell.show("more"); gasShell.open("suppliers"); document.querySelector(\'[data-sup="gs"]\').click()'],
      ["light", 'gasShell.show("more")'],
      ["dark", 'gasShell.show("home")'],
    ];
    let n = 0;
    for (const [theme, js] of shots) {
      await B.eval(`
        document.querySelector('[data-theme-set="${theme}"]').click();
        ${js};
        await new Promise((r) => setTimeout(r, 400));`);
      writeFileSync(out(`fastlane/metadata/android/${lang}/images/phoneScreenshots/${++n}.png`), await B.screenshot());
    }
  } finally { await B.close(); }
}

const demo = await demoFiles({ end: Date.now() - 2 * 864e5, suppliers: true });
const b64 = Object.fromEntries(Object.entries(demo).map(([k, v]) => [k, Buffer.from(v).toString("base64")]));
const page = readFileSync(join(root, "www/index.html"), "utf8").replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").replace("</head>",
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Condensed:wght@500;600;700&display=block"></head>').replace('<script src="js/mobile.js"></script>',
  `<script src="/__test/fake-cloud.js"></script><script src="/__test/fake-capacitor.js"></script>
<script>for (const [k, v] of Object.entries(${JSON.stringify(b64)})) __cap.put("/fake/data/data/" + (k === "suppliers.json" ? "" : "default/") + k, Uint8Array.from(atob(v), (c) => c.charCodeAt(0)));</script>
<script src="js/mobile.js"></script>`);
const srv = await serve({ extra: {
  "/store.html": page,
  "/__test/fake-cloud.js": readFileSync(join(root, "test/fixtures/fake-cloud.js")),
  "/__test/fake-capacitor.js": readFileSync(join(root, "test/fixtures/fake-capacitor.js")),
} });
try {
  const B = await launch({ width: 1100, height: 1100 });
  try { await icons(B); } finally { await B.close(); }
  for (const lang of Object.keys(TEXT)) {
    const T = TEXT[lang];
    writeFileSync(out(`fastlane/metadata/android/${lang}/title.txt`), T.title + "\n");
    writeFileSync(out(`fastlane/metadata/android/${lang}/short_description.txt`), T.short + "\n");
    writeFileSync(out(`fastlane/metadata/android/${lang}/full_description.txt`), T.full + "\n");
    if (T.title.length > 30 || T.short.length > 80 || T.full.length > 4000) throw new Error(`store text too long for ${lang}`);
    await screenshots(srv, lang);
  }
  console.log("store assets written to fastlane/metadata/android/ and launcher icons to android/app/src/main/res/");
} finally { srv.close(); }
