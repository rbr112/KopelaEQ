# KopelaEQ 1.28.15 — QA report

1.28.15 removes the rejected fixed Auto Headroom experiment. Maximum now uses the exact Strong primary Protection profile plus the existing post-effects true-peak-aware AudioWorklet. Below-ceiling material remains at unity gain; only short final peaks are attenuated by the extra stage.

## Automated / reproducible results

- TypeScript 5.8.3 strict typecheck: PASS
- Browser-native ESM build: PASS
- StateSet adversarial burst: PASS; 24 rapid intents collapse to 2 storage + 2 runtime writes and finish on the newest state
- Protection adversarial burst: PASS; delayed Light followed by newer modes finishes with storage/runtime on Strong
- Slow background startup authority + stale-response generation tests: PASS
- MV3 service-worker restart with surviving offscreen revision epoch: PASS; first post-restart state/Pitch mutation reaches runtime
- Popup temporary fallback interaction guard: PASS; no `STATE_SET` is emitted before background authority
- Transient cold Pitch Worklet load retry: PASS; applied revision advances only after graph readiness
- Offscreen stale Worklet completion generation test: PASS
- Rice/Nocturne appearance latest-wins race test: PASS
- Artwork/background crash-recovery journal + custom-theme deletion ordering test: PASS
- Cross-tab shared offscreen lifecycle Start/Stop race: PASS
- Typed Pitch Worklet wrapper integration: PASS
- Maximum true-peak limiter core: PASS; quarter-sample-phase 12 kHz hidden inter-sample peak detected and independently reconstructed output remains below target
- Maximum stereo-link / lookahead / worklet failure-retry regressions: PASS
- Maximum core CPU guard: PASS; 4× detection only, no full-rate 4× audio oversampling
- Maximum sub-ceiling unity / isolated-transient recovery regressions: PASS
- Node regression suites: 42/42 PASS
- Allocation-free Pitch latency helper: PASS; popup imports `pitch-latency.js`, not the realtime Pitch core
- Meter single-flight regression under overlapping ticks: PASS
- Partial realtime control synchronization / EQ-only redraw contract: implementation/static + UI gate
- Typed popup markup contract (`PopupElements`): PASS in real UI QA startup
- TypeScript unused-local/parameter checks are part of normal `typecheck`: PASS
- Generic `popup.css` exact duplicate selectors: 0; historical Band Inspector override stack removed
- EQ response scratch-buffer/cache refactor: UI/native response probe PASS
- 400 ms Appearance storage timeout preserves stored custom-theme selection: PASS
- Degraded surface startup re-reads authoritative overrides before whole-map write: PASS
- 400 ms preset timeout performs zero fallback writes; later Save preserves existing user presets: PASS
- Lazy custom-theme library on built-in startup: PASS
- Media upload/theme-switch race regression: PASS
- IndexedDB transaction-completion contract: PASS
- Uploaded image dimension limit (4096×4096 / 16 MP): PASS
- Animated GIF frame limit (400): PASS
- GIF live-preview blur cap: implementation/static gate
- Transient offscreen reconciliation IPC does not recapture a healthy session: PASS
- Custom parent-theme replacement revalidates descendants and rolls back on failure: PASS
- IndexedDB `versionchange` connection close: implementation/static gate
- Popup UI/interaction assertions: PASS through isolated Playwright process-group runner
- Static release/code checks: PASS
- Golden EQ response, 44.1/48 kHz: PASS, 0 dB max difference
- Meter side-chain audible-path delta: PASS, 0 sample delta
- Disabled new-stage dry paths: PASS, 0 sample delta
- DSP crossover math: PASS
- Stereo math: PASS
- Pitch performance: p95/p99 + callback-deadline miss-rate gate
- Pitch/Maximum AudioWorklet browser capability remains a manual Chrome Stable gate when supplied headless Chromium lacks `audioWorklet.addModule`
- Deterministic release/source archive verification: PASS after release build


## Performance / maintainability invariants

- Popup latency text is calculated without constructing `LegacyDownPitchShifter` or allocating audio buffers.
- `AudioSession` does not import Pitch core only for latency; the full realtime processor stays on the actual Pitch path.
- Meter polling cannot overlap; a stale response is ignored after tab/capture generation changes.
- Realtime UI synchronization is grouped by control domain; EQ drag does not rewrite unrelated Audio Tools/workspace controls.
- EQ drawing reuses response/frequency scratch buffers and structured caches rather than JSON-string cache keys and per-sample point objects.
- Static popup DOM is collected through typed tag contracts.
- `AppearanceService` pure surface resolution/export logic is isolated in `appearance-surface.ts`.
- Confirmed stale QA/build wrappers were removed, and the normal compiler rejects unused locals/parameters.
- Generic popup CSS has one authoritative Band Inspector block and no exact duplicate selectors.

## Data-integrity invariants

- Bounded reads return `ok / timeout / error`; timeout/error never masquerade as `{}`.
- Fallback Appearance and bundled presets may be shown temporarily but are not authoritative and cannot trigger repair/migration writes.
- Preset mutations require an authoritative retry first.
- Custom themes, surface overrides, and media hints require authoritative storage before whole-map persistence.
- Artwork/background mutations are journaled before cross-store changes; restart either commits the matching Blob/hint pair or restores the previous hint.
- Custom-theme removal commits the authoritative registry before destructive Blob cleanup; a failed registry write leaves media intact.

## Startup / lifecycle invariants

- Built-in Rice/Nocturne startup keeps the custom-theme library lazy.
- IndexedDB media refresh stays off the critical first-paint path and is skipped when authoritative hints prove no Blob is needed.
- Important service-worker Chrome API/offscreen IPC operations are time-bounded.
- AudioState/Protection persistence is background-owned, versioned, single-flight/latest-wins.
- Offscreen state/protection application is revision-guarded across asynchronous waits.
- Surviving offscreen revisions are rebased into the new service-worker epoch before post-restart state mutations are accepted.
- Popup storage fallback is display-only until authoritative background state/protection arrive; temporary defaults cannot be persisted by early interaction.
- Requested and actually-applied offscreen state revisions are tracked separately so failed Pitch Worklet setup cannot report a false applied state.
- Shared offscreen create/close operations are serialized and veto close while any `desiredTabs` start intent exists.
- Capture reconciliation retries transient offscreen IPC and skips destructive recovery when either offscreen or browser capture state is uncertain.
- Playwright UI QA runs in a separate OS process group; descendants are terminated before later browser gates.

## Manual Chrome Stable gates

Before public Store release:

1. Load `kopelaeq-1.28.15.zip` in current Chrome Stable.
2. Verify rapid popup reopen/restart/update with existing presets and custom themes.
3. Upload large-but-allowed PNG/WebP and animated GIF media; verify rejected oversized media reports a clear error.
4. Test rapid Rice ↔ Nocturne switching during media upload.
5. Test custom-theme import/replace/remove, including a theme extending another custom theme.
6. Test Start/Stop capture and browser restart with a live captured tab.
7. Test Pitch Down on speech/music and run the 30–60 minute CPU/RAM/listening soak.
