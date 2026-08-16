# Chrome Web Store listing draft — KopelaEQ 1.28.15

Maintainer: **Kopela**

## Name

KopelaEQ

## Short description

Real-time tab EQ with stereo tools, pitch/effects, dynamics, meters, presets and output protection.

## Single purpose

KopelaEQ processes audio from the browser tab explicitly selected by the user so the user can adjust and monitor that tab's sound in real time.

All included capabilities serve that audio-processing purpose: Gain, parametric EQ, Stereo Width/Balance/Mono/Swap, Pitch Down, Reverb, Auto-pan, Dynamics, Spectrum/Meter, presets, and output Protection.

## Permission justifications

### activeTab

Used only to identify and target the tab on which the user invoked KopelaEQ. `getMediaStreamId({ targetTabId })` requires access to that target tab.

### tabCapture

Required to obtain the selected tab's audio stream after the user turns Audio on.

### offscreen

Required by the Manifest V3 architecture to host the Web Audio graph and AudioWorklet in a document context while the extension service worker remains event-driven.

### storage

Stores audio settings, presets, Spectrum preferences, popup panel positions, appearance selection, and imported custom theme definitions locally. Optional image/GIF artwork-card and full-background files are stored separately in the extension's local IndexedDB database.

## User-data disclosure draft

KopelaEQ handles the selected tab's audio only to provide real-time audio processing. Audio is processed locally in memory and is not intentionally recorded, transmitted to the developer, sold, or shared with third parties.

The extension stores user-selected settings, presets, UI layout, appearance selection, and imported custom theme JSON locally. If the user uploads artwork for the square theme card or a full theme background, those PNG/JPEG/WebP/GIF files are stored locally in extension IndexedDB and are not transmitted. Older Chrome Sync preset data may be read once for compatibility migration.

Reverb impulse responses are generated locally by the extension. Pitch processing loads only extension-packaged code from the extension's own origin. No audio asset or DSP code is downloaded from a remote server.

## Remote code / network

- No remote JavaScript or WebAssembly.
- No `eval` or `new Function`.
- No developer-controlled `fetch`, XMLHttpRequest, WebSocket, analytics, or ad endpoint.
- No host permissions.
- No content scripts or page injection.
- No remote reverb IR assets.

## Suggested category

Productivity / Tools, whichever closest category is available in the current developer dashboard.

## Suggested screenshots

Use current 1.28.15 screenshots showing real extension UI and readable controls, for example:

1. Main 11-band EQ with a bundled preset, showing the full 5 Hz–20 kHz graph range.
2. Stereo panel with Width/Balance/Mono/Swap.
3. Pitch panel with semitone control and latency note.
4. Meter showing Pre/Post Protection without covering the persistent module strip.
5. Effects launcher showing Pitch Down/Reverb/8D, plus one opened effect panel.
6. Appearance panel showing Rice/Nocturne, local artwork controls, and an imported custom theme.

Do not use obsolete pre-1.24 screenshots that show the older overlapping Rice tool panels or clipped Audio Tools states.

## Dashboard items the maintainer must complete manually

- Host `PRIVACY.md` at a public HTTPS URL and enter it in the Privacy field.
- Complete the current data-use questionnaire so it matches this document and actual behavior.
- Enter the single-purpose statement above.
- Enter each permission justification above.
- Add current screenshots, icon, support/contact details, and category.
- Ensure the developer account has required 2-Step Verification enabled.

### Appearance customization
Rice/Nocturne themes support local artwork/background images or GIFs plus per-theme Main panel and Audio Tools tint/transparency controls. Visual files and overrides stay on the device and never affect audio processing.
