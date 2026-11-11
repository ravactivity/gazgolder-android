import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const www = join(here, "../www");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

export function findChrome() {
  const c = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return c.find((p) => p && existsSync(p)) || null;
}

export function serve({ demo = {}, extra = {} } = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let body = null;
    if (path in extra) body = extra[path];
    else if (path.startsWith("/demo/")) {
      const n = path.slice(6);
      body = n === "files.json" ? JSON.stringify(Object.keys(demo)) : demo[n] || null;
    } else {
      const f = normalize(join(www, path === "/" ? "index.html" : path));
      if (f.startsWith(www) && existsSync(f)) body = readFileSync(f);
    }
    if (body == null) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

export async function launch({ width = 412, height = 915, scale = 1 } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error("Chrome not found (set CHROME_PATH)");
  const profile = mkdtempSync(join(tmpdir(), "gazgolder-chrome-"));
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--no-default-browser-check", "--hide-scrollbars",
    `--user-data-dir=${profile}`, ...(process.env.CI ? ["--no-sandbox"] : []), "--remote-debugging-port=0", `--window-size=${width},${height}`, `--force-device-scale-factor=${scale}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok, fail) => {
    let buf = "";
    const tm = setTimeout(() => fail(new Error("Chrome did not start")), 20000);
    proc.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(tm); ok(m[1]); } });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
  let id = 0;
  const pending = new Map(), listeners = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); }
    else for (const l of listeners) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => { const i = ++id; pending.set(i, { ok, fail }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await send("Target.activateTarget", { targetId });
  const errors = [];
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await page("Runtime.enable");
  await page("Page.enable");
  await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: true });
  const waitLoad = () => new Promise((ok) => { const l = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(l), 1); ok(); } }; listeners.push(l); });
  return {
    errors,
    cmd: page,
    async goto(url) { const w = waitLoad(); await page("Page.navigate", { url }); await w; },
    async eval(expr) {
      const r = await page("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async screenshot(clip) { const r = await page("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); return Buffer.from(r.data, "base64"); },
    async media(features) { await page("Emulation.setEmulatedMedia", { features }); },
    async startCoverage() { await page("Profiler.enable"); await page("Profiler.startPreciseCoverage", { callCount: true, detailed: true }); },
    async takeCoverage() { return (await page("Profiler.takePreciseCoverage")).result; },
    async close() { try { ws.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 300)); try { rmSync(profile, { recursive: true, force: true }); } catch {} },
  };
}

export function coverageOf(entries, urlPart, source) {
  const marks = new Int8Array(source.length).fill(-1);
  for (const e of entries.filter((x) => x.url.includes(urlPart))) {
    const one = new Int8Array(source.length).fill(-1);
    for (const f of e.functions) for (const r of f.ranges) one.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    for (let i = 0; i < one.length; i++) if (one[i] > marks[i]) marks[i] = one[i];
  }
  const lines = source.split(String.fromCharCode(10));
  let off = 0, total = 0, hit = 0;
  const missed = [];
  lines.forEach((line, i) => {
    const code = line.trim();
    if (code && code !== "}" && code !== "});" && code !== "})();") {
      total++;
      const k = line.length - line.trimStart().length;
      if (marks[off + k] === 0) missed.push(i + 1); else hit++;
    }
    off += line.length + 1;
  });
  return { lines: total, hit, pct: total ? (hit / total) * 100 : 100, missed };
}
