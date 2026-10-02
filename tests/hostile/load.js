// Shared headless loader for hostile QA scripts.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = '/home/user/Baseball-GM-Classic';
const CACHE = path.join(__dirname, 'cache');
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
function loadWindow() {
  const sandbox = { window: {}, console, Math, JSON, Array, Object, Date, Number, String, Set, Map, Error, structuredClone };
  vm.createContext(sandbox);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.window;
}
const W = loadWindow();
const C = W.BBGM_CONSTANTS, D = W.BBGM_DATES;

function newSeasonState(seed = 777) {
  const rng = W.BBGM_RNG.makeRng(seed);
  const league = W.BBGM_LEAGUE_GEN.generate(rng);
  const players = W.BBGM_PLAYER_GEN.generate(rng, league);
  W.BBGM_PLAYER_GEN.validateLeagueReadiness(league, players);
  const schedule = W.BBGM_SCHEDULE.generate(rng, league, C.START_YEAR);
  const state = {
    version: C.VERSION,
    meta: { seed, currentDate: D.fromYMD(C.START_YEAR, 3, 28), userTeamId: league.teams[0].id, gamesPlayedByTeam: {} },
    league: { teams: league.teams, schedule },
    players, news: [], freeAgents: [],
  };
  for (const id in players) W.BBGM_PROGRESSION.alignBirthdate(players[id], state.meta.currentDate);
  W.BBGM_STAFF.ensureStaff(state);
  W.BBGM_SCOUT.ensureTiers(state);
  for (const t of state.league.teams) W.BBGM_ROSTER.safeRebuild(state, t);
  return state;
}

// One simmed day, minimal mirror of main.js / season_harness.
function simOneDay(state, opts = {}) {
  const today = state.meta.currentDate;
  const INJ = W.BBGM_INJURIES, R = W.BBGM_ROSTER;
  W.BBGM_PROGRESSION.birthdayTickAll(state, today);
  W.BBGM_WAIVERS.dailyTick(state, today);
  const games = state.league.schedule.games.filter((g) => !g.played && D.eq(g.date, today));
  const errors = [];
  for (const g of games) {
    try { W.BBGM_SIM.simulateGame(state, g); }
    catch (e) { errors.push(`${today.year}-${today.month}-${today.day} ${g.awayId}@${g.homeId}: ${e.message}`); g.played = true; g.result = null; }
  }
  for (const g of games) {
    if (!g.played || !g.result || !g.result.injuries) continue;
    for (const entry of g.result.injuries) {
      const p = state.players[entry.playerId];
      if (!p || !INJ.isAvailable(p)) continue;
      INJ.placeOnIL(p, entry.injury, today);
      if (entry.injury.ilType) {
        const team = state.league.teams.find((t) => t.id === p.teamId);
        if (team && team.roster.includes(p.id)) R.placeOnILWithMove(state, team, p);
      }
    }
  }
  for (const id in state.players) {
    const p = state.players[id];
    if (INJ.isAvailable(p)) continue;
    if (INJ.tickRecovery(p)) {
      const team = state.league.teams.find((t) => t.id === p.teamId);
      if (team && (team.il || []).includes(p.id)) R.activateFromIL(state, team, p);
    }
  }
  if (!opts.noMoves) R.midSeasonMoves(state, today, { userAuto: true });
  W.BBGM_TRADES.aiTradeTick(state, today);
  W.BBGM_FA.aiMidSeasonTick(state, today);
  W.BBGM_DRAFT.ensureClass(state, today);
  if (W.BBGM_DRAFT.draftDayPending(state, today)) W.BBGM_DRAFT.autoRunDraft(state);
  W.BBGM_INTL.ensureClass(state, today);
  if (W.BBGM_AWARDS.allStarPending(state, today)) W.BBGM_AWARDS.runAllStar(state);
  for (const g of games) { if (g.result) g.result.gameLog = null; }
  state.meta.currentDate = D.addDays(today, 1);
  return errors;
}

function simToSeasonEnd(state) {
  let guard = 0; const errs = [];
  while (D.compare(state.meta.currentDate, state.league.schedule.seasonEnd) <= 0 && guard++ < 250) errs.push(...simOneDay(state));
  return errs;
}

// Cached post-season-end state (regular season fully played).
function seasonEndState(seed = 777) {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE);
  const f = path.join(CACHE, `seasonEnd_${seed}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const state = newSeasonState(seed);
  const errs = simToSeasonEnd(state);
  if (errs.length) console.log('sim errors during cache build:', errs.slice(0, 3));
  fs.writeFileSync(f, JSON.stringify(state));
  return state;
}
// Cached offseason state (Part A run, FA phase open).
function offseasonState(seed = 777) {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE);
  const f = path.join(CACHE, `offseason_${seed}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const state = seasonEndState(seed);
  W.BBGM_OFFSEASON.runSeasonRolloverPartA(state);
  fs.writeFileSync(f, JSON.stringify(state));
  return state;
}

function clone(s) { return JSON.parse(JSON.stringify(s)); }
function userTeam(state) { return state.league.teams.find((t) => t.id === state.meta.userTeamId); }

// Invariant audit: roster sizes, duplicates, cross-team membership, status/teamId consistency.
function audit(state, label) {
  const issues = [];
  const warns = [];
  const seen = new Map();
  for (const t of state.league.teams) {
    const r = t.roster || [], m = t.minors || [], il = t.il || [];
    if (r.length > 26) issues.push(`${t.abbr} roster ${r.length} > 26`);
    for (const [arrName, arr] of [['roster', r], ['minors', m], ['il', il]]) {
      const dup = arr.filter((id, i) => arr.indexOf(id) !== i);
      if (dup.length) issues.push(`${t.abbr}.${arrName} has duplicates: ${dup.join(',')}`);
      for (const id of arr) {
        const p = state.players[id];
        if (!p) { issues.push(`${t.abbr}.${arrName} references missing player ${id}`); continue; }
        if (seen.has(id)) issues.push(`player ${id} (${p.name}) in ${seen.get(id)} AND ${t.abbr}.${arrName}`);
        seen.set(id, `${t.abbr}.${arrName}`);
        if (p.teamId !== t.id) issues.push(`${p.name} in ${t.abbr}.${arrName} but teamId=${p.teamId}`);
        if (arrName === 'roster' && p.status !== 'active') issues.push(`${p.name} on ${t.abbr} 26-man with status=${p.status}`);
        if (arrName === 'minors' && p.status !== 'minors') issues.push(`${p.name} in ${t.abbr} minors with status=${p.status}`);
        if (p.contract) {
          const c = p.contract;
          if (!Number.isFinite(c.annualSalary)) issues.push(`${p.name} salary ${c.annualSalary}`);
          else if (arrName !== 'minors' && !(c.annualSalary >= 0.74 - 1e-9)) warns.push(`${p.name} salary ${c.annualSalary}`);
          if (!(Number.isInteger(c.years) && c.years >= 0)) issues.push(`${p.name} contract years ${c.years}`);
        }
      }
    }
  }
  for (const id of state.freeAgents || []) {
    const p = state.players[id];
    if (!p) { issues.push(`freeAgents references missing ${id}`); continue; }
    if (seen.has(id)) issues.push(`FA ${p.name} also in ${seen.get(id)}`);
    if (p.status !== 'FA') issues.push(`FA list has ${p.name} with status ${p.status}`);
  }
  try { W.BBGM_PLAYER_GEN.validateLeagueReadiness(state.league, state.players); }
  catch (e) { issues.push(`validateLeagueReadiness: ${e.message}`); }
  if (label) console.log(`  [audit ${label}] ${issues.length ? issues.length + ' issue(s): ' + issues.slice(0, 6).join(' | ') : 'clean'}${warns.length ? ` (+${warns.length} sub-min salary warnings)` : ''}`);
  issues.warns = warns;
  return issues;
}

const findings = [];
function finding(sev, title, detail) { findings.push({ sev, title, detail }); console.log(`\n!! [${sev}] ${title}\n   ${detail}`); }
function held(title) { findings.push({ sev: 'HELD', title }); console.log(`   ok  ${title}`); }
function dump(name) { fs.writeFileSync(path.join(__dirname, name + '.findings.json'), JSON.stringify(findings, null, 2)); }

module.exports = { W, C, D, newSeasonState, simOneDay, simToSeasonEnd, seasonEndState, offseasonState, clone, userTeam, audit, finding, held, dump, findings };
