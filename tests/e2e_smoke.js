// E2E smoke (reborn in-repo v2.16.0): boots the real game in a real
// browser and walks the spine — new game, team select, a simmed day,
// the player card — plus the release's user-visible feature checks.
// The old 147-check walkthrough lived in ephemeral scratch storage and
// died with a container; this file is the new accreting base and it
// lives in the repo so that never happens again. Every release adds
// its checks here.
//
// Needs playwright resolvable (npm i playwright anywhere +
// NODE_PATH=<there>/node_modules, or a local install); the browser
// binary is found under /opt/pw-browsers automatically.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('✗ playwright not resolvable — npm i playwright and set NODE_PATH to its node_modules');
  process.exit(2);
}

function findChrome() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) {
    if (!d.startsWith('chromium')) continue;
    for (const cand of [path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome')]) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const file = path.join(ROOT, url === '/' ? 'index.html' : url.slice(1));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '✓ ' : '✗ ') + label); ok ? pass++ : fail++; };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // 1. Boot + splash.
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#btnNewGame', { timeout: 30000 });
  const splash = await page.textContent('#splash');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))) &&
    fs.readFileSync(path.join(ROOT, 'js/data/constants.js'), 'utf8').match(/VERSION: '([^']+)'/)[1];
  check(splash.includes(`v${version}`), `splash shows v${version}`);

  // 2. New game → team select → pick a club.
  await page.click('#btnNewGame');
  await page.waitForSelector('.team-pick', { timeout: 120000 });
  const nTeams = await page.locator('.team-pick').count();
  check(nTeams === 30, `team select lists all 30 clubs (${nTeams})`);
  await page.locator('.team-pick').first().click();
  await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
  const date0 = await page.textContent('#hdrDate');
  check(/Mar/.test(date0), `season opens on the calendar: ${date0.trim()}`);

  // 3. A simmed day moves the world.
  await page.click('#btnAdvance');
  await page.waitForFunction(() => !document.getElementById('btnAdvance').disabled, null, { timeout: 60000 });
  const date1 = await page.textContent('#hdrDate');
  check(date1 !== date0, `advance day moves the date: ${date1.trim()}`);

  // 4. Roster + the player card.
  await page.click('.nav-btn[data-tab="team"]');
  await page.waitForSelector('.roster-row', { timeout: 15000 });
  await page.locator('.roster-row').first().click();
  await page.waitForSelector('.modal', { timeout: 15000 });
  const cardText = await page.textContent('.modal');
  check(cardText.includes('Age') || cardText.includes('Born'), 'player card opens from the roster');
  await page.evaluate(() => window.BBGM_UI.closeModal());

  // 5. Personality traits (v2.16.0, §25): the card confesses only what
  // has been DISCOVERED — public knowledge, or your clubhouse's read
  // on your own man. The hidden truth prints nothing.
  const ids = await page.evaluate(() => {
    const s = window.BBGM_STATE.get();
    const ut = s.league.teams.find((t) => t.id === s.meta.userTeamId);
    const rival = s.league.teams.find((t) => t.id !== s.meta.userTeamId);
    const mine = s.players[ut.roster[0]];
    const theirs = s.players[rival.roster[0]];
    mine.hidden.trait = 'big_game'; mine.hidden.traitReveal = 'org';
    theirs.hidden.trait = 'mercenary'; theirs.hidden.traitReveal = 'org';
    window.BBGM_STATE.set(s);
    return { mine: mine.id, theirs: theirs.id };
  });
  const cardHas = async (pid, needle) => {
    await page.evaluate((id) => window.BBGM_UI_PLAYER.show(id), pid);
    await page.waitForSelector('.modal', { timeout: 10000 });
    const t = await page.textContent('.modal');
    await page.evaluate(() => window.BBGM_UI.closeModal());
    return t.includes(needle);
  };
  check(await cardHas(ids.mine, 'Big-game player'),
    'org-revealed trait prints on YOUR OWN player\'s card');
  check(!(await cardHas(ids.theirs, 'Mercenary')),
    'a rival\'s org-level knowledge is NOT yours — his card stays quiet');
  await page.evaluate((id) => {
    const s = window.BBGM_STATE.get();
    s.players[id].hidden.traitReveal = 'public';
    window.BBGM_STATE.set(s);
  }, ids.theirs);
  check(await cardHas(ids.theirs, 'Mercenary — the money talks'),
    'a PUBLIC trait prints on anyone\'s card');
  await page.evaluate((id) => {
    const s = window.BBGM_STATE.get();
    s.players[id].hidden.traitReveal = null;
    window.BBGM_STATE.set(s);
  }, ids.mine);
  check(!(await cardHas(ids.mine, 'Big-game player')),
    'an undiscovered trait prints NOTHING — the card never confesses');

  // 6. The trait acts while hidden (the whole point).
  const octMod = await page.evaluate((id) => {
    const s = window.BBGM_STATE.get();
    return window.BBGM_SIM.makeupMod(
      { hidden: { trait: 'big_game', makeupGrade: 5 } },
      { postseason: true, date: s.meta.currentDate });
  }, ids.mine);
  check(octMod === 3, 'hidden Big-Game player still gets his October +3 in the live page');

  // 7. Rule 5 (v2.17.0, §26): fabricate December 10 and open the room.
  const r5pending = await page.evaluate(() => {
    const s = window.BBGM_STATE.get();
    s.meta.offseasonPhase = 'freeAgency';
    s.meta.currentDate = { year: s.meta.currentDate.year, month: 12, day: 10 };
    const rival = s.league.teams.find((t) => t.id !== s.meta.userTeamId);
    const pid = rival.minors.find((id) => s.players[id] && s.players[id].status === 'minors');
    s.players[pid].draft = { year: s.meta.currentDate.year - 5, round: 6, overall: 180, teamId: rival.id };
    window.BBGM_STATE.set(s);
    return window.BBGM_RULE5.pending(s, s.meta.currentDate);
  });
  check(r5pending, 'December 10 makes the Rule 5 draft pending');
  await page.evaluate(() => window.BBGM_MAIN.openRule5());
  await page.waitForSelector('.modal', { timeout: 10000 });
  const r5modal = await page.textContent('.modal');
  check(r5modal.includes('Rule 5 Draft') && r5modal.includes('26-man'),
    'the draft room opens with the obligation spelled out');
  await page.evaluate(() => {
    window.BBGM_UI.closeModal();
    const s = window.BBGM_STATE.get();
    s.meta.offseasonPhase = null;
    s.meta.currentDate = { year: s.meta.currentDate.year, month: 4, day: 2 };
    window.BBGM_STATE.set(s);
    window.BBGM_MAIN.refresh();
  });

  // 8. Inbox opens (the discovery organ).
  await page.click('.nav-btn[data-tab="home"]');
  await page.click('#btnInbox');
  await page.waitForSelector('.modal', { timeout: 10000 });
  check((await page.textContent('.modal')).includes('Inbox'), 'inbox opens');
  await page.evaluate(() => window.BBGM_UI.closeModal());

  check(pageErrors.length === 0, pageErrors.length ? `PAGE ERRORS: ${pageErrors[0]}` : 'no page errors');

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('✗ E2E CRASHED:', e); process.exit(1); });
