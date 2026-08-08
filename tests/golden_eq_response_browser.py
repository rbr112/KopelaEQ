from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'extension/js'
fixture=json.loads((ROOT/'tests/fixtures/golden-eq-response-1.17.json').read_text())
freqs=fixture['frequencies_hz']
constants=(EXT/'shared/constants.js').read_text()
defaults=(EXT/'shared/default-presets.js').read_text()
response=(EXT/'audio/eq-response.js').read_text()
# QA-only classic-script composition. Production remains ESM; this simply lets
# Chromium execute the emitted implementation without requiring an extension loader.
def classic(text):
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    return re.sub(r'\bexport\s+(?=(?:const|let|var|class|function)\b)', '', text)
script=classic(constants)+'\n'+classic(defaults)+'\n'+classic(response)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page=browser.new_page()
    page.set_content(f'<script>{script}</script>')
    result=page.evaluate('''({freqs}) => {
      const out={};
      for(const sr of [44100,48000]){
        const engine=new NativeEqResponse(sr);
        out[sr]={};
        for(const [name,preset] of Object.entries(DEFAULT_PRESETS)){
          const eq={enabled:true,frequencies:preset.frequencies,gains:preset.gains,qs:preset.qs};
          out[sr][name]=Array.from(engine.combinedDb(new Float32Array(freqs),eq));
        }
        engine.dispose();
      }
      return out;
    }''', {'freqs':freqs})
    # Native response must mark above-Nyquist preview as NaN; JSON serialization turns NaN to null.
    nyquist=page.evaluate('''() => { const e=new NativeEqResponse(44100); const x=e.combinedDb(new Float32Array([23000]),{enabled:true,frequencies:DEFAULT_PRESETS['Vivid (111)'].frequencies,gains:DEFAULT_PRESETS['Vivid (111)'].gains,qs:DEFAULT_PRESETS['Vivid (111)'].qs})[0]; e.dispose(); return Number.isNaN(x); }''')
    assert nyquist is True
    browser.close()
max_error=0.0
for sr,presets in fixture['responses_db'].items():
    for name,expected in presets.items():
        actual=result[sr][name]
        assert len(actual)==len(expected)
        for f,e,a in zip(freqs,expected,actual):
            err=abs(float(e)-float(a)); max_error=max(max_error,err)
            assert err < 1e-6,(sr,name,f,e,a,err)
print(f'golden_eq_response_browser.py: PASS (max error {max_error:.3g} dB, 44.1/48 kHz)')
