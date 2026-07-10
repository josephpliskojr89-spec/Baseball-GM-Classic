// Draft Hub — the standalone draft surface (bible 13.4/13.5/13.9, 20.10).
// The draft gets its own bottom-nav tab because it's a pillar event, not a
// buried menu item. The hub carries the full annual arc:
//
//   offseason  -> countdown + draft history
//   May-June   -> class preview: strength, mock draft, filterable big
//                 board, personal target list
//   June 30    -> the draft room: on-the-clock strip, live pick tracker,
//                 pick screen with scouting recommendation, quick-draft
//   post-draft -> recap: your class, round 1 results, signing fallout
window.BBGM_UI_DRAFT = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const DRAFT = () => window.BBGM_DRAFT;

  // Session-sticky view state (resets on reload, not on re-render).
  let posFilter = 'ALL';
  let bgFilter = 'ALL';
  let boardDepth = 50;

  function teamOf(state, id) { return state.league.teams.find((t) => t.id === id); }

  function strengthLabel(s) {
    if (s >= 1.2) return 'a generational class';
    if (s >= 0.5) return 'a deep class';
    if (s > -0.5) return 'an average class';
    if (s > -1.2) return 'a thin class';
    return 'one of the weakest classes in memory';
  }

  function render(container, state) {
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Draft Hub'));

    const draft = state.draft;
    const today = state.meta.currentDate;
    const isDraftDay = DRAFT().draftDayPending(state, today);

    if (!draft || draft.year < today.year) {
      renderCountdown(container, state);
    } else if (draft.phase === 'live') {
      renderDraftRoom(container, state);
    } else if (draft.phase === 'complete') {
      renderRecap(container, state);
    } else if (isDraftDay) {
      renderDraftDayLanding(container, state);
    } else {
      renderPreview(container, state);
    }

    renderHistory(container, state);
  }

  // ---- Offseason / pre-May --------------------------------------------------

  function renderCountdown(container, state) {
    const today = state.meta.currentDate;
    const classYear = today.month >= 7 ? today.year + 1 : today.year;
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `${classYear} NABL Amateur Draft`));
    card.appendChild(U.el('p', { style: { 'font-size': '13px' } },
      `Class rankings release May 1. Draft day is June 30 — ten rounds, 300 picks, ` +
      `worst record picks first. The scouting department is already building its board.`));
    container.appendChild(card);
  }

  // ---- Pre-draft class preview (13.4) -----------------------------------------

  function renderPreview(container, state) {
    const draft = state.draft;
    const today = state.meta.currentDate;
    const daysOut = Math.max(0, D.diffDays(today, D.fromYMD(draft.year, 6, 30)));

    // Class card.
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `${draft.year} Draft Class`));
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
      `Scouts grade it ${strengthLabel(draft.strength)}. ` +
      `Draft day is June 30 — ${daysOut} day${daysOut !== 1 ? 's' : ''} out.`));
    const slots = DRAFT().userPickSlots(state);
    if (slots.length) {
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        `You pick #${slots[0].pick} in every round — overall picks ` +
        slots.slice(0, 3).map((s) => `#${s.overall}`).join(', ') + ', …'));
    }
    container.appendChild(card);

    renderMock(container, state);
    renderBigBoard(container, state, { pickMode: false });
  }

  function renderMock(container, state) {
    const draft = state.draft;
    if (DRAFT().mockIsStale(state)) {
      DRAFT().refreshMock(state);
      window.BBGM_STATE.set(state);
    }
    if (!draft.mock) return;
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Mock Draft — Round 1'),
    ]));
    const card = U.el('div', { class: 'card', style: { padding: '10px 12px' } });
    card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-bottom': '6px' } },
      `Industry consensus, refreshed weekly. Last updated ${D.format(draft.mockDate, 'date')}.`));
    const userTeamId = state.meta.userTeamId;
    const list = U.el('div', { class: 'roster-list' });
    for (const m of draft.mock) {
      const isUser = m.teamId === userTeamId;
      if (m.pick > 10 && !isUser) continue; // top 10 + the user's slot
      const p = draft.prospects[m.prospectId];
      const t = teamOf(state, m.teamId);
      if (!p || !t) continue;
      const row = U.el('button', {
        class: 'roster-row',
        style: isUser ? { border: '1px solid var(--accent, #58a6ff)' } : {},
        on: { click: () => showProspect(state, p.id) },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, String(m.pick)));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${t.abbr}${isUser ? ' (you)' : ''} — ${p.name}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `${p.primaryPosition} • ${p.school}`));
      row.appendChild(info);
      list.appendChild(row);
    }
    card.appendChild(list);
    container.appendChild(card);
  }

  // ---- Big board (13.4/13.5): shared by preview and the pick screen -----------

  const POS_FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'C', label: 'C' },
    { key: 'IF', label: 'IF' },
    { key: 'OF', label: 'OF' },
    { key: 'SP', label: 'SP' },
    { key: 'RP', label: 'RP' },
  ];
  const BG_FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'HS', label: 'HS' },
    { key: 'COL', label: 'College' },
  ];

  function matchesFilters(p) {
    if (posFilter === 'IF') {
      if (!['1B', '2B', '3B', 'SS'].includes(p.primaryPosition)) return false;
    } else if (posFilter === 'OF') {
      if (!['LF', 'CF', 'RF'].includes(p.primaryPosition)) return false;
    } else if (posFilter !== 'ALL' && p.primaryPosition !== posFilter) {
      return false;
    }
    if (bgFilter === 'HS' && p.background !== 'HS') return false;
    if (bgFilter === 'COL' && p.background === 'HS') return false;
    return true;
  }

  function filterBar(state, rerender) {
    const bar = U.el('div', { style: { display: 'flex', gap: '6px', 'flex-wrap': 'wrap', 'margin-bottom': '8px' } });
    const mkBtn = (label, active, onClick) => U.el('button', {
      class: active ? 'btn-primary btn-sm' : 'btn-secondary btn-sm',
      style: { padding: '4px 10px' },
      on: { click: onClick },
    }, label);
    for (const f of POS_FILTERS) {
      bar.appendChild(mkBtn(f.label, posFilter === f.key, () => { posFilter = f.key; rerender(); }));
    }
    const spacer = U.el('span', { style: { width: '8px' } });
    bar.appendChild(spacer);
    for (const f of BG_FILTERS) {
      bar.appendChild(mkBtn(f.label, bgFilter === f.key, () => { bgFilter = f.key; rerender(); }));
    }
    return bar;
  }

  // pickMode: rows get a Draft action (user on the clock).
  function renderBigBoard(container, state, opts) {
    const draft = state.draft;
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, opts.pickMode ? 'Available Prospects' : 'Big Board'),
    ]));
    const wrap = U.el('div');
    container.appendChild(wrap);

    const rerender = () => {
      U.clearChildren(wrap);
      wrap.appendChild(filterBar(state, rerender));

      const boardIds = opts.pickMode ? DRAFT().availableBoard(state) : draft.board;
      const targets = new Set(draft.userBoard || []);
      // Targets pin to the top of the pick screen (13.5 big board ranking).
      const ordered = opts.pickMode
        ? boardIds.filter((id) => targets.has(id)).concat(boardIds.filter((id) => !targets.has(id)))
        : boardIds;

      const list = U.el('div', { class: 'roster-list' });
      let shown = 0;
      for (let i = 0; i < ordered.length && shown < boardDepth; i++) {
        const p = draft.prospects[ordered[i]];
        if (!p || !matchesFilters(p)) continue;
        shown++;
        const rank = draft.board.indexOf(p.id) + 1;
        list.appendChild(prospectRow(state, p, rank, targets.has(p.id), opts));
      }
      if (!shown) {
        list.appendChild(U.el('div', { class: 'empty-state' }, 'No prospects match those filters.'));
      }
      wrap.appendChild(list);
      if (shown >= boardDepth) {
        wrap.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { width: '100%', 'margin-top': '6px' },
          on: { click: () => { boardDepth += 50; rerender(); } },
        }, 'Show More'));
      }
    };
    rerender();
  }

  function prospectRow(state, p, rank, isTarget, opts) {
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showProspect(state, p.id, opts) },
    });
    row.appendChild(U.el('span', { class: 'pos-badge' }, String(rank)));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' },
      `${isTarget ? '★ ' : ''}${p.name}`));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `${p.primaryPosition} • ${p.bats}/${p.throws} • ${p.age} • ${p.school}`));
    row.appendChild(info);
    const mid = (p.scout.ceilLo + p.scout.ceilHi) / 2;
    const band = U.el('div', { class: 'player-row-stats' });
    band.appendChild(U.el('div', { class: U.gradeClass(mid), style: { 'font-weight': '700' } },
      `${p.scout.ceilLo}–${p.scout.ceilHi}`));
    band.appendChild(U.el('div', { class: 'player-row-meta' }, 'ceiling'));
    row.appendChild(band);
    return row;
  }

  // Scouting-report modal (13.4): tools now, projected ceiling band, target
  // toggle — and the Draft action when the user is on the clock.
  function showProspect(state, prospectId, opts = {}) {
    const draft = state.draft;
    const p = draft.prospects[prospectId];
    if (!p) return;
    const rank = draft.board.indexOf(p.id) + 1;
    const targets = draft.userBoard || (draft.userBoard = []);
    const isTarget = targets.includes(p.id);

    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `${p.primaryPosition} • Bats ${p.bats} / Throws ${p.throws} • Age ${p.age} • ${p.school}` +
      ` • Board rank #${rank}`));

    const toolPairs = p.isPitcher
      ? [['VEL', p.ratings.velocity], ['STF', p.ratings.stuff], ['MOV', p.ratings.movement],
         ['CTL', p.ratings.control], ['STA', p.ratings.stamina]]
      : [['CON', (p.ratings.contactVsR + p.ratings.contactVsL) / 2],
         ['POW', (p.ratings.powerVsR + p.ratings.powerVsL) / 2],
         ['DIS', p.ratings.discipline], ['SPD', p.ratings.speed],
         ['DEF', p.ratings.defense], ['ARM', p.ratings.arm]];
    const grid = U.el('div', { style: { display: 'flex', gap: '12px', 'flex-wrap': 'wrap', 'margin-bottom': '10px' } });
    for (const [label, v] of toolPairs) {
      const cell = U.el('div', { style: { 'text-align': 'center' } });
      cell.appendChild(U.el('div', { class: U.gradeClass(v), style: { 'font-weight': '700', 'font-size': '16px' } },
        String(U.gradeFor(v))));
      cell.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '10px' } }, label));
      grid.appendChild(cell);
    }
    body.appendChild(grid);
    const mid = (p.scout.ceilLo + p.scout.ceilHi) / 2;
    body.appendChild(U.el('p', { style: { 'font-size': '13px' } }, [
      'Projected ceiling: ',
      U.el('span', { class: U.gradeClass(mid), style: { 'font-weight': '700' } },
        `${p.scout.ceilLo}–${p.scout.ceilHi}`),
      ` on his best tool. ${p.background === 'HS'
        ? 'High schooler — wide error bars, long development runway.'
        : 'College product — tighter projection, closer to ready.'}`,
    ]));

    const actions = [];
    if (opts.pickMode && DRAFT().isUserOnClock(state)) {
      const otc = DRAFT().onTheClock(state);
      actions.push({
        label: `Draft #${otc.overall}: ${p.lastName}`, kind: 'primary',
        onClick: () => {
          DRAFT().makePick(state, p.id);
          window.BBGM_STATE.set(state);
          setTimeout(() => afterUserPick(state, p), 0);
          return true;
        },
      });
    }
    actions.push({
      label: isTarget ? '★ Remove Target' : '☆ Flag as Target', kind: 'secondary',
      onClick: () => {
        if (isTarget) targets.splice(targets.indexOf(p.id), 1);
        else targets.push(p.id);
        window.BBGM_STATE.set(state);
        window.BBGM_MAIN.refresh();
        return true;
      },
    });
    actions.push({ label: 'Close', kind: 'secondary', onClick: () => true });

    U.showModal({ title: p.name, body, actions });
  }

  function afterUserPick(state, p) {
    U.showToast(`With the pick, you select ${p.name} (${p.primaryPosition}).`, 'success', 4000);
    window.BBGM_MAIN.refresh();
  }

  // ---- Draft-day landing (phase still preview on June 30) ---------------------

  function renderDraftDayLanding(container, state) {
    const draft = state.draft;
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `Draft Day — ${draft.year}`));
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } },
      `Ten rounds. 300 picks. Scouts grade it ${strengthLabel(draft.strength)}. ` +
      `The season resumes when the draft wraps.`));
    card.appendChild(U.el('button', {
      class: 'btn-primary', style: { width: '100%' },
      on: { click: () => {
        DRAFT().startDraft(state);
        window.BBGM_STATE.set(state);
        window.BBGM_MAIN.refresh();
      }},
    }, 'Begin the Draft'));
    container.appendChild(card);
    renderMock(container, state);
    renderBigBoard(container, state, { pickMode: false });
  }

  // ---- The draft room (13.5 / 20.10) -------------------------------------------

  function renderDraftRoom(container, state) {
    const draft = state.draft;
    const otc = DRAFT().onTheClock(state);
    if (!otc) { renderRecap(container, state); return; }
    const team = teamOf(state, otc.teamId);
    const isUser = otc.teamId === state.meta.userTeamId;

    // On-the-clock strip (20.10 top strip).
    const strip = U.el('div', {
      class: 'card',
      style: isUser ? { border: '1px solid var(--accent, #58a6ff)' } : {},
    });
    strip.appendChild(U.el('div', { class: 'card-title' },
      `Round ${otc.round}, Pick ${otc.pickInRound} — #${otc.overall} overall`));
    const line = U.el('div', { style: { display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '10px' } });
    line.appendChild(U.teamCap(team));
    line.appendChild(U.el('strong', {}, isUser ? `${team.name} — YOU are on the clock` : `${team.name} are on the clock`));
    strip.appendChild(line);

    if (isUser) {
      const recId = DRAFT().recommendation(state, otc.teamId);
      const rec = recId && draft.prospects[recId];
      if (rec) {
        strip.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } }, [
          'Scouting dept recommends: ',
          U.el('strong', {}, `${rec.name} (${rec.primaryPosition})`),
          ` — board #${draft.board.indexOf(rec.id) + 1}. Tap any prospect below to draft him.`,
        ]));
        strip.appendChild(U.el('button', {
          class: 'btn-primary btn-sm', style: { width: '100%', 'margin-bottom': '6px' },
          on: { click: () => showProspect(state, rec.id, { pickMode: true }) },
        }, `View ${rec.name}`));
      }
      strip.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { width: '100%' },
        on: { click: () => {
          U.showModal({
            title: 'Auto-draft the rest?',
            body: 'Your scouting department makes this and all your remaining picks, and the rest of the draft resolves instantly.',
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Auto-draft', kind: 'primary', onClick: () => {
                DRAFT().autoRunDraft(state);
                window.BBGM_STATE.set(state);
                setTimeout(() => window.BBGM_MAIN.refresh(), 0);
                return true;
              }},
            ],
          });
        }},
      }, 'Auto-draft My Remaining Picks'));
    } else {
      const grid = U.el('div', { style: { display: 'flex', gap: '8px' } });
      grid.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { flex: '1' },
        on: { click: () => {
          DRAFT().advancePick(state);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
        }},
      }, 'Next Pick ▶'));
      grid.appendChild(U.el('button', {
        class: 'btn-primary btn-sm', style: { flex: '1' },
        on: { click: () => {
          // Quick-draft (13.5): other teams' picks resolve instantly up to
          // the user's next selection.
          let guard = 0;
          while (guard++ < 320) {
            const r = DRAFT().advancePick(state);
            if (r.userTurn || r.done) break;
          }
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
        }},
      }, 'Sim to My Pick ▶▶'));
      strip.appendChild(grid);
    }
    container.appendChild(strip);

    // Live tracker (13.9): the last picks, newest first.
    if (draft.picks.length) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Live Tracker'),
      ]));
      const list = U.el('div', { class: 'news-list' });
      for (const pk of draft.picks.slice(-10).reverse()) {
        const t = teamOf(state, pk.teamId);
        const item = U.el('div', { class: 'news-item' });
        item.appendChild(U.el('div', { class: 'date' }, `R${pk.round} P${pk.pick}`));
        item.appendChild(U.el('div', { class: 'body', html:
          `${t ? t.abbr : '?'} select <strong>${pk.name}</strong>, ${pk.pos}, ${pk.school}.` }));
        list.appendChild(item);
      }
      container.appendChild(list);
    }

    // My picks so far.
    const mine = draft.picks.filter((pk) => pk.teamId === state.meta.userTeamId);
    if (mine.length) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Your Picks'),
      ]));
      const card = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      for (const pk of mine) {
        card.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `R${pk.round} (#${pk.overall}): ${pk.name} — ${pk.pos}, ${pk.school}`));
      }
      container.appendChild(card);
    }

    renderBigBoard(container, state, { pickMode: true });
  }

  // ---- Post-draft recap (13.9) --------------------------------------------------

  function renderRecap(container, state) {
    const draft = state.draft;
    const recap = draft.recap;
    if (!recap) return;

    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `${recap.year} Draft — Complete`));
    const first = recap.round1[0];
    const t1 = first && teamOf(state, first.teamId);
    card.appendChild(U.el('p', { style: { 'font-size': '13px' } },
      (first ? `#1 overall: ${first.name} (${first.pos}) to ${t1 ? t1.abbr : '?'}. ` : '') +
      `${recap.signedCount} of 300 picks signed. Scouts graded it ${strengthLabel(recap.strength)}.`));
    container.appendChild(card);

    // The user's class.
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Your Draft Class'),
    ]));
    const list = U.el('div', { class: 'roster-list' });
    for (const pk of recap.userPicks) {
      const signedPlayer = pk.signed && state.players[pk.prospectId];
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => { if (signedPlayer) window.BBGM_UI_PLAYER.show(pk.prospectId); } },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, `R${pk.round}`));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, `${pk.name} — ${pk.pos}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `#${pk.overall} overall • ${pk.school}` +
        (pk.signed ? ` • signed $${pk.bonus}M` : ' • DID NOT SIGN')));
      row.appendChild(info);
      if (signedPlayer) {
        row.appendChild(U.el('div', { class: 'player-row-stats' }, signedPlayer.rosterStatus));
      }
      list.appendChild(row);
    }
    container.appendChild(list);

    // Round 1 league-wide.
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Round 1 Results'),
    ]));
    const r1 = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
    for (const pk of recap.round1) {
      const t = teamOf(state, pk.teamId);
      r1.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '3px 0' } },
        `${pk.pick}. ${t ? t.abbr : '?'} — ${pk.name}, ${pk.pos}, ${pk.school}` +
        (pk.signed === false ? ' (unsigned)' : '')));
    }
    container.appendChild(r1);

    if (recap.unsignedNotable.length) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Signing Fallout'),
      ]));
      const card2 = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      for (const pk of recap.unsignedNotable) {
        const t = teamOf(state, pk.teamId);
        card2.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '3px 0' } },
          `${t ? t.abbr : '?'} fail to sign R${pk.round} pick ${pk.name} (${pk.pos}) — he returns to school.`));
      }
      container.appendChild(card2);
    }
  }

  // ---- Draft history --------------------------------------------------------------

  function renderHistory(container, state) {
    const hist = (state.draftHistory || []).slice().reverse();
    // Don't repeat the year the recap view already covers.
    const skipYear = state.draft && state.draft.phase === 'complete' &&
      state.draft.year >= state.meta.currentDate.year ? state.draft.year : null;
    const rows = hist.filter((h) => h.year !== skipYear);
    if (!rows.length) return;
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Draft History'),
    ]));
    const list = U.el('div', { class: 'roster-list' });
    for (const h of rows) {
      const first = h.picks[0];
      const userPick = h.picks.find((pk) => pk.teamId === state.meta.userTeamId);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => showHistoryYear(state, h) },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, String(h.year)));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        first ? `#1: ${first.name} (${first.pos})` : '—'));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        userPick ? `Your R1: ${userPick.name} (#${userPick.overall})` : ''));
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  function showHistoryYear(state, h) {
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `Scouts graded it ${strengthLabel(h.strength)}.`));
    const userTeamId = state.meta.userTeamId;
    const section = (title, picks) => {
      if (!picks.length) return;
      body.appendChild(U.el('div', { style: { 'font-weight': '700', margin: '8px 0 4px' } }, title));
      for (const pk of picks) {
        const t = state.league.teams.find((x) => x.id === pk.teamId);
        const alive = pk.playerId && state.players[pk.playerId];
        const line = U.el('p', { style: { 'font-size': '12px', margin: '3px 0' } });
        const text = `${pk.overall}. ${t ? t.abbr : '?'} — ${pk.name}, ${pk.pos}` +
          (pk.signed === false ? ' (unsigned)' : '');
        if (alive) {
          line.appendChild(U.el('a', {
            href: '#',
            on: { click: (e) => { e.preventDefault(); U.closeModal(); window.BBGM_UI_PLAYER.show(pk.playerId); } },
          }, text));
        } else {
          line.textContent = text;
        }
        body.appendChild(line);
      }
    };
    section('Round 1', h.picks.filter((pk) => pk.round === 1));
    section('Your Picks', h.picks.filter((pk) => pk.teamId === userTeamId));
    U.showModal({
      title: `${h.year} NABL Draft`,
      body,
      actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
    });
  }

  return { render };
})();
