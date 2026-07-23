// Managers and coaches (bible 17). Generation, the standing unemployed
// pool, tendency archetypes, hiring/firing, career progression, and the
// retired-player coaching pipeline (17.9).
//
// Pillar 4: every team's manager owns the day-to-day. The simulation and
// lineup construction read tendencies from here; a missing manager (old
// save, mid-migration) falls back to league-average tendencies — which is
// exactly the engine's pre-Phase-10 behavior.
window.BBGM_STAFF = (function () {
  function rand() { return Math.random(); }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // League-average manager: all-5 tendencies == the engine's default logic.
  const AVERAGE_TENDENCIES = {
    smallBall: 5, leverage: 5, quickHook: 5, lineupStyle: 5, defSub: 5, pinchHit: 5,
  };

  // Manager archetypes (17.3) — tendency bundles with jitter.
  const MANAGER_ARCHETYPES = [
    { key: 'old_school', name: 'Old-School Tactician',
      base: { smallBall: 8, leverage: 3, quickHook: 3, lineupStyle: 3, defSub: 5, pinchHit: 5 } },
    { key: 'modern', name: 'Modern Strategist',
      base: { smallBall: 2, leverage: 8, quickHook: 8, lineupStyle: 8, defSub: 6, pinchHit: 7 } },
    { key: 'players_manager', name: "Player's Manager",
      base: { smallBall: 5, leverage: 3, quickHook: 4, lineupStyle: 5, defSub: 4, pinchHit: 5 } },
    { key: 'innovator', name: 'Aggressive Innovator',
      base: { smallBall: 7, leverage: 8, quickHook: 7, lineupStyle: 7, defSub: 7, pinchHit: 8 } },
    { key: 'defensive', name: 'Defensive-Minded',
      base: { smallBall: 6, leverage: 4, quickHook: 3, lineupStyle: 4, defSub: 8, pinchHit: 4 } },
    { key: 'first_year', name: 'First-Year Manager',
      base: { smallBall: 5, leverage: 5, quickHook: 5, lineupStyle: 5, defSub: 5, pinchHit: 5 } },
  ];

  const COACH_SPECIALTIES = {
    hitting: ['Power development', 'Plate discipline', 'Contact mechanics', null, null],
    pitching: ['Command guru', 'Velocity development', 'Pitch design', null, null],
  };

  let _seq = 1;
  function nextStaffId(state) {
    if (!state.meta.nextStaffId) state.meta.nextStaffId = 1;
    return `s${state.meta.nextStaffId++}`;
  }

  function randomName(rng) {
    const N = window.BBGM_NAMES;
    const r = rng || rand;
    return `${N.firstNames[Math.floor(r() * N.firstNames.length)]} ${N.lastNames[Math.floor(r() * N.lastNames.length)]}`;
  }

  function jitterTendencies(base, r) {
    const t = {};
    for (const k in base) t[k] = clamp(base[k] + rint(-1, 1), 1, 10);
    return t;
  }

  function generateManager(state, opts = {}) {
    const arch = opts.archetype
      ? MANAGER_ARCHETYPES.find((a) => a.key === opts.archetype)
      : MANAGER_ARCHETYPES[Math.floor(rand() * MANAGER_ARCHETYPES.length)];
    return {
      id: nextStaffId(state),
      role: 'manager',
      name: opts.name || randomName(),
      age: opts.age != null ? opts.age : rint(42, 62),
      archetype: arch.key,
      archetypeName: arch.name,
      tendencies: jitterTendencies(arch.base),
      reputation: opts.reputation != null ? opts.reputation : rint(3, 8),
      experience: opts.experience != null ? opts.experience : rint(0, 15),
      formerPlayerId: opts.formerPlayerId || null,
      teamId: null,
      yearsWithTeam: 0,
      careerW: 0, careerL: 0,
    };
  }

  function generateCoach(state, opts = {}) {
    const domain = opts.domain || (rand() < 0.5 ? 'hitting' : 'pitching');
    const specialty = COACH_SPECIALTIES[domain][Math.floor(rand() * COACH_SPECIALTIES[domain].length)];
    // Dev modifier -0.10..+0.20 (17.4), skewed toward small positives.
    const devMod = opts.devMod != null ? opts.devMod
      : Math.round(clamp((rand() * 0.30 - 0.10) * (rand() < 0.3 ? 1.4 : 1), -0.10, 0.20) * 100) / 100;
    return {
      id: nextStaffId(state),
      role: domain, // 'hitting' | 'pitching'
      name: opts.name || randomName(),
      age: opts.age != null ? opts.age : rint(35, 60),
      devMod,
      specialty,
      reputation: opts.reputation != null ? opts.reputation : clamp(Math.round(5 + devMod * 20 + rint(-1, 1)), 1, 10),
      formerPlayerId: opts.formerPlayerId || null,
      teamId: null,
      yearsWithTeam: 0,
      yearsInProfession: opts.yearsInProfession != null ? opts.yearsInProfession : rint(0, 12),
    };
  }

  // Owner hiring preference: which archetypes each owner favors (17.5).
  const OWNER_PREFS = {
    win_now: ['players_manager', 'old_school', 'modern'],       // established rep matters more
    patient: ['players_manager', 'first_year', 'modern'],
    cheap: ['first_year', 'players_manager', 'defensive'],
    analytics: ['modern', 'innovator', 'first_year'],
    old_school: ['old_school', 'defensive', 'players_manager'],
    aggressive: ['innovator', 'modern', 'old_school'],
  };

  function managerAppeal(team, mgr) {
    let score = mgr.reputation * 2 + Math.min(mgr.experience, 12) * 0.5;
    const prefs = OWNER_PREFS[team.owner] || [];
    const pi = prefs.indexOf(mgr.archetype);
    if (pi === 0) score += 8;
    else if (pi === 1) score += 5;
    else if (pi === 2) score += 2;
    // Cheap owners avoid expensive (high-rep) managers.
    if (team.owner === 'cheap') score -= mgr.reputation * 1.2;
    return score + rand() * 3;
  }

  // ---- Staffing / pool -----------------------------------------------------

  // Make sure the league is fully staffed and a standing pool exists (17.6).
  // Safe to call on old saves (lazy migration) and after every offseason.
  function ensureStaff(state) {
    if (!state.staff) state.staff = { managers: {}, coaches: {} };
    const S = state.staff;
    for (const team of state.league.teams) {
      if (!team.managerId || !S.managers[team.managerId]) {
        const mgr = hireBestFromPool(state, team) || createAndHire(state, team);
        void mgr;
      }
      for (const [field, domain] of [['hittingCoachId', 'hitting'], ['pitchingCoachId', 'pitching']]) {
        if (!team[field] || !S.coaches[team[field]]) {
          let coach = poolCoaches(state, domain).sort((a, b) => b.reputation - a.reputation)[0];
          if (!coach) {
            coach = generateCoach(state, { domain });
            S.coaches[coach.id] = coach;
          }
          coach.teamId = team.id;
          coach.yearsWithTeam = 0;
          team[field] = coach.id;
        }
      }
    }
    // Standing pool floors: 8-12 unemployed managers, 15-20 coaches.
    while (poolManagers(state).length < 8) {
      const m = generateManager(state);
      S.managers[m.id] = m;
    }
    while (poolCoaches(state).length < 15) {
      const c = generateCoach(state);
      S.coaches[c.id] = c;
    }
  }

  function poolManagers(state) {
    return Object.values(state.staff.managers).filter((m) => !m.teamId && !m.retired);
  }
  function poolCoaches(state, domain) {
    return Object.values(state.staff.coaches).filter((c) =>
      !c.teamId && !c.retired && (!domain || c.role === domain));
  }

  function hireBestFromPool(state, team) {
    const cands = poolManagers(state);
    if (!cands.length) return null;
    cands.sort((a, b) => managerAppeal(team, b) - managerAppeal(team, a));
    return hireManager(state, team, cands[0].id);
  }

  function createAndHire(state, team) {
    const prefs = OWNER_PREFS[team.owner] || [];
    const m = generateManager(state, { archetype: prefs[0] });
    state.staff.managers[m.id] = m;
    return hireManager(state, team, m.id);
  }

  function hireManager(state, team, managerId) {
    const mgr = state.staff.managers[managerId];
    if (!mgr || mgr.teamId) return null;
    if (team.managerId && state.staff.managers[team.managerId]) {
      fireManager(state, team, 'replaced');
    }
    mgr.teamId = team.id;
    mgr.yearsWithTeam = 0;
    team.managerId = mgr.id;
    return mgr;
  }

  function fireManager(state, team, reason) {
    const mgr = team.managerId && state.staff.managers[team.managerId];
    if (!mgr) return null;
    mgr.teamId = null;
    mgr.yearsWithTeam = 0;
    mgr.firedReason = reason || 'fired';
    team.managerId = null;
    return mgr;
  }

  // Tendencies for a team, defaulting to league-average when unstaffed.
  function tendenciesFor(state, team) {
    const mgr = state.staff && team.managerId && state.staff.managers[team.managerId];
    return mgr ? mgr.tendencies : AVERAGE_TENDENCIES;
  }

  function managerFor(state, team) {
    return (state.staff && team.managerId && state.staff.managers[team.managerId]) || null;
  }

  // Coach development modifiers for a team: { hitting, pitching } (17.4).
  function coachModsFor(state, team) {
    const S = state.staff;
    const h = S && team.hittingCoachId && S.coaches[team.hittingCoachId];
    const p = S && team.pitchingCoachId && S.coaches[team.pitchingCoachId];
    return { hitting: h ? h.devMod : 0, pitching: p ? p.devMod : 0 };
  }

  // ---- Offseason processing (17.6, 17.9) ------------------------------------

  // Owner patience: losing seasons tolerated before firing pressure peaks.
  const OWNER_PATIENCE = {
    win_now: 1, cheap: 3, patient: 4, analytics: 3, old_school: 2, aggressive: 2,
  };

  // Run after the season's records are final, before the FA window. Returns
  // news-worthy events. `records[teamId] = {w, l}` for the closing season.
  function runStaffOffseason(state, records, retirements, year) {
    ensureStaff(state);
    const S = state.staff;
    const events = [];

    // 1. Manager records, tenure, reputation drift.
    for (const team of state.league.teams) {
      const mgr = managerFor(state, team);
      if (!mgr) continue;
      const rec = records[team.id] || { w: 81, l: 81 };
      mgr.careerW += rec.w;
      mgr.careerL += rec.l;
      mgr.yearsWithTeam++;
      mgr.experience++;
      mgr.lastSeasonWins = rec.w;
      if (rec.w >= 92) mgr.reputation = clamp(mgr.reputation + 1, 1, 10);
      else if (rec.w < 70) mgr.reputation = clamp(mgr.reputation - 1, 1, 10);
      // First-year managers develop a real archetype after 2 seasons (17.3).
      if (mgr.archetype === 'first_year' && mgr.experience >= 2) {
        const arch = MANAGER_ARCHETYPES[Math.floor(rand() * (MANAGER_ARCHETYPES.length - 1))];
        mgr.archetype = arch.key;
        mgr.archetypeName = arch.name;
        mgr.tendencies = jitterTendencies(arch.base);
      }
    }

    // 2. Firings (17.6) — owner patience vs performance, plus rare
    //    "personal reasons" departures. User team included: the OWNER
    //    fires managers, not the GM (Pillar 4 keeps the GM in the front
    //    office; the user hires the replacement).
    for (const team of state.league.teams) {
      const mgr = managerFor(state, team);
      if (!mgr) continue;
      const rec = records[team.id] || { w: 81, l: 81 };
      let fireProb = 0;
      const patience = OWNER_PATIENCE[team.owner] != null ? OWNER_PATIENCE[team.owner] : 2;
      if (rec.w < 75) {
        fireProb = mgr.yearsWithTeam > patience ? 0.65 : 0.12;
        if (rec.w < 66) fireProb += 0.2;
      }
      if (rand() < 0.04) fireProb = 1; // personal reasons / walked away
      // Manager old-age retirement.
      mgr.age++;
      const retires = mgr.age >= 63 && rand() < (mgr.age - 62) * 0.18;
      if (retires) {
        fireManager(state, team, 'retired');
        mgr.retired = true;
        events.push({ kind: 'mgr-retired', teamId: team.id, name: mgr.name });
      } else if (fireProb > 0 && rand() < fireProb) {
        fireManager(state, team, 'fired');
        events.push({ kind: 'mgr-fired', teamId: team.id, name: mgr.name, wins: rec.w });
      }
    }

    // 3. Coach churn: tenure, occasional moves, aging out.
    for (const cid in S.coaches) {
      const c = S.coaches[cid];
      if (c.retired) continue;
      c.age++;
      c.yearsInProfession = (c.yearsInProfession || 0) + 1;
      if (c.teamId) c.yearsWithTeam++;
      if (c.age >= 62 && rand() < 0.25) {
        if (c.teamId) {
          const team = state.league.teams.find((t) => t.id === c.teamId);
          if (team) {
            if (team.hittingCoachId === c.id) team.hittingCoachId = null;
            if (team.pitchingCoachId === c.id) team.pitchingCoachId = null;
          }
        }
        c.teamId = null;
        c.retired = true;
      } else if (c.teamId && rand() < 0.08) {
        // Organic turnover (17.6): contract expires, coach hits the market.
        const team = state.league.teams.find((t) => t.id === c.teamId);
        if (team) {
          if (team.hittingCoachId === c.id) team.hittingCoachId = null;
          if (team.pitchingCoachId === c.id) team.pitchingCoachId = null;
        }
        c.teamId = null;
        c.yearsWithTeam = 0;
      }
    }

    // 4. Retired players enter the profession (17.9). Flags were stamped at
    //    retirement; they join the coach pool 1-3 years later.
    for (const r of retirements || []) {
      const p = state.players[r.playerId];
      if (!p || !p.retired || !p.retired.openToCoaching || p.retired.enteredCoaching) continue;
      // Defer entry by 1-3 years — handled by checking previous retirees too.
      void p;
    }
    for (const pid in state.players) {
      const p = state.players[pid];
      if (!p.retired || !p.retired.openToCoaching || p.retired.enteredCoaching) continue;
      const yearsOut = year - p.retired.year;
      if (yearsOut < 1 || yearsOut > 4) continue;
      if (rand() > 0.5) continue; // staggered entry
      p.retired.enteredCoaching = true;
      const overall = window.BBGM_ROSTER.overall(p);
      const c = generateCoach(state, {
        domain: p.isPitcher ? 'pitching' : 'hitting',
        name: p.name,
        age: p.age + yearsOut,
        formerPlayerId: p.id,
        yearsInProfession: 0,
        // Name recognition (17.9): star retirees get reputation above their
        // actual coaching chops.
        reputation: clamp(Math.round(3 + (overall - 45) * 0.12 + rand() * 2), 1, 10),
      });
      S.coaches[c.id] = c;
      events.push({ kind: 'coach-enters', name: p.name, playerId: p.id, domain: c.role });
    }

    // 5. Experienced, reputable coaches graduate to manager candidates (17.9).
    for (const cid in S.coaches) {
      const c = S.coaches[cid];
      if (c.retired || (c.yearsInProfession || 0) < 4 || c.reputation < 6) continue;
      if (rand() > 0.08) continue;
      const m = generateManager(state, {
        name: c.name, age: c.age, archetype: 'first_year',
        reputation: clamp(c.reputation - 1, 1, 10),
        experience: 0,
        formerPlayerId: c.formerPlayerId,
      });
      S.managers[m.id] = m;
      if (c.teamId) {
        const team = state.league.teams.find((t) => t.id === c.teamId);
        if (team) {
          if (team.hittingCoachId === c.id) team.hittingCoachId = null;
          if (team.pitchingCoachId === c.id) team.pitchingCoachId = null;
        }
      }
      c.retired = true; // leaves the coaching ranks for the manager track
      events.push({ kind: 'coach-to-manager', name: c.name });
    }

    // 6. AI teams (not the user's) fill vacancies immediately by owner
    //    preference; the user hires during the offseason (Staff tab) and
    //    ensureStaff() auto-fills at Opening Day if they never do.
    for (const team of state.league.teams) {
      if (team.id === state.meta.userTeamId) continue;
      if (!team.managerId) {
        const hired = hireBestFromPool(state, team) || createAndHire(state, team);
        if (hired) events.push({ kind: 'mgr-hired', teamId: team.id, name: hired.name, archetype: hired.archetypeName });
      }
    }
    // New first-year candidates trickle in from the minors ranks (17.6).
    for (let i = 0; i < rint(1, 2); i++) {
      const m = generateManager(state, { archetype: 'first_year', age: rint(38, 48), reputation: rint(2, 5), experience: 0 });
      S.managers[m.id] = m;
    }

    // Pool hygiene (0.46.0): retired staff were flagged but never deleted
    // — the pools grew ~35 objects a winter forever. Nothing references a
    // retired entry (award history stores name copies, teams reference
    // only employed ids), so drop any retiree no team still points at.
    const referenced = new Set();
    for (const team of state.league.teams) {
      for (const f of ['managerId', 'hittingCoachId', 'pitchingCoachId']) {
        if (team[f]) referenced.add(team[f]);
      }
    }
    for (const id in S.managers) {
      if (S.managers[id].retired && !referenced.has(id)) delete S.managers[id];
    }
    for (const id in S.coaches) {
      if (S.coaches[id].retired && !referenced.has(id)) delete S.coaches[id];
    }

    return events;
  }

  const TENDENCY_LABELS = {
    smallBall: 'Small ball', leverage: 'Bullpen leverage', quickHook: 'Quick hook',
    lineupStyle: 'Lineup style', defSub: 'Defensive subs', pinchHit: 'Pinch hitting',
  };

  function tendencyLevel(v) {
    return v <= 3 ? 'Low' : v >= 7 ? 'High' : 'Average';
  }

  // ---- Offer-based hiring (17.6): the staff market ------------------------
  // Candidates aren't a vending machine — you make an offer and they weigh
  // the situation: winning clubs and big markets attract; big reputations
  // are choosier. A candidate who turns you down won't reconsider until
  // next winter.

  function offerOdds(state, team, cand) {
    const rec = team.seasonRecord || { w: 81, l: 81 };
    const wp = (rec.w + rec.l) > 0 ? rec.w / (rec.w + rec.l) : 0.5;
    let odds = 0.75 + (wp - 0.5) * 0.7;
    if (team.market === 'large') odds += 0.05;
    else if (team.market === 'small') odds -= 0.05;
    odds -= ((cand.reputation || 5) - 5) * 0.06;
    return clamp(odds, 0.15, 0.95);
  }

  // Rough interest read shown to the user before they burn the offer.
  function offerOutlook(state, team, cand) {
    const odds = offerOdds(state, team, cand);
    if (odds >= 0.75) return 'Likely to accept';
    if (odds >= 0.5) return 'Interested';
    if (odds >= 0.3) return 'Lukewarm';
    return 'Long shot';
  }

  // kind: 'manager' | 'coach' (coach needs the team field, e.g.
  // 'hittingCoachId'). Returns {accepted} or {accepted:false, already:true}
  // when this candidate already declined this team this winter.
  function offerJob(state, team, cand, kind, field) {
    const year = state.meta.currentDate.year;
    if (!cand.declinedTeams) cand.declinedTeams = {};
    if (cand.declinedTeams[team.id] === year) return { accepted: false, already: true };
    if (Math.random() < offerOdds(state, team, cand)) {
      if (kind === 'manager') {
        hireManager(state, team, cand.id);
      } else {
        const current = team[field] && state.staff.coaches[team[field]];
        if (current) { current.teamId = null; current.yearsWithTeam = 0; }
        cand.teamId = team.id;
        cand.yearsWithTeam = 0;
        team[field] = cand.id;
      }
      return { accepted: true };
    }
    cand.declinedTeams[team.id] = year;
    return { accepted: false };
  }

  function fireCoach(state, team, field) {
    const c = team[field] && state.staff.coaches[team[field]];
    if (c) { c.teamId = null; c.yearsWithTeam = 0; }
    team[field] = null;
    return c || null;
  }

  return {
    AVERAGE_TENDENCIES, MANAGER_ARCHETYPES, TENDENCY_LABELS,
    generateManager, generateCoach, ensureStaff,
    poolManagers, poolCoaches, hireManager, fireManager,
    tendenciesFor, managerFor, coachModsFor,
    runStaffOffseason, managerAppeal, tendencyLevel,
    offerOdds, offerOutlook, offerJob, fireCoach,
  };
})();
