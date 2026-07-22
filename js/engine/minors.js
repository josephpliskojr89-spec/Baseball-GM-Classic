// Minor league system (bible 12): annual summary stat simulation, level
// reassignment, and organizational depth backfill. All of it runs at the
// season rollover — minor league seasons are simulated as end-of-year
// summaries, not game-by-game (12.2).
window.BBGM_MINORS = (function () {
  const S = () => window.BBGM_STATS;

  function rand() { return Math.random(); }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function rnorm(mean, sd) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Level anchors: the true-rating level of an average player at each stop
  // (12.2's baselines expressed in rating points), plus noise scale — stat
  // noise is wider at lower levels (12.3: A-ball stats are less predictive
  // than AAA stats).
  const LEVELS = {
    AAA:    { anchor: 47, noise: 1.0 },
    AA:     { anchor: 42, noise: 1.25 },
    A:      { anchor: 36, noise: 1.6 },
    Rookie: { anchor: 31, noise: 2.0 },
  };

  // Generate a stat-line CHUNK for one player at a quality anchor.
  // frac = 1 is a full season; frac ≈ 1/6 is one month (0.41.0 monthly
  // lines). Rates are computed fresh from current ratings each chunk, so
  // an in-season developer's later months genuinely play better.
  function lineChunk(p, lvl, frac) {
    const r = p.ratings;
    if (!p.isPitcher) {
      const contact = (r.contactVsR + r.contactVsL) / 2;
      const power = (r.powerVsR + r.powerVsL) / 2;
      const delta = ((contact + power + r.discipline) / 3) - lvl.anchor;

      const pa = Math.round(rint(380, 560) * frac);
      const bbRate = clamp(0.080 + (r.discipline - lvl.anchor) * 0.0016 + rnorm(0, 0.008 * lvl.noise), 0.03, 0.17);
      const kRate = clamp(0.20 - (contact - lvl.anchor) * 0.002 + rnorm(0, 0.012 * lvl.noise), 0.07, 0.38);
      const avg = clamp(0.262 + delta * 0.0032 + rnorm(0, 0.016 * lvl.noise * Math.sqrt(1 / Math.max(frac, 0.05))), 0.140, 0.430);
      const hrRate = clamp(0.018 + (power - lvl.anchor) * 0.0011 + rnorm(0, 0.004 * lvl.noise), 0.001, 0.065);

      const bb = Math.round(pa * bbRate);
      const ab = pa - bb - Math.round(pa * 0.012); // walks + a few HBP/sac
      const h = Math.round(ab * avg);
      const hr = Math.min(h, Math.round(pa * hrRate));
      const b2 = Math.round((h - hr) * clamp(0.20 + (power - 45) * 0.001, 0.1, 0.3));
      const b3 = Math.round((h - hr) * clamp(0.02 + (r.speed - 50) * 0.0008, 0, 0.06));
      const k = Math.round(pa * kRate);
      const sb = Math.max(0, Math.round(((r.speed - 42) * 0.55 + rnorm(0, 3)) * frac));
      const runsish = Math.round(h * 0.42 + bb * 0.25 + hr * 0.6);
      return {
        pa, ab, h, b2, b3, hr,
        r: runsish, rbi: Math.round(h * 0.38 + hr * 1.1),
        sb, cs: Math.round(sb * 0.3), bb, k,
      };
    }
    const stuffish = (r.stuff + r.velocity) / 2;
    const delta = ((stuffish + r.control + r.movement) / 3) - lvl.anchor;
    const isSP = p.primaryPosition === 'SP';
    const ipOuts = Math.round((isSP ? rint(110, 155) : rint(48, 72)) * frac) * 3;
    const era = clamp(4.35 - delta * 0.085 + rnorm(0, 0.45 * lvl.noise * Math.sqrt(1 / Math.max(frac, 0.05))), 0.90, 9.90);
    const ip = ipOuts / 3;
    const k9 = clamp(7.2 + (stuffish - lvl.anchor) * 0.09 + rnorm(0, 0.5 * lvl.noise), 3.5, 13.5);
    const bb9 = clamp(3.6 - (r.control - lvl.anchor) * 0.055 + rnorm(0, 0.4 * lvl.noise), 1.0, 7.5);
    const er = Math.round(era * ip / 9);
    const g = isSP ? Math.round(ip / 5.3) : Math.round(rint(35, 55) * frac);
    return {
      g, gs: isSP ? g : 0,
      w: Math.max(0, Math.round(((isSP ? 9 : 4) * (5.2 - era) / 2.4 + rnorm(0, 1.5)) * frac)),
      l: Math.max(0, Math.round(((isSP ? 8 : 3) * (era - 2.8) / 2.4 + rnorm(0, 1.5)) * frac)),
      sv: (!isSP && r.stuff >= lvl.anchor + 8) ? Math.round(rint(4, 22) * frac) : 0,
      ipOuts, er,
      h: Math.round(ip * clamp(1.05 - delta * 0.012, 0.6, 1.5)),
      bb: Math.round(bb9 * ip / 9), k: Math.round(k9 * ip / 9),
      hr: Math.round(ip * clamp(0.11 - delta * 0.002, 0.02, 0.22)),
    };
  }

  // Full-season line in one shot — the pre-0.41.0 behavior, kept as the
  // rollover backfill for players who missed the monthly path (signed
  // late, migrated saves). Overwrites.
  function simSeasonLine(p, year) {
    const lvl = LEVELS[p.rosterStatus] || LEVELS.AAA;
    const season = S().ensureSeason(p, year);
    season.minorsLine = { level: p.rosterStatus, ...lineChunk(p, lvl, 1) };
  }

  // Monthly line (0.41.0): ADD one month-sized chunk into the season's
  // minorsLine (creating it on first call). `opts` overrides the anchor
  // for flavor-league players (BBGM_FLAVOR.lineOpts): the level tag then
  // reads e.g. 'NPB' on the player card instead of a farm level.
  function monthlyLine(p, year, opts = {}) {
    const season = S().ensureSeason(p, year);
    const frac = opts.frac != null ? opts.frac : 1 / 6;
    const lvl = opts.anchor != null
      ? { anchor: opts.anchor, noise: opts.noise || 1.2 }
      : (LEVELS[p.rosterStatus] || LEVELS.AAA);
    const tag = opts.league || p.rosterStatus;
    const chunk = lineChunk(p, lvl, frac);
    if (!season.minorsLine) {
      season.minorsLine = { level: tag, ...chunk };
      return;
    }
    const line = season.minorsLine;
    line.level = tag; // latest stop labels the season row
    for (const k in chunk) line[k] = (line[k] || 0) + chunk[k];
  }

  // Level placement (12.4): the band a player's talent belongs in, with
  // age floors (a 23-year-old doesn't belong in Rookie ball; a 26-year-old
  // belongs in AA+ or out of the org). This is the single source of truth
  // for the scout arrows in the minors UI, the level-fit development
  // penalty (progression.js), and AI offseason reassignment.
  //
  // Four-level ladder: Rookie (<35) → A (35-40) → AA (40-45) → AAA (45+).
  const ORDER = ['Rookie', 'A', 'AA', 'AAA'];

  // Placement isn't rigid overall-rating banding. Scouts place players by
  // how the profile projects, not the composite number:
  //  - Exceptional top-end tools play ABOVE the overall — when the
  //    foundation supports them (a 70-power bat who can also hit gets
  //    challenged early, like real life).
  //  - A profile carried by one loud tool that doesn't translate (all
  //    speed and no hit tool; all velocity and no command) plays BELOW
  //    the overall until the foundation catches up.
  // "Foundation" = the translating skills: the hit tool + plate
  // discipline for hitters, command + movement for pitchers.
  function placementRating(p) {
    const ovr = window.BBGM_ROSTER.overall(p);
    const r = p.ratings;
    let best, foundation;
    if (p.isPitcher) {
      best = Math.max(r.velocity, r.movement, r.control, r.stuff);
      foundation = (r.control + r.movement) / 2;
    } else {
      best = Math.max(r.contactVsR, r.contactVsL, r.powerVsR, r.powerVsL,
        r.discipline, r.speed, r.defense, r.arm);
      foundation = (r.contactVsR + r.contactVsL + r.discipline) / 3;
    }
    let adj = 0;
    // Exceptional tool with a real foundation: plays up.
    if (best - ovr >= 8 && foundation >= ovr - 5) {
      adj += Math.min(4, (best - ovr - 4) * 0.35);
    }
    // One loud tool, weak foundation: plays down.
    if (foundation <= ovr - 7) {
      adj -= Math.min(4, (ovr - foundation - 3) * 0.4);
    }
    return ovr + adj;
  }

  function targetLevel(p) {
    const rating = placementRating(p);
    if (rating >= 45) return 'AAA';
    if (rating >= 40) return 'AA';
    if (rating >= 35) return 'A';
    return 'Rookie';
  }

  // Youth ceiling (12.4, amended 0.17.0): nobody pitches in the upper
  // minors as a teenager, no matter how loud the tools. A prospect at his
  // age cap has levelFitDelta 0 — dominating A ball at 18 is exactly
  // where he belongs, with no "left too low" development stunt and no
  // promotion arrow. The climb takes calendar years by design.
  function maxLevelIdxForAge(age) {
    if (age <= 17) return 0;            // 17: Rookie complex only (0.28.0)
    if (age <= 18) return 1;            // A ball at most
    if (age <= 20) return 2;            // AA at most
    return ORDER.length - 1;            // 21+: no cap
  }

  function recommendedLevel(p) {
    let target = ORDER.indexOf(targetLevel(p));
    if (p.age >= 23) target = Math.max(target, 1);
    if (p.age >= 26) target = Math.max(target, 2);
    target = Math.min(target, maxLevelIdxForAge(p.age));
    return ORDER[target];
  }

  // How far a minor leaguer sits from his recommended level, in levels.
  // Positive = playing BELOW his talent (scouts recommend promotion),
  // negative = promoted past it (scouts recommend demotion), 0 = proper
  // level. Non-minors players return 0.
  function levelFitDelta(p) {
    if (p.status !== 'minors') return 0;
    const cur = ORDER.indexOf(p.rosterStatus);
    if (cur < 0) return 0;
    return ORDER.indexOf(recommendedLevel(p)) - cur;
  }

  // AI offseason reassignment: one step toward the recommended level per
  // year, two when badly misplaced (now that level fit gates development,
  // orgs don't leave a breakout bat two levels down for two winters).
  function reassignLevel(p) {
    const cur = ORDER.indexOf(p.rosterStatus);
    if (cur < 0) return;
    const target = ORDER.indexOf(recommendedLevel(p));
    const step = Math.abs(target - cur) >= 2 ? 2 : 1;
    const next = target > cur ? cur + step : (target < cur ? cur - step : cur);
    p.rosterStatus = ORDER[clamp(next, 0, ORDER.length - 1)];
  }

  return { simSeasonLine, monthlyLine, reassignLevel, targetLevel, recommendedLevel, levelFitDelta, placementRating, maxLevelIdxForAge, LEVELS, ORDER };
})();
