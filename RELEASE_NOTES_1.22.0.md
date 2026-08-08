# KopelaEQ 1.22.0 — Final

1.22.0 freezes the accepted KopelaEQ audio/UI baseline and completes the release-hardening work started after 1.21.1. No EQ, Dynamics, or Protection retuning is intended in this release.

## Code/runtime

- Replaced the global `chrome: any` boundary with minimal typed declarations for the Chrome APIs KopelaEQ actually uses.
- Tightened runtime parsing before typed/exhaustive message switches.
- Removed unreachable duplicate handler code found during audit.
- Kept capture lifecycle, EQ topology, Dynamics, Protection, and analyser topology compatible with the accepted baseline.

## Audio compatibility

- EQ topology remains `Low Shelf + 9 Peak + High Shelf`.
- Browser-native golden EQ response tests pass at 44.1 and 48 kHz with `0 dB` maximum difference against the frozen reference fixture.
- Meter/Spectrum analyser side chains remain output-transparent in the automated OfflineAudioContext comparison.

## Privacy/UI

- Popup visibly states `Audio stays on this device`.
- Status output uses accessible live-status semantics.
- Privacy and Store disclosure documentation is included with the source release.

## Build/release

- Production compilation uses TypeScript 5.8.3 native ESM.
- The build rejects an unexpected TypeScript compiler version.
- `npm run release` runs QA, builds, packages, verifies, and writes SHA-256 hashes.
- Release/source ZIP output uses normalized ordering, timestamps, permissions, and compression settings for deterministic packaging.

## Publication status

The maintainer accepted the final RC behavior in a real-use smoke test. Chrome Web Store publication still requires account/dashboard actions outside the source tree, including hosting the privacy policy at a public HTTPS URL and completing the Store privacy disclosures.
