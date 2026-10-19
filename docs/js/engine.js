/*
 * Chester's Escape - game engine
 * Pure rules, no DOM. Runs in the browser (demo mode) and inside the
 * Cloudflare Worker (live mode), so both always play by the same rules.
 *
 * Board model
 *   board.spaces  { id: { id, x, y, type, kind?, bsr?, n?, turns?, to? } }
 *   board.routes  { longer: [ids...], riskier: [ids...] }  (each ends on the exit)
 *   board.starts  { longer: {x,y,label}, riskier: {x,y,label} }
 *   A player's position is an index into their route. -1 means the start marker.
 *
 * Space types
 *   map    play a map (bsr: one or more keys, any one counts)
 *   task   event that blocks until its map is played ("Chased by a cat! !bsr 20848 to continue")
 *   card   draw a card
 *   move   move n spaces (n can be negative)
 *   skip   lose `turns` turns
 *   start  back to the start marker
 *   warp   jump to space `to` (river currents), the destination applies normally
 *   safe   nothing happens
 *   exit   the gates, you escaped
 */
(function (root) {
  'use strict';

  var VERSION = 1;

  var DEFAULTS = {
    dieSides: 4,
    exactFinish: false,      // true = you need the exact roll to reach the exit
    oneRollPerDay: true,
    cutoffHour: 0,           // local hour the day rolls over (0 = midnight)
    cutoffMinute: 59,
    timeZone: 'America/New_York',
    remindHour: 19           // roll reminders for players who turned them on (null = off)
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function now() { return Date.now(); }
  function rngInt(rng, n) { return Math.floor((rng || Math.random)() * n); }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) { var j = rngInt(rng, i + 1); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }

  // ---- game setup -------------------------------------------------------------
  function createGame(opts) {
    var board = clone(opts.board);
    var cards = clone(opts.cards || []);
    var s = {
      v: VERSION,
      id: opts.id || ('g' + now().toString(36)),
      title: opts.title || board.title || "Chester's Escape",
      themeId: opts.themeId || board.themeId || 'cemetery',
      board: board,
      cards: cards,
      deck: shuffle(cards.map(function (c) { return c.id; }), opts.rng),
      discard: [],
      settings: Object.assign({}, DEFAULTS, opts.settings || {}),
      day: 1,
      status: opts.status || 'running',     // signup | running | finished
      startsAt: opts.startsAt || null,      // signup only: when the first roll unlocks (ms)
      endsAt: opts.endsAt || null,          // optional: when the game locks and the standings freeze (ms)
      startedAt: opts.startedAt || now(),
      players: {},
      order: [],          // join order
      finishOrder: [],
      events: [],         // global feed, newest last
      seq: 0
    };
    return s;
  }

  function addPlayer(s, info) {
    if (s.players[info.id]) {
      var p0 = s.players[info.id];
      ['name', 'avatar', 'blId', 'color', 'bot', 'discordId'].forEach(function (k) { if (info[k] != null) p0[k] = info[k]; });
      return p0;
    }
    var p = {
      id: info.id, name: info.name || 'Player', avatar: info.avatar || '', blId: info.blId || '', discordId: info.discordId || '',
      color: info.color || '', bot: !!info.bot,
      route: null, pos: -1, tasks: [], skip: 0, skippedDay: 0, rolledDay: 0, extraRoll: false, shield: false,
      claims: [], finished: null, rolls: 0, joinedAt: now()
    };
    s.players[p.id] = p; s.order.push(p.id);
    emit(s, p, { t: 'join' });
    return p;
  }

  function removePlayer(s, pid) {
    if (!s.players[pid]) return;
    delete s.players[pid];
    s.order = s.order.filter(function (x) { return x !== pid; });
    s.finishOrder = s.finishOrder.filter(function (x) { return x !== pid; });
  }

  function chooseRoute(s, pid, route) {
    var p = need(s, pid);
    if (p.route) throw err('route-set', 'Your route is already locked in.');
    if (!s.board.routes[route]) throw err('bad-route', 'That route does not exist.');
    p.route = route; p.pos = -1;
    emit(s, p, { t: 'route', route: route });
    return p;
  }

  // ---- helpers ---------------------------------------------------------------
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function need(s, pid) { var p = s.players[pid]; if (!p) throw err('no-player', 'Player not found.'); return p; }
  function routeOf(s, p) { return (p && p.route && s.board.routes[p.route]) || []; }
  function spaceAt(s, p) { var r = routeOf(s, p); return p.pos >= 0 && p.pos < r.length ? s.board.spaces[r[p.pos]] : null; }
  function exitIndex(s, p) { return routeOf(s, p).length - 1; }
  function progress(s, p) {
    if (p.finished) return 1;
    var r = routeOf(s, p); if (!r.length) return 0;
    return Math.max(0, (p.pos + 1) / r.length);
  }
  function remaining(s, p) { var r = routeOf(s, p); return r.length ? (r.length - 1 - p.pos) : null; }

  function emit(s, p, ev) {
    ev.id = ++s.seq; ev.pid = p ? p.id : null; ev.day = s.day; ev.at = ev.at || now();
    if (s.status === 'signup') ev.pre = true;
    s.events.push(ev);
    if (s.events.length > 800) s.events.splice(0, s.events.length - 800);
    return ev;
  }

  // ---- rolling ---------------------------------------------------------------
  function canRoll(s, pid) {
    var p = s.players[pid];
    if (!p) return { ok: false, code: 'no-player', reason: 'Join the game first.' };
    if (s.status !== 'running') return { ok: false, code: 'not-running', reason: s.status === 'signup' ? 'The game has not started yet.' : 'The game is over.' };
    if (p.finished) return { ok: false, code: 'finished', reason: 'You escaped! Chester is safe.' };
    if (!p.route) return { ok: false, code: 'no-route', reason: 'Pick your route first.' };
    if (p.tasks.length) return { ok: false, code: 'task', reason: p.tasks.length > 1 ? 'Play your ' + p.tasks.length + ' maps first.' : 'Play your map first.' };
    if (p.skippedDay === s.day) return { ok: false, code: 'skip', reason: 'You lose this turn.' };
    if (s.settings.oneRollPerDay && p.rolledDay === s.day && !p.extraRoll) return { ok: false, code: 'rolled', reason: 'You already rolled today.' };
    return { ok: true };
  }

  function roll(s, pid, opts) {
    opts = opts || {};
    var c = canRoll(s, pid);
    if (!c.ok) throw err(c.code, c.reason);
    var p = s.players[pid];
    var sides = s.settings.dieSides || 4;
    var n = opts.forced || (rngInt(opts.rng, sides) + 1);
    var bonus = p.rolledDay === s.day && p.extraRoll;
    if (bonus) p.extraRoll = false;
    p.rolledDay = s.day; p.rolls++;
    var start = emit(s, p, { t: 'roll', n: n, from: p.pos, bonus: bonus });
    var steps = [];
    var ctx = { rng: opts.rng, steps: steps, depth: 0, firstEvent: start.id };
    var target = p.pos + n, last = exitIndex(s, p);
    if (target > last && s.settings.exactFinish) {
      emit(s, p, { t: 'overshoot', need: last - p.pos });
      mustPlay(s, p, ctx);
      return result(s, p, n, start.id, steps);
    }
    walk(s, p, Math.min(target, last), ctx);
    land(s, p, 'roll', ctx);
    mustPlay(s, p, ctx);
    return result(s, p, n, start.id, steps);
  }

  // Every roll ends with a map to play. If the turn stops on a space without one
  // (a card, an event, lose a turn, back to start), the player gets a bonus map.
  // Exceptions: a Safe space, escaping, or a bonus roll still to take today.
  function mustPlay(s, p, ctx) {
    if (p.finished || p.tasks.length || p.extraRoll) return;
    var sp = spaceAt(s, p);
    if (sp && (sp.type === 'safe' || sp.type === 'exit')) return;
    var keys = pickBonus(s, ctx && ctx.rng, p);
    if (keys.length) addTask(s, p, { bsr: keys, space: sp ? sp.id : null, bonus: true, source: 'bonus' });
  }

  function result(s, p, n, fromId, steps) {
    return { roll: n, steps: steps, events: s.events.filter(function (e) { return e.id >= fromId; }), player: p };
  }

  // Move the token one space at a time so the UI can animate each hop.
  function walk(s, p, to, ctx) {
    var dir = to >= p.pos ? 1 : -1;
    while (p.pos !== to) { p.pos += dir; ctx.steps.push(p.pos); }
  }

  function jump(s, p, to, ctx) { p.pos = to; ctx.steps.push({ jump: to }); }

  // Apply whatever is on the current space.
  // via: 'roll' (normal landing), 'effect' (moved by a card or move space), 'warp' (board current)
  function land(s, p, via, ctx) {
    ctx.depth++;
    if (ctx.depth > 8) return;
    var last = exitIndex(s, p);
    if (p.pos >= last) { p.pos = last; return finish(s, p); }
    if (p.pos < 0) { p.pos = -1; return; }
    var sp = spaceAt(s, p);
    if (!sp) return;
    var chained = via === 'effect';   // a space reached by a card or event only applies if it has a map
    emit(s, p, { t: 'land', space: sp.id, via: via });
    switch (sp.type) {
      case 'map':
      case 'task':
        addTask(s, p, { bsr: sp.bsr || [], space: sp.id, kind: sp.kind || null, source: 'space' });
        break;
      case 'card':
        if (chained) { emit(s, p, { t: 'rest', reason: 'no-chain-card' }); break; }
        drawCard(s, p, ctx);
        break;
      case 'move':
        if (chained) { emit(s, p, { t: 'rest', reason: 'no-chain' }); break; }
        applyMove(s, p, sp.n, ctx, { space: sp.id });
        break;
      case 'skip':
        if (chained) { emit(s, p, { t: 'rest', reason: 'no-chain' }); break; }
        applySkip(s, p, sp.turns || 1, { space: sp.id });
        break;
      case 'start':
        if (chained) { emit(s, p, { t: 'rest', reason: 'no-chain' }); break; }
        if (useShield(s, p, { space: sp.id })) break;
        jump(s, p, -1, ctx);
        emit(s, p, { t: 'start', space: sp.id });
        break;
      case 'warp':
        var idx = routeOf(s, p).indexOf(sp.to);
        if (idx < 0) break;
        if (idx < p.pos && useShield(s, p, { space: sp.id })) break;
        jump(s, p, idx, ctx);
        emit(s, p, { t: 'warp', space: sp.id, to: sp.to });
        land(s, p, 'warp', ctx);
        break;
      case 'exit':
        finish(s, p);
        break;
      default:
        break;
    }
  }

  function applyMove(s, p, n, ctx, src) {
    if (!n) return;
    if (n < 0 && useShield(s, p, src)) return;
    var last = exitIndex(s, p);
    var to = Math.max(-1, Math.min(last, p.pos + n));
    emit(s, p, Object.assign({ t: 'move', n: n, from: p.pos, to: to }, src));
    walk(s, p, to, ctx);
    land(s, p, 'effect', ctx);
  }

  function applySkip(s, p, turns, src) {
    if (useShield(s, p, src)) return;
    p.skip += turns;
    emit(s, p, Object.assign({ t: 'skip', turns: turns, total: p.skip }, src));
  }

  function useShield(s, p, src) {
    if (!p.shield) return false;
    p.shield = false;
    emit(s, p, Object.assign({ t: 'shield-used' }, src));
    return true;
  }

  function addTask(s, p, task) {
    task.id = 't' + (++s.seq);
    task.since = now();
    task.day = s.day;
    p.tasks.push(task);
    emit(s, p, { t: 'task', task: task.id, bsr: task.bsr, space: task.space || null, card: task.card || null, bonus: task.bonus || undefined });
    return task;
  }

  // ---- cards -----------------------------------------------------------------
  function cardById(s, id) { for (var i = 0; i < s.cards.length; i++) if (s.cards[i].id === id) return s.cards[i]; return null; }

  function drawCard(s, p, ctx, forcedId) {
    if (!s.cards.length) return null;
    var id = forcedId;
    if (!id) {
      if (!s.deck.length) { s.deck = shuffle(s.discard.splice(0), ctx && ctx.rng); emit(s, null, { t: 'reshuffle' }); }
      id = s.deck.shift();
    } else {
      s.deck = s.deck.filter(function (x) { return x !== id; });
    }
    s.discard.push(id);
    var card = cardById(s, id);
    emit(s, p, { t: 'card', card: id });
    (card.effects || []).forEach(function (fx) { applyCardEffect(s, p, fx, card, ctx || { steps: [], depth: 0 }); });
    return card;
  }

  function applyCardEffect(s, p, fx, card, ctx) {
    var src = { card: card.id };
    switch (fx.type) {
      case 'move': applyMove(s, p, fx.n, ctx, src); break;
      case 'skip': applySkip(s, p, fx.turns || 1, src); break;
      case 'again': p.extraRoll = true; emit(s, p, { t: 'again', card: card.id }); break;
      case 'shield': p.shield = true; emit(s, p, { t: 'shield', card: card.id }); break;
      case 'task':
        var keys = fx.bsr && fx.bsr.length ? fx.bsr : pickBonus(s, ctx && ctx.rng, p);
        addTask(s, p, { bsr: keys, card: card.id, source: 'card' });
        break;
      case 'toNext':
        var r = routeOf(s, p), want = fx.kind || 'map';
        for (var i = p.pos + 1; i < r.length; i++) {
          var sp = s.board.spaces[r[i]];
          if (sp.type === want || (want === 'map' && sp.type === 'task') || sp.type === 'exit') { applyMove(s, p, i - p.pos, ctx, src); return; }
        }
        break;
      default: break;
    }
  }

  // A board still on (part of) the built-in bonus list picks up newer built-in maps.
  // A board whose designer chose their own bonus maps is left alone.
  function upgradeBonus(board, builtIn) {
    var cur = (board && board.bonusMaps) || [];
    if (!board || !builtIn || cur.length >= builtIn.length) return false;
    if (!cur.every(function (k) { return builtIn.indexOf(k) >= 0; })) return false;
    board.bonusMaps = builtIn.slice();
    return true;
  }

  // A bonus map, preferring ones this player has not been given yet.
  function pickBonus(s, rng, p) {
    var pool = s.board.bonusMaps || [];
    if (!pool.length) return [];
    if (p) {
      var had = {};
      s.events.forEach(function (e) { if (e.t === 'task' && e.pid === p.id) (e.bsr || []).forEach(function (k) { had[String(k).toLowerCase()] = 1; }); });
      p.tasks.forEach(function (t) { (t.bsr || []).forEach(function (k) { had[String(k).toLowerCase()] = 1; }); });
      var fresh = pool.filter(function (k) { return !had[String(k).toLowerCase()]; });
      if (fresh.length) pool = fresh;
    }
    return [pool[rngInt(rng, pool.length)]];
  }

  // ---- tasks / verification ----------------------------------------------------
  function completeTask(s, pid, taskId, proof) {
    var p = need(s, pid);
    var i = -1;
    for (var k = 0; k < p.tasks.length; k++) if (p.tasks[k].id === taskId) i = k;
    if (i < 0) throw err('no-task', 'That map is already cleared.');
    var t = p.tasks.splice(i, 1)[0];
    p.claims = p.claims.filter(function (c) { return c.task !== taskId; });
    emit(s, p, { t: 'cleared', task: t.id, bsr: t.bsr, space: t.space || null, card: t.card || null, proof: proof || { by: 'host' } });
    return t;
  }

  // Player says "I played it" (score did not show on BeatLeader, e.g. not a new PB). Host approves.
  function claimTask(s, pid, taskId, info) {
    var p = need(s, pid);
    var t = p.tasks.filter(function (x) { return x.id === taskId; })[0];
    if (!t) throw err('no-task', 'That map is already cleared.');
    if (p.claims.some(function (c) { return c.task === taskId; })) throw err('claimed', 'Already sent to the host.');
    var c = { task: taskId, at: now(), note: (info && info.note) || '', url: (info && info.url) || '' };
    p.claims.push(c);
    emit(s, p, { t: 'claim', task: taskId, url: c.url });
    return c;
  }

  function rejectClaim(s, pid, taskId) {
    var p = need(s, pid);
    p.claims = p.claims.filter(function (c) { return c.task !== taskId; });
    emit(s, p, { t: 'claim-rejected', task: taskId });
  }

  // Check a list of recent BeatLeader scores against a player's open tasks.
  // scores: [{ hash, time (unix seconds), diff, acc, id }]  hashesByKey: { bsrKey: hash }
  function matchScores(s, pid, scores, hashesByKey) {
    var p = need(s, pid), cleared = [];
    p.tasks.slice().forEach(function (t) {
      var hashes = (t.bsr || []).map(function (k) { return (hashesByKey[String(k).toLowerCase()] || '').toUpperCase(); }).filter(Boolean);
      var hit = null;
      (scores || []).forEach(function (sc) {
        if (hit) return;
        if (hashes.indexOf(String(sc.hash || '').toUpperCase()) >= 0 && sc.time * 1000 >= t.since - 60000) hit = sc;
      });
      if (hit) cleared.push(completeTask(s, pid, t.id, { by: 'beatleader', score: hit.id || null, diff: hit.diff || '', acc: hit.acc || null, mods: hit.mods || '' }));
    });
    return cleared;
  }

  // ---- days ------------------------------------------------------------------
  // Sign-ups are open: players can join and pick a route, but nobody rolls until the start.
  function startGame(s, at) {
    if (s.status !== 'signup') return false;
    s.status = 'running'; s.day = 1; s.startedAt = at || now();
    emit(s, null, { t: 'begin' });
    return true;
  }

  function advanceDay(s) {
    if (s.status !== 'running') return s.day;
    s.day++;
    s.order.forEach(function (pid) {
      var p = s.players[pid];
      if (p.finished) return;
      p.extraRoll = false;
      if (p.skip > 0) { p.skip--; p.skippedDay = s.day; emit(s, p, { t: 'lost-turn', left: p.skip }); }
    });
    emit(s, null, { t: 'day', day: s.day });
    return s.day;
  }

  function finish(s, p) {
    if (p.finished) return;
    p.tasks = []; p.claims = [];
    s.finishOrder.push(p.id);
    p.finished = { day: s.day, place: s.finishOrder.length, at: now() };
    emit(s, p, { t: 'escaped', place: p.finished.place });
    // Everyone on the board is out: the game is over.
    var racing = s.order.filter(function (pid) { return s.players[pid].route; });
    if (racing.length && racing.every(function (pid) { return s.players[pid].finished; })) endGame(s);
  }

  // Standings: escaped players by place, then everyone else by spaces left (fewest first).
  function ranking(s) {
    var ids = s.order.filter(function (pid) { return s.players[pid].route; });
    ids.sort(function (a, b) {
      var A = s.players[a], B = s.players[b];
      if (A.finished || B.finished) return (A.finished ? A.finished.place : 1e6) - (B.finished ? B.finished.place : 1e6);
      return remaining(s, A) - remaining(s, B) || s.order.indexOf(a) - s.order.indexOf(b);
    });
    var out = [], place = 0, prevLeft = null;
    ids.forEach(function (pid, i) {
      var p = s.players[pid], left = p.finished ? 0 : remaining(s, p);
      if (p.finished) place = p.finished.place; else if (left !== prevLeft) place = i + 1;
      prevLeft = p.finished ? null : left;
      out.push({ pid: pid, place: place, escaped: !!p.finished, left: left, day: p.finished ? p.finished.day : null });
    });
    return out;
  }

  // A roll reminder for this player today, or null if they are all set.
  function reminderFor(s, pid) {
    var p = s.players[pid];
    if (!p || !p.route || p.finished || s.status !== 'running') return null;
    var open = p.tasks.filter(function (t) { return !p.claims.some(function (c) { return c.task === t.id; }); });
    if (open.length) return { title: 'Your map is still open', body: 'Play !bsr ' + open[0].bsr.join(' or ') + ' to unlock your next roll.' };
    if (canRoll(s, pid).ok) return { title: 'Your roll is waiting', body: 'You haven\'t rolled today. The day turns over at the cutoff.' };
    return null;
  }
  // The reminder hour, or null when the host turned reminders off. Games made before the
  // setting existed have none saved, so they get the default.
  function remindHour(s) {
    var h = s.settings ? s.settings.remindHour : undefined;
    if (h === undefined) return DEFAULTS.remindHour;
    return h === null || h === '' ? null : Number(h);
  }
  // When a player in time zone `tz` gets today's reminder: the last `hour`:00 their time that is
  // at least 2 hours before the cutoff. If that lands within 2 hours of the day starting (the
  // cutoff is evening for them, say Hawaii), it goes 2 hours before the cutoff instead.
  function reminderTime(cutoff, hour, tz) {
    var HOUR = 3600000, latest = cutoff - 2 * HOUR, dayStart = cutoff - 24 * HOUR;
    for (var t = Math.floor(latest / HOUR) * HOUR; t > dayStart; t -= HOUR) {
      var p = zoneParts(new Date(t), tz || DEFAULTS.timeZone);
      if (p.h === Number(hour)) { var at = t - p.mi * 60000; return at - dayStart >= 2 * HOUR ? at : latest; }
    }
    return latest;
  }
  function localHour(ts, tz) { return zoneParts(new Date(ts), tz || DEFAULTS.timeZone).h; }

  // Where every token was just before event `firstId`, worked out backwards from now.
  function positionsBefore(s, firstId) {
    var pos = {}, b = s.board;
    var idx = function (p, spaceId) { return b.routes[p.route] ? b.routes[p.route].indexOf(spaceId) : -1; };
    s.order.forEach(function (pid) { var p = s.players[pid]; if (p.route) pos[pid] = p.finished ? exitIndex(s, p) : p.pos; });
    for (var i = s.events.length - 1; i >= 0; i--) {
      var e = s.events[i]; if (e.id < firstId) break;
      var p = s.players[e.pid]; if (!p || !p.route) continue;
      if (e.t === 'roll' || e.t === 'move') pos[e.pid] = e.from;
      else if ((e.t === 'warp' || e.t === 'start') && e.space) { var k = idx(p, e.space); if (k >= 0) pos[e.pid] = k; }
      else if ((e.t === 'host-move' || e.t === 'host-reset') && e.from != null) pos[e.pid] = e.from;
      else if (e.t === 'route') pos[e.pid] = -1;
    }
    return pos;
  }

  // Lock the game and freeze the standings.
  function endGame(s, at) {
    if (s.status !== 'running') return false;
    s.status = 'finished'; s.endedAt = at || now();
    s.final = ranking(s);
    emit(s, null, { t: 'end', winner: s.final[0] ? s.final[0].pid : null });
    return true;
  }

  // ---- host tools ------------------------------------------------------------
  function setPosition(s, pid, pos, opts) {
    var p = need(s, pid);
    var last = exitIndex(s, p), from = p.pos;
    p.pos = Math.max(-1, Math.min(last, pos));
    if (p.finished && p.pos < last) { p.finished = null; s.finishOrder = s.finishOrder.filter(function (x) { return x !== pid; }); }
    emit(s, p, { t: 'host-move', from: from, to: p.pos });
    if (opts && opts.apply) { var ctx = { steps: [], depth: 0 }; land(s, p, 'roll', ctx); }
    return p;
  }

  function hostCard(s, pid, cardId) { var p = need(s, pid); return drawCard(s, p, { steps: [], depth: 0 }, cardId); }

  function resetPlayer(s, pid) {
    var p = need(s, pid), from = p.pos;
    p.pos = -1; p.tasks = []; p.claims = []; p.skip = 0; p.skippedDay = 0; p.rolledDay = 0; p.extraRoll = false; p.shield = false; p.finished = null;
    s.finishOrder = s.finishOrder.filter(function (x) { return x !== pid; });
    emit(s, p, { t: 'host-reset', from: from });
  }

  // State a player is allowed to see (live mode strips nothing secret today, but keep one place for it).
  function publicState(s) { return clone(s); }

  // Every map key on the board and in the bonus pool, for the playlist download.
  function allMapKeys(board, cards) {
    var seen = {}, out = [];
    function add(k) { k = String(k).toLowerCase(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } }
    ['longer', 'riskier'].concat(Object.keys(board.routes)).forEach(function (r) {
      (board.routes[r] || []).forEach(function (id) { var sp = board.spaces[id]; (sp && sp.bsr || []).forEach(add); });
    });
    (board.bonusMaps || []).forEach(add);
    (cards || []).forEach(function (c) { (c.effects || []).forEach(function (fx) { (fx.bsr || []).forEach(add); }); });
    return out;
  }

  // Validate a board from the designer before it is used.
  function checkBoard(b) {
    var problems = [];
    if (!b || !b.spaces || !b.routes) return ['Board is missing spaces or routes.'];
    Object.keys(b.routes).forEach(function (r) {
      var list = b.routes[r];
      if (!list.length) { problems.push('The ' + r + ' route has no spaces.'); return; }
      list.forEach(function (id, i) { if (!b.spaces[id]) problems.push(r + ' route step ' + (i + 1) + ' points at a missing space.'); });
      var last = b.spaces[list[list.length - 1]];
      if (last && last.type !== 'exit') problems.push('The ' + r + ' route must end on the exit space.');
    });
    Object.keys(b.spaces).forEach(function (id) {
      var sp = b.spaces[id];
      if ((sp.type === 'map' || sp.type === 'task') && !(sp.bsr && sp.bsr.length)) problems.push('Space ' + id + ' needs a map key.');
      if (sp.type === 'warp' && !b.spaces[sp.to]) problems.push('Space ' + id + ' warps to a missing space.');
      if (sp.type === 'move' && !sp.n) problems.push('Space ' + id + ' needs a move amount.');
    });
    return problems;
  }

  // Next day cutoff as a UTC timestamp, in the game's time zone.
  function nextCutoff(settings, from) {
    from = from || now();
    var tz = settings.timeZone || 'America/New_York';
    var h = settings.cutoffHour || 0, m = settings.cutoffMinute || 0;
    // Find today's local date in the zone, then search the UTC instant that matches h:m local.
    for (var dayOffset = 0; dayOffset < 3; dayOffset++) {
      var probe = new Date(from + dayOffset * 86400000);
      var parts = zoneParts(probe, tz);
      var guess = Date.UTC(parts.y, parts.mo - 1, parts.d, h, m) - zoneOffset(probe, tz);
      if (guess > from) return guess;
    }
    return from + 86400000;
  }
  function zoneParts(d, tz) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    var o = {}; f.formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
  }
  function zoneOffset(d, tz) {
    var p = zoneParts(d, tz);
    var asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    return asUtc - (d.getTime() - d.getUTCSeconds() * 1000 - d.getUTCMilliseconds());
  }

  var E = {
    VERSION: VERSION, DEFAULTS: DEFAULTS,
    createGame: createGame, addPlayer: addPlayer, removePlayer: removePlayer, chooseRoute: chooseRoute,
    canRoll: canRoll, roll: roll, advanceDay: advanceDay,
    completeTask: completeTask, claimTask: claimTask, rejectClaim: rejectClaim, matchScores: matchScores,
    setPosition: setPosition, hostCard: hostCard, resetPlayer: resetPlayer,
    routeOf: routeOf, spaceAt: spaceAt, progress: progress, remaining: remaining, exitIndex: exitIndex,
    cardById: cardById, publicState: publicState, allMapKeys: allMapKeys, checkBoard: checkBoard,
    nextCutoff: nextCutoff, shuffle: shuffle, clone: clone, startGame: startGame, upgradeBonus: upgradeBonus,
    endGame: endGame, ranking: ranking, positionsBefore: positionsBefore, reminderFor: reminderFor, localHour: localHour, remindHour: remindHour, reminderTime: reminderTime
  };
  root.CGEngine = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof globalThis !== 'undefined' ? globalThis : this);
