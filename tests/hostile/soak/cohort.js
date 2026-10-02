const fs = require('fs');
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const players = Object.values(st.players);
const sample = players.find((p) => p.ratingsHistory && Object.keys(p.ratingsHistory).length > 3);
console.log('ratingsHistory shape sample:', JSON.stringify(sample.ratingsHistory).slice(0, 300));
const HIT = ['contactVsR','contactVsL','powerVsR','powerVsL','discipline','speed','defense','arm'];
const PIT = ['velocity','movement','control','stuff','stamina'];
// cohort: genesis = no draft & no intl & no acquiredVia; pipeline-draft; pipeline-intl
const cohortOf = (p) => (p.draft && p.draft.year) ? 'draft' : (p.intl && p.intl.year) ? 'intl' : (p.acquiredVia ? 'other' : 'genesis');
// For each player, find the ratings snapshot at age 27 (birthYear known) from ratingsHistory keyed by year
function snapAt(p, targetAge) {
  const rh = p.ratingsHistory || {};
  for (const y of Object.keys(rh)) {
    const yr = parseInt(y, 10);
    const age = yr - p.birthYear;
    if (age === targetAge) return rh[y].ratings || rh[y];
  }
  return null;
}
for (const side of [false, true]) {
  const keys = side ? PIT : HIT;
  console.log(`\n=== ${side ? 'PITCHERS' : 'HITTERS'} — per-tool mean at age 27, by cohort (26-man-ever players)`);
  for (const coh of ['genesis', 'draft', 'intl']) {
    const grp = players.filter((p) => p.isPitcher === side && cohortOf(p) === coh && (p.serviceTime && p.serviceTime.years >= 1 || p.rosterStatus === '26-man'));
    const snaps = grp.map((p) => snapAt(p, 27)).filter(Boolean);
    if (!snaps.length) { console.log(`  ${coh}: no age-27 snapshots (n=${grp.length})`); continue; }
    const line = keys.map((k) => `${k} ${(snaps.reduce((a, s) => a + (s[k] || 0), 0) / snaps.length).toFixed(1)}`).join(' | ');
    console.log(`  ${coh.padEnd(8)} n=${snaps.length}: ${line}`);
  }
  // Also ceilings by cohort for all players (not just MLB)
  console.log(`  --- best-ceiling & mean-ceiling by cohort (all ${side ? 'pitchers' : 'hitters'}, excluding stamina/speed)`);
  for (const coh of ['genesis', 'draft', 'intl']) {
    const grp = players.filter((p) => p.isPitcher === side && cohortOf(p) === coh && p.hidden && p.hidden.ceiling);
    const ks = keys.filter((k) => k !== 'speed' && k !== 'stamina');
    const best = grp.map((p) => Math.max(...ks.map((k) => p.hidden.ceiling[k] || 0)));
    const mean = grp.map((p) => ks.reduce((a, k) => a + (p.hidden.ceiling[k] || 0), 0) / ks.length);
    const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    console.log(`  ${coh.padEnd(8)} n=${grp.length}: bestCeil ${avg(best)} meanCeil ${avg(mean)}`);
  }
}
