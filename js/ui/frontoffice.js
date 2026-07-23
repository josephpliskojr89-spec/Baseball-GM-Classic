// Front office UI: Free Agents browser (bible 20.11-lite) and Trade Center
// (20.9-lite). Rendered as sub-tabs of the Team view.
window.BBGM_UI_FRONTOFFICE = (function () {
  const U = window.BBGM_UI;
  const FA = () => window.BBGM_FA;
  const TRADES = () => window.BBGM_TRADES;
  const ROSTER = () => window.BBGM_ROSTER;

  // ---------- Free Agents ----------

  function renderFreeAgents(container, state) {
    const players = state.players;
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const payroll = FA().computePayroll(userTeam, players);

    const bar = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-bottom': '10px' } });
    bar.appendChild(U.el('div', { class: 'card-title' },
      state.meta.offseasonPhase === 'freeAgency'
        ? `Free Agency — period ${state.faMarket ? state.faMarket.round : 0}/${state.faMarket ? state.faMarket.totalRounds : 8}`
        : 'Free Agents'));
    bar.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
      `Payroll $${payroll.toFixed(1)}M of $${userTeam.payrollBase}M budget`));
    container.appendChild(bar);

    renderTeamNeeds(container, state, userTeam);

    // Position filter (0.48.0) — same chips as the Trade Finder, so
    // shopping the market works like shopping the trade block.
    const posBar = U.el('div', { class: 'filter-bar', style: { 'margin-bottom': '10px', 'flex-wrap': 'wrap', 'overflow-x': 'visible' } });
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP']) {
      posBar.appendChild(U.el('button', {
        class: `filter-chip${faPos === pos ? ' active' : ''}`,
        on: { click: () => { faPos = faPos === pos ? null : pos; window.BBGM_MAIN.refresh(); } },
      }, pos));
    }
    container.appendChild(posBar);

    if (state.meta.offseasonPhase === 'freeAgency' && state.faMarket) {
      renderMarket(container, state, userTeam);
    } else {
      renderInSeasonPool(container, state, userTeam);
    }
  }

  // Team Needs card (0.30.0): the front office's read on the roster's
  // holes, computed by the same thresholds the AI uses when it bids
  // (trades.needsReport). Shown on both the offseason market and the
  // in-season pool — same screen, same shopping list.
  function renderTeamNeeds(container, state, userTeam) {
    const rep = TRADES().needsReport(userTeam, state.players,
      state.meta.offseasonPhase === 'freeAgency' ? state.faMarket : null);
    const card = U.el('div', { class: 'card', style: { 'margin-bottom': '10px' } });
    card.appendChild(U.el('div', { class: 'card-title' }, 'Team Needs'));

    const lines = [];
    for (const w of rep.weakStarters) {
      lines.push(w.name
        ? `${w.pos} — starter grades ${w.ovr} (${w.name})`
        : `${w.pos} — no starter penciled in`);
    }
    if (rep.rotationDepth && rep.rotationDepth.need) {
      lines.push(`Rotation — 4th starter grades ${rep.rotationDepth.ovr}`);
    }
    for (const s of rep.shortfalls) lines.push(s.label);

    if (!lines.length) {
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        'No glaring holes — the front office likes the roster as built.'));
    } else {
      for (const l of lines) {
        card.appendChild(U.el('div', { style: { 'font-size': '13px', padding: '2px 0' } }, `• ${l}`));
      }
    }
    if (rep.departed.length) {
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
        'Hitting the market: ' + rep.departed.map((d) => `${d.name} (${d.pos})`).join(', ')));
    }
    container.appendChild(card);
  }

  // "Fills need" match — identical rule to the AI's isNeed check in
  // freeagency.js: pitchers only ever fill an SP need.
  function fillsNeed(needSet, p) {
    return p.isPitcher
      ? needSet.has('SP') && p.primaryPosition === 'SP'
      : needSet.has(p.primaryPosition);
  }

  function renderMarket(container, state, userTeam) {
    const players = state.players;
    const market = state.faMarket;
    const open = market.entries.filter((e) => {
      const p = players[e.playerId];
      if (e.signedTeamId || !p || p.retired) return false;
      return !faPos || p.primaryPosition === faPos;
    });
    if (!open.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        faPos ? `Nobody at ${faPos} left on the market.` : 'The market is picked clean.'));
      return;
    }
    const myOffers = new Set(market.userOffers.map((o) => o.playerId));
    const needSet = new Set(TRADES().teamNeeds(userTeam, players));
    const list = U.el('div', { class: 'roster-list' });
    for (const entry of open.slice(0, 80)) {
      const p = players[entry.playerId];
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => showFAModal(state, entry) },
      });
      row.appendChild(U.posBadge(p));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        p.name + (myOffers.has(p.id) ? '  📝' : '')));
      let meta = `Age ${p.age} • OVR ${U.gradeFor(ROSTER().overall(p))} • asking ${entry.askYears} yr / $${entry.askTotal}M`;
      if (entry.offersThisRound) meta += ` • ${entry.offersThisRound} team${entry.offersThisRound > 1 ? 's' : ''} in`;
      const metaEl = U.el('div', { class: 'player-row-meta' }, meta);
      if (fillsNeed(needSet, p)) {
        metaEl.appendChild(U.el('span', {
          style: { color: 'var(--chrome-primary, var(--accent, #58a6ff))', 'font-weight': '600' },
        }, ' • fills need'));
      }
      info.appendChild(metaEl);
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  function showFAModal(state, entry) {
    const p = state.players[entry.playerId];
    const market = state.faMarket;
    const myOffer = market.userOffers.find((o) => o.playerId === p.id);
    const body = U.el('div');
    const lines = [
      `Asking: ${entry.askYears} yr / $${entry.askTotal}M ($${entry.askAAV}M AAV)`,
    ];
    const prefs = FA().prefsText(entry);
    if (prefs) lines.push(`Word is he ${prefs}.`);
    if (entry.lastTopBid) lines.push(`Rival interest: you'd likely need to top ~$${entry.lastTopBid}M total.`);
    if (myOffer) lines.push(`Your standing offer: ${myOffer.years} yr / $${myOffer.total}M.`);
    lines.push('Offers are weighed at each FA period advance.');
    for (const l of lines) {
      body.appendChild(U.el('p', { style: { 'margin-bottom': '6px', 'font-size': '13px' } }, l));
    }

    const offerBtn = (label, years, total) => ({
      label, kind: 'primary',
      onClick: () => {
        const err = FA().makeUserOffer(state, p.id, years, Math.round(total * 10) / 10);
        if (err) { U.showToast(err, 'danger', 4500); return true; }
        window.BBGM_STATE.set(state);
        U.showToast(`Offer in: ${years} yr / $${(Math.round(total * 10) / 10)}M for ${p.name}.`, 'success');
        window.BBGM_MAIN.refresh();
        return true;
      },
    });
    const actions = [
      offerBtn(`Meet ask (${entry.askYears}y/$${entry.askTotal}M)`, entry.askYears, entry.askTotal),
      offerBtn(`Lowball −15%`, entry.askYears, entry.askTotal * 0.85),
      offerBtn(`Blow away +20%`, entry.askYears, entry.askTotal * 1.2),
    ];
    if (myOffer) {
      actions.push({
        label: 'Withdraw Offer', kind: 'danger',
        onClick: () => {
          FA().withdrawUserOffer(state, p.id);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
          return true;
        },
      });
    }
    actions.push({ label: 'View Profile', kind: 'secondary', onClick: () => { setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0); return true; } });
    actions.push({ label: 'Close', kind: 'secondary', onClick: () => true });
    U.showModal({ title: `${p.name} (${p.primaryPosition}, ${p.age})`, body, actions });
  }

  function renderInSeasonPool(container, state, userTeam) {
    const players = state.players;
    const pool = (state.freeAgents || [])
      .map((id) => players[id])
      .filter((p) => p && !p.retired && (!faPos || p.primaryPosition === faPos))
      .sort((a, b) => ROSTER().overall(b) - ROSTER().overall(a));
    if (!pool.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        faPos ? `Nobody at ${faPos} in the pool right now.`
          : 'No free agents available. The pool restocks when contracts expire in the offseason.'));
      return;
    }
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      'In-season signings are minor-league deals — the player reports to AAA (bible 16.9).'));
    const needSet = new Set(TRADES().teamNeeds(userTeam, state.players));
    const list = U.el('div', { class: 'roster-list' });
    for (const p of pool.slice(0, 50)) {
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => {
          U.showModal({
            title: `Sign ${p.name}?`,
            body: `Minor-league deal, 1 yr / $0.74M. He reports to AAA.`,
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Sign', kind: 'primary', onClick: () => {
                const err = FA().signMidSeason(state, userTeam, p.id);
                if (err) U.showToast(err, 'danger');
                else { window.BBGM_STATE.set(state); window.BBGM_MAIN.refresh(); }
                return true;
              }},
            ],
          });
        }},
      });
      row.appendChild(U.posBadge(p));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
      // Flavor league (0.41.0): where the unsigned man is playing.
      const FLAV = window.BBGM_FLAVOR;
      const playing = FLAV && p.playsIn && p.status === 'FA' ? FLAV.leagueName(p.playsIn) : null;
      const metaEl = U.el('div', { class: 'player-row-meta' },
        `Age ${p.age} • OVR ${U.gradeFor(ROSTER().overall(p))}` +
        (playing ? ` • playing in the ${playing}` : ''));
      if (fillsNeed(needSet, p)) {
        metaEl.appendChild(U.el('span', {
          style: { color: 'var(--chrome-primary, var(--accent, #58a6ff))', 'font-weight': '600' },
        }, ' • fills need'));
      }
      info.appendChild(metaEl);
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  // ---------- Trade Center ----------

  // Module-level draft survives re-renders within a session.
  let draft = null;
  let finderPos = null; // Trade Finder position filter (0.34.0)
  let faPos = null;     // Free agency position filter (0.48.0)

  // Trade Finder (0.34.0): pick a position, see who around the league
  // might actually move — computed from the same team-perspective values
  // the AI trades with (trades.findAvailable). Tapping a result opens
  // the builder with the partner and player already loaded.
  function renderTradeFinder(container, state, userTeam) {
    const C = window.BBGM_CONSTANTS;
    const card = U.el('div', { class: 'card', style: { 'margin-top': '10px' } });
    card.appendChild(U.el('div', { class: 'card-title' }, 'Trade Finder'));
    card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      'Pick a position to see which big-leaguers rival clubs would move for fair value. ' +
      'Anyone not listed costs a premium — or isn\'t moving at all.'));

    const chips = U.el('div', { class: 'filter-bar', style: { 'flex-wrap': 'wrap', gap: '4px' } });
    for (const pos of C.POSITIONS) {
      chips.appendChild(U.el('button', {
        class: `filter-chip${finderPos === pos ? ' active' : ''}`,
        on: { click: () => { finderPos = finderPos === pos ? null : pos; window.BBGM_MAIN.refresh(); } },
      }, pos));
    }
    card.appendChild(chips);
    container.appendChild(card);

    if (!finderPos) return;
    const found = TRADES().findAvailable(state, finderPos);
    if (!found.length) {
      container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', padding: '4px 2px' } },
        `Nobody at ${finderPos} is being shopped right now — check back as the season turns, or pay the premium.`));
      return;
    }
    const list = U.el('div', { class: 'roster-list card', style: { padding: '0' } });
    for (const f of found.slice(0, 20)) {
      const p = state.players[f.playerId];
      const t = state.league.teams.find((x) => x.id === f.teamId);
      // Tap → full profile first (0.35.0); the card's "Discuss Trade…"
      // action drops him into the builder.
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => window.BBGM_UI_PLAYER.show(f.playerId, null, { discussTrade: true }) },
      });
      row.appendChild(U.posBadge(p));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, `${p.name} (${p.age})`));
      const meta = U.el('div', { class: 'player-row-meta' },
        `${t ? t.abbr : '?'} • ${t ? t.competitiveWindow : ''} • ` +
        `$${((p.contract && p.contract.annualSalary) || 0).toFixed(1)}M × ${(p.contract && p.contract.years) || 0}y`);
      meta.appendChild(U.el('span', {
        style: { color: 'var(--chrome-primary, var(--accent, #58a6ff))', 'font-weight': '600' },
      }, ` • ${f.label}`));
      info.appendChild(meta);
      row.appendChild(info);
      const stats = U.el('div', { class: 'player-row-stats' });
      const ovr = Math.round(ROSTER().overall(p));
      stats.appendChild(U.el('span', { class: U.gradeClass(ovr) }, String(U.gradeFor(ovr))));
      stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
      row.appendChild(stats);
      list.appendChild(row);
    }
    container.appendChild(list);
    if (found.length > 20) {
      container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '4px' } },
        `${found.length - 20} more available at ${finderPos} — the best 20 shown.`));
    }
  }

  function renderTrades(container, state) {
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!TRADES().tradesAllowed(state)) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'The trade deadline has passed. Trading reopens in the offseason.'));
      draft = null;
      return;
    }

    // Incoming offers (15.5 / 15.7).
    const offers = state.pendingTradeOffers || [];
    if (offers.length) {
      container.appendChild(U.el('div', { class: 'card-title' }, `Incoming Offers (${offers.length})`));
      const list = U.el('div', { class: 'roster-list' });
      for (const offer of offers) {
        list.appendChild(offerRow(state, userTeam, offer));
      }
      container.appendChild(list);
    }

    if (draft && draft.teamId) {
      renderTradeBuilder(container, state, userTeam);
      return;
    }

    // Same Team Needs read as the FA screen (0.30.1) — the shopping
    // list applies whether you fill a hole with a signing or a swap.
    // The builder view gets a compact "your needs" line in its header
    // instead of the full card.
    renderTeamNeeds(container, state, userTeam);

    renderTradeFinder(container, state, userTeam);

    container.appendChild(U.el('button', {
      class: 'btn-primary', style: { width: '100%', margin: '12px 0' },
      on: { click: () => pickTradePartner(state) },
    }, 'New Trade Proposal…'));
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
      'Pick a partner, build a package, and their front office will accept, counter, or reject ' +
      'based on their competitive window and owner.'));
  }

  function offerRow(state, userTeam, offer) {
    const players = state.players;
    const from = state.league.teams.find((t) => t.id === offer.fromTeamId);
    const giveNames = offer.give.map((id) => players[id] ? players[id].name : '?').join(', ');
    const getNames = offer.get.map((id) => players[id] ? players[id].name : '?').join(', ');
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showIncomingOffer(state, userTeam, offer) },
    });
    if (from) row.appendChild(U.teamCap(from));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, `${from ? from.abbr : '?'} offer`));
    info.appendChild(U.el('div', { class: 'player-row-meta' }, `${giveNames} ⇄ ${getNames}`));
    row.appendChild(info);
    return row;
  }

  // Rich comparison row for trade surfaces (0.22.2): OVR (through the
  // scouting fog for rival farmhands), this season's line, age/level,
  // and the contract — everything needed to weigh a deal without hopping
  // between team pages. Tapping opens the full profile; the offer stays
  // pending on the Trades tab, so nothing is lost by drilling in.
  function tradePlayerRow(state, p) {
    const S = window.BBGM_STATS;
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
    });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    const lvl = p.status === 'minors' ? ` • ${p.rosterStatus}` : '';
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `Age ${p.age}${lvl} • $${((p.contract && p.contract.annualSalary) || 0).toFixed(1)}M × ` +
      `${(p.contract && p.contract.years) || 0}y`));
    let statLine;
    if (p.isPitcher) {
      statLine = s && (s.ipOuts || 0) > 0
        ? `${year}: ${s.w || 0}-${s.l || 0}, ${S.era(s).toFixed(2)} ERA, ${S.fmtIP(s.ipOuts)} IP, ${s.k || 0} K`
        : 'No MLB innings this year';
    } else {
      statLine = s && (s.ab || 0) > 0
        ? `${year}: ${S.fmtAvg(S.avg(s))}, ${s.hr || 0} HR, ${s.rbi || 0} RBI, ${s.sb || 0} SB`
        : 'No MLB at-bats this year';
    }
    info.appendChild(U.el('div', { class: 'player-row-meta' }, statLine));
    row.appendChild(info);
    // OVR through the user's scouting report — a rival farmhand shows the
    // band (or ??), never the true number.
    const rep = window.BBGM_SCOUT.report(state, p);
    const band = rep.ovrBand();
    const stats = U.el('div', { class: 'player-row-stats' });
    if (rep.mode === 'min') {
      stats.appendChild(U.el('span', { class: 'muted', style: { 'font-weight': '700' } }, '??'));
    } else if (band) {
      stats.appendChild(U.el('span', {
        class: U.gradeClass((band[0] + band[1]) / 2), style: { 'font-weight': '700', 'font-size': '13px' },
      }, `${band[0]}–${band[1]}`));
    } else {
      const ovr = Math.round(ROSTER().overall(p));
      stats.appendChild(U.el('span', {
        class: U.gradeClass(ovr), style: { 'font-weight': '700', 'font-size': '16px' },
      }, String(U.gradeFor(ovr))));
    }
    stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    row.appendChild(stats);
    return row;
  }

  function tradeCompareSection(state, title, list) {
    const wrap = U.el('div');
    wrap.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '8px' } }, title));
    const rows = U.el('div', { class: 'roster-list' });
    for (const p of list) rows.appendChild(tradePlayerRow(state, p));
    if (!list.length) rows.appendChild(U.el('div', { class: 'empty-state' }, 'Nobody'));
    wrap.appendChild(rows);
    return wrap;
  }

  function showIncomingOffer(state, userTeam, offer) {
    const players = state.players;
    const from = state.league.teams.find((t) => t.id === offer.fromTeamId);
    const give = offer.give.map((id) => players[id]).filter(Boolean); // they send
    const get = offer.get.map((id) => players[id]).filter(Boolean);   // they want
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-bottom': '4px' } },
      'Tap a player for his full card — the offer stays open on the Trades tab.'));
    body.appendChild(tradeCompareSection(state, `You receive from ${from.abbr}`, give));
    body.appendChild(tradeCompareSection(state, 'You send', get));
    U.showModal({
      title: `Trade offer from ${from.abbr}`,
      body,
      actions: [
        { label: 'Accept', kind: 'primary', onClick: () => {
          // Staleness guard (0.44.1): a pending offer lives 7 days, and a
          // named player can leave his org in that window (AI-AI deadline
          // deal, DFA, retirement). executeTrade would silently drop him
          // and ship the user's side for a partial return — so re-check
          // every id on BOTH sides against the org he was offered from,
          // and void the deal instead of executing it one-sided.
          const inOrg = (team, id) => [team.roster, team.minors, team.roster40, team.il]
            .some((arr) => arr && arr.includes(id));
          const goneId = (offer.give || []).find((id) => !inOrg(from, id)) ||
                         (offer.get || []).find((id) => !inOrg(userTeam, id));
          if (goneId != null) {
            const gone = players[goneId];
            U.showToast(`The deal is off — ${gone ? gone.name : 'a player in the offer'} ` +
              'is no longer available.', 'warning', 4500);
            state.pendingTradeOffers = (state.pendingTradeOffers || []).filter((o) => o.id !== offer.id);
            window.BBGM_STATE.set(state);
            window.BBGM_MAIN.refresh();
            return true;
          }
          const shape = TRADES().validateTradeShape(state, userTeam, get, from, give);
          if (shape) { U.showToast(shape, 'danger', 4500); return true; }
          const entry = TRADES().executeTrade(state, userTeam, get, from, give, 0, 0);
          TRADES().tradeNews(state, entry);
          state.pendingTradeOffers = (state.pendingTradeOffers || []).filter((o) => o.id !== offer.id);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
          U.showToast('Trade completed.', 'success');
          return true;
        }},
        { label: 'Reject', kind: 'danger', onClick: () => {
          state.pendingTradeOffers = (state.pendingTradeOffers || []).filter((o) => o.id !== offer.id);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
          return true;
        }},
        { label: 'Close', kind: 'secondary', onClick: () => true },
      ],
    });
  }

  function pickTradePartner(state) {
    const teams = state.league.teams
      .filter((t) => t.id !== state.meta.userTeamId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const body = U.el('div', { class: 'roster-list' });
    TRADES().setPlayersRef(state.players);
    for (const t of teams) {
      const needs = TRADES().teamNeeds(t, state.players);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => {
          U.closeModal();
          draft = { teamId: t.id, give: [], get: [], cashGive: 0, cashGet: 0 };
          window.BBGM_MAIN.refresh();
        }},
      });
      row.appendChild(U.teamCap(t));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, t.name));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `${t.competitiveWindow} • ${t.ownerName}` + (needs.length ? ` • needs: ${needs.join(', ')}` : '')));
      row.appendChild(info);
      body.appendChild(row);
    }
    U.showModal({ title: 'Trade with…', body, actions: [{ label: 'Cancel', kind: 'secondary', onClick: () => true }] });
  }

  // Two-page builder (0.35.0): page 1 is the PARTNER — browse their org
  // and pick who you want; page 2 is YOUR side — build the offer and
  // propose. One team per screen instead of one long scroll.
  function renderTradeBuilder(container, state, userTeam) {
    const players = state.players;
    const partner = state.league.teams.find((t) => t.id === draft.teamId);
    if (!draft.page) draft.page = 1;
    // The draft survives re-renders — including ones after the user sims
    // days with the builder open. AI deals, demotions, and retirements can
    // move a picked player in the meantime, so drop any pick who is no
    // longer in the side's org before rendering or proposing.
    const orgOf = (t) => new Set((t.roster || []).concat(t.minors || [], t.il || []));
    const myOrg = orgOf(userTeam);
    const theirOrg = orgOf(partner);
    draft.give = draft.give.filter((id) => myOrg.has(id));
    draft.get = draft.get.filter((id) => theirOrg.has(id));
    TRADES().setPlayersRef(players);
    const needs = TRADES().teamNeeds(partner, players);

    const head = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-bottom': '8px' } });
    head.appendChild(U.el('div', { class: 'card-title' },
      `Trade with ${partner.name} — step ${draft.page} of 2`));
    head.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
      draft.page === 1
        ? `${partner.competitiveWindow} • ${partner.ownerName}` +
          (needs.length ? ` • looking for: ${needs.join(', ')}` : '')
        : 'Build your offer — who goes the other way.'));
    // Your side of the shopping list, right next to theirs (0.30.1).
    const myNeeds = TRADES().teamNeeds(userTeam, players);
    if (myNeeds.length) {
      head.appendChild(U.el('div', {
        style: { 'font-size': '12px', color: 'var(--chrome-primary, var(--accent, #58a6ff))', 'margin-top': '2px' },
      }, `You need: ${myNeeds.join(', ')}`));
    }
    container.appendChild(head);

    const section = (title, team, listIds, mine) => {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '10px' } }, title));
      const list = U.el('div', { class: 'roster-list' });
      const selected = mine ? draft.give : draft.get;
      const ids = listIds.filter((id) => players[id]);
      for (const id of ids) {
        const p = players[id];
        const isSel = selected.includes(id);
        const row = U.el('button', {
          class: 'roster-row',
          style: isSel ? { outline: '2px solid var(--accent)' } : {},
          on: { click: () => {
            const arr = mine ? draft.give : draft.get;
            const i = arr.indexOf(id);
            if (i >= 0) arr.splice(i, 1);
            else if (arr.length < 4) arr.push(id); // 4-for-4 cap (15.2)
            else { U.showToast('Four players max per side.', 'warning'); return; }
            window.BBGM_MAIN.refresh();
          }},
        });
        row.appendChild(U.posBadge(p));
        const info = U.el('div', { class: 'player-row-info' });
        info.appendChild(U.el('div', { class: 'player-row-name' }, (isSel ? '✓ ' : '') + p.name));
        const lvl = p.status === 'minors' ? ` • ${p.rosterStatus}` : '';
        info.appendChild(U.el('div', { class: 'player-row-meta' },
          `Age ${p.age} • OVR ${U.gradeFor(ROSTER().overall(p))}${lvl} • $${(p.contract.annualSalary || 0).toFixed(1)}M × ${p.contract.years}y`));
        row.appendChild(info);
        list.appendChild(row);
      }
      container.appendChild(list);
    };

    // Money steppers (0.36.0). Cash is PAYROLL money in $1M steps (cap
    // $20M each way, 15.2); int'l pool space moves in $0.25M steps under
    // the signing rules, only while the current class is live.
    if (draft.poolGive == null) { draft.poolGive = 0; draft.poolGet = 0; }
    const poolOpen = state.intl && state.intl.phase !== 'complete';
    const mkStepper = (label, key, step, max, onUp) => {
      const wrap = U.el('div', { style: { display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '6px' } });
      wrap.appendChild(U.el('span', { style: { 'font-size': '12px', flex: '1' } },
        `${label}: $${(draft[key] || 0).toFixed(step < 1 ? 2 : 0)}M`));
      wrap.appendChild(U.el('button', { class: 'btn-secondary btn-sm', on: { click: () => {
        draft[key] = Math.max(0, Math.round((draft[key] - step) * 100) / 100);
        window.BBGM_MAIN.refresh();
      } } }, `−${step}`));
      wrap.appendChild(U.el('button', { class: 'btn-secondary btn-sm', on: { click: () => {
        const next = Math.min(max, Math.round((draft[key] + step) * 100) / 100);
        if (onUp && next > draft[key]) {
          const err = onUp(next);
          if (err) { U.showToast(`Can't add pool space — ${err}.`, 'warning', 4500); return; }
        }
        draft[key] = next;
        window.BBGM_MAIN.refresh();
      } } }, `+${step}`));
      return wrap;
    };
    const cashNote = () => U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '4px' } },
      'Cash is payroll money: what you receive offsets this season\'s payroll, ' +
      'what you send adds to it. The books reset each winter.');
    const poolNote = () => U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '4px' } },
      poolOpen
        ? 'Int\'l pool space trades under signing rules: unspent pool only, ' +
          'acquisitions cap at +60% of a club\'s base pool, and restricted clubs can\'t buy in.'
        : 'Int\'l pool space trades reopen with the next signing class.');
    const discardBtn = () => U.el('button', {
      class: 'btn-secondary', style: { flex: '1' },
      on: { click: () => { draft = null; window.BBGM_MAIN.refresh(); } },
    }, 'Discard');

    if (draft.page === 1) {
      // ---- Page 1: their side — pick who you want. ----
      section(`You receive (${draft.get.length} picked)`, partner,
        partner.roster.concat(partner.minors || []), false);
      const cashRow = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-top': '10px' } });
      cashRow.appendChild(mkStepper('Cash you receive', 'cashGet', 1, 20));
      cashRow.appendChild(cashNote());
      if (poolOpen) {
        cashRow.appendChild(mkStepper('Int\'l pool space you receive', 'poolGet', 0.25, 10,
          (next) => TRADES().poolTradeBlocker(state, partner.id, userTeam.id, next)));
      }
      cashRow.appendChild(poolNote());
      container.appendChild(cashRow);

      const actions = U.el('div', { style: { display: 'flex', gap: '8px', margin: '12px 0' } });
      actions.appendChild(U.el('button', {
        class: 'btn-primary', style: { flex: '2' },
        on: { click: () => {
          if (!draft.get.length) { U.showToast('Pick at least one player to receive.', 'warning'); return; }
          draft.page = 2;
          window.BBGM_MAIN.refresh();
          window.scrollTo(0, 0);
        } },
      }, 'Next: Your Offer ▶'));
      actions.appendChild(discardBtn());
      container.appendChild(actions);
      return;
    }

    // ---- Page 2: your side — build the offer and propose. ----
    section(`You send (${draft.give.length} picked)`, userTeam,
      userTeam.roster.concat(userTeam.minors || []), true);
    const cashRow = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-top': '10px' } });
    cashRow.appendChild(mkStepper('Cash you send', 'cashGive', 1, 20));
    cashRow.appendChild(cashNote());
    if (poolOpen) {
      cashRow.appendChild(mkStepper('Int\'l pool space you send', 'poolGive', 0.25, 10,
        (next) => TRADES().poolTradeBlocker(state, userTeam.id, partner.id, next)));
    }
    cashRow.appendChild(poolNote());
    // Live payroll impact of the money in this deal (0.36.0).
    const netCash = (draft.cashGive || 0) - (draft.cashGet || 0);
    if (netCash !== 0) {
      const payroll = FA().computePayroll(userTeam, players);
      cashRow.appendChild(U.el('p', {
        style: { 'font-size': '12px', 'font-weight': '600', 'margin-top': '4px',
          color: netCash > 0 ? 'var(--danger, #e25c5c)' : 'var(--success, #3fb950)' },
      }, `Payroll impact: ${netCash > 0 ? '+' : '−'}$${Math.abs(netCash)}M this season ` +
         `($${payroll.toFixed(1)}M now, $${(payroll + netCash).toFixed(1)}M after)`));
    }
    container.appendChild(cashRow);

    // Deal at a glance (0.22.2): the selected package, both sides, with
    // full comparison rows — no hopping between team pages to weigh it.
    if (draft.give.length || draft.get.length) {
      const glance = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-top': '10px' } });
      glance.appendChild(U.el('div', { class: 'card-title' }, 'Deal at a Glance'));
      glance.appendChild(tradeCompareSection(state, 'You send',
        draft.give.map((id) => players[id]).filter(Boolean)));
      glance.appendChild(tradeCompareSection(state, `You receive from ${partner.abbr}`,
        draft.get.map((id) => players[id]).filter(Boolean)));
      const money = [];
      if (draft.cashGive) money.push(`$${draft.cashGive}M cash out`);
      if (draft.cashGet) money.push(`$${draft.cashGet}M cash in`);
      if (draft.poolGive) money.push(`$${draft.poolGive.toFixed(2)}M pool out`);
      if (draft.poolGet) money.push(`$${draft.poolGet.toFixed(2)}M pool in`);
      if (money.length) {
        glance.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '4px' } },
          'Money in the deal: ' + money.join(' • ')));
      }
      container.appendChild(glance);
    }

    const actions = U.el('div', { style: { display: 'flex', gap: '8px', margin: '12px 0' } });
    actions.appendChild(U.el('button', {
      class: 'btn-primary', style: { flex: '2' },
      on: { click: () => submitProposal(state, userTeam, partner) },
    }, 'Propose Trade'));
    actions.appendChild(U.el('button', {
      class: 'btn-secondary', style: { flex: '1' },
      on: { click: () => { draft.page = 1; window.BBGM_MAIN.refresh(); window.scrollTo(0, 0); } },
    }, '◀ Their Side'));
    actions.appendChild(discardBtn());
    container.appendChild(actions);
  }

  function submitProposal(state, userTeam, partner) {
    const players = state.players;
    const give = draft.give.map((id) => players[id]).filter(Boolean);
    const get = draft.get.map((id) => players[id]).filter(Boolean);
    if (!give.length && !draft.cashGive && !draft.poolGive) { U.showToast('You have to send something.', 'warning'); return; }
    if (!get.length) { U.showToast('Pick at least one player to receive.', 'warning'); return; }

    const result = TRADES().evaluateProposal(state, partner, give, get,
      draft.cashGive, draft.cashGet, draft.poolGive, draft.poolGet);
    if (result.verdict === 'accept') {
      U.showModal({
        title: `${partner.abbr} accept!`,
        body: 'Their front office is in. Finalize the deal?',
        actions: [
          { label: 'Cancel', kind: 'secondary', onClick: () => true },
          { label: 'Finalize Trade', kind: 'primary', onClick: () => {
            const entry = TRADES().executeTrade(state, userTeam, give, partner, get,
              draft.cashGive, draft.cashGet, draft.poolGive, draft.poolGet);
            TRADES().tradeNews(state, entry);
            draft = null;
            window.BBGM_STATE.set(state);
            window.BBGM_MAIN.refresh();
            U.showToast('Trade completed.', 'success');
            return true;
          }},
        ],
      });
    } else if (result.verdict === 'counter') {
      const suggestion = TRADES().suggestAddition(state, userTeam, result.gap, give);
      const actions = [{ label: 'Keep Working', kind: 'secondary', onClick: () => true }];
      if (suggestion) {
        actions.unshift({
          label: `Add ${suggestion.name}`, kind: 'primary',
          onClick: () => {
            if (draft.give.length < 4) draft.give.push(suggestion.id);
            window.BBGM_MAIN.refresh();
            return true;
          },
        });
      }
      U.showModal({ title: `${partner.abbr} counter`, body: result.feedback, actions });
    } else {
      U.showModal({
        title: `${partner.abbr} pass`,
        body: result.feedback || 'They rejected the offer.',
        actions: [{ label: 'OK', kind: 'secondary', onClick: () => true }],
      });
    }
  }

  // ---------- Staff (bible 17) ----------

  function renderStaff(container, state) {
    const STAFF = window.BBGM_STAFF;
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const offseason = state.meta.offseasonPhase === 'freeAgency';
    const mgr = STAFF.managerFor(state, team);

    // Scouting department (bible 6.9 / Phase 13).
    renderScoutingCard(container, state, team, offseason);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Manager'));
    if (mgr) {
      const card = U.el('div', { class: 'card' });
      card.appendChild(U.el('div', { class: 'player-row-name' }, mgr.name));
      card.appendChild(U.el('div', { class: 'player-row-meta' },
        `${mgr.archetypeName} • Age ${mgr.age} • ${mgr.experience} yrs experience • ` +
        `Reputation ${mgr.reputation}/10` +
        (mgr.careerW + mgr.careerL > 0 ? ` • Career ${mgr.careerW}-${mgr.careerL}` : '')));
      const chips = U.el('div', { style: { display: 'flex', 'flex-wrap': 'wrap', gap: '6px', 'margin-top': '8px' } });
      for (const key in STAFF.TENDENCY_LABELS) {
        const v = mgr.tendencies[key];
        chips.appendChild(U.el('span', {
          class: 'filter-chip',
          style: { 'font-size': '11px', cursor: 'default' },
        }, `${STAFF.TENDENCY_LABELS[key]}: ${STAFF.tendencyLevel(v)}`));
      }
      card.appendChild(chips);
      if (offseason) {
        card.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { 'margin-top': '10px' },
          on: { click: () => {
            U.showModal({
              title: `Fire ${mgr.name}?`,
              body: 'He goes to the unemployed pool and you hire a replacement from GM → Staff. If the seat is still empty at Opening Day, the owner picks someone.',
              actions: [
                { label: 'Cancel', kind: 'secondary', onClick: () => true },
                { label: 'Fire Manager', kind: 'danger', onClick: () => {
                  STAFF.fireManager(state, team, 'fired-by-gm');
                  window.BBGM_STATE.set(state);
                  window.BBGM_MAIN.refresh();
                  return true;
                }},
              ],
            });
          }},
        }, 'Fire Manager…'));
      }
      container.appendChild(card);
    } else {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'No manager — the dugout is empty.'));
    }

    // Manager vacancy: interview candidates from the pool (17.6).
    if (!mgr && offseason) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Managerial Candidates'));
      container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
        'Make an offer — candidates weigh your situation. A decline is final until next winter.'));
      const cands = STAFF.poolManagers(state)
        .sort((a, b) => STAFF.managerAppeal(team, b) - STAFF.managerAppeal(team, a));
      for (const c of cands.slice(0, 10)) {
        container.appendChild(staffCandidateRow(state, team, c, 'manager', null,
          `${c.archetypeName} • Age ${c.age} • ${c.experience} yrs exp • Rep ${c.reputation}/10` +
          (c.formerPlayerId ? ' • Former player' : '')));
      }
    }

    // Coaches (17.4/17.6): fire opens a vacancy; vacancies fill through
    // offers, not at-will swaps. An unfilled seat gets an owner hire at
    // Opening Day.
    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Coaches'));
    for (const [field, label, domain] of [['hittingCoachId', 'Hitting Coach', 'hitting'], ['pitchingCoachId', 'Pitching Coach', 'pitching']]) {
      const coach = team[field] && state.staff.coaches[team[field]];
      const card = U.el('div', { class: 'card', style: { 'margin-bottom': '8px' } });
      card.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '11px' } }, label));
      if (coach) {
        card.appendChild(U.el('div', { class: 'player-row-name' }, coach.name));
        const pct = Math.round(coach.devMod * 100);
        card.appendChild(U.el('div', { class: 'player-row-meta', style: { 'white-space': 'normal' } },
          `Development ${pct >= 0 ? '+' : ''}${pct}%` +
          (coach.specialty ? ` • ${coach.specialty}` : '') +
          ` • Rep ${coach.reputation}/10` +
          (coach.formerPlayerId ? ' • Former player' : '')));
        if (offseason) {
          card.appendChild(U.el('button', {
            class: 'btn-secondary btn-sm', style: { 'margin-top': '8px' },
            on: { click: () => {
              U.showModal({
                title: `Fire ${coach.name}?`,
                body: 'He returns to the market and the seat opens. You hire a replacement by making offers — an empty seat at Opening Day gets an owner hire.',
                actions: [
                  { label: 'Cancel', kind: 'secondary', onClick: () => true },
                  { label: 'Fire Coach', kind: 'danger', onClick: () => {
                    STAFF.fireCoach(state, team, field);
                    window.BBGM_STATE.set(state);
                    window.BBGM_MAIN.refresh();
                    return true;
                  }},
                ],
              });
            }},
          }, 'Fire…'));
        }
      } else {
        card.appendChild(U.el('div', { class: 'player-row-meta' }, 'Vacant'));
        if (offseason) {
          card.appendChild(U.el('button', {
            class: 'btn-primary btn-sm', style: { 'margin-top': '8px' },
            on: { click: () => showCoachMarket(state, team, field, domain) },
          }, 'Interview Candidates…'));
        }
      }
      container.appendChild(card);
    }

    // Head scout (0.47.0): the one personality every international read
    // flows through. Same market rules as coaches — fire opens the seat,
    // vacancies fill by offer, an empty chair gets an owner hire at
    // Opening Day. His bias line is a soft tell, never a number.
    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Head Scout'));
    {
      const STAFF2 = window.BBGM_STAFF;
      const sc = STAFF2.scoutFor ? STAFF2.scoutFor(state, team) : null;
      const card = U.el('div', { class: 'card', style: { 'margin-bottom': '8px' } });
      card.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '11px' } }, 'International Scouting'));
      if (sc) {
        card.appendChild(U.el('div', { class: 'player-row-name' }, sc.name));
        card.appendChild(U.el('div', { class: 'player-row-meta', style: { 'white-space': 'normal' } },
          `Rep ${sc.reputation}/10 • Age ${sc.age} • ${sc.yearsInProfession} yrs in the game • ${sc.biasHint}`));
        if (offseason) {
          card.appendChild(U.el('button', {
            class: 'btn-secondary btn-sm', style: { 'margin-top': '8px' },
            on: { click: () => {
              U.showModal({
                title: `Fire ${sc.name}?`,
                body: 'He returns to the market and the chair opens. A new scout means tighter or looser reads — and a new set of blind spots you don\'t know yet.',
                actions: [
                  { label: 'Cancel', kind: 'secondary', onClick: () => true },
                  { label: 'Fire Scout', kind: 'danger', onClick: () => {
                    STAFF2.fireScout(state, team);
                    window.BBGM_STATE.set(state);
                    window.BBGM_MAIN.refresh();
                    return true;
                  }},
                ],
              });
            }},
          }, 'Fire…'));
        }
      } else {
        card.appendChild(U.el('div', { class: 'player-row-meta' }, 'Vacant'));
        if (offseason) {
          card.appendChild(U.el('button', {
            class: 'btn-primary btn-sm', style: { 'margin-top': '8px' },
            on: { click: () => showScoutMarket(state, team) },
          }, 'Interview Candidates…'));
        }
      }
      container.appendChild(card);
    }

    if (!offseason) {
      container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '8px' } },
        'Staff changes happen in the offseason.'));
    }
  }

  // Scouting department card (6.9): tier, cost, and the offseason budget ask.
  function renderScoutingCard(container, state, team, offseason) {
    const SC = window.BBGM_SCOUT;
    const tier = SC.tierDef(SC.tierOf(team));
    container.appendChild(U.el('div', { class: 'card-title' }, 'Scouting Department'));
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'player-row-name' }, `${tier.name} — $${tier.cost}M / yr`));
    card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', margin: '6px 0' } },
      'Tier gates how clearly you see prospects outside the organization: rival farm systems, the draft class, and the ' +
      'international pool. Your own players are always an open book. The cost comes out of the same ownership budget as payroll.'));
    if (offseason) {
      const idx = SC.tierIdx(team);
      const grid = U.el('div', { style: { display: 'flex', gap: '8px' } });
      if (idx < SC.TIERS.length - 1) {
        const up = SC.TIERS[idx + 1];
        grid.appendChild(U.el('button', {
          class: 'btn-primary btn-sm', style: { flex: '1' },
          on: { click: () => {
            const r = SC.requestTier(state, team, up.key);
            U.showToast(r.message, r.ok ? 'success' : 'warning', 5000);
            window.BBGM_STATE.set(state);
            window.BBGM_MAIN.refresh();
          }},
        }, `Request ${up.name} ($${up.cost}M)`));
      }
      if (idx > 0) {
        const down = SC.TIERS[idx - 1];
        grid.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { flex: '1' },
          on: { click: () => {
            const r = SC.requestTier(state, team, down.key);
            U.showToast(r.message, r.ok ? 'success' : 'warning', 5000);
            window.BBGM_STATE.set(state);
            window.BBGM_MAIN.refresh();
          }},
        }, `Cut to ${down.name} ($${down.cost}M)`));
      }
      card.appendChild(grid);
    } else {
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px' } },
        'Budget review happens in the offseason.'));
    }
    container.appendChild(card);
  }

  // Stacked candidate row (block layout — no flex/ellipsis collapse on
  // narrow modals). Tap for the offer flow.
  function staffCandidateRow(state, team, cand, kind, field, metaText) {
    const STAFF = window.BBGM_STAFF;
    const year = state.meta.currentDate.year;
    const declined = cand.declinedTeams && cand.declinedTeams[team.id] === year;
    const row = U.el('button', {
      class: 'roster-row',
      style: { display: 'block', 'text-align': 'left' },
      on: { click: () => {
        if (declined) {
          U.showToast(`${cand.name} already turned you down this winter.`, 'info');
          return;
        }
        showOfferModal(state, team, cand, kind, field, metaText);
      }},
    });
    row.appendChild(U.el('div', { class: 'player-row-name', style: { 'white-space': 'normal' } },
      cand.name + (declined ? ' — declined your offer' : '')));
    row.appendChild(U.el('div', { class: 'player-row-meta', style: { 'white-space': 'normal' } }, metaText));
    if (!declined) {
      row.appendChild(U.el('div', {
        class: 'muted', style: { 'font-size': '11px', 'margin-top': '2px' },
      }, `Outlook: ${STAFF.offerOutlook(state, team, cand)}`));
    }
    return row;
  }

  function showOfferModal(state, team, cand, kind, field, metaText) {
    const STAFF = window.BBGM_STAFF;
    U.showModal({
      title: cand.name,
      body: `${metaText}\n\nOutlook: ${STAFF.offerOutlook(state, team, cand)}. ` +
            `A decline is final until next winter.`,
      actions: [
        { label: 'Cancel', kind: 'secondary', onClick: () => true },
        { label: 'Offer the Job', kind: 'primary', onClick: () => {
          const r = STAFF.offerJob(state, team, cand, kind, field);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
          if (r.accepted) {
            U.showToast(`${cand.name} accepts!`, 'success');
          } else {
            U.showToast(`${cand.name} declines — he'll listen again next winter.`, 'warning', 5000);
          }
          return true;
        }},
      ],
    });
  }

  // Coach market for a vacant seat: block-layout rows, offer flow.
  function showCoachMarket(state, team, field, domain) {
    const STAFF = window.BBGM_STAFF;
    const cands = STAFF.poolCoaches(state, domain).sort((a, b) => b.reputation - a.reputation);
    const body = U.el('div');
    if (!cands.length) body.appendChild(U.el('div', { class: 'empty-state' }, 'Nobody available.'));
    for (const c of cands.slice(0, 12)) {
      const pct = Math.round(c.devMod * 100);
      body.appendChild(staffCandidateRow(state, team, c, 'coach', field,
        `Dev ${pct >= 0 ? '+' : ''}${pct}% • Rep ${c.reputation}/10 • Age ${c.age}` +
        (c.specialty ? ` • ${c.specialty}` : '')));
    }
    U.showModal({
      title: 'Coaching Market',
      body,
      actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
    });
  }

  // Scout market for a vacant chair (0.47.0) — same offer flow.
  function showScoutMarket(state, team) {
    const STAFF = window.BBGM_STAFF;
    const cands = STAFF.poolScouts(state).sort((a, b) => b.reputation - a.reputation);
    const body = U.el('div');
    if (!cands.length) body.appendChild(U.el('div', { class: 'empty-state' }, 'Nobody available.'));
    for (const c of cands.slice(0, 12)) {
      body.appendChild(staffCandidateRow(state, team, c, 'scout', null,
        `Rep ${c.reputation}/10 • Age ${c.age} • ${c.yearsInProfession} yrs in the game • ${c.biasHint}`));
    }
    U.showModal({
      title: 'Scouting Market',
      body,
      actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
    });
  }

  // ---------- Waiver wire (0.22.0) ----------

  function renderWaivers(container, state) {
    const players = state.players;
    const W = window.BBGM_WAIVERS;
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'In-season releases sit on waivers for 2 days. The worst record claims first, and the ' +
      'claiming club takes on the player\'s contract. Unclaimed players become free agents.'));

    // Your claim priority: how many clubs would jump you in line today.
    const worse = state.league.teams.filter((t) =>
      t.id !== userTeam.id && W.priority(t) < W.priority(userTeam)).length;
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      `Your claim priority today: #${worse + 1} of 30 (reverse standings).`));

    const wire = state.waivers || [];
    if (!wire.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'The wire is quiet — nobody on waivers right now.'));
      return;
    }

    const D = window.BBGM_DATES;
    const list = U.el('div', { class: 'roster-list' });
    for (const e of wire) {
      const p = players[e.playerId];
      if (!p) continue;
      const from = state.league.teams.find((t) => t.id === e.fromTeamId);
      const daysLeft = Math.max(0, 2 - D.diffDays(e.placedDate, state.meta.currentDate));
      const ovr = Math.round(ROSTER().overall(p));
      const sal = (p.contract && p.contract.annualSalary) || 0;
      const mine = e.fromTeamId === userTeam.id;

      const row = U.el('div', { class: 'roster-row' });
      row.appendChild(U.posBadge(p));
      const info = U.el('button', {
        class: 'player-row-info',
        style: { 'text-align': 'left', background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
        on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
      });
      info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `Age ${p.age} • OVR ${U.gradeFor(ovr)} • $${sal.toFixed(1)}M • ` +
        `waived by ${from ? from.abbr : '?'} • resolves in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`));
      row.appendChild(info);

      const act = U.el('div', { class: 'player-row-stats' });
      if (mine) {
        act.appendChild(U.el('span', { class: 'muted', style: { 'font-size': '11px' } }, 'your release'));
      } else {
        act.appendChild(U.el('button', {
          class: e.userClaim ? 'btn-secondary btn-sm' : 'btn-primary btn-sm',
          on: { click: () => {
            W.userClaim(state, p.id, !e.userClaim);
            window.BBGM_STATE.set(state);
            U.showToast(e.userClaim ? `Claim on ${p.name} withdrawn.` : `Claim entered on ${p.name}.`,
              e.userClaim ? 'info' : 'success');
            window.BBGM_MAIN.refresh();
          }},
        }, e.userClaim ? '✓ Claimed' : 'Claim'));
      }
      row.appendChild(act);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  // Open the two-page builder with a partner and player preloaded — the
  // player card's "Discuss Trade…" action lands here (0.35.0).
  function startTradeFor(state, p) {
    draft = { teamId: p.teamId, give: [], get: [p.id], cashGive: 0, cashGet: 0, page: 1 };
    window.BBGM_MAIN.navigate('gm', { tab: 'trades' });
  }

  return { renderFreeAgents, renderTrades, renderStaff, renderWaivers, startTradeFor };
})();
