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
- The site is an installable app: `build_site.py` assembles `_site/` (pages, local three.min.js, manifest, icons, sw.js with a content-hash cache version). `src/pwa-head.html` goes in the site builds' head only; `window.AureliaApp` does not exist in the artifact build. Icons render from `site/icons/icon.svg` (keep the art inside the central 80% for maskable).
- Engine frame: metres, x right, y downrange, z up; three.js gets (x, z, -y).
- Run all four tests in tests/ before pushing. The Pages workflow runs them too.
- Physics engines in engines/ are shared with Putt League. Change calibration only on purpose and say so. v1.7 (stable drivers) changed fairway and driver flights for both games; putters (speed 1 to 3) are untouched.
- Performance: the shadow map is static (call reshadow() after anything that changes what casts shadows); plants, tufts, flowers and far trees are split into culling cells by chunk(); bloom runs in glow only; the pixel ratio adapts to frame time; the aim solver flies at 150 Hz (sim.stepHz) and is memoized. tools/bench.js measures it (needs Playwright).

## Next up
1. Performance follow-ups (the pass itself is done; see below):
   - Check on Damion's devices with builder.html#bench and terraces.html#bench (corner readout: ms, draw calls, triangles, pixel ratio). Compare #cell=100000 (no culling cells) against the default 128.
   - Day mode now renders straight to the canvas, so it gets the browser's 4x antialiasing (the composer target never had it). If day runs slower than glow on the tablet, that is the likely cost.
   - The big remaining cost is triangles (~1.7M per frame on a dense hole, mostly tree crowns, tufts and the terrain), not draw calls. Tree LOD would be the next lever.
2. Physics recalibration is done (engine v1.7, approved by Damion, Putt League flights may change): watch for feedback on how drivers fly. Putters with speed 1 to 3 are unchanged.
