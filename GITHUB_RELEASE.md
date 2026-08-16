# KopelaEQ v1.28.15

**Maximum Protection is now peak-only.** Strong remains the unchanged default and recommended mode.

## Maximum Protection

The fixed Auto Headroom experiment from 1.28.14 has been removed. Maximum no longer turns aggressive Gain/EQ settings into a permanent pre-attenuation.

Maximum now means:

1. the same primary Protection profile as Strong;
2. Reverb/AutoPan remain in their normal place;
3. one final stereo-linked true-peak-aware peak catcher before output.

The final catcher uses ~5 ms lookahead, a −1.25 dBTP target, a short transient hold and a smooth release. Below-ceiling program material stays at unity gain; the extra stage only reduces dangerous final peaks.

The Protection panel now shows only **True peak** and **Peak catch** reduction so the UI describes the processing that actually exists.

## Verification

- 42/42 Node regression suites PASS.
- Maximum sub-ceiling unity and isolated-transient recovery regressions PASS.
- Independent true-peak reconstruction, stereo-link, worklet failure/retry and rollback regressions PASS.
- TypeScript, build, static checks, DSP/stereo math PASS.
- Frozen EQ golden response: 0 dB difference at 44.1/48 kHz.
- Meter audible path and disabled-stage dry paths: 0 sample delta.

## Files

- `kopelaeq-1.28.15.zip` — ready-to-load Chrome/Chromium extension
- `kopelaeq-1.28.15-source.zip` — source, tests, QA and release tooling
- `SHA256SUMS.txt` — archive checksums
