# Baseball GM Classic — Design Bible

**Version 0.1 — Foundation**
**Tagline:** *Modern framework, classic baseball.*

## Table of Contents

1. Project Overview
2. Technical Architecture
3. League Structure
4. Team Generation
5. Player Data Model *(pending)*
6. Player Generation *(pending)*
7. Simulation Engine *(pending)*
8. Stats System *(pending)*
9. Progression System *(pending)*
10. Injury System *(pending)*
11. Roster Management *(pending)*
12. Minor League System *(pending)*
13. Amateur Draft *(pending)*
14. International Signings *(pending)*
15. Trades *(pending)*
16. Free Agency & Contracts *(pending)*
17. Managers & Coaches *(pending)*
18. Offseason Flow *(pending)*
19. Awards & Hall of Fame *(pending)*
20. UI/UX Specification *(pending)*
21. Build Order *(pending)*

---

## 1. Project Overview

### 1.1 Vision

Baseball GM Classic is a single-player, browser-based baseball franchise simulation. The player controls one team across an open-ended career, making roster, personnel, and strategic decisions while the rest of the league operates autonomously. The core appeal is deep simulation of baseball as a *general manager experience*, not as a play-by-play action game.

The project is for personal use. No commercial intent, no app store distribution, no multiplayer. The audience is the developer himself, who wants a sim that runs on his phone and laptop and can be played across years of real time.

### 1.2 Design Pillars

**Pillar 1 — Classic baseball gameplay within a modern framework.** Modern league structure (30 teams, 5-man rotations, modern bullpen usage, modern roster rules, modern IL structure). On-field outcomes target a less three-true-outcomes-heavy environment: higher contact rates, lower strikeout rates, meaningful archetype diversity, viable small-ball tactics. Late-90s/early-2000s outcomes inside a 2026 league structure.

**Pillar 2 — Hidden information drives meaningful decisions.** True ratings visible for established major-leaguers. Prospect ratings uncertain, becoming more reliable over time. Hidden archetypes determine development paths. Scouting is a real skill of the game, not a UI inconvenience.

**Pillar 3 — Mobile-first, browser-native.** Fully playable on a phone via mobile browser. Layouts, tap targets, and information density designed for mobile *first* and adapted up to desktop. Hosted as static site, saved to home screen via PWA. No app store, no install, no native code.

**Pillar 4 — You are the GM, not the manager.** Every team — the player's included — has a manager with his own style and tendencies who runs the day-to-day: lineups, batting order, rotation order, bullpen roles, rest days, and in-game tactics. The player's job is the front office: build the roster, work the draft and the trade market, manage the budget, and hire the manager whose style fits the roster you're building. If you want a different style of baseball on the field, you don't tap lineup arrows — you hire a different manager. (Until the manager system ships in Phase 10, the player acts as their own interim manager through the direct lineup/rotation/bullpen controls; those controls become the manager's domain once managers exist. See 17.7.)

### 1.3 Scope Boundaries

**In scope:**
- 30-team MLB-style league with 162-game seasons
- Generated teams, players, fictional 2026 starting state with no pre-baked history
- Single user-controlled team; AI controls all others
- Full offseason cycle: amateur draft, international signings, free agency, trades, managerial hiring
- Minor-league development at the player level (no minor-league game simulation)
- Detailed player progression with hidden archetypes
- Injuries and IL management
- Manager and coach hiring with mechanical effects
- Awards and Hall of Fame
- Save/load via IndexedDB with file export/import

**Out of scope (initial build):**
- Multiplayer or online features
- Real player names or licensing
- Pre-simulated league history
- Minor-league game simulation
- Position-specific defensive ratings
- Complex contract clauses (no-trade, opt-outs, deferrals)
- Advanced sabermetrics (WAR, wRC+, FIP) at launch
- Stadium construction, ownership decisions, business sim elements
- Fan engagement, attendance, broadcasting modeling

**Possible future additions:** pre-simulated history option, position-specific defense, catcher-specific ratings, full sabermetric suite, in-game tactical decisions, granular contract structures.

### 1.4 Target Experience

User opens bookmarked PWA on phone. Game loads to dashboard: today's date in-game, team's record, upcoming series, pending decisions. User taps "advance day" or "sim to next event." When the engine encounters a decision (roster move, injury callup, trade offer, FA signing window) it pauses and surfaces it. User makes the call and continues advancing.

Sessions accommodate both 30-second (advance a day, glance at standings) and 30-minute (manage an offseason) play patterns.

---

## 2. Technical Architecture

### 2.1 Tech Stack

**Frontend:** HTML5 + CSS3 + vanilla JavaScript. No build step, no framework. Single-page application.

**Rationale:** Vanilla JS avoids build tooling and dependency management. The project owner is a non-coder using AI for implementation; reducing toolchain complexity helps. Simple `index.html` loading CSS and JS keeps boot-up trivial.

**Why not a framework:**
- Build steps and dependency trees complicate a personal project
- UI is mostly static layouts with state-driven content (vanilla JS handles fine)
- Mobile performance better without framework overhead
- AI-assisted code generation stays consistent without framework abstractions

**Storage:** Browser IndexedDB (moved from localStorage in 0.6.0 — a measured end-of-season save was ~5 MB, right at the localStorage quota on many phones; IndexedDB stores the state object via structured clone with a far larger quota). Legacy localStorage saves migrate automatically on first load. Save failures surface to the user immediately (toast + export-prompt modal) — persistence must never fail silently. Export/import via downloaded `.json` for backup and cross-device transfer.

**Hosting:** Static site, deployable to GitHub Pages, Netlify, or Cloudflare Pages. No server-side code, no database, no API calls during play.

**Mobile deployment:** User accesses via URL on phone, then "Add to Home Screen" installs as PWA. `manifest.json` and minimal service worker enable offline play and home-screen installation. Game runs fullscreen without browser chrome.

### 2.2 File Structure

```
/baseball-gm-classic/
├── index.html
├── manifest.json
├── service-worker.js
├── /css/
│   ├── reset.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   └── mobile.css
├── /js/
│   ├── main.js
│   ├── state.js
│   ├── /engine/
│   │   ├── simulation.js
│   │   ├── progression.js
│   │   ├── injuries.js
│   │   └── stats.js
│   ├── /generation/
│   │   ├── league.js
│   │   ├── players.js
│   │   ├── names.js
│   │   └── ballparks.js
│   ├── /systems/
│   │   ├── draft.js
│   │   ├── international.js
│   │   ├── trades.js
│   │   ├── freeagency.js
│   │   ├── coaching.js
│   │   ├── awards.js
│   │   └── hof.js
│   ├── /ui/
│   │   ├── dashboard.js
│   │   ├── roster.js
│   │   ├── standings.js
│   │   ├── player.js
│   │   ├── stats.js
│   │   ├── offseason.js
│   │   └── modals.js
│   └── /data/
│       ├── name_pools.js
│       ├── city_pools.js
│       └── constants.js
```

### 2.3 Data Architecture

Entire game state held as one JavaScript object in memory, persisted to IndexedDB:

```
{
  version: "0.1.0",
  meta: { created, lastPlayed, currentDate, userTeamId, seed },
  league: { teams, divisions, schedule },
  players: { /* keyed by playerId */ },
  prospects: { /* draft-eligible and pre-draft */ },
  internationalPool: { /* current year intl prospects */ },
  freeAgents: [...],
  staff: { managers, coaches },
  history: { seasons, awards, hallOfFame },
  pendingDecisions: [...]
}
```

**ID system:** Every player, team, prospect, staff member has unique ID. References use IDs, not nested objects. Lookups via helpers (`getPlayer(id)`, `getTeam(id)`).

**Save size:** Target under ~10MB for a 10-year save (IndexedDB quota is generous, but export files and load times still reward restraint). Achieved by storing season totals (not game-by-game), pruning old detailed data, compact representations.

### 2.4 Save/Load System

**Auto-save:** On every state change. No "save" button — game is always saved.

**Single save slot:** Starting a new game prompts to confirm overwrite.

**Export:** Settings button serializes save to downloadable `.json`. User stores anywhere.

**Import:** Settings button accepts `.json` and loads as current save. Confirmation required.

**Version management:** Save object includes `version` field. Migration functions convert older saves to new format. Critical for a long-lived personal project.

### 2.5 Mobile Performance Principles

- Avoid heavy DOM manipulation; use document fragments for batch updates
- Lazy-load views; tear down when user leaves
- Cap simulation work per frame; long sims yield to UI with progress indicator
- Minimize repaints; use CSS transforms and opacity for animation
- Defer expensive calculations (league-wide stats at appropriate intervals)
- Test on actual mobile early and often

### 2.6 Mobile-First Design Principles (Non-Negotiable)

- Portrait-first layouts; landscape supported but not required to look great
- Tap targets minimum 44×44 pixels
- No hover states for primary functionality
- Vertical scrolling, not horizontal; wide tables condense to cards
- Information hierarchy via typography, not color alone
- Gestures supplement, never replace
- Fast first paint (<1 second to dashboard)
- Respect safe areas (notches, navigation bars) via CSS env variables

---

## 3. League Structure

### 3.1 League Composition

30 teams in 2 leagues of 15. Each league: 3 divisions of 5.

- **Eastern League** (functionally American League — uses DH)
- **Western League** (functionally National League — pitchers bat 9th; no DH)

Interleague games use the home league's DH rules — this is implemented (as of 0.6.0):
- In a Western park, both teams' pitchers bat 9th. A visiting Eastern team drops its DH slot for the game (the DH player is bench/substitution-eligible).
- In an Eastern park, a visiting Western team slots its best available bench bat at DH.
- Pitchers batting use a fixed weak batting profile (~.130 BA, ~35-40% K, minimal walks/power — classic-era pitcher hitting). Their batting stats accumulate on a separate `stats[year].batting` line, never mixed with pitching stats. No pinch-hitting for the pitcher until an in-game substitution system exists — relievers bat when the spot comes up.

### 3.2 Schedule

**162 games per team:**
- **Within division** (4 opponents × 13 games): 52 games
- **Within league, outside division** (10 opponents × 8 games): 80 games
- **Interleague** (30 games):
  - 1 designated rival × 4 games = 4 games (2 home / 2 away)
  - Remaining 26 games spread across rotating interleague opponents from one division of the other league each year (rotates: this year East plays West, next year East plays Central, etc.)
- **Total:** 52 + 80 + 30 = 162 games ✓

**Schedule structure:**
- Late March / early April through late September
- ~26 weeks of play
- Series typically 3 games (some 4, occasional 2)
- ~1 off-day per week per team plus All-Star break
- Doubleheaders treated as two separate games

**Schedule generation requirements:**
- 162 games per team (exact)
- 81 home / 81 away per team (exact)
- Required intra-division, intra-league, interleague counts
- No team plays >20 consecutive days without off-day
- All-Star break mid-July (~game 87-90)
- Trade deadline end of July (~game 107)

#### 3.2.1 Schedule Generation Algorithm

**Inputs**
- 30 teams in 6 divisions of 5
- Season runs roughly late March through late September (~180 calendar days)
- Each team plays 162 games

**Game distribution targets (per team)**
- Intra-division: 4 opponents × 13 games = 52 games (split as 7 home / 6 away or 6 home / 7 away, alternating yearly)
- Intra-league non-division: 10 opponents × 8 games = 80 games (4 home / 4 away each)
- Interleague: 30 games total
  - 1 designated rival × 4 games = 4 games (2 home / 2 away)
  - Remaining 26 games against rotating interleague opponents (one division of the opposite league per year)
- Total: 52 + 80 + 30 = 162 games ✓

**Series structure**
Games come in series of 2-4 consecutive games at one location (mostly 3-game series). Within division: typically 3 or 4 game series. Interleague: usually 3 game series.

**Step 1: Generate the matchup pool**

For each team, build a list of all their opponents and how many games against each:
- 4 division opponents × 13 games = 52 game-slots
- 10 non-division league opponents × 8 games = 80 game-slots
- 1 designated interleague rival × 4 games = 4 game-slots
- 5 rotating interleague opponents × ~5-6 games = ~26 game-slots

This produces 162 game-slots per team. Across all 30 teams, that's 30 × 162 = 4,860 game-slots, but each actual game involves two teams, so total games in the league = 4,860 / 2 = 2,430 games. ✓ (Real MLB has 2,430 games per season.)

**Step 2: Group game-slots into series**

For each team-pair matchup, divide the games into series:
- 13-game intra-division matchup → 4 series (e.g., 4 + 3 + 3 + 3, with 2 series at home and 2 away)
- 8-game intra-league matchup → 3 series (3 + 3 + 2, split 2 home / 1 away or 1 home / 2 away alternating)
- 4-game interleague rivalry → 2 series of 2 (1 home, 1 away)
- 5-6 game rotating interleague → 1-2 series

Each series has a designated home team. Home/away balance over the season totals 81/81 per team.

**Step 3: Assign series to dates**

Build a calendar of available date-blocks. A "date-block" is a set of 2-4 consecutive days where a series could fit. Allow some days to be "off-day candidates."

For each team, randomly distribute their series across the calendar with these constraints:
- No two series can occupy the same date-block for the same team
- Each team needs roughly one off-day per week
- All-Star break (4 days, mid-July) — no games scheduled
- Both teams in a series must have that date-block available

Use a randomized greedy assignment:
- Sort series by "constraint difficulty" (e.g., long division series are placed first; short flexible interleague series are placed last)
- For each series, find a valid date-block where both teams are free
- If no valid block exists, backtrack

Iterate until all series are placed or maximum attempts exceeded. If failure, restart with different random seed.

Once all series are placed, verify constraints:
- Each team has exactly 162 games
- Home/away split is 81/81
- No team plays more than 20 consecutive days without an off-day
- All-Star break is preserved

If verification fails, retry generation up to N times before falling back to a less-constrained schedule.

**Series pacing rules**
- Series length distribution: ~70% are 3-game series, ~25% are 2-game series, ~5% are 4-game series
- Travel pattern: Try to group series so a team's road trips and home stands cluster (e.g., 3 home series in a row, then 3 road series). This isn't strict but reduces unrealistic single-game flips between cities.
- Day-night alternation: Not modeled (all games are evening games for sim simplicity).

**Verification step**

After generation, run these checks:
- Every team has exactly 162 games
- Every game appears on exactly two teams' schedules with consistent home/away
- Total league games = 2,430
- Distribution per team matches targets (52 / 80 / 30 split)
- No team has scheduling gaps longer than reasonable (no 4+ day stretches without games unless intentional)
- Off-day distribution is roughly even (each team gets ~20-25 off-days through the season)

If any check fails, regenerate. The schedule isn't required to be perfect, just plausible.

**Practical implementation notes**
- This is a randomized algorithm. Different seeds produce different schedules.
- It's okay if schedule generation takes a few seconds — it only happens once per season.
- For small inconsistencies (e.g., team has 161 or 163 games due to constraint failures), the generator can swap one or two games to balance.
- Real MLB scheduling solves harder constraints (TV deals, stadium availability, weather considerations). The sim doesn't need this — plausible-not-perfect is the goal.

Regenerated each offseason. Plausible-not-perfect is the goal.

### 3.3 Season Calendar

- **Late October:** World Series concludes
- **Early November:** Awards announced
- **Mid November:** Retirements, free agency begins, manager/coach hiring opens
- **Dec – Jan:** FA period, trade activity
- **February:** Pitchers and catchers report (flavor)
- **Mid-March:** Spring training concludes
- **Late March/Early April:** Opening Day
- **Mid-July:** All-Star Game
- **June 30:** Amateur Draft
- **July 2:** International signing window opens
- **End of July:** Trade deadline
- **September 1:** Roster expansion (26 → 28)
- **Late September:** Regular season ends
- **October:** Postseason
- **Late October:** World Series

### 3.4 Postseason Format

12-team format mirroring current MLB:

- 6 teams per league (3 division winners + 3 wild cards)
- **Wild Card:** Top 2 division winners get byes. #3 hosts #6 (best-of-3, all home games for higher seed). #4 hosts #5 (best-of-3).
- **Division Series:** Best-of-5
- **LCS:** Best-of-7
- **World Series:** Best-of-7. Home-field by regular-season record.

> **Status (0.12.0) — Playoffs hub + record isolation.** League →
> Playoffs shows the most recent completed bracket: champion banner,
> per-league seed lists (with archived records and bye labels), every
> series (WC/DS/LCS/WS) with scores, and tap-through to each series'
> games and full box scores. Before the first postseason exists it
> shows a live "if the season ended today" seeding preview. Fixed
> alongside: postseason games no longer bleed into `seasonRecord` —
> the 162-game record is untouched by playoff results (was a real bug;
> the harness now hard-fails if any archived record ≠ 162 games).
>
> **Status (0.13.1) — October plays day by day.** The postseason is no
> longer a one-shot sim: at season's end the user starts the bracket,
> and Advance Day plays that day's playoff games on the calendar —
> both wild-card series in parallel three days after the finale, each
> round opening two rest days after its feeders finish. The Playoffs
> tab renders the LIVE bracket (series leads, upcoming game dates,
> pending matchups), Scores carries the October slate, the dashboard
> shows the user's series status with a Sim-Rest-of-Postseason escape
> hatch, and the champion gets a proper crowning moment before the
> offseason opens. Reliever rest and IL recovery now tick naturally
> through October (they couldn't in the one-shot). The harness's
> "sim it all" path loops the same day-by-day code, so both paths
> share identical mechanics.

### 3.5 Tiebreakers

1. Head-to-head record
2. Intra-division record
3. Intra-league record
4. Run differential in head-to-head games
5. Overall run differential
6. Random (extremely rare)

No game 163 — engine resolves via hierarchy. Deliberate simplification.

---

## 4. Team Generation

### 4.1 Team Identity

Each team generated with:
- **City:** From pool of plausible North American cities
- **Nickname:** From pool of plausible team nicknames
- **Full name:** "[City] [Nickname]"
- **Abbreviation:** 2-3 letter code
- **Primary and secondary colors:** Complementary or contrasting pair from curated palette; teams in same division never share primary colors
- **Founded year:** Between 1900 and 1995 (later years flagged as "expansion teams")

Pools large enough to support multiple regenerations without obvious repeats. Seed-controlled.

### 4.2 Market Size

- **Large market (8 teams):** New York-tier metros. Highest revenue ceiling.
- **Mid market (14 teams):** Most teams. Solid base, competitive payrolls.
- **Small market (8 teams):** Smaller cities. Payroll-constrained, must develop talent.

Fixed at generation. Affects base revenue, free agent attractiveness, and (potentially) fan pressure.

### 4.3 Owner Archetypes (assigned at generation)

**1. Win-Now Spender** — Payroll 110-130% of base. Prioritizes proven veterans, deals prospects, aggressive on top FAs. Hires veteran managers, fires fast. Aggressive prospect promotion. (Steinbrenner-Yankees, peak Dodgers.)

**2. Patient Builder** — Payroll 90-105% of base. Prioritizes prospects, trades vets for futures, selective FA. Development-focused managers, long tenures. Conservative promotion. (2010s Astros, Rays.)

**3. Cheap Owner** — Payroll 60-80% of base. Trades vets approaching FA regardless of contention, rarely participates in FA above min tier. Inexpensive managers. Aggressive promotion in service-time-friendly windows. (Pirates eras, classic Marlins.)

**4. Analytics-Driven** — Payroll 95-110% of base. Targets undervalued players, exploits inefficiencies, bargain-hunts in FA. Analytically-aligned managers. Promotion based on objective readiness. (2010s Rays, A's, post-Friedman Dodgers.)

**5. Old-School** — Payroll 100-115% of base. Values "grit," veteran leadership, traditional stats; overpays for narrative. Aggressive on name-recognition vets, slow on analytics darlings. Veteran managers with playing-career credentials. Slow prospect promotion. (Reinsdorf-White Sox, mid-2010s Tigers.)

**6. Aggressive Trader** — Payroll 95-110% of base. High trade volume, willing to make blockbusters either direction. Moderate FA. Variable promotion based on trade activity. (Preller-Padres, mid-2010s Diamondbacks.)

### 4.4 Payroll Calculation

```
base_budget = market_size_base × owner_archetype_multiplier × random_variance(0.95–1.05)
```

**Market size base** (millions, tunable):
- Large: $200M / Mid: $140M / Small: $90M

**Owner multipliers** (mid-range):
- Win-Now Spender: 1.20
- Patient Builder: 0.97
- Cheap Owner: 0.70
- Analytics-Driven: 1.02
- Old-School: 1.07
- Aggressive Trader: 1.02

Actual annual spend may exceed budget temporarily (contention windows) or fall well below (rebuilds). Owner archetype determines tolerance and adjustment aggressiveness.
International bonus pool is separate from MLB payroll budget and is not adjustable by owner. The market-size and owner-archetype payroll formula applies to MLB payroll only.

### 4.5 Ballparks and Park Factors

Every team has a generated ballpark:
- **Name:** Generated ("[Sponsor] Park," "[Local Reference] Field," classic-style names mixed in)
- **Capacity:** 30,000 – 55,000
- **Year built:** 1910 – current, mostly 1990–2020
- **Park factors** (key gameplay element)

**Park factors** (each centered around 100):
- **Run factor:** 90–115. Overall offensive environment.
- **HR factor:** 80–125. Home-run rates.
- **Hits factor (BABIP modifier):** 95–108. Balls-in-play results.
- **Doubles/Triples factor:** 90–115. Gap hits.
- **Foul territory:** Small/Medium/Large. Affects flyout rates on fouls.

**Distribution:**
- Most parks: 95-105 on each factor
- **Hitter's parks (3-4 per league):** Run 108-115, HR 110-125
- **Pitcher's parks (3-4 per league):** Run 88-95, HR 80-92
- **Quirk parks (1-2 per league):** Specific extreme factors (huge gaps, short porches, deep alleys with short walls)

Applied at game-time as multipliers to base outcome probabilities. Variety creates strategic differentiation — teams build around their park.

### 4.6 Team Persistent Attributes

- **Competitive window state:** `rebuilding | retooling | contending | win-now`. Dynamic, recalculated each offseason. Drives AI trade and FA behavior.
- **Reputation:** 0-100 score updated by results, big signings, championships. Affects FA willingness.
- **Historical record:** All-time wins, championships, awards by team employees, retired numbers. Cosmetic depth over long saves.

### 4.7 Intra-League Rivalries (Future System)

> **Status: not implemented.** This section captures the design for a flavor/narrative layer that will be added in a later phase. The current schedule generator and team data model do **not** include rivalries. Adding rivalries should not change schedule logic, team identity, or simulation behavior at the time it ships — it's purely additional metadata for downstream narrative systems to read.

#### 4.7.1 Scope

Rivalries are an **intra-league** flavor layer. Each team has a small set of rivals from within the same league.

- **Intra-league only.** Rivalries cross divisions but never cross leagues. East rivals East, West rivals West.
- **Examples:** New York vs. Boston (same Northeast), Chicago vs. Detroit (same Eastern Central), Los Angeles vs. San Francisco (same Pacific). Cross-division-but-same-league pairings (e.g., Atlanta vs. New York) are also valid.
- **No interleague rivalries** at this layer. The schedule's existing one-rival cross-league pairing (per 3.2.1) is a separate scheduling concept that already produces 4 games/year against a designated cross-league opponent and is unrelated to this system.

#### 4.7.2 Non-Goals at Launch

When this system ships, it will explicitly **not**:

- **Affect the schedule.** No forced games, no fixed series counts, no reweighting of intra-league matchups. The schedule remains purely structural — division, intra-league non-division, interleague rotation per 3.2.1.
- **Affect simulation outcomes.** A rivalry game and a non-rivalry game roll the same engine math.
- **Affect player ratings, fatigue, injuries, or development.** Rivalries are metadata, not modifiers.

The point: rivalries should add narrative texture without distorting the underlying baseball model.

#### 4.7.3 Data Shape

Rivalries are **team-level metadata**. Concept (not implemented):

```js
// On each team object:
rivalries: {
  primary:   ["bos"],          // most-storied rivalry; small list (1-2)
  secondary: ["phi"],           // notable but lower-intensity rivals (0-3)
}
```

- IDs reference the stable `team.id` values from BBGM_TEAMS.
- Both arrays may be empty for teams without an established rivalry tradition.
- Rivalries are **directional** at the data level (each team lists its own rivals), so a one-sided rivalry is expressible. In practice most rivalries will be reciprocal (NYE has BOS as primary; BOS has NYE as primary), but the schema doesn't enforce this.

The data lives in `js/data/teams.js` alongside the rest of the fixed identity. Default rivalries are part of the NABL canon and ship as static data — not generated per save.

#### 4.7.4 Intended Future Uses

When the system lands, these are the surfaces that read rivalry data:

- **Owner goals.** Examples: "Win the season series vs. Boston," "Sweep the Detroit road trip." These feed into owner confidence and the pressure system.
- **News system.** Rivalry wins/losses generate richer headlines than ordinary results. A walkoff against your primary rival headlines for a day; a series sweep generates a feature story.
- **Fan interest / immersion.** Rivalry games are surfaced more prominently on the dashboard and Today's Games. Optional: small stadium-attendance flavor when stadium revenue modeling exists.
- **Standings overlays (optional).** A "vs. rivals" sub-record on the standings page — e.g., "8–5 vs. BOS" — makes the rivalry tangible without adding mechanical weight.

#### 4.7.5 Phase Placement

Implementation depends on systems that don't exist yet (owner goals, news, optional standings overlays). Likely sequencing:

1. **Phase 17+ (post-launch polish).** Add the data shape (4.7.3) to `js/data/teams.js` with the default NABL rivalries. Pure data; no readers yet.
2. **Phase 17+ news system.** First reader: rivalry-flavored headlines.
3. **Phase 17+ owner goals.** Second reader: rivalry-themed offseason goals.
4. **Optional:** rivalry sub-record overlays on the standings UI.

No firm phase number is assigned because this is an enhancement layer that can land any time after the news/owner-goals work is in flight. Adding rivalry data on its own is cheap and harmless even before the readers exist.

#### 4.7.6 Why Metadata-Only Matters

Keeping rivalries as a flavor layer is a deliberate scope cap. Many sims overload "rivalry" with mechanical effects (rating boosts, schedule pressure, momentum modifiers) and end up with rivalry games feeling artificially different from the rest of the season. Baseball GM Classic intentionally separates structure (the schedule, the engine) from narrative (rivalries, news, owner goals). Rivalries make the league feel inhabited; they don't change who wins.

---

## 5. Player Data Model

### 5.1 Universal Player Schema

Every player in the system — whether on a major league roster, in the minors, on the draft board, in the international pool, retired, or in the Hall of Fame — uses a single unified schema. Status flags determine what they're doing in the world.

```
{
  id: <unique string>,
  
  // Identity
  firstName: string,
  lastName: string,
  birthDate: { year, month, day },
  age: <calculated from birthDate>,
  birthplace: { country, region/state },
  bats: "L" | "R" | "S",
  throws: "L" | "R",
  
  // Position
  primaryPosition: "C" | "1B" | "2B" | "3B" | "SS" | "LF" | "CF" | "RF" | "DH" | "SP" | "RP" | "CP",
  secondaryPositions: [<position>, ...],
  
  // Status
  status: "active" | "minors" | "free_agent" | "draft_eligible" | "international_pool" | "retired" | "deceased",
  teamId: <teamId> | null,
  rosterStatus: "26-man" | "40-man" | "AAA" | "AA" | "A+" | "A" | "rookie" | null,
  ilStatus: { active: bool, type: "10-day" | "15-day" | "60-day" | "season-ending", returnDate: date } | null,
  
  // Visible Ratings (20-80 scale, internally stored as continuous values 20.0-80.0)
  ratings: {
    // Hitters
    contactVsR: number,
    contactVsL: number,
    powerVsR: number,
    powerVsL: number,
    discipline: number,
    speed: number,
    bunting: number,
    defense: number,
    arm: number,
    
    // Pitchers
    stamina: number,
    velocity: number,
    movement: number,
    control: number,
    stuff: number
  },
  
  // Hidden values (never shown to user except through scout reports with uncertainty)
  hidden: {
    ceiling: { /* same structure as ratings, max possible per attribute */ },
    floor: { /* same structure, worst case */ },
    archetype: <archetype string>,
    developmentCurveParams: { peakAge, riseRate, declineRate, volatility },
    injuryProneness: number (1-10),
    workEthic: number (1-10),
    makeupGrade: number (1-10)
  },
  
  // Career
  contract: { years, totalValue, annualSalary, signedDate, signedAt: "FA" | "extension" | "draft" | "intl" | "minor_league" },
  serviceTime: { years, days },
  draftInfo: { year, round, overallPick, draftedBy } | null,
  intlInfo: { signingYear, originCountry, signingBonus, postedFrom } | null,
  
  // Stats history (keyed by year)
  stats: {
    2026: { mlb: {...}, minors: {AAA: {...}, AA: {...}}, postseason: {...} },
    2027: { ... },
    ...
  },
  
  // Career achievements
  achievements: {
    awards: [<awardId>, ...],
    allStarSelections: [<year>, ...],
    championships: [<year>, ...],
    milestones: [<milestoneId>, ...]
  },
  
  // Injury history
  injuryHistory: [{ year, type, severity, daysOut, careerImpact: number }],
  
  // Memory aids for AI evaluation
  scoutingReports: {
  // Most recent observation per source
  internal: { 
    year: <year of last update>,
    accuracy: <"high" | "medium" | "low" | "minimal">,
    observedRatings: { /* ratings with uncertainty bands */ },
    notes: <generated text snippets>
  },
  external: {
    // Reports your scouts produce on other teams' players
    // Only populated when scouts have observed this player
    year: <year of last observation>,
    accuracy: <"medium" | "low" | "minimal" | null>,
    observedRatings: { /* ratings with uncertainty bands */ },
    notes: <generated text snippets>
  }
}

### 5.2 Rating Scale Detail

All ratings use the **20-80 scale** stored internally as continuous floats and displayed as nearest 5-point grade.

**Display values and meaning:**
- **20:** Well below replacement; cannot perform at a major-league level
- **30:** Replacement-level / Quad-A talent
- **40:** Below average, but playable major-leaguer in the right role
- **50:** Major league average
- **55:** Above-average regular
- **60:** Plus tool; above-average regular or fringe All-Star
- **65:** Plus-plus tool; All-Star caliber
- **70:** Well above average; perennial All-Star tool
- **75:** Elite; one of the best in baseball at this attribute
- **80:** Generational; Bonds power, Pedro stuff, Maddux command

**Internal storage:** Continuous values like 52.7 or 67.3 to give the simulation engine precision. The displayed grade is the nearest 5-point increment (52.7 displays as 50, 67.3 displays as 65). Internal precision allows for meaningful variance and gradual development without visible plateaus.

**Why continuous internally:** A player improving from 52.7 to 54.1 doesn't change displayed grade, which feels static to the user. But over multiple years, that player's grade ticks up to 55 and then to 60. The illusion of stability masking real change feels right. Conversely, a player at 57.2 declining to 52.8 shows a one-grade drop (60 to 50), creating the right narrative — "he's lost a grade off his fastball."

### 5.3 Hitter Ratings Detailed

**Contact vs RHP / Contact vs LHP**
The hitter's ability to make solid contact against right-handed and left-handed pitching, respectively. Drives BA on balls in play and (combined with discipline) drives strikeout rate. Higher contact = more balls in play, lower K rate, more singles and doubles. Splits matter — a player at 65 vs RHP and 40 vs LHP is a platoon hitter.

**Power vs RHP / Power vs LHP**
Raw power against each handedness. Drives extra-base hit rates and HR rates on balls in play. A 70-power hitter against the matchup he's good at produces HR/SLG outcomes well above league average. Splits create platoon advantages and lineup construction decisions.

**Discipline**
Plate approach. Drives BB rate and (combined with contact) reduces K rate. A high-discipline, low-contact hitter draws walks and strikes out a lot (Adam Dunn). High-discipline, high-contact is the holy grail (peak Bonds, Trout). Low-discipline hitters expand the zone, hit weakly outside the zone, and rarely walk.

**Speed**
Footspeed. Drives stolen base attempts and success rate, infield hits, taking extra bases (first-to-third on a single, scoring from first on a double), avoiding double plays, and range on defense. Speed has real cascading value in this engine, especially in the classic gameplay context where putting balls in play matters more.

**Bunting**
Sacrifice bunt success rate, bunt-for-hit ability, squeeze plays. A separate skill from contact because bunting well is a specific craft. High bunting + high speed = a real weapon (the Otis Nixon / Brett Butler archetype). Most modern players have low bunting (50 or below), which fits both modern reality and the "classic baseball comes back into play" theme — players with high bunting create unique strategic options.

**Defense**
Single rating applied to whatever position they're playing. Position adjustments at simulation time: a 60 defender at SS is elite, a 60 defender at 1B is just average for the position. Drives errors avoided, range factor, double play turning, etc.

**Arm**
Throwing arm strength and accuracy. Affects outfield assists, runner advancement on balls hit to OF, infielder ability to throw out runners on tough plays. Catchers' caught-stealing percentage tied heavily to arm.

### 5.4 Pitcher Ratings Detailed

**Stamina**
How long a pitcher can effectively work in an outing and how often they can pitch. Drives starter vs. reliever role assignment, innings pitched per start, and recovery time. A pitcher with 70 stamina can give you 7-8 innings regularly. A pitcher with 40 stamina is a one-inning reliever. Stamina also affects how their other ratings degrade through an outing — a low-stamina pitcher loses velocity and control faster as pitch count climbs.

**Velocity**
Fastball speed. Drives K rate (combined with stuff and movement), and weak-contact rates. High velocity alone is not sufficient — a 75-velocity pitcher with 30 control is a Triple-A lifer. But high velocity is a force multiplier on the other ratings.

**Movement**
Pitch movement / late break. Drives groundball rate, weak contact, and missed-bat rate. The classic "pitcher's pitcher" archetype is high movement + high control + average velocity (Maddux: 50 velo, 80 movement, 80 control, 65 stuff). In the engine, movement compensates significantly for lower velocity, which is exactly the era flavor we want.

**Control**
Command of the strike zone. Drives BB rate (low control = high walks) and ability to hit spots (avoiding the middle of the plate). High control reduces both walks *and* the rate of "meatballs" that get punished. A high-control pitcher with average stuff outperforms his ratings; a low-control pitcher with elite stuff underperforms.

**Stuff**
Quality of the pitcher's repertoire — sharp breaking balls, deceptive changeups, the "uncomfortable at-bat" factor. Primarily drives strikeout rate. Stuff is the K rate engine. A pitcher can succeed with low stuff if movement and control are high (he'll strike out fewer guys but produce a lot of weak contact). A pitcher with 75 stuff is a strikeout machine even with average velocity (think peak Pedro or peak Verlander before the velocity dip).

### 5.5 Position Eligibility

A player has a primary position and 0-3 secondary positions. Playing the primary position incurs no defensive penalty. Playing a secondary position incurs a small penalty (defense rating treated as 5 points lower). Playing an unlisted position incurs a large penalty (defense rating treated as 15 points lower) — this is "emergency" usage.

**Position families:**
- **Catcher:** Primary catchers rarely have secondary positions. Some catchers list 1B or DH as secondary in late career.
- **Infield:** SS players often list 2B or 3B secondary. 2B and 3B players often list each other secondary. 1B players rarely have other infield secondaries (except sometimes 3B). Utility infielders may have 2B, SS, 3B all listed.
- **Outfield:** CF players usually list LF and RF secondary. Corner OF players often list each other secondary. Utility OF guys play all three.
- **DH:** Not a primary position for prospects (they enter the system as a position player). Players move to DH primary late in career or due to defensive collapse.
- **Pitchers:** SP/RP/CP. Stamina rating drives role assignment but role is also a designation. A high-stamina pitcher can be deployed as a starter or as a multi-inning reliever. A low-stamina pitcher cannot start.

### 5.6 Hidden Archetype System

Every player has a hidden **development archetype** assigned at generation that shapes their career trajectory. The user never sees the archetype name; they only see the player's ratings and stats unfolding over time.

**Hitter archetypes:**

- **Traditional Curve (35% of hitters):** Smooth rise from age 20-22 to peak around 27-29, gradual decline through 33-35. The "default" career shape.
- **Late Bloomer (10%):** Below-average until age 26-27, breaks out and produces above-expectation through early-to-mid 30s. Classic Nelson Cruz archetype.
- **Early Peak (15%):** Peaks at age 23-25, plateaus through 27, declines starting at 28. Often busts after a great young phase. Many former top prospects.
- **One-Year Wonder (5%):** Has one outlier season (often early career) that vastly exceeds their true talent, then settles back. Brady Anderson 50 HRs.
- **Steady Decliner (10%):** Peaks early (22-24), gradually declines through career. Usually high-floor, low-ceiling players who arrive nearly polished.
- **Quad-A (10%):** Crushes minor league pitching but never establishes in MLB. Hidden ceiling at MLB-average; floor is replacement.
- **Slow Burn (10%):** Steady, slow improvement throughout 20s, peaks late (30-32), gradual decline. Edgar Martinez.
- **Volatile (5%):** Wide year-to-year variance. Big years and disappointing years alternate. Hard to evaluate.

**Pitcher archetypes:**

- **Traditional Curve (30%):** Rises through mid-20s, peaks 27-30, declines through mid-30s.
- **Workhorse (10%):** High stamina, slow but durable. Peaks moderately high but holds peak performance through entire career.
- **Late-Career Reinvention (10%):** Loses velocity in late 20s but learns command/movement and becomes effective again in 30s. Bartolo Colon late career.
- **Flameout (10%):** High peak in mid-20s, then injury-driven decline starting around 27. Many top pitching prospects.
- **Crafty Veteran (10%):** Average peak, but stuff/movement compensate for declining velocity well. Long careers, low ceiling but high floor late.
- **Reliever Conversion (10%):** Failed starter who becomes effective reliever. Stuff plays up in short bursts, stamina rating drops.
- **Quad-A (10%):** Dominant in minors, never figures out MLB.
- **Volatile (10%):** Inconsistent year-to-year. Maddening to roster.

**Archetype effects in code:**

Each archetype carries:
- `peakAge`: where the curve maxes out
- `riseRate`: how quickly ratings approach ceiling pre-peak
- `declineRate`: how quickly ratings drop post-peak
- `volatility`: year-over-year random variance
- `breakoutAge`: for late bloomers, when the spike happens
- `reversionLikelihood`: for one-year wonders, how reliably they fall back

The progression engine uses these parameters annually to update ratings.

### 5.7 Hidden Ceiling and Floor

Visibility of Ratings
.
5.7.1 Visibility Categories
Player ratings exist in the engine as continuous internal values (the "true ratings"). What the user sees depends on the player's relationship to the user's organization and the user's scouting tier.
Four visibility states:
Exact: True rating shown precisely. Displayed as the nearest 5-point grade.
Tight band: Range shown spanning 5-10 rating points (e.g., "Power: 55-60"). True rating falls within band 90% of the time.
Wide band: Range shown spanning 15-25 rating points (e.g., "Power: 50-70"). True rating falls within band 75% of the time.
Hidden: No rating information shown. Player visible but ungradable.
5.7.2 Visibility Rules by Player Status
Player on user's MLB roster:
All ratings: Exact (always)
Hidden archetype: Inferable through performance over time but never directly displayed
Hidden makeup/work ethic/injury proneness: Surface as scout note flavor only ("durable," "hard worker," "questions about commitment")
Player in user's minor league system:
AAA: Tight band (always, regardless of scouting tier — your AAA guys play games your staff watches)
AA: Tight band at scouting tier "above average" or "elite," wide band at "standard," wide band with some gaps at "bare bones"
A+: Wide band at all tiers; "elite" and "above average" tighten somewhat
A and below: Wide band; "bare bones" leaves significant gaps in coverage
Recent draftees and intl signings: Wide band, becomes more accurate as they move up levels
Player on another organization's MLB roster:
All ratings: Exact (their performance is public; no fog)
Hidden archetype: Same as user's own players — inferable through performance
Player in another organization's minor league system:
AAA: Tight band at "elite," wide band at "above average" or "standard," minimal info at "bare bones"
AA: Wide band at "elite" or "above average," minimal info at lower tiers
A+ and below: Minimal info except at "elite" tier (and even then, wide band on top prospects only)
Amateur draft prospect (pre-draft):
Top 50 in class get visible reports; depth varies by scouting tier
Top 10-15: Tight band at "elite," wide band at "above average," wide band with notable gaps at "standard," very wide / partial reports at "bare bones"
Picks 11-50: Wide band at "elite" and "above average," sparse info at "standard," names and positions only at "bare bones"
Picks 51+: Sparse info at all tiers; "elite" scouts get a few extra names worth knowing
Player in international pool:
Top 30 in class: visibility rules similar to top draft prospects
Bottom 70: minimal info at all tiers (origin, age, position, possibly one tool grade for the most-watched of the group)
5.7.3 Fog Reduction Through Career Progression
For prospects in your system, scouting fog naturally reduces as they progress:
Drafted/signed → Wide band initial report
Reaches A+ or AA → Band tightens by ~30%
Reaches AAA → Band tightens further; archetype hints surface in scout notes
Promoted to MLB → Full exact ratings unlocked
A high-scouting-tier team gets cleaner reports throughout this progression. A low-scouting-tier team experiences the same progression but with wider bands at every level.
5.7.4 Scouting Notes and Flavor
Beyond rating bands, scouting reports surface qualitative notes:
"Plus arm strength flashed in fall instructional"
"Concerns about plate discipline against breaking stuff"
"Has put on weight; questions about future athleticism"
"Late-bloomer profile noted by multiple scouts"
"Rotation projection only; bullpen fallback if command doesn't develop"
These notes are generated based on the player's true ratings, archetype, and hidden values, with appropriate noise. A high-scouting-tier team gets accurate, useful notes. A low-scouting-tier team gets generic notes ("solid prospect, keep an eye on him") or notes that occasionally mislead. Notes about hidden archetype tendencies (work ethic, makeup, injury proneness) only surface clearly at "above average" or "elite" tiers.

### 5.8 Makeup, Work Ethic, Injury Proneness

Three additional hidden 1-10 ratings affect development:

**Work Ethic (1-10):** How well the player responds to coaching and translates raw tools to production. High work ethic adds a small bonus to annual progression. Low work ethic causes prospects to underperform their ceiling consistently.

**Makeup Grade (1-10):** Mental/emotional makeup. Affects clutch performance (small modifier), response to slumps, behavior in clubhouse (rare narrative events). Low makeup occasionally causes "lost season" events.

**Injury Proneness (1-10):** Drives injury roll frequency. A 1 means rarely injured; a 10 means chronically injured (the Mark Prior/Carlos Quentin/Carl Crawford archetype).

These are visible only as scout-report summaries (e.g., "good makeup, durable" vs. "questions about work ethic") and never as numeric values to the user.

### 5.9 Player States Through Career

A player passes through states across their career:

1. **Pre-draft** — generated as amateur prospect, age 17-22, in draft pool
2. **Drafted prospect** — assigned to organization, in minor leagues at appropriate level
3. **MLB rookie** — first MLB callup, accumulating service time
4. **Established MLB player** — past rookie eligibility, on active roster
5. **Veteran** — late-career, declining curve
6. **Free agent** — between contracts
7. **Retired** — career over, eligible for HoF after 5 years
8. **Hall of Famer** — voted in
9. **Deceased** — long-running save flavor (rare)

Each state has implications for how the player is processed each game-day.

---

## 6. Player Generation

### 6.1 Generation Contexts

Players enter the world through several generation paths, each with different parameters:

1. **Initial league population** at game start (March 2026)
2. **Annual amateur draft** (every June 30)
3. **Annual international signing pool** (every July 2)
4. **Special international events** (Japanese postings, Cuban defectors, Korean declarations)
5. **Replacement-level fill** (rare; minor-league filler)

### 6.2 Initial League Population

At game start, a complete league is generated. This is the most complex generation event because it has to produce a believable, balanced league out of nothing.

**Population requirements per team:**
26-man rosters: 30 × 26 = 780
40-man extras: 30 × 14 = 420
Minor leagues: 30 × 30 = 900
Total active: ~2,100 players
Plus ~150 free agents and recent retirees
Initial generation total: ~2,250 players
- **Coaching/manager pool:** ~100 coaches and managers across active staff and FA staff
- **Recent draft and intl pool history:** ~5 years of past draft classes (most still in minors or recently retired) — flavor for league history

Total initial generation: ~2350 players plus staff.

**Distribution requirements:**

The league must produce realistic talent distribution. At each level:

- **MLB rosters:** Mostly 50-rated players (league average). Each team has 2-4 stars (60+), 5-8 above-average regulars (55-60), the rest 45-50. Roughly 60 true stars across the league (top ~5%).
- **AAA:** Older fringe MLB players (45-55 range) and top prospects (varied ratings, high uncertainty).
- **AA:** Where many top prospects live (mix of high-ceiling guys and AA-ceiling guys).
- **A+ / A / Rookie:** Recent draftees and intl signings, mostly young, with appropriate ceilings.

**Age distribution:**
- MLB roster average age: 28 (range 21-40)
- AAA average: 26 (range 19-35)
- AA average: 23 (range 18-28)
- A+ average: 21 (range 17-25)
- A average: 20 (range 17-23)
- Rookie/DSL average: 18 (range 16-21)

### 6.3 Generation Algorithm (Initial League)

For each level, generate the appropriate number of players. The algorithm:

1. **Determine player position.** Use realistic position distributions: each team needs 1 starting C and a backup, 4 infielders + bench, 3 outfielders + bench, 5 SP, 7-8 RP, 1 CP. Generate players to fill these slots across all 30 teams' active rosters first, then 40-man, then minors.

2. **Determine age.** Roll within the level's age distribution.

3. **Determine ceiling.** Based on level and age — a 28-year-old MLB regular has different ceiling characteristics than a 19-year-old A-ball prospect. Older players generally have lower ceilings (their ceiling is what they've shown).

4. **Determine archetype.** Roll based on archetype distribution. For older players, "early peak" archetypes are more likely if their floor is high (they've had their peak and are heading down).

5. **Determine current ratings.** For older players, current ratings = a substantial fraction of ceiling (they're closer to their ceiling because they've had time to develop). For younger players, current ratings are well below ceiling (they have years of development ahead).

6. **Set hidden values.** Floor, archetype curve params, injury proneness, work ethic, makeup.

7. **Set contract.** Older players have appropriate veteran contracts. Prospects have minor-league deals or rookie contracts. Free agents have no contract.

8. **Set service time.** Calculated to match age and league experience.

9. **Generate stats history.** For MLB players, generate realistic stat lines for prior seasons that roughly match their ratings trajectory. (This is mostly cosmetic but adds depth — a 30-year-old All-Star should have a stat history showing a 28-year-old breakout, etc.)

### 6.4 Talent Distribution Tuning
The talent distribution is tuned so that:
About 60 players in the league are "stars" (overall rating equivalent of 60+, top 2%)
About 300 players are above-average regulars
About 500 players are average regulars
The rest are role players, bench, depth
This creates the classic MLB talent pyramid where stars are scarce and meaningful.
Position scarcity matters. Catchers have lower offensive ratings on average (their value is defense and game-calling). Shortstops have higher defensive ratings on average. Power tends to concentrate in 1B/3B/corner OF/DH; speed concentrates in CF/2B/SS.
6.5 Amateur Draft Generation (Annual)
Every year on June 30, a draft class is generated. Draft classes vary in strength to add narrative texture (some years are deep, some are weak).
10 rounds, 300 picks total
Each year's class has a strength rating (-2 to +2 std dev) affecting top-end ceilings
Top 50 prospects get visible ranked list; top 10-15 get detailed reports
Strong years: 3-5 elite (75+ ceiling) prospects at top
Weak years: 1 or fewer elite prospects, round 1 ceilings cap at 65-70
Player attributes:
Age: 17 (HS player) to 23 (college senior). Distribution:
HS players (17-18): 30% of class
College freshmen (eligible only as draft-eligible, 19-20): 5%
College sophomores (20-21): 10%
College juniors (21-22): 35%
College seniors (22-23): 20%
Background: Generated to feel realistic — high school programs, college programs (a pool of fictional college names with regional/strength flavor).
Ceiling distribution:
Top 5 picks: ceiling 70-80 on best ratings
Picks 6-30 (rest of 1st round): ceiling 65-75 on best ratings
2nd round: ceiling 60-70
3rd-5th round: ceiling 55-65
6th-10th round: ceiling 50-60
11th-15th round: ceiling 45-55
16th-20th round: ceiling 40-50
These are typical distributions. Outliers exist — the 14th-rounder who turns into a star, the 1st-rounder who never develops. About 5% of draft classes contain a "hidden gem" later-round player with ceiling well above their slot's typical.
Starting ratings (draft day):
Per project requirement: even the best draftees are no more than MLB-average overall on draft day. So a #1 overall pick with 78 ceiling on power has current power around 50-55 on draft day. The path from current to ceiling takes 3-7 years of development.
College players typically have higher current ratings (closer to ceiling) than HS players. A college senior power hitter might be at 58 with a 65 ceiling — not much development left. An 18-year-old HS pitcher might be at 45 with a 75 ceiling — lots of room to grow, lots of risk.
Archetype distribution in draft: Same as overall, but with slight adjustment — HS players slightly more likely to be "Late Bloomer" or "Volatile"; college players more likely to be "Steady Decliner" or "Traditional Curve."
Hidden values vary by background:
HS players: higher uncertainty bands on ceiling, more variable archetype
College players: tighter uncertainty bands, more predictable archetype
This makes drafting HS players riskier (higher variance) and college players safer (tighter outcomes), mirroring real MLB draft strategy.
Pre-Draft Scouting Reports
6.6 Pre-Draft Scouting Reports
Visibility of draft prospect information is governed by scouting tier (see 6.9). The same draft class looks meaningfully different to teams operating at different scouting tiers.
At "elite" scouting tier:
Visible top-50 ranking with mostly accurate slot projections
Top 15 prospects: tight rating bands (5-10 points), specific archetype hints, useful concerns
Picks 16-50: wider bands but still actionable, archetype hints emerging
Picks 51-100: identifiable, with rough tool grades and basic info
Beyond 100: names and positions, sparse data
At "above average" tier:
Visible top-50 ranking, with slot projections roughly accurate
Top 15: wider bands (10-15 points), partial archetype information
Picks 16-50: wide bands, generic notes
Picks 51-100: names and basic info
Beyond 100: very limited
At "standard" tier:
Top-30 ranking visible, slot projections noisy
Top 10: wide bands (15-20 points), generic notes
Picks 11-30: wide bands with gaps in tool coverage
Picks 31-100: names, positions, single tool grades only
Beyond 100: minimal
At "bare bones" tier:
Top-15 ranking visible, often shifts significantly in actual draft order vs. projection
Top 10: very wide bands (20-25 points), often missing 1-2 tools entirely
Picks 11-50: names and positions, occasional tool grades
Beyond 50: essentially blind
The asymmetry is the point. An elite-scouting team enters the draft with information advantages; a bare-bones team enters mostly hoping. Combined with the user's draft slot (which is fixed by previous-season record), scouting tier becomes a real second axis of draft strategy.
Pre-draft mock drafts are generated based on consensus rankings with appropriate noise. The user sees public mock drafts that are accurate ~60-70% of the time on top picks, less accurate further down. These exist regardless of user's scouting tier (they're industry-wide reports).
Replaces Section 6.7 — International Pool Generation
6.7 International Pool Generation (Annual)
Every July 2, a new international signing class enters the pool. ~100 prospects per year.
Origin distribution:
Dominican Republic: 35%
Venezuela: 20%
Cuba: 5% (in years with normal flow; defectors handled separately)
Mexico: 8%
Puerto Rico: 5%
Colombia: 4%
Panama: 3%
Other Latin America: 5%
Japan: 5% (younger amateur signings, separate from posting system)
Korea: 4%
Taiwan: 3%
Australia: 2%
Other: 1%
Ages: 16-22, with most clustered at 16-17.
Talent distribution:
Top 5 international prospects: ceilings 75-80 on best ratings (matches top draft picks)
Top 6-15: ceilings 65-75
Top 16-30: ceilings 55-65
Bottom 70: ceilings 40-55
International talent has higher variance than domestic draft. The same hidden ceiling expressed at age 16 produces a wider range of outcomes than a 21-year-old college player.
Pool budgets: Fixed by market size and owner archetype. Not annually adjustable by user.
Visibility by scouting tier:
Elite scouting: Top 30 prospects get visible reports with tight to medium bands. Top 5 get especially detailed reports with archetype hints. Bottom 70 get name, country, age, position, occasional tool grade.
Above average scouting: Top 30 visible with wide bands. Top 5 reports more detailed but bands still meaningful. Bottom 70 minimal info.
Standard scouting: Top 15-20 visible with wide bands. Beyond that, names and basic info only.
Bare bones scouting: Top 5-10 visible with very wide bands. Most of pool is essentially "sign these kids and hope."
This is where small-market analytics-driven teams with elite scouting can find real edges. Bigger market teams with lower scouting investment may overpay for the wrong international prospects because their info is fuzzy.
6.8 Special International Events
Three types of special events generate unique players outside the standard pool:
Japanese Posting System: Each year, 0-3 NPB stars are posted to MLB. These players are 25-30 years old, already established at a high level. They have known ratings (closer to MLB-ready than typical prospects), with some uncertainty about how their game translates. Posted players negotiate with all 30 teams. The posting fee is paid to the NPB team. These are major events — a top posted player commands huge contracts.
Cuban Defectors: Random event, 0-2 per year. A Cuban player defects and becomes available. These players come with even more uncertainty than Japanese posts (less data on competition), but occasionally produce stars (the José Abreu / Yoenis Céspedes / Aroldis Chapman archetype). All 30 teams can bid.
Korean Declarations: Less common than Japanese postings (0-1 per year). KBO stars who declare for MLB free agency. Generally older (28-32) and more affordable than Japanese posts.
These events add narrative texture to offseasons and create occasional "where will the star go?" moments.
### 6.9 Scouting Budget System

Scouting is a strategic resource the user manages each offseason. The system determines how clearly the user sees prospect information across the league.

### 6.9.1 Budget Funding

Each team has an annual scouting budget separate from MLB payroll, determined by:

- **Baseline floor:** Every team gets a minimum scouting budget regardless of market or owner. Funds the bare-bones tier.
- **Market size contribution:** Adds capacity proportional to revenue (large markets generate more revenue, can afford more scouting).
- **Owner archetype contribution:** Owner archetype influences willingness to fund scouting (see 6.9.4).
- **User allocation decisions:** During offseason, user can request increased scouting tier from ownership; outcome depends on archetype and team performance.

**Budget tier costs (in millions, tunable):**

- **Bare bones:** $3M (covered by baseline)
- **Standard:** $7M (covered by typical revenue)
- **Above average:** $15M (requires meaningful investment; competes with other budgets)
- **Elite:** $25M (significant commitment; competes heavily with payroll)

Smaller markets at higher tiers feel the cost more sharply. A small-market team running elite scouting has noticeably less to spend on payroll, intl bonus pool inflation, and coaching than a peer running standard scouting. This is the trade-off.

### 6.9.2 Budget Tiers and Effects

**Bare Bones (Tier 1):** Skeleton crew. Significant fog at all levels. Top draft and international prospects identifiable but with very wide bands and frequent miscalibrations. Other organizations' prospects largely opaque. Self-scouting fine at AAA, fuzzy at AA, sparse below.

**Standard (Tier 2):** Average MLB scouting operation. Top draft prospects get reasonable reports with wide bands. Other org's prospects partially visible at AAA. Decent self-scouting through AA, fuzzy below.

**Above Average (Tier 3):** Strong scouting department. Top draft and intl prospects get tight bands with useful archetype hints. Other org's prospects visible through AAA with tight bands, AA with wide bands. Self-scouting clean through AA, decent at A+.

**Elite (Tier 4):** Best-in-class. Tight bands across the board. Other organizations' AAA prospects visible with tight bands, AA prospects visible with reasonable bands, A+ visible with wide bands. Self-scouting accurate down to A-ball.

### 6.9.3 Tier Selection Mechanism

Each offseason during the budget review phase, the user sees:

- Current tier and cost
- Available tiers with costs
- Owner archetype's stated preference
- Effect of changing tier on other budgets

User selects desired tier. Owner archetype affects approval:

- **Patient Builder, Analytics-Driven:** Approve tier upgrades easily, especially toward elite
- **Cheap Owner:** Resists upgrades; may force downgrades during losing seasons
- **Win-Now Spender:** Indifferent; will fund whatever doesn't compete with payroll
- **Old-School:** Approves moderate scouting; resists "elite" as overspending
- **Aggressive Trader:** Strongly supports above-average scouting (needs info for trades)

Approval is mostly automatic but a too-aggressive ask (jumping from bare bones to elite in one year) may be denied or partially approved.

### 6.9.4 Owner Archetype Default Tiers

When teams are generated, owner archetypes set default scouting tiers:

- **Win-Now Spender:** Standard (focused on FAs, not prospects)
- **Patient Builder:** Above Average to Elite (prospect-focused)
- **Cheap Owner:** Bare Bones to Standard (penny-pinching extends here)
- **Analytics-Driven:** Above Average to Elite (info is the edge)
- **Old-School:** Standard (relies on traditional scouting, doesn't over-invest)
- **Aggressive Trader:** Above Average (needs trade evaluation)

These defaults shift over time based on results and owner mood, but provide league-start variation.

### 6.9.5 Scouting in Trade Evaluation

When evaluating a trade involving prospects, the receiving team's scouting tier determines info quality. A team at bare bones acquiring a prospect from another organization gets a generic report — name, level, position, very wide bands. A team at elite gets tight bands, archetype hints, and projected role.

This creates the "trade scouting" tension described in design pillars: scouting tier directly affects how confidently you can evaluate trade pieces. High-volume traders without strong scouting are punished by accumulating "looked good in our pre-trade analysis" prospects who turn out to be junk.

After acquisition, fog gradually clears as the prospect plays in your organization (see 5.7.3 — fog reduction through career progression). But initial trade evaluations are gated by your scouting tier at the time of the deal.

### 6.9.6 What Scouting Doesn't Affect

To keep scouting impactful but bounded, several things are *not* affected by scouting tier:

- Established MLB players' ratings (always exact, regardless of team)
- League-wide stats and standings (always public)
- Free agent ratings (always exact — they're MLB veterans)
- Historical records and award voting (public information)
- Manager and coach ratings (treated like MLB players — public)
- Trade interest from other teams (always visible at face value, though counter-offers vary)

Scouting is primarily about prospects and minor leaguers. Once a player is established at the MLB level, their value is public knowledge — what's interesting is who will *become* established, and that's where scouting earns its keep.
International Bonus Pool

Section 6.10 — International Bonus Pool

### 6.10.1 Pool Structure

The international bonus pool is a league-administered budget separate from MLB payroll and scouting budget. Each team's pool is set by the league based on competitive balance principles. Owner archetype does *not* affect pool size.

**Pool determination factors:**

- **Previous season standings (primary driver):** Worst teams get largest pools; best teams get smallest pools
- **Market size (secondary modifier):** Small markets receive a small bonus; large markets receive a small reduction

**Tiered base pool amounts (tunable):**

- Tier 1 (worst 5 teams from previous season): $9.0M
- Tier 2 (next 5 teams): $7.5M
- Tier 3 (middle 10 teams): $6.0M
- Tier 4 (next 5 teams): $5.0M
- Tier 5 (best 5 teams from previous season): $4.0M

**Market size modifier (applied after tier):**
- Small market: +$500K
- Mid market: no modifier
- Large market: -$500K

**Effective pool range:** $3.5M (best large-market team) to $9.5M (worst small-market team).

### 6.10.2 Pool Allocation by User

The user decides during the international signing window how to allocate their pool across the international prospect class:

- One large signing of a top prospect ($3-7M for an elite 16-year-old)
- Multiple medium signings ($500K-$2M each, spreading risk across more prospects)
- Many small signings ($50K-$500K each, accumulating depth from lesser prospects)
- Save pool for future years (limited — pools don't fully roll over, but partial carryover is allowed)

**Carryover rules:** Up to 25% of unspent pool rolls into the following year. The rest is forfeited. This prevents teams from hoarding multiple years of pool space for a future "splash" signing while still rewarding modest year-over-year saving.

### 6.10.3 Information Quality Affected by Scouting Tier

The international prospect pool is visible (per 6.7 and 6.9), but the *quality* of information about each prospect depends on the team's scouting tier. A team with a large international bonus pool but bare-bones scouting may overpay for the wrong prospects. A team with a small pool but elite scouting can target the right prospects efficiently and find value among lower-tier signings.

This is where the scouting/payroll/intl-pool budget triangle creates real strategic differentiation. Big-market teams tend to have larger payrolls but smaller intl pools (because they're winning more). Small-market teams have smaller payrolls but larger intl pools. Scouting investment can go to either type of team. The interaction creates distinct franchise-building paths.

### 6.10.4 Pool Penalties

If a team's signings exceed their pool:

- Up to 5% over: warning only, no penalty
- 5-15% over: small fine + reduced pool next year (-15%)
- 15-30% over: significant fine + halved pool for next 2 years
- More than 30% over: signing restrictions for 2 years (cannot sign any prospect over $300K)

Most teams avoid going over significantly. The penalties are designed to be punitive enough that exceeding pool is a deliberate strategic choice for an exceptional prospect, not a routine overspend.

### 6.10.5 Pool Updates

Pools are recalculated and assigned each year on November 1 based on the just-completed season's standings. The user is notified of their pool size at that time, well before the July 2 signing window opens. This gives the user time to plan their offseason knowing what pool they'll have.

## 7. Simulation Engine

### 7.1 Engine Philosophy

The simulation engine is the heart of the project. Its job: take two teams with rated players and produce game outcomes that aggregate to realistic season-long stats, while making different player archetypes meaningfully valuable.

The key tension: **making the engine reward classic baseball archetypes.** The default tendency of most baseball sims is to drift toward three-true-outcomes baseball because it's mathematically easier to model. We're deliberately pushing against that.

**Core engine principle:** Outcomes are determined by **matchup math** between hitter ratings and pitcher ratings, modified by park factors, defensive ratings, situational context, and random variance. The engine simulates **at-bat by at-bat,** then aggregates.

### 7.2 Target League Averages

The engine is tuned to produce these league averages (modeled on roughly 1998-2003 MLB):

- **Batting average:** .265
- **On-base percentage:** .340
- **Slugging percentage:** .425
- **OPS:** .765
- **Runs per game (per team):** 4.7
- **Strikeout rate:** 17% of PAs
- **Walk rate:** 9% of PAs
- **Home run rate:** 2.8% of PAs (~1.0 HR per game per team)
- **BABIP:** .300
- **Stolen base attempts:** ~140 per team per season (~0.9 per game)
- **SB success rate:** 72%
- **Sacrifice bunts:** ~30 per team per season
- **Sacrifice flies:** ~40 per team per season

**Pitching averages:**
- **ERA:** 4.20
- **WHIP:** 1.32
- **K/9:** 7.0
- **BB/9:** 3.3
- **HR/9:** 0.95
- **Complete games:** ~1-2 per pitcher per year (rare but exist)
- **Saves:** ~30-40 per closer per season

Calibration step: After engine implementation, simulate 10,000 games with average rosters and verify these averages emerge. Tune until they do.

**Measured calibration (0.7.0, tools/season_harness.js, full-season runs):** BA .263-.265 / OBP .335-.336 / SLG .419-.423 (league-wide including pitcher hitting; position players alone run ~.271/.344/.434), K% 16.6-17.0, BB% ~9.2, HR% 2.8-2.9, R/G 4.66-4.70, SB attempts ~150/team at 73-74% success, GIDP ~145/team, errors ~105/team.

**Note on ERA and WHIP targets.** The 4.20 ERA and 1.32 WHIP figures above are internally inconsistent with the batting targets: a .265/.340 league scoring 4.7 R/G with realistic unearned-run accounting (~6-8% of runs) produces ERA ≈ 4.4 and WHIP ≈ 1.44 — which is what real 1999-2001 MLB actually posted (2000: .270 BA, 4.77 ERA, 1.47 WHIP). The engine follows the batting targets and honest accounting; treat measured ERA ~4.4 / WHIP ~1.44 as correct rather than re-tuning toward 4.20/1.32.

### 7.3 At-Bat Resolution

Every at-bat is resolved through a sequence of probabilistic decisions:

**Step 1: Plate appearance outcome category roll.**

Determine whether the PA results in:
- Strikeout
- Walk
- Hit-by-pitch (rare, ~1% of PAs)
- Ball in play (the vast majority of PAs)

This roll uses:
- Hitter's contact rating (vs appropriate handedness)
- Hitter's discipline rating
- Pitcher's stuff rating (drives K probability)
- Pitcher's control rating (drives BB probability)
- Park factor adjustments (small)
- Situational modifiers (count, baserunners — minor effects)

**Step 2: If ball in play, determine batted ball type.**

- Groundball / Line drive / Fly ball / Popup

Driven by:
- Hitter tendencies (derived from ratings: high power → more flyballs, high contact → more line drives)
- Pitcher movement rating (high movement → more groundballs)
- Random variance

**Step 3: Determine batted ball outcome.**

For each batted ball type:

**Groundball:**
- Most likely outcomes: out, single
- Modified by: defender ratings, batter speed (infield hits), defensive positioning
- Park factor: modest impact

**Line drive:**
- Most likely outcomes: single, double, out
- Modified by: defender positioning, ratings, ball location
- Park factor: modest to moderate impact

**Fly ball:**
- Most likely outcomes: out, double, home run, triple (rare)
- Modified by: park HR factor (heavy impact), park doubles factor, OF defender ratings, batter power rating
- This is where park factors swing outcomes most

**Popup:**
- Almost always an out
- Very rarely drops in for a hit (defender error or wind)

**Step 4: Apply baserunning.**

If hit produced, determine runner advancement:
- Single: runners advance 1 base default; runner on 1st may go to 3rd based on speed and outfielder arm ratings; runner on 2nd may score based on speed
- Double: runners advance 2 bases default; runner on 1st may score based on speed
- Triple: all runners score
- HR: all runners score

Stolen base attempts resolved separately (see 7.5).

**Step 5: Update game state.**

Score, baserunners, outs, count reset.

### 7.4 Pitcher Stamina and Fatigue

Pitcher stamina uses the 20–80 scale (per 5.2) and should map to realistic pitcher roles, pitch-count expectations, and fatigue behavior. **Stamina is a soft usage guide, not a fixed innings cap.**

> **Phase note.** The current sim has a simplified stamina-vs-pitch-count rule. The full tiered model below is scheduled for Phase 3 (per 21.4), where it ships alongside bullpen role assignments — the tier names (LOOGY, swingman, long man) map directly onto the role labels in 7.8. Implementing the engine tiers without role controls would only deliver half the system.

#### 7.4.1 Stamina Tiers

The mapping below is the design contract: a pitcher generated at a given stamina grade should behave like the corresponding role in simulation. "Target" is the typical pitch-count window the engine aims for. "Ceiling" is the upper bound the effective pitch limit (7.4.3) can reach with bonuses applied.

**20–30 — Specialists / LOOGY-type arms**
- Target: 5–15 pitches
- Usage: 1–3 batters
- Hard cap around 20 pitches
- Almost never face the same hitter twice
- Rarely exceed 1 inning

**35–40 — Standard one-inning relievers**
- Target: 15–25 pitches
- Typical usage: 1 inning
- Ceiling around 30 pitches
- Can occasionally go 2 innings if very efficient
- Should never be used for 3 innings

**45 — Multi-inning relievers / bridge arms**
- Target: 25–45 pitches
- Typical usage: 2 innings
- Ceiling around 50 pitches
- Can reach 3 innings only if very efficient
- Should not become pseudo-starters

**50 — Swingmen / long relievers / spot starters**
- Target: 60–80 pitches
- Typical usage: 3–5 innings
- Ceiling around 90 pitches
- Can make spot starts and reach 5 innings if efficient
- Roughly the replacement-level starter / swingman baseline

**55–60 — Modern starting pitchers**
- Target: 85–100 pitches
- Typical usage: 5–6 innings
- Ceiling around 105 pitches
- Can reach 7 innings if efficient and effective
- Most normal starters live here

**65–70 — Workhorses**
- Target: 95–110 pitches
- Typical usage: 6–7 innings
- Ceiling around 115–120 pitches
- Can reach 8 innings with strong efficiency
- Complete games possible but uncommon

**75–80 — Elite workhorses / rare freaks**
- Target: 105–120 pitches
- Typical usage: 7–8 innings
- Ceiling around 125+ pitches
- Complete games and shutouts more possible, but still require efficiency and effectiveness
- These players should be rare

#### 7.4.2 Stamina Is Not Innings

Stamina should not directly equal innings.

**Bad model:**
- Stamina 60 always means 6 innings.

**Correct model:**
- Stamina 60 usually means 5–6 innings, sometimes 7 if efficient, sometimes less if ineffective.

The same starter facing the same lineup gets pulled at different points depending on how the outing has gone. A 60-stamina pitcher with 65 pitches through 5 efficient innings can earn the 7th. The same pitcher at 95 pitches through 4.2 innings of trouble is gone.

#### 7.4.3 Effective Pitch Limit

Each outing has a dynamic pull threshold rather than a static one:

```
Effective Pitch Limit
  = base stamina limit
  + efficiency bonus
  - trouble penalty
```

The base limit comes from the tier table above. Bonus and penalty apply small adjustments — typically ±5 to ±15 pitches — that let a hot pitcher stretch his outing or yank a struggling one early.

**Efficiency bonus examples:**
- Low pitches per inning
- Quick innings
- Low baserunner traffic
- Shutout or dominant outing

**Trouble penalty examples:**
- High walks
- High hits allowed
- Runs allowed
- Repeated hard contact (if/when tracked)
- Visible fatigue signs (declining velocity, etc.)

The effective limit is recomputed continuously through the outing — it isn't locked at first pitch. A 60-stamina starter who works through a clean first three frames might enter the 6th with an effective limit of 110+; the same pitcher who walked four in the first two innings is on a much shorter leash.

#### 7.4.4 Per-Pitch Stuff/Velocity/Control Decay

Beyond the pitch-count limit, the underlying ratings degrade through an outing:

- **High stamina (65+):** effective ratings hold through the target window, then decline mildly past the ceiling
- **Average stamina (50):** ratings hold through the target window, decline moderately past
- **Low stamina (35-):** ratings hold for the first few batters, decline rapidly thereafter

Each pitch past the stamina-driven hold threshold reduces effective velocity, control, and stuff by small increments. A low-stamina pitcher pushed to 40 pitches is throwing meaningfully worse than rated. This is what creates late-inning offensive surges and is one of the levers that makes bullpen management matter.

#### 7.4.5 Complete Games

Complete games should be rare and should require all of:

- High stamina (typically 65+, with 75+ much more likely)
- Low pitch count for the runs absorbed
- Strong performance (low BB, manageable hits)
- Close or meaningful game state (a blowout pulls the pitcher early to save bullets)
- No major fatigue warning (velocity holding, no late-inning trouble)

#### 7.4.6 Bullpen Balance

Starter stamina and pull logic directly control bullpen usage.

- If starters go too deep, the bullpen disappears.
- If starters are pulled too early, bullpen usage becomes chaotic.

Pitcher stamina tuning must be validated by checking full-season starter IP/start, reliever appearances, saves, and complete-game frequency together — not in isolation. Per-tier behaviour is the contract: a 35-stamina LOOGY pulling multi-inning bridge work is a tuning failure, even if league averages happen to look OK.

**Reliever rest (implemented, 0.7.0).** Between-game fatigue exists for relievers: an arm that has pitched three consecutive days is unavailable (except as a depleted-pen last resort), and an arm that worked yesterday is picked last within his role and pitches on a ~35% shorter leash. Appearance dates and consecutive-day counts are stamped on the player after each game.

**Starter rest (implemented, 0.15.3).** Starter selection walks the rotation from today's slot, but an arm only takes the ball on normal rest — 4+ full days since his last appearance, a standard 5-man turn. Before this, a hole in the rotation (IL stint, stale ref, shrunken 4-man rotation) funneled every extra turn to whoever was healthy — including consecutive days — producing 40-66-start seasons. Fixes: (1) when a rotation starter hits the IL, the pitcher called up covers his rotation slot directly, and the returning starter reclaims it on activation; (2) rotation slots vacated for good (trade, demotion, release) backfill from the roster instead of shrinking the rotation; (3) if no rotation arm is rested, a fresh non-rotation swingman makes a spot start (SP-primary first, never the closer); a rotation arm on short rest (3 days) is preferred over a full bullpen day, and a rest-free fallback keeps games simming. Measured post-fix: league max GS 33-34 with zero pitchers above 36 (pre-fix: max 66, with 23 arms over 36 on the same seed). The season harness hard-fails any franchise season containing a GS above 36.

#### 7.4.8 Pitcher Decisions (W / L / SV / HLD / BS)

Decisions follow the official scoring rules, simplified:

- **Win (9.17):** the pitcher of record — whoever was pitching for the winning team when it took the lead for the last time. A starter must complete 5 innings; otherwise the win goes to the winning team's most effective reliever (most outs recorded, fewest runs allowed as tiebreak).
- **Loss (9.18):** the pitcher responsible for the decisive go-ahead run (inherited runners charge the pitcher who put them on base).
- **Save (9.19):** the winning team's final pitcher, if he isn't the winning pitcher and either entered protecting a 1-3 run lead and recorded 1+ inning, or pitched 3+ innings with the lead. Final margin is not the test — a closer who enters +2 and wins 7-4 after his team tacks on still earns the save.
- **Hold / blown save:** entered protecting a 1-3 run lead; left with it intact and an out recorded → HLD (never for the W or SV pitcher); left with the lead gone → BS.

Measured: closers ~27-29 SV and ~2-3 W per season; relievers earn ~33% of wins — both in line with the classic era.

#### 7.4.7 Validation Targets

After a full-season simulation, the engine should produce:

- Average starter IP/start in the 5.5–6.5 range
- True workhorses can exceed 7 IP/start but are rare
- Relievers receive meaningful appearances (top setup arms ~60–75 G, long men ~30–45 G)
- Closers record saves at realistic rates (~25–40 per closer)
- Complete games exist but are uncommon
- No stamina tier consistently behaves outside its intended role

If any of these conditions fail, stamina ratings or pull thresholds need re-tuning before moving on.

### 7.5 Stolen Bases and Small Ball

Stolen base attempts are resolved per-baserunner per-at-bat:

**Attempt probability** based on:
- Runner's speed rating (high speed → more attempts)
- Game situation (close game → more attempts; blowout → fewer)
- Manager's small-ball tendency (see manager archetypes)
- Catcher's arm rating (deters attempts)
- Pitcher's hold-runners ability (bundled into a small modifier)

**Success probability** based on:
- Runner speed
- Catcher arm
- Pitcher's hold ability
- Random variance

This is a key engine choice: by making SB attempts and success driven by ratings rather than fixed rates, the engine naturally produces the stolen base diversity of the classic era. Fast players will accumulate 40-60 SBs per season, while slow players rarely attempt.

**Sacrifice bunts** are called by the AI manager based on:
- Manager's small-ball tendency
- Game situation (late innings, close game, runners on, low outs)
- Hitter's bunting rating
- Hitter's overall offensive value (you don't bunt with your stars)

A small-ball manager calling for a bunt in the 8th inning of a tie game with a runner on 1st and 0 outs, executed by a high-bunting role player, succeeds 80%+ of the time. This actively shapes games.

**Hit-and-run** can be called in similar situations. Increases contact rate slightly, advances runners, but increases double-play risk if contact fails.

### 7.6 Defense and Errors

Defense affects:
- **Range:** Higher-rated defenders convert more balls in play into outs (within their range zones)
- **Errors:** Lower-rated defenders make more errors (errors of throwing, fielding, judgment)
- **Double plays:** Higher-rated middle infielders turn double plays at higher rates
- **Outfield assists:** Higher arm ratings throw out more runners
- **Caught stealing:** Catcher arm + accuracy drives CS%

The engine tracks both fielding chances and conversion rates by position. Errors are randomly distributed within fielding chances, weighted by the fielder's rating.

**Implementation note (0.7.0 — team-level approximation).** Per-fielder chance attribution doesn't exist yet; the engine uses the lineup's average defense rating:

- **Range:** BIP hit probabilities scale ± a few percent with team defense.
- **Errors:** ~3% of would-be outs become reached-on-error (batter safe, runners advance one base, AB but no hit, no out), scaled by team defense; ~105 errors per team per season measured. Line scores show R/H/E.
- **Unearned runs:** a run is unearned if the scoring runner reached on an error, scored on the error play, or scored after a two-out error extended the inning (~6% of runs; full official earned-run reconstruction is out of scope).
- **Double plays:** GIDP requires a ground ball with a runner on first and fewer than two outs; conversion scales with team defense (~145 GIDP/team measured).
- **Caught stealing:** catcher arm drives CS% (already per-player).

Per-position attribution (individual E totals, fielding percentage) ships with position-specific defense in a later phase.

### 7.7 Park Factor Application

Park factors apply at outcome resolution. A 110 HR factor multiplies the base HR probability of any flyball by 1.10 (capped to prevent absurd outcomes). A 95 hits factor reduces BABIP slightly at that park.

Park factors apply to the **home park.** A team's batting averages will differ between home and road games, as in real MLB. Over 81 home games and 81 road games, the park factor's effect on cumulative stats works out to roughly half its raw value (since half the games are road).

### 7.8 Manager Tendencies in Simulation

Each manager has tendency parameters that affect AI decision-making during games:

- **Lineup construction tendency:** Old-school (high-OBP guys at top, sluggers in middle, weak hitters bottom) vs. modern (high-OPS at the top of the order). Affects lineup AI builds.
- **Bullpen usage:** When to pull starters, leverage-based vs. innings-based reliever usage, closer usage flexibility
- **Small-ball aggressiveness:** Bunts, hit-and-runs, SB attempts
- **Pinch-hit/pinch-run usage:** How often situational subs are made
- **Defensive replacement:** Whether to swap in glove-only players in late innings

These translate to engine modifiers during simulation, making manager hires meaningfully different.

### 7.9 Simulation Granularity Options

The engine supports multiple simulation granularities depending on user request:

**Day:** Simulates all games on the current day in detail, generating full box scores. Default for "advance day."

**Week:** Simulates a week's worth of days. Box scores generated but only most recent kept in memory; aggregate stats updated.

**Month:** Simulates a month. Day-by-day, but UI only shows summary at end.

**To next event:** Sims forward until reaching the next event (next series for user's team, next decision point, next milestone like trade deadline or All-Star break).

In all cases, every simulated game produces a full box score and an AB-by-AB game log. Both the user's own games and other teams' games are retained at this fidelity. Pitch-by-pitch detail is **not** generated — the AB-by-AB log is the lowest granularity (per 20.6.4). The detailed game logs are retained only for the current season and cleared during rollover (per 8.7.1) to bound save size.

### 7.10 Engine Tuning Process

After implementation, the engine goes through calibration:

1. **Run 10,000 games** between two perfectly average teams (all 50-rated players)
2. **Compare output to target league averages**
3. **Adjust outcome probability formulas** to bring averages in line
4. **Re-run** until averages stabilize

Then:

5. **Run 10,000 games** between teams with varied talent levels
6. **Verify rating differentials produce appropriate stat differentials**
7. **A 70-rated power hitter should produce ~25-30 HRs over 600 PAs in average park**
8. **A 70-rated control pitcher should walk ~1.5 per 9 IP**
9. **Adjust until rating-to-stat translation feels right**

Then:

10. **Run a full season simulation** with a generated league
11. **Verify** that league leaders, distributions, and outliers feel correct
12. **Verify** classic archetypes produce expected stat lines (a contact-and-speed hitter accumulates SBs, a stuff-and-control pitcher gets Ks, etc.)

Tuning is iterative and ongoing. The engine will likely require adjustment throughout the build process as edge cases emerge.

## 8. Stats System

### 8.1 Philosophy

Stats serve three purposes in the game: (1) they tell the user what's happening, (2) they feed AI evaluation logic for trades and free agency, and (3) they feed award voting. The stats system needs to track enough to support all three uses without bloating saves or overwhelming the user with information.

The project commitment is **traditional counting stats with basic advanced stats.** No WAR, FIP, wRC+, xFIP, BABIP-luck-adjusted-anything at launch. Those can be added later as derived stats if desired. The classic gameplay pillar extends here too — the era we're modeling didn't have a fan base looking at WAR, they looked at HRs, RBIs, batting average, ERA, and wins.

### 8.2 Hitter Stats Tracked

**Counting stats:**
- Games played (G)
- Plate appearances (PA)
- At-bats (AB)
- Runs (R)
- Hits (H)
- Doubles (2B)
- Triples (3B)
- Home runs (HR)
- RBI
- Stolen bases (SB)
- Caught stealing (CS)
- Walks (BB)
- Intentional walks (IBB)
- Strikeouts (SO)
- Hit by pitch (HBP)
- Sacrifice hits (SH, bunts)
- Sacrifice flies (SF)
- Total bases (TB)
- Grounded into double play (GIDP)

**Rate stats (calculated, not stored):**
- Batting average (AVG)
- On-base percentage (OBP)
- Slugging percentage (SLG)
- OPS
- Stolen base percentage (SB%)

**Splits tracked:**
- vs LHP / vs RHP (for users to evaluate platoon use)
- Home / Road
- Pre-All-Star / Post-All-Star (just for narrative — "first half / second half")

That's it for splits initially. No monthly splits, no count-by-count, no situational (RISP, men on, late and close, etc.) at launch. Those can be added later. Splits already balloon save size and aren't worth it for a personal sim.

### 8.3 Pitcher Stats Tracked

**Counting stats:**
- Games (G)
- Games started (GS)
- Complete games (CG)
- Shutouts (ShO)
- Wins (W)
- Losses (L)
- Saves (SV)
- Holds (HLD)
- Blown saves (BS)
- Innings pitched (IP)
- Hits allowed (H)
- Runs allowed (R)
- Earned runs (ER)
- Home runs allowed (HR)
- Walks (BB)
- Intentional walks (IBB)
- Strikeouts (SO)
- Hit batters (HBP)
- Wild pitches (WP)
- Balks (BK)

**Rate stats:**
- ERA
- WHIP
- K/9
- BB/9
- HR/9
- K/BB ratio
- Opponent batting average (BAA)

**Splits:**
- vs LHB / vs RHB
- Home / Road
- Pre/Post-All-Star

### 8.4 Team Stats Tracked

**Hitting team totals** — sum of all hitter stats, plus team OBP, SLG, OPS

**Pitching team totals** — sum of all pitcher stats, plus team ERA, WHIP

**Fielding team stats:**
- Total errors
- Fielding percentage
- Double plays turned
- Caught stealing percentage (defensive)

**Standings:**
- Wins / Losses
- Win percentage
- Games behind division leader
- Run differential
- Home/Road records
- Last 10 games
- Streak (W3, L2, etc.)

### 8.5 League Leaders and Awards Eligibility

The stats system computes league leaders for display purposes:

**Hitting leaders (top 10 lists):**
- AVG (qualified: 3.1 PA per team game)
- HR
- RBI
- SB
- OPS (qualified)
- Hits

**Pitching leaders:**
- W
- ERA (qualified: 1.0 IP per team game)
- K
- WHIP (qualified)
- Saves
- Holds

Leader pages are accessible from a league nav menu. Mobile-first design: vertical scroll, top-10 cards, tap a player to see full stats.

### 8.6 Career and Historical Stats

Career stats are aggregated annually. Each player's profile shows:

- Year-by-year breakdown (table of seasons with all key counting and rate stats)
- Career totals (sum of all years)
- Career bests (single-season high in each category)
- Postseason career stats (separate from regular season)
- All-Star selections, awards, championships, milestones

**Milestones tracked:**

For hitters: 100 HR, 200 HR, 300 HR, 400 HR, 500 HR, 600 HR, 700 HR. 1000 H, 2000 H, 3000 H, 4000 H. 1000 R, 1500 R, 2000 R. 1000 RBI, 1500 RBI, 2000 RBI. 300 SB, 500 SB.

For pitchers: 100 W, 200 W, 300 W. 1000 K, 2000 K, 3000 K, 4000 K. 100 SV, 200 SV, 400 SV.

When a player passes a milestone, a brief news event surfaces. Adds narrative to long careers.

### 8.7 Stats Storage Strategy

Stats are stored per player per year as objects under `player.stats[year]`. Each year has sub-objects for `mlb`, `minors` (with sub-keys per level), and `postseason`.

Storage minimization:
- Round rate stats to 3 decimal places (.275 not .27543)
- Don't store derived stats (calculate at display time)
- After 10 years, aggregate older minor-league stat lines to summary form
- Don't store per-game player stat lines historically — only season totals

Total season-stat storage per player per year: roughly 200 bytes. Across 2,250 players × 1 year = ~450KB. After 10 years: ~4.5MB just for current player season-by-season stats. Plus retired player career stats add another 1-2MB depending on length.

With IndexedDB storage (0.6.0) this is comfortably inside quota; the budget now protects export-file size and load time. If saves get tight, we can compress retired player stats further.

#### 8.7.1 AB-by-AB Game Log Retention

Detailed AB-by-AB game logs (per 20.6.4) are stored **only for the current season** and **cleared during season rollover** to avoid save bloat.

What's preserved across seasons:
- Final scores
- Team records (W/L, RS, RA)
- Player season totals (every counting and rate stat)
- Team season totals (offense, pitching, fielding once tracked)
- League history summaries (standings, awards, postseason results, leaders)

What's discarded at season rollover:
- AB-by-AB game logs
- Per-game player stat lines (already not retained per the rule above)
- Per-inning line scores (kept only as long as the parent game's log is kept)

**Storage envelope (measured).** A typical season has ~2,430 games × ~75 PA per game = ~180,000 AB log entries. Implemented as compact arrays on `game.result.gameLog`, a full season of logs measured ~6.6 MB, pushing the total save to ~11 MB. (Storage moved to IndexedDB in 0.6.0 so this no longer risks blowing a quota, but the retention policy below stays — it keeps export files and load times reasonable.)

**In-season retention guard.** To stay inside the bible 2.3 save budget, AB logs follow a two-tier in-season retention policy, applied daily by the sim loop:

- **User-team games:** AB log retained for the entire season (all 162 games).
- **AI-vs-AI games:** AB log retained for a rolling 14-day window, then pruned.
- **Box scores and line scores:** retained for the entire season for *every* game — the Game Detail view always renders complete box scores; only the at-bat narrative is pruned for older AI games (the UI shows a "not retained" note).

Measured post-season save with the guard: ~4.9 MB. Season rollover (Phase 15) still clears all remaining logs from the closing year.

Historical Game Detail views still work after rollover — the box score and team totals are reconstructed from the season-totals data. The AB-by-AB section of the Game Detail view shows a "Detailed log not retained for prior seasons" note when the log has been pruned.

### 8.8 Stat Display Principles

Mobile-first display rules:

- **Default view: simplified.** Show the 6-8 most important stats by default. Full stat lines available via "expand" tap.
- **Vertical card layout for individual players.** Avoid horizontal stat tables that require side-scrolling.
- **Tabular for league leaders.** Top-10 tables are vertically scrollable cards, one player per row.
- **Color and bold for emphasis.** League-leading stats highlighted; injured player stats grayed out.

---

## 9. Progression System

### 9.1 Annual Progression Cycle

Player progression runs once per year, between seasons (during November-December offseason simulation). For each player:

1. **Determine progression direction** based on archetype, age, and curve params
2. **Calculate progression amount** for each rating
3. **Apply modifiers** (coaching, level appropriateness, work ethic, injuries)
4. **Apply random variance** (the volatility parameter)
5. **Apply ceiling and floor enforcement** (no rating goes above ceiling or below floor)
6. **Update displayed grade** if internal value crossed a 5-point threshold

### 9.2 Archetype Curves Formal Spec

Each archetype has a curve defined by parameters:

```
{
  peakAge: <number>,           // Age at which player hits peak
  riseRate: <0.0-1.0>,         // % of (ceiling - current) gained per year pre-peak
  declineRate: <0.0-1.0>,      // % of (current - floor) lost per year post-peak
  plateauWidth: <number>,      // Years around peak where rating holds
  volatility: <0.0-1.0>,       // Year-over-year random variance multiplier
  breakoutAge: <number|null>,  // For late bloomers, when the spike happens
  reversionLikelihood: <0.0-1.0> // For one-year wonders, probability of reversion
}
```

**Sample params per archetype:**

**Traditional Curve (hitter):**
- peakAge: 27-29 (random within range)
- riseRate: 0.25 (gains 25% of remaining ceiling gap per year)
- declineRate: 0.15
- plateauWidth: 3 years
- volatility: 0.10 (low year-to-year noise)
- breakoutAge: null
- reversionLikelihood: 0

**Late Bloomer (hitter):**
- peakAge: 30-33
- riseRate: 0.10 pre-breakout (slow growth)
- breakoutAge: 26-28 (sudden jump of 30-50% of ceiling gap)
- declineRate: 0.20 (sharper decline post-peak)
- plateauWidth: 2 years
- volatility: 0.15

**Early Peak (hitter):**
- peakAge: 23-25
- riseRate: 0.40 (fast development)
- declineRate: 0.18
- plateauWidth: 2 years
- volatility: 0.15

**One-Year Wonder (hitter):**
- peakAge: 24-26
- riseRate: 0.30
- spikeYear: random year in range, ratings briefly jump 20-30% above expected curve
- reversionLikelihood: 0.85 (strongly reverts after spike)
- volatility: 0.30 (high noise, hard to predict)

**Steady Decliner (hitter):**
- peakAge: 22-24
- riseRate: 0.45 (very fast development; arrives nearly polished)
- declineRate: 0.10 (slow decline)
- plateauWidth: 4 years
- volatility: 0.08 (low variance, predictable)

**Quad-A (hitter):**
- peakAge: 25-27
- ceiling capped at MLB-average regardless of nominal ceiling rating
- riseRate: 0.30
- declineRate: 0.20
- volatility: 0.15

**Slow Burn (hitter):**
- peakAge: 30-32
- riseRate: 0.15
- declineRate: 0.10
- plateauWidth: 3 years
- volatility: 0.08

**Volatile (hitter):**
- peakAge: 27-29
- riseRate: 0.25 (average) but with very high volatility
- volatility: 0.40 (huge year-to-year swings)

Pitcher archetypes follow similar parameter structures with role-appropriate adjustments.

### 9.3 Modifiers

The base curve produces a baseline expected change. Modifiers adjust it:

**Level appropriateness:**
- Player at appropriate level for their development stage: +0% (no modifier)
- Player promoted too aggressively (multiple levels above readiness): -15% to progression for that year, -2 to ceiling if sustained
- Player held back too long (capable of higher level for >2 years): -10% to progression, -2 to ceiling if sustained for years

The "appropriate level" is determined by the player's hidden current rating. Major-league-ready talent (current ratings averaging 50+) should be in MLB or AAA. AA-level talent should be at AA. And so on. Mismanagement applies penalties.

**Coaching:**
- Each major league team has a hitting coach and a pitching coach with development modifiers (+5% to +20% for elite coaches, -5% for poor coaches)
- Modifier applies to all hitters or pitchers in the organization (including minors)
- Manager's own modifier (if any) stacks small bonuses on top
- Coaches matter most for prospects in development, less for established veterans

**Work ethic:**
- High work ethic (8-10): +5% to +15% progression bonus
- Average (4-7): no modifier
- Low work ethic (1-3): -10% to -20% progression penalty (these are players who don't reach ceiling)

**Injury:**
- Major injury during a year: -10% to -25% progression that year (depending on severity)
- Some injuries permanently reduce ceiling (see Injury System)

**Age effects:**
- Below archetype's peak age: progression generally positive
- At peak age (within plateau width): progression near zero, small variance only
- Past peak age: progression negative (decline)
- Age 35+: decline accelerates 1.5x; injuries become more frequent

### 9.4 Volatility and Random Variance

After applying base curve and modifiers, a random component is added:

```
final_change = base_change + (random(-1, 1) × volatility × max_swing)
```

Where `max_swing` is calibrated so a high-volatility player can swing ±5 rating points in a year, while a low-volatility player typically swings ±1-2 points.

This creates the year-to-year variance that makes player evaluation interesting. Sometimes a guy just has a down year for no clear reason, then bounces back. Sometimes a 27-year-old has his "career year" because the dice rolled hot.

### 9.5 Ceiling Adjustments Over Career

Ceiling can be adjusted (always downward) by:

- **Major injuries:** Reduce ceiling on relevant ratings by 3-8 points per major injury
- **Repeated injuries:** Compound effect, larger reductions
- **Sustained mismanagement:** -2 ceiling per year of inappropriate level for >2 years
- **Burnout (rare event):** -5 ceiling across ratings (more in injury system)

Ceiling cannot increase. Once you've damaged a player's ceiling, that potential is gone.

### 9.6 Retirement Logic

Players retire based on a combination of factors:

- **Age:** Players rarely play past 40; many retire at 35-37 once decline starts
- **Performance:** Sub-replacement-level performance triggers consideration
- **Ego/legacy:** Stars play one more year for milestones, championships, or contracts
- **Injury:** Major injury at age 33+ often triggers retirement
- **Contract:** Players unsigned mid-FA window may retire rather than continue

The engine rolls retirement probability each offseason for players age 33+. Probability climbs steeply by age 38. Most players are retired by 40; a few stars hang on through 41-42.

Retirement is a one-way state. Retired players are eligible for Hall of Fame after 5 years.

At retirement time, roll and stamp the "open to coaching" flag (per 17.9) so retirees can enter the coach/manager pipeline when the staffing system is live.

---

## 10. Injury System

### 10.1 Injury Roll Frequency

Injury rolls happen throughout the season at multiple checkpoints:

- **Per game:** Each active player has a small per-game roll for injury (most rolls produce nothing)
- **Per pitching appearance:** Pitchers have additional rolls tied to workload
- **High-fatigue scenarios:** Pitchers throwing heavy pitch counts or working back-to-back days have elevated risk
- **Off-day events:** Rare freak injuries (slipped in shower, hurt at home) can happen on off-days

Base injury rates calibrated to produce realistic IL usage:
- League-wide: ~15-18 active IL stints per team per season
- A typical team has 3-5 players on the IL at any given time during the season
- About 25-35% of pitchers will have some IL stint in a given season
- About 15-20% of position players will have some IL stint

These rates are tunable in the engine constants.

### 10.2 Injury Proneness Modifier

Each player's injury proneness rating (1-10) modifies their roll:

- 1: 0.5x base injury rate (very durable)
- 5: 1.0x base rate
- 10: 2.5x base rate (chronic injury concerns)

This makes durability a real attribute. A player with high overall ratings but injury proneness 9 is a high-risk, high-reward roster piece.

### 10.3 Injury Severity Tiers

When an injury hits, severity is rolled:

**Day-to-day (50% of injuries):** 1-3 day absence. Player listed as questionable but not on IL. No roster move needed. Minor strains, bruises, fatigue.

**10-day IL (22%):** 10-15 days out. Player goes on 10-day IL; team activates a 40-man player to fill the spot. Mild strains, low-grade sprains, blister issues for pitchers.

**15-day IL (8% — pitcher-specific tier):** Pitcher version of short IL. Common for arm fatigue, blisters, minor inflammation.

**Multi-week (8%):** 25-45 days out on the 10-day IL — the 3-6 week class (grade-2 strains, minor fractures, moderate sprains) that's the most common serious-injury class in real baseball. Added in 0.7.0; earlier drafts had no severity between 21 and 60 days.

**60-day IL (9%):** Two-month-plus absence. Significant injury — moderate strains, fractures, surgeries-with-recovery. Requires 40-man roster move (player removed from 40-man during IL stint).

**Season-ending (3%):** Player out for the year. Major surgery, ACL, Tommy John, severe fractures. Player on 60-day IL but won't return this season.

**Career-altering (very rare, ~0.5% of severe injuries):** A sub-tier of season-ending where the player suffers permanent ceiling reduction. Tommy John recovery cuts pitcher velocity ceiling by 5. Multiple knee surgeries cap speed. These are the gut-punch injuries that change a player's trajectory.

### 10.4 Injury Types and Specifics

A small set of injury type categories drives narrative texture:

**Hitter injuries:**
- Hamstring strain
- Quad strain
- Oblique strain
- Wrist injury (affects power most)
- Shoulder issue (affects throwing/power)
- Concussion
- Knee injury (affects speed and defense most)
- Back injury
- Hand/finger injury (affects contact)
- Hit by pitch (immediate; severity rolled)

**Pitcher injuries:**
- Shoulder inflammation
- Elbow inflammation (warning sign for UCL)
- UCL tear (Tommy John surgery — typically 14-18 months out, ceiling reduction)
- Forearm strain
- Lat strain
- Oblique strain
- Blister
- Back injury
- Foreign substance suspension (rare event, narrative only)

The specific injury name is shown to the user with severity. Some injury types correlate with specific severity tiers (UCL tear is always season-ending+; blister is always day-to-day or short IL).

### 10.5 Recovery and Return

Injured players are unavailable for the full duration of their IL stint. Day-to-day players miss 1-3 games (engine treats them as bench-ineligible). IL players require activation when their stint ends.

The user (or AI for non-user teams) decides how to fill the roster spot during the IL period:
- Promote a minor leaguer (most common)
- Sign a free agent (rare, if FA pool has someone useful)
- Play short-handed (legal but unwise)

When the IL stint ends, the user must activate the player (or DFA them, but that's rare). Activation requires removing someone from the active roster.

**Rehab assignments** for major injuries: A player coming off a long IL stint may be sent to AAA on a rehab assignment for 5-15 games before activation. This is automatic and adds realism.

**Recovery clocks and the offseason (Phase 15 requirement).** Injury recovery is implemented as a per-simulated-day countdown (`ilStatus.daysRemaining` / `dayToDayDaysRemaining`), and the sim only advances ~185 days per year (Opening Day through late September). Long injuries — Tommy John at 365-540 days — must heal on *calendar* time, not sim-day time, or a TJ takes 2-3 in-game seasons instead of 14-18 months. When season rollover (Phase 15, per 21.16) jumps the calendar from season end to the next Opening Day, it MUST fast-forward every player's recovery clock by the number of calendar days skipped. The same applies to any future date-driven countdown (suspensions, rehab windows).

### 10.6 Career-Altering Injury Narrative

When a career-altering injury hits (rare event), the user sees a clear notification:
- The injury type and severity
- The expected recovery timeline
- The ceiling reduction it will cause (e.g., "Pitcher's velocity ceiling reduced by 5 points")
- Implications for the player's career arc

These are designed to feel like real moments. A 24-year-old ace blowing out his elbow and never throwing 95 again is the kind of narrative event sims often miss. We're explicitly modeling it.

### 10.7 Injury System Tuning Goals

After implementation, the injury system is calibrated against these targets:

- About 20% of pitchers should have at least one IL stint in a given year
- About 15% of position players similarly
- Tommy John surgeries: ~15-25 per season league-wide
- Career-altering injuries: ~3-8 per season league-wide
- Total IL stints league-wide: ~150-200 per season

Calibration happens after engine implementation by simulating multi-season runs and comparing output to targets.

**Note on the stint-count target.** Earlier drafts of this section listed ~500-550 stints, but that figure can't reconcile with the percentage targets above — at ~130 players going on IL across the league, ~500 stints would require an average of nearly four IL stints per IL'd player per year, which doesn't happen even in injury-plagued MLB seasons. The percentage targets (which describe what the user actually experiences) are authoritative; the stint count was revised to ~150-200 to match (≈1.2 stints per IL'd player). MLB has run anywhere from 700+ stints in recent years down to a few hundred in earlier eras, so this number stays a soft guidepost.

**Note on career-altering rate (10.3).** §10.3 describes career-altering events as "~0.5% of severe injuries" but that produces well under 1 per season at the calibrated stint volume. To hit the 3-8 target above, the implementation uses ~10% of severe stints as the career-altering coefficient (measured: 4-7 per season). Treat the 0.5% figure in 10.3 as the discarded simpler version.

**Note on Tommy John share.** UCL tears are down-weighted in the pitcher injury-type catalog (weight 0.75 vs 1.0 for other types). At a uniform share, every-UCL-is-season-ending made TJ counts run above the 15-25 target; the calibrated weight lands 14-20 per season.

**Measured calibration (0.7.0, tools/season_harness.js):** ~155-170 IL stints per season, TJ 14-17, career-altering 4-7, 21% of pitchers and ~17% of position players with an IL stint — all within the targets above.

### 10.8 Position-Player Fatigue and Stamina

Position-player fatigue is a Phase 4 system, not a Phase 2 sim/stat concern. Pitcher fatigue (per 7.4) is in the engine already; this section covers the position-player side and is intentionally deferred until injuries land so the two systems can share roll/risk plumbing.

**Mechanics:**

- Starting a game adds fatigue.
- Bench appearances add less fatigue.
- Off days and rest days recover fatigue.
- Catchers accumulate fatigue faster than other position players.
- Older players recover more slowly.
- High injury-proneness players become riskier when fatigued.
- Moderate fatigue applies small performance penalties.
- High fatigue meaningfully increases injury risk.
- Very high fatigue should surface a rest recommendation.

**Design intent:**

Fatigue should create natural rest pressure, bench usage, and injury risk without turning the game into daily micromanagement. The user should feel the consequences of riding a starter every day — not be forced to manage a fatigue meter.

**Example UI language:**

> "Vance Shepherd is fatigued. Suggested rest: 1 day."

Surfaced as a soft notification on the dashboard or roster screen — never a blocking modal. Users who ignore it accept the elevated injury risk.

**Auto-rest (implemented, 0.7.0).** The engine gives rest days automatically, for every team including the user's: a starter whose fatigue crosses the critical threshold sits for the day, replaced by the best fresh bench bat eligible for his slot, and returns to his lineup spot as soon as he's recovered below the threshold. If the whole bench is also gassed (or nobody covers the position), the regular plays tired. This is what makes the "no micromanagement" promise real — before auto-rest existed, static lineups played all 162 games, and every starting catcher and 33+ regular saturated at maximum fatigue by June (measured median season-peak of 97-98/100; with auto-rest it's ~91, brushing the threshold then resting). The soft notification still fires so the user understands why their catcher sat.

**Scheduled rest (0.13.2).** Critical-only rest had a visible flaw:
non-catchers never reach the critical threshold (median season peak
~62), so everybody but the catcher quietly played 162. Managers now
give routine maintenance days long before fatigue turns critical —
per-game rest odds scale with the fatigue band (1% fresh → 6% moderate
→ 20% high), age (1.5x at 32+, 2x at 35+), catching (1.4x), and the
manager's bench-usage tendency (defSub, Pillar 4: some skippers ride
their regulars harder). Scheduled rest only happens when a fresh,
position-eligible bench bat can cover the slot — with one exception:
consecutive-start streaks force a breaker at 15+ (12%/game) and 25+
(40%/game) even if the cover is out-of-position, so scarce-position
regulars (SS/CF) don't iron-man by default. Nobody rests in October.
Measured: lineup regulars median 151-152 GP (catchers 143-144), zero
160+ GP players league-wide (was ~45), R/G calibration unchanged, and
bench bats now get real starts. `p.consecStarts` resets each spring.

**Iron men (0.14.0).** A hidden durability grade (1-10, generated;
older saves derive it from injury proneness) scales fatigue recovery
(±15%) and scheduled-rest odds (durable bodies need fewer days). The
rare combination — grade-10 durability with sturdy health — is the
Iron Man: managers ride him every day, he skips scheduled rest and
streak-breaking entirely, and only critical fatigue (which his
recovery bonus makes rare) sits him. Measured: ~9 iron-man starters
league-wide, ~8 of whom play 160+ — the 162-game season is a rare,
name-worthy feat again instead of the roster default. The trait shows
on the player card ("🛡 Iron Man — plays every day").

**Phase dependency:**

- **Phase 2:** pitcher fatigue and stat correctness only (already in)
- **Phase 3:** roster, lineup, bench, rotation, and bullpen controls (the user must be able to bench a fatigued player before fatigue can drive decisions)
- **Phase 4:** injuries plus position-player fatigue/stamina

**Non-goal:**

Do not create OOTP-style fatigue micromanagement. The game should handle routine fatigue in the background and only surface meaningful rest/injury-risk decisions.



## 11. Roster Management

### 11.1 Roster Structure

Each MLB organization has a layered roster system:

**26-man active roster:** The players currently eligible to play in MLB games. From Opening Day through August 31. On September 1, expands to **28-man active roster** for the final month of the regular season.

**40-man roster:** All players signed to major-league contracts. Includes the 26-man active plus 14 additional players (typically high-end prospects and players on the IL whose stints don't require 60-day removal). Players on the 40-man are protected from the Rule 5 draft and have major-league contractual status.

**Minor league roster:** Up to 30 players in the user's minor league system across all levels (AAA / AA / A+ / A / Rookie). Players on the 40-man can also be optioned to the minors and counted on the minor league roster simultaneously (they occupy a 40-man spot but play in the minors).

**60-day IL:** A player on the 60-day IL is removed from the 40-man roster temporarily. This frees up a 40-man spot but the player remains property of the team. When the player returns, they need a 40-man spot to be reactivated.

### 11.2 Roster Composition Requirements

The 26-man active roster has structural constraints:

- **Pitchers:** 12-13 typical (5 SP + 7-8 RP/CP). Engine enforces minimum 11 and maximum 14 pitchers.
- **Catchers:** Minimum 2 (no team plays without a backup catcher).
- **Position players:** 11-13 (depending on pitcher count). Must include enough coverage for all 8 positions.

The user can configure their roster within these constraints. Common configurations:
- **5 SP + 8 RP + 2 C + 11 PP** (the standard 13-pitcher roster)
- **5 SP + 7 RP + 2 C + 12 PP** (the 12-pitcher roster, more position player flexibility)

### 11.3 Position Eligibility on Roster

Position eligibility was defined in section 5.5. Implications for roster management:

- A player's primary position contributes to roster coverage
- Secondary positions provide flex coverage
- Defensive penalties apply when playing out of position
- The user's lineup AI will use secondary positions for matchup advantages and defensive replacements

Roster composition needs to cover all 8 positions across primary + secondary. A team with 4 outfielders and 0 of them listing CF as primary or secondary is malformed. The roster screen warns about coverage gaps.

### 11.4 Options and Service Time

**Options** track how many times a player on the 40-man roster can be sent to the minors and recalled within a season:

- Each player has 3 option years total (lifetime)
- Within an option year, a player can be sent down and recalled multiple times
- An option year is "used" if the player accumulates 20+ days in the minors during that year
- A player out of options must clear waivers to be sent down (in this sim: rare, treated as a scenario)

**Service time** is tracked in years and days. Major service time milestones:

- **Less than 1 year:** Pre-rookie, 26-man minimum salary
- **3 years:** Eligible for arbitration (in real MLB; sim simplification: handled in contract section)
- **6 years:** Eligible for free agency
- **10 years:** Eligible for "10-and-5" rights (player can veto trades; sim simplification: not modeled initially)

Service time accumulates only for days on the 26-man active roster (or IL while on active roster, or minor league rehab assignments).

**Sim simplifications:**
- **Arbitration:** Years 3-5 of service handled as automatic salary increases based on prior performance (no formal arbitration hearing process modeled). User receives notification of arbitration salary; can offer extension or accept.
- **Super-2 status:** Not modeled.
- **Pre-arb manipulation:** Not user-actionable, but cheap-owner AI teams will hold prospects in AAA into late April to delay service-time clocks.

### 11.5 Roster Moves

Standard roster moves the user can make:

**Promote from minors:** Move a minor leaguer to the 26-man (requires 40-man spot — if they're not on 40-man, must add them, which requires removing someone).

**Option to minors:** Send a 40-man-rostered player to the minors. Requires options remaining.

**Designate for assignment (DFA):** Remove a player from the 40-man. Player has a 7-day window in which they may be claimed off waivers, traded, or returned to the minors via outright assignment (if they accept).

**Place on IL:** Move an injured player to 10-day, 15-day (pitcher only), or 60-day IL. 60-day IL removes from 40-man.

**Activate from IL:** Return an IL player to active roster. Requires roster spot.

**Trade:** Send player(s) to another team in exchange for player(s) and/or cash. Trade mechanics covered in section 15.

**Sign:** Add a free agent to the roster. Requires open 40-man spot if signed to major-league deal; can be signed to minor-league deal if AAA roster has space.

**Release:** Cut a player. Team is responsible for remaining contract value (luxury for big-market, painful for small-market). Released player becomes free agent immediately.

### 11.6 Daily Roster Decisions

During the season, roster decisions surface daily as needed:

- **Injury occurs:** Pause sim, prompt user to make a corresponding roster move (call up replacement or play short)
- **IL stint ends:** Prompt user to activate the player, requiring a corresponding move
- **Promotion candidate emerges:** Notification (not pause) when a minor leaguer is performing well enough to merit MLB consideration
- **Slumping player:** No automatic prompt; user can demote at will
- **Waiver claim opportunity:** When another team DFAs a relevant player, notification

The user can also proactively manage rosters at any time through the roster screen — even when nothing is forcing a decision.

### 11.7 Lineup and Pitching Decisions

Within an active roster, the user controls:

**Lineup construction:** The user sets the batting order against RHP and LHP separately (creating natural platoon usage). The AI manager fills in lineups according to user preferences but the user can override.

**Starting rotation:** User sets the 5-man rotation order. Days off naturally rotate the order. User can move pitchers in and out of rotation as needed.

**Bullpen roles:** User assigns roles — closer, setup, middle relief, long relief, lefty specialist, mop-up. Roles guide AI manager bullpen usage but aren't strict; manager will leverage based on situations.

**Defensive alignment:** Default lineup positions; user can specify backups by position.

**Manager autonomy:** The hired manager has tendencies that affect in-game decisions (when to pull starters, when to bunt, when to attempt SBs). User-set roles and lineup are inputs the manager respects but the manager makes individual game decisions.

### 11.8 Spring Training (Abstracted)

Spring training runs February-March in the in-game calendar but is not deeply interactive:

- **Position battles** are resolved abstractly. If two players are competing for a roster spot, the engine evaluates their ratings and recent performance and assigns the winner automatically (with notification to user). User can override.
- **Injury risks** surface during ST as low-probability events. ST injuries usually mean delayed Opening Day for the affected player.
- **Minor league assignments** are confirmed during ST. Each prospect's level for the season is set automatically based on their progression and organizational depth, with user override available.

Spring training provides a brief decision phase before Opening Day but doesn't require deep engagement.

> **Status (0.18.0) — shipped, abstracted per this section.** Camp runs
> inside the Start Season step: position battles are read off the
> manager's rebuilt configs (a starter whose margin over the runner-up
> was a coin flip = a battle that just resolved — reported for the
> user's team, incl. the 5th-starter fight), ~30% of clubs pick up one
> day-to-day camp knock (2-12 days; a few linger past Opening Day as
> the delayed-start archetype), and farm assignments are confirmed with
> the user's moves counted. Everything lands in the Opening Day report
> (18.13) — season projection from roster strength, key addition,
> prospect to watch, battles, delayed starts — and in the news feed.
> Overrides remain the normal tools (lineup editor, Move Level).

---

## 12. Minor League System

### 12.1 Minor League Structure

Each organization has up to **30 minor leaguers** distributed across 5 levels:

- **AAA:** Highest minor league level. Players here are roughly MLB-ready or filling depth roles.
- **AA:** Where many top prospects develop. The level where prospects "prove" themselves before AAA.
- **A+ (High-A):** Intermediate development level for younger prospects.
- **A (Low-A):** Entry-level full-season ball. Most recent draftees start here.
- **Rookie / DSL:** Short-season ball. Most recent international signings and late-round HS draftees start here.

There's no fixed allocation per level. A team might have 10 in AAA, 7 in AA, 6 in A+, 5 in A, and 2 in Rookie depending on their organizational depth. Distribution shifts as players promote, get drafted/signed, or leave the system.

### 12.2 Stat Simulation

Each minor leaguer has stats simulated annually rather than game-by-game. The end-of-year stat line is generated based on:

- Player's true ratings vs. level-average ratings
- Level-appropriate context (lower levels have lower run environments)
- Random variance (the same archetype's volatility parameter)
- Park factors (each minor league level has aggregated park factor effects, less granular than MLB)

**Level-average baselines** (multipliers vs. MLB averages):
- AAA: 90% of MLB averages
- AA: 80%
- A+: 70%
- A: 60%
- Rookie: 50%

So a 60-rated power hitter at A-ball produces stats well above the level's average — eye-popping numbers that scouts use to identify breakout prospects. The same player at AAA produces above-average but more modest numbers.

**Stats tracked per minor leaguer per season:**

- Same counting and rate stats as MLB (see 8.2)
- Level played (or levels if promoted mid-season)
- Plate appearances or innings pitched at each level

Simulation runs at end of season. During the season, minor league stats are produced incrementally — the user sees current stat lines update over time, even though the full simulation is summary-based. (Implementation: the season's stat line is generated upfront based on the player's full-season expectation, then displayed proportionally as the season progresses.)

### 12.3 Stat Noise and Scout Reliability

Minor league stats correlate with player ratings but include meaningful noise. Two effects:

1. **A 60-rated player at A-ball** typically produces a strong stat line, but in a "down year" might produce numbers that look pedestrian. Performance ≠ talent.

2. **A 45-rated player at A-ball** typically produces a mediocre stat line, but in a "career year" might briefly look like a breakout. Performance ≠ talent here either.

Random variance is wider at lower levels and tighter at higher levels (which mirrors real prospect evaluation — AAA stats are more predictive than A-ball stats).

This makes pure stats-based prospect evaluation unreliable. Scouting reports (gated by tier) are the more accurate signal. Combined info (stats + scouting) gives the best evaluation.

### 12.4 Level Assignment

Players are assigned to a level based on their current ratings and age:

- **AAA:** True overall rating 50+ and not currently rosterable in MLB
- **AA:** True overall rating 40-55, age typically 22-25
- **A+:** Developing prospects, true rating 30-50, age typically 20-23
- **A:** Recent draftees / younger prospects, true rating 25-45, age typically 18-22
- **Rookie:** Very young prospects (16-19), recent intl signings, late-round HS draftees

Level assignment is decided each spring training. The user can override but the AI manager and player development staff will recommend appropriate levels.

**Level appropriateness affects progression:**
- Player at appropriate level for ability: normal progression
- Player too aggressive (multiple levels above readiness): -15% progression, possible ceiling damage if sustained
- Player held too long (capable of higher level for >2 years): -10% progression, possible ceiling damage

The user manages this tension. Aggressive promotion can damage ceiling. Conservative handling can also damage ceiling. The "right" level is contextual and somewhat subjective — that's the development meta-game.

> **Status (0.12.0) — four-level ladder, tools-based placement, level
> fit live.** A+ merged into A (0.12 saves migrate on load): the ladder
> is Rookie (<35) → A (35-40) → AA (40-45) → AAA (45+). Placement is
> NOT rigid overall banding — minors.js `placementRating` adjusts the
> read by profile: an exceptional top tool with a real foundation (hit
> tool + discipline for bats, command + movement for arms) plays up to
> +4 above the overall; a profile carried by one loud tool that doesn't
> translate plays up to −4 below it. `recommendedLevel` (placement +
> age floors) is the single source of truth for three things: the scout
> arrows on Team → Minors (green ▲ = ready for a higher level, red ▼ =
> overmatched, nothing at the proper level), the development gate in
> progression.js (one level off = mild drag, −8/−10%; two or more = a
> genuinely stunted year, −20/−25% — both directions per the table
> above), and AI offseason reassignment (one step per year toward the
> recommendation, two when badly misplaced). The user can assign any
> minor leaguer to any level from the minors tab (Move Level… with the
> scouts' pick starred) in addition to promote-to-26-man swaps; the
> action modal states the scouts' verdict in words. Draft assignment
> also reads the placement (a polished college bat can open at AA;
> never straight to AAA). Not yet: sustained-misplacement ceiling
> damage (only the annual progression drag), mid-season AI promotions
> (12.5), and the promotion-candidate notifications.
>
> **Amended (0.17.0) — youth ceiling.** `recommendedLevel` also caps by
> age: 18 and under top out at A ball, 19-20 at AA, 21+ uncapped —
> nobody plays the upper minors as a teenager no matter how loud the
> tools (`maxLevelIdxForAge`). A prospect at his age cap reads
> levelFitDelta 0: dominating A ball at 18 is the proper level — no
> promotion arrow and no "held too long" development drag; promoting
> him past the cap by hand takes the aggressive-promotion penalty as
> usual. The cap flows everywhere recommendedLevel does: scout arrows,
> the progression gate, AI offseason reassignment, and draft/int'l
> assignment. Genesis age bands honor it (AAA now generates 21+).
> Paired with rawer HS draftees (6.5 note): the elite-teenager path is
> Rookie/A at 17-18 → AA at ~20 → AAA at ~21 → debut at 21-22, the
> ceiling untouched — the climb takes calendar years by design.

### 12.5 Promotion Mechanics

Mid-season promotions happen when:

- A minor leaguer is significantly outperforming their level
- The MLB roster has a vacancy (injury, slump, retirement, trade)
- The user manually decides to promote

Demotions happen when:

- An MLB player's performance has cratered and they need a reset
- A player needs minor-league rehab post-injury
- The user manually demotes

The user has full control. Notifications surface promotion candidates ("Player X is OPS-ing 1.050 at AA — consider promotion") but never auto-execute.

> **Status (0.38.0) — in-season development + merit-based mid-season
> moves (user request).** A season's rating movement now splits: five
> monthly in-season ticks (`inSeasonTick`, 1st of May–Sep, ~7% of the
> archetype's annual rates each) carry ~35% of the year, and the
> offseason pass runs at the remaining 65% — total yearly magnitude
> preserved, but a breakout farmhand now visibly improves DURING the
> season (and an aging vet visibly slips). Ticks use a reduced modifier
> bundle (work ethic + level fit); spikes, breakouts, reversion, coach
> mods, injury drag, and the full volatility jolt remain annual events.
> Orgs act on it: `ROSTER.midSeasonMoves` runs weekly (days
> 1/8/15/22/29, Apr 15–Aug 31) — when the best healthy AAA/AA farmhand
> outgrades the weakest same-side 26-man regular by ≥3 OVR, AI clubs
> swap them (2-catcher/5-SP floors and a 21-day anti-yo-yo cooldown
> respected; never the closer, never an IL cover), max one swap per
> club per week. Farmhands two+ levels below their recommendation climb
> the ladder on the 1st of Jun/Jul/Aug. The user's club NEVER
> auto-moves while the `promotion` sim stop (default ON) is set —
> qualifying swaps arrive as a halt notice + Player Development inbox
> letter (once per player per season); turning the stop off hands the
> calls to the front office like every other stop. A monthly
> development report (inbox, 1st of Jun–Sep) names the org's biggest
> risers and faders since last month. **Amended (0.38.1):** the user's
> Send Down lands the player at his age-capped recommended level (a
> 19-year-old goes to AA, not AAA), auto-calls-up a covering catcher
> or starter when his departure would break those floors, rebuilds the
> configs BEFORE he joins the farm list (the repair pass used to patch
> the lineup hole with the best minors player at the position — the
> very man just optioned, silently undoing the move for anyone who was
> his position's only real option), and stamps the 21-day cooldown so
> the merit sweep never reverses a deliberate development stash.
> User promote-swaps stamp the same cooldown. Companion: the `bust` archetype
> (8% of both lists, riseRate 0.02) — the prospect who simply never
> develops, with normal seductive scouted ceilings (scouting never
> reads archetypes); HS draftees carry extra bust exposure. The only
> tell is the attribute-history chart refusing to move.

> **Status (0.41.0) — the wider baseball world (user request).**
> Five connected changes. **(1) Intl ages:** the July 2 class is
> 16-17-year-olds (~92%) with a rare 18; never older — the 19+ route to
> the NABL is the posting/KBO/defector event pipeline (14.7), as in
> life. **(2) Draft depth:** 350 prospects for the same 300 picks, so
> the tenth round carries real choice and ~50 names go undrafted every
> June. **(3) Smarter draft AI:** each club drafts off a PERCEIVED
> board — consensus rank blended with true talent in proportion to its
> scouting tier (bare 15% truth ±4 ranks of noise … elite 70% ±1), over
> a candidate pool of the consensus window plus the best buried talents
> down to ~#120. An elite department takes the true-top-5 talent
> sitting #61 on the board ~10% of the time on a single pick; a
> bare-bones one never does. **(4) Undrafted paths:** high schoolers
> (drafted-unsigned or undrafted) return to campus and leave the game;
> the best ~50 undrafted COLLEGE prospects hit the FA pool (status FA,
> zero service time) and stay signable. A new drain clause (24+, sub-44
> OVR, two unsigned years → 50%/yr) keeps the pool from bloating.
> **(5) View-only flavor leagues + monthly stat lines:** nothing here
> simulates — no teams, no standings, no games. Every unsigned FA is
> stamped `playsIn` once per season (young → Atlantic League / American
> Association / Frontier League; quality vets 27+ → NPB/KBO/Mexican
> League; ~10% sit out), shown on the FA browser and player card. On
> the 1st of May-Sep, farmhands AND flavor-league FAs post an additive
> month-sized stat chunk (minors.monthlyLine, anchored to the league's
> quality on the 12.2 level scale — NPB 50 plays above AAA 47, Frontier
> 35 below A), with the rollover adding a sixth closing chunk; season
> totals match the old one-shot lines, but the card now fills in as the
> season goes, tagged where he "played" ("2031 NPB", "2031 FRO").
> Players who miss the monthly path get the classic rollover backfill.
> Indie-ball kids keep developing through normal progression — the
> undrafted senior who rakes in the Atlantic League IS signable from
> the in-season pool, which is the whole point.

### 12.6 Minor League Free Agents

Players who haven't reached MLB but have been in the minors for 6+ seasons become minor league free agents at the end of their 6th minor-league year. They can be re-signed by their organization or signed by another team to a minor-league deal.

This provides a small "veteran AAA depth" market each offseason. Most signings are unremarkable — fringy AAA bats and arms — but occasionally a late-blooming player emerges from this pool.

### 12.7 Rule 5 Draft (Simplified)

In December, the Rule 5 draft selects unprotected minor leaguers from organizations:

- Players added to organization 4+ years ago who are not on the 40-man roster are "Rule 5 eligible"
- Other teams can select these players for $100K
- A selected player must remain on the new team's 26-man active roster for the entire next season; if not, they must be offered back to their original team for $50K

The user makes Rule 5 protect/expose decisions in November. Most exposures are non-events. Occasionally a selected player has a surprising MLB year (the J.D. Martinez / Roberto Clemente lineage of Rule 5 hits).

This is a small, simple mechanic that adds historical flavor and creates rare strategic moments.

### 12.8 Minor League Roster Limits

The 30-player minor league roster cap is enforced. When the cap is reached:

- New draft picks force releases of existing minor leaguers (typically older fringy prospects)
- New international signings similarly force cuts
- Trade acquisitions require roster spot consideration

The system handles this semi-automatically by cutting the lowest-rated, oldest minor leaguers first when forced to make room. The user can override and choose who to release.

---

## 13. Amateur Draft

### 13.1 Draft Timing

The amateur draft runs annually on **June 30**. This timing is fixed (after college season ends, before international signing window opens July 2). The draft event surfaces in the user's offseason calendar and pauses normal sim flow.

### 13.2 Draft Order

Draft order is determined by **previous season's reverse standings**:

- Worst team (lowest winning %) picks #1 in each round
- Best team (highest winning %) picks last
- Ties broken by previous season's standings
- Order is the same in every round (not snake)

**No competitive balance lottery** in the initial implementation. The worst team always gets the #1 pick. Real MLB has a draft lottery but it adds complexity that's worth skipping initially. Could be added later as a "lottery year" system.

**Compensation picks (simplified):** None at launch. No qualifying offer compensation, no failed-to-sign comp picks. Pure straight order. Could be added later if desired.

### 13.3 Draft Class

A draft class of ~300 players is generated annually (10 rounds × 30 picks per round).

**Class composition** (defined in 6.5):
- 30% high school players (age 17-18)
- 65% college players (age 19-23, with majority being 21-22 juniors)
- 5% other (international amateur eligible, JuCo, etc.)

**Class strength variation** (defined in 6.5):
- Each class has a strength rating from -2 to +2 standard deviations
- Strong classes have 3-5 elite prospects (75+ ceiling) at the top
- Weak classes have 0-1 elite prospects with most round 1 ceilings capped 65-70

**Class generation timing:** New draft class is generated in May (in-game month) so user has time to scout it before the June 30 draft. Pre-generated reports surface in late May.

### 13.4 Pre-Draft Scouting Phase

From May 1 through June 30, the user can review the draft class:

- **Top prospect rankings** visible (depth gated by scouting tier)
- **Mock drafts** generated by simulated industry consensus, refreshed weekly
- **Workout/showcase events** generate occasional tool grade updates on top prospects (small flavor element — adds fresh notes to scouting reports a few times)
- **Personal team big board** — user can rank prospects in their preferred order, flag "must-not-pass-up" targets, etc. (UI feature; doesn't affect AI behavior)

The user does *not* directly scout individual prospects (that's the tedium we're avoiding). The reports they receive depend on their scouting tier and update naturally over the pre-draft period.

### 13.5 Draft Day Execution

On June 30, the draft executes round by round. The pace is user-controlled:

- **Real-time pacing option:** User watches each pick happen with a 3-5 second delay between picks. Other teams' picks generate notifications. When user's pick approaches, sim pauses.
- **Quick-draft option:** User makes their picks in rapid succession; other teams' picks resolve instantly between user's selections.

When user's pick comes up:

- **Pick screen** shows: round, pick number, available top prospects, big board ranking
- **Filter and sort:** user can filter by position, by tool, by archetype hint, by background
- **Best player available recommendation** generated by AI (taking into account user's roster needs)
- **User selects** by tapping a prospect

After all 10 rounds, the draft is complete. User receives a summary of their class.

### 13.6 Other Teams' Draft Behavior

AI teams draft based on their owner archetype, scouting tier, and roster needs:

- **Patient Builder, Analytics-Driven:** Draft strictly best player available; tend to draft "high-floor college" types or "high-ceiling HS" types based on archetype. Strong scouts mean better hits.
- **Win-Now Spender, Old-School:** Draft based on near-term contributions; favor college players, polished bats, advanced pitchers
- **Cheap Owner:** Sometimes punts top picks for cheaper deals (signing bonus pool savings); draft "signability" prospects
- **Aggressive Trader:** May draft based on trade value (later in process) more than fit

**Reach picks** happen — AI teams sometimes pick slightly off the consensus board, especially teams with weaker scouting. This creates the "I can't believe they took him there" moments. Combined with scouting tier mistakes, the draft has natural narrative variance.

### 13.7 Signing Bonuses (Simplified)

Each draft pick has a slot value (signing bonus expectation). Simplified system:

- Round 1 picks: $4M-$10M slot values, depending on overall slot
- Round 2 picks: $1.5M-$3.5M
- Round 3-5 picks: $400K-$1.5M
- Round 6-10 picks: $150K-$400K

Each team has a **draft bonus pool** (sum of their slot values across all picks). Teams can spend over slot on individual picks if they save under slot on others.

**Signing rate:**
- Round 1-3: Almost all picks sign (95%+)
- Round 4-7: 90%+ sign
- Round 8-10: 80%+ sign (some HS players elect college, especially talented ones drafted late)

**Failed signings:** A small percentage of picks don't sign. Their slot value is forfeited (no compensation pick the following year — sim simplification). The pick is essentially wasted.

**User can negotiate signing bonuses?** In the simplified system: no. Picks sign at slot or close to it. Over-slot deals on top prospects or under-slot deals on lower picks happen but are AI-managed. User just receives a summary.

This is intentionally simple. Could be expanded later to make signing negotiations a meta-game, but initial implementation is automatic.

### 13.8 Draft Class Integration

After the draft, signed players join the organization's minor league system:

- Top picks (round 1, sometimes round 2): start at A or A+ depending on age and polish
- Mid-round picks: start at A or Rookie
- Late picks: start at Rookie or DSL
- Exceptional college polish (a 22-year-old SEC star): may start at A+ or even AA

**Roster space:** Drafted players entering minors may force cuts of existing minor leaguers (per 12.8). The system handles this automatically with notification.

**Initial scouting fog:** Even your own newly-drafted prospects start with wide bands (per 5.7.3 fog reduction). Their bands tighten over the next 1-2 minor league seasons as they play in your system.
13.9 Draft Day UI Considerations
Draft day is a focal moment in the offseason. UI design priorities:
Mobile-friendly pick screen: Large prospect cards with key info; tap to draft
Filterable big board: sort by position, ranking, archetype
Live draft tracker: vertical scroll showing picks as they happen
Quick-draft toggle: for users who want to fly through other teams' picks
Recap screen: post-draft summary of user's class with notes

## 14. International Signings

### 14.1 Annual Cycle

The international signing window opens **July 2** each year and runs through approximately the end of the following June (when the next class enters). However, the vast majority of signings happen in the first 2-3 weeks of the window. This sim simplifies the process to a single concentrated event.

Pool budgets are set on November 1 of the prior year (based on previous season standings — see 6.10). This gives the user 8 months to plan before signings open.

### 14.2 Pre-Window Scouting Phase

From November through July 1, the user can review the international pool:

- **Top 30 prospects** get visible scouting reports (depth based on team scouting tier)
- **Bottom 70 prospects** are listed with minimal info
- **Industry rankings** of the top international prospects, refreshed periodically through the year
- **User's pool budget** displayed prominently with rough cost estimates per signing tier

The user can build a target list and rough budget allocation plan before the window opens.

### 14.3 Signing Window Execution

When the window opens July 2, the user enters the signing phase:

**Phase 1: Top-tier signings (first week)**
The most coveted prospects sign quickly with teams that have the budget and interest. The user can bid on top prospects against AI competition.

**Bidding logic:** Each top prospect has a "preferred" signing range (their expected bonus). User can offer at, above, or below this range. AI teams also bid. The prospect signs with the team offering the highest bonus, with small ties broken by team reputation, market size, and prior international success.

**Phase 2: Mid-tier signings (next 1-2 weeks)**
Players ranked 11-50 sign. Less competitive bidding; most prospects have a small handful of teams interested. User can target specific players and usually land them at slot value.

**Phase 3: Lower-tier signings (remaining window)**
Players ranked 50+ sign for small bonuses ($50K-$300K). User can bulk-sign multiple prospects for depth.

### 14.4 Pool Allocation

The user has full control of how to allocate their pool. The interface shows:

- **Pool remaining:** updated as signings are made
- **Signed prospects list:** running tally with bonus amounts
- **Available budget:** clear visualization of what's left

Strategic options:
- **Big game hunting:** spend most of pool on 1-2 top prospects
- **Diversified portfolio:** moderate signings spread across 5-8 prospects
- **Volume play:** many small signings for depth (works best at lower scouting tiers where you're partly betting on luck)

### 14.5 Signed Prospects Integration

International signees enter the organization's Rookie level (or DSL equivalent). They typically need 2-3 years before reaching A-ball. Their rating bands tighten as they move up (per 5.7.3 fog reduction).

Top-tier international signings often have ceilings comparable to top-of-the-draft prospects. The very best 16-year-old Dominican signing might have an 80 ceiling on speed, or a 75 ceiling on power. These are the "future All-Star" prospects that small-market teams chase.

### 14.6 Pool Carryover and Over-Spending

**Carryover:** Up to 25% of unspent pool rolls into the following year. User decides when signing window closes whether to save remainder.

**Over-spending penalties** (from 6.10.4):
- Up to 5% over: warning only
- 5-15% over: small fine + reduced pool next year (-15%)
- 15-30% over: significant fine + halved pool for 2 years
- 30%+ over: signing restrictions for 2 years

**Trade for pool space:** Not modeled at launch. (Real MLB allows limited trading of pool space; could be added later.)

### 14.7 Special International Events

Three special events generate unique signing opportunities outside the standard pool:

**Japanese Posting System:**
- 0-3 NPB stars are posted per offseason (random per year)
- Posted players are 25-30 years old and MLB-ready
- All 30 teams can negotiate; player chooses where to sign
- Posting fee paid to NPB team (typically $20-50M)
- Player contract is separate from posting fee; usually 4-7 years, $80-200M
- These are major events — top posted players generate significant offseason buzz
- User can compete for posted players regardless of pool size (this is a separate process)

**Cuban Defectors:**
- Random event, 0-2 per year
- Defector becomes available mid-season or in offseason
- All 30 teams can bid
- Bonus paid is typically $5-30M depending on prospect quality
- Outcomes are highly variable — Céspedes / Abreu / Chapman lineage of stars; also many busts
- These signings come with unusual uncertainty (less data on competition level)
- Bonus comes from team payroll budget, not international pool

**Korean Declarations:**
- Less common, 0-1 per year
- KBO stars who declare for MLB free agency
- Generally 28-32 years old
- Sign 2-4 year contracts, $30-80M range
- Negotiation similar to free agency rather than amateur signing
- Treated more as a free agent signing than international amateur

### 14.8 Information Quality and Tier Effects

Reiterating from section 6.7 and 6.9: scouting tier dramatically affects how clearly the user sees the international pool.

- **Elite scouting:** Top 30 prospects with tight bands and useful archetype hints; bottom 70 with sparse info
- **Standard scouting:** Top 15-20 visible with wide bands; rest minimal
- **Bare bones:** Top 5-10 visible with very wide bands; signing other prospects is essentially blind

A small-market analytics team running elite scouting can identify undervalued prospects in the bottom half of the pool — the unranked Dominican kid who turns into a star. A bare-bones team has no realistic chance to find these gems.

This is one of the strongest scouting payoffs in the system. Drafting matters too, but international scouting is where elite info quality most directly translates to organizational depth.

---

## 15. Trades

### 15.1 Trade Philosophy

Trades are one of the most important systems in the sim because they're the primary way users interact with rival GMs. The trade system needs to feel like a real negotiation against intelligent opposition — not a vending machine that produces favorable deals on demand, and not an opaque wall that rejects everything reasonable.

Three design goals:
1. **AI teams have coherent, archetype-driven preferences** — different teams want different things
2. **Trade values are mostly fair, with team-specific premiums and discounts**
3. **Information asymmetry matters** — your scouting tier affects how confidently you can evaluate trade pieces

### 15.2 Trade Format

**Player-for-player trades** (with optional cash considerations) are the primary format. Multi-player trades supported. No draft pick trading at launch (could be added later — adds complexity).

**Cash considerations:** Up to $20M in cash can be included from either side. Used to balance value or absorb contracts.

**Trade types supported:**
- 1-for-1 swap
- Multi-player swap (up to 4-for-4)
- Salary dump (player + cash for prospect)
- Prospect for veteran (rebuilding move)
- Three-team trades: not supported at launch (significant complexity)

### 15.3 Player Valuation Engine

Every player has an internal **Trade Value (TV)** calculated by the engine. This is a single number representing the player's value to a generic team. Components:

**For position players:**
- Production value: weighted ratings (age-adjusted)
- Years of team control remaining: contract years left, including arb years
- Contract burden: positive value if cheap relative to production, negative if expensive
- Age and archetype: younger players with developmental upside score higher
- Position scarcity: SS/CF/C valued slightly higher than corner positions

**For pitchers:**
- Production value: weighted ratings (age-adjusted)
- Role: SP > CP > setup RP > middle RP at equivalent talent
- Years of team control remaining
- Contract burden
- Injury history: heavy injury history reduces TV significantly
- Age and archetype

**For prospects:**
- Ceiling estimate (with uncertainty band)
- Distance from MLB (lower levels = more risk = lower TV until proven)
- Archetype indicators (high-floor prospects valued more for safety; high-ceiling prospects more for upside)
- Age relative to level

**Trade Value scale:** Roughly 0-100, where:
- 0-10: Replacement level / fringe prospects
- 10-25: Useful role players, mid-tier prospects
- 25-50: Solid regulars, top-100 prospects
- 50-75: All-Star caliber, top-30 prospects
- 75-100: Superstar, top-5 prospect

A trade is roughly fair when total TV on each side is within ~15% of the other. AI teams generally accept trades within this range; outside it, they push back.

### 15.4 Team-Specific Modifiers

Each team applies modifiers to TV based on team state and archetype:

**Competitive window state** (each team is in one of: rebuilding | retooling | contending | win-now):

- **Rebuilding teams:**
  - Veterans on expiring contracts: TV +30% (they want to flip these)
  - Young controllable players: TV -15% (less interested in trading these away)
  - Top prospects: TV -25% (highly value prospects)
  - Established stars under team control: TV +10% (will trade for major prospect haul)

- **Retooling teams** (mid-rebuild, partial contender):
  - Mixed preferences. Slightly elevated value on young controllable talent. Open to most trades.

- **Contending teams:**
  - Veterans/rentals: TV -15% in their valuation (they'll pay more than market for proven contributors)
  - Top prospects: TV +20% (they'll trade prospects for win-now help)
  - Established stars near FA: TV -25% (rentals heavily wanted)

- **Win-now teams:**
  - Even more aggressive than contenders. Will overpay significantly for proven talent.
  - Top prospects: TV +35% in their valuation
  - Will dump bad contracts to make room for upgrades

**Owner archetype additional modifiers:**

- **Win-Now Spender:** Above modifications applied at full strength; willing to absorb bad contracts in trades for upgrades
- **Patient Builder:** Reluctant to trade prospects; values prospect haul highly even when contending; will resist big "win-now" trades
- **Cheap Owner:** Always interested in salary dumps; reluctant to take on contracts
- **Analytics-Driven:** Values undervalued players (good peripherals, bad results); skeptical of name-brand veterans
- **Old-School:** Values veterans, "proven" players; will overpay for narrative-fit pieces; skeptical of unproven prospects
- **Aggressive Trader:** High volume of trade activity; willing to make large blockbusters in either direction

### 15.5 Trade Proposal Mechanics

The user can:

**Propose a trade:** Select a target team, choose players from each side, optionally add cash. Submit proposal.

**View team needs:** A "team interest" panel shows what each team is publicly seeking (e.g., "Looking for: starting pitching, 2B help"). This is updated each season based on roster needs.

**Receive trade offers:** AI teams occasionally propose trades to the user, especially around the trade deadline. Frequency:
- Mid-season: 1-3 unsolicited offers per month
- Trade deadline week: 5-10 offers
- Offseason: 2-5 per month
- Specific event triggers: a new injury creates needs; a hot prospect triggers interest

**Negotiate:** When a proposal is rejected, the AI team may counter-propose. User can iterate on the deal.

### 15.6 Trade Evaluation Process

When the user submits a trade proposal to an AI team, the engine:

1. **Calculates TV for each side** from the AI team's perspective (using their team-specific modifiers)
2. **Compares totals:**
   - If user side >> AI side (user is overpaying): AI accepts immediately
   - If sides are roughly fair (within ~10%): AI accepts
   - If sides are slightly off (10-25% gap): AI proposes a counter
   - If sides are very off (25%+ gap): AI rejects with feedback ("we need significantly more")
3. **Communicates result:** Accept / counter / reject with brief feedback

The feedback is helpful but not all-revealing. The AI says things like "we need a starter, not another reliever" or "we'd want at least one top prospect" — directional info without specifying exact values.

### 15.7 AI-Initiated Trades

AI teams initiate trades based on:

- **Roster needs:** A team with a hole at SS will look for SS solutions
- **Surplus inventory:** A team with too many starting pitchers will look to deal one
- **Competitive window match:** Contending team finds a rebuilding team to deal with
- **Owner archetype tendencies:** Aggressive Trader teams initiate more often

The user receives notifications of incoming offers. They can accept, reject, or counter. AI teams have the same iteration capability as the user — multiple counter rounds possible.

**AI-AI trades** also happen continuously in the background. The user receives news notifications about other teams' trades but doesn't influence them. This produces realistic league movement — by midseason, rosters look meaningfully different than Opening Day.

### 15.8 Information Asymmetry in Trades

User's scouting tier affects how they evaluate trade pieces:

- **Their own players:** Always exact ratings (no fog)
- **Other team's MLB players:** Always exact ratings (public info)
- **Other team's prospects:** Visibility per scouting tier (see 5.7.2)

A team with bare-bones scouting trading for prospects from another organization is essentially trusting tip-of-iceberg info. The prospect they acquire might be wildly overvalued or undervalued in their own evaluation.

Once a prospect is acquired, fog clears as they progress through the new system (per 5.7.3). But the initial trade evaluation is gated.

This creates real strategic differentiation. High-scouting teams can confidently target undervalued prospects from rebuilding teams. Low-scouting teams trading prospects are flying partly blind.

### 15.9 No-Trade Clauses (Skipped at Launch)

Real MLB has no-trade clauses for veteran players. The sim simplification: no NTCs at launch. All players are tradeable. This is a deliberate omission to avoid contract complexity. Could be added later as a system where star FAs negotiate NTCs into contracts.

### 15.10 Trade Deadline

The trade deadline falls at the end of July (~game 107). After the deadline, no more trades until the offseason.

In the week leading up to the deadline:
- Trade activity surges across the league
- AI teams in contention more aggressively pursue rentals
- Rebuilding teams more aggressively shop veterans
- User receives a higher volume of trade offers
- News notifications track major trades league-wide

Post-deadline, no roster trades until November.

### 15.11 Trade History Tracking

Every trade is logged in the league history. Player profiles show their trade history (acquired by whom, traded for, dates). This adds depth over a long save — you can see how a star was acquired 8 years prior, what your prospects became, etc.

### 15.12 Common Trade Archetypes

Patterns the engine should produce naturally:

- **Star + bad contract for prospects + cash:** Win-now team takes on payroll burden in exchange for star
- **Prospect package for ace at deadline:** Contender deals 2-3 prospects for a rental SP
- **Salary dump:** Cheap-owner team trades expensive veteran for prospect + cash; receiving team eats most of contract
- **Hot prospect for veteran reliever:** Contender deals a prospect for proven bullpen help
- **Multi-player swap:** Two teams with mismatched needs balance via 2-for-2 or 3-for-3
- **Quad-A guys exchanging organizations:** Low-stakes trades of fringe pieces

If the engine produces variety across these patterns naturally, the league feels alive.

---

## 16. Free Agency and Contracts

### 16.1 Free Agency Cycle

The free agency window opens **mid-November** each year (~5 days after World Series). The major signing activity happens November-January. Some FAs sign as late as spring training. The window closes at the start of the regular season; unsigned veterans can still be signed mid-season but as one-off events, not part of the formal FA market.

### 16.2 Free Agent Pool

The FA pool consists of:

- **Players whose contracts have expired** at end of previous season
- **Players released and not picked up** during the season
- **Recently retired stars considering returns** (rare)

Each year produces roughly 100-150 FAs across all classes (star, mid-tier, role player, fringe).

### 16.3 Contract Structure (Simplified)

Per project decision: simple contracts with **years and total value only.** No:

- No-trade clauses (per 15.9)
- Opt-outs
- Player options / team options
- Mutual options
- Signing bonuses (separate from annual salary)
- Performance bonuses
- Deferred money

Each contract is: `{ years: N, totalValue: $X, annualSalary: $X/N }`

Annual salary is total value divided by years (uniform distribution).

### 16.4 Player Asking Price

Each FA has an internal asking price determined by:

- **Player Trade Value** (recalculated for FA context)
- **Recent performance** (especially the contract year)
- **Age** (35+ players see steep AAV drops, shorter contracts)
- **Position scarcity** (premium positions command premiums)
- **Market conditions** (tight FA class drives prices up; deep class compresses)
- **Player archetype** (volatile / one-year-wonder players priced cautiously)

Generated as a range: "Player X is seeking 4-5 years, $80-110M total value." User sees this when scouting the FA.

### 16.5 Bidding Process

The user can offer FAs contracts. AI teams also bid. Multiple teams compete for star FAs, fewer for mid-tier, sometimes only 1-2 for fringe FAs.

**User's offer interface:**
- Select FA target
- Propose years and total value
- Submit offer

**FA response:**
- **Accept:** if offer meets or exceeds asking price
- **Counter:** if offer is close but undervalues player
- **Reject with feedback:** if offer is well below asking
- **Reject:** if multiple better offers exist or player has team preferences

**Player preferences** add flavor. A FA might prefer:
- Returning to former team (loyalty)
- Contending teams (chasing a ring)
- Geographic ties (returning to home region)
- Specific market sizes (some prefer big markets, others small)
- Specific manager or coaching staff

These preferences create occasional surprises — a star FA signing for slightly less money to land in a specific city. They appear in scouting reports as flavor text.

### 16.6 Bidding Wars

When multiple teams compete for a top FA:

- Initial offers come in from interested teams (visible to user as "estimated other offers")
- User can counter with revised offer
- Process iterates over several days (in-game)
- Eventually FA signs with the highest reasonable offer that matches their preferences

The user doesn't see other teams' exact offers (info asymmetry), but they get a "you'd need to top X" signal indicating roughly where the bidding stands.

### 16.7 Free Agent AI Team Behavior

AI teams pursue FAs based on:

**Roster needs:**
- Holes at specific positions drive interest
- Available payroll space drives capacity to bid
- Win-now state drives urgency

**Owner archetype:**
- Win-Now Spender: aggressive on top FAs
- Patient Builder: avoids long-term mega-deals
- Cheap Owner: avoids most FAs above league minimum
- Analytics-Driven: bargain-hunts, exploits market inefficiencies
- Old-School: pursues name-recognition vets aggressively
- Aggressive Trader: moderate FA participation

**Market state:**
- Tight class for a position drives prices up
- Deep class compresses prices

### 16.8 Failed Free Agency

If a player goes unsigned through the FA window into spring training:

- Their asking price drops 15-30%
- They become available for one-year "pillow" contracts
- Eventually they may sign minor-league deals with NRI invites

This creates the "Spring Training surprise" archetype — a veteran signing for cheap in March.

### 16.9 Mid-Season Free Agent Signings

Outside the FA window, signings can still happen:

- Released players become FAs immediately
Teams with open roster spots can sign FAs anytime
Most signings are minor-league deals or veteran-min ML deals
These produce occasional "team signs ex-All-Star to fill role" events. Frequency: low. Maybe 1-3 per team per season.
16.10 Qualifying Offers (Skipped at Launch)
Real MLB has the QO system: teams can offer their pending FAs a 1-year contract at a set value; if the player rejects and signs elsewhere, the original team gets compensation pick. This adds significant complexity. The sim skips it at launch. Could be added later as a strategic offseason mechanic.
16.11 Contract Extensions
In addition to FA signings, teams can sign their existing players to contract extensions:
Extensions can be offered to any player on the 40-man roster
Most common with players approaching FA (last year of team control)
Pre-arbitration extensions exist (signing a young player long-term before they hit arb)
Player has to agree (some prefer to test FA market)
Extension economics:
Players signing pre-arb extensions accept lower AAV in exchange for security (the "team-friendly" extension)
Players signing extensions in their last team-control year demand near-FA money
The user can offer extensions through the player profile. Player accepts if offer meets or exceeds their internal asking price for an extension.
16.12 Released Players
Teams can release any player (with the team paying out the remaining contract). Released players become FAs immediately and can be signed by any team. The original team eats the contract.
This is most often used for:
Cutting underperforming veterans
Salary dumps (rare; usually trades are preferred)
Roster space crises (need a 40-man spot, no one to demote)
Mid-tier veterans released mid-season often sign with new teams within weeks at minimum salary.



## 17. Managers and Coaches

### 17.1 Coaching Staff Structure

Each MLB team has three primary staff roles modeled in the sim:

- **Manager:** Game-day decision maker; sets play style and tactical tendencies
- **Hitting Coach:** Provides development modifier to hitters in organization (MLB and minors)
- **Pitching Coach:** Provides development modifier to pitchers in organization (MLB and minors)

Other coaching roles (bench coach, base coaches, bullpen coach, assistants) are not modeled. The three above carry the meaningful mechanical effects.

### 17.2 Manager Attributes

Each manager has the following attributes:

**Identity:**
- Name, age, years of managerial experience
- Playing background (former player vs. lifetime coach — flavor only)

**Tendency parameters (1-10 scales, displayed as low/average/high):**

- **Small-ball aggressiveness:** How often the manager calls for bunts, hit-and-runs, stolen base attempts. High = old-school small ball; low = swing-for-the-fences modern
- **Bullpen leverage:** How aggressively the manager uses leverage-based bullpen deployment vs. fixed-role usage. High = matchup-driven; low = role-based
- **Quick hook on starters:** How early starters get pulled. High = quick hook (modern usage); low = let starters work deep
- **Lineup construction:** Old-school (high-OBP at top, sluggers in middle) vs. modern (high-OPS at top). 1-10 sliding scale.
- **Defensive replacement usage:** How often glove-only players sub in late innings. High = aggressive late-game defense; low = leave starters in
- **Pinch-hit aggressiveness:** Likelihood of using pinch hitters in NL-style games

**Reputation rating (1-10):** Industry perception of the manager. Drives hiring desirability.

### 17.3 Manager Archetypes

Generated managers follow archetypes that bundle tendency parameters into recognizable styles:

- **Old-School Tactician:** High small-ball, low quick hook, traditional lineup construction. Loved by Old-School owners. (Bobby Cox / Buck Showalter lineage.)
- **Modern Strategist:** Low small-ball, high quick hook, leverage-based bullpen, high pinch-hit usage. Loved by Analytics-Driven owners. (AJ Hinch / Kevin Cash lineage.)
- **Player's Manager:** Moderate everything, high reputation among players, low bullpen leverage. Long careers but not always tactical. (Bruce Bochy / Joe Maddon lineage.)
- **Aggressive Innovator:** Extreme tendencies in some areas (very high small-ball OR very high analytics usage), divisive in industry. (Billy Martin / 1990s LaRussa lineage.)
- **Defensive-Minded:** High defensive replacement usage, conservative lineup, low quick hook. (Mike Matheny / Don Mattingly lineage.)
- **First-Year Manager:** No archetype yet; generated with broadly average tendencies. Develops a reputation over first 2-3 years.

Owner archetypes have hiring preferences across these manager archetypes (see 17.5).

### 17.4 Coach Attributes (Hitting and Pitching Coaches)

Each coach has:

- Name, age, experience
- **Development modifier:** -10% to +20% applied to player progression in their domain (hitters or pitchers)
- **Specialty (optional):** Some coaches have a sub-specialty — "Power development specialist," "Command guru," "Plate discipline expert" — that grants additional bonus to specific ratings
- **Reputation:** 1-10 industry perception

The development modifier is the core mechanical effect. An elite hitting coach (+15% modifier) significantly accelerates the development of all hitters in the organization, including minor leaguers. A poor hitting coach (-5%) actively retards development.

This is a real strategic consideration. A patient builder team with a top hitting coach develops prospects faster than the same team with a journeyman coach. Coach quality compounds over years.

### 17.5 Owner Archetype Hiring Preferences

When a team has a managerial opening, the owner's archetype influences who they pursue:

- **Win-Now Spender:** Hires established veteran managers (high reputation, high experience). Fires fast after one losing season.
- **Patient Builder:** Hires development-oriented managers. Long tenures (5+ years typical).
- **Cheap Owner:** Hires inexpensive managers — often unproven candidates, first-year managers, or bargain-bin veterans.
- **Analytics-Driven:** Hires Modern Strategist archetype, often newer/younger candidates. Long tenures if results follow.
- **Old-School:** Hires Old-School Tactician archetype with playing-career credentials.
- **Aggressive Trader:** Average tenure, average expectations. No strong archetype preference.

Coach hiring follows similar archetype-driven patterns but is generally less politicized than manager hiring.

### 17.6 Hiring and Firing

**Manager firings:** Triggered by:
- Owner archetype tolerance (Win-Now fires after 1 losing season, Patient Builder waits 4-5)
- Performance vs. expectations (a contending team underperforming triggers firing pressure faster than a rebuilding team)
- Random events (5% chance per season of "manager wanted to leave" or "personal reasons")

**Coach firings:** Less politicized. Usually tied to manager firings (new manager often brings their own coaches) or extreme failure (development modifier consistently negative). Most coach turnover happens organically when contracts expire.

**Hiring pool:** The league maintains a standing pool of unemployed managers and coaches at all times — it exists from league generation (roughly 8-12 unemployed managers and 15-20 unemployed coaches of varying quality and archetype), not just after the first firings. Each offseason the pool gains fired managers and coaches, new first-year candidates from the minor-league managerial ranks, and recently retired players entering the profession (see 17.9); it loses hires and candidates who age out or retire from the profession. The pool should always be deep enough that a firing never strands a team — but shallow enough that the good candidates go fast and hiring late means bargain-bin options.

**User's hiring decisions:**
- After firing (or contract expiration), user can interview candidates from FA pool
- Interview process: select up to 3 candidates, view their attributes and reputation
- Make offer (1-4 year contract, modest annual salary $1-5M)
- Candidate accepts or declines based on team situation, reputation, and offer

> **Status (0.15.0) — the staff market is offer-based.** Managers and
> coaches are no longer swappable at will: firing opens a vacancy (only
> in the offseason), and hiring means making an offer the candidate
> weighs — winning clubs and large markets attract, big reputations are
> choosier, and the UI shows an honest outlook ("Likely to accept" …
> "Long shot") before you burn the offer. A decline is final until next
> winter (tracked per candidate/team/year). Unfilled seats still get an
> owner hire at Opening Day. Simplifications kept for now: no staff
> contract years/salary negotiation (the modest-salary economics are
> flavor), interviews aren't capped at 3.

### 17.7 Manager and Coach Effects on Simulation

**The manager runs the day-to-day — for every team, the user's included (Pillar 4).** The player is the GM. Once the manager system ships, the manager owns:

- Lineup construction and batting order (vs RHP / vs LHP), per his lineup-construction tendency
- Rotation order and spot starts
- Bullpen roles and in-game deployment (per his leverage / quick-hook tendencies)
- Rest days and fatigue management (the engine's current auto-rest behavior becomes the manager's judgment, colored by his tendencies — some managers ride their regulars harder)
- In-game tactics: bunts, hit-and-runs, SB aggressiveness, pinch-hitting, defensive replacements

The GM does **not** override individual game-day decisions. GM influence over the on-field product is indirect and realistic:

- **Hire the right manager.** The primary lever. Roster built for speed and contact? An old-school small-ball manager uses it; a three-true-outcomes manager wastes it.
- **Shape the roster.** The manager plays the players he's given. A manager can't bench your star for a scrub — decisions follow talent, colored by tendencies.
- **Organizational directives (light touch, at most).** A small set of GM-to-manager asks — "get the kid regular at-bats," "ease the veteran's workload" — that nudge (not command) manager behavior. This is an optional Phase 10+ refinement; it must never become a lineup editor in disguise.

**Transition plan.** The Phase 3 lineup/rotation/bullpen editing UI is the *interim* manager: the user acts as their own skipper until Phase 10. When managers land, those screens become views of the manager's decisions (with his reasoning surfaced where cheap: "Sitting Vance Shepherd — day off after 12 straight starts"), and direct editing is retired for the user team just as it never existed for AI teams. The engine's current generic decision logic (auto-rest, reliever rest rules, leverage-based bullpen calls, pull thresholds) is the baseline "league-average manager"; Phase 10 parameterizes it by each manager's tendency values rather than rewriting it.

**Coach effects on progression:**
- Hitting coach's modifier applied to all hitter progression rolls in the organization (MLB through Rookie ball)
- Pitching coach's modifier applied similarly to pitchers
- Specialty bonuses apply to specific ratings as defined

These effects make hiring decisions matter mechanically, not just narratively. A small-market team that consistently identifies elite coaching talent gains a real, measurable edge in player development.

### 17.8 Manager Awards

**Manager of the Year** is awarded annually in each league. Voting considers:

- Team's record vs. preseason expectations (overperforming preseason projections is the main driver)
- Team's record vs. preseason payroll position (cheap teams that win drive votes)
- Manager's tactical reputation
- Random voter variance

User-team managers are eligible. Winning Manager of the Year boosts the manager's reputation rating significantly and adds a small bonus to their next contract negotiation.

### 17.9 Retired Players Entering Coaching

Some retired players move into the coaching profession, so long-running saves grow their own staffing history — the catcher you drafted in year 2 might be a managerial candidate in year 14.

**Pipeline:**
- When a player retires (per 9.6), roll for a coaching career. Base chance ~10-15%, weighted up by: high makeup grade, catcher or middle-infield background (the classic manager pedigree), long careers, and modest-star-but-not-superstar status. Weighted down for low makeup.
- A retiree who enters the profession joins the coach pool 1-3 years after retirement, as a hitting or pitching coach candidate (by playing background) with a development modifier seeded partly from his makeup and work ethic.
- Coaches with strong results and reputation can graduate to manager candidates after ~3-6 years in the pool or on a staff. Their initial manager tendencies are colored by the era and style they played in.
- Name recognition matters: a beloved former star entering coaching gets reputation and hiring interest above his actual attributes — sometimes deservedly, sometimes not (the failed-legend-manager arc is a real baseball story).

**Phase note:** the retirement flag ("open to coaching") should be stamped at retirement time when Phase 5 progression/retirement ships, even though the coaching system itself is Phase 10 — otherwise early-save retirees can never enter the pipeline.

---

## 18. Offseason Flow

### 18.1 Offseason Overview

The offseason is the most decision-dense phase of each year. The flow:

1. World Series concludes (late October)
2. Awards announced (early November)
3. Retirements declared and processed
4. Manager/coach hiring window
5. International pool budgets assigned
6. Arbitration decisions
7. Free agency opens
8. Trade activity continues throughout
9. Spring training begins (late February)
10. Spring training position battles resolve
11. Opening Day (late March / early April)

Each phase has user decisions and AI activity. The user can advance through the offseason at their preferred pace using "advance day," "sim to next event," or specific phase navigation.

### 18.2 Phase 1: Postseason Conclusion (Late October)

The World Series ends. The engine generates a celebration event for the winning team. The user (if their team won) sees a championship summary screen with team stats, key performers, and a brief narrative recap.

If user's team didn't win, no special event — just the regular notification of season's end.

The league's offseason calendar is revealed: dates for awards, FA opening, trade deadline (next season), draft, etc.

### 18.3 Phase 2: Awards Week (Early November)

Major awards announced over a 5-7 day in-game window:

- **MVP** (each league)
- **Cy Young** (each league)
- **Rookie of the Year** (each league)
- **Manager of the Year** (each league)
- **Gold Gloves** (one per position, each league)
- **Silver Sluggers** (one per position, each league)
- **Reliever of the Year** (each league)
- **Comeback Player of the Year** (each league)

Each day, 1-2 awards announced. User receives notifications and can view voting results.

**Voting algorithm:**

For statistical awards (MVP, Cy Young, RoY), voting weights:
- Counting stats (HR, RBI, R, W, K, SV) heavily
- Rate stats (AVG, OBP, SLG, ERA, WHIP) significantly
- Team success modest bonus (winning team players favored)
- Narrative factors (e.g., comeback story, rookie status) small adjustments
- Random voter variance (each ballot has small noise)

This produces realistic voting where the "best player by stats" usually wins but not always — sometimes a player on a winning team with slightly lesser stats takes it over a stat-leader on a losing team. This mirrors real BBWAA voting tendencies.

For Gold Gloves: based on defensive ratings + range factor + errors. Some recency bias (current-season performance dominates).

For Silver Sluggers: best offensive season at each position.

### 18.4 Phase 3: Retirements (Mid-November)

Players age 33+ roll for retirement based on:

- Age (climbs steeply 36+)
- Performance (sub-replacement-level performance increases probability)
- Injury status (major injury at 33+ heavily increases probability)
- Career achievements (a player one year from a milestone often plays one more year)
- Random component

The user is notified of retirements across the league. User's own players retiring get a special notification with career retrospective screen.

Retirement is permanent. Retired players are eligible for HoF after 5 years.

### 18.5 Phase 4: Manager and Coach Hiring (Mid-November)

Teams announce manager firings (if any) and coaching staff changes. The hiring window opens.

- Fired managers and coaches enter the FA pool
- New first-year managers (from minor-league ranks) enter the pool
- Teams interview candidates and make hires

User's team activity:
- If user's manager was fired or contract expired, user enters the hiring process
- User can also choose to fire their manager during this phase
- User receives interview opportunities with candidates
- User makes offers and signs new manager/coaches

This phase typically resolves within 1-2 in-game weeks but can stretch to early December for high-profile candidates.

### 18.6 Phase 5: International Pool Assignment (November 1)

Each team's international bonus pool for the upcoming year is announced (calculation per 6.10). User sees their pool size displayed. This drives planning for the international signing window opening July 2.

### 18.7 Phase 6: Arbitration and Tendering (December)

For players in their arbitration years (3-5 years of service time):

- Engine calculates arbitration salary based on prior performance (simplified — no formal hearing)
- User sees the arbitration salary number
- User can:
  - **Tender** (accept the arbitration salary, retain player)
  - **Non-tender** (release player; they become FA immediately)
  - **Sign to extension** (negotiate longer-term deal in lieu of arb)

The user decides each player's fate. Cheap-owner teams will non-tender more aggressively (to control payroll). Win-now teams tender almost everyone.

> **Status (0.18.0) — shipped.** Arb salaries step toward market value
> AND ratchet off the prior salary (~12%/yr — arbitration never cuts
> pay), so a declining player's number climbs past his worth and the
> non-tender becomes a real decision. AI clubs non-tender when the
> salary outruns value by an owner-archetype threshold (cheap 0.95×
> … win-now 1.35×), before the FA market builds — ~10-30 non-tenders
> enrich the market each December, with news for the notable ones.
> The user's arb class is tendered by default (headless sims and
> skipped offseasons behave unchanged); every case stays open on the
> offseason dashboard (Review Arbitration) where a non-tender releases
> the player onto the live FA market immediately. Extensions in lieu
> of arbitration ride the existing Contract-tab extension flow.

For pre-arbitration players (under 3 years service):
- Salary is set at league minimum (or slight raise) automatically
- User can offer extensions

### 18.8 Phase 7: Free Agency (November–March)

Free agency opens about 5 days after the World Series. Activity follows the timeline in section 16:

- Heavy activity November-January (most signings)
- Moderate activity January-February (mid-tier and role players)
- Light activity into spring training (bargain pillow contracts)

Throughout this phase, trade activity continues in parallel. User receives notifications of league signings and trades. User can pursue their own targets.

The offseason calendar UI shows pending FAs by tier, the user's available payroll, and upcoming events.

### 18.9 Phase 8: Trade Activity (Continuous)

Trades happen throughout the offseason, peaking in December (winter meetings era) and slowing toward spring training.

User-initiated trades and AI offers come in continuously. Some trade categories common during offseason:

- **Salary dumps:** Cheap owners shedding veteran contracts
- **Win-now retooling:** Contending teams adding pieces around their core
- **Rebuild liquidations:** Rebuilding teams trading away remaining veterans for prospects
- **Closer market:** Closer trades happen offseason as contending teams shore up bullpens

### 18.10 Phase 9: Scouting Budget Decisions (December–January)

User reviews scouting tier for the coming year:

- Current tier shown with cost
- Upgrade/downgrade options with cost differential
- Owner archetype's stated preference
- Effect on other budgets

User decides. Owner approval applied per 6.9.3.

### 18.11 Phase 10: Spring Training (Late February–Late March)

Spring training opens. The phase is mostly automated:

- Position battles surface and resolve (engine evaluates ratings + recent performance)
- User can override resolutions
- Minor league level assignments confirmed (engine recommends; user overrides)
- Spring training injuries roll (low probability events)
- Final roster decisions made before Opening Day
- Last-minute FA signings happen

User can be highly engaged or hands-off during this phase. Most users will check in periodically.

### 18.12 Phase 11: Amateur Draft Class Generation (May)

In late May, the upcoming June 30 draft class is generated. Pre-draft scouting reports become available. Mock drafts begin appearing. The user can begin building their big board.

This phase falls during the regular season but is part of the long-cycle offseason flow. Most users will check the draft class in May/June and then make their picks on June 30.

### 18.13 Phase 12: Opening Day (Late March)

Opening Day arrives. Final 26-man rosters set. Season begins.

The user sees an Opening Day summary: season expectations (engine projection of team's record), key storylines for the team, schedule highlights.

The regular season begins.

### 18.14 Offseason Pacing and Flow

The user can choose how fast to move through the offseason:

- **Day-by-day:** Advance one day at a time. Heavy notification flow.
- **Skip to next event:** Sim until the next decision point or major event (next FA signing window, next trade offer, etc.)
- **Skip to next phase:** Sim through the whole current phase (e.g., skip remaining FA window if user is done signing)
- **Auto-handle minor decisions:** Toggle to auto-resolve low-stakes decisions (option assignments, minor roster moves) while pausing for significant ones

The offseason can be navigated quickly (advancing through dead phases) or savored (slowly working through FA negotiations). User preference drives pacing.

---

## 19. Awards and Hall of Fame

### 19.1 Award Categories (Annual)

The full list of annual awards (also covered in 18.3):

- **MVP:** One per league, position players and pitchers eligible
- **Cy Young:** One per league, pitchers only
- **Rookie of the Year:** One per league, rookies only
- **Manager of the Year:** One per league
- **Reliever of the Year:** One per league (not Cy Young — separate award)
- **Comeback Player of the Year:** One per league
- **Gold Gloves:** One per position per league (9 positions: C, 1B, 2B, 3B, SS, LF, CF, RF, P)
- **Silver Sluggers:** One per position per league (9 positions, with DH replacing P in DH league)

### 19.2 Voting Process Detail

**MVP voting:**
- 30 simulated voters, each ranking top 10 candidates
- Vote weights: 1st = 14 pts, 2nd = 9, 3rd-10th = 8 down to 1
- Each voter's ballot has small random noise on candidate ordering
- Top vote-getter wins; ties broken by 1st-place votes

**Cy Young voting:**
- Same structure, pitchers only
- Voters weight ERA, K, W, IP heavily; WHIP and BAA secondary

**Rookie of the Year:**
- Players in first year of MLB service eligible
- Same ballot structure, weighted toward season stats

**Manager of the Year:**
- 30 voters, 3 candidates per ballot (1st = 5 pts, 2nd = 3, 3rd = 1)
- Driven by team performance vs. expectations and team payroll context

**Gold Gloves:**
- Voted by a separate panel (managers and coaches)
- Defensive ratings + range factor + errors drive selection
- Some recency bias (full-season performance dominates)

**Silver Sluggers:**
- Best offensive season at each position
- Cumulative offensive value (OPS-driven)

**Reliever and Comeback awards:**
- Smaller voter panels, lower-stakes voting
- Reliever weighs SV/HLD heavily; Comeback weighs prior-year-vs-current improvement

### 19.3 Award History and Records

All awards are tracked in league history. Player profiles show:

- Career awards list with years
- All-time award leaders (most MVPs, most Cy Youngs, etc.)
- Season-by-season league award winners

These accumulate over the save's lifetime, building a fictional history that feels real after 10+ years.

### 19.4 All-Star Game

Mid-July All-Star Game:

- Each league fields a 32-player roster
- 9 starters per league chosen by fan vote (simulated based on player popularity = name recognition + team success + season stats)
- Pitchers (starting + bullpen) and bench players chosen by Manager of the league + commissioner office (simulated)
- Game is simulated as a single exhibition game; outcome doesn't affect standings
- All-Star MVP awarded
- All-Star selection counts as a season achievement on player profiles

User's players selected to the All-Star team get a notification. Multiple All-Star selections accumulate as career achievements (impacts HoF voting later).

### 19.5 Hall of Fame Eligibility

**Eligibility rules:**
- Player must be retired for 5 full seasons before first appearance on ballot
- Player must have 10+ seasons of MLB service to be eligible
- Eligible players appear on annual HoF ballot for up to 10 years
- If not elected within 10 years on ballot, drops off; eligible for veterans committee after additional 10 years
- Once elected, player is permanently in HoF

### 19.6 Hall of Fame Voting

Voting happens annually in January (between regular awards and start of next season).

**Voter pool:** 400 simulated voters per cycle.

**Voting weights** based on career achievements:

- Career counting stats (H, HR, RBI, R, SB for hitters; W, K, SV for pitchers)
- Career rate stats (AVG, OBP, SLG, OPS for hitters; ERA, WHIP for pitchers)
- Awards (MVPs, Cy Youngs, RoY counted)
- All-Star selections
- Postseason achievements (championships, playoff stats, postseason awards)
- Position scarcity (catchers, shortstops, CF favored slightly)
- Career length and durability
- Random voter variance

A player needs **75% of votes** to be elected. Most ballots elect 0-2 players. A loaded ballot with multiple HoF-quality candidates may elect 3-4.

### 19.7 Hall of Fame Categorization

Inducted players are categorized by their primary position. The HoF page shows:

- Recently inducted (last 5 classes)
- All-time inductees by position
- Voting results for each year
- Players currently on ballot with vote percentages

User-team players who reach the HoF generate a special celebration event.

### 19.8 Career Milestones and HoF Path

During a player's career, the engine tracks their HoF probability based on accumulated achievements. The user can view their player's "HoF case" via the player profile:
Comparable retired players
Stats relative to typical HoF thresholds
Estimated current HoF probability
This becomes increasingly meaningful for star players — watching their HoF case strengthen over years adds long-term narrative.

### 19.9 Hall of Fame Inflation and Standards

To prevent HoF inflation over a long save, voting standards are calibrated to produce roughly 2-4 inductees per year average. If a particular era produces excess star power, more get in; if a weak era follows, fewer.
Veterans committee (for players who fell off main ballot) inducts 0-1 players per year, usually long-overlooked candidates.
Over 30+ in-game years, the HoF accumulates a substantial fictional history — a fully-populated wing for each generation of players, with statistical tiers and storylines.



## 20. UI/UX Specification

### 20.1 Design Philosophy

The UI is the entire experience for the user. The simulation can be brilliant but if the interface is painful, the game fails. Three principles drive every UI decision:

**Mobile-first is non-negotiable.** Every screen, every interaction, every layout must work on a phone in portrait orientation. Desktop is a nice bonus but mobile is the primary platform. If a feature can't be made mobile-friendly, it gets cut or redesigned.

**Information density without clutter.** Baseball sims drown users in numbers. The UI must surface the *right* numbers prominently while keeping deeper data accessible without overwhelming. Default views are simplified; depth is one tap away.

**Minimum friction for common actions.** Advancing the day, viewing standings, checking the lineup — these happen constantly. They should be one tap from anywhere in the app.

### 20.2 Global Navigation

A bottom navigation bar is present on every screen (mobile-standard pattern). Five tabs:

- **Home:** Dashboard with today's date, team status, pending decisions, recent results
- **Team:** Roster, lineup, pitching staff, minor league system, scouting reports
- **League:** Standings, schedule, league leaders, awards, other teams
- **Games:** Today's games, recent box scores, upcoming series
- **Menu:** Settings, save management, advanced options, help

Each tab loads its own screen. Tabs persist scroll position when user navigates back. Navigation is single-tap from anywhere.

> **Status (0.16.2) — the nav evolved as systems shipped.** Bottom nav
> (six tabs): **Home**, **Team** (on-field: roster, lineup, pitching,
> minors), **League** (Scores — the Games tab folded in here in 0.13 —
> plus Standings with tap-through team pages, Playoffs, History),
> **Players** (league-wide player browsing: sortable season Stats for
> any club, league Leaders, and the Awards wing — season hardware, Hall
> of Fame, All-Star; split out in 0.16.1), **Draft** (the Draft Hub,
> incl. the international window), and **GM** (the front-office desk:
> Staff, Trades, Free Agents; split from Team in 0.16.2). The header
> carries the date/record stack on the left, the centered Advance Day
> pill, and the Menu (settings/save) button in the top-right — Menu
> left the bottom nav in 0.16.2 to make room for GM.

A persistent header at the top of every screen shows:
- Current in-game date
- User team's record
- Days until next major event (if applicable: trade deadline, draft, etc.)
- "Advance Day" button (primary action — large, easy tap target)

### 20.3 Home / Dashboard

The dashboard is the user's most-visited screen. It must answer "what's happening right now" at a glance.

**Layout (top to bottom):**

1. **Header strip:** Team logo, name, current record, division position
2. **Today's status card:** What's happening today — scheduled game (if any), opponent, time, starting pitcher
3. **Pending decisions banner:** If any decisions await user (injury, trade offer, FA negotiation), prominently displayed with tap-to-resolve
4. **Recent results:** Last 3-5 games with scores
5. **Standings snippet:** User's division standings (compressed)
6. **Quick actions:** Advance Day (primary), Sim to Next Event (secondary), View Roster, View Schedule
7. **News feed:** Recent league events relevant to user (major trades, injuries to division rivals, FA signings, milestones reached)

Vertical scroll throughout. Each section is a card that can be tapped for deeper view.

### 20.4 Team Section

The Team tab is the user's organizational management center. Sub-screens:

**20.4.1 Active Roster**
- Default view: 26-man roster as a vertical scrollable list
- Each player card shows: name, position, age, key stats (current season), key ratings (overall feel)
- Tap a player → Player Detail screen
- Filter/sort controls at top: by position, by performance, by age
- Lineup card view toggle: switch between roster and starting lineup view

**20.4.2 Lineup Management**
- Two lineups: vs RHP and vs LHP
- Drag-and-drop ordering (mobile: tap-and-hold then move)
- Defensive position assignments
- Designated hitter / pitcher's spot for appropriate league
- Save lineup; revert to manager's recommendation
- *Pillar 4:* edit affordances are interim (user-as-acting-manager).
  From Phase 10 this screen shows the manager's lineups read-only, with
  his reasoning surfaced where cheap (rest days, platoon calls per 17.7)

**20.4.3 Pitching Staff**
- Starting rotation (5 SP listed in order)
- Bullpen with assigned roles (closer, setup, middle, lefty specialist, mop-up)
- Drag/tap to reassign roles
- Pitching schedule preview (who pitches next based on rest)
- *Pillar 4:* same as 20.4.2 — editing is interim; from Phase 10 the
  manager owns rotation order and bullpen roles

**20.4.4 Minor League System**
- All minor leaguers listed by level (AAA / AA / A+ / A / Rookie)
- Each player card shows: name, position, age, level, current-season minor league stats, scouting report summary
- Tap a player → Player Detail screen
- Filter/sort by level, position, ceiling estimate
- Promotion candidates highlighted

**20.4.5 Scouting Reports**
- Top draft prospects (during pre-draft window)
- Top international prospects (during pre-window)
- Other organization's prospects (gated by scouting tier)
- Scouting tier display and management

### 20.5 League Section

**20.5.1 Standings**
- All 6 divisions displayed
- Default: collapse other divisions, expand user's division
- Win-loss, GB, run differential, last 10
- Wild card race displayed for non-leading teams
- Vertical scroll, tap a team for team detail

**20.5.2 Schedule**
- User team's schedule prominently displayed
- Calendar view toggle (week / month)
- Tap a game for box score (past) or game preview (upcoming)
- League schedule for other teams accessible

**20.5.3 League Leaders**
- Top-10 leaders in major categories (HR, AVG, OPS, K, ERA, etc.)
- Vertical scrollable cards
- Tap a player for full stats

**20.5.4 Awards**
- Current season awards (when applicable)
- Historical awards by year
- Hall of Fame inductees

**20.5.5 Other Teams**
- All 30 teams browsable
- Each team page: roster, recent results, key players, owner archetype, manager
- User can scout other teams' rosters subject to scouting tier restrictions on prospects

### 20.6 Games Section

**20.6.1 Today's Games**
- All league games in progress or scheduled today
- User team game prominently displayed at top
- Tap any game for the Game Detail view (20.6.4) once it has a final

**20.6.2 Recent Box Scores**
- User team's recent games with full box scores
- Other team's box scores accessible
- Each row is a tap target that opens the Game Detail view (20.6.4)

**20.6.3 Upcoming Series Preview**
- Next 3-5 series for user's team
- Opponent stats, probable starting pitchers, key matchups

**20.6.4 Game Detail View**

Any completed game is a tap target across the app and opens a Game Detail view (modal on mobile, side panel on desktop). The same view is reachable from:

- The Games tab — Today's Games and Recent Box Scores lists
- The dashboard's Recent Games card
- Team pages — recent games and schedule lists
- Team and league schedule views — past games
- Any other surface that lists a completed game

**Contents (in order, top to bottom):**

1. **Header** — final score, in-game date, both team names with caps, league/division context. Score line shows winning side first or with a clear winner indicator. Walkoff and extra-innings games are flagged.
2. **Inning summary** — line score (R/H/E per inning per side, plus row totals) when available. If the engine doesn't track per-inning runs at the time, this section gracefully omits.
3. **Batting box score** — per side, one row per batter who appeared. Columns: position, name, AB, R, H, RBI, BB, K, AVG (current season-to-date). Lineup order preserved. Pinch hitters and pinch runners (when those exist) get their own rows under their substitution point.
4. **Pitching box score** — per side, one row per pitcher who appeared. Columns: name, IP, H, R, ER, BB, K, HR, ERA (current season-to-date). Decision tags (W/L/SV/HLD/BS) shown next to the appropriate names.
5. **Team totals** — runs, hits, errors, LOB, double plays turned, plus team batting line (AVG/OBP/SLG for the game).
6. **AB-by-AB game log** — chronological at-bat list. Each entry shows inning, half, batter, pitcher, base/out state before the play, result (e.g., "K looking", "Single", "GIDP", "Walkoff HR"), runners advanced, RBI on the play, and the score after.

**Pitch-by-pitch logging is out of scope.** The game log is AB-by-AB only. Anything finer-grained (count, pitch type, location) is explicitly deferred indefinitely — the goal is a readable narrative, not a broadcast feed.

**Mobile layout:**
- Modal sheet that fills most of the viewport
- Vertical scroll throughout
- Sections are collapsible: header / line score always visible; box scores and game log can be tapped to expand or collapse to save scroll distance
- The AB-by-AB log appears last (longest section) and is collapsed by default

**Empty states:**
- Games that haven't been played yet show a Series Preview view (probable pitchers, recent meetings, season-series record), not the Game Detail view
- Older games whose AB-by-AB log has been cleared by season rollover (per 8.7) still show the box score and team totals; the AB-by-AB section displays a "Detailed log not retained for prior seasons" note

**Out of scope for this view:**
- Live in-game updates (games are simulated atomically)
- Defensive replays / shift visualizations
- Win probability charts

### 20.7 Player Detail Screen

The most-visited individual screen. Tappable from any player listing. Layout:

**Top:** Identity header — name, age, position, team, jersey number
**Section 1: Current season stats** — full stat line, splits (vs LHP / vs RHP)
**Section 2: Ratings** — visible ratings (with appropriate fog level)
**Section 3: Career stats** — year-by-year table
**Section 4: Career achievements** — awards, All-Star selections, championships, milestones
**Section 5: Contract info** — years remaining, AAV, salary, service time
**Section 6: Trade/extension actions** — propose trade including this player, offer extension (own players only)
**Section 7: Injury history** — past injuries with severity and recovery info

Vertical scroll throughout. Each section can be collapsed.

### 20.8 Decision Modals

When the engine pauses for user decisions, a modal appears with:

- **Decision context:** What's happening (e.g., "Pitcher Hernandez has injured his hamstring")
- **Severity/details:** (e.g., "Expected to miss 4-6 weeks; 60-day IL recommended")
- **Action options:** Buttons for each available choice (e.g., "Place on 60-day IL," "Send for further evaluation")
- **Auxiliary info:** Roster spots affected, recommended replacements, etc.

Modals are blocking — user must respond before continuing. They support quick acceptance ("OK, do the obvious thing") and deep engagement ("let me see all the options").

### 20.9 Trade Interface

The trade screen is the most complex single interface. Design:

**Top:** Selected target team
**Left side (scrollable):** Players user is offering — list of own roster, can be added to deal
**Right side (scrollable):** Players user wants — list of target team's roster
**Bottom:** Cash considerations slider, total value indicator (rough)
**Action button:** Submit Proposal

For mobile, this can be a vertically stacked interface: target team selection at top, then "I'm offering" section, then "I want" section, then cash + submit.

When proposal is submitted, AI response screen shows: accept / counter / reject with feedback. User can iterate.

### 20.10 Draft Day Interface

**Top strip:** Current round/pick, time remaining (if real-time mode)
**Main area:** Available prospects list, sortable and filterable
**Side panel:** User's big board, organization needs reminder
**Bottom:** Quick-pick buttons for top-rated remaining

When user's pick comes up, sim pauses with prominent notification. User selects.

### 20.11 Free Agency Interface

**Top:** Available payroll, current FA budget, days remaining in window
**Main:** FA pool list with sort/filter (by position, by asking price, by age)
**Tap an FA →** FA detail screen with asking price range, scouting report, prior offer history
**Action:** Make offer (years × value form)

### 20.12 Visual Design

**Color palette:** Each team gets primary and secondary colors generated at league creation. Used in headers, accent elements, badges. League-wide UI colors are neutral (dark grays, off-white) to allow team colors to pop.

**Typography:** A clean, readable sans-serif font for body text. A slightly bolder display font for stat numbers and headers. Large enough to read on a phone in bright light.

**Iconography:** Position icons for quick scanning (e.g., a small "C" for catcher, "SS" for shortstop). Status icons for IL, hot/cold streaks, milestones.

**Charts and graphs:** Minimal at launch. A few key visualizations — career stat trajectory, team performance over season — but mostly tabular data. Charts add complexity that's not essential.

### 20.13 Onboarding (First Game)

When the user starts a new game:

1. **Welcome screen:** Brief intro to the game
2. **Team selection:** User picks one of the 30 generated teams as their team. Each team shows: name, location, market size, owner archetype, current competitive window state
3. **Recommended teams:** UI suggests teams of various difficulty levels (small market = harder; rebuild state = longer arc; established contender = fast results)
4. **Tutorial pop-ups:** Brief contextual hints on first dashboard, first roster screen, first FA window — dismissible

Onboarding should take < 3 minutes total.

### 20.14 Settings and Save Management

Settings screen accessible from Menu tab:

- **Save management:** Export save, import save, start new game (with confirmation)
- **Display options:** Theme (light / dark), font size
- **Sim options:** Default sim speed (day / week / event), auto-handle minor decisions toggle
- **Advanced:** Debug info, version number, build info

### 20.15 PWA Installation Flow

When user first visits the game URL on a phone browser:

- A small banner suggests "Add to Home Screen for full experience"
- Tap shows browser-native install prompt
- After install, game opens fullscreen from home screen icon
- Subsequent visits feel like a native app

Manifest specifies icon (designed at multiple sizes), theme color, start URL, display mode (standalone), orientation (portrait).

### 20.16 Performance Targets

UI performance benchmarks:

- **Cold start (first page load):** < 2 seconds on average mobile (3G/4G)
- **Tab switch:** < 200ms (no perceptible delay)
- **Modal open:** < 100ms
- **List rendering:** Virtualized for lists > 50 items (don't render off-screen)
- **Sim a day:** < 1 second visible delay (heavy work runs async with progress indicator)

---

## 21. Build Order

### 21.1 Build Order Philosophy

The build order is structured so that each phase produces a working, testable product. Don't build everything at once — build foundational systems, verify they work, then build on top.

Each phase is defined by:
- What gets built
- What "working" looks like at end of phase
- What's deliberately deferred

This approach is essential for AI-assisted coding: each phase keeps complexity manageable and provides natural testing checkpoints.

### 21.2 Phase 1: Foundation (Estimated: First major build session)

**Goal:** A working data model with league/team/player generation and a basic UI that displays them.

**Build:**
- Project structure (per 2.2)
- HTML scaffolding, CSS reset and base styles, mobile-first layout
- State management (in-memory game state, save/load, JSON serialization)
- League and team generation (30 teams, divisions, ballparks with park factors)
- Player generation (initial league population — ~2,250 players with all schemas)
- Name generators (city pools, name pools)
- Basic dashboard UI displaying team info
- Basic roster display

**End-of-phase test:**
- User can start a new game
- 30 teams generated with proper distribution
- ~2,250 players exist with correct schemas
- User can view their team's roster
- Save/load works

**Deferred:**
- All simulation
- All systems beyond basic team/player display

### 21.3 Phase 2: Simulation Engine (Estimated: Major build session)

**Goal:** Working game simulation that produces realistic stats.

**Build:**
- At-bat resolution engine (per 7.3)
- Pitcher fatigue (per 7.4)
- Stolen bases and small ball (per 7.5)
- Defense and errors (per 7.6)
- Park factor application (per 7.7)
- Season schedule generation (per 3.2)
- Day-by-day simulation engine
- Box score generation
- Stat aggregation (per 8.7)
- Standings calculation

**End-of-phase test:**
- User can advance days
- Games simulated produce realistic box scores
- Stats accumulate to roughly target league averages over a season
- Standings update correctly

**Tuning required:** This phase ends with a calibration sub-phase. Run 10,000 games, verify averages, adjust constants. Iterate until target league averages emerge.

**Deferred:**
- All offseason systems
- Manager tendencies (use defaults)
- Injuries

### 21.4 Phase 3: Roster and Lineup Management (Estimated: 2 sessions)

**Goal:** User can manage their active roster and lineup throughout a season, and the engine pitch-count behaviour matches the stamina tier contract in 7.4.

> **Pillar 4 note.** The direct lineup/rotation/bullpen editing built in
> this phase is an *interim* control surface — the user acting as their
> own manager until the manager system exists. In Phase 10 those screens
> become views of the manager's decisions and direct editing is retired
> (per 17.7). Build them accordingly: the rendering is permanent, the
> edit affordances are not.

**Build:**
- 26-man roster management
- 40-man roster
- Options and service time tracking
- Lineup construction (vs RHP / vs LHP)
- Pitching staff management (rotation, bullpen roles)
- Bullpen role labels (closer, setup, middle, lefty specialist, long
  relief, mop-up — per 7.8) wired to user controls
- Pitcher stamina tier rollout (per 7.4)
  - Tiered effective pitch limits replacing the simplified
    stamina-vs-pitch-count rule
  - Dynamic pull threshold using efficiency bonus and trouble penalty
  - Per-tier per-pitch decay of stuff / velocity / control
  - Complete-game eligibility gating
  - Quality-weighted bullpen leverage (top setup man works close-game
    high-leverage outs; long man eats blowouts and extra innings)
- AB-by-AB game log capture (per 8.7.1) — extend `game.result` with a
  `gameLog` array; one entry per plate appearance with inning, half,
  batter id, pitcher id, base/out state, result, runner advancement,
  RBI on the play, score after
- Game Detail view (per 20.6.4) — modal opened from any completed
  game across the Games tab, dashboard recent games, team pages, and
  schedule views; renders header / line score / batting box /
  pitching box / team totals / AB-by-AB log
- Daily roster decisions (basic flow)
- Player detail screen (full implementation)
- Mobile-friendly roster UI

**End-of-phase test:**
- User can set lineups, rotation, bullpen roles
- Changes persist across days
- Stats track correctly per player
- UI works on mobile
- Pitcher stamina validation targets in 7.4.7 are met:
  - Avg starter IP/start in 5.5–6.5
  - Workhorses exceeding 7 IP/start exist but are rare
  - Top setup arms ~60–75 G, long men ~30–45 G
  - Closers ~25–40 SV
  - Complete games uncommon
  - No stamina tier behaving outside its intended role
- Every completed game in the schedule (user's and AI's) has a
  retrievable AB-by-AB log
- Game Detail view opens from every entry point listed in 20.6.4 and
  renders correctly on mobile

**Deferred:**
- Advanced manager tendencies
- Auto-handle decisions
- Mid-season trades / FA
- Season-rollover cleanup of AB-by-AB logs (lands in Phase 15 — see
  21.16 — because rollover only fires during the offseason flow)

### 21.5 Phase 4: Injury System (Estimated: 1-2 sessions)

**Goal:** Realistic injuries with IL management, plus position-player fatigue.

**Build:**
- Injury rolls during games (per 10.1, 10.2)
- Injury severity tiers (per 10.3)
- IL types (10-day, 15-day, 60-day, season-ending)
- Career-altering injuries (rare, with ceiling reduction)
- Injury history tracking
- IL UI flow (place on IL, activate from IL, rehab assignments)
- Position-player fatigue/stamina (per 10.8)
  - Per-game fatigue accumulation (start vs. bench appearance)
  - Off-day and rest-day recovery
  - Catcher and age modifiers
  - Performance penalty at moderate fatigue
  - Injury-risk multiplier at high fatigue (uses injury-proneness)
  - Soft "rest recommended" notification at very high fatigue

**End-of-phase test:**
- Players get injured at realistic rates
- IL management works correctly
- Career-altering injuries reduce ceilings appropriately
- Everyday position players accumulate fatigue across a typical week
  and recover with off-days
- Very fatigued players trigger rest-recommendation notifications
- Fatigue is handled in the background; the user is never forced to
  micromanage a fatigue meter

**Deferred:**
- Specific injury type narrative variations (basic types only at first)
- Pinch-hitter / pinch-runner-only fatigue distinctions (treat any
  bench appearance as the same low-fatigue event for now)

> **Status (0.8.0).** Stage 4 IL roster transactions are in: an IL-type
> injury moves the player off the 26-man onto the team IL list and the
> best minors fit is called up automatically (position-matched for
> catchers); activation reverses the move, sending the call-up cover
> back down. Auto-handled for every team with news for the user's —
> a richer prompt-driven decision flow (bible 11.6) remains open.
> Options tracking, DFA/waivers, and September expansion are still
> deferred (Phase 8+ territory).

### 21.6 Phase 5: Progression System (Estimated: 1-2 sessions)

**Goal:** Annual player development working with archetypes.

**Build:**
- Archetype assignments at player generation
- Annual progression cycle (per 9.1)
- Archetype curves (per 9.2)
- Modifiers (level appropriateness, coaching, work ethic, injuries — per 9.3)
- Volatility / random variance (per 9.4)
- Ceiling adjustments over career (per 9.5)
- Retirement logic (per 9.6), including the "open to coaching" flag
  stamped at retirement (per 17.9) so early-save retirees can enter the
  Phase 10 coaching pipeline

**End-of-phase test:**
- After multiple simulated years, players progress according to their archetypes
- Different archetypes produce visibly different career arcs
- Retirements happen at realistic rates and ages

**Deferred:**
- Coaching staff effects (use placeholder modifiers until coaching system built)

> **Status (0.8.0).** Shipped: annual progression with per-archetype
> curves (rise/plateau/decline, late-bloomer breakouts, one-year-wonder
> spike/reversion), work-ethic / injury / level-appropriateness
> modifiers, volatility, ceiling enforcement, aging, and retirement with
> the 17.9 open-to-coaching flag. Coaching modifiers remain placeholder
> (Phase 10). Runs inside the season rollover.

### 21.7 Phase 6: Minor League System (Estimated: 1 session)

**Goal:** Functioning minor league depth with development tracking.

**Build:**
- 5-level minor league structure (per 12.1)
- 30-player roster cap per organization
- Annual stat simulation per minor leaguer (per 12.2)
- Level-average baselines and stat noise (per 12.3, 12.4)
- Promotion mechanics (per 12.5)
- Minor league UI (rosters, stats, development tracking)

**End-of-phase test:**
- 30 minor leaguers per team distributed across levels
- Stats simulated annually with realistic noise
- Promotions/demotions work
- UI lets user view and manage minor league system

**Deferred:**
- Rule 5 draft (small mechanic, can wait)

> **Status (0.8.0).** Shipped: annual summary stat lines per level with
> level-scaled noise (12.2/12.3, stamped at rollover on
> `stats[year].minorsLine`), offseason level reassignment (12.4), the
> 30-man cap with fringe releases to the FA pool (12.8), and interim
> org backfill via generated depth signings (stands in for the draft
> and minor-league FA until Phases 9/11). Not yet: in-season
> proportional stat display, minor-league FA market (12.6), Rule 5.

### 21.8 Phase 7: Stats System Polish (Estimated: 1 session)

**Goal:** Full stats display and league leaders.

**Build:**
- All stat calculations (per 8.2, 8.3)
- Career stats aggregation
- Splits (vs LHP / vs RHP, home/road, pre/post-AS)
- League leaders (top-10 lists)
- Milestones tracking (per 8.6)
- Career retrospective screens
- Mobile-friendly stat displays

**End-of-phase test:**
- All stats visible and correct
- League leaders update properly
- Milestone events trigger correctly
- Mobile displays clean and readable

> **Status (0.8.0).** Shipped: career aggregation at each rollover,
> milestone tracking with news (8.6), postseason stat lines on a
> separate `stats[year].postseason` bucket, career/minors/postseason
> rows and championships/milestones on the player profile, and a
> League → History tab (champions by year). Not yet: splits
> (vs L/R, home/road), career-bests table, All-Star selections.

### 21.9 Phase 8: Trade System (Estimated: 1-2 sessions, includes tuning)

**Goal:** Working trade system with AI evaluation.

**Build:**
- Player Trade Value calculation (per 15.3)
- Team-specific modifiers based on competitive window state (per 15.4)
- Owner archetype effects on trade behavior
- Trade proposal interface (per 20.9)
- AI evaluation logic
- AI-initiated trade offers
- AI-AI trades (background)
- Trade history tracking

**End-of-phase test:**
- User can propose trades; AI accepts/rejects/counters reasonably
- AI initiates offers based on team needs
- League trade activity feels realistic

**Tuning required:** Trade values often need iteration. After first build, simulate 5 seasons of trade activity, evaluate whether resulting roster movements feel realistic. Adjust modifiers as needed.

**Deferred:**
- Three-team trades, draft pick trades (per 15.2 deferrals)

> **Status (0.9.0).** Shipped: Trade Value engine (15.3) with window/owner
> modifiers (15.4), user proposal flow with accept/counter/reject and
> directional feedback (15.5/15.6), counter suggestions, cash up to $20M
> each way, structural trade validation (catcher/SP floors, position
> coverage — with a self-healing rebuild after execution), AI-AI
> background trades with a deadline-week surge (15.7/15.10), unsolicited
> AI offers to the user (viewable in Team → Trades), trade history
> (15.11) and per-player "Acquired via" lines. Not yet: information
> asymmetry on prospects (needs Phase 13 scouting fog), multi-round
> AI counter iteration, three-team/pick trades.

### 21.10 Phase 9: Free Agency System (Estimated: 1 session)

**Goal:** Functioning offseason FA market.

**Build:**
- FA pool generation (each offseason)
- Player asking prices (per 16.4)
- Bidding process (per 16.5)
- Player preferences (per 16.5)
- AI team FA behavior (per 16.7)
- Failed FA / late signings (per 16.8)
- Contract extensions (per 16.11)
- FA UI (per 20.11)

**End-of-phase test:**
- User can sign FAs each offseason
- AI competes appropriately
- Contract values feel realistic
- Extensions work

> **Status (0.9.0).** Shipped: the offseason now pauses at an interactive
> free-agency window (16.1) — the market builds from genuinely expired
> contracts (6+ service years reach FA per 11.4; team-control players
> renew with automatic arbitration raises at 3-5 years), asking prices
> with ranges and player preferences (16.4/16.5), round-based bidding
> where stars sign first (18.8) against AI teams gated by needs, payroll
> room, and owner archetype (16.7), a rival-bid "you'd need to top ~$X"
> signal (16.6), eroding asks and late-round pillow contracts (16.8),
> mid-season minor-league signings (16.9), extensions from the player
> profile (16.11), and payroll tracking against the team budget.
> Measured: ~60-190 FAs per class, most signed within the window, stable
> league population, and the R/G talent drift from 0.8.0 is gone (FA
> recycling holds the run environment at ~4.6-4.7). Not yet: released
> players / dead money (16.12), qualifying offers (16.10, skipped by
> design), FA preferences shown in scouting reports.

### 21.11 Phase 10: Manager and Coach System (Estimated: 1-2 sessions)

**Goal:** Every team run day-to-day by its own manager (Pillar 4 — the
user becomes a pure GM), with hireable staff carrying mechanical effects.

**Build:**
- Manager and coach generation (with attributes per 17.2, 17.4)
- Manager archetypes (per 17.3)
- All 30 teams assigned a manager at league generation, plus the
  standing unemployed pool (~8-12 managers, ~15-20 coaches — per 17.6)
- Owner archetype hiring preferences (per 17.5)
- Hiring/firing logic (per 17.6)
- Hiring interface
- Manager tendency effects on game simulation (revisit 7.8) —
  parameterize the existing engine decision logic (lineups, auto-rest,
  bullpen leverage, pull thresholds) by each manager's tendencies
  rather than rewriting it
- **Manager takes over the user team's day-to-day (per 17.7):** the
  Phase 3 lineup/rotation/bullpen editing screens become views of the
  manager's decisions; direct editing is retired for the user team
- Retired-player coaching pipeline (per 17.9) — consume the
  "open to coaching" flags stamped since Phase 5
- Coach development modifiers (apply to progression — revisit phase 5)

**End-of-phase test:**
- Every team, including the user's, has a manager making lineup,
  rotation, bullpen, rest, and tactical decisions per his tendencies
- Two managers with different styles produce visibly different usage
  patterns from the same roster
- User can hire/fire manager and coaches; unemployed pool refills
  believably (firings, minor-league candidates, notable retirees)
- Coach modifiers affect player development

**Deferred:**
- GM organizational directives (light nudges per 17.7) — optional
  refinement once manager control feels right

> **Status (0.10.0) — Pillar 4 delivered.** Every team, the user's
> included, is run by a manager with archetype-driven tendencies:
> lineup construction (old-school speed-first vs modern OPS-stacked
> ordering), small-ball (sac bunts finally exist — pitchers bunt
> classically in the West, small-ball skippers bunt close-and-late;
> measured ~55 SH/team West, ~12 East — plus SB aggressiveness),
> quick hook (pitch-limit leash, complete-game appetite), and bullpen
> leverage (closer in the 8th and wide setup windows for matchup
> managers, strict 9th-inning closers for role-rigid ones). The all-5
> "league-average manager" reproduces the pre-Phase-10 engine exactly,
> so old saves behave identically until staff exists (auto-staffed on
> load). Direct lineup/rotation/bullpen editing is retired — those
> screens are read-only views with the manager's byline; the GM's
> minors promotions trigger the manager to re-set his own lineup.
> Coaches carry real development modifiers into progression (strongest
> for under-27s). Owners fire managers (patience by archetype), fired
> staff join the standing pool, retirees with the 17.9 flag enter
> coaching 1-4 years out (name recognition inflating reputation),
> veteran coaches graduate to manager candidacy, and the user hires
> from the pool via Team → Staff during the offseason (auto-filled by
> the owner at Opening Day if ignored). Not yet: pinch-hitting /
> defensive-replacement tendencies (need in-game substitutions),
> in-season firings, Manager of the Year (Phase 14), coach
> specialty-specific rating bonuses.

### 21.12 Phase 11: Amateur Draft (Estimated: 1 session)

**Goal:** Annual draft event with full mechanics.

**Build:**
- Draft class generation (per 6.5, 13.3)
- Class strength variation
- Pre-draft scouting reports (gated by scouting tier)
- Mock drafts and rankings
- Draft order calculation (reverse standings)
- Draft day execution (per 13.5)
- AI team draft behavior (per 13.6)
- Signing bonuses (simplified)
- New prospects integrated to organization
- Draft UI (per 20.10)

**End-of-phase test:**
- Annual draft executes on June 30
- User picks function correctly
- AI teams pick reasonably based on archetypes
- Drafted prospects appear in organization

> **Status (0.11.0) — shipped, with a standalone Draft Hub.** The draft
> got its own bottom-nav tab (a deliberate upgrade over 13.9's modal-only
> spec — the draft is a pillar event and the hub carries the full annual
> arc): offseason countdown + draft history, May–June class preview
> (class-strength blurb, weekly-refreshed round-1 mock draft, filterable
> big board with scouted ceiling bands, personal target flags), the June
> 30 draft room (on-the-clock strip, live pick tracker, scouting
> recommendation, tap-to-draft, quick-draft "Sim to My Pick", full
> auto-draft), and a post-draft recap (your class, round 1 results,
> signing fallout). Engine: ~300-prospect classes generated May 1 with
> strength -2..+2 and best-tool ceiling bands per 6.5 (additive shift —
> top picks have real weaknesses, not 80s across the board), 30%/70%
> HS/college age mix with school names, reverse-standings order (13.2, no
> lottery/comp picks), owner-archetype AI behavior incl. reaches and
> signability seniors (13.6), slot-value bonuses and per-round signing
> rates (13.7, late-round HS picks honor college commitments at higher
> rates), round+age-based minors assignment (13.8), and a hidden ~5%
> late-round gem. Signing applies a hidden "development reality" shift
> (busts outnumber surprises; HS wider) so the scouted band on the
> profile reads as the projection it was. The sim hard-stops on June 30
> until the draft runs; the harness auto-drafts. Draft provenance
> ("Drafted 2027 R1 P3 by NOR, $8.2M bonus") shows on player profiles;
> state.draftHistory archives condensed classes. Population balance
> reworked alongside: the farm-cap cut now values ceiling+youth, young
> fringe releases leave the game instead of pooling, and unsigned
> veteran FAs wash out faster. Not yet: scouting-tier-gated report
> depth/fog (Phase 13), pick trading, draft lottery, compensation picks.
>
> **Amended (0.17.0) — HS draftees arrive raw.** The HS current-rating
> gap off the ceiling deepened (24→29, wider variance, current tools
> hard-capped at 48): a 17-18-year-old lands in the 30s / low 40s on
> draft day instead of near 50, so he starts at Rookie/A instead of AA.
> Ceilings — the thing the pick is FOR — are untouched, so draft value,
> the star pipeline, and the talent-pyramid calibration hold. Paired
> with 12.4's youth ceiling on level placement.

### 21.13 Phase 12: International Signings (Estimated: 1 session)

**Goal:** Annual international signing window.

**Build:**
- International pool generation (per 6.7, 14.1)
- Pool budget assignment (per 6.10)
- Pre-window scouting (gated by scouting tier)
- Signing window execution (per 14.3)
- AI team international behavior
- Special international events (Japanese postings, Cuban defectors, Korean declarations)

**End-of-phase test:**
- Annual international class generates
- Pools assigned correctly
- User can sign prospects
- Special events fire occasionally

> **Status (0.13.0) — shipped, living beside the draft in the hub.**
> The Draft Hub gained an Int'l tab carrying the whole cycle: the
> ~100-prospect class and pool budgets are set at the rollover (14.1's
> November 1; season 1 falls back to opening day), scouted all
> offseason and spring with wide teenage bands, country/age mix per
> 6.7, and target flags. The sim halts July 2 — two days after the
> draft — for the interactive three-phase window (14.3): top-10
> bidding against AI clubs (owner-archetype appetite; patient/
> analytics owners chase hardest), mid-tier signings at ask, bulk
> depth, with an auto-run escape hatch. Pool budgets follow 6.10's
> reverse-standings tiers ($9.0M→$4.0M, small-market +$0.5M / large
> −$0.5M), automatic 25% carryover of unspent pool, and the 6.10.4
> overspend ladder (fine → reduced pool → halved pool → 2-year
> $300K restriction); AI teams never overspend — going over is a
> user-only strategic choice. Signees join Rookie ball (14.5) with a
> wider signing-day development swing than draft picks. Special
> events (14.7) ride the FA market as offseason headliners: 0-3 NPB
> postings (25-30, MLB-ready), 0-2 Cuban defectors (extra hidden
> variance), 0-1 KBO declarations. Provenance shows on profiles
> ("Int'l Signing 2027 • Dominican Republic • rank #3 • $4.1M").
> Not yet: scouting-tier-gated pool visibility (Phase 13 — bands are
> honest today), pool-space trading, user-chosen carryover timing,
> posting fees as a separate cash mechanic.
>
> **Amended (0.17.1) — country name pools.** International prospects
> and event players draw from origin-appropriate name pools
> (js/data/intl_name_pools.js, all-fictional combinations): a shared
> Latin pool for the Spanish-speaking countries, plus dedicated
> Japanese, Korean, Taiwanese, and Dutch-Caribbean (Curaçao) pools.
> Australia keeps the default draw. Loading a save with a pending
> class renames the unsigned pool in place; already-signed players
> keep the names their history was written under. The harness fails
> any signee whose name doesn't come from his country's pool.

**Goal:** Tiered scouting affecting information visibility.

**Build:**
- 4-tier scouting budget system (per 6.9.2)
- Visibility rules (per 5.7)
- Owner archetype default tiers (per 6.9.4)
- Annual tier selection during offseason (per 6.9.3)
- Fog reduction through career progression (per 5.7.3)
- Apply visibility to all relevant UI surfaces

**End-of-phase test:**
- Different tiers produce visibly different scouting reports
- Self-scouting fog works correctly
- Other-team prospect visibility gated appropriately
- Owner approval mechanics function

> **Status (0.15.0) — shipped.** engine/scouting.js owns the system:
> four tiers at 6.9.2's costs, billed against the same ownership budget
> as payroll (an elite department leaves ~$22M less FA room than bare
> bones — the 6.9.1 trade-off is real for AI clubs too). Teams generate
> at their owner's default tier (6.9.4); the user requests changes each
> offseason from the Staff tab's Scouting Department card, with 6.9.3
> approval odds by archetype (one step per winter; old-school and cheap
> owners resist elite; cheap owners may cut the budget after losing
> seasons — with news). Fog per 5.7: deterministic per (team, player)
> bands that are NOT centered on truth — a bare-bones department is
> more often wrong, not just vaguer. Applied surfaces: player-card
> ratings/OVR render as bands (or "no book on him"), own-farm minors
> rows show band overalls, and the draft/intl pool bands widen or
> tighten by tier with visibility depth cutoffs (standard sees the
> draft class thinly; bare bones sees ten names; the intl bottom-70
> stays dark for everyone below elite). AI draft-day discipline is
> tier-driven (13.6): elite boards pick near consensus, bare-bones
> boards reach. MLB players, FAs, staff, and league stats stay public
> (6.9.6). Not yet: scouting notes flavor text (5.7.4), fog-gated trade
> evaluation UI (6.9.5 — the player card already fogs, but trade values
> quoted by the engine are true), archetype hints at high tiers.
>
> **Amended (0.16.3), deviating from 5.7.2 by design decision:** the
> user's OWN organization is never fogged — a GM knows his own farm
> (his players, his coaches, his instructional staff). Scouting tiers
> gate only the outside world: rival farm systems, the draft class,
> and the international pool.
>
> **Amended (0.18.1) — potential on the player card.** The ratings
> grid's open corner shows the scouts' development projection
> (scouting.js `potentialBand`): a 20-80 range that is NEVER exact —
> even your own staff is projecting — whose width tightens with the
> scouting tier (elite ±3 → bare bones ±8, wider again on fogged
> players; "??" where there's no book at all). The center is the
> stable per-(team, player) offset, so it isn't centered on truth.
> Remaining upside fades linearly from age 22 to 28 — a veteran's
> potential reads as what he already is — and for publicly-visible
> players the floor never dips below the current overall.

### 21.15 Phase 14: Awards and Hall of Fame (Estimated: 1 session)

**Goal:** Annual awards and HoF system.

**Build:**
- All annual award voting (per 19.2)
- All-Star Game (per 19.4)
- HoF eligibility tracking (per 19.5)
- Annual HoF voting (per 19.6)
- HoF UI and history pages
- Player profile achievement display
- Career retrospective on retirement

**End-of-phase test:**
- Awards announced annually with sensible winners
- HoF inductions happen at realistic rates
- All-Star Game functions
- Long-term history accumulates

> **Status (0.16.0) — shipped.** js/engine/awards.js carries all three
> systems. **Annual awards (19.1/19.2):** simulated ballots (30 voters,
> 14-9-8…1 points, per-ballot noise) for MVP / Cy Young / RoY per league,
> with team-success halo and the traditional pitcher-MVP discount; smaller
> panels for Reliever and Comeback (Comeback requires established → lost
> year → return, so sophomore breakouts don't steal it); Manager of the
> Year from record-vs-expectation + payroll context + reputation (winning
> bumps the manager's rep, per 17.8); Gold Gloves from defense/arm ratings
> per position (control proxies pitcher fielding) and Silver Sluggers from
> offensive value — the DH league gets a DH slugger, the pitchers-bat
> league a pitcher slugger from the batting lines. Voting runs at the
> rollover before retirements; winners stamp p.achievements.awards and
> archive to state.history.awards[year]. **All-Star (19.4):** fires on the
> schedule's built-in July 14 break; 32-man rosters per league (9 fan-vote
> starters from production + name recognition + team success, 8 SP + 4 RP
> + bench by merit), stats-neutral exhibition result, All-Star MVP,
> selections stamped as career achievements. **Hall of Fame (19.5/19.6):**
> ballot = retired 5 full seasons + 10 service years, 10 years of
> eligibility, 400-voter share from a logistic over a career score
> (counting stats, rate stats, awards, All-Star count, rings, position
> scarcity, ballot momentum), 75% elects, max 4/class; veterans committee
> considers 20-years-retired dropped candidates (0-1/yr). Original-
> generation vets carry pre-save service with no stat history, so counting
> stats are pro-rated (capped 2.5×) toward full service length. UI:
> League → Awards (Season Awards / Hall of Fame / All-Star views),
> HoF banner + All-Star line on the player card, award/HoF/All-Star news,
> career-retrospective lines in user-team retirement news.
>
> **Measured (16-season soak, seed 1):** every season fills MVP/Cy/RoY/
> Reliever/MoY in both leagues plus 8-9 Gold Gloves and 9 Silver Sluggers;
> repeat winners emerge naturally (a 4× MVP, multiple 3× Cy Youngs).
> All-Star Game plays all 16 years (64 selections/yr). HoF: first ballots
> form in year 6 (15 candidates), first class in year 11 once real careers
> complete in-save, then a steady 2-3 inductees/yr (13 members by year 16,
> pct range 75.8-100%) — inside 19.9's 2-4/yr target; the empty early-era
> Hall is the expected cost of not fabricating pre-save careers. Zero sim
> errors or invariant violations across the soak; probe (10 seasons)
> verifies 32-man rosters, no double selections, single stamps, and
> HoF eligibility invariants daily.

**Goal:** Full offseason cycle integrating all systems.

**Build:**
- Phase-by-phase offseason structure (per 18)
- Sim controls (advance day, sim to event, sim phase, auto-handle)
- Notification flow during offseason
- Spring training mechanics (per 11.8)
- Opening Day transition
- Season rollover cleanup
  - Clear AB-by-AB game logs for every game from the just-completed
    season (per 8.7.1) — preserve final scores, line scores, team
    records, player season totals, team season totals, and league
    history summaries
  - Verify the Game Detail view's "Detailed log not retained for
    prior seasons" empty state renders correctly for any historical
    game after rollover
  - Fast-forward every injury recovery clock (`ilStatus.daysRemaining`,
    `dayToDayDaysRemaining`) by the calendar days the rollover skips,
    so long injuries heal on calendar time (per 10.5 — without this a
    Tommy John takes 2-3 in-game seasons instead of 14-18 months)

**End-of-phase test:**
- Full offseason flows correctly
- All major events fire at right times
- User can navigate at preferred pace
- Transition to new season seamless
- After rollover, save size returns to baseline (no AB-log carryover
  from the year being closed out)
- Historical Game Detail views still render box scores from season
  totals; AB-log section shows the empty-state note

> **Status (0.9.0) — rollover now pauses for free agency.** When the
> user advances past the last regular-season day, the game plays the
> full 12-team postseason (3.4, postseason stats on their own bucket),
> runs the November offseason (minors season lines, career aggregation
> + milestones, retirements, progression, aging, service time,
> contract ticks with real FA expiration per 11.4), then STOPS at the
> interactive free-agency window — the user browses the market, makes
> offers, and advances signing periods at their own pace (or skips
> straight to Opening Day). "Start Season" finishes the rollover:
> remaining FA resolution, injury-clock fast-forward (10.5), minors
> level moves + 30-cap, org backfill, config rebuild, fresh schedule.
> Interim placeholders for later phases: no awards voting (Phase
> 14), postseason injuries don't carry over, prior-season game data
> archives to a summary. (Resolved since: manager hiring shipped in
> 0.10.0; the 0.11.0 draft replaced generated-signing backfill as the
> talent pipeline — generation remains only as a rare emergency
> fallback when an org can't field a legal roster.)
>
> **Measured (12-season soak, tools/season_harness.js):** zero stat
> invariant violations across ~29,000 games, league readiness valid
> every year, 10 distinct champions in 12 seasons, retirement wave
> settles at ~85-95/yr, save ~8 MB after 12 years. Watch items for
> the talent-pipeline phases (9/11/12): league R/G drifts from ~4.7
> to a stable ~4.3 by year 4 as starless generated backfill replaces
> the original talent tiers (the draft must supply star-tier ceilings
> to hold the run environment), and the 26-man age-vs-overall curve
> declines monotonically instead of peaking at 26-29.
>
> **Status (0.18.0) — Phase 15 complete.** The full offseason cycle
> per 18.1, in the established compressed form: postseason (day-by-day
> or one-shot) → rollover Part A (awards week, retirements, HoF vote,
> staff + scouting windows, arbitration with AI non-tenders, intl
> events + class, FA market build) → the interactive winter (FA rounds
> that advance the calendar ~12 days each with parallel trade activity;
> arbitration reviewable from the dashboard; staff/scouting/trades all
> open) → Start Season (spring training per 11.8, Opening Day report
> per 18.13, Part B cleanup). The dashboard carries an offseason
> calendar card — WS result, awards week, HoF class, winter meetings,
> arbitration (with the Review flow), FA progress, spring training —
> and offseason news items are dated onto the real calendar (awards
> Nov 3-8, retirements Nov 10, non-tender deadline Dec 2, HoF Jan 15)
> so the feed reads like a winter. New interactive decision: 18.7
> tendering. New color: 11.8 camp battles/injuries + the Opening Day
> projection. Rollover cleanup items (AB-log pruning, injury-clock
> fast-forward, archived game detail empty states) shipped in earlier
> phases and are re-verified by the e2e each run.
>
> **Re-measured (0.11.0, 10-season soak with the draft live):** the
> R/G watch item is resolved — the run environment holds 4.5-4.8 for
> ten straight seasons because draft classes supply the star ceilings
> the backfill couldn't. Talent pyramid lands near the 4.3 target
> (~60-75 players at 60+ overall; with the 0.13.0 international
> pipeline live it measures 57-81 across seeds — a second star source
> runs the pyramid a touch hotter, partially offset by a bust-heavier
> signing-day swing for intl signees; keep measuring in Phase 13/14
> soaks). New watch items for Phases 12-14:
> the FA pool settles higher than pre-draft (~250-330; farm-cap
> releases now feed it — unemployment-spell washout keeps it bounded),
> and 34+ veterans thin out to a handful as cheap draft talent crowds
> out the back end of aging curves (real dynamic, slightly stronger
> than MLB; revisit when awards/legacy incentives arrive in Phase 14).

### 21.17 Phase 16: Polish and Iteration (Ongoing)

**Goal:** Tune, fix, polish.

This is not a single phase but an ongoing process. Activities include:

- Engine tuning based on multi-season simulations
- UI polish based on actual mobile usage
- Edge case handling
- Save migration (if any data model changes)
- Performance optimization
- Bug fixes as discovered

**The game is "done" when it's playable and enjoyable. There is no final ship date — the user iterates indefinitely.**

> **Status (0.19.0) — first full balance pass.** Driven by observed
> problems in live saves and re-measured across multi-seed soaks:
>
> - **Speed decoupled from the talent tier (5.6/6.4 amendment).** Tool
>   ceilings all drew from one shared tier mean, so every star was a
>   plus runner: measured +0.54..+0.72 speed-power correlation at every
>   generation source, fifteen 30/30 seasons a year, and a 94-steal /
>   45-HR league leader. Speed is now drawn independently of the tier
>   (position-shaped, body-trait), anti-correlated with power (a ~6%
>   true-freak escape keeps the rare 30/30 talent), and the draft/intl
>   slot lifts raise the bat, not the legs (speed keeps its body-given
>   draw plus a small leak, unless speed IS the carrying tool).
>   Post-fix correlation: ~-0.1 to +0.2.
> - **Running game recalibrated.** Convex green-light curve: average
>   runners pick their spots, true burners run constantly. Measured
>   ~75-100 attempts/team (down from ~170), leaders 50-70 steals who
>   are genuine 65+ speed burners, 30/30 seasons 1-3/yr.
> - **Sac flies** to ~40/team (tag-up conversion 0.55 → 0.82) and
>   **pitcher-batting K%** to ~34-37% (kBase 0.285 → 0.335), both to
>   their 7.2 targets.
> - **Mid-30s retention** softened (34-37 base retirement rates down a
>   step; useful regulars 53+ get a further -0.05) — the 34+ cohort was
>   6-10 players league-wide; still lean, watch item stands.
> - **Rotation self-heal.** The starter-overwork guard caught a rare
>   mid-season degenerate state (a stale 1-2 arm rotation funneled 47
>   starts to one arm). pickStarter now prunes/tops-up the rotation to
>   five before every selection, and the last-resort fallback takes the
>   MOST RESTED healthy arm rather than the best one.
>
> Steady-state after the pass (7-season soaks, two seeds): R/G 4.6-4.8,
> zero sim errors, readiness OK every year, youth ceiling and workload
> guards green, pyramid/FA pool/payrolls in their bands.

> **Status (0.19.1) — durability pass (audit fixes).** A three-track code
> audit (long-save durability, engine rare paths, UI/migration lifecycle)
> found and this release fixed:
>
> - **Migrations are now version-gated and one-shot.** `state.version` is
>   stamped forward to the running build after load-time migrations (it
>   previously froze at the creation version forever), and the 0.17.1
>   intl-name migration — which re-rolled the unsigned pool's names on
>   EVERY load — plus the 0.14 weight repair run only for saves that
>   predate them.
> - **PWA cache rebuilt.** The service worker cached zero JS files (so
>   offline never actually worked) and swallowed install failures into an
>   empty-but-active cache. It now pre-caches the full shell including
>   all version-stamped JS URLs, fails install atomically, and serves
>   navigations network-first so a stale index.html can never pair with
>   newer JS (the pre-0.16.2 `#btnMenu` crash class).
>   **Amended (0.39.1) — boot integrity guard.** One gap remained: fresh
>   HTML can load while the OLD worker is still active, so the new ?v=
>   JS URLs miss its cache and each fetch independently races a flaky
>   mobile network — one lost script and the app half-boots (screens
>   render until they touch the missing module; the sim halts mid-day
>   on a confusing error like `emptyPitcher`, the field report that
>   prompted this). An inline script after the last module tag now
>   verifies all 42 `window.BBGM_*` globals registered; if any are
>   missing it auto-reloads once (sessionStorage-guarded), and on a
>   second failure shows a plain "update didn't finish downloading —
>   your save is safe" screen instead of limping. The scratchpad
>   module-load test keeps the guard's list in lockstep with
>   index.html's script tags.
> - **The offseason rollover is atomic.** Both rollover halves snapshot
>   the save before mutating; an error mid-rollover restores the snapshot
>   instead of persisting a half-consumed October that no retry could fix.
> - **Long-save compaction.** Retirees shed their hidden development
>   block; fringe retirees past every Hall window (16+ years retired,
>   score below the veterans bar) are removed; draft/intl class archives
>   keep a rolling decade.
> - **Rare-path batch:** healed-starter rotation reclaim when the team
>   played short; stale-ref guards on the desperation reliever/starter
>   fallbacks; no steal attempts after a walk-off; NaN guards on old-save
>   rating/ceiling shapes; IL clocks no longer double-heal after a
>   day-by-day October; `ilCallUpFor` covers are cleared on the cover
>   (not the returnee) at spring rebuild; save-import validates before it
>   overwrites the prior save; trade proposals re-validate org membership
>   at render and execute; intl event players use the persisted id
>   counter; a page-hide save flush for the mobile 400ms-debounce gap;
>   safeRebuild's pitching repair trims back to 26.

> **Status (0.19.2) — prospect scouting reports + birthdate fix.**
>
> - **Birthdate bug.** The profile card's bio fallback hashed the player
>   id with SIGNED bit-shifts — ids hashing above 2^31 went negative and
>   rendered "undefined -7, 2006". Fixed to unsigned (`>>>`), the same
>   latent pattern cleaned up in the scouting fog's band math, and a
>   one-shot 0.19.2 migration backfills persisted birthdates (and any
>   missing height/weight) onto every player and pool prospect so the
>   fallback is no longer load-bearing.
> - **Draft-guide scout blurbs (6.5/13.4 amendment).** Draft and intl
>   prospect cards now carry a bio line (height/weight, full birthdate)
>   and a "From our scouts" note: the department's strengths/weaknesses
>   read — carrying tool, biggest concern, starter-workload risk, and
>   (above-average tiers and up) accurate makeup notes. Reads are the
>   tool CEILINGS seen through tier-scaled noise, deterministic per
>   (team, prospect): a bare-bones department regularly falls in love
>   with the wrong tool; an elite one rarely does. Teenage international
>   reads are the noisiest, HS next, college tightest. No true numbers
>   leak — the blurb is scout-speak only, and it only appears when the
>   prospect is visible at the user's tier.

> **Status (0.20.0) — utility men and pitcher role management (5.x/7.x/11.x
> amendment).**
>
> - **Position aptitude.** Every position player carries a 20-80 aptitude
>   at every field position: 80 primary, 68 listed secondaries,
>   family-adjacent bases below (middle-infield swap 45, corners 45,
>   corner-OF interchange 60, IF↔OF 35, catcher 20 — a trade, not a
>   fill-in). Game reps at a position grow it (~1 pt / 4 games, +25 max):
>   50 = playable in a pinch, 60 = graduates into the visible secondary
>   list at the rollover. `canPlay` now reads aptitude (back-compatible:
>   every previously-legal combo starts ≥50, every previously-illegal one
>   below), and out-of-position defense is discounted by aptitude in the
>   sim — an emergency stopgap costs ~12 points of defense, a learned
>   utility man ~2.
> - **Position work (Team → Minors).** Assign a minor-league hitter a
>   development position; each winter banks a season of side work
>   (+6 aptitude) on top of any real game reps. Catcher is excluded.
> - **Pitcher role conversions (Team → Pitching / Minors).** The GM
>   converts starters to relievers freely (never below five SPs on the
>   26-man) and relievers to starters only at 55+ stamina — a one-inning
>   frame can't hold a starter's workload. The manager still sorts the
>   staff: a converted arm competes for a rotation spot, he isn't handed
>   one. **Amended (0.39.0, reworked 0.40.0) — the conversion reshapes
>   the arm, gradually and both ways.** Pen-ward, the stuff plays up in
>   one-inning bursts (velocity +2, stuff +1 — live rating AND hidden
>   ceiling, ceiling capped 82 like breakouts). The conditioning is not
>   docked up front: a pen role simply stops building it — RP/CP arms
>   develop stamina only toward an effective ceiling of ~55, and
>   anything above it erodes ~25%/yr (split across the in-season dev
>   ticks and the annual pass, so a midseason convert visibly loses
>   length by September). The raw ceiling survives, so a young arm
>   moved back to the rotation rebuilds through normal development.
>   Rotation-ward the old 55-stamina eligibility gate is GONE — any arm
>   can be stretched out, but the price scales with the stamina he must
>   build toward a starter's ~60: velocity −(2 + 0.15/pt short), stuff
>   −(1 + 0.10/pt short). A 58-stamina swingman pays about the base; a
>   30-grade-stamina flamethrower pays velocity −6.5 / stuff −4 —
>   ruinous unless the arm is so talented the wreckage still starts
>   (the deliberate edge case). Flip-flopping strictly loses: an
>   immediate round trip nets zero, and pen years erode the stamina
>   that prices the return. RP↔CP stays shift-free. AI clubs convert
>   too (0.40.0): once per winter an org with genuine SP surplus moves
>   a depth starter with a reliever's profile (stuff+velo well ahead of
>   stamina+control, age 24+) to the pen, and an org under six SP-
>   primary arms stretches out its best durable young reliever — same
>   applyRoleShift price, never the user's players, never the closer.
>   The modal quotes the arm's exact price before the tap.
> - **Closer is a role (7.8 amendment).** Tap any relief arm → Name
>   Closer. Naming one stamps him CP (spring rebuilds keep the job with
>   him) and returns the old closer to the pen as an RP. League-wide, the
>   engine already hands the ninth to the best reliever when no CP-primary
>   arm exists, so closers keep emerging even though the draft and intl
>   pools generate only SP/RP — closer is your best reliever, not a
>   drafted position.

> **Status (0.21.0) — sim stops, pending decisions, release/waive (Pillar 2
> "as deep as you want" made literal).**
>
> - **Simulation Stops (Menu card).** Five toggles decide which league
>   events pause a sim run and hand the call to the GM instead of the AI:
>   injury IL moves (default on), IL returns (on), incoming trade offers
>   (on), a trade-deadline heads-up 3 days out (on), and day-to-day knocks
>   (off). Everything off reproduces the old hands-free behavior exactly —
>   the AI resolves each event precisely as it did before 0.21.0.
> - **Two stop mechanics.** Roster decisions (state.pendingDecisions) are
>   deferred moves that FREEZE the calendar until resolved: the injured
>   player hits the IL immediately but the call-up choice waits (ranked
>   candidate modal, "Let the AI Decide", or "Play Short-Handed"); an IL
>   return waits on the send-down pick (his cover flagged first). One-shot
>   notices (trade offer, deadline, day-to-day) just end the current run
>   with a modal and don't block re-simming. The dashboard pins a
>   "Roster decisions required" card while any are open.
> - **Release / waive (11.x amendment).** Any 26-man player (Team →
>   Roster action sheet) or minor leaguer (Minors sheet) can be released:
>   he clears waivers into the FA pool as a free agent. A legality
>   pre-check blocks releases that would strand the club (under 2
>   catchers, 5 starters, 11 a side, or an uncoverable position). A short
>   roster gets a direct "Call Up a Player" fill button (the Minors
>   promote flow is swap-based and needs 26).

> **Status (0.22.0) — waiver claim system (11.x amendment,
> js/engine/waivers.js).**
>
> - **The wire.** In-season 26-man releases are now a DFA: the player
>   leaves the roster immediately and sits on waivers for 2 days. Claim
>   priority is reverse standings — the worst record claims first — and
>   the claiming club takes the player AND his contract onto its 26-man
>   (weakest player optioned to make room; closer / 2-catcher / 5-starter
>   protected). Unclaimed players clear to free agency. Farm releases and
>   offseason cuts skip the wire; nobody winters on it (rollover clears).
> - **Two-sided.** AI clubs DFA a squeezed-out fringe veteran ~1-2 times
>   a league-week (only when a clearly better farmhand takes the spot,
>   who is called up in the same move), so the user gets claim chances.
>   AI claims weigh the upgrade over their weakest same-type player and
>   the owner's payroll room.
> - **UI.** GM → Waivers lists the wire with contract, waiving club,
>   resolution clock, the user's claim-priority rank, and Claim/Withdraw.
>   A new "Waiver wire" sim stop (default on) halts the run when a
>   claimable player (48+ OVR) is waived; winning a claim halts with the
>   award notice, losing one lands in the news feed.

> **Status (0.23.0) — targeted international scouting (6.7/14.x
> amendment).** The intl pool's tier coverage leaves most of the class as
> "??" names. Each class, the department now gets a travel budget of
> TARGETED LOOKS — send a scout for a closer read on any unscouted
> prospect, spent from his card ("Send a Scout"). Both the count and the
> quality scale with the scouting tier: bare bones gets 2 trips that
> return a rough ceiling band and no tool grades; standard 4 trips with
> tools; above-average 6; elite 9 near-full-coverage reads. A targeted
> report is marked as one look, not full coverage; if the tier already
> covers the prospect, the better read wins. Looks live on the class
> (state.intl.userLooks), so the budget resets with each new class. The
> class budget card shows trips remaining.
>
> **0.24.0 extension:** the same mechanic covers the DOMESTIC draft
> class (its own separate per-class budget, same tier table). Bare-bones
> departments see only the top 10 of the draft and standard the top 50 —
> targeted trips are how they scout deep cuts and sleeper rounds. The
> Big Board shows trips remaining; above-average+ tiers already see the
> full class, so the button simply never appears for them there.

> **Status (0.24.1) — public medical files (5.7 amendment).** Amateur
> medical histories are league disclosure, visible at EVERY scouting
> tier: draft and intl prospect cards carry a ⚕ line (clean file /
> medical flags / serious red flags — the unremarkable middle prints
> nothing, ~30% of the class), and flagged prospects get a ⚕ marker on
> the board rows. The file is a HISTORY, not a diagnosis: the read is
> hidden injuryProneness through deterministic per-player noise, and
> ~1 in 6 files lies — the kid who broke a wrist at fifteen and never
> got hurt again carries a scary file (17% of durable players flagged),
> and some true glass men show clean medicals (15% of fragile players).
> The read is keyed on the player alone, so every club sees the same
> file and it never re-rolls. Verified rates: 75% of truly fragile
> (proneness 8-10) prospects get flagged — signal beats noise, but no
> file is a guarantee.

> **Status (0.25.0) — ceiling breakout events (9.x amendment).** True
> potential was static after signing day (fixed at generation, one
> hidden signing-day reshape, injury decay only). Now the rare upward
> case exists: once per offseason, a player age ≤ 26 can experience a
> CEILING BREAKOUT — the real-world velocity jump or swing rework —
> raising ONE tool's hidden ceiling by +3-8. Work-ethic-weighted (~1% at
> WE 1 to ~2.8% at WE 10, verified), rolled before progression so the
> same winter's development climbs toward the new lid, ~15-25 league-wide
> per year. Speed stays body-given unless it's already the carrying tool
> (Phase 16 decoupling preserved), bunting never breaks out, and the
> quad-A archetype cap holds — a quad-A profile stays quad-A. User-org
> breakouts land in the January news in scout-speak (no numbers; the
> potential band simply reads higher). Harness prints breakouts/yr as a
> diagnostic.

> **Status (0.25.1) — orphaned-pitcher fix.** A pitcher activated from
> the IL could return to the roster belonging to NO staff list — never
> starting, never relieving. Cause: any mid-stint config rebuild (trade,
> roster swap, role conversion, waiver claim — every safeRebuild path)
> rebuilds from the 26-man only and purges IL'd players; activation
> assumed his old spots survived. activateFromIL now guarantees
> reintegration at every exit (ensureStaffIntegration: reclaim the
> cover's rotation slot, full re-sort for a purged starter, pen chair
> for a reliever), a one-shot 0.25.1 migration rebuilds any team already
> carrying an orphan, and the consistency probe audits daily that every
> healthy roster pitcher belongs to rotation/pen/closer.

> **Status (0.26.0) — 2001 offense calibration (7.2 amendment).** A
> 162-game iron-man leadoff hitter posted 720 AB / ~805 PA, beating the
> real records (716 AB / 778 PA, both from the modern game). Cause: the
> original .340 league OBP target ran ~9.3% position-player walks and
> ~39+ PA/team-game. Recalibrated to the 2001 environment the user
> specified: TARGET_OBP .340 → .328, TARGET_BB_RATE 9% → 8.5%
> (bbBase 0.088 → 0.078 in the engine). Measured after the trim: BB%
> 8.3-8.5, all-batter OBP ~.330, PA/team-game ~38.5 (2001: 38.3), BA
> .265, SLG .425, R/G ~4.6-4.7. Season-volume extremes now cluster AT
> the record book instead of past it — measured maxes 773/774/778/785
> PA and ≤700 AB across four seasons — so a record chase is a
> once-a-generation event, not an annual formality. The harness prints
> PA/team-game and the league-max season PA/AB against the 778/716
> records as standing diagnostics.

> **Status (0.27.0) — intentional walks (7.5 amendment).** The IBB
> accounting plumbing existed since the original engine but nothing ever
> issued one. Now the defense makes the classic call before the PA is
> rolled (`shouldIntentionalWalk` in simulation.js): first base open, a
> runner in scoring position, inning 3+, margin within ±2 from the
> defense's side, and a clear step down to the on-deck man (the pitcher
> due up next, in no-DH games, is the era's automatic green light; the
> pitcher himself is never walked). Probability scales with both the
> batter-vs-on-deck gap and the batter's absolute menace, is boosted
> late / with two outs / with R3, and runs through the manager's
> small-ball tendency (old-school skippers hand out more free passes).
> Calibrated to the user-specified 2001 standard: measured 48
> IBB/team-season (2001: ~46, 0.28/game) with single-season leaders at
> 35 and 45 across seeds — genuine Barry Bonds room, since the menace
> kicker scales steeply for generational monsters. An IBB counts in the
> bb column (official scoring) plus a new `ibb` counter on both the
> batting and pitching lines for future display; the game log shows
> "Intentional Walk" as its own play. The unintentional walk base was
> trimmed (bbBase 0.078 → 0.0725 for position players) so TOTAL BB%
> stays at the 8.5% / .328 OBP 2001 targets. Harness prints IBB/team
> and the league IBB leader every season as standing diagnostics.

> **Status (0.27.1) — arbitration modal readability fix.** The arb
> review rows (dashboard.js) set flex styles on `.roster-row`, but that
> class is a 32px/1fr/auto CSS grid — the info block landed in the 32px
> badge column (names crushed to two letters, the stat line wrapping
> one word per line) while the Non-Tender button stretched across the
> wide middle column. Same pathology as the 0.22.1 IL-modal fix. Rows
> rebuilt on the standard badge/info/action grid; `playerRow` in
> players.js had the same latent crush when called without a lead icon
> (HoF ballot, All-Star lists) and now always emits its first cell. The
> e2e suite synthesizes an arb window and asserts the modal rows carry
> the full grid with an uncrushed info block.

> **Status (0.28.0) — teenage prospects: rawer currents, no A ball at
> 17 (6.7/12.4 amendment).** International signees were showing mid-40s
> current tools at 17 — near-MLB polish on a kid who should read as a
> project — and the level ladder allowed (and scouts recommended) A-ball
> assignments at 17. Three changes: (1) intl current-rating gaps widened
> (16: 30→36, 17: 27→33, 18: 24→29, 19+: 18→22) and the polish cap
> dropped 52→46, with teenage pitcher stamina capped at 50 — measured
> pool currents now average low-20s at 16-17 with the best tools maxing
> 46, so the potential band carries the value story; (2)
> maxLevelIdxForAge tightened — 17-and-under is Rookie complex only (18:
> A, 19-20: AA, 21+: uncapped), which silences the promotion arrow and
> AI reassignment for 17-year-olds; (3) draft assignment (levelFor) now
> clamps to the age cap too, so a 17-year-old HS first-rounder opens in
> Rookie ball instead of the round's A-ball base. Existing saves
> self-heal: reassignment walks any 17-year-old already in A back to
> Rookie at the next offseason. Verified over 7-season soaks: star
> pyramid stable, zero youth-ceiling violations.

> **Status (0.29.0) — NABL Pipeline Top 100 (new, 6.9 adjunct).**
> League-wide prospect rankings a la MLB Pipeline: one Top 100 across
> all thirty organizations, no per-team lists. Eligibility is signed
> minor leaguers age ≤ 25 (draft/intl pool players rank only after they
> join an org; call-ups graduate off automatically since the list is
> recomputed live). Score = 55% current overall + 45% ceiling overall —
> the user-specified slight extra weight on current ability, so
> polished near-MLB talent outranks raw lottery tickets — plus ±2.5
> deterministic per-player/per-season media noise (unsigned-shift hash)
> so the public list neither leaks exact hidden ratings nor reshuffles
> between renders. This is the industry consensus, NOT the user's
> scouts: it can disagree with the user's fogged reads, which is
> intended signal (like real Pipeline lists). UI: Draft Hub → Top 100
> tab (35 rows + Show More, user-org rows highlighted with "(you)",
> potential-band chip per row honoring existing fog), and a "Pipeline:
> #N on the NABL Top 100" bio row on ranked players' cards. Unit-tested
> (sorted/deterministic/graduation/org spread) plus e2e coverage.

> **Status (0.30.0) — Team Needs on the FA screen (20.11 amendment).**
> The AI has read `teamNeeds` (trades.js — starters under 46 OVR plus
> 4th-starter depth) when bidding since 16.7, but the user never saw
> his own. New `needsReport(team, players, faMarket)` in trades.js is
> the user-facing version built on the SAME thresholds: weak or
> vacated lineup spots (with the incumbent's grade), rotation depth,
> count-vs-floor shortfalls (2 C / 5 SP / 13 P), and the team's own
> unsigned free agents still on the market. Rendered as a Team Needs
> card at the top of GM → Free Agents — offseason market and in-season
> pool both, since contract expiries rebuild rosters BEFORE the market
> opens (releaseToPool → replaceRefs → buildMarket), the read reflects
> departures. Market and pool rows whose position matches a need carry
> an accent "fills need" flag using the exact AI match rule
> (pitchers only ever fill SP). Unit-tested (9 checks: threshold
> agreement, vacancy, shortfall, departed filters) + e2e assertions.
> 0.30.1 extends it to the Trade Center: the same card on the landing
> view, and inside the trade builder a "You need:" line in the header
> right under the partner's "looking for" read — both sides of the
> shopping list visible while a deal is built.

> **Status (0.30.2) — short-roster call-up lockout fix.** An offseason
> roster can legally sit below the 24-man game floor (expired contracts
> walked; a 60-day IL stint doesn't count against the active list), but
> every user roster move validates through checkTeamReadiness's strict
> 24-26 window — so at 22 men, the call-up TO 23 was rejected as "size
> 23, expected 24-26": the validator blocked the exact move that climbs
> back toward legal. Fix: checkTeamReadiness accepts optional pre-move
> floors (roster size, pitcher/hitter counts, rotation/bullpen sizes),
> each capped at its strict value, and mutateTeam passes its snapshot's
> counts — the rule becomes "no worse than before": improving and
> same-size moves pass from any shortfall, regressions still fail, and
> a team already at the strict floors is held to them exactly. The
> load-time league validation keeps its strict defaults. e2e regression:
> a synthesized 22-man roster accepts a call-up to 23.

> **Status (0.31.0) — send-downs + card-first roster taps (11.5/20.6
> amendment).** Two gaps the user hit at once: no way to option a
> 26-man player to the minors, and the Roster tab's intermediate
> action sheet (View Profile / Release / Cancel) was a wasted tap.
> Roster rows now open the player card DIRECTLY, and the card carries
> the transactions at the bottom for the user's own 26-man players:
> Send Down… (new — confirm modal, demote to AAA through mutateTeam
> with the 0.30.2 pre-move floors plus a two-catcher pre-check, then
> safeRebuild so the manager reworks lineups/staff) and Release/
> Waive… (the existing 0.21.0/0.22.0 flow, now reachable from the
> card). Rival and FA cards stay read-only; IL players are excluded
> via roster membership (not status — an IL stint keeps status
> 'active'). The Pitching and Minors tabs keep their specialized
> action sheets (roles, conversions, position work). e2e: direct-open
> assertion + full send-down flow (roster 26 → 25, AAA assignment,
> restore).

> **Status (0.31.1) — 26-man cap fixes + Minors card-first taps.** The
> user reported a 27-man roster after a trade. executeTrade was NOT
> the leak (its trim loop is airtight — verified across 2-for-1,
> minors-for-actives, IL-player, and full-roster shapes); TWO other
> roster doors had no cap: (1) FA signings — signPlayer pushed MLB
> deals onto the roster with no trim, so signing at a full 26 quietly
> ran 27; (2) the rollover IL sweep — healed IL players were pushed
> back with no trim, so a full roster plus a healed 60-day stint
> started the new season at 27. Both now demote the weakest man to
> make room (same rule as executeTrade), a version-gated migration
> (<0.31.1) trims any save already carrying an over-cap roster and
> rebuilds its configs, and the consistency probe audits roster ≤ 26
> daily. Also: Minors tab rows now open the player card directly —
> the farm actions (Promote/swap, Move Level, Convert or Position
> work, Release) moved to the bottom of the card via
> minorsCardActions, with the scouts' level-fit note rendered under
> the bio (minorsScoutNote) — completing the 0.31.0 card-first
> pattern across both org tabs.

> **Status (0.32.0) — international bidding overhaul (14.3
> amendment).** The user reported never winning a top-10 bid despite
> trying every year. Measured: no bug — but the market was a UX trap.
> ~9 AI bidders per elite kid each drew 0.85-1.3× ask, so an ask
> offer won 3-5% of the time, while the UI's hidden second tap
> ("raise to 1.3×") won 100% — opaque both ways. Redesign: (1) AI
> participation cut 0.28 → 0.12 per team (real July 2 classes run on
> handshake deals — 3-4 serious suitors per kid, not nine), with an
> aggressive tail (15% of bids draw up to 1.35×) so no offer short of
> a blow-away is a guarantee; (2) the two-step offer replaced by an
> explicit ladder with honest odds labels — ask (~10-15%,
> "longshot"), +15% (~45%, "underdog"), +30% (~99%, "usually wins"),
> +50% ("blow him away") — measured at 16/45/99/100% over 120-trial
> runs; (3) step-1 resolution now shows a full results modal: every
> top-10 destination, your wins highlighted, and honest outbid lines
> ("SFG paid $7.1M — your $5.5M") via userOffer carried on the
> results; (4) signed prospects STAY on the window board annotated
> "signed: ABBR $X.XM" (they used to vanish), tapping through to the
> real player card; (5) the closed-window recap gains "Where the
> Class Landed" — all 100 signings in rank order with team and bonus,
> plus an unsigned count. The standing offer shows on the prospect
> card, and the phase-1 copy explains the market honestly.

> **Status (0.33.0) — attribute history charts (9.x adjunct, user
> request).** Tap any exact-mode rating on the player card to see its
> full year-over-year history: an inline SVG curve on the 20-80 scale
> with the peak marked green, a "Peak 60 at age 27 • now 55" summary,
> and per-season rows. The point is archetype detective work — the
> game never names a player's development curve, but the shape (early
> spike, long plateau, steady slide, late bloom) is now readable
> player by player. Mechanics: offseason Part A snapshots every
> living player's tools as-played (ints, keyed by season) into
> p.ratingsHistory immediately BEFORE progression rewrites them; the
> chart appends the live value as "now". Fogged cells (rival
> farmhands in band mode) stay untouched — no history taps through
> the fog. Storage stays bounded because washout retirees are deleted
> outright by the 4.45 compaction; kept legends retain their curves
> for posterity. History accumulates from this version forward —
> existing saves start their charts at the next rollover. Exact cells
> with history grow a "›" affordance; "Back to Card" returns to the
> profile.

> **Status (0.34.0) — Trade Finder (15.5 amendment, user request).**
> Trade Center gains a finder card: tap a position chip to see which
> big-leaguers rival clubs would move. Availability is
> `teamValueOf / tradeValue` — the gap between a club's internal view
> (window/owner discounts: rebuilding clubs dump rentals, cheap
> owners shed salary) and open-market value, the SAME numbers the AI
> uses to accept or reject proposals, so the labels are honest:
> ratio < 0.75 "shopping him", < 0.9 "open to moving him", ≤ 1.02
> "will listen" (fair-value deals clear); above that the player is
> unlisted — he costs a premium. Floor guards mirror
> validateTradeShape (no club lists a C it can't lose past 2, or an
> SP past 5); fringe filler (market value ≤ 6) is excluded. Results
> sort by OVR, cap at 20 shown, and tapping one opens the trade
> builder with the partner and player preloaded — finder to offer in
> two taps. Measured league-wide: ~150 players available across all
> positions on a fresh league. Unit-tested (floors, labels, sort,
> user-team exclusion) + e2e finder→builder flow.
> 0.34.1: the 26-man count floors (2 C / 5 SP / 11-a-side) apply IN
> SEASON only — a December trade that thins the staff was being
> rejected ("too few pitchers") even though winter rosters are
> legally short and every club rebuilds through free agency and the
> spring backfill before Opening Day. Org-wide position coverage
> still holds year-round (nobody trades away the only catcher in the
> organization), and the Trade Finder's floor guards relax on the
> same rule — a two-catcher club will move one in December.

> **Status (0.35.0) — trade flow rework (user request).** Two UX
> changes: (1) Trade Finder rows open the player's full PROFILE
> instead of jumping straight into the builder — the card gains a
> "Discuss Trade…" action (opts.discussTrade on BBGM_UI_PLAYER.show)
> that drops him into the builder preloaded, so the flow is browse →
> vet the player → engage. (2) The trade builder split into two
> pages (draft.page): step 1 is the PARTNER's side — their org list,
> pick who you want, cash-you-receive stepper, "Next: Your Offer ▶"
> (gated on at least one pick); step 2 is YOUR side — your org list,
> cash-you-send, Deal at a Glance, Propose Trade / ◀ Their Side /
> Discard. One team per screen instead of one long scroll; selected
> counts show in each section header and scroll resets on page
> change.

> **Status (0.36.0) — trade money made real (15.2 amendment, user
> request).** Trade cash previously did NOTHING mechanical — the AI
> priced it (0.6 TV/$M) and the news mentioned it, but it touched no
> budget on either side. Now: (1) cash is PAYROLL money — each club
> carries a tradeCash {in, out} ledger updated by executeTrade;
> computePayroll counts the net (sent burdens the books, received
> offsets them), so cash-in genuinely frees FA budget room; the
> ledger resets every rollover. Builder steppers move in $1M (was a
> misleading $5M), carry an explainer, and page 2 shows a live
> payroll-impact line. (2) Int'l bonus pool space is now tradeable
> under real rules (6.10): $0.25M steps; only while the current
> class's window hasn't closed; the sender can move only unspent
> pool; acquisitions cap at +60% of a club's base pool per class
> (budgets carry base/acquired); clubs under signing restrictions
> can't acquire. Legality is enforced at proposal time
> (poolTradeBlocker), defensively re-clamped at execution, and the
> AI prices pool space at 1.5 TV/$M — premium currency. News and
> history entries distinguish cash from pool money. Unit-tested
> (12 checks: ledger math, payroll effect, all four legality rules,
> transfer bookkeeping, AI valuation).

> **Status (0.36.1) — intl overspend penalties made visible.** The
> user overspent a class and saw no penalty — investigation confirmed
> the PIPELINE WORKS (10-check unit test: 8% over → 0.85 pool trim,
> 20% → next pool halved, 40% → halved + 2-class restrictions, clean
> → carryover), but the cut was invisible: pools naturally range
> $4-9M by standings, so a halved allotment read as an ordinary small
> budget, and only the 30%+ tier showed a banner. Now the penalty is
> NAMED everywhere it acts: the budget card shows "Overspend penalty
> active: last class ran X% over — this class's allotment was
> HALVED/cut 15%" (read from intlLedger); the window-close recap
> states the exact consequence tier; and a league-office news item
> lands the day the penalty is assessed.

> **Status (0.37.0) — the Inbox (new, user request; first slice of the
> 4.x owner-communication layer).** A mail icon in the app header
> (next to the menu, with an unread badge) opens the GM's inbox —
> js/engine/inbox.js holds the pure state helpers (push / unread /
> markRead, 60-message cap that prunes oldest READ mail first);
> message GENERATION lives in main.js and UI resolve paths so
> headless harnesses never load it. Three correspondents: (1) the
> OWNER — season-opening marching orders (writers' projection +
> payroll budget + archetype-flavored line), a deadline stance three
> days out (buy / pick-a-direction / sell, from the live W%), and a
> pointed note when an int'l overspend penalty is assessed; (2)
> SCOUTS — the draft board going live (class-strength blurb), the
> int'l class posting, and a winter development report digesting the
> org's ceiling breakouts; (3) RIVAL GMs — every couple of weeks
> (10-day cooldown, ~5%/day), a club reads the user's Team Needs,
> checks its own availability (the same findAvailable math as the
> Trade Finder), and pitches a specific player. Messages carry
> actions: a pitch's "Open Trade Talks" drops into the two-page
> builder preloaded; scout mail deep-links to the relevant board.
> Stale pitches (player since moved) degrade gracefully.

### 21.18 What's Explicitly Out of Initial Build

To keep scope contained, several systems are explicitly deferred:

- Three-team trades
- Draft pick trading
- No-trade clauses, opt-outs, complex contract structures
- Qualifying offers / FA compensation picks
- Draft lottery
- Position-specific defensive ratings
- Catcher-specific ratings (framing, blocking, throwing)
- Advanced sabermetrics (WAR, FIP, wRC+)
- Pre-simulated league history
- Real player names
- Multiplayer
- Detailed in-game tactical decisions exposed to user
- Stadium construction / business sim
- Fan engagement / attendance / TV revenue modeling
- Intra-league rivalries (per 4.7) — flavor layer, depends on the
  news and owner-goals systems landing first

These can be added in later iterations once the core game is working.

### 21.19 Iteration Loop

After Phase 16's initial completion, the iteration loop is:

1. Play multiple seasons
2. Identify what feels wrong, missing, or unbalanced
3. Adjust the bible (this document) with corrections
4. Implement changes via Claude Code
5. Test
6. Repeat

The bible is a living document. As the game evolves, this document should evolve too — new sections added, old sections updated, deferred features documented when they're built.
