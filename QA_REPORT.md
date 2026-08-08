# KopelaEQ 1.22.0 — Final QA report

Date: 2026-08-08
Maintainer: **Kopela**

## Result

**Automated release audit: PASS.**

**Automated release engineering is signed off.** The maintainer also accepted the RC in a real-use smoke test. The following device/environment checks still cannot be truthfully certified by this container:

1. real-device listening A/B on the maintainer's audio hardware;
2. 30–60 minute Chrome Task Manager CPU/RAM soak with real captured media;
3. clean-machine dependency installation from the public npm registry (this environment's internal npm mirror returns 404 for TypeScript).

The generated ZIP is the frozen 1.22.0 release artifact. The remaining items are publication/environment checks rather than known code blockers.

## Baseline / audio compatibility

1.22 intentionally preserves 1.21.1 DSP tuning.

The following source files are byte-identical to 1.21.1:

- `src/audio/audio-session.ts`
- `src/audio/bypass-gate.ts`
- `src/audio/eq-response.ts`
- `src/shared/constants.ts`
- `src/shared/state.ts`
- `src/shared/default-presets.ts`
- `src/shared/presets.ts`

Browser-native golden response tests passed at **44.1 kHz and 48 kHz with maximum error 0 dB**.

Meter side-chain transparency test passed with **maximum audible-path sample delta 0** over 4096 frames.

3-band crossover math test passed with **0.0171 dB maximum ripple**.

## Code audit findings fixed in 1.22

### Chrome API typing

Previous builds declared the whole `chrome` namespace as `any`, which weakened the value of strict TypeScript at the browser boundary.

1.22 defines only the Chrome API subset used by KopelaEQ: runtime messaging, storage, tabs, tabCapture, and offscreen. Background code no longer uses `sender: any` or tabCapture callback `any`.

### Runtime message validation

Runtime messages still enter as `unknown`, then pass through typed parsers before exhaustive switches.

Additional rejected cases now include:

- non-boolean `STATE_SET.persist`;
- `CAPTURE_START` missing state/protection data;
- offscreen `STATE_SET` missing `state`;
- offscreen `PROTECTION_SET` missing `protection`.

Regression tests cover all of these cases.

### Unreachable handler code

A duplicated unreachable `return assertNever(message)` was found in the offscreen switch and removed.

## Capture lifecycle

Automated tests cover:

- invalid tab ids;
- first Start;
- duplicate Start while active without requesting another stream id;
- State/Protection propagation;
- Stop;
- pending stream-id Start followed by Stop;
- rapid Start -> Stop -> Start;
- active-stream browser race and retry;
- service-worker restart reconciliation;
- **100 sequential Start/Stop cycles**;
- two simultaneously active tab sessions followed by clean disposal.

The user-facing raw Chrome error `Cannot capture a tab with an active stream` is not emitted by the popup path.

## Security / privacy audit

Release permissions are exactly:

- `activeTab`
- `tabCapture`
- `offscreen`
- `storage`

There are:

- no host permissions;
- no `scripting` permission;
- no content scripts;
- no web-page injection;
- no remote JavaScript/WebAssembly;
- no `eval` / `new Function`;
- no developer-controlled `fetch`, XMLHttpRequest, WebSocket, or HTTP(S) endpoint in emitted extension JavaScript.

Popup CSP remains:

`script-src 'self'; object-src 'self'`

The popup now visibly states **Audio stays on this device**. The privacy policy states that selected-tab audio is processed locally and is not intentionally recorded or uploaded.

## Chrome Web Store policy review

Reviewed against current official Chrome extension / Chrome Web Store documentation on 2026-08-08.

Findings:

- The extension has a narrow single purpose: user-invoked current-tab audio processing.
- `tabCapture` is required for the feature.
- `activeTab` is justified because `getMediaStreamId({targetTabId})` can target only tabs for which activeTab access has been granted.
- Chrome 116 minimum is technically justified by the service-worker stream-id flow to an offscreen document and the capture APIs used by this implementation.
- `offscreen` is used only for the persistent Web Audio document context.
- Local-only processing still needs accurate privacy disclosure; `PRIVACY.md` and `STORE_LISTING.md` are prepared accordingly.
- Before Store upload, the maintainer must host the privacy policy on a public HTTPS page and ensure dashboard privacy answers match actual behavior.

## Build / release pipeline

### Compiler

The official 1.22 build path is TypeScript **5.8.3** emitting browser-native ESM.

The build script fails if `tsc --version` is not exactly `Version 5.8.3`.

The earlier esbuild path was removed as the official path because KopelaEQ does not bundle/minify, and maintaining two transpilers created an unverified release branch without changing the extension's module architecture.

### Deterministic packaging

Release ZIP generation now normalizes:

- sorted entry order;
- fixed ZIP timestamps (`2020-01-01 00:00:00`);
- normalized file mode metadata;
- compression settings.

`verify_release.py` additionally checks:

- no duplicate entries;
- correct manifest/version/permissions;
- no source/tests/scripts in the Store ZIP;
- no dynamic/remote-code patterns in packed JS;
- deterministic archive metadata;
- SHA-256 values match `SHA256SUMS.txt`.

A final double-build hash comparison is performed before release-candidate handoff.

### Dependency-install limitation of this environment

The container has TypeScript 5.8.3 installed and the complete build/typecheck passed with it. However, its configured internal npm registry returns HTTP 404 for `typescript@5.8.3`, so a fresh `npm install`/lockfile generation cannot be validated here. This is an environment limitation, not a runtime dependency of the extension. The source `package.json` pins TypeScript exactly to `5.8.3`.

## Automated suite

PASS:

- TypeScript strict typecheck
- production build
- syntax check for all emitted JS modules
- shared state tests
- exact bundled preset fixture
- runtime message contract/parser tests
- BypassGate transitions
- AudioSession
- offscreen runtime
- CaptureManager lifecycle
- background runtime
- MV3/static/security audit
- 3-band crossover math
- golden browser-native EQ response at 44.1/48 kHz
- analyser side-chain output transparency
- Chromium popup UI QA

Chromium popup QA result:

- CSS viewport: **744 x 580**, no root overflow
- native EQ response benchmark: approximately **0.65 ms average / 1.2 ms p95** in the final pre-release QA run (640 frequencies x 11 bands)
- custom dark preset menu: PASS
- band editor: PASS
- preset workflow: PASS
- Meter / latched clip state / drag: PASS

## Remaining manual / publication checks

- extended device-specific listening/A-B if desired beyond the maintainer smoke test;
- 30–60 minute real Chrome Task Manager soak;
- test on restricted pages and real multi-tab media;
- Windows 100/125/150% display-scale check where available;
- clean-machine `npm install && npm run release` using the normal public registry;
- choose a GitHub repository license;
- host privacy policy and complete Chrome Web Store dashboard fields;
- confirm developer account 2-Step Verification and support/contact details.
