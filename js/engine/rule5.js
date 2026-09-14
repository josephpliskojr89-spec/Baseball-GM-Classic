// The Rule 5 draft (bible §26, v2.17.0) — the December tentpole.
//
// Real rule, faithfully compressed: every winter, farmhands left
// unprotected after 4 pro seasons (5 if they signed at 18 or younger)
// can be drafted by any club for the $100K fee — but a selection must
// spend the ENTIRE next season on the drafting club's 26-man roster
// (IL time counts) or be offered back to his old club for $50K. It is
// the league's tax on hoarding: develop him, play him, or risk him.
//
// Protection is a valuation proxy for the real 40-man: a club's top 40
// org players by trade value are shielded automatically (the 26-man
// and IL are ineligible outright), and the USER may hand-shield three
// more from the Farm Director's exposure letter — the one lever the
// real November roster crunch gives a GM.
//
// The stick rule is enforced at every demotion door (acceptsMinors,
// weakestDemotable, the user's send-down/release flows) and by a
// monthly AI conscience check: a pick who can't hold the roster spot
// goes home. Flags clear at the rollover — survive the season and the
// player is yours for good.
window.BBGM_RULE5 = (function () {
  const DRAFT_MONTH = 12, DRAFT_DAY = 10;

  const R = () => window.BBGM_ROSTER;
  const TR = () => window.BBGM_TRADES;

  function rand() { return Math.random(); }

  // The winter spanning Nov Y -> Mar Y+1 is "winter Y".
  function winterYearFor(today) {
    return today.month >= 11 ? today.year : today.year - 1;
  }

  function historyFor(state, wy) {
    return (state.rule5History || []).find((h) => h.year === wy) || null;
  }

  // Due from December 10 until run — the same "on or after, until
  // worked" predicate the January window uses: the offseason calendar
  // moves in 12-day hops and an exact-day match would sail past.
  function pending(state, today) {
    if (!state.meta || state.meta.offseasonPhase !== 'freeAgency') return false;
    const wy = winterYearFor(today);
    if (historyFor(state, wy)) return false;
    if (today.year > wy) return true; // January+: overdue heal
    return today.month === 12 && today.day >= DRAFT_DAY;
  }

  // First professional year: the draft class, the international class,
  // or the year an indie/FA deal brought him into org ball. Genesis
  // players with no paper trail are simply never eligible — by the time
  // Rule 5 matters, the farm is draft/intl-sourced anyway.
  function firstProYear(p) {
    if (p.draft && p.draft.year) return p.draft.year;
    if (p.intl && p.intl.year) return p.intl.year;
    if (p.acquiredVia && p.acquiredVia.type === 'fa' && p.acquiredVia.year) return p.acquiredVia.year;
    return null;
  }

  function serviceEligible(p, wy) {
    const fp = firstProYear(p);
    if (fp == null) return false;
    const proYears = wy - fp;
    const signAge = p.age - proYears; // age at first pro year
    return proYears >= (signAge <= 18 ? 5 : 4);
  }

  // A club's automatic shield: its top 40 org players by trade value
  // (the 26-man and IL are ineligible outright via status, so this
  // effectively protects the best ~14 farmhands like a managed 40-man
  // would). The user's hand-shielded names ride on top.
  function protectedSet(state, team) {
    const players = state.players;
    const all = [...(team.roster || []), ...(team.minors || []), ...(team.il || [])]
      .map((id) => players[id])
      .filter((p) => p && !p.retired)
      .sort((a, b) => TR().tradeValue(b) - TR().tradeValue(a));
    const prot = new Set(all.slice(0, 40).map((p) => p.id));
    const shield = state.rule5Shield;
    if (team.id === state.meta.userTeamId && shield &&
        shield.year === winterYearFor(state.meta.currentDate)) {
      for (const id of shield.ids || []) prot.add(id);
    }
    return prot;
  }

  function eligibleFor(state, team, wy) {
    const players = state.players;
    const prot = protectedSet(state, team);
    return (team.minors || [])
      .map((id) => players[id])
      .filter((p) => p && !p.retired && p.status === 'minors' &&
        serviceEligible(p, wy) && !prot.has(p.id));
  }

  // The Farm Director's exposure list: the user's eligible names worth
  // worrying about, best first — the letter's raw material and the
  // protection modal's menu.
  function exposedFor(state, team) {
    const wy = winterYearFor(state.meta.currentDate);
    return eligibleFor(state, team, wy)
      .sort((a, b) => TR().tradeValue(b) - TR().tradeValue(a))
      .slice(0, 10);
  }

  function buildPool(state, wy) {
    const pool = [];
    for (const t of state.league.teams) {
      for (const p of eligibleFor(state, t, wy)) {
        pool.push({ playerId: p.id, fromTeamId: t.id });
      }
    }
    pool.sort((a, b) => TR().tradeValue(state.players[b.playerId]) - TR().tradeValue(state.players[a.playerId]));
    return pool;
  }

  // Reverse standings of the season just completed (the rollover has
  // always archived it by December).
  function draftOrder(state) {
    const seasons = (state.history && state.history.seasons) || [];
    const last = seasons[seasons.length - 1];
    const recs = (last && last.records) || {};
    return state.league.teams.slice().sort((a, b) => {
      const wa = (recs[a.id] && recs[a.id].w) || 0;
      const wb = (recs[b.id] && recs[b.id].w) || 0;
      return wa - wb;
    });
  }

  // Everything the draft-room UI needs before the user commits.
  function draftBoard(state) {
    const wy = winterYearFor(state.meta.currentDate);
    const order = draftOrder(state);
    const userSlot = order.findIndex((t) => t.id === state.meta.userTeamId) + 1;
    const pool = buildPool(state, wy)
      .filter((e) => e.fromTeamId !== state.meta.userTeamId)
      .slice(0, 30);
    return { year: wy, order, userSlot, pool };
  }

  // Would this club gamble a roster spot on him? Real Rule 5 rooms
  // take flyers — the bar is "close enough to the end of our bench
  // that spring might close the gap," not "already better." Soak-tuned
  // (v2.17.0): bar at weakest−4 with a 40 floor lands the league at a
  // realistic pick count once the pool matures, and the May conscience
  // (return at weakest−2) sends roughly the real share back home.
  function stickCandidate(state, team, p) {
    const players = state.players;
    const ovr = R().overall(p);
    if (ovr < 40) return false;
    const roster = (team.roster || []).map((id) => players[id]).filter(Boolean);
    if (!roster.length) return false;
    const weakest = Math.min(...roster.map((q) => R().overall(q)));
    return ovr >= weakest - 4;
  }

  function executePick(state, team, entry, wy) {
    const players = state.players;
    const p = players[entry.playerId];
    const from = state.league.teams.find((t) => t.id === entry.fromTeamId);
    // Out of the old org's farm…
    const mi = (from.minors || []).indexOf(p.id);
    if (mi >= 0) from.minors.splice(mi, 1);
    // …make roster room if the new club is full (never at a Rule 5
    // pick's expense)…
    if (team.roster.length >= 26) {
      const down = R().weakestDemotable(team, players, [p.id]);
      if (down) {
        team.roster.splice(team.roster.indexOf(down.id), 1);
        team.minors.push(down.id);
        down.status = 'minors';
        down.rosterStatus = R().demotionLevel(down);
        R().replaceRefs(team, players, down.id, null);
      }
    }
    // …and onto the 26-man, wearing the obligation.
    team.roster.push(p.id);
    p.teamId = team.id;
    p.status = 'active';
    p.rosterStatus = '26-man';
    p.rule5 = { fromTeamId: entry.fromTeamId, year: wy + 1 };
    R().logTx(state, p,
      `Selected by ${team.abbr} in the Rule 5 draft (from ${from.abbr}) — must stay on the 26-man all season`);
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>RULE 5:</strong> ${team.abbr} select <strong>${p.name}</strong> ` +
            `(${p.primaryPosition}, ${p.age}) from the ${from.abbr} farm for the $100K fee.`,
      go: { type: 'player', id: p.id },
    });
    return { playerId: p.id, name: p.name, pos: p.primaryPosition, age: p.age,
      teamId: team.id, teamAbbr: team.abbr, fromTeamId: from.id, fromAbbr: from.abbr };
  }

  // One round, reverse standings, one selection max per club, most
  // clubs pass (real drafts run ~10-15 picks league-wide). The user's
  // slot honors `userChoice` (a playerId, or null to pass) — and an
  // earlier club CAN snipe the name, which is December working as
  // intended. `auto` runs the user's club as an AI (headless paths).
  function runDraft(state, opts = {}) {
    const wy = winterYearFor(state.meta.currentDate);
    const taken = new Set();
    let pool = buildPool(state, wy);
    const picks = [];
    let userResult = null;
    for (const team of draftOrder(state)) {
      const isUser = team.id === state.meta.userTeamId;
      const avail = pool.filter((e) => !taken.has(e.playerId) && e.fromTeamId !== team.id);
      if (isUser && !opts.auto) {
        if (opts.userChoice) {
          const entry = avail.find((e) => e.playerId === opts.userChoice);
          if (entry) {
            const pick = executePick(state, team, entry, wy);
            taken.add(entry.playerId);
            picks.push(pick);
            userResult = { kind: 'picked', pick };
          } else {
            userResult = { kind: 'sniped',
              name: (state.players[opts.userChoice] || {}).name || 'your target' };
          }
        } else {
          userResult = { kind: 'passed' };
        }
        continue;
      }
      // AI selection through the fog (§23 grammar): another org's
      // farmhand is the least-scouted player in baseball, so the club
      // drafts on a PERCEIVED read — true overall ±4. Mirages get
      // picked; May finds them out and sends them home, which is where
      // the real draft's ~half-return rate comes from. ~45% of clubs
      // with a credible read make a pick.
      const roster = (team.roster || []).map((id) => state.players[id]).filter(Boolean);
      const weakest = roster.length ? Math.min(...roster.map((q) => R().overall(q))) : 40;
      const bar = Math.max(40, weakest - 4);
      const cand = avail
        .map((e) => ({ e, seen: R().overall(state.players[e.playerId]) + (rand() * 2 - 1) * 4 }))
        .filter((x) => x.seen >= bar)
        .sort((a, b) => b.seen - a.seen)[0];
      if (!cand || rand() >= 0.45) continue;
      const pick = executePick(state, team, cand.e, wy);
      taken.add(cand.e.playerId);
      picks.push(pick);
    }
    if (!state.rule5History) state.rule5History = [];
    state.rule5History.push({ year: wy, picks, returns: [], poolSize: pool.length });
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `<strong>The ${wy} Rule 5 draft is in the books</strong> — ` +
            `${picks.length} player${picks.length === 1 ? '' : 's'} selected league-wide. ` +
            `Every one must stick on a 26-man roster all season or go home.`,
    });
    return { year: wy, picks, userResult,
      userLost: picks.filter((k) => k.fromTeamId === state.meta.userTeamId) };
  }

  // The walk of shame: off the 26-man, back to the old club's farm for
  // half the fee. Used by the AI conscience tick, the user's send-down
  // flow, and the self-heal for any pick that leaks into the minors.
  function returnPick(state, p) {
    const players = state.players;
    const team = state.league.teams.find((t) => t.id === p.teamId);
    const home = state.league.teams.find((t) => t.id === p.rule5.fromTeamId);
    if (!home) { delete p.rule5; return null; }
    if (team) {
      for (const arr of [team.roster, team.minors, team.il]) {
        if (!arr) continue;
        const i = arr.indexOf(p.id);
        if (i >= 0) arr.splice(i, 1);
      }
      R().replaceRefs(team, players, p.id, null);
    }
    home.minors.push(p.id);
    p.teamId = home.id;
    p.status = 'minors';
    p.rosterStatus = R().demotionLevel(p);
    const rec = { playerId: p.id, name: p.name, fromAbbr: team ? team.abbr : '?', toAbbr: home.abbr };
    const hist = historyFor(state, p.rule5.year - 1);
    if (hist) hist.returns.push(rec);
    delete p.rule5;
    R().logTx(state, p, `Returned to ${home.abbr} (Rule 5) for $50K — couldn't hold the roster spot`);
    if (!state.news) state.news = [];
    state.news.push({
      date: { ...state.meta.currentDate },
      body: `${team ? team.abbr : 'His club'} return Rule 5 pick <strong>${p.name}</strong> ` +
            `to the ${home.abbr} for $50K.`,
      go: { type: 'player', id: p.id },
    });
    return rec;
  }

  // Monthly AI conscience (wired into roster.midSeasonMoves, so the
  // harness and the app share it): an AI club returns a pick who is
  // clearly the worst man on the roster, and ANY pick found in the
  // minors with a live flag goes home immediately — the demotion doors
  // are guarded, but a self-heal beats trusting every door forever.
  function aiStickTick(state, team, today) {
    const events = [];
    const players = state.players;
    const isUser = team.id === state.meta.userTeamId;
    for (const id of [...(team.roster || []), ...(team.minors || [])]) {
      const p = players[id];
      if (!p || !p.rule5 || p.rule5.year !== today.year) continue;
      if (p.status === 'minors') {              // leaked through a door
        const rec = returnPick(state, p);
        if (rec) events.push({ type: 'rule5-return', teamId: team.id, playerId: id });
        continue;
      }
      if (isUser) continue;                     // the user's carry is the user's call
      if (today.day !== 1) continue;            // monthly conscience, not daily churn
      const roster = (team.roster || []).map((q) => players[q]).filter((q) => q && q.id !== id);
      if (!roster.length) continue;
      const weakest = Math.min(...roster.map((q) => R().overall(q)));
      if (R().overall(p) < weakest - 1) {
        const rec = returnPick(state, p);
        if (rec) events.push({ type: 'rule5-return', teamId: team.id, playerId: id });
      }
    }
    return events;
  }

  // Spring compliance (v2.17.0): Part B's spring-training rebuilds
  // reshuffle rosters with no memory of December — a fresh pick can
  // wake up in AAA, which the rule forbids. For an AI club that IS the
  // March return (real drafts send half the class home before Opening
  // Day); the USER's pick was chosen by a human three weeks ago and is
  // never auto-lost — he's re-promoted, weakest man down.
  function springCompliance(state) {
    const players = state.players;
    const out = { returned: [], repromoted: [] };
    for (const team of state.league.teams) {
      for (const id of (team.minors || []).slice()) {
        const p = players[id];
        if (!p || !p.rule5) continue;
        if (team.id !== state.meta.userTeamId) {
          const rec = returnPick(state, p);
          if (rec) out.returned.push(rec);
          continue;
        }
        // Re-promote the user's pick.
        const mi = team.minors.indexOf(p.id);
        if (mi >= 0) team.minors.splice(mi, 1);
        if (team.roster.length >= 26) {
          const down = R().weakestDemotable(team, players, [p.id]);
          if (down) {
            team.roster.splice(team.roster.indexOf(down.id), 1);
            team.minors.push(down.id);
            down.status = 'minors';
            down.rosterStatus = R().demotionLevel(down);
            R().replaceRefs(team, players, down.id, null);
          }
        }
        team.roster.push(p.id);
        p.status = 'active';
        p.rosterStatus = '26-man';
        out.repromoted.push({ playerId: p.id, name: p.name });
      }
    }
    return out;
  }

  // Rollover Part A: the season is over — every surviving pick is his
  // club's player now, free and clear. Returns the survivors so the
  // letter block can tell the user about his own.
  function clearFlags(state, year) {
    const survived = [];
    for (const id in state.players) {
      const p = state.players[id];
      if (!p || !p.rule5) continue;
      if (p.rule5.year > year) continue;        // a fresh December pick
      survived.push({ playerId: p.id, name: p.name, teamId: p.teamId,
        fromTeamId: p.rule5.fromTeamId });
      R().logTx(state, p, 'Stuck the full season — Rule 5 restrictions lifted');
      delete p.rule5;
    }
    return survived;
  }

  return {
    winterYearFor, pending, firstProYear, serviceEligible, protectedSet,
    eligibleFor, exposedFor, buildPool, draftOrder, draftBoard,
    runDraft, returnPick, aiStickTick, clearFlags, stickCandidate,
    springCompliance,
  };
})();
