# KopelaEQ 1.22.0

Maintainer: **Kopela**

KopelaEQ is a Manifest V3 Chrome/Chromium extension for real-time processing of the audio from the tab selected by the user. It provides Gain, an 11-band parametric EQ, optional Dynamics, Meter/Spectrum, presets, and output Protection.

## Release status

**1.22.0 is the frozen first public-release baseline.**

The release hardens the accepted 1.21.1 audio/UI baseline without retuning the EQ, Dynamics, or Protection DSP. The maintainer has completed a real-use smoke test and accepted the current sound/behavior. Longer device-specific soak testing remains a recommended pre-Store check and is listed in `RELEASE_CHECKLIST.md`.

## Audio path

The audible path is:

`Tab -> input gain -> Low Shelf + 9 Peak + High Shelf -> master gain -> Dynamics bypass -> Protection bypass -> Output`

Meter/Spectrum branches are analyser-only side chains and do not feed back into the audible output.

## Highlights

- 11-band EQ with the original `Low Shelf + 9 Peak + High Shelf` topology.
- Native `BiquadFilterNode.getFrequencyResponse()` visualization using the real engine sample rate when available.
- Exact bundled-preset fixtures and browser-native golden EQ tests at 44.1/48 kHz.
- Click-free shared `BypassGate` for Dynamics and Protection.
- Per-tab capture lifecycle with explicit `idle / starting / active / stopping` states.
- Pre/Post Protection metering, peak hold, gain-reduction display, and Spectrum modes.
- TypeScript strict mode, typed runtime messages, and runtime validation at Chrome message boundaries.
- Deterministic release/source ZIP generation and SHA-256 verification.

## Source layout

```text
src/
  shared/       message contracts, state, presets, constants
  audio/        AudioSession, BypassGate, native EQ response
  background/   CaptureManager + MV3 service worker
  offscreen/    offscreen audio-session runtime
  popup/        popup, EQ editor, draggable internal panels
  types/        minimal Chrome API declarations used by this project
```

## Build

Requirements:

- Node.js 20+
- TypeScript **5.8.3**
- Python 3 for QA/release ZIP scripts
- Chrome/Chromium for browser QA tests

```text
npm install
npm run typecheck
npm run build
npm run qa
npm run release
```

`npm run build` emits browser-native ESM with TypeScript 5.8.3. The build fails if another TypeScript compiler version is used.

`npm run release` runs the QA suite, rebuilds the extension, creates deterministic release/source ZIP files, verifies archive contents, and writes `dist/SHA256SUMS.txt`.

## Install locally

1. Build the extension with `npm run build`, or extract the release ZIP.
2. Open `chrome://extensions` in Chrome/Chromium.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the built `extension/` directory (or the extracted release ZIP directory).
5. Open a normal web tab with audio, click KopelaEQ, and enable **Audio On**.

Restricted browser pages such as `chrome://` pages and the Chrome Web Store cannot be captured.

## Permissions

KopelaEQ requests only:

- `activeTab` — targets the tab on which the user invoked the extension;
- `tabCapture` — obtains audio from that user-selected tab;
- `offscreen` — hosts the Web Audio graph under Manifest V3;
- `storage` — stores settings, presets, and popup layout.

There are no host permissions, content scripts, page injection, remote executable code, analytics, advertising SDKs, or developer-controlled network requests.

## Privacy

Selected-tab audio is processed locally in the browser and is not intentionally recorded or uploaded by KopelaEQ. Settings and presets are stored locally through Chrome storage. See [`PRIVACY.md`](PRIVACY.md).

## Verification

The automated suite covers TypeScript, runtime message validation, capture lifecycle, exact presets, bypass transitions, browser-native EQ golden responses, analyser transparency, Chromium UI rendering, archive policy checks, and deterministic packaging.

See [`QA_REPORT.md`](QA_REPORT.md) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

## Security

See [`SECURITY.md`](SECURITY.md) for reporting guidance. Do not post captured personal audio in public security reports.

## License

No open-source license has been selected for this repository yet. Copyright remains with the maintainer unless a license is added later.
