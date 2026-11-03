// Import safety (v2.18.5, hostile QA round 2): a broken save file can
// never replace the good one. Runs the REAL importFromFile / restoreBackup
// path against a mocked native Filesystem (the Android shell's storage),
// with a sentinel good save on disk, and checks after every candidate
// that the sentinel is byte-identical. See tests/hostile/REPORT.md #1.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const files = [
  'js/data/constants.js', 'js/data/name_pools.js', 'js/data/intl_name_pools.js',
  'js/data/city_pools.js', 'js/data/teams.js', 'js/util/rng.js', 'js/util/dates.js',
  'js/state.js',
  'js/generation/ballparks.js', 'js/generation/league.js', 'js/generation/players.js',
  'js/engine/schedule.js', 'js/engine/stats.js', 'js/engine/injuries.js',
  'js/engine/fatigue.js', 'js/engine/roster.js', 'js/engine/progression.js',
  'js/engine/minors.js', 'js/engine/flavorleagues.js', 'js/engine/trades.js',
  'js/engine/freeagency.js', 'js/engine/waivers.js', 'js/engine/staff.js',
  'js/engine/scouting.js', 'js/engine/draft.js', 'js/engine/intl.js', 'js/engine/rule5.js',
  'js/engine/awards.js', 'js/engine/simulation.js', 'js/engine/standings.js',
  'js/engine/offseason.js',
];

// ---- Mocked Android shell storage ------------------------------------------
const disk = new Map();
const Filesystem = {
  writeFile: ({ path: p, data }) => { disk.set(p, data); return Promise.resolve(); },
  readFile: ({ path: p }) => disk.has(p) ? Promise.resolve({ data: disk.get(p) }) : Promise.reject(new Error('File does not exist')),
  stat: ({ path: p }) => disk.has(p) ? Promise.resolve({}) : Promise.reject(new Error('File does not exist')),
  deleteFile: ({ path: p }) => { disk.delete(p); return Promise.resolve(); },
};
class File { constructor(parts, name) { this.text = parts.join(''); this.name = name; } }
class FileReader {
  readAsText(file) { this.result = file.text; setTimeout(() => this.onload && this.onload(), 0); }
}
const sandbox = { window: {}, console, Math, JSON, Array, Object, Date, Promise, Number, String,
  CompressionStream, DecompressionStream, Response, TextEncoder, TextDecoder, Uint8Array,
  btoa, atob, setTimeout, clearTimeout, File, FileReader };
sandbox.window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem } };
sandbox.window.CompressionStream = CompressionStream;
sandbox.window.FileReader = FileReader;
vm.createContext(sandbox);
for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
const W = sandbox.window;
const ST = W.BBGM_STATE;
let pass = 0, fail = 0;
const check = (ok, label) => { console.log((ok ? '✓ ' : '✗ ') + label); ok ? pass++ : fail++; };
const MAIN = 'bbgm-classic-save.json', BACKUP = 'bbgm-classic-save.backup.json';

// ---- A healthy in-season save --------------------------------------------
const rng = W.BBGM_RNG.makeRng(4242);
const league = W.BBGM_LEAGUE_GEN.generate(rng);
const players = W.BBGM_PLAYER_GEN.generate(rng, league);
const schedule = W.BBGM_SCHEDULE.generate(rng, league, 2026);
const good = { version: W.BBGM_CONSTANTS.VERSION, meta: { seed: 4242, userTeamId: league.teams[0].id,
  currentDate: { year: 2026, month: 6, day: 10 }, gamesPlayedByTeam: {} },
  league: { teams: league.teams, schedule }, players, news: [], freeAgents: [], history: { seasons: [] } };
W.BBGM_STAFF.ensureStaff(good); W.BBGM_SCOUT.ensureTiers(good);
for (const t of league.teams) W.BBGM_ROSTER.safeRebuild(good, t);
const clone = (o) => JSON.parse(JSON.stringify(o));
const asFile = (o) => new File([JSON.stringify(o)], 'save.json');
const tryImport = async (o) => { try { await ST.importFromFile(asFile(o)); return null; } catch (e) { return String(e.message || e); } };

(async () => {
  // Sentinel: the good save lands on disk through the real import path.
  const err0 = await tryImport(good);
  check(err0 === null && disk.has(MAIN), `the healthy save imports (${err0 || 'ok'})`);
  const sentinel = disk.get(MAIN);
  check(ST.isGzipBase64(sentinel), 'native save on disk is gzip-compressed');

  // ---- Broken candidates: every one must be refused with disk untouched ----
  const aiTeam = good.league.teams[3];
  const candidates = [
    ['null player entry', (c) => { c.players['ghost'] = null; }],
    ['shapeless player entry', (c) => { c.players['blob'] = { name: 'Blob' }; }],
    ['player without ratings on a roster', (c) => { const id = aiTeam.roster[0]; delete c.players[id].ratings; }],
    ['pitcherless in-season roster', (c) => {
      const t = c.league.teams[3];
      t.roster = t.roster.filter((id) => !c.players[id].isPitcher);
      t.rotation = []; t.bullpen = [];
    }],
    ['roster of ghosts', (c) => { c.league.teams[4].roster = ['nobody1', 'nobody2', 'nobody3']; }],
    ['malformed postseason', (c) => { c.postseason = { phase: 'active', series: 'not-a-list' }; }],
    ['postseason with a null series', (c) => { c.postseason = { phase: 'active', series: [null], games: [] }; }],
    ['minors list that is a string', (c) => { c.league.teams[5].minors = 'AAA'; }],
    ['inbox that is an object', (c) => { c.inbox = { msg1: {} }; }],
    ['FA market without entries', (c) => { c.faMarket = { round: 0, userOffers: [] }; }],
    ['history that is an array', (c) => { c.history = []; }],
    ['user roster too short', (c) => { c.league.teams[0].roster = c.league.teams[0].roster.slice(0, 5); }],
    ['bad calendar', (c) => { c.meta.currentDate = { year: 'x', month: 99, day: -1 }; }],
  ];
  let refused = 0, untouched = 0;
  for (const [label, mutate] of candidates) {
    const c = clone(good);
    mutate(c);
    const err = await tryImport(c);
    const same = disk.get(MAIN) === sentinel;
    if (err) refused++;
    if (same) untouched++;
    if (!err || !same) console.log(`   ✗ ${label}: ${err ? 'refused' : 'ACCEPTED'}, disk ${same ? 'untouched' : 'CHANGED'}`);
  }
  check(refused === candidates.length, `every broken candidate is refused (${refused}/${candidates.length})`);
  check(untouched === candidates.length, `the good save on disk is byte-identical after every refusal (${untouched}/${candidates.length})`);
  check(!disk.has(BACKUP), 'no backup slot is written for a refused import');
  check(JSON.stringify(ST.get().meta.currentDate) === JSON.stringify(good.meta.currentDate), 'the live state still points at the good save');

  // ---- A valid second import: the replaced save goes to the backup slot ----
  const later = clone(good);
  later.meta.currentDate = { year: 2026, month: 8, day: 1 };
  const err1 = await tryImport(later);
  check(err1 === null && disk.get(MAIN) !== sentinel, `a valid import replaces the main save (${err1 || 'ok'})`);
  check(disk.get(BACKUP) === sentinel, 'the replaced save is in the backup slot, byte-identical');
  check(await ST.hasBackup(), 'hasBackup() sees the slot');
  check(ST.get().meta.currentDate.month === 8, 'the live state is the imported save');

  // ---- Restore: the backup comes back as the main save ----------------------
  await ST.restoreBackup();
  check(disk.get(MAIN) === sentinel, 'restoreBackup() puts the previous save back on disk');
  check(ST.get().meta.currentDate.month === 6, 'the live state is the restored save');

  // ---- A backup write failure aborts the import -----------------------------
  const realWrite = Filesystem.writeFile;
  Filesystem.writeFile = ({ path: p, data }) => p === BACKUP ? Promise.reject(new Error('disk full')) : realWrite({ path: p, data });
  const err2 = await tryImport(later);
  Filesystem.writeFile = realWrite;
  check(err2 && /back up/.test(err2) && disk.get(MAIN) === sentinel, `a failed backup write refuses the import and leaves the main save alone (${err2 && err2.slice(0, 40)}…)`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
