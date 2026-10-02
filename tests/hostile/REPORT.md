# Hostile QA Report — Baseball GM Classic v2.17.0

Scratch dir: `/tmp/claude-0/-home-user-Baseball-GM-Classic/511dcbc2-24cc-5120-bec3-c424e16b754d/scratchpad/hostile/`
Harness: `load.js` (headless vm loader + cached season-end / offseason states + invariant audit), `browser_common.js` (Playwright boot).
Every attack script is re-runnable: `node attack_*.js`; browser ones need `NODE_PATH=<scratchpad>/node_modules`.

Reachability key: **UI** = doable by a normal player through the shipped UI; **console** = only via devtools / corrupted save (defense-in-depth gap, not a player exploit).

## Findings (most severe first)

| # | Sev | Reach | Finding | Repro | Observed vs expected / invariant |
|---|-----|-------|---------|-------|----------------------------------|
| 1 | **HIGH** (data loss) | UI | **Import overwrites the good save BEFORE the imported file is validated by startGame; a bad file destroys the previous save while the toast says "Import failed".** `state.js importFromFile` persists (`storePut`) after only shallow checks, then `main.js init` runs `startGame` which throws (e.g. `reading 'seasonRecord'`). The on-disk save is now the broken one; the old one is gone. | `browser_save.js` case "userTeamId bogus" — toast shows `Save imported.` then `Import failed: Cannot read properties of undefined (reading 'seasonRecord')`; app opens anyway, Advance throws `reading 'minors'`. | Expected: validation (or a dry-run of the migration chain/`validateCurrentSave`) before persisting; "Import failed" must mean the old save is untouched. Also accepted: `players = {}`, user `roster = []` → perpetual "Simulation Error" modal every Advance (no in-app recovery except New Game). |
| 2 | **HIGH** (exploit) | UI | **FA payroll budget bypass by offer stacking.** `freeagency.makeUserOffer` checks `payroll + aav > cap*1.05` against *current* payroll only; standing offers are not counted, and there is no limit on `userOffers`. Place "Meet ask" on every FA; they all sign. | `attack_inputs.js` §offer stacking: 93 offers → payroll **$102.5M → $479.4M vs $209M budget (2.29×)**. | Invariant: user payroll ≤ ~105% of `payrollBase`. Expected: cap check against payroll + sum of standing offers (or cancel/trim offers as signings land). |
| 3 | **HIGH** (exploit) | UI | **International signing has no money check at all (steps 2–3).** `intl.userSign` only checks the `restricted` flag; every "Sign for $X" button works regardless of pool. Overspend penalty is a one-time 50% pool cut + 2 restricted years — trivial next to a 100-prospect haul. | `attack_inputs.js` §intl: signed the **entire 100-man class, $73.88M spent on a $6M pool (1231%)**, farm grows to 134. Next year (restricted) still signed 52 ≤$0.3M prospects, 7.68 of a 2.8 pool. | Expected: refuse when `spent + ask > pool` (or a hard overage ceiling like the 60% rule used for pool trades). |
| 4 | **HIGH** (exploit) | UI | **Step-1 bidding: user offers are not capped by pool money, AI bids are** (`resolveTopTier`: `amount = min(remaining, ask*mul)` for AI; user offer used raw). "Blow him away" (1.5× ask) on all ten top-10 prospects wins all ten. | `attack_money.js` §3: $99M bids (engine) won 10/10; via UI 1.5× offers on all ten with a $6M pool wins essentially the whole top-10 (each AI stops at `remaining`). | Expected: user offers clamped to remaining pool, or sum of standing offers ≤ pool. |
| 5 | **HIGH** (soft-lock, corrupted-save only) | console | `meta.offseasonPhase='freeAgency'` with `faMarket` missing → `advanceFARound` throws `reading 'round'`; `offseasonError` restores the identical backup; every Advance re-throws forever. No in-app escape. | `browser_save.js` probe "FA phase with faMarket deleted": date never moves, modal "Offseason Error … Your save was restored". | Expected: `advanceFARound`/`advanceDay` to heal (`faMarket ??= buildMarket`) or route to Start Season. Not seen on natural paths (Part A always builds the market), so HIGH not CRITICAL. |
| 6 | **HIGH→MED** (exploit, narrow UI path) | UI (stale draft) / engine | **Trade valuation is injury-blind.** `tradeValue` ignores `ilStatus`; a player with a 400-day (season-ending) injury is worth exactly his healthy TV. IL players aren't listed in the builder, but a picked player who gets hurt during simmed days stays in `draft.give` (`orgOf` includes `team.il`) and `evaluateProposal`/`executeTrade` accept him. AI–AI valuation has the same hole. | `attack_misc.js` §(i): Felix Weir TV 44.5 healthy = 44.5 on 400-day IL; AI gives a TV 53.8 player for him. | Expected: TV discount by days remaining / career-altering flag. |
| 7 | MEDIUM | UI (cosmetic+accounting) | **322 contracts per winter stamped at $0.7M, below the $0.74M league minimum.** `offseason.js` ~line 745: `salary = Math.round(0.74*10)/10 = 0.7`. Shows as "$0.7M" on every pre-arb card. | `node -e` audit of `cache/offseason_777.json`: 322 `signedAt:'renewal'` contracts at 0.7. | Invariant: `annualSalary ≥ 0.74`. Round to 2 decimals or floor after rounding. |
| 8 | MEDIUM | UI | **Trade cash received offsets payroll THROUGH free agency.** `tradeCash` resets in Part B (after FA), so $20M cash-in deals in July shrink `computePayroll` for the winter cap check. | `attack_money.js` §1: 4 trades (+$80M) → payroll 127.8 → **16.0** in-season, **8.7 vs $138M budget** at the FA table; top FA offer accepted. | Expected: reset ledger at Part A (season close) or exclude it from the FA cap check. |
| 9 | MEDIUM | console | `evaluateProposal` never verifies ownership or uniqueness: giving a third club's star is **accepted** (the AI still hands over its player; `executeTrade` silently drops the phantom), and `[p, p]` is double-counted (ratio 1.02 → 2.05) and `executeTrade` pushes him onto the partner's roster **twice** (duplicate id in `team.roster`). | `attack_trades.js` §3/§4. | Expected: assert `give ⊂ userOrg`, `get ⊂ aiOrg`, no dups, in the engine (UI filter is the only guard). |
| 10 | MEDIUM | console | Cash/pool params unvalidated: `cashGive=1e9` and `Infinity` accepted (`tradeCash.out` → `null` via `Math.round(Infinity)`, payroll → `Infinity`). | `attack_trades.js` §5. | UI steppers clamp 0..20; engine should too. |
| 11 | MEDIUM | console | `makeUserOffer`/`offerExtension` accept garbage years/totals: ext `years 0` → `{years:0, annualSalary:null}`; `total Infinity` → nulls; `years 2.5` signs; FA `years 99` signs 99-year deal; `years 1e12` signs. | `attack_inputs.js` §FA/§ext. | Contract invariant: integer years 1..N, finite salary ≥ 0.74. |
| 12 | MEDIUM | console | `intl.userSign` signs the **same prospect twice** (double bonus, duplicate `minors` entry, two ledger rows) and works during step 1 (takes the #1 prospect at slot ask before bidding). | `attack_inputs.js` §intl. | Expected: refuse if `signings` already holds him / `windowStep < 2`. |
| 13 | MEDIUM | console | Draft `makePick` has no "already taken" check: the same prospect can be picked by two clubs (player ends up in two orgs, `teamId` of the second). UI's `availableBoard` filters, but a double-tap race on "Draft #N" → `afterUserPick` would hit this. | `attack_misc.js` §draft: Estevan Long in `BOS.minors` AND `ATL.minors`. | Expected: `if (taken.has(id)) return null`. |
| 14 | MEDIUM | console | Offseason tentpoles have no idempotency guards: `runSeasonRolloverPartA` ×2 double-archives (history `2026,2026`) and double-ticks contracts; `PartB` ×2 re-runs spring top-up (player count 1946→1919); `rule5.runDraft` ×2 double-ledgers the winter; `intl.advanceWindow` resolves a just-generated class 11 months early. | `attack_calendar.js`, `attack_roster.js` §6. | UI gates all of these on phase flags — a single mis-gate turns into a double rollover. |
| 15 | MEDIUM | console | Rule 5 pick through un-guarded doors: `releaseToPool` on a pick leaves `p.rule5` on a free agent (next signer inherits a flag pointing at the origin club; `aiStickTick` "returns" him day one). `waivers.place` likewise. An IL player placed on waivers is claimed onto the claimant's **26-man while still injured** (`ilStatus` set, not on `team.il`). | `attack_roster.js` §5, `attack_inputs.js` tail. | UI routes R5 to Return and hides moves for IL players; engine doors should enforce it. |
| 16 | MEDIUM | console | Mass DFA/release through the engine (no floor guard in `releaseToPool`/`waivers.place`) → `simulateGame: … has no starting pitcher` → "Simulation Error" modal, state saved mid-day. Any state that makes `simulateGame` throw is a permanent halt (`finishWithError` saves and the next Advance re-throws). | `attack_roster.js` §1–2. | UI `releaseBlocker` enforces floors; the sim-loop should skip/repair an unplayable club instead of halting forever. |
| 17 | MEDIUM | console | Part A archives the season under the **calendar** year, not the schedule year (date drifted to Feb → archived as 2027 for the 2026 season). | `attack_calendar.js` §E. | Use `schedule.year`. |
| 18 | LOW | UI | Called-up farmhands keep sub-minimum minor-league pay on the 26-man (4 players at $0.3–0.6M at season end). | `attack_misc.js` §(a). | Bible: $0.74M minimum on the active roster. |
| 19 | LOW | UI | `validateLeagueReadiness` fails on 14/24 weekly in-season checks (AI "bullpen size 5, expected ≥6") — config drift after IL moves. Sim tolerates it. | `attack_misc.js` §(a). | `validateCurrentSave()` reports FAIL on healthy saves; noise for support. |
| 20 | LOW | UI | No cap on farm size or on AI cash budgets: user farm reached 134 (intl spam); AI clubs pay $20M cash per trade with no budget check (`evaluateProposal` has none on the AI side). | `attack_inputs.js`, `attack_money.js`. | |
| 21 | LOW | console | Import accepts `currentDate: {year:'x', month:99, day:-1}` → header shows "undefined NaN, NaN" and the calendar is dead. | `browser_save.js`. | Type-check `meta.currentDate` in `importFromFile`. |

## Attacks that HELD (correctly rejected / survived)

Trades (`attack_trades.js`):
- 928 junk-for-star many-for-one dumps (1..4 of my worst for their top-8): **0 accepted**.
- Best 1-for-1 true-value gain found across all 29 clubs: +9.2 TV (ovr-59 31-year-old for an ovr-37 21-year-old) — a reasonable "upside" trade, not a fleece.
- Negative/NaN cash and all pool-space garbage (negative, NaN, 0.001) rejected; pool trades closed when no live class.
- Post-deadline (Aug 1) and postseason proposals rejected with the deadline message.
- 4 chained accepted 1-for-3 / 3-for-1 trades: rosters legal, next day sims.
- Winter dump of 29 trades (user 26-man gutted): spring top-up repairs, Opening Day sims clean.
- Acquiring a long-IL player keeps him on the IL (when the AI values it enough to deal — it rarely does for 445-day arms).
- `executeTrade` filters players not in the sending org (the phantom-give never moves the third club's player).

Roster / Rule 5 (`attack_roster.js`):
- 50× send-down/call-up ping-pong on one player: clean; sending the closer down + rebuild picks a new closer.
- Rule 5 `userChoice` = own farmhand / rival's 26-man player / bogus id / retired player → all degrade to "sniped", roster never overflows (26), nobody self-drafts.
- `returnPick` twice: no throw, no duplicate.
- User Rule 5 pick survives Part B spring compliance on the 26-man and 45 simmed days.
- User waiver claim with a full roster trims correctly.
- `signMidSeason` refuses already-signed, waived, abroad players.

Calendar (`attack_calendar.js`):
- Part B straight from Nov 15 backstops BOTH the Rule 5 draft and the Jan 15 window; next class regenerates once.
- `advanceFARound` out of phase is a no-op; `autoRunWindow` on a completed class is a no-op.
- Rollover tolerates ghost `pendingDecisions`, ghost waiver entries, ghost trade offers, and 40 unplayed games.
- Rollover with NaN/null/negative contracts and NaN service time does not throw (but NaN survives untouched — see #11).
- Part B in-season (no history) throws early (`reading 'seasons'`) rather than corrupting.

Save / browser (`browser_save.js`, 17 import mutations + soft-lock probes):
- Rejected cleanly: truncated JSON, version 9.9.9 (newer-version guard), version 0.1.0 (pre-NABL guard), version "garbage".
- Version 0.3.0 → full migration chain ran from the oldest supported version without error.
- Opened and advanced without errors: rosters referencing deleted players, null ratings, missing `intl`/`staff`/`history`/`freeAgents`/`news`, empty schedule, age 300 everywhere, NaN contracts.
- `faMarket` entries referencing deleted players: FA rounds advance.
- Stale `pendingDecisions` (ghost ids, non-IL player, unknown kind) are dropped; the IL call-up modal with zero farm candidates offers "Play Short-Handed" (my auto-clicker only pressed primary buttons — not a soft-lock).

Monkey (`browser_monkey.js`, 3 min, viewport 390×844): **1022 random actions (nav taps, roster rows, modal buttons, Advance double-clicks, Sim-to-Next-Event with Advance spam mid-sim, rapid 5-tap bursts, random player cards, inbox) → 0 page errors, 0 console errors.** Ended on Jun 30 draft day, which halts Advance by design until the Draft Hub is used (not a soft-lock).

## Notes for the fixer
- #1 is the one to fix before the store release: `importFromFile` should run `savePreNABL` + the migration chain + `validateCurrentSave`-style structural checks (teams exist, `userTeamId` resolves, every roster id resolves) on the parsed object *before* `storePut`.
- #2/#3/#4 are three faces of the same gap: money checks are per-action against the current ledger, never against outstanding commitments. One helper (`committed(team) = payroll + Σ standing offers`) fixes FA; `spent + Σ userOffers + ask ≤ pool` fixes both intl paths.
- Most console-only items (#9–#17) are "engine trusts the UI". Given the migration/soft-lock story, cheap engine-side asserts would turn future UI slips into refusals instead of corrupted saves.

## Remaining probe output (browser_save.js was still running at report time)
       ok  import "schedule games []" handled (opened and advanced)
    !! [HIGH] Import of mutated save (user roster [] (empty)) is accepted and then throws
       ok  import "contract years negative + salary NaN" handled (opened and advanced)
       ok  import "age 300 / retired flags everywhere" handled (opened and advanced)
    FA phase with faMarket deleted: date Mar 29, 2026 -> Mar 29, 2026; last modal: Offseason ErrorThe offseason hit an error: Cannot read properties of null (reading 'round') Your save was restored to th; errors: Offseason failed: TypeError: Cannot read properties of null (reading 'round')
    !! [CRITICAL] SOFT-LOCK candidate: FA phase with faMarket deleted — calendar stuck and errors thrown
    FA phase, faMarket present, entries referencing deleted players: date Mar 29, 2026 -> Apr 10, 2026; last modal: -; errors: none
       ok  FA phase, faMarket present, entries referencing deleted players: calendar moved
    pendingDecisions with ghost + non-IL player: date Mar 29, 2026 -> Mar 31, 2026; last modal: The Monday paper is out"MARATHON in the week's wildest game" — The NABL Ledger.Read the PaperContinue; errors: none
       ok  pendingDecisions with ghost + non-IL player: calendar moved
    pendingDecisions il-callup for IL player with EMPTY minors: date Mar 29, 2026 -> Mar 29, 2026; last modal: Roster decision — Brandon Bryant to the ILBrandon Bryant (CP) is on the 10-day IL — hamstring strain, out ~10 days. Pick; errors: none
    !! [HIGH] SOFT-LOCK candidate: pendingDecisions il-callup for IL player with EMPTY minors — calendar never moves after 4 advances

    (Correction to the last line above: the IL call-up modal offers "Play Short-Handed" / "Let the AI Decide" — the probe's auto-clicker only pressed primary buttons, so this is NOT a soft-lock; moved to the HELD list.)
    (Probe "date past seasonEnd + postseason {phase:'ds', series:[], games:[]}": the harness crashed with `page.evaluate: TypeError: Cannot read properties of undefined (reading 'east')` — `BBGM_MAIN.refresh()` throws when `state.postseason` lacks `rounds`/series, i.e. the dashboard render has no guard for a malformed bracket. Console/corrupted-save only → LOW (#22). The 8 later probes (2 months past seasonEnd with no postseason, Dec 10 Rule 5 with empty pool, intl window with empty board, draft day with missing/empty class, 0 pitchers on the 26-man, every user player on the IL, ghost waiver claim, ghost trade offers) did not run before the time box; the script is in place to run them: `node browser_save.js`.)
