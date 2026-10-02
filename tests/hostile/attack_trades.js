'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const T = W.BBGM_TRADES, R = W.BBGM_ROSTER, FA = W.BBGM_FA;

function freshInSeason() { const s = L.newSeasonState(4242); for (let i = 0; i < 3; i++) L.simOneDay(s); return s; }
function sortedByValue(state, team, list) { return list.map((id) => state.players[id]).filter(Boolean).sort((a, b) => T.tradeValue(b) - T.tradeValue(a)); }
function nextDayOk(state) {
  const s = clone(state);
  const errs = L.simOneDay(s);
  return errs;
}

// ---------- 1. Fleece search: best accepted ratio by true tradeValue ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state);
  let worst = null; let accepted = 0, tried = 0;
  for (const ai of state.league.teams) {
    if (ai.id === ut.id) continue;
    const theirs = sortedByValue(state, ai, ai.roster.concat(ai.minors));
    const mine = sortedByValue(state, ut, ut.roster.concat(ut.minors));
    // many-for-one dumps: 4 of my worst for 1 of their best, scanning down their list
    for (const star of theirs.slice(0, 8)) {
      for (const k of [1, 2, 3, 4]) {
        const junk = mine.slice(-k);
        tried++;
        const res = T.evaluateProposal(state, ai, junk, [star], 0, 0, 0, 0);
        if (res.verdict === 'accept') {
          accepted++;
          const tvIn = T.tradeValue(star), tvOut = junk.reduce((s, p) => s + T.tradeValue(p), 0);
          const r = tvIn / Math.max(0.01, tvOut);
          if (!worst || r > worst.r) worst = { r, ai: ai.abbr, star: `${star.name} (TV ${tvIn.toFixed(1)}, ovr ${R.overall(star).toFixed(0)})`, junk: junk.map((p) => `${p.name} TV ${T.tradeValue(p).toFixed(1)}`).join('+') };
        }
      }
    }
  }
  console.log(`fleece scan: ${accepted}/${tried} junk-for-star proposals accepted`);
  if (worst && worst.r > 1.5) finding('HIGH', 'AI accepts lopsided many-for-one dumps (true-value ratio ' + worst.r.toFixed(2) + ')', `${worst.ai} gives ${worst.star} for ${worst.junk}`);
  else if (worst) finding('MEDIUM', 'AI accepts a junk-for-star swap at ratio ' + worst.r.toFixed(2), `${worst.ai} gives ${worst.star} for ${worst.junk}`);
  else held('junk-for-star many-for-one dumps are all rejected');
}

// ---------- 2. Value asymmetry: teamValueOf vs sellValueOf via counter loop ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state);
  // Exploit: AI's "need" multiplier. For every AI team, find my single cheapest player they'd accept for THEIR most valuable player they would move.
  let best = null;
  for (const ai of state.league.teams) {
    if (ai.id === ut.id) continue;
    const theirs = sortedByValue(state, ai, ai.roster.concat(ai.minors)).slice(0, 15);
    const mine = sortedByValue(state, ut, ut.roster.concat(ut.minors));
    for (const star of theirs) {
      for (const p of mine.slice().reverse()) { // cheapest first
        const res = T.evaluateProposal(state, ai, [p], [star], 0, 0, 0, 0);
        if (res.verdict === 'accept') {
          const gain = T.tradeValue(star) - T.tradeValue(p);
          if (!best || gain > best.gain) best = { gain, ai: ai.abbr, star: `${star.name} TV${T.tradeValue(star).toFixed(1)} ovr${R.overall(star).toFixed(0)} age${star.age}`, p: `${p.name} TV${T.tradeValue(p).toFixed(1)} ovr${R.overall(p).toFixed(0)} age${p.age}` };
          break;
        }
      }
    }
  }
  if (best && best.gain > 15) finding('HIGH', `1-for-1 fleece: +${best.gain.toFixed(1)} true TV in one accepted trade`, `${best.ai} gives ${best.star} for ${best.p}`);
  else if (best) held(`best 1-for-1 gain only +${best.gain.toFixed(1)} TV (${best.ai}: ${best.star} for ${best.p})`);
}

// ---------- 3. Same player twice in give ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state), ai = state.league.teams[1];
  const mine = sortedByValue(state, ut, ut.roster);
  const theirs = sortedByValue(state, ai, ai.roster);
  const p = mine[3], star = theirs[2];
  const single = T.evaluateProposal(state, ai, [p], [star], 0, 0, 0, 0);
  const dbl = T.evaluateProposal(state, ai, [p, p], [star], 0, 0, 0, 0);
  console.log('dup give: single', single.verdict, (single.ratio || 0).toFixed(2), '| doubled', dbl.verdict, (dbl.ratio || 0).toFixed(2));
  {
    T.executeTrade(state, ut, [p, p], ai, [star], 0, 0, 0, 0);
    const iss = audit(state, 'after duplicate-player trade');
    const dupIss = iss.filter((x) => /duplicates|AND/.test(x));
    if (dbl.ratio > single.ratio * 1.5 || dupIss.length) finding('MEDIUM', 'Duplicate player in give[] is double-counted by evaluateProposal; executeTrade pushes him onto the partner roster twice', `ratio single=${single.ratio.toFixed(2)} doubled=${dbl.ratio.toFixed(2)}; post-trade audit: ${dupIss.join(' | ') || 'no dup detected'}; next-day sim errors: ${nextDayOk(state).join(' | ') || 'none'} (engine-level: UI toggle prevents this, reachable only via console)`);
    else held('duplicate player in give[] not exploitable here');
  }
}

// ---------- 4. Trading a player not on my team (their own player back to them / third team's) ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state), ai = state.league.teams[1];
  const theirStar = sortedByValue(state, ai, ai.roster)[0];
  // the most valuable player in the league who is NOT mine or theirs
  let thirdStar = null;
  for (const tt of state.league.teams) { if (tt.id === ut.id || tt.id === ai.id) continue; for (const id of tt.roster.concat(tt.minors)) { const q = state.players[id]; if (q && (!thirdStar || T.tradeValue(q) > T.tradeValue(thirdStar))) thirdStar = q; } }
  const third = state.league.teams.find((t) => t.id === thirdStar.teamId);
  const res1 = T.evaluateProposal(state, ai, [thirdStar], [theirStar], 0, 0, 0, 0);
  console.log('give third-team star:', res1.verdict, res1.ratio);
  if (res1.verdict === 'accept') {
    T.executeTrade(state, ut, [thirdStar], ai, [theirStar], 0, 0, 0, 0);
    const iss = audit(state, 'after phantom-give trade');
    const got = ut.roster.includes(theirStar.id);
    finding('HIGH', 'evaluateProposal accepts a proposal giving a player the user does not own; executeTrade silently drops him but still hands over the AI player', `got ${theirStar.name}: ${got}; ${thirdStar.name} still on ${third.abbr}: ${third.roster.includes(thirdStar.id)}; issues: ${iss.length}. Engine-level (UI filters give[] to own org) but a stale draft between sim ticks relies on this filter.`);
  } else held('giving a third team\'s player is rejected at evaluate');
}

// ---------- 5. Cash abuse: negative / huge / fractional / NaN ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state), ai = state.league.teams[3];
  const theirs = sortedByValue(state, ai, ai.roster);
  const mine = sortedByValue(state, ut, ut.roster);
  const star = theirs[0], junk = mine[mine.length - 1];
  const payroll0 = FA.computePayroll(ut, state.players);
  const tests = [
    ['cashGive 1e9', [1e9, 0]], ['cashGet -1e9', [0, -1e9]], ['cashGive NaN', [NaN, 0]], ['cashGive Infinity', [Infinity, 0]], ['cashGet negative -50', [0, -50]], ['cashGive 20.0001', [20.0001, 0]],
  ];
  for (const [label, [cg, cget]] of tests) {
    const s = clone(state); T.setPlayersRef(s.players);
    const u = L.userTeam(s), a = s.league.teams[3];
    const res = T.evaluateProposal(s, a, [s.players[junk.id]], [s.players[star.id]], cg, cget, 0, 0);
    if (res.verdict === 'accept') {
      T.executeTrade(s, u, [s.players[junk.id]], a, [s.players[star.id]], cg, cget, 0, 0);
      const pr = FA.computePayroll(u, s.players);
      finding('MEDIUM', `Cash parameter unvalidated: ${label} accepted`, `AI gives ${star.name} (TV ${T.tradeValue(star).toFixed(1)}) for ${junk.name}; user payroll ${payroll0} -> ${pr}; tradeCash=${JSON.stringify(u.tradeCash)} (engine-level: UI steppers clamp 0..20)`);
    } else console.log(`   ${label}: ${res.verdict}`);
  }
}

// ---------- 6. Pool money abuse ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  W.BBGM_INTL.ensureClass(state, state.meta.currentDate);
  const ut = L.userTeam(state), ai = state.league.teams[4];
  const b = state.intl.budgets[ut.id], ba = state.intl.budgets[ai.id];
  console.log('intl phase', state.intl.phase, 'user pool', b && b.pool, 'ai pool', ba && ba.pool);
  const theirs = sortedByValue(state, ai, ai.roster);
  const mine = sortedByValue(state, ut, ut.roster);
  for (const [label, pg, pget] of [['poolGive -100', -100, 0], ['poolGet -100', 0, -100], ['poolGive NaN', NaN, 0], ['poolGet 0.001', 0, 0.001]]) {
    const s = clone(state); T.setPlayersRef(s.players);
    const u = L.userTeam(s), a = s.league.teams[4];
    const res = T.evaluateProposal(s, a, [s.players[mine[mine.length - 1].id]], [s.players[theirs[0].id]], 0, 0, pg, pget);
    if (res.verdict === 'accept') {
      T.executeTrade(s, u, [s.players[mine[mine.length - 1].id]], a, [s.players[theirs[0].id]], 0, 0, pg, pget);
      finding('MEDIUM', `Pool parameter unvalidated: ${label} accepted`, `pools after: user ${JSON.stringify(s.intl.budgets[u.id])} ai ${JSON.stringify(s.intl.budgets[a.id])}`);
    } else console.log(`   ${label}: ${res.verdict} ${res.feedback || ''}`);
  }
}

// ---------- 7. Trade an IL player / rule5 pick / retiring player ----------
{
  const state = freshInSeason();
  for (let i = 0; i < 25; i++) L.simOneDay(state);
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state);
  // find an AI team with an IL player of value
  let done = false;
  for (const ai of state.league.teams) {
    if (ai.id === ut.id || !(ai.il || []).length) continue;
    const ilp = state.players[ai.il[0]];
    const mine = sortedByValue(state, ut, ut.roster);
    const res = T.evaluateProposal(state, ai, [mine[mine.length - 1]], [ilp], 0, 0, 0, 0);
    console.log(`IL ${ilp.name} (${ilp.ilStatus && ilp.ilStatus.daysRemaining}d) for junk: ${res.verdict}`);
    if (res.verdict !== 'reject') {
      T.executeTrade(state, ut, [mine[mine.length - 1]], ai, [ilp], 0, 0, 0, 0);
      const iss = audit(state, 'after IL trade');
      console.log('   IL player landed on user il:', (ut.il || []).includes(ilp.id), 'roster size', ut.roster.length, 'il', (ut.il || []).length);
      const errs = nextDayOk(state);
      if (errs.length || iss.length) finding('HIGH', 'Trading for an IL player breaks invariants', errs.concat(iss).join(' | '));
      else held('acquiring an IL player keeps him on IL and the roster legal');
    }
    done = true; break;
  }
  if (!done) console.log('no IL candidates');
}

// Rule 5 pick traded: obligation travels? trade pick back to original club
{
  const state = L.offseasonState(777);
  const state2 = clone(state);
  state2.meta.currentDate = { year: state2.meta.currentDate.year, month: 12, day: 10 };
  const ut = L.userTeam(state2);
  const R5 = W.BBGM_RULE5;
  // make some rivals' farmhands eligible so the user can draft
  const wy = R5.winterYearFor(state2.meta.currentDate);
  const rival = state2.league.teams[5];
  let elig = [];
  for (const id of rival.minors) { const p = state2.players[id]; if (p && p.status === 'minors' && p.age >= 25) { p.draft = { year: wy - 5, round: 6, overall: 180, teamId: rival.id }; elig.push(p); } }
  const pool = R5.eligibleFor(state2, rival, wy);
  if (pool.length) {
    const target = pool[0];
    const res = R5.runDraft(state2, { userChoice: target.id });
    if (res.userResult.kind === 'picked') {
      T.setPlayersRef(state2.players);
      // trade the pick straight back to his original club
      const theirs = sortedByValue(state2, rival, rival.roster);
      const r = T.evaluateProposal(state2, rival, [target], [theirs[theirs.length - 1]], 0, 0, 0, 0);
      console.log('trade Rule 5 pick back to origin:', r.verdict, 'flag before', JSON.stringify(target.rule5));
      if (r.verdict === 'accept') {
        T.executeTrade(state2, ut, [target], rival, [theirs[theirs.length - 1]], 0, 0, 0, 0);
        console.log('   after: teamId', target.teamId, 'status', target.status, 'rule5', JSON.stringify(target.rule5), 'on rival roster', rival.roster.includes(target.id), 'in rival minors', rival.minors.includes(target.id));
        if (target.rule5 && target.rule5.fromTeamId === target.teamId) finding('MEDIUM', 'Rule 5 pick traded back to his original club keeps the obligation flag pointing at his own team', `rule5=${JSON.stringify(target.rule5)} teamId=${target.teamId}; returnPick would "return" him to himself; aiStickTick may fire pointlessly`);
      }
      // Also: trade a Rule 5 pick to a THIRD club, then run aiStickTick on that club with him demoted via executeTrade trim
      const s3 = clone(state); s3.meta.currentDate = { year: s3.meta.currentDate.year, month: 12, day: 10 };
    }
  } else console.log('no rule5-eligible pool for rival');
}

// ---------- 8. Forbidden windows ----------
{
  const state = freshInSeason();
  const s = clone(state);
  s.meta.currentDate = { year: s.meta.currentDate.year, month: 8, day: 1 };
  T.setPlayersRef(s.players);
  const ut = L.userTeam(s), ai = s.league.teams[1];
  const res = T.evaluateProposal(s, ai, [s.players[ut.roster[0]]], [s.players[ai.roster[0]]], 0, 0, 0, 0);
  if (res.verdict === 'reject' && /deadline/.test(res.feedback)) held('trades after July 31 rejected');
  else finding('HIGH', 'Post-deadline trade not rejected', JSON.stringify(res));
  // executeTrade directly ignores the window entirely
  const s2 = clone(state); s2.meta.currentDate = { year: s2.meta.currentDate.year, month: 10, day: 5 };
  T.setPlayersRef(s2.players);
  const u2 = L.userTeam(s2), a2 = s2.league.teams[1];
  T.executeTrade(s2, u2, [s2.players[u2.roster[0]]], a2, [s2.players[a2.roster[0]]], 0, 0, 0, 0);
  console.log('executeTrade in October succeeded (no guard; engine-level only)');
  // postseason: offseasonPhase null but date >= seasonEnd
  const s3 = clone(state); s3.meta.currentDate = { ...s3.league.schedule.seasonEnd }; s3.postseason = { phase: 'ds' };
  T.setPlayersRef(s3.players);
  const r3 = T.evaluateProposal(s3, s3.league.teams[1], [s3.players[L.userTeam(s3).roster[0]]], [s3.players[s3.league.teams[1].roster[0]]], 0, 0, 0, 0);
  console.log('postseason proposal verdict:', r3.verdict, r3.feedback || '');
}

// ---------- 9. Roster legality after many accepted trades + sim next day ----------
{
  const state = freshInSeason();
  T.setPlayersRef(state.players);
  let n = 0, bad = 0;
  for (let round = 0; round < 40; round++) {
    const ut = L.userTeam(state);
    const ai = state.league.teams[1 + (round % 29)];
    const theirs = sortedByValue(state, ai, ai.roster.concat(ai.minors));
    const mine = sortedByValue(state, ut, ut.roster.concat(ut.minors));
    // 1-for-3 and 3-for-1 alternating
    const give = round % 2 ? mine.slice(0, 1) : mine.slice(-3);
    const get = round % 2 ? theirs.slice(-3) : theirs.slice(0, 1);
    const res = T.evaluateProposal(state, ai, give, get, 0, 0, 0, 0);
    if (res.verdict !== 'accept') continue;
    T.executeTrade(state, ut, give, ai, get, 0, 0, 0, 0);
    n++;
    const iss = audit(state);
    const errs = nextDayOk(state);
    if (iss.length || errs.length) { bad++; finding('HIGH', `Roster invariant broken after accepted trade #${n} (${give.length}-for-${get.length} with ${ai.abbr})`, iss.concat(errs).slice(0, 5).join(' | ')); if (bad > 2) break; }
  }
  console.log(`executed ${n} chained trades, ${bad} broke invariants`);
  if (n && !bad) held(`${n} chained accepted trades (1-for-3 / 3-for-1) kept rosters legal and the next day simmed`);
}

// ---------- 10. Offseason: trade away everybody (floors off in winter) then start season ----------
{
  const state = L.offseasonState(777);
  T.setPlayersRef(state.players);
  const ut = L.userTeam(state);
  let n = 0;
  for (let round = 0; round < 60 && ut.roster.length > 0; round++) {
    const ai = state.league.teams[1 + (round % 29)];
    const mine = sortedByValue(state, ut, ut.roster);
    const theirs = sortedByValue(state, ai, ai.minors);
    if (!mine.length || !theirs.length) continue;
    const give = mine.slice(0, 2), get = theirs.slice(-1);
    const res = T.evaluateProposal(state, ai, give, get, 0, 0, 0, 0);
    if (res.verdict !== 'accept') continue;
    T.executeTrade(state, ut, give, ai, get, 0, 0, 0, 0); n++;
  }
  console.log(`winter dump: ${n} trades, user 26-man now ${ut.roster.length}, minors ${ut.minors.length}`);
  try {
    W.BBGM_OFFSEASON.runSeasonRolloverPartB(state);
    const iss = audit(state, 'after PartB following winter dump');
    const errs = L.simOneDay(state);
    if (errs.length || iss.length) finding('HIGH', 'Winter roster dump leaves Opening Day broken', iss.concat(errs).slice(0, 5).join(' | '));
    else held(`winter dump of ${n} trades (26-man down to ${ut.roster.length}) is repaired by spring top-up; Opening Day sims`);
  } catch (e) { finding('CRITICAL', 'runSeasonRolloverPartB throws after winter roster dump', e.stack.split('\n').slice(0, 4).join(' / ')); }
}

L.dump('attack_trades');
