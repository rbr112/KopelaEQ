# Chrome Web Store listing draft — KopelaEQ 1.22.0

Maintainer: **Kopela**

## Name

KopelaEQ

## Short description

Real-time EQ, gain, dynamics, spectrum metering, presets and output protection for the current browser tab.

## Single purpose

KopelaEQ processes audio from the browser tab explicitly selected by the user so the user can adjust that tab's sound in real time.

All included features are directly related to that purpose: Gain, parametric EQ, Dynamics, Spectrum/Meter, presets, and final output Protection.

## Permission justifications

### activeTab

Used only to identify and target the tab on which the user invoked KopelaEQ. `getMediaStreamId({ targetTabId })` requires access to that target tab.

### tabCapture

Required to obtain the selected tab's audio stream after the user turns Audio on.

### offscreen

Required by the Manifest V3 architecture to run the Web Audio graph in a document context while the extension service worker remains event-driven.

### storage

Stores audio settings, presets, Spectrum preferences, and popup panel positions locally.

## User-data disclosure draft

KopelaEQ handles the selected tab's audio only to provide real-time audio processing. Audio is processed locally in memory and is not intentionally recorded, transmitted to the developer, sold, or shared with third parties.

The extension also stores user-selected settings and presets locally. Older Chrome Sync preset data may be read once for compatibility migration.

The popup visibly states that audio stays on the device before the user enables capture.

## Remote code / network

- No remote JavaScript or WebAssembly.
- No `eval` or `new Function`.
- No developer-controlled `fetch`, XMLHttpRequest, WebSocket, or analytics endpoint.
- No host permissions.
- No content scripts or page injection.

## Suggested category

Productivity / Tools, whichever closest category is available in the current developer dashboard.

## Suggested screenshots

Use current 1.22 screenshots showing:

1. Main EQ with a bundled preset selected.
2. Precise band editor.
3. Meter with Pre/Post Protection.
4. Preset Actions panel.
5. Dynamics panel if an additional screenshot is useful.

Do not use obsolete Page Workspace screenshots from older development versions.

## Dashboard items the maintainer must complete manually

- Host `PRIVACY.md` at a public HTTPS URL and enter that URL in the Privacy field.
- Complete the current data-use questionnaire so it matches this document and actual behavior.
- Enter the single-purpose statement above.
- Enter each permission justification above.
- Add current screenshots, icon, support/contact details, and category.
- Ensure the developer account has required 2-Step Verification enabled.
