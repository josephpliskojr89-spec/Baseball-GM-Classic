// Standings calculation - sorts teams by win pct then handles tiebreakers (simplified).
window.BBGM_STANDINGS = (function () {
  function sortDivision(teams) {
    return teams.slice().sort((a, b) => {
      const wpA = winPct(a);
      const wpB = winPct(b);
      if (wpA !== wpB) return wpB - wpA;
      const rdA = a.seasonRecord.rs - a.seasonRecord.ra;
      const rdB = b.seasonRecord.rs - b.seasonRecord.ra;
      return rdB - rdA;
    });
  }

  function winPct(team) {
    const r = team.seasonRecord;
    const total = r.w + r.l;
    return total > 0 ? r.w / total : 0;
  }

  function gamesBack(leader, team) {
    const lw = leader.seasonRecord.w, ll = leader.seasonRecord.l;
    const tw = team.seasonRecord.w, tl = team.seasonRecord.l;
    return ((lw - tw) + (tl - ll)) / 2;
  }

  function buildStandings(state) {
    const groups = {};
    for (const t of state.league.teams) {
      const key = `${t.league}/${t.division}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    const result = [];
    for (const lg of ['A', 'B']) {
      for (const div of ['East', 'Central', 'West']) {
        const key = `${lg}/${div}`;
        const sorted = sortDivision(groups[key] || []);
        const leader = sorted[0];
        result.push({
          league: lg,
          division: div,
          teams: sorted.map((t, i) => ({
            team: t,
            rank: i + 1,
            gb: i === 0 ? 0 : gamesBack(leader, t),
            wp: winPct(t),
          })),
        });
      }
    }
    return result;
  }

  return { buildStandings, sortDivision, winPct, gamesBack };
})();
