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
    const topDepth = pool === 'intl'
      ? [10, 20, 30, 30][ti]
      : [10, 50, 350, 350][ti]; // draft: standard sees the full class thinly
    if (pool === 'intl' && rank > 30) {
      // Bottom 70: minimal info at every tier (6.7).
      return { visible: ti >= 3 && rank <= 45, widen: 6 };
    }
    if (rank > topDepth) return { visible: false, widen: 0 };
    const widenByTier = [8, 4, 0, -3];
    // Deep cuts stay fuzzier than the top of the board.
    const depthPenalty = rank > 15 ? 2 : 0;
    return { visible: true, widen: widenByTier[ti] + depthPenalty };
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

  // ---- Targeted looks (0.23.0 intl, 0.24.0 draft) ---------------------------
  // Tier coverage leaves part of every class as "??" names — most of the
  // intl pool at low tiers, everything past rank 10/50 in the draft for
  // bare-bones/standard departments. A targeted look sends a scout for a
  // closer read on ONE unscouted prospect: the department's budget caps
  // how many trips EACH class gets (draft and intl budgets are separate),
  // and the tier caps how good the resulting report is — a bare-bones
  // look brings back a rough number and no tool grades; an elite look is
  // nearly full coverage. Spent looks live on the class object
  // (state.draft.userLooks / state.intl.userLooks), so a fresh class
  // resets the budget each year.
  function targetedLooks(state, pool) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const cls = pool === 'draft' ? state.draft : state.intl;
    const used = (cls && cls.userLooks) ? cls.userLooks.length : 0;
    const budget = [2, 4, 6, 9][ti];
    return {
      budget,
      used,
      remaining: Math.max(0, budget - used),
      widen: [6, 3, 1, -2][ti], // band quality of a one-trip report
      tools: ti >= 1,           // bare bones brings a number, not a toolkit
    };
  }

  function hasTargetedLook(state, pool, prospectId) {
    const cls = pool === 'draft' ? state.draft : state.intl;
    return !!(cls && (cls.userLooks || []).includes(prospectId));
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

  return {
    TIERS, tierOf, tierIdx, tierDef, tierCost,
    defaultTierFor, ensureTiers,
    requestTier, runScoutingOffseason,
    modeFor, report, poolView, aiDraftDiscipline, potentialBand, prospectNotes,
    targetedLooks, hasTargetedLook, medicalRead,
    prospectRankings, pipelineRank,
  };
})();
