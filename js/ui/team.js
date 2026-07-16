// Team view: roster, lineup, pitching, minors — the on-field side.
// Front-office screens (staff/trades/free agents) moved to the GM nav
// tab in 0.16.2.
// Phase 3: lineup/rotation/bullpen management and minors promotion are
// interactive. Every mutation runs through mutateTeam(), which snapshots the
// team, applies the change, re-validates readiness (BBGM_PLAYER_GEN
// .validateTeam), and reverts with a toast if the move would leave the team
// unable to field a legal game.
window.BBGM_UI_TEAM = (function () {
  const U = window.BBGM_UI;
  const S = window.BBGM_STATS;
  const GEN = () => window.BBGM_PLAYER_GEN;

  let activeTab = 'roster';

  // Diamond ordering for roster lists (0.25.2).
  const POS_SORT = { C: 0, '1B': 1, '2B': 2, '3B': 3, SS: 4, LF: 5, CF: 6, RF: 7, DH: 8, SP: 9, RP: 10, CP: 11 };

  function render(container, state, opts = {}) {
    if (opts && opts.tab) activeTab = opts.tab;
    // Front-office keys from pre-0.16.2 links (or a stale module state)
    // have no home here anymore — land on the roster.
    if (!['roster', 'lineup', 'pitching', 'minors'].includes(activeTab)) activeTab = 'roster';
    U.clearChildren(container);
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);

    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, team.name));

    // Tabs
    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'roster', label: 'Roster' },
      { key: 'lineup', label: 'Lineup' },
      { key: 'pitching', label: 'Pitching' },
      { key: 'minors', label: 'Minors' },
    ];
    for (const t of tabDefs) {
      const btn = U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } }
      }, t.label);
      tabs.appendChild(btn);
    }
    container.appendChild(tabs);

    if (activeTab === 'roster') renderRoster(container, state, team);
    else if (activeTab === 'lineup') renderLineup(container, state, team);
    else if (activeTab === 'pitching') renderPitching(container, state, team);
    else renderMinors(container, state, team);
  }

  // Pillar 4 byline: these screens show the manager's decisions.
  function managerByline(state, team) {
    const STAFF = window.BBGM_STAFF;
    const mgr = STAFF && STAFF.managerFor(state, team);
    return U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      mgr
        ? `Managed by ${mgr.name} (${mgr.archetypeName}). The manager sets the lineups, rotation, and bullpen — shape the roster and hire the right skipper (GM → Staff).`
        : 'No manager — the owner will hire one before Opening Day.');
  }

  // Inline rating chips for at-a-glance scanning on Lineup / Pitching rows.
  // `pairs` is an array of [label, value] tuples; each value is graded into
  // the 20-80 scale and colored by the existing grade-XX classes.
  function ratingStrip(pairs) {
    const row = U.el('div', {
      class: 'player-row-meta',
      style: { 'margin-top': '2px', display: 'flex', gap: '10px', 'flex-wrap': 'wrap' },
    });
    for (const [label, value] of pairs) {
      const chip = U.el('span');
      chip.appendChild(U.el('span', {
        style: { color: 'var(--text-muted)', 'font-size': '10px', 'margin-right': '3px', 'letter-spacing': '0.4px' },
      }, label));
      chip.appendChild(U.el('span', {
        class: U.gradeClass(value),
        style: { 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' },
      }, String(U.gradeFor(value))));
      row.appendChild(chip);
    }
    return row;
  }

  // ------- Mutation helpers -------

  function commit(state) {
    window.BBGM_STATE.set(state);
    window.BBGM_MAIN.refresh();
  }

  // Snapshot → mutate → validate → commit, reverting on failure. The
  // mutation callback receives a `statuses` object it can use to record
  // player status fields it changes, so they're restored on revert.
  function mutateTeam(state, team, fn) {
    const snap = {
      roster: team.roster.slice(),
      minors: team.minors.slice(),
      rotation: team.rotation.slice(),
      bullpen: team.bullpen.slice(),
      closer: team.closer,
      bullpenRoles: JSON.parse(JSON.stringify(team.bullpenRoles || {})),
      lineupRH: JSON.parse(JSON.stringify(team.lineupRH)),
      lineupLH: JSON.parse(JSON.stringify(team.lineupLH)),
    };
    const statuses = {};
    try {
      fn(statuses);
      GEN().validateTeam(team, state.players);
      commit(state);
      return true;
    } catch (e) {
      Object.assign(team, snap);
      for (const pid in statuses) {
        const p = state.players[pid];
        if (p) {
          p.rosterStatus = statuses[pid].rosterStatus;
          p.status = statuses[pid].status;
        }
      }
      U.showToast('Move rejected: ' + e.message, 'danger', 5000);
      return false;
    }
  }

  // Small picker modal: list of player rows; tap one to choose.
  function pickerModal(state, title, players, describe, onPick) {
    const body = U.el('div', { class: 'roster-list' });
    if (!players.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, 'No eligible players.'));
    }
    for (const p of players) {
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => { U.closeModal(); onPick(p); } },
      });
      row.appendChild(U.posBadge(p));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
      info.appendChild(U.el('div', { class: 'player-row-meta' }, describe(p)));
      row.appendChild(info);
      body.appendChild(row);
    }
    U.showModal({
      title, body,
      actions: [{ label: 'Cancel', kind: 'secondary', onClick: () => true }],
    });
  }


  // ------- Roster tab -------

  function renderRoster(container, state, team) {
    const players = state.players;
    const roster = team.roster.map((id) => players[id]).filter(Boolean);

    // Filter chips
    const chips = U.el('div', { class: 'filter-bar' });
    let filter = window.__bbgmRosterFilter || 'all';
    const chipDefs = [
      { key: 'all', label: 'All' },
      { key: 'pitchers', label: 'Pitchers' },
      { key: 'hitters', label: 'Hitters' },
      { key: 'starters', label: 'Starters' },
      { key: 'bullpen', label: 'Bullpen' },
    ];
    for (const c of chipDefs) {
      const chip = U.el('button', {
        class: `filter-chip${filter === c.key ? ' active' : ''}`,
        on: { click: () => {
          window.__bbgmRosterFilter = c.key;
          render(document.getElementById('mainView'), state);
        }},
      }, c.label);
      chips.appendChild(chip);
    }
    container.appendChild(chips);

    let players_filtered;
    if (filter === 'pitchers') players_filtered = roster.filter((p) => p.isPitcher);
    else if (filter === 'hitters') players_filtered = roster.filter((p) => !p.isPitcher);
    else if (filter === 'starters') players_filtered = roster.filter((p) => p.primaryPosition === 'SP');
    else if (filter === 'bullpen') players_filtered = roster.filter((p) => p.primaryPosition === 'RP' || p.primaryPosition === 'CP');
    else players_filtered = roster.slice();

    // Sort: position order around the diamond (0.25.2) — C through DH,
    // then the staff SP/RP/CP; best overall first within a position.
    players_filtered.sort((a, b) => {
      const pa = POS_SORT[a.primaryPosition] != null ? POS_SORT[a.primaryPosition] : 12;
      const pb = POS_SORT[b.primaryPosition] != null ? POS_SORT[b.primaryPosition] : 12;
      if (pa !== pb) return pa - pb;
      const oa = a.isPitcher ? overallPitcher(a) : overallHitter(a);
      const ob = b.isPitcher ? overallPitcher(b) : overallHitter(b);
      return ob - oa;
    });

    const list = U.el('div', { class: 'roster-list' });
    const year = state.meta.currentDate.year;
    for (const p of players_filtered) {
      list.appendChild(playerRow(p, state, year));
    }
    container.appendChild(list);

    // Injured list (bible 11.5): players on IL are off the 26-man; their
    // call-up cover holds the spot until activation.
    const ilPlayers = (team.il || []).map((id) => players[id]).filter(Boolean);
    if (ilPlayers.length) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } },
        `Injured List (${ilPlayers.length})`));
      const ilList = U.el('div', { class: 'roster-list' });
      for (const p of ilPlayers) {
        const row = U.el('button', {
          class: 'roster-row', style: { opacity: '0.75' },
          on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
        });
        row.appendChild(U.posBadge(p));
        const info = U.el('div', { class: 'player-row-info' });
        info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
        const inj = p.currentInjury;
        const days = p.ilStatus ? p.ilStatus.daysRemaining : 0;
        info.appendChild(U.el('div', { class: 'player-row-meta' },
          inj ? `${inj.ilType || ''} IL • ${inj.type} • ~${days} day${days !== 1 ? 's' : ''} left` : 'IL'));
        row.appendChild(info);
        ilList.appendChild(row);
      }
      container.appendChild(ilList);
    }

    // Short roster (release, or an unresolved IL call-up): offer a direct
    // fill-up — the Minors tab's promote is swap-based and needs 26.
    if (roster.length < 26) {
      container.appendChild(U.el('button', {
        class: 'btn-primary', style: { width: '100%', 'margin-top': '12px' },
        on: { click: () => showCallUpFill(state, team) },
      }, `Call Up a Player (${roster.length}/26)`));
    }

    // Roster summary
    const card = U.el('div', { class: 'card', style: { 'margin-top': '16px' } });
    card.appendChild(U.el('div', { class: 'card-title' }, 'Roster Summary'));
    const ul = U.el('div', { class: 'inset-list', style: { 'border': 'none' } });
    const pCount = roster.filter((p) => p.isPitcher).length;
    const hCount = roster.filter((p) => !p.isPitcher).length;
    ul.appendChild(insetRow('26-Man Roster', `${roster.length} / 26`));
    ul.appendChild(insetRow('Pitchers', `${pCount}`));
    ul.appendChild(insetRow('Position Players', `${hCount}`));
    ul.appendChild(insetRow('Payroll',
      `$${window.BBGM_FA.computePayroll(team, players).toFixed(1)}M / $${team.payrollBase}M`));
    ul.appendChild(insetRow('Owner', team.ownerName));
    ul.appendChild(insetRow('Ballpark', team.ballpark.name));
    card.appendChild(ul);
    container.appendChild(card);
  }

  // ------- Roster actions: release / waive (0.21.0) -------

  function showRosterActions(state, team, p) {
    U.showModal({
      title: `${p.name} (${p.primaryPosition})`,
      body: U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        `Age ${p.age} • $${(p.contract && p.contract.annualSalary || 0).toFixed(1)}M × ` +
        `${(p.contract && p.contract.years) || 0}y • ${p.serviceTime ? p.serviceTime.years : 0} yrs service`),
      actions: [
        { label: 'View Profile', kind: 'primary', onClick: () => {
          setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
          return true;
        }},
        { label: 'Release / Waive…', kind: 'danger', onClick: () => {
          setTimeout(() => confirmRelease(state, team, p, false), 0);
          return true;
        }},
        { label: 'Cancel', kind: 'secondary', onClick: () => true },
      ],
    });
  }

  // Pre-check mirrors the trade validator's post-move legality rules so a
  // release can never be half-applied and reverted (releaseToPool mutates
  // the player and the FA pool, which mutateTeam's snapshot can't undo).
  function releaseBlocker(state, team, p) {
    const players = state.players;
    const rest = team.roster.map((id) => players[id]).filter((q) => q && q.id !== p.id);
    const c = rest.filter((q) => !q.isPitcher && q.primaryPosition === 'C').length;
    const sp = rest.filter((q) => q.isPitcher && q.primaryPosition === 'SP').length;
    const pitchers = rest.filter((q) => q.isPitcher).length;
    const hitters = rest.length - pitchers;
    if (!p.isPitcher && p.primaryPosition === 'C' && c < 2) return 'that would leave you without two catchers';
    if (p.isPitcher && p.primaryPosition === 'SP' && sp < 5) return 'that would leave you without five starters';
    if (p.isPitcher && pitchers < 11) return 'that would leave the staff too thin';
    if (!p.isPitcher && hitters < 11) return 'that would leave too few position players';
    const org = rest.concat((team.minors || []).map((id) => players[id]).filter(Boolean));
    for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
      if (!org.some((q) => !q.isPitcher && GEN().canPlay(q, pos))) {
        return `nobody left in the organization can play ${pos}`;
      }
    }
    return null;
  }

  // fromMinors: releasing a farmhand needs no legality math beyond the
  // org position coverage; a 26-man release also cleans team configs.
  function confirmRelease(state, team, p, fromMinors) {
    if (!fromMinors) {
      const blocker = releaseBlocker(state, team, p);
      if (blocker) {
        U.showToast(`Can't release ${p.name} — ${blocker}.`, 'warning', 5000);
        return;
      }
    }
    const sal = (p.contract && p.contract.annualSalary) || 0;
    // In-season 26-man releases pass through the waiver wire (0.22.0):
    // rival clubs get 2 days to claim him and his contract, worst record
    // first. Farm releases and offseason cuts skip the wire.
    const viaWaivers = !fromMinors && !state.meta.offseasonPhase && window.BBGM_WAIVERS;
    U.showModal({
      title: viaWaivers ? `Waive ${p.name}?` : `Release ${p.name}?`,
      body: (viaWaivers
        ? `He goes on waivers for 2 days — any club can claim him AND his contract ` +
          `(worst record first). Unclaimed, he becomes a free agent` +
          (sal >= 1 ? ` and you eat the $${sal.toFixed(1)}M on his deal` : '')
        : `He becomes a free agent, eligible to sign anywhere` +
          (sal >= 1 ? ` — and you eat the $${sal.toFixed(1)}M on his deal this season` : '')) +
        `. This can't be undone.`,
      actions: [
        { label: 'Cancel', kind: 'secondary', onClick: () => true },
        { label: viaWaivers ? 'Waive Him' : 'Release Him', kind: 'danger', onClick: () => {
          if (!state.news) state.news = [];
          if (viaWaivers) {
            window.BBGM_WAIVERS.place(state, team, p);
            state.news.push({
              date: { ...state.meta.currentDate },
              body: `The <strong>${team.abbr}</strong> designate <strong>${p.name}</strong> ` +
                    `(${p.primaryPosition}) for assignment — on waivers for 2 days.`,
            });
            U.showToast(`${p.name} placed on waivers.`, 'info');
          } else {
            window.BBGM_FA.releaseToPool(state, p, 'released');
            state.news.push({
              date: { ...state.meta.currentDate },
              body: `The <strong>${team.abbr}</strong> release <strong>${p.name}</strong> (${p.primaryPosition}).`,
            });
            U.showToast(`${p.name} released.`, 'info');
          }
          window.BBGM_STATE.set(state);
          render(document.getElementById('mainView'), state);
          return true;
        }},
      ],
    });
  }

  // Fill an open 26-man spot straight from the farm (no swap needed).
  function showCallUpFill(state, team) {
    const players = state.players;
    const inj = window.BBGM_INJURIES;
    const cands = (team.minors || [])
      .map((id) => players[id])
      .filter((p) => p && inj.isAvailable(p))
      .sort((a, b) => (b.isPitcher ? overallPitcher(b) : overallHitter(b)) -
                      (a.isPitcher ? overallPitcher(a) : overallHitter(a)))
      .slice(0, 14);
    pickerModal(state, 'Call up to the 26-man', cands,
      (p) => `${p.primaryPosition} • ${p.rosterStatus} • Age ${p.age} • OVR ${U.gradeFor(p.isPitcher ? overallPitcher(p) : overallHitter(p))}`,
      (p) => {
        mutateTeam(state, team, (statuses) => {
          statuses[p.id] = { rosterStatus: p.rosterStatus, status: p.status };
          team.minors.splice(team.minors.indexOf(p.id), 1);
          team.roster.push(p.id);
          p.status = 'active';
          p.rosterStatus = '26-man';
          // The manager works the new man into his configs (Pillar 4).
          window.BBGM_ROSTER.safeRebuild(state, team);
        });
        U.showToast(`${p.name} called up.`, 'success');
        render(document.getElementById('mainView'), state);
      });
  }

  // ------- Lineup tab (editable) -------

  function renderLineup(container, state, team) {
    container.appendChild(managerByline(state, team));

    for (const [key, label] of [['lineupRH', 'Lineup vs. RHP'], ['lineupLH', 'Lineup vs. LHP']]) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, label));
      const list = U.el('div', { class: 'roster-list' });
      team[key].forEach((spot, idx) => {
        list.appendChild(lineupRow(state, team, key, idx));
      });
      // Western League: pitchers bat 9th (bible 3.1). Shown as a fixed,
      // non-editable slot — the day's starter (then relievers) occupies it.
      if (team.league !== 'east') {
        list.appendChild(pitcherSpotRow(team[key].length + 1));
      }
      container.appendChild(list);
    }
  }

  function pitcherSpotRow(orderNum) {
    const row = U.el('div', { class: 'roster-row', style: { opacity: '0.7' } });
    row.appendChild(U.el('span', { class: 'pos-badge', style: { 'background': 'var(--bg-elevated)' } }, String(orderNum)));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, 'Pitcher’s spot'));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      'P • Western League rules — the pitcher on the mound bats here'));
    row.appendChild(info);
    return row;
  }

  function lineupRow(state, team, key, idx) {
    const spot = team[key][idx];
    const p = state.players[spot.playerId];
    if (!p) return U.el('div');
    const year = state.meta.currentDate.year;
    const s = p.stats[year];

    const row = U.el('div', { class: 'roster-row' });
    row.appendChild(U.el('span', { class: 'pos-badge', style: { 'background': 'var(--bg-elevated)' } }, String(idx + 1)));

    const info = U.el('button', {
      class: 'player-row-info',
      style: { 'text-align': 'left', background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
    });
    const onIL = (team.il || []).includes(p.id);
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name + (onIL ? '  🏥' : '')));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `${spot.position} • Age ${p.age}` + (s ? ` • ${S.fmtAvg(S.avg(s))}/${S.fmtAvg(S.obp(s))}/${S.fmtAvg(S.slg(s))}` : '')));
    // Quick-scan ratings: overall hitter score plus L/R-averaged contact and
    // power so you can compare bats without opening each card.
    const contact = (p.ratings.contactVsR + p.ratings.contactVsL) / 2;
    const power = (p.ratings.powerVsR + p.ratings.powerVsL) / 2;
    info.appendChild(ratingStrip([
      ['OVR', overallHitter(p)],
      ['CON', contact],
      ['POW', power],
      ['SPD', p.ratings.speed],
    ]));
    row.appendChild(info);
    return row;
  }




  // ------- Pitching tab (editable) -------

  function renderPitching(container, state, team) {
    const players = state.players;
    if (!team.bullpenRoles) {
      team.bullpenRoles = GEN().assignBullpenRoles(team, players);
    }

    container.appendChild(managerByline(state, team));

    container.appendChild(U.el('div', { class: 'card-title' }, 'Starting Rotation'));
    const list = U.el('div', { class: 'roster-list' });
    team.rotation.forEach((id, idx) => {
      const p = players[id];
      if (!p) return;
      list.appendChild(rotationRow(state, team, p, idx));
    });
    container.appendChild(list);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Closer'));
    const closerList = U.el('div', { class: 'roster-list' });
    if (team.closer) {
      const cp = players[team.closer];
      closerList.appendChild(bullpenRow(state, team, cp, 'CL'));
    }
    container.appendChild(closerList);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Bullpen'));
    const bp = U.el('div', { class: 'roster-list' });
    const roleOf = (pid) => {
      const roles = team.bullpenRoles || {};
      for (const r of ['setup', 'middle', 'long', 'mopup']) {
        if ((roles[r] || []).includes(pid)) return r;
      }
      return 'middle';
    };
    const roleLabel = { setup: 'SU', middle: 'MID', long: 'LG', mopup: 'MOP' };
    team.bullpen.forEach((id) => {
      const p = players[id];
      if (!p) return;
      bp.appendChild(bullpenRow(state, team, p, roleLabel[roleOf(id)]));
    });
    container.appendChild(bp);
  }

  function rotationRow(state, team, p, idx) {
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showPitcherActions(state, team, p) },
    });
    row.appendChild(U.el('span', { class: 'pos-badge pos-pitcher' }, `SP${idx + 1}`));

    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    const desc = s && s.gs
      ? `${s.w || 0}-${s.l || 0} • ${S.era(s).toFixed(2)} ERA • ${S.fmtIP(s.ipOuts || 0)} IP`
      : `Age ${p.age}`;
    info.appendChild(U.el('div', { class: 'player-row-meta' }, desc));
    info.appendChild(ratingStrip([
      ['OVR', overallPitcher(p)],
      ['VEL', p.ratings.velocity],
      ['CTL', p.ratings.control],
      ['STA', p.ratings.stamina],
    ]));
    row.appendChild(info);
    return row;
  }




  function bullpenRow(state, team, p, badge) {
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showPitcherActions(state, team, p) },
    });
    row.appendChild(U.el('span', { class: 'pos-badge pos-pitcher' }, badge));

    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    const desc = s && s.g
      ? `${s.g} G • ${S.era(s).toFixed(2)} ERA • ${s.sv || 0} SV ${s.hld || 0} HLD`
      : `Age ${p.age}`;
    info.appendChild(U.el('div', { class: 'player-row-meta' }, desc));
    info.appendChild(ratingStrip([
      ['OVR', overallPitcher(p)],
      ['STU', p.ratings.stuff],
      ['VEL', p.ratings.velocity],
      ['CTL', p.ratings.control],
    ]));
    row.appendChild(info);
    return row;
  }




  // ------- Pitcher role management (0.20.0) -------
  // The GM shapes the STAFF — who closes, who starts, who relieves; the
  // manager still sorts the rotation order and pen roles around those
  // decisions (Pillar 4). Rules: moving to the rotation takes a 55+
  // stamina arm (a one-inning frame can't hold a starter's workload);
  // anyone can move to the pen, but never below five starters on the 26.
  const SP_STAMINA_MIN = 55;

  function showPitcherActions(state, team, p) {
    const isCloser = team.closer === p.id;
    const inRotation = (team.rotation || []).includes(p.id);
    const actions = [];

    // Closer candidates are relief-role arms. A swingman still listed as
    // an SP converts to reliever first — otherwise next spring's rebuild
    // would try to hand the same arm the rotation AND the ninth.
    if (!isCloser && !inRotation && p.primaryPosition !== 'SP') {
      actions.push({ label: 'Name Closer', kind: 'primary', onClick: () => {
        nameCloser(state, team, p);
        return true;
      }});
    }
    if (p.primaryPosition === 'SP') {
      actions.push({ label: 'Convert to Reliever', kind: 'secondary', onClick: () => {
        convertPitcherRole(state, team, p, 'RP');
        return true;
      }});
    } else {
      actions.push({ label: 'Convert to Starter', kind: 'secondary', onClick: () => {
        convertPitcherRole(state, team, p, 'SP');
        return true;
      }});
    }
    actions.push({ label: 'View Profile', kind: 'secondary', onClick: () => {
      setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
      return true;
    }});
    actions.push({ label: 'Cancel', kind: 'secondary', onClick: () => true });

    const staNote = p.primaryPosition === 'SP'
      ? 'Converting to the pen lets him air it out in one-inning bursts.'
      : p.ratings.stamina >= SP_STAMINA_MIN
        ? `Stamina ${Math.round(p.ratings.stamina)} — he can be stretched out to start.`
        : `Stamina ${Math.round(p.ratings.stamina)} — below the ${SP_STAMINA_MIN} a starter's workload demands.`;
    U.showModal({
      title: `${p.name} (${p.primaryPosition}${isCloser ? ', closer' : ''})`,
      body: U.el('p', { class: 'muted', style: { 'font-size': '12px' } }, staNote),
      actions,
    });
  }

  // Closer is a role, not a position (0.20.0): your best reliever gets the
  // ninth. Naming one converts him to CP so spring rebuilds keep the job
  // with him; the man he replaces returns to the pen as an RP.
  function nameCloser(state, team, p) {
    const players = state.players;
    const old = team.closer ? players[team.closer] : null;
    const prevP = p.primaryPosition;
    const prevOld = old ? old.primaryPosition : null;
    const ok = mutateTeam(state, team, () => {
      if (old && old.id !== p.id) {
        if (old.primaryPosition === 'CP') old.primaryPosition = 'RP';
        if (!team.bullpen.includes(old.id)) team.bullpen.push(old.id);
      }
      if (p.primaryPosition === 'RP') p.primaryPosition = 'CP';
      team.bullpen = team.bullpen.filter((id) => id !== p.id);
      team.closer = p.id;
      team.bullpenRoles = GEN().assignBullpenRoles(team, players);
    });
    if (!ok) {
      p.primaryPosition = prevP;
      if (old && prevOld) old.primaryPosition = prevOld;
      return;
    }
    U.showToast(`${p.name} is your new closer.`, 'success');
    render(document.getElementById('mainView'), state);
  }

  // Shared by the MLB pitching tab and the minors action sheet. `team` is
  // null for a minors arm — no config rebuild needed down there.
  function convertPitcherRole(state, team, p, toPos) {
    if (toPos === 'SP' && p.ratings.stamina < SP_STAMINA_MIN) {
      U.showToast(`${p.name} can't hold a starter's workload (stamina ${Math.round(p.ratings.stamina)}, needs ${SP_STAMINA_MIN}+).`, 'warning', 4500);
      return;
    }
    if (team && toPos !== 'SP' && p.primaryPosition === 'SP') {
      const spCount = team.roster.map((id) => state.players[id])
        .filter((q) => q && q.isPitcher && q.primaryPosition === 'SP').length;
      if (spCount <= 5) {
        U.showToast('That would leave the club under five starters — add another SP first.', 'warning', 4500);
        return;
      }
    }
    const prev = p.primaryPosition;
    p.primaryPosition = toPos;
    if (team) {
      const ok = mutateTeam(state, team, () => {
        // The manager re-sorts his staff around the new role (Pillar 4) —
        // a converted starter competes for a rotation spot, he isn't
        // handed one.
        window.BBGM_ROSTER.safeRebuild(state, team);
      });
      if (!ok) { p.primaryPosition = prev; return; }
    } else {
      window.BBGM_STATE.set(state);
    }
    U.showToast(toPos === 'SP'
      ? `${p.name} will be stretched out as a starter.`
      : `${p.name} moves to the bullpen.`, 'success');
    render(document.getElementById('mainView'), state);
  }

  // ------- Minors tab (promotion) -------

  function renderMinors(container, state, team) {
    const players = state.players;
    container.appendChild(U.el('p', {
      class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' },
    }, 'Tap a player to promote him to the 26-man or move him between levels. ' +
       '▲ = scouts say he\'s ready for a higher level; ▼ = overmatched, send him ' +
       'down. Development stalls at the wrong level (worse the further off).'));
    const minors = team.minors.map((id) => players[id]).filter(Boolean);
    const byLevel = { AAA: [], AA: [], A: [], Rookie: [] };
    for (const p of minors) {
      if (byLevel[p.rosterStatus]) byLevel[p.rosterStatus].push(p);
    }
    for (const lvl of ['AAA', 'AA', 'A', 'Rookie']) {
      if (byLevel[lvl].length === 0) continue;
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, `${lvl} (${byLevel[lvl].length})`));
      const list = U.el('div', { class: 'roster-list' });
      byLevel[lvl].sort((a, b) => overallProspect(b) - overallProspect(a));
      for (const p of byLevel[lvl]) list.appendChild(prospectRow(p, state, team));
      container.appendChild(list);
    }
  }

  function prospectRow(p, state, team) {
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showMinorsActions(state, team, p) }
    });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    // Scout level-fit arrow (12.4): ▲ recommend promotion, ▼ recommend
    // demotion, nothing at the proper level.
    const fit = window.BBGM_MINORS.levelFitDelta(p);
    const nameEl = U.el('div', { class: 'player-row-name' });
    if (fit > 0) {
      nameEl.appendChild(U.el('span', {
        style: { color: 'var(--success, #3fb950)', 'margin-right': '4px', 'font-weight': '700' },
      }, '▲'));
    } else if (fit < 0) {
      nameEl.appendChild(U.el('span', {
        style: { color: 'var(--danger, #f85149)', 'margin-right': '4px', 'font-weight': '700' },
      }, '▼'));
    }
    nameEl.appendChild(document.createTextNode(p.name));
    info.appendChild(nameEl);
    let meta = `Age ${p.age} • ${p.bats}/${p.throws}`;
    // Most recent minor-league season line (stamped at each rollover).
    const years = Object.keys(p.stats || {}).sort().reverse();
    for (const y of years) {
      const ml = p.stats[y] && p.stats[y].minorsLine;
      if (!ml) continue;
      if (p.isPitcher) {
        const era = ml.ipOuts > 0 ? (ml.er * 27 / ml.ipOuts).toFixed(2) : '—';
        meta += ` • ${y} ${ml.level}: ${era} ERA, ${ml.k} K`;
      } else {
        const avg = ml.ab > 0 ? S.fmtAvg(ml.h / ml.ab) : '—';
        meta += ` • ${y} ${ml.level}: ${avg}, ${ml.hr} HR`;
      }
      break;
    }
    info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
    // Key tools inline (0.25.2) — exact-mode only (your own farm); banded
    // rival views keep the OVR band alone.
    if (window.BBGM_SCOUT.modeFor(state, p) === 'exact') {
      const r = p.ratings;
      info.appendChild(p.isPitcher
        ? ratingStrip([['VEL', r.velocity], ['STF', r.stuff], ['CTL', r.control], ['STA', r.stamina]])
        : ratingStrip([['CON', (r.contactVsR + r.contactVsL) / 2],
            ['POW', (r.powerVsR + r.powerVsL) / 2], ['SPD', r.speed], ['DEF', r.defense || 50]]));
    }
    row.appendChild(info);
    const stats = U.el('div', { class: 'player-row-stats' });
    // Your own farm reads exact (0.16.3) — the report only bands players
    // outside the organization (this row also serves rival-farm views).
    const rep = window.BBGM_SCOUT.report(state, p);
    const band = rep.ovrBand();
    if (rep.mode === 'min') {
      stats.appendChild(U.el('span', { class: 'muted' }, '??'));
      stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    } else if (band) {
      const mid = (band[0] + band[1]) / 2;
      stats.appendChild(U.el('span', { class: U.gradeClass(mid), style: { 'font-size': '12px' } },
        `${band[0]}–${band[1]}`));
      stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    } else {
      const overall = Math.round(p.isPitcher ? overallPitcher(p) : overallHitter(p));
      stats.appendChild(U.el('span', { class: U.gradeClass(overall) }, String(U.gradeFor(overall))));
      stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    }
    row.appendChild(stats);
    return row;
  }

  function showMinorsActions(state, team, p) {
    const MIN = window.BBGM_MINORS;
    const fit = MIN.levelFitDelta(p);
    const rec = MIN.recommendedLevel(p);
    let note = fit > 0
      ? `Scouts: he's outgrown ${p.rosterStatus} — ready for ${rec}. Leaving him down stunts his development.`
      : fit < 0
        ? `Scouts: overmatched at ${p.rosterStatus} — belongs at ${rec}. Rushing him stunts his development.`
        : `Scouts: ${p.rosterStatus} is the right level for him.`;
    if (p.devPosition) note += ` Working out at ${p.devPosition} on the side.`;
    const actions = [
      { label: 'Promote to 26-man (swap)…', kind: 'primary', onClick: () => {
        setTimeout(() => showPromoteSwap(state, team, p), 0);
        return true;
      }},
      { label: 'Move Level…', kind: 'secondary', onClick: () => {
        setTimeout(() => showLevelMove(state, team, p), 0);
        return true;
      }},
    ];
    // Role development (0.20.0): pitchers can change roles down here too
    // (same stamina rule); hitters can be assigned position work — the
    // farm is where conversions actually happen.
    if (p.isPitcher) {
      const toPos = p.primaryPosition === 'SP' ? 'RP' : 'SP';
      actions.push({
        label: toPos === 'SP' ? 'Convert to Starter' : 'Convert to Reliever',
        kind: 'secondary',
        onClick: () => { convertPitcherRole(state, null, p, toPos); return true; },
      });
    } else {
      actions.push({ label: p.devPosition ? `Position work: ${p.devPosition}…` : 'Position work…',
        kind: 'secondary',
        onClick: () => { setTimeout(() => showPositionWork(state, p), 0); return true; },
      });
    }
    actions.push({ label: 'View Profile', kind: 'secondary', onClick: () => {
      setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
      return true;
    }});
    actions.push({ label: 'Release…', kind: 'danger', onClick: () => {
      setTimeout(() => confirmRelease(state, team, p, true), 0);
      return true;
    }});
    actions.push({ label: 'Cancel', kind: 'secondary', onClick: () => true });
    U.showModal({
      title: `${p.name} (${p.rosterStatus})`,
      body: U.el('p', { class: 'muted', style: { 'font-size': '12px' } }, note),
      actions,
    });
  }

  // Position work (0.20.0 — utility men): assign a minor-league hitter a
  // second position to develop. Each offseason of work (plus any real
  // games there) grows his aptitude: playable at 50, learned — listed as
  // a true secondary position — at 60. Catcher can't be picked up as a
  // side project; that's a trade learned young or never.
  function showPositionWork(state, p) {
    const A = GEN().aptitudeFor;
    const body = U.el('div', { class: 'roster-list' });
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      'Pick a position for the development staff to work him at. Aptitude grows each ' +
      'season: 50 = playable in a pinch, 60 = a listed secondary position.'));
    const opts = ['1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']
      .filter((pos) => pos !== p.primaryPosition && !(p.secondaryPositions || []).includes(pos));
    for (const pos of opts) {
      const apt = Math.round(A(p, pos));
      const isCur = p.devPosition === pos;
      const row = U.el('button', {
        class: 'roster-row',
        style: isCur ? { outline: '2px solid var(--accent)' } : {},
        on: { click: () => {
          U.closeModal();
          p.devPosition = pos;
          window.BBGM_STATE.set(state);
          U.showToast(`${p.name} starts working out at ${pos}.`, 'success');
          render(document.getElementById('mainView'), state);
        }},
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, pos));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, (isCur ? '✓ ' : '') +
        (apt >= 60 ? 'Learned' : apt >= 50 ? 'Playable' : 'Raw')));
      row.appendChild(info);
      const stats = U.el('div', { class: 'player-row-stats' });
      stats.appendChild(U.el('span', { class: U.gradeClass(apt) }, String(apt)));
      stats.appendChild(U.el('span', { class: 'key' }, 'APT'));
      row.appendChild(stats);
      body.appendChild(row);
    }
    const actions = [];
    if (p.devPosition) {
      actions.push({ label: 'Stop Position Work', kind: 'secondary', onClick: () => {
        delete p.devPosition;
        window.BBGM_STATE.set(state);
        U.showToast(`${p.name} goes back to full-time ${p.primaryPosition}.`, 'info');
        render(document.getElementById('mainView'), state);
        return true;
      }});
    }
    actions.push({ label: 'Cancel', kind: 'secondary', onClick: () => true });
    U.showModal({ title: `Position work — ${p.name}`, body, actions });
  }

  // Assign a minor leaguer to any level (12.4). Free to do — the cost is
  // baked into development: the further from the scouts' recommended
  // level a prospect plays, the more his growth year is wasted.
  function showLevelMove(state, team, p) {
    const MIN = window.BBGM_MINORS;
    const rec = MIN.recommendedLevel(p);
    const body = U.el('div', { class: 'roster-list' });
    for (const lvl of ['AAA', 'AA', 'A', 'Rookie']) {
      const isCurrent = p.rosterStatus === lvl;
      const rowAttrs = {
        class: 'roster-row',
        style: isCurrent ? { opacity: '0.5' } : {},
        on: { click: () => {
          if (isCurrent) return;
          U.closeModal();
          p.rosterStatus = lvl;
          window.BBGM_STATE.set(state);
          U.showToast(`${p.name} assigned to ${lvl}.`, 'success');
          render(document.getElementById('mainView'), state);
        }},
      };
      if (isCurrent) rowAttrs.disabled = 'disabled';
      const row = U.el('button', rowAttrs);
      row.appendChild(U.el('span', { class: 'pos-badge' }, lvl));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        (isCurrent ? 'Current level' : lvl === rec ? 'Scouts recommend' : ' ')));
      row.appendChild(info);
      if (lvl === rec && !isCurrent) {
        row.appendChild(U.el('div', {
          class: 'player-row-stats',
          style: { color: 'var(--success, #3fb950)', 'font-weight': '700' },
        }, '★'));
      }
      body.appendChild(row);
    }
    U.showModal({
      title: `Assign ${p.name}`,
      body,
      actions: [{ label: 'Cancel', kind: 'secondary', onClick: () => true }],
    });
  }

  function showPromoteSwap(state, team, minorsP) {
    // Same-type swap keeps the 13 pitchers / 13 hitters split intact.
    const candidates = team.roster
      .map((id) => state.players[id])
      .filter((p) => p && p.isPitcher === minorsP.isPitcher)
      .sort((a, b) => (minorsP.isPitcher ? overallPitcher(a) - overallPitcher(b) : overallHitter(a) - overallHitter(b)));
    pickerModal(state, `Send down for ${minorsP.name}`, candidates,
      (p) => `${p.primaryPosition} • Age ${p.age} • OVR ${U.gradeFor(p.isPitcher ? overallPitcher(p) : overallHitter(p))}`,
      (p) => swapWithMinors(state, team, minorsP.id, p.id));
  }

  function swapWithMinors(state, team, minorsId, rosterId) {
    mutateTeam(state, team, (statuses) => {
      const up = state.players[minorsId];
      const down = state.players[rosterId];
      statuses[minorsId] = { rosterStatus: up.rosterStatus, status: up.status };
      statuses[rosterId] = { rosterStatus: down.rosterStatus, status: down.status };

      team.roster[team.roster.indexOf(rosterId)] = minorsId;
      team.minors[team.minors.indexOf(minorsId)] = rosterId;
      up.rosterStatus = '26-man';
      up.status = 'active';
      down.rosterStatus = window.BBGM_ROSTER.demotionLevel(down);
      down.status = 'minors';

      // The GM made the roster move; the manager re-sets his lineup,
      // rotation, and bullpen around the new 26-man (Pillar 4).
      window.BBGM_ROSTER.safeRebuild(state, team);
    });
  }

  // ------- Shared rows / helpers -------

  function playerRow(p, state, year) {
    const s = p.stats[year];
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showRosterActions(state, team, p) }
    });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    let meta = `Age ${p.age} • ${p.bats}/${p.throws}`;
    info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
    // OVR + the key tools at a glance (0.25.2) — fills the row's dead
    // space so the roster reads without opening every card.
    const r = p.ratings;
    info.appendChild(p.isPitcher
      ? ratingStrip([
          ['OVR', overallPitcher(p)], ['VEL', r.velocity], ['STF', r.stuff],
          ['CTL', r.control], ['STA', r.stamina],
        ])
      : ratingStrip([
          ['OVR', overallHitter(p)], ['CON', (r.contactVsR + r.contactVsL) / 2],
          ['POW', (r.powerVsR + r.powerVsL) / 2], ['SPD', r.speed], ['DEF', r.defense || 50],
        ]));
    row.appendChild(info);
    const stats = U.el('div', { class: 'player-row-stats' });
    if (p.isPitcher) {
      if (s && s.ipOuts > 0) {
        stats.appendChild(U.el('span', {}, `${(s.w||0)}W ${S.era(s).toFixed(2)} ERA`));
      } else {
        stats.appendChild(U.el('span', { class: U.gradeClass(overallPitcher(p)) }, String(U.gradeFor(overallPitcher(p)))));
        stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
      }
    } else {
      if (s && s.ab > 0) {
        stats.appendChild(U.el('span', {}, `${S.fmtAvg(S.avg(s))} • ${s.hr}HR`));
      } else {
        stats.appendChild(U.el('span', { class: U.gradeClass(overallHitter(p)) }, String(U.gradeFor(overallHitter(p)))));
        stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
      }
    }
    row.appendChild(stats);
    return row;
  }

  function insetRow(label, value) {
    const r = U.el('div', { class: 'inset-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  function overallHitter(p) {
    const r = p.ratings;
    return (r.contactVsR + r.contactVsL) / 2 * 0.30 +
      (r.powerVsR + r.powerVsL) / 2 * 0.30 +
      r.discipline * 0.15 +
      r.speed * 0.10 +
      r.defense * 0.10 +
      r.arm * 0.05;
  }

  function overallPitcher(p) {
    const r = p.ratings;
    return r.stuff * 0.30 + r.control * 0.25 + r.movement * 0.20 + r.velocity * 0.15 + r.stamina * 0.10;
  }

  function overallProspect(p) {
    return p.isPitcher ? overallPitcher(p) : overallHitter(p);
  }

  // ratingStrip shared with the League tab's team pages (0.25.2) so every
  // roster surface renders the same attribute chips.
  return { render, overallHitter, overallPitcher, ratingStrip };
})();
