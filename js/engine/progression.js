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
  // Pen-stamina erosion (0.40.0): a relief role doesn't build starter
  // conditioning. RP/CP arms develop stamina only toward an effective
  // ceiling of PEN_STA_CEIL, and anything above it fades season by
  // season (a converted starter's 64 drifts to the mid-50s over ~4
  // years). The RAW ceiling is untouched, so moving back to the
  // rotation lets a young arm rebuild through normal development.
  const PEN_STA_CEIL = 55;
  const PEN_STA_EROSION = 0.25; // yearly fraction of the excess

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

  // Level appropriateness (9.3 / 12.4): development is gated by playing at
  // the right level, using the same recommendation the scout arrows show.
  // One level off is a mild drag (a season of it happens naturally on the
  // way up); two or more levels off genuinely stunts the year — a stud
  // sandbagged in A-ball learns nothing from weak competition, and a kid
  // rushed past his level gets overmatched instead of developing.
  function levelPenalty(p) {
    if (p.status !== 'minors') return 0;
    const delta = window.BBGM_MINORS.levelFitDelta(p);
    if (delta >= 2) return 0.20;   // left too low: dominating, not learning
    if (delta === 1) return 0.08;
    if (delta <= -2) return 0.25;  // rushed: overmatched
    if (delta === -1) return 0.10;
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
  // coachMod (bible 9.3 / 17.4): the org's hitting or pitching coach
  // development modifier (-0.10..+0.20). Coaches matter most for players
  // still developing; established veterans get less than half the effect.
  // 0.38.0: a season's rating movement now splits between five monthly
  // in-season ticks (inSeasonTick, ~35% of the archetype rates) and this
  // annual pass (65%) — total yearly magnitude is preserved, but a
  // developing kid visibly improves DURING the year and an aging vet
  // visibly slips. Spikes, breakouts, reversion, coach mods, injury
  // drag, and the full volatility jolt remain annual-only events.
  const ANNUAL_SHARE = 0.65;

  function progressPlayer(p, year, coachMod) {
    const arch = archetypeDef(p);
    ensureCurveState(p, arch);
    const h = p.hidden;
    const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const age = p.age;
    const coach = (coachMod || 0) * (age < 27 ? 1 : 0.4);
    const posMod = 1 + workEthicMod(p) + coach - injuryMod(p, year) - levelPenalty(p);

    // Late-bloomer breakout (9.2): one-time jump of 30-50% of the
    // remaining ceiling gap at the stamped breakout age.
    const breakoutNow = h.breakoutAge != null && !h.breakoutDone && age >= h.breakoutAge;
    if (breakoutNow) h.breakoutDone = true;

    // One-year-wonder spike/reversion (9.2).
    let spikeNow = false;
    if (arch.reversionLikelihood) {
      if (h.spikeAmounts && rand() < arch.reversionLikelihood) {
        for (const k of keys) {
          // Same null-guards as the main loop below: a missing rating key
          // or ceiling entry (old-save shapes) must not clamp to NaN.
          if (h.spikeAmounts[k] && p.ratings[k] != null) {
            p.ratings[k] = clamp(p.ratings[k] - h.spikeAmounts[k], HARD_MIN,
              h.ceiling[k] != null ? h.ceiling[k] : 60);
          }
        }
        h.spikeAmounts = null;
        h.spikeDone = true;
      } else if (!h.spikeDone && !h.spikeAmounts &&
                 age >= arch.peakAge[0] && age <= arch.peakAge[1] && rand() < 0.5) {
        spikeNow = true;
        h.spikeAmounts = {};
      }
    }

    // Yearly form (0.53.1, archetype audit): the volatility jolt used to
    // be rolled independently per attribute, and the overall — a weighted
    // mean of 5-9 draws — averaged the noise away: a "volatile" player's
    // OVR barely wobbled more than a workhorse's despite a 5× setting.
    // Most of the jolt is now ONE shared draw so his whole game swings
    // together (the All-Star year, then the mediocre one); the smaller
    // per-attribute remainder keeps individual tools diverging.
    const form = (rand() * 2 - 1) * (arch.volatility || 0.1) * MAX_SWING * 0.8;

    const penRole = p.isPitcher && (p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    for (const k of keys) {
      const cur = p.ratings[k];
      if (cur == null) continue; // old-save shape missing this key — skip, don't NaN
      const ceil = h.ceiling[k] != null ? h.ceiling[k] : 60;
      // Pen arms develop stamina only toward the reliever ceiling (0.40.0).
      const devCeil = (k === 'stamina' && penRole) ? Math.min(ceil, PEN_STA_CEIL) : ceil;
      let change = 0;

      if (age < h.peakAge) {
        change = arch.riseRate * ANNUAL_SHARE * Math.max(0, devCeil - cur) * posMod;
        // Coach project (0.48.0): the year a coach makes this player his
        // personal project, HIS specialty attributes develop 60% faster.
        // Rise only — a project never softens decline or beats the ceiling.
        if (p.devProject && p.devProject.attrs.includes(k)) change *= 1.6;
        if (breakoutNow) change += (0.3 + rand() * 0.2) * Math.max(0, devCeil - cur);
      } else if (age < h.peakAge + (arch.plateauWidth || 2)) {
        change = 0; // plateau — variance only
      } else {
        const accel = age >= 35 ? 1.5 : 1;
        change = -arch.declineRate * ANNUAL_SHARE * Math.max(0, cur - RATING_FLOOR) * accel;
      }

      // Pen-stamina erosion: conditioning above the reliever ceiling
      // fades — a converted starter's length drains season by season.
      if (k === 'stamina' && penRole && cur > PEN_STA_CEIL) {
        change -= PEN_STA_EROSION * ANNUAL_SHARE * (cur - PEN_STA_CEIL);
      }

      if (spikeNow) {
        const spike = (0.2 + rand() * 0.1) * Math.max(0, devCeil - cur);
        change += spike;
        h.spikeAmounts[k] = spike;
      }

      // Volatility (9.4): shared yearly form + per-attribute remainder.
      change += form + (rand() * 2 - 1) * (arch.volatility || 0.1) * MAX_SWING * 0.4;

      p.ratings[k] = Math.round(clamp(cur + change, HARD_MIN, ceil) * 10) / 10;
    }
  }

  // In-season development tick (0.38.0). Fired on the 1st of May, Jun,
  // Jul, Aug and Sep with frac = 0.07 each — five ticks carrying the
  // ~35% of the archetype's yearly rate that progressPlayer no longer
  // applies (ANNUAL_SHARE covers the rest). Same curve as the annual
  // pass but a deliberately reduced modifier bundle: work ethic and
  // level fit shape the month, while coach mods, injury drag, spikes,
  // breakouts, reversion and the full volatility jolt remain
  // annual-only events. Volatility here is a small monthly drift.
  function inSeasonTick(p, year, frac) {
    const arch = archetypeDef(p);
    ensureCurveState(p, arch);
    const h = p.hidden;
    const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const age = p.age;
    const posMod = 1 + workEthicMod(p) - levelPenalty(p);

    const penRole = p.isPitcher && (p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    for (const k of keys) {
      const cur = p.ratings[k];
      if (cur == null) continue; // old-save shape missing this key
      const ceil = h.ceiling[k] != null ? h.ceiling[k] : 60;
      const devCeil = (k === 'stamina' && penRole) ? Math.min(ceil, PEN_STA_CEIL) : ceil;
      let change = 0;

      if (age < h.peakAge) {
        change = arch.riseRate * frac * Math.max(0, devCeil - cur) * posMod;
        // Coach project boost (0.48.0) — the in-season share, so the
        // project visibly moves during the year.
        if (p.devProject && p.devProject.attrs.includes(k)) change *= 1.6;
      } else if (age < h.peakAge + (arch.plateauWidth || 2)) {
        change = 0;
      } else {
        const accel = age >= 35 ? 1.5 : 1;
        change = -arch.declineRate * frac * Math.max(0, cur - RATING_FLOOR) * accel;
      }

      // Pen-stamina erosion (0.40.0) — the in-season share of the fade,
      // so a midseason convert visibly loses length by September.
      if (k === 'stamina' && penRole && cur > PEN_STA_CEIL) {
        change -= PEN_STA_EROSION * frac * (cur - PEN_STA_CEIL);
      }

      change += (rand() * 2 - 1) * (arch.volatility || 0.1) * MAX_SWING * frac;

      p.ratings[k] = Math.round(clamp(cur + change, HARD_MIN, ceil) * 10) / 10;
    }
  }

  // ---- Ceiling breakouts (0.25.0 — 9.x amendment) --------------------------
  // The ONE way potential grows after signing day: the real-world velocity
  // jump or swing rework. Rolled once per offseason (before progression,
  // so the same winter's development climbs toward the new lid). Rare and
  // work-ethic-weighted — the gym rats earn their second gear: ~1% at
  // work ethic 1, ~2.8% at 10, and only in the pre-peak window (age ≤ 26).
  // One tool gains +3-8 ceiling, clamped at 82 and the archetype's cap
  // (a quad-A profile stays quad-A). Speed stays body-given (Phase 16
  // decoupling) unless it already IS the carrying tool — the same rule
  // the draft/intl slot lifts follow. Returns {key, amount} or null.
  function rollCeilingBreakout(p) {
    const h = p.hidden;
    if (!h || !h.ceiling) return null;
    if (p.age > 26) return null;
    const we = h.workEthic || 5;
    if (rand() >= 0.008 + we * 0.002) return null;
    const allKeys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const best = Math.max(...allKeys.map((q) => (h.ceiling[q] != null ? h.ceiling[q] : 0)));
    const keys = allKeys.filter((k) => {
      if (h.ceiling[k] == null) return false;
      if (k === 'bunting') return false; // nobody breaks out on bunting
      if (k === 'speed') return h.ceiling.speed >= best;
      return true;
    });
    if (!keys.length) return null;
    const key = keys[Math.floor(rand() * keys.length)];
    const arch = archetypeDef(p);
    const lid = Math.min(82, arch && arch.ceilingCap ? arch.ceilingCap : 82);
    const before = h.ceiling[key];
    const after = Math.round(clamp(before + 3 + rand() * 5, HARD_MIN, lid) * 10) / 10;
    if (after <= before) return null; // already at the lid — nothing happened
    h.ceiling[key] = after;
    return { key, amount: Math.round((after - before) * 10) / 10 };
  }

  // ---- Retirement (9.6) ----
  function retirementProb(p, year) {
    const age = p.age;
    const ovr = window.BBGM_ROSTER.overall(p);
    // Fringe minor-league veterans wash out young — keeps orgs from
    // carrying 30-year-old A-ball filler forever.
    if (p.status === 'minors' && age >= 29 && ovr < 45) return 0.5;
    // Unsigned free agents drift out of the game (16.8: the pool must not
    // accumulate careers' worth of fringe veterans). The mid-20s tier
    // matters once the draft is the talent pipeline — farm-cap releases
    // land here every offseason and must keep draining.
    // Undrafted/indie washouts (0.41.0): the young fringe FA who never
    // catches on gives up the indie grind after a couple of summers.
    if (p.status === 'FA' && age >= 24 && ovr < 44 && (p.faSeasons || 0) >= 2) return 0.5;
    if (p.status === 'FA' && age >= 28 && ovr < 48) return 0.6;
    if (p.status === 'FA' && age >= 26 && ovr < 46) return 0.5;
    if (p.status === 'FA' && age >= 30 && ovr < 50) return 0.5;
    if (p.status === 'FA' && age >= 27 && ovr < 50) return 0.45;
    if (p.status === 'FA' && age >= 33) return 0.5;
    // A second straight winter without a phone call ends most careers —
    // overseas leagues, retirement, real life. Stars hold out longer.
    if (p.status === 'FA' && (p.faSeasons || 0) >= 2) return ovr < 58 ? 0.65 : 0.35;
    if (age < 33) return 0;
    // Mid-30s base rates softened in the Phase 16 balance pass — the
    // 26-man was carrying only ~6-10 players aged 34+ league-wide vs
    // MLB's ~60; quality vets should stick around a bit longer.
    const base = { 33: 0.05, 34: 0.07, 35: 0.12, 36: 0.20, 37: 0.30, 38: 0.45, 39: 0.60, 40: 0.75, 41: 0.85 }[age];
    let prob = base != null ? base : 0.95;
    if (ovr < 40) prob += 0.20;        // sub-replacement performance
    else if (ovr >= 60) prob -= 0.12;  // stars hang on
    else if (ovr >= 53) prob -= 0.05;  // useful regulars get one more deal
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

  return { progressPlayer, inSeasonTick, rollRetirement, retirementProb, levelPenalty, rollCeilingBreakout };
})();
