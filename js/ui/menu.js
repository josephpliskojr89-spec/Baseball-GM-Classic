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
    const BUILD = 'v2.8.2-nofv-1';
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
      on: { click: () => showGuide() },
    }, 'Game Guide'));

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

    // The NABL Ledger (0.73.0): the newsstand — latest edition plus this
    // season's specials, readable any time between Mondays.
    {
      const paperCard = U.el('div', { class: 'card', style: { 'margin-top': '20px' } });
      paperCard.appendChild(U.el('div', { class: 'card-title' }, 'The NABL Ledger'));
      const ps = state.paper || {};
      if (ps.current) {
        const PAPER = window.BBGM_PAPER;
        const rows = [];
        const seen = new Set();
        const entries = [ps.current].concat((ps.specials || []).slice().reverse())
          .filter((ed) => {
            const key = `${ed.kind}:${ed.date.year}-${ed.date.month}-${ed.date.day}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }).slice(0, 5);
        for (const ed of entries) {
          rows.push(U.el('button', {
            class: 'inset-row',
            style: { width: '100%', 'text-align': 'left', background: 'none',
              border: 'none', cursor: 'pointer' },
            on: { click: () => PAPER.show(state, ed) },
          }, [
            U.el('span', { class: 'label' },
              `${PAPER.KIND_LABEL[ed.kind] || 'Edition'} — ${window.BBGM_DATES.format(ed.date, 'date')}`),
            U.el('span', { class: 'value' }, 'Read ›'),
          ]));
        }
        paperCard.appendChild(U.el('div', { class: 'inset-list' }, rows));
      } else {
        paperCard.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px' } },
          'Nothing on the newsstand yet — the first edition prints Monday morning.'));
      }
      container.appendChild(paperCard);
    }

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
      ['inboxMail', 'New mail', 'Stop a sim run when a letter lands in your inbox'],
      ['weeklyPaper', 'Monday paper', 'Stop each Monday morning to read The NABL Ledger'],
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

  // ---- Game Guide (0.56.0) --------------------------------------------------
  // Broad, player-facing explanations of how the systems work. By design
  // this stays at the "how to think about it" level — the hidden
  // machinery (development curves, scouting error models, exact rates)
  // is the game, and the guide never spoils it.
  const GUIDE = [
    ['Your Job', [
      'You are the general manager, not the manager. You build the organization — the roster, the farm, the staff, the budgets — and the manager runs the games with what you give him. Advance Day moves the world forward; everything that needs your signature will stop the calendar or land in your inbox.',
    ]],
    ['The 20-80 Scale', [
      'Every rating uses baseball\'s scouting scale: 50 is a solid everyday big-leaguer, not an average person — a lineup full of 48-52s is a normal team. 55+ is a plus player, 60+ is All-Star territory, and 65+ is the handful of true stars. 20-40 grades belong to depth pieces and developing kids.',
      'Potential is a projection, not a promise. Some players never become what the card said they could be — and a few become more.',
    ]],
    ['Scouting & the Fog', [
      'You almost never see a prospect\'s true ability — you see your scouting department\'s read: a band, not a number. Better departments cost more and read tighter. On the international side, targeted trips buy a sharper look at one kid.',
      'Your head scout is one man with one reputation. His reads have a personality — over a few classes you may learn how his misses lean. He\'ll write you each winter about where to focus, and occasionally about a deep-pool kid he has a hunch on. The deeper in the class you shop, the more of a crapshoot every read becomes — for everyone, at any budget.',
    ]],
    ['Player Development', [
      'Players develop along hidden career paths. Some rise steadily to a mid-career peak, some peak young and fade, some bloom late — and some never develop at all, no matter what the projection said. The most honest signal you have is the attribute history chart on the player card: watch whether the numbers actually move.',
      'Development is shaped by age, playing at the right minor-league level, work habits you can\'t see directly, injuries, and your coaches. A coach may ask to make one young player his personal project for a season — his specialty, worked hard. Rarely, a player finds a whole new gear in an offseason.',
      'Teenagers grow into their tools over calendar years — even the best kid in the sport usually needs his early twenties to put it all together, and the ladder gives him a level at a time. Once in a great while, one doesn\'t wait. When your coaches tell you a kid can\'t be denied, believe them.',
      'Pitchers can change roles: a starter can move to the pen (his stuff often plays up), and a reliever with the tank for it can be stretched out to start — at a cost while he builds up.',
    ]],
    ['The Season', [
      'A 162-game season runs day by day: a 26-man roster, a four-level farm (AAA down to Rookie ball), the injured list, call-ups and send-downs. Players get tired and need rest; the manager handles the daily lineup, but roster construction is yours.',
      'The farm develops players who play at the right level. Your staff will push you to promote a farmhand who has outgrown his level — listen, or don\'t. Simulation Stops (in this menu) control which events halt a sim run and hand you the decision.',
    ]],
    ['The Market', [
      'Trades run all season until the July 31 deadline, then all winter. The Trade Finder shows who\'s genuinely available at a position; the builder handles multi-player deals, cash, and international pool money. Rival GMs will call you with pitches — every one is a real, workable deal.',
      'Free agency runs in winter rounds: stars sign early, asks erode the longer the phone doesn\'t ring, and by spring the leftovers take short, cheap deals. In-season, clubs (yours included) can sign whoever\'s left. Arbitration raises for your young veterans arrive each winter — tender or walk away. Players you let reach the market remember the seat they came from.',
    ]],
    ['The Money', [
      'Two ledgers, visible under GM → Finances. The payroll budget pays players, full stop. The operating budget pays the scouting department and your staff — a bigger scouting operation or a famous manager has to fit inside it.',
      'International signing-pool money is its own pot, granted each year: it signs the July 2 class, and it pays for extra scouting trips on that class. Information competes with bidding power — every dollar spent learning about a kid is a dollar you can\'t offer him.',
    ]],
    ['Draft & International', [
      'The amateur draft runs June 30. Every club keeps a thirty-man board — the names your scouts actually follow. The longer a kid sits on your board, the better your book on him gets, so early conviction is worth more than a late scramble; drop a name and the book goes cold. A projection on a teenager still carries the widest error bars in the sport, and high-school picks are the boom-or-bust end.',
      'The international class signs July 2. It skews younger (16-17), rawer, and riskier than the draft: budgets are limited, the offer ladder decides contested kids, and the top of the class is fought over while the deep pool is a lottery. Your scout\'s winter focus region sharpens his reads there.',
    ]],
    ['Your Staff', [
      'A manager (his tendencies shape the on-field game — he\'ll write you his plan each spring), two coaches (they speed development on their side of the ball, and pitch personal projects), and a head scout. All hired from open markets, all paid from the operating budget, all with reputations that matter. They write letters; most letters carry a one-tap decision.',
    ]],
    ['History & Glory', [
      'Season awards, the All-Star Game, and the Hall of Fame run every year. The Players tab keeps the whole story: sortable stats, past seasons\' leaders, the all-time record book, and a search that finds any player who ever played — including the retired. The news feed is tappable: headlines open the player or the box score.',
    ]],
  ];

  function showGuide() {
    const body = U.el('div');
    body.appendChild(U.el('p', { class: 'muted', style: { 'font-size': '12px', 'margin-bottom': '10px' } },
      'How the world works, in broad strokes. The fine machinery stays under the hood — finding its edges is the game.'));
    for (const [title, paras] of GUIDE) {
      body.appendChild(U.el('div', { class: 'card-title', style: { 'margin-top': '14px' } }, title));
      for (const t of paras) {
        body.appendChild(U.el('p', { style: { 'font-size': '13px', margin: '6px 0', 'line-height': '1.5' } }, t));
      }
    }
    U.showModal({
      title: 'Game Guide',
      body,
      fullScreen: true,
      actions: [{ label: 'Close', kind: 'primary', onClick: () => true }],
    });
  }

  return { render };
})();
