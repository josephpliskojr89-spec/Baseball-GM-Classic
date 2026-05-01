// Shared UI helpers
window.BBGM_UI = (function () {
  const D = window.BBGM_DATES;
  const S = window.BBGM_STATS;

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') {
        for (const sk in attrs[k]) e.style.setProperty(sk, attrs[k][sk]);
      }
      else if (k === 'on' && typeof attrs[k] === 'object') {
        for (const ev in attrs[k]) e.addEventListener(ev, attrs[k][ev]);
      }
      else if (k === 'data' && typeof attrs[k] === 'object') {
        for (const dk in attrs[k]) e.dataset[dk] = attrs[k][dk];
      }
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (typeof children === 'string') {
      e.textContent = children;
    } else if (Array.isArray(children)) {
      for (const c of children) {
        if (c == null) continue;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      }
    } else if (children instanceof Node) {
      e.appendChild(children);
    }
    return e;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function teamCap(team, opts = {}) {
    const size = opts.size === 'lg' ? 'team-cap team-cap-lg' : 'team-cap';
    const cap = el('div', {
      class: size,
      style: {
        'background-color': team.colors.primary,
        'color': '#ffffff',
      }
    }, team.abbr);
    return cap;
  }

  function posBadge(p) {
    const fam = window.BBGM_CONSTANTS.POSITION_FAMILY[p.primaryPosition] || 'infield';
    return el('span', { class: `pos-badge pos-${fam}` }, p.primaryPosition);
  }

  function gradeFor(value) {
    const rounded = Math.round(value / 5) * 5;
    return Math.max(20, Math.min(80, rounded));
  }

  function gradeClass(value) {
    return `grade-${gradeFor(value)}`;
  }

  function fmtMoney(m) {
    if (m >= 1000) return `$${(m/1000).toFixed(1)}B`;
    if (m >= 1) return `$${m.toFixed(1)}M`;
    return `$${(m * 1000).toFixed(0)}K`;
  }

  function showToast(msg, type = 'info', timeout = 3000) {
    const root = document.getElementById('toastRoot');
    const t = el('div', { class: `toast toast-${type}` }, msg);
    root.appendChild(t);
    setTimeout(() => t.remove(), timeout);
  }

  function showProgress(text) {
    const root = document.getElementById('progressRoot');
    document.getElementById('progressText').textContent = text || 'Working…';
    root.classList.remove('hidden');
  }

  function hideProgress() {
    document.getElementById('progressRoot').classList.add('hidden');
  }

  function showModal({ title, body, actions }) {
    const root = document.getElementById('modalRoot');
    clearChildren(root);
    const modal = el('div', { class: 'modal' });
    if (title) modal.appendChild(el('div', { class: 'modal-title' }, title));
    if (body) {
      const bodyEl = el('div', { class: 'modal-body' });
      if (typeof body === 'string') bodyEl.textContent = body;
      else if (body instanceof Node) bodyEl.appendChild(body);
      modal.appendChild(bodyEl);
    }
    if (actions && actions.length) {
      const ac = el('div', { class: 'modal-actions' });
      for (const a of actions) {
        const cls = a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-primary btn-danger' : 'btn-secondary';
        const btn = el('button', {
          class: `${cls} btn-sm`,
          on: { click: () => {
            const result = a.onClick && a.onClick();
            if (result !== false) closeModal();
          }}
        }, a.label);
        ac.appendChild(btn);
      }
      modal.appendChild(ac);
    }
    root.appendChild(modal);
    root.classList.remove('hidden');
  }

  function closeModal() {
    const root = document.getElementById('modalRoot');
    root.classList.add('hidden');
    clearChildren(root);
  }

  function ratingDisplay(value) {
    const g = gradeFor(value);
    return el('span', { class: `value ${gradeClass(value)}` }, String(g));
  }

  function teamColorVars(team) {
    return {
      '--team-primary': team.colors.primary,
      '--team-secondary': team.colors.secondary,
    };
  }

  function gameLabel(game, state) {
    const home = state.league.teams.find((t) => t.id === game.homeId);
    const away = state.league.teams.find((t) => t.id === game.awayId);
    return `${away.abbr} @ ${home.abbr}`;
  }

  // Display helpers for the NABL east/west naming. Internal values are
  // lowercase ('east' / 'west') for save stability; UI uses the friendly
  // names defined in BBGM_LEAGUE_DISPLAY (data/teams.js).
  function leagueName(league) {
    return (window.BBGM_LEAGUE_DISPLAY && window.BBGM_LEAGUE_DISPLAY[league]) || league;
  }
  function divisionLabel(team) {
    return `${leagueName(team.league)} ${team.division}`;
  }

  // Canonical NABL ordering: east before west, then divisions in the order
  // declared in BBGM_DIVISIONS_BY_LEAGUE. Use this for any team list that
  // needs to render groups in NABL-standard order rather than alphabetical
  // (which would shuffle Northeast/Central/Southeast and Pacific/Midwest/
  // South into the wrong sequence).
  function compareTeamsByDivision(a, b) {
    if (a.league !== b.league) return a.league === 'east' ? -1 : 1;
    const order = (window.BBGM_DIVISIONS_BY_LEAGUE && window.BBGM_DIVISIONS_BY_LEAGUE[a.league]) || [];
    return order.indexOf(a.division) - order.indexOf(b.division);
  }

  return {
    el, clearChildren, teamCap, posBadge, gradeFor, gradeClass,
    fmtMoney, showToast, showModal, closeModal, ratingDisplay,
    showProgress, hideProgress, teamColorVars, gameLabel,
    leagueName, divisionLabel, compareTeamsByDivision,
  };
})();
