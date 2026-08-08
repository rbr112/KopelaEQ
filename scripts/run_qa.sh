#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm run build
for f in $(find extension/js -type f -name '*.js' | sort); do node --check "$f"; done
node tests/shared.test.mjs
node tests/bundled_presets.test.mjs
node tests/messages.test.mjs
node tests/bypass_gate.test.mjs
node tests/audio_session.test.mjs
node tests/offscreen_runtime.test.mjs
node tests/capture_manager.test.mjs
node tests/background_runtime.test.mjs
python3 tests/static_check.py
python3 tests/dsp_math_check.py
python3 tests/golden_eq_response_browser.py
python3 tests/meter_sidechain_browser.py
python3 qa/run_ui_qa.py
