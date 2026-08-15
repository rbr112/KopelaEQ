# KopelaEQ 1.28.8 release checklist

## Automated / reproducible gates

- [x] TypeScript typecheck passes.
- [x] Browser-native ESM build passes.
- [x] StateSet/Protection latest-wins adversarial delay tests pass.
- [x] Background slow-start authority and stale startup response tests pass.
- [x] Offscreen stale-response generation test passes across delayed Worklet loading.
- [x] Appearance identity latest-wins test passes.
- [x] Artwork/background recovery journal and custom-theme deletion ordering tests pass.
- [x] Cross-tab shared offscreen lifecycle race test passes.
- [x] Pitch Worklet wrapper is TypeScript-checked and fake-worklet integration test passes.
- [x] Pitch latency helper is allocation-free and popup startup does not import the realtime Pitch processor.
- [x] Meter polling single-flight regression passes.
- [x] Realtime control updates are grouped; EQ drag does not resync unrelated controls.
- [x] Typed popup DOM/tag contracts pass UI QA.
- [x] `noUnusedLocals` / `noUnusedParameters` are enabled in the normal TypeScript gate.
- [x] Stale debug UI QA and obsolete fallback build wrapper are removed.
- [x] Generic popup CSS has no exact duplicate selectors; the historical Band Inspector patch stack is removed.
- [x] Node regression tests pass (33/33).
- [x] Slow Appearance storage cannot repair/overwrite a valid stored custom theme.
- [x] Slow preset storage performs no bundled-default write and preserves existing user presets before mutation.
- [x] Surface/custom-theme/media-hint whole-map writes require authoritative storage.
- [x] Media upload/theme-switch race regression passes.
- [x] IndexedDB media mutations wait for transaction commit and close on version change.
- [x] Uploaded image dimensions and GIF frame counts are bounded.
- [x] GIF live-preview blur uses the same 6 px performance cap as full apply.
- [x] Transient offscreen IPC cannot cause destructive capture reconciliation.
- [x] Replacing a custom parent theme revalidates descendants.
- [x] Selected-preset concurrent mutation regression passes.
- [x] Static release/code checks pass.
- [x] Frozen EQ response remains 0 dB different at 44.1/48 kHz.
- [x] Meter/analyser side-chain remains transparent to the audible path.
- [x] Disabled new DSP stages remain 0-sample-delta dry paths.
- [x] Pitch perf checks p99 and callback deadline-miss rate.
- [x] UI QA runs in an isolated process group and cleans Chromium descendants.
- [x] Current-version handoff builder excludes historical QA screenshots/stale dist zips.

## Chrome API compatibility

- [x] `minimum_chrome_version` remains 116.
- [x] `tabCapture.getMediaStreamId` / offscreen-document assumptions remain unchanged.

## Manual Chrome Stable smoke test

- [ ] Load final `kopelaeq-1.28.8.zip` unpacked in current Chrome Stable.
- [ ] Confirm saved Rice/Nocturne appearance and preloaded Rice artwork on normal startup.
- [ ] Confirm existing custom themes/presets survive rapid reopen and browser restart.
- [ ] Upload/replace/remove Artwork and Background while rapidly switching Rice/Nocturne.
- [ ] Confirm oversized media/GIFs are rejected without freezing the popup.
- [ ] Import a custom theme that extends another custom theme; replace the parent and verify invalid replacements are rejected.
- [ ] Confirm Audio Tools/tool workspaces and keyboard accessibility.
- [ ] Confirm Meter values/Spectrum and Dynamics Advanced scrolling.
- [ ] Confirm Stereo, Protection, Reverb and 8D.
- [ ] Confirm Pitch Down on real speech at representative negative values.
- [ ] Confirm power/capture Start/Stop and browser restart with a real media tab.
- [ ] Run a 30–60 minute Pitch Down CPU/RAM/listening soak.

## Publication

- [ ] Attach `kopelaeq-1.28.8.zip`, `kopelaeq-1.28.8-source.zip`, `SHA256SUMS.txt`, release notes and QA report to the GitHub release.
- [ ] Host the current privacy policy at a public HTTPS URL and complete Chrome Web Store privacy/data-use declarations.
- [ ] Use current 1.28.8 screenshots only.
