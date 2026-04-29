// Team view: roster, lineup, pitching, minors
window.BBGM_UI_TEAM = (function () {
  const U = window.BBGM_UI;
  const S = window.BBGM_STATS;

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

  function renderLineup(container, state, team) {
    const players = state.players;
    container.appendChild(U.el('div', { class: 'card-title' }, 'Lineup vs. RHP'));
    const list1 = U.el('div', { class: 'roster-list' });
    team.lineupRH.forEach((spot, idx) => {
      const p = players[spot.playerId];
      if (!p) return;
      const row = lineupRow(p, state, idx + 1, spot.position);
      list1.appendChild(row);
    });
    container.appendChild(list1);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Lineup vs. LHP'));
    const list2 = U.el('div', { class: 'roster-list' });
    team.lineupLH.forEach((spot, idx) => {
      const p = players[spot.playerId];
      if (!p) return;
      const row = lineupRow(p, state, idx + 1, spot.position);
      list2.appendChild(row);
    });
    container.appendChild(list2);
  }

  function lineupRow(p, state, batOrder, position) {
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) }
    });
    row.appendChild(U.el('span', { class: 'pos-badge', style: { 'background': 'var(--bg-elevated)' } }, String(batOrder)));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `${position} • Age ${p.age}` + (s ? ` • ${S.fmtAvg(S.avg(s))}/${S.fmtAvg(S.obp(s))}/${S.fmtAvg(S.slg(s))}` : '')));
    row.appendChild(info);
    return row;
  }

  function renderPitching(container, state, team) {
    const players = state.players;
    container.appendChild(U.el('div', { class: 'card-title' }, 'Starting Rotation'));
    const list = U.el('div', { class: 'roster-list' });
    team.rotation.forEach((id, idx) => {
      const p = players[id];
      if (!p) return;
      list.appendChild(rotationRow(p, state, idx + 1));
    });
    container.appendChild(list);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Closer'));
    const closerList = U.el('div', { class: 'roster-list' });
    if (team.closer) {
      const cp = players[team.closer];
      closerList.appendChild(playerRow(cp, state, state.meta.currentDate.year));
    }
    container.appendChild(closerList);

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Bullpen'));
    const bp = U.el('div', { class: 'roster-list' });
    team.bullpen.forEach((id) => {
      const p = players[id];
      if (!p) return;
      bp.appendChild(playerRow(p, state, state.meta.currentDate.year));
    });
    container.appendChild(bp);
  }

  function rotationRow(p, state, slot) {
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) }
    });
    row.appendChild(U.el('span', { class: 'pos-badge pos-pitcher' }, `SP${slot}`));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    const desc = s
      ? `${s.w || 0}-${s.l || 0} • ${S.era(s).toFixed(2)} ERA • ${S.fmtIP(s.ipOuts || 0)} IP`
      : `Age ${p.age}`;
    info.appendChild(U.el('div', { class: 'player-row-meta' }, desc));
    row.appendChild(info);
    return row;
  }

  function renderMinors(container, state, team) {
    const players = state.players;
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
      for (const p of byLevel[lvl]) list.appendChild(prospectRow(p, state));
      container.appendChild(list);
    }
  }

  function prospectRow(p, state) {
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => window.BBGM_UI_PLAYER.show(p.id) }
    });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
    info.appendChild(U.el('div', { class: 'player-row-meta' },
      `Age ${p.age} • ${p.bats}/${p.throws}`));
    row.appendChild(info);
    const stats = U.el('div', { class: 'player-row-stats' });
    const overall = Math.round(p.isPitcher ? overallPitcher(p) : overallHitter(p));
    const cls = U.gradeClass(overall);
    stats.appendChild(U.el('span', { class: cls }, String(U.gradeFor(overall))));
    stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    row.appendChild(stats);
    return row;
  }

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
