// Postseason + season rollover (bible 18 / Phase 15 slice, extended with
// the interactive free-agency period in 0.9.0).
//
// The offseason now runs in two parts around an interactive FA window:
//
//   runSeasonRolloverPartA(state)
//     1. Postseason (3.4): 12-team bracket through the World Series
//     2. Minor-league season stat lines (12.2), career agg + milestones (8.6)
//     3. Retirements (9.6, with the 17.9 coaching flag)
//     4. Annual progression (9.1-9.5) and aging
//     5. Service time; contract ticks — EXPIRED CONTRACTS NOW REACH FREE
//        AGENCY (16.2) instead of auto-renewing
//     6. FA market built (asking prices, preferences); offseasonPhase set
//
//   advanceFARound(state)  — one bidding round (16.5-16.7); stars sign
//        first (18.8); occasional offseason AI-AI trades
//
//   runSeasonRolloverPartB(state)
//     7. Remaining FA rounds auto-resolve; unsigned FAs stay available for
//        mid-season minor-league deals (16.8/16.9)
//     8. New schedule; injury clocks fast-forwarded season-end → Opening
//        Day (10.5); healed IL players rejoin
//     9. Minors level reassignment + 30-cap (12.4/12.8)
//    10. Org backfill/top-up, self-healing config rebuild, records reset,
//        Opening Day
//
// runSeasonRollover(state) runs A + all rounds + B in one shot (harness,
// "Sim Rest of Offseason" button).
//
// Not yet modeled (later phases): awards voting, manager/coach hiring,
// arbitration, Rule 5, scouting budgets, spring-training battles,
// postseason injuries carrying over.
window.BBGM_OFFSEASON = (function () {
  const D = () => window.BBGM_DATES;
  const S = () => window.BBGM_STATS;
  const GEN = () => window.BBGM_PLAYER_GEN;
  const PROG = () => window.BBGM_PROGRESSION;
  const MIN = () => window.BBGM_MINORS;
  const ROSTER = () => window.BBGM_ROSTER;
  const ST = () => window.BBGM_STANDINGS;
  const FA = () => window.BBGM_FA;
  const TRADES = () => window.BBGM_TRADES;

  function rand() { return Math.random(); }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }

  // ---- Postseason (bible 3.4) --------------------------------------------

  function seedLeague(state, league) {
    const teams = state.league.teams.filter((t) => t.league === league);
    const byDiv = {};
    for (const t of teams) {
      if (!byDiv[t.division]) byDiv[t.division] = [];
      byDiv[t.division].push(t);
    }
    const winners = [];
    for (const div in byDiv) winners.push(ST().sortDivision(byDiv[div])[0]);
    const cmp = (a, b) => {
      const d = ST().winPct(b) - ST().winPct(a);
      if (d !== 0) return d;
      return (b.seasonRecord.rs - b.seasonRecord.ra) - (a.seasonRecord.rs - a.seasonRecord.ra);
    };
    winners.sort(cmp);
    const rest = teams.filter((t) => !winners.includes(t)).sort(cmp);
    return winners.concat(rest.slice(0, 3)); // seeds 1-6
  }

  // Home patterns by series length: true = higher seed hosts.
  const HOST = {
    3: [true, true, true],                       // WC: all at higher seed (3.4)
    5: [true, true, false, false, true],         // 2-2-1
    7: [true, true, false, false, false, true, true], // 2-3-2
  };

  function playSeries(state, high, low, bestOf, cursor, tag, games) {
    const need = Math.floor(bestOf / 2) + 1;
    let hw = 0, lw = 0;
    let n = 0;
    while (hw < need && lw < need) {
      const highHosts = HOST[bestOf][n];
      const g = {
        gameId: `ps${state.meta.currentDate.year}_${tag}_${n}`,
        date: { ...cursor.date },
        homeId: highHosts ? high.id : low.id,
        awayId: highHosts ? low.id : high.id,
        played: false, result: null, postseason: tag,
      };
      window.BBGM_SIM.simulateGame(state, g);
      // October injuries don't carry (simplification — result.injuries are
      // not applied); strip the AB log to keep the save lean.
      if (g.result) { g.result.gameLog = null; g.result.injuries = null; }
      games.push(g);
      const homeWon = g.result.homeRuns > g.result.awayRuns;
      const highWon = (homeWon && highHosts) || (!homeWon && !highHosts);
      if (highWon) hw++; else lw++;
      n++;
      cursor.date = D().addDays(cursor.date, 1);
    }
    cursor.date = D().addDays(cursor.date, 2); // travel/rest between rounds
    // Score is reported from the WINNER's perspective.
    return hw > lw
      ? { winner: high, loser: low, score: [hw, lw] }
      : { winner: low, loser: high, score: [lw, hw] };
  }

  function runPostseason(state) {
    const year = state.meta.currentDate.year;
    S().setStatBucket('postseason');
    const games = [];
    const rounds = [];
    const cursor = { date: D().addDays(state.league.schedule.seasonEnd, 3) };
    const champions = {};

    try {
      for (const lg of ['east', 'west']) {
        const seeds = seedLeague(state, lg);
        // Wild card: 3v6, 4v5 (bo3, all at higher seed); 1 & 2 have byes.
        const wc1 = playSeries(state, seeds[2], seeds[5], 3, cursor, `${lg}_wc1`, games);
        const wc2 = playSeries(state, seeds[3], seeds[4], 3, cursor, `${lg}_wc2`, games);
        // Division series: 1 vs (4/5 winner), 2 vs (3/6 winner).
        const ds1 = playSeries(state, seeds[0], wc2.winner, 5, cursor, `${lg}_ds1`, games);
        const ds2 = playSeries(state, seeds[1], wc1.winner, 5, cursor, `${lg}_ds2`, games);
        // LCS: better regular-season record is the "high" seed.
        const [h, l] = ST().winPct(ds1.winner) >= ST().winPct(ds2.winner)
          ? [ds1.winner, ds2.winner] : [ds2.winner, ds1.winner];
        const lcs = playSeries(state, h, l, 7, cursor, `${lg}_lcs`, games);
        champions[lg] = lcs.winner;
        rounds.push({
          league: lg,
          seeds: seeds.map((t) => t.id),
          wildCard: [seriesSummary(wc1), seriesSummary(wc2)],
          divisionSeries: [seriesSummary(ds1), seriesSummary(ds2)],
          lcs: seriesSummary(lcs),
        });
      }
      // World Series: home field by regular-season record (3.4).
      const [h, l] = ST().winPct(champions.east) >= ST().winPct(champions.west)
        ? [champions.east, champions.west] : [champions.west, champions.east];
      const ws = playSeries(state, h, l, 7, cursor, 'ws', games);
      state.meta.currentDate = { ...cursor.date };
      return {
        year, games, rounds,
        worldSeries: seriesSummary(ws),
        champion: ws.winner, runnerUp: ws.loser,
      };
    } finally {
      S().setStatBucket(null);
    }
  }

  function seriesSummary(s) {
    return { winnerId: s.winner.id, loserId: s.loser.id, score: s.score.slice() };
  }

  // ---- Offseason part A ------------------------------------------------------

  function nextGenId(state) {
    if (!state.meta.nextGenId) state.meta.nextGenId = 1;
    return `g${state.meta.currentDate.year}_${state.meta.nextGenId++}`;
  }

  function runSeasonRolloverPartA(state) {
    const year = state.meta.currentDate.year;
    const players = state.players;
    const teams = state.league.teams;
    const summary = { year, retirements: [], milestones: [], newFAs: 0 };

    // 1. Postseason.
    const ps = runPostseason(state);
    summary.postseason = ps;
    state.league.postseason = {
      year, games: ps.games, rounds: ps.rounds, worldSeries: ps.worldSeries,
      championId: ps.champion.id, runnerUpId: ps.runnerUp.id,
    };
    // Championship rings for the champion's whole active org (26-man + IL).
    const champ = ps.champion;
    for (const pid of champ.roster.concat(champ.il || [])) {
      const p = players[pid];
      if (!p) continue;
      if (!p.achievements) p.achievements = { awards: [], allStarSelections: [], championships: [], milestones: [] };
      p.achievements.championships.push(year);
    }

    // Archive the season NOW, while records are still on the teams
    // (they're reset in part B's rebuild).
    const records = {};
    for (const t of teams) {
      records[t.id] = { w: t.seasonRecord.w, l: t.seasonRecord.l, rs: t.seasonRecord.rs, ra: t.seasonRecord.ra };
    }
    if (!state.history) state.history = { seasons: [] };
    state.history.seasons.push({
      year,
      championId: ps.champion.id,
      runnerUpId: ps.runnerUp.id,
      worldSeries: ps.worldSeries,
      records,
      playoffSeeds: ps.rounds.map((r) => ({ league: r.league, seeds: r.seeds })),
    });

    // 2. Minor-league season stat lines (12.2) — with the ratings the
    // players actually had this season, i.e. before progression.
    for (const id in players) {
      const p = players[id];
      if (p.status === 'minors' && !p.retired) MIN().simSeasonLine(p, year);
    }

    // 3. Career aggregation + milestones (8.6).
    for (const id in players) {
      const p = players[id];
      if (p.retired || !p.stats[year]) continue;
      const crossed = S().aggregateSeasonIntoCareer(p, year);
      for (const m of crossed) summary.milestones.push({ playerId: p.id, name: p.name, ...m });
    }

    // 4. Retirements (9.6). Config cleanup happens in part B's rebuild.
    // Unemployment spells tick first — retirement odds read them (a second
    // unsigned winter drives most careers out of the league).
    for (const id in players) {
      const p = players[id];
      if (!p.retired && p.status === 'FA') p.faSeasons = (p.faSeasons || 0) + 1;
    }
    for (const id in players) {
      const p = players[id];
      if (p.retired) continue;
      if (PROG().rollRetirement(p, year)) {
        summary.retirements.push({
          playerId: p.id, name: p.name, age: p.age,
          overall: Math.round(ROSTER().overall(p)),
          openToCoaching: p.retired.openToCoaching,
          teamId: p.teamId,
        });
      }
    }
    const retiredIds = new Set(summary.retirements.map((r) => r.playerId));
    for (const t of teams) {
      t.roster = t.roster.filter((id) => !retiredIds.has(id));
      t.minors = (t.minors || []).filter((id) => !retiredIds.has(id));
      t.roster40 = (t.roster40 || []).filter((id) => !retiredIds.has(id));
      t.il = (t.il || []).filter((id) => !retiredIds.has(id));
    }
    state.freeAgents = (state.freeAgents || []).filter((id) => !retiredIds.has(id));

    // 4.5. Staff offseason (17.6/17.9): manager records and reputation,
    // owner-driven firings, coach churn, the retired-player coaching
    // pipeline, AI hiring. Runs before progression so this year's coach
    // modifiers reflect the staff that actually coached the season.
    const STAFF = window.BBGM_STAFF;
    STAFF.ensureStaff(state);
    const staffEvents = STAFF.runStaffOffseason(state, records, summary.retirements, year);
    summary.staffEvents = staffEvents;

    // 5. Progression + aging (9.1-9.5), with org coach modifiers (9.3).
    const coachModByTeam = {};
    for (const t of teams) coachModByTeam[t.id] = STAFF.coachModsFor(state, t);
    for (const id in players) {
      const p = players[id];
      if (p.retired) continue;
      const mods = p.teamId && coachModByTeam[p.teamId];
      const coachMod = mods ? (p.isPitcher ? mods.pitching : mods.hitting) : 0;
      PROG().progressPlayer(p, year, coachMod);
      p.age++;
    }

    // 6. Service time and contract ticks. Only players with 6+ years of
    //    service reach free agency when their deal expires (bible 11.4);
    //    everyone else is under team control — renewed at the minimum
    //    pre-arb, or with escalating arbitration raises at 3-5 years
    //    (11.4's simplified arbitration: automatic salary steps, no
    //    hearing process).
    for (const id in players) {
      const p = players[id];
      if (p.retired) continue;
      if (p.rosterStatus === '26-man' || p.rosterStatus === 'IL') {
        p.serviceTime.years = Math.min(20, (p.serviceTime.years || 0) + 1);
      }
      if (p.contract && p.teamId) {
        p.contract.years = Math.max(0, (p.contract.years || 1) - 1);
        if (p.contract.years === 0) {
          const sv = p.serviceTime.years || 0;
          if (sv >= 6) {
            FA().releaseToPool(state, p, 'contract-expired');
            summary.newFAs++;
          } else {
            // Team control: renew. Arb years step toward market value.
            const ovr = ROSTER().overall(p);
            let salary = 0.74;
            if (sv >= 3) {
              const share = sv === 3 ? 0.4 : sv === 4 ? 0.6 : 0.8;
              salary = Math.max(0.74, TRADES().expectedAAV(ovr, p.age) * share);
            }
            salary = Math.round(salary * 10) / 10;
            p.contract = {
              years: 1, annualSalary: salary, totalValue: salary,
              signedAt: sv >= 3 ? 'arbitration' : 'renewal',
            };
          }
        }
      }
    }

    // 6.5. International (bible 14): special-event players (NPB postings,
    // Cuban defectors, KBO declarations) join the FA pool as headline
    // names BEFORE the market is built, and next July's signing class +
    // pool budgets are set (14.1's November 1) so the user can scout all
    // offseason.
    const INTL = window.BBGM_INTL;
    summary.intlEvents = INTL.rollOffseasonEvents(state);
    INTL.generateClass(state, year + 1);

    // 7. Build the FA market and open the window (16.1: mid-November).
    FA().buildMarket(state);
    state.meta.offseasonPhase = 'freeAgency';
    state.meta.currentDate = D().fromYMD(year, 11, 15);
    return summary;
  }

  // ---- FA rounds --------------------------------------------------------------

  // One bidding round (~12 days of the offseason calendar). Occasional
  // offseason AI-AI trades fire alongside the market.
  function advanceFARound(state) {
    if (state.meta.offseasonPhase !== 'freeAgency') return { signings: [], done: true };
    const signings = FA().resolveRound(state);
    state.meta.currentDate = D().addDays(state.meta.currentDate, 12);
    TRADES().aiTradeTick(state, state.meta.currentDate);
    const market = state.faMarket;
    return { signings, round: market.round, done: market.round >= market.totalRounds };
  }

  // ---- Offseason part B ---------------------------------------------------------

  function runSeasonRolloverPartB(state) {
    const players = state.players;
    const teams = state.league.teams;
    const summary = { newPlayers: 0 };
    const year = state.history.seasons[state.history.seasons.length - 1].year;

    // Auto-resolve any remaining FA rounds (user skipped ahead).
    let guard = 0;
    while (state.faMarket && state.faMarket.round < state.faMarket.totalRounds && guard++ < 12) {
      FA().resolveRound(state);
    }
    // Unsigned FAs stay in state.freeAgents for mid-season deals (16.8/16.9).
    state.meta.offseasonPhase = null;

    // New schedule first (Opening Day anchors the clock math).
    const newYear = year + 1;
    const rng = window.BBGM_RNG.makeRng(
      window.BBGM_RNG.hashStringToSeed(`${state.meta.seed}:${newYear}`));
    const oldSeasonEnd = state.league.schedule.seasonEnd;
    const schedule = window.BBGM_SCHEDULE.generate(rng, state.league, newYear);

    // Injury clocks heal on calendar time across the whole offseason —
    // from the last day recovery actually ticked (regular-season end) to
    // Opening Day (10.5).
    const skippedDays = Math.max(0, D().diffDays(oldSeasonEnd, schedule.openingDay));
    for (const id in players) {
      const p = players[id];
      if (p.retired) continue;
      if (p.dayToDayDaysRemaining) { p.dayToDayDaysRemaining = 0; p.currentInjury = null; }
      if (p.ilStatus) {
        p.ilStatus.daysRemaining -= skippedDays;
        if (p.ilStatus.daysRemaining <= 0) { p.ilStatus = null; p.currentInjury = null; }
      }
      p.fatigue = 0;
      p._restNotified = false;
      p.consecPitchDays = 0;
      p.lastPitchedDate = null;
    }
    // Healed IL players rejoin their rosters; still-injured (TJ) stay on IL.
    const INJ = window.BBGM_INJURIES;
    for (const t of teams) {
      const still = [];
      for (const pid of t.il || []) {
        const p = players[pid];
        if (!p) continue;
        if (INJ.isAvailable(p)) {
          t.roster.push(pid);
          p.rosterStatus = '26-man';
          p.status = 'active';
          delete p.ilCallUpFor;
        } else {
          still.push(pid);
        }
      }
      t.il = still;
    }

    // Minors level reassignment + 30-cap (12.4 / 12.8).
    for (const t of teams) {
      for (const pid of t.minors || []) {
        const p = players[pid];
        if (p) MIN().reassignLevel(p);
      }
    }

    // Backfill and top-up every org, then rebuild configs. The 30-cap cut
    // keeps whoever the org would actually keep: ceiling and youth count
    // alongside current ability, so a raw 18-year-old draftee with a 70
    // ceiling outranks the 27-year-old AAA depth arm he displaces (12.8).
    const ceilBest = (p) => {
      const c = (p.hidden && p.hidden.ceiling) || {};
      const vals = Object.keys(c).filter((k) => k !== 'stamina').map((k) => c[k]);
      return vals.length ? Math.max(...vals) : ROSTER().overall(p);
    };
    for (const t of teams) {
      topUpTeam(state, t, summary);
      while ((t.minors || []).length > 30) {
        const cut = t.minors
          .map((id) => players[id])
          .filter(Boolean)
          .sort((a, b) =>
            (ROSTER().overall(a) * 0.7 + ceilBest(a) * 0.5 + (30 - a.age)) -
            (ROSTER().overall(b) * 0.7 + ceilBest(b) * 0.5 + (30 - b.age)))[0];
        if (!cut) break;
        t.minors.splice(t.minors.indexOf(cut.id), 1);
        // Young fringe releases leave affiliated ball entirely (indy ball,
        // back to school) instead of accumulating in the FA pool. A cut kid
        // who never appeared in an MLB game is deleted outright — nothing
        // references him and keeping ~250 washouts/yr as retired players
        // balloons the save.
        const playedMLB = Object.keys(cut.stats || {}).some((y) => {
          const s = cut.stats[y];
          return s && ((s.pa || 0) > 0 || (s.ipOuts || 0) > 0);
        });
        if (cut.age <= 25 && ceilBest(cut) < 62) {
          if (playedMLB) {
            cut.retired = { year, age: cut.age, openToCoaching: false, released: true };
            cut.status = 'retired';
            cut.rosterStatus = 'retired';
            cut.teamId = null;
          } else {
            delete players[cut.id];
          }
        } else {
          FA().releaseToPool(state, cut, 'released');
        }
      }
      rebuildTeamConfig(state, t, summary);
      t.seasonRecord = { w: 0, l: 0, rs: 0, ra: 0, lastTen: [], streak: 0 };
    }

    // Any manager vacancy the user left unfilled is auto-hired at Opening
    // Day (the owner won't start a season without a skipper).
    window.BBGM_STAFF.ensureStaff(state);

    // Fail loud if any org came out of the offseason unplayable.
    GEN().validateLeagueReadiness(state.league, players);

    // Swap in the new season.
    state.pendingTradeOffers = [];
    state.league.schedule = schedule;
    state.meta.gamesPlayedByTeam = {};
    state.meta.currentDate = { ...schedule.openingDay };
    summary.newYear = newYear;
    return summary;
  }

  // One-shot convenience: postseason + full FA auto-resolution + new season.
  function runSeasonRollover(state) {
    const a = runSeasonRolloverPartA(state);
    let guard = 0;
    while (state.faMarket.round < state.faMarket.totalRounds && guard++ < 12) {
      advanceFARound(state);
    }
    const b = runSeasonRolloverPartB(state);
    return { ...a, ...b };
  }

  // Keep an org playable: roster trimmed/filled to 26 (13 P / 13 H target),
  // 5 starting pitchers, 2 catchers, all 8 positions covered, minors depth
  // ≥ 22. Interim stand-in for the draft (Phase 11) — generated players are
  // org depth signings, not stars.
  function topUpTeam(state, team, summary) {
    const players = state.players;
    const inj = window.BBGM_INJURIES;

    const rosterPlayers = () => team.roster.map((id) => players[id]).filter(Boolean);
    const countP = () => rosterPlayers().filter((p) => p.isPitcher).length;
    const countC = () => rosterPlayers().filter((p) => p.primaryPosition === 'C').length;
    const countSP = () => rosterPlayers().filter((p) => p.primaryPosition === 'SP').length;

    // type: 'P' demote a pitcher, 'H' a hitter, undefined either. Never
    // demotes below 2 catchers or 5 SP-primary arms.
    function demoteWeakest(type) {
      const cands = rosterPlayers().filter((p) => {
        if (type === 'P' && !p.isPitcher) return false;
        if (type === 'H' && p.isPitcher) return false;
        if (!p.isPitcher && p.primaryPosition === 'C' && countC() <= 2) return false;
        if (p.isPitcher && p.primaryPosition === 'SP' && countSP() <= 5) return false;
        return true;
      }).sort((a, b) => {
        const ca = a.ilCallUpFor ? 0 : 1;
        const cb = b.ilCallUpFor ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return ROSTER().overall(a) - ROSTER().overall(b);
      });
      const down = cands[0];
      if (!down) return false;
      team.roster.splice(team.roster.indexOf(down.id), 1);
      team.minors.push(down.id);
      down.status = 'minors';
      down.rosterStatus = 'AAA';
      delete down.ilCallUpFor;
      return true;
    }

    function promoteOrGenerate(opts) {
      const pick = ROSTER().bestCallUp(team, players, opts.isPitcher, opts.position || null);
      if (pick && (!opts.position || pick.primaryPosition === opts.position)) {
        team.minors.splice(team.minors.indexOf(pick.id), 1);
        team.roster.push(pick.id);
        pick.status = 'active';
        pick.rosterStatus = '26-man';
        return pick;
      }
      const p = GEN().generateNewPlayer(rand, team, {
        slotPos: opts.slotPos, tier: 'depth', isProspect: false,
        ageRange: { mean: 27, stdev: 2, min: 23, max: 32 },
        status: 'active', rosterStatus: '26-man',
        id: nextGenId(state),
      });
      players[p.id] = p;
      team.roster.push(p.id);
      summary.newPlayers++;
      return p;
    }

    // IL healing / FA signings can leave the roster over 26 — trim first.
    let guard = 0;
    while (team.roster.length > 26 && guard++ < 20) {
      if (!demoteWeakest()) break;
    }

    // Structural needs: full rotation, two catchers, position coverage.
    guard = 0;
    while (countSP() < 5 && guard++ < 8) {
      if (team.roster.length >= 26) demoteWeakest('P');
      promoteOrGenerate({ isPitcher: true, position: 'SP', slotPos: 'SP' });
    }
    guard = 0;
    while (countC() < 2 && guard++ < 4) {
      if (team.roster.length >= 26) demoteWeakest('H');
      promoteOrGenerate({ isPitcher: false, position: 'C', slotPos: 'C' });
    }
    for (const pos of ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
      const covered = rosterPlayers().some((p) => !p.isPitcher && GEN().canPlay(p, pos));
      if (!covered) {
        if (team.roster.length >= 26) demoteWeakest('H');
        promoteOrGenerate({ isPitcher: false, position: pos, slotPos: pos });
      }
    }

    // Fill to 26 with a 13/13 balance target.
    guard = 0;
    while (team.roster.length < 26 && guard++ < 60) {
      const needPitcher = countP() < 13;
      promoteOrGenerate({
        isPitcher: needPitcher,
        slotPos: needPitcher ? (countSP() < 6 ? 'SP' : 'RP') : 'UT',
      });
    }

    // Hard balance floor: 12-14 pitchers (bible 11.2 range with room for a
    // legal pen). Swap the weakest of the surplus type for the needed type.
    guard = 0;
    while (countP() < 12 && guard++ < 6) {
      demoteWeakest('H');
      promoteOrGenerate({ isPitcher: true, slotPos: countSP() < 6 ? 'SP' : 'RP' });
    }
    guard = 0;
    while (countP() > 14 && guard++ < 6) {
      demoteWeakest('P');
      promoteOrGenerate({ isPitcher: false, slotPos: 'UT' });
    }
    // Absolute validation floors (11 pitchers / 11 hitters) regardless of
    // which path above eroded the balance — generation always converges.
    guard = 0;
    while (rosterPlayers().filter((p) => !p.isPitcher).length < 11 && guard++ < 8) {
      demoteWeakest('P');
      promoteOrGenerate({ isPitcher: false, slotPos: 'UT' });
    }
    guard = 0;
    while (countP() < 11 && guard++ < 8) {
      demoteWeakest('H');
      promoteOrGenerate({ isPitcher: true, slotPos: 'RP' });
    }

    // Keep a believable farm: ≥ 22 minor leaguers, mixed ages/levels.
    guard = 0;
    while ((team.minors || []).length < 22 && guard++ < 40) {
      const isPitcher = rand() < 0.5;
      const slotPos = isPitcher ? (rand() < 0.6 ? 'SP' : 'RP')
        : ['C', '1B', '2B', '3B', 'SS', 'OF', 'UT'][rint(0, 6)];
      const level = ['Rookie', 'A'][rint(0, 1)];
      const p = GEN().generateNewPlayer(rand, team, {
        slotPos, tier: 'prospect',
        ageRange: { mean: level === 'Rookie' ? 18 : 20, stdev: 1.2, min: 17, max: 23 },
        status: 'minors', rosterStatus: level,
        id: nextGenId(state),
      });
      players[p.id] = p;
      team.minors.push(p.id);
      summary.newPlayers++;
    }

    // Org must always have a healthy backup catcher path.
    const orgCatchers = team.roster.concat(team.minors)
      .map((id) => players[id])
      .filter((p) => p && !p.isPitcher && p.primaryPosition === 'C' && inj.isAvailable(p));
    if (orgCatchers.length < 3) {
      const p = GEN().generateNewPlayer(rand, team, {
        slotPos: 'C', tier: 'depth', isProspect: false,
        ageRange: { mean: 25, stdev: 2, min: 21, max: 30 },
        status: 'minors', rosterStatus: 'AAA',
        id: nextGenId(state),
      });
      players[p.id] = p;
      team.minors.push(p.id);
      summary.newPlayers++;
    }
  }

  // Rebuild lineups/rotation/bullpen via the shared guaranteed-convergent
  // repair loop (roster.js safeRebuild).
  function rebuildTeamConfig(state, team, summary) {
    ROSTER().safeRebuild(state, team);
  }

  return {
    runSeasonRollover, runSeasonRolloverPartA, runSeasonRolloverPartB,
    advanceFARound, runPostseason, seedLeague,
  };
})();
