#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run qa
python3 scripts/build_release.py
python3 scripts/verify_release.py
