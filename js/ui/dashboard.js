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

    // Draft callouts (bible 13/18.12): a hero card on draft day, a quieter
    // nudge while the class is scoutable in May-June.
    const draftCard = renderDraftCallout(state);
    if (draftCard) container.appendChild(draftCard);

    // Offseason free-agency card replaces the game-day cards (bible 18.8).
    if (state.meta.offseasonPhase === 'freeAgency') {
      container.appendChild(renderOffseasonCard(state, team));
    } else if (state.postseason) {
      // October: the live bracket drives the dashboard.
      container.appendChild(renderPostseasonCard(state, team));
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

  function renderDraftCallout(state) {
    const DRAFT = window.BBGM_DRAFT;
    const today = state.meta.currentDate;
    // International signing day outranks everything (July 2 sim halt).
    if (window.BBGM_INTL.windowPending(state, today)) {
      const card = U.el('div', { class: 'card' });
      card.appendChild(U.el('div', { class: 'card-title' }, `🌎 International Signing Day — ${today.year}`));
      card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
        'The July 2 window is open. The season resumes once it closes.'));
      card.appendChild(U.el('button', {
        class: 'btn-primary btn-sm', style: { width: '100%' },
        on: { click: () => window.BBGM_MAIN.navigate('draft', { tab: 'intl' }) },
      }, 'Open the Signing Window'));
      return card;
    }
    const draft = state.draft;
    if (!draft || draft.year !== today.year || draft.phase === 'complete') return null;
    const card = U.el('div', { class: 'card' });
    if (DRAFT.draftDayPending(state, today)) {
      card.appendChild(U.el('div', { class: 'card-title' }, `⚾ Draft Day — ${draft.year}`));
      card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '8px' } },
        'The NABL Amateur Draft is today. The season resumes once the draft is complete.'));
      card.appendChild(U.el('button', {
        class: 'btn-primary btn-sm', style: { width: '100%' },
        on: { click: () => window.BBGM_MAIN.navigate('draft') },
      }, 'Go to the Draft Hub'));
    } else {
      const daysOut = D.diffDays(today, D.fromYMD(draft.year, 6, 30));
      card.appendChild(U.el('div', { class: 'card-title' }, `${draft.year} Draft — ${daysOut} days out`));
      card.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { width: '100%' },
        on: { click: () => window.BBGM_MAIN.navigate('draft') },
      }, 'Scout the Class in the Draft Hub'));
    }
    return card;
  }

  // Live postseason (bible 3.4, day-by-day since 0.13.1).
  function renderPostseasonCard(state, team) {
    const ps = state.postseason;
    const card = U.el('div', { class: 'card' });
    const done = ps.phase === 'complete';
    card.appendChild(U.el('div', { class: 'card-title' },
      done ? `${ps.year} Postseason — Complete` : `${ps.year} Postseason`));

    if (done) {
      const ws = ps.series.find((s) => s.tag === 'ws');
      const champ = state.league.teams.find((t) => t.id === ws.winnerId);
      card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } },
        `The ${champ ? champ.name : '?'} are World Series champions. Begin the offseason when ready.`));
      card.appendChild(U.el('button', {
        class: 'btn-primary btn-sm', style: { width: '100%', 'margin-bottom': '8px' },
        on: { click: () => window.BBGM_MAIN.advanceDay() },
      }, 'Begin the Offseason'));
    } else {
      // User's live series, if they're still playing.
      const mine = ps.series.find((s) => !s.winnerId &&
        (s.highId === team.id || s.lowId === team.id));
      const wasIn = ps.seeds.east.concat(ps.seeds.west).includes(team.id);
      let line;
      if (mine) {
        const opp = state.league.teams.find((t) => t.id === (mine.highId === team.id ? mine.lowId : mine.highId));
        const ourWins = mine.highId === team.id ? mine.hw : mine.lw;
        const theirWins = mine.highId === team.id ? mine.lw : mine.hw;
        line = opp
          ? `Your series: ${ourWins}-${theirWins} vs ${opp.name}.`
          : 'Awaiting your next opponent.';
      } else if (wasIn) {
        const lost = ps.series.find((s) => s.loserId === team.id);
        line = lost ? 'Your season is over — eliminated. October plays on.' : 'You have a first-round bye — next round soon.';
      } else {
        line = 'You missed the field — scoreboard-watch October and plan the winter.';
      }
      card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } }, line));
      const grid = U.el('div', { style: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } });
      grid.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
        on: { click: () => window.BBGM_MAIN.navigate('league', { tab: 'playoffs' }) },
      }, 'View Bracket'));
      grid.appendChild(U.el('button', {
        class: 'btn-primary btn-sm', style: { flex: '1 1 calc(50% - 4px)' },
        on: { click: () => window.BBGM_MAIN.simToSeasonEnd() },
      }, 'Sim Rest of Postseason ▶▶'));
      card.appendChild(grid);
    }
    return card;
  }

  function renderOffseasonCard(state, team) {
    const card = U.el('div', { class: 'card' });
    const market = state.faMarket || { round: 0, totalRounds: 8, entries: [], userOffers: [] };
    const year = (state.arb && state.arb.year) || state.meta.currentDate.year;
    card.appendChild(U.el('div', { class: 'card-title' },
      `Offseason ${year}-${String((year + 1) % 100).padStart(2, '0')}`));

    // The offseason calendar (18.1): done, live, and upcoming phases.
    const season = (state.history.seasons || [])[state.history.seasons.length - 1];
    const champ = season && state.league.teams.find((t) => t.id === season.championId);
    const aw = state.history.awards && state.history.awards[year];
    const mvps = aw ? ['east', 'west']
      .map((lg) => (aw[lg] && aw[lg].mvp ? aw[lg].mvp.winner.name : null))
      .filter(Boolean).join(' / ') : null;
    const hof = state.history.hof && state.history.hof[year];
    const arb = (state.arb && state.arb.year === year && state.arb.cases.length) ? state.arb : null;
    const tendered = arb ? arb.cases.filter((c) => c.decision === 'tendered').length : 0;
    const unsigned = market.entries.filter((e) => !e.signedTeamId).length;

    const calRow = (mark, label, detail, onClick) => {
      const row = U.el(onClick ? 'button' : 'div', {
        class: 'inset-row', style: { width: '100%', 'text-align': 'left' },
        ...(onClick ? { on: { click: onClick } } : {}),
      });
      row.appendChild(U.el('span', { class: 'label' }, `${mark} ${label}`));
      row.appendChild(U.el('span', { class: 'value', style: { 'font-size': '12px' } }, detail));
      return row;
    };
    const cal = U.el('div', { class: 'inset-list', style: { 'margin-bottom': '10px' } });
    if (champ) cal.appendChild(calRow('✓', 'World Series', champ.abbr + ' win it all'));
    cal.appendChild(calRow('✓', 'Awards week', mvps ? `MVPs: ${mvps}` : '—',
      () => window.BBGM_MAIN.navigate('players', { tab: 'awards' })));
    cal.appendChild(calRow('✓', 'Hall of Fame vote',
      hof ? (hof.inducted.length ? hof.inducted.map((i) => i.name).join(', ') : 'no one elected') : '—',
      () => window.BBGM_MAIN.navigate('players', { tab: 'awards' })));
    cal.appendChild(calRow('✓', 'Winter meetings', 'staff & scouting decisions open',
      () => window.BBGM_MAIN.navigate('gm', { tab: 'staff' })));
    if (arb) {
      cal.appendChild(calRow('◆', 'Arbitration',
        `${tendered} tendered${arb.cases.length - tendered ? `, ${arb.cases.length - tendered} non-tendered` : ''}`,
        () => showArbModal(state)));
    }
    cal.appendChild(calRow('◆', 'Free agency',
      `period ${market.round}/${market.totalRounds} • ${unsigned} unsigned`,
      () => window.BBGM_MAIN.navigate('gm', { tab: 'freeagents' })));
    cal.appendChild(calRow('○', 'Spring training', 'position battles resolve at Opening Day'));
    card.appendChild(cal);

    const payroll = window.BBGM_FA.computePayroll(team, window.BBGM_STATE.get().players);
    card.appendChild(U.el('p', { style: { 'font-size': '13px', 'margin-bottom': '10px' } },
      `${unsigned} free agents on the market • ${market.userOffers.length} offer${market.userOffers.length !== 1 ? 's' : ''} out • ` +
      `payroll $${payroll.toFixed(1)}M of $${team.payrollBase}M`));

    if (arb && tendered > 0) {
      card.appendChild(U.el('button', {
        class: 'btn-secondary btn-sm', style: { width: '100%', 'margin-bottom': '8px' },
        on: { click: () => showArbModal(state) },
      }, `Review Arbitration (${arb.cases.length})`));
    }

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

  // Arbitration review (18.7): every case is tendered by default; the
  // user can non-tender a raise he doesn't want to pay — the player joins
  // the open FA market immediately.
  function showArbModal(state) {
    const S = window.BBGM_STATS;
    const arb = state.arb;
    if (!arb || !arb.cases.length) return;
    const year = arb.year;
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'Players with 3-5 years of service get automatic arbitration raises. ' +
      'Tendered contracts stand unless you non-tender — the player becomes a free agent immediately.'));
    const list = U.el('div', { class: 'roster-list' });
    for (const c of arb.cases) {
      const p = state.players[c.playerId];
      if (!p) continue;
      const row = U.el('div', { class: 'roster-row', style: { 'flex-wrap': 'wrap', gap: '6px' } });
      const info = U.el('div', { class: 'player-row-info', style: { flex: '1 1 60%' } });
      info.appendChild(U.el('div', { class: 'player-row-name' },
        `${p.name} (${p.primaryPosition}, ${p.age})`));
      const s = p.stats && p.stats[year];
      let line = '';
      if (s && p.isPitcher && (s.ipOuts || 0) > 0) {
        line = `${s.w}-${s.l}, ${S.era(s).toFixed(2)} ERA, ${S.fmtIP(s.ipOuts)} IP`;
      } else if (s && !p.isPitcher && (s.pa || 0) > 0) {
        line = `${S.fmtAvg(S.avg(s))}/${s.hr} HR/${s.rbi} RBI`;
      }
      info.appendChild(U.el('div', { class: 'player-row-meta' },
        `${line ? line + ' • ' : ''}arb salary $${c.salary}M`));
      row.appendChild(info);
      if (c.decision === 'tendered') {
        row.appendChild(U.el('button', {
          class: 'btn-secondary btn-sm', style: { color: 'var(--danger, #e25c5c)' },
          on: { click: () => {
            const result = window.BBGM_OFFSEASON.nonTenderPlayer(state, c.playerId);
            if (!result) { U.showToast('Non-tender window has closed.', 'warning'); return; }
            if (!state.news) state.news = [];
            state.news.push({
              date: { ...state.meta.currentDate },
              body: `You non-tender <strong>${result.player.name}</strong> — ` +
                    `he joins the free-agent market` +
                    (result.entry ? ` seeking ${result.entry.askYears} yr / $${result.entry.askTotal}M` : '') + `.`,
            });
            window.BBGM_STATE.set(state);
            U.showToast(`${result.player.name} non-tendered.`, 'info');
            showArbModal(state); // re-render with the updated decision
          }},
        }, 'Non-Tender'));
      } else {
        row.appendChild(U.el('span', { class: 'player-row-meta' }, 'Non-tendered — on the market'));
      }
      list.appendChild(row);
    }
    body.appendChild(list);
    U.showModal({
      title: `Arbitration — ${arb.cases.length} case${arb.cases.length !== 1 ? 's' : ''}`,
      body,
      actions: [{ label: 'Done', kind: 'primary', onClick: () => { window.BBGM_MAIN.refresh(); return true; } }],
    });
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
        // Deep-link straight to the club's roster page.
        on: { click: () => window.BBGM_MAIN.navigate('league', { tab: 'standings', teamId: t.id }) },
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
