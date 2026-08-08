# KopelaEQ 1.22.0

First frozen public-release baseline of KopelaEQ.

### Highlights

- 11-band parametric EQ (`Low Shelf + 9 Peak + High Shelf`)
- bundled and user presets
- optional Dynamics and output Protection with true bypass behavior
- Pre/Post Protection Meter and Spectrum
- per-tab Manifest V3 capture lifecycle
- strict TypeScript / native ESM architecture
- deterministic release archives with SHA-256 verification

### Audio compatibility

The accepted EQ response is protected by browser-native golden tests at 44.1 and 48 kHz. The 1.22.0 release-hardening work does not intentionally retune the audio DSP.

### Files

- `kopelaeq-1.22.0.zip` — Chrome/Chromium release package
- `kopelaeq-1.22.0-source.zip` — source, tests, QA and release tooling
- `SHA256SUMS.txt` — SHA-256 checksums

See `README.md`, `PRIVACY.md`, `SECURITY.md`, `QA_REPORT.md`, and `RELEASE_CHECKLIST.md` in the source archive.
