// Fully synthesized — no audio files, nothing to download.
//
// The previous version was four one-shot cues, mono and dry, with silence
// between them: roughly seven seconds of audio across a multi-minute visit. It
// didn't sound cheap so much as empty. What follows is built around two ideas
// that do most of the work — every voice goes through a convolution reverb so
// the place has walls, and every room has a continuous bed so there is never
// nothing. The cues sit on top of that.
//
// Signal path:
//
//   voice ──┬────────────────────────► dry ──┐
//           └── send ──► convolver ──► wet ──┤
//                                            ├──► duck ──► comp ──► shelf ──► out
//   beds ─────────────────────────────────────┘
//
// `duck` is pulled down by the loud cues so an impact reads as loud without
// actually being louder, which matters when the master is already compressed.

let ctx = null;
let master = null;      // everything lands here
let duck = null;        // sidechain target
let comp = null;
let convolver = null;
let wetGain = null;
let bedBus = null;
let muted = true;
let started = false;

// D major pentatonic. This was D minor, which — with a sub drone under it and
// a long dark tail over it — is horror vocabulary, not vault vocabulary. A
// pentatonic set has no minor thirds and no tritone, so nothing in the room
// tones, the pad or the coin chimes can land on an interval that reads as
// dread. Everything pitched on the site comes from here.
const KEY = { D: 146.83, E: 164.81, Fs: 185.00, A: 220.00, B: 246.94 };

const now = () => ctx.currentTime;
const rnd = (a, b) => a + Math.random() * (b - a);

// ── impulse response ────────────────────────────────────────────
// Stone, but a room people work in — not a crypt. The first version ran 2.6s
// with the highs closing hard as it decayed, and that tail was doing as much
// of the eeriness as the drones were: everything arrived trailing a long dark
// smear. Shorter and brighter reads as a large room rather than a tomb.
function buildIR(seconds = 1.7, decay = 2.4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  const preDelay = Math.floor(ctx.sampleRate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      if (i < preDelay) { d[i] = 0; continue; }
      const t = (i - preDelay) / (n - preDelay);
      const env = Math.pow(1 - t, decay);
      // one-pole lowpass that closes as the tail decays
      const target = (Math.random() * 2 - 1) * env;
      lp += (target - lp) * (0.55 - 0.20 * t);   // stays open as it decays
      d[i] = lp;
    }
  }
  return buf;
}

function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  master = ctx.createGain();
  master.gain.value = 0;

  // gentle glue, not a limiter — this should never pump audibly
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 26;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.006;
  comp.release.value = 0.22;

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3600;
  shelf.gain.value = -2.5;      // takes the glassiness off synthesized noise

  duck = ctx.createGain();
  duck.gain.value = 1;

  convolver = ctx.createConvolver();
  convolver.buffer = buildIR();
  wetGain = ctx.createGain();
  wetGain.gain.value = 0.9;

  bedBus = ctx.createGain();
  bedBus.gain.value = 0;        // faded up per room

  convolver.connect(wetGain).connect(duck);
  bedBus.connect(duck);
  duck.connect(comp).connect(shelf).connect(master).connect(ctx.destination);
}

// Voice helper: returns the node a source should connect to, wiring both the
// dry path and a reverb send at `send` (0..1).
function bus(send = 0.30, pan = 0) {
  const g = ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  const dry = ctx.createGain(); dry.gain.value = 1 - send * 0.5;
  const wet = ctx.createGain(); wet.gain.value = send;
  p.connect(dry).connect(duck);
  p.connect(wet).connect(convolver);
  return g;
}

// ── sidechain ───────────────────────────────────────────────────
// Pull the whole mix down briefly under a big hit, then let it back. This is
// what makes an impact feel large without raising its level.
function pump(depth = 0.45, hold = 0.05, release = 0.5) {
  if (!duck) return;
  const t = now();
  duck.gain.cancelScheduledValues(t);
  duck.gain.setValueAtTime(duck.gain.value, t);
  duck.gain.linearRampToValueAtTime(1 - depth, t + 0.012);
  duck.gain.setValueAtTime(1 - depth, t + 0.012 + hold);
  duck.gain.linearRampToValueAtTime(1, t + 0.012 + hold + release);
}

function noiseBuffer(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function noise(dur, out, { type = 'bandpass', freq = 1200, q = 0.8, gain = 0.4, attack = 0.004, decay = null, delay = 0 } = {}) {
  const t = now() + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  const d = decay ?? dur;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(f).connect(g).connect(out);
  src.start(t); src.stop(t + dur + 0.02);
  return { src, f, g };
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  if (m) {
    if (master) master.gain.setTargetAtTime(0, now(), 0.08);
    return;
  }
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  master.gain.setTargetAtTime(0.55, now(), 0.15);
  if (!started) { started = true; startBeds(); startPad(); }
}

// ═══════════════════ 41 · room beds ═══════════════════
// One continuous voice per room, crossfaded by camera z. These are the reason
// the site stops feeling empty: there is always something in the air, and it
// changes as you walk.
const beds = {};

function makeBed(build) {
  const g = ctx.createGain();
  g.gain.value = 0;
  const send = ctx.createGain(); send.gain.value = 0.35;
  g.connect(bedBus);
  g.connect(send).connect(convolver);
  build(g);
  return g;
}

function lfo(rate, depth, target, base) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = rate;
  const a = ctx.createGain(); a.gain.value = depth;
  o.connect(a).connect(target);
  target.value = base;
  o.start();
  return o;
}

function startBeds() {
  // The rule for all four: warm, moving, and never a sustained low drone. A
  // held sub is the single most "abandoned building" sound there is; movement
  // and a bit of rhythm are what make a room feel occupied instead of haunted.

  // antechamber — a warm pad an octave up from where the drone used to sit,
  // breathing slightly. Anticipation, not dread.
  beds.ante = makeBed((out) => {
    for (const [f, amp] of [[KEY.D, 0.075], [KEY.A, 0.050], [KEY.Fs, 0.038]]) {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.value = amp;
      // gentle amplitude drift per voice, at different rates so they never
      // beat against each other in a way that sounds like an alarm
      lfo(0.05 + Math.random() * 0.05, amp * 0.35, g.gain, amp);
      o.connect(lp).connect(g).connect(out); o.start();
    }
    // a soft shimmer on top instead of a rumble underneath
    const sh = ctx.createOscillator(); sh.type = 'sine'; sh.frequency.value = KEY.A * 4;
    const sg = ctx.createGain(); sg.gain.value = 0.006;
    lfo(0.11, 0.005, sg.gain, 0.008);
    sh.connect(sg).connect(out); sh.start();
  });

  // trading floor — a busy room. Keyboards and ticker blips at a human rate do
  // the work; the previous version used wandering bandpassed noise, which is
  // indistinguishable from whispering.
  beds.trading = makeBed((out) => {
    const air = ctx.createBufferSource(); air.buffer = noiseBuffer(4); air.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 0.45;
    const ag = ctx.createGain(); ag.gain.value = 0.045;
    air.connect(bp).connect(ag).connect(out); air.start();

    // warm room tone rather than a 60Hz hum, which reads as machinery
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = KEY.D / 2;
    const olp = ctx.createBiquadFilter(); olp.type = 'lowpass'; olp.frequency.value = 260;
    const og = ctx.createGain(); og.gain.value = 0.030;
    o.connect(olp).connect(og).connect(out); o.start();

    beds._floor = out;    // keystrokes + blips are scheduled from tickFloor()
  });

  // study — a warm quiet room. No clock: a lone tick in near-silence is the
  // most tense sound available, and this is meant to be a place you'd sit.
  beds.study = makeBed((out) => {
    const air = ctx.createBufferSource(); air.buffer = noiseBuffer(4); air.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    const g = ctx.createGain(); g.gain.value = 0.030;
    air.connect(lp).connect(g).connect(out); air.start();

    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = KEY.Fs;
    const og = ctx.createGain(); og.gain.value = 0.016;
    lfo(0.06, 0.008, og.gain, 0.018);
    o.connect(og).connect(out); o.start();
    beds._study = out;    // occasional page rustle
  });

  // rooftop — a warm evening. The wind was swept hard by an LFO, which howls;
  // it is now a soft steady breeze with a city humming a long way below.
  beds.rooftop = makeBed((out) => {
    const w = ctx.createBufferSource(); w.buffer = noiseBuffer(4); w.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.30;
    const g = ctx.createGain(); g.gain.value = 0.038;
    lfo(0.07, 0.012, g.gain, 0.040);
    w.connect(bp).connect(g).connect(out); w.start();

    const city = ctx.createBufferSource(); city.buffer = noiseBuffer(4); city.loop = true;
    const clp = ctx.createBiquadFilter(); clp.type = 'lowpass'; clp.frequency.value = 320;
    const cg = ctx.createGain(); cg.gain.value = 0.032;
    city.connect(clp).connect(cg).connect(out); city.start();

    // a warm chord high above the city, so the roof feels like arrival
    for (const [f, amp] of [[KEY.B, 0.020], [KEY.Fs * 2, 0.012]]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = amp;
      lfo(0.045 + Math.random() * 0.04, amp * 0.45, og.gain, amp);
      o.connect(og).connect(out); o.start();
    }
  });
}

// ── 43 · the pad ────────────────────────────────────────────────
// A slow D-minor bed that runs the whole way through, very quietly. It is what
// ties four rooms into one place; you notice it mainly when it is gone.
let padVoices = [];
function startPad() {
  const out = ctx.createGain(); out.gain.value = 0;
  const send = ctx.createGain(); send.gain.value = 0.55;
  out.connect(bedBus);
  out.connect(send).connect(convolver);
  for (const f of [KEY.D, KEY.Fs, KEY.A, KEY.B]) {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    o.connect(lp).connect(g).connect(out); o.start();
    padVoices.push(g);
  }
  out.gain.setTargetAtTime(0.13, now(), 4.0);
}

// Rooms add voices to the pad as you go, so the harmony fills out across the
// visit rather than being the same four notes from the door.
const PAD_STEP = { ante: 1, office: 2, trading: 3, study: 3, rooftop: 4 };
export function setRoom(room, mix = {}) {
  if (!ctx || muted) return;
  const t = now();
  for (const [k, g] of Object.entries(beds)) {
    if (k.startsWith('_')) continue;
    const want = mix[k] ?? (k === room ? 1 : 0);
    g.gain.setTargetAtTime(want, t, 1.1);
  }
  const n = PAD_STEP[room] ?? 2;
  padVoices.forEach((g, i) => g.gain.setTargetAtTime(i < n ? 0.09 : 0, t, 2.4));
}

// Crossfade the beds from camera depth, so walking between rooms is a blend
// rather than a switch. Called every frame; cheap, and setTargetAtTime already
// smooths, so there is no need to rate-limit it.
const BED_Z = [
  ['ante', -13, 1.2], ['trading', 9.5, 17.5], ['study', 17.0, 22.5], ['rooftop', 23.0, 40]
];
let lastBedKey = null;
export function updateBeds(z) {
  if (!ctx || muted || !started) return;
  let key = 'ante';
  for (const [k, z0, z1] of BED_Z) if (z >= z0 && z <= z1) key = k;
  // the office has no bed of its own; it borrows the trading floor at low level
  if (z > 1.2 && z < 9.5) key = 'office';
  if (key === lastBedKey) return;
  lastBedKey = key;
  const t = now();
  const mix = key === 'office' ? { ante: 0.25, trading: 0.18, study: 0, rooftop: 0 } : {};
  for (const [k, g] of Object.entries(beds)) {
    if (k.startsWith('_')) continue;
    const want = mix[k] ?? (k === key ? 1 : 0);
    g.gain.setTargetAtTime(want, t, 1.4);
  }
  const n = PAD_STEP[key] ?? 2;
  padVoices.forEach((g, i) => g.gain.setTargetAtTime(i < n ? 0.09 : 0, t, 2.4));
}

// Room life. This replaces the study clock: one tick per second in a quiet
// room is a countdown, and it made the study feel tense rather than calm. The
// trading floor gets keystrokes and ticker blips at a human rate, the study
// gets an occasional page. Both are irregular on purpose — anything perfectly
// periodic stops sounding like a person and starts sounding like a machine.
let lifeTimer = null;
let lifeRoom = null;

function scheduleLife() {
  if (lifeTimer) clearTimeout(lifeTimer);
  const room = lifeRoom;
  if (!room || muted || !ctx) return;
  const wait = room === 'trading' ? rnd(90, 420) : rnd(4000, 11000);
  lifeTimer = setTimeout(() => {
    if (!muted && ctx && lifeRoom === room) {
      if (room === 'trading') {
        if (Math.random() < 0.82) {
          // a keystroke: short, dry, low-mid
          const b = bus(0.18, rnd(-0.7, 0.7)); b.gain.value = rnd(0.05, 0.12);
          noise(0.022, b, { type: 'bandpass', freq: rnd(700, 1500), q: 2.2, gain: 0.30, attack: 0.001, decay: 0.02 });
        } else {
          // a soft ticker blip, on a chord tone so it never clashes
          const f = [KEY.A * 2, KEY.D * 4, KEY.Fs * 2][(Math.random() * 3) | 0];
          metalTick(0, f, 0.020, rnd(-0.5, 0.5));
        }
      } else {
        const b = bus(0.30, rnd(-0.3, 0.3)); b.gain.value = 0.35;
        noise(0.28, b, { type: 'highpass', freq: 1700, q: 0.6, gain: 0.10, attack: 0.05, decay: 0.26 });
      }
    }
    scheduleLife();
  }, wait);
}

export function setClock(on, room) {
  if (!ctx) return;
  const want = on ? (room || 'study') : null;
  if (want === lifeRoom) return;
  lifeRoom = want;
  if (!want) { if (lifeTimer) { clearTimeout(lifeTimer); lifeTimer = null; } return; }
  scheduleLife();
}

// ═══════════════════ 44 · the smash ═══════════════════
// Layered, and the layers matter: a reverse swell that arrives exactly on the
// hit, the ceramic crack, the body thud, a sub drop, then a long scatter of
// shards. The swell is the part that makes it feel authored rather than
// triggered — you hear the impact coming.

// Call this ~1.1s BEFORE the impact.
export function smashSwell(lead = 1.1) {
  if (muted || !ctx) return;
  const t = now();
  const b = bus(0.5, 0);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(lead);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(180, t);
  bp.frequency.exponentialRampToValueAtTime(2400, t + lead);
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.34, t + lead * 0.92);
  g.gain.exponentialRampToValueAtTime(0.0001, t + lead);
  src.connect(bp).connect(g).connect(b);
  src.start(t); src.stop(t + lead + 0.02);

  // a rising sine under it, for weight
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(40, t);
  o.frequency.exponentialRampToValueAtTime(140, t + lead);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.20, t + lead * 0.9);
  og.gain.exponentialRampToValueAtTime(0.0001, t + lead);
  o.connect(og).connect(b); o.start(t); o.stop(t + lead + 0.02);
}

// 31 · the drop-out. Everything ducks to near-silence just before the hit —
// silence is what makes an impact land, not level.
export function preImpactSilence(dur = 0.28) {
  if (muted || !duck) return;
  const t = now();
  duck.gain.cancelScheduledValues(t);
  duck.gain.setValueAtTime(duck.gain.value, t);
  duck.gain.linearRampToValueAtTime(0.06, t + 0.05);
  duck.gain.setValueAtTime(0.06, t + dur);
  duck.gain.linearRampToValueAtTime(1, t + dur + 0.02);
}

export function impactThunk() {
  if (muted || !ctx) return;
  const t = now();
  pump(0.55, 0.06, 0.55);

  // body: a sine dropping fast, the "weight" of the hit
  const b = bus(0.22, 0);
  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.20);
  const og = ctx.createGain();
  og.gain.setValueAtTime(1.0, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
  osc.connect(og).connect(b); osc.start(t); osc.stop(t + 0.36);

  // sub drop, felt rather than heard
  const sb = bus(0.10, 0);
  const s = ctx.createOscillator(); s.type = 'sine';
  s.frequency.setValueAtTime(64, t);
  s.frequency.exponentialRampToValueAtTime(26, t + 0.5);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.75, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  s.connect(sg).connect(sb); s.start(t); s.stop(t + 0.62);

  // ceramic: a bright resonant crack, short and nasty
  const cb = bus(0.45, 0);
  noise(0.09, cb, { type: 'bandpass', freq: 3100, q: 1.6, gain: 0.55, attack: 0.001, decay: 0.075 });
  noise(0.16, cb, { type: 'highpass', freq: 5200, q: 0.7, gain: 0.28, attack: 0.001, decay: 0.14 });
}

// 45 · shards and coins. Metal, not triangle waves: two inharmonic partials
// ring-modulated together, which is roughly how struck metal behaves and
// sounds nothing like a chiptune.
function metalTick(delay, freq, amp, pan) {
  const t = now() + delay;
  const b = bus(0.42, pan);
  const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = freq;
  const modOsc = ctx.createOscillator(); modOsc.type = 'sine';
  modOsc.frequency.value = freq * 1.847;     // deliberately inharmonic
  const modGain = ctx.createGain(); modGain.gain.value = freq * 1.2;
  modOsc.connect(modGain).connect(carrier.frequency);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
  carrier.connect(hp).connect(g).connect(b);
  carrier.start(t); carrier.stop(t + 0.36);
  modOsc.start(t); modOsc.stop(t + 0.36);
}

export function shardScatter(dur = 1.2, count = 26) {
  if (muted || !ctx) return;
  for (let i = 0; i < count; i++) {
    // front-loaded: most of the ceramic lands early, stragglers trail off
    // front-loaded, and each one actually offset — an earlier version computed
    // this delay and never passed it, so all 26 shards landed on the same frame
    const d = Math.pow(Math.random(), 1.7) * dur;
    const b = bus(0.4, rnd(-0.9, 0.9));
    b.gain.value = rnd(0.10, 0.30);
    noise(0.05, b, { type: 'bandpass', freq: rnd(1800, 5200), q: rnd(2, 6), gain: 0.5, attack: 0.001, decay: 0.045, delay: d });
  }
}

export function coinCascade(dur = 1.4, count = 18) {
  if (muted || !ctx) return;
  if (!Number.isFinite(dur) || dur <= 0) dur = 1.4;
  const scale = [KEY.D * 4, KEY.E * 4, KEY.Fs * 4, KEY.A * 4, KEY.B * 4];
  for (let i = 0; i < count; i++) {
    const delay = (i / count) * dur + rnd(0, 0.04);
    const f = scale[(Math.random() * scale.length) | 0] * (Math.random() < 0.3 ? 2 : 1);
    metalTick(delay, f, rnd(0.06, 0.15), rnd(-0.85, 0.85));
  }
}

// 36 · a coin that lands flat, wobbles, and stops. Nothing sells physicality
// like the wobble — the interval between contacts shortens as it settles.
export function coinSettle(delay = 0, pan = 0) {
  if (muted || !ctx) return;
  let t = delay + 0.0;
  let gap = 0.20;
  for (let i = 0; i < 14 && gap > 0.012; i++) {
    metalTick(t, rnd(900, 1500), 0.045 * Math.pow(0.86, i), pan);
    t += gap;
    gap *= 0.76;
  }
}

// ═══════════════════ 46 · the door ═══════════════════
export function doorForge() {
  if (muted || !ctx) return;
  const t = now();
  pump(0.30, 0.10, 0.9);
  const b = bus(0.55, 0);

  // low forge swell
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(240, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.38, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  o.connect(lp).connect(g).connect(b); o.start(t); o.stop(t + 0.95);

  // a metallic shimmer as the gold fuses
  for (let i = 0; i < 7; i++) metalTick(rnd(0, 0.5), KEY.D * 8 * rnd(0.9, 1.6), rnd(0.03, 0.07), rnd(-0.7, 0.7));
}

// servo whine while the dial turns
export function dialSpin(dur = 0.95) {
  if (muted || !ctx) return;
  const t = now();
  const b = bus(0.30, 0);
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(320, t);
  o.frequency.linearRampToValueAtTime(520, t + dur * 0.6);
  o.frequency.linearRampToValueAtTime(240, t + dur);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.08);
  g.gain.setValueAtTime(0.055, t + dur - 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(g).connect(b); o.start(t); o.stop(t + dur + 0.02);

  // detent clicks as it passes each number
  for (let i = 0; i < 12; i++) {
    const d = (i / 12) * dur * 0.9;
    const cb = bus(0.2, rnd(-0.2, 0.2)); cb.gain.value = 0.10;
    noise(0.02, cb, { type: 'bandpass', freq: 2200, q: 5, gain: 0.3, attack: 0.001, decay: 0.018, delay: d });
  }
}

// six bolts, thrown one at a time — this is the sound the loader has been
// promising the whole way in
export function boltsThrow(count = 6, spread = 0.62) {
  if (muted || !ctx) return;
  for (let i = 0; i < count; i++) {
    const d = (i / count) * spread;
    const pan = Math.cos((i / count) * Math.PI * 2) * 0.7;
    const b = bus(0.5, pan);
    const t = now() + d;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.10);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp).connect(g).connect(b); o.start(t); o.stop(t + 0.22);
    noise(0.05, b, { type: 'bandpass', freq: 1700, q: 2.2, gain: 0.22, attack: 0.001, decay: 0.045, delay: d });
  }
  pump(0.22, 0.04, 0.4);
}

// the door swinging — a long low groan with the weight of a tonne of steel
export function doorSwing(dur = 2.2) {
  if (muted || !ctx) return;
  const t = now();
  const b = bus(0.6, 0);
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(dur); src.loop = false;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(120, t);
  bp.frequency.linearRampToValueAtTime(300, t + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(90, t + dur);
  bp.Q.value = 3.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(b); src.start(t); src.stop(t + dur);
}

// ═══════════════════ arrival + UI ═══════════════════
// 43 · arrivals are chord tones now, so each room is a note of the same key
// instead of an unrelated pitch.
const ROOM_TONE = { office: KEY.A, trading: KEY.D, study: KEY.Fs, rooftop: KEY.B };
let lastRoomTone = null;

export function roomArrival(room) {
  if (muted || !ctx || lastRoomTone === room) return;
  lastRoomTone = room;
  const f = ROOM_TONE[room] || KEY.D;
  const t = now();
  const b = bus(0.62, 0);
  for (const [ratio, amp] of [[1, 0.085], [2, 0.045], [3, 0.022]]) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(b); o.start(t); o.stop(t + 2.7);
  }
}
export function resetRoomTone() { lastRoomTone = null; }

// ── 48 · interface ──────────────────────────────────────────────
export function uiClick() {
  if (muted || !ctx) return;
  const b = bus(0.2, 0); b.gain.value = 0.5;
  noise(0.03, b, { type: 'bandpass', freq: 1800, q: 3.5, gain: 0.28, attack: 0.001, decay: 0.026 });
}

export function stationTick() {
  if (muted || !ctx) return;
  metalTick(0, KEY.A * 4, 0.035, 0);
}

export function pageTurn() {
  if (muted || !ctx) return;
  const b = bus(0.35, rnd(-0.2, 0.2)); b.gain.value = 0.5;
  noise(0.34, b, { type: 'highpass', freq: 1400, q: 0.6, gain: 0.16, attack: 0.06, decay: 0.32 });
}
