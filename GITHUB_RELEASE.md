# KopelaEQ 1.28.8

Async/concurrency and MV3 lifecycle hardening release. DSP tuning and the frozen EQ baseline are unchanged.

## Fixed

- AudioState and Protection are now background-owned, revisioned and latest-wins; rapid input cannot leave UI/storage/audio on different values.
- Slow background storage startup uses temporary non-authoritative defaults, retains/retries the real read, and rejects late snapshots after newer user intent.
- Popup and offscreen async responses are generation/revision guarded after `await`.
- Realtime state persistence no longer depends on popup debounce/close timing.
- Shared offscreen create/close is globally serialized and protected by `desiredTabs` against cross-tab close/start races.
- Rice/Nocturne identity writes are latest-wins.
- Artwork/background IndexedDB + hint changes use a recovery journal; custom-theme deletion commits registry removal before media destruction.
- Fire-and-forget UI async paths use a single error sink instead of producing unhandled promise rejections.
- Delay/Exciter runtime stages and unnecessary AudioNodes are removed while their disabled schema fields remain for compatibility.
- Pitch Worklet source is TypeScript and has a fake-AudioWorklet integration test.

## QA

- 33/33 Node regression suites pass.
- Adversarial StateSet burst: 24 inputs -> 2 storage + 2 runtime writes, final newest state.
- Protection delayed-write race, slow authoritative startup, stale startup response, stale Worklet response, Appearance race, media journal recovery and cross-tab offscreen lifecycle tests pass.
- Isolated Playwright UI QA passes.
- Golden EQ response: 0 dB difference at 44.1/48 kHz.
- Meter sidechain and disabled-stage dry paths: 0 sample delta.
- DSP crossover and Stereo math pass.
- Headless Chromium still lacks `audioWorklet.addModule`; unpacked Chrome Stable Pitch listening/soak remains a manual gate.

## Release files

- `kopelaeq-1.28.8.zip` — Chrome/Chromium release package
- `kopelaeq-1.28.8-source.zip` — source, tests, QA and release tooling
- `kopelaeq-next-chat-full-1.28.8.zip` — clean continuation bundle
- `SHA256SUMS.txt` — release hashes

See `README.md`, `RELEASE_NOTES_1.28.8.md`, `QA_REPORT.md`, and `RELEASE_CHECKLIST.md`.
