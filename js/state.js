// State management: in-memory game state plus IndexedDB persistence.
//
// Storage moved from localStorage to IndexedDB in 0.6.0. A measured
// end-of-season save is ~5 MB — right at the classic localStorage quota —
// and multi-season saves only grow. IndexedDB stores the state object via
// structured clone (no 5 MB string, far larger quota). Saves created under
// the old localStorage key are migrated transparently on first load.
//
// The persistence API is asynchronous: load(), hasSave(), reset(), and
// saveNow() return Promises. Save failures are surfaced through the
// onSaveError handler (main.js shows the user a loud warning) instead of
// being silently console.warn'd — a save that stops persisting mid-season
// must never look like everything is fine.
window.BBGM_STATE = (function () {
  const DB_NAME = 'bbgm-classic';
  const DB_VERSION = 1;
  const STORE = 'saves';
  const SAVE_KEY = 'main';
  // Pre-0.6.0 localStorage key. Read once for migration, then removed.
  const LEGACY_STORAGE_KEY = 'bbgm-classic-save-v1';

  let state = null;
  let saveTimer = null;
  let saveBlocked = false;
  let saveErrorHandler = null;
  const subscribers = new Set();

  // ---- IndexedDB plumbing ----
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB not available in this browser'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    // Allow a retry on the next call if opening failed.
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function idbPut(value) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, SAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    }));
  }

  function idbGet() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(SAVE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    }));
  }

  function idbHasKey() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getKey(SAVE_KEY);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    }));
  }

  function idbDelete() {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(SAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
    }));
  }

  // ---- Native shell storage (§24 stage 1) ---------------------------------
  // Inside the Capacitor Android shell the save lives as a real file in
  // app-private storage (Directory.Data) instead of IndexedDB — the OS
  // protects files like documents, while IndexedDB is evictable cache
  // the browser may wipe under storage pressure. The four primitives
  // below dispatch on the runtime; in any browser this whole branch is
  // dead code and persistence is byte-identical to before.
  const SAVE_FILE = 'bbgm-classic-save.json';
  function nativeFS() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.Filesystem) || null;
  }

  // Native saves are gzip-compressed (v2.18.0): a 25-year dynasty's JSON
  // reached 20.6 MB against Android Auto Backup's 25 MB cap; gzip runs
  // ~4-5x smaller. The file is written as base64 of the gzip bytes and
  // read back by sniffing: gzip magic → inflate, otherwise plain JSON
  // (every pre-2.18.0 save). Any compression failure falls back to
  // plain JSON — the save is never lost to a missing API.
  function gzipText(text) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(new TextEncoder().encode(text));
      writer.close();
      return new Response(cs.readable).arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      }).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }

  function gunzipBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).text();
  }

  function isGzipBase64(s) {
    // 'H4sI' is the base64 of the gzip magic bytes 1f 8b 08.
    return typeof s === 'string' && s.startsWith('H4sI');
  }

  function storePut(value) {
    const fs = nativeFS();
    if (!fs) return idbPut(value);
    const json = JSON.stringify(value);
    return gzipText(json).then((b64) => fs.writeFile({
      path: SAVE_FILE, directory: 'DATA', encoding: 'utf8',
      data: b64 || json,
    }));
  }

  function storeGet() {
    const fs = nativeFS();
    if (!fs) return idbGet();
    return fs.readFile({ path: SAVE_FILE, directory: 'DATA', encoding: 'utf8' })
      .then((res) => {
        const raw = res && res.data;
        if (!raw) return null;
        const parse = (text) => {
          try { return JSON.parse(text); }
          catch (e) { throw new Error('Native save file is corrupted: ' + e.message); }
        };
        if (isGzipBase64(raw)) return gunzipBase64(raw).then(parse);
        return parse(raw);
      })
      .catch((e) => {
        // A missing file is "no save yet", not an error.
        if (String(e && e.message).toLowerCase().includes('does not exist') ||
            String(e && e.message).toLowerCase().includes('no such file')) return null;
        throw e;
      });
  }

  function storeHasKey() {
    const fs = nativeFS();
    if (!fs) return idbHasKey();
    return fs.stat({ path: SAVE_FILE, directory: 'DATA' })
      .then(() => true)
      .catch(() => false);
  }

  function storeDelete() {
    const fs = nativeFS();
    if (!fs) return idbDelete();
    return fs.deleteFile({ path: SAVE_FILE, directory: 'DATA' })
      .catch(() => {}); // deleting a save that isn't there is a no-op
  }

  function readLegacySave() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearLegacySave() {
    try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) {}
  }

  // ---- Public API ----
  function get() {
    return state;
  }

  function set(s) {
    state = s;
    notify();
    queueSave();
  }

  function reset() {
    state = null;
    clearLegacySave();
    notify();
    return storeDelete().catch((e) => {
      console.error('Reset: failed to delete save:', e);
    });
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function notify() {
    for (const fn of subscribers) {
      try { fn(state); } catch (e) { console.error(e); }
    }
  }

  function queueSave() {
    if (saveBlocked) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  function setSaveBlocked(b) {
    saveBlocked = b;
    if (!b) queueSave();
  }

  // Register a handler invoked whenever a persistence write fails.
  function onSaveError(fn) {
    saveErrorHandler = fn;
  }

  function saveNow() {
    if (!state) return Promise.resolve();
    return storePut(state).catch((e) => {
      console.error('Save failed:', e);
      if (saveErrorHandler) {
        try { saveErrorHandler(e); } catch (err) { console.error(err); }
      }
    });
  }

  // Loads the save from IndexedDB. Falls back to (and migrates) a legacy
  // localStorage save if IndexedDB has none. Resolves to the state object
  // or null when no save exists.
  function load() {
    return storeGet()
      .catch((e) => {
        console.warn('Save load failed, checking legacy save:', e);
        return null;
      })
      .then((saved) => {
        if (saved) {
          state = saved;
          return state;
        }
        const legacy = readLegacySave();
        if (!legacy) return null;
        state = legacy;
        // Migrate: write to IndexedDB, then clear the localStorage copy to
        // free its quota. Keep the legacy copy if the write fails so the
        // user can't lose the save to a botched migration.
        return storePut(legacy)
          .then(() => { clearLegacySave(); return state; })
          .catch((e) => {
            console.error('Legacy save migration to IndexedDB failed:', e);
            return state;
          });
      });
  }

  function hasSave() {
    return storeHasKey()
      .catch(() => false)
      .then((has) => has || !!readLegacySave());
  }

  function exportToFile() {
    if (!state) return;
    // Compact stringify (0.46.0): pretty-printing inflated the export
    // ~2x — a late-career save became a 50MB+ string plus a Blob copy in
    // memory, a realistic mobile tab crash during the one operation that
    // protects the save. Guard the filename too: export is offered from
    // the save-failure modal, exactly when state may be damaged, and the
    // lifeline must not throw on a missing meta.
    const teamTag = (state.meta && state.meta.userTeamId) || 'save';
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bbgm-classic-${teamTag}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Pure structural check used by import (v2.18.0). Returns a message or
  // null. Deliberately strict about the things that make startGame or the
  // first simmed day throw; permissive about everything the migration
  // chain and the in-game heals already tolerate.
  function structuralSaveError(obj) {
    const d = obj && obj.meta && obj.meta.currentDate;
    const isInt = (x) => Number.isInteger(x);
    if (!d || !isInt(d.year) || !isInt(d.month) || !isInt(d.day) || d.month < 1 || d.month > 12 || d.day < 1 || d.day > 31) {
      return 'Save file has an unreadable calendar date';
    }
    const teams = obj.league && obj.league.teams;
    if (!Array.isArray(teams) || teams.length < 2 || teams.some((t) => !t || !t.id)) return 'Save file has no usable league';
    if (!obj.players || typeof obj.players !== 'object' || !Object.keys(obj.players).length) return 'Save file has no players';
    if (obj.meta.userTeamId != null && !teams.some((t) => t.id === obj.meta.userTeamId)) return 'Save file names a team that does not exist';
    const sched = obj.league.schedule;
    if (!sched || !Array.isArray(sched.games)) return 'Save file has no schedule';
    for (const t of teams) {
      if (!Array.isArray(t.roster)) return `Team ${t.abbr || t.id} has no roster`;
      const missing = t.roster.filter((id) => !obj.players[id]).length;
      if (missing > 0 && missing === t.roster.length) return `Team ${t.abbr || t.id}'s roster references players that are not in the file`;
      if (t.id === obj.meta.userTeamId && t.roster.length < 9) return 'Your club\'s roster is too short to field a lineup';
    }
    return null;
  }

  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (!obj || !obj.version || !obj.league || !obj.players) {
            reject(new Error('File does not look like a Baseball GM Classic save.'));
            return;
          }
          // Validate BEFORE persisting: importing used to overwrite the
          // existing (good) save first and only then hit the load-time
          // gates — a structurally broken or pre-NABL file destroyed the
          // save it replaced with nothing to fall back to.
          if (!obj.meta || !obj.meta.currentDate || !Array.isArray(obj.league.teams) ||
              !obj.league.teams.length || !obj.league.schedule) {
            reject(new Error('Save file is missing required sections — import aborted, your current save is untouched.'));
            return;
          }
          const v = String(obj.version).split('.').map((x) => parseInt(x, 10) || 0);
          const preNABL = (v[0] === 0 && v[1] < 3) ||
            obj.league.teams.some((t) => t.league === 'A' || t.league === 'B');
          if (preNABL) {
            reject(new Error('This save predates the fixed NABL league and cannot be imported — your current save is untouched.'));
            return;
          }
          // Forward-version guard (0.46.0): migrations only run forward. A
          // save from a NEWER app would import silently, get re-stamped
          // backward, and have its unknown fields mishandled on the next
          // rollover.
          const app = String(window.BBGM_CONSTANTS.VERSION).split('.').map((x) => parseInt(x, 10) || 0);
          if (v[0] > app[0] || (v[0] === app[0] && v[1] > app[1]) ||
              (v[0] === app[0] && v[1] === app[1] && (v[2] || 0) > (app[2] || 0))) {
            reject(new Error(`This save is from a newer version (v${obj.version}) than the app (v${window.BBGM_CONSTANTS.VERSION}) — update the app first, then import.`));
            return;
          }
          // Structural validation (v2.18.0, hostile QA): a file that parses
          // but can't be played used to be persisted and THEN blow up in
          // startGame — the good save was gone and the toast said "Import
          // failed". Nothing is written until the object can stand up.
          const structural = structuralSaveError(obj);
          if (structural) {
            reject(new Error(`${structural} — import aborted, your current save is untouched.`));
            return;
          }
          // Persist FIRST, swap the live state only on success (0.46.0):
          // swapping first meant a failed put left the session running an
          // unsaved import while disk still held the old save — a crash
          // silently reverted the player hours back. Persist-before-resolve
          // also beats menu.js's success reload racing the debounced save.
          storePut(obj).then(() => {
            state = obj;
            notify();
            resolve(obj);
          }).catch(reject);
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // ---- Simulation-stop settings (0.21.0) ----------------------------------
  // Which league events halt a sim run and hand the decision to the user
  // instead of the AI. Defaults are merged lazily so old saves and newly
  // added toggles both work without a migration. The game is as deep as
  // the player wants it: turn a stop off and the AI quietly handles that
  // event exactly as it did before 0.21.0.
  const SIM_STOP_DEFAULTS = {
    injury: true,      // IL injury on your club → you choose the call-up
    ilReturn: true,    // IL activation needing a send-down → you choose who
    dayToDay: false,   // minor day-to-day knocks (no roster move) → notice only
    tradeOffer: true,  // a rival GM sends you a trade offer
    deadline: true,    // heads-up 3 days before the July 31 trade deadline
    waiverWire: true,  // a claimable player (48+ OVR) hits the waiver wire
    promotion: true,   // a farmhand outplays a big-league roster spot (0.38.0)
    inboxMail: false,  // a letter lands in the inbox mid-run (0.63.0)
    weeklyPaper: true, // Monday morning: stop to read The NABL Ledger (0.73.0)
  };

  function simStops(s) {
    const st = s || state;
    return { ...SIM_STOP_DEFAULTS, ...((st && st.settings && st.settings.simStops) || {}) };
  }

  function setSimStop(s, key, value) {
    if (!s.settings) s.settings = {};
    if (!s.settings.simStops) s.settings.simStops = {};
    s.settings.simStops[key] = !!value;
  }

  // Helpers
  function getPlayer(id) {
    return state && state.players[id];
  }

  function getTeam(id) {
    return state && state.league.teams.find((t) => t.id === id);
  }

  function userTeam() {
    if (!state) return null;
    return getTeam(state.meta.userTeamId);
  }

  return {
    get, set, reset, subscribe, saveNow, load, hasSave,
    exportToFile, importFromFile, setSaveBlocked, onSaveError,
    getPlayer, getTeam, userTeam,
    simStops, setSimStop,
    // v2.18.0 test seams: import structural check + native save codec.
    structuralSaveError, gzipText, gunzipBase64, isGzipBase64,
  };
})();
