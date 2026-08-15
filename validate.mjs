// Numeric guard rails. Run: node t3/validate.mjs
import * as C from './js/config.js';

const D = Math.PI / 180;
let problems = 0;
const bad = (m) => { console.log('  ✗ ' + m); problems++; };
const ok = (m) => console.log('  ✓ ' + m);

// ── Three's CatmullRomCurve3, curveType 'catmullrom', tension 0.5 ──
function poly(x0, x1, t0, t1) {
  return [x0, t0, -3 * x0 + 3 * x1 - 2 * t0 - t1, 2 * x0 - 2 * x1 + t0 + t1];
}
function calc(c, t) { return c[0] + c[1] * t + c[2] * t * t + c[3] * t * t * t; }
function crPoint(pts, t, tension = 0.5) {
  const l = pts.length;
  const p = (l - 1) * t;
  let ip = Math.floor(p), w = p - ip;
  if (w === 0 && ip === l - 1) { ip = l - 2; w = 1; }
  const g = (i) => pts[i];
  let p0;
  if (ip > 0) p0 = g(ip - 1);
  else p0 = g(0).map((v, k) => v - (g(1)[k] - g(0)[k]));
  const p1 = g(ip), p2 = g(ip + 1);
  let p3;
  if (ip + 2 < l) p3 = g(ip + 2);
  else p3 = g(l - 1).map((v, k) => v + (g(l - 1)[k] - g(l - 2)[k]));
  const out = [];
  for (let k = 0; k < 3; k++) {
    const c = poly(p1[k], p2[k], tension * (p2[k] - p0[k]), tension * (p3[k] - p1[k]));
    out.push(calc(c, w));
  }
  return out;
}

// ── derive stops exactly the way main.js does ──
function stopsFor(aspect) {
  const s = {};
  for (const [k, v] of Object.entries(C.FIXED_STOP)) s[k] = { pos: v.pos, tgt: v.tgt };
  for (const key of Object.keys(C.CARRIER)) {
    const c = C.CARRIER[key];
    const d = C.fitDistance(c, aspect);
    const dir = [0, Math.sin(c.elev), -Math.cos(c.elev)];
    s[key] = { pos: [c.pos[0] + dir[0] * d, c.pos[1] + dir[1] * d, c.pos[2] + dir[2] * d], tgt: c.pos, d };
    s[c.room] = s[key];
  }
  return s;
}

// ── where is a point legally allowed to be? ──
function inside(pt) {
  const [x, y, z] = pt;
  if (z >= -13 && z <= 0.62 && Math.abs(x) <= 4.0 && y >= 0.30 && y <= 5.0) return 'ante';
  if (Math.abs(x) <= 1.05 && y >= 0.40 && y <= 2.45 && z >= -0.65 && z <= 0.95) return 'portal';
  for (const [name, r] of Object.entries(C.ROOM)) {
    if (name === 'ante' || name === 'rooftop') continue;
    if (Math.abs(x) <= r.hw - 0.10 && y >= 0.25 && y <= r.h - 0.10 &&
      z >= r.z0 + 0.08 && z <= r.z1 - 0.08) return name;
  }
  const rt = C.ROOM.rooftop;
  if (z >= 23.30 && z <= 40 && Math.abs(x) <= rt.hw && y >= 0.30 && y <= 4.0) return 'rooftop';
  for (const d of C.DOORS) {
    if (Math.abs(x) <= d.w / 2 - 0.06 && y >= 0.25 && y <= d.h - 0.08 &&
      Math.abs(z - d.z) <= 0.55) return 'door@' + d.z;
  }
  return null;
}

const ASPECTS = [[2.40, '21:9'], [1.7778, '16:9'], [1.60, '16:10'], [1.3333, '4:3']];

console.log('\n── 1. carrier framing ──');
for (const [a, label] of ASPECTS) {
  const t = Math.tan((C.FOV * D) / 2);
  for (const key of Object.keys(C.CARRIER)) {
    const c = C.CARRIER[key];
    const d = C.fitDistance(c, a);
    const fh = c.h / (2 * t * d);
    const fw = c.w / (2 * t * d * a);
    const px = Math.round(fw * (a >= 1 ? 1440 : 1440));
    if (fh > 0.95 || fw > 0.95) bad(`${label} ${key}: overflows (h ${(fh * 100).toFixed(0)}% w ${(fw * 100).toFixed(0)}%)`);
    else if (fh < 0.45 && fw < 0.45) bad(`${label} ${key}: too small (h ${(fh * 100).toFixed(0)}% w ${(fw * 100).toFixed(0)}%)`);
    else if (a === 1.7778) ok(`${label} ${key.padEnd(6)} d=${d.toFixed(3)}m  h ${(fh * 100).toFixed(0)}%  w ${(fw * 100).toFixed(0)}%  (${px}px wide)`);
  }
}

console.log('\n── 2. camera stops are inside a room ──');
for (const [a, label] of ASPECTS) {
  const S = stopsFor(a);
  for (const name of [...Object.keys(C.FIXED_STOP), 'office', 'trading', 'study', 'rooftop', 'note']) {
    const where = inside(S[name].pos);
    if (!where) bad(`${label} stop "${name}" at [${S[name].pos.map(v => v.toFixed(2))}] is outside every room`);
    else if (a === 1.7778) ok(`${name.padEnd(8)} [${S[name].pos.map(v => v.toFixed(3)).join(', ')}]  in ${where}`);
  }
}

console.log('\n── 3. flight paths stay inside the building ──');
{
  const S = stopsFor(1.7778);
  C.TIMELINE.forEach((seg) => {
    if (seg.t !== 'move') return;
    const pts = [S[seg.from].pos, ...(seg.via || []), S[seg.to].pos];
    let worst = null;
    for (let i = 0; i <= 60; i++) {
      const pt = crPoint(pts, i / 60);
      if (!inside(pt)) { worst = { t: i / 60, pt }; break; }
    }
    if (worst) bad(`move ${seg.from}→${seg.to}: leaves the building at t=${worst.t.toFixed(2)} [${worst.pt.map(v => v.toFixed(2))}]`);
    else ok(`move ${seg.from}→${seg.to} clean over 61 samples`);
  });
}

console.log('\n── 3b. trading wall screens ──');
{
  const S = stopsFor(1.7778);
  const R = C.ROOM.trading;
  const DOOR_IN = 7.20;            // office → trading doorway

  // where is the camera at an arbitrary p? mirrors main.js: smoothstep the
  // segment parameter, then evaluate the same Catmull-Rom through the vias
  const sstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
  function camAt(p) {
    for (const seg of C.TIMELINE) {
      if (p < seg.p0 || p > seg.p1) continue;
      if (seg.t === 'hold') return S[seg.stop].pos;
      const pts = [S[seg.from].pos, ...(seg.via || []), S[seg.to].pos];
      return crPoint(pts, sstep((p - seg.p0) / (seg.p1 - seg.p0)));
    }
    return S.note.pos;
  }

  const [sa, sb] = C.SCREEN_WINDOW;

  // 1 · every screen is physically on the trading room's back wall
  for (const [key, s] of Object.entries(C.SCREEN)) {
    const [x, y, z] = s.pos;
    const derived = s.w * s.el[1] / s.el[0];
    if (Math.abs(derived - s.h) > 1e-9) { bad(`SCREEN.${key} h ${s.h} != w*aspect ${derived}`); continue; }
    if (Math.abs(s.w / s.el[0] - 0.001) > 1e-9) { bad(`SCREEN.${key} scale ${(s.w / s.el[0]).toFixed(5)} — the wall is authored at 1px = 1mm`); continue; }
    if (Math.abs(x) + s.w / 2 > R.hw) { bad(`SCREEN.${key} x span exceeds the trading room half-width ${R.hw}`); continue; }
    if (y - s.h / 2 < 0 || y + s.h / 2 > R.h) { bad(`SCREEN.${key} y span [${(y - s.h / 2).toFixed(2)},${(y + s.h / 2).toFixed(2)}] escapes the room height ${R.h}`); continue; }
    if (z <= DOOR_IN || z > R.z1) { bad(`SCREEN.${key} z ${z} is not on the trading back wall (${DOOR_IN}..${R.z1})`); continue; }
    ok(`SCREEN.${key} ${s.w}x${s.h.toFixed(2)}m at [${x},${y},${z}] — on the wall, 1px=1mm`);
  }

  // 2 · the window must not light a screen while a wall is still in the way.
  // Hole punches do not depth-test, so a screen lit from the office would
  // punch a rectangle straight through the dividing wall.
  const zOpen = camAt(sa)[2], zClose = camAt(sb)[2];
  if (zOpen <= DOOR_IN) bad(`SCREEN_WINDOW opens at ${sa} with the camera at z=${zOpen.toFixed(2)}, still short of the doorway at ${DOOR_IN}`);
  else ok(`SCREEN_WINDOW opens at ${sa} with the camera at z=${zOpen.toFixed(2)}, past the doorway (${DOOR_IN})`);

  // 3 · and must be shut before the study panel claims the frame
  const spreadOpen = C.PANEL_WINDOW.spread[0];
  if (sb >= spreadOpen) bad(`SCREEN_WINDOW closes at ${sb}, not before the study spread opens at ${spreadOpen}`);
  else ok(`SCREEN_WINDOW closes ${sb} before the study spread opens ${spreadOpen} (camera z=${zClose.toFixed(2)})`);

  // 4 · every screen is actually in front of the camera across the window,
  // which is the geometric half of the guard panels.js applies at runtime
  {
    let worst = null;
    for (let i = 0; i <= 40 && !worst; i++) {
      const p = sa + (sb - sa) * (i / 40);
      const cp = camAt(p);
      for (const [key, s] of Object.entries(C.SCREEN)) {
        // camera looks toward +z here, so "in front" is simply greater z
        if (s.pos[2] - cp[2] < 0.15) { worst = { key, p, z: cp[2] }; break; }
      }
    }
    if (worst) bad(`SCREEN.${worst.key} is behind/at the camera at p=${worst.p.toFixed(3)} (cam z=${worst.z.toFixed(2)})`);
    else ok(`all ${Object.keys(C.SCREEN).length} screens stay in front of the camera across [${sa},${sb}]`);
  }

  // 5 · and each one is FULLY inside the frame at the reading stop. This is
  // the check that was missing: it only tested 16:9, and 16:10 is narrower,
  // so the flanking stacks ran off the side of every laptop. 4:3 is excluded
  // deliberately — a 2.6m board leaves no room beside it at that aspect, and
  // the side stacks are peripheral dressing there by design.
  {
    const t = Math.tan((C.FOV * Math.PI / 180) / 2);
    const cam = S.board.pos;
    for (const [aspect, label] of [[2.40, '21:9'], [1.7778, '16:9'], [1.60, '16:10']]) {
      const off = [];
      for (const [key, s] of Object.entries(C.SCREEN)) {
        const d = s.pos[2] - cam[2];
        const halfH = d * t, halfW = halfH * aspect;
        if (Math.abs(s.pos[0] - cam[0]) + s.w / 2 > halfW ||
          Math.abs(s.pos[1] - cam[1]) + s.h / 2 > halfH) off.push(key);
      }
      if (off.length) bad(`screens clipped by the frame at ${label}: ${off.join(', ')}`);
      else ok(`all screens fully inside the frame at ${label}`);
    }
  }

  // 6 · the bezels in world.js have to stay aligned with these, or the DOM
  // floats in front of a housing that is no longer behind it
  {
    const flank = Object.values(C.SCREEN).filter(s => s.w === 0.38);
    const con = Object.values(C.SCREEN).filter(s => s.w === 0.68);
    const xs = [...new Set(flank.map(s => Math.abs(s.pos[0])))];
    const ys = [...new Set(con.map(s => s.pos[1]))];
    if (xs.length !== 1 || Math.abs(xs[0] - 1.55) > 1e-9) bad(`flank screens are at x=±${xs} — world.js addBezel is hard-coded to ±1.55`);
    else if (ys.length !== 1 || Math.abs(ys[0] - 0.96) > 1e-9) bad(`console screens are at y=${ys} — world.js addBezel is hard-coded to 0.955`);
    else ok(`bezel anchors agree with world.js (flank x=±1.55, console y=0.96)`);
  }
}

console.log('\n── 3c. chapter labels flip on room arrival ──');
{
  // each chapter after the first should land exactly where the camera reaches
  // that room's reveal framing, so the header never names the room behind you
  const arrivals = [['officeWide', '01'], ['tradingWide', '02'], ['studyWide', '03'], ['rooftopWide', '04']];
  arrivals.forEach(([stop, tag], i) => {
    const seg = C.TIMELINE.find(s => s.t === 'move' && s.to === stop);
    const ch = C.CHAPTERS[i + 1];
    if (!seg) { bad(`no timeline segment arrives at ${stop}`); return; }
    if (!ch || !ch.name.startsWith(tag)) { bad(`CHAPTERS[${i + 1}] is not the ${tag} entry`); return; }
    if (Math.abs(ch.p - seg.p1) > 1e-9) bad(`chapter "${ch.name}" flips at ${ch.p} but the camera reaches ${stop} at ${seg.p1}`);
    else ok(`"${ch.name}" flips at ${ch.p} — exactly on arrival at ${stop}`);
  });
}

console.log('\n── 4. timeline / stations agree ──');
{
  let last = 0;
  for (const seg of C.TIMELINE) {
    if (Math.abs(seg.p0 - last) > 1e-9) bad(`timeline gap: expected p0=${last}, got ${seg.p0}`);
    if (seg.p1 <= seg.p0) bad(`timeline segment not increasing at ${seg.p0}`);
    last = seg.p1;
  }
  const tEnd = C.TIMELINE[C.TIMELINE.length - 1].p1;
  if (tEnd < 1) bad(`timeline ends at ${tEnd}, before p=1`); else ok(`timeline continuous 0 → ${tEnd}`);

  // every station must be a place the camera actually comes to rest, i.e. it
  // must sit exactly on a timeline segment boundary — otherwise a hop lands
  // mid-transit and nothing is framed
  const bounds = new Set([0, ...C.TIMELINE.map(t => t.p1)]);
  for (const st of C.STATIONS) {
    const hit = [...bounds].some(b => Math.abs(b - st) < 1e-9);
    if (!hit) bad(`STATION ${st} is not on a TIMELINE boundary — a hop there stops mid-move`);
  }
  let inc = true;
  for (let i = 1; i < C.STATIONS.length; i++) if (C.STATIONS[i] <= C.STATIONS[i - 1]) inc = false;
  if (!inc) bad('STATIONS are not strictly increasing');
  else ok(`${C.STATIONS.length} stations, all on timeline boundaries`);

  if (C.STATIONS[0] <= C.INTRO_END) bad(`first station (${C.STATIONS[0]}) is not past INTRO_END (${C.INTRO_END}) — the first input would have nothing to travel to`);
  else ok(`first station ${C.STATIONS[0]} sits past INTRO_END ${C.INTRO_END} (first input opens the door)`);
}

console.log('\n── 5. carriers rest on their surface ──');
{
  // supporting surface heights, taken from world.js
  const SUPPORT = {
    sheet: { surfAt: (lz) => 0.7505 + 0.004 + (lz + 0.175) * 0.325, half: 0.175, label: 'walnut wedge on the desk' },
    spread: { surfAt: () => null, label: 'reading stand' },
    card: { surfAt: () => 0.7505, label: 'bistro table top' }
  };
  for (const key of Object.keys(C.CARRIER)) {
    const c = C.CARRIER[key];
    const uY = Math.cos(c.elev), uZ = Math.sin(c.elev);   // carrier "up" axis
    const botY = c.pos[1] - uY * c.h / 2;
    const botZ = c.pos[2] - uZ * c.h / 2;
    const topY = c.pos[1] + uY * c.h / 2;
    if (key === 'sheet') {
      const s = SUPPORT.sheet.surfAt(botZ - c.pos[2]);
      const gap = botY - s;
      if (gap < 0) bad(`sheet sinks ${(-gap * 1000).toFixed(1)}mm into the ${SUPPORT.sheet.label}`);
      else if (gap > 0.010) bad(`sheet floats ${(gap * 1000).toFixed(1)}mm above the ${SUPPORT.sheet.label}`);
      else ok(`sheet rests ${(gap * 1000).toFixed(1)}mm above the wedge face`);
    }
    if (key === 'card') {
      const gap = botY - 0.7505;
      if (gap < -0.004) bad(`card sinks ${(-gap * 1000).toFixed(1)}mm into the table`);
      else if (gap > 0.030) bad(`card floats ${(gap * 1000).toFixed(1)}mm above the table`);
      else ok(`card bottom edge at y=${botY.toFixed(4)} (table 0.7505)`);
    }
    if (key === 'spread') {
      if (botY < 0.771) bad(`book spread bottom (${botY.toFixed(3)}) is below the study desk top (0.771)`);
      else ok(`book spread spans y ${botY.toFixed(3)} → ${topY.toFixed(3)} above desk 0.771`);
    }
    if (key === 'board') {
      const r = C.ROOM.trading;
      if (topY > r.h - 0.15) bad(`board top (${topY.toFixed(2)}) too close to the ${r.h}m ceiling`);
      else if (botY < 0.35) bad(`board bottom (${botY.toFixed(2)}) too close to the floor`);
      else ok(`board spans y ${botY.toFixed(2)} → ${topY.toFixed(2)} in a ${r.h}m room`);
    }
  }
}

console.log('\n── 6. intro beats are ordered ──');
{
  const b = C.BEAT;
  const order = [
    ['windup', b.windup], ['strike', b.strike], ['burst', b.burst],
    ['fall', b.fall], ['gather', b.gather], ['forge', b.forge],
    ['dial', b.dial], ['bolts', b.bolts], ['swing', b.swing]
  ];
  for (const [n, r] of order) if (r[1] <= r[0]) bad(`beat ${n} is not increasing`);
  if (b.impact !== b.strike[1]) bad(`impact (${b.impact}) should equal end of strike (${b.strike[1]})`);
  // autoplay must stop exactly where the swing begins — the door opening is
  // the visitor's action, never something they merely watch
  if (b.swing[0] !== C.INTRO_END) bad(`autoplay ends at ${C.INTRO_END} but the swing starts at ${b.swing[0]} — the door must open on user input, not autoplay`);
  else ok(`autoplay stops at ${C.INTRO_END}, exactly where the visitor-driven swing begins`);
  if (b.forge[0] < b.gather[0]) bad(`forge starts before coins begin gathering`);
  if (C.INTRO_PACING.some(ph => ph.key === 'swing')) bad(`INTRO_PACING still contains a 'swing' phase — that beat belongs to the visitor`);
  else ok(`INTRO_PACING contains no swing phase`);
}

console.log('\n── 9b. each panel is visible at its own station ──');
{
  // shifted down one when the vault-open hold stopped being a station
  const AT = { sheet: 0, board: 1, spread: 2, card: 3, note: 4 };
  for (const [k, idx] of Object.entries(AT)) {
    const st = C.STATIONS[idx], w = C.PANEL_WINDOW[k];
    if (!w) { bad(`no PANEL_WINDOW for ${k}`); continue; }
    if (st < w[0] || st > w[1]) bad(`${k} station ${st} is outside its window [${w[0]},${w[1]}] — the panel would be hidden where it is meant to be read`);
    else ok(`${k} readable at station ${idx} (p=${st})`);
  }
}

console.log('\n── 9. panel windows do not overlap ──');
{
  const ent = Object.entries(C.PANEL_WINDOW).sort((a, b) => a[1][0] - b[1][0]);
  for (let i = 0; i < ent.length; i++) {
    const [k, [a, b]] = ent[i];
    if (b <= a) { bad(`PANEL_WINDOW.${k} is not increasing`); continue; }
    if (i + 1 < ent.length) {
      const [k2, [a2]] = ent[i + 1];
      if (a2 < b) bad(`PANEL_WINDOW.${k} closes at ${b} but ${k2} opens at ${a2} — overlapping windows put two panels on screen at once (the black-card bug)`);
      else ok(`${k} [${a},${b}] → ${k2} opens ${a2}, gap ${(a2 - b).toFixed(3)}`);
    } else ok(`${k} [${a},${b}] (last)`);
  }
  // flank must also clear the first panel
  const firstOpen = Math.min(...Object.values(C.PANEL_WINDOW).map(w => w[0]));
  if (C.FLANK_WINDOW[3] > firstOpen) bad(`FLANK closes at ${C.FLANK_WINDOW[3]}, after the first panel opens at ${firstOpen}`);
  else ok(`FLANK closes ${C.FLANK_WINDOW[3]} before first panel opens ${firstOpen}`);
}

console.log('\n── 9c. the résumé desk ──');
{
  const R = C.RESUME, RT = C.RESUME_TABLE;
  const deskTop = RT.top + 0.002;
  const halfV = Math.cos(R.elev) * R.h / 2;      // vertical half-extent
  const halfZ = Math.sin(R.elev) * R.h / 2;      // fore/aft half-extent
  const botY = R.pos[1] - halfV, botZ = R.pos[2] - halfZ;
  const topY = R.pos[1] + halfV, topZ = R.pos[2] + halfZ;

  if (Math.abs(botY - deskTop) > 0.006)
    bad(`résumé low edge y ${botY.toFixed(4)} does not rest on the desk top ${deskTop.toFixed(4)}`);
  else ok(`résumé low edge rests on the desk (y ${botY.toFixed(3)}), high edge at y ${topY.toFixed(3)}`);

  // the page and its stand must sit on the desk, not overhang it
  const halfDepth = 0.78 / 2, halfWidth = 1.30 / 2;
  if (Math.abs(botZ - RT.z) > halfDepth || Math.abs(topZ - RT.z) > halfDepth)
    bad(`résumé overhangs the desk in z: spans ${botZ.toFixed(3)}..${topZ.toFixed(3)}, desk ${(RT.z-halfDepth).toFixed(3)}..${(RT.z+halfDepth).toFixed(3)}`);
  else ok(`résumé sits within the desk depth (${botZ.toFixed(3)}..${topZ.toFixed(3)})`);
  if (R.w / 2 > halfWidth - 0.04) bad(`résumé (w ${R.w}) too wide for the ${1.30}m desk`);
  else ok(`résumé width ${R.w}m clears the desk edges`);

  for (const [a, label] of ASPECTS) {
    const d = C.fitDistance(R, a);
    const pos = [R.pos[0], R.pos[1] + Math.sin(R.elev) * d, R.pos[2] - Math.cos(R.elev) * d];
    const where = inside(pos);
    if (where !== 'rooftop') bad(`${label}: résumé camera stop [${pos.map(v=>v.toFixed(2))}] is not on the rooftop (${where})`);
    else ok(`${label}: résumé stop [${pos.map(v=>v.toFixed(2)).join(', ')}] on the rooftop, d=${d.toFixed(3)}`);

    // the page must actually fit the frame at this aspect
    const t = Math.tan((C.FOV * Math.PI / 180) / 2);
    const fracH = R.h / (2 * t * d), fracW = R.w / (2 * t * a * d);
    if (fracH > 0.999 || fracW > 0.999) bad(`${label}: résumé overflows frame (h ${fracH.toFixed(3)} w ${fracW.toFixed(3)})`);
  }

  // the excursion is a straight lerp from the card stop — check it stays inside
  const cardD = C.fitDistance(C.CARRIER.card, 1.7778);
  const cc = C.CARRIER.card;
  const from = [cc.pos[0], cc.pos[1] + Math.sin(cc.elev) * cardD, cc.pos[2] - Math.cos(cc.elev) * cardD];
  const rd = C.fitDistance(R, 1.7778);
  const to = [R.pos[0], R.pos[1] + Math.sin(R.elev) * rd, R.pos[2] - Math.cos(R.elev) * rd];
  let clear = true;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const q = [0, 1, 2].map(k => from[k] + (to[k] - from[k]) * t);
    if (!inside(q)) { bad(`résumé flight leaves the building at t=${t.toFixed(2)} [${q.map(v=>v.toFixed(2))}]`); clear = false; break; }
  }
  if (clear) ok('résumé flight path stays on the rooftop end to end');
}

console.log('\n── 7. autoplay pacing table ──');
{
  let acc = 0, p0 = 0, brokenChain = false;
  for (const phase of C.INTRO_PACING) {
    const p1 = phase.to !== undefined ? phase.to : C.BEAT[phase.key]?.[1];
    if (p1 === undefined) { bad(`INTRO_PACING phase "${phase.key}" has no matching BEAT end`); brokenChain = true; continue; }
    if (p1 <= p0) { bad(`INTRO_PACING phase "${phase.key}" p does not increase (${p0} -> ${p1})`); brokenChain = true; }
    acc += phase.dur; p0 = p1;
  }
  if (p0 !== C.INTRO_END) bad(`INTRO_PACING ends at p=${p0}, expected INTRO_END (${C.INTRO_END})`);
  else if (!brokenChain) ok(`autoplay pacing: ${acc.toFixed(2)}s across ${C.INTRO_PACING.length} phases, lands on INTRO_END`);
  if (C.INTRO_HANDOFF_PAUSE < 0.3) bad(`handoff pause (${C.INTRO_HANDOFF_PAUSE}s) is too short to read as a deliberate beat`);
  else ok(`handoff pause: ${C.INTRO_HANDOFF_PAUSE}s before scroll unlocks`);
}

console.log('\n── 8. flank photo/sign ──');
{
  const [a, b1, c, d] = C.FLANK_WINDOW;
  if (!(a < b1 && b1 <= c && c < d)) bad(`FLANK_WINDOW is not a valid 4-point fade: [${C.FLANK_WINDOW}]`);
  else ok(`FLANK fades in [${a},${b1}], out [${c},${d}]`);
  // the flanks are revealed by the visitor-driven swing, so they must fade in
  // within the swing window, not during autoplay
  // the portrait/sign are wall fixtures, visible as soon as the camera settles
  // into the wide shot — deliberately BEFORE the door opens
  if (a > C.BEAT.swing[1]) bad(`flank fade-in starts (${a}) after the swing completes (${C.BEAT.swing[1]}) — would never be seen`);
  else if (b1 > C.INTRO_END) bad(`flank not fully visible until ${b1}, after autoplay ends at ${C.INTRO_END} — should be up while the vault is still shut`);
  else ok(`flank fully visible by ${b1}, before autoplay ends (${C.INTRO_END}) and the door opens`);
  // must be fully faded out before the office sheet appears — they sit back
  // at the vault while the office camera is 4m past them, so any overlap
  // leaves a CSS3D element behind the camera (see inFrontOf in panels.js)
  // geometry: door mouth is a circle r=1.255 at y=VAULT_Y; facade pilasters
  // are 0.22 wide at these x positions
  const PILASTERS = [-3.7, -2.6, 2.6, 3.7].map(x => [x - 0.11, x + 0.11]);
  const DOOR_R = 1.255, DOOR_TOP = C.VAULT_Y + DOOR_R;
  const t = Math.tan((C.FOV * Math.PI / 180) / 2);
  const camY = C.FIXED_STOP.wide.pos[1], camZ = C.FIXED_STOP.wide.pos[2];
  const halfH = Math.abs(camZ) * t, halfW = halfH * 1.7778;   // at the door plane, 16:9
  const frameTop = camY + halfH, frameBot = camY - halfH;

  for (const key of Object.keys(C.FLANK)) {
    const f = C.FLANK[key];
    const l = f.pos[0] - f.w / 2, r = f.pos[0] + f.w / 2;
    const b = f.pos[1] - f.h / 2, tp = f.pos[1] + f.h / 2;

    // must not sit over the door mouth
    const overlapsDoorX = l < DOOR_R && r > -DOOR_R;
    if (overlapsDoorX && b < DOOR_TOP) {
      bad(`FLANK.${key} x[${l.toFixed(2)},${r.toFixed(2)}] y[${b.toFixed(2)},${tp.toFixed(2)}] overlaps the door mouth (r=${DOOR_R}, top=${DOOR_TOP.toFixed(2)})`);
      continue;
    }
    let clash = null;
    for (const [pl, pr] of PILASTERS) if (l < pr && r > pl) clash = [pl, pr];
    if (clash) { bad(`FLANK.${key} spans x[${l.toFixed(2)},${r.toFixed(2)}] — overlaps a facade pilaster at x[${clash[0].toFixed(2)},${clash[1].toFixed(2)}]`); continue; }
    if (tp > frameTop || b < frameBot) { bad(`FLANK.${key} y[${b.toFixed(2)},${tp.toFixed(2)}] is outside the wide-shot frame y[${frameBot.toFixed(2)},${frameTop.toFixed(2)}]`); continue; }
    if (r > halfW || l < -halfW) { bad(`FLANK.${key} x[${l.toFixed(2)},${r.toFixed(2)}] is outside the wide-shot frame x[±${halfW.toFixed(2)}] at 16:9`); continue; }
    // "in frame" is not enough — the fixed header owns the top of the frame,
    // and the sign's border was cutting through the nav links.
    const navFloor = frameTop - C.NAV_SAFE * (2 * halfH);
    if (tp > navFloor) {
      bad(`FLANK.${key} top ${tp.toFixed(3)} intrudes into the header band (below ${navFloor.toFixed(3)})`);
      continue;
    }
    ok(`FLANK.${key} x[${l.toFixed(2)},${r.toFixed(2)}] y[${b.toFixed(2)},${tp.toFixed(2)}] — in frame, clear of door, pilasters and header`);
  }
}

console.log('\n' + (problems === 0
  ? '── PASS: 0 problems ──\n'
  : `── ${problems} PROBLEM(S) ──\n`));
process.exit(problems ? 1 : 0);
