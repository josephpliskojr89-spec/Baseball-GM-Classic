// Side balance at the mint (v2.18.0). The 25-season soak found the league
// tilting to pitching because draft-class hitters reached ~3.5-5 fewer OVR
// points at their ceilings than draft-class pitchers (genesis is balanced).
// Gate: fresh classes reach equal OVR-at-ceiling by side.
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
for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
const W = sandbox.window;
let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '✓ ' : '✗ ') + label); ok ? pass++ : fail++; };

const HIT = ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'defense', 'arm'];
const PIT = ['velocity', 'movement', 'control', 'stuff'];
const ovrAtCeiling = (p) => {
  const q = JSON.parse(JSON.stringify(p));
  for (const k of (p.isPitcher ? PIT : HIT)) q.ratings[k] = p.hidden.ceiling[k];
  if (!p.isPitcher) q.ratings.speed = p.hidden.ceiling.speed || p.ratings.speed;
  return W.BBGM_ROSTER.overall(q);
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sideGap = (list) => {
  const h = list.filter((p) => !p.isPitcher).map(ovrAtCeiling);
  const p = list.filter((p) => p.isPitcher).map(ovrAtCeiling);
  return { h: mean(h), p: mean(p), gap: mean(h) - mean(p), nh: h.length, np: p.length };
};

const rng = W.BBGM_RNG.makeRng(2018);
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
const genesis = sideGap(Object.values(players).filter((p) => !p.retired));
check(Math.abs(genesis.gap) <= 1.5, `genesis balanced: hitters ${genesis.h.toFixed(1)} vs pitchers ${genesis.p.toFixed(1)} at the ceiling`);

const state = { meta: { seed: 2018, userTeamId: league.teams[0].id, currentDate: { year: 2026, month: 5, day: 1 } },
  league, players, news: [], freeAgents: [], history: { seasons: [] } };
W.BBGM_STAFF.ensureStaff(state); W.BBGM_SCOUT.ensureTiers(state);
let dc = [];
for (let i = 0; i < 4; i++) { W.BBGM_DRAFT.generateClass(state); dc = dc.concat(Object.values(state.draft.prospects)); state.draft = null; }
const all = sideGap(dc);
check(Math.abs(all.gap) <= 1.5, `draft classes (x4, n=${dc.length}) balanced: hitters ${all.h.toFixed(1)} vs pitchers ${all.p.toFixed(1)} (gap ${all.gap.toFixed(1)}, |gap| ≤ 1.5)`);
const top = sideGap(dc.slice(0, 100).concat(dc.slice(350, 450), dc.slice(700, 800), dc.slice(1050, 1150)));
check(Math.abs(top.gap) <= 2.0, `draft top-100s balanced: hitters ${top.h.toFixed(1)} vs pitchers ${top.p.toFixed(1)} (gap ${top.gap.toFixed(1)}, |gap| ≤ 2)`);
let ic = [];
for (let i = 0; i < 4; i++) { W.BBGM_INTL.generateClass(state, 2027 + i); ic = ic.concat(Object.values(state.intl.prospects)); }
const intl = sideGap(ic);
check(Math.abs(intl.gap) <= 1.5, `intl classes (x4) balanced: hitters ${intl.h.toFixed(1)} vs pitchers ${intl.p.toFixed(1)} (gap ${intl.gap.toFixed(1)})`);
// Nothing minted above the wall by the lift.
let over = 0;
for (const p of dc.concat(ic)) for (const k in p.hidden.ceiling) if (p.hidden.ceiling[k] > 80) over++;
check(over === 0, 'the hitter lift never mints past the 80 wall');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
