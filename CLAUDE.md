# Aurelia: notes for Claude

Disc golf course builder and game for Flightline DG (Demon Digital Media). Owner: Damion.
See README.md for the layout, build and test commands.

## How Damion works
- No em dashes anywhere (code comments, copy, commits).
- Direct answers, reasoned calls, minimal clarifying questions. Ask before big rewrites.
- He tests on an Android tablet (Wacom MovinkPad Pro 14), an Android phone and a desktop browser. Check phone portrait, tablet portrait and landscape.
- Visual results go to him as a phone-friendly HTML page or the live site, not inline canvases.

## Ground rules
- Pages stay single self-contained HTML files built by build.py and build_builder.py.
- `--site` builds are for GitHub Pages, no flag is the Claude artifact version, `--local` is offline testing.
- Engine frame: metres, x right, y downrange, z up; three.js gets (x, z, -y).
- Run all four tests in tests/ before pushing. The Pages workflow runs them too.
- Physics engines in engines/ are shared with Putt League. Change calibration only on purpose and say so.

## Next up (planned, not started)
1. Installable app (PWA): manifest, icons, service worker for offline play, local three.min.js in the site build, Install button on the landing page and in the builder library, navigator.storage.persist().
2. Performance:
   - Static shadow map: shadowMap.autoUpdate false, update on load and tree edits; disc gets a blob shadow instead of casting.
   - Chunk the instanced trees, tufts and flowers into ~64 m cells with their own bounding spheres so frustum culling works (proxy geometries share attributes).
   - Skip the bloom composer in day mode; keep it for glow.
   - Adaptive pixel ratio from frame time (0.7 to min(dpr, 1.75)).
   - Aim solver: coarser physics step (CAL.stepHz around 150) and memoize per lie, disc and target. The real throw stays at 400 Hz.
   - Benchmark before and after (ms per frame, draw calls, solver ms).
3. Physics: drivers turn over too hard at the arm speeds the game uses (design speed ~10 + 2.54 x speed mph is far below game arms of 60 to 80 mph). Recalibrate with Damion's sign-off since Putt League shares the engine.
