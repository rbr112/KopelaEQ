#!/usr/bin/env python3
from __future__ import annotations
import os
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CMD = [sys.executable, '-u', str(ROOT / 'qa' / 'run_ui_qa.py')]
TIMEOUT_SECONDS = 60

proc = subprocess.Popen(
    CMD,
    cwd=ROOT,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    start_new_session=True,
)
output = ''
timed_out = False
try:
    output, _ = proc.communicate(timeout=TIMEOUT_SECONDS)
except subprocess.TimeoutExpired as exc:
    timed_out = True
    output = (exc.output or '') if isinstance(exc.output, str) else (exc.output or b'').decode(errors='replace')
finally:
    # Playwright/Chromium descendants share the dedicated process group. Kill
    # the whole group after the QA runner exits or times out so no orphan can
    # poison the browser tests that follow in the release pipeline.
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=2)

sys.stdout.write(output)
if output and not output.endswith('\n'):
    sys.stdout.write('\n')

if timed_out:
    if 'ui_qa: PASS' in output:
        print('ui_qa.py: PASS (assertions completed; isolated Chromium cleanup timed out)')
        raise SystemExit(0)
    print(f'ui_qa.py: FAIL (timed out after {TIMEOUT_SECONDS}s before PASS)', file=sys.stderr)
    raise SystemExit(124)

if proc.returncode != 0:
    raise SystemExit(proc.returncode)
if 'ui_qa: PASS' not in output:
    print('ui_qa.py: FAIL (runner exited without PASS marker)', file=sys.stderr)
    raise SystemExit(1)
print('ui_qa.py: PASS (isolated process group cleaned)')
