// Injury system per bible 10. Provides:
//   - injury type catalog (hitters / pitchers)
//   - severity tier roll (day-to-day / 10-day / 15-day / 60-day / season-end)
//   - per-game / per-appearance roll probabilities tuned to bible 10.7 rates
//   - in-place mutators to put a player on IL and to advance daily recovery
//
// The engine wires per-game rolls inside simulation.js; daily recovery and
// auto-substitution live in main.js's simOneDay loop. IL management UI is
// stage 4.
window.BBGM_INJURIES = (function () {
  // ---- Type catalogs (bible 10.4) ----
  // Some types are constrained to particular severity buckets — e.g. UCL
  // tears are always season-ending (Tommy John), blisters are always
  // day-to-day. Most types span the standard 5-tier distribution.
  const HITTER_TYPES = [
    { name: 'Hamstring strain' },
    { name: 'Quad strain' },
    { name: 'Oblique strain' },
    { name: 'Wrist injury' },
    { name: 'Shoulder issue' },
    { name: 'Concussion' },
    { name: 'Knee injury' },
    { name: 'Back injury' },
    { name: 'Hand/finger injury' },
  ];
  const PITCHER_TYPES = [
    { name: 'Shoulder inflammation' },
    { name: 'Elbow inflammation' },
    { name: 'UCL tear', fixedSeverity: 'season-ending', daysOverride: [365, 540] }, // Tommy John
    { name: 'Forearm strain' },
    { name: 'Lat strain' },
    { name: 'Oblique strain' },
    { name: 'Blister', fixedSeverity: 'day-to-day' },
    { name: 'Back injury' },
  ];

  // ---- Severity tiers (bible 10.3) ----
  // Weights are the share OF AN INJURY, not the share of all PAs.
  const SEVERITY = [
    { kind: 'day-to-day',    weight: 50, daysRange: [1, 3],   ilType: null     },
    { kind: '10-day',        weight: 25, daysRange: [10, 15], ilType: '10-day' },
    { kind: '15-day',        weight: 10, daysRange: [15, 21], ilType: '15-day' }, // pitchers only
    { kind: '60-day',        weight: 12, daysRange: [60, 90], ilType: '60-day' },
    { kind: 'season-ending', weight:  3, daysRange: [120, 365], ilType: '60-day' },
  ];
  // Career-altering injuries land on top of severe (60-day or season-ending)
  // stints. Bible 10.3 reads "~0.5% of severe injuries" but 10.7 wants 3-8
  // per season — and a season typically produces ~75 severe stints. 5%
  // hits the 10.7 target (3-4 per season); 10.3's number is the discarded
  // simpler version.
  const CAREER_ALTERING_RATE = 0.05;

  // ---- Per-event injury probabilities ----
  // Bible 10.1 targets ~20% of pitchers and ~15% of position players with
  // at least one IL stint per year.
  //
  // For a position player getting ~600 PAs: 1 - (1 - p)^600 = 0.15 gives
  // a per-PA probability around 0.00027. We exclude day-to-day from this
  // calculation since DTD doesn't go on IL; day-to-day adds ~50% on top.
  //
  // For a pitcher: appearances vary (SP ~30, RP ~60). We use a per-BF rate
  // and let workload do the rest. Pitcher rolls happen on the pitcher's
  // line, position-player rolls on the batter's line.
  // Hitter rate calibrated to ~15% season IL incidence at 600 PA.
  // Pitcher rate scaled for the mix of SP (~600 BF) and RP (~200 BF) to
  // land around 20% IL incidence per the bible target.
  const BASE_PA_INJURY_PROB     = 0.00055; // position players (per PA)
  const BASE_PITCH_INJURY_PROB  = 0.00068; // pitchers (per batter faced)

  // Injury-proneness multiplier (1-10, default ~5 → 1.0x). Bible 10.2.
  function pronenessMul(proneness) {
    if (!proneness || proneness < 1) return 1;
    if (proneness <= 5) return 0.5 + (proneness - 1) * 0.125;   // 1→0.5x, 5→1.0x
    return 1 + (proneness - 5) * 0.3;                            // 6→1.3, 10→2.5
  }

  // ---- Public: roll an injury for one event (PA for a hitter, BF for a
  // pitcher). Returns null when no injury occurs.
  function rollForHitter(rng, batter) {
    const proneness = batter.hidden && batter.hidden.injuryProneness;
    const p = BASE_PA_INJURY_PROB * pronenessMul(proneness);
    if (rng() >= p) return null;
    return buildInjury(rng, batter, /* isPitcherInjury */ false);
  }

  function rollForPitcher(rng, pitcher) {
    const proneness = pitcher.hidden && pitcher.hidden.injuryProneness;
    const p = BASE_PITCH_INJURY_PROB * pronenessMul(proneness);
    if (rng() >= p) return null;
    return buildInjury(rng, pitcher, /* isPitcherInjury */ true);
  }

  function buildInjury(rng, player, isPitcherInjury) {
    const catalog = isPitcherInjury ? PITCHER_TYPES : HITTER_TYPES;
    const type = catalog[Math.floor(rng() * catalog.length)];

    // Severity: type-constrained or weighted distribution. Pitcher-only
    // 15-day rolls become 10-day when picked for a hitter.
    let sev;
    if (type.fixedSeverity) {
      sev = SEVERITY.find((s) => s.kind === type.fixedSeverity);
    } else {
      sev = pickSeverity(rng, isPitcherInjury);
    }

    const days = type.daysOverride
      ? randInt(rng, type.daysOverride[0], type.daysOverride[1])
      : randInt(rng, sev.daysRange[0], sev.daysRange[1]);

    // Career-altering: small chance on severe injuries to also cut the
    // player's hidden ceiling (Tommy John ⇒ -velocity, knee ⇒ -speed, etc.)
    const careerAltering = (sev.kind === '60-day' || sev.kind === 'season-ending')
      && rng() < CAREER_ALTERING_RATE;

    return {
      type: type.name,
      severity: sev.kind,
      ilType: sev.ilType,             // null for day-to-day
      daysOut: days,
      year: player.birthYear ? null : null, // filled by caller with currentDate
      careerAltering,
    };
  }

  function pickSeverity(rng, isPitcherInjury) {
    // Drop the 15-day bucket for hitters by redistributing its weight to
    // the 10-day bucket.
    const tiers = SEVERITY.filter((s) => isPitcherInjury || s.kind !== '15-day');
    const adjusted = tiers.map((s) => {
      if (!isPitcherInjury && s.kind === '10-day') return { ...s, weight: s.weight + 10 };
      return s;
    });
    const total = adjusted.reduce((acc, s) => acc + s.weight, 0);
    let r = rng() * total;
    for (const s of adjusted) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return adjusted[adjusted.length - 1];
  }

  function randInt(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  // ---- Public: place a player on the disabled list ----
  // Mutates the player object only. Roster-level swaps (substituting a
  // minors player onto the 26-man) live in main.js so they can route
  // through team validation.
  function placeOnIL(player, injury, currentDate) {
    const entry = {
      ...injury,
      year: currentDate.year,
      startDate: { ...currentDate },
    };
    player.currentInjury = entry;
    player.ilStatus = injury.ilType
      ? { type: injury.ilType, daysRemaining: injury.daysOut }
      : null;
    player.dayToDayDaysRemaining = injury.ilType ? 0 : injury.daysOut;
    if (!Array.isArray(player.injuryHistory)) player.injuryHistory = [];
    player.injuryHistory.push(entry);
  }

  // Advance one day of recovery on a player. Returns true if the player
  // came off IL on this day, false otherwise.
  function tickRecovery(player) {
    if (player.dayToDayDaysRemaining && player.dayToDayDaysRemaining > 0) {
      player.dayToDayDaysRemaining--;
      if (player.dayToDayDaysRemaining <= 0) {
        player.dayToDayDaysRemaining = 0;
        player.currentInjury = null;
        return true;
      }
      return false;
    }
    if (player.ilStatus && player.ilStatus.daysRemaining > 0) {
      player.ilStatus.daysRemaining--;
      if (player.ilStatus.daysRemaining <= 0) {
        player.ilStatus = null;
        player.currentInjury = null;
        return true;
      }
    }
    return false;
  }

  function isAvailable(player) {
    if (!player) return false;
    if (player.dayToDayDaysRemaining && player.dayToDayDaysRemaining > 0) return false;
    if (player.ilStatus && player.ilStatus.daysRemaining > 0) return false;
    return true;
  }

  function isOnIL(player) {
    return !!(player && player.ilStatus && player.ilStatus.daysRemaining > 0);
  }

  return {
    rollForHitter, rollForPitcher,
    placeOnIL, tickRecovery,
    isAvailable, isOnIL,
    // exposed for tests / debug
    pronenessMul, SEVERITY, HITTER_TYPES, PITCHER_TYPES,
  };
})();
