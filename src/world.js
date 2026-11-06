/* =====================================================================
   AURELIA · HOLE 6 · THE TERRACES  (world model)
   Par 4, about 720 ft, downhill. An elevated stone tee on a forested mountain
   shoulder, a steep chute, three moss-walled terraces, then a tropical basin
   with palms, a plunge pool under a waterfall and a creek behind the pin.

   Units: metres. Frame: x right, y downrange (tee toward basket), z up.
   Same frame as the Flightline flight engine and the DDM Contact engine.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./treespec.js'));
  else root.AureliaWorld = factory(root.TreeSpec);
})(typeof self !== 'undefined' ? self : this, function (TS) {
  'use strict';
  const FT = 0.3048;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function ss(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------- deterministic noise ---------- */
  function hash(i, j) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y) { return (vnoise(x, y) * 0.5 + vnoise(x * 2.03 + 17, y * 2.03 + 5) * 0.25 + vnoise(x * 4.1 + 3, y * 4.1 + 41) * 0.125) / 0.875; }
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- the hole layout ---------- */
  const HOLE = { number: 6, name: 'THE TERRACES', par: 4, biome: 'Forest shoulder to palm basin' };
  const TEE_Z = 62, T1 = 47, T2 = 41.5, T3 = 36, BOT = 30.5, WATER = 29.5;
  const E1 = x => 70 + 3.5 * Math.sin(x / 16 + 1);
  const E2 = x => 113 + 4 * Math.sin(x / 19 + 2.3);
  const E3 = x => 148 + 3 * Math.sin(x / 14 + 0.4);
  const EDGES = [{ f: E1, up: T1, lo: T2 }, { f: E2, up: T2, lo: T3 }, { f: E3, up: T3, lo: BOT }];

  // the playable floor between a left and a right bound; outside it the land climbs into forest
  function leftBound(y) {
    if (y < 4) return -9;
    if (y < 38) return lerp(-9, -22, ss(4, 38, y));
    if (y < 165) return lerp(-22, -32, ss(38, 70, y)) + 3 * Math.sin(y / 23);
    return lerp(-32, -96, ss(165, 210, y));
  }
  function rightBound(y) {
    if (y < 4) return 9;
    if (y < 38) return lerp(9, 22, ss(4, 38, y));
    if (y < 165) return lerp(22, 38, ss(38, 70, y)) + 3 * Math.sin(y / 29 + 1);
    return lerp(38, 46, ss(165, 200, y));
  }
  // the creek: out of a plunge pool under the falls (far left), behind the pin, off to the right
  const POOL = { x: -80, y: 222, r: 12 };
  function creekY(x) { return 222 + 12 * ss(-82, -8, x) + 3 * Math.sin(x / 25) * ss(-60, -20, x); }
  function creekDist(x, y) {
    const dc = Math.abs(y - creekY(x)) - 4.2;
    const dp = Math.hypot(x - POOL.x, y - POOL.y) - POOL.r;
    return Math.min(dc, dp);                                  // < 0 inside water
  }
  const BASKET = { x: 9, y: 219 };
  const TEE = { x: 0, y: 0 };

  // height of the land (not the water surface)
  function H(x, y) {
    let z;
    if (y < -8) z = TEE_Z + 0.35 * (-8 - y);
    else if (y < 5) z = TEE_Z;
    else if (y < 38) { const t = clamp((y - 5) / 33, 0, 1); z = TEE_Z - (TEE_Z - T1) * (1 - Math.pow(1 - t, 2.2)); }   // off the lip: steep first, easing into tier one
    else {
      z = T1;
      for (const e of EDGES) { const E = e.f(x); z -= (e.up - e.lo) * ss(E - 0.9, E + 0.9, y); }
    }
    // gentle undulation on the floor (not on the tee pad)
    const pad = (y > -6 && y < 4 && Math.abs(x) < 5) ? 0 : 1;
    z += pad * (fbm(x / 13, y / 13) - 0.5) * 0.9;
    // the basin past the third wall: the creek bed and the far bank
    if (y > 150) {
      const cd = creekDist(x, y);
      if (cd < 3) z = lerp(z, WATER - 1.6, ss(3, -2, cd));
      const far = y - (creekY(x) + 5);
      if (far > 0 && x > -70) z += 0.06 * far + 0.0009 * far * far;
    }
    // outside the bounds the mountain climbs (left side is the steep one, with a cliff over the pool)
    const L = leftBound(y), R = rightBound(y);
    if (x < L) {
      const d = L - x, steep = y > 175 ? 1.6 : 0.5;
      z += steep * d * ss(0, 9, d) + 0.004 * d * d + 3.5 * fbm(x / 21, y / 21) * ss(0, 20, d);
    } else if (x > R) {
      const d = x - R;
      z += 0.34 * d * ss(0, 9, d) + 0.003 * d * d + 3.5 * fbm(x / 23 + 9, y / 23) * ss(0, 20, d);
    }
    return z;
  }
  // what a disc touches: the land, or the water surface over the creek and pool
  function G(x, y) { return Math.max(H(x, y), WATER); }
  function isWater(x, y) { return H(x, y) < WATER - 0.02; }
  function outside(x, y) { const L = leftBound(y), R = rightBound(y); return x < L ? L - x : x > R ? x - R : -Math.min(x - L, R - x); }

  function surfaceAt(x, y) {
    if (isWater(x, y)) return 'moat_water';
    if (Math.abs(x) < 3.4 && y > -4.5 && y < 3.5) return 'flagstone';
    const d = outside(x, y);
    if (y > 30 && y < 160 && d < 6) for (const e of EDGES) if (Math.abs(y - e.f(x)) < 1.0) return 'rock_slab';
    if (H(x, y) < WATER + 0.55) return 'hardpack_dirt';
    if (d < -4) return 'short_grass_dry';
    if (d < 3) return 'medium_grass_wet';
    return 'deep_grass';
  }

  /* ---------- trees, palms, bushes ---------- */
  // each plant: { type, x, y, z (ground), h, r (crown), lean, c (colour jitter 0..1), solid (bool) }
  function plants() {
    const out = [], R = rng(606);
    const S = 5.2;
    for (let gx = -150; gx <= 175; gx += S) for (let gy = -50; gy <= 330; gy += S) {
      const x = gx + (R() - 0.5) * S * 0.9, y = gy + (R() - 0.5) * S * 0.9;
      const d = outside(x, y), z = H(x, y), roll = R();
      if (d < 3) continue;                                         // the fairway stays open (feature trees are placed by hand)
      if (creekDist(x, y) < 2.5 || z < WATER + 0.25) continue;
      if (Math.hypot(x, y + 4) < 20) continue;                    // the tee clearing (and room for the camera behind it)
      if (d > 75 && roll < 0.35) continue;                        // far forest a little thinner (it is decor up there)
      const tropical = (y > 158 && z < 44) || (y > 150 && x < -35);
      let type;
      if (tropical) type = roll < 0.58 ? 'palm' : (roll < 0.9 ? 'broad' : 'fern');
      else if (z > 58) type = roll < 0.8 ? 'pine' : 'broad';
      else type = roll < 0.55 ? 'pine' : 'broad';
      const big = 1 + Math.min(0.6, d * 0.012) + (fbm(x / 40, y / 40) - 0.5) * 0.6;
      const h = type === 'pine' ? (15 + R() * 10) * big : type === 'broad' ? (10 + R() * 7) * big : type === 'palm' ? 9 + R() * 8 : 2 + R() * 1.5;
      out.push({ type, x, y, z, h, r: type === 'pine' ? h * 0.24 : type === 'broad' ? h * 0.34 : type === 'palm' ? 3 + R() * 1.4 : 1.4 + R(), lean: (R() - 0.5) * 0.5, rot: R() * 6.283, c: R(), solid: d < 70 });
    }
    // hand placed feature trees that shape the lines
    const feat = [
      ['broad', -13, 54, 17], ['broad', 18, 60, 12],            // tier 1: a big oak left, a smaller one right
      ['pine', 11, 96, 27],                                       // tier 2: the lone giant
      ['broad', -12, 129, 14], ['broad', 22, 138, 13],            // tier 3: a pair framing the gap
      ['palm', -6, 205, 14], ['palm', -9.5, 211, 12], ['palm', -3, 213, 15], ['palm', 25, 200, 13],   // palms by the pin
      ['palm', 30, 226, 12], ['palm', -24, 228, 13],
    ];
    feat.forEach(f => out.push({ type: f[0], x: f[1], y: f[2], z: H(f[1], f[2]), h: f[3], r: f[0] === 'pine' ? f[3] * 0.24 : f[0] === 'broad' ? f[3] * 0.36 : 3.6, lean: f[0] === 'palm' ? (f[1] < BASKET.x ? -0.35 : 0.3) : 0, rot: f[1] * 1.7, c: 0.5, solid: true, feature: true }));
    // bushes and ferns along every fairway edge: lush, and they grab low discs
    for (let gy = -10; gy <= 300; gy += 2.6) for (const side of [-1, 1]) {
      if (R() < 0.35) continue;
      const edge = side < 0 ? leftBound(gy) : rightBound(gy);
      const x = edge + side * (-2 + R() * 9), y = gy + (R() - 0.5) * 2;
      if (creekDist(x, y) < 1.5 || H(x, y) < WATER + 0.3) continue;
      if (Math.hypot(x, y + 4) < 14) continue;
      const tropical = y > 158;
      out.push({ type: tropical && R() < 0.5 ? 'fern' : 'bush', x, y, z: H(x, y), h: 1.2 + R() * 1.4, r: 1.0 + R() * 1.1, lean: 0, rot: R() * 6.283, c: R(), solid: true });
    }
    return out.map(p => TS.norm(p));
  }

  // how far a palm's crown sits out from its base, as a fraction of its height (the game draws the same curve)
  const palmLean = TS.palmLean;
  // the physics bodies for the plants and the stone walls
  function solidsFor(list) {
    const S = [];
    for (const p of list) { if (p.solid) TS.solids(p).forEach(o => S.push(o)); }
    // the moss walls: a stone face at every terrace edge with a lip above the upper tier
    for (const e of EDGES) {
      const y0 = e.f(0), L = leftBound(y0) - 8, R = rightBound(y0) + 8;
      for (let x = L; x < R; x += 4) {
        const xm = x + 2, E = e.f(xm), slope = (e.f(xm + 0.5) - e.f(xm - 0.5));
        S.push({ kind: 'box', x: xm, y: E, hx: 2.15, hy: 0.55, yaw: Math.atan(slope), z0: e.lo - 0.4, z1: e.up + 0.28, mat: 'stone', name: 'moss wall' });
      }
    }
    // the low moss wall the pin is tucked against (right side, behind)
    for (let i = 0; i < 3; i++) S.push({ kind: 'box', x: BASKET.x + 0.5 + i * 3.6, y: BASKET.y + 4.4 + i * 0.3, hx: 1.85, hy: 0.45, yaw: 0.08, z0: H(BASKET.x + i * 3.6, BASKET.y + 4.4) - 0.3, z1: H(BASKET.x + i * 3.6, BASKET.y + 4.4) + 1.1, mat: 'stone', name: 'pin wall' });
    return S;
  }

  /* ---------- the lie ---------- */
  const DROP = { x: BASKET.x - 2, y: BASKET.y - 5 };                // drop zone for a disc in the creek
  function inBounds(x, y) { return y > -25 && y < 300 && x > leftBound(y) - 70 && x < rightBound(y) + 70; }
  function fixLie(rest, prev, solids) {
    let x = rest.x, y = rest.y, note = null, penalty = 0;
    if (!inBounds(x, y)) return { x: prev.x, y: prev.y, penalty: 1, note: 'Out of bounds. Rethrow from your lie' };
    if (isWater(x, y)) {
      // nearest dry spot on the line back toward the previous lie
      const dx = prev.x - x, dy = prev.y - y, L = Math.hypot(dx, dy) || 1;
      let k = 0; while (k < L && isWater(x + dx / L * k, y + dy / L * k)) k += 0.5;
      x += dx / L * (k + 1.2); y += dy / L * (k + 1.2); penalty = 1; note = 'In the creek. One stroke, play from the bank';
    }
    // never stand inside a trunk or a wall
    for (let it = 0; it < 6; it++) {
      let moved = false;
      for (const s of solids) {
        if (s.kind === 'cyl') { const d = Math.hypot(x - s.x, y - s.y); if (d < s.r + 0.5) { const a = Math.atan2(y - s.y, x - s.x); x = s.x + Math.cos(a) * (s.r + 0.55); y = s.y + Math.sin(a) * (s.r + 0.55); moved = true; } }
        else if (s.kind === 'box') { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = (x - s.x) * c + (y - s.y) * sn, ly = -(x - s.x) * sn + (y - s.y) * c; if (Math.abs(lx) < s.hx + 0.4 && Math.abs(ly) < s.hy + 0.4) { const ny = (ly >= 0 ? 1 : -1) * (s.hy + 0.45); x = s.x + lx * c - ny * sn; y = s.y + lx * sn + ny * c; moved = true; } }
      }
      if (!moved) break;
    }
    return { x, y, penalty, note };
  }

  // what the renderer needs to frame this world
  const bounds = { x0: -178, x1: 198, y0: -72, y1: 348 }, SCATTER = { y0: -12, y1: 288 };
  const PATH = [[0, 3], [0, 32], [-3, 58], [0, 86], [3, 112], [4, 132], [6, 160], [8, 196], [9, 216]];
  const WATERBOX = { x0: -112, x1: 200, y0: 196, y1: 252 }, FALLS = true;
  const INTRO = [
    [[-55, -55, 120], [5, 120, 40]], [[-30, 30, 96], [4, 150, 36]], [[30, 110, 70], [6, 210, 31]],
    [[38, 190, 48], [9, 219, 31]], [[18, 250, 42], [6, 200, 32]], [[8, 262, 50], [0, 60, 48]],
  ];
  HOLE.title = 'The Terraces'; HOLE.blurb = 'Bomb it off the mountain. Three moss walls down, a creek behind the pin.';
  return { bounds, SCATTER, PATH, WATERBOX, FALLS, INTRO, palmLean, HOLE, TEE, BASKET, DROP, POOL, WATER, EDGES, TEE_Z, H, G, isWater, surfaceAt, outside, leftBound, rightBound, creekY, creekDist, plants, solidsFor, fixLie, inBounds, fbm, rng, ss, FT };
});
