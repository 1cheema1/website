// ─────────────────────────────────────────────────────────────
// Layout constants. Units are METRES. +Z is "inward".
// Camera stops are DERIVED from the carriers so framing can
// never drift out of sync with the props.
// ─────────────────────────────────────────────────────────────
const D = Math.PI / 180;

export const FOV = 45;

export const VAULT_Z = 0;
export const VAULT_Y = 1.40;
export const VAULT_R = 1.20;            // 2.4 m door

export const ROOM = {
  ante:    { z0: -13.0, z1:  0.00, hw: 4.2, h: 3.4 },
  office:  { z0:   0.60, z1:  7.00, hw: 2.5, h: 2.90 },
  trading: { z0:   7.40, z1: 16.00, hw: 4.5, h: 3.60 },
  study:   { z0:  16.40, z1: 23.00, hw: 2.6, h: 2.80 },
  rooftop: { z0:  23.40, z1: 40.00, hw: 5.0, h: 0 }
};

export const DOORS = [
  { z: 7.20, w: 1.34, h: 2.20 },
  { z: 16.20, w: 1.34, h: 2.20 },
  { z: 23.20, w: 1.60, h: 2.30 }
];

// ── The one physical carrier per room ──────────────────────────
// pos    : world centre of the readable face
// w,h    : world size in metres
// el     : source element size in CSS px
// elev   : camera elevation above the carrier's face-plane axis.
//          camera offset dir = (0, sin(elev), -cos(elev))
//          => the carrier tilts (90° - elev) from horizontal.
// h is derived from the element aspect so the CSS plane, the hole punch
// and the paper stock are the same rectangle to the millimetre.
const carrier = (o) => ({ ...o, h: o.w * o.el[1] / o.el[0] });

export const CARRIER = {
  sheet:  carrier({ room: 'office',  el: [1120, 700], w: 0.50, pos: [0, 0.8137, 4.26], elev: 72 * D, fitH: 0.72, fitW: 0.84 }),
  board:  carrier({ room: 'trading', el: [1240, 700], w: 2.60, pos: [0, 1.7500, 15.83], elev: 0 * D, fitH: 0.66, fitW: 0.80 }),
  spread: carrier({ room: 'study',   el: [1080, 700], w: 0.46, pos: [0, 1.0010, 20.15], elev: 33.7 * D, fitH: 0.66, fitW: 0.80 }),
  card:   carrier({ room: 'rooftop', el: [1160, 660], w: 0.42, pos: [0, 0.8673, 27.10], elev: 12 * D, fitH: 0.58, fitW: 0.80 }),
  // the message pad: lies near-flat on the same bistro table, in front of the
  // card, read top-down the way the office tear-sheet is
  note:   carrier({ room: 'note',    el: [1000, 700], w: 0.34, pos: [0, 0.7915, 26.74], elev: 70 * D, fitH: 0.62, fitW: 0.80 })
};

export const STOP_OF = { office: 'sheet', trading: 'board', study: 'spread', rooftop: 'card', note: 'note' };

// Photo + sign flanking the open vault at the 'wide' stop. Both are flat
// wall panels mounted on the antechamber facade, whose front face sits at
// world z=0 (camera looks toward +z from z=-4.4). z must be NEGATIVE —
// i.e. nearer the camera than the facade — or the facade occludes them.
// x is mirrored: this camera looks toward +z (not three.js's default -z),
// so +x lands on SCREEN-LEFT and -x on SCREEN-RIGHT — backwards from the
// naive reading. photo (screen-left) therefore takes positive world x.
// The open door swings around a Y-axis hinge only, so its vertical extent
// never changes with swing angle — it always spans VAULT_Y±VAULT_R
// (0.20..2.60) regardless of horizontal position. The sign sits above
// that (y=2.85+) so the swung-open door can never sweep through it.
// Composition: the SIGN is centred directly above the vault mouth like real
// bank signage, and the PHOTO is a mounted portrait on the clear wall. The
// door hinges at x=-1.30 and swings toward the camera on the -x side, so the
// photo takes +x (screen-LEFT, since this camera looks toward +z) where
// nothing ever sweeps through it.
// Vertical budget at the 'wide' stop (cam y=1.42, z=-4.40, fov 45): the frame
// spans roughly y -0.40 .. 3.24 at the door plane, and the door top is 2.60 —
// so the sign lives in the 2.60..3.24 band.
export const FLANK = {
  // tucked into the gap between the door's rebate ring (outer edge 1.375)
  // and the first facade pilaster (inner edge 2.09) — at x=2.80 it sat on
  // the frame edge and read as an afterthought rather than as hung on a wall
  photo: { el: [520, 650], w: 1.00, pos: [1.93, 1.50, -0.06] },
  sign:  { el: [660, 200], w: 0.92, pos: [0, 2.92, -0.06] }
};
FLANK.photo.h = FLANK.photo.w * FLANK.photo.el[1] / FLANK.photo.el[0];
FLANK.sign.h = FLANK.sign.w * FLANK.sign.el[1] / FLANK.sign.el[0];
// 4-point crossfade in p-space: [inStart, inEnd, outStart, outEnd].
// Now that the swing (0.248→0.300) is visitor-driven, these appear as the
// door actually opens, and are fully GONE by 0.352 — before the office
// sheet's window opens. That non-overlap is load-bearing: these sit back at
// the vault (z≈0) while the office camera is at z≈4.1, so any overlap left
// them behind the camera. See the inFrontOf() guard in panels.js.
export const FLANK_WINDOW = [0.195, 0.232, 0.322, 0.352];

// Per-room panel visibility. These MUST NOT overlap. They used to (sheet ran
// to 0.560 while board opened at 0.516) and mid-corridor both were live at
// once, so the trading board's near-black background punched a dark rectangle
// into the middle of the office — the "black info cards" bug. Each window now
// closes before the next opens, leaving a dead band around each corridor's
// midpoint where no panel shows. validate.mjs enforces this.
export const PANEL_WINDOW = {
  sheet:  [0.360, 0.545],
  board:  [0.556, 0.690],
  spread: [0.700, 0.835],
  card:   [0.845, 0.938],
  note:   [0.946, 1.010]
};

// Distance that frames a carrier inside the viewport, given aspect.
export function fitDistance(c, aspect) {
  const t = Math.tan((FOV * D) / 2);
  const dH = c.h / (2 * t * c.fitH);
  const dW = c.w / (2 * t * aspect * c.fitW);
  return Math.max(dH, dW);
}

// Fixed (non-carrier) stops
export const FIXED_STOP = {
  intro: { pos: [0, 1.42, -2.10], tgt: [0, 1.38, 0.05] },
  wide:  { pos: [0, 1.42, -4.40], tgt: [0, 1.40, 0.00] }
};

// ── Timeline ───────────────────────────────────────────────────
export const TIMELINE = [
  { t: 'hold', p0: 0.000, p1: 0.078, stop: 'intro' },
  { t: 'move', p0: 0.078, p1: 0.232, from: 'intro', to: 'wide',
    via: [[0, 1.56, -2.60]], vtgt: [[0, 1.38, 0]] },
  { t: 'hold', p0: 0.232, p1: 0.300, stop: 'wide' },
  { t: 'move', p0: 0.300, p1: 0.432, from: 'wide', to: 'office',
    via: [[0, 1.44, -1.20], [0, 1.40, 1.95]],
    vtgt: [[0, 1.40, 0.90], [0, 1.12, 3.60]] },
  { t: 'hold', p0: 0.432, p1: 0.522, stop: 'office' },
  { t: 'move', p0: 0.522, p1: 0.578, from: 'office', to: 'trading',
    via: [[0, 1.60, 7.20]], vtgt: [[0, 1.74, 10.9]] },
  { t: 'hold', p0: 0.578, p1: 0.668, stop: 'trading' },
  { t: 'move', p0: 0.668, p1: 0.722, from: 'trading', to: 'study',
    via: [[0, 1.64, 16.20]], vtgt: [[0, 1.44, 18.7]] },
  { t: 'hold', p0: 0.722, p1: 0.812, stop: 'study' },
  { t: 'move', p0: 0.812, p1: 0.866, from: 'study', to: 'rooftop',
    via: [[0, 1.38, 23.20]], vtgt: [[0, 1.14, 25.3]] },
  { t: 'hold', p0: 0.866, p1: 0.932, stop: 'rooftop' },
  { t: 'move', p0: 0.932, p1: 0.952, from: 'rooftop', to: 'note' },
  { t: 'hold', p0: 0.952, p1: 1.001, stop: 'note' }
];

// Scroll blocks. Holds own a snap point; moves are short.
export const SEGMENTS = [
  { p: 0.078, vh: 50, snap: 1 },   // intro       — piggy + hammer
  { p: 0.232, vh: 88, snap: 0 },   // smash, coins, assembly
  { p: 0.300, vh: 40, snap: 1 },   // vault unlock
  { p: 0.432, vh: 74, snap: 0 },   // door swings, enter
  { p: 0.522, vh: 58, snap: 1 },   // OFFICE
  { p: 0.578, vh: 38, snap: 0 },
  { p: 0.668, vh: 58, snap: 1 },   // TRADING
  { p: 0.722, vh: 38, snap: 0 },
  { p: 0.812, vh: 58, snap: 1 },   // STUDY
  { p: 0.866, vh: 38, snap: 0 },
  { p: 0.932, vh: 46, snap: 1 },   // ROOFTOP — contact card
  { p: 0.952, vh: 16, snap: 0 },
  { p: 1.000, vh: 40, snap: 1 }    // ROOFTOP — message pad
];

// ── Mood: fog colour / range / exposure keyed on camera z ──────
export const MOOD = [
  { z: -13, fog: 0x050508, near: 1.6, far: 11, exp: 0.95 },
  { z: 0, fog: 0x07070b, near: 1.8, far: 13, exp: 1.00 },
  { z: 3, fog: 0x1a1712, near: 2.4, far: 20, exp: 1.06 },
  { z: 7.2, fog: 0x0e1017, near: 2.6, far: 26, exp: 1.02 },
  { z: 13, fog: 0x070a11, near: 3.0, far: 30, exp: 1.00 },
  { z: 16.2, fog: 0x121009, near: 2.4, far: 20, exp: 1.04 },
  { z: 20, fog: 0x161009, near: 2.2, far: 18, exp: 1.06 },
  { z: 23.4, fog: 0x2c2434, near: 6.0, far: 70, exp: 1.10 },
  { z: 32, fog: 0x33283a, near: 10.0, far: 120, exp: 1.12 }
];

export const CHAPTERS = [
  { p: 0.00, name: 'The Vault' },
  { p: 0.43, name: '01 — Experience' },
  { p: 0.57, name: '02 — Positions' },
  { p: 0.72, name: '03 — Research' },
  { p: 0.86, name: '04 — Contact' }
];

// ── Intro beat map ───────────────────────────────────────────────
// The intro AUTOPLAYS on load (see main.js), driven by its own GSAP
// timeline in real seconds — it no longer waits for scroll input.
// It still shares the same `p` variable as the rest of the site so
// every other system (camera, panels, fog) doesn't need to know the
// difference. INTRO_END is where autoplay hands off to the scrollbar:
// the vault is fully open and settled, ready for the photo/sign reveal.
// Autoplay stops with the door FORMED, UNLOCKED and STILL SHUT. The swing
// itself is the first thing the visitor's own input does — the vault opening
// should feel like their action, not something they watched happen.
export const INTRO_END = 0.248;
export const INTRO_VISIBLE_UNTIL = 0.34;   // shards/coins/hammer group cutoff

export const BEAT = {
  windup: [0.000, 0.048],   // hammer rises
  strike: [0.048, 0.060],   // hammer falls
  impact: 0.060,
  burst:  [0.060, 0.104],   // shards + coins fly
  fall:   [0.104, 0.132],   // gravity takes over
  gather: [0.132, 0.182],   // coins converge to the door ring
  forge:  [0.166, 0.198],   // door materialises
  dial:   [0.198, 0.226],   // dial spins
  bolts:  [0.226, 0.248],   // bolts retract
  swing:  [0.248, 0.300]    // door opens — ends exactly at INTRO_END
};

// Real-seconds duration of each autoplay phase. `to` is the p value the
// phase tweens to; phases with no `to` tween to that BEAT key's own end.
// The last phase always lands exactly on INTRO_END — camera is holding
// at 'wide' with the door fully open, ready for the photo/sign reveal
// and the real-time pause main.js adds before handing off to scroll.
// Ends on `bolts` — the door is built and unlocked but closed. BEAT.swing is
// deliberately NOT in this list; it belongs to the visitor.
export const INTRO_PACING = [
  { key: 'windup', dur: 0.95, ease: 'power2.in' },
  { key: 'strike', dur: 0.13, ease: 'power4.in' },
  { key: 'fall',   dur: 0.62, ease: 'power1.out' },    // covers burst+fall
  { key: 'gather', dur: 0.85, ease: 'power2.inOut' },
  { key: 'dial',   dur: 0.55, ease: 'power1.inOut' },  // covers forge+dial
  { key: 'bolts',  dur: 0.42, ease: 'power1.inOut', to: INTRO_END }
];
export const INTRO_HANDOFF_PAUSE = 0.5;   // real seconds held before input unlocks
