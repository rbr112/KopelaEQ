# KopelaEQ v1.22.0

The first frozen public-release baseline of **KopelaEQ** — a real-time parametric EQ and audio-processing extension for Chromium tabs.

## Highlights

- **11-band parametric EQ** — Low Shelf + 9 Peak bands + High Shelf
- **Bundled and user presets** with import/export and full preset management
- **Optional Dynamics** with click-free true bypass
- **Output Protection** with Light / Medium / Strong modes
- **Pre/Post Protection Meter** with Peak, RMS, Peak Hold and gain reduction
- **Spectrum analyser** with Fast / Balanced / Smooth response modes
- **Per-tab Manifest V3 capture lifecycle** with safe Start/Stop handling
- **Strict TypeScript + native ESM** architecture
- **Local audio processing** — KopelaEQ does not intentionally upload captured tab audio
- **Deterministic release archives** with SHA-256 verification

## Audio compatibility

The accepted 1.22.0 EQ response is protected by browser-native golden tests at **44.1 kHz and 48 kHz**.

Release-hardening changes do not intentionally retune EQ, Dynamics or Protection. The final automated golden-response comparison reports **0 dB maximum difference** from the frozen reference.

## Install

1. Download `kopelaeq-1.22.0.zip` below.
2. Extract it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder.
6. Open a normal tab with audio and enable **Audio On** in KopelaEQ.

## Release files

- **`kopelaeq-1.22.0.zip`** — ready-to-load Chrome/Chromium extension
- **`kopelaeq-1.22.0-source.zip`** — source, tests, QA and release tooling
- **`SHA256SUMS.txt`** — release checksums

### SHA-256

```text
8f182ac7e2303f12f57f2350f77fe37d685abc18d49456237d457de676fb5b7a  kopelaeq-1.22.0.zip
dee8aa3b1d0d982ec7db8193212495ab4813329b1690e21be3724caabc6d5956  kopelaeq-1.22.0-source.zip
```

## Documentation

See the repository for the [README](README.md), [Privacy Policy](PRIVACY.md), [Security Policy](SECURITY.md), [Architecture](ARCHITECTURE.md), [QA Report](QA_REPORT.md) and [Changelog](CHANGELOG.md).

---

**Maintained by Kopela.**
