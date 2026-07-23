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

  // Parse "#RRGGBB" or "RRGGBB" to {r,g,b} (0-255). Returns null on malformed
  // input so callers can fall back without throwing.
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    };
  }

  // Pick a readable text color (white or near-black) for the given background
  // hex. Uses the BT.601 perceived-luminance formula and a threshold tuned so
  // mid-cyan / gold / ice-blue caps (Miami, San Francisco, Denver, San Diego)
  // get dark text while typical dark identities still get white. Returns the
  // string '#ffffff' as a fallback for malformed inputs so callers preserve
  // the prior behaviour.
  function readableTextColor(bgHex) {
    const c = parseHex(bgHex);
    if (!c) return '#ffffff';
    const luma = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    // 0.45 threshold: catches the user-flagged light teams (Miami #00B5E2,
    // SF #F5B300, San Diego #00AEEF, Denver #5DADE2, Phoenix #E25822,
    // Pittsburgh #FFB81C) while leaving dark reds, blues, blacks on white.
    return luma > 0.45 ? '#1a1a1a' : '#ffffff';
  }

  function teamCap(team, opts = {}) {
    const size = opts.size === 'lg' ? 'team-cap team-cap-lg' : 'team-cap';
    const primary = team && team.colors && team.colors.primary;
    const cap = el('div', {
      class: size,
      style: {
        'background-color': primary || '#1c2230',
        'color': readableTextColor(primary),
      }
    }, team ? team.abbr : '');
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

  // fullScreen (0.46.1): the tall card views (player profile, prospect
  // cards, the ratings chart) take the whole viewport — the body scrolls
  // internally and the action bar stays pinned, so the Close button never
  // needs a scroll to reach. Dialogs and short lists stay bottom sheets.
  function showModal({ title, body, actions, fullScreen }) {
    const root = document.getElementById('modalRoot');
    clearChildren(root);
    root.classList.toggle('full', !!fullScreen);
    const modal = el('div', { class: fullScreen ? 'modal modal-full' : 'modal' });
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
    root.classList.remove('full');
    clearChildren(root);
  }

  function ratingDisplay(value) {
    const g = gradeFor(value);
    return el('span', { class: `value ${gradeClass(value)}` }, String(g));
  }

  // CSS custom properties for any surface tinted with a team's identity
  // colors (team strip, player profile header, etc.). The text-color var is
  // chosen so the surface stays readable for light identities like DEN's
  // ice blue → white gradient, where hardcoded white text would vanish.
  function teamColorVars(team) {
    const primary = team && team.colors && team.colors.primary;
    const secondary = team && team.colors && team.colors.secondary;
    // Use the LOWER luminance of the two gradient endpoints. If even the
    // darker end is still light (e.g. DEN ice-blue → white, MIA cyan →
    // hot pink), white text fails everywhere on the surface and we flip to
    // dark text. For mixed gradients (e.g. TOR navy → gold, BOS red →
    // navy) at least one end is dark enough for white text to read, so we
    // keep white — flipping to dark would just move the problem.
    const a = parseHex(primary);
    const b = parseHex(secondary);
    const lumaA = a ? (0.299 * a.r + 0.587 * a.g + 0.114 * a.b) / 255 : 0;
    const lumaB = b ? (0.299 * b.r + 0.587 * b.g + 0.114 * b.b) / 255 : 0;
    const minLuma = Math.min(lumaA, lumaB);
    const textColor = minLuma > 0.5 ? '#1a1a1a' : '#ffffff';
    return {
      '--team-primary': primary || '#1c2230',
      '--team-secondary': secondary || '#161b22',
      '--team-text-color': textColor,
    };
  }

  // ---- "Night Game" broadcast package helpers (0.42.0) ---------------------

  // Key the app chrome (header topline, nav active, tabs, chips) to the
  // user's franchise. Contrast guard: a near-black identity would vanish
  // against the --night chrome and a near-white one would blow out the
  // amber/chalk text around it, so we fall through primary → secondary →
  // the neutral accent red. Values land on <html> so every CSS rule
  // using var(--chrome-*, var(--accent*)) re-keys at once.
  function setChromeTeam(team) {
    const root = document.documentElement;
    const usable = (hex) => {
      const c = parseHex(hex);
      if (!c) return false;
      const luma = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
      return luma >= 0.10 && luma <= 0.82;
    };
    const primary = team && team.colors && team.colors.primary;
    const secondary = team && team.colors && team.colors.secondary;
    const chosen = usable(primary) ? primary : (usable(secondary) ? secondary : null);
    if (!chosen) {
      for (const k of ['--chrome-primary', '--chrome-secondary', '--chrome-text', '--chrome-soft']) {
        root.style.removeProperty(k);
      }
      return;
    }
    const other = chosen === primary ? (secondary || primary) : primary;
    const c = parseHex(chosen);
    root.style.setProperty('--chrome-primary', chosen);
    root.style.setProperty('--chrome-secondary', other || chosen);
    root.style.setProperty('--chrome-text', readableTextColor(chosen));
    root.style.setProperty('--chrome-soft', `rgba(${c.r}, ${c.g}, ${c.b}, 0.15)`);
  }

  // Inline SVG icons for dynamic call sites (nav icons live in
  // index.html). stroke: currentColor so they tint with their parent.
  const ICONS = {
    envelope: '<path d="M3 6h18v13H3z"/><path d="M3 7l9 6 9-6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/>',
    plate: '<path d="M5 4h14v7l-7 9-7-9z"/>',
    diamond: '<rect x="7.5" y="7.5" width="9" height="9" transform="rotate(45 12 12)"/>',
  };
  function icon(name, size = 22) {
    const paths = ICONS[name] || '';
    return el('span', {
      class: 'icon',
      html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
        `stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`,
    });
  }

  // Last-10 form guide: the broadcast "L10 ■■□■■" strip. `lastTen` is the
  // engine's array of 'W'/'L' (oldest first).
  function formStrip(lastTen) {
    const strip = el('span', { class: 'form-strip' });
    for (const r of (lastTen || []).slice(-10)) {
      strip.appendChild(el('i', { class: r === 'W' ? 'w' : 'l' }));
    }
    return strip;
  }

  // Scorebug stat plate: mono value over a caps label.
  function statPlate(label, value) {
    const plate = el('span', { class: 'stat-plate' });
    plate.appendChild(el('span', { class: 'v' }, String(value)));
    plate.appendChild(el('span', { class: 'k' }, label));
    return plate;
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
    readableTextColor, parseHex,
    setChromeTeam, icon, formStrip, statPlate,
  };
})();
