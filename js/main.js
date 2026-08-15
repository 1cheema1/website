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

// The Book marks its two ETFs to market from the same nightly file. Anything
// missing stays an em dash rather than rendering a fabricated number.
if (MARKET && MARKET.personal) {
  for (const [sym, el] of [['XEQT', 'xeqtPf'], ['CHPS', 'chpsPf']]) {
    const d = MARKET.personal[sym], node = document.getElementById(el);
    if (!d || !node || typeof d.one_year !== 'number') continue;
    node.textContent = (d.one_year >= 0 ? '+' : '') + d.one_year.toFixed(1) + '%';
    node.classList.add(d.one_year >= 0 ? 'up' : 'down');
  }
  const asOf = document.getElementById('allocAsOf');
  if (asOf && MARKET.window && MARKET.window.end) {
    asOf.textContent = `1Y · marked ${MARKET.window.end} · personal holdings · not advice`;
  }
}

step(52, 'Forging the vault');
await paint();
const intro = buildIntro(scene, world.M, world.glowSprite, world.emis);
// the intro cuts these at the burst so the only light is flying gold
intro.bindRoomLights(world.anteLights);

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
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmt: { value: 1 }, uHit: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt; uniform float uHit;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
    void main(){
      vec2 d = vUv - 0.5;
      // 38 · impact pulse. Both effects scale with distance from centre, so the
      // frame tears at the edges and the subject stays readable — a uniform
      // smear just looks like the renderer broke.
      vec4 c;
      if (uHit > 0.001) {
        float amt = uHit * 0.020;
        vec2 dir = d * amt;
        // radial blur: a few taps back toward centre
        vec4 acc = vec4(0.0);
        for (int i = 0; i < 5; i++) {
          float f = float(i) / 4.0;
          acc += texture2D(tDiffuse, vUv - dir * f * 1.6);
        }
        acc *= 0.2;
        // chromatic aberration: channels sampled at different offsets
        c.r = texture2D(tDiffuse, vUv + dir * 1.30).r;
        c.g = acc.g;
        c.b = texture2D(tDiffuse, vUv - dir * 1.30).b;
        c.a = 1.0;
        c.rgb = mix(acc.rgb, c.rgb, 0.75);
      } else {
        c = texture2D(tDiffuse, vUv);
      }
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
  // The résumé desk, framed by the same rule even though it is off the
  // p-track — so it reframes correctly on resize like everything else.
  {
    const c = C.RESUME;
    const d = C.fitDistance(c, aspect);
    const tgt = new THREE.Vector3().fromArray(c.pos);
    const dir = new THREE.Vector3(0, Math.sin(c.elev), -Math.cos(c.elev));
    stops.resume = { pos: tgt.clone().addScaledVector(dir, d), tgt };
  }
}
computeStops();

step(70, 'Setting the type');
await paint();
const panels = buildPanels(scene, cssScene, world.M, stops, MARKET);
panels.orient();

// ── precompile, thoroughly ────────────────────────────────────────
// Shader compilation is a synchronous stall, and any program not built here
// gets built the first frame its object is drawn — which is mid-journey, and
// is what "laggy in the initial stages between scrolls" was. Walking the
// program count through the whole timeline showed it climbing 30 → 35 across
// the first four stops, i.e. five compiles spread over the opening minute.
//
// Two things were missing. The hole-punch planes live in their own scene, so
// they were never covered. And the intro's shard batches are InstancedMesh,
// which needs a different program from the same material on a regular Mesh —
// compiling the piggy whole does not compile the shards.
//
// Everything is visible at this point (room culling only starts in frame()),
// so one pass per scene reaches all of it.
renderer.compile(scene, camera);
renderer.compile(panels.holeScene, camera);

// Force the intro's own objects through a compile too: they are parented into
// `scene` but several are hidden at p=0, and a hidden object is skipped.
{
  const hidden = [];
  scene.traverse((o) => { if (o.isMesh && !o.visible) { hidden.push(o); o.visible = true; } });
  if (hidden.length) renderer.compile(scene, camera);
  for (const o of hidden) o.visible = false;
}


// Compile every shader program up front. Three.js otherwise compiles lazily
// as each new material first enters view, and a shader compile is a hard
// synchronous stall — that is what made the intro stutter, since the smash
// brings ~10 new materials on screen within a few hundred milliseconds.
// Paying it once, behind the loader, buys a smooth intro.
step(86, 'Cutting the keyway');
await paint();

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
      AUDIO.stationTick();
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

// ═══════════════════ the résumé desk ═══════════════════
// An excursion off the timeline: p is frozen, and the camera lerps from
// whatever the timeline says to the résumé stop. Keeping p frozen (rather than
// extending the timeline past 1.0) means none of the tour's ~40 p-constants
// have to be renormalised for one detail view.
let resumeT = 0;
let resumeTween = null;

function openResume() {
  if (resumeT === 1 && !resumeTween) return;
  if (travel) { travel.kill(); travel = null; }
  pending = 0; keys.clear();
  navLocked = true;
  resumeTween?.kill();
  const s = { v: resumeT };
  resumeTween = gsap.to(s, {
    v: 1, duration: 2.2, ease: 'power2.inOut',
    onUpdate() { resumeT = s.v; },
    onComplete() { resumeTween = null; }
  });
}

function closeResume() {
  if (resumeT === 0 && !resumeTween) return;
  setHover(null);
  resumeTween?.kill();
  const s = { v: resumeT };
  resumeTween = gsap.to(s, {
    v: 0, duration: 1.8, ease: 'power2.inOut',
    onUpdate() { resumeT = s.v; },
    onComplete() { resumeTween = null; navLocked = false; }
  });
}

addEventListener('keydown', (e) => {
  if (resumeT > 0 && (e.key === 'Escape' || e.key.toLowerCase() === 's')) {
    closeResume(); e.preventDefault();
  }
});

// Deep link: /#resume skips the tour and opens the résumé desk, so the URL can
// be handed to a recruiter directly. Also how the headless checks reach it.
function jumpToResume() {
  const last = C.STATIONS.length - 1;
  p = C.STATIONS[last];
  stationIdx = last;
  if (travel) { travel.kill(); travel = null; }
  introDone = true;
  resumeT = 1;
  navLocked = true;
}
addEventListener('hashchange', () => {
  if (location.hash === '#resume') openResume(); else closeResume();
});

// LOCKED (?p=X) freezes the timeline for headless capture — no input,
// no autoplay, just a single reproducible frame.
let LOCKED = null;
const QUERY = new URLSearchParams(location.search);
{
  const q = QUERY;
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
    for (const id of ['hud', 'chapters', 'topnav', 'skipIntro', 'breakBtn', 'cursor']) {
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
const titleCard = document.getElementById('titlecard');

// 37 · scatter the letters. Each gets a vector away from centre so the name
// comes apart the way the ceramic does rather than simply fading.
function burstTitle() {
  if (!titleCard) return;
  const letters = titleCard.querySelectorAll('.tc-name span');
  const n = letters.length;
  letters.forEach((el, i) => {
    const dir = (i - (n - 1) / 2) / Math.max(1, (n - 1) / 2);   // -1..1
    el.style.setProperty('--tx', (dir * (140 + Math.random() * 220)).toFixed(0) + 'px');
    el.style.setProperty('--ty', ((Math.random() - 0.62) * 260).toFixed(0) + 'px');
    el.style.setProperty('--rz', ((Math.random() - 0.5) * 90).toFixed(0) + 'deg');
    el.style.setProperty('--o', '0');
  });
  titleCard.classList.add('burst');
  setTimeout(() => titleCard.classList.remove('show'), 900);
}
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

const WANT_RESUME = location.hash === '#resume' || QUERY.get('resume') === '1';

if (LOCKED !== null || WANT_RESUME) {
  skipBtn.style.display = 'none';
  breakBtn.style.display = 'none';
  topnav.classList.add('show');
  if (WANT_RESUME) { handoff(); jumpToResume(); }
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
  const tImpact = beatTime(C.BEAT.impact);

  // ── 30 · time ramp ────────────────────────────────────────────
  // Drop into slow motion just before contact and snap back once the shards
  // are away. Scaling the timeline rather than the physics keeps everything —
  // camera, shards, coins, audio scheduling — in lockstep, because all of it
  // is driven from the same p.
  tl.call(() => {
    gsap.to(tl, { timeScale: 0.16, duration: 0.10, ease: 'power2.out', overwrite: true });
  }, null, Math.max(0, tImpact - 0.10));
  tl.call(() => {
    gsap.to(tl, { timeScale: 1.0, duration: 0.55, ease: 'power2.inOut', overwrite: true });
  }, null, tImpact + 0.16);
  // The swell has to START early enough to ARRIVE on the hit — that lead is
  // what makes the impact feel authored instead of merely triggered.
  tl.call(() => AUDIO.smashSwell(1.1), null, Math.max(0, tImpact - 1.1));
  tl.call(() => AUDIO.preImpactSilence(0.26), null, Math.max(0, tImpact - 0.26));
  tl.call(() => { AUDIO.impactThunk(); burstTitle(); }, null, tImpact);
  tl.call(() => AUDIO.shardScatter(1.2, 26), null, tImpact + 0.02);
  tl.call(() => AUDIO.coinCascade(C.INTRO_PACING.find(x => x.key === 'gather').dur, 18), null, beatTime(C.BEAT.gather[0]));
  tl.call(() => AUDIO.coinSettle(0.15, -0.5), null, beatTime(C.BEAT.fall[1]));
  tl.call(() => AUDIO.coinSettle(0.42, 0.6), null, beatTime(C.BEAT.fall[1]));
  tl.call(() => AUDIO.doorForge(), null, beatTime(C.BEAT.forge[0]));
  tl.call(() => AUDIO.dialSpin(0.95), null, beatTime(C.BEAT.dial[0]));
  tl.call(() => AUDIO.boltsThrow(6, 0.62), null, beatTime(C.BEAT.bolts[0]));

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
    AUDIO.uiClick();
    if (titleCard) titleCard.classList.remove('show');
    handoff();
  });
}

// ═══════════════════ header nav clicks ═══════════════════
// Jump straight to a room's READING station (not its reveal), since someone
// clicking "Positions" wants the board, not the doorway.
// indices shifted when the vault-open hold stopped being a station
const ROOM_STATION = { office: 0, trading: 1, study: 2, rooftop: 3 };
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
    // The board no longer reports returns — the Source column replaced them, and
    // performance figures belong to the strategy, not to a list of projects. The
    // only thing still taken from the nightly file is the freshness stamp, which
    // is what makes "LIVE" mean something.
    const asOf = document.getElementById('boardAsOf');
    if (asOf && d.window && d.window.end) asOf.textContent = 'Live · as of ' + d.window.end;
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
let ptrX = -100, ptrY = -100, hoverDirty = false;

// ── adaptive quality ────────────────────────────────────────────
// One frame-time average now drives both the cursor and the render cost. The
// expensive things here are, in order: depth of field (a full depth pass every
// frame), bloom (several render targets), and pixel count. Rather than pick one
// setting for every machine, the page walks down a ladder when it is behind and
// back up when it has room. Thresholds are far apart and each step has a
// cooldown, because a renderer that changes resolution twice a second looks far
// worse than one that is simply slower.
//
// Nothing here changes the scene — same geometry, same lights, same materials.
const QUALITY = [
  { dpr: 1.5,  bloom: true,  bokeh: true  },   // 0 · everything
  { dpr: 1.35, bloom: true,  bokeh: false },   // 1 · DoF is the first to go
  { dpr: 1.15, bloom: true,  bokeh: false },   // 2 · fewer pixels
  { dpr: 1.0,  bloom: false, bokeh: false }    // 3 · floor
];
let qTier = 0, qHoldUntil = 0;
// Downward-biased on purpose. Stepping down is cheap insurance; stepping back
// up reallocates every render target, so it is rare and requires real headroom.
const Q_DOWN_MS = 27, Q_UP_MS = 13.5;
const Q_DOWN_COOLDOWN = 2500, Q_UP_COOLDOWN = 9000;

function applyQuality(tier) {
  const q = QUALITY[tier];
  qTier = tier;
  const want = Math.min(devicePixelRatio, q.dpr);
  if (Math.abs(renderer.getPixelRatio() - want) > 0.01) {
    renderer.setPixelRatio(want);
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    if (bloomPass) bloomPass.setSize(innerWidth, innerHeight);
  }
  if (bloomPass) bloomPass.enabled = q.bloom;
  if (bokehPass) bokehPass.enabled = q.bokeh;
}

let frameEMA = 16.7;               // ms, exponential moving average
const FINE_POINTER = matchMedia('(pointer: fine)').matches;
if (FINE_POINTER) {
  document.body.classList.add('has-cursor');

  // The ring is written here, in the input handler, not in the frame loop.
  // Both run once per frame, but input is dispatched BEFORE rAF within the same
  // frame, so this is the earliest the position can be set — deferring to rAF
  // costs a whole frame of latency and buys nothing.
  //
  // pointerrawupdate where available: dispatched at the pointer's own polling
  // rate rather than coalesced to the display's, so the ring tracks a high-rate
  // mouse even when the renderer is behind.
  //
  // The honest limit: a DOM ring is painted by the main thread, so during a
  // 40ms frame it cannot move at all. The only real fix for that is frame time,
  // which is what the quality ladder above is for — not giving up the ring.
  const writeRing = (e) => {
    ptrX = e.clientX; ptrY = e.clientY;
    cursorEl.style.transform = `translate3d(${ptrX}px, ${ptrY}px, 0)`;
  };
  if ('onpointerrawupdate' in window) {
    addEventListener('pointerrawupdate', writeRing, { passive: true });
  } else {
    addEventListener('pointermove', writeRing, { passive: true });
  }
} else {
  cursorEl.style.display = 'none';
}

// ═══════════════════ panel interaction ═══════════════════
// Nothing on a CSS3D panel can be clicked the ordinary way. CSS3DRenderer nests
// every panel under a preserve-3d wrapper carrying a matrix3d, and Chrome will
// not hit-test into that subtree — elementFromPoint() over a card link returns
// the wrapper, never the link. So the panels' own pointer-events are irrelevant
// and both DOM layers stay pointer-events:none.
//
// Instead we reuse the geometry that is already exact: each panel has a
// hole-punch plane sitting in precisely the place the HTML is drawn. Raycast
// those, take the hit UV, and map it back into element pixels — the panel's
// layout is plain 2D CSS inside a fixed-size box, so offsetLeft/offsetTop give
// each child's rect without any 3D involved.
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const HIT_SLOP = 12;          // element px of forgiveness; links are thin
const HIT_SEL = 'a[href],button,textarea,input,.pos-row';

function hittablePanels() {
  const out = [];
  if (panels.resume.obj.visible) out.push(panels.resume);
  for (const k of Object.keys(panels.items)) {
    if (panels.items[k].obj.visible) out.push(panels.items[k]);
  }
  return out;
}

// Which child of `root` covers the point (lx, ly), in the element's own px?
// Walks offsetParent rather than getBoundingClientRect: rects are meaningless
// inside preserve-3d, offsets are pure layout and stay correct.
function childAt(root, lx, ly) {
  let found = null;
  for (const t of root.querySelectorAll(HIT_SEL)) {
    if (t.offsetParent === null && t !== root) continue;   // display:none
    let x = 0, y = 0, n = t;
    while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    if (lx >= x - HIT_SLOP && lx <= x + t.offsetWidth + HIT_SLOP &&
        ly >= y - HIT_SLOP && ly <= y + t.offsetHeight + HIT_SLOP) found = t;   // last = topmost
  }
  return found;
}

function panelTargetAt(cx, cy) {
  const list = hittablePanels();
  if (!list.length) return null;
  _ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const hits = _ray.intersectObjects(list.map(i => i.hole), false);
  if (!hits.length || !hits[0].uv) return null;
  const item = list.find(i => i.hole === hits[0].object);
  if (!item) return null;
  // PlaneGeometry uv (0,0) is the bottom-left of the plane; CSS3DRenderer flips
  // Y when it builds the object matrix, so the element's top is uv.y = 1.
  const lx = hits[0].uv.x * item.c.el[0];
  const ly = (1 - hits[0].uv.y) * item.c.el[1];
  const el = childAt(item.obj.element, lx, ly);
  return el ? { item, el } : null;
}

// :hover never fires on these elements either, for the same reason — so hover
// state is a .hov class we apply ourselves.
let hovEl = null;
function setHover(el) {
  if (hovEl === el) return;
  if (hovEl) hovEl.classList.remove('hov');
  hovEl = el;
  if (hovEl) hovEl.classList.add('hov');
  cursorEl.classList.toggle('hot', !!hovEl);
  document.body.style.cursor = hovEl && !FINE_POINTER ? 'pointer' : '';
}

// Real DOM chrome that sits above the canvas and handles its own clicks.
const OVERLAY_SEL = '#topnav,#breakBtn,#skipIntro,#loader,#hud,#chapters';

// e.target is not always an Element (a synthetic event dispatched on window
// has target === window), so never call .closest on it directly.
const overOverlay = (e) => e.target instanceof Element && !!e.target.closest(OVERLAY_SEL);

// A raycast plus a walk of offsetLeft/offsetTop per candidate is too much to
// run on every pointer event — mousemove fires far faster than we render. Mark
// it dirty here and resolve at most once per frame, in frame().
addEventListener('mousemove', (e) => {
  if (overOverlay(e)) {
    setHover(null);
    cursorEl.classList.toggle('hot', !!e.target.closest('a,button'));
    hoverDirty = false;
    return;
  }
  hoverDirty = true;
}, { passive: true });

function updateHover() {
  if (!hoverDirty) return;
  hoverDirty = false;
  const t = panelTargetAt(ptrX, ptrY);
  setHover(t ? t.el : null);
}

let dispatching = false;      // el.click() below re-enters this listener otherwise
addEventListener('click', (e) => {
  if (dispatching || overOverlay(e)) return;
  const t = panelTargetAt(e.clientX, e.clientY);
  if (!t) return;
  e.preventDefault();
  dispatching = true;
  try { activate(t.el); } finally { dispatching = false; }
});

// Exposed under ?debug=1 so the headless checks can assert that a screen
// coordinate really does resolve to the link under it — this whole path
// replaces DOM hit-testing, so nothing else can verify it.
if (DEBUG) window.__panelHit = panelTargetAt;

function activate(el) {
  if (el.id === 'resumeBack') return closeResume();
  if (el.dataset.act === 'resume') { AUDIO.pageTurn(); return openResume(); }

  if (el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    // #resumeDl is a real <a download>; clicking it programmatically runs the
    // browser's own download path, which is what the user asked for.
    if (el.hasAttribute('download')) { el.click(); return; }
    if (/^(mailto:|tel:)/i.test(href)) { location.href = href; return; }
    if (href) window.open(href, '_blank', 'noopener');
    return;
  }
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') { el.focus(); return; }
  if (el.tagName === 'BUTTON' || el.classList.contains('pos-row')) { el.click(); return; }
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
// uniformly too small, with clear colour under the floor.
let lastW = innerWidth, lastH = innerHeight;
let frameNo = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  frameNo++;

  // The viewport can settle at ANY point after load — a restored tab, a mobile
  // URL bar collapsing, a headless capture window still being sized. The old
  // one-shot check on the first frame missed all of those, and the scene stayed
  // framed for an aspect the viewer never had: everything uniformly too small,
  // with the canvas covering only part of the page. Comparing against the last
  // size each frame is two integer compares and self-heals whenever it changes.
  if (innerWidth !== lastW || innerHeight !== lastH) {
    lastW = innerWidth; lastH = innerHeight;
    resize();
  }

  if (LOCKED !== null) p = LOCKED;
  // otherwise `p` is owned by whichever tween is live: the autoplay intro
  // before handoff, or the station hop afterwards. Both write it directly.

  // frame-time EMA drives both the pointer and the quality ladder
  frameEMA += ((dt * 1000) - frameEMA) * 0.06;
  if (!NO_POST && now > qHoldUntil) {
    if (frameEMA > Q_DOWN_MS && qTier < QUALITY.length - 1) {
      applyQuality(qTier + 1); qHoldUntil = now + Q_DOWN_COOLDOWN;
    } else if (frameEMA < Q_UP_MS && qTier > 0) {
      applyQuality(qTier - 1); qHoldUntil = now + Q_UP_COOLDOWN;
    }
  }
  updateHover();

  updateDrift(dt, now);
  sampleCamera(p);
  // The résumé excursion blends off the timeline pose toward the desk stop.
  // p is frozen while this runs, so sampleCamera keeps returning the same
  // contact-card pose and the blend is stable frame to frame.
  if (resumeT > 0) {
    cPos.lerp(stops.resume.pos, resumeT);
    cTgt.lerp(stops.resume.tgt, resumeT);
  }
  cPos.add(intro.shake).add(drift);
  camera.position.copy(cPos);
  camera.lookAt(cTgt);

  intro.update(p);
  // world anim is ambient motion only (motes); half rate is imperceptible
  // and halves the per-frame CPU cost of it
  if ((frameNo & 1) === 0) for (const a of world.anim) a.update(p, dt * 2);
  // Fade the page in over the back half of the flight, so it is not a
  // billboard sailing toward you the whole way.
  panels.setResume(resumeT <= 0 ? 0 : clamp01((resumeT - 0.45) / 0.4));
  panels.update(p, camera);
  // ── 51 · drop rooms out of range ─────────────────────────────
  // 503 draw calls were being submitted from the antechamber, because every
  // room ahead was still in the frustum. AHEAD is generous (fog reaches ~24m,
  // so anything past that is invisible anyway) and BEHIND is tight, since you
  // never turn around. Toggling one Group skips its entire subtree.
  {
    const cz = camera.position.z;
    // Range follows the fog rather than a constant: nothing past fog.far is
    // visible by definition, so that IS the correct cull distance, and it
    // tightens automatically in the rooms where the fog closes in. A fixed 22m
    // kept the study loaded from the antechamber, where fog ends at 12.7.
    const AHEAD = (scene.fog ? scene.fog.far : 24) + 2, BEHIND = 4;
    for (const r of world.rooms) {
      r.g.visible = (r.z1 > cz - BEHIND) && (r.z0 < cz + AHEAD);
    }
  }

  applyMood(camera.position.z);
  AUDIO.updateBeds(camera.position.z);
  // hand the listener pose to the mixer so positioned voices pan correctly
  {
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    AUDIO.setListener(camera.position.x, camera.position.z, -fwd.z, fwd.x);
  }
  // room life: keystrokes on the floor, an occasional page in the study
  {
    const z = camera.position.z;
    const room = (z > 9.5 && z < 17.0) ? 'trading' : (z > 17.0 && z < 22.5) ? 'study' : null;
    AUDIO.setClock(!!room, room);
  }
  updateHud(p);

  if (bokehPass) {
    // 35 · rack focus. Normally focus tracks whatever the camera is reading.
    // Across the forge it pulls off the pedestal and onto the far wall, so the
    // door resolves out of a blur instead of simply appearing — the shift is
    // what tells you where to look next.
    let f = Math.max(0.35, cPos.distanceTo(cTgt));
    if (p >= C.BEAT.fall[1] && p < C.BEAT.dial[1]) {
      const k = sstep(clamp01((p - C.BEAT.fall[1]) / (C.BEAT.dial[1] - C.BEAT.fall[1])));
      const near = Math.max(0.35, cPos.distanceTo(new THREE.Vector3(0, 1.35, 0.05)));
      const far = Math.max(0.35, Math.abs(cPos.z - 0.0) + 0.6);
      f = near + (far - near) * k;
    }
    bokehPass.uniforms.focus.value = f;
  }
  grainPass.uniforms.uTime.value = now * 0.001;
  grainPass.uniforms.uAmt.value = REDUCED_MOTION ? 0.4 : 1.0;
  // pulse rides the same p the shake does, so it lands exactly on contact
  {
    const w = 0.030;
    const k = (p >= C.BEAT.impact && p < C.BEAT.impact + w)
      ? Math.pow(1 - (p - C.BEAT.impact) / w, 2.0) : 0;
    grainPass.uniforms.uHit.value = REDUCED_MOTION ? 0 : k;
  }

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
    // the name sits over the dark chamber alongside the invitation to break it
    if (titleCard) titleCard.classList.add('show');
    breakBtn.classList.remove('hide');
  }
  // A full pipeline warmup was tried here and removed. Rendering a handful of
// real frames behind the loader does eliminate the remaining mid-journey
// compiles — measured: the program count stops climbing entirely, sitting at
// its final value from the very first stop. But even at 64x64 the resize of
// the composer's render targets plus one scene render was heavy enough to stop
// the page loading under a software rasteriser, and it is not something I can
// verify on real hardware from here. Shipping an unverifiable stall in the
// loading path is worse than the four compiles it saves.
//
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
