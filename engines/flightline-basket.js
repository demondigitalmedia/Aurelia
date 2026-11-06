/* =====================================================================
   FLIGHTLINE · BASKET + CATCH ENGINE  v2.1  (shared by the Flight Lab and Putt League)

   One file defines the basket (its real dimensions), simulates its chains, and
   decides whether a disc is caught. Both games import it unchanged, so a putt
   behaves the same everywhere.

   The basket follows a current top-tier pro design:
     28 chains in three rings (14 outer, 7 middle, 7 inner), 22 in chain rack with
     a 4 in band, 65 cm inside tray about 22 cm deep, tray top 80.8 cm off the
     ground, 50.8 cm target zone, 1 7/8 in pole.
   Sources: PDGA target certification listings and the manufacturer spec sheet
   for that model. Chain mass, link size and collar height are our estimates.
   Cross-check (v2.0, 2026-10-12): the PDGA certification listing for the DGA Mach X
   gives tray inside diameter 66.5 cm, height above ground 79.0 cm, target zone 50.0 cm,
   deflection assembly max width 56.0 cm (https://www.pdga.com/node/257161). Our numbers
   sit within 2 cm of every one of those.

   The disc is the same size here and on screen: DISC.R is a 21.1 cm putter. The app
   builds its disc mesh from DISC.R, so what you see is exactly what the chains feel.

   Mounts (v2.0): 'ground' (standard pole into the ground), 'hang' (hung from above: the
   pole starts at the tray), 'pole' and 'platform' (base raised; the app adds the support
   below as a Contact solid). base.z can be any height.

   How a catch is decided: nothing is scripted. Each chain is a strand of linked
   particles that swings under gravity. The disc is a spinning rigid body. Every
   contact (chain, pole, band, tray, cage) trades momentum through impulses with
   restitution and friction, including the disc's spin rubbing against what it hits.
   The result (made, chain out, spit through, band, pole, cage, miss) is read from
   where the disc ends up and what it touched.

   Units: metres, seconds, kilograms. Frame: x right, y downrange, z up (same axes
   as the flight engine, metres instead of feet).
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightlineBasket = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const IN = 0.0254;

  /* ---------- the basket ---------- */
  const SPEC = {
    poleR: 1.875 * IN / 2,          // 1 7/8 in pole
    poleTop: 1.47,                  // pole and cap top
    poleBottomZ: 0,                 // where the pole starts (raised for hanging baskets)
    trayR: 0.325,                   // 65 cm inside diameter
    trayTopZ: 0.808,                // tray top above ground
    trayDepth: 0.224,               // 22.4 cm deep
    rodR: 0.0048,                   // 3/8 in rod
    bandR: 22 * IN / 2,             // 22 in chain rack
    bandH: 4 * IN,                  // 4 in band
    targetZone: 0.508,              // tray top to bottom of the band
    lidRise: 0.045,                 // shallow dome over the band
    collarZ: 0.86,                  // where the chains gather at the pole (estimate)
    collarR: 0.055,
    rings: [                        // count, radius at the rack, length (slack included), angular offset (fraction of a gap)
      { count: 14, rTop: 0.262, len: 0.528, off: 0.0 },
      { count: 7, rTop: 0.185, len: 0.497, off: 0.5 },
      { count: 7, rTop: 0.108, len: 0.474, off: 0.0 },
    ],
    segments: 7,                    // links simulated per chain
    linkR: 0.006,                   // contact radius of a 2/0 chain (estimate)
    chainKgPerM: 0.30,              // 2/0 galvanized chain (estimate)
  };
  SPEC.trayBottomZ = SPEC.trayTopZ - SPEC.trayDepth;
  SPEC.bandBottomZ = SPEC.trayTopZ + SPEC.targetZone;
  SPEC.bandTopZ = SPEC.bandBottomZ + SPEC.bandH;

  /* ---------- catch settings (the "accuracy settings" both games share) ---------- */
  const CATCH = {
    chainRestitution: 0.04,   // chains barely bounce
    chainFriction: 0.8,       // steel on plastic, rubbing along the links (v2.1: up from 0.55)
    chainDamping: 2.6,        // links grinding on each other (1/s)
    poleRestitution: 0.38, poleFriction: 0.25,
    bandRestitution: 0.42, bandFriction: 0.3,
    trayRestitution: 0.22, trayFriction: 0.5,
    iterations: 3,            // chain link constraint passes per substep
    substeps: 8,              // finer steps while the disc is near the basket
    restSpeed: 0.22,          // m/s: below this inside the tray for restTime counts as made
    restTime: 0.18,
    // v2.1 the chain pack: 28 strands of linked chain are a tangle, not 28 separate ropes. Inside the
    // chain cylinder, after the disc has met chains, the pack soaks up its horizontal speed (a drag,
    // 1/s) that grows from the top of the chains (stiff, near the rack, least forgiving) to the
    // bottom (gathered near the pole, most forgiving), and grows toward the pole. It also bleeds
    // upward speed, so a disc in the pack settles down into the tray.
    chainDragTop: 14, chainDragBottom: 40, chainDragCore: 0.45, chainOutSoak: 3, spinGrip: 0.05, chainVRef: 9,
  };

  /* ---------- disc body (matches the flight engine) ---------- */
  const DISC = { mass: 0.172, R: 0.1055, T: 0.02, inertiaK: 0.62 };
  DISC.Ispin = DISC.inertiaK * DISC.mass * DISC.R * DISC.R;
  DISC.Iperp = DISC.Ispin * 0.5;

  /* ---------- small vector helpers on plain objects ---------- */
  const v3 = (x, y, z) => ({ x, y, z });
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };

  /* ---------- chain layout and resting shape ---------- */
  function strandDefs(spec) {
    const defs = [];
    spec.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.count; i++) {
        const a = (i + ring.off) / ring.count * Math.PI * 2;
        const ac = a + 0.08 * (ri + 1);            // bottoms gather slightly rotated, as on real baskets
        defs.push({
          ring: ri, len: ring.len,
          top: v3(Math.cos(a) * ring.rTop, Math.sin(a) * ring.rTop, spec.bandBottomZ + 0.01),
          bot: v3(Math.cos(ac) * spec.collarR, Math.sin(ac) * spec.collarR, spec.collarZ),
        });
      }
    });
    return defs;
  }
  const restCache = new Map();
  function buildChains(spec, params) {
    const defs = strandDefs(spec), N = spec.segments, P = N + 1;
    const n = defs.length * P;
    const x = new Float64Array(n * 3), xp = new Float64Array(n * 3), pin = new Uint8Array(n), seg = new Float64Array(defs.length);
    defs.forEach((d, s) => {
      seg[s] = d.len / N;
      for (let k = 0; k < P; k++) {
        const f = k / N, i = (s * P + k) * 3;
        // start with a gentle outward bow so the chain settles into its natural hang
        const bow = Math.sin(f * Math.PI) * 0.06, rx = (d.top.x + d.bot.x) / 2, ry = (d.top.y + d.bot.y) / 2, rl = Math.hypot(rx, ry) || 1;
        x[i] = d.top.x + (d.bot.x - d.top.x) * f + rx / rl * bow;
        x[i + 1] = d.top.y + (d.bot.y - d.top.y) * f + ry / rl * bow;
        x[i + 2] = d.top.z + (d.bot.z - d.top.z) * f;
        xp[i] = x[i]; xp[i + 1] = x[i + 1]; xp[i + 2] = x[i + 2];
      }
      pin[s * P] = 1; pin[s * P + N] = 1;
    });
    const mPart = spec.chainKgPerM * (defs[0] ? defs[0].len : 0.5) / N;
    const ch = { defs, N, P, x, xp, pin, seg, mPart, spec, params };
    const key = JSON.stringify(spec) + params.iterations;
    if (restCache.has(key)) { const r = restCache.get(key); x.set(r); xp.set(r); }
    else { for (let i = 0; i < 2400; i++) chainStep(ch, 1 / 1200, 12); restCache.set(key, Float64Array.from(x)); xp.set(x); }
    return ch;
  }
  function chainStep(ch, h, dampOverride) {
    const { x, xp, pin, P, N, seg, spec } = ch;
    const damp = Math.exp(-(dampOverride != null ? dampOverride : ch.params.chainDamping) * h);
    const g = -9.81 * h * h, n = pin.length;
    for (let p = 0; p < n; p++) {
      if (pin[p]) continue;
      const i = p * 3;
      const vx = (x[i] - xp[i]) * damp, vy = (x[i + 1] - xp[i + 1]) * damp, vz = (x[i + 2] - xp[i + 2]) * damp;
      xp[i] = x[i]; xp[i + 1] = x[i + 1]; xp[i + 2] = x[i + 2];
      x[i] += vx; x[i + 1] += vy; x[i + 2] += vz + g;
    }
    const minR = spec.poleR + spec.linkR;
    for (let it = 0; it < ch.params.iterations; it++) {
      for (let s = 0; s < seg.length; s++) {
        const L = seg[s];
        for (let k = 0; k < N; k++) {
          const a = s * P + k, b = a + 1, ia = a * 3, ib = b * 3;
          const dx = x[ib] - x[ia], dy = x[ib + 1] - x[ia + 1], dz = x[ib + 2] - x[ia + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          if (d <= L) continue;                               // a chain can go slack but never stretch
          const wa = pin[a] ? 0 : 1, wb = pin[b] ? 0 : 1, w = wa + wb; if (!w) continue;
          const c = (d - L) / d / w;
          x[ia] += dx * c * wa; x[ia + 1] += dy * c * wa; x[ia + 2] += dz * c * wa;
          x[ib] -= dx * c * wb; x[ib + 1] -= dy * c * wb; x[ib + 2] -= dz * c * wb;
        }
      }
      for (let p = 0; p < n; p++) {                          // links can't pass through the pole
        if (pin[p]) continue;
        const i = p * 3, r = Math.hypot(x[i], x[i + 1]);
        if (r < minR) { const s2 = minR / (r || 1e-9); x[i] *= s2; x[i + 1] *= s2; }
      }
    }
  }

  /* ---------- rigid-body impulse at a contact point on the disc ---------- */
  function invI(n, L) {                                   // world inverse inertia applied to L
    const par = dot(L, n);
    return add(mul(n, par / DISC.Ispin), mul(sub(L, mul(n, par)), 1 / DISC.Iperp));
  }
  // r: contact point relative to disc centre; N: unit normal pushing the disc away; vOther: velocity of the other body there;
  // wOther: other body's inverse mass (0 = immovable). Returns the impulse applied to the disc.
  function contact(S, r, N, vOther, wOther, e, mu) {
    const spinW = mul(S.n, S.omega * S.spinSign);
    const W = add(spinW, S.tilt);
    const vp = add(S.vel, cross(W, r));
    const vrel = sub(vp, vOther);
    const vn = dot(vrel, N);
    if (vn >= 0) return null;                               // already separating
    const rn = cross(r, N);
    const kN = 1 / DISC.mass + dot(cross(invI(S.n, rn), r), N) + wOther;
    const jn = -(1 + e) * vn / kN;
    let J = mul(N, jn);
    const vt = sub(vrel, mul(N, vn)), vtl = len(vt);
    if (vtl > 1e-6) {
      const tdir = mul(vt, 1 / vtl), rt = cross(r, tdir);
      const kT = 1 / DISC.mass + dot(cross(invI(S.n, rt), r), tdir) + wOther;
      const jt = Math.min(mu * jn, vtl / kT);
      J = sub(J, mul(tdir, jt));
    }
    S.vel = add(S.vel, mul(J, 1 / DISC.mass));
    const dW = invI(S.n, cross(r, J));
    const dSpin = dot(dW, S.n);
    S.omega = Math.max(0, S.omega + dSpin * S.spinSign);
    S.tilt = add(S.tilt, sub(dW, mul(S.n, dSpin)));
    return J;
  }
  function rimPoint(S, k, K) {                             // k-th of K points around the rim, relative to centre
    const n = S.n, a = Math.abs(n.z) < 0.9 ? v3(0, 0, 1) : v3(1, 0, 0);
    const u = norm(cross(n, a)), w = cross(n, u), t = k / K * Math.PI * 2;
    return add(mul(u, Math.cos(t) * DISC.R), mul(w, Math.sin(t) * DISC.R));
  }

  /* =====================================================================
     createCatcher({ base: {x, y, z} in metres (flight-engine frame), spec?, params? })
     Plugs into the flight engine as p.collider.
     ===================================================================== */
  const MOUNTS = {
    ground: {}, pole: {}, platform: {},
    hang: { poleBottomZ: SPEC.trayBottomZ - 0.03, poleTop: SPEC.bandTopZ + 0.35 },
  };
  function createCatcher(opts) {
    const spec = Object.assign({}, SPEC, MOUNTS[(opts && opts.mount) || 'ground'] || {}, (opts && opts.spec) || {});
    const params = Object.assign({}, CATCH, (opts && opts.params) || {});
    const base = (opts && opts.base) || v3(0, 0, 0);
    const ch = buildChains(spec, params);
    const touched = { chains: 0, pole: 0, band: 0, tray: 0, cage: 0 };
    let engaged = false, approach = null, result = null, restClock = 0, stuckClock = 0, minHoriz = 9;
    const lastEv = {};
    function ev(events, t, type, mag, at) {
      if (!events) return;
      if (type !== 'made' && mag < 0.006) return;            // resting contact is silent: only real knocks become events
      const last = lastEv[type];
      if (last && t - last.t < 0.04) { last.v = Math.max(last.v, mag); return; }
      const e = { t, type, v: mag, x: (at.x + base.x) / 0.3048, y: (at.y + base.y) / 0.3048, z: (at.z + base.z) / 0.3048 };
      events.push(e); lastEv[type] = e;
    }
    const local = p => v3(p.x - base.x, p.y - base.y, p.z - base.z);

    const C = {
      substeps: params.substeps,
      get engaged() { return engaged; },
      spec, params, base,
      near(pos) {
        const l = local(pos);
        return Math.hypot(l.x, l.y) < (engaged ? 2.0 : 1.05) && l.z > -0.3 && l.z < 2.1;
      },
      snapshot() { return Float32Array.from(ch.x); },
      settle(h) { chainStep(ch, h); },
      settleSubsteps: 2,
      step(S, h, events) {
        const cpos = local(S.pos);
        const horiz = Math.hypot(cpos.x, cpos.y);
        if (engaged && cpos.z > spec.trayTopZ && cpos.z < spec.bandTopZ) minHoriz = Math.min(minHoriz, horiz);
        if (!engaged) {
          if (horiz > 1.05 || cpos.z > 2.1 || cpos.z < -0.3) return null;
          engaged = true; approach = norm(v3(S.vel.x, S.vel.y, 0));
        }
        chainStep(ch, h);
        const pos = cpos;                                       // work in basket-local coords
        const R = DISC.R, T2 = DISC.T / 2, x = ch.x, xp = ch.xp, wP = 1 / ch.mPart;
        // ---- chains: tested along every link (not just at the joints) so the disc can't slip between them
        let chainHit = 0;
        if (horiz < spec.bandR + R + 0.05 && pos.z > spec.collarZ - 0.15 && pos.z < spec.bandBottomZ + 0.12) {
          const reach = R + spec.linkR + T2, P = ch.P, Nn = ch.N;
          for (let s = 0; s < ch.seg.length; s++) {
            const sl = ch.seg[s], subs = Math.max(2, Math.ceil(sl / 0.014));
            for (let k = 0; k < Nn; k++) {
              const a = s * P + k, b2 = a + 1, ia = a * 3, ib = b2 * 3;
              // quick reject: segment midpoint too far from the disc
              const mx = (x[ia] + x[ib]) / 2 - pos.x, my = (x[ia + 1] + x[ib + 1]) / 2 - pos.y, mz = (x[ia + 2] + x[ib + 2]) / 2 - pos.z;
              if (mx * mx + my * my + mz * mz > (reach + sl / 2) * (reach + sl / 2)) continue;
              const wa = ch.pin[a] ? 0 : wP, wb = ch.pin[b2] ? 0 : wP;
              for (let j = 0; j <= subs; j++) {
                const f = j / subs;
                const px = x[ia] + (x[ib] - x[ia]) * f, py = x[ia + 1] + (x[ib + 1] - x[ia + 1]) * f, pz = x[ia + 2] + (x[ib + 2] - x[ia + 2]) * f;
                const d = v3(px - pos.x, py - pos.y, pz - pos.z);
                if (d.x * d.x + d.y * d.y + d.z * d.z > reach * reach) continue;
                const hN = dot(d, S.n), inP = sub(d, mul(S.n, hN)), r = len(inP);
                let N, rc, pen;
                if (r <= R) {
                  pen = T2 + spec.linkR - Math.abs(hN); if (pen <= 0) continue;
                  N = mul(S.n, hN > 0 ? -1 : 1); rc = add(inP, mul(S.n, hN > 0 ? T2 : -T2));
                } else {
                  rc = mul(inP, R / r); const dv = sub(d, rc), dist = len(dv);
                  pen = T2 + spec.linkR - dist; if (pen <= 0) continue;
                  N = mul(dv, -1 / (dist || 1e-9));
                }
                const g0 = 1 - f, g1 = f, wPt = g0 * g0 * wa + g1 * g1 * wb;
                const vP = v3(((x[ia] - xp[ia]) * g0 + (x[ib] - xp[ib]) * g1) / h, ((x[ia + 1] - xp[ia + 1]) * g0 + (x[ib + 1] - xp[ib + 1]) * g1) / h, ((x[ia + 2] - xp[ia + 2]) * g0 + (x[ib + 2] - xp[ib + 2]) * g1) / h);
                const J = contact(S, rc, N, vP, wPt, params.chainRestitution, params.chainFriction);
                const wD = 1 / DISC.mass, share = wD / (wD + wPt);
                S.pos = add(S.pos, mul(N, pen * share)); pos.x += N.x * pen * share; pos.y += N.y * pen * share; pos.z += N.z * pen * share;
                if (wPt > 0) {
                  const cpen = pen * (1 - share) / wPt;
                  x[ia] -= N.x * cpen * g0 * wa; x[ia + 1] -= N.y * cpen * g0 * wa; x[ia + 2] -= N.z * cpen * g0 * wa;
                  x[ib] -= N.x * cpen * g1 * wb; x[ib + 1] -= N.y * cpen * g1 * wb; x[ib + 2] -= N.z * cpen * g1 * wb;
                }
                if (J) {                                        // the chain takes the opposite impulse, split between the two joints
                  xp[ia] += J.x * g0 * wa * h; xp[ia + 1] += J.y * g0 * wa * h; xp[ia + 2] += J.z * g0 * wa * h;
                  xp[ib] += J.x * g1 * wb * h; xp[ib + 1] += J.y * g1 * wb * h; xp[ib + 2] += J.z * g1 * wb * h;
                  chainHit += len(J);
                }
              }
            }
          }
          if (chainHit > 0) { touched.chains += chainHit; ev(events, S.t, 'chains', chainHit, pos); }
        }
        // ---- solid parts, tested at points around the rim plus the centre
        const K = 20;
        const nearSolid = horiz < DISC.R + spec.poleR + 0.02 || Math.abs(horiz - spec.bandR) < DISC.R + 0.02 || Math.abs(horiz - spec.trayR) < DISC.R + 0.02 || (horiz < spec.trayR + DISC.R && pos.z < spec.trayTopZ + 0.15) || (horiz < spec.bandR + DISC.R && pos.z > spec.bandBottomZ - 0.1);
        for (let k = 0; nearSolid && k <= K; k++) {
          const rc = k < K ? rimPoint(S, k, K) : v3(0, 0, 0);
          const q = add(pos, rc), qr = Math.hypot(q.x, q.y);
          const radial = qr > 1e-9 ? v3(q.x / qr, q.y / qr, 0) : v3(1, 0, 0);
          // pole
          if (qr < spec.poleR + T2 && q.z > spec.poleBottomZ && q.z < spec.poleTop) {
            const J = contact(S, rc, radial, v3(0, 0, 0), 0, params.poleRestitution, params.poleFriction);
            const pen = spec.poleR + T2 - qr; S.pos = add(S.pos, mul(radial, pen)); pos.x += radial.x * pen; pos.y += radial.y * pen;
            if (J) { touched.pole += len(J); ev(events, S.t, 'pole', len(J), q); }
          }
          // band (chain rack): a short cylinder wall, plus the dome on top
          if (q.z > spec.bandBottomZ - T2 && q.z < spec.bandTopZ + T2 && Math.abs(qr - spec.bandR) < T2 + 0.003) {
            const inside = horiz < spec.bandR; const N = inside ? mul(radial, -1) : radial;
            const J = contact(S, rc, N, v3(0, 0, 0), 0, params.bandRestitution, params.bandFriction);
            const pen = T2 + 0.003 - Math.abs(qr - spec.bandR); S.pos = add(S.pos, mul(N, pen)); pos.x += N.x * pen; pos.y += N.y * pen;
            if (J) { touched.band += len(J); ev(events, S.t, 'band', len(J), q); }
          }
          if (qr < spec.bandR && q.z < spec.bandTopZ + spec.lidRise * (1 - (qr / spec.bandR) ** 2) + T2 && q.z > spec.bandTopZ - 0.02 && pos.z > spec.bandTopZ) {
            const J = contact(S, rc, v3(0, 0, 1), v3(0, 0, 0), 0, params.bandRestitution, params.bandFriction);
            S.pos = add(S.pos, v3(0, 0, 0.002)); pos.z += 0.002;
            if (J) { touched.band += len(J); ev(events, S.t, 'band', len(J), q); }
          }
          // tray floor
          if (qr < spec.trayR && q.z < spec.trayBottomZ + T2 && q.z > spec.trayBottomZ - 0.06 && pos.z > spec.trayBottomZ - 0.04) {
            const J = contact(S, rc, v3(0, 0, 1), v3(0, 0, 0), 0, params.trayRestitution, params.trayFriction);
            const pen = spec.trayBottomZ + T2 - q.z; S.pos = add(S.pos, v3(0, 0, pen)); pos.z += pen;
            if (J) { touched.tray += len(J); ev(events, S.t, 'tray', len(J), q); }
          }
          // tray wall (cage) and its top rim
          if (q.z > spec.trayBottomZ - 0.02 && q.z < spec.trayTopZ + spec.rodR && Math.abs(qr - spec.trayR) < spec.rodR + T2) {
            const inside = horiz < spec.trayR; const N = inside ? mul(radial, -1) : radial;
            const J = contact(S, rc, N, v3(0, 0, 0), 0, params.trayRestitution, params.trayFriction);
            const pen = spec.rodR + T2 - Math.abs(qr - spec.trayR); S.pos = add(S.pos, mul(N, pen)); pos.x += N.x * pen; pos.y += N.y * pen;
            if (J) { const m = len(J); if (inside) touched.tray += m; else touched.cage += m; ev(events, S.t, 'tray', m, q); }
          } else {
            const dr = qr - spec.trayR, dz = q.z - spec.trayTopZ, dd = Math.hypot(dr, dz);
            if (dd < spec.rodR + T2 && dd > 1e-6) {                // rolling over the top rod
              const N = norm(add(mul(radial, dr / dd), v3(0, 0, dz / dd)));
              const J = contact(S, rc, N, v3(0, 0, 0), 0, params.trayRestitution, params.trayFriction);
              const pen = spec.rodR + T2 - dd; S.pos = add(S.pos, mul(N, pen)); pos.x += N.x * pen; pos.y += N.y * pen; pos.z += N.z * pen;
              if (J) { touched.cage += len(J); ev(events, S.t, 'tray', len(J), q); }
            }
          }
        }
        // ---- the chain pack (v2.1): graded, sticky in the middle, a slam can still blow through
        if (touched.chains > 0 && params.chainDragBottom > 0) {
          const hz0 = Math.hypot(pos.x, pos.y), rPack = spec.bandR + DISC.R * 0.6;   // the disc is in the pack once its rim is among the chains
          if (hz0 < rPack && pos.z > spec.trayTopZ - 0.02 && pos.z < spec.bandBottomZ) {
            const zf = Math.max(0, Math.min(1, (pos.z - spec.trayTopZ) / (spec.bandBottomZ - spec.trayTopZ)));
            const core = 1 - params.chainDragCore * Math.min(1, hz0 / rPack);       // denser toward the pole
            const sp0 = Math.hypot(S.vel.x, S.vel.y);
            // the pack can only take so much: past chainVRef the grip falls off, so a slam can blow through
            const k = (params.chainDragBottom + (params.chainDragTop - params.chainDragBottom) * zf) * core * Math.min(1, params.chainVRef / Math.max(0.1, sp0));
            const f = Math.exp(-k * h);
            let vx = S.vel.x * f, vy = S.vel.y * f;
            // the pack gives back little: speed heading out of the chains (away from the pole) is soaked up harder
            if (hz0 > 1e-4) { const ux = pos.x / hz0, uy = pos.y / hz0, vr = vx * ux + vy * uy; if (vr > 0) { const lose = vr * (1 - Math.exp(-k * params.chainOutSoak * h)); vx -= ux * lose; vy -= uy * lose; } }
            // strong side: the spinning front edge rubs across the chains, and the rub pushes the disc sideways,
            // toward the pole on the strong side (right of the pole for a right-hand backhand) and out on the weak side
            if (params.spinGrip > 0 && S.omega > 0) {
              const W = mul(S.n, S.omega * S.spinSign), vh = Math.hypot(vx, vy) || 1e-9, fr = v3(vx / vh * DISC.R, vy / vh * DISC.R, 0);
              const vf = cross(W, fr), vfh = Math.hypot(vf.x, vf.y);
              if (vfh > 1e-6) { const a = params.spinGrip * k * Math.min(vfh, 8) * (1 - 0.5 * zf) * h; vx -= vf.x / vfh * a; vy -= vf.y / vfh * a; }
            }
            S.vel = v3(vx, vy, S.vel.z > 0 ? S.vel.z * f : S.vel.z);
          }
        }
        // ---- is it in?
        const sp = len(S.vel), hz = Math.hypot(pos.x, pos.y);
        if (hz < spec.trayR - 0.01 && pos.z > spec.trayBottomZ - 0.02 && pos.z < spec.trayTopZ + 0.04) {
          restClock = sp < params.restSpeed ? restClock + h : 0;
          if (restClock > params.restTime) {
            result = { outcome: 'made', via: touched.chains > 0 ? 'chains' : 'tray', touched: Object.assign({}, touched) };
            ev(events, S.t, 'made', 1, pos);
            return 'made';
          }
        } else restClock = 0;
        if (hz < spec.bandR && pos.z > spec.trayTopZ && pos.z < spec.bandBottomZ && sp < 0.1) {   // hung up in the chains
          stuckClock += h;
          if (stuckClock > 0.6) { result = { outcome: 'made', via: 'chains', touched: Object.assign({}, touched) }; ev(events, S.t, 'made', 1, pos); return 'made'; }
        } else stuckClock = 0;
        return null;
      },
      outcome() {
        if (result) return result;
        if (!engaged) return { outcome: 'none', touched };
        const t = touched, any = t.chains + t.pole + t.band + t.tray + t.cage;
        let outcome = 'miss';
        if (t.chains > 0) outcome = 'chainout';
        else if (t.band > 0) outcome = 'band';
        else if (t.pole > 0) outcome = 'pole';
        else if (t.cage + t.tray > 0) outcome = 'cage';
        if (!any) outcome = 'miss';
        return { outcome, touched: Object.assign({}, touched), approach };
      },
      // tells chain-outs from spit-throughs once the final resting point is known (flight-engine metres)
      classify(endPos) {
        const o = this.outcome();
        if (o.outcome === 'chainout' && approach) {
          const l = local(endPos);
          // through the middle of the chains and out the back = spit through; anything glancing = chain out
          if (l.x * approach.x + l.y * approach.y > 0.15 && minHoriz < 0.14) o.outcome = 'spit';
        }
        return o;
      },
    };
    return C;
  }

  const LABEL = { made: 'In the chains', chainout: 'Chain out', spit: 'Spit through', band: 'Off the band', pole: 'Pole out', cage: 'Off the cage', miss: 'Missed', none: '' };
  function restPose(spec, params) { return Float32Array.from(buildChains(Object.assign({}, SPEC, spec || {}), Object.assign({}, CATCH, params || {})).x); }
  const VERSION = '2.1';
  return { VERSION, SPEC, CATCH, DISC, MOUNTS, LABEL, strandDefs, createCatcher, restPose };
});
