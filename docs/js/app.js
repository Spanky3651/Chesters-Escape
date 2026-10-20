/*
 * Chester's Escape - the game page.
 */
(function () {
  'use strict';
  var E = window.CGEngine, C = window.CGContent, R = window.CGRender, S = window.CGServices;
  var $ = function (id) { return document.getElementById(id); };
  var esc = R.esc;

  var store = null, die = null, svgEl = null, builtKey = '', animating = false, feedMode = 'me';
  var muted = false;
  try { muted = localStorage.getItem('cg.muted') === '1'; } catch (e) {}

  function st() { return store.state; }
  // GoatCounter events (show up under app/... in the dashboard). Never sends names or IDs.
  function track(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'app/' + name, title: name, event: true }); } catch (e) {} }
  function theme() { return C.themes[st().themeId] || C.themes.cemetery; }
  function me() { return store.me && st().players[store.me] ? st().players[store.me] : null; }

  // ---- sound ------------------------------------------------------------------
  var ac = null;
  function audio() { if (muted) return null; try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) { return null; } return ac; }
  function blip(freq, dur, type, vol, slide) {
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type || 'triangle'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || .08, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + .02);
  }
  function rattle() {
    var a = audio(); if (!a) return;
    var len = .05, buf = a.createBuffer(1, a.sampleRate * len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    var src = a.createBufferSource(), g = a.createGain(), f = a.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 1400; g.gain.value = .25;
    src.buffer = buf; src.connect(f); f.connect(g); g.connect(a.destination); src.start();
  }
  var sfx = {
    hop: function () { blip(520 + Math.random() * 80, .09, 'sine', .06); },
    land: function () { blip(300, .18, 'triangle', .09, 220); },
    good: function () { blip(660, .12, 'triangle', .08); setTimeout(function () { blip(880, .18, 'triangle', .08); }, 110); },
    bad: function () { blip(220, .35, 'sawtooth', .05, 110); },
    card: function () { blip(900, .25, 'sine', .05, 300); },
    win: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { blip(f, .3, 'triangle', .08); }, i * 140); }); }
  };

  // ---- helpers ----------------------------------------------------------------
  var toastT = null;
  function toast(msg, kind) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3800);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function spaceName(sp) {
    if (!sp) return 'the start';
    var k = sp.kind && theme().kinds[sp.kind];
    if (k) return k.title.replace(/!+$/, '');
    if (sp.type === 'map') return '!bsr ' + sp.bsr.join(' or ');
    if (sp.type === 'card') return 'a card drop';
    return sp.type;
  }
  function avatarHtml(p, cls) {
    var col = R.playerColor(st(), p.id);
    if (p.avatar) return '<img class="' + cls + '" style="--c:' + col + '" src="' + esc(p.avatar) + '" alt="" onerror="if(this.parentNode)this.outerHTML=\'<span class=&quot;' + cls + '&quot; style=&quot;--c:' + col + '&quot;>' + esc(R.initials(p.name)) + '</span>\'">';
    return '<span class="' + cls + '" style="--c:' + col + '">' + esc(R.initials(p.name)) + '</span>';
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied ' + text, 'good'); }, function () { window.prompt('Copy this:', text); });
  }
  function fail(e) { console.error(e); toast(e && e.message ? e.message : 'Something went wrong.', 'bad'); }

  // ---- board ------------------------------------------------------------------
  function renderBoard(force) {
    var s = st(), t = theme();
    var key = s.themeId + '|' + s.board.id + '|' + (s.board.background ? s.board.background.length : 0) + '|' + Object.keys(s.board.spaces).length;
    if (force || key !== builtKey) {
      $('boardWrap').innerHTML = R.board(s.board, t, { focusable: true });
      svgEl = $('boardWrap').querySelector('svg');
      builtKey = key;
      addCovers();
    }
    placeTokens();
    markMine();
    previewMoves();
  }
  // Song covers on the map tiles, under the !bsr text. Skipped when the board art shows the spaces.
  function addCovers() {
    var s = st(), svg = svgEl; if (!svg || (s.board.background && s.board.artSpaces)) return;
    var keys = [];
    Object.keys(s.board.spaces).forEach(function (id) { var sp = s.board.spaces[id]; if (sp.type === 'map' && sp.bsr && sp.bsr[0]) keys.push(sp.bsr[0]); });
    S.maps(keys).then(function (found) {
      if (svg !== svgEl) return;   // the board was rebuilt meanwhile
      var NS = 'http://www.w3.org/2000/svg';
      Array.prototype.forEach.call(svg.querySelectorAll('.sp-map'), function (g) {
        var sp = s.board.spaces[g.getAttribute('data-id')], m = sp && sp.bsr && found[String(sp.bsr[0]).toLowerCase()];
        if (!m || !m.cover || g.querySelector('.cover')) return;
        var img = document.createElementNS(NS, 'image'), shade = document.createElementNS(NS, 'rect');
        [['class', 'cover'], ['href', m.cover], ['x', -27], ['y', -27], ['width', 54], ['height', 54], ['preserveAspectRatio', 'xMidYMid slice']].forEach(function (a) { img.setAttribute(a[0], a[1]); });
        [['class', 'cover-shade'], ['x', -27], ['y', -27], ['width', 54], ['height', 54], ['rx', 4]].forEach(function (a) { shade.setAttribute(a[0], a[1]); });
        img.addEventListener('error', function () { img.remove(); shade.remove(); g.classList.remove('has-cover'); });
        var first = g.querySelector('text');
        g.insertBefore(img, first); g.insertBefore(shade, first);
        g.classList.add('has-cover');
      });
    });
  }
  function placeTokens(overrides) { R.placeTokens(svgEl, st(), theme(), { me: store.me, overrides: overrides }); }
  function markMine() {
    Array.prototype.forEach.call(svgEl.querySelectorAll('.sp.mine'), function (g) { g.classList.remove('mine'); });
    var p = me(); if (!p || !p.route || p.pos < 0) return;
    var id = st().board.routes[p.route][p.pos];
    var g = svgEl.querySelector('.sp[data-id="' + id + '"]'); if (g) g.classList.add('mine');
  }
  // Glow the spaces a d4 can reach (1 to 4 ahead) when you are ready to roll.
  function previewMoves() {
    var hl = svgEl.querySelector('.hl'); if (!hl) return;
    Array.prototype.forEach.call(hl.querySelectorAll('.prev'), function (x) { x.remove(); });
    var p = me(); if (animating || !p || !E.canRoll(st(), p.id).ok) return;
    var last = E.exitIndex(st(), p), o = '', seen = {};
    for (var k = 1; k <= (st().settings.dieSides || 4); k++) {
      var idx = p.pos + k; if (idx > last) { if (st().settings.exactFinish) break; idx = last; }
      if (seen[idx]) continue; seen[idx] = 1;
      var xy = posXY(p, idx);
      o += '<g class="prev" style="animation-delay:' + (k * .12) + 's"><rect x="' + (xy.x - 32) + '" y="' + (xy.y - 32) + '" width="64" height="64" rx="8" class="prev-ring"/>' +
        '<circle cx="' + (xy.x - 26) + '" cy="' + (xy.y - 26) + '" r="11" class="prev-dot"/><text x="' + (xy.x - 26) + '" y="' + (xy.y - 22) + '" text-anchor="middle" class="prev-n">' + (idx === last && p.pos + k > last ? k + '+' : k) + '</text></g>';
    }
    hl.insertAdjacentHTML('beforeend', o);
  }
  function ripple(xy) {
    var hl = svgEl.querySelector('.hl'); if (!hl || !xy) return;
    hl.insertAdjacentHTML('beforeend', '<circle class="ripple" cx="' + xy.x + '" cy="' + xy.y + '" r="30"/><circle class="ripple r2" cx="' + xy.x + '" cy="' + xy.y + '" r="30"/>');
    setTimeout(function () { Array.prototype.forEach.call(hl.querySelectorAll('.ripple'), function (x) { x.remove(); }); }, 1300);
  }
  function isPhone() { return window.matchMedia('(max-width: 760px)').matches; }

  function posXY(p, idx) {
    var b = st().board;
    if (idx < 0) { var s0 = b.starts[p.route]; return { x: s0.x, y: s0.y }; }
    var sp = b.spaces[b.routes[p.route][idx]]; return { x: sp.x, y: sp.y };
  }

  // Zoomed board on phones: scroll so your token is in view.
  function centerOnMe() {
    var w = $('boardWrap'), p = me(); if (!w.classList.contains('zoomed')) return;
    var xy = p && p.route ? posXY(p, p.pos) : { x: 500, y: 500 };
    var scale = svgEl.getBoundingClientRect().width / 1000;
    w.scrollLeft = xy.x * scale - w.clientWidth / 2; w.scrollTop = xy.y * scale - w.clientHeight / 2;
  }

  function followToken(xy) {
    var w = $('boardWrap'); if (!w.classList.contains('zoomed') || !xy) return;
    var scale = svgEl.getBoundingClientRect().width / 1000;
    w.scrollTo({ left: xy.x * scale - w.clientWidth / 2, top: xy.y * scale - w.clientHeight / 2, behavior: 'smooth' });
  }

  // ---- header ----------------------------------------------------------------
  // Things waiting on the host: runs to approve and people waiting to get in.
  var lastTodo = 0;
  function hostTodo() {
    var s = st(), claims = 0;
    s.order.forEach(function (pid) { claims += s.players[pid].claims.length; });
    var pending = store.access && store.access.pending ? store.access.pending.length : 0;
    return { claims: claims, pending: pending, total: claims + pending };
  }
  // ---- clan games ------------------------------------------------------------------------------
  // Players in more than one clan server get a switcher with each server's icon.
  function clanIcon(c, cls) {
    var letters = String(c.name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
    var fallback = '<span class="' + cls + '" aria-hidden="true"' + (c.icon ? ' hidden' : '') + '>' + esc(letters) + '</span>';
    return (c.icon ? '<img class="' + cls + '" src="' + esc(c.icon) + '" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' : '') + fallback;
  }
  var clanSwitchDone = false;
  function renderClanSwitch(src) {
    var el = $('clanSwitch'), list = (src && src.clans) || [];
    if (!el || clanSwitchDone || list.length < 2) return;
    clanSwitchDone = true;
    el.hidden = false;
    el.innerHTML = list.map(function (c) {
      var on = c.id === src.clan;
      return '<button type="button" class="clan-btn" data-clan="' + esc(c.id) + '" aria-pressed="' + on + '" title="' + esc(on ? 'You are in the ' + c.name + ' game' : 'Switch to the ' + c.name + ' game') + '">' + clanIcon(c, 'clan-ic') + '<span class="nm">' + esc(c.name) + '</span></button>';
    }).join('');
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-clan]'); if (!b) return;
    var cur = store && store.clan;
    if (b.dataset.clan === cur && b.classList.contains('clan-btn')) return;
    track('clan-' + b.dataset.clan);
    window.CGStore.switchClan(b.dataset.clan);
  });

  function renderHeader() {
    var s = st(), t = theme();
    renderClanSwitch(store);
    document.body.setAttribute('data-theme', t.look || t.id);
    $('gameTitle').textContent = t.title;
    $('brandCrow').innerHTML = R.hero(0, 0, 1, t);
    $('dayNum').textContent = s.status === 'finished' ? 'Game over' : s.status === 'signup' ? 'Sign-ups open' : 'Day ' + s.day;
    $('hostBtn').hidden = !store.isHost;
    var todo = store.isHost ? hostTodo() : { total: 0 };
    document.title = (todo.total ? '(' + todo.total + ') ' : '') + t.title;
    var hb = $('hostBtn');
    hb.innerHTML = 'Host tools' + (todo.total ? '<span class="nav-badge" aria-hidden="true">' + todo.total + '</span>' : '');
    hb.setAttribute('aria-label', todo.total ? 'Host tools, ' + todo.total + ' waiting on you' : 'Host tools');
    hb.title = todo.total ? [todo.claims ? todo.claims + ' run' + (todo.claims === 1 ? '' : 's') + ' to approve' : '', todo.pending ? todo.pending + ' waiting to get in' : ''].filter(Boolean).join(', ') : '';
    if (todo.total > lastTodo) { var nb = hb.querySelector('.nav-badge'); if (nb) { void nb.offsetWidth; nb.classList.add('bump'); } }
    lastTodo = todo.total;
    $('designerLink').hidden = !store.isHost;   // host only, like Host tools
    $('muteBtn').setAttribute('aria-pressed', muted ? 'true' : 'false');
    var demo = store.mode === 'demo';
    $('demoBar').hidden = !demo;
    if (demo) {
      var sel = $('playAs');
      sel.innerHTML = s.order.map(function (pid) { var p = s.players[pid]; return '<option value="' + esc(pid) + '"' + (pid === store.me ? ' selected' : '') + '>' + esc(p.name) + (p.bot ? ' (bot)' : '') + '</option>'; }).join('');
    }
    tickClock();
  }
  function tickClock() {
    var s = st(); if (!s) return;
    var el = $('dayClock');
    if (s.status === 'signup') { el.textContent = s.startsAt ? 'Starts in ' + fmtLeft(s.startsAt - Date.now(), true) : 'Starting soon'; return; }
    if (s.status === 'finished') { el.textContent = 'Final standings are in'; return; }
    if (store.mode === 'demo') { el.textContent = 'The host starts each new day' + (s.endsAt ? ' · ends in ' + fmtLeft(s.endsAt - Date.now(), true) : ''); return; }
    var at = E.nextCutoff(s.settings), left = at - Date.now();
    if (left < 0) left = 0;
    var h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    var when = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.textContent = 'Next day in ' + (h ? h + 'h ' : '') + m + 'm (' + when + ')' + (s.endsAt && s.status === 'running' ? ' · ends in ' + fmtLeft(s.endsAt - Date.now(), true) : '');
  }

  // ---- countdown to the start ----------------------------------------------------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtLeft(ms, short) {
    ms = Math.max(0, ms);
    var d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), sec = Math.floor(ms % 60000 / 1000);
    if (d) return d + 'd ' + h + 'h' + (short ? '' : ' ' + m + 'm');
    if (h) return h + 'h ' + m + 'm';
    return m + 'm ' + pad2(sec) + 's';
  }
  function startWhen(ts) { return new Date(ts).toLocaleString([], { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function cdSegments(ms) {
    ms = Math.max(0, ms);
    var parts = [[Math.floor(ms / 86400000), 'days'], [Math.floor(ms % 86400000 / 3600000), 'hours'], [Math.floor(ms % 3600000 / 60000), 'min'], [Math.floor(ms % 60000 / 1000), 'sec']];
    return parts.map(function (x) { return '<span class="cd-seg"><b>' + pad2(x[0]) + '</b><i>' + x[1] + '</i></span>'; }).join('');
  }
  function countdownHtml(ts, label) {
    if (!ts) return '<div class="countdown"><span class="cd-label">' + esc(label || 'The game starts soon') + '</span><span class="cd-date">The host will set the start time.</span></div>';
    return '<div class="countdown"><span class="cd-label">' + esc(label || 'The escape starts in') + '</span>' +
      '<div class="cd-time" data-countdown="' + ts + '" role="timer" aria-label="Starts ' + esc(startWhen(ts)) + '">' + cdSegments(ts - Date.now()) + '</div>' +
      '<span class="cd-date">' + esc(startWhen(ts)) + '</span></div>';
  }
  // Runs every second while sign-ups are open. At zero, start the demo or ask the server.
  var kickAt = 0, starting = false;
  function tickCountdowns() {
    var els = document.querySelectorAll('[data-countdown]');
    Array.prototype.forEach.call(els, function (el) {
      var left = Number(el.dataset.countdown) - Date.now();
      if (el.classList.contains('cd-time')) el.innerHTML = left > 0 ? cdSegments(left) : '<span class="cd-now">Starting now</span>';
      else el.textContent = left > 0 ? fmtLeft(left) : 'now';
    });
    var s = store && store.state;
    if (s && s.status === 'running' && s.endsAt && Date.now() >= s.endsAt) {
      if (store.mode === 'demo') { if (!starting) { starting = true; store.act('endNow').catch(function () {}).then(function () { starting = false; }); } }
      else if (store.mode === 'live' && Date.now() - kickAt > 5000) { kickAt = Date.now(); store.poll(); }
      return;
    }
    if (!s || s.status !== 'signup') return;
    tickClock();
    if (!s.startsAt || Date.now() < s.startsAt) return;
    if (store.mode === 'demo') { if (!starting) { starting = true; store.act('startNow').catch(function () {}).then(function () { starting = false; }); } }
    else if (store.mode === 'live' && Date.now() - kickAt > 5000) { kickAt = Date.now(); store.poll(); }
  }

  // ---- me panel ----------------------------------------------------------------
  function renderMe() {
    var p = me(), el = $('mePanel'), s = st();
    if (!p) {
      if (store.mode === 'live' && store.user && !store.canPlay) {
        el.innerHTML = '<h2>You\'re on the list</h2><p class="lede">Thanks, ' + esc(store.user.name) + '. You can watch the game now. The host will let you in to play.</p>' +
          '<div class="row"><button type="button" class="btn ghost" id="checkAgain">Check again</button><button type="button" class="btn link" id="logoutBtn">Sign out</button></div>';
        return;
      }
      if (store.mode === 'live' && !store.user) {
        el.innerHTML = '<h2>Join the escape</h2><p class="lede">Sign in with Discord so the game knows which token is yours. You only do this once.</p><a class="btn" href="' + esc(store.loginUrl()) + '">Sign in with Discord</a>';
      } else {
        el.innerHTML = '<h2>Join the escape</h2><p class="lede">Link your BeatLeader profile. The game checks it to see when you have played your map.</p><button type="button" class="btn" id="joinBtn">Join the game</button>' +
          (store.mode === 'live' && store.user ? '<p class="why">Signed in as ' + esc(store.user.name) + '. <button type="button" class="btn link" id="logoutBtn">Sign out</button></p>' : '');
      }
      return;
    }
    var col = R.playerColor(s, p.id), route = p.route ? s.board.routeInfo[p.route].name : 'No route yet';
    var r = E.routeOf(s, p), stats = [];
    if (p.route && !p.finished) stats.push('<span class="stat">' + (p.pos < 0 ? 'At the start' : 'Space ' + (p.pos + 1) + ' of ' + r.length) + '</span>');
    if (p.route && !p.finished) stats.push('<span class="stat">' + E.remaining(s, p) + ' to go</span>');
    if (p.shield) stats.push('<span class="stat good">Protected from the next setback</span>');
    if (p.extraRoll) stats.push('<span class="stat good">Bonus roll ready</span>');
    if (p.skip > 0) stats.push('<span class="stat bad">Loses ' + (p.skip > 1 ? 'the next ' + p.skip + ' turns' : 'the next turn') + '</span>');
    if (p.finished) stats.push('<span class="stat good">Escaped on day ' + p.finished.day + ', ' + ordinal(p.finished.place) + ' place</span>');
    el.innerHTML = '<div class="me-row">' + avatarHtml(p, 'me-ava') + '<div><div class="me-name">' + esc(p.name) + '</div><div class="me-sub">' + esc(route) +
      (p.blId ? ' &middot; <a href="https://beatleader.com/u/' + encodeURIComponent(p.blId) + '" target="_blank" rel="noopener">BeatLeader</a>' : '') + '</div></div></div>' +
      (stats.length ? '<div class="me-stats">' + stats.join('') + '</div>' : '') +
      (store.mode === 'live' && store.canPlay && !p.finished && s.status !== 'finished' && E.remindHour(s) != null ? '<div class="push-box me-push" data-kind="player"></div>' : '');
    el.style.setProperty('--c', col);
    fillPush();
  }

  // ---- turn panel --------------------------------------------------------------
  function renderTurn() {
    var p = me(), el = $('turnPanel'), s = st(), t = theme();
    if (s.status === 'finished') {
      var mine = p && (s.final || []).filter(function (r) { return r.pid === p.id; })[0];
      el.innerHTML = '<h2>Game over</h2><p class="lede">' + (mine ? (mine.escaped ? 'You escaped on day ' + mine.day + ' and finished ' + ordinal(mine.place) + '.' : 'You finished ' + ordinal(mine.place) + ', ' + mine.left + ' spaces from the ' + esc(t.goal) + '.') : 'The final standings are in.') + '</p>' +
        '<button type="button" class="btn" id="finaleBtn">See the final standings</button>';
      return;
    }
    var pre = s.status === 'signup' ? countdownHtml(s.startsAt) : '';
    if (pre && p && p.route) {
      el.innerHTML = '<h2>You\'re signed up</h2>' + pre + '<p class="why">You\'re on the ' + esc(s.board.routeInfo[p.route].name.toLowerCase()) + '. Your first roll unlocks when the countdown ends. Come back then and roll the d4.</p>';
      return;
    }
    if (pre && !p) { el.innerHTML = '<h2>Sign-ups are open</h2>' + pre + '<p class="empty">' + (store.mode === 'live' && !store.canPlay ? 'Once the host lets you in, you can join and pick your route before the start.' : 'Join now and pick your route. Everyone rolls for the first time when the countdown ends.') + '</p>'; return; }
    if (!p) { el.innerHTML = '<h2>Your turn</h2><p class="empty">' + (store.mode === 'live' && !store.canPlay ? 'Once the host lets you in, you can join and get a token on the board.' : 'Join the game to get a token on the board.') + '</p>'; return; }
    if (!p.route) {
      el.innerHTML = '<h2>Pick your route</h2>' + pre + '<p class="why">You can\'t change it later.</p><div class="routes">' +
        ['longer', 'riskier'].map(function (r) {
          var info = s.board.routeInfo[r];
          return '<button type="button" class="route-card' + (r === 'riskier' ? ' risk' : '') + '" data-route="' + r + '"><b>' + esc(info.name) + '</b><span>' + esc(routeBlurb(r)) + '</span></button>';
        }).join('') + '</div>';
      return;
    }
    var html = '<h2>' + (p.finished ? 'Chester is free' : 'Your turn') + '</h2>';
    p.tasks.forEach(function (task) { html += taskHtml(p, task); });
    var can = E.canRoll(s, p.id);
    if (!p.finished) {
      html += '<div class="roll-box"><div id="dieSlot"></div><div class="roll-copy">';
      if (can.ok) html += '<b>' + (p.extraRoll && p.rolledDay === s.day ? 'Bonus roll' : 'Ready to roll') + '</b><p>Roll the d4 and move that many spaces.</p><button type="button" class="btn" id="rollBtn">Roll the d4</button>';
      else html += '<b>' + esc(rollTitle(can)) + '</b><p>' + esc(rollWhy(can, p)) + '</p><button type="button" class="btn" id="rollBtn" disabled>Roll the d4</button>';
      html += '</div></div>';
    } else {
      html += '<p>You reached the ' + esc(t.goal) + ' on day ' + p.finished.day + ' and finished ' + ordinal(p.finished.place) + '.</p>';
    }
    el.innerHTML = html;
    var slot = $('dieSlot');
    if (slot) { if (!die || !document.body.contains(die.el)) die = new window.CGDice.Die(slot); else slot.replaceWith(die.el); die.el.classList.toggle('disabled', !can.ok); }
    p.tasks.forEach(function (task) { fillTask(task); });
  }
  // The built-in board's route blurbs follow the theme. A designer board keeps its own words.
  function routeBlurb(r) {
    var s = st(), t = theme(), info = s.board.routeInfo[r] || {}, builtIn = C.boards['chester-escape']().routeInfo[r] || {};
    if (t.routes && t.routes[r] && (!info.blurb || info.blurb === builtIn.blurb)) return t.routes[r].replace('{n}', (s.board.routes[r] || []).length);
    return info.blurb || '';
  }
  function rollTitle(c) { return { task: 'Play your map', rolled: 'Rolled for today', skip: 'Turn lost', 'not-running': 'Waiting', finished: 'Escaped' }[c.code] || 'Not yet'; }
  function rollWhy(c, p) {
    if (c.code === 'task') return 'Your next roll unlocks once BeatLeader shows a pass on ' + (p.tasks.length > 1 ? 'each of these maps' : 'this map') + '. Any difficulty, any modifiers.';
    if (c.code === 'rolled') return store.mode === 'demo' ? 'Come back tomorrow. In the demo, use Start the next day.' : 'Your next roll opens when the day turns over.';
    if (c.code === 'skip') return p.skip ? 'You sit this one out. ' + p.skip + ' more after today.' : 'You sit this one out. You can roll again tomorrow.';
    return c.reason;
  }
  function taskHtml(p, task) {
    var s = st(), why = '';
    if (task.bonus) why = 'Bonus map';
    else if (task.card) { var cd = E.cardById(s, task.card); why = (cd ? cd.title : 'Card') + ' card'; }
    else if (task.space) { var sp = s.board.spaces[task.space]; why = sp && sp.kind ? theme().kinds[sp.kind].title : 'Your space'; }
    var claimed = p.claims.some(function (c) { return c.task === task.id; });
    var keys = task.bsr.map(function (k) { return '<button type="button" class="key" data-copy="!bsr ' + esc(k) + '" title="Copy !bsr ' + esc(k) + '">!bsr ' + esc(k) + '</button>'; }).join(task.bsr.length > 1 ? '<span class="why">or</span>' : '');
    var html = '<article class="task" data-task="' + esc(task.id) + '">' +
      '<div class="task-head"><span class="task-cover ph" data-cover>' + esc(task.bsr[0]) + '</span><div>' +
      '<div class="task-why">' + esc(why) + '</div><div class="task-song" data-song>Map ' + esc(task.bsr.join(' or ')) + '</div><div class="task-meta" data-meta>Loading map details</div>' +
      '<div class="task-keys">' + keys + '</div></div></div>';
    if (claimed) {
      html += '<p class="task-note">Sent to the host. Your roll unlocks when they approve it.</p>';
    } else {
      html += '<div class="task-actions"><button type="button" class="btn small" data-verify>Check BeatLeader</button>' +
        '<a class="btn small ghost" target="_blank" rel="noopener" href="https://beatsaver.com/maps/' + esc(task.bsr[0]) + '">BeatSaver</a>' +
        '<button type="button" class="btn small link" data-claim>I played it but it didn\'t show up</button>' +
        (store.mode === 'demo' ? '<button type="button" class="btn small link" data-pass>Pretend I passed it</button>' : '') + '</div>' +
        '<div class="task-claim" data-claimform hidden><input type="url" placeholder="Replay link (optional)" aria-label="Replay link"><button type="button" class="btn small ghost" data-claimsend>Send to the host</button></div>';
    }
    return html + '</article>';
  }
  function fillTask(task) {
    var art = document.querySelector('.task[data-task="' + task.id + '"]'); if (!art) return;
    S.map(task.bsr[0]).then(function (m) {
      var cov = art.querySelector('[data-cover]');
      if (cov) cov.outerHTML = '<img class="task-cover" src="' + esc(m.cover) + '" alt="">';
      art.querySelector('[data-song]').textContent = m.name + (m.sub ? ' ' + m.sub : '');
      art.querySelector('[data-meta]').textContent = [m.author, m.mapper ? 'mapped by ' + m.mapper : ''].filter(Boolean).join(', ');
    }, function () { var mm = art.querySelector('[data-meta]'); if (mm) mm.textContent = "Couldn't load map details. The key still works in game."; });
  }

  // ---- feed --------------------------------------------------------------------
  var ICON = { roll: '🎲', land: '📍', task: '🎵', card: '🃏', move: '➡️', skip: '⏸️', start: '↩️', warp: '🌀', cleared: '✅', claim: '📨', 'claim-rejected': '❌', 'lost-turn': '💤', escaped: '🎉', route: '🧭', join: '👋', shield: '🛡️', 'shield-used': '🛡️', again: '🎲', overshoot: '🎯', 'gate-closed': '🔒', 'host-move': '🧹', 'host-reset': '🧹', reshuffle: '🔀', begin: '🏁' };
  function evText(e) {
    var s = st(), t = theme(), sp = e.space ? s.board.spaces[e.space] : null, card = e.card ? E.cardById(s, e.card) : null;
    switch (e.t) {
      case 'roll': return { html: (e.bonus ? 'Bonus roll: ' : 'Rolled a ') + '<b>' + e.n + '</b>' };
      case 'land': return null;
      case 'task': return { html: 'Play <b>!bsr ' + esc(e.bsr.join(' or ')) + '</b>' + (e.bonus ? ' (bonus map)' : sp && sp.kind ? ' (' + esc(t.kinds[sp.kind].title) + ')' : card ? ' (' + esc(card.title) + ')' : '') };
      case 'card': return { html: 'Drew <b>' + esc(card ? card.title : 'a card') + '</b>: ' + esc(card ? C.cardEffectText(card) : ''), cls: card && card.cls === 'trick' ? 'bad' : card && card.cls === 'treasure' ? 'good' : '' };
      case 'move': return { html: (e.n > 0 ? 'Moved ahead ' + e.n : 'Pushed back ' + (-e.n)) + (sp && sp.kind ? ': ' + esc(t.kinds[sp.kind].title) : ''), cls: e.n > 0 ? 'good' : 'bad' };
      case 'skip': return { html: (sp && sp.kind ? esc(t.kinds[sp.kind].title) + ' ' : '') + (e.turns > 1 ? 'Loses ' + e.turns + ' turns' : 'Loses a turn'), cls: 'bad' };
      case 'start': return { html: esc(sp && sp.kind ? t.kinds[sp.kind].title : '') + ' Back to the start', cls: 'bad' };
      case 'warp': return { html: esc(sp && sp.kind ? t.kinds[sp.kind].title : 'Carried away') + ' Now at ' + esc(spaceName(s.board.spaces[e.to])), cls: sp && sp.kind === 'swim' ? 'good' : 'bad' };
      case 'cleared': {
        var pr = e.proof || {}, how = pr.by === 'beatleader' ? 'on BeatLeader' : pr.by === 'host' ? 'by the host' : '';
        var detail = pr.diff ? ' (' + esc(pr.diff.replace('ExpertPlus', 'Expert+')) + (pr.acc ? ', ' + (pr.acc * 100).toFixed(2) + '%' : '') + ')' : '';
        var rp = pr.score ? ' <a href="' + esc(S.replayUrl(pr.score)) + '" target="_blank" rel="noopener">Replay</a>' : '';
        return { html: 'Cleared <b>!bsr ' + esc((e.bsr || []).join(' or ')) + '</b> ' + how + detail + rp, cls: 'good' };
      }
      case 'claim': return { html: 'Asked the host to approve a run' + (e.url ? ' (<a href="' + esc(e.url) + '" target="_blank" rel="noopener">replay</a>)' : '') };
      case 'claim-rejected': return { html: 'The host could not confirm that run', cls: 'bad' };
      case 'lost-turn': return { html: 'Sat out this turn', cls: 'bad' };
      case 'escaped': return { html: '<b>Escaped!</b> ' + ordinal(e.place) + ' place', cls: 'good' };
      case 'route': return { html: 'Took the ' + esc(s.board.routeInfo[e.route].name.toLowerCase()) };
      case 'join': return { html: 'Joined the game' };
      case 'shield': return { html: 'Protected from the next setback', cls: 'good' };
      case 'shield-used': return { html: 'Protection used up. The setback missed', cls: 'good' };
      case 'again': return { html: 'Gets another roll today', cls: 'good' };
      case 'overshoot': return { html: 'Needs exactly ' + e.need + ' to escape' };
      case 'gate-closed': return { html: 'Reached the ' + esc(t.goal) + ', but someone already escaped today. Waits at the gate and walks out on the next roll.', cls: 'bad' };
      case 'host-move': return { html: 'The host moved this token' };
      case 'host-reset': return { html: 'The host reset this token' };
      case 'rest': return null;
      case 'reshuffle': return { html: 'The card deck was reshuffled' };
      default: return null;
    }
  }
  function renderFeed() {
    var s = st(), list = $('feed'), html = '', lastDay = null, shown = 0;
    var evs = s.events.slice().reverse();
    for (var i = 0; i < evs.length && shown < 120; i++) {
      var e = evs[i];
      if (e.t === 'day') { if (feedMode === 'all') html += '<li class="dayline">Day ' + e.day + ' begins</li>'; continue; }
      if (e.t === 'begin') { html += '<li class="dayline">🏁 The game starts. Day 1 begins</li>'; continue; }
      if (feedMode === 'me' && e.pid !== store.me) continue;
      var x = evText(e); if (!x) continue;
      var p = s.players[e.pid];
      html += '<li><span class="ic" aria-hidden="true">' + (ICON[e.t] || '•') + '</span><span>' +
        (feedMode === 'all' && p ? '<span class="who">' + esc(p.name) + '</span> ' : '') +
        '<span class="' + (x.cls || '') + '">' + x.html + '</span> <span class="when">' + (e.pre ? 'sign-up' : 'day ' + e.day) + '</span></span></li>';
      shown++;
    }
    list.innerHTML = html || '<li class="empty" style="display:block">' + (feedMode === 'me' ? 'Your moves show up here.' : 'Nothing has happened yet.') + '</li>';
    Array.prototype.forEach.call(document.querySelectorAll('.seg [data-feed]'), function (b) { b.setAttribute('aria-selected', b.dataset.feed === feedMode ? 'true' : 'false'); });
  }

  // ---- standings -----------------------------------------------------------------
  function renderStandings() {
    var s = st();
    var rank = s.status === 'finished' && s.final ? s.final : E.ranking(s);
    var ids = rank.map(function (r) { return r.pid; }).filter(function (pid) { return s.players[pid]; });
    var placeOf = {}; rank.forEach(function (r) { placeOf[r.pid] = r.place; });
    var html = '<h2>' + (s.status === 'finished' ? 'Final standings' : 'Standings') + '</h2><ol class="st-list">';
    ids.forEach(function (pid, i) {
      var p = s.players[pid], col = R.playerColor(s, pid), pct = Math.round(E.progress(s, p) * 100);
      html += '<li><button type="button" class="st' + (pid === store.me ? ' me' : '') + (p.finished ? ' done' : '') + '" data-pid="' + esc(pid) + '" style="--c:' + col + '">' +
        '<span class="place">' + (p.finished ? ordinal(p.finished.place) : s.status === 'finished' ? ordinal(placeOf[pid]) : placeOf[pid] || i + 1) + '</span>' + avatarHtml(p, 'ava') +
        '<span style="min-width:0"><span class="nm">' + esc(p.name) + '</span> <span class="chip ' + (p.route === 'riskier' ? 'risk' : 'long') + '">' + (p.route === 'riskier' ? 'Riskier' : 'Longer') + '</span>' +
        '<span class="sub" style="display:block">' + esc(statusLine(p)) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span></span></button></li>';
    });
    $('standings').innerHTML = html + '</ol>';
  }
  function statusLine(p) {
    var s = st();
    if (p.finished) return 'Escaped on day ' + p.finished.day;
    if (s.status === 'signup') return 'Signed up, waiting for the start';
    if (s.status === 'finished') return E.remaining(s, p) + ' spaces to go at the end';
    if (p.tasks.length) return 'Playing !bsr ' + p.tasks.map(function (t) { return t.bsr[0]; }).join(', ');
    if (p.skippedDay === s.day) return 'Sitting out today';
    var c = E.canRoll(s, p.id);
    if (c.ok) return 'Ready to roll' + (p.pos >= 0 ? ', ' + E.remaining(s, p) + ' to go' : '');
    if (c.code === 'rolled') return 'Rolled today, ' + E.remaining(s, p) + ' to go';
    return c.reason;
  }

  // Phone action bar: the one thing you need to do next, always in reach.
  function renderBar() {
    var bar = $('mbar'), p = me(), s = st(), html = '';
    if (!p) { bar.hidden = true; document.body.classList.remove('has-mbar'); return; }
    var ava = avatarHtml(p, 'mb-ava');
    if (!p.route) html = ava + '<span class="mb-txt"><b>Pick your route</b><span>Longer or riskier</span></span><button type="button" class="btn small" id="mGo">Choose</button>';
    else if (s.status === 'finished') { var fr = (s.final || []).filter(function (r) { return r.pid === p.id; })[0]; html = ava + '<span class="mb-txt"><b>Game over</b><span>' + (fr ? 'You finished ' + ordinal(fr.place) : 'Final standings are in') + '</span></span><button type="button" class="btn small" id="mFinale">Standings</button>'; }
    else if (s.status === 'signup') html = ava + '<span class="mb-txt"><b>' + (s.startsAt ? 'Starts in <span data-countdown="' + s.startsAt + '">' + fmtLeft(s.startsAt - Date.now()) + '</span>' : 'Starting soon') + '</b><span>You\'re signed up</span></span>';
    else if (p.finished) html = ava + '<span class="mb-txt"><b>Escaped!</b><span>' + ordinal(p.finished.place) + ' place on day ' + p.finished.day + '</span></span>';
    else if (p.tasks.length) {
      var claimed = p.claims.length >= p.tasks.length;
      html = ava + '<span class="mb-txt"><b>Play !bsr ' + esc(p.tasks[0].bsr[0]) + '</b><span>' + (claimed ? 'Waiting for the host' : (p.tasks.length > 1 ? p.tasks.length + ' maps to clear' : 'Then check BeatLeader')) + '</span></span>' +
        (claimed ? '<button type="button" class="btn small ghost" id="mGo">Details</button>' : '<button type="button" class="btn small" id="mVerify">Check BeatLeader</button>');
    } else {
      var c = E.canRoll(s, p.id);
      if (c.ok) html = ava + '<span class="mb-txt"><b>Ready to roll</b><span>' + E.remaining(s, p) + ' spaces to go</span></span><button type="button" class="btn small" id="mRoll">Roll the d4</button>';
      else html = ava + '<span class="mb-txt"><b>' + esc(rollTitle(c)) + '</b><span>' + esc(c.code === 'rolled' ? (store.mode === 'demo' ? 'Next roll tomorrow' : 'Next roll after the cutoff') : c.reason) + '</span></span><button type="button" class="btn small ghost" id="mGo">Details</button>';
    }
    bar.innerHTML = html; bar.hidden = false; document.body.classList.add('has-mbar');
  }

  var lastStatus = null;
  function renderAll() {
    if (!st()) return;
    if (lastStatus === 'signup' && st().status === 'running') toast('The game has started! Roll your first d4.', 'good');
    if (lastStatus && lastStatus !== 'finished' && st().status === 'finished') setTimeout(maybeFinale, 400);
    lastStatus = st().status;
    renderHeader(); renderBoard(); renderMe(); renderTurn(); renderFeed(); renderStandings(); renderBar(); renderReplayBtn();
    if (!$('hostDrawer').hidden) renderHost();
  }

  // ---- rolling and animation --------------------------------------------------------
  function hopTo(pid, p, idx, fly) {
    var tok = svgEl.querySelector('.tok[data-pid="' + pid + '"]');
    var o = {}; o[pid] = posXY(p, idx);
    if (tok) { tok.classList.toggle('fly', !!fly); tok.classList.remove('hop'); void tok.getBBox(); if (!fly) tok.classList.add('hop'); }
    placeTokens(o);
    followToken(o[pid]);
    if (fly) sfx.land(); else sfx.hop();
    return wait(fly ? 720 : 250);
  }
  function walk(pid, p, from, to) {
    var chain = Promise.resolve(), dir = to >= from ? 1 : -1;
    for (var i = from + dir; dir > 0 ? i <= to : i >= to; i += dir) (function (i) { chain = chain.then(function () { return hopTo(pid, p, i); }); })(i);
    return chain;
  }

  // ---- replay of the day ----------------------------------------------------------------------
  // Rewinds every token to the start of the last full day from the event log, then plays
  // that day's moves back in order with a caption. Nothing is changed in the game.
  function replayDayNum() {
    var s = st(); if (!s || s.status === 'signup') return 0;
    var d = s.status === 'finished' ? s.day : s.day - 1;
    return d >= 1 && s.events.some(function (e) { return e.day === d && e.t === 'roll' && !e.pre; }) ? d : 0;
  }
  function renderReplayBtn() {
    var b = $('replayBtn'); if (!b) return;
    var d = replayDayNum(); b.hidden = !d || replaying;
    if (d) b.innerHTML = '<span aria-hidden="true">&#9654;</span> Replay day ' + d;
  }
  var replaying = false, replayStop = false;
  function replayDay() {
    var s = st(), d = replayDayNum(); if (!d || animating || replaying) return;
    track('replay-day');
    var b = s.board, idx = function (p, spaceId) { return b.routes[p.route] ? b.routes[p.route].indexOf(spaceId) : -1; };
    var dayEvs = s.events.filter(function (e) { return e.day === d; });
    if (!dayEvs.length) return;
    var firstId = dayEvs[0].id;
    var pos = E.positionsBefore(s, firstId);   // rewind to the start of that day
    var at = {}, xy = function () { var o = {}; Object.keys(at).forEach(function (pid) { o[pid] = posXY(s.players[pid], at[pid]); }); return o; };
    Object.keys(pos).forEach(function (pid) { at[pid] = pos[pid]; });
    replaying = true; replayStop = false; animating = true; closeSpace();
    var zone = document.querySelector('.board-zone'); zone.classList.add('replaying');
    $('replayBtn').hidden = true; $('replayCap').hidden = false;
    var cap = function (html) { $('replayText').innerHTML = html; };
    cap('Day ' + d + ' replay');
    placeTokens(xy());
    var hop = function (pid, to, fly) {
      if (replayStop) return Promise.resolve();
      at[pid] = to; var tok = svgEl.querySelector('.tok[data-pid="' + pid + '"]');
      if (tok) { tok.classList.toggle('fly', !!fly); tok.classList.remove('hop'); void tok.getBBox(); if (!fly) tok.classList.add('hop'); }
      placeTokens(xy()); var o = xy(); followToken(o[pid]);
      if (fly) sfx.land(); else sfx.hop();
      return wait(fly ? 520 : 170);
    };
    var walkTo = function (pid, from, to) {
      var chain = Promise.resolve(), dir = to >= from ? 1 : -1;
      for (var i = from + dir; dir > 0 ? i <= to : i >= to; i += dir) (function (i) { chain = chain.then(function () { return hop(pid, i); }); })(i);
      return chain;
    };
    var chain = wait(700);
    dayEvs.forEach(function (e) {
      var p = s.players[e.pid];
      chain = chain.then(function () {
        if (replayStop || !p || !p.route) return;
        var x = evText(e), name = '<b>' + esc(p.name) + '</b> ';
        var last = E.exitIndex(s, p);
        if (e.t === 'roll') { cap(name + (e.bonus ? 'took a bonus roll: ' : 'rolled a ') + '<b>' + e.n + '</b>'); return wait(350).then(function () { return walkTo(e.pid, e.from, Math.min(e.from + e.n, last)); }); }
        if (e.t === 'move') { if (x) cap(name + x.html); return walkTo(e.pid, e.from, e.to); }
        if (e.t === 'warp' && e.to) { if (x) cap(name + x.html); var wi = idx(p, e.to); return wi >= 0 ? hop(e.pid, wi, true) : null; }
        if (e.t === 'start') { cap(name + 'went back to the start'); return hop(e.pid, -1, true); }
        if (e.t === 'gate-closed') { cap(name + 'found the gate closed for today'); return hop(e.pid, last - 1); }
        if (e.t === 'host-move') { cap(name + 'was moved by the host'); return hop(e.pid, e.to, true); }
        if (e.t === 'host-reset') { cap(name + 'was reset by the host'); return hop(e.pid, -1, true); }
        if (e.t === 'card' || e.t === 'escaped' || e.t === 'skip' || (e.t === 'task' && e.bonus)) { if (x) { cap(name + x.html); return wait(e.t === 'escaped' ? 1400 : 900); } }
      });
    });
    chain.then(function () { if (!replayStop) { cap('That was day ' + d + '.'); return wait(1100); } }).then(function () {
      replaying = false; animating = false; zone.classList.remove('replaying'); $('replayCap').hidden = true;
      renderAll();
    });
  }

  var stageDie = null;
  function doRoll() {
    var p = me(); if (!p || animating) return;
    animating = true;
    ['rollBtn', 'mRoll'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
    audio();
    var startPos = p.pos, wrap = $('boardWrap'), tempZoom = false;
    var hl = svgEl.querySelector('.hl'); if (hl) Array.prototype.forEach.call(hl.querySelectorAll('.prev'), function (x) { x.remove(); });
    var zone = document.querySelector('.board-zone'); zone.classList.add('busy');
    if (isPhone()) zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
    track('roll');
    store.act('roll').then(function (res) {
      var pp = st().players[store.me];
      res.events.forEach(function (e) { if (e.pid !== pp.id) return; if (e.t === 'card') track('card-' + e.card); if (e.t === 'escaped') track('escaped'); if (e.t === 'warp' || e.t === 'start') track('space-' + e.t); });
      // keep the token where it was until the animation walks it
      var o = {}; o[pp.id] = posXY(pp, startPos); placeTokens(o);
      var stage = $('rollStage'); stage.hidden = false; void stage.offsetWidth; stage.classList.add('on');
      stageDie = stageDie || new window.CGDice.Die($('stageDie'));
      var ticks = 0;
      return stageDie.roll(res.roll, { onTick: function () { if (ticks++ % 2 === 0) rattle(); } }).then(function () {
        sfx.land();
        var bu = $('burst'); bu.textContent = res.roll; bu.classList.remove('go'); void bu.offsetWidth; bu.classList.add('go');
        if (die) die.show(res.roll);
        return wait(820);
      }).then(function () {
        stage.classList.remove('on');
        return wait(260);
      }).then(function () {
        stage.hidden = true;
        // on phones, zoom in to follow the token, then zoom back out
        if (isPhone() && !wrap.classList.contains('zoomed')) { tempZoom = true; wrap.classList.add('zoomed'); followToken(posXY(pp, startPos)); }
        return playEvents(pp, res.events, startPos);
      }).then(function () {
        ripple(posXY(pp, pp.pos));
        return wait(tempZoom ? 900 : 300);
      });
    }).catch(fail).then(function () {
      if (tempZoom) wrap.classList.remove('zoomed');
      $('rollStage').hidden = true; document.querySelector('.board-zone').classList.remove('busy');
      animating = false; renderAll();
      var t = document.querySelector('.task'); if (t && !isPhone()) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function playEvents(p, events, startPos) {
    var pos = startPos, chain = Promise.resolve(), escaped = null, last = E.exitIndex(st(), p);
    events.forEach(function (e) {
      if (e.pid !== p.id) return;
      chain = chain.then(function () {
        switch (e.t) {
          case 'roll': { var to = Math.min(e.from + e.n, last); return walk(p.id, p, e.from, to).then(function () { pos = to; }); }
          case 'overshoot': toast('You need exactly ' + e.need + ' to reach the exit.'); return;
          case 'move': return wait(250).then(function () { (e.n > 0 ? sfx.good : sfx.bad)(); return walk(p.id, p, e.from, e.to); }).then(function () { pos = e.to; });
          case 'start': sfx.bad(); return hopTo(p.id, p, -1, true).then(function () { pos = -1; });
          case 'warp': { var idx = E.routeOf(st(), p).indexOf(e.to); (st().board.spaces[e.space].kind === 'swim' ? sfx.good : sfx.bad)(); return wait(200).then(function () { return hopTo(p.id, p, idx, true); }).then(function () { pos = idx; }); }
          case 'card': return showCard(E.cardById(st(), e.card));
          case 'skip': sfx.bad(); toast(e.turns > 1 ? 'You lose ' + e.turns + ' turns.' : 'You lose a turn.', 'bad'); return wait(400);
          case 'shield-used': sfx.good(); toast('Your protection blocked that setback.', 'good'); return wait(400);
          case 'again': toast('You get another roll today.', 'good'); return;
          case 'escaped': escaped = e; return;
          default: return;
        }
      });
    });
    return chain.then(function () { if (escaped) return showWin(p, escaped.place); });
  }

  // ---- cards -------------------------------------------------------------------------
  function cardFront(card) {
    var t = theme(), cc = { treasure: 'var(--treasure)', trick: 'var(--trick)', task: 'var(--task)', fate: 'var(--fate)' }[card.cls];
    return '<div class="ctype">' + esc(t.card[card.cls] || 'Card') + '</div><div class="cart" aria-hidden="true">' + card.art + '</div>' +
      '<div class="ctitle">' + esc(card.title) + '</div><div class="ctext">' + esc(card.text) + '</div><div class="cfx">' + esc(C.cardEffectText(card)) + '</div>';
  }
  function showCard(card) {
    return new Promise(function (resolve) {
      var t = theme(), ov = $('cardOverlay'), c3 = $('card3d');
      $('cardBack').innerHTML = '<div><svg class="crow" viewBox="-36 -42 72 80" aria-hidden="true">' + R.hero(0, 0, 1, t) + '</svg><p>' + esc(t.card.back) + '</p></div>';
      $('cardFront').innerHTML = cardFront(card);
      var ccol = { treasure: 'var(--treasure)', trick: 'var(--trick)', task: 'var(--task)', fate: 'var(--fate)' }[card.cls];
      $('cardFront').style.setProperty('--cc', ccol); ov.style.setProperty('--cc', ccol);
      c3.classList.remove('show'); ov.classList.remove('ready'); ov.hidden = false;
      sfx.card();
      setTimeout(function () { c3.classList.add('show'); ov.classList.add('ready'); }, 60);
      setTimeout(function () { (card.cls === 'trick' ? sfx.bad : card.cls === 'treasure' ? sfx.good : sfx.land)(); }, 650);
      var ok = $('cardOk');
      setTimeout(function () { ok.focus(); }, 700);
      function close() { ov.hidden = true; ok.removeEventListener('click', close); document.removeEventListener('keydown', key); resolve(); }
      function key(e) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close(); } }
      ok.addEventListener('click', close); document.addEventListener('keydown', key);
    });
  }

  function showWin(p, place) {
    return new Promise(function (resolve) {
      var t = theme(), ov = $('winOverlay');
      $('winTitle').textContent = t.words.escaped;
      $('winSub').textContent = p.name + ' made it to the ' + t.goal + ' and finished ' + ordinal(place) + '.';
      var conf = $('confetti'), html = '', cols = ['#3fd04a', '#f2a33a', '#a78bfa', '#ffffff', '#ff6b5a', '#4cc9f0'];
      for (var i = 0; i < 90; i++) html += '<i style="left:' + (Math.random() * 100) + '%;background:' + cols[i % cols.length] + ';animation-duration:' + (2.2 + Math.random() * 2.2) + 's;animation-delay:' + (Math.random() * .8) + 's"></i>';
      conf.innerHTML = html; ov.hidden = false; sfx.win();
      var ok = $('winOk'); ok.focus();
      ok.onclick = function () { ov.hidden = true; conf.innerHTML = ''; resolve(); };
    });
  }

  // ---- verification ----------------------------------------------------------------------
  function doVerify(btn) {
    btn.disabled = true; var label = btn.textContent; btn.textContent = 'Checking BeatLeader';
    animating = true;   // hold the re-render so the cleared stamp can show first
    track('check-beatleader');
    store.act('verify').then(function (r) {
      var n = (r && r.cleared || []).length;
      track(n ? 'map-cleared' : 'map-not-found-yet');
      if (n) { celebrateClear(r.cleared); }
      else { animating = false; renderAll(); toast('No new score on that map yet. BeatLeader can take a minute after you finish.', ''); }
    }).catch(function (e) { animating = false; renderAll(); if (/Link your BeatLeader/.test(e.message)) openJoin(true); else fail(e); });
  }
  function celebrateClear(cleared) {
    sfx.good();
    cleared.forEach(function (t) { var a = document.querySelector('.task[data-task="' + t.id + '"]'); if (a) { a.setAttribute('data-stamp', 'Cleared'); a.classList.add('cleared'); } });
    toast(cleared.length > 1 ? 'Maps cleared. You can roll again.' : 'Map cleared!', 'good');
    animating = true;
    setTimeout(function () { animating = false; renderAll(); }, 1400);
  }

  // ---- space popover -------------------------------------------------------------------------
  function openSpace(id, anchor) {
    track('space-details');
    var s = st(), sp = s.board.spaces[id], t = theme(), pop = $('spacePop');
    var k = sp.kind && t.kinds[sp.kind];
    var title = k ? k.title : sp.type === 'card' ? 'Card drop' : sp.type === 'map' ? 'Map space' : 'Space';
    var here = s.order.filter(function (pid) { var p = s.players[pid]; return p.route && p.pos >= 0 && s.board.routes[p.route][p.pos] === id; }).map(function (pid) { return s.players[pid].name; });
    var steps = []; Object.keys(s.board.routes).forEach(function (r) { var i = s.board.routes[r].indexOf(id); if (i >= 0) steps.push(s.board.routeInfo[r].name + ' space ' + (i + 1)); });
    var html = '<button type="button" class="x" data-close aria-label="Close">&times;</button><h3>' + (k ? k.icon + ' ' : '') + esc(title) + '</h3><div class="fx">' + esc(C.spaceEffectText(sp)) + '</div>';
    if (sp.type === 'warp' && s.board.spaces[sp.to]) html += '<p class="why">Takes you to ' + esc(spaceName(s.board.spaces[sp.to])) + '.</p>';
    if (sp.bsr && sp.bsr.length) html += '<div class="maps">' + sp.bsr.map(function (key) { return '<div class="mapline" data-key="' + esc(key) + '"><img alt=""><div><b data-n>!bsr ' + esc(key) + '</b><div class="why" data-m>Loading</div><div class="row"><button type="button" class="key" data-copy="!bsr ' + esc(key) + '">Copy !bsr ' + esc(key) + '</button><a class="why" target="_blank" rel="noopener" href="https://beatsaver.com/maps/' + esc(key) + '">BeatSaver</a></div></div></div>'; }).join('') + '</div>';
    html += '<p class="here">' + esc(steps.join(', ')) + (here.length ? '. Here now: ' + esc(here.join(', ')) : '') + '</p>';
    pop.innerHTML = html; pop.hidden = false;
    var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    var x = Math.min(window.innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2));
    var y = r.bottom + 10; if (y + ph > window.innerHeight - 12) y = Math.max(12, r.top - ph - 10);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    (sp.bsr || []).forEach(function (key) {
      S.map(key).then(function (m) {
        var line = pop.querySelector('.mapline[data-key="' + key + '"]'); if (!line) return;
        line.querySelector('img').src = m.cover;
        line.querySelector('[data-n]').textContent = m.name;
        line.querySelector('[data-m]').textContent = [m.author, m.mapper ? 'mapped by ' + m.mapper : ''].filter(Boolean).join(', ');
      }, function () { var line = pop.querySelector('.mapline[data-key="' + key + '"] [data-m]'); if (line) line.textContent = "Couldn't load map details"; });
    });
    pop.querySelector('[data-close]').focus();
  }
  function closeSpace() { $('spacePop').hidden = true; }

  // ---- modals --------------------------------------------------------------------------------
  var lastFocus = null;
  function modal(title, body, onOpen) {
    lastFocus = document.activeElement;
    $('modalTitle').textContent = title; $('modalBody').innerHTML = body; $('modal').hidden = false;
    if (onOpen) onOpen($('modalBody'));
    var f = $('modalBody').querySelector('input,button,select,a'); (f || $('modalX')).focus();
  }
  function closeModal() { $('modal').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  // ---- the end of the game ------------------------------------------------------------------
  function openFinale() {
    var s = st(), t = theme(), fin = s.final || E.ranking(s);
    track('finale');
    try { localStorage.setItem('cg.finale.' + s.id, '1'); } catch (e) {}
    var line = function (r) { return r.escaped ? 'Escaped day ' + r.day : r.left + ' to go'; };
    var podium = [fin[1], fin[0], fin[2]].map(function (r, i) {
      if (!r) return '<div class="pod empty"></div>';
      var p = s.players[r.pid], rank = [2, 1, 3][i];
      return '<div class="pod pod' + rank + '" style="--c:' + R.playerColor(s, r.pid) + '">' + avatarHtml(p, 'pod-ava') + '<b>' + esc(p.name) + '</b><span>' + esc(line(r)) + '</span><div class="pod-step">' + ordinal(r.place) + '</div></div>';
    }).join('');
    var rest = fin.slice(3).map(function (r) { var p = s.players[r.pid]; return '<li' + (r.pid === store.me ? ' class="me"' : '') + '><span class="place">' + ordinal(r.place) + '</span>' + esc(p.name) + '<span class="why">' + esc(line(r)) + '</span></li>'; }).join('');
    var mine = fin.filter(function (r) { return r.pid === store.me; })[0];
    var winner = fin[0] && s.players[fin[0].pid];
    modal('Game over', '<div class="finale"><p class="lede">' + (winner ? esc(winner.name) + (fin[0].escaped ? ' reached the ' + esc(t.goal) + ' first.' : ' got closest to the ' + esc(t.goal) + '.') : 'The final standings are in.') + '</p>' +
      '<div class="podium">' + podium + '</div>' + (rest ? '<ol class="finale-rest">' + rest + '</ol>' : '') +
      (mine ? '<p class="finale-me">You finished <b>' + ordinal(mine.place) + '</b>' + (mine.escaped ? ', escaping on day ' + mine.day : ', ' + mine.left + ' spaces out') + '.</p>' : '') +
      '<div class="row"><button type="button" class="btn" data-finale-close>Back to the board</button>' + (store.isHost ? '<button type="button" class="btn ghost" data-finale-results>Make the results image</button>' : '') + '</div></div>',
      function (body) {
        body.querySelector('[data-finale-close]').onclick = closeModal;
        var rb = body.querySelector('[data-finale-results]'); if (rb) rb.onclick = function () { closeModal(); openResults(); };
      });
    confettiBurst();
    if (sfx && sfx.win) sfx.win();
  }
  function confettiBurst() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var box = document.createElement('div'), cols = ['#3fd04a', '#f2a33a', '#a78bfa', '#ffffff', '#ff6b5a', '#4cc9f0'], html = '';
    box.className = 'confetti burst'; box.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 110; i++) html += '<i style="left:' + (Math.random() * 100) + '%;background:' + cols[i % cols.length] + ';animation-duration:' + (2.4 + Math.random() * 2.4) + 's;animation-delay:' + (Math.random() * .9) + 's"></i>';
    box.innerHTML = html; document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 6500);
  }
  function maybeFinale() {
    var s = st(); if (!s || s.status !== 'finished') return;
    var seen = false; try { seen = localStorage.getItem('cg.finale.' + s.id) === '1'; } catch (e) {}
    if (!seen) { openFinale(); return true; }
    return false;
  }

  // ---- while you were away ---------------------------------------------------------------------
  // Remembers the last event you saw (per game, in this browser) and sums up what changed since.
  function seenKey() { return 'cg.seen.' + st().id; }
  function readSeen() { try { return JSON.parse(localStorage.getItem(seenKey()) || 'null'); } catch (e) { return null; } }
  function myPlace() { var r = store.me && E.ranking(st()).filter(function (x) { return x.pid === store.me; })[0]; return r ? r.place : null; }
  function writeSeen() {
    var s = st(); if (!s) return;
    var last = s.events.length ? s.events[s.events.length - 1].id : 0;
    try { localStorage.setItem(seenKey(), JSON.stringify({ id: last, at: Date.now(), day: s.day, place: myPlace() })); } catch (e) {}
  }
  function agoText(ms) {
    var h = Math.round(ms / 3600000), d = Math.floor(ms / 86400000);
    return d >= 1 ? d + (d === 1 ? ' day' : ' days') : h >= 1 ? h + (h === 1 ? ' hour' : ' hours') : 'a little while';
  }
  function maybeAway() {
    var s = st(), prev = readSeen();
    if (!prev || Date.now() - prev.at < 30 * 60000) return false;
    var evs = s.events.filter(function (e) { return e.id > prev.id; });
    if (!evs.length) return false;
    var t = theme(), mine = [], others = [], cards = 0, cleared = [];
    var who = function (e) { var p = s.players[e.pid]; return p ? esc(p.name) : 'Someone'; };
    evs.forEach(function (e) {
      var meEv = e.pid && e.pid === store.me;
      if (meEv) {
        if (e.t === 'cleared') cleared.push((e.bsr || [])[0]);
        else if (e.t === 'claim-rejected') mine.push('❌ The host could not confirm your run');
        else if (e.t === 'lost-turn') mine.push('💤 You sat out day ' + e.day);
        else if (e.t === 'host-move' || e.t === 'host-reset') mine.push('🧹 The host moved your token');
        return;
      }
      if (e.t === 'card') cards++;
      if (e.t === 'escaped') others.push('🎉 <b>' + who(e) + '</b> escaped, ' + ordinal(e.place) + ' place');
      else if (e.t === 'start') others.push('↩️ <b>' + who(e) + '</b> got sent back to the start');
      else if (e.t === 'move' && e.n <= -3) others.push('⬅️ <b>' + who(e) + '</b> got pushed back ' + (-e.n));
      else if (e.t === 'move' && e.n >= 4) others.push('➡️ <b>' + who(e) + '</b> jumped ahead ' + e.n);
      else if (e.t === 'join') others.push('👋 <b>' + who(e) + '</b> joined');
      else if (e.t === 'begin') others.push('🏁 The game started');
      else if (e.t === 'end') others.push('🏆 The game ended');
    });
    if (cleared.length) mine.unshift(cleared.length === 1 ? '✅ Your map <b>!bsr ' + esc(cleared[0]) + '</b> was cleared' : '✅ ' + cleared.length + ' of your maps were cleared: <b>!bsr ' + cleared.map(esc).join(', ') + '</b>');
    if (cards) others.push('🃏 ' + cards + (cards === 1 ? ' card was' : ' cards were') + ' drawn');
    var now = myPlace(), lines = mine.slice();
    if (now && prev.place && now !== prev.place) lines.unshift(now < prev.place ? '⬆️ You moved up to <b>' + ordinal(now) + '</b> (you were ' + ordinal(prev.place) + ')' : '⬇️ You dropped to <b>' + ordinal(now) + '</b> (you were ' + ordinal(prev.place) + ')');
    var more = others.length > 7 ? others.length - 7 : 0;
    lines = lines.concat(others.slice(0, 7));
    if (!lines.length) return false;
    var p = me(), next = '';
    if (p && s.status === 'running') {
      var c = E.canRoll(s, p.id);
      next = p.finished ? '' : c.ok ? 'Your roll is ready.' : p.tasks.length ? 'Next up: play <b>!bsr ' + esc(p.tasks[0].bsr[0]) + '</b>.' : '';
    }
    var days = s.day > prev.day ? ' The game went from day ' + prev.day + ' to day ' + s.day + '.' : '';
    track('away-summary');
    modal('While you were away', '<p class="lede">You were gone ' + agoText(Date.now() - prev.at) + '.' + days + '</p><ul class="away">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' +
      (more ? '<p class="why">' + more + ' more in the game thread.</p>' : '') + (next ? '<p class="away-next">' + next + '</p>' : '') +
      '<div class="row"><button type="button" class="btn" data-away-close>Back to the game</button></div>', function (body) { body.querySelector('[data-away-close]').onclick = closeModal; });
    return true;
  }

  function openHow() {
    var t = theme(), s = st();
    track('how-to-play');
    modal('How to play', '<p class="lede">' + esc(t.tagline) + '</p><ol class="rules">' +
      '<li>Pick a route. The ' + esc(s.board.routeInfo.longer.name.toLowerCase()) + ' is safer but has more spaces. The ' + esc(s.board.routeInfo.riskier.name.toLowerCase()) + ' is shorter, with more ways to get sent back.</li>' +
      '<li>Roll the d4 once a day and move that many spaces.</li>' +
      '<li>Landing on a <b>!bsr</b> space means you play that map. Any difficulty, any modifiers. The game checks BeatLeader for your score, so there is nothing to post.</li>' +
      '<li>You can\'t roll again until your map is cleared, so play daily to keep up.</li>' +
      '<li>Card drops give you a card on the spot. Some help, some hurt, some add a bonus map.</li>' +
      '<li>Event spaces can push you ahead, send you back, cost you a turn, or block the way until you play their map.</li>' +
      '<li>If a card or event moves you onto a map, play it. A card or event never chains into another card.</li>' +
      '<li>Every roll ends with a map. If your turn stops on a space without one, you get a bonus map. A Safe space is the only break.</li>' +
      '<li>First one to the ' + esc(t.goal) + ' wins. Everyone else keeps playing for their place.</li>' +
      (s.settings.oneFinishPerDay !== false ? '<li>Only one player can escape per day. If someone already got out today, you wait at the gate and walk out on your next roll.</li>' : '') + '</ol>' +
      '<p class="why">If you played a map and the check can\'t find it (for example a replay that wasn\'t a new personal best), use "I played it" and the host can approve it.</p>');
  }

  function openJoin(linkOnly) {
    var demo = store.mode === 'demo';
    modal(linkOnly ? 'Link BeatLeader' : 'Join the game',
      '<p class="lede">Paste your BeatLeader profile link or ID. Your name and avatar come from it, and the game watches it for your map clears.</p>' +
      '<div class="field"><label for="blInput">BeatLeader profile</label><input type="text" id="blInput" placeholder="https://beatleader.com/u/..." autocomplete="off"><span class="hint">ScoreSaber and Steam IDs work too if they are linked on BeatLeader.</span></div>' +
      '<p class="err" id="joinErr" hidden></p><div class="row"><button type="button" class="btn" id="joinGo">' + (linkOnly ? 'Link profile' : 'Join the game') + '</button>' +
      (demo && !linkOnly ? '<button type="button" class="btn ghost" id="joinDemo">Just play as MSploit</button>' : '') + '</div>',
      function (body) {
        var go = body.querySelector('#joinGo'), input = body.querySelector('#blInput');
        function submit() {
          go.disabled = true; go.textContent = 'Looking you up';
          var go2 = store.mode === 'live'
            ? (S.parsePlayer(input.value) ? store.act('join', { blId: S.parsePlayer(input.value) }) : Promise.reject(new Error('Enter your BeatLeader profile link or ID.')))
            : S.player(input.value).then(function (pl) {
              var existing = st().order.filter(function (pid) { return st().players[pid].blId === pl.id; })[0];
              if (existing) return store.act('playAs', { pid: existing });
              return store.act('join', { name: pl.name, avatar: pl.avatar, blId: pl.id });
            });
          go2.then(function () { track('join'); closeModal(); toast('Welcome to the escape.', 'good'); }, function (e) {
            go.disabled = false; go.textContent = linkOnly ? 'Link profile' : 'Join the game';
            var er = body.querySelector('#joinErr'); er.hidden = false; er.textContent = e.message;
          });
        }
        go.addEventListener('click', submit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        var dj = body.querySelector('#joinDemo');
        if (dj) dj.addEventListener('click', function () { store.act('playAs', { pid: 'msploit' }).then(closeModal); });
      });
  }

  function openPlaylist() {
    var s = st(), keys = E.allMapKeys(s.board, s.cards);
    modal('Get the maps', '<p class="lede">Every map on this board' + (s.board.bonusMaps && s.board.bonusMaps.length ? ' plus the bonus maps from cards' : '') + ', ' + keys.length + ' in all, as a playlist for the game.</p>' +
      '<p class="why">Save it to your Beat Saber Playlists folder, or open it with a playlist mod. In game you can also type the key into Better Song Search.</p>' +
      '<div class="row"><button type="button" class="btn" id="plGo">Download playlist</button></div><p class="err" id="plErr" hidden></p>', function (body) {
      body.querySelector('#plGo').addEventListener('click', function () {
        var b = this; b.disabled = true; b.textContent = 'Building playlist';
        crowCover().then(function (img) { return S.playlist(theme().title, keys, img); }).then(function (pl) {
          track('get-maps');
          var blob = new Blob([JSON.stringify(pl, null, 2)], { type: 'application/json' });
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = theme().title.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '') + '.bplist'; a.click();
          b.disabled = false; b.textContent = 'Download playlist';
          if (pl.songs.length < keys.length) { var er = body.querySelector('#plErr'); er.hidden = false; er.textContent = (keys.length - pl.songs.length) + " maps couldn't be loaded from BeatSaver and were left out."; }
        }, function (e) { b.disabled = false; b.textContent = 'Download playlist'; fail(e); });
      });
    });
  }
  // Square playlist cover: Chester on the theme ground.
  function crowCover() {
    var t = theme();
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="' + t.palette.ground + '"/><stop offset="1" stop-color="' + t.palette.ground2 + '"/></radialGradient></defs>' +
      '<rect width="256" height="256" fill="url(#g)"/>' + R.hero(128, 120, 3.2, t) + '</svg>';
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { var c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').drawImage(img, 0, 0, 256, 256); resolve(c.toDataURL('image/png')); };
      img.onerror = function () { resolve(''); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ---- results image -------------------------------------------------------------------------
  function toDataUrl(url) {
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) {
      return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = rej; fr.readAsDataURL(b); });
    });
  }
  function fontCss() {
    var fam = theme().fontQuery || 'Grenze+Gotisch:wght@700';
    var url = 'https://fonts.googleapis.com/css2?family=' + fam + '&family=Atkinson+Hyperlegible:wght@700&display=swap';
    return fetch(url).then(function (r) { return r.text(); }).then(function (css) {
      var urls = css.match(/url\((https:[^)]+)\)/g) || [];
      return Promise.all(urls.map(function (u) { var clean = u.slice(4, -1); return toDataUrl(clean).then(function (d) { css = css.split(clean).join(d); }, function () {}); })).then(function () { return css; });
    }).catch(function () { return ''; });
  }
  function makeResults() {
    var s = st(), t = theme();
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:1000px;height:1000px';
    holder.innerHTML = R.board(s.board, t, { still: true });
    document.body.appendChild(holder);
    var svg = holder.querySelector('svg');
    R.placeTokens(svg, s, t, { me: null });
    var imgs = Array.prototype.slice.call(svg.querySelectorAll('image'));
    return Promise.all([fontCss()].concat(imgs.map(function (im) {
      var href = im.getAttribute('href'); if (!href || /^data:/.test(href)) return null;
      return toDataUrl(href).then(function (d) { im.setAttribute('href', d); }, function () { im.remove(); });
    }))).then(function (r) {
      var css = r[0];
      var words = resultsTitle().split(' '), l1 = words.length > 2 ? words.slice(0, 2).join(' ') : words[0], l2 = words.length > 2 ? words.slice(2).join(' ') : words.slice(1).join(' ');
      var bfill = t.banner ? t.banner[0] : '#3fd04a', bstroke = t.banner ? t.banner[1] : '#3b2208';
      var banner = '<g transform="translate(40,40) rotate(-7)" font-family="' + esc(t.font) + '" font-weight="700" fill="' + bfill + '" stroke="' + bstroke + '" stroke-width="14" paint-order="stroke">' +
        // Theme art has its title painted in, so the banner gets a plate to sit on.
        (t.art ? '<rect x="-22" y="-6" width="560" height="232" rx="28" fill="' + t.palette.ground + '" stroke="' + bfill + '" stroke-width="6" opacity=".96"/>' : '') +
        '<text x="0" y="100" font-size="118">' + esc(l1) + '</text><text x="40" y="205" font-size="118">' + esc(l2) + '</text></g>';
      var str = new XMLSerializer().serializeToString(svg).replace('</svg>', banner + '</svg>');
      if (css) str = str.replace(/<defs>/, '<defs><style>' + css + '</style>');
      holder.remove();
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas'); c.width = c.height = 1600;
          var g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 1600, 1600); g.drawImage(img, 0, 0, 1600, 1600);
          c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Could not draw the image.')); }, 'image/png');
        };
        img.onerror = function () { reject(new Error('Could not draw the board.')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
      });
    });
  }
  function resultsTitle() { return st().status === 'finished' ? 'Final results' : theme().words.results.replace('{n}', st().day); }
  function openResults() {
    track('host-results-image');
    modal(resultsTitle(), '<p class="lede">The board with everyone\'s token, ready to post in the game channel.</p><div id="resBox"><p class="why">Drawing the board</p></div>', function (body) {
      makeResults().then(function (blob) {
        var url = URL.createObjectURL(blob), name = theme().title.replace(/[^A-Za-z0-9]+/g, '-') + '-day-' + st().day + '.png';
        body.querySelector('#resBox').innerHTML = '<img class="result-img" src="' + url + '" alt="Board with every player\'s position">' +
          '<div class="row" style="margin-top:12px"><a class="btn" href="' + url + '" download="' + esc(name) + '">Download image</a>' +
          (store.mode === 'live' && store.isHost ? '<button type="button" class="btn ghost" id="resPost">Post to Discord</button>' : '') + '</div>';
        var post = body.querySelector('#resPost');
        if (post) post.addEventListener('click', function () {
          post.disabled = true; post.textContent = 'Posting';
          store.postResults(blob, '**' + resultsTitle() + '!!**').then(function () { track('host-results-posted'); post.textContent = 'Posted'; toast('Posted to Discord.', 'good'); }, function (e) { post.disabled = false; post.textContent = 'Post to Discord'; fail(e); });
        });
      }, function (e) { body.querySelector('#resBox').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    });
  }

  // ---- host tools ------------------------------------------------------------------------------
  function openHost() { $('hostDrawer').hidden = false; $('scrim').hidden = false; renderHost(); $('hostX').focus(); }
  function closeHost() { $('hostDrawer').hidden = true; $('scrim').hidden = true; $('hostBtn').focus(); }
  function cutoffLabel(s) { var h = s.settings.cutoffHour || 0, m = s.settings.cutoffMinute || 0; return ((h % 12) || 12) + ':' + pad2(m) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function toLocalInput(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function readStart(id) {
    var el = $(id), v = el && el.value; if (!v) return null;
    var ts = new Date(v).getTime();
    if (isNaN(ts) || ts < Date.now() + 60000) { toast('Pick a time in the future.', 'bad'); return false; }
    return ts;
  }
  function endSection(s) {
    var running = s.status === 'running';
    return '<section class="hsec"><h3>End of the game</h3><p>' + (s.endsAt ? 'The game locks <b>' + esc(startWhen(s.endsAt)) + '</b>, in <span data-countdown="' + s.endsAt + '">' + fmtLeft(s.endsAt - Date.now()) + '</span>. Standings freeze then.' : 'No end time. The game runs until everyone escapes.') + '</p>' +
      '<label class="start-field"><span>End time</span><input type="datetime-local" id="endEdit" value="' + (s.endsAt ? toLocalInput(s.endsAt) : '') + '"></label>' +
      '<div class="row"><button type="button" class="btn small" data-h="setend">Save end time</button>' + (s.endsAt ? '<button type="button" class="btn small ghost" data-h="clearend">Clear end time</button>' : '') +
      (running ? '<button type="button" class="btn small danger" data-h="endnow">End the game now</button>' : '') + '</div></section>';
  }
  function startSection(s) {
    return '<section class="hsec"><h3>Sign-ups are open</h3><p>' + (s.startsAt ? 'The first roll unlocks <b>' + esc(startWhen(s.startsAt)) + '</b>, in <span data-countdown="' + s.startsAt + '">' + fmtLeft(s.startsAt - Date.now()) + '</span>.' : 'No start time is set yet.') +
      ' Until then people can join and pick a route, but nobody rolls.</p>' +
      '<label class="start-field"><span>Start time</span><input type="datetime-local" id="startEdit" value="' + (s.startsAt ? toLocalInput(s.startsAt) : '') + '"></label>' +
      '<div class="row"><button type="button" class="btn small" data-h="reschedule">Save start time</button><button type="button" class="btn small ghost" data-h="startnow">Start now</button></div></section>';
  }
  function renderHost() {
    var s = st(), demo = store.mode === 'demo', html = '';
    var claims = [];
    s.order.forEach(function (pid) { s.players[pid].claims.forEach(function (c) { claims.push({ p: s.players[pid], c: c }); }); });
    if (s.status === 'finished') html += '<section class="hsec"><h3>Game over</h3><p>The standings are frozen. Start a new game below when you\'re ready.</p><div class="row"><button type="button" class="btn small" data-h="results">Make the results image</button><button type="button" class="btn small ghost" data-h="finale">Show the final standings</button></div></section>';
    else if (s.status === 'signup') html += startSection(s); else
    html += '<section class="hsec"><h3>Day ' + s.day + '</h3><p>' + (demo ? 'Starting the next day lets every bot clear maps and roll.' : 'The day turns over by itself at the cutoff. Use this only to fix a missed rollover.') + '</p><div class="row">' +
      '<button type="button" class="btn small" data-h="advance">Start the next day</button>' + (demo ? '<button type="button" class="btn small ghost" data-h="simulate">Skip ahead 3 days</button>' : '') +
      '<button type="button" class="btn small ghost" data-h="results">Make the results image</button></div></section>';
    if (s.status !== 'finished') html += endSection(s);
    html += '<section class="hsec' + (claims.length ? ' attn' : '') + '"><h3>Runs waiting for approval' + (claims.length ? ' <span class="nav-badge">' + claims.length + '</span>' : '') + '</h3>' + (claims.length ? claims.map(function (x) {
      var t = x.p.tasks.filter(function (k) { return k.id === x.c.task; })[0];
      return '<div class="claim"><b>' + esc(x.p.name) + '</b> says they played <b>!bsr ' + esc(t ? t.bsr.join(' or ') : '?') + '</b>' + (x.c.url ? ' (<a href="' + esc(x.c.url) + '" target="_blank" rel="noopener">replay</a>)' : '') +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn small good" data-h="approve" data-pid="' + esc(x.p.id) + '" data-task="' + esc(x.c.task) + '">Approve</button><button type="button" class="btn small ghost" data-h="reject" data-pid="' + esc(x.p.id) + '" data-task="' + esc(x.c.task) + '">Reject</button></div></div>';
    }).join('') : '<p>Nothing waiting.</p>') + '</section>';
    if (!demo && store.access) {
      var ac = store.access, names = ac.names || {};
      html += '<section class="hsec' + (ac.pending.length ? ' attn' : '') + '"><h3>Who can play' + (ac.pending.length ? ' <span class="nav-badge">' + ac.pending.length + '</span>' : '') + '</h3>' +
        '<label class="check"><input type="radio" name="acmode" value="testers"' + (ac.mode !== 'open' ? ' checked' : '') + '> <span>Only people I let in</span></label>' +
        '<label class="check"><input type="radio" name="acmode" value="open"' + (ac.mode === 'open' ? ' checked' : '') + '> <span>Anyone who signs in with Discord' + '</span></label>';
      html += '<p style="margin-top:10px">' + (ac.pending.length ? 'Waiting to get in:' : 'Nobody is waiting. When someone signs in, they show up here.') + '</p>';
      ac.pending.forEach(function (w) {
        html += '<div class="claim row" style="justify-content:space-between"><span><b>' + esc(w.name) + '</b> <span class="why">' + esc(w.id) + '</span></span><span class="row">' +
          '<button type="button" class="btn small good" data-h="letin" data-id="' + esc(w.id) + '">Let in</button><button type="button" class="btn small ghost" data-h="dismiss" data-id="' + esc(w.id) + '">Dismiss</button></span></div>';
      });
      if (ac.allowed.length) html += '<p style="margin-top:12px">Let in:</p>' + ac.allowed.map(function (id) {
        return '<div class="claim row" style="justify-content:space-between"><span><b>' + esc(names[id] || 'Player') + '</b> <span class="why">' + esc(id) + '</span></span><button type="button" class="btn small danger" data-h="unallow" data-id="' + esc(id) + '">Remove</button></div>';
      }).join('');
      html += '</section>';
    }
    html += '<section class="hsec"><h3>Notifications on this device</h3><div id="pushBox" class="push-box" data-kind="host"><p>Checking this device.</p></div></section>';
    html += '<section class="hsec"><h3>Players</h3><p>Space 0 is the start. Moving a token does not apply the space unless you tick the box.</p><table class="ptable"><tbody>';
    s.order.forEach(function (pid) {
      var p = s.players[pid];
      html += '<tr><td><b>' + esc(p.name) + '</b><br><span class="why">' + (p.route ? s.board.routeInfo[p.route].name : 'no route') + (p.tasks.length ? ', on a map' : '') + '</span></td>' +
        '<td>' + (p.route ? '<input type="number" min="0" max="' + E.routeOf(s, p).length + '" value="' + (p.pos + 1) + '" aria-label="Space for ' + esc(p.name) + '" data-pos="' + esc(pid) + '">' : '') + '</td>' +
        '<td><select data-cardfor="' + esc(pid) + '" aria-label="Give ' + esc(p.name) + ' a card"><option value="">Give a card</option>' + s.cards.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') + '</select></td>' +
        '<td><div class="row">' + (p.tasks.length ? '<button type="button" class="btn small ghost" data-h="clearmap" data-pid="' + esc(pid) + '">Clear map</button>' : '') +
        '<button type="button" class="btn small danger" data-h="reset" data-pid="' + esc(pid) + '">Reset</button></div></td></tr>';
    });
    html += '</tbody></table><label class="check"><input type="checkbox" id="applyMove"> <span>Apply the space after moving a token</span></label></section>';
    html += '<section class="hsec"><h3>Rules</h3>' +
      '<label class="check"><input type="checkbox" data-set="exactFinish"' + (s.settings.exactFinish ? ' checked' : '') + '> <span>Exact roll needed to escape</span></label>' +
      '<label class="check"><input type="checkbox" data-set="oneFinishPerDay"' + (s.settings.oneFinishPerDay !== false ? ' checked' : '') + '> <span>Only one player can escape per day</span></label>' +
      '<label class="check"><input type="checkbox" data-set="oneRollPerDay"' + (s.settings.oneRollPerDay ? ' checked' : '') + '> <span>One roll per day</span></label>' +
      '<label class="start-field"><span>Roll reminder for players who turn on notifications</span><select id="remindSel"><option value=""' + (E.remindHour(s) == null ? ' selected' : '') + '>Off</option>' +
      [17, 18, 19, 20, 21, 22].map(function (h) { return '<option value="' + h + '"' + (E.remindHour(s) === h ? ' selected' : '') + '>' + hourLabel(h) + ' in each player\'s own time</option>'; }).join('') + '</select></label></section>';
    html += '<section class="hsec"><h3>Theme and board</h3><div class="row"><label>Theme <select id="themeSel">' + Object.keys(C.themes).map(function (k) { return '<option value="' + k + '"' + (k === s.themeId ? ' selected' : '') + '>' + esc(C.themes[k].name) + '</option>'; }).join('') + '</select></label></div>' +
      '<p style="margin-top:10px">Changing the theme keeps everyone where they are. Starting a new game puts everyone back at the start.</p>' +
      '<label class="start-field"><span>Start time for the new game (optional)</span><input type="datetime-local" id="newStart"></label>' +
      '<label class="start-field"><span>End time (optional)</span><input type="datetime-local" id="newEnd"></label>' +
      '<p class="why">With an end time, the game locks then and the standings freeze: escaped players by place, everyone else by spaces left. Without one it runs until everyone escapes. Leave the start empty to start right away. With a start time set, sign-ups open now, people pick their routes, and the first roll unlocks at that time. Day 1 lasts until the next ' + esc(cutoffLabel(s)) + ' cutoff, so a ' + esc(cutoffLabel(s)) + ' start gives everyone a full first day.</p><div class="row">' +
      '<button type="button" class="btn small ghost" data-h="newgame">Start a new game</button>' + (designerBoard() ? '<button type="button" class="btn small ghost" data-h="loadboard">Start a new game on the designer board</button>' : '') + '</div></section>';
    var keep = {}; ['newStart', 'startEdit', 'newEnd', 'endEdit'].forEach(function (id) { var el = $(id); if (el && el.value && el.dataset.touched) keep[id] = el.value; });
    $('hostBody').innerHTML = html;
    Object.keys(keep).forEach(function (id) { var el = $(id); if (el) { el.value = keep[id]; el.dataset.touched = '1'; } });
    ['newStart', 'startEdit', 'newEnd', 'endEdit'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', function () { el.dataset.touched = '1'; }); });
    fillPush();
  }

  // ---- push notifications (hosts) ------------------------------------------------
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function currentSub() {
    if (!pushSupported()) return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).catch(function () { return null; });
  }
  function urlKey(k) {
    var s = String(k).replace(/-/g, '+').replace(/_/g, '/'); s += '==='.slice((s.length + 3) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function myZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } }
  // When this player's reminder goes out today, in their own time (e.g. "7 PM" or "4:59 PM").
  function reminderLabel() {
    var s = st(), h = E.remindHour(s); if (h == null) return '';
    var at = E.reminderTime(E.nextCutoff(s.settings), h, myZone() || s.settings.timeZone), d = new Date(at);
    return d.getMinutes() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s+/g, ' ');
  }
  // Devices that turned reminders on before time zones were sent: send theirs once per visit.
  var zoneSent = false;
  function refreshZone(sub) {
    if (zoneSent || !sub || store.mode !== 'live') return; zoneSent = true;
    store.post('/api/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel(), tz: myZone() }).catch(function () {});
  }
  function deviceLabel() {
    var ua = navigator.userAgent;
    var os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Device';
    var br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'browser';
    return os + ' ' + br;
  }
  // One switch per device. Hosts hear about sign-ins and runs to approve; players (hosts too,
  // if they play) get the evening reminder when a roll or map is still waiting.
  function hourLabel(h) { h = Number(h); return ((h % 12) || 12) + ' ' + (h < 12 ? 'AM' : 'PM'); }
  function fillPush() {
    var boxes = document.querySelectorAll('.push-box'); if (!boxes.length) return;
    var set = function (html, kind) { Array.prototype.forEach.call(document.querySelectorAll('.push-box'), function (b) { if (!kind || b.dataset.kind === kind) b.innerHTML = typeof html === 'function' ? html(b.dataset.kind) : html; }); };
    if (store.mode !== 'live') { set('<p>Push notifications work on the live site.</p>'); return; }
    if (!pushSupported()) { set(function (k) { return k === 'host' ? '<p>This browser can\'t do push notifications. Chrome on Android or on your PC can.</p>' : ''; }); return; }
    if (!store.vapidKey) { set(function (k) { return k === 'host' ? '<p>Notifications are not set up on the server yet. Add the two VAPID keys to the Worker.</p>' : ''; }); return; }
    if (Notification.permission === 'denied') { set('<p class="why">Notifications are blocked for this site. Allow them in the browser\'s site settings.</p>'); return; }
    var at = reminderLabel() || hourLabel(19);
    currentSub().then(function (sub) {
      var on = sub && Notification.permission === 'granted';
      if (on) refreshZone(sub);
      set(function (k) {
        if (k === 'host') return on
          ? '<p class="push-on">On for this device. You\'ll get a notification when someone is waiting to get in or asks you to approve a run, plus your own roll reminders.</p><div class="row"><button type="button" class="btn small" data-push="test">Send a test</button><button type="button" class="btn small ghost" data-push="off">Turn off</button></div>'
          : '<p>Get a notification on this device when someone is waiting to get in or asks you to approve a run, even with the game closed.</p><div class="row"><button type="button" class="btn small" data-push="on">Turn on notifications</button></div>';
        var bell = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a6 6 0 0 0-6 6v3.4L4.3 15a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 11.9V8.5a6 6 0 0 0-6-6Z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/></svg>';
        return '<div class="rem' + (on ? ' on' : '') + '"><span class="rem-bell">' + bell + '</span>' +
          '<span class="rem-txt"><b>Roll reminders</b><span>' + (on ? 'On. You\'ll get a nudge at ' + esc(at) + ' if your roll or map is still waiting.' : 'Get a nudge at ' + esc(at) + ' if your roll or map is still waiting.') + '</span>' +
          (on ? '<button type="button" class="rem-test" data-push="test">Send a test</button>' : '') + '</span>' +
          '<button type="button" class="rem-switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="Roll reminders" data-push="' + (on ? 'off' : 'on') + '"><i></i></button></div>';
      });
    });
  }
  function pushOn() {
    var key = urlKey(store.vapidKey);
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the browser\'s site settings.');
      return navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; });
    }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (old) { return old ? old.unsubscribe() : null; })
        .then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); });
    }).then(function (sub) {
      return store.post('/api/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel(), tz: myZone() });
    }).then(function () { track('push-on'); toast('Notifications are on for this device.', 'good'); pushTest(); fillPush(); }, function (e) { fail(e); fillPush(); });
  }
  function pushOff() {
    currentSub().then(function (sub) {
      if (!sub) return null;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () { return store.post('/api/push/unsubscribe', { endpoint: ep }); });
    }).then(function () { track('push-off'); toast('Notifications are off for this device.'); fillPush(); }, fail);
  }
  function pushTest() {
    currentSub().then(function (sub) {
      if (!sub) throw new Error('Turn on notifications on this device first.');
      return store.post('/api/push/test', { endpoint: sub.endpoint });
    }).then(function () { track('push-test'); toast('Test sent. It should pop up in a few seconds.', 'good'); }, fail);
  }
  function designerBoard() { try { return JSON.parse(localStorage.getItem('cg.designer.board') || 'null'); } catch (e) { return null; } }
  function hostAction(btn) {
    var h = btn.dataset.h, pid = btn.dataset.pid;
    var run = function (name, args, msg) { return store.act(name, args).then(function () { track('host-' + h); if (msg) toast(msg, 'good'); }, fail); };
    switch (h) {
      case 'advance': run('advance', {}, 'Day ' + (st().day + 1) + ' has started.'); break;
      case 'simulate': run('simulate', { days: 3 }, 'Skipped ahead 3 days.'); break;
      case 'results': openResults(); break;
      case 'approve': run('approve', { pid: pid, task: btn.dataset.task }, 'Approved.'); break;
      case 'reject': run('reject', { pid: pid, task: btn.dataset.task }); break;
      case 'clearmap': { var p = st().players[pid]; run('approve', { pid: pid, task: p.tasks[0].id }, 'Map cleared for ' + p.name + '.'); break; }
      case 'reset': if (confirm('Send ' + st().players[pid].name + ' back to the start and clear their maps?')) run('resetPlayer', { pid: pid }); break;
      case 'newgame': {
        var ns = readStart('newStart'); if (ns === false) break;
        var ne = readStart('newEnd'); if (ne === false) break;
        if (ne && ne < (ns || Date.now()) + 3600000) { toast('The end time needs to be at least an hour after the start.', 'bad'); break; }
        if (confirm((ns ? 'Start a new game with sign-ups open until ' + startWhen(ns) + '?' : 'Start a new game now?') + (ne ? ' It ends ' + startWhen(ne) + '.' : '') + ' Everyone goes back to the start.')) run('newGame', { theme: st().themeId, startsAt: ns, endsAt: ne }, ns ? 'Sign-ups are open.' : 'New game started.');
        break;
      }
      case 'reschedule': { var rs = readStart('startEdit'); if (!rs) { if (rs === null) toast('Pick a start time first.', 'bad'); break; } run('schedule', { startsAt: rs }, 'Start time saved.'); break; }
      case 'setend': { var se = readStart('endEdit'); if (!se) { if (se === null) toast('Pick an end time first.', 'bad'); break; } run('setEnd', { endsAt: se }, 'End time saved.'); break; }
      case 'finale': closeHost(); openFinale(); break;
      case 'clearend': run('setEnd', { endsAt: null }, 'End time cleared.'); break;
      case 'endnow': if (confirm('End the game now? The standings freeze and nobody can roll again.')) run('endNow', {}, 'The game is over.'); break;
      case 'startnow': if (confirm('Start the game now? Everyone can roll right away.')) run('startNow', {}, 'The game has started.'); break;
      case 'letin': run('letIn', { id: btn.dataset.id }, 'Let in.'); break;
      case 'dismiss': run('dismiss', { id: btn.dataset.id }); break;
      case 'unallow': if (confirm('Remove their access? They will see the invite-only screen.')) run('removeAccess', { id: btn.dataset.id }); break;
      case 'loadboard': {
        var b = designerBoard(), probs = E.checkBoard(b);
        if (probs.length) { toast(probs[0], 'bad'); break; }
        var ls = readStart('newStart'); if (ls === false) break;
        var le = readStart('newEnd'); if (le === false) break;
        if (confirm('Start a new game on "' + (b.title || 'the designer board') + '"' + (ls ? ' with sign-ups open until ' + startWhen(ls) : '') + '?')) run('newGame', { theme: st().themeId, board: b, startsAt: ls, endsAt: le && le > (ls || Date.now()) + 3600000 ? le : null }, ls ? 'Sign-ups are open on your board.' : 'New game started on your board.');
        break;
      }
    }
  }

  // ---- events --------------------------------------------------------------------------------
  function bind() {
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy); return; }
      if (e.target.closest('#rollBtn') || e.target.closest('#mRoll')) { doRoll(); return; }
      if (e.target.closest('#finaleBtn') || e.target.closest('#mFinale')) { openFinale(); return; }
      var pb = e.target.closest('[data-push]'); if (pb) { ({ on: pushOn, off: pushOff, test: pushTest })[pb.dataset.push](); return; }
      var mv = e.target.closest('#mVerify'); if (mv) { doVerify(mv); return; }
      if (e.target.closest('#mGo')) { $('turnPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('turnPanel').focus({ preventScroll: true }); return; }
      var rc = e.target.closest('.route-card'); if (rc) {
        var info = st().board.routeInfo[rc.dataset.route];
        if (confirm('Take the ' + info.name.toLowerCase() + '? You can\'t switch later.')) store.act('route', { route: rc.dataset.route }).then(function () { track('route-' + rc.dataset.route); toast('Good luck out there.', 'good'); }, fail);
        return;
      }
      var v = e.target.closest('[data-verify]'); if (v) { doVerify(v); return; }
      var cl = e.target.closest('[data-claim]'); if (cl) { var f = cl.closest('.task').querySelector('[data-claimform]'); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('input').focus(); return; }
      var cs = e.target.closest('[data-claimsend]'); if (cs) {
        var art = cs.closest('.task'), url = art.querySelector('input').value.trim();
        store.act('claim', { task: art.dataset.task, url: url }).then(function () { track('played-it-claim'); toast('Sent to the host.', 'good'); }, fail); return;
      }
      var ps = e.target.closest('[data-pass]'); if (ps) { animating = true; store.act('pass', { task: ps.closest('.task').dataset.task }).then(function (r) { celebrateClear(r.cleared || []); }, function (er) { animating = false; fail(er); }); return; }
      if (e.target.closest('#joinBtn')) { openJoin(false); return; }
      if (e.target.closest('a[href*="/auth/login"]')) track('sign-in');
      if (e.target.closest('#logoutBtn')) { track('sign-out'); store.logout(); return; }
      if (e.target.closest('#checkAgain')) { location.reload(); return; }
      var stb = e.target.closest('.st[data-pid]'); if (stb) {
        var tok = svgEl.querySelector('.tok[data-pid="' + stb.dataset.pid + '"]');
        if (tok) { tok.classList.remove('ping'); void tok.getBBox(); tok.classList.add('ping'); $('boardWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        return;
      }
      var sp = e.target.closest('.board-svg .sp'); if (sp) { openSpace(sp.dataset.id, sp); return; }
      if (e.target.closest('#spacePop [data-close]') || (!e.target.closest('#spacePop') && !$('spacePop').hidden)) closeSpace();
      var fb = e.target.closest('[data-feed]'); if (fb) { feedMode = fb.dataset.feed; renderFeed(); return; }
      var hb = e.target.closest('#hostBody [data-h]'); if (hb) { hostAction(hb); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else if (!$('spacePop').hidden) closeSpace(); else if (!$('hostDrawer').hidden) closeHost(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.board-svg .sp')) { e.preventDefault(); openSpace(e.target.closest('.sp').dataset.id, e.target.closest('.sp')); }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'playAs') { store.act('playAs', { pid: t.value }); return; }
      if (t.dataset.pos) { store.act('setpos', { pid: t.dataset.pos, pos: parseInt(t.value, 10) - 1, apply: $('applyMove') && $('applyMove').checked }).catch(fail); return; }
      if (t.dataset.cardfor && t.value) { var pid = t.dataset.cardfor, cid = t.value; store.act('card', { pid: pid, card: cid }).then(function () { toast('Gave ' + st().players[pid].name + ' a card.', 'good'); }, fail); return; }
      if (t.dataset.set) { var patch = {}; patch[t.dataset.set] = t.checked; store.act('settings', { patch: patch }).catch(fail); return; }
      if (t.name === 'acmode') { store.act('accessMode', { mode: t.value }).then(function () { track('host-access-' + t.value); toast(t.value === 'open' ? 'Anyone who signs in can play now.' : 'Invite-only again.', 'good'); }, fail); return; }
      if (t.id === 'remindSel') { store.act('settings', { patch: { remindHour: t.value === '' ? null : Number(t.value) } }).then(function () { track('host-reminder-' + (t.value || 'off')); toast(t.value === '' ? 'Roll reminders are off.' : 'Roll reminders go out at ' + hourLabel(t.value) + '.', 'good'); }, fail); return; }
      if (t.id === 'themeSel') { store.act('theme', { theme: t.value }).then(function () { track('host-theme-' + t.value); renderBoard(true); }, fail); }
    });
    $('howBtn').onclick = openHow;
    $('playlistBtn').onclick = openPlaylist;
    $('hostBtn').onclick = openHost;
    $('hostX').onclick = closeHost;
    $('scrim').onclick = closeHost;
    $('modalX').onclick = closeModal;
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    $('nextDayBtn').onclick = function () { store.act('advance', {}).then(function () { toast('Day ' + st().day + ' has started. The bots made their moves.', 'good'); }, fail); };
    $('replayBtn').onclick = replayDay;
    $('replaySkip').onclick = function () { replayStop = true; };
    $('zoomBtn').onclick = function () {
      var w = $('boardWrap'), on = !w.classList.contains('zoomed');
      if (on) track('zoom-in');
      w.classList.toggle('zoomed', on); this.setAttribute('aria-pressed', on ? 'true' : 'false'); this.textContent = on ? 'Zoom out' : 'Zoom in';
      if (on) centerOnMe();
    };
    $('muteBtn').onclick = function () { muted = !muted; try { localStorage.setItem('cg.muted', muted ? '1' : '0'); } catch (e) {} renderHeader(); if (!muted) sfx.hop(); };
  }

  // Ko-fi heart beats once when the footer scrolls into view (hover beat is CSS only).
  (function () {
    var h = document.querySelector('a.kofi-support .kofi-heart');
    if (!h || !('IntersectionObserver' in window)) return;
    h.addEventListener('animationend', function () { h.classList.remove('beat'); });
    var io = new IntersectionObserver(function (ents) { ents.forEach(function (e) { if (e.isIntersecting) { void h.offsetWidth; h.classList.add('beat'); io.disconnect(); } }); }, { threshold: 0.9 });
    io.observe(h);
  })();

  // Footer visit counter from GoatCounter's public counter (needs "Allow adding visitor counts
  // on your website" on in the GoatCounter site settings). Falls back to the SVG counter if the
  // JSON is blocked, and stays hidden if neither loads.
  (function () {
    var box = document.getElementById('footCount'); if (!box) return;
    var BASE = 'https://chesters-escape.goatcounter.com/counter/TOTAL';
    function showText(n) {
      box.title = n + " total visits to Chester's Escape";
      box.innerHTML = '<span class="fc-dot">&#9670;</span><span class="fc-n">' + esc(String(n)) + '</span> visits';
      box.hidden = false;
    }
    function showImg() {
      var img = new Image(); img.className = 'fc-img'; img.alt = 'total visits'; img.title = "Total visits to Chester's Escape";
      img.onload = function () { box.innerHTML = '<span class="fc-dot">&#9670;</span>'; box.appendChild(img); box.hidden = false; };
      img.onerror = function () {};
      img.src = BASE + '.svg?no_branding=1';
    }
    if (location.protocol === 'file:') return;   // nothing to count on your own PC
    if (!window.fetch) { showImg(); return; }
    fetch(BASE + '.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { var n = d && (d.count || d.count_unique); if (n) showText(n); else showImg(); })
      .catch(showImg);
  })();

  // Footer "Site updated": bump data-updated in index.html whenever the site changes.
  (function () {
    var el = document.getElementById('footUpdated'); if (!el) return;
    var then = new Date(el.getAttribute('data-updated')).getTime(); if (isNaN(then)) return;
    function rel() {
      var s = Math.floor(Math.max(0, Date.now() - then) / 1000);
      if (s < 45) return 'just now';
      var u = [[60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.35, 'month'], [12, 'year']];
      var v = s / 60, i = 0, unit = 'minute';
      for (; i < u.length; i++) { unit = u[i][1]; if (i + 1 >= u.length || v < u[i + 1][0]) break; v = v / u[i + 1][0]; }
      var n = Math.floor(v); if (n < 1) n = 1;
      return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
    }
    function tick() { el.textContent = 'Site updated ' + rel(); }
    try { el.title = new Date(then).toLocaleString(); } catch (e) {}
    tick(); setInterval(tick, 60000);
  })();

  // ---- start -----------------------------------------------------------------------------------
  // ---- closed door ---------------------------------------------------------------------------
  function renderGate(g) {
    var t = (g.theme && C.themes[g.theme]) || null;
    track('gate-' + g.kind);
    document.addEventListener('click', function (e) { if (e.target.closest('a[href*="/auth/login"]')) track('sign-in'); });
    document.body.classList.add('gated');
    if (t) { document.body.setAttribute('data-theme', t.look || t.id); $('gameTitle').textContent = t.title; document.title = t.title; }
    $('brandCrow').innerHTML = t ? R.hero(0, 0, 1, t) : R.chester(0, 0, 1, 'none');
    if (g.kind !== 'choose') renderClanSwitch(g);
    var msg = {
      closed: ['Coming soon', "Chester's Escape isn't open yet. Watch the clan Discord for the start."],
      down: ["Can't reach the game", 'The game server is not answering right now. Try again in a minute.'],
      signin: ['Private game', 'Sign in with Discord to see the board. The host lets players in.'],
      pending: ["You're on the list", 'Thanks' + (g.user ? ', ' + g.user.name : '') + '. The host has your request and will let you in. Check back soon.'],
      choose: ['Pick your game', "You're in more than one clan server, so there's a game for each. You can switch any time with the icons at the top of the page."]
    }[g.kind];
    var html = '<section class="gate-card"><svg class="gate-crow" viewBox="-36 -42 72 80" aria-hidden="true">' + (t ? R.hero(0, 0, 1, t) : R.chester(0, 0, 1, 'none')) + '</svg>' +
      '<h2>' + esc(msg[0]) + '</h2><p>' + esc(msg[1]) + '</p>' + (g.startsAt && g.startsAt > Date.now() ? countdownHtml(g.startsAt) : '') + '<div class="row" style="justify-content:center">';
    if (g.kind === 'signin') html += '<a class="btn" href="' + esc(g.loginUrl()) + '">Sign in with Discord</a>';
    if (g.kind === 'pending') html += '<button type="button" class="btn ghost" id="gateRetry">Check again</button><button type="button" class="btn link" id="gateOut">Sign out</button>';
    if (g.kind === 'down') html += '<button type="button" class="btn ghost" id="gateRetry">Try again</button>';
    html += '</div>';
    if (g.kind === 'choose') html += '<div class="clan-picks">' + g.clans.map(function (c) { return '<button type="button" class="clan-pick" data-clan="' + esc(c.id) + '">' + clanIcon(c, 'clan-big') + '<span>' + esc(c.name) + '</span></button>'; }).join('') + '</div>';
    html += '</section>';
    document.querySelector('main.layout').outerHTML = '<main class="gate">' + html + '</main>';
    var r = $('gateRetry'); if (r) r.onclick = function () { location.reload(); };
    var o = $('gateOut'); if (o) o.onclick = function () { g.logout(); };
    if (g.startsAt) setInterval(tickCountdowns, 1000);
  }

  window.CGStore.detect().then(function (s) {
    store = s;
    if (store.mode === 'gate') { renderGate(store); throw 'gated'; }
    return store.load();
  }).then(function () {
    bind();
    if (store.mode === 'live') track(store.canPlay ? (store.me ? 'visit-player' : 'visit-not-joined') : 'visit-waiting-list');
    store.on(function () { if (!animating) renderAll(); });
    renderAll();
    if (/^#host$/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); if (store.isHost) openHost(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type !== 'open' && d.type !== 'open-host') return;
      // A notification from the other clan's game opens that game.
      var c = ''; try { c = new URL(d.url || '', location.href).searchParams.get('clan') || ''; } catch (x) {}
      if (c && store.clan && c !== store.clan) { location.href = d.url; return; }
      if ((d.type === 'open-host' || /#host$/.test(d.url || '')) && store.isHost) openHost();
      store.poll && store.poll();
    });
    if (store.mode === 'live') { setInterval(function () { if (!animating && document.visibilityState === 'visible') store.poll(); }, 20000); }
    setInterval(tickClock, 30000);
    setInterval(tickCountdowns, 1000);
    var seen = false; try { seen = localStorage.getItem('cg.seenHow') === '1'; localStorage.setItem('cg.seenHow', '1'); } catch (e) {}
    if (!seen) openHow(); else if (!maybeFinale()) maybeAway();
    writeSeen();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') writeSeen(); });
    window.addEventListener('pagehide', writeSeen);
  }).catch(function (e) {
    if (e === 'gated') return;
    console.error(e);
    $('boardWrap').innerHTML = '<p class="err" style="padding:20px">The game could not load: ' + esc(e.message) + '</p>';
  });
})();
