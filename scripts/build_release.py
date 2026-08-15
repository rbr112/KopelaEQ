from pathlib import Path
import hashlib, json, zipfile

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
manifest = json.loads((EXT / 'manifest.json').read_text())
version = manifest['version']
release_out = DIST / f'kopelaeq-{version}.zip'
source_out = DIST / f'kopelaeq-{version}-source.zip'
FIXED_TIME = (2020, 1, 1, 0, 0, 0)

for out in (release_out, source_out):
    if out.exists():
        out.unlink()

def add_bytes(z: zipfile.ZipFile, arc: str, data: bytes) -> None:
    info = zipfile.ZipInfo(arc, FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

def add_file(z: zipfile.ZipFile, path: Path, arc: str) -> None:
    add_bytes(z, arc, path.read_bytes())

release_entries = {path.relative_to(EXT).as_posix(): path for path in EXT.rglob('*') if path.is_file()}
if (ROOT / 'LICENSE').exists():
    release_entries['LICENSE'] = ROOT / 'LICENSE'
with zipfile.ZipFile(release_out, 'w') as z:
    for arc in sorted(release_entries):
        add_file(z, release_entries[arc], arc)

source_roots = [ROOT / 'src', ROOT / 'static', ROOT / 'tests', ROOT / 'scripts']
source_files = [
    ROOT / 'package.json', ROOT / 'tsconfig.json', ROOT / 'README.md', ROOT / 'ARCHITECTURE.md', ROOT / 'PRIVACY.md',
    ROOT / f'RELEASE_NOTES_{version}.md', ROOT / 'RELEASE_CHECKLIST.md', ROOT / 'QA_REPORT.md', ROOT / 'STORE_LISTING.md',
    ROOT / 'qa' / 'run_ui_qa.py', ROOT / 'baseline' / 'README.md', ROOT / 'SECURITY.md', ROOT / 'CONTRIBUTING.md', ROOT / 'CHANGELOG.md', ROOT / 'GITHUB_RELEASE.md', ROOT / 'LICENSE', ROOT / '.gitignore'
]
source_entries: dict[str, Path] = {}
for base in source_roots:
    if not base.exists():
        continue
    for path in base.rglob('*'):
        if not path.is_file() or '__pycache__' in path.parts or 'node_modules' in path.parts:
            continue
        source_entries[path.relative_to(ROOT).as_posix()] = path
for path in source_files:
    if path.exists():
        source_entries[path.relative_to(ROOT).as_posix()] = path

with zipfile.ZipFile(source_out, 'w') as z:
    for arc in sorted(source_entries):
        add_file(z, source_entries[arc], arc)

lines = []
for out in (release_out, source_out):
    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    lines.append(f'{sha}  {out.name}')
    print(out)
    print(sha)
(DIST / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n')
