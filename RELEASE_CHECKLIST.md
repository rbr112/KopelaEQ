# KopelaEQ 1.22.0 final release checklist

## Finalization status

- [x] Maintainer accepted the 1.22.0 RC in a real-use smoke test.
- [x] Extension code/DSP frozen for 1.22.0 Final.
- [x] Extended 30–60 minute Chrome Task Manager soak remains recommended before/after Store publication.
- [x] Chrome Web Store dashboard/account steps remain external publication tasks.

## Automated — must be PASS

- [x] TypeScript 5.8.3 strict typecheck
- [x] Deterministic production build
- [x] JavaScript syntax check for every emitted module
- [x] Exact bundled-preset fixture check
- [x] Runtime message parser tests
- [x] BypassGate transition tests
- [x] AudioSession tests
- [x] Offscreen runtime tests
- [x] CaptureManager lifecycle tests
- [x] Background runtime tests
- [x] MV3/security/static audit
- [x] 3-band crossover math test
- [x] Golden EQ response at 44.1/48 kHz
- [x] Meter side-chain audible-transparency test
- [x] Chromium popup QA
- [x] Release/source ZIP integrity verification
- [x] Build the release twice and confirm identical SHA-256

## Manual Chrome tests — required before Store publication

- [ ] Load the final release ZIP unpacked in current Chrome Stable.
- [ ] YouTube/music A/B against the accepted sound baseline with Dynamics Off + Protection Off.
- [ ] Test all five bundled presets, especially Vivid and bass-heavy presets.
- [ ] Start/Stop repeatedly on one tab; no `Cannot capture a tab with an active stream` error.
- [ ] Capture two normal tabs one after another and verify state isolation.
- [ ] Close a captured tab and verify audio/session resources disappear.
- [ ] Navigate/reload a captured tab and verify expected capture behavior.
- [ ] Test restricted pages (`chrome://`, Web Store) fail cleanly without a broken UI.
- [ ] Test Windows display scaling at 100%, 125%, and 150% if available.
- [ ] Run a 30–60 minute Chrome Task Manager soak with Spectrum/Meter both on and off; verify no monotonic RAM/CPU growth.

## Protection checks

- [ ] Compare Protection Off / Light / Medium / Strong using Meter Pre/Post and GR.
- [ ] Verify Protection only reduces output when required and that Off has no gain reduction.
- [ ] Do a listening check on Vivid and Bass Heavy; automated metering cannot prove subjective transparency.

## GitHub publication

- [ ] Choose an open-source license only if you want to grant reuse rights; 1.22.0 currently ships with no open-source license.
- [ ] Publish source, README, Architecture, Privacy, Store Listing draft, release notes, and hashes.
- [ ] Tag the exact commit corresponding to the uploaded ZIP.
- [ ] Attach `kopelaeq-1.22.0.zip`, source ZIP, and `SHA256SUMS.txt` to the release.
- [ ] Enable an appropriate security-reporting/contact path.

## Chrome Web Store publication

- [ ] Host the privacy policy at a public HTTPS URL.
- [ ] Ensure Store privacy answers exactly match actual local-only audio/settings behavior.
- [ ] Use the single-purpose statement and permission justifications in `STORE_LISTING.md`.
- [ ] Upload only `dist/kopelaeq-1.22.0.zip`.
- [ ] Use current screenshots only; do not use old Page Workspace screenshots.
- [ ] Confirm developer support/contact information.
- [ ] Confirm 2-Step Verification on the developer account.
