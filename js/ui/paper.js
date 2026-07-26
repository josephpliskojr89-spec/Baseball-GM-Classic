// The NABL Ledger (0.73.0) — the league's weekly newspaper. Every
// Monday morning an edition composes itself from the last seven days of
// box scores, the standings, and the wire: players of the week, the big
// games, who's hot and who's buried. Four special editions bookend the
// season — preseason, the All-Star break, the World Series wrap, and
// the opening of the offseason. Pure synthesis: the paper stores only
// the finished edition (a few KB, replaced weekly); everything it
// prints already lives in the save.
window.BBGM_PAPER = (function () {
  const U = () => window.BBGM_UI;
  const D = () => window.BBGM_DATES;
  const R = () => window.BBGM_ROSTER;

  function paperState(state) {
    if (!state.paper) state.paper = { current: null, specials: [], flags: {} };
    if (!state.paper.flags) state.paper.flags = {};
    if (!state.paper.specials) state.paper.specials = [];
    return state.paper;
  }
  function teamOf(state, id) { return state.league.teams.find((t) => t.id === id); }
  function abbr(state, id) { const t = teamOf(state, id); return t ? t.abbr : '—'; }

  // ---- weekly composition ---------------------------------------------------

  function gamesInWindow(state, from, to) {
    const games = (state.league.schedule && state.league.schedule.games) || [];
    return games.filter((g) => g.played && g.result &&
      D().compare(g.date, from) >= 0 && D().compare(g.date, to) <= 0);
  }

  function aggregateWeek(games) {
    const bat = {}, pit = {};
    for (const g of games) {
      for (const side of ['home', 'away']) {
        const box = g.result.box && g.result.box[side];
        if (!box) continue;
        for (const row of box.batters || []) {
          const [pid, ab, r, h, b2, b3, hr, rbi, bb, k, sb] = row;
          const t = bat[pid] || (bat[pid] = { ab: 0, r: 0, h: 0, hr: 0, rbi: 0, bb: 0, sb: 0, g: 0 });
          t.ab += ab; t.r += r; t.h += h; t.hr += hr; t.rbi += rbi; t.bb += bb; t.sb += sb; t.g++;
        }
        for (const row of box.pitchers || []) {
          const [pid, ipOuts, h, r, er, bb, k] = row;
          const t = pit[pid] || (pit[pid] = { ipOuts: 0, h: 0, er: 0, bb: 0, k: 0, g: 0 });
          t.ipOuts += ipOuts; t.h += h; t.er += er; t.bb += bb; t.k += k; t.g++;
        }
      }
    }
    return { bat, pit };
  }

  function playersOfTheWeek(state, agg) {
    let hitter = null, hScore = -1;
    for (const pid in agg.bat) {
      const s = agg.bat[pid];
      const p = state.players[pid];
      if (!p || s.ab < 12) continue;
      const score = s.h + s.hr * 2.5 + s.rbi * 0.5 + s.bb * 0.4 + s.sb * 0.4;
      if (score > hScore) { hScore = score; hitter = { p, s }; }
    }
    let pitcher = null, pScore = -1;
    for (const pid in agg.pit) {
      const s = agg.pit[pid];
      const p = state.players[pid];
      if (!p || s.ipOuts < 15) continue;
      const score = (s.ipOuts / 3) * 1.1 + s.k - s.er * 2 - s.bb * 0.3;
      if (score > pScore) { pScore = score; pitcher = { p, s }; }
    }
    return { hitter, pitcher };
  }

  function bigGames(state, games) {
    const notes = [];
    for (const g of games) {
      const res = g.result;
      const margin = Math.abs((res.homeRuns || 0) - (res.awayRuns || 0));
      // Games carry homeId/awayId (0.73.1: the homeTeamId read printed
      // dashes where the clubs belonged).
      const ha = abbr(state, g.homeId), aa = abbr(state, g.awayId);
      const score = `${Math.max(res.homeRuns, res.awayRuns)}-${Math.min(res.homeRuns, res.awayRuns)}`;
      if ((res.innings || 9) >= 13) {
        notes.push({ text: `MARATHON: ${aa} and ${ha} played ${res.innings} innings on ` +
          `${D().format(g.date, 'date')} before it ended ${score}.`, gameId: g.gameId, w: 3 + res.innings });
      } else if (margin >= 10) {
        notes.push({ text: `LAUGHER: ${res.homeRuns > res.awayRuns ? ha : aa} buried ` +
          `${res.homeRuns > res.awayRuns ? aa : ha} ${score} on ${D().format(g.date, 'date')}.`,
          gameId: g.gameId, w: margin });
      }
      for (const side of ['home', 'away']) {
        const box = res.box && res.box[side];
        if (!box) continue;
        for (const row of box.pitchers || []) {
          const p = state.players[row[0]];
          if (p && row[6] >= 12) {
            notes.push({ text: `${p.name} punched out ${row[6]} over ` +
              `${(row[1] / 3).toFixed(1)} innings on ${D().format(g.date, 'date')}.`,
              gameId: g.gameId, playerId: p.id, w: row[6] });
          }
        }
        for (const row of box.batters || []) {
          const p = state.players[row[0]];
          if (p && row[6] >= 3) {
            notes.push({ text: `${p.name} went deep ${row[6]} times in one game ` +
              `on ${D().format(g.date, 'date')}.`, gameId: g.gameId, playerId: p.id, w: 10 + row[6] });
          }
        }
      }
    }
    return notes.sort((a, b) => b.w - a.w).slice(0, 4);
  }

  function hotAndCold(state) {
    const rated = state.league.teams.map((t) => {
      const lt = (t.seasonRecord && t.seasonRecord.lastTen) || [];
      // lastTen holds 'W'/'L' strings — count WINS, not truthy entries
      // (0.73.1: filter(Boolean) made every club 10 of its last 10).
      const wins = lt.filter((r) => r === 'W' || r === 1 || r === true).length;
      return { t, wins, n: lt.length };
    }).filter((x) => x.n >= 6);
    if (!rated.length) return null;
    rated.sort((a, b) => b.wins - a.wins);
    return { hot: rated[0], cold: rated[rated.length - 1] };
  }

  function divisionPulse(state) {
    const byDiv = {};
    for (const t of state.league.teams) {
      const key = `${t.league} ${t.division}`;
      const w = t.seasonRecord ? t.seasonRecord.w : 0;
      if (!byDiv[key] || w > byDiv[key].w) byDiv[key] = { t, w, l: t.seasonRecord ? t.seasonRecord.l : 0 };
    }
    return Object.keys(byDiv).sort().map((k) =>
      `${k}: ${byDiv[k].t.abbr} (${byDiv[k].w}-${byDiv[k].l})`);
  }

  function fmtAvg(h, ab) { return ab > 0 ? ('.' + String(Math.round(h / ab * 1000)).padStart(3, '0')) : '—'; }
  function fmtEra(er, ipOuts) { return ipOuts > 0 ? (er * 27 / ipOuts).toFixed(2) : '—'; }

  function composeWeekly(state, today) {
    const from = D().addDays(today, -6);
    const games = gamesInWindow(state, from, today);
    if (games.length < 8) return null; // a real week of baseball or no paper
    const agg = aggregateWeek(games);
    const potw = playersOfTheWeek(state, agg);
    const notes = bigGames(state, games);
    const hc = hotAndCold(state);

    let headline = 'Another week in the books';
    if (hc && hc.hot.wins >= 8) headline = `${hc.hot.t.name} are the hottest team in baseball`;
    else if (potw.hitter && potw.hitter.s.hr >= 5) headline = `${potw.hitter.p.name} is carrying a lineup`;
    else if (notes.length && notes[0].w >= 13) headline = notes[0].text.split(':')[0] + ' in the week\'s wildest game';

    const sections = [];
    if (potw.hitter) {
      const s = potw.hitter.s;
      sections.push({ title: 'Player of the Week', playerId: potw.hitter.p.id,
        body: `${potw.hitter.p.name} (${abbr(state, potw.hitter.p.teamId)}) — ` +
          `hit ${fmtAvg(s.h, s.ab)} over ${s.g} games (${s.h}-for-${s.ab}) with ` +
          `${s.hr} HR and ${s.rbi} RBI.` });
    }
    if (potw.pitcher) {
      const s = potw.pitcher.s;
      sections.push({ title: 'Arm of the Week', playerId: potw.pitcher.p.id,
        body: `${potw.pitcher.p.name} (${abbr(state, potw.pitcher.p.teamId)}) — ` +
          `${(s.ipOuts / 3).toFixed(1)} IP, ${fmtEra(s.er, s.ipOuts)} ERA, ${s.k} strikeouts ` +
          `across ${s.g} appearance${s.g === 1 ? '' : 's'}.` });
    }
    if (hc) {
      sections.push({ title: 'Hot and Cold',
        body: `Burning: ${hc.hot.t.name}, ${hc.hot.wins} of their last ${hc.hot.n}. ` +
          `Freezing: ${hc.cold.t.name}, ${hc.cold.wins} of ${hc.cold.n}.` });
    }
    if (notes.length) {
      sections.push({ title: 'Around the League', items: notes.map((n) => n.text) });
    }
    const pulse = divisionPulse(state);
    if (pulse.length) sections.push({ title: 'The Races', items: pulse });

    return { kind: 'weekly', date: { ...today }, headline, sections };
  }

  // ---- special editions -----------------------------------------------------

  function seasonLeaders(state, year) {
    const lines = [];
    let bestAvg = null, bestHr = null, bestEra = null, bestK = null;
    for (const id in state.players) {
      const p = state.players[id];
      const s = p && p.stats && p.stats[year];
      if (!s || p.retired) continue;
      if (!p.isPitcher && (s.ab || 0) >= 250) {
        const avg = s.h / s.ab;
        if (!bestAvg || avg > bestAvg.v) bestAvg = { p, v: avg, txt: fmtAvg(s.h, s.ab) };
        if (!bestHr || (s.hr || 0) > bestHr.v) bestHr = { p, v: s.hr || 0, txt: `${s.hr} HR` };
      }
      if (p.isPitcher && (s.ipOuts || 0) >= 300) {
        const era = s.er * 27 / s.ipOuts;
        if (!bestEra || era < bestEra.v) bestEra = { p, v: era, txt: era.toFixed(2) + ' ERA' };
        if (!bestK || (s.k || 0) > bestK.v) bestK = { p, v: s.k || 0, txt: `${s.k} K` };
      }
    }
    for (const x of [bestAvg, bestHr, bestEra, bestK]) {
      if (x) lines.push(`${x.p.name} (${abbr(state, x.p.teamId)}) — ${x.txt}`);
    }
    return lines;
  }

  function composeSpecial(state, kind, extra = {}) {
    const today = state.meta.currentDate;
    const year = today.year;
    const sections = [];
    let headline = '';

    if (kind === 'preseason') {
      const strengthOf = (t) => {
        const r = t.roster.map((id) => state.players[id]).filter(Boolean);
        return r.length ? r.reduce((s, p) => s + R().overall(p), 0) / r.length : 0;
      };
      const ranked = state.league.teams.slice().sort((a, b) => strengthOf(b) - strengthOf(a));
      headline = `${ranked[0].name} open as the team to beat`;
      sections.push({ title: 'The Contenders',
        items: ranked.slice(0, 4).map((t, i) => `${i + 1}. ${t.name}`) });
      const SCOUT = window.BBGM_SCOUT;
      if (SCOUT && SCOUT.prospectRankings) {
        const top = (SCOUT.prospectRankings(state) || []).slice(0, 3)
          .map((row, i) => {
            const p = state.players[row.playerId || row.id];
            return p ? `${i + 1}. ${p.name} (${abbr(state, p.teamId)})` : null;
          }).filter(Boolean);
        if (top.length) sections.push({ title: 'Names to Learn', items: top });
      }
      const ut = teamOf(state, state.meta.userTeamId);
      if (ut) {
        const rank = ranked.indexOf(ut) + 1;
        sections.push({ title: 'Your Club',
          body: `The writers have the ${ut.name} ${rank <= 8 ? 'in the thick of it' :
            rank <= 20 ? 'somewhere in the middle' : 'rebuilding'} — ` +
            `${rank} of 30 on paper. Paper has never played an inning.` });
      }
    } else if (kind === 'midseason') {
      headline = 'The break is here — half a season in the books';
      const pulse = divisionPulse(state);
      if (pulse.length) sections.push({ title: 'Standings at the Break', items: pulse });
      const leaders = seasonLeaders(state, year);
      if (leaders.length) sections.push({ title: 'First-Half Leaders', items: leaders });
      if (extra.asgLine) sections.push({ title: 'The All-Star Game', body: extra.asgLine });
    } else if (kind === 'endseason') {
      const champ = extra.championId ? teamOf(state, extra.championId) : null;
      headline = champ ? `${champ.name} are champions of the NABL` : 'The season is over';
      if (champ) {
        sections.push({ title: 'The Title',
          body: `${champ.name} take the World Series` +
            (extra.seriesLine ? ` — ${extra.seriesLine}` : '.') });
      }
      const leaders = seasonLeaders(state, year);
      if (leaders.length) sections.push({ title: 'Season Leaders', items: leaders });
    } else if (kind === 'offseason') {
      headline = 'The market opens — winter is the second season';
      if (extra.awards && extra.awards.length) {
        sections.push({ title: 'Hardware', items: extra.awards });
      }
      const fa = (state.freeAgents || []).map((id) => state.players[id])
        .filter((p) => p && !p.retired)
        .sort((a, b) => R().overall(b) - R().overall(a)).slice(0, 5)
        .map((p) => `${p.name} (${p.primaryPosition}, ${p.age})`);
      if (fa.length) sections.push({ title: 'The Class', body: `Top of the market: ${fa.join(', ')}.` });
      if (extra.retired != null) {
        sections.push({ title: 'Hanging Them Up',
          body: `${extra.retired} players called it a career this winter.` });
      }
    }
    return { kind, date: { ...today }, headline, sections };
  }

  // ---- publication ----------------------------------------------------------

  const KIND_LABEL = { weekly: 'Monday Edition', preseason: 'Preseason Special',
    midseason: 'All-Star Special', endseason: 'World Series Special', offseason: 'Hot Stove Special' };

  function storeSpecial(state, edition) {
    const ps = paperState(state);
    ps.specials.push(edition);
    while (ps.specials.length > 5) ps.specials.shift();
    ps.current = edition;
    return edition;
  }

  // Daily hook (main.js simOneDay): the Monday edition plus the
  // preseason special. Returns the edition published today, or null.
  function dailyTick(state, today) {
    const ps = paperState(state);
    if (state.meta.offseasonPhase || state.postseason) return null;
    if (today.month === 4 && ps.flags.preseasonYear !== today.year) {
      ps.flags.preseasonYear = today.year;
      return storeSpecial(state, composeSpecial(state, 'preseason'));
    }
    if (D().dayName(today) !== 'Mon') return null;
    if (ps.lastWeekly && D().diffDays(ps.lastWeekly, today) < 7) return null;
    const edition = composeWeekly(state, today);
    if (!edition) return null;
    ps.lastWeekly = { ...today };
    ps.current = edition;
    return edition;
  }

  // ---- the broadsheet -------------------------------------------------------

  function show(state, edition) {
    const ed = edition || (state.paper && state.paper.current);
    if (!ed) {
      U().showToast('No edition on the newsstand yet — the first paper prints Monday.', 'info', 4000);
      return;
    }
    const serif = 'Georgia, "Times New Roman", serif';
    const body = window.BBGM_UI.el('div', { style: { 'font-family': serif } });
    const el = window.BBGM_UI.el;
    body.appendChild(el('div', {
      style: { 'text-align': 'center', 'border-bottom': '3px double currentColor',
        'padding-bottom': '6px', 'margin-bottom': '4px' },
    }, [
      el('div', { style: { 'font-size': '24px', 'font-weight': '700', 'letter-spacing': '1px' } },
        'The NABL Ledger'),
      el('div', { style: { 'font-size': '10px', 'letter-spacing': '2px', 'text-transform': 'uppercase' } },
        `${KIND_LABEL[ed.kind] || 'Edition'} • ${D().format(ed.date, 'long')} • Est. 1901`),
    ]));
    body.appendChild(el('div', {
      style: { 'font-size': '19px', 'font-weight': '700', 'line-height': '1.25', margin: '10px 0' },
    }, ed.headline));
    for (const sec of ed.sections || []) {
      body.appendChild(el('div', {
        style: { 'font-size': '11px', 'letter-spacing': '1.5px', 'text-transform': 'uppercase',
          'border-top': '1px solid currentColor', 'padding-top': '6px', 'margin-top': '10px',
          opacity: '0.7' },
      }, sec.title));
      if (sec.body) {
        const pAttrs = { style: { 'font-size': '13px', 'line-height': '1.45', margin: '4px 0' } };
        if (sec.playerId && state.players[sec.playerId]) {
          pAttrs.on = { click: () => window.BBGM_UI_PLAYER.show(sec.playerId) };
          pAttrs.style.cursor = 'pointer';
          pAttrs.style['text-decoration'] = 'underline';
          pAttrs.style['text-decoration-style'] = 'dotted';
        }
        body.appendChild(el('p', pAttrs, sec.body));
      }
      for (const item of sec.items || []) {
        body.appendChild(el('p', {
          style: { 'font-size': '13px', 'line-height': '1.4', margin: '3px 0 3px 10px' },
        }, '• ' + item));
      }
    }
    U().showModal({ title: '', body,
      actions: [{ label: 'Fold the Paper', kind: 'secondary', onClick: () => true }] });
  }

  return { composeWeekly, composeSpecial, dailyTick, storeSpecial, show, KIND_LABEL };
})();
