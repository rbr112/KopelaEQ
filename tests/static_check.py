from pathlib import Path
import json, re
ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'extension'; SRC=ROOT/'src'
manifest=json.loads((EXT/'manifest.json').read_text())
pkg=json.loads((ROOT/'package.json').read_text())
assert manifest['manifest_version']==3
assert manifest['version']==pkg['version']
assert manifest['minimum_chrome_version']=='116'
assert set(manifest['permissions'])=={'activeTab','tabCapture','offscreen','storage'}
assert 'host_permissions' not in manifest
assert manifest['background']=={'service_worker':'js/background/index.js','type':'module'}
assert manifest['content_security_policy']['extension_pages']=="script-src 'self'; object-src 'self'"
assert 'scripting' not in manifest['permissions']
privacy=(ROOT/'PRIVACY.md').read_text()
assert 'Page Workspace' not in privacy and '`scripting` permission' in privacy and 'requests no host permissions' in privacy

js_files=list((EXT/'js').rglob('*.js'))
assert len(js_files)>=10
all_js='\n'.join(p.read_text() for p in js_files)
for bad in [r'\beval\s*\(',r'new\s+Function\s*\(',r'XMLHttpRequest',r'WebSocket\s*\(',r'fetch\s*\(']:
    assert not re.search(bad,all_js),bad
assert 'http://' not in all_js and 'https://' not in all_js

constants=(SRC/'shared/constants.ts').read_text()
state=(SRC/'shared/state.ts').read_text()
presets=(SRC/'shared/presets.ts').read_text()
messages=(SRC/'shared/messages.ts').read_text()
audio=(SRC/'audio/audio-session.ts').read_text()
bypass=(SRC/'audio/bypass-gate.ts').read_text()
eqresp=(SRC/'audio/eq-response.ts').read_text()
capture=(SRC/'background/capture-manager.ts').read_text()
bg=(SRC/'background/index.ts').read_text()
offscreen=(SRC/'offscreen/index.ts').read_text()
popup=(SRC/'popup/index.ts').read_text()
html=(EXT/'popup.html').read_text(); css=(EXT/'popup.css').read_text(); defaults=(SRC/'shared/default-presets.ts').read_text()

# TS/module architecture and runtime message boundary.
assert (ROOT/'tsconfig.json').exists() and (ROOT/'package.json').exists() and (ROOT/'scripts/build.mjs').exists()
assert pkg['devDependencies']=={'typescript':'5.8.3'}
assert (ROOT/'scripts/release.sh').exists() and (ROOT/'scripts/verify_release.py').exists()
globals_ts=(SRC/'types/globals.d.ts').read_text()
assert 'declare const chrome: any' not in globals_ts and 'interface ChromeNamespace' in globals_ts
assert 'export const MessageType' in messages and 'export type BackgroundMessage' in messages and 'export type OffscreenMessage' in messages
assert 'parseBackgroundMessage(input: unknown)' in messages and 'parseOffscreenMessage(input: unknown)' in messages and 'assertNever' in messages
assert "input.persist !== undefined && typeof input.persist !== 'boolean'" in messages
assert "Object.prototype.hasOwnProperty.call(input, 'state')" in messages
assert "Object.prototype.hasOwnProperty.call(input, 'protection')" in messages
assert 'parseBackgroundMessage(rawMessage)' in bg and 'assertNever(message)' in bg
assert 'parseOffscreenMessage(rawMessage)' in offscreen and 'assertNever(message)' in offscreen
assert "type: 'module'" not in (ROOT/'static/manifest.json').read_text() or manifest['background']['type']=='module'

# Legacy Ears EQ topology / presets remain the semantic source of truth.
assert "'lowshelf'" in constants and "'highshelf'" in constants and 'EQ_TYPES' in constants
assert 'filter.type = EQ_TYPES[index]' in audio
assert 'getFrequencyResponse' in eqresp and 'Math.cos' not in popup and 'Math.sin' not in popup
assert 'FREQ_MIN = 5' in constants and 'FREQ_MAX = 20000' in constants
assert 'Vivid (111)' in defaults and 'Bass Punch (bass2)' in defaults and 'Bass Heavy (bass4)' in defaults

# Single AudioSession graph + shared BypassGate; no hidden Stereo/WaveShaper path.
assert "new AudioContext({ latencyHint: 'playback' })" in offscreen
for needle in ['this.source.connect(this.inputGain)','node.connect(this.masterGain)','this.masterGain.connect(this.dynamicsIn)','this.dynamicsIn.connect(this.dynamicsDry)','this.dynamicsOut.connect(this.protectionIn)','this.protectionIn.connect(this.protectionDry)','this.protectionOut.connect(this.context.destination)']:
    assert needle in audio, needle
assert 'new BypassGate' in audio and 'this.dynamicsGate.dispose()' in audio and 'this.protectionGate.dispose()' in audio
assert 'processor.connectInput()' in bypass and 'processor.disconnectInput()' in bypass and 'refresh(immediate = false)' in bypass
assert 'dynamicsTransition' not in audio and 'protectionTransition' not in audio
assert 'stereoIn' not in audio and 'stereoOut' not in audio and 'createWaveShaper' not in audio and 'createStereoPanner' not in audio
assert 'export function normalizeStereo' in state

# Native visualization context tracks real engine sample rate and Nyquist.
assert 'new OfflineAudioContext(1, 1, normalized)' in eqresp
assert 'value <= nyquist ? value : NaN' in eqresp
assert 'combined[i] *= mag' in eqresp
assert 'setEngineSampleRate(result.sampleRate)' in popup
assert 'sampleRate: session ? session.context.sampleRate' in offscreen
assert 'sampleRate: remote && Number.isFinite(Number(remote.sampleRate))' in capture

# Meter remains side-chain only.
assert 'ensureMeteringActive' in audio and 'disconnectMetering' in audio
assert 'levelMeteringConnected' in audio and 'spectrumMeteringConnected' in audio
assert 'this.protectionIn.connect(this.preMeterSplitter)' in audio and 'safeDisconnect(this.protectionIn, this.preMeterSplitter)' in audio
assert 'this.protectionOut.connect(this.spectrumAnalyser)' in audio and 'safeDisconnect(this.protectionOut, this.spectrumAnalyser)' in audio
assert 'this.spectrumAnalyser.fftSize = 8192' in audio and 'this.spectrumAnalyser.maxDecibels = 0' in audio
assert "mode === 'fast' ? 0.15" in audio and "mode === 'smooth' ? 0.82" in audio

# Capture manager explicit state machine and active-stream race protection.
assert "export type CapturePhase = 'idle' | 'starting' | 'active' | 'stopping'" in capture
assert 'tabQueues' in capture and 'tabPhases' in capture and 'enqueueTabOperation' in capture
assert 'chrome.tabCapture.getCapturedTabs' in capture and 'waitForCaptureRelease' in capture and 'getStreamIdSafely' in capture
assert 'Previous audio session is still stopping' in capture
assert 'Cannot capture a tab with an active stream' not in popup
assert 'pendingSessions' in offscreen and 'pendingTabs: [...pendingSessions.keys()]' in offscreen

# UI/interaction baseline remains; 1.22 adds release/privacy hardening only.
assert '<script type="module" src="js/popup/index.js"></script>' in html
assert 'Audio stays on this device' in html and 'aria-live="polite"' in html
assert '<script type="module" src="js/offscreen/index.js"></script>' in (EXT/'offscreen.html').read_text()
assert 'Plugins on Page' not in html and 'stereoButton' not in html and 'stereoPanel' not in html
assert 'preset-chevron' not in html and '<i aria-hidden="true">⌄</i>' not in html
assert '.preset-menu-item' in css and '.preset-chevron' not in css
assert 'bandInspector' in html and 'bandFrequency' in html and 'bandGain' in html and 'bandQ' in html
assert (SRC/'popup/eq-band-editor.ts').exists() and 'class EqBandEditor' in (SRC/'popup/eq-band-editor.ts').read_text()
assert 'wheel changes Q' in html and 'Shelf Q is not used by Web Audio' in html
assert 'saveAsPresetButton' in html and 'updatePresetButton' in html and 'duplicatePresetButton' in html and 'renamePresetButton' in html
assert 'presetEditTargetName' in popup and 'Update selected overwrites that preset' in popup
assert 'ctx.lineTo(x, totalY)' in popup and 'bandEditor?.selectedIndex' in popup
assert 'gain-zero-mark' in html and '.gain-slider::-webkit-slider-thumb' in css
assert 'dynamicsAdvancedToggle' in html and 'Parametric EQ' in html and 'Spectrum' in html
assert 'Presets apply the EQ curve' in html
assert "setStatus('Gain and EQ reset')" in popup
assert 'setInterval(pollMeters, 100)' in popup
assert 'preProtection' in (SRC/'shared/types.ts').read_text() and 'postProtection' in (SRC/'shared/types.ts').read_text()
assert 'preMeterSplitter' in audio and 'postProtection' in audio and 'readStereoMeter' in audio
assert 'Protection working' in popup and 'prePeakHoldDb' in popup and 'postPeakHoldDb' in popup
assert 'CLIP_HOLD_MS = 1500' in popup and "el.textContent = overHeld ? 'OVER' : (near ? 'NEAR' : 'SAFE')" in popup
assert 'class="meter-status"' in html and '.meter-status[data-level="over"]' in css
assert 'spectrumFreezeButton' in html and 'data-spectrum-mode="fast"' in html and 'data-spectrum-mode="smooth"' in html
assert 'SPECTRUM_MODE' in constants and 'spectrumMode' in messages and 'levels?: boolean' in messages
assert 'const needSpectrum = analyzerEnabled && !spectrumFrozen' in popup and 'const needLevels = meterVisible' in popup
assert 'ResizeObserver' in (SRC/'popup/panel-manager.ts').read_text()
assert "const db = Math.max(-100, Math.min(0, lastSpectrum[i]))" in popup
assert "'0 dBFS'" in popup and 'Band ${state.eq.gains[index].toFixed(1)} dB · Total ${totalHere.toFixed(1)} dB' in popup
assert 'presetSelectionDirty' in popup and 'inferPresetFromState' in popup and 'stateMatchesPreset' in popup
assert 'Presets are EQ presets, matching the original Ears behavior' in popup

# Storage and migration boundaries.
assert 'AUDIO_BASELINE_VERSION = 3' in bg and 'audioState.dynamics.enabled = false' in bg and 'audioState.stereo = normalizeStereo(null)' in bg
assert 'SELECTED_PRESETS' in constants and 'PresetSelectionGet' in messages and 'PresetSelectionSet' in messages
assert 'chrome.storage.local.set({ [S.STORAGE.PRESETS]: presets })' in popup
assert 'chrome.storage.sync.set({ [S.STORAGE.PRESETS]: presets })' not in popup
assert '1.9.0 and earlier stored presets in storage.sync' in popup
assert 'normalizePresetName' in presets and 'mergePresetMaps' in presets

print(f'static_check.py: PASS ({len(js_files)} emitted JS modules)')
