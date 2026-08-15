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

KopelaEQ is a **Manifest V3 browser extension for real-time processing of the audio from the tab you choose**. It is designed to feel more like a small desktop audio tool than a basic browser equalizer: the EQ is precise, creative effects are optional, and the interface can be heavily customized without changing the audio engine.

Audio stays local. KopelaEQ does not use content scripts, host permissions, analytics, advertising SDKs or developer-controlled network requests.

## Features

<table>
<tr>
<td width="33%" valign="top">

### Sound shaping

- 11-band parametric EQ
- 5 Hz–20 kHz visual range
- Frequency / Gain / Q fine controls
- Master gain
- Dynamics processing
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
- Custom image or animated GIF artwork
- Custom popup background
- Export the current look

</td>
</tr>
</table>

## Built for everyday use

KopelaEQ keeps the main controls close while moving less-used tools into a compact workspace. Opening an audio tool does not push the whole interface around, and precise EQ editing stays separate from larger effect panels.

The appearance system is intentionally independent from DSP. A custom theme can change the visual surface, but it cannot execute code, load remote assets or modify audio state.

## Installation

### From a release

1. Open **[Releases](https://github.com/rbr112/KopelaEQ/releases/latest)**.
2. Download `kopelaeq-1.28.8.zip`.
3. Extract the archive.
4. Open `chrome://extensions`.
5. Enable **Developer mode**.
6. Click **Load unpacked** and select the extracted KopelaEQ folder.
7. Open a normal tab with audio, open KopelaEQ and switch **Audio On**.

> Restricted pages such as `chrome://` and the Chrome Web Store cannot be captured by browser extensions.

## Custom themes and artwork

Open **Appearance → Custom themes → Import** to add a local JSON theme. Imported themes are validated before registration, built-in theme IDs cannot be overwritten, and removing the active custom theme safely falls back to Rice.

You can also replace the artwork card or the full popup background with a local PNG, JPG, WebP or animated GIF. Media is stored locally in extension IndexedDB and is never uploaded by KopelaEQ.

<details>
<summary><strong>Minimal custom theme example</strong></summary>

```json
{
  "format": "KopelaEQ Theme",
  "theme": {
    "schemaVersion": 1,
    "id": "user.my-theme",
    "name": "My Theme",
    "author": "Your name",
    "extends": "builtin.rice",
    "preferredLayout": "rice",
    "tokens": {
      "colors": {
        "accent": "#7aa2f7",
        "accentAlt": "#bb9af7"
      },
      "eq": {
        "curve": "#dfe9ef",
        "pointSelected": "#7aa2f7"
      }
    }
  }
}
```

</details>

## Audio path

```text
Tab
  → Input Gain
  → Low Shelf + 9 Peak + High Shelf
  → Master Gain
  → Pitch Down
  → Dynamics
  → Stereo
  → Protection
  → Reverb
  → Auto-pan
  → Output
```

Inactive stages are physically bypassed/disconnected where appropriate. Stereo sits before Protection so widening-induced peaks can still be controlled; Reverb and Auto-pan remain post-Protection creative stages.

## Reliability

KopelaEQ 1.28.x includes a hardened async state pipeline for Chrome MV3:

- latest-wins realtime audio-state updates;
- background-owned persistence;
- stale-response generation guards;
- authoritative startup recovery after storage timeouts;
- cross-tab offscreen lifecycle coordination;
- crash-safe recovery for local appearance media operations;
- single-flight meter polling.

This prevents the popup, storage and the active audio engine from silently drifting to different states during rapid interaction or slow Chrome API responses.

## QA

Current release validation includes:

- strict TypeScript typecheck;
- automated Node test suite;
- browser-native EQ golden-response tests at 44.1/48 kHz;
- analyser transparency and dry-path checks;
- Stereo, Reverb and Pitch math/regression tests;
- concurrency and MV3 startup-recovery tests;
- deterministic release archive verification.

See [`QA_REPORT.md`](QA_REPORT.md) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) for the detailed release gates.

## Build from source

**Requirements:** Node.js 20+, TypeScript 5.8.3, Python 3, and Chrome/Chromium + Playwright for browser QA.

```bash
npm install
npm run typecheck
npm run build
npm run qa
npm run release
```

`npm run release` runs QA, rebuilds the extension, creates deterministic release/source archives and verifies their contents.

<details>
<summary><strong>Source layout</strong></summary>

```text
src/
  shared/       state, schemas, messages, presets, constants
  audio/        AudioSession, EQ, Stereo/effects, Pitch core/worklet
  background/   CaptureManager + MV3 service worker
  offscreen/    persistent AudioContext/session runtime
  popup/        EQ, Meter, Presets, panels and Appearance system
  types/        Chrome API declarations used by the project
```

</details>

## Privacy & permissions

KopelaEQ requests only the permissions needed for its core behavior:

| Permission | Why it is used |
|---|---|
| `activeTab` | Identifies the tab selected by the user |
| `tabCapture` | Captures that tab's audio |
| `offscreen` | Hosts the Web Audio graph under Manifest V3 |
| `storage` | Stores settings, presets, layout and theme definitions |

Selected-tab audio is processed locally and is not intentionally recorded or uploaded. User artwork/background files stay in local extension IndexedDB.

See [`PRIVACY.md`](PRIVACY.md) and [`SECURITY.md`](SECURITY.md).

## Compatibility notes

- Pitch intentionally supports **downward shifting only**. Positive pitch was removed because speech quality was not reliable enough.
- Applying an EQ preset does not unexpectedly enable Pitch, Stereo, Reverb or Auto-pan.
- Legacy saved state is normalized to safe defaults during migration.
- Delay and Exciter remain only as disabled compatibility state; their runtime stages are no longer created.

## License

KopelaEQ is open source under the [MIT License](LICENSE).

<div align="center">

Maintained by **Kopela**

**[Download KopelaEQ](https://github.com/rbr112/KopelaEQ/releases/latest)**

</div>
