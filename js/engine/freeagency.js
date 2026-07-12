// Free agency (bible 16): pool building from expired contracts, asking
// prices, player preferences, round-based bidding against AI teams, and
// contract extensions. The FA period runs as an interactive offseason phase
// between rollover parts A and B (see offseason.js).
window.BBGM_FA = (function () {
  const ROSTER = () => window.BBGM_ROSTER;
  const TRADES = () => window.BBGM_TRADES;

  function rand() { return Math.random(); }

  // Scouting department cost against the ownership budget (6.9.1).
  // Defensive: 0 when the scouting module isn't loaded (older harnesses).
  function scoutingCost(team) {
    const SC = window.BBGM_SCOUT;
    return SC ? SC.tierCost(team) : 0;
  }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  const TOTAL_ROUNDS = 8;

  // ---- Payroll ---------------------------------------------------------

  function computePayroll(team, players) {
    let total = 0;
    for (const id of team.roster.concat(team.il || [])) {
      const p = players[id];
      if (p && p.contract) total += p.contract.annualSalary || 0;
    }
    return Math.round(total * 10) / 10;
  }

  // ---- Asking price (16.4) ----------------------------------------------

  function askingPrice(p) {
    const ovr = ROSTER().overall(p);
    let aav = TRADES().expectedAAV(ovr, p.age);
    // Premium positions command premiums; cautious pricing for volatile
    // archetypes (16.4).
    if (!p.isPitcher && ['SS', 'CF', 'C'].includes(p.primaryPosition)) aav *= 1.1;
    if (p.isPitcher && p.primaryPosition === 'RP') aav *= 0.75;
    const arch = p.hidden && p.hidden.archetype;
    if (arch === 'volatile' || arch === 'one_year_wonder') aav *= 0.85;

    // Years by age and quality.
    let years;
    if (p.age <= 28) years = ovr >= 58 ? rint(5, 7) : ovr >= 50 ? rint(3, 5) : rint(1, 3);
    else if (p.age <= 31) years = ovr >= 58 ? rint(4, 5) : ovr >= 50 ? rint(2, 4) : rint(1, 2);
    else if (p.age <= 34) years = ovr >= 58 ? rint(2, 3) : rint(1, 2);
    else years = 1;

    aav = Math.max(0.74, Math.round(aav * 10) / 10);
    return { years, aav, total: Math.round(aav * years * 10) / 10 };
  }

  // Player preferences (16.5) — one or two flavor flags per FA.
  function rollPreferences(p) {
    const prefs = [];
    if (rand() < 0.25) prefs.push('ring');      // wants a contender
    if (rand() < 0.20) prefs.push('loyalty');   // discount for former team
    if (rand() < 0.15) prefs.push(rand() < 0.5 ? 'bigMarket' : 'smallMarket');
    return prefs;
  }

  const PREF_TEXT = {
    ring: 'wants to win now',
    loyalty: 'has strong ties to his old club',
    bigMarket: 'prefers a big market',
    smallMarket: 'prefers a quieter market',
  };

  function prefsText(entry) {
    return (entry.prefs || []).map((k) => PREF_TEXT[k]).join('; ');
  }

  // Utility multiplier a player applies to an offer from a given team.
  function prefMultiplier(state, entry, team) {
    let mul = 1;
    for (const pref of entry.prefs || []) {
      if (pref === 'ring' && (team.competitiveWindow === 'contending' || team.competitiveWindow === 'win-now')) mul *= 1.12;
      if (pref === 'ring' && team.competitiveWindow === 'rebuilding') mul *= 0.85;
      if (pref === 'loyalty' && team.id === entry.formerTeamId) mul *= 1.15;
      if (pref === 'bigMarket' && team.market === 'large') mul *= 1.08;
      if (pref === 'smallMarket' && team.market === 'small') mul *= 1.08;
    }
    return mul;
  }

  // ---- Pool building ------------------------------------------------------

  // Move a player out of his team into the FA pool. Caller handles news.
  function releaseToPool(state, p, reason) {
    const team = state.league.teams.find((t) => t.id === p.teamId);
    if (team) {
      for (const arr of [team.roster, team.minors, team.roster40, team.il]) {
        if (!arr) continue;
        const i = arr.indexOf(p.id);
        if (i >= 0) arr.splice(i, 1);
      }
      ROSTER().replaceRefs(team, state.players, p.id, null);
    }
    if (!state.freeAgents) state.freeAgents = [];
    if (!state.freeAgents.includes(p.id)) state.freeAgents.push(p.id);
    p.formerTeamId = p.teamId;
    p.teamId = null;
    p.status = 'FA';
    p.rosterStatus = 'FA';
    p.faReason = reason;
    p.faSeasons = 0; // fresh unemployment spell (ticked each rollover)
  }

  // Build the market after contracts tick at rollover (offseason.js part A).
  function buildMarket(state) {
    const players = state.players;
    const entries = [];
    for (const pid of state.freeAgents || []) {
      const p = players[pid];
      if (!p || p.retired) continue;
      const ask = askingPrice(p);
      entries.push({
        playerId: pid,
        askYears: ask.years,
        askAAV: ask.aav,
        askTotal: ask.total,
        prefs: rollPreferences(p),
        formerTeamId: p.formerTeamId || null,
        tier: ask.aav >= 16 ? 1 : ask.aav >= 6 ? 2 : 3,
        lastTopBid: null,
        signedTeamId: null,
      });
    }
    // Best asks first — the UI browses in market order.
    entries.sort((a, b) => b.askTotal - a.askTotal);
    state.faMarket = { round: 0, totalRounds: TOTAL_ROUNDS, entries, userOffers: [] };
    return state.faMarket;
  }

  // Insert one player into an already-open market — December non-tenders
  // (18.7) join mid-winter instead of waiting a year.
  function addMarketEntry(state, p) {
    if (!state.faMarket) return null;
    if (state.faMarket.entries.some((e) => e.playerId === p.id)) return null;
    const ask = askingPrice(p);
    const entry = {
      playerId: p.id,
      askYears: ask.years, askAAV: ask.aav, askTotal: ask.total,
      prefs: rollPreferences(p),
      formerTeamId: p.formerTeamId || null,
      tier: ask.aav >= 16 ? 1 : ask.aav >= 6 ? 2 : 3,
      lastTopBid: null, signedTeamId: null,
    };
    state.faMarket.entries.push(entry);
    state.faMarket.entries.sort((a, b) => b.askTotal - a.askTotal);
    return entry;
  }

  // ---- Bidding rounds (16.5 / 16.6 / 16.7) --------------------------------

  // Which tiers are actively signing in a given round: stars first (18.8).
  function tierActive(tier, round) {
    if (tier === 1) return round >= 1;
    if (tier === 2) return round >= 3;
    return round >= 5;
  }

  // AI teams interested in this player right now.
  function aiBidders(state, entry, p) {
    const players = state.players;
    const bidders = [];
    for (const team of state.league.teams) {
      if (team.id === state.meta.userTeamId) continue;
      const payroll = computePayroll(team, players);
      // The scouting department bills against the same ownership budget
      // (6.9.1) — an elite operation leaves less for the FA market.
      const room = team.payrollBase - scoutingCost(team) - payroll;
      if (room < entry.askAAV * 0.85) continue;
      // Need or clear upgrade (16.7).
      TRADES().setPlayersRef(players);
      const needs = TRADES().teamNeeds(team, players);
      const isNeed = p.isPitcher ? needs.includes('SP') && p.primaryPosition === 'SP'
        : needs.includes(p.primaryPosition);
      const goodEnough = ROSTER().overall(p) >= 52;
      if (!isNeed && !goodEnough) continue;
      // Owner archetype appetite (16.7).
      let appetite = { win_now: 0.9, old_school: 0.7, aggressive: 0.5, analytics: 0.45, patient: 0.35, cheap: 0.12 }[team.owner] || 0.5;
      if (entry.tier === 3) appetite = Math.min(0.5, appetite + 0.15); // everyone shops the bargain bin
      if (team.competitiveWindow === 'win-now') appetite += 0.15;
      if (team.competitiveWindow === 'rebuilding' && entry.tier === 1) appetite -= 0.3;
      if (rand() > appetite) continue;
      // Bid: around the ask, scaled by aggression and remaining room.
      const aggression = { win_now: 1.1, old_school: 1.05, aggressive: 1.0, analytics: 0.92, patient: 0.95, cheap: 0.85 }[team.owner] || 1;
      let years = clamp(entry.askYears + (rand() < 0.25 ? -1 : 0), 1, 8);
      if (team.owner === 'patient' && years > 4) years = 4; // no mega-deals (16.7)
      const aav = Math.min(room, entry.askAAV * aggression * (0.92 + rand() * 0.16));
      if (aav < entry.askAAV * 0.6) continue;
      bidders.push({ team, years, total: Math.round(aav * years * 10) / 10 });
    }
    return bidders;
  }

  // Resolve one FA round: active-tier players collect bids and may sign.
  // Returns the list of signings for news.
  function resolveRound(state) {
    const players = state.players;
    const market = state.faMarket;
    if (!market) return [];
    market.round++;
    const signings = [];
    const lateRounds = market.round >= 6;

    for (const entry of market.entries) {
      if (entry.signedTeamId) continue;
      const p = players[entry.playerId];
      if (!p || p.retired) continue;
      if (!tierActive(entry.tier, market.round)) continue;

      // Asking price erodes the longer a player sits (16.8).
      if (tierActive(entry.tier, market.round - 1)) {
        entry.askAAV = Math.round(entry.askAAV * 0.94 * 10) / 10;
        entry.askTotal = Math.round(entry.askAAV * entry.askYears * 10) / 10;
      }

      const bids = aiBidders(state, entry, p);
      // The user's standing offer competes.
      const userOffer = market.userOffers.find((o) => o.playerId === entry.playerId);
      const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);

      let best = null;
      let bestUtility = 0;
      for (const bid of bids) {
        const u = bid.total * prefMultiplier(state, entry, bid.team);
        if (u > bestUtility) { bestUtility = u; best = bid; }
      }
      if (userOffer) {
        const u = userOffer.total * prefMultiplier(state, entry, userTeam);
        if (u > bestUtility) {
          bestUtility = u;
          best = { team: userTeam, years: userOffer.years, total: userOffer.total, isUser: true };
        }
      }

      // Bid visibility signal for the UI (16.6) — fuzzed top rival bid.
      const topRival = bids.length ? Math.max(...bids.map((b) => b.total)) : null;
      entry.lastTopBid = topRival ? Math.round(topRival * (0.95 + rand() * 0.1)) : entry.lastTopBid;
      entry.offersThisRound = bids.length + (userOffer ? 1 : 0);

      if (!best) continue;
      // Accept when the winning offer clears the (eroding) ask — late
      // rounds get desperate (16.8 pillow contracts).
      const acceptFloor = lateRounds ? 0.55 : 0.88;
      if (best.total >= entry.askTotal * acceptFloor) {
        signPlayer(state, best.team, p, best.years, best.total, entry);
        signings.push({ entry, team: best.team, years: best.years, total: best.total, isUser: !!best.isUser });
      }
    }
    // Clear filled user offers.
    market.userOffers = market.userOffers.filter((o) =>
      !market.entries.some((e) => e.playerId === o.playerId && e.signedTeamId));
    return signings;
  }

  function signPlayer(state, team, p, years, total, entry) {
    const aav = Math.round(total / years * 10) / 10;
    p.contract = { years, annualSalary: aav, totalValue: total, signedAt: 'FA' };
    p.teamId = team.id;
    p.acquiredVia = { type: 'fa', year: state.meta.currentDate.year };
    const isMLBDeal = aav >= 1.5 || ROSTER().overall(p) >= 46;
    if (isMLBDeal) {
      team.roster.push(p.id);
      p.status = 'active';
      p.rosterStatus = '26-man';
    } else {
      team.minors.push(p.id);
      p.status = 'minors';
      p.rosterStatus = ROSTER().demotionLevel(p);
    }
    const fi = (state.freeAgents || []).indexOf(p.id);
    if (fi >= 0) state.freeAgents.splice(fi, 1);
    if (entry) entry.signedTeamId = team.id;
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>SIGNING:</strong> ${team.abbr} sign <strong>${p.name}</strong> ` +
            `(${p.primaryPosition}) — ${years} yr / $${total}M.`,
    });
  }

  // User offer management. Returns an error string or null on success.
  function makeUserOffer(state, playerId, years, total) {
    const market = state.faMarket;
    if (!market) return 'Free agency is not open.';
    const entry = market.entries.find((e) => e.playerId === playerId);
    if (!entry || entry.signedTeamId) return 'That player is no longer available.';
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const payroll = computePayroll(userTeam, state.players);
    const aav = total / years;
    const cap = userTeam.payrollBase - scoutingCost(userTeam);
    if (payroll + aav > cap * 1.05) {
      return `That offer would blow the budget ($${payroll.toFixed(1)}M of $${cap.toFixed(0)}M available` +
             (scoutingCost(userTeam) ? `; $${scoutingCost(userTeam)}M funds scouting` : '') + ').';
    }
    market.userOffers = market.userOffers.filter((o) => o.playerId !== playerId);
    market.userOffers.push({ playerId, years, total: Math.round(total * 10) / 10 });
    return null;
  }

  function withdrawUserOffer(state, playerId) {
    if (state.faMarket) {
      state.faMarket.userOffers = state.faMarket.userOffers.filter((o) => o.playerId !== playerId);
    }
  }

  // Mid-season depth signing (16.9): remaining FAs sign minor-league deals.
  function signMidSeason(state, team, playerId) {
    const p = state.players[playerId];
    if (!p || p.status !== 'FA') return 'Not available.';
    p.contract = { years: 1, annualSalary: 0.74, totalValue: 0.74, signedAt: 'FA-minors' };
    p.teamId = team.id;
    p.status = 'minors';
    p.rosterStatus = ROSTER().demotionLevel(p);
    p.acquiredVia = { type: 'fa', year: state.meta.currentDate.year };
    team.minors.push(p.id);
    const fi = (state.freeAgents || []).indexOf(p.id);
    if (fi >= 0) state.freeAgents.splice(fi, 1);
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `${team.abbr} sign <strong>${p.name}</strong> to a minor-league deal.`,
    });
    return null;
  }

  // ---- Extensions (16.11) ---------------------------------------------------

  function extensionAsk(p) {
    const base = askingPrice(p);
    // Pre-FA players take a security discount; walk-year players want
    // near-market money.
    const discount = (p.contract && p.contract.years > 1) ? 0.85 : 0.97;
    return {
      years: base.years,
      total: Math.round(base.total * discount * 10) / 10,
      aav: Math.round(base.aav * discount * 10) / 10,
    };
  }

  // Returns an error string, or null when the player signs.
  function offerExtension(state, p, years, total) {
    const ask = extensionAsk(p);
    // Compare on a per-value basis, tolerant of different year counts.
    const offeredValue = total * (0.9 + Math.min(years, ask.years) / ask.years * 0.1);
    if (offeredValue < ask.total * 0.95) {
      return `He turned it down — his camp is looking for ~${ask.years} yr / $${ask.total}M.`;
    }
    const aav = Math.round(total / years * 10) / 10;
    p.contract = { years, annualSalary: aav, totalValue: Math.round(total * 10) / 10, signedAt: 'extension' };
    if (!state.news) state.news = [];
    const team = state.league.teams.find((t) => t.id === p.teamId);
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>${team ? team.abbr : ''}</strong> extend <strong>${p.name}</strong> — ${years} yr / $${total}M.`,
    });
    return null;
  }

  return {
    TOTAL_ROUNDS,
    computePayroll, askingPrice, prefsText, prefMultiplier,
    releaseToPool, buildMarket, addMarketEntry, resolveRound,
    makeUserOffer, withdrawUserOffer, signMidSeason,
    extensionAsk, offerExtension, signPlayer,
  };
})();
