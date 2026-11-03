"use strict";
(function (root) {
  function exifDateTime(b) {
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) return null;
      const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66 && b[p + 8] === 0 && b[p + 9] === 0) {
        try { return tiffDate(b, p + 10, Math.min(len - 8, b.length - p - 10)); } catch { return null; }
      }
      if (m === 0xda || m === 0xd9) return null;
      p += 2 + len;
    }
    return null;
  }

  function tiffDate(b, t, n) {
    const le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return null;
    const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
    const u32 = (o) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16)) + b[t + o + 3] * 2 ** 24
      : b[t + o] * 2 ** 24 + ((b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]));
    const ifd = (o) => {
      const out = {};
      if (!o || o + 2 > n) return out;
      const cnt = u16(o);
      for (let i = 0; i < cnt; i++) {
        const e = o + 2 + i * 12;
        if (e + 12 > n) break;
        out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), off: e + 8 };
      }
      return out;
    };
    const str = (en) => {
      if (!en || en.type !== 2) return null;
      const o = en.count <= 4 ? en.off : u32(en.off);
      let s = "";
      for (let i = 0; i < en.count && o + i < n; i++) { const c = b[t + o + i]; if (!c) break; s += String.fromCharCode(c); }
      return s;
    };
    const i0 = ifd(u32(4));
    let raw = i0[0x8769] ? str(ifd(u32(i0[0x8769].off))[0x9003]) : null;
    raw = raw || str(i0[0x0132]);
    const m = raw && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(raw.trim());
    return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}:${m[6]}` } : null;
  }

  root.gasExif = { exifDateTime };
})(typeof window !== "undefined" ? window : globalThis);
