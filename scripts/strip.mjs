import * as acorn from "acorn";

function cut(src, ranges) {
  let out = src;
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
    const ls = out.lastIndexOf("\n", start - 1) + 1;
    let le = out.indexOf("\n", end);
    if (le < 0) le = out.length;
    const before = out.slice(ls, start), after = out.slice(end, le);
    if (!before.trim() && !after.trim()) out = out.slice(0, ls) + out.slice(le + 1 > out.length ? le : le + 1);
    else out = out.slice(0, start).replace(/[ \t]+$/, "") + out.slice(end);
  }
  return out;
}

export function stripJs(src, sourceType = "script") {
  const ranges = [];
  acorn.parse(src, { ecmaVersion: "latest", sourceType, allowHashBang: true, onComment: (block, text, start, end) => ranges.push({ start, end }) });
  return cut(src, ranges);
}

export function stripCss(src) {
  const ranges = [];
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) ranges.push({ start: m.index, end: m.index + m[0].length });
  return cut(src, ranges);
}

export function stripHtml(src) {
  const parts = src.split(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>)/i);
  return parts.map((p) => {
    const sc = /^<script\b([^>]*)>([\s\S]*?)<\/script>$/i.exec(p);
    if (sc) return sc[2].trim() ? `<script${sc[1]}>${stripJs(sc[2])}</script>` : p;
    const st = /^<style\b([^>]*)>([\s\S]*?)<\/style>$/i.exec(p);
    if (st) return `<style${st[1]}>${stripCss(st[2])}</style>`;
    const ranges = [];
    for (const m of p.matchAll(/<!--[\s\S]*?-->/g)) ranges.push({ start: m.index, end: m.index + m[0].length });
    return cut(p, ranges);
  }).join("");
}
