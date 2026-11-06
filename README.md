# Aurelia

A disc golf course builder and game set on a lush alien world, by Demon Digital Media for Flightline DG.

- **Course Builder**: sculpt terrain, paint surfaces and water, plant forests (guardians, ancient oaks, pines, palms and more), cut flightline paths through the woods, place ruins, sculptures and half-buried step pyramids, then walk it or play it in 3D. Holes collect into 9- and 18-hole courses.
- **The Terraces**: the showcase hole, playable on its own.
- **Glow mode**: the night version, with bioluminescent plants and neon line work.

## Play it

Once GitHub Pages is on (see below), the site lives at **https://demondigitalmedia.github.io/Aurelia/**:

| Page | What it is |
|---|---|
| `index.html` | Landing page with controls and how to share |
| `builder.html` | The Course Builder |
| `terraces.html` | The Terraces |

The site installs as an app (Install button on the landing page and in the builder library, or the browser's Add to Home screen) and plays offline once it has opened online.

Holes save in each player's browser. To pass holes and courses around, use **Share hole file** (hole menu) or **Share course file** (course screen), and **Import** in the library. Files are plain JSON with the `.aurelia.json` extension.

## Project layout

```
src/
  shell.html      game HUD markup and styles
  builder.html    builder markup and styles
  game.js         renderer, cameras, throwing, glow, views (three.js r128)
  builder.js      builder app: library, editor, courses, sharing, tour
  play.js         throws, the aim solver, the bag (stock and custom discs)
  holeworld.js    built-hole data: terrain grid, trees, elements, paths, randomizer
  world.js        The Terraces as an analytic world
  treespec.js     one tree description for both physics and drawing
engines/          Flightline physics, basket and contact engines (from the Flightline DG simulator)
vendor/           three.js r128 and its bloom post-processing passes (MIT)
site/index.html   GitHub Pages landing page
site/manifest.webmanifest, site/sw.js, site/icons/   installable app: manifest, service worker template, icons
src/pwa-head.html head tags and install/offline script for the site builds
tests/            Node tests for the solver, templates, randomizer and tunnels
tools/bench.js    render and solver benchmark (needs Playwright with Chromium)
build.py          builds The Terraces page
build_builder.py  builds the Course Builder page
build_site.py     builds both with --site and assembles the Pages site in _site/
```

## Build and test

Needs Python 3 and Node 18 or newer. No packages to install.

```
node tests/solver.test.js
node tests/templates.test.js
node tests/randomizer.test.js
node tests/tunnels.test.js

python3 build.py --site            # dist/aurelia-terraces-site.html
python3 build_builder.py --site    # dist/aurelia-builder-site.html
python3 build_builder.py --local   # offline copy that loads vendor/three.min.js

python3 build_site.py                       # the whole Pages site in _site/
python3 -m http.server -d _site 8000        # test the app, offline mode and install at localhost:8000

node tools/bench.js                         # after the --local builds: ms per frame, draw calls, solver ms
```

Add `#bench` to a page URL (for example `builder.html#bench`) for a corner readout of frame time, draw calls, triangles and pixel ratio on any device.

Each build is a single self-contained HTML file. Open the `--local` build straight from disk to test without a network. With no flag, the build is the version published as a Claude artifact.

## GitHub Pages

`.github/workflows/pages.yml` runs the tests, runs `build_site.py` and publishes `_site/` on every push to `main`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Working on it

- Coordinates are engine metres: x right, y downrange, z up. three.js gets `(x, z, -y)`.
- Trees are `[type, x, y, h, c, rot, lean, canopyBase, age]` records. `treespec.js` turns them into physics bodies, and `game.js` draws them from the same numbers.
- The builder stores data through `Store` in `builder.js`: Claude artifact storage when it is available, otherwise `localStorage`.
- Keep pages self-contained: three.js from cdnjs (a local copy in `--site` and `--local` builds), everything else inline.
