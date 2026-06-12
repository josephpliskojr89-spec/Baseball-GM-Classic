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

  // Game Detail view (bible 20.6.4): header, line score, batting and
  // pitching box scores, team totals, and the AB-by-AB game log (collapsed
  // by default). Opens from every completed-game tap target.
  function showBoxScore(state, gameId) {
    const game = state.league.schedule.games.find((g) => g.gameId === gameId);
    if (!game || !game.played) return;
    const home = state.league.teams.find((t) => t.id === game.homeId);
    const away = state.league.teams.find((t) => t.id === game.awayId);
    const r = game.result;
    const body = U.el('div');

    // ---- Header ----
    const homeWon = r.homeRuns > r.awayRuns;
    const scoreLine = U.el('div', { style: { 'margin-bottom': '12px' } });
    for (const [team, runs, won] of [[away, r.awayRuns, !homeWon], [home, r.homeRuns, homeWon]]) {
      scoreLine.appendChild(U.el('div', { class: 'boxscore-team', style: won ? {} : { opacity: '0.75' } }, [
        U.teamCap(team),
        U.el('span', { style: { 'margin-left': '8px' } }, team.name),
        U.el('span', { class: 'score' }, String(runs)),
      ]));
    }
    const meta = [D.format(game.date)];
    if (r.innings && r.innings !== 9) meta.push(`${r.innings} innings`);
    scoreLine.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '12px' } }, meta.join(' • ')));
    body.appendChild(scoreLine);

    // ---- Line score ----
    if (r.lineScore && r.lineScore.away && r.lineScore.away.length) {
      body.appendChild(buildLineScore(r, away, home));
    }

    // ---- Decisions ----
    const decisions = [];
    const nameOf = (pid) => (pid && state.players[pid]) ? state.players[pid].name : null;
    const wp = nameOf(r.homeWP || r.awayWP);
    const lp = nameOf(r.homeLP || r.awayLP);
    const sv = nameOf(r.saveP);
    if (wp) decisions.push(`W: ${wp}`);
    if (lp) decisions.push(`L: ${lp}`);
    if (sv) decisions.push(`SV: ${sv}`);
    if (decisions.length) {
      body.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '13px', 'margin-bottom': '12px' } },
        decisions.join('  •  ')));
    }

    // ---- Box scores ----
    if (r.box) {
      for (const [team, side] of [[away, r.box.away], [home, r.box.home]]) {
        body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, `${team.name} Batting`));
        body.appendChild(buildBattingTable(state, side.batters));
        body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '10px' } }, `${team.name} Pitching`));
        body.appendChild(buildPitchingTable(state, side.pitchers, r));
      }
    }

    // ---- AB-by-AB game log (collapsed by default) ----
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, 'Game Log'));
    if (r.gameLog && r.gameLog.length) {
      body.appendChild(buildGameLog(state, r, away, home));
    } else {
      body.appendChild(U.el('div', { class: 'empty-state', style: { padding: '12px' } },
        'Detailed log not retained for this game.'));
    }

    U.showModal({
      title: `${away.abbr} @ ${home.abbr}`,
      body,
      actions: [
        { label: 'Close', kind: 'primary', onClick: () => true },
      ],
    });
  }

  function buildLineScore(r, away, home) {
    const innings = Math.max(r.lineScore.away.length, r.lineScore.home.length);
    const wrap = U.el('div', { class: 'stats-scroll', style: { 'margin-bottom': '10px' } });
    const table = U.el('table', { class: 'stats-table' });
    const thead = U.el('thead');
    const trh = U.el('tr');
    trh.appendChild(U.el('th', {}, ''));
    for (let i = 1; i <= innings; i++) trh.appendChild(U.el('th', {}, String(i)));
    trh.appendChild(U.el('th', {}, 'R'));
    trh.appendChild(U.el('th', {}, 'H'));
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = U.el('tbody');
    for (const [team, line, runs, hits] of [
      [away, r.lineScore.away, r.awayRuns, r.awayHits],
      [home, r.lineScore.home, r.homeRuns, r.homeHits],
    ]) {
      const tr = U.el('tr');
      tr.appendChild(U.el('td', {}, team.abbr));
      for (let i = 0; i < innings; i++) {
        tr.appendChild(U.el('td', {}, line[i] != null ? String(line[i]) : '—'));
      }
      tr.appendChild(U.el('td', { style: { 'font-weight': '700' } }, String(runs)));
      tr.appendChild(U.el('td', {}, String(hits != null ? hits : '—')));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Box batter row layout (see simulation.js boxFor):
  //   [pid, ab, r, h, b2, b3, hr, rbi, bb, k, sb]
  function buildBattingTable(state, batters) {
    const wrap = U.el('div', { class: 'stats-scroll' });
    const table = U.el('table', { class: 'stats-table' });
    const thead = U.el('thead');
    const trh = U.el('tr');
    for (const h of ['Batter', 'AB', 'R', 'H', 'RBI', 'BB', 'K', 'AVG']) trh.appendChild(U.el('th', {}, h));
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = U.el('tbody');
    const totals = { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, k: 0 };
    for (const row of batters) {
      const [pid, ab, runs, hits, b2, b3, hr, rbi, bb, k] = row;
      const p = state.players[pid];
      if (!p) continue;
      totals.ab += ab; totals.r += runs; totals.h += hits; totals.rbi += rbi; totals.bb += bb; totals.k += k;
      const season = p.stats[state.meta.currentDate.year];
      const tr = U.el('tr');
      const extras = [];
      if (b2) extras.push(`${b2}·2B`);
      if (b3) extras.push(`${b3}·3B`);
      if (hr) extras.push(`${hr}·HR`);
      tr.appendChild(U.el('td', {}, `${p.primaryPosition} ${p.name}${extras.length ? ' (' + extras.join(', ') + ')' : ''}`));
      tr.appendChild(U.el('td', {}, String(ab)));
      tr.appendChild(U.el('td', {}, String(runs)));
      tr.appendChild(U.el('td', {}, String(hits)));
      tr.appendChild(U.el('td', {}, String(rbi)));
      tr.appendChild(U.el('td', {}, String(bb)));
      tr.appendChild(U.el('td', {}, String(k)));
      tr.appendChild(U.el('td', {}, season ? S.fmtAvg(S.avg(season)) : '—'));
      tbody.appendChild(tr);
    }
    // Team totals row
    const tt = U.el('tr', { style: { 'font-weight': '700' } });
    tt.appendChild(U.el('td', {}, 'Totals'));
    for (const k of ['ab', 'r', 'h', 'rbi', 'bb', 'k']) tt.appendChild(U.el('td', {}, String(totals[k])));
    tt.appendChild(U.el('td', {}, ''));
    tbody.appendChild(tt);
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Box pitcher row layout: [pid, ipOuts, h, r, er, bb, k, hr]
  function buildPitchingTable(state, pitchers, r) {
    const wrap = U.el('div', { class: 'stats-scroll' });
    const table = U.el('table', { class: 'stats-table' });
    const thead = U.el('thead');
    const trh = U.el('tr');
    for (const h of ['Pitcher', 'IP', 'H', 'R', 'ER', 'BB', 'K', 'ERA']) trh.appendChild(U.el('th', {}, h));
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = U.el('tbody');
    for (const row of pitchers) {
      const [pid, ipOuts, h, runs, er, bb, k] = row;
      const p = state.players[pid];
      if (!p) continue;
      const tags = [];
      if (pid === r.homeWP || pid === r.awayWP) tags.push('W');
      if (pid === r.homeLP || pid === r.awayLP) tags.push('L');
      if (pid === r.saveP) tags.push('SV');
      if ((r.hldPids || []).includes(pid)) tags.push('H');
      if ((r.bsPids || []).includes(pid)) tags.push('BS');
      const season = p.stats[state.meta.currentDate.year];
      const tr = U.el('tr');
      tr.appendChild(U.el('td', {}, `${p.name}${tags.length ? ' (' + tags.join(', ') + ')' : ''}`));
      tr.appendChild(U.el('td', {}, S.fmtIP(ipOuts)));
      tr.appendChild(U.el('td', {}, String(h)));
      tr.appendChild(U.el('td', {}, String(runs)));
      tr.appendChild(U.el('td', {}, String(er)));
      tr.appendChild(U.el('td', {}, String(bb)));
      tr.appendChild(U.el('td', {}, String(k)));
      tr.appendChild(U.el('td', {}, season && season.ipOuts ? S.era(season).toFixed(2) : '—'));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Game log entry layout (see simulation.js logPlay):
  //   [inning, half, batter/runner id, pitcher id, outs before, base mask,
  //    code, rbi, away score after, home score after]
  const PLAY_TEXT = {
    '1B': 'Single', '2B': 'Double', '3B': 'Triple', 'HR': 'Home Run',
    'BB': 'Walk', 'HBP': 'Hit by Pitch', 'K': 'Strikeout', 'OUT': 'Out',
    'SF': 'Sacrifice Fly', 'GIDP': 'Grounded into Double Play',
    'SB': 'Stolen Base', 'CS': 'Caught Stealing',
  };

  function buildGameLog(state, r, away, home) {
    const details = U.el('details');
    details.appendChild(U.el('summary', {
      style: { cursor: 'pointer', color: 'var(--accent)', 'font-size': '13px', 'font-weight': '600', padding: '6px 0' },
    }, `Show at-bat by at-bat log (${r.gameLog.length} plays)`));

    const list = U.el('div', { style: { 'font-size': '12px', 'line-height': '1.5' } });
    let lastHalf = '';
    for (const e of r.gameLog) {
      const [inning, half, batterId, pitcherId, outsBefore, mask, code, rbi, as, hs] = e;
      const halfKey = `${half}-${inning}`;
      if (halfKey !== lastHalf) {
        lastHalf = halfKey;
        const battingTeam = half === 0 ? away : home;
        list.appendChild(U.el('div', {
          style: { 'font-weight': '700', 'margin-top': '8px', color: 'var(--text-primary)' },
        }, `${half === 0 ? 'Top' : 'Bottom'} ${ordinal(inning)} — ${battingTeam.abbr} batting`));
      }
      const batter = state.players[batterId];
      const text = PLAY_TEXT[code] || code;
      let line = `${batter ? batter.name : '??'} — ${text}`;
      if (rbi > 0) line += `, ${rbi} RBI`;
      line += ` (${as}-${hs})`;
      list.appendChild(U.el('div', { class: 'muted' }, line));
    }
    details.appendChild(list);
    return details;
  }

  function ordinal(n) {
    if (n % 10 === 1 && n !== 11) return `${n}st`;
    if (n % 10 === 2 && n !== 12) return `${n}nd`;
    if (n % 10 === 3 && n !== 13) return `${n}rd`;
    return `${n}th`;
  }

  return { render, showBoxScore };
})();
