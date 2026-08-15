from pathlib import Path
import os
import subprocess
from playwright.sync_api import sync_playwright

BASE=Path(__file__).resolve().parents[1]
ROOT=BASE/'extension'
VERSION=__import__('json').loads((ROOT/'manifest.json').read_text())['version']
html=ROOT.joinpath('popup.html').read_text()
css=ROOT.joinpath('popup.css').read_text()
appearance_css=ROOT.joinpath('appearance-layouts.css').read_text()
import re
JS=ROOT/'js'
def classic(text):
    text=re.sub(r'^import .*?;\s*$', '', text, flags=re.M)
    text=text.replace('export async function ', 'async function ')
    return re.sub(r'\bexport\s+(?=(?:const|let|var|class|function)\b)', '', text)
shared_files=[JS/'shared/constants.js',JS/'shared/state.js',JS/'shared/presets.js',JS/'shared/messages.js',JS/'shared/bounded.js',JS/'shared/latest-wins.js']
shared_parts=[]; export_names=[]
for path in shared_files:
    raw=path.read_text()
    export_names += re.findall(r'\bexport\s+(?:const|let|var|class|function)\s+(\w+)', raw)
    shared_parts.append(classic(raw))
shared='\n'.join(shared_parts)+f"\nconst S=Object.freeze({{{','.join(dict.fromkeys(export_names))}}});\n"
defaults=classic((JS/'shared/default-presets.js').read_text())
eq_response=classic((JS/'audio/eq-response.js').read_text())
popup=classic((JS/'popup/index.js').read_text())
popup_elements=classic((JS/'popup/popup-elements.js').read_text())
eq_geometry=classic((JS/'popup/eq-geometry.js').read_text())
panel_manager=classic((JS/'popup/panel-manager.js').read_text())
eq_band_editor=classic((JS/'popup/eq-band-editor.js').read_text())
eq_ui=classic((JS/'popup/eq-ui.js').read_text())
meter_ui=classic((JS/'popup/meter-ui.js').read_text())
preset_ui=classic((JS/'popup/preset-ui.js').read_text())
pitch_latency=classic((JS/'audio/pitch-latency.js').read_text())
appearance_types=classic((JS/'popup/appearance/theme-types.js').read_text())
appearance_surface=classic((JS/'popup/appearance/appearance-surface.js').read_text())
artwork_assets=classic((JS/'popup/appearance/artwork-assets.js').read_text())
appearance_media_db=classic((JS/'shared/appearance-media-db.js').read_text())
artwork_store=classic((JS/'popup/appearance/artwork-store.js').read_text())
# Inline the two built-in artworks so set_content() visual QA can render them.
import base64
for asset_name in ['rice-landscape.svg','nocturne-night.svg']:
    asset=(ROOT/'artwork'/asset_name).read_bytes()
    uri='data:image/svg+xml;base64,'+base64.b64encode(asset).decode('ascii')
    artwork_assets=artwork_assets.replace(f"'artwork/{asset_name}'", repr(uri))
preloaded_rice_uri='data:image/jpeg;base64,'+base64.b64encode((ROOT/'artwork'/'rice-preloaded-user.jpg').read_bytes()).decode('ascii')
appearance_classic=classic((JS/'popup/appearance/builtins/classic.js').read_text())
appearance_rice=classic((JS/'popup/appearance/builtins/rice.js').read_text())
appearance_nocturne=classic((JS/'popup/appearance/builtins/nocturne.js').read_text())
appearance_registry=classic((JS/'popup/appearance/theme-registry.js').read_text())
appearance_validator=classic((JS/'popup/appearance/theme-validator.js').read_text())
appearance_service=classic((JS/'popup/appearance/appearance-service.js').read_text())
appearance_ui=classic((JS/'popup/appearance/appearance-ui.js').read_text())
appearance_parts='\n'.join([appearance_types,appearance_surface,artwork_assets,appearance_media_db,artwork_store,appearance_classic,appearance_rice,appearance_nocturne,appearance_registry,appearance_validator,appearance_service,appearance_ui])
popup_helpers=popup_elements+'\n'+eq_geometry+'\nconst MIN_FREQ=GRAPH_MIN_FREQ,MAX_FREQ=GRAPH_MAX_FREQ,MIN_GAIN=GRAPH_MIN_GAIN,MAX_GAIN=GRAPH_MAX_GAIN;\n'+appearance_parts+'\n'+panel_manager+'\n'+eq_band_editor+'\n'+eq_ui+'\n'+meter_ui+'\n'+preset_ui+'\n'+pitch_latency
popup_source=popup+'\n'+eq_ui+'\n'+meter_ui+'\n'+preset_ui
prelude=shared+'\n'+defaults+'\n'+eq_response+'\n'+popup_helpers+'\n'
mock=r'''
(() => {
  window.__KopelaAppearanceUiCtor = AppearanceUI;
  window.__KopelaMediaStoreCtors = { ArtworkStore, BackgroundStore };
  window.__KopelaThemeValidator = validateThemeDefinition;
  const localStore = {'kopelaeq.appearance': {schemaVersion:1, themeId:'builtin.classic', layoutId:'classic'}, 'kopelaeq.mediaHints': {'builtin.rice':'preloaded-cover'}, 'kopelaeq.preloadedMediaVersion':1};
  const syncStore = {};
  const messages = [];
  const storageStats = {localSets:0,syncSets:0};
  let liveState = null;
  let protection = 'strong';
  let active = false;
  const selectedPresets = {};
  const area = (store, kind) => ({
    async get(keys) { const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{}); const out={}; for(const k of list) if(Object.prototype.hasOwnProperty.call(store,k)) out[k]=structuredClone(store[k]); return out; },
    async set(values) { storageStats[kind+'Sets'] += 1; Object.assign(store, structuredClone(values)); }
  });
  const defaultMeter = {sampleRate:48000,preProtection:{leftPeakDb:1.2,rightPeakDb:-0.4,peakDb:1.2,rmsDb:-5.0},postProtection:{leftPeakDb:-0.2,rightPeakDb:-0.5,peakDb:-0.2,rmsDb:-6.2},peakDb:-0.2,rmsDb:-6.2,gainReductionDb:-2.3,dynamicsReductionDb:-1.0};
  const artworkDb = new Map();
  const backgroundDb = new Map();
  ArtworkStore.prototype.get = async function(themeId){ return artworkDb.get(themeId) || null; };
  ArtworkStore.prototype.put = async function(themeId, blob, filename, fit){
    const mimeType = await detectArtworkMime(blob); if(!mimeType) throw new Error('Unsupported artwork. Use PNG, JPG, WebP or GIF.');
    const rec={themeId,blob:blob.slice(0,blob.size,mimeType),filename,mimeType,size:blob.size,fit:fit==='contain'?'contain':'cover',updatedAt:Date.now()}; artworkDb.set(themeId,rec); return rec;
  };
  ArtworkStore.prototype.setFit = async function(themeId, fit){ const rec=artworkDb.get(themeId); if(!rec) return null; rec.fit=fit==='contain'?'contain':'cover'; rec.updatedAt=Date.now(); return rec; };
  ArtworkStore.prototype.remove = async function(themeId){ artworkDb.delete(themeId); };
  BackgroundStore.prototype.get = async function(themeId){ return backgroundDb.get(themeId) || null; };
  BackgroundStore.prototype.put = async function(themeId, blob, filename, fit){
    const mimeType = await detectArtworkMime(blob); if(!mimeType) throw new Error('Unsupported image. Use PNG, JPG, WebP or GIF.');
    const rec={themeId,blob:blob.slice(0,blob.size,mimeType),filename,mimeType,size:blob.size,fit:fit==='contain'?'contain':'cover',updatedAt:Date.now()}; backgroundDb.set(themeId,rec); return rec;
  };
  BackgroundStore.prototype.setFit = async function(themeId, fit){ const rec=backgroundDb.get(themeId); if(!rec) return null; rec.fit=fit==='contain'?'contain':'cover'; rec.updatedAt=Date.now(); return rec; };
  BackgroundStore.prototype.remove = async function(themeId){ backgroundDb.delete(themeId); };
  window.__qa = { localStore, syncStore, messages, selectedPresets, meterSnapshot: defaultMeter, artworkDb, backgroundDb, storageStats };
  window.chrome = {
    storage:{local:area(localStore,'local'),sync:area(syncStore,'sync')},
    tabs:{async query(){return [{id:42,url:'https://www.youtube.com/watch?v=mock',title:'lofi hip hop radio – beats to relax/study to'}];}},
    runtime:{getURL:(path)=>path==='artwork/rice-preloaded-user.jpg'?'__PRELOADED_RICE_URI__':path,async sendMessage(m){
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
mock=mock.replace('__PRELOADED_RICE_URI__', preloaded_rice_uri)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":800,"height":580}, device_scale_factor=1)
    page.set_default_timeout(3000)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>').replace('<link rel="stylesheet" href="appearance-layouts.css">', '<style>'+appearance_css+'</style>')
    content=content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+mock+'</script><script>'+popup+'</script>')
    page.set_content(content, wait_until='load')
    page.wait_for_timeout(180)

    dims=page.evaluate('({sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,bw:document.body.scrollWidth,bh:document.body.scrollHeight})')
    assert dims['sw']<=800 and dims['sh']<=580, dims
    # Heavy Appearance editor is lazy: ordinary EQ popup startup must not bind it.
    assert page.evaluate('appearanceUi===null')
    assert page.evaluate('window.__qa.storageStats.localSets') <= 1
    assert page.locator('#stereoButton').count()==1
    assert page.locator('#stereoPanel').is_hidden()
    assert page.locator('#effectsButton').count()==1 and page.locator('#effectsPanel').is_hidden()
    assert page.locator('#pitchButton').count()==1 and page.locator('#reverbButton').count()==1
    # The compact toolbar must show full labels rather than the old ellipsized 9-button layout.
    for button in ['#dynamicsButton','#stereoButton','#protectionButton','#meterButton','#effectsButton']:
        assert page.locator(button).evaluate('e=>e.scrollWidth<=e.clientWidth'), button
    # Classic remains a legacy fallback, but it must stay visually usable.
    assert page.locator('#appearanceButton svg').evaluate('e=>e.getBoundingClientRect().width>=12')
    assert page.locator('#moreButton svg').evaluate('e=>e.getBoundingClientRect().width>=12')
    footer_gap=page.evaluate("() => { const a=document.querySelector('#statusText').getBoundingClientRect(), b=document.querySelector('.rice-footer-meta').getBoundingClientRect(); return b.left-a.right; }")
    assert footer_gap >= 6, footer_gap

    g=page.locator('#gainSlider').bounding_box(); assert g and g['height']>180 and g['width']>=30, g
    assert page.locator('#gainReadout').inner_text()=='+0.0 dB'
    assert page.locator('#gainPercentReadout').inner_text()=='100%'
    # Spectrum and EQ share the canvas but not the unit scale. The source code
    # must expose the separate right-side dBFS mapping rather than implying
    # that spectrum height is EQ gain or protection attenuation.
    assert '0 dBFS' in popup_source and 'for (const dbfs of [0, -50, -100])' in popup_source
    assert '((0 - db) / 100) * plot.height' in popup_source

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
    # Bass Tight contains a ~17 Hz point. 1.23.4 expands the visible graph to
    # the full 5 Hz DSP minimum, so the point must have a real in-range position.
    page.locator('#presetPickerButton').click()
    page.locator('#presetMenuList .preset-menu-item', has_text='Bass Tight (bass3)').click(); page.wait_for_timeout(25)
    assert page.evaluate('Math.min(...state.eq.frequencies)') < 20
    page.screenshot(path=str(BASE/'qa'/f'popup-sub20-marker-{VERSION}.png'))
    page.locator('#presetPickerButton').click()
    page.locator('#presetMenuList .preset-menu-item', has_text='Bass Heavy (bass4)').click(); page.wait_for_timeout(25)
    # The plot now covers the full DSP range (5 Hz..20 kHz): 17 Hz must be
    # represented inside it rather than pinned to the left boundary.
    marker_geometry=page.evaluate("""() => {
      const c=document.getElementById('eqCanvas'), p=getPlot(c), radius=6.4;
      return {left:p.left,right:p.right,min:freqToMarkerX(5,p,radius),low:freqToMarkerX(17,p,radius),high:freqToMarkerX(20000,p,radius),radius};
    }""")
    assert abs(marker_geometry['min']-(marker_geometry['left']+marker_geometry['radius'])) < 0.05, marker_geometry
    assert marker_geometry['low'] > marker_geometry['left']+marker_geometry['radius']+10, marker_geometry
    assert marker_geometry['high'] <= marker_geometry['right']-marker_geometry['radius']+0.01, marker_geometry
    # Hovering a band exposes why a point's own gain can differ from the solid
    # combined EQ response when neighbouring bands overlap it.
    pos=page.evaluate("""() => {
      const c=document.getElementById('eqCanvas'), r=c.getBoundingClientRect(), p=getPlot(c);
      return {x:r.left+freqToMarkerX(state.eq.frequencies[0],p), y:r.top+gainToY(state.eq.gains[0],p)};
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
    assert all(page.locator(f'[data-band-step="q"][data-direction="{d}"]').is_disabled() for d in ['-1','1'])
    assert 'Total ' in page.locator('#bandTotalReadout').inner_text()
    page.screenshot(path=str(BASE/'qa'/f'popup-band-editor-shelf-{VERSION}.png'))

    # Peak bands expose Q, and the mouse wheel over the point edits it.
    peak_pos=page.evaluate("""() => {
      const i=2,c=document.getElementById('eqCanvas'),r=c.getBoundingClientRect(),p=getPlot(c);
      return {x:r.left+freqToMarkerX(state.eq.frequencies[i],p), y:r.top+gainToY(state.eq.gains[i],p), q:state.eq.qs[i]};
    }""")
    page.mouse.click(peak_pos['x'],peak_pos['y']); page.wait_for_timeout(20)
    assert page.locator('#bandTypeLabel').inner_text()=='Peak'
    assert not page.locator('#bandQ').is_disabled()
    # 1.23.13: each numeric parameter keeps explicit -/+ controls, while the
    # editor itself is detached below the graph so points remain draggable.
    editor_box=page.locator('#bandInspector').bounding_box(); canvas_box=page.locator('#eqCanvas').bounding_box()
    assert editor_box and canvas_box and editor_box['y'] >= canvas_box['y']+canvas_box['height']-0.5, (editor_box,canvas_box)
    editor_overflow=page.locator('#bandInspector').evaluate("e=>({sw:e.scrollWidth,cw:e.clientWidth,fields:[...e.querySelectorAll('.number-stepper')].map(x=>({sw:x.scrollWidth,cw:x.clientWidth}))})")
    assert editor_overflow['sw']<=editor_overflow['cw']+1 and all(x['sw']<=x['cw']+1 for x in editor_overflow['fields']), editor_overflow
    for field in ['frequency','gain','q']:
      for direction in ['-1','1']:
        step_box=page.locator(f'[data-band-step="{field}"][data-direction="{direction}"]').bounding_box()
        assert step_box and step_box['width']>=29 and step_box['height']>=31, (field,direction,step_box)
    gain_step_before=float(page.locator('#bandGain').input_value())
    page.locator('[data-band-step="gain"][data-direction="1"]').click(); page.wait_for_timeout(20)
    gain_step_after=float(page.locator('#bandGain').input_value())
    assert abs(gain_step_after-gain_step_before-0.5)<0.001, (gain_step_before,gain_step_after)
    page.locator('[data-band-step="gain"][data-direction="-1"]').click(); page.wait_for_timeout(20)
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
    assert 'Based on: QA Preset' in page.locator('#presetActionHint').inner_text()
    assert page.locator('#presetActionTitle').inner_text().lower()=='based on preset'
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
      engineSampleRate=44100; eqUi.setSampleRate(44100);
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
      const drawn=testFreqs.map((f)=>eqUi.responseDbAtFrequency(f));
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
      const invalid=eqUi.eqResponse.combinedDb(new Float32Array([23000]),state.eq)[0];
      const freqs=new Float32Array(640);
      for(let i=0;i<freqs.length;i++) freqs[i]=20*Math.pow(1000,i/(freqs.length-1));
      const timings=[];
      for(let n=0;n<40;n++){
        const t0=performance.now();
        eqUi.eqResponse.combinedDb(freqs,state.eq);
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

    # 1.23 DSP panels: state wiring, mono UX and documented pitch latency.
    page.locator('#stereoButton').click(); page.wait_for_timeout(10)
    assert page.locator('#stereoPanel').is_visible() and not page.locator('#stereoEnabled').is_checked()
    page.locator('#stereoEnabled').evaluate("e=>{e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))}"); page.locator('#stereoWidth').fill('150'); page.locator('#stereoWidth').dispatch_event('change'); page.wait_for_timeout(20)
    assert page.locator('#stereoWidthReadout').inner_text()=='150%'
    page.locator('#stereoMonoButton').click(); page.wait_for_timeout(20); assert page.locator('#stereoWidth').is_disabled(); assert page.locator('#stereoWidthReadout').inner_text()=='Mono'
    page.locator('#stereoPanel [data-close]').click()
    page.locator('#effectsButton').click(); page.wait_for_timeout(10); assert page.locator('#effectsPanel').is_visible()
    effects_box=page.locator('#effectsPanel').bounding_box(); strip_box=page.locator('.control-strip').bounding_box()
    assert effects_box and strip_box and effects_box['y']+effects_box['height'] <= strip_box['y']-6, (effects_box, strip_box)
    page.screenshot(path=str(BASE/'qa'/f'popup-effects-{VERSION}.png'))
    page.locator('#pitchButton').click(); page.wait_for_timeout(10); assert page.locator('#effectsPanel').is_hidden(); assert page.locator('#pitchPanel').is_visible(); assert 'ms' in page.locator('#pitchLatencyReadout').inner_text()
    assert 'tone' in page.locator('#pitchPanel').inner_text().lower() and 'speed' in page.locator('#pitchPanel').inner_text().lower()
    # Effect detail has a one-click route back to the launcher.
    page.locator('#pitchPanel [data-back-effects]').click(); page.wait_for_timeout(10)
    assert page.locator('#pitchPanel').is_hidden() and page.locator('#effectsPanel').is_visible()
    # Effects button toggles the launcher closed; reopening and choosing Pitch is one path, not a panel stack.
    page.locator('#effectsButton').click(); page.wait_for_timeout(10); assert page.locator('#effectsPanel').is_hidden()
    page.locator('#effectsButton').click(); page.locator('#pitchButton').click(); page.wait_for_timeout(10); assert page.locator('#pitchPanel').is_visible()
    page.keyboard.press('Escape'); page.wait_for_timeout(10); assert page.locator('#pitchPanel').is_hidden()

    # Primary settings panels are exclusive and same-button clicks toggle them. Meter remains independent.
    page.locator('#stereoButton').click(); page.wait_for_timeout(10); assert page.locator('#stereoPanel').is_visible()
    page.locator('#dynamicsButton').click(); page.wait_for_timeout(10); assert page.locator('#stereoPanel').is_hidden() and page.locator('#dynamicsPanel').is_visible()
    page.locator('#dynamicsButton').click(); page.wait_for_timeout(10); assert page.locator('#dynamicsPanel').is_hidden()
    page.locator('#meterButton').click(); page.wait_for_timeout(10); assert page.locator('#meterPanel').is_visible()
    page.locator('#stereoButton').click(); page.wait_for_timeout(10); assert page.locator('#stereoPanel').is_visible() and page.locator('#meterPanel').is_visible()
    page.locator('.brand').click(); page.wait_for_timeout(10); assert page.locator('#stereoPanel').is_hidden() and page.locator('#meterPanel').is_visible()
    page.locator('#meterButton').click(); page.wait_for_timeout(10); assert page.locator('#meterPanel').is_hidden()

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
    meter_box=page.locator('#meterPanel').bounding_box(); strip_box=page.locator('.control-strip').bounding_box()
    assert meter_box and meter_box['height'] < 500, meter_box
    assert strip_box and meter_box['y']+meter_box['height'] <= strip_box['y']-6, (meter_box,strip_box)
    assert page.locator('#meterPanel .panel-note').is_visible()
    # Meter stays draggable, but persistent module navigation is now a hard
    # bottom boundary. Verify horizontal movement instead of dragging it over
    # the toolbar.
    head=page.locator('#meterPanel .floating-head').bounding_box(); assert head
    page.mouse.move(head['x']+90,head['y']+15); page.mouse.down(); page.mouse.move(head['x']-35,head['y']+15,steps=5); page.mouse.up(); page.wait_for_timeout(30)
    moved_meter=page.locator('#meterPanel').bounding_box(); assert moved_meter and moved_meter['x'] < meter_box['x']-15, (meter_box,moved_meter)
    assert moved_meter['y']+moved_meter['height'] <= strip_box['y']-6, (moved_meter,strip_box)
    assert page.evaluate("window.__qa.localStore['kopelaeq.workspace'].meterPanel.left") <= round(moved_meter['x'])+1
    page.locator('#spectrumFreezeButton').click(); page.wait_for_timeout(20)
    page.locator('#meterPanel [data-close]').click(); page.wait_for_timeout(130)
    spectrum_only=page.evaluate("window.__qa.messages.filter(m=>m.type==='METER_GET').slice(-1)[0]")
    assert spectrum_only['spectrum'] is True and spectrum_only['levels'] is False, spectrum_only

    # Pitch is deliberately down-only; retired Delay/Exciter are not exposed.
    assert page.locator('#pitchSemitones').get_attribute('max') == '0'
    assert page.locator('#delayButton').count() == 0 and page.locator('#exciterButton').count() == 0

    # Panels remain reachable.
    for button,panel in [('#appearanceButton','#appearancePanel'),('#helpButton','#helpPanel'),('#dynamicsButton','#dynamicsPanel'),('#stereoButton','#stereoPanel'),('#effectsButton','#effectsPanel'),('#meterButton','#meterPanel'),('#protectionButton','#protectionPanel'),('#moreButton','#presetPanel')]:
      page.locator(button).click(); page.wait_for_timeout(10)
      box=page.locator(panel).bounding_box(); assert box, panel
      assert box['x']>=3 and box['y']>=3 and box['x']+box['width']<=797 and box['y']+box['height']<=577, (panel,box)
      page.locator(panel+' [data-close]').click()
    for button,panel in [('#pitchButton','#pitchPanel'),('#reverbButton','#reverbPanel'),('#autoPanButton','#autoPanPanel')]:
      page.locator('#effectsButton').click(); page.wait_for_timeout(5)
      page.locator(button).click(); page.wait_for_timeout(10)
      box=page.locator(panel).bounding_box(); assert box, panel
      assert box['x']>=3 and box['y']>=3 and box['x']+box['width']<=797 and box['y']+box['height']<=577, (panel,box)
      page.locator(panel+' [data-close]').click()

    # High-frequency Gain input must never strand the final value in a popup RAF.
    # Background owns single-flight/latest-wins coalescing now; this UI harness
    # verifies that the last user intent is actually dispatched before popup exit.
    before=len(page.evaluate('window.__qa.messages'))
    page.locator('#gainSlider').evaluate("e=>{for(let i=0;i<200;i++){e.value=String(-10+(i%20));e.dispatchEvent(new Event('input',{bubbles:true}));}}")
    page.wait_for_timeout(40)
    after_messages=page.evaluate('window.__qa.messages')[before:]
    realtime=[m for m in after_messages if m.get('type')=='STATE_SET' and m.get('persist') is False]
    assert realtime and realtime[-1]['state']['gainDb']==9, (len(realtime), realtime[-1] if realtime else None)
    assert page.evaluate('state.gainDb') == 9

    # No page injection control remains; floating modules stay inside the popup.
    assert page.locator('#workspaceButton').count()==0

    # Appearance architecture: both locked redesign directions use the same DOM
    # and audio state, but produce genuinely different layout geometry.
    if page.locator('#bandInspector').is_visible(): page.locator('#bandInspectorClose').click(); page.wait_for_timeout(10)
    page.locator('#appearanceButton').click(); page.wait_for_timeout(90)
    assert page.evaluate('appearanceUi!==null')
    page.locator('#appearanceThemeOptions [data-theme-choice="rice"]').click(); page.wait_for_timeout(320)
    assert page.evaluate("document.documentElement.dataset.layout") == 'rice'
    assert page.evaluate("document.documentElement.dataset.theme") == 'builtin.rice'
    assert page.evaluate("document.documentElement.dataset.userArtwork") == 'true'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artwork-card-image').includes('data:image/jpeg')")
    page.evaluate('''() => {
      state.gainDb=0;
      state.eq.enabled=true;
      state.eq.frequencies=[31,62,125,250,500,1000,2000,4000,8000,12000,18000];
      state.eq.gains=[0,3.2,1.8,.8,0,-.4,.2,1.5,.8,.2,0];
      state.eq.qs=Array(11).fill(.9);
      state.stereo.enabled=true; state.stereo.width=1.12; state.stereo.balance=0; state.stereo.mono=false; state.stereo.swap=false;
      updateControlState(); eqUi.queueDraw();
    }''')
    assert page.locator('#appearancePanel').is_visible()
    assert page.locator('#appearancePanel').get_attribute('data-presentation')=='appearance-inspector'
    # Appearance replaces Audio Tools while the working EQ remains full-size.
    page.locator('#appearanceTabs [data-appearance-tab="surfaces"]').click(); page.wait_for_timeout(20)
    surface_slider=page.locator('#mainSurfaceOpacity').bounding_box(); assert surface_slider and surface_slider['width'] >= 90, surface_slider
    appearance_box=page.locator('#appearancePanel').bounding_box(); assert appearance_box and 212 <= appearance_box['width'] <= 220 and appearance_box['height'] >= 540, appearance_box
    primary_preview=page.locator('.primary-surface').bounding_box(); assert primary_preview and 558 <= primary_preview['width'] <= 562, primary_preview
    assert primary_preview['x']+primary_preview['width'] <= appearance_box['x']-4, (primary_preview,appearance_box)
    assert page.locator('.primary-surface').is_visible()
    assert page.locator('.control-strip').evaluate("e=>getComputedStyle(e).visibility")=='hidden'
    assert page.evaluate("document.querySelector('.app-shell').inert") is True
    assert page.locator('.app-shell').get_attribute('aria-hidden')=='true'
    # Per-theme panel glass controls: color and transparency apply independently
    # to the main surface and persistent Audio Tools without affecting child text.
    surface_before=page.evaluate("() => ({main:getComputedStyle(document.querySelector('.primary-surface')).background, tools:getComputedStyle(document.querySelector('.control-strip')).background})")
    # Live sliders are RAF-coalesced and do not hit chrome.storage on every input event.
    storage_sets_before=page.evaluate("window.__qa.storageStats.localSets")
    page.locator('#mainSurfaceOpacity').evaluate("e=>{for(let i=0;i<120;i++){e.value=String(10+(i%90));e.dispatchEvent(new Event('input',{bubbles:true}));}}")
    page.wait_for_timeout(50)
    assert page.evaluate("window.__qa.storageStats.localSets")==storage_sets_before
    page.locator('#mainSurfaceOpacity').evaluate("e=>e.dispatchEvent(new Event('change',{bubbles:true}))")
    page.wait_for_timeout(40)
    assert page.evaluate("window.__qa.storageStats.localSets") <= storage_sets_before+1
    page.locator('#mainSurfaceOpacity').evaluate("e=>{e.value='35';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#toolsSurfaceOpacity').evaluate("e=>{e.value='55';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#mainSurfaceColor').evaluate("e=>{e.value='#243647';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#toolsSurfaceColor').evaluate("e=>{e.value='#312944';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#eqSurfaceColor').evaluate("e=>{e.value='#112233';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#eqSurfaceOpacity').evaluate("e=>{e.value='25';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#cardsSurfaceColor').evaluate("e=>{e.value='#223344';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#cardsSurfaceOpacity').evaluate("e=>{e.value='45';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#controlsSurfaceColor').evaluate("e=>{e.value='#334455';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#controlsSurfaceOpacity').evaluate("e=>{e.value='60';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#appearanceTabs [data-appearance-tab="advanced"]').click(); page.wait_for_timeout(20)
    page.locator('#accentColor').evaluate("e=>{e.value='#ff6aa2';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#accentAltColor').evaluate("e=>{e.value='#9966ff';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#positiveColor').evaluate("e=>{e.value='#33cc77';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#dangerColor').evaluate("e=>{e.value='#ff4455';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#eqCurveColor').evaluate("e=>{e.value='#abcdef';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#borderColor').evaluate("e=>{e.value='#789abc';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#backgroundDim').evaluate("e=>{e.value='15';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.locator('#surfaceBlur').evaluate("e=>{e.value='6';e.dispatchEvent(new Event('change',{bubbles:true}));}")
    page.wait_for_timeout(90)
    surface_vars=page.evaluate("() => {const s=getComputedStyle(document.documentElement);return {mc:s.getPropertyValue('--main-surface-color').trim(),mo:s.getPropertyValue('--main-surface-opacity').trim(),ec:s.getPropertyValue('--eq-surface-color').trim(),eo:s.getPropertyValue('--eq-surface-opacity').trim(),cc:s.getPropertyValue('--cards-surface-color').trim(),co:s.getPropertyValue('--cards-surface-opacity').trim(),tc:s.getPropertyValue('--tools-surface-color').trim(),to:s.getPropertyValue('--tools-surface-opacity').trim(),uc:s.getPropertyValue('--controls-surface-color').trim(),uo:s.getPropertyValue('--controls-surface-opacity').trim(),accent:s.getPropertyValue('--cyan').trim(),accent2:s.getPropertyValue('--purple').trim(),positive:s.getPropertyValue('--green').trim(),danger:s.getPropertyValue('--danger').trim(),curve:s.getPropertyValue('--mint').trim(),border:s.getPropertyValue('--border-custom-color').trim(),dim:s.getPropertyValue('--artwork-dim').trim(),blur:s.getPropertyValue('--surface-blur').trim()}}")
    assert surface_vars=={'mc':'#243647','mo':'0.35','ec':'#112233','eo':'0.25','cc':'#223344','co':'0.45','tc':'#312944','to':'0.55','uc':'#334455','uo':'0.6','accent':'#ff6aa2','accent2':'#9966ff','positive':'#33cc77','danger':'#ff4455','curve':'#abcdef','border':'#789abc','dim':'15%','blur':'6px'}, surface_vars
    assert page.evaluate("appearance.currentEqAppearance.curve")=='#abcdef'
    layer_backgrounds=page.evaluate("() => ({card:getComputedStyle(document.querySelector('#presetControl')).backgroundColor,control:getComputedStyle(document.querySelector('#appearancePanel .appearance-small-button')).backgroundColor,module:getComputedStyle(document.querySelector('#dynamicsButton')).backgroundColor,status:getComputedStyle(document.querySelector('#dynamicsButton .module-state')).backgroundColor})")
    assert layer_backgrounds['card'] not in ('rgba(0, 0, 0, 0)','transparent'), layer_backgrounds
    assert layer_backgrounds['module'] not in ('rgba(0, 0, 0, 0)','transparent'), layer_backgrounds
    assert layer_backgrounds['status'] not in ('rgba(0, 0, 0, 0)','transparent'), layer_backgrounds
    eq_pixel=page.evaluate("() => {const c=document.querySelector('#eqCanvas'),ctx=c.getContext('2d'),d=ctx.getImageData(2,2,1,1).data;return Array.from(d)}")
    assert all(abs(a-b)<=3 for a,b in zip(eq_pixel[0:3],[17,34,51])) and 50 <= eq_pixel[3] <= 75, eq_pixel
    surface_after=page.evaluate("() => ({main:getComputedStyle(document.querySelector('.primary-surface')).background, tools:getComputedStyle(document.querySelector('.control-strip')).background})")
    assert surface_after['main'] != surface_before['main'], (surface_before, surface_after)
    assert surface_after['tools'] != surface_before['tools'], (surface_before, surface_after)
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-panel-glass-{VERSION}.png'))
    assert page.locator('#mainSurfaceOpacityReadout').inner_text()=='35%'
    assert page.locator('#toolsSurfaceOpacityReadout').inner_text()=='55%'
    page.locator('#appearanceTabs [data-appearance-tab="surfaces"]').click(); page.wait_for_timeout(10)
    assert not page.locator('#surfaceResetButton').is_disabled()
    page.locator('#surfaceResetButton').click(); page.wait_for_timeout(80)
    reset_vars=page.evaluate("() => {const s=getComputedStyle(document.documentElement);return [s.getPropertyValue('--main-surface-color').trim(),s.getPropertyValue('--main-surface-opacity').trim(),s.getPropertyValue('--eq-surface-color').trim(),s.getPropertyValue('--eq-surface-opacity').trim(),s.getPropertyValue('--cards-surface-color').trim(),s.getPropertyValue('--cards-surface-opacity').trim(),s.getPropertyValue('--tools-surface-color').trim(),s.getPropertyValue('--tools-surface-opacity').trim(),s.getPropertyValue('--controls-surface-color').trim(),s.getPropertyValue('--controls-surface-opacity').trim(),s.getPropertyValue('--cyan').trim()]}")
    assert reset_vars==['#101a22','0.89','#101a22','0.88','#182630','0.72','#101a22','0.89','#182630','0.78','#6c91ff'], reset_vars
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-appearance-{VERSION}.png'))

    # Local artwork path: animated GIF -> IndexedDB -> card CSS -> fit -> reset.
    page.locator('#appearanceTabs [data-appearance-tab="media"]').click(); page.wait_for_timeout(10)
    gif=(b'GIF89a' + bytes([1,0,1,0,0x80,0,0,0,0,0,255,255,255,0x21,0xF9,4,1,0,0,0,0,0x2C,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0,0x3B]))
    page.locator('#artworkFile').set_input_files({'name':'qa-animated.gif','mimeType':'image/gif','buffer':gif})
    page.wait_for_timeout(120)
    assert page.evaluate("document.documentElement.dataset.userArtwork")=='true'
    assert page.locator('#artworkCurrentName').inner_text()=='qa-animated.gif'
    assert page.locator('#artworkRemoveButton').is_visible()
    card_image=page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artwork-card-image').trim()")
    assert 'blob:' in card_image, card_image
    page.locator('#artworkFitOptions [data-artwork-fit="contain"]').click(); page.wait_for_timeout(80)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artwork-card-size').trim()")=='contain'
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-user-artwork-{VERSION}.png'))
    page.locator('#artworkRemoveButton').click(); page.wait_for_timeout(80)
    assert page.evaluate("document.documentElement.dataset.userArtwork")=='false'
    assert page.locator('#artworkCurrentName').inner_text()=='Theme default'

    # Full-window background is independent from the square artwork card.
    page.locator('#backgroundFile').set_input_files({'name':'qa-background.gif','mimeType':'image/gif','buffer':gif})
    page.wait_for_timeout(120)
    assert page.evaluate("document.documentElement.dataset.userBackground")=='true'
    assert page.locator('#backgroundCurrentName').inner_text()=='qa-background.gif'
    assert page.locator('#backgroundRemoveButton').is_visible()
    background_image=page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artwork-image').trim()")
    assert 'blob:' in background_image, background_image
    page.locator('#backgroundFitOptions [data-background-fit="contain"]').click(); page.wait_for_timeout(80)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--artwork-background-size').trim()")=='contain'
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-user-background-{VERSION}.png'))
    page.locator('#backgroundRemoveButton').click(); page.wait_for_timeout(80)
    assert page.evaluate("document.documentElement.dataset.userBackground")=='false'
    assert page.locator('#backgroundCurrentName').inner_text()=='Theme default'

    # Production custom-theme path: import -> validate -> persist -> activate -> remove.
    page.locator('#appearanceTabs [data-appearance-tab="theme"]').click(); page.wait_for_timeout(10)
    custom_theme={
      'format':'KopelaEQ Theme',
      'theme':{
        'schemaVersion':1,'id':'user.qa-blue','name':'QA Blue','author':'QA',
        'extends':'builtin.rice','preferredLayout':'rice',
        'tokens':{'colors':{'accent':'#5aa9ff','accentAlt':'#c58cff'},'surface':{'main':{'color':'#203040','opacity':0.42},'eq':{'color':'#142536','opacity':0.33},'cards':{'color':'#253647','opacity':0.44},'tools':{'color':'#304050','opacity':0.61},'controls':{'color':'#364758','opacity':0.57}},'eq':{'curve':'#e8f2ff','pointSelected':'#5aa9ff'}}
      }
    }
    page.locator('#themeImportFile').set_input_files({
      'name':'qa-theme.json','mimeType':'application/json',
      'buffer':__import__('json').dumps(custom_theme).encode('utf-8')
    })
    page.wait_for_timeout(80)
    assert page.evaluate("document.documentElement.dataset.theme")=='user.qa-blue'
    assert page.locator('#appearanceCustomThemeOptions [data-custom-theme-id="user.qa-blue"]').count()==1
    assert page.locator('#appearanceCustomThemeOptions [data-custom-theme-id="user.qa-blue"]').get_attribute('aria-pressed')=='true'
    assert page.evaluate("window.__qa.localStore['kopelaeq.customThemes'][0].id")=='user.qa-blue'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--cyan').trim()")=='#5aa9ff'
    # JSON surface.main/tools are real theme defaults; local panel controls layer over them.
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--main-surface-color').trim()")=='#203040'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--main-surface-opacity').trim()")=='0.42'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--tools-surface-color').trim()")=='#304050'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--tools-surface-opacity').trim()")=='0.61'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--eq-surface-opacity').trim()")=='0.33'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--cards-surface-opacity').trim()")=='0.44'
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--controls-surface-opacity').trim()")=='0.57'
    page.locator('#appearanceTabs [data-appearance-tab="surfaces"]').click(); page.wait_for_timeout(10)
    assert page.locator('#mainSurfaceOpacityReadout').inner_text()=='42%'
    assert page.locator('#toolsSurfaceOpacityReadout').inner_text()=='61%'
    page.locator('#mainSurfaceOpacity').evaluate("e=>{e.value='23';e.dispatchEvent(new Event('change',{bubbles:true}))}")
    page.wait_for_timeout(30)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--main-surface-opacity').trim()")=='0.23'
    assert not page.locator('#surfaceResetButton').is_disabled()
    page.locator('#surfaceResetButton').click(); page.wait_for_timeout(30)
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--main-surface-opacity').trim()")=='0.42'
    assert page.locator('#mainSurfaceOpacityReadout').inner_text()=='42%'
    page.locator('#appearanceTabs [data-appearance-tab="theme"]').click(); page.wait_for_timeout(10)
    assert page.locator('#exportCustomThemeButton').is_visible()
    page.screenshot(path=str(BASE/'qa'/f'popup-custom-theme-{VERSION}.png'))
    assert page.locator('#deleteCustomThemeButton').is_visible()
    page.locator('#deleteCustomThemeButton').click(); page.wait_for_timeout(80)
    assert page.evaluate("document.documentElement.dataset.theme")=='builtin.rice'
    assert page.evaluate("(window.__qa.localStore['kopelaeq.customThemes']||[]).length")==0
    assert page.locator('#appearanceCustomThemeOptions [data-custom-theme-id="user.qa-blue"]').count()==0
    appearance_scroll=page.locator('#appearancePanel .appearance-pane:not([hidden])').evaluate("e=>({overflow:getComputedStyle(e).overflowY,gutter:getComputedStyle(e).scrollbarGutter,pad:getComputedStyle(e).paddingBottom})")
    assert appearance_scroll['overflow']=='auto' and 'stable' in appearance_scroll['gutter'] and float(appearance_scroll['pad'].replace('px',''))>=18, appearance_scroll

    page.locator('#appearancePanel [data-close]').click()
    page.wait_for_timeout(320)
    assert page.evaluate("document.querySelector('.app-shell').inert") is False
    assert page.locator('.app-shell').get_attribute('aria-hidden') is None
    rice_gain=page.locator('#gainSlider').bounding_box(); rice_strip=page.locator('.control-strip').bounding_box(); rice_eq=page.locator('.eq-section').bounding_box()
    # Rice context row must be collision-free: the preset lives above Gain,
    # and EQ utility controls stay at the top of the canvas, away from x-axis labels.
    rice_preset=page.locator('#presetControl').bounding_box(); rice_gain_row=page.locator('.gain-column').bounding_box()
    rice_toolbar=page.locator('.eq-toolbar').bounding_box(); rice_canvas_box=page.locator('#eqCanvas').bounding_box()
    assert rice_preset and rice_gain_row and rice_preset['y']+rice_preset['height'] <= rice_gain_row['y']-6, (rice_preset,rice_gain_row)
    assert rice_toolbar and rice_canvas_box, (rice_toolbar,rice_canvas_box)
    assert rice_toolbar['y'] >= rice_canvas_box['y']+3, (rice_toolbar,rice_canvas_box)
    assert rice_toolbar['y']+rice_toolbar['height'] <= rice_canvas_box['y']+42, (rice_toolbar,rice_canvas_box)
    assert rice_toolbar['y']+rice_toolbar['height'] <= rice_canvas_box['y']+rice_canvas_box['height']-36, (rice_toolbar,rice_canvas_box)
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-main-{VERSION}.png'))
    # Adversarial layout: the maximum allowed preset-name length must ellipsize
    # inside the real picker instead of crossing Main or Audio Tools.
    long_preset='W'*80
    page.locator('#presetPickerText').evaluate('(e,t)=>e.textContent=t', long_preset)
    long_geom=page.locator('#presetPickerButton').evaluate("e=>{const t=e.querySelector('strong'),b=e.getBoundingClientRect(),r=t.getBoundingClientRect();return {buttonLeft:b.left,buttonRight:b.right,textLeft:r.left,textRight:r.right,sw:t.scrollWidth,cw:t.clientWidth,overflow:getComputedStyle(t).textOverflow,white:getComputedStyle(t).whiteSpace}}")
    assert long_geom['textLeft']>=long_geom['buttonLeft']-0.5 and long_geom['textRight']<=long_geom['buttonRight']+0.5, long_geom
    assert long_geom['sw']>long_geom['cw'] and long_geom['overflow']=='ellipsis' and long_geom['white']=='nowrap', long_geom
    page.locator('#presetPickerText').evaluate("e=>e.textContent='Current settings'")
    # Small visual glyphs retain at least a 32 px physical target.
    for target in ['#appearanceButton','#helpButton','#resetButton']:
        hit=page.locator(target).bounding_box(); assert hit and hit['width']>=31.5 and hit['height']>=31.5, (target,hit)
    # Rice macro spacing: persistent Audio Tools must not hug the main surface.
    rice_primary_spacing=page.locator('.primary-surface').bounding_box()
    assert rice_primary_spacing and rice_strip and rice_strip['x']-(rice_primary_spacing['x']+rice_primary_spacing['width']) >= 22, (rice_primary_spacing,rice_strip)
    assert rice_gain and rice_gain['width'] >= 120 and rice_gain['height'] <= 34, rice_gain
    assert rice_strip and 194 <= rice_strip['width'] <= 198 and 288 <= rice_strip['height'] <= 296, rice_strip
    assert page.locator('.quick-controls').count()==0
    assert page.locator('#gainResetButton').is_visible()
    page.evaluate('state.gainDb=4.0; updateControlState()')
    assert not page.locator('#gainResetButton').is_disabled()
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-gain-reset-{VERSION}.png'))
    page.locator('#gainResetButton').click(); page.wait_for_timeout(35)
    assert page.locator('#gainReadout').inner_text()=='+0.0 dB'
    assert page.locator('#gainResetButton').is_disabled()
    page.locator('#gainSlider').evaluate("e=>{e.value='-0.2';e.dispatchEvent(new Event('input',{bubbles:true}))}")
    page.wait_for_timeout(25)
    assert page.locator('#gainReadout').inner_text()=='+0.0 dB'
    assert page.locator('#gainSlider').input_value()=='0'
    # Every Audio Tools label/state must fit without ellipsis or clipping.
    strip_overflow=page.locator('.control-strip').evaluate("e=>({sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight})")
    assert strip_overflow['sw']<=strip_overflow['cw']+1 and strip_overflow['sh']<=strip_overflow['ch']+1, strip_overflow
    for button in ['#dynamicsButton','#stereoButton','#protectionButton','#meterButton','#effectsButton','#moreButton']:
        overflow=page.locator(button).evaluate("e=>[...e.querySelectorAll('span')].map(x=>({text:x.textContent,sw:x.scrollWidth,cw:x.clientWidth})).filter(x=>x.sw>x.cw+1)")
        assert not overflow, (button, overflow)
        status=page.locator(button+' .module-state')
        if status.count() and status.is_visible():
            inside=page.locator(button).evaluate("e=>{const s=e.querySelector('.module-state'); if(!s)return true; const a=e.getBoundingClientRect(),b=s.getBoundingClientRect(); return b.left>=a.left-0.5&&b.right<=a.right+0.5&&b.top>=a.top-0.5&&b.bottom<=a.bottom+0.5}")
            assert inside, button
    rice_primary=page.locator('.primary-surface').bounding_box(); rice_canvas=page.locator('#eqCanvas').bounding_box()
    assert rice_primary and rice_primary['width']/rice_primary['height'] >= 1.30, rice_primary
    assert rice_canvas and rice_canvas['width']/rice_canvas['height'] >= 2.10, rice_canvas
    assert rice_eq and rice_eq['width'] >= 510, rice_eq
    assert page.locator('.theme-art-card').is_visible()
    assert page.evaluate("getComputedStyle(document.body,'::before').backgroundImage.includes('data:image/svg+xml')")
    # The live UI must not reproduce screenshot-scale microtype. Every visible
    # text-bearing element in themed layouts stays at or above the 10 px floor.
    type_floor=page.evaluate("""() => [...document.querySelectorAll('body *')].filter(e => { const cs=getComputedStyle(e); const r=e.getBoundingClientRect(); return cs.display!=='none' && cs.visibility!=='hidden' && r.width>0 && r.height>0 && (e.childElementCount===0 || ['BUTTON','OUTPUT','INPUT','SMALL','SPAN','STRONG','LABEL'].includes(e.tagName)) && (e.textContent||'').trim(); }).map(e=>({tag:e.tagName,id:e.id,cls:e.className||'',text:(e.textContent||'').trim().slice(0,40),size:parseFloat(getComputedStyle(e).fontSize)})).filter(x=>x.size>0 && x.size<9.9)""")
    assert not type_floor, type_floor
    # Rice uses one predictable tool model: Audio Tools stays visible while
    # every audio detail opens inside the primary workspace, never over the EQ.
    rice_primary_before=page.locator('.primary-surface').bounding_box()
    def assert_rice_workspace(panel_id):
        panel_box=page.locator(panel_id).bounding_box(); primary_box=page.locator('.primary-surface').bounding_box(); strip_box=page.locator('.control-strip').bounding_box()
        assert panel_box and primary_box and strip_box, (panel_id,panel_box,primary_box,strip_box)
        assert panel_box['x']>=primary_box['x'] and panel_box['x']+panel_box['width']<=primary_box['x']+primary_box['width']+1, (panel_id,panel_box,primary_box)
        assert panel_box['x']+panel_box['width'] < strip_box['x'], (panel_id,panel_box,strip_box)
        assert page.locator('.control-strip').is_visible()
        assert page.locator('.primary-surface').bounding_box()==rice_primary_before
        assert page.evaluate("document.documentElement.dataset.workspacePage")==panel_id.lstrip('#')

    page.locator('#stereoButton').click(); page.wait_for_timeout(320)
    assert page.locator('#stereoPanel').is_visible() and page.locator('#stereoPanel').get_attribute('data-presentation')=='workspace-page'
    assert_rice_workspace('#stereoPanel')
    assert page.evaluate("document.querySelector('.eq-section').inert === true")
    assert page.locator('.eq-section').get_attribute('aria-hidden')=='true'
    stereo_overflow=page.locator('#stereoPanel').evaluate("e=>({body:[...e.querySelectorAll('.floating-body')].map(x=>[x.scrollWidth,x.clientWidth]), leaves:[...e.querySelectorAll('span,strong,output,button')].filter(x=>{const r=x.getBoundingClientRect(),cs=getComputedStyle(x);return r.width>0&&cs.display!=='none'&&x.scrollWidth>x.clientWidth+1}).map(x=>(x.textContent||'').trim())})")
    assert all(sw<=cw+1 for sw,cw in stereo_overflow['body']) and not stereo_overflow['leaves'], stereo_overflow
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-{VERSION}.png'))
    page.locator('#stereoPanel [data-close]').click(); page.wait_for_timeout(320)
    assert page.evaluate("document.querySelector('.eq-section').inert === false")
    assert page.locator('.eq-section').get_attribute('aria-hidden') is None

    page.locator('#moreButton').click(); page.wait_for_timeout(320)
    assert page.locator('#presetPanel').is_visible() and page.locator('#presetPanel').get_attribute('data-presentation')=='workspace-page'
    assert_rice_workspace('#presetPanel')
    # Enabled DSP is not a second selected navigation tab.
    assert page.locator('#moreButton').evaluate("e=>e.classList.contains('is-open')")
    assert not page.locator('#stereoButton').evaluate("e=>e.classList.contains('is-open')")
    if page.locator('#stereoButton').evaluate("e=>e.classList.contains('is-on')"):
        open_bg=page.locator('#moreButton').evaluate("e=>getComputedStyle(e).backgroundColor")
        enabled_bg=page.locator('#stereoButton').evaluate("e=>getComputedStyle(e).backgroundColor")
        assert open_bg != enabled_bg, (open_bg,enabled_bg)
    # Preset state wording must distinguish a true selection from edited
    # settings that are merely based on a preset.
    page.evaluate("presetUi.markEdited()")
    page.wait_for_timeout(20)
    assert page.locator('#presetActionTitle').inner_text().lower() in ['based on preset','preset actions']
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-presets-{VERSION}.png'))
    page.locator('#presetPanel [data-close]').click(); page.wait_for_timeout(320)

    page.locator('#effectsButton').click(); page.wait_for_timeout(320)
    assert page.locator('#effectsPanel').get_attribute('data-presentation')=='workspace-page'
    assert_rice_workspace('#effectsPanel')
    assert page.locator('#effectsPanel .panel-note').is_visible()
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-effects-{VERSION}.png'))
    page.locator('#effectsPanel [data-close]').click(); page.wait_for_timeout(320)

    page.locator('#protectionButton').click(); page.wait_for_timeout(320)
    assert_rice_workspace('#protectionPanel')
    protection_overflow=page.locator('#protectionPanel').evaluate("e=>({sw:e.scrollWidth,cw:e.clientWidth, leaves:[...e.querySelectorAll('span,strong,output,button')].filter(x=>{const r=x.getBoundingClientRect(),cs=getComputedStyle(x);return r.width>0&&cs.display!=='none'&&x.scrollWidth>x.clientWidth+1}).map(x=>(x.textContent||'').trim())})")
    assert protection_overflow['sw']<=protection_overflow['cw']+1 and not protection_overflow['leaves'], protection_overflow
    protection_body=page.locator('#protectionPanel .floating-body').bounding_box(); assert protection_body and protection_body['height']<=232, protection_body
    protection_close=page.locator('#protectionPanel [data-close]').bounding_box(); assert protection_close and protection_close['width']>=31.5 and protection_close['height']>=31.5, protection_close
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-protection-{VERSION}.png'))
    page.locator('#protectionPanel [data-close]').click(); page.wait_for_timeout(320)

    page.locator('#effectsButton').click(); page.locator('#pitchButton').click(); page.wait_for_timeout(320)
    assert_rice_workspace('#pitchPanel')
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-pitch-{VERSION}.png'))
    page.locator('#pitchPanel [data-close]').click(); page.wait_for_timeout(320)

    page.locator('#dynamicsButton').click(); page.wait_for_timeout(320)
    assert_rice_workspace('#dynamicsPanel')
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-dynamics-{VERSION}.png'))
    if page.locator('#dynamicsAdvancedToggle').get_attribute('aria-expanded') != 'true':
        page.locator('#dynamicsAdvancedToggle').click(); page.wait_for_timeout(120)
    assert page.locator('#dynamicsPanel').evaluate("e=>e.classList.contains('has-expanded-content')")
    rice_dyn_scroll=page.locator('#dynamicsPanel .floating-body').evaluate("e=>({sh:e.scrollHeight,ch:e.clientHeight,overflow:getComputedStyle(e).overflowY,gutter:getComputedStyle(e).scrollbarGutter})")
    assert rice_dyn_scroll['overflow']=='auto' and 'stable' in rice_dyn_scroll['gutter'], rice_dyn_scroll
    if rice_dyn_scroll['sh'] > rice_dyn_scroll['ch'] + 1:
        assert page.locator('#dynamicsPanel').evaluate("e=>e.classList.contains('can-scroll-down')")
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-dynamics-advanced-{VERSION}.png'))
    if rice_dyn_scroll['sh'] > rice_dyn_scroll['ch'] + 1:
        page.locator('#dynamicsPanel .floating-body').evaluate("e=>e.scrollTop=e.scrollHeight")
        page.wait_for_timeout(30)
        assert page.locator('#dynamicsPanel .floating-body').evaluate("e=>e.scrollTop>0")
        assert not page.locator('#dynamicsPanel').evaluate("e=>e.classList.contains('can-scroll-down')")
    page.locator('#dynamicsPanel [data-close]').click(); page.wait_for_timeout(320)
    # Themed tools are strictly exclusive: switching from Stereo to Meter must
    # close Stereo rather than stack two workspace panels.
    page.locator('#stereoButton').click(); page.wait_for_timeout(160)
    page.locator('#meterButton').click(); page.wait_for_timeout(320)
    assert page.locator('#stereoPanel').is_hidden() and page.locator('#meterPanel').is_visible()
    visible_workspaces=page.locator('.floating-panel[data-presentation="workspace-page"]:not([hidden]):not(.is-closing)').count()
    assert visible_workspaces==1, visible_workspaces
    rice_meter=page.locator('#meterPanel').bounding_box(); rice_primary_now=page.locator('.primary-surface').bounding_box()
    assert rice_meter and rice_primary_now and rice_meter['x']>=rice_primary_now['x'] and rice_meter['x']+rice_meter['width']<=rice_primary_now['x']+rice_primary_now['width']+1, (rice_meter,rice_primary_now)
    assert page.evaluate("document.documentElement.dataset.workspacePage")=='meterPanel'
    meter_overflow=page.locator('#meterPanel .floating-body').evaluate('e=>({client:e.clientHeight,scroll:e.scrollHeight})'); assert meter_overflow['scroll']<=meter_overflow['client']+1, meter_overflow
    assert page.locator('#spectrumModeOptions').is_visible()
    spectrum_box=page.locator('#spectrumModeOptions').bounding_box(); meter_body_box=page.locator('#meterPanel .floating-body').bounding_box()
    assert spectrum_box and meter_body_box and spectrum_box['y']+spectrum_box['height'] <= meter_body_box['y']+meter_body_box['height']+1, (spectrum_box,meter_body_box)
    meter_numeric_widths=page.locator('#meterPanel .meter-row output').evaluate_all("els=>els.map(e=>e.getBoundingClientRect().width)")
    assert meter_numeric_widths and max(meter_numeric_widths)-min(meter_numeric_widths)<=4, meter_numeric_widths
    before_boxes=page.locator('#meterPanel .meter-row output').evaluate_all("els=>els.map(e=>({x:e.getBoundingClientRect().x,w:e.getBoundingClientRect().width}))")
    page.evaluate("window.__qa.meterSnapshot.preProtection.leftPeakDb=-12.8; window.__qa.meterSnapshot.preProtection.rightPeakDb=-0.1; window.__qa.meterSnapshot.postProtection.leftPeakDb=-2.4; window.__qa.meterSnapshot.gainReductionDb=-9.7")
    page.wait_for_timeout(140)
    after_boxes=page.locator('#meterPanel .meter-row output').evaluate_all("els=>els.map(e=>({x:e.getBoundingClientRect().x,w:e.getBoundingClientRect().width}))")
    assert before_boxes==after_boxes, (before_boxes,after_boxes)
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-meter-{VERSION}.png'))
    page.locator('#meterPanel [data-close]').click(); page.wait_for_timeout(320)
    rice_point=page.evaluate("""() => { const i=2,c=document.getElementById('eqCanvas'),r=c.getBoundingClientRect(),p=getPlot(c); return {x:r.left+freqToMarkerX(state.eq.frequencies[i],p), y:r.top+gainToY(state.eq.gains[i],p)}; }""")
    page.mouse.click(rice_point['x'], rice_point['y']); page.wait_for_timeout(35)
    assert page.locator('#bandInspector').is_visible()
    # Opening any Audio Tool must dismiss the precise editor so tool surfaces never stack.
    page.locator('#stereoButton').click(); page.wait_for_timeout(120)
    assert page.locator('#bandInspector').is_hidden()
    page.locator('#stereoPanel [data-close]').click(); page.wait_for_timeout(120)
    page.mouse.click(rice_point['x'], rice_point['y']); page.wait_for_timeout(35)
    assert page.locator('#bandInspector').is_visible()
    assert float(page.locator('.eq-toolbar').evaluate("e=>getComputedStyle(e).opacity")) >= .5
    rice_editor=page.locator('#bandInspector').bounding_box(); rice_canvas_box=page.locator('#eqCanvas').bounding_box()
    assert rice_editor and rice_canvas_box and rice_editor['y'] >= rice_canvas_box['y']+rice_canvas_box['height']-0.5, (rice_editor,rice_canvas_box)
    # With the precise editor open, the point itself must remain directly draggable.
    rice_before=page.evaluate('({f:state.eq.frequencies[2],g:state.eq.gains[2]})')
    page.mouse.move(rice_point['x'], rice_point['y']); page.mouse.down(); page.mouse.move(rice_point['x']+24, rice_point['y']-12, steps=4); page.mouse.up(); page.wait_for_timeout(35)
    rice_after=page.evaluate('({f:state.eq.frequencies[2],g:state.eq.gains[2]})')
    assert abs(rice_after['f']-rice_before['f'])>0.1 or abs(rice_after['g']-rice_before['g'])>0.05, (rice_before,rice_after)
    rice_editor_spacing=page.locator('#bandInspector').bounding_box(); rice_surface_spacing=page.locator('.primary-surface').bounding_box()
    rice_detached_gap=rice_editor_spacing['y']-(rice_surface_spacing['y']+rice_surface_spacing['height']) if rice_editor_spacing and rice_surface_spacing else -1
    assert rice_editor_spacing and rice_surface_spacing and rice_detached_gap >= 10, (rice_surface_spacing,rice_editor_spacing,rice_detached_gap)
    assert rice_editor_spacing['width'] <= rice_surface_spacing['width']-20, (rice_surface_spacing,rice_editor_spacing)
    page.screenshot(path=str(BASE/'qa'/f'popup-rice-band-editor-{VERSION}.png'))
    close_hit=page.locator('#bandInspectorClose').bounding_box(); assert close_hit and close_hit['width']>=31.5 and close_hit['height']>=31.5, close_hit
    page.locator('#bandInspectorClose').click(); page.wait_for_timeout(10)

    if page.locator('#appearancePanel').is_hidden():
        page.locator('#appearanceButton').click(); page.wait_for_timeout(20)
    page.locator('#appearanceThemeOptions [data-theme-choice="nocturne"]').click(); page.wait_for_timeout(240)
    assert page.evaluate("document.documentElement.dataset.layout") == 'nocturne'
    assert page.evaluate("document.documentElement.dataset.theme") == 'builtin.nocturne'
    page.evaluate('state.gainDb=0; updateControlState(); eqUi.queueDraw()')
    assert page.locator('#appearancePanel').is_visible()
    assert page.locator('#appearancePanel').get_attribute('data-presentation')=='appearance-inspector'
    noct_primary_preview=page.locator('.primary-surface').bounding_box(); noct_appearance=page.locator('#appearancePanel').bounding_box()
    assert noct_primary_preview and noct_appearance and 514 <= noct_primary_preview['width'] <= 518 and noct_primary_preview['x']+noct_primary_preview['width'] <= noct_appearance['x']-4, (noct_primary_preview,noct_appearance)
    assert page.locator('.control-strip').evaluate("e=>getComputedStyle(e).visibility")=='hidden'
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-appearance-{VERSION}.png'))
    page.locator('#appearancePanel [data-close]').click()
    page.wait_for_timeout(240)
    noct_gain=page.locator('#gainSlider').bounding_box(); noct_strip=page.locator('.control-strip').bounding_box(); noct_eq=page.locator('.eq-section').bounding_box()
    assert noct_gain and noct_gain['width'] > 160 and noct_gain['height'] <= 34, noct_gain
    assert noct_strip and 182 <= noct_strip['width'] <= 184 and 286 <= noct_strip['height'] <= 294, noct_strip
    noct_primary=page.locator('.primary-surface').bounding_box(); noct_canvas=page.locator('#eqCanvas').bounding_box()
    assert noct_primary and 1.20 <= noct_primary['width']/noct_primary['height'] <= 1.30, noct_primary
    assert noct_canvas and noct_canvas['width']/noct_canvas['height'] >= 1.50, noct_canvas
    assert noct_eq and noct_eq['width'] < rice_eq['width'] - 20, (rice_eq,noct_eq)
    assert page.locator('.theme-art-card').is_hidden()
    assert page.locator('.quick-controls').count()==0
    page.locator('#presetPickerText').evaluate('(e,t)=>e.textContent=t', long_preset)
    noct_long=page.locator('#presetPickerButton').evaluate("e=>{const t=e.querySelector('strong'),b=e.getBoundingClientRect(),r=t.getBoundingClientRect();return {br:b.right,tr:r.right,bl:b.left,tl:r.left,sw:t.scrollWidth,cw:t.clientWidth}}")
    assert noct_long['tl']>=noct_long['bl']-0.5 and noct_long['tr']<=noct_long['br']+0.5 and noct_long['sw']>noct_long['cw'], noct_long
    page.locator('#presetPickerText').evaluate("e=>e.textContent='Current settings'")
    # Nocturne Audio Tools must not clip any module label or state.
    strip_overflow=page.locator('.control-strip').evaluate("e=>({sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight})")
    assert strip_overflow['sw']<=strip_overflow['cw']+1 and strip_overflow['sh']<=strip_overflow['ch']+1, strip_overflow
    for button in ['#dynamicsButton','#stereoButton','#protectionButton','#meterButton','#effectsButton','#moreButton']:
        overflow=page.locator(button).evaluate("e=>[...e.querySelectorAll('span')].filter(x=>getComputedStyle(x).display!=='none').map(x=>({text:(x.textContent||'').trim(),sw:x.scrollWidth,cw:x.clientWidth,sh:x.scrollHeight,ch:x.clientHeight})).filter(x=>x.sw>x.cw+1||x.sh>x.ch+1)")
        assert not overflow, (button, overflow)
        status=page.locator(button+' .module-state')
        if status.count() and status.is_visible():
            inside=page.locator(button).evaluate("e=>{const s=e.querySelector('.module-state'); if(!s)return true; const a=e.getBoundingClientRect(),b=s.getBoundingClientRect(); return b.left>=a.left-0.5&&b.right<=a.right+0.5&&b.top>=a.top-0.5&&b.bottom<=a.bottom+0.5}")
            assert inside, button
    assert page.locator('#moreButton .tool-more-label').is_visible()
    assert page.locator('#moreButton .tool-more-label').inner_text().strip()=='Presets'
    assert page.evaluate("getComputedStyle(document.body,'::before').backgroundImage.includes('data:image/svg+xml')")
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-{VERSION}.png'))
    def assert_noct_workspace(panel_id):
        panel_box=page.locator(panel_id).bounding_box(); primary_box=page.locator('.primary-surface').bounding_box(); strip_box=page.locator('.control-strip').bounding_box()
        assert panel_box and primary_box and strip_box, (panel_id,panel_box,primary_box,strip_box)
        assert panel_box['x']>=primary_box['x'] and panel_box['x']+panel_box['width']<=primary_box['x']+primary_box['width']+1, (panel_id,panel_box,primary_box)
        assert panel_box['x']+panel_box['width'] < strip_box['x'], (panel_id,panel_box,strip_box)
        assert page.locator('.control-strip').is_visible()
        assert page.evaluate("document.documentElement.dataset.workspacePage")==panel_id.lstrip('#')
        assert page.locator('.floating-panel[data-presentation="workspace-page"]:not([hidden]):not(.is-closing)').count()==1

    page.locator('#moreButton').click(); page.wait_for_timeout(200)
    assert page.locator('#presetPanel').is_visible() and page.locator('#presetPanel').get_attribute('data-presentation')=='workspace-page'
    assert_noct_workspace('#presetPanel')
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-presets-{VERSION}.png'))
    page.locator('#presetPanel [data-close]').click(); page.wait_for_timeout(220)
    page.locator('#effectsButton').click(); page.wait_for_timeout(200)
    assert_noct_workspace('#effectsPanel')
    assert page.locator('#effectsPanel .panel-note').is_visible()
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-effects-{VERSION}.png'))
    page.locator('#effectsPanel [data-close]').click(); page.wait_for_timeout(180)
    noct_primary_before=page.locator('.primary-surface').bounding_box()
    page.locator('#protectionButton').click(); page.wait_for_timeout(180)
    assert_noct_workspace('#protectionPanel')
    assert page.locator('.primary-surface').bounding_box()==noct_primary_before
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-protection-{VERSION}.png'))
    page.locator('#protectionPanel [data-close]').click(); page.wait_for_timeout(160)
    page.locator('#effectsButton').click(); page.locator('#pitchButton').click(); page.wait_for_timeout(180)
    assert_noct_workspace('#pitchPanel')
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-pitch-{VERSION}.png'))
    page.locator('#pitchPanel [data-close]').click(); page.wait_for_timeout(160)
    page.locator('#dynamicsButton').click(); page.wait_for_timeout(180)
    assert_noct_workspace('#dynamicsPanel')
    if page.locator('#dynamicsAdvancedToggle').get_attribute('aria-expanded') != 'true':
        page.locator('#dynamicsAdvancedToggle').click(); page.wait_for_timeout(120)
    assert page.locator('#dynamicsPanel').evaluate("e=>e.classList.contains('has-expanded-content')")
    noct_dyn_scroll=page.locator('#dynamicsPanel .floating-body').evaluate("e=>({sh:e.scrollHeight,ch:e.clientHeight,overflow:getComputedStyle(e).overflowY,gutter:getComputedStyle(e).scrollbarGutter})")
    assert noct_dyn_scroll['overflow']=='auto' and 'stable' in noct_dyn_scroll['gutter'], noct_dyn_scroll
    if noct_dyn_scroll['sh'] > noct_dyn_scroll['ch'] + 1:
        assert page.locator('#dynamicsPanel').evaluate("e=>e.classList.contains('can-scroll-down')")
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-dynamics-{VERSION}.png'))
    # Direct tool switching must never stack two Nocturne workspaces.
    page.locator('#meterButton').click(); page.wait_for_timeout(280)
    assert page.locator('#dynamicsPanel').is_hidden() and page.locator('#meterPanel').is_visible()
    assert_noct_workspace('#meterPanel')
    assert page.evaluate("document.querySelector('.eq-section').inert === true")
    assert page.locator('#meterButton').evaluate("e=>e.classList.contains('is-open')")
    assert not page.locator('#stereoButton').evaluate("e=>e.classList.contains('is-open')")
    noct_meter_overflow=page.locator('#meterPanel .floating-body').evaluate('e=>({client:e.clientHeight,scroll:e.scrollHeight})')
    assert noct_meter_overflow['scroll']<=noct_meter_overflow['client']+1, noct_meter_overflow
    assert page.locator('#spectrumModeOptions').is_visible()
    noct_spectrum=page.locator('#spectrumModeOptions').bounding_box(); noct_meter_body=page.locator('#meterPanel .floating-body').bounding_box()
    assert noct_spectrum and noct_meter_body and noct_spectrum['y']+noct_spectrum['height'] <= noct_meter_body['y']+noct_meter_body['height']+1, (noct_spectrum,noct_meter_body)
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-meter-{VERSION}.png'))
    page.locator('#meterPanel [data-close]').click(); page.wait_for_timeout(160)
    assert page.evaluate("document.querySelector('.eq-section').inert === false")
    noct_point=page.evaluate("""() => { const i=2,c=document.getElementById('eqCanvas'),r=c.getBoundingClientRect(),p=getPlot(c); return {x:r.left+freqToMarkerX(state.eq.frequencies[i],p), y:r.top+gainToY(state.eq.gains[i],p)}; }""")
    page.mouse.click(noct_point['x'], noct_point['y']); page.wait_for_timeout(35)
    assert page.locator('#bandInspector').is_visible()
    assert float(page.locator('.eq-toolbar').evaluate("e=>getComputedStyle(e).opacity")) >= .5
    noct_editor=page.locator('#bandInspector').bounding_box(); noct_canvas_box=page.locator('#eqCanvas').bounding_box()
    assert noct_editor and noct_canvas_box and noct_editor['y'] >= noct_canvas_box['y']+noct_canvas_box['height']-0.5, (noct_editor,noct_canvas_box)
    page.screenshot(path=str(BASE/'qa'/f'popup-nocturne-band-editor-{VERSION}.png'))
    page.locator('#bandInspectorClose').click(); page.wait_for_timeout(10)
    stored_appearance=page.evaluate("window.__qa.localStore['kopelaeq.appearance']")
    assert stored_appearance['themeId']=='builtin.nocturne' and stored_appearance['layoutId']=='nocturne', stored_appearance

    assert not errors, errors

    # Simulate a brand-new popup document while the tab's selected preset already
    # exists in durable background storage: the label must restore immediately.
    reopen=browser.new_page(viewport={"width":800,"height":580}, device_scale_factor=1)
    seeded_mock=mock.replace('const selectedPresets = {};', "const selectedPresets = {'42':'Bass Heavy (bass4)'};").replace('let liveState = null;', "let liveState = S.presetToAudioState(DEFAULT_PRESETS['Bass Heavy (bass4)']); liveState.gainDb = 3;")
    reopened_content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>').replace('<link rel="stylesheet" href="appearance-layouts.css">', '<style>'+appearance_css+'</style>').replace('<link rel="stylesheet" href="appearance-layouts.css">', '<style>'+appearance_css+'</style>')
    reopened_content=reopened_content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+seeded_mock+'</script><script>'+popup+'</script>')
    reopen.set_content(reopened_content, wait_until='load'); reopen.wait_for_timeout(160)
    assert reopen.locator('#presetPickerText').inner_text()=='Bass Heavy (bass4)'
    reopen.close()

    # Recovery for the historical race: matching DSP state with a missing stored
    # preset identity is inferred once and healed back into per-tab storage.
    recover=browser.new_page(viewport={"width":800,"height":580}, device_scale_factor=1)
    recover_mock=mock.replace('let liveState = null;', "let liveState = S.presetToAudioState(DEFAULT_PRESETS['Vivid (111)']); liveState.gainDb = 2;")
    recover_content=html.replace('<link rel="stylesheet" href="popup.css">', '<style>'+css+'</style>').replace('<link rel="stylesheet" href="appearance-layouts.css">', '<style>'+appearance_css+'</style>').replace('<link rel="stylesheet" href="appearance-layouts.css">', '<style>'+appearance_css+'</style>')
    recover_content=recover_content.replace('<script type="module" src="js/popup/index.js"></script>', '<script>'+prelude+'</script><script>'+recover_mock+'</script><script>'+popup+'</script>')
    recover.set_content(recover_content, wait_until='load'); recover.wait_for_timeout(160)
    assert recover.locator('#presetPickerText').inner_text()=='Vivid (111)'
    assert recover.evaluate("window.__qa.selectedPresets['42']")=='Vivid (111)'
    recover.close()

    print('ui_qa: PASS',dims,'gainBox',g,'presetMenuBg',menu_bg,'nativeResponse',native_meta,'messages',len(page.evaluate('window.__qa.messages')), flush=True)
    # The supplied headless Chromium intermittently hangs inside Playwright's
    # shutdown path after every assertion has already passed. This QA script is
    # a dedicated subprocess, so exit immediately after the PASS sentinel; pipe
    # closure tears down the Playwright driver/browser without turning cleanup
    # nondeterminism into a false test failure.
    try:
        subprocess.run(['pkill','-TERM','-P',str(os.getpid())], timeout=1, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass
    os._exit(0)
