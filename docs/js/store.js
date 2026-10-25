/*
 * Chester's Escape - game store.
 * DemoStore runs the whole game in this browser (localStorage) with bot players,
 * so anyone can try it with nothing hosted. LiveStore talks to the Worker, which
 * runs the same engine on the server. The app only ever calls store.act(name, args).
 */
(function (root) {
  'use strict';
  var E = root.CGEngine, C = root.CGContent, S = root.CGServices;
  var KEY = 'cg.demo.v1';

  function listeners() { var l = []; return { on: function (f) { l.push(f); }, emit: function (x) { l.forEach(function (f) { try { f(x); } catch (e) { console.error(e); } }); } }; }

  // ---- demo -------------------------------------------------------------------
  var DEMO_PLAYERS = [
    { id: 'msploit', name: 'MSploit', blId: '76561199153577883', avatar: 'https://cdn.assets.beatleader.com/76561199153577883R35.png' },
    { id: 'hummingbird', name: 'hummingbird', blId: '76561198786758592', avatar: 'https://cdn.assets.beatleader.com/76561198786758592R14.png', bot: true },
    { id: 'wisp', name: 'Wisp', bot: true },
    { id: 'pumpkin', name: 'Pumpkin Pie', bot: true },
    { id: 'moth', name: 'Mothman', bot: true },
    { id: 'bramble', name: 'Bramble', bot: true },
    { id: 'nyx', name: 'Nyx', bot: true },
    { id: 'gravel', name: 'Gravelord', bot: true }
  ];

  function rng() { return Math.random(); }

  function DemoStore() {
    var ev = listeners();
    this.mode = 'demo';
    this.on = ev.on; this._emit = ev.emit;
    this.isHost = true;
    this.user = null;
    this.online = ['hummingbird', 'nyx', 'moth'];   // a few bots "have the game open" in the demo
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && saved.state && saved.state.v === E.VERSION) {
      this.state = saved.state; this.me = saved.me;
      if (!this.state.board.mapSet) E.upgradeBonus(this.state.board, C.boards['chester-escape']().bonusMaps);
    }
    else this.fresh('cemetery', null, true);
    try { this.hall = JSON.parse(localStorage.getItem(KEY + '.hall') || 'null'); } catch (e) { this.hall = null; }
    if (!Array.isArray(this.hall)) this.hall = demoHall();
  }
  // Two made-up past games so the demo's hall of fame has something in it.
  function demoHall() {
    var day = 86400000, t = Date.now(), who = function (id) { return DEMO_PLAYERS.filter(function (p) { return p.id === id; })[0] || { name: id }; }, n = function (id) { return who(id).name; };
    var game = function (id, title, theme, ago, days, order) {
      var all = order.map(function (pid, i) { return { pid: pid, name: n(pid), place: i + 1, escaped: i < 2 }; });
      return { id: id, title: title, themeId: theme, startedAt: t - (ago + days) * day, endedAt: t - ago * day, days: days, players: all.length,
        top: all.slice(0, 3).map(function (r, i) { return { pid: r.pid, name: r.name, avatar: who(r.pid).avatar || '', place: r.place, escaped: r.escaped, day: r.escaped ? days - 1 + i : null, left: r.escaped ? 0 : 6 }; }), all: all };
    };
    var title = function (id) { return (C.themes[id] || {}).title || "Chester's Escape"; };
    return [game('demo-old-1', title('cemetery'), 'cemetery', 40, 12, ['nyx', 'hummingbird', 'moth', 'wisp', 'gravel']),
      game('demo-old-2', title('christmas'), 'christmas', 12, 10, ['hummingbird', 'msploit', 'nyx', 'bramble', 'pumpkin', 'moth'])];
  }

  DemoStore.prototype.fresh = function (themeId, board, withHistory, startsAt, endsAt) {
    var b = board || C.boardFor((C.themes[themeId] || {}).mapSet);
    var s = E.createGame({ board: b, cards: C.cardsFor(themeId), themeId: themeId, title: C.themes[themeId].title, status: startsAt ? 'signup' : 'running', startsAt: startsAt || null, endsAt: endsAt || null });
    DEMO_PLAYERS.forEach(function (p) { E.addPlayer(s, p); });
    // bots pick routes; you pick yours in the app
    var picks = { hummingbird: 'riskier', wisp: 'longer', pumpkin: 'riskier', moth: 'longer', bramble: 'longer', nyx: 'riskier', gravel: 'longer' };
    Object.keys(picks).forEach(function (id) { E.chooseRoute(s, id, picks[id]); });
    this.state = s; this.me = 'msploit';
    if (withHistory && !startsAt) { for (var d = 0; d < 4; d++) this._botsPlay(true); s.events = s.events.slice(-120); }
    this._save();
  };

  DemoStore.prototype._save = function () {
    try { localStorage.setItem(KEY, JSON.stringify({ state: this.state, me: this.me })); } catch (e) { /* storage full or blocked; demo still runs in memory */ }
  };

  // Bots: most clear yesterday's map, then roll. Some clear today's map right away.
  DemoStore.prototype._botsPlay = function (advance) {
    var s = this.state;
    if (advance) E.advanceDay(s);
    var from = s.events.length;
    s.order.forEach(function (pid) {
      var p = s.players[pid]; if (!p.bot || p.finished || !p.route) return;
      p.tasks.slice().forEach(function (t) { if (Math.random() < 0.85) E.completeTask(s, pid, t.id, { by: 'beatleader', demo: true, diff: ['Hard', 'Expert', 'ExpertPlus'][Math.floor(Math.random() * 3)], acc: 0.88 + Math.random() * 0.08 }); });
      var guard = 0;
      while (E.canRoll(s, pid).ok && guard++ < 4) {
        E.roll(s, pid, { rng: rng });
        p.tasks.slice().forEach(function (t) { if (Math.random() < 0.35) E.completeTask(s, pid, t.id, { by: 'beatleader', demo: true, diff: 'Expert', acc: 0.9 + Math.random() * 0.05 }); });
      }
    });
    // Bots cheer and heckle a few of the new moments, so the demo thread has reactions in it.
    var bots = s.order.filter(function (pid) { return s.players[pid].bot; });
    s.events.slice(Math.max(0, from - 12)).forEach(function (e) {
      if (['cleared', 'escaped', 'start', 'pass', 'card', 'warp'].indexOf(e.t) < 0 || Math.random() > 0.45) return;
      var n = 1 + Math.floor(Math.random() * 3);
      for (var k = 0; k < n; k++) {
        var b = bots[Math.floor(Math.random() * bots.length)]; if (!b || b === e.pid) continue;
        var pick = e.t === 'start' ? ['rip', 'lol', 'popcorn', 'pressf', 'salt', 'cry', 'rage', 'broken'] : e.t === 'cleared' ? ['ss', 'fire', 'medal', 'love', 'jaw', 'letsgo', 'sabers', 'salt', 'strong', 'sweat'] : e.t === 'escaped' ? ['medal', 'letsgo', 'bump', 'love', 'hero', 'fire', 'salt'] : e.t === 'pass' ? ['fire', 'jaw', 'sabers', 'salt', 'popcorn'] : E.REACTIONS;
        var em = pick[Math.floor(Math.random() * pick.length)];
        var have = s.reactions && s.reactions[e.id] && s.reactions[e.id][em];
        if (!have || have.indexOf(b) < 0) try { E.react(s, b, e.id, em); } catch (x) {}
      }
    });
  };

  DemoStore.prototype.load = function () { return Promise.resolve(this.state); };
  // Host tools' visit log, made up for the demo from the bots.
  DemoStore.prototype.visits = function () {
    var now = Date.now(), m = 60000, s = this.state, out = [];
    var plan = [['hummingbird', 3, null], ['nyx', 11, null], ['moth', 26, null], ['wisp', 95, 72], ['gravel', 180, 171], ['hummingbird', 300, 262], ['pumpkin', 26 * 60, 26 * 60 - 14], ['bramble', 27 * 60, 27 * 60 - 3], ['nyx', 30 * 60, 30 * 60 - 41]];
    plan.forEach(function (x) { var p = s.players[x[0]]; if (!p) return; out.push({ id: x[0], name: p.name, start: now - x[1] * m, end: x[2] == null ? null : now - x[2] * m, last: x[2] == null ? now - 5000 : now - x[2] * m, open: x[2] == null, player: true }); });
    out.push({ id: 'guest', name: 'LJ', start: now - 50 * m, end: now - 47 * m, last: now - 47 * m, open: false, player: false });
    out.sort(function (a, b) { return b.start - a.start; });
    return Promise.resolve({ now: now, visits: out });
  };

  // Host undo and the hall of fame work in the demo too, kept in this browser.
  DemoStore.prototype.act = function (name, a) {
    var self = this, s0 = this.state, snap = E.UNDOABLE.indexOf(name) >= 0 ? { state: JSON.stringify(s0), label: E.hostLabel(s0, name, a || {}), pre: s0.seq } : null;
    var stack = this.undoStack = this.undoStack || [];
    if (name === 'undo') {
      var top = stack[stack.length - 1];
      if (!top) return Promise.reject(new Error('There is nothing to undo.'));
      if (top.post !== s0.seq) return Promise.reject(new Error('Players have done things since then, so undoing it would wipe their moves too.'));
      var old = JSON.parse(top.state); old.seq = Math.max(old.seq || 0, s0.seq) + 1;
      stack.pop(); var below = stack[stack.length - 1]; if (below && below.post === top.pre) below.post = old.seq;
      this.state = old;
      if (old.status !== 'finished') this.hall = this.hall.filter(function (h) { return h.id !== old.id; });
      this._saveHall(); this._save(); this._emit({ action: 'undo', result: { undone: top.label } });
      return Promise.resolve({ undone: top.label });
    }
    var was = s0.status;
    return this._act(name, a).then(function (res) {
      if (self.state.status === 'finished' && (was !== 'finished' || self.state !== s0) && (self.hallHidden || []).indexOf(self.state.id) < 0 && E.addToHall(self.hall, self.state)) self._saveHall();
      if (snap) { snap.post = self.state.seq; snap.at = Date.now(); snap.by = 'MSploit'; stack.push(snap); while (stack.length > 5) stack.shift(); self._emit({ action: 'undo-list' }); }
      return res;
    });
  };
  DemoStore.prototype.undoInfo = function () {
    var l = this.undoStack || [], top = l[l.length - 1];
    return { ok: !!top && top.post === this.state.seq, list: l.slice().reverse().map(function (x) { return { label: x.label, at: x.at, by: x.by }; }) };
  };
  DemoStore.prototype._saveHall = function () { try { localStorage.setItem(KEY + '.hall', JSON.stringify(this.hall)); } catch (e) {} };
  DemoStore.prototype._act = function (name, a) {
    var self = this, s = this.state, me = this.me;
    a = a || {};
    function done(res) { self._save(); self._emit({ action: name, result: res }); return res; }
    try {
      switch (name) {
        case 'join': {
          if (!E.signupsOpen(s)) return Promise.reject(new Error('Sign-ups are closed until the game starts.'));
          var id = a.id || ('p' + Date.now().toString(36));
          E.addPlayer(s, { id: id, name: a.name, avatar: a.avatar, blId: a.blId });
          self.me = id;
          return Promise.resolve(done({ pid: id }));
        }
        case 'playAs': self.me = a.pid; return Promise.resolve(done({}));
        case 'react': if (!s.players[me]) return Promise.reject(new Error('Join the game to react.')); return Promise.resolve(done(E.react(s, me, a.id, a.emoji)));
        case 'route': return Promise.resolve(done(E.chooseRoute(s, me, a.route)));
        case 'roll': return Promise.resolve(done(E.roll(s, me, { rng: rng })));
        case 'verify':
          return S.checkTasks(E, s, me).then(function (r) { return done(r); });
        case 'claim': return Promise.resolve(done(E.claimTask(s, me, a.task, { url: a.url, note: a.note })));
        case 'pass': {   // demo only: pretend BeatLeader found a pass
          var p = s.players[a.pid || me];
          var t = p.tasks.filter(function (x) { return !a.task || x.id === a.task; })[0];
          if (!t) return Promise.resolve(done({ cleared: [] }));
          return Promise.resolve(done({ cleared: [E.completeTask(s, p.id, t.id, { by: 'beatleader', demo: true, diff: 'Expert', acc: 0.913 })] }));
        }
        // host tools
        case 'advance': if (s.status !== 'running') return Promise.reject(new Error('The game has not started yet.')); self._botsPlay(true); return Promise.resolve(done({ day: s.day }));
        case 'schedule':
          if (s.status !== 'signup') return Promise.reject(new Error('The game has already started.'));
          if (a.startsAt == null) { s.startsAt = null; s.seq++; return Promise.resolve(done({})); }
          if (!(a.startsAt > Date.now() + 60000)) return Promise.reject(new Error('Pick a start time in the future.'));
          s.startsAt = a.startsAt; s.seq++; return Promise.resolve(done({}));
        case 'setEnd':
          if (s.status === 'finished') return Promise.reject(new Error('The game is already over.'));
          if (a.endsAt == null) { s.endsAt = null; s.seq++; return Promise.resolve(done({})); }
          if (!(a.endsAt > Date.now() + 60000)) return Promise.reject(new Error('Pick an end time in the future, after the start.'));
          s.endsAt = a.endsAt; s.seq++; return Promise.resolve(done({}));
        case 'endNow':
          if (!E.endGame(s, Date.now())) return Promise.reject(new Error('The game is not running.'));
          return Promise.resolve(done({}));
        case 'startNow':
          if (!E.startGame(s, Date.now())) return Promise.reject(new Error('The game has already started.'));
          return Promise.resolve(done({}));
        case 'simulate': for (var i = 0; i < (a.days || 3); i++) self._botsPlay(true); return Promise.resolve(done({ day: s.day }));
        case 'approve': return Promise.resolve(done(E.completeTask(s, a.pid, a.task, { by: 'host' })));
        case 'reject': return Promise.resolve(done(E.rejectClaim(s, a.pid, a.task)));
        case 'setpos': return Promise.resolve(done(E.setPosition(s, a.pid, a.pos, { apply: !!a.apply })));
        case 'card': return Promise.resolve(done(E.hostCard(s, a.pid, a.card)));
        case 'resetPlayer': return Promise.resolve(done(E.resetPlayer(s, a.pid)));
        case 'removePlayer': E.removePlayer(s, a.pid); if (self.me === a.pid) self.me = null; return Promise.resolve(done({}));
        case 'clearPlayers': if (!E.clearPlayers(s)) return Promise.reject(new Error('You can only clear sign-ups before the game starts.')); self.me = null; return Promise.resolve(done({}));
        case 'signups': if (s.status !== 'signup') return Promise.reject(new Error('The game has already started.')); if (a.closed) s.signupsClosed = true; else delete s.signupsClosed; s.seq++; return Promise.resolve(done({}));
        case 'clearRoute': { var q = s.players[a.pid]; q.route = null; q.pos = -1; q.tasks = []; return Promise.resolve(done({})); }
        case 'settings': Object.assign(s.settings, a.patch || {}); return Promise.resolve(done(s.settings));
        case 'theme':
          s.themeId = a.theme; s.title = C.themes[a.theme].title;
          var words = C.cardsFor(a.theme), byId = {}; words.forEach(function (c) { byId[c.id] = c; });
          s.cards = s.cards.map(function (c) { return byId[c.id] ? Object.assign({}, c, { title: byId[c.id].title, art: byId[c.id].art, text: byId[c.id].text }) : c; });
          return Promise.resolve(done({}));
        case 'hallRemove': {
          self.hall = self.hall.filter(function (h) { return h.id !== a.id; });
          (self.hallHidden = self.hallHidden || []).push(a.id); self._saveHall(); s.seq++;
          return Promise.resolve(done({}));
        }
        case 'newGame': {
          var keepMe = self.me;
          var st0 = a.startsAt > Date.now() + 60000 ? a.startsAt : null;
          self.fresh(a.theme || s.themeId, a.board || null, !!a.history, st0, a.endsAt > (st0 || Date.now()) + 3600000 ? a.endsAt : null);
          if (keepMe && !self.state.players[keepMe]) self.me = 'msploit';
          return Promise.resolve(done({}));
        }
        case 'clearGame': {
          if (s.status === 'running') return Promise.reject(new Error('This game is still running. End it first, then clear it.'));
          var cs = a.startsAt > Date.now() + 60000 ? a.startsAt : null, ct = a.theme || s.themeId;
          var ns = E.createGame({ board: C.boardFor((C.themes[ct] || {}).mapSet), cards: C.cardsFor(ct), themeId: ct, title: C.themes[ct].title, settings: s.settings, status: 'signup', startsAt: cs, endsAt: a.endsAt > (cs || Date.now()) + 3600000 ? a.endsAt : null });
          ns.seq = (s.seq || 0) + 1; self.state = ns; self.me = null;
          return Promise.resolve(done({}));
        }
        default: return Promise.reject(new Error('Unknown action ' + name));
      }
    } catch (e) { return Promise.reject(e); }
  };

  // ---- live ---------------------------------------------------------------------
  // The page is on GitHub Pages and the Worker is on its own domain, so sign-in uses
  // a bearer token kept in localStorage (cross-site cookies are blocked by most browsers).
  var TOKEN_KEY = 'cg.token';
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  // After Discord login the Worker sends us back with #token=... in the address.
  function takeTokenFromHash() {
    var m = location.hash.match(/[#&]token=([^&]+)/);
    if (m) { setToken(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
  }

  // Each clan Discord server has its own game. The page remembers which one you opened last;
  // a ?clan= link (from a notification or a Discord post) picks one directly.
  var CLAN_KEY = 'cg.clan';
  function savedClan() { try { return localStorage.getItem(CLAN_KEY) || ''; } catch (e) { return ''; } }
  function saveClan(id) { try { if (id) localStorage.setItem(CLAN_KEY, id); } catch (e) {} }
  function withClan(path, clan) { return clan ? path + (path.indexOf('?') >= 0 ? '&' : '?') + 'clan=' + encodeURIComponent(clan) : path; }
  function takeClanFromUrl() {
    var q = new URLSearchParams(location.search), c = q.get('clan');
    if (!c) return '';
    saveClan(c); q.delete('clan');
    var rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    return c;
  }
  function switchClan(id) { saveClan(id); location.reload(); }

  function LiveStore(api, cfg) {
    var ev = listeners();
    this.mode = 'live';
    this.api = api.replace(/\/+$/, '');
    this.on = ev.on; this._emit = ev.emit;
    this.user = cfg.user || null;
    this.isHost = !!cfg.isHost;
    this.me = cfg.pid || null;
    this.cfg = cfg;
    this.vapidKey = cfg.vapidKey || '';
    this.canPlay = cfg.access === 'ok';
    this.clan = cfg.clan || '';
    this.clans = cfg.clans || [];
    this.state = null;
    this._seq = -1;
  }
  LiveStore.prototype.undoInfo = function () { return this.undo || { ok: false, list: [] }; };
  LiveStore.prototype.visits = function () { return this._fetch('/api/host/visits'); };
  LiveStore.prototype._fetch = function (path, opts) {
    opts = opts || {};
    var h = opts.headers || {};
    var t = token(); if (t) h.authorization = 'Bearer ' + t;
    opts.headers = h;
    return fetch(this.api + withClan(path, this.clan), opts).then(json);
  };
  LiveStore.prototype.post = function (path, data) {
    return this._fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) });
  };
  LiveStore.prototype.loginUrl = function () { return this.api + '/auth/login?return=' + encodeURIComponent(location.origin + location.pathname); };
  LiveStore.prototype.logout = function () { setToken(''); location.reload(); };
  LiveStore.prototype.load = function () {
    var self = this;
    return this._fetch('/api/state').then(function (r) { self._apply(r); return self.state; });
  };
  LiveStore.prototype._apply = function (r) {
    if (r.state) { this.state = r.state; this._seq = r.state.seq; }
    if (r.me !== undefined) this.me = r.me;
    if (r.isHost !== undefined) this.isHost = r.isHost;
    if (r.user !== undefined) this.user = r.user;
    if (r.access !== undefined) this.access = r.access;
    if (r.discord !== undefined) this.discord = r.discord;
    if (r.undo !== undefined) this.undo = r.undo;
    if (r.hostOut !== undefined) this.hostOut = r.hostOut;
    if (r.admins !== undefined) this.admins = r.admins || [];
    if (r.hall !== undefined) this.hall = r.hall;
    if (r.canPlay !== undefined) this.canPlay = r.canPlay;
    if (r.online !== undefined) this.online = r.online || [];
  };
  LiveStore.prototype.poll = function () {
    var self = this;
    return this._fetch('/api/state?since=' + this._seq).then(function (r) {
      if (r.state && r.state.seq !== self._seq) { self._apply(r); self._emit({ action: 'poll' }); }
      else if (r.online && (r.online.slice().sort().join() !== (self.online || []).slice().sort().join())) { self.online = r.online; self._emit({ action: 'online' }); }
    }).catch(function () {});
  };
  LiveStore.prototype.act = function (name, a) {
    var self = this;
    return this._fetch('/api/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name, args: a || {} }) })
      .then(function (r) { self._apply(r); self._emit({ action: name, result: r.result }); return r.result; });
  };
  // Results image goes to the Discord channel through the Worker's webhook.
  LiveStore.prototype.postResults = function (blob, text) {
    var fd = new FormData(); fd.append('file', blob, 'results.png'); fd.append('text', text || '');
    return this._fetch('/api/host/results', { method: 'POST', body: fd });
  };
  function json(r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.code = j.code; e.status = r.status; throw e; }
      return j;
    });
  }

  // A closed door instead of the game: not signed in, waiting to be let in, or server not reachable.
  function Gate(kind, api, cfg) {
    this.mode = 'gate'; this.kind = kind; this.api = api ? api.replace(/\/+$/, '') : ''; this.user = (cfg && cfg.user) || null; this.startsAt = (cfg && cfg.startsAt) || null;
    this.clan = (cfg && cfg.clan) || ''; this.clans = (cfg && cfg.clans) || []; this.theme = (cfg && cfg.theme) || '';
  }
  Gate.prototype.loginUrl = LiveStore.prototype.loginUrl;
  Gate.prototype.logout = LiveStore.prototype.logout;

  // The demo game only runs on your own computer (opening the files, or localhost) for designing and testing.
  function isLocal() { return location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }

  function detect() {
    var q = new URLSearchParams(location.search);
    var api = (root.CGConfig && root.CGConfig.api) || '';
    if (isLocal() && (!api || q.get('demo') === '1')) return Promise.resolve(new DemoStore());
    if (!api) return Promise.resolve(new Gate('closed'));
    takeTokenFromHash();
    var t = token(), want = takeClanFromUrl() || savedClan();
    return fetch(api.replace(/\/+$/, '') + withClan('/api/config', want), { headers: t ? { authorization: 'Bearer ' + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error('no api'); return r.json(); })
      .then(function (cfg) {
        if (!cfg || !cfg.live) return new Gate('down', api);
        if (cfg.access === 'signin' || !cfg.user) return new Gate('signin', api, cfg);
        // In more than one clan server and never picked: ask which game first.
        if ((cfg.clans || []).length > 1 && !want) return new Gate('choose', api, cfg);
        if (cfg.clan) saveClan(cfg.clan);
        if (cfg.access === 'ok' || cfg.access === 'pending') return new LiveStore(api, cfg);
        return new Gate('signin', api, cfg);
      }, function () { return new Gate('down', api); });
  }

  root.CGStore = { detect: detect, switchClan: switchClan, DemoStore: DemoStore, LiveStore: LiveStore, DEMO_PLAYERS: DEMO_PLAYERS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
