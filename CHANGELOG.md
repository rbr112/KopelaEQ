# Changelog

## 1.28.15

- Remove the experimental Maximum Auto Headroom/pre-attenuation path entirely; Maximum no longer lowers the whole signal just because Gain/EQ is boosted.
- Make Maximum's primary Protection stage identical to Strong, so the only extra processing is the final post-effects true-peak peak catcher.
- Retune the final catcher to a −1.25 dBTP target, ~5 ms lookahead, 6 ms transient hold and ~80 ms release for peak-only intervention without rapid gain bounce.
- Add a sub-ceiling unity regression proving Maximum has no fixed gain cut, plus an isolated-transient recovery regression.
- Simplify Maximum telemetry to final True Peak and Peak Catch reduction; remove obsolete Headroom UI/state.
- Node regression suites are 42/42 PASS; frozen EQ and non-Maximum dry paths remain unchanged.

## 1.28.14

- Make Maximum materially more conservative with predictive **Auto Headroom** before EQ: positive Master Gain and the strongest positive EQ boosts produce up to 6 dB of smooth pre-attenuation.
- Keep Auto Headroom deterministic from user settings rather than program loudness, avoiding AGC-style pumping; Strong/Medium/Light/Off remain unity on this input stage.
- Keep Maximum's post-effects true-peak-aware lookahead worklet from 1.28.13 as the final safety stage.
- Expose Maximum telemetry in the Protection panel: current Auto Headroom, final true peak and final-limiter gain reduction.
- Include Auto Headroom in total Protection gain-reduction telemetry so the UI reflects the complete Maximum attenuation.
- Add dedicated Auto Headroom regressions and extend Maximum topology/telemetry coverage; Node suites are now 43/43 PASS.

## 1.28.13

- Replace Maximum's second `DynamicsCompressorNode` with a dedicated post-effects `AudioWorklet` limiter; Strong remains the unchanged default/recommended mode.
- Add stereo-linked 4× polyphase true-peak detection that catches inter-sample peaks the raw sample stream can miss.
- Add ~4 ms lookahead, conservative −1 dBTP target with 0.35 dB internal margin, linked emergency sample ceiling, and post-limit true-peak feedback.
- Keep the Maximum worklet physically disconnected in Strong/Medium/Light/Off; live Strong → Maximum switching warms the lookahead buffer before crossfade to avoid a short dropout.
- Make Maximum worklet loading retryable and revision-guarded; a failed load no longer advertises/persists Maximum as if the runtime accepted it.
- Add independent 16×/64-tap reconstruction tests, hidden inter-sample peak regression, stereo-link tests, failure/retry tests, and a broad CPU regression gate; Node suites are now 42/42 PASS.

## 1.28.11

- Added a new **Maximum** Protection mode above Strong for extra peak headroom.
- **Strong remains the default and recommended Protection mode**; existing saved settings and fallback behavior are unchanged.
- Maximum uses the same compressor-only protection path, with an earlier threshold and faster attack than Strong.


## 1.28.10

- Require the offscreen Web Audio output context to be truly `running` before a tab capture is reported as active; a suspended output can no longer leave Chrome suppressing the tab's native audio while KopelaEQ outputs silence.
- Retry `AudioContext.resume()` across the cold-capture transition, including a strict post-`getUserMedia` check after Chromium has granted the active capture.
- Release captured tracks immediately if the output context still cannot run, restoring native tab playback instead of keeping a silent capture alive.
- Treat non-running output contexts as unhealthy runtime state and trigger controlled recovery rather than accepting them as healthy sessions.
- Probe once after capture startup so an already-muted tabCapture track is detected even if no later `mute` event fires.
- Keep transient offscreen status/IPC failures non-destructive: uncertainty alone never triggers recapture.
- Add suspended-output/cold-resume/fail-safe regression coverage; Node regression suites are now 36/36 PASS.

## 1.28.9

- Rebase background state/protection revision counters above a surviving offscreen document after an MV3 service-worker restart, preventing fresh user changes from being silently rejected by an older higher runtime revision epoch.
- Keep offscreen requested-vs-applied state revisions separate so a failed or superseded Pitch Worklet load is never reported as successfully applied.
- Retry the first Pitch AudioWorklet module load after transient cold-start failures and give Pitch/state application a realistic 3.2 s IPC budget; capture startup gets 5.2 s instead of the generic 900 ms budget.
- Treat popup storage values as display hints until background confirms authoritative state; early interaction can no longer persist temporary defaults after a slow storage read.
- Return background desired state from StatusGet instead of stale runtime state, while status reconciliation retries a lagging offscreen session.
- Add MV3 restart revision and cold Pitch Worklet retry regressions; Node regression suites are now 35/35 PASS.

## 1.28.8

- Refined the manga catgirl extension icon: removed cheek marks, preserved the full composition at every Chrome icon size, reduced transparent padding, and improved 16/32 px legibility.

## 1.28.7

- Replaced the extension icon set (16/32/48/128 px) with the new manga-style catgirl/audio identity.
- Kept DSP, permissions, state schema, async/concurrency logic and UI behavior unchanged from 1.28.6.
- Uses tighter crops for small toolbar sizes so the character remains recognizable at 16/32 px.


## 1.28.6

- Require explicit state/protection revisions on every internal offscreen `CAPTURE_START`; remove fallback revision synthesis from existing/pending-session paths.
- Add parser/static regression coverage so a future caller cannot silently bypass latest-wins ordering by omitting capture revisions.
- Keep Chromium active-capture error-text matching as an explicit, tested `CHROME-ERROR-TEXT-DEPENDENCY`; no permissions, DSP, state schema, or minimum Chrome version changes.

## 1.28.5

- Make background the durable owner of audio-state persistence; popup lifetime can no longer lose the final drag/change value.
- Add versioned `LatestWinsWriter` pipelines for AudioState, Protection and Appearance; intermediate realtime writes collapse while the newest revision always wins.
- Propagate state/protection revisions into offscreen sessions and reject stale async completions after `await`, including delayed Pitch Worklet loading.
- Treat background storage timeout as non-authoritative fallback, retain the original late read, retry storage, and refuse to overwrite newer user intent with late startup data.
- Add popup request generations for capture/status/state/protection and a single fire-and-report path for fire-and-forget UI operations.
- Serialize global offscreen document lifecycle and track `desiredTabs` so one tab cannot close the shared document while another starts.
- Bound important CaptureManager Chrome API calls, including offscreen creation/close, `getMediaStreamId`, status/state/protection/meter IPC and capture stop/start IPC.
- Make Rice/Nocturne appearance identity persistence latest-wins.
- Add recoverable artwork/background operation journals around IndexedDB + chrome.storage updates; custom-theme deletion commits registry removal before destructive media cleanup.
- Remove runtime Delay/Exciter stages and their unnecessary AudioNodes while retaining disabled schema fields for backward compatibility.
- Convert the Pitch AudioWorklet wrapper to TypeScript and add a fake-AudioWorklet integration test.
- Expand adversarial concurrency/lifecycle QA: 33/33 Node suites, stale-startup, stale-worklet, media-journal, appearance-race and cross-tab offscreen tests.
- Frozen EQ response, accepted Pitch Down math/hashes, preset signal data and protection tuning are unchanged.

## 1.28.4

- Make Pitch latency reporting allocation-free and move it into a tiny dedicated module so popup startup does not import the realtime Pitch processor.
- Remove the unused `AudioSession.pitchLatencyMs` path that forced Pitch core code into unrelated audio-session startup.
- Make Meter polling single-flight and discard stale responses after capture/tab generation changes.
- Split popup control synchronization into Gain/Dynamics/Stereo/Effects/Protection/Analyzer/Capture/Band Editor groups; EQ dragging no longer rewrites unrelated DOM or schedules unrelated canvas frames.
- Reuse EQ response scratch buffers/frequency tables and replace JSON-string cache keys/per-sample point objects with structured caches and indexed drawing.
- Add typed `PopupElements` collection with runtime tag contracts; remove UI `any`/expando state in favor of typed DOM access and `WeakMap`/`WeakSet`.
- Enable `noUnusedLocals` and `noUnusedParameters` in the normal TypeScript gate; remove confirmed dead fields/imports/APIs, stale `debug_ui_qa.py`, and obsolete build fallback wrapper.
- Extract pure surface normalization/export logic from `AppearanceService` into `appearance-surface.ts` to reduce the service's mixed responsibilities.
- Consolidate `popup.css`: remove the historical Band Inspector patch stack and exact duplicate selectors while preserving Rice/Nocturne/Classic geometry.
- Add Meter single-flight/Pitch latency regression coverage and teach UI QA to load the same typed/runtime helper modules as production.
- DSP math, accepted Pitch Down output hashes, preset semantics and the frozen EQ response are unchanged.

## 1.28.3

- Prevent maximum-length preset names from escaping the picker in Rice or Nocturne; the visible label and menu entries now ellipsize inside their real control bounds.
- Reject custom themes whose resolved typography or spacing would break the fixed popup geometry; runtime CSS also clamps those values as recovery defense.
- Increase small Appearance/help/reset/close hit targets to 32 px without enlarging the main layout footprint.
- Keep an explicit scrollbar gutter and lower scroll cue in the Appearance inspector.
- Rebalance Clip Protection into a compact 2×2 mode grid with short descriptions.
- Extend UI QA with adversarial long-name containment, hit-target, inspector-scroll and Protection geometry checks.
- DSP, EQ compatibility fixtures and preset signal semantics are unchanged.

## 1.28.2
- Treats Chrome storage timeout/error as uncertain state instead of an empty authoritative record; fallback startup can no longer erase themes, surface overrides, media hints, or presets.
- Preset writes now require an authoritative retry after degraded startup, preserving existing user presets before Save/Import/Rename/Delete.
- Makes media hint updates recoverable around Blob writes and requires custom-theme media cleanup before deletion.
- Rejects oversized image dimensions and GIFs with excessive frame counts before IndexedDB/GPU decode work.
- Applies the animated-background blur cap during live Appearance preview as well as full theme apply.
- Requires confirmed offscreen/browser capture state before destructive reconciliation and bounds service-worker Chrome API waits.
- Revalidates descendant themes when a custom parent is replaced and closes IndexedDB connections on version change.
- Runs Playwright UI QA in an isolated process group so Chromium cleanup cannot poison later release gates.

## 1.28.1
- Bounded popup/appearance/preset startup I/O so stalled Chrome APIs fall back instead of blocking initialization.
- Lazy-load/validate the custom-theme library only when needed for built-in users.
- Serialized Artwork/Background mutations and guarded async completion across theme switches.
- Added lightweight background/media fit hints; Cover/Contain no longer rewrites large media Blobs.
- Wait for IndexedDB transaction commit on media writes/deletes.
- Serialized per-tab preset selection mutations to prevent lost updates.
- Tightened custom-theme UI color/typography/artwork contracts.
- Strengthened Pitch perf outlier checks and deterministic UI-QA cleanup handling.
- Added clean current-version handoff bundle generation.

## 1.28.0
- Ships the supplied square portrait as preloaded Rice artwork without baking it into the Rice theme definition.
- The portrait behaves like an already-uploaded local image: Cover/Contain, Replace and Remove use the same Media controls.
- Keeps only lightweight preloaded-media metadata in chrome.storage; the 61 KB image remains a local extension asset.
- Lazy-loads IndexedDB artwork/background code and the custom-theme validator only when needed.
- Parallelizes capture-status and selected-preset restoration during popup startup.
- Adds regression coverage for the one-time media seed and first-paint preloaded artwork behavior.

## 1.27.2
- Changed Appearance from a workspace replacement into a right-side live inspector.
- Keeps the complete EQ and Audio Tools visible as a scaled preview while visual settings are edited.
- Inspector surfaces use single-column controls with full-width sliders; preview is inert to avoid hidden focus/interactions.
- Preserved the lazy Appearance startup and deferred media-loading performance work from 1.27.0.

## 1.27.0
- Refactored Appearance from a narrow popover into a full workspace editor with Theme, Media, Surfaces and Advanced tabs.
- Lazy-loads the Appearance editor only on first use; startup now runs theme, settings and active-tab reads in parallel.
- Defers and batches IndexedDB artwork/background loading after first paint; animated GIF backgrounds cap glass blur to reduce GPU load.
- Avoids rewriting the preset map on every popup open when no migration is needed.
- Added QA for Appearance control width, workspace presentation, lazy editor loading and startup performance contracts.

## 1.26.1
- Made EQ surface color/opacity affect the real canvas instead of only its wrapper.
- Extended Controls/Card styling to the visible module tiles, status pills, toolbars and form controls.
- Removed Appearance slider lag with requestAnimationFrame-coalesced previews, selective CSS-variable updates and one storage commit on release.
- Added UI regression coverage for canvas color/alpha and zero storage writes during input bursts.

## 1.26.0
- Added layer-based visual customization for Main, EQ, Cards, Audio Tools and Controls.
- Added Advanced controls for accent/border/text colors, background overlay, blur, shadow and radii.
- Extended custom-theme JSON with `surface.eq`, `surface.cards` and `surface.controls`, preserving backward compatibility.
- Added standalone **Export current look** JSON.
- DSP/audio behavior unchanged.

## 1.25.7
- Added first-class JSON theme defaults for Main panel and Audio Tools color/opacity via `tokens.surface.main` and `tokens.surface.tools`.
- Appearance panel overrides now layer over JSON defaults; Reset returns to the imported theme values.
- Added Export selected for custom themes; current panel overrides are materialized into exported JSON for round-trip consistency.
- Updated theme validation, inheritance, examples and tests for panel surface tokens.

## 1.25.5
- Fixed Rice Main panel tint/transparency so Appearance → Panels now affects the actual primary glass surface.
- Added UI regression coverage for computed main/tools surface backgrounds, not only CSS variables.

## 1.25.4
- Added per-theme Main panel and Audio Tools color/opacity controls in Appearance.
- Surface overrides are local, validated, resettable, and do not affect DSP.

## 1.25.3
- Added local per-theme full-window background uploads (PNG/JPEG/WebP/animated GIF).
- Background and square artwork are independent IndexedDB slots with Cover/Contain and reset.
- Added UI/static regression coverage for background upload, fit, persistence path and removal.


## 1.25.2
- Added per-theme local artwork upload for the Rice artwork card: PNG/JPG/WebP/animated GIF, Cover/Contain and reset.
- Artwork blobs live in IndexedDB instead of chrome.storage; signatures are validated and files are capped at 12 MB.
- Theme background artwork remains untouched by user card overrides.
- Added artwork storage/unit/UI QA coverage. DSP unchanged.

## 1.25.1
- Fixed the 1.25.0 popup startup regression by removing cached custom CSS variables from the first-paint path.
- Added a 120 ms popup reveal watchdog plus stale/broken custom-theme recovery to Rice.
- Added validated local custom-theme JSON import, persistence, selection, replacement, deletion, and starter-example download.
- Connected `theme-validator.ts` to the production AppearanceService; it is no longer dead release code.
- Baseline-v4 migration now disables Dynamics through `normalizeDynamics`, and architecture docs list Dynamics explicitly.

## 1.24.3
- Separated Audio Tools navigation state (`is-open`) from enabled DSP state (`is-on`) so only the current page looks selected.
- Made the hidden themed EQ/status workspace `inert` and `aria-hidden` while an Audio Tool page is open.
- Added a visible Dynamics overflow/scroll affordance for expanded Advanced controls.
- Fixed the Effects workspace note cascade and improved Band Editor toolbar visibility / Nocturne axis-label contrast.
- Repaired the legacy Classic fallback spacing and icon visibility.
- Added the Pitch AudioWorklet browser capability probe to scripted release QA and strengthened static invariants.

## 1.24.2
- Fixed Rice preset/Gain overlap by constraining Gain to a single 25 px row.
- Moved the EQ utility toolbar from the x-axis label zone to the top edge of the canvas.
- Added collision regression checks to UI QA.

## 1.24.1

- Unified Rice and Nocturne on one exclusive themed Audio Tools workspace model.
- Made Meter exclusive in themed layouts while retaining Classic floating Meter behavior.
- Moved Presets into the themed workspace and clarified Selected vs Based-on preset state.
- Raised themed status/readout text floor and restored consistent Effects SVG glyph rendering.
- Removed the obsolete v10–v13 themed CSS patch stack, cutting the layout stylesheet roughly in half.
- Finalized built-in artwork asset names/IDs and strengthened UI/static regression checks.


## 1.24.0

- Stabilized themed popup architecture without changing DSP.
- Rice audio tools now use one workspace-page model while Audio Tools remains persistent.
- Opening panels dismisses the precise Band Editor to keep EQ drag targets unobstructed.
- Meter returned to content-driven height with Spectrum containment checks.
- Consolidated the accumulated 1.23.8–1.23.14 themed CSS override stack.
- Synchronized release/store docs with down-only Pitch behavior.


## 1.23.14
- Added breathing room around the Rice primary surface.
- Increased the gap between the main EQ surface and persistent Audio Tools.
- Centered and narrowed the detached Band Editor with a real vertical gap below the main surface.

## 1.23.13
- Moved Band Editor outside the EQ plot so point dragging stays fully usable.
- Kept explicit +/- steppers and direct numeric input in a detached bottom control strip.

## 1.23.12
- Reworked the EQ Band Editor for faster precise edits.
- Added explicit minus/plus controls for Frequency, Gain and Q; Shift-click provides finer steps.
- Enlarged and centered numeric fields, selecting the value on focus for quick replacement typing.
- Disabled Q steppers on Low Shelf / High Shelf bands, matching Web Audio behavior.
- Added UI QA for editor containment, button hit areas and step behavior.

## 1.23.11
- Changed Nocturne Audio Tools from cramped 3×2 navigation to a readable 2×3 grid.
- Increased Meter sheet/workspace height so Spectrum Response controls fit without clipping.
- Added UI QA checks for Nocturne tool-label overflow and complete Meter content visibility.

## 1.23.9
- Refined Presets panel spacing, button hierarchy and destructive action styling.
- Enlarged and rebalanced Audio Tools cards so labels and state pills fit cleanly in Rice and Nocturne.
- Tightened UI alignment for readouts and controls; preserved tabular numeric layout for live meter values.

## 1.23.8

- Kept Rice Audio Tools persistent while opening tool detail panels.
- Removed duplicate quick Gain/Stereo controls and exposed the master Gain zero reset, visible detent, ±0.25 dB snap and double-click reset.
- Fixed Rice tool-label overflow and widened detail panels.
- Stabilized Meter numeric columns with fixed-width tabular readouts.

All notable public KopelaEQ changes are summarized here. Detailed historical release notes may exist in older project archives.

## 1.23.7 — 2026-08-14

### Rice Audio Tools and layout stabilization

- Replaced Rice's cramped 48 px tool rail/popovers with the wider Audio Tools surface used by Nocturne.
- Stereo, Protection, Effects and their detail pages now replace the tool surface in-place, leaving the EQ geometry fixed.
- Stabilized Meter to a fixed workspace page with no content-driven scrollbar or wrapping meter values.
- Removed the compressed decorative Stereo gauge, expanded Protection controls, and normalized Effects icons/rows.
- Strengthened themed open/close motion while preserving reduced-motion behavior.
- Added a pre-paint appearance bootstrap and cache so the saved Rice/Nocturne style is applied before the popup becomes visible.
- Added appearance-bootstrap regression coverage; DSP, preset semantics and signal ordering remain unchanged.

## 1.23.6 — 2026-08-14

### UI polish and panel motion

- Reworked Presets into a clearer hierarchy: current-curve save, selected-preset editing, file import/export, and a separated destructive action.
- Replaced the old Appearance bar swatches with compact structural previews for Rice and Nocturne, plus a single neutral selected-state indicator.
- Refined the precise EQ band editor with softer grouping, clearer numeric fields, a compact total-response readout, and a quieter reset action.
- Added real close animations for themed panels before `hidden` is applied, so cards dismiss smoothly without shifting or resizing the EQ workspace.
- Normalized Rice dock-popover surface styling; no DSP, state schema, preset semantics, or signal-path behavior changed.

## 1.23.5 — 2026-08-13

- Removed positive Pitch entirely after repeated listening tests showed unacceptable robotic coloration on speech.
- Pitch UI/state/AudioWorklet now support only 0…−12 semitones; the accepted 1.23.1 down-shift implementation remains intact.
- Retired Delay and Harmonic Exciter from the public Effects UI to reduce feature clutter. Their compatibility state is kept but always normalizes disabled.
- Effects launcher now contains only Pitch Down, Reverb, and 8D/Auto-pan.
- No schema or frozen EQ baseline bump: the state shape is unchanged and legacy positive/retired-effect values normalize safely.

## 1.23.4 — 2026-08-13

### Positive-Pitch rewrite, full-range EQ view, and Meter layout

- Expanded the EQ graph from 20 Hz–20 kHz to the full normalized DSP range **5 Hz–20 kHz**. Valid sub-20-Hz bands now occupy their actual logarithmic position instead of conflicting with the visible axis.
- Kept DSP frequency values untouched; the visualization change does not rewrite legacy or imported preset frequencies.
- Replaced the 1.23.3 positive Pitch path with a 2048-point STFT phase vocoder using transient phase reset, identity-style phase locking, and spectral-envelope/formant compensation.
- Preserved negative Pitch behavior byte-for-byte against the accepted 1.23.1 output hashes at −2/−7/−12 semitones.
- Kept modeled Pitch latency at about 48 ms at 48 kHz; rejected a 4096-point experiment because it raised latency to ~91 ms and consumed too much realtime callback budget without improving the voice regression.
- Constrained Meter to the same persistent-navigation boundary as primary DSP panels, preventing explanatory text or controls from sliding beneath the module strip.
- Compacted the Meter explanatory copy and added UI QA assertions for panel/toolbar separation.
- Added/updated geometry, Pitch frequency, voice-envelope, CPU, legacy-negative, browser dry-path, and popup regressions while leaving the frozen 1.21.1 EQ golden fixture unchanged.

## 1.23.3 — 2026-08-13

### Directional Pitch rollback and sub-20 marker containment

- Restored negative Pitch to the accepted 1.23.1 implementation and added byte-level regression hashes.
- Replaced the 1.23.2 positive branch with a WSOLA/time-stretch plus band-limited resampling experiment.
- Kept sub-20-Hz EQ markers fully inside the 20-Hz-minimum plot, while preserving their actual DSP frequency.
- Extended floating-panel bounds so the persistent module toolbar remained clickable.
- This candidate was superseded by 1.23.4 because the positive Pitch still sounded robotic and a 17-Hz point remained semantically inconsistent with a graph whose visible minimum was 20 Hz.

## 1.23.2 — 2026-08-13

### Interaction and positive-Pitch quality

- Replaced the original deterministic two-read-head Pitch core with a waveform-similarity granular implementation that correlation-aligns each overlapping grain before launch.
- Reduced modeled Pitch latency from 48.0 ms to 52.3 ms at 48 kHz while preserving ±12 semitone range and 1× wall-clock throughput.
- Added `pitch_voice_quality.test.mjs`, a voiced-harmonic envelope-regression test for the positive-shift robotic/beating failure mode.
- Changed floating-panel behavior to one primary settings inspector at a time, with same-button toggle, Escape close, workspace-click dismissal, and independent Meter visibility.
- Added Back-to-Effects navigation on Pitch/Reverb/Delay/8D/Exciter detail panels and visual open-state feedback on launcher buttons.
- Removed the unexplained permanent purple color from the first/last EQ shelf markers; purple is now reserved for the selected band.
- Preserved the 1.21.1 EQ golden baseline, schema/audio baseline v4, signal-stage ordering, and physical processor disconnection for every disabled new stage.

## 1.23.1 — 2026-08-13

### Reverb quality and DSP navigation

- Removed audible periodic amplitude modulation from synthetic Reverb IR generation.
- Added progressive high-frequency damping, a 13–20 ms diffuse attack, three early reflections, and independently decorrelated stereo IR noise.
- Added deterministic Reverb IR regression coverage for attack, tail darkening, and L/R correlation.
- Replaced the overcrowded 9-module toolbar with `Preset · Dynamics · Stereo · Protect · Meter · Effects · •••`.
- Grouped Pitch/Reverb/Delay/8D/Exciter under an Effects launcher while retaining their draggable floating control panels.
- Reduced the fresh/default Auto-pan depth from 85% to 45%.
- Preserved the existing 1.21.1 EQ golden baseline and physically disconnected OFF paths.

## 1.23.0 — 2026-08-13

### DSP and release architecture

- Added Mid/Side Stereo Width/Balance/Mono/Swap between Dynamics and Protection.
- Added granular ±12-semitone Pitch Shift before Dynamics with lazy AudioWorklet loading.
- Added local synthetic Reverb, Delay, Auto-pan/8D, and Harmonic Exciter after Protection.
- Enforced physical processor disconnection for every disabled new stage through BypassGate-style gates.
- Bumped schema/audio baseline to v4 and force-disabled new processors on legacy migration.
- Preserved the 44.1/48 kHz EQ golden fixture at 0 dB maximum difference and new-stage disabled paths at 0 sample delta.
- Split popup EQ, Meter, and Preset behavior out of the previous monolithic index module.
- Pinned Chromium active-capture error strings and documented the minimum-Chrome-version maintenance check.

## 1.22.1 — 2026-08-11

### Capture reliability

- Added health-aware recovery for tab audio across media-source transitions.
- Uses `Tab.audible` + track mute state so pause/silence does not trigger recapture.
- Automatically resumes suspended AudioContext instances.
- Recovers ended/error/orphaned capture sessions while preserving manual Stop semantics.
- Removed redundant status polling from the meter path.
- Added regression coverage for short mute/unmute transitions and persistent audible+muted capture.

## 1.22.0 — 2026-08-08

### Release hardening

- Frozen the accepted audio/UI baseline for the first public release.
- Strengthened Chrome API typing and runtime message validation.
- Added deterministic release/source archives and SHA-256 verification.
- Expanded QA to 100 capture Start/Stop cycles and simultaneous-tab lifecycle coverage.
- Preserved golden EQ response at 44.1/48 kHz with 0 dB maximum difference.
- Preserved analyser side-chain output transparency.
- Prepared Privacy, Store listing, Security, Architecture, contribution, and release documentation.

## 1.21.1

- Stabilized Meter clip-state UI with fixed-width status badges and latched `OVER` indication.

## 1.21.0

- Added Pre/Post Protection metering, Peak/RMS/hold, Protection/Dynamics gain reduction, and Spectrum response modes.
- Made analyser branches demand-driven and side-chain only.

## 1.20.0

- Added band editor with Frequency/Gain/Q/Type/Total response information.
- Improved preset workflows: Save as, Update, Duplicate, Rename, Delete, Import, Export.

## 1.19.0

- Migrated runtime source to strict TypeScript and browser-native ESM modules.
- Introduced typed/runtime-validated message contracts and explicit CaptureManager state handling.

## 1.18.0

- Replaced popup RBJ response duplication with native `BiquadFilterNode.getFrequencyResponse()`.
- Unified click-free Dynamics/Protection bypass transitions in `BypassGate`.

## 1.17.0

- Reworked capture/session lifecycle around one AudioEngine and one session per tab.
- Removed the temporary diagnostic legacy-path architecture.

## 1.14.0

- Restored the correct EQ topology: Low Shelf + 9 Peak + High Shelf.
