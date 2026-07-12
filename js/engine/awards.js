// Awards, All-Star Game, and Hall of Fame (bible 19, 17.8, 18.3).
//
// Annual award voting runs at the rollover, after the season archive and
// before retirements (18.1's November order). The All-Star Game fires
// mid-July on the schedule's built-in break. Hall of Fame voting runs at
// the rollover after retirements (January's vote, compressed into the
// offseason step like the rest of the November-March calendar).
window.BBGM_AWARDS = (function () {
  const S = () => window.BBGM_STATS;

  function rand() { return Math.random(); }
  function rnorm(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function rint(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function ensureAch(p) {
    if (!p.achievements) p.achievements = { awards: [], allStarSelections: [], championships: [], milestones: [] };
    if (!p.achievements.awards) p.achievements.awards = [];
    if (!p.achievements.allStarSelections) p.achievements.allStarSelections = [];
    return p.achievements;
  }

  // ---- Season value scores (19.2's stat weights) ---------------------------
  // Counting stats heavy, rate stats significant. Units are arbitrary —
  // only relative ordering matters to a ballot.

  function hitterValue(s) {
    if (!s || !s.pa) return 0;
    const ops = S().ops(s);
    return (ops - 0.600) * s.pa * 0.11 + s.hr * 0.55 + s.sb * 0.22 +
      s.r * 0.20 + s.rbi * 0.20;
  }

  function starterValue(s) {
    if (!s || !s.ipOuts) return 0;
    const ip = s.ipOuts / 3;
    const era = S().era(s);
    return ip * 0.22 + s.k * 0.045 + s.w * 1.6 - s.l * 0.5 +
      (4.35 - era) * ip * 0.09 + (s.sho || 0) * 1.5 + (s.cg || 0) * 0.5;
  }

  function relieverValue(s) {
    if (!s || !s.ipOuts) return 0;
    const era = S().era(s);
    return (s.sv || 0) * 1.5 + (s.hld || 0) * 0.5 + s.k * 0.02 +
      (3.60 - era) * (s.ipOuts / 3) * 0.10 - (s.bs || 0) * 0.6;
  }

  function pitcherValue(s) {
    return Math.max(starterValue(s), relieverValue(s) * 0.9);
  }

  // ---- Ballot simulation (19.2) --------------------------------------------
  // N voters each rank the top candidates; every ballot jitters the true
  // scores so the best player usually — not always — wins.
  function runBallot(cands, opts = {}) {
    const voters = opts.voters || 30;
    const points = opts.points || [14, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const noise = opts.noise != null ? opts.noise : 0.10;
    const pool = cands
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, points.length + 5);
    if (!pool.length) return [];
    const tally = {}, firsts = {};
    for (let v = 0; v < voters; v++) {
      const ranked = pool
        .map((c) => ({ c, s: c.score * (1 + rnorm(0, noise)) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, points.length);
      ranked.forEach((r, i) => {
        tally[r.c.id] = (tally[r.c.id] || 0) + points[i];
        if (i === 0) firsts[r.c.id] = (firsts[r.c.id] || 0) + 1;
      });
    }
    return pool
      .filter((c) => tally[c.id])
      .map((c) => ({ ...c, pts: tally[c.id], firsts: firsts[c.id] || 0 }))
      .sort((a, b) => b.pts - a.pts || b.firsts - a.firsts);
  }

  // Rookie eligibility (19.2): first year of MLB service — zero service
  // years at vote time, or one year that was only a cup of coffee.
  function isRookie(p, year) {
    const svc = (p.serviceTime && p.serviceTime.years) || 0;
    if (svc === 0) return true;
    if (svc > 1) return false;
    let priorAb = 0, priorOuts = 0;
    for (const y in p.stats) {
      if (Number(y) >= year) continue;
      const s = p.stats[y];
      priorAb += s.ab || 0;
      priorOuts += s.ipOuts || 0;
    }
    return p.isPitcher ? priorOuts < 150 : priorAb < 130;
  }

  // ---- Annual award voting (19.1/19.2) --------------------------------------
  // Returns and persists state.history.awards[year] = { east: {...}, west: {...} }.
  function runAwardsVoting(state, records, year) {
    const players = state.players;
    const teams = state.league.teams;
    const byLeague = { east: [], west: [] };
    const wpct = {};
    for (const t of teams) {
      const r = records[t.id] || { w: 81, l: 81 };
      wpct[t.id] = r.w / Math.max(1, r.w + r.l);
      for (const pid of t.roster.concat(t.il || [])) {
        const p = players[pid];
        if (p && p.stats[year]) byLeague[t.league].push({ p, t });
      }
    }

    // Qualification floors scale with the games actually played (a save
    // archived off a partial season still deserves a full award slate).
    let seasonGames = 0;
    for (const t of teams) {
      const r = records[t.id];
      if (r) seasonGames = Math.max(seasonGames, r.w + r.l);
    }
    if (!seasonGames) seasonGames = 162;

    const result = { year };
    for (const lg of ['east', 'west']) {
      const pool = byLeague[lg];
      const teamBonus = (t, w) => 1 + (wpct[t.id] - 0.5) * w;
      const cand = (entry, score) => ({
        id: entry.p.id, name: entry.p.name, teamId: entry.t.id,
        pos: entry.p.primaryPosition, score: Math.max(0, score),
      });

      // MVP: everyone eligible; pitchers scaled so only monster seasons
      // out-poll the best bats (real MVP voting's pitcher discount).
      const mvpBallot = runBallot(pool.map((e) => cand(e,
        (e.p.isPitcher ? pitcherValue(e.p.stats[year]) * 0.72 : hitterValue(e.p.stats[year])) *
        teamBonus(e.t, 0.30))));

      // Cy Young: pitchers only, milder team-success halo.
      const cyBallot = runBallot(pool.filter((e) => e.p.isPitcher).map((e) =>
        cand(e, pitcherValue(e.p.stats[year]) * teamBonus(e.t, 0.18))));

      // Rookie of the Year: rookies with real playing time.
      const royBallot = runBallot(pool.filter((e) => {
        const s = e.p.stats[year];
        if (!isRookie(e.p, year)) return false;
        return e.p.isPitcher
          ? (s.ipOuts || 0) >= seasonGames * 0.74
          : (s.pa || 0) >= seasonGames * 0.93;
      }).map((e) => cand(e,
        (e.p.isPitcher ? pitcherValue(e.p.stats[year]) * 0.85 : hitterValue(e.p.stats[year])) *
        teamBonus(e.t, 0.15))));

      // Reliever of the Year: pen arms, saves and holds heavy.
      const relBallot = runBallot(pool.filter((e) => {
        const s = e.p.stats[year];
        return e.p.isPitcher && (s.gs || 0) <= 5 && (s.g || 0) >= seasonGames * 0.15;
      }).map((e) => cand(e, relieverValue(e.p.stats[year]) * teamBonus(e.t, 0.12))),
        { voters: 12, points: [5, 3, 1], noise: 0.12 });

      // Comeback Player (19.2): established production, a lost year, and a
      // return to form — not a sophomore breakout. Requires a peak season
      // two-plus years back that last year fell well short of and this
      // year re-approached.
      const cbBallot = runBallot(pool.map((e) => {
        const now = e.p.stats[year], prev = e.p.stats[year - 1];
        if (!now || !prev) return null;
        const val = (s) => (e.p.isPitcher ? pitcherValue(s) : hitterValue(s));
        const vNow = val(now), vPrev = val(prev);
        let vPeak = 0;
        for (const y in e.p.stats) {
          if (Number(y) >= year - 1) continue;
          vPeak = Math.max(vPeak, val(e.p.stats[y]));
        }
        if (vPeak < 22) return null;                 // never established
        if (vPrev > vPeak * 0.6) return null;        // nothing to come back from
        if (vNow < vPeak * 0.75 || vNow - vPrev < 14) return null; // didn't return
        return cand(e, vNow - vPrev);
      }).filter(Boolean), { voters: 12, points: [5, 3, 1], noise: 0.15 });

      // Manager of the Year (17.8): overperforming expectations (last
      // year's record, regressed) and payroll context drive votes.
      const STAFF = window.BBGM_STAFF;
      const prevSeason = (state.history.seasons || [])[state.history.seasons.length - 2];
      const lgTeams = teams.filter((t) => t.league === lg);
      const payrolls = lgTeams.map((t) => ({
        t,
        pay: t.roster.reduce((sum, id) => sum + ((players[id] && players[id].contract &&
          players[id].contract.annualSalary) || 0), 0),
      })).sort((a, b) => b.pay - a.pay);
      const payRank = {};
      payrolls.forEach((e, i) => { payRank[e.t.id] = i + 1; }); // 1 = biggest spender
      const moyBallot = runBallot(lgTeams.map((t) => {
        const mgr = STAFF && state.staff && t.managerId && state.staff.managers[t.managerId];
        if (!mgr) return null;
        const w = (records[t.id] || { w: 81 }).w;
        const prevW = prevSeason && prevSeason.records[t.id] ? prevSeason.records[t.id].w : 81;
        const expected = 81 + (prevW - 81) * 0.5;
        const score = (w - expected) * 1.1 + (payRank[t.id] - 8) * 0.9 +
          (mgr.reputation || 5) * 0.5 + Math.max(0, w - 88) * 0.5;
        return { id: mgr.id, name: mgr.name, teamId: t.id, pos: 'MGR', score: Math.max(0.1, score) };
      }).filter(Boolean), { voters: 30, points: [5, 3, 1], noise: 0.18 });

      // Gold Gloves (19.2): ratings-driven, one per position. The pitcher
      // Gold Glove goes to a heavy-workload arm with plus command (the
      // engine has no pitcher fielding stat — control is the proxy).
      const gg = {};
      for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
        const best = pool.filter((e) => !e.p.isPitcher && e.p.primaryPosition === pos &&
          (e.p.stats[year].g || 0) >= seasonGames * (pos === 'C' ? 0.49 : 0.59))
          .map((e) => ({
            e,
            s: ((e.p.ratings.defense || 50) - 50) * 1.0 + ((e.p.ratings.arm || 50) - 50) * 0.45 +
              (e.p.stats[year].g || 0) * 0.02 + rnorm(0, 2.2),
          }))
          .sort((a, b) => b.s - a.s)[0];
        if (best) gg[pos] = { id: best.e.p.id, name: best.e.p.name, teamId: best.e.t.id };
      }
      const bestPGlove = pool.filter((e) => e.p.isPitcher && (e.p.stats[year].ipOuts || 0) >= seasonGames * 2)
        .map((e) => ({
          e,
          s: ((e.p.ratings.control || 50) - 50) * 0.6 + (e.p.stats[year].ipOuts || 0) * 0.01 + rnorm(0, 2.2),
        }))
        .sort((a, b) => b.s - a.s)[0];
      if (bestPGlove) gg.P = { id: bestPGlove.e.p.id, name: bestPGlove.e.p.name, teamId: bestPGlove.e.t.id };

      // Silver Sluggers (19.2): best offensive season per position. The DH
      // league gets a DH slugger; the pitchers-bat league gets a pitcher
      // slugger from the batting lines instead.
      const ss = {};
      for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
        const best = pool.filter((e) => !e.p.isPitcher && e.p.primaryPosition === pos &&
          (e.p.stats[year].pa || 0) >= seasonGames * 1.85)
          .map((e) => ({ e, s: hitterValue(e.p.stats[year]) + rnorm(0, 1.5) }))
          .sort((a, b) => b.s - a.s)[0];
        if (best) ss[pos] = { id: best.e.p.id, name: best.e.p.name, teamId: best.e.t.id };
      }
      if (lg === 'east') {
        const best = pool.filter((e) => !e.p.isPitcher && e.p.primaryPosition === 'DH' &&
          (e.p.stats[year].pa || 0) >= seasonGames * 1.85)
          .map((e) => ({ e, s: hitterValue(e.p.stats[year]) + rnorm(0, 1.5) }))
          .sort((a, b) => b.s - a.s)[0];
        // A DH-less DH league year (all DHs platooned): best remaining bat.
        const fallback = !best && pool.filter((e) => !e.p.isPitcher && (e.p.stats[year].pa || 0) >= seasonGames * 1.85)
          .map((e) => ({ e, s: hitterValue(e.p.stats[year]) }))
          .sort((a, b) => b.s - a.s)[0];
        const pick = best || fallback;
        if (pick) ss.DH = { id: pick.e.p.id, name: pick.e.p.name, teamId: pick.e.t.id };
      } else {
        const best = pool.filter((e) => e.p.isPitcher && e.p.stats[year].batting &&
          (e.p.stats[year].batting.ab || 0) >= seasonGames * 0.18)
          .map((e) => ({ e, s: S().ops(e.p.stats[year].batting) + rnorm(0, 0.04) }))
          .sort((a, b) => b.s - a.s)[0];
        if (best) ss.P = { id: best.e.p.id, name: best.e.p.name, teamId: best.e.t.id };
      }

      const top5 = (ballot) => ballot.slice(0, 5).map((c) => ({
        id: c.id, name: c.name, teamId: c.teamId, pos: c.pos, pts: c.pts, firsts: c.firsts,
      }));
      result[lg] = {
        mvp: mvpBallot.length ? { winner: top5(mvpBallot)[0], voting: top5(mvpBallot) } : null,
        cy: cyBallot.length ? { winner: top5(cyBallot)[0], voting: top5(cyBallot) } : null,
        roy: royBallot.length ? { winner: top5(royBallot)[0], voting: top5(royBallot) } : null,
        reliever: relBallot.length ? { winner: top5(relBallot)[0], voting: top5(relBallot) } : null,
        comeback: cbBallot.length ? { winner: top5(cbBallot)[0], voting: top5(cbBallot) } : null,
        moy: moyBallot.length ? { winner: top5(moyBallot)[0], voting: top5(moyBallot) } : null,
        gg, ss,
      };

      // Stamp player profiles (19.3).
      const stamp = (id, name) => {
        const p = players[id];
        if (!p) return;
        ensureAch(p).awards.push({ year, name });
      };
      if (result[lg].mvp) stamp(result[lg].mvp.winner.id, 'MVP');
      if (result[lg].cy) stamp(result[lg].cy.winner.id, 'Cy Young');
      if (result[lg].roy) stamp(result[lg].roy.winner.id, 'Rookie of the Year');
      if (result[lg].reliever) stamp(result[lg].reliever.winner.id, 'Reliever of the Year');
      if (result[lg].comeback) stamp(result[lg].comeback.winner.id, 'Comeback Player of the Year');
      for (const pos in gg) stamp(gg[pos].id, `Gold Glove (${pos})`);
      for (const pos in ss) stamp(ss[pos].id, `Silver Slugger (${pos})`);
      if (result[lg].moy && state.staff) {
        const mgr = state.staff.managers[result[lg].moy.winner.id];
        if (mgr) {
          if (!mgr.awards) mgr.awards = [];
          mgr.awards.push({ year, name: 'Manager of the Year' });
          // 17.8: winning boosts reputation significantly.
          mgr.reputation = clamp((mgr.reputation || 5) + 1, 1, 10);
        }
      }
    }

    if (!state.history.awards) state.history.awards = {};
    state.history.awards[year] = result;
    return result;
  }

  // ---- All-Star Game (19.4) --------------------------------------------------
  // Fires once per season on the schedule's All-Star date (the 4-day
  // mid-July break). Selection + a lightweight exhibition result — the
  // game touches no season stats, standings, fatigue, or injuries.

  function allStarPending(state, today) {
    const sched = state.league.schedule;
    if (!sched || !sched.allStarDate) return false;
    const D = window.BBGM_DATES;
    if (!D.eq(today, sched.allStarDate)) return false;
    const year = state.meta.currentDate.year;
    return !(state.history.allStar && state.history.allStar[year]);
  }

  function runAllStar(state) {
    const D = window.BBGM_DATES;
    const players = state.players;
    const teams = state.league.teams;
    const year = state.meta.currentDate.year;

    // Fan-vote score (19.4): season production + name recognition
    // (overall) + team success, with fan noise.
    const rosters = {};
    for (const lg of ['east', 'west']) {
      const lgTeams = teams.filter((t) => t.league === lg);
      const entries = [];
      for (const t of lgTeams) {
        const w = t.seasonRecord ? t.seasonRecord.w : 40;
        const l = t.seasonRecord ? t.seasonRecord.l : 40;
        const pct = w / Math.max(1, w + l);
        for (const pid of t.roster) {
          const p = players[pid];
          const s = p && p.stats[year];
          if (!p || !s) continue;
          const prod = p.isPitcher ? pitcherValue(s) * 1.15 : hitterValue(s) * 2;
          const fame = window.BBGM_ROSTER.overall(p) - 48;
          entries.push({ p, t, fan: prod + fame * 0.8 + (pct - 0.5) * 18 + rnorm(0, 3) });
        }
      }
      // 9 starters by fan vote: one per lineup position (DH league gets a
      // DH; the other league's ninth starter is the best remaining bat).
      const starters = [];
      const takken = new Set();
      const positions = lg === 'east'
        ? ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']
        : ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
      for (const pos of positions) {
        const best = entries.filter((e) => !e.p.isPitcher && !takken.has(e.p.id) &&
          (e.p.primaryPosition === pos || (pos === 'DH' && (e.p.stats[year].pa || 0) >= 200)))
          .sort((a, b) => b.fan - a.fan)[0];
        if (best) { starters.push({ ...pick(best), pos }); takken.add(best.p.id); }
      }
      if (lg === 'west') {
        const best = entries.filter((e) => !e.p.isPitcher && !takken.has(e.p.id))
          .sort((a, b) => b.fan - a.fan)[0];
        if (best) { starters.push({ ...pick(best), pos: 'UTIL' }); takken.add(best.p.id); }
      }
      // Pitchers and bench by the manager/commissioner pick (19.4): 8
      // starters, 4 relievers, best remaining bats to 32.
      const sps = entries.filter((e) => e.p.isPitcher && !takken.has(e.p.id) &&
        (e.p.stats[year].gs || 0) >= 8)
        .sort((a, b) => b.fan - a.fan).slice(0, 8);
      for (const e of sps) takken.add(e.p.id);
      const rps = entries.filter((e) => e.p.isPitcher && !takken.has(e.p.id) &&
        (e.p.stats[year].gs || 0) <= 3)
        .sort((a, b) => relieverValue(a.p.stats[year]) < relieverValue(b.p.stats[year]) ? 1 : -1)
        .slice(0, 4);
      for (const e of rps) takken.add(e.p.id);
      const bench = [];
      const remaining = entries.filter((e) => !e.p.isPitcher && !takken.has(e.p.id))
        .sort((a, b) => b.fan - a.fan);
      while (starters.length + sps.length + rps.length + bench.length < 32 && remaining.length) {
        const e = remaining.shift();
        bench.push(pick(e));
        takken.add(e.p.id);
      }
      rosters[lg] = {
        starters,
        pitchers: sps.map(pick).concat(rps.map(pick)),
        bench,
      };
      // Selection is a career achievement (19.4).
      for (const sel of starters.concat(rosters[lg].pitchers, bench)) {
        const p = players[sel.id];
        if (!p) continue;
        const ach = ensureAch(p);
        if (!ach.allStarSelections.includes(year)) ach.allStarSelections.push(year);
      }
    }

    function pick(e) {
      return { id: e.p.id, name: e.p.name, teamId: e.t.id, pos: e.p.primaryPosition };
    }

    // Exhibition result: roster strength tilts a heavy-noise scoreboard.
    const strength = {};
    for (const lg of ['east', 'west']) {
      const all = rosters[lg].starters.concat(rosters[lg].pitchers, rosters[lg].bench);
      strength[lg] = all.reduce((sum, s) => {
        const p = players[s.id];
        return sum + (p ? window.BBGM_ROSTER.overall(p) : 50);
      }, 0) / Math.max(1, all.length);
    }
    let eastRuns, westRuns;
    do {
      eastRuns = Math.max(0, Math.round(rnorm(4.5 + (strength.east - strength.west) * 0.15, 2.4)));
      westRuns = Math.max(0, Math.round(rnorm(4.5 + (strength.west - strength.east) * 0.15, 2.4)));
    } while (eastRuns === westRuns);
    const winner = eastRuns > westRuns ? 'east' : 'west';

    // All-Star MVP: a winning-side bat, weighted by star power.
    const mvpPool = rosters[winner].starters.concat(rosters[winner].bench)
      .map((s) => ({ s, w: Math.max(1, (players[s.id] ? window.BBGM_ROSTER.overall(players[s.id]) : 50) - 45) }));
    let total = mvpPool.reduce((sum, e) => sum + e.w, 0);
    let roll = rand() * total;
    let mvp = mvpPool[0].s;
    for (const e of mvpPool) { roll -= e.w; if (roll <= 0) { mvp = e.s; break; } }
    const mvpP = players[mvp.id];
    if (mvpP) ensureAch(mvpP).awards.push({ year, name: 'All-Star Game MVP' });

    const result = {
      year,
      date: { ...state.league.schedule.allStarDate },
      eastRuns, westRuns, winner,
      mvp: { ...mvp },
      rosters,
    };
    if (!state.history.allStar) state.history.allStar = {};
    state.history.allStar[year] = result;
    return result;
  }

  // ---- Hall of Fame (19.5-19.9) ---------------------------------------------

  // Career-achievement score. Original-generation veterans carry MLB
  // service from before the save with no stat history for those years —
  // counting stats are pro-rated up to full service length so an early
  // save's aging legends aren't structurally unelectable (noted in 19.6).
  function hofScore(p) {
    const c = p.careerStats;
    if (!c) return 0;
    const ach = p.achievements || {};
    const awards = ach.awards || [];
    const count = (prefix) => awards.filter((a) => a.name && a.name.startsWith(prefix)).length;
    let statYears = 0;
    for (const y in p.stats) if ((p.stats[y].g || 0) > 0) statYears++;
    const svc = Math.max((p.serviceTime && p.serviceTime.years) || 0, statYears);
    const scale = statYears > 0 ? Math.min(2.5, svc / statYears) : 1;

    let score = 0;
    if (!p.isPitcher) {
      const ops = S().ops(c);
      score = (c.h * scale) / 3000 * 3.0 + (c.hr * scale) / 500 * 2.6 +
        (c.rbi * scale) / 1500 * 1.2 + (c.r * scale) / 1500 * 1.2 +
        (c.sb * scale) / 500 * 0.8 + Math.max(0, ops - 0.720) * 14;
      // Position scarcity (19.6): premium up-the-middle spots get a nudge.
      if (p.primaryPosition === 'C') score += 0.9;
      else if (p.primaryPosition === 'SS') score += 0.6;
      else if (p.primaryPosition === 'CF') score += 0.5;
    } else {
      const era = S().era(c);
      score = (c.w * scale) / 250 * 3.0 + (c.k * scale) / 3000 * 2.6 +
        (c.sv * scale) / 350 * 2.2 + Math.max(0, 3.90 - era) * 1.4;
    }
    score += count('MVP') * 1.1 + count('Cy Young') * 1.1 +
      (ach.allStarSelections || []).length * 0.22 +
      (ach.championships || []).length * 0.28 +
      count('Gold Glove') * 0.12 + count('Silver Slugger') * 0.08 +
      count('Rookie of the Year') * 0.15 + count('Reliever of the Year') * 0.3;
    if (svc >= 15) score += 0.3;
    return score;
  }

  // Annual vote (19.6): eligible after 5 retired seasons with 10+ years of
  // service; 10 years on the ballot, 75% elects, at most 4 per class.
  function runHofVoting(state, year) {
    const players = state.players;
    const ballot = [];
    const vets = [];
    for (const id in players) {
      const p = players[id];
      if (!p.retired || p.hof) continue;
      const retiredFor = year - (p.retired.year || year);
      if (retiredFor < 5) continue;
      if (((p.serviceTime && p.serviceTime.years) || 0) < 10) continue;
      if (!p.hofBallot) p.hofBallot = { appearances: 0, lastPct: 0 };
      if (p.hofBallot.appearances >= 10) {
        // Fell off the writers' ballot; veterans committee after 10 more
        // years in the wilderness (19.5).
        if (retiredFor >= 20) vets.push(p);
        continue;
      }
      ballot.push(p);
    }

    const results = [];
    for (const p of ballot) {
      p.hofBallot.appearances++;
      const score = hofScore(p);
      // Logistic vote share: ~50% at the borderline, elect-range above it.
      // Ballot momentum: long-tenured candidates pick up sympathy votes.
      let pct = 100 / (1 + Math.exp(-(score - 7.2) * 0.75)) +
        (p.hofBallot.appearances - 1) * 0.8 + rnorm(0, 4);
      pct = clamp(Math.round(pct * 10) / 10, 0, 100);
      p.hofBallot.lastPct = pct;
      results.push({ id: p.id, name: p.name, pos: p.primaryPosition, pct,
        appearances: p.hofBallot.appearances, score });
    }
    results.sort((a, b) => b.pct - a.pct);

    // 75% elects; a loaded ballot caps at 4 (19.6/19.9).
    const inducted = [];
    for (const r of results) {
      if (r.pct >= 75 && inducted.length < 4) {
        const p = players[r.id];
        p.hof = { year, pct: r.pct, method: 'ballot' };
        ensureAch(p).awards.push({ year, name: 'Hall of Fame' });
        inducted.push({ id: r.id, name: r.name, pos: r.pos, pct: r.pct, method: 'ballot' });
      }
    }

    // Veterans committee (19.9): 0-1 long-overlooked candidate per year.
    if (vets.length) {
      const best = vets.map((p) => ({ p, score: hofScore(p) }))
        .sort((a, b) => b.score - a.score)[0];
      if (best.score > 6.0 && rand() < 0.35) {
        best.p.hof = { year, pct: 0, method: 'veterans' };
        ensureAch(best.p).awards.push({ year, name: 'Hall of Fame (Veterans Committee)' });
        inducted.push({ id: best.p.id, name: best.p.name, pos: best.p.primaryPosition,
          pct: 0, method: 'veterans' });
      }
    }

    const entry = { year, inducted, ballot: results.slice(0, 15).map((r) => ({
      id: r.id, name: r.name, pos: r.pos, pct: r.pct, appearances: r.appearances,
    })) };
    if (!state.history.hof) state.history.hof = {};
    state.history.hof[year] = entry;
    return entry;
  }

  return {
    runAwardsVoting, runAllStar, allStarPending, runHofVoting,
    hitterValue, pitcherValue, relieverValue, hofScore,
  };
})();
