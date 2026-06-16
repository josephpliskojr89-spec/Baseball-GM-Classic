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
    const BUILD = 'phase4-injuries-1';
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
              window.BBGM_STATE.reset();
              location.reload();
            }},
          ],
        });
      }}
    }, 'New Game (erase save)'));

    container.appendChild(actions);

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
