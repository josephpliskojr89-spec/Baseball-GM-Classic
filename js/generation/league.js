// League generation. Identity (id, city, nickname, abbr, league, division,
// colors, market) comes from the fixed BBGM_TEAMS database in data/teams.js.
// Per-save randomness lives in owner archetype, ballpark, founded year, and
// initial competitive-window state — that variety persists between saves
// while team identity stays stable.
window.BBGM_LEAGUE_GEN = (function () {
  const { rint, pick, shuffle } = window.BBGM_RNG;
  const C = window.BBGM_CONSTANTS;

  function generate(rng) {
    if (!Array.isArray(window.BBGM_TEAMS) || window.BBGM_TEAMS.length !== 30) {
      throw new Error('BBGM_TEAMS missing or not 30 teams — load order issue?');
    }

    // Owner archetype distribution: ensure variety across the league.
    const archetypes = [];
    const archDef = C.OWNER_ARCHETYPES;
    while (archetypes.length < 30) {
      for (const a of archDef) archetypes.push(a.key);
    }
    const ownerArr = shuffle(rng, archetypes).slice(0, 30);

    // Park type distribution: 4 hitter, 4 pitcher, 2 quirk, 5 neutral per
    // league. Same as before, just keyed by east/west.
    const parkTypesByLeague = {};
    for (const lg of ['east', 'west']) {
      const types = [];
      for (let i = 0; i < 4; i++) types.push('hitter');
      for (let i = 0; i < 4; i++) types.push('pitcher');
      for (let i = 0; i < 2; i++) types.push('quirk');
      while (types.length < 15) types.push('neutral');
      parkTypesByLeague[lg] = shuffle(rng, types);
    }
    const parkTypeIdx = { east: 0, west: 0 };

    const teams = [];
    for (let teamIdx = 0; teamIdx < window.BBGM_TEAMS.length; teamIdx++) {
      const def = window.BBGM_TEAMS[teamIdx];
      const ownerKey = ownerArr[teamIdx];
      const owner = archDef.find((a) => a.key === ownerKey);
      const market = C.MARKET_SIZES.find((m) => m.key === def.market);

      // Per-save payroll variance.
      const variance = 0.95 + rng() * 0.10;
      const baseBudget = Math.round(market.base * owner.payrollMul * variance);

      // Ballpark — random per save.
      const parkType = parkTypesByLeague[def.league][parkTypeIdx[def.league]++];
      const ballpark = window.BBGM_BALLPARKS.generate(rng, def.city, parkType);

      teams.push({
        // ---- Identity (from fixed DB) ----
        id: def.id,
        league: def.league,
        division: def.division,
        city: def.city,
        nickname: def.nickname,
        name: `${def.city} ${def.nickname}`,
        abbr: def.abbr,
        colors: { primary: def.primaryColor, secondary: def.secondaryColor },
        market: def.market,

        // ---- Per-save randomized ----
        owner: ownerKey,
        ownerName: owner.name,
        payrollBase: baseBudget,
        ballpark,
        foundedYear: rint(rng, 1900, 1995),
        competitiveWindow: pick(rng, ['rebuilding', 'retooling', 'contending', 'win-now']),
        reputation: rint(rng, 30, 80),
        scoutingTier: defaultScoutingTier(ownerKey),

        // ---- Runtime state ----
        roster: [],
        roster40: [],
        minors: [],
        il: [],
        seasonRecord: { w: 0, l: 0, rs: 0, ra: 0, lastTen: [], streak: 0 },
        lineupRH: [],
        lineupLH: [],
        rotation: [],
        bullpen: [],
        closer: null,
      });
    }

    return { teams };
  }

  function defaultScoutingTier(ownerKey) {
    switch (ownerKey) {
      case 'patient': return 'above_average';
      case 'analytics': return 'above_average';
      case 'aggressive': return 'above_average';
      case 'cheap': return 'standard';
      case 'old_school': return 'standard';
      case 'win_now':
      default: return 'standard';
    }
  }

  return { generate };
})();
