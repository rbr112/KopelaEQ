# KopelaEQ 1.22.1

## Capture reliability

- Repairs audio loss when a Chromium tab keeps producing sound while the captured MediaStream track remains muted after a media-source transition.
- Uses the browser's `Tab.audible` signal together with MediaStreamTrack health instead of treating silence alone as a failure.
- Tolerates short `mute -> unmute` transitions without restarting capture.
- Resumes a suspended AudioContext without rebuilding the DSP graph.
- Recovers sessions only for definitive failures (`ended`, closed context, tabCapture `stopped/error`) or the inconsistent `audible + persistently muted capture` state.
- Keeps manual Stop authoritative and prevents recovery from racing with a user-requested shutdown.
- Reconciles surviving offscreen/browser capture state after an MV3 service-worker restart.
- Removes the extra SessionStatus round-trip from every meter poll.

## Audio compatibility

No EQ, Dynamics, Protection, preset, or bypass tuning was changed. Golden EQ tests remain 0 dB different from the frozen 1.22 baseline at 44.1 and 48 kHz, and analyser transparency remains sample-identical.
