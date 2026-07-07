// Headless full-season calibration harness (Node, no browser needed).
//
//   node tools/season_harness.js [seed] [seasons]
//
// Loads the browser modules under a fake `window`, generates a league,
// sims full 2,430-game seasons replicating main.js's simOneDay loop, and
// reports calibration metrics against the bible targets (7.2, 7.4.7, 10.7,
// 10.8). With seasons > 1 it runs the postseason + offseason rollover
// between years (progression, retirement, minors sim) and reports
// franchise-level metrics. Run this after any engine/tuning change — the
// per-game stat invariant validation inside simulateGame throws on
// accounting bugs, so a clean run is itself a meaningful regression test.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const files = [
  'js/data/constants.js',
  'js/data/name_pools.js',
  'js/data/city_pools.js',
  'js/data/teams.js',
  'js/util/rng.js',
  'js/util/dates.js',
  'js/generation/ballparks.js',
  'js/generation/league.js',
  'js/generation/players.js',
  'js/engine/schedule.js',
  'js/engine/stats.js',
  'js/engine/injuries.js',
  'js/engine/fatigue.js',
  'js/engine/roster.js',
  'js/engine/progression.js',
  'js/engine/minors.js',
  'js/engine/simulation.js',
  'js/engine/standings.js',
  'js/engine/offseason.js',
];

const sandbox = { window: {}, console, Math, JSON, Array, Object, Date };
vm.createContext(sandbox);
for (const f of files) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const W = sandbox.window;
const D = W.BBGM_DATES, C = W.BBGM_CONSTANTS, S = W.BBGM_STATS, INJ = W.BBGM_INJURIES, FAT = W.BBGM_FATIGUE;

const seed = parseInt(process.argv[2] || '12345', 10);
const rng = W.BBGM_RNG.makeRng(seed);
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
W.BBGM_PLAYER_GEN.validateLeagueReadiness(league, players);
const schedule = W.BBGM_SCHEDULE.generate(rng, league, C.START_YEAR);

const state = {
  version: 'harness',
  meta: { seed, currentDate: D.fromYMD(C.START_YEAR, 3, 28), userTeamId: league.teams[0].id, gamesPlayedByTeam: {} },
  league: { teams: league.teams, schedule },
  players,
  news: [],
};

// ---- Metrics collectors ----
const YEAR = C.START_YEAR;
let ties = 0, extraInnings = 0, longestGame = 9;
let ilStints = 0, dtdStints = 0, tjCount = 0, careerAltering = 0;
const ilPlayersP = new Set(), ilPlayersH = new Set();
let simErrors = 0;
const simErrorMessages = [];
const peakFatigue = {};
let homeWins = 0, totalGames = 0;
const runsByLeague = { east: 0, west: 0 }, gamesByLeague = { east: 0, west: 0 };
let relieverWins = 0;
let fieldingErrors = 0;
let consecDayViolations = 0; // reliever appearing on a 4th straight day

function applyCeilingDrop(p) {
  const c = p.hidden.ceiling;
  const key = p.isPitcher ? 'velocity' : 'speed';
  if (c[key] != null) c[key] = Math.max(20, c[key] - 4);
}

function simOneDay(state) {
  const today = state.meta.currentDate;
  const games = state.league.schedule.games.filter((g) => !g.played && D.eq(g.date, today));
  for (const g of games) {
    try {
      W.BBGM_SIM.simulateGame(state, g);
    } catch (e) {
      simErrors++;
      if (simErrorMessages.length < 5) simErrorMessages.push(e.message);
      g.played = true; g.result = null;
      continue;
    }
    const r = g.result;
    totalGames++;
    if (r.homeRuns === r.awayRuns) ties++;
    if (r.innings > 9) extraInnings++;
    if (r.innings > longestGame) longestGame = r.innings;
    if (r.homeRuns > r.awayRuns) homeWins++;
    const home = state.league.teams.find(t => t.id === g.homeId);
    const away = state.league.teams.find(t => t.id === g.awayId);
    runsByLeague[home.league] += r.homeRuns; gamesByLeague[home.league]++;
    runsByLeague[away.league] += r.awayRuns; gamesByLeague[away.league]++;
    const winSide = r.homeRuns > r.awayRuns ? 'home' : 'away';
    const wp = winSide === 'home' ? r.homeWP : r.awayWP;
    const spid = winSide === 'home' ? r.homeSPid : r.awaySPid;
    if (wp && wp !== spid) relieverWins++;
    fieldingErrors += (r.homeErrors || 0) + (r.awayErrors || 0);
  }
  // Rest-rule audit: consecPitchDays is stamped at game end, so a value of
  // 4+ on a pitcher who worked today means a 4th consecutive day of use.
  for (const pid in state.players) {
    const p = state.players[pid];
    if ((p.consecPitchDays || 0) >= 4 && p.lastPitchedDate && D.eq(p.lastPitchedDate, today)) {
      consecDayViolations++;
    }
  }
  const R = W.BBGM_ROSTER;
  for (const g of games) {
    if (!g.played || !g.result || !g.result.injuries) continue;
    for (const entry of g.result.injuries) {
      const p = state.players[entry.playerId];
      if (!p) continue;
      if (!INJ.isAvailable(p)) continue;
      INJ.placeOnIL(p, entry.injury, today);
      if (entry.injury.careerAltering) { careerAltering++; applyCeilingDrop(p); }
      if (entry.injury.ilType) {
        ilStints++;
        (p.isPitcher ? ilPlayersP : ilPlayersH).add(p.id);
        if (entry.injury.type === 'UCL tear') tjCount++;
        // Roster move: onto team IL, call-up cover (mirrors main.js).
        const team = state.league.teams.find((t) => t.id === p.teamId);
        if (team && team.roster.includes(p.id)) R.placeOnILWithMove(state, team, p);
      } else dtdStints++;
    }
  }
  for (const id in state.players) {
    const p = state.players[id];
    if (INJ.isAvailable(p)) continue;
    const came = INJ.tickRecovery(p);
    if (came) {
      const team = state.league.teams.find((t) => t.id === p.teamId);
      if (team && (team.il || []).includes(p.id)) R.activateFromIL(state, team, p);
    }
  }
  const playedToday = new Set();
  for (const g of games) {
    if (!g.played || !g.result || !g.result.box) continue;
    for (const side of ['home', 'away']) {
      for (const row of g.result.box[side].batters) playedToday.add(row[0]);
    }
  }
  for (const id in state.players) {
    const p = state.players[id];
    if (!p || p.isPitcher) continue;
    if (playedToday.has(id)) FAT.partialRecover(p); else FAT.recover(p);
    const f = p.fatigue || 0;
    if (!(id in peakFatigue) || f > peakFatigue[id]) peakFatigue[id] = f;
  }
  // keep harness memory light (mirrors the effect of main.js pruning)
  for (const g of games) { if (g.result) g.result.gameLog = null; }
  state.meta.currentDate = D.addDays(today, 1);
}

const seasonsArg = Math.max(1, parseInt(process.argv[3] || '1', 10));

function runSeason() {
  let guard = 0;
  while (D.compare(state.meta.currentDate, state.league.schedule.seasonEnd) <= 0 && guard++ < 250) {
    simOneDay(state);
  }
}
runSeason();

// ---- Aggregate ----
const hitTot = S.emptyHitter(), pitTot = S.emptyPitcher(), pitcherBatTot = S.emptyHitter();
const spLines = [], setupG = [], longG = [], closerSV = [], middleG = [], mopupG = [];
let cgTotal = 0, shoTotal = 0;
for (const t of league.teams) {
  for (const id of t.roster.concat(t.minors || [])) {
    const p = players[id];
    if (!p) continue;
    const s = p.stats[YEAR];
    if (!s) continue;
    if (p.isPitcher) {
      S.addStat(pitTot, s);
      cgTotal += s.cg || 0; shoTotal += s.sho || 0;
      if (s.batting) S.addStat(pitcherBatTot, s.batting);
    } else {
      S.addStat(hitTot, s);
    }
  }
  for (const id of t.rotation) {
    const s = players[id].stats[YEAR];
    if (s && s.gs > 0) spLines.push(s.ipOuts / 3 / s.gs);
  }
  const roles = t.bullpenRoles || {};
  for (const id of roles.setup || []) { const s = players[id].stats[YEAR]; if (s) setupG.push(s.g || 0); }
  for (const id of roles.long || []) { const s = players[id].stats[YEAR]; if (s) longG.push(s.g || 0); }
  for (const id of roles.middle || []) { const s = players[id].stats[YEAR]; if (s) middleG.push(s.g || 0); }
  for (const id of roles.mopup || []) { const s = players[id].stats[YEAR]; if (s) mopupG.push(s.g || 0); }
  if (t.closer) { const s = players[t.closer].stats[YEAR]; if (s) closerSV.push({ sv: s.sv || 0, w: s.w || 0 }); }
}
// League-wide batting including pitcher hitting (how classic-era league
// averages were actually computed for the no-DH league).
const leagueBatTot = S.emptyHitter();
S.addStat(leagueBatTot, hitTot);
S.addStat(leagueBatTot, pitcherBatTot);
// addStat also summed the nested-object-free fields; batting has no nesting.

const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = x => (100 * x).toFixed(1) + '%';

let rosterHitters = 0, rosterPitchers = 0;
for (const t of league.teams) for (const id of t.roster) {
  if (players[id].isPitcher) rosterPitchers++; else rosterHitters++;
}

console.log('=== SEASON RESULTS (seed ' + seed + ') ===');
console.log('games:', totalGames, '| sim errors:', simErrors, simErrorMessages.length ? simErrorMessages : '',
  '| TIES (must be 0):', ties, '| extras:', extraInnings, '| longest:', longestGame, 'inn');
console.log('home win pct:', pct(homeWins / totalGames));
console.log('R/G per team: EAST', (runsByLeague.east / gamesByLeague.east).toFixed(2),
  'WEST', (runsByLeague.west / gamesByLeague.west).toFixed(2),
  'ALL', ((runsByLeague.east + runsByLeague.west) / (gamesByLeague.east + gamesByLeague.west)).toFixed(2), '(target 4.7)');
console.log('--- League batting (position players | incl. pitcher hitting) ---');
console.log('BA', S.avg(hitTot).toFixed(3), '|', S.avg(leagueBatTot).toFixed(3), '(t .265)',
  '| OBP', S.obp(hitTot).toFixed(3), '|', S.obp(leagueBatTot).toFixed(3), '(t .340)',
  '| SLG', S.slg(hitTot).toFixed(3), '|', S.slg(leagueBatTot).toFixed(3), '(t .425)');
console.log('K%', pct(hitTot.k / hitTot.pa), '(t 17%) | BB%', pct(hitTot.bb / hitTot.pa), '(t 9%) | HR%', pct(hitTot.hr / hitTot.pa), '(t 2.8%)');
const sbAtt = hitTot.sb + hitTot.cs;
console.log('SB att/team:', (sbAtt / 30).toFixed(0), '(t ~140) | SB%', pct(hitTot.sb / sbAtt), '(t 72%)',
  '| SF/team', (hitTot.sf / 30).toFixed(0), '(t ~40) | SH/team', (hitTot.sh / 30).toFixed(0), '(t ~30) | GIDP/team', (hitTot.gidp / 30).toFixed(0));
console.log('--- Pitcher hitting (no-DH games) ---');
console.log('PA', pitcherBatTot.pa, '| BA', S.avg(pitcherBatTot).toFixed(3), '(t ~.130)',
  '| K%', pct(pitcherBatTot.k / (pitcherBatTot.pa || 1)), '(t ~35-40%)',
  '| BB%', pct(pitcherBatTot.bb / (pitcherBatTot.pa || 1)), '(t ~4-5%)',
  '| HR', pitcherBatTot.hr);
console.log('--- League pitching / defense ---');
console.log('ERA', S.era(pitTot).toFixed(2), '(t 4.20) | WHIP', S.whip(pitTot).toFixed(2), '(t 1.32)',
  '| K/9', S.k9(pitTot).toFixed(1), '(t 7.0) | BB/9', S.bb9(pitTot).toFixed(1), '(t 3.3) | HR/9', S.hr9(pitTot).toFixed(2), '(t 0.95)');
const totalRuns = runsByLeague.east + runsByLeague.west;
console.log('errors/team:', (fieldingErrors / 30).toFixed(0), '(t ~100-120) | unearned run share:',
  pct((pitTot.r - pitTot.er) / (pitTot.r || 1)), '(MLB ~7-8%)');
console.log('CG:', cgTotal, '| SHO:', shoTotal, '| reliever 4th-straight-day appearances (soft rule; depleted-pen fallback only):', consecDayViolations);
console.log('--- Usage (7.4.7) ---');
console.log('SP IP/start avg:', avg(spLines).toFixed(2), '(t 5.5-6.5) range', Math.min(...spLines).toFixed(2), '-', Math.max(...spLines).toFixed(2));
console.log('setup G avg:', avg(setupG).toFixed(0), '(t 60-75) | middle:', avg(middleG).toFixed(0),
  '| long:', avg(longG).toFixed(0), '(t 30-45) | mopup:', avg(mopupG).toFixed(0));
console.log('closer SV avg:', avg(closerSV.map(c => c.sv)).toFixed(0), '(t 25-40) range',
  Math.min(...closerSV.map(c => c.sv)), '-', Math.max(...closerSV.map(c => c.sv)),
  '| closer W avg:', avg(closerSV.map(c => c.w)).toFixed(1));
console.log('reliever wins:', relieverWins, '=', pct(relieverWins / totalGames), 'of games');
console.log('--- Injuries (10.7) ---');
console.log('IL stints:', ilStints, '(t 150-200) | DTD:', dtdStints, '| TJ:', tjCount, '(t 15-25) | career-altering:', careerAltering, '(t 3-8)');
console.log('pitchers w/ IL stint:', pct(ilPlayersP.size / rosterPitchers), '(t ~20-35%) | hitters:', pct(ilPlayersH.size / rosterHitters), '(t ~15-20%)');
console.log('--- Fatigue (10.8) ---');
const catcherPeaks = [], regularPeaks = [], oldPeaks = [];
for (const t of league.teams) {
  for (const spot of (t.lineupRH || [])) {
    const p = players[spot.playerId]; if (!p) continue;
    const pk = peakFatigue[p.id] || 0;
    if (spot.position === 'C') catcherPeaks.push(pk); else regularPeaks.push(pk);
    if (p.age >= 33) oldPeaks.push(pk);
  }
}
console.log('peak fatigue medians — catchers:', median(catcherPeaks).toFixed(0),
  '| regulars:', median(regularPeaks).toFixed(0), '| 33+:', median(oldPeaks).toFixed(0));
const paByLeague = { east: [], west: [] };
for (const t of league.teams) for (const id of t.roster) {
  const p = players[id]; if (p.isPitcher) continue;
  const s = p.stats[YEAR]; if (s && s.pa > 400) paByLeague[t.league].push(s.pa);
}
console.log('avg PA of 400+ PA hitters: EAST', avg(paByLeague.east).toFixed(0), 'WEST', avg(paByLeague.west).toFixed(0));

// ---- Franchise mode: postseason + offseason rollover between seasons ----
if (seasonsArg > 1) {
  console.log('\n=== FRANCHISE MODE: ' + seasonsArg + ' seasons ===');
  const retirementCounts = [];
  let totalNewPlayers = 0;
  for (let si = 1; si <= seasonsArg; si++) {
    const gamesBefore = totalGames, errBefore = simErrors, tiesBefore = ties;
    const runsBefore = runsByLeague.east + runsByLeague.west;
    const sgBefore = gamesByLeague.east + gamesByLeague.west;
    const ilBefore = ilStints;

    const summary = W.BBGM_OFFSEASON.runSeasonRollover(state);
    retirementCounts.push(summary.retirements.length);
    totalNewPlayers += summary.newPlayers;
    const champ = state.league.teams.find((t) => t.id === summary.postseason.champion.id);
    console.log(`${summary.year}: 🏆 ${champ.abbr} (WS ${summary.postseason.worldSeries.score.join('-')})` +
      ` | retired ${summary.retirements.length} | milestones ${summary.milestones.length}` +
      ` | new org players ${summary.newPlayers}`);

    if (si === seasonsArg) break;
    runSeason();
    const rg = (runsByLeague.east + runsByLeague.west - runsBefore) /
               Math.max(1, gamesByLeague.east + gamesByLeague.west - sgBefore);
    console.log(`  ${state.meta.currentDate.year} season: ${totalGames - gamesBefore} games` +
      ` | R/G ${rg.toFixed(2)} | IL stints ${ilStints - ilBefore}` +
      ` | sim errors ${simErrors - errBefore} | ties ${ties - tiesBefore}`);
  }

  // Franchise diagnostics.
  console.log('--- Franchise diagnostics ---');
  try {
    W.BBGM_PLAYER_GEN.validateLeagueReadiness(state.league, state.players);
    console.log('league readiness after ' + seasonsArg + ' seasons: OK');
  } catch (e) {
    console.log('league readiness FAILED:', e.message);
  }
  let retiredCount = 0, activeCount = 0, coachFlags = 0;
  const ovrByAge = {};
  for (const id in state.players) {
    const p = state.players[id];
    if (p.retired) {
      retiredCount++;
      if (p.retired.openToCoaching) coachFlags++;
      continue;
    }
    activeCount++;
    if (p.rosterStatus === '26-man') {
      const bucket = p.age <= 25 ? '<=25' : p.age <= 29 ? '26-29' : p.age <= 33 ? '30-33' : '34+';
      if (!ovrByAge[bucket]) ovrByAge[bucket] = [];
      ovrByAge[bucket].push(W.BBGM_ROSTER.overall(p));
    }
  }
  console.log('players: active', activeCount, '| retired', retiredCount,
    '(open to coaching:', coachFlags + ')', '| retirements/yr', retirementCounts.join(', '));
  const cohorts = ['<=25', '26-29', '30-33', '34+'].map((b) =>
    `${b}: ${avg(ovrByAge[b] || []).toFixed(1)} (n=${(ovrByAge[b] || []).length})`);
  console.log('26-man avg overall by age —', cohorts.join(' | '));
  const champs = state.history.seasons.map((s) => s.championId);
  console.log('champions:', champs.join(', '), '| distinct:', new Set(champs).size);
  const minorsSizes = state.league.teams.map((t) => (t.minors || []).length);
  console.log('minors sizes:', Math.min(...minorsSizes), '-', Math.max(...minorsSizes),
    '| free agents pool:', (state.freeAgents || []).length);
  console.log('save size:', (JSON.stringify(state).length / 1024 / 1024).toFixed(2), 'MB');
}
