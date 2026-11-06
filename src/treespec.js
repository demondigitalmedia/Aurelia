/* =====================================================================
   AURELIA · TREE SPEC  (one description of every tree, used by the physics and the renderer)

   A tree: { type, x, y, z (ground), h (height m), cb (canopy base: the share of the height that is
   bare trunk, 0..0.85), age (0 young .. 1 ancient: girth and crown), c (colour 0..1), rot, lean }.
   From those: base = h * cb (where the leaves start), crown radius r, trunk radius tr.
   High canopy base = open underneath: a disc flies under the leaves and only the trunk is in the way.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TreeSpec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TYPES = ['pine', 'broad', 'palm', 'bush', 'fern', 'guardian', 'oak'];
  // height range (young..ancient), default canopy base, crown width (share of height), trunk girth (share of height)
  const DEF = {
    pine: { h: [11, 30], cb: 0.12, rW: 0.24, tK: 0.018, name: 'Pine' },
    broad: { h: [8, 21], cb: 0.36, rW: 0.34, tK: 0.03, name: 'Broadleaf' },
    palm: { h: [8, 18], cb: 0.9, rW: 0, tK: 0.016, name: 'Palm' },
    bush: { h: [1.0, 2.8], cb: 0, rW: 0, tK: 0, name: 'Bush' },
    fern: { h: [1.2, 2.6], cb: 0, rW: 0, tK: 0, name: 'Fern' },
    guardian: { h: [28, 52], cb: 0.55, rW: 0.33, tK: 0.034, name: 'Guardian' },
    oak: { h: [13, 27], cb: 0.28, rW: 0.6, tK: 0.058, name: 'Ancient oak' },
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function heightFor(type, age, variety, R) {
    const d = DEF[type] || DEF.pine, v = (variety == null ? 0.35 : variety);
    const a = clamp(age + (R() - 0.5) * v, 0, 1);
    return { h: lerp(d.h[0], d.h[1], a) * (1 + (R() - 0.5) * v * 0.25), age: a };
  }
  function palmLean(p) { return 0.16 + Math.abs(p.lean || 0) * 0.55; }
  // fill in the derived sizes on a tree object (in place) and return it
  function norm(p) {
    const d = DEF[p.type] || DEF.pine;
    if (p.age == null) p.age = 0.5;
    if (p.cb == null) p.cb = d.cb;
    p.cb = clamp(p.cb, 0, p.type === 'pine' ? 0.7 : 0.85);
    if (p.type === 'palm') p.r = 3 + (p.h - 9) * 0.12;
    else if (p.type === 'bush' || p.type === 'fern') p.r = p.r || (0.6 + p.h * 0.45);
    else p.r = d.rW * p.h * (0.85 + 0.3 * p.age);
    p.tr = d.tK * p.h * (0.7 + 0.6 * p.age);
    p.base = p.h * p.cb; p.crownH = p.h - p.base;
    return p;
  }
  // the physics bodies: a hard trunk, limbs that give, and a porous crown only where the leaves are
  function solids(p) {
    norm(p);
    const S = [], z = p.z;
    if (p.type === 'pine') {
      S.push({ kind: 'cyl', x: p.x, y: p.y, r: Math.max(0.2, p.tr), z0: z - 0.3, z1: z + p.h * 0.92, mat: 'bark_core', name: 'pine trunk' });
      S.push({ kind: 'blob', x: p.x, y: p.y, z: z + p.base + p.crownH * 0.32, r: p.r, squash: Math.max(0.35, p.crownH * 0.36 / p.r), density: 0.62, mat: 'leaves', name: 'pine boughs' });
      S.push({ kind: 'blob', x: p.x, y: p.y, z: z + p.base + p.crownH * 0.74, r: p.r * 0.58, squash: Math.max(0.35, p.crownH * 0.28 / (p.r * 0.58)), density: 0.55, mat: 'leaves', name: 'pine top' });
    } else if (p.type === 'broad' || p.type === 'guardian' || p.type === 'oak') {
      const nm = p.type === 'guardian' ? 'guardian' : p.type === 'oak' ? 'ancient oak' : 'tree';
      S.push({ kind: 'cyl', x: p.x, y: p.y, r: Math.max(0.22, p.tr), z0: z - 0.3, z1: z + p.base + p.crownH * 0.28, mat: 'bark_core', name: nm + ' trunk' });
      S.push({ kind: 'blob', x: p.x, y: p.y, z: z + p.base + p.crownH * 0.52, r: p.r, squash: Math.max(0.3, p.crownH * 0.5 / p.r), density: p.type === 'guardian' ? 0.48 : 0.52, mat: 'leaves', name: nm + ' canopy' });
      // big limbs out of the trunk top: they knock a disc around inside the crown
      const n = p.type === 'oak' ? 4 : p.type === 'guardian' ? 3 : 0;
      for (let k = 0; k < n; k++) {
        const a = p.rot + k * 6.283 / n, L = p.r * (p.type === 'oak' ? 0.75 : 0.55);
        S.push({ kind: 'capsule', a: { x: p.x, y: p.y, z: z + p.base * 0.95 }, b: { x: p.x + Math.cos(a) * L, y: p.y + Math.sin(a) * L, z: z + p.base + p.crownH * (p.type === 'oak' ? 0.22 : 0.35) }, r: Math.max(0.15, p.tr * 0.38), mat: 'branch', name: nm + ' limb' });
      }
    } else if (p.type === 'palm') {
      const L = palmLean(p), tx = p.x + Math.cos(p.rot) * L * p.h, ty = p.y + Math.sin(p.rot) * L * p.h;
      S.push({ kind: 'capsule', a: { x: p.x, y: p.y, z: z }, b: { x: tx, y: ty, z: z + p.h }, r: 0.24, mat: 'bark_core', name: 'palm trunk' });
      S.push({ kind: 'blob', x: tx, y: ty, z: z + p.h, r: p.r, squash: 0.42, density: 0.35, mat: 'leaves', name: 'palm fronds' });
    } else {
      S.push({ kind: 'blob', x: p.x, y: p.y, z: z + p.h * 0.45, r: p.r, squash: 0.6, density: 0.55, mat: 'bush_leaves', name: p.type === 'fern' ? 'ferns' : 'bush' });
    }
    return S;
  }
  return { TYPES, DEF, heightFor, norm, solids, palmLean };
});
