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
    return idbDelete().catch((e) => {
      console.error('Reset: failed to delete IndexedDB save:', e);
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
    return idbPut(state).catch((e) => {
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
    return idbGet()
      .catch((e) => {
        console.warn('IndexedDB load failed, checking legacy save:', e);
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
        return idbPut(legacy)
          .then(() => { clearLegacySave(); return state; })
          .catch((e) => {
            console.error('Legacy save migration to IndexedDB failed:', e);
            return state;
          });
      });
  }

  function hasSave() {
    return idbHasKey()
      .catch(() => false)
      .then((has) => has || !!readLegacySave());
  }

  function exportToFile() {
    if (!state) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bbgm-classic-${state.meta.userTeamId || 'save'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          state = obj;
          notify();
          // Persist BEFORE resolving: menu.js reloads the page on success,
          // and resolving on the debounced save path would race the reload
          // and load the previous save.
          idbPut(obj).then(() => resolve(obj)).catch(reject);
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
  };
})();
