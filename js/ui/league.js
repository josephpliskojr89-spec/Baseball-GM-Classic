// League view: standings, schedule, leaders, teams
window.BBGM_UI_LEAGUE = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const S = window.BBGM_STATS;
  const STAND = window.BBGM_STANDINGS;

  let activeTab = 'standings';

  function render(container, state, opts = {}) {
    // The Games view lives here as the Scores tab (folded in 0.13 to keep
    // the bottom nav tight). navigate('league', {tab:'scores', gameId})
    // deep-links straight to a box score.
    if (opts.tab) activeTab = opts.tab === 'games' ? 'scores' : opts.tab;
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'League'));
    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'scores', label: 'Scores' },
      { key: 'standings', label: 'Standings' },
      { key: 'stats', label: 'Stats' },
      { key: 'playoffs', label: 'Playoffs' },
      { key: 'leaders', label: 'Leaders' },
      { key: 'history', label: 'History' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        // Tab clicks always land on the tab's top view (an open team page
        // closes rather than shadowing the standings).
        on: { click: () => { activeTab = t.key; viewTeamId = null; render(container, state); } }
      }, t.label));
    }
    container.appendChild(tabs);

    if (opts.teamId) { viewTeamId = opts.teamId; }
    if (opts.statsTeamId) { statsTeamId = opts.statsTeamId; }

    if (activeTab === 'scores') renderScores(container, state, opts);
    else if (activeTab === 'standings' && viewTeamId) renderTeamPage(container, state);
    else if (activeTab === 'standings') renderStandings(container, state);
    else if (activeTab === 'stats') renderStatsPage(container, state);
    else if (activeTab === 'playoffs') renderPlayoffs(container, state);
    else if (activeTab === 'leaders') renderLeaders(container, state);
    else if (activeTab === 'history') renderHistory(container, state);
  }

  // ------- Team pages + Stats (0.15.1) -------
  // Any club's full roster is browsable (tap a standings row — the Teams
  // tab folded in here in 0.15.2), and the Stats tab is the one-stop
  // season table: hitting / pitching, sortable columns, any team.

  let viewTeamId = null;   // team page open inside the Standings tab
  let statsTeamId = null;  // Stats tab selection (defaults to user team)
  let statsMode = 'hitting';
  let statsSort = null;    // { key, dir }

  function overallOf(p) { return Math.round(window.BBGM_ROSTER.overall(p)); }

  function renderTeamPage(container, state) {
    const team = state.league.teams.find((t) => t.id === viewTeamId);
    if (!team) { viewTeamId = null; renderStandings(container, state); return; }
    const players = state.players;

    container.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { 'margin-bottom': '10px' },
      on: { click: () => { viewTeamId = null; window.BBGM_MAIN.refresh(); } },
    }, '← Standings'));

    const strip = U.el('div', { class: 'team-strip', style: U.teamColorVars(team) });
    strip.appendChild(U.teamCap(team, { size: 'lg' }));
    const info = U.el('div');
    info.appendChild(U.el('div', { class: 'team-strip-name' }, team.name));
    info.appendChild(U.el('div', { class: 'team-strip-meta' },
      `${U.divisionLabel(team)} • ${team.ownerName} • ${team.competitiveWindow}`));
    strip.appendChild(info);
    strip.appendChild(U.el('div', { class: 'team-strip-record' },
      `${team.seasonRecord.w}-${team.seasonRecord.l}`));
    container.appendChild(strip);

    container.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { width: '100%', margin: '10px 0' },
      on: { click: () => {
        statsTeamId = team.id;
        activeTab = 'stats';
        window.BBGM_MAIN.refresh();
      }},
    }, 'View Season Stats'));

    container.appendChild(U.el('div', { class: 'inset-list', style: { 'margin-bottom': '4px' } }, [
      insetRow('Ballpark', `${team.ballpark.name} (run ${team.ballpark.factors.run}, HR ${team.ballpark.factors.hr})`),
      insetRow('Market / Payroll Base', `${team.market[0].toUpperCase() + team.market.slice(1)} • ${U.fmtMoney(team.payrollBase)}`),
      insetRow('Run Diff', String(team.seasonRecord.rs - team.seasonRecord.ra)),
    ]));

    const roster = team.roster.map((id) => players[id]).filter(Boolean);
    const groups = [
      ['Hitters', roster.filter((p) => !p.isPitcher).sort((a, b) => overallOf(b) - overallOf(a))],
      ['Pitchers', roster.filter((p) => p.isPitcher).sort((a, b) => overallOf(b) - overallOf(a))],
    ];
    for (const [label, list] of groups) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } },
        `${label} (${list.length})`));
      const wrap = U.el('div', { class: 'roster-list' });
      for (const p of list) {
        const row = U.el('button', {
          class: 'roster-row',
          on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
        });
        row.appendChild(U.posBadge(p));
        const pi = U.el('div', { class: 'player-row-info' });
        pi.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
        pi.appendChild(U.el('div', { class: 'player-row-meta' },
          `Age ${p.age} • ${p.bats}/${p.throws}` +
          (p.currentInjury ? ' • 🤕 injured' : '')));
        row.appendChild(pi);
        const ovr = overallOf(p);
        const stats = U.el('div', { class: 'player-row-stats' });
        stats.appendChild(U.el('span', { class: U.gradeClass(ovr) }, String(U.gradeFor(ovr))));
        stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
        row.appendChild(stats);
        wrap.appendChild(row);
      }
      container.appendChild(wrap);
    }
    if ((team.il || []).length) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } },
        `Injured List (${team.il.length})`));
      const wrap = U.el('div', { class: 'roster-list' });
      for (const id of team.il) {
        const p = players[id];
        if (!p) continue;
        const row = U.el('button', {
          class: 'roster-row',
          on: { click: () => window.BBGM_UI_PLAYER.show(p.id) },
        });
        row.appendChild(U.posBadge(p));
        const pi = U.el('div', { class: 'player-row-info' });
        pi.appendChild(U.el('div', { class: 'player-row-name' }, p.name));
        pi.appendChild(U.el('div', { class: 'player-row-meta' },
          p.currentInjury ? `${p.currentInjury.type} — ${p.currentInjury.daysOut} days` : 'IL'));
        row.appendChild(pi);
        wrap.appendChild(row);
      }
      container.appendChild(wrap);
    }
  }

  // Column specs: [key, label, value(s or p), fmt, defaultDesc]
  const HIT_COLS = [
    ['g', 'G', (s) => s.g || 0],
    ['ab', 'AB', (s) => s.ab || 0],
    ['h', 'H', (s) => s.h || 0],
    ['hr', 'HR', (s) => s.hr || 0],
    ['rbi', 'RBI', (s) => s.rbi || 0],
    ['sb', 'SB', (s) => s.sb || 0],
    ['bb', 'BB', (s) => s.bb || 0],
    ['k', 'SO', (s) => s.k || 0],
    ['avg', 'AVG', (s) => S.avg(s), (v) => S.fmtAvg(v)],
    ['obp', 'OBP', (s) => S.obp(s), (v) => S.fmtAvg(v)],
    ['slg', 'SLG', (s) => S.slg(s), (v) => S.fmtAvg(v)],
    ['ops', 'OPS', (s) => S.ops(s), (v) => v.toFixed(3)],
  ];
  const PIT_COLS = [
    ['g', 'G', (s) => s.g || 0],
    ['gs', 'GS', (s) => s.gs || 0],
    ['w', 'W', (s) => s.w || 0],
    ['l', 'L', (s) => s.l || 0],
    ['sv', 'SV', (s) => s.sv || 0],
    ['ip', 'IP', (s) => (s.ipOuts || 0) / 3, (v, s) => S.fmtIP(s.ipOuts || 0)],
    ['era', 'ERA', (s) => S.era(s), (v) => v.toFixed(2), 'asc'],
    ['whip', 'WHIP', (s) => S.whip(s), (v) => v.toFixed(2), 'asc'],
    ['k', 'K', (s) => s.k || 0],
    ['bb', 'BB', (s) => s.bb || 0],
    ['hr', 'HR', (s) => s.hr || 0],
  ];

  function renderStatsPage(container, state) {
    if (!statsTeamId) statsTeamId = state.meta.userTeamId;
    const year = state.meta.currentDate.year;
    const players = state.players;

    // Team selector: native select (mobile-friendly), NABL order.
    const teams = state.league.teams.slice().sort((a, b) => {
      const d = U.compareTeamsByDivision(a, b);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    const picker = U.el('select', {
      class: 'stats-team-picker',
      style: {
        width: '100%', padding: '10px 12px', 'margin-bottom': '10px',
        background: 'var(--bg-elevated, #1c2230)', color: 'inherit',
        border: '1px solid var(--border, #30363d)', 'border-radius': 'var(--radius-md, 8px)',
        'font-size': '14px',
      },
      on: { change: (e) => { statsTeamId = e.target.value; window.BBGM_MAIN.refresh(); } },
    });
    for (const t of teams) {
      const opt = U.el('option', { value: t.id },
        `${t.name}${t.id === state.meta.userTeamId ? ' (you)' : ''}`);
      if (t.id === statsTeamId) opt.setAttribute('selected', 'selected');
      picker.appendChild(opt);
    }
    container.appendChild(picker);

    // Hitting / Pitching chips. (Advanced stats get a third chip later.)
    const chips = U.el('div', { class: 'filter-bar', style: { 'margin-bottom': '10px' } });
    for (const m of [['hitting', 'Hitting'], ['pitching', 'Pitching']]) {
      chips.appendChild(U.el('button', {
        class: `filter-chip${statsMode === m[0] ? ' active' : ''}`,
        on: { click: () => { statsMode = m[0]; statsSort = null; window.BBGM_MAIN.refresh(); } },
      }, m[1]));
    }
    container.appendChild(chips);

    const team = state.league.teams.find((t) => t.id === statsTeamId);
    const pool = team.roster.concat(team.il || [])
      .map((id) => players[id])
      .filter(Boolean);
    const isPitching = statsMode === 'pitching';
    const cols = isPitching ? PIT_COLS : HIT_COLS;
    const rows = pool
      .filter((p) => p.isPitcher === isPitching)
      .map((p) => ({ p, s: p.stats[year] || {} }))
      .filter((r) => isPitching ? (r.s.g || 0) > 0 || (r.s.ipOuts || 0) > 0 : (r.s.pa || 0) > 0);

    if (!rows.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        `No ${statsMode} stats yet this season.`));
      return;
    }

    // Sort: tap a column header; first tap uses the stat's natural
    // direction (ERA/WHIP ascending, everything else descending).
    if (!statsSort) statsSort = { key: isPitching ? 'ip' : 'ops', dir: 'desc' };
    const sortCol = cols.find((c) => c[0] === statsSort.key) || cols[0];
    rows.sort((a, b) => {
      const va = sortCol[2](a.s), vb = sortCol[2](b.s);
      return statsSort.dir === 'asc' ? va - vb : vb - va;
    });

    const wrap = U.el('div', { class: 'stats-scroll' });
    const table = U.el('table', { class: 'stats-table' });
    const trh = U.el('tr');
    trh.appendChild(U.el('th', {}, 'Player'));
    for (const c of cols) {
      const active = statsSort.key === c[0];
      trh.appendChild(U.el('th', {
        style: { cursor: 'pointer', ...(active ? { color: 'var(--accent, #58a6ff)' } : {}) },
        on: { click: () => {
          if (statsSort.key === c[0]) {
            statsSort.dir = statsSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            statsSort = { key: c[0], dir: c[4] === 'asc' ? 'asc' : 'desc' };
          }
          window.BBGM_MAIN.refresh();
        }},
      }, c[1] + (active ? (statsSort.dir === 'desc' ? ' ↓' : ' ↑') : '')));
    }
    const thead = U.el('thead');
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = U.el('tbody');
    for (const r of rows) {
      const tr = U.el('tr', {
        style: { cursor: 'pointer' },
        on: { click: () => window.BBGM_UI_PLAYER.show(r.p.id) },
      });
      tr.appendChild(U.el('td', { style: { 'white-space': 'nowrap' } },
        `${r.p.name} ${r.p.primaryPosition}`));
      for (const c of cols) {
        const v = c[2](r.s);
        tr.appendChild(U.el('td', {}, c[3] ? c[3](v, r.s) : String(v)));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '8px' } },
      'Tap a column to sort, a row for the player card. Advanced stats are coming later.'));
  }

  // Scores: the games view, embedded. Its today/recent/schedule chips
  // re-render only this wrapper, leaving League's tab bar in place.
  function renderScores(container, state, opts) {
    const wrap = U.el('div');
    container.appendChild(wrap);
    window.BBGM_UI_GAMES.render(wrap, state, { gameId: opts.gameId });
  }

  // ------- Playoffs tab: bracket + matchups (3.4) -------
  // Shows the most recent completed postseason from state.league.postseason.
  // Before the first one exists, a seeding preview built from the live
  // standings shows who'd be in if the season ended today.

  function renderPlayoffs(container, state) {
    // Live bracket while October plays out day by day (0.13.1).
    if (state.postseason) {
      renderLiveBracket(container, state);
      return;
    }
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

  // ---- Live bracket (day-by-day October) -----------------------------------

  const ROUND_LABEL = { wc1: 'WC', wc2: 'WC', ds1: 'DS', ds2: 'DS', lcs: 'LCS', ws: 'WS' };
  function roundOf(tag) { return ROUND_LABEL[tag.split('_').pop()] || tag; }

  function renderLiveBracket(container, state) {
    const ps = state.postseason;
    const done = ps.phase === 'complete';
    const head = U.el('div', { class: 'card' });
    head.appendChild(U.el('div', { class: 'card-title' },
      `${ps.year} Postseason${done ? ' — Complete' : ''}`));
    if (done) {
      const ws = ps.series.find((s) => s.tag === 'ws');
      const champ = state.league.teams.find((t) => t.id === ws.winnerId);
      head.appendChild(U.el('p', { style: { 'font-size': '13px' } },
        `The ${champ ? champ.name : '?'} are World Series champions.`));
    } else {
      head.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        'Advance days to play the bracket. Tap a series for its games.'));
    }
    container.appendChild(head);

    for (const lg of ['east', 'west']) {
      const seedNo = {};
      ps.seeds[lg].forEach((id, i) => { seedNo[id] = i + 1; });
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } },
        `${U.leagueName(lg)} League`));
      const seedsCard = U.el('div', { class: 'card', style: { padding: '8px 12px' } });
      for (const id of ps.seeds[lg]) {
        const t = state.league.teams.find((x) => x.id === id);
        seedsCard.appendChild(U.el('p', { style: { 'font-size': '12px', margin: '2px 0' } },
          `#${seedNo[id]} ${t ? t.name : id} (${t.seasonRecord.w}-${t.seasonRecord.l})` +
          (seedNo[id] <= 2 ? ' — first-round bye' : '')));
      }
      container.appendChild(seedsCard);

      const list = U.el('div', { class: 'roster-list' });
      for (const tag of [`${lg}_wc1`, `${lg}_wc2`, `${lg}_ds1`, `${lg}_ds2`, `${lg}_lcs`]) {
        list.appendChild(liveSeriesRow(state, ps, ps.series.find((s) => s.tag === tag), seedNo));
      }
      container.appendChild(list);
    }
    container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'World Series'));
    const wsList = U.el('div', { class: 'roster-list' });
    wsList.appendChild(liveSeriesRow(state, ps, ps.series.find((s) => s.tag === 'ws'), {}));
    container.appendChild(wsList);
  }

  function liveSeriesRow(state, ps, s, seedNo) {
    const abbrOf = (id) => {
      const t = state.league.teams.find((x) => x.id === id);
      return t ? `${seedNo[id] ? '#' + seedNo[id] + ' ' : ''}${t.abbr}` : 'TBD';
    };
    const row = U.el('button', {
      class: 'roster-row',
      on: { click: () => { if (s.n > 0) showLiveSeriesGames(state, ps, s); } },
    });
    row.appendChild(U.el('span', { class: 'pos-badge' }, roundOf(s.tag)));
    const winner = s.winnerId && state.league.teams.find((t) => t.id === s.winnerId);
    if (winner) row.appendChild(U.teamCap(winner));
    const info = U.el('div', { class: 'player-row-info' });
    let name, meta;
    if (!s.highId || !s.lowId) {
      name = `${abbrOf(s.highId)} vs ${abbrOf(s.lowId)}`;
      meta = 'Matchup to be determined';
    } else if (s.winnerId) {
      name = `${abbrOf(s.winnerId)} def. ${abbrOf(s.loserId)}`;
      meta = 'Series complete • tap for the games';
    } else if (s.n === 0) {
      name = `${abbrOf(s.highId)} vs ${abbrOf(s.lowId)}`;
      meta = s.nextDate ? `Game 1: ${D.format(s.nextDate, 'date')}` : 'Scheduled soon';
    } else {
      const lead = s.hw >= s.lw ? `${abbrOf(s.highId)} ${s.hw}-${s.lw}` : `${abbrOf(s.lowId)} ${s.lw}-${s.hw}`;
      name = `${abbrOf(s.highId)} vs ${abbrOf(s.lowId)}`;
      meta = `${s.hw === s.lw ? 'Tied' : lead + (s.hw === s.lw ? '' : ' lead')} • tap for the games`;
    }
    info.appendChild(U.el('div', { class: 'player-row-name' }, name));
    info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
    row.appendChild(info);
    if (s.n > 0) {
      row.appendChild(U.el('div', { class: 'player-row-stats' }, `${s.hw}-${s.lw}`));
    }
    return row;
  }

  function showLiveSeriesGames(state, ps, s) {
    const games = (ps.games || []).filter((g) => g.postseason === s.tag);
    const body = U.el('div', { class: 'roster-list' });
    games.forEach((g, i) => {
      if (!g.result) return;
      const home = state.league.teams.find((t) => t.id === g.homeId);
      const away = state.league.teams.find((t) => t.id === g.awayId);
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => {
          U.closeModal();
          window.BBGM_MAIN.navigate('league', { tab: 'scores', gameId: g.gameId });
        }},
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, `G${i + 1}`));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${away ? away.abbr : '?'} ${g.result.awayRuns} @ ${home ? home.abbr : '?'} ${g.result.homeRuns}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        D.format(g.date, 'date') + ' • tap for box score'));
      row.appendChild(info);
      body.appendChild(row);
    });
    const high = state.league.teams.find((t) => t.id === s.highId);
    const low = state.league.teams.find((t) => t.id === s.lowId);
    U.showModal({
      title: `${roundOf(s.tag)}: ${high ? high.abbr : '?'} ${s.hw}-${s.lw} ${low ? low.abbr : '?'}`,
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
        // Tap a club for its roster page (the Teams tab folded in here).
        const tr = U.el('div', {
          class: `standings-row${t.id === userTeam.id ? ' highlight' : ''}`,
          style: { cursor: 'pointer' },
          on: { click: () => { viewTeamId = t.id; window.BBGM_MAIN.refresh(); } },
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
