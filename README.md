# KopelaEQ 1.28.8

Maintainer: **Kopela**

KopelaEQ is a Manifest V3 Chrome/Chromium extension for real-time processing of audio from the tab selected by the user. The current 1.28 release keeps the layer-based visual customization and right-side Appearance inspector, ships the supplied Rice portrait as preloaded local artwork that behaves like an already-uploaded image, and further shortens popup startup by lazy-loading media/validator modules and parallelizing independent status/preset work. The frozen 1.21.1 EQ baseline and accepted 1.23 DSP behavior remain unchanged.

## Release status

**1.28.8 is an icon-only refinement over 1.28.7. It uses the cleaner manga catgirl/audio artwork at every Chrome icon size with the full composition kept inside the canvas, while DSP, permissions, state schema, persistence and concurrency behavior remain unchanged.**

Automated QA passes in the provided environment. One Pitch browser capability check remains intentionally manual before Store publication: running the emitted AudioWorklet from an unpacked extension in normal Chrome Stable, followed by a 30–60 minute Chrome Task Manager CPU/RAM/listening soak with Pitch Down enabled. The available headless Chromium exposes `AudioContext` but not `audioWorklet.addModule`, so that capability is reported as `SKIP`, not a false pass.

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

Important ordering guarantees:

- Pitch Shift is after EQ/master gain and before Dynamics so its artifacts/peaks still reach downstream control stages.
- Stereo is after Dynamics and before Protection so widening-induced peak growth can still be caught by Protection.
- Reverb and Auto-pan are the remaining post-Protection creative stages. Delay/Exciter are retained only as disabled compatibility state and are no longer exposed.
- Pre/Post Protection meters retain their existing semantic position; Spectrum observes the final post-effects signal.

## Audio features

- **Stereo:** Width 0–200%, Balance −100…+100%, Mono, and Swap L/R using a Mid/Side graph.
- **Pitch Down:** 0 to −12 semitones at 1× wall-clock throughput using the accepted realtime down-shift core. Upward shifting is intentionally not exposed because speech quality was not reliable enough.
- **Reverb:** Room/Hall/Plate synthetic impulse responses generated locally with diffuse attack, early reflections, progressive HF damping, and independent stereo noise; no third-party IR assets or licenses.
- **Auto-pan / 8D:** rate and depth controls with an LFO created only while the processor branch is active.
- **Effects navigation:** the main strip stays compact (`Preset · Dynamics · Stereo · Protect · Meter · Effects · •••`) while Pitch Down/Reverb/8D live under one Effects launcher.
- **Panel UX:** Audio Tools remains visible in both themes. In Rice and Nocturne every audio tool uses the same exclusive workspace-page surface without moving the shell; opening a tool closes the precise Band Editor so EQ drag targets are never hidden beneath stacked inspectors. `Esc` closes the active panel and utility popovers remain lightweight overlays.
- **EQ visualization:** the graph now spans the full accepted DSP frequency range **5 Hz–20 kHz**, so valid sub-20-Hz preset bands (for example 17 Hz) have a real logarithmic position instead of being pinned outside a 20-Hz-only view.
- **Popup modularization:** `index.ts` remains orchestration-only and the EQ, Meter, and Preset UI logic live in dedicated DI modules.
- Defensive Chrome capture-error string pinning and an explicit minimum-Chrome-version checklist item.
- `AUDIO_BASELINE_VERSION = 4` and schema v4 migration keep all 1.23 DSP modules disabled for existing users.

## Custom themes

Open **Appearance → Custom themes → Import** to add a local JSON theme. KopelaEQ validates every imported token before registration and stores valid themes under `kopelaeq.customThemes`. Built-in theme IDs are reserved and cannot be overwritten. Removing the currently active custom theme falls back to Rice.

A minimal theme can inherit almost everything from a built-in theme and override only a few tokens:

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

The Appearance panel also has **Download example**. Theme files are limited to 64 KB and the library to 20 custom themes. Custom themes are visual only: they cannot alter audio/DSP state, execute code, load remote URLs, or add arbitrary remote artwork. Custom theme JSON may define `tokens.surface.main`, `surface.eq`, `surface.cards`, `surface.tools`, and `surface.controls` with `{color, opacity}`. Theme colors (`accent`, `border`, `text`, `textMuted`), radius, blur, shadow strength and artwork dimming are also exposed in **Surface customization**. Local controls override the active theme without editing the source JSON; **Reset all** restores the resolved theme defaults. **Export selected** materializes overrides into an imported custom theme, while **Export current look** downloads a standalone JSON containing the effective visual settings of any active theme.

### Local artwork and background

Open **Appearance → Artwork card → Upload** to replace the square Rice artwork, or **Appearance → Background → Upload** to replace the full popup backdrop. Both accept local PNG, JPG, WebP or animated GIF files and are stored separately for each selected theme in extension IndexedDB, with a 12 MB per-file limit. **Cover** fills its target and may crop only for display; **Contain** keeps the whole original image visible. **Remove** restores the selected theme default. Artwork-card and background overrides are independent and are never uploaded by KopelaEQ.

## Compatibility / presets

Bundled and user presets continue to describe the established EQ/Dynamics preset surface. Applying a preset does not unexpectedly enable Pitch, Stereo, Reverb, or Auto-pan.

Legacy saved state without the 1.23 fields is normalized to safe defaults. On the first v1.23/v4 baseline migration, Pitch, Dynamics, Stereo, Reverb, Delay, Auto-pan, and Exciter are explicitly normalized with `enabled: false`.

The graph display range is now 5 Hz–20 kHz, matching the existing state normalization range. This changes visualization only; it does not clamp or rewrite previously valid sub-20-Hz preset frequencies.

## Pitch Shift expectations

1.23.5 intentionally exposes only downward Pitch (0 to −12 semitones). The accepted 1.23.1 down-shift path is preserved; upward Pitch was removed after repeated listening tests found unacceptable robotic coloration on speech.

## Source layout

```text
src/
  shared/       state/schema, message contracts, presets, constants
  audio/        AudioSession, BypassGate, Stereo/effect stages, Pitch core/worklet
  background/   CaptureManager + MV3 service worker
  offscreen/    persistent AudioContext/session runtime + lazy worklet loader
  popup/        popup orchestration, EQ/Meter/Preset modules, PanelManager
  types/        minimal Chrome API declarations used by this project
```

## Build

Requirements:

- Node.js 20+
- TypeScript **5.8.3**
- Python 3
- Chrome/Chromium + Playwright for browser QA

```text
npm install
npm run typecheck
npm run build
npm run qa
npm run release
```

`npm run build` emits browser-native ESM with TypeScript 5.8.3 and copies the plain-JS AudioWorklet processor to `extension/js/audio/pitch-worklet-processor.js`. No bundling, remote code, or minification is used.

`npm run release` runs the QA suite, rebuilds the extension, creates deterministic release/source ZIP files, verifies archive contents, and writes `dist/SHA256SUMS.txt`.

## Install locally

1. Build with `npm run build`, or extract the release ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `extension/` (or the extracted release directory).
5. Open a normal web tab with audio, open KopelaEQ, and enable **Audio On**.
6. Before publication, enable Pitch Down on dry speech and confirm the worklet processes audio without console errors or dropouts.

Restricted browser pages such as `chrome://` pages and the Chrome Web Store cannot be captured.

## Permissions

KopelaEQ requests only:

- `activeTab` — identifies the tab selected by the user;
- `tabCapture` — obtains that tab's audio;
- `offscreen` — hosts the Web Audio graph under MV3;
- `storage` — stores settings, presets, popup layout, appearance selection, and imported custom theme definitions. User artwork/background files are stored locally in extension IndexedDB instead of Chrome storage.

There are no host permissions, content scripts, page injection, remote executable code, analytics, advertising SDKs, or developer-controlled network requests. Reverb impulse responses are generated inside the extension instead of downloaded.

## Verification

The automated suite covers strict TypeScript, runtime boundary validation, capture lifecycle, exact presets, physical bypass/disconnect behavior, Stereo math, Reverb IR behavior, Pitch Down frequency math/negative-path hashes/core CPU budget, EQ graph geometry down to 5 Hz, browser-native EQ golden response, analyser transparency, new-stage dry-path equality, Chromium UI rendering, and deterministic archive verification.

See [`QA_REPORT.md`](QA_REPORT.md) and [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).

## Privacy

Selected-tab audio is processed locally in the browser and is not intentionally recorded or uploaded by KopelaEQ. Settings, presets, appearance selection, and imported custom theme definitions are stored locally through Chrome storage. User-uploaded artwork and backgrounds are stored locally in extension IndexedDB. See [`PRIVACY.md`](PRIVACY.md).

## Security

See [`SECURITY.md`](SECURITY.md). Do not include captured personal audio in public security reports.

## License

KopelaEQ is released under the MIT License. See [`LICENSE`](LICENSE).
