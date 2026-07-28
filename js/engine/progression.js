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

  // ---- Skill-specific aging (0.59.0) ---------------------------------------
  // Aging has a shape: the legs go first, the eye goes last. AGE_SHIFT
  // moves a tool's internal clock — positive tools age EARLY (speed,
  // velocity start fading before the archetype peak), negative tools age
  // LATE (discipline and command keep growing past it). Early-aging
  // shifts ramp in from age 24 so a teenager's wheels never decay.
  // DECLINE_MUL scales the post-peak fade per tool: the classic aging
  // slugger loses his legs and range while the walk rate barely moves —
  // and a pitcher's velocity leaves years before his command does
  // (that's WHY the crafty-vet reinvention exists).
  const AGE_SHIFT = {
    speed: 2, defense: 1,             // legs and range go first
    discipline: -2,                   // the eye ages last
    powerVsR: -1, powerVsL: -1,       // pop holds into the 30s
    velocity: 2, stuff: 1,            // the arm goes early
    control: -2, movement: -1,        // feel and command age last
  };
  const DECLINE_MUL = {
    speed: 1.5, defense: 1.2, contactVsR: 0.9, contactVsL: 0.9,
    discipline: 0.45, bunting: 0.6,
    velocity: 1.45, stuff: 1.15, movement: 0.7, control: 0.45,
  };
  function agedAge(age, k) {
    const s = AGE_SHIFT[k] || 0;
    if (s <= 0) return age + s;
    return age + Math.min(s, Math.max(0, age - 24));
  }

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

  // Demotion response (0.61.0, the makeup layer): a young player who
  // tasted the bigs this season (5+ MLB games) but sits in the minors
  // answers the demotion by his makeup — the high-makeup pro attacks
  // the winter with something to prove, the low-makeup kid sulks and
  // loses part of the year. Data-driven, no stamps: works for options,
  // merit moves, and IL squeezes alike.
  function demotionMod(p, year) {
    if (p.status !== 'minors' || p.age > 27) return 0;
    const line = p.stats && p.stats[year];
    if (!line || (line.g || 0) < 5) return 0;
    const mk = (p.hidden && p.hidden.makeupGrade) || 5;
    if (mk >= 8) return 0.08;
    if (mk <= 3) return -0.12;
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

  // The youth ramp (0.66.0): the rise term closes a fixed fraction of
  // the ceiling gap per year, which — with no age term — made 16-19 the
  // fastest-growing years of a career (the gap is never bigger) and
  // filled the pipeline's top 10 with MLB-ready teenagers by year three
  // of a save. Real development runs the other way: the teenage years
  // are raw-tools years, and the consolidation that closes the gap
  // happens 20-24. The ramp damps the rise while the body and the
  // brain catch up; ceilings and peak ages are untouched, so the
  // DESTINATION never changes — only the arrival age (now 22-24).
  // The generational talent (0.66.0) is exempt: growing through the
  // ramp like it isn't there IS his archetype — the Soto/Harper case,
  // at most one anointed per class, a few per decade league-wide.
  const YOUTH_RAMP = { 16: 0.5, 17: 0.5, 18: 0.65, 19: 0.8, 20: 0.9 };
  function youthMul(p) {
    if (p.hidden && p.hidden.generational) return 1;
    const m = YOUTH_RAMP[p.age];
    return m != null ? m : 1;
  }

  // ---- The Cone checkpoint (§23.3-23.4) — DARK until the v2.0.0 flip -------
  // Development IS the dice: once a year the center of every talent
  // window drifts (archetype bias + work ethic + makeup + coaching +
  // noise), the window follows externally-moved centers (role shifts,
  // signing swings, injuries — no site-by-site bookkeeping), and then
  // narrows to the age schedule. The late surge (27-33, the Judge
  // clause) and its under-22 form re-open a window upward; the
  // overflow lets the kid pressed against his top punch past it.
  function coneGauss() { return (rand() + rand() + rand() + rand() - 2) / 0.577; }
  function driftCones(p, year, coachMod) {
    const CO = C.CONE;
    const h = p.hidden;
    if (!h || !h.ceiling) return;
    if (!h.cone) window.BBGM_PLAYER_GEN.mintCone(p); // lazy — also the flip-day migration
    const cone = h.cone;
    if (!cone) return;
    const arch = archetypeDef(p);
    const pack = CO.PACKS[arch.key] || {};
    const age = p.age;
    const T = CO.HALF_WIDTH;
    const hwAge = pack.early ? age + 2 : age;
    let hw = T[hwAge] != null ? T[hwAge] : (hwAge < 16 ? T[16] : T.DEFAULT);
    // §23.16 projectability: the freak's minted width multiplier keeps
    // stretching the narrowing schedule while he's a teenager, fading
    // to nothing by 20 (the FADE table) — by then he is who he is.
    if (cone.wm && CO.PROJ) {
      const F = CO.PROJ.FADE;
      const fade = F[hwAge] != null ? F[hwAge] : (hwAge < 16 ? 1 : F.DEFAULT);
      hw *= 1 + (cone.wm - 1) * fade;
    }
    const vol = (age <= 19 ? CO.VOL.teen : age <= 22 ? CO.VOL.young : CO.VOL.adult) * (pack.vol || 1);
    const lateGate = pack.late ? (age >= 22 ? 1.15 : 0.35) : 1;
    // The career die (0.53.1's lesson, relearned for §23): independent
    // per-tool dice average out of the OVERALL — a mid-board kid could
    // never dice his way to stardom nor a top-10 kid to a bust, and the
    // first soak proved it (1% mid-board stars, same as fixed destiny).
    // Most of the checkpoint's noise is ONE shared draw so the whole
    // profile rises or collapses together; the per-tool remainder keeps
    // individual tools diverging.
    const sharedDie = coneGauss() * vol * 0.85;
    const bias = ((pack.bias || 0) * lateGate) +
      ((h.workEthic || 5) - 5.5) * CO.W_WE +
      ((h.makeupGrade || 5) - 5.5) * CO.W_MAKEUP +
      (coachMod || 0) * CO.W_COACH;
    const growing = age < (h.peakAge || 28) + (arch.plateauWidth || 2);

    // The surge roll (23.4): once per career. Prime form 27-33; the
    // under-22 form absorbs the 0.57.0 generational leap's rarity.
    if (!h.surgeDone) {
      const prime = age >= 27 && age <= 33;
      const youth = age >= 18 && age <= 21;
      if (prime || youth) {
        const base = prime ? CO.SURGE.PROB : CO.SURGE.YOUTH_PROB;
        const odds = base * (1 + ((h.workEthic || 5) - 5) * 0.15 + ((h.makeupGrade || 5) - 5) * 0.10) *
          (prime && pack.late ? 3 : 1);
        if (rand() < Math.max(0, odds)) {
          // The surge is WHOLE-PROFILE (Judge didn't just add power —
          // the entire game jumped): every window re-opens upward, the
          // carrying tool most, and the drift runs hot across the board.
          let bestK = null;
          for (const k in cone.hi) if (bestK == null || h.ceiling[k] > h.ceiling[bestK]) bestK = k;
          const big = CO.SURGE.BOOST[0] + rand() * (CO.SURGE.BOOST[1] - CO.SURGE.BOOST[0]);
          const lid = arch.ceilingCap ? arch.ceilingCap + 2 : 84; // capped identities stay capped
          for (const k in cone.hi) {
            cone.hi[k] = Math.round(Math.min(lid, cone.hi[k] + (k === bestK ? big : big * 0.55)) * 10) / 10;
          }
          h.surge = { key: bestK, until: year + CO.SURGE.HOT_YEARS };
          h.surgeDone = true;
        }
      }
    }

    for (const k in cone.lo) {
      if (h.ceiling[k] == null) continue;
      let c = h.ceiling[k];
      // The window follows an externally-moved center, width preserved.
      if (c < cone.lo[k]) { const w = cone.hi[k] - cone.lo[k]; cone.lo[k] = c; cone.hi[k] = c + w; }
      else if (c > cone.hi[k]) { const w = cone.hi[k] - cone.lo[k]; cone.hi[k] = c; cone.lo[k] = c - w; }
      const surging = h.surge && h.surge.until >= year;
      if (growing || surging) {
        c += (surging ? CO.SURGE.HOT_BIAS * (h.surge.key === k ? 1 : 0.55) : bias) +
          sharedDie + coneGauss() * vol * 0.55;
        // The overflow (23.4): pressed against the top with the head to
        // earn it — the top of the scale is a promise, not a wall.
        // EXCEPT for capped identities (0.53.1 law, relearned by the
        // flip battery: overflow was busting quad-A kids past their
        // sacred cap): the identity IS the window.
        if (!arch.ceilingCap && c >= cone.hi[k] - 1 &&
            (pack.overflow || (h.workEthic || 5) >= 8) &&
            rand() < CO.OVERFLOW.PROB) {
          cone.hi[k] = Math.round(Math.min(84,
            cone.hi[k] + CO.OVERFLOW.AMOUNT[0] + rand() * (CO.OVERFLOW.AMOUNT[1] - CO.OVERFLOW.AMOUNT[0])) * 10) / 10;
        }
        c = clamp(c, cone.lo[k], cone.hi[k]);
        // Pre-peak the projection never reads below what he already is.
        if (p.ratings[k] != null && growing) c = Math.max(c, Math.min(p.ratings[k], cone.hi[k]));
        h.ceiling[k] = Math.round(c * 10) / 10;
      }
      // Narrow toward the (possibly moved) center. The lid LAGS the walk
      // (×1.3): a fast-closing top was strangling sustained up-walks
      // mid-climb — the mid-board star died at the lid, not the dice.
      const lag = hw * 1.3;
      cone.lo[k] = Math.round(Math.min(Math.max(cone.lo[k], c - lag), c) * 10) / 10;
      cone.hi[k] = Math.round(Math.max(c, Math.min(cone.hi[k], c + lag)) * 10) / 10;
    }
  }

  function progressPlayer(p, year, coachMod) {
    const arch = archetypeDef(p);
    ensureCurveState(p, arch);
    const h = p.hidden;
    const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const age = p.age;
    const coneOn = !!(C.CONE && C.CONE.ENABLED);
    if (coneOn) driftCones(p, year, coachMod);

    // Overachiever creep (0.58.0): the ceiling itself climbs toward the
    // hidden destiny, finishing around growth.doneAge — a linear share
    // of the remaining gap each winter, jittered so no two climbs read
    // identical. Climb only (Math.max guard): a breakout or leap that
    // already lifted a ceiling past destiny is never pulled back down.
    // (§23 absorbs this: under the cone the up-bias does the climbing.)
    if (!coneOn && h.growth && h.growth.dest && h.ceiling) {
      const yearsLeft = Math.max(1, (h.growth.doneAge || 26) - age);
      for (const k of keys) {
        const dest = h.growth.dest[k];
        if (dest == null || h.ceiling[k] == null) continue;
        const gap = dest - h.ceiling[k];
        if (gap <= 0) continue;
        const step = Math.max(0, (gap / yearsLeft) * (0.8 + rand() * 0.4));
        h.ceiling[k] = Math.round(Math.min(dest, h.ceiling[k] + step) * 10) / 10;
      }
    }

    // Bust decay (0.58.0): the mirror. The talent really was there, but
    // once his window opens and the progression never comes, the
    // projection dies with it — each year past the peak's front edge the
    // ceiling sinks toward what he actually is. Re-scouts watch the
    // dream fade; the card stops lying about what he'll never become.
    // (§23 absorbs this too: under the cone the bust's heavy down-bias
    // sinks the center to the window's floor — same fading dream, no
    // script.)
    if (!coneOn && arch.key === 'bust' && age >= arch.peakAge[0] && h.ceiling) {
      for (const k of keys) {
        const cur = p.ratings[k];
        if (cur == null || h.ceiling[k] == null) continue;
        const excess = h.ceiling[k] - cur;
        if (excess <= 0) continue;
        h.ceiling[k] = Math.round(Math.max(cur, h.ceiling[k] - excess * 0.18) * 10) / 10;
      }
    }
    const coach = (coachMod || 0) * (age < 27 ? 1 : 0.4);
    const posMod = 1 + workEthicMod(p) + coach - injuryMod(p, year) - levelPenalty(p) +
      demotionMod(p, year);

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

      // Each tool runs on its own clock (0.59.0): legs/velocity read a
      // couple years older than the birth certificate, the eye and the
      // command a couple younger. Frailty accel stays on real age.
      const ageK = agedAge(age, k);
      // §23.5: the bust's zero rise-rate was the old script — under the
      // cone he climbs like anyone toward a center his loaded dice keep
      // sinking, and LANDS at the bottom of an honest window.
      const rise = (coneOn && arch.key === 'bust') ? 0.22 : arch.riseRate;
      // §23.4: a surging player climbs toward his re-opened centers even
      // past the peak — the Judge winter shows up in the RATINGS.
      const surgingK = coneOn && h.surge && h.surge.until >= year;
      if (ageK < h.peakAge || surgingK) {
        change = rise * ANNUAL_SHARE * Math.max(0, devCeil - cur) * posMod * youthMul(p) *
          (surgingK && ageK >= h.peakAge ? 1.4 : 1);
        // Coach project (0.48.0): the year a coach makes this player his
        // personal project, HIS specialty attributes develop 60% faster.
        // Rise only — a project never softens decline or beats the ceiling.
        if (p.devProject && p.devProject.attrs.includes(k)) change *= 1.6;
        if (breakoutNow) change += (0.3 + rand() * 0.2) * Math.max(0, devCeil - cur);
      } else if (ageK < h.peakAge + (arch.plateauWidth || 2)) {
        change = 0; // plateau — variance only
      } else {
        const accel = age >= 35 ? 1.5 : 1;
        change = -arch.declineRate * ANNUAL_SHARE * Math.max(0, cur - RATING_FLOOR) *
          accel * (DECLINE_MUL[k] || 1);
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
    const posMod = 1 + workEthicMod(p) - levelPenalty(p) + demotionMod(p, year);

    const penRole = p.isPitcher && (p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    for (const k of keys) {
      const cur = p.ratings[k];
      if (cur == null) continue; // old-save shape missing this key
      const ceil = h.ceiling[k] != null ? h.ceiling[k] : 60;
      const devCeil = (k === 'stamina' && penRole) ? Math.min(ceil, PEN_STA_CEIL) : ceil;
      let change = 0;

      // Same per-tool clocks as the annual pass (0.59.0), and the same
      // youth ramp (0.66.0) — the in-season share slows with it too.
      const ageK = agedAge(age, k);
      if (ageK < h.peakAge) {
        change = arch.riseRate * frac * Math.max(0, devCeil - cur) * posMod * youthMul(p);
        // Coach project boost (0.48.0) — the in-season share, so the
        // project visibly moves during the year.
        if (p.devProject && p.devProject.attrs.includes(k)) change *= 1.6;
      } else if (ageK < h.peakAge + (arch.plateauWidth || 2)) {
        change = 0;
      } else {
        const accel = age >= 35 ? 1.5 : 1;
        change = -arch.declineRate * frac * Math.max(0, cur - RATING_FLOOR) *
          accel * (DECLINE_MUL[k] || 1);
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
    if (C.CONE && C.CONE.ENABLED) return null; // §23 absorbs this: drift + the overflow
    const h = p.hidden;
    if (!h || !h.ceiling) return null;
    if (h.generational) return null; // his gift is the ramp exemption (0.68.0)
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

  // ---- The generational leap (0.57.0) --------------------------------------
  // The Aaron Judge winter: an EXTREMELY rare breakout that busts through
  // the scouted ceiling entirely. It exists only when everything lines
  // up at once — a gym-rat work ethic, a growth-capable archetype (the
  // bust, quad-A, and one-year-wonder identities are sacred), a coach
  // who made him his personal project this season, the right age, and a
  // clean season of health. When it fires, every talent ceiling jumps
  // 6-12 grades (clamped only by the 82 lid — this is the ONE door past
  // the old ceiling; speed stays body-given unless it's the carrying
  // tool) and the current tools surge toward the new lids. Once per
  // career. Fully-aligned odds are slim enough that the league sees a
  // leap every few seasons — franchise-story rare.
  const LEAP_ODDS = 0.04;
  const LEAP_BLOCKED = { bust: true, quad_a: true, one_year_wonder: true };

  function rollGenerationalLeap(p, year) {
    if (C.CONE && C.CONE.ENABLED) return null; // §23.4 absorbs this: the under-22 surge
    const h = p.hidden;
    if (!h || !h.ceiling || h.leap) return null;          // once per career
    // Audit W2 (0.68.0): the anointed generational talent is EXCLUDED.
    // His floored work ethic auto-passed the gym-rat gate, 'traditional'
    // isn't in LEAP_BLOCKED, and coach projects preferentially pick his
    // huge ceiling gap — the rarest player in the game was the most
    // likely leaper, stacking to an all-82 monster. His ramp exemption
    // IS his once-in-a-generation gift; he doesn't get two.
    if (h.generational) return null;
    if (p.age < 21 || p.age > 27) return null;            // the window
    if ((h.workEthic || 5) < 8) return null;              // gym rat only
    if (LEAP_BLOCKED[h.archetype]) return null;           // identity is sacred
    if (!p.devProject) return null;                       // targeted coaching
    const hurt = (p.injuryHistory || []).some((i) => i.year === year &&
      (i.severity === 'season-ending' || i.severity === '60-day'));
    if (hurt || (h.injuryProneness || 5) >= 8) return null; // good health
    if (rand() >= LEAP_ODDS) return null;

    const allKeys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
    const best = Math.max(...allKeys.map((k) => (h.ceiling[k] != null ? h.ceiling[k] : 0)));
    const keys = allKeys.filter((k) => {
      if (h.ceiling[k] == null) return false;
      if (k === 'bunting') return false;
      if (k === 'speed') return h.ceiling.speed >= best; // body-given rule
      return true;
    });
    if (!keys.length) return null;
    const before = Math.max(...keys.map((k) => h.ceiling[k]));
    for (const k of keys) {
      h.ceiling[k] = Math.round(clamp(h.ceiling[k] + 6 + rand() * 6, HARD_MIN, 82) * 10) / 10;
      if (p.ratings[k] != null) {
        const gap = Math.max(0, h.ceiling[k] - p.ratings[k]);
        p.ratings[k] = Math.round(clamp(p.ratings[k] + gap * (0.4 + rand() * 0.2),
          HARD_MIN, h.ceiling[k]) * 10) / 10;
      }
    }
    h.leap = { year: year + 1 }; // tagged to the season he arrives changed
    const after = Math.max(...keys.map((k) => h.ceiling[k]));
    return { before: Math.round(before), after: Math.round(after) };
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

  // ---- Birthday aging (0.66.2) ---------------------------------------------
  // Ages used to bump +1 for everyone at the November rollover while the
  // card showed a real generated birthdate — so most players read a year
  // out of step with their own birth line most of the calendar. Age now
  // increments ON the birthday. The tick is a catch-up sync, not an
  // exact-day match, so any calendar jump self-heals on the next day.
  // The hash fallback below MUST stay byte-identical to the UI's bioOf
  // (player.js) — it's what keeps every previously-displayed birthdate
  // exactly where the user already saw it.
  function birthdateOf(p) {
    if (p.birthMonth != null && p.birthDay != null) return { m: p.birthMonth, d: p.birthDay };
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
    return { m: 1 + ((h >>> 8) % 12), d: 1 + ((h >>> 12) % 28) };
  }

  // Pin the birth fields so that calendar age on `today` equals p.age —
  // called at every generation site and once by the 0.66.2 migration.
  // Month/day are preserved (stored or hash); only the YEAR moves.
  function alignBirthdate(p, today) {
    const b = birthdateOf(p);
    p.birthMonth = b.m;
    p.birthDay = b.d;
    const passed = today.month > b.m || (today.month === b.m && today.day >= b.d);
    p.birthYear = today.year - p.age - (passed ? 0 : 1);
  }

  function calendarAge(p, today) {
    const b = birthdateOf(p);
    const passed = today.month > b.m || (today.month === b.m && today.day >= b.d);
    return today.year - p.birthYear - (passed ? 0 : 1);
  }

  // Daily pass (main.js simOneDay + the harness): raise age to calendar
  // age. Never lowers — a pre-alignment birthYear can only under-count.
  function birthdayTick(players, today) {
    let aged = 0;
    for (const id in players) {
      const p = players[id];
      if (!p || p.retired || p.birthYear == null) continue;
      const ca = calendarAge(p, today);
      if (ca > p.age) { p.age = ca; aged++; }
    }
    return aged;
  }

  // Audit W2 (0.68.0): the whole world ages, not just signed players.
  // Pool prospects (draft + intl classes) live outside state.players
  // until they sign and used to sit at their generation age for up to
  // eight months — a kid "signed at 16" whose card read 17 the next
  // day, and signing-day placement logic reading a stale age. The
  // offseason's calendar jumps (postseason, Part A, FA rounds, Part B)
  // call this too, so winter decisions (arbitration, farm cuts, role
  // conversions) price real ages instead of postseason-end ones.
  function birthdayTickAll(state, today) {
    let aged = birthdayTick(state.players, today);
    if (state.draft && state.draft.prospects) aged += birthdayTick(state.draft.prospects, today);
    if (state.intl && state.intl.prospects) aged += birthdayTick(state.intl.prospects, today);
    return aged;
  }

  // 0.66.1 migration helper (main.js): re-run every young career under
  // the youth ramp, BACKWARDS. The rise closes a fixed fraction of the
  // ceiling gap per year, so the correction has a closed form: today's
  // remaining gap widens by the ratio of ramped to unramped closure
  // over the SIMULATED years the kid actually lived (first stats year
  // to last completed season, only ages the ramp touches). Uses his own
  // archetype's rise rate; shared modifiers (level fit, work ethic)
  // appear in both worlds and approximately cancel in the ratio.
  // Ceilings, archetypes, and peaks untouched — he keeps his destiny
  // and re-earns the last stretch on the new curve. Downward only,
  // never above his current card, never below the hard floor. Skips:
  // 22+, retired, generational (the ramp never applied to him), busts
  // (nothing ever grew), and pool prospects with no simulated seasons
  // (their currents were generated, not grown). Kids already pinned to
  // their ceiling carry a zero gap and stay — rare, and inventing a
  // starting point would be guesswork where everything else here is
  // arithmetic.
  function rampRewind(players, currentYear) {
    let corrected = 0;
    for (const id in players) {
      const p = players[id];
      if (!p || p.retired || p.age > 21) continue;
      if (!p.hidden || !p.hidden.ceiling || p.hidden.generational) continue;
      const years = Object.keys(p.stats || {}).map(Number).filter((y) => y < currentYear);
      if (!years.length) continue;
      const entryYear = Math.min(...years);
      const arch = archetypeDef(p);
      const r = Math.min(0.45, (arch && arch.riseRate) || 0.25);
      if (r <= 0.03) continue;
      let factor = 1;
      for (let y = entryYear; y < currentYear; y++) {
        const a = p.age - (currentYear - y);
        const m = YOUTH_RAMP[a];
        if (m == null) continue;
        factor *= (1 - r * m) / (1 - r);
      }
      if (factor <= 1.001) continue;
      // Entry floor: the earliest ratingsHistory snapshot is the card he
      // showed in his first recorded season — the rewind never takes a
      // tool below where it STARTED. Without it (very old saves), the
      // hard floor is the only guard; a kid whose drags kept him from
      // growing at all (the proportional model's blind spot) would
      // otherwise over-correct below his signing level.
      const hist = p.ratingsHistory || {};
      const histYears = Object.keys(hist).map(Number);
      const firstSnap = histYears.length ? hist[Math.min(...histYears)] : null;
      const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
      let moved = false;
      for (const k of keys) {
        const cur = p.ratings[k];
        const ceil = p.hidden.ceiling[k];
        if (cur == null || ceil == null || ceil <= cur) continue;
        const floorK = Math.max(HARD_MIN,
          firstSnap && firstSnap[k] != null ? firstSnap[k] : HARD_MIN);
        const nv = Math.round(clamp(ceil - (ceil - cur) * factor, Math.min(floorK, cur), cur) * 10) / 10;
        if (nv < cur) { p.ratings[k] = nv; moved = true; }
      }
      if (moved) corrected++;
    }
    return corrected;
  }

  return { progressPlayer, inSeasonTick, rollRetirement, retirementProb, levelPenalty,
    rollCeilingBreakout, rollGenerationalLeap, rampRewind, driftCones,
    alignBirthdate, birthdayTick, birthdayTickAll, calendarAge };
})();
