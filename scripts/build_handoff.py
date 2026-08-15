from pathlib import Path
import json, zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
version = json.loads((ROOT/'static/manifest.json').read_text())['version']
out = DIST / f'kopelaeq-next-chat-full-{version}.zip'
FIXED_TIME = (2020,1,1,0,0,0)

if out.exists(): out.unlink()

def add_file(z, path, arc):
    info=zipfile.ZipInfo(arc, FIXED_TIME)
    info.compress_type=zipfile.ZIP_DEFLATED
    info.external_attr=0o100644 << 16
    info.create_system=3
    z.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

entries={}
# Source/compiled project, but never historical QA screenshots or stale release zips.
for path in ROOT.rglob('*'):
    if not path.is_file(): continue
    rel=path.relative_to(ROOT)
    if any(part in {'.git','node_modules','__pycache__'} for part in rel.parts): continue
    if rel.parts and rel.parts[0]=='dist': continue
    if rel.parts and rel.parts[0]=='qa' and path.suffix.lower()=='.png' and f'-{version}.png' not in path.name: continue
    entries[rel.as_posix()]=path

for name in [f'kopelaeq-{version}.zip', f'kopelaeq-{version}-source.zip', 'SHA256SUMS.txt']:
    path=DIST/name
    if not path.exists(): raise SystemExit(f'missing current release artifact: {name}')
    entries[f'dist/{name}']=path

with zipfile.ZipFile(out,'w') as z:
    for arc in sorted(entries): add_file(z,entries[arc],arc)
print(out)
