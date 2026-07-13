// Player generation. Builds a complete league population with realistic
// distributions per the bible 6.2-6.4.
window.BBGM_PLAYER_GEN = (function () {
  const { rint, rfloat, pick, pickWeighted, shuffle, rnormal, clamp } = window.BBGM_RNG;
  const C = window.BBGM_CONSTANTS;

  let _id = 0;
  function nextId() { _id++; return `p${_id}`; }

  // Roster slot template.
  // Each team needs:
  //  - 2 catchers
  //  - 1 1B, 1 2B, 1 3B, 1 SS  (4 IF starters)
  //  - 3 OF (LF, CF, RF starters)
  //  - 1 DH (in DH leagues; we generate it for all teams as bench/DH-eligible)
  //  - 3 bench position players (UT, backup C handled, etc.)
  //  - 5 SP
  //  - 7 RP
  //  - 1 CP

  const ROSTER_SLOTS = [
    { pos: 'C', count: 2 },
    { pos: '1B', count: 1 },
    { pos: '2B', count: 1 },
    { pos: '3B', count: 1 },
    { pos: 'SS', count: 1 },
    { pos: 'LF', count: 1 },
    { pos: 'CF', count: 1 },
    { pos: 'RF', count: 1 },
    { pos: 'DH', count: 1 },
    { pos: 'UT', count: 2 },
    { pos: 'OF', count: 1 },
    { pos: 'SP', count: 5 },
    { pos: 'RP', count: 7 },
    { pos: 'CP', count: 1 },
  ];

  function generate(rng, league, options = {}) {
    _id = 0;
    const players = {};

    // Generate active 26-man rosters first.
    for (const team of league.teams) {
      generateActiveRoster(rng, team, players);
    }

    // Generate 40-man fillers (14 per team) — generally AAA-level callups
    for (const team of league.teams) {
      generateFortyManFiller(rng, team, players);
    }

    // Generate minor league depth
    for (const team of league.teams) {
      generateMinors(rng, team, players);
    }

    // Build lineups, rotation, bullpen
    for (const team of league.teams) {
      assignLineupsAndPitching(rng, team, players);
    }

    return players;
  }

  function generateActiveRoster(rng, team, players) {
    for (const slot of ROSTER_SLOTS) {
      for (let i = 0; i < slot.count; i++) {
        const tier = rosterTalentTier(rng);
        const player = makePlayer(rng, {
          slotPos: slot.pos,
          team,
          tier,
          ageRange: ageForSlot(slot.pos, tier),
          status: 'active',
          rosterStatus: '26-man',
        });
        players[player.id] = player;
        team.roster.push(player.id);
      }
    }
  }

  function generateFortyManFiller(rng, team, players) {
    // 14 additional 40-man rostered players: AAA depth, mostly ~45 ratings.
    for (let i = 0; i < 14; i++) {
      const isPitcher = rng() < 0.55;
      const slotPos = isPitcher ? (rng() < 0.6 ? 'SP' : 'RP') : pick(rng, ['UT', '1B', '2B', '3B', 'SS', 'OF', 'C']);
      const player = makePlayer(rng, {
        slotPos,
        team,
        tier: 'depth',
        ageRange: { min: 22, max: 30 },
        status: 'minors',
        rosterStatus: 'AAA',
      });
      players[player.id] = player;
      team.roster40.push(player.id);
      team.minors.push(player.id);
    }
  }

  function generateMinors(rng, team, players) {
    // ~30 minor leaguers total (we already added 14 AAA via 40-man filler;
    // add ~16 more spread across AA/A+/A/Rookie).
    const distribution = [
      { level: 'AA', count: 6 },
      { level: 'A', count: 7 },
      { level: 'Rookie', count: 3 },
    ];
    for (const d of distribution) {
      for (let i = 0; i < d.count; i++) {
        const isPitcher = rng() < 0.45;
        const slotPos = isPitcher ? (rng() < 0.7 ? 'SP' : 'RP') : pick(rng, ['UT', '1B', '2B', '3B', 'SS', 'OF', 'C']);
        const ageRange = ageForLevel(d.level);
        const player = makePlayer(rng, {
          slotPos,
          team,
          tier: 'prospect',
          ageRange,
          status: 'minors',
          rosterStatus: d.level,
          isProspect: true,
        });
        players[player.id] = player;
        team.minors.push(player.id);
      }
    }
  }

  function rosterTalentTier(rng) {
    // 60 stars across league of 30 teams (2/team). Occasional 3-star, occasional 1-star.
    // Per bible 4.3 / 6.4.
    const r = rng();
    if (r < 0.06) return 'star'; // ~2 per team
    if (r < 0.30) return 'plus'; // 7-8 per team above-average regulars
    if (r < 0.85) return 'avg';
    return 'fringe';
  }

  function ageForSlot(slotPos, tier) {
    // MLB roster: avg age 28, range 21-40
    let mean = 28, stdev = 4;
    if (tier === 'star') { mean = 29; stdev = 3; }
    if (tier === 'fringe') { mean = 30; stdev = 5; }
    if (slotPos === 'CP') { mean = 30; stdev = 4; }
    return { mean, stdev, min: 21, max: 40 };
  }

  // Age bands per level honor the youth ceiling (12.4 / minors.js
  // maxLevelIdxForAge): teenagers don't populate the upper minors.
  function ageForLevel(level) {
    switch (level) {
      case 'AAA': return { mean: 26, stdev: 2.5, min: 21, max: 35 };
      case 'AA': return { mean: 23, stdev: 1.5, min: 19, max: 28 };
      case 'A': return { mean: 20.5, stdev: 1.3, min: 17, max: 24 };
      case 'Rookie': return { mean: 18, stdev: 1.0, min: 16, max: 21 };
    }
    return { mean: 23, stdev: 2, min: 18, max: 30 };
  }

  function makePlayer(rng, opts) {
    const { slotPos, team, tier, ageRange, status, rosterStatus, isProspect } = opts;
    // Post-launch generation (offseason backfill) passes an explicit id —
    // the module counter resets on reload and would collide with saved ids.
    const id = opts.id || nextId();

    // Identity
    const firstName = pick(rng, window.BBGM_NAMES.firstNames);
    const lastName = pick(rng, window.BBGM_NAMES.lastNames);

    // Age
    let age;
    if (ageRange.mean !== undefined) {
      age = clamp(Math.round(rnormal(rng, ageRange.mean, ageRange.stdev)), ageRange.min, ageRange.max);
    } else {
      age = rint(rng, ageRange.min, ageRange.max);
    }

    // Position resolution
    const { primaryPosition, secondaryPositions, isPitcher } = resolvePositions(rng, slotPos);

    // Ratings
    const { ratings, ceiling, archetype } = generateRatings(rng, { primaryPosition, isPitcher, age, tier, isProspect });

    // Bats / throws
    const throws = isPitcher ? (rng() < 0.28 ? 'L' : 'R') : (rng() < 0.18 ? 'L' : 'R');
    let bats = 'R';
    if (!isPitcher) {
      const r = rng();
      if (r < 0.32) bats = 'L';
      else if (r < 0.42) bats = 'S';
    } else {
      bats = throws; // pitchers usually bat handedness of throw
    }

    // Service time — seeded from roster context, not raw age. Only active
    // 26-man players carry real MLB service; a 28-year-old AAA depth arm
    // has little or none (the old flat `age - 22` formula made half the
    // minors FA-eligible the moment free agency reads serviceTime).
    let serviceYears;
    if (status === 'active') {
      const debutAge = rint(rng, 22, 27);
      serviceYears = clamp(age - debutAge, 0, 18);
    } else if (rosterStatus === 'AAA') {
      // AAA filler: mostly no service; some have a cup of coffee or a
      // couple of part-time years behind them.
      serviceYears = rng() < 0.6 ? 0 : Math.min(rint(rng, 1, 3), Math.max(0, age - 24));
    } else {
      serviceYears = 0; // true prospects haven't debuted
    }
    const contract = generateContract(rng, age, tier, ratings, isPitcher, serviceYears);

    // Hidden values
    const hidden = {
      ceiling,
      archetype,
      injuryProneness: rint(rng, 1, 10),
      workEthic: rint(rng, 1, 10),
      makeupGrade: rint(rng, 1, 10),
      // Durability: feeds fatigue recovery and rest scheduling. A 10 with
      // sturdy health is the rare "iron man" who plays every day (10.8).
      durability: rint(rng, 1, 10),
    };

    // Bio (profile card): height/weight by role, full birthdate.
    const heightBase = isPitcher ? 75 : (primaryPosition === 'C' ? 73 : ['2B', 'SS'].includes(primaryPosition) ? 71.5 : 73.5);
    const heightIn = clamp(Math.round(rnormal(rng, heightBase, 1.8)), 68, 80);
    // ~197 lb at 6'0", ~+6 lb per inch (matches the modern MLB roster page).
    const weightLb = clamp(Math.round((heightIn - 60) * 6 + 125 + rnormal(rng, 0, 12)), 165, 270);

    return {
      id,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      birthYear: C.START_YEAR - age,
      birthMonth: rint(rng, 1, 12),
      birthDay: rint(rng, 1, 28),
      heightIn,
      weightLb,
      age,
      bats,
      throws,
      primaryPosition,
      secondaryPositions,
      isPitcher,
      status,
      teamId: team.id,
      rosterStatus,
      jersey: rint(rng, 1, 99),
      ratings,
      hidden,
      contract,
      serviceTime: { years: serviceYears, days: rint(rng, 0, 170) },
      stats: {},
      careerStats: emptyCareerStats(isPitcher),
      achievements: { awards: [], allStarSelections: [], championships: [], milestones: [] },
      injuryHistory: [],
    };
  }

  function resolvePositions(rng, slotPos) {
    let primaryPosition = slotPos;
    let secondaryPositions = [];
    let isPitcher = false;

    switch (slotPos) {
      case 'SP': isPitcher = true; primaryPosition = 'SP'; break;
      case 'RP': isPitcher = true; primaryPosition = 'RP'; break;
      case 'CP': isPitcher = true; primaryPosition = 'CP'; break;
      case 'C':
        primaryPosition = 'C';
        if (rng() < 0.15) secondaryPositions = ['1B'];
        break;
      case '1B':
        primaryPosition = '1B';
        if (rng() < 0.25) secondaryPositions = ['DH'];
        else if (rng() < 0.15) secondaryPositions = ['3B'];
        break;
      case '2B':
        primaryPosition = '2B';
        if (rng() < 0.4) secondaryPositions = ['SS'];
        else if (rng() < 0.4) secondaryPositions = ['3B'];
        break;
      case '3B':
        primaryPosition = '3B';
        if (rng() < 0.3) secondaryPositions = ['1B'];
        else if (rng() < 0.3) secondaryPositions = ['2B'];
        break;
      case 'SS':
        primaryPosition = 'SS';
        if (rng() < 0.5) secondaryPositions = ['2B'];
        else if (rng() < 0.4) secondaryPositions = ['3B'];
        break;
      case 'LF':
        primaryPosition = 'LF';
        secondaryPositions = rng() < 0.5 ? ['RF'] : (rng() < 0.4 ? ['CF'] : []);
        break;
      case 'CF':
        primaryPosition = 'CF';
        secondaryPositions = ['LF', 'RF'];
        break;
      case 'RF':
        primaryPosition = 'RF';
        secondaryPositions = rng() < 0.5 ? ['LF'] : (rng() < 0.4 ? ['CF'] : []);
        break;
      case 'DH':
        primaryPosition = '1B';
        secondaryPositions = ['DH'];
        break;
      case 'OF':
        primaryPosition = pick(rng, ['LF', 'CF', 'RF']);
        secondaryPositions = ['LF', 'RF'].filter((p) => p !== primaryPosition);
        break;
      case 'UT':
        primaryPosition = pick(rng, ['2B', '3B', 'SS']);
        secondaryPositions = shuffle(rng, ['2B', '3B', 'SS', 'LF']).filter((p) => p !== primaryPosition).slice(0, 2);
        break;
      default:
        primaryPosition = slotPos;
    }
    return { primaryPosition, secondaryPositions, isPitcher };
  }

  function generateRatings(rng, opts) {
    const { primaryPosition, isPitcher, age, tier, isProspect } = opts;

    // Determine ceiling envelope by tier.
    const ceilingMean = ({
      star: 70, plus: 60, avg: 52, depth: 47, prospect: 55, fringe: 44,
    })[tier] || 50;
    const ceilingStdev = 4;

    // Build per-rating ceiling
    const ratingKeys = isPitcher
      ? ['stamina', 'velocity', 'movement', 'control', 'stuff']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'bunting', 'defense', 'arm'];

    const ceiling = {};
    for (const k of ratingKeys) {
      let c = clamp(rnormal(rng, ceilingMean, ceilingStdev), 30, 80);
      // Position-specific adjustments
      if (!isPitcher) {
        c = positionAdjust(rng, primaryPosition, k, c);
      } else {
        c = pitcherRoleAdjust(rng, primaryPosition, k, c);
      }
      ceiling[k] = Math.round(c * 10) / 10;
    }

    // Speed is a body trait, not a talent-tier trait (Phase 16 balance):
    // drawing it from the shared tier mean made every star a plus runner
    // (+0.6 speed-power correlation, fifteen 30/30 seasons a year).
    // Redraw it independent of the tier — position-shaped — and
    // anti-correlate with power; a rare true freak (~7%) keeps both.
    if (!isPitcher) {
      let spd = positionAdjust(rng, primaryPosition, 'speed',
        clamp(rnormal(rng, 51, 9), 28, 80));
      const powC = (ceiling.powerVsR + ceiling.powerVsL) / 2;
      if (rng() > 0.06) spd -= Math.max(0, (powC - 52) * 0.35);
      ceiling.speed = Math.round(clamp(spd, 25, 80) * 10) / 10;
    }

    // Pick archetype
    const archDefs = isPitcher ? C.PITCHER_ARCHETYPES : C.HITTER_ARCHETYPES;
    const archetype = pickWeighted(rng, archDefs, (a) => a.weight).key;
    const archDef = archDefs.find((a) => a.key === archetype);

    // Quad-A cap. Stamina is exempt for pitchers — Quad-A is a talent cap
    // (MLB-quality stuff never materializes), not a workload cap. Capping
    // stamina at 50 silently turned Quad-A rotation starters into swingmen
    // under the 7.4 tier table.
    if (archDef.ceilingCap) {
      for (const k of ratingKeys) {
        if (isPitcher && k === 'stamina') continue;
        ceiling[k] = Math.min(ceiling[k], archDef.ceilingCap);
      }
    }

    // Current ratings: closer to ceiling for older players.
    const peakAge = (archDef.peakAge[0] + archDef.peakAge[1]) / 2;
    let progressFraction;
    if (age >= peakAge) {
      // post-peak - decline some
      progressFraction = 1 - clamp((age - peakAge) * archDef.declineRate * 0.5, 0, 0.4);
    } else {
      // pre-peak: progress fraction based on closeness to peak
      const startAge = isPitcher ? 22 : 21;
      const span = peakAge - startAge;
      progressFraction = clamp((age - startAge) / span, 0.3, 1.0);
      // Adjust for prospects to be more raw
      if (isProspect) progressFraction *= 0.7;
    }

    const ratings = {};
    for (const k of ratingKeys) {
      // Floor of ceiling - 25 (or min 25). Stamina for starters uses a much
      // tighter floor (ceiling - 10): endurance is built up early in a
      // career rather than talent-gated, so a rotation SP's current stamina
      // sits near his ceiling even when his stuff is still developing.
      const floor = (isPitcher && k === 'stamina' && primaryPosition === 'SP')
        ? clamp(ceiling[k] - 8, 48, 72)
        : clamp(ceiling[k] - 25, 25, 60);
      const cur = floor + (ceiling[k] - floor) * progressFraction + rnormal(rng, 0, 2);
      ratings[k] = clamp(Math.round(cur * 10) / 10, 20, 80);
    }

    return { ratings, ceiling, archetype };
  }

  function positionAdjust(rng, pos, ratingKey, c) {
    // Tweak ceilings by position scarcity (per bible 6.4)
    const isCorner = pos === '1B' || pos === 'LF' || pos === 'RF' || pos === 'DH';
    const isMiddle = pos === '2B' || pos === 'SS' || pos === 'CF';
    const isCatcher = pos === 'C';
    if (ratingKey.startsWith('power')) {
      if (isCorner) c += rnormal(rng, 4, 1.5);
      if (isMiddle) c -= rnormal(rng, 3, 1.5);
      if (isCatcher) c -= rnormal(rng, 2, 1);
    }
    if (ratingKey === 'speed') {
      if (isMiddle) c += rnormal(rng, 4, 1.5);
      if (isCorner) c -= rnormal(rng, 3, 1.5);
      if (isCatcher) c -= rnormal(rng, 8, 1);
    }
    if (ratingKey === 'defense') {
      if (pos === 'SS') c += rnormal(rng, 5, 1.5);
      if (pos === 'CF') c += rnormal(rng, 4, 1.5);
      if (pos === 'C') c += rnormal(rng, 4, 1.5);
      if (pos === '1B' || pos === 'LF') c -= rnormal(rng, 2, 1.5);
    }
    if (ratingKey === 'arm') {
      if (pos === 'C') c += rnormal(rng, 5, 1.5);
      if (pos === 'RF') c += rnormal(rng, 3, 1.5);
      if (pos === 'SS' || pos === '3B') c += rnormal(rng, 2, 1);
    }
    if (ratingKey.startsWith('contact')) {
      if (isCatcher) c -= rnormal(rng, 2, 1);
    }
    if (ratingKey === 'bunting') {
      // Most modern players have low bunting (per bible 5.3)
      c -= rnormal(rng, 8, 4);
    }
    return clamp(c, 25, 80);
  }

  function pitcherRoleAdjust(rng, role, ratingKey, c) {
    if (ratingKey === 'stamina') {
      // Per bible 5.4: stamina drives whether a pitcher can start, work
      // multiple innings in relief, or only get an inning. Hard caps for
      // bullpen roles prevent generation from rolling SP-grade stamina on
      // a guy who's never going to start.
      if (role === 'SP') {
        // Rotation starters live in the 55-65 stamina band per bible 7.4.1
        // ("most normal starters live here"); below ~55 the tier table
        // correctly treats an arm as a swingman with 60-80 pitch limits,
        // which is wrong for a rotation regular. Floor the ceiling at 56.
        c += rnormal(rng, 8, 2);
        c = Math.max(c, 58);
      }
      if (role === 'RP') {
        c -= rnormal(rng, 8, 3);
        c = Math.min(c, 55); // RPs cap below the "starter capable" threshold
      }
      if (role === 'CP') {
        c -= rnormal(rng, 12, 3);
        c = Math.min(c, 50); // closers are emphatically one-inning arms
      }
    }
    if (ratingKey === 'velocity') {
      if (role === 'CP') c += rnormal(rng, 4, 1.5);
      if (role === 'RP') c += rnormal(rng, 2, 1.5);
    }
    if (ratingKey === 'stuff') {
      if (role === 'CP') c += rnormal(rng, 4, 1.5);
    }
    return clamp(c, 25, 80);
  }

  function generateContract(rng, age, tier, ratings, isPitcher, serviceYears) {
    // Simplified: minimum league salary = 0.74M; FA contracts based on tier and service
    const minSalary = 0.74; // millions
    if (serviceYears < 3) {
      return {
        years: 1,
        annualSalary: minSalary,
        totalValue: minSalary,
        signedAt: 'rookie',
      };
    }
    let baseAAV = 4;
    if (tier === 'star') baseAAV = 28;
    else if (tier === 'plus') baseAAV = 14;
    else if (tier === 'avg') baseAAV = 6;
    else if (tier === 'depth') baseAAV = 1.2;
    else baseAAV = 0.9;

    // Age effect
    if (age >= 35) baseAAV *= 0.7;
    if (age >= 38) baseAAV *= 0.5;

    const yearsLeft = clamp(rint(rng, 1, 6), 1, age >= 33 ? 2 : 6);
    const aav = Math.round(baseAAV * (0.85 + rng() * 0.3) * 10) / 10;
    return {
      years: yearsLeft,
      annualSalary: aav,
      totalValue: Math.round(aav * yearsLeft * 10) / 10,
      signedAt: serviceYears >= 6 ? 'FA' : 'extension',
    };
  }

  function emptyCareerStats(isPitcher) {
    if (isPitcher) {
      return { g: 0, gs: 0, w: 0, l: 0, sv: 0, hld: 0, ip: 0, h: 0, r: 0, er: 0, hr: 0, bb: 0, k: 0, bf: 0 };
    }
    return { g: 0, ab: 0, pa: 0, h: 0, b2: 0, b3: 0, hr: 0, r: 0, rbi: 0, sb: 0, cs: 0, bb: 0, k: 0, hbp: 0, sf: 0, sh: 0 };
  }

  // opts.lineupStyle (1-10, bible 17.2): ≤3 old-school ordering (speed at
  // the top, sluggers 3-4-5), ≥7 modern (best OPS bats stacked at the top),
  // middle = a soft blend. Defaults to modern (the pre-Phase-10 behavior).
  function assignLineupsAndPitching(rng, team, players, opts = {}) {
    const roster = team.roster.map((id) => players[id]);
    const hitters = roster.filter((p) => !p.isPitcher);
    const pitchers = roster.filter((p) => p.isPitcher);

    // Rotation: top 5 by stamina+stuff
    const sps = pitchers.filter((p) => p.primaryPosition === 'SP').sort((a, b) =>
      (b.ratings.stamina + b.ratings.stuff + b.ratings.control) -
      (a.ratings.stamina + a.ratings.stuff + a.ratings.control)
    );
    team.rotation = sps.slice(0, 5).map((p) => p.id);

    // Closer: best CP, fallback best RP, fallback best non-rotation arm.
    const cps = pitchers.filter((p) => p.primaryPosition === 'CP');
    const rps = pitchers.filter((p) => p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    rps.sort((a, b) => (b.ratings.stuff + b.ratings.velocity) - (a.ratings.stuff + a.ratings.velocity));
    const nonRotation = pitchers.filter((p) => !team.rotation.includes(p.id));
    const closerPick = cps[0] || rps[0] || nonRotation[0];
    if (!closerPick) {
      // Parseable failure for safeRebuild's pitching-side repair path.
      throw new Error(`assignLineupsAndPitching(${team.abbr}): no relief arm available for closer`);
    }
    team.closer = closerPick.id;
    // Bullpen: every pitcher who isn't in the rotation or closing. Spare
    // SP-primary arms land here as swingmen/long men — keeps the pen legal
    // when roster churn (retirements, call-ups) leaves an SP-heavy staff.
    team.bullpen = nonRotation.filter((p) => p.id !== team.closer).map((p) => p.id);
    team.bullpenRoles = assignBullpenRoles(team, players);

    // Lineup: build vs RHP and vs LHP
    team.lineupRH = buildLineup(hitters, 'R', team, opts.lineupStyle);
    team.lineupLH = buildLineup(hitters, 'L', team, opts.lineupStyle);
  }

  // Assign bullpen roles per bible 7.8 labels. The closer is tracked
  // separately on team.closer; this covers the rest of the pen:
  //  - setup (2): best remaining arms — high-leverage 7th/8th work
  //  - long (1): highest stamina — early-knockout and blowout innings
  //  - mopup (1): weakest arm — garbage time
  //  - middle (rest): everyone else
  // Exported so the sim can lazily backfill roles on saves created before
  // this field existed.
  function assignBullpenRoles(team, players) {
    const arms = (team.bullpen || []).map((id) => players[id]).filter(Boolean);
    const quality = (p) => p.ratings.stuff + p.ratings.velocity + p.ratings.control * 0.5;

    const roles = { setup: [], middle: [], long: [], mopup: [] };
    if (arms.length === 0) return roles;

    const byQuality = arms.slice().sort((a, b) => quality(b) - quality(a));
    roles.setup = byQuality.slice(0, 2).map((p) => p.id);

    const rest = byQuality.slice(2);
    if (rest.length > 0) {
      // Long man: highest stamina of the rest.
      const byStamina = rest.slice().sort((a, b) => b.ratings.stamina - a.ratings.stamina);
      roles.long = [byStamina[0].id];
      const remaining = rest.filter((p) => p.id !== byStamina[0].id);
      if (remaining.length > 0) {
        // Mop-up: weakest remaining arm.
        roles.mopup = [remaining[remaining.length - 1].id];
        roles.middle = remaining.slice(0, remaining.length - 1).map((p) => p.id);
      }
    }
    return roles;
  }

  function buildLineup(hitters, vsHand, team, lineupStyle) {
    // Required positions (8 in NL-style B-league, 9 in AL-style A-league with DH).
    const isDH = team.league === 'east';
    const positions = isDH
      ? ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH']
      : ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];

    // Greedy assignment by ASCENDING scarcity: fill the position with the
    // fewest eligible players first so unique-eligible players don't get
    // stolen for an alternate slot. This was a real bug — without this,
    // (e.g.) the only SS-eligible player would sometimes get picked for 3B
    // and SS would end up empty, producing a 7-slot lineup.
    const used = new Set();
    const placedByPos = {};
    const remainingPositions = positions.slice();

    while (remainingPositions.length > 0) {
      // Compute candidate counts for each remaining position.
      const counts = remainingPositions.map((pos) => {
        const cands = hitters.filter((p) => !used.has(p.id) && canPlay(p, pos));
        return { pos, cands };
      });
      counts.sort((a, b) => a.cands.length - b.cands.length);

      const next = counts[0];
      if (next.cands.length === 0) {
        throw new Error(
          `buildLineup(${team.abbr}, vs${vsHand}HP): no eligible hitter for position ${next.pos}. ` +
          `Roster has ${hitters.length} hitters; positions filled so far: ` +
          Object.keys(placedByPos).join(', ')
        );
      }

      // Pick the best of the eligible players by offensive value.
      next.cands.sort((a, b) => offensiveValue(b, vsHand) - offensiveValue(a, vsHand));
      const chosen = next.cands[0];
      used.add(chosen.id);
      placedByPos[next.pos] = chosen.id;

      const idx = remainingPositions.indexOf(next.pos);
      remainingPositions.splice(idx, 1);
    }

    // Build the lineup in standard order, then apply the manager's batting
    // order philosophy (17.2 lineup construction).
    const lineup = positions.map((pos) => ({ playerId: placedByPos[pos], position: pos }));
    const byId = {};
    for (const p of hitters) byId[p.id] = p;
    const style = lineupStyle != null ? lineupStyle : 7;

    if (style <= 3) {
      // Old-school: fastest high-contact bat leads off, bat-control second,
      // sluggers 3-4-5, everyone else by offense descending.
      const rest = lineup.slice();
      const speedScore = (s) => {
        const p = byId[s.playerId];
        return p.ratings.speed * 1.2 + (vsHand === 'L' ? p.ratings.contactVsL : p.ratings.contactVsR);
      };
      const powerScore = (s) => {
        const p = byId[s.playerId];
        return vsHand === 'L' ? p.ratings.powerVsL : p.ratings.powerVsR;
      };
      const offScore = (s) => offensiveValue(byId[s.playerId], vsHand);
      const take = (arr, scoreFn) => {
        arr.sort((a, b) => scoreFn(b) - scoreFn(a));
        return arr.shift();
      };
      const ordered = [];
      ordered.push(take(rest, speedScore));            // 1: table-setter
      ordered.push(take(rest, speedScore));            // 2: bat control
      ordered.push(take(rest, offScore));              // 3: best hitter
      ordered.push(take(rest, powerScore));            // 4: cleanup power
      if (rest.length) ordered.push(take(rest, powerScore)); // 5: more power
      rest.sort((a, b) => offScore(b) - offScore(a));
      return ordered.concat(rest);
    }

    // Modern (and blended middle): best hitters stacked at the top.
    lineup.sort((a, b) => offensiveValue(byId[b.playerId], vsHand) - offensiveValue(byId[a.playerId], vsHand));
    if (style > 3 && style < 7 && lineup.length >= 4) {
      // Soft blend: slide the top power bat to cleanup.
      const powerOf = (s) => {
        const p = byId[s.playerId];
        return vsHand === 'L' ? p.ratings.powerVsL : p.ratings.powerVsR;
      };
      let pi = 0;
      for (let i = 1; i < 4; i++) if (powerOf(lineup[i]) > powerOf(lineup[pi])) pi = i;
      const [slugger] = lineup.splice(pi, 1);
      lineup.splice(3, 0, slugger);
    }
    return lineup;
  }

  // ---- Position aptitude (0.20.0 — utility men) ---------------------------
  // Every position player carries a 20-80 aptitude at every field position:
  // 80 at his primary, 68 at listed secondaries, family-adjacent bases below
  // that — and reps close the gap. Games actually played at a position
  // (p.posReps, stamped by the sim) grow its aptitude; at 50 the position
  // becomes playable, and a learned position graduates into
  // secondaryPositions at 60 (syncPositions, run each rollover). This is
  // the whole utility-man loop: a manager patching 2B with his SS for a
  // month TEACHES the SS second base.
  //
  // Base aptitude before reps, by primary/secondary family:
  //   - middle infield ↔ middle infield: 45 (the double-play pivot travels)
  //   - any infielder → 3B/1B corners: 45; anyone → 1B: 42
  //   - corner OF ↔ corner OF: 60 (the old LF/RF interchange, unchanged)
  //   - CF → corners: 60; corners → CF: 42 (center is a different job)
  //   - infield ↔ outfield: 35
  //   - catcher: 20 from anywhere (catching is a trade, not a fill-in);
  //     catchers themselves get 45 at 1B
  function aptitudeFor(p, pos) {
    if (p.isPitcher) return pos === p.primaryPosition ? 80 : 20;
    if (pos === 'DH') return 80; // anyone can DH
    if (p.primaryPosition === pos) return 80;
    if ((p.secondaryPositions || []).includes(pos)) return 68;

    const prim = p.primaryPosition;
    const MI = ['2B', 'SS'];
    const IF = ['1B', '2B', '3B', 'SS'];
    const COF = ['LF', 'RF'];
    let base = 30;
    if (pos === 'C') base = 20;
    else if (pos === '1B') base = prim === 'C' ? 45 : (IF.includes(prim) ? 45 : 42);
    else if (MI.includes(pos) && MI.includes(prim)) base = 45;
    else if (pos === '3B' && IF.includes(prim)) base = 45;
    else if (MI.includes(pos) && (prim === '3B' || prim === '1B')) base = prim === '3B' ? 40 : 32;
    else if (COF.includes(pos) && (COF.includes(prim) || prim === 'CF')) base = 60;
    else if (pos === 'CF' && COF.includes(prim)) base = 42;
    else if (['LF', 'CF', 'RF'].includes(pos) && IF.includes(prim)) base = 35;
    else if (IF.includes(pos) && ['LF', 'CF', 'RF'].includes(prim)) base = 35;

    // Reps: every ~4 games at the position adds a point, up to +25. A
    // half-season of regular work makes a 45-base infielder playable (50+);
    // a full deliberate conversion (position work + real games) can teach
    // even an outfield/infield switch (35 base) all the way to learned (60).
    const reps = (p.posReps && p.posReps[pos]) || 0;
    return Math.min(72, base + Math.min(25, Math.floor(reps / 4)));
  }

  // Legality for lineup construction: playable at 50+. Backward compatible
  // with the old binary rules — primaries, secondaries, and the corner-OF
  // interchange all sit at 60+; everything else starts below 50 and must
  // be EARNED with reps (or position work in the minors).
  function canPlay(p, pos) {
    return aptitudeFor(p, pos) >= 50;
  }

  // Graduate learned positions into the visible secondary list (run at
  // each rollover): aptitude 60+ = the org now lists him there. Clears a
  // completed devPosition assignment.
  function syncPositions(p) {
    if (p.isPitcher || !p.posReps) return false;
    let changed = false;
    for (const pos in p.posReps) {
      if (pos === p.primaryPosition || pos === 'DH') continue;
      if ((p.secondaryPositions || []).includes(pos)) continue;
      if (aptitudeFor(p, pos) >= 60) {
        if (!p.secondaryPositions) p.secondaryPositions = [];
        p.secondaryPositions.push(pos);
        if (p.devPosition === pos) delete p.devPosition;
        changed = true;
      }
    }
    return changed;
  }

  function offensiveValue(p, vsHand) {
    const r = p.ratings;
    const contact = vsHand === 'L' ? r.contactVsL : r.contactVsR;
    const power = vsHand === 'L' ? r.powerVsL : r.powerVsR;
    return contact * 1.0 + power * 1.0 + r.discipline * 0.7 + r.speed * 0.3;
  }

  // Validate that every team in `league` is fully ready to simulate games.
  // Throws on the first broken team with a clear, actionable message.
  // Use after generation, before the save is created.
  function validateLeagueReadiness(league, players) {
    if (!league || !Array.isArray(league.teams)) {
      throw new Error('validateLeagueReadiness: league has no teams array');
    }
    for (const team of league.teams) {
      checkTeamReadiness(team, players);
    }
    return { valid: true, teamsChecked: league.teams.length };
  }

  function checkTeamReadiness(team, players) {
    const tag = `${team.abbr || team.id} (${team.league || '?'} ${team.division || '?'})`;
    function fail(msg) {
      throw new Error(`Team ${tag} not ready: ${msg}`);
    }

    // 26 is full strength; a team may play short (24-25) while an IL stint
    // lacks a call-up (bible 10.5 "play short-handed — legal but unwise").
    // Over 26 is never legal.
    if (!Array.isArray(team.roster) || team.roster.length < 24 || team.roster.length > 26) {
      fail(`active roster size ${team.roster ? team.roster.length : 0}, expected 24-26`);
    }

    // Every roster id must reference a real player.
    for (const id of team.roster) {
      if (!players[id]) fail(`roster references unknown player id ${id}`);
    }

    const roster = team.roster.map((id) => players[id]);
    const pitchers = roster.filter((p) => p.isPitcher);
    const hitters = roster.filter((p) => !p.isPitcher);
    if (pitchers.length < 11) fail(`only ${pitchers.length} pitchers, expected at least 11`);
    if (hitters.length < 11) fail(`only ${hitters.length} hitters, expected at least 11`);

    // Rotation: must be exactly 5 valid SP-eligible pitchers.
    if (!Array.isArray(team.rotation) || team.rotation.length < 5) {
      fail(`rotation size ${team.rotation ? team.rotation.length : 0}, expected at least 5`);
    }
    for (const id of team.rotation) {
      const p = players[id];
      if (!p) fail(`rotation references unknown player id ${id}`);
      if (!p.isPitcher) fail(`rotation contains non-pitcher ${p.name} (${id})`);
    }

    // Bullpen: at least 6 arms plus the closer (the bible 11.2 12-pitcher
    // config is 5 SP + closer + 6 pen), all valid.
    if (!Array.isArray(team.bullpen) || team.bullpen.length < 6) {
      fail(`bullpen size ${team.bullpen ? team.bullpen.length : 0}, expected at least 6`);
    }
    for (const id of team.bullpen) {
      const p = players[id];
      if (!p) fail(`bullpen references unknown player id ${id}`);
      if (!p.isPitcher) fail(`bullpen contains non-pitcher ${p.name} (${id})`);
    }

    // Closer: must exist and be a real pitcher.
    if (!team.closer) fail('no closer assigned');
    const closer = players[team.closer];
    if (!closer) fail(`closer references unknown player id ${team.closer}`);
    if (!closer.isPitcher) fail(`closer ${closer.name} is not a pitcher`);

    // Lineups (vs RHP and vs LHP). Both must have the right number of slots.
    const expectedLineupLen = team.league === 'east' ? 9 : 8;
    for (const which of ['lineupRH', 'lineupLH']) {
      const lineup = team[which];
      if (!Array.isArray(lineup) || lineup.length < expectedLineupLen) {
        fail(`${which} length ${lineup ? lineup.length : 0}, expected at least ${expectedLineupLen}`);
      }
      for (const spot of lineup) {
        if (!spot || !spot.playerId) fail(`${which} contains malformed slot ${JSON.stringify(spot)}`);
        if (!players[spot.playerId]) fail(`${which} references unknown player id ${spot.playerId}`);
      }
    }
  }

  // Generate one new player into an existing save (offseason org backfill,
  // emergency roster fills). Caller supplies a collision-safe id via
  // state.meta.nextGenId bookkeeping.
  function generateNewPlayer(rng, team, opts) {
    return makePlayer(rng, {
      slotPos: opts.slotPos,
      team,
      tier: opts.tier || 'prospect',
      ageRange: opts.ageRange || { min: 18, max: 22 },
      status: opts.status || 'minors',
      rosterStatus: opts.rosterStatus || 'A',
      isProspect: opts.isProspect !== false,
      id: opts.id,
    });
  }

  return {
    generate, validateLeagueReadiness, assignBullpenRoles,
    // Exposed for the roster-management UI: position eligibility checks and
    // single-team readiness validation after user-driven roster moves.
    canPlay, aptitudeFor, syncPositions,
    validateTeam: checkTeamReadiness,
    // Post-launch generation + team config rebuild (offseason rollover).
    generateNewPlayer,
    assignLineupsAndPitching,
  };
})();
