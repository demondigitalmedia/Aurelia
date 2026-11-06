/* =====================================================================
   FLIGHTLINE DG · FLIGHT PHYSICS ENGINE  (v1, replaces the draft 4 heuristic)

   What this is:
   The disc is simulated as a spinning wing. Every step (1/400 s) the engine
   computes three aerodynamic effects from the disc's speed and angle of attack:
     - LIFT     pushes perpendicular to the airflow, toward the disc's top face
     - DRAG     pushes straight back against the airflow
     - PITCHING MOMENT tries to tip the nose up or down
   Because the disc is spinning, a pitching moment does not flip it. It makes the
   disc ROLL instead (gyroscopic precession, the same reason a spinning top leans
   sideways when you push it). That roll is what produces turn and fade:
     - low angle of attack, high speed  -> nose-down moment -> rolls to turn side
     - high angle of attack, low speed  -> nose-up moment   -> rolls to fade side
   More spin = slower roll = a more stable-feeling flight. None of this is
   scripted per throw; it emerges from the forces.

   Honesty notes:
   - Nose angle is measured against the horizon. Angle of attack at release is
     therefore nose minus launch angle.
   - The coefficient SHAPE (linear lift, quadratic drag, linear moment) follows
     published frisbee aerodynamics research (Hummel 2003 UC Davis thesis,
     Potts & Crowther wind tunnel work). Worth verifying the original values.
   - Golf-disc coefficients per mold are NOT publicly available. The mapping from
     flight numbers (speed/glide/turn/fade) to coefficients is our own
     calibration, tuned against the draft 4 benchmark distances. Your launcher
     data can replace this calibration later.

   v1.3 (DDM Creation System): optional hooks for the Contact engine (skip, skuttle,
   roll, tombstone, dig, bounce off solids), the Luck engine (seeded gusts) and a
   ground-effect lift boost near the surface. Without those hooks it behaves exactly
   like v1.2.

   v1.4: a disc that comes to rest on top of a solid (Contact reports 'lodged') ends its
   flight there instead of hopping in place.

   v1.5: the step length goes to the Contact engine with every solids check, so porous
   layers (leaves, fur, foliage) can slow a disc by how long it spends inside them, and
   impact wobble from the ground is carried into the slide. An optional release wobble
   (p.wobble, rad/s) models a jerky, off-axis release; a clean release has none.

   v1.7: drivers hold stable at the arm speeds players use (Aurelia throws 50 to 80 mph). A disc's base
   nose-up hold grows with its speed rating above 3 (cm_perSpeedAbove3), the way wide-rim drivers stay
   stable at speeds that flip a putter. Putters (speed 1 to 3) fly exactly as in v1.6; mids change a little,
   fairways and drivers a lot (see the Aurelia commit for before/after tables). Optional p.stepHz runs a
   flight at a coarser step (a quick preview); without it the step is 400 Hz as before.

   Coordinates (SI internally, feet/mph at the edges):
     +x = right of the thrower (facing the basket), +y = downrange, +z = up.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlightlinePhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MPH = 0.44704, FT = 0.3048, DEG = Math.PI / 180, RPM = 2 * Math.PI / 60;

  /* ---------- Air and disc body ---------- */
  const AIR = { rho: 1.225, g: 9.81 };           // sea-level air density, gravity
  const BODY = {
    mass: 0.172,                                 // kg (172 g, a common driver weight)
    diameter: 0.211,                             // m (PDGA max is about 21.1 cm)
    inertiaK: 0.62,                              // spin inertia = K * m * r^2 (rim-weighted disc)
  };

  /* ---------- Calibration constants (the only tuned numbers) ----------
     Each disc's coefficients are built from these plus its flight numbers. */
  const CAL = {
    // drag: higher speed rating = thinner-profile rim = less base drag
    cd0_slow: 0.1157, cd0_fast: 0.0444,            // CD0 at speed 1 and speed 14
    cda: 1.7242, alpha0: -2.5,                     // induced drag growth, zero-lift-drag angle (deg)
    // lift: glide sets how much lift the disc makes
    cl0_base: 0.038, cl0_perGlide: 0.0386,         // CL at zero angle of attack
    cl0_perSpeed: -0.0042,                        // faster-rated discs make less lift (they need speed to fly)
    cla: 1.8,                                    // lift slope per radian
    stallDeg: 20, stallDrop: 0.2003,                // past this angle of attack, lift slope collapses (stall)
    // pitching moment: stability
    cm0_base: -0.012,                            // neutral disc at zero angle
    cma_base: 0.0579, cma_perFade: 0.02,           // nose-up growth near zero angle of attack
    cmq_base: 0.4641, cmq_perFade: 0.1073,           // extra nose-up at high angle of attack (late fade)
    cm_perFadeOffset: 0.006,                     // extra nose-up bias per fade point
    cm_perSpeedAbove3: 0.0008,                       // wide-rim drivers hold stable at speeds that flip a putter (putters, speed 1 to 3, unchanged)
    cm_turnPerPoint: 0.012,                      // nose-down per point of turn when at speed
    turnOnsetFrac: 0.78,                         // turn starts at this fraction of design speed
    turnFullFrac: 1.12,                          // turn fully expressed at this fraction
    turnSpeedExp: 1.6075,                           // how the turn push is tamed above design speed
    // design (intended) release speed in mph for a disc of a given speed rating
    designMph_base: 10, designMph_perSpeed: 2.5361,
    spinDecay: 0.04,                             // fraction of spin lost per second
  };

  function airDensity(tempF) {
    const K = (tempF - 32) * 5 / 9 + 273.15;
    return 101325 / (287.05 * K);
  }

  /* ---------- Hand / style -> spin direction ----------
     RHBH and LHFH spin clockwise seen from above; RHFH and LHBH counterclockwise.
     turnSide: which way (+x right / -x left) the disc turns. Fade goes the other way. */
  function handInfo(hand) {
    const cw = (hand === 'RHBH' || hand === 'LHFH');
    return { spinSign: cw ? -1 : +1, turnSide: cw ? +1 : -1 };
  }

  /* ---------- Flight numbers -> aerodynamic coefficients ---------- */
  function discCoefficients(d) {
    const sp = Math.max(1, Math.min(14, d.speed));
    const f = (sp - 1) / 13;
    return {
      cd0: CAL.cd0_slow + (CAL.cd0_fast - CAL.cd0_slow) * f,
      cda: CAL.cda,
      alpha0: CAL.alpha0 * DEG,
      cl0: CAL.cl0_base + CAL.cl0_perGlide * d.glide + CAL.cl0_perSpeed * sp,
      cla: CAL.cla,
      cm0: CAL.cm0_base + CAL.cm_perFadeOffset * d.fade + CAL.cm_perSpeedAbove3 * Math.max(0, sp - 3),
      cma: CAL.cma_base + CAL.cma_perFade * d.fade,
      cmq: CAL.cmq_base + CAL.cmq_perFade * d.fade,
      turn: Math.min(0, d.turn),                         // only negative turn adds turn
      highTurnStable: Math.max(0, d.turn),               // +1 turn discs resist turning
      designSpeed: (CAL.designMph_base + CAL.designMph_perSpeed * sp) * MPH,
    };
  }

  function smooth01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

  /* ---------- Small vector helpers ---------- */
  const v3 = (x, y, z) => ({ x, y, z });
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
  const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
  const mul = (a, s) => v3(a.x * s, a.y * s, a.z * s);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const len = a => Math.sqrt(dot(a, a));
  const norm = a => { const l = len(a) || 1; return mul(a, 1 / l); };

  /* ---------- Seeded random (so swirly-wind throws can be replayed exactly) ---------- */
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  /* ---------- Wind ---------- */
  function windVector(p) {
    const w = (p.windSpeed || 0) * MPH;
    switch (p.windDir) {
      case 'head': return v3(0, -w, 0);     // blowing toward the thrower
      case 'tail': return v3(0, w, 0);
      case 'crossL': return v3(-w, 0, 0);   // blowing toward the left
      case 'crossR': return v3(w, 0, 0);
      default: return v3(0, 0, 0);
    }
  }

  /* =====================================================================
     simulate(params) -> flight record
     params: { disc:{speed,glide,turn,fade}, hand, armSpeed (mph), spin (rpm),
               hyzer (deg, + = anhyzer, - = hyzer, as in draft 4),
               nose (deg, measured against the horizon; + = nose up),
               launchAngle (deg, arm path above the horizon),
               aim (deg, heading of the throw; 0 = straight downrange, + = right),
               windSpeed (mph), windDir, elev (ft gained per 300 ft downrange),
               tempF (air temperature, °F; optional, standard 59 °F air if omitted),
               swirly (bool), seed (int, optional), releaseHeight (ft, optional) }
     ===================================================================== */
  function simulate(p) {
    const c = discCoefficients(p.disc);
    const h = handInfo(p.hand || 'RHBH');
    // air density from temperature (sea-level pressure). Cold air is thicker: more lift and more drag.
    // Without tempF the engine uses standard air (59 °F), which is what the calibration was tuned at.
    const rho = p.tempF != null ? airDensity(p.tempF) : AIR.rho;
    const r = BODY.diameter / 2, area = Math.PI * r * r;
    const I = BODY.inertiaK * BODY.mass * r * r;
    const seed = (p.seed != null) ? p.seed : Math.floor(Math.random() * 1e9);
    const rand = rng(seed);

    // aim: rotate the whole release (arm path and disc) about the vertical axis.
    // Wind stays fixed to the course, so aiming into a crosswind changes how it hits the disc.
    const aim = (p.aim || 0) * DEG, ca = Math.cos(aim), sa = Math.sin(aim);
    const yaw = v => v3(v.x * ca + v.y * sa, -v.x * sa + v.y * ca, v.z);

    // release velocity: arm path direction
    const v0 = p.armSpeed * MPH;
    const la = (p.launchAngle || 0) * DEG;
    let vel = yaw(v3(0, v0 * Math.cos(la), v0 * Math.sin(la)));

    // disc orientation: unit normal out of the top face.
    // pitch = nose angle against the horizon (so angle of attack at release = nose - launch).
    // bank: + value = anhyzer = tilts toward the turn side.
    const pitch = (p.nose || 0) * DEG;
    const bank = (p.hyzer || 0) * DEG * h.turnSide;
    let n = yaw(norm(v3(Math.sin(bank) * Math.cos(pitch), -Math.sin(pitch), Math.cos(bank) * Math.cos(pitch))));

    let omega = (p.spin || 900) * RPM;
    let pos = v3(0, 0, (p.releaseHeight || 5.0) * FT);
    let baseWind = windVector(p);
    // v1.6: a wind vector fixed to the course (mph, engine axes), with an optional gust amount (0..1)
    // and the usual wind profile near the ground (power law, exponent 1/7, reference 10 m).
    const wv = p.windVec || null, gustK = clamp01(p.gust || 0), gr = rng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
    const gw = { ph1: gr() * 6.283, ph2: gr() * 6.283, ph3: gr() * 6.283, base: gr() * 2 - 1 };
    if (wv) baseWind = v3((wv.x || 0) * MPH, (wv.y || 0) * MPH, 0);
    const windAt = (tt, hgt) => {
      if (!wv) return baseWind;
      let w = baseWind;
      if (gustK > 0) {
        const mul = Math.max(0, 1 + gustK * (0.3 * Math.sin(tt * 1.1 + gw.ph1) + 0.2 * Math.sin(tt * 2.7 + gw.ph2) + 0.3 * gw.base));
        const a = gustK * 0.26 * Math.sin(tt * 0.9 + gw.ph3), c = Math.cos(a), s = Math.sin(a);
        w = v3((w.x * c - w.y * s) * mul, (w.x * s + w.y * c) * mul, 0);
      }
      if (p.windProfile !== false) { const k = Math.min(1.15, Math.max(0.5, Math.pow(Math.max(0.1, hgt) / 10, 1 / 7))); w = v3(w.x * k, w.y * k, 0); }
      return w;
    };
    const slope = (p.elev || 0) / 300;                 // ground rises this many ft per ft downrange

    // swirly wind: two slow wobbles plus rare gusts on the crosswind, seeded
    const sw = {
      ph1: rand() * 6.283, ph2: rand() * 6.283,
      f1: 0.8 + rand() * 0.6, f2: 1.6 + rand() * 1.0,
      mag: (2.2 + (p.windSpeed || 0) * MPH * 0.5),
      gust: 0,
    };

    const hz = p.stepHz || CAL.stepHz || 400, dt = 1 / hz, recordEvery = Math.max(1, Math.round(hz / 50));               // record at 50 samples/s
    const samples = [];
    let t = 0, step = 0, spinAngle = 0;
    let maxZ = pos.z, maxV = v0;
    // optional hooks: a collider (the basket) that takes part near its object, and a ground shape
    const col = p.collider || null;
    const groundZ = p.groundFt ? (x, y) => p.groundFt(x / FT, y / FT) * FT : (x, y) => slope * y;
    let tilt = v3(0, 0, 0);                            // tilt rate (rad/s) from impacts; aerodynamic precession is separate
    if (p.wobble) { const wa = rand() * 2 * Math.PI; tilt = v3(Math.cos(wa) * p.wobble, Math.sin(wa) * p.wobble, 0); }   // v1.5: an off-axis release (a stabbed putt) wobbles
    const ct = p.contact || null, lk = p.luck || null;
    const ge = p.groundEffect || 0;                    // lift boost near the ground (calibration; 0 = off)
    if (ct) ct.begin({ groundZ, spinSign: h.spinSign, turnSide: h.turnSide, luck: lk });
    let onGround = false, airTime = null;
    const events = [{ t: 0, type: 'release', v: v0 / MPH, x: pos.x / FT, y: pos.y / FT, z: pos.z / FT }];
    let done = null, flightEnd = null;

    const record = (alphaDeg, landed) => {
      // roll angle: how far the top face leans toward +x (right), in degrees
      const rollDeg = Math.atan2(n.x, n.z) / DEG;
      samples.push({
        t, x: pos.x / FT, y: pos.y / FT, z: pos.z / FT,
        speed: len(vel) / MPH,                         // mph
        nx: n.x, ny: n.y, nz: n.z,
        roll: rollDeg, aoa: alphaDeg,
        spinRpm: omega / RPM, spinAngle,
        landed: !!landed,
        chains: col && col.engaged ? col.snapshot() : null,
      });
    };

    let alphaDeg = 0;
    record((p.nose || 0) - (p.launchAngle || 0), false);

    outer:
    while (step < hz * 20) {                          // hard cap 20 s of flight
      // near the collider the step is split so fast contacts are not missed
      const subN = col && col.near(pos) ? col.substeps : 1, hs = dt / subN;
      for (let k = 0; k < subN; k++) {
        let wind = wv ? windAt(t, pos.z - groundZ(pos.x, pos.y)) : baseWind;
        if (p.swirly) {
          const wob = Math.sin(t * sw.f1 + sw.ph1) * 0.6 + Math.sin(t * sw.f2 + sw.ph2) * 0.4;
          if (k === 0 && rand() < 0.004) sw.gust = (rand() * 2 - 1) * sw.mag * 1.6;
          sw.gust *= Math.exp(-hs / 0.6);
          wind = add(baseWind, v3(sw.mag * wob + sw.gust, 0, 0));
        }
        if (lk) { const lw = lk.windAt(t, events); if (lw) wind = add(wind, lw); }

        const va = sub(vel, wind);                     // airflow relative to the disc
        const V = len(va);
        let acc = v3(0, 0, -AIR.g);
        if (V > 0.01) {
          const vh = mul(va, 1 / V);
          // angle of attack: air hitting the underside = positive
          const s = Math.max(-1, Math.min(1, -dot(vh, n)));
          const alpha = Math.asin(s);
          alphaDeg = alpha / DEG;
          const q = 0.5 * rho * V * V * area;
          // turn term: nose-down push that only shows up at or above the disc's design speed
          const speedFrac = V / c.designSpeed;
          const turnExpr = smooth01((speedFrac - CAL.turnOnsetFrac) / (CAL.turnFullFrac - CAL.turnOnsetFrac));
          const aS = CAL.stallDeg * DEG;
          const CL = c.cl0 + c.cla * Math.min(alpha, aS) - (alpha > aS ? CAL.stallDrop * (alpha - aS) : 0);
          const CD = c.cd0 + c.cda * (alpha - c.alpha0) * (alpha - c.alpha0);
          // the turn push grows with speed past onset but is normalized so its torque rises
          // roughly with speed (not speed squared), which keeps big arms from rolling every disc over
          const CM = c.cm0 + c.cma * alpha + c.cmq * alpha * Math.abs(alpha)
                   + CAL.cm_turnPerPoint * c.turn * turnExpr / Math.max(1, Math.pow(speedFrac, CAL.turnSpeedExp))
                   + 0.004 * c.highTurnStable;                    // +turn discs: slight nose-up hold
          let liftDir = sub(n, mul(vh, dot(n, vh)));
          liftDir = norm(liftDir);
          let geMul = 1;
          if (ge) { const hg = pos.z - groundZ(pos.x, pos.y); if (hg < BODY.diameter && hg > 0) { const k = 1 - hg / BODY.diameter; geMul = 1 + ge * k * k; } }
          const F = add(add(mul(liftDir, q * CL * geMul), mul(vh, -q * CD)), v3(0, 0, -BODY.mass * AIR.g));
          acc = mul(F, 1 / BODY.mass);
          // pitching moment about the disc's lateral axis; positive CM = nose up
          const lat = cross(vh, n);
          const latLen = len(lat);
          if (latLen > 1e-6 && omega > 1) {
            const M = q * BODY.diameter * CM;
            const torque = mul(lat, M / latLen);
            // gyroscopic precession: dn/dt = torque / (spin angular momentum)
            const L = I * omega * h.spinSign;
            const dn = mul(torque, 1 / L);
            n = norm(add(n, mul(dn, hs)));
          }
        }
        if (tilt.x || tilt.y || tilt.z) {              // wobble from an impact, damped by air and spin
          n = norm(add(n, mul(cross(tilt, n), hs)));
          tilt = mul(tilt, Math.exp(-4 * hs));
          if (len(tilt) < 1e-3) tilt = v3(0, 0, 0);
        }

        vel = add(vel, mul(acc, hs));
        pos = add(pos, mul(vel, hs));
        omega *= (1 - CAL.spinDecay * hs);
        spinAngle += omega * hs * h.spinSign;
        t += hs;

        if (col) {
          const S = { pos, vel, n, omega, tilt, t, spinSign: h.spinSign };
          const r = col.step(S, hs, events);
          pos = S.pos; vel = S.vel; n = S.n; omega = S.omega; tilt = S.tilt;
          if (r) { done = r; break outer; }
        }
        if (ct) {
          const S = { pos, vel, n, omega, tilt, t, dt: hs };
          const r = ct.solids(S, events);
          pos = S.pos; vel = S.vel; n = S.n; omega = S.omega; tilt = S.tilt;
          if (r === 'lodged') { if (airTime == null) airTime = t; record(alphaDeg, true); flightEnd = t; break outer; }   // came to rest on top of a solid
        }
        if (pos.z > maxZ) maxZ = pos.z;
        const ground = groundZ(pos.x, pos.y);
        if (pos.z <= ground) {
          if (ct) {
            const S = { pos, vel, n, omega, tilt, t };
            const r = ct.touch(S, events);
            pos = S.pos; vel = S.vel; n = S.n; omega = S.omega; tilt = S.tilt;
            if (airTime == null) airTime = t;
            if (r === 'skip') continue;
            onGround = true; break;
          }
          pos = v3(pos.x, pos.y, ground);
          events.push({ t, type: 'land', v: len(vel) / MPH, x: pos.x / FT, y: pos.y / FT, z: pos.z / FT });
          record(alphaDeg, true); flightEnd = t; break outer;
        }
      }
      if (onGround) {
        // the Contact engine owns the disc from here: skuttle, roll, or stuck, until it comes to rest
        record(alphaDeg, true);
        while (step < hz * 40) {
          const S = { pos, vel, n, omega, tilt, t };
          const done = ct.groundStep(S, dt, events);
          pos = S.pos; vel = S.vel; n = S.n; omega = S.omega; if (S.tilt) tilt = S.tilt;
          spinAngle += omega * dt * h.spinSign;
          t += dt; step++;
          if (done) { record(alphaDeg, true); flightEnd = t; break outer; }
          if (step % recordEvery === 0) record(alphaDeg, true);
        }
        flightEnd = t; break outer;
      }
      step++;
      if (step % recordEvery === 0) record(alphaDeg, false);
    }
    if (done) { vel = v3(0, 0, 0); record(alphaDeg, true); flightEnd = t; if (airTime == null) airTime = t; }
    if (flightEnd == null) flightEnd = t;
    // after the disc stops, keep the chains swinging for a moment so replays show them settle
    if (col && col.engaged && col.settle) {
      const ss = col.settleSubsteps || col.substeps, hs = dt / ss;
      for (let k = 1; k <= Math.round(1.4 * hz); k++) {
        for (let j = 0; j < ss; j++) col.settle(hs);
        t += dt;
        if (k % recordEvery === 0) { record(alphaDeg, true); samples[samples.length - 1].post = true; }
      }
    }

    let last = samples[samples.length - 1];
    for (let i = samples.length - 1; i >= 0; i--) if (!samples[i].post) { last = samples[i]; break; }
    // downrange and lateral are measured along the aim line, so a study readout means
    // "how far along where I aimed" and "how far off that line"
    const along = s => s.x * sa + s.y * ca, off = s => s.x * ca - s.y * sa;
    for (const s of samples) { s.along = along(s); s.off = off(s); }
    return {
      seed,
      params: JSON.parse(JSON.stringify(Object.assign({}, p, { collider: undefined, groundFt: undefined, contact: undefined, luck: undefined }))),
      airTime: airTime != null ? airTime : flightEnd,
      contact: ct ? ct.summary() : null,
      events,
      catchResult: col ? (col.classify ? col.classify(pos) : col.outcome()) : null,
      samples,
      distanceFt: Math.hypot(last.x, last.y),
      downrangeFt: along(last),
      lateralFt: off(last),
      apexFt: maxZ / FT,
      flightTime: flightEnd,
    };
  }

  return { simulate, discCoefficients, handInfo, airDensity, CAL, BODY, AIR, units: { MPH, FT, DEG, RPM } };
});
