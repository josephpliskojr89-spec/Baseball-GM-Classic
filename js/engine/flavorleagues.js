// View-only flavor leagues (0.41.0). Unsigned free agents don't sit in a
// void — they "play" somewhere: NPB, the KBO, the Mexican League, or one
// of the independent circuits. NOTHING here simulates: no teams, no
// standings, no games. A league is a tag on the player (p.playsIn) plus
// the monthly stat line minors.js generates against the league's quality
// anchor — pure flavor, so the FA pool reads like a living baseball
// world instead of a waiting room. Indie-ball kids (undrafted college
// FAs among them) keep developing through normal progression and stay
// signable all year.
window.BBGM_FLAVOR = (function () {
  function rand() { return Math.random(); }

  // Anchors sit on the minors.js LEVELS scale (Rookie 31 … AAA 47) so
  // the generated stat quality reads right: NPB plays above AAA, the
  // Frontier League below A-ball.
  const LEAGUES = {
    NPB: { tag: 'NPB', name: 'NPB (Japan)', anchor: 50, noise: 1.0, kind: 'foreign' },
    KBO: { tag: 'KBO', name: 'KBO League (Korea)', anchor: 47, noise: 1.1, kind: 'foreign' },
    MEX: { tag: 'MEX', name: 'Mexican League', anchor: 44, noise: 1.2, kind: 'foreign' },
    ATL: { tag: 'ATL', name: 'Atlantic League (indie)', anchor: 41, noise: 1.4, kind: 'indie' },
    AMA: { tag: 'AmA', name: 'American Association (indie)', anchor: 38, noise: 1.5, kind: 'indie' },
    FRO: { tag: 'FRO', name: 'Frontier League (indie)', anchor: 35, noise: 1.6, kind: 'indie' },
  };

  function pickWeighted(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = rand() * total;
    for (const [k, w] of pairs) {
      if (r < w) return k;
      r -= w;
    }
    return pairs[pairs.length - 1][0];
  }

  // Where does an unsigned player catch on? Young arms and bats grind
  // indie ball (the scouts-watching path back). Quality veterans take
  // the real money in Japan/Korea/Mexico. Old fringe rides the Mexican
  // League and the indies. ~10% sit the year out entirely.
  function rollLeague(p, ovr) {
    if (rand() < 0.10) return null; // training on his own
    if (p.age <= 26) {
      return pickWeighted(ovr >= 46
        ? [['ATL', 0.55], ['AMA', 0.30], ['FRO', 0.15]]
        : [['ATL', 0.25], ['AMA', 0.40], ['FRO', 0.35]]);
    }
    if (ovr >= 50) return pickWeighted([['NPB', 0.40], ['KBO', 0.30], ['MEX', 0.30]]);
    if (ovr >= 44) return pickWeighted([['MEX', 0.50], ['KBO', 0.15], ['ATL', 0.25], ['AMA', 0.10]]);
    return pickWeighted([['MEX', 0.35], ['ATL', 0.25], ['AMA', 0.25], ['FRO', 0.15]]);
  }

  // Stamp a league on every unsigned FA once per season (idempotent per
  // year). Rides the monthly tick, so a mid-season release catches on
  // somewhere by the next 1st of the month.
  function ensureAssignments(state, year) {
    const R = window.BBGM_ROSTER;
    for (const id of state.freeAgents || []) {
      const p = state.players[id];
      if (!p || p.retired || p.status !== 'FA') continue;
      if (p.playsInYear === year) continue;
      p.playsInYear = year;
      const key = rollLeague(p, R.overall(p));
      if (key) p.playsIn = key; else delete p.playsIn;
    }
  }

  // Options for minors.monthlyLine when generating a flavor line.
  function lineOpts(p) {
    const def = LEAGUES[p.playsIn];
    if (!def) return null;
    return { league: def.tag, anchor: def.anchor, noise: def.noise };
  }

  function leagueName(key) {
    return LEAGUES[key] ? LEAGUES[key].name : null;
  }

  return { LEAGUES, ensureAssignments, lineOpts, leagueName, rollLeague };
})();
