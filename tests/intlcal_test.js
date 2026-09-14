// January 15 signing calendar (v2.15.0): the intl cycle moves from the
// July 2 in-season halt to the winter tentpole. Invariants:
//  - signingYearFor points at the next Jan 15 on the calendar
//  - windowPending is "on or after Jan 15, until worked" (heal included)
//  - ensureClass posts the NEXT class once the last window is done, and
//    never clobbers a pending one
//  - every generated/re-pinned birthday keeps board age === signing age
//    (no birthday lands between generation and the window)
//  - the full rollover resolves the window headlessly (Part B backstop)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = require('path').join(__dirname, '..');
const files = [
  'js/data/constants.js', 'js/data/name_pools.js', 'js/data/intl_name_pools.js',
  'js/data/city_pools.js', 'js/data/teams.js', 'js/util/rng.js', 'js/util/dates.js',
  'js/generation/ballparks.js', 'js/generation/league.js', 'js/generation/players.js',
  'js/engine/schedule.js', 'js/engine/stats.js', 'js/engine/injuries.js',
  'js/engine/fatigue.js', 'js/engine/roster.js', 'js/engine/progression.js',
  'js/engine/minors.js', 'js/engine/flavorleagues.js', 'js/engine/trades.js',
  'js/engine/freeagency.js', 'js/engine/waivers.js', 'js/engine/staff.js',
  'js/engine/scouting.js', 'js/engine/draft.js', 'js/engine/intl.js', 'js/engine/rule5.js',
  'js/engine/awards.js', 'js/engine/simulation.js', 'js/engine/standings.js',
  'js/engine/offseason.js',
];
const sandbox = { window: {}, console, Math, JSON, Array, Object, Date };
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const W = sandbox.window;
let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '✓ ' : '✗ ') + label); ok ? pass++ : fail++; };
const INTL = W.BBGM_INTL;

// ---- 1. signingYearFor -----------------------------------------------------
const syf = INTL.signingYearFor;
check(syf({ year: 2030, month: 1, day: 1 }) === 2030, 'Jan 1 → this January');
check(syf({ year: 2030, month: 1, day: 15 }) === 2030, 'Jan 15 (window day) → this January');
check(syf({ year: 2030, month: 1, day: 16 }) === 2031, 'Jan 16 → next January');
check(syf({ year: 2030, month: 4, day: 10 }) === 2031, 'April → next January');
check(syf({ year: 2030, month: 12, day: 31 }) === 2031, 'Dec 31 → next January');

// ---- 2. windowPending ------------------------------------------------------
const wp = (intl, today) => INTL.windowPending({ intl }, today);
const cls = (year, phase) => ({ year, phase });
check(!wp(cls(2031, 'scouting'), { year: 2030, month: 6, day: 1 }), 'next-year class: quiet in-season');
check(!wp(cls(2031, 'scouting'), { year: 2030, month: 12, day: 21 }), 'next-year class: quiet in December');
check(!wp(cls(2031, 'scouting'), { year: 2031, month: 1, day: 14 }), 'Jan 14: not yet');
check(wp(cls(2031, 'scouting'), { year: 2031, month: 1, day: 15 }), 'Jan 15: window due');
check(wp(cls(2031, 'scouting'), { year: 2031, month: 1, day: 26 }), 'Jan 26 (FA round overshot): still due');
check(wp(cls(2031, 'scouting'), { year: 2031, month: 4, day: 1 }), 'April with unworked class: overdue heal');
check(wp(cls(2031, 'window'), { year: 2032, month: 2, day: 1 }), 'next YEAR with unworked class: overdue heal');
check(!wp(cls(2031, 'complete'), { year: 2031, month: 2, day: 1 }), 'complete class: never pending');
check(!INTL.windowPending({ intl: null }, { year: 2031, month: 2, day: 1 }), 'no class: not pending');

// ---- 3. A real league for generation/rollover checks -----------------------
const rng = W.BBGM_RNG.makeRng(4242);
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
const state = {
  meta: { seed: 4242, userTeamId: league.teams[0].id, currentDate: { year: 2030, month: 4, day: 3 } },
  league, players, freeAgents: [], news: [], inbox: [],
};

// ensureClass on a spring day with no class → posts NEXT January's.
const c1 = INTL.ensureClass(state, state.meta.currentDate);
check(!!c1 && c1.year === 2031 && c1.phase === 'scouting',
  `spring ensureClass posts next January's class (${c1 && c1.year})`);
check(INTL.ensureClass(state, state.meta.currentDate) === null, 'second call is a no-op');
check(INTL.ensureClass(state, { year: 2030, month: 9, day: 20 }) === null, 'September: still no clobber');

// Birthday invariant across the whole generated pool: board age is the
// age on Jan 15 of the class year, and no birthday lands between the
// generation date and the window.
const nextBirthdayAfter = (p, today) => {
  const notYet = p.birthMonth > today.month ||
    (p.birthMonth === today.month && p.birthDay > today.day);
  return { year: notYet ? today.year : today.year + 1, month: p.birthMonth, day: p.birthDay };
};
const beforeOrOnJan15 = (d, wy) =>
  d.year < wy || (d.year === wy && d.month === 1 && d.day <= 15);
const ageOn = (p, on) => {
  let a = on.year - p.birthYear;
  if (p.birthMonth > on.month || (p.birthMonth === on.month && p.birthDay > on.day)) a--;
  return a;
};
let pinBad = 0, ageBad = 0;
for (const id in state.intl.prospects) {
  const p = state.intl.prospects[id];
  const nb = nextBirthdayAfter(p, state.meta.currentDate);
  if (beforeOrOnJan15(nb, state.intl.year)) pinBad++;
  if (ageOn(p, { year: state.intl.year, month: 1, day: 15 }) !== p.age) ageBad++;
}
check(pinBad === 0, `no generated birthday falls before the window (${pinBad} bad of ${Object.keys(state.intl.prospects).length})`);
check(ageBad === 0, `board age === age at the Jan 15 table (${ageBad} bad)`);

// ---- 4. repinClassBirthdates from awkward migration dates ------------------
for (const today of [
  { year: 2030, month: 6, day: 20 },   // mid-season (old July-era save)
  { year: 2030, month: 11, day: 15 },  // rollover day
  { year: 2031, month: 1, day: 5 },    // early January, window ahead
  { year: 2031, month: 2, day: 10 },   // the dMax=today.day edge month
]) {
  // Scramble birthdays into the July shadow the old pin produced —
  // internally consistent, as a real old save would be: age TODAY is
  // the board age.
  let i = 0;
  for (const id in state.intl.prospects) {
    const p = state.intl.prospects[id];
    p.birthMonth = 7 + (i % 6);
    p.birthDay = 3 + (i % 25);
    const passed = today.month > p.birthMonth ||
      (today.month === p.birthMonth && today.day >= p.birthDay);
    p.birthYear = today.year - p.age - (passed ? 0 : 1);
    i++;
  }
  INTL.repinClassBirthdates(state, today);
  // The window runs at Jan 15 of the class year, or immediately if the
  // calendar is already past it (the overdue heal) — board age must
  // hold at whichever date the signing actually happens.
  const w = { year: state.intl.year, month: 1, day: 15 };
  const effective = (today.year > w.year ||
    (today.year === w.year && (today.month > 1 || today.day >= 15))) ? today : w;
  let bad = 0, aged = 0;
  for (const id in state.intl.prospects) {
    const p = state.intl.prospects[id];
    const nb = nextBirthdayAfter(p, today);
    if (nb.year < effective.year || (nb.year === effective.year &&
        (nb.month < effective.month || (nb.month === effective.month && nb.day <= effective.day)))) bad++;
    if (ageOn(p, effective) !== p.age) aged++;
  }
  check(bad === 0 && aged === 0,
    `repin from ${today.year}-${today.month}-${today.day}: ${bad} pre-window birthdays, ${aged} age breaks`);
}

// ---- 5. The rollover resolves the window headlessly ------------------------
// Regenerate a clean class (the repin loop above scrambled real data).
INTL.generateClass(state, 2031);
state.meta.currentDate = { year: 2030, month: 10, day: 1 };
// Minimal season history so runSeasonRolloverPartB's year math works.
// (Too heavy to run the full rollover here — the season harness covers
// it; this checks the Part B backstop function directly.)
const yearBefore = state.intl.year;
const histBefore = (state.intlHistory || []).length;
INTL.autoRunWindow(state);
check(state.intl.phase === 'complete' && (state.intlHistory || []).length === histBefore + 1,
  `autoRunWindow completes and archives (class ${yearBefore})`);
const signees = Object.values(state.players).filter((p) => p.intl && p.intl.year === 2031);
check(signees.length > 50, `window signed a real class (${signees.length} signees)`);
let signAgeBad = 0;
for (const p of signees) if (p.age < 16 || p.age > 18) signAgeBad++;
check(signAgeBad === 0, 'every signee lands at 16-18');

// ensureClass the day after (first day of the new season): next class.
const c2 = INTL.ensureClass(state, { year: 2031, month: 4, day: 1 });
check(!!c2 && c2.year === 2032, `next spring posts the ${c2 && c2.year} class`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
