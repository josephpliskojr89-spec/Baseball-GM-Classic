// State management: in-memory game state plus localStorage persistence.
window.BBGM_STATE = (function () {
  const STORAGE_KEY = 'bbgm-classic-save-v1';

  let state = null;
  let saveTimer = null;
  let saveBlocked = false;
  const subscribers = new Set();

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
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    notify();
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

  function saveNow() {
    if (!state) return;
    try {
      const json = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, json);
    } catch (e) {
      console.warn('Save failed:', e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      state = JSON.parse(raw);
      return state;
    } catch (e) {
      console.warn('Load failed:', e);
      return null;
    }
  }

  function hasSave() {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch (e) { return false; }
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
          set(obj);
          resolve(obj);
        } catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
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
    exportToFile, importFromFile, setSaveBlocked,
    getPlayer, getTeam, userTeam,
  };
})();
