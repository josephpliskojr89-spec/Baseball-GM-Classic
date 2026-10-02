'use strict';
const { boot, newGame, waitIdle, modalText } = require('./browser_common.js');
const fs = require('fs');
const DURATION = parseInt(process.argv[2] || '180', 10) * 1000;
(async () => {
  const { server, browser, page, errors } = await boot();
  await newGame(page);
  const ring = []; const log = (a) => { ring.push(a); if (ring.length > 20) ring.shift(); };
  const reports = []; let seenErr = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  const tabs = ['home', 'team', 'league', 'players', 'gm', 'draft', 'paper', 'games', 'menu', 'dashboard', 'frontoffice'];
  const t0 = Date.now(); let actions = 0;
  const pick = (arr) => arr[rnd(arr.length)];
  while (Date.now() - t0 < DURATION) {
    const r = Math.random();
    let desc = '';
    try {
      const modalOpen = await page.locator('.modal').count();
      if (modalOpen && r < 0.6) {
        const btns = page.locator('.modal button');
        const n = await btns.count();
        if (n) { const i = rnd(n); const label = (await btns.nth(i).textContent()).trim().slice(0, 40); desc = `modal btn "${label}"`;
          // never erase the game / start new game
          if (/Erase|Start New Game|Reset|Delete/i.test(label)) { desc += ' (skipped)'; await page.evaluate(() => window.BBGM_UI.closeModal()); }
          else await btns.nth(i).click({ timeout: 2000 }); }
        else { desc = 'closeModal'; await page.evaluate(() => window.BBGM_UI.closeModal()); }
      } else if (r < 0.12) {
        const tab = pick(tabs); desc = `nav ${tab}`;
        const b = page.locator(`.nav-btn[data-tab="${tab}"]`); if (await b.count()) await b.first().click({ timeout: 2000 }); else await page.evaluate((t) => window.BBGM_MAIN.navigate(t), tab);
      } else if (r < 0.30) {
        desc = 'advance'; await page.click('#btnAdvance', { timeout: 2000 });
        if (Math.random() < 0.4) { desc += ' (double-click)'; await page.click('#btnAdvance', { timeout: 2000, force: true }).catch(() => {}); }
      } else if (r < 0.36) {
        desc = 'simToNextEvent'; await page.evaluate(() => { const s = window.BBGM_STATE.get(); if (s.meta.offseasonPhase) window.BBGM_MAIN.advanceFAToEvent(); else window.BBGM_MAIN.simToNextEvent(); });
        if (Math.random() < 0.3) { desc += ' + advance during sim'; await page.click('#btnAdvance', { timeout: 1000, force: true }).catch(() => {}); }
      } else if (r < 0.40) {
        desc = 'simToEndOfMonth'; await page.evaluate(() => { const s = window.BBGM_STATE.get(); if (!s.meta.offseasonPhase) window.BBGM_MAIN.simToEndOfMonth(); });
      } else if (r < 0.70) {
        const rows = page.locator('#mainView .roster-row:visible, #mainView button:visible, #mainView .filter-chip:visible, #mainView .tab:visible');
        const n = await rows.count();
        if (n) { const i = rnd(n); const el = rows.nth(i); const label = ((await el.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 40); desc = `main click [${i}/${n}] "${label}"`;
          if (/Erase|New Game|Reset|Delete Save|Export|Import/i.test(label)) desc += ' (skipped)'; else await el.click({ timeout: 2000, force: true }); }
      } else if (r < 0.80) {
        desc = 'random player card'; await page.evaluate(() => { const s = window.BBGM_STATE.get(); const ids = Object.keys(s.players); window.BBGM_UI_PLAYER.show(ids[Math.floor(Math.random() * ids.length)]); });
      } else if (r < 0.86) {
        desc = 'inbox'; await page.click('#btnInbox', { timeout: 2000 });
      } else if (r < 0.92) {
        desc = 'scroll + random modal action'; await page.mouse.wheel(0, 400);
        const ab = page.locator('.modal button, .modal .roster-row'); const n = await ab.count(); if (n) await ab.nth(rnd(n)).click({ timeout: 2000, force: true });
      } else {
        desc = 'rapid tap x5'; for (let i = 0; i < 5; i++) { const els = page.locator('button:visible'); const n = await els.count(); if (n) await els.nth(rnd(n)).click({ timeout: 800, force: true }).catch(() => {}); }
      }
    } catch (e) { desc += ` [click failed: ${String(e.message).split('\n')[0].slice(0, 60)}]`; }
    actions++; log(desc);
    await waitIdle(page, 45000);
    // if the game got reset to splash, start a new game
    const onSplash = await page.evaluate(() => !document.getElementById('splash').classList.contains('hidden'));
    if (onSplash) { log('** back on splash — new game'); await newGame(page).catch(() => {}); }
    if (errors.length > seenErr) {
      for (const e of errors.slice(seenErr)) { reports.push({ error: e, lastActions: ring.slice() }); console.log(`\n!! ERROR after ${actions} actions: ${e.msg.slice(0, 200)}\n   ${e.stack || ''}\n   last actions: ${ring.slice(-8).join(' -> ')}`); }
      seenErr = errors.length;
    }
  }
  const date = (await page.textContent('#hdrDate').catch(() => '?')).trim();
  const st = await page.evaluate(() => { const s = window.BBGM_STATE.get(); return { date: s.meta.currentDate, phase: s.meta.offseasonPhase, pending: (s.pendingDecisions || []).length }; });
  console.log(`\nmonkey done: ${actions} actions, ${errors.length} errors, final ${date} ${JSON.stringify(st)}`);
  // soft-lock check: does advance move the calendar now?
  await page.evaluate(() => window.BBGM_UI.closeModal());
  const d0 = JSON.stringify(st.date);
  for (let i = 0; i < 4; i++) { await page.click('#btnAdvance').catch(() => {}); await waitIdle(page); const m = await modalText(page); if (m) { const b = page.locator('.modal .btn-primary').first(); if (await b.count()) await b.click().catch(() => {}); await waitIdle(page); } }
  const d1 = await page.evaluate(() => JSON.stringify(window.BBGM_STATE.get().meta.currentDate));
  console.log(`post-monkey advance: ${d0} -> ${d1} ${d0 === d1 ? 'STUCK?' : 'moves'}; modal: ${await modalText(page)}`);
  fs.writeFileSync(__dirname + '/browser_monkey.findings.json', JSON.stringify({ actions, reports, final: st, moved: d0 !== d1 }, null, 2));
  await browser.close(); server.close();
})().catch((e) => { console.error('HARNESS CRASH', e); process.exit(1); });
