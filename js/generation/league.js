// League and team generation.
window.BBGM_LEAGUE_GEN = (function () {
  const { rint, pick, shuffle } = window.BBGM_RNG;
  const C = window.BBGM_CONSTANTS;

  function generate(rng) {
    const cities = shuffle(rng, window.BBGM_CITIES).slice(0, 30);

    // Ensure market quotas are met.
    const byMarket = { large: [], mid: [], small: [] };
    for (const c of cities) byMarket[c.market].push(c);

    // Distribute palette so divisions don't share primary colors.
    const palette = shuffle(rng, C.COLOR_PALETTE).slice(0, 30);

    // Build owner archetype distribution: ensure variety.
    const archetypes = [];
    const archDef = C.OWNER_ARCHETYPES;
    while (archetypes.length < 30) {
      for (const a of archDef) archetypes.push(a.key);
    }
    const ownerArr = shuffle(rng, archetypes).slice(0, 30);

    // Park type distribution: 3-4 hitter, 3-4 pitcher, ~2 quirk per league, rest neutral.
    // We'll do per-league.
    const parkTypes = [];
    for (let lg = 0; lg < 2; lg++) {
      const types = [];
      for (let i = 0; i < 4; i++) types.push('hitter');
      for (let i = 0; i < 4; i++) types.push('pitcher');
      for (let i = 0; i < 2; i++) types.push('quirk');
      while (types.length < 15) types.push('neutral');
      parkTypes.push(shuffle(rng, types));
    }

    const teams = [];
    let teamIdx = 0;
    for (let lg = 0; lg < 2; lg++) {
      for (let div = 0; div < 3; div++) {
        for (let slot = 0; slot < 5; slot++) {
          const cityObj = cities[teamIdx];
          const nickname = pickNickname(rng, cityObj);
          const colors = palette[teamIdx];
          const ownerKey = ownerArr[teamIdx];
          const owner = archDef.find((a) => a.key === ownerKey);
          const market = C.MARKET_SIZES.find((m) => m.key === cityObj.market);

          // Payroll
          const variance = 0.95 + rng() * 0.10;
          const baseBudget = Math.round(market.base * owner.payrollMul * variance);

          // Park
          const parkType = parkTypes[lg][div * 5 + slot];
          const ballpark = window.BBGM_BALLPARKS.generate(rng, cityObj.city, parkType);

          const abbr = makeAbbr(cityObj.city, nickname);
          const id = `t${teamIdx}`;

          teams.push({
            id,
            league: C.LEAGUES[lg],
            division: C.DIVISIONS[div],
            city: cityObj.city,
            region: cityObj.region,
            nickname,
            name: `${cityObj.city} ${nickname}`,
            abbr,
            colors,
            market: cityObj.market,
            owner: ownerKey,
            ownerName: owner.name,
            payrollBase: baseBudget,
            ballpark,
            foundedYear: rint(rng, 1900, 1995),
            roster: [],   // 26-man player IDs
            roster40: [], // additional 40-man
            minors: [],   // minor league IDs
            il: [],
            scoutingTier: defaultScoutingTier(ownerKey),
            competitiveWindow: pick(rng, ['rebuilding', 'retooling', 'contending', 'win-now']),
            reputation: rint(rng, 30, 80),
            seasonRecord: { w: 0, l: 0, rs: 0, ra: 0, lastTen: [], streak: 0 },
            lineupRH: [],
            lineupLH: [],
            rotation: [],
            bullpen: [],
            closer: null,
          });
          teamIdx++;
        }
      }
    }

    return { teams };
  }

  function pickNickname(rng, cityObj) {
    if (cityObj.nicknames && cityObj.nicknames.length && rng() < 0.65) {
      return pick(rng, cityObj.nicknames);
    }
    return pick(rng, window.BBGM_NICKNAMES);
  }

  function makeAbbr(city, nickname) {
    const nicknameLetter = nickname[0];
    const cityClean = city.replace(/[^a-zA-Z]/g, '');
    const cityPart = cityClean.slice(0, 2).toUpperCase();
    return (cityPart + nicknameLetter).toUpperCase();
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
