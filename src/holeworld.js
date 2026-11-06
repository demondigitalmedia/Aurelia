/* =====================================================================
   AURELIA BUILDER · HOLE WORLD  (a hole you build, as data, and the world the engine plays on it)

   A hole is a plot of land 260 m wide and 400 m long on a 2.5 m grid:
     h      heights in metres (one per grid point)
     s      surface code per grid point (forest floor, fairway, rough, sand, rock, stone path, mud)
     water  one water level for the hole: land below it is water
     trees  [type, x, y, height, colour 0..1, rotation, lean]
     objs   moss walls { k:'wall', x, y, len, yaw, h } and boulders { k:'rock', x, y, r }
     tee    { x, y }   basket { x, y }
   Frame: metres, x right, y downrange, z up (the same frame the flight and contact engines use).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'), require('./treespec.js'));
  else root.HoleWorld = factory(root.AureliaWorld, root.TreeSpec);
})(typeof self !== 'undefined' ? self : this, function (AW, TS) {
  'use strict';
  const FT = 0.3048;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ss = AW.ss, fbm = AW.fbm, rng = AW.rng;

  const PLOT = { x0: -130, x1: 130, y0: -40, y1: 360, cell: 2.5 };
  const NX = Math.round((PLOT.x1 - PLOT.x0) / PLOT.cell) + 1, NY = Math.round((PLOT.y1 - PLOT.y0) / PLOT.cell) + 1;
  const SURF = ['deep_grass', 'short_grass_dry', 'medium_grass_wet', 'hardpack_dirt', 'rock_slab', 'flagstone', 'mud'];
  const SURF_NAME = ['forest floor', 'fairway', 'rough', 'sand', 'rock', 'stone path', 'mud'];
  const OPEN = [false, true, true, true, true, true, false];      // open ground (not forest) for spacing and colour
  const TYPES = TS.TYPES;   // pine, broad, palm, bush, fern, guardian, oak (the index is what gets saved)
  const MAX_TREES = 3500;

  const idx = (i, j) => j * NX + i;
  const gx = x => (x - PLOT.x0) / PLOT.cell, gy = y => (y - PLOT.y0) / PLOT.cell;
  const wx = i => PLOT.x0 + i * PLOT.cell, wy = j => PLOT.y0 + j * PLOT.cell;

  function blank(name) {
    return { v: 1, id: null, name: name || 'New hole', par: 3, template: 'meadow', water: 0, h: new Float32Array(NX * NY).fill(20), s: new Uint8Array(NX * NY).fill(2), trees: [], objs: [], tee: { x: 0, y: 0 }, basket: { x: 0, y: 110 } };
  }
  function clone(d) {
    return { v: 1, id: d.id, name: d.name, par: d.par, template: d.template, water: d.water, h: new Float32Array(d.h), s: new Uint8Array(d.s), trees: d.trees.map(t => t.slice()), objs: d.objs.map(o => Object.assign({}, o, o.pts ? { pts: o.pts.map(p => p.slice()) } : {})), inspired: d.inspired, tee: Object.assign({}, d.tee), basket: Object.assign({}, d.basket) };
  }

  /* ---------- sampling ---------- */
  function hAt(d, x, y) {
    const fx = clamp(gx(x), 0, NX - 1.0001), fy = clamp(gy(y), 0, NY - 1.0001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = d.h[idx(i, j)], b = d.h[idx(i + 1, j)], c = d.h[idx(i, j + 1)], e = d.h[idx(i + 1, j + 1)];
    let z = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
    // past the edge of the plot the land climbs into hills, so the plot sits in a bowl
    const ox = Math.max(PLOT.x0 - x, 0, x - PLOT.x1), oy = Math.max(PLOT.y0 - y, 0, y - PLOT.y1), o = Math.hypot(ox, oy);
    if (o > 0) z += 0.45 * o * ss(0, 12, o) + 0.003 * o * o + 6 * fbm(x / 60 + 3, y / 60) * ss(0, 40, o);
    return z;
  }
  function sAt(d, x, y) { const i = Math.round(clamp(gx(x), 0, NX - 1)), j = Math.round(clamp(gy(y), 0, NY - 1)); return d.s[idx(i, j)]; }
  function inPlot(x, y) { return x >= PLOT.x0 && x <= PLOT.x1 && y >= PLOT.y0 && y <= PLOT.y1; }

  // signed distance (m) to the open ground: negative inside fairways and clearings, positive into the forest
  function openField(d) {
    const N = NX * NY, inside = new Float32Array(N), outside = new Float32Array(N), BIG = 1e6;
    for (let k = 0; k < N; k++) { const open = OPEN[d.s[k]] && d.h[k] >= d.water - 0.02; inside[k] = open ? BIG : 0; outside[k] = open ? 0 : BIG; }
    const pass = f => {
      const c = PLOT.cell, dg = c * 1.414;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = idx(i, j); let v = f[k]; if (i > 0) v = Math.min(v, f[k - 1] + c); if (j > 0) { v = Math.min(v, f[k - NX] + c); if (i > 0) v = Math.min(v, f[k - NX - 1] + dg); if (i < NX - 1) v = Math.min(v, f[k - NX + 1] + dg); } f[k] = v; }
      for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) { const k = idx(i, j); let v = f[k]; if (i < NX - 1) v = Math.min(v, f[k + 1] + c); if (j < NY - 1) { v = Math.min(v, f[k + NX] + c); if (i < NX - 1) v = Math.min(v, f[k + NX + 1] + dg); if (i > 0) v = Math.min(v, f[k + NX - 1] + dg); } f[k] = v; }
    };
    pass(inside); pass(outside);
    const out = new Float32Array(N); for (let k = 0; k < N; k++) out[k] = outside[k] > 0 ? outside[k] : -inside[k];
    return out;
  }

  /* ---------- the world the engine plays ---------- */
  function palmLean(p) { return 0.16 + Math.abs(p.lean) * 0.55; }
  function crownR(type, h, age) { return TS.norm({ type, h, age: age == null ? 0.5 : age }).r; }
  function world(d) {
    const W = {};
    const field = openField(d);
    W.data = d;
    W.HOLE = { number: d.number || 1, name: (d.name || 'Hole').toUpperCase(), par: d.par || 3 };
    W.TEE = { x: d.tee.x, y: d.tee.y }; W.BASKET = { x: d.basket.x, y: d.basket.y };
    W.WATER = d.water;
    W.H = (x, y) => hAt(d, x, y);
    W.G = (x, y) => Math.max(hAt(d, x, y), d.water);
    W.isWater = (x, y) => hAt(d, x, y) < d.water - 0.02;
    W.TEE_Z = W.H(d.tee.x, d.tee.y);
    W.surfaceAt = (x, y) => {
      if (W.isWater(x, y)) return 'moat_water';
      if (Math.hypot(x - d.tee.x, y - d.tee.y) < 3.4) return 'flagstone';
      if (!inPlot(x, y)) return 'deep_grass';
      return SURF[sAt(d, x, y)] || 'medium_grass_wet';
    };
    W.outside = (x, y) => {
      if (!inPlot(x, y)) return 40;
      const fx = clamp(gx(x), 0, NX - 1.0001), fy = clamp(gy(y), 0, NY - 1.0001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      return (field[idx(i, j)] * (1 - u) + field[idx(i + 1, j)] * u) * (1 - v) + (field[idx(i, j + 1)] * (1 - u) + field[idx(i + 1, j + 1)] * u) * v;
    };
    W.leftBound = () => PLOT.x0 + 4; W.rightBound = () => PLOT.x1 - 4;
    W.bounds = { x0: PLOT.x0 - 45, x1: PLOT.x1 + 45, y0: PLOT.y0 - 45, y1: PLOT.y1 + 45 };
    W.PLOT = PLOT;
    W.EDGES = [];
    W.PATH = [[d.tee.x, d.tee.y + 3], [d.basket.x, d.basket.y - 3]];
    W.paths = () => d.objs.filter(o => o.k === 'path');
    W.elements = () => d.objs.filter(o => o.k !== 'path');
    W.FALLS = null;
    W.palmLean = palmLean; W.fbm = fbm; W.rng = rng; W.ss = ss; W.FT = FT;
    W.surfName = (x, y) => W.isWater(x, y) ? 'the water' : !inPlot(x, y) ? 'deep in the woods' : SURF_NAME[sAt(d, x, y)];
    W.plants = () => d.trees.map(t => {
      const type = TYPES[t[0]] || 'pine', z = W.H(t[1], t[2]);
      return TS.norm({ type, x: t[1], y: t[2], z, h: t[3], c: t[4], rot: t[5], lean: t[6] || 0, cb: t[7] != null ? t[7] : null, age: t[8] != null ? t[8] : 0.5, solid: true, rec: t });
    });
    W.solidsFor = list => solidsFor(W, d, list);
    W.inBounds = (x, y) => x > PLOT.x0 - 20 && x < PLOT.x1 + 20 && y > PLOT.y0 - 20 && y < PLOT.y1 + 20;
    W.fixLie = (rest, prev, solids) => fixLie(W, rest, prev, solids);
    return W;
  }
  function wallBoxes(W, o) {
    const n = Math.max(1, Math.ceil(o.len / 4.2)), seg = o.len / n, c = Math.cos(o.yaw), s = Math.sin(o.yaw), out = [];
    for (let k = 0; k < n; k++) {
      const u = -o.len / 2 + seg * (k + 0.5), x = o.x + c * u, y = o.y + s * u;
      let lo = 1e9, hi = -1e9;
      for (let q = -1; q <= 1; q++) for (const side of [-0.6, 0.6]) { const px = x + c * q * seg / 2 - s * side, py = y + s * q * seg / 2 + c * side, z = W.H(px, py); lo = Math.min(lo, z); hi = Math.max(hi, z); }
      out.push({ kind: 'box', x, y, hx: seg / 2, hy: 0.5, yaw: o.yaw, z0: lo - 0.4, z1: hi + (o.h != null ? o.h : 1.0), mat: 'stone', name: 'moss wall' });
    }
    return out;
  }
  function solidsFor(W, d, list) {
    const S = [];
    for (const p of list) TS.solids(p).forEach(o => S.push(o));
    for (const o of d.objs) elementSolids(W, o).forEach(b => S.push(b));
    return S;
  }
  /* ---------- the elements: what each one is made of, for the physics (the renderer draws the same shapes) ---------- */
  function seeded(o) { return rng(Math.abs(Math.round(o.x * 73 + o.y * 131)) + 1); }
  function ringPoints(o, r, cz, n) {
    const px = -Math.sin(o.yaw), py = Math.cos(o.yaw), pts = [];
    for (let k = 0; k <= n; k++) { const a = k / n * Math.PI * 2; pts.push({ x: o.x + px * r * Math.cos(a), y: o.y + py * r * Math.cos(a), z: cz + r * Math.sin(a) }); }
    return pts;
  }
  const ELEMENTS = {
    wall: { name: 'Moss wall' }, rock: { name: 'Boulder' }, log: { name: 'Massive log' }, col: { name: 'Column' }, arch: { name: 'Stone arch' },
    ruin: { name: 'Ruin wall' }, mono: { name: 'Monolith' }, head: { name: 'Carved head' }, ring: { name: 'Stone ring' }, pyr: { name: 'Step pyramid' }, disc: { name: 'Disc sculpture' },
  };
  function elementParts(W, o) {
    const g = W.H(o.x, o.y), c = Math.cos(o.yaw || 0), s = Math.sin(o.yaw || 0), out = [];
    const box = (u, v, hx, hy, z0, z1, yaw, mat, name) => out.push({ kind: 'box', x: o.x + c * u - s * v, y: o.y + s * u + c * v, hx, hy, yaw: yaw != null ? yaw : (o.yaw || 0), z0, z1, mat: mat || 'stone', name: name || ELEMENTS[o.k].name });
    switch (o.k) {
      case 'wall': return wallBoxes(W, o);
      case 'rock': return [{ kind: 'sphere', x: o.x, y: o.y, z: g + o.r * 0.35, r: o.r, mat: 'rock', name: 'boulder' }];
      case 'log': {
        const ax = o.x - c * o.len / 2, ay = o.y - s * o.len / 2, bx = o.x + c * o.len / 2, by = o.y + s * o.len / 2;
        return [{ kind: 'capsule', a: { x: ax, y: ay, z: W.H(ax, ay) + o.r * 0.82 }, b: { x: bx, y: by, z: W.H(bx, by) + o.r * 0.82 }, r: o.r, mat: 'timber', name: 'massive log' }];
      }
      case 'col': return [{ kind: 'cyl', x: o.x, y: o.y, r: o.r, z0: g - 0.4, z1: g + o.h, mat: 'stone', name: 'column' }];
      case 'arch': {
        const t = Math.max(0.8, o.w * 0.18), d2 = t * 0.6;
        // yaw is the way you throw through it: the pillars stand either side of that line
        box(0, -(o.w / 2 + t / 2), d2, t / 2, g - 0.4, g + o.h); box(0, o.w / 2 + t / 2, d2, t / 2, g - 0.4, g + o.h);
        box(0, 0, d2, o.w / 2 + t, g + o.h, g + o.h + t * 0.9);
        return out;
      }
      case 'ruin': {
        const R2 = seeded(o), n = Math.max(1, Math.round(o.len / 1.6)), seg = o.len / n;
        for (let k = 0; k < n; k++) { const keep = R2(), hh = o.h * (0.3 + 0.7 * R2()); if (keep < 0.28) continue; box(-o.len / 2 + seg * (k + 0.5), 0, seg / 2, 0.45, g - 0.4, g + hh); }
        return out;
      }
      case 'mono': box(0, 0, o.h * 0.07, o.h * 0.17, g - 0.5, g + o.h); return out;
      case 'head': {
        out.push({ kind: 'sphere', x: o.x, y: o.y, z: g + o.s * 0.62, r: o.s * 0.5, mat: 'stone', name: 'carved head' });
        box(0, 0, o.s * 0.28, o.s * 0.28, g - 0.4, g + o.s * 0.3, null, 'stone', 'carved head');
        return out;
      }
      case 'ring': {
        const tt = Math.max(0.35, o.r * 0.16), cz = g + o.r + tt * 0.4, P = ringPoints(o, o.r, cz, 14);
        for (let k = 0; k < 14; k++) out.push({ kind: 'capsule', a: P[k], b: P[k + 1], r: tt, mat: 'stone', name: 'stone ring' });
        return out;
      }
      case 'disc': {
        const tt = Math.max(0.3, o.r * 0.1), cz = g + o.r * 0.92, P = ringPoints(o, o.r, cz, 16);
        for (let k = 0; k < 16; k++) out.push({ kind: 'capsule', a: P[k], b: P[k + 1], r: tt, mat: 'stone', name: 'disc sculpture' });
        box(0, 0, tt * 0.8, o.r * 0.8, cz - o.r * 0.8, cz + o.r * 0.8, (o.yaw || 0), 'stone', 'disc sculpture');
        return out;
      }
      case 'pyr': {
        const n = 5, th = o.s * 0.22, base = g - o.s * 0.38;
        for (let i = 0; i < n; i++) { const hs = o.s * (1 - i * 0.17); box(0, 0, hs, hs, base + i * th, base + (i + 1) * th, null, 'stone', 'step pyramid'); }
        return out;
      }
    }
    return out;
  }
  function elementSolids(W, o) { return o.k === 'path' ? [] : elementParts(W, o); }
  function fixLie(W, rest, prev, solids) {
    let x = rest.x, y = rest.y, note = null, penalty = 0;
    if (!W.inBounds(x, y)) return { x: prev.x, y: prev.y, penalty: 1, note: 'Out of bounds. Rethrow from your lie' };
    if (W.isWater(x, y)) {
      const dx = prev.x - x, dy = prev.y - y, L = Math.hypot(dx, dy) || 1;
      let k = 0; while (k < L && W.isWater(x + dx / L * k, y + dy / L * k)) k += 0.5;
      x += dx / L * (k + 1.2); y += dy / L * (k + 1.2); penalty = 1; note = 'In the water. One stroke, play from the shore';
    }
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (const s of solids) {
        if (s.kind === 'cyl' || s.kind === 'sphere') { const r = s.r + (s.kind === 'sphere' ? 0.3 : 0.5), dd = Math.hypot(x - s.x, y - s.y); if (dd < r) { const a = Math.atan2(y - s.y, x - s.x); x = s.x + Math.cos(a) * (r + 0.05); y = s.y + Math.sin(a) * (r + 0.05); moved = true; } }
        else if (s.kind === 'box') { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = (x - s.x) * c + (y - s.y) * sn, ly = -(x - s.x) * sn + (y - s.y) * c; if (Math.abs(lx) < s.hx + 0.4 && Math.abs(ly) < s.hy + 0.4) { const ny = (ly >= 0 ? 1 : -1) * (s.hy + 0.45); x = s.x + lx * c - ny * sn; y = s.y + lx * sn + ny * c; moved = true; } }
      }
      if (!moved) break;
    }
    return { x, y, penalty, note };
  }

  /* ---------- planting: a forest that reads like Aurelia ---------- */
  // opts: { age 0..1 (young..ancient), variety 0..1, cb canopy base 0..0.85 (null = the type's own) }
  function addTree(d, type, x, y, R, opts) {
    if (d.trees.length >= MAX_TREES) return false;
    opts = opts || {};
    const t = TYPES.indexOf(type), hv = TS.heightFor(type, opts.age != null ? opts.age : 0.5, opts.variety, R);
    const cb = opts.cb != null ? Math.max(0, Math.min(0.85, opts.cb + (R() - 0.5) * 0.08)) : TS.DEF[type].cb;
    d.trees.push([t, +x.toFixed(2), +y.toFixed(2), +hv.h.toFixed(2), +R().toFixed(3), +(R() * 6.283).toFixed(3), type === 'palm' ? +((R() - 0.5) * 0.6).toFixed(3) : 0, +cb.toFixed(3), +hv.age.toFixed(3)]);
    return true;
  }
  // the type a "mixed" brush plants at a spot: palms low and wet, pines high, broadleaf between
  function mixedType(d, x, y, R) {
    const z = hAt(d, x, y), wet = z < d.water + 6, roll = R();
    if (wet) return roll < 0.55 ? 'palm' : roll < 0.85 ? 'broad' : roll < 0.95 ? 'fern' : 'guardian';
    if (z > d.water + 28) return roll < 0.76 ? 'pine' : roll < 0.97 ? 'broad' : 'guardian';
    return roll < 0.48 ? 'pine' : roll < 0.88 ? 'broad' : roll < 0.95 ? 'bush' : roll < 0.985 ? 'guardian' : 'oak';
  }
  function plantForest(d, seed, opts) {
    const R = rng(seed || 7), S = (opts && opts.spacing) || 5.4;
    for (let y = PLOT.y0 + 2; y <= PLOT.y1 - 2; y += S) for (let x = PLOT.x0 + 2; x <= PLOT.x1 - 2; x += S) {
      const px = x + (R() - 0.5) * S * 0.9, py = y + (R() - 0.5) * S * 0.9;
      if (sAt(d, px, py) !== 0 || hAt(d, px, py) < d.water + 0.3) continue;
      if (Math.hypot(px - d.tee.x, py - d.tee.y) < 16 || Math.hypot(px - d.basket.x, py - d.basket.y) < 6) continue;
      addTree(d, (opts && opts.type) || mixedType(d, px, py, R), px, py, R, opts);
    }
  }
  // paint a fairway corridor along a list of [x, y, halfWidth] points (rough at its edges)
  function corridor(d, pts) {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = wx(i), y = wy(j); let best = 1e9;
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
        const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L2, 0, 1), px = a[0] + vx * t, py = a[1] + vy * t, w = lerp(a[2], b[2], t);
        best = Math.min(best, Math.hypot(x - px, y - py) - w);
      }
      const k = idx(i, j);
      if (best < -5) d.s[k] = 1; else if (best < 2) d.s[k] = 2; else d.s[k] = 0;
    }
  }

  /* ---------- templates ---------- */
  const TEMPLATES = [
    { id: 'meadow', name: 'Open meadow', blurb: 'Gentle rolling grass, no trees. A blank canvas.' },
    { id: 'mountain', name: 'Mountain shoulder', blurb: 'An elevated tee, a forest chute, a long drop to the pin.' },
    { id: 'valley', name: 'River valley', blurb: 'Wooded hills on both sides and a creek to carry.' },
    { id: 'lake', name: 'Lakeshore', blurb: 'Fairway along the water, palms, a peninsula pin.' },
    { id: 'terraces', name: 'The Terraces', blurb: 'A full copy of Aurelia hole 6 to remix.' },
  ];
  function fromTemplate(id, name) {
    const d = blank(name); d.template = id;
    const R = rng(Math.floor(Math.random() * 1e9));
    const seedX = R() * 100, seedY = R() * 100;
    const nz = (x, y, sc) => fbm(x / sc + seedX, y / sc + seedY) - 0.5;
    if (id === 'meadow') {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = wx(i), y = wy(j); d.h[idx(i, j)] = 20 + 3 * nz(x, y, 55) + 0.8 * nz(x, y, 14); }
      corridor(d, [[0, 0, 12], [0, 115, 16]]); for (let k = 0; k < d.s.length; k++) if (d.s[k] === 0) d.s[k] = 2;
      d.basket = { x: 0, y: 110 }; d.par = 3; d.water = 0;
    } else if (id === 'mountain') {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = wx(i), y = wy(j), t = clamp(y / 240, 0, 1), cx = 10 * Math.sin(y / 70), side = Math.abs(x - cx);
        d.h[idx(i, j)] = 75 - 42 * (1 - Math.pow(1 - t, 1.7)) + 0.004 * side * side + 0.12 * side + 4 * nz(x, y, 40) + (y < 0 ? -y * 0.3 : 0);
      }
      corridor(d, [[0, 0, 10], [0, 40, 16], [10 * Math.sin(120 / 70), 120, 24], [10 * Math.sin(230 / 70), 230, 22]]);
      d.basket = { x: Math.round(10 * Math.sin(225 / 70)), y: 225 }; d.par = 4; d.water = 0;
      plantForest(d, 11);
    } else if (id === 'valley') {
      d.water = 22;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = wx(i), y = wy(j), cy = 150 + 14 * Math.sin(x / 30), creek = Math.abs(y - cy);
        let z = 27 - y * 0.012 + 0.0025 * x * x + 3 * nz(x, y, 45);
        if (creek < 9) z = lerp(z, 20.2, ss(9, 3, creek));
        d.h[idx(i, j)] = z;
      }
      corridor(d, [[0, 0, 10], [0, 120, 20], [0, 210, 20]]);
      d.basket = { x: 0, y: 205 }; d.par = 4;
      plantForest(d, 12);
    } else if (id === 'lake') {
      d.water = 20;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = wx(i), y = wy(j), shore = -18 + 14 * Math.sin(y / 45), pen = Math.hypot(x + 28, y - 180);
        let z = 22.5 + 0.06 * Math.max(0, x - shore) + 2 * nz(x, y, 35);
        if (x < shore) z = lerp(z, 16, ss(0, 14, shore - x));
        if (pen < 12) z = Math.max(z, lerp(21.2, 22.4, 1 - pen / 12));
        d.h[idx(i, j)] = z;
      }
      corridor(d, [[0, 0, 10], [8, 90, 18], [0, 160, 16]]);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = wx(i), y = wy(j); if (Math.hypot(x + 28, y - 180) < 11) d.s[idx(i, j)] = 1; }
      d.basket = { x: -28, y: 180 }; d.par = 4;
      plantForest(d, 13);
      // palms along the shore
      for (let y = 0; y < 330; y += 5) { const shore = -18 + 14 * Math.sin(y / 45), px = shore + 3 + R() * 6; if (hAt(d, px, y) > d.water + 0.4 && sAt(d, px, y) !== 1 && R() < 0.6 && Math.hypot(px - d.tee.x, y - d.tee.y) > 16 && Math.hypot(px - d.basket.x, y - d.basket.y) > 8) addTree(d, 'palm', px, y, R); }
    } else if (id === 'terraces') {
      d.water = AW.WATER;
      // centred on the Terraces fairway (the plot is a little smaller than the original world)
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const x = wx(i), y = wy(j), k = idx(i, j), surf = AW.surfaceAt(x, y);
        d.h[k] = AW.H(x, y);
        d.s[k] = surf === 'short_grass_dry' ? 1 : surf === 'medium_grass_wet' ? 2 : surf === 'hardpack_dirt' ? 3 : surf === 'rock_slab' ? 4 : surf === 'flagstone' ? 5 : surf === 'moat_water' ? 3 : 0;
      }
      AW.plants().forEach(p => { if (inPlot(p.x, p.y) && d.trees.length < MAX_TREES) d.trees.push([TYPES.indexOf(p.type), +p.x.toFixed(2), +p.y.toFixed(2), +p.h.toFixed(2), +p.c.toFixed(3), +p.rot.toFixed(3), +(p.lean || 0).toFixed(3), TS.DEF[p.type].cb, 0.5]); });
      AW.solidsFor([]).forEach(b => { if (b.kind === 'box') d.objs.push({ k: 'wall', x: +b.x.toFixed(2), y: +b.y.toFixed(2), len: +(b.hx * 2).toFixed(2), yaw: +b.yaw.toFixed(4), h: b.name === 'pin wall' ? 1.1 : 0.28 }); });
      d.basket = { x: AW.BASKET.x, y: AW.BASKET.y }; d.tee = { x: AW.TEE.x, y: AW.TEE.y }; d.par = 4;
    }
    if (!d.name || d.name === 'New hole') d.name = (TEMPLATES.find(t => t.id === id) || {}).name || 'New hole';
    return d;
  }

  /* ---------- saving: compact text for the store (one document per hole, well under 256 KiB) ---------- */
  function b64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); }
  function unb64(str) { const s = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary'); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  const ST = 9;
  function encode(d) {
    const hq = new Int16Array(d.h.length); for (let k = 0; k < d.h.length; k++) hq[k] = clamp(Math.round(d.h[k] * 50), -32760, 32760);
    const tq = new Int16Array(d.trees.length * ST);
    d.trees.forEach((t, i) => { const o = i * ST; tq[o] = t[0]; tq[o + 1] = Math.round(t[1] * 10); tq[o + 2] = Math.round(t[2] * 10); tq[o + 3] = Math.round(t[3] * 100); tq[o + 4] = Math.round(t[4] * 1000); tq[o + 5] = Math.round(t[5] * 1000); tq[o + 6] = Math.round((t[6] || 0) * 1000); tq[o + 7] = Math.round((t[7] != null ? t[7] : TS.DEF[TYPES[t[0]] || 'pine'].cb) * 1000); tq[o + 8] = Math.round((t[8] != null ? t[8] : 0.5) * 1000); });
    return { v: 2, name: d.name, par: d.par, template: d.template || '', inspired: d.inspired || '', water: d.water, nx: NX, ny: NY, tee: d.tee, basket: d.basket, objs: d.objs,
      h: b64(new Uint8Array(hq.buffer)), s: b64(d.s), t: b64(new Uint8Array(tq.buffer)), nt: d.trees.length, st: ST };
  }
  function decode(e) {
    const d = blank(e.name);
    const hb = unb64(e.h), hq = new Int16Array(hb.buffer, hb.byteOffset, hb.byteLength >> 1);
    for (let k = 0; k < Math.min(hq.length, d.h.length); k++) d.h[k] = hq[k] / 50;
    d.s.set(unb64(e.s).subarray(0, d.s.length));
    const st = e.st || 7, tb = unb64(e.t || ''), tq = new Int16Array(tb.buffer, tb.byteOffset, tb.byteLength >> 1);
    for (let i = 0; i < (e.nt || 0); i++) { const o = i * st, ty = tq[o]; d.trees.push([ty, tq[o + 1] / 10, tq[o + 2] / 10, tq[o + 3] / 100, tq[o + 4] / 1000, tq[o + 5] / 1000, tq[o + 6] / 1000, st > 7 ? tq[o + 7] / 1000 : TS.DEF[TYPES[ty] || 'pine'].cb, st > 8 ? tq[o + 8] / 1000 : 0.5]); }
    d.par = e.par || 3; d.template = e.template || ''; d.inspired = e.inspired || ''; d.water = e.water || 0; d.tee = e.tee || d.tee; d.basket = e.basket || d.basket; d.objs = (e.objs || []).map(o => Object.assign({}, o, o.pts ? { pts: o.pts.map(p => p.slice()) } : {}));
    return d;
  }
  /* ---------- Flightline paths: a lane through the forest ----------
     tunnel: trunks and low limbs cleared, the canopy left as a ceiling at least `clear` metres up
     open:   everything in the lane cleared, fairway down the middle */
  function distToPath(pts, x, y) {
    let best = 1e9, bi = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1;
      const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L2, 0, 1), dd = Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t));
      if (dd < best) { best = dd; bi = k + t; }
    }
    return { d: best, at: bi };
  }
  function pathPoint(pts, at) { const k = Math.min(pts.length - 2, Math.floor(at)), t = at - k, a = pts[k], b = pts[k + 1]; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; }
  function applyPath(d, o) {
    const half = o.w / 2, keep = [], removed = { n: 0 };
    for (const t of d.trees) {
      const type = TYPES[t[0]] || 'pine', p = TS.norm({ type, h: t[3], age: t[8], cb: t[7] }), q = distToPath(o.pts, t[1], t[2]);
      const small = type === 'bush' || type === 'fern';
      if (o.mode === 'open') { if (q.d < half + (small ? 0.8 : p.r * 0.55)) { removed.n++; continue; } }
      else {
        if (q.d < half + (small ? 0.8 : Math.max(0.6, p.tr + 0.4))) { removed.n++; continue; }
        if (!small && q.d < half + p.r) {
          const pp = pathPoint(o.pts, q.at), ground = hAt(d, pp[0], pp[1]), z = hAt(d, t[1], t[2]);
          const need = (ground + o.clear - z) / t[3];
          const top = type === 'pine' ? 0.7 : 0.82;
          if (type === 'palm' || need > top) { removed.n++; continue; }
          if (need > (t[7] != null ? t[7] : p.cb)) t[7] = +Math.min(top, need + 0.02).toFixed(3);
        }
      }
      keep.push(t);
    }
    d.trees = keep;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const q = distToPath(o.pts, wx(i), wy(j)); if (q.d > half) continue;
      const k = idx(i, j), cur = d.s[k];
      if (o.mode === 'open') d.s[k] = q.d < half - 1.5 ? 1 : (cur === 1 ? 1 : 2);
      else if (cur === 0 || cur === 6) d.s[k] = 2;
    }
    return removed.n;
  }

  /* ---------- the hole randomizer: archetypes drawn from famous holes, built Aurelia-style ---------- */
  const ARCHETYPES = [
    { id: 'skyline', name: 'Skyline bomber', inspired: "Inspired by DeLaveaga's Top of the World (hole 27): a tee high above a pin nearly 600 ft away." },
    { id: 'gravity', name: 'Gravity drop', inspired: "Inspired by DeLaveaga's Gravity Hole (hole 17): super short, sloping down and sideways toward a creek bed." },
    { id: 'guardian', name: 'The guardian', inspired: "Inspired by line-owning trees like DeLaveaga's Catcher's Mitt (hole 4), whose tight limbs catch discs." },
    { id: 'fallen', name: 'Fallen giant', inspired: 'An Aurelia original: huge fallen logs ring the pin, so the approach has to land soft.' },
    { id: 'long5', name: 'The long one', inspired: "Inspired by Winthrop Gold's 888 (hole 13), a par 5 named for its 888 ft." },
    { id: 'screen', name: 'The screen', inspired: "Inspired by Winthrop Gold's Bamboo Hole (hole 7), with a fence right in front of the basket." },
    { id: 'island', name: 'Island green', inspired: 'An Aurelia original: carry the water or lay up and pitch on.' },
    { id: 'tunnel', name: 'Flightline tunnel', inspired: 'An Aurelia original: a lane cut through old forest under a ceiling of leaves.' },
    { id: 'ruins', name: 'Temple approach', inspired: 'An Aurelia original: thread the old ruins, a buried pyramid off the line.' },
  ];
  function randomHole(archId, seed) {
    const R = rng(seed || Math.floor(Math.random() * 1e9)), A = ARCHETYPES.find(a => a.id === archId) || ARCHETYPES[Math.floor(R() * ARCHETYPES.length)];
    const d = blank(A.name); d.template = 'random:' + A.id; d.inspired = A.inspired;
    const sx = R() * 100, sy = R() * 100, nz = (x, y, sc) => fbm(x / sc + sx, y / sc + sy) - 0.5;
    const P = { len: 120, drop: 4, side: 0.006, dog: 0, w: 16, wet: false };
    const pick = (a, b) => lerp(a, b, R());
    switch (A.id) {
      case 'skyline': Object.assign(P, { len: pick(170, 190), drop: pick(28, 33), w: pick(14, 19), dog: pick(-20, 20) }); break;
      case 'gravity': Object.assign(P, { len: pick(55, 80), drop: pick(8, 12), w: 12, tilt: pick(0.08, 0.13) }); break;
      case 'guardian': Object.assign(P, { len: pick(100, 140), drop: pick(-3, 6), w: pick(18, 24), dog: pick(-12, 12) }); break;
      case 'fallen': Object.assign(P, { len: pick(90, 125), drop: pick(-2, 5), w: pick(15, 20) }); break;
      case 'long5': Object.assign(P, { len: 270.7, drop: pick(-6, 10), w: pick(14, 20), dog: (R() < 0.5 ? -1 : 1) * pick(25, 45) }); break;
      case 'screen': Object.assign(P, { len: pick(90, 120), drop: pick(0, 6), w: pick(16, 22) }); break;
      case 'island': Object.assign(P, { len: pick(85, 120), drop: pick(0, 4), w: 18, wet: true }); break;
      case 'tunnel': Object.assign(P, { len: pick(110, 150), drop: pick(-4, 8), w: 9, dog: pick(-4, 4) }); break;
      case 'ruins': Object.assign(P, { len: pick(130, 180), drop: pick(0, 10), w: pick(18, 24), dog: pick(-18, 18) }); break;
    }
    const L = P.len, cx = y => P.dog * ss(0.3 * L, 0.85 * L, y) + 3 * Math.sin(y / 37 + sx);
    const base = 30 + P.drop;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x = wx(i), y = wy(j), t = clamp(y / L, 0, 1.2), off = x - cx(y);
      const prof = A.id === 'skyline' ? (1 - Math.pow(1 - clamp(t, 0, 1), 2.4)) : ss(0, 1, t);
      let z = base - P.drop * prof + (y < 0 ? -y * 0.2 : 0) + P.side * off * off + 0.08 * Math.abs(off) + 3.2 * nz(x, y, 45) + 0.9 * nz(x, y, 13);
      if (P.tilt) z -= off * P.tilt;
      d.h[idx(i, j)] = z;
    }
    const bx = cx(L), by = L;
    d.tee = { x: 0, y: 0 }; d.basket = { x: +bx.toFixed(2), y: +by.toFixed(2) };
    corridor(d, [[0, 0, 9], [cx(L * 0.35), L * 0.35, P.w], [cx(L * 0.7), L * 0.7, P.w], [bx, by + 8, P.w * 0.9]]);
    const bz = hAt(d, bx, by);
    // water features
    if (A.id === 'gravity') {
      d.water = bz - 1.2;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = wx(i), y = wy(j), cxx = cx(y) - 16 - 4 * Math.sin(y / 20); if (y > L * 0.3 && Math.abs(x - cxx) < 4.5) { const k = idx(i, j); d.h[k] = Math.min(d.h[k], d.water - 1.2 + Math.abs(x - cxx) * 0.15); d.s[k] = 3; } }
    }
    if (A.id === 'island') {
      d.water = bz - 0.9;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = wx(i), y = wy(j), r = Math.hypot(x - bx, y - by), k = idx(i, j); if (r < 30 && r > 9) { d.h[k] = Math.min(d.h[k], d.water - 1.4); } else if (r <= 9) { d.h[k] = d.water + 0.7 + (9 - r) * 0.05; d.s[k] = 1; } }
    }
    if (A.id === 'long5' && R() < 0.6) {
      d.water = hAt(d, cx(L * 0.55), L * 0.55) - 1;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const x = wx(i), y = wy(j), k = idx(i, j); if (Math.hypot(x - cx(L * 0.55) - P.dog * 0.3, (y - L * 0.55) * 0.6) < 14) d.h[k] = Math.min(d.h[k], d.water - 1.3); }
    }
    // forest: denser and older the deeper you go
    plantForest(d, Math.floor(R() * 1e6), { age: pick(0.4, 0.75), variety: 0.5, spacing: A.id === 'tunnel' ? 4.6 : 5.4 });
    const tree = (type, x, y, age, cb) => { d.trees = d.trees.filter(t => Math.hypot(t[1] - x, t[2] - y) > 7); addTree(d, type, x, y, R, { age, variety: 0.05, cb }); };
    const along = f => [cx(L * f), L * f];
    if (A.id === 'guardian') { const g = along(pick(0.5, 0.65)); tree(R() < 0.5 ? 'oak' : 'guardian', g[0] + pick(-3, 3), g[1], 0.95, R() < 0.5 ? 0.22 : null); for (let k = 0; k < 6; k++) addTree(d, 'bush', g[0] + pick(-9, 9), g[1] + pick(-9, 9), R); }
    if (A.id === 'fallen') { for (let k = 0; k < 3; k++) { const a = -0.8 + k * 1.35 + pick(-0.15, 0.15), rr = pick(6, 8); d.objs.push({ k: 'log', x: +(bx + Math.cos(a + 1.57) * rr).toFixed(2), y: +(by + Math.sin(a + 1.57) * rr).toFixed(2), len: +pick(9, 13).toFixed(1), yaw: +a.toFixed(3), r: +pick(0.9, 1.4).toFixed(2) }); } tree('oak', bx - 14, by + 10, 0.9, 0.2); }
    if (A.id === 'screen') { const yy = by - pick(6, 8); d.objs.push({ k: 'ruin', x: +bx.toFixed(2), y: +yy.toFixed(2), len: 12, yaw: 0, h: 2.4 }); }
    if (A.id === 'skyline') { const g = along(0.45); tree('guardian', g[0] + P.w * 0.7, g[1], 0.9, 0.62); }
    if (A.id === 'tunnel') {
      const pts = []; for (let k = 0; k <= 6; k++) { const f = k / 6, sx2 = Math.sin(f * Math.PI) * pick(-1.5, 1.5); pts.push([+(lerp(0, bx, f * 0.92 + 0.04) + sx2).toFixed(2), +lerp(0, by, f * 0.92 + 0.04).toFixed(2)]); }
      // fill the corridor with forest first, then cut the tunnel through it
      for (let y = 6; y < L - 6; y += 4.4) for (let x = -22; x <= 22; x += 4.4) { const px = cx(y) + x + pick(-1.5, 1.5), py = y + pick(-1.5, 1.5); if (Math.abs(x) > 6) addTree(d, R() < 0.12 ? 'guardian' : R() < 0.6 ? 'broad' : 'pine', px, py, R, { age: 0.75, variety: 0.3, cb: 0.45 }); }
      const o = { k: 'path', pts, w: 10, mode: 'tunnel', clear: 15 }; applyPath(d, o); d.objs.push(o);
    }
    if (A.id === 'ruins') {
      const side = R() < 0.5 ? -1 : 1, p1 = along(0.62);
      d.objs.push({ k: 'pyr', x: +(p1[0] + side * (P.w + 16)).toFixed(2), y: +p1[1].toFixed(2), yaw: +pick(-0.3, 0.3).toFixed(3), s: +pick(9, 13).toFixed(1) });
      const a1 = along(0.4); d.objs.push({ k: 'arch', x: +a1[0].toFixed(2), y: +a1[1].toFixed(2), yaw: 1.5708, w: 6, h: 5.5 });
      for (let k = 0; k < 6; k++) { const f = 0.2 + k * 0.1, q = along(f); d.objs.push({ k: 'col', x: +(q[0] + (k % 2 ? 1 : -1) * (P.w * 0.55)).toFixed(2), y: +q[1].toFixed(2), r: 0.7, h: +(R() < 0.4 ? pick(1.5, 3) : pick(5, 7)).toFixed(1) }); }
      d.objs.push({ k: 'mono', x: +(bx + 6).toFixed(2), y: +(by + 6).toFixed(2), yaw: 1.5708, h: 4.5 });
    }
    // keep the tee and the pin clear
    d.trees = d.trees.filter(t => Math.hypot(t[1] - d.tee.x, t[2] - d.tee.y) > 14 && Math.hypot(t[1] - bx, t[2] - by) > 4);
    d.par = A.id === 'long5' ? 5 : suggestPar(d);
    d.name = A.name;
    return d;
  }

  // par by length: up to 420 ft is a 3, up to 800 a 4, longer a 5
  function suggestPar(d) { const ft = Math.hypot(d.basket.x - d.tee.x, d.basket.y - d.tee.y) / FT; return ft <= 420 ? 3 : ft <= 800 ? 4 : 5; }

  return { TS, ELEMENTS, ARCHETYPES, randomHole, applyPath, distToPath, elementParts, PLOT, NX, NY, SURF, SURF_NAME, TYPES, MAX_TREES, TEMPLATES, idx, gx, gy, wx, wy, blank, clone, hAt, sAt, inPlot, world, fromTemplate, plantForest, addTree, mixedType, encode, decode, suggestPar, crownR, FT };
});
