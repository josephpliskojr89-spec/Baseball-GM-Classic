// Player generation. Builds a complete league population with realistic
// distributions per the bible 6.2-6.4.
window.BBGM_PLAYER_GEN = (function () {
  const { rint, rfloat, pick, pickWeighted, shuffle, rnormal, clamp } = window.BBGM_RNG;
  const C = window.BBGM_CONSTANTS;

  let _id = 0;
  function nextId() { _id++; return `p${_id}`; }

  // 0.49.0 body model, shared with the load migration and the offseason
  // fill-out: the adult frame a player fills toward (~197 lb at 6'2",
  // +5.5 lb/inch), and how far under it a young player lists — a
  // 16-year-old signee runs ~30 lb light and adds weight each winter.
  function frameFor(heightIn, noise) {
    return Math.max(160, Math.min(260, Math.round((heightIn - 60) * 5.5 + 120 + (noise || 0))));
  }
  function youthDeficit(age) {
    return Math.round(Math.max(0, Math.min(30, (25 - age) * 3.5)));
  }
  // 0.53.1 (archetype audit): re-clamp ceilings to the archetype's cap.
  // The draft/intl slot lifts raise ceilings toward a rank target and
  // used to blow straight past ceilingCap — a third of pipeline quad-A
  // kids broke their cap and 10% became stars, erasing the archetype in
  // the main talent pipeline. Pitcher stamina stays exempt (workload,
  // not talent — the same rule generation applies). Ratings re-clamp
  // beneath any lowered ceiling.
  // The generational talent (0.66.0): the unicorn who grows through the
  // youth ramp like it isn't there — Soto, Harper, the kid who arrives
  // at 19 because he really is that different. Anointed at CLASS
  // generation (draft.js / intl.js roll ~11% per class, at most one
  // kid), never via the archetype weight table — the game mints ~450
  // new players a year and rarity IS the identity. What it does: a
  // loud, real destiny (best tool 76-80), a head as loud as the tools
  // (work ethic and makeup floored high), a clean traditional curve,
  // and the hidden.generational flag progression reads for the ramp
  // exemption. What it does NOT do: touch current ratings (he signs
  // raw), shield him from injuries or the adversity layer, or leak —
  // nothing user-facing may ever read the flag; the hype must come
  // from what he does on the field, so a bust with a seductive card
  // can be crowned by mistake, exactly like life.
  function anointGenerational(p, randFn) {
    const rand = randFn || Math.random;
    const h = p.hidden;
    h.generational = true;
    h.archetype = 'traditional';
    h.peakAge = null;         // re-stamped lazily from the traditional curve
    delete h.growth;          // no squash identities on a unicorn
    delete h.breakoutAge;
    const keys = p.isPitcher
      ? ['velocity', 'movement', 'control', 'stuff']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'defense', 'arm'];
    // The destiny anchors on TALENT (1.3.0): a generational hitter is
    // never crowned for his footspeed — speed can ride along (the leak
    // below) but the 76-80 anchor is a bat/glove/arm tool, so the loud
    // card the industry sees is loud where it counts.
    const anchorKeys = p.isPitcher ? keys : keys.filter((k) => k !== 'speed');
    let bestKey = anchorKeys[0];
    for (const k of anchorKeys) if (h.ceiling[k] > h.ceiling[bestKey]) bestKey = k;
    const target = 76 + rand() * 4;
    // Raise-only (W3, 0.68.1): a kid whose best tool already clears the
    // target must not be PULLED DOWN by his own anointment — delta went
    // negative and every ceiling dropped. The blessing lifts or leaves.
    const delta = Math.max(0, target - h.ceiling[bestKey]);
    for (const k of keys) {
      // Same speed carve-out as the class-gen slot lift (Phase 16): the
      // anointment raises the bat, not the legs.
      if (!p.isPitcher && k === 'speed' && bestKey !== 'speed') {
        h.ceiling.speed = Math.round(clamp(h.ceiling.speed + delta * 0.15, 25, 80) * 10) / 10;
        continue;
      }
      const spread = k === bestKey ? 0 : rand() * 6;
      const lifted = clamp(h.ceiling[k] + delta - spread, 25, 82);
      h.ceiling[k] = Math.round(Math.max(h.ceiling[k], lifted) * 10) / 10;
    }
    h.workEthic = Math.max(h.workEthic || 5, 8 + Math.round(rand() * 2));
    h.makeupGrade = Math.max(h.makeupGrade || 5, 7 + Math.round(rand() * 3));
    syncBornSpeed(p, rand);
    mintCone(p); // §23.5: the unicorn's window minted HIGH (no-op while dark)
    return p;
  }

  // ---- The Cone (bible §23) — DARK until the v2.0.0 flip -------------------
  // Mint a player's per-tool windows around his current centers
  // (hidden.ceiling), width by age. No-ops while CONE.ENABLED is false,
  // so the live game is untouched; the drift checkpoint (progression)
  // lazily mints for anyone who slipped through, which is also the
  // whole migration story at flip time.
  function coneKeysOf(p) {
    return p.isPitcher
      ? ['velocity', 'stuff', 'movement', 'control']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'defense', 'arm'];
  }
  function coneHalfWidth(age) {
    const T = C.CONE && C.CONE.HALF_WIDTH;
    if (!T) return 0;
    if (T[age] != null) return T[age];
    return age < 16 ? T[16] : T.DEFAULT;
  }
  // §23.16 projectability: the freak's window is massive. Everything
  // feeding the multiplier is OBSERVABLE — born speed and arm strength
  // for a bat, radar-gun velocity for an arm, and the frame room the
  // body model already tracks (pounds still coming vs the adult frame
  // his height predicts). That's why it's fair for the honest band to
  // show it: the scout isn't guessing, he's pointing at ingredients.
  function projectabilityOf(p) {
    const PR = C.CONE && C.CONE.PROJ;
    if (!PR) return 1;
    let ath;
    if (p.isPitcher) {
      const v = p.hidden.ceiling.velocity != null ? p.hidden.ceiling.velocity : 50;
      ath = clamp((v - 45) / 30, 0, 1);
    } else {
      const spd = p.ratings && p.ratings.speed != null ? p.ratings.speed : 45;
      const arm = p.hidden.ceiling.arm != null ? p.hidden.ceiling.arm : 45;
      ath = clamp(((spd - 40) / 35) * 0.7 + ((arm - 40) / 35) * 0.3, 0, 1);
    }
    const room = p.heightIn && p.weightLb
      ? clamp((frameFor(p.heightIn) - p.weightLb) / 32, 0, 1)
      : 0.5;
    return PR.MIN + PR.W_ATH * ath + PR.W_FRAME * room;
  }
  function projFade(age) {
    const F = C.CONE && C.CONE.PROJ && C.CONE.PROJ.FADE;
    if (!F) return 0;
    return F[age] != null ? F[age] : (age < 16 ? 1 : F.DEFAULT);
  }
  function mintCone(p) {
    if (!C.CONE || !C.CONE.ENABLED) return;
    if (!p.hidden || !p.hidden.ceiling) return;
    const arch = (p.isPitcher ? C.PITCHER_ARCHETYPES : C.HITTER_ARCHETYPES)
      .find((a) => a.key === p.hidden.archetype);
    const wm = Math.round(projectabilityOf(p) * 100) / 100;
    const hw = coneHalfWidth(p.age) * (1 + (wm - 1) * projFade(p.age));
    const cone = { lo: {}, hi: {} };
    for (const k of coneKeysOf(p)) {
      const c = p.hidden.ceiling[k];
      if (c == null) continue;
      // Lid 84, matching the surge and the overflow (§23.4) — the old
      // 82 wall crushed a top-rank teenager's upper window into a
      // sliver (center 81, hw 12 → a 1-point promise), which is how
      // the comically tight 80-82 elite bands happened (§23.17).
      let hi = Math.min(84, c + hw);
      // The identity IS the window (23.5): a quad-A profile's top is
      // the quad-A cap, at any age.
      if (arch && arch.ceilingCap) hi = Math.min(hi, arch.ceilingCap + 2);
      cone.lo[k] = Math.round(Math.max(20, c - hw) * 10) / 10;
      cone.hi[k] = Math.round(Math.max(hi, c) * 10) / 10;
    }
    // Stored so the yearly narrowing keeps honoring his build (fading
    // with age) — a sibling of lo/hi, never inside them (loops iterate
    // cone.hi's keys).
    cone.wm = wm;
    p.hidden.cone = cone;
  }

  // Legs are born, not developed (1.3.0): whenever a post-mint ceiling
  // pass touches a hitter's speed ceiling (the anointment, the hidden
  // gem, the intl signing-day swing), his CURRENT follows immediately —
  // nobody "develops into" footspeed, so a lifted speed ceiling with a
  // pinned current would mint exactly the phantom runner the born-speed
  // rule exists to kill. Raise-only; the aging decline owns the way down.
  function syncBornSpeed(p, randFn) {
    if (p.isPitcher || !p.ratings || !p.hidden || !p.hidden.ceiling) return;
    const c = p.hidden.ceiling.speed;
    if (c == null || p.ratings.speed == null) return;
    const rand = randFn || Math.random;
    const target = Math.round(clamp(c - (1 + rand() * 2), 20, 80) * 10) / 10;
    if (p.ratings.speed < target) p.ratings.speed = target;
  }

  function applyArchetypeCap(p) {
    const defs = p.isPitcher ? C.PITCHER_ARCHETYPES : C.HITTER_ARCHETYPES;
    const arch = defs.find((a) => a.key === (p.hidden && p.hidden.archetype));
    if (!arch || !p.hidden || !p.hidden.ceiling) return false;
    // Overachiever (0.58.0): the identity is the modest card. Pipeline
    // lifts get re-clamped to the born (age-interpolated) ceilings the
    // squash stamped — an overachiever can't be a top-ranked gem; his
    // climb happens in progression, not in the rankings.
    if (p.hidden.growth && p.hidden.growth.cap) {
      const cap = p.hidden.growth.cap;
      for (const k in p.hidden.ceiling) {
        if (cap[k] != null && p.hidden.ceiling[k] > cap[k]) {
          p.hidden.ceiling[k] = cap[k];
          if (p.ratings && p.ratings[k] != null && p.ratings[k] > cap[k]) {
            p.ratings[k] = cap[k];
          }
        }
      }
      return true;
    }
    if (!arch.ceilingCap) return false;
    for (const k in p.hidden.ceiling) {
      if (p.isPitcher && k === 'stamina') continue;
      if (p.hidden.ceiling[k] > arch.ceilingCap) {
        p.hidden.ceiling[k] = arch.ceilingCap;
        if (p.ratings && p.ratings[k] != null && p.ratings[k] > arch.ceilingCap) {
          p.ratings[k] = arch.ceilingCap;
        }
      }
    }
    return true;
  }

  // Corner bats run thick, up-the-middle players run lean.
  const FRAME_POS_ADJ = { C: 6, '1B': 8, DH: 10, '3B': 3, LF: 2, RF: 2, CF: -4, '2B': -6, SS: -6 };
  function posFrameAdj(primaryPosition, isPitcher) {
    return isPitcher ? 0 : (FRAME_POS_ADJ[primaryPosition] || 0);
  }

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

    // Payroll calibration (0.51.0): contracts were drawn from talent
    // tiers with no budget awareness, so half the league opened its
    // books 100-300% over the owner's number — glaring now that the
    // Finances tab shows the ledger. Scale each over-budget club's
    // contracts to open at 85-96% of payrollBase (small clubs carry
    // bargain deals — realistic); the league-minimum floor holds.
    for (const team of league.teams) {
      let payroll = 0;
      const rostered = team.roster.map((id) => players[id]).filter((p) => p && p.contract);
      for (const p of rostered) payroll += p.contract.annualSalary || 0;
      const target = team.payrollBase * (0.85 + rng() * 0.11);
      if (payroll <= target || payroll <= 0) continue;
      const scale = target / payroll;
      for (const p of rostered) {
        const s = Math.max(0.74, Math.round(p.contract.annualSalary * scale * 10) / 10);
        p.contract.annualSalary = s;
        p.contract.totalValue = Math.round(s * (p.contract.years || 1) * 10) / 10;
      }
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
    const { ratings, ceiling, archetype, growth, shape, greenLight } = generateRatings(rng, { primaryPosition, isPitcher, age, tier, isProspect });

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
      shape,
      ...(greenLight != null ? { greenLight } : {}),
      injuryProneness: rint(rng, 1, 10),
      // Overachievers grind by definition — the climb IS a makeup story,
      // so their hidden work ethic never rolls the bottom of the scale.
      workEthic: growth ? Math.max(rint(rng, 1, 10), rint(rng, 6, 9)) : rint(rng, 1, 10),
      ...(growth ? { growth } : {}),
      makeupGrade: rint(rng, 1, 10),
      // Durability: feeds fatigue recovery and rest scheduling. A 10 with
      // sturdy health is the rare "iron man" who plays every day (10.8).
      durability: rint(rng, 1, 10),
    };

    // Bio (profile card): height/weight by role, full birthdate.
    // 0.49.0 body rebuild: the old model (6'3"-base pitchers on a
    // +6 lb/inch line) had nearly a third of every staff listing 6'4"+
    // AND 220+, and handed 16-year-old signees adult bodies. Heights
    // pulled in, the weight line sits at ~197 lb for 6'2", and a player
    // now carries an adult FRAME (frameLb) he fills toward — teenagers
    // list wiry and add a few pounds each winter until their mid-20s.
    const heightBase = isPitcher ? 74.4 : (primaryPosition === 'C' ? 73 : ['2B', 'SS'].includes(primaryPosition) ? 71.5 : 73.2);
    const heightIn = clamp(Math.round(rnormal(rng, heightBase, 1.6)), 68, 79);
    const frameLb = frameFor(heightIn, posFrameAdj(primaryPosition, isPitcher) + rnormal(rng, 0, 12));
    const weightLb = Math.max(148, frameLb - youthDeficit(age));

    const p = {
      id,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      birthYear: C.START_YEAR - age,
      birthMonth: rint(rng, 1, 12),
      birthDay: rint(rng, 1, 28),
      heightIn,
      weightLb,
      frameLb,
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
    mintCone(p); // §23 (no-op while dark)
    return p;
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

  // ---- Shapes (re-founding phase 2, bible §22) -----------------------------
  // A shape redistributes a player's tier-given talent across his tools —
  // zero-sum-ish, so star scarcity holds while the correlated-superstar
  // signature dies. Shape is identity, minted once, hidden; it stacks
  // with the development archetype (which is a career PATH, not a tool
  // layout). Deltas apply to CEILINGS; 'contact'/'power' expand to the
  // VsR/VsL pair.
  const HITTER_SHAPES = [
    { key: 'balanced', weight: 30, d: {} },
    { key: 'slugger', weight: 13, d: { power: 8, discipline: 2, contact: -6 },
      corner: 1.8, middle: 0.5 },
    { key: 'tto_monster', weight: 4, d: { power: 11, discipline: 7, contact: -11, bunting: -6 },
      corner: 1.8, middle: 0.5 },
    { key: 'contact_artist', weight: 12, d: { contact: 8, power: -7, discipline: 1, bunting: 5 } },
    { key: 'table_setter', weight: 9, d: { contact: 5, power: -9, discipline: 2, speed: 9, bunting: 6 },
      corner: 0.4, middle: 1.8 },
    { key: 'glove_wizard', weight: 10, d: { defense: 9, arm: 5, contact: -4, power: -5 },
      corner: 0.4, middle: 2.0, catcher: 2.2 },
    { key: 'professional', weight: 9, d: { discipline: 6, contact: 2, power: -3 } },
    { key: 'toolshed', weight: 5, d: { power: 5, arm: 4, speed: 5, discipline: -8, contact: -2 } },
  ];
  const PITCHER_SHAPES = [
    { key: 'balanced', weight: 26, d: {} },
    { key: 'power_arm', weight: 13, d: { velocity: 8, stuff: 5, control: -6, movement: -3 },
      pen: 1.4 },
    { key: 'wild_flamethrower', weight: 4, d: { velocity: 11, stuff: 6, control: -12, movement: -2 },
      pen: 1.5 },
    { key: 'command_artist', weight: 12, d: { control: 9, movement: 4, velocity: -8, stuff: -2 } },
    { key: 'sinkerballer', weight: 12, d: { movement: 9, control: 3, stuff: -6, velocity: -4 } },
    { key: 'strikeout_artist', weight: 8, d: { stuff: 9, movement: 2, velocity: 2, control: -6 } },
    { key: 'workhorse', weight: 8, d: { stamina: 8, control: 3, stuff: -4, velocity: -3 },
      pen: 0.25 },
  ];

  function pickShape(rng, isPitcher, pos, tier) {
    const defs = isPitcher ? PITCHER_SHAPES : HITTER_SHAPES;
    const isCorner = pos === '1B' || pos === 'LF' || pos === 'RF' || pos === 'DH';
    const isMiddle = pos === '2B' || pos === 'SS' || pos === 'CF';
    const isPen = pos === 'RP' || pos === 'CP';
    const highTier = tier === 'star' || tier === 'plus';
    const wOf = (s) => {
      let w = s.weight;
      // Shape-first stardom (§22.8): a 70-flat "balanced star" under
      // honest slopes is the same MVP card thirty times over. Stars are
      // defined by carrying tools; the true five-tool inner-circle guy
      // stays possible but rare.
      if (highTier && s.key === 'balanced') w *= 0.4;
      if (!isPitcher) {
        if (isCorner && s.corner != null) w *= s.corner;
        if (isMiddle && s.middle != null) w *= s.middle;
        if (pos === 'C' && s.catcher != null) w *= s.catcher;
      } else if (isPen && s.pen != null) w *= s.pen;
      return w;
    };
    let total = 0;
    for (const s of defs) total += wOf(s);
    let r = rng() * total;
    for (const s of defs) { r -= wOf(s); if (r <= 0) return s; }
    return defs[0];
  }

  function shapeDelta(shape, key) {
    const d = shape.d || {};
    if (key === 'contactVsR' || key === 'contactVsL') return d.contact || 0;
    if (key === 'powerVsR' || key === 'powerVsL') return d.power || 0;
    return d[key] || 0;
  }

  function generateRatings(rng, opts) {
    const { primaryPosition, isPitcher, age, tier, isProspect } = opts;

    // Determine ceiling envelope by tier.
    const ceilingMean = ({
      star: 70, plus: 60, avg: 52, depth: 47, prospect: 55, fringe: 44,
    })[tier] || 50;
    // Re-founding phase 3: within-tier tool spread. sd 4 made every star
    // 70-flat — the correlated-superstar machine. At 6.5 a star's tools
    // scatter (76-contact/58-power cards), overall barely moves (mean of
    // 9 draws), and the honest dictionary slopes stop minting .400
    // hitters out of 70-everything bats.
    const ceilingStdev = 6.5;

    // Build per-rating ceiling
    const ratingKeys = isPitcher
      ? ['stamina', 'velocity', 'movement', 'control', 'stuff']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'bunting', 'defense', 'arm'];

    // Shape first (re-founding phase 2): the tool layout is identity,
    // decided before any dice so the tier draw distributes THROUGH it.
    // High tiers push their shape harder — stardom IS the carrying
    // tools (§22.8), so a star slugger is Sosa, not a flat 70.
    const shape = pickShape(rng, isPitcher, primaryPosition, tier);
    const shapeMul = tier === 'star' ? 1.5 : tier === 'plus' ? 1.25 : 1;

    const ceiling = {};
    for (const k of ratingKeys) {
      let c = clamp(rnormal(rng, ceilingMean, ceilingStdev), 30, 80);
      // §22.2: 80-grade tools are generational, one or two per era. The
      // tier draw's top tail squashes so raw draws rarely clear the
      // mid-70s — plus-plus tools come from a shape's carrying-tool
      // push (or the anointed/draft-lift paths), not tier luck.
      if (c > 72) c = 72 + (c - 72) * 0.35;
      // Position-specific adjustments
      if (!isPitcher) {
        c = positionAdjust(rng, primaryPosition, k, c);
      } else {
        c = pitcherRoleAdjust(rng, primaryPosition, k, c);
      }
      // Shape deltas (speed's applies after its independent redraw below).
      if (k !== 'speed') c = clamp(c + shapeDelta(shape, k) * shapeMul, 25, 80);
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
      spd += shapeDelta(shape, 'speed') * shapeMul;
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

    // Overachiever squash (0.58.0): the inverse of the bust. The
    // normally generated ceilings become his DESTINY (kept hidden);
    // what the world sees at signing is a genuinely modest card — the
    // low-30s potential the scouts read is TRUE that day. The ceiling
    // then climbs back toward destiny year by year (progression.js).
    // Stamina (pitchers) and speed (hitters) are workload/body traits,
    // not talent — they're exempt so the squash can't produce broken
    // currents-over-ceilings or un-body-given wheels. Players generated
    // mid-career start partway up the climb.
    let growth = null;
    if (archDef.growth) {
      const drop = archDef.growth.drop[0] +
        rng() * (archDef.growth.drop[1] - archDef.growth.drop[0]);
      const doneAge = archDef.growth.doneAge;
      const f = clamp((age - 18) / (doneAge - 18), 0, 1); // climb already made
      const dest = {}, cap = {};
      for (const k of ratingKeys) {
        const exempt = (isPitcher && k === 'stamina') || (!isPitcher && k === 'speed');
        // Exempt keys carry NO destiny: the creep only rebuilds what the
        // squash took, so pipeline shifts to body/workload traits stand.
        if (!exempt) {
          dest[k] = ceiling[k];
          const born = clamp(ceiling[k] - drop, 26, 80);
          ceiling[k] = Math.round((born + (dest[k] - born) * f) * 10) / 10;
        }
        cap[k] = ceiling[k];
      }
      growth = { dest, cap, doneAge };
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
      const noise = rnormal(rng, 0, 2);
      // Speed is body-given and VISIBLE (1.3.0, user ask): a player is
      // born roughly as fast as he'll ever be — a shade under for the
      // youngest — so pre-peak hitters mint at their speed ceiling
      // instead of "developing" footspeed like a skill. Post-peak keeps
      // the generic decline path (the legs going IS aging).
      if (!isPitcher && k === 'speed' && age < peakAge) {
        const youthGap = age <= 16 ? 5 : age <= 17 ? 4 : age <= 18 ? 3 : age <= 20 ? 1.5 : 1;
        ratings[k] = clamp(Math.round(Math.min(ceiling[k], ceiling[k] - youthGap + noise * 0.5) * 10) / 10, 20, 80);
        continue;
      }
      const floor = (isPitcher && k === 'stamina' && primaryPosition === 'SP')
        ? clamp(ceiling[k] - 8, 48, 72)
        : clamp(ceiling[k] - 25, 25, 60);
      const cur = floor + (ceiling[k] - floor) * progressFraction + noise;
      ratings[k] = clamp(Math.round(cur * 10) / 10, 20, 80);
    }

    // Green light (§22.3 speed): steal AGGRESSION is identity, not implied
    // by the grade. A burner without the light jogs; a 55-speed pest with
    // a 9 runs 40 times. Sim consumes it in phase 3; minted now so every
    // player born under the re-founding carries it.
    let greenLight = null;
    if (!isPitcher) {
      const shapeKick = shape.key === 'table_setter' ? 3 : shape.key === 'toolshed' ? 1
        : (shape.key === 'slugger' || shape.key === 'tto_monster') ? -2 : 0;
      greenLight = clamp(Math.round((ceiling.speed - 46) / 4 + shapeKick + rnormal(rng, 0, 1.5)), 0, 10);
    }

    return { ratings, ceiling, archetype, growth, shape: shape.key, greenLight };
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
        // 1.1.1 (user report): 55 let too many pen arms qualify for
        // rubber-armed workloads. 52 keeps the true fireman (48+) a
        // scarce find while ordinary relievers stay one-inning men.
        c = Math.min(c, 52);
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
    // Spot starters (0.71.4, user report: call-ups rejected "rotation
    // size 4, expected at least 5"). When SP-primaries run short — the
    // 60-day IL, a walked free agent — the manager stretches his best
    // remaining arms rather than running a short rotation: someone HAS
    // to take the ball every day. Without this, a rebuild on an SP-short
    // club produced 4 chairs against the 5-chair floor and every roster
    // move was rejected. Always leave at least one arm for the ninth.
    if (team.rotation.length < 5) {
      const spare = pitchers.filter((p) => !team.rotation.includes(p.id)).sort((a, b) =>
        (b.ratings.stamina + b.ratings.stuff + b.ratings.control) -
        (a.ratings.stamina + a.ratings.stuff + a.ratings.control)
      );
      while (team.rotation.length < 5 && spare.length > 1) {
        team.rotation.push(spare.shift().id);
      }
    }

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

  // opts (0.30.2): optional pre-move floors for user roster moves. An
  // offseason roster can legally sit below the 24-man game floor
  // (expired contracts walked), and the strict window was rejecting the
  // very call-up that climbs back toward it. Passing the PRE-move
  // counts relaxes each floor to "no worse than before" — every floor
  // is still capped at its strict value, so a team that already meets
  // the rules is held to them.
  function checkTeamReadiness(team, players, opts = {}) {
    const tag = `${team.abbr || team.id} (${team.league || '?'} ${team.division || '?'})`;
    function fail(msg) {
      throw new Error(`Team ${tag} not ready: ${msg}`);
    }
    const floor = (strict, pre) => pre != null ? Math.min(strict, pre) : strict;

    // 26 is full strength; a team may play short (24-25) while an IL stint
    // lacks a call-up (bible 10.5 "play short-handed — legal but unwise").
    // Over 26 is never legal.
    const minRoster = floor(24, opts.minRoster);
    if (!Array.isArray(team.roster) || team.roster.length < minRoster || team.roster.length > 26) {
      fail(`active roster size ${team.roster ? team.roster.length : 0}, expected ${minRoster}-26`);
    }

    // Every roster id must reference a real player.
    for (const id of team.roster) {
      if (!players[id]) fail(`roster references unknown player id ${id}`);
    }

    const roster = team.roster.map((id) => players[id]);
    const pitchers = roster.filter((p) => p.isPitcher);
    const hitters = roster.filter((p) => !p.isPitcher);
    const minP = floor(11, opts.minPitchers);
    const minH = floor(11, opts.minHitters);
    if (pitchers.length < minP) fail(`only ${pitchers.length} pitchers, expected at least ${minP}`);
    if (hitters.length < minH) fail(`only ${hitters.length} hitters, expected at least ${minH}`);

    // Rotation: must be exactly 5 valid SP-eligible pitchers.
    const minRot = floor(5, opts.minRotation);
    if (!Array.isArray(team.rotation) || team.rotation.length < minRot) {
      fail(`rotation size ${team.rotation ? team.rotation.length : 0}, expected at least ${minRot}`);
    }
    for (const id of team.rotation) {
      const p = players[id];
      if (!p) fail(`rotation references unknown player id ${id}`);
      if (!p.isPitcher) fail(`rotation contains non-pitcher ${p.name} (${id})`);
    }

    // Bullpen: at least 6 arms plus the closer (the bible 11.2 12-pitcher
    // config is 5 SP + closer + 6 pen), all valid.
    const minPen = floor(6, opts.minBullpen);
    if (!Array.isArray(team.bullpen) || team.bullpen.length < minPen) {
      fail(`bullpen size ${team.bullpen ? team.bullpen.length : 0}, expected at least ${minPen}`);
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
    generate, validateLeagueReadiness, assignBullpenRoles, anointGenerational, syncBornSpeed, mintCone,
    // Exposed for the roster-management UI: position eligibility checks and
    // single-team readiness validation after user-driven roster moves.
    canPlay, aptitudeFor, syncPositions,
    validateTeam: checkTeamReadiness,
    // Post-launch generation + team config rebuild (offseason rollover).
    generateNewPlayer,
    assignLineupsAndPitching,
    // 0.49.0 body model (load migration + offseason fill-out).
    frameFor, youthDeficit, posFrameAdj,
    // 0.53.1: archetype ceiling cap re-clamp (draft/intl slot lifts).
    applyArchetypeCap,
  };
})();
