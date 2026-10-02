'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const FA = W.BBGM_FA, R = W.BBGM_ROSTER, INTL = W.BBGM_INTL, OFF = W.BBGM_OFFSEASON;

// ---------- FA makeUserOffer garbage ----------
{
  const base = L.offseasonState(777);
  const entry = base.faMarket.entries.filter((e) => !e.signedTeamId).sort((a, b) => b.askAAV - a.askAAV)[0];
  const cases = [
    ['years 0, total 10', 0, 10], ['years -1, total -10', -1, -10], ['years NaN', NaN, 10], ['total NaN', 3, NaN],
    ['years Infinity', Infinity, 10], ['total -5', 2, -5], ['total 0', 2, 0], ['years 99', 99, 500], ['years 2.5', 2.5, 10],
    ['string years "3"', '3', '30'], ['total 1e12 years 1e12', 1e12, 1e12], ['years 1 total 0.01', 1, 0.01],
  ];
  for (const [label, years, total] of cases) {
    const s = clone(base);
    const err = FA.makeUserOffer(s, entry.playerId, years, total);
    if (err) { console.log(`   ${label}: rejected (${err.slice(0, 60)})`); continue; }
    // force the user to win: run the rounds
    let signed = null;
    try {
      for (let i = 0; i < 12 && !signed; i++) {
        const sg = OFF.advanceFARound(s).signings.find((x) => x.isUser && x.entry.playerId === entry.playerId);
        if (sg) signed = sg;
      }
    } catch (e) { finding('CRITICAL', `makeUserOffer(${label}) accepted and the FA round then THROWS`, e.message); continue; }
    const p = s.players[entry.playerId];
    if (signed) {
      const c = p.contract;
      const bad = !(Number.isFinite(c.annualSalary) && c.annualSalary >= 0.74 && Number.isInteger(c.years) && c.years >= 1 && Number.isFinite(c.totalValue) && c.totalValue >= 0);
      finding(bad ? 'MEDIUM' : 'LOW', `makeUserOffer(${label}) accepted and the player SIGNED`, `contract=${JSON.stringify(c)} payroll=${FA.computePayroll(L.userTeam(s), s.players)} (engine-level: UI offers preset buttons; console-only)`);
    } else console.log(`   ${label}: offer stored but never won (offer ${JSON.stringify(s.faMarket.userOffers.find((o) => o.playerId === entry.playerId))})`);
  }
  // payroll cap bypass: offer stacking — many separate offers each under cap, all win
  {
    const s = clone(base);
    const ut = L.userTeam(s);
    const pr0 = FA.computePayroll(ut, s.players);
    const cap = ut.payrollBase;
    let placed = 0;
    for (const e of s.faMarket.entries.filter((x) => !x.signedTeamId).sort((a, b) => b.askAAV - a.askAAV)) {
      const err = FA.makeUserOffer(s, e.playerId, e.askYears, e.askTotal * 1.5);
      if (!err) placed++;
    }
    for (let i = 0; i < 12; i++) OFF.advanceFARound(s);
    const pr1 = FA.computePayroll(ut, s.players);
    console.log(`offer stacking: placed ${placed} offers; payroll ${pr0} -> ${pr1} vs base ${cap} (cap check only per-offer)`);
    if (pr1 > cap * 1.05 + 1) finding('HIGH', 'Payroll cap bypass by stacking FA offers: each offer is checked alone against current payroll, so N standing offers can all win', `payroll ${pr0} -> ${pr1}M vs budget ${cap}M (x${(pr1 / cap).toFixed(2)}); ${placed} offers placed in one round through the normal UI buttons`);
    else held('offer stacking does not blow the payroll budget');
    audit(s, 'after offer stacking');
  }
}

// ---------- offerExtension garbage ----------
{
  const base = L.newSeasonState(99);
  const ut = L.userTeam(base);
  const p0 = base.players[ut.roster.map((id) => base.players[id]).sort((a, b) => R.overall(b) - R.overall(a))[0].id];
  for (const [label, years, total] of [['years 0 total 1', 0, 1], ['years -3 total -300', -3, -300], ['years NaN', NaN, 50], ['years 99 total 1e6', 99, 1e6], ['years 1 total Infinity', 1, Infinity], ['years 2.5 total 50', 2.5, 50], ['years 1 total 0', 1, 0]]) {
    const s = clone(base); const p = s.players[p0.id];
    const err = FA.offerExtension(s, p, years, total);
    if (err) { console.log(`   ext ${label}: rejected (${err.slice(0, 50)})`); continue; }
    const c = p.contract;
    const bad = !(Number.isFinite(c.annualSalary) && c.annualSalary >= 0.74 && Number.isInteger(c.years) && c.years >= 1 && Number.isFinite(c.totalValue));
    finding(bad ? 'MEDIUM' : 'LOW', `offerExtension(${label}) signs`, `contract=${JSON.stringify(c)} (engine-level: UI offers preset buttons; console-only)`);
  }
  // Legit UI path: can an extension be used to DROP a player's salary (cheap contract trick)? Use the UI's ask.
  const s = clone(base); const p = s.players[p0.id];
  const talks = FA.extensionTalks(s, p);
  console.log(`ext talks for ${p.name} ovr ${R.overall(p).toFixed(0)} cur ${JSON.stringify(p.contract)} ask ${JSON.stringify(talks)}`);
  // Extension years are unlimited in the engine; UI? check later. Try years 8 at askAAV total.
  const err8 = FA.offerExtension(s, p, 8, talks.askAAV * 8 * 1.1);
  console.log('   8-year extension at 1.1x ask:', err8 || `signed ${JSON.stringify(p.contract)}`);
  // Does the user team payroll limit extensions at all?
  const s2 = clone(base); const u2 = L.userTeam(s2);
  let total = 0;
  for (const id of u2.roster) { const q = s2.players[id]; const t = FA.extensionTalks(s2, q); const e = FA.offerExtension(s2, q, t.askYears, t.askTotal * 1.2); if (!e) total += q.contract.annualSalary; }
  console.log(`   extend whole roster at 1.2x ask: payroll ${FA.computePayroll(u2, s2.players)} vs base ${u2.payrollBase}`);
  if (FA.computePayroll(u2, s2.players) > u2.payrollBase * 1.5) finding('MEDIUM', 'Extensions have no payroll/budget check — the whole roster can be extended at any price', `payroll ${FA.computePayroll(u2, s2.players)}M vs budget ${u2.payrollBase}M via the normal Extend button`);
}

// ---------- Intl window: userSign double-sign, overspend, step-1 signing ----------
{
  const base = L.offseasonState(777);
  const s = clone(base);
  s.meta.currentDate = { year: s.meta.currentDate.year + 1, month: 1, day: 15 };
  // Draft and ensure class
  console.log('intl present', !!s.intl, s.intl && s.intl.phase, s.intl && s.intl.year);
  if (!s.intl || s.intl.phase === 'complete') INTL.ensureClass(s, s.meta.currentDate);
  INTL.openWindow(s);
  const ut = L.userTeam(s);
  const b = s.intl.budgets[ut.id];
  console.log('user pool', JSON.stringify(b), 'windowStep', s.intl.windowStep);
  // sign at step 1 (UI only shows the button at step>=2)
  const top = s.intl.board[0];
  const r1 = INTL.userSign(s, top);
  console.log('userSign at step 1 on the #1 prospect:', JSON.stringify(r1).slice(0, 120));
  if (r1.signing) finding('MEDIUM', 'userSign works during window step 1 (the bidding phase) — the #1 prospect can be taken at slot ask before any bidding', `signed ${r1.signing.name} rank ${r1.signing.rank} for $${r1.signing.bonus}M ask (engine-level; the UI hides the Sign button until step 2)`);
  // double sign the same prospect
  const r2 = INTL.userSign(s, top);
  if (r2.signing) {
    const dup = ut.minors.filter((id) => id === r2.signing.prospectId || s.players[id] && s.players[id].name === r2.signing.name);
    finding('HIGH', 'userSign signs the SAME prospect twice: double bonus charged, duplicate roster entry', `spent now ${s.intl.budgets[ut.id].spent}; minors entries for him: ${dup.length}; signings ledger count: ${s.intl.signings.filter((x) => x.prospectId === top).length}`);
    audit(s, 'after double intl sign');
  } else held('double-signing the same intl prospect is refused');
  // overspend: sign the whole board
  const s3 = clone(base); s3.meta.currentDate = { year: s3.meta.currentDate.year + 1, month: 1, day: 15 };
  if (!s3.intl || s3.intl.phase === 'complete') INTL.ensureClass(s3, s3.meta.currentDate);
  INTL.openWindow(s3); s3.intl.windowStep = 2;
  const u3 = L.userTeam(s3); let n = 0;
  for (const pid of s3.intl.board.slice()) { const r = INTL.userSign(s3, pid); if (r.signing) n++; }
  const b3 = s3.intl.budgets[u3.id];
  console.log(`signed ${n} prospects; pool ${b3.pool} spent ${b3.spent}`);
  const recap = INTL.advanceWindow(s3); const recap2 = INTL.advanceWindow(s3);
  console.log('penalties:', JSON.stringify((s3.intl.recap || {}).penalties && s3.intl.recap.penalties.find((x) => x.teamId === u3.id)), 'ledger', JSON.stringify(s3.intlLedger[u3.id]));
  if (n > 20) finding('HIGH', 'No pool budget check in userSign: the user can sign the ENTIRE international class (' + n + ' prospects) for a one-time 50% pool penalty', `pool $${b3.pool}M, spent $${b3.spent}M (${Math.round(b3.spent / b3.pool * 100)}% of pool); every "Sign for $X" button in the hub works regardless of money; penalty: ${JSON.stringify(s3.intlLedger[u3.id])}`);
  audit(s3, 'after signing whole intl class');
  // minors size
  console.log('user minors size now', u3.minors.length);
  // buyExtraLook loop
  const s4 = clone(base); s4.meta.currentDate = { year: s4.meta.currentDate.year + 1, month: 1, day: 10 };
  if (!s4.intl || s4.intl.phase === 'complete') INTL.ensureClass(s4, s4.meta.currentDate);
  let bought = 0, last = null;
  for (let i = 0; i < 200; i++) { const r = INTL.buyExtraLook(s4, s4.intl.board[i % 20]); if (!r.ok) { last = r.reason; break; } bought++; }
  console.log(`buyExtraLook x${bought} then: ${last}; pool now ${JSON.stringify(s4.intl.budgets[L.userTeam(s4).id])}`);
}

// ---------- signMidSeason spam ----------
{
  const s = L.newSeasonState(55);
  for (let i = 0; i < 3; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  let n = 0;
  for (const id of (s.freeAgents || []).slice()) { if (!FA.signMidSeason(s, ut, id)) n++; }
  console.log(`signMidSeason: signed ${n} FAs to the farm; minors size ${ut.minors.length}`);
  const iss = audit(s, 'after FA farm spam');
  const errs = L.simOneDay(s);
  if (errs.length) finding('HIGH', 'Farm spam breaks the next day', errs.join(' | '));
  else if (n > 50) finding('LOW', `No cap on minor-league depth: user can sign every in-season FA (${n}) to the farm`, `minors size ${ut.minors.length}; no roster/payroll/40-man check in signMidSeason`);
  // sign a player that's already signed (stale card)
  const id = ut.minors[ut.minors.length - 1];
  const again = FA.signMidSeason(s, ut, id);
  console.log('re-sign already-signed:', again);
  // sign a retired / abroad / waivers player
  const w = Object.values(s.players).find((p) => p.status === 'waivers');
  if (w) console.log('sign waivers player:', FA.signMidSeason(s, ut, w.id));
}

// ---------- releaseToPool via engine on IL player / closer; waivers place of IL ----------
{
  const s = L.newSeasonState(55);
  for (let i = 0; i < 30; i++) L.simOneDay(s);
  const ut = L.userTeam(s);
  const WV = W.BBGM_WAIVERS;
  if ((ut.il || []).length) {
    const ilp = s.players[ut.il[0]];
    WV.place(s, ut, ilp);
    console.log('placed IL player on waivers:', ilp.status, 'ilStatus', !!ilp.ilStatus, 'on il', (ut.il || []).includes(ilp.id));
    for (let i = 0; i < 3; i++) L.simOneDay(s);
    const now = s.players[ilp.id];
    console.log('   3 days later: status', now.status, 'team', now.teamId, 'ilStatus', !!now.ilStatus);
    const t2 = s.league.teams.find((t) => t.id === now.teamId);
    if (t2 && t2.roster.includes(now.id) && now.ilStatus) finding('MEDIUM', 'An injured (IL) player placed on waivers is claimed onto the claimant\'s 26-man while still injured', `${now.name} ilStatus=${JSON.stringify(now.ilStatus)} on ${t2.abbr} 26-man (team.il=${(t2.il || []).includes(now.id)})`);
    audit(s, 'after waiving IL player');
  }
}
L.dump('attack_inputs');
