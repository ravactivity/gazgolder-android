import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripHtml } from "./strip.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "../app/static/index.html");
const dst = join(root, "www/index.html");
if (!existsSync(src)) {
  console.log("sync-ui: ../app/static/index.html not found, www/index.html left as is");
  process.exit(0);
}
let html = readFileSync(src, "utf8").replace(/\r\n/g, "\n");
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://www.googleapis.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
const head = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="color-scheme" content="light dark">\n<link rel="stylesheet" href="css/mobile.css">`;
const scripts = ["js/polyfills.js", "js/i18n.js", "vendor/fflate.js", "js/exif.js", "js/storage.js", "js/backend.js", "js/sync.js", "js/gauge.js", "js/receipt.js", "js/reminders.js", "js/samples.js", "js/applink.js", "js/home.js", "js/shell.js", "js/mobile.js"]
  .map((s) => `<script src="${s}"></script>`).join("\n");
const main = '<script>\n"use strict";';
if (!html.includes("</head>") || !html.includes(main)) throw new Error("sync-ui: </head> or the main <script> not found");
html = stripHtml(html);
html = html.replace("</head>", head + "\n</head>");
html = html.replace(main, scripts + "\n" + main);
writeFileSync(dst, html);
console.log("sync-ui: www/index.html updated");
