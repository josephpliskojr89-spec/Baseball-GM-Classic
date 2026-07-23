// Menu / Settings view
window.BBGM_UI_MENU = (function () {
  const U = window.BBGM_UI;

  function render(container, state) {
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Menu'));

    const userTeam = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const card = U.el('div', { class: 'card' });
    card.appendChild(U.el('div', { class: 'card-title' }, 'Save'));
    // Build constant is bumped with every release so the user can tell at a
    // glance which dashboard.js the browser actually loaded. Save version
    // is the save-schema version and changes only when the schema changes.
    const BUILD = 'v0.53.0-tap-the-wire-1';
    card.appendChild(U.el('div', { class: 'inset-list', style: { 'border': 'none' } }, [
      insetRow('Team', userTeam.name),
      insetRow('Date', window.BBGM_DATES.format(state.meta.currentDate)),
      insetRow('Save version', state.version || 'v0.1.0'),
      insetRow('Build', BUILD),
    ]));
    container.appendChild(card);

    const actions = U.el('div', { style: { display: 'flex', 'flex-direction': 'column', gap: '8px' } });
    actions.appendChild(U.el('button', {
      class: 'btn-secondary',
      on: { click: () => {
        window.BBGM_STATE.exportToFile();
        U.showToast('Save exported.', 'success');
      }}
    }, 'Export Save (.json)'));

    actions.appendChild(U.el('button', {
      class: 'btn-secondary',
      on: { click: () => {
        const input = document.getElementById('fileImport');
        input.value = '';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          window.BBGM_STATE.importFromFile(file).then(() => {
            // Reload so the imported save goes through the same load-time
            // gates as a normal Continue (pre-NABL rejection in startGame).
            // Without this, importing an old-format save here would load
            // broken state directly.
            location.reload();
          }).catch((err) => {
            U.showToast('Import failed: ' + err.message, 'danger');
          });
        };
        input.click();
      }}
    }, 'Import Save (.json)'));

    actions.appendChild(U.el('button', {
      class: 'btn-secondary',
      on: { click: () => {
        U.showModal({
          title: 'Start a New Game?',
          body: 'This will erase your current save permanently.',
          actions: [
            { label: 'Cancel', kind: 'secondary', onClick: () => true },
            { label: 'Erase & Restart', kind: 'danger', onClick: () => {
              window.BBGM_STATE.reset().then(() => location.reload());
              return false; // keep modal up until reload
            }},
          ],
        });
      }}
    }, 'New Game (erase save)'));

    container.appendChild(actions);

    // Simulation Stops (0.21.0): which league events halt a sim run and
    // hand the decision to the user instead of the AI. The game is as
    // deep as the player wants — everything off reproduces the old
    // hands-free behavior exactly.
    const simCard = U.el('div', { class: 'card', style: { 'margin-top': '20px' } });
    simCard.appendChild(U.el('div', { class: 'card-title' }, 'Simulation Stops'));
    simCard.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '8px' } },
      'Events that pause the sim so YOU make the call instead of the AI. ' +
      'Turn one off and the front office handles it automatically.'));
    const stops = window.BBGM_STATE.simStops(state);
    const STOP_DEFS = [
      ['injury', 'Injury (IL move)', 'Choose the call-up when one of your players hits the IL'],
      ['ilReturn', 'IL return', 'Choose who goes down when a player is ready to be activated'],
      ['tradeOffer', 'Trade offers', 'Stop when a rival club sends you a proposal'],
      ['deadline', 'Deadline heads-up', 'Stop three days before the July 31 trade deadline'],
      ['waiverWire', 'Waiver wire', 'Stop when a claimable player (48+ OVR) is waived'],
      ['promotion', 'Promotion push', 'Stop when a farmhand outplays a big-league roster spot'],
      ['dayToDay', 'Day-to-day knocks', 'Stop for minor injuries with no roster move'],
    ];
    const toggles = U.el('div', { class: 'inset-list', style: { border: 'none' } });
    for (const [key, label, desc] of STOP_DEFS) {
      const on = !!stops[key];
      const row = U.el('button', {
        class: 'inset-row',
        style: { width: '100%', 'text-align': 'left', background: 'none', border: 'none', cursor: 'pointer' },
        on: { click: () => {
          window.BBGM_STATE.setSimStop(state, key, !on);
          window.BBGM_STATE.set(state);
          window.BBGM_MAIN.refresh();
        }},
      });
      const left = U.el('div', { style: { flex: '1', 'min-width': '0' } });
      left.appendChild(U.el('div', { class: 'label', style: { 'font-weight': '600' } }, label));
      left.appendChild(U.el('div', { class: 'muted', style: { 'font-size': '11px' } }, desc));
      row.appendChild(left);
      row.appendChild(U.el('span', {
        class: 'value',
        style: {
          'font-weight': '700', 'margin-left': '10px', 'white-space': 'nowrap',
          color: on ? 'var(--success, #3fb950)' : 'var(--muted, #8b949e)',
        },
      }, on ? 'STOPS ●' : 'AI ○'));
      toggles.appendChild(row);
    }
    simCard.appendChild(toggles);
    container.appendChild(simCard);

    container.appendChild(U.el('div', { class: 'card', style: { 'margin-top': '20px' } }, [
      U.el('div', { class: 'card-title' }, 'About'),
      U.el('p', {}, 'Baseball GM Classic — a single-player baseball franchise sim.'),
      U.el('p', { style: { 'margin-top': '6px' } }, 'Modern framework, classic baseball.'),
    ]));
  }

  function insetRow(label, value) {
    const r = U.el('div', { class: 'inset-row' });
    r.appendChild(U.el('span', { class: 'label' }, label));
    r.appendChild(U.el('span', { class: 'value' }, value));
    return r;
  }

  return { render };
})();
