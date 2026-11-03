"use strict";
(function (root) {
  const SCALE = [5, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95];
  const TAU = Math.PI * 2;
  const mod = (a, m = TAU) => ((a % m) + m) % m;

  function labelsFrom(ocr) {
    const out = [];
    for (const line of ocr.lines || []) {
      const words = line.elements && line.elements.length ? line.elements : [line];
      for (const w of words) {
        const t = String(w.text || "").replace(/[oOоО]/g, "0").replace(/[lI|]/g, "1").replace(/[^\d]/g, "");
        if (!t) continue;
        const v = +t;
        if (!SCALE.includes(v)) continue;
        const [l, tp, r, b] = w.box;
        out.push({ v, x: (l + r) / 2, y: (tp + b) / 2, h: Math.max(1, b - tp) });
      }
    }
    return out;
  }

  const circle3 = (a, b, c) => {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-6) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x, y, r: Math.hypot(a.x - x, a.y - y) };
  };
  function fitCircle(ps) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    for (const p of ps) { const z = p.x * p.x + p.y * p.y; sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y; sxz += p.x * z; syz += p.y * z; sz += z; }
    const n = ps.length;
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [-sxz, -syz, -sz];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (Math.abs(D) < 1e-9) return null;
    const col = (i) => A.map((row, k) => row.map((v, j) => (j === i ? B[k] : v)));
    const [a, b, c] = [0, 1, 2].map((i) => det(col(i)) / D);
    const x = -a / 2, y = -b / 2, r2 = x * x + y * y - c;
    return r2 > 0 ? { x, y, r: Math.sqrt(r2) } : null;
  }

  function monotone(items) {
    const n = items.length, len = Array(n).fill(1), prev = Array(n).fill(-1);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++)
      if (items[j].v < items[i].v && items[j].a < items[i].a && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    let k = len.indexOf(Math.max(...len));
    const out = [];
    while (k >= 0) { out.unshift(items[k]); k = prev[k]; }
    return out;
  }

  function fitScale(labels, w, h) {
    if (labels.length < 3) return null;
    const maxR = Math.max(w, h) * 0.6, minR = Math.min(w, h) * 0.02;
    let best = null;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) for (let k = j + 1; k < labels.length; k++) {
      const c = circle3(labels[i], labels[j], labels[k]);
      if (!c || c.r > maxR || c.r < minR) continue;
      const tol = Math.max(c.r * 0.12, 2);
      const inl = labels.filter((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.r) <= tol);
      const vs = new Set(inl.map((p) => p.v));
      if (!best || vs.size > best.n || (vs.size === best.n && c.r < best.c.r)) best = { c, inl, n: vs.size };
    }
    if (!best || best.n < 3) return null;
    const c = (best.inl.length >= 4 && fitCircle(best.inl)) || best.c;
    let bestDir = null;
    for (const s of [1, -1]) {
      const sorted = [...best.inl].sort((a, b) => a.v - b.v);
      const t0 = Math.atan2(sorted[0].y - c.y, sorted[0].x - c.x);
      const items = sorted.map((p) => ({ ...p, a: mod(s * (Math.atan2(p.y - c.y, p.x - c.x) - t0)) }));
      items[0].a = 0;
      const mono = monotone(items);
      if (!bestDir || mono.length > bestDir.pts.length) bestDir = { s, t0, pts: mono };
    }
    if (bestDir.pts.length < 3) return null;
    const pts = [];
    for (const p of bestDir.pts) { const q = pts[pts.length - 1]; if (q && q.v === p.v) q.a = (q.a + p.a) / 2; else pts.push({ v: p.v, a: p.a, x: p.x, y: p.y }); }
    if (pts.length < 3 || pts.at(-1).a < Math.PI / 2) return null;
    return { cx: c.x, cy: c.y, r: c.r, s: bestDir.s, t0: bestDir.t0, pts, labels: best.inl.length, found: labels.length };
  }

  function valueAt(S, a) {
    const p = S.pts, last = p.length - 1;
    if (a > p[last].a + (TAU - p[last].a) / 2) a -= TAU;
    let i = 0;
    while (i < last - 1 && a > p[i + 1].a) i++;
    const A = p[i], B = p[i + 1];
    return A.v + (B.v - A.v) * (a - A.a) / (B.a - A.a || 1);
  }

  function findNeedle(S, pixel, w, h) {
    const dark = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const c = pixel(x | 0, y | 0);
      return 1 - Math.max(c[0], c[1], c[2]) / 255;
    };
    const ring = (f) => {
      const v = [];
      for (let k = 0; k < 72; k++) { const t = k / 72 * TAU; v.push(dark(S.cx + Math.cos(t) * f * S.r, S.cy + Math.sin(t) * f * S.r)); }
      return v.sort((a, b) => a - b)[36];
    };
    const face = [0.55, 0.6, 0.65, 0.7].map(ring).sort((a, b) => a - b)[1], core = ring(0.06);
    let hub = 0.12;
    for (let f = 0.06; f < 0.55; f += 0.02) if (ring(f) < face + (core - face) * 0.35) { hub = f; break; }
    const r1 = Math.min(0.6, hub + 0.04), r2 = 0.85, side = 0.1 * S.r;
    const STEP = 0.5, N = Math.round(360 / STEP), score = new Float64Array(N);
    const first = S.pts[0].a - 0.35, lastA = S.pts.at(-1).a + 0.35;
    for (let i = 0; i < N; i++) {
      const t = i * STEP * Math.PI / 180;
      let a = mod(S.s * (t - S.t0));
      if (a > lastA && a - TAU >= first) a -= TAU;
      if (a < first || a > lastA) { score[i] = -1; continue; }
      const c = Math.cos(t), s = Math.sin(t);
      let sum = 0, n = 0;
      for (let f = r1; f <= r2; f += 0.025) {
        const x = S.cx + c * f * S.r, y = S.cy + s * f * S.r, d = dark(x, y);
        const l = dark(x - s * side, y + c * side), r = dark(x + s * side, y - c * side);
        sum += Math.max(0, Math.min(d - l, d - r)); n++;
      }
      score[i] = sum / n;
    }
    const sm = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (score[i] < 0) { sm[i] = -1; continue; }
      let s = 0, n = 0;
      for (let d = -2; d <= 2; d++) { const v = score[(i + d + N) % N]; if (v >= 0) { s += v; n++; } }
      sm[i] = s / n;
    }
    let bi = 0;
    for (let i = 1; i < N; i++) if (sm[i] > sm[bi]) bi = i;
    const y0 = sm[(bi - 1 + N) % N], y1 = sm[bi], y2 = sm[(bi + 1) % N];
    const off = y0 >= 0 && y2 >= 0 && y0 - 2 * y1 + y2 !== 0 ? 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) : 0;
    const t = mod((bi + off) * STEP * Math.PI / 180);
    let second = 0;
    for (let i = 0; i < N; i++) { const dd = Math.min(Math.abs(i - bi), N - Math.abs(i - bi)) * STEP; if (dd >= 15 && sm[i] > second) second = sm[i]; }
    return { t, peak: y1, second, contrast: y1 > 0 ? 1 - second / y1 : 0, hub, r1, r2 };
  }

  function readGauge(ocr, pixel) {
    const w = ocr.width, h = ocr.height;
    const labels = labelsFrom(ocr);
    const S = fitScale(labels, w, h);
    if (!S) return { ok: false, reason: labels.length < 3 ? "Не нашёл цифры шкалы — сфотографируйте уровнемер ближе и ровнее" : "Не удалось определить шкалу по цифрам", labels };
    const N = findNeedle(S, pixel, w, h);
    let a = mod(S.s * (N.t - S.t0));
    const value = Math.max(0, Math.min(100, valueAt(S, a)));
    const conf = Math.max(0, Math.min(1, (Math.min(S.pts.length, 8) / 8) * 0.5 + Math.min(1, N.contrast / 0.5) * 0.5));
    return { ok: true, value: Math.round(value), raw: value, confidence: conf, scale: S, needle: N, labels };
  }

  function drawOverlay(ctx, R) {
    if (!R.ok) return;
    const S = R.scale, N = R.needle, lw = Math.max(2, S.r / 40);
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(0,160,255,.9)";
    ctx.beginPath(); ctx.arc(S.cx, S.cy, S.r, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(0,160,255,.9)";
    for (const p of S.pts) { ctx.beginPath(); ctx.arc(p.x, p.y, lw * 2, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = "rgba(255,40,140,.95)"; ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    ctx.moveTo(S.cx + Math.cos(N.t) * N.r1 * S.r, S.cy + Math.sin(N.t) * N.r1 * S.r);
    ctx.lineTo(S.cx + Math.cos(N.t) * S.r * 1.05, S.cy + Math.sin(N.t) * S.r * 1.05);
    ctx.stroke();
    ctx.restore();
  }

  root.gasGauge = { readGauge, drawOverlay, labelsFrom, fitScale, valueAt, findNeedle };
})(typeof window !== "undefined" ? window : globalThis);
