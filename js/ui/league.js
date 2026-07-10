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
      { key: 'playoffs', label: 'Playoffs' },
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
    else if (activeTab === 'playoffs') renderPlayoffs(container, state);
    else if (activeTab === 'leaders') renderLeaders(container, state);
    else if (activeTab === 'teams') renderTeams(container, state);
    else if (activeTab === 'history') renderHistory(container, state);
  }

  // ------- Playoffs tab: bracket + matchups (3.4) -------
  // Shows the most recent completed postseason from state.league.postseason.
  // Before the first one exists, a seeding preview built from the live
  // standings shows who'd be in if the season ended today.

  function renderPlayoffs(container, state) {
    const ps = state.league.postseason;
    if (!ps) {
      renderSeedPreview(container, state);
      return;
    }

    // Champion banner.
    const champ = state.league.teams.find((t) => t.id === ps.championId);
    const runnerUp = state.league.teams.find((t) => t.id === ps.runnerUpId);
    const banner = U.el('div', { class: 'card', style: champ ? U.teamColorVars(champ) : {} });
    banner.appendChild(U.el('div', { class: 'card-title' }, `${ps.year} World Series Champions`));
    const line = U.el('div', { style: { display: 'flex', 'align-items': 'center', gap: '8px' } });
    if (champ) line.appendChild(U.teamCap(champ, { size: 'lg' }));
    line.appendChild(U.el('div', {}, [
      U.el('div', { style: { 'font-weight': '700' } }, champ ? champ.name : ps.championId),
      U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
        `def. ${runnerUp ? runnerUp.name : ps.runnerUpId} ${ps.worldSeries.score[0]}-${ps.worldSeries.score[1]}`),
    ]));
    banner.appendChild(line);
    container.appendChild(banner);

    // Records for seed labels come from the archived season.
    const season = ((state.history && state.history.seasons) || []).find((s) => s.year === ps.year);
    const recOf = (teamId) => {
      const r = season && season.records && season.records[teamId];
      return r ? `${r.w}-${r.l}` : '';
    };

    for (const round of ps.rounds || []) {
      const seedNo = {};
      round.seeds.forEach((id, i) => { seedNo[id] = i + 1; });
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } },
        `${U.leagueName(round.league)} League`));

      // Seeds strip.
      const seedsCard = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      for (const id of round.seeds) {
        const t = state.league.teams.find((x) => x.id === id);
        seedsCard.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '2px 0' } },
          `#${seedNo[id]} ${t ? t.name : id}${recOf(id) ? ' (' + recOf(id) + ')' : ''}` +
          (seedNo[id] <= 2 ? ' — first-round bye' : '')));
      }
      container.appendChild(seedsCard);

      const list = U.el('div', { class: 'roster-list' });
      list.appendChild(seriesRow(state, ps, 'WC', round.wildCard[0], `${round.league}_wc1`, seedNo));
      list.appendChild(seriesRow(state, ps, 'WC', round.wildCard[1], `${round.league}_wc2`, seedNo));
      list.appendChild(seriesRow(state, ps, 'DS', round.divisionSeries[0], `${round.league}_ds1`, seedNo));
      list.appendChild(seriesRow(state, ps, 'DS', round.divisionSeries[1], `${round.league}_ds2`, seedNo));
      list.appendChild(seriesRow(state, ps, 'LCS', round.lcs, `${round.league}_lcs`, seedNo));
      container.appendChild(list);
    }

    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'World Series'));
    const wsList = U.el('div', { class: 'roster-list' });
    wsList.appendChild(seriesRow(state, ps, 'WS', ps.worldSeries, 'ws', {}));
    container.appendChild(wsList);
  }

  // One series line: winner cap, "ABC def. XYZ 3-1", tap for the games.
  function seriesRow(state, ps, label, summary, tag, seedNo) {
    const winner = state.league.teams.find((t) => t.id === summary.winnerId);
    const loser = state.league.teams.find((t) => t.id === summary.loserId);
    const seedOf = (id) => seedNo[id] ? `#${seedNo[id]} ` : '';
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => showSeriesGames(state, ps, label, summary, tag) },
    });
    row.appendChild(U.el('span', { class: 'pos-badge' }, label));
    if (winner) row.appendChild(U.teamCap(winner));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' },
      `${seedOf(summary.winnerId)}${winner ? winner.abbr : '?'} def. ${seedOf(summary.loserId)}${loser ? loser.abbr : '?'}`));
    info.appendChild(U.el('div', { class: 'player-row-meta' }, 'Tap for the games'));
    row.appendChild(info);
    row.appendChild(U.el('div', { class: 'player-row-stats' },
      `${summary.score[0]}-${summary.score[1]}`));
    return row;
  }

  function showSeriesGames(state, ps, label, summary, tag) {
    const winner = state.league.teams.find((t) => t.id === summary.winnerId);
    const loser = state.league.teams.find((t) => t.id === summary.loserId);
    const games = (ps.games || []).filter((g) => g.postseason === tag);
    const body = U.el('div', { class: 'roster-list' });
    games.forEach((g, i) => {
      if (!g.result) return;
      const home = state.league.teams.find((t) => t.id === g.homeId);
      const away = state.league.teams.find((t) => t.id === g.awayId);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => {
          U.closeModal();
          window.BBGM_MAIN.navigate('games', { gameId: g.gameId });
        }},
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, `G${i + 1}`));
      const info = U.el('div', { class: 'player-row-info' });
      const hw = g.result.homeRuns > g.result.awayRuns;
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${away ? away.abbr : '?'} ${g.result.awayRuns} @ ${home ? home.abbr : '?'} ${g.result.homeRuns}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `${(hw ? home : away) ? (hw ? home : away).abbr : '?'} win` +
        (g.result.innings && g.result.innings !== 9 ? ` (${g.result.innings})` : '') +
        ' • tap for box score'));
      row.appendChild(info);
      body.appendChild(row);
    });
    U.showModal({
      title: `${label}: ${winner ? winner.abbr : '?'} ${summary.score[0]}-${summary.score[1]} ${loser ? loser.abbr : '?'}`,
      body,
      actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
    });
  }

  // Pre-first-postseason: live "if the season ended today" seeding.
  function renderSeedPreview(container, state) {
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'No postseason has been played yet. Here\'s the bracket if the season ended today — ' +
      'top two seeds in each league draw first-round byes.'));
    for (const lg of ['east', 'west']) {
      const seeds = window.BBGM_OFFSEASON.seedLeague(state, lg);
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } },
        `${U.leagueName(lg)} League`));
      const card = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      seeds.forEach((t, i) => {
        card.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '2px 0' } },
          `#${i + 1} ${t.name} (${t.seasonRecord.w}-${t.seasonRecord.l})` +
          (i < 2 ? ' — bye' : '')));
      });
      card.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
        `Wild card: #3 hosts #6, #4 hosts #5 (best of 3).`));
      container.appendChild(card);
    }
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
