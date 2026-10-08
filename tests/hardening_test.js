// Hardening (v2.18.0): every hole the hostile agent and the 25-season
// soak found, pinned as an engine-level refusal or heal. See
// tests/hostile/REPORT.md for the original findings.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = require('path').join(__dirname, '..');
const files = [
  'js/data/constants.js', 'js/data/name_pools.js', 'js/data/intl_name_pools.js',
  'js/data/city_pools.js', 'js/data/teams.js', 'js/util/rng.js', 'js/util/dates.js',
  'js/state.js',
  'js/generation/ballparks.js', 'js/generation/league.js', 'js/generation/players.js',
  'js/engine/schedule.js', 'js/engine/stats.js', 'js/engine/injuries.js',
  'js/engine/fatigue.js', 'js/engine/roster.js', 'js/engine/progression.js',
  'js/engine/minors.js', 'js/engine/flavorleagues.js', 'js/engine/trades.js',
  'js/engine/freeagency.js', 'js/engine/waivers.js', 'js/engine/staff.js',
  'js/engine/scouting.js', 'js/engine/draft.js', 'js/engine/intl.js', 'js/engine/rule5.js',
  'js/engine/awards.js', 'js/engine/simulation.js', 'js/engine/standings.js',
  'js/engine/offseason.js',
];
const sandbox = { window: {}, console, Math, JSON, Array, Object, Date, Promise, Number,
  CompressionStream, DecompressionStream, Response, TextEncoder, TextDecoder, Uint8Array,
  btoa, atob, setTimeout, clearTimeout };
sandbox.window.CompressionStream = CompressionStream;
vm.createContext(sandbox);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
const W = sandbox.window;
let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '✓ ' : '✗ ') + label); ok ? pass++ : fail++; };
const R = W.BBGM_ROSTER, FA = W.BBGM_FA, TR = W.BBGM_TRADES, INTL = W.BBGM_INTL;

const rng = W.BBGM_RNG.makeRng(1999);
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
const schedule = W.BBGM_SCHEDULE.generate(rng, league, 2026);
const state = { version: 'x', meta: { seed: 1999, userTeamId: league.teams[0].id,
  currentDate: { year: 2026, month: 6, day: 10 }, gamesPlayedByTeam: {} },
  league: { teams: league.teams, schedule }, players, news: [], freeAgents: [], history: { seasons: [] } };
W.BBGM_STAFF.ensureStaff(state); W.BBGM_SCOUT.ensureTiers(state);
for (const t of league.teams) R.safeRebuild(state, t);
const user = league.teams[0], rival = league.teams[1];

// ---- 1. Rotation ∩ bullpen (the 40-start season) --------------------------
{
  const t = league.teams[5];
  const arm = players[t.rotation[0]];
  t.rotation = t.rotation.slice(0, 4);           // shrink: ensureRotation must pad
  t.bullpen = t.bullpen || [];
  if (!t.bullpen.includes(arm.id)) t.bullpen.push(arm.id);   // plant him in the pen too
  const sp = W.BBGM_SIM.pickStarter(t, players, state, false);
  const overlap = (t.rotation || []).filter((id) => (t.bullpen || []).includes(id));
  check(!!sp && t.rotation.length === 5 && overlap.length === 0,
    `ensureRotation pads to 5 and nobody sits in rotation AND bullpen (overlap ${overlap.length})`);
}

// ---- 2. Contract shape + offer stacking ------------------------------------
{
  FA.buildMarket(state);
  state.faMarket = state.faMarket || { entries: [], userOffers: [], round: 0, totalRounds: 8 };
  // Put ten real FAs on the market with asks that fit the cap one at a time.
  const pool = Object.values(players).filter((p) => !p.retired && p.status === 'active' && R.overall(p) >= 50).slice(0, 10);
  for (const p of pool) {
    FA.releaseToPool(state, p, 'released');
    FA.addMarketEntry(state, p);
  }
  state.meta.offseasonPhase = 'freeAgency';
  const bad = [[0, 10], [99, 100], [2.5, 10], [1, Infinity], [1, NaN], [1, -5], [3, 1]];
  const refused = bad.filter(([y, t]) => FA.makeUserOffer(state, pool[0].id, y, t) !== null).length;
  check(refused === bad.length, `garbage FA offers refused (${refused}/${bad.length}: years 0/99/2.5, Infinity/NaN/negative, sub-minimum)`);
  const payroll = FA.computePayroll(user, players);
  const cap = user.payrollBase;
  const room = Math.max(1, cap * 1.05 - payroll);
  let placed = 0;
  for (const p of pool) if (FA.makeUserOffer(state, p.id, 1, Math.max(0.74, room * 0.6)) === null) placed++;
  check(placed >= 1 && placed <= 2, `standing offers count as committed money — ${placed} of 10 offers at 60% of room could be placed`);
  const ext = players[user.roster[0]];
  const extBad = [[0, 1], [99, 1e6], [1, Infinity], [2.5, 50]].filter(([y, t]) => FA.offerExtension(state, ext, y, t) !== null).length;
  check(extBad === 4, 'garbage extension offers refused (years 0/99/2.5, Infinity)');
  state.meta.offseasonPhase = null;
}

// ---- 3. Injury-aware trade value -------------------------------------------
{
  const p = players[rival.roster[0]];
  const healthy = TR.tradeValue(p);
  p.ilStatus = { daysRemaining: 400 };
  p.currentInjury = { type: 'Tommy John', careerAltering: true };
  const hurt = TR.tradeValue(p);
  delete p.ilStatus; delete p.currentInjury;
  check(hurt < healthy * 0.5, `a 400-day career-altering injury prices in (TV ${healthy.toFixed(1)} → ${hurt.toFixed(1)})`);
}

// ---- 4. Trade proposal validation ------------------------------------------
{
  const mine = players[user.roster[0]], theirs = players[rival.roster[0]];
  const third = players[league.teams[2].roster[0]];
  const r1 = TR.evaluateProposal(state, rival, [third], [theirs], 0, 0, 0, 0);
  check(r1.verdict === 'reject' && /own organization/.test(r1.feedback), 'giving a third club\'s player is refused');
  const r2 = TR.evaluateProposal(state, rival, [mine, mine], [theirs], 0, 0, 0, 0);
  check(r2.verdict === 'reject' && /twice/.test(r2.feedback), 'a duplicated player is refused');
  const r3 = TR.evaluateProposal(state, rival, [mine], [theirs], 1e9, 0, 0, 0);
  const r4 = TR.evaluateProposal(state, rival, [mine], [theirs], Infinity, 0, 0, 0);
  check(r3.verdict === 'reject' && r4.verdict === 'reject', 'cash of 1e9 / Infinity is refused');
}

// ---- 5. Intl signing guards --------------------------------------------------
{
  INTL.generateClass(state, 2027);
  state.meta.currentDate = { year: 2027, month: 1, day: 20 };
  INTL.openWindow(state);
  check(state.intl.phase === 'window' && state.intl.windowStep === 1, 'window opens on signing day');
  const top = state.intl.board[0];
  const r1 = INTL.userSign(state, top);
  check(!!r1.error, 'step-1 direct signing of a top name is refused');
  // Bid clamp: an absurd user bid is bounded by the remaining pool at resolution.
  const b = state.intl.budgets[user.id];
  state.intl.userOffers[top] = 99;
  const res = INTL.advanceWindow(state);
  const won = (state.intl.signings || []).find((s) => s.prospectId === top && s.teamId === user.id);
  check(!won || won.bonus <= b.pool + 1e-9, `a $99M bid can't exceed the pool (signed for $${won ? won.bonus : '—'}M of $${b.pool}M)`);
  // Step 2: the 130% ceiling first (the pool is nearly spent from the
  // clamped top-tier win), then the duplicate guard with money to spare.
  let blocked = 0, signed = 0;
  for (const id of state.intl.board) {
    const r = INTL.userSign(state, id);
    if (r.error && /league office/.test(r.error)) blocked++;
    else if (!r.error) signed++;
  }
  const bb = state.intl.budgets[user.id];
  check(blocked > 0 && bb.spent <= bb.pool * 1.30 + 0.5, `spending stops ~30% over the pool ($${bb.spent.toFixed(2)}M of $${bb.pool}M; ${blocked} blocked, ${signed} signed)`);
  bb.pool = 500;
  const mid = state.intl.board.find((id) => !(state.intl.signings || []).some((s) => s.prospectId === id));
  const first = INTL.userSign(state, mid);
  const again = INTL.userSign(state, mid);
  check(!first.error && !!again.error, 'the same prospect cannot be signed twice');
  // Date gate: a fresh class can't be resolved early.
  INTL.generateClass(state, 2028);
  state.meta.currentDate = { year: 2027, month: 6, day: 1 };
  const early = INTL.advanceWindow(state);
  check(early.blocked === true && state.intl.phase === 'scouting', 'a class whose window is not open cannot be resolved');
}

// ---- 6. Draft double-pick + Rule 5 once-per-winter -------------------------
{
  state.meta.currentDate = { year: 2027, month: 6, day: 30 };
  W.BBGM_DRAFT.generateClass(state);
  if (W.BBGM_DRAFT.startDraft) W.BBGM_DRAFT.startDraft(state); else state.draft.phase = 'live';
  const pid = state.draft.board ? state.draft.board[0] : Object.keys(state.draft.prospects)[0];
  const a = W.BBGM_DRAFT.makePick(state, pid);
  const bb = W.BBGM_DRAFT.makePick(state, pid);
  check(!!a && bb === null, 'the same prospect cannot be drafted twice');
  state.history.seasons.push({ year: 2027, records: {} });
  state.meta.offseasonPhase = 'freeAgency';
  state.meta.currentDate = { year: 2027, month: 12, day: 10 };
  const d1 = W.BBGM_RULE5.runDraft(state, { auto: true });
  const d2 = W.BBGM_RULE5.runDraft(state, { auto: true });
  check(!d1.already && d2.already === true && (state.rule5History || []).filter((h) => h.year === 2027).length === 1,
    'Rule 5 runs once per winter; a second call is a no-op');
  state.meta.offseasonPhase = null;
}

// ---- 7. Rule 5 doors + injured claim --------------------------------------
{
  const pick = Object.values(players).find((p) => p.rule5 && !p.retired);
  if (pick) {
    const club = league.teams.find((t) => t.id === pick.teamId);
    const home = league.teams.find((t) => t.id === pick.rule5.fromTeamId);
    FA.releaseToPool(state, pick, 'released');
    check(!pick.rule5 && pick.teamId === home.id && !(state.freeAgents || []).includes(pick.id),
      `releasing a Rule 5 pick sends him home instead (${pick.name} → ${home.abbr})`);
  } else {
    check(true, '(no Rule 5 pick landed this run — door covered by the soak)');
  }
  const inj = players[rival.roster[1]];
  inj.ilStatus = { daysRemaining: 30 };
  inj.formerTeamId = rival.id;
  const claimant = league.teams[3];
  W.BBGM_WAIVERS.awardClaim(state, claimant, inj);
  check((claimant.il || []).includes(inj.id) && !claimant.roster.includes(inj.id) && inj.rosterStatus === 'IL',
    'an injured waiver claim joins the IL, not the 26-man');
  delete inj.ilStatus;
}

// ---- 8. Minimum pay + FA-phase heal ----------------------------------------
{
  const p = players[user.roster[2]];
  p.contract = { years: 1, annualSalary: 0.3, totalValue: 0.3 };
  R.enforceMinimumPay(state, user);
  check(p.contract.annualSalary === 0.74, 'sub-minimum pay on the 26-man is raised to $0.74M');
  state.meta.offseasonPhase = 'freeAgency';
  state.faMarket = null;
  let threw = false;
  try { W.BBGM_OFFSEASON.advanceFARound(state); } catch (e) { threw = true; }
  check(!threw && !!state.faMarket, 'an open offseason with no market heals instead of soft-locking');
  state.meta.offseasonPhase = null;
}

// ---- 9. Import validation + save codec -------------------------------------
{
  const ST = W.BBGM_STATE;
  const good = JSON.parse(JSON.stringify({ version: '2.18.0', meta: state.meta, league: state.league, players: state.players }));
  check(ST.structuralSaveError(good) === null, 'a healthy save passes structural validation');
  const bad = [
    [{ ...good, meta: { ...good.meta, currentDate: { year: 'x', month: 99, day: -1 } } }, 'bad date'],
    [{ ...good, meta: { ...good.meta, userTeamId: 'nope' } }, 'bogus user team'],
    [{ ...good, players: {} }, 'no players'],
    [{ ...good, league: { ...good.league, teams: good.league.teams.map((t, i) => i ? t : { ...t, roster: [] }) } }, 'empty user roster'],
    [{ ...good, league: { ...good.league, schedule: null } }, 'no schedule'],
  ];
  const caught = bad.filter(([obj]) => ST.structuralSaveError(obj) !== null).length;
  check(caught === bad.length, `broken saves are refused before anything is written (${caught}/${bad.length}: ${bad.map((b) => b[1]).join(', ')})`);
}
(async () => {
  const ST = W.BBGM_STATE;
  const json = JSON.stringify(state);
  const b64 = await ST.gzipText(json);
  const back = b64 && await ST.gunzipBase64(b64);
  check(!!b64 && ST.isGzipBase64(b64) && back === json && b64.length < json.length * 0.5,
    `native save round-trips through gzip (${(json.length / 1048576).toFixed(1)} MB → ${(b64.length / 1048576).toFixed(2)} MB)`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
