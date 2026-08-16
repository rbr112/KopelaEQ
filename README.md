<div align="center">

<img src="static/icons/icon-128.png" width="132" alt="KopelaEQ icon">

# KopelaEQ

### A customizable real-time audio equalizer for Chromium

Shape tab audio with a precise parametric EQ, stereo tools, dynamics, pitch down, reverb, 8D auto-pan and output protection — all processed locally in your browser.

[![Latest release](https://img.shields.io/github/v/release/rbr112/KopelaEQ?display_name=tag&style=flat-square)](https://github.com/rbr112/KopelaEQ/releases/latest)
[![License](https://img.shields.io/github/license/rbr112/KopelaEQ?style=flat-square)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square)](static/manifest.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square)](https://www.typescriptlang.org/)

**[Download latest release](https://github.com/rbr112/KopelaEQ/releases/latest)** · [Installation](#installation) · [Features](#features) · [Privacy](#privacy--permissions)

</div>

---

## What is KopelaEQ?

KopelaEQ is a Manifest V3 extension for real-time processing of audio from the tab you choose. It combines an 11-band parametric EQ with optional creative and corrective tools while keeping audio processing local to the browser.

Version **1.28.15** keeps **Strong** unchanged as the default and turns Maximum into a peak-only safety mode. Maximum uses the same primary Protection profile as Strong, then adds a post-effects stereo-linked true-peak-aware lookahead peak catcher. It applies **no constant pre-attenuation**: below-ceiling material stays at unity gain, while short final peaks get caught immediately before output.

## Features

<table>
<tr>
<td width="33%" valign="top">

### Sound shaping
- 11-band parametric EQ
- 5 Hz–20 kHz graph
- Frequency / Gain / Q fine controls
- Master gain
- Dynamics
- Output protection

</td>
<td width="33%" valign="top">

### Audio tools
- Stereo width and balance
- Mono and Swap L/R
- Pitch Down: 0 to −12 semitones
- Reverb: Room / Hall / Plate
- Auto-pan / 8D
- Meter and Spectrum

</td>
<td width="33%" valign="top">

### Personalization
- Rice and Nocturne layouts
- Importable JSON themes
- Colors, opacity, blur and shadows
- Custom image/GIF artwork
- Custom popup background
- Export current look

</td>
</tr>
</table>

## Reliability model

KopelaEQ keeps the background worker as the durable owner of desired audio state. Runtime updates use latest-wins revisions, the offscreen engine tracks requested and actually-applied revisions separately, and surviving offscreen sessions are rebased when an MV3 service worker restarts. This prevents UI, storage and the audible graph from silently drifting apart.

The first Pitch activation may need to load an AudioWorklet module. 1.28.15 retains the 1.28.10 retry behavior for transient cold-load failures and uses a longer timeout budget for Pitch/capture startup than for lightweight status or meter calls.

## Installation

### From a release
1. Download `kopelaeq-1.28.15.zip` from the latest GitHub Release.
2. Extract it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder.

### From source
Requirements: Node.js 20+, TypeScript 5.8.3, Python 3, Chrome/Chromium + Playwright for browser QA.

```text
npm install
npm run typecheck
npm run build
npm run qa
npm run release
```

## Audio path

```text
Tab
 -> input gain
 -> Low Shelf + 9 Peak + High Shelf
 -> master gain
 -> Pitch Shift bypass
 -> Dynamics bypass
 -> Stereo bypass
 -> Protection bypass
 -> Reverb bypass
 -> Auto-pan bypass
 -> Output
```

Delay and Exciter remain only as disabled compatibility fields in serialized state; their runtime AudioNodes are retired.

## Themes and local media

Use **Appearance** to switch layouts, import validated JSON themes, tune surface colors/opacity/blur/shadows, or upload local PNG/JPG/WebP/GIF artwork and backgrounds. Custom media stays in extension IndexedDB. Imported themes cannot execute code or load remote assets.

## Privacy & permissions

KopelaEQ requests only `activeTab`, `tabCapture`, `offscreen`, and `storage`. There are no host permissions, content scripts, analytics, advertising SDKs, remote executable code, or developer-controlled network requests. Selected-tab audio is processed locally and is not intentionally recorded or uploaded by KopelaEQ.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## QA

1.28.15 passes 42/42 Node regression suites plus strict TypeScript, static topology/security checks, browser UI QA, DSP/stereo math, the frozen EQ golden response at 44.1/48 kHz, analyser transparency, and disabled-stage dry-path checks. The supplied headless Chromium does not expose `audioWorklet.addModule`, so final Pitch and Maximum Worklet listening/CPU checks remain manual Chrome Stable smoke tests.

See [QA_REPORT.md](QA_REPORT.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## License

MIT — see [LICENSE](LICENSE).
