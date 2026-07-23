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
    document.getElementById('btnInbox').addEventListener('click', () => showInbox());

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

    // Migration: 0.25.1 heals orphaned pitchers — roster arms belonging to
    // no rotation/bullpen/closer slot. Mid-IL-stint config rebuilds
    // (trades, swaps, conversions, claims) purged IL'd players from the
    // staff lists, and activation never re-added them: rostered but never
    // used. The activation path now guarantees reintegration; this one-shot
    // pass re-sorts any team already carrying an orphan.
    if (versionLt(saveVersion, '0.25.1')) {
      let healed = 0;
      for (const t of state.league.teams) {
        const orphaned = (t.roster || []).some((id) => {
          const p = state.players[id];
          return p && p.isPitcher &&
            !(t.rotation || []).includes(id) &&
            !(t.bullpen || []).includes(id) &&
            t.closer !== id;
        });
        if (!orphaned) continue;
        try {
          window.BBGM_ROSTER.safeRebuild(state, t);
          healed++;
        } catch (e) {
          console.error(`Orphan-heal rebuild failed for ${t.abbr}:`, e);
        }
      }
      if (healed) {
        console.log(`0.25.1 migration: rebuilt ${healed} team(s) carrying orphaned pitchers.`);
        window.BBGM_STATE.set(state);
      }
    }

    // Migration: 0.31.1 trims over-cap rosters. Two doors let a 27th man
    // on (FA signings and the rollover IL sweep, both since fixed); any
    // save already carrying an oversized roster gets the weakest men
    // demoted and the configs rebuilt.
    if (versionLt(saveVersion, '0.31.1')) {
      let trimmed = 0;
      const R = window.BBGM_ROSTER;
      for (const t of state.league.teams) {
        if (!Array.isArray(t.roster) || t.roster.length <= 26) continue;
        while (t.roster.length > 26) {
          const weakest = t.roster.map((id) => state.players[id]).filter(Boolean)
            .sort((a, b) => R.overall(a) - R.overall(b))[0];
          if (!weakest) break;
          t.roster.splice(t.roster.indexOf(weakest.id), 1);
          t.minors.push(weakest.id);
          weakest.status = 'minors';
          weakest.rosterStatus = R.demotionLevel(weakest);
        }
        try { R.safeRebuild(state, t); } catch (e) {
          console.error(`Over-cap trim rebuild failed for ${t.abbr}:`, e);
        }
        trimmed++;
      }
      if (trimmed) {
        console.log(`0.31.1 migration: trimmed ${trimmed} over-cap roster(s) to 26.`);
        window.BBGM_STATE.set(state);
      }
    }

    // 0.47.1: head scouts (0.47.0) only generated at the season rollover,
    // so a save loaded mid-cycle had an empty scouting market and a
    // vacancy with nobody to interview. Stock the market and staff the AI
    // clubs now; the USER's chair deliberately stays open — their first
    // head scout is their hire (an empty seat still gets the standard
    // owner fill at Opening Day, same as coaches).
    if (versionLt(saveVersion, '0.47.1')) {
      const STAFF = window.BBGM_STAFF;
      if (!state.staff) state.staff = { managers: {}, coaches: {} };
      if (!state.staff.scouts) state.staff.scouts = {};
      let staffed = 0;
      for (const t of state.league.teams) {
        if (t.id === state.meta.userTeamId) continue;
        if (!t.scoutId || !state.staff.scouts[t.scoutId]) {
          const sc = STAFF.generateScout(state);
          state.staff.scouts[sc.id] = sc;
          sc.teamId = t.id;
          t.scoutId = sc.id;
          staffed++;
        }
      }
      while (STAFF.poolScouts(state).length < 6) {
        const sc = STAFF.generateScout(state);
        state.staff.scouts[sc.id] = sc;
      }
      if (staffed) {
        console.log(`0.47.1 migration: staffed ${staffed} AI scout chair(s), stocked the market.`);
        window.BBGM_STATE.set(state);
      }
    }

    // 0.49.0: body-model rebuild. The old generator handed everyone an
    // adult frame on a +6 lb/inch line off 6'3"-base pitcher heights —
    // nearly a third of each staff listed 6'4"+ AND 220+, and 16-year-old
    // intl signees could read 205 lb. Remap heights onto the tightened
    // bases (order-preserving, so the tall stay tallest), rebuild weights
    // on the ~197-at-6'2" line, and stamp the adult frame (frameLb) each
    // young player fills toward. Retired players keep the bodies they
    // made their history at. Signed intl prospects share their object
    // with state.players — the frameLb stamp doubles as the visited flag.
    if (versionLt(saveVersion, '0.49.0')) {
      const GENP = window.BBGM_PLAYER_GEN;
      let reshaped = 0;
      const reshape = (p) => {
        if (!p || p.retired || p.heightIn == null || p.frameLb != null) return;
        let h = 0;
        const idStr = String(p.id);
        for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) >>> 0;
        const mid = ['2B', 'SS'].includes(p.primaryPosition);
        const oldBase = p.isPitcher ? 75 : (p.primaryPosition === 'C' ? 73 : mid ? 71.5 : 73.5);
        const newBase = p.isPitcher ? 74.4 : (p.primaryPosition === 'C' ? 73 : mid ? 71.5 : 73.2);
        p.heightIn = Math.max(68, Math.min(79,
          Math.round(newBase + (p.heightIn - oldBase) * (1.6 / 1.8))));
        p.frameLb = GENP.frameFor(p.heightIn,
          GENP.posFrameAdj(p.primaryPosition, p.isPitcher) + (h % 25) - 12);
        p.weightLb = Math.max(148, p.frameLb - GENP.youthDeficit(p.age));
        reshaped++;
      };
      for (const id in state.players) reshape(state.players[id]);
      if (state.draft && state.draft.prospects) {
        for (const id in state.draft.prospects) reshape(state.draft.prospects[id]);
      }
      if (state.intl && state.intl.prospects) {
        for (const id in state.intl.prospects) reshape(state.intl.prospects[id]);
      }
      if (reshaped) {
        console.log(`0.49.0 migration: rebuilt ${reshaped} player bodies on the new scale.`);
        window.BBGM_STATE.set(state);
      }
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
    // "Night Game" chrome (0.42.0): key the broadcast package to the
    // franchise and light up the scorebug team chip.
    U.setChromeTeam(team);
    const chip = document.getElementById('hdrTeamChip');
    if (chip) {
      chip.textContent = team.abbr;
      chip.classList.add('on');
    }
    // Inbox badge (0.37.0).
    const badge = document.getElementById('inboxBadge');
    if (badge) {
      const n = window.BBGM_INBOX.unread(state);
      badge.style.display = n ? 'block' : 'none';
      badge.textContent = n > 9 ? '9+' : String(n);
    }
  }

  // ------- Inbox (0.37.0) -------
  // The GM's mail: owner directives, scouting reports, rival GM pitches.
  function showInbox() {
    const state = window.BBGM_STATE.get();
    const box = state.inbox || [];
    const body = U.el('div');
    if (!box.length) {
      body.appendChild(U.el('div', { class: 'empty-state' },
        'Nothing yet. The owner, your scouts, and rival GMs will write when there\'s something worth reading.'));
    }
    // Wire-report list (0.44.0): unread mail carries an amber LED, the
    // source and dateline read as a mono news slug.
    const list = U.el('div', { class: 'wire-list' });
    for (const m of box) {
      const row = U.el('button', {
        class: `wire-row${m.read ? ' read' : ''}`,
        on: { click: () => { U.closeModal(); setTimeout(() => showInboxMessage(m.id), 0); } },
      });
      row.appendChild(U.el('span', { class: 'wire-dot' }));
      const info = U.el('div', { class: 'wire-info' });
      info.appendChild(U.el('div', { class: 'wire-subject' }, m.subject));
      const meta = U.el('div', { class: 'wire-meta' });
      meta.appendChild(U.el('span', { class: 'src' }, m.from));
      meta.appendChild(document.createTextNode(` • ${D.format(m.date)}`));
      info.appendChild(meta);
      row.appendChild(info);
      list.appendChild(row);
    }
    body.appendChild(list);
    const actions = [];
    if (box.some((m) => !m.read)) {
      actions.push({ label: 'Mark All Read', kind: 'secondary', onClick: () => {
        const s = window.BBGM_STATE.get();
        window.BBGM_INBOX.markAllRead(s);
        window.BBGM_STATE.set(s);
        updateHeader(s);
        return true;
      }});
    }
    actions.push({ label: 'Close', kind: 'primary', onClick: () => true });
    U.showModal({ title: 'Inbox', body, actions });
  }

  function showInboxMessage(id) {
    const state = window.BBGM_STATE.get();
    const m = window.BBGM_INBOX.markRead(state, id);
    if (!m) return;
    window.BBGM_STATE.set(state);
    updateHeader(state);
    const body = U.el('div');
    body.appendChild(U.el('div', { class: 'wire-dateline' },
      `${m.from} • ${D.format(m.date)}`));
    body.appendChild(U.el('p', { class: 'wire-body' }, m.body));
    const actions = [];
    if (m.action && m.action.type === 'trade') {
      actions.push({ label: 'Open Trade Talks', kind: 'primary', onClick: () => {
        const s = window.BBGM_STATE.get();
        const p = s.players[m.action.playerId];
        if (p && p.teamId === m.action.teamId && window.BBGM_UI_FRONTOFFICE.startTradeFor) {
          setTimeout(() => window.BBGM_UI_FRONTOFFICE.startTradeFor(s, p), 0);
        } else {
          U.showToast('That player has since moved — the offer is stale.', 'warning');
        }
        return true;
      }});
    } else if (m.action && m.action.type === 'navigate') {
      actions.push({ label: 'Take a Look', kind: 'primary', onClick: () => {
        setTimeout(() => navigate(m.action.tab, m.action.opts || {}), 0);
        return true;
      }});
    } else if (m.action && m.action.type === 'coachProject') {
      // Approve a coach's personal project (0.48.0). Guarded: the player
      // must still be in the org and not already someone's project.
      actions.push({ label: 'Approve the Project', kind: 'primary', onClick: () => {
        const s = window.BBGM_STATE.get();
        const p = s.players[m.action.playerId];
        const team = s.league.teams.find((t) => t.id === s.meta.userTeamId);
        const inOrg = p && team && (team.roster.includes(p.id) ||
          team.minors.includes(p.id) || (team.il || []).includes(p.id));
        if (!p || !inOrg || p.devProject) {
          U.showToast('That project is no longer on the table.', 'warning', 4000);
          return true;
        }
        window.BBGM_STAFF.approveProject(s, p, m.action);
        window.BBGM_STATE.set(s);
        U.showToast(`${p.name} is the project — extra work starts now.`, 'success');
        return true;
      }});
    } else if (m.action && m.action.type === 'closerProposal') {
      // The manager's ninth-inning pick (0.48.0) — runs through the same
      // Name Closer path the pitching tab uses.
      actions.push({ label: 'Make Him the Closer', kind: 'primary', onClick: () => {
        const s = window.BBGM_STATE.get();
        const team = s.league.teams.find((t) => t.id === s.meta.userTeamId);
        const p = s.players[m.action.playerId];
        if (!p || !p.isPitcher || !team.roster.includes(p.id) || team.closer === p.id) {
          U.showToast('That arm is no longer available for the ninth.', 'warning', 4000);
          return true;
        }
        window.BBGM_UI_TEAM.nameCloser(s, team, p);
        return true;
      }});
    }
    actions.push({ label: 'Back to Inbox', kind: 'secondary', onClick: () => {
      setTimeout(() => showInbox(), 0);
      return true;
    }});
    actions.push({ label: 'Close', kind: 'primary', onClick: () => true });
    U.showModal({ title: m.subject, body, actions });
  }

  // ------- Sim stops & pending decisions (0.21.0) -------
  // Two mechanisms let the world wait for the GM instead of rolling on:
  //  - state.pendingDecisions: roster calls deferred to the user (IL
  //    call-up, IL-return send-down). These BLOCK further simming until
  //    resolved — the roster is genuinely in limbo.
  //  - simHalts: one-shot notices (new trade offer, deadline heads-up,
  //    day-to-day knocks) that stop the current run so the user can act,
  //    but don't block re-simming.
  // Which events stop the sim is configured in Menu → Simulation Stops.
  let simHalts = [];

  function queueDecision(state, dec) {
    if (!state.pendingDecisions) state.pendingDecisions = [];
    state.pendingDecisions.push(dec);
  }

  function queueHalt(h) { simHalts.push(h); }

  // Show queued one-shot notices, then flow into any pending decisions.
  function showSimHalts(state) {
    if (!simHalts.length) {
      if ((state.pendingDecisions || []).length) showPendingDecisions(state);
      return;
    }
    const h = simHalts.shift();
    U.showModal({
      title: h.title,
      body: h.body,
      actions: [
        ...(h.actions || []),
        { label: 'Continue', kind: h.actions && h.actions.length ? 'secondary' : 'primary', onClick: () => {
          setTimeout(() => showSimHalts(state), 0);
          return true;
        }},
      ],
    });
  }

  // Walk the decision queue, dropping entries that went stale (player
  // traded, released, or already handled), and show the first live one.
  function showPendingDecisions(state) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const queue = state.pendingDecisions || [];
    while (queue.length) {
      const dec = queue[0];
      const p = state.players[dec.playerId];
      if (p && dec.kind === 'il-callup' && (team.il || []).includes(p.id) && p.teamId === team.id) {
        showCallUpDecision(state, team, p);
        return;
      }
      if (p && dec.kind === 'il-return' && (team.il || []).includes(p.id) &&
          window.BBGM_INJURIES.isAvailable(p) && p.teamId === team.id) {
        showReturnDecision(state, team, p);
        return;
      }
      queue.shift();
    }
    window.BBGM_STATE.set(state);
    refresh();
  }

  function resolveDecision(state) {
    (state.pendingDecisions || []).shift();
    window.BBGM_STATE.set(state);
    refresh();
    setTimeout(() => showPendingDecisions(state), 0);
  }

  // Candidate row for decision modals. Must carry the full three-column
  // roster-row structure (badge / info / stats) — .roster-row is a grid
  // with a fixed 32px first column, so a row with only an info child gets
  // crushed into the badge slot.
  function decisionRow(p, note, meta, onPick) {
    const row = U.el('button', { class: 'roster-row', on: { click: onPick } });
    row.appendChild(U.posBadge(p));
    const info = U.el('div', { class: 'player-row-info' });
    info.appendChild(U.el('div', { class: 'player-row-name' }, p.name + (note ? ` ${note}` : '')));
    info.appendChild(U.el('div', { class: 'player-row-meta' }, meta));
    row.appendChild(info);
    const ovr = Math.round(window.BBGM_ROSTER.overall(p));
    const stats = U.el('div', { class: 'player-row-stats' });
    stats.appendChild(U.el('span', { class: U.gradeClass(ovr) }, String(U.gradeFor(ovr))));
    stats.appendChild(U.el('span', { class: 'key' }, 'OVR'));
    row.appendChild(stats);
    return row;
  }

  function showCallUpDecision(state, team, p) {
    const R = window.BBGM_ROSTER;
    const need = R.callUpNeedFor(team, p);
    const cands = R.callUpCandidates(team, state.players, p.isPitcher, need).slice(0, 8);
    const inj = p.currentInjury;
    const days = p.ilStatus ? p.ilStatus.daysRemaining : 0;
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `${p.name} (${p.primaryPosition}) is on the ${inj ? inj.ilType + ' IL — ' + inj.type.toLowerCase() : 'IL'}, ` +
      `out ~${days} days. Pick his replacement from the farm` +
      (need ? ` (scouts suggest a ${need === 'C' ? 'catcher' : 'starter'} to cover his spot)` : '') + ':'));
    const list = U.el('div', { class: 'roster-list' });
    for (const c of cands) {
      list.appendChild(decisionRow(c, '',
        `Age ${c.age} • ${c.rosterStatus}`,
        () => {
          U.closeModal();
          R.executeILCallUp(state, team, p, c);
          state.news.push({ date: { ...state.meta.currentDate },
            body: `<strong>${c.name}</strong> called up to cover ${p.name}'s IL stint.` });
          resolveDecision(state);
        }));
    }
    if (!cands.length) {
      list.appendChild(U.el('div', { class: 'empty-state' }, 'No healthy candidates in the system.'));
    }
    body.appendChild(list);
    const actions = [
      { label: 'Let the AI Decide', kind: 'secondary', onClick: () => {
        const pick = R.bestCallUp(team, state.players, p.isPitcher, need);
        if (pick) {
          R.executeILCallUp(state, team, p, pick);
          state.news.push({ date: { ...state.meta.currentDate },
            body: `<strong>${pick.name}</strong> called up to cover ${p.name}'s IL stint.` });
        }
        resolveDecision(state);
        return true;
      }},
      { label: 'Play Short-Handed', kind: 'secondary', onClick: () => {
        resolveDecision(state);
        return true;
      }},
    ];
    U.showModal({ title: `Roster decision — ${p.name} to the IL`, body, actions });
  }

  function showReturnDecision(state, team, p) {
    const R = window.BBGM_ROSTER;
    const INJ = window.BBGM_INJURIES;
    const players = state.players;
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      `${p.name} (${p.primaryPosition}) is healthy and ready to come off the IL. ` +
      `The 26-man is full — pick who goes down:`));
    const cands = team.roster
      .map((id) => players[id])
      .filter((q) => q && q.id !== p.id && q.isPitcher === p.isPitcher && INJ.isAvailable(q))
      .sort((a, b) => {
        const ca = a.ilCallUpFor === p.id ? 0 : 1;
        const cb = b.ilCallUpFor === p.id ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return R.overall(a) - R.overall(b);
      })
      .slice(0, 8);
    const list = U.el('div', { class: 'roster-list' });
    for (const c of cands) {
      list.appendChild(decisionRow(c,
        c.ilCallUpFor === p.id ? '· his IL cover' : '',
        `Age ${c.age}`,
        () => {
          U.closeModal();
          const { sentDown } = R.activateFromIL(state, team, p, { downId: c.id });
          state.news.push({ date: { ...state.meta.currentDate },
            body: `<strong>${p.name}</strong> activated from the IL.` +
              (sentDown ? ` <strong>${sentDown.name}</strong> optioned to ${sentDown.rosterStatus}.` : '') });
          resolveDecision(state);
        }));
    }
    body.appendChild(list);
    const actions = [
      { label: 'Let the AI Decide', kind: 'secondary', onClick: () => {
        const { sentDown } = R.activateFromIL(state, team, p);
        state.news.push({ date: { ...state.meta.currentDate },
          body: `<strong>${p.name}</strong> activated from the IL.` +
            (sentDown ? ` <strong>${sentDown.name}</strong> optioned to ${sentDown.rosterStatus}.` : '') });
        resolveDecision(state);
        return true;
      }},
    ];
    U.showModal({ title: `Roster decision — ${p.name} returns`, body, actions });
  }

  // ------- Sim controls -------
  function advanceDay() {
    const state = window.BBGM_STATE.get();
    if (!state) return;
    // Unresolved roster decisions freeze the calendar (0.21.0) — the
    // roster is in limbo until the GM makes the call (or delegates it).
    if ((state.pendingDecisions || []).length) {
      showPendingDecisions(state);
      return;
    }
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
        // Coach-project verdicts (0.48.0): each coach reports out on his
        // personal project honestly — the good years and the wasted ones.
        for (const v of summary.coachProjects || []) {
          const coach = state.staff && state.staff.coaches[v.coachId];
          const up = v.delta >= 3;
          const flat = v.delta < 1;
          window.BBGM_INBOX.push(state, {
            from: coach ? `${coach.name} (${coach.role === 'pitching' ? 'Pitching' : 'Hitting'} Coach)` : 'Player Development',
            subject: `Project report: ${v.name}`,
            body: up
              ? `A year of extra work with ${v.name} and the results are on the card — up ${v.delta} grades where I teach. Give me another one next spring.`
              : flat
                ? `I'll be straight with you: ${v.name} didn't take the jump. ` +
                  `Sometimes the hands just aren't there. That one's on me.`
                : `${v.name} moved — up ${v.delta} grades in my program. Steady, not spectacular. The work continues.`,
          });
        }
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
    // Snapshot/restore (0.45.0): Part A and Part B both back up before
    // mutating, but the FA rounds between them didn't — a throw mid-round
    // left a half-resolved league-wide bidding round (contracts signed,
    // rosters touched, round counter ambiguous) as the live state.
    const backup = snapshotState(state);
    let result;
    try {
      result = window.BBGM_OFFSEASON.advanceFARound(state);
    } catch (e) {
      offseasonError(e, backup);
      return;
    }
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

        // Owner's marching orders land in the inbox (0.37.0): the
        // projection sets the expectation, the budget sets the leash.
        const ownerFlavor = ({
          win_now: 'I didn\'t buy this club to develop prospects. Win.',
          patient: 'Build it right — I\'m not chasing headlines.',
          cheap: 'Mind the payroll. Every dollar you spend is mine.',
          analytics: 'Trust the numbers and the process holds up.',
          old_school: 'Play the game the right way and the wins follow.',
          aggressive: 'If a deal makes us better, make the call.',
        })[userTeam.owner] || 'Make me proud.';
        window.BBGM_INBOX.push(state, {
          from: `${userTeam.ownerName} (Owner)`,
          subject: `${summary.newYear} marching orders`,
          body: `The writers project us at ${projWins}-${162 - projWins}. ${outlook} ` +
                `The board has set the payroll budget at $${userTeam.payrollBase}M. ${ownerFlavor}`,
        });

        // Coach project proposals (0.48.0): each coach names ONE personal
        // project for the year — approving is a single tap on the letter.
        for (const pr of summary.userProjectProposals || []) {
          window.BBGM_INBOX.push(state, {
            from: `${pr.coachName} (${pr.domain === 'pitching' ? 'Pitching' : 'Hitting'} Coach)`,
            subject: `Give me ${pr.playerName} for the year`,
            body: `${pr.playerName} (${pr.playerPos}, ${pr.playerAge}) is my guy. ` +
                  (pr.specialty ? `${pr.specialty} is what I do, and ` : '') +
                  `there's real headroom right where I teach. Sign off and he's my ` +
                  `personal project this season — extra hours, my program, my reputation on it.`,
            action: { type: 'coachProject', playerId: pr.playerId, coachId: pr.coachId,
              domain: pr.domain, attrs: pr.attrs, year: summary.newYear },
          });
        }

        // The manager's plan (0.48.0): his tendencies in his own words,
        // plus his ninth-inning pick when it differs from the current arm.
        {
          const mgr = window.BBGM_STAFF.managerFor(state, userTeam);
          if (mgr) {
            const t = mgr.tendencies || {};
            const lines = [];
            if ((t.smallBall || 5) >= 7) lines.push('we pressure defenses — bunts, steals, first-to-third');
            else if ((t.smallBall || 5) <= 3) lines.push('no giveaway outs — we sit back and slug');
            if ((t.quickHook || 5) >= 7) lines.push('starters get a short leash');
            else if ((t.quickHook || 5) <= 3) lines.push('my starters are trusted deep into games');
            if ((t.defSub || 5) >= 7) lines.push('late leads get the glove men');
            const planTxt = lines.length ? `Here's how we play: ${lines.join('; ')}. ` : '';
            const pen = (userTeam.roster || []).map((id) => players[id])
              .filter((p) => p && p.isPitcher && p.primaryPosition !== 'SP' && !p.currentInjury);
            let pick = null;
            if (pen.length) {
              pen.sort((a, b) => (t.leverage || 5) >= 6
                ? (b.ratings.stuff + b.ratings.velocity) - (a.ratings.stuff + a.ratings.velocity)
                : b.age - a.age);
              pick = pen[0];
            }
            if (pick && pick.id !== userTeam.closer) {
              window.BBGM_INBOX.push(state, {
                from: `${mgr.name} (Manager)`,
                subject: 'My plan for the season',
                body: planTxt + `One change I want: ${pick.name} closing games for me` +
                      ((t.leverage || 5) >= 6
                        ? ' — the best stuff in the pen gets the ninth.'
                        : ' — I trust the veteran in the ninth.') +
                      ' Your call, but that\'s my recommendation.',
                action: { type: 'closerProposal', playerId: pick.id },
              });
            } else {
              window.BBGM_INBOX.push(state, {
                from: `${mgr.name} (Manager)`,
                subject: 'My plan for the season',
                body: (planTxt || 'We play it straight — solid baseball, no gimmicks. ') +
                      `The ninth inning is settled${pick ? ` — ${pick.name} is my guy too` : ''}. Let's have a season.`,
              });
            }
          }
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

    // Ceiling breakouts (0.25.0): your org's winter development stories.
    // Phrased by tool family, never numbers — the fog holds; the potential
    // band will simply read higher next time the scouts update it.
    const BREAKOUT_PHRASES = {
      velocity: 'added real velocity this winter — the development staff sees another gear',
      stuff: 'sharpened his out-pitch this winter — the swing-and-miss ceiling just moved',
      movement: 'found new life on his pitches this winter',
      control: 'overhauled his delivery this winter — the command projection jumped',
      stamina: 'built up his arm this winter — a starter\'s workload looks possible now',
      contactVsR: 'reworked his swing this winter — the hit tool projects higher',
      contactVsL: 'reworked his swing this winter — the hit tool projects higher',
      powerVsR: 'transformed his body this winter — the raw power ceiling moved',
      powerVsL: 'transformed his body this winter — the raw power ceiling moved',
      discipline: 'rebuilt his approach this winter — the strike-zone judgment projects higher',
      speed: 'came back visibly faster this winter',
      defense: 'took a defensive leap this winter — the glove projects higher',
      arm: 'showed a stronger arm this winter',
    };
    const myBreakouts = [];
    for (const bo of summary.breakouts || []) {
      if (bo.teamId !== userTeamId) continue;
      myBreakouts.push(bo);
      state.news.push({
        date: jan(20 + (Math.abs(bo.playerId.length) % 8)),
        body: `<strong>${bo.name}</strong> ${BREAKOUT_PHRASES[bo.key] || 'made a developmental leap this winter'}.`,
      });
    }
    // Development staff writes it up for the inbox too (0.37.0).
    if (myBreakouts.length) {
      window.BBGM_INBOX.push(state, {
        from: 'Player Development',
        subject: `Winter development report — ${myBreakouts.length} name${myBreakouts.length !== 1 ? 's' : ''} to know`,
        body: myBreakouts.map((bo) =>
          `${bo.name} ${BREAKOUT_PHRASES[bo.key] || 'made a developmental leap this winter'}.`).join(' '),
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
    if ((state.pendingDecisions || []).length) {
      showPendingDecisions(state);
      return;
    }
    if (state.meta.offseasonPhase) {
      U.showToast('It\'s the offseason — advance the free-agency period instead.', 'info');
      return;
    }
    simHalts = []; // stale notices from an interrupted run don't replay
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
      // Season over, bracket not started: don't burn empty calendar days
      // (each one used to advance the date and could strand the bracket's
      // scheduled dates in the past — the 0.44.1 softlock). Route every
      // sim button to the same start-the-postseason prompt advanceDay uses.
      if (D.compare(state.meta.currentDate, state.league.schedule.seasonEnd) >= 0 &&
          !state.postseason && !state.meta.offseasonPhase) {
        finish();
        confirmPostseasonStart(state);
        return;
      }
      try {
        simOneDay(state);
      } catch (e) {
        finishWithError(e);
        return;
      }
      // Sim stops (0.21.0): a queued roster decision or one-shot notice
      // ends the run here — the rest of the requested days are dropped,
      // the world waits for the GM.
      if (simHalts.length || (state.pendingDecisions || []).length) {
        finish();
        showSimHalts(state);
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

  // ---- Rival GM pitches (0.37.0, rebuilt 0.49.1) --------------------------
  // The original only wrote when a user starter graded under 46 OVR — a
  // well-built club never heard from a rival GM at all (user report).
  // Three doors now, all on the Trade Finder's availability math so the
  // pitch is always genuine:
  //  - need:     a real hole (the classic "you're looking for help")
  //  - upgrade:  no holes, so a club pitches its available player at the
  //    weakest chair in the lineup/rotation — only if he out-grades the
  //    incumbent
  //  - deadline: July — sellers shop whoever's on the block, fit be damned
  // maybeRivalPitch rolls the dice (10-day cooldown, then ~5%/day);
  // sendRivalPitch writes the letter. Split so tests can skip the dice.
  function maybeRivalPitch(state, today) {
    if (!window.BBGM_TRADES.tradesAllowed(state) || state.postseason) return null;
    const last = state.meta.lastRivalPitch;
    const daysSince = last ? D.diffDays(D.fromYMD(last.year, last.month, last.day), today) : 99;
    if (daysSince < 10 || Math.random() >= 0.05) return null;
    return sendRivalPitch(state, today);
  }

  function sendRivalPitch(state, today) {
    const TR = window.BBGM_TRADES;
    const R = window.BBGM_ROSTER;
    const players = state.players;
    const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!ut) return null;

    // Incumbent grade per position: lineup starters plus the back of the
    // rotation (4th starter, same slot teamNeeds reads).
    const incumbent = {};
    for (const spot of ut.lineupRH || []) {
      const p = players[spot.playerId];
      if (p && spot.position !== 'DH') incumbent[spot.position] = R.overall(p);
    }
    const rot = (ut.rotation || []).map((id) => players[id]).filter(Boolean)
      .map((p) => R.overall(p)).sort((a, b) => b - a);
    if (rot.length) incumbent.SP = rot[Math.min(3, rot.length - 1)];

    const needs = TR.teamNeeds(ut, players);
    const july = today.month === 7 && !state.meta.offseasonPhase;

    let pos = null, mode = null;
    if (needs.length) {
      pos = needs[Math.floor(Math.random() * needs.length)];
      mode = 'need';
    } else if (july && Math.random() < 0.5) {
      const all = Object.keys(incumbent);
      pos = all[Math.floor(Math.random() * all.length)];
      mode = 'deadline';
    } else {
      for (const k in incumbent) if (pos === null || incumbent[k] < incumbent[pos]) pos = k;
      mode = 'upgrade';
    }
    if (!pos) return null;

    let avail = TR.findAvailable(state, pos).slice(0, 10);
    if (mode !== 'need') {
      // An unsolicited pitch has to actually beat what's on the field.
      const bar = (incumbent[pos] || 0) + 2;
      avail = avail.filter((a) => R.overall(players[a.playerId]) >= bar);
    }
    if (!avail.length) return null;
    const pick = avail[Math.floor(Math.random() * avail.length)];
    const p = players[pick.playerId];
    const t = state.league.teams.find((x) => x.id === pick.teamId);
    const shopLine = pick.label === 'shopping him' ? 'frankly, we\'re shopping him'
      : pick.label === 'open to moving him' ? 'we\'re open to moving him'
      : 'we\'ll listen on him';
    const opener = mode === 'need'
      ? `Word is you're looking for ${pos} help.`
      : mode === 'deadline'
        ? 'Deadline\'s coming and we\'re open for business.'
        : `No knock on what you're running out at ${pos} — we just think this makes you better.`;
    state.meta.lastRivalPitch = { ...today };
    window.BBGM_INBOX.push(state, {
      from: `${t.abbr} Front Office`,
      subject: `Interested in ${p.name}?`,
      body: `${opener} We'd move ${p.name} ` +
            `(${pos}, ${p.age}, $${((p.contract && p.contract.annualSalary) || 0).toFixed(1)}M) ` +
            `for the right return — ${shopLine}. Call us.`,
      action: { type: 'trade', teamId: t.id, playerId: p.id },
    });
    return { mode, pos, playerId: p.id, teamId: t.id };
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

    // Retry catch-up (0.45.0): a mid-day error used to leave games simmed
    // but their injuries unprocessed — on resume the !g.played filter
    // excluded them and the injuries silently vanished (player played on
    // hurt). Injuries now apply per game the moment it's simmed, each game
    // stamped injProcessed, and any played-but-unstamped game from an
    // interrupted run is picked up here first.
    for (const g of state.league.schedule.games) {
      if (g.played && !g.injProcessed && D.eq(g.date, today)) {
        applyInjuriesFromGames(state, today, [g]);
        g.injProcessed = true;
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
      // Injuries land immediately (IL move, cover call-up, news) so an
      // error later in the day can never orphan them.
      applyInjuriesFromGames(state, today, [g]);
      g.injProcessed = true;
    }
    // Tick recovery on every injured player, return them when the clock
    // runs out (and demote whoever's filling their slot).
    advanceInjuryRecovery(state, today);
    // Position-player fatigue (bible 10.8): players who didn't appear today
    // recover; rest-recommended notifications fire for user-team starters
    // who hit the very-high threshold. Pass ALL of today's played games —
    // on a retry the just-simmed `games` list omits games that completed
    // before the interruption, and their players must not double-recover.
    advanceFatigueRecovery(state,
      state.league.schedule.games.filter((g) => g.played && D.eq(g.date, today)));
    surfaceFatigueRestNotifications(state, today);

    const stops = window.BBGM_STATE.simStops(state);

    // In-season development ticks + merit-based roster moves (0.38.0).
    devTickAndMoves(state, today, stops);

    // AI mid-season FA sweep (0.50.0): clubs scoop stranded pool talent
    // a few times a month — a star free agent no longer sits all year.
    window.BBGM_FA.aiMidSeasonTick(state, today);

    // AI trade activity (bible 15.7): AI-AI deals and occasional
    // unsolicited offers to the user, up to the July 31 deadline.
    // A NEW offer to the user is a sim-stop event when the toggle is on.
    const offersBefore = (state.pendingTradeOffers || []).length;
    window.BBGM_TRADES.aiTradeTick(state, today);
    if (stops.tradeOffer && (state.pendingTradeOffers || []).length > offersBefore) {
      const offer = state.pendingTradeOffers[state.pendingTradeOffers.length - 1];
      const from = state.league.teams.find((t) => t.id === offer.fromTeamId);
      queueHalt({
        title: 'Trade Offer Received',
        body: `${from ? from.name : 'A rival club'} sent your front office a trade proposal. ` +
              `Offers expire after 7 days.`,
        actions: [{ label: 'Review Offer', kind: 'primary', onClick: () => {
          navigate('gm', { tab: 'trades' });
          return true;
        }}],
      });
    }

    // Waiver wire (0.22.0): AI clubs occasionally DFA a squeezed-out vet,
    // and entries that have sat their 2 days resolve — worst record
    // claims first, unclaimed players clear to free agency.
    const wvEvents = window.BBGM_WAIVERS.dailyTick(state, today);
    if (wvEvents.length && !state.news) state.news = [];
    for (const ev of wvEvents) {
      const p = state.players[ev.playerId];
      const from = state.league.teams.find((t) => t.id === ev.fromTeamId);
      if (!p) continue;
      if (ev.kind === 'waived') {
        state.news.push({ date: { ...today },
          body: `${from ? from.abbr : '?'} designate <strong>${p.name}</strong> (${p.primaryPosition}) ` +
                `for assignment — on waivers for 2 days.` });
        if (stops.waiverWire && ev.ovr >= 48) {
          queueHalt({
            title: 'Waiver Wire',
            body: `${from ? from.name : 'A rival club'} just waived ${p.name} ` +
                  `(${p.primaryPosition}, ${U.gradeFor(ev.ovr)} OVR). Worst record claims first — ` +
                  `you have 2 days to put in a claim.`,
            actions: [{ label: 'View the Wire', kind: 'primary', onClick: () => {
              navigate('gm', { tab: 'waivers' });
              return true;
            }}],
          });
        }
      } else if (ev.kind === 'claimed') {
        const by = state.league.teams.find((t) => t.id === ev.byTeamId);
        const demoted = ev.demotedId ? state.players[ev.demotedId] : null;
        state.news.push({ date: { ...today },
          body: `<strong>${by ? by.abbr : '?'}</strong> claim <strong>${p.name}</strong> off waivers` +
                (from ? ` from ${from.abbr}` : '') + '.' });
        if (ev.userWon) {
          queueHalt({
            title: 'Claim Awarded',
            body: `${p.name} is yours — your claim had priority. He takes on his existing contract` +
                  (demoted ? `; ${demoted.name} was optioned to ${demoted.rosterStatus} to make room.` : '.'),
          });
        } else if (ev.userLost) {
          state.news.push({ date: { ...today },
            body: `You lost the claim on <strong>${p.name}</strong> to ${by ? by.name : 'a rival'} — ` +
                  `the worse record claims first.` });
        }
      } else if (ev.kind === 'cleared') {
        state.news.push({ date: { ...today },
          body: `<strong>${p.name}</strong> clears waivers and is a free agent.` });
      }
    }

    // Trade-deadline heads-up (0.21.0): one stop per season, three days
    // out, so a deadline never slides past mid-sim.
    if (stops.deadline && today.month === 7 && today.day === 28 &&
        state.meta.deadlineNoticeYear !== today.year && !state.postseason) {
      state.meta.deadlineNoticeYear = today.year;
      // Owner's deadline stance (0.37.0): buy or sell, in writing.
      {
        const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
        const pct = ut.seasonRecord.w / Math.max(1, ut.seasonRecord.w + ut.seasonRecord.l);
        window.BBGM_INBOX.push(state, {
          from: `${ut.ownerName} (Owner)`,
          subject: 'The deadline is Thursday',
          body: pct >= 0.54
            ? 'We\'re in this. If a piece puts us over the top, you have my blessing to move prospects — within reason.'
            : pct >= 0.47
              ? 'We\'re on the fence. I won\'t tell you which way to jump, but don\'t stand still — pick a direction.'
              : 'Let\'s be honest about where we are. Move the veterans, stock the farm, and let\'s build toward next year.',
          action: { type: 'navigate', tab: 'gm', opts: { tab: 'trades' } },
        });
      }
      queueHalt({
        title: 'Trade Deadline — 3 Days Out',
        body: 'The July 31 trade deadline is three days away. After that, rosters are locked into October — last chance to buy or sell.',
        actions: [{ label: 'Open Trade Center', kind: 'primary', onClick: () => {
          navigate('gm', { tab: 'trades' });
          return true;
        }}],
      });
    }

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
      window.BBGM_INBOX.push(state, {
        from: 'International Scouting',
        subject: `${intlClass.year} int'l board is up`,
        body: 'The class is posted — roughly a hundred names, signing day July 2. ' +
              'We\'ve filed first reads on the top of the board; say the word and we\'ll send targeted looks at anyone unscouted.',
        action: { type: 'navigate', tab: 'draft', opts: { tab: 'intl' } },
      });
    }

    // Head scout's season letter (0.47.0): once per class — he proposes a
    // winter focus region; the GM answers from the intl hub's scout card.
    // Fires for rollover-generated classes (first simmed day of the new
    // season) and the season-1 fallback alike.
    if (state.intl && state.intl.phase === 'scouting' && !state.intl.scoutLetterSent) {
      state.intl.scoutLetterSent = true;
      const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
      const sc = window.BBGM_STAFF.scoutFor ? window.BBGM_STAFF.scoutFor(state, ut) : null;
      const regions = window.BBGM_INTL.regionStrengths(state.intl);
      const r1 = regions[0], r2 = regions[1];
      window.BBGM_INBOX.push(state, {
        from: sc ? `${sc.name} (Head Scout)` : 'International Scouting',
        subject: 'Where do you want me this winter?',
        body: `Early looks at the ${state.intl.year} class: the talent is concentrated in ` +
              `${r1.label} — ${r1.top30} of my top 30 — ` +
              (r2 && r2.top30 ? `with ${r2.label} close behind (${r2.top30}). ` : '. ') +
              'Give me a region and I\'ll live there until July; my reads on those kids will be a lot sharper. ' +
              'Set my focus from the international hub whenever you\'ve decided.',
        action: { type: 'navigate', tab: 'draft', opts: { tab: 'intl' } },
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
      window.BBGM_INBOX.push(state, {
        from: 'Amateur Scouting',
        subject: `${draftClass.year} draft board is live`,
        body: `${flavor} The full board is in the Draft Hub — flag your targets and we'll keep the reports current through June 30.`,
        action: { type: 'navigate', tab: 'draft', opts: { tab: 'board' } },
      });
    }

    maybeRivalPitch(state, today);

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

  // ---- In-season development + merit moves (0.38.0) ------------------------
  // Monthly tick (1st of May–Sep): every unretired player takes a small
  // development step along his archetype curve — ~7% of the annual rates
  // per tick, with the offseason pass scaled to 65% so the yearly total is
  // unchanged. The visible difference: a breakout farmhand improves DURING
  // the season, and an aging vet visibly slips. Weekly, orgs act on it —
  // ROSTER.midSeasonMoves promotes the farmhands who've earned it.
  function devTickAndMoves(state, today, stops) {
    if (state.meta && state.meta.offseasonPhase) return;
    const R = window.BBGM_ROSTER;
    // Idempotence (0.45.0): the monthly block is NOT re-runnable —
    // inSeasonTick moves ratings and monthlyLine ADDS a month of stats on
    // every call. An error later in the day used to re-run the 1st on
    // retry: double development league-wide plus a duplicate month of
    // minors/flavor numbers. Stamp the month before running (at-most-once:
    // a missed 0.07-frac tick is noise, a doubled one isn't).
    const monthKey = today.year * 12 + today.month;
    const tickDay = today.day === 1 && today.month >= 5 && today.month <= 9 &&
      state.meta.lastDevTickMonth !== monthKey;
    if (tickDay) {
      state.meta.lastDevTickMonth = monthKey;
      // Flavor-league assignments refresh first (0.41.0) so a newly
      // released or undrafted FA catches on somewhere before the lines
      // are written.
      if (window.BBGM_FLAVOR) window.BBGM_FLAVOR.ensureAssignments(state, today.year);
      for (const id in state.players) {
        const p = state.players[id];
        if (!p || p.retired || p.status === 'retired') continue;
        window.BBGM_PROGRESSION.inSeasonTick(p, today.year, 0.07);
        // Monthly stat lines (0.41.0): farmhands and flavor-league FAs
        // post a month of numbers on the 1st — immersion only, no sim.
        if (p.status === 'minors') {
          window.BBGM_MINORS.monthlyLine(p, today.year);
        } else if (p.status === 'FA' && p.playsIn && window.BBGM_FLAVOR) {
          window.BBGM_MINORS.monthlyLine(p, today.year, window.BBGM_FLAVOR.lineOpts(p) || {});
        }
      }
      monthlyDevDigest(state, today);
      // Coach-project midpoint report (0.48.0): on July 1 each coach with
      // an approved project writes an honest progress note.
      if (today.month === 7) {
        const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
        for (const id of [...(ut.roster || []), ...(ut.minors || [])]) {
          const p = state.players[id];
          if (!p || !p.devProject || p.devProject.year !== today.year) continue;
          const dv = p.devProject;
          const coach = state.staff && state.staff.coaches[dv.coachId];
          let delta = 0, n = 0;
          for (const k of dv.attrs) {
            if (dv.startVals[k] != null && p.ratings[k] != null) {
              delta += p.ratings[k] - dv.startVals[k];
              n++;
            }
          }
          const d = n ? Math.round((delta / n) * 10) / 10 : 0;
          window.BBGM_INBOX.push(state, {
            from: coach ? `${coach.name} (${coach.role === 'pitching' ? 'Pitching' : 'Hitting'} Coach)` : 'Player Development',
            subject: `Midseason check-in: ${p.name}`,
            body: d >= 1.5
              ? `The project is working — ${p.name} is up ${d} grades where I teach since spring. The second half is where it sticks.`
              : d > 0
                ? `${p.name} is moving, slowly — up ${d} so far. I'm not worried yet; the jump usually shows late.`
                : `Honest report: ${p.name} hasn't budged yet. We're reworking his routine over the break.`,
          });
        }
      }
    }

    // Pre-move Pipeline ranks for the news ticker — the promoted player
    // graduates off the list the moment he's active, so capture ranks
    // before the moves run. Only bother on days moves can actually fire.
    const moveDay = [1, 8, 15, 22, 29].includes(today.day) &&
      ((today.month === 4 && today.day >= 15) || (today.month >= 5 && today.month <= 8));
    let rankOf = null;
    if (moveDay) {
      rankOf = {};
      window.BBGM_SCOUT.prospectRankings(state).forEach((e, i) => { rankOf[e.id] = i + 1; });
    }

    const events = R.midSeasonMoves(state, today, { userAuto: !stops.promotion });
    if (!events.length) return;
    if (!state.news) state.news = [];
    const userId = state.meta.userTeamId;
    for (const ev of events) {
      const up = state.players[ev.upId];
      const down = ev.downId ? state.players[ev.downId] : null;
      const team = state.league.teams.find((t) => t.id === ev.teamId);
      if (!up || !team) continue;

      if (ev.type === 'suggestion') {
        // User club with the promotion stop ON: notify, don't act. At most
        // one halt per player per season, or a hot farmhand nags weekly.
        if (!state.meta.promoHalts || state.meta.promoHalts.year !== today.year) {
          state.meta.promoHalts = { year: today.year, ids: [] };
        }
        if (state.meta.promoHalts.ids.includes(up.id)) continue;
        state.meta.promoHalts.ids.push(up.id);
        // The manager's voice (0.48.0): the push for the kid comes from
        // the skipper by name, not an anonymous department.
        const promoMgr = window.BBGM_STAFF.managerFor(state, team);
        window.BBGM_INBOX.push(state, {
          from: promoMgr ? `${promoMgr.name} (Manager)` : 'Player Development',
          subject: `${up.name} is forcing the issue`,
          body: promoMgr
            ? `The kid's outplaying ${down ? down.name : 'the back of my roster'}. ` +
              `${up.name} (${up.primaryPosition}, ${up.rosterStatus}) has nothing left to prove down there — ` +
              `I want him in my lineup. Make the call and I'll find him the at-bats.`
            : `${up.name} (${up.primaryPosition}, ${up.rosterStatus}) has nothing left to prove down here — ` +
              `our staff grades him ahead of ${down ? down.name : 'the back of your roster'} right now. ` +
              `He's ready for the call whenever you are.`,
          action: { type: 'navigate', tab: 'team', opts: { tab: 'minors' } },
        });
        queueHalt({
          title: 'Promotion Push',
          body: `${up.name} (${up.primaryPosition}, ${up.rosterStatus}) is outplaying ` +
                `${down ? down.name : 'a big-league roster spot'} — player development says he's ready now.`,
          actions: [{ label: 'View Minors', kind: 'primary', onClick: () => {
            navigate('team', { tab: 'minors' });
            return true;
          }}],
        });
      } else if (ev.type === 'swap') {
        if (ev.teamId === userId) {
          state.news.push({ date: { ...today },
            body: `<strong>Front office move:</strong> ${up.name} (${up.primaryPosition}) earns the call-up` +
                  (down ? `; ${down.name} optioned to ${down.rosterStatus}.` : '.') });
        } else {
          const rank = rankOf ? rankOf[up.id] : null;
          if (rank) {
            state.news.push({ date: { ...today },
              body: `${team.abbr} call up <strong>#${rank} prospect ${up.name}</strong> (${up.primaryPosition})` +
                    (down ? `, optioning ${down.name}.` : '.') });
          }
        }
      } else if (ev.type === 'level' && ev.teamId === userId) {
        state.news.push({ date: { ...today },
          body: `${up.name} (${up.primaryPosition}) promoted to <strong>${ev.to}</strong> — ` +
                `he'd outgrown ${ev.from}.` });
      }
    }
  }

  // Monthly development digest (0.38.0): on the 1st, right after the dev
  // tick, the minor-league managers and scouts write in about who in the
  // org is moving. Compares each player's overall to last month's
  // snapshot; the May 1 tick seeds the baseline (no letter — nothing to
  // compare against yet).
  function monthlyDevDigest(state, today) {
    const R = window.BBGM_ROSTER;
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!team) return;
    const ids = (team.roster || []).concat(team.minors || [], team.il || []);
    const snap = {};
    for (const id of ids) {
      const p = state.players[id];
      if (p) snap[id] = Math.round(R.overall(p) * 10) / 10;
    }
    const prev = state.meta.devSnap;
    state.meta.devSnap = { year: today.year, month: today.month, ovrs: snap };
    if (!prev || prev.year !== today.year) return;

    const movers = [];
    for (const id in snap) {
      if (prev.ovrs[id] == null) continue;
      const d = Math.round((snap[id] - prev.ovrs[id]) * 10) / 10;
      if (Math.abs(d) < 0.4) continue;
      movers.push({ p: state.players[id], d });
    }
    if (!movers.length) return;
    movers.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const label = (p) => `${p.name} (${p.primaryPosition}, ${p.status === 'minors' ? p.rosterStatus : 'MLB'})`;
    const risers = movers.filter((m) => m.d > 0).slice(0, 4);
    const faders = movers.filter((m) => m.d < 0).slice(0, 4);
    const parts = [];
    if (risers.length) {
      parts.push('Trending up: ' + risers.map((m) => `${label(m.p)} +${m.d.toFixed(1)}`).join('; ') + '.');
    }
    if (faders.length) {
      parts.push('Trending down: ' + faders.map((m) => `${label(m.p)} ${m.d.toFixed(1)}`).join('; ') + '.');
    }
    window.BBGM_INBOX.push(state, {
      from: 'Player Development',
      subject: `${C.MONTHS[today.month - 1]} development report`,
      body: 'Monthly check-in from the minor-league staff. ' + parts.join(' '),
      action: { type: 'navigate', tab: 'team', opts: { tab: 'minors' } },
    });
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
    const stops = window.BBGM_STATE.simStops(state);
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
            if (p.teamId === userTeamId && stops.injury) {
              // Sim stop (0.21.0): the player hits the IL now, but the
              // call-up is the GM's decision — queued, sim frozen.
              R.placeOnILWithMove(state, team, p, { skipCallUp: true });
              queueDecision(state, { kind: 'il-callup', playerId: p.id, date: { ...today } });
              callUpNote = ' <strong>Roster decision required</strong> — choose his replacement.';
            } else {
              const { callUp } = R.placeOnILWithMove(state, team, p);
              if (callUp) callUpNote = ` <strong>${callUp.name}</strong> called up from ${callUp.ilCallUpFor ? 'AAA' : 'the minors'}.`;
            }
          }
        } else if (p.teamId === userTeamId && stops.dayToDay) {
          // Day-to-day knock: no roster move to make, but the user asked
          // to be interrupted for these.
          queueHalt({
            title: 'Injury Update',
            body: `${p.name} is day-to-day with a ${entry.injury.type.toLowerCase()} — expected back in ` +
                  `${entry.injury.daysOut} day${entry.injury.daysOut !== 1 ? 's' : ''}. The manager will sub around him.`,
          });
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
    // Idempotence (0.45.0): an error later in the day makes the user retry
    // the same calendar date — IL clocks must not tick twice for one day.
    if (state.meta.lastRecoveryTick && D.eq(state.meta.lastRecoveryTick, today)) return;
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
        const stops = window.BBGM_STATE.simStops(state);
        if (p.teamId === userTeamId && stops.ilReturn && team.roster.length >= 26) {
          // Sim stop (0.21.0): the send-down is the GM's call. The healthy
          // player waits on the IL until the decision resolves (the queue
          // freezes the calendar, so he never rots there).
          queueDecision(state, { kind: 'il-return', playerId: p.id, date: { ...today } });
          if (!state.news) state.news = [];
          state.news.push({
            date: { ...today },
            body: `<strong>${p.name}</strong> is ready to return from the IL — <strong>roster decision required</strong>.`,
          });
          continue;
        }
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
    // Idempotence (0.45.0): same retry story as the IL clocks — one
    // overnight recovery per calendar day, no matter how many times the
    // day is re-entered after an error.
    const today = state.meta.currentDate;
    if (state.meta.lastFatigueTick && D.eq(state.meta.lastFatigueTick, today)) return;
    state.meta.lastFatigueTick = { ...today };
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
    showPendingDecisions,
    // 0.49.1: exposed for the rival-pitch regression tests (dice-free).
    sendRivalPitch,
  };
})();

// Dev-only namespace alias. Lets users run `BBGM_DEBUG.validateCurrentSave()`
// from the browser console without having to remember the BBGM_MAIN namespace.
window.BBGM_DEBUG = {
  validateCurrentSave: () => window.BBGM_MAIN.validateCurrentSave(),
};
