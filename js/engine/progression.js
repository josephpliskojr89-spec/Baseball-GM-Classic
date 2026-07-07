// Annual player progression and retirement (bible 9). Runs once per
// offseason, after retirements are decided, for every unretired player in
// the league (MLB and minors).
//
// Uses Math.random by convention (like the game sim): generation-time
// randomness is seeded, in-career randomness is not.
window.BBGM_PROGRESSION = (function () {
  const C = window.BBGM_CONSTANTS;

  const HITTER_KEYS = ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'bunting', 'defense', 'arm'];
  const PITCHER_KEYS = ['stamina', 'velocity', 'movement', 'control', 'stuff'];
  const RATING_FLOOR = 25;   // decline asymptote (9.2's "floor")
  const HARD_MIN = 20;
  const MAX_SWING = 12;      // volatility 0.4 → ±~5 pts/yr (9.4)

  function rand() { return Math.random(); }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function archetypeDef(p) {
    const defs = p.isPitcher ? C.PITCHER_ARCHETYPES : C.HITTER_ARCHETYPES;
    return defs.find((a) => a.key === p.hidden.archetype) || defs[0];
  }

  // Stamp per-player curve specifics lazily (players generated before this
  // system existed have no resolved peak age).
  function ensureCurveState(p, arch) {
    const h = p.hidden;
    if (h.peakAge == null) h.peakAge = rint(arch.peakAge[0], arch.peakAge[1]);
    if (arch.breakoutAge && h.breakoutAge == null) h.breakoutAge = rint(arch.breakoutAge[0], arch.breakoutAge[1]);
  }

  // Level appropriateness (9.3 / 12.4): compare true overall to the level's
  // band. Returns a progression multiplier penalty (0 = none).
  const LEVEL_BANDS = { AAA: [46, 80], AA: [38, 55], 'A+': [30, 50], A: [25, 45], Rookie: [20, 40] };
  function levelPenalty(p) {
    if (p.status !== 'minors') return 0;
    const band = LEVEL_BANDS[p.rosterStatus];
    if (!band) return 0;
    const ovr = window.BBGM_ROSTER.overall(p);
    if (ovr > band[1]) return 0.10;  // held back too long
    if (ovr < band[0]) return 0.15;  // promoted too aggressively
    return 0;
  }

  function workEthicMod(p) {
    const we = (p.hidden && p.hidden.workEthic) || 5;
    if (we >= 8) return 0.05 + (we - 8) * 0.05;   // +5% to +15%
    if (we <= 3) return -0.10 - (3 - we) * 0.05;  // -10% to -20%
    return 0;
  }

  // Injury drag (9.3): a severe stint in the season just played slows the
  // year's development.
  function injuryMod(p, year) {
    const hist = p.injuryHistory || [];
    let worst = 0;
    for (const inj of hist) {
      if (inj.year !== year) continue;
      if (inj.severity === 'season-ending') worst = Math.max(worst, 0.25);
      else if (inj.severity === '60-day') worst = Math.max(worst, 0.20);
      else if (inj.severity === 'multi-week') worst = Math.max(worst, 0.10);
    }
    return worst;
  }

  // Progress one player one offseason. Mutates ratings in place.
  function progressPlayer(p, year) {
    const arch = archetypeDef(p);
    ensureCurveState(p, arch);
    const h = p.hidden;
    const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const age = p.age;
    const posMod = 1 + workEthicMod(p) - injuryMod(p, year) - levelPenalty(p);

    // Late-bloomer breakout (9.2): one-time jump of 30-50% of the
    // remaining ceiling gap at the stamped breakout age.
    const breakoutNow = h.breakoutAge != null && !h.breakoutDone && age >= h.breakoutAge;
    if (breakoutNow) h.breakoutDone = true;

    // One-year-wonder spike/reversion (9.2).
    let spikeNow = false;
    if (arch.reversionLikelihood) {
      if (h.spikeAmounts && rand() < arch.reversionLikelihood) {
        for (const k of keys) {
          if (h.spikeAmounts[k]) p.ratings[k] = clamp(p.ratings[k] - h.spikeAmounts[k], HARD_MIN, h.ceiling[k]);
        }
        h.spikeAmounts = null;
        h.spikeDone = true;
      } else if (!h.spikeDone && !h.spikeAmounts &&
                 age >= arch.peakAge[0] && age <= arch.peakAge[1] && rand() < 0.5) {
        spikeNow = true;
        h.spikeAmounts = {};
      }
    }

    for (const k of keys) {
      const cur = p.ratings[k];
      const ceil = h.ceiling[k] != null ? h.ceiling[k] : 60;
      let change = 0;

      if (age < h.peakAge) {
        change = arch.riseRate * Math.max(0, ceil - cur) * posMod;
        if (breakoutNow) change += (0.3 + rand() * 0.2) * Math.max(0, ceil - cur);
      } else if (age < h.peakAge + (arch.plateauWidth || 2)) {
        change = 0; // plateau — variance only
      } else {
        const accel = age >= 35 ? 1.5 : 1;
        change = -arch.declineRate * Math.max(0, cur - RATING_FLOOR) * accel;
      }

      if (spikeNow) {
        const spike = (0.2 + rand() * 0.1) * Math.max(0, ceil - cur);
        change += spike;
        h.spikeAmounts[k] = spike;
      }

      // Volatility (9.4).
      change += (rand() * 2 - 1) * (arch.volatility || 0.1) * MAX_SWING;

      p.ratings[k] = Math.round(clamp(cur + change, HARD_MIN, ceil) * 10) / 10;
    }
  }

  // ---- Retirement (9.6) ----
  function retirementProb(p, year) {
    const age = p.age;
    const ovr = window.BBGM_ROSTER.overall(p);
    // Fringe minor-league veterans wash out young — keeps orgs from
    // carrying 30-year-old A-ball filler forever.
    if (p.status === 'minors' && age >= 29 && ovr < 45) return 0.5;
    if (age < 33) return 0;
    const base = { 33: 0.05, 34: 0.08, 35: 0.14, 36: 0.22, 37: 0.32, 38: 0.45, 39: 0.60, 40: 0.75, 41: 0.85 }[age];
    let prob = base != null ? base : 0.95;
    if (ovr < 40) prob += 0.20;        // sub-replacement performance
    else if (ovr >= 60) prob -= 0.12;  // stars hang on
    // Major injury at 33+ pushes players out (9.6).
    const majorThisYear = (p.injuryHistory || []).some((i) => i.year === year &&
      (i.severity === 'season-ending' || i.severity === '60-day'));
    if (majorThisYear) prob += 0.15;
    return clamp(prob, 0, 0.97);
  }

  // Roll retirement for one player; returns true and stamps the retired
  // state (incl. the 17.9 "open to coaching" flag) if he hangs them up.
  function rollRetirement(p, year) {
    if (rand() >= retirementProb(p, year)) return false;
    // Coaching pipeline flag (bible 17.9): weighted by makeup and the
    // classic catcher / middle-infield manager pedigree.
    let coachChance = 0.12;
    const makeup = (p.hidden && p.hidden.makeupGrade) || 5;
    coachChance += (makeup - 5) * 0.02;
    if (!p.isPitcher && ['C', '2B', 'SS'].includes(p.primaryPosition)) coachChance += 0.08;
    if (p.age >= 36) coachChance += 0.04; // long careers
    p.retired = {
      year,
      age: p.age,
      openToCoaching: rand() < clamp(coachChance, 0.03, 0.5),
    };
    p.status = 'retired';
    p.rosterStatus = 'retired';
    return true;
  }

  return { progressPlayer, rollRetirement, retirementProb, LEVEL_BANDS };
})();
