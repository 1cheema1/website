// ─────────────────────────────────────────────────────────────
// The trading wall's screens, as real DOM.
//
// These used to be canvas textures on WebGL planes and they read as mush next
// to the Active Positions board, which was always sharp. Two reasons, and the
// texture resolution was only half of one of them:
//
//   1. minification — a 1024px chart cell drawn into ~200 screen px goes
//      through the mip chain no matter how much anisotropy you throw at it;
//   2. the DPR cap — the WebGL layer renders at min(devicePixelRatio, 1.5)
//      and is upscaled to the display's 2x, so EVERYTHING in the canvas is
//      resampled. The board never paid either cost, because it is a CSS3D
//      element: real text, composited by the browser at native density.
//
// So the screens are CSS3D now too. The sparklines are inline SVG with
// non-scaling strokes, which means they are resolution-independent — they
// stay sharp when the camera is close AND when it is across the room.
// ─────────────────────────────────────────────────────────────

// Deterministic fallback series, used only when data/positions.json is
// unreachable. Seeded so a given symbol always draws the same shape — a
// screen that reshuffles on every reload looks broken, not live.
function seeded(sym) {
  let h = 2166136261;
  for (let i = 0; i < sym.length; i++) { h ^= sym.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

function fallbackSeries(sym, n = 63) {
  const rnd = seeded(sym);
  const out = [];
  let v = 0.5;
  for (let i = 0; i < n; i++) { v = Math.max(0.06, Math.min(0.94, v + (rnd() - 0.47) * 0.09)); out.push(v); }
  return out;
}

const FALLBACK_SYMS = ['DELL', 'HPE', 'PANW', 'HUM', 'AMD', 'MRVL', 'STX', 'CRWD'];

// Build the per-screen dataset: prefer the nightly file, fill any shortfall
// with deterministic stand-ins so the wall is never half-empty.
export function screenData(market) {
  const real = (market && Array.isArray(market.screens)) ? market.screens : [];
  const out = real.map(s => ({
    symbol: s.symbol,
    // daily change: a ticker crawl means "today" to everyone who has ever seen
    // one, so a quarter's move shown in that format reads as fabricated even
    // when it is real. pct_window still labels the sparkline underneath.
    pct: typeof s.pct_day === 'number' ? s.pct_day : (s.pct ?? 0),
    pctWindow: typeof s.pct_window === 'number' ? s.pct_window : (s.pct ?? 0),
    last: s.last,
    spark: s.spark,
    live: true
  }));
  for (const sym of FALLBACK_SYMS) {
    if (out.length >= 8) break;
    if (out.some(o => o.symbol === sym)) continue;
    const spark = fallbackSeries(sym);
    out.push({
      symbol: sym,
      // a plausible single-session move, not a window move
      pct: (spark[spark.length - 1] - spark[spark.length - 2]) * 100,
      pctWindow: (spark[spark.length - 1] - spark[0]) * 100,
      last: null,
      spark,
      live: false
    });
  }
  return out.slice(0, 8);
}

// An SVG sparkline. viewBox units are arbitrary; preserveAspectRatio="none"
// lets it stretch to whatever box it lands in, and non-scaling-stroke keeps
// the line one crisp pixel regardless of that stretch.
function sparkSVG(spark, up, w = 100, h = 40) {
  const n = spark.length;
  if (n < 2) return '';
  // leave headroom so the peak never touches the bezel
  const pad = 0.12;
  const pt = (v, i) => {
    const x = (i / (n - 1)) * w;
    const y = h - (pad + v * (1 - pad * 2)) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  const line = spark.map(pt).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const c = up ? 'var(--up)' : 'var(--dn)';
  const gid = 'g' + Math.abs(n * 31 + (up ? 1 : 0)) + (up ? 'u' : 'd');
  return `<svg class="spk" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${c}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#${gid})"/>
    <polyline points="${line}" fill="none" stroke="${c}" stroke-width="1.6"
      vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

function screenEl(d, cls) {
  const up = d.pct >= 0;
  const el = document.createElement('div');
  el.className = 'p3d scr ' + cls + (up ? ' up' : ' dn');
  el.innerHTML =
    `<div class="scr-h"><span class="sym">${d.symbol}</span>` +
    `<span class="pct">${fmtPct(d.pct)}</span></div>` +
    `<div class="scr-c">${sparkSVG(d.spark, up)}</div>` +
    `<div class="scr-f"><span>${d.last != null ? d.last.toFixed(2) : '—'}</span>` +
    `<span>${d.live ? fmtPct(d.pctWindow) + ' 3M' : 'SIM'}</span></div>`;
  return el;
}

// The crawl. One strip, its content duplicated, translated by exactly -50%
// on loop so the seam is invisible — the classic marquee trick, but in CSS
// so it costs no JS per frame and stays sharp.
function tickerEl(data) {
  const el = document.createElement('div');
  el.className = 'p3d tkr';
  const one = data.map(d => {
    const up = d.pct >= 0;
    return `<i class="${up ? 'up' : 'dn'}"><b>${d.symbol}</b>${fmtPct(d.pct)}</i>`;
  }).join('');
  // duplicated twice: the animation runs 0 -> -50%, so the second copy is
  // always covering the gap the first one leaves behind
  el.innerHTML = `<div class="tkr-run">${one}${one}</div>`;
  return el;
}

// Returns { id -> HTMLElement } matching the SCREEN keys in config.js.
export function buildScreenElements(market) {
  const data = screenData(market);
  const els = {};
  // six flanking stacks, three a side — data order runs down the left
  // column then down the right, so the strongest names lead
  for (let i = 0; i < 6; i++) els['scr' + i] = screenEl(data[i % data.length], 'flank');
  // two console screens under the board
  for (let i = 0; i < 2; i++) els['con' + i] = screenEl(data[(6 + i) % data.length], 'console');
  els.ticker = tickerEl(data);
  return els;
}
