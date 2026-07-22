// Draft Hub — the standalone draft surface (bible 13.4/13.5/13.9, 20.10).
// The draft gets its own bottom-nav tab because it's a pillar event, not a
// buried menu item. The hub carries the full annual arc:
//
//   offseason  -> countdown + draft history
//   May-June   -> tabbed class preview: Overview (scout read + mock draft
//                 + history), Big Board (full filterable prospect list),
//                 Targets (the user's flagged players)
//   June 30    -> the draft room: on-the-clock strip, live pick tracker,
//                 pick screen with scouting recommendation, quick-draft
//   post-draft -> recap: your class, round 1 results, signing fallout
window.BBGM_UI_DRAFT = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const DRAFT = () => window.BBGM_DRAFT;

  // Session-sticky view state (resets on reload, not on re-render).
  let activeTab = 'overview';
  let posFilter = 'ALL';
  let bgFilter = 'ALL';
  let boardDepth = 50;

  function teamOf(state, id) { return state.league.teams.find((t) => t.id === id); }

  // Pool fog (5.7 / Phase 13): the displayed ceiling band widens or
  // tightens with the user's scouting tier, and deep cuts drop off the
  // report entirely. Returns [lo, hi] or null (no report).
  function poolBand(state, p, rank, pool) {
    const SC = window.BBGM_SCOUT;
    const pv = SC.poolView(state, rank, pool);
    // A targeted look (0.23.0 intl, 0.24.0 draft) opens a report on an
    // otherwise-unscouted prospect; if the tier already covers him, the
    // better read wins.
    let widen = pv.visible ? pv.widen : null;
    if (SC.hasTargetedLook(state, pool, p.id)) {
      const lk = SC.targetedLooks(state, pool);
      widen = widen == null ? lk.widen : Math.min(widen, lk.widen);
    }
    if (widen == null) return null;
    let lo = p.scout.ceilLo - widen;
    let hi = p.scout.ceilHi + widen;
    if (hi - lo < 4) { const mid = (lo + hi) / 2; lo = mid - 2; hi = mid + 2; }
    return [Math.max(20, Math.round(lo)), Math.min(82, Math.round(hi))];
  }

  // Tool grades are a privilege of good scouting: above-average+ tiers see
  // them across the board, everyone sees the very top of the class, and a
  // targeted look brings tool grades back at standard tier and up.
  function toolsVisible(state, rank, pool, prospectId) {
    const team = teamOf(state, state.meta.userTeamId);
    const SC = window.BBGM_SCOUT;
    if (SC.tierIdx(team) >= 2 || rank <= (pool === 'intl' ? 10 : 15)) return true;
    return !!prospectId && SC.hasTargetedLook(state, pool, prospectId) &&
      SC.targetedLooks(state, pool).tools;
  }

  function strengthLabel(s) {
    if (s >= 1.2) return 'a generational class';
    if (s >= 0.5) return 'a deep class';
    if (s > -0.5) return 'an average class';
    if (s > -1.2) return 'a thin class';
    return 'one of the weakest classes in memory';
  }

  function render(container, state, opts = {}) {
    if (opts.tab) activeTab = opts.tab;
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Draft Hub'));

    const draft = state.draft;
    const today = state.meta.currentDate;
    const isDraftDay = DRAFT().draftDayPending(state, today);
    const isIntlDay = window.BBGM_INTL.windowPending(state, today);

    // The live draft room owns the whole screen (a few minutes a year).
    if (draft && draft.phase === 'live') {
      renderDraftRoom(container, state);
      return;
    }

    // Tabbed hub — Overview / Big Board / Targets for the draft class,
    // Int'l for the July 2 signing pool (bible 14). Event hero cards sit
    // ABOVE the tabs so they're visible no matter which tab is open.
    if (isDraftDay) renderDraftDayCard(container, state);
    if (isIntlDay) renderIntlDayCard(container, state);

    const targetCount = draft && draft.phase === 'preview' ? (draft.userBoard || []).length : 0;
    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'overview', label: 'Overview' },
      { key: 'board', label: 'Big Board' },
      { key: 'targets', label: targetCount ? `Targets (${targetCount})` : 'Targets' },
      { key: 'intl', label: 'Int’l' },
      { key: 'top100', label: 'Top 100' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } },
      }, t.label));
    }
    container.appendChild(tabs);

    if (activeTab === 'board') renderBigBoardTab(container, state);
    else if (activeTab === 'targets') renderTargetsTab(container, state);
    else if (activeTab === 'intl') renderIntl(container, state);
    else if (activeTab === 'top100') renderTop100(container, state);
    else renderOverview(container, state);
  }

  // ---- NABL Pipeline Top 100 (0.29.0) --------------------------------------
  // League-wide prospect rankings, MLB-Pipeline style: signed minor
  // leaguers only (draft/intl pool players aren't ranked until they're in
  // an org), one list for the whole league. The consensus leans slightly
  // toward current ability over raw ceiling, so polished near-MLB talent
  // sits above lottery tickets. The band on the right is the user's own
  // scouts' potential read (fog rules unchanged).
  let top100Depth = 35;

  function renderTop100(container, state) {
    const SCOUT = window.BBGM_SCOUT;
    const list = SCOUT.prospectRankings(state);
    const userTeamId = state.meta.userTeamId;
    const mine = list.filter((e) => e.teamId === userTeamId).length;

    const intro = U.el('div', { class: 'card', style: { 'margin-bottom': '10px' } });
    intro.appendChild(U.el('div', { class: 'card-title' }, 'NABL Pipeline — Top 100 Prospects'));
    intro.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
      'The industry consensus on the best talent in the minors, updated live. ' +
      'Rankings weigh current ability a shade over projection — call-ups graduate off the list. ' +
      `Your organization has ${mine} player${mine === 1 ? '' : 's'} ranked.`));
    container.appendChild(intro);

    if (!list.length) {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'No ranked prospects.'));
      return;
    }

    const rows = U.el('div', { class: 'roster-list card', style: { padding: '0' } });
    let shown = 0;
    for (let i = 0; i < list.length && shown < top100Depth; i++, shown++) {
      const e = list[i];
      const p = state.players[e.id];
      if (!p) continue;
      const t = state.league.teams.find((x) => x.id === e.teamId);
      const isUser = e.teamId === userTeamId;
      const row = U.el('button', {
        class: 'roster-row',
        style: isUser ? { border: '1px solid var(--accent, #58a6ff)' } : {},
        on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, String(i + 1)));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${p.name} (${p.age})`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `${p.primaryPosition} • ${p.rosterStatus} • ${t ? t.abbr : '—'}${isUser ? ' (you)' : ''}`));
      row.appendChild(info);
      const band = SCOUT.potentialBand(state, p);
      const stats = U.el('div', { class: 'player-row-stats' });
      stats.appendChild(U.el('span', {
        style: { 'font-weight': '700', color: band ? 'var(--success, #3fb950)' : 'var(--text-muted, #8b949e)' },
      }, band ? `${band[0]}–${band[1]}` : '—'));
      stats.appendChild(U.el('span', { class: 'key' }, 'POT'));
      row.appendChild(stats);
      rows.appendChild(row);
    }
    container.appendChild(rows);
    if (shown < list.length) {
      container.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { width: '100%', 'margin-top': '8px' },
        on: { click: () => { top100Depth += 35; window.BBGM_MAIN.refresh(); } },
      }, 'Show More'));
    }
  }

  // ---- Overview tab: the scout's read, mock draft / recap, history ----------

  function renderOverview(container, state) {
    const draft = state.draft;
    const today = state.meta.currentDate;
    if (!draft || draft.year < today.year) {
      renderCountdown(container, state);
    } else if (draft.phase === 'complete') {
      renderRecap(container, state);
    } else {
      renderClassCard(container, state);
      renderMock(container, state);
    }
    renderHistory(container, state);
  }

  // Big Board / Targets only exist while a class is scoutable.
  function classInPreview(state) {
    return state.draft && state.draft.phase === 'preview' &&
      state.draft.year >= state.meta.currentDate.year;
  }

  function renderBigBoardTab(container, state) {
    if (!classInPreview(state)) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'No draft class on the board. Rankings release May 1.'));
      return;
    }
    // Targeted looks (0.24.0): trips-remaining line for this class. Only
    // meaningful for tiers whose coverage leaves unscouted names.
    const looks = window.BBGM_SCOUT.targetedLooks(state, 'draft');
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `Targeted scouting trips: ${looks.remaining} of ${looks.budget} left this class — ` +
      `open an unscouted prospect to send a scout for a closer look.`));
    renderBigBoard(container, state, { pickMode: false });
  }

  function renderTargetsTab(container, state) {
    if (!classInPreview(state)) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'No draft class on the board. Rankings release May 1.'));
      return;
    }
    renderTargets(container, state);
  }

  // ---- Targets tab: the user's flagged prospects ------------------------------

  function renderTargets(container, state) {
    const draft = state.draft;
    const ids = draft.userBoard || [];
    if (!ids.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'No targets flagged yet. Open a prospect from the Big Board and tap ' +
        '"☆ Flag as Target" — targets pin to the top of your list on draft day.'));
      return;
    }
    const list = U.el('div', { class: 'roster-list' });
    for (const id of ids) {
      const p = draft.prospects[id];
      if (!p) continue;
      const rank = draft.board.indexOf(p.id) + 1;
      list.appendChild(prospectRow(state, p, rank, true, { pickMode: false }));
    }
    container.appendChild(list);
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '8px' } },
      'Badge = consensus board rank. Tap a target to review his report or remove the flag.'));
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

  // ---- Pre-draft class card (13.4) ---------------------------------------------

  function renderClassCard(container, state) {
    const draft = state.draft;
    const today = state.meta.currentDate;
    const daysOut = Math.max(0, D.diffDays(today, D.fromYMD(draft.year, 6, 30)));

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
    // In the room the list needs its own header; on the Big Board tab the
    // tab label already says it.
    if (opts.pickMode) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Available Prospects'),
      ]));
    }
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
    const med = window.BBGM_SCOUT.medicalRead(p);
    info.appendChild(U.el('div', { class: 'player-row-name' },
      `${isTarget ? '★ ' : ''}${med && med.flagged ? '⚕ ' : ''}${p.name}`));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `${p.primaryPosition} • ${p.bats}/${p.throws} • ${p.age} • ${p.school}`));
    row.appendChild(info);
    const band = U.el('div', { class: 'player-row-stats' });
    const b = poolBand(state, p, rank, 'draft');
    if (b) {
      band.appendChild(U.el('div', { class: U.gradeClass((b[0] + b[1]) / 2), style: { 'font-weight': '700' } },
        `${b[0]}–${b[1]}`));
      band.appendChild(U.el('div', { class: 'player-row-meta' }, 'ceiling'));
    } else {
      band.appendChild(U.el('div', { class: 'muted', style: { 'font-weight': '700' } }, '—'));
      band.appendChild(U.el('div', { class: 'player-row-meta' }, 'no report'));
    }
    row.appendChild(band);
    return row;
  }

  // Prospect bio line (0.19.2): height/weight and full birthdate, shared by
  // the draft and intl report modals. Uses the profile card's bio fallback
  // so both surfaces always agree.
  function prospectBioLine(p) {
    const bio = window.BBGM_UI_PLAYER.bioOf(p);
    const months = window.BBGM_CONSTANTS.MONTHS;
    return U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `${window.BBGM_UI_PLAYER.fmtHeight(bio.heightIn)}, ${bio.weightLb} lb • ` +
      `Born ${months[bio.birthMonth - 1]} ${bio.birthDay}, ${p.birthYear}`);
  }

  // Public medical file (0.24.1): every tier sees this line — amateur
  // medicals are league disclosure, not scouting. The file can lie
  // (medicalRead's bait-and-switch), which is the fun of it.
  function medicalLine(p) {
    const med = window.BBGM_SCOUT.medicalRead(p);
    if (!med) return null;
    return U.el('p', {
      style: { 'font-size': '12px', 'margin-bottom': '8px', 'font-weight': '600',
        color: med.flagged ? 'var(--danger, #f85149)' : 'var(--success, #3fb950)' },
    }, `⚕ ${med.label}`);
  }

  // "From our scouts" (0.19.2): the draft-guide blurb — the department's
  // strengths/weaknesses read, as right or wrong as the tier that wrote it.
  function appendScoutNotes(body, state, p, pool) {
    const notes = window.BBGM_SCOUT.prospectNotes(state, p, { pool });
    if (!notes.length) return;
    const card = U.el('div', {
      style: { 'margin-top': '10px', padding: '8px 10px', 'border-left': '3px solid var(--accent)',
        background: 'rgba(255,255,255,0.03)', 'border-radius': '6px' },
    });
    card.appendChild(U.el('div', { class: 'muted',
      style: { 'font-size': '10px', 'letter-spacing': '0.6px', 'text-transform': 'uppercase', 'margin-bottom': '4px' } },
      'From our scouts'));
    for (const n of notes) {
      card.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '3px 0' } }, n));
    }
    body.appendChild(card);
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
    body.appendChild(prospectBioLine(p));
    const medEl = medicalLine(p);
    if (medEl) body.appendChild(medEl);

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
    if (toolsVisible(state, rank, 'draft', p.id)) body.appendChild(grid);
    else body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'Tool grades are thin at your scouting tier — upgrade the department (GM → Staff) for full reports this deep in the class.'));
    const SC = window.BBGM_SCOUT;
    const looks = SC.targetedLooks(state, 'draft');
    const looked = SC.hasTargetedLook(state, 'draft', p.id);
    const db = poolBand(state, p, rank, 'draft');
    body.appendChild(U.el('p', { style: { 'font-size': '13px' } }, db ? [
      'Projected ceiling: ',
      U.el('span', { class: U.gradeClass((db[0] + db[1]) / 2), style: { 'font-weight': '700' } },
        `${db[0]}–${db[1]}`),
      looked
        ? ' on his best tool — from your scout\'s targeted trip, one look rather than full coverage.'
        : ` on his best tool. ${p.background === 'HS'
          ? 'High schooler — wide error bars, long development runway.'
          : 'College product — tighter projection, closer to ready.'}`,
    ] : looks.remaining > 0
      ? 'Your scouts have no real book on him — but you could send one for a closer look.'
      : 'Your scouts have no real book on him — a name on a list, and the travel budget for this class is spent.'));
    if (db) appendScoutNotes(body, state, p, 'draft');

    const actions = [];
    // Targeted look (0.24.0): same trips-and-quality budget as the intl
    // pool, spent on this class's deep cuts.
    if (!db && looks.remaining > 0) {
      actions.push({
        label: `Send a Scout (${looks.remaining} trip${looks.remaining !== 1 ? 's' : ''} left)`,
        kind: 'primary',
        onClick: () => {
          if (!draft.userLooks) draft.userLooks = [];
          draft.userLooks.push(p.id);
          window.BBGM_STATE.set(state);
          U.showToast(`Scout dispatched — report on ${p.name} is in.`, 'success');
          window.BBGM_MAIN.refresh();
          setTimeout(() => showProspect(state, p.id, opts), 0);
          return true;
        },
      });
    }
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

  // ---- Draft-day landing card (phase still preview on June 30) -----------------

  function renderDraftDayCard(container, state) {
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

  // ---- International tab (bible 14) -----------------------------------------
  // The July 2 signing pool lives beside the draft: same hub, same
  // scouting rhythms, different rules — a bonus pool instead of picks.

  let intlDepth = 30;
  let recapDepth = 35;

  function INTL() { return window.BBGM_INTL; }

  function renderIntlDayCard(container, state) {
    const intl = state.intl;
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `International Signing Day — ${intl.year}`));
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } },
      `The window is open. Work your bonus pool against 29 rival clubs — ` +
      `the season resumes when the window closes.`));
    card.appendChild(U.el('button', {
      class: 'btn-primary', style: { width: '100%' },
      on: { click: () => {
        INTL().openWindow(state);
        activeTab = 'intl';
        window.BBGM_STATE.set(state);
        window.BBGM_MAIN.refresh();
      }},
    }, intl.phase === 'window' ? 'Back to the Window' : 'Open the Signing Window'));
    container.appendChild(card);
  }

  function intlBudgetLine(state) {
    const intl = state.intl;
    const b = intl.budgets[state.meta.userTeamId] || { pool: 0, spent: 0, restricted: false };
    // Standing top-tier offers count as committed money in the display.
    let committed = 0;
    for (const pid in intl.userOffers || {}) committed += intl.userOffers[pid];
    const remaining = Math.round((b.pool - b.spent - committed) * 100) / 100;
    return { b, committed, remaining };
  }

  function renderIntlBudgetCard(container, state) {
    const intl = state.intl;
    const today = state.meta.currentDate;
    const { b, committed, remaining } = intlBudgetLine(state);
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `${intl.year} International Class`));
    const daysOut = Math.max(0, D.diffDays(today, D.fromYMD(intl.year, 7, 2)));
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '6px' } },
      `~100 prospects sign starting July 2` +
      (intl.phase === 'scouting' ? ` — ${daysOut} day${daysOut !== 1 ? 's' : ''} out.` : '.')));
    const over = remaining < 0;
    card.appendChild(U.el('p', {
      style: { 'font-size': '13px', 'font-weight': '700', color: over ? 'var(--danger, #f85149)' : 'inherit' },
    }, `Bonus pool $${b.pool.toFixed(1)}M • spent $${b.spent.toFixed(2)}M` +
       (committed ? ` • offers out $${committed.toFixed(2)}M` : '') +
       ` • ${over ? 'OVER by $' + Math.abs(remaining).toFixed(2) + 'M' : '$' + remaining.toFixed(2) + 'M left'}`));
    // Active overspend penalty (0.36.1): the cut was always applied to
    // this pool, but it was invisible — a halved allotment reads like an
    // ordinary small budget unless it's named.
    const prev = (state.intlLedger || {})[state.meta.userTeamId];
    if (prev && prev.penaltyMul) {
      const overPct = prev.pool > 0 ? Math.round(((prev.spent - prev.pool) / prev.pool) * 100) : 0;
      card.appendChild(U.el('p', { style: { 'font-size': '12px', color: 'var(--danger, #f85149)', 'font-weight': '600' } },
        `Overspend penalty active: last class ran ${overPct}% over pool — ` +
        `this class's allotment was ${prev.penaltyMul === 0.5 ? 'HALVED' : 'cut 15%'} by the league office.`));
    }
    if (b.restricted) {
      card.appendChild(U.el('p', { style: { 'font-size': '12px', color: 'var(--danger, #f85149)' } },
        'Signing restrictions in effect: nothing over $300K this window (overspend penalty).'));
    } else if (over) {
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px' } },
        'Going over the pool draws league penalties: fines, reduced future pools, and at 30%+ a two-year signing restriction.'));
    }
    // Targeted looks (0.23.0): the department's travel budget for closer
    // reads on unscouted names — spent from any "??" prospect's card.
    const looks = window.BBGM_SCOUT.targetedLooks(state, 'intl');
    card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '6px' } },
      `Targeted scouting trips: ${looks.remaining} of ${looks.budget} left this class — ` +
      `open an unscouted prospect to send a scout for a closer look.`));
    container.appendChild(card);
  }

  function renderIntl(container, state) {
    const intl = state.intl;
    if (!intl) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'The international class posts with the offseason. Check back after the season.'));
      return;
    }
    if (intl.phase === 'window') {
      renderIntlWindow(container, state);
      return;
    }
    if (intl.phase === 'complete') {
      renderIntlRecap(container, state);
      renderIntlHistory(container, state);
      return;
    }
    renderIntlBudgetCard(container, state);
    renderIntlPool(container, state);
    renderIntlHistory(container, state);
  }

  // The ranked pool list. In the window, unsigned prospects get sign/offer
  // actions via the modal; targets pin to the top.
  function renderIntlPool(container, state) {
    const intl = state.intl;
    const inWindow = intl.phase === 'window';
    // Signed prospects stay ON the board with their destination (0.32.0)
    // — they used to vanish, so there was no way to see where the class
    // went. Unsigned targets still pin to the top during the window.
    const signedBy = {};
    for (const s of intl.signings || []) signedBy[s.prospectId] = s;
    const ids = intl.board;
    const targets = new Set(intl.userTargets || []);
    const pinned = (id) => targets.has(id) && !signedBy[id];
    const ordered = inWindow
      ? ids.filter(pinned).concat(ids.filter((id) => !pinned(id)))
      : ids;

    const list = U.el('div', { class: 'roster-list' });
    let shown = 0;
    for (const id of ordered) {
      if (shown >= intlDepth) break;
      const p = intl.prospects[id];
      if (!p) continue;
      // Window steps gate which tiers are actionable; scouting shows all.
      shown++;
      list.appendChild(intlProspectRow(state, p, intl.board.indexOf(id) + 1, targets.has(id), signedBy[id]));
    }
    container.appendChild(list);
    if (shown >= intlDepth && ordered.length > intlDepth) {
      container.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { width: '100%', 'margin-top': '6px' },
        on: { click: () => { intlDepth += 35; window.BBGM_MAIN.refresh(); } },
      }, 'Show More'));
    }
  }

  function intlProspectRow(state, p, rank, isTarget, signedRec) {
    const row = U.el('button', {
      class: 'roster-row',
      style: signedRec ? { opacity: '0.65' } : {},
      on: { click: () => {
        // Once signed he's a real player — open the full card.
        if (signedRec && state.players[p.id]) window.BBGM_UI_PLAYER.show(p.id);
        else showIntlProspect(state, p.id);
      } },
    });
    row.appendChild(U.el('span', { class: 'pos-badge' }, String(rank)));
    const info = U.el('div', { class: 'player-row-info' });
    const med = window.BBGM_SCOUT.medicalRead(p);
    info.appendChild(U.el('div', { class: 'player-row-name' },
      `${isTarget ? '★ ' : ''}${med && med.flagged ? '⚕ ' : ''}${p.name}`));
    const signedTeam = signedRec
      ? state.league.teams.find((t) => t.id === signedRec.teamId) : null;
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      signedRec
        ? `${p.primaryPosition} • ${p.age} • signed: ${signedTeam ? signedTeam.abbr : '?'} $${signedRec.bonus}M` +
          (signedRec.teamId === state.meta.userTeamId ? ' (you)' : '')
        : `${p.primaryPosition} • ${p.age} • ${p.origin} • ask $${p.ask}M`));
    row.appendChild(info);
    const band = U.el('div', { class: 'player-row-stats' });
    const b = poolBand(state, p, rank, 'intl');
    if (b) {
      band.appendChild(U.el('div', { class: U.gradeClass((b[0] + b[1]) / 2), style: { 'font-weight': '700' } },
        `${b[0]}–${b[1]}`));
      band.appendChild(U.el('div', { class: 'player-row-meta' }, 'ceiling'));
    } else {
      band.appendChild(U.el('div', { class: 'muted', style: { 'font-weight': '700' } }, '—'));
      band.appendChild(U.el('div', { class: 'player-row-meta' }, 'no report'));
    }
    row.appendChild(band);
    return row;
  }

  function showIntlProspect(state, prospectId) {
    const intl = state.intl;
    const p = intl.prospects[prospectId];
    if (!p) return;
    const rank = intl.board.indexOf(p.id) + 1;
    const targets = intl.userTargets || (intl.userTargets = []);
    const isTarget = targets.includes(p.id);

    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `${p.primaryPosition} • Bats ${p.bats} / Throws ${p.throws} • Age ${p.age} • ${p.origin}` +
      ` • Rank #${rank} • Ask $${p.ask}M`));
    if (intl.phase === 'window' && intl.windowStep === 1 && (intl.userOffers || {})[p.id]) {
      body.appendChild(U.el('p', {
        style: { 'font-size': '12px', color: 'var(--accent, #58a6ff)', 'font-weight': '600', 'margin-bottom': '6px' },
      }, `Your standing offer: $${intl.userOffers[p.id]}M`));
    }
    body.appendChild(prospectBioLine(p));
    const medEl = medicalLine(p);
    if (medEl) body.appendChild(medEl);
    const toolPairs = p.isPitcher
      ? [['VEL', p.ratings.velocity], ['STF', p.ratings.stuff], ['MOV', p.ratings.movement], ['CTL', p.ratings.control]]
      : [['CON', (p.ratings.contactVsR + p.ratings.contactVsL) / 2],
         ['POW', (p.ratings.powerVsR + p.ratings.powerVsL) / 2],
         ['DIS', p.ratings.discipline], ['SPD', p.ratings.speed], ['DEF', p.ratings.defense]];
    const grid = U.el('div', { style: { display: 'flex', gap: '12px', 'flex-wrap': 'wrap', 'margin-bottom': '10px' } });
    for (const [label, v] of toolPairs) {
      const cell = U.el('div', { style: { 'text-align': 'center' } });
      cell.appendChild(U.el('div', { class: U.gradeClass(v), style: { 'font-weight': '700', 'font-size': '16px' } },
        String(U.gradeFor(v))));
      cell.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '10px' } }, label));
      grid.appendChild(cell);
    }
    if (toolsVisible(state, rank, 'intl', p.id)) body.appendChild(grid);
    else body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'Tool grades are thin at your scouting tier — this is where elite international scouting earns its keep.'));
    const SC = window.BBGM_SCOUT;
    const looks = SC.targetedLooks(state, 'intl');
    const looked = SC.hasTargetedLook(state, 'intl', p.id);
    const ib = poolBand(state, p, rank, 'intl');
    body.appendChild(U.el('p', { style: { 'font-size': '13px' } }, ib ? [
      'Projected ceiling: ',
      U.el('span', { class: U.gradeClass((ib[0] + ib[1]) / 2), style: { 'font-weight': '700' } },
        `${ib[0]}–${ib[1]}`),
      looked
        ? ' on his best tool — from your scout\'s targeted trip, one look rather than full coverage.'
        : ' on his best tool. Teenage international projection — the widest error bars in scouting.',
    ] : looks.remaining > 0
      ? 'Your scouts have nothing on him — but you could send one for a closer look.'
      : 'Sign him and hope — your scouts have nothing on him, and the travel budget for this class is spent.'));
    if (ib) appendScoutNotes(body, state, p, 'intl');

    const actions = [];
    // Targeted look (0.23.0): budget-limited trips reveal a report on an
    // unscouted name. Count and quality both scale with the scouting tier.
    if (!ib && looks.remaining > 0) {
      actions.push({
        label: `Send a Scout (${looks.remaining} trip${looks.remaining !== 1 ? 's' : ''} left)`,
        kind: 'primary',
        onClick: () => {
          if (!intl.userLooks) intl.userLooks = [];
          intl.userLooks.push(p.id);
          window.BBGM_STATE.set(state);
          U.showToast(`Scout dispatched — report on ${p.name} is in.`, 'success');
          window.BBGM_MAIN.refresh();
          setTimeout(() => showIntlProspect(state, p.id), 0);
          return true;
        },
      });
    }
    const refreshAll = () => {
      window.BBGM_STATE.set(state);
      window.BBGM_MAIN.refresh();
    };
    if (intl.phase === 'window') {
      if (intl.windowStep === 1 && rank <= 10) {
        // Offer ladder (0.32.0): explicit premium tiers with honest odds
        // labels — the old two-step (ask, then a hidden 1.3× raise) left
        // ask offers losing ~97% with no explanation. Rival clubs bid
        // 0.85-1.3× ask (a few chase to 1.35×), so the premium is what
        // wins bidding wars; overspending the pool still draws penalties.
        const cur = intl.userOffers[p.id];
        const amt = (mul) => Math.round(p.ask * mul * 100) / 100;
        const tiers = [
          [1.0, `Offer ask ($${amt(1)}M) — longshot`, 'secondary'],
          [1.15, `Offer +15% ($${amt(1.15)}M) — underdog`, 'secondary'],
          [1.3, `Offer +30% ($${amt(1.3)}M) — usually wins`, 'primary'],
          [1.5, `Blow him away ($${amt(1.5)}M)`, 'primary'],
        ];
        for (const [mul, label, kind] of tiers) {
          if (cur === amt(mul)) continue; // already standing at this number
          actions.push({
            label, kind,
            onClick: () => {
              intl.userOffers[p.id] = amt(mul);
              U.showToast(`Offer in: $${amt(mul)}M for ${p.name}.`, 'success');
              refreshAll();
              return true;
            },
          });
        }
        if (cur) {
          actions.push({ label: `Withdraw Offer ($${cur}M)`, kind: 'secondary', onClick: () => {
            delete intl.userOffers[p.id];
            refreshAll();
            return true;
          }});
        }
      } else if (intl.windowStep >= 2) {
        actions.push({
          label: `Sign for $${p.ask}M`, kind: 'primary',
          onClick: () => {
            const r = INTL().userSign(state, p.id);
            if (r.error) U.showToast(r.error, 'warning');
            else U.showToast(`Signed ${p.name} ($${r.signing.bonus}M).`, 'success');
            refreshAll();
            return true;
          },
        });
      }
    }
    actions.push({
      label: isTarget ? '★ Remove Target' : '☆ Flag as Target', kind: 'secondary',
      onClick: () => {
        if (isTarget) targets.splice(targets.indexOf(p.id), 1);
        else targets.push(p.id);
        refreshAll();
        return true;
      },
    });
    actions.push({ label: 'Close', kind: 'secondary', onClick: () => true });
    U.showModal({ title: p.name, body, actions });
  }

  // The signing window room: three phases, user acts first, then advances.
  // Owner reacts to an int'l overspend penalty in the inbox (0.37.0).
  function pushPenaltyMail(state, recap) {
    const pen = (recap.penalties || []).find((x) => x.teamId === state.meta.userTeamId);
    if (!pen || !window.BBGM_INBOX) return;
    const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    window.BBGM_INBOX.push(state, {
      from: `${ut.ownerName} (Owner)`,
      subject: 'About that international budget…',
      body: `You ran ${pen.overPct}% over the pool. The league office is ` +
            `${pen.overPct > 15 ? 'HALVING' : 'trimming'} next class's allotment` +
            (pen.restrictedYears ? `, and we're under signing restrictions for ${pen.restrictedYears} classes` : '') +
            `. I'll assume the kid is worth it.`,
    });
  }

  function renderIntlWindow(container, state) {
    const intl = state.intl;
    renderIntlBudgetCard(container, state);

    const step = intl.windowStep;
    const strip = U.el('div', { class: 'card' });
    const stepTitle = step === 1 ? 'Phase 1 — Top Prospects (ranks 1-10)'
      : step === 2 ? 'Phase 2 — Mid Tier (ranks 11-50)'
      : 'Phase 3 — Depth Signings (ranks 51-100)';
    strip.appendChild(U.el('div', { class: 'card-title' }, stepTitle));
    strip.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
      step === 1
        ? 'Place offers on the elite names — highest bonus wins when you resolve the tier. ' +
          'Rivals bid past the ask on kids they want, so an ask-only offer rarely survives; ' +
          'a premium usually gets your man, and overspending the pool draws penalties.'
        : step === 2
          ? 'Sign your targets at their ask before rival clubs work the same tier.'
          : 'Bulk depth: small bonuses on lottery tickets. Close the window when you\'re done — up to 25% of unspent pool carries over.'));
    const advLabel = step === 1 ? 'Resolve Top-Tier Signings ▶'
      : step === 2 ? 'Continue to Depth Phase ▶' : 'Close the Window';
    strip.appendChild(U.el('button', {
      class: 'btn-primary btn-sm', style: { width: '100%', 'margin-bottom': '6px' },
      on: { click: () => {
        const r = INTL().advanceWindow(state);
        if (r.done && r.recap) pushPenaltyMail(state, r.recap);
        window.BBGM_STATE.set(state);
        const mine = (r.results || []).filter((x) => x && x.teamId === state.meta.userTeamId);
        if (r.step === 1) {
          // Top-tier results in full (0.32.0): where every elite kid
          // landed, with honest outbid feedback on your losing offers.
          const body = U.el('div');
          for (const x of (r.results || []).sort((a, b) => a.rank - b.rank)) {
            const t = teamOf(state, x.teamId);
            const won = x.teamId === state.meta.userTeamId;
            const line = `#${x.rank} ${x.name} (${x.pos}) — ${t ? t.abbr : '?'}, $${x.bonus}M`;
            body.appendChild(U.el('p', {
              style: { 'font-size': '13px', margin: '4px 0',
                ...(won ? { color: 'var(--success, #3fb950)', 'font-weight': '600' } : {}) },
            }, won ? `${line} — YOURS`
              : x.userOffer ? `${line} — outbid (your $${x.userOffer}M)` : line));
          }
          if (!(r.results || []).length) {
            body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '13px' } },
              'No top-tier signings — the elite names slide to the mid-tier phase.'));
          }
          U.showModal({
            title: 'Top-Tier Signings',
            body,
            actions: [{ label: 'Continue', kind: 'primary', onClick: () => true }],
          });
        } else if (mine.length) {
          U.showToast(`Signed: ${mine.map((x) => x.name).join(', ')}!`, 'success', 5000);
        } else {
          U.showToast(`${(r.results || []).length} prospects signed league-wide.`, 'info');
        }
        window.BBGM_MAIN.refresh();
      }},
    }, advLabel));
    strip.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { width: '100%' },
      on: { click: () => {
        U.showModal({
          title: 'Auto-run the window?',
          body: 'Your front office works the rest of the window like an AI club — bids, mid-tier targets, and depth signings within your pool.',
          actions: [
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
            { label: 'Auto-run', kind: 'primary', onClick: () => {
              INTL().autoRunWindow(state);
              if (state.intl.recap) pushPenaltyMail(state, state.intl.recap);
              window.BBGM_STATE.set(state);
              setTimeout(() => window.BBGM_MAIN.refresh(), 0);
              return true;
            }},
          ],
        });
      }},
    }, 'Auto-Run Window'));
    container.appendChild(strip);

    // My signings so far.
    const mine = intl.signings.filter((s) => s.teamId === state.meta.userTeamId);
    if (mine.length) {
      const card = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      card.appendChild(U.el('div', { class: 'card-title' }, 'Your Signings'));
      for (const s of mine) {
        card.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `#${s.rank} ${s.name} — ${s.pos}, ${s.age}, ${s.country} ($${s.bonus}M)`));
      }
      container.appendChild(card);
    }

    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Available Prospects'),
    ]));
    renderIntlPool(container, state);
  }

  function renderIntlRecap(container, state) {
    const recap = state.intl.recap;
    if (!recap) return;
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, `${recap.year} Signing Window — Closed`));
    const myPen = (recap.penalties || []).find((x) => x.teamId === state.meta.userTeamId);
    card.appendChild(U.el('p', { style: { 'font-size': '13px' } },
      `${recap.signedCount} of 100 prospects signed league-wide. ` +
      `You spent $${recap.userSpent.toFixed(2)}M of your $${recap.userPool.toFixed(1)}M pool` +
      (myPen
        ? ` — OVER by ${myPen.overPct}%: next class's pool ${myPen.overPct > 15 ? 'HALVED' : 'cut 15%'}` +
          (myPen.restrictedYears ? ` + ${myPen.restrictedYears}-class signing restrictions` : '') + '.'
        : recap.userSpent > recap.userPool ? ' — over pool; league penalties apply.' : '.')));
    container.appendChild(card);

    if (recap.userSignings.length) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Your Class'),
      ]));
      const list = U.el('div', { class: 'roster-list' });
      for (const s of recap.userSignings) {
        const alive = state.players[s.prospectId];
        const row = U.el('button', {
          class: 'roster-row',
          on: { click: () => { if (alive) window.BBGM_UI_PLAYER.show(s.prospectId); } },
        });
        row.appendChild(U.el('span', { class: 'pos-badge' }, `#${s.rank}`));
        const info = U.el('div', { class: 'player-row-info' });
        info.appendChild(U.el('div', { class: 'player-row-name' }, `${s.name} — ${s.pos}`));
        info.appendChild(U.el('div', { class: 'player-row-meta' },
          `${s.age} • ${s.country} • $${s.bonus}M bonus`));
        row.appendChild(info);
        list.appendChild(row);
      }
      container.appendChild(list);
    }

    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Top of the Class'),
    ]));
    const card2 = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
    for (const s of recap.top5) {
      const t = teamOf(state, s.teamId);
      card2.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '3px 0' } },
        `#${s.rank} ${s.name} (${s.pos}, ${s.country}) — ${t ? t.abbr : '?'}, $${s.bonus}M`));
    }
    container.appendChild(card2);

    // Full destinations (0.32.0): every signing in rank order, plus the
    // kids who went unsigned — the whole class, accounted for.
    const signings = (state.intl.signings || []).slice().sort((a, b) => a.rank - b.rank);
    if (signings.length) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'Where the Class Landed'),
      ]));
      const list = U.el('div', { class: 'roster-list card', style: { padding: '0' } });
      let shown = 0;
      for (const s of signings) {
        if (shown >= recapDepth) break;
        shown++;
        const t = teamOf(state, s.teamId);
        const isUser = s.teamId === state.meta.userTeamId;
        const alive = state.players[s.prospectId];
        const row = U.el('button', {
          class: 'roster-row',
          style: isUser ? { border: '1px solid var(--accent, #58a6ff)' } : {},
          on: { click: () => { if (alive) window.BBGM_UI_PLAYER.show(s.prospectId); } },
        });
        row.appendChild(U.el('span', { class: 'pos-badge' }, `#${s.rank}`));
        const info = U.el('div', { class: 'player-row-info' });
        info.appendChild(U.el('div', { class: 'player-row-name' }, s.name));
        info.appendChild(U.el('div', { class: 'player-row-meta' },
          `${s.pos} • ${s.age} • ${s.country}${isUser ? ' • (you)' : ''}`));
        row.appendChild(info);
        const stats = U.el('div', { class: 'player-row-stats' });
        stats.appendChild(U.el('span', { style: { 'font-weight': '700' } }, t ? t.abbr : '?'));
        stats.appendChild(U.el('span', { class: 'key' }, `$${s.bonus}M`));
        row.appendChild(stats);
        list.appendChild(row);
      }
      container.appendChild(list);
      if (shown < signings.length) {
        container.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { width: '100%', 'margin-top': '6px' },
          on: { click: () => { recapDepth += 35; window.BBGM_MAIN.refresh(); } },
        }, 'Show More'));
      }
      const unsignedN = state.intl.board.length - signings.length;
      if (unsignedN > 0) {
        container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
          `${unsignedN} prospect${unsignedN === 1 ? '' : 's'} went unsigned — pool money ran dry league-wide.`));
      }
    }
  }

  function renderIntlHistory(container, state) {
    const hist = (state.intlHistory || []).slice().reverse();
    const skipYear = state.intl && state.intl.phase === 'complete' ? state.intl.year : null;
    const rows = hist.filter((h) => h.year !== skipYear);
    if (!rows.length) return;
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Signing History'),
    ]));
    const list = U.el('div', { class: 'roster-list' });
    for (const h of rows) {
      const top = h.signings.find((s) => s.rank === 1) || h.signings[0];
      const mine = h.signings.filter((s) => s.teamId === state.meta.userTeamId);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => showIntlHistoryYear(state, h) },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, String(h.year)));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        top ? `#1: ${top.name} (${top.pos}, ${top.country})` : '—'));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `You signed ${mine.length} prospect${mine.length !== 1 ? 's' : ''}`));
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  function showIntlHistoryYear(state, h) {
    const body = U.el('div');
    const section = (title, signings) => {
      if (!signings.length) return;
      body.appendChild(U.el('div', { style: { 'font-weight': '700', margin: '8px 0 4px' } }, title));
      for (const s of signings) {
        const t = state.league.teams.find((x) => x.id === s.teamId);
        const alive = state.players[s.prospectId];
        const line = U.el('p', { style: { 'font-size': '12px', margin: '3px 0' } });
        const text = `#${s.rank} ${s.name} (${s.pos}, ${s.country}) — ${t ? t.abbr : '?'}, $${s.bonus}M`;
        if (alive) {
          line.appendChild(U.el('a', {
            href: '#',
            on: { click: (e) => { e.preventDefault(); U.closeModal(); window.BBGM_UI_PLAYER.show(s.prospectId); } },
          }, text));
        } else {
          line.textContent = text;
        }
        body.appendChild(line);
      }
    };
    section('Top 10', h.signings.filter((s) => s.rank <= 10));
    section('Your Signings', h.signings.filter((s) => s.teamId === state.meta.userTeamId));
    U.showModal({
      title: `${h.year} International Class`,
      body,
      actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
    });
  }

  return { render };
})();

