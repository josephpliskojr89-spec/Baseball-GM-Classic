'use strict';
const L = require('./load.js');
const { W, D, finding, held, audit, clone } = L;
const T = W.BBGM_TRADES, FA = W.BBGM_FA, R = W.BBGM_ROSTER, OFF = W.BBGM_OFFSEASON;
function sortedByValue(state, list) { return list.map((id) => state.players[id]).filter(Boolean).sort((a, b) => T.tradeValue(b) - T.tradeValue(a)); }

// 1. Cash-in farming: trade value for $20M cash repeatedly in-season; does payroll go negative / does the offset survive into the winter FA cap?
{
  const s = L.newSeasonState(2024); for (let i = 0; i < 3; i++) L.simOneDay(s);
  T.setPlayersRef(s.players);
  const ut = L.userTeam(s);
  const pr0 = FA.computePayroll(ut, s.players);
  let trades = 0, cashIn = 0;
  for (let round = 0; round < 60; round++) {
    const ai = s.league.teams[1 + (round % 29)];
    const mine = sortedByValue(s, ut.roster.concat(ut.minors));
    // give my best remaining player for their worst farmhand + $20M cash
    const give = [mine[0]];
    const theirs = sortedByValue(s, ai.minors);
    const get = [theirs[theirs.length - 1]];
    if (!get[0]) continue;
    const res = T.evaluateProposal(s, ai, give, get, 0, 20, 0, 0);
    if (res.verdict !== 'accept') continue;
    T.executeTrade(s, ut, give, ai, get, 0, 20, 0, 0); trades++; cashIn += 20;
    if (ut.roster.length < 20) break;
  }
  const pr1 = FA.computePayroll(ut, s.players);
  console.log(`cash farming: ${trades} trades, $${cashIn}M in; payroll ${pr0} -> ${pr1}; tradeCash ${JSON.stringify(ut.tradeCash)}`);
  if (pr1 < 0) finding('MEDIUM', 'Payroll goes NEGATIVE through repeated cash-in trades', `payroll ${pr0} -> ${pr1}M after ${trades} trades receiving $20M each (AI accepts cash as 0.6 TV/$M with no budget check on the AI side)`);
  // AI side: did any AI club's payroll + cash out exceed its budget?
  let over = 0; for (const t of s.league.teams) { if (t.id === ut.id) continue; const pr = FA.computePayroll(t, s.players); if (pr > t.payrollBase * 1.3) over++; }
  console.log(`   AI clubs over 130% of budget after paying cash: ${over}`);
  // now carry into the winter: sim to season end + Part A, check cap check uses tradeCash
  const errs = L.simToSeasonEnd(s);
  OFF.runSeasonRolloverPartA(s);
  const prW = FA.computePayroll(ut, s.players);
  console.log(`   winter payroll (with tradeCash offset still on the books): ${prW}; tradeCash ${JSON.stringify(ut.tradeCash)}; budget ${ut.payrollBase}`);
  // can we exceed budget via the offset?
  const entry = s.faMarket.entries.filter((e) => !e.signedTeamId).sort((a, b) => b.askAAV - a.askAAV)[0];
  const err = FA.makeUserOffer(s, entry.playerId, entry.askYears, entry.askTotal);
  const realPayroll = prW - ((ut.tradeCash.in || 0) - (ut.tradeCash.out || 0)) * -1;
  if (ut.tradeCash && ut.tradeCash.in > 0) finding('MEDIUM', 'In-season trade cash received offsets payroll THROUGH free agency (ledger resets only at Part B), so cash farmed in July enlarges the winter FA budget', `tradeCash=${JSON.stringify(ut.tradeCash)} still on the books at ${JSON.stringify(s.meta.currentDate)}; computePayroll=${prW} vs budget ${ut.payrollBase}; top-FA offer: ${err || 'ACCEPTED'}`);
}
// 2. Arbitration / renewal math on weird contracts: NaN salary, undefined contract, years 0 after extension garbage -> rollover
{
  const s = L.seasonEndState(777); const s2 = clone(s);
  const ut = L.userTeam(s2);
  const ids = ut.roster.slice(0, 6);
  s2.players[ids[0]].contract = { years: 1, annualSalary: NaN, totalValue: NaN, signedAt: 'FA' };
  s2.players[ids[1]].contract = { years: 0, annualSalary: 5, totalValue: 0, signedAt: 'extension' };
  s2.players[ids[2]].contract = null;
  s2.players[ids[3]].contract = { years: 1, annualSalary: -3, totalValue: -3, signedAt: 'FA' };
  s2.players[ids[4]].contract = { years: 1.5, annualSalary: 2, totalValue: 3, signedAt: 'FA' };
  s2.players[ids[5]].serviceTime = { years: NaN, days: NaN };
  let threw = null; try { OFF.runSeasonRollover(s2); } catch (e) { threw = e.stack.split('\n').slice(0, 3).join(' / '); }
  console.log('rollover with garbage contracts:', threw ? 'THREW ' + threw : 'ok');
  if (threw) finding('MEDIUM', 'Rollover throws on a malformed contract (NaN/null/negative)', threw + ' (UI snapshot/restore would catch; save stuck in offseason)');
  else {
    for (const id of ids) { const p = s2.players[id]; console.log(`   ${p.name}: ${p.status} ${JSON.stringify(p.contract)} svc ${JSON.stringify(p.serviceTime)}`); }
    const nanP = Object.values(s2.players).filter((p) => p.contract && (!Number.isFinite(p.contract.annualSalary) || !Number.isFinite(p.contract.years)));
    if (nanP.length) finding('MEDIUM', 'NaN contracts survive the rollover untouched (no sanitization)', nanP.map((p) => `${p.name} ${JSON.stringify(p.contract)} ${p.status}`).join(' | '));
    const pr = FA.computePayroll(ut, s2.players);
    console.log('   user payroll now', pr);
    if (!Number.isFinite(pr)) finding('MEDIUM', 'computePayroll returns NaN after a NaN contract — every FA cap check then passes (NaN > x is false)', `payroll=${pr}`);
  }
  const errs = []; try { OFF.runSeasonRolloverPartB; } catch (e) {}
}
// 3. Intl pool overspend loop across years: penalties compound? restricted flag respected by AI? pool goes to 0 -> buyExtraLook/ userSign still?
{
  const s = L.offseasonState(777); const s2 = clone(s);
  const INTL = W.BBGM_INTL;
  s2.meta.currentDate = { year: s2.meta.currentDate.year + 1, month: 1, day: 15 };
  INTL.openWindow(s2); s2.intl.windowStep = 2;
  const ut = L.userTeam(s2);
  for (const pid of s2.intl.board.slice(0, 30)) INTL.userSign(s2, pid);
  INTL.advanceWindow(s2); INTL.advanceWindow(s2);
  console.log('year1 ledger', JSON.stringify(s2.intlLedger[ut.id]));
  INTL.ensureClass(s2, D.addDays(s2.meta.currentDate, 1));
  const b2 = s2.intl.budgets[ut.id];
  console.log('year2 budget', JSON.stringify(b2));
  // under restriction: sign everything under 0.3 — and what about ask > 0.3 via the AI tier? userOffers in step 1?
  INTL.openWindow(s2); s2.intl.windowStep = 2;
  let ok = 0, blocked = 0; for (const pid of s2.intl.board) { const r = INTL.userSign(s2, pid); if (r.signing) ok++; else blocked++; }
  console.log(`   restricted year: signed ${ok}, blocked ${blocked}; spent ${s2.intl.budgets[ut.id].spent} of pool ${s2.intl.budgets[ut.id].pool}`);
  // step-1 bidding under restriction: userOffers map bypasses the $300K rule?
  const s3 = clone(s); s3.meta.currentDate = { year: s3.meta.currentDate.year + 1, month: 1, day: 15 };
  const u3 = L.userTeam(s3);
  INTL.openWindow(s3); s3.intl.budgets[u3.id].restricted = true;
  s3.intl.userOffers = {}; for (const pid of s3.intl.board.slice(0, 10)) s3.intl.userOffers[pid] = 99;
  const r1 = INTL.advanceWindow(s3);
  const won = s3.intl.signings.filter((x) => x.teamId === u3.id);
  console.log(`   restricted + $99M bids on top 10 at step 1: won ${won.length} (${won.map((w) => '$' + w.bonus).join(',')})`);
  if (won.length) finding('HIGH', 'Signing restrictions ($300K cap) are bypassed by the step-1 bidding path: a restricted club wins top-10 prospects with big bids', `won ${won.length}: ${won.map((w) => w.name + ' $' + w.bonus + 'M').join(', ')}`);
  else held('step-1 bidding honors signing restrictions');
  // unrestricted: bid $99M (pool 6) on all top 10 — win all with no money?
  const s4 = clone(s); s4.meta.currentDate = { year: s4.meta.currentDate.year + 1, month: 1, day: 15 };
  const u4 = L.userTeam(s4); INTL.openWindow(s4);
  s4.intl.userOffers = {}; for (const pid of s4.intl.board.slice(0, 10)) s4.intl.userOffers[pid] = 99;
  INTL.advanceWindow(s4);
  const won4 = s4.intl.signings.filter((x) => x.teamId === u4.id);
  console.log(`   unrestricted $99M bids on top 10 with a $${s4.intl.budgets[u4.id].pool}M pool: won ${won4.length}, spent ${s4.intl.budgets[u4.id].spent}`);
  if (won4.length >= 5) finding('HIGH', 'Step-1 bids are not limited by pool money: bid $99M on all ten top prospects with a $6M pool and win them', `won ${won4.length} top-10 prospects, spent $${s4.intl.budgets[u4.id].spent}M vs pool $${s4.intl.budgets[u4.id].pool}M (UI offer buttons: check amt() caps)`);
}
// 4. Ops budget / scouting spend: BBGM_SCOUT buy loops
{
  const SC = W.BBGM_SCOUT;
  console.log('scout exports:', Object.keys(SC).join(','));
}
L.dump('attack_money');
