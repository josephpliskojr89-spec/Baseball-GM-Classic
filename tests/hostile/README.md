# Hostile QA + long-horizon soak artifacts (2026-10-02)

Pre-release adversarial testing, preserved in-repo. Nothing here runs in
the battery automatically (names are `attack_*.js`, not `*_test.js`); every
script is re-runnable by hand.

- `REPORT.md` — the hostile agent's findings table (21 items, severity +
  UI-reachability + repro) and the list of attacks that held.
- `attack_*.js` + `*.findings.json` — engine-level attacks via the vm
  loader (`load.js`). Run: `node tests/hostile/attack_trades.js`.
- `browser_*.js` — Playwright attacks (save-import mutations, a 3-minute
  random-action monkey). Run with `NODE_PATH=<playwright node_modules>`.
- `soak/SOAK_FINDINGS.md` — 25-season soak findings: the pipeline
  hitter/pitcher ceiling asymmetry (league tilts to pitching over 20
  years), the rotation∩bullpen overlap behind the 40-start season, and
  save-size growth vs the Android Auto Backup cap.
- `soak/harness_instr.js` — the season harness with the probes that found
  them (daily rotation-integrity probe, per-season side-split talent
  probe, overwork offender dump, `DUMP=<path>` end-state dump). To be
  folded into tools/season_harness.js with the fixes.
- `soak/mint_probe.js`, `soak/cohort.js`, `soak/analyze_state.js` —
  the diagnostics that pinned the asymmetry to draft-class generation.
