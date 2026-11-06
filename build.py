# Assemble Aurelia: The Terraces into one page. three.js r128 (+ bloom passes) from CDNs, everything else inline.
import sys, os
D = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(D, 'src'); ENG = os.path.join(D, 'engines')
local = '--local' in sys.argv
site = '--site' in sys.argv
shell = open(os.path.join(S, 'shell.html')).read()
eng = ''.join(open(os.path.join(ENG, f)).read() + '\n' for f in ['flightline-physics.js', 'flightline-basket.js', 'ddm-materials.js', 'ddm-contact.js'])
mine = ''.join(open(os.path.join(S, f)).read() + '\n' for f in ['treespec.js', 'world.js', 'play.js', 'game.js'])
EX = ['shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js']
# the bloom passes ship inline (r128 examples/js, MIT), so only three itself is a separate file (cdnjs, or local for --site and --local)
TP = os.path.join(D, 'vendor') + '/'
exjs = ''.join(open(TP + e).read() + '\n' for e in EX)
three = '<script src="three.min.js"></script>\n' if local or site else '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
libs = three + '<script>\n' + exjs + '</script>\n'
html = shell + '\n' + libs + '<script>\n' + eng + mine + '</script>\n'
# --site: a standalone page for GitHub Pages (the Claude artifact host adds this skeleton itself), installable as an app.
# It expects three.min.js, manifest.webmanifest, sw.js and icons/ beside it: build_site.py puts them there.
if site:
    pwa = open(os.path.join(S, 'pwa-head.html')).read()
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            + pwa + '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style></head><body>\n'
            + html + '</body></html>\n')
out = os.path.join(D, 'dist', 'aurelia-terraces' + ('-local' if local else '-site' if site else '') + '.html')
os.makedirs(os.path.dirname(out), exist_ok=True); open(out, 'w').write(html); print(out, len(html))
if local:
    import shutil; shutil.copy(os.path.join(D, 'vendor', 'three.min.js'), os.path.join(D, 'dist', 'three.min.js'))
