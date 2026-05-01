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

    // Check for existing save
    const hasSave = window.BBGM_STATE.hasSave();
    document.getElementById('btnLoadGame').disabled = !hasSave;
    if (!hasSave) {
      document.getElementById('btnLoadGame').classList.add('hidden');
    }

    // Wire splash buttons
    document.getElementById('btnNewGame').addEventListener('click', () => {
      if (hasSave) {
        U.showModal({
          title: 'Start a New Game?',
          body: 'You have an existing save. Starting a new game will erase it.',
          actions: [
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
            { label: 'Erase & New', kind: 'danger', onClick: () => {
              window.BBGM_STATE.reset();
              startNewGameFlow();
            }},
          ],
        });
      } else {
        startNewGameFlow();
      }
    });
    document.getElementById('btnLoadGame').addEventListener('click', () => {
      const s = window.BBGM_STATE.load();
      if (s) startGame(s);
      else U.showToast('No save found.', 'warning');
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

    // Modal close on backdrop click
    document.getElementById('modalRoot').addEventListener('click', (e) => {
      if (e.target.id === 'modalRoot') U.closeModal();
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
          version: '0.3.0',
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
      window.BBGM_STATE.reset();
      startNewGameFlow();
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
      U.showModal({
        title: 'Old Save Not Supported',
        body: 'This save was created with the old random-team system. The game now uses ' +
              'the fixed NABL 30-team league, so older saves cannot be continued. ' +
              'Start a new game to use the NABL teams. Your old save will be erased.',
        actions: [
          { label: 'Start New Game', kind: 'danger', onClick: () => {
            window.BBGM_STATE.reset();
            location.reload();
          }},
        ],
      });
      return;
    }

    // Pre-schedule-fix saves with non-162 game counts.
    const broken = saveHasBrokenSchedule(state);
    if (state.meta.userTeamId) {
      document.getElementById('app').classList.remove('hidden');
      refresh();
    } else {
      showTeamSelect();
    }
    if (broken) {
      U.showModal({
        title: 'Old Save Detected',
        body: 'This save was created before the schedule generator was fixed. ' +
              'Some teams will play fewer than 162 games this season. ' +
              'You can keep playing this save (results will be slightly off), ' +
              'or start a fresh game to use the corrected schedule.',
        actions: [
          { label: 'Keep Playing', kind: 'secondary', onClick: () => true },
          { label: 'Start Fresh', kind: 'danger', onClick: () => {
            window.BBGM_STATE.reset();
            location.reload();
          }},
        ],
      });
    }
  }

  // Pre-NABL saves either have version < '0.3.0' or contain teams with the
  // legacy 'A' / 'B' league values. Either condition flags the save as
  // unsupported.
  function savePreNABL(state) {
    if (!state || !state.league || !Array.isArray(state.league.teams)) return false;
    const v = state.version || '0.1.0';
    if (v < '0.3.0') return true;
    for (const t of state.league.teams) {
      if (t.league === 'A' || t.league === 'B') return true;
    }
    return false;
  }

  function saveHasBrokenSchedule(state) {
    if (!state || !state.league || !state.league.schedule) return false;
    // Saves prior to v0.2.0 used the buggy generator.
    if (!state.version || state.version === '0.1.0') {
      // Verify per-team game count to be sure (a v0.1.0 save MIGHT happen to
      // have a perfect schedule by luck).
      const counts = {};
      for (const t of state.league.teams) counts[t.id] = 0;
      for (const g of state.league.schedule.games) {
        counts[g.homeId] = (counts[g.homeId] || 0) + 1;
        counts[g.awayId] = (counts[g.awayId] || 0) + 1;
      }
      for (const id in counts) if (counts[id] !== 162) return true;
    }
    return false;
  }

  // ------- Navigation -------
  function navigate(tab, options = {}) {
    currentTab = tab;
    viewOptions = options;
    refresh();
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
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
      case 'team': window.BBGM_UI_TEAM.render(main, state); break;
      case 'league': window.BBGM_UI_LEAGUE.render(main, state); break;
      case 'games': window.BBGM_UI_GAMES.render(main, state, opts); break;
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
    simDays(1);
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
      U.showToast('Season is already complete.', 'info');
      return;
    }
    const days = Math.max(1, D.diffDays(today, seasonEnd) + 1);
    simDays(days);
  }

  function simDays(numDays) {
    const state = window.BBGM_STATE.get();
    if (!state) return;
    if (numDays > 1) U.showProgress(`Simulating ${numDays} days…`);
    document.getElementById('btnAdvance').disabled = true;

    // Block frequent saves during multi-day sim
    window.BBGM_STATE.setSaveBlocked(true);

    const simStep = (remaining) => {
      if (remaining <= 0) { finish(); return; }
      try {
        simOneDay(state);
      } catch (e) {
        finishWithError(e);
        return;
      }
      // If it's a season-end event, stop
      const today = state.meta.currentDate;
      const seasonEnd = state.league.schedule.seasonEnd;
      if (D.compare(today, seasonEnd) >= 0) {
        finish();
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
    const games = state.league.schedule.games.filter((g) => !g.played && D.eq(g.date, today));
    for (const g of games) {
      try {
        window.BBGM_SIM.simulateGame(state, g);
        // Track games played per team for rotation
        state.meta.gamesPlayedByTeam[g.homeId] = (state.meta.gamesPlayedByTeam[g.homeId] || 0) + 1;
        state.meta.gamesPlayedByTeam[g.awayId] = (state.meta.gamesPlayedByTeam[g.awayId] || 0) + 1;
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
    // Generate news for any noteworthy results
    generateDailyNews(state, today, games);

    // Advance
    state.meta.currentDate = D.addDays(today, 1);
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

  return { navigate, refresh, advanceDay, simToNextEvent, simToEndOfMonth, simToSeasonEnd, validateCurrentSave };
})();

// Dev-only namespace alias. Lets users run `BBGM_DEBUG.validateCurrentSave()`
// from the browser console without having to remember the BBGM_MAIN namespace.
window.BBGM_DEBUG = {
  validateCurrentSave: () => window.BBGM_MAIN.validateCurrentSave(),
};
