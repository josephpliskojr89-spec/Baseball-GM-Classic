// Inbox (0.37.0): the GM's mail — owner directives, scouting reports,
// rival GM trade pitches. This module is pure state bookkeeping; message
// GENERATION lives in main.js and the UI resolve paths, so headless
// harnesses never load or need it.
//
// Message shape: { id, date, from, subject, body, read, action, about }
//   action: null
//         | { type: 'trade', teamId, playerId }   → builder, preloaded
//         | { type: 'navigate', tab, opts }       → app navigation
//   about (0.63.0): optional playerId the letter is about — the inbox
//   modal renders a guarded "View <name>" tap so any letter about a
//   player opens his card, without displacing the letter's own action.
window.BBGM_INBOX = (function () {
  const CAP = 60;

  function push(state, msg) {
    if (!state.inbox) state.inbox = [];
    if (!state.meta.nextInboxId) state.meta.nextInboxId = 1;
    state.inbox.unshift({
      id: 'msg' + state.meta.nextInboxId++,
      date: { ...state.meta.currentDate },
      from: msg.from,
      subject: msg.subject,
      body: msg.body,
      action: msg.action || null,
      about: msg.about || null,
      read: false,
    });
    // Cap the box: drop the oldest READ message first; only eat unread
    // mail when there's nothing read left to prune.
    while (state.inbox.length > CAP) {
      const reads = state.inbox.map((m) => m.read);
      const i = reads.lastIndexOf(true);
      state.inbox.splice(i >= 0 ? i : state.inbox.length - 1, 1);
    }
    return state.inbox[0];
  }

  function unread(state) {
    return (state.inbox || []).filter((m) => !m.read).length;
  }

  function markRead(state, id) {
    const m = (state.inbox || []).find((x) => x.id === id);
    if (m) m.read = true;
    return m;
  }

  function markAllRead(state) {
    for (const m of state.inbox || []) m.read = true;
  }

  return { push, unread, markRead, markAllRead };
})();
