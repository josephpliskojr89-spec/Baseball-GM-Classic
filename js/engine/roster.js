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
      if (inP && inP.isPitcher) {
        team.rotation[ri] = inId;
      } else {
        // Backfill from the roster rather than shrinking — a rotation that
        // quietly drops to 4 arms hands its survivors 40-start seasons.
        // Best SP-primary arm not already in the rotation (never the
        // closer); he leaves his pen role, since he now starts.
        const cand = team.roster
          .map((id) => players[id])
          .filter((p) => p && p.isPitcher && p.id !== outId &&
            p.id !== team.closer && !team.rotation.includes(p.id))
          .sort((a, b) => {
            const sa = a.primaryPosition === 'SP' ? 0 : 1;
            const sb = b.primaryPosition === 'SP' ? 0 : 1;
            if (sa !== sb) return sa - sb;
            return (b.ratings.stamina || 0) - (a.ratings.stamina || 0);
          })[0];
        if (cand) {
          team.rotation[ri] = cand.id;
          const cbi = (team.bullpen || []).indexOf(cand.id);
          if (cbi >= 0) team.bullpen.splice(cbi, 1);
          const cRoles = team.bullpenRoles || {};
          for (const role in cRoles) {
            const cx = cRoles[role].indexOf(cand.id);
            if (cx >= 0) cRoles[role].splice(cx, 1);
          }
        } else {
          team.rotation.splice(ri, 1);
        }
      }
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
          // Best eligible roster bat takes the slot; if nobody eligible is
          // free, ANY free roster bat does — an out-of-position stopgap
          // beats a stale reference to a player who left the roster (the
          // engine treats healthy lineup-spec players as playable, so a
          // stale ref would field a minors/traded player).
          const inLineup = new Set(team[key].map((s) => s.playerId));
          const free = team.roster
            .map((id) => players[id])
            .filter((q) => q && !q.isPitcher && !inLineup.has(q.id))
            .sort((a, b) => overall(b) - overall(a));
          const sub = free.find((q) => GEN.canPlay(q, spot.position)) || free[0];
          if (sub) spot.playerId = sub.id;
        }
      }
    }
  }

  // Demotion landing level: the scouts' recommended level, which honors
  // rating, age floors, AND the youth ceiling (12.4 / 0.17.0) — a
  // 20-year-old sent down goes to AA, not AAA, no matter how good he is.
  function demotionLevel(p) {
    const MIN = window.BBGM_MINORS;
    return MIN ? MIN.recommendedLevel(p) : 'AAA';
  }

  // Healthy minor leaguers of the given type, ranked: position need first
  // (a catcher for a catcher), then level (AAA preferred), then talent.
  // The full list feeds the user's call-up decision modal (0.21.0);
  // bestCallUp keeps returning the AI's top pick.
  function callUpCandidates(team, players, isPitcher, positionNeed) {
    const inj = INJ();
    // 'A+' kept for saves loaded mid-migration (merged into A in 0.12).
    const levelRank = { AAA: 0, AA: 1, 'A+': 2, A: 2, Rookie: 3 };
    const cands = (team.minors || [])
      .map((id) => players[id])
      .filter((p) => p && p.isPitcher === isPitcher && inj.isAvailable(p));
    cands.sort((a, b) => {
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
    return cands;
  }

  function bestCallUp(team, players, isPitcher, positionNeed) {
    return callUpCandidates(team, players, isPitcher, positionNeed)[0] || null;
  }

  // Move an injured player from the 26-man to the team IL list and call up
  // a replacement so the roster stays at strength. Returns { callUp } (the
  // promoted player or null). Only for IL-type injuries — day-to-day
  // players stay on the roster.
  // What the injured player's absence needs covered: his catcher spot, or
  // his rotation turn if he holds a slot. Shared by the AI move and the
  // user's decision modal so both rank candidates the same way.
  function callUpNeedFor(team, player) {
    const rSlot = (team.rotation || []).indexOf(player.id);
    return player.primaryPosition === 'C' ? 'C' : (rSlot >= 0 ? 'SP' : null);
  }

  // Promote a specific minors player to cover an IL'd player's spot. The
  // second half of placeOnILWithMove, factored out so the user's deferred
  // call-up decision (0.21.0) executes through the same code as the AI's.
  function executeILCallUp(state, team, injured, callUp) {
    if (!callUp) return null;
    const rSlot = (team.rotation || []).indexOf(injured.id);
    const mi = team.minors.indexOf(callUp.id);
    if (mi >= 0) team.minors.splice(mi, 1);
    team.roster.push(callUp.id);
    callUp.status = 'active';
    callUp.rosterStatus = '26-man';
    // Remember who this call-up covers, so activation reverses it.
    callUp.ilCallUpFor = injured.id;
    if (callUp.isPitcher && rSlot >= 0) {
      // Cover the rotation hole directly.
      team.rotation[rSlot] = callUp.id;
    } else if (callUp.isPitcher) {
      // A called-up reliever slots into the pen as depth.
      if (!team.bullpen.includes(callUp.id)) team.bullpen.push(callUp.id);
      const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
      if (!Object.values(roles).some((arr) => arr.includes(callUp.id))) roles.middle.push(callUp.id);
    }
    return callUp;
  }

  // opts.skipCallUp (0.21.0): move the player to the IL but leave the
  // roster spot open — the user has a sim-stop set and will choose the
  // call-up himself (executeILCallUp), or elect to play short.
  function placeOnILWithMove(state, team, player, opts = {}) {
    const players = state.players;
    const ri = team.roster.indexOf(player.id);
    if (ri >= 0) team.roster.splice(ri, 1);
    if (!Array.isArray(team.il)) team.il = [];
    if (!team.il.includes(player.id)) team.il.push(player.id);
    player.rosterStatus = 'IL';

    if (opts.skipCallUp) return { callUp: null };

    // A rotation starter's IL stint used to leave his slot in place, and
    // pickStarter's "first available arm" walk funneled every one of those
    // starts to the adjacent healthy starters — 50-start seasons when a
    // rotation carried two long-term holes. The call-up takes the injured
    // starter's rotation turn instead, like a real team.
    const need = callUpNeedFor(team, player);
    const callUp = executeILCallUp(state, team, player,
      bestCallUp(team, players, player.isPitcher, need));
    return { callUp };
  }

  // A healthy roster pitcher must belong to SOMETHING — rotation, pen, or
  // the closer's chair — or the engine never uses him (pickStarter and
  // chooseReliever read only those lists). A returning IL pitcher's config
  // spots normally survive his stint untouched, but any mid-stint rebuild
  // (trade, roster swap, role conversion, waiver claim — every safeRebuild
  // path) rebuilds configs from the 26-man only and purges IL'd players.
  // This was a real bug: an activated starter sat on the roster for weeks
  // belonging to no staff list. Called at every activateFromIL exit.
  function ensureStaffIntegration(state, team, p) {
    if (!p.isPitcher) return; // bench hitters are used via subs/rest — fine
    const players = state.players;
    if ((team.rotation || []).includes(p.id) ||
        (team.bullpen || []).includes(p.id) || team.closer === p.id) return;
    // Best case: his stint cover still holds his old rotation slot.
    const slot = (team.rotation || []).findIndex((id) => {
      const q = players[id];
      return q && q.ilCallUpFor === p.id;
    });
    if (slot >= 0 && p.primaryPosition === 'SP') {
      const cover = players[team.rotation[slot]];
      team.rotation[slot] = p.id;
      delete cover.ilCallUpFor;
      if (team.roster.includes(cover.id) && !team.bullpen.includes(cover.id)) {
        team.bullpen.push(cover.id);
        const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
        if (!Object.values(roles).some((arr) => arr.includes(cover.id))) roles.middle.push(cover.id);
      }
      return;
    }
    if (p.primaryPosition === 'SP') {
      // A purged starter with no cover slot to reclaim: the manager
      // re-sorts the whole staff around him (top-5 SPs take the rotation).
      safeRebuild(state, team);
      return;
    }
    // A returning relief arm always has a pen chair.
    if (!team.bullpen.includes(p.id)) team.bullpen.push(p.id);
    const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
    if (!Object.values(roles).some((arr) => arr.includes(p.id))) roles.middle.push(p.id);
  }

  // Return a recovered player from the IL to the 26-man. The call-up who
  // covered the stint (or, failing that, the weakest same-type roster
  // player who has minor-league status history) goes back down.
  // Returns { sentDown } (player demoted or null if the team was short).
  // opts.downId (0.21.0): the user picked who goes down — honor it instead
  // of the default (the stint's cover, else the weakest same-type player).
  function activateFromIL(state, team, player, opts = {}) {
    const players = state.players;
    const ii = (team.il || []).indexOf(player.id);
    if (ii >= 0) team.il.splice(ii, 1);
    if (!team.roster.includes(player.id)) team.roster.push(player.id);
    player.rosterStatus = '26-man';
    player.status = 'active';

    if (team.roster.length <= 26) {
      // Played short — no demotion needed. But if the stint's cover still
      // holds the returning starter's rotation slot, reclaim it here too:
      // skipping the reclaim left the healed starter on the roster but
      // never starting again (and the cover flagged first-out forever).
      if (player.isPitcher && !(team.rotation || []).includes(player.id)) {
        const cover = team.roster
          .map((id) => players[id])
          .find((p) => p && p.ilCallUpFor === player.id);
        if (cover) {
          const cSlot = (team.rotation || []).indexOf(cover.id);
          if (cSlot >= 0) {
            team.rotation[cSlot] = player.id;
            // The cover stays up as pen depth.
            if (!team.bullpen.includes(cover.id)) team.bullpen.push(cover.id);
            const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
            if (!Object.values(roles).some((arr) => arr.includes(cover.id))) roles.middle.push(cover.id);
          }
          delete cover.ilCallUpFor;
        }
      }
      ensureStaffIntegration(state, team, player);
      return { sentDown: null };
    }

    // The user's explicit pick wins; otherwise prefer the specific
    // call-up who covered this stint.
    let down = opts.downId && opts.downId !== player.id
      ? team.roster.map((id) => players[id]).find((p) => p && p.id === opts.downId) || null
      : null;
    if (!down) {
      down = team.roster
        .map((id) => players[id])
        .find((p) => p && p.ilCallUpFor === player.id);
    }
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
    down.rosterStatus = demotionLevel(down);
    delete down.ilCallUpFor;
    // If the demoted cover held a rotation slot (a call-up covering an
    // IL'd starter's turn), the returning pitcher reclaims it BEFORE the
    // scrub below — replaceRefs(…, null) would splice the slot and shrink
    // the rotation permanently.
    const rSlot = (team.rotation || []).indexOf(down.id);
    if (rSlot >= 0 && player.isPitcher && !team.rotation.includes(player.id)) {
      team.rotation[rSlot] = player.id;
    }
    // Scrub the demoted player from any remaining team config (he may have
    // been slotted into the bullpen as call-up depth). The returning
    // player's lineup/bullpen ids USUALLY survived the stint — but a
    // mid-stint rebuild purges IL'd players, so verify he's back in the
    // staff before finishing (ensureStaffIntegration).
    replaceRefs(team, players, down.id, null);
    ensureStaffIntegration(state, team, player);
    return { sentDown: down };
  }

  // Collision-safe id for players generated into an existing save (the
  // generation module's counter resets on reload). Shared by the offseason
  // backfill and emergency in-season signings.
  function newPlayerId(state) {
    if (!state.meta.nextGenId) state.meta.nextGenId = 1;
    return `g${state.meta.currentDate.year}_${state.meta.nextGenId++}`;
  }

  // Guaranteed-convergent team config rebuild. assignLineupsAndPitching can
  // fail on solvable-looking rosters (greedy lineup matching) or on rosters
  // that roster churn left short somewhere. Each retry fixes the named
  // deficiency with a promotion or a generated depth signing whose PRIMARY
  // position is the missing one, so every attempt strictly reduces the
  // failure space. Throws (fail loud) only if ten repairs somehow don't
  // converge — which would indicate a real bug, not an unlucky roster.
  function safeRebuild(state, team) {
    const GEN = window.BBGM_PLAYER_GEN;
    const players = state.players;
    // The team's manager shapes the batting order (17.7). League-average
    // style when unstaffed.
    const STAFF = window.BBGM_STAFF;
    const tendencies = STAFF ? STAFF.tendenciesFor(state, team) : null;
    const opts = { lineupStyle: tendencies ? tendencies.lineupStyle : undefined };
    let lastErr = null;
    // Patches added on earlier attempts are protected from make-room
    // demotion — without this, "add an RF, demote the weakest hitter"
    // can demote the RF added one attempt ago and loop forever.
    const protectedIds = new Set();
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        GEN.assignLineupsAndPitching(Math.random, team, players, opts);
        return;
      } catch (e) {
        lastErr = e;
        const m = /position (\w+)/.exec(e.message || '');
        const isLineupHole = !!m;
        const pos = m ? m[1] : null;

        if (isLineupHole) {
          // Prefer an org player whose PRIMARY is the missing position —
          // secondary-eligible players can be re-consumed by the greedy
          // matcher. Otherwise generate one.
          let patch = (team.minors || []).map((id) => players[id])
            .filter((p) => p && !p.isPitcher && p.primaryPosition === pos)
            .sort((a, b) => overall(b) - overall(a))[0];
          if (patch) {
            team.minors.splice(team.minors.indexOf(patch.id), 1);
          } else {
            patch = GEN.generateNewPlayer(Math.random, team, {
              slotPos: pos, tier: 'depth', isProspect: false,
              ageRange: { mean: 27, stdev: 2, min: 23, max: 32 },
              status: 'active', rosterStatus: '26-man',
              id: newPlayerId(state),
            });
            players[patch.id] = patch;
          }
          team.roster.push(patch.id);
          patch.status = 'active';
          patch.rosterStatus = '26-man';
          protectedIds.add(patch.id);
          // Make room: weakest hitter who isn't a needed catcher, isn't
          // the patch itself, and isn't a previous attempt's patch.
          if (team.roster.length > 26) {
            const roster = team.roster.map((id) => players[id]).filter(Boolean);
            const cCount = roster.filter((p) => !p.isPitcher && p.primaryPosition === 'C').length;
            const down = roster
              .filter((p) => !p.isPitcher && !protectedIds.has(p.id) &&
                !(p.primaryPosition === 'C' && cCount <= 2))
              .sort((a, b) => overall(a) - overall(b))[0];
            if (down) {
              team.roster.splice(team.roster.indexOf(down.id), 1);
              team.minors.push(down.id);
              down.status = 'minors';
              down.rosterStatus = demotionLevel(down);
              replaceRefs(team, players, down.id, null);
            }
          }
        } else {
          // Pitching-side failure (e.g. no closer candidate / empty staff):
          // add an arm.
          const p = GEN.generateNewPlayer(Math.random, team, {
            slotPos: 'RP', tier: 'depth', isProspect: false,
            ageRange: { mean: 27, stdev: 2, min: 23, max: 32 },
            status: 'active', rosterStatus: '26-man',
            id: newPlayerId(state),
          });
          players[p.id] = p;
          team.roster.push(p.id);
          protectedIds.add(p.id);
          // Make room like the lineup-hole branch does — without this,
          // repeated pitching-side repairs left rosters above 26.
          if (team.roster.length > 26) {
            const roster = team.roster.map((id) => players[id]).filter(Boolean);
            const spCount = roster.filter((q) => q.isPitcher && q.primaryPosition === 'SP').length;
            const down = roster
              .filter((q) => q.isPitcher && !protectedIds.has(q.id) &&
                q.id !== team.closer &&
                !(q.primaryPosition === 'SP' && spCount <= 5))
              .sort((a, b) => overall(a) - overall(b))[0];
            if (down) {
              team.roster.splice(team.roster.indexOf(down.id), 1);
              team.minors.push(down.id);
              down.status = 'minors';
              down.rosterStatus = demotionLevel(down);
              replaceRefs(team, players, down.id, null);
            }
          }
        }
      }
    }
    throw lastErr;
  }

  return {
    placeOnILWithMove, activateFromIL, replaceRefs, bestCallUp, overall, demotionLevel,
    newPlayerId, safeRebuild,
    callUpCandidates, callUpNeedFor, executeILCallUp, ensureStaffIntegration,
  };
})();
