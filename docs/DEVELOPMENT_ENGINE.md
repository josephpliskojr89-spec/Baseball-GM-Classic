# The Development Engine

*A process reference. This is how Baseball GM Classic was built — written down
so the same machine can build the next management game. The game-specific
examples are illustrations; every pattern here is transferable.*

---

## 1. One living document: the Bible

Everything starts and ends in a single design document (`docs/BIBLE.md`).
It is not documentation written after the fact — it is the game, in prose,
and the code is an implementation of it.

The Bible has three kinds of content:

- **Spec sections**, numbered (§6.7 International Pool Generation, §14.1
  Annual Cycle, §23 The Cone). These describe how a system works *now*.
  When a system changes, the spec is edited in place — the Bible never
  describes a version of the game that no longer exists.
- **Planned-work sections** (§23.21 velocity rework). Designs that are
  approved but not built live in the Bible *before* any code exists, with
  explicit gates ("20-season soak before shipping", "owner plays the
  current build before deciding"). Planning is a deliverable.
- **Status notes** — an append-only release ledger. Every release adds a
  blockquote note recording what shipped, *why* (with the owner's words
  quoted directly), what the numbers were, and what's next. This is the
  project's memory: any future session can reconstruct years of decisions
  from the ledger alone.

Rule of thumb: if a decision isn't in the Bible, it didn't happen.

## 2. The owner loop: feel first, mechanism second

The single most important pattern. The owner (the player-designer) reports
**feel**, not features:

> "that's too much certainty even at elite scouting"
> "the offseason feels disjointed. it's more of a chore"
> "my rookie ball team is all 20-35 but in relation to other rookie ball
> teams, that's not bad"

The engine's job is to translate feel into mechanism:

1. **Diagnose before designing.** Reproduce the complaint in the code or
   the simulation. ("A bunch of my minor leaguers vanished" → trace the
   actual cull → find the silent 30-man farm cap.)
2. **Discuss the design in plain language** before writing code. The owner
   approves direction, not diffs.
3. **Anchor the mechanism to a real-world analogue.** Scouting uncertainty
   was calibrated against real international scouting misses; the January
   15 signing day mirrors the real MLB calendar. Realism is the shared
   vocabulary that lets a non-programmer tune a simulation.
4. **Quote the owner in the artifact.** Code comments and Bible notes carry
   the owner's exact words ("owner's law: 80 is the wall"). Rationale lives
   where the code lives, so no future change accidentally reverts a
   decision without knowing it was one.

Corollary: **one-sentence laws**. The strongest design decisions compress
to a sentence — "the scale ends at 80", "board age IS signing age", "width
is truth", "the user's club is never auto-cut". Laws get enforced by tests
and cited by name in comments forever.

## 3. Releases: small, versioned, always shippable

- Every unit of work is a **numbered release** (v2.15.0), even one-line
  fixes (v2.10.2). No long-lived feature branches, no "big bang" merges.
  The trunk is always shippable because it always just shipped.
- **Version lockstep**: the version string exists in five places (constants,
  service worker cache key, HTML cache-buster query strings, splash screen,
  build tag). A tool (`tools/version_lockstep.js`) verifies all five agree
  and that every module is stamped and precached. Lockstep runs before
  every push. The lesson generalizes: anything that must agree in N places
  gets a checker, not a convention.
- **A release is code + migration + tests + Bible note + deploy
  verification.** All five, every time. The ritual is the quality bar.

## 4. Saves are sacred: the migration chain

The owner has one dynasty save, years deep. It is never reset, and it is
the true production environment.

- Every schema or balance change ships with a **migration**: a one-shot,
  version-gated transform (`if versionLt(save, '2.15.0') …`) that runs at
  load, repairs or upgrades the live save, logs what it did, and stamps
  the save forward. Stamping is forward-only so a rolled-back client never
  un-stamps a newer save.
- Migrations are **surgical and narrated**. When the signing calendar
  moved, the pending class re-tagged with every scouting look preserved,
  and a League Office letter *in the game's own fiction* explained the
  rule change to the player. Migrations aren't just data repair — they're
  story continuity.
- **Self-healing beats exact-matching.** Date checks are written as "due
  or overdue", not "equals the scheduled day" — so a save that somehow
  skipped an event heals on the next advance instead of soft-locking.
  Every scheduled event asks: what happens if the calendar sails past me?

## 5. The verification battery: tests that accrete

Every release adds a **standalone test suite** that guards its feature, and
that suite runs in the battery forever (48 suites and counting). Suites are
plain Node scripts that load the game's modules in a vm sandbox — no test
framework, no build step, exit code is the verdict.

Properties that matter:

- **Accretion.** The battery only grows. A regression in a v0.4x feature
  is caught by the v0.4x suite two years later.
- **Suites test invariants, not snapshots.** "No birthday lands between
  class generation and the window", "nothing exists above 80", "records
  sum to exactly 162". Invariants survive rebalancing; snapshots don't.
- **When a bug is found in play, the fix ships with a suite that
  reproduces it** (the DFA-vanish report became a `whereIs()` audit that
  now runs every battery).

## 6. The soak harness and the observatory

The centerpiece. `tools/season_harness.js` runs the entire game headless —
full seasons, postseasons, drafts, signing windows, offseasons, for N
seasons — using the *same engine code paths the UI uses* (this is
non-negotiable: the harness mirrors main.js, it does not reimplement it).

On top of the soak sits the **observatory**: instrumentation that measures
whether the simulated world stays plausible over a decade-plus:

- **Calibration targets** with tolerance bands (league OBP, runs per game,
  steals per team) printed year by year — era drift is watched, not
  assumed.
- **Census bands** — the key idea. For every archetype the world should
  contain ("40-homer season", "workhorse ace", "lights-out closer"), an
  *alive-and-plausible band* like `[1-8] per year`. Below the band =
  EXTINCT alarm; above = FLOOD alarm. This is how you tune a living world:
  not "is the number right" but "does the texture of the league look like
  the real thing".
- **Cohort outcome tracking** — prospects tagged at entry, peaks measured
  at maturity, bust/regular/star rates per cohort (top-10 board, deep
  pool, round-1 college…). This is how scouting-and-development systems
  get honest: the promises the UI makes are audited against what actually
  happens.
- **Hard invariant guards** that kill the run (`process.exit(1)`):
  record pollution, unresolved calendar events, name-pool mismatches,
  anything above the 80 wall, farm-size bloat.
- **Deliberate nondeterminism.** The seed governs generation, but engines
  roll live randomness — so repeated soaks hunt rare states. A 1-in-16
  anomaly is a bug you haven't met yet; the harness names offenders when
  an alarm trips so the rare state is diagnosable.

Tuning workflow: change → soak → read the observatory → adjust → soak
again. Numbers are calibrated by measurement, never by vibes. (The farm
washout ladder took three soak rounds to land at AI-average ~40 per org.)

## 7. The e2e walkthrough: play the game like a player

A Playwright script drives the *real UI in a real browser* through an
entire season and offseason — new game, sim, injuries, draft day, signing
window, trades, arbitration, free agency, rollover, season two — asserting
at every step (~147 checks). It grows with every feature, same accretion
rule as the battery.

The battery proves the engine; the harness proves the world; the e2e
proves the *game* — that a human tapping buttons actually experiences what
the engine promises. All three run every release. They catch different
bugs; none substitutes for another.

## 8. The ship ritual

Every release walks the same checklist, in order:

1. Full battery (all suites, exit-code clean)
2. Multi-season harness soak — observatory read, alarms reviewed
3. Full e2e — zero failures
4. Version lockstep bump + checker
5. Bible: spec edits + status note appended to the ledger
6. Commit with a narrative message; push working branch → staging →
   production
7. **Verify the deploy actually went green** before declaring done

Nothing is "done" at commit. Done is deployed-and-verified.

## 9. Branch and deploy model

- **Working branch** — where development happens.
- **`testing`** — staging lane; the owner can point the host at it to try
  risky builds without touching the live game.
- **`main`** — production; the deployed site *is* the live game the owner
  plays daily. Proven-safe changes ride to main directly; big or risky
  ones bake on testing first. The owner decides which lane by flipping
  the deploy target — no code changes needed.
- CI builds (the Android shell APK) trigger on **path filters**, so
  game-only releases don't rebuild the native wrapper; the hybrid shell
  loads the deployed site, so every web release reaches the phone on next
  launch with no reinstall.

## 10. A design grammar for management games

These are the reusable *game-design* patterns the process produced. They
apply to any management sim — sports, business, politics, colony.

**Hidden truth vs. perceived truth.** Every entity has true hidden values
and a separate perceived layer (fog, cones, scout reads) that is the only
thing the player and AI ever see. The gap between them *is* the game.
Perceived reads are deterministic per observer+subject (hashed, never
re-rolled on reopen) so information feels like knowledge, not slot pulls.

**Uncertainty is honest and calibrated.** The width of a projection is
itself truthful — elite scouting means ±12 on a teenager because that's
what reality supports. Anchor uncertainty levels to real-world analogues
and audit them with cohort tracking (§6). Never let the UI promise more
precision than the outcome data delivers.

**Information is an economy.** Learning costs the same currency as
acting — a dollar spent scouting a prospect is a dollar you can't offer
him. Precision is purchasable but rationed (targeted looks, second looks,
escalating prices). This makes knowledge a strategic choice, not a stat.

**The calendar is the spine.** The year is a loop of tentpole events
(draft day, signing day, deadline, arbitration, market open, camps) that
*halt* the sim and demand the player. Fast-forward controls ("sim to next
event") always stop at tentpoles. Anticipation is content: a date on the
calendar the player looks forward to is worth more than a feature menu.

**The inbox is the narrative organ.** The world talks to the player in
letters from characters — the head scout proposes, the Farm Director
reports cuts, the League Office announces rule changes, the wire digests
what happened while time ran. Every letter deep-links to the screen where
the player acts on it. Quiet phases of the calendar get *more* mail, not
less — information density is how an offseason stops feeling like a chore.

**AI parity.** AI clubs use the same systems as the player — the same
budgets, the same fogged reads (each through its own scout's bias and
spend), the same roster rules. No cheating, no shadow simplifications.
Parity is what makes beating the market feel earned.

**Population control by merit, not caps.** Never silently cap a
collection (the farm-cap incident: "a very early version relic that
should be yeeted into the sun"). Control populations with realistic
mechanisms — washout ladders by age/ability, retirements, emigration —
and guard the equilibrium with census alarms in the soak.

**The user's org is never auto-acted.** The engine may recommend, letter,
and warn, but it never cuts, trades, or signs for the player's club
without consent. AI clubs act; the user's club gets a letter.

**Archetypes give the world texture.** Entities carry hidden archetypes
(bust, overachiever, crafty vet, workhorse) that shape development and
aging. The observatory's census bands verify every archetype stays alive
and none floods.

**Self-healing predicates** (§4). Every scheduled event is written as a
standing condition ("due or overdue, until worked"), never an exact-date
match. The game must survive its own calendar being skipped.

## 11. Ledgers keep the future honest

Two small habits that compound:

- **Watch items.** Anomalies not worth fixing yet (a census band running
  warm, a flood alarm on relievers) are named in the Bible and re-checked
  every soak. Nothing is silently tolerated; it's either fixed or watched.
- **The roadmap lives in the Bible**, owner-approved, with explicit gates.
  Sessions end; the ledger means any future session — or any future
  game — starts from the full institutional memory instead of from zero.

---

*The short version: one living design doc with an append-only memory; the
player-designer reports feel and the engine translates it to mechanism
anchored in realism; every change is a small versioned release with a
save migration, an accreting test suite, a measured soak, and a played-
through e2e; the world is tuned by observatory measurement against
alive-and-plausible bands; and the game itself is built on hidden truth,
purchasable information, a tentpole calendar, and an inbox that makes the
world talk.*
