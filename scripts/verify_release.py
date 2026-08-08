from pathlib import Path
import hashlib, json, re, zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
manifest = json.loads((ROOT / 'extension' / 'manifest.json').read_text())
version = manifest['version']
release = DIST / f'kopelaeq-{version}.zip'
source = DIST / f'kopelaeq-{version}-source.zip'
assert release.exists() and source.exists()

with zipfile.ZipFile(release) as z:
    names = z.namelist()
    assert names == sorted(names), 'release archive order is not deterministic'
    assert len(names) == len(set(names)), 'duplicate release entries'
    assert all(info.date_time == (2020,1,1,0,0,0) for info in z.infolist()), 'non-deterministic timestamps'
    assert 'manifest.json' in names and 'popup.html' in names and 'offscreen.html' in names
    assert not any(name.startswith(('src/','tests/','scripts/')) for name in names)
    packed_manifest = json.loads(z.read('manifest.json'))
    assert packed_manifest['version'] == version
    assert set(packed_manifest['permissions']) == {'activeTab','tabCapture','offscreen','storage'}
    assert 'host_permissions' not in packed_manifest
    js = '\n'.join(z.read(name).decode('utf-8') for name in names if name.endswith('.js'))
    assert not re.search(r'\beval\s*\(|new\s+Function\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket\s*\(', js)
    assert 'http://' not in js and 'https://' not in js

with zipfile.ZipFile(source) as z:
    names = z.namelist()
    assert names == sorted(names), 'source archive order is not deterministic'
    assert all(info.date_time == (2020,1,1,0,0,0) for info in z.infolist()), 'non-deterministic source timestamps'
    assert 'src/audio/audio-session.ts' in names and 'tests/golden_eq_response_browser.py' in names
    assert not any('node_modules/' in name for name in names)

expected = {}
for line in (DIST/'SHA256SUMS.txt').read_text().splitlines():
    sha, name = line.split('  ',1)
    expected[name]=sha
for path in (release, source):
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected[path.name]
print('verify_release.py: PASS')
