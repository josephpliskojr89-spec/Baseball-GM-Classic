// Players view: league-wide player browsing — season stat tables, league
// leaders, and the awards wing (season hardware, Hall of Fame, All-Star).
// Split out of the League tab in 0.16.1 so neither tab bar is cramped:
// League keeps the competition (scores/standings/playoffs/history);
// everything player-centric lives here.
window.BBGM_UI_PLAYERS = (function () {
  const U = window.BBGM_UI;
  const S = window.BBGM_STATS;

  let activeTab = 'stats';

  function render(container, state, opts = {}) {
    if (opts.tab) activeTab = opts.tab;
    if (opts.statsTeamId) { statsTeamId = opts.statsTeamId; }
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Players'));
    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'stats', label: 'Stats' },
      { key: 'leaders', label: 'Leaders' },
      { key: 'awards', label: 'Awards' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } },
      }, t.label));
    }
    container.appendChild(tabs);

    if (activeTab === 'stats') renderStatsPage(container, state);
    else if (activeTab === 'leaders') renderLeaders(container, state);
    else renderAwards(container, state);
  }

  // ------- Stats: sortable season tables for any club (0.15.1) -------

  let statsTeamId = null;  // defaults to the user's team
  let statsMode = 'hitting';
  let statsSort = null;    // { key, dir }

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
        style: { cursor: 'pointer', ...(active ? { color: 'var(--chrome-primary, var(--accent, #58a6ff))' } : {}) },
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

  // ------- Leaders: league-wide top-10 boards -------

  function renderLeaders(container, state) {
    const players = Object.values(state.players);
    const year = state.meta.currentDate.year;

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

  // ------- Awards (bible 19): season hardware, Hall of Fame, All-Star -------

  let awardsMode = 'season';   // 'season' | 'hof' | 'allstar'
  let awardsYear = null;       // season-awards year picker
  let allStarYear = null;      // all-star year picker

  function playerRow(state, id, name, meta, opts = {}) {
    const p = state.players[id];
    const row = U.el(p ? 'button' : 'div', {
      class: 'roster-row',
      ...(p ? { on: { click: () => window.BBGM_UI_PLAYER.show(id) } } : {}),
    });
    // .roster-row is a 32px/1fr/auto grid — the first cell is always
    // emitted (empty when there's no lead icon) so the info block never
    // lands in the narrow badge column and gets crushed.
    row.appendChild(U.el('span', {
      style: { 'font-size': '18px', 'text-align': 'center' } }, opts.lead || ''));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, name));
    if (meta) info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
    row.appendChild(info);
    if (opts.right) row.appendChild(U.el('div', { class: 'player-row-stats' },
      U.el('span', { class: 'key' }, opts.right)));
    return row;
  }

  function renderAwards(container, state) {
    const chips = U.el('div', { class: 'filter-bar', style: { 'margin-bottom': '10px' } });
    for (const m of [['season', 'Season Awards'], ['hof', 'Hall of Fame'], ['allstar', 'All-Star']]) {
      chips.appendChild(U.el('button', {
        class: `filter-chip${awardsMode === m[0] ? ' active' : ''}`,
        on: { click: () => { awardsMode = m[0]; window.BBGM_MAIN.refresh(); } },
      }, m[1]));
    }
    container.appendChild(chips);
    if (awardsMode === 'season') renderSeasonAwards(container, state);
    else if (awardsMode === 'hof') renderHof(container, state);
    else renderAllStar(container, state);
  }

  function yearPicker(years, selected, onChange) {
    const sel = U.el('select', { class: 'stats-team-picker', on: { change: (e) => onChange(Number(e.target.value)) } });
    for (const y of years) {
      sel.appendChild(U.el('option', { value: String(y), ...(y === selected ? { selected: 'selected' } : {}) }, String(y)));
    }
    return sel;
  }

  function renderSeasonAwards(container, state) {
    const all = (state.history && state.history.awards) || {};
    const years = Object.keys(all).map(Number).sort((a, b) => b - a);
    if (!years.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'Awards are voted after each World Series. Finish a season and the hardware lands here.'));
      return;
    }
    if (!awardsYear || !all[awardsYear]) awardsYear = years[0];
    container.appendChild(yearPicker(years, awardsYear, (y) => { awardsYear = y; window.BBGM_MAIN.refresh(); }));
    const yr = all[awardsYear];
    const abbrOf = (tid) => {
      const t = state.league.teams.find((x) => x.id === tid);
      return t ? t.abbr : '—';
    };

    for (const lg of ['east', 'west']) {
      const a = yr[lg];
      if (!a) continue;
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } },
        `${U.leagueName(lg)} League`));
      const list = U.el('div', { class: 'roster-list' });
      const major = [
        ['🏅', 'MVP', a.mvp], ['🔥', 'Cy Young', a.cy], ['🌱', 'Rookie of the Year', a.roy],
        ['🧠', 'Manager of the Year', a.moy], ['🚪', 'Reliever of the Year', a.reliever],
        ['📈', 'Comeback Player', a.comeback],
      ];
      for (const [icon, label, award] of major) {
        if (!award) continue;
        const w = award.winner;
        const runners = (award.voting || []).slice(1, 3)
          .map((v, i) => `${i + 2}. ${v.name} (${v.pts})`).join('  ');
        const meta = `${label}${runners ? ` • ${runners}` : ''}`;
        const row = playerRow(state, label === 'Manager of the Year' ? null : w.id,
          `${w.name} (${abbrOf(w.teamId)})`, meta, { lead: icon, right: `${w.pts} pts` });
        list.appendChild(row);
      }
      container.appendChild(list);

      // Gold Gloves / Silver Sluggers: compact position grids.
      for (const [title, obj] of [['Gold Gloves', a.gg], ['Silver Sluggers', a.ss]]) {
        const poss = Object.keys(obj || {});
        if (!poss.length) continue;
        container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '10px', 'font-size': '12px' } }, title));
        const grid = U.el('div', { style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '4px' } });
        for (const pos of poss) {
          const w = obj[pos];
          grid.appendChild(U.el('button', {
            class: 'roster-row', style: { padding: '6px 8px' },
            on: { click: () => state.players[w.id] && window.BBGM_UI_PLAYER.show(w.id) },
          }, [
            U.el('span', { class: 'player-row-meta', style: { 'margin-right': '6px', 'flex-shrink': '0' } }, pos),
            U.el('span', { class: 'player-row-name', style: { 'font-size': '12px' } }, w.name),
          ]));
        }
        container.appendChild(grid);
      }
    }
  }

  function renderHof(container, state) {
    const hof = (state.history && state.history.hof) || {};
    const years = Object.keys(hof).map(Number).sort((a, b) => b - a);

    // Every enshrined player, straight off the player pool.
    const members = [];
    for (const id in state.players) {
      const p = state.players[id];
      if (p.hof) members.push(p);
    }
    members.sort((a, b) => a.hof.year - b.hof.year);

    if (!years.length && !members.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'The Hall opens its doors once retired greats have been eligible for five seasons. Build some legends.'));
      return;
    }

    // Latest ballot results (19.7).
    if (years.length) {
      const latest = hof[years[0]];
      container.appendChild(U.el('div', { class: 'card-title' }, `${years[0] + 1} Ballot`));
      if (latest.inducted.length) {
        const list = U.el('div', { class: 'roster-list' });
        for (const i of latest.inducted) {
          list.appendChild(playerRow(state, i.id, i.name,
            i.method === 'veterans' ? 'Inducted — Veterans Committee' : `Inducted — ${i.pct}% of the vote`,
            { lead: '🏛', right: i.pos }));
        }
        container.appendChild(list);
      } else {
        container.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
          'No one reached the 75% threshold this year.'));
      }
      const alsoRan = (latest.ballot || []).filter((b) => !latest.inducted.some((i) => i.id === b.id)).slice(0, 8);
      if (alsoRan.length) {
        container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '10px', 'font-size': '12px' } },
          'On the ballot'));
        const list = U.el('div', { class: 'roster-list' });
        for (const b of alsoRan) {
          list.appendChild(playerRow(state, b.id, b.name,
            `${b.pct}% • year ${b.appearances} of 10 on the ballot`, { right: b.pos }));
        }
        container.appendChild(list);
      }
    }

    // Members by position (19.7).
    if (members.length) {
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } },
        `Hall of Famers (${members.length})`));
      const order = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP', 'RP', 'CP'];
      const byPos = {};
      for (const p of members) (byPos[p.primaryPosition] = byPos[p.primaryPosition] || []).push(p);
      for (const pos of order) {
        if (!byPos[pos]) continue;
        container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '8px', 'font-size': '12px' } }, pos));
        const list = U.el('div', { class: 'roster-list' });
        for (const p of byPos[pos]) {
          list.appendChild(playerRow(state, p.id, p.name,
            `Class of ${p.hof.year + 1}` +
            (p.hof.method === 'veterans' ? ' • Veterans Committee' : ` • ${p.hof.pct}%`),
            { lead: '🏛' }));
        }
        container.appendChild(list);
      }
    }
  }

  function renderAllStar(container, state) {
    const all = (state.history && state.history.allStar) || {};
    const years = Object.keys(all).map(Number).sort((a, b) => b - a);
    if (!years.length) {
      container.appendChild(U.el('div', { class: 'empty-state' },
        'The All-Star Game is played on the mid-July break. Rosters and results land here.'));
      return;
    }
    if (!allStarYear || !all[allStarYear]) allStarYear = years[0];
    container.appendChild(yearPicker(years, allStarYear, (y) => { allStarYear = y; window.BBGM_MAIN.refresh(); }));
    const as = all[allStarYear];

    const winName = U.leagueName(as.winner);
    const score = `${Math.max(as.eastRuns, as.westRuns)}-${Math.min(as.eastRuns, as.westRuns)}`;
    container.appendChild(U.el('div', { class: 'card', style: { 'margin-top': '10px' } }, [
      U.el('div', { class: 'card-title' }, `${as.year} All-Star Game`),
      U.el('p', { style: { 'font-size': '14px', margin: '4px 0' } },
        `⭐ ${winName} League wins, ${score}.`),
      U.el('p', { class: 'muted', style: { 'font-size': '12px', margin: '2px 0' } },
        `All-Star MVP: ${as.mvp.name}`),
    ]));

    const abbrOf = (tid) => {
      const t = state.league.teams.find((x) => x.id === tid);
      return t ? t.abbr : '—';
    };
    for (const lg of ['east', 'west']) {
      const r = as.rosters[lg];
      if (!r) continue;
      container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } },
        `${U.leagueName(lg)} League roster`));
      const sections = [['Starters', r.starters], ['Pitchers', r.pitchers], ['Bench', r.bench]];
      for (const [title, arr] of sections) {
        if (!arr || !arr.length) continue;
        container.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '8px', 'font-size': '12px' } }, title));
        const list = U.el('div', { class: 'roster-list' });
        for (const sel of arr) {
          const isMvp = sel.id === as.mvp.id;
          list.appendChild(playerRow(state, sel.id,
            `${sel.name} (${abbrOf(sel.teamId)})${isMvp ? ' ⭐' : ''}`,
            null, { right: sel.pos }));
        }
        container.appendChild(list);
      }
    }
  }

  return { render };
})();
