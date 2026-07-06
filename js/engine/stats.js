// Stats system - aggregation and rate calculations.
window.BBGM_STATS = (function () {
  function ensureSeason(player, year) {
    if (!player.stats[year]) {
      player.stats[year] = player.isPitcher ? emptyPitcher() : emptyHitter();
    }
    return player.stats[year];
  }

  // Pitchers bat in no-DH games (bible 3.1). Their batting stats live on a
  // nested stats[year].batting object — pitching and batting lines share
  // field names (h, bb, k, r, hr), so they can never merge onto one object.
  function ensurePitcherBatting(player, year) {
    const s = ensureSeason(player, year);
    if (!s.batting) s.batting = emptyHitter();
    return s.batting;
  }

  function emptyHitter() {
    return {
      g: 0, ab: 0, pa: 0, h: 0, b2: 0, b3: 0, hr: 0,
      r: 0, rbi: 0, sb: 0, cs: 0, bb: 0, k: 0, hbp: 0,
      sf: 0, sh: 0, gidp: 0,
    };
  }

  function emptyPitcher() {
    return {
      g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, bs: 0, cg: 0, sho: 0,
      ip: 0, ipOuts: 0, h: 0, r: 0, er: 0, hr: 0, bb: 0, k: 0, bf: 0, hbp: 0,
    };
  }

  // Hitter rates
  function avg(s) { return s.ab > 0 ? s.h / s.ab : 0; }
  function obp(s) {
    const denom = s.ab + s.bb + s.hbp + (s.sf || 0);
    return denom > 0 ? (s.h + s.bb + s.hbp) / denom : 0;
  }
  function slg(s) {
    if (s.ab === 0) return 0;
    const tb = s.h - s.b2 - s.b3 - s.hr + 2 * s.b2 + 3 * s.b3 + 4 * s.hr;
    return tb / s.ab;
  }
  function ops(s) { return obp(s) + slg(s); }
  function tb(s) { return (s.h - s.b2 - s.b3 - s.hr) + 2 * s.b2 + 3 * s.b3 + 4 * s.hr; }

  // Pitcher rates
  function era(s) {
    const ip = s.ipOuts / 3;
    return ip > 0 ? (s.er * 9) / ip : 0;
  }
  function whip(s) {
    const ip = s.ipOuts / 3;
    return ip > 0 ? (s.bb + s.h) / ip : 0;
  }
  function k9(s) {
    const ip = s.ipOuts / 3;
    return ip > 0 ? (s.k * 9) / ip : 0;
  }
  function bb9(s) {
    const ip = s.ipOuts / 3;
    return ip > 0 ? (s.bb * 9) / ip : 0;
  }
  function hr9(s) {
    const ip = s.ipOuts / 3;
    return ip > 0 ? (s.hr * 9) / ip : 0;
  }

  function fmtAvg(v) {
    if (v >= 1) return v.toFixed(3);
    return v.toFixed(3).replace(/^0/, '');
  }

  function fmtIP(ipOuts) {
    const innings = Math.floor(ipOuts / 3);
    const rem = ipOuts % 3;
    return `${innings}.${rem}`;
  }

  function addStat(target, source) {
    for (const k in source) {
      if (typeof source[k] === 'number') target[k] = (target[k] || 0) + source[k];
    }
  }

  function teamHittingTotals(team, players, year) {
    const total = emptyHitter();
    for (const id of team.roster) {
      const p = players[id];
      if (!p) continue;
      if (p.isPitcher) {
        // Pitcher batting lines (no-DH games) count toward team hitting.
        const s = p.stats[year];
        if (s && s.batting) addStat(total, s.batting);
        continue;
      }
      const s = p.stats[year];
      if (s) addStat(total, s);
    }
    return total;
  }

  function teamPitchingTotals(team, players, year) {
    const total = emptyPitcher();
    for (const id of team.roster) {
      const p = players[id];
      if (!p || !p.isPitcher) continue;
      const s = p.stats[year];
      if (s) addStat(total, s);
    }
    return total;
  }

  // Internal validation helper used after each simulated game. Verifies the
  // basic counting-stat invariants. Returns { ok, issues }.
  function validateGameStats(gameInfo) {
    const { homeRuns, awayRuns, homeBatterStats, awayBatterStats,
            homePitcherStats, awayPitcherStats, homeOuts, awayOuts } = gameInfo;
    const issues = [];

    function sumField(arr, k) {
      let n = 0;
      for (const s of arr) n += s[k] || 0;
      return n;
    }
    function checkNonNeg(label, obj) {
      for (const k in obj) {
        if (typeof obj[k] === 'number' && obj[k] < 0) {
          issues.push(`${label}.${k} negative (${obj[k]})`);
        }
      }
    }

    // Sums of player stats per side
    const homeBatterRuns = sumField(homeBatterStats, 'r');
    const awayBatterRuns = sumField(awayBatterStats, 'r');
    const homeBatterHits = sumField(homeBatterStats, 'h');
    const awayBatterHits = sumField(awayBatterStats, 'h');
    const homePitcherHits = sumField(homePitcherStats, 'h');
    const awayPitcherHits = sumField(awayPitcherStats, 'h');
    const homePitcherRuns = sumField(homePitcherStats, 'r');
    const awayPitcherRuns = sumField(awayPitcherStats, 'r');
    const homePitcherOuts = sumField(homePitcherStats, 'ipOuts');
    const awayPitcherOuts = sumField(awayPitcherStats, 'ipOuts');

    if (homeBatterRuns !== homeRuns) issues.push(`home batter runs ${homeBatterRuns} ≠ team ${homeRuns}`);
    if (awayBatterRuns !== awayRuns) issues.push(`away batter runs ${awayBatterRuns} ≠ team ${awayRuns}`);

    // Pitcher hits allowed = opponent hits
    if (homePitcherHits !== awayBatterHits) {
      issues.push(`home pitcher hits allowed ${homePitcherHits} ≠ away batter hits ${awayBatterHits}`);
    }
    if (awayPitcherHits !== homeBatterHits) {
      issues.push(`away pitcher hits allowed ${awayPitcherHits} ≠ home batter hits ${homeBatterHits}`);
    }

    // Pitcher runs allowed = opponent runs (responsible-pitcher accounting
    // makes this hold even with mid-inning changes).
    if (homePitcherRuns !== awayRuns) {
      issues.push(`home pitcher runs allowed ${homePitcherRuns} ≠ away team runs ${awayRuns}`);
    }
    if (awayPitcherRuns !== homeRuns) {
      issues.push(`away pitcher runs allowed ${awayPitcherRuns} ≠ home team runs ${homeRuns}`);
    }

    // Pitcher outs == innings pitched by that team.
    if (homePitcherOuts !== homeOuts) {
      issues.push(`home pitcher outs ${homePitcherOuts} ≠ home innings pitched in outs ${homeOuts}`);
    }
    if (awayPitcherOuts !== awayOuts) {
      issues.push(`away pitcher outs ${awayPitcherOuts} ≠ away innings pitched in outs ${awayOuts}`);
    }

    for (const s of homeBatterStats) checkNonNeg('homeBatter', s);
    for (const s of awayBatterStats) checkNonNeg('awayBatter', s);
    for (const s of homePitcherStats) checkNonNeg('homePitcher', s);
    for (const s of awayPitcherStats) checkNonNeg('awayPitcher', s);

    // Earned runs can never exceed runs allowed (unearned-run accounting).
    for (const [label, arr] of [['homePitcher', homePitcherStats], ['awayPitcher', awayPitcherStats]]) {
      for (const s of arr) {
        if ((s.er || 0) > (s.r || 0)) issues.push(`${label} er ${s.er} > r ${s.r}`);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  return {
    ensureSeason, ensurePitcherBatting, emptyHitter, emptyPitcher,
    avg, obp, slg, ops, tb,
    era, whip, k9, bb9, hr9,
    fmtAvg, fmtIP, addStat,
    teamHittingTotals, teamPitchingTotals,
    validateGameStats,
  };
})();
