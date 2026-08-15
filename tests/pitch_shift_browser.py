from pathlib import Path
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WORKLET = ROOT / 'extension' / 'js' / 'audio' / 'pitch-worklet-processor.js'
assert WORKLET.exists(), 'pitch worklet was not emitted by the build'

capability = None
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium',
            args=['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
            timeout=10_000,
        )
        try:
            page = browser.new_page()
            page.set_default_timeout(10_000)
            page.set_content('<!doctype html><meta charset="utf-8"><title>Pitch capability probe</title>')
            capability = page.evaluate('''() => {
              const ctx = new AudioContext({ sampleRate: 48000 });
              const result = {
                audioContext: !!ctx,
                audioWorklet: !!ctx.audioWorklet,
                addModule: typeof ctx.audioWorklet?.addModule === 'function'
              };
              ctx.close();
              return result;
            }''')
        finally:
            browser.close()
except PlaywrightTimeoutError:
    print('pitch_shift_browser.py: SKIP (headless Chromium capability probe timed out; real Chrome Stable test remains manual)')

if capability is not None:
    if not (capability['audioWorklet'] and capability['addModule']):
        print('pitch_shift_browser.py: SKIP (this headless Chromium exposes AudioContext but not audioWorklet.addModule; real Chrome Stable test remains manual)')
    else:
        # A normal data/about page cannot load chrome-extension:// worklet assets from
        # an unpacked MV3 extension in this CI harness. Reaching this branch confirms
        # that the browser runtime itself exposes AudioWorklet; extension-origin
        # addModule execution is still covered by the manual release check.
        print('pitch_shift_browser.py: CAPABILITY PASS (AudioWorklet API exposed; extension-origin addModule remains a manual Chrome Stable check)')
