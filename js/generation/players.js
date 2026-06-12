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
      { level: 'AA', count: 5 },
      { level: 'A+', count: 5 },
      { level: 'A', count: 4 },
      { level: 'Rookie', count: 2 },
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

  function ageForLevel(level) {
    switch (level) {
      case 'AAA': return { mean: 26, stdev: 2.5, min: 19, max: 35 };
      case 'AA': return { mean: 23, stdev: 1.5, min: 19, max: 28 };
      case 'A+': return { mean: 21, stdev: 1.2, min: 18, max: 25 };
      case 'A': return { mean: 20, stdev: 1.2, min: 17, max: 23 };
      case 'Rookie': return { mean: 18, stdev: 1.0, min: 16, max: 21 };
    }
    return { mean: 23, stdev: 2, min: 18, max: 30 };
  }

  function makePlayer(rng, opts) {
    const { slotPos, team, tier, ageRange, status, rosterStatus, isProspect } = opts;
    const id = nextId();

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

    // Service time
    const serviceYears = clamp(age - 22, 0, 18);
    const contract = generateContract(rng, age, tier, ratings, isPitcher, serviceYears);

    // Hidden values
    const hidden = {
      ceiling,
      archetype,
      injuryProneness: rint(rng, 1, 10),
      workEthic: rint(rng, 1, 10),
      makeupGrade: rint(rng, 1, 10),
    };

    return {
      id,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      birthYear: C.START_YEAR - age,
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

  function assignLineupsAndPitching(rng, team, players) {
    const roster = team.roster.map((id) => players[id]);
    const hitters = roster.filter((p) => !p.isPitcher);
    const pitchers = roster.filter((p) => p.isPitcher);

    // Rotation: top 5 by stamina+stuff
    const sps = pitchers.filter((p) => p.primaryPosition === 'SP').sort((a, b) =>
      (b.ratings.stamina + b.ratings.stuff + b.ratings.control) -
      (a.ratings.stamina + a.ratings.stuff + a.ratings.control)
    );
    team.rotation = sps.slice(0, 5).map((p) => p.id);

    // Closer: best CP, fallback best RP
    const cps = pitchers.filter((p) => p.primaryPosition === 'CP');
    const rps = pitchers.filter((p) => p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    rps.sort((a, b) => (b.ratings.stuff + b.ratings.velocity) - (a.ratings.stuff + a.ratings.velocity));
    team.closer = (cps[0] || rps[0]).id;
    team.bullpen = rps.filter((p) => p.id !== team.closer).map((p) => p.id);
    team.bullpenRoles = assignBullpenRoles(team, players);

    // Lineup: build vs RHP and vs LHP
    team.lineupRH = buildLineup(hitters, 'R', team);
    team.lineupLH = buildLineup(hitters, 'L', team);
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

  function buildLineup(hitters, vsHand, team) {
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

    // Build the lineup in standard order, then sort by offensive value to
    // produce a "modern" batting order (best hitters at the top).
    const lineup = positions.map((pos) => ({ playerId: placedByPos[pos], position: pos }));
    lineup.sort((a, b) => {
      const ha = hitters.find((p) => p.id === a.playerId);
      const hb = hitters.find((p) => p.id === b.playerId);
      return offensiveValue(hb, vsHand) - offensiveValue(ha, vsHand);
    });
    return lineup;
  }

  function canPlay(p, pos) {
    if (pos === 'DH') return true; // anyone can DH
    if (p.primaryPosition === pos) return true;
    if (p.secondaryPositions.includes(pos)) return true;
    // Outfield interchange: LF/RF can sub for each other in a pinch
    if ((pos === 'LF' || pos === 'RF') &&
        (p.primaryPosition === 'LF' || p.primaryPosition === 'RF' || p.primaryPosition === 'CF')) return true;
    if (pos === 'CF' && (p.primaryPosition === 'LF' || p.primaryPosition === 'RF') && p.secondaryPositions.includes('CF')) return true;
    return false;
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

    if (!Array.isArray(team.roster) || team.roster.length !== 26) {
      fail(`active roster size ${team.roster ? team.roster.length : 0}, expected 26`);
    }

    // Every roster id must reference a real player.
    for (const id of team.roster) {
      if (!players[id]) fail(`roster references unknown player id ${id}`);
    }

    const roster = team.roster.map((id) => players[id]);
    const pitchers = roster.filter((p) => p.isPitcher);
    const hitters = roster.filter((p) => !p.isPitcher);
    if (pitchers.length < 13) fail(`only ${pitchers.length} pitchers, expected at least 13`);
    if (hitters.length < 13) fail(`only ${hitters.length} hitters, expected at least 13`);

    // Rotation: must be exactly 5 valid SP-eligible pitchers.
    if (!Array.isArray(team.rotation) || team.rotation.length < 5) {
      fail(`rotation size ${team.rotation ? team.rotation.length : 0}, expected at least 5`);
    }
    for (const id of team.rotation) {
      const p = players[id];
      if (!p) fail(`rotation references unknown player id ${id}`);
      if (!p.isPitcher) fail(`rotation contains non-pitcher ${p.name} (${id})`);
    }

    // Bullpen: at least 7 arms, all valid.
    if (!Array.isArray(team.bullpen) || team.bullpen.length < 7) {
      fail(`bullpen size ${team.bullpen ? team.bullpen.length : 0}, expected at least 7`);
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

  return {
    generate, validateLeagueReadiness, assignBullpenRoles,
    // Exposed for the roster-management UI: position eligibility checks and
    // single-team readiness validation after user-driven roster moves.
    canPlay,
    validateTeam: checkTeamReadiness,
  };
})();
