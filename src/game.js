/* =====================================================================
   AURELIA · THE TERRACES  (renderer, camera, controls, round flow)
   three.js r128. Engine frame (x right, y downrange, z up) maps to three as (x, z, -y).
   ===================================================================== */
(function () {
  'use strict';
  var T = THREE, Wd = AureliaWorld, PL = AureliaPlay;
  var E = { P: FlightlinePhysics, FB: FlightlineBasket, CT: DDMContact, MATS: DDMMaterials };
  var FT = 0.3048, DEG = Math.PI / 180;
  function V(x, y, z) { return new T.Vector3(x, z, -y); }
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  var R = Wd.rng(4242);
  var col = function (h) { return new T.Color(h); };

  /* ---------------- renderer ---------------- */
  var canvas = $('gl');
  var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  var scene = new T.Scene();
  var camera = new T.PerspectiveCamera(52, 1, 0.45, 9000);
  var composer = null, bloom = null;
  try {
    if (T.EffectComposer && T.RenderPass && T.UnrealBloomPass && !/nobloom/.test(location.hash)) {
      composer = new T.EffectComposer(renderer);
      composer.addPass(new T.RenderPass(scene, camera));
      bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.3, 0.45, 0.9);
      composer.addPass(bloom);
    }
  } catch (e) { composer = null; }
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    if (typeof POINT_U !== 'undefined') POINT_U.scale.value = h * renderer.getPixelRatio() / 2;
  }
  window.addEventListener('resize', resize);

  /* ---------------- palettes: day and glow ---------------- */
  var PAL = {
    day: { top: 0x5aa6e4, hor: 0xeaf0dc, low: 0xc8dccf, fog: 0xcfe1e2, fogD: 0.00036, hemiS: 0xe2f1ff, hemiG: 0x56743a, hemiI: 0.5, sunC: 0xfff0cf, sunI: 0.78, roseC: 0xffb3c6, roseI: 0.16, bS: 0.22, bT: 0.92, bR: 0.35 },
    glow: { top: 0x01020a, hor: 0x0a1430, low: 0x040714, fog: 0x050a1c, fogD: 0.0012, hemiS: 0x2a3c86, hemiG: 0x04050d, hemiI: 0.34, sunC: 0x6c86ff, sunI: 0.16, roseC: 0x8a5cff, roseI: 0.07, bS: 0.62, bT: 0.8, bR: 0.38 },
  };
  var SUN = new T.Vector3(0.55, 0.66, 0.5).normalize();     // three-space directions toward the two suns
  var ROSE = new T.Vector3(-0.78, 0.28, -0.56).normalize();

  /* ---------------- sky ---------------- */
  var skyU = { top: { value: col(PAL.day.top) }, hor: { value: col(PAL.day.hor) }, low: { value: col(PAL.day.low) }, sun: { value: SUN.clone() }, rose: { value: ROSE.clone() }, sunA: { value: 1 } };
  var sky = new T.Mesh(new T.SphereGeometry(5000, 32, 18), new T.ShaderMaterial({
    uniforms: skyU, side: T.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top, hor, low, sun, rose; uniform float sunA; varying vec3 vd; void main(){ float h = vd.y; vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(hor, low, pow(clamp(-h,0.0,1.0), 0.35));' +
      ' float s = max(dot(vd, sun), 0.0), r = max(dot(vd, rose), 0.0);' +
      ' c += sunA * (vec3(1.0,0.92,0.7) * (pow(s, 900.0) * 2.2 + pow(s, 12.0) * 0.22) + vec3(1.0,0.62,0.72) * (pow(r, 1400.0) * 1.8 + pow(r, 10.0) * 0.16));' +
      ' gl_FragColor = vec4(c, 1.0); }'
  }));
  sky.renderOrder = -10; scene.add(sky);

  // stars and aurora (glow only)
  var stars = (function () {
    var n = 2600, p = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { var u = R() * 2 - 1, a = R() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y); p[i * 3] = Math.cos(a) * r * 4500; p[i * 3 + 1] = y * 4500; p[i * 3 + 2] = Math.sin(a) * r * 4500; }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3));
    var m = new T.Points(g, new T.PointsMaterial({ color: 0xe9e4ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
    m.renderOrder = -9; scene.add(m); return m;
  })();
  var auroraU = { t: { value: 0 } };
  var aurora = (function () {
    var grp = new T.Group();
    var mat = new T.ShaderMaterial({
      uniforms: auroraU, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
      vertexShader: 'varying vec2 vu; void main(){ vu = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float t; varying vec2 vu; void main(){ float bands = 0.5 + 0.5 * sin(vu.x * 38.0 + sin(vu.x * 7.0 + t * 0.3) * 3.0 + t * 0.15); float fall = pow(1.0 - vu.y, 1.6) * smoothstep(0.0, 0.18, vu.y); float a = fall * (0.35 + 0.65 * bands) * smoothstep(0.0, 0.12, vu.x) * smoothstep(1.0, 0.88, vu.x); vec3 c = mix(vec3(0.55,0.35,1.0), vec3(0.3,1.0,0.8), vu.y * 0.8); gl_FragColor = vec4(c * a * 0.55, 1.0); }'
    });
    [[-1400, 3400, 0.25], [900, 3600, -0.2], [2600, 2400, -0.7]].forEach(function (k) {
      var g = new T.PlaneGeometry(2400, 1100, 40, 1);
      var pos = g.attributes.position; for (var i = 0; i < pos.count; i++) { var x = pos.getX(i); pos.setZ(i, Math.sin(x / 300) * 220); }
      var m = new T.Mesh(g, mat); m.position.set(k[0], 900, -k[1]); m.rotation.y = k[2]; grp.add(m);
    });
    grp.renderOrder = -8; scene.add(grp); return grp;
  })();

  // the ringed giant over the basin
  var planet = (function () {
    var grp = new T.Group();
    var tex = canvasTex(256, 256, function (g, w, h) {
      var cols = ['#f3c99a', '#e8a98a', '#d8b3d8', '#f6dcb4', '#c99ad0', '#f0b98e', '#e6cde6'];
      for (var y = 0; y < h; y += 6) { g.fillStyle = cols[(y / 6 + ((y * 7) % 3)) % cols.length | 0]; g.fillRect(0, y, w, 7); }
      g.globalAlpha = 0.25; for (var i = 0; i < 40; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#9a6aa8'; g.fillRect(0, R() * h, w, 1 + R() * 3); }
    });
    var body = new T.Mesh(new T.SphereGeometry(330, 48, 32), new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
    var shade = new T.Mesh(new T.SphereGeometry(331, 48, 32), new T.ShaderMaterial({ transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vn; void main(){ vn = normalize(normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vn; void main(){ float d = dot(vn, normalize(vec3(-0.6,0.3,0.7))); gl_FragColor = vec4(0.05,0.03,0.12, smoothstep(0.25,-0.5,d) * 0.75); }' }));
    var rtex = canvasTex(512, 8, function (g, w, h) { for (var x = 0; x < w; x++) { var a = 0.15 + 0.6 * Math.abs(Math.sin(x * 0.11)) * (x % 37 < 4 ? 0.2 : 1); g.fillStyle = 'rgba(255,' + (210 + (x % 40)) + ',' + (190 + (x % 60)) + ',' + a.toFixed(2) + ')'; g.fillRect(x, 0, 1, h); } });
    var rg = new T.RingGeometry(420, 760, 128, 1);
    var p = rg.attributes.position, uv = rg.attributes.uv; for (var i = 0; i < p.count; i++) { var r = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (r - 420) / 340, 0.5); }
    var ring = new T.Mesh(rg, new T.MeshBasicMaterial({ map: rtex, transparent: true, side: T.DoubleSide, fog: false, depthWrite: false, opacity: 0.6 }));
    ring.rotation.x = -1.25; ring.rotation.y = 0.35;
    grp.add(body); grp.add(shade); grp.add(ring);
    grp.position.set(900, 950, -3800); grp.renderOrder = -7; scene.add(grp);
    grp.userData = { body: body, ring: ring };
    return grp;
  })();

  /* ---------------- lights and fog ---------------- */
  scene.fog = new T.FogExp2(PAL.day.fog, PAL.day.fogD);
  var hemi = new T.HemisphereLight(PAL.day.hemiS, PAL.day.hemiG, PAL.day.hemiI); scene.add(hemi);
  var sun = new T.DirectionalLight(PAL.day.sunC, PAL.day.sunI);
  var sunTarget = V(8, 120, 38);
  sun.position.copy(sunTarget).addScaledVector(SUN, 500); sun.target.position.copy(sunTarget);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  var sc = sun.shadow.camera; sc.left = -175; sc.right = 175; sc.top = 175; sc.bottom = -175; sc.near = 50; sc.far = 1100;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.08;
  scene.add(sun); scene.add(sun.target);
  var rose = new T.DirectionalLight(PAL.day.roseC, PAL.day.roseI); rose.position.copy(ROSE).multiplyScalar(400); scene.add(rose);

  /* ---------------- helpers ---------------- */
  function canvasTex(w, h, draw) { var c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); var t = new T.CanvasTexture(c); t.needsUpdate = true; return t; }
  var softDot = canvasTex(64, 64, function (g, w) { var gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  // non-indexed merge with a vertical value gradient baked into vertex colours (the painted light-to-dark on every crown)
  function bake(geos, lo, hi, jitter) {
    // smooth light: indexed shapes get averaged normals, loose blobs get normals from their own centre (soft painted crowns)
    var list = geos.map(function (g) {
      if (g.index) { g.computeVertexNormals(); return g.toNonIndexed(); }
      g.computeVertexNormals(); g.computeBoundingSphere();
      var c = g.boundingSphere.center, p = g.attributes.position, n = g.attributes.normal, v = new T.Vector3(), f = new T.Vector3();
      for (var i = 0; i < p.count; i++) { v.set(p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z).normalize(); f.set(n.getX(i), n.getY(i), n.getZ(i)); v.multiplyScalar(0.8).addScaledVector(f, 0.2).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
      g.userData.keepNormals = true; return g;
    });
    var n = 0; list.forEach(function (g) { n += g.attributes.position.count; });
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cl = new Float32Array(n * 3), o = 0, minY = 1e9, maxY = -1e9;
    list.forEach(function (g) { var p = g.attributes.position; for (var i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); } });
    list.forEach(function (g) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count;
    });
    for (var i = 0; i < n; i++) {
      var t = (pos[i * 3 + 1] - minY) / Math.max(1e-6, maxY - minY), v = lerp(lo, hi, Math.pow(t, 0.8)) * (1 + (R() - 0.5) * (jitter || 0.12));
      cl[i * 3] = v; cl[i * 3 + 1] = v; cl[i * 3 + 2] = v * 0.98;
    }
    var g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.BufferAttribute(pos, 3)); g2.setAttribute('normal', new T.BufferAttribute(nor, 3)); g2.setAttribute('color', new T.BufferAttribute(cl, 3));
    return g2;
  }
  function lumpy(g, amt) { var p = g.attributes.position; for (var i = 0; i < p.count; i++) { var k = 1 + (Wd.fbm(p.getX(i) * 9 + 3, p.getY(i) * 9 + p.getZ(i) * 5) - 0.5) * amt; p.setXYZ(i, p.getX(i) * k, p.getY(i) * (1 + (k - 1) * 0.5), p.getZ(i) * k); } return g; }

  // everything that belongs to one hole lives in WG; loading another hole throws the group away and builds a new one
  var WG = new T.Group(); scene.add(WG);
  /* ---------------- the land ---------------- */
  var SURF_COL = {
    short_grass_dry: [0x76b845, 0x98d25a], medium_grass_wet: [0x5a9a39, 0x74b043], deep_grass: [0x36622f, 0x4f7c36],
    rock_slab: [0x7f8576, 0x9a9b88], flagstone: [0xb5a487, 0xcbb999], hardpack_dirt: [0xbe9d70, 0xd3b688], moat_water: [0x25605e, 0x2f7570],
  };
  var _c1 = new T.Color(), _c2 = new T.Color();
  function landColor(x, y, z, slope, out) {
    var s = Wd.surfaceAt(x, y), pair = SURF_COL[s] || SURF_COL.deep_grass;
    var n1 = Wd.fbm(x / 7, y / 7), n2 = Wd.fbm(x / 1.9 + 11, y / 1.9 + 4);
    _c1.setHex(pair[0]); _c2.setHex(pair[1]); _c1.lerp(_c2, clamp(n1 * 0.7 + n2 * 0.5 - 0.2, 0, 1));
    if (s === 'short_grass_dry') { var stripe = (Math.floor((y + Math.sin(x / 9) * 2) / 6) % 2) ? 1.04 : 0.97; _c1.multiplyScalar(stripe); }
    if (s === 'deep_grass') {
      var d = Wd.outside(x, y);
      _c1.multiplyScalar(lerp(1, 0.72, clamp(d / 14, 0, 1)));                // forest floor in the shade of the canopy
      if (slope > 0.5) { _c2.setHex(n2 > 0.55 ? 0x6e6a5c : 0x5a6b45); _c1.lerp(_c2, clamp((slope - 0.5) * 1.6, 0, 0.85)); }   // steep: mossy rock
    }
    if (s === 'medium_grass_wet' && y > 150) { _c2.setHex(0x4fae64); _c1.lerp(_c2, 0.3); }   // the basin is wetter and bluer green
    out.copy(_c1);
  }
  function buildLand() {
    var B = Wd.bounds, X0 = B.x0, X1 = B.x1, Y0 = B.y0, Y1 = B.y1, S = 1.6;
    var nx = Math.round((X1 - X0) / S) + 1, ny = Math.round((Y1 - Y0) / S) + 1;
    var pos = new Float32Array(nx * ny * 3), cl = new Float32Array(nx * ny * 3), idx = [];
    var hgt = new Float32Array(nx * ny);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) { var x = X0 + i * S, y = Y0 + j * S; hgt[j * nx + i] = Wd.H(x, y); }
    var c = new T.Color();
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      var k = j * nx + i, x2 = X0 + i * S, y2 = Y0 + j * S, z = hgt[k];
      var zx = hgt[j * nx + Math.min(nx - 1, i + 1)] - hgt[j * nx + Math.max(0, i - 1)], zy = hgt[Math.min(ny - 1, j + 1) * nx + i] - hgt[Math.max(0, j - 1) * nx + i];
      var slope = Math.hypot(zx, zy) / (2 * S);
      pos[k * 3] = x2; pos[k * 3 + 1] = z; pos[k * 3 + 2] = -y2;
      landColor(x2, y2, z, slope, c); cl[k * 3] = c.r; cl[k * 3 + 1] = c.g; cl[k * 3 + 2] = c.b;
    }
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) { var a = j * nx + i, b = a + 1, d = a + nx, e = d + 1; idx.push(a, b, d, b, e, d); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true; WG.add(m);
    return { mesh: m, rect: [X0, X1, Y0, Y1] };
  }
  function boundsCentre() { var B = Wd.bounds; return { x: (B.x0 + B.x1) / 2, y: (B.y0 + B.y1) / 2 }; }
  // the far valley walls and peaks: painted forest, rock, snow
  function farZ(x, y, r, a) {
    var near = Math.min(Wd.H(x, y), 260);
    var ridge = 1 - Math.abs(2 * Wd.fbm(x / 520 + 7, y / 520 + 3) - 1), fwd = Math.sin(a);
    var valley = Wd.ss(0.45, 0.95, fwd) * (1 - Wd.ss(1300, 2800, r));
    var M = 80 + 720 * Math.pow(ridge, 1.7) * (1 - 0.8 * valley) + 60 * Wd.fbm(x / 90, y / 90);
    return lerp(near, M, Wd.ss(280, 1100, r));
  }
  // big simple conifers and crowns over the far slopes, so the walls of the valley read as forest
  function buildFarTrees(rect) {
    var C = boundsCentre(), N = 7000, cone = bake([new T.ConeGeometry(0.3, 1, 7, 1).translate(0, 0.5, 0)], 0.55, 1.1, 0.1), blob = bake([lumpy(new T.IcosahedronGeometry(0.5, 0), 0.3).translate(0, 0.5, 0)], 0.6, 1.1, 0.1);
    var mc = new T.InstancedMesh(cone, new T.MeshLambertMaterial({ vertexColors: true }), N), mb = new T.InstancedMesh(blob, new T.MeshLambertMaterial({ vertexColors: true }), N);
    [mc, mb].forEach(function (m) { withColors(m); m.count = 0; m.frustumCulled = false; WG.add(m); });
    var c = new T.Color();
    for (var i = 0; i < N * 2.2 && mc.count + mb.count < N * 1.7; i++) {
      var a = R() * Math.PI * 2, r = 190 + Math.pow(R(), 1.6) * 650, x = C.x + Math.cos(a) * r, y = C.y + Math.sin(a) * r;
      if (x > rect[0] + 6 && x < rect[1] - 6 && y > rect[2] + 6 && y < rect[3] - 6) continue;
      var z = farZ(x, y, r, a); if (z > 300 || z < Wd.WATER + 1) continue;
      var h = 18 + R() * 22, low = z < 60 && Math.sin(a) > 0.3;
      if (!low && R() < 0.6) { c.setHex(0x26503a).lerp(_c2.setHex(0x3a7046), R()); put(mc, x, y, z - 2, h * 0.9, h, h * 0.9, 0, c); }
      else { c.setHex(0x3f7a38).lerp(_c2.setHex(0x6aa242), R()); put(mb, x, y, z - 2, h * 0.9, h * 0.75, h * 0.9, R() * 6, c); }
    }
    [mc, mb].forEach(function (m) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
  }
  function buildFar(rect) {
    var C = boundsCentre(), rings = 46, segs = 160, pos = [], cl = [], idx = [];
    var c = new T.Color(), g1 = new T.Color(), g2 = new T.Color();
    for (var j = 0; j < rings; j++) {
      var r = 160 * Math.pow(3600 / 160, j / (rings - 1));
      for (var i = 0; i <= segs; i++) {
        var a = i / segs * Math.PI * 2, x = C.x + Math.cos(a) * r, y = C.y + Math.sin(a) * r;
        var z = farZ(x, y, r, a);
        if (x > rect[0] && x < rect[1] && y > rect[2] && y < rect[3]) z -= 4;   // the near land wins where the two overlap
        pos.push(x, z, -y);
        var nz = Wd.fbm(x / 60, y / 60);
        g1.setHex(nz > 0.5 ? 0x2f5f38 : 0x3f7440); g2.setHex(0x557f45);
        c.copy(g1).lerp(g2, Wd.fbm(x / 23, y / 23) * 0.6);
        if (z > 260) { g1.setHex(0x8a84a6); c.lerp(g1, Wd.ss(260, 430, z)); }
        if (z > 520 + 60 * nz) { g1.setHex(0xf1f3fb); c.lerp(g1, Wd.ss(520, 600, z - 60 * nz)); }
        cl.push(c.r, c.g, c.b);
      }
    }
    for (j = 0; j < rings - 1; j++) for (i = 0; i < segs; i++) { var p0 = j * (segs + 1) + i, p1 = p0 + 1, p2 = p0 + segs + 1, p3 = p2 + 1; idx.push(p0, p2, p1, p1, p2, p3); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })); WG.add(m); return m;
  }

  /* ---------------- glow: living light in the plants (Avatar) and neon line work (Tron) ---------------- */
  var BIO = { amt: { value: 0 }, t: { value: 0 } };
  var BIO_V = {
    under: 'float bioLow = 1.0 - smoothstep(0.0, 0.6, position.y); float bioDn = clamp(-objectNormal.y, 0.0, 1.0); float bioSpot = smoothstep(0.35, 0.95, 0.5 + 0.5 * sin(position.x * 23.0 + position.z * 7.0) * sin(position.z * 19.0 - position.y * 11.0)); vBio = bioP * (0.08 + 0.92 * bioLow) * (0.25 + 0.75 * bioDn) * (0.2 + 0.8 * bioSpot);',
    tips: 'vBio = bioP * smoothstep(0.18, 0.46, length(position.xz));',
    top: 'vBio = bioP * smoothstep(0.3, 0.8, position.y);',
    roots: 'float bioV = smoothstep(0.6, 1.0, sin(atan(position.z, position.x) * 15.0 + position.y * 40.0)); vBio = bioP * (1.0 - smoothstep(0.0, 0.06, position.y)) * (0.15 + 0.85 * bioV);',
  };
  function bioMat(mat, hex, mode, gain) {
    var c = new T.Color(hex).multiplyScalar(gain || 1);
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.bioAmt = BIO.amt; sh.uniforms.bioT = BIO.t; sh.uniforms.bioCol = { value: c };
      sh.vertexShader = 'varying float vBio;\nuniform float bioT;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n#ifdef USE_INSTANCING\nvec3 bioI = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);\n#else\nvec3 bioI = vec3(0.0);\n#endif\nfloat bioP = 0.62 + 0.38 * sin(bioT * 0.85 + bioI.x * 0.37 + bioI.z * 0.23);\n' + BIO_V[mode]);
      sh.fragmentShader = 'varying float vBio;\nuniform float bioAmt;\nuniform vec3 bioCol;\n' + sh.fragmentShader.replace('#include <fog_fragment>', 'gl_FragColor.rgb += bioCol * vBio * bioAmt;\n#include <fog_fragment>');
    };
    mat.customProgramCacheKey = function () { return 'bio-' + mode; };
    return mat;
  }
  var BIO_COL = { pine: [0x2f6dff, 'under', 0.24], broad: [0x8c55ff, 'under', 0.3], guardian: [0x1fe6c8, 'under', 0.44], oak: [0xb468ff, 'under', 0.36], palmF: [0xff4fd8, 'tips', 0.6], fern: [0x3dfcd8, 'tips', 0.75], bush: [0x2fc8ff, 'top', 0.5], gTrunk: [0x2ff0e0, 'roots', 0.5] };
  // flat neon strips on the ground from a list of [x0, y0, x1, y1] segments
  function ribbon(segs, w, hex, op) {
    var pos = new Float32Array(segs.length * 18), k = 0;
    segs.forEach(function (s) {
      var dx = s[2] - s[0], dy = s[3] - s[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2, z0 = Wd.G(s[0], s[1]) + 0.07, z1 = Wd.G(s[2], s[3]) + 0.07;
      var A = [s[0] + nx, z0, -(s[1] + ny)], B = [s[0] - nx, z0, -(s[1] - ny)], C = [s[2] - nx, z1, -(s[3] - ny)], D = [s[2] + nx, z1, -(s[3] + ny)];
      [A, B, C, A, C, D].forEach(function (v) { pos[k++] = v[0]; pos[k++] = v[1]; pos[k++] = v[2]; });
    });
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    var m = new T.Mesh(g, new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: true }));
    m.frustumCulled = false; WG.add(m); return m;
  }
  // the fairway outlined in light: marching squares over the fairway surface
  function buildNeon() {
    var b = Wd.bounds, st = 2, nx = Math.ceil((b.x1 - b.x0) / st) + 1, ny = Math.ceil((b.y1 - b.y0) / st) + 1, F = new Uint8Array(nx * ny), segs = [];
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) { var x = b.x0 + i * st, y = b.y0 + j * st; F[j * nx + i] = (!Wd.isWater(x, y) && Wd.surfaceAt(x, y) === 'short_grass_dry') ? 1 : 0; }
    for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
      var a = F[j * nx + i], bb = F[j * nx + i + 1], c = F[(j + 1) * nx + i + 1], d = F[(j + 1) * nx + i], code = a | (bb << 1) | (c << 2) | (d << 3);
      if (code === 0 || code === 15) continue;
      var x0 = b.x0 + i * st, y0 = b.y0 + j * st, h = st / 2, E0 = [x0 + h, y0], E1 = [x0 + st, y0 + h], E2 = [x0 + h, y0 + st], E3 = [x0, y0 + h];
      var L = { 1: [[E3, E0]], 2: [[E0, E1]], 3: [[E3, E1]], 4: [[E1, E2]], 5: [[E3, E0], [E1, E2]], 6: [[E0, E2]], 7: [[E3, E2]], 8: [[E2, E3]], 9: [[E0, E2]], 10: [[E0, E1], [E2, E3]], 11: [[E1, E2]], 12: [[E1, E3]], 13: [[E0, E1]], 14: [[E3, E0]] }[code];
      L.forEach(function (q) { segs.push([q[0][0], q[0][1], q[1][0], q[1][1]]); });
    }
    if (segs.length) glowOnly.push(ribbon(segs, 0.14, 0x34e8ff, 0.7));
    // the tee pad ringed in gold: the things you play with stay gold
    var tr = new T.Mesh(new T.TorusGeometry(Wd.elements ? 2.4 : 4.75, 0.05, 6, 72), new T.MeshBasicMaterial({ color: 0xffc25a, fog: false })); tr.rotation.x = Math.PI / 2; tr.position.copy(V(Wd.TEE.x, Wd.TEE.y + (Wd.elements ? 0 : -0.5), Wd.TEE_Z + 0.08)); WG.add(tr); glowOnly.push(tr);
  }
  // a glow ring at your feet when you walk at night
  var walkRing = new T.Mesh(new T.RingGeometry(0.42, 0.52, 48), new T.MeshBasicMaterial({ color: 0x45f0d8, transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
  walkRing.rotation.x = -Math.PI / 2; walkRing.visible = false; scene.add(walkRing);

  /* ---------------- plants ---------------- */
  // every crown is modelled in a unit box (radius 1, from y 0 to 1) and every trunk is a unit cylinder, so a tree
  // is drawn from the same numbers the physics uses: leaves from h*cb up to h with radius r, a trunk of radius tr
  var GEO = {}, TS = window.TreeSpec;
  function blobList(list, amt) { return list.map(function (b) { var g = lumpy(new T.IcosahedronGeometry(b[3], 1), amt || 0.4); if (b[4]) g.scale(1, b[4], 1); g.translate(b[0], b[1], b[2]); return g; }); }
  function ringOf(n, rad, y, r, flat, jit) { var out = []; for (var i = 0; i < n; i++) { var a = i / n * 6.283 + (jit || 0) * i; out.push([Math.cos(a) * rad, y + ((i % 2) - 0.5) * 0.06, Math.sin(a) * rad, r, flat]); } return out; }
  function makePlantGeos() {
    var c1 = lumpy(new T.ConeGeometry(1, 0.56, 11, 2), 0.3); c1.translate(0, 0.28, 0);
    var c2 = lumpy(new T.ConeGeometry(0.74, 0.46, 10, 2), 0.3); c2.translate(0, 0.52, 0);
    var c3 = lumpy(new T.ConeGeometry(0.46, 0.4, 9, 1), 0.3); c3.translate(0, 0.8, 0);
    GEO.pine = bake([c1, c2, c3], 0.5, 1.12, 0.14);
    GEO.broad = bake(blobList([[0, 0.5, 0, 0.5], [0.5, 0.42, 0.2, 0.42], [-0.48, 0.45, -0.25, 0.42], [0.1, 0.68, -0.1, 0.32], [-0.15, 0.4, 0.5, 0.38], [0.35, 0.56, -0.45, 0.36]]), 0.55, 1.12, 0.16);
    // the guardian: a layered umbrella, the lowest tier the widest, open air underneath
    GEO.guardian = bake(blobList(ringOf(7, 0.68, 0.2, 0.33, 0.5, 0.1).concat(ringOf(5, 0.42, 0.5, 0.33, 0.6, 0.3), [[0, 0.46, 0, 0.42, 0.7], [0.05, 0.8, 0, 0.3, 0.6]]), 0.35), 0.48, 1.15, 0.14);
    // the ancient oak: wide, heavy and lumpy
    GEO.oak = bake(blobList(ringOf(8, 0.68, 0.36, 0.34, 0.75, 0.2).concat(ringOf(5, 0.38, 0.62, 0.36, 0.8, 0.5), [[0, 0.55, 0, 0.45, 0.8], [0.1, 0.84, -0.05, 0.28, 0.6]]), 0.45), 0.5, 1.12, 0.16);
    var tg = new T.CylinderGeometry(0.62, 1, 1, 9, 3); tg.translate(0, 0.5, 0); GEO.trunk = bake([lumpy(tg, 0.15)], 0.72, 1.0, 0.1);
    // guardian trunk: pale and tall, buttress roots flaring out at the foot
    var gt = new T.CylinderGeometry(0.55, 1, 1, 15, 8), gp = gt.attributes.position;
    for (var i = 0; i < gp.count; i++) { var x = gp.getX(i), y = gp.getY(i) + 0.5, z = gp.getZ(i), a = Math.atan2(z, x), f = Math.max(0, 1 - y / 0.22), k = 1 + 2.2 * f * f * Math.max(0, Math.cos(a * 5)); gp.setXYZ(i, x * k, y, z * k); }
    GEO.gTrunk = bake([gt], 0.75, 1.05, 0.08);
    var lg = new T.CylinderGeometry(0.55, 1, 1, 7, 1); lg.translate(0, 0.5, 0); GEO.limb = bake([lg], 0.75, 0.95, 0.08);
    // palm trunk: a curved tube, base at the origin, crown at (1, 1, 0) in a frame scaled by lean and height
    var curve = new T.QuadraticBezierCurve3(new T.Vector3(0, 0, 0), new T.Vector3(0.1, 0.62, 0), new T.Vector3(1, 1, 0));
    GEO.palmTrunk = bake([new T.TubeGeometry(curve, 14, 0.02, 6, false)], 0.7, 1.05, 0.15);
    GEO.palmFronds = frondGeo(10, 0.42, 0.24, 0.085);
    GEO.fern = frondGeo(12, 0.5, -0.05, 0.11);
    var bb = [[0, 0.4, 0, 0.42], [0.3, 0.3, 0.1, 0.32], [-0.28, 0.32, -0.08, 0.34], [0.05, 0.55, -0.2, 0.28]].map(function (b) { var g = lumpy(new T.IcosahedronGeometry(b[3], 1), 0.45); g.translate(b[0], b[1], b[2]); return g; });
    GEO.bush = bake(bb, 0.55, 1.1, 0.15);
    var blades = []; for (i = 0; i < 5; i++) { var a2 = i / 5 * Math.PI * 2 + R(); var pg = new T.PlaneGeometry(0.06, 0.5, 1, 2); var pp = pg.attributes.position; for (var q = 0; q < pp.count; q++) { var yy = pp.getY(q) + 0.25; pp.setXYZ(q, pp.getX(q) * (1 - yy * 1.6), yy, yy * yy * 0.5); } pg.rotateY(a2); blades.push(pg); }
    GEO.tuft = bake(blades, 0.55, 1.2, 0.2);
    GEO.flower = new T.IcosahedronGeometry(0.11, 0);
  }
  // fronds radiating from a point, arching out and drooping (palms) or rising (ferns)
  function frondGeo(n, len, lift, wid) {
    var geos = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + (R() - 0.5) * 0.3, ca = Math.cos(a), sa = Math.sin(a), segs = 8, pos = [], L = len * (0.85 + R() * 0.3), up = lift + (R() - 0.5) * 0.08;
      for (var s = 0; s <= segs; s++) {
        var u = s / segs, w = wid * Math.sin(Math.PI * Math.min(1, u * 1.15)) + 0.004;
        var r = L * u, h = up * u * 1.2 - (0.3 + (lift > 0 ? 0.55 : 0.2)) * u * u * len;
        var cx = ca * r, cz = sa * r, px = -sa * w, pz = ca * w;
        pos.push([[cx + px, h + w * 0.25, cz + pz], [cx - px, h + w * 0.25, cz - pz], [cx, h + w * 0.55, cz]]);
      }
      var v = [];
      for (s = 0; s < segs; s++) {
        var A = pos[s], B = pos[s + 1];
        v.push(A[0][0], A[0][1], A[0][2], B[0][0], B[0][1], B[0][2], A[2][0], A[2][1], A[2][2]);
        v.push(A[2][0], A[2][1], A[2][2], B[0][0], B[0][1], B[0][2], B[2][0], B[2][1], B[2][2]);
        v.push(A[1][0], A[1][1], A[1][2], A[2][0], A[2][1], A[2][2], B[1][0], B[1][1], B[1][2]);
        v.push(A[2][0], A[2][1], A[2][2], B[2][0], B[2][1], B[2][2], B[1][0], B[1][1], B[1][2]);
      }
      var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3)); geos.push(g);
    }
    return bake(geos, 0.6, 1.15, 0.15);
  }
  var PLANT_COL = {
    pine: [[0x2b5838, 0x3d7346], [0x2f6a5e, 0x3a7a62]], broad: [[0x4a8a3a, 0x79a93f], [0x3f9a6a, 0x5fae5a]],
    palm: [[0x4c9c3e, 0x7cc050], [0x5aae48, 0x8ccf58]], bush: [[0x3c7838, 0x5e9a3c], [0x3f8a50, 0x5aa65a]], fern: [[0x48a650, 0x6fc062], [0x48a650, 0x6fc062]],
    guardian: [[0x2c6650, 0x4a8c5a], [0x2a7a6c, 0x45a07c]], oak: [[0x5b7c2e, 0x8aa640], [0x6e8c34, 0xa6b84a]],
  };
  var BARK = { pine: [0x5a3f2c, 0x80603e], broad: [0x5a3f2c, 0x80603e], guardian: [0x9c917c, 0xc2b597], oak: [0x4b3b2b, 0x6a543c] };
  var plantMats = [], PG = null, crownMeshes = [], seeThrough = false;
  function inst(geo, count, opts) {
    var mat = new T.MeshLambertMaterial({ vertexColors: true, side: opts && opts.side || T.FrontSide });
    if (opts && opts.bio) bioMat(mat, opts.bio[0], opts.bio[1], opts.bio[2]);
    var m = new T.InstancedMesh(geo, mat, Math.max(1, count));
    m.castShadow = !(opts && opts.noShadow); m.receiveShadow = false; withColors(m); m.count = 0; m.frustumCulled = false;
    plantMats.push(m.material); (PG || WG).add(m); return m;
  }
  // r128 sizes instanceColor from .count on first use, so give every instanced mesh its colour buffer up front
  function withColors(m) { m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3).fill(1), 3); return m; }
  var _m = new T.Matrix4(), _q = new T.Quaternion(), _s = new T.Vector3(), _p = new T.Vector3(), _e = new T.Euler(), _cc = new T.Color(), _up = new T.Vector3(0, 1, 0), _dv = new T.Vector3();
  function put(mesh, x, y, z, sx, sy, sz, yaw, colr) {
    _e.set(0, yaw || 0, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, z, -y);
    _m.compose(_p, _q, _s); mesh.setMatrixAt(mesh.count, _m);
    if (colr) mesh.setColorAt(mesh.count, colr);
    mesh.count++;
  }
  // a unit cylinder (y 0..1) stretched from engine point a to b
  function segMatrix(a, b, r) { _dv.set(b.x - a.x, b.z - a.z, -(b.y - a.y)); var len = _dv.length() || 1e-6; _dv.divideScalar(len); _q.setFromUnitVectors(_up, _dv); _s.set(r, len, r); _p.set(a.x, a.z, -a.y); return _m.compose(_p, _q, _s); }
  function putSeg(mesh, a, b, r, colr) { mesh.setMatrixAt(mesh.count, segMatrix(a, b, r)); if (colr) mesh.setColorAt(mesh.count, colr); mesh.count++; }
  function plantColor(type, c, x, y) {
    var P = PLANT_COL[type] || PLANT_COL.broad, accent = Wd.fbm(x / 35 + 5, y / 35) > 0.66;
    var pair = accent ? P[1] : P[0];
    _cc.setHex(pair[0]).lerp(_c2.setHex(pair[1]), c);
    if (type === 'broad' && c > 0.965) _cc.setHex(c > 0.985 ? 0xd9b44a : 0xc8709a);    // a few alien crowns, gold and rose
    if (type === 'guardian' && c > 0.93) _cc.setHex(0x3f8f9a);                          // the odd blue-green giant
    return _cc;
  }
  function buildPlants(list, keepGeo) {
    if (!keepGeo || !GEO.pine) makePlantGeos();
    if (PG) { WG.remove(PG); PG.children.forEach(function (m) { m.material.dispose(); m.dispose && m.dispose(); }); }
    PG = new T.Group(); WG.add(PG); plantMats = [];
    var n = { pine: 0, broad: 0, palm: 0, bush: 0, fern: 0, guardian: 0, oak: 0 }; list.forEach(function (p) { n[p.type]++; });
    var M = {
      pine: inst(GEO.pine, n.pine, { bio: BIO_COL.pine }), broad: inst(GEO.broad, n.broad, { bio: BIO_COL.broad }), guardian: inst(GEO.guardian, n.guardian, { bio: BIO_COL.guardian }), oak: inst(GEO.oak, n.oak, { bio: BIO_COL.oak }),
      trunk: inst(GEO.trunk, n.pine + n.broad + n.oak), gTrunk: inst(GEO.gTrunk, n.guardian, { bio: BIO_COL.gTrunk }), limb: inst(GEO.limb, n.oak * 4 + n.guardian * 3),
      palmT: inst(GEO.palmTrunk, n.palm), palmF: inst(GEO.palmFronds, n.palm, { side: T.DoubleSide, bio: BIO_COL.palmF }), bush: inst(GEO.bush, n.bush, { bio: BIO_COL.bush }), fern: inst(GEO.fern, n.fern, { side: T.DoubleSide, bio: BIO_COL.fern }),
    };
    crownMeshes = [M.pine, M.broad, M.guardian, M.oak, M.palmF];
    var trunk = new T.Color();
    list.forEach(function (p) {
      if (p.base == null) TS.norm(p);
      var col = plantColor(p.type, p.c, p.x, p.y).clone();
      if (p.type === 'pine' || p.type === 'broad' || p.type === 'guardian' || p.type === 'oak') {
        var B = BARK[p.type]; trunk.setHex(B[0]).lerp(_c2.setHex(B[1]), p.c);
        var top = p.type === 'pine' ? p.h * 0.92 : p.base + p.crownH * (p.type === 'oak' ? 0.25 : p.type === 'guardian' ? 0.35 : 0.42), tr = Math.max(0.12, p.tr);
        put(p.type === 'guardian' ? M.gTrunk : M.trunk, p.x, p.y, p.z - 0.3, tr, top + 0.3, tr, p.rot, trunk);
        put(M[p.type], p.x, p.y, p.z + p.base, p.r, p.crownH, p.r, p.rot, col);
        if (p.type === 'guardian' || p.type === 'oak') TS.solids(p).forEach(function (s) { if (s.mat === 'branch') putSeg(M.limb, s.a, s.b, s.r * 1.15, trunk); });
      } else if (p.type === 'palm') {
        var L = Wd.palmLean(p) * p.h; trunk.setHex(0x8a6c4c).lerp(_c2.setHex(0xa98a62), p.c);
        put(M.palmT, p.x, p.y, p.z - 0.2, L, p.h, p.h, p.rot, trunk);
        put(M.palmF, p.x + Math.cos(p.rot) * L, p.y + Math.sin(p.rot) * L, p.z + p.h, p.h * 0.95, p.h * 0.95, p.h * 0.95, p.rot * 3.1, col);
      } else if (p.type === 'bush') put(M.bush, p.x, p.y, p.z - 0.15, p.r * 1.4, p.h, p.r * 1.4, p.rot, col);
      else put(M.fern, p.x, p.y, p.z + p.h * 0.35, p.r * 2.2, p.h * 1.1, p.r * 2.2, p.rot, col);
    });
    Object.keys(M).forEach(function (k) { M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; });
    return M;
  }
  // fade the leaves so you can see out of the woods (the trunks stay solid)
  function setSee(on) {
    if (seeThrough === on) return; seeThrough = on;
    crownMeshes.forEach(function (m) { m.material.transparent = on; m.material.opacity = on ? 0.2 : 1; m.material.depthWrite = !on; m.material.needsUpdate = true; });
  }
  // tufts and flowers: the lush layer along every edge and through the basin
  var flowerMats = {};
  function buildUnderstory() {
    var tufts = new T.InstancedMesh(GEO.tuft, bioMat(new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }), 0x22c8b0, 'top', 0.45), 11000); withColors(tufts); tufts.count = 0; tufts.frustumCulled = false; WG.add(tufts);
    var flowers = new T.InstancedMesh(GEO.flower, new T.MeshLambertMaterial({ color: 0xffffff }), 6500); withColors(flowers); flowers.count = 0; flowers.frustumCulled = false; WG.add(flowers);
    flowerMats.day = flowers.material; flowerMats.glow = new T.MeshBasicMaterial({ color: 0x9a8cff });
    var tc = new T.Color(), FC = [0xa77bdb, 0xf2c14e, 0xf28b3c, 0xf3efe6, 0xe45aa8, 0x7fd0ff];
    var tries = 0;
    while ((tufts.count < 11000 || flowers.count < 6500) && tries++ < 90000) {
      var y = lerp(Wd.SCATTER.y0, Wd.SCATTER.y1, R()), L = Wd.leftBound(y), Rb = Wd.rightBound(y);
      var x = lerp(L - 26, Rb + 26, R()), d = Wd.outside(x, y);
      if (Wd.isWater(x, y) || Wd.H(x, y) < Wd.WATER + 0.2) continue;
      if (Math.hypot(x - Wd.TEE.x, y - Wd.TEE.y) < 5) continue;
      var s = Wd.surfaceAt(x, y), z = Wd.H(x, y);
      if (s === 'rock_slab' || s === 'flagstone') continue;
      var basin = y > 155;
      var okT = d > -6 || (basin && R() < 0.06), okF = (d > -3 && d < 16) || (basin && d > -14 && R() < 0.5);
      if (okT && tufts.count < 11000) { tc.setHex(0x5a9a3a).lerp(_c2.setHex(0x8cc850), R()); if (d > 6) tc.multiplyScalar(0.75); var sc2 = 0.8 + R() * 1.1; put(tufts, x, y, z - 0.05, sc2, sc2 * (0.8 + R() * 0.8), sc2, R() * 6.28, tc); }
      if (okF && flowers.count < 6500 && R() < 0.55) {
        var cx2 = x, cy2 = y, cn = 1 + (R() * 4 | 0), fc = FC[(Wd.fbm(x / 18, y / 18) * 9 + R() * 1.5 | 0) % FC.length];
        for (var q = 0; q < cn && flowers.count < 6500; q++) { var fx = cx2 + (R() - 0.5) * 1.2, fy = cy2 + (R() - 0.5) * 1.2; put(flowers, fx, fy, Wd.H(fx, fy) + 0.18 + R() * 0.25, 1, 1, 1, R() * 6, tc.setHex(fc)); }
      }
    }
    [tufts, flowers].forEach(function (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    return { tufts: tufts, flowers: flowers };
  }

  /* ---------------- stone: moss walls, tee, sign ---------------- */
  var glowOnly = [], dayOnly = [];
  function buildStone(solids) {
    var walls = solids.filter(function (s) { return s.kind === 'box' && !ELEM_BOX[s.name]; });
    var stone = new T.InstancedMesh(lumpy(new T.BoxGeometry(1, 1, 1, 4, 3, 2), 0.12), new T.MeshLambertMaterial({ color: 0xffffff }), walls.length);
    var moss = new T.InstancedMesh(lumpy(new T.BoxGeometry(1, 1, 1, 4, 1, 2), 0.25), new T.MeshLambertMaterial({ color: 0xffffff }), walls.length);
    var edge = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0x7dffcf }), walls.length);
    [stone, moss].forEach(withColors);
    [stone, moss, edge].forEach(function (m) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; WG.add(m); });
    edge.castShadow = false; edge.receiveShadow = false;
    var c = new T.Color();
    walls.forEach(function (w) {
      var h = w.z1 - w.z0;
      c.setHex(0x86857a).lerp(_c2.setHex(0x9c9786), R());
      put(stone, w.x, w.y, w.z0 + h / 2, w.hx * 2 + 0.05, h, w.hy * 2, w.yaw, c);
      c.setHex(0x4f8a3a).lerp(_c2.setHex(0x6fa846), R());
      put(moss, w.x, w.y, w.z1 + 0.02, w.hx * 2 + 0.25, 0.22, w.hy * 2 + 0.35, w.yaw, c);
      // the glow line runs along the outer (downhill) lip of the wall top
      var ox = -Math.sin(w.yaw) * (w.hy + 0.12), oy = Math.cos(w.yaw) * (w.hy + 0.12);
      put(edge, w.x + ox, w.y + oy, w.z1 + 0.06, w.hx * 2 + 0.2, 0.07, 0.07, w.yaw, null);
    });
    [stone, moss, edge].forEach(function (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    glowOnly.push(edge);
    // the tee: a stone shelf off the mountain
    var tx = Wd.TEE.x, ty = Wd.TEE.y, pad;
    if (Wd.elements) {
      // built holes: a stone slab, 1.8 by 4 m, laid along the line to the basket
      pad = new T.Mesh(new T.BoxGeometry(1.8, 0.5, 4.2), new T.MeshLambertMaterial({ color: 0xb9a888 }));
      pad.position.copy(V(tx, ty, Wd.TEE_Z - 0.19)); pad.rotation.y = Math.atan2(Wd.BASKET.x - tx, Wd.BASKET.y - ty) * -1;
    } else {
      pad = new T.Mesh(lumpy(new T.CylinderGeometry(4.6, 5.4, 2.2, 11, 2), 0.06), new T.MeshLambertMaterial({ color: 0xb9a888 }));
      pad.position.copy(V(tx, ty - 0.5, Wd.TEE_Z - 1.08));
    }
    pad.receiveShadow = true; pad.castShadow = true; WG.add(pad);
    var brickDay = new T.MeshLambertMaterial({ color: 0x8b8a7f }), brickGlow = new T.MeshBasicMaterial({ color: 0x1c8f86 });
    var bricks = [];
    (Wd.elements ? [] : [[-1.3, 1.6], [1.3, 1.6], [-1.3, -1.6], [1.3, -1.6]]).forEach(function (b) { var m = new T.Mesh(new T.BoxGeometry(0.5, 0.18, 0.28), brickDay); m.position.copy(V(tx + b[0], ty + b[1], Wd.TEE_Z + 0.09)); WG.add(m); bricks.push(m); });
    // the tee sign
    var signTex = canvasTex(512, 300, function (g, w, h) {
      g.fillStyle = '#5b3d27'; g.fillRect(0, 0, w, h); g.fillStyle = '#6d4a30'; for (var i = 0; i < 6; i++) g.fillRect(0, i * 50 + 3, w, 44);
      g.fillStyle = '#f6efdf'; g.textAlign = 'center';
      var H0 = Wd.HOLE, ft = Math.round(Math.hypot(Wd.BASKET.x - Wd.TEE.x, Wd.BASKET.y - Wd.TEE.y) / FT), dz = Math.round((Wd.TEE_Z - Wd.H(Wd.BASKET.x, Wd.BASKET.y)) / FT);
      g.font = '800 120px Alegreya, Georgia, serif'; g.fillText(String(H0.number || ''), w / 2, 120);
      var nm = String(H0.name || '').toUpperCase(), fs = 44; g.font = '800 ' + fs + 'px Alegreya, Georgia, serif'; while (g.measureText(nm).width > w - 40 && fs > 20) { fs -= 2; g.font = '800 ' + fs + 'px Alegreya, Georgia, serif'; } g.fillText(nm, w / 2, 180);
      g.font = '700 32px "Alegreya Sans", sans-serif'; g.fillStyle = '#f2c14e'; g.fillText('PAR ' + H0.par + '  ·  ' + ft + ' FT' + (Math.abs(dz) > 5 ? '  ·  ' + (dz > 0 ? 'DOWN ' : 'UP ') + Math.abs(dz) : ''), w / 2, 236);
    });
    var sign = new T.Group();
    var board = new T.Mesh(new T.BoxGeometry(1.7, 1.0, 0.08), [0, 0, 0, 0, new T.MeshLambertMaterial({ map: signTex }), new T.MeshLambertMaterial({ color: 0x5b3d27 })].map(function (m) { return m || new T.MeshLambertMaterial({ color: 0x5b3d27 }); }));
    board.position.y = 1.4; sign.add(board);
    var post = new T.Mesh(new T.BoxGeometry(0.12, 1.2, 0.12), new T.MeshLambertMaterial({ color: 0x4a3322 })); post.position.y = 0.6; sign.add(post);
    sign.position.copy(V(tx - 4.2, ty + 1.2, Wd.TEE_Z)); sign.rotation.y = 0.45; WG.add(sign);
    return { bricks: bricks, brickDay: brickDay, brickGlow: brickGlow };
  }

  /* ---------------- built elements: logs, boulders, columns, ruins, monoliths, heads, rings, discs, pyramids ---------------- */
  var ELEM_BOX = { 'Stone arch': 1, 'Ruin wall': 1, 'Monolith': 1, 'Step pyramid': 1, 'carved head': 1, 'disc sculpture': 1 };
  function buildElements(solids) {
    var grp = new T.Group(); WG.add(grp);
    var sand = new T.MeshLambertMaterial({ vertexColors: true }), basalt = new T.MeshLambertMaterial({ color: 0x4a4656 }), rockM = new T.MeshLambertMaterial({ vertexColors: true }),
      bark = new T.MeshLambertMaterial({ color: 0x5d4532 }), wood = new T.MeshLambertMaterial({ color: 0xcfae80 }), mossM = new T.MeshLambertMaterial({ color: 0x5f9a40 }),
      runeGlow = new T.MeshBasicMaterial({ color: 0x7dffcf }), goldGlow = new T.MeshBasicMaterial({ color: 0x3ff0ff }), magGlow = new T.MeshBasicMaterial({ color: 0xff4fd8 }), eyeGlow = new T.MeshBasicMaterial({ color: 0x6ff3ff }), dark = new T.MeshLambertMaterial({ color: 0x1d1a24 }), headM = new T.MeshLambertMaterial({ color: 0xa89a7e });
    function mesh(g, m, shadow) { var o = new T.Mesh(g, m); o.castShadow = shadow !== false; o.receiveShadow = true; grp.add(o); return o; }
    function glowMesh(g, m) { var o = new T.Mesh(g, m); grp.add(o); glowOnly.push(o); return o; }
    // vertex-painted stone: weathered colour, moss on whatever faces the sky
    function painted(g, c0, c1, mossUp) {
      if (g.index) g = g.toNonIndexed(); g.computeVertexNormals();
      var p = g.attributes.position, nn = g.attributes.normal, cl = new Float32Array(p.count * 3), c = new T.Color(), m = new T.Color(0x5a9a3e);
      for (var i = 0; i < p.count; i++) { c.setHex(c0).lerp(_c2.setHex(c1), Wd.fbm(p.getX(i) * 2.1 + 7, p.getY(i) * 2.1 + p.getZ(i) * 1.3)); if (mossUp && nn.getY(i) > 0.55 && Wd.fbm(p.getX(i) * 3, p.getZ(i) * 3) > 0.42) c.lerp(m, 0.8); cl[i * 3] = c.r; cl[i * 3 + 1] = c.g; cl[i * 3 + 2] = c.b; }
      g.setAttribute('color', new T.BufferAttribute(cl, 3)); return g;
    }
    var boxGeo = painted(lumpy(new T.BoxGeometry(1, 1, 1, 4, 3, 2), 0.08), 0xb39d78, 0xc9b590, true), unitBox = new T.BoxGeometry(1, 1, 1);
    solids.forEach(function (s) {
      var nm = s.name || '';
      if (s.kind === 'box' && ELEM_BOX[nm]) {
        var h = s.z1 - s.z0, o = mesh(boxGeo, nm === 'Monolith' ? basalt : sand);
        o.position.copy(V(s.x, s.y, s.z0 + h / 2)); o.rotation.y = s.yaw; o.scale.set(s.hx * 2, h, s.hy * 2);
        if (nm === 'Monolith') {
          // runes down both broad faces, lit at night
          for (var side = -1; side <= 1; side += 2) for (var k = 0; k < 4; k++) { var rr = glowMesh(unitBox, runeGlow), u = side * (s.hx + 0.02), zz = s.z0 + h * (0.35 + k * 0.14); rr.position.copy(V(s.x + Math.cos(s.yaw) * u, s.y + Math.sin(s.yaw) * u, zz)); rr.rotation.y = s.yaw; rr.scale.set(0.04, h * 0.07, s.hy * (0.5 - (k % 2) * 0.2)); }
        }
        if (nm === 'Step pyramid') {
          // a gold line round the lip of every tier, lit at night
          var c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
          [[0, s.hy, s.hx * 2, 0.08], [0, -s.hy, s.hx * 2, 0.08], [s.hx, 0, 0.08, s.hy * 2], [-s.hx, 0, 0.08, s.hy * 2]].forEach(function (e) { var g2 = glowMesh(unitBox, goldGlow); g2.position.copy(V(s.x + c * e[0] - sn * e[1], s.y + sn * e[0] + c * e[1], s.z1 + 0.04)); g2.rotation.y = s.yaw; g2.scale.set(e[2], 0.08, e[3]); });
        }
      } else if (s.kind === 'sphere' && nm === 'boulder') {
        var bg = painted(lumpy(new T.IcosahedronGeometry(1, 2), 0.55), 0x7c7c74, 0x9d9a8c, true), b = mesh(bg, rockM);
        b.position.copy(V(s.x, s.y, s.z)); b.scale.set(s.r * 1.05, s.r * 0.92, s.r); b.rotation.y = (s.x * 7.1 + s.y * 3.3) % 6.28;
      } else if (s.kind === 'capsule' && nm === 'massive log') {
        var lg = new T.CylinderGeometry(1, 1, 1, 16, 1), lp = lg.attributes.position;
        for (var i = 0; i < lp.count; i++) { var a = Math.atan2(lp.getZ(i), lp.getX(i)), q = 1 + 0.06 * Math.sin(a * 9) + 0.04 * Math.sin(a * 4 + lp.getY(i) * 6); lp.setXYZ(i, lp.getX(i) * q, lp.getY(i) + 0.5, lp.getZ(i) * q); }
        var lgM = new T.Mesh(lg, [bark, wood, wood]); lgM.castShadow = lgM.receiveShadow = true; grp.add(lgM);
        segMatrix(s.a, s.b, s.r).decompose(lgM.position, lgM.quaternion, lgM.scale);
        // moss along the top, and a couple of broken limbs
        var len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z), nM = Math.max(2, Math.round(len / 2.2));
        for (k = 0; k < nM; k++) { var f = (k + 0.5) / nM, mx = lerp(s.a.x, s.b.x, f), my = lerp(s.a.y, s.b.y, f), mz = lerp(s.a.z, s.b.z, f) + s.r * 0.86; var mm = mesh(new T.IcosahedronGeometry(1, 1), mossM, false); mm.position.copy(V(mx, my, mz)); mm.scale.set(s.r * 0.7, s.r * 0.18, s.r * 0.7); }
        for (k = 0; k < 2; k++) { var f2 = 0.3 + k * 0.4, sx = lerp(s.a.x, s.b.x, f2), sy = lerp(s.a.y, s.b.y, f2), sz = lerp(s.a.z, s.b.z, f2), ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) + (k ? 1.9 : -1.6); var st = new T.Mesh(new T.CylinderGeometry(0.55, 1, 1, 7).translate(0, 0.5, 0), bark); st.castShadow = true; grp.add(st); segMatrix({ x: sx, y: sy, z: sz + s.r * 0.3 }, { x: sx + Math.cos(ang) * s.r * 1.9, y: sy + Math.sin(ang) * s.r * 1.9, z: sz + s.r * 1.4 }, s.r * 0.22).decompose(st.position, st.quaternion, st.scale); }
      } else if (s.kind === 'cyl' && nm === 'column') {
        var ch = s.z1 - s.z0, cg = new T.CylinderGeometry(0.94, 1, 1, 24, 1), cp = cg.attributes.position;
        for (i = 0; i < cp.count; i++) { var ca = Math.atan2(cp.getZ(i), cp.getX(i)), fl = 1 - 0.05 * Math.max(0, Math.cos(ca * 12)); cp.setXYZ(i, cp.getX(i) * fl, cp.getY(i) + 0.5, cp.getZ(i) * fl); }
        var col = mesh(painted(cg, 0xc8b892, 0xd9caa6, false), sand); col.position.copy(V(s.x, s.y, s.z0)); col.scale.set(s.r, ch, s.r);
        var plinth = mesh(boxGeo, sand); plinth.position.copy(V(s.x, s.y, s.z0 + 0.45)); plinth.scale.set(s.r * 2.5, 0.5, s.r * 2.5);
        if (ch > 4) { var cap = mesh(boxGeo, sand); cap.position.copy(V(s.x, s.y, s.z1 + 0.18)); cap.scale.set(s.r * 2.7, 0.38, s.r * 2.7); }
        else { var rubble = mesh(painted(lumpy(new T.DodecahedronGeometry(1, 0), 0.4), 0xb8a885, 0xcab993, false), rockM); rubble.position.copy(V(s.x + s.r * 1.6, s.y + s.r * 0.4, Wd.H(s.x + s.r * 1.6, s.y) + 0.2)); rubble.scale.setScalar(s.r * 0.7); }
      }
    });
    // the pieces drawn from the element itself: carved heads, stone rings, disc sculptures
    (Wd.elements ? Wd.elements() : []).forEach(function (o) {
      var g = Wd.H(o.x, o.y), yaw = o.yaw || 0;
      if (o.k === 'head') {
        var hg = new T.Group(); hg.position.copy(V(o.x, o.y, g + o.s * 0.62)); hg.rotation.y = yaw; hg.scale.setScalar(o.s); grp.add(hg);
        var stoneH = painted(lumpy(new T.SphereGeometry(0.5, 20, 16), 0.12), 0x9b8e74, 0xb7a988, true);
        function part(geo, m, x, y, z, sx, sy, sz) { var q = new T.Mesh(geo, m); q.position.set(x, y, z); q.scale.set(sx, sy, sz); q.castShadow = true; hg.add(q); return q; }
        // the face looks along +u (the yaw direction): +x in this group's frame
        part(stoneH, sand, 0, 0.02, 0, 0.92, 1.12, 0.96);
        part(unitBox, headM, 0.4, 0.16, 0, 0.12, 0.08, 0.72);                      // brow
        part(unitBox, headM, 0.47, -0.02, 0, 0.12, 0.26, 0.14);                    // nose
        part(unitBox, headM, 0.42, -0.26, 0, 0.1, 0.06, 0.4);                      // mouth line
        part(unitBox, headM, -0.02, 0.56, 0, 0.6, 0.1, 0.7);                       // flat crown
        [-0.18, 0.18].forEach(function (zz) { part(new T.SphereGeometry(0.09, 10, 8), dark, 0.4, 0.06, zz, 1, 1, 1); var e = new T.Mesh(new T.SphereGeometry(0.055, 10, 8), eyeGlow); e.position.set(0.45, 0.06, zz); hg.add(e); glowOnly.push(e); });
      } else if (o.k === 'ring' || o.k === 'disc') {
        var isRing = o.k === 'ring', tt = isRing ? Math.max(0.35, o.r * 0.16) : Math.max(0.3, o.r * 0.1), cz = isRing ? g + o.r + tt * 0.4 : g + o.r * 0.92;
        var rgp = new T.Group(); rgp.position.copy(V(o.x, o.y, cz)); rgp.rotation.y = yaw + Math.PI / 2; grp.add(rgp);
        if (isRing) {
          var tor = new T.Mesh(painted(lumpy(new T.TorusGeometry(o.r, tt, 10, 44), 0.06), 0x8f8a7c, 0xaaa392, true), rockM); tor.castShadow = true; rgp.add(tor);
          var rune = new T.Mesh(new T.TorusGeometry(o.r - tt * 0.95, 0.05, 6, 64), runeGlow); rgp.add(rune); glowOnly.push(rune);
          // the stone it stands on
          var foot = mesh(boxGeo, sand); foot.position.copy(V(o.x, o.y, g + 0.2)); foot.rotation.y = yaw; foot.scale.set(tt * 2.6, 0.7, tt * 3.4);
        } else {
          var prof = [[0.001, -0.08], [0.9, -0.1], [1, -0.04], [1, 0.04], [0.92, 0.1], [0.001, 0.11]].map(function (p) { return new T.Vector2(p[0], p[1]); });
          var dg = new T.LatheGeometry(prof, 48); dg.rotateX(Math.PI / 2);
          var hue = [0xf2a13b, 0xe23a6a, 0x5fd0c8, 0xc9a0ff][Math.abs(Math.round(o.x + o.y)) % 4];
          var dm = new T.Mesh(dg, new T.MeshPhongMaterial({ color: hue, shininess: 60, specular: 0x444444 })); dm.scale.setScalar(o.r); dm.castShadow = true; rgp.add(dm);
          var stamp = new T.Mesh(new T.CircleGeometry(0.5, 32), new T.MeshLambertMaterial({ color: 0xfff3df })); stamp.position.z = 0.112; dm.add(stamp);
          var stamp2 = stamp.clone(); stamp2.position.z = -0.082; stamp2.rotation.y = Math.PI; dm.add(stamp2);
          var rim = new T.Mesh(new T.TorusGeometry(o.r * 1.0, 0.06, 6, 64), magGlow); rgp.add(rim); glowOnly.push(rim);
        }
      }
    });
  }
  /* ---------------- Flightline paths: lanterns along each lane ---------------- */
  function buildPaths() {
    var list = Wd.paths ? Wd.paths() : [], spots = [];
    list.forEach(function (o) {
      for (var k = 0; k < o.pts.length - 1; k++) {
        var a = o.pts[k], b = o.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / (L || 1), uy = (b[1] - a[1]) / (L || 1);
        for (var s = (k ? 0 : 4); s < L; s += 10) { var x = a[0] + ux * s, y = a[1] + uy * s, sd = ((spots.length % 2) ? 1 : -1) * (o.w / 2 + 0.4); spots.push([x - uy * sd, y + ux * sd, o.mode]); }
      }
    });
    if (!spots.length) return null;
    var post = new T.InstancedMesh(new T.CylinderGeometry(0.05, 0.07, 1.3, 6).translate(0, 0.65, 0), new T.MeshLambertMaterial({ color: 0x3a2c22 }), spots.length);
    var lampDay = new T.MeshLambertMaterial({ color: 0xf2d79a, emissive: 0x3a2a00 }), lampGlow = new T.MeshBasicMaterial({ color: 0x6ff3e0 });
    var lamp = new T.InstancedMesh(new T.OctahedronGeometry(0.17, 0), lampDay, spots.length);
    [post, lamp].forEach(function (m) { m.count = 0; m.frustumCulled = false; WG.add(m); });
    var halo = points(spots.length, 0.9, 0x6ff3e0, 0.75, true, 16), hp = halo.geometry.attributes.position.array;
    spots.forEach(function (p, i) { var z = Wd.G(p[0], p[1]); put(post, p[0], p[1], z, 1, 1, 1, 0); put(lamp, p[0], p[1], z + 1.45, 1, 1.4, 1, 0.6); hp[i * 3] = p[0]; hp[i * 3 + 1] = z + 1.45; hp[i * 3 + 2] = -p[1]; });
    [post, lamp].forEach(function (m) { m.instanceMatrix.needsUpdate = true; });
    halo.geometry.attributes.position.needsUpdate = true; glowOnly.push(halo);
    // light strips along both edges of every lane, Tron style: teal for tunnels, violet for open lanes
    list.forEach(function (o) {
      var segs = [];
      for (var k = 0; k < o.pts.length - 1; k++) { var a = o.pts[k], b = o.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        for (var sd = -1; sd <= 1; sd += 2) { var off = sd * o.w / 2; for (var q = 0; q < L; q += 3) { var q2 = Math.min(L, q + 3); segs.push([a[0] + (b[0] - a[0]) * q / L + nx * off, a[1] + (b[1] - a[1]) * q / L + ny * off, a[0] + (b[0] - a[0]) * q2 / L + nx * off, a[1] + (b[1] - a[1]) * q2 / L + ny * off]); } } }
      glowOnly.push(ribbon(segs, 0.12, o.mode === 'tunnel' ? 0x2ff0e0 : 0x9a6bff, 0.85));
    });
    return { lamp: lamp, day: lampDay, glow: lampGlow };
  }
  /* ---------------- water, falls, mist ---------------- */
  function buildWater() {
    // the water surface only where there is water (a plane under the whole basin z-fights with the land from far away)
    var WB = Wd.WATERBOX || Wd.bounds, WX0 = WB.x0, WX1 = WB.x1, WY0 = WB.y0, WY1 = WB.y1, WS = Wd.WATERBOX ? 1.4 : 2.5, wnx = Math.round((WX1 - WX0) / WS) + 1, wny = Math.round((WY1 - WY0) / WS) + 1, wpos = [], widx = [], wet = [];
    for (var j = 0; j < wny; j++) for (var i = 0; i < wnx; i++) { var x0 = WX0 + i * WS, y0 = WY0 + j * WS; wpos.push(x0, Wd.WATER, -y0); wet.push(Wd.H(x0, y0) < Wd.WATER + 0.12); }
    for (j = 0; j < wny - 1; j++) for (i = 0; i < wnx - 1; i++) { var a = j * wnx + i, b = a + 1, c = a + wnx, d = c + 1; if (wet[a] || wet[b] || wet[c] || wet[d]) widx.push(a, b, c, b, d, c); }
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(wpos, 3)); g.setIndex(widx); g.computeVertexNormals();
    var mat = new T.MeshPhongMaterial({ color: 0x48b4c2, specular: 0xffffff, shininess: 70, transparent: true, opacity: 0.86, emissive: 0x000000 });
    var w = new T.Mesh(g, mat); w.receiveShadow = true; WG.add(w);
    var falls = null, ftex = null, mist = new T.Group(); WG.add(mist);
    if (!Wd.FALLS) return { water: w, falls: null, ftex: null, mist: mist };
    // the falls: a sheet that hugs the cliff above the plunge pool
    var N = 30, K = 8, Y0 = 213, Y1 = 231, pos = [], uv = [], idx = [];
    for (var i = 0; i <= N; i++) for (var k = 0; k <= K; k++) {
      var t = i / N, x = lerp(-126, -96, Math.pow(t, 0.85)), y = lerp(Y0, Y1, k / K) + Math.sin(t * 6 + k) * 0.4;
      var narrow = 0.55 + 0.45 * t; y = 222 + (y - 222) * narrow;
      var z = Math.max(Wd.H(x, y), Wd.WATER) + 1.1 - t * 0.6;
      pos.push(x, z, -y); uv.push(k / K, t * 3);
    }
    for (i = 0; i < N; i++) for (k = 0; k < K; k++) { var a = i * (K + 1) + k, b = a + 1, c = a + K + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    var fg = new T.BufferGeometry(); fg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); fg.setIndex(idx); fg.computeVertexNormals();
    ftex = canvasTex(128, 256, function (g2, W2, H2) { g2.fillStyle = 'rgba(255,255,255,0.35)'; g2.fillRect(0, 0, W2, H2); for (var q = 0; q < 160; q++) { g2.fillStyle = 'rgba(255,255,255,' + (0.4 + R() * 0.6).toFixed(2) + ')'; g2.fillRect(R() * W2, R() * H2, 1 + R() * 3, 20 + R() * 90); } });
    ftex.wrapS = ftex.wrapT = T.RepeatWrapping;
    var fm = new T.MeshBasicMaterial({ map: ftex, color: 0xeefcff, transparent: true, opacity: 0.92, side: T.DoubleSide, depthWrite: false });
    falls = new T.Mesh(fg, fm); WG.add(falls);
    // mist at the foot of the falls
    for (i = 0; i < 26; i++) { var s = new T.Sprite(new T.SpriteMaterial({ map: softDot, color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false })); s.position.copy(V(-96 + R() * 10, 216 + R() * 12, Wd.WATER + 1 + R() * 5)); var sz = 6 + R() * 8; s.scale.set(sz, sz, 1); s.userData.ph = R() * 6; mist.add(s); }
    return { water: w, falls: falls, ftex: ftex, mist: mist };
  }

  /* ---------------- the basket: galvanised steel, a wire tray, real chains ---------------- */
  function buildBasket() {
    var S = E.FB.SPEC, bx = Wd.BASKET.x, by = Wd.BASKET.y, bz = Wd.H(bx, by);
    var grp = new T.Group(); grp.position.copy(V(bx, by, bz)); WG.add(grp);
    var steel = new T.MeshPhongMaterial({ color: 0xc3cad0, specular: 0xffffff, shininess: 70 }), dull = new T.MeshPhongMaterial({ color: 0x9aa3aa, specular: 0x888888, shininess: 30 });
    var band = new T.MeshPhongMaterial({ color: 0xf2a13b, specular: 0x666666, shininess: 40, emissive: 0x000000, side: T.DoubleSide });
    function cyl(r, h, seg, r2) { var g = new T.CylinderGeometry(r2 == null ? r : r2, r, h, seg || 20); g.translate(0, h / 2, 0); return g; }
    function part(g, m, z) { var o = new T.Mesh(g, m); o.position.y = z; o.castShadow = true; grp.add(o); return o; }
    var trayB = S.trayTopZ - S.trayDepth, bandB = S.bandBottomZ != null ? S.bandBottomZ : S.trayTopZ + S.targetZone, bandT = bandB + S.bandH;
    part(cyl(S.poleR, S.poleTop, 14), steel, 0);
    part(cyl(S.poleR * 1.9, 0.12, 14), dull, -0.02);                                                    // ground sleeve
    part(cyl(S.poleR * 1.5, 0.05, 14), dull, trayB - 0.03);                                             // tray collar
    part(cyl(S.collarR, 0.03, 16), dull, S.collarZ - 0.015);                                            // chain collar
    // the tray: a dished floor, a wire cage of uprights, a rim on top and a band halfway
    part(new T.LatheGeometry([[0.0, 0], [S.trayR * 0.93, 0], [S.trayR, 0.035]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 40), new T.MeshPhongMaterial({ color: 0xb5bdc3, specular: 0xffffff, shininess: 50, side: T.DoubleSide }), trayB);
    var rod = S.rodR * 1.3, nBar = 20, bars = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0), steel, nBar * 2); bars.castShadow = true; grp.add(bars); bars.count = 0;
    for (var i = 0; i < nBar; i++) { var a = i / nBar * 6.283, ca = Math.cos(a), sa = Math.sin(a); bars.setMatrixAt(bars.count++, _m.compose(_p.set(ca * S.trayR, trayB + 0.03, sa * S.trayR), _q.identity(), _s.set(rod, S.trayDepth - 0.03, rod))); bars.setMatrixAt(bars.count++, _m.compose(_p.set(0, trayB + 0.004, 0), _q.setFromAxisAngle(_dv.set(-sa, 0, ca), Math.PI / 2), _s.set(rod * 0.8, S.trayR * 0.93, rod * 0.8))); }
    bars.instanceMatrix.needsUpdate = true;
    [S.trayTopZ, trayB + S.trayDepth * 0.5].forEach(function (z, k) { var t = new T.Mesh(new T.TorusGeometry(S.trayR, k ? rod : rod * 1.8, 6, 48), steel); t.rotation.x = Math.PI / 2; t.position.y = z; grp.add(t); });
    // the chain rack: a coloured band, a rim, a dome lid
    part(new T.CylinderGeometry(S.bandR, S.bandR, S.bandH, 40, 1, true), band, bandB + S.bandH / 2);
    [bandB, bandT].forEach(function (z) { var t = new T.Mesh(new T.TorusGeometry(S.bandR, 0.006, 6, 48), steel); t.rotation.x = Math.PI / 2; t.position.y = z; grp.add(t); });
    part(new T.SphereGeometry(S.bandR, 32, 8, 0, 6.283, 0, 0.42).scale(1, S.lidRise / (S.bandR * (1 - Math.cos(0.42))), 1).translate(0, -S.bandR * Math.cos(0.42) * S.lidRise / (S.bandR * (1 - Math.cos(0.42))), 0), steel, bandT);
    // the number plate on the band, facing the tee
    var numTex = canvasTex(128, 64, function (g, w, h) { g.fillStyle = '#1b1630'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = '800 46px "Alegreya Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Wd.HOLE.number || 1), w / 2, h / 2 + 2); });
    var plate = new T.Mesh(new T.PlaneGeometry(0.1, 0.05), new T.MeshBasicMaterial({ map: numTex })); var ta = Math.atan2(Wd.TEE.x - bx, Wd.TEE.y - by);
    plate.position.set(Math.sin(ta) * (S.bandR + 0.004), bandB + S.bandH / 2, -Math.cos(ta) * (S.bandR + 0.004)); plate.rotation.y = Math.atan2(Math.sin(ta), -Math.cos(ta)); grp.add(plate);
    // chains: a steel rod for every link segment (and a hairline so they still read from far away)
    var defs = E.FB.strandDefs(S), P = S.segments + 1, nStr = defs.length, nSeg = nStr * S.segments;
    var links = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0), new T.MeshPhongMaterial({ color: 0xe6ebef, specular: 0xffffff, shininess: 90 }), nSeg); links.frustumCulled = false; links.castShadow = true; grp.add(links);
    var cpos = new Float32Array(nSeg * 2 * 3), cgeo = new T.BufferGeometry(); cgeo.setAttribute('position', new T.BufferAttribute(cpos, 3));
    var chainMat = new T.LineBasicMaterial({ color: 0xe9eef2, transparent: true, opacity: 0.55 });
    var ch = new T.LineSegments(cgeo, chainMat); ch.frustumCulled = false; grp.add(ch);
    var REST = E.FB.restPose(), A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
    function set(x) {
      var o = 0, n = 0;
      for (var s = 0; s < nStr; s++) for (var k = 0; k < S.segments; k++) {
        var a = (s * P + k) * 3, b = a + 3;
        cpos[o++] = x[a]; cpos[o++] = x[a + 2]; cpos[o++] = -x[a + 1]; cpos[o++] = x[b]; cpos[o++] = x[b + 2]; cpos[o++] = -x[b + 1];
        A.x = x[a]; A.y = x[a + 1]; A.z = x[a + 2]; B.x = x[b]; B.y = x[b + 1]; B.z = x[b + 2];
        links.setMatrixAt(n++, segMatrix(A, B, 0.0065));
      }
      cgeo.attributes.position.needsUpdate = true; links.instanceMatrix.needsUpdate = true;
    }
    set(REST);
    // the beacon: a thin gold beam you can find from the tee, and a ring of light on the ground that breathes
    var beacon = new T.Mesh(new T.CylinderGeometry(0.045, 0.06, 70, 10, 1, true), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false, uniforms: { t: { value: 0 } },
      vertexShader: 'varying float vh; void main(){ vh = position.y / 70.0 + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float t; varying float vh; void main(){ float a = smoothstep(0.0, 0.06, vh) * pow(1.0 - vh, 1.6) * (0.75 + 0.25 * sin(t * 1.6 - vh * 14.0)); gl_FragColor = vec4(vec3(1.0, 0.76, 0.32) * a * 0.9, 1.0); }'
    }));
    beacon.position.y = S.poleTop + 35.2; grp.add(beacon); glowOnly.push(beacon);
    var bring = new T.Mesh(new T.RingGeometry(1.55, 1.68, 72), new T.MeshBasicMaterial({ color: 0xffc25a, transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    bring.rotation.x = -Math.PI / 2; bring.position.y = 0.06; grp.add(bring); glowOnly.push(bring);
    // a pin marker that stays readable from the tee
    var pinTex = canvasTex(128, 160, function (g) { g.fillStyle = '#f2b544'; g.beginPath(); g.moveTo(64, 150); g.lineTo(24, 86); g.lineTo(104, 86); g.closePath(); g.fill(); g.font = '800 54px "Alegreya Sans", sans-serif'; g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(27,22,48,.8)'; g.lineWidth = 8; g.strokeText('PIN', 64, 66); g.fillText('PIN', 64, 66); });
    var pin = new T.Sprite(new T.SpriteMaterial({ map: pinTex, depthTest: false, transparent: true, fog: false })); pin.center.set(0.5, 0); pin.renderOrder = 20; grp.add(pin);
    return { group: grp, setChains: set, rest: REST, chainMat: chainMat, band: band, beacon: beacon, ring: bring, links: links, pin: pin, z: bz };
  }


  /* ---------------- glow layers: trail of gold dust, fireflies, plankton ---------------- */
  var POINT_U = { t: { value: 0 }, scale: { value: (window.innerHeight || 800) * renderer.getPixelRatio() / 2 } };
  function points(n, size, color, opacity, additive, maxPx) {
    var g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    var ph = new Float32Array(n), pc = new Float32Array(n * 3).fill(1); for (var i = 0; i < n; i++) ph[i] = R() * 6.283;
    g.setAttribute('ph', new T.BufferAttribute(ph, 1)); g.setAttribute('pc', new T.BufferAttribute(pc, 3));
    var mat = new T.ShaderMaterial({
      uniforms: { map: { value: softDot }, size: { value: size }, col: { value: new T.Color(color) }, op: { value: opacity }, maxPx: { value: (maxPx || 14) * renderer.getPixelRatio() }, t: POINT_U.t, scale: POINT_U.scale },
      vertexShader: 'uniform float size; uniform float scale; uniform float maxPx; uniform float t; attribute float ph; attribute vec3 pc; varying float vA; varying vec3 vC; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; gl_PointSize = clamp(size * scale / d, 1.0, maxPx); vA = smoothstep(1.2, 7.0, d) * (1.0 - smoothstep(260.0, 650.0, d)) * (0.5 + 0.5 * sin(t * (0.9 + fract(ph) * 1.4) + ph)); vC = pc; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; uniform vec3 col; uniform float op; varying float vA; varying vec3 vC; void main(){ float a = texture2D(map, gl_PointCoord).a * op * vA; if (a < 0.004) discard; gl_FragColor = vec4(col * vC, a); }',
      transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    var m = new T.Points(g, mat); m.frustumCulled = false; WG.add(m);
    m.setOpacity = function (v) { mat.uniforms.op.value = v; }; return m;
  }
  function buildGlowLayers() {
    var path = Wd.PATH, dots = [];
    for (var i = 0; i < path.length - 1; i++) { var a = path[i], b = path[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (var s = 0; s < L; s += 0.9) { var t = s / L, x = lerp(a[0], b[0], t) + (R() - 0.5) * 1.2, y = lerp(a[1], b[1], t) + (R() - 0.5) * 0.8; dots.push(x, Wd.G(x, y) + 0.12, -y); } }
    var trail = points(dots.length / 3, 0.3, 0x45f0d8, 0.8, true, 8); trail.geometry.setAttribute('position', new T.Float32BufferAttribute(dots, 3)); glowOnly.push(trail);
    var FN = 700, ff = points(FN, 0.3, 0xffffff, 1, true, 9), fp = ff.geometry.attributes.position.array, seeds = [], fpc = ff.geometry.attributes.pc.array, FFC = [[0.35, 1, 0.9], [0.62, 0.42, 1], [1, 0.36, 0.86], [0.4, 0.85, 1]];
    for (i = 0; i < FN; i++) { var cc = FFC[i % 4]; fpc[i * 3] = cc[0]; fpc[i * 3 + 1] = cc[1]; fpc[i * 3 + 2] = cc[2]; }
    for (i = 0; i < FN; i++) { var y2 = lerp(Wd.SCATTER.y0, Wd.SCATTER.y1, R()), x2 = lerp(Wd.leftBound(y2) - 30, Wd.rightBound(y2) + 30, R()); seeds.push({ x: x2, y: y2, h: 0.5 + R() * 3.5, ph: R() * 6.28, sp: 0.4 + R() * 0.8 }); }
    var motes = points(500, 0.16, 0xffffff, 0.55, false), mp = motes.geometry.attributes.position.array, mseeds = [];
    for (i = 0; i < 500; i++) { var y3 = lerp(Wd.SCATTER.y0, Wd.SCATTER.y1, R()); mseeds.push({ x: lerp(Wd.leftBound(y3) - 10, Wd.rightBound(y3) + 10, R()), y: y3, h: 1 + R() * 9, ph: R() * 6.28, sp: 0.3 + R() * 0.6 }); }
    var PN = 900, pl = points(PN, 0.22, 0x4fd8ff, 0.7, true, 7), pseeds = [];
    var PB = Wd.WATERBOX || Wd.bounds, ptries = 0;
    while (pseeds.length < PN && ptries++ < 60000) { var x4 = lerp(PB.x0, PB.x1, R()), y4 = lerp(PB.y0, PB.y1, R()); if (Wd.isWater(x4, y4)) pseeds.push({ x: x4, y: y4, ph: R() * 6.28 }); }
    pl.geometry.setDrawRange(0, pseeds.length);
    var pp = pl.geometry.attributes.position.array; pseeds.forEach(function (s, k) { pp[k * 3] = s.x; pp[k * 3 + 1] = Wd.WATER + 0.06; pp[k * 3 + 2] = -s.y; });
    glowOnly.push(ff); glowOnly.push(pl); dayOnly.push(motes);
    return { ff: ff, fp: fp, seeds: seeds, motes: motes, mp: mp, mseeds: mseeds, pl: pl };
  }
  var WIND_MS = { x: PL.WIND.x * 0.447, y: PL.WIND.y * 0.447 };
  function animateMotes(L, t, dt) {
    var a = L.fp, s = L.seeds;
    for (var i = 0; i < s.length; i++) {
      var o = s[i]; o.x += WIND_MS.x * 0.35 * dt * o.sp; o.y += WIND_MS.y * 0.35 * dt * o.sp;
      if (o.y < -12) o.y += 300; if (o.y > 300) o.y -= 300;
      var x = o.x + Math.sin(t * 0.7 * o.sp + o.ph) * 1.4, y = o.y + Math.cos(t * 0.5 * o.sp + o.ph * 2) * 1.2;
      a[i * 3] = x; a[i * 3 + 1] = Wd.G(x, y) + o.h + Math.sin(t * 1.3 + o.ph) * 0.5; a[i * 3 + 2] = -y;
    }
    L.ff.geometry.attributes.position.needsUpdate = true;

    var m = L.mp, ms = L.mseeds;
    for (i = 0; i < ms.length; i++) { var q = ms[i]; q.x += WIND_MS.x * 0.3 * dt; q.y += WIND_MS.y * 0.3 * dt; if (q.y < -12) q.y += 290; var mx = q.x + Math.sin(t * 0.4 + q.ph) * 2, my = q.y; m[i * 3] = mx; m[i * 3 + 1] = Wd.G(mx, my) + q.h + Math.sin(t * 0.8 + q.ph) * 0.6; m[i * 3 + 2] = -my; }
    L.motes.geometry.attributes.position.needsUpdate = true;
    L.pl.setOpacity(0.5 + 0.2 * Math.sin(t * 1.7));
  }

  /* ---------------- the disc, its trail, the aim line, effects ---------------- */
  function buildDisc() {
    var r = E.FB.DISC.R || 0.1055;
    var g = new T.LatheGeometry([[0.001, -0.008], [r * 0.9, -0.01], [r, -0.004], [r, 0.004], [r * 0.92, 0.01], [0.001, 0.011]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 32);
    var mat = new T.MeshLambertMaterial({ color: 0xf2a13b, emissive: 0x000000 });
    var m = new T.Mesh(g, mat); m.castShadow = true;
    var stamp = new T.Mesh(new T.CircleGeometry(r * 0.55, 20), new T.MeshBasicMaterial({ color: 0xfff3df })); stamp.rotation.x = -Math.PI / 2; stamp.position.y = 0.0115; m.add(stamp);
    var halo = new T.Sprite(new T.SpriteMaterial({ map: softDot, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending })); halo.scale.set(0.9, 0.9, 1);
    var grp = new T.Group(); grp.add(m); scene.add(grp); scene.add(halo);
    var TN = 260, tpos = new Float32Array(TN * 3), tcol = new Float32Array(TN * 3), tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.BufferAttribute(tpos, 3)); tg.setAttribute('color', new T.BufferAttribute(tcol, 3)); tg.setDrawRange(0, 0);
    var trail = new T.Line(tg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false })); trail.frustumCulled = false; scene.add(trail);
    // at night the disc draws a ribbon of light behind it, Tron style
    var rpos = new Float32Array(TN * 6), rcol = new Float32Array(TN * 6), ridx = [], rg = new T.BufferGeometry();
    for (var i = 0; i < TN - 1; i++) { var a = i * 2; ridx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    rg.setAttribute('position', new T.BufferAttribute(rpos, 3)); rg.setAttribute('color', new T.BufferAttribute(rcol, 3)); rg.setIndex(ridx); rg.setDrawRange(0, 0);
    var rib = new T.Mesh(rg, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })); rib.frustumCulled = false; rib.visible = false; scene.add(rib);
    return { grp: grp, mesh: m, mat: mat, halo: halo, trail: trail, tpos: tpos, tcol: tcol, TN: TN, pts: [], rib: rib, rpos: rpos, rcol: rcol };
  }
  function buildAimLine() {
    var n = 90, g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    var m = new T.Points(g, new T.PointsMaterial({ map: softDot, color: 0xfff1c4, size: 0.5, transparent: true, opacity: 0.85, depthWrite: false }));
    m.frustumCulled = false; scene.add(m);
    var ring = new T.Mesh(new T.RingGeometry(0.55, 0.75, 40), new T.MeshBasicMaterial({ color: 0xf2b544, transparent: true, opacity: 0.85, side: T.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; scene.add(ring);
    var tring = new T.Mesh(new T.RingGeometry(0.7, 1.0, 48), new T.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false, depthTest: false }));
    tring.rotation.x = -Math.PI / 2; tring.renderOrder = 15; tring.visible = false; scene.add(tring);
    return { pts: m, n: n, ring: ring, tring: tring };
  }
  var burst = (function () {
    var n = 420, g = new T.BufferGeometry(), p = new Float32Array(n * 3); g.setAttribute('position', new T.BufferAttribute(p, 3));
    var m = new T.Points(g, new T.PointsMaterial({ map: softDot, size: 0.45, color: 0xffd35a, transparent: true, opacity: 0, depthWrite: false, blending: T.AdditiveBlending }));
    m.frustumCulled = false; scene.add(m);
    var v = [], life = 0, dur = 1;
    return {
      fire: function (at, color, speed, count, size) { life = dur = 1.8; m.material.color.setHex(color); m.material.size = size || 0.45; v = []; for (var i = 0; i < n; i++) { var a = R() * 6.28, u = R() * 2 - 1, s = (i < (count || n) ? 1 : 0) * speed * (0.4 + R() * 0.6), rr = Math.sqrt(1 - u * u); v.push([Math.cos(a) * rr * s, Math.abs(u) * s + speed * 0.4, Math.sin(a) * rr * s]); p[i * 3] = at.x; p[i * 3 + 1] = at.y; p[i * 3 + 2] = at.z; } g.attributes.position.needsUpdate = true; },
      step: function (dt) { if (life <= 0) { m.material.opacity = 0; return; } life -= dt; for (var i = 0; i < v.length; i++) { v[i][1] -= 6 * dt; p[i * 3] += v[i][0] * dt; p[i * 3 + 1] += v[i][1] * dt; p[i * 3 + 2] += v[i][2] * dt; } g.attributes.position.needsUpdate = true; m.material.opacity = clamp(life / dur, 0, 1); }
    };
  })();

  /* ---------------- build everything ---------------- */
  var world = null;
  var land, far, plants, under, stoneW, water, basket, glowL, disc, aimL, pathL;
  function disposeGroup(g) {
    g.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }
  // build (or rebuild) everything for one hole
  function loadWorld(W) {
    Wd = W; PL.setWorld(W); world = PL.world();
    if (!Wd.SCATTER) Wd.SCATTER = { y0: Wd.bounds.y0 + 40, y1: Wd.bounds.y1 - 40 };
    scene.remove(WG); disposeGroup(WG); WG = new T.Group(); scene.add(WG);
    selectTree(null); glowOnly = []; dayOnly = []; plantMats = []; PG = null; crownMeshes = []; seeThrough = false; SPOT = { key: '', v: null, near: [] }; WALK.nearAt = null;
    R = Wd.rng(4242);
    land = buildLand(); far = buildFar(land.rect);
    plants = buildPlants(world.plants); under = buildUnderstory();
    stoneW = buildStone(world.solids); buildElements(world.solids); pathL = buildPaths(); buildNeon(); water = buildWater(); basket = buildBasket();
    glowL = buildGlowLayers(); buildFarTrees(land.rect);
    var c = boundsCentre(), ext = Math.max(Wd.bounds.x1 - Wd.bounds.x0, Wd.bounds.y1 - Wd.bounds.y0) / 2;
    sunTarget = V(c.x, c.y, (Wd.TEE_Z + basket.z) / 2); sun.position.copy(sunTarget).addScaledVector(SUN, 600); sun.target.position.copy(sunTarget);
    sc.left = sc.bottom = -ext; sc.right = sc.top = ext; sc.far = 1400; sc.updateProjectionMatrix();
    INTRO = introPath();
    applyLook();
    var H0 = Wd.HOLE;
    $('cardK').textContent = (H0.course ? H0.course + ' · ' : 'Aurelia · ') + 'Hole ' + (H0.number || 1);
    $('cardH').textContent = H0.title || (H0.name.charAt(0) + H0.name.slice(1).toLowerCase());
    $('cardSub').textContent = 'Par ' + H0.par + ' · ' + Math.round(basketDist(Wd.TEE) / FT) + ' ft · ' + (Wd.TEE_Z >= basket.z ? 'drops ' : 'climbs ') + Math.abs(Math.round((Wd.TEE_Z - basket.z) / FT)) + ' ft';
    $('introK').textContent = $('cardK').textContent + ' · Par ' + H0.par;
    $('introH').textContent = $('cardH').textContent;
    $('introS').textContent = H0.blurb || '';
  }

  /* ---------------- trees you can touch: pick, select, rebuild ---------------- */
  var SEL = { p: null, grp: null };
  function plantsNow() { return world ? world.plants : []; }
  // the tree under a screen point: the nearest trunk or crown the ray enters
  function pickTree(cx, cy) {
    var rc = canvas.getBoundingClientRect(); ndc.set((cx - rc.left) / rc.width * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    var o = ray.ray.origin, d = ray.ray.direction, ox = o.x, oy = -o.z, oz = o.y, dx = d.x, dy = -d.z, dz = d.y, a = dx * dx + dy * dy, best = null, bt = 1e9;
    if (a < 1e-8) return null;
    plantsNow().forEach(function (p) {
      var wx = ox - p.x, wy = oy - p.y, t = -(wx * dx + wy * dy) / a; if (t < 0) return;
      var dist = Math.hypot(wx + dx * t, wy + dy * t), z = oz + dz * t - p.z;
      var small = p.type === 'bush' || p.type === 'fern', rad = small ? Math.max(p.r, 0.9) : z > p.base ? Math.max(p.r * 0.85, 0.9) : Math.max(p.tr + 0.6, 0.9);
      if (z < -0.6 || z > p.h + 0.6 || dist > rad) return;
      var te = t - Math.sqrt(Math.max(0, rad * rad - dist * dist) / a);
      if (te < bt) { bt = te; best = p; }
    });
    return best;
  }
  function selectTree(rec) {
    if (SEL.grp) { scene.remove(SEL.grp); disposeGroup(SEL.grp); SEL.grp = null; } SEL.p = null;
    if (!rec) return null;
    var p = null, list = plantsNow(); for (var i = 0; i < list.length; i++) if (list[i].rec === rec) { p = list[i]; break; }
    if (!p) return null; SEL.p = p;
    var g = new T.Group(), mk = function (op) { return new T.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: op, side: T.DoubleSide, depthWrite: false, fog: false }); };
    var R0 = Math.max(1.2, p.tr * 1.6 + 0.8), ring = new T.Mesh(new T.RingGeometry(R0, R0 + 0.35, 48), mk(0.95)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; g.add(ring);
    if (p.r > 1.5 && p.base > 0.8) { var cr = new T.Mesh(new T.RingGeometry(p.r * 0.92, p.r * 0.92 + Math.max(0.25, p.r * 0.03), 64), mk(0.8)); cr.rotation.x = -Math.PI / 2; cr.position.y = p.base; g.add(cr); }
    var pole = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, p.h + 3, 6).translate(0, (p.h + 3) / 2, 0), mk(0.45)); g.add(pole);
    g.position.copy(V(p.x, p.y, p.z)); scene.add(g); SEL.grp = g; return p;
  }
  // the hole's trees changed (resized, removed, planted): rebuild the forest and the physics that goes with it
  function refreshPlants() {
    var rec = SEL.p && SEL.p.rec; PL.setWorld(Wd); world = PL.world(); SPOT = { key: '', v: null, near: [] };
    var was = seeThrough; seeThrough = false; buildPlants(world.plants, true); setSee(was); applyLook();
    return rec ? selectTree(rec) : null;
  }
  // are you standing in the woods? (inside a crown's footprint, or a trunk right in front of you)
  function inTheTrees(l) {
    var list = plantsNow(), n = 0;
    for (var i = 0; i < list.length; i++) { var p = list[i]; if (p.type === 'bush' || p.type === 'fern') continue; var d = Math.hypot(p.x - l.x, p.y - l.y); if (d < p.r * 0.9) n += 2; else if (d < 7) n++; }
    return n >= 3;
  }
  function canopyTop(l, rad) { var top = Wd.G(l.x, l.y), list = plantsNow(); for (var i = 0; i < list.length; i++) { var p = list[i]; if (Math.abs(p.x - l.x) < rad && Math.abs(p.y - l.y) < rad) top = Math.max(top, p.z + p.h); } return top; }
  /* ---------------- day and glow ---------------- */
  var glow = false;
  function applyLook() {
    var P = glow ? PAL.glow : PAL.day;
    skyU.top.value.setHex(P.top); skyU.hor.value.setHex(P.hor); skyU.low.value.setHex(P.low); skyU.sunA.value = glow ? 0 : 1;
    scene.fog.color.setHex(P.fog); scene.fog.density = P.fogD;
    hemi.color.setHex(P.hemiS); hemi.groundColor.setHex(P.hemiG); hemi.intensity = P.hemiI;
    sun.color.setHex(P.sunC); sun.intensity = P.sunI; rose.color.setHex(P.roseC); rose.intensity = P.roseI;
    if (bloom) { bloom.strength = P.bS; bloom.threshold = P.bT; bloom.radius = P.bR; }
    stars.visible = glow; aurora.visible = glow;
    planet.userData.body.material.opacity = glow ? 1 : 0.5; planet.userData.ring.material.opacity = glow ? 0.95 : 0.45;
    glowOnly.forEach(function (o) { o.visible = glow; }); dayOnly.forEach(function (o) { o.visible = !glow; });
    under.flowers.material = glow ? flowerMats.glow : flowerMats.day;
    BIO.amt.value = glow ? 1 : 0;
    basket.chainMat.color.setHex(glow ? 0x9ff8ff : 0xe9eef2); basket.chainMat.opacity = glow ? 0.8 : 0.55; basket.links.material.emissive.setHex(glow ? 0x167888 : 0x000000);
    var wm = water.water.material; wm.color.setHex(glow ? 0x0b1f44 : 0x48b4c2); wm.emissive.setHex(glow ? 0x06304e : 0x000000); wm.opacity = glow ? 0.92 : 0.86;
    if (water.falls) water.falls.material.color.setHex(glow ? 0x8ff6ff : 0xeefcff);
    water.mist.children.forEach(function (s) { s.material.color.setHex(glow ? 0x5fdcff : 0xffffff); s.material.opacity = glow ? 0.22 : 0.35; });
    stoneW.bricks.forEach(function (b) { b.material = glow ? stoneW.brickGlow : stoneW.brickDay; });
    basket.band.emissive.setHex(glow ? 0x5a3000 : 0x000000);
    if (pathL) pathL.lamp.material = glow ? pathL.glow : pathL.day;
    disc.mat.emissive.setHex(glow ? 0x0b5560 : 0x000000);
    disc.halo.material.color.setHex(glow ? 0x7ff6ff : 0xffffff); disc.halo.material.opacity = glow ? 0.5 : 0.35;
    disc.trail.material.opacity = glow ? 1 : 0.55;
    $('bGlow').classList.toggle('on', glow); $('bGlow').setAttribute('aria-pressed', glow ? 'true' : 'false');
    $('bGlow').textContent = glow ? 'Day' : 'Glow';
  }

  /* ---------------- round state ---------------- */
  var G = {
    mode: 'load', lie: { x: Wd.TEE.x, y: Wd.TEE.y }, strokes: 0, disc: 5, power: 0, hyz: 0, nose: 0, aim: 0, zoom: 0, view: 'tee',
    target: null, solved: null, solveTok: 0, aiming: false, steerDepth: 0, lookFreeze: null,
    rec: null, playT: 0, afterT: 0, lines: [], snaps: [], camBlend: 0, introT: 0, done: false, peaks: [], medianPeak: 2.6,
  };
  // the same angle and flick rules as Putt League
  var BANK = { 3: -26, 2: -16, 1: -8, 0: 0, '-1': 8, '-2': 16, '-3': 26 };
  var CUT = { TL: [9, 24, 36], TR: [5, 16, 35] }, MAXA = 50;
  function basketDist(l) { return Math.hypot(Wd.BASKET.x - l.x, Wd.BASKET.y - l.y); }
  function aimToBasket(l) { return Math.atan2(Wd.BASKET.x - l.x, Wd.BASKET.y - l.y) / DEG; }
  function chainPt() { return { x: Wd.BASKET.x, y: Wd.BASKET.y, z: basket.z + 1.08, air: true, basket: true }; }
  function headingTo(t) { return Math.atan2(t.x - G.lie.x, t.y - G.lie.y) / DEG; }
  function defaultsForLie() {
    G.target = null; G.solved = null; G.solveTok++; G.hyz = 0; G.nose = 0; G.power = 0; G.aiming = false; G.zoom = 0; G.view = 'tee';
    G.disc = PL.discForDist(basketDist(G.lie)); G.aim = aimToBasket(G.lie);
    G.target = chainPt(); scheduleSolve();
  }
  // one solve: the clean flat line to (or through) the reticle. Your angle, nose and power bend it at the throw.
  function scheduleSolve() {
    var tok = ++G.solveTok; G.solved = null; if (!G.target) return;
    setTimeout(function () { if (tok !== G.solveTok || !G.target) return; G.solved = PL.solveTo(E, G.lie, G.disc, G.target); }, 20);
  }
  function solved() { return G.solved || (G.solved = PL.solveTo(E, G.lie, G.disc, G.target)); }

  /* ---------------- layout: the Putt League bottom cluster ---------------- */
  var inkc = $('ink'), ink = inkc.getContext('2d'), L = {};
  function layout() {
    var W = window.innerWidth, Hh = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    inkc.width = Math.round(W * dpr); inkc.height = Math.round(Hh * dpr); inkc.style.width = W + 'px'; inkc.style.height = Hh + 'px'; ink.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sb = parseFloat(getComputedStyle(document.documentElement).paddingBottom) || 0;
    var big = W >= 900 && Hh >= 540, us = big ? 1.15 : 1, R = big ? 54 : 46, cx = W / 2, cy = Hh - sb - R - (big ? 52 : 44);
    var fanR = Math.max(120, Math.min((W / 2 - 8) / Math.sin(MAXA * DEG), cy - 120));
    L = { W: W, H: Hh, R: R, cx: cx, cy: cy, fanR: fanR, sb: sb, pullMax: Hh - cy };
    var dw = $('discWrap'); dw.style.left = (cx - R) + 'px'; dw.style.top = (cy - R) + 'px'; dw.style.width = dw.style.height = (R * 2) + 'px';
    var side = Math.max(12, W * 0.035), bot = Hh - sb - 12, pwH = $('powerWrap').offsetHeight || 200;
    $('viewWrap').style.left = side + 'px'; $('viewWrap').style.top = (bot - 62) + 'px';
    ['discSel', 'viewWrap', 'powerWrap'].forEach(function (id) { var el = $(id); el.style.transform = us > 1 ? 'scale(' + us + ')' : ''; el.style.transformOrigin = id === 'powerWrap' ? 'right bottom' : 'left bottom'; });
    $('discSel').style.left = side + 'px'; $('discSel').style.top = (bot - 62 - (big ? 82 : 66)) + 'px';
    $('discMenu').style.left = side + 'px'; $('discMenu').style.bottom = (Hh - (bot - 62 - (big ? 98 : 74))) + 'px';
    $('powerWrap').style.right = side + 'px'; $('powerWrap').style.top = (bot - pwH) + 'px';
    $('hint').style.top = (Math.min(cy - R - 92, bot - pwH - 80)) + 'px';
    var gg = $('gauge'); gg.style.left = cx + 'px'; gg.style.top = (cy - R - 50) + 'px';
    $('call').style.top = (cy - R - 132) + 'px';
    drawFan();
  }
  function fpt(a, rad) { var t = a * DEG; return [L.cx - Math.sin(t) * rad, L.cy - Math.cos(t) * rad]; }
  function wedge(a0, a1, rad) { var p0 = fpt(a0, rad), p1 = fpt(a1, rad); return 'M' + L.cx + ' ' + L.cy + ' L' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' A' + rad + ' ' + rad + ' 0 0 1 ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + ' Z'; }
  function drawFan() {
    var f = $('fan'), Rr = L.fanR, A = MAXA, a = fpt(A, Rr), b = fpt(-A, Rr), rays = '';
    f.setAttribute('width', L.W); f.setAttribute('height', L.H); f.setAttribute('viewBox', '0 0 ' + L.W + ' ' + L.H);
    [CUT.TL[1], CUT.TL[2]].forEach(function (an) { var p = fpt(an, Rr); rays += '<path d="M' + L.cx + ' ' + L.cy + ' L' + p[0] + ' ' + p[1] + '" stroke="rgba(246,239,223,0.22)" stroke-width="1.5" stroke-dasharray="4 7"/>'; });
    [CUT.TR[1], CUT.TR[2]].forEach(function (an) { var p = fpt(-an, Rr); rays += '<path d="M' + L.cx + ' ' + L.cy + ' L' + p[0] + ' ' + p[1] + '" stroke="rgba(246,239,223,0.22)" stroke-width="1.5" stroke-dasharray="4 7"/>'; });
    f.innerHTML = '<path d="' + wedge(A, CUT.TL[0], Rr) + '" fill="rgba(255,106,77,0.13)"/>' + '<path d="' + wedge(CUT.TL[0], -CUT.TR[0], Rr) + '" fill="rgba(246,239,223,0.09)"/>' +
      '<path d="' + wedge(-CUT.TR[0], -A, Rr) + '" fill="rgba(79,163,255,0.13)"/>' + rays +
      '<path d="M' + a[0] + ' ' + a[1] + ' A' + Rr + ' ' + Rr + ' 0 0 1 ' + b[0] + ' ' + b[1] + '" fill="none" stroke="#f6efdf" stroke-width="2.5" stroke-dasharray="14 10" stroke-linecap="round" opacity="0.6"/>';
  }

  /* ---------------- power bar: seven steps, AUTO in the middle ---------------- */
  var PCOL = ['#3B86D9', '#5AA5F2', '#8fc4d8', '#f6efdf', '#ffc93c', '#F2A13B', '#E0482F'];
  (function () { var p = $('power'), h = ''; for (var i = 0; i < 7; i++) h += '<span class="seg' + (i === 3 ? ' mid' : '') + '" style="--c:' + PCOL[i] + '"></span>'; p.innerHTML = h; })();
  function showPower() {
    var segs = document.querySelectorAll('#power .seg');
    for (var i = 0; i < 7; i++) segs[i].classList.toggle('on', i <= G.power + 3);
    $('pwVal').textContent = G.power === 0 ? 'AUTO' : (G.power > 0 ? '+' : '') + G.power;
    $('power').setAttribute('aria-valuenow', G.power);
  }
  (function () {
    var p = $('power'), drag = false;
    function setFromY(y) { var r = p.getBoundingClientRect(), k = 1 - clamp((y - r.top) / r.height, 0, 0.999); G.power = Math.floor(k * 7) - 3; showPower(); }
    p.addEventListener('pointerdown', function (e) { if (G.mode !== 'aim') return; drag = true; try { p.setPointerCapture(e.pointerId); } catch (x) {} setFromY(e.clientY); e.preventDefault(); e.stopPropagation(); });
    p.addEventListener('pointermove', function (e) { if (drag) setFromY(e.clientY); });
    p.addEventListener('pointerup', function () { drag = false; }); p.addEventListener('pointercancel', function () { drag = false; });
    p.addEventListener('keydown', function (e) { if (e.key === 'ArrowUp') { G.power = Math.min(3, G.power + 1); showPower(); e.preventDefault(); } if (e.key === 'ArrowDown') { G.power = Math.max(-3, G.power - 1); showPower(); e.preventDefault(); } });
  })();

  /* ---------------- the bag ---------------- */
  var hexOf = function (c) { return '#' + c.toString(16).padStart(6, '0'); };
  function showDisc() {
    var d = PL.DISCS[G.disc];
    $('discName').textContent = d.short; $('discNums').textContent = d.nums.join(' | '); $('discSw').style.background = hexOf(d.color);
    $('disc').style.setProperty('--dc', hexOf(d.color));
    disc.mat.color.setHex(d.color);
    Array.prototype.forEach.call(document.querySelectorAll('#discMenu button'), function (b, i) { b.classList.toggle('on', i === G.disc); b.setAttribute('aria-pressed', i === G.disc ? 'true' : 'false'); });
  }
  // the bag: the stock discs, then yours (name and flight numbers you enter, kept on this device and in your builder account)
  var BAG_KEY = 'aurelia:bag', bagHook = null;
  function loadBag() { try { var v = localStorage.getItem(BAG_KEY); if (v) PL.setCustom(JSON.parse(v)); } catch (e) {} }
  function saveBag() { var l = PL.customList(); try { localStorage.setItem(BAG_KEY, JSON.stringify(l)); } catch (e) {} if (bagHook) try { bagHook(l); } catch (e) {} }
  function renderBag() {
    var m = $('discMenu'); m.innerHTML = '';
    PL.DISCS.forEach(function (d, i) {
      if (i === PL.BASE_N) { var h = document.createElement('div'); h.className = 'sec'; h.textContent = 'My discs'; m.appendChild(h); }
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = '<i style="background:' + hexOf(d.color) + '"></i><b></b><span>' + d.nums.join(' | ') + '</span>'; b.querySelector('b').textContent = d.name;
      b.addEventListener('click', function () { pickDisc(i); m.hidden = true; });
      if (d.mine) {
        var row = document.createElement('div'); row.className = 'row2'; row.appendChild(b);
        var e = document.createElement('button'); e.type = 'button'; e.className = 'ed'; e.setAttribute('aria-label', 'Edit ' + d.name); e.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
        e.addEventListener('click', function (ev) { ev.stopPropagation(); m.hidden = true; openDiscEd(i - PL.BASE_N); });
        row.appendChild(e); m.appendChild(row);
      } else m.appendChild(b);
    });
    var add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.innerHTML = '<i style="background:transparent;border-color:var(--gold)"></i><b>Add your disc</b>';
    add.addEventListener('click', function () { m.hidden = true; openDiscEd(-1); });
    m.appendChild(add);
    if (G.disc >= PL.DISCS.length) G.disc = PL.discForDist(basketDist(G.lie));
    if (disc) showDisc();
  }
  var DE = { i: -1, d: null }, DE_COL = [0xff6a4d, 0xf2a13b, 0xffd35a, 0x7bc86a, 0x5fd0c8, 0x4fa3ff, 0xc9a0ff, 0xe23a6a, 0xf6efdf, 0x2b2a3a];
  function openDiscEd(k) {
    var cur = PL.customList();
    DE.i = k; DE.d = k >= 0 ? cur[k] : { name: '', nums: [9, 5, -1, 2], color: DE_COL[(cur.length * 3) % DE_COL.length] };
    $('deTitle').textContent = k >= 0 ? 'Edit your disc' : 'Add your disc'; $('deDel').hidden = k < 0;
    $('deName').value = DE.d.name;
    [['deSp', 0], ['deGl', 1], ['deTu', 2], ['deFa', 3]].forEach(function (q) { $(q[0]).value = DE.d.nums[q[1]]; });
    var sw = $('deSw'); sw.innerHTML = '';
    DE_COL.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.style.background = hexOf(c); b.setAttribute('aria-label', 'Colour ' + hexOf(c)); b.classList.toggle('on', c === DE.d.color); b.addEventListener('click', function () { DE.d.color = c; [].forEach.call(sw.children, function (x) { x.classList.toggle('on', x === b); }); drawDiscPreview(); }); sw.appendChild(b); });
    $('discEd').hidden = false; syncDiscEd();
  }
  function syncDiscEd() {
    DE.d.nums = [+$('deSp').value, +$('deGl').value, +$('deTu').value, +$('deFa').value];
    ['deSpO', 'deGlO', 'deTuO', 'deFaO'].forEach(function (id, n) { $(id).textContent = DE.d.nums[n]; });
    drawDiscPreview();
  }
  // a flat throw at a typical arm for the disc's speed, drawn from above: where it goes is what these numbers do here
  var prevT = 0;
  function drawDiscPreview() {
    clearTimeout(prevT); prevT = setTimeout(function () {
      var cv = $('dePrev'), g = cv.getContext('2d'), W = cv.width, H = cv.height, d = PL.cleanDisc({ name: 'x', nums: DE.d.nums, color: DE.d.color }, 0);
      // the arm that sends it about as far as a disc of this speed is meant to go, flat (the game throws whatever arm the shot needs)
      var la = d.launch, goal = 120 + 26 * d.nums[0], lo = 12, hi = 85, r = null, arm = 40;
      var fly = function (mph) { return E.P.simulate({ disc: PL.discOf(d), hand: 'RHBH', armSpeed: mph, spin: PL.spinFor(mph), hyzer: 0, nose: la - 2, launchAngle: la, aim: 0, releaseHeight: 4.6, windVec: { x: 0, y: 0 }, gust: 0, seed: 1, groundFt: function () { return 0; } }); };
      for (var it = 0; it < 9; it++) { arm = (lo + hi) / 2; r = fly(arm); var Lt = r.samples[r.samples.length - 1]; if (Math.hypot(Lt.x, Lt.y) < goal) lo = arm; else hi = arm; }
      var S = r.samples, maxY = 1, maxX = 1; S.forEach(function (q) { maxY = Math.max(maxY, q.y); maxX = Math.max(maxX, Math.abs(q.x)); });
      var sc = Math.min((W - 60) / Math.max(maxY, 200), (H / 2 - 20) / Math.max(maxX, 40));
      g.clearRect(0, 0, W, H); g.fillStyle = '#0f1a14'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(246,239,223,.12)'; g.lineWidth = 2; g.setLineDash([6, 8]); g.beginPath(); g.moveTo(30, H / 2); g.lineTo(W - 20, H / 2); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(246,239,223,.35)'; g.font = '700 20px "Alegreya Sans", sans-serif';
      for (var f = 100; f < maxY + 1; f += 100) { var xx = 30 + f * sc; if (xx > W - 30) break; g.fillRect(xx, H / 2 - 6, 2, 12); g.fillText(f + '', xx - 14, H / 2 + 28); }
      g.strokeStyle = hexOf(DE.d.color); g.lineWidth = 5; g.lineCap = 'round'; g.beginPath();
      S.forEach(function (q, k) { var x = 30 + q.y * sc, y = H / 2 + q.x * sc; if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      var L = S[S.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(30 + L.y * sc, H / 2 + L.x * sc, 7, 0, 6.283); g.fill();
      var side = L.x > 8 ? 'finishes right' : L.x < -8 ? 'finishes left' : 'finishes straight', mid = 0; S.forEach(function (q) { if (q.y < L.y * 0.6) mid = Math.max(mid, q.x); });
      $('dePrevT').textContent = 'A flat throw at ' + Math.round(arm) + ' mph: about ' + Math.round(L.y) + ' ft, ' + (mid > 6 && L.x < mid - 4 ? 'turns right, then ' : '') + side + ' (right-hand backhand, no wind).';
    }, 60);
  }
  ['deSp', 'deGl', 'deTu', 'deFa'].forEach(function (id) { $(id).addEventListener('input', syncDiscEd); });
  $('deCancel').addEventListener('click', function () { $('discEd').hidden = true; });
  $('deSave').addEventListener('click', function () {
    var l = PL.customList(), nm = $('deName').value.trim() || 'My disc', rec = { id: DE.i >= 0 ? l[DE.i].id : 'd' + Date.now().toString(36), name: nm, nums: DE.d.nums.slice(), color: DE.d.color };
    if (DE.i >= 0) l[DE.i] = rec; else l.push(rec);
    PL.setCustom(l); saveBag(); renderBag(); $('discEd').hidden = true;
    var k = PL.BASE_N + (DE.i >= 0 ? DE.i : l.length - 1); if (G.mode === 'aim') pickDisc(k);
  });
  $('deDel').addEventListener('click', function () { var l = PL.customList(); if (DE.i < 0) return; l.splice(DE.i, 1); PL.setCustom(l); saveBag(); if (G.disc >= PL.DISCS.length) G.disc = 0; renderBag(); $('discEd').hidden = true; });
  loadBag();
  (function () {
    var m = $('discMenu');
    renderBag();
    $('discBtn').addEventListener('click', function () { if (G.mode !== 'aim') return; m.hidden = !m.hidden; $('discBtn').setAttribute('aria-expanded', m.hidden ? 'false' : 'true'); });
  })();
  function pickDisc(i) { if (G.mode !== 'aim') return; G.disc = i; showDisc(); scheduleSolve(); var d = PL.DISCS[i]; flashHint(d.short + ': SPEED ' + d.nums[0]); }

  /* ---------------- the flick (Putt Reader 1.1, as in Putt League) ---------------- */
  function ang(a, b) { return Math.atan2(-(b.x - a.x), -(b.y - a.y)) * 180 / Math.PI; }
  function mag(m, Tt) { return m < Tt[0] ? 0 : m < Tt[1] ? 1 : m < Tt[2] ? 2 : 3; }
  function classify(score) { var M = mag(Math.abs(score), score >= 0 ? CUT.TL : CUT.TR); return M === 0 ? 0 : (score > 0 ? M : -M); }
  function analyze(pts) {
    if (pts.length < 3) return { ok: false, why: 'tap' };
    var turn = 0, i; for (i = 1; i < pts.length; i++) if (pts[i].y > pts[turn].y) turn = i;
    var end = pts.length - 1, peak = 0, sp = [];
    for (var j = turn + 1; j < pts.length; j++) { var dt = Math.max(4, pts[j].t - pts[j - 1].t), v = Math.hypot(pts[j].x - pts[j - 1].x, pts[j].y - pts[j - 1].y) / dt; sp.push(v); if (v > peak) peak = v; }
    for (var s = sp.length - 1; s >= 0; s--) { if (sp[s] >= peak * 0.2) { end = turn + 1 + s; break; } }
    var F = pts.slice(turn, end + 1), len = 0;
    for (var q = 1; q < F.length; q++) len += Math.hypot(F[q].x - F[q - 1].x, F[q].y - F[q - 1].y);
    if (F.length < 3 || len < 30 || F[0].y - F[F.length - 1].y < 20) return { ok: false, why: 'noflick' };
    var chord = ang(F[0], F[F.length - 1]), snap = 0;
    for (var u = 0; u < F.length; u++) for (var w = u + 1; w < F.length; w++) { var dtw = F[w].t - F[u].t; if (dtw >= 30) { snap = Math.max(snap, Math.hypot(F[w].x - F[u].x, F[w].y - F[u].y) / dtw); break; } }
    if (!snap) snap = len / Math.max(30, F[F.length - 1].t - F[0].t);
    return { ok: true, chord: chord, read: classify(chord), peak: peak, snap: snap, len: len, turn: turn, end: end };
  }
  function classCenter(c) { if (c === 0) return (CUT.TL[0] - CUT.TR[0]) / 2; var Tt = c > 0 ? CUT.TL : CUT.TR, m = Math.abs(c), v = m === 1 ? (Tt[0] + Tt[1]) / 2 : m === 2 ? (Tt[1] + Tt[2]) / 2 : Tt[2] + 7; return c > 0 ? v : -v; }
  // swipe speed barely matters: up to an average flick is an average throw; the hardest flicks add up to 4%. Real extra power is the bar.
  function touchFor(s) { return 1 + 0.04 * clamp(((s || 0) - 2.7) / 2.5, 0, 1); }

  /* ---------------- angle: hold the disc, then slide (L/R hyzer and anny, forward is nose down) ---------------- */
  var HYZ_NAME = { 3: 'BIG HYZER', 2: 'HYZER', 1: 'TOUCH HYZER', 0: 'FLAT', '-1': 'TOUCH ANNY', '-2': 'ANHYZER', '-3': 'BIG ANNY' };
  var NOSE_NAME = { 3: 'NOSE UP 3', 2: 'NOSE UP 2', 1: 'NOSE UP 1', 0: 'LEVEL', '-1': 'NOSE DOWN 1', '-2': 'NOSE DOWN 2', '-3': 'NOSE DOWN 3' };
  function bankDeg(h) { return -(BANK[h] || 0); }
  var PULL = { x: 0, y: 0 };
  function discPose(spring) {
    var d = $('disc'), k = clamp(PULL.y / (L.pullMax || 120), 0, 1);
    d.style.transition = spring ? 'transform 260ms cubic-bezier(.2,1.7,.4,1), box-shadow 200ms ease' : 'none';
    d.style.setProperty('--load', k.toFixed(3));
    d.style.transform = 'translate(' + PULL.x.toFixed(1) + 'px,' + PULL.y.toFixed(1) + 'px) rotate(' + (-bankDeg(G.hyz)).toFixed(1) + 'deg) scale(' + (1 + k * 0.06).toFixed(3) + ',' + ((1 - Math.abs(G.nose) * 0.08) * (1 - k * 0.1)).toFixed(3) + ')';
  }
  function releasePull() { if (PULL.x || PULL.y) { PULL.x = 0; PULL.y = 0; discPose(true); } }
  function showNose() { $('disc').style.setProperty('--noseY', (-G.nose * 4) + 'px'); discPose(true); showGauge(bankDeg(G.hyz), G.nose, HYZ_NAME[G.hyz], false); setHint(); }
  function showGauge(tiltDeg, nose, label, released) {
    var gg = $('gauge');
    gg.querySelector('.fv').style.transform = 'rotate(' + (-tiltDeg).toFixed(1) + 'deg)';
    gg.querySelector('.sv').style.transform = 'rotate(' + (-nose * 6) + 'deg)';
    gg.querySelector('.hl').textContent = label; gg.querySelector('.nl').textContent = NOSE_NAME[nose];
    gg.classList.toggle('rel', !!released);
    $('aimTag').querySelector('.xh .h').style.transform = 'rotate(' + (-tiltDeg).toFixed(1) + 'deg)';
  }
  var gaugeT = 0;
  function gaugeFlash() { document.body.classList.add('gaugeflash'); clearTimeout(gaugeT); gaugeT = setTimeout(function () { document.body.classList.remove('gaugeflash'); }, 1300); }
  function hyzLabel(deg) { var a = Math.abs(deg); return a < 4 ? 'FLAT' : (deg > 0 ? (a < 12 ? 'TOUCH HYZER' : a < 21 ? 'HYZER' : 'BIG HYZER') : (a < 12 ? 'TOUCH ANNY' : a < 21 ? 'ANHYZER' : 'BIG ANNY')) + ' ' + Math.round(a) + '°'; }
  function setHint() {
    var h = $('hint');
    if (IN.tilt) h.textContent = 'L/R: HYZER/ANNY · FWD: NOSE DOWN';
    else if (G.mode === 'aim' && !G.target) h.textContent = 'TAP WHERE YOU WANT TO THROW';
    else h.textContent = 'TAP DISC TO THROW · FLICK TO SHAPE · HOLD TO TILT';
  }
  var hintT = 0;
  function flashHint(t) { var h = $('hint'); h.textContent = t; clearTimeout(hintT); hintT = setTimeout(setHint, 1700); }
  function showCall(t) { var c = $('call'); c.textContent = t; c.classList.add('show'); clearTimeout(c._t); c._t = setTimeout(function () { c.classList.remove('show'); }, 1300); }

  /* ---------------- picking and steering the target ---------------- */
  var ray = new T.Raycaster(), ndc = new T.Vector2(), plane = new T.Plane(), hitP = new T.Vector3();
  // march a screen ray down to the land (analytic: exact, and it ignores the trees, so you aim at the ground behind them)
  function groundHit(sx, sy) {
    ndc.set(sx / L.W * 2 - 1, -(sy / L.H) * 2 + 1); ray.setFromCamera(ndc, camera);
    var o = ray.ray.origin, d = ray.ray.direction, t = 0.5, prevT = 0, step = 0.6;
    for (var i = 0; i < 1400 && t < 2400; i++) {
      var x = o.x + d.x * t, y = -(o.z + d.z * t), z = o.y + d.y * t;
      if (z <= Wd.G(x, y)) {
        var a = prevT, b = t;
        for (var k = 0; k < 18; k++) { var m = (a + b) / 2, xm = o.x + d.x * m, ym = -(o.z + d.z * m), zm = o.y + d.y * m; if (zm <= Wd.G(xm, ym)) b = m; else a = m; }
        var xx = o.x + d.x * b, yy = -(o.z + d.z * b);
        return { x: xx, y: yy, z: Wd.G(xx, yy) };
      }
      prevT = t; t += step; step = Math.min(6, 0.6 + t * 0.012);
    }
    return null;
  }
  function screenOf(x, y, z) { var v = V(x, y, z).project(camera); return { x: (v.x + 1) / 2 * L.W, y: (1 - v.y) / 2 * L.H, behind: v.z > 1 }; }
  function setTarget(t) { G.target = t; scheduleSolve(); setHint(); }
  function pickTarget(p) {
    var bs = screenOf(Wd.BASKET.x, Wd.BASKET.y, basket.z + 1.0);
    if (!bs.behind && Math.hypot(p.x - bs.x, p.y - bs.y) < 34) { setTarget(chainPt()); flashHint('TARGET: THE CHAINS'); return; }
    var h = groundHit(p.x, p.y);
    if (!h) { flashHint('TAP THE GROUND OR THE BASKET'); return; }
    if (Math.hypot(h.x - G.lie.x, h.y - G.lie.y) < 1.5) { flashHint('PICK A SPOT FARTHER OUT'); return; }
    setTarget({ x: h.x, y: h.y, z: h.z, floor: true }); flashHint(Wd.isWater(h.x, h.y) ? 'TARGET: THE CREEK. BOLD' : 'TARGET SET');
  }
  // exactly where your finger puts it, nothing snaps: an upright plane at the target's depth, facing you; below the land it rides the ground
  function steerTarget(sx, sy) {
    var o = G.lie, look = G.lookFreeze || aimTarget(), dir = new T.Vector3(look.x - o.x, 0, -(look.y - o.y)).normalize(), Opt = V(o.x, o.y, Wd.G(o.x, o.y));
    var onP = Opt.clone().addScaledVector(dir, Math.max(2, G.steerDepth));
    plane.setFromNormalAndCoplanarPoint(dir.clone().negate(), onP);
    ndc.set(sx / L.W * 2 - 1, -(sy / L.H) * 2 + 1); ray.setFromCamera(ndc, camera);
    var t = null;
    if (ray.ray.intersectPlane(plane, hitP)) { var x = hitP.x, y = -hitP.z, z = hitP.y, g = Wd.G(x, y); if (z > g + 0.3) t = { x: x, y: y, z: Math.min(z, g + 45), air: true }; }
    if (!t) { var h = groundHit(sx, sy); if (h) t = { x: h.x, y: h.y, z: h.z, floor: true }; }
    if (!t || Math.hypot(t.x - o.x, t.y - o.y) < 1.5) return;
    G.target = t; G.solveTok++; G.solved = null;
  }
  function aimTarget() { return G.target || chainPt(); }

  /* ---------------- input: the disc, the world (target), zoom, double tap ---------------- */
  var IN = { pid: null, pts: [], hold: null, down: null, tilt: false, tiltBase: 0, tiltBaseH: 0, touches: {}, pinch: null, lastTap: null, aim: null };
  function local(e) { return { x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() }; }
  function onDisc(p) { return Math.hypot(p.x - L.cx, p.y - L.cy) <= L.R * 1.45; }
  function nTouches() { return Object.keys(IN.touches).length; }
  var RET = { sx: -999, sy: -999, behind: true };
  var UI_SEL = '#tools, #discSel, #discMenu, #discEd, #viewWrap, #powerWrap, #end, #card, #wind';
  window.addEventListener('pointerdown', function (e) {
    if (G.mode === 'intro') { if (G.introT > 0.07) skipIntro(); return; }
    if (e.target.closest && e.target.closest(UI_SEL)) return;
    if (!$('discMenu').hidden) { $('discMenu').hidden = true; return; }
    if (G.mode !== 'aim') return;
    var p = local(e);
    var onRet = !RET.behind && G.target && !onDisc(p) && Math.hypot(p.x - RET.sx, p.y - RET.sy) < 40;
    if (IN.pid === null && !IN.aim && (onRet || (G.aiming && !onDisc(p) && nTouches() === 0))) {
      e.preventDefault();
      IN.aim = { id: e.pointerId, start: p, s0: { x: RET.behind ? L.W / 2 : RET.sx, y: RET.behind ? L.H * 0.4 : RET.sy }, was: !!G.aiming, moved: false };
      if (!G.aiming) { G.aiming = true; G.lookFreeze = G.target || chainPt(); flashHint('DRAG ANYWHERE: UP, DOWN, AROUND'); }
      G.steerDepth = Math.hypot(aimTarget().x - G.lie.x, aimTarget().y - G.lie.y);
      return;
    }
    if (onDisc(p)) { G.aiming = false; G.zoom = 0; G.view = 'tee'; }
    if (IN.pid === null && !onDisc(p) || IN.pid !== null) {
      if (e.pointerId === IN.pid) return;
      IN.touches[e.pointerId] = { p: p, start: p };
      if (nTouches() === 2) { var k = Object.keys(IN.touches), a = IN.touches[k[0]].p, b = IN.touches[k[1]].p; IN.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: G.zoom }; }
      return;
    }
    e.preventDefault();
    IN.pid = e.pointerId;
    IN.pts = [p]; IN.down = p; IN.tilt = false;
    clearTimeout(IN.hold);
    IN.hold = setTimeout(function () { var l = IN.pts[IN.pts.length - 1]; if (IN.pid !== null && Math.hypot(l.x - IN.down.x, l.y - IN.down.y) < 7) { IN.tilt = true; document.body.classList.add('tilting'); IN.tiltBase = G.nose; IN.tiltBaseH = G.hyz; try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} setHint(); } }, 650);
  });
  window.addEventListener('pointermove', function (e) {
    if (IN.aim && e.pointerId === IN.aim.id) {
      var q = local(e), dx = q.x - IN.aim.start.x, dy = q.y - IN.aim.start.y;
      if (!IN.aim.moved && Math.hypot(dx, dy) < 6) return;
      IN.aim.moved = true; steerTarget(clamp(IN.aim.s0.x + dx, 4, L.W - 4), clamp(IN.aim.s0.y + dy, 60, L.H - 4));
      return;
    }
    if (IN.touches[e.pointerId]) {
      IN.touches[e.pointerId].p = local(e);
      if (IN.pinch && nTouches() === 2) { var k = Object.keys(IN.touches), a = IN.touches[k[0]].p, b = IN.touches[k[1]].p, d = Math.hypot(a.x - b.x, a.y - b.y); G.zoom = clamp(IN.pinch.z0 + Math.log(d / IN.pinch.d0) * 1.8, -1, 5); }
      return;
    }
    if (e.pointerId !== IN.pid) return;
    var list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!list.length) list = [e];
    for (var i = 0; i < list.length; i++) IN.pts.push(local(list[i]));
    if (IN.tilt) { var p = local(list[list.length - 1]), n = clamp(IN.tiltBase + Math.round((p.y - IN.down.y) / 24), -3, 3), hz = clamp(IN.tiltBaseH + Math.round(-(p.x - IN.down.x) / 24), -3, 3); if (n !== G.nose || hz !== G.hyz) { G.nose = n; G.hyz = hz; showNose(); try { navigator.vibrate && navigator.vibrate(6); } catch (x) {} } return; }
    var l = IN.pts[IN.pts.length - 1];
    if (IN.hold && Math.hypot(l.x - IN.down.x, l.y - IN.down.y) >= 7) { clearTimeout(IN.hold); IN.hold = null; }
    var pm = L.pullMax || 120, py = clamp(l.y - IN.down.y, 0, pm); PULL.y = py; PULL.x = clamp((l.x - IN.down.x) * 0.5, -30, 30) * (py / pm); discPose(false);
    drawStroke();
  });
  function finish(e) {
    if (IN.aim && e.pointerId === IN.aim.id) {
      var A = IN.aim; IN.aim = null;
      if (A.moved) { scheduleSolve(); flashHint('TAP THE TARGET TO LOCK IT'); }
      else if (A.was) { G.aiming = false; scheduleSolve(); flashHint(G.target && G.target.air ? 'LOCKED: THROUGH THAT SPOT' : 'TARGET LOCKED'); }
      return;
    }
    var t = IN.touches[e.pointerId];
    if (t) {
      var wasPinch = !!IN.pinch; delete IN.touches[e.pointerId]; if (nTouches() < 2) IN.pinch = null;
      if (wasPinch || e.type !== 'pointerup' || G.mode !== 'aim') return;
      var p = local(e); if (Math.hypot(p.x - t.start.x, p.y - t.start.y) > 12) return;
      var now = performance.now();
      if (IN.lastTap && now - IN.lastTap.t < 330 && Math.hypot(p.x - IN.lastTap.x, p.y - IN.lastTap.y) < 45) { IN.lastTap = null; G.zoom = 0; setTarget(chainPt()); flashHint('VIEW RESET · AIMED AT THE CHAINS'); return; }
      IN.lastTap = { t: now, x: p.x, y: p.y };
      pickTarget(p); return;
    }
    if (e.pointerId !== IN.pid) return;
    IN.pid = null; clearTimeout(IN.hold); IN.hold = null; releasePull(); document.body.classList.remove('tilting');
    if (IN.tilt) {
      // a real flick out of a hold is a throw, not an angle change: put the angle back and throw it
      if (e.type === 'pointerup') IN.pts.push(local(e));
      var at = analyze(IN.pts); IN.tilt = false;
      if (at.ok && at.turn > 0 && IN.pts[at.turn].y - IN.pts[0].y > 18 && at.len > 70 && at.peak > Math.max(0.6, 0.35 * G.medianPeak)) { G.nose = IN.tiltBase; G.hyz = IN.tiltBaseH; showNose(); drawStroke(at); throwIt(at); return; }
      IN.pts = []; drawStroke(); setHint(); return;
    }
    if (e.type === 'pointerup') IN.pts.push(local(e));
    var a = analyze(IN.pts);
    if (!a.ok) {
      var moved = 0; for (var mi = 1; mi < IN.pts.length; mi++) moved = Math.max(moved, Math.hypot(IN.pts[mi].x - IN.pts[0].x, IN.pts[mi].y - IN.pts[0].y));
      IN.pts = []; drawStroke();
      if (a.why === 'tap' || moved < 14) { throwIt({ ok: true, read: 0, chord: classCenter(0), snap: 2.7, peak: G.medianPeak, tap: true }); return; }
      flashHint('NO FLICK. TAP TO THROW FLAT, OR PULL BACK AND FLICK'); return;
    }
    drawStroke(a); throwIt(a);
  }
  window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  window.addEventListener('wheel', function (e) { if (G.mode !== 'aim') return; e.preventDefault(); G.zoom = clamp(G.zoom - e.deltaY * 0.004, -1, 5); }, { passive: false });
  function drawStroke(a) {
    ink.clearRect(0, 0, L.W, L.H);
    var pts = IN.pts; if (pts.length < 2) return;
    var turn = 0; for (var i = 1; i < pts.length; i++) if (pts[i].y > pts[turn].y) turn = i;
    ink.lineCap = 'round'; ink.lineJoin = 'round';
    function path(from, to) { ink.beginPath(); ink.moveTo(pts[from].x, pts[from].y); for (var k = from + 1; k <= to; k++) ink.lineTo(pts[k].x, pts[k].y); }
    if (turn > 0) { path(0, turn); ink.setLineDash([5, 6]); ink.strokeStyle = 'rgba(246,239,223,0.6)'; ink.lineWidth = 3; ink.stroke(); ink.setLineDash([]); }
    var end = a ? a.end : pts.length - 1, colr = a ? (a.read > 0 ? '#ff6a4d' : a.read < 0 ? '#4fa3ff' : '#f6efdf') : '#f6efdf';
    if (end > turn) { path(turn, end); ink.strokeStyle = 'rgba(21,19,42,0.85)'; ink.lineWidth = 10; ink.stroke(); ink.strokeStyle = colr; ink.lineWidth = 5; ink.stroke(); }
  }
  window.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('mode-play')) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (G.mode === 'intro') { skipIntro(); return; }
    if (e.target && e.target.id === 'power') return;
    var k = e.key.toLowerCase();
    if (k >= '1' && k <= '7') pickDisc(+k - 1);
    else if (k === 'q' && G.mode === 'aim') { G.hyz = clamp(G.hyz + 1, -3, 3); showNose(); gaugeFlash(); }
    else if (k === 'e' && G.mode === 'aim') { G.hyz = clamp(G.hyz - 1, -3, 3); showNose(); gaugeFlash(); }
    else if (k === 'r' && G.mode === 'aim') { G.nose = clamp(G.nose + 1, -3, 3); showNose(); gaugeFlash(); }
    else if (k === 'f' && G.mode === 'aim') { G.nose = clamp(G.nose - 1, -3, 3); showNose(); gaugeFlash(); }
    else if ((k === 'w' || k === 'arrowup') && G.mode === 'aim') { G.power = Math.min(3, G.power + 1); showPower(); }
    else if ((k === 's' || k === 'arrowdown') && G.mode === 'aim') { G.power = Math.max(-3, G.power - 1); showPower(); }
    else if (k === ' ') { e.preventDefault(); throwIt({ ok: true, read: 0, chord: classCenter(0), snap: 2.7, peak: 2.6 }); }   // keyboard: a clean flat flick
    else if (k === 'v') $('viewBtn').click();
    else if (k === 'g') { glow = !glow; applyLook(); }
    else if (k === 'm') mulligan();
  });
  var VIEWS = ['tee', 'over', 'canopy', 'pin'], VIEW_NAME = { tee: 'VIEW: BEHIND YOU', over: 'VIEW: THE WHOLE HOLE', canopy: 'VIEW: ABOVE THE TREES', pin: 'VIEW: FROM THE PIN' };
  $('viewBtn').addEventListener('click', function () { if (G.mode !== 'aim') return; G.view = VIEWS[(VIEWS.indexOf(G.view) + 1) % VIEWS.length]; flashHint(VIEW_NAME[G.view]); });
  $('bSee').addEventListener('click', function () { G.see = !G.see; $('bSee').classList.toggle('on', G.see); $('bSee').setAttribute('aria-pressed', G.see ? 'true' : 'false'); flashHint(G.see ? 'LEAVES FADED' : 'LEAVES BACK'); });
  $('bGlow').addEventListener('click', function () { glow = !glow; applyLook(); });
  $('bMull').addEventListener('click', mulligan);
  $('bRestart').addEventListener('click', function () { restart(false); });
  $('eAgain').addEventListener('click', function () { restart(false); });
  window.addEventListener('resize', layout);

  /* ---------------- HUD ---------------- */
  function refreshHud() {
    var d = basketDist(G.lie), drop = (basket.z - Wd.G(G.lie.x, G.lie.y)) / FT;
    $('sThrow').textContent = G.strokes + 1;
    $('sDist').textContent = Math.round(d / FT);
    $('sElev').textContent = (drop > 0 ? '+' : '') + Math.round(drop);
    $('bMull').disabled = !(G.mode === 'aim' && G.snaps.length);
    showDisc(); showPower(); showNose();
  }
  function refreshWind() {
    var mph = Math.hypot(PL.WIND.x, PL.WIND.y), toward = Math.atan2(PL.WIND.x, PL.WIND.y) / DEG, a = G.target ? headingTo(G.target) : G.aim;
    $('windArrow').setAttribute('transform', 'rotate(' + (toward - a).toFixed(1) + ' 20 20)');
    $('windMph').textContent = mph.toFixed(0) + ' mph';
  }
  var toastTimer = null;
  function toast(big, tags, ms) {
    $('tBig').textContent = big || '';
    var tt = $('tTags'); tt.innerHTML = '';
    (tags || []).forEach(function (t) { var s = document.createElement('span'); s.textContent = t.text || t; if (t.hot) s.className = 'hot'; tt.appendChild(s); });
    $('toast').classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').classList.remove('show'); }, ms || 2600);
  }
  // the reticle rides the target every frame; its readout is the distance (and MAX when the arm can't get there clean)
  function updateReticle() {
    var tag = $('aimTag'), show = G.mode === 'aim' && !!G.target;
    tag.hidden = !show; tag.classList.toggle('live', !!G.aiming && show);
    if (!show) { RET.behind = true; return; }
    var t = G.target, s = screenOf(t.x, t.y, t.z);
    RET.sx = s.x; RET.sy = s.y; RET.behind = s.behind;
    tag.style.left = s.x + 'px'; tag.style.top = s.y + 'px'; tag.style.visibility = s.behind ? 'hidden' : 'visible';
    var ft = Math.round(Math.hypot(t.x - G.lie.x, t.y - G.lie.y) / FT);
    $('aimDist').textContent = (t.basket ? 'CHAINS · ' : t.air ? 'THROUGH · ' : '') + ft + ' FT' + (G.solved && G.solved.outOfReach ? ' · MAX ARM' : '');
  }

  /* ---------------- throwing and playback ---------------- */
  function throwIt(a) {
    if (G.mode !== 'aim') return;
    if (!G.target) { G.target = chainPt(); G.solved = null; }
    $('discMenu').hidden = true;
    G.snaps.push({ lie: { x: G.lie.x, y: G.lie.y }, strokes: G.strokes, lines: G.lines.slice() });
    G.mode = 'compute';
    var c = a.read, p = Object.assign({}, solved());
    var dev = a.chord - classCenter(c), aimErr = clamp(-dev * 0.3, -4, 4);
    var userHz = clamp((BANK[G.hyz] || 0) + (BANK[c] || 0) * 0.6, -34, 34);
    p.hyzer = clamp((p.hyzer || 0) + userHz, -40, 40);
    G.peaks.push(a.peak); if (G.peaks.length > 15) G.peaks.shift();
    var sorted = G.peaks.slice().sort(function (x, y) { return x - y; }), spErr = touchFor(a.snap) - 1;
    if (sorted.length >= 3) G.medianPeak = sorted[Math.floor(sorted.length / 2)];
    p.aim += aimErr; p.nose += 2.5 * G.nose; p.armSpeed *= (1 + 0.07 * G.power) * (1 + spErr);
    showCall(hyzLabel(-userHz) + (spErr > 0.03 ? ' · BIG ARM' : '') + (G.power ? (G.power > 0 ? ' · POWER +' : ' · POWER ') + G.power : '') + (G.nose ? (G.nose > 0 ? ' · NOSE UP' : ' · NOSE DOWN') : '') + ' · ' + Math.round(p.armSpeed) + ' MPH');
    showGauge(-userHz, G.nose, 'RELEASED ' + hyzLabel(-userHz), true);
    document.body.classList.add('throwing');
    setTimeout(function () {
      var rec = PL.throwFrom(E, G.lie, p, (Math.random() * 1e9) | 0);
      G.rec = rec; G.playT = 0; G.mode = 'flight'; disc.pts = []; G.flyBlobs = flightBlobs(rec); G.flySeeT = 0;
      G.flightEnd = rec.samples[rec.samples.length - 1].t;
      IN.pts = []; drawStroke();
    }, 60);
  }
  function sampleAt(rec, t) {
    var S = rec.samples, lo = 0, hi = S.length - 1;
    if (t <= S[0].t) return S[0]; if (t >= S[hi].t) return S[hi];
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (S[m].t <= t) lo = m; else hi = m; }
    var a = S[lo], b = S[hi], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
    return { t: t, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), nx: lerp(a.nx, b.nx, k), ny: lerp(a.ny, b.ny, k), nz: lerp(a.nz, b.nz, k), spinAngle: lerp(a.spinAngle, b.spinAngle, k), chains: a.chains || b.chains, landed: a.landed, speed: lerp(a.speed, b.speed, k) };
  }
  var _n = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _qs = new T.Quaternion();
  function placeDisc(wx, wy, wz, nx, ny, nz, spin) {
    disc.grp.position.copy(V(wx, wy, wz));
    _n.set(nx, nz, -ny).normalize(); disc.grp.quaternion.setFromUnitVectors(_up, _n);
    _qs.setFromAxisAngle(_up, spin || 0); disc.grp.quaternion.multiply(_qs);
    disc.halo.position.copy(disc.grp.position);
  }
  function surfName(x, y) {
    if (Wd.surfName) { var nm = Wd.surfName(x, y); return nm === 'forest floor' ? 'in the trees' : nm; }
    var s = Wd.surfaceAt(x, y), where = y < 38 ? 'the chute' : y < Wd.EDGES[0].f(x) ? 'tier one' : y < Wd.EDGES[1].f(x) ? 'tier two' : y < Wd.EDGES[2].f(x) ? 'tier three' : 'the basin';
    var what = { short_grass_dry: 'fairway', medium_grass_wet: 'fringe', deep_grass: 'in the trees', rock_slab: 'on the moss wall', flagstone: 'the tee', hardpack_dirt: 'creek bank', moat_water: 'the creek' }[s] || s;
    return what === 'in the trees' || what === 'on the moss wall' ? where + ', ' + what : where + ' ' + what;
  }
  function scoreName(n) { var d = n - Wd.HOLE.par; if (n === 1) return 'ACE'; return d <= -3 ? 'Albatross' : d === -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : '+' + d; }
  function finishThrow() {
    var rec = G.rec, from = { x: G.lie.x, y: G.lie.y }, d0 = basketDist(from);
    var thrownFt = Math.hypot(rec.rest.x - from.x, rec.rest.y - from.y) / FT;
    var tags = PL.readThrow(rec, E).map(function (t) { return { text: t, hot: /CHAINS|TOMBSTONE|skips|Off the moss/.test(t) }; });
    G.strokes++;
    var dname = PL.DISCS[rec.discIndex].name;
    if (rec.made) {
      var sn = scoreName(G.strokes);
      G.lines.push(G.strokes + '. ' + dname + ', ' + Math.round(thrownFt) + ' ft. In the chains');
      burst.fire(V(Wd.BASKET.x, Wd.BASKET.y, basket.z + 1.1), 0xffd35a, 7, 420, 0.5);
      basket.chainMat.color.setHex(0xffe27a); setTimeout(function () { basket.chainMat.color.setHex(0xe9eef2); }, 1600);
      toast(sn === 'Par' ? 'PAR' : sn.toUpperCase() + '!', [{ text: Math.round(thrownFt) + ' ft ' + (d0 > 22 ? 'from downtown' : 'putt'), hot: true }].concat(tags.filter(function (t) { return t.text !== 'IN THE CHAINS'; })), 3600);
      G.mode = 'after'; G.afterT = 0; G.done = true;
      return;
    }
    var fix = Wd.fixLie(rec.rest, from, world.solids);
    G.strokes += fix.penalty;
    G.lie = { x: fix.x, y: fix.y };
    var left = basketDist(G.lie);
    if (left < 0.9) { G.strokes++; G.lines.push(G.strokes - 1 + '. ' + dname + ', ' + Math.round(thrownFt) + ' ft'); G.lines.push(G.strokes + '. Tap in'); toast('TAP IN', [{ text: scoreName(G.strokes), hot: true }], 3000); G.mode = 'after'; G.afterT = 0; G.done = true; return; }
    if (fix.note) tags.unshift({ text: fix.note, hot: false });
    G.lines.push(G.strokes - fix.penalty + '. ' + dname + ', ' + Math.round(thrownFt) + ' ft to ' + surfName(G.lie.x, G.lie.y) + (fix.penalty ? ' (+1)' : ''));
    if (rec.events.some(function (e) { return e.type === 'splash'; })) { var sp = rec.events.find(function (e) { return e.type === 'splash'; }); burst.fire(V(rec.origin.x + sp.x * FT, rec.origin.y + sp.y * FT, Wd.WATER + 0.2), glow ? 0x6ff3ff : 0xffffff, 4, 200, 0.35); }
    toast(Math.round(thrownFt) + ' FT', [{ text: Math.round(left / FT) + ' ft to the pin' }, { text: surfName(G.lie.x, G.lie.y) }].concat(tags), 2800);
    G.mode = 'after'; G.afterT = 0;
  }
  function toAim() {
    defaultsForLie(); G.mode = 'aim'; G.camBlend = 0;
    disc.trail.geometry.setDrawRange(0, 0); disc.rib.geometry.setDrawRange(0, 0);
    document.body.classList.remove('throwing');
    var g = $('gauge'); g.classList.remove('rel');
    refreshHud(); refreshWind(); setHint();
    G.seeAuto = inTheTrees(G.lie);
    if (G.seeAuto && G.strokes) setTimeout(function () { if (G.mode === 'aim') flashHint('IN THE TREES · LEAVES FADED · VIEW FOR MORE ANGLES'); }, 600);
  }
  function showEnd() {
    var sn = scoreName(G.strokes), ctx = G.ctx || {};
    $('eBig').textContent = sn; $('eSub').textContent = (ctx.endLine ? ctx.endLine(G.strokes) : G.strokes + ' throws on a par ' + Wd.HOLE.par + '. ' + (G.strokes <= Wd.HOLE.par ? 'The mountain approves.' : 'The hole wins this round.'));
    $('eNext').hidden = !ctx.onNext; if (ctx.onNext) $('eNext').textContent = ctx.nextLabel || 'Next hole';
    $('eBack').hidden = !ctx.onExit;
    if (ctx.onDone) ctx.onDone(G.strokes, G.lines.slice());
    var el = $('eLines'); el.innerHTML = ''; G.lines.forEach(function (l) { var d = document.createElement('div'); d.textContent = l; el.appendChild(d); });
    $('end').classList.add('show');
  }
  function mulligan() {
    if (G.mode !== 'aim' || !G.snaps.length) return;
    var s = G.snaps.pop(); G.lie = s.lie; G.strokes = s.strokes; G.lines = s.lines;
    toast('MULLIGAN', [{ text: 'Back to your last lie' }], 1600); toAim(); snapCam(); flash();
  }
  function restart(intro) {
    $('end').classList.remove('show');
    G.lie = { x: Wd.TEE.x, y: Wd.TEE.y }; G.strokes = 0; G.lines = []; G.snaps = []; G.done = false;
    basket.setChains(basket.rest);
    if (intro) {
      defaultsForLie(); G.mode = 'aim'; aimView(tmpP, tmpL);
      var e3 = function (v) { return [v.x, -v.z, v.y]; };
      INTRO = introPath().slice(); INTRO.push([e3(tmpP), e3(tmpL)]);
      startIntro();
    } else { toAim(); snapCam(); flash(); }
  }

  /* ---------------- cameras ---------------- */
  var camPos = new T.Vector3(), camLook = new T.Vector3(), tmpP = new T.Vector3(), tmpL = new T.Vector3();
  function groundEye(x, y, min) { return Math.max(Wd.G(x, y), Wd.WATER) + min; }
  // a camera spot behind the lie that is not inside a trunk or a crown and can see the disc (Putt League's spot search)
  var SPOT = { key: '', v: null, near: [] };
  function blockedAt(x, y, z, near) {
    var n = 0;
    for (var i = 0; i < near.length; i++) {
      var o = near[i];
      if (o.kind === 'cyl') { if (z > o.z0 && z < o.z1 + 0.5 && Math.hypot(x - o.x, y - o.y) < o.r + 0.7) n += 3; }
      else if (o.kind === 'capsule') { var mx = (o.a.x + o.b.x) / 2, my = (o.a.y + o.b.y) / 2; if (Math.hypot(x - mx, y - my) < 1.2 && z < o.b.z) n += 2; }
      else if (o.kind === 'blob') { var dz = (z - o.z) / (o.squash || 1), r = o.r * 0.95; if ((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y) + dz * dz < r * r) n += 1; }
    }
    return n;
  }
  function camSpot(l, dx, dy, putt) {
    var key = l.x.toFixed(2) + ',' + l.y.toFixed(2) + ',' + Math.round(G.aim / 3) + (putt ? 'p' : '');
    if (SPOT.key === key) return SPOT.v;
    var zl = Wd.G(l.x, l.y);
    if (SPOT.lie !== l.x + ',' + l.y) { SPOT.lie = l.x + ',' + l.y; SPOT.near = world.solids.filter(function (o) { var ox = o.kind === 'capsule' ? o.a.x : o.x, oy = o.kind === 'capsule' ? o.a.y : o.y; return Math.hypot(ox - l.x, oy - l.y) < 28; }); }
    var best = null, bestScore = 1e9, backs = putt ? [3.6, 5, 7] : [1.6, 3.5, 6.5, 9], ups = putt ? [1.7, 3] : [1.75, 3.1, 5.2, 8], sides = [0, 2.5, -2.5, 5, -5, 8, -8];
    for (var bi = 0; bi < backs.length; bi++) for (var ui = 0; ui < ups.length; ui++) for (var si = 0; si < sides.length; si++) {
      var bk = backs[bi], x = l.x - dx * bk + dy * sides[si], y = l.y - dy * bk - dx * sides[si], z = Math.max(zl + ups[ui], groundEye(x, y, 1.4));
      var score = blockedAt(x, y, z, SPOT.near) * 10;
      for (var k = 1; k < 8; k++) { var f = k / 8; score += blockedAt(lerp(x, l.x, f), lerp(y, l.y, f), lerp(z, zl + 1.2, f), SPOT.near); }
      // and it should see down the line, not into the tree you are hiding behind
      for (k = 1; k <= 6; k++) { var fx = l.x + dx * k * 2.5, fy = l.y + dy * k * 2.5; score += 0.6 * blockedAt(lerp(x, fx, 0.5 + k / 12), lerp(y, fy, 0.5 + k / 12), lerp(z, zl + 2, 0.5), SPOT.near); }
      score += bi * 0.6 + ui * 0.4 + Math.abs(sides[si]) * 0.12;
      if (score < bestScore) { bestScore = score; best = { x: x, y: y, z: z }; if (score < 0.01) break; }
    }
    SPOT.key = key; SPOT.v = best; SPOT.score = bestScore; return best;
  }
  // behind you, looking at your target (or the pin), or the whole hole from above. Zoom is a lens: wheel or pinch.
  function aimView(outP, outL) {
    var look = G.aiming && G.lookFreeze ? G.lookFreeze : aimTarget();
    G.aim = Math.atan2(look.x - G.lie.x, look.y - G.lie.y) / DEG;
    var a = G.aim * DEG, dx = Math.sin(a), dy = Math.cos(a), l = G.lie, d = basketDist(l), zl = Wd.G(l.x, l.y);
    if (G.view === 'over') {
      var cx = (l.x + Wd.BASKET.x) / 2, cy = (l.y + Wd.BASKET.y) / 2, span = Math.max(40, d);
      outP.copy(V(cx - dx * span * 0.75 + 30, cy - dy * span * 0.75, zl + span * 0.55 + 20));
      outL.copy(V(cx + dx * span * 0.1, cy + dy * span * 0.1, (zl + basket.z) / 2)); return;
    }
    if (G.view === 'canopy') {
      // up through the leaves: a few metres over the tallest crown nearby, looking down the line
      var hz = Math.max(zl + 14, canopyTop(l, 16) + 6), la = clamp(d * 0.8, 12, 90), qx = l.x + dx * la, qy = l.y + dy * la;
      outP.copy(V(l.x - dx * 9, l.y - dy * 9, hz)); outL.copy(V(qx, qy, Wd.G(qx, qy) + 1)); return;
    }
    if (G.view === 'pin') {
      // stand behind the basket and look back at your lie
      var ux = (Wd.BASKET.x - l.x) / (d || 1), uy = (Wd.BASKET.y - l.y) / (d || 1), cx2 = Wd.BASKET.x + ux * 4.5 + uy * 1.2, cy2 = Wd.BASKET.y + uy * 4.5 - ux * 1.2;
      outP.copy(V(cx2, cy2, Math.max(basket.z + 2.4, groundEye(cx2, cy2, 1.6)))); outL.copy(V(l.x, l.y, zl + 1.2)); return;
    }
    var putt = d < 22, sp = camSpot(l, dx, dy, putt), px = sp.x, py = sp.y, pz = sp.z;
    var td = Math.hypot(look.x - l.x, look.y - l.y), LA = putt ? Math.min(td, 18) : clamp(td * 0.7, 20, 160), lx = l.x + dx * LA, ly = l.y + dy * LA;
    var lz = Wd.G(lx, ly) + (putt ? 0.8 : 1.2);
    if (!putt && lz < pz) lz = pz - (pz - lz) * 0.55;
    outP.copy(V(px, py, pz)); outL.copy(V(lx, ly, lz));
  }

  // the crowns anywhere near this flight (so the chase camera can check them cheaply every frame)
  function flightBlobs(rec) {
    var o = rec.origin, pts = [], out = [];
    for (var i = 0; i < rec.samples.length; i += 6) { var q = rec.samples[i]; pts.push([o.x + q.x * FT, o.y + q.y * FT]); }
    world.solids.forEach(function (s) { if (s.kind !== 'blob') return; for (var j = 0; j < pts.length; j++) if (Math.abs(pts[j][0] - s.x) < s.r + 14 && Math.abs(pts[j][1] - s.y) < s.r + 14) { out.push(s); return; } });
    return out;
  }
  // is there foliage between the camera and what it is looking at (or is the camera inside a crown)?
  function leavesBetween(ax, ay, az, bx, by, bz) {
    var L = G.flyBlobs || [];
    for (var k = 0; k <= 4; k++) {
      var f = k / 5, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
      for (var i = 0; i < L.length; i++) { var s = L[i], dz = (z - s.z) / (s.squash || 1), dx = x - s.x, dy = y - s.y; if (dx * dx + dy * dy + dz * dz < s.r * s.r) return true; }
    }
    return false;
  }
  var INTRO = [];
  // a flyover from behind the tee, down the hole, around the basket and back at the tee
  function introPath() {
    if (Wd.INTRO) return Wd.INTRO;
    var t = Wd.TEE, b = Wd.BASKET, dx = b.x - t.x, dy = b.y - t.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = uy, py = -ux;
    var tz = Wd.TEE_Z, bz = Wd.H(b.x, b.y), mx = t.x + dx * 0.5, my = t.y + dy * 0.5, mz = Wd.G(mx, my);
    function P(x, y, h) { return [x, y, Math.max(Wd.G(x, y) + h * 0.6, h + Math.min(tz, bz))]; }
    return [
      [P(t.x - ux * 55 - px * 30, t.y - uy * 55 - py * 30, 60), [mx, my, mz]],
      [P(t.x + dx * 0.3 + px * 30, t.y + dy * 0.3 + py * 30, 45), [b.x, b.y, bz]],
      [P(t.x + dx * 0.75 - px * 25, t.y + dy * 0.75 - py * 25, 32), [b.x, b.y, bz]],
      [P(b.x - ux * 20 + px * 18, b.y - uy * 20 + py * 18, 16), [b.x, b.y, bz + 1]],
      [P(b.x + ux * 25 - px * 10, b.y + uy * 25 - py * 10, 18), [b.x - ux * 25, b.y - uy * 25, bz + 2]],
      [P(b.x + ux * 35, b.y + uy * 35, 30), [t.x + dx * 0.25, t.y + dy * 0.25, tz]],
    ];
  }
  function catmull(P, t) {
    var n = P.length - 1, s = clamp(t, 0, 0.9999) * n, i = Math.floor(s), u = s - i;
    var p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n, i + 1)], p3 = P[Math.min(n, i + 2)];
    var out = [];
    for (var k = 0; k < 3; k++) out.push(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u));
    return out;
  }
  function startIntro() { G.mode = 'intro'; G.introT = 0; $('intro').classList.add('show'); document.body.classList.add('introing'); }
  // the throw range only flashes up as the hole opens, then gets out of the way
  var fanT = 0;
  function flashFan() { document.body.classList.add('fanflash'); clearTimeout(fanT); fanT = setTimeout(function () { document.body.classList.remove('fanflash'); }, 1500); }
  function skipIntro(landed) { if (G.mode !== 'intro') return; $('intro').classList.remove('show'); document.body.classList.remove('introing'); toAim(); if (!landed) { snapCam(); flash(); } G.camBlend = 1; flashFan(); }
  // a hard cut to the lie (the camera never flies through the mountain to get there)
  function snapCam() { aimView(tmpP, tmpL); camPos.copy(tmpP); camLook.copy(tmpL); G.camBlend = 1; }
  function flash() { var f = $('flash'); if (!f) return; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }

  /* ---------------- the loop ---------------- */
  var last = performance.now(), clock = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    if (!active || !world) return;
    auroraU.t.value = clock; basket.beacon.material.uniforms.t.value = clock; BIO.t.value = clock; POINT_U.t.value = clock;
    if (glow) { var rp = 1 + 0.06 * Math.sin(clock * 1.6); basket.ring.scale.set(rp, rp, 1); basket.ring.material.opacity = 0.45 + 0.25 * Math.sin(clock * 1.6); }
    walkRing.visible = glow && WALK.on && G.mode === 'look';
    if (walkRing.visible) { var wz = Math.max(Wd.G(ORB.fx, ORB.fy), Wd.WATER) + 0.06, ws = 1 + 0.12 * Math.sin(clock * 3); walkRing.position.set(ORB.fx, wz, -ORB.fy); walkRing.scale.set(ws, ws, 1); }
    if (water) { if (water.ftex) water.ftex.offset.y -= dt * 1.6; water.mist.children.forEach(function (s, i) { s.material.opacity = (glow ? 0.2 : 0.32) + 0.1 * Math.sin(clock * 0.8 + s.userData.ph); }); }
    animateMotes(glowL, clock, dt);
    burst.step(dt);

    var wantP = tmpP, wantL = tmpL, k = 1 - Math.exp(-dt * 3.2);
    if (G.mode === 'intro') {
      G.introT += dt / 9;
      var pp = catmull(INTRO.map(function (q) { return q[0]; }), ease(G.introT)), ll = catmull(INTRO.map(function (q) { return q[1]; }), ease(G.introT));
      wantP.copy(V(pp[0], pp[1], pp[2])); wantL.copy(V(ll[0], ll[1], ll[2])); k = 1;
      if (G.introT >= 1) { G.introT = 1; skipIntro(true); }
      placeDisc(G.lie.x, G.lie.y, -100, 0, 0, 1, 0);
    } else if (G.mode === 'aim' || G.mode === 'compute') {
      aimView(wantP, wantL);
      if (G.camBlend < 1) { G.camBlend = Math.min(1, G.camBlend + dt * 0.9); k = 1 - Math.exp(-dt * (2 + 6 * G.camBlend)); } else k = 1 - Math.exp(-dt * 8);
      var zl = Wd.G(G.lie.x, G.lie.y), a = G.aim * DEG;
      placeDisc(G.lie.x + Math.sin(a) * 0.6, G.lie.y + Math.cos(a) * 0.6, zl + 1.1 + Math.sin(clock * 2) * 0.03, 0, 0, 1, clock * 0.5);
      aimL.pts.visible = false;
      aimL.ring.visible = true; aimL.ring.position.copy(V(G.lie.x, G.lie.y, zl + 0.05));
      if (G.target) { var gt = G.target, gz = Wd.G(gt.x, gt.y); aimL.tring.visible = true; aimL.tring.position.copy(V(gt.x, gt.y, gz + 0.08)); var ts = clamp(camera.position.distanceTo(aimL.tring.position) * 0.02, 0.6, 5); aimL.tring.scale.set(ts, ts, ts); } else aimL.tring.visible = false;
    } else if (G.mode === 'flight') {
      aimL.pts.visible = false; aimL.ring.visible = false; aimL.tring.visible = false;
      G.playT += dt;
      var rec = G.rec, o = rec.origin, S = sampleAt(rec, G.playT);
      var wx = o.x + S.x * FT, wy = o.y + S.y * FT, wz = o.z + S.z * FT;
      placeDisc(wx, wy, wz, S.nx, S.ny, S.nz, S.spinAngle);
      if (S.chains) basket.setChains(S.chains);
      // trail
      var P = disc.pts; P.push([wx, wz, -wy]); if (P.length > disc.TN) P.shift();
      var gc = glow ? [0.35, 0.95, 1] : [1, 1, 1];
      for (var i = 0; i < P.length; i++) { var f = i / P.length; disc.tpos[i * 3] = P[i][0]; disc.tpos[i * 3 + 1] = P[i][1]; disc.tpos[i * 3 + 2] = P[i][2]; disc.tcol[i * 3] = gc[0] * f; disc.tcol[i * 3 + 1] = gc[1] * f; disc.tcol[i * 3 + 2] = gc[2] * f; }
      disc.trail.geometry.attributes.position.needsUpdate = true; disc.trail.geometry.attributes.color.needsUpdate = true; disc.trail.geometry.setDrawRange(0, P.length);
      if (glow) {
        for (i = 0; i < P.length; i++) { var f2 = Math.pow(i / P.length, 1.5), hh = 0.07 * (0.3 + 0.7 * f2), q = i * 6; disc.rpos[q] = P[i][0]; disc.rpos[q + 1] = P[i][1] - hh; disc.rpos[q + 2] = P[i][2]; disc.rpos[q + 3] = P[i][0]; disc.rpos[q + 4] = P[i][1] + hh; disc.rpos[q + 5] = P[i][2]; for (var c2 = 0; c2 < 2; c2++) { disc.rcol[q + c2 * 3] = 0.3 * f2; disc.rcol[q + c2 * 3 + 1] = 0.9 * f2; disc.rcol[q + c2 * 3 + 2] = 1.0 * f2; } }
        disc.rib.geometry.attributes.position.needsUpdate = true; disc.rib.geometry.attributes.color.needsUpdate = true; disc.rib.geometry.setDrawRange(0, Math.max(0, (P.length - 1) * 6)); disc.rib.visible = true;
      } else disc.rib.visible = false;
      // chase cam: behind the disc along its path, never under the ground
      var S2 = sampleAt(rec, Math.max(0, G.playT - 0.25)), vx = (S.x - S2.x), vy = (S.y - S2.y), vl = Math.hypot(vx, vy);
      if (vl < 0.05) { vx = Math.sin(G.aim * DEG); vy = Math.cos(G.aim * DEG); vl = 1; }
      var near = basketDist({ x: wx, y: wy }) < 8, back2 = near ? 5 : 9, cx = wx - vx / vl * back2, cy = wy - vy / vl * back2;
      var camZ = Math.max(wz + (near ? 1.6 : 3), groundEye(cx, cy, 1.5));
      wantP.copy(V(cx, cy, camZ));
      wantL.copy(V(wx, wy, wz));
      if (leavesBetween(cx, cy, camZ, wx, wy, wz)) G.flySeeT = 0.7;
      k = 1 - Math.exp(-dt * 3.5);
      if (G.playT >= G.flightEnd + 0.15) finishThrow();
    } else if (G.mode === 'after') {
      G.afterT += dt;
      var rest = G.rec.rest, ang = G.afterT * 0.35 + Math.atan2(G.rec.rest.x - G.rec.origin.x, G.rec.rest.y - G.rec.origin.y) + Math.PI;
      var rr = G.done ? 7 : 6;
      wantP.copy(V(rest.x + Math.sin(ang) * rr, rest.y + Math.cos(ang) * rr, Math.max(rest.z + 3, groundEye(rest.x + Math.sin(ang) * rr, rest.y + Math.cos(ang) * rr, 1.6))));
      wantL.copy(V(rest.x, rest.y, rest.z + 0.4)); k = 1 - Math.exp(-dt * 1.6);
      if (leavesBetween(rest.x + Math.sin(ang) * rr, rest.y + Math.cos(ang) * rr, Math.max(rest.z + 3, groundEye(rest.x + Math.sin(ang) * rr, rest.y + Math.cos(ang) * rr, 1.6)), rest.x, rest.y, rest.z + 0.4)) G.flySeeT = 0.7;
      var last2 = G.rec.samples[G.rec.samples.length - 1]; if (G.rec.made && last2.chains) basket.setChains(last2.chains);
      if (G.afterT > (G.done ? 3.2 : 2.2)) { if (G.done) { G.mode = 'end'; showEnd(); } else toAim(); }
    } else if (G.mode === 'look') { if (WALK.on) walkStep(dt); lookView(wantP, wantL); k = 1 - Math.exp(-dt * (WALK.on ? 16 : 10)); placeDisc(Wd.TEE.x, Wd.TEE.y, -500, 0, 0, 1, 0); aimL.ring.visible = false; aimL.tring.visible = false; aimL.pts.visible = false; }
    else { wantP.copy(camPos); wantL.copy(camLook); }

    var aiming2 = G.mode === 'aim' || G.mode === 'compute';
    G.flySeeT = Math.max(0, (G.flySeeT || 0) - dt);
    setSee(!!(G.see || (aiming2 && G.view !== 'over' && (G.seeAuto || SPOT.score > 3)) || ((G.mode === 'flight' || G.mode === 'after') && G.flySeeT > 0)));
    camPos.lerp(wantP, k); camLook.lerp(wantL, k);
    camera.position.copy(camPos); camera.lookAt(camLook);
    var fov = G.mode === 'aim' || G.mode === 'compute' ? clamp(52 * Math.pow(0.8, G.zoom), 11, 68) : 52;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 10)); camera.updateProjectionMatrix(); }
    updateReticle();
    sky.position.copy(camera.position); stars.position.copy(camera.position); aurora.position.set(camera.position.x, 0, camera.position.z);
    planet.position.set(camera.position.x + 900, 950, camera.position.z - 3800);
    // pin marker: a constant size on screen, hidden up close
    var pd = camera.position.distanceTo(basket.group.position);
    basket.pin.scale.set(pd * 0.03, pd * 0.0375, 1); basket.pin.position.y = 3.2 + pd * 0.012; basket.pin.visible = pd > 18 && G.mode !== 'intro';
    // the halo keeps the disc findable at a distance
    var dd = camera.position.distanceTo(disc.grp.position); disc.halo.scale.setScalar(clamp(dd * 0.035, 0.5, 4) * (glow ? 1.3 : 1));
    if (composer) composer.render(); else renderer.render(scene, camera);
  }

  /* ---------------- look mode: orbit the hole you are building ---------------- */
  var ORB = { yaw: 0, pitch: 0.55, dist: 160, fx: 0, fy: 100, drag: null, pinch: null, touches: {} };
  function lookAt(x, y, dist, yaw, pitch, snap) { ORB.fx = x; ORB.fy = y; if (dist) ORB.dist = dist; if (yaw != null) ORB.yaw = yaw; if (pitch != null) ORB.pitch = pitch; if (snap) { lookView(tmpP, tmpL); camPos.copy(tmpP); camLook.copy(tmpL); } }
  function lookView(outP, outL) {
    if (WALK.on) {
      var ez = Math.max(Wd.G(ORB.fx, ORB.fy), Wd.WATER) + 1.7, cw = Math.cos(WALK.wp);
      outP.copy(V(ORB.fx, ORB.fy, ez)); outL.copy(V(ORB.fx + Math.sin(ORB.yaw) * cw * 10, ORB.fy + Math.cos(ORB.yaw) * cw * 10, ez + Math.sin(WALK.wp) * 10)); return;
    }
    var fz = Wd.G(ORB.fx, ORB.fy), cp = Math.cos(ORB.pitch), x = ORB.fx - Math.sin(ORB.yaw) * cp * ORB.dist, y = ORB.fy - Math.cos(ORB.yaw) * cp * ORB.dist;
    var z = Math.max(fz + Math.sin(ORB.pitch) * ORB.dist, groundEye(x, y, 3));
    outP.copy(V(x, y, z)); outL.copy(V(ORB.fx, ORB.fy, fz));
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (G.mode !== 'look') return;
    ORB.touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ks = Object.keys(ORB.touches);
    if (ks.length === 2) { var a = ORB.touches[ks[0]], b = ORB.touches[ks[1]]; ORB.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: ORB.dist }; ORB.drag = null; }
    else ORB.drag = { x: e.clientX, y: e.clientY, yaw: ORB.yaw, pitch: ORB.pitch, wp: WALK.wp, fx: ORB.fx, fy: ORB.fy, pan: !WALK.on && (e.button === 2 || e.shiftKey) };
    TAP = ks.length === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
  });
  canvas.addEventListener('contextmenu', function (e) { if (G.mode === 'look') e.preventDefault(); });
  window.addEventListener('pointermove', function (e) {
    if (G.mode !== 'look' || !ORB.touches[e.pointerId]) return;
    ORB.touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ks = Object.keys(ORB.touches);
    if (TAP && TAP.id === e.pointerId && Math.hypot(e.clientX - TAP.x, e.clientY - TAP.y) > 9) TAP = null;
    if (ORB.pinch && ks.length === 2) { if (WALK.on) return; var a = ORB.touches[ks[0]], b = ORB.touches[ks[1]]; ORB.dist = clamp(ORB.pinch.dist * ORB.pinch.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), 12, 520); return; }
    var D = ORB.drag; if (!D) return;
    var dx = e.clientX - D.x, dy = e.clientY - D.y;
    if (D.pan) { var k = ORB.dist / 600, c = Math.cos(ORB.yaw), sn = Math.sin(ORB.yaw); ORB.fx = D.fx - (dx * c - dy * sn) * k; ORB.fy = D.fy + (dx * sn + dy * c) * k; }
    else if (WALK.on) { ORB.yaw = D.yaw - dx * 0.005; WALK.wp = clamp(D.wp + dy * 0.004, -1.2, 1.1); }
    else { ORB.yaw = D.yaw + dx * 0.006; ORB.pitch = clamp(D.pitch + dy * 0.004, 0.08, 1.45); }
  });
  function orbUp(e) {
    if (G.mode === 'look' && TAP && TAP.id === e.pointerId && performance.now() - TAP.t < 450 && LOOK.onTap) { var hit = pickTree(e.clientX, e.clientY); LOOK.onTap(hit, e.clientX, e.clientY); }
    if (TAP && TAP.id === e.pointerId) TAP = null;
    delete ORB.touches[e.pointerId]; if (Object.keys(ORB.touches).length < 2) ORB.pinch = null; if (!Object.keys(ORB.touches).length) ORB.drag = null; }
  window.addEventListener('pointerup', orbUp); window.addEventListener('pointercancel', orbUp);
  canvas.addEventListener('wheel', function (e) { if (G.mode !== 'look') return; e.preventDefault(); if (WALK.on) { var st = (e.deltaY > 0 ? -2 : 2), q = walkCollide(ORB.fx + Math.sin(ORB.yaw) * st, ORB.fy + Math.cos(ORB.yaw) * st); ORB.fx = q.x; ORB.fy = q.y; return; } ORB.dist = clamp(ORB.dist * (e.deltaY > 0 ? 1.1 : 0.9), 12, 520); }, { passive: false });


  /* ---------------- walk: first person under the canopy (joystick, WASD, drag to look) ---------------- */
  var TAP = null, LOOK = {}, WALK = { on: false, jx: 0, jy: 0, keys: {}, near: [], nearAt: null, wp: -0.05 };
  function walkCollide(x, y) {
    if (!WALK.nearAt || Math.hypot(x - WALK.nearAt.x, y - WALK.nearAt.y) > 8) { WALK.nearAt = { x: x, y: y }; WALK.near = world.solids.filter(function (s) { return s.kind !== 'capsule' && s.kind !== 'blob' && Math.hypot(s.x - x, s.y - y) < 34; }); }
    var ez = Wd.G(x, y);
    for (var i = 0; i < WALK.near.length; i++) {
      var s = WALK.near[i];
      if (s.kind === 'cyl') { if (ez + 1 < s.z0 || ez > s.z1) continue; var dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy), m = s.r + 0.35; if (d < m && d > 1e-4) { x = s.x + dx / d * m; y = s.y + dy / d * m; } }
      else if (s.kind === 'sphere') { var dx2 = x - s.x, dy2 = y - s.y, d2 = Math.hypot(dx2, dy2), m2 = s.r * 0.95 + 0.35; if (ez < s.z + s.r * 0.6 && d2 < m2 && d2 > 1e-4) { x = s.x + dx2 / d2 * m2; y = s.y + dy2 / d2 * m2; } }
      else if (s.kind === 'box') {
        var c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = (x - s.x) * c + (y - s.y) * sn, ly = -(x - s.x) * sn + (y - s.y) * c, hx = s.hx + 0.35, hy = s.hy + 0.35;
        if (Math.abs(lx) < hx && Math.abs(ly) < hy && ez + 0.5 < s.z1 && ez + 1.7 > s.z0) { if (hx - Math.abs(lx) < hy - Math.abs(ly)) lx = (lx < 0 ? -1 : 1) * hx; else ly = (ly < 0 ? -1 : 1) * hy; x = s.x + lx * c - ly * sn; y = s.y + lx * sn + ly * c; }
      }
    }
    var b = Wd.bounds; return { x: clamp(x, b.x0 + 2, b.x1 - 2), y: clamp(y, b.y0 + 2, b.y1 - 2) };
  }
  function walkStep(dt) {
    var K = WALK.keys, fw = WALK.jy + (K.w || K.arrowup ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0), st = WALK.jx + (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0), mag = Math.hypot(fw, st);
    if (mag < 0.05) return; if (mag > 1) { fw /= mag; st /= mag; }
    var sp = (K.shift ? 18 : 7.5) * dt, sy = Math.sin(ORB.yaw), cy = Math.cos(ORB.yaw), q = walkCollide(ORB.fx + (sy * fw + cy * st) * sp, ORB.fy + (cy * fw - sy * st) * sp);
    ORB.fx = q.x; ORB.fy = q.y;
  }
  function walk(on) {
    on = !!on; if (on === WALK.on) return; WALK.on = on; document.body.classList.toggle('mode-walk', on); WALK.jx = WALK.jy = 0; WALK.keys = {};
    if (on) { WALK.wp = -0.05; var q = walkCollide(ORB.fx, ORB.fy); ORB.fx = q.x; ORB.fy = q.y; }
    else { ORB.dist = Math.max(30, ORB.dist * 0.4); ORB.pitch = 0.45; }
  }
  var joy = $('joy'), joyK = $('joyK'), JOY = null;
  function joyMove(e) { var dx = e.clientX - JOY.cx, dy = e.clientY - JOY.cy, m = Math.hypot(dx, dy), R0 = JOY.R * 0.62; if (m > R0) { dx *= R0 / m; dy *= R0 / m; } WALK.jx = dx / R0; WALK.jy = -dy / R0; joyK.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)'; }
  function joyEnd(e) { if (JOY && e.pointerId === JOY.id) { JOY = null; WALK.jx = WALK.jy = 0; joyK.style.transform = ''; } }
  joy.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); try { joy.setPointerCapture(e.pointerId); } catch (er) {} var r = joy.getBoundingClientRect(); JOY = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width / 2 }; joyMove(e); });
  joy.addEventListener('pointermove', function (e) { if (JOY && e.pointerId === JOY.id) joyMove(e); });
  joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
  function typing(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  window.addEventListener('keydown', function (e) { if (G.mode !== 'look' || !WALK.on || typing(e)) return; var k = e.key.toLowerCase(); WALK.keys[k] = true; if (k.indexOf('arrow') === 0) e.preventDefault(); });
  window.addEventListener('keyup', function (e) { WALK.keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { WALK.keys = {}; });

  /* ---------------- boot, and the API the builder drives ---------------- */
  var active = true, started = false;
  function init() {
    if (started) return; started = true;
    resize(); disc = buildDisc(); aimL = buildAimLine(); layout();
    $('load').classList.add('gone');
    requestAnimationFrame(frame);
  }
  function playHole(ctx) {
    G.ctx = ctx || {}; document.body.classList.remove('throwing', 'mode-look'); document.body.classList.add('mode-play'); active = true;
    $('bExit').hidden = !G.ctx.onExit;
    layout(); restart(!G.ctx.noIntro);
  }
  function stopPlay() {
    G.mode = 'idle'; document.body.classList.remove('mode-play', 'throwing', 'introing');
    $('end').classList.remove('show'); $('toast').classList.remove('show'); $('intro').classList.remove('show');
    IN.pts = []; drawStroke();
  }
  function look(on) {
    LOOK = (on && typeof on === 'object') ? on : {};
    if (on) { stopPlay(); G.mode = 'look'; active = true; document.body.classList.add('mode-look'); lookView(tmpP, tmpL); camPos.copy(tmpP); camLook.copy(tmpL); }
    else { walk(false); selectTree(null); if (G.mode === 'look') G.mode = 'idle'; document.body.classList.remove('mode-look'); }
  }
  $('eNext').addEventListener('click', function () { var c = G.ctx || {}; if (c.onNext) c.onNext(); });
  $('eBack').addEventListener('click', function () { var c = G.ctx || {}; stopPlay(); if (c.onExit) c.onExit(); });
  $('bExit').addEventListener('click', function () { var c = G.ctx || {}; stopPlay(); if (c.onExit) c.onExit(); });
  window.AureliaGame = {
    setBag: function (list) { PL.setCustom(list || []); try { localStorage.setItem(BAG_KEY, JSON.stringify(PL.customList())); } catch (e) {} renderBag(); }, getBag: function () { return PL.customList(); }, onBag: function (fn) { bagHook = fn; },
    init: init, load: function (W) { init(); loadWorld(W); }, play: playHole, stop: stopPlay, look: look, lookAt: lookAt,
    setActive: function (v) { active = !!v; },
    pickTree: pickTree, selectTree: selectTree, refreshPlants: refreshPlants, walk: walk, isWalking: function () { return WALK.on; },
    setSee: function (v) { G.see = !!v; $('bSee').classList.toggle('on', G.see); }, isSee: function () { return !!G.see; },
    lookState: function () { return { x: ORB.fx, y: ORB.fy, yaw: ORB.yaw, dist: ORB.dist, walking: WALK.on }; }, setGlow: function (v) { glow = !!v; applyLook(); }, isGlow: function () { return glow; },
  };
  window.__aur = { WALK: WALK, SEL: SEL, pickTree: pickTree, setSee: setSee, scene: scene, ff: function (t) { G.playT += t; }, G: G, get Wd() { return Wd; }, PL: PL, E: E, camera: camera, skipIntro: skipIntro, throwIt: throwIt, pickTarget: pickTarget, setTarget: setTarget, screenOf: screenOf, L: function () { return L; }, setGlow: function (v) { glow = v; applyLook(); }, toAim: toAim, renderer: renderer, ORB: ORB };
  function boot() {
    init(); loadWorld(AureliaWorld);
    var q = location.hash.replace('#', '');
    if (q === 'glow') { glow = true; applyLook(); }
    camPos.copy(V(-55, -55, 120)); camLook.copy(V(5, 120, 40));
    playHole({});
  }
  if (!window.AURELIA_EMBED) setTimeout(boot, 30);
})();
