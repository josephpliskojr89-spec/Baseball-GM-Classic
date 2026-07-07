// Trade system (bible 15): player valuation, team-perspective modifiers,
// proposal evaluation, execution, and AI-driven league trade activity.
window.BBGM_TRADES = (function () {
  const ROSTER = () => window.BBGM_ROSTER;
  const GEN = () => window.BBGM_PLAYER_GEN;
  const D = () => window.BBGM_DATES;

  function rand() { return Math.random(); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // ---- Player Trade Value (15.3), 0-100 scale ------------------------------

  // Expected market AAV ($M) for a player of a given overall — used for
  // contract-burden math and FA asking prices.
  function expectedAAV(overall, age) {
    let aav = Math.max(0.74, (overall - 44) * 1.55);
    if (age >= 35) aav *= 0.65;
    else if (age >= 33) aav *= 0.85;
    return Math.round(aav * 10) / 10;
  }

  const LEVEL_RISK = { AAA: 1.0, AA: 0.78, 'A+': 0.58, A: 0.44, Rookie: 0.34 };

  function tradeValue(p) {
    if (p.status === 'minors') return prospectValue(p);
    return mlbValue(p);
  }

  function mlbValue(p) {
    const ovr = ROSTER().overall(p);
    // Production: 45 overall ≈ fringe (TV ~10), 60 ≈ All-Star (~48),
    // 75+ ≈ superstar (75+ before youth/contract bonuses).
    let tv = clamp((ovr - 40) * 2.4, 0, 88);

    // Age and upside (15.3): the young get a premium, the old a discount.
    if (p.age <= 26) tv *= 1 + (27 - p.age) * 0.05;
    else if (p.age >= 31) tv *= Math.max(0.35, 1 - (p.age - 30) * 0.08);

    // Team control: more contract years = more value (capped at 5).
    const years = Math.min(5, (p.contract && p.contract.years) || 1);
    tv *= 0.85 + years * 0.06;

    // Contract burden: cheap production is worth extra, albatrosses less.
    const surplus = expectedAAV(ROSTER().overall(p), p.age) - ((p.contract && p.contract.annualSalary) || 0.74);
    tv += clamp(surplus * 0.7, -18, 12);

    // Role and position scarcity.
    if (p.isPitcher) {
      if (p.primaryPosition === 'RP') tv *= 0.65;
      else if (p.primaryPosition === 'CP') tv *= 0.78;
    } else if (['SS', 'CF', 'C'].includes(p.primaryPosition)) {
      tv *= 1.08;
    } else if (p.primaryPosition === '2B') {
      tv *= 1.03;
    }

    // Injury history: severe stints scare buyers.
    const severe = (p.injuryHistory || []).filter((i) =>
      i.severity === '60-day' || i.severity === 'season-ending').length;
    tv *= Math.max(0.7, 1 - severe * 0.07);

    return clamp(tv, 0, 100);
  }

  function prospectValue(p) {
    const c = p.hidden.ceiling;
    const keys = Object.keys(c);
    let ceilAvg = 0;
    for (const k of keys) ceilAvg += c[k];
    ceilAvg /= keys.length;
    let tv = clamp((ceilAvg - 44) * 2.0, 0, 62);
    tv *= LEVEL_RISK[p.rosterStatus] != null ? LEVEL_RISK[p.rosterStatus] : 0.5;
    // Young-for-level is the classic breakout indicator.
    const youngAge = { AAA: 23, AA: 22, 'A+': 21, A: 20, Rookie: 19 }[p.rosterStatus] || 22;
    if (p.age <= youngAge) tv *= 1.2;
    else if (p.age >= youngAge + 3) tv *= 0.6;
    return clamp(tv, 0, 100);
  }

  // ---- Team-perspective value (15.4) ---------------------------------------
  // How much THIS team values a player it would ACQUIRE. Window state and
  // owner archetype shift what they pay for veterans vs prospects.
  function teamValueOf(team, p) {
    let tv = tradeValue(p);
    const win = team.competitiveWindow;
    const isProspect = p.status === 'minors';
    const expiring = !isProspect && p.contract && p.contract.years <= 1;
    const youngControlled = !isProspect && p.age <= 26 && p.contract && p.contract.years >= 3;

    if (win === 'rebuilding') {
      if (isProspect) tv *= 1.25;
      if (youngControlled) tv *= 1.15;
      if (expiring && p.age >= 30) tv *= 0.6; // no use for rentals
    } else if (win === 'contending') {
      if (isProspect) tv *= 0.8;
      if (expiring) tv *= 1.15; // rentals welcome
      if (!isProspect && ROSTER().overall(p) >= 55) tv *= 1.1;
    } else if (win === 'win-now') {
      if (isProspect) tv *= 0.65;
      if (expiring) tv *= 1.25;
      if (!isProspect && ROSTER().overall(p) >= 55) tv *= 1.2;
    } // retooling: neutral

    switch (team.owner) {
      case 'patient':
        if (isProspect) tv *= 1.15;
        break;
      case 'cheap':
        if (!isProspect && p.contract && p.contract.annualSalary > 12) tv *= 0.75;
        break;
      case 'old_school':
        if (!isProspect && p.age >= 30) tv *= 1.1;
        if (isProspect) tv *= 0.9;
        break;
      case 'win_now':
        if (!isProspect && ROSTER().overall(p) >= 55) tv *= 1.1;
        break;
    }
    // A team's need at the player's position sweetens their view slightly.
    if (!p.isPitcher && teamNeeds(team, windowPlayers(team)).includes(p.primaryPosition)) tv *= 1.1;
    return tv;
  }

  let _playersRef = null;
  function setPlayersRef(players) { _playersRef = players; }
  function windowPlayers() { return _playersRef; }

  // Weakest starting positions (public "team interest" panel, 15.5).
  function teamNeeds(team, players) {
    if (!players) return [];
    const needs = [];
    const starters = {};
    for (const spot of team.lineupRH || []) {
      const p = players[spot.playerId];
      if (p) starters[spot.position] = ROSTER().overall(p);
    }
    for (const pos in starters) {
      if (pos !== 'DH' && starters[pos] < 46) needs.push(pos);
    }
    // Rotation depth.
    const rotOvr = (team.rotation || []).map((id) => players[id]).filter(Boolean)
      .map((p) => ROSTER().overall(p));
    if (rotOvr.length && rotOvr.sort((a, b) => b - a)[Math.min(3, rotOvr.length - 1)] < 46) needs.push('SP');
    return needs.slice(0, 3);
  }

  // ---- Trade legality / shape checks ---------------------------------------

  function tradesAllowed(state) {
    if (state.meta.offseasonPhase) return true; // offseason window
    const t = state.meta.currentDate;
    // Regular season up to the July 31 deadline (15.10).
    return t.month < 8;
  }

  // Both teams must remain structurally playable: catcher floor, SP floor,
  // rough P/H balance, and coverage for every defensive position (counting
  // org minors depth, which can be promoted to patch a hole).
  function validateTradeShape(state, teamA, giveA, teamB, giveB) {
    const players = state.players;
    function check(team, out, incoming) {
      const outIds = new Set(out.map((p) => p.id));
      const roster = team.roster.map((id) => players[id]).filter((p) => p && !outIds.has(p.id))
        .concat(incoming.filter((p) => p.status !== 'minors'));
      const c = roster.filter((p) => !p.isPitcher && p.primaryPosition === 'C').length;
      const sp = roster.filter((p) => p.isPitcher && p.primaryPosition === 'SP').length;
      const pitchers = roster.filter((p) => p.isPitcher).length;
      const hitters = roster.length - pitchers;
      if (c < 2) return `${team.abbr} would be left without two catchers`;
      if (sp < 5) return `${team.abbr} would be left without five starters`;
      if (pitchers < 11) return `${team.abbr} would be left with too few pitchers`;
      if (hitters < 11) return `${team.abbr} would be left with too few position players`;
      // Position coverage: the post-trade org (26-man + minors, minus the
      // outgoing players) must be able to field all eight positions.
      const orgHitters = roster.concat(
        (team.minors || []).map((id) => players[id]).filter((p) => p && !outIds.has(p.id)),
        incoming.filter((p) => p.status === 'minors'));
      for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
        if (!orgHitters.some((p) => !p.isPitcher && GEN().canPlay(p, pos))) {
          return `${team.abbr} would have nobody who can play ${pos}`;
        }
      }
      return null;
    }
    return check(teamA, giveA, giveB) || check(teamB, giveB, giveA);
  }

  // ---- Evaluation (15.6) ----------------------------------------------------
  // give = players the PROPOSER sends; get = players the AI team sends.
  // cashGive/cashGet in $M (max 20 per side, 15.2).
  function evaluateProposal(state, aiTeam, give, get, cashGive, cashGet) {
    setPlayersRef(state.players);
    if (!tradesAllowed(state)) {
      return { verdict: 'reject', feedback: 'The trade deadline has passed — talk to us in November.' };
    }
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const shapeIssue = validateTradeShape(state, userTeam, give, aiTeam, get);
    if (shapeIssue) return { verdict: 'reject', feedback: `Can't make that work: ${shapeIssue}.` };

    // Cash converts at ~0.6 TV per $M (cash is fungible but capped).
    const CASH_TV = 0.6;
    const incoming = give.reduce((s, p) => s + teamValueOf(aiTeam, p), 0) + (cashGive || 0) * CASH_TV;
    const outgoing = get.reduce((s, p) => s + teamValueOf(aiTeam, p), 0) + (cashGet || 0) * CASH_TV;

    if (outgoing <= 0.01) return { verdict: 'reject', feedback: 'They aren\'t interested in moving nothing.' };
    const ratio = incoming / outgoing;

    if (ratio >= 0.9) {
      return { verdict: 'accept', ratio };
    }
    if (ratio >= 0.7) {
      const gap = outgoing - incoming;
      return {
        verdict: 'counter', ratio, gap,
        feedback: pickFeedback(aiTeam, give, get, gap),
      };
    }
    return {
      verdict: 'reject', ratio,
      feedback: 'They rejected it outright — the offer isn\'t close. ' + pickFeedback(aiTeam, give, get, outgoing - incoming),
    };
  }

  function pickFeedback(aiTeam, give, get, gap) {
    const needs = teamNeeds(aiTeam, _playersRef);
    if (gap > 25) return 'They\'d want a top prospect or an established starter added.';
    if (needs.length && rand() < 0.5) return `They're focused on ${needs.join(' / ')} help.`;
    if (gap > 10) return 'They need meaningfully more value to move on this.';
    return 'They\'re close — a little more would get it done.';
  }

  // Suggest the cheapest user asset that closes the gap (counter mechanics).
  function suggestAddition(state, userTeam, gap, alreadyGiving) {
    setPlayersRef(state.players);
    const players = state.players;
    const giving = new Set(alreadyGiving.map((p) => p.id));
    const pool = userTeam.roster.concat(userTeam.minors || [])
      .map((id) => players[id])
      .filter((p) => p && !giving.has(p.id));
    let best = null;
    for (const p of pool) {
      const tv = tradeValue(p);
      if (tv >= gap * 0.9 && (!best || tv < tradeValue(best))) best = p;
    }
    return best;
  }

  // ---- Execution (15.11 history, roster reconciliation) --------------------

  function executeTrade(state, teamA, playersA, teamB, playersB, cashA, cashB) {
    const players = state.players;
    const year = state.meta.currentDate.year;

    function moveOut(team, list) {
      for (const p of list) {
        for (const arr of [team.roster, team.minors, team.roster40, team.il]) {
          if (!arr) continue;
          const i = arr.indexOf(p.id);
          if (i >= 0) arr.splice(i, 1);
        }
        ROSTER().replaceRefs(team, players, p.id, null);
      }
    }
    function moveIn(team, list) {
      for (const p of list) {
        p.teamId = team.id;
        if (p.status === 'minors') {
          team.minors.push(p.id);
        } else if (p.rosterStatus === 'IL') {
          team.il = team.il || [];
          team.il.push(p.id);
        } else {
          team.roster.push(p.id);
          p.status = 'active';
          p.rosterStatus = '26-man';
        }
        p.acquiredVia = { type: 'trade', year, fromTeamId: p.teamId === teamA.id ? teamB.id : teamA.id };
      }
    }
    moveOut(teamA, playersA);
    moveOut(teamB, playersB);
    moveIn(teamB, playersA);
    moveIn(teamA, playersB);

    // Rebalance both 26-mans (a 2-for-1 leaves one side over, one short).
    for (const team of [teamA, teamB]) {
      while (team.roster.length > 26) {
        const weakest = team.roster.map((id) => players[id]).filter(Boolean)
          .sort((a, b) => ROSTER().overall(a) - ROSTER().overall(b))[0];
        if (!weakest) break;
        team.roster.splice(team.roster.indexOf(weakest.id), 1);
        team.minors.push(weakest.id);
        weakest.status = 'minors';
        weakest.rosterStatus = 'AAA';
        ROSTER().replaceRefs(team, players, weakest.id, null);
      }
      while (team.roster.length < 26) {
        const up = ROSTER().bestCallUp(team, players, rand() < 0.5, null);
        if (!up) break;
        team.minors.splice(team.minors.indexOf(up.id), 1);
        team.roster.push(up.id);
        up.status = 'active';
        up.rosterStatus = '26-man';
      }
      // Rebuild configs — guaranteed-convergent, fail-loud (roster.js).
      ROSTER().safeRebuild(state, team);
    }

    // History (15.11).
    if (!state.history) state.history = { seasons: [] };
    if (!state.history.trades) state.history.trades = [];
    const entry = {
      year,
      date: { ...state.meta.currentDate },
      teamA: teamA.id, teamB: teamB.id,
      playersA: playersA.map((p) => ({ id: p.id, name: p.name })),
      playersB: playersB.map((p) => ({ id: p.id, name: p.name })),
      cashA: cashA || 0, cashB: cashB || 0,
    };
    state.history.trades.push(entry);
    if (state.history.trades.length > 300) state.history.trades = state.history.trades.slice(-300);
    return entry;
  }

  function tradeNews(state, entry) {
    const teamOf = (id) => state.league.teams.find((t) => t.id === id);
    const a = teamOf(entry.teamA), b = teamOf(entry.teamB);
    const namesA = entry.playersA.map((p) => p.name).join(', ') || 'cash';
    const namesB = entry.playersB.map((p) => p.name).join(', ') || 'cash';
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>TRADE:</strong> ${a.abbr} send ${namesA}${entry.cashA ? ` (+$${entry.cashA}M)` : ''} ` +
            `to ${b.abbr} for ${namesB}${entry.cashB ? ` (+$${entry.cashB}M)` : ''}.`,
    });
  }

  // ---- AI league activity (15.7) --------------------------------------------

  // Called daily from the sim loop. Occasionally produces an AI-AI trade
  // (news) or an unsolicited offer to the user (pending offer + news).
  function aiTradeTick(state, today) {
    if (!tradesAllowed(state)) return;
    setPlayersRef(state.players);
    const deadlineWeek = today.month === 7 && today.day >= 24;
    // League-wide AI-AI trade chance per day (multiple rolls at the
    // deadline — 15.10's activity surge).
    const aiAiProb = deadlineWeek ? 0.55 : 0.10;
    if (rand() < aiAiProb) tryAiAiTrade(state);
    if (deadlineWeek && rand() < 0.35) tryAiAiTrade(state);
    // Unsolicited offer to the user (15.5): ~1-3/month, more at deadline.
    const offerProb = deadlineWeek ? 0.18 : 0.05;
    if (rand() < offerProb) tryAiOfferToUser(state);
    // Expire stale pending offers (7 in-game days).
    if (state.pendingTradeOffers) {
      state.pendingTradeOffers = state.pendingTradeOffers.filter((o) =>
        D().diffDays(o.date, today) <= 7);
    }
  }

  function tryAiAiTrade(state) {
    const players = state.players;
    const teams = state.league.teams.filter((t) => t.id !== state.meta.userTeamId);
    const buyers = teams.filter((t) => t.competitiveWindow === 'contending' || t.competitiveWindow === 'win-now');
    const sellers = teams.filter((t) => t.competitiveWindow === 'rebuilding' || t.competitiveWindow === 'retooling');
    if (!buyers.length || !sellers.length) return;
    const buyer = buyers[Math.floor(rand() * buyers.length)];
    const seller = sellers[Math.floor(rand() * sellers.length)];
    if (buyer.id === seller.id) return;

    // Seller shops a veteran (expiring or expensive); buyer pays prospects.
    const vets = seller.roster.map((id) => players[id]).filter((p) => p &&
      p.age >= 28 && ROSTER().overall(p) >= 48 &&
      window.BBGM_INJURIES.isAvailable(p));
    if (!vets.length) return;
    const vet = vets[Math.floor(rand() * vets.length)];
    const vetTV = teamValueOf(buyer, vet);

    // Package 1-2 buyer prospects within ~±12% of the vet's value.
    const prospects = (buyer.minors || []).map((id) => players[id]).filter(Boolean)
      .sort((a, b) => tradeValue(b) - tradeValue(a));
    let pkg = null;
    for (let i = 0; i < prospects.length; i++) {
      const one = tradeValue(prospects[i]);
      if (one >= vetTV * 0.82 && one <= vetTV * 1.25) { pkg = [prospects[i]]; break; }
      for (let j = i + 1; j < prospects.length; j++) {
        const two = one + tradeValue(prospects[j]);
        if (two >= vetTV * 0.85 && two <= vetTV * 1.25) { pkg = [prospects[i], prospects[j]]; break; }
      }
      if (pkg) break;
    }
    if (!pkg) return;
    // Seller must value the prospect package enough.
    const sellerIn = pkg.reduce((s, p) => s + teamValueOf(seller, p), 0);
    if (sellerIn < teamValueOf(seller, vet) * 0.8) return;
    if (validateTradeShape(state, seller, [vet], buyer, pkg)) return;

    const entry = executeTrade(state, seller, [vet], buyer, pkg, 0, 0);
    tradeNews(state, entry);
  }

  function tryAiOfferToUser(state) {
    const players = state.players;
    const user = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const others = state.league.teams.filter((t) => t.id !== user.id);
    const aiTeam = others[Math.floor(rand() * others.length)];

    // The AI covets one of the user's better tradeable pieces.
    const targets = user.roster.concat(user.minors || []).map((id) => players[id])
      .filter((p) => p && tradeValue(p) >= 15 && tradeValue(p) <= 70);
    if (!targets.length) return;
    const target = targets[Math.floor(rand() * targets.length)];
    const targetTV = tradeValue(target);

    // Their offer: pieces summing to ~95-110% of a fair price.
    const pool = aiTeam.roster.concat(aiTeam.minors || []).map((id) => players[id])
      .filter((p) => p && window.BBGM_INJURIES.isAvailable(p))
      .sort((a, b) => tradeValue(b) - tradeValue(a));
    let offer = null;
    for (let i = 0; i < pool.length; i++) {
      const one = tradeValue(pool[i]);
      if (one >= targetTV * 0.95 && one <= targetTV * 1.15) { offer = [pool[i]]; break; }
      for (let j = i + 1; j < pool.length; j++) {
        const two = one + tradeValue(pool[j]);
        if (two >= targetTV * 0.98 && two <= targetTV * 1.15) { offer = [pool[i], pool[j]]; break; }
      }
      if (offer) break;
    }
    if (!offer) return;
    if (validateTradeShape(state, aiTeam, offer, user, [target])) return;

    if (!state.pendingTradeOffers) state.pendingTradeOffers = [];
    if (state.pendingTradeOffers.length >= 3) return; // don't spam
    state.pendingTradeOffers.push({
      id: `offer_${Date.now()}_${Math.floor(rand() * 1e6)}`,
      date: { ...state.meta.currentDate },
      fromTeamId: aiTeam.id,
      give: offer.map((p) => p.id),   // what THEY send
      get: [target.id],               // what they want from the user
    });
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>${aiTeam.abbr}</strong> called about <strong>${target.name}</strong> — ` +
            `they're offering ${offer.map((p) => p.name).join(' and ')}. (Team → Trades)`,
    });
  }

  return {
    tradeValue, teamValueOf, teamNeeds, expectedAAV, setPlayersRef,
    evaluateProposal, suggestAddition, executeTrade, tradeNews,
    validateTradeShape, tradesAllowed, aiTradeTick,
  };
})();
