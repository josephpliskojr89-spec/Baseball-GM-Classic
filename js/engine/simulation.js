// Game simulation engine. At-bat resolution following bible 7.3 with simplified
// but representative outcome math. Calibrated to produce close to target league
// averages (BA .265, K% 17%, BB% 9%, HR rate 2.8%).
window.BBGM_SIM = (function () {
  const S = window.BBGM_STATS;

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

    // Lineups: vs-LHP lineup when the opposing starter throws left.
    const homeLineup = getLineup(home, players, awaySP);
    const awayLineup = getLineup(away, players, homeSP);

    // Hard fail loudly rather than silently marking the game played.
    // Earlier bail-out behaviour silently dropped W/L records, producing
    // 0-0 teams in late September. Generation-time readiness validation
    // (BBGM_PLAYER_GEN.validateLeagueReadiness) should prevent this from
    // ever firing — but keep the throw so any future regression surfaces.
    if (!homeSP || !awaySP || homeLineup.length < 8 || awayLineup.length < 8) {
      const reason = [];
      if (!homeSP) reason.push(`home (${home.abbr}) has no starting pitcher`);
      if (!awaySP) reason.push(`away (${away.abbr}) has no starting pitcher`);
      if (homeLineup.length < 8) reason.push(`home lineup length ${homeLineup.length} < 8`);
      if (awayLineup.length < 8) reason.push(`away lineup length ${awayLineup.length} < 8`);
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
    const teamState = {
      home: {
        team: home, lineup: homeLineup, lineupIdx: 0,
        sp: homeSP, currentP: homeSP, pitchCount: 0, pitchersUsed: [homeSP.id], runs: 0, hits: 0, errors: 0,
        parkFactors: home.ballpark.factors,
        catcher: findCatcher(home, players),
        entryMargins: { [homeSP.id]: 0 }, exitMargins: {},
      },
      away: {
        team: away, lineup: awayLineup, lineupIdx: 0,
        sp: awaySP, currentP: awaySP, pitchCount: 0, pitchersUsed: [awaySP.id], runs: 0, hits: 0, errors: 0,
        parkFactors: home.ballpark.factors, // Park factors apply to both
        catcher: findCatcher(away, players),
        entryMargins: { [awaySP.id]: 0 }, exitMargins: {},
      },
    };

    // Initialize stat tracking for this game
    const gameStats = {};
    function gs(p) {
      if (!gameStats[p.id]) {
        gameStats[p.id] = p.isPitcher ? S.emptyPitcher() : S.emptyHitter();
        gameStats[p.id]._playerId = p.id;
      }
      return gameStats[p.id];
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
      homeOuts += simHalfInning(teamState.away, teamState.home, gs, inning, false, state, gameLog);
      lineScore.away.push(teamState.away.runs - awayBefore);
      // If 9+ and home leading, end before bottom half
      if (inning >= 9 && teamState.home.runs > teamState.away.runs) {
        break;
      }
      // Bottom half (home batting, away pitching)
      const homeBefore = teamState.home.runs;
      awayOuts += simHalfInning(teamState.home, teamState.away, gs, inning, true, state, gameLog);
      lineScore.home.push(teamState.home.runs - homeBefore);
      if (inning >= 9 && teamState.home.runs !== teamState.away.runs) break;
      inning++;
      if (inning > 18) break; // safety cap
    }

    // Compute decisions (W/L/SV)
    assignPitcherDecisions(teamState, gameStats);

    // Hitter games played: every batter who took at least one PA in this
    // game gets G=1 (exactly once per game). With no in-game substitutions
    // yet, the lineup batters who hit are the only candidates. Pitcher G/GS
    // is set at appearance time inside simHalfInning.
    for (const pid in gameStats) {
      const p = players[pid];
      if (!p || p.isPitcher) continue;
      const line = gameStats[pid];
      if ((line.pa || 0) > 0) line.g = 1;
    }

    // Per-game invariant validation. Catches accounting bugs immediately
    // rather than letting them silently pollute season totals. Throws if
    // any check fails — simOneDay surfaces the throw to the user.
    const homeBatterStats = [];
    const awayBatterStats = [];
    const homePitcherStats = [];
    const awayPitcherStats = [];
    for (const pid in gameStats) {
      const p = players[pid];
      if (!p) continue;
      const isHome = p.teamId === home.id;
      const bucket = p.isPitcher
        ? (isHome ? homePitcherStats : awayPitcherStats)
        : (isHome ? homeBatterStats : awayBatterStats);
      bucket.push(gameStats[pid]);
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

    // Update player season stats
    for (const pid in gameStats) {
      const p = players[pid];
      if (!p) continue;
      const seasonStats = S.ensureSeason(p, year);
      const gameLine = gameStats[pid];
      delete gameLine._playerId;
      S.addStat(seasonStats, gameLine);
    }

    // Update team records
    const homeWon = teamState.home.runs > teamState.away.runs;
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

    // Per-game box lines for the Game Detail view (bible 20.6.4). Compact
    // arrays — decoder lives in the UI. Batters in lineup order:
    //   [pid, ab, r, h, b2, b3, hr, rbi, bb, k, sb]
    // Pitchers in appearance order:
    //   [pid, ipOuts, h, r, er, bb, k, hr]
    function boxFor(side) {
      const batters = [];
      for (const p of side.lineup) {
        const s = gameStats[p.id];
        if (!s) continue;
        batters.push([p.id, s.ab || 0, s.r || 0, s.h || 0, s.b2 || 0, s.b3 || 0, s.hr || 0, s.rbi || 0, s.bb || 0, s.k || 0, s.sb || 0]);
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

  function simHalfInning(off, def, gs, inning, isBottom, state, log) {
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

    // Charge a scored run: R to the runner's batting line, R+ER to the
    // pitcher who was responsible for putting that runner on base. We assume
    // all runs are earned until the error system exists.
    function chargeRun(scoredRunner) {
      off.runs++;
      const runnerP = state.players[scoredRunner.playerId];
      if (runnerP) gs(runnerP).r++;
      const respP = state.players[scoredRunner.responsiblePitcherId];
      if (respP) {
        const rs = gs(respP);
        rs.r = (rs.r || 0) + 1;
        rs.er = (rs.er || 0) + 1;
      }
    }

    while (outs < 3) {
      const batter = off.lineup[off.lineupIdx];
      off.lineupIdx = (off.lineupIdx + 1) % off.lineup.length;

      // Check pitcher fatigue / change
      maybeChangePitcher(off, def, gs, inning, state);

      const pitcher = def.currentP;
      const result = resolveAtBat(batter, pitcher, off.parkFactors, def);
      def.pitchCount += pitchesForPA(result.kind);

      const bs = gs(batter);
      const ps = gs(pitcher);
      bs.pa++;
      ps.bf++;

      // Pitcher appearance is recorded the moment they face a batter so G/GS
      // can never be overwritten or skipped by the decision logic later.
      if (!ps.g) ps.g = 1;
      if (pitcher.id === def.sp.id && !ps.gs) ps.gs = 1;

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
        //  - SF: flyout + R3 scores + fewer than 2 outs at start of play
        //        → counts as PA, SF, RBI; NOT counted as AB.
        //  - GIDP: out + R1 + fewer than 2 outs at start of play
        //        → counts as AB and GIDP; turns into 2 outs total.
        //  - Otherwise: a regular out, counts as AB.
        const outsBefore = outs;
        let isSF = false;
        let isGIDP = false;
        if (bases[0] && outsBefore < 2 && Math.random() < 0.10) {
          isGIDP = true;
        } else if (bases[2] && outsBefore < 2 && result.battedBall === 'fly' && Math.random() < 0.55) {
          isSF = true;
        }

        if (isSF) {
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
      if (bases[0] && outs < 3 && !bases[1]) {
        const runner = state.players[bases[0].playerId];
        if (shouldAttemptSB(runner, pitcher, def)) {
          const sbOuts = outs;
          const sbMask = baseMaskOf(bases);
          const sbResult = resolveSB(runner, pitcher, def);
          if (sbResult === 'safe') {
            bases[1] = bases[0]; bases[0] = null;
            gs(runner).sb++;
            if (log) logPlay(log, inning, isBottom, runner.id, pitcher.id, sbOuts, sbMask, 'SB', 0, off, def);
          } else {
            // Caught stealing: out credited to current pitcher on the mound.
            bases[0] = null;
            outs++;
            ps.ipOuts = (ps.ipOuts || 0) + 1;
            gs(runner).cs++;
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

  // Bases hold runner objects. The new runner (the batter who reached base)
  // arrives with responsiblePitcherId already set by the caller. Returns the
  // runners who crossed the plate so the caller can charge their R/ER to
  // whatever pitcher each runner is responsible-charged against.
  function advanceOnHit(bases, batter, hitType, newRunner) {
    const runs = [];
    const bs = bases.slice();
    const speed = batter.ratings.speed || 50;
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
    const r = batter.ratings;
    const p = pitcher.ratings;

    // Use handedness for hitter ratings
    const vsHand = pitcher.throws === 'L' ? 'L' : 'R';
    let contact = vsHand === 'L' ? r.contactVsL : r.contactVsR;
    let power = vsHand === 'L' ? r.powerVsL : r.powerVsR;

    // Switch hitter chooses opposite-handed
    if (batter.bats === 'S') {
      contact = vsHand === 'L' ? r.contactVsR : r.contactVsL;
      power = vsHand === 'L' ? r.powerVsR : r.powerVsL;
    }

    const discipline = r.discipline;
    const stuff = applyFatigue(p.stuff, pitcher, def);
    const control = applyFatigue(p.control, pitcher, def);
    const movement = applyFatigue(p.movement, pitcher, def);
    const velocity = applyFatigue(p.velocity, pitcher, def);

    // Base rates - calibrated to target league averages.
    // K rate: 17%. Driven by stuff+velocity vs contact+discipline.
    const kBase = 0.185;
    const kAdj = (grade(stuff) * 0.06) + (grade(velocity) * 0.03) - (grade(contact) * 0.05) - (grade(discipline) * 0.02);
    const kProb = clamp(kBase + kAdj, 0.04, 0.45);

    // BB rate: 9%. Driven by control vs discipline.
    const bbBase = 0.09;
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
      let hitProb = 0.235 + grade(r.speed) * 0.04 + grade(contact) * 0.015;
      hitProb *= parkHitsFactor;
      if (Math.random() < hitProb) {
        if (Math.random() < 0.04 * parkXBHFactor) return { kind: '2B', battedBall: bbType };
        return { kind: '1B', battedBall: bbType };
      }
      return { kind: 'OUT', battedBall: bbType };
    }

    if (bbType === 'line') {
      // Line drives: target ~ .65 hit rate
      let hitProb = 0.66 + grade(contact) * 0.03;
      hitProb *= parkHitsFactor;
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
      const hrBase = 0.10;
      const hrAdj = grade(power) * 0.08;
      let hrProb = clamp((hrBase + hrAdj) * parkHRFactor, 0.02, 0.50);
      if (Math.random() < hrProb) return { kind: 'HR', battedBall: bbType };

      const xbProb = 0.12 * parkXBHFactor;
      if (Math.random() < xbProb) {
        if (Math.random() < 0.08) return { kind: '3B', battedBall: bbType };
        return { kind: '2B', battedBall: bbType };
      }
      const singleProb = 0.07 + grade(contact) * 0.02;
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
          if (p) return p;
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

  function shouldAttemptSB(runner, pitcher, def) {
    // Faster runners attempt more; stronger-armed catchers deter attempts.
    const speed = runner.ratings.speed || 50;
    const arm = catcherArm(def);
    const armDeter = (arm - 50) * 0.005;       // ~0.15 swing across the arm grade
    const holdDeter = pitcherHoldMod(pitcher); // tiny extra for high-stamina pitcher

    if (speed < 40) return Math.random() < clamp(0.01 - armDeter, 0.001, 0.05);
    if (speed < 50) return Math.random() < clamp(0.045 - armDeter - holdDeter, 0.005, 0.15);
    const baseProb = 0.115 + (speed - 50) * 0.018 - armDeter - holdDeter;
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
    const year = state.meta.currentDate.year;
    const roles = ensureBullpenRoles(team, players);

    const closerFree = team.closer && !used.has(team.closer) && players[team.closer];
    if (closerFree && inning >= 9 && margin >= 1 && margin <= 3) return players[team.closer];
    if (closerFree && inning >= 10 && margin === 0) return players[team.closer];

    const blowout = Math.abs(margin) >= 5;
    const close = margin >= -2 && margin <= 3;

    let order;
    if (blowout) order = ['mopup', 'long', 'middle', 'setup'];
    else if (inning >= 7 && close) order = ['setup', 'middle', 'mopup', 'long'];
    else if (inning <= 4) order = ['long', 'mopup', 'middle', 'setup'];
    else order = ['middle', 'mopup', 'long', 'setup'];

    for (const role of order) {
      const cands = (roles[role] || []).filter((id) => !used.has(id) && players[id]);
      if (cands.length) {
        cands.sort((a, b) => {
          const ga = (players[a].stats[year] && players[a].stats[year].g) || 0;
          const gb = (players[b].stats[year] && players[b].stats[year].g) || 0;
          if (ga !== gb) return ga - gb;
          return Math.random() - 0.5;
        });
        return players[cands[0]];
      }
    }
    // Last resort: the closer even in a non-save spot.
    if (closerFree) return players[team.closer];
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

    let pull = false;
    if (isStarter) {
      // Effective pitch limit (7.4.3): base + efficiency bonus - trouble
      // penalty, capped by the tier ceiling. Recomputed every PA.
      let limit = basePitchLimit(stamina);
      const ppi = ip > 0 ? pitches / ip : 0;
      if (ip >= 3 && ppi > 0 && ppi <= 14) limit += 12;
      else if (ip >= 3 && ppi > 0 && ppi <= 16) limit += 6;
      limit -= runsAllowed * 2.5;
      limit -= Math.max(0, traffic - ip * 1.8) * 2;
      limit = Math.min(limit, pitchCeiling(stamina));
      limit = Math.max(limit, 45); // never pure-pitch-count yank absurdly early

      if (pitches >= limit) pull = true;

      // Blowup pull regardless of pitch count: the start has gone sideways.
      if (runsAllowed >= 6) pull = true;
      else if (runsAllowed >= 4 && ip < 5 && inning >= 3) pull = true;

      // Complete-game chase (7.4.5): a dominant starter late in a close,
      // low-run game stays in as long as he's under his tier ceiling.
      if (pull && inning >= 8 && runsAllowed <= 2 && Math.abs(margin) <= 4 &&
          pitches < pitchCeiling(stamina) - 5 && stamina >= 60) {
        pull = false;
      }
    } else {
      // Reliever limit from his tier base, with a short-leash trouble pull.
      const limit = Math.min(basePitchLimit(stamina), 60);
      if (pitches >= limit) pull = true;
      if (runsAllowed >= 3) pull = true;

      // Proactive closer call: 9th inning or later protecting a 1-3 run
      // lead, hand the ball to the closer even if the current reliever
      // isn't tired. Without this, fresh setup men finish 9th innings
      // under their pitch limits and steal the save chances.
      const closerId = def.team.closer;
      if (inning >= 9 && margin >= 1 && margin <= 3 && closerId &&
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
    // Use day-of-year mod 5 to rotate
    const dayIndex = state.meta.gamesPlayedByTeam ? (state.meta.gamesPlayedByTeam[team.id] || 0) : 0;
    const sp = players[team.rotation[dayIndex % team.rotation.length]];
    return sp;
  }

  function getLineup(team, players, opposingSP) {
    // Use the vs-LHP lineup when the opposing starter throws left, the
    // vs-RHP lineup otherwise. Falls back to whichever lineup exists.
    const vsLefty = opposingSP && opposingSP.throws === 'L';
    const preferred = vsLefty ? team.lineupLH : team.lineupRH;
    const fallback = vsLefty ? team.lineupRH : team.lineupLH;
    const lineupSpec = (preferred && preferred.length) ? preferred : fallback;
    if (!lineupSpec || !lineupSpec.length) return [];
    return lineupSpec.map((spot) => players[spot.playerId]).filter(Boolean);
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

    const winSP = winSide.sp;
    const lossSP = lossSide.sp;
    const winSPStats = gameStats[winSP.id];
    const lossSPStats = gameStats[lossSP.id];

    // Win: SP keeps it if he went 5+ IP, otherwise it goes to the last
    // reliever the winning side used (simplified — official MLB rules
    // consider lead-protection more carefully).
    if (winSPStats && (winSPStats.ipOuts || 0) >= 15) {
      winSPStats.w = 1;
      winSide.wp = winSP.id;
    } else if (winSPStats) {
      const winRelievers = winSide.pitchersUsed.slice(1);
      if (winRelievers.length > 0) {
        const last = winRelievers[winRelievers.length - 1];
        if (gameStats[last]) gameStats[last].w = 1;
        winSide.wp = last;
      } else {
        // Edge case: SP went <5 IP but no reliever was used. Give the W to
        // the SP rather than leave the game without a winning pitcher.
        winSPStats.w = 1;
        winSide.wp = winSP.id;
      }
    }

    // Save: winning side's final pitcher, if he wasn't the SP, didn't earn
    // the W himself (MLB rule 9.19 — the winning pitcher cannot also get a
    // save), kept the lead by 1-3 runs, and recorded at least 1 IP.
    if (winSide.pitchersUsed.length > 1) {
      const last = winSide.pitchersUsed[winSide.pitchersUsed.length - 1];
      const ls = gameStats[last];
      const margin = winSide.runs - lossSide.runs;
      if (ls && margin >= 1 && margin <= 3 && ls.ipOuts >= 3 &&
          last !== winSP.id && last !== winSide.wp) {
        ls.sv = 1;
        winSide.savePid = last;
      }
    }

    // Holds and blown saves from entry/exit margins. A reliever who entered
    // protecting a 1-3 run lead and:
    //  - left with the lead intact and recorded an out → HLD (no HLD for
    //    the pitcher who earned the SV)
    //  - left with the lead gone → BS
    let lossSideBlewIt = null;
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
            if (side === lossSide) lossSideBlewIt = pid;
          }
        }
      }
    }

    // Loss: charged to the reliever who blew the lead when there is one,
    // otherwise to the SP (simplified).
    if (lossSideBlewIt && gameStats[lossSideBlewIt]) {
      gameStats[lossSideBlewIt].l = 1;
      lossSide.lp = lossSideBlewIt;
    } else if (lossSPStats) {
      lossSPStats.l = 1;
      lossSide.lp = lossSP.id;
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
