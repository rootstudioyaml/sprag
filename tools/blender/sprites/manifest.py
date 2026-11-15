"""Writes WORK/out/manifest.json from the sheets that exist. Keeps a "tree" entry somebody else wrote.

  python3 manifest.py --work WORK [all|cat,dog] [plain,santa]

A sheet exists when WORK/out/<name>.webp or site/assets/scene/sprites/<name>.webp exists, so a WORK folder that
re-baked only some species still yields the manifest of the whole site. The geometry comes from geom.json next to
this file, the card cameras from WORK/card.json (or, when no card was baked, the card section of the site manifest).
"""
import json, os, sys
ARGS = sys.argv[1:]
if '--work' not in ARGS:
    sys.exit('--work DIR is required')
_wi = ARGS.index('--work')
W = os.path.abspath(ARGS[_wi + 1])
del ARGS[_wi:_wi + 2]
ONLY = ARGS[0].split(',') if len(ARGS) > 0 and ARGS[0] != 'all' else None
VARS = ARGS[1].split(',') if len(ARGS) > 1 else None
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SITE = os.path.join(REPO, 'site', 'assets', 'scene', 'sprites')
OUT = W + '/out'
os.makedirs(OUT, exist_ok=True)
has = lambda name: os.path.exists('%s/%s.webp' % (OUT, name)) or os.path.exists('%s/%s.webp' % (SITE, name))
g = json.load(open(HERE + '/geom.json')); p = OUT + '/manifest.json'
site = json.load(open(SITE + '/manifest.json')) if os.path.exists(SITE + '/manifest.json') else {}
old = json.load(open(p)) if os.path.exists(p) else site
sp = {}
for k, vs in g['variants'].items():
    if ONLY and k not in ONLY: continue
    if VARS: vs = [v for v in vs if v in VARS]
    have = [v for v in vs if has('%s-%s' % (k, v))]
    if 'plain' in have:
        sp[k] = {'anchor': g['anchor'], 'variants': have}
m = {'v': 2, 'cell': [384, 448], 'cols': [-34, -17, 0, 17, 34], 'elev': g['elev'], 'unitsPerPx': round(g['unitsPerPx'], 6), 'species': sp}
cp = W + '/card.json'
c = json.load(open(cp)) if os.path.exists(cp) else site.get('card')
if c:  # profile-card sheets (bake_card.py): only the species whose sheet exists
    cs = {k: v for k, v in c['species'].items() if (not ONLY or k in ONLY) and has('%s-card' % k)}
    m['card'] = {'cell': c['cell'], 'yaws': c['yaws'], 'fov': c['fov'], 'species': cs}
if 'tree' in old: m['tree'] = old['tree']
json.dump(m, open(p + '.tmp', 'w'), indent=1); os.replace(p + '.tmp', p)
print(len(sp), 'species', sum(len(v['variants']) for v in sp.values()), 'sheets')
