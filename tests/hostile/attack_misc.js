'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const T = W.BBGM_TRADES, FA = W.BBGM_FA, R = W.BBGM_ROSTER, OFF = W.BBGM_OFFSEASON, R5 = W.BBGM_RULE5, INJ = W.BBGM_INJURIES;
const byV = (s, ids) => ids.map((id) => s.players[id]).filter(Boolean).sort((a, b) => T.tradeValue(b) - T.tradeValue(a));

// (i) Injured-player dump: does the AI value a 60-day IL player (season-ending) like a healthy one?
{
  const s = L.newSeasonState(808); for (let i = 0; i < 3; i++) L.simOneDay(s);
  T.setPlayersRef(s.players);
  const ut = L.userTeam(s);
  const star = byV(s, ut.roster)[0];
  const tvHealthy = T.tradeValue(star);
  let bestHealthy = null, bestHurt = null;
  const ai = s.league.teams[2];
  const theirs = byV(s, ai.roster.concat(ai.minors));
  const probe = (st, label) => {
    let got = null;
    for (const q of theirs) { const res = T.evaluateProposal(st, st.league.teams[2], [st.players[star.id]], [st.players[q.id]], 0, 0, 0, 0); if (res.verdict === 'accept') { got = q; break; } }
    return got;
  };
  bestHealthy = probe(s, 'healthy');
  const s2 = clone(s); T.setPlayersRef(s2.players);
  const p2 = s2.players[star.id];
  // season-ending injury: move to IL via engine
  INJ.placeOnIL(p2, { type: 'UCL tear', ilType: '60-day', careerAltering: true, daysOut: 400 }, s2.meta.currentDate);
  if (!p2.ilStatus) p2.ilStatus = { type: '60-day', daysRemaining: 400 };
  p2.ilStatus.daysRemaining = 400;
  const u2 = L.userTeam(s2); R.placeOnILWithMove(s2, u2, p2);
  const tvHurt = T.tradeValue(p2);
  bestHurt = probe(s2, 'hurt');
  console.log(`injured dump: ${star.name} ovr ${R.overall(star).toFixed(0)} TV healthy ${tvHealthy.toFixed(1)} vs 400-day IL ${tvHurt.toFixed(1)}; best return healthy=${bestHealthy && bestHealthy.name + ' TV' + T.tradeValue(bestHealthy).toFixed(1)} hurt=${bestHurt && bestHurt.name + ' TV' + T.tradeValue(bestHurt).toFixed(1)}`);
  if (tvHurt > tvHealthy * 0.8 && bestHurt && T.tradeValue(bestHurt) > tvHealthy * 0.7) finding('HIGH', 'Injury-blind trade valuation: a player with a season-ending (400-day) injury trades at ~full value', `${star.name}: TV healthy ${tvHealthy.toFixed(1)} vs injured ${tvHurt.toFixed(1)}; AI gives ${bestHurt.name} (TV ${T.tradeValue(bestHurt).toFixed(1)}) for him. UI: IL players are listed in the trade builder (orgOf includes team.il) so this is reachable from the Front Office.`);
  else held('injured players are discounted in trade value');
  // check the UI lists IL players for trading: trade builder uses roster+minors+il in orgOf but which lists are rendered?
}
// (e) Offseason FA signPlayer trim ignores Rule 5 picks and composition floors
{
  const s = L.offseasonState(777); const s2 = clone(s);
  s2.meta.currentDate = { year: s2.meta.currentDate.year, month: 12, day: 10 };
  const res = R5.runDraft(s2, { auto: true });
  const picks = res.picks.map((k) => k.playerId);
  console.log(`AI Rule 5 picks this winter: ${picks.length}`);
  let guard = 0; while (s2.faMarket.round < s2.faMarket.totalRounds && guard++ < 12) FA.resolveRound(s2);
  const demoted = picks.filter((id) => s2.players[id].status === 'minors' && s2.players[id].rule5);
  console.log(`   after FA rounds: ${demoted.length}/${picks.length} picks sit in the minors with a live flag (signPlayer's trim ignores rule5)`);
  if (demoted.length) finding('MEDIUM', 'FA signPlayer roster trim ignores the Rule 5 flag (unlike weakestDemotable): fresh picks get optioned to the farm by winter signings', `${demoted.length}/${picks.length} AI picks demoted before spring; springCompliance then "returns" them as if the club chose to (user picks are re-promoted). Also ignores 2-C/5-SP/closer floors.`);
}
// (a) readiness drift in-season: how often do AI clubs fail validateLeagueReadiness during a season (after IL moves)?
{
  const s = L.newSeasonState(909);
  let fails = 0, weeks = 0; const kinds = {};
  while (D.compare(s.meta.currentDate, s.league.schedule.seasonEnd) <= 0) {
    L.simOneDay(s);
    if (s.meta.currentDate.day % 7 === 0) { weeks++; try { W.BBGM_PLAYER_GEN.validateLeagueReadiness(s.league, s.players); } catch (e) { fails++; const k = e.message.replace(/Team \w+ \([^)]*\)/, 'T').replace(/\d+/g, 'N'); kinds[k] = (kinds[k] || 0) + 1; } }
  }
  console.log(`readiness fails ${fails}/${weeks} weekly checks:`, JSON.stringify(kinds));
  // sub-min salaries on 26-mans at season end
  let sub = 0; for (const t of s.league.teams) for (const id of t.roster) { const p = s.players[id]; if (p.contract && p.contract.annualSalary < 0.74) sub++; }
  console.log(`   26-man players under $0.74M at season end: ${sub}`);
  if (sub) finding('LOW', 'Called-up farmhands keep their sub-minimum minor-league salary on the 26-man', `${sub} players on 26-man rosters at season end earn < $0.74M (e.g. $0.3M); the bible's league minimum is not applied on promotion`);
}
// Waiver claim when user roster is full and the only demotable is the closer/C: userClaim path
{
  const s = L.newSeasonState(910); for (let i = 0; i < 2; i++) L.simOneDay(s);
  const ut = L.userTeam(s); const ai = s.league.teams[1];
  const victim = s.players[ai.roster[5]];
  W.BBGM_WAIVERS.place(s, ai, victim);
  W.BBGM_WAIVERS.userClaim(s, victim.id, true);
  for (let i = 0; i < 3; i++) L.simOneDay(s);
  console.log(`claim: ${victim.name} now on ${victim.teamId} status ${victim.status}; user roster ${ut.roster.length}`);
  audit(s, 'after user waiver claim');
  // claim my OWN waived player back? place by user, claim by user — engine filters fromTeamId
}
// Trade deadline day boundary: July 31 allowed? Aug 1 blocked. tradesAllowed uses month<8 only. OK.
// Draft: user drafts with no draft class / makePick twice
{
  const s = L.newSeasonState(911);
  s.meta.currentDate = { year: s.meta.currentDate.year, month: 6, day: 30 };
  W.BBGM_DRAFT.ensureClass(s, s.meta.currentDate);
  const DR = W.BBGM_DRAFT;
  let threw = null;
  try {
    DR.startDraft(s);
    const board = DR.availableBoard(s);
    const first = board[0] && (board[0].id || board[0].playerId || board[0]);
    const r1 = DR.makePick(s, first); const r2 = DR.makePick(s, first);
    console.log('makePick same prospect twice:', JSON.stringify(r1).slice(0, 80), '|', JSON.stringify(r2).slice(0, 80));
    const r3 = DR.makePick(s, 'ghost'); console.log('makePick ghost:', JSON.stringify(r3).slice(0, 80));
    // advance way past the end
    for (let i = 0; i < 400; i++) DR.advancePick(s);
    const recap = DR.completeDraft(s); const recap2 = DR.completeDraft(s);
    console.log('completeDraft twice ok; draftHistory', (s.draftHistory || []).length);
    if ((s.draftHistory || []).length > 1) finding('MEDIUM', 'completeDraft twice double-ledgers the draft', '');
  } catch (e) { threw = e.stack.split('\n').slice(0, 3).join(' / '); }
  if (threw) finding('MEDIUM', 'Draft API throws on repeated/garbage picks', threw);
  audit(s, 'after draft abuse');
}
L.dump('attack_misc');
