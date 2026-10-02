# Long-horizon soak findings (2026-10-02)

Runs: seed 777 × 25 seasons (clean exit), seed 31337 × 25 (FAILED season 6: 40-start pitcher),
4 × 8-season hunts, 6 × 7-season hunts with daily rotation probe, 1 × 25-season instrumented
run with per-season side-split probe + 20.6 MB state dump.

## F1 (HIGH, balance) — pipeline hitters mint below pipeline pitchers → 25-year league tilt
- 26-man OVR by side: hitters 47.9 → 44.6 over 20 yrs; pitchers 47.8 → 49.6 (plateaus ~yr 6).
- Era drift follows: R/G 4.42 → ~4.2, ERA 4.18 → 3.9, K% 18.7 → 19.5, CG 54 → 80+, SHO 11 → 23.
  Flood alarms: workhorse ace, strikeout monster, 3+ CG, wild flamethrower (all pitching).
- Elite (58+ raw) at year 25: 21 hitters vs 46 pitchers. 65+ stars climb 3 → 11.
- Root cause (mint probe, fresh draft classes): OVR-at-ceiling hitters 40.8 vs pitchers 44.2;
  top-100: 43.3 vs 48.1. Intl: 39.1 vs 40.7. Genesis population: balanced within ~1.
- Mechanism: draft.js ceiling targeting favors pitchers (4-tool mean vs 7-tool mean after the
  per-tool spread; speed excluded from lift). Fix = calibration in draft.js (and lightly intl.js):
  equalize OVR-at-ceiling by side at mint; gate with the mint probe (±1) and a 25-season soak
  (26-man hitters/pitchers within ±1 all the way).

## F2 (HIGH, invariant) — 40-start pitcher (seed 31337, 2032); rotation ∩ bullpen overlap
- Harness hard-fail: max GS 40 (guard 38). Not reproduced in 74 further league-seasons.
- Daily rotation probe found 3 arms in BOTH rotation and bullpen (3 / ~1260 team-seasons).
  Cause by code read: simulation.ensureRotation pads a short rotation from any roster arm but
  never removes him from team.bullpen (replaceRefs does). An overlapped arm's relief outings
  stamp his rest clock → his turn is always skipped → effective 4-man rotation → 162/4 ≈ 40.
- Fix: ensureRotation splices the added arm out of team.bullpen (+ invalidates bullpenRoles);
  harness daily probe becomes a permanent invariant (overlap must be 0).

## F3 (MEDIUM, release-blocking for Play) — save size growth
- 4.3 MB (yr 1) → 20.6 MB (yr 25), ~0.6 MB/yr, slowing. Android Auto Backup cap is 25 MB.
- Composition at yr 25: players 17.5 MB (active 8.9 / retired 8.5); retired stats alone 4.75 MB,
  active stats 3.0 MB, ratingsHistory 1.2 MB. (news was 1.2 MB only because the harness skips
  main.js's 200-item cap.)
- Fix options: compress the native save (CompressionStream gzip ≈ 4-5× smaller) and/or slim
  retired players' per-season stats to career totals + awards after N years.

## Clean / holding
- Payroll flat ($4.1B total, max ~$225M) over 25 yrs; active population ~2350 stable.
- Rule 5: 11-17 picks/winter at maturity, 86% stick; no stale flags; pools ~300.
- Jan 15 window: one per winter, every winter. Traits: 33% traited, discovery ~3 org + 2 public /yr.
- Wall: 0 above 80 after 25 years. Farm sizes AI avg 42 (alarm 45).
- Day-to-day knocks keep starters in rotation (probe noise, expected).
