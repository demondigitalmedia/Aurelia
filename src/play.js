/* =====================================================================
   AURELIA · PLAY  (throws on the hole, shared by the game and the tests)
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'));
  else root.AureliaPlay = factory(root.AureliaWorld);
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';
  const FT = 0.3048;

  // invented discs (no real molds ship with the game); flight numbers speed|glide|turn|fade
  const DISCS = [
    { id: 'peanut', name: 'Peanut Putter', short: 'PEANUT', nums: [2, 4, 0, 0], color: 0xD9A35E, launch: 6 },
    { id: 'jelly', name: 'Jelly Putter', short: 'JELLY', nums: [3, 4, 0, 1], color: 0xE23A6A, launch: 7 },
    { id: 'mid', name: 'Midrange', short: 'MID', nums: [5, 5, 0, 1], color: 0xC9A0FF, launch: 8 },
    { id: 'fairway', name: 'Fairway', short: 'FAIRWAY', nums: [7, 5, -1, 2], color: 0x5FD0C8, launch: 9 },
    { id: 'control', name: 'Control Driver', short: 'CONTROL', nums: [9, 5, -1, 2], color: 0x7BC86A, launch: 10 },
    { id: 'bomber', name: 'Bomber', short: 'BOMBER', nums: [12, 5, -1, 3], color: 0xF2A13B, launch: 10 },
    { id: 'rocket', name: 'Rocket', short: 'ROCKET', nums: [14, 5, -2, 3], color: 0xFF6A4D, launch: 10.5 },
  ];
  const BASE_N = DISCS.length;
  // your own discs: a name and four flight numbers, flown by the same physics as the stock bag
  function launchForSpeed(sp) { return sp >= 11 ? 10.5 : sp >= 9 ? 10 : sp >= 6 ? 9 : sp >= 4 ? 8 : 6.5; }
  function cleanDisc(c, i) {
    const n = (c.nums || []).map(Number), cl = (v, a, b, def) => isFinite(v) ? Math.max(a, Math.min(b, v)) : def;
    const nums = [cl(n[0], 1, 14, 7), cl(n[1], 1, 7, 5), cl(n[2], -5, 1, 0), cl(n[3], 0, 5, 1)];
    const name = String(c.name || 'My disc').slice(0, 24);
    return { id: c.id || ('mine' + i), name, short: name.toUpperCase().slice(0, 12), nums, color: +c.color || 0x9ad0ff, launch: launchForSpeed(nums[0]), mine: true };
  }
  function setCustom(list) { DISCS.length = BASE_N; (list || []).slice(0, 20).forEach((c, i) => DISCS.push(cleanDisc(c, i))); return DISCS; }
  function customList() { return DISCS.slice(BASE_N).map(d => ({ id: d.id, name: d.name, nums: d.nums.slice(), color: d.color })); }
  const discOf = d => ({ speed: d.nums[0], glide: d.nums[1], turn: d.nums[2], fade: d.nums[3] });
  // the bag for a lie: the longer the throw, the faster the disc
  function discForDist(m) { return m > 150 ? 5 : m > 100 ? 4 : m > 60 ? 3 : m > 22 ? 2 : 0; }
  const spinFor = mph => 300 + 16 * mph;
  const WIND = { x: 2.6, y: -1.4 };                         // mph, a breeze up out of the basin toward the tee, a little right
  const MAX_SOLVE_MPH = 80, MAX_MPH = 96;
  const RELEASE_FT = 4.6;
  function launchFor(d, distM) { return distM < 22 ? Math.max(4, d.launch - 2) : d.launch; }

  let ALL = null, PLANTS = null;
  // the game plays whatever hole it is handed (the Terraces, or one you built)
  function setWorld(w) { W = w; ALL = null; PLANTS = null; }
  function world() {
    if (!ALL) { PLANTS = W.plants(); ALL = W.solidsFor(PLANTS); }
    return { plants: PLANTS, solids: ALL };
  }
  // only the bodies the disc could reach from this lie, moved into the throw's frame
  function solidsNear(lie, aimDeg, zg) {
    const out = [], ax = Math.sin(aimDeg * Math.PI / 180), ay = Math.cos(aimDeg * Math.PI / 180);
    for (const s of world().solids) {
      const sx = s.kind === 'capsule' ? s.a.x : s.x, sy = s.kind === 'capsule' ? s.a.y : s.y;
      const dx = sx - lie.x, dy = sy - lie.y, d = Math.hypot(dx, dy);
      if (d > 300) continue;
      if (d > 30 && (dx * ax + dy * ay) / d < 0.15) continue;      // well behind or beside the thrower
      const r = Object.assign({}, s);
      if (s.kind === 'capsule') { r.a = { x: s.a.x - lie.x, y: s.a.y - lie.y, z: s.a.z - zg }; r.b = { x: s.b.x - lie.x, y: s.b.y - lie.y, z: s.b.z - zg }; }
      else { r.x = s.x - lie.x; r.y = s.y - lie.y; if (s.z != null) r.z = s.z - zg; if (s.z0 != null) { r.z0 = s.z0 - zg; r.z1 = s.z1 - zg; } }
      out.push(r);
    }
    return out;
  }

  // E: { P: FlightlinePhysics, FB: FlightlineBasket, CT: DDMContact, MATS: DDMMaterials }
  // t: { disc, armSpeed, hyzer, nose (degrees against the horizon), launchAngle, aim }
  function throwFrom(E, lie, t, seed) {
    const d = DISCS[t.disc], zg = W.G(lie.x, lie.y);
    const dist = Math.hypot(W.BASKET.x - lie.x, W.BASKET.y - lie.y);
    const arm = Math.max(5, Math.min(MAX_MPH, t.armSpeed));
    const sim = {
      disc: discOf(d), hand: 'RHBH', armSpeed: arm, spin: spinFor(arm),
      hyzer: t.hyzer, nose: t.nose, launchAngle: t.launchAngle, aim: t.aim,
      releaseHeight: RELEASE_FT, windVec: WIND, gust: 0.35, seed: seed,
      groundFt: (x, y) => (W.G(lie.x + x * FT, lie.y + y * FT) - zg) / FT,
      collider: E.FB.createCatcher({ base: { x: W.BASKET.x - lie.x, y: W.BASKET.y - lie.y, z: W.H(W.BASKET.x, W.BASKET.y) - zg }, mount: 'ground' }),
      contact: E.CT.create({ materials: E.MATS, solidMaterials: E.MATS.solids, solids: solidsNear(lie, t.aim, zg), surfaceAt: (x, y) => W.surfaceAt(x + lie.x, y + lie.y), noTombstone: dist < 22, seed: seed || 7 }),
    };
    const rec = E.P.simulate(sim);
    rec.origin = { x: lie.x, y: lie.y, z: zg };
    let li = rec.samples.length - 1; for (let i = rec.samples.length - 1; i >= 0; i--) if (!rec.samples[i].post) { li = i; break; }
    const L = rec.samples[li];
    rec.rest = { x: L.x * FT + lie.x, y: L.y * FT + lie.y, z: L.z * FT + zg };
    rec.arm = arm; rec.discIndex = t.disc;
    rec.made = !!(rec.catchResult && rec.catchResult.outcome === 'made');
    return rec;
  }

  /* ---------- the solve: the clean flat line from the lie to the reticle ----------
     A spot on the ground: the arm speed whose first landing is that spot (on the real slopes, with the wind).
     A spot in the air (the chains, a gap): the arm speed that passes through it at that height.
     Fixed launch for the disc; the aim is walked in until the line is on the spot. Trees are ignored here:
     the solve is the line you asked for, the forest decides what happens to it. */
  function solveTo(E, lie, discIndex, target) {
    const d = DISCS[discIndex], zg = W.G(lie.x, lie.y);
    const tx = target.x - lie.x, ty = target.y - lie.y, dist = Math.max(0.5, Math.hypot(tx, ty));
    const bd = Math.hypot(W.BASKET.x - lie.x, W.BASKET.y - lie.y);
    const la = launchFor(d, bd), nose = la - 2;
    const groundFt = (x, y) => (W.G(lie.x + x * FT, lie.y + y * FT) - zg) / FT;
    const direct = Math.atan2(tx, ty) * 180 / Math.PI;
    // the cleanest line: flat first; if the disc has to be aimed well off the target (it turns or fades hard,
    // or can't get there flat) try it with some hyzer and keep the release that flies straightest
    let best = null;
    for (const hz of [0, -6, 6, -12, 12, -18]) {
      const r = solveWith(hz);
      const score = Math.abs(r.aim - direct) + (r.outOfReach ? 40 : 0) + Math.abs(hz) * 0.08;
      if (!best || score < best.score) best = Object.assign(r, { score });
      if (!r.outOfReach && Math.abs(r.aim - direct) < 4) break;
    }
    delete best.score; return best;
    function solveWith(hz) {
    let aim = direct;
    const run = (mph) => {
      const r = E.P.simulate({ disc: discOf(d), hand: 'RHBH', armSpeed: mph, spin: spinFor(mph), hyzer: hz, nose, launchAngle: la, aim, releaseHeight: RELEASE_FT, windVec: WIND, gust: 0, seed: 1, groundFt });
      const ux = tx / dist, uy = ty / dist;
      let prev = null, zAt = null, lat = 0, land = 0, latEnd = 0;
      for (const s of r.samples) {
        const x = s.x * FT, y = s.y * FT, along = x * ux + y * uy; land = along; latEnd = x * uy - y * ux;
        if (zAt === null && along >= dist) {
          let k = 1, q = s;
          if (prev) { const pa = prev.x * FT * ux + prev.y * FT * uy; k = (dist - pa) / ((along - pa) || 1); q = prev; }
          const lx = (q.x + (s.x - q.x) * k) * FT, ly = (q.y + (s.y - q.y) * k) * FT; zAt = (q.z + (s.z - q.z) * k) * FT + zg; lat = lx * uy - ly * ux;
        }
        prev = s;
      }
      return { zAt, lat: zAt === null ? latEnd : lat, land, latEnd };
    };
    let lo = 6, hi = MAX_SOLVE_MPH, r = null;
    for (let i = 0; i < 13; i++) {
      const mid = (lo + hi) / 2; r = run(mid);
      if (target.air) { if (r.zAt === null || r.zAt < target.z) lo = mid; else hi = mid; aim += Math.atan2(-r.lat, dist) * 180 / Math.PI * 0.8; }
      else { if (r.land < dist) lo = mid; else hi = mid; aim += Math.atan2(-r.latEnd, Math.max(dist, r.land)) * 180 / Math.PI * 0.8; }
    }
    const mph = (lo + hi) / 2;
    return { disc: discIndex, armSpeed: mph, launchAngle: la, nose, aim, hyzer: hz, outOfReach: hi >= MAX_SOLVE_MPH - 0.5 };
    }
  }

  // a short read of what happened, for the toast after each throw
  function readThrow(rec, E) {
    const ev = rec.events || [], tags = [];
    const has = t => ev.some(e => e.type === t);
    if (rec.made) tags.push('IN THE CHAINS');
    if (has('brush')) tags.push('Through the leaves');
    if (has('hung')) tags.push('Hung up in a tree');
    if (ev.some(e => e.type === 'bounce' && /wall/.test(e.name || ''))) tags.push('Off the moss wall');
    else if (ev.some(e => e.type === 'bounce' && /trunk/.test(e.name || ''))) tags.push('Tree kick');
    const c = rec.contact || {};
    if (c.skips) tags.push(c.skips > 1 ? c.skips + ' skips' : 'Skip');
    if (c.final === 'roll') tags.push('Roller');
    if (c.final === 'stuck' && !has('splash')) tags.push('TOMBSTONE');
    if (has('splash')) tags.push('Splash');
    const cr = rec.catchResult && rec.catchResult.outcome;
    if (!rec.made && cr && cr !== 'miss' && cr !== 'none' && E && E.FB) tags.push(E.FB.LABEL[cr]);
    return tags;
  }

  return { setWorld, setCustom, customList, cleanDisc, BASE_N, discOf, DISCS, discForDist, spinFor, launchFor, WIND, MAX_MPH, world, solidsNear, throwFrom, solveTo, readThrow };
});
