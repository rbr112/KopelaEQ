# KopelaEQ 1.28 architecture

## Compatibility boundary

The accepted 1.21.1 EQ response remains the frozen compatibility baseline. The 1.23 DSP line added new graph stages adjacent to that baseline instead of retuning it; 1.24 stabilized popup architecture; 1.25 added validated local custom themes; 1.26 expanded that layer into surface-level customization; 1.27 moved the editor off the startup path; 1.28 adds preloaded local artwork metadata; 1.28.1 hardens startup/media concurrency; 1.28.2 makes timeout fallback non-destructive, bounds capture reconciliation, validates uploaded media geometry, and revalidates custom-theme dependency graphs; 1.28.3 adds fixed-geometry visual guards for user content and custom theme typography/spacing; 1.28.4 hardens popup hot paths and maintainability with allocation-free Pitch latency reporting, single-flight Meter polling, partial control synchronization, typed DOM contracts, reusable EQ response buffers, and a consolidated popup CSS cascade without changing DSP.

The hard invariant for every optional DSP stage is:

> **Disabled means processor input physically disconnected from the graph.**

The implementation uses `BypassGate` to crossfade to the permanent dry branch and then disconnect the processor input. This protects the original `golden-eq-response-1.17.json` fixture from requiring a re-baseline.

Schema and baseline versions for this release:

- `SCHEMA_VERSION = 4`
- `AUDIO_BASELINE_VERSION = 4`

Storage reliability rule introduced in 1.28.2:

> **Timeout/error is uncertain state, never an empty authoritative profile.**

Whole-map writes for presets, custom themes, surface overrides, and media hints require an authoritative read (or a successful retry) first. This prevents a slow Chrome storage response from turning bundled/default fallback data into destructive writes.

The baseline migration explicitly forces all newly introduced processors off for existing users.

## Async state ownership (1.28.5+)

The background service worker is the durable owner of AudioState/Protection persistence. Popup messages describe user intent; background assigns monotonic runtime revisions, collapses queued writes with `LatestWinsWriter`, propagates the same revisions to offscreen sessions, and persists the latest accepted snapshot. Offscreen applies revision guards both before and after asynchronous work so an older request cannot resume after a newer one and overwrite the engine. Startup defaults are explicitly non-authoritative until storage resolves; late startup reads hydrate only slices that have not received newer intent.

Offscreen-document create/close operations share one lifecycle queue and consult the global `desiredTabs` set. Appearance identity uses the same latest-wins idea, while artwork/background cross-store mutations use a recovery journal so IndexedDB and lightweight storage hints converge after interruption. Delay/Exciter remain schema compatibility fields only and have no runtime stages.

## Popup performance and ownership (1.28.4)

- `popup-elements.ts` is the typed boundary for static popup markup. Input/button/canvas/select contracts are verified once during startup instead of being accessed through `Record<string, any>`.
- `popup/index.ts` synchronizes controls by explicit groups. Realtime EQ drag updates the Band Editor/EQ canvas only; Dynamics/Stereo/Effects/Protection DOM is not rewritten on every pointer move.
- `MeterUI` permits one `METER_GET` request at a time and drops responses from an obsolete capture/tab generation.
- `pitch-latency.ts` owns latency constants/arithmetic. The popup imports this tiny module rather than the realtime Pitch processor; `AudioSession` no longer imports Pitch core for an unused latency getter.
- `EqUI` and `NativeEqResponse` reuse frequency/scratch buffers and structured response caches to reduce short-lived allocations during Spectrum/drag redraws.
- Pure surface normalization/export helpers live in `appearance-surface.ts`; `AppearanceService` remains the runtime coordinator for theme/storage/media lifecycle.
- `popup.css` contains one authoritative generic Band Inspector definition. Layout-specific Rice/Nocturne/Classic differences remain in their dedicated selectors rather than historical version-patch blocks.


## Runtime components

- `CaptureManager` owns one serialized capture lifecycle per tab: `idle | starting | active | stopping`.
- The MV3 service worker owns storage/state coordination and tab-capture orchestration.
- The offscreen document owns the persistent `AudioContext`, lazy Pitch worklet registration, and one `AudioSession` per captured tab.
- `AudioSession` owns the Web Audio graph, analyser side chains, smooth parameter application, and disposal.
- `BypassGate` owns click-free dry/wet transitions **and processor-input connection lifecycle**.
- `StereoStage` implements Mid/Side Width, Balance, Mono, and Swap.
- `ReverbStage` and `AutoPanStage` are the public post-Protection creative effects. `DelayStage`/`ExciterStage` remain compatibility-only internals and normalize permanently disabled in 1.23.5.
- `GranularPitchShifter` remains the compatibility wrapper name for the DOM-independent Pitch Down core. Public/state normalization clamps positive shifts to 0; the accepted 1.23.1 negative-shift path handles −1…−12 semitones, and `pitch-worklet-processor.js` is the thin AudioWorklet wrapper.
- Maximum Protection deliberately reuses the exact Strong primary compressor profile. Its only extra DSP is a lazily loaded post-effects true-peak-aware peak catcher before the final output bus. There is no fixed Auto Headroom/pre-attenuation path; below-ceiling material remains unity through the catcher apart from its lookahead delay.
- `NativeEqResponse` uses `BiquadFilterNode.getFrequencyResponse()` for graph visualization.
- Popup orchestration is separated from `EqUI`, `MeterUI`, `PresetUI`, and `PanelManager`.

## Popup workspace model

Classic keeps its floating-panel behavior, including an independent Meter. Rice and Nocturne use the same exclusive themed workspace model: Audio Tools remains persistent, one audio-tool detail at a time replaces the EQ content inside the primary surface, and switching tools closes the previous workspace before activating the next. `Appearance` and `Quick guide` remain utility overlays because they do not edit the audio graph.

`PresetUI` separates a true selected preset from an edited curve that is merely based on a preset. The latter remains an explicit update target but is labeled `Based on preset` so the navigation label can correctly return to `Current settings`.

In 1.24.3, navigation selection and audio-enabled state are intentionally separate UI concepts: `.is-open` marks the one page currently occupying the themed workspace, while `.is-on` only describes DSP state and is communicated through the status pill. While a workspace page is active, the underlying EQ section and status bar are `inert` and `aria-hidden` so invisible controls cannot receive keyboard focus.

The themed CSS layer is consolidated rather than version-patched: the obsolete v10–v13 override stack was removed in 1.24.1 and a static line ceiling prevents it from silently regrowing. Built-in artwork IDs are final semantic assets (`builtin.rice.landscape`, `builtin.nocturne.night`).

## Message trust boundary

Chrome runtime input is treated as `unknown` and parsed before typed exhaustive switches. `state.stereo` remains on the pre-existing background → offscreen → `AudioSession` path; new state fields use the same normalized `AudioState` transport rather than adding ad-hoc message types.

## Capture lifecycle

For each tab, start/stop operations are serialized. Before requesting another stream id, `CaptureManager` checks both the offscreen session state and `chrome.tabCapture.getCapturedTabs()`.

The recovery matcher for Chromium's active-capture error text is intentionally marked `CHROME-ERROR-TEXT-DEPENDENCY`. The exact expected messages are pinned in `tests/capture_manager.test.mjs`, and `RELEASE_CHECKLIST.md` requires a manual verification whenever `minimum_chrome_version` changes.

Chrome 116 remains the minimum supported version for the service-worker-to-offscreen tab-capture flow used by the extension.

## Audio graph

```text
Tab MediaStream
  -> input Gain
  -> Low Shelf
  -> 9 x Peak
  -> High Shelf
  -> master Gain
  -> Pitch [dry | AudioWorklet]
  -> Dynamics [dry | compressor]
  -> Stereo [dry | Mid/Side processor]
  -> Protection [dry | limiter/protection]
  -> Reverb [dry | convolver]
  -> Delay [dry | delay + feedback]
  -> AutoPan [dry | StereoPanner + LFO]
  -> Exciter [dry | HPF + WaveShaper side branch]
  -> AudioContext.destination
```

### Pitch

Insertion point:

`masterGain -> pitch -> dynamicsIn`

The offscreen runtime calls `audioWorklet.addModule(chrome.runtime.getURL(...))` only when Pitch is enabled with a non-zero shift. `AudioSession` creates the `AudioWorkletNode` after registration and controls its `semitones` AudioParam with the project's normal smooth-parameter path.

A zero-semitone request remains on the physical dry path even if the UI enable toggle is on.

For 1.23.5 Pitch is deliberately down-only. The accepted 1.23.1 two-head delay-line path is retained for −1…−12 semitones. Positive values normalize to 0 and the AudioWorklet parameter has `maxValue: 0`, so no upward-pitch processor path exists. Modeled latency remains about 48 ms at 48 kHz.

### Stereo

Insertion point:

`dynamicsOut -> stereo -> protectionIn`

Wet topology:

```text
Splitter L/R
  Mid  = (L + R) * 0.5
  Side = (L - R) * 0.5
  Side *= effectiveWidth
  L' = Mid + Side
  R' = Mid - Side
  -> per-channel balance gain
  -> optional L/R merger swap
```

`mono=true` forces effective width to zero while preserving the stored Width slider value for later restoration. The exact neutral combination (`width=1`, centered balance, mono off, swap off) also stays physically dry.

### Post-Protection effects

Reverb, Delay, AutoPan, and Exciter remain serial graph stages after Protection for compatibility. Delay and Exciter normalize permanently disabled in 1.23.5 and have no public controls; their processor inputs therefore stay physically disconnected. Reverb and AutoPan remain public effects.

Reverb uses deterministic locally generated Room/Hall/Plate impulse responses and therefore introduces no remote asset or third-party sample dependency.

AutoPan's oscillator is created and started only while its processor branch is connected; bypass disposal stops the oscillator instead of leaving a permanent LFO running.

## Meter/Spectrum topology

The Protection meters keep their existing semantics:

```text
StereoOut / ProtectionIn ---> Pre L/R analyser side-chain
               |
          Protection
               |
ProtectionOut -------------> Post L/R analyser side-chain
               |
         post effects
               |
Final effects output ------> Spectrum analyser side-chain
               |
          Destination
```

The analyser branches never reconnect to the audible graph. Unused branches disconnect after their idle timeout.

## State / migration model

Every numeric DSP field is normalized and clamped in `src/shared/state.ts`.

On a profile with a baseline older than v4, the service worker writes normalized state with these `enabled` flags forced false:

- Pitch
- Dynamics
- Stereo
- Reverb
- Delay
- AutoPan
- Exciter

This avoids an upgrade unexpectedly changing sound even if stale/unknown saved values exist.

## Appearance / custom themes

Built-in Rice and Nocturne themes are registered at startup. The custom-theme library is lazy for built-in users: `kopelaeq.customThemes` is read/validated only when Appearance opens, unless the currently selected theme itself is custom and must be resolved during startup. User themes are validated by `validateThemeDefinition`; UI/surface colors use the same `#RRGGBB` contract as the runtime color controls. Custom themes may extend a built-in theme or another valid imported theme; unknown packaged artwork ids, remote URLs and executable CSS are rejected. Removing the active custom theme falls back to Rice.

User media overrides are stored per theme in extension IndexedDB rather than `chrome.storage`. `ArtworkStore` uses the `artwork` object store for the square Rice artwork card, while `BackgroundStore` uses the `background` object store for the full popup backdrop. Both accept signature-validated PNG/JPEG/WebP/GIF blobs up to 12 MB and expose only short-lived `blob:` URLs. Lightweight `kopelaeq.mediaHints` records whether each slot is custom/preloaded/empty and stores Cover/Contain metadata, so ordinary opens skip IndexedDB when no Blob is needed and fit changes do not rewrite a large Blob. Media mutations capture the originating theme, are serialized per slot, and UI installation is generation-guarded across theme switches. IndexedDB writes wait for transaction completion, not only request success.

## Build/release model

`static/` is the non-code extension shell. `src/` TypeScript compiles to browser-native ESM in `extension/js/`. The plain-JS `pitch-worklet-processor.js` is copied alongside its compiled TypeScript DSP core.

Release ZIPs are deterministic: sorted order, fixed timestamps, normalized file modes, regenerated SHA-256 hashes, and archive policy verification. Source/tests/scripts do not enter the Chrome Web Store ZIP.

## Appearance surface overrides

1.26.1 generalizes visual overrides into layer-based surface tokens: `surface.main`, `surface.eq`, `surface.cards`, `surface.tools`, and `surface.controls` each accept `{color,opacity}` and are inherited/validated like the rest of a theme. `kopelaeq.surfaceOverrides` remains the per-theme local override layer and can additionally override accent/border/text colors, border intensity, blur, shadow, window/panel/control radius and background dimming. Reset removes the local layer and returns to resolved JSON defaults. Export selected materializes overrides into a custom theme; Export current look produces a standalone resolved theme JSON. These values are visual-only and never affect DSP or audio state.


1.26.1 performance note: Live Appearance previews are frame-coalesced and update only affected CSS variables. Dragging a slider does not write to `chrome.storage.local`; the final `change` event commits once. EQ-only visual changes schedule the canvas renderer, while Main/Cards/Tools/Controls changes do not redraw the canvas. The EQ surface color/opacity is rendered by the canvas itself so transparency reveals the user background exactly once rather than stacking two translucent layers.

Visual overrides also expose Accent 2/Positive/Danger/EQ curve colors. Export materializes those values back to `tokens.colors.accentAlt`, `tokens.colors.positive`, `tokens.colors.danger`, and `tokens.eq.curve`, preserving JSON round-trip behavior.


## Startup / adversarial hardening

Popup startup reads appearance identity, audio settings and active-tab metadata in parallel. Storage/tab reads are time-bounded so a stalled Chrome API cannot leave the popup permanently uninitialized. Capture status and selected-preset restoration enrich an already interactive UI and are no longer first-interaction gates. `PresetUI` bounds legacy storage migration reads/writes. Per-tab selected-preset read/modify/write operations in the service worker run through a serialized mutation queue to prevent lost updates from multiple popup contexts.
