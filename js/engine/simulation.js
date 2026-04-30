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

    // Track game state
    const teamState = {
      home: {
        team: home, lineup: homeLineup, lineupIdx: 0,
        sp: homeSP, currentP: homeSP, pitchCount: 0, pitchersUsed: [homeSP.id], runs: 0, hits: 0, errors: 0,
        bullpenIdx: 0, parkFactors: home.ballpark.factors,
      },
      away: {
        team: away, lineup: awayLineup, lineupIdx: 0,
        sp: awaySP, currentP: awaySP, pitchCount: 0, pitchersUsed: [awaySP.id], runs: 0, hits: 0, errors: 0,
        bullpenIdx: 0, parkFactors: home.ballpark.factors, // Park factors apply to both
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

    // Half-innings
    let inning = 1;
    let extras = false;
    while (inning <= 9 || teamState.home.runs === teamState.away.runs) {
      // Top half (away batting)
      simHalfInning(teamState.away, teamState.home, gs, inning, false, state);
      // If 9+ and home leading, end before bottom half
      if (inning >= 9 && teamState.home.runs > teamState.away.runs && !extras) {
        break;
      }
      // Bottom half (home batting)
      simHalfInning(teamState.home, teamState.away, gs, inning, true, state);
      if (inning >= 9 && teamState.home.runs !== teamState.away.runs) break;
      inning++;
      if (inning > 18) break; // safety cap
    }

    // Compute decisions (W/L/SV)
    assignPitcherDecisions(teamState, gameStats);

    // Hitter games played: every batter who took at least one PA in this
    // game gets G=1 (exactly once per game). With no in-game substitutions
    // yet, the lineup batters who hit are the only candidates. Pitchers
    // don't get G here — pitcher G is handled in assignPitcherDecisions
    // and is keyed off appearances.
    for (const pid in gameStats) {
      const p = players[pid];
      if (!p || p.isPitcher) continue;
      const line = gameStats[pid];
      if ((line.pa || 0) > 0) line.g = 1;
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
    let bases = [null, null, null]; // 1B, 2B, 3B
    let runsThisInning = 0;
    let earnedRunsThisInning = 0;

    while (outs < 3) {
      const batter = off.lineup[off.lineupIdx];
      off.lineupIdx = (off.lineupIdx + 1) % off.lineup.length;

      // Check pitcher fatigue / change
      maybeChangePitcher(off, def, inning, outs, runsThisInning, isBottom, state);

      const pitcher = def.currentP;
      const result = resolveAtBat(batter, pitcher, off.parkFactors, def);
      def.pitchCount++;

      // Stats
      const bs = gs(batter);
      const ps = gs(pitcher);
      bs.pa++;
      ps.bf++;

      if (result.kind === 'BB' || result.kind === 'IBB') {
        bs.bb++;
        ps.bb++;
        const advance = forceWalk(bases, batter.id);
        bases = advance.bases;
        for (const r of advance.runs) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
          bs.rbi++;
        }
      } else if (result.kind === 'HBP') {
        bs.pa = bs.pa; // already counted
        bs.hbp++;
        ps.hbp++;
        const advance = forceWalk(bases, batter.id);
        bases = advance.bases;
        for (const r of advance.runs) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
          bs.rbi++;
        }
      } else if (result.kind === 'K') {
        bs.ab++;
        bs.k++;
        ps.k++;
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
          const r3 = bases[2];
          bases[2] = null;
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r3)).r++;
          bs.sf++;
          bs.rbi++;
        } else if (isGIDP) {
          bs.ab++;
          bs.gidp++;
          outs += 2;
          if (outs > 3) outs = 3;
          bases[0] = null;
        } else {
          bs.ab++;
          outs++;
        }
      } else if (result.kind === '1B') {
        bs.ab++; bs.h++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 1);
        bases = advance.bases;
        for (const r of advance.runs) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
          bs.rbi++;
        }
      } else if (result.kind === '2B') {
        bs.ab++; bs.h++; bs.b2++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 2);
        bases = advance.bases;
        for (const r of advance.runs) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
          bs.rbi++;
        }
      } else if (result.kind === '3B') {
        bs.ab++; bs.h++; bs.b3++; ps.h++; off.hits++;
        const advance = advanceOnHit(bases, batter, 3);
        bases = advance.bases;
        for (const r of advance.runs) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
          bs.rbi++;
        }
      } else if (result.kind === 'HR') {
        bs.ab++; bs.h++; bs.hr++; ps.hr++; ps.h++; off.hits++;
        // Runners + batter score
        const baserunners = bases.filter((b) => b);
        bases = [null, null, null];
        for (const r of baserunners) {
          off.runs++; runsThisInning++; earnedRunsThisInning++;
          gs(getPlayerById(state, r)).r++;
        }
        // Batter run
        off.runs++; runsThisInning++; earnedRunsThisInning++;
        bs.r++;
        bs.rbi += baserunners.length + 1;
      }

      // Stolen base attempts after PA (if runner on 1B and no HR/walk-base-clear)
      if (bases[0] && outs < 3 && !bases[1]) {
        const runner = getPlayerById(state, bases[0]);
        if (shouldAttemptSB(runner, pitcher, def)) {
          const sbResult = resolveSB(runner, pitcher, def);
          if (sbResult === 'safe') {
            bases[1] = bases[0]; bases[0] = null;
            gs(runner).sb++;
          } else {
            bases[0] = null;
            outs++;
            gs(runner).cs++;
          }
        }
      }
    }

    // Pitcher IP
    const ps = gs(def.currentP);
    ps.ipOuts = (ps.ipOuts || 0) + 3;
    ps.r = (ps.r || 0) + runsThisInning;
    ps.er = (ps.er || 0) + earnedRunsThisInning;
  }

  function getPlayerById(state, id) {
    return state.players[id];
  }

  function forceWalk(bases, batterId) {
    const runs = [];
    let bs = bases.slice();
    if (bs[0] && bs[1] && bs[2]) {
      runs.push(bs[2]);
      bs[2] = bs[1];
      bs[1] = bs[0];
      bs[0] = batterId;
    } else if (bs[0] && bs[1]) {
      bs[2] = bs[1];
      bs[1] = bs[0];
      bs[0] = batterId;
    } else if (bs[0]) {
      bs[1] = bs[0];
      bs[0] = batterId;
    } else {
      bs[0] = batterId;
    }
    return { bases: bs, runs };
  }

  function advanceOnHit(bases, batter, hitType) {
    const runs = [];
    let bs = bases.slice();
    const batterId = batter.id;
    const speed = batter.ratings.speed || 50;
    const speedBonus = Math.random() < (speed - 50) / 200;

    if (hitType === 1) {
      // Single
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) {
        // Score from 2B usually
        if (Math.random() < 0.65) { runs.push(bs[1]); bs[1] = null; }
        else { bs[2] = bs[1]; bs[1] = null; }
      }
      if (bs[0]) {
        // 1st to 3rd ~30%
        if (Math.random() < 0.30) { bs[2] = bs[0]; }
        else { bs[1] = bs[0]; }
        bs[0] = null;
      }
      bs[0] = batterId;
    } else if (hitType === 2) {
      // Double
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) { runs.push(bs[1]); bs[1] = null; }
      if (bs[0]) {
        if (Math.random() < (speedBonus ? 0.60 : 0.45)) { runs.push(bs[0]); }
        else { bs[2] = bs[0]; }
        bs[0] = null;
      }
      bs[1] = batterId;
    } else if (hitType === 3) {
      // Triple - all score
      if (bs[2]) { runs.push(bs[2]); bs[2] = null; }
      if (bs[1]) { runs.push(bs[1]); bs[1] = null; }
      if (bs[0]) { runs.push(bs[0]); bs[0] = null; }
      bs[2] = batterId;
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

  function shouldAttemptSB(runner, pitcher, def) {
    // Tuned to produce ~140 SB attempts per team per 162-game season league-wide.
    const speed = runner.ratings.speed || 50;
    if (speed < 40) return Math.random() < 0.01;
    if (speed < 50) return Math.random() < 0.045;
    const baseProb = 0.115 + (speed - 50) * 0.018;
    return Math.random() < baseProb;
  }

  function resolveSB(runner, pitcher, def) {
    const speed = runner.ratings.speed;
    const successProb = 0.66 + (speed - 50) * 0.012;
    return Math.random() < successProb ? 'safe' : 'caught';
  }

  function maybeChangePitcher(off, def, inning, outs, runsThisInning, isBottom, state) {
    const pitcher = def.currentP;
    const pitchCount = def.pitchCount;
    const stamina = pitcher.ratings.stamina;
    const isStarter = pitcher.id === def.sp.id;

    // Hard cap by inning
    let pull = false;
    if (isStarter) {
      // Pull starters around 90-110 pitches depending on stamina, or allow up to 130 for studs
      const limit = stamina >= 70 ? 110 : stamina >= 50 ? 95 : 75;
      if (pitchCount >= limit) pull = true;
      // Or if late inning and team trailing/close: pull for closer
      if (inning >= 7 && isStarter && pitchCount >= 75) pull = true;
    } else {
      // Reliever - usually one inning unless high stamina
      const limit = stamina >= 60 ? 35 : 22;
      if (pitchCount >= limit) pull = true;
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
    const home = teamState.home;
    const away = teamState.away;
    const homeWon = home.runs > away.runs;
    const winSide = homeWon ? home : away;
    const lossSide = homeWon ? away : home;

    // Starter usually gets the W if pitched 5+ IP and team had lead they didn't relinquish (simplified: SP gets W or L based on outcome)
    const winSP = winSide.sp;
    const lossSP = lossSide.sp;
    const winSPStats = gameStats[winSP.id];
    const lossSPStats = gameStats[lossSP.id];

    // Did winning starter go 5 IP (15 outs)?
    if (winSPStats && (winSPStats.ipOuts || 0) >= 15) {
      winSPStats.gs = 1;
      winSPStats.g = 1;
      winSPStats.w = 1;
      winSide.wp = winSP.id;
    } else if (winSPStats) {
      winSPStats.gs = 1;
      winSPStats.g = 1;
      // Award W to last reliever (simplification)
      const winRelievers = winSide.pitchersUsed.slice(1);
      if (winRelievers.length > 0) {
        const last = winRelievers[winRelievers.length - 1];
        if (gameStats[last]) gameStats[last].w = 1;
        winSide.wp = last;
      } else {
        winSPStats.w = 1;
        winSide.wp = winSP.id;
      }
    }

    if (lossSPStats) {
      lossSPStats.gs = 1;
      lossSPStats.g = 1;
      lossSPStats.l = 1;
      lossSide.lp = lossSP.id;
    }

    // Mark relievers G=1
    for (const side of [home, away]) {
      for (let i = 1; i < side.pitchersUsed.length; i++) {
        const pid = side.pitchersUsed[i];
        if (gameStats[pid]) gameStats[pid].g = 1;
      }
    }

    // Save: winning side's last pitcher if not the SP and team won by 1-3 runs and pitched at least 1 inning
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
