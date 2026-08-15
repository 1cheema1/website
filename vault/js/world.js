import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { ROOM, DOORS } from './config.js';
import * as TEX from './textures.js';

// ── helpers ────────────────────────────────────────────────────
const B = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const PL = (w, h, m) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
const CY = (rt, rb, h, m, s = 20) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);

function at(o, x, y, z, rx = 0, ry = 0, rz = 0) {
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o;
}
function sc(o) { o.castShadow = true; o.receiveShadow = true; return o; }
function rc(o) { o.receiveShadow = true; return o; }

function wallZ(g, mat, z, hw, h, door, thick = 0.14) {
  if (!door) { const w = rc(B(hw * 2, h, thick, mat)); at(w, 0, h / 2, z); g.add(w); return; }
  const side = (hw * 2 - door.w) / 2;
  const l = sc(B(side, h, thick, mat)); at(l, -(door.w / 2 + side / 2), h / 2, z);
  const r = sc(B(side, h, thick, mat)); at(r, (door.w / 2 + side / 2), h / 2, z);
  const t = sc(B(door.w, h - door.h, thick, mat)); at(t, 0, door.h + (h - door.h) / 2, z);
  g.add(l, r, t);
}

function jamb(g, mat, z, door, depth = 0.4) {
  const s = 0.055;
  const l = sc(B(s, door.h, depth, mat)); at(l, -door.w / 2 - s / 2, door.h / 2, z);
  const r = sc(B(s, door.h, depth, mat)); at(r, door.w / 2 + s / 2, door.h / 2, z);
  const t = sc(B(door.w + s * 2, s, depth, mat)); at(t, 0, door.h + s / 2, z);
  g.add(l, r, t);
}

// ═══════════════════════════════════════════════════════════════
export function buildWorld(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const anim = [];
  const glowTex = TEX.glowTexture();

  // ── material library ──────────────────────────────────────────
  const M = {
    oak:     TEX.woodMaterial({ dark: 0x33220f, light: 0x6a4a2c, rings: 26, repeat: [4, 14], seed: 7, bump: 0.9 }),
    walnut:  TEX.woodMaterial({ dark: 0x2a1c11, light: 0x4a3120, rings: 24, repeat: [4, 4], seed: 19, rough: [0.30, 0.46], bump: 0.55 }),
    ash:     TEX.woodMaterial({ dark: 0x7a6446, light: 0xb09067, rings: 22, repeat: [4, 4], seed: 31, bump: 0.6 }),
    deck:    TEX.woodMaterial({ dark: 0x3a352e, light: 0x615748, rings: 46, repeat: [6, 34], seed: 43, rough: [0.62, 0.88], bump: 1.1 }),
    plasterW: TEX.plasterMaterial({ base: 0xa89e8c, repeat: [3, 2], seed: 3 }),
    plasterG: TEX.plasterMaterial({ base: 0x35423a, repeat: [3, 2], seed: 8, tint: 0.10 }),
    plasterD: TEX.plasterMaterial({ base: 0x2b2f36, repeat: [5, 3], seed: 12, tint: 0.08 }),
    ceilW:   TEX.plasterMaterial({ base: 0xcfc7b6, repeat: [4, 4], seed: 21, rough: 0.97 }),
    concrete: TEX.concreteMaterial({ base: 0x3e3b36, repeat: [8, 12], seed: 13 }),
    concrete2: TEX.concreteMaterial({ base: 0x6a655c, repeat: [4, 4], seed: 27 }),
    carpet:  TEX.carpetMaterial({ base: 0x1d1a17, accent: 0x30291f, repeat: [10, 18] }),
    rug:     TEX.carpetMaterial({ base: 0x40201c, accent: 0x6a3a2c, repeat: [3, 3], seed: 55 }),
    marble:  TEX.marbleMaterial({ repeat: [2, 2] }),
    steel:   TEX.brushedMetal({ base: 0x8f959d, repeat: [2, 2] }),
    darkSteel: TEX.brushedMetal({ base: 0x3a3f46, repeat: [2, 2], rough: [0.3, 0.55] }),
    brass:   TEX.brushedMetal({ base: 0xb28f3c, repeat: [1, 1], rough: [0.16, 0.38] }),
    gold:    new THREE.MeshStandardMaterial({ color: 0xc79a35, metalness: 1, roughness: 0.24, envMapIntensity: 1.2 }),
    leather: TEX.leatherMaterial({ base: 0x241c15, repeat: [2, 2] }),
    leatherOx: TEX.leatherMaterial({ base: 0x3d2118, repeat: [2, 2], seed: 65 }),
    paper:   TEX.paperMaterial({ repeat: [1, 1] }),
    black:   new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.1 }),
    rubber:  new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.92 }),
    glass:   new THREE.MeshPhysicalMaterial({ color: 0x9fb6c8, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6 })
  };
  const spines = TEX.spineTexture();
  M.books = new THREE.MeshStandardMaterial({ map: spines, roughness: 0.78 });

  const emis = (c, i = 1) => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: new THREE.Color(c), emissiveIntensity: i, roughness: 1
  });

  function glowSprite(color, size, opacity) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    s.scale.set(size, size, 1);
    return s;
  }

  // ══════════════════════════════════════════════════════════════
  // ANTECHAMBER — the dark space where the piggy is smashed
  // ══════════════════════════════════════════════════════════════
  {
    const R = ROOM.ante, G = new THREE.Group(); root.add(G);

    // deliberately dark, low-reflectance surfaces: this is a black box
    // with one hard light in it, not a lit room.
    const voidMat = new THREE.MeshStandardMaterial({ color: 0x111216, roughness: 0.88, metalness: 0.06, envMapIntensity: 0.10 });
    const facadeMat = new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.82, metalness: 0.14, envMapIntensity: 0.14 });
    const floorMat = M.marble.clone(); floorMat.envMapIntensity = 0.30; floorMat.color = new THREE.Color(0x585450);

    const floor = rc(PL(22, R.z1 - R.z0, floorMat));
    at(floor, 0, 0, (R.z0 + R.z1) / 2, -Math.PI / 2); G.add(floor);

    // side + rear walls, pushed out past the fog so they read as darkness
    for (const s of [-1, 1]) {
      const w = rc(PL(R.z1 - R.z0, 9, voidMat));
      at(w, s * 8.5, 4.5, (R.z0 + R.z1) / 2, 0, -s * Math.PI / 2); G.add(w);
    }
    const ceil = rc(PL(22, R.z1 - R.z0, voidMat));
    at(ceil, 0, 6.0, (R.z0 + R.z1) / 2, Math.PI / 2); G.add(ceil);

    // vault facade: big wall with a circular hole for the door
    const shape = new THREE.Shape();
    shape.moveTo(-9, -3.2); shape.lineTo(9, -3.2); shape.lineTo(9, 5.2); shape.lineTo(-9, 5.2); shape.closePath();
    const hole = new THREE.Path(); hole.absarc(0, 0, 1.255, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const fac = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), facadeMat);
    at(fac, 0, 1.40, -0.5); sc(fac); G.add(fac);

    // shallow relief pilasters so the facade is not a blank slab
    for (const x of [-3.4, -2.2, 2.2, 3.4]) {
      G.add(sc(at(B(0.22, 5.4, 0.07, voidMat), x, 2.0, -0.055)));
    }
    G.add(sc(at(B(18, 0.16, 0.10, voidMat), 0, 4.62, -0.07)));

    // rebate ring around the door
    const ring = sc(new THREE.Mesh(new THREE.TorusGeometry(1.30, 0.075, 12, 64), M.darkSteel));
    at(ring, 0, 1.40, -0.02); G.add(ring);

    // pedestal — top face lands at y = 0.890 so the piggy's feet rest on it.
    // Roughness kept high and metalness moderate: at 0.92/0.38 this cap sat
    // directly under the key spot and blew to pure white under bloom.
    const bronze = new THREE.MeshStandardMaterial({ color: 0x3c2f1c, metalness: 0.55, roughness: 0.62, envMapIntensity: 0.4 });
    const ped = sc(B(0.72, 0.85, 0.72, M.marble)); at(ped, 0, 0.425, 0.05); G.add(ped);
    const cap = sc(B(0.80, 0.04, 0.80, bronze)); at(cap, 0, 0.870, 0.05); G.add(cap);
    const base = sc(B(0.92, 0.06, 0.92, M.darkSteel)); at(base, 0, 0.030, 0.05); G.add(base);
    const plaque = sc(B(0.34, 0.10, 0.012, M.brass)); at(plaque, 0, 0.60, -0.32); G.add(plaque);
    const plaqueFace = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.088), new THREE.MeshStandardMaterial({
      map: TEX.plaqueTexture('FIRST DEPOSIT', 'SEPT · 2022'), transparent: true, roughness: 0.4, metalness: 0.7, envMapIntensity: 1.0, side: THREE.DoubleSide
    }));
    at(plaqueFace, 0, 0.60, -0.328, 0, Math.PI, 0); G.add(plaqueFace);

    // rig — one hard key from above-left, one cool rim from the right
    const key = new THREE.SpotLight(0xffe6c0, 31, 9, 0.54, 0.45, 1.6);
    key.position.set(-1.5, 3.6, -2.2); key.target.position.set(0, 1.32, 0.05);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.4; key.shadow.camera.far = 11; key.shadow.bias = -0.0012;
    G.add(key, key.target);

    const rim = new THREE.SpotLight(0x7fa6f5, 13, 9, 0.62, 0.7, 1.6);
    rim.position.set(2.6, 2.2, -2.9); rim.target.position.set(0, 1.35, 0.05);
    G.add(rim, rim.target);

    const fill = new THREE.PointLight(0xffc98a, 1.1, 7, 2);
    fill.position.set(0, 1.1, -3.4); G.add(fill);

    // Picture light over the mounted portrait, and a soft wash on the sign
    // above the door. Without these the flank panels read as two rectangles
    // floating in a black void rather than as lit signage on a wall.
    {
      const pl = new THREE.SpotLight(0xffe2b4, 9, 3.2, 0.72, 0.85, 1.5);
      pl.position.set(1.80, 2.32, -0.62);
      pl.target.position.set(1.80, 1.46, -0.06);
      G.add(pl, pl.target);
      // little brass hood so the light has a visible source
      G.add(sc(at(CY(0.035, 0.045, 0.10, M.brass, 12), 1.80, 2.30, -0.60, Math.PI / 2.6)));
      G.add(sc(at(B(0.030, 0.26, 0.030, M.brass), 1.80, 2.14, -0.34)));

      const sl = new THREE.SpotLight(0xdfe8ff, 7, 3.0, 0.80, 0.9, 1.5);
      sl.position.set(0, 3.62, -0.70);
      sl.target.position.set(0, 2.92, -0.06);
      G.add(sl, sl.target);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ROOM 1 — OFFICE  ·  Experience
  // ══════════════════════════════════════════════════════════════
  const office = new THREE.Group(); root.add(office);
  {
    const R = ROOM.office, cz = (R.z0 + R.z1) / 2, dz = R.z1 - R.z0;

    const floor = rc(PL(R.hw * 2, dz, M.oak)); at(floor, 0, 0, cz, -Math.PI / 2); office.add(floor);
    const ceil = rc(PL(R.hw * 2, dz, M.ceilW)); at(ceil, 0, R.h, cz, Math.PI / 2); office.add(ceil);

    // walls + wainscot
    for (const s of [-1, 1]) {
      const w = rc(PL(dz, R.h, M.plasterW));
      at(w, s * R.hw, R.h / 2, cz, 0, -s * Math.PI / 2); office.add(w);
      const wain = sc(B(0.05, 0.95, dz, M.walnut)); at(wain, s * (R.hw - 0.025), 0.475, cz); office.add(wain);
      const rail = sc(B(0.075, 0.05, dz, M.walnut)); at(rail, s * (R.hw - 0.02), 0.975, cz); office.add(rail);
      const base = sc(B(0.09, 0.13, dz, M.walnut)); at(base, s * (R.hw - 0.02), 0.065, cz); office.add(base);
    }
    // Back wall carries the vault opening: a circular hole aligned with
    // the facade, plus a lined throat joining the two. Without this you
    // look straight through the vault mouth into a lit office.
    {
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x9d9382, roughness: 0.94, envMapIntensity: 0.30 });
      const s = new THREE.Shape();
      s.moveTo(-R.hw, 0); s.lineTo(R.hw, 0); s.lineTo(R.hw, R.h); s.lineTo(-R.hw, R.h); s.closePath();
      const hl = new THREE.Path(); hl.absarc(0, 1.40, 1.24, 0, Math.PI * 2, true);
      s.holes.push(hl);
      const w = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false }), wallMat);
      at(w, 0, 0, R.z0 - 0.14); rc(w); office.add(w);

      const throatMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.55, metalness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.35 });
      const throat = new THREE.Mesh(new THREE.CylinderGeometry(1.243, 1.243, 0.62, 64, 1, true), throatMat);
      at(throat, 0, 1.40, 0.29, Math.PI / 2); rc(throat); office.add(throat);
    }
    wallZ(office, M.plasterW, R.z1 + 0.07, R.hw, R.h, DOORS[0]);
    jamb(office, M.walnut, R.z1 + 0.07, DOORS[0]);

    // crown + cove
    const crown = sc(B(R.hw * 2, 0.10, dz, M.ceilW)); at(crown, 0, R.h - 0.05, cz); office.add(crown);

    // ── window wall (right) with blinds: makes the light shafts ──
    const winY = 1.62, winH = 1.45, winW = 2.2, wx = R.hw - 0.02;
    const frame = sc(B(0.10, winH + 0.16, winW + 0.16, M.walnut)); at(frame, wx, winY, cz + 0.4); office.add(frame);
    const pane = PL(winW, winH, M.glass); at(pane, wx - 0.06, winY, cz + 0.4, 0, -Math.PI / 2); office.add(pane);
    const bright = new THREE.MeshBasicMaterial({ color: 0xffe0b0, fog: false });
    const sky = PL(winW - 0.02, winH - 0.02, bright); at(sky, wx + 0.06, winY, cz + 0.4, 0, -Math.PI / 2); office.add(sky);
    for (let i = 0; i < 11; i++) {
      const sl = sc(B(0.055, 0.016, winW, M.ash));
      at(sl, wx - 0.12, winY - winH / 2 + 0.07 + i * 0.135, cz + 0.4, 0, 0, 0.42);
      office.add(sl);
    }
    const mull = sc(B(0.06, winH, 0.05, M.walnut)); at(mull, wx - 0.05, winY, cz + 0.4); office.add(mull);

    // ── desk ──
    const dz0 = 4.30, deskW = 1.72, deskD = 0.78, deskT = 0.74;
    const top = sc(B(deskW, 0.045, deskD, M.walnut)); at(top, 0, deskT - 0.022, dz0); office.add(top);
    const lip = sc(B(deskW + 0.02, 0.022, 0.02, M.walnut)); at(lip, 0, deskT - 0.055, dz0 - deskD / 2 - 0.005); office.add(lip);
    for (const s of [-1, 1]) {
      const ped = sc(B(0.40, 0.66, deskD - 0.06, M.walnut));
      at(ped, s * (deskW / 2 - 0.24), 0.35, dz0); office.add(ped);
      for (let d = 0; d < 3; d++) {
        const face = sc(B(0.37, 0.185, 0.02, M.walnut));
        at(face, s * (deskW / 2 - 0.24), 0.15 + d * 0.21, dz0 - (deskD - 0.06) / 2 - 0.01); office.add(face);
        const pull = sc(CY(0.011, 0.011, 0.12, M.brass, 10));
        at(pull, s * (deskW / 2 - 0.24), 0.15 + d * 0.21, dz0 - (deskD - 0.06) / 2 - 0.03, 0, 0, Math.PI / 2);
        office.add(pull);
      }
    }
    // leather blotter, then the wedge that props the sheet at exactly 18°
    // (top face slope 0.325 => atan = 18.0°, matching CARRIER.sheet.elev)
    const deskTop = deskT - 0.022 + 0.0225;                 // = 0.7405
    const blot = sc(B(0.94, 0.010, 0.60, M.leather)); at(blot, 0, deskTop + 0.005, 4.28); office.add(blot);
    const wedgeG = new THREE.BufferGeometry();
    {
      const w = 0.255, d = 0.175, hB = 0.004, hT = 0.1178;   // (hT-hB)/(2d) = 0.325
      const v = [
        -w, hB, -d, w, hB, -d, w, hT, d, -w, hT, d,
        -w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d
      ];
      const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4,
        1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 0, 4, 5, 0, 5, 1];
      wedgeG.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      wedgeG.setIndex(idx); wedgeG.computeVertexNormals();
    }
    const wedge = sc(new THREE.Mesh(wedgeG, M.walnut)); at(wedge, 0, 0.7505, 4.26); office.add(wedge);
    // retaining lip along the low edge so the sheet reads as held
    office.add(sc(at(B(0.51, 0.012, 0.012, M.brass), 0, 0.7580, 4.088)));

    // banker's lamp
    {
      const L = new THREE.Group(); at(L, -0.455, deskTop, 4.44); office.add(L);
      L.add(sc(at(CY(0.075, 0.085, 0.022, M.brass), 0, 0.011, 0)));
      L.add(sc(at(CY(0.011, 0.011, 0.26, M.brass, 12), 0, 0.14, 0)));
      const shadeM = new THREE.MeshStandardMaterial({ color: 0x0f3a24, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide });
      const shade = sc(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.10, 0.09, 20, 1, true), shadeM));
      at(shade, 0, 0.285, 0); L.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), emis(0xffd9a0, 1.5));
      at(bulb, 0, 0.262, 0); L.add(bulb);
      const lp = new THREE.PointLight(0xffcf92, 3.4, 3.0, 2.0);
      lp.position.set(0, 0.245, 0); lp.castShadow = true;
      lp.shadow.mapSize.set(512, 512); lp.shadow.bias = -0.004;
      L.add(lp);
      L.add(at(glowSprite(0xffc98a, 0.42, 0.20), 0, 0.27, 0));
    }

    // monitor, angled away from the reader
    {
      const G2 = new THREE.Group(); at(G2, 0.63, deskTop, dz0 + 0.26, 0, -0.66); office.add(G2);
      G2.add(sc(at(B(0.22, 0.012, 0.15, M.darkSteel), 0, 0.006, 0)));
      G2.add(sc(at(B(0.035, 0.30, 0.035, M.darkSteel), 0, 0.16, 0)));
      const panel = sc(at(B(0.60, 0.36, 0.018, M.black), 0, 0.44, 0.01, -0.10));
      G2.add(panel);
      const scr = at(PL(0.575, 0.335, emis(0x1c3550, 1.1)), 0, 0.44, 0.021 + 0.036);
      scr.rotation.x = -0.10; G2.add(scr);
      const gl = new THREE.PointLight(0x5a8fd0, 1.6, 1.6, 2); gl.position.set(0, 0.44, 0.14); G2.add(gl);
    }

    // desk clutter — composed for the reading frame, not scattered
    const porcelain = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.22, metalness: 0.02, envMapIntensity: 0.9 });
    office.add(sc(at(CY(0.037, 0.032, 0.078, porcelain, 20), 0.338, deskTop + 0.040, 4.040)));
    office.add(sc(at(CY(0.036, 0.036, 0.004, new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.18 }), 20), 0.335, deskTop + 0.082, 4.045)));
    office.add(sc(at(new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0055, 8, 16), porcelain), 0.383, deskTop + 0.058, 4.045, 0, Math.PI / 2)));
    office.add(sc(at(CY(0.048, 0.048, 0.006, porcelain, 24), 0.335, deskTop + 0.003, 4.045)));
    // fountain pen across the low corner of the blotter
    office.add(sc(at(CY(0.0062, 0.0062, 0.125, M.black, 12), -0.315, deskTop + 0.012, 4.115, Math.PI / 2, 0, 0.62)));
    office.add(sc(at(CY(0.0064, 0.0052, 0.036, M.brass, 12), -0.253, deskTop + 0.012, 4.148, Math.PI / 2, 0, 0.62)));
    // a small stack of loose paper at the top edge of frame
    const looseM = M.paper.clone(); looseM.color = new THREE.Color(0xb8b1a2);
    for (let i = 0; i < 4; i++)
      office.add(sc(at(B(0.21, 0.0016, 0.297, looseM), -0.352, deskTop + 0.004 + i * 0.0018, 4.512, 0, (i - 1.5) * 0.012)));
    // reading glasses
    for (const sx of [-1, 1]) {
      office.add(sc(at(new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0022, 6, 20), M.darkSteel), 0.30 + sx * 0.028, deskTop + 0.005, 4.44, Math.PI / 2, 0, 0.3)));
    }

    // chair behind the desk
    {
      const C = new THREE.Group(); at(C, 0.08, 0, dz0 + 0.86, 0, Math.PI + 0.16); office.add(C);
      C.add(sc(at(B(0.48, 0.10, 0.46, M.leatherOx), 0, 0.46, 0)));
      C.add(sc(at(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.60, 20, 1, false, -1.35, 2.70), M.leatherOx), 0, 0.79, 0.24, -0.13)));
      C.add(sc(at(B(0.44, 0.055, 0.055, M.walnut), 0, 1.07, 0.235, -0.13)));
      C.add(sc(at(CY(0.035, 0.035, 0.36, M.darkSteel, 12), 0, 0.24, 0)));
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        C.add(sc(at(B(0.03, 0.025, 0.26, M.darkSteel), Math.sin(a) * 0.11, 0.06, Math.cos(a) * 0.11, 0, a)));
        C.add(sc(at(CY(0.028, 0.028, 0.02, M.rubber, 10), Math.sin(a) * 0.24, 0.028, Math.cos(a) * 0.24, Math.PI / 2)));
      }
    }

    // bookcase on the left wall
    {
      const S = new THREE.Group(); at(S, -R.hw + 0.17, 0, 3.0); office.add(S);
      S.add(sc(B(0.32, 2.10, 1.70, M.walnut)));
      // hollow it visually with shelves of books
      for (let i = 0; i < 4; i++) {
        const bk = sc(new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.26, 1.50), M.books.clone()));
        bk.material.map = spines.clone(); bk.material.map.repeat.set(3, 1); bk.material.map.needsUpdate = true;
        at(bk, 0.07, 0.34 + i * 0.47, 0, 0, Math.PI / 2); S.add(bk);
        S.add(sc(at(B(0.26, 0.022, 1.62, M.walnut), 0.03, 0.20 + i * 0.47, 0)));
      }
      S.position.y = 0.02;
    }

    // framed print on the back wall
    {
      const F = new THREE.Group(); at(F, -1.1, 1.68, R.z0 + 0.02); office.add(F);
      F.add(sc(B(0.62, 0.46, 0.03, M.walnut)));
      F.add(at(PL(0.54, 0.38, new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.35 })), 0, 0, 0.017));
    }

    const rug = rc(PL(2.4, 1.9, M.rug)); at(rug, 0, 0.004, 3.6, -Math.PI / 2); office.add(rug);

    // ── office lighting ──
    const sun = new THREE.DirectionalLight(0xffd7a6, 1.65);
    sun.position.set(9.5, 4.2, cz + 2.6); sun.target.position.set(-1.0, 0.7, cz);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc1 = sun.shadow.camera;
    sc1.left = -4; sc1.right = 4; sc1.top = 4; sc1.bottom = -3; sc1.near = 1; sc1.far = 18;
    sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.02;
    office.add(sun, sun.target);

    const amb = new THREE.HemisphereLight(0xc2cddf, 0x33291f, 0.40); office.add(amb);
    const bounce = new THREE.PointLight(0xffcf9c, 0.7, 6, 2); bounce.position.set(-1.2, 1.5, cz); office.add(bounce);
  }

  // ══════════════════════════════════════════════════════════════
  // ROOM 2 — TRADING FLOOR  ·  Positions
  // ══════════════════════════════════════════════════════════════
  const trading = new THREE.Group(); root.add(trading);
  {
    const R = ROOM.trading, cz = (R.z0 + R.z1) / 2, dz = R.z1 - R.z0;

    const floor = rc(PL(R.hw * 2, dz, M.carpet)); at(floor, 0, 0, cz, -Math.PI / 2); trading.add(floor);
    const ceil = rc(PL(R.hw * 2, dz, M.plasterD)); at(ceil, 0, R.h, cz, Math.PI / 2); trading.add(ceil);
    for (const s of [-1, 1]) {
      const w = rc(PL(dz, R.h, M.plasterD)); at(w, s * R.hw, R.h / 2, cz, 0, -s * Math.PI / 2); trading.add(w);
    }
    wallZ(trading, M.plasterD, R.z0 - 0.07, R.hw, R.h, DOORS[0]);
    wallZ(trading, M.plasterD, R.z1 + 0.07, R.hw, R.h, DOORS[1]);
    jamb(trading, M.darkSteel, R.z1 + 0.07, DOORS[1]);

    // ceiling service grid + slim panel lights
    for (let i = 0; i < 9; i++) {
      const z = R.z0 + 0.9 + i * 0.95;
      trading.add(rc(at(B(R.hw * 2 - 0.4, 0.10, 0.07, M.darkSteel), 0, R.h - 0.10, z)));
      if (i % 2 === 0) {
        for (const s of [-1, 1]) {
          const pnl = at(PL(1.5, 0.16, emis(0xbfd4ee, 1.9)), s * 2.3, R.h - 0.155, z, Math.PI / 2, 0, Math.PI / 2);
          trading.add(pnl);
          trading.add(at(glowSprite(0x9fc0e8, 1.5, 0.16), s * 2.3, R.h - 0.30, z));
        }
      }
    }
    // structural columns
    for (const s of [-1, 1]) for (const z of [R.z0 + 2.1, R.z1 - 2.1]) {
      trading.add(sc(at(B(0.36, R.h, 0.36, M.concrete2), s * 3.5, R.h / 2, z)));
    }

    // ── the wall board (the carrier) in a brushed bezel ──
    trading.add(sc(at(B(2.86, 1.72, 0.10, M.darkSteel), 0, 1.75, 15.90)));
    trading.add(sc(at(B(2.70, 1.56, 0.02, M.black), 0, 1.75, 15.845)));
    // dark wall panel behind it so the board reads as mounted
    const boardWall = new THREE.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.86, metalness: 0.08, envMapIntensity: 0.18 });
    trading.add(rc(at(B(7.2, 3.0, 0.05, boardWall), 0, 1.75, 15.955)));
    // bleed light around the bezel, kept BEHIND the panel plane so it
    // never blends over the hole-punch and dims the text
    trading.add(at(glowSprite(0x6d93c8, 4.2, 0.22), 0, 1.75, 15.88));

    // desk pods receding toward the camera
    const podZ = [9.1, 10.6, 12.1];
    for (let r = 0; r < podZ.length; r++) {
      for (const s of [-1, 1]) {
        const G2 = new THREE.Group(); at(G2, s * 2.55, 0, podZ[r]); trading.add(G2);
        G2.add(sc(at(B(1.85, 0.04, 0.80, M.darkSteel), 0, 0.735, 0)));
        G2.add(sc(at(B(1.75, 0.62, 0.06, M.darkSteel), 0, 0.42, 0.36)));
        for (const lx of [-0.8, 0.8]) G2.add(sc(at(B(0.06, 0.72, 0.72, M.darkSteel), lx, 0.36, 0)));
        // 4 monitors on a bar
        G2.add(sc(at(CY(0.022, 0.022, 0.40, M.darkSteel, 10), 0, 0.94, 0.20)));
        G2.add(sc(at(B(1.55, 0.035, 0.035, M.darkSteel), 0, 1.13, 0.20)));
        for (let i = 0; i < 4; i++) {
          const x = -0.60 + i * 0.40, ry = (i - 1.5) * 0.13;
          const mm = sc(at(B(0.375, 0.235, 0.014, M.black), x, 1.26, 0.205, 0, -ry));
          G2.add(mm);
          const tone = [0x123a2a, 0x3a1620, 0x102a44, 0x2a2410][(r * 4 + i) % 4];
          const s2 = at(PL(0.355, 0.215, emis(tone, 2.4)), x + Math.sin(-ry) * 0.009, 1.26, 0.205 + Math.cos(ry) * 0.009, 0, -ry);
          G2.add(s2);
        }
        const gl = new THREE.PointLight(0x64a0e0, 2.6, 3.4, 2);
        gl.position.set(0, 1.28, 0.05); G2.add(gl);
        G2.add(at(glowSprite(0x5f9ad8, 1.9, 0.20), 0, 1.24, 0.10));
        // keyboard + chair
        G2.add(sc(at(B(0.42, 0.018, 0.14, M.black), 0, 0.76, -0.14)));
        const C = new THREE.Group(); at(C, 0, 0, -0.86, 0, Math.PI); G2.add(C);
        C.add(sc(at(B(0.44, 0.08, 0.42, M.rubber), 0, 0.45, 0)));
        C.add(sc(at(B(0.42, 0.54, 0.08, M.rubber), 0, 0.74, 0.18, -0.12)));
        C.add(sc(at(CY(0.032, 0.032, 0.34, M.darkSteel, 10), 0, 0.24, 0)));
      }
    }

    // ticker rail high on the side walls
    for (const s of [-1, 1]) {
      const rail = at(B(0.05, 0.22, dz - 1.2, emis(0xd08a22, 1.5)), s * (R.hw - 0.05), 2.85, cz);
      trading.add(rail);
      trading.add(at(glowSprite(0xd8963a, 2.4, 0.13), s * (R.hw - 0.30), 2.85, cz));
    }

    // ── trading lighting ──
    const key = new THREE.SpotLight(0xcddcf2, 38, 12, 0.66, 0.72, 1.7);
    key.position.set(0, R.h - 0.25, 12.4); key.target.position.set(0, 1.6, 15.8);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.8; key.shadow.camera.far = 16; key.shadow.bias = -0.0016;
    trading.add(key, key.target);
    trading.add(new THREE.HemisphereLight(0x3c5878, 0x08090d, 0.26));
    const boardFill = new THREE.PointLight(0x9fc4f0, 2.2, 5.5, 2); boardFill.position.set(0, 2.5, 14.9); trading.add(boardFill);
  }

  // ══════════════════════════════════════════════════════════════
  // ROOM 3 — STUDY  ·  Research
  // ══════════════════════════════════════════════════════════════
  const study = new THREE.Group(); root.add(study);
  {
    const R = ROOM.study, cz = (R.z0 + R.z1) / 2, dz = R.z1 - R.z0;

    const floor = rc(PL(R.hw * 2, dz, M.oak)); at(floor, 0, 0, cz, -Math.PI / 2); study.add(floor);
    const ceil = rc(PL(R.hw * 2, dz, M.plasterG)); at(ceil, 0, R.h, cz, Math.PI / 2); study.add(ceil);
    for (const s of [-1, 1]) {
      const w = rc(PL(dz, R.h, M.plasterG)); at(w, s * R.hw, R.h / 2, cz, 0, -s * Math.PI / 2); study.add(w);
    }
    wallZ(study, M.plasterG, R.z0 - 0.07, R.hw, R.h, DOORS[1]);
    wallZ(study, M.plasterG, R.z1 + 0.07, R.hw, R.h, DOORS[2]);
    jamb(study, M.walnut, R.z1 + 0.07, DOORS[2]);

    const rug = rc(PL(2.9, 2.4, M.rug)); at(rug, 0, 0.004, 19.9, -Math.PI / 2, 0, 0.06); study.add(rug);

    // floor-to-ceiling shelves both sides
    for (const s of [-1, 1]) {
      const S = new THREE.Group(); at(S, s * (R.hw - 0.18), 0, cz + 0.2); study.add(S);
      S.add(sc(B(0.34, 2.55, 3.4, M.walnut)));
      for (let i = 0; i < 6; i++) {
        const bk = sc(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.27, 3.05), M.books.clone()));
        bk.material = M.books.clone();
        bk.material.map = spines.clone();
        bk.material.map.repeat.set(6, 1);
        bk.material.map.offset.set(i * 0.17 + (s > 0 ? 0.4 : 0), 0);
        bk.material.map.needsUpdate = true;
        at(bk, -s * 0.05, 0.36 + i * 0.40, 0, 0, Math.PI / 2); S.add(bk);
        S.add(sc(at(B(0.30, 0.024, 3.2, M.walnut), -s * 0.01, 0.21 + i * 0.40, 0)));
      }
    }

    // desk against the far end
    const dz0 = 20.34, deskT = 0.75;
    study.add(sc(at(B(1.50, 0.042, 0.70, M.walnut), 0, deskT - 0.021, dz0)));
    for (const s of [-1, 1]) study.add(sc(at(B(0.07, 0.71, 0.62, M.walnut), s * 0.68, 0.355, dz0)));
    study.add(sc(at(B(1.36, 0.05, 0.05, M.walnut), 0, 0.20, dz0 + 0.22)));

    // reading stand carrying the open book.
    // CARRIER.spread sits at (0,1.00,20.15) with elev 33.7°, so its face
    // normal is (0, sin33.7, -cos33.7) and its up axis is (0, cos33.7, sin33.7).
    // A box rotated +33.7° about X lies in exactly that plane.
    {
      const A = 33.7 * Math.PI / 180;
      const nY = Math.sin(A), nZ = -Math.cos(A);          // face normal
      const uY = Math.cos(A), uZ = Math.sin(A);           // face "up"
      const cx = 0, cy = 1.00, cz = 20.15;
      const behind = 0.085;                               // clear of the book block

      const face = sc(B(0.58, 0.40, 0.024, M.walnut));
      at(face, cx, cy - nY * behind, cz - nZ * behind, A);
      study.add(face);

      // ledge along the bottom edge of the page
      const bx = cy - uY * 0.155, bz = cz - uZ * 0.155;
      study.add(sc(at(B(0.58, 0.020, 0.055, M.walnut), 0, bx - 0.018, bz + 0.012, A)));
      study.add(sc(at(B(0.58, 0.010, 0.010, M.brass), 0, bx - 0.004, bz - 0.020, A)));

      // two rear struts down to the desk top (0.771)
      for (const s of [-1, 1])
        study.add(sc(at(B(0.030, 0.28, 0.030, M.walnut), s * 0.20, 0.845, cz + 0.145, -0.62)));
      study.add(sc(at(B(0.52, 0.022, 0.26, M.walnut), 0, 0.782, cz + 0.115)));
    }

    // brass desk lamp, warm and close
    {
      const L = new THREE.Group(); at(L, -0.50, deskT, dz0 - 0.10); study.add(L);
      L.add(sc(at(CY(0.07, 0.08, 0.02, M.brass), 0, 0.01, 0)));
      L.add(sc(at(CY(0.010, 0.010, 0.30, M.brass, 12), 0, 0.16, 0)));
      L.add(sc(at(CY(0.010, 0.010, 0.22, M.brass, 12), 0.07, 0.31, 0.04, 0.9, 0, 0.6)));
      const shadeM = new THREE.MeshStandardMaterial({ color: 0x6b4d22, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide });
      const shade = sc(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.095, 0.085, 18, 1, true), shadeM));
      at(shade, 0.16, 0.38, 0.10, 0.55); L.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), emis(0xffd49a, 1.6));
      at(bulb, 0.16, 0.365, 0.10); L.add(bulb);
      const lp = new THREE.PointLight(0xffc182, 6.5, 3.4, 2.0);
      lp.position.set(0.19, 0.34, 0.16); lp.castShadow = true;
      lp.shadow.mapSize.set(1024, 1024); lp.shadow.bias = -0.003;
      L.add(lp);
      L.add(at(glowSprite(0xffc281, 0.46, 0.24), 0.17, 0.37, 0.11));
    }

    // props: mug, stack of books, pen cup — kept close to the stand so
    // a close carrier shot doesn't blow small side items out of scale
    study.add(sc(at(CY(0.036, 0.032, 0.088, M.marble, 16), 0.33, deskT + 0.044, 20.02)));
    for (let i = 0; i < 4; i++) {
      const bkm = new THREE.MeshStandardMaterial({ color: [0x3b2f27, 0x26303c, 0x5a3428, 0x4a4232][i], roughness: 0.8 });
      study.add(sc(at(B(0.17 - i * 0.007, 0.028, 0.24 - i * 0.009, bkm), 0.36, deskT + 0.014 + i * 0.029, 20.32, 0, 0.08 * i)));
    }
    study.add(sc(at(CY(0.028, 0.028, 0.075, M.brass, 12), -0.34, deskT + 0.038, 20.00)));

    // chair
    {
      const C = new THREE.Group(); at(C, 0.02, 0, 19.62, 0, 0.1); study.add(C);
      C.add(sc(at(B(0.42, 0.06, 0.40, M.leatherOx), 0, 0.44, 0)));
      C.add(sc(at(B(0.40, 0.50, 0.06, M.walnut), 0, 0.70, -0.17, 0.12)));
      for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]])
        C.add(sc(at(B(0.035, 0.44, 0.035, M.walnut), x, 0.22, z)));
    }

    // window with night sky at the far end, left of the desk
    {
      const wx = -R.hw + 0.02, wy = 1.60, wh = 1.2, ww = 0.95;
      study.add(sc(at(B(0.09, wh + 0.14, ww + 0.14, M.walnut), wx, wy, 21.6)));
      const nite = new THREE.MeshBasicMaterial({ color: 0x24304e, fog: false });
      study.add(at(PL(ww, wh, nite), wx + 0.05, wy, 21.6, 0, Math.PI / 2));
      study.add(at(glowSprite(0x5f7db8, 1.7, 0.16), wx + 0.22, wy, 21.6));
    }

    study.add(new THREE.HemisphereLight(0x54606f, 0x1a1208, 0.30));
    const moon = new THREE.DirectionalLight(0x8fa8d8, 0.55);
    moon.position.set(-6, 3.4, 21.0); moon.target.position.set(0, 1.0, 20.2);
    study.add(moon, moon.target);
    const warm = new THREE.PointLight(0xffb877, 2.2, 5, 2); warm.position.set(-0.2, 1.9, 19.4); study.add(warm);
  }

  // ══════════════════════════════════════════════════════════════
  // ROOM 4 — ROOFTOP  ·  Contact
  // ══════════════════════════════════════════════════════════════
  const rooftop = new THREE.Group(); root.add(rooftop);
  {
    const R = ROOM.rooftop, cz = 28.5;

    // sky dome + sun
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(160, 32, 20),
      new THREE.MeshBasicMaterial({ map: TEX.skyTexture(), side: THREE.BackSide, fog: false })
    );
    sky.position.set(0, -10, 26); rooftop.add(sky);

    const sunDisc = at(glowSprite(0xffd08a, 30, 0.34), -46, 8, 118); rooftop.add(sunDisc);

    // skyline bands
    const sl1 = TEX.skylineTexture(); sl1.repeat.set(3, 1);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(300, 62),
      new THREE.MeshBasicMaterial({ map: sl1, transparent: true, fog: false, opacity: 0.65 }));
    at(far, 0, 16, 118); rooftop.add(far);
    const sl2 = TEX.skylineTexture(); sl2.repeat.set(2, 1); sl2.offset.set(0.3, 0);
    const near = new THREE.Mesh(new THREE.PlaneGeometry(190, 46),
      new THREE.MeshBasicMaterial({ map: sl2, transparent: true, fog: false }));
    at(near, 6, 8, 74); rooftop.add(near);

    // deck
    const deck = rc(PL(R.hw * 2 + 3, 15, M.deck)); at(deck, 0, 0, cz + 1.5, -Math.PI / 2); rooftop.add(deck);
    // parapet
    const pm = M.concrete2;
    for (const [x, z, w, d] of [[0, 34.2, 13, 0.28], [-6.4, 28.6, 0.28, 11.6], [6.4, 28.6, 0.28, 11.6]]) {
      rooftop.add(sc(at(B(w, 1.02, d, pm), x, 0.51, z)));
      rooftop.add(sc(at(B(w + 0.12, 0.07, d + 0.12, M.concrete), x, 1.055, z)));
    }
    // wall we came out of
    rooftop.add(sc(at(B(13, 3.0, 0.4, M.concrete2), 0, 1.5, 23.0)));
    wallZ(rooftop, M.concrete2, 23.2, 6.5, 2.9, DOORS[2]);

    // bistro table + card stand
    const tz = 26.95, tTop = 0.75;
    rooftop.add(sc(at(CY(0.44, 0.44, 0.035, M.marble, 36), 0, tTop - 0.017, tz)));
    rooftop.add(sc(at(CY(0.035, 0.035, 0.72, M.darkSteel, 14), 0, 0.37, tz)));
    rooftop.add(sc(at(CY(0.24, 0.28, 0.025, M.darkSteel, 20), 0, 0.014, tz)));
    // pen resting on the table beside the message pad
    rooftop.add(sc(at(CY(0.0055, 0.0055, 0.125, M.black, 10), 0.20, 0.7565, 26.70, Math.PI / 2, 0, 0.42)));
    rooftop.add(sc(at(CY(0.0058, 0.0042, 0.032, M.brass, 10), 0.262, 0.7565, 26.727, Math.PI / 2, 0, 0.42)));

    // brass easel holding the card near-vertical (78 deg from the deck),
    // so the camera looks along the skyline instead of down at the table.
    // CARRIER.card: centre (0,0.8673,26.95), elev 12 deg -> bottom edge
    // lands at y 0.7505 / z 26.925, exactly on the table top.
    {
      // card half-width is 0.21m; every strut sits outside that so it
      // never crosses the face, and the tray sits far enough forward
      // (+0.06) to clear the "Available" stamp near the card's bottom.
      const A = 12 * Math.PI / 180;
      const bz = 26.925, by = 0.7505;
      rooftop.add(sc(at(B(0.50, 0.012, 0.075, M.brass), 0, by - 0.002, bz + 0.060)));
      rooftop.add(sc(at(B(0.50, 0.022, 0.010, M.brass), 0, by + 0.008, bz + 0.020)));
      for (const s of [-1, 1]) {
        rooftop.add(sc(at(CY(0.007, 0.007, 0.06, M.brass, 10), s * 0.235, by + 0.030, bz + 0.052)));
        rooftop.add(sc(at(B(0.009, 0.24, 0.009, M.brass), s * 0.235, by + 0.135, bz + 0.100, -0.60)));
      }
      rooftop.add(sc(at(B(0.50, 0.009, 0.009, M.brass), 0, by + 0.245, bz + 0.148, A)));
    }

    // chairs
    for (const [x, z, ry] of [[-0.78, 27.45, 0.5], [0.80, 27.35, -0.6]]) {
      const C = new THREE.Group(); at(C, x, 0, z, 0, ry); rooftop.add(C);
      C.add(sc(at(B(0.42, 0.035, 0.42, M.darkSteel), 0, 0.44, 0)));
      C.add(sc(at(B(0.40, 0.46, 0.035, M.darkSteel), 0, 0.68, -0.19, 0.14)));
      for (const [ax, az] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]])
        C.add(sc(at(CY(0.014, 0.014, 0.44, M.darkSteel, 8), ax, 0.22, az)));
    }

    // planters — 28 foliage lumps merged into one draw call, since none
    // of them ever animate independently
    {
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2b3a24, roughness: 0.9 });
      const leafGeos = [];
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler();
      for (const [x, z] of [[-2.5, 26.0], [2.6, 26.2], [-3.4, 30.4], [3.5, 30.0]]) {
        rooftop.add(sc(at(B(0.66, 0.52, 0.66, M.concrete), x, 0.26, z)));
        for (let i = 0; i < 7; i++) {
          const g = new THREE.IcosahedronGeometry(0.14 + Math.random() * 0.10, 0);
          e4.set(Math.random(), Math.random(), Math.random());
          q4.setFromEuler(e4);
          m4.compose(
            new THREE.Vector3(x + (Math.random() - 0.5) * 0.44, 0.56 + Math.random() * 0.34, z + (Math.random() - 0.5) * 0.44),
            q4, new THREE.Vector3(1, 1, 1)
          );
          g.applyMatrix4(m4);
          leafGeos.push(g);
        }
      }
      rooftop.add(sc(new THREE.Mesh(mergeGeometries(leafGeos), foliageMat)));
    }

    // string lights on catenaries
    {
      const poleM = M.darkSteel;
      const poles = [[-4.2, 25.2], [4.2, 25.2], [-4.2, 32.4], [4.2, 32.4]];
      poles.forEach(([x, z]) => rooftop.add(sc(at(CY(0.028, 0.034, 2.6, poleM, 10), x, 1.3, z))));
      const bulbMat = emis(0xffd39a, 1.4);
      const runs = [[[-4.2, 25.2], [4.2, 25.2]], [[-4.2, 32.4], [4.2, 32.4]],
      [[-4.2, 25.2], [-4.2, 32.4]], [[4.2, 25.2], [4.2, 32.4]]];
      // 48 bulbs merged into one draw call — static once placed
      const bulbGeos = [];
      const m4b = new THREE.Matrix4();
      runs.forEach(([a, b]) => {
        const n = 11;
        for (let i = 0; i <= n; i++) {
          const t = i / n, sag = Math.sin(t * Math.PI) * 0.34;
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          const y = 2.6 - sag;
          const g = new THREE.SphereGeometry(0.028, 8, 6);
          m4b.makeTranslation(x, y, z);
          g.applyMatrix4(m4b);
          bulbGeos.push(g);
          if (i % 3 === 0) rooftop.add(at(glowSprite(0xffc98a, 0.72, 0.34), x, y, z));
        }
      });
      rooftop.add(new THREE.Mesh(mergeGeometries(bulbGeos), bulbMat));
      const warmA = new THREE.PointLight(0xffc078, 3.0, 8, 2); warmA.position.set(0, 2.35, 28.6); rooftop.add(warmA);
    }

    // ── rooftop lighting ──
    const sun = new THREE.DirectionalLight(0xffb877, 3.4);
    sun.position.set(-14, 5.0, 42); sun.target.position.set(0, 0.8, 27);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const s2 = sun.shadow.camera; s2.left = -7; s2.right = 7; s2.top = 5; s2.bottom = -2; s2.near = 20; s2.far = 62;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.02;
    rooftop.add(sun, sun.target);
    rooftop.add(new THREE.HemisphereLight(0xa9b6d8, 0x4a3a30, 0.75));
    const bounceR = new THREE.PointLight(0xff9f60, 2.0, 12, 2); bounceR.position.set(-2.4, 1.2, 29); rooftop.add(bounceR);
  }

  return { root, anim, M, glowSprite, emis };
}
