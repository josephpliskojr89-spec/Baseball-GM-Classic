// Game simulation engine. At-bat resolution following bible 7.3 with simplified
// but representative outcome math. Calibrated to produce close to target league
// averages (BA .265, K% 17%, BB% 9%, HR rate 2.8%).
// DH rules per bible 3.1: Eastern League parks use the DH; in Western League
// parks pitchers bat 9th for both teams (home team's league sets the rule).
window.BBGM_SIM = (function () {
  const S = window.BBGM_STATS;
  const INJ = () => window.BBGM_INJURIES;
  const FAT = () => window.BBGM_FATIGUE;
  const STAFF = () => window.BBGM_STAFF;

  // Manager tendencies for a side; league-average when unstaffed (Pillar 4:
  // the all-5 default IS the engine's classic behavior).
  function mgrFor(state, team) {
    const st = STAFF();
    return st ? st.tendenciesFor(state, team) : { smallBall: 5, leverage: 5, quickHook: 5, lineupStyle: 5 };
  }

  // Random helper (use Math.random for in-game variance — seedable RNG used at gen)
  function rand() { return Math.random(); }

  // Convert 20-80 grade to a scaled multiplier centered at 1.0 for grade 50.
  function grade(r) { return (r - 50) / 25; } // -1.2 to 1.2 typical

  // Simulate one game, mutating player stats and returning a result.
  function simulateGame(state, game) {
    const home = state.league.teams.find((t) => t.id === game.homeId);
    const away = state.league.teams.find((t) => t.id === game.awayId);
    const players = state.players;
    const year = state.meta.currentDate.year;

    // Starters first — lineup choice depends on the opposing starter's hand.
    const homeSP = pickStarter(home, players, state);
    const awaySP = pickStarter(away, players, state);

    // DH rule follows the HOME team's league (bible 3.1): Eastern League
    // parks use the DH; in Western League parks pitchers bat 9th — for
    // BOTH teams. getLineupWithPositions reshapes each lineup accordingly
    // (visiting East team drops its DH; visiting West team adds one).
    const useDH = home.league === 'east';

    // Lineups: vs-LHP lineup when the opposing starter throws left. Each
    // lineup is paired with a parallel positions array so fatigue
    // accumulation (catcher bonus) knows what slot each batter played.
    // In no-DH games the 9th slot is a pitcher sentinel: players[i] is
    // null and positions[i] is 'P'; simHalfInning resolves it to the
    // batting team's current pitcher at each turn through the order.
    // October: nobody rests in the playoffs — the built-in off days carry
    // the recovery load and every regular plays.
    const restOpts = (t) => ({ mgr: mgrFor(state, t), allowRest: !game.postseason });
    const homeWithPos = getLineupWithPositions(home, players, awaySP, useDH, restOpts(home));
    const awayWithPos = getLineupWithPositions(away, players, homeSP, useDH, restOpts(away));
    const homeLineup = homeWithPos.players;
    const awayLineup = awayWithPos.players;

    // Hard fail loudly rather than silently marking the game played.
    // Earlier bail-out behaviour silently dropped W/L records, producing
    // 0-0 teams in late September. Generation-time readiness validation
    // (BBGM_PLAYER_GEN.validateLeagueReadiness) should prevent this from
    // ever firing — but keep the throw so any future regression surfaces.
    // Count only real hitters (the pitcher-spot sentinel is null).
    const homeHitterCount = homeLineup.filter(Boolean).length;
    const awayHitterCount = awayLineup.filter(Boolean).length;
    if (!homeSP || !awaySP || homeHitterCount < 8 || awayHitterCount < 8) {
      const reason = [];
      if (!homeSP) reason.push(`home (${home.abbr}) has no starting pitcher`);
      if (!awaySP) reason.push(`away (${away.abbr}) has no starting pitcher`);
      if (homeHitterCount < 8) reason.push(`home lineup hitters ${homeHitterCount} < 8`);
      if (awayHitterCount < 8) reason.push(`away lineup hitters ${awayHitterCount} < 8`);
      const err = new Error(
        `simulateGame: cannot simulate ${away.abbr}@${home.abbr} (${game.gameId}): ${reason.join('; ')}`
      );
      err.code = 'SIM_TEAM_NOT_READY';
      err.gameId = game.gameId;
      err.homeId = home.id;
      err.awayId = away.id;
      throw err;
    }

    // Track game state. catcher is cached for SB resolution (see findCatcher).
    // pitchCount holds ESTIMATED PITCHES for the current pitcher's outing
    // (per-PA estimates — see pitchesForPA). entryMargins / exitMargins
    // record the score margin when each pitcher entered / left, used for
    // hold and blown-save accounting in assignPitcherDecisions.
    // defenseAvg is the lineup's average defense rating (bible 7.6): it
    // scales BIP hit rates, error rates, and double-play conversion.
    // recordPid / lossPid track the pitcher of record: set in chargeRun
    // whenever a side takes the lead (see assignPitcherDecisions).
    const teamState = {
      home: {
        team: home, lineup: homeLineup, lineupPositions: homeWithPos.positions, lineupIdx: 0,
        sp: homeSP, currentP: homeSP, pitchCount: 0, pitchersUsed: [homeSP.id], runs: 0, hits: 0, errors: 0,
        parkFactors: home.ballpark.factors,
        catcher: findCatcher(home, players),
        defenseAvg: lineupDefenseAvg(homeLineup),
        mgr: mgrFor(state, home),
        entryMargins: { [homeSP.id]: 0 }, exitMargins: {},
        recordPid: null, lossPid: null,
      },
      away: {
        team: away, lineup: awayLineup, lineupPositions: awayWithPos.positions, lineupIdx: 0,
        sp: awaySP, currentP: awaySP, pitchCount: 0, pitchersUsed: [awaySP.id], runs: 0, hits: 0, errors: 0,
        parkFactors: home.ballpark.factors, // Park factors apply to both
        catcher: findCatcher(away, players),
        defenseAvg: lineupDefenseAvg(awayLineup),
        mgr: mgrFor(state, away),
        entryMargins: { [awaySP.id]: 0 }, exitMargins: {},
        recordPid: null, lossPid: null,
      },
    };

    // Initialize stat tracking for this game.
    // gs(p): a pitcher's PITCHING line / a position player's batting line.
    // gsBat(p): the batting line for any batter. For position players it's
    // the same object as gs(p); for pitchers batting (no-DH games) it's a
    // separate hitter line keyed 'bat:<id>' — pitching and batting stats
    // share field names (h, bb, k, r, hr) and must never be mixed on one
    // object. Batting lines persist to season stats under stats[year]
    // .batting (see the season-update loop below).
    const gameStats = {};
    function gs(p) {
      if (!gameStats[p.id]) {
        gameStats[p.id] = p.isPitcher ? S.emptyPitcher() : S.emptyHitter();
        gameStats[p.id]._playerId = p.id;
      }
      return gameStats[p.id];
    }
    function gsBat(p) {
      if (!p.isPitcher) return gs(p);
      const key = 'bat:' + p.id;
      if (!gameStats[key]) {
        gameStats[key] = S.emptyHitter();
        gameStats[key]._playerId = p.id;
      }
      return gameStats[key];
    }

    // Half-innings. Track outs the home and away pitching staffs each
    // recorded so we can validate ipOuts attribution at the end. gameLog
    // collects one compact entry per plate appearance (bible 20.6.4);
    // lineScore collects runs per half-inning for the box score header.
    let inning = 1;
    let homeOuts = 0; // outs the home staff recorded against away batters
    let awayOuts = 0;
    const gameLog = [];
    const lineScore = { away: [], home: [] };
    while (inning <= 9 || teamState.home.runs === teamState.away.runs) {
      // Top half (away batting, home pitching)
      const awayBefore = teamState.away.runs;
      homeOuts += simHalfInning(teamState.away, teamState.home, gs, gsBat, inning, false, state, gameLog);
      lineScore.away.push(teamState.away.runs - awayBefore);
      // If 9+ and home leading, end before bottom half
      if (inning >= 9 && teamState.home.runs > teamState.away.runs) {
        break;
      }
      // Bottom half (home batting, away pitching)
      const homeBefore = teamState.home.runs;
      awayOuts += simHalfInning(teamState.home, teamState.away, gs, gsBat, inning, true, state, gameLog);
      lineScore.home.push(teamState.home.runs - homeBefore);
      if (inning >= 9 && teamState.home.runs !== teamState.away.runs) break;
      inning++;
      // No tie games — extras play until decided. The earlier 18-inning
      // cap silently ended tied games and handed the away team a W (2-3
      // times per season, measured). This guard exists only to turn a
      // scoring-logic bug into a loud failure instead of an infinite
      // loop; reaching inning 50 legitimately is ~(0.5)^40 improbable.
      if (inning > 50) {
        const err = new Error(
          `simulateGame: ${away.abbr}@${home.abbr} (${game.gameId}) still tied after ${inning - 1} innings — aborting`
        );
        err.code = 'GAME_UNRESOLVED';
        err.gameId = game.gameId;
        throw err;
      }
    }

    // Compute decisions (W/L/SV)
    assignPitcherDecisions(teamState, gameStats);

    // Hitter games played: every batter who took at least one PA in this
    // game gets G=1 (exactly once per game). With no in-game substitutions
    // yet, the lineup batters who hit are the only candidates. Pitcher G/GS
    // is set at appearance time inside simHalfInning; a pitcher's 'bat:'
    // line gets its own G so the batting sub-line reads correctly.
    for (const key in gameStats) {
      const isBatLine = key.startsWith('bat:');
      const p = players[isBatLine ? key.slice(4) : key];
      if (!p || (p.isPitcher && !isBatLine)) continue;
      const line = gameStats[key];
      if ((line.pa || 0) > 0) line.g = 1;
    }

    // Per-game invariant validation. Catches accounting bugs immediately
    // rather than letting them silently pollute season totals. Throws if
    // any check fails — simOneDay surfaces the throw to the user.
    const homeBatterStats = [];
    const awayBatterStats = [];
    const homePitcherStats = [];
    const awayPitcherStats = [];
    for (const key in gameStats) {
      const isBatLine = key.startsWith('bat:');
      const pid = isBatLine ? key.slice(4) : key;
      const p = players[pid];
      if (!p) continue;
      const isHome = p.teamId === home.id;
      // A pitcher's 'bat:' line is a batting line (pitchers bat in no-DH
      // games) — it belongs in the batter buckets so run totals reconcile.
      const bucket = (p.isPitcher && !isBatLine)
        ? (isHome ? homePitcherStats : awayPitcherStats)
        : (isHome ? homeBatterStats : awayBatterStats);
      bucket.push(gameStats[key]);
    }
    const validation = S.validateGameStats({
      homeRuns: teamState.home.runs,
      awayRuns: teamState.away.runs,
      homeBatterStats, awayBatterStats,
      homePitcherStats, awayPitcherStats,
      homeOuts, awayOuts,
    });
    if (!validation.ok) {
      const err = new Error(
        `Game stat invariant violation (${away.abbr}@${home.abbr} ${game.gameId}): ${validation.issues.join('; ')}`
      );
      err.code = 'GAME_STATS_INVALID';
      err.gameId = game.gameId;
      err.issues = validation.issues;
      throw err;
    }

    // Collect injuries from per-PA / per-BF rolls. simOneDay applies them
    // tomorrow (substitution, IL state transition, notification).
    const injuriesThisGame = [];
    for (const pid in gameStats) {
      const line = gameStats[pid];
      if (line._injury) injuriesThisGame.push({ playerId: pid, injury: line._injury });
    }

    // Update player season stats. Pitcher batting lines ('bat:' keys) go
    // to the separate stats[year].batting object — field names collide
    // with pitching stats, so they must never merge onto the same line.
    for (const key in gameStats) {
      const isBatLine = key.startsWith('bat:');
      const pid = isBatLine ? key.slice(4) : key;
      const p = players[pid];
      if (!p) continue;
      const gameLine = gameStats[key];
      delete gameLine._playerId;
      delete gameLine._injury;
      const target = isBatLine ? S.ensurePitcherBatting(p, year) : S.ensureSeason(p, year);
      S.addStat(target, gameLine);
    }

    // Fatigue accumulation for position players (bible 10.8). Every batter
    // in the actual game lineup gets the starter bump; catchers get the
    // catcher bump. Recovery for everyone else happens in main.js's daily
    // loop. Pitchers have their own per-pitch decay (7.4) and are skipped.
    // Defensive: skip if fatigue module isn't loaded.
    const fat = FAT();
    if (fat) {
      for (let i = 0; i < homeLineup.length; i++) {
        fat.accumulateForGame(homeLineup[i], homeWithPos.positions[i], true);
      }
      for (let i = 0; i < awayLineup.length; i++) {
        fat.accumulateForGame(awayLineup[i], awayWithPos.positions[i], true);
      }
    }

    // Update team records — REGULAR SEASON ONLY. Postseason games carry
    // game.postseason and must never touch seasonRecord: the 162-game
    // record is what standings, seeding comparisons, and the season
    // archive read (playoff wins bleeding into it was a real bug).
    const homeWon = teamState.home.runs > teamState.away.runs;
    if (!game.postseason) {
      home.seasonRecord.rs += teamState.home.runs;
      home.seasonRecord.ra += teamState.away.runs;
      away.seasonRecord.rs += teamState.away.runs;
      away.seasonRecord.ra += teamState.home.runs;
      if (homeWon) {
        home.seasonRecord.w++;
        away.seasonRecord.l++;
      } else {
        home.seasonRecord.l++;
        away.seasonRecord.w++;
      }
      updateLastTen(home, homeWon ? 'W' : 'L');
      updateLastTen(away, homeWon ? 'L' : 'W');
      updateStreak(home, homeWon);
      updateStreak(away, !homeWon);
    }

    // Per-game box lines for the Game Detail view (bible 20.6.4). Compact
    // arrays — decoder lives in the UI. Batters in lineup order:
    //   [pid, ab, r, h, b2, b3, hr, rbi, bb, k, sb]
    // Pitchers in appearance order:
    //   [pid, ipOuts, h, r, er, bb, k, hr]
    function boxFor(side) {
      const batters = [];
      const batRow = (pid, s) =>
        [pid, s.ab || 0, s.r || 0, s.h || 0, s.b2 || 0, s.b3 || 0, s.hr || 0, s.rbi || 0, s.bb || 0, s.k || 0, s.sb || 0];
      for (const p of side.lineup) {
        if (p === null) {
          // Pitcher's spot (no-DH game): every pitcher who batted, in
          // appearance order.
          for (const pid of side.pitchersUsed) {
            const s = gameStats['bat:' + pid];
            if (s) batters.push(batRow(pid, s));
          }
          continue;
        }
        const s = gameStats[p.id];
        if (!s) continue;
        batters.push(batRow(p.id, s));
      }
      const pitchers = [];
      for (const pid of side.pitchersUsed) {
        const s = gameStats[pid];
        if (!s) continue;
        pitchers.push([pid, s.ipOuts || 0, s.h || 0, s.r || 0, s.er || 0, s.bb || 0, s.k || 0, s.hr || 0]);
      }
      return { batters, pitchers };
    }
    const hldPids = [];
    const bsPids = [];
    for (const pid in gameStats) {
      if (gameStats[pid].hld) hldPids.push(pid);
      if (gameStats[pid].bs) bsPids.push(pid);
    }

    // Reliever rest bookkeeping (bible 7.4.6): record when each pitcher
    // last appeared and how many consecutive days he's worked. chooseReliever
    // rests arms that have pitched three straight days and deprioritizes /
    // shortens arms that worked yesterday.
    const todayDate = state.meta.currentDate;
    const DATES = window.BBGM_DATES;
    for (const side of [teamState.home, teamState.away]) {
      for (const pid of side.pitchersUsed) {
        const p = players[pid];
        if (!p) continue;
        const consecutive = p.lastPitchedDate && DATES.diffDays(p.lastPitchedDate, todayDate) === 1;
        p.consecPitchDays = consecutive ? (p.consecPitchDays || 1) + 1 : 1;
        p.lastPitchedDate = { ...todayDate };
      }
    }

    // Rotation bookkeeping is engine-owned. pickStarter rotates on this
    // counter; when an earlier version left the increment to the caller, any
    // path that forgot it made every team silently start its ace in all 162
    // games — no error, just a quietly broken league.
    if (!state.meta.gamesPlayedByTeam) state.meta.gamesPlayedByTeam = {};
    state.meta.gamesPlayedByTeam[home.id] = (state.meta.gamesPlayedByTeam[home.id] || 0) + 1;
    state.meta.gamesPlayedByTeam[away.id] = (state.meta.gamesPlayedByTeam[away.id] || 0) + 1;

    game.played = true;
    game.result = {
      homeRuns: teamState.home.runs,
      awayRuns: teamState.away.runs,
      homeHits: teamState.home.hits,
      awayHits: teamState.away.hits,
      homeErrors: teamState.home.errors,
      awayErrors: teamState.away.errors,
      innings: inning,
      homeId: home.id,
      awayId: away.id,
      homeWP: teamState.home.wp || null,
      awayWP: teamState.away.wp || null,
      homeLP: teamState.home.lp || null,
      awayLP: teamState.away.lp || null,
      saveP: teamState.home.savePid || teamState.away.savePid || null,
      hldPids,
      bsPids,
      homeSPid: homeSP.id,
      awaySPid: awaySP.id,
      lineScore,
      box: { home: boxFor(teamState.home), away: boxFor(teamState.away) },
      gameLog,
      injuries: injuriesThisGame, // [{playerId, injury}] — applied next day
      year,
    };
    return game.result;
  }

  // Append one compact game-log entry. Array layout (decoder lives in the
  // Game Detail UI — keep in sync):
  //   [0] inning  [1] half (0 top / 1 bottom)  [2] batter/runner id
  //   [3] pitcher id  [4] outs before play  [5] base mask before play
  //       (1 = runner on 1st, 2 = on 2nd, 4 = on 3rd)
  //   [6] result code ('1B','2B','3B','HR','BB','HBP','K','OUT','SF',
  //       'GIDP','SB','CS')
  //   [7] RBI on the play  [8] away score after  [9] home score after
  function logPlay(log, inning, isBottom, playerId, pitcherId, outsBefore, baseMask, code, rbi, off, def) {
    const awayScore = isBottom ? def.runs : off.runs;
    const homeScore = isBottom ? off.runs : def.runs;
    log.push([inning, isBottom ? 1 : 0, playerId, pitcherId, outsBefore, baseMask, code, rbi, awayScore, homeScore]);
  }

  function baseMaskOf(bases) {
    return (bases[0] ? 1 : 0) | (bases[1] ? 2 : 0) | (bases[2] ? 4 : 0);
  }

  function simHalfInning(off, def, gs, gsBat, inning, isBottom, state, log) {
    let outs = 0;
    // Walkoff rule: in the bottom of the 9th or later, the game ends the
    // moment the home side takes the lead — the inning does NOT play out to
    // three outs. (All runners scoring on the final play are still counted,
    // a small simplification vs. official scoring on non-HR walkoffs.)
    const walkoffLive = isBottom && inning >= 9;
    // Each base position holds a runner object { playerId, responsiblePitcherId }
    // or null. responsiblePitcherId is the pitcher who put the runner on base
    // and is who R/ER is charged against if the runner ultimately scores.
    let bases = [null, null, null];

    // Unearned-run bookkeeping (bible 7.6, simplified): a run is unearned
    // when (a) the scoring runner reached base on an error, (b) it scored
    // on the error play itself, or (c) it scored after an error was made
    // with two outs (the inning should already have been over). Full
    // official earned-run reconstruction is out of scope.
    let errorWithTwoOuts = false;

    // Charge a scored run: R to the runner's batting line, R+ER to the
    // pitcher who was responsible for putting that runner on base. gsBat:
    // a scoring runner may be a pitcher who reached base batting (no-DH
    // games) — his run belongs on his batting line, not his pitching line.
    //
    // Pitcher-of-record tracking: whenever this run puts the batting side
    // ahead by exactly one (a lead is taken), the batting side's current
    // pitcher becomes their potential winning pitcher, and the pitcher
    // responsible for the go-ahead run becomes the fielding side's
    // potential losing pitcher. The last lead change before the final out
    // leaves the correct W/L candidates in place (MLB rule 9.17).
    function chargeRun(scoredRunner, unearnedPlay) {
      off.runs++;
      const runnerP = state.players[scoredRunner.playerId];
      if (runnerP) gsBat(runnerP).r++;
      const respP = state.players[scoredRunner.responsiblePitcherId];
      if (respP) {
        const rs = gs(respP);
        rs.r = (rs.r || 0) + 1;
        const unearned = scoredRunner.unearned || unearnedPlay || errorWithTwoOuts;
        if (!unearned) rs.er = (rs.er || 0) + 1;
      }
      if (off.runs - def.runs === 1) {
        off.recordPid = off.currentP ? off.currentP.id : null;
        def.lossPid = respP ? respP.id : (def.currentP ? def.currentP.id : null);
      }
    }

    while (outs < 3) {
      // Pitcher's spot (no-DH games): the sentinel resolves to whoever is
      // currently pitching for the BATTING side. Relievers bat in the
      // pitcher's slot when it comes up — no pinch-hitting until an
      // in-game substitution system exists.
      let batter = off.lineup[off.lineupIdx];
      if (batter === null) batter = off.currentP;
      off.lineupIdx = (off.lineupIdx + 1) % off.lineup.length;

      // Check pitcher fatigue / change
      maybeChangePitcher(off, def, gs, inning, state);

      const pitcher = def.currentP;

      // Sacrifice bunt call (bible 7.5, manager small-ball tendency).
      // Pitchers at the plate bunt classically; position players bunt only
      // for small-ball managers in close-and-late spots.
      if (shouldBunt(batter, off, def, bases, outs, inning)) {
        const bs = gsBat(batter);
        const ps = gs(pitcher);
        bs.pa++;
        ps.bf++;
        if (!ps.g) ps.g = 1;
        if (pitcher.id === def.sp.id && !ps.gs) ps.gs = 1;
        def.pitchCount += 2;
        const outsBefore = outs;
        const maskBefore = baseMaskOf(bases);
        const buntSkill = batter.isPitcher ? 42 : (batter.ratings.bunting || 40);
        const success = Math.random() < clamp(0.60 + (buntSkill - 40) * 0.006, 0.35, 0.90);
        outs++;
        ps.ipOuts = (ps.ipOuts || 0) + 1;
        let code;
        if (success) {
          // Successful sacrifice: batter out, runners move up. PA, SH, no AB.
          bs.sh = (bs.sh || 0) + 1;
          if (bases[1] && !bases[2]) { bases[2] = bases[1]; bases[1] = null; }
          if (bases[0] && !bases[1]) { bases[1] = bases[0]; bases[0] = null; }
          code = 'SH';
        } else {
          // Botched bunt: batter out, nobody advances. Counts as an AB.
          bs.ab++;
          code = 'OUT';
        }
        if (log) logPlay(log, inning, isBottom, batter.id, pitcher.id, outsBefore, maskBefore, code, 0, off, def);
        continue;
      }

      const result = resolveAtBat(batter, pitcher, off.parkFactors, def);
      def.pitchCount += pitchesForPA(result.kind);

      const bs = gsBat(batter);
      const ps = gs(pitcher);
      bs.pa++;
      ps.bf++;

      // Pitcher appearance is recorded the moment they face a batter so G/GS
      // can never be overwritten or skipped by the decision logic later.
      if (!ps.g) ps.g = 1;
      if (pitcher.id === def.sp.id && !ps.gs) ps.gs = 1;

      // Injury rolls (bible 10.1). Per-PA roll for the batter, per-BF roll
      // for the pitcher. Each player's injury is stashed on their game-stat
      // line under _injury so simulateGame can collect them after the game
      // ends — applying mid-game would require an in-game substitution
      // system that doesn't exist yet. Day-to-day cases mean the player is
      // listed as questionable starting tomorrow; IL cases also start
      // tomorrow but route through main.js's substitution handler.
      // No batting-injury roll for a pitcher at the plate — his injury
      // exposure is already modeled by the per-BF roll on his pitching
      // line, and 2-3 extra PAs shouldn't double-dip it.
      if (!batter.isPitcher && !bs._injury) {
        const hi = INJ().rollForHitter(rand, batter);
        if (hi) bs._injury = hi;
      }
      if (!ps._injury) {
        const pi = INJ().rollForPitcher(rand, pitcher);
        if (pi) ps._injury = pi;
      }

      const newRunner = { playerId: batter.id, responsiblePitcherId: pitcher.id };

      // Pre-play snapshot for the game log entry appended after the branch.
      const outsBeforePlay = outs;
      const maskBeforePlay = baseMaskOf(bases);
      const rbiBeforePlay = bs.rbi;
      let playCode = result.kind === 'IBB' ? 'BB' : result.kind;

      if (result.kind === 'BB' || result.kind === 'IBB') {
        bs.bb++;
        ps.bb++;
        const advance = forceWalk(bases, newRunner);
        bases = advance.bases;
        for (const scored of advance.runs) {
          chargeRun(scored);
          bs.rbi++;
        }
      } else if (result.kind === 'HBP') {
        bs.hbp++;
        ps.hbp++;
        const advance = forceWalk(bases, newRunner);
        bases = advance.bases;
        for (const scored of advance.runs) {
          chargeRun(scored);
          bs.rbi++;
        }
      } else if (result.kind === 'K') {
        bs.ab++;
        bs.k++;
        ps.k++;
        ps.ipOuts = (ps.ipOuts || 0) + 1;
        outs++;
      } else if (result.kind === 'OUT') {
        // Classify the out before charging AB. MLB scoring:
        //  - E: the defense botches a would-be out (bible 7.6). Batter
        //       reaches, all runners advance one base, no out recorded,
        //       AB charged but no hit. Runs on the play are unearned.
        //  - SF: flyout + R3 scores + fewer than 2 outs at start of play
        //        → counts as PA, SF, RBI; NOT counted as AB.
        //  - GIDP: GROUND ball + R1 + fewer than 2 outs at start of play
        //        → counts as AB and GIDP; turns into 2 outs total.
        //  - Otherwise: a regular out, counts as AB.
        const outsBefore = outs;
        const defGrade = grade(def.defenseAvg);
        let isError = false;
        let isSF = false;
        let isGIDP = false;
        // Error rate ~3% of would-be outs (≈0.65 E/team/game), reduced by
        // good team defense, raised by bad. Popups are near-automatic.
        const errProb = result.battedBall === 'pop'
          ? 0.004
          : clamp(0.035 - defGrade * 0.012, 0.012, 0.060);
        if (Math.random() < errProb) {
          isError = true;
        } else if (result.battedBall === 'ground' && bases[0] && outsBefore < 2 &&
                   Math.random() < clamp(0.50 + defGrade * 0.06, 0.30, 0.65)) {
          // Grounder with a DP in order: strong middle-infield defense
          // turns two more often. (~0.75 GIDP/team/game league-wide.)
          isGIDP = true;
        } else if (bases[2] && outsBefore < 2 && result.battedBall === 'fly' && Math.random() < 0.55) {
          isSF = true;
        }

        if (isError) {
          playCode = 'E';
          def.errors++;
          bs.ab++; // reached on error: AB, no hit
          if (outsBefore === 2) errorWithTwoOuts = true;
          const advance = advanceAllOneBase(bases, { ...newRunner, unearned: true });
          bases = advance.bases;
          for (const scored of advance.runs) {
            chargeRun(scored, /* unearnedPlay */ true);
            // No RBI on an error play.
          }
        } else if (isSF) {
          playCode = 'SF';
          outs++;
          ps.ipOuts = (ps.ipOuts || 0) + 1;
          const r3 = bases[2];
          bases[2] = null;
          chargeRun(r3);
          bs.sf++;
          bs.rbi++;
        } else if (isGIDP) {
          playCode = 'GIDP';
          bs.ab++;
          bs.gidp++;
          // Two outs: the batter at home plate and the lead runner. Cap at 3.
          const additional = Math.min(2, 3 - outs);
          outs += additional;
          ps.ipOuts = (ps.ipOuts || 0) + additional;
          bases[0] = null;
        } else {
          bs.ab++;
          outs++;
          ps.ipOuts = (ps.ipOuts || 0) + 1;
        }
      } else if (result.kind === '1B') {
        bs.ab++; bs.h++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 1, newRunner);
        bases = advance.bases;
        for (const scored of advance.runs) {
          chargeRun(scored);
          bs.rbi++;
        }
      } else if (result.kind === '2B') {
        bs.ab++; bs.h++; bs.b2++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 2, newRunner);
        bases = advance.bases;
        for (const scored of advance.runs) {
          chargeRun(scored);
          bs.rbi++;
        }
      } else if (result.kind === '3B') {
        bs.ab++; bs.h++; bs.b3++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 3, newRunner);
        bases = advance.bases;
        for (const scored of advance.runs) {
          chargeRun(scored);
          bs.rbi++;
        }
      } else if (result.kind === 'HR') {
        bs.ab++; bs.h++; bs.hr++; ps.hr++; ps.h++; off.hits++;
        const baserunners = bases.filter((b) => b);
        bases = [null, null, null];
        for (const scored of baserunners) chargeRun(scored);
        // Batter scores too — the current pitcher is responsible.
        chargeRun(newRunner);
        bs.rbi += baserunners.length + 1;
      }

      // Game log entry for the plate appearance.
      if (log) {
        logPlay(log, inning, isBottom, batter.id, pitcher.id,
          outsBeforePlay, maskBeforePlay, playCode, bs.rbi - rbiBeforePlay, off, def);
      }

      // Stolen base attempts after PA (only with R1, no R2 ahead).
      // Pitchers on base never attempt a steal.
      if (bases[0] && outs < 3 && !bases[1]) {
        const runner = state.players[bases[0].playerId];
        if (!runner.isPitcher && shouldAttemptSB(runner, pitcher, off, def)) {
          const sbOuts = outs;
          const sbMask = baseMaskOf(bases);
          const sbResult = resolveSB(runner, pitcher, def);
          if (sbResult === 'safe') {
            bases[1] = bases[0]; bases[0] = null;
            gsBat(runner).sb++;
            if (log) logPlay(log, inning, isBottom, runner.id, pitcher.id, sbOuts, sbMask, 'SB', 0, off, def);
          } else {
            // Caught stealing: out credited to current pitcher on the mound.
            bases[0] = null;
            outs++;
            ps.ipOuts = (ps.ipOuts || 0) + 1;
            gsBat(runner).cs++;
            if (log) logPlay(log, inning, isBottom, runner.id, pitcher.id, sbOuts, sbMask, 'CS', 0, off, def);
          }
        }
      }

      // Walkoff: home side just took the lead in the 9th or later.
      if (walkoffLive && off.runs > def.runs) break;
    }
    // Defensive: outs should never exceed 3 in a half-inning. If it does
    // (only via simultaneous events like CS-after-walkoff), the loop guard
    // above would have already exited. Cap at 3 for safety in any return.
    return Math.min(outs, 3);
  }

  // Bases now hold runner objects: { playerId, responsiblePitcherId } | null.
  // forceWalk pushes the new runner to first; only forced runners (and only
  // R3 when bases are loaded) score. Returns the array of runner objects who
  // crossed the plate, with their responsible pitcher attached.
  function forceWalk(bases, newRunner) {
    const runs = [];
    const bs = bases.slice();
    if (bs[0] && bs[1] && bs[2]) {
      runs.push(bs[2]);
      bs[2] = bs[1];
      bs[1] = bs[0];
      bs[0] = newRunner;
    } else if (bs[0] && bs[1]) {
      bs[2] = bs[1];
      bs[1] = bs[0];
      bs[0] = newRunner;
    } else if (bs[0]) {
      bs[1] = bs[0];
      bs[0] = newRunner;
    } else {
      bs[0] = newRunner;
    }
    return { bases: bs, runs };
  }

  // Error advancement: every runner moves up exactly one base and the
  // batter takes first. R3 scores. Used for reached-on-error plays.
  function advanceAllOneBase(bases, newRunner) {
    const runs = [];
    const bs = bases.slice();
    if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
    if (bs[1]) { bs[2] = bs[1]; bs[1] = null; }
    if (bs[0]) { bs[1] = bs[0]; bs[0] = null; }
    bs[0] = newRunner;
    return { bases: bs, runs };
  }

  // Average defense rating across the game lineup (nulls are the pitcher
  // sentinel; pitchers' fielding is not modeled). Neutral 50 fallback.
  function lineupDefenseAvg(lineup) {
    let sum = 0, n = 0;
    for (const p of lineup) {
      if (!p || p.isPitcher) continue;
      sum += (p.ratings.defense || 50);
      n++;
    }
    return n ? sum / n : 50;
  }

  // Bases hold runner objects. The new runner (the batter who reached base)
  // arrives with responsiblePitcherId already set by the caller. Returns the
  // runners who crossed the plate so the caller can charge their R/ER to
  // whatever pitcher each runner is responsible-charged against.
  function advanceOnHit(bases, batter, hitType, newRunner) {
    const runs = [];
    const bs = bases.slice();
    // Pitchers batting have no speed rating — treat them as slow (30).
    const speed = batter.isPitcher ? 30 : (batter.ratings.speed || 50);
    const speedBonus = Math.random() < (speed - 50) / 200;

    if (hitType === 1) {
      // Single
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) {
        if (Math.random() < 0.65) { runs.push(bs[1]); bs[1] = null; }
        else { bs[2] = bs[1]; bs[1] = null; }
      }
      if (bs[0]) {
        if (Math.random() < 0.30) { bs[2] = bs[0]; }
        else { bs[1] = bs[0]; }
        bs[0] = null;
      }
      bs[0] = newRunner;
    } else if (hitType === 2) {
      // Double
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) { runs.push(bs[1]); bs[1] = null; }
      if (bs[0]) {
        if (Math.random() < (speedBonus ? 0.60 : 0.45)) { runs.push(bs[0]); }
        else { bs[2] = bs[0]; }
        bs[0] = null;
      }
      bs[1] = newRunner;
    } else if (hitType === 3) {
      // Triple - all score
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) { runs.push(bs[1]); bs[1] = null; }
      if (bs[0]) { runs.push(bs[0]); bs[0] = null; }
      bs[2] = newRunner;
    }
    return { bases: bs, runs };
  }

  function resolveAtBat(batter, pitcher, parkFactors, def) {
    const p = pitcher.ratings;
    const vsHand = pitcher.throws === 'L' ? 'L' : 'R';

    let contact, power, discipline, batterSpeed;
    if (batter.isPitcher) {
      // Pitcher at the plate (Western League / no-DH games, bible 3.1).
      // Pitchers have no batting ratings — use a canned bottom-of-scale
      // line plus the kBase bump below. Calibrated to the classic-era
      // pitcher slash: ~.130 BA, ~35-40% K, ~4-5% BB, near-zero power.
      contact = 20; power = 20; discipline = 20; batterSpeed = 30;
    } else {
      const r = batter.ratings;
      contact = vsHand === 'L' ? r.contactVsL : r.contactVsR;
      power = vsHand === 'L' ? r.powerVsL : r.powerVsR;

      // Switch hitter chooses opposite-handed
      if (batter.bats === 'S') {
        contact = vsHand === 'L' ? r.contactVsR : r.contactVsL;
        power = vsHand === 'L' ? r.powerVsR : r.powerVsL;
      }

      // Fatigue penalty (bible 10.8): a tired starter loses a few effective
      // points off contact and power. Linear ramp past the moderate threshold,
      // capped so a maxed-out hitter still plays at -6 (not crippling).
      // Defensive: skip if fatigue module isn't loaded yet (test harnesses,
      // SW-cache load-order edge cases). Pitchers batting are exempt
      // (position-player fatigue doesn't apply to them).
      const fat = FAT();
      if (fat) {
        const fatPenalty = fat.performancePenalty(batter);
        if (fatPenalty > 0) {
          contact -= fatPenalty;
          power -= fatPenalty;
        }
      }
      discipline = r.discipline;
      batterSpeed = r.speed;
    }

    const stuff = applyFatigue(p.stuff, pitcher, def);
    const control = applyFatigue(p.control, pitcher, def);
    const movement = applyFatigue(p.movement, pitcher, def);
    const velocity = applyFatigue(p.velocity, pitcher, def);

    // Base rates - calibrated to target league averages.
    // K rate: 17%. Driven by stuff+velocity vs contact+discipline.
    // Pitchers batting whiff far beyond what a 20 contact grade alone
    // produces — the extra bump lands their K% near the historical ~37%.
    const kBase = batter.isPitcher ? 0.285 : 0.176;
    const kAdj = (grade(stuff) * 0.06) + (grade(velocity) * 0.03) - (grade(contact) * 0.05) - (grade(discipline) * 0.02);
    const kProb = clamp(kBase + kAdj, 0.04, 0.45);

    // BB rate: 9%. Driven by control vs discipline. Pitchers batting walk
    // less than their 20-grade discipline alone implies (~4-5% era rate).
    const bbBase = batter.isPitcher ? 0.075 : 0.088;
    const bbAdj = -(grade(control) * 0.04) + (grade(discipline) * 0.03);
    const bbProb = clamp(bbBase + bbAdj, 0.02, 0.20);

    // HBP: ~1%
    const hbpProb = 0.009;

    // Roll - is it K, BB, HBP, or BIP?
    const roll = Math.random();
    if (roll < kProb) return { kind: 'K' };
    if (roll < kProb + bbProb) return { kind: 'BB' };
    if (roll < kProb + bbProb + hbpProb) return { kind: 'HBP' };

    // Ball in play.
    // Pitchers batting make weak contact beyond what the rating grades
    // capture — scale their BIP hit chances down to land near .130 BA.
    const bipHitMul = batter.isPitcher ? 0.82 : 1;
    // Defensive range (bible 7.6): better team defense converts more balls
    // in play into outs. ±2-3% relative BABIP swing across typical teams.
    const defRangeMul = 1 - grade(def.defenseAvg) * 0.02;
    // Determine batted ball type.
    const battedBallRoll = Math.random();
    const flyRate = clamp(0.34 + grade(power) * 0.04 - grade(movement) * 0.03, 0.22, 0.48);
    const grounderRate = clamp(0.42 + grade(movement) * 0.04 - grade(power) * 0.03, 0.30, 0.55);
    const lineRate = clamp(0.20 + grade(contact) * 0.03, 0.14, 0.28);
    let bbType;
    if (battedBallRoll < flyRate) bbType = 'fly';
    else if (battedBallRoll < flyRate + grounderRate) bbType = 'ground';
    else if (battedBallRoll < flyRate + grounderRate + lineRate) bbType = 'line';
    else bbType = 'pop';

    // Now resolve based on type.
    // BIP base BABIP target ~ .300. We need overall BIP -> hits at the right rate.
    // We'll compute hit probability and split into 1B/2B/3B/HR.
    const parkRunFactor = (parkFactors.run || 100) / 100;
    const parkHRFactor = (parkFactors.hr || 100) / 100;
    const parkXBHFactor = (parkFactors.xbh || 100) / 100;
    const parkHitsFactor = (parkFactors.hits || 100) / 100;

    if (bbType === 'pop') {
      if (Math.random() < 0.97) return { kind: 'OUT', battedBall: bbType };
      return { kind: '1B', battedBall: bbType };
    }

    if (bbType === 'ground') {
      // Hit prob target ~ .240 on grounders, modified by speed.
      let hitProb = 0.247 + grade(batterSpeed) * 0.04 + grade(contact) * 0.015;
      hitProb *= parkHitsFactor * bipHitMul * defRangeMul;
      if (Math.random() < hitProb) {
        if (Math.random() < 0.04 * parkXBHFactor) return { kind: '2B', battedBall: bbType };
        return { kind: '1B', battedBall: bbType };
      }
      return { kind: 'OUT', battedBall: bbType };
    }

    if (bbType === 'line') {
      // Line drives: target ~ .65 hit rate
      let hitProb = 0.680 + grade(contact) * 0.03;
      hitProb *= parkHitsFactor * bipHitMul * defRangeMul;
      if (Math.random() < hitProb) {
        const ext = Math.random();
        if (ext < 0.22 * parkXBHFactor) return { kind: '2B', battedBall: bbType };
        if (ext < 0.245 * parkXBHFactor) return { kind: '3B', battedBall: bbType };
        if (ext < 0.27 * parkHRFactor) return { kind: 'HR', battedBall: bbType };
        return { kind: '1B', battedBall: bbType };
      }
      return { kind: 'OUT', battedBall: bbType };
    }

    if (bbType === 'fly') {
      // Fly balls: HR chance based on power; otherwise mostly outs with some XB.
      // The 2% floor keeps real hitters honest, but it inflates pitcher
      // batters (power 20 computes to ~0.4% — the floor quintupled it,
      // producing ~50 pitcher HR per season instead of a handful).
      const hrBase = 0.108;
      const hrAdj = grade(power) * 0.08;
      const hrFloor = batter.isPitcher ? 0.002 : 0.02;
      let hrProb = clamp((hrBase + hrAdj) * parkHRFactor, hrFloor, 0.50);
      if (batter.isPitcher) hrProb *= 0.5; // pitchers run into one rarely
      if (Math.random() < hrProb) return { kind: 'HR', battedBall: bbType };

      const xbProb = 0.127 * parkXBHFactor * bipHitMul * defRangeMul;
      if (Math.random() < xbProb) {
        if (Math.random() < 0.08) return { kind: '3B', battedBall: bbType };
        return { kind: '2B', battedBall: bbType };
      }
      const singleProb = (0.076 + grade(contact) * 0.02) * bipHitMul * defRangeMul;
      if (Math.random() < singleProb) return { kind: '1B', battedBall: bbType };
      return { kind: 'OUT', battedBall: bbType };
    }

    return { kind: 'OUT', battedBall: bbType };
  }

  // ---- Pitcher stamina tiers (bible 7.4) ----------------------------------
  // The engine resolves PA-level outcomes, so pitch counts are estimated per
  // plate appearance. Averages ~3.8 pitches/PA league-wide: strikeouts and
  // walks are long PAs, balls in play shorter.
  // League average lands ~3.6 pitches/PA — the classic late-90s norm this
  // engine models (modern TTO baseball runs closer to 3.9).
  function pitchesForPA(kind) {
    switch (kind) {
      case 'K': return 4 + Math.floor(rand() * 3);   // 4-6
      case 'BB':
      case 'IBB': return 5 + Math.floor(rand() * 2); // 5-6
      case 'HBP': return 2 + Math.floor(rand() * 3); // 2-4
      default: return 2 + Math.floor(rand() * 3);    // 2-4 (BIP)
    }
  }

  // Piecewise-linear interpolation across the 7.4.1 tier anchors.
  function lerpTiers(stamina, anchors) {
    const s = clamp(stamina, 20, 80);
    for (let i = 1; i < anchors.length; i++) {
      if (s <= anchors[i][0]) {
        const [s0, v0] = anchors[i - 1];
        const [s1, v1] = anchors[i];
        return v0 + (v1 - v0) * ((s - s0) / (s1 - s0));
      }
    }
    return anchors[anchors.length - 1][1];
  }

  // Base pitch limit: the typical pull point before bonuses/penalties.
  // Anchored on the upper half of each tier's target window in 7.4.1.
  function basePitchLimit(stamina) {
    return lerpTiers(stamina, [
      [20, 12], [30, 18], [40, 25], [45, 40],
      [50, 82], [55, 96], [60, 104], [65, 110],
      [70, 116], [75, 121], [80, 126],
    ]);
  }

  // Hard ceiling the effective limit can never exceed (7.4.1 ceilings).
  function pitchCeiling(stamina) {
    return lerpTiers(stamina, [
      [20, 18], [30, 22], [40, 30], [45, 50],
      [50, 92], [55, 102], [60, 107], [65, 116],
      [70, 122], [75, 128], [80, 134],
    ]);
  }

  // Per-pitch decay of effective stuff/velocity/control/movement once the
  // pitcher works past ~80% of his base limit (7.4.4). Low-stamina arms
  // decay much faster once pushed past their window.
  function applyFatigue(rating, pitcher, def) {
    const stamina = pitcher.ratings.stamina;
    const threshold = basePitchLimit(stamina) * 0.8;
    const overage = Math.max(0, def.pitchCount - threshold);
    const decayRate = stamina >= 50 ? 0.20 : 0.45;
    return rating - overage * decayRate;
  }

  // Find the defensive catcher for SB resolution: prefer the catcher in the
  // active lineup, fall back to the best-armed catcher on the roster, fall
  // back to neutral 50 if nobody qualifies.
  function findCatcher(team, players) {
    const lineup = (team.lineupRH && team.lineupRH.length) ? team.lineupRH : team.lineupLH;
    if (lineup) {
      for (const spot of lineup) {
        if (spot.position === 'C') {
          const p = players[spot.playerId];
          if (p && team.roster.includes(p.id)) return p;
        }
      }
    }
    const catchers = (team.roster || [])
      .map((id) => players[id])
      .filter((p) => p && p.primaryPosition === 'C');
    if (catchers.length) {
      catchers.sort((a, b) => (b.ratings.arm || 50) - (a.ratings.arm || 50));
      return catchers[0];
    }
    return null;
  }

  function catcherArm(def) {
    return def.catcher && def.catcher.ratings ? (def.catcher.ratings.arm || 50) : 50;
  }

  // Pitcher hold modifier: stamina contributes a small generic deterrent.
  // No new "hold" rating per task scope.
  function pitcherHoldMod(pitcher) {
    return ((pitcher.ratings.stamina || 50) - 50) * 0.001;
  }

  // Sacrifice bunt decision (bible 7.5). Squeeze plays (R3) are not called.
  function shouldBunt(batter, off, def, bases, outs, inning) {
    if (outs >= 2) return false;
    if (bases[2]) return false;
    if (!bases[0] && !bases[1]) return false;
    if (batter.isPitcher) {
      // Classic-era pitcher at the plate: bunt the runner over, usually.
      return Math.random() < 0.55;
    }
    const mgr = off.mgr || { smallBall: 5 };
    if (mgr.smallBall <= 3) return false;
    // Close-and-late with a weak bat at the plate.
    const margin = off.runs - def.runs;
    if (inning < 7 && mgr.smallBall < 8) return false;
    if (margin < -2 || margin > 1) return false;
    if (hitterScore(batter) > 245) return false; // you don't bunt your stars
    return Math.random() < (mgr.smallBall - 3) * 0.05;
  }

  function shouldAttemptSB(runner, pitcher, off, def) {
    // Faster runners attempt more; stronger-armed catchers deter attempts.
    // The manager's small-ball tendency scales aggressiveness (7.5).
    const speed = runner.ratings.speed || 50;
    const arm = catcherArm(def);
    const armDeter = (arm - 50) * 0.005;       // ~0.15 swing across the arm grade
    const holdDeter = pitcherHoldMod(pitcher); // tiny extra for high-stamina pitcher
    const mgrMul = 1 + (((off.mgr && off.mgr.smallBall) || 5) - 5) * 0.09; // 0.64x-1.45x

    if (speed < 40) return Math.random() < clamp((0.01 - armDeter) * mgrMul, 0.001, 0.05);
    if (speed < 50) return Math.random() < clamp((0.042 - armDeter - holdDeter) * mgrMul, 0.005, 0.15);
    // Base/slope tuned to ~140 attempts per team per season (bible 7.2).
    const baseProb = (0.105 + (speed - 50) * 0.017 - armDeter - holdDeter) * mgrMul;
    return Math.random() < clamp(baseProb, 0.02, 0.40);
  }

  function resolveSB(runner, pitcher, def) {
    // Speed boosts success; catcher arm and pitcher hold reduce it.
    const speed = runner.ratings.speed || 50;
    const arm = catcherArm(def);
    const successProb = 0.66
      + (speed - 50) * 0.012
      - (arm - 50) * 0.008
      - pitcherHoldMod(pitcher);
    return Math.random() < clamp(successProb, 0.20, 0.95) ? 'safe' : 'caught';
  }

  // ---- Reliever rest (bible 7.4.6 / 10.1) --------------------------------
  // Appearance dates are stamped on the player at the end of each game
  // (lastPitchedDate / consecPitchDays). An arm that has worked three
  // straight days is unavailable; an arm that worked yesterday is picked
  // last within his role and pitches on a shorter leash.
  function pitchedYesterday(p, today) {
    return !!(p && p.lastPitchedDate &&
      window.BBGM_DATES.diffDays(p.lastPitchedDate, today) === 1);
  }

  function needsPenRest(p, today) {
    return pitchedYesterday(p, today) && (p.consecPitchDays || 0) >= 3;
  }

  // Lazily backfill bullpen roles for saves created before the roles field
  // existed (pre-Phase-3). Same logic as generation-time assignment.
  function ensureBullpenRoles(team, players) {
    if (team.bullpenRoles && team.bullpenRoles.setup) return team.bullpenRoles;
    team.bullpenRoles = window.BBGM_PLAYER_GEN.assignBullpenRoles(team, players);
    return team.bullpenRoles;
  }

  // Pick the next reliever by role + leverage (bible 7.4.6 / 7.8):
  //  - 9th+ with a 1-3 run lead (or tied in extras): closer
  //  - 7th+ close game: setup arms
  //  - blowout either way: mop-up, then long man
  //  - starter knocked out early: long man eats innings
  //  - otherwise: middle relief
  // Within a role, prefer the least-used arm this season (workload spread).
  function chooseReliever(off, def, inning, state) {
    const team = def.team;
    const players = state.players;
    const used = new Set(def.pitchersUsed);
    const margin = def.runs - off.runs; // our (fielding side's) lead
    const today = state.meta.currentDate;
    const year = today.year;
    const roles = ensureBullpenRoles(team, players);

    const inj = INJ();
    // Bullpen leverage tendency (17.2): matchup-driven managers use the
    // closer for 4-6 out saves and widen the setup window; role-rigid
    // managers hold the closer strictly for the 9th.
    const leverage = (def.mgr && def.mgr.leverage) || 5;
    const closerInning = leverage >= 8 ? 8 : 9;
    const closerP = team.closer && players[team.closer];
    const closerFree = closerP && !used.has(team.closer) && inj.isAvailable(closerP) &&
      team.roster.includes(team.closer) && !needsPenRest(closerP, today);
    if (closerFree && inning >= closerInning && margin >= 1 && margin <= 3) return players[team.closer];
    if (closerFree && leverage > 2 && inning >= 10 && margin === 0) return players[team.closer];

    const blowout = Math.abs(margin) >= 5;
    // Average leverage (4-6) reproduces the pre-Phase-10 engine exactly;
    // high-leverage managers widen the high-leverage window, role-rigid
    // managers shrink it.
    const closeBand = leverage >= 7 ? [-4, 5] : leverage <= 3 ? [-1, 3] : [-3, 4];
    const close = margin >= closeBand[0] && margin <= closeBand[1];
    const setupInning = leverage >= 7 ? 6 : 7;

    let order;
    if (blowout) order = ['mopup', 'long', 'middle', 'setup'];
    else if (inning >= setupInning && close) order = ['setup', 'middle', 'mopup', 'long'];
    else if (inning <= 4) order = ['long', 'mopup', 'middle', 'setup'];
    else order = ['middle', 'mopup', 'long', 'setup'];

    for (const role of order) {
      const cands = (roles[role] || []).filter((id) =>
        !used.has(id) && players[id] && inj.isAvailable(players[id]) &&
        team.roster.includes(id) && !needsPenRest(players[id], today));
      if (cands.length) {
        cands.sort((a, b) => {
          // Fresh arms first (didn't pitch yesterday), then spread workload.
          const ya = pitchedYesterday(players[a], today) ? 1 : 0;
          const yb = pitchedYesterday(players[b], today) ? 1 : 0;
          if (ya !== yb) return ya - yb;
          const ga = (players[a].stats[year] && players[a].stats[year].g) || 0;
          const gb = (players[b].stats[year] && players[b].stats[year].g) || 0;
          if (ga !== gb) return ga - gb;
          return Math.random() - 0.5;
        });
        return players[cands[0]];
      }
    }
    // Whole pen rested/used — allow three-straight-day arms as a fallback
    // before handing the ball to the closer in a non-save spot.
    for (const role of order) {
      const cands = (roles[role] || []).filter((id) =>
        !used.has(id) && players[id] && inj.isAvailable(players[id]));
      if (cands.length) return players[cands[0]];
    }
    if (closerP && !used.has(team.closer) && inj.isAvailable(closerP)) return closerP;
    return null;
  }

  function maybeChangePitcher(off, def, gs, inning, state) {
    const pitcher = def.currentP;
    const pitches = def.pitchCount; // estimated pitches this outing
    const stamina = pitcher.ratings.stamina;
    const isStarter = pitcher.id === def.sp.id;
    const ps = gs(pitcher);
    const ip = (ps.ipOuts || 0) / 3;
    const runsAllowed = ps.r || 0;
    const traffic = (ps.h || 0) + (ps.bb || 0);
    const margin = def.runs - off.runs;

    const quickHook = (def.mgr && def.mgr.quickHook) || 5;
    let pull = false;
    if (isStarter) {
      // Effective pitch limit (7.4.3): base + efficiency bonus - trouble
      // penalty, capped by the tier ceiling. Recomputed every PA. The
      // manager's quick-hook tendency stretches or shortens the leash
      // ~±8% (17.2).
      let limit = basePitchLimit(stamina);
      const ppi = ip > 0 ? pitches / ip : 0;
      if (ip >= 3 && ppi > 0 && ppi <= 14) limit += 12;
      else if (ip >= 3 && ppi > 0 && ppi <= 16) limit += 6;
      limit -= runsAllowed * 2.5;
      limit -= Math.max(0, traffic - ip * 1.8) * 2;
      limit *= 1 - (quickHook - 5) * 0.016;
      limit = Math.min(limit, pitchCeiling(stamina));
      limit = Math.max(limit, 45); // never pure-pitch-count yank absurdly early

      if (pitches >= limit) pull = true;

      // Blowup pull regardless of pitch count: the start has gone sideways.
      if (runsAllowed >= 6) pull = true;
      else if (runsAllowed >= 4 && ip < 5 && inning >= 3) pull = true;

      // Complete-game chase (7.4.5): a dominant starter late in a close,
      // low-run game stays in as long as he's under his tier ceiling.
      // Quick-hook managers don't chase complete games.
      if (pull && quickHook <= 6 && inning >= 8 && runsAllowed <= 2 && Math.abs(margin) <= 4 &&
          pitches < pitchCeiling(stamina) - 5 && stamina >= 60) {
        pull = false;
      }
    } else {
      // Reliever limit from his tier base, with a short-leash trouble pull.
      // An arm that worked yesterday pitches on a much shorter leash.
      let limit = Math.min(basePitchLimit(stamina), 60);
      if (pitchedYesterday(pitcher, state.meta.currentDate)) limit *= 0.65;
      if (pitches >= limit) pull = true;
      if (runsAllowed >= 3) pull = true;

      // Proactive closer call: protecting a 1-3 run lead in closer
      // territory (9th, or 8th for high-leverage managers), hand the ball
      // to the closer even if the current reliever isn't tired. Without
      // this, fresh setup men finish 9th innings under their pitch limits
      // and steal the save chances.
      const closerId = def.team.closer;
      const closerFrom = ((def.mgr && def.mgr.leverage) || 5) >= 8 ? 8 : 9;
      if (inning >= closerFrom && margin >= 1 && margin <= 3 && closerId &&
          pitcher.id !== closerId && !def.pitchersUsed.includes(closerId)) {
        pull = true;
      }
    }

    if (!pull) return;

    const next = chooseReliever(off, def, inning, state);
    if (!next) return; // bullpen empty — current pitcher keeps going

    // Record margins for hold / blown-save accounting.
    def.exitMargins[pitcher.id] = margin;
    def.entryMargins[next.id] = margin;

    def.currentP = next;
    def.pitchersUsed.push(next.id);
    def.pitchCount = 0;
  }

  function pickStarter(team, players, state) {
    if (!team.rotation || team.rotation.length === 0) return null;
    const dayIndex = state.meta.gamesPlayedByTeam ? (state.meta.gamesPlayedByTeam[team.id] || 0) : 0;
    // Walk the rotation starting at today's slot; the first available pitcher
    // (healthy AND still on the roster — rotation refs can go stale between
    // config rebuilds) starts. This lets an injured ace get skipped without
    // forcing a permanent rotation swap.
    const inj = INJ();
    const n = team.rotation.length;
    for (let i = 0; i < n; i++) {
      const sp = players[team.rotation[(dayIndex + i) % n]];
      if (sp && inj.isAvailable(sp) && team.roster.includes(sp.id)) return sp;
    }
    // Whole rotation unavailable — best healthy rostered arm starts
    // (SP-primary preferred) so the game can sim rather than throw.
    const arms = team.roster
      .map((id) => players[id])
      .filter((p) => p && p.isPitcher && inj.isAvailable(p))
      .sort((a, b) => {
        const sa = a.primaryPosition === 'SP' ? 0 : 1;
        const sb = b.primaryPosition === 'SP' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return (b.ratings.stamina || 0) - (a.ratings.stamina || 0);
      });
    return arms[0] || players[team.rotation[dayIndex % n]];
  }

  // Build the game-time lineup. Returns parallel { players, positions }
  // arrays so fatigue accumulation knows what slot each batter played
  // (catchers fatigue faster per bible 10.8). The lineup config itself
  // stays unchanged when an injured starter is substituted — the regular
  // slots back in as soon as he's available again.
  //
  // useDH follows the home team's league (bible 3.1). The stored lineup
  // shape differs by team league (East: 9 slots with a DH; West: 8), so
  // interleague games reshape here:
  //  - no-DH game, East team: drop the DH slot; pitcher bats 9th
  //  - no-DH game, West team: pitcher bats 9th (sentinel appended)
  //  - DH game, West team: best healthy bench bat is added as DH
  // The pitcher sentinel is players[i] = null with positions[i] = 'P';
  // simHalfInning resolves it to the batting side's current pitcher.
  function getLineupWithPositions(team, players, opposingSP, useDH, opts = {}) {
    const vsLefty = opposingSP && opposingSP.throws === 'L';
    const preferred = vsLefty ? team.lineupLH : team.lineupRH;
    const fallback = vsLefty ? team.lineupRH : team.lineupLH;
    let lineupSpec = (preferred && preferred.length) ? preferred : fallback;
    if (!lineupSpec || !lineupSpec.length) return { players: [], positions: [] };

    // East team playing under no-DH rules: the DH slot disappears (its
    // occupant is bench/sub-eligible for this game, like real interleague).
    if (!useDH) lineupSpec = lineupSpec.filter((s) => s.position !== 'DH');

    const inj = INJ();
    const fat = FAT();
    const used = new Set(lineupSpec.map((s) => s.playerId));
    const resultP = [];
    const resultPos = [];
    for (const spot of lineupSpec) {
      const p = players[spot.playerId];
      // Roster membership is required: a stale lineup ref (player traded,
      // demoted, or released since the lineup was set) must never field a
      // player for a team he isn't on — his stats would bucket to the
      // wrong side. The daily sub logic covers the slot instead.
      const available = p && inj.isAvailable(p) && team.roster.includes(p.id);
      // Auto-rest (bible 10.8): a starter at critical fatigue sits for the
      // day if a fresher bench bat can cover the slot — the engine handles
      // routine rest in the background for every team, user's included.
      // He slots straight back in once he's recovered below the threshold.
      const needsRest = available && fat && fat.isVeryHigh(p) && opts.allowRest !== false;
      // Scheduled rest: managers also give regulars routine maintenance
      // days LONG before fatigue turns critical — the reason nobody but
      // the catcher was ever sitting was that critical was the only
      // trigger. Scheduled rest only happens when a fresh position-
      // eligible bench bat can take the slot (never an out-of-position
      // scramble), so it costs a start, not the defense.
      if (available && !needsRest && opts.allowRest !== false &&
          shouldRestToday(p, opts.mgr, fat)) {
        // Preferred cover is a fresh, position-eligible bench bat. A long
        // consecutive-start streak gets broken even without one — real
        // managers patch the position out-of-position for a day rather
        // than run a regular out there 162 times.
        const restSub = findFreshEligibleSub(team, players, spot.position, used) ||
          ((p.consecStarts || 0) >= 20 ? findLineupSub(team, players, spot.position, used) : null);
        if (restSub) {
          used.add(restSub.id);
          resultP.push(restSub);
          resultPos.push(spot.position);
          continue;
        }
      }
      if (available && !needsRest) {
        resultP.push(p);
        resultPos.push(spot.position);
        continue;
      }
      const sub = findLineupSub(team, players, spot.position, used);
      if (sub) {
        used.add(sub.id);
        resultP.push(sub);
        resultPos.push(spot.position);
      } else if (p && team.roster.includes(p.id)) {
        // No bench bat fits the slot — the regular plays (tired or not) so
        // the game can sim (a deeper-rosters problem we'll surface later).
        // Stale refs (player no longer on the roster) never play; the
        // lineup runs a man short instead.
        resultP.push(p);
        resultPos.push(spot.position);
      }
    }

    if (useDH && !lineupSpec.some((s) => s.position === 'DH')) {
      // West team playing under DH rules: best healthy bench bat DHs.
      const dh = findLineupSub(team, players, 'DH', used);
      if (dh) {
        used.add(dh.id);
        resultP.push(dh);
        resultPos.push('DH');
      }
    }
    if (!useDH) {
      // Pitcher bats 9th.
      resultP.push(null);
      resultPos.push('P');
    }

    // Consecutive-start bookkeeping (regular season only): streaks feed
    // the scheduled-rest odds so nobody quietly starts 162.
    if (opts.allowRest !== false) {
      const starting = new Set(resultP.filter(Boolean).map((p) => p.id));
      for (const id of team.roster) {
        const rp = players[id];
        if (!rp || rp.isPitcher) continue;
        rp.consecStarts = starting.has(id) ? (rp.consecStarts || 0) + 1 : 0;
      }
    }
    return { players: resultP, positions: resultPos };
  }

  // Scheduled maintenance day (bible 10.8): probability scales with the
  // fatigue band, age (veterans get more planned days off), and the
  // manager's bench-usage inclination (the defSub tendency, Pillar 4).
  // Calibration target: non-catcher regulars ~145-155 games, catchers
  // ~120-140 — nobody quietly plays all 162.
  function shouldRestToday(p, mgr, fat) {
    if (!fat || p.isPitcher) return false;
    const f = p.fatigue || 0;
    let prob;
    if (f >= fat.HIGH) prob = 0.20;          // clearly gassed — sit soon
    else if (f >= fat.MODERATE) prob = 0.06; // routine rotation
    else if (f >= 30) prob = 0.03;
    else prob = 0.01;                        // rare "day game after a night game" off day
    if (p.age >= 35) prob *= 2;
    else if (p.age >= 32) prob *= 1.5;
    // Catchers get the most planned days off in baseball.
    if (p.primaryPosition === 'C') prob *= 1.4;
    prob *= 1 + (((mgr && mgr.defSub) || 5) - 5) * 0.06; // 0.76x-1.30x
    // Long consecutive-start streaks get broken regardless of fatigue —
    // the 162-game iron man should be a rare feat, not the default.
    const streak = p.consecStarts || 0;
    if (streak >= 25) prob = Math.max(prob, 0.40);
    else if (streak >= 15) prob = Math.max(prob, 0.12);
    return Math.random() < prob;
  }

  // Rest-day cover: a FRESH, position-eligible bench bat only. If the
  // bench can't cover the slot properly, the regular plays — scheduled
  // rest never forces an out-of-position scramble (that ladder is
  // reserved for injuries/critical fatigue in findLineupSub).
  function findFreshEligibleSub(team, players, position, used) {
    const GEN = window.BBGM_PLAYER_GEN;
    const inj = INJ();
    const fat = FAT();
    const cands = team.roster
      .map((id) => players[id])
      .filter((p) => p && !p.isPitcher && !used.has(p.id) && inj.isAvailable(p) &&
        GEN.canPlay(p, position) && (!fat || !fat.isModerate(p)));
    if (!cands.length) return null;
    cands.sort((a, b) => hitterScore(b) - hitterScore(a));
    return cands[0];
  }

  function findLineupSub(team, players, position, used) {
    const GEN = window.BBGM_PLAYER_GEN;
    const inj = INJ();
    const fat = FAT();
    const healthy = team.roster
      .map((id) => players[id])
      .filter((p) => p && !p.isPitcher && !used.has(p.id) && inj.isAvailable(p));
    if (!healthy.length) return null;
    // Preference ladder: position-eligible and fresh > eligible > any fresh
    // bat out of position > anyone. A 26-man roster always carries more
    // hitters than lineup slots, so a healthy roster never fields short
    // just because the natural backup is hurt.
    const eligible = healthy.filter((p) => GEN.canPlay(p, position));
    const freshOf = (arr) => (fat ? arr.filter((p) => !fat.isVeryHigh(p)) : arr);
    const pool = freshOf(eligible).length ? freshOf(eligible)
      : eligible.length ? eligible
      : freshOf(healthy).length ? freshOf(healthy)
      : healthy;
    pool.sort((a, b) => hitterScore(b) - hitterScore(a));
    return pool[0];
  }

  function hitterScore(p) {
    const r = p.ratings;
    return r.contactVsR + r.contactVsL + r.powerVsR + r.powerVsL + r.discipline + r.speed * 0.5;
  }

  function assignPitcherDecisions(teamState, gameStats) {
    // Pitcher G and GS are set at appearance time inside simHalfInning, so
    // this function handles W / L / SV / HLD / BS / CG / SHO. Exactly one W
    // and one L per completed game.
    const home = teamState.home;
    const away = teamState.away;
    const homeWon = home.runs > away.runs;
    const winSide = homeWon ? home : away;
    const lossSide = homeWon ? away : home;
    const finalMargin = (side, other) => side.runs - other.runs;

    // Final pitcher on each side never got an exitMargin — stamp it now.
    home.exitMargins[home.pitchersUsed[home.pitchersUsed.length - 1]] = finalMargin(home, away);
    away.exitMargins[away.pitchersUsed[away.pitchersUsed.length - 1]] = finalMargin(away, home);

    // Win: the pitcher of record — whoever was pitching for the winning
    // side when it took the lead for the last time (tracked in chargeRun,
    // MLB rule 9.17). One exception: a starter must complete 5 IP to earn
    // the W; otherwise it goes to the winning side's most effective
    // reliever (most outs recorded, fewest runs as tiebreak — 9.17(b)).
    let wpid = winSide.recordPid || winSide.sp.id;
    if (wpid === winSide.sp.id &&
        (!gameStats[wpid] || (gameStats[wpid].ipOuts || 0) < 15)) {
      const relievers = winSide.pitchersUsed.slice(1);
      let best = null;
      for (const rid of relievers) {
        const s = gameStats[rid];
        if (!s) continue;
        if (!best ||
            (s.ipOuts || 0) > (gameStats[best].ipOuts || 0) ||
            ((s.ipOuts || 0) === (gameStats[best].ipOuts || 0) && (s.r || 0) < (gameStats[best].r || 0))) {
          best = rid;
        }
      }
      if (best) wpid = best;
    }
    if (gameStats[wpid]) {
      gameStats[wpid].w = 1;
      winSide.wp = wpid;
    }

    // Loss: the pitcher responsible for the decisive go-ahead run — the
    // one the winning side scored when it last took the lead (tracked in
    // chargeRun via responsible-pitcher accounting, MLB rule 9.18).
    const lpid = lossSide.lossPid || lossSide.sp.id;
    if (gameStats[lpid]) {
      gameStats[lpid].l = 1;
      lossSide.lp = lpid;
    }

    // Save (MLB rule 9.19, simplified): winning side's final pitcher, not
    // the winning pitcher himself, who either (a) entered protecting a
    // lead of 1-3 and recorded at least 1 IP, or (b) pitched 3+ innings
    // with the lead. Final margin isn't the test — a closer who enters
    // +2 and wins 7-4 after his team tacks on still earns the save.
    if (winSide.pitchersUsed.length > 1) {
      const last = winSide.pitchersUsed[winSide.pitchersUsed.length - 1];
      const ls = gameStats[last];
      const entry = winSide.entryMargins[last];
      if (ls && last !== winSide.wp && entry != null &&
          (((entry >= 1 && entry <= 3) && (ls.ipOuts || 0) >= 3) ||
           ((ls.ipOuts || 0) >= 9 && entry >= 1))) {
        ls.sv = 1;
        winSide.savePid = last;
      }
    }

    // Holds and blown saves from entry/exit margins. A reliever who entered
    // protecting a 1-3 run lead and:
    //  - left with the lead intact and recorded an out → HLD (no HLD for
    //    the pitcher who earned the SV)
    //  - left with the lead gone → BS
    for (const side of [home, away]) {
      for (let i = 1; i < side.pitchersUsed.length; i++) {
        const pid = side.pitchersUsed[i];
        const line = gameStats[pid];
        if (!line) continue;
        const entry = side.entryMargins[pid];
        const exit = side.exitMargins[pid];
        if (entry == null || exit == null) continue;
        if (entry >= 1 && entry <= 3) {
          // No hold for the pitcher who earned the save or the win (a
          // pitcher gets at most one of W / SV / HLD per game).
          if (exit >= 1 && (line.ipOuts || 0) >= 1 &&
              pid !== side.savePid && pid !== side.wp) {
            line.hld = 1;
          } else if (exit <= 0) {
            line.bs = 1;
          }
        }
      }
    }

    // Complete games / shutouts: a side that used exactly one pitcher.
    for (const side of [home, away]) {
      if (side.pitchersUsed.length === 1) {
        const line = gameStats[side.sp.id];
        if (line) {
          line.cg = 1;
          const oppRuns = side === home ? away.runs : home.runs;
          if (oppRuns === 0) line.sho = 1;
        }
      }
    }
  }

  function updateLastTen(team, result) {
    team.seasonRecord.lastTen.push(result);
    if (team.seasonRecord.lastTen.length > 10) team.seasonRecord.lastTen.shift();
  }

  function updateStreak(team, won) {
    const streak = team.seasonRecord.streak || 0;
    if (won) {
      team.seasonRecord.streak = streak >= 0 ? streak + 1 : 1;
    } else {
      team.seasonRecord.streak = streak <= 0 ? streak - 1 : -1;
    }
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  return { simulateGame };
})();
