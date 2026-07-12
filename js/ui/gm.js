// GM view: the front-office desk — staff, trades, and free agency.
// Split out of the Team tab in 0.16.2: Team is what happens on the field
// (roster, lineup, pitching, minors); GM is the deals-and-hires side.
// The heavy lifting lives in BBGM_UI_FRONTOFFICE — this module is the
// tab shell.
window.BBGM_UI_GM = (function () {
  const U = window.BBGM_UI;

  let activeTab = 'staff';

  function render(container, state, opts = {}) {
    if (opts && opts.tab) activeTab = opts.tab;
    U.clearChildren(container);
    container.appendChild(U.el('h2', { style: { 'margin-bottom': '12px' } }, 'Front Office'));

    const tabs = U.el('div', { class: 'tabs' });
    const tabDefs = [
      { key: 'staff', label: 'Staff' },
      { key: 'trades', label: 'Trades' },
      { key: 'freeagents', label: 'Free Agents' },
    ];
    for (const t of tabDefs) {
      tabs.appendChild(U.el('button', {
        class: `tab${activeTab === t.key ? ' active' : ''}`,
        on: { click: () => { activeTab = t.key; render(container, state); } },
      }, t.label));
    }
    container.appendChild(tabs);

    if (activeTab === 'staff') window.BBGM_UI_FRONTOFFICE.renderStaff(container, state);
    else if (activeTab === 'trades') window.BBGM_UI_FRONTOFFICE.renderTrades(container, state);
    else window.BBGM_UI_FRONTOFFICE.renderFreeAgents(container, state);
  }

  return { render };
})();
