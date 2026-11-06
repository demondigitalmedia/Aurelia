# Assemble the GitHub Pages site in _site/: the landing page, both game pages, three.js, the app manifest,
# icons and a service worker whose cache version comes from the content of everything it precaches.
# Test locally with: python3 build_site.py && python3 -m http.server -d _site 8000
import sys, os, shutil, subprocess, hashlib, json
D = os.path.dirname(os.path.abspath(__file__)); SITE = os.path.join(D, 'site'); OUT = os.path.join(D, '_site')
os.makedirs(os.path.join(D, 'dist'), exist_ok=True)
for b in ['build.py', 'build_builder.py']:
    subprocess.run([sys.executable, os.path.join(D, b), '--site'], check=True)
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(os.path.join(OUT, 'icons'))
pwa = open(os.path.join(D, 'src', 'pwa-head.html')).read()
index = open(os.path.join(SITE, 'index.html')).read()
assert '<!--PWA-->' in index, 'site/index.html needs the <!--PWA--> marker in its head'
open(os.path.join(OUT, 'index.html'), 'w').write(index.replace('<!--PWA-->', pwa, 1))
shutil.copy(os.path.join(D, 'dist', 'aurelia-builder-site.html'), os.path.join(OUT, 'builder.html'))
shutil.copy(os.path.join(D, 'dist', 'aurelia-terraces-site.html'), os.path.join(OUT, 'terraces.html'))
shutil.copy(os.path.join(D, 'vendor', 'three.min.js'), os.path.join(OUT, 'three.min.js'))
shutil.copy(os.path.join(SITE, 'manifest.webmanifest'), os.path.join(OUT, 'manifest.webmanifest'))
icons = sorted(f for f in os.listdir(os.path.join(SITE, 'icons')) if f.endswith('.png'))
for f in icons:
    shutil.copy(os.path.join(SITE, 'icons', f), os.path.join(OUT, 'icons', f))
files = ['index.html', 'builder.html', 'terraces.html', 'three.min.js', 'manifest.webmanifest'] + ['icons/' + f for f in icons]
h = hashlib.sha256()
for f in files:
    h.update(f.encode()); h.update(open(os.path.join(OUT, f), 'rb').read())
version = h.hexdigest()[:12]
sw = open(os.path.join(SITE, 'sw.js')).read().replace('__VERSION__', version, 1).replace('__PRECACHE__', json.dumps(['./'] + files), 1)
open(os.path.join(OUT, 'sw.js'), 'w').write(sw)
print(OUT, 'cache', version, len(files) + 1, 'files')
