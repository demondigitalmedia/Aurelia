# Assemble Aurelia Course Builder into one page: the game shell and HUD, the builder UI, the engines and the app.
import sys, os
D = os.path.dirname(os.path.abspath(__file__)); S = os.path.join(D, 'src'); ENG = os.path.join(D, 'engines'); V = os.path.join(D, 'vendor')
local = '--local' in sys.argv
shell = open(os.path.join(S, 'shell.html')).read().replace('<title>Aurelia Terraces</title>', '<title>Aurelia Course Builder</title>', 1)
ui = open(os.path.join(S, 'builder.html')).read()
eng = ''.join(open(os.path.join(ENG, f)).read() + '\n' for f in ['flightline-physics.js', 'flightline-basket.js', 'ddm-materials.js', 'ddm-contact.js'])
EX = ['shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js', 'postprocessing/UnrealBloomPass.js']
exjs = ''.join(open(os.path.join(V, e)).read() + '\n' for e in EX)
mine = ''.join(open(os.path.join(S, f)).read() + '\n' for f in ['treespec.js', 'world.js', 'play.js', 'holeworld.js'])
three = '<script src="three.min.js"></script>\n' if local else '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n'
html = (shell + '\n' + ui + '\n' + three + '<script>\n' + exjs + '</script>\n<script>\n' + eng + mine +
        'window.AURELIA_EMBED = true;\n' + open(os.path.join(S, 'game.js')).read() + '\n' + open(os.path.join(S, 'builder.js')).read() + '\n</script>\n')
# --site: a standalone page for GitHub Pages (the Claude artifact host adds this skeleton itself)
if '--site' in sys.argv:
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style></head><body>\n'
            + html + '</body></html>\n')
out = os.path.join(D, 'dist', 'aurelia-builder' + ('-local' if local else '-site' if '--site' in sys.argv else '') + '.html')
open(out, 'w').write(html); print(out, len(html))
if local:
    import shutil; shutil.copy(os.path.join(D, 'vendor', 'three.min.js'), os.path.join(D, 'dist', 'three.min.js'))
