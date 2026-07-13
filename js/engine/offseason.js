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

  // ---- Day-by-day bracket (0.13.1) ----------------------------------------
  // The postseason plays on the calendar like the regular season: the two
  // wild-card series in each league run in parallel starting three days
  // after the season ends, each round opens two rest days after its
  // feeders finish, and Advance Day plays exactly that day's games. The
  // one-shot runPostseason() below loops the same day code, so the
  // harness and "sim it all" paths exercise identical mechanics.

  function startPostseason(state) {
    const year = state.meta.currentDate.year;
    const firstDate = D().addDays(state.league.schedule.seasonEnd, 3);
    const mk = (tag, league, bestOf) => ({
      tag, league, bestOf,
      highId: null, lowId: null, hw: 0, lw: 0, n: 0,
      nextDate: null, lastDate: null, winnerId: null, loserId: null,
    });
    const seedsByLeague = {};
    const series = [];
    for (const lg of ['east', 'west']) {
      const seeds = seedLeague(state, lg);
      seedsByLeague[lg] = seeds.map((t) => t.id);
      // Wild card: 3v6, 4v5 (bo3, all at higher seed); 1 & 2 have byes.
      const wc1 = mk(`${lg}_wc1`, lg, 3);
      wc1.highId = seeds[2].id; wc1.lowId = seeds[5].id; wc1.nextDate = { ...firstDate };
      const wc2 = mk(`${lg}_wc2`, lg, 3);
      wc2.highId = seeds[3].id; wc2.lowId = seeds[4].id; wc2.nextDate = { ...firstDate };
      // Division series: 1 vs (4/5 winner), 2 vs (3/6 winner).
      const ds1 = mk(`${lg}_ds1`, lg, 5); ds1.highId = seeds[0].id;
      const ds2 = mk(`${lg}_ds2`, lg, 5); ds2.highId = seeds[1].id;
      series.push(wc1, wc2, ds1, ds2, mk(`${lg}_lcs`, lg, 7));
    }
    series.push(mk('ws', null, 7));
    state.postseason = { year, phase: 'active', seeds: seedsByLeague, series, games: [] };
    return state.postseason;
  }

  function findSeries(ps, tag) { return ps.series.find((s) => s.tag === tag); }

  function winPctOfId(state, id) {
    return ST().winPct(state.league.teams.find((t) => t.id === id));
  }

  // Play every playoff game scheduled for `today`. Returns the games and
  // any series that finished; flips phase to 'complete' when the World
  // Series is decided.
  function simPostseasonDay(state, today) {
    const ps = state.postseason;
    if (!ps || ps.phase !== 'active') return { played: [], completed: [], done: false };
    const played = [], completed = [];
    S().setStatBucket('postseason');
    try {
      for (const s of ps.series) {
        if (s.winnerId || !s.highId || !s.lowId || !s.nextDate || !D().eq(s.nextDate, today)) continue;
        const highHosts = HOST[s.bestOf][s.n];
        const g = {
          gameId: `ps${ps.year}_${s.tag}_${s.n}`,
          date: { ...today },
          homeId: highHosts ? s.highId : s.lowId,
          awayId: highHosts ? s.lowId : s.highId,
          played: false, result: null, postseason: s.tag,
        };
        window.BBGM_SIM.simulateGame(state, g);
        // October injuries don't carry (simplification — result.injuries
        // are not applied); strip the AB log to keep the save lean.
        if (g.result) { g.result.gameLog = null; g.result.injuries = null; }
        ps.games.push(g);
        played.push(g);
        const homeWon = g.result.homeRuns > g.result.awayRuns;
        const highWon = (homeWon && highHosts) || (!homeWon && !highHosts);
        if (highWon) s.hw++; else s.lw++;
        s.n++;
        s.lastDate = { ...today };
        const need = Math.floor(s.bestOf / 2) + 1;
        if (s.hw === need || s.lw === need) {
          s.winnerId = s.hw === need ? s.highId : s.lowId;
          s.loserId = s.hw === need ? s.lowId : s.highId;
          s.nextDate = null;
          completed.push(s);
          advanceBracket(state, s);
        } else {
          s.nextDate = D().addDays(today, 1);
        }
      }
    } finally {
      S().setStatBucket(null);
    }
    if (findSeries(ps, 'ws').winnerId) ps.phase = 'complete';
    return { played, completed, done: ps.phase === 'complete' };
  }

  // Feed winners forward and open the next round two rest days after its
  // last feeder finishes.
  function advanceBracket(state, s) {
    const ps = state.postseason;
    const lg = s.league;
    const later = (a, b) => (D().compare(a, b) >= 0 ? a : b);
    if (s.tag.endsWith('wc1') || s.tag.endsWith('wc2')) {
      // ds2 takes the wc1 winner; ds1 takes the wc2 winner (3.4).
      findSeries(ps, `${lg}_${s.tag.endsWith('wc1') ? 'ds2' : 'ds1'}`).lowId = s.winnerId;
      const wc1 = findSeries(ps, `${lg}_wc1`), wc2 = findSeries(ps, `${lg}_wc2`);
      if (wc1.winnerId && wc2.winnerId) {
        const start = D().addDays(later(wc1.lastDate, wc2.lastDate), 3);
        findSeries(ps, `${lg}_ds1`).nextDate = { ...start };
        findSeries(ps, `${lg}_ds2`).nextDate = { ...start };
      }
    } else if (s.tag.endsWith('ds1') || s.tag.endsWith('ds2')) {
      const ds1 = findSeries(ps, `${lg}_ds1`), ds2 = findSeries(ps, `${lg}_ds2`);
      if (ds1.winnerId && ds2.winnerId) {
        // LCS: better regular-season record is the "high" seed.
        const lcs = findSeries(ps, `${lg}_lcs`);
        const [h, l] = winPctOfId(state, ds1.winnerId) >= winPctOfId(state, ds2.winnerId)
          ? [ds1.winnerId, ds2.winnerId] : [ds2.winnerId, ds1.winnerId];
        lcs.highId = h; lcs.lowId = l;
        lcs.nextDate = { ...D().addDays(later(ds1.lastDate, ds2.lastDate), 3) };
      }
    } else if (s.tag.endsWith('lcs')) {
      const e = findSeries(ps, 'east_lcs'), w = findSeries(ps, 'west_lcs');
      if (e.winnerId && w.winnerId) {
        // World Series: home field by regular-season record (3.4).
        const ws = findSeries(ps, 'ws');
        const [h, l] = winPctOfId(state, e.winnerId) >= winPctOfId(state, w.winnerId)
          ? [e.winnerId, w.winnerId] : [w.winnerId, e.winnerId];
        ws.highId = h; ws.lowId = l;
        ws.nextDate = { ...D().addDays(later(e.lastDate, w.lastDate), 3) };
      }
    }
  }

  // Condense the finished bracket into the archival shape (rounds/summary
  // objects the Playoffs tab, history, and Part A consume) and clear the
  // live object.
  function finalizePostseason(state) {
    const ps = state.postseason;
    const sum = (s) => ({
      winnerId: s.winnerId, loserId: s.loserId,
      // Score from the WINNER's perspective (the winner has more wins).
      score: s.hw >= s.lw ? [s.hw, s.lw] : [s.lw, s.hw],
    });
    const rounds = ['east', 'west'].map((lg) => ({
      league: lg,
      seeds: ps.seeds[lg],
      wildCard: [sum(findSeries(ps, `${lg}_wc1`)), sum(findSeries(ps, `${lg}_wc2`))],
      divisionSeries: [sum(findSeries(ps, `${lg}_ds1`)), sum(findSeries(ps, `${lg}_ds2`))],
      lcs: sum(findSeries(ps, `${lg}_lcs`)),
    }));
    const ws = findSeries(ps, 'ws');
    const result = {
      year: ps.year, games: ps.games, rounds,
      worldSeries: sum(ws),
      champion: state.league.teams.find((t) => t.id === ws.winnerId),
      runnerUp: state.league.teams.find((t) => t.id === ws.loserId),
    };
    delete state.postseason;
    return result;
  }

  // One-shot postseason (harness, "sim rest of October"): loops the same
  // day-by-day code, advancing the calendar until the champion is crowned.
  function runPostseason(state) {
    if (!state.postseason) startPostseason(state);
    let guard = 0;
    while (state.postseason.phase === 'active' && guard++ < 80) {
      simPostseasonDay(state, state.meta.currentDate);
      if (state.postseason.phase === 'active') {
        state.meta.currentDate = D().addDays(state.meta.currentDate, 1);
      }
    }
    return finalizePostseason(state);
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
    const summary = { year, retirements: [], milestones: [], newFAs: 0, nonTenders: [] };
    const arbCases = [];

    // 1. Postseason: consume the bracket the user played through day by
    //    day, or sim it in one shot if they skipped straight here.
    const ps = (state.postseason && state.postseason.phase === 'complete')
      ? finalizePostseason(state)
      : runPostseason(state);
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

    // 1.5. Awards week (18.3/19.2): voted on final regular-season stats,
    // announced before retirements so a retiring MVP still collects his
    // hardware. All-Star selections were stamped in July.
    summary.awards = window.BBGM_AWARDS.runAwardsVoting(state, records, year);

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

    // 4.4. Hall of Fame vote (19.6): January's ballot, compressed into the
    // rollover like the rest of the offseason calendar. Runs after
    // retirements so this winter's retirees start their 5-year clocks.
    summary.hof = window.BBGM_AWARDS.runHofVoting(state, year);

    // 4.45. Archive compaction (0.19.1): the retired population is the one
    // part of the save that only ever grows. Two-stage diet, run after the
    // HoF vote so it never touches a live candidacy:
    //   - Every retiree sheds his hidden development block (curve state +
    //     ceilings). Progression and scouting never read a retired player,
    //     so it's pure dead weight — and it's the largest per-player blob.
    //   - Fringe retirees whose Hall case is mathematically over — past
    //     the writers' ballot window (eligible at 5 years retired, 10
    //     appearances) and nowhere near the veterans-committee bar
    //     (score > 6.0 to induct) — are deleted outright. Every UI that
    //     links by player id already tolerates a missing player (the
    //     farm-cap cut has deleted washouts since 0.16.x).
    {
      const hofScore = window.BBGM_AWARDS.hofScore;
      for (const id in players) {
        const p = players[id];
        if (!p.retired) continue;
        if (p.hidden) delete p.hidden;
        if (p.hof) continue;
        const retiredFor = year - (p.retired.year || year);
        if (retiredFor >= 16 && hofScore(p) < 5.0) delete players[id];
      }
      // Draft / intl class archives: a decade of history is plenty for the
      // hub's history tabs; each season adds ~400 rows between the two.
      if ((state.draftHistory || []).length > 10) state.draftHistory = state.draftHistory.slice(-10);
      if ((state.intlHistory || []).length > 10) state.intlHistory = state.intlHistory.slice(-10);
    }

    // 4.5. Staff offseason (17.6/17.9): manager records and reputation,
    // owner-driven firings, coach churn, the retired-player coaching
    // pipeline, AI hiring. Runs before progression so this year's coach
    // modifiers reflect the staff that actually coached the season.
    const STAFF = window.BBGM_STAFF;
    STAFF.ensureStaff(state);
    const staffEvents = STAFF.runStaffOffseason(state, records, summary.retirements, year);
    summary.staffEvents = staffEvents;

    // 4.6. Scouting budgets (6.9): make sure every team has a tier, then
    // let owners react to the season (cheap owners cut after losing years).
    const SCOUT = window.BBGM_SCOUT;
    SCOUT.ensureTiers(state);
    summary.scoutingEvents = SCOUT.runScoutingOffseason(state, records);

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

    // 5.2. Position development (0.20.0 — utility men). A minor leaguer on
    // a position-work assignment (Team → Minors) banks a season of side
    // work at the new spot; then every player's learned positions graduate
    // into his visible secondary list (aptitude 60+ → the org lists him
    // there). MLB reps accrued in games during the season already live in
    // posReps — this is where they become permanent.
    for (const id in players) {
      const p = players[id];
      if (p.retired) continue;
      if (p.devPosition && !p.isPitcher && p.status === 'minors') {
        if (!p.posReps) p.posReps = {};
        p.posReps[p.devPosition] = (p.posReps[p.devPosition] || 0) + 24;
      }
      GEN().syncPositions(p);
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
        // Salary ledger (profile Contract tab): the MLB salary he played
        // this season under, recorded before the contract ticks.
        if (p.contract) {
          if (!p.salaryHistory) p.salaryHistory = [];
          p.salaryHistory.push({ year, salary: p.contract.annualSalary, type: p.contract.signedAt });
          if (p.salaryHistory.length > 25) p.salaryHistory = p.salaryHistory.slice(-25);
        }
      }
      if (p.contract && p.teamId) {
        p.contract.years = Math.max(0, (p.contract.years || 1) - 1);
        if (p.contract.years === 0) {
          const sv = p.serviceTime.years || 0;
          if (sv >= 6) {
            FA().releaseToPool(state, p, 'contract-expired');
            summary.newFAs++;
          } else {
            // Team control: renew. Arb years step toward market value AND
            // ratchet off the prior salary (real arbitration almost never
            // cuts pay) — a declining player's number keeps climbing past
            // his worth, which is what makes non-tenders a real decision.
            const ovr = ROSTER().overall(p);
            const isArb = sv >= 3;
            const priorSalary = p.contract.annualSalary || 0.74;
            let salary = 0.74;
            if (isArb) {
              const share = sv === 3 ? 0.4 : sv === 4 ? 0.6 : 0.8;
              salary = Math.max(0.74, TRADES().expectedAAV(ovr, p.age) * share,
                priorSalary * 1.12);
            }
            salary = Math.round(salary * 10) / 10;

            // Non-tender decisions (18.7). AI clubs shed arb players whose
            // raise outruns their value — cheap owners most aggressively,
            // win-now owners almost never. Runs before buildMarket, so
            // non-tenders enrich the FA market like real Decembers.
            if (isArb && p.teamId !== state.meta.userTeamId) {
              const team = teams.find((t) => t.id === p.teamId);
              const worth = TRADES().expectedAAV(ovr, p.age);
              const thresh = ({
                cheap: 0.95, patient: 1.10, analytics: 1.05,
                old_school: 1.20, aggressive: 1.15, win_now: 1.35,
              })[team && team.owner] || 1.15;
              if (salary > Math.max(0.9, worth) * thresh && ovr < 56) {
                FA().releaseToPool(state, p, 'non-tendered');
                summary.newFAs++;
                summary.nonTenders.push({ playerId: p.id, name: p.name,
                  teamId: team ? team.id : null, salary, ovr: Math.round(ovr) });
                continue;
              }
            }

            p.contract = {
              years: 1, annualSalary: salary, totalValue: salary,
              signedAt: isArb ? 'arbitration' : 'renewal',
            };

            // The user's arb class (18.7): tendered by default so headless
            // runs and skipped offseasons behave exactly as before, but
            // each case stays open for a non-tender until Opening Day.
            if (isArb && p.teamId === state.meta.userTeamId &&
                (p.rosterStatus === '26-man' || p.rosterStatus === 'IL')) {
              arbCases.push({ playerId: p.id, salary, decision: 'tendered' });
            }
          }
        }
      }
    }
    state.arb = { year, cases: arbCases };
    summary.arbCases = arbCases.length;

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
    // from the last day recovery actually ticked to Opening Day (10.5).
    // A postseason played day by day keeps ticking recovery through
    // October (main.js stamps lastRecoveryTick), so healing from the
    // regular-season end would count those days twice.
    const lastTick = state.meta.lastRecoveryTick || oldSeasonEnd;
    const healFrom = D().compare(lastTick, oldSeasonEnd) > 0 ? lastTick : oldSeasonEnd;
    const skippedDays = Math.max(0, D().diffDays(healFrom, schedule.openingDay));
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
      p.consecStarts = 0;
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
        } else {
          still.push(pid);
        }
      }
      t.il = still;
    }

    // Minors level reassignment + 30-cap (12.4 / 12.8). Spring training
    // confirms assignments (11.8) — the user's org moves are counted for
    // the camp report.
    let userLevelMoves = 0;
    for (const t of teams) {
      for (const pid of t.minors || []) {
        const p = players[pid];
        if (!p) continue;
        const before = p.rosterStatus;
        MIN().reassignLevel(p);
        if (t.id === state.meta.userTeamId && p.rosterStatus !== before) userLevelMoves++;
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
      // Cover bookkeeping ends with the winter: topUpTeam already used the
      // ilCallUpFor flags to send stint covers back down first, so any flag
      // still on a 26-man player is stale — clearing it stops him from
      // being treated as first-out in every future roster squeeze. (The
      // old code deleted the flag from the RETURNING player instead of his
      // cover, so covers kept theirs forever.)
      for (const pid of t.roster) {
        const p = players[pid];
        if (p && p.ilCallUpFor) delete p.ilCallUpFor;
      }
    }

    // Any manager vacancy the user left unfilled is auto-hired at Opening
    // Day (the owner won't start a season without a skipper).
    window.BBGM_STAFF.ensureStaff(state);

    // ---- Spring training (11.8 / 18.11) ----------------------------------
    // Position battles are read off the manager's rebuilt configs: where
    // the pick over the runner-up was a coin flip, that's a battle that
    // just resolved in camp. Camp injuries are low-probability day-to-day
    // knocks — a few linger past Opening Day (the delayed-start archetype)
    // and the engine simply subs around them.
    const ST = { battles: [], injuries: [], userLevelMoves };
    const userTeam = teams.find((t) => t.id === state.meta.userTeamId);
    if (userTeam) {
      const ovr = (p) => ROSTER().overall(p);
      const inLineup = new Set((userTeam.lineupRH || []).map((s) => s.playerId));
      for (const spot of userTeam.lineupRH || []) {
        const starter = players[spot.playerId];
        if (!starter || spot.position === 'DH') continue;
        const best = userTeam.roster
          .map((id) => players[id])
          .filter((q) => q && !q.isPitcher && !inLineup.has(q.id) && GEN().canPlay(q, spot.position))
          .sort((a, b) => ovr(b) - ovr(a))[0];
        if (best && ovr(starter) - ovr(best) <= 2.5) {
          ST.battles.push({ pos: spot.position, winnerId: starter.id, winner: starter.name,
            runnerUpId: best.id, runnerUp: best.name });
        }
      }
      // The 5th-starter battle: last rotation arm vs the best arm left out.
      const rot = (userTeam.rotation || []).map((id) => players[id]).filter(Boolean);
      const last = rot[rot.length - 1];
      const challenger = userTeam.roster
        .map((id) => players[id])
        .filter((q) => q && q.isPitcher && q.primaryPosition === 'SP' && !userTeam.rotation.includes(q.id))
        .sort((a, b) => ovr(b) - ovr(a))[0];
      if (last && challenger && ovr(last) - ovr(challenger) <= 2.5) {
        ST.battles.push({ pos: 'SP5', winnerId: last.id, winner: last.name,
          runnerUpId: challenger.id, runnerUp: challenger.name });
      }
      ST.battles = ST.battles.slice(0, 4);
    }
    const CAMP_KNOCKS = ['hamstring tightness', 'back stiffness', 'forearm soreness',
      'oblique tightness', 'ankle sprain'];
    for (const t of teams) {
      if (rand() >= 0.30) continue;
      const pool = t.roster.map((id) => players[id]).filter((p) => p && INJ.isAvailable(p));
      const p = pool[rint(0, pool.length - 1)];
      if (!p) continue;
      const days = rint(2, 12);
      INJ.placeOnIL(p, { type: CAMP_KNOCKS[rint(0, CAMP_KNOCKS.length - 1)], daysOut: days },
        schedule.openingDay);
      ST.injuries.push({ playerId: p.id, name: p.name, teamId: t.id,
        type: p.currentInjury.type, days });
    }
    summary.springTraining = ST;

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
      down.rosterStatus = ROSTER().demotionLevel(down);
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

  // 18.7: the user backs out of a tendered arbitration contract during
  // the offseason. The player hits the open market immediately, with a
  // live entry so he can sign this winter.
  function nonTenderPlayer(state, playerId) {
    const arb = state.arb;
    const c = arb && (arb.cases || []).find((x) => x.playerId === playerId);
    if (!c || c.decision !== 'tendered') return null;
    if (state.meta.offseasonPhase !== 'freeAgency') return null;
    const p = state.players[playerId];
    if (!p || p.teamId !== state.meta.userTeamId) return null;
    c.decision = 'non-tendered';
    FA().releaseToPool(state, p, 'non-tendered');
    const entry = FA().addMarketEntry(state, p);
    return { player: p, entry };
  }

  return {
    runSeasonRollover, runSeasonRolloverPartA, runSeasonRolloverPartB,
    advanceFARound, runPostseason, seedLeague, nonTenderPlayer,
    startPostseason, simPostseasonDay, finalizePostseason,
  };
})();
