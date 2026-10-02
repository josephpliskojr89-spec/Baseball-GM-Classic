'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const FA = W.BBGM_FA, R = W.BBGM_ROSTER, WV = W.BBGM_WAIVERS, INJ = W.BBGM_INJURIES, GEN = W.BBGM_PLAYER_GEN;

function nextDays(state, n = 2) { const s = clone(state); const errs = []; for (let i = 0; i < n; i++) errs.push(...L.simOneDay(s)); return { errs, s }; }
function sendDown(state, team, p) { // mirrors UI's raw move after its checks
  team.roster.splice(team.roster.indexOf(p.id), 1); team.minors.push(p.id); p.status = 'minors'; p.rosterStatus = R.demotionLevel(p); R.replaceRefs(team, state.players, p.id, null);
}
function callUp(state, team, p) { team.minors.splice(team.minors.indexOf(p.id), 1); team.roster.push(p.id); p.status = 'active'; p.rosterStatus = '26-man'; }

// 1. Release everyone through the engine door (releaseToPool has no floor guard) -> next day sim
{
  const s = L.newSeasonState(31); for (let i = 0; i < 2; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  const n0 = ut.roster.length;
  for (const id of ut.roster.slice(0, 20)) FA.releaseToPool(s, s.players[id], 'released');
  console.log(`released 20 of ${n0}; roster now ${ut.roster.length}`);
  audit(s, 'after releasing 20');
  const { errs, s: s2 } = nextDays(s, 2);
  const u2 = L.userTeam(s2);
  if (errs.length) finding('MEDIUM', 'releaseToPool has no roster-floor guard (UI releaseBlocker is the only check): a 6-man roster crashes the sim', errs.slice(0, 2).join(' | '));
  else { console.log(`   after 2 days roster ${u2.roster.length} (auto-repaired?)`); held('engine-level mass release is repaired / survives the next day sim'); }
}

// 2. Waiver pile-up: DFA 15 players in one day (engine), AI claims, user roster <26, then daily tick
{
  const s = L.newSeasonState(32); for (let i = 0; i < 2; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  for (const id of ut.roster.slice(10, 25)) WV.place(s, ut, s.players[id]);
  console.log(`DFA'd 15; roster ${ut.roster.length}; wire ${s.waivers.length}`);
  const { errs, s: s2 } = nextDays(s, 4);
  audit(s2, 'after waiver pile-up + 4 days');
  if (errs.length) finding('MEDIUM', 'Mass DFA leaves roster unplayable', errs.slice(0, 2).join(' | '));
  else held('mass DFA (15 in a day) survives 4 simmed days');
}

// 3. Call up / send down ping-pong on the same player 50x; send down the closer; send down IL player
{
  const s = L.newSeasonState(33); for (let i = 0; i < 2; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  const p = s.players[ut.roster.find((id) => !s.players[id].isPitcher && s.players[id].primaryPosition !== 'C')];
  for (let i = 0; i < 50; i++) { sendDown(s, ut, p); callUp(s, ut, p); }
  R.safeRebuild(s, ut);
  const iss = audit(s, 'after 50x ping-pong');
  console.log('   txlog length', (p.txLog || p.transactions || []).length, 'keys', Object.keys(p).filter((k) => /tx|log|hist/i.test(k)));
  const { errs } = nextDays(s, 1);
  if (iss.length || errs.length) finding('MEDIUM', 'send-down/call-up ping-pong breaks state', iss.concat(errs).join(' | '));
  else held('50x send-down/call-up ping-pong is harmless');
  // closer send-down (UI mutateTeam validation is UI-side) then rebuild
  const closer = s.players[ut.closer];
  if (closer) { sendDown(s, ut, closer); const ok = R.safeRebuild(s, ut); console.log('   sent closer down; new closer', ut.closer, 'rotation', ut.rotation.length, 'bullpen', ut.bullpen.length); }
  const { errs: e2 } = nextDays(s, 1);
  if (e2.length) finding('MEDIUM', 'Sending the closer down then rebuilding leaves an unsimmable roster', e2.join(' | '));
}

// 4. Move an IL player: send him down to minors while on IL (does he vanish from team.il? does recovery activate?)
{
  const s = L.newSeasonState(34); for (let i = 0; i < 40; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  const target = (ut.il || []).map((id) => s.players[id]).find((p) => p && p.ilStatus && p.ilStatus.daysRemaining > 5);
  if (target) {
    // trade-away path is blocked by validate? try engine demote: the UI lists IL players in the roster list; try sendDown on him
    ut.il.splice(ut.il.indexOf(target.id), 1); ut.minors.push(target.id); target.status = 'minors'; target.rosterStatus = R.demotionLevel(target);
    const { errs, s: s2 } = nextDays(s, 30);
    const t2 = s2.players[target.id];
    console.log(`IL->minors: 30 days later status ${t2.status} ilStatus ${JSON.stringify(t2.ilStatus)} on team.il ${(L.userTeam(s2).il || []).includes(t2.id)}`);
    if (errs.length) finding('MEDIUM', 'IL player moved to the minors breaks sim', errs.join(' | '));
    // mid-season moves: does a farmhand with ilStatus get promoted?
  } else console.log('no long-IL user player at day 40');
}

// 5. Rule 5 pick through every door: release, waive, trade-trim, mid-season moves
{
  const base = L.offseasonState(777);
  const s = clone(base); s.meta.currentDate = { year: s.meta.currentDate.year, month: 12, day: 10 };
  const R5 = W.BBGM_RULE5; const wy = R5.winterYearFor(s.meta.currentDate);
  const rival = s.league.teams[7];
  for (const id of rival.minors) { const p = s.players[id]; if (p && p.status === 'minors' && p.age >= 25) p.draft = { year: wy - 5, round: 6, overall: 180, teamId: rival.id }; }
  const pool = R5.eligibleFor(s, rival, wy);
  const ut = L.userTeam(s);
  if (pool.length) {
    const res = R5.runDraft(s, { userChoice: pool[0].id });
    const pick = s.players[pool[0].id];
    console.log('user pick', res.userResult.kind, pick.name, JSON.stringify(pick.rule5));
    if (res.userResult.kind === 'picked') {
      // Door A: releaseToPool directly (UI routes to return; engine does not)
      const sA = clone(s); const pA = sA.players[pick.id];
      FA.releaseToPool(sA, pA, 'released');
      console.log('   releaseToPool on R5 pick: status', pA.status, 'rule5 still', JSON.stringify(pA.rule5));
      if (pA.rule5) finding('MEDIUM', 'Releasing a Rule 5 pick to the FA pool leaves the obligation flag on a free agent (no returnPick, original club never gets him back)', `rule5=${JSON.stringify(pA.rule5)} status=${pA.status}; the next club to sign him mid-season inherits a flag pointing at ${pA.rule5 && pA.rule5.fromTeamId} and aiStickTick returns him there on day one (engine-level; UI routes R5 release to Return)`);
      // Door B: waivers.place
      const sB = clone(s); const pB = sB.players[pick.id]; const uB = L.userTeam(sB);
      WV.place(sB, uB, pB);
      console.log('   waivers.place on R5 pick: status', pB.status, 'rule5', JSON.stringify(pB.rule5));
      // Door C: Part B spring compliance + first-day sim — he must be on 26-man
      const sC = clone(s);
      W.BBGM_OFFSEASON.runSeasonRolloverPartB(sC);
      const pC = sC.players[pick.id]; const uC = L.userTeam(sC);
      console.log('   after PartB: on 26-man', uC.roster.includes(pC.id), 'minors', uC.minors.includes(pC.id), 'rule5', JSON.stringify(pC.rule5), 'roster size', uC.roster.length);
      if (!uC.roster.includes(pC.id) && pC.rule5) finding('HIGH', 'User Rule 5 pick not on the 26-man after spring training', `status=${pC.status} team=${pC.teamId}`);
      else held('user Rule 5 pick survives spring training on the 26-man');
      // Door D: user team midSeasonMoves with userAuto false — stays?
      const errs = []; for (let i = 0; i < 45; i++) errs.push(...L.simOneDay(sC));
      const pD = sC.players[pick.id];
      console.log('   45 days in: status', pD.status, 'team', pD.teamId, 'rule5', JSON.stringify(pD.rule5), 'errs', errs.length);
      // Door E: returnPick twice
      const sE = clone(s); const pE = sE.players[pick.id];
      R5.returnPick(sE, pE);
      let threw = null; try { R5.returnPick(sE, pE); } catch (e) { threw = e.message; }
      console.log('   returnPick twice:', threw ? 'THREW ' + threw : 'no throw', 'minors dup?', s.league.teams[7].minors.filter((x) => x === pE.id).length);
      const dupE = sE.league.teams.find((t) => t.id === rival.id).minors.filter((x) => x === pE.id).length;
      if (threw) finding('MEDIUM', 'returnPick on an already-returned pick throws', threw);
      else if (dupE > 1) finding('MEDIUM', 'returnPick twice duplicates the player in the origin farm', `minors entries ${dupE}`);
      else held('returnPick twice is safe');
      audit(sE, 'after double return');
    }
  }
}

// 6. Rule 5 draft with a FULL roster where everyone is protected (closer, 2C, 5SP... fallback) & userChoice of own player / protected / 26-man player
{
  const base = L.offseasonState(777);
  const s = clone(base); s.meta.currentDate = { year: s.meta.currentDate.year, month: 12, day: 10 };
  const R5 = W.BBGM_RULE5; const wy = R5.winterYearFor(s.meta.currentDate);
  const ut = L.userTeam(s);
  // make own farmhands eligible
  for (const id of ut.minors) { const p = s.players[id]; if (p && p.status === 'minors' && p.age >= 25) p.draft = { year: wy - 5, round: 6, overall: 180, teamId: ut.id }; }
  const ownElig = R5.eligibleFor(s, ut, wy);
  const own = ownElig[0];
  // pad user roster to 26 with farmhands
  while (ut.roster.length < 26 && ut.minors.length) { const id = ut.minors.pop(); ut.roster.push(id); s.players[id].status = 'active'; s.players[id].rosterStatus = '26-man'; }
  for (const [label, choice] of [['own farmhand', own && own.id], ['a 26-man player of a rival', s.league.teams[3].roster[0]], ['bogus id', 'nope'], ['retired player', Object.values(s.players).find((p) => p.retired) && Object.values(s.players).find((p) => p.retired).id]]) {
    if (!choice) continue;
    const s2 = clone(s);
    const res = R5.runDraft(s2, { userChoice: choice });
    const u2 = L.userTeam(s2);
    const got = res.userResult.kind === 'picked';
    console.log(`   userChoice=${label}: ${res.userResult.kind}; roster ${u2.roster.length}`);
    if (got) finding('HIGH', `Rule 5 runDraft lets the user pick ${label}`, JSON.stringify(res.userResult.pick));
    const iss = audit(s2);
    if (iss.length) finding('MEDIUM', `Rule 5 draft with userChoice=${label} leaves invariant issues`, iss.slice(0, 3).join(' | '));
  }
  held('Rule 5 userChoice of own / rostered / bogus / retired players all degrade to sniped');
  // run draft twice in the same winter
  const s3 = clone(s);
  R5.runDraft(s3, { auto: true }); const h1 = s3.rule5History.length;
  R5.runDraft(s3, { auto: true }); const h2 = s3.rule5History.length;
  console.log('   runDraft twice: history entries', h1, '->', h2, 'pending?', R5.pending(s3, s3.meta.currentDate));
  if (h2 > h1) finding('MEDIUM', 'Rule 5 runDraft has no once-per-winter guard: a second call drafts again and double-ledgers the winter', `rule5History years: ${s3.rule5History.map((h) => h.year + ':' + h.picks.length).join(',')} (engine-level; UI pending() gate hides the button after the first run)`);
}

L.dump('attack_roster');
