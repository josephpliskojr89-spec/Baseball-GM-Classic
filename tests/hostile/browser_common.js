'use strict';
const fs = require('fs'); const path = require('path'); const http = require('http');
const ROOT = '/home/user/Baseball-GM-Classic';
const { chromium } = require('playwright');
function findChrome() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of fs.readdirSync(base)) { if (!d.startsWith('chromium')) continue; for (const c of [path.join(base, d, 'chrome-linux', 'chrome'), path.join(base, d, 'chrome')]) if (fs.existsSync(c)) return c; }
  return null;
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.slice(1));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, () => r({ server, port: server.address().port })));
}
async function boot() {
  const { server, port } = await serve();
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', msg: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(0, 4).join(' / ') }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ kind: 'console', msg: m.text().slice(0, 300) }); });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#btnNewGame', { timeout: 30000 });
  return { server, browser, page, errors, port };
}
async function newGame(page) {
  await page.click('#btnNewGame');
  // "Erase & New" confirm may appear
  try { await page.waitForSelector('.modal', { timeout: 1500 }); const b = page.locator('.modal button', { hasText: 'Erase' }); if (await b.count()) await b.click(); } catch (e) {}
  await page.waitForSelector('.team-pick', { timeout: 120000 });
  await page.locator('.team-pick').first().click();
  await page.waitForSelector('#app:not(.hidden)', { timeout: 30000 });
}
async function waitIdle(page, t = 60000) { await page.waitForFunction(() => !document.getElementById('btnAdvance').disabled && !document.querySelector('#progress:not(.hidden)'), null, { timeout: t }).catch(() => {}); }
async function modalText(page) { const m = page.locator('.modal'); return (await m.count()) ? (await m.first().textContent()).replace(/\s+/g, ' ').slice(0, 300) : null; }
module.exports = { boot, newGame, waitIdle, modalText };
