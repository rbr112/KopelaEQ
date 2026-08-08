from pathlib import Path
from playwright.sync_api import sync_playwright

BASE=Path(__file__).resolve().parents[1]
ROOT=BASE/'extension'
VERSION=__import__('json').loads((ROOT/'manifest.json').read_text())['version']
html=ROOT.joinpath('popup.html').read_text()
css=ROOT.joinpath('popup.css').read_text()
import re
JS=ROOT/'js'
def classic(text):
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    return re.sub(r'\bexport\s+(?=(?:const|let|var|class|function)\b)', '', text)
shared_files=[JS/'shared/constants.js',JS/'shared/state.js',JS/'shared/presets.js',JS/'shared/messages.js']
shared_parts=[]; export_names=[]
for path in shared_files:
    raw=path.read_text()
    export_names += re.findall(r'\bexport\s+(?:const|let|var|class|function)\s+(\w+)', raw)
    shared_parts.append(classic(raw))
shared='\n'.join(shared_parts)+f"\nconst S=Object.freeze({{{','.join(dict.fromkeys(export_names))}}});\n"
defaults=classic((JS/'shared/default-presets.js').read_text())
eq_response=classic((JS/'audio/eq-response.js').read_text())
popup=classic((JS/'popup/index.js').read_text())
popup_helpers=classic((JS/'popup/eq-geometry.js').read_text())+'\nconst MIN_FREQ=GRAPH_MIN_FREQ,MAX_FREQ=GRAPH_MAX_FREQ,MIN_GAIN=GRAPH_MIN_GAIN,MAX_GAIN=GRAPH_MAX_GAIN;\n'+classic((JS/'popup/panel-manager.js').read_text())+'\n'+classic((JS/'popup/eq-band-editor.js').read_text())
prelude=shared+'\n'+defaults+'\n'+eq_response+'\n'+popup_helpers+'\n'
mock=r'''
(() => {
  const localStore = {};
  const syncStore = {};
  const messages = [];
  let liveState = null;
  let protection = 'strong';
  let active = false;
  const selectedPresets = {};
  const area = (store) => ({
    async get(keys) { const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{}); const out={}; for(const k of list) if(Object.prototype.hasOwnProperty.call(store,k)) out[k]=structuredClone(store[k]); return out; },
    async set(values) { Object.assign(store, structuredClone(values)); }
  });
  const defaultMeter = {sampleRate:48000,preProtection:{leftPeakDb:1.2,rightPeakDb:-0.4,peakDb:1.2,rmsDb:-5.0},postProtection:{leftPeakDb:-0.2,rightPeakDb:-0.5,peakDb:-0.2,rmsDb:-6.2},peakDb:-0.2,rmsDb:-6.2,gainReductionDb:-2.3,dynamicsReductionDb:-1.0};
  window.__qa = { localStore, syncStore, messages, selectedPresets, meterSnapshot: defaultMeter };
  window.chrome = {
    storage:{local:area(localStore),sync:area(syncStore)},
    tabs:{async query(){return [{id:42,url:'https://www.youtube.com/watch?v=mock'}];}},
    runtime:{async sendMessage(m){
      messages.push(structuredClone(m));
      if(m.type==='STATUS_GET') return {ok:true,active,pending:false,state:liveState,protection,sampleRate:active?44100:null};
      if(m.type==='STATE_SET'){ liveState=structuredClone(m.state); if(Object.prototype.hasOwnProperty.call(m,'presetSelection')){ const k=String(m.tabId||42); if(m.presetSelection) selectedPresets[k]=m.presetSelection; else delete selectedPresets[k]; } return {ok:true,state:liveState,presetSelection:m.presetSelection}; }
      if(m.type==='PROTECTION_SET'){ protection=m.protection; return {ok:true,protection}; }
      if(m.type==='CAPTURE_START'){ active=true; return {ok:true,active:true}; }
      if(m.type==='CAPTURE_STOP'){ active=false; return {ok:true,active:false}; }
      if(m.type==='METER_GET') { const snap=structuredClone(window.__qa.meterSnapshot); if(m.spectrum) snap.spectrum=Array(96).fill(-55); return {ok:true,active,meter:active?snap:null}; }
      if(m.type==='PRESET_SELECTION_GET') return {ok:true,name:selectedPresets[String(m.tabId||42)]||''};
      if(m.type==='PRESET_SELECTION_SET'){ const k=String(m.tabId||42); if(m.name) selectedPresets[k]=m.name; else delete selectedPresets[k]; return {ok:true,name:m.name||''}; }
      return {ok:true};
    }}
  };
  window.confirm=()=>true;
})();
'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":744,"height":580}, device_scale_factor=1)
    page.set_default_timeout(3000)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>')
    content=content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+mock+'</script><script>'+popup+'</script>')
    page.set_content(content, wait_until='load')
    page.wait_for_timeout(180)

    dims=page.evaluate('({sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,bw:document.body.scrollWidth,bh:document.body.scrollHeight})')
    assert dims['sw']<=744 and dims['sh']<=580, dims
    assert page.locator('#stereoButton').count()==0
    assert page.locator('#stereoPanel').count()==0

    g=page.locator('#gainSlider').bounding_box(); assert g and g['height']>180 and g['width']>=30, g
    assert page.locator('#gainReadout').inner_text()=='+0.0 dB'
    assert page.locator('#gainPercentReadout').inner_text()=='100%'
    # Spectrum and EQ share the canvas but not the unit scale. The source code
    # must expose the separate right-side dBFS mapping rather than implying
    # that spectrum height is EQ gain or protection attenuation.
    assert '0 dBFS' in popup and 'for (const dbfs of [0, -50, -100])' in popup
    assert '((0 - db) / 100) * plot.height' in popup

    # The visible preset picker is custom: no OS-native white popup.
    assert page.locator('#presetPickerButton').is_visible()
    assert page.locator('#presetPickerButton .preset-chevron').count()==0
    assert page.locator('#presetSelect').is_hidden()
    page.locator('#presetPickerButton').click()
    assert page.locator('#presetMenu').is_visible()
    items=page.locator('#presetMenuList .preset-menu-item').all_text_contents()
    for label in ['Current settings','Vivid (111)','Bass Punch (bass2)','Bass Tight (bass3)','Bass Heavy (bass4)','Bass Air (bass4.2)']:
        assert label in items, (label, items)
    menu_bg=page.locator('#presetMenu').evaluate("e=>getComputedStyle(e).backgroundColor")
    assert menu_bg not in ('rgb(255, 255, 255)','rgba(255, 255, 255, 1)'), menu_bg
    page.screenshot(path=str(BASE/'qa'/f'popup-presets-{VERSION}.png'))
    page.locator('#presetMenuList .preset-menu-item', has_text='Bass Heavy (bass4)').click()
    page.wait_for_timeout(30)
    assert page.locator('#presetPickerText').inner_text()=='Bass Heavy (bass4)'
    assert page.evaluate("window.__qa.selectedPresets['42']")=='Bass Heavy (bass4)'
    atomic=page.evaluate("window.__qa.messages.filter(m=>m.type==='STATE_SET' && m.presetSelection).slice(-1)[0]")
    assert atomic and atomic['presetSelection']=='Bass Heavy (bass4)' and atomic['persist'] is True, atomic
    page.screenshot(path=str(BASE/'qa'/f'popup-live-{VERSION}.png'))
    # Hovering a band exposes why a point's own gain can differ from the solid
    # combined EQ response when neighbouring bands overlap it.
    pos=page.evaluate("""() => {
      const c=document.getElementById('eqCanvas'), r=c.getBoundingClientRect(), p=getPlot(c);
      return {x:r.left+freqToX(state.eq.frequencies[0],p), y:r.top+gainToY(state.eq.gains[0],p)};
    }""")
    page.mouse.move(pos['x'],pos['y']); page.wait_for_timeout(30)
    tip=page.locator('#canvasTooltip').inner_text()
    assert 'Band ' in tip and 'Total ' in tip and 'Low Shelf' in tip, tip
    page.screenshot(path=str(BASE/'qa'/f'popup-band-hover-{VERSION}.png'))

    # Clicking a control point pins a precise band editor. Shelf Q is explicitly
    # disabled because Web Audio lowshelf/highshelf filters do not use Q.
    page.mouse.click(pos['x'], pos['y']); page.wait_for_timeout(30)
    assert page.locator('#bandInspector').is_visible()
    assert page.locator('#bandTypeLabel').inner_text()=='Low Shelf'
    assert page.locator('#bandQ').is_disabled()
    assert 'Total ' in page.locator('#bandTotalReadout').inner_text()
    page.screenshot(path=str(BASE/'qa'/f'popup-band-editor-shelf-{VERSION}.png'))

    # Peak bands expose Q, and the mouse wheel over the point edits it.
    peak_pos=page.evaluate("""() => {
      const i=2,c=document.getElementById('eqCanvas'),r=c.getBoundingClientRect(),p=getPlot(c);
      return {x:r.left+freqToX(state.eq.frequencies[i],p), y:r.top+gainToY(state.eq.gains[i],p), q:state.eq.qs[i]};
    }""")
    page.mouse.click(peak_pos['x'],peak_pos['y']); page.wait_for_timeout(20)
    assert page.locator('#bandTypeLabel').inner_text()=='Peak'
    assert not page.locator('#bandQ').is_disabled()
    q_before=float(page.locator('#bandQ').input_value())
    page.mouse.move(peak_pos['x'],peak_pos['y']); page.mouse.wheel(0,-120); page.wait_for_timeout(35)
    q_after=float(page.locator('#bandQ').input_value())
    assert q_after > q_before, (q_before,q_after)
    assert page.locator('#presetPickerText').inner_text()=='Current settings'

    # Preset actions are explicit rather than a single ambiguous Save button.
    page.locator('#presetPickerButton').click(); page.locator('#presetMenuList .preset-menu-item', has_text='Bass Heavy (bass4)').click(); page.wait_for_timeout(25)
    page.locator('#moreButton').click(); page.wait_for_timeout(25)
    assert page.locator('#presetPanel').is_visible()
    assert not page.locator('#updatePresetButton').is_disabled()
    page.screenshot(path=str(BASE/'qa'/f'popup-preset-actions-{VERSION}.png'))
    page.locator('#presetName').fill('QA Preset')
    page.locator('#saveAsPresetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text()=='QA Preset'
    # Precise numeric edit makes the curve Current settings but remembers its base
    # so Update selected can intentionally overwrite it.
    page.locator('#presetPanel [data-close]').click(); page.mouse.click(peak_pos['x'],peak_pos['y']); page.wait_for_timeout(15)
    gain_before=float(page.locator('#bandGain').input_value())
    page.locator('#bandGain').fill(str(gain_before+0.5)); page.locator('#bandGain').press('Enter'); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text()=='Current settings'
    page.locator('#moreButton').click(); page.wait_for_timeout(20)
    assert not page.locator('#updatePresetButton').is_disabled()
    assert 'based on QA Preset' in page.locator('#presetActionHint').inner_text()
    page.locator('#updatePresetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text()=='QA Preset'
    page.locator('#duplicatePresetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text().startswith('QA Preset copy')
    page.locator('#presetName').fill('QA Renamed')
    page.locator('#renamePresetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text()=='QA Renamed'
    page.locator('#deletePresetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#presetPickerText').inner_text()=='Current settings'
    page.locator('#presetPanel [data-close]').click()
    # Restore the golden bundled preset for DSP compatibility assertions below.
    page.locator('#presetPickerButton').click(); page.locator('#presetMenuList .preset-menu-item', has_text='Bass Heavy (bass4)').click(); page.wait_for_timeout(25)

    page.mouse.move(730,570); page.wait_for_timeout(10)
    # Legacy/bundled presets must not secretly enable experimental processing.
    latest=page.evaluate("window.__qa.messages.filter(m=>m.type==='STATE_SET').slice(-1)[0]")
    assert latest['state']['dynamics']['enabled'] is False
    assert latest['state']['stereo']['enabled'] is False

    # Legacy Ears frequency response: the first and last bands are shelves. Verify
    # the real Web Audio Biquad response and our drawn response agree on bass4.
    compat=page.evaluate("""() => {
      const testFreqs=[20,30,40,60,80,95,120,160,250,500,1000,5000,10000,20000];
      setEngineSampleRate(44100);
      const ctx=new OfflineAudioContext(2,128,44100);
      const actual=testFreqs.map(()=>0);
      for(let i=0;i<S.EQ_BANDS;i++){
        const f=ctx.createBiquadFilter();
        f.type=S.EQ_TYPES[i];
        f.frequency.value=state.eq.frequencies[i];
        f.gain.value=state.eq.gains[i];
        f.Q.value=state.eq.qs[i];
        const fa=new Float32Array(testFreqs), mag=new Float32Array(testFreqs.length), ph=new Float32Array(testFreqs.length);
        f.getFrequencyResponse(fa,mag,ph);
        for(let j=0;j<testFreqs.length;j++) actual[j]+=20*Math.log10(mag[j]);
      }
      const drawn=testFreqs.map((f)=>responseDbAtFrequency(f));
      return {types:S.EQ_TYPES.slice(), testFreqs, actual, drawn};
    }""")
    assert compat['types'][0]=='lowshelf' and compat['types'][-1]=='highshelf' and set(compat['types'][1:-1])=={'peaking'}, compat['types']
    # bass4 must retain the historical deep-low shelf: around +24 dB at 20 Hz.
    assert compat['actual'][0] > 20, compat
    for a,d in zip(compat['actual'],compat['drawn']):
        # totalResponseDb is visually clamped to ±30 dB, so compare within that range.
        expected=max(-30,min(30,a))
        assert abs(expected-d) < 0.08, (a,d,compat)

    # Native preview must use the real engine sample rate and respect Nyquist.
    native_meta=page.evaluate("""() => {
      const invalid=eqResponse.combinedDb(new Float32Array([23000]),state.eq)[0];
      const freqs=new Float32Array(640);
      for(let i=0;i<freqs.length;i++) freqs[i]=20*Math.pow(1000,i/(freqs.length-1));
      const timings=[];
      for(let n=0;n<40;n++){
        const t0=performance.now();
        eqResponse.combinedDb(freqs,state.eq);
        timings.push(performance.now()-t0);
      }
      timings.sort((a,b)=>a-b);
      return {sampleRate:engineSampleRate, invalid:Number.isNaN(invalid), avg:timings.reduce((a,b)=>a+b,0)/timings.length, p95:timings[Math.floor(timings.length*.95)]};
    }""")
    assert native_meta['sampleRate']==44100, native_meta
    assert native_meta['invalid'] is True, native_meta
    assert native_meta['p95'] < 12.0, native_meta

    # Preset identity describes the EQ curve. Gain/Dynamics/Protection are
    # independent, matching the original Ears preset behavior. Only an EQ edit
    # changes the picker to Current settings.
    page.locator('#protectionButton').click(); page.wait_for_timeout(10)
    page.locator('#protectionPanel [data-protection="medium"]').click(); page.wait_for_timeout(20)
    assert page.locator('#presetPickerText').inner_text()=='Bass Heavy (bass4)'
    page.locator('#protectionPanel [data-close]').click()
    page.locator('#gainSlider').evaluate("e=>{e.value='3';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.wait_for_timeout(30)
    assert page.locator('#presetPickerText').inner_text()=='Bass Heavy (bass4)'
    page.mouse.dblclick(pos['x'],pos['y']); page.wait_for_timeout(40)
    assert page.locator('#presetPickerText').inner_text()=='Current settings'
    assert page.evaluate("window.__qa.selectedPresets['42'] || ''")==''

    # Dynamics remains optional and starts off for a preset/baseline.
    page.locator('#dynamicsButton').click()
    assert not page.locator('#dynamicsEnabled').is_checked()
    assert page.locator('#dynamicsAdvancedBody').is_hidden()
    page.locator('#dynamicsAdvancedToggle').click(); page.wait_for_timeout(10)
    assert page.locator('#dynamicsAdvancedBody').is_visible()
    page.locator('#multibandModeButton').click(); page.wait_for_timeout(35)
    assert page.locator('#crossoverFields').is_visible()
    dyn_box=page.locator('#dynamicsPanel').bounding_box(); assert dyn_box and dyn_box['x']>=3 and dyn_box['y']>=3 and dyn_box['x']+dyn_box['width']<=741 and dyn_box['y']+dyn_box['height']<=577, dyn_box
    page.screenshot(path=str(BASE/'qa'/f'popup-dynamics-advanced-{VERSION}.png'))
    page.locator('#dynamicsPanel [data-close]').click()

    # 1.21 meter: show pre/post Protection levels, peak hold and actual limiter activity.
    page.locator('#powerToggle').click(); page.wait_for_timeout(130)
    assert page.locator('#powerText').inner_text()=='On'
    page.locator('#meterButton').click(); page.wait_for_timeout(140)
    assert page.locator('#meterPanel').is_visible()
    assert page.locator('#preLeftValue').inner_text()=='+1.2 dB' or page.locator('#preLeftValue').inner_text()=='1.2 dB'
    assert page.locator('#postLeftValue').inner_text()=='-0.2 dB' or page.locator('#postLeftValue').inner_text()=='−0.2 dB'
    assert 'OVER' in page.locator('#preClipState').inner_text()
    assert page.locator('#postClipState').inner_text() in ('NEAR','SAFE')
    assert page.locator('#protectionActivity').get_attribute('data-state')=='active'
    assert 'Protection working' in page.locator('#protectionActivity').inner_text()
    assert '1.2' in page.locator('#preHoldValue').inner_text()
    # Clip indication is a fixed-width, latched badge: a transient >0 dB sample
    # must not flicker SAFE/OVER at the 10 Hz meter polling rate or shift layout.
    status_width=page.locator('#preClipState').bounding_box()['width']
    assert 40 <= status_width <= 44, status_width
    page.evaluate("window.__qa.meterSnapshot.preProtection={leftPeakDb:-3,rightPeakDb:-4,peakDb:-3,rmsDb:-8}; window.__qa.meterSnapshot.postProtection={leftPeakDb:-4,rightPeakDb:-4.5,peakDb:-4,rmsDb:-9};")
    page.wait_for_timeout(350)
    assert page.locator('#preClipState').inner_text()=='OVER'
    assert abs(page.locator('#preClipState').bounding_box()['width']-status_width) < 0.1
    page.wait_for_timeout(1350)
    assert page.locator('#preClipState').inner_text()=='SAFE'
    assert abs(page.locator('#preClipState').bounding_box()['width']-status_width) < 0.1
    # Restore the regular meter snapshot for the remaining controls.
    page.evaluate("window.__qa.meterSnapshot={sampleRate:48000,preProtection:{leftPeakDb:1.2,rightPeakDb:-0.4,peakDb:1.2,rmsDb:-5.0},postProtection:{leftPeakDb:-0.2,rightPeakDb:-0.5,peakDb:-0.2,rmsDb:-6.2},peakDb:-0.2,rmsDb:-6.2,gainReductionDb:-2.3,dynamicsReductionDb:-1.0};")
    page.wait_for_timeout(120)
    page.locator('#meterHoldReset').click(); page.wait_for_timeout(15)
    # The next 100 ms meter sample may repopulate hold; reset itself must be safe.
    page.locator('#spectrumModeOptions [data-spectrum-mode="smooth"]').click(); page.wait_for_timeout(20)
    assert page.locator('#spectrumModeOptions [data-spectrum-mode="smooth"]').evaluate("e=>e.classList.contains('active')")
    assert page.evaluate("window.__qa.localStore['kopelaeq.spectrumMode']")=='smooth'
    page.locator('#spectrumFreezeButton').click(); page.wait_for_timeout(130)
    assert page.locator('#spectrumFreezeButton').get_attribute('aria-pressed')=='true'
    latest_meter=page.evaluate("window.__qa.messages.filter(m=>m.type==='METER_GET').slice(-1)[0]")
    assert latest_meter['spectrum'] is False and latest_meter['levels'] is True, latest_meter
    page.screenshot(path=str(BASE/'qa'/f'popup-meter-{VERSION}.png'))
    meter_box=page.locator('#meterPanel').bounding_box(); assert meter_box and meter_box['height'] < 500, meter_box
    # The compact two-column meter must remain meaningfully draggable vertically.
    head=page.locator('#meterPanel .floating-head').bounding_box(); assert head
    page.mouse.move(head['x']+90,head['y']+15); page.mouse.down(); page.mouse.move(head['x']+45,head['y']+55,steps=5); page.mouse.up(); page.wait_for_timeout(30)
    moved_meter=page.locator('#meterPanel').bounding_box(); assert moved_meter and moved_meter['y'] > meter_box['y']+15, (meter_box,moved_meter)
    assert page.evaluate("window.__qa.localStore['kopelaeq.workspace'].meterPanel.top") >= round(moved_meter['y'])-1
    page.locator('#spectrumFreezeButton').click(); page.wait_for_timeout(20)
    page.locator('#meterPanel [data-close]').click(); page.wait_for_timeout(130)
    spectrum_only=page.evaluate("window.__qa.messages.filter(m=>m.type==='METER_GET').slice(-1)[0]")
    assert spectrum_only['spectrum'] is True and spectrum_only['levels'] is False, spectrum_only

    # Panels remain reachable.
    for button,panel in [('#helpButton','#helpPanel'),('#dynamicsButton','#dynamicsPanel'),('#meterButton','#meterPanel'),('#protectionButton','#protectionPanel'),('#moreButton','#presetPanel')]:
      page.locator(button).click(); page.wait_for_timeout(10)
      box=page.locator(panel).bounding_box(); assert box, panel
      assert box['x']>=3 and box['y']>=3 and box['x']+box['width']<=741 and box['y']+box['height']<=577, (panel,box)
      page.locator(panel+' [data-close]').click()

    # High-frequency Gain input is frame-coalesced.
    before=len(page.evaluate('window.__qa.messages'))
    page.locator('#gainSlider').evaluate("e=>{for(let i=0;i<200;i++){e.value=String(-10+(i%20));e.dispatchEvent(new Event('input',{bubbles:true}));}}")
    page.wait_for_timeout(40)
    after_messages=page.evaluate('window.__qa.messages')[before:]
    realtime=[m for m in after_messages if m.get('type')=='STATE_SET' and m.get('persist') is False]
    assert len(realtime)<=2, len(realtime)

    # No page injection control remains; floating modules stay inside the popup.
    assert page.locator('#workspaceButton').count()==0

    assert not errors, errors

    # Simulate a brand-new popup document while the tab's selected preset already
    # exists in durable background storage: the label must restore immediately.
    reopen=browser.new_page(viewport={"width":744,"height":580}, device_scale_factor=1)
    seeded_mock=mock.replace('const selectedPresets = {};', "const selectedPresets = {'42':'Bass Heavy (bass4)'};").replace('let liveState = null;', "let liveState = S.presetToAudioState(DEFAULT_PRESETS['Bass Heavy (bass4)']); liveState.gainDb = 3;")
    reopened_content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>')
    reopened_content=reopened_content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+seeded_mock+'</script><script>'+popup+'</script>')
    reopen.set_content(reopened_content, wait_until='load'); reopen.wait_for_timeout(160)
    assert reopen.locator('#presetPickerText').inner_text()=='Bass Heavy (bass4)'
    reopen.close()

    # Recovery for the historical race: matching DSP state with a missing stored
    # preset identity is inferred once and healed back into per-tab storage.
    recover=browser.new_page(viewport={"width":744,"height":580}, device_scale_factor=1)
    recover_mock=mock.replace('let liveState = null;', "let liveState = S.presetToAudioState(DEFAULT_PRESETS['Vivid (111)']); liveState.gainDb = 2;")
    recover_content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>')
    recover_content=recover_content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+recover_mock+'</script><script>'+popup+'</script>')
    recover.set_content(recover_content, wait_until='load'); recover.wait_for_timeout(160)
    assert recover.locator('#presetPickerText').inner_text()=='Vivid (111)'
    assert recover.evaluate("window.__qa.selectedPresets['42']")=='Vivid (111)'
    recover.close()

    print('ui_qa: PASS',dims,'gainBox',g,'presetMenuBg',menu_bg,'nativeResponse',native_meta,'messages',len(page.evaluate('window.__qa.messages')))
    browser.close()
