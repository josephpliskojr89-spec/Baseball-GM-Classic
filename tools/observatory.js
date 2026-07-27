// The Observatory (re-founding phase 1, bible §22.6): instruments for a
// simulation-first league. No calibration targets live here — the league
// line is an OUTPUT. The observatory answers three questions instead:
//   1. Era line     — what kind of baseball is the league playing?
//   2. Census       — is every archetype alive? (existence, not averages)
//   3. WAR-lite     — who is actually valuable, era-relative?
// Consumed by tools/season_harness.js each season end (pre-rollover, so
// stats are intact) and printable as drift tables across a dynasty.
'use strict';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// wOBA-style linear weights (FG-flavored, era-stable enough for an
// instrument; phase 5 may re-derive them from the sim's own run values).
const W_BB = 0.69, W_HBP = 0.72, W_1B = 0.888, W_2B = 1.271, W_3B = 1.616, W_HR = 2.101;
const WOBA_SCALE = 1.15;
const RUNS_PER_WIN = 10;
// Positional adjustment per 600 PA (defensive spectrum). Unknown → 0.
const POS_ADJ = { C: 12.5, SS: 7.5, '2B': 2.5, '3B': 2.5, CF: 2.5, LF: -7.5, RF: -7.5, '1B': -12.5, DH: -17.5 };

function wobaOf(s) {
  const pa = s.pa || 0;
  if (!pa) return 0;
  const h = s.h || 0, b2 = s.b2 || 0, b3 = s.b3 || 0, hr = s.hr || 0;
  const b1 = h - b2 - b3 - hr;
  const ubb = (s.bb || 0) - (s.ibb || 0);
  return (W_BB * ubb + W_HBP * (s.hbp || 0) + W_1B * b1 + W_2B * b2 + W_3B * b3 + W_HR * hr) / pa;
}

// ---- 1. The era line -------------------------------------------------------
function eraLine(W, state, year) {
  const players = state.players;
  const bat = { pa: 0, ab: 0, h: 0, b2: 0, b3: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, k: 0, sb: 0, cs: 0, sf: 0 };
  const pit = { ipOuts: 0, er: 0, k: 0, bb: 0, hr: 0, cg: 0, sho: 0 };
  for (const id in players) {
    const p = players[id];
    const s = p.stats && p.stats[year];
    if (!s) continue;
    if (s.pa) for (const k in bat) bat[k] += s[k] || 0;
    if (s.ipOuts) {
      pit.ipOuts += s.ipOuts; pit.er += s.er || 0; pit.k += s.k || 0;
      pit.bb += s.bb || 0; pit.hr += s.hr || 0; pit.cg += s.cg || 0; pit.sho += s.sho || 0;
    }
  }
  let rs = 0, g = 0;
  for (const t of state.league.teams) {
    const r = t.seasonRecord || {};
    rs += r.rs || 0; g += (r.w || 0) + (r.l || 0);
  }
  const S = W.BBGM_STATS;
  return {
    year,
    rg: g ? rs / g : 0,
    ba: bat.ab ? bat.h / bat.ab : 0,
    obp: S.obp(bat),
    slg: S.slg(bat),
    kPct: bat.pa ? bat.k / bat.pa : 0,
    bbPct: bat.pa ? bat.bb / bat.pa : 0,
    hrPct: bat.pa ? bat.hr / bat.pa : 0,
    sbPerTeam: bat.sb / 30,
    era: pit.ipOuts ? (pit.er * 27) / pit.ipOuts : 0,
    cg: pit.cg,
    sho: pit.sho,
    lgWoba: wobaOf(bat),
  };
}

// ---- 2. The archetype census -----------------------------------------------
// Existence detectors for the player shapes the game is FOR. `expect` is
// the plausibility band for seasons/league-year once the physics lands —
// an alarm range for the soak report, never a tuning target.
const DETECTORS = [
  { key: 'ttoMonster', label: 'TTO monster (35+ HR, 85+ BB, <=.255)', expect: [0, 3], hitter: true,
    test: (s, x) => s.pa >= 500 && (s.hr || 0) >= 35 && (s.bb || 0) >= 85 && x.avg <= 0.255 },
  { key: 'slugger40', label: '40-homer season', expect: [0, 3], hitter: true,
    test: (s) => s.pa >= 500 && (s.hr || 0) >= 40 },
  { key: 'walkMachine', label: '100-walk season', expect: [0, 4], hitter: true,
    test: (s) => s.pa >= 500 && (s.bb || 0) >= 100 },
  { key: 'tableSetter', label: 'table setter (.300+, 35+ SB, <=12 HR)', expect: [0, 3], hitter: true,
    test: (s, x) => s.pa >= 500 && x.avg >= 0.300 && (s.sb || 0) >= 35 && (s.hr || 0) <= 12 },
  { key: 'burner', label: '45-steal season', expect: [0, 3], hitter: true,
    test: (s) => s.pa >= 500 && (s.sb || 0) >= 45 },
  { key: 'avgKing', label: '.330 batting title chase', expect: [0, 3], hitter: true,
    test: (s, x) => s.pa >= 500 && x.avg >= 0.330 },
  { key: 'solidRegular', label: 'solid regular (20-29 HR, .250-.279)', expect: [6, 30], hitter: true,
    test: (s, x) => s.pa >= 500 && (s.hr || 0) >= 20 && (s.hr || 0) <= 29 && x.avg >= 0.250 && x.avg <= 0.279 },
  { key: 'gloveFirst', label: 'glove-first regular (60+ glove, <=.660 OPS, 450+ PA)', expect: [2, 10], hitter: true,
    test: (s, x, p) => s.pa >= 450 && x.ops <= 0.660 && ((p.ratings.defense || 0) >= 60) },
  { key: 'workhorseAce', label: 'workhorse ace (200+ IP, <=3.10)', expect: [1, 6], hitter: false,
    test: (s, x) => s.ipOuts >= 600 && x.era <= 3.10 },
  { key: 'cgArm', label: '3+ complete games', expect: [0, 4], hitter: false,
    test: (s) => (s.cg || 0) >= 3 },
  { key: 'kMonster', label: 'strikeout monster (150+ IP, 10+ K/9)', expect: [0, 4], hitter: false,
    test: (s, x) => s.ipOuts >= 450 && x.k9 >= 10 },
  { key: 'wildThing', label: 'wild flamethrower (5+ BB/9, 8.5+ K/9, 50+ IP)', expect: [0, 4], hitter: false,
    test: (s, x) => s.ipOuts >= 150 && x.bb9 >= 5 && x.k9 >= 8.5 },
  { key: 'craftyVet', label: 'crafty vet (35+, 150+ IP, <=3.80, <=6 K/9)', expect: [0, 3], hitter: false,
    test: (s, x, p) => p.age >= 35 && s.ipOuts >= 450 && x.era <= 3.80 && x.k9 <= 6.0 },
  { key: 'lightsOut', label: 'lights-out closer (35+ SV, <=2.60)', expect: [1, 4], hitter: false,
    test: (s, x) => (s.sv || 0) >= 35 && x.era <= 2.60 },
  { key: 'fireman', label: 'fireman (relief, 50+ G, 85+ IP, <=3.40)', expect: [0, 4], hitter: false,
    test: (s, x) => !(s.gs > 0) && (s.g || 0) >= 50 && s.ipOuts >= 255 && x.era <= 3.40 },
];

function census(W, state, year) {
  const S = W.BBGM_STATS;
  const out = {};
  for (const d of DETECTORS) out[d.key] = { label: d.label, expect: d.expect, count: 0, examples: [] };
  for (const id in state.players) {
    const p = state.players[id];
    if (p.retired) continue;
    const s = p.stats && p.stats[year];
    if (!s) continue;
    const isHitterLine = (s.pa || 0) > 0 && !p.isPitcher;
    const isPitcherLine = (s.ipOuts || 0) > 0 && p.isPitcher;
    const x = {
      avg: s.ab ? (s.h || 0) / s.ab : 0,
      ops: S.obp(s) + S.slg(s),
      era: s.ipOuts ? ((s.er || 0) * 27) / s.ipOuts : 99,
      k9: s.ipOuts ? ((s.k || 0) * 27) / s.ipOuts : 0,
      bb9: s.ipOuts ? ((s.bb || 0) * 27) / s.ipOuts : 0,
    };
    for (const d of DETECTORS) {
      if (d.hitter ? !isHitterLine : !isPitcherLine) continue;
      if (!d.test(s, x, p)) continue;
      const c = out[d.key];
      c.count++;
      if (c.examples.length < 2) {
        c.examples.push(d.hitter
          ? `${p.name} ${x.avg.toFixed(3).replace(/^0/, '')}/${(s.hr || 0)}HR/${(s.bb || 0)}BB/${(s.sb || 0)}SB`
          : `${p.name} ${x.era.toFixed(2)} ERA, ${(s.ipOuts / 3).toFixed(0)} IP, ${x.k9.toFixed(1)} K/9${s.sv ? ', ' + s.sv + ' SV' : ''}${s.cg ? ', ' + s.cg + ' CG' : ''}`);
      }
    }
  }
  return out;
}

// ---- 3. WAR-lite ------------------------------------------------------------
// Era-relative value. The defensive component is a RATINGS placeholder
// (±~6 runs/season) until phase 4 gives observed, position-routed
// defense; it is marked as such in the report.
function warLite(W, state, year, era) {
  const R = W.BBGM_ROSTER;
  const lgWoba = era.lgWoba || 0.310;
  const lgRA9 = era.era * 1.08; // rough unearned lift over ERA
  const hitters = [], pitchers = [];
  for (const id in state.players) {
    const p = state.players[id];
    if (p.retired) continue;
    const s = p.stats && p.stats[year];
    if (!s) continue;
    if (!p.isPitcher && (s.pa || 0) >= 150) {
      const pa = s.pa;
      const batting = ((wobaOf(s) - lgWoba) / WOBA_SCALE) * pa;
      const running = 0.2 * (s.sb || 0) - 0.41 * (s.cs || 0);
      const posAdj = (POS_ADJ[p.primaryPosition] || 0) * (pa / 600);
      const glove = ((((p.ratings.defense || 50) + (p.ratings.arm || 50)) / 2 - 50) / 25) * 6 * (pa / 600);
      const repl = 20 * (pa / 600);
      const war = (batting + running + posAdj + glove + repl) / RUNS_PER_WIN;
      hitters.push({ id, name: p.name, pos: p.primaryPosition, war, pa });
    } else if (p.isPitcher && (s.ipOuts || 0) >= 90) {
      const ip = s.ipOuts / 3;
      const ra9 = ((s.r != null ? s.r : (s.er || 0) * 1.08) * 27) / s.ipOuts;
      const isSP = (s.gs || 0) >= Math.max(1, (s.g || 1) / 2);
      const repRA9 = lgRA9 * (isSP ? 1.15 : 1.08);
      const war = ((repRA9 - ra9) * ip / 9) / RUNS_PER_WIN;
      pitchers.push({ id, name: p.name, pos: isSP ? 'SP' : 'RP', war, ip });
    }
  }
  hitters.sort((a, b) => b.war - a.war);
  pitchers.sort((a, b) => b.war - a.war);
  return {
    topHitters: hitters.slice(0, 8),
    topPitchers: pitchers.slice(0, 8),
    stars4: hitters.filter((h) => h.war >= 4).length + pitchers.filter((p) => p.war >= 4).length,
    stars6: hitters.filter((h) => h.war >= 6).length + pitchers.filter((p) => p.war >= 6).length,
  };
}

function observe(W, state, year) {
  const era = eraLine(W, state, year);
  return { era, census: census(W, state, year), war: warLite(W, state, year, era) };
}

// ---- Report printers --------------------------------------------------------
function printEraDrift(rows) {
  console.log('\n--- Observatory: era drift (the league line is an output, not a target) ---');
  console.log('year   R/G    BA   OBP   SLG    K%   BB%  HR%  SB/tm  ERA   CG SHO');
  for (const r of rows) {
    const e = r.era;
    console.log(`${e.year}  ${e.rg.toFixed(2)}  ${e.ba.toFixed(3)} ${e.obp.toFixed(3)} ${e.slg.toFixed(3)}` +
      `  ${(e.kPct * 100).toFixed(1)} ${(e.bbPct * 100).toFixed(1)}  ${(e.hrPct * 100).toFixed(1)}` +
      `   ${e.sbPerTeam.toFixed(0).padStart(3)}  ${e.era.toFixed(2)}  ${String(e.cg).padStart(3)} ${String(e.sho).padStart(3)}`);
  }
}

function printCensus(rows) {
  console.log('\n--- Observatory: archetype census (seasons per year; [lo-hi] = alive-and-plausible band) ---');
  const last = rows[rows.length - 1];
  for (const key in last.census) {
    const d = last.census[key];
    const perYear = rows.map((r) => r.census[key].count);
    const m = mean(perYear);
    const flag = m < d.expect[0] ? '⚠ EXTINCT/RARE' : m > d.expect[1] ? '⚠ FLOOD' : 'ok';
    const ex = rows.flatMap((r) => r.census[key].examples).slice(-2);
    console.log(`${d.label.padEnd(52)} avg ${m.toFixed(1).padStart(4)}/yr [${d.expect[0]}-${d.expect[1]}] ${flag}` +
      (ex.length ? ` — e.g. ${ex.join(' | ')}` : ''));
  }
}

function printWar(rows) {
  const last = rows[rows.length - 1];
  console.log('\n--- Observatory: WAR-lite, final season (defense = ratings placeholder until phase 4) ---');
  console.log('4+ WAR players:', last.war.stars4, '| 6+ WAR:', last.war.stars6);
  console.log('top bats:   ' + last.war.topHitters.map((h) => `${h.name} (${h.pos}) ${h.war.toFixed(1)}`).join(' | '));
  console.log('top arms:   ' + last.war.topPitchers.map((p) => `${p.name} (${p.pos}) ${p.war.toFixed(1)}`).join(' | '));
}

function printReport(rows) {
  if (!rows.length) return;
  printEraDrift(rows);
  printCensus(rows);
  printWar(rows);
}

module.exports = { observe, eraLine, census, warLite, printReport, DETECTORS };
