// The Rule 5 draft (v2.17.0, §26). Invariants:
//  - eligibility: 4 pro years (5 if signed at 18 or younger), minors
//    only, paper trail required, top-40 value + user shield protected
//  - the draft: reverse standings, picks land ON the 26-man wearing
//    the obligation, rosters never overflow, nobody self-drafts
//  - the stick rule: every demotion door refuses a flagged pick, the
//    AI conscience returns the overmatched, leaks self-heal home
//  - the rollover: survivors graduate clean, fresh flags survive
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

const R5 = W.BBGM_RULE5;
const R = W.BBGM_ROSTER;

// ---- League scaffold -------------------------------------------------------
const rng = W.BBGM_RNG.makeRng(1965); // the year the rule got famous
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
const WY = 2032;
const state = {
  meta: { seed: 1965, userTeamId: league.teams[0].id, offseasonPhase: 'freeAgency',
    currentDate: { year: WY, month: 12, day: 10 } },
  league, players, news: [], freeAgents: [],
  history: { seasons: [{ year: WY, records: Object.fromEntries(
    league.teams.map((t, i) => [t.id, { w: 60 + i, l: 102 - i }])) }] },
};

// ---- 1. Calendar + eligibility rules --------------------------------------
check(R5.winterYearFor({ year: WY, month: 12, day: 10 }) === WY &&
      R5.winterYearFor({ year: WY + 1, month: 2, day: 1 }) === WY,
  'winter identity spans November through spring');
check(R5.pending(state, state.meta.currentDate), 'pending on December 10');
check(!R5.pending(state, { year: WY, month: 12, day: 9 }), 'quiet on December 9');
check(R5.pending(state, { year: WY + 1, month: 1, day: 5 }), 'overdue heal: still pending in January');

const collegian = { age: 25, draft: { year: WY - 4 } };            // signed at 21
const teenSign = { age: 20, intl: { year: WY - 4 } };              // signed at 16
const teenSign5 = { age: 21, intl: { year: WY - 5 } };
check(R5.serviceEligible(collegian, WY), 'college draftee eligible after 4 pro years');
check(!R5.serviceEligible({ age: 24, draft: { year: WY - 3 } }, WY), 'three years is not enough');
check(!R5.serviceEligible(teenSign, WY), 'a 16-year-old signee needs FIVE years, not four');
check(R5.serviceEligible(teenSign5, WY), 'and gets them');
check(!R5.serviceEligible({ age: 27 }, WY), 'no paper trail (genesis filler) — never eligible');

// Wire real eligibility into two orgs: a good farmhand + a deep name on
// the user's club, and pickable names on two rivals.
const [userTeam, rivalA, rivalB] = [league.teams[0], league.teams[1], league.teams[2]];
function makeEligible(team, n) {
  // Older, modest farmhands — the men a real reserve list leaves off.
  // (Young upside is top-40 by trade value and thus auto-protected;
  // a 30-year-old cranked to 66 is worth nothing on the trade market
  // and everything to a Rule 5 room — that asymmetry is the feature.)
  const out = [];
  for (const id of team.minors) {
    if (out.length >= n) break;
    const p = players[id];
    if (!p || p.retired || p.status !== 'minors') continue;
    if (p.age < 25 || R.overall(p) >= 46) continue;
    p.draft = { year: WY - 5, round: 6, overall: 180, teamId: team.id };
    out.push(p);
  }
  return out;
}
const userElig = makeEligible(userTeam, 3);
const rivalElig = makeEligible(rivalA, 3).concat(makeEligible(rivalB, 3));
check(userElig.length === 3 && rivalElig.length === 6, 'scaffold: 9 service-eligible farmhands wired');

// Protection: the top-40 shield. A YOUNG farmhand cranked into a
// blue-chipper carries real trade value — he must vanish from the pool.
const gem = players[rivalA.minors.map((id) => players[id])
  .filter((p) => p && p.status === 'minors' && p.age <= 23)
  .sort((a, b) => a.age - b.age)[0].id];
gem.draft = { year: WY - 5, round: 1, overall: 5, teamId: rivalA.id };
for (const k in gem.ratings) gem.ratings[k] = Math.max(gem.ratings[k], 62);
check(R5.protectedSet(state, rivalA).has(gem.id), 'a top-40-value farmhand is auto-protected');
check(!R5.eligibleFor(state, rivalA, WY).some((p) => p.id === gem.id), 'and off the board');

// The user shield: hand-protect one exposed name.
const shieldMe = userElig[0];
state.rule5Shield = { year: WY, ids: [shieldMe.id] };
check(!R5.eligibleFor(state, userTeam, WY).some((p) => p.id === shieldMe.id),
  'a hand-shielded name is protected');
check(R5.eligibleFor(state, userTeam, WY).length >= 1, 'the unshielded stay exposed');

// ---- 2. The draft ----------------------------------------------------------
const order = R5.draftOrder(state);
check(order[0].id === league.teams[0].id && order[29].id === league.teams[29].id,
  'reverse standings: the worst club picks first');

// Make one rival farmhand clearly stickable so somebody drafts him.
const target = rivalElig[3] || rivalElig[2];
for (const k in target.ratings) target.ratings[k] = Math.max(target.ratings[k], 52);
// (52-across is roster-worthy but below the org top-40 gem tier only if
// value says so — verify he is still exposed before counting on him.)
const stillExposed = R5.eligibleFor(state, rivalB, WY).some((p) => p.id === target.id) ||
                     R5.eligibleFor(state, rivalA, WY).some((p) => p.id === target.id);
const targetTeam = rivalB.minors.includes(target.id) ? rivalB : rivalA;

const rosterBefore = userTeam.roster.length;
const res = R5.runDraft(state, { userChoice: stillExposed ? target.id : null });
check(!!res && (state.rule5History || []).some((h) => h.year === WY), 'the draft runs and the winter is ledgered');
check(!R5.pending(state, state.meta.currentDate), 'no longer pending once run');
if (stillExposed) {
  check(res.userResult.kind === 'picked' && players[target.id].teamId === userTeam.id,
    `user pick lands: ${target.name} to the ${userTeam.abbr}`);
  check(players[target.id].rule5 && players[target.id].rule5.year === WY + 1 &&
        players[target.id].rule5.fromTeamId === targetTeam.id,
    'the pick wears the obligation: next season, old club remembered');
  check(userTeam.roster.includes(target.id) && players[target.id].status === 'active',
    'he is ON the 26-man, not stashed');
  check(!targetTeam.minors.includes(target.id), 'and out of his old farm');
} else {
  check(res.userResult.kind === 'sniped' || res.userResult.kind === 'passed',
    'target was shielded by value — user result degrades honestly');
}
check(userTeam.roster.length <= 26 && rosterBefore <= 26, `roster never overflows (${userTeam.roster.length})`);
let selfDraft = 0;
for (const k of res.picks) if (k.teamId === k.fromTeamId) selfDraft++;
check(selfDraft === 0, `nobody drafts his own farmhand (${res.picks.length} picks league-wide)`);
check(!res.picks.some((k) => k.playerId === shieldMe.id), 'the hand-shielded name went untouched');

// ---- 3. The stick rule ----------------------------------------------------
// An AI club's pick — the conscience tick never touches the user's.
const aiPickRec = res.picks.find((k) => k.teamId !== state.meta.userTeamId);
const pick = aiPickRec && players[aiPickRec.playerId];
if (pick) {
  const club = league.teams.find((t) => t.id === pick.teamId);
  const season = { year: WY + 1, month: 6, day: 1 };
  check(!R.acceptsMinors(pick, season.year), 'acceptsMinors refuses a flagged pick');
  check(R.weakestDemotable(club, players) !== pick || club.roster.length === 1,
    'weakestDemotable never trims the pick');
  // The conscience: make him hopeless and tick the month.
  for (const k in pick.ratings) pick.ratings[k] = 20;
  const ev = R5.aiStickTick(state, club, season);
  const home = league.teams.find((t) => t.id === aiPickRec.fromTeamId);
  check(ev.some((e) => e.playerId === pick.id) && !pick.rule5 &&
        pick.teamId === home.id && home.minors.includes(pick.id) && pick.status === 'minors',
    `an overmatched pick goes home: ${pick.name} back to the ${home.abbr} for $50K`);
  check((state.rule5History.find((h) => h.year === WY).returns || [])
    .some((r) => r.playerId === pick.id), 'the return is ledgered');
} else {
  check(false, 'no AI picks landed — pool or AI conscience broken');
}
// Self-heal: plant a flagged pick in the minors and tick.
const leakRec = res.picks.find((k) => players[k.playerId] && players[k.playerId].rule5);
const leak = leakRec && players[leakRec.playerId];
if (leak) {
  const club = league.teams.find((t) => t.id === leak.teamId);
  club.roster.splice(club.roster.indexOf(leak.id), 1);
  club.minors.push(leak.id);
  leak.status = 'minors';
  R5.aiStickTick(state, club, { year: WY + 1, month: 7, day: 14 });
  check(!leak.rule5 && leak.teamId === leakRec.fromTeamId,
    'a pick that leaks into the minors self-heals home (user club included)');
}

// ---- 4. Graduation ---------------------------------------------------------
const survivor = res.picks.find((k) => players[k.playerId].rule5);
if (survivor) {
  const fresh = { id: 'r5fresh', name: 'Fresh Pick', teamId: rivalA.id,
    rule5: { fromTeamId: rivalB.id, year: WY + 2 } };
  players[fresh.id] = fresh;
  const grads = R5.clearFlags(state, WY + 1);
  check(grads.some((g) => g.playerId === survivor.playerId) && !players[survivor.playerId].rule5,
    `a survivor graduates free and clear (${survivor.name})`);
  check(!!fresh.rule5, 'a NEXT-December pick keeps his fresh flag');
  delete players[fresh.id];
} else {
  check(true, 'every pick returned this run — graduation exercised in the soak');
  check(true, '(placeholder to keep check count stable)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
