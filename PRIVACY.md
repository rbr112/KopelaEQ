# Privacy policy — KopelaEQ

KopelaEQ processes audio from the tab explicitly selected by the user **locally in the browser**. It contains no analytics, advertising code, telemetry, remote scripts, or developer-controlled backend.

Tab audio is obtained through Chrome `tabCapture`, processed in memory with Web Audio, and routed back to browser output. KopelaEQ does not intentionally record, upload, sell, or share the captured audio.

## Local data

KopelaEQ may store these settings in `chrome.storage.local`:

- current Gain/EQ/Dynamics state;
- Protection mode;
- Spectrum preference and response mode;
- user presets and migrated bundled presets;
- selected preset identity per tab while applicable;
- positions of floating panels inside the extension popup.

Older Chrome Sync preset data may be read once for migration compatibility. New preset changes are stored locally.

Meter values, Peak Hold, Protection activity, and frozen Spectrum frames are runtime UI data. They are not uploaded and are not persisted as captured audio.

## Permissions

KopelaEQ requests only:

- `activeTab` — access to the tab on which the user invokes the extension so it can be selected for capture;
- `tabCapture` — capture that selected tab's audio after the user enables processing;
- `offscreen` — host the persistent Web Audio graph required by Manifest V3;
- `storage` — save settings, presets, and popup layout.

KopelaEQ requests no host permissions and no `scripting` permission. It does not inject controls into websites.

## Network use

KopelaEQ makes no developer-controlled network requests. Audio and settings are not transmitted to the maintainer or to third parties by the extension.

## Chrome Web Store Limited Use

KopelaEQ's use of information obtained through Chrome APIs is limited to providing its user-facing tab-audio processing functionality. The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Custom themes

Imported theme JSON is validated and stored locally in Chrome storage. KopelaEQ does not upload custom themes to the developer or fetch remote code/assets from theme files.


## Local artwork and background files

If you choose an image or animated GIF for the artwork card or the full theme background, KopelaEQ stores that file locally in the extension's IndexedDB database. Card artwork and background files are keyed separately to the selected theme, are not synchronized through Chrome storage, and can be removed from Appearance at any time. Supported files are PNG, JPEG, WebP, and GIF up to 12 MB per file.
