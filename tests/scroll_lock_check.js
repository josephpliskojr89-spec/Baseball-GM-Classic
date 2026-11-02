'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = require('path').join(__dirname, '..');
function findChrome() { const base = '/opt/pw-browsers'; for (const d of fs.readdirSync(base)) { if (!d.startsWith('chromium')) continue; for (const c of [path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome-linux64', 'chrome')]) if (fs.existsSync(c)) return c; } return null; }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => { const url = req.url.split('?')[0]; const file = path.join(ROOT, url === '/' ? 'index.html' : url.slice(1)); if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); });
(async () => {
  await new Promise((r) => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('#btnNewGame'); await page.click('#btnNewGame');
  await page.waitForSelector('.team-pick', { timeout: 120000 }); await page.locator('.team-pick').nth(7).click();
  await page.waitForSelector('#app:not(.hidden)'); await page.waitForTimeout(400);
  await page.click('.nav-btn[data-tab="team"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(200);
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator('#mainView .roster-row').nth(6).click(); await page.waitForTimeout(400);
  const locked = await page.evaluate(() => document.body.classList.contains('scroll-locked'));
  // try to scroll the page while the card is open (wheel + touch drag on the veil)
  await page.mouse.wheel(0, 600); await page.waitForTimeout(200);
  const yDuring = await page.evaluate(() => window.scrollY);
  // modal body scrolls internally
  const inner = await page.evaluate(() => { const b = document.querySelector('.modal-full .modal-body'); b.scrollTop = 500; return b.scrollTop; });
  await page.evaluate(() => window.BBGM_UI.closeModal()); await page.waitForTimeout(200);
  const yAfter = await page.evaluate(() => window.scrollY);
  const unlocked = await page.evaluate(() => !document.body.classList.contains('scroll-locked') && document.body.style.top === '');
  // tab switch resets to top
  await page.click('.nav-btn[data-tab="league"]'); await page.waitForTimeout(300);
  const yTab = await page.evaluate(() => window.scrollY);
  // progress + modal interplay: lock survives progress hide while modal open
  await page.evaluate(() => { window.BBGM_UI.showModal({ title: 'x', body: 'y', actions: [{ label: 'ok', kind: 'primary' }] }); window.BBGM_UI.showProgress('w'); window.BBGM_UI.hideProgress(); });
  const stillLocked = await page.evaluate(() => document.body.classList.contains('scroll-locked'));
  await page.evaluate(() => window.BBGM_UI.closeModal());
  const finallyUnlocked = await page.evaluate(() => !document.body.classList.contains('scroll-locked'));
  console.log(JSON.stringify({ y0, locked, yDuring, inner, yAfter, unlocked, yTab, stillLocked, finallyUnlocked, errors }));
  await browser.close(); server.close();
})();
