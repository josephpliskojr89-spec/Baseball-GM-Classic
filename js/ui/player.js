// Player detail modal
window.BBGM_UI_PLAYER = (function () {
  const U = window.BBGM_UI;
  const S = window.BBGM_STATS;

  function show(playerId) {
    const state = window.BBGM_STATE.get();
    const p = state.players[playerId];
    if (!p) return;
    const team = state.league.teams.find((t) => t.id === p.teamId);

    const body = U.el('div');

    // Header
    const header = U.el('div', { class: 'player-profile-header', style: U.teamColorVars(team || {colors:{primary:'#1c2230',secondary:'#161b22'}}) });
    header.appendChild(U.el('div', { class: 'player-profile-name' }, p.name));
    header.appendChild(U.el('div', { class: 'player-profile-meta' },
      `${p.primaryPosition} • Age ${p.age} • ${p.bats}/${p.throws} • #${p.jersey}`));
    if (team) header.appendChild(U.el('div', { class: 'player-profile-team' }, team.name));
    body.appendChild(header);

    // Active injury banner — shown above stats so it's the first thing the
    // user sees on a profile they're considering a roster move for.
    if (p.currentInjury) {
      const inj = p.currentInjury;
      const desc = inj.ilType
        ? `${inj.ilType} IL — ${inj.daysOut} days (${inj.type})`
        : `Day-to-day — ${inj.daysOut} day${inj.daysOut !== 1 ? 's' : ''} (${inj.type})`;
      body.appendChild(U.el('div', {
        style: {
          background: 'rgba(226, 92, 92, 0.15)',
          border: '1px solid rgba(226, 92, 92, 0.4)',
          color: 'var(--danger)',
          padding: '10px 12px',
          'border-radius': 'var(--radius-md)',
          'margin-bottom': '12px',
          'font-size': '13px',
          'font-weight': '600',
        }
      }, '⚠ ' + desc + (inj.careerAltering ? ' • career-altering' : '')));
    }

    // Current season stats
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    body.appendChild(U.el('div', { class: 'card-title' }, `${year} Stats`));
    if (p.isPitcher) {
      body.appendChild(pitcherStatGrid(s));
    } else {
      body.appendChild(hitterStatGrid(s));
    }

    // Ratings
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Ratings'));
    body.appendChild(p.isPitcher ? pitcherRatings(p) : hitterRatings(p));

    // Career table (if multiple years)
    const years = Object.keys(p.stats).sort();
    if (years.length > 0) {
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Career'));
      body.appendChild(careerTable(p, years));
    }

    // Contract / Service
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Contract'));
    body.appendChild(contractBlock(p));

    U.showModal({
      title: '',
      body,
      actions: [
        { label: 'Close', kind: 'primary', onClick: () => true },
      ],
    });
  }

  function hitterStatGrid(s) {
    const grid = U.el('div', { class: 'stat-grid' });
    if (!s || s.pa === 0) {
      const cell = U.el('div', { class: 'stat-cell', style: { 'grid-column': '1 / -1' } });
      cell.appendChild(U.el('div', { class: 'k' }, 'No games played yet'));
      grid.appendChild(cell);
      return grid;
    }
    const stats = [
      ['G', String(s.g)],
      ['AB', String(s.ab)],
      ['H', String(s.h)],
      ['HR', String(s.hr)],
      ['RBI', String(s.rbi)],
      ['SB', String(s.sb)],
      ['BB', String(s.bb)],
      ['SO', String(s.k)],
      ['AVG', S.fmtAvg(S.avg(s))],
      ['OBP', S.fmtAvg(S.obp(s))],
      ['SLG', S.fmtAvg(S.slg(s))],
      ['OPS', S.ops(s).toFixed(3)],
    ];
    for (const [k, v] of stats) {
      const cell = U.el('div', { class: 'stat-cell' });
      cell.appendChild(U.el('div', { class: 'v' }, v));
      cell.appendChild(U.el('div', { class: 'k' }, k));
      grid.appendChild(cell);
    }
    return grid;
  }

  function pitcherStatGrid(s) {
    const grid = U.el('div', { class: 'stat-grid' });
    if (!s || (s.ipOuts || 0) === 0) {
      const cell = U.el('div', { class: 'stat-cell', style: { 'grid-column': '1 / -1' } });
      cell.appendChild(U.el('div', { class: 'k' }, 'No games pitched yet'));
      grid.appendChild(cell);
      return grid;
    }
    const stats = [
      ['G', String(s.g || 0)],
      ['GS', String(s.gs || 0)],
      ['W', String(s.w || 0)],
      ['L', String(s.l || 0)],
      ['SV', String(s.sv || 0)],
      ['IP', S.fmtIP(s.ipOuts || 0)],
      ['H', String(s.h || 0)],
      ['ER', String(s.er || 0)],
      ['BB', String(s.bb || 0)],
      ['K', String(s.k || 0)],
      ['ERA', S.era(s).toFixed(2)],
      ['WHIP', S.whip(s).toFixed(2)],
    ];
    for (const [k, v] of stats) {
      const cell = U.el('div', { class: 'stat-cell' });
      cell.appendChild(U.el('div', { class: 'v' }, v));
      cell.appendChild(U.el('div', { class: 'k' }, k));
      grid.appendChild(cell);
    }
    return grid;
  }

  function hitterRatings(p) {
    const r = p.ratings;
    const items = [
      { label: 'Contact (R)', v: r.contactVsR },
      { label: 'Contact (L)', v: r.contactVsL },
      { label: 'Power (R)', v: r.powerVsR },
      { label: 'Power (L)', v: r.powerVsL },
      { label: 'Discipline', v: r.discipline },
      { label: 'Speed', v: r.speed },
      { label: 'Defense', v: r.defense },
      { label: 'Arm', v: r.arm },
      { label: 'Bunting', v: r.bunting },
    ];
    const grid = U.el('div', { class: 'ratings-grid' });
    for (const it of items) {
      const cell = U.el('div', { class: 'rating-cell' });
      cell.appendChild(U.el('div', { class: 'label' }, it.label));
      cell.appendChild(U.ratingDisplay(it.v));
      grid.appendChild(cell);
    }
    return grid;
  }

  function pitcherRatings(p) {
    const r = p.ratings;
    const items = [
      { label: 'Stuff', v: r.stuff },
      { label: 'Velocity', v: r.velocity },
      { label: 'Movement', v: r.movement },
      { label: 'Control', v: r.control },
      { label: 'Stamina', v: r.stamina },
    ];
    const grid = U.el('div', { class: 'ratings-grid' });
    for (const it of items) {
      const cell = U.el('div', { class: 'rating-cell' });
      cell.appendChild(U.el('div', { class: 'label' }, it.label));
      cell.appendChild(U.ratingDisplay(it.v));
      grid.appendChild(cell);
    }
    return grid;
  }

  function careerTable(p, years) {
    const isP = p.isPitcher;
    const wrap = U.el('div', { class: 'stats-scroll' });
    const table = U.el('table', { class: 'stats-table' });
    const thead = U.el('thead');
    const trh = U.el('tr');
    const headers = isP
      ? ['Year', 'G', 'GS', 'W', 'L', 'SV', 'IP', 'ERA', 'WHIP', 'K', 'BB']
      : ['Year', 'G', 'AB', 'H', 'HR', 'RBI', 'SB', 'AVG', 'OBP', 'SLG'];
    for (const h of headers) trh.appendChild(U.el('th', {}, h));
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = U.el('tbody');
    for (const y of years) {
      const s = p.stats[y];
      const tr = U.el('tr');
      tr.appendChild(U.el('td', {}, y));
      if (isP) {
        tr.appendChild(U.el('td', {}, String(s.g || 0)));
        tr.appendChild(U.el('td', {}, String(s.gs || 0)));
        tr.appendChild(U.el('td', {}, String(s.w || 0)));
        tr.appendChild(U.el('td', {}, String(s.l || 0)));
        tr.appendChild(U.el('td', {}, String(s.sv || 0)));
        tr.appendChild(U.el('td', {}, S.fmtIP(s.ipOuts || 0)));
        tr.appendChild(U.el('td', {}, S.era(s).toFixed(2)));
        tr.appendChild(U.el('td', {}, S.whip(s).toFixed(2)));
        tr.appendChild(U.el('td', {}, String(s.k || 0)));
        tr.appendChild(U.el('td', {}, String(s.bb || 0)));
      } else {
        tr.appendChild(U.el('td', {}, String(s.g || 0)));
        tr.appendChild(U.el('td', {}, String(s.ab || 0)));
        tr.appendChild(U.el('td', {}, String(s.h || 0)));
        tr.appendChild(U.el('td', {}, String(s.hr || 0)));
        tr.appendChild(U.el('td', {}, String(s.rbi || 0)));
        tr.appendChild(U.el('td', {}, String(s.sb || 0)));
        tr.appendChild(U.el('td', {}, S.fmtAvg(S.avg(s))));
        tr.appendChild(U.el('td', {}, S.fmtAvg(S.obp(s))));
        tr.appendChild(U.el('td', {}, S.fmtAvg(S.slg(s))));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function contractBlock(p) {
    const c = p.contract || {};
    const grid = U.el('div', { class: 'inset-list' }, [
      insetRow('Years Remaining', String(c.years || 0)),
      insetRow('Annual Salary', U.fmtMoney(c.annualSalary || 0)),
      insetRow('Total Value', U.fmtMoney(c.totalValue || 0)),
      insetRow('Service Time', `${p.serviceTime.years}.${String(p.serviceTime.days).padStart(3,'0')}`),
    ]);
    return grid;
  }

  function insetRow(label, value) {
    const r = U.el('div', { class: 'inset-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  return { show };
})();
