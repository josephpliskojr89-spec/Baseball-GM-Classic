// Application entry point and orchestrator.
window.BBGM_MAIN = (function () {
  const U = window.BBGM_UI;
  const D = window.BBGM_DATES;
  const C = window.BBGM_CONSTANTS;

  let currentTab = 'home';
  let viewOptions = {};

  function init() {
    // Register service worker (fail silently)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }

    // Surface persistence failures loudly. A save that silently stops
    // persisting (quota, private-browsing eviction, IDB corruption) is the
    // worst failure mode this app has — the user keeps playing and loses
    // everything on refresh. Toast on every failure, full modal once.
    let saveErrorModalShown = false;
    window.BBGM_STATE.onSaveError((err) => {
      U.showToast('SAVE FAILED — your progress is not being saved.', 'danger', 6000);
      if (saveErrorModalShown) return;
      saveErrorModalShown = true;
      U.showModal({
        title: 'Save Failure',
        body: 'The game could not write your save (' + ((err && err.name) || 'unknown error') + '). ' +
              'Your progress since the last successful save will be lost if you close this page. ' +
              'Export your save now as a backup, then try freeing storage space or restarting the browser.',
        actions: [
          { label: 'Export Save', kind: 'primary', onClick: () => { window.BBGM_STATE.exportToFile(); return true; } },
          { label: 'OK', kind: 'secondary', onClick: () => true },
        ],
      });
    });

    // Check for existing save (async — IndexedDB). The Continue button
    // stays hidden until the check confirms a save exists.
    let saveExists = false;
    const loadBtn = document.getElementById('btnLoadGame');
    loadBtn.disabled = true;
    loadBtn.classList.add('hidden');
    window.BBGM_STATE.hasSave().then((has) => {
      saveExists = has;
      if (has) {
        loadBtn.disabled = false;
        loadBtn.classList.remove('hidden');
      }
    });

    // Wire splash buttons
    document.getElementById('btnNewGame').addEventListener('click', () => {
      if (saveExists) {
        U.showModal({
          title: 'Start a New Game?',
          body: 'You have an existing save. Starting a new game will erase it.',
          actions: [
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
            { label: 'Erase & New', kind: 'danger', onClick: () => {
              window.BBGM_STATE.reset().then(() => startNewGameFlow());
            }},
          ],
        });
      } else {
        startNewGameFlow();
      }
    });
    loadBtn.addEventListener('click', () => {
      window.BBGM_STATE.load().then((s) => {
        if (s) startGame(s);
        else U.showToast('No save found.', 'warning');
      }).catch((e) => {
        U.showToast('Load failed: ' + e.message, 'danger');
      });
    });
    document.getElementById('btnImportGame').addEventListener('click', () => {
      const input = document.getElementById('fileImport');
      input.value = '';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        window.BBGM_STATE.importFromFile(file).then((s) => {
          U.showToast('Save imported.', 'success');
          startGame(s);
        }).catch((err) => {
          U.showToast('Import failed: ' + err.message, 'danger');
        });
      };
      input.click();
    });

    // Wire bottom nav
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        navigate(btn.dataset.tab);
      });
    });

    // Wire advance day
    document.getElementById('btnAdvance').addEventListener('click', () => advanceDay());

    // Menu lives in the header's top-right (0.16.2), not the bottom nav.
    document.getElementById('btnMenu').addEventListener('click', () => navigate('menu'));

    // Modal close on backdrop click
    document.getElementById('modalRoot').addEventListener('click', (e) => {
      if (e.target.id === 'modalRoot') U.closeModal();
    });

    // Flush the debounced save when the page goes away. The 400ms save
    // debounce means a user who makes a move and immediately backgrounds
    // or closes the tab (routine on mobile PWAs) could lose that move —
    // pagehide/visibilitychange are the last reliable moments to write.
    window.addEventListener('pagehide', () => { window.BBGM_STATE.saveNow(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') window.BBGM_STATE.saveNow();
    });
  }

  // ------- New game flow -------
  function startNewGameFlow() {
    showProgressForGen();
    setTimeout(() => {
      try {
        const seed = Math.floor(Math.random() * 0xffffffff);
        const rng = window.BBGM_RNG.makeRng(seed);
        const league = window.BBGM_LEAGUE_GEN.generate(rng);
        const players = window.BBGM_PLAYER_GEN.generate(rng, league);

        // Validate league readiness BEFORE schedule generation. If any team
        // is malformed (missing rotation, lineup too short, etc.) we fail
        // fast — never write a save we can't simulate.
        try {
          window.BBGM_PLAYER_GEN.validateLeagueReadiness(league, players);
        } catch (e) {
          console.error('League readiness validation failed:', e);
          U.hideProgress();
          U.showModal({
            title: 'Team Generation Failed',
            body: 'One or more generated teams are not ready to play: ' + e.message,
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Try Again', kind: 'primary', onClick: () => startNewGameFlow() },
            ],
          });
          return;
        }

        // Generate schedule with hard guarantee. Throws on failure.
        let schedule;
        try {
          schedule = window.BBGM_SCHEDULE.generate(rng, league, C.START_YEAR);
        } catch (e) {
          console.error('Schedule generation failed:', e, e.lastIssues || []);
          U.hideProgress();
          U.showModal({
            title: 'Schedule Generation Failed',
            body: 'The schedule generator could not produce a valid 162-game season for ' +
                  'every team. This is rare. Try generating again with a new random seed.',
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Try Again', kind: 'primary', onClick: () => startNewGameFlow() },
            ],
          });
          return;
        }

        // Belt-and-suspenders: validate the returned schedule before saving.
        const result = window.BBGM_SCHEDULE.validate(schedule, league);
        if (!result.valid) {
          console.error('Schedule passed generate() but failed validate():', result.issues);
          U.hideProgress();
          U.showModal({
            title: 'Schedule Validation Failed',
            body: 'The schedule generator returned a schedule that does not pass validation. ' +
                  'This should not happen. Try again.',
            actions: [
              { label: 'Cancel', kind: 'secondary', onClick: () => true },
              { label: 'Try Again', kind: 'primary', onClick: () => startNewGameFlow() },
            ],
          });
          return;
        }

        const state = {
          version: C.VERSION,
          meta: {
            seed,
            created: new Date().toISOString(),
            currentDate: D.fromYMD(C.START_YEAR, 3, 28), // Opening day
            userTeamId: null, // chosen on team-select screen
            gamesPlayedByTeam: {},
          },
          league: { teams: league.teams, schedule },
          players,
          news: [],
          freeAgents: [],
          history: { seasons: [] },
        };
        // Staff the league (bible 17): every team gets a manager + coaches,
        // plus the standing unemployed pool. Then each manager sets his
        // team's lineups per his own style (Pillar 4).
        window.BBGM_STAFF.ensureStaff(state);
        window.BBGM_SCOUT.ensureTiers(state);
        for (const t of state.league.teams) {
          window.BBGM_ROSTER.safeRebuild(state, t);
        }
        window.BBGM_STATE.set(state);
        U.hideProgress();
        showTeamSelect();
      } catch (e) {
        console.error(e);
        U.hideProgress();
        U.showToast('Generation failed: ' + e.message, 'danger');
      }
    }, 50);
  }

  function showProgressForGen() {
    U.showProgress('Generating league…');
  }

  function showTeamSelect() {
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    const screen = document.getElementById('teamSelect');
    screen.classList.remove('hidden');
    const list = document.getElementById('teamSelectList');
    U.clearChildren(list);
    const state = window.BBGM_STATE.get();

    // Sort teams by canonical NABL ordering, then by team name within each
    // division so the team-select grid follows the bible's structural order.
    const teams = state.league.teams.slice().sort((a, b) => {
      const byDiv = U.compareTeamsByDivision(a, b);
      if (byDiv !== 0) return byDiv;
      return a.name.localeCompare(b.name);
    });

    let lastGroup = '';
    for (const t of teams) {
      const grp = `${t.league} ${t.division}`;
      if (grp !== lastGroup) {
        list.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '12px' } }, grp));
        lastGroup = grp;
      }
      const btn = U.el('button', {
        class: 'team-pick',
        on: { click: () => chooseTeam(t.id) }
      });
      btn.appendChild(U.teamCap(t, { size: 'lg' }));
      const info = U.el('div', { class: 'team-pick-info' });
      info.appendChild(U.el('div', { class: 'team-pick-name' }, t.name));
      info.appendChild(U.el('div', { class: 'team-pick-meta' },
        `${t.market[0].toUpperCase() + t.market.slice(1)} Market • ${t.ownerName} • ${t.competitiveWindow}`));
      btn.appendChild(info);
      list.appendChild(btn);
    }

    document.getElementById('btnRegenerate').onclick = () => {
      window.BBGM_STATE.reset().then(() => startNewGameFlow());
    };
  }

  function chooseTeam(teamId) {
    const state = window.BBGM_STATE.get();
    state.meta.userTeamId = teamId;
    window.BBGM_STATE.set(state);
    document.getElementById('teamSelect').classList.add('hidden');
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    currentTab = 'home';
    refresh();
    const team = state.league.teams.find((t) => t.id === teamId);
    U.showToast(`Welcome to the ${team.name}.`, 'success');
  }

  function startGame(state) {
    document.getElementById('splash').classList.add('hidden');

    // Pre-NABL saves used randomly generated team names and the 'A' / 'B'
    // league naming. Those identities are no longer in the codebase, so
    // continuing such a save would produce broken renders and bad league
    // membership. Reject them with a clear message.
    if (savePreNABL(state)) {
      // Keep the splash visible behind the modal — hiding it leaves the
      // rejection dialog floating over a blank page.
      document.getElementById('splash').classList.remove('hidden');
      U.showModal({
        title: 'Old Save Not Supported',
        body: 'This save was created with the old random-team system. The game now uses ' +
              'the fixed NABL 30-team league, so older saves cannot be continued. ' +
              'Start a new game to use the NABL teams. Your old save will be erased.',
        actions: [
          { label: 'Start New Game', kind: 'danger', onClick: () => {
            window.BBGM_STATE.reset().then(() => location.reload());
            return false; // keep modal up until reload
          }},
        ],
      });
      return;
    }

    // Migrations below are gated on the version the save last ran under.
    // Captured BEFORE the stamp at the end of this block — 0.19.1 is the
    // first release that moves state.version forward on load (previously
    // it only ever recorded the version the save was created at, which is
    // why ungated migrations re-ran forever).
    const saveVersion = state.version || '0.1.0';

    // Migration: pre-0.10 saves have no staff — hire the league out of a
    // fresh pool so managers exist mid-save (Pillar 4).
    if (!state.staff) {
      window.BBGM_STAFF.ensureStaff(state);
      window.BBGM_STATE.set(state);
    }

    // Migration: pre-0.15 saves have no scouting tiers (Phase 13).
    if (state.league.teams.some((t) => !t.scoutingTier)) {
      window.BBGM_SCOUT.ensureTiers(state);
      window.BBGM_STATE.set(state);
    }

    // Migration: 0.14.0 shipped a bad weight formula (everyone pinned at
    // the 160 lb clamp). Rebuild implausibly light persisted weights on
    // the corrected scale (~197 lb at 6'0", +6/inch). Version-gated: the
    // predicate overlaps ~5% of legitimately light modern players, so it
    // must not re-run on every load.
    let fixedWeights = false;
    if (versionLt(saveVersion, '0.15.0'))
    for (const id in state.players) {
      const pl = state.players[id];
      if (pl.weightLb != null && pl.heightIn != null &&
          pl.weightLb < (pl.heightIn - 60) * 6 + 105) {
        let h = 0;
        for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
        pl.weightLb = Math.max(165, Math.min(270,
          Math.round((pl.heightIn - 60) * 6 + 125 + (h % 30) - 15)));
        fixedWeights = true;
      }
    }
    if (fixedWeights) window.BBGM_STATE.set(state);

    // Migration: 0.12 merged A+ into A (four-level ladder).
    let mergedAPlus = false;
    for (const id in state.players) {
      if (state.players[id].rosterStatus === 'A+') {
        state.players[id].rosterStatus = 'A';
        mergedAPlus = true;
      }
    }
    if (mergedAPlus) window.BBGM_STATE.set(state);

    // Migration: 0.17.1 added country name pools for international
    // prospects. Rename the UNSIGNED pending pool in place (they have no
    // game history yet); signed players and past classes keep the names
    // they made their history under. Version-gated: pre-0.19.1 saves never
    // stamped their version forward, so this ran on EVERY load and
    // re-rolled the pool's names each time the game opened.
    if (versionLt(saveVersion, '0.17.1') &&
        state.intl && state.intl.prospects && window.BBGM_INTL_NAMES) {
      let renamed = false;
      for (const id in state.intl.prospects) {
        const pr = state.intl.prospects[id];
        // Signed pool entries share their object with state.players —
        // only rename prospects still on the open market.
        if (pr.teamId || pr.status !== 'intl') continue;
        const drawn = window.BBGM_INTL_NAMES.nameFor(pr.origin || pr.country, Math.random);
        if (!drawn) continue;
        pr.firstName = drawn.first;
        pr.lastName = drawn.last;
        pr.name = `${drawn.first} ${drawn.last}`;
        renamed = true;
      }
      if (renamed) window.BBGM_STATE.set(state);
    }

    // Migration: 0.19.2 backfills full birthdates (and any missing
    // height/weight) onto players and pool prospects created by builds
    // that predate the bio fields — persisted once so the profile and the
    // new prospect cards never fall back at render time. Values use the
    // same unsigned id-hash the card fallback uses, so nothing the user
    // has already seen (post-fix) changes.
    if (versionLt(saveVersion, '0.19.2')) {
      let stamped = false;
      const stampBio = (p) => {
        if (!p || !p.id) return;
        if (p.birthMonth != null && p.birthDay != null && p.heightIn != null && p.weightLb != null) return;
        let h = 0;
        for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
        if (p.heightIn == null) p.heightIn = 70 + (h % 9);
        if (p.weightLb == null) {
          p.weightLb = Math.max(165, Math.min(270,
            Math.round((p.heightIn - 60) * 6 + 125 + ((h >>> 4) % 30) - 15)));
        }
        if (p.birthMonth == null) p.birthMonth = 1 + ((h >>> 8) % 12);
        if (p.birthDay == null) p.birthDay = 1 + ((h >>> 12) % 28);
        stamped = true;
      };
      for (const id in state.players) stampBio(state.players[id]);
      if (state.draft && state.draft.prospects) {
        for (const id in state.draft.prospects) stampBio(state.draft.prospects[id]);
      }
      if (state.intl && state.intl.prospects) {
        for (const id in state.intl.prospects) stampBio(state.intl.prospects[id]);
      }
      if (stamped) window.BBGM_STATE.set(state);
    }

    // Stamp the save forward now that every migration has run. This is
    // what makes the versionLt gates above one-shot, and it makes the
    // Menu's "Save version" reflect the code the save actually runs under
    // rather than the release it was created in.
    if (state.version !== C.VERSION) {
      state.version = C.VERSION;
      window.BBGM_STATE.set(state);
    }

    if (state.meta.userTeamId) {
      document.getElementById('app').classList.remove('hidden');
      refresh();
    } else {
      showTeamSelect();
    }
  }

  // Numeric semver comparison: is version a < version b? Plain string
  // comparison breaks at 0.10.0 ('0.10.0' < '0.3.0' lexicographically),
  // so components are compared as numbers.
  function versionLt(a, b) {
    const pa = String(a).split('.');
    const pb = String(b).split('.');
    for (let i = 0; i < 3; i++) {
      const x = parseInt(pa[i], 10) || 0;
      const y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x < y;
    }
    return false;
  }

  // Pre-NABL saves either have version < '0.3.0' or contain teams with the
  // legacy 'A' / 'B' league values. Either condition flags the save as
  // unsupported. (This gate supersedes the older broken-schedule check —
  // every pre-0.3.0 save is rejected here before schedule quality matters.)
  function savePreNABL(state) {
    if (!state || !state.league || !Array.isArray(state.league.teams)) return false;
    const v = state.version || '0.1.0';
    if (versionLt(v, '0.3.0')) return true;
    for (const t of state.league.teams) {
      if (t.league === 'A' || t.league === 'B') return true;
    }
    return false;
  }

  // ------- Navigation -------
  function navigate(tab, options = {}) {
    // Back-compat: the Games view folded into League → Scores (0.13).
    if (tab === 'games') {
      tab = 'league';
      options = { tab: 'scores', ...options };
    }
    // Back-compat: stats / leaders / awards moved from League to the
    // Players nav tab (0.16.1) — old deep links keep working.
    if (tab === 'league' && ['stats', 'leaders', 'awards'].includes(options.tab)) {
      tab = 'players';
    }
    // Back-compat: staff / trades / free agents moved from Team to the
    // GM nav tab (0.16.2).
    if (tab === 'team' && ['staff', 'trades', 'freeagents'].includes(options.tab)) {
      tab = 'gm';
    }
    currentTab = tab;
    viewOptions = options;
    refresh();
    // Update nav buttons (+ the header menu button, which acts as the
    // Menu tab's nav entry).
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const menuBtn = document.getElementById('btnMenu');
    if (menuBtn) menuBtn.classList.toggle('active', tab === 'menu');
  }

  function refresh() {
    const state = window.BBGM_STATE.get();
    if (!state || !state.meta.userTeamId) return;
    updateHeader(state);
    const main = document.getElementById('mainView');
    const opts = viewOptions || {};
    viewOptions = {};
    switch (currentTab) {
      case 'home': window.BBGM_UI_DASHBOARD.render(main, state); break;
      case 'team': window.BBGM_UI_TEAM.render(main, state, opts); break;
      case 'league': window.BBGM_UI_LEAGUE.render(main, state, opts); break;
      case 'players': window.BBGM_UI_PLAYERS.render(main, state, opts); break;
      case 'gm': window.BBGM_UI_GM.render(main, state, opts); break;
      case 'draft': window.BBGM_UI_DRAFT.render(main, state, opts); break;
      case 'menu': window.BBGM_UI_MENU.render(main, state); break;
      default: window.BBGM_UI_DASHBOARD.render(main, state);
    }
    // Scroll to top on tab switch
    main.scrollTop = 0;
  }

  function updateHeader(state) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    document.getElementById('hdrDate').textContent = D.format(state.meta.currentDate);
    document.getElementById('hdrRecord').textContent =
      `${team.seasonRecord.w}-${team.seasonRecord.l}`;
  }

  // ------- Sim controls -------
  function advanceDay() {
    const state = window.BBGM_STATE.get();
    if (!state) return;
    if (state.meta.offseasonPhase === 'freeAgency') {
      advanceFAPeriod();
      return;
    }
    const today = state.meta.currentDate;
    const seasonEnd = state.league.schedule.seasonEnd;
    if (D.compare(today, seasonEnd) >= 0) {
      // October plays on the calendar: start the bracket, advance it day
      // by day, then open the offseason once the champion is crowned.
      const ps = state.postseason;
      if (!ps) {
        confirmPostseasonStart(state);
      } else if (ps.phase === 'complete') {
        confirmOffseason(state);
      } else {
        simDays(1);
      }
      return;
    }
    // Draft day (bible 13.1): June 30 halts the sim until the class is
    // drafted. The games resume the moment the draft wraps.
    if (window.BBGM_DRAFT.draftDayPending(state, today)) {
      showDraftDayModal(state);
      return;
    }
    // International signing day (bible 14.1): July 2 halts the sim until
    // the window is worked (or auto-run from the hub).
    if (window.BBGM_INTL.windowPending(state, today)) {
      showIntlWindowModal(state);
      return;
    }
    simDays(1);
  }

  function showIntlWindowModal(state) {
    const year = state.meta.currentDate.year;
    U.showModal({
      title: `International Signing Day — ${year}`,
      body: `The July 2 international signing window is open. ~100 prospects, ` +
            `your bonus pool, and 29 rival front offices. The season resumes ` +
            `once the window closes.`,
      actions: [
        { label: 'Not Yet', kind: 'secondary', onClick: () => true },
        { label: 'Open the Signing Window', kind: 'primary', onClick: () => {
          navigate('draft', { tab: 'intl' });
          return true;
        }},
      ],
    });
  }

  function showDraftDayModal(state) {
    const year = state.meta.currentDate.year;
    U.showModal({
      title: `Draft Day — ${year}`,
      body: `The ${year} NABL Amateur Draft is today. Ten rounds, 300 picks, ` +
            `and your scouting department is on the clock. The season resumes ` +
            `once the draft is complete.`,
      actions: [
        { label: 'Not Yet', kind: 'secondary', onClick: () => true },
        { label: 'Go to the Draft Hub', kind: 'primary', onClick: () => {
          navigate('draft');
          return true;
        }},
      ],
    });
  }

  // ------- Postseason (day-by-day) + interactive offseason -------

  function confirmPostseasonStart(state) {
    const year = state.meta.currentDate.year;
    U.showModal({
      title: `${year} Postseason`,
      body: `162 games are in the books and the seeds are locked. Twelve clubs, ` +
            `four rounds, one champion. Wild-card games start in three days — ` +
            `advance day by day, or sim the rest from the dashboard.`,
      actions: [
        { label: 'Not Yet', kind: 'secondary', onClick: () => true },
        { label: 'Start the Postseason', kind: 'primary', onClick: () => {
          const ps = window.BBGM_OFFSEASON.startPostseason(state);
          pushPostseasonStartNews(state, ps);
          window.BBGM_STATE.set(state);
          navigate('league', { tab: 'playoffs' });
          return true;
        }},
      ],
    });
  }

  function pushPostseasonStartNews(state, ps) {
    if (!state.news) state.news = [];
    const date = { ...state.meta.currentDate };
    const userTeamId = state.meta.userTeamId;
    const inField = ps.seeds.east.concat(ps.seeds.west).includes(userTeamId);
    const userTeam = state.league.teams.find((t) => t.id === userTeamId);
    state.news.push({
      date,
      body: `<strong>The ${ps.year} postseason field is set.</strong> ` +
            (inField
              ? `The ${userTeam.name} are in — seed #${(ps.seeds.east.indexOf(userTeamId) + 1) || (ps.seeds.west.indexOf(userTeamId) + 1)} in the ${userTeam.league === 'east' ? U.leagueName('east') : U.leagueName('west')} League.`
              : `The ${userTeam.name} missed the cut — scoreboard-watch October and plan the offseason.`),
    });
  }

  function showChampionModal(state) {
    const ps = state.postseason;
    if (!ps) return;
    const ws = ps.series.find((s) => s.tag === 'ws');
    const champ = state.league.teams.find((t) => t.id === ws.winnerId);
    const loser = state.league.teams.find((t) => t.id === ws.loserId);
    const score = ws.hw >= ws.lw ? `${ws.hw}-${ws.lw}` : `${ws.lw}-${ws.hw}`;
    U.showModal({
      title: `${ps.year} World Series`,
      body: `The ${champ.name} defeat the ${loser.name} ${score} to win the ${ps.year} ` +
            `World Series! Begin the offseason when you're ready.`,
      actions: [
        { label: 'View Bracket', kind: 'secondary', onClick: () => {
          navigate('league', { tab: 'playoffs' });
          return true;
        }},
        { label: 'Begin the Offseason', kind: 'primary', onClick: () => {
          setTimeout(() => runOffseasonPartAFlow(state), 50);
          return true;
        }},
      ],
    });
  }

  function confirmOffseason(state) {
    const year = state.meta.currentDate.year;
    U.showModal({
      title: 'Postseason Complete',
      body: `The ${year} season is fully in the books. Begin the offseason? ` +
            `Retirements and player development run, then free agency opens — you'll be able ` +
            `to bid on the market before Opening Day ${year + 1}.`,
      actions: [
        { label: 'Cancel', kind: 'secondary', onClick: () => true },
        { label: 'Begin the Offseason', kind: 'primary', onClick: () => {
          setTimeout(() => runOffseasonPartAFlow(state), 50);
          return true;
        }},
      ],
    });
  }

  // Deep snapshot of the whole save. The rollover mutates hundreds of
  // objects across many steps; if it throws partway, the ONLY safe state
  // to persist is the one from before it started. State is plain JSON
  // (it round-trips through export/import), so both clone paths are exact.
  function snapshotState(state) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(state);
    } catch (e) { /* fall through to JSON */ }
    return JSON.parse(JSON.stringify(state));
  }

  // backup: the pre-rollover snapshot to restore. Never persist the
  // half-mutated state — an error mid-Part-A used to save a league with
  // the postseason consumed but awards/retirements/market incomplete,
  // which no retry could repair.
  function offseasonError(e, backup) {
    console.error('Offseason failed:', e);
    if (backup) window.BBGM_STATE.set(backup);
    window.BBGM_STATE.setSaveBlocked(false);
    window.BBGM_STATE.saveNow();
    U.hideProgress();
    refresh();
    U.showModal({
      title: 'Offseason Error',
      body: 'The offseason hit an error: ' + e.message +
            (backup ? '\n\nYour save was restored to the moment before the offseason started — nothing was lost. Trying again may succeed.' : '') +
            '\n\nOpen the browser console for details.',
      actions: [{ label: 'OK', kind: 'primary', onClick: () => true }],
    });
  }

  function runOffseasonPartAFlow(state) {
    U.showProgress('Opening the offseason…');
    window.BBGM_STATE.setSaveBlocked(true);
    const backup = snapshotState(state);
    setTimeout(() => {
      try {
        const summary = window.BBGM_OFFSEASON.runSeasonRolloverPartA(state);
        pushOffseasonNews(state, summary);
        window.BBGM_STATE.setSaveBlocked(false);
        window.BBGM_STATE.saveNow();
        U.hideProgress();
        refresh();
        const champ = state.league.teams.find((t) => t.id === summary.postseason.champion.id);
        U.showModal({
          title: 'The Offseason Begins',
          body: `The ${champ.name} take home the ${summary.year} title. ` +
                `${summary.retirements.length} players retired and ${summary.newFAs} hit free agency. ` +
                `The market is open — work it from GM → Free Agents, advance the ` +
                `signing period from the dashboard, and start the season when you're done.`,
          actions: [{ label: 'To the Offseason', kind: 'primary', onClick: () => true }],
        });
      } catch (e) {
        offseasonError(e, backup);
      }
    }, 50);
  }

  function advanceFAPeriod() {
    const state = window.BBGM_STATE.get();
    if (!state || state.meta.offseasonPhase !== 'freeAgency') return;
    const result = window.BBGM_OFFSEASON.advanceFARound(state);
    window.BBGM_STATE.set(state);
    refresh();
    const userSignings = result.signings.filter((s) => s.isUser);
    if (userSignings.length) {
      const names = userSignings.map((s) => state.players[s.entry.playerId].name).join(', ');
      U.showToast(`Signed: ${names}!`, 'success', 5000);
    } else {
      U.showToast(`FA period ${result.round}/${state.faMarket.totalRounds} — ${result.signings.length} players signed league-wide.`, 'info');
    }
    if (result.done) {
      U.showModal({
        title: 'Free Agency Winding Down',
        body: 'The market has run its course. Start the season?',
        actions: [
          { label: 'Not Yet', kind: 'secondary', onClick: () => true },
          { label: 'Start Season', kind: 'primary', onClick: () => {
            setTimeout(() => startSeasonFlow(state), 50);
            return true;
          }},
        ],
      });
    }
  }

  function startSeasonFlow(state) {
    U.showProgress('Spring training…');
    window.BBGM_STATE.setSaveBlocked(true);
    const backup = snapshotState(state);
    setTimeout(() => {
      try {
        const summary = window.BBGM_OFFSEASON.runSeasonRolloverPartB(state);
        if (!state.news) state.news = [];
        state.news.push({
          date: { ...state.meta.currentDate },
          body: `The ${summary.newYear} season begins — spring training set the lineups and rotations league-wide.`,
        });

        // ---- Opening Day report (18.13 / 11.8) --------------------------
        const players = state.players;
        const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
        const ST = summary.springTraining || { battles: [], injuries: [], userLevelMoves: 0 };
        const myInjuries = ST.injuries.filter((i) => i.teamId === userTeam.id);

        // Season expectation: roster strength vs the league.
        const strengthOf = (t) => {
          const vals = t.roster.map((id) => players[id]).filter(Boolean)
            .map((p) => window.BBGM_ROSTER.overall(p)).sort((a, b) => b - a).slice(0, 18);
          return vals.reduce((sum, v) => sum + v, 0) / Math.max(1, vals.length);
        };
        const all = state.league.teams.map(strengthOf);
        const mean = all.reduce((s, v) => s + v, 0) / all.length;
        const sd = Math.sqrt(all.reduce((s, v) => s + (v - mean) * (v - mean), 0) / all.length) || 1;
        const projWins = Math.max(58, Math.min(104,
          Math.round(81 + ((strengthOf(userTeam) - mean) / sd) * 11)));
        const outlook = projWins >= 92 ? 'The projection says contender — October is the expectation.'
          : projWins >= 84 ? 'The projection has you in the race — a hot month could change everything.'
          : projWins >= 76 ? 'A scrappy season on paper — overachieve and sneak into the mix.'
          : 'The projection calls it a building year — develop the kids and keep the powder dry.';

        // Storylines: the big addition and the prospect to watch.
        let addition = null;
        if (state.faMarket) {
          const mine = state.faMarket.entries
            .filter((e) => e.signedTeamId === userTeam.id)
            .sort((a, b) => b.askTotal - a.askTotal)[0];
          if (mine && players[mine.playerId]) addition = players[mine.playerId];
        }
        let prospect = null, bestCeil = 0;
        for (const pid of userTeam.minors || []) {
          const p = players[pid];
          if (!p || !p.hidden || !p.hidden.ceiling) continue;
          const keys = Object.keys(p.hidden.ceiling).filter((k) => k !== 'stamina');
          const c = keys.length ? Math.max(...keys.map((k) => p.hidden.ceiling[k])) : 0;
          if (c > bestCeil) { bestCeil = c; prospect = p; }
        }

        const body = U.el('div');
        body.appendChild(U.el('p', { style: { 'font-size': '14px', 'margin-bottom': '8px' } },
          `The writers project the ${userTeam.name} at ` +
          `${projWins}-${162 - projWins}. ${outlook}`));
        const lines = [];
        if (addition) lines.push(`Key addition: ${addition.name} (${addition.primaryPosition}).`);
        if (prospect) lines.push(`Prospect to watch: ${prospect.name} (${prospect.primaryPosition}, ${prospect.rosterStatus}).`);
        for (const b of ST.battles) {
          lines.push(b.pos === 'SP5'
            ? `Camp battle: ${b.winner} holds the last rotation spot over ${b.runnerUp}.`
            : `Camp battle at ${b.pos}: ${b.winner} beats out ${b.runnerUp}.`);
        }
        for (const i of myInjuries) {
          lines.push(`Delayed start: ${i.name} (${i.type}, ~${i.days} days).`);
        }
        if (ST.userLevelMoves) lines.push(`${ST.userLevelMoves} farm assignment${ST.userLevelMoves !== 1 ? 's' : ''} confirmed for the season.`);
        if (lines.length) {
          const ul = U.el('div', { style: { 'font-size': '13px' } });
          for (const l of lines) ul.appendChild(U.el('p', { style: { margin: '4px 0' } }, `• ${l}`));
          body.appendChild(ul);
        }
        body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-top': '8px' } },
          'Lineups and rotations are set league-wide. Play ball!'));

        // Camp results land in the feed too (11.8's notifications).
        for (const b of ST.battles) {
          state.news.push({
            date: { ...state.meta.currentDate },
            body: b.pos === 'SP5'
              ? `Spring battle settled: <strong>${b.winner}</strong> wins the 5th-starter job over ${b.runnerUp}.`
              : `Spring battle settled at ${b.pos}: <strong>${b.winner}</strong> beats out ${b.runnerUp}.`,
          });
        }
        for (const i of myInjuries) {
          state.news.push({
            date: { ...state.meta.currentDate },
            body: `<strong>${i.name}</strong> tweaked something in camp (${i.type}) — ` +
                  `he'll miss roughly the first ${i.days} days.`,
          });
        }

        window.BBGM_STATE.setSaveBlocked(false);
        window.BBGM_STATE.saveNow();
        U.hideProgress();
        navigate('home');
        U.showModal({
          title: `Opening Day ${summary.newYear}`,
          body,
          actions: [{ label: 'Play Ball', kind: 'primary', onClick: () => true }],
        });
      } catch (e) {
        offseasonError(e, backup);
      }
    }, 50);
  }

  function pushOffseasonNews(state, summary) {
    if (!state.news) state.news = [];
    const date = { ...state.meta.currentDate };
    // The offseason calendar (18.1): news items carry the dates the real
    // calendar would put them on — awards week in early November, the
    // non-tender deadline in December, the HoF vote in January — so the
    // feed reads like a winter, not a single dump.
    const nov = (day) => ({ year: summary.year, month: 11, day });
    const dec = (day) => ({ year: summary.year, month: 12, day });
    const jan = (day) => ({ year: summary.year + 1, month: 1, day });
    const teamOf = (id) => state.league.teams.find((t) => t.id === id);
    const userTeamId = state.meta.userTeamId;

    const champ = teamOf(summary.postseason.champion.id);
    const runnerUp = teamOf(summary.postseason.runnerUp.id);
    const ws = summary.postseason.worldSeries;
    state.news.push({
      date: { year: summary.year, month: 10, day: 30 },
      body: `<strong>${champ.name}</strong> defeat the ${runnerUp.name} ${ws.score[0]}-${ws.score[1]} ` +
            `to win the ${summary.year} World Series.`,
    });

    // Awards week (18.3): the marquee hardware, both leagues.
    if (summary.awards) {
      for (const lg of ['east', 'west']) {
        const a = summary.awards[lg];
        if (!a) continue;
        const lgName = U.leagueName(lg);
        const line = (label, w) => w ? `${label}: <strong>${w.winner.name}</strong> (${teamOf(w.winner.teamId) ? teamOf(w.winner.teamId).abbr : '—'})` : null;
        const parts = [line('MVP', a.mvp), line('Cy Young', a.cy), line('Rookie of the Year', a.roy),
          line('Manager of the Year', a.moy)].filter(Boolean);
        if (parts.length) {
          state.news.push({
            date: nov(lg === 'east' ? 3 : 4),
            body: `<strong>🏅 ${lgName} League awards:</strong> ${parts.join(' • ')}. ` +
                  `Full results and voting in Players → Awards.`,
          });
        }
      }
      // User-team winners get their own headline.
      for (const lg of ['east', 'west']) {
        const a = summary.awards[lg];
        if (!a) continue;
        const userWins = [];
        for (const [label, w] of [['MVP', a.mvp], ['Cy Young', a.cy], ['Rookie of the Year', a.roy],
          ['Reliever of the Year', a.reliever], ['Comeback Player of the Year', a.comeback]]) {
          if (w && w.winner.teamId === userTeamId) userWins.push(`${w.winner.name} wins ${label}`);
        }
        for (const pos in a.gg || {}) if (a.gg[pos].teamId === userTeamId) userWins.push(`${a.gg[pos].name} wins the Gold Glove (${pos})`);
        for (const pos in a.ss || {}) if (a.ss[pos].teamId === userTeamId) userWins.push(`${a.ss[pos].name} wins the Silver Slugger (${pos})`);
        userWins.forEach((w, i) => {
          state.news.push({ date: nov(5 + (i % 4)), body: `<strong>🏅 ${w}!</strong>` });
        });
      }
    }

    // Hall of Fame class (19.6).
    if (summary.hof && summary.hof.inducted.length) {
      const names = summary.hof.inducted.map((i) =>
        `<strong>${i.name}</strong> (${i.pos}${i.method === 'veterans' ? ', Veterans Committee' : `, ${i.pct}%`})`);
      state.news.push({
        date: jan(15),
        body: `🏛 <strong>Hall of Fame Class of ${summary.year + 1}:</strong> ${names.join(', ')}.`,
      });
    }

    // Retirements: every user-team player, plus league-wide notables.
    for (const r of summary.retirements) {
      const notable = r.overall >= 55 || r.age >= 39;
      if (r.teamId !== userTeamId && !notable) continue;
      const t = teamOf(r.teamId);
      // Career retrospective for user-team retirees (18.4): the news line
      // carries the career summary; the profile keeps the full ledger.
      let retro = '';
      if (r.teamId === userTeamId) {
        const p = state.players[r.playerId];
        const c = p && p.careerStats;
        if (c && !p.isPitcher && c.g > 0) {
          retro = ` Career: ${c.g.toLocaleString()} games, ${c.h.toLocaleString()} hits, ` +
                  `${c.hr} HR, ${window.BBGM_STATS.fmtAvg(window.BBGM_STATS.avg(c))} average.`;
        } else if (c && p.isPitcher && c.g > 0) {
          retro = ` Career: ${c.w}-${c.l}, ${window.BBGM_STATS.era(c).toFixed(2)} ERA, ` +
                  `${c.k.toLocaleString()} strikeouts${c.sv >= 50 ? `, ${c.sv} saves` : ''}.`;
        }
        const ach = p && p.achievements;
        if (ach) {
          const extras = [];
          if ((ach.allStarSelections || []).length) extras.push(`${ach.allStarSelections.length}× All-Star`);
          const mvps = (ach.awards || []).filter((aw) => aw.name === 'MVP').length;
          if (mvps) extras.push(`${mvps}× MVP`);
          if ((ach.championships || []).length) extras.push(`${ach.championships.length}× champion`);
          if (extras.length) retro += ` ${extras.join(', ')}.`;
        }
      }
      state.news.push({
        date: nov(10),
        body: `<strong>${r.name}</strong> (${t ? t.abbr : 'FA'}) retires at age ${r.age}.` + retro +
              (r.openToCoaching ? ' Word is he wants to stay in the game as a coach.' : ''),
      });
    }

    // Milestones crossed this season.
    for (const m of summary.milestones) {
      const p = state.players[m.playerId];
      const t = p && teamOf(p.teamId);
      state.news.push({
        date: nov(2),
        body: `Milestone: <strong>${m.name}</strong>${t ? ` (${t.abbr})` : ''} reached ` +
              `${m.threshold.toLocaleString()} career ${m.label}.`,
      });
    }

    // Scouting budget cuts (6.9.3) — the user should hear about rivals
    // gutting their departments (and feel it if it's their own owner).
    for (const ev of summary.scoutingEvents || []) {
      const t = teamOf(ev.teamId);
      if (!t) continue;
      const tierName = window.BBGM_SCOUT.tierDef(ev.to).name;
      state.news.push({
        date: nov(12),
        body: ev.teamId === userTeamId
          ? `<strong>Ownership cuts the scouting budget</strong> to ${tierName} after the losing season.`
          : `${t.abbr} slash their scouting department to ${tierName}.`,
      });
    }

    // Staff moves (17.6/17.9): firings, hirings, notable career changes.
    for (const ev of summary.staffEvents || []) {
      const t = ev.teamId && teamOf(ev.teamId);
      let body = null;
      if (ev.kind === 'mgr-fired') {
        body = `${t.abbr} fire manager <strong>${ev.name}</strong> after a ${ev.wins}-win season.`;
      } else if (ev.kind === 'mgr-retired') {
        body = `${t.abbr} manager <strong>${ev.name}</strong> announces his retirement.`;
      } else if (ev.kind === 'mgr-hired') {
        body = `${t.abbr} hire <strong>${ev.name}</strong> (${ev.archetype}) as manager.`;
      } else if (ev.kind === 'coach-enters') {
        body = `Former player <strong>${ev.name}</strong> joins the coaching ranks as a ${ev.domain} coach.`;
      } else if (ev.kind === 'coach-to-manager') {
        body = `<strong>${ev.name}</strong> leaves the coaching ranks to pursue managing.`;
      }
      if (body) state.news.push({ date: nov(13), body });
    }
    // Non-tender deadline (18.7): notable AI cuts hit the wire in early
    // December alongside the user's own decisions.
    for (const nt of summary.nonTenders || []) {
      if (nt.ovr < 48 && nt.salary < 4) continue;
      const t = teamOf(nt.teamId);
      state.news.push({
        date: dec(2),
        body: `Non-tendered: ${t ? t.abbr : '—'} cut <strong>${nt.name}</strong> loose ` +
              `rather than pay a $${nt.salary}M arbitration raise.`,
      });
    }
    // International headline events (bible 14.7).
    for (const ev of summary.intlEvents || []) {
      let body = null;
      if (ev.kind === 'posting') {
        body = `NPB star <strong>${ev.name}</strong> (${ev.pos}, ${ev.age}) has been posted — ` +
               `posting fee around $${ev.fee}M. All 30 clubs can bid on the free-agent market.`;
      } else if (ev.kind === 'defector') {
        body = `Cuban standout <strong>${ev.name}</strong> (${ev.pos}, ${ev.age}) has defected and ` +
               `is on the open market. Scouts are split — the upside is real, the data is thin.`;
      } else if (ev.kind === 'kbo') {
        body = `KBO veteran <strong>${ev.name}</strong> (${ev.pos}, ${ev.age}) declares for free agency.`;
      }
      if (body) state.news.push({ date, body });
    }

    const userTeamObj = teamOf(userTeamId);
    if (userTeamObj && !userTeamObj.managerId) {
      state.news.push({
        date,
        body: `<strong>Your manager's seat is empty.</strong> Hire a new skipper from GM → Staff before Opening Day (the owner will pick one for you otherwise).`,
      });
    }

    // User-team departures to free agency.
    const market = state.faMarket;
    if (market) {
      for (const e of market.entries) {
        if (e.formerTeamId !== userTeamId) continue;
        const p = state.players[e.playerId];
        if (p) {
          state.news.push({
            date,
            body: `<strong>${p.name}</strong>'s contract expired — he's a free agent seeking ` +
                  `${e.askYears} yr / $${e.askTotal}M.`,
          });
        }
      }
    }
    if (state.news.length > 200) state.news = state.news.slice(-200);
  }

  function simToNextEvent() {
    simDays(7);
  }

  function simToEndOfMonth() {
    const state = window.BBGM_STATE.get();
    const today = state.meta.currentDate;
    const month = today.month;
    let days = 0;
    let cursor = today;
    while (cursor.month === month) {
      cursor = D.addDays(cursor, 1);
      days++;
      if (days > 60) break;
    }
    simDays(days);
  }

  // Sim through to the end of the regular season. simDays() already halts
  // once currentDate reaches seasonEnd, so passing the diff (plus a 1-day
  // buffer) is safe even on the last day of the season.
  function simToSeasonEnd() {
    const state = window.BBGM_STATE.get();
    if (!state) return;
    const today = state.meta.currentDate;
    const seasonEnd = state.league.schedule.seasonEnd;
    if (D.compare(today, seasonEnd) >= 0) {
      // October: "sim to the end" means the rest of the bracket (the
      // champion-crowned halt in simDays stops the run).
      if (state.postseason && state.postseason.phase === 'active') {
        simDays(40);
      } else {
        U.showToast('Season is already complete.', 'info');
      }
      return;
    }
    const days = Math.max(1, D.diffDays(today, seasonEnd) + 1);
    simDays(days);
  }

  function simDays(numDays) {
    const state = window.BBGM_STATE.get();
    if (!state) return;
    if (state.meta.offseasonPhase) {
      U.showToast('It\'s the offseason — advance the free-agency period instead.', 'info');
      return;
    }
    if (numDays > 1) U.showProgress(`Simulating ${numDays} days…`);
    document.getElementById('btnAdvance').disabled = true;

    // Block frequent saves during multi-day sim
    window.BBGM_STATE.setSaveBlocked(true);

    const simStep = (remaining) => {
      if (remaining <= 0) { finish(); return; }
      // Never sim past a pending draft day or signing window (Sim 7 Days /
      // Sim Season land here without going through advanceDay's check).
      if (window.BBGM_DRAFT.draftDayPending(state, state.meta.currentDate)) {
        finish();
        showDraftDayModal(state);
        return;
      }
      if (window.BBGM_INTL.windowPending(state, state.meta.currentDate)) {
        finish();
        showIntlWindowModal(state);
        return;
      }
      try {
        simOneDay(state);
      } catch (e) {
        finishWithError(e);
        return;
      }
      // Champion crowned mid-run: stop and celebrate.
      if (state.postseason && state.postseason.phase === 'complete') {
        finish();
        showChampionModal(state);
        return;
      }
      // Season-end halt — unless an active postseason is playing out on
      // the calendar (October days sim like any other).
      const today = state.meta.currentDate;
      const seasonEnd = state.league.schedule.seasonEnd;
      if (D.compare(today, seasonEnd) >= 0 && !state.postseason) {
        finish();
        return;
      }
      // Draft day halts multi-day sims: the user (or auto-draft) has to
      // run the draft before July baseball is played.
      if (window.BBGM_DRAFT.draftDayPending(state, today)) {
        finish();
        showDraftDayModal(state);
        return;
      }
      if (window.BBGM_INTL.windowPending(state, today)) {
        finish();
        showIntlWindowModal(state);
        return;
      }
      if (numDays > 5 && remaining % 7 === 0) {
        // yield to UI
        setTimeout(() => simStep(remaining - 1), 0);
      } else {
        simStep(remaining - 1);
      }
    };

    function finish() {
      window.BBGM_STATE.setSaveBlocked(false);
      window.BBGM_STATE.saveNow();
      U.hideProgress();
      document.getElementById('btnAdvance').disabled = false;
      refresh();
    }

    function finishWithError(e) {
      console.error('Sim halted:', e);
      window.BBGM_STATE.setSaveBlocked(false);
      window.BBGM_STATE.saveNow();
      U.hideProgress();
      document.getElementById('btnAdvance').disabled = false;
      refresh();
      U.showModal({
        title: 'Simulation Error',
        body: e.message + '\n\nThe sim has been halted. ' +
              'Open the browser console for details, or run ' +
              'BBGM_MAIN.validateCurrentSave() to inspect state.',
        actions: [{ label: 'OK', kind: 'primary', onClick: () => true }],
      });
    }

    simStep(numDays);
  }

  function simOneDay(state) {
    const today = state.meta.currentDate;

    // Postseason days (bible 3.4): October plays on the calendar. Series
    // results land in the news; the champion modal fires from simDays.
    if (state.postseason && state.postseason.phase === 'active') {
      const psr = window.BBGM_OFFSEASON.simPostseasonDay(state, today);
      if (!state.news) state.news = [];
      for (const s of psr.completed) {
        const w = state.league.teams.find((t) => t.id === s.winnerId);
        const l = state.league.teams.find((t) => t.id === s.loserId);
        const score = s.hw >= s.lw ? `${s.hw}-${s.lw}` : `${s.lw}-${s.hw}`;
        const label = s.tag === 'ws' ? 'the World Series'
          : s.tag.endsWith('lcs') ? `the ${U.leagueName(s.league)} League Championship Series`
          : s.tag.includes('ds') ? 'their Division Series'
          : 'their Wild Card series';
        state.news.push({
          date: { ...today },
          body: s.tag === 'ws'
            ? `<strong>${w.name}</strong> win ${label}, defeating the ${l.name} ${score}!`
            : `<strong>${w.abbr}</strong> take ${label} over ${l.abbr}, ${score}.`,
        });
      }
    }

    // All-Star Game (bible 19.4): fires on the schedule's mid-July break
    // date. Pure exhibition — no season stats, standings, or fatigue.
    if (window.BBGM_AWARDS.allStarPending(state, today)) {
      const as = window.BBGM_AWARDS.runAllStar(state);
      if (!state.news) state.news = [];
      const winName = U.leagueName(as.winner);
      const loseName = U.leagueName(as.winner === 'east' ? 'west' : 'east');
      const score = `${Math.max(as.eastRuns, as.westRuns)}-${Math.min(as.eastRuns, as.westRuns)}`;
      state.news.push({
        date: { ...today },
        body: `<strong>⭐ ${winName} League wins the All-Star Game ${score}.</strong> ` +
              `${as.mvp.name} takes home All-Star MVP honors.`,
      });
      const userTeamId = state.meta.userTeamId;
      const mine = [];
      for (const lg of ['east', 'west']) {
        const r = as.rosters[lg];
        for (const sel of r.starters.concat(r.pitchers, r.bench)) {
          if (sel.teamId === userTeamId) mine.push(sel.name);
        }
      }
      if (mine.length) {
        state.news.push({
          date: { ...today },
          body: `<strong>${mine.length} of your players made the All-Star team:</strong> ${mine.join(', ')}.`,
        });
      }
    }

    const games = state.league.schedule.games.filter((g) => !g.played && D.eq(g.date, today));
    for (const g of games) {
      try {
        // Rotation bookkeeping (gamesPlayedByTeam) is handled inside
        // simulateGame — the engine owns it.
        window.BBGM_SIM.simulateGame(state, g);
      } catch (e) {
        // Surface the failure with full context. Don't silently swallow.
        const home = state.league.teams.find((t) => t.id === g.homeId);
        const away = state.league.teams.find((t) => t.id === g.awayId);
        const ctx =
          `date=${D.format(today, 'iso')}, gameId=${g.gameId}, ` +
          `${away ? away.abbr : g.awayId}@${home ? home.abbr : g.homeId}`;
        console.error(`simulateGame failed (${ctx}):`, e);
        // Halt the sim run rather than continuing through a broken schedule.
        throw new Error(`simOneDay halted: ${ctx} — ${e.message}`);
      }
    }
    // Injuries from today's games: place players on IL, swap minors bodies
    // up to keep the 26-man roster legal, and surface user-team incidents
    // in the news feed.
    applyInjuriesFromGames(state, today, games);
    // Tick recovery on every injured player, return them when the clock
    // runs out (and demote whoever's filling their slot).
    advanceInjuryRecovery(state, today);
    // Position-player fatigue (bible 10.8): players who didn't appear today
    // recover; rest-recommended notifications fire for user-team starters
    // who hit the very-high threshold.
    advanceFatigueRecovery(state, games);
    surfaceFatigueRestNotifications(state, today);

    // AI trade activity (bible 15.7): AI-AI deals and occasional
    // unsolicited offers to the user, up to the July 31 deadline.
    window.BBGM_TRADES.aiTradeTick(state, today);

    // International class fallback (bible 14.1): normally generated at the
    // rollover; season 1 has no prior rollover, so it appears on day one.
    const intlClass = window.BBGM_INTL.ensureClass(state, today);
    if (intlClass) {
      if (!state.news) state.news = [];
      state.news.push({
        date: { ...today },
        body: `<strong>The ${intlClass.year} international class is posted.</strong> ` +
              `~100 prospects sign July 2 — scout the pool and your bonus budget in the Draft Hub.`,
      });
    }

    // Amateur draft class (bible 13.3): generated May 1, scouted through
    // June 30 in the Draft Hub.
    const draftClass = window.BBGM_DRAFT.ensureClass(state, today);
    if (draftClass) {
      if (!state.news) state.news = [];
      const flavor = draftClass.strength >= 1 ? 'Scouts are calling it one of the deepest classes in years.'
        : draftClass.strength <= -1 ? 'Scouts consider it a thin class at the top.'
        : 'Scouts grade it an average class.';
      state.news.push({
        date: { ...today },
        body: `<strong>The ${draftClass.year} draft class rankings are out.</strong> ${flavor} ` +
              `Work the board in the Draft Hub before the June 30 draft.`,
      });
    }

    // Generate news for any noteworthy results
    generateDailyNews(state, today, games);

    // AB-by-AB log retention guard (bible 8.7.1). Storage moved to
    // IndexedDB in 0.6.0 so quota is no longer the forcing constraint,
    // but full-season logs for every game measured ~6.6MB — still worth
    // pruning for save/export size and load time. Policy: keep AB logs
    // all season for the user's games, a rolling 14-day window for AI games.
    // Box scores and line scores are kept all season for every game, so
    // historical Game Detail views still render complete box scores; only
    // the at-bat narrative is pruned (the UI shows a "not retained" note).
    pruneOldGameLogs(state, today);

    // Advance
    state.meta.currentDate = D.addDays(today, 1);
  }

  function pruneOldGameLogs(state, today) {
    const userTeamId = state.meta.userTeamId;
    for (const g of state.league.schedule.games) {
      if (!g.played || !g.result || !g.result.gameLog) continue;
      if (g.homeId === userTeamId || g.awayId === userTeamId) continue;
      if (D.diffDays(g.date, today) > 14) {
        g.result.gameLog = null;
      }
    }
  }

  // ---- Injury handling (bible 10) ---------------------------------------
  // Stage 1 scope:
  //   - place injured players on day-to-day or IL with appropriate days
  //   - tick recovery daily and clear when the clock runs out
  //   - apply career-altering ceiling drops (10.6) right away
  //   - surface user-team incidents in the news feed
  //
  // Stage 1 deliberately does NOT make roster transactions (no call-ups,
  // no team.il list). The injured player stays on team.roster — counted
  // toward the 26-man — and the engine's getLineup / pickStarter / reliever
  // selection already skip unavailable players, so the team plays
  // effectively short-handed for the IL stint. Bible-correct IL transactions
  // (move to separate team.il list, call up minor leaguer) ship with the IL
  // management UI in stage 4.

  function applyInjuriesFromGames(state, today, games) {
    const INJ = window.BBGM_INJURIES;
    const R = window.BBGM_ROSTER;
    const userTeamId = state.meta.userTeamId;
    for (const g of games) {
      if (!g.played || !g.result || !g.result.injuries) continue;
      for (const entry of g.result.injuries) {
        const p = state.players[entry.playerId];
        if (!p) continue;
        // Skip if the player is already injured (rare double-rolls).
        if (!INJ.isAvailable(p)) continue;
        INJ.placeOnIL(p, entry.injury, today);
        if (entry.injury.careerAltering && p.hidden && p.hidden.ceiling) {
          applyCareerAlteringCeiling(p, entry.injury);
        }
        // IL-type injuries trigger a real roster move (bible 11.5): the
        // player comes off the 26-man onto the team IL list and the best
        // minors fit is called up. Auto-handled for every team; the
        // user's moves are surfaced in the news feed. Day-to-day players
        // stay on the roster (no move needed).
        let callUpNote = '';
        if (entry.injury.ilType) {
          const team = state.league.teams.find((t) => t.id === p.teamId);
          if (team && team.roster.includes(p.id)) {
            const { callUp } = R.placeOnILWithMove(state, team, p);
            if (callUp) callUpNote = ` <strong>${callUp.name}</strong> called up from ${callUp.ilCallUpFor ? 'AAA' : 'the minors'}.`;
          }
        }
        if (p.teamId === userTeamId) {
          if (!state.news) state.news = [];
          const team = state.league.teams.find((t) => t.id === p.teamId);
          state.news.push({
            date: { ...today },
            body: `<strong>${p.name}</strong> (${team ? team.abbr : '?'}) suffered a ${entry.injury.type.toLowerCase()} — ` +
              (entry.injury.ilType ? `placed on the ${entry.injury.ilType} IL (out ~${entry.injury.daysOut} days)` :
                `day-to-day, expected back in ${entry.injury.daysOut} day${entry.injury.daysOut !== 1 ? 's' : ''}`) +
              (entry.injury.careerAltering ? ' — career-altering' : '') + '.' + callUpNote,
          });
        }
      }
    }
  }

  function advanceInjuryRecovery(state, today) {
    const INJ = window.BBGM_INJURIES;
    const R = window.BBGM_ROSTER;
    const userTeamId = state.meta.userTeamId;
    // Part B heals IL clocks on calendar time from the last ticked day to
    // Opening Day — this stamp is what keeps October days played on the
    // calendar from being counted twice.
    state.meta.lastRecoveryTick = { ...today };
    for (const id in state.players) {
      const p = state.players[id];
      if (!p) continue;
      // Tick recovery for every player whose clock is running. tickRecovery
      // returns true on the transition day, false otherwise.
      const wasInjured = !INJ.isAvailable(p);
      if (!wasInjured) continue;
      const came = INJ.tickRecovery(p);
      if (!came) continue;
      // If the player was on the team IL list, run the activation move:
      // back onto the 26-man, call-up cover goes back down.
      let sentDownNote = '';
      const team = state.league.teams.find((t) => t.id === p.teamId);
      if (team && (team.il || []).includes(p.id)) {
        const { sentDown } = R.activateFromIL(state, team, p);
        if (sentDown) sentDownNote = ` <strong>${sentDown.name}</strong> optioned to AAA.`;
      }
      if (p.teamId === userTeamId) {
        if (!state.news) state.news = [];
        state.news.push({
          date: { ...today },
          body: `<strong>${p.name}</strong> activated from the IL.` + sentDownNote,
        });
      }
    }
  }

  // ---- Position-player fatigue (bible 10.8) ----------------------------
  // Accumulation happens at game end inside simulation.js. The two daily
  // hooks here are: (1) recover anyone who DIDN'T play today, (2) surface
  // a one-time "rest recommended" news entry for user-team starters who
  // cross the very-high threshold.

  function advanceFatigueRecovery(state, games) {
    const FAT = window.BBGM_FATIGUE;
    if (!FAT) return;
    const playedToday = new Set();
    for (const g of games) {
      if (!g.played || !g.result || !g.result.box) continue;
      for (const side of ['home', 'away']) {
        for (const row of g.result.box[side].batters) playedToday.add(row[0]);
      }
    }
    // Two-tier recovery: game days still get a partial overnight bump down
    // (otherwise fatigue saturates by mid-May since starters play ~6 of 7
    // days). Off days recover at the full rate.
    for (const id in state.players) {
      const p = state.players[id];
      if (!p || p.isPitcher) continue;
      if (playedToday.has(id)) FAT.partialRecover(p);
      else FAT.recover(p);
    }
  }

  function surfaceFatigueRestNotifications(state, today) {
    const FAT = window.BBGM_FATIGUE;
    if (!FAT) return;
    const userTeamId = state.meta.userTeamId;
    const userTeam = state.league.teams.find((t) => t.id === userTeamId);
    if (!userTeam) return;
    if (!state.news) state.news = [];
    for (const id of userTeam.roster) {
      const p = state.players[id];
      if (!p || p.isPitcher) continue;
      // Reset the once-per-stretch latch when the player cools off.
      if (!FAT.isModerate(p)) {
        if (p._restNotified) p._restNotified = false;
        continue;
      }
      if (FAT.isVeryHigh(p) && !p._restNotified) {
        // Bible 10.8 example UI language — verbatim.
        state.news.push({
          date: { ...today },
          body: `<strong>${p.name}</strong> is fatigued. Suggested rest: 1 day.`,
        });
        p._restNotified = true;
      }
    }
  }

  // Career-altering injuries cut a chunk off the relevant ceiling (10.6).
  function applyCareerAlteringCeiling(p, injury) {
    const c = p.hidden.ceiling;
    const drop = (key, n) => { if (c[key] != null) c[key] = Math.max(20, c[key] - n); };
    if (p.isPitcher) {
      if (injury.type === 'UCL tear') { drop('velocity', 5); drop('stuff', 3); }
      else if (injury.type === 'Shoulder inflammation') { drop('velocity', 4); }
      else if (injury.type === 'Lat strain') { drop('velocity', 3); }
      else { drop('stuff', 3); }
    } else {
      if (injury.type === 'Knee injury') { drop('speed', 6); drop('defense', 3); }
      else if (injury.type === 'Shoulder issue') { drop('arm', 5); drop('powerVsR', 2); drop('powerVsL', 2); }
      else if (injury.type === 'Wrist injury') { drop('powerVsR', 4); drop('powerVsL', 4); }
      else if (injury.type === 'Back injury') { drop('powerVsR', 3); drop('powerVsL', 3); drop('speed', 2); }
      else { drop('contactVsR', 2); drop('contactVsL', 2); }
    }
  }

  function generateDailyNews(state, date, games) {
    if (!state.news) state.news = [];
    const userTeamId = state.meta.userTeamId;

    for (const g of games) {
      if (!g.played || !g.result) continue;
      // Notable: blowout, walkoff, no-hitter
      const home = state.league.teams.find((t) => t.id === g.homeId);
      const away = state.league.teams.find((t) => t.id === g.awayId);
      const margin = Math.abs(g.result.homeRuns - g.result.awayRuns);
      const involvesUser = g.homeId === userTeamId || g.awayId === userTeamId;
      if (margin >= 10 && !involvesUser) {
        const winner = g.result.homeRuns > g.result.awayRuns ? home : away;
        const loser = g.result.homeRuns > g.result.awayRuns ? away : home;
        state.news.push({
          date: { ...date },
          body: `<strong>${winner.abbr}</strong> beat ${loser.abbr} ${Math.max(g.result.homeRuns, g.result.awayRuns)}-${Math.min(g.result.homeRuns, g.result.awayRuns)} in a rout.`,
        });
      }
      if (g.result.innings && g.result.innings >= 12 && involvesUser) {
        state.news.push({
          date: { ...date },
          body: `Marathon game: ${away.abbr} @ ${home.abbr} went ${g.result.innings} innings.`,
        });
      }
    }

    // Trim news
    if (state.news.length > 200) state.news = state.news.slice(-200);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ------- Debug helpers -------
  // Inspects the current save and returns an object describing schedule and
  // team readiness. Safe to call from the browser console:
  //   BBGM_MAIN.validateCurrentSave()
  function validateCurrentSave() {
    const state = window.BBGM_STATE.get();
    if (!state || !state.league) {
      const r = { ok: false, reason: 'no save loaded' };
      console.log(r);
      return r;
    }
    const league = state.league;
    const players = state.players;
    const report = {
      version: state.version,
      currentDate: D.format(state.meta.currentDate, 'iso'),
      schedule: null,
      readiness: { ok: true, errors: [] },
      perTeam: [],
    };

    // Schedule validation
    if (league.schedule) {
      try {
        report.schedule = window.BBGM_SCHEDULE.validate(league.schedule, league);
      } catch (e) {
        report.schedule = { valid: false, error: e.message };
      }
    }

    // Per-team scheduled vs record game counts.
    const scheduledByTeam = {};
    for (const t of league.teams) scheduledByTeam[t.id] = { scheduled: 0, played: 0 };
    for (const g of (league.schedule && league.schedule.games) || []) {
      scheduledByTeam[g.homeId].scheduled++;
      scheduledByTeam[g.awayId].scheduled++;
      if (g.played) {
        scheduledByTeam[g.homeId].played++;
        scheduledByTeam[g.awayId].played++;
      }
    }

    for (const t of league.teams) {
      const sched = scheduledByTeam[t.id];
      const recordGames = (t.seasonRecord.w || 0) + (t.seasonRecord.l || 0);
      const row = {
        team: t.abbr,
        teamId: t.id,
        scheduled: sched.scheduled,
        played: sched.played,
        record: recordGames,
        rosterSize: t.roster ? t.roster.length : 0,
        rotationSize: t.rotation ? t.rotation.length : 0,
        bullpenSize: t.bullpen ? t.bullpen.length : 0,
        closer: t.closer ? (players[t.closer] ? players[t.closer].name : `MISSING(${t.closer})`) : null,
        lineupRH: t.lineupRH ? t.lineupRH.length : 0,
        lineupLH: t.lineupLH ? t.lineupLH.length : 0,
        missingPlayerIds: [],
      };

      // Verify all referenced player IDs exist.
      const allIds = []
        .concat(t.roster || [])
        .concat(t.rotation || [])
        .concat(t.bullpen || [])
        .concat(t.closer ? [t.closer] : [])
        .concat((t.lineupRH || []).map((s) => s.playerId))
        .concat((t.lineupLH || []).map((s) => s.playerId));
      for (const id of allIds) {
        if (!players[id] && !row.missingPlayerIds.includes(id)) row.missingPlayerIds.push(id);
      }

      report.perTeam.push(row);
    }

    // Run readiness validation (catch-throw to populate report.readiness).
    try {
      window.BBGM_PLAYER_GEN.validateLeagueReadiness(league, players);
    } catch (e) {
      report.readiness.ok = false;
      report.readiness.errors.push(e.message);
    }

    console.log('=== BBGM_MAIN.validateCurrentSave() ===');
    console.log('Version:', report.version, '| Date:', report.currentDate);
    if (report.schedule) {
      console.log(`Schedule: ${report.schedule.valid ? 'VALID' : 'INVALID'} ` +
        `(${report.schedule.totalGames}/2430 games, ${report.schedule.teamsAt162}/30 at 162)`);
      if (!report.schedule.valid) console.log('  issues:', report.schedule.issues);
    } else {
      console.log('Schedule: (none)');
    }
    console.log(`Readiness: ${report.readiness.ok ? 'OK' : 'FAIL'}`);
    for (const e of report.readiness.errors) console.log(`  ${e}`);
    console.log('Per-team:');
    for (const row of report.perTeam) {
      const flag = (row.scheduled === 162 && row.played === row.record && row.missingPlayerIds.length === 0) ? '✓' : '✗';
      console.log(
        `  ${flag} ${row.team.padEnd(4)} sched=${row.scheduled} played=${row.played} ` +
        `record=${row.record} | roster=${row.rosterSize} rot=${row.rotationSize} ` +
        `bp=${row.bullpenSize} lineupRH=${row.lineupRH} lineupLH=${row.lineupLH}` +
        (row.missingPlayerIds.length ? ` MISSING_IDS=${row.missingPlayerIds.join(',')}` : '')
      );
    }
    return report;
  }

  return {
    navigate, refresh, advanceDay, simToNextEvent, simToEndOfMonth, simToSeasonEnd,
    advanceFAPeriod, startSeasonFlow, validateCurrentSave,
  };
})();

// Dev-only namespace alias. Lets users run `BBGM_DEBUG.validateCurrentSave()`
// from the browser console without having to remember the BBGM_MAIN namespace.
window.BBGM_DEBUG = {
  validateCurrentSave: () => window.BBGM_MAIN.validateCurrentSave(),
};
