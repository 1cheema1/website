import * as THREE from 'three';

// ── tileable value noise ───────────────────────────────────────
function hash(x, y, s) {
  let n = (x * 374761393 + y * 668265263 + s * 1442695040) | 0;
  n = (n ^ (n >> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s, P) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % P) + P) % P, x1 = (x0 + 1) % P;
  const y0 = ((yi % P) + P) % P, y1 = (y0 + 1) % P;
  const a = hash(x0, y0, s), b = hash(x1, y0, s);
  const c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
export function fbm(x, y, s, oct, per, P) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, s + i * 37, P * f);
    norm += amp; amp *= per; f *= 2;
  }
  return sum / norm;
}

// ── build colour + roughness + normal from one shader fn ───────
// fn(u, v) -> { r,g,b (0..1), rough (0..1), h (0..1) }
function buildMaps(size, fn, opts = {}) {
  const N = size;
  const col = new Uint8Array(N * N * 4);
  const rgh = new Uint8Array(N * N * 4);
  const hgt = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const o = j * N + i;
      const s = fn(i / N, j / N);
      col[o * 4] = Math.max(0, Math.min(255, s.r * 255));
      col[o * 4 + 1] = Math.max(0, Math.min(255, s.g * 255));
      col[o * 4 + 2] = Math.max(0, Math.min(255, s.b * 255));
      col[o * 4 + 3] = 255;
      const rv = Math.max(0, Math.min(255, s.rough * 255));
      rgh[o * 4] = rv; rgh[o * 4 + 1] = rv; rgh[o * 4 + 2] = rv; rgh[o * 4 + 3] = 255;
      hgt[o] = s.h;
    }
  }

  // normal map from height (central differences, wrapped)
  const strength = opts.bump === undefined ? 2.2 : opts.bump;
  const nrm = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const l = hgt[j * N + ((i - 1 + N) % N)], r = hgt[j * N + ((i + 1) % N)];
      const d = hgt[((j - 1 + N) % N) * N + i], u = hgt[((j + 1) % N) * N + i];
      let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      nx *= il; ny *= il; nz *= il;
      const o = (j * N + i) * 4;
      nrm[o] = (nx * 0.5 + 0.5) * 255;
      nrm[o + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[o + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }

  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(col, true), roughnessMap: mk(rgh, false), normalMap: mk(nrm, false) };
}

const lerp = (a, b, t) => a + (b - a) * t;
function mixHex(a, b, t) {
  const ar = (a >> 16 & 255) / 255, ag = (a >> 8 & 255) / 255, ab = (a & 255) / 255;
  const br = (b >> 16 & 255) / 255, bg = (b >> 8 & 255) / 255, bb = (b & 255) / 255;
  return { r: lerp(ar, br, t), g: lerp(ag, bg, t), b: lerp(ab, bb, t) };
}

// ── material recipes ───────────────────────────────────────────

export function woodMaterial({ dark = 0x2f2118, light = 0x6b4a2e, rings = 11, seed = 7,
  repeat = [1, 1], rough = [0.36, 0.62], size = 512, bump = 0.85, sheen = 0 } = {}) {
  const m = buildMaps(size, (u, v) => {
    // warped ring pattern along v, plus long grain streaks along u
    const warp = fbm(u * 3, v * 9, seed, 4, 0.55, 64) - 0.5;
    const g = (v * rings + warp * 2.4);
    let ring = Math.abs(Math.sin(g * Math.PI));
    ring = Math.pow(ring, 1.15);
    const streak = fbm(u * 2.5, v * 150, seed + 11, 4, 0.55, 256);
    const pore = fbm(u * 140, v * 26, seed + 23, 2, 0.5, 256);
    const t = Math.min(1, Math.max(0, ring * 0.30 + streak * 0.70));
    const c = mixHex(dark, light, t);
    const dirt = 0.96 + pore * 0.07;
    const h = t * 0.6 + pore * 0.4;
    return {
      r: c.r * dirt, g: c.g * dirt, b: c.b * dirt,
      rough: lerp(rough[0], rough[1], 1 - t * 0.7 + pore * 0.25),
      h
    };
  }, { bump });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  const mat = new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.5 });
  if (sheen) { mat.roughness = 1; }
  return mat;
}

export function plasterMaterial({ base = 0xb9b1a2, seed = 3, repeat = [1, 1],
  rough = 0.94, size = 256, bump = 1.4, tint = 0.06 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const n = fbm(u * 26, v * 26, seed, 5, 0.55, 64);
    const big = fbm(u * 3.5, v * 3.5, seed + 5, 3, 0.6, 16);
    const c = mixHex(base, 0xffffff, (n - 0.5) * tint * 2 + 0.5 * tint);
    const shade = 0.93 + big * 0.14;
    return { r: c.r * shade, g: c.g * shade, b: c.b * shade, rough: rough - n * 0.06, h: n * 0.7 + big * 0.3 };
  }, { bump });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.35 });
}

export function concreteMaterial({ base = 0x4a4640, seed = 13, repeat = [1, 1], size = 512, bump = 1.8 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const n = fbm(u * 14, v * 14, seed, 6, 0.55, 64);
    const speck = fbm(u * 210, v * 210, seed + 7, 2, 0.5, 256);
    const stain = fbm(u * 2.2, v * 2.2, seed + 3, 3, 0.65, 8);
    const c = mixHex(base, 0x8d8880, n * 0.55 + speck * 0.18);
    const sh = 0.82 + stain * 0.34;
    return { r: c.r * sh, g: c.g * sh, b: c.b * sh, rough: 0.78 + n * 0.16 - speck * 0.08, h: n * 0.5 + speck * 0.5 };
  }, { bump });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.45 });
}

export function carpetMaterial({ base = 0x241f1b, accent = 0x3a322a, seed = 29, repeat = [1, 1], size = 256 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const fib = fbm(u * 190, v * 190, seed, 3, 0.5, 256);
    const blotch = fbm(u * 6, v * 6, seed + 4, 4, 0.6, 32);
    const c = mixHex(base, accent, fib * 0.7 + blotch * 0.3);
    return { r: c.r, g: c.g, b: c.b, rough: 0.97 - fib * 0.05, h: fib };
  }, { bump: 3.2 });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.18 });
}

export function marbleMaterial({ base = 0x2b2825, vein = 0x6d675d, seed = 41, repeat = [1, 1], size = 512 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const w = fbm(u * 4, v * 4, seed, 5, 0.6, 32);
    const s = Math.abs(Math.sin((u * 5.5 + v * 2.1 + w * 3.6) * Math.PI));
    const vn = Math.pow(1 - s, 5) * 0.55;
    const grit = fbm(u * 90, v * 90, seed + 9, 2, 0.5, 128);
    const c = mixHex(base, vein, vn * 0.9 + grit * 0.05);
    return { r: c.r, g: c.g, b: c.b, rough: 0.20 + grit * 0.10 - vn * 0.06, h: vn * 0.6 + grit * 0.4 };
  }, { bump: 0.7 });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0.05, envMapIntensity: 0.8 });
}

export function brushedMetal({ base = 0x9aa0a8, seed = 53, repeat = [1, 1], size = 256,
  metalness = 1, rough = [0.18, 0.42] } = {}) {
  const m = buildMaps(size, (u, v) => {
    const brush = fbm(u * 320, v * 6, seed, 3, 0.5, 512);
    const c = mixHex(base, 0xffffff, brush * 0.18);
    return { r: c.r, g: c.g, b: c.b, rough: lerp(rough[0], rough[1], brush), h: brush };
  }, { bump: 0.9 });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness, envMapIntensity: 1.0 });
}

export function leatherMaterial({ base = 0x27201a, seed = 61, repeat = [1, 1], size = 256 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const cell = fbm(u * 46, v * 46, seed, 4, 0.55, 64);
    const crack = Math.pow(Math.abs(fbm(u * 22, v * 22, seed + 3, 3, 0.6, 32) - 0.5) * 2, 3);
    const c = mixHex(base, 0x6b5541, cell * 0.30);
    const sh = 1 - crack * 0.35;
    return { r: c.r * sh, g: c.g * sh, b: c.b * sh, rough: 0.62 + cell * 0.18, h: cell * 0.7 + crack * 0.3 };
  }, { bump: 2.4 });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.4 });
}

export function paperMaterial({ base = 0xece6d8, seed = 71, repeat = [1, 1], size = 256 } = {}) {
  const m = buildMaps(size, (u, v) => {
    const f = fbm(u * 120, v * 120, seed, 3, 0.5, 256);
    const c = mixHex(base, 0xfffdf6, f * 0.35);
    return { r: c.r, g: c.g, b: c.b, rough: 0.88 - f * 0.08, h: f };
  }, { bump: 1.1 });
  [m.map, m.roughnessMap, m.normalMap].forEach(t => t.repeat.set(repeat[0], repeat[1]));
  return new THREE.MeshStandardMaterial({ ...m, metalness: 0, envMapIntensity: 0.35 });
}

// glow sprite used for lamps, string lights, monitor bleed
export function glowTexture(size = 128, inner = 'rgba(255,238,205,1)') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.30, 'rgba(255,214,150,0.42)');
  rg.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = rg; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Repeating engraved-letter strip, meant to wrap around a cylinder's
// circumference (rim engraving) or sit flat on a plaque. Dark recessed
// look: dim letters cut into a slightly lighter ground, no glow.
export function engravingTexture(text, { w = 2048, h = 128, repeat = 3, tracking = 0.4,
  fg = 'rgba(20,17,10,0.92)', bg = 'rgba(0,0,0,0)', font = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg;
  g.font = font || `${Math.round(h * 0.46)}px 'JetBrains Mono', ui-monospace, monospace`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const unit = w / repeat;
  for (let r = 0; r < repeat; r++) {
    let x = r * unit + unit * 0.04;
    for (const ch of text) {
      g.fillText(ch, x, h / 2);
      x += g.measureText(ch).width + tracking * h * 0.14;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Flat plaque inscription — centred, single line, for a small brass plate.
export function plaqueTexture(line1, line2, { w = 1024, h = 320 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(25,20,10,0.94)';
  g.font = `600 ${Math.round(h * 0.30)}px 'JetBrains Mono', ui-monospace, monospace`;
  g.fillText(line1, w / 2, h * 0.42);
  if (line2) {
    g.font = `${Math.round(h * 0.20)}px 'JetBrains Mono', ui-monospace, monospace`;
    g.fillStyle = 'rgba(25,20,10,0.75)';
    g.fillText(line2, w / 2, h * 0.72);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// soft contact shadow: black with a radial ALPHA falloff, so it works
// with normal blending (a multiply-blended sprite goes black where the
// texture is transparent, which is not what we want)
export function shadowBlobTexture(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rg.addColorStop(0.00, 'rgba(0,0,0,0.92)');
  rg.addColorStop(0.42, 'rgba(0,0,0,0.55)');
  rg.addColorStop(0.72, 'rgba(0,0,0,0.16)');
  rg.addColorStop(1.00, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── trading-floor screen content ────────────────────────────────
// One texture holding a GRID of independent charts. Screens then take a UV
// sub-rect of it, which lets every screen in the room share one material and
// merge into a single draw call while still showing different data.
export function chartSheetTexture(cols = 3, rows = 2, cell = 512) {
  const w = cols * cell, h = rows * cell;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let seed = 1337;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  const SYMS = ['ROBO', 'CFM101', 'T20WC', 'SUBTRK', 'ZARF', 'DBATE',
    'USDPKR', 'SPX', 'TBILL', 'PIB', 'NOP', 'FWD'];

  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x0 = col * cell, y0 = r * cell;
      g.save();
      g.beginPath(); g.rect(x0, y0, cell, cell); g.clip();

      g.fillStyle = '#04060a'; g.fillRect(x0, y0, cell, cell);

      // grid
      g.strokeStyle = 'rgba(120,150,190,0.10)'; g.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        const gy = y0 + (i / 7) * cell;
        g.beginPath(); g.moveTo(x0 + 8, gy); g.lineTo(x0 + cell - 8, gy); g.stroke();
      }
      for (let i = 1; i < 6; i++) {
        const gx = x0 + (i / 6) * cell;
        g.beginPath(); g.moveTo(gx, y0 + 46); g.lineTo(gx, y0 + cell - 34); g.stroke();
      }

      // random-walk series, biased so about half the panels are green
      const up = rnd() > 0.42;
      const n = 46, top = y0 + 62, bot = y0 + cell - 44;
      let v = 0.5 + (rnd() - 0.5) * 0.2;
      const pts = [];
      for (let i = 0; i < n; i++) {
        v += (rnd() - 0.5) * 0.11 + (up ? 0.0075 : -0.0075);
        v = Math.max(0.06, Math.min(0.94, v));
        pts.push([x0 + 14 + (i / (n - 1)) * (cell - 28), bot - v * (bot - top)]);
      }
      const line = up ? '#3ecf7a' : '#ff5f5f';
      const fill = up ? 'rgba(62,207,122,0.16)' : 'rgba(255,95,95,0.14)';

      g.beginPath(); g.moveTo(pts[0][0], bot);
      for (const [px, py] of pts) g.lineTo(px, py);
      g.lineTo(pts[n - 1][0], bot); g.closePath();
      g.fillStyle = fill; g.fill();

      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const [px, py] of pts) g.lineTo(px, py);
      g.strokeStyle = line; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();

      // last-price dot
      g.beginPath(); g.arc(pts[n - 1][0], pts[n - 1][1], 5, 0, Math.PI * 2);
      g.fillStyle = line; g.fill();

      // header
      const sym = SYMS[(col + r * cols) % SYMS.length];
      g.fillStyle = '#c9a227';
      g.font = `600 ${Math.round(cell * 0.072)}px 'JetBrains Mono', ui-monospace, monospace`;
      g.textAlign = 'left'; g.fillText(sym, x0 + 16, y0 + 40);
      const pct = ((up ? 1 : -1) * (0.4 + rnd() * 4.6)).toFixed(2);
      g.fillStyle = line; g.textAlign = 'right';
      g.fillText((up ? '+' : '') + pct + '%', x0 + cell - 16, y0 + 40);

      // volume bars along the bottom
      for (let i = 0; i < 26; i++) {
        const bh = 6 + rnd() * 26;
        g.fillStyle = 'rgba(120,150,190,0.30)';
        g.fillRect(x0 + 14 + i * ((cell - 28) / 26), y0 + cell - 34 - bh, 6, bh);
      }
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// Long horizontal ticker crawl for the strip above the board.
export function tickerTexture(w = 2048, h = 96) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
  let seed = 99;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const SYMS = ['ROBOADVISOR', 'CFM101', 'T20WC', 'SUBTRACK', 'ZARF', 'DEBATELY',
    'USDPKR', 'SPX', 'KSE100', 'TBILL 6M', 'PIB 10Y', 'GOLD'];
  g.font = `500 ${Math.round(h * 0.44)}px 'JetBrains Mono', ui-monospace, monospace`;
  g.textBaseline = 'middle';
  let x = 20;
  while (x < w - 100) {
    const s = SYMS[(rnd() * SYMS.length) | 0];
    const up = rnd() > 0.45;
    const pct = ((up ? 1 : -1) * (0.1 + rnd() * 3.4)).toFixed(2);
    g.fillStyle = '#c9a227'; g.fillText(s, x, h / 2);
    x += g.measureText(s).width + 14;
    g.fillStyle = up ? '#3ecf7a' : '#ff5f5f';
    const v = (up ? '+' : '') + pct + '%';
    g.fillText(v, x, h / 2);
    x += g.measureText(v).width + 40;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// city skyline strip used behind the rooftop
export function skylineTexture(w = 2048, h = 512) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  let seed = 5;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let layer = 0; layer < 3; layer++) {
    const dark = ['#0d1220', '#141b2c', '#1c2438'][layer];
    const baseY = h - 10 - layer * 6;
    let x = -40;
    while (x < w + 40) {
      const bw = 34 + rnd() * 110;
      const bh = (60 + rnd() * 230) * (1 - layer * 0.18);
      g.fillStyle = dark;
      g.fillRect(x, baseY - bh, bw, bh + 20);
      // windows
      const wc = ['rgba(255,206,140,', 'rgba(180,214,255,'][rnd() < 0.65 ? 0 : 1];
      for (let wy = baseY - bh + 12; wy < baseY - 12; wy += 13) {
        for (let wx = x + 7; wx < x + bw - 9; wx += 11) {
          if (rnd() < 0.30 - layer * 0.07) {
            g.fillStyle = wc + (0.35 + rnd() * 0.6).toFixed(2) + ')';
            g.fillRect(wx, wy, 4, 6);
          }
        }
      }
      // occasional mast
      if (rnd() < 0.16) {
        g.fillStyle = dark; g.fillRect(x + bw / 2 - 1.5, baseY - bh - 34, 3, 34);
        g.fillStyle = 'rgba(255,90,70,0.9)'; g.fillRect(x + bw / 2 - 2.5, baseY - bh - 38, 5, 5);
      }
      x += bw + 4 + rnd() * 16;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// vertical gradient for the sky dome
export function skyTexture(h = 512) {
  const c = document.createElement('canvas'); c.width = 4; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0.00, '#0a0d1c');
  gr.addColorStop(0.34, '#1d2140');
  gr.addColorStop(0.58, '#4a3a52');
  gr.addColorStop(0.76, '#9a5c47');
  gr.addColorStop(0.88, '#d78c4a');
  gr.addColorStop(1.00, '#f0b46a');
  g.fillStyle = gr; g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tiny book-spine strip for shelves
export function spineTexture(w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let seed = 91;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const cols = ['#3b2f27', '#5a3428', '#26303c', '#4a4232', '#2e2a33', '#63472b', '#1f2a26', '#55302f'];
  let x = 0;
  while (x < w) {
    const bw = 9 + rnd() * 19;
    g.fillStyle = cols[(rnd() * cols.length) | 0];
    const top = rnd() * 16;
    g.fillRect(x, top, bw - 1.5, h - top);
    g.fillStyle = 'rgba(0,0,0,0.34)';
    g.fillRect(x + bw - 3, top, 2.5, h - top);
    if (rnd() < 0.6) {
      g.fillStyle = 'rgba(212,178,104,0.75)';
      g.fillRect(x + 3, top + 22 + rnd() * 40, bw - 8, 2);
    }
    x += bw;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
