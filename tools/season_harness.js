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
  'js/data/intl_name_pools.js',
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
  'js/engine/trades.js',
  'js/engine/freeagency.js',
  'js/engine/waivers.js',
  'js/engine/staff.js',
  'js/engine/scouting.js',
  'js/engine/draft.js',
  'js/engine/intl.js',
  'js/engine/awards.js',
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
// Staff the league (Phase 10), assign scouting tiers (Phase 13), and let
// each manager set his lineups.
W.BBGM_STAFF.ensureStaff(state);
W.BBGM_SCOUT.ensureTiers(state);
for (const t of state.league.teams) W.BBGM_ROSTER.safeRebuild(state, t);

// ---- Metrics collectors ----
const YEAR = C.START_YEAR;
let ties = 0, extraInnings = 0, longestGame = 9;
let ilStints = 0, dtdStints = 0, tjCount = 0, careerAltering = 0;
const ilPlayersP = new Set(), ilPlayersH = new Set();
let simErrors = 0;
const simErrorMessages = [];
const peakFatigue = {};
let homeWins = 0, totalGames = 0;
const draftLines = [];
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
  // AI trade activity (mirrors main.js).
  W.BBGM_TRADES.aiTradeTick(state, today);
  // Amateur draft: class on May 1, auto-drafted (AI picks every team,
  // including the "user") on June 30 (mirrors main.js + Draft Hub).
  W.BBGM_DRAFT.ensureClass(state, today);
  if (W.BBGM_DRAFT.draftDayPending(state, today)) {
    const recap = W.BBGM_DRAFT.autoRunDraft(state);
    const first = recap.round1[0];
    // Draft-day polish (0.17.0): teenagers arrive RAW — the most polished
    // HS signee should sit in the high 30s / low 40s, not at 50.
    let maxTeenOvr = 0;
    for (const id in state.players) {
      const p = state.players[id];
      if (p.draft && p.draft.year === today.year && p.age <= 18) {
        maxTeenOvr = Math.max(maxTeenOvr, W.BBGM_ROSTER.overall(p));
      }
    }
    draftLines.push(`  ${today.year} draft: strength ${state.draftHistory[state.draftHistory.length - 1].strength}` +
      ` | #1 ${first ? `${first.name} (${first.pos}) to ${first.teamId}` : '?'}` +
      ` | signed ${recap.signedCount}/300` +
      ` | best teen signee OVR ${maxTeenOvr.toFixed(0)} (t <=45)`);
  }
  // International window: class exists all year (rollover / season-1
  // fallback), auto-run on July 2 (mirrors main.js + hub).
  W.BBGM_INTL.ensureClass(state, today);
  if (W.BBGM_INTL.windowPending(state, today)) {
    const recap = W.BBGM_INTL.autoRunWindow(state);
    const top = recap.top5[0];
    draftLines.push(`  ${today.year} intl window: signed ${recap.signedCount}/100` +
      ` | #1 ${top ? `${top.name} (${top.pos}, ${top.country}) $${top.bonus}M to ${top.teamId}` : '?'}`);
  }
  // Intl name pools (0.17.1): every prospect from a pooled country must
  // carry a name drawn from that country's pool, never the Anglo default.
  if (state.intl && state.intl.phase === 'complete' && state.intl.recap && !state.intl.namesChecked) {
    state.intl.namesChecked = true;
    const IN = W.BBGM_INTL_NAMES;
    let wrong = 0;
    for (const id in state.players) {
      const p = state.players[id];
      if (!p.intl || p.intl.year !== today.year) continue;
      const key = IN.COUNTRY_POOL[p.origin];
      if (!key) continue;
      const pool = IN.POOLS[key];
      const first = p.name.split(' ')[0];
      if (!pool.first.includes(first)) {
        wrong++;
        if (wrong <= 3) console.log(`✗ INTL NAME MISMATCH: ${p.name} from ${p.origin}`);
      }
    }
    if (wrong) { console.log(`✗ ${wrong} INTL NAME MISMATCHES in ${today.year}`); process.exit(1); }
  }

  // All-Star Game on the mid-July break (mirrors main.js).
  if (W.BBGM_AWARDS.allStarPending(state, today)) {
    const as = W.BBGM_AWARDS.runAllStar(state);
    const n = ['east', 'west'].reduce((sum, lg) => {
      const r = as.rosters[lg];
      return sum + r.starters.length + r.pitchers.length + r.bench.length;
    }, 0);
    draftLines.push(`  ${today.year} All-Star Game: ${as.winner} wins ${Math.max(as.eastRuns, as.westRuns)}-` +
      `${Math.min(as.eastRuns, as.westRuns)} | MVP ${as.mvp.name} | ${n} selections`);
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
while (draftLines.length) console.log(draftLines.shift());

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
  '| OBP', S.obp(hitTot).toFixed(3), '|', S.obp(leagueBatTot).toFixed(3), '(t .328)',
  '| SLG', S.slg(hitTot).toFixed(3), '|', S.slg(leagueBatTot).toFixed(3), '(t .425)');
console.log('K%', pct(hitTot.k / hitTot.pa), '(t 17%) | BB%', pct(hitTot.bb / hitTot.pa), '(t 8.5%) | HR%', pct(hitTot.hr / hitTot.pa), '(t 2.8%)');
// PA volume (0.26.0 — 2001 calibration): league PA per team-game, ALL
// batters including pitchers hitting. 2001 MLB: 38.3. This is what caps
// season AB/PA extremes at real-record levels (716 AB / 778 PA).
console.log('PA/team-game:', (leagueBatTot.pa / (30 * 162)).toFixed(1), '(t 38.3)');
// Season-volume extremes: the real record book is 778 PA / 716 AB
// (Rollins 2007). The occasional record-flirting iron-man leadoff year
// is fine; routine 800-PA seasons are the calibration bug 0.26.0 fixed.
{
  let maxPa = 0, maxAb = 0, paName = '', abName = '';
  for (const id in players) {
    const s = players[id].stats && players[id].stats[YEAR];
    if (!s) continue;
    if ((s.pa || 0) > maxPa) { maxPa = s.pa; paName = players[id].name; }
    if ((s.ab || 0) > maxAb) { maxAb = s.ab; abName = players[id].name; }
  }
  console.log(`season volume max: ${maxPa} PA (${paName}) | ${maxAb} AB (${abName}) (records 778/716)`);
}
const sbAtt = hitTot.sb + hitTot.cs;
// Sac bunts split by league: west (pitchers bat + bunt) should far exceed east.
const shByLeague = { east: 0, west: 0 };
for (const t of league.teams) {
  for (const id of t.roster.concat(t.minors || [])) {
    const p = players[id];
    if (!p || !p.stats[YEAR]) continue;
    const s = p.stats[YEAR];
    shByLeague[t.league] += (s.sh || 0) + ((s.batting && s.batting.sh) || 0);
  }
}
console.log('SB att/team:', (sbAtt / 30).toFixed(0), '(t ~140) | SB%', pct(hitTot.sb / sbAtt), '(t 72%)',
  '| SF/team', (hitTot.sf / 30).toFixed(0), '(t ~40) | GIDP/team', (hitTot.gidp / 30).toFixed(0));
console.log('SH/team: EAST', (shByLeague.east / 15).toFixed(0), '| WEST', (shByLeague.west / 15).toFixed(0),
  '(t: west ~40-70 w/ pitcher bunts, east ~10-30)');
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
// Rest management (10.8): lineup regulars should NOT play 162 — managers
// give scheduled days off. Catchers rest most.
const gpC = [], gpReg = [];
let gp160 = 0, ironTraitStarters = 0, ironTrait160 = 0;
for (const t of league.teams) {
  for (const spot of (t.lineupRH || [])) {
    const p = players[spot.playerId];
    if (!p || p.isPitcher) continue;
    const g = (p.stats[YEAR] && p.stats[YEAR].g) || 0;
    if (spot.position === 'C') gpC.push(g); else gpReg.push(g);
    if (g >= 160) gp160++;
    if (W.BBGM_FATIGUE.isIronMan(p)) {
      ironTraitStarters++;
      if (g >= 160) ironTrait160++;
    }
  }
}
console.log('GP of lineup regulars — median C:', median(gpC).toFixed(0), '(t ~120-140)',
  '| median non-C:', median(gpReg).toFixed(0), '(t ~145-155)',
  '| 160+ GP:', gp160, '(t: a handful, all iron-man types)');
console.log('iron-man trait starters:', ironTraitStarters, '| of whom played 160+:', ironTrait160);
// Starter workload (7.4): a 5-man turn tops out around 32-34 starts.
// GS above 36 means rotation holes are funneling starts to whoever is
// healthy (the 50-start-season bug fixed in 0.15.3).
let maxGS = 0, gsOver36 = 0;
const gsOffenders = [];
for (const id in players) {
  const s = players[id].stats && players[id].stats[YEAR];
  const gs = (s && s.gs) || 0;
  if (gs > maxGS) maxGS = gs;
  if (gs > 36) { gsOver36++; gsOffenders.push(`${players[id].name} ${gs}`); }
}
console.log('starter workload — max GS:', maxGS, '(t <=35) | GS>36:', gsOver36,
  gsOffenders.length ? '[' + gsOffenders.join(', ') + ']' : '');
// Single-game feats logged this season (achievements ledger).
const featCounts = {};
for (const id in state.players) {
  for (const f of ((state.players[id].achievements || {}).feats || [])) {
    if (f.year !== YEAR) continue;
    featCounts[f.type] = (featCounts[f.type] || 0) + 1;
  }
}
console.log('feats:', Object.keys(featCounts).sort().map((k) => `${k} ${featCounts[k]}`).join(' | ') || 'none');

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

    const tradesBefore = (state.history && state.history.trades ? state.history.trades.length : 0);
    const summary = W.BBGM_OFFSEASON.runSeasonRollover(state);
    // Regression guard: postseason games must not bleed into the archived
    // regular-season records (every team's record sums to exactly 162).
    const archived = state.history.seasons[state.history.seasons.length - 1].records;
    for (const tid in archived) {
      const r = archived[tid];
      if (r.w + r.l !== 162) {
        console.log(`✗ RECORD POLLUTION: ${tid} archived ${r.w}-${r.l} (${r.w + r.l} games)`);
        process.exit(1);
      }
    }
    retirementCounts.push(summary.retirements.length);
    totalNewPlayers += summary.newPlayers;
    const faSigned = state.faMarket ? state.faMarket.entries.filter((e) => e.signedTeamId).length : 0;
    const faUnsigned = state.faMarket ? state.faMarket.entries.length - faSigned : 0;
    const champ = state.league.teams.find((t) => t.id === summary.postseason.champion.id);
    const staffEv = summary.staffEvents || [];
    console.log(`${summary.year}: 🏆 ${champ.abbr} (WS ${summary.postseason.worldSeries.score.join('-')})` +
      ` | retired ${summary.retirements.length} | milestones ${summary.milestones.length}` +
      ` | FA: ${summary.newFAs} out, ${faSigned} signed, ${faUnsigned} unsigned` +
      ` | trades total ${(state.history.trades || []).length}` +
      ` | staff: ${staffEv.filter((e) => e.kind === 'mgr-fired').length} fired,` +
      ` ${staffEv.filter((e) => e.kind === 'coach-enters').length} retirees→coaching` +
      ` | new org players ${summary.newPlayers}`);
    // Awards sanity (19.1/19.2): both leagues fill the major hardware and
    // the position awards; every winner id resolves to a real player.
    const aw = summary.awards;
    for (const lg of ['east', 'west']) {
      const a = aw && aw[lg];
      if (!a || !a.mvp || !a.cy || !a.roy || !a.reliever || !a.moy) {
        console.log(`✗ AWARDS MISSING: ${lg} ${summary.year} — ` +
          JSON.stringify({ mvp: !!(a && a.mvp), cy: !!(a && a.cy), roy: !!(a && a.roy),
            reliever: !!(a && a.reliever), moy: !!(a && a.moy) }));
        process.exit(1);
      }
      for (const key of ['mvp', 'cy', 'roy', 'reliever']) {
        if (!state.players[a[key].winner.id]) {
          console.log(`✗ AWARD WINNER MISSING FROM POOL: ${lg} ${key} ${a[key].winner.name}`);
          process.exit(1);
        }
      }
      const ggN = Object.keys(a.gg || {}).length, ssN = Object.keys(a.ss || {}).length;
      if (ggN < 8 || ssN < 8) {
        console.log(`✗ POSITION AWARDS THIN: ${lg} ${summary.year} — GG ${ggN}, SS ${ssN}`);
        process.exit(1);
      }
    }
    if (!state.history.allStar || !state.history.allStar[summary.year]) {
      console.log(`✗ ALL-STAR GAME MISSING for ${summary.year}`);
      process.exit(1);
    }
    const awLine = (lg) => `${aw[lg].mvp.winner.name}/${aw[lg].cy.winner.name}/${aw[lg].roy.winner.name}`;
    const hofN = summary.hof ? summary.hof.inducted.length : 0;
    console.log(`  awards E[MVP/Cy/RoY]: ${awLine('east')} | W: ${awLine('west')}` +
      ` | HoF inducted: ${hofN}${hofN ? ' (' + summary.hof.inducted.map((i) => `${i.name} ${i.pct}%`).join(', ') + ')' : ''}` +
      ` | ballot size: ${summary.hof ? summary.hof.ballot.length : 0}`);
    // Youth ceiling (12.4 / 0.17.0): post-rollover, no minor leaguer sits
    // above his age cap (AI reassignment honors it; only user moves can
    // exceed it and the harness has no user).
    const MINR = W.BBGM_MINORS;
    let capViolations = 0;
    const youngest = { AA: 99, AAA: 99 };
    for (const id in state.players) {
      const p = state.players[id];
      if (p.retired || p.status !== 'minors') continue;
      const idx = MINR.ORDER.indexOf(p.rosterStatus);
      if (idx < 0) continue;
      if (idx > MINR.maxLevelIdxForAge(p.age)) capViolations++;
      if (p.rosterStatus === 'AA') youngest.AA = Math.min(youngest.AA, p.age);
      if (p.rosterStatus === 'AAA') youngest.AAA = Math.min(youngest.AAA, p.age);
    }
    console.log(`  youth ceiling: violations ${capViolations} (must be 0)` +
      ` | youngest AA ${youngest.AA} (t 19+) | youngest AAA ${youngest.AAA} (t 21+)`);
    if (capViolations > 0) {
      console.log('✗ YOUTH CEILING VIOLATED');
      process.exit(1);
    }
    // Phase 16 running game: leaders should be true burners in the 40-60
    // range; 30/30 seasons are rare (t 0-3); attempts in the classic band.
    let sbAtt = 0, sb3030 = 0, sbTop = { sb: 0, name: '—' };
    const sbYr = summary.year;
    for (const id in state.players) {
      const s = state.players[id].stats && state.players[id].stats[sbYr];
      if (!s || state.players[id].isPitcher) continue;
      sbAtt += (s.sb || 0) + (s.cs || 0);
      if ((s.sb || 0) >= 30 && (s.hr || 0) >= 30) sb3030++;
      if ((s.sb || 0) > sbTop.sb) sbTop = { sb: s.sb, name: state.players[id].name };
    }
    console.log(`  running game: SB att/team ${(sbAtt / 30).toFixed(0)} (t ~85-125)` +
      ` | 30/30 seasons ${sb3030} (t 0-3) | SB leader ${sbTop.name} ${sbTop.sb}`);

    // Phase 15 offseason flow: AI non-tenders feed the market each
    // December; the user's arb class queues; camp produces battles and
    // a sprinkling of day-to-day knocks (t ~5-13 league-wide).
    const camp = summary.springTraining || { battles: [], injuries: [], userLevelMoves: 0 };
    console.log(`  offseason: non-tenders ${(summary.nonTenders || []).length} (t ~10-35)` +
      ` | user arb cases ${summary.arbCases || 0}` +
      ` | camp battles ${camp.battles.length} | camp injuries ${camp.injuries.length}` +
      ` | ceiling breakouts ${(summary.breakouts || []).length} (t ~10-30)`);

    if (si === seasonsArg) break;
    runSeason();
    while (draftLines.length) console.log(draftLines.shift());
    const rg = (runsByLeague.east + runsByLeague.west - runsBefore) /
               Math.max(1, gamesByLeague.east + gamesByLeague.west - sgBefore);
    // Starter-workload guard every season (not just season 1): GS above 36
    // means rotation IL holes are funneling starts again.
    let seasonMaxGS = 0;
    const yr = state.meta.currentDate.year;
    for (const id in state.players) {
      const s = state.players[id].stats && state.players[id].stats[yr];
      if (s && (s.gs || 0) > seasonMaxGS) seasonMaxGS = s.gs;
    }
    console.log(`  ${state.meta.currentDate.year} season: ${totalGames - gamesBefore} games` +
      ` | R/G ${rg.toFixed(2)} | IL stints ${ilStints - ilBefore}` +
      ` | sim errors ${simErrors - errBefore} | ties ${ties - tiesBefore}` +
      ` | max GS ${seasonMaxGS}` +
      ` | FA pool ${(state.freeAgents || []).length}` +
      ` | active ${Object.keys(state.players).filter((id) => !state.players[id].retired).length}`);
    if (seasonMaxGS > 36) {
      console.log(`✗ STARTER OVERWORK: a pitcher made ${seasonMaxGS} starts in ${yr}`);
      process.exit(1);
    }
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
  // Draft pipeline health: signed draftees flowing into orgs and (after a
  // few seasons of development) onto 26-man rosters.
  let drafteesActive = 0, drafteesMLB = 0, drafteesRetired = 0;
  for (const id in state.players) {
    const p = state.players[id];
    if (!p.draft) continue;
    if (p.retired) { drafteesRetired++; continue; }
    drafteesActive++;
    if (p.rosterStatus === '26-man') drafteesMLB++;
  }
  console.log('draftees: active', drafteesActive, '| on 26-man rosters', drafteesMLB,
    '| washed out', drafteesRetired, '| draft classes archived:', (state.draftHistory || []).length);
  let intlActive = 0, intlMLB = 0, intlEventPlayers = 0;
  for (const id in state.players) {
    const p = state.players[id];
    if (p.intlEvent && !p.retired) intlEventPlayers++;
    if (!p.intl || p.retired) continue;
    intlActive++;
    if (p.rosterStatus === '26-man') intlMLB++;
  }
  console.log('intl signees: active', intlActive, '| on 26-man', intlMLB,
    '| event players (postings/defectors/KBO) active:', intlEventPlayers,
    '| windows archived:', (state.intlHistory || []).length);
  // Star scarcity (bible 4.3): ~60 stars league-wide, pyramid below.
  let n65 = 0, n60 = 0, n55 = 0;
  for (const t of state.league.teams) {
    for (const id of t.roster) {
      const ovr = W.BBGM_ROSTER.overall(state.players[id]);
      if (ovr >= 65) n65++;
      if (ovr >= 60) n60++;
      if (ovr >= 55) n55++;
    }
  }
  console.log(`26-man talent pyramid: 65+ ovr: ${n65} | 60+: ${n60} (t ~60 stars) | 55+: ${n55}`);
  // Hall of Fame accumulation (19.9): target 2-4/yr long-run once careers
  // complete inside the save (first ballots need retired-5yr candidates).
  const hofMembers = Object.keys(state.players).filter((id) => state.players[id].hof);
  const hofYears = Object.keys(state.history.hof || {}).length;
  const asYears = Object.keys(state.history.allStar || {}).length;
  console.log(`HoF: ${hofMembers.length} members over ${hofYears} votes` +
    ` | All-Star Games played: ${asYears}` +
    ` | awards years archived: ${Object.keys(state.history.awards || {}).length}`);
  console.log('total trades logged:', (state.history.trades || []).length,
    '| payroll range:', (() => {
      const ps = state.league.teams.map((t) => W.BBGM_FA.computePayroll(t, state.players));
      return `$${Math.min(...ps).toFixed(0)}M - $${Math.max(...ps).toFixed(0)}M`;
    })());
  console.log('save size:', (JSON.stringify(state).length / 1024 / 1024).toFixed(2), 'MB');
}
