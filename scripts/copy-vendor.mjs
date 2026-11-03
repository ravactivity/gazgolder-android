import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [["node_modules/fflate/umd/index.js", "www/vendor/fflate.js"]];
mkdirSync(join(root, "www/vendor"), { recursive: true });
for (const [from, to] of files) copyFileSync(join(root, from), join(root, to));
console.log("vendor: copied", files.length);
