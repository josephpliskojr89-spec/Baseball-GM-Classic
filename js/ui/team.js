// Team view: roster, lineup, pitching, minors.
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

  function render(container, state) {
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
    else if (activeTab === 'minors') renderMinors(container, state, team);
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

  // Action modal: a few labeled buttons.
  function actionModal(title, actions) {
    U.showModal({
      title,
      body: U.el('div'),
      actions: actions.concat([{ label: 'Cancel', kind: 'secondary', onClick: () => true }]),
    });
  }

  function arrowButtons(onUp, onDown) {
    const wrap = U.el('div', { style: { display: 'flex', gap: '4px' } });
    wrap.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { 'min-width': '40px', 'min-height': '40px', padding: '4px' },
      on: { click: (e) => { e.stopPropagation(); onUp(); } },
    }, '▲'));
    wrap.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { 'min-width': '40px', 'min-height': '40px', padding: '4px' },
      on: { click: (e) => { e.stopPropagation(); onDown(); } },
    }, '▼'));
    return wrap;
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

    // Sort: pitchers by SP/RP/CP, hitters by overall offensive value
    players_filtered.sort((a, b) => {
      if (a.isPitcher !== b.isPitcher) return a.isPitcher ? 1 : -1;
      if (a.isPitcher && b.isPitcher) {
        const order = { SP: 0, RP: 1, CP: 2 };
        if (order[a.primaryPosition] !== order[b.primaryPosition]) return order[a.primaryPosition] - order[b.primaryPosition];
        return overallPitcher(b) - overallPitcher(a);
      }
      return overallHitter(b) - overallHitter(a);
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

    // Roster summary
    const card = U.el('div', { class: 'card', style: { 'margin-top': '16px' } });
    card.appendChild(U.el('div', { class: 'card-title' }, 'Roster Summary'));
    const ul = U.el('div', { class: 'inset-list', style: { 'border': 'none' } });
    const pCount = roster.filter((p) => p.isPitcher).length;
    const hCount = roster.filter((p) => !p.isPitcher).length;
    ul.appendChild(insetRow('26-Man Roster', `${roster.length} / 26`));
    ul.appendChild(insetRow('Pitchers', `${pCount}`));
    ul.appendChild(insetRow('Position Players', `${hCount}`));
    ul.appendChild(insetRow('Payroll Base', U.fmtMoney(team.payrollBase)));
    ul.appendChild(insetRow('Owner', team.ownerName));
    ul.appendChild(insetRow('Ballpark', team.ballpark.name));
    card.appendChild(ul);
    container.appendChild(card);
  }

  // ------- Lineup tab (editable) -------

  function renderLineup(container, state, team) {
    container.appendChild(U.el('p', {
      class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' },
    }, 'Use ▲▼ to reorder. Tap a batter to swap in a bench player.'));

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
      on: { click: () => showLineupActions(state, team, key, idx) },
    });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
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

    row.appendChild(arrowButtons(
      () => moveSpot(state, team, key, idx, -1),
      () => moveSpot(state, team, key, idx, +1),
    ));
    return row;
  }

  function moveSpot(state, team, key, idx, dir) {
    const lineup = team[key];
    const j = idx + dir;
    if (j < 0 || j >= lineup.length) return;
    [lineup[idx], lineup[j]] = [lineup[j], lineup[idx]];
    commit(state);
  }

  function showLineupActions(state, team, key, idx) {
    const spot = team[key][idx];
    const p = state.players[spot.playerId];
    actionModal(`${p.name} (${spot.position})`, [
      { label: 'Swap Batter…', kind: 'primary', onClick: () => {
        // Open after this modal closes.
        setTimeout(() => showLineupSwap(state, team, key, idx), 0);
      }},
      { label: 'View Profile', kind: 'secondary', onClick: () => {
        setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
      }},
    ]);
  }

  function showLineupSwap(state, team, key, idx) {
    const spot = team[key][idx];
    const inLineup = new Set(team[key].map((s) => s.playerId));
    const candidates = team.roster
      .map((id) => state.players[id])
      .filter((p) => p && !p.isPitcher && !inLineup.has(p.id) && GEN().canPlay(p, spot.position))
      .sort((a, b) => overallHitter(b) - overallHitter(a));
    pickerModal(state, `Swap in at ${spot.position}`, candidates,
      (p) => `${p.primaryPosition} • Age ${p.age} • OVR ${U.gradeFor(overallHitter(p))}`,
      (p) => {
        mutateTeam(state, team, () => { spot.playerId = p.id; });
      });
  }

  // ------- Pitching tab (editable) -------

  function renderPitching(container, state, team) {
    const players = state.players;
    if (!team.bullpenRoles) {
      team.bullpenRoles = GEN().assignBullpenRoles(team, players);
    }

    container.appendChild(U.el('p', {
      class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' },
    }, 'Use ▲▼ to reorder the rotation. Tap a pitcher to swap or assign a bullpen role.'));

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
    const row = U.el('div', { class: 'roster-row' });
    row.appendChild(U.el('span', { class: 'pos-badge pos-pitcher' }, `SP${idx + 1}`));

    const info = U.el('button', {
      class: 'player-row-info',
      style: { 'text-align': 'left', background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
      on: { click: () => showRotationActions(state, team, idx) },
    });
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

    row.appendChild(arrowButtons(
      () => moveRotation(state, team, idx, -1),
      () => moveRotation(state, team, idx, +1),
    ));
    return row;
  }

  function moveRotation(state, team, idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= team.rotation.length) return;
    [team.rotation[idx], team.rotation[j]] = [team.rotation[j], team.rotation[idx]];
    commit(state);
  }

  function showRotationActions(state, team, idx) {
    const p = state.players[team.rotation[idx]];
    actionModal(`${p.name} (SP${idx + 1})`, [
      { label: 'Swap Starter…', kind: 'primary', onClick: () => {
        setTimeout(() => showRotationSwap(state, team, idx), 0);
      }},
      { label: 'View Profile', kind: 'secondary', onClick: () => {
        setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
      }},
    ]);
  }

  function showRotationSwap(state, team, idx) {
    const inRotation = new Set(team.rotation);
    const candidates = team.roster
      .map((id) => state.players[id])
      .filter((p) => p && p.isPitcher && !inRotation.has(p.id))
      .sort((a, b) => {
        // SP-primary arms first, then by stamina
        if ((a.primaryPosition === 'SP') !== (b.primaryPosition === 'SP')) {
          return a.primaryPosition === 'SP' ? -1 : 1;
        }
        return b.ratings.stamina - a.ratings.stamina;
      });
    pickerModal(state, `Swap into rotation (SP${idx + 1})`, candidates,
      (p) => `${p.primaryPosition} • STA ${U.gradeFor(p.ratings.stamina)}` +
             (p.primaryPosition !== 'SP' ? ' • ⚠ not a starter' : ''),
      (p) => {
        mutateTeam(state, team, () => {
          const old = team.rotation[idx];
          team.rotation[idx] = p.id;
          // If the new starter came from the bullpen, the displaced starter
          // takes his bullpen slot and role.
          const bi = team.bullpen.indexOf(p.id);
          if (bi >= 0) {
            team.bullpen[bi] = old;
            const roles = team.bullpenRoles || {};
            for (const r in roles) {
              const ix = roles[r].indexOf(p.id);
              if (ix >= 0) roles[r][ix] = old;
            }
          }
          if (team.closer === p.id) team.closer = old;
        });
      });
  }

  function bullpenRow(state, team, p, badge) {
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('div', { class: 'roster-row' });
    row.appendChild(U.el('span', { class: 'pos-badge pos-pitcher' }, badge));

    const info = U.el('button', {
      class: 'player-row-info',
      style: { 'text-align': 'left', background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
      on: { click: () => showBullpenActions(state, team, p) },
    });
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

  function showBullpenActions(state, team, p) {
    const isCloser = team.closer === p.id;
    const actions = [];
    if (!isCloser) {
      actions.push({ label: 'Make Closer', kind: 'primary', onClick: () => makeCloser(state, team, p.id) });
      for (const [role, label] of [['setup', 'Set: Setup'], ['middle', 'Set: Middle'], ['long', 'Set: Long Relief'], ['mopup', 'Set: Mop-up']]) {
        actions.push({ label, kind: 'secondary', onClick: () => setBullpenRole(state, team, p.id, role) });
      }
    }
    actions.push({ label: 'View Profile', kind: 'secondary', onClick: () => {
      setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
    }});
    actionModal(`${p.name}${isCloser ? ' (Closer)' : ''}`, actions);
  }

  function makeCloser(state, team, pid) {
    mutateTeam(state, team, () => {
      const old = team.closer;
      team.closer = pid;
      team.bullpen = team.bullpen.filter((id) => id !== pid);
      const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
      for (const r in roles) roles[r] = roles[r].filter((id) => id !== pid);
      if (old) {
        team.bullpen.push(old);
        (roles.setup = roles.setup || []).push(old);
      }
    });
  }

  function setBullpenRole(state, team, pid, role) {
    mutateTeam(state, team, () => {
      const roles = team.bullpenRoles || (team.bullpenRoles = { setup: [], middle: [], long: [], mopup: [] });
      for (const r in roles) roles[r] = roles[r].filter((id) => id !== pid);
      (roles[role] = roles[role] || []).push(pid);
    });
  }

  // ------- Minors tab (promotion) -------

  function renderMinors(container, state, team) {
    const players = state.players;
    container.appendChild(U.el('p', {
      class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' },
    }, 'Tap a player to view or promote (swaps with a 26-man player of the same type).'));
    const minors = team.minors.map((id) => players[id]).filter(Boolean);
    const byLevel = { AAA: [], AA: [], 'A+': [], A: [], Rookie: [] };
    for (const p of minors) {
      if (byLevel[p.rosterStatus]) byLevel[p.rosterStatus].push(p);
    }
    for (const lvl of ['AAA', 'AA', 'A+', 'A', 'Rookie']) {
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
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
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
    row.appendChild(info);
    const stats = U.el('div', { class: 'player-row-stats' });
    const overall = Math.round(p.isPitcher ? overallPitcher(p) : overallHitter(p));
    const cls = U.gradeClass(overall);
    stats.appendChild(U.el('span', { class: cls }, String(U.gradeFor(overall))));
    stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    row.appendChild(stats);
    return row;
  }

  function showMinorsActions(state, team, p) {
    actionModal(`${p.name} (${p.rosterStatus})`, [
      { label: 'Promote (swap)…', kind: 'primary', onClick: () => {
        setTimeout(() => showPromoteSwap(state, team, p), 0);
      }},
      { label: 'View Profile', kind: 'secondary', onClick: () => {
        setTimeout(() => window.BBGM_UI_PLAYER.show(p.id), 0);
      }},
    ]);
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
      down.rosterStatus = 'AAA';
      down.status = 'minors';

      if (down.isPitcher) {
        // Replace the demoted pitcher everywhere he's referenced.
        const ri = team.rotation.indexOf(rosterId);
        if (ri >= 0) team.rotation[ri] = minorsId;
        if (team.closer === rosterId) team.closer = minorsId;
        const bi = team.bullpen.indexOf(rosterId);
        if (bi >= 0) team.bullpen[bi] = minorsId;
        const roles = team.bullpenRoles || {};
        for (const r in roles) {
          const ix = roles[r].indexOf(rosterId);
          if (ix >= 0) roles[r][ix] = minorsId;
        }
      } else {
        // Lineups: the promoted hitter takes the slot if eligible; otherwise
        // the best eligible bench hitter does.
        for (const key of ['lineupRH', 'lineupLH']) {
          for (const spot of team[key]) {
            if (spot.playerId !== rosterId) continue;
            if (GEN().canPlay(up, spot.position)) {
              spot.playerId = minorsId;
              continue;
            }
            const inLineup = new Set(team[key].map((s) => s.playerId));
            const sub = team.roster
              .map((id) => state.players[id])
              .filter((q) => q && !q.isPitcher && !inLineup.has(q.id) && GEN().canPlay(q, spot.position))
              .sort((a, b) => overallHitter(b) - overallHitter(a))[0];
            spot.playerId = sub ? sub.id : minorsId;
          }
        }
      }
    });
  }

  // ------- Shared rows / helpers -------

  function playerRow(p, state, year) {
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) }
    });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    let meta = `Age ${p.age} • ${p.bats}/${p.throws}`;
    info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
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

  return { render, overallHitter, overallPitcher };
})();
