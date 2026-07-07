// Dashboard / Home view
window.BBGM_UI_DASHBOARD = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const S = window.BBGM_STATS;
  const STAND = window.BBGM_STANDINGS;

  function render(container, state) {
    U.clearChildren(container);
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);

    // Team strip
    const strip = U.el('div', {
      class: 'team-strip',
      style: U.teamColorVars(team),
    });
    strip.appendChild(U.teamCap(team, { size: 'lg' }));
    const info = U.el('div');
    info.appendChild(U.el('div', { class: 'team-strip-name' }, team.name));
    info.appendChild(U.el('div', { class: 'team-strip-meta' },
      `${U.divisionLabel(team)} • ${team.market[0].toUpperCase() + team.market.slice(1)} Market`));
    strip.appendChild(info);
    const record = `${team.seasonRecord.w}-${team.seasonRecord.l}`;
    strip.appendChild(U.el('div', { class: 'team-strip-record' }, record));
    container.appendChild(strip);

    // Offseason free-agency card replaces the game-day cards (bible 18.8).
    if (state.meta.offseasonPhase === 'freeAgency') {
      container.appendChild(renderOffseasonCard(state, team));
    } else {
      // Today's status card
      container.appendChild(renderTodayCard(state, team));

      // Quick actions
      container.appendChild(renderQuickActions(state, team));
    }

    // Recent results
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, 'Recent Games'),
    ]));
    container.appendChild(renderRecentResults(state, team));

    // Division standings snippet
    container.appendChild(U.el('div', { class: 'section-header' }, [
      U.el('h3', {}, `${team.division} Division`),
    ]));
    container.appendChild(renderDivisionSnippet(state, team));

    // News feed
    if (state.news && state.news.length > 0) {
      container.appendChild(U.el('div', { class: 'section-header' }, [
        U.el('h3', {}, 'League News'),
      ]));
      container.appendChild(renderNewsFeed(state));
    }
  }

  function renderTodayCard(state, team) {
    const today = state.meta.currentDate;
    const games = state.league.schedule.games || [];

    // Find user team's next/today game
    const userGame = games.find((g) => !g.played && (g.homeId === team.id || g.awayId === team.id));
    let next = null;
    let isToday = false;
    if (userGame) {
      next = userGame;
      isToday = D.eq(userGame.date, today);
    }

    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' },
      isToday ? 'Today' : (next ? 'Next Game' : 'No Upcoming Game')));

    if (next) {
      const isHome = next.homeId === team.id;
      const opp = state.league.teams.find((t) => t.id === (isHome ? next.awayId : next.homeId));
      const row = U.el('div', { class: 'game-line' });
      const left = U.el('div', { class: 'team-line' });
      left.appendChild(U.teamCap(opp));
      left.appendChild(U.el('span', { class: 'name' },
        `${isHome ? 'vs' : '@'} ${opp.name}`));
      row.appendChild(left);
      const date = isToday ? 'Today' : D.format(next.date, 'date');
      row.appendChild(U.el('span', { class: 'score' }, date));
      card.appendChild(row);
      const vsRecord = `${opp.seasonRecord.w}-${opp.seasonRecord.l}`;
      card.appendChild(U.el('div', { class: 'game-card-summary' },
        `${opp.abbr}: ${vsRecord}`));
    } else if (isAfterSeason(state)) {
      card.appendChild(U.el('p', {}, 'Regular season is over.'));
    } else if (isOffseason(state)) {
      card.appendChild(U.el('p', {}, 'Spring training opens soon.'));
    } else {
      card.appendChild(U.el('p', {}, 'No game scheduled today.'));
    }
    return card;
  }

  function renderOffseasonCard(state, team) {
    const card = U.el('div', { class: 'card' });
    const market = state.faMarket || { round: 0, totalRounds: 8, entries: [], userOffers: [] };
    card.appendChild(U.el('div', { class: 'card-title' },
      `Offseason — Free Agency (period ${market.round}/${market.totalRounds})`));
    const unsigned = market.entries.filter((e) => !e.signedTeamId).length;
    const payroll = window.BBGM_FA.computePayroll(team, window.BBGM_STATE.get().players);
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } },
      `${unsigned} free agents on the market • ${market.userOffers.length} offer${market.userOffers.length !== 1 ? 's' : ''} out • ` +
      `payroll $${payroll.toFixed(1)}M of $${team.payrollBase}M`));

    card.appendChild(U.el('button', {
      class: 'btn-primary btn-sm', style: { width: '100%', 'margin-bottom': '8px' },
      on: { click: () => window.BBGM_MAIN.navigate('team', { tab: 'freeagents' }) },
    }, 'Browse Free Agents'));
    const grid = U.el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.advanceFAPeriod() },
    }, 'Advance FA Period ▶'));
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.navigate('team', { tab: 'trades' }) },
    }, 'Trade Center'));
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 100%' },
      on: { click: () => {
        U.showModal({
          title: 'Start the Season?',
          body: 'Any remaining free agents resolve automatically, spring training sets lineups, and Opening Day arrives.',
          actions: [
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
            { label: 'Start Season', kind: 'primary', onClick: () => {
              setTimeout(() => window.BBGM_MAIN.startSeasonFlow(window.BBGM_STATE.get()), 50);
              return true;
            }},
          ],
        });
      }},
    }, 'Finish Offseason & Start Season'));
    card.appendChild(grid);
    return card;
  }

  function renderQuickActions(state, team) {
    const card = U.el('div', { class: 'card', style: { padding: '12px' } });

    // Prominent full-width "Simulate Season" button — useful for quickly
    // generating full-season stats while testing.
    card.appendChild(U.el('button', {
      class: 'btn-primary btn-sm',
      style: { width: '100%', 'margin-bottom': '8px' },
      on: { click: () => window.BBGM_MAIN.simToSeasonEnd() }
    }, 'Simulate Season ▶▶'));

    const grid = U.el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.simToNextEvent() }
    }, 'Sim 7 Days'));
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.simToEndOfMonth() }
    }, 'Sim to End of Month'));
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.navigate('team') }
    }, 'View Roster'));
    grid.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
      on: { click: () => window.BBGM_MAIN.navigate('league') }
    }, 'Standings'));
    card.appendChild(grid);
    return card;
  }

  function renderRecentResults(state, team) {
    const games = (state.league.schedule.games || [])
      .filter((g) => g.played && (g.homeId === team.id || g.awayId === team.id))
      .slice(-5)
      .reverse();
    if (games.length === 0) {
      return U.el('div', { class: 'empty-state' }, 'No games played yet.');
    }
    const list = U.el('div', { class: 'roster-list' });
    for (const g of games) {
      const isHome = g.homeId === team.id;
      const opp = state.league.teams.find((t) => t.id === (isHome ? g.awayId : g.homeId));
      const ourRuns = isHome ? g.result.homeRuns : g.result.awayRuns;
      const oppRuns = isHome ? g.result.awayRuns : g.result.homeRuns;
      const won = ourRuns > oppRuns;
      const row = U.el('button', {
        class: 'roster-row',
        on: { click: () => window.BBGM_MAIN.navigate('games', { gameId: g.gameId }) },
      });
      row.appendChild(U.el('span', { class: 'pos-badge' }, won ? 'W' : 'L'));
      const info = U.el('div', { class: 'player-row-info' });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${isHome ? 'vs' : '@'} ${opp.name}`));
      info.appendChild(U.el('div', { class: 'player-row-meta' }, D.format(g.date, 'date')));
      row.appendChild(info);
      const stats = U.el('div', { class: 'player-row-stats' },
        `${ourRuns}-${oppRuns}`);
      row.appendChild(stats);
      list.appendChild(row);
    }
    return list;
  }

  function renderDivisionSnippet(state, team) {
    const standings = STAND.buildStandings(state);
    const myDiv = standings.find((s) => s.league === team.league && s.division === team.division);
    const card = U.el('div', { class: 'standings-card' });
    const head = U.el('div', { class: 'standings-row head' });
    head.appendChild(U.el('div', { class: 'col-team' }, 'Team'));
    head.appendChild(U.el('div', { class: 'col-num' }, 'W'));
    head.appendChild(U.el('div', { class: 'col-num' }, 'L'));
    head.appendChild(U.el('div', { class: 'col-num' }, 'PCT'));
    head.appendChild(U.el('div', { class: 'col-num' }, 'GB'));
    head.appendChild(U.el('div', { class: 'col-num' }, 'L10'));
    card.appendChild(head);

    for (const row of myDiv.teams) {
      const t = row.team;
      const tr = U.el('div', {
        class: `standings-row${t.id === team.id ? ' highlight' : ''}`,
        on: { click: () => window.BBGM_MAIN.navigate('league') },
      });
      const tc = U.el('div', { class: 'col-team' });
      tc.appendChild(U.teamCap(t));
      tc.appendChild(U.el('span', { class: 'name' }, t.abbr));
      tr.appendChild(tc);
      tr.appendChild(U.el('div', { class: 'col-num wins' }, String(t.seasonRecord.w)));
      tr.appendChild(U.el('div', { class: 'col-num' }, String(t.seasonRecord.l)));
      tr.appendChild(U.el('div', { class: 'col-num' }, fmtPct(row.wp)));
      tr.appendChild(U.el('div', { class: 'col-num' }, row.gb === 0 ? '—' : row.gb.toFixed(1)));
      const last10 = lastTenStr(t);
      tr.appendChild(U.el('div', { class: 'col-num' }, last10));
      card.appendChild(tr);
    }
    return card;
  }

  function renderNewsFeed(state) {
    const list = U.el('div', { class: 'news-list' });
    const recent = state.news.slice(-12).reverse();
    for (const n of recent) {
      const item = U.el('div', { class: 'news-item' });
      item.appendChild(U.el('div', { class: 'date' }, D.format(n.date, 'date')));
      item.appendChild(U.el('div', { class: 'body', html: n.body }));
      list.appendChild(item);
    }
    return list;
  }

  function fmtPct(v) {
    return v.toFixed(3).replace(/^0/, '');
  }

  function lastTenStr(team) {
    const lt = team.seasonRecord.lastTen || [];
    const w = lt.filter((x) => x === 'W').length;
    const l = lt.filter((x) => x === 'L').length;
    return `${w}-${l}`;
  }

  function isOffseason(state) {
    const today = state.meta.currentDate;
    const month = today.month;
    return month >= 11 || month <= 2;
  }

  function isAfterSeason(state) {
    const today = state.meta.currentDate;
    const end = state.league.schedule.seasonEnd;
    return D.compare(today, end) > 0;
  }

  return { render };
})();
