# KopelaEQ 1.22 architecture

## Compatibility boundary

1.21.1 is the accepted audible/UI baseline. 1.22 is a release-hardening pass and does not intentionally change DSP topology or tuning.

The browser-native EQ golden fixture remains the release response reference at 44.1 and 48 kHz.

## Runtime components

- `CaptureManager` owns one serialized capture lifecycle per tab: `idle | starting | active | stopping`.
- The MV3 service worker owns storage/state coordination and tab-capture orchestration.
- The offscreen document owns the persistent `AudioContext` and one `AudioSession` per captured tab.
- `AudioSession` owns the Web Audio graph, analyser side chains, and resource disposal.
- `BypassGate` owns click-free dry/wet transitions and the processor input connection lifecycle.
- `NativeEqResponse` uses `BiquadFilterNode.getFrequencyResponse()` for graph visualization.

## Message trust boundary

Chrome runtime input is treated as `unknown`.

1.22 keeps two runtime parsers:

- `parseBackgroundMessage()`
- `parseOffscreenMessage()`

They reject unknown message names, invalid tab ids, invalid meter options, missing capture state/protection data, missing state/protection update payloads, and non-boolean persistence flags. Typed exhaustive switches only run after parsing.

The project also defines the subset of Chrome APIs it actually uses instead of declaring the entire `chrome` object as `any`. This keeps the TypeScript boundary useful without adding a large runtime dependency.

## Capture lifecycle

For each tab, start/stop operations are serialized. Before requesting another stream id, `CaptureManager` checks both the offscreen session state and `chrome.tabCapture.getCapturedTabs()`.

A generated stream id is consumed by the offscreen document through `getUserMedia()` using Chromium's tab-capture constraints. Chrome 116 is the minimum supported version because the service-worker-to-offscreen stream-id flow and capture status APIs used by this implementation are supported there.

## Audio graph

```text
Tab MediaStream
  -> input Gain
  -> Low Shelf
  -> 9 x Peak
  -> High Shelf
  -> master Gain
  -> Dynamics dry/wet bypass
  -> Protection dry/wet bypass
  -> AudioContext.destination
```

When Dynamics or Protection is disabled, the associated processor input is physically disconnected after the click-free transition.

## Meter/Spectrum topology

Analyser branches fan out from the signal but never reconnect to the audible graph:

```text
DynamicsOut
   |
ProtectionIn ---> pre L/R analyser side-chain
   |
Protection
   |
ProtectionOut --> post L/R analyser side-chain
              --> Spectrum analyser side-chain
   |
Destination
```

Unused analyser branches disconnect after the idle timeout.

## Build/release model

`static/` is the non-code extension shell. `src/` is compiled to `extension/js/` as browser-native ESM.

The official 1.22 build uses TypeScript 5.8.3 directly. No bundling or minification occurs. This keeps generated code close to source and removes an unverified second transpiler path.

Release ZIP files are deterministic:

- file order is sorted;
- archive timestamps are fixed;
- file mode metadata is normalized;
- SHA-256 hashes are regenerated and verified;
- source/tests/scripts cannot leak into the Chrome Web Store ZIP.
