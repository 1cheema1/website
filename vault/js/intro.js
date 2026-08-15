import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { BEAT, VAULT_Y, VAULT_R, INTRO_VISIBLE_UNTIL } from './config.js';

// Sub-beat windows derived from BEAT so compressing/expanding the intro
// timeline in config.js cascades here automatically — nothing below is
// a bare magic number tied to one specific timeline scale.
const HAMMER_FOLLOW = 0.038;                                  // post-impact bounce-out
const SHARD_FADE = [BEAT.fall[1], BEAT.fall[1] + 0.032];
const COIN_VANISH = [BEAT.gather[1], BEAT.gather[1] + 0.015];
const IMPACT_FLASH = 0.021;
const BLACKOUT_FADE = [BEAT.forge[0] + 0.018, BEAT.forge[0] + 0.038];
const SHAKE_DECAY = 0.05;   // p-width over which impact shake dies out
import * as TEX from './textures.js';

const PIG = new THREE.Vector3(0, 1.35, 0.05);
const PR = 0.34;                       // piggy body radius (y)
const SX = 1.28, SZ = 1.05;            // ellipsoid stretch
const GRAV = -4.2;
const FLOOR = 0.03;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const span = (p, [a, b]) => clamp01((p - a) / (b - a));

// deterministic RNG so every scroll position reproduces exactly
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ballistic with up to two floor bounces — analytic, fully scrubbable
function ballistic(out, px, py, pz, vx, vy, vz, t) {
  let cx = px, cy = py, cz = pz, ux = vx, uy = vy, uz = vz, rem = t;
  for (let b = 0; b < 3; b++) {
    // time to reach FLOOR going down
    const A = 0.5 * GRAV, Bq = uy, C = cy - FLOOR;
    let th = Infinity;
    const disc = Bq * Bq - 4 * A * C;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-Bq + sq) / (2 * A), t2 = (-Bq - sq) / (2 * A);
      for (const tt of [t1, t2]) if (tt > 1e-4 && tt < th) th = tt;
    }
    if (th > rem || !isFinite(th)) {
      out.set(cx + ux * rem, cy + uy * rem + 0.5 * GRAV * rem * rem, cz + uz * rem);
      return out;
    }
    cx += ux * th; cz += uz * th; cy = FLOOR;
    uy = -(uy + GRAV * th) * 0.34;
    ux *= 0.62; uz *= 0.62;
    rem -= th;
  }
  out.set(cx + ux * rem, FLOOR, cz + uz * rem);
  return out;
}

export function buildIntro(scene, M, glowSprite, emis) {
  const G = new THREE.Group(); scene.add(G);
  const R = rng(20260814);

  // ══════════ materials ══════════
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0xd79aa4, roughness: 0.17, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.1
  });
  const ceramicIn = new THREE.MeshStandardMaterial({ color: 0xb98a90, roughness: 0.72, side: THREE.DoubleSide });
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xd4a63a, metalness: 1.0, roughness: 0.26, envMapIntensity: 1.4 });

  // ══════════ 1 · PIGGY (whole) ══════════
  // Authored in LOCAL space around PIG. -Z is the camera side, so the
  // snout, eyes and ears all live at negative z.
  const whole = new THREE.Group(); whole.position.copy(PIG); G.add(whole);
  {
    const body = new THREE.Mesh(new THREE.SphereGeometry(PR, 40, 28), ceramic);
    body.scale.set(SX, 1, SZ); whole.add(body);

    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.132, 0.105, 26), ceramic);
    snout.position.set(0, -0.030, -0.372); snout.rotation.x = Math.PI / 2; whole.add(snout);
    const nos = new THREE.Mesh(new THREE.CircleGeometry(0.114, 24), ceramicIn);
    nos.position.set(0, -0.030, -0.4255); nos.rotation.y = Math.PI; whole.add(nos);
    const nostril = new THREE.MeshStandardMaterial({ color: 0x6d4248, roughness: 0.45 });
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), nostril);
      n.position.set(s * 0.044, -0.026, -0.4275); n.rotation.y = Math.PI; whole.add(n);
    }
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.080, 0.135, 4), ceramic);
      ear.position.set(s * 0.150, 0.292, -0.115);
      ear.rotation.set(-0.46, Math.PI / 4, s * 0.30); whole.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x16101a, roughness: 0.14, metalness: 0.1 }));
      eye.position.set(s * 0.142, 0.062, -0.330); whole.add(eye);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(s * 0.150, 0.076, -0.349); whole.add(glint);
    }
    // legs: body bottom is at local -0.34, the pedestal top at local -0.46
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.074, 0.175, 16), ceramic);
      leg.position.set(sx * 0.235, -0.383, sz * 0.175); whole.add(leg);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.015, 8, 22, Math.PI * 1.7), ceramic);
    tail.position.set(0, 0.055, 0.368); tail.rotation.set(0, Math.PI / 2, 0.4); whole.add(tail);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.160, 0.014, 0.032), ceramicIn);
    slot.position.set(0, PR - 0.005, 0.045); whole.add(slot);

    whole.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  // fake contact shadow (real shadow maps are baked static)
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.95),
    new THREE.MeshBasicMaterial({
      map: TEX.shadowBlobTexture(), transparent: true, opacity: 0.85,
      depthWrite: false, fog: false
    })
  );
  contact.position.set(0, 0.893, PIG.z); contact.rotation.x = -Math.PI / 2;
  contact.renderOrder = 2; G.add(contact);

  // ══════════ 2 · PIGGY (shards) ══════════
  const shards = new THREE.Group(); shards.visible = false; G.add(shards);
  const shardData = [];
  {
    const ico = new THREE.IcosahedronGeometry(PR, 3);       // 1280 tris
    const pos = ico.getAttribute('position');
    const tris = pos.count / 3;
    const perShard = 10;                                    // -> 128 shards
    const nShards = Math.floor(tris / perShard);
    const TH = 0.009;

    for (let s = 0; s < nShards; s++) {
      const verts = [], idx = [];
      const cen = new THREE.Vector3();
      const raw = [];
      for (let f = 0; f < perShard; f++) {
        const t = s * perShard + f;
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k;
          const v = new THREE.Vector3(pos.getX(i) * SX, pos.getY(i), pos.getZ(i) * SZ);
          raw.push(v); cen.add(v);
        }
      }
      cen.multiplyScalar(1 / raw.length);
      const nrm = cen.clone().normalize();

      // outer + inner shell, then stitch the border
      for (const v of raw) verts.push(v.x - cen.x, v.y - cen.y, v.z - cen.z);
      const off = raw.length;
      for (const v of raw) {
        const iv = v.clone().sub(v.clone().normalize().multiplyScalar(TH));
        verts.push(iv.x - cen.x, iv.y - cen.y, iv.z - cen.z);
      }
      for (let f = 0; f < perShard; f++) {
        const a = f * 3;
        idx.push(a, a + 1, a + 2);
        idx.push(off + a, off + a + 2, off + a + 1);
        for (let e = 0; e < 3; e++) {
          const i0 = a + e, i1 = a + (e + 1) % 3;
          idx.push(i0, off + i0, i1, i1, off + i0, off + i1);
        }
      }
      const gm = new THREE.BufferGeometry();
      gm.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      gm.setIndex(idx); gm.computeVertexNormals();

      const mesh = new THREE.Mesh(gm, ceramic);
      mesh.castShadow = false;
      shards.add(mesh);

      const jx = (R() - 0.5) * 0.5, jy = (R() - 0.5) * 0.5, jz = (R() - 0.5) * 0.5;
      const sp = 0.6 + R() * 0.9;
      shardData.push({
        mesh,
        base: new THREE.Vector3(PIG.x + cen.x, PIG.y + cen.y, PIG.z + cen.z),
        v: new THREE.Vector3(nrm.x * sp + jx, nrm.y * sp + 0.95 + jy, nrm.z * sp + jz),
        w: new THREE.Vector3((R() - 0.5) * 9, (R() - 0.5) * 9, (R() - 0.5) * 9)
      });
    }
    // loose parts fly whole
    for (const [ox, oy, oz, rr] of [[-0.155, 0.29, 0.11, 0.075], [0.155, 0.29, 0.11, 0.075], [0, -0.02, 0.36, 0.11]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(rr, 10, 8), ceramic);
      shards.add(m);
      shardData.push({
        mesh: m,
        base: new THREE.Vector3(PIG.x + ox, PIG.y + oy, PIG.z + oz),
        v: new THREE.Vector3((R() - 0.5) * 1.3, 1.35 + R() * 0.7, (R() - 0.5) * 1.3 - 0.6),
        w: new THREE.Vector3((R() - 0.5) * 10, (R() - 0.5) * 10, (R() - 0.5) * 10)
      });
    }
  }

  // ══════════ 3 · COINS ══════════
  const N_COIN = 132;
  const coinGeo = new THREE.CylinderGeometry(0.030, 0.030, 0.0045, 22);
  coinGeo.rotateX(Math.PI / 2);                       // face along local +Z
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, N_COIN);
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coins.frustumCulled = false; coins.visible = false;
  G.add(coins);

  const coinData = [];
  const RINGS = [[0.30, 12], [0.52, 18], [0.72, 24], [0.90, 30], [1.055, 34], [1.15, 14]];
  {
    let slot = [];
    for (const [rad, n] of RINGS) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rad * 3.1;
        slot.push(new THREE.Vector3(Math.cos(a) * rad, VAULT_Y + Math.sin(a) * rad, -0.055));
      }
    }
    while (slot.length < N_COIN) slot.push(new THREE.Vector3(0, VAULT_Y, -0.055));
    slot = slot.slice(0, N_COIN);

    for (let i = 0; i < N_COIN; i++) {
      const u = R() * Math.PI * 2, v = Math.acos(2 * R() - 1), rr = Math.pow(R(), 1 / 3) * PR * 0.78;
      const base = new THREE.Vector3(
        PIG.x + Math.sin(v) * Math.cos(u) * rr * SX,
        PIG.y + Math.cos(v) * rr,
        PIG.z + Math.sin(v) * Math.sin(u) * rr * SZ
      );
      const dir = base.clone().sub(PIG).normalize();
      const sp = 0.75 + R() * 1.15;
      coinData.push({
        base,
        v: new THREE.Vector3(dir.x * sp + (R() - 0.5) * 0.7, Math.abs(dir.y) * sp * 0.5 + 1.55 + R() * 0.85, dir.z * sp + (R() - 0.5) * 0.7 - 0.30),
        w: new THREE.Vector3((R() - 0.5) * 13, (R() - 0.5) * 13, (R() - 0.5) * 13),
        slot: slot[i],
        lift: 0.7 + R() * 1.5,
        ph: R() * Math.PI * 2
      });
    }
  }

  // ══════════ 4 · HAMMER ══════════
  const hammer = new THREE.Group(); G.add(hammer);
  {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.026, 0.62, 16), M.ash);
    handle.position.set(0, -0.31, 0); hammer.add(handle);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.20, 16), M.rubber);
    grip.position.set(0, -0.52, 0); hammer.add(grip);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.085, 0.085), M.steel);
    head.position.set(0.012, 0.02, 0); hammer.add(head);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.050, 0.055, 20), M.steel);
    face.position.set(-0.126, 0.02, 0); face.rotation.z = Math.PI / 2; hammer.add(face);
    const claw = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.020, 8, 14, Math.PI * 0.8), M.steel);
    claw.position.set(0.135, 0.03, 0); claw.rotation.set(Math.PI / 2, 0, -0.5); hammer.add(claw);
    hammer.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
  }

  // ══════════ 5 · VAULT DOOR ══════════
  const hinge = new THREE.Group();
  hinge.position.set(-1.30, VAULT_Y, 0);
  G.add(hinge);
  const door = new THREE.Group();
  door.position.set(1.30, 0, 0);
  hinge.add(door);
  const bolts = [], dial = new THREE.Group();
  {
    const steel = M.steel, dark = M.darkSteel, gold = M.gold;

    const slab = new THREE.Mesh(new THREE.CylinderGeometry(VAULT_R, VAULT_R, 0.30, 72), steel);
    slab.rotation.x = Math.PI / 2; door.add(slab);

    // concentric machined grooves on the face
    for (let i = 0; i < 5; i++) {
      const r = 0.36 + i * 0.185;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 80), dark);
      ring.position.z = -0.152; door.add(ring);
    }
    // radial ribs
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.90, 0.028), dark);
      rib.position.set(Math.cos(a) * 0.70, Math.sin(a) * 0.70, -0.163);
      rib.rotation.z = a - Math.PI / 2; door.add(rib);
    }
    // outer bevel ring
    const bev = new THREE.Mesh(new THREE.TorusGeometry(VAULT_R - 0.03, 0.055, 12, 84), gold);
    bev.position.z = -0.152; door.add(bev);

    // machined lettering circling the bolt ring — RingGeometry's UV wraps
    // U around the angle by default, so a horizontally-repeating engraving
    // texture reads correctly circling the door with no per-glyph math.
    const engraveRing = new THREE.Mesh(
      new THREE.RingGeometry(VAULT_R - 0.100, VAULT_R - 0.058, 128),
      new THREE.MeshStandardMaterial({
        map: TEX.engravingTexture('PATIENCE COMPOUNDS  ·  RISK-ADJUSTED, NOT RISK-FREE  ·  ', { repeat: 4, h: 96 }),
        transparent: true, metalness: 0.85, roughness: 0.4, envMapIntensity: 1.0, side: THREE.DoubleSide
      })
    );
    engraveRing.rotation.y = Math.PI; engraveRing.position.z = -0.17; door.add(engraveRing);

    // hinge arms
    for (const y of [-0.72, 0.72]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.14, 0.14), dark);
      arm.position.set(-1.22, y, 0); door.add(arm);
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.34, 16), dark);
      pin.position.set(-1.34, y, 0); door.add(pin);
    }

    // locking bolts around the rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.30, 14), gold);
      b.rotation.z = Math.PI / 2;
      const dirx = Math.cos(a), diry = Math.sin(a);
      b.userData = { dirx, diry, r: VAULT_R - 0.04 };
      b.position.set(dirx * (VAULT_R + 0.09), diry * (VAULT_R + 0.09), 0);
      b.rotation.set(0, 0, a + Math.PI / 2);
      door.add(b); bolts.push(b);
    }

    // central dial
    door.add(dial);
    const dh = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.10, 44), gold);
    dh.rotation.x = Math.PI / 2; dh.position.z = -0.19; dial.add(dh);
    const dr = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.024, 10, 52), dark);
    dr.position.z = -0.235; dial.add(dr);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.62, 12), gold);
      sp.position.set(Math.cos(a) * 0, Math.sin(a) * 0, -0.245);
      sp.rotation.set(Math.PI / 2, 0, a);
      sp.geometry.translate(0, 0, 0);
      const holder = new THREE.Group(); holder.add(sp);
      sp.position.set(Math.cos(a) * 0.31, Math.sin(a) * 0.31, -0.245);
      sp.rotation.set(0, 0, a + Math.PI / 2);
      dial.add(sp);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), gold);
      knob.position.set(Math.cos(a) * 0.60, Math.sin(a) * 0.60, -0.245); dial.add(knob);
    }
    // 48 tick marks merged into a single draw call — they only ever move
    // together (the whole `dial` group rotates), so one static mesh is
    // exactly equivalent to 48 separate ones.
    {
      const tickGeos = [];
      const tmpBox = new THREE.BoxGeometry(0.012, 0.034, 0.012);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const g = tmpBox.clone();
        m4.makeRotationZ(a);
        m4.setPosition(Math.cos(a) * 0.265, Math.sin(a) * 0.265, -0.248);
        g.applyMatrix4(m4);
        tickGeos.push(g);
      }
      const ticks = new THREE.Mesh(mergeGeometries(tickGeos), dark);
      dial.add(ticks);
    }

    door.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    hinge.visible = false;
  }

  // Blackout plate sealing the vault throat until the door exists.
  // Fades out under cover of the fully-formed door.
  const blackout = new THREE.Mesh(
    new THREE.CircleGeometry(1.245, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.92, transparent: true, opacity: 1, envMapIntensity: 0.05 })
  );
  blackout.position.set(0, VAULT_Y, 0.50); blackout.rotation.y = Math.PI; G.add(blackout);

  // shockwave ring at the forge moment
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.0, 72),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  shock.position.set(0, VAULT_Y, -0.10); G.add(shock);
  const flash = new THREE.PointLight(0xffd08a, 0, 8, 2);
  flash.position.set(0, VAULT_Y, -0.6); G.add(flash);
  const impactGlow = glowSprite(0xfff0c8, 1.6, 0); G.add(impactGlow);
  impactGlow.position.set(PIG.x, PIG.y + 0.2, PIG.z);

  // Camera shake offset — main.js adds this to the sampled camera
  // position every frame. Decays to exactly zero outside the impact
  // window, so it's harmless to always add.
  const shakeVec = new THREE.Vector3();

  // ── reusable temporaries ──
  const tv = new THREE.Vector3(), tq = new THREE.Quaternion(),
    te = new THREE.Euler(), ts = new THREE.Vector3(1, 1, 1), tm = new THREE.Matrix4();
  const bezier = (a, b, c, t, out) => {
    const it = 1 - t;
    out.set(
      it * it * a.x + 2 * it * t * b.x + t * t * c.x,
      it * it * a.y + 2 * it * t * b.y + t * t * c.y,
      it * it * a.z + 2 * it * t * b.z + t * t * c.z
    );
    return out;
  };

  // hammer arc (enters from off-frame right)
  const hA = new THREE.Vector3(2.15, 2.32, 0.06);
  const hB = new THREE.Vector3(1.25, 2.14, 0.06);
  const hC = new THREE.Vector3(0.05, 1.79, 0.06);
  const hUp = new THREE.Vector3(2.55, 2.62, 0.06);

  // ── the update ────────────────────────────────────────────────
  function update(p) {
    const active = p < INTRO_VISIBLE_UNTIL;
    G.visible = active;
    if (!active) return;

    const t0 = (p - BEAT.impact) / (BEAT.fall[1] - BEAT.impact);      // 0..1 across burst+fall
    const flight = Math.max(0, t0) * 1.05;                            // seconds

    // ---- hammer ----
    if (p < BEAT.impact) {
      const w = span(p, BEAT.windup), s = span(p, BEAT.strike);
      if (s <= 0) {
        hammer.position.lerpVectors(hA, hUp, sstep(w));
        hammer.rotation.z = -1.34 - w * 0.30;
      } else {
        const e = s * s;                                              // accelerate into the hit
        bezier(hUp, hB, hC, e, hammer.position);
        hammer.rotation.z = -1.64 + e * 1.52;
      }
      hammer.visible = true;
    } else {
      const r = clamp01((p - BEAT.impact) / HAMMER_FOLLOW);
      hammer.position.set(hC.x + r * 1.5, hC.y + r * 0.9 - r * r * 1.6, hC.z - r * 0.4);
      hammer.rotation.z = -0.12 - r * 3.4;
      hammer.visible = r < 1;
    }

    // ---- piggy / shards ----
    const broken = p >= BEAT.impact;
    whole.visible = !broken;
    shards.visible = broken;
    coins.visible = broken;
    contact.material.opacity = broken ? 0.85 * (1 - clamp01(t0 * 2.2)) : 0.85;

    if (broken) {
      for (const s of shardData) {
        ballistic(tv, s.base.x, s.base.y, s.base.z, s.v.x, s.v.y, s.v.z, flight);
        s.mesh.position.copy(tv);
        s.mesh.rotation.set(s.w.x * flight, s.w.y * flight, s.w.z * flight);
        const fade = clamp01((p - SHARD_FADE[0]) / (SHARD_FADE[1] - SHARD_FADE[0]));
        s.mesh.scale.setScalar(1 - fade);
        s.mesh.visible = fade < 1;
      }
    }

    // ---- coins ----
    if (broken) {
      const gth = sstep(span(p, BEAT.gather));
      const vanish = clamp01((p - COIN_VANISH[0]) / (COIN_VANISH[1] - COIN_VANISH[0]));
      for (let i = 0; i < N_COIN; i++) {
        const c = coinData[i];
        ballistic(tv, c.base.x, c.base.y, c.base.z, c.v.x, c.v.y, c.v.z, Math.min(flight, 1.05));
        if (gth > 0) {
          // curve up into the door ring
          const mid = tv.clone().lerp(c.slot, 0.5);
          mid.y += c.lift; mid.z -= 0.5;
          bezier(tv.clone(), mid, c.slot, gth, tv);
        }
        const spin = gth > 0 ? (1 - gth) * 6 : flight;
        te.set(c.w.x * spin * 0.5, c.w.y * spin * 0.5 + gth * 6.0, c.w.z * spin * 0.5);
        tq.setFromEuler(te);
        const sSc = 1 - vanish;
        ts.set(sSc, sSc, sSc);
        tm.compose(tv, tq, ts);
        coins.setMatrixAt(i, tm);
      }
      coins.instanceMatrix.needsUpdate = true;
      coins.visible = vanish < 1;
    }

    // ---- impact flash ----
    const fl = 1 - clamp01((p - BEAT.impact) / IMPACT_FLASH);
    impactGlow.material.opacity = p >= BEAT.impact ? fl * 0.85 : 0;
    impactGlow.scale.setScalar(1.4 + (1 - fl) * 2.6);

    // ---- blackout plate ----
    const bo = clamp01((p - BLACKOUT_FADE[0]) / (BLACKOUT_FADE[1] - BLACKOUT_FADE[0]));
    blackout.material.opacity = 1 - bo;
    blackout.visible = bo < 1;

    // ---- door forge ----
    const fg = span(p, BEAT.forge);
    hinge.visible = fg > 0;
    if (fg > 0) {
      const e = fg < 1 ? 1 - Math.pow(1 - fg, 3) : 1;
      const overshoot = 1 + Math.sin(clamp01(fg) * Math.PI) * 0.06;
      door.scale.setScalar(e * overshoot);
      shock.material.opacity = Math.sin(clamp01(fg) * Math.PI) * 0.8;
      shock.scale.setScalar(0.3 + fg * 2.4);
      flash.intensity = Math.sin(clamp01(fg) * Math.PI) * 26;
    } else {
      shock.material.opacity = 0; flash.intensity = 0;
    }

    // ---- dial ----
    const dl = span(p, BEAT.dial);
    dial.rotation.z = -sstep(dl) * Math.PI * 7.0;

    // ---- bolts ----
    const bl = sstep(span(p, BEAT.bolts));
    for (const b of bolts) {
      const r = VAULT_R + 0.09 - bl * 0.30;
      b.position.set(b.userData.dirx * r, b.userData.diry * r, 0);
    }

    // ---- swing ----
    const sw = span(p, BEAT.swing);
    hinge.rotation.y = sstep(sw) * 1.78;

    // ---- impact camera shake ----
    if (p >= BEAT.impact && p < BEAT.impact + SHAKE_DECAY) {
      const t = (p - BEAT.impact) / SHAKE_DECAY;
      const decay = (1 - t) * (1 - t);
      shakeVec.set(
        Math.sin(p * 821) * 0.014 * decay,
        Math.sin(p * 1300 + 1.7) * 0.011 * decay,
        Math.cos(p * 947) * 0.010 * decay
      );
    } else {
      shakeVec.set(0, 0, 0);
    }
  }

  return { update, group: G, shake: shakeVec };
}
