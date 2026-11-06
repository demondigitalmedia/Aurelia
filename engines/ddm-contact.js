/* =====================================================================
   DDM CREATION SYSTEM · PHYSICS · CONTACT ENGINE  (v0.5)

   Takes over the instant a disc touches anything and decides what happens next:
     SKIP       glances off and flies again (flight engine resumes: wind, ground effect)
     SKUTTLE    skids and skitters along the surface, drifting to the fade side
     ROLL       lands on edge and rolls; curves toward its lean; the lean drifts to the
                fade side as it slows, so a RHBH backhand roller finishes counterclockwise
     TOMBSTONE  edge-first, steep and fast into soft ground: sticks upright, up to 4 in deep
     DIG        steep into firm ground (or an edge grab): most energy gone at once
     BOUNCE     hits a solid (tree, rock, pole, wall): impulse with restitution and friction
     SPLASH     (v0.4) water: a flat, fast, shallow disc skips off it; anything else
                splashes and sinks where it lands, and a disc that slides or rolls in sinks too
     HOP        (v0.5) hard ground never swallows a disc: an edge that comes in steep rings off
                asphalt, concrete or rock and bounces on, and a flat disc slapping down hops
                before it slides. Digging in is for soft ground only. Tombstones can be switched
                off (putts never tombstone; that is a big hyzer drive into soft ground).
     LAYERS     (v0.5) obstacles are built in layers of different density (the DDM element
                model): a hard core (trunk, rock, a bear's body) bounces; a mid layer of
                capsules (branches, twigs, limbs) gives, deflects and slows; a porous outer
                layer (leaves, fur, a bush's foliage) is a volume the disc travels through,
                losing speed and spin, knocked off line, and maybe held there for good.
                Every random thing here comes from the throw's seed, so a replay is exact.

   Solids (v0.3): 'cyl' (trees, poles), 'sphere' (rocks, heads) and 'box' (walls, platforms,
   barriers, nets): a box has a centre, half sizes hx/hy, a yaw, and z0..z1. A box marked
   terrainTop is a raised platform whose top is part of the ground shape, so only its sides
   bounce; the disc lands on its top like any other ground.

   Every surface is a material record (ddm-materials.js). Rules and numbers follow the
   Contact Engine Reference v0.2 (sources and field claims listed there). All values are
   calibration v0: starting points to tune in playtesting and with launcher data.

   Units: metres, seconds. Frame: x right, y downrange, z up (same as the flight engine).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DDMContact = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const v3 = (x, y, z) => ({ x, y, z });
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = Math.PI / 180, G = 9.81, IN = 0.0254, FT = 0.3048, MPH = 0.44704;
  const DISC_R = 0.1055, HALF_T = 0.01;

  /* ---------- the rules (calibration v0) ---------- */
  const RULES = {
    tombstone: { minTilt: 55, minPath: 22, minNormalSpeed: 4.0, fullDepthSpeed: 13, minEmbed: 0.2, minDepthIn: 1.0 },
    roll: { minTilt: 62, maxPath: 32, minSpinRpm: 150, maxEmbed: 0.6, impactLoss: 0.18 },
    dig: { minTilt: 55, minPath: 32, keep: 0.1 },
    skip: { minTilt: 4, maxTilt: 50, maxPath: 35, minRetention: 0.3, minLift: 0.7, kick: 0.1, flatten: 0.4, spinLoss: 0.15 },
    water: { maxTilt: 22, maxPath: 16, minSpeed: 6.0, retention: 0.6 },
    hard: { maxEmbed: 0.05, edgeE: 0.55, edgeKeep: 0.55, minHop: 0.45, slapK: 0.5, slapMinVn: 1.4, slapKeep: 0.88 },
    porous: { brushMin: 1.0 },
    skuttle: { driftK: 0.12, restSpeed: 0.04, scrapeEvery: 0.12, spinDecay: 2.0, spinDecayFriction: 6.0 },
    rollFall: { maxLeanDeg: 70, minSpeed: 0.25, fadeLeanRate: 6, leanGrow: 0.8 },
  };

  // small seeded generator (mulberry32): every leaf brush and branch flex replays exactly
  function rng32(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function create(opts) {
    const M = opts.materials, surfaceAt = opts.surfaceAt, solids = opts.solids || [];
    const rnd = rng32(opts.seed != null ? opts.seed : 7);
    const SM = opts.solidMaterials || {};
    const blobs = solids.filter(o => o.kind === 'blob'), hardSolids = solids.filter(o => o.kind !== 'blob');
    const inside = new Map();                                          // porous blobs the disc is in right now
    const fallback = opts.fallbackSurface || 'short_grass_dry';
    let gz = () => 0, spinSign = -1, turnSide = 1, luck = null;
    const st = { mode: null, omega0: 1, scrapeT: 0, skips: 0, touches: [], roll: null, firstTouch: null, rest: null, restSurface: null, slideFrom: null, rootDone: false, bounces: 0 };

    const surf = (x, y) => { const k = surfaceAt(x, y); return { key: M.surfaces[k] ? k : fallback, m: M.surfaces[k] || M.surfaces[fallback] }; };
    function normalAt(x, y) { const e = 0.05; return norm(v3(-(gz(x + e, y) - gz(x - e, y)) / (2 * e), -(gz(x, y + e) - gz(x, y - e)) / (2 * e), 1)); }
    function ev(events, t, type, pos, extra) { events.push(Object.assign({ t, type, x: pos.x / FT, y: pos.y / FT, z: pos.z / FT }, extra || {})); }
    function rpm(w) { return w * 60 / (2 * Math.PI); }
    function upFace(n, N) { return dot(n, N) < 0 ? mul(n, -1) : n; }

    /* ---------- first touch (and every later touch after a skip) ---------- */
    function touch(S, events) {
      const N = normalAt(S.pos.x, S.pos.y), { key, m } = surf(S.pos.x, S.pos.y);
      const g0 = gz(S.pos.x, S.pos.y);
      const vn = dot(S.vel, N);
      if (vn >= 0) { S.pos = add(v3(S.pos.x, S.pos.y, g0), mul(N, 0.002)); return 'skip'; }   // already leaving the surface
      const vt = sub(S.vel, mul(N, vn)), vtl = len(vt);
      const that = vtl > 1e-6 ? mul(vt, 1 / vtl) : norm(v3(S.vel.x || 0, S.vel.y || 1, 0));
      const right = norm(cross(that, N));
      const nn = upFace(S.n, N);
      const tilt = Math.acos(clamp(dot(nn, N), -1, 1)) / DEG;            // 0 flat to the surface, 90 edge-on
      const path = Math.atan2(-vn, vtl) / DEG;                           // 0 grazing, 90 straight down
      const noseUp = dot(nn, that) < -Math.sin(4 * DEG);                 // leading edge up: underside meets the ground first
      const lowSide = dot(nn, right) >= 0 ? 1 : -1;                     // +1: right edge is low
      const spinR = rpm(S.omega), spinF = clamp(spinR / 900, 0.3, 1.3);
      const info = { surface: key, tilt: +tilt.toFixed(1), path: +path.toFixed(1), v: +(len(S.vel) / MPH).toFixed(1) };
      if (st.firstTouch == null) st.firstTouch = { t: S.t, x: S.pos.x, y: S.pos.y };
      st.omega0 = Math.max(1, S.omega);
      if (m.water) return waterTouch(S, events, N, g0, vn, vt, vtl, right, tilt, path, lowSide, spinF, key, info);

      // TOMBSTONE: edge-first, steep, fast, soft ground
      const R1 = RULES.tombstone;
      if (!opts.noTombstone && tilt > R1.minTilt && path > R1.minPath && -vn > R1.minNormalSpeed && m.embed >= R1.minEmbed) {
        const depthIn = 4 * m.embed * clamp((-vn - R1.minNormalSpeed) / (R1.fullDepthSpeed - R1.minNormalSpeed), 0, 1);
        if (depthIn >= R1.minDepthIn) {
          S.pos = v3(S.pos.x, S.pos.y, g0 + DISC_R * Math.sin(tilt * DEG) - depthIn * IN);
          S.vel = v3(0, 0, 0); S.omega = 0; S.tilt = v3(0, 0, 0);
          st.mode = 'stuck'; st.rest = { x: S.pos.x, y: S.pos.y }; st.restSurface = key;
          ev(events, S.t, 'tombstone', S.pos, Object.assign(info, { depthIn: +depthIn.toFixed(1) }));
          st.touches.push('tombstone'); return 'ground';
        }
      }
      // ROLL: lands near vertical with spin, on ground firm enough to roll on
      const R2 = RULES.roll;
      if (tilt > R2.minTilt && path < R2.maxPath && spinR > R2.minSpinRpm && m.embed < R2.maxEmbed) {
        const lean = (90 - tilt) * (dot(nn, right) < 0 ? 1 : -1);      // + leans right
        st.roll = { v: vtl * (1 - R2.impactLoss), h: that, lean };
        st.mode = 'roll'; st.slideFrom = { x: S.pos.x, y: S.pos.y };
        ev(events, S.t, 'roll', S.pos, info); st.touches.push('roll');
        return 'ground';
      }
      // luck: a lucky or dead hop on this touch
      let hopMul = 1;
      if (luck) { const L = luck.hop(); if (L) { hopMul = L.mul; ev(events, S.t, 'luck', S.pos, { name: L.lucky ? 'lucky hop' : 'dead hop', lucky: L.lucky }); } }
      // DIG: steep into firm ground, or an edge grab (rolled by the Luck engine)
      const R3 = RULES.dig;
      const grab = luck ? luck.edgeGrab(m.edgeGrab * clamp((tilt - 20) / 50, 0, 1) * clamp(path / 30, 0.3, 1)) : false;
      const H = RULES.hard;
      if (tilt > R3.minTilt && path > R3.minPath && !grab && m.embed < H.maxEmbed) {
        // HARD GROUND, EDGE FIRST: the rim rings off and the disc bounces on, wobbling
        const vnOut = -vn * m.restitution * H.edgeE * hopMul;
        if (vnOut > H.minHop) {
          S.vel = add(mul(vt, H.edgeKeep), mul(N, vnOut));
          const ax = norm(cross(N, that));
          S.tilt = add(S.tilt || v3(0, 0, 0), mul(ax, (rnd() * 2 - 1) * vnOut * 2.2));
          S.omega *= 0.7;
          S.pos = add(v3(S.pos.x, S.pos.y, g0), mul(N, 0.004));
          st.skips++; ev(events, S.t, 'hop', S.pos, Object.assign(info, { edge: true, up: +vnOut.toFixed(2) })); st.touches.push('hop');
          return 'skip';
        }
      }
      if ((tilt > R3.minTilt && path > R3.minPath && m.embed >= H.maxEmbed) || grab) {
        S.vel = mul(vt, R3.keep); S.pos = v3(S.pos.x, S.pos.y, g0 + HALF_T);
        st.mode = 'slide'; st.slideFrom = { x: S.pos.x, y: S.pos.y };
        ev(events, S.t, 'dig', S.pos, Object.assign(info, { grab: !!grab })); st.touches.push('dig');
        return 'ground';
      }
      // SKIP: hyzer-side edge leads, not nose up, inside the angle window, surface lively enough
      const R4 = RULES.skip;
      if (!noseUp && tilt >= R4.minTilt && tilt <= R4.maxTilt && path < R4.maxPath && m.skipRetention >= R4.minRetention) {
        const vnOut = -vn * m.restitution * (0.55 + tilt / 40) * spinF * hopMul;    // more hyzer, bigger skip
        if (vnOut > R4.minLift) {
          let vtOut = mul(vt, m.skipRetention * (1.05 - tilt / 150));              // flatter, longer skip
          vtOut = add(vtOut, mul(right, lowSide * vtl * R4.kick * Math.sin(tilt * DEG) * spinF));   // kicks toward the low edge
          S.vel = add(vtOut, mul(N, vnOut));
          const flat = norm(add(mul(nn, 1 - R4.flatten), mul(N, R4.flatten)));
          S.n = dot(S.n, N) < 0 ? mul(flat, -1) : flat;
          S.omega *= 1 - R4.spinLoss;
          S.pos = add(v3(S.pos.x, S.pos.y, g0), mul(N, 0.003));
          st.skips++; ev(events, S.t, 'skip', S.pos, Object.assign(info, { n: st.skips, up: +(vnOut).toFixed(2) })); st.touches.push('skip');
          return 'skip';
        }
      }
      // FLAT SLAP: a flat (or nose-up) disc coming down hard pops back up before it slides
      if ((tilt < R4.minTilt || noseUp) && -vn > H.slapMinVn) {
        const vnOut = -vn * m.restitution * H.slapK * (1 - Math.min(0.9, m.embed * 2)) * hopMul;
        if (vnOut > H.minHop) {
          S.vel = add(mul(vt, H.slapKeep), mul(N, vnOut));
          const flat = norm(add(mul(nn, 0.6), mul(N, 0.4))); S.n = dot(S.n, N) < 0 ? mul(flat, -1) : flat;
          S.omega *= 0.9;
          S.pos = add(v3(S.pos.x, S.pos.y, g0), mul(N, 0.003));
          st.skips++; ev(events, S.t, 'hop', S.pos, Object.assign(info, { up: +vnOut.toFixed(2) })); st.touches.push('hop');
          return 'skip';
        }
      }
      // SKUTTLE: everything else slides
      S.vel = mul(vt, 1 - 0.25 * clamp(path / 45, 0, 1));
      S.pos = v3(S.pos.x, S.pos.y, g0 + HALF_T);
      st.mode = 'slide'; st.slideFrom = { x: S.pos.x, y: S.pos.y };
      ev(events, S.t, 'skuttle', S.pos, Object.assign(info, { noseUp })); st.touches.push('skuttle');
      return 'ground';
    }

    /* ---------- water: skip clean or splash and sink ---------- */
    function waterTouch(S, events, N, g0, vn, vt, vtl, right, tilt, path, lowSide, spinF, key, info) {
      const W = RULES.water;
      if (tilt <= W.maxTilt && path <= W.maxPath && len(S.vel) >= W.minSpeed) {
        const vnOut = Math.max(-vn * m_(key).restitution * spinF, 0.9);
        S.vel = add(mul(vt, W.retention), mul(N, vnOut));
        S.omega *= 0.8; S.pos = add(v3(S.pos.x, S.pos.y, g0), mul(N, 0.004));
        st.skips++; ev(events, S.t, 'skip', S.pos, Object.assign(info, { n: st.skips, up: +vnOut.toFixed(2), water: true })); st.touches.push('skip');
        return 'skip';
      }
      return splash(S, events, key, info);
    }
    const m_ = k => M.surfaces[k] || M.surfaces[fallback];
    function splash(S, events, key, info) {
      S.pos = v3(S.pos.x, S.pos.y, gz(S.pos.x, S.pos.y) - 0.05);
      S.vel = v3(0, 0, 0); S.omega = 0; S.tilt = v3(0, 0, 0);
      st.mode = 'stuck'; st.rest = { x: S.pos.x, y: S.pos.y }; st.restSurface = key;
      ev(events, S.t, 'splash', S.pos, Object.assign({ surface: key }, info || {})); st.touches.push('splash');
      return 'ground';
    }

    /* ---------- on the ground: skuttle or roll until rest ---------- */
    function groundStep(S, dt, events) {
      if (st.mode === 'stuck' || st.mode === 'lodged') return true;
      S.dt = dt;
      if (st.mode === 'roll') return rollStep(S, dt, events);
      const N = normalAt(S.pos.x, S.pos.y), { key, m } = surf(S.pos.x, S.pos.y);
      if (m.water) { splash(S, events, key); return true; }
      const R = RULES.skuttle;
      let v = sub(S.vel, mul(N, dot(S.vel, N)));
      const sp = len(v), gT = sub(v3(0, 0, -G), mul(N, -G * N.z));
      let a = gT;
      if (sp > 1e-4) {
        const dir = mul(v, 1 / sp), side = norm(cross(dir, N));
        const decel = m.slideFriction * G * N.z + m.grassDrag * sp;
        a = add(a, mul(dir, -decel));
        const spinFrac = clamp(S.omega / st.omega0, 0, 1);
        a = add(a, mul(side, -turnSide * R.driftK * m.slideFriction * G * spinFrac * clamp(sp / 2, 0, 1)));   // drifts to the fade side
        if (luck && !st.rootDone && m.grassDrag > 0.04) {
          st.rootDone = true; const k = luck.rootKick(S.pos, sp);
          if (k) { v = add(v, k.dv); ev(events, S.t, 'luck', S.pos, { name: k.lucky ? 'lucky kick' : 'root kick', lucky: k.lucky }); }
        }
      }
      let nv = add(v, mul(a, dt));
      if (sp > 1e-4 && dot(nv, v) <= 0) nv = v3(0, 0, 0);             // friction never reverses the slide
      const slopeAcc = len(gT);
      if (len(nv) < R.restSpeed && slopeAcc < m.slideFriction * G * 1.1) nv = v3(0, 0, 0);
      S.vel = nv;
      const p = add(S.pos, mul(nv, dt));
      S.pos = v3(p.x, p.y, gz(p.x, p.y) + HALF_T);
      const nn = upFace(S.n, N), k = Math.min(1, 10 * dt);
      const flat = norm(add(mul(nn, 1 - k), mul(N, k)));
      S.n = dot(S.n, N) < 0 ? mul(flat, -1) : flat;
      S.omega *= Math.exp(-(R.spinDecay + R.spinDecayFriction * m.slideFriction) * dt);
      st.scrapeT += dt;
      if (st.scrapeT >= R.scrapeEvery && len(nv) > 0.3) { st.scrapeT = 0; ev(events, S.t, 'scrape', S.pos, { surface: key, v: +(len(nv) / MPH).toFixed(1) }); }
      solidsGround(S, events);
      if (len(S.vel) === 0) { finish(S, events, key); return true; }
      return false;
    }
    function rollStep(S, dt, events) {
      const r = st.roll, N = normalAt(S.pos.x, S.pos.y), { key, m } = surf(S.pos.x, S.pos.y), F = RULES.rollFall;
      if (m.water) { st.roll = null; splash(S, events, key); return true; }
      const gT = sub(v3(0, 0, -G), mul(N, -G * N.z));
      r.h = norm(sub(r.h, mul(N, dot(r.h, N))));
      r.v += (dot(gT, r.h) - m.rollResistance * G - 0.02 * r.v * r.v) * dt;
      const fadeSign = -turnSide;                                        // lean drifts to the fade side as it slows
      r.lean += (fadeSign * F.fadeLeanRate + r.lean * F.leanGrow / (Math.max(r.v, 0) + 0.3)) * dt;
      if (r.v <= F.minSpeed || Math.abs(r.lean) > F.maxLeanDeg) {
        ev(events, S.t, 'fall', S.pos, { surface: key });
        st.mode = 'slide'; S.vel = mul(r.h, Math.max(0, r.v) * 0.4); st.roll = null;
        return groundStep(S, dt, events);
      }
      const lam = clamp(r.lean, -75, 75) * DEG;
      const turn = -G * Math.tan(lam) / Math.max(r.v, 0.3) * dt;          // leaning right turns right (clockwise from above)
      const c = Math.cos(turn), s = Math.sin(turn), Rv = cross(r.h, N);
      r.h = norm(add(mul(r.h, c), mul(cross(N, r.h), s)));
      const p = add(S.pos, mul(r.h, r.v * dt));
      S.pos = v3(p.x, p.y, gz(p.x, p.y) + DISC_R * Math.cos(lam));
      S.vel = mul(r.h, r.v);
      const Rn = norm(cross(r.h, N));
      S.n = norm(add(mul(N, Math.abs(Math.sin(lam))), mul(Rn, -(lam >= 0 ? 1 : -1) * Math.cos(lam))));
      S.omega = r.v / DISC_R;
      solidsGround(S, events);
      return false;
    }
    function finish(S, events, key) {
      st.rest = { x: S.pos.x, y: S.pos.y }; st.restSurface = key;
      ev(events, S.t, 'rest', S.pos, { surface: key });
    }

    /* ---------- solids: trees, rocks, poles, walls ---------- */
    /* ---------- the porous outer layer: leaves, fur, foliage. The disc travels through it. ---------- */
    function porous(S, events) {
      if (!blobs.length) return false;
      const dt = S.dt || 0.0025;
      let held = false;
      for (const o of blobs) {
        const dx = S.pos.x - o.x, dy = S.pos.y - o.y, dz = (S.pos.z - o.z) / (o.squash || 1), d = Math.sqrt(dx * dx + dy * dy + dz * dz), R = o.r + DISC_R * 0.4;
        let s = inside.get(o);
        if (d >= R) { if (s) inside.delete(o); continue; }
        const pm = (SM[o.mat] && SM[o.mat].porous) || { drag: 6, deflect: 0.8, spinDrag: 3, catchSpeed: 2, hold: 0.5 };
        const dens = o.density * (1 - 0.6 * (d / R) * (d / R));
        const sp = len(S.vel);
        if (!s) {
          s = { tested: false }; inside.set(o, s);
          if (sp > RULES.porous.brushMin) { ev(events, S.t, 'brush', S.pos, { surface: o.mat, v: +(sp / MPH).toFixed(1), name: o.name, density: +dens.toFixed(2) }); st.touches.push('brush'); }
        }
        // drag grows a little with speed (a faster disc meets more leaves per second)
        const k = pm.drag * dens * (0.7 + 0.3 * clamp(sp / 8, 0, 2));
        S.vel = mul(S.vel, Math.exp(-k * dt));
        const j = pm.deflect * dens * sp * Math.sqrt(dt);
        S.vel = add(S.vel, v3((rnd() * 2 - 1) * j, (rnd() * 2 - 1) * j, (rnd() * 2 - 1) * j * 0.6));
        S.omega *= Math.exp(-(pm.spinDrag || 3) * dens * dt);
        if (S.tilt) S.tilt = add(S.tilt, v3((rnd() * 2 - 1) * j * 4, (rnd() * 2 - 1) * j * 4, 0));
        // slowed to a crawl inside: it hangs up in there, or it drops out (once per pass through)
        if (!s.tested && len(S.vel) < pm.catchSpeed && dens > 0.3) {
          s.tested = true;
          if (rnd() < pm.hold * dens) {
            S.vel = v3(0, 0, 0); S.omega = 0; S.tilt = v3(0, 0, 0);
            st.mode = 'lodged'; st.rest = { x: S.pos.x, y: S.pos.y }; st.restSurface = o.mat;
            ev(events, S.t, 'hung', S.pos, { surface: o.mat, name: o.name }); st.touches.push('hung');
            held = true; break;
          } else ev(events, S.t, 'drop', S.pos, { surface: o.mat, name: o.name });
        }
      }
      return held ? 'lodged' : false;
    }
    function hitSolid(S, events) {
      const pr = porous(S, events); if (pr) return pr;
      for (const o of hardSolids) {
        if (o.groundOnly && !st.mode) continue;                          // e.g. a basket pole the flight engine already handles in the air
        let Nn = null, pen = 0;
        if (o.kind === 'cyl') {
          if (S.pos.z < o.z0 - DISC_R || S.pos.z > o.z1) continue;
          const dx = S.pos.x - o.x, dy = S.pos.y - o.y, d = Math.hypot(dx, dy), reach = o.r + DISC_R * 0.85;
          if (d >= reach || d < 1e-6) continue;
          Nn = v3(dx / d, dy / d, 0); pen = reach - d;
        } else if (o.kind === 'sphere') {
          const d3 = sub(S.pos, v3(o.x, o.y, o.z)), d = len(d3), reach = o.r + HALF_T * 2;
          if (d >= reach || d < 1e-6) continue;
          Nn = mul(d3, 1 / d); pen = reach - d;
        } else if (o.kind === 'box') {
          const b = boxHit(o, S.pos); if (!b) continue;
          Nn = b.N; pen = b.pen;
        } else if (o.kind === 'capsule') {                              // a limb: branch, twig, arm, ladder rail
          const ab = v3(o.b.x - o.a.x, o.b.y - o.a.y, o.b.z - o.a.z), ap = v3(S.pos.x - o.a.x, S.pos.y - o.a.y, S.pos.z - o.a.z);
          const u = clamp(dot(ap, ab) / Math.max(1e-9, dot(ab, ab)), 0, 1), C = v3(o.a.x + ab.x * u, o.a.y + ab.y * u, o.a.z + ab.z * u);
          const d3 = sub(S.pos, C), d = len(d3), reach = o.r + DISC_R * 0.6;
          if (d >= reach || d < 1e-6) continue;
          Nn = mul(d3, 1 / d); pen = reach - d;
        } else continue;
        const vn = dot(S.vel, Nn);
        if (vn >= 0) { S.pos = add(S.pos, mul(Nn, pen)); continue; }
        const mat = SM[o.mat] || { restitution: 0.4, friction: 0.5 };
        let e = mat.restitution * (1 - (mat.give || 0));
        if (mat.flex) {                                                  // a springy limb: the push-back direction wanders a little
          Nn = norm(add(Nn, v3((rnd() * 2 - 1) * mat.flex, (rnd() * 2 - 1) * mat.flex, (rnd() * 2 - 1) * mat.flex * 0.5)));
        }
        if (luck) { const L = luck.bounce(); if (L) { e *= L.mul; ev(events, S.t, 'luck', S.pos, { name: L.lucky ? 'kind bounce' : 'harsh bounce', lucky: L.lucky }); } }
        const vt = sub(S.vel, mul(Nn, vn));
        // the rim grabs: friction at the contact point acts on the slip between the solid and the spinning rim,
        // so a spinning disc kicks sideways off a face and trades some spin for it (Coulomb impulse, capped
        // at what would make the rim roll along the face; a solid disc needs a third of the slip for that)
        const nUp = S.n || v3(0, 0, 1), w = mul(nUp, (S.omega || 0) * spinSign), rc = mul(Nn, -DISC_R);
        const vr0 = cross(w, rc), vr = v3(vr0.x, vr0.y, 0), vrT = sub(vr, mul(Nn, dot(vr, Nn))), slip = add(vt, vrT), slipL = len(slip);   // spin kicks sideways, never up
        const jn = (1 + e) * -vn, grab = mat.friction * 0.8;
        let dv = v3(0, 0, 0);
        if (slipL > 1e-6) dv = mul(slip, -Math.min(grab * jn, slipL / 3, 3.5) / slipL);
        const sp0 = len(S.vel);
        S.vel = add(add(vt, dv), mul(Nn, -vn * e));
        { const sp1 = len(S.vel); if (sp1 > sp0 * 0.98) S.vel = mul(S.vel, sp0 * 0.98 / sp1); }   // a bounce never adds energy
        S.pos = add(S.pos, mul(Nn, pen + 0.002));
        if (S.omega) { const dw = dot(cross(rc, dv), nUp) * 2 / (DISC_R * DISC_R) * spinSign; S.omega = Math.max(0, S.omega + dw) * 0.85; }
        if (S.tilt) S.tilt = add(S.tilt, mul(cross(Nn, v3(0, 0, 1)), -vn * 0.3));   // a knock, not a flip: the gyro holds most of its attitude
        // landing on top of a solid (a lintel, a head, a crate): once the hops are small it stays up there
        if (Nn.z > 0.7 && -vn * e < 0.6 && len(vt) < 1.2) {
          S.vel = v3(0, 0, 0); S.omega = 0; S.tilt = v3(0, 0, 0); S.n = v3(0, 0, 1);
          st.mode = 'lodged'; st.rest = { x: S.pos.x, y: S.pos.y }; st.restSurface = o.mat;
          ev(events, S.t, 'lodged', S.pos, { surface: o.mat, name: o.name }); st.touches.push('lodged');
          return 'lodged';
        }
        st.bounces++; ev(events, S.t, 'bounce', S.pos, { surface: o.mat, v: +(-vn / MPH).toFixed(1), name: o.name, layer: o.layer || null }); st.touches.push('bounce');
        return true;
      }
      return false;
    }
    // oriented box: closest face by least penetration (the top face is skipped for terrainTop platforms)
    function boxHit(o, P) {
      const reach = DISC_R * 0.85, vt = HALF_T * 2;
      if (P.z < o.z0 - vt || P.z > o.z1 + vt) return null;
      if (o.terrainTop && P.z > o.z1 - 0.02) return null;
      const c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), dx = P.x - o.x, dy = P.y - o.y;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const px = o.hx + reach - Math.abs(lx), py = o.hy + reach - Math.abs(ly);
      if (px <= 0 || py <= 0) return null;
      let pz = o.terrainTop ? Infinity : o.z1 + vt - P.z;
      const pzb = P.z - (o.z0 - vt);
      if (o.z0 <= 0.01) { /* sits on the ground: no underside */ } else pz = Math.min(pz, pzb);
      let N, pen;
      if (px <= py && px <= pz) { const sx = lx >= 0 ? 1 : -1; N = v3(sx * c, sx * s, 0); pen = px; }
      else if (py <= pz) { const sy = ly >= 0 ? 1 : -1; N = v3(-sy * s, sy * c, 0); pen = py; }
      else { N = pz === pzb ? v3(0, 0, -1) : v3(0, 0, 1); pen = pz; }
      return { N, pen };
    }
    function solidsGround(S, events) {
      const r = hitSolid(S, events); if (!r) return;
      if (r === 'lodged') { st.mode = 'lodged'; return; }
      if (st.mode === 'roll') { st.mode = 'slide'; st.roll = null; }
    }

    function summary() {
      const counts = {}; st.touches.forEach(t => counts[t] = (counts[t] || 0) + 1);
      let slideFt = null;
      if (st.slideFrom && st.rest) slideFt = Math.hypot(st.rest.x - st.slideFrom.x, st.rest.y - st.slideFrom.y) / FT;
      return { touches: st.touches.slice(), counts, final: st.mode, restSurface: st.restSurface, slideFt: slideFt != null ? +slideFt.toFixed(1) : null, skips: st.skips, bounces: st.bounces };
    }

    return {
      begin(o) { gz = o.groundZ; spinSign = o.spinSign; turnSide = o.turnSide; luck = o.luck || null; if (luck && luck.setTurnSide) luck.setTurnSide(turnSide); },
      touch, groundStep, solids(S, events) { return hitSolid(S, events); }, summary, rng: rnd,
    };
  }

  const LABEL = { skip: 'Skip', skuttle: 'Skuttle', roll: 'Roller', tombstone: 'Tombstone', dig: 'Dug in', bounce: 'Bounce', stuck: 'Tombstone', slide: 'Skuttle', lodged: 'Lodged', splash: 'Splash', hop: 'Hop', brush: 'Through the leaves', hung: 'Hung up', drop: 'Dropped out' };
  const VERSION = '0.5';
  return { VERSION, create, RULES, LABEL };
});
