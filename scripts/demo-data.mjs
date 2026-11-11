await import("../www/js/storage.js");
await import("../www/js/backend.js");
const { gasStorage, gasBackend } = globalThis;

const DAY = 864e5;
const pad = (n) => String(n).padStart(2, "0");
const iso = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const RATE = [24, 23, 19, 13, 7, 4, 4, 4, 6, 11, 17, 22];

export async function demoFiles({ end = new Date(2026, 9, 28).getTime(), years = 2, suppliers = false } = {}) {
  const fs = gasStorage.memFS(), be = gasBackend.createBackend(fs, {});
  await be.init();
  const call = async (method, path, body) => {
    const r = await be.gasFetch(path, { method, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error);
  };
  await call("PUT", "/api/settings", { volume: 4600, minPct: 20, maxPct: 85, minDelivery: 2000, leadDays: 14,
    modes: [{ date: iso(end - years * 365 * DAY), mode: "both" }] });
  if (suppliers) {
    await call("POST", "/api/suppliers", { id: "gs", short: "Газ-Сервис", full: "ООО «Газ-Сервис»", phone: "+7 900 000-00-00", messenger: "@gas_service_example",
      address: "г. Пример, ул. Заводская, 1", note: "мин. заказ 2 000 л, доставка 2–3 дня" });
    await call("POST", "/api/suppliers", { id: "pl", short: "ПропанЛайн", full: "ИП Петров А. А.", phone: "+7 900 000-00-01" });
  }
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let t = end - years * 365 * DAY, level = 82;
  while (t <= end) {
    const m = new Date(t).getMonth(), liters = RATE[m] * 10 * (0.85 + rnd() * 0.3);
    level -= liters / 46;
    if (level < 24) {
      const add = Math.round((85 - level) * 46 / 10) * 10, price = Math.round((34 + (t - (end - years * 365 * DAY)) / (365 * DAY) * 3.2 + (m >= 9 || m <= 1 ? 1.5 : -0.8)) * 100) / 100;
      await call("POST", "/api/refuels", { id: "r" + iso(t).replace(/-/g, ""), date: iso(t), liters: add, price, ...(suppliers ? { supplier: "gs", note: "" } : { note: "ООО «Газ-Сервис»" }) });
      level = 85;
      await call("POST", "/api/readings", { date: iso(t), time: "15:00", level: 85, note: "заправка" });
    }
    await call("POST", "/api/readings", { date: iso(t), time: `${8 + Math.floor(rnd() * 10)}:${pad(Math.floor(rnd() * 60))}`, level: Math.round(level) });
    t += (6 + Math.floor(rnd() * 8)) * DAY;
  }
  await call("PUT", "/api/passport", { params: [{ k: "Объём", v: "4,6 м³" }, { k: "Производитель", v: "Пример" }, { k: "Год выпуска", v: "2019" }], text: "Демо-данные для скриншотов." });
  const out = {};
  for (const f of ["gas_levels.csv", "refuels.csv", "settings.json", "passport.json"]) out[f] = await fs.read("data/default/" + f);
  if (suppliers) out["suppliers.json"] = await fs.read("data/suppliers.json");
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^\/?/, "/")}` || process.argv[1]?.endsWith("demo-data.mjs")) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../www/demo");
  mkdirSync(dir, { recursive: true });
  const files = await demoFiles();
  for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
  writeFileSync(join(dir, "files.json"), JSON.stringify(Object.keys(files)));
  console.log("demo data written to www/demo/");
}
