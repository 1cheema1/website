// Fully synthesized — no audio files. Muted by default; the browser
// won't let an AudioContext run before a user gesture anyway, so the
// context is created lazily on the first unmute click.
let ctx = null, master = null, muted = true;

function ensure() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  if (m) { if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08); return; }
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.15);
}

function noiseBuffer(dur) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ── thunk on hammer impact ──────────────────────────────────────
export function impactThunk() {
  if (muted || !ctx) return;
  const t = ctx.currentTime;

  const osc = ctx.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(48, t + 0.16);
  const og = ctx.createGain(); og.gain.setValueAtTime(0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(og).connect(master); osc.start(t); osc.stop(t + 0.24);

  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.12);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(bp).connect(ng).connect(master); src.start(t); src.stop(t + 0.12);
}

// ── one coin landing in the door ring ───────────────────────────
function coinTick(delay, freq) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.05);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  osc.connect(g).connect(master); osc.start(t); osc.stop(t + 0.36);
}

// schedules a cascade of chimes across `dur` seconds, starting now
export function coinCascade(dur, count = 14) {
  if (muted || !ctx) return;
  for (let i = 0; i < count; i++) {
    const delay = (i / count) * dur + Math.random() * 0.03;
    const freq = 900 + Math.random() * 1100;
    coinTick(delay, freq);
  }
}

// ── the vault door sealing shut with a heavy metal resonance ────
export function doorForge() {
  if (muted || !ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(70, t);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(220, t);
  lp.frequency.exponentialRampToValueAtTime(60, t + 0.5);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  osc.connect(lp).connect(g).connect(master); osc.start(t); osc.stop(t + 0.65);
}

// ── a soft arrival tone, one per room, distinct pitch each ──────
const ROOM_FREQ = { office: 392.0, trading: 293.66, study: 349.23, rooftop: 440.0 };
let lastRoomTone = null;
export function roomArrival(room) {
  if (muted || !ctx || lastRoomTone === room) return;
  lastRoomTone = room;
  const t = ctx.currentTime, f = ROOM_FREQ[room] || 330;
  for (const [ratio, amp] of [[1, 0.10], [1.5, 0.055], [2, 0.035]]) {
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.value = f * ratio;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    osc.connect(g).connect(master); osc.start(t); osc.stop(t + 2.3);
  }
}
export function resetRoomTone() { lastRoomTone = null; }
