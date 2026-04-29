// Stats system - aggregation and rate calculations.
window.BBGM_STATS = (function () {
  function ensureSeason(player, year) {
    if (!player.stats[year]) {
      player.stats[year] = player.isPitcher ? emptyPitcher() : emptyHitter();
    }
    return player.stats[year];
  }

  function emptyHitter() {
    return { g: 0, ab: 0, pa: 0, h: 0, b2: 0, b3: 0, hr: 0, r: 0, rbi: 0, sb: 0, cs: 0, bb: 0, k: 0, hbp: 0, sf: 0, sh: 0 };
  }

  function emptyPitcher() {
    return { g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, bs: 0, cg: 0, sho: 0, ip: 0, ipOuts: 0, h: 0, r: 0, er: 0, hr: 0, bb: 0, k: 0, bf: 0, hbp: 0 };
  }

  // Hitter rates
  function avg(s) { return s.ab > 0 ? s.h / s.ab : 0; }
  function obp(s) {
    const denom = s.ab + s.bb + s.hbp + s.sf;
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
      if (!p || p.isPitcher) continue;
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

  return {
    ensureSeason, emptyHitter, emptyPitcher,
    avg, obp, slg, ops, tb,
    era, whip, k9, bb9, hr9,
    fmtAvg, fmtIP, addStat,
    teamHittingTotals, teamPitchingTotals,
  };
})();
