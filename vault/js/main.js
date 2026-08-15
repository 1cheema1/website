import * as THREE from 'three';
import { CSS3DRenderer } from '../lib/CSS3DRenderer.js';
import { RoomEnvironment } from '../lib/RoomEnvironment.js';
import { EffectComposer } from '../lib/EffectComposer.js';
import { RenderPass } from '../lib/RenderPass.js';
import { ShaderPass } from '../lib/ShaderPass.js';
import { UnrealBloomPass } from '../lib/UnrealBloomPass.js';
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
const step = (pct, msg) => { lbar.style.width = pct + '%'; if (msg) lmsg.textContent = msg; };

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

step(10, 'Environment');

// ═══════════════════ image-based lighting ═══════════════════
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
  scene.environment = env.texture;
  pmrem.dispose();
}

step(24, 'Building rooms');
const world = buildWorld(scene);

step(50, 'Forging the vault');
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
const grainPass = new ShaderPass(GrainVignetteShader);
grainPass.renderToScreen = true;
composer.addPass(grainPass);

// ═══════════════════ camera stops ═══════════════════
const stops = {};
function computeStops() {
  const aspect = innerWidth / innerHeight;
  stops.intro = { pos: new THREE.Vector3().fromArray(C.FIXED_STOP.intro.pos), tgt: new THREE.Vector3().fromArray(C.FIXED_STOP.intro.tgt) };
  stops.wide = { pos: new THREE.Vector3().fromArray(C.FIXED_STOP.wide.pos), tgt: new THREE.Vector3().fromArray(C.FIXED_STOP.wide.tgt) };
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

step(70, 'Typesetting');
const panels = buildPanels(scene, cssScene, world.M, stops);
panels.orient();

// Compile every shader program up front. Three.js otherwise compiles lazily
// as each new material first enters view, and a shader compile is a hard
// synchronous stall — that is what made the intro stutter, since the smash
// brings ~10 new materials on screen within a few hundred milliseconds.
// Paying it once, behind the loader, buys a smooth intro.
step(84, 'Compiling shaders');
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

// ── Timeline pacing ──────────────────────────────────────────────
// Different beats deserve different dwell time: a room you're reading
// should crawl, a corridor you're passing through should not. SEGMENTS
// carries that weighting (its `vh` numbers are now just relative weights,
// no longer literal page height). PACE converts a p value into a speed
// multiplier so travel is quick and rooms linger, while the INPUT rate
// stays perfectly constant — which is the whole point of dropping scroll.
const TOTAL_W = C.SEGMENTS.reduce((a, s) => a + s.vh, 0);
function paceAt(p) {
  let p0 = 0;
  for (const s of C.SEGMENTS) {
    if (p <= s.p) {
      // p-units per weight-unit: wide segments (long dwell) advance slower
      const span = (s.p - p0) || 1e-6;
      return (span / (s.vh / TOTAL_W));
    }
    p0 = s.p;
  }
  return 1;
}

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

// ═══════════════════ navigation — constant-rate transport ═══════════════════
// The page does NOT scroll. Scroll position was the root of the erratic feel:
// wheel/trackpad deltas vary wildly per device and per flick, so identical
// gestures moved the camera different distances. Instead, ANY input (W/S,
// arrows, wheel, nav buttons) resolves to a direction, and the timeline
// advances at a FIXED rate per second in that direction. Same speed every
// time, every device. The wheel is kept as an input but only contributes a
// direction for a short window — its magnitude is deliberately discarded.
let p = 0;
let introDone = REDUCED_MOTION;
let navLocked = true;

const BASE_RATE = 0.020;        // timeline units/sec at pace 1.0
// One scroll gesture — ANY speed, ANY length — starts a glide that keeps
// moving at the constant BASE_RATE for this long. Magnitude of the wheel
// delta is deliberately discarded; a hard flick and a gentle nudge produce
// exactly the same motion. Further scrolling during a glide just extends it.
const GLIDE_MS = 900;

const keys = new Set();
let wheelDir = 0, wheelUntil = 0;
let jumpTween = null;           // set while a nav-button jump is animating

function cancelJump() { if (jumpTween) { jumpTween.kill(); jumpTween = null; } }

// W / ArrowUp travels FORWARD through the building (deeper into the rooms);
// S / ArrowDown reverses. That matches "W is forward" from games, and reads
// the same as scrolling down to advance.
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') { keys.add('fwd'); cancelJump(); e.preventDefault(); }
  else if (k === 's' || k === 'arrowdown') { keys.add('back'); cancelJump(); e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') keys.delete('fwd');
  else if (k === 's' || k === 'arrowdown') keys.delete('back');
});
addEventListener('blur', () => keys.clear());

addEventListener('wheel', (e) => {
  if (navLocked) return;
  wheelDir = e.deltaY > 0 ? 1 : -1;
  wheelUntil = performance.now() + GLIDE_MS;
  cancelJump();
  e.preventDefault();
}, { passive: false });

// touch: drag up = forward, at the same constant rate
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (navLocked || touchY === null) return;
  const dy = touchY - e.touches[0].clientY;
  if (Math.abs(dy) > 2) {
    wheelDir = dy > 0 ? 1 : -1;
    wheelUntil = performance.now() + GLIDE_MS;
    touchY = e.touches[0].clientY;
    cancelJump();
  }
}, { passive: true });
addEventListener('touchend', () => { touchY = null; });

function navDirection(now) {
  let d = 0;
  if (keys.has('fwd')) d += 1;
  if (keys.has('back')) d -= 1;
  if (now < wheelUntil) d += wheelDir;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
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
    // headless capture tabs can throttle setTimeout hard enough that the
    // loader's normal 220ms fade-out never fires in time for --screenshot;
    // locked mode doesn't need the loading UX, so skip it outright.
    document.getElementById('loader').classList.add('gone');
  }
  if (q.get('bare') === '1') {
    for (const id of ['hud', 'chapters', 'scrollcue', 'topnav', 'skipIntro', 'cursor']) {
      const e = document.getElementById(id); if (e) e.style.display = 'none';
    }
  }
}

// ═══════════════════ autoplay intro ═══════════════════
const skipBtn = document.getElementById('skipIntro');
let introTimeline = null;
let introStarted = false;
function handoff() {
  introDone = true;
  navLocked = false;
  p = Math.max(p, C.INTRO_END);
  topnav.classList.add('show');
  skipBtn.classList.add('hide');
}

if (LOCKED !== null) {
  skipBtn.style.display = 'none';
  topnav.classList.add('show');
} else if (REDUCED_MOTION) {
  p = C.INTRO_END;
  skipBtn.style.display = 'none';
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

  skipBtn.addEventListener('click', () => {
    tl.kill();
    p = C.INTRO_END;
    handoff();
  });
}

// ═══════════════════ header nav clicks ═══════════════════
// Jumping is the one place a non-constant rate is right: distance varies,
// so it tweens on a fixed duration rather than a fixed speed. Any manual
// input cancels it (see cancelJump) so the user is never fighting a tween.
const navState = { p: 0 };
navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!introDone) return;
    const room = btn.dataset.jump;
    const target = C.TIMELINE.find(s => s.t === 'hold' && s.stop === room);
    if (!target) return;
    const midP = (target.p0 + target.p1) / 2;
    cancelJump();
    navState.p = p;
    jumpTween = gsap.to(navState, {
      p: midP, duration: 1.25, ease: 'power2.inOut',
      onUpdate() { p = navState.p; },
      onComplete() { jumpTween = null; }
    });
  });
});

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
let muted = true;
soundBtn.addEventListener('click', () => {
  muted = !muted;
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

function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;

  if (LOCKED !== null) {
    p = LOCKED;
  } else if (introDone && !jumpTween) {
    // Constant rate: direction comes from input, magnitude never does.
    // paceAt() only reweights how long each authored beat lasts.
    const dir = navDirection(now);
    if (dir !== 0) {
      p = Math.min(1, Math.max(C.INTRO_END, p + dir * BASE_RATE * paceAt(p) * dt));
    }
  }
  // while !introDone the GSAP autoplay timeline owns `p`; while jumpTween
  // is live the nav tween owns it. Both write `p` directly.

  sampleCamera(p);
  cPos.add(intro.shake);
  camera.position.copy(cPos);
  camera.lookAt(cTgt);

  intro.update(p);
  for (const a of world.anim) a.update(p, dt);
  panels.update(p, camera);
  applyMood(camera.position.z);
  updateHud(p);

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
      `p ${p.toFixed(4)}  introDone ${introDone}  dir ${navDirection(performance.now())}\n` +
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
    step(100, 'Ready');
  } else if (firstFrameAt && !loaderDone) {
    const age = now - firstFrameAt;
    const ld = document.getElementById('loader');
    if (age > 220) ld.classList.add('gone');
    if (age > 1150) { ld.style.display = 'none'; loaderDone = true; }
  }
  // Only once the loader has cleared does the smash begin, so it is never
  // performed behind the loading screen.
  if (loaderDone && !introStarted && introTimeline) {
    introStarted = true;
    introTimeline.play();
  }
  requestAnimationFrame(frame);
}
step(92, 'Lighting');
requestAnimationFrame(frame);

// dev hook: jump to a timeline position from the console (post-handoff only)
window.__goto = (target) => {
  introDone = true; navLocked = false; cancelJump();
  p = clamp01(target);
};
window.__three = { scene, camera, renderer, stops, world, panels };
