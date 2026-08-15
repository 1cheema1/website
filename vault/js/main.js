import * as THREE from 'three';
import { CSS3DRenderer } from '../lib/CSS3DRenderer.js';
import { RoomEnvironment } from '../lib/RoomEnvironment.js';
import { EffectComposer } from '../lib/EffectComposer.js';
import { RenderPass } from '../lib/RenderPass.js';
import { ShaderPass } from '../lib/ShaderPass.js';
import { UnrealBloomPass } from '../lib/UnrealBloomPass.js';
import { BokehPass } from '../lib/BokehPass.js';
import * as C from './config.js';
import { buildWorld } from './world.js';
import { buildIntro } from './intro.js';
import { buildPanels } from './panels.js';
import * as AUDIO from './audio.js';

const gsap = window.gsap;
// GSAP's default lag smoothing pretends only 33ms elapsed whenever a frame
// takes >500ms. That's a sensible guard for long-running scroll animations,
// but the intro is a one-shot timeline that must play in real seconds — under
// smoothing a slow first paint (or a throttled tab) stretches a 5.5s intro
// into minutes and it never reaches the handoff.
gsap.ticker.lagSmoothing(0);

const lbar = document.getElementById('lbar');
const lmsg = document.getElementById('lmsg');
const tumb = [...document.querySelectorAll('#tumblers i')];
// The load has to happen anyway, so it may as well be the vault being opened:
// each real setup milestone sets one more tumbler.
let tumblersSet = 0;
const step = (pct, msg) => {
  lbar.style.width = pct + '%';
  const want = Math.min(tumb.length, Math.round((pct / 100) * tumb.length));
  while (tumblersSet < want) { tumb[tumblersSet].classList.add('set'); tumblersSet++; }
  lmsg.textContent = msg
    ? `${msg} — ${Math.min(6, want)} / 6`
    : `Aligning tumblers ${Math.min(6, want)} / 6`;
};

// Yield to the browser so the loader can actually paint between stages.
// Without this every step() ran in one synchronous block and the tumblers
// went straight from 0/6 to gone.
const paint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ?debug=1 prints live render state into the page so a headless
// screenshot is enough to diagnose a blank frame.
let DEBUG = null;
if (new URLSearchParams(location.search).get('debug') === '1') {
  DEBUG = document.createElement('pre');
  DEBUG.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9998;margin:0;' +
    'background:rgba(0,0,0,.82);color:#7dffa8;font:12px/1.45 ui-monospace,monospace;' +
    'padding:10px 14px;border:1px solid #2c5c3c;white-space:pre;';
  addEventListener('DOMContentLoaded', () => document.body.appendChild(DEBUG));
  if (document.body) document.body.appendChild(DEBUG);
}

// ═══════════════════ renderers ═══════════════════
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
// 2x DPR on a retina display means 4x the fragment work for a full-screen
// composited scene. 1.5 is visually near-identical here and materially
// cheaper — this scene is fill-rate bound, not geometry bound.
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x08070a, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
document.getElementById('gl').appendChild(renderer.domElement);

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(innerWidth, innerHeight);
document.getElementById('css3d').appendChild(cssRenderer.domElement);

const scene = new THREE.Scene();
const cssScene = new THREE.Scene();
scene.fog = new THREE.Fog(0x08080c, 3, 24);

const camera = new THREE.PerspectiveCamera(C.FOV, innerWidth / innerHeight, 0.05, 420);
camera.position.set(0, 1.42, -2.10);

step(12, 'Casting the room');
await paint();

// ═══════════════════ image-based lighting ═══════════════════
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
  scene.environment = env.texture;
  pmrem.dispose();
}

step(30, 'Milling the door');
await paint();
// the nightly market data, fetched before the world is built so the trading
// floor can label its screens with the same real tickers the board reports
let MARKET = null;
try {
  const r = await fetch('data/positions.json', { cache: 'no-cache' });
  if (r.ok) MARKET = await r.json();
} catch { /* board and screens fall back to baked-in values */ }
const world = buildWorld(scene, MARKET);

step(52, 'Forging the vault');
await paint();
const intro = buildIntro(scene, world.M, world.glowSprite, world.emis);

// ═══════════════════ post-processing ═══════════════════
// Bloom for the gold/coin/lamp glow, then a vignette+grain pass. CSS3D
// content renders in a separate DOM layer on top and is intentionally
// left crisp — bloom/grain never touch the readable panel text.
// ?nopost=1 renders straight to screen — an escape hatch for software
// renderers (headless test capture) that can choke on multi-target
// composer passes; real GPUs in an actual browser don't need it.
const NO_POST = new URLSearchParams(location.search).get('nopost') === '1';
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Constructing UnrealBloomPass allocates several HalfFloatType render
// targets — skip that entirely under ?nopost=1, not just skip using it.
// strength / radius / threshold.
// RenderPass output is already tone-mapped into [0,1], so `threshold` is a
// near-white cutoff, and plenty of legitimately bright surfaces (polished
// brass, the window, lit paper) sit up there. Verified against a ?nopost=1
// capture: the raw scene is correctly exposed, so bloom needs to be a thin
// halo on true highlights, not a wash. Radius is the dangerous knob — at
// 0.55 it smeared a quarter of the frame regardless of strength.
let bloomPass = null;
if (!NO_POST) {
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.18, 0.28, 0.96);
  composer.addPass(bloomPass);
}

const GrainVignetteShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - smoothstep(0.35, 0.98, dot(d,d) * 1.55);
      c.rgb *= mix(1.0, vig, 0.34 * uAmt);
      float g = (hash(vUv * vec2(1920.0,1080.0) + fract(uTime)) - 0.5) * 0.045 * uAmt;
      c.rgb += g;
      gl_FragColor = c;
    }`
};
// ── depth of field ──────────────────────────────────────────────
// Focus is driven each frame from the camera-to-look-target distance, so
// whatever the camera is actually reading stays sharp and the room falls off
// behind it. This only blurs the WebGL layer — the CSS3D panels live in a
// separate DOM layer and stay perfectly crisp, which is exactly the look.
// maxblur is kept low deliberately: this pass costs a depth render.
let bokehPass = null;
if (!NO_POST) {
  bokehPass = new BokehPass(scene, camera, { focus: 3.0, aperture: 0.00058, maxblur: 0.0055 });
  composer.addPass(bokehPass);
}

const grainPass = new ShaderPass(GrainVignetteShader);
grainPass.renderToScreen = true;
composer.addPass(grainPass);

// ═══════════════════ camera stops ═══════════════════
const stops = {};
function computeStops() {
  const aspect = innerWidth / innerHeight;
  // every entry in FIXED_STOP, so adding a room-reveal stop needs no code here
  for (const [k, v] of Object.entries(C.FIXED_STOP)) {
    stops[k] = {
      pos: new THREE.Vector3().fromArray(v.pos),
      tgt: new THREE.Vector3().fromArray(v.tgt)
    };
  }
  for (const key of Object.keys(C.CARRIER)) {
    const c = C.CARRIER[key];
    const d = C.fitDistance(c, aspect);
    const tgt = new THREE.Vector3().fromArray(c.pos);
    const dir = new THREE.Vector3(0, Math.sin(c.elev), -Math.cos(c.elev));
    stops[key] = { pos: tgt.clone().addScaledVector(dir, d), tgt };
    stops[c.room] = stops[key];
  }
}
computeStops();

step(70, 'Setting the type');
await paint();
const panels = buildPanels(scene, cssScene, world.M, stops, MARKET);
panels.orient();

// Compile every shader program up front. Three.js otherwise compiles lazily
// as each new material first enters view, and a shader compile is a hard
// synchronous stall — that is what made the intro stutter, since the smash
// brings ~10 new materials on screen within a few hundred milliseconds.
// Paying it once, behind the loader, buys a smooth intro.
step(86, 'Cutting the keyway');
await paint();
renderer.compile(scene, camera);

// ═══════════════════ path curves ═══════════════════
let curves = [];
function buildCurves() {
  curves = C.TIMELINE.map(seg => {
    if (seg.t !== 'move') return null;
    const a = stops[seg.from], b = stops[seg.to];
    const pts = [a.pos.clone(), ...(seg.via || []).map(v => new THREE.Vector3().fromArray(v)), b.pos.clone()];
    const tps = [a.tgt.clone(), ...(seg.vtgt || []).map(v => new THREE.Vector3().fromArray(v)), b.tgt.clone()];
    return {
      pos: new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5),
      tgt: new THREE.CatmullRomCurve3(tps, false, 'catmullrom', 0.5)
    };
  });
}
buildCurves();

// ═══════════════════ mood ═══════════════════
const fogCol = new THREE.Color(), cA = new THREE.Color(), cB = new THREE.Color();
function applyMood(z) {
  const T = C.MOOD;
  let i = 0;
  while (i < T.length - 2 && z > T[i + 1].z) i++;
  const a = T[i], b = T[i + 1];
  const t = clamp01((z - a.z) / (b.z - a.z));
  cA.setHex(a.fog); cB.setHex(b.fog);
  fogCol.copy(cA).lerp(cB, t);
  scene.fog.color.copy(fogCol);
  renderer.setClearColor(fogCol, 1);
  scene.fog.near = a.near + (b.near - a.near) * t;
  scene.fog.far = a.far + (b.far - a.far) * t;
  renderer.toneMappingExposure = a.exp + (b.exp - a.exp) * t;
}

// ═══════════════════ hud + header ═══════════════════
const dots = [...document.querySelectorAll('#chapters i')];
const chapname = document.getElementById('chapname');
const cue = document.getElementById('scrollcue');
const topnav = document.getElementById('topnav');
const navBtns = [...document.querySelectorAll('#topnav nav button')];
let lastChapter = -1;
const ROOM_KEYS = ['office', 'trading', 'study', 'rooftop'];
function updateHud(p) {
  let idx = 0;
  for (let i = 0; i < C.CHAPTERS.length; i++) if (p >= C.CHAPTERS[i].p) idx = i;
  if (idx !== lastChapter) {
    lastChapter = idx;
    chapname.textContent = C.CHAPTERS[idx].name;
    dots.forEach((d, i) => d.classList.toggle('on', i === idx));
    const room = ROOM_KEYS[idx - 1];
    navBtns.forEach(b => b.classList.toggle('on', b.dataset.jump === room));
    if (room) AUDIO.roomArrival(room); else AUDIO.resetRoomTone();
  }
  cue.classList.toggle('show', introDone && p < 0.34);
}

// ═══════════════════ camera ═══════════════════
const cPos = new THREE.Vector3(), cTgt = new THREE.Vector3();
function sampleCamera(p) {
  for (let i = 0; i < C.TIMELINE.length; i++) {
    const s = C.TIMELINE[i];
    if (p < s.p0 || p > s.p1) continue;
    if (s.t === 'hold') {
      const st = stops[s.stop];
      cPos.copy(st.pos); cTgt.copy(st.tgt);
    } else {
      const t = sstep((p - s.p0) / (s.p1 - s.p0));
      curves[i].pos.getPoint(t, cPos);
      curves[i].tgt.getPoint(t, cTgt);
    }
    return;
  }
  const last = stops.rooftop;
  cPos.copy(last.pos); cTgt.copy(last.tgt);
}

// ═══════════════════ navigation — station to station ═══════════════════
// Input never controls distance or speed. Any gesture (wheel, W/S, arrows,
// touch, nav button) selects the NEXT or PREVIOUS station, and the camera
// travels there at a fixed rate and comes to rest exactly on it.
//
// The previous model started a fixed-DURATION glide per gesture, which meant
// a short scroll could strand the camera mid-corridor with nothing framed —
// "it moves then just stops". Travelling to a station instead makes landing
// on content the only possible outcome.
let p = 0;
let introDone = REDUCED_MOTION;
let navLocked = true;

const RATE = 0.019;                    // timeline units per second in transit
const HOP_MIN = 1.6, HOP_MAX = 6.5;    // seconds; clamps a single hop

let stationIdx = 0;
let travel = null;        // active hop tween
let pending = 0;          // one queued direction, so fast input still responds
const keys = new Set();
let wheelLatch = 0;       // swallows the tail of one physical scroll gesture

// The next station strictly ahead of / behind the current position. Using
// "strictly past p" rather than "nearest" matters at the very start: the
// camera rests at INTRO_END (door shut) which is just short of station 0,
// and a forward input there must open the door, not skip over it.
function nextStationIdx(dir) {
  const S = C.STATIONS;
  if (dir > 0) {
    for (let i = 0; i < S.length; i++) if (S[i] > p + 1e-4) return i;
    return S.length - 1;
  }
  for (let i = S.length - 1; i >= 0; i--) if (S[i] < p - 1e-4) return i;
  return 0;
}

function goToStation(idx) {
  const S = C.STATIONS;
  idx = Math.max(0, Math.min(S.length - 1, idx));
  stationIdx = idx;
  const target = S[idx];
  if (travel) { travel.kill(); travel = null; }
  const dist = Math.abs(target - p);
  if (dist < 1e-4) return;
  const st = { v: p };
  travel = gsap.to(st, {
    v: target,
    duration: Math.min(HOP_MAX, Math.max(HOP_MIN, dist / RATE)),
    ease: 'power1.inOut',
    onUpdate() { p = st.v; },
    onComplete() {
      travel = null;
      if (pending) { const d = pending; pending = 0; goToStation(stationIdx + d); }
      else if (keys.has('fwd')) goToStation(stationIdx + 1);
      else if (keys.has('back')) goToStation(stationIdx - 1);
    }
  });
}

function advance(dir) {
  if (navLocked) return;
  wakeFromIdle();
  if (travel) { pending = dir; return; }
  goToStation(nextStationIdx(dir));
}

// W / ArrowUp travels forward through the building; S / ArrowDown reverses.
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') { if (!keys.has('fwd')) { keys.add('fwd'); advance(1); } e.preventDefault(); }
  else if (k === 's' || k === 'arrowdown') { if (!keys.has('back')) { keys.add('back'); advance(-1); } e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.delete('fwd');
  else if (k === 's' || k === 'arrowdown') keys.delete('back');
});
addEventListener('blur', () => keys.clear());

// One physical flick = exactly one station, and the latch is what enforces it.
//
// The subtlety that broke this: a macOS trackpad keeps emitting wheel events
// for well over a second AFTER the finger lifts, as momentum decays. The old
// latch was 140ms and only extended on events it accepted, so the momentum
// tail sailed straight through it. Each of those events found a hop already
// in flight and set `pending`, which fired the instant the hop landed — you
// touched the contact card for a beat and were then carried off to the
// message pad without asking. So: EVERY wheel event pushes the latch out,
// accepted or not. A gesture is only new once the wheel has been quiet for
// WHEEL_QUIET, which is what "the finger left the pad" actually looks like.
const WHEEL_QUIET = 420;
addEventListener('wheel', (e) => {
  if (navLocked) return;
  e.preventDefault();
  const t = performance.now();
  const fresh = t >= wheelLatch;
  wheelLatch = t + WHEEL_QUIET;
  if (fresh) advance(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

// Same rule for touch: one swipe is one station. This used to re-fire every
// 26px of travel, so a single long drag queued several hops.
let touchY = null, touchFired = false;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; touchFired = false; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (navLocked || touchY === null || touchFired) return;
  const dy = touchY - e.touches[0].clientY;
  if (Math.abs(dy) > 26) { advance(dy > 0 ? 1 : -1); touchFired = true; }
}, { passive: true });
addEventListener('touchend', () => { touchY = null; });

// ── idle drift ────────────────────────────────────────────────────
// After a few seconds untouched the camera breathes very slightly. Static 3D
// reads as a screenshot; a little parallax reads as a place. Amplitude is in
// metres and deliberately below the threshold of looking like drunk-cam.
const IDLE_AFTER = 3.4;
let idleFor = 0;
const drift = new THREE.Vector3();
function wakeFromIdle() { idleFor = 0; }
addEventListener('mousemove', wakeFromIdle, { passive: true });

function updateDrift(dt, now) {
  idleFor += dt;
  const amt = clamp01((idleFor - IDLE_AFTER) / 2.2) * (travel ? 0 : 1);
  const t = now * 0.001;
  drift.set(
    Math.sin(t * 0.31) * 0.030 * amt,
    Math.sin(t * 0.23 + 1.3) * 0.018 * amt,
    Math.sin(t * 0.19 + 2.1) * 0.022 * amt
  );
}

// LOCKED (?p=X) freezes the timeline for headless capture — no input,
// no autoplay, just a single reproducible frame.
let LOCKED = null;
{
  const q = new URLSearchParams(location.search);
  if (q.has('p')) {
    LOCKED = clamp01(parseFloat(q.get('p')));
    p = LOCKED;
    introDone = true;
    navLocked = false;
    // headless capture tabs throttle hard enough that neither the fade-out
    // timer nor the CSS opacity transition completes before --screenshot
    // fires, leaving a half-faded loader over the frame. Locked mode doesn't
    // need the loading UX at all, so take it out of the layer stack outright.
    const _ld = document.getElementById('loader');
    _ld.classList.add('gone');
    _ld.style.display = 'none';
  }
  if (q.get('bare') === '1') {
    for (const id of ['hud', 'chapters', 'scrollcue', 'topnav', 'skipIntro', 'breakBtn', 'cursor']) {
      const e = document.getElementById(id); if (e) e.style.display = 'none';
    }
  }
}

// ═══════════════════ autoplay intro ═══════════════════
const skipBtn = document.getElementById('skipIntro');
let introTimeline = null;
let introStarted = false;
let breakOffered = false;
const breakBtn = document.getElementById('breakBtn');
breakBtn.classList.add('hide');

function startSmash() {
  if (introStarted || !introTimeline) return;
  introStarted = true;
  breakBtn.classList.add('hide');
  // this click IS the user gesture, so the AudioContext can finally start and
  // the impact is actually audible
  armAudio();
  introTimeline.play();
}
function handoff() {
  introDone = true;
  navLocked = false;
  p = Math.max(p, C.INTRO_END);
  topnav.classList.add('show');
  skipBtn.classList.add('hide');
}

if (LOCKED !== null) {
  skipBtn.style.display = 'none';
  breakBtn.style.display = 'none';
  topnav.classList.add('show');
} else if (REDUCED_MOTION) {
  p = C.INTRO_END;
  skipBtn.style.display = 'none';
  breakBtn.style.display = 'none';
  handoff();
} else {
  const introState = { p: 0 };
  const tl = gsap.timeline({
    // Paused at construction. startIntro() is called from the render loop
    // only once real frames are going and the loader has faded — otherwise
    // the smash plays behind the loading screen and the visitor misses it.
    paused: true,
    onUpdate() { p = introState.p; },
    onComplete() { gsap.delayedCall(C.INTRO_HANDOFF_PAUSE, handoff); }
  });
  introTimeline = tl;
  for (const phase of C.INTRO_PACING) {
    const to = phase.to !== undefined ? phase.to : C.BEAT[phase.key][1];
    tl.to(introState, { p: to, duration: phase.dur, ease: phase.ease });
  }
  // Precise one-shot audio cues, scheduled against the SAME timeline so
  // they land at the right real-time moment regardless of each phase's
  // ease curve. Linearly interpolates target-p within whichever phase
  // spans it — close enough for a sound cue, no need for exact easing.
  const beatTime = (targetP) => {
    let acc = 0, p0 = 0;
    for (const phase of C.INTRO_PACING) {
      const p1 = phase.to !== undefined ? phase.to : C.BEAT[phase.key][1];
      if (targetP <= p1 + 1e-9) {
        const frac = p1 > p0 ? clamp01((targetP - p0) / (p1 - p0)) : 0;
        return acc + frac * phase.dur;
      }
      acc += phase.dur; p0 = p1;
    }
    return acc;
  };
  tl.call(() => AUDIO.impactThunk(), null, beatTime(C.BEAT.impact));
  tl.call(() => AUDIO.coinCascade(C.INTRO_PACING.find(x => x.key === 'gather').dur, 16), null, beatTime(C.BEAT.gather[0]));
  tl.call(() => AUDIO.doorForge(), null, beatTime(C.BEAT.forge[0]));

  breakBtn.addEventListener('click', startSmash);
  // pressing a nav key with the bank still intact means "get on with it"
  addEventListener('keydown', (e) => {
    if (introStarted) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 's' || k === ' ' || k === 'arrowup' || k === 'arrowdown') startSmash();
  });
  skipBtn.addEventListener('click', () => {
    tl.kill();
    p = C.INTRO_END;
    breakBtn.classList.add('hide');
    handoff();
  });
}

// ═══════════════════ header nav clicks ═══════════════════
// Jump straight to a room's READING station (not its reveal), since someone
// clicking "Positions" wants the board, not the doorway.
const ROOM_STATION = { office: 1, trading: 2, study: 3, rooftop: 4 };
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!introDone) return;
    const idx = ROOM_STATION[btn.dataset.jump];
    if (idx === undefined) return;
    pending = 0;
    wakeFromIdle();
    goToStation(idx);
  });
});

// ═══════════════════ live position data ═══════════════════
// data/positions.json is regenerated nightly in CI from real market data
// (see data/build_positions.py). The board falls back to whatever is baked
// into the HTML if the fetch fails, so a network blip degrades to stale
// numbers rather than an empty board.
(async () => {
  try {
    const r = await fetch('data/positions.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('status ' + r.status);
    const d = await r.json();
    const st = d.strategy, bm = d.benchmark;
    const sign = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

    const ret = document.getElementById('roboReturn');
    if (ret) {
      ret.textContent = sign(st.total_return);
      ret.className = 'n ' + (st.total_return >= 0 ? 'up' : 'down');
    }
    const asOf = document.getElementById('boardAsOf');
    if (asOf) asOf.textContent = 'Live · as of ' + d.window.end;

    // Sharpe and drawdown are shown next to the return on purpose: this
    // strategy currently beats SPY on total return but not risk-adjusted,
    // and a board that hid that would be worth less than one that shows it.
    const stats = document.getElementById('boardStats');
    if (stats) stats.textContent =
      `Sharpe ${st.sharpe.toFixed(2)} · Max DD ${st.max_drawdown.toFixed(1)}%`;

    const bench = document.getElementById('boardBench');
    if (bench) bench.innerHTML =
      `${bm.symbol} <b>${sign(bm.total_return)}</b> · Sharpe ${bm.sharpe.toFixed(2)}`;
  } catch (err) {
    console.warn('positions.json unavailable; board shows baked-in values', err);
  }
})();

// ═══════════════════ message pad ═══════════════════
// Posts to the same Formspree endpoint the existing site already uses, with
// a mailto: fallback so a network failure still gets the message through.
{
  const ta = document.getElementById('noteText');
  const from = document.getElementById('noteFrom');
  const btn = document.getElementById('noteSend');
  const status = document.getElementById('noteStatus');
  const say = (msg, isErr) => { status.textContent = msg; status.classList.toggle('err', !!isErr); };

  // typing must not drive the camera
  for (const el of [ta, from]) {
    el.addEventListener('keydown', e => e.stopPropagation());
    el.addEventListener('keyup', e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  }

  btn.addEventListener('click', async () => {
    const msg = ta.value.trim();
    if (!msg) { say('Write something first.', true); return; }
    btn.disabled = true; say('Sending…');
    try {
      const r = await fetch('https://formspree.io/f/xojkjeel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message: msg, email: from.value.trim() || 'anonymous', _subject: 'Vault — message' })
      });
      if (!r.ok) throw new Error('bad status ' + r.status);
      ta.value = ''; from.value = '';
      say('Sent — thank you.');
    } catch (err) {
      say('Could not send; opening your mail client…', true);
      open('mailto:uicheema@uwaterloo.ca?subject=' + encodeURIComponent('Vault — message') +
        '&body=' + encodeURIComponent(msg), '_blank');
    } finally {
      btn.disabled = false;
    }
  });
}

// ═══════════════════ sound toggle ═══════════════════
const soundBtn = document.getElementById('soundToggle');
let muted = false;
let audioArmed = false;
function armAudio() {
  if (audioArmed) return;
  audioArmed = true;
  if (!muted) AUDIO.setMuted(false);
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(ev, armAudio, { once: true, passive: true });
}
soundBtn.addEventListener('click', () => {
  muted = !muted;
  audioArmed = true;
  AUDIO.setMuted(muted);
  soundBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  soundBtn.classList.toggle('muted', muted);
});

// ═══════════════════ custom cursor ═══════════════════
const cursorEl = document.getElementById('cursor');
if (matchMedia('(pointer: fine)').matches) {
  document.body.classList.add('has-cursor');
  addEventListener('mousemove', (e) => {
    cursorEl.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
  });
  document.addEventListener('mouseover', (e) => {
    cursorEl.classList.toggle('hot', !!e.target.closest('a,button,.pos-row,[data-hover]'));
  });
} else {
  cursorEl.style.display = 'none';
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  cssRenderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  if (bloomPass) bloomPass.setSize(innerWidth, innerHeight);
  computeStops(); buildCurves(); panels.orient();
}
addEventListener('resize', resize);

// ═══════════════════ loop ═══════════════════
let prev = performance.now(), firstFrame = true, firstFrameAt = 0, loaderDone = false;

// Every carrier's camera stop is DERIVED from the viewport aspect via
// fitDistance(), and the derivation runs once at module load. If the window
// settles on its real size after that — which is normal on a restored tab, on
// mobile when the URL bar collapses, and reliably under headless capture —
// nothing recomputes, because no resize event ever fires. The result is a
// correctly-drawn scene framed for an aspect the viewer never had: everything
// uniformly too small, with clear colour under the floor. One re-derive on the
// first real frame costs nothing and makes the framing depend on the layout
// that actually shipped rather than the one that happened to exist at import.
let didSettle = false;

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;

  if (!didSettle) {
    didSettle = true;
    if (Math.abs(camera.aspect - innerWidth / innerHeight) > 1e-6) resize();
  }

  if (LOCKED !== null) p = LOCKED;
  // otherwise `p` is owned by whichever tween is live: the autoplay intro
  // before handoff, or the station hop afterwards. Both write it directly.

  updateDrift(dt, now);
  sampleCamera(p);
  cPos.add(intro.shake).add(drift);
  camera.position.copy(cPos);
  camera.lookAt(cTgt);

  intro.update(p);
  for (const a of world.anim) a.update(p, dt);
  panels.update(p, camera);
  applyMood(camera.position.z);
  updateHud(p);

  if (bokehPass) {
    bokehPass.uniforms.focus.value = Math.max(0.35, cPos.distanceTo(cTgt));
  }
  grainPass.uniforms.uTime.value = now * 0.001;
  grainPass.uniforms.uAmt.value = REDUCED_MOTION ? 0.4 : 1.0;

  if (firstFrame) { renderer.shadowMap.needsUpdate = true; }
  if (NO_POST) renderer.render(scene, camera);
  else composer.render();
  // renderer.info resets on every render() call — snapshot pass 1 before
  // pass 2 overwrites it, so the debug readout reflects the whole frame.
  const passDraws = renderer.info.render.calls, passTris = renderer.info.render.triangles;
  // Punch the CSS3D holes as a second raw pass directly onto the canvas —
  // see the comment on holeMaterial() in panels.js for why this can't be
  // part of the composited (bloom) pass.
  renderer.autoClear = false;
  renderer.render(panels.holeScene, camera);
  renderer.autoClear = true;
  cssRenderer.render(cssScene, camera);

  if (DEBUG) {
    const r = renderer.info.render;
    DEBUG.textContent =
      `p ${p.toFixed(4)}  introDone ${introDone}  station ${stationIdx}  travel ${!!travel}\n` +
      `cam  [${cPos.toArray().map(v => v.toFixed(3)).join(', ')}]\n` +
      `look [${cTgt.toArray().map(v => v.toFixed(3)).join(', ')}]\n` +
      `draws ${passDraws + r.calls}  tris ${passTris + r.triangles}  progs ${renderer.info.programs.length}\n` +
      `fog ${scene.fog.color.getHexString()} n${scene.fog.near.toFixed(1)} f${scene.fog.far.toFixed(1)} exp ${renderer.toneMappingExposure.toFixed(2)}\n` +
      `clear ${renderer.getClearColor(new THREE.Color()).getHexString()}\n` +
      Object.keys(panels.items).map(k => {
        const it = panels.items[k], cs = getComputedStyle(it.obj.element);
        return `${k.padEnd(7)} vis=${it.obj.visible ? 1 : 0} disp=${cs.display} op=${cs.opacity}`;
      }).join('\n') + '\n' +
      Object.keys(panels.flank).map(k => {
        const it = panels.flank[k], cs = getComputedStyle(it.obj.element);
        return `${('f-' + k).padEnd(7)} vis=${it.obj.visible ? 1 : 0} disp=${cs.display} op=${cs.opacity}`;
      }).join('\n') + '\n' +
      (() => { const l = document.getElementById('loader'), c = getComputedStyle(l); return `loader  disp=${c.display} vis=${c.visibility} op=${c.opacity}`; })();
  }

  // Loader dismissal is driven off the render loop, NOT setTimeout. Timers get
  // throttled hard in backgrounded/occluded tabs, which left the full-screen
  // loader stuck at opacity 1 over the whole scene. rAF is already proven to
  // be running here — if it stops, there is nothing to look at anyway.
  if (firstFrame) {
    firstFrame = false;
    firstFrameAt = now;
    step(100, 'Unlocked');
  } else if (firstFrameAt && !loaderDone) {
    const age = now - firstFrameAt;
    const ld = document.getElementById('loader');
    if (age > 220) ld.classList.add('gone');
    if (age > 1150) { ld.style.display = 'none'; loaderDone = true; }
  }
  // The smash waits for the visitor to press the button (see breakBtn).
  if (loaderDone && !breakOffered && introTimeline) {
    breakOffered = true;
    breakBtn.classList.remove('hide');
  }
  requestAnimationFrame(frame);
}
step(96, 'Throwing the bolts');
await paint();
requestAnimationFrame(frame);

// dev hook: jump to a timeline position from the console (post-handoff only)
window.__goto = (target) => {
  introDone = true; navLocked = false;
  if (travel) { travel.kill(); travel = null; }
  p = clamp01(target);
};
window.__three = { scene, camera, renderer, stops, world, panels };
