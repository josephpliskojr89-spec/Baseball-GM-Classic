// Game simulation engine. At-bat resolution following bible 7.3 with simplified
// but representative outcome math. Calibrated to produce close to target league
// averages (BA .265, K% 17%, BB% 9%, HR rate 2.8%).
window.BBGM_SIM = (function () {
  const S = window.BBGM_STATS;

  // Random helpers (use Math.random for in-game variance — seedable RNG used at gen)
  function rand() { return Math.random(); }
  function rnorm(mean = 0, stdev = 1) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + stdev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Convert 20-80 grade to a scaled multiplier centered at 1.0 for grade 50.
  function grade(r) { return (r - 50) / 25; } // -1.2 to 1.2 typical

  // Simulate one game, mutating player stats and returning a result.
  function simulateGame(state, game) {
    const home = state.league.teams.find((t) => t.id === game.homeId);
    const away = state.league.teams.find((t) => t.id === game.awayId);
    const players = state.players;
    const year = state.meta.currentDate.year;

    // Set up lineups: home in DH league uses DH; away uses home league rules
    const homeLineup = getLineup(home, players, away);
    const awayLineup = getLineup(away, players, home);

    // Starters
    const homeSP = pickStarter(home, players, state);
    const awaySP = pickStarter(away, players, state);

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
    const teamState = {
      home: {
        team: home, lineup: homeLineup, lineupIdx: 0,
        sp: homeSP, currentP: homeSP, pitchCount: 0, pitchersUsed: [homeSP.id], runs: 0, hits: 0, errors: 0,
        bullpenIdx: 0, parkFactors: home.ballpark.factors,
        catcher: findCatcher(home, players),
      },
      away: {
        team: away, lineup: awayLineup, lineupIdx: 0,
        sp: awaySP, currentP: awaySP, pitchCount: 0, pitchersUsed: [awaySP.id], runs: 0, hits: 0, errors: 0,
        bullpenIdx: 0, parkFactors: home.ballpark.factors, // Park factors apply to both
        catcher: findCatcher(away, players),
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
    // recorded so we can validate ipOuts attribution at the end.
    let inning = 1;
    let extras = false;
    let homeOuts = 0; // outs the home staff recorded against away batters
    let awayOuts = 0;
    while (inning <= 9 || teamState.home.runs === teamState.away.runs) {
      // Top half (away batting, home pitching)
      homeOuts += simHalfInning(teamState.away, teamState.home, gs, inning, false, state);
      // If 9+ and home leading, end before bottom half
      if (inning >= 9 && teamState.home.runs > teamState.away.runs && !extras) {
        break;
      }
      // Bottom half (home batting, away pitching)
      awayOuts += simHalfInning(teamState.home, teamState.away, gs, inning, true, state);
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
      year,
    };
    return game.result;
  }

  function simHalfInning(off, def, gs, inning, isBottom, state) {
    let outs = 0;
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
      maybeChangePitcher(off, def, inning, outs, 0, isBottom, state);

      const pitcher = def.currentP;
      const result = resolveAtBat(batter, pitcher, off.parkFactors, def);
      def.pitchCount++;

      const bs = gs(batter);
      const ps = gs(pitcher);
      bs.pa++;
      ps.bf++;

      // Pitcher appearance is recorded the moment they face a batter so G/GS
      // can never be overwritten or skipped by the decision logic later.
      if (!ps.g) ps.g = 1;
      if (pitcher.id === def.sp.id && !ps.gs) ps.gs = 1;

      const newRunner = { playerId: batter.id, responsiblePitcherId: pitcher.id };

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
          outs++;
          ps.ipOuts = (ps.ipOuts || 0) + 1;
          const r3 = bases[2];
          bases[2] = null;
          chargeRun(r3);
          bs.sf++;
          bs.rbi++;
        } else if (isGIDP) {
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

      // Stolen base attempts after PA (only with R1, no R2 ahead).
      if (bases[0] && outs < 3 && !bases[1]) {
        const runner = state.players[bases[0].playerId];
        if (shouldAttemptSB(runner, pitcher, def)) {
          const sbResult = resolveSB(runner, pitcher, def);
          if (sbResult === 'safe') {
            bases[1] = bases[0]; bases[0] = null;
            gs(runner).sb++;
          } else {
            // Caught stealing: out credited to current pitcher on the mound.
            bases[0] = null;
            outs++;
            ps.ipOuts = (ps.ipOuts || 0) + 1;
            gs(runner).cs++;
          }
        }
      }
    }
    // Defensive: outs should never exceed 3 in a half-inning. If it does
    // (only via simultaneous events like CS-after-walkoff), the loop guard
    // above would have already exited. Cap at 3 for safety in any return.
    return Math.min(outs, 3);
  }

  function getPlayerById(state, id) {
    return state.players[id];
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

  function applyFatigue(rating, pitcher, def) {
    const stamina = pitcher.ratings.stamina;
    const threshold = stamina <= 30 ? 30 : stamina <= 50 ? 70 : stamina <= 70 ? 90 : 105;
    const overage = Math.max(0, def.pitchCount - threshold);
    const decay = overage * 0.15;
    return rating - decay;
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

  function maybeChangePitcher(off, def, inning, outs, runsThisInning, isBottom, state) {
    const pitcher = def.currentP;
    // def.pitchCount increments by 1 per PA — it tracks batters faced, not
    // actual pitches. Limits below are expressed in BF.
    const bf = def.pitchCount;
    const stamina = pitcher.ratings.stamina;
    const isStarter = pitcher.id === def.sp.id;

    let pull = false;
    if (isStarter) {
      // Target ~5.5–7.0 IP per start. SP retires roughly 18–22 batters at
      // peak; baserunners push BF a bit higher. Pull around 22–28 BF
      // depending on stamina.
      const limit = stamina >= 70 ? 30 : stamina >= 50 ? 26 : 22;
      if (bf >= limit) pull = true;
      // Late-inning hand-off to the bullpen (pull at the 7th regardless if
      // the SP has already worked through the order multiple times).
      if (inning >= 7 && bf >= 24) pull = true;
    } else {
      // Reliever — typically 1 inning, multi-inning if stamina supports it.
      const limit = stamina >= 60 ? 9 : 5;
      if (bf >= limit) pull = true;
    }

    if (!pull) return;

    // Choose next pitcher
    const team = def.team;
    const players = state.players;
    const used = new Set(def.pitchersUsed);
    let next = null;

    // If 9th inning and team leading by 1-3, bring closer
    const ourRuns = isBottom ? def.runs : off.runs - off.runs; // off is the team batting in this half (we're def)
    const theirRuns = isBottom ? off.runs : def.runs;
    // (This is simplified — closer logic just picks closer if late and we're ahead)
    const margin = def.runs - off.runs;
    if (inning >= 9 && margin > 0 && margin <= 3 && team.closer && !used.has(team.closer)) {
      next = players[team.closer];
    }

    if (!next) {
      for (const id of team.bullpen) {
        if (!used.has(id)) { next = players[id]; break; }
      }
    }
    if (!next) return; // no one available - keep going
    def.currentP = next;
    def.pitchersUsed.push(next.id);
    def.pitchCount = 0;
    // Reliever entering counts as a game appearance
    // We'll record that when stats are saved
  }

  function pickStarter(team, players, state) {
    if (!team.rotation || team.rotation.length === 0) return null;
    // Use day-of-year mod 5 to rotate
    const dayIndex = state.meta.gamesPlayedByTeam ? (state.meta.gamesPlayedByTeam[team.id] || 0) : 0;
    const sp = players[team.rotation[dayIndex % team.rotation.length]];
    return sp;
  }

  function getLineup(team, players, opponent) {
    // For now ignore opp pitcher handedness to keep simple, use vs RHP lineup
    const lineupSpec = team.lineupRH && team.lineupRH.length ? team.lineupRH : team.lineupLH;
    if (!lineupSpec || !lineupSpec.length) return [];
    return lineupSpec.map((spot) => players[spot.playerId]).filter(Boolean);
  }

  function assignPitcherDecisions(teamState, gameStats) {
    // Pitcher G and GS are set at appearance time inside simHalfInning, so
    // this function only handles W / L / SV. We award exactly one W and one
    // L per completed game.
    const home = teamState.home;
    const away = teamState.away;
    const homeWon = home.runs > away.runs;
    const winSide = homeWon ? home : away;
    const lossSide = homeWon ? away : home;

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

    // Loss: always charged to the SP for now.
    if (lossSPStats) {
      lossSPStats.l = 1;
      lossSide.lp = lossSP.id;
    }

    // Save: winning side's final pitcher, if he wasn't the SP, kept the lead
    // by 1-3 runs, and recorded at least 1 IP.
    if (winSide.pitchersUsed.length > 1) {
      const last = winSide.pitchersUsed[winSide.pitchersUsed.length - 1];
      const ls = gameStats[last];
      const margin = winSide.runs - lossSide.runs;
      if (ls && margin >= 1 && margin <= 3 && ls.ipOuts >= 3 && last !== winSP.id) {
        ls.sv = 1;
        winSide.savePid = last;
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
