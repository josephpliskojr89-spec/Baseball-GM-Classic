// Free agency (bible 16): pool building from expired contracts, asking
// prices, player preferences, round-based bidding against AI teams, and
// contract extensions. The FA period runs as an interactive offseason phase
// between rollover parts A and B (see offseason.js).
window.BBGM_FA = (function () {
  const ROSTER = () => window.BBGM_ROSTER;
  const TRADES = () => window.BBGM_TRADES;

  function rand() { return Math.random(); }

  // (0.51.0: the scouting bill moved off player payroll onto the
  // operating budget — see team.opsBase / SCOUT.ensureOps.)
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
    // Trade cash considerations (0.36.0): money sent in trades burdens
    // this season's books, money received offsets them. The ledger
    // resets each rollover.
    if (team.tradeCash) {
      total += (team.tradeCash.out || 0) - (team.tradeCash.in || 0);
    }
    return Math.round(total * 10) / 10;
  }

  // ---- Asking price (16.4) ----------------------------------------------

  // Has this player really never seen an MLB field? careerStats only
  // folds in at the rollover, so a kid who DEBUTED this season and was
  // cut reads as career-blank until winter — his current-season line
  // (top-level stats[year].g is MLB-only; farm/indie play lives under
  // minorsLine) is the tie-breaker (W3, 0.68.1).
  function neverPlayedMLB(p) {
    // A posted NPB arm, KBO expat, or Cuban defector (v2.13.1) has zero
    // MLB service but a real professional resume — he negotiates like a
    // veteran, never like the undrafted indie kid. His fake 6-year
    // service stamp is gone; this marker carries the leverage instead.
    if (p.intlEvent) return false;
    if (p.serviceTime && p.serviceTime.years) return false;
    if (p.careerStats && p.careerStats.g > 0) return false;
    for (const y in p.stats || {}) {
      if (p.stats[y] && p.stats[y].g > 0) return false;
    }
    return true;
  }

  function askingPrice(p) {
    const ovr = ROSTER().overall(p);
    // No service, no leverage (0.67.0, user report: an undrafted indie
    // kid was asking mid-rotation money). A free agent who has never
    // played an MLB inning — the undrafted college bat, the intl
    // washout — signs a minor-league deal at the minimum and says
    // thank you. His talent is his upside, not his ask. Scoped to true
    // FAs so extension math for rostered prospects is untouched.
    const neverPlayed = neverPlayedMLB(p);
    if (p.status === 'FA' && neverPlayed) {
      return { years: 1, aav: 0.74, total: 0.74 };
    }
    let aav = TRADES().expectedAAV(ovr, p.age, p);
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
      ROSTER().logTx(state, p,
        reason === 'non-tendered' ? `Non-tendered by ${team.abbr} — entered free agency`
          : reason === 'contract-expired' ? `Contract with ${team.abbr} expired — entered free agency`
            : `Released by ${team.abbr}`);
    }
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
    delete p.extTalks; // any extension talks were with the old club (0.70.0)
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
  function aiBidders(state, entry, p, round) {
    const players = state.players;
    const bidders = [];
    const lateRound = (round || 0) >= 5;
    const desperation = (round || 0) >= 7;
    for (const team of state.league.teams) {
      if (team.id === state.meta.userTeamId) continue;
      const payroll = computePayroll(team, players);
      // 0.51.0: scouting and staff moved to the OPERATING budget
      // (team.opsBase) — player payroll is player money, full stop.
      const room = team.payrollBase - payroll;
      // 0.50.0: the room gate was absolute (85% of ask or no bid at
      // all) — in a mature league with bloated payrolls NOBODY cleared
      // it for a star's ask, so MVPs sat unsigned into Opening Day.
      // Late rounds open the pillow-contract door (bid what you have,
      // down to 30% of the eroding ask); the last two rounds open the
      // minimum-contract door — any club with a roster-minimum dollar
      // can make the spring-bargain call.
      const roomGate = desperation ? 0.74
        : lateRound ? Math.max(2, entry.askAAV * 0.3) : entry.askAAV * 0.85;
      if (room < roomGate) continue;
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
      // A star at a spring-bargain price is free money — every front
      // office takes that call.
      if (desperation && ROSTER().overall(p) >= 56) appetite = Math.max(appetite, 0.8);
      if (rand() > appetite) continue;
      // Bid: around the ask, scaled by aggression and remaining room.
      const aggression = { win_now: 1.1, old_school: 1.05, aggressive: 1.0, analytics: 0.92, patient: 0.95, cheap: 0.85 }[team.owner] || 1;
      let years = clamp(entry.askYears + (rand() < 0.25 ? -1 : 0), 1, 8);
      if (team.owner === 'patient' && years > 4) years = 4; // no mega-deals (16.7)
      // Audit W2 (0.68.0): $0.74M is the league minimum — no contract
      // exists below it. Any bid formula landing under the minimum
      // rounds UP to it (room permitting) instead of dying at the
      // hard-reject below. Without this, the whole min-ask cohort (the
      // 0.67.0 no-leverage kids) was unsignable: analytics' ceiling was
      // 0.74×0.92×1.08 ≈ $0.73M — every bid died at generation and the
      // 0.50.0 desperation machinery never got a bid to accept.
      const aav = Math.max(0.74, Math.min(room, entry.askAAV * aggression * (0.92 + rand() * 0.16)));
      if (room < 0.74) continue;
      if (!desperation && aav < entry.askAAV * (lateRound ? 0.3 : 0.6)) continue;
      // A pillow bid well under ask never carries a long commitment.
      if (lateRound && aav < entry.askAAV * 0.6) years = Math.min(years, desperation ? 1 : 2);
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

      // Asking price erodes the longer a player sits (16.8) — and craters
      // when the phone isn't ringing at all (0.50.0): a market with zero
      // offers is telling the agent something.
      if (tierActive(entry.tier, market.round - 1)) {
        const erode = entry.offersThisRound === 0 ? 0.88 : 0.94;
        // The ask never erodes below the league minimum (0.68.0) — an
        // agent can't advertise a contract that cannot legally exist.
        entry.askAAV = Math.max(0.74, Math.round(entry.askAAV * erode * 10) / 10);
        entry.askTotal = Math.round(entry.askAAV * entry.askYears * 10) / 10;
      }

      const bids = aiBidders(state, entry, p, market.round);
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
      // rounds get desperate (16.8 pillow contracts). The AAV clause
      // (0.50.0) lets a short pillow deal land for a multi-year asker:
      // a 1-2 year bid can never out-TOTAL a 5-year ask, but a player
      // out of options takes the respectable one-year number.
      const acceptFloor = lateRounds ? 0.55 : 0.88;
      const bestAAV = best.total / Math.max(1, best.years);
      // Final round: nobody sits out a season over pride — any offer at
      // the roster minimum or better gets taken (0.50.0).
      const finalRound = market.round >= market.totalRounds;
      if (best.total >= entry.askTotal * acceptFloor ||
          (lateRounds && bestAAV >= entry.askAAV * 0.5) ||
          (finalRound && bestAAV >= 0.74)) {
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
    // League minimum floor (0.79.0): late-round accepts allow bids down
    // to half the ask, which could ink a sub-$0.74M salary. No NABL
    // contract pays below the minimum.
    const aav = Math.max(0.74, Math.round(total / years * 10) / 10);
    total = Math.round(aav * years * 10) / 10;
    p.contract = { years, annualSalary: aav, totalValue: total, signedAt: 'FA' };
    p.teamId = team.id;
    p.acquiredVia = { type: 'fa', year: state.meta.currentDate.year };
    ROSTER().logTx(state, p, `Signed with ${team.abbr} as a free agent — ${years} yr / $${total}M`);
    const isMLBDeal = aav >= 1.5 || ROSTER().overall(p) >= 46;
    if (isMLBDeal) {
      team.roster.push(p.id);
      p.status = 'active';
      p.rosterStatus = '26-man';
      // 26-man cap (0.31.1): FA signings were the one roster door with
      // no trim — signing at a full 26 quietly ran a 27-man roster into
      // the season. The manager demotes the weakest to make room, same
      // as executeTrade (never the man just signed).
      while (team.roster.length > 26) {
        const weakest = team.roster.map((id) => state.players[id])
          .filter((q) => q && q.id !== p.id)
          .sort((a, b) => ROSTER().overall(a) - ROSTER().overall(b))[0];
        if (!weakest) break;
        team.roster.splice(team.roster.indexOf(weakest.id), 1);
        team.minors.push(weakest.id);
        weakest.status = 'minors';
        weakest.rosterStatus = ROSTER().demotionLevel(weakest);
        ROSTER().replaceRefs(team, state.players, weakest.id, null);
      }
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
      go: { type: 'player', id: p.id },
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
    // 0.51.0: scouting/staff bill against opsBase now — the payroll
    // budget is all player money.
    const cap = userTeam.payrollBase;
    if (payroll + aav > cap * 1.05) {
      return `That offer would blow the payroll budget ($${payroll.toFixed(1)}M committed of $${cap.toFixed(0)}M).`;
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
    // Abroad (0.74.0): under contract in Japan/Korea until the winter
    // rollover brings him home. The pool never lists him, but the guard
    // holds even if a card reaches this path some other way.
    if (p.abroadYear != null) return 'He\'s under contract overseas — back on the market this winter.';
    p.contract = { years: 1, annualSalary: 0.74, totalValue: 0.74, signedAt: 'FA-minors' };
    p.teamId = team.id;
    p.status = 'minors';
    p.rosterStatus = ROSTER().demotionLevel(p);
    p.acquiredVia = { type: 'fa', year: state.meta.currentDate.year };
    ROSTER().logTx(state, p, `Signed a minor-league deal with ${team.abbr}`);
    team.minors.push(p.id);
    const fi = (state.freeAgents || []).indexOf(p.id);
    if (fi >= 0) state.freeAgents.splice(fi, 1);
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `${team.abbr} sign <strong>${p.name}</strong> to a minor-league deal.`,
      go: { type: 'player', id: p.id },
    });
    return null;
  }

  // AI mid-season pool sweep (0.50.0). Before this, signMidSeason was
  // wired to the user's UI only — no AI club ever touched the pool after
  // the winter's 8 rounds, so a stranded star (a 70-overall ace, a
  // three-time MVP) sat unsigned ALL SEASON (user report). Three times a
  // month, AI clubs scoop the best remaining FAs who genuinely upgrade
  // them: he must out-grade the club's weakest same-side regular by 2+,
  // the club must have any payroll room at all, and the deal is one year
  // at a discount (a stray mid-season signing has no leverage). At most
  // two signings per tick — a drip, not a feeding frenzy.
  function aiMidSeasonTick(state, today) {
    if (state.meta.offseasonPhase || state.postseason) return [];
    if (today.day !== 5 && today.day !== 15 && today.day !== 25) return [];
    const players = state.players;
    const R = ROSTER();
    const strays = (state.freeAgents || []).map((id) => players[id])
      .filter((p) => p && !p.retired && p.status === 'FA' && R.overall(p) >= 52)
      .sort((a, b) => R.overall(b) - R.overall(a))
      .slice(0, 2);
    const signings = [];
    for (const p of strays) {
      const ovr = R.overall(p);
      let best = null;
      for (const team of state.league.teams) {
        if (team.id === state.meta.userTeamId) continue;
        const payroll = computePayroll(team, players);
        const room = team.payrollBase - payroll;
        if (room < 0.74) continue;
        const regs = p.isPitcher
          ? (team.rotation || []).concat(team.bullpen || [])
          : (team.lineupRH || []).map((s) => s.playerId);
        const ovrs = regs.map((id) => players[id]).filter(Boolean).map((q) => R.overall(q));
        if (!ovrs.length) continue;
        const weakest = Math.min(...ovrs);
        if (ovr < weakest + 2) continue;
        const score = (ovr - weakest) + Math.min(10, room) * 0.1;
        if (!best || score > best.score) best = { team, room, score };
      }
      if (!best) continue;
      const aav = Math.max(0.74, Math.round(
        Math.min(best.room, TRADES().expectedAAV(ovr, p.age) * 0.5) * 10) / 10);
      signPlayer(state, best.team, p, 1, aav, null);
      // Slot him into the on-field configs immediately — signPlayer fills
      // the roster spot, but a pitcher outside rotation/bullpen would be
      // an orphan (the 0.25.1 bug class).
      try { R.safeRebuild(state, best.team); } catch (e) {
        console.error(`Mid-season signing rebuild failed for ${best.team.abbr}:`, e);
      }
      signings.push({ playerId: p.id, teamId: best.team.id, aav });
    }

    // The indie radar (0.67.0, user report): every club's scouts watch
    // the unsigned kids too. The 52+ sweep above signs immediate
    // big-league upgrades; this lane stashes the obvious ORG player —
    // the undrafted college bat at 46-51 with zero service time — on a
    // minor-league deal before he sits all summer. One kid, ~35% per
    // tick (three ticks a month): the window to beat the league to him
    // is real but short — days to weeks, not forever.
    if (rand() < 0.35) {
      const stash = (state.freeAgents || []).map((id) => players[id])
        .filter((p) => p && !p.retired && p.status === 'FA' && p.age <= 27 &&
          neverPlayedMLB(p))
        .filter((p) => { const o = R.overall(p); return o >= 46 && o < 52; })
        .sort((a, b) => R.overall(b) - R.overall(a))[0];
      if (stash) {
        const clubs = state.league.teams.filter((t) => t.id !== state.meta.userTeamId);
        const club = clubs[Math.floor(rand() * clubs.length)];
        signMidSeason(state, club, stash.id);
        signings.push({ playerId: stash.id, teamId: club.id, aav: 0.74, minors: true });
      }
    }
    return signings;
  }

  // ---- Extensions (16.11, rebuilt 0.70.0) -----------------------------------
  // Real negotiations: the ask is STAMPED when talks open (no re-roll per
  // tap), rejected offers stiffen the camp, insulting ones close the book
  // for the season, and some players simply want to test the market — a
  // blow-away offer is the only thing that keeps them off it.

  // Deterministic per (player, year): reload-scumming doesn't re-roll a
  // man's intentions.
  function extHash(p, year) {
    let h = year >>> 0;
    const s = String(p.id);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function extensionAsk(state, p) {
    const base = askingPrice(p);
    const ctrl = p.contract ? (p.contract.years || 0) : 0;
    // Security discount scales with distance from the open market: a kid
    // three control years out sells cheap for his first guarantee; a
    // walk-year man is already smelling November.
    const discount = ctrl >= 3 ? 0.78 : ctrl === 2 ? 0.86 : 0.97;
    // First-guarantee youth discount — pre-arb money changes a life.
    const youth = (p.age <= 25 && (p.serviceTime.years || 0) <= 3) ? 0.95 : 1;
    // Young extensions run long (the team buys FA years, the kid takes
    // the decade of certainty).
    const years = Math.min(8, base.years + (ctrl >= 2 && p.age <= 27 ? 1 : 0));
    const aav = Math.max(0.74, Math.round(base.aav * discount * youth * 10) / 10);
    return { years, aav, total: Math.round(aav * years * 10) / 10 };
  }

  // Open (or resume) this season's talks. Stamps the ask once per year;
  // insults and closures persist until the calendar turns.
  function extensionTalks(state, p) {
    const year = state.meta.currentDate.year;
    if (!p.extTalks || p.extTalks.year !== year) {
      const ask = extensionAsk(state, p);
      const ctrl = p.contract ? (p.contract.years || 0) : 0;
      const ovr = ROSTER().overall(p);
      // Market testers: a walk-year star with the leverage to bet on
      // himself often does. ~40% of them; deterministic per (player, year).
      const wantsMarket = ctrl <= 1 && ovr >= 58 && (extHash(p, year) % 10) < 4;
      p.extTalks = { year, askYears: ask.years, askAAV: ask.aav,
        askTotal: ask.total, insults: 0, closed: false,
        wantsMarket: wantsMarket || undefined };
    }
    return p.extTalks;
  }

  // Returns an error/feedback string, or null when the player signs.
  function offerExtension(state, p, years, total) {
    const talks = extensionTalks(state, p);
    if (talks.closed) {
      return 'His camp has closed the book on extension talks this season — he\'ll listen again next year.';
    }
    // Shorter deals need richer per-year money; a market tester only
    // signs for a number that makes November irrelevant.
    const fairTotal = talks.askAAV * years * (1 + 0.02 * Math.max(0, talks.askYears - years));
    const need = talks.wantsMarket ? fairTotal * 1.12 : fairTotal * 0.97;
    if (total >= need) {
      const aav = Math.round(total / years * 10) / 10;
      p.contract = { years, annualSalary: aav, totalValue: Math.round(total * 10) / 10, signedAt: 'extension' };
      delete p.extTalks;
      if (!state.news) state.news = [];
      const team = state.league.teams.find((t) => t.id === p.teamId);
      ROSTER().logTx(state, p,
        `Signed a ${years}-yr / $${p.contract.totalValue}M extension${team ? ` with ${team.abbr}` : ''}`);
      state.news.push({
        date: { ...state.meta.currentDate },
        body: `<strong>${team ? team.abbr : ''}</strong> extend <strong>${p.name}</strong> — ${years} yr / $${total}M.`,
      });
      return null;
    }
    // Rejected. A merely-light offer stiffens the ask; an insulting one
    // (sub-85% of fair) counts double, and three strikes end the talks.
    talks.insults += total < fairTotal * 0.85 ? 2 : 1;
    talks.askAAV = Math.round(talks.askAAV * 1.03 * 10) / 10;
    talks.askTotal = Math.round(talks.askAAV * talks.askYears * 10) / 10;
    if (talks.insults >= 3) {
      talks.closed = true;
      return 'That did it — his agent hung up. Talks are closed for the season; he\'ll see you in the winter.';
    }
    if (talks.wantsMarket) {
      return `He turned it down. His camp wants to test the market — it would take a blow-away ` +
             `number to keep him off it (think north of $${Math.round(talks.askTotal * 1.12)}M).`;
    }
    return `He turned it down — and the tone got cooler. His camp now wants ` +
           `~${talks.askYears} yr / $${talks.askTotal}M.`;
  }

  // AI winter extensions (0.70.0): clubs lock up their own walk-year
  // players BEFORE the contract tick, so a re-signed cornerstone never
  // touches the pool — real FA classes are thin because the best names
  // never reach them. keepMul-consistent: contenders keep stars,
  // rebuilders keep only young cornerstones and let vets walk.
  function aiWinterExtensions(state) {
    const players = state.players;
    const R = ROSTER();
    const year = state.meta.currentDate.year;
    const done = [];
    for (const team of state.league.teams) {
      if (team.id === state.meta.userTeamId) continue;
      let room = team.payrollBase - computePayroll(team, players);
      let extended = 0;
      const cands = team.roster.map((id) => players[id])
        .filter((p) => p && !p.retired && p.contract && p.contract.years === 1 &&
          (p.serviceTime.years || 0) + 1 >= 6 && p.age <= 33)
        .sort((a, b) => R.overall(b) - R.overall(a));
      for (const p of cands) {
        if (extended >= 2) break;
        const ovr = R.overall(p);
        if (ovr < 52) continue;
        const win = team.competitiveWindow;
        let prob = ovr >= 60 ? 0.65 : ovr >= 56 ? 0.45 : 0.25;
        if (win === 'rebuilding') prob = (p.age <= 27 && ovr >= 55) ? 0.5 : 0.05;
        else if (win === 'retooling') prob *= 0.6;
        else if (win === 'win-now') prob *= 1.2;
        // His side of the table: a market tester makes even his own club
        // pay the blow-away premium, and usually walks anyway.
        const tester = ovr >= 58 && (extHash(p, year) % 10) < 4;
        if (tester) prob *= 0.35;
        if (rand() >= prob) continue;
        const ask = extensionAsk(state, p);
        const aav = Math.round(ask.aav * (tester ? 1.14 : 1) * 10) / 10;
        if (aav > room) continue; // can't afford the number
        p.contract = { years: ask.years, annualSalary: aav,
          totalValue: Math.round(aav * ask.years * 10) / 10, signedAt: 'extension' };
        ROSTER().logTx(state, p,
          `Signed a ${ask.years}-yr / $${p.contract.totalValue}M extension with ${team.abbr}`);
        delete p.extTalks;
        room -= aav;
        extended++;
        done.push({ playerId: p.id, teamId: team.id, name: p.name,
          years: ask.years, total: p.contract.totalValue, ovr: Math.round(ovr) });
        if (ovr >= 56) {
          if (!state.news) state.news = [];
          state.news.push({
            date: { ...state.meta.currentDate },
            body: `<strong>${team.abbr}</strong> lock up <strong>${p.name}</strong> before he hits ` +
                  `the market — ${ask.years} yr / $${p.contract.totalValue}M.`,
            go: { type: 'player', id: p.id },
          });
        }
      }
    }
    return done;
  }

  return {
    TOTAL_ROUNDS,
    computePayroll, askingPrice, neverPlayedMLB, prefsText, prefMultiplier,
    releaseToPool, buildMarket, addMarketEntry, resolveRound,
    makeUserOffer, withdrawUserOffer, signMidSeason, aiMidSeasonTick,
    extensionAsk, extensionTalks, offerExtension, aiWinterExtensions, signPlayer,
  };
})();
