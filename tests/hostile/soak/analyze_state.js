const fs = require('fs');
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const MB = (s) => (s / 1048576).toFixed(2);
// 1. Size composition
console.log('=== SIZE: top-level keys');
const rows = Object.keys(st).map((k) => [k, JSON.stringify(st[k]).length]).sort((a, b) => b[1] - a[1]);
for (const [k, n] of rows.slice(0, 12)) console.log(`  ${k.padEnd(20)} ${MB(n)} MB`);
const players = Object.values(st.players);
const active = players.filter((p) => !p.retired), retired = players.filter((p) => p.retired);
const bytes = (arr) => arr.reduce((a, p) => a + JSON.stringify(p).length, 0);
console.log(`  players: ${players.length} total | active ${active.length} = ${MB(bytes(active))} MB | retired ${retired.length} = ${MB(bytes(retired))} MB`);
const fieldBytes = {};
for (const p of active) for (const k in p) fieldBytes[k] = (fieldBytes[k] || 0) + JSON.stringify(p[k]).length;
console.log('  active-player field bytes (top 10):');
for (const [k, n] of Object.entries(fieldBytes).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`    ${k.padEnd(18)} ${MB(n)} MB`);
const rfb = {};
for (const p of retired) for (const k in p) rfb[k] = (rfb[k] || 0) + JSON.stringify(p[k]).length;
console.log('  retired-player field bytes (top 6):');
for (const [k, n] of Object.entries(rfb).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${k.padEnd(18)} ${MB(n)} MB`);
// 2. Side balance
const ovr = (p) => { // rough: mean of core ratings (engine not loaded here) — use p.ovrCache? fall back
  const r = p.ratings || {}; const ks = p.isPitcher ? ['velocity','movement','control','stuff'] : ['contactVsR','contactVsL','powerVsR','powerVsL','discipline','defense','arm'];
  return ks.reduce((a, k) => a + (r[k] || 0), 0) / ks.length;
};
const bestCeil = (p) => { const c = (p.hidden && p.hidden.ceiling) || {}; const ks = p.isPitcher ? ['velocity','movement','control','stuff'] : ['contactVsR','contactVsL','powerVsR','powerVsL','discipline','defense','arm']; return Math.max(...ks.map((k) => c[k] || 0)); };
const avg = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
console.log('=== SIDE BALANCE (raw rating means, not engine OVR)');
for (const side of [false, true]) {
  const lbl = side ? 'pitchers' : 'hitters ';
  const act26 = active.filter((p) => p.isPitcher === side && p.rosterStatus === '26-man');
  const farm = active.filter((p) => p.isPitcher === side && p.status === 'minors');
  console.log(`  ${lbl}: 26-man n=${act26.length} mean ${avg(act26.map(ovr))} age ${avg(act26.map((p) => p.age))} | farm n=${farm.length} mean ${avg(farm.map(ovr))} bestCeil ${avg(farm.map(bestCeil))} age ${avg(farm.map((p) => p.age))}`);
  for (const yr of [2050, 2048, 2045, 2040]) {
    const cls = players.filter((p) => p.isPitcher === side && p.draft && p.draft.year === yr);
    const intl = players.filter((p) => p.isPitcher === side && p.intl && p.intl.year === yr);
    console.log(`    draft ${yr}: n=${cls.length} bestCeil ${avg(cls.map(bestCeil))} nowMean ${avg(cls.map(ovr))} retired ${cls.filter((p) => p.retired).length} | intl ${yr}: n=${intl.length} bestCeil ${avg(intl.map(bestCeil))}`);
  }
  const released = active.concat(retired).filter((p) => p.isPitcher === side && (p.txLog || []).some((t) => t.y >= 2041 && /Released|washout|released/i.test(t.t))).length;
  const retiredYoung = retired.filter((p) => p.isPitcher === side && p.retired && p.retired.age <= 28).length;
  console.log(`    released-tx players (2041+): ${released} | retired by 28: ${retiredYoung} | retired total: ${retired.filter((p) => p.isPitcher === side).length}`);
}
// 3. Stars by side (raw mean >= 60 proxy)
console.log('=== elite by side (raw mean >= 58 on 26-man):', 'hitters', active.filter((p) => !p.isPitcher && p.rosterStatus === '26-man' && ovr(p) >= 58).length, 'pitchers', active.filter((p) => p.isPitcher && p.rosterStatus === '26-man' && ovr(p) >= 58).length);
// 4. Rotation/bullpen overlap right now
let overlap = 0, closerRot = 0;
for (const t of st.league.teams) { const pen = new Set(t.bullpen || []); for (const id of t.rotation || []) { if (pen.has(id)) overlap++; if (t.closer === id) closerRot++; } }
console.log('=== rotation∩bullpen overlaps now:', overlap, '| closer in rotation:', closerRot);
console.log('=== rule5History entries:', (st.rule5History || []).length, '| intlHistory:', (st.intlHistory || []).length, '| news items:', (st.news || []).length, '| inbox:', (st.inbox || []).length);
