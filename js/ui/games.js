// Games view: today's games, recent box scores, schedule
window.BBGM_UI_GAMES = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const S = window.BBGM_STATS;

  let activeTab = 'today';

  function render(container, state, options = {}) {
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Games'));

    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'today', label: 'Today' },
      { key: 'recent', label: 'Recent' },
      { key: 'schedule', label: 'Schedule' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } }
      }, t.label));
    }
    container.appendChild(tabs);

    if (options.gameId) {
      activeTab = 'recent';
      showBoxScore(state, options.gameId);
    }

    if (activeTab === 'today') renderToday(container, state);
    else if (activeTab === 'recent') renderRecent(container, state);
    else if (activeTab === 'schedule') renderSchedule(container, state);
  }

  function renderToday(container, state) {
    const today = state.meta.currentDate;
    const games = state.league.schedule.games.filter((g) => D.eq(g.date, today));
    if (games.length === 0) {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'No games scheduled today.'));
      return;
    }
    // Sort: user team first
    const userTeamId = state.meta.userTeamId;
    games.sort((a, b) => {
      const aUser = a.homeId === userTeamId || a.awayId === userTeamId;
      const bUser = b.homeId === userTeamId || b.awayId === userTeamId;
      return (bUser ? 1 : 0) - (aUser ? 1 : 0);
    });
    for (const g of games) {
      container.appendChild(gameCard(state, g));
    }
  }

  function renderRecent(container, state) {
    const userTeamId = state.meta.userTeamId;
    const games = state.league.schedule.games.filter((g) => g.played && (g.homeId === userTeamId || g.awayId === userTeamId));
    if (games.length === 0) {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'No games played yet.'));
      return;
    }
    const recent = games.slice(-20).reverse();
    for (const g of recent) {
      container.appendChild(gameCard(state, g));
    }
  }

  function renderSchedule(container, state) {
    const userTeamId = state.meta.userTeamId;
    const games = state.league.schedule.games.filter((g) => g.homeId === userTeamId || g.awayId === userTeamId);
    const today = state.meta.currentDate;
    const upcoming = games.filter((g) => !g.played && D.compare(g.date, today) >= 0).slice(0, 30);
    if (upcoming.length === 0) {
      container.appendChild(U.el('div', { class: 'empty-state' }, 'No upcoming games.'));
      return;
    }
    const list = U.el('div', { class: 'schedule-list' });
    for (const g of upcoming) {
      const isHome = g.homeId === userTeamId;
      const opp = state.league.teams.find((t) => t.id === (isHome ? g.awayId : g.homeId));
      const row = U.el('div', { class: 'sched-row' });
      const day = U.el('div', { class: 'day' });
      day.appendChild(U.el('span', {}, D.dayName(g.date)));
      day.appendChild(U.el('span', { class: 'num' }, String(g.date.day)));
      day.appendChild(U.el('span', {}, D.MONTHS_SHORT[g.date.month - 1]));
      row.appendChild(day);
      const matchup = U.el('div', { class: 'matchup-line' });
      matchup.appendChild(U.el('span', { class: 'home-away' }, isHome ? 'vs' : '@'));
      matchup.appendChild(U.el('span', {}, `${opp.abbr} ${opp.name}`));
      row.appendChild(matchup);
      const meta = U.el('div', { style: { 'font-size': '11px', color: 'var(--text-muted)' } },
        `${opp.seasonRecord.w}-${opp.seasonRecord.l}`);
      row.appendChild(meta);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  function gameCard(state, g) {
    const home = state.league.teams.find((t) => t.id === g.homeId);
    const away = state.league.teams.find((t) => t.id === g.awayId);
    const card = U.el('button', {
      class: 'game-card',
      on: { click: () => g.played ? showBoxScore(state, g.gameId) : null },
    });
    const matchup = U.el('div', { class: 'matchup' });
    const homeWon = g.played && g.result.homeRuns > g.result.awayRuns;
    const awayLine = U.el('div', { class: `game-line${g.played ? (homeWon ? ' loss' : ' win') : ''}` });
    const aLine = U.el('div', { class: 'team-line' });
    aLine.appendChild(U.teamCap(away));
    aLine.appendChild(U.el('span', { class: 'name' }, away.name));
    awayLine.appendChild(aLine);
    awayLine.appendChild(U.el('span', { class: 'score' },
      g.played ? String(g.result.awayRuns) : '—'));
    matchup.appendChild(awayLine);

    const homeLine = U.el('div', { class: `game-line${g.played ? (homeWon ? ' win' : ' loss') : ''}` });
    const hLine = U.el('div', { class: 'team-line' });
    hLine.appendChild(U.teamCap(home));
    hLine.appendChild(U.el('span', { class: 'name' }, home.name));
    homeLine.appendChild(hLine);
    homeLine.appendChild(U.el('span', { class: 'score' },
      g.played ? String(g.result.homeRuns) : '—'));
    matchup.appendChild(homeLine);

    card.appendChild(matchup);

    const status = U.el('div', { class: 'game-status' });
    if (g.played) {
      status.appendChild(U.el('span', {}, 'Final'));
      if (g.result.innings && g.result.innings > 9) {
        status.appendChild(U.el('span', { style: { display: 'block', 'font-size': '10px' } },
          `${g.result.innings} inn`));
      }
    } else {
      status.appendChild(U.el('span', {}, D.format(g.date, 'date')));
    }
    card.appendChild(status);
    return card;
  }

  function showBoxScore(state, gameId) {
    const game = state.league.schedule.games.find((g) => g.gameId === gameId);
    if (!game || !game.played) return;
    const home = state.league.teams.find((t) => t.id === game.homeId);
    const away = state.league.teams.find((t) => t.id === game.awayId);
    const body = U.el('div');

    // Score line
    const scoreLine = U.el('div', { style: { 'margin-bottom': '12px' } });
    scoreLine.appendChild(U.el('div', { class: 'boxscore-team' }, [
      U.teamCap(away),
      U.el('span', { style: { 'margin-left': '8px' } }, away.name),
      U.el('span', { class: 'score' }, String(game.result.awayRuns)),
    ]));
    scoreLine.appendChild(U.el('div', { class: 'boxscore-team' }, [
      U.teamCap(home),
      U.el('span', { style: { 'margin-left': '8px' } }, home.name),
      U.el('span', { class: 'score' }, String(game.result.homeRuns)),
    ]));
    if (game.result.innings && game.result.innings !== 9) {
      scoreLine.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
        `${game.result.innings} innings • ${away.abbr} ${game.result.awayHits} H, ${home.abbr} ${game.result.homeHits} H`));
    } else {
      scoreLine.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } },
        `${away.abbr} ${game.result.awayHits || '-'} H, ${home.abbr} ${game.result.homeHits || '-'} H`));
    }
    body.appendChild(scoreLine);

    // Pitcher decisions
    if (game.result.homeWP || game.result.awayWP) {
      const pitchers = U.el('div', { style: { 'font-size': '13px', 'margin-bottom': '10px' } });
      const wp = game.result.homeWP || game.result.awayWP;
      const lp = game.result.homeLP || game.result.awayLP;
      const sv = game.result.saveP;
      const wpP = wp ? state.players[wp] : null;
      const lpP = lp ? state.players[lp] : null;
      const svP = sv ? state.players[sv] : null;
      if (wpP) pitchers.appendChild(U.el('div', { class: 'muted' }, `WP: ${wpP.name}`));
      if (lpP) pitchers.appendChild(U.el('div', { class: 'muted' }, `LP: ${lpP.name}`));
      if (svP) pitchers.appendChild(U.el('div', { class: 'muted' }, `SV: ${svP.name}`));
      body.appendChild(pitchers);
    }

    U.showModal({
      title: `${away.abbr} @ ${home.abbr}`,
      body,
      actions: [
        { label: 'Close', kind: 'primary', onClick: () => true },
      ],
    });
  }

  return { render, showBoxScore };
})();
