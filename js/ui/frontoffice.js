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

    if (state.meta.offseasonPhase === 'freeAgency' && state.faMarket) {
      renderMarket(container, state, userTeam);
    } else {
      renderInSeasonPool(container, state, userTeam);
    }
  }

  function renderMarket(container, state, userTeam) {
    const players = state.players;
    const market = state.faMarket;
    const open = market.entries.filter((e) => !e.signedTeamId && players[e.playerId] && !players[e.playerId].retired);
    if (!open.length) {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'The market is picked clean.'));
      return;
    }
    const myOffers = new Set(market.userOffers.map((o) => o.playerId));
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
      info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
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
      .filter((p) => p && !p.retired)
      .sort((a, b) => ROSTER().overall(b) - ROSTER().overall(a));
    if (!pool.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'No free agents available. The pool restocks when contracts expire in the offseason.'));
      return;
    }
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      'In-season signings are minor-league deals — the player reports to AAA (bible 16.9).'));
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
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `Age ${p.age} • OVR ${U.gradeFor(ROSTER().overall(p))}`));
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  // ---------- Trade Center ----------

  // Module-level draft survives re-renders within a session.
  let draft = null;

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

  function showIncomingOffer(state, userTeam, offer) {
    const players = state.players;
    const from = state.league.teams.find((t) => t.id === offer.fromTeamId);
    const give = offer.give.map((id) => players[id]).filter(Boolean); // they send
    const get = offer.get.map((id) => players[id]).filter(Boolean);   // they want
    const body = U.el('div');
    body.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
      `${from.name} send: ${give.map((p) => `${p.name} (${p.primaryPosition})`).join(', ')}`));
    body.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
      `You send: ${get.map((p) => `${p.name} (${p.primaryPosition})`).join(', ')}`));
    U.showModal({
      title: `Trade offer from ${from.abbr}`,
      body,
      actions: [
        { label: 'Accept', kind: 'primary', onClick: () => {
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

  function renderTradeBuilder(container, state, userTeam) {
    const players = state.players;
    const partner = state.league.teams.find((t) => t.id === draft.teamId);
    TRADES().setPlayersRef(players);
    const needs = TRADES().teamNeeds(partner, players);

    const head = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-bottom': '8px' } });
    head.appendChild(U.el('div', { class: 'card-title' }, `Trade with ${partner.name}`));
    head.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
      `${partner.competitiveWindow} • ${partner.ownerName}` +
      (needs.length ? ` • looking for: ${needs.join(', ')}` : '')));
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

    section('You send', userTeam, userTeam.roster.concat(userTeam.minors || []), true);
    section('You receive', partner, partner.roster.concat(partner.minors || []), false);

    // Cash steppers (up to $20M each way, 15.2).
    const cashRow = U.el('div', { class: 'card', style: { padding: '10px 12px', 'margin-top': '10px' } });
    const mkCash = (label, key) => {
      const wrap = U.el('div', { style: { display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '6px' } });
      wrap.appendChild(U.el('span', { style: { 'font-size': '12px', flex: '1' } }, `${label}: $${draft[key]}M`));
      wrap.appendChild(U.el('button', { class: 'btn-secondary btn-sm', on: { click: () => { draft[key] = Math.max(0, draft[key] - 5); window.BBGM_MAIN.refresh(); } } }, '−5'));
      wrap.appendChild(U.el('button', { class: 'btn-secondary btn-sm', on: { click: () => { draft[key] = Math.min(20, draft[key] + 5); window.BBGM_MAIN.refresh(); } } }, '+5'));
      return wrap;
    };
    cashRow.appendChild(mkCash('Cash you send', 'cashGive'));
    cashRow.appendChild(mkCash('Cash you receive', 'cashGet'));
    container.appendChild(cashRow);

    const actions = U.el('div', { style: { display: 'flex', gap: '8px', margin: '12px 0' } });
    actions.appendChild(U.el('button', {
      class: 'btn-primary', style: { flex: '2' },
      on: { click: () => submitProposal(state, userTeam, partner) },
    }, 'Propose Trade'));
    actions.appendChild(U.el('button', {
      class: 'btn-secondary', style: { flex: '1' },
      on: { click: () => { draft = null; window.BBGM_MAIN.refresh(); } },
    }, 'Discard'));
    container.appendChild(actions);
  }

  function submitProposal(state, userTeam, partner) {
    const players = state.players;
    const give = draft.give.map((id) => players[id]).filter(Boolean);
    const get = draft.get.map((id) => players[id]).filter(Boolean);
    if (!give.length && !draft.cashGive) { U.showToast('You have to send something.', 'warning'); return; }
    if (!get.length) { U.showToast('Pick at least one player to receive.', 'warning'); return; }

    const result = TRADES().evaluateProposal(state, partner, give, get, draft.cashGive, draft.cashGet);
    if (result.verdict === 'accept') {
      U.showModal({
        title: `${partner.abbr} accept!`,
        body: 'Their front office is in. Finalize the deal?',
        actions: [
          { label: 'Cancel', kind: 'secondary', onClick: () => true },
          { label: 'Finalize Trade', kind: 'primary', onClick: () => {
            const entry = TRADES().executeTrade(state, userTeam, give, partner, get, draft.cashGive, draft.cashGet);
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

    container.appendChild(U.el('div', { class: 'card-title' }, 'Manager'));
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
              body: 'He goes to the unemployed pool and you hire a replacement from Team → Staff. If the seat is still empty at Opening Day, the owner picks someone.',
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

    // Vacancy: hire from the pool (17.6) during the offseason.
    if (!mgr && offseason) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Managerial Candidates'));
      const cands = STAFF.poolManagers(state)
        .sort((a, b) => STAFF.managerAppeal(team, b) - STAFF.managerAppeal(team, a));
      const list = U.el('div', { class: 'roster-list' });
      for (const c of cands.slice(0, 10)) {
        const row = U.el('button', {
          class: 'roster-row',
          on: { click: () => {
            U.showModal({
              title: `Hire ${c.name}?`,
              body: `${c.archetypeName} • ${c.experience} yrs experience • reputation ${c.reputation}/10.` +
                (c.formerPlayerId ? ' Former player.' : ''),
              actions: [
                { label: 'Cancel', kind: 'secondary', onClick: () => true },
                { label: 'Hire', kind: 'primary', onClick: () => {
                  STAFF.hireManager(state, team, c.id);
                  window.BBGM_STATE.set(state);
                  window.BBGM_MAIN.refresh();
                  U.showToast(`${c.name} is your new manager.`, 'success');
                  return true;
                }},
              ],
            });
          }},
        });
        const info = U.el('div', { class: 'player-row-info' });
        info.appendChild(U.el('div', { class: 'player-row-name' }, c.name));
        info.appendChild(U.el('div', { class: 'player-row-meta' },
          `${c.archetypeName} • Age ${c.age} • ${c.experience} yrs • Rep ${c.reputation}/10`));
        row.appendChild(info);
        list.appendChild(row);
      }
      container.appendChild(list);
    }

    // Coaches (17.4).
    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Coaches'));
    for (const [field, label, domain] of [['hittingCoachId', 'Hitting Coach', 'hitting'], ['pitchingCoachId', 'Pitching Coach', 'pitching']]) {
      const coach = team[field] && state.staff.coaches[team[field]];
      const card = U.el('div', { class: 'card', style: { 'margin-bottom': '8px' } });
      card.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '11px' } }, label));
      if (coach) {
        card.appendChild(U.el('div', { class: 'player-row-name' }, coach.name));
        const pct = Math.round(coach.devMod * 100);
        card.appendChild(U.el('div', { class: 'player-row-meta' },
          `Development ${pct >= 0 ? '+' : ''}${pct}%` +
          (coach.specialty ? ` • ${coach.specialty}` : '') +
          ` • Rep ${coach.reputation}/10` +
          (coach.formerPlayerId ? ' • Former player' : '')));
      } else {
        card.appendChild(U.el('div', { class: 'player-row-meta' }, 'Vacant'));
      }
      if (offseason) {
        card.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { 'margin-top': '8px' },
          on: { click: () => showCoachHire(state, team, field, domain, coach) },
        }, coach ? 'Replace…' : 'Hire…'));
      }
      container.appendChild(card);
    }
    if (!offseason) {
      container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '8px' } },
        'Staff changes happen in the offseason.'));
    }
  }

  function showCoachHire(state, team, field, domain, current) {
    const STAFF = window.BBGM_STAFF;
    const cands = STAFF.poolCoaches(state, domain).sort((a, b) => b.reputation - a.reputation);
    const body = U.el('div', { class: 'roster-list' });
    if (!cands.length) body.appendChild(U.el('div', { class: 'empty-state' }, 'Nobody available.'));
    for (const c of cands.slice(0, 12)) {
      const pct = Math.round(c.devMod * 100);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => {
          if (current) { current.teamId = null; current.yearsWithTeam = 0; }
          c.teamId = team.id;
          c.yearsWithTeam = 0;
          team[field] = c.id;
          U.closeModal();
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
          U.showToast(`${c.name} hired.`, 'success');
        }},
      });
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, c.name));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `Dev ${pct >= 0 ? '+' : ''}${pct}% • Rep ${c.reputation}/10 • Age ${c.age}` +
        (c.specialty ? ` • ${c.specialty}` : '')));
      row.appendChild(info);
      body.appendChild(row);
    }
    U.showModal({ title: 'Hire coach', body, actions: [{ label: 'Cancel', kind: 'secondary', onClick: () => true }] });
  }

  return { renderFreeAgents, renderTrades, renderStaff };
})();
