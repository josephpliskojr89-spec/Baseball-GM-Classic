// Position-player fatigue per bible 10.8.
//
// Design intent (10.8): create natural rest pressure, bench usage, and
// injury risk WITHOUT turning the game into daily micromanagement. The
// engine handles routine fatigue in the background; the only thing the
// user ever sees is a soft "rest recommended" notification when a player
// crosses the very-high threshold.
//
// Pitchers have their own per-pitch decay model in 7.4 / simulation.js and
// are completely outside this module's scope.
window.BBGM_FATIGUE = (function () {
  // 0-100 scale. Anchors:
  //   < 30  fresh — no impact
  //   30-49 light  — no impact
  //   50-79 moderate — small performance penalty on the at-bat math
  //   80-89 high — injury-rate multiplier ramps; perf penalty grows
  //   90+   critical — rest-recommended notification surfaces
  const MAX = 100;
  const MODERATE = 50;
  const HIGH = 80;
  const VERY_HIGH = 90;

  // Per-game accumulation. The schedule density is ~0.88 games/day, so
  // per-week net is computed against ~6.16 game days + 0.84 off days.
  // Calibration target (bible 10.8 spirit):
  //   non-catcher starter: median season peak MODERATE; some reach HIGH
  //   catcher: median season peak HIGH; some reach CRITICAL
  //   <27 starter: rarely above MODERATE
  //   33+ starter: noticeably more tired (age factor on recovery)
  const STARTER_ACCUM  = 3;
  const CATCHER_ACCUM  = 4;
  const BENCH_ACCUM    = 1;

  // Two-tier recovery: game days get a partial overnight bump (you sleep
  // between games), off days recover at the full rate.
  const REC_OFF_DAY  = 9;
  const REC_GAME_DAY = 3;

  function accumulateForGame(player, position, isStarter) {
    if (!player || player.isPitcher) return;
    if (!isStarter) {
      player.fatigue = Math.min(MAX, (player.fatigue || 0) + BENCH_ACCUM);
      return;
    }
    const add = position === 'C' ? CATCHER_ACCUM : STARTER_ACCUM;
    player.fatigue = Math.min(MAX, (player.fatigue || 0) + add);
  }

  // Full-day recovery — applied when the player had no game appearance.
  function recover(player) {
    applyRecovery(player, REC_OFF_DAY);
  }
  // Partial overnight recovery — applied on game days so cumulative fatigue
  // doesn't saturate the 100 cap by mid-May.
  function partialRecover(player) {
    applyRecovery(player, REC_GAME_DAY);
  }

  function applyRecovery(player, amount) {
    if (!player || player.isPitcher) return;
    if (!player.fatigue) return;
    const age = player.age || 28;
    // Linear age penalty: 1.0x at ≤25, drops 0.035 per year above. Floor
    // 0.55 so even a 38-year-old recovers (slowly).
    const ageFactor = Math.max(0.55, 1 - Math.max(0, age - 25) * 0.035);
    // Newton's-cooling-style fatigue scale: the more fatigued a player is,
    // the more he recovers per day. A linear-rate model would either keep
    // every starter fresh (recovery > accumulation) or saturate every
    // starter at MAX (accumulation > recovery) — there's no equilibrium
    // band in between. With this scale, accumulation and recovery balance
    // at a player-specific equilibrium fatigue level, so most starters
    // settle at a believable mid-season value rather than slamming into
    // 0 or 100.
    const fatigueScale = (player.fatigue / MAX) * 0.5 + 0.5;
    player.fatigue = Math.max(0, player.fatigue - amount * ageFactor * fatigueScale);
  }

  // Subtract from effective contact / power in the at-bat math. Linear
  // ramp 0 → 6 points across the MODERATE → MAX range. A hitter sitting
  // at 80 loses ~3.6 points off both tools — noticeable but not crippling.
  function performancePenalty(player) {
    const f = player.fatigue || 0;
    if (f <= MODERATE) return 0;
    return ((f - MODERATE) / (MAX - MODERATE)) * 6;
  }

  // Multiplier applied to the position-player per-PA injury probability.
  // Per bible 10.8: MODERATE fatigue produces performance penalty,
  // HIGH fatigue meaningfully raises injury risk. So the ramp starts at
  // HIGH, not MODERATE: 1.0x below HIGH, climbing linearly to ~2.5x at MAX.
  // Injury-prone hitters (proneness ≥ 7) get an extra +50% on top — those
  // are the players who really shouldn't be playing tired.
  function injuryMultiplier(player) {
    const f = player.fatigue || 0;
    if (f <= HIGH) return 1;
    let mul = 1 + ((f - HIGH) / (MAX - HIGH)) * 1.5;
    const proneness = player.hidden && player.hidden.injuryProneness;
    if (proneness && proneness >= 7) mul *= 1.5;
    return mul;
  }

  function isVeryHigh(player) { return (player.fatigue || 0) >= VERY_HIGH; }
  function isHigh(player)     { return (player.fatigue || 0) >= HIGH; }
  function isModerate(player) { return (player.fatigue || 0) >= MODERATE; }

  function level(player) {
    const f = player.fatigue || 0;
    if (f >= VERY_HIGH) return 'critical';
    if (f >= HIGH)      return 'high';
    if (f >= MODERATE)  return 'moderate';
    return 'fresh';
  }

  return {
    MAX, MODERATE, HIGH, VERY_HIGH,
    accumulateForGame, recover, partialRecover,
    performancePenalty, injuryMultiplier,
    isVeryHigh, isHigh, isModerate, level,
  };
})();
