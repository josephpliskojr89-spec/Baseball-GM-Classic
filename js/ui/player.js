// Player card — tabbed profile (baseball-reference style):
//   Overview     the player at a glance: bio, provenance, OVR on the
//                20-80 scale with an RPG-rarity card header, current
//                season stats, tool grades
//   Stats        full career table (MLB / minors / postseason / totals)
//   Contract     current deal, service time, provenance, salary ledger
//   Achievements awards (Phase 14), rings, milestones, single-game feats
window.BBGM_UI_PLAYER = (function () {
  const U = window.BBGM_UI;
  const S = window.BBGM_STATS;

  // RPG rarity tiers over the 20-80 overall scale. The card header wears
  // the tier's gradient — you can read a player's caliber from across the
  // room before you read a single number.
  const RARITY = [
    { min: 70, label: 'Generational', from: '#8a6d00', to: '#d4af37', text: '#fff8dc' },
    { min: 65, label: 'Superstar',    from: '#9a3412', to: '#f97316', text: '#ffedd5' },
    { min: 60, label: 'All-Star',     from: '#5b21b6', to: '#a855f7', text: '#f3e8ff' },
    { min: 55, label: 'Above Average',from: '#1e40af', to: '#3b82f6', text: '#dbeafe' },
    { min: 48, label: 'Everyday',     from: '#166534', to: '#22c55e', text: '#dcfce7' },
    { min: 0,  label: 'Depth',        from: '#374151', to: '#6b7280', text: '#e5e7eb' },
  ];
  function rarityFor(ovr) {
    return RARITY.find((r) => ovr >= r.min) || RARITY[RARITY.length - 1];
  }

  // Bio fields for players generated before 0.14 (no height/weight/full
  // birthdate on the save): derive stable values from the player id so the
  // card never shows blanks and never changes between opens.
  function bioOf(p) {
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
    const heightIn = p.heightIn != null ? p.heightIn : 70 + (h % 9);
    // Same scale as generation: ~197 lb at 6'0", +6 lb per inch.
    const weightLb = p.weightLb != null ? p.weightLb
      : Math.max(165, Math.min(270, Math.round((heightIn - 60) * 6 + 125 + ((h >> 4) % 30) - 15)));
    const birthMonth = p.birthMonth != null ? p.birthMonth : 1 + ((h >> 8) % 12);
    const birthDay = p.birthDay != null ? p.birthDay : 1 + ((h >> 12) % 28);
    return { heightIn, weightLb, birthMonth, birthDay };
  }
  function fmtHeight(inches) {
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  }

  function show(playerId, tab) {
    const state = window.BBGM_STATE.get();
    const p = state.players[playerId];
    if (!p) return;
    const team = state.league.teams.find((t) => t.id === p.teamId);
    const activeTab = tab || 'overview';

    const body = U.el('div');
    const ovr = Math.round(window.BBGM_ROSTER.overall(p));
    // Scouting fog (bible 5.7 / Phase 13): prospects outside public view
    // render as bands from the user's scouting report, never true numbers.
    const rep = window.BBGM_SCOUT.report(state, p);
    const ovrBand = rep.ovrBand();
    const rarityBasis = ovrBand ? (ovrBand[0] + ovrBand[1]) / 2 : ovr;
    const rarity = rep.mode === 'min' ? rarityFor(0) : rarityFor(rarityBasis);

    // Rarity header: name + bio line + big OVR badge.
    const header = U.el('div', {
      class: 'player-profile-header',
      style: {
        background: `linear-gradient(135deg, ${rarity.from}, ${rarity.to})`,
        color: rarity.text,
        display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '10px',
      },
    });
    const left = U.el('div');
    left.appendChild(U.el('div', { class: 'player-profile-name', style: { color: rarity.text } }, p.name));
    left.appendChild(U.el('div', { class: 'player-profile-meta', style: { color: rarity.text, opacity: '0.9' } },
      `${p.primaryPosition} • Age ${p.age} • ${p.bats}/${p.throws} • #${p.jersey}` +
      (p.retired ? ` • Retired ${p.retired.year}` : '')));
    if (team && !p.retired) {
      left.appendChild(U.el('div', { class: 'player-profile-team', style: { color: rarity.text, opacity: '0.9' } }, team.name));
    }
    header.appendChild(left);
    const badge = U.el('div', { style: { 'text-align': 'center', 'min-width': '64px' } });
    const badgeText = rep.mode === 'exact' ? String(U.gradeFor(ovr))
      : rep.mode === 'min' ? '??'
      : `${ovrBand[0]}–${ovrBand[1]}`;
    badge.appendChild(U.el('div', {
      style: { 'font-size': rep.mode === 'exact' ? '30px' : '20px', 'font-weight': '800', 'line-height': '1.4' },
    }, badgeText));
    badge.appendChild(U.el('div', { style: { 'font-size': '10px', 'letter-spacing': '0.6px', 'text-transform': 'uppercase', opacity: '0.9' } },
      rep.mode === 'min' ? 'Unscouted' : rarity.label + (rep.mode !== 'exact' ? ' (proj.)' : '')));
    header.appendChild(badge);
    body.appendChild(header);

    // Tab bar.
    const tabs = U.el('div', { class: 'tabs', style: { 'margin-top': '10px' } });
    const tabDefs = [
      { key: 'overview', label: 'Overview' },
      { key: 'stats', label: 'Stats' },
      { key: 'contract', label: 'Contract' },
      { key: 'achievements', label: 'Awards' },
    ];
    const content = U.el('div');
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => show(playerId, t.key) },
      }, t.label));
    }
    body.appendChild(tabs);
    body.appendChild(content);

    if (activeTab === 'stats') renderStatsTab(content, state, p);
    else if (activeTab === 'contract') renderContractTab(content, state, p);
    else if (activeTab === 'achievements') renderAchievementsTab(content, state, p);
    else renderOverviewTab(content, state, p);

    U.showModal({
      title: '',
      body,
      actions: [
        { label: 'Close', kind: 'primary', onClick: () => true },
      ],
    });
  }

  // ---- Overview: the top of the baseball-reference page -------------------

  function renderOverviewTab(body, state, p) {
    const C = window.BBGM_CONSTANTS;
    const bio = bioOf(p);
    const monthName = C.MONTHS[bio.birthMonth - 1];

    // Bio block.
    const bioRows = [
      insetRow('Height / Weight', `${fmtHeight(bio.heightIn)}, ${bio.weightLb} lb`),
      insetRow('Born', `${monthName} ${bio.birthDay}, ${p.birthYear} (age ${p.age})`),
    ];
    if (p.origin) bioRows.push(insetRow('From', p.origin));
    else if (p.school) bioRows.push(insetRow('School', p.school));
    if (p.draft) {
      const by = state.league.teams.find((t) => t.id === p.draft.teamId);
      bioRows.push(insetRow('Drafted', `${p.draft.year} R${p.draft.round} (#${p.draft.overall})${by ? ' by ' + by.abbr : ''}`));
    } else if (p.intl) {
      bioRows.push(insetRow('Signed', `${p.intl.year} int’l — ${p.intl.country} (#${p.intl.rank})`));
    } else if (p.intlEvent) {
      bioRows.push(insetRow('Background',
        p.intlEvent === 'posting' ? 'Posted from NPB (Japan)'
          : p.intlEvent === 'defector' ? 'Cuban defector' : 'KBO free agent'));
    }
    const FAT = window.BBGM_FATIGUE;
    if (FAT && FAT.isIronMan && FAT.isIronMan(p)) {
      bioRows.push(insetRow('Makeup', '🛡 Iron Man — plays every day'));
    }
    body.appendChild(U.el('div', { class: 'inset-list', style: { 'margin-top': '10px' } }, bioRows));

    // Injury banner.
    if (p.currentInjury) {
      const inj = p.currentInjury;
      const desc = inj.ilType
        ? `${inj.ilType} IL — ${inj.daysOut} days (${inj.type})`
        : `Day-to-day — ${inj.daysOut} day${inj.daysOut !== 1 ? 's' : ''} (${inj.type})`;
      body.appendChild(U.el('div', {
        style: {
          background: 'rgba(226, 92, 92, 0.15)', border: '1px solid rgba(226, 92, 92, 0.4)',
          color: 'var(--danger)', padding: '10px 12px', 'border-radius': 'var(--radius-md)',
          margin: '12px 0', 'font-size': '13px', 'font-weight': '600',
        }
      }, '⚠ ' + desc + (inj.careerAltering ? ' • career-altering' : '')));
    }

    // Fatigue chip — surfaces from moderate up (bible 10.8: low fatigue is
    // invisible; no micromanagement).
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
          background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text,
          padding: '8px 12px', 'border-radius': 'var(--radius-md)',
          margin: '12px 0', 'font-size': '12px', 'font-weight': '600',
        }
      }, `● ${cfg.label}`));
    }

    // Current season.
    const year = state.meta.currentDate.year;
    const s = p.stats[year];
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, `${year} Stats`));
    if (p.isPitcher) {
      body.appendChild(pitcherStatGrid(s));
      if (s && s.batting && s.batting.pa > 0) {
        body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Batting'));
        body.appendChild(hitterStatGrid(s.batting));
      }
    } else {
      body.appendChild(hitterStatGrid(s));
    }

    // Tool grades — through the scouting fog (5.7).
    const rep = window.BBGM_SCOUT.report(state, p);
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } },
      rep.mode === 'exact' ? 'Ratings' : 'Scouting Report'));
    if (rep.mode === 'min') {
      body.appendChild(U.el('div', { class: 'empty-state' },
        'Your scouts have no book on him. A higher scouting tier (Team → Staff) opens up reports at this level.'));
    } else {
      body.appendChild(p.isPitcher ? pitcherRatings(p, rep) : hitterRatings(p, rep));
      if (rep.mode !== 'exact') {
        body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
          'Projected ranges from your scouting department — the truth may sit outside a band.'));
      }
    }
  }

  // ---- Stats: the full career ledger ---------------------------------------

  function renderStatsTab(body, state, p) {
    const years = Object.keys(p.stats).sort();
    if (!years.length) {
      body.appendChild(U.el('div', { class: 'empty-state', style: { 'margin-top': '12px' } },
        'No professional stats yet.'));
      return;
    }
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Career'));
    body.appendChild(careerTable(p, years));
  }

  // ---- Contract: current deal + salary ledger ------------------------------

  function renderContractTab(body, state, p) {
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Current Deal'));
    body.appendChild(contractBlock(p));
    const ext = extensionSection(p);
    if (ext) body.appendChild(ext);

    const hist = (p.salaryHistory || []).slice().reverse();
    if (hist.length) {
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Salary History'));
      const wrap = U.el('div', { class: 'stats-scroll' });
      const table = U.el('table', { class: 'stats-table' });
      const trh = U.el('tr');
      for (const h of ['Year', 'Salary', 'Basis']) trh.appendChild(U.el('th', {}, h));
      const thead = U.el('thead'); thead.appendChild(trh); table.appendChild(thead);
      const tbody = U.el('tbody');
      const basisLabel = {
        rookie: 'Pre-arb', renewal: 'Pre-arb', arbitration: 'Arbitration',
        FA: 'Free agency', extension: 'Extension', draft: 'Rookie deal',
        intl: 'Rookie deal', 'intl-event': 'Int’l signing', 'fa': 'Free agency',
      };
      for (const row of hist) {
        const tr = U.el('tr');
        tr.appendChild(U.el('td', {}, String(row.year)));
        tr.appendChild(U.el('td', {}, U.fmtMoney(row.salary || 0)));
        tr.appendChild(U.el('td', {}, basisLabel[row.type] || row.type || '—'));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      body.appendChild(wrap);
    } else {
      body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '12px' } },
        'Salary history starts recording from this season on.'));
    }
  }

  // ---- Achievements: rings, milestones, single-game feats ------------------

  const FEAT_ICON = {
    cycle: '🌀', hr3: '💣', hr4: '💥', walkoff: '🎉', walkoff_hr: '🎆',
    nohitter: '🚫', perfect: '💎', k15: '🔥',
  };

  function renderAchievementsTab(body, state, p) {
    const ach = p.achievements || {};
    let any = false;

    if (p.hof) {
      any = true;
      body.appendChild(U.el('div', {
        style: {
          'margin-top': '12px', padding: '10px 12px', 'border-radius': '10px',
          background: 'linear-gradient(135deg, #7a5c00, #b8860b)', color: '#fff',
          'font-weight': '600', 'font-size': '14px',
        },
      }, `🏛 Hall of Fame — Class of ${p.hof.year + 1}` +
         (p.hof.method === 'veterans' ? ' (Veterans Committee)' : ` (${p.hof.pct}% of the vote)`)));
    }

    if (ach.allStarSelections && ach.allStarSelections.length) {
      any = true;
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'All-Star'));
      body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
        `⭐ ${ach.allStarSelections.length}× All-Star (${ach.allStarSelections.join(', ')})`));
    }

    if (ach.awards && ach.awards.length) {
      any = true;
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Awards'));
      for (const a of ach.awards) {
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } }, `${a.name} (${a.year})`));
      }
    }

    if (ach.championships && ach.championships.length) {
      any = true;
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Championships'));
      body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
        `🏆 World Series champion: ${ach.championships.join(', ')}`));
    }

    if (ach.milestones && ach.milestones.length) {
      any = true;
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Career Milestones'));
      for (const m of ach.milestones) {
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `${m.threshold.toLocaleString()} career ${m.label} (${m.year})`));
      }
    }

    if (ach.feats && ach.feats.length) {
      any = true;
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, 'Notable Games'));
      for (const f of ach.feats.slice().reverse()) {
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `${FEAT_ICON[f.type] || '⭐'} ${f.detail} (${f.year}${f.ps ? ' playoffs' : ''})`));
      }
    }

    if (!any) {
      body.appendChild(U.el('div', { class: 'empty-state', style: { 'margin-top': '12px' } },
        'No hardware yet. Rings, milestones, awards, and famous games land here.'));
    }
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

  // rep (optional): scouting report — band mode renders ranges instead of
  // exact grades (5.7).
  function ratingCell(label, value, key, rep) {
    const cell = U.el('div', { class: 'rating-cell' });
    cell.appendChild(U.el('div', { class: 'label' }, label));
    const band = rep && rep.mode !== 'exact' ? rep.band(key) : null;
    if (band) {
      const mid = (band[0] + band[1]) / 2;
      cell.appendChild(U.el('div', {
        class: U.gradeClass(mid),
        style: { 'font-weight': '700', 'font-variant-numeric': 'tabular-nums' },
      }, `${band[0]}–${band[1]}`));
    } else {
      cell.appendChild(U.ratingDisplay(value));
    }
    return cell;
  }

  function hitterRatings(p, rep) {
    const r = p.ratings;
    const items = [
      ['Contact (R)', r.contactVsR, 'contactVsR'],
      ['Contact (L)', r.contactVsL, 'contactVsL'],
      ['Power (R)', r.powerVsR, 'powerVsR'],
      ['Power (L)', r.powerVsL, 'powerVsL'],
      ['Discipline', r.discipline, 'discipline'],
      ['Speed', r.speed, 'speed'],
      ['Defense', r.defense, 'defense'],
      ['Arm', r.arm, 'arm'],
      ['Bunting', r.bunting, 'bunting'],
    ];
    const grid = U.el('div', { class: 'ratings-grid' });
    for (const [label, v, key] of items) grid.appendChild(ratingCell(label, v, key, rep));
    return grid;
  }

  function pitcherRatings(p, rep) {
    const r = p.ratings;
    const items = [
      ['Stuff', r.stuff, 'stuff'],
      ['Velocity', r.velocity, 'velocity'],
      ['Movement', r.movement, 'movement'],
      ['Control', r.control, 'control'],
      ['Stamina', r.stamina, 'stamina'],
    ];
    const grid = U.el('div', { class: 'ratings-grid' });
    for (const [label, v, key] of items) grid.appendChild(ratingCell(label, v, key, rep));
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
    // Signing bonus from the draft / int'l pipeline (draft/intl details
    // live on the Overview tab's bio block).
    if (p.draft && p.draft.bonus) rows.push(insetRow('Signing Bonus', `$${p.draft.bonus}M (${p.draft.year} draft)`));
    else if (p.intl && p.intl.bonus) rows.push(insetRow('Signing Bonus', `$${p.intl.bonus}M (${p.intl.year} int’l)`));
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
