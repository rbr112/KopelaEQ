# Changelog

All notable public KopelaEQ changes are summarized here. Detailed historical release notes may exist in older project archives.

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
