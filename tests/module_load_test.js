// Module load (foundation suite, reborn in-repo v2.16.0): every script
// index.html ships must evaluate cleanly in a bare sandbox and register
// its window.BBGM_* global. The script list is read from index.html
// itself, so a module added to the page without surviving this loader
// fails here before it fails a player.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const files = [...html.matchAll(/src="(js\/[^"?]+)/g)].map((m) => m[1]);
if (!files.length) { console.log('✗ NO MODULE SCRIPTS FOUND IN index.html'); process.exit(1); }

const sandbox = { window: {}, console, Math, JSON, Array, Object, Date,
  document: undefined, navigator: undefined };
vm.createContext(sandbox);
let failed = 0;
const before = () => Object.keys(sandbox.window).filter((k) => k.startsWith('BBGM_')).length;
for (const f of files) {
  const n0 = before();
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  } catch (e) {
    // UI modules may touch document at module scope; engines must not.
    const uiFile = f.startsWith('js/ui/') || f === 'js/main.js';
    if (!uiFile) {
      console.log(`✗ ${f} THREW AT LOAD: ${e.message}`);
      failed++;
      continue;
    }
  }
  const n1 = before();
  if (n1 <= n0 && !f.endsWith('main.js')) {
    console.log(`✗ ${f} registered no BBGM_* global`);
    failed++;
  }
}
const registered = before();
console.log(`${files.length} scripts on the page, ${registered} BBGM_* globals registered`);
for (const must of ['BBGM_CONSTANTS', 'BBGM_PLAYER_GEN', 'BBGM_SIM', 'BBGM_FA',
  'BBGM_INTL', 'BBGM_DRAFT', 'BBGM_OFFSEASON', 'BBGM_ROSTER', 'BBGM_SCOUT']) {
  if (!sandbox.window[must]) { console.log(`✗ MISSING CORE MODULE: ${must}`); failed++; }
}
console.log(failed ? `✗ ${failed} failures` : 'ALL modules evaluate and register cleanly');
process.exit(failed ? 1 : 0);
