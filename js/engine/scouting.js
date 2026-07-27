// Scouting budget system (bible 6.9 / Phase 13) + rating fog (5.7).
//
// Every team runs a scouting department at one of four tiers. The tier
// gates how clearly that team sees prospect information: its own minors,
// other organizations' farm systems, the draft class, and the
// international pool. MLB players, free agents, and staff are always
// public (6.9.6) — scouting is about who will BECOME established.
//
// Fog is deterministic: a given (viewer team, player, tier) always
// produces the same band, so reports don't re-roll on every render. Bands
// are NOT centered on truth — the scout's read is offset by a stable
// per-player error that shrinks as the tier improves. That's the game:
// a bare-bones department isn't just vaguer, it's more often wrong.
//
// The engine's AI keeps using true ratings for its own decisions, with
// one exception wired through here: draft-day pick discipline scales
// with the AI team's tier (13.6 — weak scouting produces reaches).
window.BBGM_SCOUT = (function () {
  const TIERS = [
    { key: 'bare',     name: 'Bare Bones',    cost: 3 },
    { key: 'standard', name: 'Standard',      cost: 7 },
    { key: 'above',    name: 'Above Average', cost: 15 },
    { key: 'elite',    name: 'Elite',         cost: 25 },
  ];
  const TIER_INDEX = { bare: 0, standard: 1, above: 2, elite: 3 };

  function rand() { return Math.random(); }

  function tierOf(team) {
    return team && team.scoutingTier && TIER_INDEX[team.scoutingTier] != null
      ? team.scoutingTier : 'standard';
  }
  function tierIdx(team) { return TIER_INDEX[tierOf(team)]; }
  function tierDef(key) { return TIERS[TIER_INDEX[key] != null ? TIER_INDEX[key] : 1]; }
  function tierCost(team) { return tierDef(tierOf(team)).cost; }

  // Owner archetype default tiers (6.9.4) — league-start variation.
  function defaultTierFor(owner) {
    switch (owner) {
      case 'patient':
      case 'analytics': return rand() < 0.5 ? 'elite' : 'above';
      case 'aggressive': return 'above';
      case 'cheap': return rand() < 0.5 ? 'bare' : 'standard';
      case 'win_now':
      case 'old_school':
      default: return 'standard';
    }
  }

  // Idempotent: give every team a tier (new leagues and old saves alike).
  function ensureTiers(state) {
    for (const t of state.league.teams) {
      if (!t.scoutingTier || TIER_INDEX[t.scoutingTier] == null) {
        t.scoutingTier = defaultTierFor(t.owner);
      }
    }
    ensureOps(state);
  }

  // Operating budget (0.51.0): the money that pays scouting and staff,
  // SEPARATE from player payroll (which used to eat the scouting bill —
  // the audit trail behind 0.50.0's starved FA market). Sized by market
  // and ownership taste, floored so no club is born unable to fund the
  // department it already runs (+$9M of staff-and-headroom past the
  // current tier). Idempotent: stamps only teams without one.
  const OPS_MUL = {
    analytics: 1.25, patient: 1.05, win_now: 1.05,
    aggressive: 1.0, old_school: 0.95, cheap: 0.7,
  };
  function ensureOps(state) {
    const C = window.BBGM_CONSTANTS;
    let stamped = 0;
    for (const t of state.league.teams) {
      if (t.opsBase != null) continue;
      const market = C.MARKET_SIZES.find((m) => m.key === t.market);
      const mul = OPS_MUL[t.owner] != null ? OPS_MUL[t.owner] : 1;
      const base = (market ? market.base : 140) * 0.16 * mul * (0.95 + rand() * 0.10);
      t.opsBase = Math.round(Math.max(base, tierCost(t) + 9));
      stamped++;
    }
    return stamped;
  }

  // ---- Offseason tier requests (6.9.3) ------------------------------------

  // Owner approval odds for a one-step upgrade, by archetype.
  const UPGRADE_APPROVAL = {
    patient: 0.95, analytics: 0.95, aggressive: 0.85,
    win_now: 0.7, old_school: 0.6, cheap: 0.3,
  };

  // User asks ownership for a tier change during the offseason. Returns
  // {ok, granted, message}. Multi-step jumps are partially approved at
  // most one step per winter (6.9.3); downgrades are always approved
  // (owners never mind saving money).
  function requestTier(state, team, wantKey) {
    if (state.meta.offseasonPhase !== 'freeAgency') {
      return { ok: false, message: 'Budget review happens in the offseason.' };
    }
    const cur = tierIdx(team);
    const want = TIER_INDEX[wantKey];
    if (want == null || want === cur) return { ok: false, message: 'Already at that tier.' };
    if (want < cur) {
      team.scoutingTier = wantKey;
      return { ok: true, granted: wantKey, message: `Ownership approves the cut to ${tierDef(wantKey).name}.` };
    }
    // Upgrade: one step at a time; old-school owners flatly resist elite.
    const step = TIERS[cur + 1].key;
    // Operating-budget gate (0.51.0): the step has to fit under opsBase
    // next to the staff bill — checked BEFORE the approval dice so the
    // decline reason is honest money, not owner mood.
    if (team.opsBase != null) {
      const STAFF = window.BBGM_STAFF;
      const bill = tierDef(step).cost + (STAFF && STAFF.staffCost ? STAFF.staffCost(state, team) : 0);
      if (bill > team.opsBase) {
        return {
          ok: false,
          message: `The operating budget can't carry it — ${tierDef(step).name} plus the staff bill runs $${bill.toFixed(1)}M against $${team.opsBase}M.`,
        };
      }
    }
    // One pitch per winter (0.78.1, user report: the approval dice could
    // be re-rolled until they landed). The latch sets the moment
    // ownership actually HEARS the ask — approve or decline — and
    // clears at the next rollover. The budget decline above is
    // deterministic bookkeeping, not an audience: fix the books and
    // come back. Cuts never need a hearing.
    if (team.tierAskDone) {
      return { ok: false, message: 'You made your pitch this winter — ownership\'s answer stands until next offseason.' };
    }
    team.tierAskDone = true;
    let odds = UPGRADE_APPROVAL[team.owner] != null ? UPGRADE_APPROVAL[team.owner] : 0.7;
    if (step === 'elite' && team.owner === 'old_school') odds *= 0.4;
    if (step === 'elite' && team.owner === 'cheap') odds *= 0.5;
    if (rand() < odds) {
      team.scoutingTier = step;
      const partial = want > cur + 1;
      return {
        ok: true, granted: step,
        message: partial
          ? `Ownership funds one step — ${tierDef(step).name} this year. Ask again next winter.`
          : `Ownership approves ${tierDef(step).name} scouting.`,
      };
    }
    return { ok: false, message: 'Ownership declines the scouting increase this year.' };
  }

  // Rollover hook: cheap owners cut scouting after losing seasons (6.9.3);
  // AI owners drift back toward their archetype default. Returns events.
  function runScoutingOffseason(state, records) {
    const events = [];
    for (const t of state.league.teams) {
      delete t.tierAskDone; // a new winter, a new audience (0.78.1)
      const rec = records[t.id] || { w: 81, l: 81 };
      if (t.owner === 'cheap' && rec.w < 78 && tierIdx(t) > 0 && rand() < 0.25) {
        const to = TIERS[tierIdx(t) - 1].key;
        t.scoutingTier = to;
        events.push({ kind: 'scout-cut', teamId: t.id, to });
      }
    }
    return events;
  }

  // ---- Fog (5.7) -----------------------------------------------------------

  // Stable per-(viewer, player) hash for deterministic bands.
  function hashOf(viewerTeamId, playerId) {
    const s = `${viewerTeamId}|${playerId}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  // Visibility mode for a player from the user's chair (5.7.2):
  //   'exact'  — true ratings, nearest grade
  //   'tight'  — ±4-6 band
  //   'wide'   — ±9-13 band
  //   'min'    — hidden ("no book on him")
  function modeFor(state, p) {
    const userTeamId = state.meta.userTeamId;
    const team = state.league.teams.find((t) => t.id === userTeamId);
    const ti = tierIdx(team);

    // Public information (6.9.6): anyone at the MLB level, free agents,
    // retired players, draft-day-event vets.
    if (p.retired || p.status === 'active' || p.status === 'FA' || p.rosterStatus === 'IL') return 'exact';
    if (p.status !== 'minors') return 'exact'; // safety: unknown states stay readable

    // Your own organization is never fogged (0.16.3): these are your
    // players, your coaches, your instructional staff — the GM knows his
    // own farm. Scouting tiers gate the OUTSIDE world: the draft and
    // intl pools (poolView) and rival farms below.
    if (p.teamId === userTeamId) return 'exact';

    // Another organization's farm.
    const level = p.rosterStatus;
    if (level === 'AAA') return ti >= 3 ? 'tight' : (ti >= 1 ? 'wide' : 'min');
    if (level === 'AA') return ti >= 2 ? 'wide' : 'min';
    return ti >= 3 ? 'wide' : 'min';
  }

  // Band for one rating value. Width and center-offset scale with mode;
  // the offset is the scout's stable error on this player.
  function bandFor(value, mode, h, salt) {
    if (mode === 'exact') return null;
    // Unsigned shifts: h can exceed 2^31, and a signed shift flips the
    // modulo negative (narrower-than-spec bands; same bug family as the
    // birthdate hash).
    const width = mode === 'tight' ? 5 + (h >>> (salt % 13)) % 2 : 10 + (h >>> (salt % 11)) % 4;
    const offMag = mode === 'tight' ? 2 : 5;
    const sign = ((h >>> (salt % 7)) & 1) ? 1 : -1;
    const center = value + sign * ((h >>> (salt % 5)) % (offMag + 1));
    const lo = Math.max(20, Math.round(center - width));
    const hi = Math.min(80, Math.round(center + width));
    return [lo, hi];
  }

  // The user's scouting report on a player. UI surfaces render from this,
  // never from true ratings, for anyone who isn't public knowledge.
  //   { mode, band(key) -> [lo,hi]|null, ovrBand -> [lo,hi]|null }
  function report(state, p) {
    const mode = modeFor(state, p);
    const h = hashOf(state.meta.userTeamId, p.id);
    return {
      mode,
      band(key) {
        if (mode === 'exact') return null;
        if (mode === 'min') return null;
        let salt = 0;
        for (let i = 0; i < key.length; i++) salt += key.charCodeAt(i);
        return bandFor(p.ratings[key] != null ? p.ratings[key] : 50, mode, h, salt + 3);
      },
      ovrBand() {
        if (mode === 'exact' || mode === 'min') return null;
        const ovr = window.BBGM_ROSTER.overall(p);
        return bandFor(ovr, mode, h, 17);
      },
    };
  }

  // Potential as the user's scouts project it: a band on the 20-80 scale,
  // NEVER exact — even your own development staff is projecting. Width
  // tightens with the scouting tier (and widens again on players you can
  // barely see); the center is deterministically offset per (team,
  // player) like every other band, so the projection is stable and not
  // centered on truth. Remaining upside fades with age — by 28 the
  // projection has converged on what the player already is — and for a
  // player whose current ability is public, the floor never reads below
  // what he's already shown.
  function potentialBand(state, p) {
    const mode = modeFor(state, p);
    if (mode === 'min') return null; // no book on him at all
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const ovr = window.BBGM_ROSTER.overall(p);

    // True remaining-upside estimate: ceiling overall, faded by age.
    let ceilOvr = ovr;
    if (p.hidden && p.hidden.ceiling) {
      ceilOvr = window.BBGM_ROSTER.overall({
        isPitcher: p.isPitcher,
        ratings: { ...p.ratings, ...p.hidden.ceiling },
      });
    }
    const ageFade = Math.max(0, Math.min(1, (28 - p.age) / 6)); // 1 at ≤22 → 0 at 28+
    const truePot = Math.max(ovr, ovr + (ceilOvr - ovr) * ageFade);

    const h = hashOf(state.meta.userTeamId, p.id);
    const widths = [8, 6, 4, 3]; // bare bones → elite
    let width = widths[ti] != null ? widths[ti] : 6;
    if (mode === 'wide') width += 3;
    else if (mode === 'tight') width += 1;
    const sign = ((h >>> 3) & 1) ? 1 : -1;
    const center = truePot + sign * ((h >>> 6) % (mode === 'exact' ? 3 : 5));
    let lo = Math.max(20, Math.round(center - width));
    let hi = Math.min(80, Math.round(center + width));
    if (mode === 'exact') lo = Math.max(lo, Math.min(78, Math.round(ovr)));
    if (hi <= lo) hi = Math.min(80, lo + 2);
    return [lo, hi];
  }

  // Pool visibility (draft class / intl class): how deep the user's tier
  // sees, and how wide the displayed ceiling band is (5.7.2). `rank` is
  // the consensus board rank. Returns {visible, widen} — widen is added
  // to each side of the class's generated scout band (negative tightens).
  function poolView(state, rank, pool) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    // Draft: EVERY tier sees the whole class (0.77.1, user catch — a
    // pre-0.65.0 depth gate [10,50,350,350] survived the big-board
    // redesign and contradicted it: you can't board a kid whose row
    // never renders, and boarding is the whole mechanic). The tier
    // difference lives in the coverage widen below and in board
    // speed/floor — never in who exists. Intl keeps its depth gate:
    // the top-30 structure is that market's own design (6.7).
    const topDepth = pool === 'intl' ? [10, 20, 30, 30][ti] : 350;
    if (pool === 'intl' && rank > 30) {
      // Bottom 70: minimal info at every tier (6.7).
      return { visible: ti >= 3 && rank <= 45, widen: 6 };
    }
    if (rank > topDepth) return { visible: false, widen: 0 };
    // Draft baseline honester at every tier (0.65.0, approved): no
    // department deeply knows 350 amateurs — coverage reads got wider
    // (elite −3 → +1) and the DEEP read moved to the 30-man big board,
    // where weeks of committed attention buy what money alone used to.
    const widenByTier = pool === 'draft' ? [9, 6, 3, 1] : [8, 4, 0, -3];
    // Deep cuts stay fuzzier than the top of the board.
    const depthPenalty = rank > 15 ? 2 : 0;
    return { visible: true, widen: widenByTier[ti] + depthPenalty };
  }

  // ---- The draft big board (0.65.0) ----------------------------------------
  // Thirty targets, flat for every club — the real-world number. Being
  // on the board is what buys the DEEP read: a boarded kid's band
  // sharpens every week your scouts follow him, converging toward a
  // tier floor tighter than any coverage read. The tier buys SPEED and
  // the floor, never the cap: a bare-bones department that commits in
  // week one still out-scouts an elite one that never pointed anywhere.
  // Scouting trips (targetedLooks) are international-only from 0.65.0.
  const DRAFT_BOARD_CAP = 30;
  const BOARD_START = [7, 5, 3, 2];    // widen the day he's added
  const BOARD_SPEED = [0.7, 0.9, 1.3, 1.8]; // widen shed per week followed
  const BOARD_FLOOR = [1, 0, -2, -4];  // the best read each tier can build

  function draftBoardInfo(state) {
    const used = (state.draft && state.draft.userBoard ? state.draft.userBoard.length : 0);
    return { cap: DRAFT_BOARD_CAP, used, remaining: Math.max(0, DRAFT_BOARD_CAP - used) };
  }

  function draftBoardAdd(state, prospectId) {
    const d = state.draft;
    if (!d) return { ok: false, reason: 'No draft class open.' };
    if (!d.userBoard) d.userBoard = [];
    if (!d.boardAdded) d.boardAdded = {};
    if (d.userBoard.includes(prospectId)) return { ok: true };
    if (d.userBoard.length >= DRAFT_BOARD_CAP) {
      return { ok: false, reason: `The board is full — thirty names is the book. Drop someone first.` };
    }
    d.userBoard.push(prospectId);
    d.boardAdded[prospectId] = { ...state.meta.currentDate };
    return { ok: true };
  }

  function draftBoardRemove(state, prospectId) {
    const d = state.draft;
    if (!d || !d.userBoard) return;
    const i = d.userBoard.indexOf(prospectId);
    if (i >= 0) d.userBoard.splice(i, 1);
    if (d.boardAdded) delete d.boardAdded[prospectId];
    // The accumulated read is GONE — re-adding starts the clock over.
    // Commitment is the mechanic; churn punishes itself.
  }

  // Widen for a boarded kid, or null if he isn't on the board. Weeks
  // are counted from the add date, so early conviction is the edge.
  function draftBoardWiden(state, p) {
    const d = state.draft;
    if (!d || !d.userBoard || !d.userBoard.includes(p.id)) return null;
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const added = d.boardAdded && d.boardAdded[p.id];
    const D = window.BBGM_DATES;
    const weeks = added ? Math.max(0, D.diffDays(added, state.meta.currentDate)) / 7 : 0;
    return Math.max(BOARD_FLOOR[ti], BOARD_START[ti] - weeks * BOARD_SPEED[ti]);
  }

  // The read RE-CENTERS as it sharpens (0.78.0, user report: boarding a
  // kid moved his band the same way every time — a symmetric shrink
  // around the public center, discovery-free). Weeks of committed
  // attention pull the band's CENTER from the consensus toward the
  // kid's true best-tool ceiling, so boarding somebody can slide his
  // band up or down while it tightens — the movement IS the report.
  // Deterministic per (club, kid): an early hash-seeded wobble (±3)
  // fades as the book thickens, progress runs at tier speed and caps
  // at 85% — nobody's book is gospel.
  const BOARD_CONVERGE = [0.05, 0.07, 0.10, 0.14]; // truth-share per week
  function draftBoardShift(state, p) {
    const d = state.draft;
    if (!d || !d.userBoard || !d.userBoard.includes(p.id)) return 0;
    if (!p.hidden || !p.hidden.ceiling || !p.scout) return 0;
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const added = d.boardAdded && d.boardAdded[p.id];
    const D = window.BBGM_DATES;
    const weeks = added ? Math.max(0, D.diffDays(added, state.meta.currentDate)) / 7 : 0;
    const prog = Math.min(0.85, weeks * BOARD_CONVERGE[ti]);
    let best = -Infinity;
    for (const k in p.hidden.ceiling) {
      if (k === 'bunting') continue;
      const v = p.hidden.ceiling[k];
      if (typeof v === 'number' && v > best) best = v;
    }
    if (!isFinite(best)) return 0;
    const publicMid = (p.scout.ceilLo + p.scout.ceilHi) / 2;
    const h = hashOf(team.id, p.id);
    const wobble = (((h >>> 4) % 7) - 3) * (1 - prog);
    return Math.round(((best - publicMid) * prog + wobble) * 10) / 10;
  }

  // 0.65.0 migration helper (called from main.js): seed the board from
  // whatever the save already invested in — trip'd kids first, then
  // flagged targets, capped at 30, all stamped as boarded today. The
  // clock on their reads starts now; nobody loses a report they'd
  // earned. Returns how many names were seeded.
  function draftBoardSeed(state) {
    const d = state.draft;
    if (!d) return 0;
    if (!d.boardAdded) d.boardAdded = {};
    const invested = [...(d.userLooks || []), ...(d.userBoard || [])];
    d.userBoard = [];
    for (const id of invested) {
      if (d.userBoard.length >= DRAFT_BOARD_CAP) break;
      if (!d.userBoard.includes(id) && d.prospects && d.prospects[id]) {
        d.userBoard.push(id);
        d.boardAdded[id] = { ...state.meta.currentDate };
      }
    }
    delete d.userLooks;
    return d.userBoard.length;
  }

  // The scout's conviction letter (0.65.0): by June the department has
  // lived with the board for weeks — the head scout writes about the
  // one or two boarded kids he believes in most. His belief is the
  // SCOUTED band midpoint (what the user already sees), so the letter
  // pounds the table without ever leaking a true number. Divergence
  // from the consensus rank is the story: conviction is only
  // interesting where the industry disagrees.
  function draftConvictions(state) {
    const d = state.draft;
    if (!d || !d.userBoard || !d.userBoard.length || !d.prospects) return [];
    const entries = [];
    for (const id of d.userBoard) {
      const p = d.prospects[id];
      if (!p || !p.scout) continue;
      const rank = d.board.indexOf(id) + 1;
      entries.push({ p, rank, mid: (p.scout.ceilLo + p.scout.ceilHi) / 2 });
    }
    entries.sort((a, b) => b.mid - a.mid);
    return entries.slice(0, 2);
  }

  // ---- Scout notes (0.19.2) -------------------------------------------------
  // A short strengths/weaknesses read on a pool prospect, written by the
  // USER's scouting department — the draft-guide blurb. Deterministic per
  // (team, player), so the report never re-rolls between opens. The scouts
  // judge each tool's CEILING through tier-scaled noise: a bare-bones
  // department regularly falls in love with the wrong tool; an elite one
  // rarely does. Nothing here leaks true numbers — only which tools the
  // scouts believe in, in scout-speak.
  //   opts: { pool: 'draft' | 'intl' }
  // Returns an array of note strings (empty when there's no read at all).
  function prospectNotes(state, p, opts = {}) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const h = hashOf(state.meta.userTeamId, p.id);
    const ceil = (p.hidden && p.hidden.ceiling) || {};
    const rawKeys = p.isPitcher
      ? ['velocity', 'stuff', 'movement', 'control']
      : ['contactVsR', 'contactVsL', 'powerVsR', 'powerVsL', 'discipline', 'speed', 'defense', 'arm'];

    // Tier-scaled read error per tool; teenage intl reads are the noisiest,
    // HS reads next. This is where a weak department praises the wrong tool.
    const amp = [9, 6, 4, 2][ti] + (opts.pool === 'intl' ? 3 : 0) +
      (p.background === 'HS' ? 2 : 0);
    const readOf = (k, v) => {
      let salt = 0;
      for (let i = 0; i < k.length; i++) salt += k.charCodeAt(i);
      const off = ((h >>> (salt % 16)) % (2 * amp + 1)) - amp;
      return (v != null ? v : 45) + off;
    };
    const reads = {};
    for (const k of rawKeys) reads[k] = readOf(k, ceil[k]);

    // Collapse to the tools a draft guide talks about.
    const tools = p.isPitcher
      ? [
          ['the velocity', reads.velocity],
          ['the swing-and-miss stuff', reads.stuff],
          ['the life on his pitches', reads.movement],
          ['the command', reads.control],
        ]
      : [
          ['the hit tool', (reads.contactVsR + reads.contactVsL) / 2],
          ['the raw power', (reads.powerVsR + reads.powerVsL) / 2],
          ['the plate approach', reads.discipline],
          ['the run tool', reads.speed],
          ['the glove', reads.defense],
          ['the arm', reads.arm],
        ];
    tools.sort((a, b) => b[1] - a[1]);
    const best = tools[0];
    const worst = tools[tools.length - 1];

    const adj = (v) => v >= 74 ? 'a potential 80-grade weapon'
      : v >= 68 ? 'plus-plus projection'
      : v >= 62 ? 'plus projection'
      : v >= 56 ? 'above-average projection'
      : v >= 50 ? 'average projection'
      : 'fringy projection';

    const notes = [];
    const strengthT = [
      (t, a) => `Scouts love ${t} — ${a}.`,
      (t, a) => `The carrying tool is ${t}: ${a}.`,
      (t, a) => `${t.charAt(0).toUpperCase() + t.slice(1)} jumps off the card — ${a}.`,
    ];
    notes.push(strengthT[(h >>> 5) % strengthT.length](best[0], adj(best[1])));

    if (worst[1] >= 58) {
      notes.push('No glaring hole in the profile — the rare all-around prospect.');
    } else {
      const concernT = [
        (t) => `The concern is ${t} — it lags well behind.`,
        (t) => `Real questions about ${t}.`,
        (t) => `${t.charAt(0).toUpperCase() + t.slice(1)} needs a pro program to get there.`,
      ];
      notes.push(concernT[(h >>> 9) % concernT.length](worst[0]));
    }

    // Role risk for starters whose frame may not hold the workload —
    // stamina is the one read scouts get mostly right in person.
    if (ti >= 1 && p.primaryPosition === 'SP' && ceil.stamina != null && ceil.stamina <= 44) {
      notes.push('Bullpen risk — the frame may not carry a starter\'s workload.');
    }

    // Makeup only surfaces with a real department (above-average+), and
    // it's accurate — background work is interviews, not projection.
    if (ti >= 2 && p.hidden) {
      if ((p.hidden.makeupGrade || 5) >= 8) notes.push('Plus makeup — coaches rave about the work habits.');
      else if ((p.hidden.makeupGrade || 5) <= 2) notes.push('The background checks raise makeup questions.');
      else if ((p.hidden.workEthic || 5) >= 9) notes.push('Relentless worker — the development staff\'s dream.');
    }

    return notes;
  }

  // ---- Public medical file (0.24.1) -----------------------------------------
  // Amateur medical histories are disclosed to every club — no scouting
  // tier required, unlike everything else in this module. But the file is
  // a HISTORY, not a diagnosis: the read is the hidden injuryProneness
  // seen through deterministic noise, and roughly one file in six flat-out
  // lies — the kid who broke a wrist at fifteen and never got hurt again,
  // or the clean-file glass man. Public data is keyed on the player alone
  // (no viewer team), so every club reads the same file, and it never
  // re-rolls. Returns {grade, label, flagged} or null for the unremarkable
  // middle (most files say nothing worth printing).
  function medicalRead(p) {
    const s = `med|${p.id}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const prone = (p.hidden && p.hidden.injuryProneness) || 5;
    const flipped = (h % 100) < 17; // the bait-and-switch files
    const noise = ((h >>> 8) % 5) - 2; // -2..+2
    const read = Math.max(1, Math.min(10, (flipped ? 11 - prone : prone) + noise));
    if (read <= 3) {
      return { grade: read, flagged: false, label: 'Clean medical file — no amateur red flags.' };
    }
    if (read >= 9) {
      return { grade: read, flagged: true, label: 'Serious medical red flags — multiple amateur injuries in the file.' };
    }
    if (read >= 7) {
      return { grade: read, flagged: true, label: 'Medical flags — an amateur injury history worth a closer physical.' };
    }
    return null;
  }

  // ---- Head-scout lens (0.47.0) ---------------------------------------------
  // Every international read the user sees is filtered through ONE person:
  // the head scout. His reputation sets how TIGHT the bands are; his bias
  // sets which DIRECTION they miss — a systematic, learnable error keyed to
  // the prospect's true profile, never displayed anywhere. A region focus
  // (chosen from his season letter) tightens his reads inside that region.
  // The rank-based noise floor is the design's bedrock: past the top 30,
  // no scout, tier, focus, or trip budget produces a confident read — the
  // deep pool stays a crapshoot at any spend.
  function intlScoutMods(state, p, rank) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const sc = window.BBGM_STAFF && window.BBGM_STAFF.scoutFor
      ? window.BBGM_STAFF.scoutFor(state, team) : null;
    let widenDelta = 0;
    let shift = 0;
    if (sc) {
      // Rep 8 scout ≈ 2 grades tighter than a rep 3 journeyman.
      widenDelta += (5 - (sc.reputation || 5)) * 0.6;
      const ceil = (p.hidden && p.hidden.ceiling) || {};
      const avg = (keys) => {
        let s = 0, n = 0;
        for (const k of keys) { if (ceil[k] != null) { s += ceil[k]; n++; } }
        return n ? s / n : 50;
      };
      // "Toolsiness": loud raw gifts vs feel-and-polish, off TRUE ceilings
      // — the miss correlates with what kind of player the kid really is.
      const tools = p.isPitcher
        ? avg(['velocity', 'stuff']) - avg(['control', 'movement'])
        : avg(['powerVsR', 'powerVsL', 'speed', 'arm']) - avg(['contactVsR', 'contactVsL', 'discipline']);
      if (sc.bias === 'tools') shift = Math.max(-4, Math.min(4, tools * 0.35));
      else if (sc.bias === 'polish') shift = Math.max(-4, Math.min(4, -tools * 0.35));
      else if (sc.bias === 'projection') shift = p.age === 16 ? 3 : p.age >= 18 ? -2 : 0;
      else if (sc.bias === 'skeptic') shift = -2.5;
    }
    // Region focus: the winter he spent where you sent him.
    const INTL = window.BBGM_INTL;
    if (state.intl && state.intl.userFocus && INTL && INTL.regionOf &&
        INTL.regionOf(p.origin) === state.intl.userFocus) {
      widenDelta -= 3;
    }
    // Noise floor by class rank (0.47.0 invariant).
    const floor = rank <= 10 ? -3 : rank <= 30 ? 0 : 4;
    return { widenDelta, shift, floor };
  }

  // ---- Targeted looks (0.23.0, intl-only since 0.65.0) ----------------------
  // Tier coverage leaves most of the intl pool as "??" names at low
  // tiers. A targeted look sends a scout for a closer read on ONE
  // unscouted prospect: the department's budget caps how many trips the
  // class gets, and the tier caps how good the resulting report is — a
  // bare-bones look brings back a rough number and no tool grades; an
  // elite look is nearly full coverage. Spent looks live on the class
  // object (state.intl.userLooks), so a fresh class resets the budget
  // each year. The DOMESTIC class runs on the big board instead — the
  // draft branch below answers in board terms for API compatibility.
  function targetedLooks(state, pool) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    // Draft (0.65.0): trips are intl-only; the board is the draft's
    // mechanism. Kept API-compatible for stray callers: budget is the
    // board cap and tools are always in a board report.
    if (pool === 'draft') {
      const bi = draftBoardInfo(state);
      return { budget: bi.cap, used: bi.used, remaining: bi.remaining,
        widen: 1, tools: true, extraUsed: 0, extraRemaining: 0, nextExtraCost: null };
    }
    const cls = state.intl;
    // Second looks (1.1.0) draw from the SAME trip ledger — a return
    // visit to a covered kid costs what a first visit to a ?? name does.
    const used = ((cls && cls.userLooks) ? cls.userLooks.length : 0) +
      ((cls && cls.userSecondLooks) ? cls.userSecondLooks.length : 0);
    const budget = [2, 4, 6, 9][ti];
    // Paid extras (0.47.0, intl only): past the free allowance, each trip
    // is bought with SIGNING POOL money at an escalating price — every
    // dollar spent learning about the class is a dollar you can't spend
    // signing it.
    const extraUsed = Math.max(0, used - budget);
    const EXTRA_MAX = 6;
    return {
      budget,
      used,
      remaining: Math.max(0, budget - used),
      widen: [6, 3, 1, -2][ti], // band quality of a one-trip report
      tools: ti >= 1,           // bare bones brings a number, not a toolkit
      extraUsed,
      extraRemaining: pool === 'intl' ? Math.max(0, EXTRA_MAX - extraUsed) : 0,
      nextExtraCost: pool === 'intl' ? Math.round((0.2 + extraUsed * 0.15) * 100) / 100 : null,
    };
  }

  function hasTargetedLook(state, pool, prospectId) {
    // Draft (0.65.0): the big board replaced trips — membership IS the
    // look. Intl keeps the trip ledger.
    if (pool === 'draft') {
      return !!(state.draft && (state.draft.userBoard || []).includes(prospectId));
    }
    const cls = state.intl;
    return !!(cls && (cls.userLooks || []).includes(prospectId));
  }

  // ---- The second look (1.1.0) ---------------------------------------------
  // A return trip on a kid the department already covers: tightening a
  // real read before a big July 2 bid instead of buying a new one. The
  // band narrows AND re-centers halfway toward the truth of his best
  // tool — the same discovery physics as the draft board (0.78.0), paid
  // for in one trip instead of weeks of attention. Once per kid per
  // window; the deep-pool rank floor still holds (a second viewing of a
  // #28 lottery ticket is a better guess, never a promise).
  function hasSecondLook(state, prospectId) {
    const cls = state.intl;
    return !!(cls && (cls.userSecondLooks || []).includes(prospectId));
  }

  function secondLookShift(state, p) {
    if (!p.hidden || !p.hidden.ceiling || !p.scout) return 0;
    const keys = Object.keys(p.hidden.ceiling).filter((k) => k !== 'stamina' && k !== 'bunting');
    if (!keys.length) return 0;
    const best = Math.max(...keys.map((k) => p.hidden.ceiling[k]));
    const mid = (p.scout.ceilLo + p.scout.ceilHi) / 2;
    return (best - mid) * 0.5;
  }

  // AI draft discipline by tier (13.6): [board window, weight decay].
  function aiDraftDiscipline(team) {
    return [
      { window: 16, decay: 0.75 }, // bare — reaches happen
      { window: 12, decay: 0.60 },
      { window: 10, decay: 0.52 },
      { window: 8,  decay: 0.45 }, // elite — near-consensus
    ][tierIdx(team)];
  }

  // ---- NABL Pipeline: league-wide Top 100 prospect rankings (0.29.0) ----
  // The industry consensus list, not the user's scouts — computed from
  // true values with small deterministic media noise so it neither leaks
  // exact hidden ratings nor reshuffles between renders. Score is a
  // current/ceiling blend with a slight thumb on the scale for current
  // ability (55/45 by design): a polished near-MLB bat outranks a raw
  // lottery ticket with the same ceiling. Recomputed live, so call-ups
  // graduate off the list automatically and development moves players
  // during the season.
  function prospectRankings(state) {
    const R = window.BBGM_ROSTER;
    const year = state.meta.currentDate.year;
    const out = [];
    for (const t of state.league.teams) {
      for (const id of (t.minors || [])) {
        const p = state.players[id];
        if (!p || p.retired || p.status !== 'minors') continue;
        if (p.age > 25) continue; // aged off prospect lists
        const cur = R.overall(p);
        let ceil = cur;
        if (p.hidden && p.hidden.ceiling) {
          ceil = R.overall({ isPitcher: p.isPitcher, ratings: { ...p.ratings, ...p.hidden.ceiling } });
        }
        ceil = Math.max(ceil, cur);
        // ±2.5 media noise, stable per player per season (unsigned
        // shifts — same hash family as bandFor).
        const h = hashOf(year, p.id);
        const noise = (((h >>> 4) % 51) - 25) * 0.1;
        out.push({ id, teamId: t.id, score: cur * 0.55 + ceil * 0.45 + noise });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 100);
  }

  // Rank of one player on the current Top 100, or null. Cheap enough to
  // compute on demand for a profile view.
  function pipelineRank(state, playerId) {
    const list = prospectRankings(state);
    const i = list.findIndex((e) => e.id === playerId);
    return i >= 0 ? i + 1 : null;
  }

  // ---- Scout re-grades (0.60.0) --------------------------------------------
  // Each winter the head scout re-reads the org's young players and
  // writes when a projection has genuinely MOVED since his last stamped
  // look — the overachiever's climbing card, the bust's dying dream, a
  // breakout's new lid. Direction only; the numbers stay in the fog.
  // First sight stamps silently (no new-save inbox flood); small moves
  // accumulate against the stamp until they cross the threshold. A
  // fresh generational leap is re-stamped silently — that story already
  // arrives with its own letter and league-wide news. Max 2 letters a
  // winter, biggest movements first. Called at rollover, AFTER
  // progression, from the winter development news block.
  const REGRADE_THRESHOLD = 4;
  function pickRegrades(state) {
    const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!ut || !state.players) return [];
    const R = window.BBGM_ROSTER;
    const freshLeapYear = state.meta.currentDate.year + 1;
    const movers = [];
    for (const id of [...(ut.roster || []), ...(ut.minors || [])]) {
      const p = state.players[id];
      if (!p || p.retired || p.age > 26 || !p.hidden || !p.hidden.ceiling) continue;
      const ceilOvr = Math.round(R.overall({ ...p, ratings: { ...p.ratings, ...p.hidden.ceiling } }) * 10) / 10;
      const g = p.hidden.scoutGrade;
      if (!g || (p.hidden.leap && p.hidden.leap.year === freshLeapYear)) {
        p.hidden.scoutGrade = { ovr: ceilOvr };
        continue;
      }
      const delta = ceilOvr - g.ovr;
      if (Math.abs(delta) < REGRADE_THRESHOLD) continue;
      movers.push({ playerId: p.id, name: p.name, pos: p.primaryPosition,
        age: p.age, up: delta > 0, mag: Math.abs(Math.round(delta)), newOvr: ceilOvr });
    }
    movers.sort((a, b) => b.mag - a.mag);
    const picked = movers.slice(0, 2);
    for (const r of picked) {
      state.players[r.playerId].hidden.scoutGrade = { ovr: r.newOvr };
      delete r.newOvr; // internal bookkeeping — not for the letter
    }
    return picked;
  }

  // ---- The Scout's Book (0.69.0) -------------------------------------------
  // A per-player, VISIBLE history of the department's potential reads.
  // Each entry records the band exactly as the fog showed it that year
  // (so entries from bare-bones-scouting years are honestly wider) plus
  // the overall the player carried at the stamp. The archetype game is a
  // time-series game — a bust reveals himself by sinking, an overachiever
  // by outplaying his card — and until now the band re-rendered live and
  // destroyed the trajectory. The book never names an archetype; it just
  // stops destroying the evidence.
  const BOOK_MAX_AGE = 27; // potentialBand converges on OVR by 28 — nothing left to track
  function bookStamp(state, p, year, first) {
    const band = potentialBand(state, p);
    if (!band) return false;
    if (!p.scoutBook) p.scoutBook = [];
    // One OFFICIAL winter read per year — but a mid-season first look is
    // its own point on the trajectory and is never overwritten (0.73.2:
    // the old supersede DESTROYED the first look when the winter read
    // landed in the same calendar year, leaving every book one entry
    // deep — history is the whole product).
    if (!first && p.scoutBook.some((e) => e.year === year && !e.first)) return false;
    if (first && p.scoutBook.some((e) => e.year === year)) return false;
    const entry = { year, lo: band[0], hi: band[1],
      ovr: Math.round(window.BBGM_ROSTER.overall(p)) };
    if (first) entry.first = true;
    p.scoutBook.push(entry);
    while (p.scoutBook.length > 14) p.scoutBook.shift();
    return true;
  }

  // Winter pass: one stamped read per young org player, called from the
  // rollover news block BEFORE pickRegrades (letters may cite the book).
  function stampScoutBook(state) {
    const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!ut || !state.players) return 0;
    const year = state.meta.currentDate.year;
    let stamped = 0;
    for (const id of [...(ut.roster || []), ...(ut.minors || []), ...(ut.il || [])]) {
      const p = state.players[id];
      if (!p || p.retired || p.age > BOOK_MAX_AGE) continue;
      if (bookStamp(state, p, year, false)) stamped++;
    }
    return stamped;
  }

  // First-look sweep: any young org player with no book at all gets his
  // opening page (drafted, traded for, signed mid-year). Idempotent and
  // cheap — safe to run daily; also serves as the 0.69.0 migration.
  function scoutBookFirstLooks(state) {
    const ut = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    if (!ut || !state.players) return 0;
    const year = state.meta.currentDate.year;
    let stamped = 0;
    for (const id of [...(ut.roster || []), ...(ut.minors || []), ...(ut.il || [])]) {
      const p = state.players[id];
      if (!p || p.retired || p.age > BOOK_MAX_AGE) continue;
      if (p.scoutBook && p.scoutBook.length) continue;
      if (bookStamp(state, p, year, true)) stamped++;
    }
    return stamped;
  }

  return {
    TIERS, tierOf, tierIdx, tierDef, tierCost,
    defaultTierFor, ensureTiers, ensureOps,
    requestTier, runScoutingOffseason,
    modeFor, report, poolView, aiDraftDiscipline, potentialBand, prospectNotes,
    targetedLooks, hasTargetedLook, hasSecondLook, secondLookShift, medicalRead,
    draftBoardInfo, draftBoardAdd, draftBoardRemove, draftBoardWiden, draftBoardShift, draftConvictions, draftBoardSeed,
    prospectRankings, pipelineRank, intlScoutMods, pickRegrades,
    stampScoutBook, scoutBookFirstLooks,
  };
})();
