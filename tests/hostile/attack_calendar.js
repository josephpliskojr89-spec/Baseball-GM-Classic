'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const OFF = W.BBGM_OFFSEASON, INTL = W.BBGM_INTL, R5 = W.BBGM_RULE5, FA = W.BBGM_FA;

// A. Part B twice
{
  const s = L.offseasonState(777); const s2 = clone(s);
  const nPlayers0 = Object.keys(s2.players).length; const hist0 = s2.history.seasons.length;
  OFF.runSeasonRolloverPartB(s2);
  const n1 = Object.keys(s2.players).length; const y1 = s2.meta.currentDate; const sch1 = s2.league.schedule.games.length;
  let threw = null;
  try { OFF.runSeasonRolloverPartB(s2); } catch (e) { threw = e.message; }
  const n2 = Object.keys(s2.players).length;
  console.log(`PartB twice: players ${nPlayers0}->${n1}->${n2}; date ${JSON.stringify(y1)} -> ${JSON.stringify(s2.meta.currentDate)}; history ${hist0}->${s2.history.seasons.length}; draftClass year ${s2.draftClass && s2.draftClass.year}; threw=${threw}`);
  if (threw) finding('MEDIUM', 'runSeasonRolloverPartB twice throws', threw);
  else if (n2 !== n1) finding('MEDIUM', 'runSeasonRolloverPartB is not idempotent: a second call re-runs spring (new org players generated again)', `players ${n1}->${n2}; (engine-level; UI startSeasonFlow is gated by offseasonPhase)`);
  const errs = L.simOneDay(s2); audit(s2, 'after PartB x2 + 1 day');
  if (errs.length) finding('HIGH', 'Day 1 after double Part B throws', errs.join(' | '));
}
// B. advanceFARound after Part B / before Part A
{
  const s = L.offseasonState(777); const s2 = clone(s);
  OFF.runSeasonRolloverPartB(s2);
  const r = OFF.advanceFARound(s2);
  console.log('advanceFARound after PartB:', JSON.stringify(r).slice(0, 80));
  const s3 = L.newSeasonState(5);
  const r3 = OFF.advanceFARound(s3);
  console.log('advanceFARound in-season (no market):', JSON.stringify(r3));
  held('advanceFARound out of phase is a no-op');
  // Part B without Part A (in-season)
  let threw = null; try { OFF.runSeasonRolloverPartB(s3); } catch (e) { threw = e.message; }
  console.log('PartB in-season (no history):', threw ? 'THREW ' + threw : 'ran!');
  if (!threw) finding('MEDIUM', 'runSeasonRolloverPartB runs mid-season with no prior Part A', 'engine-level');
  // Part A twice
  const s4 = L.seasonEndState(777); const s5 = clone(s4);
  OFF.runSeasonRolloverPartA(s5);
  let threwA = null; try { OFF.runSeasonRolloverPartA(s5); } catch (e) { threwA = e.message; }
  console.log('PartA twice:', threwA ? 'THREW ' + threwA : `ran; history seasons ${s5.history.seasons.map((h) => h.year).join(',')}; newFAs`, s5.faMarket && s5.faMarket.entries.length);
  if (!threwA && s5.history.seasons.length > 1) finding('MEDIUM', 'runSeasonRolloverPartA twice double-archives the season and double-ticks contracts', `history years ${s5.history.seasons.map((h) => h.year).join(',')} (engine-level; UI confirmOffseason gated by postseason.phase)`);
}
// C. Intl window twice; autoRunWindow after close; closeWindow on empty class; ensureClass loop
{
  const s = L.offseasonState(777); const s2 = clone(s);
  s2.meta.currentDate = { year: s2.meta.currentDate.year + 1, month: 1, day: 15 };
  const ut = L.userTeam(s2);
  const m0 = ut.minors.length;
  INTL.autoRunWindow(s2);
  const m1 = ut.minors.length, h1 = (s2.intlHistory || []).length;
  let threw = null; try { INTL.autoRunWindow(s2); } catch (e) { threw = e.message; }
  const m2 = ut.minors.length, h2 = (s2.intlHistory || []).length;
  console.log(`intl window twice: minors ${m0}->${m1}->${m2}; history ${h1}->${h2}; threw=${threw}`);
  if (threw) finding('MEDIUM', 'autoRunWindow twice throws', threw);
  else if (h2 > h1) finding('MEDIUM', 'Intl window runs twice on the same class', 'engine-level');
  else held('a second intl window run on a completed class is a no-op');
  // ensureClass on day after: does the next class generate, and does running advanceWindow on it (phase scouting) work?
  INTL.ensureClass(s2, D.addDays(s2.meta.currentDate, 1));
  console.log('   next class:', s2.intl.year, s2.intl.phase);
  const s6 = clone(s2); let t6 = null; try { INTL.advanceWindow(s6); INTL.advanceWindow(s6); INTL.advanceWindow(s6); } catch (e) { t6 = e.message; }
  console.log('   advanceWindow x3 on a scouting-phase class (11 months early):', t6 ? 'THREW ' + t6 : `phase ${s6.intl.phase}, history ${s6.intlHistory.length}`);
  if (!t6 && s6.intl.phase === 'complete') finding('MEDIUM', 'advanceWindow has no date gate: a just-generated class can be resolved 11 months early', `class ${s6.intl.year} resolved on ${JSON.stringify(s6.meta.currentDate)} (engine-level; UI hub shows the button only when windowPending)`);
}
// D. Start the season from weird dates: Part B on Nov 15 (skip everything) -> Rule5 + intl both auto-run? Then simulate opening day.
{
  const s = L.offseasonState(777); const s2 = clone(s);
  console.log('offseason date', JSON.stringify(s2.meta.currentDate), 'intl', s2.intl && s2.intl.year, s2.intl && s2.intl.phase, 'rule5 pending', R5.pending(s2, s2.meta.currentDate));
  OFF.runSeasonRolloverPartB(s2);
  const wy = R5.winterYearFor(s.meta.currentDate);
  console.log('   after immediate PartB: rule5History', (s2.rule5History || []).map((h) => h.year + ':' + h.picks.length), 'intl', s2.intl.year, s2.intl.phase, 'intlHistory', (s2.intlHistory || []).map((h) => h.year), 'date', JSON.stringify(s2.meta.currentDate));
  const r5ok = (s2.rule5History || []).some((h) => h.year === wy);
  const intlOk = (s2.intlHistory || []).some((h) => h.year === s.meta.currentDate.year + 1);
  if (!r5ok || !intlOk) finding('HIGH', 'Starting the season straight from November skips a tentpole', `rule5 ${r5ok} intl ${intlOk}`);
  else held('Part B from Nov 15 backstops both the Rule 5 draft and the Jan 15 window');
  const errs = []; for (let i = 0; i < 3; i++) errs.push(...L.simOneDay(s2));
  console.log('   3 days in, errors', errs.length, 'intl now', s2.intl.year, s2.intl.phase);
  audit(s2, 'Nov->PartB->3 days');
  // Was the intl window's next class generated twice? check classes
}
// E. Date drift: set currentDate way past seasonEnd before postseason — sim loop guard?
{
  const s = L.seasonEndState(777); const s2 = clone(s);
  s2.meta.currentDate = { year: s2.meta.currentDate.year + 1, month: 2, day: 1 };
  let threw = null; try { OFF.runSeasonRolloverPartA(s2); } catch (e) { threw = e.stack.split('\n').slice(0, 3).join(' / '); }
  console.log('Part A with date Feb next year:', threw ? 'THREW ' + threw : `ok; year archived ${s2.history.seasons.slice(-1)[0].year}; faMarket ${!!s2.faMarket}; date ${JSON.stringify(s2.meta.currentDate)}`);
  if (threw) finding('MEDIUM', 'Part A throws with a drifted calendar', threw);
  else if (s2.history.seasons.slice(-1)[0].year !== s.meta.currentDate.year) finding('MEDIUM', 'Part A archives the season under the CALENDAR year, not the schedule year', `archived ${s2.history.seasons.slice(-1)[0].year} for a ${s.meta.currentDate.year} season`);
}
// F. Rollover with pending decisions referencing missing players / stale waivers / pendingTradeOffers referencing traded players
{
  const s = L.seasonEndState(777); const s2 = clone(s);
  s2.pendingDecisions = [{ kind: 'il-callup', playerId: 'ghost' }, { kind: 'il-return', playerId: L.userTeam(s2).roster[0] }];
  s2.pendingTradeOffers = [{ date: s2.meta.currentDate, teamId: 'xxx', give: ['nope'], get: ['nope2'] }];
  s2.waivers = [{ playerId: 'ghost2', fromTeamId: 'bos', placedDate: s2.meta.currentDate }];
  let threw = null; try { OFF.runSeasonRollover(s2); } catch (e) { threw = e.stack.split('\n').slice(0, 3).join(' / '); }
  console.log('rollover with garbage queues:', threw ? 'THREW ' + threw : 'ok');
  if (threw) finding('HIGH', 'Rollover throws on stale pendingDecisions/waivers entries', threw);
  else held('rollover tolerates ghost decision/waiver/offer entries');
}
// G. Schedule drift: seasonEnd reached with unplayed games (user skipped?). Set 20 games unplayed and run Part A.
{
  const s = L.seasonEndState(777); const s2 = clone(s);
  let n = 0; for (const g of s2.league.schedule.games) { if (n < 40 && g.played && g.date.month === 9) { g.played = false; g.result = null; n++; } }
  let threw = null; try { OFF.runSeasonRolloverPartA(s2); } catch (e) { threw = e.message; }
  console.log('Part A with 40 unplayed games:', threw ? 'THREW ' + threw : 'ok');
}
L.dump('attack_calendar');
