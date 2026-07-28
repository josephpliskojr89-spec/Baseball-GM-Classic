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
    // Shifts MUST be unsigned (>>>): ids hashing above 2^31 read as
    // negative under >>, and a negative modulo gave "undefined -7, 2006"
    // birthdates on the card.
    const heightIn = p.heightIn != null ? p.heightIn : 70 + (h % 9);
    // Same scale as generation (0.49.0 body model): adult frame ~197 lb
    // at 6'2", young players list light until they fill out.
    const frame = Math.max(160, Math.min(260,
      Math.round((heightIn - 60) * 5.5 + 120 + ((h >>> 4) % 23) - 11)));
    const deficit = p.age != null ? Math.round(Math.max(0, Math.min(30, (25 - p.age) * 3.5))) : 0;
    const weightLb = p.weightLb != null ? p.weightLb : Math.max(148, frame - deficit);
    const birthMonth = p.birthMonth != null ? p.birthMonth : 1 + ((h >>> 8) % 12);
    const birthDay = p.birthDay != null ? p.birthDay : 1 + ((h >>> 12) % 28);
    return { heightIn, weightLb, birthMonth, birthDay };
  }
  function fmtHeight(inches) {
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  }

  // opts.discussTrade (0.35.0): callers like the Trade Finder open the
  // card with a "Discuss Trade…" action that jumps into the builder.
  function show(playerId, tab, opts = {}) {
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

    // Broadcast lower-third header (0.42.0): the laundry owns the panel —
    // team colors, jersey-number watermark — and rarity lives on the
    // home-plate OVR badge where the caliber still reads from across the
    // room. Free agents and retirees have no laundry, so THEIR header
    // keeps the full rarity gradient (the old look).
    const hasLaundry = !!team && !p.retired;
    const headerStyle = hasLaundry
      ? {
          ...U.teamColorVars(team),
          display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '10px',
        }
      : {
          background: `linear-gradient(135deg, ${rarity.from}, ${rarity.to})`,
          color: rarity.text,
          display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', gap: '10px',
        };
    const header = U.el('div', { class: 'player-profile-header', style: headerStyle });
    if (hasLaundry && p.jersey != null) {
      header.appendChild(U.el('span', { class: 'jersey-mark' }, `#${p.jersey}`));
    }
    const left = U.el('div', { style: { position: 'relative' } });
    left.appendChild(U.el('div', { class: 'player-profile-name' }, p.name));
    left.appendChild(U.el('div', { class: 'player-profile-meta', style: { opacity: '0.9' } },
      `${p.primaryPosition} • Age ${p.age} • ${p.bats}/${p.throws}` +
      (p.jersey != null ? ` • #${p.jersey}` : '') +
      (p.retired ? ` • Retired ${p.retired.year}` : '')));
    if (hasLaundry) {
      left.appendChild(U.el('div', { class: 'player-profile-team', style: { opacity: '0.9' } }, team.name));
    }
    header.appendChild(left);
    const badge = U.el('div', { style: { 'text-align': 'center', 'min-width': '68px', position: 'relative' } });
    const badgeText = rep.mode === 'exact' ? String(U.gradeFor(ovr))
      : rep.mode === 'min' ? '??'
      : `${ovrBand[0]}–${ovrBand[1]}`;
    badge.appendChild(U.el('div', {
      class: 'ovr-plate',
      style: {
        background: `linear-gradient(160deg, ${rarity.from}, ${rarity.to})`,
        color: rarity.text,
        'font-size': rep.mode === 'exact' ? '26px' : '14px',
        margin: '0 auto',
      },
    }, badgeText));
    badge.appendChild(U.el('div', {
      class: 'display',
      style: { 'font-size': '10px', 'letter-spacing': '0.06em', opacity: '0.9', 'margin-top': '2px' },
    }, rep.mode === 'min' ? 'Unscouted' : rarity.label + (rep.mode !== 'exact' ? ' (proj.)' : '')));
    header.appendChild(badge);
    body.appendChild(header);

    // Tab bar.
    const tabs = U.el('div', { class: 'tabs', style: { 'margin-top': '10px' } });
    const tabDefs = [
      { key: 'overview', label: 'Overview' },
      { key: 'stats', label: 'Stats' },
      { key: 'contract', label: 'File' },
      { key: 'achievements', label: 'Awards' },
    ];
    const content = U.el('div');
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => show(playerId, t.key, opts) },
      }, t.label));
    }
    body.appendChild(tabs);
    body.appendChild(content);

    if (activeTab === 'stats') renderStatsTab(content, state, p);
    else if (activeTab === 'contract') renderContractTab(content, state, p);
    else if (activeTab === 'achievements') renderAchievementsTab(content, state, p);
    else renderOverviewTab(content, state, p);

    // Transaction actions (0.31.0): the user's own 26-man players carry
    // their roster moves right on the card — no intermediate action
    // sheet. Everyone else's card stays read-only.
    const actions = [];
    const TEAM = window.BBGM_UI_TEAM;
    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    // Membership in team.roster is the real test — an IL player keeps
    // status 'active' but is off the 26-man and can't be moved from here.
    if (TEAM && TEAM.confirmSendDown && userTeam && p.teamId === userTeam.id &&
        !p.retired && userTeam.roster.includes(p.id)) {
      actions.push({ label: 'Send Down…', kind: 'secondary', onClick: () => {
        setTimeout(() => TEAM.confirmSendDown(state, userTeam, p), 0);
        return true;
      }});
      actions.push({ label: 'Release / Waive…', kind: 'danger', onClick: () => {
        setTimeout(() => TEAM.confirmRelease(state, userTeam, p, false), 0);
        return true;
      }});
    } else if (TEAM && TEAM.minorsCardActions && userTeam && p.teamId === userTeam.id &&
        !p.retired && (userTeam.minors || []).includes(p.id)) {
      // Farm transactions (0.31.1): promote / level / development /
      // release, straight from the card — same treatment as the 26-man.
      actions.push(...TEAM.minorsCardActions(state, userTeam, p));
    } else if (!p.retired && (state.freeAgents || []).includes(p.id) &&
        !state.meta.offseasonPhase && window.BBGM_FA && window.BBGM_FA.signMidSeason) {
      // In-season free agent (0.64.1): the card comes FIRST — the old
      // flow jumped straight to the sign-confirm without ever showing
      // the profile. Same card-first rule as roster, minors, and the
      // Trade Finder.
      actions.push({ label: 'Sign — Minor-League Deal…', kind: 'primary', onClick: () => {
        setTimeout(() => {
          U.showModal({
            title: `Sign ${p.name}?`,
            body: 'Minor-league deal, 1 yr / $0.74M. He reports to AAA.',
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Sign', kind: 'primary', onClick: () => {
                const s = window.BBGM_STATE.get();
                const team = s.league.teams.find((t) => t.id === s.meta.userTeamId);
                const err = window.BBGM_FA.signMidSeason(s, team, p.id);
                if (err) {
                  U.showToast(err, 'danger');
                } else {
                  window.BBGM_STATE.set(s);
                  window.BBGM_MAIN.refresh();
                  U.showToast(`${p.name} signed — he reports to AAA.`, 'success');
                }
                return true;
              }},
            ],
          });
        }, 0);
        return true;
      }});
    }
    // Shop Him (1.2.0): the sell side of the Trade Finder, card-first
    // like everything else — any player in YOUR org can be dangled, and
    // interested clubs call back with real offers.
    if (userTeam && !p.retired && p.teamId === userTeam.id &&
        (userTeam.roster.includes(p.id) || (userTeam.minors || []).includes(p.id)) &&
        window.BBGM_TRADES && window.BBGM_TRADES.shopPlayer) {
      actions.push({ label: 'Shop Him…', kind: 'secondary', onClick: () => {
        setTimeout(() => {
          const s = window.BBGM_STATE.get();
          let res;
          try {
            res = window.BBGM_TRADES.shopPlayer(s, p.id);
          } catch (err) {
            // Never let a valuation hiccup take the app down (1.2.1) —
            // the tap degrades to a toast, nothing is persisted, and
            // the cooldown stamp is rolled back so "again" means now.
            if (s.players[p.id]) delete s.players[p.id].shoppedAt;
            U.showToast('The phones went dead mid-call — try shopping him again.', 'warning', 4000);
            return;
          }
          if (!res.ok) {
            U.showToast(res.reason, 'warning', 4000);
            return;
          }
          window.BBGM_STATE.set(s);
          window.BBGM_MAIN.refresh();
          if (!res.offers.length) {
            U.showToast(`You shopped ${p.name} around the league — nobody bit at the price.`, 'info', 4500);
            return;
          }
          U.showModal({
            title: `The market on ${p.name}`,
            body: U.el('div', {}, res.offers.map((o) =>
              U.el('p', { style: { 'font-size': '13px', margin: '6px 0' } },
                `${o.abbr} would send ${o.names.join(' and ')}.`))),
            actions: [
              { label: 'Later', kind: 'secondary', onClick: () => true },
              { label: 'Review Offers', kind: 'primary', onClick: () => {
                setTimeout(() => window.BBGM_MAIN.navigate('gm', { tab: 'trades' }), 0);
                return true;
              }},
            ],
          });
        }, 0);
        return true;
      }});
    }
    if (opts.discussTrade && !p.retired && p.teamId && userTeam &&
        p.teamId !== userTeam.id && window.BBGM_UI_FRONTOFFICE &&
        window.BBGM_UI_FRONTOFFICE.startTradeFor) {
      // Trade Finder flow (0.35.0): review the profile first, then jump
      // into the builder with this player already in the package.
      actions.push({ label: 'Discuss Trade…', kind: 'primary', onClick: () => {
        setTimeout(() => window.BBGM_UI_FRONTOFFICE.startTradeFor(state, p), 0);
        return true;
      }});
    }
    actions.push({ label: 'Close', kind: 'primary', onClick: () => true });

    U.showModal({
      title: '',
      body,
      actions,
      fullScreen: true,
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
    // Positions (0.20.0 — utility men): primary + learned secondaries,
    // plus any active position-work assignment on the farm.
    if (!p.isPitcher) {
      const poss = [p.primaryPosition, ...(p.secondaryPositions || [])];
      bioRows.push(insetRow('Positions',
        poss.join(' • ') + (p.devPosition ? ` (learning ${p.devPosition})` : '')));
    }
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
    // NABL Pipeline rank (0.29.0): only minor leaguers appear; the list
    // is recomputed live so this stays honest through the season.
    if (p.status === 'minors' && window.BBGM_SCOUT.pipelineRank) {
      const rank = window.BBGM_SCOUT.pipelineRank(state, p.id);
      if (rank) bioRows.push(insetRow('Pipeline', `#${rank} on the NABL Top 100`));
    }
    // Flavor league (0.41.0): an unsigned player is playing SOMEWHERE —
    // indie ball, Mexico, or across the Pacific.
    if (p.status === 'FA' && p.playsIn && window.BBGM_FLAVOR) {
      const lg = window.BBGM_FLAVOR.leagueName(p.playsIn);
      if (lg) bioRows.push(insetRow('Playing in', lg));
      // Abroad (0.74.0): the unsigned senior pick on his one-year deal
      // overseas — the card says why nobody can touch him yet.
      if (p.abroadYear != null) bioRows.push(insetRow('Contract', 'Under contract overseas — back on the market this winter'));
    }
    // Farm level-fit note (0.31.1): the old minors action sheet carried
    // the scouts' assignment read — it renders under the bio now.
    let farmNote = null;
    {
      const TEAM0 = window.BBGM_UI_TEAM;
      const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
      if (TEAM0 && TEAM0.minorsScoutNote && ut && p.teamId === ut.id &&
          (ut.minors || []).includes(p.id)) {
        farmNote = TEAM0.minorsScoutNote(p);
      }
    }
    // Flat card language (v2.8.0, owner mock): uppercase section label,
    // hairline rows — the panels are gone.
    body.appendChild(U.el('div', { class: 'flat-title', style: { 'margin-top': '12px' } }, 'Player info'));
    body.appendChild(U.el('div', {}, bioRows));
    if (farmNote) {
      body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '6px' } }, farmNote));
    }

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
    body.appendChild(U.el('div', { class: 'flat-title' }, `${year} stats`));
    if (p.isPitcher) {
      body.appendChild(pitcherStatGrid(s));
      if (s && s.batting && s.batting.pa > 0) {
        body.appendChild(U.el('div', { class: 'flat-title' }, 'Batting'));
        body.appendChild(hitterStatGrid(s.batting));
      }
    } else {
      body.appendChild(hitterStatGrid(s));
    }

    // Tool grades — through the scouting fog (5.7). Flat card language
    // (v2.8.0, owner mock): one two-column hairline table carries
    // everything — current grades, inline futures for own players 27
    // and under ("45 / 60", the boxed FanGraphs grid's information in
    // the mock's dialect), the potential row, and the 20-80 band bar
    // underneath for the developing.
    const rep = window.BBGM_SCOUT.report(state, p);
    const futs = futuresFor(state, p, rep);
    const ratingsTitle = U.el('div', { class: 'flat-title' },
      rep.mode === 'exact' ? 'Ratings' : 'Scouting report');
    // No FV chip (owner call: with the Potential band on the card, a
    // second summary number wasn't adding much) — just the legend that
    // decodes the "35 / 55" pairs below.
    if (futs) {
      ratingsTitle.appendChild(U.el('span', {
        class: 'muted',
        style: { 'text-transform': 'none', 'letter-spacing': '0', 'font-size': '10px', 'font-weight': '400' },
      }, 'present / future'));
    }
    body.appendChild(ratingsTitle);
    if (rep.mode === 'min') {
      body.appendChild(U.el('div', { class: 'empty-state' },
        'Your scouts have no book on him. A higher scouting tier (GM → Staff) opens up reports at this level.'));
    } else {
      const HUB = window.BBGM_UI_DRAFT;
      const pot = window.BBGM_SCOUT.potentialBand(state, p);
      // Potential prints once (owner report: "we have potential on here
      // twice"): when the band bar renders below, it owns the numeral
      // and the table skips its Potential row; past the bar's age gate
      // the row is the only home and stays.
      const barShown = pot && p.age <= 27 && HUB && HUB.renderBandBar;
      body.appendChild(p.isPitcher
        ? pitcherRatings(state, p, rep, pot, futs, !barShown)
        : hitterRatings(state, p, rep, pot, futs, !barShown));
      if (barShown) {
        HUB.renderBandBar(body, pot, rep.mode === 'exact' ? null
          : 'Your department\'s overall projection — the truth may sit outside a band.',
          { label: 'Projected ceiling — overall' });
      }
      if (rep.mode !== 'exact' && !barShown) {
        body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
          'Projected ranges from your scouting department — the truth may sit outside a band.'));
      }
      // Young farmhands keep the scouts' voice from their amateur days —
      // the observed-fact lines (the burner, the radar gun, the frame)
      // stay true on the farm.
      if (p.status === 'minors' && p.age <= 26 && HUB && HUB.appendScoutNotes) {
        HUB.appendScoutNotes(body, state, p, 'draft');
      }
    }

    // The Scout's Book (0.69.0): the department's stamped potential reads,
    // year over year. The trend is the tell — a sinking card is the bust
    // announcing himself, a kid outplaying his band is the overachiever.
    if (p.scoutBook && p.scoutBook.length) {
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } },
        "Scout's Book"));
      const bookCard = U.el('div', { class: 'card', style: { padding: '10px 12px' } });
      let prevMid = null;
      for (const e of p.scoutBook) {
        const mid = (e.lo + e.hi) / 2;
        const row = U.el('div', {
          style: { display: 'flex', 'align-items': 'baseline', gap: '8px', padding: '3px 0' },
        });
        row.appendChild(U.el('span', {
          class: 'muted', style: { 'font-size': '11px', 'min-width': '58px' },
        }, `${e.year}${e.first ? ' · 1st look' : ''}`));
        row.appendChild(U.el('span', {
          class: 'num ' + U.gradeClass(mid),
          style: { 'font-weight': '700', 'font-variant-numeric': 'tabular-nums', 'min-width': '48px' },
        }, `${e.lo}–${e.hi}`));
        if (prevMid != null && Math.abs(mid - prevMid) >= 1) {
          row.appendChild(U.el('span', {
            style: {
              'font-weight': '700', 'font-size': '11px',
              color: mid > prevMid ? 'var(--success, #3fb950)' : 'var(--danger, #f85149)',
            },
          }, mid > prevMid ? '▲' : '▼'));
        }
        if (e.ovr != null) {
          row.appendChild(U.el('span', { class: 'muted', style: { 'font-size': '11px', 'margin-left': 'auto' } },
            `was a ${e.ovr} OVR`));
        }
        bookCard.appendChild(row);
        prevMid = mid;
      }
      bookCard.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', margin: '6px 0 0' } },
        'Your department\'s stamped winter reads. A card that sinks year over year is a dream ' +
        'dying; a player who keeps beating his band is telling you the book was too careful.'));
      body.appendChild(bookCard);
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
    body.appendChild(careerTable(state, p, years));
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

    // Transactions (0.75.0): the career paper trail — drafted, signed,
    // traded, claimed, released, extended, went overseas. Newest first.
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Transactions'));
    const tx = (p.txLog || []).slice().reverse();
    if (tx.length) {
      for (const e of tx) {
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `${e.y} — ${e.t}`));
      }
    } else {
      body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        'No transactions on file yet — moves record from here on.'));
    }

    // Injury history (0.75.0): the trainer's file has recorded every
    // stint since day one — now it's on the card. ⚠ marks the injuries
    // that changed a career.
    body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '16px' } }, 'Injury History'));
    const inj = (p.injuryHistory || []).slice().reverse();
    if (inj.length) {
      for (const e of inj) {
        const stint = e.ilType ? `${e.ilType} IL` : 'day-to-day';
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `${e.year} — ${e.name || 'Injury'} (${stint}, ${e.daysOut} day${e.daysOut === 1 ? '' : 's'})` +
          (e.careerAltering ? ' ⚠' : '')));
      }
    } else {
      body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
        'Clean bill of health — no injuries on file.'));
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
      // Consolidated by award (0.55.1): all MVPs first, then the rest in
      // prestige order — each line carries the count and the year list
      // (with the position for the per-position hardware).
      const ORDER = ['MVP', 'Cy Young', 'Rookie of the Year', 'Reliever of the Year',
        'Comeback Player of the Year', 'All-Star MVP', 'World Series MVP',
        'Silver Slugger', 'Gold Glove'];
      const family = (name) => String(name).replace(/ \([^)]*\)$/, '');
      const groups = {};
      for (const a of ach.awards) {
        const f = family(a.name);
        (groups[f] = groups[f] || []).push(a);
      }
      const keys = Object.keys(groups).sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
      });
      for (const f of keys) {
        const list = groups[f].slice().sort((a, b) => a.year - b.year);
        const detail = list.map((a) => {
          const m = String(a.name).match(/\(([^)]*)\)$/);
          return m ? `${a.year} (${m[1]})` : String(a.year);
        }).join(', ');
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '4px 0' } },
          `${list.length > 1 ? `${f} ×${list.length}` : f} — ${detail}`));
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

  // Flat card language (v2.8.0, owner mock): divider-columned stat
  // strips instead of boxed cells — two rows, counting stats over rate
  // stats, hairline verticals between columns.
  function statStrip(pairs) {
    const strip = U.el('div', { class: 'stat-strip' });
    for (const [k, v] of pairs) {
      const cell = U.el('div');
      cell.appendChild(U.el('div', { class: 'v' }, v));
      cell.appendChild(U.el('div', { class: 'k' }, k));
      strip.appendChild(cell);
    }
    return strip;
  }
  function emptyStatLine(text) {
    return U.el('p', { class: 'muted', style: { 'font-size': '13px', padding: '10px 0' } }, text);
  }

  function hitterStatGrid(s) {
    const wrap = U.el('div');
    if (!s || s.pa === 0) {
      wrap.appendChild(emptyStatLine('No games played yet'));
      return wrap;
    }
    wrap.appendChild(statStrip([
      ['G', String(s.g)], ['AB', String(s.ab)], ['H', String(s.h)], ['HR', String(s.hr)],
      ['RBI', String(s.rbi)], ['SB', String(s.sb)], ['BB', String(s.bb)], ['SO', String(s.k)],
    ]));
    wrap.appendChild(statStrip([
      ['AVG', S.fmtAvg(S.avg(s))], ['OBP', S.fmtAvg(S.obp(s))],
      ['SLG', S.fmtAvg(S.slg(s))], ['OPS', S.ops(s).toFixed(3)],
    ]));
    return wrap;
  }

  function pitcherStatGrid(s) {
    const wrap = U.el('div');
    if (!s || (s.ipOuts || 0) === 0) {
      wrap.appendChild(emptyStatLine('No games pitched yet'));
      return wrap;
    }
    wrap.appendChild(statStrip([
      ['G', String(s.g || 0)], ['GS', String(s.gs || 0)], ['W', String(s.w || 0)],
      ['L', String(s.l || 0)], ['SV', String(s.sv || 0)], ['IP', S.fmtIP(s.ipOuts || 0)],
    ]));
    wrap.appendChild(statStrip([
      ['H', String(s.h || 0)], ['ER', String(s.er || 0)], ['BB', String(s.bb || 0)],
      ['K', String(s.k || 0)], ['ERA', S.era(s).toFixed(2)], ['WHIP', S.whip(s).toFixed(2)],
    ]));
    return wrap;
  }

  // rep (optional): scouting report — band mode renders ranges instead of
  // exact grades (5.7). Exact cells with accumulated history are tappable
  // (0.33.0): the year-over-year chart is the archetype detective tool.
  // Flat row (v2.8.0, owner mock): label left, value right, hairline
  // under — no panel. Rows with accumulated history stay tappable
  // (0.33.0's year-over-year chart). Own young players show the
  // future grade inline ("45 / 60") — the boxed FanGraphs grid's
  // information, folded into the mock's language.
  function ratingCell(state, p, label, value, key, rep, futs) {
    const band = rep && rep.mode !== 'exact' ? rep.band(key) : null;
    const hist = !band && p.ratingsHistory &&
      Object.keys(p.ratingsHistory).some((y) => p.ratingsHistory[y][key] != null);
    const cell = U.el(hist ? 'button' : 'div', {
      class: 'flat-row',
      ...(hist ? {
        style: { cursor: 'pointer' },
        on: { click: () => { U.closeModal(); setTimeout(() => showRatingHistory(state, p, key, label), 0); } },
      } : {}),
    });
    cell.appendChild(U.el('span', { class: 'label' }, label + (hist ? ' ›' : '')));
    if (band) {
      const mid = (band[0] + band[1]) / 2;
      cell.appendChild(U.el('span', {
        class: 'value ' + U.gradeClass(mid),
      }, `${band[0]}–${band[1]}`));
    } else {
      const fut = futs && futs.futs ? futs.futs[key] : null;
      const g = Math.round(value);
      if (fut != null && fut > g) {
        cell.appendChild(U.el('span', { class: 'value' }, [
          U.el('span', { class: U.gradeClass(value) }, String(U.gradeFor(value))),
          U.el('span', { class: 'muted', style: { 'font-weight': '400' } }, ' / '),
          U.el('span', { class: U.gradeClass(fut) }, String(fut)),
        ]));
      } else {
        const v = U.ratingDisplay(value);
        v.classList.add('value');
        cell.appendChild(v);
      }
    }
    return cell;
  }

  // Year-over-year attribute chart (0.33.0): rollover snapshots plus the
  // live value, drawn on the 20-80 scale with the peak marked. Reading
  // the shape — early spike, long plateau, steady slide — is how you
  // profile a player's archetype without ever being told it.
  function showRatingHistory(state, p, key, label) {
    const hist = p.ratingsHistory || {};
    const years = Object.keys(hist)
      .filter((y) => hist[y][key] != null)
      .map(Number).sort((a, b) => a - b);
    const pts = years.map((y) => ({ year: y, age: y - p.birthYear, value: hist[y][key] }));
    const curYear = state.meta.currentDate.year;
    if (!p.retired && (!pts.length || pts[pts.length - 1].year < curYear)) {
      pts.push({ year: curYear, age: p.age, value: Math.round(p.ratings[key]), now: true });
    }

    const body = U.el('div');
    const peak = pts.reduce((a, b) => (b.value > a.value ? b : a), pts[0]);
    const cur = pts[pts.length - 1];
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `Peak ${peak.value} at age ${peak.age} • ${p.retired ? 'final' : 'now'} ${cur.value} at age ${cur.age}`));

    // Inline SVG line chart, 20-80 domain.
    const W = 300, H = 130, L = 26, R = 8, T = 10, B = 22;
    const x = (i) => pts.length === 1 ? W / 2 : L + i * ((W - L - R) / (pts.length - 1));
    const y = (v) => T + (80 - Math.max(20, Math.min(80, v))) * ((H - T - B) / 60);
    // Chart colors ride the design tokens (0.42.0): the line is the
    // franchise chrome color, the peak dot dugout green, and the grade-50
    // "league average" reference line glows scoreboard amber — a
    // telestrator touch. CSS vars resolve fine in DOM-injected SVG.
    const LINE = 'var(--chrome-primary, #58a6ff)';
    const PEAK = 'var(--field-bright, #3fb950)';
    const INK = 'var(--text-muted, #8b949e)';
    const MONO = 'font-family="ui-monospace, Consolas, monospace"';
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">`;
    for (const g of [20, 40, 60, 80]) {
      svg += `<line x1="${L}" y1="${y(g)}" x2="${W - R}" y2="${y(g)}" stroke="var(--border-strong, rgba(139,148,158,0.25))" stroke-opacity="0.55" stroke-width="1"/>`;
      svg += `<text x="${L - 4}" y="${y(g) + 3}" font-size="9" ${MONO} fill="${INK}" text-anchor="end">${g}</text>`;
    }
    svg += `<line x1="${L}" y1="${y(50)}" x2="${W - R}" y2="${y(50)}" stroke="var(--amber, #ffb52e)" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="3 4"/>`;
    if (pts.length > 1) {
      svg += `<polyline fill="none" stroke="${LINE}" stroke-width="2" points="${pts.map((pt, i) => `${x(i)},${y(pt.value)}`).join(' ')}"/>`;
    }
    pts.forEach((pt, i) => {
      const isPeak = pt === peak;
      svg += `<circle cx="${x(i)}" cy="${y(pt.value)}" r="${isPeak ? 4 : 2.5}" fill="${isPeak ? PEAK : LINE}"/>`;
    });
    svg += `<text x="${x(0)}" y="${H - 6}" font-size="9" ${MONO} fill="${INK}" text-anchor="middle">age ${pts[0].age}</text>`;
    if (pts.length > 1) {
      svg += `<text x="${x(pts.length - 1)}" y="${H - 6}" font-size="9" ${MONO} fill="${INK}" text-anchor="middle">age ${cur.age}</text>`;
    }
    svg += '</svg>';
    body.appendChild(U.el('div', { class: 'card', style: { padding: '8px' }, html: svg }));

    // Compact year rows under the chart.
    const list = U.el('div', { style: { 'font-size': '12px', 'margin-top': '8px', 'max-height': '180px', 'overflow-y': 'auto' } });
    for (const pt of pts) {
      list.appendChild(U.el('div', {
        style: { display: 'flex', 'justify-content': 'space-between', padding: '2px 4px',
          ...(pt === peak ? { color: 'var(--success, #3fb950)', 'font-weight': '600' } : {}) },
      }, [
        U.el('span', { class: pt === peak ? '' : 'muted' }, `${pt.year} — age ${pt.age}${pt.now ? ' (now)' : ''}`),
        U.el('span', { class: 'num' }, String(pt.value)),
      ]));
    }
    body.appendChild(list);
    if (pts.length <= 2) {
      body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '11px', 'margin-top': '6px' } },
        'History accumulates at each season rollover — check back as his career unfolds.'));
    }

    U.showModal({
      title: `${label} — ${p.name}`,
      body,
      fullScreen: true,
      actions: [{ label: 'Back to Card', kind: 'primary', onClick: () => {
        setTimeout(() => show(p.id), 0);
        return true;
      }}],
    });
  }

  // The scouts' development projection fills the grid's open corner —
  // always a range on the 20-80 scale (tier-dependent width), never a
  // hard number: nobody knows potential, not even your own staff.
  function potentialCell(pot) {
    const cell = U.el('div', { class: 'flat-row' });
    cell.appendChild(U.el('span', { class: 'label' }, 'Potential'));
    if (!pot) {
      cell.appendChild(U.el('span', { class: 'value muted' }, '??'));
    } else {
      const mid = (pot[0] + pot[1]) / 2;
      cell.appendChild(U.el('span', {
        class: 'value ' + U.gradeClass(mid),
      }, `${pot[0]}–${pot[1]}`));
    }
    return cell;
  }

  // Futures for the flat rows (v2.8.0): the cone card's condensed
  // present/future grades, mapped back to the per-attribute keys the
  // ratings table shows. Own players 27-and-under only — the same
  // gates the boxed grid used, now folded into the table itself.
  function futuresFor(state, p, rep) {
    if (p.age > 27 || !rep || rep.mode !== 'exact') return null;
    const SC = window.BBGM_SCOUT;
    const card = SC.coneCard && SC.coneCard(state, p);
    if (!card) return null;
    const byLabel = {};
    for (const row of card.rows) byLabel[row.label] = row.fut;
    const map = p.isPitcher
      ? { velocity: 'Velo', stuff: 'Stuff', movement: 'Move', control: 'Cmd' }
      : { contactVsR: 'Hit', contactVsL: 'Hit', powerVsR: 'Pow', powerVsL: 'Pow',
          discipline: 'App', defense: 'Glove', arm: 'Arm' };
    const futs = {};
    for (const k in map) {
      if (byLabel[map[k]] != null) futs[k] = byLabel[map[k]];
    }
    return { futs, fv: card.fv };
  }

  function hitterRatings(state, p, rep, pot, futs, withPot) {
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
    const grid = U.el('div', { class: 'flat-cols' });
    for (const [label, v, key] of items) grid.appendChild(ratingCell(state, p, label, v, key, rep, futs));
    if (withPot) grid.appendChild(potentialCell(pot));
    return grid;
  }

  function pitcherRatings(state, p, rep, pot, futs, withPot) {
    const r = p.ratings;
    const items = [
      ['Stuff', r.stuff, 'stuff'],
      ['Velocity', r.velocity, 'velocity'],
      ['Movement', r.movement, 'movement'],
      ['Control', r.control, 'control'],
      ['Stamina', r.stamina, 'stamina'],
    ];
    const grid = U.el('div', { class: 'flat-cols' });
    for (const [label, v, key] of items) grid.appendChild(ratingCell(state, p, label, v, key, rep, futs));
    if (withPot) grid.appendChild(potentialCell(pot));
    return grid;
  }

  function careerTable(state, p, years) {
    const isP = p.isPitcher;
    // Who he wore (0.65.2): season lines carry the club he finished the
    // year with (stamped at rollover, backfilled by migration); the
    // in-progress season reads the LIVE roster so a July trade shows
    // immediately. Unknown history renders as a quiet dash.
    const curYear = state.meta.currentDate.year;
    const abbrOf = (tid) => {
      const t = tid != null && state.league.teams.find((tt) => tt.id === tid);
      return t ? t.abbr : '—';
    };
    const teamFor = (y, s) =>
      (+y === curYear && !p.retired && p.teamId != null) ? abbrOf(p.teamId) : abbrOf(s.teamId);
    const wrap = U.el('div', { class: 'stats-scroll' });
    const table = U.el('table', { class: 'stats-table' });
    const thead = U.el('thead');
    const trh = U.el('tr');
    const headers = isP
      ? ['Year', 'Tm', 'G', 'GS', 'W', 'L', 'SV', 'IP', 'ERA', 'WHIP', 'K', 'BB']
      : ['Year', 'Tm', 'G', 'AB', 'H', 'HR', 'RBI', 'SB', 'AVG', 'OBP', 'SLG'];
    for (const h of headers) trh.appendChild(U.el('th', {}, h));
    thead.appendChild(trh);
    table.appendChild(thead);

    const rowFor = (label, s, cls, tm) => {
      const tr = U.el('tr', cls ? { style: { color: 'var(--text-muted)' } } : {});
      tr.appendChild(U.el('td', {}, label));
      tr.appendChild(U.el('td', {}, tm || ''));
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
    // Playoff lines collapse behind one toggle (0.65.2) — a long career
    // doubles its row count with October lines otherwise.
    const psRows = [];
    for (const y of years) {
      const s = p.stats[y];
      const tm = teamFor(y, s);
      const playedMLB = isP ? (s.ipOuts || 0) > 0 || (s.g || 0) > 0 : (s.pa || 0) > 0;
      if (playedMLB) tbody.appendChild(rowFor(y, s, false, tm));
      // Minor-league season line (stamped at rollover) — shown muted.
      if (s.minorsLine) tbody.appendChild(rowFor(`${y} ${s.minorsLine.level}`, s.minorsLine, true, tm));
      // Postseason line, muted, tagged, hidden until the toggle opens.
      if (s.postseason) {
        const tr = rowFor(`${y} PS`, s.postseason, true, tm);
        tr.style.display = 'none';
        psRows.push(tr);
        tbody.appendChild(tr);
      }
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
    if (!psRows.length) return wrap;
    const container = U.el('div');
    let open = false;
    const btn = U.el('button', {
      class: 'btn-secondary btn-sm',
      style: { 'margin-bottom': '8px' },
      on: { click: () => {
        open = !open;
        for (const r of psRows) r.style.display = open ? '' : 'none';
        btn.textContent = open ? '▾ Hide Playoffs' : `▸ Show Playoffs (${psRows.length})`;
      }},
    }, `▸ Show Playoffs (${psRows.length})`);
    container.appendChild(btn);
    container.appendChild(wrap);
    return container;
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
    const grid = U.el('div', {}, rows); // flat rows (v2.8.0) — no panel
    return grid;
  }

  // Extension offer (bible 16.11, rebuilt 0.70.0) — user-team players
  // only. Talks are stateful: the ask is stamped for the season, sour
  // offers stiffen it, and three strikes close the table until winter.
  function extensionSection(p) {
    const state = window.BBGM_STATE.get();
    if (p.retired || p.teamId !== state.meta.userTeamId) return null;
    const FA = window.BBGM_FA;
    const wrap = U.el('div', { style: { 'margin-top': '10px' } });
    wrap.appendChild(U.el('button', {
      class: 'btn-secondary btn-sm', style: { width: '100%' },
      on: { click: () => {
        const talks = FA.extensionTalks(state, p);
        window.BBGM_STATE.set(state); // persist the stamped ask
        if (talks.closed) {
          U.showModal({
            title: `Extend ${p.name}`,
            body: 'His camp has closed the book on extension talks this season. ' +
                  'He\'ll listen again next year — or the market will do the talking.',
            actions: [{ label: 'Close', kind: 'secondary', onClick: () => true }],
          });
          return;
        }
        const mkOffer = (label, years, total) => ({
          label, kind: 'primary',
          onClick: () => {
            const err = FA.offerExtension(state, p, years, Math.round(total * 10) / 10);
            window.BBGM_STATE.set(state); // insults/closures persist too
            if (err) U.showToast(err, 'warning', 6000);
            else {
              U.showToast(`${p.name} signs the extension.`, 'success');
              window.BBGM_MAIN.refresh();
            }
            return true;
          },
        });
        let mood = 'Players still under team control take a security discount; ' +
                   'walk-year players want market money.';
        if (talks.wantsMarket) {
          mood = 'Word is he wants to TEST THE MARKET — only a blow-away number keeps him off it.';
        } else if (talks.insults > 0) {
          mood = 'Talks have soured once already — the ask has stiffened, and his patience is thin.';
        }
        U.showModal({
          title: `Extend ${p.name}`,
          body: `His camp is asking ${talks.askYears} yr / $${talks.askTotal}M ` +
                `($${talks.askAAV}M AAV). ${mood}`,
          actions: [
            mkOffer(`Meet ask (${talks.askYears}y/$${talks.askTotal}M)`, talks.askYears, talks.askTotal),
            mkOffer('Lowball −15%', talks.askYears, talks.askTotal * 0.85),
            mkOffer('Blow him away +15%', talks.askYears, talks.askTotal * 1.15),
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
          ],
        });
      }},
    }, 'Offer Contract Extension…'));
    return wrap;
  }

  function insetRow(label, value) {
    // v2.8.0 (owner mock): rows are flat everywhere on the card —
    // hairline under, label left, value right, no panel.
    const r = U.el('div', { class: 'flat-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  // bioOf/fmtHeight shared with the Draft Hub's prospect cards (0.19.2) so
  // pool modals and the profile derive identical bio fallbacks.
  return { show, bioOf, fmtHeight };
})();
