// Waiver wire (0.22.0 — 11.x amendment). In-season releases from a 26-man
// roster pass through a 2-day waiver period before free agency:
//
//   - Placing a player (place) is a DFA: he leaves the roster and team
//     configs immediately, sits on state.waivers, and plays for nobody.
//   - Rival clubs get the 2 days to claim. Priority is reverse standings —
//     the worst record claims first, like September waivers. The claiming
//     club takes the player AND his contract onto its 26-man (weakest
//     roster player optioned to make room, closer/2-C/5-SP protected).
//   - Unclaimed players clear waivers into the free-agent pool.
//
// The AI side keeps the wire alive: clubs occasionally DFA a fringe
// veteran squeezed out by a clearly better farmhand (who is called up in
// the same move), so the user gets claim chances too. Minor leaguers
// never hit waivers — farm releases go straight to the pool.
window.BBGM_WAIVERS = (function () {
  const D = () => window.BBGM_DATES;
  const ROSTER = () => window.BBGM_ROSTER;
  const FA = () => window.BBGM_FA;

  function rand() { return Math.random(); }
  function wire(state) { if (!state.waivers) state.waivers = []; return state.waivers; }
  function overall(p) { return ROSTER().overall(p); }

  // Place a 26-man player on waivers (designated for assignment).
  function place(state, team, p) {
    for (const arr of [team.roster, team.roster40, team.il]) {
      if (!arr) continue;
      const i = arr.indexOf(p.id);
      if (i >= 0) arr.splice(i, 1);
    }
    ROSTER().replaceRefs(team, state.players, p.id, null);
    p.formerTeamId = p.teamId;
    p.teamId = null;
    p.status = 'waivers';
    p.rosterStatus = 'waivers';
    delete p.ilCallUpFor;
    wire(state).push({
      playerId: p.id,
      fromTeamId: team.id,
      placedDate: { ...state.meta.currentDate },
      userClaim: false,
    });
  }

  // The user enters (or withdraws) a claim; it resolves with everyone
  // else's when the entry's 2 days are up.
  function userClaim(state, playerId, on) {
    const e = wire(state).find((x) => x.playerId === playerId);
    if (e) e.userClaim = !!on;
  }

  // Claim priority: worst record first (ties by fewer wins, then id so
  // the order is stable).
  function priority(team) {
    const r = team.seasonRecord || { w: 0, l: 0 };
    const g = r.w + r.l;
    return g ? r.w / g : 0.5;
  }

  // Would this AI club put in a claim? A real upgrade over its weakest
  // same-type roster player, a contract the owner can carry, and even
  // then front offices pass plenty.
  function wantsClaim(state, team, p) {
    const players = state.players;
    const own = team.roster.map((id) => players[id])
      .filter((q) => q && q.isPitcher === p.isPitcher)
      .sort((a, b) => overall(a) - overall(b));
    if (!own.length) return false;
    if (overall(p) - overall(own[0]) < 3) return false;
    const sal = (p.contract && p.contract.annualSalary) || 0;
    const C = window.BBGM_CONSTANTS;
    const mul = (C.OWNER_ARCHETYPES.find((o) => o.key === team.owner) || { payrollMul: 1 }).payrollMul;
    if (FA().computePayroll(team, players) + sal > team.payrollBase * mul + 5) return false;
    return rand() < 0.75;
  }

  // Move a claimed player onto the winner's 26-man, trimming back to 26
  // with the same protections the rebuild repair uses.
  function awardClaim(state, team, p) {
    const players = state.players;
    p.teamId = team.id;
    p.status = 'active';
    p.rosterStatus = '26-man';
    p.acquiredVia = { type: 'waiver', year: state.meta.currentDate.year, fromTeamId: p.formerTeamId };
    team.roster.push(p.id);
    let demoted = null;
    if (team.roster.length > 26) {
      const roster = team.roster.map((id) => players[id]).filter(Boolean);
      const cCount = roster.filter((q) => !q.isPitcher && q.primaryPosition === 'C').length;
      const spCount = roster.filter((q) => q.isPitcher && q.primaryPosition === 'SP').length;
      demoted = roster.filter((q) => q.id !== p.id && q.id !== team.closer &&
          !(q.primaryPosition === 'C' && cCount <= 2) &&
          !(q.primaryPosition === 'SP' && spCount <= 5))
        .sort((a, b) => overall(a) - overall(b))[0] || null;
      if (demoted) {
        team.roster.splice(team.roster.indexOf(demoted.id), 1);
        team.minors.push(demoted.id);
        demoted.status = 'minors';
        demoted.rosterStatus = ROSTER().demotionLevel(demoted);
        ROSTER().replaceRefs(team, players, demoted.id, null);
      }
    }
    // The manager works the claim into his configs (Pillar 4).
    ROSTER().safeRebuild(state, team);
    return demoted;
  }

  // An AI club's DFA: its weakest replaceable veteran, and only when a
  // clearly better farmhand (4+ overall) is ready to take the spot.
  function aiWaiveCandidate(state, team) {
    const players = state.players;
    const inj = window.BBGM_INJURIES;
    const roster = team.roster.map((id) => players[id]).filter(Boolean);
    if (roster.length < 26) return null; // short rosters are rebuilding, not cutting
    const cCount = roster.filter((q) => !q.isPitcher && q.primaryPosition === 'C').length;
    const spCount = roster.filter((q) => q.isPitcher && q.primaryPosition === 'SP').length;
    const out = roster.filter((q) =>
      q.id !== team.closer && inj.isAvailable(q) &&
      !(q.primaryPosition === 'C' && cCount <= 2) &&
      !(q.primaryPosition === 'SP' && spCount <= 5) &&
      q.age >= 27 && ((q.serviceTime && q.serviceTime.years) || 0) >= 1)
      .sort((a, b) => overall(a) - overall(b))[0];
    if (!out) return null;
    const up = ROSTER().callUpCandidates(team, players, out.isPitcher,
      out.primaryPosition === 'C' ? 'C' : null)
      .filter((q) => overall(q) - overall(out) >= 4)[0];
    if (!up) return null;
    return { out, up };
  }

  // Daily tick from the sim loop. Returns events for news / sim stops:
  //   {kind:'waived', playerId, fromTeamId, ovr}
  //   {kind:'claimed', playerId, byTeamId, fromTeamId, demotedId, userWon, userLost}
  //   {kind:'cleared', playerId, fromTeamId}
  function dailyTick(state, today) {
    const events = [];
    const players = state.players;
    const teams = state.league.teams;
    const userTeamId = state.meta.userTeamId;

    // 1. AI DFAs (~1-2 league-wide per week) keep the wire two-sided.
    for (const t of teams) {
      if (t.id === userTeamId) continue;
      if (rand() >= 0.008) continue;
      const move = aiWaiveCandidate(state, t);
      if (!move) continue;
      place(state, t, move.out);
      t.minors.splice(t.minors.indexOf(move.up.id), 1);
      t.roster.push(move.up.id);
      move.up.status = 'active';
      move.up.rosterStatus = '26-man';
      ROSTER().safeRebuild(state, t);
      events.push({ kind: 'waived', playerId: move.out.id, fromTeamId: t.id,
        ovr: Math.round(overall(move.out)) });
    }

    // 2. Resolve entries that have sat their 2 days.
    const remaining = [];
    for (const e of wire(state)) {
      const p = players[e.playerId];
      if (!p) continue;
      if (D().diffDays(e.placedDate, today) < 2) { remaining.push(e); continue; }
      const claimants = teams.filter((t) => {
        if (t.id === e.fromTeamId) return false;
        if (t.id === userTeamId) return !!e.userClaim;
        return wantsClaim(state, t, p);
      });
      claimants.sort((a, b) => priority(a) - priority(b));
      const winner = claimants[0] || null;
      if (winner) {
        const demoted = awardClaim(state, winner, p);
        events.push({ kind: 'claimed', playerId: p.id, byTeamId: winner.id,
          fromTeamId: e.fromTeamId, demotedId: demoted ? demoted.id : null,
          userWon: winner.id === userTeamId,
          userLost: !!e.userClaim && winner.id !== userTeamId });
      } else {
        // Keep provenance for the FA market's "departed from" bookkeeping
        // (releaseToPool stamps formerTeamId from teamId).
        p.teamId = p.formerTeamId || null;
        FA().releaseToPool(state, p, 'released');
        events.push({ kind: 'cleared', playerId: p.id, fromTeamId: e.fromTeamId });
      }
    }
    state.waivers = remaining;
    return events;
  }

  // Rollover hygiene: nobody winters on the wire.
  function clearAll(state) {
    for (const e of wire(state)) {
      const p = state.players[e.playerId];
      if (p && p.status === 'waivers') {
        p.teamId = p.formerTeamId || null;
        FA().releaseToPool(state, p, 'released');
      }
    }
    state.waivers = [];
  }

  return { place, userClaim, dailyTick, clearAll, priority };
})();
