// Render and solver benchmark. Needs Playwright with Chromium (not a project dependency).
//   python3 build.py --local && python3 build_builder.py --local && node tools/bench.js [label]
// Headless Chromium draws with SwiftShader (software GL) unless a GPU is available, so read the ms columns
// as relative (before against after on the same machine); draw calls and solver ms carry over to devices.
const path = require('path');
const { chromium } = require('playwright');
const DIST = path.join(__dirname, '..', 'dist');
const FRAMES = 90;

// counts every draw call in a frame (bloom and shadow passes too) and times frame to frame
const HOOK = () => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__bench = { on: false, t: [], calls: [], tris: [] };
  window.requestAnimationFrame = cb => raf(now => {
    const B = window.__bench, r = window.__aur && window.__aur.renderer;
    if (r) { r.info.autoReset = false; r.info.reset(); }
    cb(now);
    if (B.on && r) { B.t.push(now); B.calls.push(r.info.render.calls); B.tris.push(r.info.render.triangles); }
  });
};

async function measure(p) {
  await p.evaluate(() => { const B = window.__bench; B.t = []; B.calls = []; B.tris = []; B.on = true; });
  await p.waitForFunction(n => window.__bench.t.length >= n, FRAMES, { timeout: 600000, polling: 250 });
  return p.evaluate(() => {
    const B = window.__bench; B.on = false;
    const d = []; for (let i = 1; i < B.t.length; i++) d.push(B.t[i] - B.t[i - 1]); d.sort((a, b) => a - b);
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
    return { ms: +avg(d).toFixed(1), p90: +d[Math.floor(d.length * 0.9)].toFixed(1), calls: Math.round(avg(B.calls)), ktris: Math.round(avg(B.tris) / 1000),
      dpr: +window.__aur.renderer.getPixelRatio().toFixed(2) };
  });
}

async function scene(p, label, setup) {
  // pin the resolution so runs compare like for like (adaptive pixel ratio is measured on its own below)
  await p.evaluate(() => { if (window.__aur.PERF) window.__aur.PERF.hold = Infinity; });
  await p.evaluate(setup); await p.waitForTimeout(1500);
  const r = await measure(p); console.log(label.padEnd(30), JSON.stringify(r)); return r;
}

(async () => {
  const b = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  console.log('==', process.argv[2] || 'run', '==');
  // The Terraces
  let p = await ctx.newPage(); await p.addInitScript(HOOK);
  await p.goto('file://' + path.join(DIST, 'aurelia-terraces-local.html'));
  await p.waitForFunction(() => window.__aur && window.__aur.G.mode !== 'idle', null, { timeout: 120000 });
  await p.evaluate(() => window.__aur.skipIntro(true)); await p.waitForTimeout(1000);
  await scene(p, 'terraces day, tee view', () => { window.__aur.setGlow(false); window.__aur.G.view = 'tee'; });
  await scene(p, 'terraces day, overhead', () => { window.__aur.G.view = 'over'; });
  await scene(p, 'terraces glow, tee view', () => { window.__aur.setGlow(true); window.__aur.G.view = 'tee'; });
  await p.close();
  // a dense built hole (randomizer, guardian archetype)
  p = await ctx.newPage(); await p.addInitScript(HOOK);
  await p.goto('file://' + path.join(DIST, 'aurelia-builder-local.html'));
  await p.waitForFunction(() => window.AureliaGame && window.HoleWorld, null, { timeout: 120000 });
  await p.evaluate(() => { const d = HoleWorld.randomHole('guardian', 1234); AureliaGame.load(HoleWorld.world(d)); AureliaGame.play({ noIntro: true }); });
  await p.waitForFunction(() => window.__aur && window.__aur.G.mode === 'aim', null, { timeout: 120000 });
  await scene(p, 'built hole day, tee view', () => { window.__aur.setGlow(false); window.__aur.G.view = 'tee'; });
  await scene(p, 'built hole day, overhead', () => { window.__aur.G.view = 'over'; });
  // aim solver as the game runs it (first solve from the tee, then the same solve again)
  const sv = await p.evaluate(() => {
    // nudge the target so the game's own earlier solve is not a cache hit
    const A = window.__aur, G = A.G, tg = Object.assign({}, G.target, { x: G.target.x + 0.37 });
    const t0 = performance.now(); A.PL.solveTo(A.E, G.lie, G.disc, tg); const t1 = performance.now();
    A.PL.solveTo(A.E, G.lie, G.disc, tg); const t2 = performance.now();
    return { firstMs: +(t1 - t0).toFixed(1), repeatMs: +(t2 - t1).toFixed(1) };
  });
  console.log('aim solver'.padEnd(30), JSON.stringify(sv));
  await b.close();
})();
