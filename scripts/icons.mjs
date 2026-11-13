import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ICONS = [
  "add", "add_a_photo", "arrow_back", "arrow_drop_down", "calculate", "call", "chat", "check", "check_box", "check_box_outline_blank", "check_circle", "checklist", "chevron_right",
  "close", "cloud_sync", "delete", "description", "edit", "edit_note", "folder_zip", "home", "info", "ios_share", "language",
  "local_fire_department", "local_gas_station", "location_on", "mail", "mode_heat", "monitoring", "more_vert", "notifications",
  "palette", "photo_camera", "photo_library", "propane_tank", "radio_button_checked", "radio_button_unchecked", "receipt_long",
  "schedule", "select_all", "send", "settings", "show_chart", "sms", "storefront", "straighten", "swap_horiz", "tune", "upload_file", "warning", "widgets",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const names = [...ICONS].sort().join(",");
const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=${names}&display=block`, { headers: { "User-Agent": UA } })).text();
const url = /src:\s*url\((https:[^)]+)\)/.exec(css)?.[1];
if (!url) throw new Error("icons: font URL not found in\n" + css);
const font = new Uint8Array(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
const out = join(root, "www/fonts/symbols.woff2");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, font);
console.log(`icons: ${ICONS.length} glyphs, ${font.length} bytes → www/fonts/symbols.woff2`);
