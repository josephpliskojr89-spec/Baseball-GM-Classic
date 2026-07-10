// Amateur draft (bible 13 / Phase 11).
//
// Timeline (13.1/13.3): the draft class is generated on May 1 of each
// season (~300 prospects, 10 rounds x 30 picks) so the user has May and
// June to work the board. The draft itself runs on June 30 — the sim halts
// on draft day until the class is drafted (main.js routes the user to the
// Draft Hub; the harness auto-drafts).
//
// Order (13.2): previous season's reverse standings, same order every
// round, no lottery, no compensation picks. Season 1 has no previous
// standings, so the order uses current standings at class generation.
//
// Prospects live in state.draft.prospects — NOT in state.players — until
// they sign. Unsigned picks (13.7 signing rates) return to school and
// leave the game. Signed picks join their org's minors at a level set by
// draft round and age (13.8) and flow through the existing progression /
// level-reassignment machinery from there. The draft replaces the interim
// generated-prospect backfill as the league's long-term star supply: only
// draft classes produce 70-80 ceiling talent post-launch.
window.BBGM_DRAFT = (function () {
  const D = () => window.BBGM_DATES;
  const GEN = () => window.BBGM_PLAYER_GEN;
  const ROSTER = () => window.BBGM_ROSTER;
  const C = () => window.BBGM_CONSTANTS;

  const ROUNDS = 10;
  const PICKS_PER_ROUND = 30;
  const CLASS_SIZE = ROUNDS * PICKS_PER_ROUND;

  // In-game variance uses Math.random, matching the other engines (the
  // seeded rng is reserved for initial league generation).
  function rand() { return Math.random(); }
  function rint(lo, hi) { return lo + Math.floor(rand() * (hi - lo + 1)); }
  function rfloat(lo, hi) { return lo + rand() * (hi - lo); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function rnorm(mean, sd) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---- Class generation (6.5 / 13.3) ------------------------------------

  // Player backgrounds (6.5 age distribution).
  const BACKGROUNDS = [
    { key: 'HS', label: 'High School', weight: 0.30, ages: [17, 18] },
    { key: 'Fr', label: 'College (Fr)', weight: 0.05, ages: [19, 20] },
    { key: 'So', label: 'College (So)', weight: 0.10, ages: [20, 21] },
    { key: 'Jr', label: 'College (Jr)', weight: 0.35, ages: [21, 22] },
    { key: 'Sr', label: 'College (Sr)', weight: 0.20, ages: [22, 23] },
  ];

  function rollBackground() {
    let r = rand();
    for (const b of BACKGROUNDS) {
      if (r < b.weight) return b;
      r -= b.weight;
    }
    return BACKGROUNDS[BACKGROUNDS.length - 1];
  }

  const SCHOOL_SUFFIXES = ['State', 'Tech', 'A&M', 'College'];
  function schoolFor(bg) {
    const cities = window.BBGM_CITIES || [];
    const city = cities.length ? cities[rint(0, cities.length - 1)].city : 'Central';
    if (bg.key === 'HS') return `${city} HS`;
    const r = rand();
    if (r < 0.35) return `University of ${city}`;
    return `${city} ${SCHOOL_SUFFIXES[rint(0, SCHOOL_SUFFIXES.length - 1)]}`;
  }

  // Best-tool ceiling band by projected slot (6.5), shifted by class
  // strength — strong classes lift the top of the board hardest.
  function ceilingTargetFor(slot, strength) {
    let lo, hi, w;
    if (slot <= 5)        { lo = 70; hi = 80; w = 2.5; }
    else if (slot <= 30)  { lo = 65; hi = 75; w = 2.0; }
    else if (slot <= 60)  { lo = 60; hi = 70; w = 1.25; }
    else if (slot <= 150) { lo = 55; hi = 65; w = 0.6; }
    else                  { lo = 50; hi = 60; w = 0.3; }
    return clamp(rfloat(lo, hi) + strength * w, 42, 82);
  }

  function rollSlotPos() {
    if (rand() < 0.53) return rand() < 0.70 ? 'SP' : 'RP';
    const r = rand();
    if (r < 0.10) return 'C';
    if (r < 0.22) return '1B';
    if (r < 0.34) return '2B';
    if (r < 0.46) return '3B';
    if (r < 0.62) return 'SS';
    if (r < 0.92) return 'OF';
    return 'UT';
  }

  // Talent keys that participate in the ceiling rescale. Pitcher stamina is
  // role capacity, not talent — leave it where generation put it (SP floor
  // rules live in players.js and must survive).
  function talentKeys(p) {
    return p.isPitcher
      ? ['velocity', 'movement', 'control', 'stuff']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'defense', 'arm'];
  }

  function makeProspect(state, year, slot, strength, idx) {
    const bg = rollBackground();
    const age = bg.ages[rint(0, 1)];
    const slotPos = rollSlotPos();
    const p = GEN().generateNewPlayer(rand, { id: null }, {
      slotPos, tier: 'prospect', isProspect: true,
      ageRange: { min: age, max: age },
      status: 'draft', rosterStatus: null,
      id: `dr${year}_${idx + 1}`,
    });
    p.age = age;
    p.birthYear = year - age;
    p.teamId = null;
    p.contract = null;
    p.serviceTime = { years: 0, days: 0 };
    p.background = bg.key;
    p.school = schoolFor(bg);
    p.draftClass = year;

    // Shift ceilings so the BEST tool lands in the slot's band (6.5 bands
    // are "on best ratings", not across the board). Additive shift keeps
    // the tool spread; non-best tools get extra spread so a top pick is a
    // 75-ceiling bat with real weaknesses, not an all-80 monster.
    const keys = talentKeys(p);
    const target = ceilingTargetFor(slot, strength);
    let bestKey = keys[0];
    for (const k of keys) if (p.hidden.ceiling[k] > p.hidden.ceiling[bestKey]) bestKey = k;
    const delta = target - p.hidden.ceiling[bestKey];
    for (const k of keys) {
      const spread = k === bestKey ? 0 : rfloat(0, 7);
      p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + delta - spread, 25, 82) * 10) / 10;
    }

    // HS bats skew toward the high-variance development archetypes (6.5).
    if (bg.key === 'HS' && rand() < 0.30) {
      p.hidden.archetype = p.isPitcher
        ? (rand() < 0.5 ? 'volatile' : 'flameout')
        : (rand() < 0.6 ? 'late_bloomer' : 'volatile');
    }

    // Current ratings: even the class's best bat is no better than
    // MLB-average on draft day (6.5). HS picks are far from their ceiling;
    // college seniors are nearly done developing.
    const gapBase = ({ HS: 24, Fr: 19, So: 16, Jr: 13, Sr: 10 })[bg.key] || 14;
    for (const k of keys) {
      const gap = Math.max(3, gapBase + rnorm(0, bg.key === 'HS' ? 4 : 2));
      p.ratings[k] = clamp(Math.round((p.hidden.ceiling[k] - gap) * 10) / 10, 20,
        Math.min(56, p.hidden.ceiling[k] - 2));
    }
    if (p.isPitcher) {
      // Stamina develops early — keep draft-day stamina near its ceiling so
      // SP prospects profile as starters from day one.
      p.ratings.stamina = clamp(Math.round((p.hidden.ceiling.stamina - rfloat(4, 10)) * 10) / 10, 30, 72);
    }

    // Scouting view (pre-Phase-13 fog): a stable best-tool ceiling band,
    // tighter for college players (6.5 uncertainty bands).
    const fuzz = bg.key === 'HS' ? 6 : 3;
    const best = Math.max(...keys.map((k) => p.hidden.ceiling[k]));
    p.scout = {
      ceilLo: Math.round(best - fuzz - rand() * 2),
      ceilHi: Math.round(best + fuzz + rand() * 2),
    };
    return p;
  }

  // Reverse standings (13.2). Uses last season's archived records; season 1
  // falls back to the standings at class-generation time.
  function computeOrder(state) {
    const teams = state.league.teams;
    const seasons = (state.history && state.history.seasons) || [];
    const last = seasons.length ? seasons[seasons.length - 1] : null;
    const recOf = (t) => {
      if (last && last.records && last.records[t.id]) return last.records[t.id];
      return t.seasonRecord || { w: 0, l: 0, rs: 0, ra: 0 };
    };
    const pct = (r) => (r.w + r.l) > 0 ? r.w / (r.w + r.l) : 0.5;
    return teams.slice().sort((a, b) => {
      const ra = recOf(a), rb = recOf(b);
      const d = pct(ra) - pct(rb);
      if (d !== 0) return d;
      const rd = (ra.rs - ra.ra) - (rb.rs - rb.ra);
      if (rd !== 0) return rd;
      return a.id < b.id ? -1 : 1;
    }).map((t) => t.id);
  }

  function generateClass(state) {
    const year = state.meta.currentDate.year;
    // Class strength: -2..+2 std dev (6.5). Sum-of-uniforms gaussian.
    const strength = Math.round(clamp((rand() + rand() + rand() + rand() - 2) * 1.45, -2, 2) * 10) / 10;

    const prospects = {};
    const list = [];
    for (let i = 0; i < CLASS_SIZE; i++) {
      const p = makeProspect(state, year, i + 1, strength, i);
      prospects[p.id] = p;
      list.push(p);
    }
    // Hidden gem (6.5): ~5% of classes carry a late-round talent with a
    // ceiling far above his slot.
    if (rand() < 0.05) {
      const gem = list[rint(150, CLASS_SIZE - 1)];
      const keys = talentKeys(gem);
      const target = rfloat(68, 76);
      let bestKey = keys[0];
      for (const k of keys) if (gem.hidden.ceiling[k] > gem.hidden.ceiling[bestKey]) bestKey = k;
      const delta = target - gem.hidden.ceiling[bestKey];
      for (const k of keys) {
        const spread = k === bestKey ? 0 : rfloat(0, 7);
        gem.hidden.ceiling[k] = Math.round(clamp(gem.hidden.ceiling[k] + delta - spread, 25, 80) * 10) / 10;
      }
      // The gem hides because scouts don't see it: his public band stays low.
    }

    // Industry consensus board: true-talent score plus scouting noise. The
    // slot bands were assigned in order, so the board is roughly generation
    // order with local reshuffling — reaches and steals both exist.
    const scoreOf = (p) => {
      const keys = talentKeys(p);
      const best = Math.max(...keys.map((k) => p.hidden.ceiling[k]));
      const avgCeil = keys.reduce((s, k) => s + p.hidden.ceiling[k], 0) / keys.length;
      const avgCur = keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length;
      // The public board sees the scouted band, not true ceiling.
      const seen = (p.scout.ceilLo + p.scout.ceilHi) / 2;
      return seen * 0.5 + avgCeil * 0.25 + avgCur * 0.25 + rnorm(0, 2);
    };
    const board = list
      .map((p) => ({ id: p.id, s: scoreOf(p) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.id);

    state.draft = {
      year, strength,
      prospects, board,
      order: computeOrder(state),
      phase: 'preview',            // preview -> live -> complete
      round: 1, pickInRound: 1,
      picks: [],
      userBoard: [],               // user-flagged target ids (13.4)
      mock: null, mockDate: null,
      recap: null,
    };
    return state.draft;
  }

  // Daily hook (main.js simOneDay / harness): generate the class when the
  // calendar enters the pre-draft window. Returns the class if it was
  // created today, else null.
  function ensureClass(state, today) {
    const inWindow = today.month === 5 || (today.month === 6 && today.day < 30);
    if (!inWindow) return null;
    if (state.draft && state.draft.year === today.year) return null;
    return generateClass(state);
  }

  function draftDayPending(state, today) {
    return !!(state.draft &&
      state.draft.year === today.year &&
      state.draft.phase !== 'complete' &&
      today.month === 6 && today.day >= 30);
  }

  // ---- Mock draft (13.4) -------------------------------------------------

  // Round-1 industry mock: one AI-style pass over the top of the board,
  // refreshed weekly while the class is in preview.
  function refreshMock(state) {
    const draft = state.draft;
    if (!draft || draft.phase === 'complete') return null;
    const taken = new Set();
    const mock = [];
    for (let i = 0; i < PICKS_PER_ROUND; i++) {
      const teamId = draft.order[i];
      const team = state.league.teams.find((t) => t.id === teamId);
      const pid = aiChoose(state, team, taken, 1);
      taken.add(pid);
      mock.push({ pick: i + 1, teamId, prospectId: pid });
    }
    draft.mock = mock;
    draft.mockDate = { ...state.meta.currentDate };
    return mock;
  }

  function mockIsStale(state) {
    const draft = state.draft;
    if (!draft) return false;
    if (!draft.mock) return true;
    return D().diffDays(draft.mockDate, state.meta.currentDate) >= 7;
  }

  // ---- AI pick behavior (13.6) -------------------------------------------

  function availableBoard(state) {
    const draft = state.draft;
    const taken = new Set(draft.picks.map((pk) => pk.prospectId));
    return draft.board.filter((id) => !taken.has(id));
  }

  // Choose a prospect for `team` from the untaken board. `taken` is an
  // extra exclusion set (mock sims). Owner archetype shapes both the decay
  // (reach frequency) and the college/HS + polish preferences.
  function aiChoose(state, team, taken, round) {
    const draft = state.draft;
    const pickedSet = taken || new Set(draft.picks.map((pk) => pk.prospectId));
    const avail = draft.board.filter((id) => !pickedSet.has(id));
    if (avail.length === 0) return null;

    const owner = team ? team.owner : null;
    // Window size + geometric decay: disciplined scouting stays near the
    // consensus; aggressive/cheap owners reach further down the board.
    let window_ = 12, decay = 0.58;
    if (owner === 'analytics') { window_ = 8; decay = 0.45; }
    else if (owner === 'aggressive') { decay = 0.68; }
    else if (owner === 'cheap' && round > 1) { window_ = 16; decay = 0.72; }

    const cands = avail.slice(0, window_).map((id, i) => {
      const p = draft.prospects[id];
      let w = Math.pow(decay, i);
      const college = p.background !== 'HS';
      const keys = talentKeys(p);
      const avgCur = keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length;
      if (owner === 'win_now' || owner === 'old_school') {
        // Near-term contributors: polished college bats and advanced arms.
        w *= college ? 1.30 : 0.70;
        w *= 1 + clamp((avgCur - 42) / 60, -0.2, 0.35);
      } else if (owner === 'patient') {
        w *= college ? 0.95 : 1.20; // upside hunting
      } else if (owner === 'cheap' && round <= 3) {
        w *= p.background === 'Sr' ? 1.35 : 1; // signability seniors
      }
      // Light org-need tilt: no young talent anywhere at his position.
      if (team && !p.isPitcher) {
        const orgIds = (team.roster || []).concat(team.minors || []);
        const hasYoung = orgIds.some((oid) => {
          const q = state.players[oid];
          return q && !q.isPitcher && q.age <= 25 && q.primaryPosition === p.primaryPosition;
        });
        if (!hasYoung) w *= 1.12;
      }
      return { id, w };
    });
    let total = cands.reduce((s, c) => s + c.w, 0);
    let r = rand() * total;
    for (const c of cands) {
      if (r < c.w) return c.id;
      r -= c.w;
    }
    return cands[cands.length - 1].id;
  }

  // Scouting-department recommendation for the user's pick (13.5): best
  // player available with a small org-need tilt, no noise.
  function recommendation(state, teamId) {
    const draft = state.draft;
    const team = state.league.teams.find((t) => t.id === teamId);
    const avail = availableBoard(state);
    if (!avail.length) return null;
    let bestId = avail[0], bestScore = -1;
    for (let i = 0; i < Math.min(8, avail.length); i++) {
      const p = draft.prospects[avail[i]];
      let score = 100 - i * 6;
      if (team && !p.isPitcher) {
        const orgIds = (team.roster || []).concat(team.minors || []);
        const hasYoung = orgIds.some((oid) => {
          const q = state.players[oid];
          return q && !q.isPitcher && q.age <= 25 && q.primaryPosition === p.primaryPosition;
        });
        if (!hasYoung) score += 4;
      }
      if (score > bestScore) { bestScore = score; bestId = avail[i]; }
    }
    return bestId;
  }

  // ---- Draft-day execution (13.5) ----------------------------------------

  function startDraft(state) {
    if (!state.draft || state.draft.year !== state.meta.currentDate.year) {
      generateClass(state);
    }
    if (state.draft.phase === 'preview') state.draft.phase = 'live';
    return state.draft;
  }

  function onTheClock(state) {
    const draft = state.draft;
    if (!draft || draft.phase !== 'live') return null;
    if (draft.round > ROUNDS) return null;
    return {
      round: draft.round,
      pickInRound: draft.pickInRound,
      overall: (draft.round - 1) * PICKS_PER_ROUND + draft.pickInRound,
      teamId: draft.order[draft.pickInRound - 1],
    };
  }

  function isUserOnClock(state) {
    const otc = onTheClock(state);
    return !!(otc && otc.teamId === state.meta.userTeamId);
  }

  // Record a pick for the team on the clock and advance the pick pointer.
  function makePick(state, prospectId) {
    const draft = state.draft;
    const otc = onTheClock(state);
    if (!otc) return null;
    const p = draft.prospects[prospectId];
    if (!p) return null;
    const pick = {
      round: otc.round, pick: otc.pickInRound, overall: otc.overall,
      teamId: otc.teamId, prospectId,
      name: p.name, pos: p.primaryPosition, age: p.age,
      background: p.background, school: p.school,
      signed: null, bonus: null,
    };
    draft.picks.push(pick);
    draft.pickInRound++;
    if (draft.pickInRound > PICKS_PER_ROUND) {
      draft.pickInRound = 1;
      draft.round++;
    }
    if (draft.round > ROUNDS) completeDraft(state);
    return pick;
  }

  // Resolve one pick. AI teams pick automatically; the user's pick returns
  // {userTurn:true} unless opts.auto (auto-draft toggle / harness), in
  // which case the scouting department picks for them.
  function advancePick(state, opts = {}) {
    const draft = startDraft(state);
    if (draft.phase !== 'live') return { done: true };
    const otc = onTheClock(state);
    if (!otc) return { done: true };
    const isUser = otc.teamId === state.meta.userTeamId;
    if (isUser && !opts.auto) return { userTurn: true, otc };
    const team = state.league.teams.find((t) => t.id === otc.teamId);
    const pid = isUser ? recommendation(state, otc.teamId) : aiChoose(state, team, null, otc.round);
    if (!pid) { completeDraft(state); return { done: true }; }
    const pick = makePick(state, pid);
    return { pick, done: draft.phase === 'complete' };
  }

  // ---- Signing + integration (13.7 / 13.8) --------------------------------

  // Slot values in $M by overall pick (13.7).
  function slotValue(overall) {
    const lerp = (x, x0, x1, y0, y1) => y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    let v;
    if (overall <= 30) v = lerp(overall, 1, 30, 10, 4);
    else if (overall <= 60) v = lerp(overall, 31, 60, 3.5, 1.5);
    else if (overall <= 150) v = lerp(overall, 61, 150, 1.5, 0.4);
    else v = lerp(overall, 151, 300, 0.4, 0.15);
    return Math.round(v * 100) / 100;
  }

  function signRateFor(round, background) {
    let rate = round <= 3 ? 0.97 : round <= 7 ? 0.92 : 0.82;
    // Late-round HS picks often honor college commitments instead.
    if (round >= 8 && background === 'HS') rate = 0.70;
    return rate;
  }

  // Assignment level by round and age (13.8), respecting the age floors the
  // offseason reassignment uses (a 23-year-old never reports to Rookie ball).
  function levelFor(round, age) {
    let level;
    if (round === 1) level = 'A+';
    else if (round <= 3) level = 'A';
    else if (round <= 7) level = age >= 21 ? 'A' : 'Rookie';
    else level = 'Rookie';
    const ORDER = ['Rookie', 'A', 'A+'];
    let idx = ORDER.indexOf(level);
    if (age >= 22) idx = Math.max(idx, 1);
    if (age >= 24) idx = Math.max(idx, 2);
    return ORDER[idx];
  }

  function completeDraft(state) {
    const draft = state.draft;
    if (draft.phase === 'complete') return draft.recap;
    draft.phase = 'complete';
    const year = draft.year;

    for (const pick of draft.picks) {
      const p = draft.prospects[pick.prospectId];
      if (!p) continue;
      const signs = rand() < signRateFor(pick.round, p.background);
      pick.signed = signs;
      if (!signs) continue; // returns to school; failed pick is forfeited (13.7)
      pick.bonus = Math.round(slotValue(pick.overall) * rfloat(0.85, 1.15) * 100) / 100;

      // Development reality (6.5 "the 1st-rounder who never develops"):
      // the scouted ceiling is a projection, not a promise. Attained
      // ceiling shifts on signing — busts outnumber pleasant surprises,
      // and HS picks carry the wider error bars. p.scout keeps the
      // pre-draft view, so hindsight ("he never became that guy") reads
      // naturally on the profile.
      const bust = p.background === 'HS' ? rnorm(-2.5, 5.5) : rnorm(-1.5, 4);
      for (const k of talentKeys(p)) {
        p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + bust, 25, 82) * 10) / 10;
        p.ratings[k] = Math.min(p.ratings[k], Math.max(20, p.hidden.ceiling[k] - 2));
      }

      const team = state.league.teams.find((t) => t.id === pick.teamId);
      p.status = 'minors';
      p.teamId = team.id;
      p.rosterStatus = levelFor(pick.round, p.age);
      p.contract = { years: 1, annualSalary: 0.74, totalValue: 0.74, signedAt: 'draft' };
      p.draft = {
        year, round: pick.round, pick: pick.pick, overall: pick.overall,
        teamId: team.id, bonus: pick.bonus,
      };
      state.players[p.id] = p;
      team.minors.push(p.id);
    }

    // Recap + condensed history; drop the 300-player prospect map from the
    // save (signed picks now live in state.players).
    const userTeamId = state.meta.userTeamId;
    draft.recap = {
      year, strength: draft.strength,
      userPicks: draft.picks.filter((pk) => pk.teamId === userTeamId),
      round1: draft.picks.filter((pk) => pk.round === 1),
      unsignedNotable: draft.picks.filter((pk) => !pk.signed && pk.round <= 3),
      signedCount: draft.picks.filter((pk) => pk.signed).length,
    };
    if (!state.draftHistory) state.draftHistory = [];
    state.draftHistory.push({
      year, strength: draft.strength,
      picks: draft.picks.map((pk) => ({
        round: pk.round, pick: pk.pick, overall: pk.overall, teamId: pk.teamId,
        playerId: pk.signed ? pk.prospectId : null,
        name: pk.name, pos: pk.pos, age: pk.age,
        background: pk.background, signed: pk.signed, bonus: pk.bonus,
      })),
    });
    draft.prospects = {};
    draft.board = [];
    draft.mock = null;
    draft.userBoard = [];

    // Headlines: the #1 pick, plus the user's top selection.
    if (!state.news) state.news = [];
    const date = { ...state.meta.currentDate };
    const first = draft.picks[0];
    if (first) {
      const t1 = state.league.teams.find((t) => t.id === first.teamId);
      state.news.push({
        date,
        body: `<strong>${first.name}</strong> (${first.pos}, ${first.school}) goes #1 overall ` +
              `to the ${t1 ? t1.name : '?'} in the ${year} NABL Draft.`,
      });
    }
    const userFirst = draft.recap.userPicks[0];
    if (userFirst && userFirst.overall !== 1) {
      state.news.push({
        date,
        body: `With pick #${userFirst.overall}, you select <strong>${userFirst.name}</strong> ` +
              `(${userFirst.pos}, ${userFirst.school}).` +
              (userFirst.signed === false ? ' He did not sign.' : ''),
      });
    }
    return draft.recap;
  }

  // One-shot resolution for the harness and the "auto-draft everything"
  // path: AI picks for every team, including the user's.
  function autoRunDraft(state) {
    startDraft(state);
    let guard = 0;
    while (state.draft.phase === 'live' && guard++ < CLASS_SIZE + 10) {
      advancePick(state, { auto: true });
    }
    return state.draft.recap;
  }

  // User pick summary for a class in preview: which overall picks they hold.
  function userPickSlots(state) {
    const draft = state.draft;
    if (!draft) return [];
    const idx = draft.order.indexOf(state.meta.userTeamId);
    if (idx < 0) return [];
    const out = [];
    for (let r = 1; r <= ROUNDS; r++) {
      out.push({ round: r, pick: idx + 1, overall: (r - 1) * PICKS_PER_ROUND + idx + 1 });
    }
    return out;
  }

  return {
    ROUNDS, PICKS_PER_ROUND, CLASS_SIZE,
    generateClass, ensureClass, draftDayPending,
    refreshMock, mockIsStale,
    startDraft, onTheClock, isUserOnClock, availableBoard,
    advancePick, makePick, recommendation, aiChoose,
    completeDraft, autoRunDraft,
    slotValue, userPickSlots, computeOrder, talentKeys,
  };
})();
