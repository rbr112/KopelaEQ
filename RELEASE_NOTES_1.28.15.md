# KopelaEQ 1.28.15

1.28.15 removes the experimental fixed Auto Headroom from Maximum Protection. **Strong remains the default and its DSP profile is unchanged.**

## Maximum is now peak-only

Maximum uses the same primary Protection profile as Strong, then adds one final post-effects true-peak-aware peak catcher immediately before output. There is no predictive or constant gain reduction: material below the final ceiling stays at unity gain apart from the intentional lookahead delay.

The final catcher uses:

- stereo-linked 4× polyphase true-peak detection;
- approximately 5 ms lookahead;
- a −1.25 dBTP target with a small internal reconstruction margin;
- a short 6 ms hold to prevent rapid gain bounce around one transient;
- an 80 ms smooth release;
- post-limit true-peak feedback and a linked emergency sample ceiling.

This keeps Maximum focused on short final peaks that can appear after Reverb/AutoPan instead of lowering the whole signal in advance.

## UI

The Protection panel no longer shows a Headroom value. Maximum exposes only final **True peak** and **Peak catch** reduction, matching the processing that is actually active.

## Verification

- 42/42 Node regression suites PASS.
- Sub-ceiling Maximum transparency regression PASS: no fixed gain cut.
- Isolated-transient recovery regression PASS.
- Independent 16×/64-tap true-peak reconstruction PASS.
- Strong/Maximum primary Protection profiles are identical by test.
- TypeScript, build, static topology/security checks, DSP/stereo math PASS.
- Browser EQ golden response remains 0 dB different at 44.1/48 kHz.
- Meter audible path and disabled Pitch/Stereo/Reverb/AutoPan dry paths remain 0 sample delta.

The supplied headless Chromium still does not expose `audioWorklet.addModule`; listening and CPU smoke tests for Maximum/Pitch remain a manual Chrome Stable gate before store publication.
