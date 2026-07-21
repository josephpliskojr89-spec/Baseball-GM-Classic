// International signings (bible 14 / Phase 12).
//
// Annual cycle (14.1): pool budgets and the ~100-prospect class are set at
// the season rollover (bible's November 1), giving the user the whole
// offseason and first half of the season to scout. The signing window
// opens July 2 — two days after the draft — and the sim halts there until
// the window is worked (or auto-run). Season 1 has no prior rollover, so
// the class generates lazily on opening day with budgets from a flat
// baseline.
//
// Pool budgets (6.10): reverse previous-season standings tiers
// ($9.0M worst 5 … $4.0M best 5), small-market +$0.5M / large -$0.5M,
// plus up to 25% carryover of last year's unspent pool and any overspend
// penalty. Owner archetype does NOT affect pool size.
//
// The window (14.3) runs in three phases: top-10 bidding against AI
// competition, mid-tier (11-50) signings at ask, and bulk low-tier
// signings. Signees join the org at Rookie ball (14.5) with wider
// development variance than draft picks — the 16-year-old lottery ticket.
//
// Special events (14.7) ride the existing free-agency machinery: posted
// NPB stars, Cuban defectors, and KBO declarations are created at the
// rollover and injected into the FA market as headline names.
window.BBGM_INTL = (function () {
  const D = () => window.BBGM_DATES;
  const GEN = () => window.BBGM_PLAYER_GEN;
  const MIN = () => window.BBGM_MINORS;

  const CLASS_SIZE = 100;

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

  // ---- Class generation (6.7) --------------------------------------------

  const COUNTRIES = [
    ['Dominican Republic', 0.35], ['Venezuela', 0.20], ['Cuba', 0.05],
    ['Mexico', 0.08], ['Puerto Rico', 0.05], ['Colombia', 0.04],
    ['Panama', 0.03], ['Nicaragua', 0.05], ['Japan', 0.05],
    ['South Korea', 0.04], ['Taiwan', 0.03], ['Australia', 0.02],
    ['Curaçao', 0.01],
  ];

  function rollCountry() {
    let r = rand();
    for (const [c, w] of COUNTRIES) {
      if (r < w) return c;
      r -= w;
    }
    return COUNTRIES[0][0];
  }

  // Rename by origin: the generic pool skews Anglo, and a Dominican
  // 16-year-old signing as "Dean Pennington" breaks the fiction. Countries
  // without a dedicated pool (Australia) keep the default draw.
  function applyOriginName(p) {
    const IN = window.BBGM_INTL_NAMES;
    if (!IN || !p.origin) return;
    const drawn = IN.nameFor(p.origin, rand);
    if (!drawn) return;
    p.firstName = drawn.first;
    p.lastName = drawn.last;
    p.name = `${drawn.first} ${drawn.last}`;
  }

  function rollAge() {
    const r = rand();
    if (r < 0.45) return 16;
    if (r < 0.75) return 17;
    if (r < 0.85) return 18;
    return rint(19, 22);
  }

  // Best-tool ceiling band by class rank (6.7). Top of the class matches
  // top-of-the-draft ceilings; the bottom 70 are depth lottery tickets.
  function ceilingTargetFor(rank) {
    if (rank <= 5) return rfloat(75, 80);
    if (rank <= 15) return rfloat(65, 75);
    if (rank <= 30) return rfloat(55, 65);
    return rfloat(40, 55);
  }

  // Expected signing bonus by rank ($M) — the "preferred range" AI bids
  // around (14.3) and the slot guidance the UI shows.
  function askFor(rank) {
    if (rank <= 5) return Math.round(rfloat(3.5, 6.5) * 10) / 10;
    if (rank <= 15) return Math.round(rfloat(1.2, 3.2) * 10) / 10;
    if (rank <= 30) return Math.round(rfloat(0.5, 1.2) * 10) / 10;
    if (rank <= 60) return Math.round(rfloat(0.15, 0.5) * 100) / 100;
    return Math.round(rfloat(0.05, 0.2) * 100) / 100;
  }

  function rollSlotPos() {
    if (rand() < 0.50) return rand() < 0.72 ? 'SP' : 'RP';
    const r = rand();
    if (r < 0.10) return 'C';
    if (r < 0.28) return '2B';
    if (r < 0.50) return 'SS';
    if (r < 0.62) return '3B';
    if (r < 0.72) return '1B';
    return 'OF';
  }

  function talentKeys(p) {
    return p.isPitcher
      ? ['velocity', 'movement', 'control', 'stuff']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'defense', 'arm'];
  }

  function makeProspect(state, year, rank) {
    const age = rollAge();
    const p = GEN().generateNewPlayer(rand, { id: null }, {
      slotPos: rollSlotPos(), tier: 'prospect', isProspect: true,
      ageRange: { min: age, max: age },
      status: 'intl', rosterStatus: null,
      id: `int${year}_${rank}`,
    });
    p.age = age;
    p.birthYear = year - age;
    p.teamId = null;
    p.contract = null;
    p.serviceTime = { years: 0, days: 0 };
    p.origin = rollCountry();
    p.intlClass = year;
    applyOriginName(p);

    // Best tool lands in the rank band; the rest keep their spread (same
    // additive approach as the draft — no all-80 monsters).
    const keys = talentKeys(p);
    const target = ceilingTargetFor(rank);
    let bestKey = keys[0];
    for (const k of keys) if (p.hidden.ceiling[k] > p.hidden.ceiling[bestKey]) bestKey = k;
    const delta = target - p.hidden.ceiling[bestKey];
    for (const k of keys) {
      // Rank lift raises the bat, not the legs (Phase 16 balance) —
      // speed keeps its body-given draw unless it's the carrying tool.
      if (!p.isPitcher && k === 'speed' && bestKey !== 'speed') {
        p.hidden.ceiling.speed = Math.round(clamp(
          p.hidden.ceiling.speed + Math.max(0, delta) * 0.15, 25, 80) * 10) / 10;
        continue;
      }
      const spread = k === bestKey ? 0 : rfloat(0, 8);
      p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + delta - spread, 25, 82) * 10) / 10;
    }

    // Current ratings: a 16-year-old is YEARS from his ceiling — rawer
    // than any draft pick (6.7's higher variance). 0.28.0: gaps widened
    // and the polish cap dropped 52 → 46 — teenagers were showing
    // mid-40s current tools (near-MLB polish at 17); a signee's value is
    // the ceiling, and the currents should read like a project.
    const gapBase = age <= 16 ? 36 : age <= 17 ? 33 : age <= 18 ? 29 : 22;
    for (const k of keys) {
      const gap = Math.max(10, gapBase + rnorm(0, 5));
      p.ratings[k] = clamp(Math.round((p.hidden.ceiling[k] - gap) * 10) / 10, 20,
        Math.min(46, p.hidden.ceiling[k] - 4));
    }
    if (p.isPitcher) {
      // A teenage arm hasn't built a starter's tank yet either.
      p.ratings.stamina = clamp(Math.round((p.hidden.ceiling.stamina - rfloat(12, 20)) * 10) / 10, 25, 50);
    }

    // Scouting view: wider bands than the draft (teenagers, thin data).
    const fuzz = 8;
    const best = Math.max(...keys.map((k) => p.hidden.ceiling[k]));
    p.scout = {
      ceilLo: Math.round(best - fuzz - rand() * 3),
      ceilHi: Math.round(best + fuzz + rand() * 3),
    };
    p.ask = askFor(rank);
    return p;
  }

  // ---- Pool budgets (6.10) -------------------------------------------------

  // Reverse-standings tiers from the archived season (or a flat baseline
  // in season 1, when no season has finished yet).
  function computeBudgets(state) {
    const teams = state.league.teams;
    const seasons = (state.history && state.history.seasons) || [];
    const last = seasons.length ? seasons[seasons.length - 1] : null;
    const pct = (r) => (r.w + r.l) > 0 ? r.w / (r.w + r.l) : 0.5;
    let ordered;
    if (last && last.records) {
      ordered = teams.slice().sort((a, b) =>
        pct(last.records[a.id] || { w: 0, l: 0 }) - pct(last.records[b.id] || { w: 0, l: 0 }));
    } else {
      ordered = teams.slice(); // season 1: flat-ish (tier by list order noise)
    }
    const budgets = {};
    ordered.forEach((t, i) => {
      let pool;
      if (!last) pool = 6.5; // season 1 baseline
      else if (i < 5) pool = 9.0;
      else if (i < 10) pool = 7.5;
      else if (i < 20) pool = 6.0;
      else if (i < 25) pool = 5.0;
      else pool = 4.0;
      if (t.market === 'small') pool += 0.5;
      else if (t.market === 'large') pool -= 0.5;

      // Carryover (14.6): up to 25% of last window's unspent pool.
      const prev = state.intlLedger && state.intlLedger[t.id];
      let carry = 0;
      if (prev) {
        carry = Math.min(Math.max(0, prev.pool - prev.spent), prev.pool * 0.25);
        // Overspend penalties (6.10.4).
        if (prev.penaltyMul) pool *= prev.penaltyMul;
      }
      budgets[t.id] = {
        pool: Math.round((pool + carry) * 10) / 10,
        spent: 0,
        restricted: !!(prev && prev.restrictedYears > 0),
      };
    });
    return budgets;
  }

  function generateClass(state, year) {
    const prospects = {};
    const board = [];
    for (let rank = 1; rank <= CLASS_SIZE; rank++) {
      const p = makeProspect(state, year, rank);
      prospects[p.id] = p;
      board.push(p.id);
    }
    state.intl = {
      year,
      prospects, board,
      budgets: computeBudgets(state),
      phase: 'scouting',        // scouting -> window -> complete
      windowStep: 1,            // 1 top tier, 2 mid tier, 3 bulk
      signings: [],
      userOffers: {},           // prospectId -> $M offer (top tier)
      userTargets: [],
      recap: null,
    };
    return state.intl;
  }

  // Daily hook: make sure the current year's class exists (season 1 has no
  // prior rollover to have generated it).
  function ensureClass(state, today) {
    if (today.month > 7 || (today.month === 7 && today.day >= 2)) return null;
    if (state.intl && state.intl.year === today.year) return null;
    return generateClass(state, today.year);
  }

  function windowPending(state, today) {
    return !!(state.intl &&
      state.intl.year === today.year &&
      state.intl.phase !== 'complete' &&
      today.month === 7 && today.day >= 2);
  }

  function openWindow(state) {
    if (state.intl.phase === 'scouting') {
      state.intl.phase = 'window';
      state.intl.windowStep = 1;
    }
    return state.intl;
  }

  // ---- Window resolution (14.3) ---------------------------------------------

  function remainingFor(intl, teamId) {
    const b = intl.budgets[teamId];
    return b ? Math.max(0, b.pool - b.spent) : 0;
  }

  function unsignedBoard(intl) {
    const taken = new Set(intl.signings.map((s) => s.prospectId));
    return intl.board.filter((id) => !taken.has(id));
  }

  function signProspect(state, prospectId, teamId, bonus) {
    const intl = state.intl;
    const p = intl.prospects[prospectId];
    const team = state.league.teams.find((t) => t.id === teamId);
    if (!p || !team) return null;
    const rank = intl.board.indexOf(prospectId) + 1;
    intl.budgets[teamId].spent = Math.round((intl.budgets[teamId].spent + bonus) * 100) / 100;

    // Development reality on signing — wider AND more bust-heavy than the
    // draft (14.5/6.7: teenage projection is the riskiest bet in the
    // sport; the mean sits lower so two star pipelines don't overstock
    // the league's talent pyramid).
    const keys = talentKeys(p);
    const swing = rnorm(-3.5, 7);
    for (const k of keys) {
      p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + swing, 25, 82) * 10) / 10;
      p.ratings[k] = Math.min(p.ratings[k], Math.max(20, p.hidden.ceiling[k] - 4));
    }

    p.status = 'minors';
    p.teamId = teamId;
    // Rookie ball for the teenagers (14.5); the rare 19-22 signee slots by
    // the placement read, capped at A.
    p.rosterStatus = p.age >= 19
      ? (MIN().ORDER.indexOf(MIN().recommendedLevel(p)) >= 1 ? 'A' : 'Rookie')
      : 'Rookie';
    p.contract = { years: 1, annualSalary: 0.74, totalValue: 0.74, signedAt: 'intl' };
    p.intl = { year: intl.year, country: p.origin, rank, bonus };
    state.players[p.id] = p;
    team.minors.push(p.id);

    const rec = { prospectId, teamId, bonus, rank, name: p.name, pos: p.primaryPosition, age: p.age, country: p.origin };
    intl.signings.push(rec);
    return rec;
  }

  // AI interest weight for a team spending pool money.
  function aiAppetite(team) {
    return ({ patient: 1.3, analytics: 1.25, aggressive: 1.0, win_now: 0.8, old_school: 0.8, cheap: 0.7 })[team.owner] || 1;
  }

  // Phase 1: ranks 1-10 go to the highest bidder (user offers from
  // intl.userOffers compete against AI bids).
  function resolveTopTier(state) {
    const intl = state.intl;
    const results = [];
    const top = unsignedBoard(intl).filter((id) => intl.board.indexOf(id) < 10);
    for (const pid of top) {
      const p = intl.prospects[pid];
      const bids = [];
      const userOffer = intl.userOffers[pid];
      if (userOffer && !intl.budgets[state.meta.userTeamId].restricted) {
        bids.push({ teamId: state.meta.userTeamId, amount: userOffer, user: true });
      }
      for (const t of state.league.teams) {
        if (t.id === state.meta.userTeamId) continue;
        const b = intl.budgets[t.id];
        if (b.restricted) continue;
        const remaining = remainingFor(intl, t.id);
        if (remaining < p.ask * 0.8) continue;
        // 0.32.0: participation cut 0.28 → 0.12. Real July 2 classes run
        // on long-standing handshake deals — each elite kid draws 3-4
        // serious suitors, not nine. With ~9 bidders the old market made
        // every user offer below a max-raise a ~3% lottery, which read
        // as "I can never win" (it nearly was). The offer ladder now has
        // legible odds: ask ~5%, +15% ~25%, +30% ~90%, +50% a lock.
        if (rand() > 0.12 * aiAppetite(t)) continue;
        // Most clubs bid inside the expected range; a few chase hard —
        // the aggressive tail keeps a +30% offer from being a guarantee.
        const mul = rand() < 0.15 ? rfloat(0.85, 1.35) : rfloat(0.85, 1.3);
        const amount = Math.min(remaining, p.ask * mul);
        bids.push({ teamId: t.id, amount: Math.floor(amount * 100) / 100 });
      }
      if (!bids.length) continue; // stays on the board for phase 2
      bids.sort((a, b) => b.amount - a.amount);
      const win = bids[0];
      // userOffer rides along so the UI can show honest outbid feedback
      // ("SFG paid $7.1M — your $5.5M") on kids the user bid on and lost.
      results.push({ ...signProspect(state, pid, win.teamId, win.amount),
        user: !!win.user, bidders: bids.length, userOffer: userOffer || null });
    }
    intl.windowStep = 2;
    return results;
  }

  // Phase 2/3 AI pass: distribute remaining prospects to teams with pool
  // money. maxRank bounds the tier (50 for phase 2, 100 for phase 3).
  function resolveAiTier(state, maxRank) {
    const intl = state.intl;
    const results = [];
    for (const pid of unsignedBoard(intl)) {
      const rank = intl.board.indexOf(pid) + 1;
      if (rank > maxRank) continue;
      const p = intl.prospects[pid];
      const cands = state.league.teams.filter((t) => {
        if (t.id === state.meta.userTeamId) return false;
        const b = intl.budgets[t.id];
        if (b.restricted && p.ask > 0.3) return false;
        return remainingFor(intl, t.id) >= p.ask;
      });
      if (!cands.length) continue; // unsigned — pool money ran dry
      // Weight by remaining pool and archetype appetite.
      const weights = cands.map((t) => remainingFor(intl, t.id) * aiAppetite(t));
      let r = rand() * weights.reduce((a, b) => a + b, 0);
      let pick = cands[0];
      for (let i = 0; i < cands.length; i++) {
        if (r < weights[i]) { pick = cands[i]; break; }
        r -= weights[i];
      }
      // Never bid an AI team past its remaining pool (overspending is a
      // user-only strategic choice with penalties attached).
      const bonus = Math.min(
        Math.round(p.ask * rfloat(0.9, 1.1) * 100) / 100,
        Math.floor(remainingFor(intl, pick.id) * 100) / 100);
      results.push(signProspect(state, pid, pick.id, bonus));
    }
    return results;
  }

  function advanceWindow(state) {
    const intl = openWindow(state);
    if (intl.windowStep === 1) return { step: 1, results: resolveTopTier(state) };
    if (intl.windowStep === 2) {
      const results = resolveAiTier(state, 50);
      intl.windowStep = 3;
      return { step: 2, results };
    }
    const results = resolveAiTier(state, CLASS_SIZE);
    return { step: 3, results, done: true, recap: closeWindow(state) };
  }

  // User signs a specific prospect at ask during phases 2-3 (14.3: "target
  // specific players and usually land them at slot value").
  function userSign(state, prospectId) {
    const intl = state.intl;
    const p = intl.prospects[prospectId];
    if (!p || intl.phase !== 'window') return { error: 'window closed' };
    const userTeamId = state.meta.userTeamId;
    if (intl.budgets[userTeamId].restricted && p.ask > 0.3) {
      return { error: 'Signing restrictions: nothing over $300K this year.' };
    }
    const bonus = Math.round(p.ask * 100) / 100;
    return { signing: signProspect(state, prospectId, userTeamId, bonus) };
  }

  // Overspend penalties (6.10.4), assessed when the window closes. The
  // ledger carries pool/spent into next year's budget computation (25%
  // carryover for everyone under pool; penalties for anyone over).
  function closeWindow(state) {
    const intl = state.intl;
    intl.phase = 'complete';
    if (!state.intlLedger) state.intlLedger = {};
    const penalties = [];
    for (const t of state.league.teams) {
      const b = intl.budgets[t.id];
      const overPct = b.pool > 0 ? (b.spent - b.pool) / b.pool : 0;
      let penaltyMul = null, restrictedYears = 0;
      if (overPct > 0.30) { restrictedYears = 2; penaltyMul = 0.5; }
      else if (overPct > 0.15) { penaltyMul = 0.5; }
      else if (overPct > 0.05) { penaltyMul = 0.85; }
      if (penaltyMul || restrictedYears) {
        penalties.push({ teamId: t.id, overPct: Math.round(overPct * 100), restrictedYears });
      }
      const prevRestricted = (state.intlLedger[t.id] && state.intlLedger[t.id].restrictedYears) || 0;
      state.intlLedger[t.id] = {
        pool: b.pool, spent: b.spent,
        penaltyMul,
        restrictedYears: Math.max(restrictedYears, Math.max(0, prevRestricted - 1)),
      };
    }

    const userTeamId = state.meta.userTeamId;
    const userBudget = intl.budgets[userTeamId] || { spent: 0, pool: 0 };
    const userSignings = intl.signings.filter((s) => s.teamId === userTeamId);
    intl.recap = {
      year: intl.year,
      signedCount: intl.signings.length,
      top5: intl.signings.filter((s) => s.rank <= 5),
      userSignings,
      userSpent: userBudget.spent,
      userPool: userBudget.pool,
      penalties,
    };
    if (!state.intlHistory) state.intlHistory = [];
    state.intlHistory.push({
      year: intl.year,
      signings: intl.signings.map((s) => ({ ...s })),
    });

    // Headlines.
    if (!state.news) state.news = [];
    const date = { ...state.meta.currentDate };
    const top = intl.signings.filter((s) => s.rank === 1)[0] || intl.signings[0];
    if (top) {
      const t = state.league.teams.find((x) => x.id === top.teamId);
      state.news.push({
        date,
        body: `International signing day: <strong>${top.name}</strong> (${top.pos}, ${top.country}, ${top.age}) ` +
              `signs with the ${t ? t.name : '?'} for $${top.bonus}M.`,
      });
    }
    for (const s of userSignings.slice(0, 3)) {
      if (top && s.prospectId === top.prospectId) continue;
      state.news.push({
        date,
        body: `You sign <strong>${s.name}</strong> (${s.pos}, ${s.country}, ${s.age}) for $${s.bonus}M.`,
      });
    }

    // Free the 100-player pool from the save; signees live in players now.
    intl.prospects = {};
    intl.board = [];
    intl.userOffers = {};
    intl.userTargets = [];
    return intl.recap;
  }

  // One-shot: AI works the whole window, including the user's team (auto
  // and harness path). The user's team behaves like a mid-appetite AI.
  function autoRunWindow(state) {
    const intl = openWindow(state);
    // Let the user's team compete in the AI passes.
    const userTeamId = state.meta.userTeamId;
    const realUser = userTeamId;
    // Temporarily unset user so resolve passes treat the team as AI.
    state.meta.userTeamId = '__none__';
    try {
      let guard = 0;
      while (state.intl.phase !== 'complete' && guard++ < 5) advanceWindow(state);
    } finally {
      state.meta.userTeamId = realUser;
    }
    // Recap was computed with no "user" — rebuild the user slice.
    const r = intl.recap;
    if (r) {
      r.userSignings = (state.intlHistory[state.intlHistory.length - 1].signings || [])
        .filter((s) => s.teamId === realUser);
      r.userSpent = intl.budgets[realUser] ? intl.budgets[realUser].spent : 0;
      r.userPool = intl.budgets[realUser] ? intl.budgets[realUser].pool : 0;
    }
    return r;
  }

  // ---- Special events (14.7) — created at rollover, sold through FA ----------

  function makeEventPlayer(state, opts) {
    // Persisted counter, not rand(): the module RNG reseeds per load, so
    // two same-year rollovers (or an error-retried offseason) could mint
    // colliding random ids and silently overwrite a player.
    if (!state.meta.nextGenId) state.meta.nextGenId = 1;
    const id = `iev${state.meta.currentDate.year}_${state.meta.nextGenId++}`;
    const p = GEN().generateNewPlayer(rand, { id: null }, {
      slotPos: opts.slotPos, tier: opts.tier, isProspect: false,
      ageRange: { min: opts.age, max: opts.age },
      status: 'FA', rosterStatus: 'FA',
      id,
    });
    p.age = opts.age;
    p.birthYear = state.meta.currentDate.year - opts.age;
    p.teamId = null;
    p.origin = opts.country;
    p.intlEvent = opts.event;
    applyOriginName(p);
    p.serviceTime = { years: opts.serviceYears, days: 0 };
    p.contract = { years: 0, annualSalary: 0, totalValue: 0, signedAt: 'intl-event' };
    state.players[p.id] = p;
    if (!state.freeAgents) state.freeAgents = [];
    state.freeAgents.push(p.id);
    p.faSeasons = 0;
    return p;
  }

  const EVENT_POS = () => (rand() < 0.5 ? (rand() < 0.7 ? 'SP' : 'RP')
    : ['C', '1B', '2B', '3B', 'SS', 'OF'][rint(0, 5)]);

  // Rolled once per rollover (before the FA market is built, so these
  // names headline it). Returns news-ready event records.
  function rollOffseasonEvents(state) {
    const events = [];
    const rollCount = (weights) => {
      let r = rand();
      for (let n = 0; n < weights.length; n++) {
        if (r < weights[n]) return n;
        r -= weights[n];
      }
      return 0;
    };

    // Japanese postings: 0-3 MLB-ready NPB stars (25-30).
    const postings = rollCount([0.40, 0.35, 0.20, 0.05]);
    for (let i = 0; i < postings; i++) {
      const p = makeEventPlayer(state, {
        event: 'posting', country: 'Japan', age: rint(25, 30),
        tier: rand() < 0.4 ? 'star' : 'plus', slotPos: EVENT_POS(),
        serviceYears: 6, // negotiates like a free agent (14.7)
      });
      events.push({ kind: 'posting', playerId: p.id, name: p.name, pos: p.primaryPosition, age: p.age,
        fee: rint(20, 50) });
    }

    // Cuban defectors: 0-2, high variance (the Abreu/Chapman lineage).
    const defectors = rollCount([0.55, 0.35, 0.10]);
    for (let i = 0; i < defectors; i++) {
      const p = makeEventPlayer(state, {
        event: 'defector', country: 'Cuba', age: rint(22, 27),
        tier: rand() < 0.35 ? 'plus' : 'avg', slotPos: EVENT_POS(),
        serviceYears: 6,
      });
      // Extra uncertainty: a hidden swing either way on the whole profile.
      const keys = talentKeys(p);
      const swing = rnorm(0, 6);
      for (const k of keys) {
        p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + swing, 25, 82) * 10) / 10;
        p.ratings[k] = Math.min(p.ratings[k], Math.max(20, p.hidden.ceiling[k] - 2));
      }
      events.push({ kind: 'defector', playerId: p.id, name: p.name, pos: p.primaryPosition, age: p.age });
    }

    // KBO declarations: 0-1, older and more affordable.
    if (rollCount([0.70, 0.30]) === 1) {
      const p = makeEventPlayer(state, {
        event: 'kbo', country: 'South Korea', age: rint(28, 32),
        tier: rand() < 0.5 ? 'plus' : 'avg', slotPos: EVENT_POS(),
        serviceYears: 6,
      });
      events.push({ kind: 'kbo', playerId: p.id, name: p.name, pos: p.primaryPosition, age: p.age });
    }
    return events;
  }

  return {
    CLASS_SIZE,
    generateClass, ensureClass, windowPending,
    openWindow, advanceWindow, userSign, autoRunWindow, closeWindow,
    unsignedBoard, remainingFor, computeBudgets,
    rollOffseasonEvents,
  };
})();
