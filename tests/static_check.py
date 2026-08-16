from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]; EXT=ROOT/'extension'; SRC=ROOT/'src'
manifest=json.loads((EXT/'manifest.json').read_text()); pkg=json.loads((ROOT/'package.json').read_text())
assert manifest['manifest_version']==3 and manifest['version']==pkg['version']
assert manifest['minimum_chrome_version']=='116'
assert len(manifest['description']) <= 132
assert set(manifest['permissions'])=={'activeTab','tabCapture','offscreen','storage'}
assert 'host_permissions' not in manifest and 'scripting' not in manifest['permissions']
assert manifest['background']=={'service_worker':'js/background/index.js','type':'module'}
assert manifest['content_security_policy']['extension_pages']=="script-src 'self'; object-src 'self'"

js_files=list((EXT/'js').rglob('*.js')); all_js='\n'.join(p.read_text() for p in js_files)
for bad in [r'\beval\s*\(',r'new\s+Function\s*\(',r'XMLHttpRequest',r'WebSocket\s*\(',r'fetch\s*\(']: assert not re.search(bad,all_js),bad
assert 'http://' not in all_js and 'https://' not in all_js

constants=(SRC/'shared/constants.ts').read_text(); types=(SRC/'shared/types.ts').read_text(); state=(SRC/'shared/state.ts').read_text(); presets=(SRC/'shared/presets.ts').read_text(); messages=(SRC/'shared/messages.ts').read_text()
audio=(SRC/'audio/audio-session.ts').read_text(); stereo=(SRC/'audio/stereo-stage.ts').read_text(); effects=(SRC/'audio/effect-stages.ts').read_text(); reverb_ir=(SRC/'audio/reverb-impulse.ts').read_text(); pitch=(SRC/'audio/pitch-shift-core.ts').read_text(); pitch_latency=(SRC/'audio/pitch-latency.ts').read_text(); worklet=(SRC/'audio/pitch-worklet-processor.ts').read_text(); tp_core=(SRC/'audio/true-peak-limiter-core.ts').read_text(); tp_worklet=(SRC/'audio/true-peak-limiter-processor.ts').read_text(); bypass=(SRC/'audio/bypass-gate.ts').read_text()
capture=(SRC/'background/capture-manager.ts').read_text(); bg=(SRC/'background/index.ts').read_text(); offscreen=(SRC/'offscreen/index.ts').read_text(); popup=(SRC/'popup/index.ts').read_text(); panel=(SRC/'popup/panel-manager.ts').read_text(); meter=(SRC/'popup/meter-ui.ts').read_text(); presetui=(SRC/'popup/preset-ui.ts').read_text(); equi=(SRC/'popup/eq-ui.ts').read_text(); html=(EXT/'popup.html').read_text(); css=(EXT/'popup.css').read_text()

# Build/runtime contracts.
assert pkg['devDependencies']=={'typescript':'5.8.3'}
assert 'parseBackgroundMessage(input: unknown)' in messages and 'parseOffscreenMessage(input: unknown)' in messages
assert 'parseBackgroundMessage(rawMessage)' in bg and 'parseOffscreenMessage(rawMessage)' in offscreen
assert 'assertNever(message)' in bg and 'assertNever(message)' in offscreen
assert (EXT/'js/audio/pitch-worklet-processor.js').exists()
assert (EXT/'js/audio/true-peak-limiter-processor.js').exists()
assert "src/audio/pitch-worklet-processor.js" not in (ROOT/'scripts/build.mjs').read_text(), 'typed worklet must be emitted by tsc, not copied as unchecked JS'

# Frozen EQ semantic baseline remains untouched.
assert "'lowshelf'" in constants and "'highshelf'" in constants and 'EQ_TYPES' in constants
assert 'filter.type = EQ_TYPES[index]' in audio
assert 'FREQ_MIN = 5' in constants and 'FREQ_MAX = 20000' in constants
assert 'getFrequencyResponse' in (SRC/'audio/eq-response.ts').read_text()
assert (ROOT/'tests/fixtures/golden-eq-response-1.17.json').exists()

# 1.23 state normalization and one baseline migration.
assert 'SCHEMA_VERSION = 4' in constants
for name in ['DynamicsState','StereoState','ReverbState','DelayState','AutoPanState','ExciterState','PitchShiftState']: assert name in types
for name in ['normalizeDynamics','normalizeStereo','normalizeReverb','normalizeDelay','normalizeAutoPan','normalizeExciter','normalizePitchShift']: assert f'function {name}' in state
assert 'AUDIO_BASELINE_VERSION = 4' in bg
for needle in ['next.dynamics = normalizeDynamics','next.stereo = normalizeStereo','next.reverb = normalizeReverb','next.delay = normalizeDelay','next.autoPan = normalizeAutoPan','next.exciter = normalizeExciter','next.pitchShift = normalizePitchShift']: assert needle in bg,needle
assert "enabled: src.enabled === true" in state and "finiteNumber(src.width, 1)" in state and "finiteNumber(src.balance, 0)" in state

# Physical bypass and graph order.
assert 'new BypassGate' in audio and 'processor.connectInput()' in bypass and 'processor.disconnectInput()' in bypass
for needle in [
 'this.masterGain.connect(this.pitchIn)', 'this.pitchOut.connect(this.dynamicsIn)',
 'this.dynamicsOut.connect(this.stereoStage.input)', 'this.stereoStage.output.connect(this.protectionIn)',
 'this.protectionOut.connect(this.reverbStage.input)', 'this.reverbStage.output.connect(this.autoPanStage.input)',
 'this.autoPanStage.output.connect(this.finalDryGain)', 'this.finalDryGain.connect(this.finalOutputBus)',
 'this.maximumWetGain.connect(this.finalOutputBus)', 'this.finalOutputBus.connect(this.context.destination)']:
    assert needle in audio,needle
assert 'new BypassGate' in stereo and 'safeDisconnect(this.input, this.splitter)' in stereo
assert 'const active = next.enabled' in stereo and 'Math.abs(width - 1)' in stereo
for klass in ['ReverbStage','AutoPanStage']: assert f'class {klass}' in effects
for retired in ['DelayStage','ExciterStage']: assert f'class {retired}' not in effects and retired not in audio, f'{retired} runtime dead code returned'
assert 'this.gate.setEnabled(next.enabled' in effects
assert 'context.createConvolver()' in effects and 'context.createStereoPanner()' in effects
assert 'context.createDelay(2.1)' not in effects and 'context.createWaveShaper()' not in effects
assert 'context.createBuffer(2, left.length, context.sampleRate)' in effects and 'generateReverbImpulseChannel' in effects
assert 'Math.random' not in reverb_ir and 'Math.sin' not in reverb_ir
assert 'dampingStartHz' in reverb_ir and 'dampingEndHz' in reverb_ir and 'diffuseAttackMs' in reverb_ir and 'earlyReflections' in reverb_ir

# Pitch is lazy, same-origin, AudioParam driven, and down-only.
assert 'class GranularPitchShifter' in pitch and 'class LegacyDownPitchShifter' in pitch
assert 'PhaseVocoderUpPitchShifter' not in pitch and 'Radix2Fft' not in pitch
assert 'Math.min(0' in pitch and 'Math.min(0, Number(value) || 0)' in pitch
assert "maxValue: 0" in worklet and "minValue: -12" in worklet
assert "registerProcessor('kopelaeq-pitch-shift'" in worklet and "name: 'semitones'" in worklet
assert "chrome.runtime.getURL('js/audio/pitch-worklet-processor.js')" in offscreen and 'context.audioWorklet.addModule(url)' in offscreen
assert 'if (pitchRequested(globalState)) await ensurePitchWorklet(context)' in offscreen
assert "node.parameters.get('semitones')" in audio and 'this.pitchGate.setEnabled(active' in audio
assert 'id="pitchSemitones"' in html and 'max="0"' in html and 'Pitch Down' in html
assert 'upward mode was removed' in html.lower()

# Meter semantics: level meters remain pre/post Protection; spectrum is final post-effects.
assert 'this.protectionIn.connect(this.preMeterSplitter)' in audio
assert 'this.protectionOut.connect(this.meterSplitter)' in audio
assert 'this.finalOutputSource()' in audio and 'source.connect(this.spectrumAnalyser)' in audio
assert 'safeDisconnect(source, this.spectrumAnalyser)' in audio
assert 'this.spectrumAnalyser.fftSize = 8192' in audio

# Defensive Chrome error-text dependency is explicit and release-gated.
assert 'CHROME-ERROR-TEXT-DEPENDENCY' in capture
assert 'minimum_chrome_version' in (ROOT/'RELEASE_CHECKLIST.md').read_text() and 'tabCapture.getMediaStreamId' in (ROOT/'RELEASE_CHECKLIST.md').read_text()
assert 'EXPECTED_ACTIVE_STREAM_ERRORS' in (ROOT/'tests/capture_manager.test.mjs').read_text()

# Popup modularization and UI surface.
assert len(popup.splitlines()) < 450
for file,klass in [('meter-ui.ts','MeterUI'),('preset-ui.ts','PresetUI'),('eq-ui.ts','EqUI')]: assert f'class {klass}' in (SRC/'popup'/file).read_text()
for id_ in ['stereoButton','pitchButton','reverbButton','autoPanButton','stereoPanel','pitchPanel','reverbPanel','autoPanPanel']: assert f'id="{id_}"' in html,id_
for panel_id in ['stereoPanel','pitchPanel','reverbPanel','autoPanPanel']: assert panel_id in panel
assert 'ResizeObserver' in panel
assert 'onPanelOpen' in panel and 'closeBandEditor' in equi
assert "return 'workspace-page'" in panel
assert 'togglePrimary' in panel and 'toggleEffectsLauncher' in panel and "event.key !== 'Escape'" in panel
assert 'reservesControlStrip' in panel and 'fitAboveControlStrip' in panel and "document.querySelector<HTMLElement>('.control-strip')" in panel
assert 'syncWorkspaceAccessibility' in panel and 'target.inert = workspaceOpen' in panel and "target.setAttribute('aria-hidden', 'true')" in panel
assert 'syncScrollableHint' in panel and 'can-scroll-down' in panel and 'has-expanded-content' in panel
assert 'data-back-effects' in html
assert 'CLIP_HOLD_MS = 1500' in meter and "overHeld ? 'OVER'" in meter
assert '1.9.0 and earlier stored presets in storage.sync' in presetui
assert 'NativeEqResponse' in equi and 'ctx.lineTo(x, totalY)' in equi
assert 'getAppearance: () => EqAppearance' in equi
assert 'appearance.pointSelected' in equi and "(i === 0 || i === S.EQ_BANDS - 1) ? '#a58af5'" not in equi
assert "appearance.pointStyle === 'bands'" in equi
assert 'Presets apply the EQ curve' in html
assert '.module-button' in css
# Themed layout CSS is geometry/skin only: chroma comes from semantic theme tokens.
appearance_layout_css=(ROOT/'static/appearance-layouts.css').read_text()
assert "normalized === 'maximum'" in audio and 'this.setMaximumSafetyEnabled' in audio, 'Maximum post-effects safety topology missing'
assert "new AudioWorkletNode(this.context, 'kopelaeq-true-peak-limiter'" in audio, 'Maximum true-peak limiter node missing'
assert "chrome.runtime.getURL('js/audio/true-peak-limiter-processor.js')" in offscreen and 'ensureMaximumLimiterWorklet' in offscreen, 'Maximum worklet must load lazily from the extension'
assert "registerProcessor('kopelaeq-true-peak-limiter'" in tp_worklet and 'TruePeakLimiterCore' in tp_worklet, 'Maximum worklet wrapper missing'
assert 'class FourXTruePeakDetector' in tp_core and 'lookaheadFrames' in tp_core and 'safetyMarginDb' in tp_core and 'holdFrames' in tp_core, 'Maximum true-peak/lookahead peak-catcher core missing'
assert 'MAXIMUM_POST_EFFECTS_HEADROOM_DB' not in audio and 'MAXIMUM_FINAL_LIMITER' not in audio, 'old two-compressor Maximum path returned'
assert not (SRC/'audio/maximum-auto-headroom.ts').exists() and 'maximumAutoHeadroomDb' not in audio, 'rejected fixed Auto Headroom experiment returned'
assert 'maximumHeadroomDb' not in types and 'maximumHeadroomValue' not in html, 'Maximum must not expose fixed headroom attenuation'
assert "maximum: Object.freeze({ threshold: -0.15, knee: 0.2, ratio: 20, attack: 0.001, release: 0.05 })" in constants, 'Maximum primary stage must equal Strong; extra safety belongs to post-effects catcher'
assert 'repeat(5,minmax(0,1fr))' in appearance_layout_css, 'Protection selector must expose all five modes in one row'
assert 'protectionModeHint' in html and 'strong-note' not in html, 'Protection panel must use one compact contextual hint instead of the old long note'
assert len(appearance_layout_css.splitlines()) < 1800, 'appearance-layouts.css patch stack grew again'
assert not re.search(r'/\* (?:v10|v11|v13|1\.23\.(?:6|8|9|10|11|12|13|14))\b', appearance_layout_css), 'superseded themed patch block returned'
assert not re.search(r'#[0-9a-fA-F]{3,8}\b', appearance_layout_css), 'raw theme color leaked into appearance-layouts.css'
assert 'reference-polish.css' not in html
assert 'placeholder' not in (ROOT/'src/popup/appearance/artwork-assets.ts').read_text(), 'placeholder artwork id returned'
run_qa=(ROOT/'scripts/run_qa.sh').read_text()
assert 'pitch_shift_browser.py' in run_qa, 'Pitch browser capability probe fell out of release QA'
assert 'run_browser_qa.py' not in run_qa, 'obsolete browser QA wrapper returned'
assert '#effectsPanel > .floating-body > .panel-note' not in appearance_layout_css, 'high-specificity Effects note hide rule returned'
assert 'delayButton' not in html and 'exciterButton' not in html
assert 'delayPanel' not in html and 'exciterPanel' not in html
assert 'export function normalizeDelay' in state and 'export function normalizeExciter' in state
for block_name in ['normalizeDelay', 'normalizeExciter']:
    block = state.split(f'export function {block_name}', 1)[1].split('export function', 1)[0]
    assert 'enabled: false' in block

# Preset state remains EQ-focused; new effect states are independent.
assert 'audioStateToPreset' in presets and 'presetToAudioState' in presets
for field,normalizer in [('stereo','normalizeStereo'),('reverb','normalizeReverb'),('delay','normalizeDelay'),('autoPan','normalizeAutoPan'),('exciter','normalizeExciter'),('pitchShift','normalizePitchShift')]: assert f'state.{field} = {normalizer}(null)' in presets
assert "'stereo' in preset" not in presets

# Custom theme import is a production feature, not dead test-only code.
appearance_service=(ROOT/'src/popup/appearance/appearance-service.ts').read_text()
appearance_surface=(ROOT/'src/popup/appearance/appearance-surface.ts').read_text()
appearance_ui=(ROOT/'src/popup/appearance/appearance-ui.ts').read_text()
appearance_bootstrap=(ROOT/'static/appearance-bootstrap.js').read_text()
assert "import('./theme-validator.js')" in appearance_service and 'validateThemeDefinition' in appearance_service
assert 'STORAGE.CUSTOM_THEMES' in appearance_service and 'importTheme(' in appearance_service and 'removeCustomTheme(' in appearance_service
assert 'exportCustomTheme(' in appearance_service and 'exportCurrentLook(' in appearance_service
assert "assignLayer('main'" in appearance_surface and "assignLayer('eq'" in appearance_surface and "assignLayer('cards'" in appearance_surface and "assignLayer('tools'" in appearance_surface and "assignLayer('controls'" in appearance_surface
assert 'themeImportFile' in appearance_ui and 'appearanceCustomThemeOptions' in appearance_ui
artwork_store=(ROOT/'src/popup/appearance/artwork-store.ts').read_text()
appearance_media_db=(ROOT/'src/shared/appearance-media-db.ts').read_text()
assert 'openAppearanceDb' in artwork_store and 'indexedDB.open' in appearance_media_db and 'MAX_USER_ARTWORK_BYTES = 12 * 1024 * 1024' in artwork_store
assert 'chrome.storage' not in artwork_store, 'binary artwork must not be pushed into chrome.storage'
assert 'detectArtworkMime' in artwork_store and "'image/gif'" in artwork_store and "'image/webp'" in artwork_store
assert 'artworkFile' in appearance_ui and 'setUserArtwork(' in appearance_service and 'removeUserArtwork(' in appearance_service
assert 'id="artworkFile"' in html and 'data-artwork-fit="cover"' in html and 'data-artwork-fit="contain"' in html
assert 'BackgroundStore' in artwork_store and "BACKGROUND_STORE_NAME = 'background'" in appearance_media_db
assert 'backgroundFile' in appearance_ui and 'setUserBackground(' in appearance_service and 'removeUserBackground(' in appearance_service
assert 'id="backgroundFile"' in html and 'data-background-fit="cover"' in html and 'data-background-fit="contain"' in html
assert '--artwork-card-image' in appearance_layout_css and 'var(--artwork-card-size' in appearance_layout_css
assert '--artwork-background-size' in appearance_layout_css and 'var(--artwork-background-position' in appearance_layout_css
assert 'cssVars' not in appearance_bootstrap, 'custom CSS returned to first-paint bootstrap'
assert '120' in appearance_bootstrap and "classList.remove('appearance-loading')" in appearance_bootstrap, 'popup reveal watchdog missing'
background=(ROOT/'src/background/index.ts').read_text()
assert 'normalizeDynamics({ ...next.dynamics, enabled: false })' in background, 'baseline v4 Dynamics migration must normalize after forcing disabled'

assert 'recoverToRice()' in appearance_service and 'resolvedSurfaceDefaults' in appearance_service and 'resolvedSurfaceDefaults' in appearance_surface, 'appearance startup fallback missing'

assert 'appearanceTabs' in appearance_ui and 'selectTab(' in appearance_ui and 'eqSurfaceOpacity' in appearance_ui and 'controlsSurfaceOpacity' in appearance_ui
assert 'id="exportCurrentLookButton"' in html and 'id="backgroundDim"' in html and 'id="accentColor"' in html
assert '--cards-surface-color' in appearance_layout_css and '--controls-surface-color' in appearance_layout_css
assert "'--eq-surface-color'" in appearance_service and 'surfaceOpacity' in equi, 'EQ surface customization must reach the canvas renderer'
assert 'queueSurfacePreview' in appearance_ui and 'commitSurfaceAppearance' in appearance_ui and 'previewSurfaceAppearance' in appearance_service, 'surface live-preview batching missing'

# 1.27 Appearance editor/startup performance contracts.
assert "import('./appearance/appearance-ui.js')" in popup, 'Appearance editor must stay lazy-loaded'
assert '__KopelaAppearanceUiCtor' in popup, 'visual QA hook for lazy Appearance editor missing'
assert 'data-appearance-tab="theme"' in html and 'data-appearance-tab="media"' in html and 'data-appearance-tab="surfaces"' in html and 'data-appearance-tab="advanced"' in html
assert "panel.id === 'appearancePanel') return 'appearance-inspector'" in panel, 'Appearance must use side-inspector presentation'
assert 'root.dataset.appearanceInspector' in panel and 'shell.inert = appearanceInspectorOpen' in panel, 'Appearance inspector preview accessibility contract missing'
assert 'deferUserMediaRefresh' in appearance_service and 'refreshUserMediaForCurrentTheme' in appearance_service, 'IndexedDB media must be deferred and batched'
assert 'effectiveSurfaceBlur' in appearance_service and 'Math.min(value, 6)' in appearance_service, 'animated GIF background blur cap missing from full/live apply'
assert 'readPresetSource' in presetui and 'presetStoreAuthoritative' in presetui and 'ensurePresetStoreAuthoritative' in presetui, 'preset authoritative-read guard missing'
assert 'Promise.all([appearanceLoad, localLoad, tabLoad])' in popup, 'independent startup reads must run in parallel'

# 1.28 startup/media contracts: bundled portrait behaves like an already-loaded
# Rice artwork without copying/decoding a Blob on the popup critical path.
preloaded_media=(ROOT/'src/background/preloaded-media.ts').read_text()
assert (ROOT/'static/artwork/rice-preloaded-user.jpg').exists(), 'preloaded Rice portrait asset missing'
assert (ROOT/'static/artwork/rice-preloaded-user.jpg').stat().st_size < 100_000, 'preloaded portrait should stay lightweight'
assert 'PRELOADED_MEDIA_VERSION' in preloaded_media and "'preloaded-cover'" in preloaded_media
assert 'fetch(' not in preloaded_media and 'indexedDB' not in preloaded_media, 'preload migration must remain metadata-only'
assert 'STORAGE.MEDIA_HINTS' in appearance_service and 'preloadedArtworkActive' in appearance_service
assert "import('./artwork-store.js')" in appearance_service, 'IndexedDB media module must remain lazy-loaded'
assert "import('./theme-validator.js')" in appearance_service, 'custom-theme validator must remain lazy-loaded'
assert "from './artwork-store.js'" not in '\n'.join(line for line in appearance_service.splitlines() if not line.startswith('import type')), 'artwork store returned to eager startup imports'
assert 'void refreshCaptureStatus().catch' in popup and 'void presetLoad.then' in popup, 'capture/preset enrichment must not block first interaction'


# 1.28.1/1.28.2 adversarial hardening contracts.
assert 'storageGetBounded' in appearance_service and 'APPEARANCE_STORAGE_TIMEOUT_MS' in appearance_service, 'appearance startup storage timeout missing'
assert 'ensureCustomThemesLoaded' in appearance_service and 'STORAGE.CUSTOM_THEMES' in appearance_service, 'lazy custom theme library missing'
assert 'enqueueArtworkMutation' in appearance_service and 'enqueueBackgroundMutation' in appearance_service, 'media mutations are not serialized'
assert 'cancelIdleCallback' in appearance_service and 'mediaRefreshGeneration' in appearance_service, 'deferred media cancellation/generation guard missing'
assert 'backgroundHintKey' in appearance_service and 'customMediaHint' in appearance_service, 'background/media fit hints missing'
assert 'transactionDone' in appearance_media_db and 'await done' in artwork_store, 'IndexedDB writes must wait for transaction commit'
assert 'async setFit(' not in artwork_store, 'large media fit changes must stay metadata-only, not rewrite IndexedDB Blobs'
assert 'selectedPresetMutation' in background and 'mutateSelectedPresetMap' in background, 'selected preset read-modify-write serialization missing'
assert 'STARTUP_IO_TIMEOUT_MS' in popup and "bounded(chrome.tabs.query" in popup, 'popup Chrome API startup timeout missing'
assert 'PRESET_STORAGE_TIMEOUT_MS' in presetui, 'preset storage timeout missing'
assert 'deadlineMisses' in (ROOT/'tests/pitch_shift_perf.test.mjs').read_text() and 'p99' in (ROOT/'tests/pitch_shift_perf.test.mjs').read_text(), 'Pitch perf rare-outlier coverage missing'
assert (ROOT/'tests/selected_preset_concurrency.test.mjs').exists(), 'preset concurrency regression test missing'
assert (ROOT/'tests/appearance_media_race.test.mjs').exists(), 'media theme-switch race regression test missing'
assert (ROOT/'scripts/build_handoff.py').exists() and 'build_handoff.py' in (ROOT/'scripts/release.sh').read_text(), 'clean handoff bundle builder missing'

# 1.28.2 data-integrity/lifecycle contracts.
bounded=(ROOT/'src/shared/bounded.ts').read_text()
capture=(ROOT/'src/background/capture-manager.ts').read_text()
theme_registry=(ROOT/'src/popup/appearance/theme-registry.ts').read_text()
assert "status: 'timeout'" in bounded and "status: 'error'" in bounded, 'bounded reads must distinguish timeout/error from success'
assert 'surfaceOverridesAuthoritative' in appearance_service and 'mediaHintsAuthoritative' in appearance_service and 'customThemesAuthoritative' in appearance_service, 'appearance whole-map authority guards missing'
assert 'writeMediaJournal' in appearance_service and 'recoverMediaJournal' in appearance_service and 'clearMediaJournal' in appearance_service, 'recoverable two-phase media journal missing'
assert 'MAX_USER_IMAGE_WIDTH = 4096' in artwork_store and 'MAX_USER_IMAGE_PIXELS' in artwork_store and 'MAX_USER_GIF_FRAMES = 400' in artwork_store, 'uploaded media geometry/frame limits missing'
assert 'onversionchange' in appearance_media_db and '.close()' in appearance_media_db, 'IndexedDB versionchange lifecycle missing'
assert 'queryOffscreenStatusConfirmed' in capture and 'capturedTabsReliable' in capture, 'capture reconciliation confirmation probes missing'
assert 'for (const candidate of this.listCustom())' in theme_registry, 'custom theme descendant revalidation missing'
assert (ROOT/'tests/storage_timeout_integrity.test.mjs').exists(), 'storage timeout integrity regression test missing'
assert (ROOT/'tests/media_limits.test.mjs').exists(), 'media limits regression test missing'
assert (ROOT/'scripts/run_ui_qa_isolated.py').exists() and 'run_ui_qa_isolated.py' in (ROOT/'scripts/run_qa.sh').read_text(), 'isolated UI QA process-group runner missing'
run_qa=(ROOT/'scripts/run_qa.sh').read_text()
assert 'timeout -k 2s 8s node --check' in run_qa and 'timeout -k 3s 90s node --test' in run_qa, 'JS syntax/test gates must be bounded so the release pipeline cannot hang indefinitely'
ui_qa=(ROOT/'qa/run_ui_qa.py').read_text()
assert "JS/'shared/bounded.js'" in ui_qa, 'UI QA harness must inline the tri-state bounded helper used by production startup'
assert "JS/'shared/latest-wins.js'" in ui_qa, 'UI QA harness must inline the latest-wins helper used by production Appearance startup'


# 1.28.3 fixed-geometry visual hardening.
appearance_css=(ROOT/'static'/'appearance-layouts.css').read_text()
assert '.preset-picker-button > strong' in appearance_css and 'text-overflow:ellipsis' in appearance_css, 'preset picker text must ellipsize inside its real control'
assert 'scrollbar-gutter:stable' in appearance_css, 'Appearance inspector must reserve a visible scroll gutter'
assert 'width:32px' in appearance_css, 'small icon controls must keep a usable 32px hit target'
registry_src=(ROOT/'src'/'popup'/'appearance'/'theme-registry.ts').read_text()
assert 'assertLayoutSafeResolvedTheme' in registry_src and 'LAYOUT_SAFE_TYPE_PX' in registry_src, 'custom themes must be checked against fixed popup geometry'

# 1.28.4 performance/readability hardening.
assert 'new LegacyDownPitchShifter' not in pitch_latency and 'Float32Array' not in pitch_latency, 'Pitch latency helper must remain allocation-free'
assert "pitch-shift-core.js" not in audio, 'AudioSession must not eagerly import Pitch core for a dead latency getter'
assert "from '../audio/pitch-latency.js'" in popup and "from '../audio/pitch-shift-core.js'" not in popup, 'popup latency readout must not import the full realtime Pitch processor'
assert 'pollInFlight' in meter and 'if (this.pollInFlight) return' in meter, 'Meter polling must stay single-flight'
assert 'type ControlSyncGroup' in popup and "sendStateRealtime(persist, ['bandEditor'])" in popup, 'EQ drag must not resync the entire popup'
assert (SRC/'popup/popup-elements.ts').exists() and 'collectPopupElements' in popup, 'popup DOM must stay typed through PopupElements'
assert not (ROOT/'qa/debug_ui_qa.py').exists(), 'stale debug UI QA copy must not return'
assert not (ROOT/'scripts/build-fallback.mjs').exists(), 'obsolete build fallback wrapper must not return'
tsconfig=json.loads((ROOT/'tsconfig.json').read_text())
assert tsconfig['compilerOptions'].get('noUnusedLocals') is True and tsconfig['compilerOptions'].get('noUnusedParameters') is True, 'normal typecheck must reject unused locals/parameters'
assert "JS/'popup/popup-elements.js'" in ui_qa, 'UI QA harness must inline typed popup element collection used by production startup'
assert "JS/'popup/appearance/appearance-surface.js'" in ui_qa, 'UI QA harness must inline appearance surface helpers used by production startup'
popup_css=(ROOT/'static/popup.css').read_text()
assert len(re.findall(r'^\.band-inspector \{', popup_css, re.M)) == 1, 'generic Band Inspector cascade must stay consolidated'
assert '1.23.12 — easier EQ point editing' not in popup_css and '1.23.13 final touch targets' not in popup_css, 'historical Band Inspector patch stack returned'
assert (ROOT/'tests/meter_ui_single_flight.test.mjs').exists(), 'Meter single-flight regression test missing'

# 1.28.5+ async/concurrency hardening.
latest_wins=(SRC/'shared/latest-wins.ts').read_text()
assert 'class LatestWinsWriter' in latest_wins and 'pending' in latest_wins, 'latest-wins primitive missing'
assert 'stateStorageWriter' in bg and 'protectionStorageWriter' in bg and 'stateAuthoritative' in bg, 'background authoritative state pipeline missing'
assert 'propagateStateToAll' in capture and 'offscreenLifecycle' in capture and 'desiredTabs' in capture, 'global offscreen/state lifecycle hardening missing'
assert 'stateRevision' in offscreen and 'sessionStateRevision' in offscreen and 'sessionStateRequestRevision' in offscreen and 'globalStateRevision' in offscreen, 'offscreen stale-state generation guards missing'
assert 'globalStateRevision + 1' not in offscreen.split('async function startSession', 1)[1].split('function stopSession', 1)[0], 'CaptureStart must require explicit revisions instead of fallback synthesis'
assert 'stateIntentGeneration' in popup and 'captureStatusGeneration' in popup and 'fireAndReport' in popup, 'popup stale-response/unhandled rejection guards missing'
assert 'stateReadyForInput' in popup and 'protectionReadyForInput' in popup and 'Loading saved audio settings' in popup, 'popup must not persist temporary startup fallbacks'
assert 'rebaseStateRevision' in capture and 'rebaseProtectionRevision' in capture, 'MV3 worker restart revision rebase missing'
assert 'appearanceWriter' in appearance_service and 'appearanceRevision' in appearance_service, 'appearance latest-wins persistence missing'
assert 'MEDIA_ARTWORK_JOURNAL' in constants and 'MEDIA_BACKGROUND_JOURNAL' in constants, 'media crash-recovery journal keys missing'
assert (SRC/'audio/pitch-worklet-processor.ts').exists() and not (SRC/'audio/pitch-worklet-processor.js').exists(), 'AudioWorklet source must be TypeScript'
assert (ROOT/'tests/latest_wins.test.mjs').exists(), 'latest-wins adversarial regression test missing'
assert (ROOT/'tests/background_concurrency.test.mjs').exists(), 'background concurrency regression test missing'
assert (ROOT/'tests/background_startup_authority.test.mjs').exists() and (ROOT/'tests/background_startup_stale_response.test.mjs').exists(), 'background startup authority/generation regression tests missing'
assert (ROOT/'tests/offscreen_state_generation.test.mjs').exists(), 'offscreen stale-response generation test missing'
assert (ROOT/'tests/background_restart_revision.test.mjs').exists(), 'MV3 restart revision regression test missing'
assert (ROOT/'tests/offscreen_pitch_retry.test.mjs').exists(), 'Pitch cold-load retry regression test missing'
assert (ROOT/'tests/offscreen_output_recovery.test.mjs').exists(), 'Audio output resume/fail-safe regression test missing'
assert (ROOT/'tests/appearance_concurrency.test.mjs').exists(), 'appearance latest-wins regression test missing'
assert (ROOT/'tests/appearance_media_journal.test.mjs').exists(), 'media transaction journal regression test missing'
assert (ROOT/'tests/pitch_worklet_wrapper.test.mjs').exists(), 'typed AudioWorklet wrapper integration test missing'

print(f'static_check.py: PASS ({len(js_files)} emitted JS modules, popup index {len(popup.splitlines())} lines)')
