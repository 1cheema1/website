import * as THREE from 'three';
import { CSS3DObject } from '../lib/CSS3DRenderer.js';
import { CARRIER, carriersFor, FLANK, FLANK_WINDOW, PANEL_WINDOW, RESUME, SCREEN, SCREEN_WINDOW } from './config.js';
import { buildScreenElements } from './screens.js';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function crossfade4(p, [a, b, c, d]) {
  if (p <= a || p >= d) return 0;
  if (p < b) return clamp01((p - a) / (b - a));
  if (p < c) return 1;
  return 1 - clamp01((p - c) / (d - c));
}

// Is this world position actually in front of the camera?
//
// This guard exists because of a real, nasty bug. CSS3DRenderer does NOT cull
// objects behind the camera — it just applies a matrix3d. An element behind the
// near plane gets a degenerate projection and can blow up to cover the entire
// CSS3D layer. Since the flank photo/sign have a near-black background, a stray
// one would render as a giant black sheet; any OTHER panel's hole-punch then
// showed that black instead of its own HTML — a black panel quad with its paper
// backing still visible around the edge. Gating on p-windows alone was not
// enough (windows overlapped), so every panel is checked geometrically too.
const _fwd = new THREE.Vector3();
const _rel = new THREE.Vector3();
function inFrontOf(camera, pos) {
  camera.getWorldDirection(_fwd);
  _rel.copy(pos).sub(camera.position);
  return _rel.dot(_fwd) > 0.15;   // metres in front of the camera
}

// A "hole punch" plane: writes RGBA(0,0,0,0) with NoBlending so the
// WebGL canvas becomes transparent exactly where the CSS panel sits.
//
// Holes live in their own scene, rendered as a SEPARATE pass directly to
// the canvas after composer.render() — EffectComposer's intermediate
// render targets don't reliably carry alpha through a bloom pass, so a
// hole punched during the main scene pass gets silently opacified back
// to black by the time bloom composites it. A second raw render, after
// the composite, punches through regardless of what bloom did. That
// means these can't depth-test against the real scene (that depth
// buffer no longer means anything post-composite) — depthTest is off,
// so the panel always wins. Fine here: every panel is the intended
// unoccluded subject of its shot, never something meant to be hidden.
function holeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    opacity: 0,
    blending: THREE.NoBlending,
    side: THREE.FrontSide,
    depthTest: false,
    depthWrite: false
  });
}

export function buildPanels(scene, cssScene, M, stops, market) {
  // Portrait screens get portrait panels. Resolved once — the paper props below
  // are built from these dimensions, so it must not change under them.
  // ONE decision, made here, published to CSS as a class. The previous version
  // asked JS for the aspect and CSS for `max-aspect-ratio: 1/1` separately —
  // and on an in-app mobile browser those two disagree, because the media
  // feature uses the layout viewport while innerWidth/innerHeight report the
  // visual one. The result was the worst possible combination: the portrait
  // SCALE applied to a still-landscape element, so the panel rendered half as
  // wide again as its own hole punch and hung off it.
  const CARR = carriersFor(innerWidth / innerHeight);
  const portrait = CARR !== CARRIER;
  document.body.classList.toggle('portrait', portrait);

  // ── portrait reads the panels FLAT ────────────────────────────
  // On a phone the panels stop being projected into the scene and become plain
  // fixed-position cards over it. This is a retreat, and a deliberate one: the
  // CSS3D projection has been placing the panel beside its own hole-punch on
  // real devices, I could not reproduce it (headless Chrome refuses to render
  // below 500px wide), and three attempts to fix it by reasoning from
  // screenshots were all wrong. A flat card cannot have that failure mode —
  // there is no second renderer to disagree with.
  //
  // It is also just better here. A 3D-projected panel on a 393px screen was
  // never going to beat a readable card, and the room still renders behind it
  // with the paper prop on the desk where the panel would have been.
  const FLAT = portrait;
  const items = {};
  const holeScene = new THREE.Scene();

  for (const key of Object.keys(CARR)) {
    const c = CARR[key];
    const el = document.getElementById(key);   // element ids match carrier keys

    if (FLAT) {
      // No CSS3DObject, no hole. The element keeps its own layout and is
      // positioned by CSS; update() just toggles a class.
      //
      // It must also LEAVE #panelsrc. That holder is position:fixed, and WebKit
      // creates a stacking context for fixed elements while Chrome does not —
      // so on iOS every card's z-index was scoped inside a container that
      // itself paints below the opaque canvas, and the panel rendered behind
      // the scene. Correct box, correct z-index, correct everything, invisible.
      // Moving it to <body> puts it back in the root stacking context, where
      // z-index:6 means what it says.
      document.body.appendChild(el);
      el.classList.add('flat');
      items[key] = { el, flat: true, c, obj: null, hole: null };
      continue;
    }

    const scale = c.w / c.el[0];

    // The element's box is set from the carrier rather than left to CSS, so the
    // HTML and the hole punch cannot disagree about how big the panel is.
    el.style.width = c.el[0] + 'px';
    el.style.height = c.el[1] + 'px';

    const obj = new CSS3DObject(el);
    obj.position.fromArray(c.pos);
    obj.scale.set(scale, scale, scale);
    cssScene.add(obj);

    const hole = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), holeMaterial());
    hole.position.fromArray(c.pos);
    hole.frustumCulled = true;
    holeScene.add(hole);

    items[key] = { obj, hole, c };
  }

  // ── the résumé, on the second rooftop desk ───────────────────────
  // Not in CARRIER because it is not on the p-track: it is shown only while
  // the camera is parked at the résumé desk, which main.js drives directly.
  const resume = (() => {
    const c = RESUME;
    const el = document.getElementById('resume');
    const obj = new CSS3DObject(el);
    obj.position.fromArray(c.pos);
    const scale = c.w / c.el[0];
    obj.scale.set(scale, scale, scale);
    obj.visible = false;
    cssScene.add(obj);

    const hole = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), holeMaterial());
    hole.position.fromArray(c.pos);
    hole.visible = false;
    holeScene.add(hole);

    return { obj, hole, c };
  })();

  // ── flanking photo + sign at the vault-open reveal ────────────────
  const flank = {};
  for (const key of Object.keys(FLANK)) {
    const c = FLANK[key];
    const el = document.getElementById('flank-' + key);
    const scale = c.w / c.el[0];
    const obj = new CSS3DObject(el);
    obj.position.fromArray(c.pos);
    obj.scale.set(scale, scale, scale);
    cssScene.add(obj);

    const hole = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), holeMaterial());
    hole.position.fromArray(c.pos);
    hole.frustumCulled = true;
    holeScene.add(hole);

    flank[key] = { obj, hole, c };
  }

  // ── trading wall screens ─────────────────────────────────────────
  // Same hole-punch treatment as the board, for the same reason: these have
  // to stay legible, and anything drawn into the WebGL canvas is resampled
  // by the DPR cap before it reaches a retina display.
  const screens = {};
  {
    const els = buildScreenElements(market);
    for (const key of Object.keys(SCREEN)) {
      const c = SCREEN[key];
      const el = els[key];
      if (!el) continue;
      el.style.width = c.el[0] + 'px';
      el.style.height = c.el[1] + 'px';

      const obj = new CSS3DObject(el);
      obj.position.fromArray(c.pos);
      const scale = c.w / c.el[0];
      obj.scale.set(scale, scale, scale);
      cssScene.add(obj);

      const hole = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), holeMaterial());
      hole.position.fromArray(c.pos);
      hole.frustumCulled = true;
      holeScene.add(hole);

      screens[key] = { obj, hole, c };
    }
  }

  // ── physical stock behind each panel ────────────────────────────
  const backs = [];

  // 1 · office tear sheet — real paper with a shadow underneath
  {
    const c = CARR.sheet;
    const g = new THREE.Group();
    const paper = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.008, c.h + 0.008, 0.0012), M.paper);
    paper.position.z = -0.0012; paper.castShadow = true; paper.receiveShadow = true;
    g.add(paper);
    // a second sheet peeking out behind, slightly rotated
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.004, c.h + 0.004, 0.0010), M.paper);
    p2.position.set(0.010, -0.008, -0.0030); p2.rotation.z = 0.018;
    p2.castShadow = true; p2.receiveShadow = true; g.add(p2);
    g.position.fromArray(c.pos);
    scene.add(g); backs.push({ g, key: 'sheet' });
  }

  // 3 · study book — page block, boards and a ribbon
  {
    const c = CARR.spread;
    const g = new THREE.Group();
    const pages = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.006, c.h + 0.006, 0.030), M.paper);
    pages.position.z = -0.016; pages.castShadow = true; pages.receiveShadow = true; g.add(pages);
    const boardM = M.leatherOx;
    for (const s of [-1, 1]) {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(c.w / 2 + 0.014, c.h + 0.016, 0.006), boardM);
      cover.position.set(s * (c.w / 4 + 0.006), 0, -0.034);
      cover.castShadow = true; cover.receiveShadow = true; g.add(cover);
    }
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, c.h + 0.016, 14, 1, false, 0, Math.PI), boardM);
    spine.rotation.set(0, 0, 0); spine.position.set(0, 0, -0.034);
    spine.rotation.x = Math.PI / 2; spine.rotation.z = Math.PI / 2;
    g.add(spine);
    // Short — this group tilts with the book, and a long ribbon hanging
    // past the bottom edge rotates toward the camera's near plane and
    // blows up to fill the frame. Keep it inside the book's own silhouette.
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.045, 0.0008),
      new THREE.MeshStandardMaterial({ color: 0x8c2b2b, roughness: 0.7 }));
    ribbon.position.set(0.09, -c.h / 2 - 0.008, 0.001); g.add(ribbon);
    g.position.fromArray(c.pos);
    scene.add(g); backs.push({ g, key: 'spread' });
  }

  // 4 · rooftop card — thick cotton stock with a bevelled gold edge
  {
    const c = CARR.card;
    const g = new THREE.Group();
    const stock = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.010, c.h + 0.010, 0.0035), M.paper);
    stock.position.z = -0.002; stock.castShadow = true; stock.receiveShadow = true; g.add(stock);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.013, c.h + 0.013, 0.0015), M.gold);
    edge.position.z = -0.0032; edge.castShadow = true; g.add(edge);
    g.position.fromArray(c.pos);
    scene.add(g); backs.push({ g, key: 'card' });
  }

  // 4b · message pad — a real pad of paper with a pen resting on it
  {
    const c = CARR.note;
    const g = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.012, c.h + 0.014, 0.012), M.paper);
    pad.position.z = -0.007; pad.castShadow = true; pad.receiveShadow = true; g.add(pad);
    const backing = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.020, c.h + 0.022, 0.006), M.leatherOx);
    backing.position.z = -0.015; backing.castShadow = true; g.add(backing);
    g.position.fromArray(c.pos);
    scene.add(g); backs.push({ g, key: 'note' });
  }

  // 4c · the résumé sheet — a printed page with a second one under it
  {
    const c = RESUME;
    const g = new THREE.Group();
    const page = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.010, c.h + 0.010, 0.0016), M.paper);
    page.position.z = -0.0014; page.castShadow = true; page.receiveShadow = true; g.add(page);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.006, c.h + 0.006, 0.0012), M.paper);
    p2.position.set(-0.009, -0.007, -0.0032); p2.rotation.z = -0.014;
    p2.castShadow = true; p2.receiveShadow = true; g.add(p2);
    g.position.fromArray(c.pos);
    scene.add(g); backs.push({ g, key: 'resume' });
  }

  // stand-off block behind the sign
  {
    const c = FLANK.sign;
    const back = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.03, c.h + 0.03, 0.016), M.darkSteel);
    back.position.set(c.pos[0], c.pos[1], c.pos[2] - 0.009);
    back.castShadow = true; back.receiveShadow = true;
    scene.add(back); backs.push({ g: back, key: 'sign' });
  }

  // ── orient everything to face its camera stop ────────────────────
  function orient() {
    for (const key of Object.keys(items)) {
      const { obj, hole } = items[key];
      if (!obj || !hole) continue;               // flat panels are not projected
      const s = stops[key];
      if (!s) continue;
      obj.lookAt(s.pos);
      hole.quaternion.copy(obj.quaternion);
      // nudge the punch plane a hair toward the camera so it always
      // wins the depth test against its own paper backing
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
      hole.position.fromArray(items[key].c.pos).addScaledVector(n, 0.0006);
    }
    if (stops.resume) {
      resume.obj.lookAt(stops.resume.pos);
      resume.hole.quaternion.copy(resume.obj.quaternion);
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(resume.obj.quaternion);
      resume.hole.position.fromArray(resume.c.pos).addScaledVector(n, 0.0006);
    }
    // flank panels face the fixed 'wide' camera stop — computed once,
    // not per room, since they never move.
    const wide = stops.wide;
    if (wide) {
      for (const key of Object.keys(flank)) {
        const { obj, hole } = flank[key];
        obj.lookAt(wide.pos);
        hole.quaternion.copy(obj.quaternion);
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
        hole.position.fromArray(flank[key].c.pos).addScaledVector(n, 0.0006);
      }
    }
    // The wall screens sit FLAT in the wall plane — no lookAt. Toeing them in
    // toward the reading stop turned each panel into a trapezoid inside its
    // own axis-aligned bezel, and the mismatch was obvious: housing showing
    // along one edge and none along the other.
    //
    // PI about Y, not identity: this camera looks toward +Z, so an unrotated
    // element has its local +X running to SCREEN-LEFT and every label reads
    // mirrored. The textured planes these replaced did the same thing with
    // gm.rotateY(Math.PI).
    for (const key of Object.keys(screens)) {
      const { obj, hole } = screens[key];
      obj.rotation.set(0, Math.PI, 0);
      hole.rotation.set(0, Math.PI, 0);
      // pull the punch a hair toward the camera so it beats its own bezel
      hole.position.fromArray(screens[key].c.pos);
      hole.position.z -= 0.0006;
    }
    for (const b of backs) {
      const src = items[b.key] || flank[b.key] || (b.key === 'resume' ? resume : null);
      if (src && !src.obj) continue;   // flat: the paper prop keeps its built orientation
      if (src) b.g.quaternion.copy(src.obj.quaternion);
    }
  }

  // visibility gating uses PANEL_WINDOW from config.js
  //
  // `resumeOn` is the résumé-desk excursion. While it is up, every p-track
  // panel is forced off regardless of where p happens to be parked: the
  // camera has left the timeline, so a window that still contains p would
  // otherwise leave the contact card hanging in mid-air behind us.
  let resumeOn = 0;
  function setResume(v) { resumeOn = v; }

  function update(p, camera) {
    if (FLAT) {
      for (const key of Object.keys(items)) {
        const [a, b] = PANEL_WINDOW[key];
        items[key].el.classList.toggle('show', p >= a && p <= b);
      }
      // the résumé desk is still a 3D excursion; its panel stays projected
      resume.obj.visible = resumeOn > 0;
      resume.hole.visible = resumeOn > 0;
      resume.obj.element.style.opacity = resumeOn > 0 ? String(resumeOn) : '0';
      for (const k of Object.keys(screens)) {
        const on = false; screens[k].obj.visible = on; screens[k].hole.visible = on;
      }
      for (const k of Object.keys(flank)) { flank[k].obj.visible = false; flank[k].hole.visible = false; }
      return;
    }
    resume.obj.visible = resumeOn > 0;
    resume.hole.visible = resumeOn > 0;
    resume.obj.element.style.opacity = resumeOn > 0 ? String(resumeOn) : '0';
    if (resumeOn >= 1) {
      for (const k of Object.keys(items)) { items[k].obj.visible = false; items[k].hole.visible = false; items[k].obj.element.style.opacity = '0'; }
      for (const k of Object.keys(flank)) { flank[k].obj.visible = false; flank[k].hole.visible = false; }
      for (const k of Object.keys(screens)) { screens[k].obj.visible = false; screens[k].hole.visible = false; }
      return;
    }
    for (const key of Object.keys(items)) {
      const [a, b] = PANEL_WINDOW[key];
      const on = p >= a && p <= b && inFrontOf(camera, items[key].obj.position);
      items[key].obj.visible = on;
      items[key].hole.visible = on;
      items[key].obj.element.style.opacity = on ? '1' : '0';
    }
    const fo = crossfade4(p, FLANK_WINDOW);
    for (const key of Object.keys(flank)) {
      const on = fo > 0 && inFrontOf(camera, flank[key].obj.position);
      flank[key].obj.visible = on;
      flank[key].hole.visible = on;
      flank[key].obj.element.style.opacity = on ? String(fo) : '0';
    }
    // The wall screens fade rather than snap — they cover a lot of the frame
    // and popping nine of them on at once reads as a glitch. The last 8% of
    // the window at each end is the ramp.
    const [sa, sb] = SCREEN_WINDOW;
    const ramp = (sb - sa) * 0.12;
    const so = crossfade4(p, [sa, sa + ramp, sb - ramp, sb]);
    for (const key of Object.keys(screens)) {
      const on = so > 0 && inFrontOf(camera, screens[key].obj.position);
      screens[key].obj.visible = on;
      screens[key].hole.visible = on;
      screens[key].obj.element.style.opacity = on ? String(so) : '0';
    }
  }

  return { items, flank, screens, resume, holeScene, orient, update, setResume, flat: FLAT };
}
