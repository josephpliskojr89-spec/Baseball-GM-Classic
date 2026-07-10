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
      `${p.primaryPosition} • Age ${p.age} • ${p.bats}/${p.throws} • #${p.jersey}` +
      (p.retired ? ` • Retired ${p.retired.year}` : '')));
    if (team && !p.retired) header.appendChild(U.el('div', { class: 'player-profile-team' }, team.name));
    body.appendChild(header);

    // Championships and milestones.
    const ach = p.achievements || {};
    const achBits = [];
    if (ach.championships && ach.championships.length) {
      achBits.push(`🏆 ${ach.championships.join(', ')}`);
    }
    for (const m of (ach.milestones || [])) {
      achBits.push(`${m.threshold.toLocaleString()} ${m.label} (${m.year})`);
    }
    if (achBits.length) {
      body.appendChild(U.el('div', {
        class: 'muted',
        style: { 'font-size': '12px', 'margin-bottom': '10px' },
      }, achBits.join(' • ')));
    }

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

    // Fatigue chip — only surfaces when fatigue has reached moderate level.
    // Bible 10.8 design intent is that low fatigue is invisible (no
    // micromanagement); the chip appears as the rest pressure ramps.
    const FAT = window.BBGM_FATIGUE;
    if (FAT && !p.isPitcher && FAT.isModerate(p)) {
      const lvl = FAT.level(p);
      const colorByLevel = {
        moderate: { bg: 'rgba(240, 162, 58, 0.15)', border: 'rgba(240, 162, 58, 0.4)', text: 'var(--warning)', label: 'Moderate fatigue' },
        high:     { bg: 'rgba(240, 162, 58, 0.22)', border: 'rgba(240, 162, 58, 0.5)', text: 'var(--warning)', label: 'High fatigue' },
        critical: { bg: 'rgba(226, 92, 92, 0.18)',  border: 'rgba(226, 92, 92, 0.45)', text: 'var(--danger)',  label: 'Fatigued — suggested rest: 1 day' },
      };
      const cfg = colorByLevel[lvl];
      body.appendChild(U.el('div', {
        style: {
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
          color: cfg.text,
          padding: '8px 12px',
          'border-radius': 'var(--radius-md)',
          'margin-bottom': '12px',
          'font-size': '12px',
          'font-weight': '600',
        }
      }, `● ${cfg.label}`));
    }

    // Current season stats
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    body.appendChild(U.el('div', { class: 'card-title' }, `${year} Stats`));
    if (p.isPitcher) {
      body.appendChild(pitcherStatGrid(s));
      // Batting line from no-DH games (Western League parks).
      if (s && s.batting && s.batting.pa > 0) {
        body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Batting'));
        body.appendChild(hitterStatGrid(s.batting));
      }
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
    const ext = extensionSection(p);
    if (ext) body.appendChild(ext);

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

    const rowFor = (label, s, cls) => {
      const tr = U.el('tr', cls ? { style: { color: 'var(--text-muted)' } } : {});
      tr.appendChild(U.el('td', {}, label));
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
      return tr;
    };

    const tbody = U.el('tbody');
    for (const y of years) {
      const s = p.stats[y];
      const playedMLB = isP ? (s.ipOuts || 0) > 0 || (s.g || 0) > 0 : (s.pa || 0) > 0;
      if (playedMLB) tbody.appendChild(rowFor(y, s));
      // Minor-league season line (stamped at rollover) — shown muted.
      if (s.minorsLine) tbody.appendChild(rowFor(`${y} ${s.minorsLine.level}`, s.minorsLine, true));
      // Postseason line, muted, tagged.
      if (s.postseason) tbody.appendChild(rowFor(`${y} PS`, s.postseason, true));
    }
    // Career MLB totals (aggregated at each rollover).
    const c = p.careerStats;
    const hasCareer = c && (isP ? (c.ipOuts || 0) > 0 || (c.g || 0) > 0 : (c.pa || c.ab || 0) > 0);
    if (hasCareer) {
      const tr = rowFor('Career', c);
      tr.style.fontWeight = '700';
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function contractBlock(p) {
    const c = p.contract || {};
    const rows = [
      insetRow('Years Remaining', String(c.years || 0)),
      insetRow('Annual Salary', U.fmtMoney(c.annualSalary || 0)),
      insetRow('Total Value', U.fmtMoney(c.totalValue || 0)),
      insetRow('Service Time', `${p.serviceTime.years}.${String(p.serviceTime.days).padStart(3,'0')}`),
    ];
    if (p.acquiredVia) {
      const state = window.BBGM_STATE.get();
      const from = p.acquiredVia.fromTeamId &&
        state.league.teams.find((t) => t.id === p.acquiredVia.fromTeamId);
      const how = p.acquiredVia.type === 'trade'
        ? `Trade${from ? ' from ' + from.abbr : ''}, ${p.acquiredVia.year}`
        : `Free agency, ${p.acquiredVia.year}`;
      rows.push(insetRow('Acquired', how));
    }
    if (p.draft) {
      const state = window.BBGM_STATE.get();
      const by = state.league.teams.find((t) => t.id === p.draft.teamId);
      rows.push(insetRow('Drafted',
        `${p.draft.year} R${p.draft.round} P${p.draft.pick} (#${p.draft.overall} overall)` +
        `${by ? ' by ' + by.abbr : ''}` +
        (p.draft.bonus ? ` • $${p.draft.bonus}M bonus` : '')));
    }
    const grid = U.el('div', { class: 'inset-list' }, rows);
    return grid;
  }

  // Extension offer (bible 16.11) — user-team players only.
  function extensionSection(p) {
    const state = window.BBGM_STATE.get();
    if (p.retired || p.teamId !== state.meta.userTeamId) return null;
    const FA = window.BBGM_FA;
    const wrap = U.el('div', { style: { 'margin-top': '10px' } });
    wrap.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { width: '100%' },
      on: { click: () => {
        const ask = FA.extensionAsk(p);
        const mkOffer = (label, years, total) => ({
          label, kind: 'primary',
          onClick: () => {
            const err = FA.offerExtension(state, p, years, Math.round(total * 10) / 10);
            if (err) U.showToast(err, 'warning', 5000);
            else {
              U.showToast(`${p.name} signs the extension.`, 'success');
              window.BBGM_STATE.set(state);
              window.BBGM_MAIN.refresh();
            }
            return true;
          },
        });
        U.showModal({
          title: `Extend ${p.name}`,
          body: `His camp is looking for roughly ${ask.years} yr / $${ask.total}M ` +
                `($${ask.aav}M AAV). Players still under team control take a discount; ` +
                `walk-year players want market money.`,
          actions: [
            mkOffer(`Meet ask (${ask.years}y/$${ask.total}M)`, ask.years, ask.total),
            mkOffer('Lowball −15%', ask.years, ask.total * 0.85),
            mkOffer('Sweeten +10%', ask.years, ask.total * 1.1),
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
          ],
        });
      }},
    }, 'Offer Contract Extension…'));
    return wrap;
  }

  function insetRow(label, value) {
    const r = U.el('div', { class: 'inset-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  return { show };
})();
