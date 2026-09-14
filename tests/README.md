# The verification battery

Every release adds a suite here that guards its feature forever — the
battery only grows, and it **lives in the repo** (lesson learned the hard
way: the original 48-suite battery and 147-check e2e lived in ephemeral
scratch storage and died with a container in September 2026; the suites
in this directory are the reborn, permanent base).

## Running

Unit suites (plain Node, vm-sandboxed module loads, exit code is the
verdict):

    for t in tests/*_test.js; do node "$t" || exit 1; done

The e2e smoke boots the real game in a real browser:

    npm i playwright   # anywhere; browsers are preinstalled under /opt/pw-browsers
    NODE_PATH=<that>/node_modules node tests/e2e_smoke.js

The long-horizon soak with the observatory (census bands, calibration
targets, invariant guards) is `node tools/season_harness.js <seed> <seasons>`.

## Rules

- Suites test **invariants**, not snapshots — they must survive
  rebalancing.
- A bug found in play ships its fix with a suite that reproduces it.
- Nothing here is ever deleted; a suite that goes stale gets updated to
  the current design, not removed.

## Current suites

- `module_load_test.js` — every script index.html ships evaluates in a
  bare sandbox and registers its global.
- `intlcal_test.js` — the January 15 international signing calendar
  (v2.15.0): signing-year math, window predicate, no-clobber class
  generation, birthday-pin invariants, headless resolution.
- `traits_test.js` — hidden personality traits (v2.16.0, §25): mint
  distribution and volatility-backed labels, October modifiers acting
  while hidden, negotiation behavior (asks, market testers,
  preferences), signing-wire discovery rules.
- `e2e_smoke.js` — browser walkthrough: boot, new game, team select,
  sim, player card, trait visibility tiers, inbox, zero page errors.
