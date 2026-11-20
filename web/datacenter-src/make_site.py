#!/usr/bin/env python3
"""Reshape the server-room page (archive-datacenter.html, made by build.sh) for the ArcHive site, at /datacenter/.

The site sends a strict Content-Security-Policy (deploy/Caddyfile): script-src 'self' (no inline script, no CDN) and a
connect-src without blob:. The page is reshaped, never rewritten:
- the module script leaves the page for room.src.js, which build.sh bundles with three.js r160 (esbuild);
- the import map goes (three is in the bundle); the two JSON blocks stay (data, never executed);
- two changes in the script, each patch found exactly once: the API is this site's own origin; GLTFLoader reads
  embedded textures as <img> (blob: images are allowed by the CSP, fetch() of blob: is not). The room is in English
  only (make_room.py), so no language is shared with the rest of the site;
- the console button stays on the site, in the same tab, with an arrow instead of the new-tab icon (deploy/build.sh
  points it at /console/);
- a real document head (charset, viewport, the console's favicon) and a small base reset (margins, font, safe areas).
usage: make_site.py <archive-datacenter.html> <m dir> <work dir> <out dir>   (out dir must be new or empty)
"""
import os, shutil, sys

page_path, m_dir, work, out = sys.argv[1:5]
page = open(page_path, encoding='utf-8').read()


def once(s, old, new, what):
    n = s.count(old)
    assert n == 1, f'{what}: expected once, found {n} times'
    return s.replace(old, new)


# 1. split the page: head (title, metas, fonts, style), markup, JSON data blocks, import map, module script
head_end = page.index('</style>') + len('</style>')
head, rest = page[:head_end], page[head_end:]
i_data = rest.index('<script type="application/json" id="base-data">')
markup, scripts = rest[:i_data], rest[i_data:]
i_map = scripts.index('<script type="importmap">')
data_blocks = scripts[:i_map]
M_OPEN = '<script type="module">'
i_mod = scripts.index(M_OPEN, i_map)
importmap = scripts[i_map:i_mod]
i_end = scripts.rindex('</script>')
code = scripts[i_mod + len(M_OPEN):i_end]
assert scripts[i_end + len('</script>'):].strip() == '', 'something follows the module script'
assert '<script' not in head and '<script' not in markup, 'a script outside the expected blocks'
assert data_blocks.count('<script') == 2 and data_blocks.count('type="application/json"') == 2
assert 'three@0.160.0' in importmap, 'three is no longer r160: update build-site.sh'

# 2. the script, patched for the site
code = once(code, "const API = 'https://archive.62-171-153-35.sslip.io/api';",
            "const API = location.origin + '/api'; /* site: the API of this very site */", 'API')
code = once(code, "const loader = new GLTFLoader();\n",
            "const loader = new GLTFLoader();\n"
            "/* site: the CSP allows blob: images but not fetch() of blob: (ImageBitmapLoader): textures load as <img> */\n"
            "loader.register((parser) => {\n"
            "  const tl = new THREE.TextureLoader(parser.options.manager);\n"
            "  tl.setCrossOrigin(parser.options.crossOrigin);\n"
            "  parser.textureLoader = tl;\n"
            "  return { name: 'archive_img_textures' };\n"
            "});\n", 'loader')
PACKS = ['factory', 'station', 'shop', 'space', 'chars', 'racks']
assert "['factory', 'station', 'shop', 'space', 'chars'].concat(RACK_STYLE !== 'code' ? ['racks'] : [])" in code, 'pack list changed'
for bad in ('cdn.jsdelivr', 'archive.62-171-153-35'):
    assert bad not in code, f'{bad} still in the script'

# 3. the markup: the console button stays on the site, same tab
markup = once(markup, 'href="https://archive.62-171-153-35.sslip.io" target="_blank" rel="noopener"', 'href="/"', 'console link')
markup = once(markup, '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>', '<path d="M5 12h14M13 6l6 6-6 6"/>', 'console icon')

# 4. the document
RESET = (':root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}'
         'body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}')
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpolygon "
           "points='50,4 93,27 93,73 50,96 7,73 7,27' fill='%235b8cff'/%3E%3C/svg%3E")
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<meta name="theme-color" content="#0A0F1F">\n'
       f'<link rel="icon" href="{FAVICON}">\n'
       f'<style>{RESET}</style>\n{head}\n</head>\n<body>{markup}{data_blocks}'
       '<script type="module" src="room.js?v=__ROOM_V__"></script>\n</body>\n</html>\n')

os.makedirs(work, exist_ok=True)
open(os.path.join(work, 'room.src.js'), 'w', encoding='utf-8').write(code)
if os.path.exists(out):
    assert not os.listdir(out), f'{out} is not empty'
os.makedirs(os.path.join(out, 'm'), exist_ok=True)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(doc)

# 5. the models: the six packs the page loads, their textures, the licences (never m/candidates/)
for p in PACKS:
    shutil.copyfile(os.path.join(m_dir, f'{p}.json'), os.path.join(out, 'm', f'{p}.json'))
    if os.path.isdir(os.path.join(m_dir, p)):
        shutil.copytree(os.path.join(m_dir, p), os.path.join(out, 'm', p))
shutil.copyfile(os.path.join(m_dir, 'LICENSE-kenney-cc0.txt'), os.path.join(out, 'm', 'LICENSE-kenney-cc0.txt'))
open(os.path.join(out, 'CREDITS.txt'), 'w', encoding='utf-8').write(
    "ArcHive Datacenter: what this page is made of\n"
    "- Characters, furniture and room parts: Kenney (kenney.nl), Factory Kit, Space Station Kit, Furniture Kit,\n"
    "  Mini Shop and Mini Characters, CC0 1.0 (m/LICENSE-kenney-cc0.txt).\n"
    "- Server racks: \"Data center rack\" by Animase (NodeStar) on Sketchfab, Free Standard licence:\n"
    "  https://sketchfab.com/3d-models/data-center-rack-f178ec0a9c5f4605a5acbaaeb52dc721\n"
    "- three.js r160, MIT licence (at the end of room.js).\n"
    "- Data: the ArcHive API of this site and Arc testnet (https://explorer.testnet.arc.io).\n")
print('index.html', len(doc.encode()), 'bytes; room.src.js', len(code.encode()), 'bytes')
