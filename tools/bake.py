#!/usr/bin/env python3
"""Bake Fast Pitch art-board edits into the app.

usage: bake.py <repo_dir> <docs_dir> <artifact_out_html>
  docs_dir: JSON files of the artifact's `layout` collection (one per document,
            as saved by ArtifactData list with out_dir). Each is either the
            document body or {"id":..,"data":{..},"version":..}.
Merges every edit into the <script id="lyBakedData"> block of index.html
(the page applies that block on every load, GitHub and claude.ai alike),
bumps offline.json so installed iPads re-download, and writes the artifact
copy of the page (index.html without the GitHub-only document skeleton).
Prints the ids it baked, one per line, prefixed with "BAKED ".
"""
import json, os, re, sys, glob, time

repo, docs_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
idx = os.path.join(repo, 'index.html')
html = open(idx, encoding='utf-8').read()
m = re.search(r'(<script id="lyBakedData" type="application/json">)(.*?)(</script>)', html, re.S)
if not m: sys.exit('lyBakedData block not found in index.html')
baked = json.loads(m.group(2).replace('<\\/', '</') or '{}')

def effective(d):
    return any([(d.get('dx') or 0) != 0, (d.get('dy') or 0) != 0, (d.get('s') or 1) != 1, (d.get('r') or 0) != 0,
                isinstance(d.get('txt'), str), isinstance(d.get('html'), str),
                *[d.get(k) not in (None, '') for k in ('bg', 'fg', 'rad', 'w', 'h')]])

n = 0
for f in sorted(glob.glob(os.path.join(docs_dir, '**', '*.json'), recursive=True)):
    o = json.load(open(f, encoding='utf-8'))
    d = o.get('data') if isinstance(o.get('data'), dict) else o
    i = o.get('id') if isinstance(o.get('data'), dict) else None
    i = i or os.path.splitext(os.path.basename(f))[0]
    if not isinstance(d, dict) or not d.get('sel'): continue
    d = {k: v for k, v in d.items() if k not in ('at',)}
    if effective(d): baked[i] = d
    else: baked.pop(i, None)
    print('BAKED', i); n += 1

blob = json.dumps(baked, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
html = html[:m.start(2)] + blob + html[m.end(2):]
open(idx, 'w', encoding='utf-8').write(html)

# artifact copy: drop the 5-line GitHub document skeleton that push-fp.sh prepends
lines = html.split('\n')
if lines[0].lower().startswith('<!doctype'):
    k = next(j for j, l in enumerate(lines[:8]) if l.startswith('<meta name="viewport"'))
    lines = lines[k + 1:]
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
open(out, 'w', encoding='utf-8').write('\n'.join(lines))

off = os.path.join(repo, 'offline.json')
if os.path.exists(off):
    j = json.load(open(off)); j['v'] = int(time.time()); json.dump(j, open(off, 'w'))
print('total baked', n, 'entries now', len(baked))
