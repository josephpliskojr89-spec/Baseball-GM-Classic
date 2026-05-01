// Schedule generation per bible 3.2.1.
//
// Builds a valid 162-game schedule per team:
//  - 52 intra-division        (4 opponents × 13 games)
//  - 80 intra-league non-div  (10 opponents × 8 games)
//  - 30 interleague           (1 cross-division rival × 4 + 5 rotating
//                              partner-division opps × 5-6 = 26)
//  Total per team: 52 + 80 + 30 = 162
//  Total league games: 30 × 162 / 2 = 2430
//
// Step 1: build the matchup pool (game-slots per directional pair).
// Step 2: schedule day-by-day, picking matchups still owed and extending
//         into 2-4 game series so long as both teams stay free.
// Step 3: validate. If validation fails, retry with fresh randomness.
//         After a hard retry cap is exceeded, throw — never return an
//         imperfect schedule.
window.BBGM_SCHEDULE = (function () {
  const { rint, pick, shuffle } = window.BBGM_RNG;
  const D = window.BBGM_DATES;

  // Default upper bound on retries before generate() throws. Empirically the
  // generator succeeds on attempt 1 across 100/100 random seeds, so 50 is well
  // above what we ever need in practice.
  const DEFAULT_MAX_ATTEMPTS = 50;

  // -------------------------------------------------------------------------
  // PUBLIC: generate
  // -------------------------------------------------------------------------
  // Returns a valid schedule or throws. Never returns an "imperfect best".
  function generate(rng, league, year, options = {}) {
    const verbose = !!options.verbose;
    const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;

    let lastIssues = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let schedule;
      try {
        schedule = generateOnce(rng, league, year);
      } catch (e) {
        if (verbose) console.warn(`Schedule attempt ${attempt} threw: ${e.message}`);
        lastIssues = [`internal error: ${e.message}`];
        continue;
      }
      const result = validate(schedule, league);
      if (verbose) {
        console.log(`Schedule attempt ${attempt}: ${schedule.games.length} games, ${result.valid ? 'VALID' : 'INVALID'}`);
        if (!result.valid) console.log('  issues:', result.issues);
      }
      if (result.valid) return schedule;
      lastIssues = result.issues;
    }

    const err = new Error(
      `Schedule generation failed after ${maxAttempts} attempts. ` +
      `Last failure: ${lastIssues ? lastIssues.slice(0, 3).join('; ') : 'unknown'}`
    );
    err.code = 'SCHEDULE_GENERATION_FAILED';
    err.lastIssues = lastIssues;
    throw err;
  }

  // -------------------------------------------------------------------------
  // PUBLIC: validate
  // -------------------------------------------------------------------------
  // Returns { valid, issues, ... }. Strict checks per bible 3.2.1:
  //  - total games == 2430
  //  - every team plays exactly 162
  //  - no team has 0 games
  //  - home/away within ±5 of 81/81
  //  - no duplicate game IDs
  //  - no team plays two games on the same date (no doubleheaders)
  function validate(schedule, league) {
    const v = verify(schedule, league);
    const issues = [];

    if (v.totalGames !== 2430) {
      issues.push(`total games ${v.totalGames}, expected 2430`);
    }
    if (v.teamsBelow162.length > 0) {
      issues.push(`teams below 162: ${v.teamsBelow162.map(t => `${t.team}:${t.total}`).join(', ')}`);
    }
    if (v.teamsAbove162.length > 0) {
      issues.push(`teams above 162: ${v.teamsAbove162.map(t => `${t.team}:${t.total}`).join(', ')}`);
    }
    for (const row of v.perTeam) {
      if (row.total === 0) issues.push(`${row.team}: zero games scheduled`);
      const homeAwayDiff = Math.abs(row.home - row.away);
      if (homeAwayDiff > 5) {
        issues.push(`${row.team}: home/away unbalanced (${row.home}/${row.away})`);
      }
    }
    if (v.duplicateGameIds.length > 0) {
      issues.push(`${v.duplicateGameIds.length} duplicate game IDs (e.g., ${v.duplicateGameIds.slice(0, 3).join(', ')})`);
    }
    if (v.invalidSameDayGames.length > 0) {
      issues.push(
        `${v.invalidSameDayGames.length} same-day same-team conflicts ` +
        `(e.g., ${v.invalidSameDayGames.slice(0, 3).map(c => `${c.team} on ${c.date}`).join('; ')})`
      );
    }

    return {
      valid: issues.length === 0,
      issues,
      totalGames: v.totalGames,
      teamsAt162: v.teamsAt162,
      teamsBelow162: v.teamsBelow162,
      teamsAbove162: v.teamsAbove162,
      duplicateGameIds: v.duplicateGameIds,
      invalidSameDayGames: v.invalidSameDayGames,
      perTeam: v.perTeam,
    };
  }

  // -------------------------------------------------------------------------
  // PUBLIC: verify
  // -------------------------------------------------------------------------
  // Reports on the schedule without judging validity. Returns:
  //  - totalGames
  //  - teamsAt162 (count of teams at exactly 162)
  //  - teamsBelow162 / teamsAbove162 (lists of offending teams + game counts)
  //  - duplicateGameIds (list of repeated game IDs)
  //  - invalidSameDayGames (list of same-team same-date conflicts)
  //  - perTeam ([{ team, total, home, away }])
  function verify(schedule, league) {
    const teams = league.teams;
    const counts = {};
    const homeCounts = {};
    const awayCounts = {};
    for (const t of teams) {
      counts[t.id] = 0;
      homeCounts[t.id] = 0;
      awayCounts[t.id] = 0;
    }

    const seenIds = new Set();
    const dupIds = [];
    // teamId -> Map<dateKey, count>; >1 means doubleheader (illegal here).
    const teamDayCounts = {};
    for (const t of teams) teamDayCounts[t.id] = new Map();

    for (const g of schedule.games || []) {
      if (seenIds.has(g.gameId)) dupIds.push(g.gameId);
      else seenIds.add(g.gameId);

      counts[g.homeId] = (counts[g.homeId] || 0) + 1;
      counts[g.awayId] = (counts[g.awayId] || 0) + 1;
      homeCounts[g.homeId] = (homeCounts[g.homeId] || 0) + 1;
      awayCounts[g.awayId] = (awayCounts[g.awayId] || 0) + 1;

      const key = `${g.date.year}-${g.date.month}-${g.date.day}`;
      for (const tid of [g.homeId, g.awayId]) {
        const m = teamDayCounts[tid];
        if (!m) continue; // unknown team id — also invalid, but no crash
        m.set(key, (m.get(key) || 0) + 1);
      }
    }

    const conflicts = [];
    for (const t of teams) {
      const m = teamDayCounts[t.id];
      for (const [date, n] of m.entries()) {
        if (n > 1) conflicts.push({ team: t.abbr, teamId: t.id, date, count: n });
      }
    }

    const perTeam = [];
    const teamsBelow162 = [];
    const teamsAbove162 = [];
    let teamsAt162 = 0;
    for (const t of teams) {
      const c = counts[t.id];
      const row = { team: t.abbr, teamId: t.id, total: c, home: homeCounts[t.id], away: awayCounts[t.id] };
      perTeam.push(row);
      if (c === 162) teamsAt162++;
      else if (c < 162) teamsBelow162.push(row);
      else teamsAbove162.push(row);
    }

    return {
      totalGames: (schedule.games || []).length,
      teamsAt162,
      teamsBelow162,
      teamsAbove162,
      perTeam,
      duplicateGameIds: dupIds,
      invalidSameDayGames: conflicts,
    };
  }

  // -------------------------------------------------------------------------
  // PUBLIC: stressTest (dev-only convenience)
  // -------------------------------------------------------------------------
  // Generates `numSeeds` schedules with random seeds and reports validity.
  // Does not affect game state. Useful from the browser console:
  //   BBGM_SCHEDULE.stressTest(100)
  function stressTest(numSeeds = 100, year = 2026) {
    const results = {
      total: numSeeds,
      valid: 0,
      invalid: 0,
      threwError: 0,
      failures: [], // { seed, issues }
      errors: [],   // { seed, error }
    };
    for (let i = 0; i < numSeeds; i++) {
      const seed = Math.floor(Math.random() * 0xffffffff);
      try {
        const rng = window.BBGM_RNG.makeRng(seed);
        const league = window.BBGM_LEAGUE_GEN.generate(rng);
        const schedule = generate(rng, league, year);
        const v = validate(schedule, league);
        if (v.valid) results.valid++;
        else {
          results.invalid++;
          results.failures.push({ seed, issues: v.issues });
        }
      } catch (e) {
        results.invalid++;
        results.threwError++;
        results.errors.push({ seed, error: e.message });
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // INTERNAL: a single generation attempt
  // -------------------------------------------------------------------------
  function generateOnce(rng, league, year) {
    const teams = league.teams;

    // Group teams by league/division. Leagues are 'east' and 'west' per
    // the NABL fixed-team structure. Each league's three divisions are
    // listed in window.BBGM_DIVISIONS_BY_LEAGUE.
    const byLeague = { east: [], west: [] };
    for (const t of teams) byLeague[t.league].push(t);
    const byDivision = {};
    for (const t of teams) {
      const key = `${t.league}/${t.division}`;
      if (!byDivision[key]) byDivision[key] = [];
      byDivision[key].push(t);
    }

    // ---- Step 1: matchup pool ----
    // matchups[i] = { teamA, teamB, totalGames, homeAtA, homeAtB, kind }
    // Each matchup contributes exactly totalGames game-slots to the league.
    const matchups = [];

    // Intra-division: 13 games per pair, split as 7/6 (alternates by year)
    for (const key in byDivision) {
      const div = byDivision[key];
      for (let i = 0; i < div.length; i++) {
        for (let j = i + 1; j < div.length; j++) {
          const aFirst = ((year + hash(div[i].id) + hash(div[j].id)) % 2) === 0;
          const homeAtA = aFirst ? 7 : 6;
          const homeAtB = 13 - homeAtA;
          matchups.push({
            teamA: div[i], teamB: div[j],
            totalGames: 13, homeAtA, homeAtB, kind: 'div',
          });
        }
      }
    }

    // Intra-league non-division: 8 games per pair (4/4)
    for (const lg of ['east', 'west']) {
      const ts = byLeague[lg];
      for (let i = 0; i < ts.length; i++) {
        for (let j = i + 1; j < ts.length; j++) {
          if (ts[i].division === ts[j].division) continue;
          matchups.push({
            teamA: ts[i], teamB: ts[j],
            totalGames: 8, homeAtA: 4, homeAtB: 4, kind: 'intra',
          });
        }
      }
    }

    // Interleague rotation: each Eastern division plays one Western division
    // each year. Rotation shifts annually so every East/West pair eventually
    // meets in this slot.
    const eastDivs = window.BBGM_DIVISIONS_BY_LEAGUE.east; // Northeast, Central, Southeast
    const westDivs = window.BBGM_DIVISIONS_BY_LEAGUE.west; // Pacific, Midwest, South
    const rotShift = (year % 3) === 0 ? 1 : (year % 3);    // never 0 — must rotate
    const interleaguePartner = {};
    for (let i = 0; i < 3; i++) {
      interleaguePartner[`east/${eastDivs[i]}`] = `west/${westDivs[(i + rotShift) % 3]}`;
      interleaguePartner[`west/${westDivs[i]}`] = `east/${eastDivs[(i - rotShift + 3) % 3]}`;
    }

    // Pair rivals BEFORE the rotation matchups so we can keep rivals out of
    // the partner-division relationship.
    const rivalPairs = pairRivals(rng, byLeague, interleaguePartner);
    const rivalsAssigned = new Set();
    for (const [a, b] of rivalPairs) {
      rivalsAssigned.add(`${a.id}|${b.id}`);
      rivalsAssigned.add(`${b.id}|${a.id}`);
      matchups.push({
        teamA: a, teamB: b,
        totalGames: 4, homeAtA: 2, homeAtB: 2, kind: 'intl_rival',
      });
    }

    // Rotating interleague: each Eastern team plays each Western team in
    // their partner division (5 opps) for 5 or 6 games, totaling 26. Pick a
    // permutation so exactly one E/W pair per Eastern team gets the 6-game
    // slot; rest get 5.
    for (const aDiv of eastDivs) {
      const aDivKey = `east/${aDiv}`;
      const bDivKey = interleaguePartner[aDivKey];
      const aDivTeams = byDivision[aDivKey] || [];
      const bDivTeams = byDivision[bDivKey] || [];
      if (aDivTeams.length !== 5 || bDivTeams.length !== 5) {
        throw new Error(`unexpected division sizes: ${aDivKey}=${aDivTeams.length} ${bDivKey}=${bDivTeams.length}`);
      }
      const perm = shuffle(rng, [0, 1, 2, 3, 4]);
      for (let ai = 0; ai < 5; ai++) {
        for (let bi = 0; bi < 5; bi++) {
          const a = aDivTeams[ai];
          const b = bDivTeams[bi];
          if (rivalsAssigned.has(`${a.id}|${b.id}`)) continue;
          const games = (perm[ai] === bi) ? 6 : 5;
          let homeAtA, homeAtB;
          if (games === 6) { homeAtA = 3; homeAtB = 3; }
          else {
            const aGetsThree = ((ai + bi + year) % 2) === 0;
            homeAtA = aGetsThree ? 3 : 2;
            homeAtB = 5 - homeAtA;
          }
          matchups.push({
            teamA: a, teamB: b,
            totalGames: games, homeAtA, homeAtB, kind: 'intl_rotate',
          });
        }
      }
    }
    // (Rivals are guaranteed to be outside the rotation partner division by
    // pairRivals, so each team gets exactly 5 rotating partner-div opponents.)

    // ---- Step 2: build outstanding game-slots keyed by directional pair ----
    // owed[homeId][awayId] = number of games still to schedule with home at homeId.
    const owed = {};
    for (const t of teams) owed[t.id] = {};
    for (const m of matchups) {
      owed[m.teamA.id][m.teamB.id] = (owed[m.teamA.id][m.teamB.id] || 0) + m.homeAtA;
      owed[m.teamB.id][m.teamA.id] = (owed[m.teamB.id][m.teamA.id] || 0) + m.homeAtB;
    }

    // ---- Step 3: schedule day-by-day ----
    const startDate = D.fromYMD(year, 3, 28);
    const endDate = D.fromYMD(year, 9, 28);
    const totalDays = D.diffDays(startDate, endDate);

    // Per-team day-occupancy. Each cell holds the gameId or null (a non-null
    // value blocks any further game on that day for that team).
    const teamDays = {};
    for (const t of teams) teamDays[t.id] = new Array(totalDays + 7).fill(null);

    const allStarStart = D.diffDays(startDate, D.fromYMD(year, 7, 12));
    const allStarBlock = new Set();
    for (let i = 0; i < 4; i++) allStarBlock.add(allStarStart + i);

    const games = [];
    let gameSeq = 0;

    function totalOwed(teamId) {
      let n = 0;
      for (const opp in owed[teamId]) n += owed[teamId][opp];
      for (const h in owed) {
        if (h === teamId) continue;
        if (owed[h][teamId]) n += owed[h][teamId];
      }
      return n;
    }

    function placeAt(d, length, homeId, awayId) {
      for (let k = 0; k < length; k++) {
        const dd = d + k;
        if (dd >= totalDays) return false;
        if (allStarBlock.has(dd)) return false;
        if (teamDays[homeId][dd] !== null) return false;
        if (teamDays[awayId][dd] !== null) return false;
        if (consecutiveDays(teamDays[homeId], dd) >= 19) return false;
        if (consecutiveDays(teamDays[awayId], dd) >= 19) return false;
      }
      for (let k = 0; k < length; k++) {
        const dd = d + k;
        const date = D.addDays(startDate, dd);
        const gameId = `g${year}_${gameSeq++}`;
        games.push({ gameId, date, homeId, awayId, played: false, result: null });
        teamDays[homeId][dd] = gameId;
        teamDays[awayId][dd] = gameId;
      }
      owed[homeId][awayId] -= length;
      return true;
    }

    function chooseSeriesLength(d, owedCount) {
      const r = rng();
      let preferred;
      if (owedCount >= 4 && r < 0.10) preferred = 4;
      else if (owedCount >= 3 && r < 0.80) preferred = 3;
      else if (owedCount >= 2) preferred = 2;
      else preferred = 1;
      return Math.min(preferred, owedCount);
    }

    for (let d = 0; d < totalDays; d++) {
      if (allStarBlock.has(d)) continue;

      // Teams free today, sorted by total remaining games descending so the
      // most-constrained teams get scheduled first.
      const freeTeams = [];
      for (const t of teams) {
        if (teamDays[t.id][d] === null && consecutiveDays(teamDays[t.id], d) < 19) {
          freeTeams.push(t.id);
        }
      }
      freeTeams.sort((a, b) => {
        const da = totalOwed(a);
        const db = totalOwed(b);
        if (da !== db) return db - da;
        return rng() - 0.5;
      });

      const used = new Set();
      for (const homeId of freeTeams) {
        if (used.has(homeId)) continue;
        const candidates = [];
        for (const awayId of freeTeams) {
          if (awayId === homeId) continue;
          if (used.has(awayId)) continue;
          const homeOwed = owed[homeId][awayId] || 0;
          if (homeOwed > 0) candidates.push({ awayId, homeOwed });
        }
        if (candidates.length === 0) continue;
        candidates.sort((x, y) => y.homeOwed - x.homeOwed);
        const { awayId, homeOwed } = candidates[0];

        const length = chooseSeriesLength(d, homeOwed);
        if (length < 1) continue;
        for (let L = length; L >= 1; L--) {
          if (placeAt(d, L, homeId, awayId)) {
            used.add(homeId); used.add(awayId);
            break;
          }
        }
      }
    }

    // Final pass: plug any remaining holes with single-game placements.
    for (let pass = 0; pass < 4; pass++) {
      let progress = false;
      for (let d = 0; d < totalDays; d++) {
        if (allStarBlock.has(d)) continue;
        for (const t of teams) {
          if (teamDays[t.id][d] !== null) continue;
          for (const oppId in owed[t.id]) {
            if (owed[t.id][oppId] <= 0) continue;
            if (teamDays[oppId][d] !== null) continue;
            if (placeAt(d, 1, t.id, oppId)) { progress = true; break; }
          }
        }
      }
      if (!progress) break;
    }

    games.sort((a, b) => D.compare(a.date, b.date));

    return {
      year,
      games,
      openingDay: startDate,
      allStarDate: D.fromYMD(year, 7, 14),
      seasonEnd: endDate,
    };
  }

  // -------------------------------------------------------------------------
  // INTERNAL helpers
  // -------------------------------------------------------------------------
  function consecutiveDays(arr, beforeIdx) {
    let count = 0;
    for (let d = beforeIdx - 1; d >= 0; d--) {
      if (arr[d]) count++;
      else break;
    }
    return count;
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  // Pair every Eastern team with a Western team such that no rival pair is
  // in the rotation partner-division relationship.
  function pairRivals(rng, byLeague, interleaguePartner) {
    const aTeams = byLeague.east.slice();
    const bTeams = byLeague.west.slice();

    const partnerDiv = (team) => interleaguePartner[`${team.league}/${team.division}`];
    const eligible = (a, b) => {
      if (`${b.league}/${b.division}` === partnerDiv(a)) return false;
      if (`${a.league}/${a.division}` === partnerDiv(b)) return false;
      return true;
    };

    for (let attempt = 0; attempt < 100; attempt++) {
      const shuffled = shuffle(rng, aTeams.slice());
      const usedB = new Set();
      const pairs = [];
      let ok = true;
      for (const a of shuffled) {
        const candidates = shuffle(rng, bTeams.filter((b) => !usedB.has(b.id) && eligible(a, b)));
        if (candidates.length === 0) { ok = false; break; }
        const b = candidates[0];
        pairs.push([a, b]);
        usedB.add(b.id);
      }
      if (ok && pairs.length === aTeams.length) return pairs;
    }
    // Should be unreachable given the constraints, but never silently fail.
    throw new Error('pairRivals: unable to assign cross-league rivals after 100 attempts');
  }

  // Backward-compat helper still used by some UI code.
  function countGamesPerTeam(games, teams) {
    const out = {};
    for (const t of teams) out[t.id] = 0;
    for (const g of games) {
      out[g.homeId] = (out[g.homeId] || 0) + 1;
      out[g.awayId] = (out[g.awayId] || 0) + 1;
    }
    return out;
  }

  return { generate, validate, verify, stressTest, countGamesPerTeam };
})();
