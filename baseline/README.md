# KopelaEQ 1.18 behavioral golden baseline

Frozen before the 1.19 TypeScript/module migration.

Required invariants:

- EQ topology: Low Shelf + 9 Peak + High Shelf.
- All five bundled preset frequency/gain/Q arrays remain exact.
- Browser-native EQ response matches the frozen 1.17/1.18 golden fixture at 44.1 and 48 kHz.
- Dynamics OFF disconnects its processor input and uses the dry path.
- Protection OFF disconnects its processor input and uses the dry path.
- Capture lifecycle remains single-session per tab and survives MV3 worker restart reconciliation.
- Preset identity remains per-tab and EQ-only.
- Popup remains 744x580 without overflow and keeps the 1.18 interaction model.
