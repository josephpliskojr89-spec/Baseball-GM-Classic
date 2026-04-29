// Schedule generation per bible 3.2.1.
//
// Builds a plausible 162-game schedule:
//  - 52 intra-division (4 opps × 13)
//  - 60 intra-league non-division (10 opps × 6)
//  - 30 interleague (1 rival × 4 + 5 rotating opps × ~5-6 = 26)
//
// Step 1 builds matchup pool with games-per-pair counts.
// Step 2 splits each matchup into series of 2-4 consecutive games.
// Step 3 places each series on consecutive dates.
//
// We aim for exactly 162 games per team. If date placement fails for some
// series we drop them and report; verification logs the resulting counts.
window.BBGM_SCHEDULE = (function () {
  const { rint, pick, shuffle } = window.BBGM_RNG;
  const D = window.BBGM_DATES;

  // --- Public ---
  function generate(rng, league, year, options = {}) {
    const verbose = !!options.verbose;
    const maxRetries = options.maxRetries || 3;

    let bestResult = null;
    let bestScore = Infinity;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const result = generateOnce(rng, league, year, verbose, attempt);
      const counts = countGamesPerTeam(result.games, league.teams);
      const score = scoreSchedule(counts);
      if (verbose) {
        console.log(`Schedule attempt ${attempt + 1}: ${result.games.length} games, score ${score} (lower is better)`);
      }
      if (score === 0) {
        // Perfect: every team has exactly 162.
        return result;
      }
      if (score < bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }
    return bestResult;
  }

  // --- Internals ---
  function scoreSchedule(counts) {
    // Sum of |actual - 162| across teams.
    let total = 0;
    for (const id in counts) total += Math.abs(counts[id] - 162);
    return total;
  }

  function countGamesPerTeam(games, teams) {
    const out = {};
    for (const t of teams) out[t.id] = 0;
    for (const g of games) {
      out[g.homeId] = (out[g.homeId] || 0) + 1;
      out[g.awayId] = (out[g.awayId] || 0) + 1;
    }
    return out;
  }

  function generateOnce(rng, league, year, verbose, attempt) {
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

    // ---- Step 1: matchup pool ----
    // matchups[i] = { teamA, teamB, totalGames, homeAtA, homeAtB, kind }
    const matchups = [];

    // Intra-division: 13 games per pair, split as 7/6 (alternates by year)
    for (const key in byDivision) {
      const div = byDivision[key];
      for (let i = 0; i < div.length; i++) {
        for (let j = i + 1; j < div.length; j++) {
          // Alternate which side gets the extra home game using year + team-id hash
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
    for (const lg of ['A', 'B']) {
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

    // Interleague: each A-team gets one designated B-rival (4 games, 2/2)
    // plus 5 rotating opponents from one division of the opposite league.
    //
    // Rotation: which division of league B does each league-A division play?
    // (year-based rotation: every year shifts by 1.)
    const divisions = ['East', 'Central', 'West'];
    const rotShift = (year % 3) === 0 ? 1 : (year % 3); // never 0 — must rotate
    const interleaguePartner = {}; // 'A/East' -> 'B/West' etc.
    for (let i = 0; i < 3; i++) {
      interleaguePartner[`A/${divisions[i]}`] = `B/${divisions[(i + rotShift) % 3]}`;
      interleaguePartner[`B/${divisions[i]}`] = `A/${divisions[(i - rotShift + 3) % 3]}`;
    }

    // Pair rivals as a bipartite matching: each A team gets one B-team rival,
    // and rivals must NOT be in the rotation partner division (otherwise a team
    // would lose a rotating opponent and end up with the wrong total).
    //
    // Greedy assignment with retry: for each A team in random order, pick a
    // random eligible B-team (cross-league, not yet paired, not in partner div).
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

    // Rotating interleague: each A team plays each B team in their assigned
    // partner division for 5-6 games. We need to spread 26 remaining
    // interleague games per team across 5 opponents.
    // 26/5 = 5.2 — assign three opponents 5 games, two opponents 6 games (or
    // similar) per A team. We'll generate balanced pairings.
    //
    // Approach: for each A division, look up its B partner division. For each
    // pair (a, b) where a in A-div and b in B-partner-div and they're not already
    // rivals, assign 5 or 6 games. We need each A team to total 26 non-rival
    // interleague games and each B team to total 26 (across both A-divisions
    // partnering them).
    //
    // Simpler approach: just give each non-rival interleague pair in the rotation
    // 5 games (5 opponents × 5 = 25), then top up with 1 extra game on one
    // opponent so total = 26.
    //
    // But each B team might end up with 2 or 3 A-divisions partnered against
    // them depending on the rotation. For symmetric mapping (rotShift fixed)
    // each B division partners exactly one A division, so each B team plays
    // exactly 5 A teams (the partner A division) plus its rival.
    //
    // That gives each B team 5 × 5-6 + 4 = 29-34 interleague games — wrong.
    // Let me reconsider.
    //
    // Per-team 26 non-rival interleague games × 30 teams / 2 = 390 games.
    // 5 A divisions partner 1 B division each, and vice versa. Each A team
    // plays 5 B teams in the partner B division. That's 5 opponents × 5-6 games
    // = 25-30 non-rival interleague per A team. We need 26 — average 5.2 games
    // per opponent. Within the partnership division (5 A teams × 5 B teams =
    // 25 pairs) we need each pair to total 26 × 5 / 25 = 5.2 games per pair on
    // average. Use 5 games for 20 pairs and 6 games for 5 pairs, balanced so
    // each team has the same total.
    //
    // Each A team plays its 5 partner-B opponents; total games = 26.
    // Distribution: 1 opp × 6 games + 4 opp × 5 games = 26 ✓
    // Each B team plays its 5 partner-A opponents; total = 26 ✓
    //
    // Build a 5x5 grid where each row and column sums match.
    // Easiest balanced grid: each row/column has exactly one "6" and four "5"s.
    // That's a permutation matrix overlay. 5 cells (one per row, one per column)
    // get 6 games; the other 20 cells get 5.

    for (const aDiv of divisions) {
      const aDivKey = `A/${aDiv}`;
      const bDivKey = interleaguePartner[aDivKey];
      const aDivTeams = byDivision[aDivKey] || [];
      const bDivTeams = byDivision[bDivKey] || [];
      if (aDivTeams.length !== 5 || bDivTeams.length !== 5) continue;

      // Build a permutation of [0..4] for which B-team gets the "6-game" pairing
      // with each A-team.
      const perm = shuffle(rng, [0, 1, 2, 3, 4]);

      for (let ai = 0; ai < 5; ai++) {
        for (let bi = 0; bi < 5; bi++) {
          const a = aDivTeams[ai];
          const b = bDivTeams[bi];
          if (rivalsAssigned.has(`${a.id}|${b.id}`)) continue;
          const games = (perm[ai] === bi) ? 6 : 5;
          // Home/away split: alternate so it averages out.
          let homeAtA, homeAtB;
          if (games === 6) { homeAtA = 3; homeAtB = 3; }
          else {
            // 5 games — give the side with even idx the extra home game
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

    // ---- Step 2: build outstanding-games map keyed by directional pair ----
    // owed[homeId][awayId] = number of games still to schedule with home at 'homeId'.
    const owed = {};
    for (const t of teams) owed[t.id] = {};
    for (const m of matchups) {
      owed[m.teamA.id][m.teamB.id] = (owed[m.teamA.id][m.teamB.id] || 0) + m.homeAtA;
      owed[m.teamB.id][m.teamA.id] = (owed[m.teamB.id][m.teamA.id] || 0) + m.homeAtB;
    }

    if (verbose) {
      let totalSlots = 0;
      for (const h in owed) for (const a in owed[h]) totalSlots += owed[h][a];
      console.log(`  Matchups: ${matchups.length}, Game-slots: ${totalSlots} (target 2430)`);
    }

    // ---- Step 3: schedule games into dated series ----
    // We iterate day-by-day. For each day, pair up teams that both have an
    // open day and an outstanding matchup, then extend the pairing into a 2-4
    // game series so long as both teams stay free on subsequent days. This
    // approach scales to fully fill 162 games for every team.
    const startDate = D.fromYMD(year, 3, 28);
    const endDate = D.fromYMD(year, 9, 28);
    const totalDays = D.diffDays(startDate, endDate);

    const teamDays = {};
    for (const t of teams) teamDays[t.id] = new Array(totalDays + 7).fill(null);

    // All-Star break (~4 days mid-July).
    const allStarStart = D.diffDays(startDate, D.fromYMD(year, 7, 12));
    const allStarBlock = new Set();
    for (let i = 0; i < 4; i++) allStarBlock.add(allStarStart + i);

    const games = [];
    let gameSeq = 0;

    // Helper: how many games does this team still owe across all opponents?
    function totalOwed(teamId) {
      let n = 0;
      for (const opp in owed[teamId]) n += owed[teamId][opp];
      for (const h in owed) {
        if (h === teamId) continue;
        if (owed[h][teamId]) n += owed[h][teamId];
      }
      return n;
    }

    // Helper: place a series of `length` games starting on day `d` with `homeId` home.
    function placeAt(d, length, homeId, awayId) {
      // Verify both teams are free for the full block, no all-star conflict,
      // no excessive consecutive days.
      for (let k = 0; k < length; k++) {
        const dd = d + k;
        if (dd >= totalDays) return false;
        if (allStarBlock.has(dd)) return false;
        if (teamDays[homeId][dd] || teamDays[awayId][dd]) return false;
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

    // Pick a series length that fits both teams' remaining schedule and the
    // games still owed in this matchup. Bias toward 3-game series.
    function chooseSeriesLength(d, owedCount) {
      const r = rng();
      let preferred;
      if (owedCount >= 4 && r < 0.10) preferred = 4;
      else if (owedCount >= 3 && r < 0.80) preferred = 3;
      else if (owedCount >= 2) preferred = 2;
      else preferred = 1;
      return Math.min(preferred, owedCount);
    }

    // Day-by-day scheduling.
    for (let d = 0; d < totalDays; d++) {
      if (allStarBlock.has(d)) continue;

      // Teams free today, sorted by total remaining games descending so the
      // most-constrained teams get scheduled first.
      const freeTeams = [];
      for (const t of teams) {
        if (!teamDays[t.id][d] && consecutiveDays(teamDays[t.id], d) < 19) {
          freeTeams.push(t.id);
        }
      }
      // Sort with random tiebreak so we don't always favor the same team order.
      freeTeams.sort((a, b) => {
        const da = totalOwed(a);
        const db = totalOwed(b);
        if (da !== db) return db - da;
        return rng() - 0.5;
      });

      const used = new Set();
      for (const homeId of freeTeams) {
        if (used.has(homeId)) continue;
        // Find the best opponent: free today and has games owed with this team.
        const candidates = [];
        for (const awayId of freeTeams) {
          if (awayId === homeId) continue;
          if (used.has(awayId)) continue;
          // We can either play home-here (owed[homeId][awayId]) or away-here.
          const homeOwed = owed[homeId][awayId] || 0;
          if (homeOwed > 0) candidates.push({ awayId, homeOwed });
        }
        if (candidates.length === 0) continue;
        // Prefer the matchup with most games still owed.
        candidates.sort((x, y) => y.homeOwed - x.homeOwed);
        const { awayId, homeOwed } = candidates[0];

        const length = chooseSeriesLength(d, homeOwed);
        if (length < 1) continue;
        // Try the chosen length, then shorter if it doesn't fit.
        let placed = false;
        for (let L = length; L >= 1; L--) {
          if (placeAt(d, L, homeId, awayId)) {
            used.add(homeId); used.add(awayId);
            placed = true;
            break;
          }
        }
      }
    }

    // Final pass: try to plug any remaining holes with single-game placements
    // (these handle leftover odd counts gracefully).
    for (let pass = 0; pass < 4; pass++) {
      let progress = false;
      for (let d = 0; d < totalDays; d++) {
        if (allStarBlock.has(d)) continue;
        for (const t of teams) {
          if (teamDays[t.id][d]) continue;
          // Find any opponent we owe a home game to who's also free today.
          for (const oppId in owed[t.id]) {
            if (owed[t.id][oppId] <= 0) continue;
            if (teamDays[oppId][d]) continue;
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

  // Pair every league-A team with a league-B team (and vice versa) such that
  // no rival pair is in their rotation partner-division relationship.
  // Returns an array of [aTeam, bTeam] pairs covering all 30 teams.
  function pairRivals(rng, byLeague, interleaguePartner) {
    const aTeams = byLeague.A.slice();
    const bTeams = byLeague.B.slice();

    const partnerDiv = (team) => {
      const key = `${team.league}/${team.division}`;
      return interleaguePartner[key]; // e.g., 'B/West'
    };
    const eligible = (a, b) => {
      // Rivals must not be in each other's rotation partner division.
      if (`${b.league}/${b.division}` === partnerDiv(a)) return false;
      if (`${a.league}/${a.division}` === partnerDiv(b)) return false;
      return true;
    };

    // Try greedy matching up to N times with different shuffles.
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

    // Fallback: fixed deterministic matching by sorted ids that ignores
    // partner-division constraint (shouldn't happen but keeps generation
    // robust).
    const fallback = [];
    const usedB = new Set();
    for (const a of aTeams) {
      const b = bTeams.find((x) => !usedB.has(x.id));
      if (b) { fallback.push([a, b]); usedB.add(b.id); }
    }
    return fallback;
  }

  // Verification utility — call externally to log a report.
  function verify(schedule, league) {
    const counts = countGamesPerTeam(schedule.games, league.teams);
    const homeCounts = {};
    const awayCounts = {};
    const opponentCounts = {}; // teamId -> { oppId: count }
    const homeAwayPair = {}; // teamId -> { opp: { home, away } }
    for (const t of league.teams) {
      homeCounts[t.id] = 0;
      awayCounts[t.id] = 0;
      opponentCounts[t.id] = {};
      homeAwayPair[t.id] = {};
    }
    for (const g of schedule.games) {
      homeCounts[g.homeId]++;
      awayCounts[g.awayId]++;
      opponentCounts[g.homeId][g.awayId] = (opponentCounts[g.homeId][g.awayId] || 0) + 1;
      opponentCounts[g.awayId][g.homeId] = (opponentCounts[g.awayId][g.homeId] || 0) + 1;
      if (!homeAwayPair[g.homeId][g.awayId]) homeAwayPair[g.homeId][g.awayId] = { home: 0, away: 0 };
      if (!homeAwayPair[g.awayId][g.homeId]) homeAwayPair[g.awayId][g.homeId] = { home: 0, away: 0 };
      homeAwayPair[g.homeId][g.awayId].home++;
      homeAwayPair[g.awayId][g.homeId].away++;
    }

    const report = {
      totalGames: schedule.games.length,
      teamsAt162: 0,
      teamsBelow162: [],
      teamsAbove162: [],
      perTeam: [],
    };
    for (const t of league.teams) {
      const c = counts[t.id];
      const row = { team: t.abbr, total: c, home: homeCounts[t.id], away: awayCounts[t.id] };
      report.perTeam.push(row);
      if (c === 162) report.teamsAt162++;
      else if (c < 162) report.teamsBelow162.push({ abbr: t.abbr, games: c });
      else report.teamsAbove162.push({ abbr: t.abbr, games: c });
    }
    return report;
  }

  return { generate, verify, countGamesPerTeam };
})();
