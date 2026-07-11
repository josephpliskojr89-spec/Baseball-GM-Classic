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

    const own = p.teamId === userTeamId;
    const level = p.rosterStatus;
    if (own) {
      // Your own farm: your staff watches these games (5.7.2).
      if (level === 'AAA') return 'tight';
      if (level === 'AA') return ti >= 2 ? 'tight' : 'wide';
      return ti >= 2 ? 'wide' : (ti === 0 && level === 'Rookie' ? 'min' : 'wide');
    }
    // Another organization's farm.
    if (level === 'AAA') return ti >= 3 ? 'tight' : (ti >= 1 ? 'wide' : 'min');
    if (level === 'AA') return ti >= 2 ? 'wide' : 'min';
    return ti >= 3 ? 'wide' : 'min';
  }

  // Band for one rating value. Width and center-offset scale with mode;
  // the offset is the scout's stable error on this player.
  function bandFor(value, mode, h, salt) {
    if (mode === 'exact') return null;
    const width = mode === 'tight' ? 5 + (h >> (salt % 13)) % 2 : 10 + (h >> (salt % 11)) % 4;
    const offMag = mode === 'tight' ? 2 : 5;
    const sign = ((h >> (salt % 7)) & 1) ? 1 : -1;
    const center = value + sign * ((h >> (salt % 5)) % (offMag + 1));
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

  // Pool visibility (draft class / intl class): how deep the user's tier
  // sees, and how wide the displayed ceiling band is (5.7.2). `rank` is
  // the consensus board rank. Returns {visible, widen} — widen is added
  // to each side of the class's generated scout band (negative tightens).
  function poolView(state, rank, pool) {
    const team = state.league.teams.find((t) => t.id === state.meta.userTeamId);
    const ti = tierIdx(team);
    const topDepth = pool === 'intl'
      ? [10, 20, 30, 30][ti]
      : [10, 50, 300, 300][ti]; // draft: standard sees the full class thinly
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

  // AI draft discipline by tier (13.6): [board window, weight decay].
  function aiDraftDiscipline(team) {
    return [
      { window: 16, decay: 0.75 }, // bare — reaches happen
      { window: 12, decay: 0.60 },
      { window: 10, decay: 0.52 },
      { window: 8,  decay: 0.45 }, // elite — near-consensus
    ][tierIdx(team)];
  }

  return {
    TIERS, tierOf, tierIdx, tierDef, tierCost,
    defaultTierFor, ensureTiers,
    requestTier, runScoutingOffseason,
    modeFor, report, poolView, aiDraftDiscipline,
  };
})();
