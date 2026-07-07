// Roster transaction engine (bible 11.5, simplified). Owns the mechanical
// moves shared by the daily sim loop (IL placements / activations) and the
// offseason rollover (retirement backfill, promotions).
//
// Scope notes (interim, pre-Phase-8/9): no options tracking, no DFA/waivers,
// no 40-man enforcement beyond list membership, no September expansion.
// Moves are auto-handled for every team (user's included) with news surfaced
// — consistent with Pillar 4's front-office framing until the dedicated
// roster-decision UI grows richer.
window.BBGM_ROSTER = (function () {
  const INJ = () => window.BBGM_INJURIES;

  function overall(p) {
    const r = p.ratings;
    if (p.isPitcher) {
      return r.stuff * 0.3 + r.control * 0.25 + r.movement * 0.2 + r.velocity * 0.15 + r.stamina * 0.1;
    }
    return (r.contactVsR + r.contactVsL) / 2 * 0.3 + (r.powerVsR + r.powerVsL) / 2 * 0.3 +
      r.discipline * 0.15 + r.speed * 0.1 + (r.defense || 50) * 0.1 + (r.arm || 50) * 0.05;
  }

  // Replace every team-config reference to outId with inId (rotation,
  // closer, bullpen roles, both lineups). Used when a player leaves the
  // 26-man for good (demotion, retirement) — NOT for IL stints, where the
  // engine's daily substitution covers the absence and the player slots
  // back in on return.
  function replaceRefs(team, players, outId, inId) {
    const GEN = window.BBGM_PLAYER_GEN;
    const inP = inId ? players[inId] : null;
    const ri = team.rotation.indexOf(outId);
    if (ri >= 0) {
      if (inP && inP.isPitcher) team.rotation[ri] = inId;
      else team.rotation.splice(ri, 1);
    }
    if (team.closer === outId) team.closer = (inP && inP.isPitcher) ? inId : null;
    const bi = (team.bullpen || []).indexOf(outId);
    if (bi >= 0) {
      if (inP && inP.isPitcher) team.bullpen[bi] = inId;
      else team.bullpen.splice(bi, 1);
    }
    const roles = team.bullpenRoles || {};
    for (const role in roles) {
      const ix = roles[role].indexOf(outId);
      if (ix >= 0) {
        if (inP && inP.isPitcher) roles[role][ix] = inId;
        else roles[role].splice(ix, 1);
      }
    }
    for (const key of ['lineupRH', 'lineupLH']) {
      for (const spot of team[key] || []) {
        if (spot.playerId !== outId) continue;
        if (inP && !inP.isPitcher && GEN.canPlay(inP, spot.position)) {
          spot.playerId = inId;
        } else {
          // Best eligible roster bat takes the slot.
          const inLineup = new Set(team[key].map((s) => s.playerId));
          const sub = team.roster
            .map((id) => players[id])
            .filter((q) => q && !q.isPitcher && !inLineup.has(q.id) && GEN.canPlay(q, spot.position))
            .sort((a, b) => overall(b) - overall(a))[0];
          if (sub) spot.playerId = sub.id;
        }
      }
    }
  }

  // Best healthy minor leaguer of the given type, AAA preferred.
  function bestCallUp(team, players, isPitcher, positionNeed) {
    const inj = INJ();
    const levelRank = { AAA: 0, AA: 1, 'A+': 2, A: 3, Rookie: 4 };
    const cands = (team.minors || [])
      .map((id) => players[id])
      .filter((p) => p && p.isPitcher === isPitcher && inj.isAvailable(p));
    if (!cands.length) return null;
    cands.sort((a, b) => {
      // Position need first (e.g. a catcher for a catcher), then level, then talent.
      if (positionNeed) {
        const an = a.primaryPosition === positionNeed ? 0 : 1;
        const bn = b.primaryPosition === positionNeed ? 0 : 1;
        if (an !== bn) return an - bn;
      }
      const la = levelRank[a.rosterStatus] != null ? levelRank[a.rosterStatus] : 5;
      const lb = levelRank[b.rosterStatus] != null ? levelRank[b.rosterStatus] : 5;
      if (la !== lb) return la - lb;
      return overall(b) - overall(a);
    });
    return cands[0];
  }

  // Move an injured player from the 26-man to the team IL list and call up
  // a replacement so the roster stays at strength. Returns { callUp } (the
  // promoted player or null). Only for IL-type injuries — day-to-day
  // players stay on the roster.
  function placeOnILWithMove(state, team, player) {
    const players = state.players;
    const ri = team.roster.indexOf(player.id);
    if (ri >= 0) team.roster.splice(ri, 1);
    if (!Array.isArray(team.il)) team.il = [];
    if (!team.il.includes(player.id)) team.il.push(player.id);
    player.rosterStatus = 'IL';

    const need = player.primaryPosition === 'C' ? 'C' : null;
    const callUp = bestCallUp(team, players, player.isPitcher, need);
    if (callUp) {
      const mi = team.minors.indexOf(callUp.id);
      if (mi >= 0) team.minors.splice(mi, 1);
      team.roster.push(callUp.id);
      callUp.status = 'active';
      callUp.rosterStatus = '26-man';
      // Remember who this call-up covers, so activation reverses it.
      callUp.ilCallUpFor = player.id;
      // A called-up pitcher slots into the pen as depth.
      if (callUp.isPitcher) {
        if (!team.bullpen.includes(callUp.id)) team.bullpen.push(callUp.id);
        const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
        if (!Object.values(roles).some((arr) => arr.includes(callUp.id))) roles.middle.push(callUp.id);
      }
    }
    return { callUp };
  }

  // Return a recovered player from the IL to the 26-man. The call-up who
  // covered the stint (or, failing that, the weakest same-type roster
  // player who has minor-league status history) goes back down.
  // Returns { sentDown } (player demoted or null if the team was short).
  function activateFromIL(state, team, player) {
    const players = state.players;
    const ii = (team.il || []).indexOf(player.id);
    if (ii >= 0) team.il.splice(ii, 1);
    if (!team.roster.includes(player.id)) team.roster.push(player.id);
    player.rosterStatus = '26-man';
    player.status = 'active';

    if (team.roster.length <= 26) return { sentDown: null }; // played short — no demotion needed

    // Prefer the specific call-up who covered this stint.
    let down = team.roster
      .map((id) => players[id])
      .find((p) => p && p.ilCallUpFor === player.id);
    if (!down) {
      // Weakest healthy same-type player (never the returning player).
      const inj = INJ();
      const cands = team.roster
        .map((id) => players[id])
        .filter((p) => p && p.id !== player.id && p.isPitcher === player.isPitcher && inj.isAvailable(p));
      cands.sort((a, b) => overall(a) - overall(b));
      down = cands[0] || null;
    }
    if (!down) return { sentDown: null };

    const ri = team.roster.indexOf(down.id);
    if (ri >= 0) team.roster.splice(ri, 1);
    team.minors.push(down.id);
    down.status = 'minors';
    down.rosterStatus = 'AAA';
    delete down.ilCallUpFor;
    // Scrub the demoted player from team config (he may have been slotted
    // into the bullpen as call-up depth). The returning player needs no
    // re-insertion: his ids never left the lineup/rotation/bullpen config
    // during the stint — the engine simply subbed around him daily.
    replaceRefs(team, players, down.id, null);
    return { sentDown: down };
  }

  return { placeOnILWithMove, activateFromIL, replaceRefs, bestCallUp, overall };
})();
