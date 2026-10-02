'use strict';
const { boot, newGame, waitIdle, modalText } = require('./browser_common.js');
const fs = require('fs');
const findings = [];
const F = (sev, title, detail) => { findings.push({ sev, title, detail }); console.log(`\n!! [${sev}] ${title}\n   ${detail}`); };
const H = (t) => { findings.push({ sev: 'HELD', title: t }); console.log('   ok  ' + t); };
(async () => {
  const { server, browser, page, errors } = await boot();
  await newGame(page);
  await page.click('#btnAdvance'); await waitIdle(page);
  const good = await page.evaluate(() => JSON.stringify(window.BBGM_STATE.get()));
  console.log('baseline save size MB', (good.length / 1048576).toFixed(1), 'errors so far', errors.length);
  const baseErr = errors.length;

  // Import helper: route through the real importFromFile via the splash Import button (filechooser).
  async function importJSON(text, name = 'save.json') {
    await page.reload(); await page.waitForSelector('#btnNewGame', { timeout: 30000 });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), page.click('#btnImportGame')]);
    await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForTimeout(2500);
    const toast = await page.locator('.toast, [class*=toast]').allTextContents().catch(() => []);
    const appShown = await page.evaluate(() => !document.getElementById('app').classList.contains('hidden'));
    const splash = await page.evaluate(() => !document.getElementById('splash').classList.contains('hidden'));
    return { toast: toast.join(' | ').slice(0, 200), appShown, splash, modal: await modalText(page) };
  }
  async function tryAdvance(n = 1) {
    for (let i = 0; i < n; i++) { const e0 = errors.length; await page.click('#btnAdvance').catch(() => {}); await waitIdle(page, 30000); }
    return { date: (await page.textContent('#hdrDate').catch(() => '?')).trim(), modal: await modalText(page) };
  }
  const mutate = (fn) => { const s = JSON.parse(good); fn(s); return JSON.stringify(s); };

  // ---- Save mutation imports ----
  const cases = [
    ['version 9.9.9', mutate((s) => { s.version = '9.9.9'; })],
    ['version 0.1.0', mutate((s) => { s.version = '0.1.0'; })],
    ['version 0.3.0 (oldest NABL, full migration chain)', mutate((s) => { s.version = '0.3.0'; })],
    ['version "garbage"', mutate((s) => { s.version = 'garbage'; })],
    ['truncated JSON', good.slice(0, good.length >> 1)],
    ['players referenced by rosters removed', mutate((s) => { const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); for (const id of t.roster.slice(0, 5)) delete s.players[id]; const r = s.league.teams[3]; for (const id of r.roster.slice(0, 3)) delete s.players[id]; })],
    ['NaN ratings via null', mutate((s) => { const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); for (const id of t.roster) { const p = s.players[id]; for (const k in p.ratings) p.ratings[k] = null; } })],
    ['delete state.intl', mutate((s) => { delete s.intl; })],
    ['delete state.staff', mutate((s) => { delete s.staff; })],
    ['delete state.history + freeAgents + news', mutate((s) => { delete s.history; delete s.freeAgents; delete s.news; })],
    ['empty players {}', mutate((s) => { s.players = {}; })],
    ['userTeamId bogus', mutate((s) => { s.meta.userTeamId = 'zzz'; })],
    ['currentDate garbage', mutate((s) => { s.meta.currentDate = { year: 'x', month: 99, day: -1 }; })],
    ['schedule games []', mutate((s) => { s.league.schedule.games = []; })],
    ['user roster [] (empty)', mutate((s) => { const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); t.minors.push(...t.roster); t.roster = []; })],
    ['contract years negative + salary NaN', mutate((s) => { for (const id in s.players) { s.players[id].contract = { years: -2, annualSalary: NaN, totalValue: null }; break; } })],
    ['age 300 / retired flags everywhere', mutate((s) => { let n = 0; for (const id in s.players) { if (n++ > 400) break; s.players[id].age = 300; } })],
  ];
  for (const [label, text] of cases) {
    const e0 = errors.length;
    let r;
    try { r = await importJSON(text, label.replace(/\W+/g, '_') + '.json'); } catch (e) { r = { toast: 'HARNESS ' + e.message }; }
    let adv = null;
    if (r.appShown) { try { adv = await tryAdvance(2); } catch (e) { adv = { date: 'ERR ' + e.message }; } }
    const newErrs = errors.slice(e0).map((x) => x.msg.slice(0, 140));
    const line = `import "${label}": toast=${r.toast || '-'} app=${r.appShown} modal=${(r.modal || '').slice(0, 90)} | advance: ${adv ? adv.date + ' modal=' + (adv.modal || '').slice(0, 90) : '-'} | errors: ${newErrs.length ? newErrs.slice(0, 2).join(' || ') : 'none'}`;
    console.log(line);
    if (r.appShown && newErrs.length) F('HIGH', `Import of mutated save (${label}) is accepted and then throws`, line);
    else if (!r.appShown && !/Import failed|newer version|predates|missing|does not look/i.test(r.toast + (r.modal || '')) && !/Save Update Failed|Old Save/i.test(r.modal || '')) F('MEDIUM', `Import of (${label}): no error surfaced and the app did not open`, line);
    else if (r.appShown && adv && /Simulation Error|Offseason Error|Save Update/i.test(adv.modal || '')) F('HIGH', `Import (${label}) accepted, then the first advance fails`, line);
    else H(`import "${label}" handled (${r.appShown ? 'opened and advanced' : 'rejected: ' + (r.toast || r.modal || '').slice(0, 80)})`);
  }
  // ---- In-session soft-lock probes via BBGM_STATE.set ----
  await page.reload(); await page.waitForSelector('#btnNewGame'); await importJSON(good, 'good.json');
  async function probe(label, fn, clicks = 3) {
    await page.reload(); await page.waitForSelector('#btnNewGame'); await importJSON(good, 'good.json');
    await page.evaluate(() => window.BBGM_UI.closeModal());
    const e0 = errors.length;
    const d0 = (await page.textContent('#hdrDate')).trim();
    await page.evaluate(fn);
    await page.evaluate(() => window.BBGM_MAIN.refresh());
    let last = null;
    for (let i = 0; i < clicks; i++) {
      await page.click('#btnAdvance').catch(() => {});
      await waitIdle(page, 30000);
      last = await modalText(page);
      // click the primary button in any modal to try to progress
      if (last) { const b = page.locator('.modal button.btn-primary, .modal .btn-primary').first(); if (await b.count()) await b.click().catch(() => {}); await waitIdle(page, 30000); }
    }
    const d1 = (await page.textContent('#hdrDate')).trim();
    const newErrs = errors.slice(e0).map((x) => x.msg.slice(0, 160));
    const advanced = d1 !== d0;
    const line = `${label}: date ${d0} -> ${d1}; last modal: ${(last || '-').slice(0, 120)}; errors: ${newErrs.slice(0, 2).join(' || ') || 'none'}`;
    console.log(line);
    if (!advanced && newErrs.length) F('CRITICAL', `SOFT-LOCK candidate: ${label} — calendar stuck and errors thrown`, line);
    else if (!advanced) F('HIGH', `SOFT-LOCK candidate: ${label} — calendar never moves after ${clicks} advances`, line);
    else if (newErrs.length) F('MEDIUM', `${label}: advanced but threw`, line);
    else H(`${label}: calendar moved`);
  }
  await probe('FA phase with faMarket deleted', () => { const s = window.BBGM_STATE.get(); s.meta.offseasonPhase = 'freeAgency'; s.faMarket = null; window.BBGM_STATE.set(s); });
  await probe('FA phase, faMarket present, entries referencing deleted players', () => { const s = window.BBGM_STATE.get(); s.meta.offseasonPhase = 'freeAgency'; s.faMarket = { round: 0, totalRounds: 8, entries: [{ playerId: 'ghost', askYears: 1, askAAV: 1, askTotal: 1, tier: 3, prefs: {} }], userOffers: [] }; window.BBGM_STATE.set(s); });
  await probe('pendingDecisions with ghost + non-IL player', () => { const s = window.BBGM_STATE.get(); const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); s.pendingDecisions = [{ kind: 'il-callup', playerId: 'ghost' }, { kind: 'il-return', playerId: t.roster[0] }, { kind: 'weird', playerId: t.roster[1] }]; window.BBGM_STATE.set(s); });
  await probe('pendingDecisions il-callup for IL player with EMPTY minors', () => { const s = window.BBGM_STATE.get(); const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); const pid = t.roster.pop(); const p = s.players[pid]; t.il = [pid]; p.ilStatus = { type: '10-day', daysRemaining: 10 }; p.currentInjury = { type: 'hamstring strain', ilType: '10-day' }; t.minors = []; s.pendingDecisions = [{ kind: 'il-callup', playerId: pid }]; window.BBGM_STATE.set(s); }, 4);
  await probe('date past seasonEnd, postseason object with phase "ds" but no series', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { ...s.league.schedule.seasonEnd, day: s.league.schedule.seasonEnd.day }; s.postseason = { phase: 'ds', series: [], games: [] }; window.BBGM_STATE.set(s); });
  await probe('date 2 months past seasonEnd, no postseason', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { year: s.league.schedule.seasonEnd.year, month: 12, day: 1 }; window.BBGM_STATE.set(s); });
  await probe('Dec 10 Rule 5 pending in-season (no offseason phase) with an empty pool', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { year: s.meta.currentDate.year, month: 12, day: 10 }; s.meta.offseasonPhase = 'freeAgency'; s.faMarket = { round: 0, totalRounds: 8, entries: [], userOffers: [] }; window.BBGM_STATE.set(s); }, 4);
  await probe('intl window pending with board emptied / prospects {}', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { year: s.meta.currentDate.year + 1, month: 1, day: 16 }; s.meta.offseasonPhase = 'freeAgency'; s.faMarket = { round: 0, totalRounds: 8, entries: [], userOffers: [] }; s.rule5History = [{ year: s.meta.currentDate.year - 1, picks: [], returns: [] }]; if (s.intl) { s.intl.year = s.meta.currentDate.year; s.intl.phase = 'scouting'; s.intl.board = []; s.intl.prospects = {}; } window.BBGM_STATE.set(s); }, 4);
  await probe('draft day pending with draftClass deleted', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { year: s.meta.currentDate.year, month: 6, day: 30 }; delete s.draftClass; delete s.draft; window.BBGM_STATE.set(s); }, 4);
  await probe('draft day pending, draftClass prospects emptied', () => { const s = window.BBGM_STATE.get(); s.meta.currentDate = { year: s.meta.currentDate.year, month: 6, day: 30 }; if (s.draftClass) { s.draftClass.prospects = {}; s.draftClass.board = []; } window.BBGM_STATE.set(s); }, 4);
  await probe('user team has 0 pitchers on the 26-man', () => { const s = window.BBGM_STATE.get(); const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); const keep = []; for (const id of t.roster) { if (s.players[id].isPitcher) { t.minors.push(id); s.players[id].status = 'minors'; } else keep.push(id); } t.roster = keep; window.BBGM_STATE.set(s); }, 3);
  await probe('every user player on the IL', () => { const s = window.BBGM_STATE.get(); const t = s.league.teams.find((x) => x.id === s.meta.userTeamId); t.il = t.roster.slice(); for (const id of t.roster) { s.players[id].ilStatus = { type: '60-day', daysRemaining: 60 }; s.players[id].currentInjury = { type: 'UCL tear', ilType: '60-day' }; } t.roster = []; window.BBGM_STATE.set(s); }, 3);
  await probe('waivers entry referencing ghost + user claim', () => { const s = window.BBGM_STATE.get(); s.waivers = [{ playerId: 'ghost', fromTeamId: 'bos', placedDate: s.meta.currentDate, userClaim: true }]; window.BBGM_STATE.set(s); }, 3);
  await probe('pendingTradeOffers with ghost players', () => { const s = window.BBGM_STATE.get(); s.pendingTradeOffers = [{ date: s.meta.currentDate, teamId: s.league.teams[2].id, give: ['ghost'], get: ['ghost2'], cash: 0 }]; window.BBGM_STATE.set(s); }, 2);

  fs.writeFileSync(__dirname + '/browser_save.findings.json', JSON.stringify({ findings, errors }, null, 2));
  await browser.close(); server.close();
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(1); });
