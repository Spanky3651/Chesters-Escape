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
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && saved.state && saved.state.v === E.VERSION) { this.state = saved.state; this.me = saved.me; }
    else this.fresh('cemetery', null, true);
  }

  DemoStore.prototype.fresh = function (themeId, board, withHistory, startsAt) {
    var b = board || C.boards['chester-escape']();
    var s = E.createGame({ board: b, cards: C.cardsFor(themeId), themeId: themeId, title: C.themes[themeId].title, status: startsAt ? 'signup' : 'running', startsAt: startsAt || null });
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
    s.order.forEach(function (pid) {
      var p = s.players[pid]; if (!p.bot || p.finished || !p.route) return;
      p.tasks.slice().forEach(function (t) { if (Math.random() < 0.85) E.completeTask(s, pid, t.id, { by: 'beatleader', demo: true, diff: ['Hard', 'Expert', 'ExpertPlus'][Math.floor(Math.random() * 3)], acc: 0.88 + Math.random() * 0.08 }); });
      var guard = 0;
      while (E.canRoll(s, pid).ok && guard++ < 4) {
        E.roll(s, pid, { rng: rng });
        p.tasks.slice().forEach(function (t) { if (Math.random() < 0.35) E.completeTask(s, pid, t.id, { by: 'beatleader', demo: true, diff: 'Expert', acc: 0.9 + Math.random() * 0.05 }); });
      }
    });
  };

  DemoStore.prototype.load = function () { return Promise.resolve(this.state); };

  DemoStore.prototype.act = function (name, a) {
    var self = this, s = this.state, me = this.me;
    a = a || {};
    function done(res) { self._save(); self._emit({ action: name, result: res }); return res; }
    try {
      switch (name) {
        case 'join': {
          var id = a.id || ('p' + Date.now().toString(36));
          E.addPlayer(s, { id: id, name: a.name, avatar: a.avatar, blId: a.blId });
          self.me = id;
          return Promise.resolve(done({ pid: id }));
        }
        case 'playAs': self.me = a.pid; return Promise.resolve(done({}));
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
          if (!(a.startsAt > Date.now() + 60000)) return Promise.reject(new Error('Pick a start time in the future.'));
          s.startsAt = a.startsAt; s.seq++; return Promise.resolve(done({}));
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
        case 'clearRoute': { var q = s.players[a.pid]; q.route = null; q.pos = -1; q.tasks = []; return Promise.resolve(done({})); }
        case 'settings': Object.assign(s.settings, a.patch || {}); return Promise.resolve(done(s.settings));
        case 'theme':
          s.themeId = a.theme; s.title = C.themes[a.theme].title;
          var words = C.cardsFor(a.theme), byId = {}; words.forEach(function (c) { byId[c.id] = c; });
          s.cards = s.cards.map(function (c) { return byId[c.id] ? Object.assign({}, c, { title: byId[c.id].title, art: byId[c.id].art, text: byId[c.id].text }) : c; });
          return Promise.resolve(done({}));
        case 'newGame': {
          var keepMe = self.me;
          self.fresh(a.theme || s.themeId, a.board || null, !!a.history, a.startsAt > Date.now() + 60000 ? a.startsAt : null);
          if (keepMe && !self.state.players[keepMe]) self.me = 'msploit';
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
    this.state = null;
    this._seq = -1;
  }
  LiveStore.prototype._fetch = function (path, opts) {
    opts = opts || {};
    var h = opts.headers || {};
    var t = token(); if (t) h.authorization = 'Bearer ' + t;
    opts.headers = h;
    return fetch(this.api + path, opts).then(json);
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
    if (r.canPlay !== undefined) this.canPlay = r.canPlay;
  };
  LiveStore.prototype.poll = function () {
    var self = this;
    return this._fetch('/api/state?since=' + this._seq).then(function (r) {
      if (r.state && r.state.seq !== self._seq) { self._apply(r); self._emit({ action: 'poll' }); }
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
    var t = token();
    return fetch(api.replace(/\/+$/, '') + '/api/config', { headers: t ? { authorization: 'Bearer ' + t } : {} })
      .then(function (r) { if (!r.ok) throw new Error('no api'); return r.json(); })
      .then(function (cfg) {
        if (!cfg || !cfg.live) return new Gate('down', api);
        if (cfg.access === 'ok' || cfg.access === 'pending') return new LiveStore(api, cfg);
        return new Gate('signin', api, cfg);
      }, function () { return new Gate('down', api); });
  }

  root.CGStore = { detect: detect, DemoStore: DemoStore, LiveStore: LiveStore, DEMO_PLAYERS: DEMO_PLAYERS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
