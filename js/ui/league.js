// League view: standings, schedule, leaders, teams
window.BBGM_UI_LEAGUE = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const S = window.BBGM_STATS;
  const STAND = window.BBGM_STANDINGS;

  let activeTab = 'standings';

  function render(container, state) {
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'League'));
    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'standings', label: 'Standings' },
      { key: 'leaders', label: 'Leaders' },
      { key: 'teams', label: 'Teams' },
      { key: 'history', label: 'History' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } }
      }, t.label));
    }
    container.appendChild(tabs);

    if (activeTab === 'standings') renderStandings(container, state);
    else if (activeTab === 'leaders') renderLeaders(container, state);
    else if (activeTab === 'teams') renderTeams(container, state);
    else if (activeTab === 'history') renderHistory(container, state);
  }

  function renderHistory(container, state) {
    const seasons = (state.history && state.history.seasons) || [];
    if (!seasons.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'No completed seasons yet. History fills in as the years go by.'));
      return;
    }
    container.appendChild(U.el('div', { class: 'card-title' }, 'Champions'));
    const list = U.el('div', { class: 'roster-list' });
    for (const s of seasons.slice().reverse()) {
      const champ = state.league.teams.find((t) => t.id === s.championId);
      const runnerUp = state.league.teams.find((t) => t.id === s.runnerUpId);
      const rec = s.records && s.records[s.championId];
      const row = U.el('div', { class: 'roster-row' });
      if (champ) row.appendChild(U.teamCap(champ));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${s.year} — ${champ ? champ.name : s.championId}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `Beat ${runnerUp ? runnerUp.name : s.runnerUpId} ${s.worldSeries.score[0]}-${s.worldSeries.score[1]} in the World Series` +
        (rec ? ` • ${rec.w}-${rec.l} regular season` : '')));
      row.appendChild(info);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  function renderStandings(container, state) {
    const standings = STAND.buildStandings(state);
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    for (const block of standings) {
      const card = U.el('div', { class: 'standings-card' });
      const header = U.el('div', { class: 'standings-header' });
      header.appendChild(U.el('span', {}, `${U.leagueName(block.league)} League — ${block.division}`));
      card.appendChild(header);

      const head = U.el('div', { class: 'standings-row head' });
      head.appendChild(U.el('div', { class: 'col-team' }, 'Team'));
      head.appendChild(U.el('div', { class: 'col-num' }, 'W'));
      head.appendChild(U.el('div', { class: 'col-num' }, 'L'));
      head.appendChild(U.el('div', { class: 'col-num' }, 'PCT'));
      head.appendChild(U.el('div', { class: 'col-num' }, 'GB'));
      head.appendChild(U.el('div', { class: 'col-num' }, 'RD'));
      card.appendChild(head);

      for (const row of block.teams) {
        const t = row.team;
        const tr = U.el('div', {
          class: `standings-row${t.id === userTeam.id ? ' highlight' : ''}`,
        });
        const tc = U.el('div', { class: 'col-team' });
        tc.appendChild(U.teamCap(t));
        tc.appendChild(U.el('span', { class: 'name' }, t.abbr));
        tr.appendChild(tc);
        tr.appendChild(U.el('div', { class: 'col-num wins' }, String(t.seasonRecord.w)));
        tr.appendChild(U.el('div', { class: 'col-num' }, String(t.seasonRecord.l)));
        tr.appendChild(U.el('div', { class: 'col-num' }, fmtPct(row.wp)));
        tr.appendChild(U.el('div', { class: 'col-num' }, row.gb === 0 ? '—' : row.gb.toFixed(1)));
        const rd = t.seasonRecord.rs - t.seasonRecord.ra;
        tr.appendChild(U.el('div', { class: 'col-num' }, (rd >= 0 ? '+' : '') + rd));
        card.appendChild(tr);
      }
      container.appendChild(card);
    }
  }

  function renderLeaders(container, state) {
    const players = Object.values(state.players);
    const year = state.meta.currentDate.year;

    // Hitting leaders
    const hitters = players
      .filter((p) => !p.isPitcher && p.stats[year] && (p.stats[year].pa || 0) >= Math.max(20, qualifierPA(state)))
      .map((p) => ({ p, s: p.stats[year] }));
    const pitchers = players
      .filter((p) => p.isPitcher && p.stats[year] && (p.stats[year].ipOuts || 0) >= Math.max(15, qualifierIP(state) * 3))
      .map((p) => ({ p, s: p.stats[year] }));

    container.appendChild(U.el('div', { class: 'card-title' }, 'Hitting Leaders'));

    container.appendChild(leaderList('AVG', hitters, (x) => S.avg(x.s), (v) => S.fmtAvg(v), 10, true));
    container.appendChild(leaderList('HR', hitters, (x) => x.s.hr || 0, (v) => String(v)));
    container.appendChild(leaderList('RBI', hitters, (x) => x.s.rbi || 0, (v) => String(v)));
    container.appendChild(leaderList('SB', hitters, (x) => x.s.sb || 0, (v) => String(v)));
    container.appendChild(leaderList('OPS', hitters, (x) => S.ops(x.s), (v) => v.toFixed(3), 10, true));

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '20px' } }, 'Pitching Leaders'));
    container.appendChild(leaderList('Wins', pitchers, (x) => x.s.w || 0, (v) => String(v)));
    container.appendChild(leaderList('ERA', pitchers, (x) => S.era(x.s), (v) => v.toFixed(2), 10, false, true));
    container.appendChild(leaderList('K', pitchers, (x) => x.s.k || 0, (v) => String(v)));
    container.appendChild(leaderList('SV', pitchers, (x) => x.s.sv || 0, (v) => String(v)));
  }

  function leaderList(title, list, fn, fmt, n = 10, isAvgFmt = false, ascending = false) {
    const wrap = U.el('div', { style: { 'margin-bottom': '16px' } });
    wrap.appendChild(U.el('div', { class: 'card-title' }, title));
    if (list.length === 0) {
      wrap.appendChild(U.el('div', { class: 'empty-state' }, 'No qualifiers yet.'));
      return wrap;
    }
    const sorted = list.slice().sort((a, b) => ascending ? fn(a) - fn(b) : fn(b) - fn(a));
    const top = sorted.slice(0, n);
    const lc = U.el('div', { class: 'leader-list' });
    top.forEach((entry, idx) => {
      const row = U.el('button', {
        class: 'leader-row',
        on: { click: () => window.BBGM_UI_PLAYER.show(entry.p.id) }
      });
      row.appendChild(U.el('span', { class: 'rank' }, `${idx + 1}.`));
      const nameSp = U.el('span', { class: 'name' });
      nameSp.appendChild(document.createTextNode(entry.p.name));
      const teamAbbr = window.BBGM_STATE.getTeam(entry.p.teamId);
      if (teamAbbr) nameSp.appendChild(U.el('span', { class: 'team' }, teamAbbr.abbr));
      row.appendChild(nameSp);
      row.appendChild(U.el('span', { class: 'stat' }, fmt(fn(entry))));
      lc.appendChild(row);
    });
    wrap.appendChild(lc);
    return wrap;
  }

  function qualifierPA(state) {
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const games = userTeam.seasonRecord.w + userTeam.seasonRecord.l;
    return Math.round(games * 3.1);
  }

  function qualifierIP(state) {
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const games = userTeam.seasonRecord.w + userTeam.seasonRecord.l;
    return games * 1.0;
  }

  function renderTeams(container, state) {
    // Group by canonical NABL ordering (east before west, then division
    // order from BBGM_DIVISIONS_BY_LEAGUE). Within each division, top
    // standings on top.
    const teams = state.league.teams.slice().sort((a, b) => {
      const byDiv = U.compareTeamsByDivision(a, b);
      if (byDiv !== 0) return byDiv;
      return STAND.winPct(b) - STAND.winPct(a);
    });

    let lastGroup = '';
    for (const t of teams) {
      const grp = U.divisionLabel(t);
      if (grp !== lastGroup) {
        container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, grp));
        lastGroup = grp;
      }
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => showTeamDetail(state, t) }
      });
      row.appendChild(U.teamCap(t));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' }, t.name));
      info.appendChild(U.el('div', { class: 'player-row-meta' }, `${t.ownerName} • ${t.market[0].toUpperCase() + t.market.slice(1)}`));
      row.appendChild(info);
      const stats = U.el('div', { class: 'player-row-stats' });
      stats.appendChild(U.el('span', {}, `${t.seasonRecord.w}-${t.seasonRecord.l}`));
      row.appendChild(stats);
      container.appendChild(row);
    }
  }

  function showTeamDetail(state, team) {
    const body = U.el('div');
    body.appendChild(U.el('div', { class: 'inset-list' }, [
      insetRow('League/Division', U.divisionLabel(team)),
      insetRow('Owner Archetype', team.ownerName),
      insetRow('Market', team.market[0].toUpperCase() + team.market.slice(1)),
      insetRow('Payroll Base', U.fmtMoney(team.payrollBase)),
      insetRow('Ballpark', team.ballpark.name),
      insetRow('Run Factor', String(team.ballpark.factors.run)),
      insetRow('HR Factor', String(team.ballpark.factors.hr)),
      insetRow('Window', team.competitiveWindow),
      insetRow('Record', `${team.seasonRecord.w}-${team.seasonRecord.l}`),
      insetRow('Run Diff', String(team.seasonRecord.rs - team.seasonRecord.ra)),
    ]));
    U.showModal({
      title: team.name,
      body,
      actions: [
        { label: 'Close', kind: 'primary', onClick: () => true },
      ],
    });
  }

  function insetRow(label, value) {
    const r = U.el('div', { class: 'inset-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  function fmtPct(v) {
    return v.toFixed(3).replace(/^0/, '');
  }

  return { render };
})();
