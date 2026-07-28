// Amateur draft (bible 13 / Phase 11).
//
// Timeline (13.1/13.3): the draft class is generated on May 1 of each
// season (350 prospects, 10 rounds x 30 picks) so the user has May and
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
  // 0.41.0: the class outnumbers the 300 picks, so the last rounds carry
  // real choice and ~50 names go undrafted every June (college kids hit
  // the open market; high schoolers head to campus).
  const CLASS_SIZE = 350;
  const UNDRAFTED_FA_MAX = 50;

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

  // Player backgrounds (6.5 age distribution). youngShare is the odds of
  // the bucket's YOUNGER age (v2.10.1, owner: "a few too many 22 and 23
  // year old draft prospects") — the old 50/50 coin made 22 the modal
  // age of the whole class. Real boards twin-peak at 18 (preps, mostly
  // seniors by June) and 21 (college juniors); true 23-year-olds are a
  // trace of redshirts. Seniors also thin slightly toward juniors —
  // cone-dead 22-23s were crowding out the volatility the cone buys.
  const BACKGROUNDS = [
    { key: 'HS', label: 'High School', weight: 0.30, ages: [17, 18], youngShare: 0.30 },
    { key: 'Fr', label: 'College (Fr)', weight: 0.05, ages: [19, 20], youngShare: 0.70 },
    { key: 'So', label: 'College (So)', weight: 0.10, ages: [20, 21], youngShare: 0.70 },
    { key: 'Jr', label: 'College (Jr)', weight: 0.40, ages: [21, 22], youngShare: 0.80 },
    { key: 'Sr', label: 'College (Sr)', weight: 0.15, ages: [22, 23], youngShare: 0.80 },
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
  // Star-scarcity recalibration (0.76.0, the talent-inflation fix): the
  // old bands (top-5 70-80, 6-30 65-75) minted ~30 potential stars every
  // June — integrated over 8-year star careers that's a ~145-star draft
  // population at equilibrium vs real MLB's ~55-70 players a season at
  // All-Star-caliber production. The elite tail stays close to intact
  // (the MVP tier measured nearly right); the squeeze is the 6-30 band
  // that fed the surplus. Soak-tuned: 14-year plateau lands 60-90 at
  // 55+ OVR.
  function ceilingTargetFor(slot, strength) {
    // Re-founding pipeline re-center (§22.11): the slot lift anchors on
    // the BEST tool, and phase-2's wider within-player spread pushes the
    // best tool further above the rest — so the same targets lifted the
    // other tools ~3-4 points less and the 26-man pyramid deflated into
    // a 1968 pitching era over two decades (20-season soak: 46 at 55+
    // vs ~87 founding, R/G 4.28→3.95 monotone). Bands +3 up top, +2/+1
    // deep, restore the founding pyramid THROUGH the spread.
    // §23.18 (owner's law): 80 is the wall and nearly nobody touches
    // it. Top-slot targets stop at 79 — the true 80-grade tool comes
    // from development walking a window all the way to the lid, the
    // surge, or the generational unicorn, never from the mint piling
    // kids against the top of the scale.
    // The thin 80 tail: ~one kid a year across both pipelines whose
    // best tool truly projects at the top of the scale — the two-hands
    // count replenishes as the founding 80s age out (soak-measured:
    // without this, equilibrium TRUE 80s collapsed to 1 by year 20).
    if (slot <= 5 && rand() < 0.15) {
      return clamp(rfloat(78.5, 80) + strength * 0.5, 42, 80);
    }
    let lo, hi, w;
    if (slot <= 5)        { lo = 71; hi = 79; w = 2.5; }
    else if (slot <= 30)  { lo = 59; hi = 71; w = 2.0; }
    else if (slot <= 60)  { lo = 54; hi = 64; w = 1.25; }
    else if (slot <= 150) { lo = 50; hi = 60; w = 0.6; }
    else                  { lo = 46; hi = 56; w = 0.3; }
    // §23 (cone only): a thin star-capable tail in the 6-30 band — the
    // kid the industry correctly ranks mid-first-round who really was a
    // top-5 talent. Without him the mid-board star cannot exist: soaks
    // proved consensus error alone just shuffles modest destinies.
    if (window.BBGM_CONSTANTS.CONE && window.BBGM_CONSTANTS.CONE.ENABLED &&
        slot > 5 && slot <= 30 && rand() < 0.10) {
      return clamp(rfloat(71, 77) + strength * w, 42, 79);
    }
    return clamp(rfloat(lo, hi) + strength * w, 42, 79);
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
    const age = bg.ages[rand() < bg.youngShare ? 0 : 1];
    const slotPos = rollSlotPos();
    const p = GEN().generateNewPlayer(rand, { id: null }, {
      slotPos, tier: 'prospect', isProspect: true,
      ageRange: { min: age, max: age },
      status: 'draft', rosterStatus: null,
      id: `dr${year}_${idx + 1}`,
    });
    p.age = age;
    // Birthday-consistent (0.66.2): the birth fields pin to his class-day
    // age, so the card's birth line and age agree from the first look.
    window.BBGM_PROGRESSION.alignBirthdate(p, state.meta.currentDate);
    p.teamId = null;
    p.contract = null;
    p.serviceTime = { years: 0, days: 0 };
    p.background = bg.key;
    p.school = schoolFor(bg);
    p.draftClass = year;

    // Signability (0.71.0): every June has its tough signs — the HS kid
    // with the ironclad commitment, the advisor floating a number the
    // slot can't cover. PUBLIC info (this stuff leaks every year), so
    // the flag sits on the card and the whole league prices the gamble:
    // burn the pick and pay over slot, or let him slide. Seniors have
    // no leverage — nobody plays hardball with nowhere to go.
    const toughOdds = bg.key === 'HS' ? 0.14
      : bg.key === 'Fr' || bg.key === 'So' ? 0.08
      : bg.key === 'Jr' ? 0.06 : 0;
    if (rand() < toughOdds) {
      p.toughSign = true;
      // WHY he's a tough sign (0.73.3), rolled once so the card copy is
      // stable. The HS kid holds a college commitment over the room; the
      // college underclassman just likes his leverage — he'd be fine
      // with another year on campus. A few of either are two-sport
      // athletes with the football program still in their ear.
      p.toughSignWhy = rand() < 0.15 ? 'twoSport'
        : bg.key === 'HS' ? 'commit' : 'school';
    }

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
      // The slot lift raises the bat, not the legs (Phase 16 balance):
      // speed keeps its body-given draw plus a small leak of the lift —
      // unless speed IS the carrying tool (the burner profile).
      if (!p.isPitcher && k === 'speed' && bestKey !== 'speed') {
        p.hidden.ceiling.speed = Math.round(clamp(
          p.hidden.ceiling.speed + Math.max(0, delta) * 0.15, 25, 80) * 10) / 10;
        continue;
      }
      const spread = k === bestKey ? 0 : rfloat(0, 7);
      p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + delta - spread, 25, 80) * 10) / 10;
    }

    // HS bats skew toward the high-variance development archetypes (6.5),
    // and carry extra true-bust exposure (0.38.0) — the classic first-round
    // toolshed who never develops is disproportionately a prep pick.
    if (bg.key === 'HS') {
      const r = rand();
      if (r < 0.06) {
        p.hidden.archetype = 'bust';
      } else if (r < 0.36) {
        p.hidden.archetype = p.isPitcher
          ? (rand() < 0.5 ? 'volatile' : 'flameout')
          : (rand() < 0.6 ? 'late_bloomer' : 'volatile');
      }
    }

    // The slot lift never overrides the archetype cap (0.53.1): a
    // quad-A profile stays quad-A even in a first-round slot — his
    // honest capped band ranks him where the limited upside belongs.
    GEN().applyArchetypeCap(p);

    // Current ratings: even the class's best bat is no better than
    // MLB-average on draft day (6.5). HS picks are far from their ceiling
    // — RAW, not just young (0.17.0: gap deepened 24→29 with wider
    // variance and a lower clamp, so a 17-year-old lands in the 30s-low
    // 40s and starts at Rookie/A; his value is the ceiling, untouched).
    // College seniors are nearly done developing.
    const gapBase = ({ HS: 29, Fr: 21, So: 17, Jr: 13, Sr: 10 })[bg.key] || 14;
    const currentCap = bg.key === 'HS' ? 48 : 56;
    for (const k of keys) {
      const gap = Math.max(3, gapBase + rnorm(0, bg.key === 'HS' ? 5 : 2));
      p.ratings[k] = clamp(Math.round((p.hidden.ceiling[k] - gap) * 10) / 10, 20,
        Math.min(currentCap, p.hidden.ceiling[k] - 2));
    }
    if (p.isPitcher) {
      // Stamina develops early — keep draft-day stamina near its ceiling so
      // SP prospects profile as starters from day one.
      p.ratings.stamina = clamp(Math.round((p.hidden.ceiling.stamina - rfloat(4, 10)) * 10) / 10, 30, 72);
    } else {
      // Speed is body-given and visible (1.3.0): a draftee runs on draft
      // day roughly what he'll run in the show — the polish cap and the
      // development gap are for skills, not legs. HS kids sit a shade
      // under (the frame still filling out).
      const sgap = bg.key === 'HS' ? rfloat(2, 5) : rfloat(0, 3);
      p.ratings.speed = clamp(Math.round((p.hidden.ceiling.speed - sgap) * 10) / 10, 20, 80);
    }

    // Scouting view (pre-Phase-13 fog): a stable best-tool ceiling band,
    // tighter for college players (6.5 uncertainty bands). The band is a
    // PROJECTION, and speed doesn't project — you can watch him run
    // (1.3.0) — so a hitter's band anchors on his best baseball tool.
    const bandKeys = p.isPitcher ? keys : keys.filter((k) => k !== 'speed');
    let bestK = bandKeys[0];
    for (const k of bandKeys) if (p.hidden.ceiling[k] > p.hidden.ceiling[bestK]) bestK = k;
    const best = p.hidden.ceiling[bestK];
    GEN().mintCone(p); // §23, minted AFTER the slot lift (no-op while dark)
    if (window.BBGM_CONSTANTS.CONE && window.BBGM_CONSTANTS.CONE.ENABLED) {
      // §23.6 (phase 3): the CONSENSUS can be wrong about a kid — the
      // industry's read carries per-kid error (wider on HS projection),
      // and once in a while the whole industry flat-out whiffs. The
      // band's width is the kid's TRUE cone width, so the edges are
      // real places. This is what mints the mid-board star and the
      // deep-pool miracle: talent generation is untouched; who the
      // board THINKS is good is not.
      let err = rnorm(0, bg.key === 'HS' ? 6 : 4);
      if (rand() < 0.03) err -= rfloat(8, 18); // the industry whiff
      const cone = p.hidden.cone;
      const hw = (cone && cone.hi[bestK] != null) ? (cone.hi[bestK] - cone.lo[bestK]) / 2 : 9;
      // §23.18.1: the wall never eats the width — clipped upside spills
      // downward, and the unclipped center survives as scout.seen for
      // ranking (see intl.js).
      const mid = best + err;
      const bandHi = Math.min(80, Math.round(mid + hw));
      p.scout = {
        seen: Math.round(mid * 10) / 10,
        ceilLo: Math.max(20, bandHi - Math.round(2 * hw)),
        ceilHi: bandHi,
      };
    } else {
      const fuzz = bg.key === 'HS' ? 6 : 3;
      p.scout = {
        ceilLo: Math.round(best - fuzz - rand() * 2),
        ceilHi: Math.round(best + fuzz + rand() * 2),
      };
    }
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
    // The hidden-gem economy (§23.19, v2.4.0, owner report: 0% star
    // rate outside round 1 — 1 star in ~4,000 matured rd-2+ picks).
    // Stars come from everywhere in real baseball: Piazza in the 62nd,
    // deGrom in the 9th, Betts in the 5th. The mechanism is the
    // industry MISSING a kid entirely — wrong league, bad body, grew
    // at 19 — so the lift lands AFTER his band minted: the talent is
    // real, the sheet still says late-rounder, and the board leaves
    // him there. Old form: one gem per ~20 drafts, slots 150+ only
    // (homeopathic). Now a decaying per-kid tail through the whole
    // class: rounds 2-5 (~2.4 gems/yr at 66-74), day three (~1.2/yr
    // at 62-72). Most still bust — the cone gives, the cone takes —
    // netting roughly one late-round star every second draft.
    const gemTails = [
      { from: 30, to: 149, prob: 0.02, lo: 66, hi: 74 },
      { from: 150, to: CLASS_SIZE - 1, prob: 0.006, lo: 62, hi: 72 },
    ];
    for (const tail of gemTails) {
      for (let gi = tail.from; gi <= tail.to; gi++) {
        if (rand() >= tail.prob) continue;
        liftHiddenGem(list[gi], rfloat(tail.lo, tail.hi));
      }
    }
    function liftHiddenGem(gem, target) {
      const keys = talentKeys(gem);
      // The gem is a hidden TALENT (1.3.0): anchor his lift on the best
      // bat/glove/arm tool, never his legs — a speed-anchored gem would
      // be a wasted roll now that bands and reads ignore footspeed.
      const anchorKeys = gem.isPitcher ? keys : keys.filter((k) => k !== 'speed');
      let bestKey = anchorKeys[0];
      for (const k of anchorKeys) if (gem.hidden.ceiling[k] > gem.hidden.ceiling[bestKey]) bestKey = k;
      // Raise-only (W3, 0.68.1): a gem whose best tool already clears
      // the target keeps what he has. Lift clamp 80 — the wall
      // (§23.18). His cone heals at the next checkpoint: the window-
      // follow machinery slides the minted window up to the moved
      // centers, width preserved.
      const delta = Math.max(0, target - gem.hidden.ceiling[bestKey]);
      for (const k of keys) {
        if (!gem.isPitcher && k === 'speed' && bestKey !== 'speed') {
          gem.hidden.ceiling.speed = Math.round(clamp(
            gem.hidden.ceiling.speed + delta * 0.15, 25, 80) * 10) / 10;
          continue;
        }
        const spread = k === bestKey ? 0 : rfloat(0, 7);
        const lifted = clamp(gem.hidden.ceiling[k] + delta - spread, 25, 80);
        gem.hidden.ceiling[k] = Math.round(Math.max(gem.hidden.ceiling[k], lifted) * 10) / 10;
      }
      GEN().applyArchetypeCap(gem); // the gem lift honors the cap too (0.53.1)
      GEN().syncBornSpeed(gem, rand); // a lifted speed ceiling shows up in his legs NOW (1.3.0)
      // The gem hides because scouts don't see it: his public band stays low.
    }

    // The generational talent (0.66.0): ~11% of classes carry one — a
    // few per decade across draft + July 2 combined. Drawn from the
    // young top of the class (a 22-year-old college senior can't be
    // "generational"; the ramp barely applies to him). Unlike the gem,
    // his band is recomputed LOUD — the whole industry sees the card;
    // what nobody sees is the flag that makes it real. A bust in the
    // same slot shows the same kind of card, which is the point.
    if (rand() < 0.11) {
      const star = list.slice(0, 8).find((q) => q.age <= 19);
      if (star) {
        GEN().anointGenerational(star, rand);
        const bandK = star.isPitcher ? talentKeys(star)
          : talentKeys(star).filter((k) => k !== 'speed');
        const CO = C().CONE;
        if (CO && CO.ENABLED && star.hidden.cone) {
          // §23.6/23.18.1 (2.4.0 — the intl unicorn got this in 2.2.0,
          // the draft one kept the pre-cone fuzz): true cone width,
          // small err, band slid under the wall, seen kept for rank.
          let bkK = bandK[0];
          for (const k of bandK) if (star.hidden.ceiling[k] > star.hidden.ceiling[bkK]) bkK = k;
          const bkv = star.hidden.ceiling[bkK];
          const chw = (star.hidden.cone.hi[bkK] - star.hidden.cone.lo[bkK]) / 2;
          const umid = bkv + rnorm(0, 2.5);
          const uhi = Math.min(80, Math.round(umid + chw));
          star.scout = {
            seen: Math.round(umid * 10) / 10,
            ceilLo: Math.max(20, uhi - Math.round(2 * chw)),
            ceilHi: uhi,
          };
        } else {
          const fz = star.background === 'HS' ? 6 : 3;
          const bk = Math.max(...bandK.map((k) => star.hidden.ceiling[k]));
          star.scout = {
            ceilLo: Math.round(bk - fz - rand() * 2),
            ceilHi: Math.round(bk + fz + rand() * 2),
          };
        }
      }
    }

    // Re-entries (0.71.0): unsigned picks from prior Junes come back into
    // the pool — older, more polished from campus reps, leverage spent.
    // Their ceiling bands were honest then and stay honest now; what
    // changed is how much of the ceiling they've already reached.
    {
      const due = (state.draftReentry || []).filter((e) => e.availableYear <= year);
      if (due.length) {
        state.draftReentry = state.draftReentry.filter((e) => e.availableYear > year);
        for (const e of due) {
          const p = e.player;
          const elapsed = Math.max(1, year - e.prior.year);
          p.age += elapsed;
          window.BBGM_PROGRESSION.alignBirthdate(p, state.meta.currentDate);
          // Campus reps close ~13% of the remaining gap per year —
          // visible polish without minting a finished teen (the league's
          // talent curve is calibrated on raw draft classes).
          for (const k of talentKeys(p)) {
            const gap = p.hidden.ceiling[k] - p.ratings[k];
            if (gap > 0) {
              p.ratings[k] = Math.round(clamp(
                p.ratings[k] + gap * 0.13 * elapsed, 20, p.hidden.ceiling[k]) * 10) / 10;
            }
          }
          if (p.background === 'HS') {
            p.background = 'So';
            p.school = schoolFor({ key: 'So' });
          } else {
            p.background = 'Sr';
          }
          delete p.toughSign; // the leverage is spent — he wants pro ball now
          delete p.toughSignWhy;
          p.reentry = { year: e.prior.year, round: e.prior.round,
            overall: e.prior.overall, teamId: e.prior.teamId };
          p.draftClass = year;
          prospects[p.id] = p;
          list.push(p);
        }
      }
    }

    // Industry consensus board: true-talent score plus scouting noise. The
    // slot bands were assigned in order, so the board is roughly generation
    // order with local reshuffling — reaches and steals both exist.
    const scoreOf = (p) => {
      const keys = talentKeys(p);
      // §23.18.1: rank on the internal center when it exists (see
      // intl.js consensusScore).
      const seen = p.scout.seen != null ? p.scout.seen
        : (p.scout.ceilLo + p.scout.ceilHi) / 2;
      const avgCur = keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length;
      if (window.BBGM_CONSTANTS.CONE && window.BBGM_CONSTANTS.CONE.ENABLED) {
        // §23.6: the industry ranks on what it BELIEVES (the erred
        // band) plus what it can watch (current tools) — the old
        // true-avgCeil term was a truth leak that re-sorted every
        // mis-read kid right back to his honest slot.
        // §23.16: the list agrees with its own grades. The old σ3 rank
        // dice were a pre-cone holdover (bands used to hug truth, so
        // rank noise WAS the consensus error) — post-flip the error
        // already lives in seen, and big dice made the board rank kids
        // above others its own published bands called far better. The
        // upside tilt chases the top edge: a wide window outranks a
        // same-center narrow one, which is why the freak goes early.
        // Polish stays a light thumb on the scale (0.15): any heavier
        // and a finished college kid outranks a raw teen whose
        // published FLOOR sits at the college kid's ceiling — the
        // exact self-contradiction this rewrite kills.
        const seenUp = seen + Math.max(0, p.scout.ceilHi - seen) * 0.2;
        return seenUp * 0.65 + avgCur * 0.15 + rnorm(0, 1);
      }
      const best = Math.max(...keys.map((k) => p.hidden.ceiling[k]));
      const avgCeil = keys.reduce((s, k) => s + p.hidden.ceiling[k], 0) / keys.length;
      // The public board sees the scouted band, not true ceiling.
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
      userBoard: [],               // the user's 30-man big board (0.65.0)
      boardAdded: {},              // id -> date boarded; drives read sharpening
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
    // Window size + geometric decay come from the team's SCOUTING TIER
    // (13.6 / 6.9): elite departments stay near the consensus, bare-bones
    // ones reach. Owner quirks still layer on top.
    const SC = window.BBGM_SCOUT;
    let window_ = 12, decay = 0.58;
    if (SC && team) {
      const d = SC.aiDraftDiscipline(team);
      window_ = d.window;
      decay = d.decay;
    }
    if (owner === 'aggressive') decay = Math.min(0.75, decay + 0.08);
    else if (owner === 'cheap' && round > 1) { window_ += 4; decay = Math.min(0.78, decay + 0.06); }

    // Per-team scouted view (0.41.0). The board is the industry
    // consensus, but a department's PERCEIVED order blends consensus
    // rank with the TRUTH in proportion to its scouting tier — elite
    // depts sniff out the under-ranked gem and fade the consensus
    // bust; bare-bones ones stay board-slaves. The candidate pool is
    // the consensus window plus "our guys": the best true talents
    // buried between the window and ~120, the names a good department
    // surfaces in its own meetings.
    const tier = SC && team ? SC.tierIdx(team) : 1;
    const TRUTH_W = [0.15, 0.30, 0.50, 0.70][tier];
    const RANK_NOISE = [4, 3, 2, 1][tier];
    const trueScoreOf = (p) => {
      const keys = talentKeys(p);
      const avgCeil = keys.reduce((s, k) => s + p.hidden.ceiling[k], 0) / keys.length;
      const avgCur = keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length;
      return avgCeil * 0.5 + avgCur * 0.5;
    };
    const deeper = avail.slice(window_, 120)
      .map((id) => ({ id, t: trueScoreOf(draft.prospects[id]) }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 6)
      .map((x) => x.id);
    // Off-window consensus rank saturates: "not on the board" is "not on
    // the board", whether he's #70 or #110 — and the better the dept, the
    // less that consensus miss costs (they trust their own eyes).
    const offBoardCap = window_ + [10, 8, 6, 4][tier];
    const pool = avail.slice(0, window_).concat(deeper).map((id) => ({
      id,
      boardPos: Math.min(avail.indexOf(id), offBoardCap),
      t: trueScoreOf(draft.prospects[id]),
    }));
    pool.slice().sort((a, b) => b.t - a.t).forEach((c, i) => { c.trueRank = i; });
    for (const c of pool) {
      c.perceived = (1 - TRUTH_W) * c.boardPos + TRUTH_W * c.trueRank + rnorm(0, RANK_NOISE * 0.6);
    }
    pool.sort((a, b) => a.perceived - b.perceived);

    const cands = pool.map((c, i) => {
      const id = c.id;
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
      // Signability slide (0.71.0): most rooms won't burn a premium pick
      // on an advisor's number, so the flagged kid falls — and somebody's
      // late-round flyer on him is the story of every June. Cheap owners
      // won't touch the ask at all up high.
      if (p.toughSign) {
        w *= round <= 2 ? 0.35 : round <= 4 ? 0.6 : 1.05;
        if (owner === 'cheap' && round <= 4) w *= 0.3;
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

  function signRateFor(round, p) {
    // The tough sign's advisor meant it (0.71.0): early-round money is
    // real enough to flip him a bit better than a coin; anything later
    // and he's on campus in the fall.
    if (p.toughSign) {
      return round <= 1 ? 0.66 : round <= 3 ? 0.55 : round <= 7 ? 0.40 : 0.22;
    }
    // Seniors sign (0.74.0, user report): no eligibility left means no
    // leverage — the slot money is the only money. The once-in-years
    // holdout is a story, not a Tuesday.
    if (p.background === 'Sr') return 0.99;
    let rate = round <= 3 ? 0.97 : round <= 7 ? 0.92 : 0.82;
    // Late-round HS picks often honor college commitments instead.
    if (round >= 8 && p.background === 'HS') rate = 0.70;
    return rate;
  }

  // Assignment level by round (13.8) on the four-level ladder, lifted by
  // the scouts' placement read (a polished college bat can open at AA)
  // but never straight to AAA out of the draft.
  function levelFor(p, round) {
    const MIN = window.BBGM_MINORS;
    let base;
    if (round <= 3) base = 'A';
    else if (round <= 7) base = p.age >= 21 ? 'A' : 'Rookie';
    else base = 'Rookie';
    let idx = MIN.ORDER.indexOf(base);
    const rec = MIN.ORDER.indexOf(MIN.recommendedLevel(p));
    idx = Math.max(idx, Math.min(rec, MIN.ORDER.indexOf('AA')));
    if (p.age >= 23) idx = Math.max(idx, 1);
    // Youth ceiling applies at signing too (0.28.0): a 17-year-old HS
    // first-rounder opens in Rookie ball no matter the round's base.
    idx = Math.min(idx, MIN.maxLevelIdxForAge(p.age));
    return MIN.ORDER[idx];
  }

  function completeDraft(state) {
    const draft = state.draft;
    if (draft.phase === 'complete') return draft.recap;
    draft.phase = 'complete';
    const year = draft.year;

    const reentryQueued = new Set();
    for (const pick of draft.picks) {
      const p = draft.prospects[pick.prospectId];
      if (!p) continue;
      const signs = rand() < signRateFor(pick.round, p);
      pick.signed = signs;
      if (!signs) {
        // Re-entry (0.71.0): he didn't vanish — he went back to campus.
        // College kids return next June (a senior now, leverage spent);
        // HS kids surface two Junes later as college underclassmen. A
        // kid who has already re-entered once is out of road — the
        // undrafted-FA machinery is all that's left for him.
        if (!p.reentry && p.background !== 'Sr') {
          if (!state.draftReentry) state.draftReentry = [];
          state.draftReentry.push({
            availableYear: year + (p.background === 'HS' ? 2 : 1),
            player: p,
            prior: { year, round: pick.round, overall: pick.overall, teamId: pick.teamId },
          });
          reentryQueued.add(p.id);
          {
            const dt = state.league.teams.find((t) => t.id === pick.teamId);
            window.BBGM_ROSTER.logTx(state, p,
              `Did not sign with ${dt ? dt.abbr : '?'} (R${pick.round}, #${pick.overall} overall) — returned to school`);
          }
        } else if (p.background === 'Sr') {
          // The overseas detour (0.74.0, user report: an unsigned senior
          // first-rounder surfaced in indie ball, signable for $0.74M
          // within the month). A drafted senior who walks isn't grinding
          // the Frontier League waiting on the club that lowballed him —
          // he takes the real money in Japan or Korea on a one-year
          // deal. He lives in state.players (flavor lines, development,
          // aging all run) but NOT in state.freeAgents: no FA screen, no
          // AI signings, no scout letter, no sign button until he comes
          // home to the winter market at the rollover.
          p.status = 'FA';
          p.rosterStatus = 'FA';
          p.teamId = null;
          p.faSeasons = 0;
          p.faReason = 'wentAbroad';
          p.serviceTime = { years: 0, days: 0 };
          p.contract = { years: 0, annualSalary: 0, totalValue: 0, signedAt: 'abroad' };
          p.playsIn = rand() < 0.6 ? 'NPB' : 'KBO';
          p.playsInYear = year;
          p.abroadYear = year; // home at the rollover that closes this season
          state.players[p.id] = p;
          if (!state.abroadIds) state.abroadIds = [];
          state.abroadIds.push(p.id);
          pick.wentAbroad = window.BBGM_FLAVOR
            ? window.BBGM_FLAVOR.leagueName(p.playsIn) : p.playsIn;
          {
            const dt = state.league.teams.find((t) => t.id === pick.teamId);
            window.BBGM_ROSTER.logTx(state, p,
              `Did not sign with ${dt ? dt.abbr : '?'} (R${pick.round}) — one-year deal in the ${pick.wentAbroad}`);
          }
        }
        continue; // failed pick is forfeited (13.7)
      }
      // The tough sign who DOES sign got paid — the over-slot number the
      // advisor was floating all spring (0.71.0).
      pick.bonus = Math.round(slotValue(pick.overall) *
        (p.toughSign ? rfloat(1.35, 1.7) : rfloat(0.85, 1.15)) * 100) / 100;

      // Development reality (6.5 "the 1st-rounder who never develops"):
      // the scouted ceiling is a projection, not a promise. Attained
      // ceiling shifts on signing — busts outnumber pleasant surprises,
      // and HS picks carry the wider error bars. p.scout keeps the
      // pre-draft view, so hindsight ("he never became that guy") reads
      // naturally on the profile.
      const bust = p.background === 'HS' ? rnorm(-2.5, 5.5) : rnorm(-1.5, 4);
      for (const k of talentKeys(p)) {
        p.hidden.ceiling[k] = Math.round(clamp(p.hidden.ceiling[k] + bust, 25, 80) * 10) / 10;
        p.ratings[k] = Math.min(p.ratings[k], Math.max(20, p.hidden.ceiling[k] - 2));
      }
      GEN().applyArchetypeCap(p); // the signing-day shift honors the cap (0.53.1)
      GEN().syncBornSpeed(p, rand); // a positive shift moves his legs with it (1.3.0 law, missed site)

      const team = state.league.teams.find((t) => t.id === pick.teamId);
      p.status = 'minors';
      p.teamId = team.id;
      p.rosterStatus = levelFor(p, pick.round);
      p.contract = { years: 1, annualSalary: 0.74, totalValue: 0.74, signedAt: 'draft' };
      p.draft = {
        year, round: pick.round, pick: pick.pick, overall: pick.overall,
        teamId: team.id, bonus: pick.bonus,
      };
      state.players[p.id] = p;
      team.minors.push(p.id);
      window.BBGM_ROSTER.logTx(state, p,
        `Drafted R${pick.round} (#${pick.overall} overall) by ${team.abbr} — signed, $${pick.bonus}M bonus`);
    }

    // Undrafted paths (0.41.0). High schoolers head to campus — they
    // were never in state.players, so they simply vanish with the class
    // (same as unsigned HS picks). College kids hit the open market:
    // the best UNDRAFTED_FA_MAX by board rank persist as free agents —
    // they'll catch on in independent ball (flavor leagues), keep
    // developing, and stay signable. The rest hang them up.
    {
      const signedSet = new Set(draft.picks.filter((pk) => pk.signed).map((pk) => pk.prospectId));
      const pickedSet = new Set(draft.picks.map((pk) => pk.prospectId));
      let intake = 0;
      for (const id of draft.board) {
        if (intake >= UNDRAFTED_FA_MAX) break;
        const p = draft.prospects[id];
        if (!p || signedSet.has(id)) continue;
        if (reentryQueued.has(id)) continue; // he's going back to campus, not indie ball (0.71.0)
        // Sealed (0.71.5, tightened 0.74.0): a DRAFTED player who didn't
        // sign NEVER reaches the open pool. Underclassmen re-enter a
        // future draft or stay on campus; unsigned seniors now take the
        // overseas detour above. Rivals don't get your unsigned pick
        // for $0.74M — nobody does, until the winter he comes home.
        if (pickedSet.has(id)) continue;
        if (p.background === 'HS') continue; // back to school
        p.status = 'FA';
        p.rosterStatus = 'FA';
        p.teamId = null;
        p.faSeasons = 0;
        p.faReason = 'undrafted';
        p.serviceTime = { years: 0, days: 0 };
        p.contract = { years: 0, annualSalary: 0, totalValue: 0, signedAt: 'undrafted' };
        state.players[p.id] = p;
        if (!state.freeAgents) state.freeAgents = [];
        state.freeAgents.push(p.id);
        intake++;
      }
    }

    // Recap + condensed history; drop the prospect map from the save
    // (signed picks and undrafted FAs now live in state.players).
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
    draft.boardAdded = {};

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
