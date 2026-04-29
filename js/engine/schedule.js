// Schedule generation. Aim: 162 games per team, roughly 81 home / 81 away.
// Plausible-not-perfect (per bible 3.2).
window.BBGM_SCHEDULE = (function () {
  const { rint, pick, shuffle } = window.BBGM_RNG;
  const D = window.BBGM_DATES;

  function generate(rng, league, year) {
    const teams = league.teams;

    // Group teams by league/division
    const byLeague = { A: [], B: [] };
    for (const t of teams) byLeague[t.league].push(t);
    const byDivision = {};
    for (const t of teams) {
      const key = `${t.league}/${t.division}`;
      if (!byDivision[key]) byDivision[key] = [];
      byDivision[key].push(t);
    }

    // Compute games-per-pair targets (approximate to hit 162 per team).
    // 4 intra-division opponents × 13 = 52
    // 10 intra-league inter-division × 6 = 60
    // 15 interleague × ~3.3 = 50  (we'll keep simple 4 games each)
    // Total ~162. We'll target close.
    // Actual approach: build pairs-with-counts, then schedule.

    const pairs = []; // { home, away, games }
    function addPair(a, b, games) {
      // Each "games" is number of games where home is `a` (so balance reverse separately)
      pairs.push({ home: a.id, away: b.id, games });
    }

    // Intra-division: each pair plays 13 games, split 6 home / 7 away or 7/6
    for (const key in byDivision) {
      const div = byDivision[key];
      for (let i = 0; i < div.length; i++) {
        for (let j = i + 1; j < div.length; j++) {
          addPair(div[i], div[j], 7);
          addPair(div[j], div[i], 6);
        }
      }
    }

    // Intra-league inter-division: 6 games each, split 3/3
    for (const lg of ['A', 'B']) {
      const teamList = byLeague[lg];
      for (let i = 0; i < teamList.length; i++) {
        for (let j = i + 1; j < teamList.length; j++) {
          if (teamList[i].division === teamList[j].division) continue;
          addPair(teamList[i], teamList[j], 3);
          addPair(teamList[j], teamList[i], 3);
        }
      }
    }

    // Interleague: each A vs each B once, 4 games (split 2/2)
    for (const a of byLeague.A) {
      for (const b of byLeague.B) {
        addPair(a, b, 2);
        addPair(b, a, 2);
      }
    }

    // Build a flat list of "series" (each pair at home represents a 3-game series usually).
    // We'll convert pairs into series of 3 games (or 2 leftover) until games used.
    const seriesList = [];
    for (const pr of pairs) {
      let remaining = pr.games;
      while (remaining > 0) {
        const len = remaining >= 3 ? 3 : remaining;
        seriesList.push({ home: pr.home, away: pr.away, length: len });
        remaining -= len;
      }
    }

    // Shuffle series for variety
    const series = shuffle(rng, seriesList);

    // Schedule across dates: late March through late September (~26 weeks, 180+ days).
    // Each team should play ~162 games over ~180 days.
    const startDate = D.fromYMD(year, 3, 28);
    const endDate = D.fromYMD(year, 9, 28);
    const totalDays = D.diffDays(startDate, endDate);

    // Build a per-day team schedule. Each team plays at most 1 game per day.
    const teamDays = {};
    for (const t of teams) teamDays[t.id] = new Array(totalDays + 7).fill(null);

    // All-Star break: roughly mid-July (game ~87). We block 4 days.
    const allStarStart = D.diffDays(startDate, D.fromYMD(year, 7, 12));
    const allStarBlock = new Set();
    for (let i = 0; i < 4; i++) allStarBlock.add(allStarStart + i);

    const games = []; // each: { date, homeId, awayId, gameId, played, result }
    let gameSeq = 0;

    function getPlayedGames(teamId, dayIdx) {
      // count consecutive playing days
      let consec = 0;
      for (let d = dayIdx - 1; d >= 0; d--) {
        if (teamDays[teamId][d]) consec++;
        else break;
      }
      return consec;
    }

    // Place each series consecutively on consecutive days. Try multiple passes:
    // first 3-game blocks, then split remainders into 2- or 1-game blocks if needed.
    function placeSeries(homeT, awayT, length) {
      for (let start = 0; start < totalDays - length + 1; start++) {
        let ok = true;
        for (let k = 0; k < length; k++) {
          const d = start + k;
          if (allStarBlock.has(d)) { ok = false; break; }
          if (teamDays[homeT][d] || teamDays[awayT][d]) { ok = false; break; }
          if (getPlayedGames(homeT, d) >= 17 || getPlayedGames(awayT, d) >= 17) { ok = false; break; }
        }
        if (ok) {
          for (let k = 0; k < length; k++) {
            const d = start + k;
            const date = D.addDays(startDate, d);
            const gameId = `g${gameSeq++}`;
            games.push({ gameId, date, homeId: homeT, awayId: awayT, played: false, result: null });
            teamDays[homeT][d] = gameId;
            teamDays[awayT][d] = gameId;
          }
          return true;
        }
      }
      return false;
    }

    const unplaced = [];
    for (const s of series) {
      if (!placeSeries(s.home, s.away, s.length)) {
        unplaced.push(s);
      }
    }
    // For unplaced series, try splitting into smaller chunks
    for (const s of unplaced) {
      let remaining = s.length;
      while (remaining > 0) {
        let placed = false;
        for (const len of [2, 1]) {
          if (len > remaining) continue;
          if (placeSeries(s.home, s.away, len)) {
            remaining -= len;
            placed = true;
            break;
          }
        }
        if (!placed) break;
      }
    }

    games.sort((a, b) => D.compare(a.date, b.date));

    // Compute opening day, all-star, end-of-regular-season
    const openingDay = startDate;
    const allStarDate = D.fromYMD(year, 7, 14);
    const seasonEnd = endDate;

    return {
      year,
      games,
      openingDay,
      allStarDate,
      seasonEnd,
    };
  }

  return { generate };
})();
