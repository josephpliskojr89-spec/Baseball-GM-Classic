// Release lockstep checker (0.46.0 — audit wave 3).
//
//   node tools/version_lockstep.js
//
// Five sites must carry the same version every release, and two of them
// use different syntax than the others — which is exactly how the 0.43.0
// bump silently missed constants.js. This script fails loudly if ANY
// site disagrees, and also cross-checks the three parallel module lists
// (index.html script tags, service-worker JS_FILES, boot-guard
// REQUIRED_MODULES count). Run it before every ship.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let failures = 0;
const fail = (msg) => { console.error('✗ ' + msg); failures++; };
const ok = (msg) => console.log('✓ ' + msg);

// 1. The five version sites.
const constants = read('js/data/constants.js');
const sw = read('service-worker.js');
const html = read('index.html');
const menu = read('js/ui/menu.js');

const constVer = (constants.match(/VERSION:\s*'([^']+)'/) || [])[1];
const swVer = (sw.match(/const VERSION = '([^']+)'/) || [])[1];
const splashVer = (html.match(/<p class="version">v([^<]+)<\/p>/) || [])[1];
const buildVer = (menu.match(/const BUILD = 'v([0-9.]+)/) || [])[1];
// Require a leading digit: the release-instructions comment contains a
// literal "?v=..." that must not count as a stamp.
const stamps = [...new Set([...html.matchAll(/\?v=(\d[0-9.]*)/g)].map((m) => m[1]))];

if (!constVer) fail('constants.js VERSION not found');
if (!swVer) fail('service-worker.js VERSION not found');
if (!splashVer) fail('splash version text not found');
if (!buildVer) fail('menu.js BUILD not found');
if (stamps.length !== 1) fail(`index.html carries ${stamps.length} distinct ?v= values: ${stamps.join(', ')}`);

const canonical = swVer;
const sites = { 'constants.js VERSION': constVer, 'service-worker VERSION': swVer,
  'splash text': splashVer, 'menu BUILD': buildVer, 'index.html ?v=': stamps[0] };
let agree = true;
for (const [name, v] of Object.entries(sites)) {
  if (v !== canonical) { fail(`${name} = ${v} (expected ${canonical})`); agree = false; }
}
if (agree && canonical) ok(`all five version sites agree: ${canonical}`);

// 2. Stamped-URL counts: 43 JS scripts + 5 CSS links.
const scriptCount = (html.match(/<script src="js\/[^"]+\?v=/g) || []).length;
const cssCount = (html.match(/<link rel="stylesheet" href="css\/[^"]+\?v=/g) || []).length;
const swJs = (sw.match(/^\s*'js\//gm) || []).length;
const swCss = (sw.match(/^\s*'css\//gm) || []).length;
if (scriptCount !== swJs) fail(`index.html has ${scriptCount} stamped scripts but SW lists ${swJs}`);
else ok(`${scriptCount} JS files stamped and precached`);
if (cssCount !== swCss) fail(`index.html has ${cssCount} stamped stylesheets but SW lists ${swCss}`);
else ok(`${cssCount} CSS files stamped and precached`);

// 3. Boot guard module count matches the script tag count.
const guard = (html.match(/REQUIRED_MODULES = \[([^\]]+)\]/) || [])[1] || '';
const guardCount = (guard.match(/'/g) || []).length / 2;
if (guardCount !== scriptCount) {
  fail(`boot guard lists ${guardCount} modules but index.html loads ${scriptCount} scripts`);
} else ok(`boot guard tracks all ${guardCount} modules`);

console.log(failures ? `\n${failures} LOCKSTEP FAILURE(S)` : '\nlockstep OK');
process.exit(failures ? 1 : 0);
