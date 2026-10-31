/*
 * Chester's Escape - the game page.
 */
(function () {
  'use strict';
  var E = window.CGEngine, C = window.CGContent, R = window.CGRender, S = window.CGServices, X = window.CGFx, FX = X.fx;
  var $ = function (id) { return document.getElementById(id); };
  var esc = R.esc;

  var store = null, die = null, svgEl = null, builtKey = '', animating = false, feedMode = 'all', cam = null;
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
    var col = R.playerColor(st(), p.id) || '#8a8f98';
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
      cam = new X.Camera(svgEl);
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
      Object.keys(found).forEach(function (k) { mapInfo[k] = found[k]; });
      renderStandings(); renderFeed();
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
  function onlineMap() { var m = {}, s = st(); (store.online || []).forEach(function (pid) { if (s.players[pid]) m[pid] = 1; }); if (store.me && s.players[store.me]) m[store.me] = 1; return m; }
  function placeTokens(overrides) { R.placeTokens(svgEl, st(), theme(), { me: store.me, overrides: overrides, flair: X.flair(st()), online: onlineMap() }); }
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
  // The roll camera: zooms the board toward the moving token and eases back out after.
  // When the player has zoomed in by hand, it scrolls instead so it never fights them.
  function camOK() { return cam && svgEl && !$('boardWrap').classList.contains('zoomed'); }
  function camZoom() { return isPhone() ? 2.3 : 1.75; }
  function camTo(xy, z) { if (camOK()) return cam.focus(xy, z || camZoom()); followToken(xy); return Promise.resolve(); }
  function camHome() { return cam ? cam.home() : Promise.resolve(); }
  function tokEl(pid) { return svgEl && svgEl.querySelector('.tok[data-pid="' + pid + '"]'); }
  function tokFx(pid, cls, ms) { var t = tokEl(pid); if (!t) return; t.classList.remove(cls); void t.getBBox(); t.classList.add(cls); setTimeout(function () { t.classList.remove(cls); }, ms || 600); }

  // ---- header ----------------------------------------------------------------
  // Things waiting on the host: runs to approve and people waiting to get in.
  var lastTodo = 0, skullSaidHi = false;
  // Host tools button: a skull with a jaw that chatters, eyes that light up, and a laugh when you open it.
  var SKULL = '<svg class="skull" viewBox="0 0 24 24" aria-hidden="true"><g class="sk-all">' +
    '<g class="sk-head"><path fill-rule="evenodd" d="M12 2.2c-4.9 0-8.7 3.5-8.7 8.1 0 2.7 1.3 4.8 3.3 6.1v1.3h10.8v-1.3c2-1.3 3.3-3.4 3.3-6.1 0-4.6-3.8-8.1-8.7-8.1zM6.3 11.2a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0zM12.9 11.2a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0zM12 13.6l-1.1 2.1h2.2z"/>' +
    '<circle class="sk-eye" cx="8.7" cy="11.2" r="1.35"/><circle class="sk-eye" cx="15.3" cy="11.2" r="1.35"/></g>' +
    '<path class="sk-jaw" fill-rule="evenodd" d="M6.6 18.3h10.8v1.7c0 .9-.7 1.5-1.5 1.5H8.1c-.8 0-1.5-.6-1.5-1.5zM9.25 18.3h.7v1.5h-.7zM11.65 18.3h.7v1.5h-.7zM14.05 18.3h.7v1.5h-.7z"/></g></svg>';
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
  // One button in the header showing the current server; it opens a small menu of your servers.
  function renderClanSwitch(src) {
    var el = $('clanSwitch'), list = (src && src.clans) || [];
    if (!el || clanSwitchDone || list.length < 2) return;
    clanSwitchDone = true;
    var cur = list.filter(function (c) { return c.id === src.clan; })[0] || list[0];
    el.hidden = false;
    el.innerHTML = '<button type="button" class="nav-btn clan-cur" id="clanBtn" aria-haspopup="menu" aria-expanded="false" title="Switch game">' + clanIcon(cur, 'clan-ic') +
      '<span class="nm">' + esc(cur.name) + '</span><svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>';
    $('clanPop').innerHTML = '<p class="cp-h">Switch game</p>' + list.map(function (c) {
      var on = c.id === cur.id;
      return '<button type="button" role="menuitemradio" aria-checked="' + on + '" class="clan-opt' + (on ? ' on' : '') + '"' + (on ? '' : ' data-clan="' + esc(c.id) + '"') + '>' + clanIcon(c, 'clan-ic') + '<span>' + esc(c.name) + '</span>' +
        (on ? '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '') + '</button>';
    }).join('');
  }
  function closeClan() { var p = $('clanPop'); if (p && !p.hidden) { p.hidden = true; $('clanBtn').setAttribute('aria-expanded', 'false'); } }
  document.addEventListener('click', function (e) {
    if (e.target.closest('#clanBtn')) {
      var pop = $('clanPop'), b = $('clanBtn');
      if (!pop.hidden) { closeClan(); return; }
      pop.hidden = false; b.setAttribute('aria-expanded', 'true');
      var r = b.getBoundingClientRect(), w = pop.offsetWidth, vw = document.documentElement.clientWidth;
      pop.style.top = Math.round(r.bottom + 8) + 'px';
      pop.style.left = Math.round(Math.min(vw - w - 12, Math.max(12, r.right - w))) + 'px';
      return;
    }
    if (!e.target.closest('#clanPop')) closeClan();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeClan(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-clan]'); if (!b) return;
    var cur = store && store.clan;
    if (b.dataset.clan === cur) return;
    track('clan-' + b.dataset.clan);
    window.CGStore.switchClan(b.dataset.clan);
  });

  function renderHeader() {
    var s = st(), t = theme();
    renderClanSwitch(store);
    document.body.setAttribute('data-theme', t.look || t.id);
    R.setFavicon(t);
    $('gameTitle').textContent = t.title;
    $('brandCrow').innerHTML = R.hero(0, 0, 1, t);
    $('dayNum').textContent = s.status === 'finished' ? 'Game over' : s.status === 'signup' ? (E.signupsOpen(s) ? 'Sign-ups open' : 'Sign-ups closed') : 'Day ' + s.day;
    $('hostBtn').hidden = !store.isHost || adminCard();
    var todo = store.isHost ? hostTodo() : { total: 0 };
    document.title = (todo.total ? '(' + todo.total + ') ' : '') + t.title;
    var hb = $('hostBtn');
    // The skull is drawn once so its animations keep running; only the badge changes.
    if (!hb.querySelector('.skull')) hb.innerHTML = SKULL;
    // The first time the skull shows on this page load, its jaw opens and shuts once.
    if (!hb.hidden && !skullSaidHi) { skullSaidHi = true; setTimeout(function () { hb.classList.add('hello'); setTimeout(function () { hb.classList.remove('hello'); }, 650); }, 700); }
    var badge = hb.querySelector('.nav-badge');
    if (todo.total) { if (!badge) { hb.insertAdjacentHTML('beforeend', '<span class="nav-badge" aria-hidden="true"></span>'); badge = hb.querySelector('.nav-badge'); } badge.textContent = todo.total; }
    else if (badge) badge.remove();
    hb.classList.toggle('todo', !!todo.total);
    hb.setAttribute('aria-label', todo.total ? 'Host tools, ' + todo.total + ' waiting on you' : 'Host tools');
    hb.title = todo.total ? [todo.claims ? todo.claims + ' run' + (todo.claims === 1 ? '' : 's') + ' to approve' : '', todo.pending ? todo.pending + ' waiting to get in' : ''].filter(Boolean).join(', ') : '';
    if (todo.total > lastTodo) { var nb = hb.querySelector('.nav-badge'); if (nb) { nb.classList.remove('bump'); void nb.offsetWidth; nb.classList.add('bump'); } }
    lastTodo = todo.total;
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
    Array.prototype.forEach.call(document.querySelectorAll('[data-ago]'), function (el) { var t = visitAgo(Number(el.dataset.ago)); if (el.textContent !== t) el.textContent = t; });
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
    if (s.startsAt && svgEl && launchFor !== s.startsAt && s.startsAt - Date.now() <= 10500 && s.startsAt - Date.now() > -1500 && document.visibilityState === 'visible') startLaunch(s.startsAt);
    if (!s.startsAt || Date.now() < s.startsAt) return;
    if (store.mode === 'demo') { if (!starting) { starting = true; store.act('startNow').catch(function () {}).then(function () { starting = false; }); } }
    else if (store.mode === 'live' && Date.now() - kickAt > 5000) { kickAt = Date.now(); store.poll(); }
  }

  // ---- me panel ----------------------------------------------------------------
  // A host running the game without playing gets the Admin card, which has its own Host tools button,
  // so the skull in the header steps aside.
  function adminCard() { return store.mode === 'live' && !!store.isHost && !!store.hostOut && !me(); }
  function renderMe() {
    var p = me(), el = $('mePanel'), s = st();
    // The demo plays as MSploit for everyone, so only a real sign-in can mark the owner's browser.
    if (store.mode === 'live' && window.CGSkipOwner) window.CGSkipOwner(store.user && store.user.id, p && p.blId);
    if (!p) {
      if (adminCard()) {
        var todo = hostTodo().total;
        el.innerHTML = '<h2>' + esc(store.user ? store.user.name : 'Host') + ' <span class="admin-badge">Admin</span></h2><p class="lede">You\'re running this game, not playing in it. Runs to approve and the game setup are in Host tools.</p>' +
          '<div class="row"><button type="button" class="btn host-btn' + (todo ? ' todo' : '') + '" id="meTools"' + (todo ? ' aria-label="Host tools, ' + todo + ' waiting on you"' : '') + '>' + SKULL + '<span>Host tools</span>' + (todo ? '<span class="nav-badge" aria-hidden="true">' + todo + '</span>' : '') + '</button><button type="button" class="btn ghost" id="meHost">User log</button><button type="button" class="btn ghost" id="meStats">Stats</button></div>';
        return;
      }
      if (store.mode === 'live' && store.user && !store.canPlay) {
        el.innerHTML = '<h2>You\'re on the list</h2><p class="lede">Thanks, ' + esc(store.user.name) + '. You can watch the game now. The host will let you in to play.</p>' +
          '<div class="row"><button type="button" class="btn ghost" id="checkAgain">Check again</button><button type="button" class="btn link" id="logoutBtn">Sign out</button></div>';
        return;
      }
      if (!E.signupsOpen(s)) {
        el.innerHTML = '<h2>Join the escape</h2><p class="lede">You can join as soon as the game starts. Watch your clan Discord for the start.</p>';
      } else if (store.mode === 'live' && !store.user) {
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
    var rv = X.rivals(s, p.id);
    if (rv && rv.ahead) stats.push('<span class="stat rival">\uD83D\uDD25 <b>' + esc(s.players[rv.ahead.pid].name) + '</b> is ' + rv.ahead.n + ' ahead</span>');
    if (rv && rv.tied.length) stats.push('<span class="stat rival">\uD83E\uDD1D Neck and neck with <b>' + esc(s.players[rv.tied[0]].name) + '</b>' + (rv.tied.length > 1 ? ' +' + (rv.tied.length - 1) : '') + '</span>');
    if (rv && rv.behind) stats.push('<span class="stat rival">\uD83D\uDC40 <b>' + esc(s.players[rv.behind.pid].name) + '</b> is ' + rv.behind.n + ' behind</span>');
    var bl = X.badgesFor(s)[p.id] || [];
    el.innerHTML = '<div class="me-row">' + avatarHtml(p, 'me-ava') + '<div><div class="me-name">' + esc(p.name) + '</div><div class="me-sub">' + esc(route) +
      (p.blId ? ' &middot; <a href="https://beatleader.com/u/' + encodeURIComponent(p.blId) + '" target="_blank" rel="noopener">BeatLeader</a>' : '') + '</div></div></div>' +
      (stats.length ? '<div class="me-stats">' + stats.join('') + '</div>' : '') +
      '<div class="me-badges">' + bl.map(function (b) { return '<button type="button" class="badge" data-badges="' + esc(p.id) + '" title="' + esc(b.desc) + '"><i aria-hidden="true">' + b.icon + '</i>' + esc(b.name) + '</button>'; }).join('') + '</div>';
    el.style.setProperty('--c', col);
    badgeNotice(p, bl);
    // Roll reminders live behind the bell in the header.
    var rb = $('remBtn'), wantRem = store.mode === 'live' && store.canPlay && !p.finished && s.status !== 'finished' && E.remindHour(s) != null;
    if (rb.hidden === wantRem) { rb.hidden = !wantRem; if (!wantRem) closeRem(); }
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
    if (pre && !p && !E.signupsOpen(s)) { el.innerHTML = '<h2>Sign-ups are closed</h2>' + pre + '<p class="empty">Joining opens when the game starts. Come back then to get a token and pick your route.</p>'; return; }
    if (pre && !p) { el.innerHTML = '<h2>Sign-ups are open</h2>' + pre + '<p class="empty">' + (store.mode === 'live' && !store.canPlay ? 'Once the host lets you in, you can join and pick your route before the start.' : 'Join now and pick your route. Everyone rolls for the first time when the countdown ends.') + '</p>'; return; }
    if (!p) { el.innerHTML = '<h2>Your turn</h2><p class="empty">' + (store.mode === 'live' && !store.canPlay ? 'Once the host lets you in, you can join and get a token on the board.' : 'Join the game to get a token on the board.') + '</p>'; return; }
    if (!p.route) {
      el.innerHTML = '<h2>Pick your route</h2>' + pre + '<p class="why">You can\'t change it later.</p><div class="routes">' +
        ['longer', 'riskier'].map(function (r) {
          var info = s.board.routeInfo[r];
          return '<button type="button" class="route-card' + (r === 'riskier' ? ' risk' : '') + '" data-route="' + r + '"><b>' + esc(info.name) + '</b><span>' + esc(routeBlurb(r)) + '</span><span class="rc-stats">' + esc(routeCounts(s.board, r)) + '</span></button>';
        }).join('') + '</div>';
      return;
    }
    var html = '<h2>' + (p.finished ? esc(theme().words.escaped) : 'Your turn') + '</h2>';
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
  // A lost turn waiting after today's roll pushes the next roll past tomorrow.
  function nextRollDay(s, p) { return s.day + (p.skip || 0) + 1; }
  function lostAhead(s, p) {
    if (!p.skip) return '';
    return (p.skip > 1 ? 'You lose your next ' + p.skip + ' turns' : 'You lose your next turn') + ', so your next roll is on day ' + nextRollDay(s, p) + '.';
  }
  function rollWhy(c, p) {
    var s = st();
    if (c.code === 'task') {
      var why = 'Your next roll unlocks once BeatLeader shows a pass on ' + (p.tasks.length > 1 ? 'each of these maps' : 'this map') + '. Any difficulty, any modifiers.';
      if (p.skippedDay === s.day) why += ' You\'re sitting out today, so play it now and roll on day ' + nextRollDay(s, p) + '.';
      else if (p.rolledDay === s.day && p.skip) why += ' ' + lostAhead(s, p);
      return why;
    }
    if (c.code === 'rolled') {
      if (p.skip) return lostAhead(s, p) + (store.mode === 'demo' ? ' In the demo, use Start the next day.' : '');
      return store.mode === 'demo' ? 'Come back tomorrow. In the demo, use Start the next day.' : 'Your next roll opens when the day turns over.';
    }
    if (c.code === 'skip') return p.skip ? 'You sit this one out. ' + p.skip + ' more after today.' : 'You sit this one out. You can roll again tomorrow.';
    return c.reason;
  }
  // Opens Playlist Studio with the task's map(s) already looked up (a single map opens its preview).
  // The button wears Studio's own logo and colors, since it leads out to that app.
  // The whole board as a Playlist Studio share link (#p= is Studio's own share format: title, author
  // and [hash, difficulty, mode] per song; an empty difficulty lets each player pick one there).
  var STUDIO_HOME = 'https://spanky3651.github.io/Playlist-Studio/?utm_source=chester&utm_campaign=get-the-maps';
  var STUDIO_SYNC = 'https://spanky3651.github.io/Playlist-Studio/?utm_source=chester&utm_campaign=get-the-maps-sync#studio-sync';
  function studioPlaylistLink(title, rows) {
    var json = JSON.stringify({ v: 1, t: String(title || '').slice(0, 120), a: 'MSploit', s: rows });
    var b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return STUDIO_HOME + '#p=' + b64;
  }
  var STUDIO_LOGO = '<span class="studio-logo" aria-hidden="true"><svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#08090c"/><path class="hr" d="M8.06 30.33A24 24 0 0 1 51.9 18.58" stroke="#ff2740" stroke-width="7" stroke-linecap="round" fill="none"/><path class="hb" d="M55.94 33.67A24 24 0 0 1 12.1 45.42" stroke="#2f7bff" stroke-width="7" stroke-linecap="round" fill="none"/><g class="ptri"><circle cx="32" cy="32" r="13.8" fill="#fff"/><path d="M28.12 24.24L40.05 32 28.12 39.76Z" fill="#08090c" stroke="#08090c" stroke-width="1.87" stroke-linejoin="round"/></g></svg></span>';
  function studioLink(keys) {
    return 'https://spanky3651.github.io/Playlist-Studio/?bsr=' + keys.map(encodeURIComponent).join(',') + '&utm_source=chester&utm_campaign=bsr-link';
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
        '<a class="btn small ghost studio-btn" target="_blank" rel="noopener" href="' + esc(studioLink(task.bsr)) + '" title="Open this map in Playlist Studio">' + STUDIO_LOGO + '<span>Playlist <b>Studio</b></span></a>' +
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
  var ICON = { roll: '🎲', land: '📍', task: '🎵', card: '🃏', move: '➡️', skip: '⏸️', start: '↩️', warp: '🌀', cleared: '✅', claim: '📨', 'claim-rejected': '❌', 'lost-turn': '💤', escaped: '🎉', route: '🧭', join: '👋', shield: '🛡️', 'shield-used': '🛡️', again: '🎲', overshoot: '🎯', 'gate-closed': '🔒', 'host-move': '🧹', 'host-reset': '🧹', reshuffle: '🔀', begin: '🏁', pass: '⚡' };
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
        var detail = pr.diff ? ' (' + esc(pr.diff.replace('ExpertPlus', 'Expert+')) + (pr.acc ? ', ' + (pr.acc * 100).toFixed(2) + '%' : '') + (pr.firstAcc != null ? ', improved' : '') + ')' : '';
        var rp = pr.score ? replayChip(S.replayUrl(pr.score), e.id) : '';
        var gr = X.grade(pr.acc), song = songFor((e.bsr || [])[0]);
        return { html: '<span class="score-line">' + (gr ? '<span class="grade-chip ' + gr.cls + '" title="' + gr.g + ' rank">' + gr.g + '</span>' : '') + 'Cleared <b>' + (song ? esc(song.name) : '!bsr ' + esc((e.bsr || []).join(' or '))) + '</b> ' + how + detail + rp + '</span>', cls: 'good' };
      }
      case 'claim': return { html: 'Asked the host to approve a run' + (e.url ? (isBLReplay(e.url) ? replayChip(e.url, e.id) : ' (<a href="' + esc(e.url) + '" target="_blank" rel="noopener">replay</a>)') : '') };
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
      case 'pass': { var nm = (e.over || []).map(function (q) { return s.players[q] ? '<b>' + esc(s.players[q].name) + '</b>' : ''; }).filter(Boolean); return nm.length ? { html: 'Passed ' + (nm.length > 2 ? nm.slice(0, -1).join(', ') + ' and ' + nm[nm.length - 1] : nm.join(' and ')), cls: 'good' } : null; }
      default: return null;
    }
  }
  // ---- replays: a Replay chip in the thread. On a computer it plays big over the page (theater mode),
  // in a player that lives outside the thread so a redraw doesn't restart it. On phones it opens
  // BeatLeader's viewer in a new tab like before.
  var RP_ICON = '<span class="rp-ico" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4 2.4L9.8 6 4 9.6Z"/></svg></span>';
  var RD_SVG = {
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  var dockEv = null;
  function isBLReplay(url) { return /^https:\/\/replay\.beatleader\.(com|xyz)\//.test(String(url || '')); }
  function replayEmbedOK() { return window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches; }
  function replayChip(url, evId) {
    var on = dockEv === evId;
    return ' <a class="rp-chip" href="' + esc(url) + '" target="_blank" rel="noopener" data-replay="' + esc(url) + '" data-rpev="' + evId + '"' + (on ? ' aria-pressed="true"' : '') + ' title="Watch the replay">' + RP_ICON + '<span>' + (on ? 'Watching' : 'Replay') + '</span></a>';
  }
  function openReplay(a) {
    var url = a.dataset.replay, ev = Number(a.dataset.rpev), d = $('replayDock');
    if (!d || !isBLReplay(url)) return false;
    // The thread column is sticky, which traps anything inside it under the board's own buttons
    // (like Replay day). Living directly on the page lets theater mode sit above everything.
    if (d.parentNode !== document.body) document.body.appendChild(d);
    if (dockEv === ev && !d.hidden) return true;
    var s = st(), e = s.events.filter(function (x) { return x.id === ev; })[0], p = e && s.players[e.pid];
    var song = e ? songFor((e.bsr || [])[0]) : null, pr = (e && e.proof) || {};
    var title = (p ? esc(p.name) : 'Replay') + (song ? ' \u00b7 ' + esc(song.name) : '') + (pr.acc ? ' \u00b7 ' + (pr.acc * 100).toFixed(2) + '%' : '');
    dockEv = ev;
    d.innerHTML = '<div class="rd-head"><span class="rd-title">' + RP_ICON + '<b>' + title + '</b></span><span class="rd-btns">' +
      '<a class="rd-btn" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="Open on BeatLeader" title="Open on BeatLeader">' + RD_SVG.out + '</a>' +
      '<button type="button" class="rd-btn" data-rd="close" aria-label="Close the replay" title="Close">' + RD_SVG.close + '</button></span></div>' +
      '<div class="rd-frame"><iframe src="' + esc(url) + '" title="Replay" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div>';
    d.hidden = false; bigReplay(true);
    renderFeed();
    var x = d.querySelector('[data-rd="close"]'); if (x) x.focus();
    track('replay-embed');
    return true;
  }
  function bigReplay(on) {
    var d = $('replayDock'); if (!d || d.hidden) return;
    d.classList.toggle('big', on); document.body.classList.toggle('rd-theater', on);
  }
  function closeReplay() {
    var d = $('replayDock'); if (!d || d.hidden) return;
    bigReplay(false); d.hidden = true; d.innerHTML = ''; dockEv = null; renderFeed();
  }
  function renderFeed() {
    var s = st(), list = $('feed'), html = '', lastDay = null, shown = 0;
    var evs = s.events.slice().reverse();
    for (var i = 0; i < evs.length && shown < 120; i++) {
      var e = evs[i];
      if (e.t === 'day') { if (feedMode === 'all') html += '<li class="dayline">Day ' + e.day + ' begins</li>'; continue; }
      if (e.t === 'begin') { html += '<li class="dayline">🏁 The game starts. Day 1 begins</li>'; continue; }
      if (feedMode === 'me' && e.pid !== store.me) continue;
      var p = s.players[e.pid]; if (e.pid && !p) continue;   // someone who left the game
      var x = evText(e); if (!x) continue;
      var rxh = rxRow(e), nActs = (rxh.match(/class="(rx-add|fd-share)"/g) || []).length;
      html += '<li data-ev="' + e.id + '"' + (nActs ? ' class="has-acts' + (nActs > 1 ? ' two' : '') + '"' : '') + '><span class="ic" aria-hidden="true">' + (ICON[e.t] || '•') + '</span><span>' +
        (feedMode === 'all' && p ? '<span class="who">' + esc(p.name) + '</span> ' : '') +
        '<span class="' + (x.cls || '') + '">' + x.html + '</span> <span class="when">' + (e.pre ? 'sign-up' : 'day ' + e.day) + '</span>' + rxh + '</span></li>';
      shown++;
    }
    list.innerHTML = html || '<li class="empty" style="display:block">' + (feedMode === 'me' ? 'Your moves show up here.' : 'Nothing has happened yet.') + '</li>';
    Array.prototype.forEach.call(document.querySelectorAll('.seg [data-feed]'), function (b) { b.setAttribute('aria-selected', b.dataset.feed === feedMode ? 'true' : 'false'); });
  }

  // Reactions under a thread item, plus react and share buttons.
  var RX_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="12" r="8"/><path d="M8 14.5c1.6 1.8 4.4 1.8 6 0"/><path d="M8.5 9.5h.01M13.5 9.5h.01"/><path d="M20 3v4M18 5h4"/></svg>';
  var SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  var REACTABLE = { cleared: 1, escaped: 1, card: 1, move: 1, start: 1, warp: 1, pass: 1, skip: 1, 'lost-turn': 1, join: 1, 'gate-closed': 1, 'shield-used': 1 };
  function shareable(e) { return e.pid === store.me && (e.t === 'cleared' || e.t === 'escaped' || e.t === 'pass' || e.t === 'start' || (e.t === 'warp') || (e.t === 'move' && Math.abs(e.n) >= 3) || e.t === 'card'); }
  // Who reacts from this browser: your player, or (live) anyone signed in and let in, joined or not.
  function rxMe() {
    var p = me(); if (p) return p;
    if (store.mode === 'live' && store.user && store.canPlay) return { id: 'd' + store.user.id, name: store.user.name, avatar: store.user.avatar };
    return null;
  }
  // A host running this game without playing in it.
  function isAdmin(s, pid) { return !s.players[pid] && (store.admins || []).indexOf(pid) >= 0; }
  function rxRow(e) {
    var s = st(), r = X.rxCounts((s.reactions || {})[e.id]), mine = rxMe(), html = '', t = theme();
    E.REACTIONS.forEach(function (id) {
      var who = (r[id] || []).filter(function (q) { return E.reactor(s, q); }); if (!who.length) return;
      var on = mine && who.indexOf(mine.id) >= 0, label = X.rxLabel(id, t);
      html += '<button type="button" class="rx-chip" data-rx="' + id + '" data-ev="' + e.id + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + ', ' + who.length + '" title="' + esc(label + ': ' + who.map(function (q) { return E.reactor(s, q).name; }).join(', ')) + '"' + (mine ? '' : ' aria-disabled="true"') + '>' + X.rxIcon(id, t) + '<b>' + who.length + '</b></button>';
    });
    var acts = '';
    if (mine && REACTABLE[e.t] && e.pid !== mine.id) acts += '<button type="button" class="rx-add" data-rxadd="' + e.id + '" aria-label="React" title="React">' + RX_ICON + '</button>';
    if (shareable(e)) acts += '<button type="button" class="fd-share" data-share="' + e.id + '" aria-label="Share this moment" title="Share this moment">' + SHARE_ICON + '</button>';
    return (html ? '<span class="rx">' + html + '</span>' : '') + (acts ? '<span class="fd-acts">' + acts + '</span>' : '');
  }
  // The picker leads with what fits the moment: SS and FC for a score, RIP and the bomb for a setback.
  function openRx(btn) {
    var pop = $('rxPop'), id = Number(btn.dataset.rxadd), s = st(), r = X.rxCounts((s.reactions || {})[id]), mine = rxMe(), t = theme();
    var ev = s.events.filter(function (x) { return x.id === id; })[0];
    pop.innerHTML = X.rxOrder(ev).map(function (rid) {
      var on = mine && (r[rid] || []).indexOf(mine.id) >= 0, label = X.rxLabel(rid, t);
      return '<button type="button" data-rx="' + rid + '" data-ev="' + id + '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + X.rxIcon(rid, t) + '<span>' + esc(label) + '</span></button>';
    }).join('');
    pop.hidden = false;
    var b = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, v = window.visualViewport;
    var L = v ? v.offsetLeft : 0, T = v ? v.offsetTop : 0, VW = v ? v.width : innerWidth;
    pop.style.left = Math.max(L + 8, Math.min(L + VW - w - 8, b.left + b.width / 2 - w / 2)) + 'px';
    pop.style.top = (b.top - h - 8 < T + 8 ? b.bottom + 8 : b.top - h - 8) + 'px';
    pop.querySelector('button').focus();
  }
  function closeRx() { var p = $('rxPop'); if (p && !p.hidden) p.hidden = true; }
  function doReact(btn) {
    if (!rxMe()) { toast(store.mode === 'live' && !store.user ? 'Sign in to react.' : 'You can react once the host lets you in.', ''); return; }
    var em = btn.dataset.rx, id = Number(btn.dataset.ev);
    closeRx(); track('react');
    store.act('react', { id: id, emoji: em }).then(function () {
      var chip = document.querySelector('#feed li[data-ev="' + id + '"] .rx-chip[data-rx="' + em + '"]'); if (chip) { void chip.offsetWidth; chip.classList.add('bump'); }
    }, fail);
  }
  // Someone reacted to one of your moments: a quick toast (not for your own reactions).
  var rxSeen = null;
  function rxNotice() {
    var s = st(), mine = me(); if (!s || !mine) return;
    var now = {}, news = [];
    Object.keys(s.reactions || {}).forEach(function (id) {
      var ev = null; for (var i = s.events.length - 1; i >= 0; i--) if (s.events[i].id === Number(id)) { ev = s.events[i]; break; }
      if (!ev || ev.pid !== mine.id) return;
      var rc = X.rxCounts(s.reactions[id]);
      Object.keys(rc).forEach(function (em) { rc[em].forEach(function (q) { if (q === mine.id) return; var k = id + em + q; now[k] = 1; if (rxSeen && !rxSeen[k] && E.reactor(s, q)) news.push({ who: E.reactor(s, q).name, em: em, ev: ev }); }); });
    });
    rxSeen = now;
    if (!news.length) return;
    var n = news[news.length - 1], what = n.ev.t === 'cleared' ? 'your clear' : n.ev.t === 'escaped' ? 'your escape' : 'your move';
    toast(news.length > 1 ? news.length + ' new reactions on your moments' : n.who + ' reacted ' + X.rxLabel(n.em, theme()) + ' to ' + what, 'good');
  }

  // ---- standings -----------------------------------------------------------------
  function songCover(p) {
    var m = p.tasks.length && songFor(p.tasks[0].bsr[0]);
    return m && m.cover ? '<img class="st-cover" src="' + esc(m.cover) + '" alt="" loading="lazy">' : '';
  }
  function badgeIcons(pid, max) {
    var list = X.badgesFor(st())[pid] || []; if (!list.length) return '';
    return '<span class="st-badges" data-badges="' + esc(pid) + '" title="' + esc(list.map(function (b) { return b.name; }).join(', ')) + '. Tap for details.">' + list.slice(0, max).map(function (b) { return b.icon; }).join('') + (list.length > max ? '+' + (list.length - max) : '') + '</span>';
  }
  function renderStandings() {
    var s = st();
    var rank = s.status === 'finished' && s.final ? s.final : E.ranking(s);
    // Before anyone has moved, places only say which route is shorter, so there are none yet:
    // players are listed in the order they signed up until the first token leaves the start.
    var moved = s.status === 'finished' || s.order.some(function (pid) { var q = s.players[pid]; return q.route && (q.pos >= 0 || q.finished); });
    var ids = moved ? rank.map(function (r) { return r.pid; }).filter(function (pid) { return s.players[pid]; }) : s.order.filter(function (pid) { return s.players[pid].route; });
    // Signed up but no route yet: listed last, with no place, so everyone can see they're in.
    if (s.status !== 'finished') ids = ids.concat(s.order.filter(function (pid) { return !s.players[pid].route; }));
    var placeOf = {}; rank.forEach(function (r) { placeOf[r.pid] = r.place; });
    var on = onlineMap(), nOn = Object.keys(on).length;
    var html = '<div class="st-head"><h2>' + (s.status === 'finished' ? 'Final standings' : 'Standings') + (nOn ? ' <span class="online-count" title="Players with the game open right now"><i aria-hidden="true"></i>' + nOn + ' online</span>' : '') + '</h2><button type="button" class="btn small ghost hall-btn" data-hall>\uD83C\uDFC6 Hall of fame</button></div><ol class="st-list' + (moved ? '' : ' no-places') + '">';
    ids.forEach(function (pid, i) {
      var p = s.players[pid], col = R.playerColor(s, pid), pct = Math.round(E.progress(s, p) * 100), none = !p.route;
      html += '<li><button type="button" class="st' + (pid === store.me ? ' me' : '') + (p.finished ? ' done' : '') + (none ? ' noroute' : '') + '" data-pid="' + esc(pid) + '" title="' + esc(p.name) + '" style="--c:' + col + '">' +
        (moved ? '<span class="place' + (p.finished || s.status === 'finished' ? ' ord' : '') + '">' + (none ? '–' : p.finished ? ordinal(p.finished.place) : s.status === 'finished' ? ordinal(placeOf[pid]) : placeOf[pid] || i + 1) + '</span>' : '') + '<span class="ava-wrap' + (on[pid] ? ' online' : '') + '"' + (on[pid] ? ' title="Online now"' : '') + '>' + avatarHtml(p, 'ava') + '</span>' +
        '<span style="min-width:0"><span class="st-line"><span class="nm">' + esc(p.name) + '</span><span class="chip ' + (none ? 'none' : p.route === 'riskier' ? 'risk' : 'long') + '">' + (none ? 'No route yet' : p.route === 'riskier' ? 'Riskier' : 'Longer') + '</span>' + badgeIcons(pid, 4) + '</span>' +
        '<span class="sub" style="display:block"' + (p.tasks.length ? ' title="!bsr ' + esc(p.tasks.map(function (t) { return t.bsr.join(' or '); }).join(', ')) + '"' : '') + '>' + songCover(p) + '<span class="st-t">' + esc(statusLine(p)) + '</span></span><span class="bar"><i style="width:' + pct + '%"></i></span></span></button></li>';
    });
    $('standings').innerHTML = html + '</ol>';
  }
  // What's on a route, to compare the two at a glance.
  function routeCounts(b, r) {
    var n = { map: 0, task: 0, card: 0, good: 0, bad: 0 };
    (b.routes[r] || []).forEach(function (id) {
      var sp = b.spaces[id]; if (!sp) return;
      if (sp.type === 'map') n.map++; else if (sp.type === 'task') n.task++; else if (sp.type === 'card') n.card++;
      else if ((sp.type === 'move' && sp.n > 0) || sp.type === 'safe' || (sp.type === 'warp' && sp.kind === 'swim')) n.good++;
      else if (sp.type !== 'exit') n.bad++;
    });
    var w = function (k, one, many) { return n[k] + ' ' + (n[k] === 1 ? one : many); };
    return [w('map', 'map', 'maps'), w('task', 'blocker', 'blockers'), w('card', 'card drop', 'card drops'), w('good', 'boost', 'boosts'), w('bad', 'setback', 'setbacks')].join(' \u00b7 ');
  }
  // Song names for the standings. Board maps arrive with the covers; bonus maps are looked up here.
  var mapInfo = {}, mapAsked = {};
  function songFor(key) {
    key = String(key || '').toLowerCase();
    if (mapInfo[key]) return mapInfo[key];
    if (!mapAsked[key]) { mapAsked[key] = 1; S.maps([key]).then(function (f) { if (f[key]) { mapInfo[key] = f[key]; renderStandings(); renderFeed(); } }); }
    return null;
  }
  function statusLine(p) {
    var s = st();
    if (p.finished) return 'Escaped on day ' + p.finished.day;
    if (!p.route) return s.status === 'signup' ? 'Signed up, still picking a route' : 'Hasn\'t picked a route, so no rolls yet';
    if (s.status === 'signup') return 'Signed up, waiting for the start';
    if (s.status === 'finished') return E.remaining(s, p) + ' spaces to go at the end';
    if (p.tasks.length) return 'Playing ' + p.tasks.map(function (t) { var m = songFor(t.bsr[0]); return m ? m.name : '!bsr ' + t.bsr[0]; }).join(', ');
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
      else html = ava + '<span class="mb-txt"><b>' + esc(rollTitle(c)) + '</b><span>' + esc(c.code === 'rolled' ? (p.skip ? 'Next turn lost. Roll again on day ' + nextRollDay(s, p) : store.mode === 'demo' ? 'Next roll tomorrow' : 'Next roll after the cutoff') : c.reason) + '</span></span><button type="button" class="btn small ghost" id="mGo">Details</button>';
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
    if (statsOpen()) renderStats();
    applyDusk(); rxNotice();
  }

  // ---- rolling and animation --------------------------------------------------------
  function hopTo(pid, p, idx, fly) {
    var tok = svgEl.querySelector('.tok[data-pid="' + pid + '"]');
    var o = {}; o[pid] = posXY(p, idx);
    if (tok) { tok.classList.toggle('fly', !!fly); tok.classList.remove('hop'); void tok.getBBox(); if (!fly) tok.classList.add('hop'); }
    placeTokens(o);
    camTo(o[pid]);
    if (fly) sfx.land(); else sfx.hop();
    return wait(fly ? 720 : 250);
  }
  function walk(pid, p, from, to, trail) {
    var chain = Promise.resolve(), dir = to >= from ? 1 : -1;
    for (var i = from + dir; dir > 0 ? i <= to : i >= to; i += dir) (function (i) { chain = chain.then(function () { if (trail) FX.ghost(svgEl, posXY(p, i - dir), trail); return hopTo(pid, p, i); }); })(i);
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
    replayEvents(s.events.filter(function (e) { return e.day === d; }), 'Day ' + d + ' replay', 'That was day ' + d + '.');
  }
  // Plays a stretch of the game thread back on the board: a day, or everything since your last visit.
  function replayEvents(dayEvs, startCap, endCap) {
    var s = st(); if (animating || replaying || !dayEvs.length) return;
    var b = s.board, idx = function (p, spaceId) { return b.routes[p.route] ? b.routes[p.route].indexOf(spaceId) : -1; };
    var firstId = dayEvs[0].id;
    var pos = E.positionsBefore(s, firstId);   // rewind to the start of that day
    var at = {}, xy = function () { var o = {}; Object.keys(at).forEach(function (pid) { o[pid] = posXY(s.players[pid], at[pid]); }); return o; };
    Object.keys(pos).forEach(function (pid) { at[pid] = pos[pid]; });
    replaying = true; replayStop = false; animating = true; closeSpace();
    var zone = document.querySelector('.board-zone'); zone.classList.add('replaying');
    $('replayBtn').hidden = true; $('replayCap').hidden = false;
    var cap = function (html) { $('replayText').innerHTML = html; };
    cap(startCap);
    placeTokens(xy());
    var hop = function (pid, to, fly) {
      if (replayStop) return Promise.resolve();
      at[pid] = to; var tok = svgEl.querySelector('.tok[data-pid="' + pid + '"]');
      if (tok) { tok.classList.toggle('fly', !!fly); tok.classList.remove('hop'); void tok.getBBox(); if (!fly) tok.classList.add('hop'); }
      placeTokens(xy()); var o = xy(); camTo(o[pid], isPhone() ? 2 : 1.45);
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
        if (replayStop) return;
        if (e.t === 'day') { cap('Day ' + e.day + ' begins'); return wait(700); }
        if (!p || !p.route) return;
        var x = evText(e), name = '<b>' + esc(p.name) + '</b> ';
        var last = E.exitIndex(s, p);
        if (e.t === 'roll') { cap(name + (e.bonus ? 'took a bonus roll: ' : 'rolled a ') + '<b>' + e.n + '</b>'); return wait(350).then(function () { return walkTo(e.pid, e.from, Math.min(e.from + e.n, last)); }); }
        if (e.t === 'move') { if (x) cap(name + x.html); return walkTo(e.pid, e.from, e.to); }
        if (e.t === 'warp' && e.to) { if (x) cap(name + x.html); var wi = idx(p, e.to); return wi >= 0 ? hop(e.pid, wi, true) : null; }
        if (e.t === 'start') { cap(name + 'went back to the start'); return hop(e.pid, -1, true); }
        if (e.t === 'gate-closed') { cap(name + 'found the gate closed for today'); return hop(e.pid, last - 1); }
        if (e.t === 'host-move') { cap(name + 'was moved by the host'); return hop(e.pid, e.to, true); }
        if (e.t === 'host-reset') { cap(name + 'was reset by the host'); return hop(e.pid, -1, true); }
        if (e.t === 'pass') { if (x) { cap(name + x.html); FX.pop(svgEl, posXY(p, at[e.pid]), 'Passed!', 'gold'); return wait(900); } }
        if (e.t === 'escaped') { cap(name + x.html); FX.burst(svgEl, posXY(p, last), '#ffd34d'); return wait(1400); }
        if (e.t === 'card' || e.t === 'skip' || (e.t === 'task' && e.bonus)) { if (x) { cap(name + x.html); return wait(900); } }
      });
    });
    chain.then(function () { if (!replayStop) { cap(endCap); return wait(1100); } }).then(function () {
      replaying = false; animating = false; zone.classList.remove('replaying'); $('replayCap').hidden = true;
      camHome(); renderAll();
    });
  }

  var stageDie = null;
  function doRoll() {
    var p = me(); if (!p || animating) return;
    animating = true;
    ['rollBtn', 'mRoll'].forEach(function (id) { var b = $(id); if (b) b.disabled = true; });
    audio();
    var startPos = p.pos;
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
        // the camera moves in on your token, follows the hops, then pulls back out
        camTo(posXY(pp, startPos));
        return wait(camOK() ? 380 : 0).then(function () { return playEvents(pp, res.events, startPos); });
      }).then(function () {
        if (!pp.finished) ripple(posXY(pp, pp.pos));
        return wait(700);
      });
    }).catch(fail).then(function () {
      camHome();
      $('rollStage').hidden = true; document.querySelector('.board-zone').classList.remove('busy');
      animating = false; renderAll();
      var t = document.querySelector('.task'); if (t && !isPhone()) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Each kind of space lands its own way: boosts leave a trail, setbacks shake the token,
  // the river splashes, a map space flips its song up, and escaping sends the hero off the board.
  function playEvents(p, events, startPos) {
    var pos = startPos, chain = Promise.resolve(), escaped = null, last = E.exitIndex(st(), p);
    var col = R.playerColor(st(), p.id), here = function () { return posXY(p, pos); };
    events.forEach(function (e) {
      if (e.pid !== p.id) return;
      chain = chain.then(function () {
        switch (e.t) {
          case 'roll': { var to = Math.min(e.from + e.n, last); return walk(p.id, p, e.from, to).then(function () { pos = to; }); }
          case 'overshoot': toast('You need exactly ' + e.need + ' to reach the exit.'); return;
          case 'move':
            if (e.n > 0) { sfx.good(); FX.pop(svgEl, here(), '+' + e.n, 'good'); FX.burst(svgEl, here(), '#ffd34d'); tokFx(p.id, 'boost', 300 * (e.to - e.from) + 600); return wait(450).then(function () { return walk(p.id, p, e.from, e.to, col); }).then(function () { pos = e.to; }); }
            sfx.bad(); tokFx(p.id, 'shake', 520); FX.flash(svgEl, here(), '#ff5a6e'); FX.pop(svgEl, here(), '\u2212' + (-e.n), 'bad');
            return wait(650).then(function () { return walk(p.id, p, e.from, e.to); }).then(function () { pos = e.to; });
          case 'start': sfx.bad(); tokFx(p.id, 'shake', 520); FX.pop(svgEl, here(), 'Back to start!', 'bad');
            return wait(600).then(function () { FX.puff(svgEl, here()); tokFx(p.id, 'vanish', 460); return wait(380); }).then(function () { return hopTo(p.id, p, -1, true); }).then(function () { pos = -1; FX.puff(svgEl, here()); });
          case 'warp': {
            var idx = E.routeOf(st(), p).indexOf(e.to), swim = st().board.spaces[e.space].kind === 'swim', water = (theme().palette.water || '#5ab0ff');
            (swim ? sfx.good : sfx.bad)();
            if (!swim) FX.swirl(svgEl, here(), '#c58bff');
            return wait(swim ? 200 : 600).then(function () { return hopTo(p.id, p, idx, true); }).then(function () { pos = idx; if (swim) { FX.splash(svgEl, here(), water); FX.pop(svgEl, here(), 'Splash!', 'good'); } });
          }
          case 'task': {
            var key = e.bsr && e.bsr[0]; if (!key) return;
            return S.map(key).then(function (m) { return m; }, function () { return null; }).then(function (m) { return FX.coverPop(svgEl, here(), m || { name: '!bsr ' + key }, e.bonus ? 'Bonus map' : 'Play this map'); });
          }
          case 'card': return showCard(E.cardById(st(), e.card), p.id);
          case 'skip': sfx.bad(); FX.zzz(svgEl, here()); toast(e.turns > 1 ? 'You lose ' + e.turns + ' turns.' : 'You lose a turn.', 'bad'); return wait(900);
          case 'shield-used': sfx.good(); FX.shield(svgEl, here()); toast('Your protection blocked that setback.', 'good'); return wait(700);
          case 'gate-closed': FX.pop(svgEl, here(), '\uD83D\uDD12 Gate closed', 'gold'); return wait(900);
          case 'pass': { var names = (e.over || []).map(function (q) { return st().players[q] ? st().players[q].name : ''; }).filter(Boolean); if (!names.length) return; sfx.good(); FX.burst(svgEl, here(), '#ffd34d'); FX.pop(svgEl, here(), 'Passed ' + (names.length > 2 ? names.length + ' players' : names.join(' & ')) + '!', 'gold'); return wait(1000); }
          case 'again': toast('You get another roll today.', 'good'); return;
          case 'escaped': escaped = e; return;
          default: return;
        }
      });
    });
    return chain.then(function () {
      if (!escaped) return;
      var xy = posXY(p, last);
      sfx.win();
      return camTo(xy, camZoom() * .8).then(function () { return FX.escape(svgEl, xy, theme()); }).then(function () { camHome(); return showWin(p, escaped.place); });
    });
  }

  // ---- cards -------------------------------------------------------------------------
  function cardFront(card) {
    var t = theme(), cc = { treasure: 'var(--treasure)', trick: 'var(--trick)', task: 'var(--task)', fate: 'var(--fate)' }[card.cls];
    return '<div class="ctype">' + esc(t.card[card.cls] || 'Card') + '</div><div class="cart' + (R.isImg(card.art) ? ' pic' : '') + '" aria-hidden="true">' + R.cardArt(card.art) + '</div>' +
      '<div class="ctitle">' + esc(card.title) + '</div><div class="ctext">' + esc(card.text) + '</div><div class="cfx">' + esc(C.cardEffectText(card)) + '</div>';
  }
  // The card flies out of your token, flips, then shimmers (good), cracks (bad) or glows.
  function showCard(card, fromPid) {
    return new Promise(function (resolve) {
      var t = theme(), ov = $('cardOverlay'), c3 = $('card3d');
      $('cardBack').innerHTML = '<div><svg class="crow" viewBox="-36 -42 72 80" aria-hidden="true">' + R.hero(0, 0, 1, t) + '</svg><p>' + esc(t.card.back) + '</p></div>';
      $('cardFront').innerHTML = cardFront(card) + '<span class="shine" aria-hidden="true"></span>' +
        (card.cls === 'trick' ? '<svg class="crack" viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true"><path class="hi" d="M100 6 L86 17 L90 27 L75 40 L79 50 L66 62 L69 70 M86 17 L72 15 L63 23 L55 21 M75 40 L62 37 L56 44 M90 27 L99 37 M79 50 L90 58 M66 62 L57 61"/><path d="M100 6 L86 17 L90 27 L75 40 L79 50 L66 62 L69 70 M86 17 L72 15 L63 23 L55 21 M75 40 L62 37 L56 44 M90 27 L99 37 M79 50 L90 58 M66 62 L57 61"/></svg>' : '');
      ov.setAttribute('data-cls', card.cls);
      var tk = fromPid && tokEl(fromPid), fr = tk && tk.getBoundingClientRect();
      c3.style.setProperty('--fx', fr ? (fr.left + fr.width / 2 - window.innerWidth / 2).toFixed(0) + 'px' : '0px');
      c3.style.setProperty('--fy', fr ? (fr.top + fr.height / 2 - window.innerHeight / 2).toFixed(0) + 'px' : '30px');
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
      var md = $('winMedal'); md.className = 'win-medal ' + (place <= 3 ? 'p' + place : 'pn'); md.textContent = place <= 3 ? ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'][place - 1] : ordinal(place);
      $('winShare').onclick = function () { var ev = st().events.filter(function (x) { return x.t === 'escaped' && x.pid === p.id; }).pop(); if (ev) openShare(ev); };
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
    animating = true;
    var ids = cleared.map(function (t) { return t.id; });
    var evs = st().events.filter(function (e) { return e.t === 'cleared' && e.pid === store.me && ids.indexOf(e.task) >= 0; });
    setTimeout(function () {
      (evs.length ? revealScores(evs) : Promise.resolve()).then(function () {
        animating = false; renderAll();
        toast(cleared.length > 1 ? 'Maps cleared. You can roll again.' : 'Map cleared! You can roll again.', 'good');
      });
    }, 700);
  }

  // ---- score reveal ------------------------------------------------------------------------
  // Your cleared map, big: the cover, the accuracy counting up, then the rank letter slams down.
  // Shown once per clear (and again for a new personal best), remembered in this browser.
  function revKey() { return 'cg.rev.' + st().id; }
  function revRead() { try { return JSON.parse(localStorage.getItem(revKey()) || 'null'); } catch (e) { return null; } }
  function revWrite(r) { try { localStorage.setItem(revKey(), JSON.stringify(r)); } catch (e) {} }
  function pendingReveals() {
    var s = st(), mine = me(); if (!s || !mine) return [];
    var list = s.events.filter(function (e) { return e.t === 'cleared' && e.pid === mine.id; });
    var r = revRead();
    if (!r) { r = { id: 0, imp: 0 }; list.forEach(function (e) { r.id = Math.max(r.id, e.id); r.imp = Math.max(r.imp, (e.proof && e.proof.improvedAt) || 0); }); revWrite(r); return []; }
    return list.filter(function (e) { return e.id > r.id || ((e.proof && e.proof.improvedAt) || 0) > r.imp; });
  }
  function markRevealed(evs) {
    var r = revRead() || { id: 0, imp: 0 };
    evs.forEach(function (e) { r.id = Math.max(r.id, e.id); r.imp = Math.max(r.imp, (e.proof && e.proof.improvedAt) || 0); });
    revWrite(r);
  }
  function revealScores(evs) {
    markRevealed(evs);
    return evs.reduce(function (ch, e) { return ch.then(function () { return showScore(e); }); }, Promise.resolve());
  }
  // Every so often two tokens sharing a space get into a scuffle. Never while anything else is
  // happening on the board, and never for reduced motion. ?scuffle=1 speeds it up for testing.
  var scuffleFast = /[?&]scuffle=1\b/.test(location.search);
  function scuffleSoon() { setTimeout(scuffle, scuffleFast ? 2600 : 10000 + Math.random() * 10000); }
  function scuffle() {
    scuffleSoon();
    if (!svgEl || animating || replaying || overlayOpen() || X.still() || document.visibilityState !== 'visible') return;
    var zone = document.querySelector('.board-zone');
    if (zone && /\b(busy|prelaunch|replaying)\b/.test(zone.className)) return;
    if (!$('spacePop').hidden || !$('rxPop').hidden || (cam && cam.raf)) return;
    var s = st(); if (!s || !s.order) return;
    var pos = R.layoutTokens(s, null, store.me), groups = {}, where = {};
    s.order.forEach(function (pid) {
      var p = s.players[pid], L = pos[pid]; if (!p || !p.route || !L || L.n < 2 || L.hidden) return;   // tucked into a pile: not visible
      var xy = R.tokenXY(s, p), key = Math.round(xy.x) + ',' + Math.round(xy.y);
      (groups[key] = groups[key] || []).push(pid); where[pid] = key;
    });
    var keys = Object.keys(groups).filter(function (k) { return groups[k].length > 1; });
    if (!keys.length) return;
    var a = null, b = null, kind = Math.random() < .25 ? 'knock' : 'shove';
    // a fresh overtake on a shared space is the likeliest grudge match
    var since = Date.now() - 48 * 3600e3, grudges = [];
    (s.events || []).forEach(function (e) {
      if (e.t !== 'pass' || !e.pid || new Date(e.at).getTime() < since || !where[e.pid]) return;
      (e.over || []).forEach(function (q) { if (where[q] === where[e.pid]) grudges.push([e.pid, q]); });
    });
    if (grudges.length && Math.random() < .6) {
      var gm = grudges[Math.floor(Math.random() * grudges.length)]; a = gm[0]; b = gm[1];
      if (Math.random() < .5) kind = 'knock';
    } else {
      var g = groups[keys[Math.floor(Math.random() * keys.length)]];
      a = g[Math.floor(Math.random() * g.length)];
      g.forEach(function (q) {
        if (q === a) return;
        var d = Math.pow(pos[q].x - pos[a].x, 2) + Math.pow(pos[q].y - pos[a].y, 2);
        if (b === null || d < Math.pow(pos[b].x - pos[a].x, 2) + Math.pow(pos[b].y - pos[a].y, 2)) b = q;
      });
    }
    if (!a || !b || !pos[a] || !pos[b]) return;
    var lead = X.flair(s).crown, crown = (lead === a || lead === b) && Math.random() < .35 ? lead : null;
    FX.scuffle(svgEl, { pid: a, x: pos[a].x, y: pos[a].y, r: pos[a].r }, { pid: b, x: pos[b].x, y: pos[b].y, r: pos[b].r }, { kind: kind, crown: crown, small: isPhone() });
  }
  function overlayOpen() { return !$('modal').hidden || !$('scoreOverlay').hidden || !$('cardOverlay').hidden || !$('winOverlay').hidden || !$('hostDrawer').hidden || statsOpen() || replaying; }
  function showScore(ev) {
    return new Promise(function (resolve) {
      var pr = ev.proof || {}, key = (ev.bsr || [])[0] || '', gr = X.grade(pr.acc), improved = pr.firstAcc != null && pr.improvedAt;
      var diff = pr.diff ? pr.diff.replace('ExpertPlus', 'Expert+') : '';
      var note = improved ? 'Up from ' + (pr.firstAcc * 100).toFixed(2) + '%' : pr.by === 'host' ? 'Approved by the host' : '';
      var ov = $('scoreOverlay'), card = $('scoreCard');
      card.innerHTML = '<div class="sc-bg"></div><div class="sc-in"><div class="sc-k">' + (improved ? 'New personal best' : 'Map cleared') + '</div>' +
        '<img class="sc-cover" alt=""><div class="sc-song">!bsr ' + esc(key) + '</div><div class="sc-meta"></div>' + (diff ? '<span class="sc-diff">' + esc(diff) + '</span>' : '') +
        '<div class="sc-row">' + (gr ? '<div class="sc-acc"><span id="scNum">' + (improved ? (pr.firstAcc * 100).toFixed(2) : '0.00') + '</span><small>%</small></div><div class="sc-grade ' + gr.cls + '" id="scGrade" hidden>' + gr.g + '</div>' : '<div class="sc-host" aria-hidden="true">\u2705</div>') + '</div>' +
        '<div class="sc-note">' + esc(note) + '</div><div class="sc-actions"><button type="button" class="btn" id="scOk">Continue</button><button type="button" class="btn ghost" id="scShare">Share it</button></div></div>';
      card.setAttribute('aria-label', improved ? 'New personal best' : 'Map cleared');
      ov.hidden = false; track('score-reveal');
      S.map(key).then(function (m) {
        var c = card.querySelector('.sc-cover'); if (m.cover) { c.src = m.cover; card.querySelector('.sc-bg').style.backgroundImage = 'url("' + m.cover.replace(/"/g, '') + '")'; }
        card.querySelector('.sc-song').textContent = m.name + (m.sub ? ' ' + m.sub : '');
        card.querySelector('.sc-meta').textContent = [m.author, m.mapper ? 'mapped by ' + m.mapper : ''].filter(Boolean).join(', ');
      }, function () {});
      var num = $('scNum'), done = false;
      function slam() {
        var g = $('scGrade'); if (!g || done) return; done = true;
        num.textContent = (pr.acc * 100).toFixed(2);
        g.hidden = false; void g.offsetWidth; g.classList.add('go');
        if (gr.g === 'SS') { sfx.win(); confettiBurst(); } else sfx.good();
      }
      if (gr) {
        var from = improved ? pr.firstAcc * 100 : 0, to = pr.acc * 100, t0 = 0, lastTick = 0, D = X.still() ? 0 : 1300;
        setTimeout(function () {
          if (!D) return slam();
          requestAnimationFrame(function step(t) {
            if (!t0) t0 = t;
            var k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3), v = from + (to - from) * e;
            if (!done) num.textContent = v.toFixed(2);
            if (v - lastTick > 6) { lastTick = v; blip(300 + v * 6, .04, 'square', .025); }
            if (k < 1 && !done) requestAnimationFrame(step); else slam();
          });
        }, 450);
      } else sfx.good();
      var ok = $('scOk'); setTimeout(function () { ok.focus(); }, 60);
      function close() { done = true; ov.hidden = true; document.removeEventListener('keydown', key2); resolve(); }
      function key2(e) { if (e.key === 'Escape' && $('modal').hidden) { e.preventDefault(); close(); } }
      ok.onclick = close; document.addEventListener('keydown', key2);
      $('scShare').onclick = function () { slam(); openShare(ev); };
    });
  }
  // New clears that showed up on their own (the server checks BeatLeader every 15 minutes).
  function checkNewClears() {
    if (animating || overlayOpen()) return;
    var pend = pendingReveals(); if (!pend.length) return;
    animating = true;
    revealScores(pend).then(function () { animating = false; renderAll(); });
  }

  // ---- badges ----------------------------------------------------------------------------------
  function badgeNotice(p, list) {
    var k = 'cg.badges.' + st().id + '.' + p.id, had = null;
    try { had = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
    var ids = list.map(function (b) { return b.id; });
    try { localStorage.setItem(k, JSON.stringify(ids)); } catch (e) {}
    if (!had) return;
    var fresh = list.filter(function (b) { return had.indexOf(b.id) < 0; });
    if (!fresh.length) return;
    var b = fresh[fresh.length - 1];
    setTimeout(function () { sfx.good(); toast('\uD83C\uDFC5 New badge: ' + b.icon + ' ' + b.name + '. ' + b.desc + '.', 'badge-toast'); track('badge-' + b.id); }, 400);
  }

  // Every badge with what it's for. Earned ones (for this player) light up; the rest show how to get them.
  // Everyone in a pile of tokens, from tapping the pile or its "+N" badge.
  function openPile(key) {
    var s = st(), L = R.layoutTokens(s, null, store.me), ids = s.order.filter(function (pid) { return L[pid] && L[pid].pile === key; });
    if (!ids.length) return;
    var p0 = s.players[ids[0]], tid = p0.pos >= 0 ? E.routeOf(s, p0)[p0.pos] : null, sp = tid ? s.board.spaces[tid] : null;
    var rank = {}; (s.status === 'finished' && s.final ? s.final : E.ranking(s)).forEach(function (r) { rank[r.pid] = r; });
    var on = onlineMap();
    track('pile');
    modal(ids.length + ' players here', '<p class="lede">' + (sp ? esc(R.label(sp, theme())) : 'At the start, waiting for their first roll.') + '</p><ul class="pile-list">' +
      ids.map(function (pid) {
        var p = s.players[pid], r = rank[pid];
        return '<li><button type="button" data-pile-pid="' + esc(pid) + '"' + (pid === store.me ? ' class="me"' : '') + '><span class="ava-wrap' + (on[pid] ? ' online' : '') + '">' + avatarHtml(p, 'ava') + '</span><b>' + esc(p.name) + (pid === store.me ? ' <i>(you)</i>' : '') + '</b>' +
          '<span class="chip ' + (p.route === 'riskier' ? 'risk' : 'long') + '">' + (p.route === 'riskier' ? 'Riskier' : 'Longer') + '</span>' + (r ? '<span class="pl-place">' + ordinal(r.place) + '</span>' : '') + '</button></li>';
      }).join('') + '</ul>', null, { cls: 'pile', focusClose: true });
  }
  function pingToken(pid) {
    var tok = svgEl && svgEl.querySelector('.tok[data-pid="' + cssq(pid) + '"]');
    if (tok) { tok.classList.remove('ping'); void tok.getBBox(); tok.classList.add('ping'); $('boardWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }
  // ---- player card: one player's game in numbers, worked out from the game log ----
  function playerStats(s, pid) {
    var p = s.players[pid], r = E.routeOf(s, p), last = Math.max(0, r.length - 1), t = E.tallyOf(s, pid), pos = t ? t.pos : -1;
    // start from the running totals for moments already trimmed from the log
    var o = t ? { rolls: t.rolls, total: t.total, clears: t.clears, accs: [], accSum: t.accSum, accN: t.accN, best: t.best, lost: t.lost, gained: t.gained, cards: t.cards, turnsLost: t.turnsLost, passed: t.passed, passedBy: t.passedBy }
      : { rolls: 0, total: 0, clears: 0, accs: [], accSum: 0, accN: 0, best: null, lost: 0, gained: 0, cards: 0, turnsLost: 0, passed: 0, passedBy: 0 };
    s.events.forEach(function (e) {
      if (e.t === 'pass' && (e.over || []).indexOf(pid) >= 0) o.passedBy++;
      if (e.pid !== pid) return;
      switch (e.t) {
        case 'roll': o.rolls++; o.total += e.n; pos = Math.min(last, (e.from == null ? pos : e.from) + e.n); break;
        case 'move': if (e.n < 0) o.lost += Math.min(-e.n, Math.max(0, (e.from == null ? pos : e.from) + 1)); else o.gained += e.n; pos = e.to; break;
        case 'warp': { var a = r.indexOf(e.space), b = r.indexOf(e.to); if (a >= 0 && b >= 0) { if (b < a) o.lost += a - b; else o.gained += b - a; pos = b; } break; }
        case 'start': o.lost += Math.max(0, pos + 1); pos = -1; break;
        case 'host-move': pos = e.to; break;
        case 'host-reset': pos = -1; break;
        case 'card': o.cards++; break;
        case 'lost-turn': o.turnsLost++; break;
        case 'pass': o.passed += (e.over || []).length; break;
        case 'cleared':
          o.clears++;
          if (e.proof && e.proof.acc) { o.accs.push(e.proof.acc); if (!o.best || e.proof.acc > o.best.acc) o.best = { acc: e.proof.acc, key: (e.bsr || [])[0], diff: e.proof.diff || '' }; }
          break;
      }
    });
    o.avgRoll = o.rolls ? o.total / o.rolls : 0;
    var accN = o.accN + o.accs.length, accSum = o.accSum + o.accs.reduce(function (x, y) { return x + y; }, 0);
    o.avgAcc = accN ? accSum / accN : 0; o.accCount = accN;
    return o;
  }
  function openPlayer(pid) {
    var s = st(), p = s.players[pid]; if (!p) return;
    var o = playerStats(s, pid), rank = (s.status === 'finished' && s.final ? s.final : E.ranking(s)).filter(function (x) { return x.pid === pid; })[0];
    var luck = !o.rolls ? 'No rolls yet' : o.avgRoll >= 2.8 ? 'Lucky' : o.avgRoll <= 2.2 ? 'Unlucky' : 'Right on average';
    var tile = function (v, k, sub) { return '<div class="pc-tile"><b>' + v + '</b><span>' + k + '</span>' + (sub ? '<i>' + sub + '</i>' : '') + '</div>'; };
    var song = o.best && o.best.key ? songFor(o.best.key) : null, list = X.badgesFor(s)[pid] || [];
    var where = p.finished ? 'Escaped on day ' + p.finished.day : !p.route ? 'No route yet' : rank ? rank.left + ' spaces to go' : '';
    track('player-card');
    modal(p.name,
      '<div class="pc-head" style="--c:' + R.playerColor(s, pid) + '">' + avatarHtml(p, 'pc-ava') + '<div><div class="pc-place">' + (rank && p.route ? ordinal(rank.place) + ' place' : 'Signed up') + '</div>' +
      '<div class="pc-where">' + esc(where) + (p.route ? ' · ' + esc(s.board.routeInfo[p.route].name) : '') + '</div></div></div>' +
      '<div class="pc-grid">' +
      tile(o.clears, 'Maps cleared') +
      tile(o.accCount ? (o.avgAcc * 100).toFixed(2) + '%' : '–', 'Average accuracy') +
      tile(o.best ? (o.best.acc * 100).toFixed(2) + '%' : '–', 'Best clear', o.best ? esc((song && song.name) || ('!bsr ' + o.best.key)) + (o.best.diff ? ' · ' + esc(o.best.diff) : '') : '') +
      tile(o.rolls ? o.avgRoll.toFixed(2) : '–', 'Average roll', esc(luck) + (o.rolls ? ' \u00b7 ' + o.rolls + ' roll' + (o.rolls === 1 ? '' : 's') + ', 2.50 is average' : '')) +
      tile(o.lost, 'Spaces lost', 'to setbacks') +
      tile(o.gained, 'Spaces gained', 'from boosts and shortcuts') +
      tile(o.cards, 'Cards drawn') +
      tile(o.passed + ' / ' + o.passedBy, 'Passed / passed by') +
      (o.turnsLost ? tile(o.turnsLost, 'Turns lost') : '') +
      '</div>' +
      (list.length ? '<div class="pc-badges"><span>Badges</span>' + list.map(function (b) { return '<button type="button" class="badge" data-badges="' + esc(pid) + '" title="' + esc(b.name + ': ' + b.desc) + '"><i aria-hidden="true">' + b.icon + '</i> ' + esc(b.name) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="row" style="margin-top:14px">' + (p.route ? '<button type="button" class="btn ghost" data-pcard-board="' + esc(pid) + '">Show on the board</button>' : '') +
      (p.blId ? '<a class="btn ghost" href="https://beatleader.com/u/' + encodeURIComponent(p.blId) + '" target="_blank" rel="noopener">BeatLeader profile</a>' : '') + '</div>',
      null, { cls: 'pcard', focusClose: true });
  }
  // ---- hall of fame: every finished game in this clan, and the all-time table ----
  function openHall() {
    var hall = (store.hall || []).slice().reverse(), totals = E.hallTotals(store.hall || []).slice(0, 10);
    track('hall-of-fame');
    var medal = ['🥇', '🥈', '🥉'];
    var ava = function (t) { return t.avatar ? '<img class="hf-ava" src="' + esc(t.avatar) + '" alt="" onerror="this.outerHTML=\'<span class=&quot;hf-ava&quot;>' + esc(R.initials(t.name)) + '</span>\'">' : '<span class="hf-ava">' + esc(R.initials(t.name)) + '</span>'; };
    var when = function (ts) { return ts ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
    var html = !hall.length ? '<p class="lede">No game has finished yet. The first winner goes up here.</p>' :
      '<p class="lede">Every finished game, newest first.</p><div class="hf-games">' + hall.map(function (g) {
        return '<div class="hf-game"><div class="hf-gh"><b>' + esc(g.title) + '</b><span>' + esc(when(g.endedAt)) + ' · ' + g.days + ' day' + (g.days === 1 ? '' : 's') + ' · ' + g.players + ' player' + (g.players === 1 ? '' : 's') +
          (store.isHost ? '<button type="button" class="btn small link hf-rm" data-hallrm="' + esc(g.id) + '">Remove</button>' : '') + '</span></div>' +
          '<ol class="hf-pod">' + g.top.map(function (t, i) { return '<li class="p' + (i + 1) + '"><span class="hf-m">' + medal[i] + '</span>' + ava(t) + '<b>' + esc(t.name) + '</b><span>' + (t.escaped ? 'Escaped day ' + t.day : t.left + ' to go') + '</span></li>'; }).join('') + '</ol></div>';
      }).join('') + '</div>' +
      '<h3 class="hw-h">All time</h3><table class="hf-table"><thead><tr><th>Player</th><th>Wins</th><th>Podiums</th><th>Escapes</th><th>Games</th></tr></thead><tbody>' +
      totals.map(function (t, i) { return '<tr' + (t.pid === store.me ? ' class="me"' : '') + '><td><span class="hf-rank">' + (i + 1) + '</span>' + esc(t.name) + '</td><td>' + t.wins + '</td><td>' + t.podiums + '</td><td>' + t.escapes + '</td><td>' + t.games + '</td></tr>'; }).join('') + '</tbody></table>';
    modal('🏆 Hall of fame', html, null, { cls: 'hall', focusClose: true });
  }
  function openBadges(pid) {
    var s = st(), p = s.players[pid], have = {}, list = X.badgesFor(s)[pid] || [];
    list.forEach(function (b) { have[b.id] = 1; });
    track('badges');
    var rows = X.BADGES.slice().sort(function (a, b) { return (have[b.id] || 0) - (have[a.id] || 0); }).map(function (b) {
      var holders = s.order.filter(function (q) { return (X.badgesFor(s)[q] || []).some(function (x) { return x.id === b.id; }); }).map(function (q) { return s.players[q].name; });
      return '<li class="bg-row' + (have[b.id] ? ' got' : '') + '"><span class="bg-ic" aria-hidden="true">' + b.icon + '</span><span><b>' + esc(b.name) + '</b>' + (have[b.id] ? ' <span class="bg-got">Earned</span>' : '') +
        '<span class="bg-desc">' + esc(b.desc) + '</span>' + (holders.length ? '<span class="bg-who">' + esc(holders.length > 4 ? holders.slice(0, 4).join(', ') + ' and ' + (holders.length - 4) + ' more' : holders.join(', ')) + '</span>' : '') + '</span></li>';
    }).join('');
    modal(p ? (p.id === store.me ? 'Your badges' : p.name + '\'s badges') : 'Badges', '<p class="lede">' + (p ? list.length + ' of ' + X.BADGES.length + ' earned. ' : '') + 'Badges come from what happens on the board and in your scores. They don\'t change the rules.</p><ul class="bg-list">' + rows + '</ul>');
  }

  // ---- share a moment ----------------------------------------------------------------------------
  function shareSpec(ev) {
    var s = st(), t = theme(), p = s.players[ev.pid] || {}, sp = ev.space ? s.board.spaces[ev.space] : null, kind = sp && sp.kind && t.kinds[sp.kind];
    var o = { theme: t, player: { name: p.name || '', avatar: p.avatar || '', color: R.playerColor(s, ev.pid) }, foot: 'Day ' + ev.day + (p.route ? ' \u00b7 ' + s.board.routeInfo[p.route].name : ''), badges: (X.badgesFor(s)[ev.pid] || []).map(function (b) { return b.icon; }) };
    var pr = ev.proof || {};
    if (ev.t === 'cleared') {
      var gr = X.grade(pr.acc); o.kicker = pr.firstAcc != null ? 'New personal best' : 'Map cleared'; o.headline = pr.acc ? (pr.acc * 100).toFixed(2) + '%' : 'Cleared'; o.grade = gr ? gr.g : null;
      return S.map((ev.bsr || [])[0]).then(function (m) { o.sub = m.name + (pr.diff ? ' \u00b7 ' + pr.diff.replace('ExpertPlus', 'Expert+') : ''); o.cover = m.cover; return o; }, function () { o.sub = '!bsr ' + (ev.bsr || [])[0]; return o; });
    }
    if (ev.t === 'escaped') { o.kicker = 'The ' + t.goal; o.headline = t.words.escaped; o.sub = ordinal(ev.place) + ' place on day ' + ev.day; }
    else if (ev.t === 'pass') { o.kicker = 'Overtake'; o.headline = 'Passed ' + (ev.over || []).map(function (q) { return s.players[q] ? s.players[q].name : ''; }).filter(Boolean).join(' & '); o.sub = E.remaining(s, p) + ' spaces to go'; }
    else if (ev.t === 'start') { o.kicker = 'Ouch'; o.headline = 'Back to the start'; o.sub = kind ? kind.title : ''; }
    else if (ev.t === 'warp') { var fwd = sp && sp.kind === 'swim'; o.kicker = fwd ? 'Lucky break' : 'Swept away'; o.headline = fwd ? 'Carried ahead' : 'Carried away'; o.sub = 'Now at ' + spaceName(s.board.spaces[ev.to]); }
    else if (ev.t === 'move') { o.kicker = ev.n > 0 ? 'Boost' : 'Setback'; o.headline = ev.n > 0 ? 'Jumped ahead ' + ev.n : 'Pushed back ' + (-ev.n); o.sub = kind ? kind.title : ''; }
    else if (ev.t === 'card') { var cd = E.cardById(s, ev.card); o.kicker = (t.card[cd && cd.cls] || 'Card') + ' card'; o.headline = cd ? cd.title : 'A card'; o.sub = cd ? C.cardEffectText(cd) : ''; if (cd && R.isImg(cd.art) && /^https:|^img\//.test(cd.art)) o.cover = cd.art; }
    return Promise.resolve(o);
  }
  function openShare(ev) {
    track('share-' + ev.t);
    modal('Share this moment', '<p class="lede">A picture of it for your clan Discord.</p><div id="shBox"><p class="why">Drawing the picture</p></div>', function (body) {
      shareSpec(ev).then(X.shareCard).then(function (blob) {
        var url = URL.createObjectURL(blob), name = theme().title.replace(/[^A-Za-z0-9]+/g, '-') + '-' + ev.t + '-day-' + ev.day + '.png';
        var file = window.File ? new File([blob], name, { type: 'image/png' }) : null;
        var canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
        var canCopy = !!(navigator.clipboard && window.ClipboardItem);
        body.querySelector('#shBox').innerHTML = '<img class="share-img" src="' + url + '" alt="Picture of this moment">' +
          '<div class="row" style="margin-top:12px">' + (canShare ? '<button type="button" class="btn" id="shShare">Share</button>' : '') + (canCopy ? '<button type="button" class="btn' + (canShare ? ' ghost' : '') + '" id="shCopy">Copy picture</button>' : '') +
          '<a class="btn ghost" href="' + url + '" download="' + esc(name) + '">Download</a></div><p class="why">Copy it, then paste it straight into a Discord message.</p>';
        var sc = body.querySelector('#shCopy'); if (sc) sc.onclick = function () { navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(function () { track('share-copied'); toast('Copied. Paste it into Discord.', 'good'); }, function () { toast('Your browser would not copy the picture. Use Download instead.', 'bad'); }); };
        var ss = body.querySelector('#shShare'); if (ss) ss.onclick = function () { navigator.share({ files: [file], title: theme().title }).then(function () { track('share-sent'); }, function () {}); };
      }, function (e) { body.querySelector('#shBox').innerHTML = '<p class="err">' + esc(e && e.message ? e.message : 'Could not draw the picture.') + '</p>'; });
    });
  }

  // ---- launch: the last ten seconds before the start ---------------------------------------------
  var launchFor = null;
  function startLaunch(at) {
    launchFor = at;
    var zone = document.querySelector('.board-zone'), box = $('launch'), n = $('launchN'), sub = $('launchSub'), b = st().board;
    var A = b.routes.longer || [], B = b.routes.riskier || [], ids = [], seen = {};
    for (var i = 0; i < Math.max(A.length, B.length); i++) [A[i], B[i]].forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } });
    zone.classList.add('prelaunch'); box.hidden = false; sub.textContent = 'The escape starts in';
    FX.lightUp(svgEl, ids, Math.max(800, at - Date.now() - 700));
    track('launch');
    var lastN = null, iv = setInterval(function () {
      var l = at - Date.now(), k = Math.ceil(l / 1000);
      if (k > 0 && k !== lastN) { lastN = k; n.textContent = k; n.className = 'launch-n'; void n.offsetWidth; n.classList.add('tick'); blip(420 + (10 - k) * 40, .12, 'triangle', .07); }
      if (l <= 0) {
        clearInterval(iv);
        n.textContent = 'GO!'; n.className = 'launch-n'; void n.offsetWidth; n.classList.add('go'); sub.textContent = 'Day 1 is open. Roll your d4!';
        sfx.win(); confettiBurst();
        setTimeout(function () { box.hidden = true; zone.classList.remove('prelaunch'); if (svgEl) FX.unlight(svgEl); }, 2300);
      }
    }, 100);
  }

  // ---- dusk: the board darkens in the last hour of a game day ------------------------------------
  var duskTest = (function () { var m = location.search.match(/[?&]dusk=(\d+)/); return m ? Number(m[1]) : null; })();
  function applyDusk() {
    var zone = document.querySelector('.board-zone'), d = $('dusk'), s = st(); if (!zone || !d || !s) return;
    var left = null;
    if (s.status === 'running') { if (store.mode === 'live') left = E.nextCutoff(s.settings) - Date.now(); else if (duskTest != null) left = duskTest * 60000; }
    if (left == null || left > 3600000 || left < 0) { d.hidden = true; zone.classList.remove('dusk-on', 'dusk-late'); zone.style.setProperty('--dusk', 0); return; }
    zone.style.setProperty('--dusk', (0.15 + 0.85 * Math.min(1, 1 - left / 3600000)).toFixed(3));
    d.hidden = false; zone.classList.add('dusk-on'); zone.classList.toggle('dusk-late', left < 600000);
    $('duskPill').textContent = '\uD83C\uDF19 Day ' + s.day + ' ends in ' + Math.max(1, Math.ceil(left / 60000)) + ' min';
  }

  // ---- easter eggs -----------------------------------------------------------------------------------
  var eggTaps = 0, eggAt = 0, eggSeen = {};
  var EGG_EXTRA = { grave: '\uD83D\uDC7B', tree: '\uD83E\uDD87', turkey: '\uD83E\uDEB6', scarecrow: '\uD83D\uDC26', snowman: '\u2744\uFE0F', present: '\uD83C\uDF81', pumpkin: '\uD83C\uDF83' };
  // The hero answers three quick taps with a line. Keep poking and it gets dizzy, hides for a bit,
  // and eventually gives up its secret. Some lines are about your game right now.
  var heroCombo = 0, heroLast = 0, heroDeck = [], heroHiding = false;
  function heroLine() {
    var s = st(), t = theme(), ctx = X.eggContext(s, store.me, t);
    if (!heroDeck.length) {   // a shuffled deck so lines don't repeat until you've heard them all
      var n = (t.hero === 'taco' ? 20 : 20), idx = []; for (var i = 0; i < n; i++) idx.push(i);
      for (var j = idx.length - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)), x = idx[j]; idx[j] = idx[k]; idx[k] = x; }
      heroDeck = idx;
    }
    if (ctx.length && Math.random() < .35) return ctx[Math.floor(Math.random() * ctx.length)];
    return X.eggLine('hero', t, heroDeck.pop());
  }
  function eggAnim(el, cls, ms) { ['egg-go', 'egg-spin', 'egg-hide'].forEach(function (c) { el.classList.remove(c); }); void el.getBBox(); el.classList.add(cls); setTimeout(function () { el.classList.remove(cls); }, ms); }
  function doEgg(el) {
    var kind = el.getAttribute('data-egg'), t = Date.now();
    if (kind === 'hero' && heroHiding) return;
    // once the hero is talking, single taps keep the conversation going for a while
    var warm = kind === 'hero' && heroCombo && t - heroLast < 20000;
    eggTaps = t - eggAt < 1400 && eggTaps ? eggTaps + 1 : 1; eggAt = t;
    if (!warm && eggTaps < (kind === 'hero' ? 3 : 1)) return;
    eggTaps = 0; eggSeen[kind] = (eggSeen[kind] || 0) + 1;
    var bb = el.getBBox(), xy = { x: bb.x + bb.width / 2, y: bb.y + bb.height * .3 };
    track('egg-' + kind);
    if (kind !== 'hero') {
      eggAnim(el, 'egg-go', 1100);
      FX.pop(svgEl, xy, X.eggLine(kind, theme(), eggSeen[kind] - 1), 'egg');
      if (EGG_EXTRA[kind]) setTimeout(function () { FX.pop(svgEl, { x: xy.x + 26, y: xy.y - 20 }, EGG_EXTRA[kind], ''); }, 250);
      blip(520, .12, 'sine', .06, 260);
      return;
    }
    heroCombo = t - heroLast < 20000 ? heroCombo + 1 : 1; heroLast = t;
    var line, cls = 'egg-go', ms = 1100, hold = 2600;
    if (heroCombo === 4) line = 'Okay, okay. I am awake.';
    else if (heroCombo === 5) { line = X.DIZZY[Math.floor(Math.random() * X.DIZZY.length)]; cls = 'egg-spin'; ms = 1300; }
    else if (heroCombo === 7) {
      line = 'BRB. Hiding from you.'; cls = 'egg-hide'; ms = 6200; heroHiding = true;
      FX.puff(svgEl, xy);
      setTimeout(function () { heroHiding = false; FX.pop(svgEl, xy, 'I am back. Did you miss me?', 'egg', 2600); blip(660, .1, 'sine', .05, 990); }, 6000);
    } else if (heroCombo === 10) {
      line = 'You found the secret. Tell no one.'; FX.burst(svgEl, xy, '#ffd34d'); setTimeout(function () { FX.burst(svgEl, xy, '#7fd14f'); }, 250);
      heroCombo = 0; track('egg-secret');
    } else if (Math.random() < .03) {   // rare: a legendary line with sparkles
      line = X.LEGEND[Math.floor(Math.random() * X.LEGEND.length)]; FX.burst(svgEl, xy, '#ffd34d'); track('egg-legend');
    } else line = heroLine();
    eggAnim(el, cls, ms);
    FX.pop(svgEl, xy, line, 'egg', hold);
    blip(880, .12, 'sine', .06, 1320);
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
    // Fit the part of the page the player can see. When someone has pinch-zoomed on a phone that is
    // only a slice of the layout, so size and place it against the visual viewport, not the window.
    function place() {
      var v = window.visualViewport, de = document.documentElement;
      var L = v ? v.offsetLeft : 0, T = v ? v.offsetTop : 0, VW = v ? v.width : de.clientWidth, VH = v ? v.height : window.innerHeight;
      pop.style.width = Math.min(320, VW - 16) + 'px';
      var r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      var x = Math.max(L + 8, Math.min(L + VW - pw - 8, r.left + r.width / 2 - pw / 2));
      var y = r.bottom + 10; if (y + ph > T + VH - 8) y = r.top - ph - 10;
      y = Math.max(T + 8, Math.min(y, T + VH - ph - 8));
      pop.style.left = x + 'px'; pop.style.top = y + 'px';
    }
    place();
    (sp.bsr || []).forEach(function (key) {
      S.map(key).then(function (m) {
        var line = pop.querySelector('.mapline[data-key="' + key + '"]'); if (!line) return;
        line.querySelector('img').src = m.cover;
        line.querySelector('[data-n]').textContent = m.name;
        line.querySelector('[data-m]').textContent = [m.author, m.mapper ? 'mapped by ' + m.mapper : ''].filter(Boolean).join(', ');
        if (!pop.hidden) place();
      }, function () { var line = pop.querySelector('.mapline[data-key="' + key + '"] [data-m]'); if (line) line.textContent = "Couldn't load map details"; });
    });
    pop.querySelector('[data-close]').focus();
  }
  function closeSpace() { $('spacePop').hidden = true; }

  // ---- modals --------------------------------------------------------------------------------
  var lastFocus = null;
  function modal(title, body, onOpen, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    $('modalTitle').textContent = title; $('modalBody').innerHTML = body; $('modal').hidden = false;
    $('modal').querySelector('.modal').className = 'modal' + (opts.cls ? ' ' + opts.cls : '');
    $('modalBody').scrollTop = 0; $('modal').querySelector('.modal').scrollTop = 0;
    if (onOpen) onOpen($('modalBody'));
    var f = opts.focusClose ? null : $('modalBody').querySelector('input,button,select,a'); (f || $('modalX')).focus();
  }
  function closeModal() { $('modal').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); if (store && store.state) setTimeout(checkNewClears, 300); }

  // ---- the end of the game ------------------------------------------------------------------
  function openFinale() {
    var s = st(), t = theme(), fin = s.final || E.ranking(s);
    track('finale');
    try { localStorage.setItem('cg.finale.' + s.id, '1'); } catch (e) {}
    var line = function (r) { return r.escaped ? 'Escaped day ' + r.day : r.left + ' to go'; };
    var podium = [fin[1], fin[0], fin[2]].map(function (r, i) {
      if (!r) return '<div class="pod empty"></div>';
      var p = s.players[r.pid], rank = [2, 1, 3][i];
      var bd = (X.badgesFor(s)[r.pid] || []).map(function (b) { return b.icon; }).join('');
      return '<div class="pod pod' + rank + '" style="--c:' + R.playerColor(s, r.pid) + '">' + avatarHtml(p, 'pod-ava') + '<b>' + esc(p.name) + '</b><span>' + esc(line(r)) + '</span><span class="pod-badges" data-badges="' + esc(r.pid) + '">' + bd + '</span><div class="pod-step">' + ordinal(r.place) + '</div></div>';
    }).join('');
    var rest = fin.slice(3).map(function (r) { var p = s.players[r.pid]; return '<li' + (r.pid === store.me ? ' class="me"' : '') + '><span class="place">' + ordinal(r.place) + '</span>' + esc(p.name) + '<span class="why">' + esc(line(r)) + '</span></li>'; }).join('');
    var mine = fin.filter(function (r) { return r.pid === store.me; })[0];
    var winner = fin[0] && s.players[fin[0].pid];
    modal('Game over', '<div class="finale"><p class="lede">' + (winner ? esc(winner.name) + (fin[0].escaped ? ' reached the ' + esc(t.goal) + ' first.' : ' got closest to the ' + esc(t.goal) + '.') : 'The final standings are in.') + '</p>' +
      '<div class="podium">' + podium + '</div>' + (rest ? '<ol class="finale-rest">' + rest + '</ol>' : '') +
      (mine ? '<p class="finale-me">You finished <b>' + ordinal(mine.place) + '</b>' + (mine.escaped ? ', escaping on day ' + mine.day : ', ' + mine.left + ' spaces out') + '.</p>' : '') +
      '<div class="row"><button type="button" class="btn" data-finale-close>Back to the board</button><button type="button" class="btn ghost" data-hall>\uD83C\uDFC6 Hall of fame</button></div></div>',
      function (body) {
        body.querySelector('[data-finale-close]').onclick = closeModal;
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
  function agoShort(ms) { var m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; }
  function agoText(ms) {
    var h = Math.round(ms / 3600000), d = Math.floor(ms / 86400000);
    return d >= 1 ? d + (d === 1 ? ' day' : ' days') : h >= 1 ? h + (h === 1 ? ' hour' : ' hours') : 'a little while';
  }
  function maybeAway(prev0) {
    var s = st(), prev = prev0 !== undefined ? prev0 : readSeen();
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
        else if (e.t === 'pass') mine.push('⚡ You passed ' + (e.over || []).map(function (q) { return s.players[q] ? '<b>' + esc(s.players[q].name) + '</b>' : ''; }).filter(Boolean).join(' and '));
        return;
      }
      if (e.t === 'pass' && (e.over || []).indexOf(store.me) >= 0) { mine.push('⚡ <b>' + who(e) + '</b> passed you'); return; }
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
    var moved = evs.filter(function (e) { return e.t === 'roll' && e.pid !== store.me && s.players[e.pid]; });
    track('away-summary');
    modal('While you were away', '<p class="lede">You were gone ' + agoText(Date.now() - prev.at) + '.' + days + '</p><ul class="away">' + lines.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>' +
      (more ? '<p class="why">' + more + ' more in the game thread.</p>' : '') + (next ? '<p class="away-next">' + next + '</p>' : '') +
      '<div class="row">' + (moved.length ? '<button type="button" class="btn" data-away-watch>\u25B6 Watch what happened</button>' : '') + '<button type="button" class="btn' + (moved.length ? ' ghost' : '') + '" data-away-close>Back to the game</button></div>', function (body) {
        body.querySelector('[data-away-close]').onclick = closeModal;
        var w = body.querySelector('[data-away-watch]');
        if (w) w.onclick = function () { closeModal(); track('away-replay'); $('boardWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); replayEvents(evs.slice(-160), 'While you were away', "You're all caught up."); };
      });
    return true;
  }

  function openHow() {
    var t = theme(), s = st(), b = s.board, ri = b.routeInfo, cardWord = t.words.card.join(' ').toLowerCase();
    track('how-to-play');
    var step = function (icon, h, p) { return '<li class="hw-step"><span class="hw-ic" aria-hidden="true">' + icon + '</span><b>' + h + '</b><span>' + p + '</span></li>'; };
    var loop = '<ol class="hw-loop">' +
      step(R.dieIcon(), 'Roll the d4', 'Once a day. Move that many spaces.') +
      step(HOW_MAP, 'Play the map', 'Any difficulty, any modifiers.') +
      step(HOW_CHECK, 'Get cleared', 'BeatLeader is checked for you.') +
      step(HOW_AGAIN, 'Roll again', 'Unlocks once your map clears.') + '</ol>';
    var routes = '<div class="hw-routes">' + ['longer', 'riskier'].map(function (r) {
      return '<div class="hw-route' + (r === 'riskier' ? ' risk' : '') + '"><span class="hw-tag">' + (r === 'riskier' ? 'Shorter, harder' : 'Safer, longer') + '</span><b>' + esc(ri[r].name) + '</b><p>' + esc(routeBlurb(r)) + '</p><span class="hw-stats">' + esc(routeCounts(b, r)) + '</span></div>';
    }).join('') + '</div>';
    // One example of every kind of space on this board, cut from the board itself.
    var kinds = [
      ['map', function (sp) { return sp.type === 'map'; }, 'Map space', 'Play its map. Some offer two.'],
      ['card', function (sp) { return sp.type === 'card'; }, cap(cardWord), 'Draw a card. Good, bad or a bonus map.'],
      ['task', function (sp) { return sp.type === 'task'; }, 'Blocker', 'Play its map to get past.'],
      ['up', function (sp) { return sp.type === 'move' && sp.n > 0; }, 'Boost', 'Jump ahead.'],
      ['shortcut', function (sp) { return sp.type === 'warp' && sp.kind === 'swim'; }, 'Shortcut', 'Carried ahead.'],
      ['safe', function (sp) { return sp.type === 'safe'; }, 'Safe', 'A rest. No map.'],
      ['down', function (sp) { return sp.type === 'move' && sp.n < 0; }, 'Setback', 'Sent back.'],
      ['warp', function (sp) { return sp.type === 'warp' && sp.kind !== 'swim'; }, 'Swept away', 'Carried off course.'],
      ['skip', function (sp) { return sp.type === 'skip'; }, 'Lose a turn', 'Sit out a roll.'],
      ['start', function (sp) { return sp.type === 'start'; }, 'Back to start', 'All the way back.'],
      ['exit', function (sp) { return sp.type === 'exit'; }, cap(t.goal), 'First one here wins.']
    ];
    var order = (b.routes.longer || []).concat(b.routes.riskier || []), legend = '';
    kinds.forEach(function (k) {
      var id = order.filter(function (q) { return b.spaces[q] && k[1](b.spaces[q]); })[0]; if (!id) return;
      var sp = b.spaces[id];
      legend += '<li class="hw-sp">' + howTile(sp) + '<span><b>' + esc(k[2]) + '</b><span>' + esc(k[3]) + '</span></span></li>';
    });
    var tip = function (icon, html) { return '<li><span class="hw-ti" aria-hidden="true">' + icon + '</span><span>' + html + '</span></li>'; };
    var tips = '<ul class="hw-tips">' +
      tip('🎵', 'Every roll ends with a map. Stop on a space without one and you get a bonus map. Safe is the only break.') +
      tip('🔗', 'Moved onto a map by a card or event? Play it. Cards never chain into more cards.') +
      tip('🏁', 'First to the ' + esc(t.goal) + ' wins. Everyone else plays on for their place.') +
      (s.settings.oneFinishPerDay !== false ? tip('🚪', 'The podium escapes one a day: if someone got out today, you wait at the gate until your next roll. Once the top 3 are out, anyone can escape any day.') : '') +
      (s.endsAt && s.status !== 'finished' ? tip('⏳', 'The game ends <b>' + esc(startWhen(s.endsAt)) + '</b>. Not out by then? You\'re placed by how close you got, fewest spaces left first. Players tied on spaces share a place.') : '') + '</ul>';
    var extras = '<ul class="hw-tips">' +
      tip('<span class="hw-rx">' + RX_ICON + '</span>', 'Tap the smiley in the game thread to react to other players. Press and hold a reaction to see who sent it.') +
      tip('<span class="hw-dot"></span>', 'A green dot means that player has the game open.') +
      tip('▶️', 'Coming back? Watch the moves you missed.') +
      (store.mode === 'live' && E.remindHour(s) != null ? tip('🔔', 'Tap the bell for a reminder when you haven\'t rolled.') : '') +
      tip('👀', 'Some things on the board tap back.') + '</ul>';
    modal('How to play',
      '<div class="hw-hero"><svg viewBox="-31 -36 62 64" aria-hidden="true"><g class="a-bob">' + R.hero(0, 0, 1, t) + '</g></svg><p>' + esc(t.tagline) + '</p></div>' +
      '<h3 class="hw-h">Every day</h3>' + loop +
      '<h3 class="hw-h">Pick a route <span>once, no switching</span></h3>' + routes +
      (legend ? '<h3 class="hw-h">What the spaces do</h3><ul class="hw-legend">' + legend + '</ul>' : '') +
      '<h3 class="hw-h">Good to know</h3>' + tips +
      '<h3 class="hw-h">Around the board</h3>' + extras +
      '<div class="hw-help"><b>Played it but it didn\'t count?</b> Use "I played it" and the host can approve it.</div>' +
      '<label class="check sound-opt"><input type="checkbox" id="soundChk"' + (muted ? '' : ' checked') + '> <span>Sound effects</span></label>',
      null, { cls: 'how', focusClose: true });
  }
  function cap(w) { w = String(w || ''); return w.charAt(0).toUpperCase() + w.slice(1); }
  // A small window onto the board around one space, so the legend shows the real thing.
  function howTile(sp) {
    if (!svgEl) return '<span class="hw-tile"></span>';
    var c = svgEl.cloneNode(true);
    ['.tokens', '.hl', '.fxl', '.atmo', '.prev'].forEach(function (q) { Array.prototype.forEach.call(c.querySelectorAll(q), function (n) { n.remove(); }); });
    Array.prototype.forEach.call(c.querySelectorAll('.sp'), function (n) { n.classList.remove('sel', 'lit', 'mine'); n.setAttribute('tabindex', '-1'); n.removeAttribute('role'); });
    c.setAttribute('viewBox', (sp.x - 37) + ' ' + (sp.y - 37) + ' 74 74');
    c.setAttribute('class', 'hw-tile'); c.setAttribute('aria-hidden', 'true'); c.removeAttribute('role'); c.removeAttribute('aria-label');
    return c.outerHTML;
  }
  var HOW_MAP = '<svg viewBox="0 0 40 40"><g transform="rotate(-12 13 22)"><rect x="3" y="12" width="20" height="20" rx="4" fill="#e3263b" stroke="#050507" stroke-width="1.5"/><path d="M7.5 15.5h11l-5.5 5z" fill="#fff"/></g><g transform="rotate(10 27 18)"><rect x="17" y="6" width="20" height="20" rx="4" fill="#2a78f2" stroke="#050507" stroke-width="1.5"/><path d="M21.5 9.5h11l-5.5 5z" fill="#fff"/></g></svg>';
  var HOW_CHECK = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="var(--good)"/><path d="M12 20.5l5.5 5.5L28.5 14" fill="none" stroke="#06200a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var HOW_AGAIN = '<svg viewBox="0 0 40 40"><path d="M31 15a12 12 0 1 0 1.5 9" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/><path d="M33 6v10H23" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
      '<div class="row"><button type="button" class="btn" id="plGo">Download playlist</button>' +
      '<a class="btn ghost studio-btn kick" id="plStudio" target="_blank" rel="noopener" href="' + STUDIO_HOME + '" aria-disabled="true" title="Open these maps in Playlist Studio">' + STUDIO_LOGO + '<span>Playlist <b>Studio</b></span></a></div>' +
      '<p class="why">In Studio you can drop songs you\'ve already played, pick a difficulty for each song or rename it. On Quest? <a href="' + STUDIO_SYNC + '" target="_blank" rel="noopener">Studio Sync</a> sends it straight to your headset.</p>' +
      '<p class="err" id="plErr" hidden></p>', function (body) {
      var st0 = body.querySelector('#plStudio');
      st0.addEventListener('click', function (e) { if (st0.getAttribute('aria-disabled') === 'true') { e.preventDefault(); toast('Getting the maps ready. Try again in a second.', ''); return; } track('get-maps-studio'); });
      S.maps(keys).then(function (found) {
        var rows = keys.map(function (k) { var m = found[k]; return m && m.hash ? [m.hash, '', 'Standard'] : null; }).filter(Boolean);
        if (!rows.length) return;
        st0.href = studioPlaylistLink(theme().title, rows); st0.removeAttribute('aria-disabled');
      });
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
  // ---- host tools ------------------------------------------------------------------------------
  // Stats: its own full page (hosts only), from the Admin card's Stats button, Host tools, or a #stats link.
  function statsOpen() { var p = $('statsPage'); return !!p && !p.hidden; }
  function renderStats() { var b = $('statsBody'); if (!b) return; b.innerHTML = statsHtml(st()); fillStats(); }
  function openStats() {
    if (!store.isHost) return;
    if (!$('hostDrawer').hidden) closeHost();
    $('statsPage').hidden = false; document.body.classList.add('stats-on'); statsAt = 0; renderStats(); $('statsPage').scrollTop = 0; $('statsBack').focus(); track('stats-open');
  }
  function closeStats() { $('statsPage').hidden = true; document.body.classList.remove('stats-on'); var b = $('meStats') || $('hostBtn'); if (b && !b.hidden) b.focus(); }
  function openHost(tab) { if (typeof tab === 'string') hostTab = tab; else if (hostTodo().total) hostTab = 'today'; $('hostDrawer').hidden = false; $('scrim').hidden = false; visitsAt = 0; renderHost(); $('hostX').focus(); }
  // ---- visit log (host only) ----
  var visitsData = null, visitsAt = 0, visitsAll = false, visitsBusy = false;
  function fillVisits(force) {
    var box = $('visitBox'); if (!box) return;
    if (visitsData && !force && Date.now() - visitsAt < 30000) { drawVisits(box); return; }
    if (visitsData) drawVisits(box);
    if (visitsBusy || !store.visits) return;
    visitsBusy = true;
    store.visits().then(function (r) { visitsBusy = false; if (r && r.visits) { visitsData = r; visitsAt = Date.now(); } var b = $('visitBox'); if (b) drawVisits(b); }, function () { visitsBusy = false; var b = $('visitBox'); if (b && !visitsData) b.innerHTML = '<p class="why">Couldn\'t load the visits right now.</p>'; });
  }
  // How long ago a visit ended: just now, minutes, then hours up to a day, days, months and years.
  // (Named apart from agoText, which the "while you were away" note uses for a plain length of time.)
  function visitAgo(t) {
    var m = Math.floor((Date.now() - t) / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    var n = function (k, unit) { return k + ' ' + unit + (k === 1 ? '' : 's') + ' ago'; };
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (h < 24) return n(h, 'hour');
    if (d < 30) return n(d, 'day');
    if (d < 365) return n(Math.floor(d / 30), 'month');
    return n(Math.floor(d / 365), 'year');
  }
  function drawVisits(box) {
    var list = (visitsData && visitsData.visits) || [], s = st();
    if (!list.length) { box.innerHTML = '<p class="why">No visits yet.</p>'; return; }
    var clock = function (t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    var dayOf = function (t) { var d = new Date(t), today = new Date(), y = new Date(Date.now() - 86400000); if (d.toDateString() === today.toDateString()) return 'Today'; if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
    var dur = function (ms) { var m = Math.round(ms / 60000); if (m < 1) return 'under a minute'; if (m < 60) return m + ' min'; return Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
    var who = function (v) { return (s && (s.players['d' + v.id] || s.players[v.id])) || null; };
    var ava = function (v) { var p = who(v) || (v.avatar ? { id: 'd' + v.id, name: v.name || '?', avatar: v.avatar } : null); var pl = who(v), img = p ? avatarHtml(p, 'vis-ava') : '<span class="vis-ava guest">' + esc(R.initials(v.name || '?')) + '</span>';
      if (pl && pl.blId) return '<a class="vis-bl" href="https://beatleader.com/u/' + encodeURIComponent(pl.blId) + '" target="_blank" rel="noopener" title="' + esc(pl.name) + ' on BeatLeader" aria-label="Open ' + esc(pl.name) + ' on BeatLeader">' + img + '</a>';
      return img; };
    var nameOf = function (v) { return '<span class="vis-name"><b>' + esc(v.name) + '</b>' + (v.player ? '' : '<span class="vis-tag">not playing</span>') + '</span>'; };
    var plural = function (k, w) { return '<b>' + k + '</b> ' + w + (k === 1 ? '' : 's'); };
    var live = list.filter(function (v) { return v.open; }), past = list.filter(function (v) { return !v.open; });
    var people = {}; list.forEach(function (v) { people[v.id] = 1; });
    var html = '<div class="vis-stats">' + (live.length ? '<span class="vis-stat on"><span class="vis-dot" aria-hidden="true"></span><b>' + live.length + '</b> on now</span>' : '') +
      '<span class="vis-stat">' + plural(list.length, 'visit') + '</span><span class="vis-stat">' + plural(Object.keys(people).length, 'person').replace('persons', 'people') + '</span><span class="vis-stat soft">last 2 weeks</span></div>';
    if (live.length) html += '<div class="vis-live">' + live.map(function (v) {
      return '<div class="vis-row live">' + ava(v) + '<div class="vis-main">' + nameOf(v) + '<span class="vis-sub">On since ' + clock(v.start) + ' · ' + dur(Date.now() - v.start) + '</span></div><span class="vis-now"><span class="vis-dot" aria-hidden="true"></span>On now</span></div>';
    }).join('') + '</div>';
    var shown = visitsAll ? past : past.slice(0, 30), count = {};
    shown.forEach(function (v) { var d = dayOf(v.start); count[d] = (count[d] || 0) + 1; });
    var lastDay = '';
    if (shown.length) {
      html += '<ol class="visit-list">';
      shown.forEach(function (v) {
        var day = dayOf(v.start); if (day !== lastDay) { html += '<li class="visit-day"><span>' + esc(day) + '</span><span class="vd-n">' + count[day] + (count[day] === 1 ? ' visit' : ' visits') + '</span></li>'; lastDay = day; }
        var endT = v.end || v.last;
        html += '<li class="vis-row">' + ava(v) + '<div class="vis-main">' + nameOf(v) + '<span class="vis-sub">' + clock(v.start) + ' – ' + clock(endT) + ' · ' + dur(endT - v.start) + '</span></div><span class="vis-ago" data-ago="' + endT + '">' + visitAgo(endT) + '</span></li>';
      });
      html += '</ol>';
    }
    if (past.length > shown.length) html += '<button type="button" class="btn small ghost" data-h="visits-more">Show all ' + past.length + '</button>';
    box.innerHTML = html;
  }
  // ---- Stats tab (host only): how the game is going, from the game itself, plus the server's daily
  // tally, notifications, people who signed in but never joined, and GoatCounter visitors ----
  var statsData = null, statsAt = 0, statsBusy = false, statsMore = {};
  function fillStats(force) {
    var box = $('statsLive'); if (!box) return;
    if (statsData) drawStatsLive();
    if ((statsData && !force && Date.now() - statsAt < 60000) || statsBusy || !store.hostStats) return;
    statsBusy = true;
    store.hostStats(force).then(function (r) { statsBusy = false; if (r && !r.error) { statsData = r; statsAt = Date.now(); } if (statsOpen()) renderStats(); }, function () { statsBusy = false; var b = $('statsLive'); if (b && !statsData) b.innerHTML = '<p class="why">Couldn\'t load the stats right now.</p>'; });
  }
  function sBar(lab, n, max, cls, right) {
    return '<div class="gsb"><span class="gsl">' + lab + '</span><span class="gst"><em class="' + (cls || '') + '" style="width:' + (max ? Math.max(2, Math.round(n / max * 100)) : 0) + '%"></em></span><span class="gsn">' + (right != null ? right : n) + '</span></div>';
  }
  function sCard(k, v, sub, cls) { return '<div class="sc' + (cls ? ' ' + cls : '') + '"><span class="sk">' + k + '</span><b>' + v + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; }
  function sMore(key, n, shown) { return n > shown ? '<button type="button" class="btn small ghost" data-h="stats-more" data-k="' + key + '">Show all ' + n + '</button>' : ''; }
  function blWrap(p, inner) { return p && p.blId ? '<a class="srow" href="https://beatleader.com/u/' + encodeURIComponent(p.blId) + '" target="_blank" rel="noopener" title="' + esc(p.name) + ' on BeatLeader">' + inner + '</a>' : '<div class="srow">' + inner + '</div>'; }
  // Everything the game state alone can tell.
  function statsFromState(s) {
    var T = (s.tally && s.tally.p) || {}, ev = s.events, o = { clears: 0, rolls: 0, accSum: 0, accN: 0, per: {}, maps: {} };
    Object.keys(T).forEach(function (pid) { var t = T[pid], q = o.per[pid] = o.per[pid] || { n: 0, aS: 0, aN: 0 }; o.clears += t.clears; o.rolls += t.rolls; o.accSum += t.accSum; o.accN += t.accN; q.n += t.clears; q.aS += t.accSum; q.aN += t.accN; });
    ev.forEach(function (e) {
      if (e.t === 'roll') o.rolls++;
      if (e.t !== 'cleared') return;
      var q = o.per[e.pid] = o.per[e.pid] || { n: 0, aS: 0, aN: 0 }; o.clears++; q.n++;
      if (e.proof && e.proof.acc) {
        o.accSum += e.proof.acc; o.accN++; q.aS += e.proof.acc; q.aN++;
        var k = (e.bsr || [])[0]; if (k) { var m = o.maps[k] = o.maps[k] || { n: 0, sum: 0, best: 0 }; m.n++; m.sum += e.proof.acc; m.best = Math.max(m.best, e.proof.acc); }
      }
    });
    return o;
  }
  function statsHtml(s) {
    var signup = s.status === 'signup', over = s.status === 'finished', day = s.day, o = statsFromState(s);
    var ids = s.order, racing = ids.filter(function (pid) { return s.players[pid].route && !s.players[pid].finished; });
    var rank = E.ranking(s), left = {}; rank.forEach(function (r) { left[r.pid] = r; });
    var html = '<section class="hsec"><div class="thread-head"><h3>' + esc(s.title) + (signup ? ', sign-ups' : over ? ', final' : ', day ' + day) + '</h3><button type="button" class="icon-btn refresh-btn" data-h="stats-refresh" aria-label="Refresh" title="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/></svg></button></div><div class="sgrid">';
    var d = statsData, on = d && d.notify ? d.notify.on.length : null, lurk = d ? d.lurkers.length : null;
    var claims = ids.reduce(function (a, pid) { return a + s.players[pid].claims.length; }, 0), onMap = ids.reduce(function (a, pid) { return a + s.players[pid].tasks.length; }, 0);
    // The same cards at every stage, so the layout never changes; before the start they say what's coming.
    var routed = ids.filter(function (pid) { return s.players[pid].route; }).length;
    var rolledToday = racing.filter(function (pid) { return s.players[pid].rolledDay === day; }).length, clearsToday = signup ? 0 : ev(s, day);
    var escaped = ids.filter(function (pid) { return s.players[pid].finished; }).length, spots = Math.max(0, 3 - escaped);
    html += sCard('Players', ids.length, signup ? routed + ' picked a route' : over ? 'Game over' : racing.length + ' still racing', 'hero') +
      (signup ? sCard('Starts', s.startsAt ? '<span data-countdown="' + s.startsAt + '">' + fmtLeft(s.startsAt - Date.now()) + '</span>' : '-', s.startsAt ? esc(startWhen(s.startsAt)) : 'No start time yet')
        : over ? sCard('Rolls', o.rolls, 'over ' + day + ' days') : sCard('Rolled today', rolledToday + '<small> / ' + racing.length + '</small>', racing.length ? Math.round(rolledToday / racing.length * 100) + '% of racers' : '')) +
      sCard('Maps cleared', o.clears, signup ? 'Counts from the first roll' : over ? o.rolls + ' rolls' : clearsToday + ' today') +
      sCard('Average accuracy', o.accN ? (o.accSum / o.accN * 100).toFixed(2) + '%' : '-', o.accN ? 'across ' + o.accN + ' clears' : 'No clears yet') +
      sCard('Made it out', escaped, spots ? spots + ' podium spot' + (spots === 1 ? '' : 's') + (escaped ? ' left' : ' open') : 'Podium is full', 'gold') +
      sCard('On a map', onMap, signup ? 'Maps come with the first rolls' : claims ? claims + ' run' + (claims === 1 ? '' : 's') + ' for you to approve' : 'Nothing to approve');
    html += sCard('Notifications on', on == null ? '…' : on + '<small> / ' + ids.length + '</small>', on == null ? '' : d.notify.devices + ' device' + (d.notify.devices === 1 ? '' : 's') + ' signed up') +
      sCard('Signed in, not in', lurk == null ? '…' : lurk, lurk == null ? '' : 'Never joined the game');
    html += '</div></section>';
    // Days and hours from the server's tally.
    html += '<div id="statsLive">' + (statsData ? '' : '<p class="why">Loading</p>') + '</div>';
    {
      // Slipping: still racing, no roll in two or more days.
      var slip = racing.filter(function (pid) { return !over && (s.players[pid].rolledDay || 0) <= day - 2; }).map(function (pid) { return { p: s.players[pid], idle: day - (s.players[pid].rolledDay || 0), never: !s.players[pid].rolledDay }; }).sort(function (a, b) { return b.idle - a.idle; });
      if (!over) slip = ids.filter(function (pid) { return !s.players[pid].route; }).map(function (pid) { return { p: s.players[pid], noroute: true }; }).concat(slip);
      if (!over) html += '<section class="hsec"><h3>Might be slipping <small>no route, or no roll in 2+ days. Tap one for BeatLeader</small></h3><div class="sbox slist">' + (slip.length ? slip.slice(0, statsMore.slip ? 999 : 6).map(function (x) {
        var r = left[x.p.id];
        if (x.noroute) return blWrap(x.p, avatarHtml(x.p, 'vis-ava') + '<span class="sn2"><b>' + esc(x.p.name) + '</b><em>Signed up but hasn\'t picked a route, so can\'t roll</em></span><span class="sidle">No route</span>');
        return blWrap(x.p, avatarHtml(x.p, 'vis-ava') + '<span class="sn2"><b>' + esc(x.p.name) + '</b><em>' + (r ? r.left + ' to go · ' : '') + esc(s.board.routeInfo[x.p.route].name) + '</em></span><span class="sidle">' + (x.never ? 'Never rolled' : x.idle + ' days') + '</span>');
      }).join('') + (statsMore.slip ? '' : sMore('slip', slip.length, 6)) : '<p class="why">' + (signup ? 'Everyone has picked a route. Players who stop rolling show up here once the game starts.' : 'Everyone still racing rolled today or yesterday.') + '</p>') + '</div></section>';
      // Funnel
      var steps = [['Signed up', ids.length], ['Picked a route', ids.filter(function (pid) { return s.players[pid].route; }).length], ['Rolled at least once', ids.filter(function (pid) { return s.players[pid].rolls > 0 || (s.tally && s.tally.p && s.tally.p[pid] && s.tally.p[pid].rolls); }).length], ['Cleared a map', ids.filter(function (pid) { return o.per[pid] && o.per[pid].n; }).length], ['Made it out', ids.filter(function (pid) { return s.players[pid].finished; }).length]];
      html += '<section class="hsec"><h3>From sign-up to the ' + esc(theme().goal || 'exit') + '</h3><div class="sbox">' + steps.map(function (x, i) { return sBar(x[0], x[1], steps[0][1], i === steps.length - 1 ? 'g' : '', '<b>' + x[1] + '</b> <small>' + (steps[0][1] ? Math.round(x[1] / steps[0][1] * 100) : 0) + '%</small>'); }).join('') + '</div></section>';
    }
    // Routes
    var rk = Object.keys(s.board.routes);
    if (rk.length) html += '<section class="hsec"><h3>Routes</h3><div class="rgrid">' + rk.map(function (k, i) {
      var ps = ids.filter(function (pid) { return s.players[pid].route === k; }), live = ps.filter(function (pid) { return left[pid] && !left[pid].escaped; });
      var avg = live.length ? (live.reduce(function (a, pid) { return a + left[pid].left; }, 0) / live.length).toFixed(1) : null, out = ps.filter(function (pid) { return s.players[pid].finished; }).length;
      return sCard((i ? '🌊 ' : '🛤️ ') + esc(s.board.routeInfo[k].name), ps.length + '<small> player' + (ps.length === 1 ? '' : 's') + '</small>', signup ? (ps.length ? 'Picked so far' : 'Nobody yet') : out + ' out' + (avg ? ' · ' + avg + ' to go on average' : ''));
    }).join('') + '</div></section>';
    {
      var songName = function (k) { var f = songFor(k); return f && f.name ? f.name : '!bsr ' + k; };
      var mlist = Object.keys(o.maps).map(function (k) { var m = o.maps[k]; return { k: k, n: m.n, avg: m.sum / m.n, best: m.best }; });
      var hard = mlist.filter(function (m) { return m.n >= 3; }).sort(function (a, b) { return a.avg - b.avg; }).slice(0, 5);
      var most = mlist.slice().sort(function (a, b) { return b.n - a.n || b.best - a.best; }).slice(0, 5);
      var wait = function (msg) { return '<p class="why">' + msg + '</p>'; };
      html += '<section class="hsec"><h3>Hardest maps <small>lowest average accuracy, 3+ clears</small></h3><div class="sbox">' + (hard.length ? hard.map(function (m) { return sBar(esc(songName(m.k)), Math.max(0, m.avg - 0.8), 0.2, 'a', (m.avg * 100).toFixed(1) + '%'); }).join('') : wait(signup ? 'Shows once maps have been cleared. A map needs 3 clears to count.' : 'No map has 3 clears yet.')) + '</div></section>';
      html += '<section class="hsec"><h3>Most played maps</h3><div class="sbox">' + (most.length ? most.map(function (m) { return sBar(esc(songName(m.k)), m.n, most[0].n, '', '<b>' + m.n + '</b> <small>best ' + (m.best * 100).toFixed(1) + '%</small>'); }).join('') : wait(signup ? 'Shows once the game starts and maps get cleared.' : 'No clears yet.')) + '</div></section>';
      // Reactions
      var rc = {}, rtot = 0; Object.keys(s.reactions || {}).forEach(function (id) { var r = s.reactions[id]; Object.keys(r).forEach(function (k) { rc[k] = (rc[k] || 0) + r[k].length; rtot += r[k].length; }); });
      var rtop = Object.keys(rc).sort(function (a, b) { return rc[b] - rc[a]; }).slice(0, 6), th = theme();
      html += '<section class="hsec"><h3>Reactions <small>' + rtot + ' on moments still in the thread</small></h3><div class="sbox emo">' + (rtop.length ? rtop.map(function (k) { return '<span class="ech">' + X.rxIcon(k, th) + '<span>' + esc(X.rxLabel(k, th)) + '</span><b>' + rc[k] + '</b></span>'; }).join('') : wait('Nobody has reacted to a moment yet.')) + '</div></section>';
      // Everyone
      // Everyone, in standings order, then anyone without a route.
      var allRows = rank.concat(over ? [] : ids.filter(function (pid) { return !s.players[pid].route; }).map(function (pid) { return { pid: pid, noroute: true }; }));
      var rows = allRows.slice(0, statsMore.all ? 999 : 10);
      html += '<section class="hsec"><h3>Everyone <small>tap one for BeatLeader</small></h3><div class="sbox ptab"><div class="pth"><span>#</span><span>Player</span><span>Maps</span><span>Acc</span><span>Rolled</span></div>' + rows.map(function (r) {
        var p = s.players[r.pid], q = o.per[r.pid] || { n: 0, aN: 0 }, gap = day - (p.rolledDay || 0);
        var last = r.noroute ? 'No route' : signup ? 'Not yet' : r.escaped ? 'Out d' + r.day : !p.rolledDay ? 'Never' : gap === 0 ? 'Today' : gap + (gap === 1 ? ' day' : ' days');
        var inner = '<span>' + (r.noroute || signup ? '–' : r.escaped && r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : r.place) + '</span><span class="pnm">' + avatarHtml(p, 'vis-ava') + '<b>' + esc(p.name) + '</b></span><span>' + q.n + '</span><span>' + (q.aN ? (q.aS / q.aN * 100).toFixed(1) + '%' : '-') + '</span><span class="' + (r.noroute || (!signup && !r.escaped && !over && gap >= 2) ? 'cold' : '') + '">' + last + '</span>';
        return p.blId ? '<a class="ptr" href="https://beatleader.com/u/' + encodeURIComponent(p.blId) + '" target="_blank" rel="noopener">' + inner + '</a>' : '<div class="ptr">' + inner + '</div>';
      }).join('') + (allRows.length ? '' : wait('Nobody has signed up yet.')) + (statsMore.all ? '' : sMore('all', allRows.length, 10)) + '</div></section>';
    }
    html += '<div id="statsLive2"></div>';
    return html;
    function ev(s, d) { return s.events.filter(function (e) { return e.t === 'cleared' && e.day === d; }).length; }
  }
  // ---- GoatCounter in the Stats tab: plain names, a line on what each one means, and small icons ----
  // Site icons and flags come from the game server's /api/icon (cached there for a week).
  var GC_ICON = ((window.CGConfig && window.CGConfig.api) || '') + '/api/icon';
  var GC_GLYPH = {
    direct: '<path d="M4 12h11"/><path d="M11 7l5 5-5 5"/><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
    tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2.2"/><path d="M11 18h2"/>',
    laptop: '<rect x="5" y="5" width="14" height="10" rx="1.4"/><path d="M2.5 19h19"/>',
    monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="1.6"/><path d="M9 20.5h6M12 16.5v4"/>',
    unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.6"/><path d="M12 17.2h.01"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
  };
  function gcIcon(src, label) {
    var l = esc(String(label || '?').replace(/^(your|the) /i, '').charAt(0).toUpperCase() || '?');
    if (!src) return '<span class="gic mono">' + l + '</span>';
    var k = src.slice(0, 2), v = src.slice(2);
    if (k === 'g:') return '<span class="gic gl"><svg viewBox="0 0 24 24" aria-hidden="true">' + (GC_GLYPH[v] || GC_GLYPH.unknown) + '</svg></span>';
    if (k === 's:') return '<span class="gic st">' + STUDIO_LOGO + '</span>';
    var url = k === 'f:' ? GC_ICON + '?f=' + encodeURIComponent(v) : k === 'u:' ? GC_ICON + '?u=' + encodeURIComponent(v) : GC_ICON + '?d=' + encodeURIComponent(v);
    return '<span class="gic' + (k === 'f:' ? ' flag' : '') + '"><img src="' + esc(url) + '" alt="" loading="lazy" decoding="async" data-l="' + l + '"></span>';
  }
  // An icon that can't load turns into the first letter.
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG' && t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('gic')) { var p = t.parentNode; p.className = 'gic mono'; p.textContent = t.getAttribute('data-l') || '?'; } }, true);
  // Where a visit came from: [pattern on the site name, plain name, what it means, icon]. utm_source tags ("discord",
  // "github") and real sites ("discord.com") land on the same row.
  var GC_SRC = [
    [/^$/, 'Opened the link directly', 'Typed or pasted it, a bookmark, or an app that hides where the click came from (the Discord app on PC and phone usually does)', 'g:direct'],
    [/discord(app)?\.(com|gg)$|com\.discord|^discord$/, 'Discord', 'A link in a Discord post or message. Can include people coming back from the Discord sign-in page', 'd:discord.com'],
    [/^bio\.beatleader\.|(^|\.)beatleader\.(com|xyz|net|pro)$|^beatleader$/, 'BeatLeader', 'A link on BeatLeader, like a profile bio', 'd:beatleader.xyz'],
    [/(^|\.)beatsaver\.com$/, 'BeatSaver', 'A link on a BeatSaver map or profile page', 'd:beatsaver.com'],
    [/(^|\.)accsaber\.com$/, 'AccSaber', 'A link on AccSaber', 'd:accsaber.com'],
    [/(^|\.)github\.com$|^github$/, 'GitHub', 'The game\'s GitHub page or README', 'd:github.com'],
    [/^(www\.)?google\.|^google$/, 'Google search', 'Found the game by searching Google', 'd:google.com'],
    [/(^|\.)bing\.com$|^bing$/, 'Bing', 'Found it by searching Bing', 'd:bing.com'],
    [/duckduckgo/, 'DuckDuckGo', 'Found it by searching DuckDuckGo', 'd:duckduckgo.com'],
    [/(^|\.)reddit\.com$|redd\.it$|^reddit$/, 'Reddit', 'A link in a Reddit post or comment', 'd:reddit.com'],
    [/(^|\.)youtube\.com$|youtu\.be$|^youtube$/, 'YouTube', 'A link in a YouTube video or comment', 'd:youtube.com'],
    [/(^|\.)twitch\.tv$|^twitch$/, 'Twitch', 'A link in a Twitch stream or chat', 'd:twitch.tv'],
    [/(^|\.)(x|twitter)\.com$|^t\.co$|^(x|twitter)$/, 'X (Twitter)', 'A link in a post on X', 'd:x.com'],
    [/(^|\.)chatgpt\.com$|^chat\.openai\.com$/, 'ChatGPT', 'Someone asked ChatGPT and it linked the game', 'd:chatgpt.com'],
    [/(^|\.)claude\.ai$/, 'Claude', 'A link from Claude', 'd:claude.ai'],
    [/^gemini\.google\./, 'Gemini', 'Someone asked Gemini and it linked the game', 'd:gemini.google.com'],
    [/(^|\.)perplexity\.ai$/, 'Perplexity', 'Someone asked Perplexity and it linked the game', 'd:perplexity.ai'],
    [/(^|\.)mickool\.net$/, 'mickool.net', 'Your own site', 'd:mickool.net'],
    [/workers\.dev$/, 'The game server', 'Coming back from sign-in through the game server', 'g:link'],
    [/^(localhost|127\.0\.0\.1)/, 'Local testing', 'You, testing on your own computer', 'g:laptop']
  ];
  var GC_REPO = { 'playlist-studio': ['Playlist Studio', 's:'], 'reesaber-studio': ['ReeSaber Studio', 'u:https://spanky3651.github.io/reesaber-studio/'], 'hsv-config-generator': ['HSV Config Generator', 'u:https://spanky3651.github.io/hsv-config-generator/'], 'studio-sync': ['Studio Sync page', 's:'] };
  function gcSource(r) {
    var raw = String(r.name || ''), full = raw.replace(/^[a-z-]+:\/\//i, '').toLowerCase(), host = full.replace(/\/.*$/, ''), path = full.slice(host.length);
    if (/^spanky3651\.github\.io$/.test(host)) {
      var repo = (path.split('/')[1] || '').replace(/[?#].*$/, ''), m = GC_REPO[repo];
      return m ? { label: m[0], note: 'Clicked through from your ' + m[0], icon: m[1] } : { label: 'Your GitHub pages', note: 'Clicked through from one of your other pages', icon: 'd:github.com' };
    }
    if (/^(playlist-studio|studio-sync)$/.test(host)) return { label: GC_REPO[host][0], note: 'Clicked through from your ' + GC_REPO[host][0], icon: 's:' };
    for (var i = 0; i < GC_SRC.length; i++) if (GC_SRC[i][0].test(host)) return { label: GC_SRC[i][1], note: GC_SRC[i][2], icon: GC_SRC[i][3] };
    if (r.scheme === 'c') return { label: raw.replace(/[-_]+/g, ' ').replace(/^./, function (x) { return x.toUpperCase(); }), note: 'A link you tagged with utm_source=' + raw, icon: 'g:link' };
    return { label: host.replace(/^www\./, '') || 'Somewhere else', note: 'A link on that site', icon: /\./.test(host) ? 'd:' + host.replace(/^www\./, '') : '' };
  }
  var GC_CAMP = { readme: ['The game\'s GitHub README', 'd:github.com'], site: ['Links in your other tools\' footers', 'g:link'], 'cross-link': ['Links between your tools', 'g:link'], 'profile-bio': ['Your BeatLeader profile bio', 'd:beatleader.xyz'], launch: ['Launch post', 'g:link'] };
  // GoatCounter's six screen-size groups (by id, with the name as a fallback for older answers).
  var GC_SIZE = { phone: ['Phones', 'Phone-size screens', 'g:phone'], largephone: ['Big phones and small tablets', 'Large phones, phones held sideways, small tablets', 'g:phone'], tablet: ['Tablets and small laptops', 'Tablet-size screens', 'g:tablet'], desktop: ['Laptops and desktops', 'Regular computer screens', 'g:laptop'], desktophd: ['Big monitors', 'Screens bigger than full HD', 'g:monitor'], unknown: ['Screen size unknown', 'The browser didn\'t say', 'g:unknown'] };
  function gcSizeKey(r) { if (r.id && GC_SIZE[r.id]) return r.id; var n = String(r.name || '').toLowerCase(); return /larger than hd|desktophd/.test(n) ? 'desktophd' : /large phone|small tablet/.test(n) ? 'largephone' : /phone/.test(n) ? 'phone' : /tablet|small laptop/.test(n) ? 'tablet' : /monitor|desktop|computer/.test(n) ? 'desktop' : 'unknown'; }
  var GC_BROWSER = [[/oculus|quest|meta/i, 'Quest browser', 'In the headset', 'd:meta.com'], [/edge/i, '', '', 'u:https://www.microsoft.com/edge'], [/samsung/i, '', '', 'd:samsung.com'], [/opera/i, '', '', 'd:opera.com'], [/firefox/i, '', '', 'u:https://www.mozilla.org/firefox/'],
    [/brave/i, '', '', 'd:brave.com'], [/vivaldi/i, '', '', 'd:vivaldi.com'], [/duckduckgo/i, '', '', 'd:duckduckgo.com'], [/discord/i, 'Discord\'s own browser', 'Opened inside the Discord app', 'd:discord.com'], [/safari/i, '', '', 'u:https://www.apple.com/safari/'], [/chrom/i, '', '', 'u:https://www.google.com/chrome/']];
  var GC_SYSTEM = [[/windows/i, 'u:https://www.microsoft.com/windows'], [/android/i, 'd:android.com'], [/ios|iphone|ipad|mac/i, 'd:apple.com'], [/chrome ?os/i, 'u:https://www.google.com/chromebook/'], [/linux|ubuntu|fedora/i, 'd:kernel.org']];
  // One row: icon, name, what it means, a bar, and count with its share.
  function gcRow(icon, label, note, n, tot, max) {
    var pc = tot ? Math.round(n / tot * 100) : 0;
    return '<div class="grow">' + gcIcon(icon, label) + '<div class="gnm"><b>' + esc(label) + '</b>' + (note ? '<em>' + esc(note) + '</em>' : '') + '<span class="gbar"><i style="width:' + (max ? Math.max(3, Math.round(n / max * 100)) : 0) + '%"></i></span></div><div class="gnum"><b>' + n + '</b><small>' + (pc < 1 && n ? '<1' : pc) + '%</small></div></div>';
  }
  function gcBlock(title, sub, rows, key, show) {
    if (!rows.length) return '';
    rows = rows.slice().sort(function (a, b) { return b.n - a.n; });   // biggest first, so the bars measure against the top row
    var tot = rows.reduce(function (a, r) { return a + r.n; }, 0), max = rows[0].n, all = statsMore[key];
    return '<div class="gblk"><h4 class="hsub">' + title + (sub ? ' <span class="why">' + sub + '</span>' : '') + '</h4><div class="sbox glist">' + rows.slice(0, all ? 999 : show).map(function (r) { return gcRow(r.icon, r.label, r.note, r.n, tot, max); }).join('') + (all ? '' : sMore(key, rows.length, show)) + '</div></div>';
  }
  // Rows with the same plain name (a tagged "discord" link and discord.com) are added together.
  function gcMerge(list) {
    var by = {}, out = [];
    list.forEach(function (r) { var o = by[r.label]; if (o) { o.n += r.n; if (r.tagged) o.tagged += r.n; } else { by[r.label] = r; r.tagged = r.tagged || 0; out.push(r); } });
    out.forEach(function (r) { if (r.tagged && r.note && !/^A link you tagged/.test(r.note)) r.note += r.tagged === r.n ? '. All on a link you tagged' : '. ' + r.tagged + ' of these on a link you tagged'; });
    return out.sort(function (a, b) { return b.n - a.n; });
  }
  function gcHtml(gc) {
    var gd = gc.days || [], vals = gd.map(function (x) { return x[1]; }), gm = Math.max.apply(null, vals.concat([1]));
    var src = gcMerge((gc.refs || []).map(function (r) { var f = gcSource(r); return { label: f.label, note: f.note, icon: f.icon, n: r.count, tagged: r.scheme === 'c' ? r.count : 0 }; }));
    var srcTot = src.reduce(function (a, r) { return a + r.n; }, 0);
    var sizes = (gc.sizes || []).map(function (r) { var k = GC_SIZE[gcSizeKey(r)]; return { label: k[0], note: k[1], icon: k[2], n: r.count }; }).sort(function (a, b) { return b.n - a.n; });
    var sizeTot = sizes.reduce(function (a, r) { return a + r.n; }, 0), small = sizes.filter(function (r) { return r.icon === 'g:phone' || r.icon === 'g:tablet'; }).reduce(function (a, r) { return a + r.n; }, 0);
    var html = '<div class="sgrid two">' +
      sCard('Visitors', gc.visitors || 0, 'in the last 14 days', 'hero') +
      sCard('Busiest day', gd.length ? Math.max.apply(null, vals) : 0, gd.length ? new Date(gd.reduce(function (a, b) { return b[1] > a[1] ? b : a; })[0] + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '') +
      sCard('Main way in', src.length ? esc(src[0].label) : '-', src.length && srcTot ? Math.round(src[0].n / srcTot * 100) + '% of visitors' : '') +
      sCard('On a phone or tablet', sizeTot ? Math.round(small / sizeTot * 100) + '%' : '-', sizeTot ? 'the rest on a computer' : '') + '</div>';
    html += '<p class="snote">One person counts once a day, so someone who opens the game on three days counts three times. Your own visits are left out.</p>';
    if (gd.length) html += '<div class="sbox" style="margin-top:10px"><div class="dchart short">' + gd.map(function (x) { var dt = new Date(x[0] + 'T12:00:00'); return '<div class="dc" title="' + esc(dt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + ': ' + x[1] + ' visitor' + (x[1] === 1 ? '' : 's') + '"><div class="dbars"><i class="v" style="height:' + x[1] / gm * 100 + '%"></i></div><span>' + dt.getDate() + '</span></div>'; }).join('') + '</div><div class="leg"><span><i class="v"></i>Visitors each day</span><span class="lsub">Today is on the right</span></div></div>';
    html += gcBlock('How they found the game', 'the site or app they clicked from', src, 'gsrc', 6);
    html += gcBlock('Which tagged link', 'links you gave a utm_campaign name', (gc.campaigns || []).map(function (r) { var c = GC_CAMP[String(r.name).toLowerCase()]; return { label: c ? c[0] : String(r.name).replace(/[-_]+/g, ' ').replace(/^./, function (x) { return x.toUpperCase(); }), note: 'utm_campaign=' + r.name, icon: c ? c[1] : 'g:link', n: r.count }; }), 'gcmp', 5);
    var browsers = (gc.browsers || []).map(function (r) { var nm = r.name || 'Unknown', m = null; for (var i = 0; i < GC_BROWSER.length; i++) if (GC_BROWSER[i][0].test(nm)) { m = GC_BROWSER[i]; break; } return { label: m && m[1] ? m[1] : nm, note: m && m[2] ? m[2] : '', icon: m ? m[3] : '', n: r.count }; });
    var systems = (gc.systems || []).map(function (r) { var nm = r.name || 'Unknown', ic = ''; for (var i = 0; i < GC_SYSTEM.length; i++) if (GC_SYSTEM[i][0].test(nm)) { ic = GC_SYSTEM[i][1]; break; } return { label: nm, note: '', icon: ic, n: r.count }; });
    var countries = (gc.countries || []).map(function (r) { var cc = String(r.id || '').slice(0, 2).toLowerCase(); return { label: !r.name || /^\(?unknown\)?$/i.test(r.name) ? 'Couldn\'t tell' : r.name, note: '', icon: /^[a-z]{2}$/.test(cc) && cc !== 'xx' ? 'f:' + cc : 'g:unknown', n: r.count }; });
    html += '<div class="gcols">' + gcBlock('Phone or computer', 'by screen width', sizes, 'gsz', 5) + gcBlock('Browser', '', gcMerge(browsers), 'gbr', 5) + gcBlock('System', '', systems, 'gsy', 5) + gcBlock('Country', '', countries, 'gco', 6) + '</div>';
    return html;
  }
  // The parts that come from the server: days, hours, notifications, the not-joined list and GoatCounter.
  function drawStatsLive() {
    var box = $('statsLive'), d = statsData, s = st(); if (!box || !d) return;
    var html = '', days = d.daily.days || {}, keys = Object.keys(days).map(Number).sort(function (a, b) { return a - b; });
    if (s.status === 'signup' || !keys.length) html += '<section class="hsec"><h3>Each day <small>rolls and clears</small></h3><div class="sbox"><p class="why">' + (s.status === 'signup' ? 'Fills in day by day once rolling starts' + (s.startsAt ? ', ' + esc(startWhen(s.startsAt)) : '') + '.' : 'Nobody has rolled yet.') + '</p></div></section>';
    else {
      var all = []; for (var i = 1; i <= Math.max(s.day, keys[keys.length - 1]); i++) all.push([i, (days[i] || [0, 0])[0], (days[i] || [0, 0])[1]]);
      var mx = Math.max.apply(null, all.map(function (x) { return Math.max(x[1], x[2]); })) || 1;
      html += '<section class="hsec"><h3>Each day <small>rolls and clears</small></h3><div class="sbox"><div class="dchart">' + all.map(function (x) { return '<div class="dc" title="Day ' + x[0] + ': ' + x[1] + ' rolls, ' + x[2] + ' clears"><div class="dbars"><i class="r" style="height:' + x[1] / mx * 100 + '%"></i><i class="c" style="height:' + x[2] / mx * 100 + '%"></i></div><span>' + x[0] + '</span></div>'; }).join('') + '</div><div class="leg"><span><i class="r"></i>Rolls</span><span><i class="c"></i>Clears</span>' + (s.status === 'running' ? '<span class="lsub">Day ' + s.day + ' is today</span>' : '') + '</div></div></section>';
    }
    var hrs = d.daily.hours || [], tot = hrs.reduce(function (a, b) { return a + b; }, 0);
    if (!tot) html += '<section class="hsec"><h3>When people play <small>rolls by hour, your time</small></h3><div class="sbox"><p class="why">Shows the busiest hour once people start rolling, so you know when posts and reminders land best.</p></div></section>';
    else {
      var off = -new Date().getTimezoneOffset() / 60, loc = []; for (var h = 0; h < 24; h++) loc[h] = hrs[((h - Math.round(off)) % 24 + 24) % 24] || 0;
      var hm = Math.max.apply(null, loc), pk = loc.indexOf(hm);
      html += '<section class="hsec"><h3>When people play <small>rolls by hour, your time</small></h3><div class="sbox"><div class="hchart">' + loc.map(function (n, k) { return '<div class="hc" title="' + hourLabel(k) + ': ' + n + '"><i style="height:' + (hm ? n / hm * 100 : 0) + '%"' + (k === pk ? ' class="pk"' : '') + '></i></div>'; }).join('') + '</div><div class="hax"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div><p class="snote">Busiest: <b>' + hourLabel(pk) + '</b>. Posts and reminders land best just before.</p></div></section>';
    }
    box.innerHTML = html; html = '';
    // Notifications
    var on = {}; (d.notify.on || []).forEach(function (pid) { on[pid] = 1; });
    var offList = s.order.filter(function (pid) { return !on[pid]; });
    html += '<section class="hsec"><h3>Notifications <small>roll reminders on a phone or computer</small></h3><div class="sbox">' + sBar('Turned on', d.notify.on.length, s.order.length, 'g', '<b>' + d.notify.on.length + '</b> <small>' + (s.order.length ? Math.round(d.notify.on.length / s.order.length * 100) : 0) + '%</small>') + sBar('Not yet', offList.length, s.order.length, '', '<b>' + offList.length + '</b>') +
      (offList.length ? '<p class="snote">Not yet: ' + offList.slice(0, statsMore.off ? 999 : 12).map(function (pid) { return '<b>' + esc(s.players[pid].name) + '</b>'; }).join(', ') + (!statsMore.off && offList.length > 12 ? ' and ' + (offList.length - 12) + ' more' : '') + '</p>' + (statsMore.off ? '' : sMore('off', offList.length, 12)) : '') + '</div></section>';
    // Signed in, never joined
    var why = { waiting: 'Waiting for you to let them in', 'can-join': 'Can join, hasn\'t', looking: 'Just looking' };
    var lk = d.lurkers || [];
    html += '<section class="hsec"><h3>Signed in, never joined <small>from the last two weeks of visits</small></h3><div class="sbox slist">' + (lk.length ? lk.slice(0, statsMore.lurk ? 999 : 8).map(function (x) {
      var img = x.avatar ? avatarHtml({ id: 'd' + x.id, name: x.name, avatar: x.avatar }, 'vis-ava') : '<span class="vis-ava guest">' + esc(R.initials(x.name || '?')) + '</span>';
      return '<div class="srow">' + img + '<span class="sn2"><b>' + esc(x.name) + '</b><em>' + why[x.why] + (x.reacted ? ' · reacted' : '') + '</em></span><span class="sago">' + (x.last ? (x.visits ? x.visits + ' visit' + (x.visits === 1 ? '' : 's') + ', ' : '') + visitAgo(x.last) : 'No visits') + '</span></div>';
    }).join('') + (statsMore.lurk ? '' : sMore('lurk', lk.length, 8)) : '<p class="why">Everyone who signed in has joined.</p>') + '</div></section>';
    // GoatCounter
    var gc = d.gc || {};
    html += '<section class="hsec"><h3>Visitors <small>people who opened the game page, last 14 days (GoatCounter)</small></h3>';
    if (gc.error === 'no-key') html += '<p class="why">Add the GoatCounter API key to the game server to see this. In the worker folder: <code>npx wrangler secret put GC_TOKEN</code>, then paste the same key Playlist Studio uses.</p>';
    else if (gc.error) html += '<p class="why">' + (gc.error === 'auth' ? 'GoatCounter turned the API key down. Check that GC_TOKEN can read the chesters-escape site.' : 'GoatCounter didn\'t answer. Try Refresh in a minute.') + '</p>';
    else html += gcHtml(gc);
    html += '</section>';
    var box2 = $('statsLive2'); if (box2) box2.innerHTML = html;
  }
  // User log: Host tools on Today, scrolled so the Visits heading sits just under the tab bar (which
  // stays stuck to the top and would otherwise cover it). Tried again while the list and pictures load
  // and push things around, and never again once you scroll or tap.
  function jumpToVisits() {
    var hb = $('hostBody'), stop = false, quit = function () { stop = true; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) { hb.addEventListener(ev, quit, { once: true, passive: true }); });
    var go = function () {
      if (stop || $('hostDrawer').hidden || hostTab !== 'today') return;
      var vb = $('visitBox'), sec = vb && vb.closest('section'); if (!sec) return;
      var tabs = hb.querySelector('.htabs'), under = hb.getBoundingClientRect().top + (tabs ? tabs.getBoundingClientRect().bottom - hb.getBoundingClientRect().top : 0);
      hb.scrollTop += sec.getBoundingClientRect().top - under - 10;
    };
    [50, 300, 800, 1500, 2500].forEach(function (ms) { setTimeout(go, ms); });
  }
  function closeHost() { $('hostDrawer').hidden = true; $('scrim').hidden = true; ($('hostBtn').hidden && $('meTools') ? $('meTools') : $('hostBtn')).focus(); setTimeout(checkNewClears, 300); }
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
    var open = E.signupsOpen(s), n = s.order.length;
    return '<section class="hsec"><h3>Before the start</h3><p>' + (s.startsAt ? 'The first roll unlocks <b>' + esc(startWhen(s.startsAt)) + '</b>, in <span data-countdown="' + s.startsAt + '">' + fmtLeft(s.startsAt - Date.now()) + '</span>.' : 'No start time is set yet.') +
      (open ? ' Until then people can join and pick a route, but nobody rolls.' : ' Sign-ups are closed until then.') + '</p>' +
      '<label class="start-field"><span>Start time</span><input type="datetime-local" id="startEdit" value="' + (s.startsAt ? toLocalInput(s.startsAt) : '') + '"></label>' +
      '<div class="row"><button type="button" class="btn small" data-h="reschedule">Save start time</button>' + (s.startsAt ? '<button type="button" class="btn small ghost" data-h="clearstart">Cancel the countdown</button>' : '') + '<button type="button" class="btn small ghost" data-h="startnow">Start now</button></div>' +
      (s.startsAt ? '<p class="why">Cancel the countdown keeps sign-ups open and everyone where they are, with no start time until you set a new one.</p>' : '') +
      '<h4 class="hsub">Sign-ups</h4>' +
      '<label class="check"><input type="radio" name="sumode" value="open"' + (open ? ' checked' : '') + '> <span>Open. People can join and pick a route now.</span></label>' +
      '<label class="check"><input type="radio" name="sumode" value="closed"' + (open ? '' : ' checked') + '> <span>Closed until the game starts. Joining opens by itself at the start.</span></label>' +
      '<p style="margin-top:10px">' + (n ? n + (n === 1 ? ' person has' : ' people have') + ' signed up.' : 'Nobody has signed up yet.') + '</p>' +
      (n ? '<div class="row"><button type="button" class="btn small danger" data-h="clearplayers">Clear all sign-ups</button></div>' : '') + '</section>';
  }
  // Host tools in four tabs: what needs you today, the players, the game setup, and alerts.
  // Each tab only shows what makes sense for where the game is: sign-ups, running, or over.
  var hostTab = 'today';
  var HOST_TABS = [['today', 'Today'], ['players', 'Players'], ['game', 'Game'], ['alerts', 'Alerts']];
  var POST_LIST = [
    ['Countdowns', [['signups', 'When sign-ups open'], ['day', '24 hours before the start, with everyone signed up'], ['hour', 'One hour before the start'], ['start', 'When the game starts'], ['lastcall', '24 hours before the end'], ['end', 'When the game ends, with the top 3']]],
    ['Moments', [['escape', 'Someone escapes'], ['leader', 'Someone takes the lead (once a day at most)'], ['setback', 'Big setbacks: back to the start, or 5 or more spaces back'], ['big', 'Clears at 95% or better'], ['gate', 'Someone reaches the exit but has to wait at the gate']]]
  ];
  function themeOptions(s, id) {
    return '<select id="' + id + '">' + Object.keys(C.themes).filter(function (k) { return (C.themes[k].family || 'chester') === (theme().family || 'chester'); }).map(function (k) { return '<option value="' + k + '"' + (k === s.themeId ? ' selected' : '') + '>' + esc(C.themes[k].name) + '</option>'; }).join('') + '</select>';
  }
  // Only once a game is over: set up the next one.
  function newGameSection(s) {
    return '<section class="hsec"><h3>Start the next game</h3><p>Everyone who played stays signed up and picks a route again.</p>' +
      '<div class="row"><label>Theme ' + themeOptions(s, 'newTheme') + '</label></div>' +
      '<label class="start-field"><span>Start time (optional)</span><input type="datetime-local" id="newStart"></label>' +
      '<label class="start-field"><span>End time (optional)</span><input type="datetime-local" id="newEnd"></label>' +
      '<p class="why">With a start time, sign-ups open now and the first roll unlocks then. Leave it empty to start right away. Day 1 lasts until the next ' + esc(cutoffLabel(s)) + ' cutoff, so a ' + esc(cutoffLabel(s)) + ' start gives everyone a full first day. With an end time, the game locks then and the standings freeze; without one it runs until everyone escapes.</p><div class="row">' +
      '<button type="button" class="btn small" data-h="newgame">Start the next game</button>' + (designerBoard() ? '<button type="button" class="btn small ghost" data-h="loadboard">Start it on the designer board</button>' : '') + '</div>' +
      '<h4 class="hsub">Start fresh instead</h4><p>Clears everyone off the board and empties the thread, so the next game opens with nobody signed up. It uses the theme and times above.</p>' +
      '<div class="row"><button type="button" class="btn small danger" data-h="cleargame" data-f="new">Clear the old game</button></div></section>';
  }
  function renderHost() {
    var s = st(), demo = store.mode === 'demo', T = { today: '', players: '', game: '', alerts: '' };
    var signup = s.status === 'signup', running = s.status === 'running', over = s.status === 'finished';
    var claims = [];
    s.order.forEach(function (pid) { s.players[pid].claims.forEach(function (c) { claims.push({ p: s.players[pid], c: c }); }); });
    var ac = !demo && store.access ? store.access : null, waiting = ac ? ac.pending : [], todo = claims.length + waiting.length;

    // ---- Today: what needs the host, where the game is, and who's been on ----
    T.today += '<section class="hsec' + (todo ? ' attn' : '') + '"><h3>Needs you' + (todo ? ' <span class="nav-badge">' + todo + '</span>' : '') + '</h3>';
    if (!todo) T.today += '<p>Nothing needs you right now. ' + (over ? 'People waiting to get in show up here.' : 'Runs to approve and people waiting to get in show up here.') + '</p>';
    if (claims.length) T.today += '<h4 class="hsub">Runs to approve</h4>' + claims.map(function (x) {
      var t = x.p.tasks.filter(function (k) { return k.id === x.c.task; })[0];
      return '<div class="claim"><b>' + esc(x.p.name) + '</b> says they played <b>!bsr ' + esc(t ? t.bsr.join(' or ') : '?') + '</b>' + (x.c.url ? ' (<a href="' + esc(x.c.url) + '" target="_blank" rel="noopener">replay</a>)' : '') +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn small good" data-h="approve" data-pid="' + esc(x.p.id) + '" data-task="' + esc(x.c.task) + '">Approve</button><button type="button" class="btn small ghost" data-h="reject" data-pid="' + esc(x.p.id) + '" data-task="' + esc(x.c.task) + '">Reject</button></div></div>';
    }).join('');
    if (waiting.length) T.today += '<h4 class="hsub">Waiting to get in</h4>' + waiting.map(function (w) {
      return '<div class="claim row" style="justify-content:space-between"><span><b>' + esc(w.name) + '</b> <span class="why">' + esc(w.id) + '</span></span><span class="row">' +
        '<button type="button" class="btn small good" data-h="letin" data-id="' + esc(w.id) + '">Let in</button><button type="button" class="btn small ghost" data-h="dismiss" data-id="' + esc(w.id) + '">Dismiss</button></span></div>';
    }).join('');
    T.today += '</section>';
    var ud = store.undoInfo ? store.undoInfo() : null;
    if (ud && ud.list.length) {
      T.today += '<section class="hsec"><h3>Your recent changes</h3>' + ud.list.map(function (u, i) {
        return '<div class="undo-row' + (i ? ' old' : '') + '"><span><b>' + esc(u.label) + '</b><span class="why"> ' + esc(agoShort(Date.now() - u.at)) + (u.by ? ' \u00b7 ' + esc(u.by) : '') + '</span></span>' +
          (i === 0 && ud.ok ? '<button type="button" class="btn small ghost" data-h="undo">Undo</button>' : '') + '</div>';
      }).join('') + (!ud.ok ? '<p class="why" style="margin-top:8px">Players have done things since your last change, so it can\'t be undone without wiping their moves.</p>' : '<p class="why" style="margin-top:8px">Undo takes back the newest change. Discord posts that already went out stay posted.</p>') + '</section>';
    }
    if (signup) T.today += startSection(s);
    else if (running) T.today += '<section class="hsec"><h3>Day ' + s.day + '</h3><p>' + (demo ? 'Starting the next day lets every bot clear maps and roll.' : 'The day turns over by itself at ' + esc(cutoffLabel(s)) + '. Start the next day is only for fixing a missed rollover.') + '</p><div class="row">' +
      '<button type="button" class="btn small ghost" data-h="advance">Start the next day</button>' + (demo ? '<button type="button" class="btn small ghost" data-h="simulate">Skip ahead 3 days</button>' : '') + '</div></section>';
    else T.today += '<section class="hsec"><h3>Game over</h3><p>The standings are frozen.</p><div class="row"><button type="button" class="btn small ghost" data-h="finale">Show the final standings</button></div></section>' + newGameSection(s);
    T.today += '<section class="hsec"><h3>Stats</h3><p>How the game is going: who\'s rolling, who\'s slipping, the hardest maps, notifications and where visitors come from.</p><div class="row"><button type="button" class="btn small ghost" id="hostStats">Open stats</button></div></section>';
    T.today += '<section class="hsec"><div class="thread-head"><h3>Visits</h3><button type="button" class="icon-btn refresh-btn" data-h="visits-refresh" aria-label="Refresh" title="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/></svg></button></div><p>When signed-in people opened the game and when they left. Coming back within 10 minutes counts as the same visit, so a visit ends 10 minutes after they close it, switch away or lock their phone. The last two weeks are kept.</p><div id="visitBox"><p class="why">Loading</p></div></section>';

    // ---- Players ----
    if (s.order.length > 6 || (ac && ac.allowed.length > 6)) T.players += '<div class="psearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input type="search" id="pSearch" placeholder="Find a player" aria-label="Find a player" autocomplete="off" value="' + esc(playerQuery) + '"><span class="psearch-n" id="pSearchN" aria-live="polite"></span></div>';
    if (!demo) T.players += '<section class="hsec"><h3>You</h3><label class="check"><input type="checkbox" id="hostOutBox"' + (store.hostOut ? ' checked' : '') + '> <span>I\'m hosting this game, not playing. You get an Admin badge instead of the Join button.</span></label><p class="why">Only for this clan\'s game. Your other games stay the same.</p>' + (store.user ? '<p class="why" style="margin-top:10px">Signed in as ' + esc(store.user.name) + ' on this device. <button type="button" class="btn link" id="logoutBtn">Sign out</button></p>' : '') + '</section>';
    if (signup) {
      T.players += '<section class="hsec"><h3>Signed up</h3><p>' + (s.order.length ? 'Tokens go on the board when the game starts.' : 'Nobody has signed up yet.') + '</p>';
      if (s.order.length) T.players += '<table class="ptable"><tbody>' + s.order.map(function (pid) {
        var p = s.players[pid];
        return '<tr data-pname="' + esc(p.name.toLowerCase()) + '"><td><b>' + esc(p.name) + '</b><br><span class="why">' + (p.route ? esc(s.board.routeInfo[p.route].name) : 'No route yet') + '</span></td>' +
          '<td><div class="row" style="justify-content:flex-end">' + (p.route ? '<button type="button" class="btn small ghost" data-h="clearroute" data-pid="' + esc(pid) + '">Undo route</button>' : '') +
          '<button type="button" class="btn small danger" data-h="removeplayer" data-pid="' + esc(pid) + '">Remove</button></div></td></tr>';
      }).join('') + '</tbody></table>';
      T.players += '</section>';
    } else if (running) {
      T.players += '<section class="hsec"><h3>Players</h3><p>' + (s.order.length ? 'Space 0 is the start. Moving a token does not apply the space unless you tick the box.' : 'Nobody has joined yet.') + '</p>';
      if (s.order.length) {
        T.players += '<table class="ptable"><tbody>';
        s.order.forEach(function (pid) {
          var p = s.players[pid];
          T.players += '<tr data-pname="' + esc(p.name.toLowerCase()) + '"><td><b>' + esc(p.name) + '</b><br><span class="why">' + (p.finished ? 'Escaped, ' + ordinal(p.finished.place) : p.route ? s.board.routeInfo[p.route].name : 'no route') + (p.tasks.length ? ', on a map' : '') + '</span></td>' +
            '<td>' + (p.route ? '<span class="row nowrap"><input type="number" min="0" max="' + E.routeOf(s, p).length + '" value="' + (p.pos + 1) + '" aria-label="Space for ' + esc(p.name) + '" data-posfor="' + esc(pid) + '"><button type="button" class="btn small ghost" data-h="move" data-pid="' + esc(pid) + '">Move</button></span>' : '') + '</td>' +
            '<td>' + (p.route && !p.finished ? '<select data-cardfor="' + esc(pid) + '" aria-label="Give ' + esc(p.name) + ' a card"><option value="">Give a card</option>' + s.cards.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('') + '</select>' : '') + '</td>' +
            '<td><div class="row">' + (p.tasks.length ? '<button type="button" class="btn small ghost" data-h="clearmap" data-pid="' + esc(pid) + '">Clear map</button>' : '') +
            (p.route ? '<button type="button" class="btn small danger" data-h="reset" data-pid="' + esc(pid) + '">Reset</button>' : '') + '</div></td></tr>';
        });
        T.players += '</tbody></table><label class="check"><input type="checkbox" id="applyMove"> <span>Apply the space after moving a token</span></label>';
      }
      T.players += '</section>';
    } else {
      var fin = s.final || E.ranking(s);
      T.players += '<section class="hsec"><h3>Final standings</h3>' + (fin.length ? '<table class="ptable"><tbody>' + fin.map(function (r) {
        var p = s.players[r.pid]; if (!p) return '';
        return '<tr data-pname="' + esc(p.name.toLowerCase()) + '"><td><b>' + ordinal(r.place) + '</b></td><td><b>' + esc(p.name) + '</b></td><td class="why">' + (r.escaped ? 'Escaped day ' + r.day : r.left + ' to go') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p>Nobody played this game.</p>') + '</section>';
    }
    if (ac) {
      var names = ac.names || {};
      T.players += '<section class="hsec"><h3>Who can play</h3>' +
        '<label class="check"><input type="radio" name="acmode" value="testers"' + (ac.mode !== 'open' ? ' checked' : '') + '> <span>Only people I let in</span></label>' +
        '<label class="check"><input type="radio" name="acmode" value="open"' + (ac.mode === 'open' ? ' checked' : '') + '> <span>Anyone who signs in with Discord</span></label>' +
        (waiting.length ? '<p style="margin-top:10px">' + waiting.length + (waiting.length === 1 ? ' person is' : ' people are') + ' waiting to get in. Let them in from the Today tab.</p>' : '');
      if (ac.allowed.length) T.players += '<h4 class="hsub">Let in</h4>' + ac.allowed.map(function (id) {
        return '<div class="claim row" data-pname="' + esc(String(names[id] || 'Player').toLowerCase() + ' ' + id) + '" style="justify-content:space-between"><span><b>' + esc(names[id] || 'Player') + '</b> <span class="why">' + esc(id) + '</span></span><button type="button" class="btn small danger" data-h="unallow" data-id="' + esc(id) + '">Remove</button></div>';
      }).join('');
      T.players += '</section>';
    }

    // ---- Game: end time, rules, theme and board ----
    if (!over) T.game += endSection(s);
    T.game += '<section class="hsec"><h3>Rules' + (over ? ' <span class="why">for the next game</span>' : '') + '</h3>' +
      '<label class="check"><input type="checkbox" data-set="exactFinish"' + (s.settings.exactFinish ? ' checked' : '') + '> <span>Exact roll needed to escape</span></label>' +
      '<label class="check"><input type="checkbox" data-set="oneFinishPerDay"' + (s.settings.oneFinishPerDay !== false ? ' checked' : '') + '> <span>Podium escapes one per day (after the top 3, anyone can escape)</span></label>' +
      '<label class="check"><input type="checkbox" data-set="oneRollPerDay"' + (s.settings.oneRollPerDay ? ' checked' : '') + '> <span>One roll per day</span></label></section>';
    if (!over) {
      T.game += '<section class="hsec"><h3>Theme and board</h3><div class="row"><label>Theme ' + themeOptions(s, 'themeSel') + '</label></div><p style="margin-top:10px">Changing the theme keeps everyone where they are.</p>';
      if (signup && designerBoard()) T.game += '<h4 class="hsub">Designer board</h4><p>Swap this game onto the board from the designer. Sign-ups and the start time stay, and everyone picks a route again.</p><div class="row"><button type="button" class="btn small ghost" data-h="loadboard">Use the designer board</button></div>';
      if (running) T.game += '<p class="why">To start a new game, end this one first (End of the game, above). The next game is set up from the Today tab.</p>';
      T.game += '</section>';
    }

    // ---- Alerts: Discord posts, roll reminders, this device ----
    if (!demo && store.discord) {
      var dc = store.discord, off = dc.hooked ? '' : ' disabled';
      T.alerts += '<section class="hsec"><h3>Discord posts</h3>' +
        (dc.hooked ? '<p>Automatic posts to the game channel. All of them start off.</p>' : '<p class="why">No channel webhook is set up for this game yet, so nothing can post. Add the webhook to the Worker first.</p>') +
        POST_LIST.map(function (g) {
          return '<h4 class="hsub">' + g[0] + (g[0] === 'Moments' ? ' <span class="why">up to 5 a day, escapes always post</span>' : '') + '</h4>' + g[1].map(function (k) {
            return '<label class="check"><input type="checkbox" data-post="' + k[0] + '"' + (dc[k[0]] ? ' checked' : '') + off + '> <span>' + esc(k[1]) + '</span></label>';
          }).join('');
        }).join('') +
        (dc.hooked ? '<div class="row" style="margin-top:10px"><button type="button" class="btn small ghost" data-h="discordtest">Send a test post</button></div>' : '') + '</section>';
    }
    T.alerts += '<section class="hsec"><h3>Roll reminders' + (over ? ' <span class="why">for the next game</span>' : '') + '</h3><label class="start-field"><span>Push reminder for players who turn on notifications</span><select id="remindSel"><option value=""' + (E.remindHour(s) == null ? ' selected' : '') + '>Off</option>' +
      [17, 18, 19, 20, 21, 22].map(function (h) { return '<option value="' + h + '"' + (E.remindHour(s) === h ? ' selected' : '') + '>' + hourLabel(h) + ' in each player\'s own time</option>'; }).join('') + '</select></label></section>';
    T.alerts += '<section class="hsec"><h3>Notifications on this device</h3><div id="pushBox" class="push-box" data-kind="host"><p>Checking this device.</p></div></section>';

    var html = '<div class="htabs" role="tablist">' + HOST_TABS.map(function (t) {
      var n = t[0] === 'today' ? todo : 0;
      return '<button type="button" role="tab" class="htab" data-h="tab" data-tab="' + t[0] + '" aria-selected="' + (hostTab === t[0]) + '">' + t[1] + (n ? ' <span class="nav-badge">' + n + '</span>' : '') + '</button>';
    }).join('') + '</div>' + HOST_TABS.map(function (t) { return '<div class="hpane" data-pane="' + t[0] + '" role="tabpanel"' + (hostTab === t[0] ? '' : ' hidden') + '>' + T[t[0]] + '</div>'; }).join('');
    var keep = {}; ['newStart', 'startEdit', 'newEnd', 'endEdit', 'newTheme'].forEach(function (id) { var el = $(id); if (el && el.value && el.dataset.touched) keep[id] = el.value; });
    var ae = document.activeElement, typing = ae && ae.id === 'pSearch' ? [ae.selectionStart, ae.selectionEnd] : null;
    $('hostBody').innerHTML = html;
    filterPlayers();
    if (typing && $('pSearch')) { $('pSearch').focus(); try { $('pSearch').setSelectionRange(typing[0], typing[1]); } catch (e) {} }
    fillVisits();
    Object.keys(keep).forEach(function (id) { var el = $(id); if (el) { el.value = keep[id]; el.dataset.touched = '1'; } });
    ['newStart', 'startEdit', 'newEnd', 'endEdit', 'newTheme'].forEach(function (id) { var el = $(id); if (el) el.addEventListener(id === 'newTheme' ? 'change' : 'input', function () { el.dataset.touched = '1'; }); });
    fillPush();
  }
  // Players tab search: hides rows whose name doesn't match, and says how many do.
  var playerQuery = '';
  function filterPlayers() {
    var q = playerQuery.trim().toLowerCase(), rows = document.querySelectorAll('#hostBody [data-pname]'), shown = 0;
    Array.prototype.forEach.call(rows, function (r) { var hit = !q || r.dataset.pname.indexOf(q) >= 0; r.hidden = !hit; if (hit) shown++; });
    var n = $('pSearchN'); if (n) n.textContent = q ? (shown ? shown + ' found' : 'Nobody matches') : '';
  }
  function showHostTab(id) {
    hostTab = id;
    Array.prototype.forEach.call(document.querySelectorAll('#hostBody .htab'), function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    Array.prototype.forEach.call(document.querySelectorAll('#hostBody .hpane'), function (p) { p.hidden = p.dataset.pane !== id; });
    $('hostBody').scrollTop = 0;
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
      var rb = $('remBtn'); if (rb) { rb.classList.toggle('on', !!on); rb.title = on ? 'Roll reminders are on' : 'Roll reminders'; }
      set(function (k) {
        if (k === 'host') return on
          ? '<p class="push-on">On for this device. You\'ll get a notification when someone signs up, is waiting to get in or asks you to approve a run. It covers every clan you host.</p><div class="row"><button type="button" class="btn small" data-push="test">Send a test</button><button type="button" class="btn small ghost" data-push="off">Turn off</button></div>'
          : '<p>Get a notification on this device when someone signs up, is waiting to get in or asks you to approve a run, even with the game closed.</p><div class="row"><button type="button" class="btn small" data-push="on">Turn on notifications</button></div>';
        var bell = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a6 6 0 0 0-6 6v3.4L4.3 15a1 1 0 0 0 .9 1.5h13.6a1 1 0 0 0 .9-1.5L18 11.9V8.5a6 6 0 0 0-6-6Z"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0"/></svg>';
        return '<div class="rem' + (on ? ' on' : '') + '"><span class="rem-bell">' + bell + '</span>' +
          '<span class="rem-txt"><b>Roll reminders</b><span>' + (on ? 'On. You\'ll get a nudge at ' + esc(at) + ' if your roll or map is still waiting.' : 'Get a nudge at ' + esc(at) + ' if your roll or map is still waiting.') + '</span>' +
          (on ? '<button type="button" class="rem-test" data-push="test">Send a test</button>' : '') + '</span>' +
          '<button type="button" class="rem-switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="Roll reminders" data-push="' + (on ? 'off' : 'on') + '"><i></i></button></div>';
      });
    });
  }
  function openRem() {
    var pop = $('remPop'), b = $('remBtn'), r = b.getBoundingClientRect();
    pop.hidden = false; b.setAttribute('aria-expanded', 'true');
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    var w = pop.offsetWidth, vw = document.documentElement.clientWidth;
    pop.style.left = Math.round(Math.min(vw - w - 12, Math.max(12, r.right + 8 - w))) + 'px';
    fillPush(); track('reminders-open');
  }
  function closeRem() { var pop = $('remPop'); if (pop && !pop.hidden) { pop.hidden = true; $('remBtn').setAttribute('aria-expanded', 'false'); } }
  function pushOn() {
    var key = urlKey(store.vapidKey), t0 = Date.now(), before = Notification.permission, said = '';
    var ready = function () { return navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; }); };
    var fresh = function (reg) { return reg.pushManager.getSubscription().then(function (old) { return old ? old.unsubscribe() : null; }).then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }); };
    Promise.resolve(Notification.requestPermission()).then(function (perm) {
      said = String(perm);
      // Some Android Chrome setups answer the plain request without asking. Subscribing for push asks on its own, so try it either way.
      return ready().then(function (reg) {
        return fresh(reg).catch(function (e) {
          var ms = Date.now() - t0;
          track('push-fail-' + said + '-' + Notification.permission + (ms < 400 ? '-instant' : ''));
          throw new Error('Chrome turned notifications down. It answered "' + said + '" in ' + (ms < 1000 ? ms + ' ms' : Math.round(ms / 1000) + ' s') + '. Permission was "' + before + '", now "' + Notification.permission + '". ' + (e && e.name ? e.name + ': ' : '') + ((e && e.message) || ''));
        });
      });
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
  // The designer keeps a board per clan game; boards saved before clans existed are still found.
  function designerBoard() { try { return JSON.parse((store.clan && localStorage.getItem('cg.designer.board.' + store.clan)) || localStorage.getItem('cg.designer.board') || 'null'); } catch (e) { return null; } }
  function cssq(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function hostAction(btn) {
    var h = btn.dataset.h, pid = btn.dataset.pid;
    var run = function (name, args, msg) { return store.act(name, args).then(function () { track('host-' + h); if (msg) toast(msg, 'good'); }, fail); };
    switch (h) {
      case 'advance': if (store.mode === 'demo' || confirm('Start day ' + (st().day + 1) + ' for everyone now? The day normally turns over by itself at ' + cutoffLabel(st()) + '.')) run('advance', {}, 'Day ' + (st().day + 1) + ' has started.'); break;
      case 'simulate': run('simulate', { days: 3 }, 'Skipped ahead 3 days.'); break;
      case 'tab': showHostTab(btn.dataset.tab); break;
      case 'undo': { var u0 = store.undoInfo().list[0]; if (u0 && confirm('Undo "' + u0.label + '"?')) run('undo', {}, 'Undone: ' + u0.label + '.'); break; }
      case 'move': {
        var mp = st().players[pid], box = document.querySelector('[data-posfor="' + cssq(pid) + '"]'), to = box ? parseInt(box.value, 10) : NaN, apply = $('applyMove') && $('applyMove').checked;
        if (isNaN(to)) { toast('Type a space number first.', 'bad'); break; }
        if (to === mp.pos + 1) { toast(mp.name + ' is already on space ' + to + '.', ''); break; }
        if (confirm('Move ' + mp.name + ' from space ' + (mp.pos + 1) + ' to space ' + to + '?' + (apply ? ' The space\'s effect applies too.' : ''))) run('setpos', { pid: pid, pos: to - 1, apply: apply }, mp.name + ' moved to space ' + to + '.');
        else box.value = mp.pos + 1;
        break;
      }
      case 'discordtest': if (confirm('Send a test post to the game\'s Discord channel? Everyone in the channel will see it.')) run('discordTest', {}, 'Test post sent. Check the channel.'); break;
      case 'approve': run('approve', { pid: pid, task: btn.dataset.task }, 'Approved.'); break;
      case 'reject': if (confirm('Reject ' + st().players[pid].name + '\'s run? They keep the map and can play it again or send a new run.')) run('reject', { pid: pid, task: btn.dataset.task }, 'Run rejected.'); break;
      case 'clearmap': { var p = st().players[pid]; if (!confirm('Mark ' + p.name + '\'s map as cleared? They can roll again.')) break; run('approve', { pid: pid, task: p.tasks[0].id }, 'Map cleared for ' + p.name + '.'); break; }
      case 'reset': if (confirm('Send ' + st().players[pid].name + ' back to the start and clear their maps?')) run('resetPlayer', { pid: pid }); break;
      case 'newgame': {
        var ns = readStart('newStart'); if (ns === false) break;
        var ne = readStart('newEnd'); if (ne === false) break;
        if (ne && ne < (ns || Date.now()) + 3600000) { toast('The end time needs to be at least an hour after the start.', 'bad'); break; }
        if (confirm((ns ? 'Start a new game with sign-ups open until ' + startWhen(ns) + '?' : 'Start a new game now?') + (ne ? ' It ends ' + startWhen(ne) + '.' : '') + ' Everyone goes back to the start.')) run('newGame', { theme: ($('newTheme') && $('newTheme').value) || st().themeId, startsAt: ns, endsAt: ne }, ns ? 'Sign-ups are open.' : 'New game started.');
        break;
      }
      case 'cleargame': {
        var f = btn.dataset.f || 'new', cs = readStart(f + 'Start'); if (cs === false) break;
        var ce = readStart(f + 'End'); if (ce === false) break;
        if (ce && ce < (cs || Date.now()) + 3600000) { toast('The end time needs to be at least an hour after the start.', 'bad'); break; }
        var cur = st(), n = cur.order.length;
        if (confirm('Clear the old game?' + (n ? ' All ' + n + (n === 1 ? ' player comes' : ' players come') + ' off the board,' : '') + ' the thread starts empty and sign-ups open' + (cs ? ' until ' + startWhen(cs) : '') + '.' + (ce ? ' The new game ends ' + startWhen(ce) + '.' : '') + ' You can undo it until someone joins.'))
          run('clearGame', { theme: ($(f + 'Theme') && $(f + 'Theme').value) || cur.themeId, startsAt: cs, endsAt: ce }, 'The old game is cleared. Sign-ups are open.');
        break;
      }
      case 'reschedule': { var rs = readStart('startEdit'); if (!rs) { if (rs === null) toast('Pick a start time first.', 'bad'); break; } run('schedule', { startsAt: rs }, 'Start time saved.'); break; }
      case 'setend': { var se = readStart('endEdit'); if (!se) { if (se === null) toast('Pick an end time first.', 'bad'); break; } run('setEnd', { endsAt: se }, 'End time saved.'); break; }
      case 'finale': closeHost(); openFinale(); break;
      case 'clearend': run('setEnd', { endsAt: null }, 'End time cleared.'); break;
      case 'visits-refresh': btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); setTimeout(function () { btn.classList.remove('spin'); }, 700); fillVisits(true); break;
      case 'visits-more': visitsAll = true; fillVisits(); break;
      case 'stats-refresh': btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); setTimeout(function () { btn.classList.remove('spin'); }, 700); fillStats(true); break;
      case 'stats-more': statsMore[btn.dataset.k] = true; renderStats(); break;
      case 'clearplayers': if (confirm('Take all ' + st().order.length + ' sign-ups off the board? They can join again whenever sign-ups are open.')) run('clearPlayers', {}, 'Sign-ups cleared.'); break;
      case 'clearstart': if (confirm('Cancel the countdown? Sign-ups stay open and nobody can roll until you set a new start time.')) run('schedule', { startsAt: null }, 'Countdown canceled. Sign-ups are still open.'); break;
      case 'endnow': if (confirm('End the game now? The standings freeze and nobody can roll again.')) run('endNow', {}, 'The game is over.'); break;
      case 'startnow': if (confirm('Start the game now? Everyone can roll right away.')) run('startNow', {}, 'The game has started.'); break;
      case 'letin': run('letIn', { id: btn.dataset.id }, 'Let in.'); break;
      case 'dismiss': run('dismiss', { id: btn.dataset.id }); break;
      case 'unallow': if (confirm('Remove their access? They will see the invite-only screen.')) run('removeAccess', { id: btn.dataset.id }); break;
      case 'loadboard': {
        var b = designerBoard(), probs = E.checkBoard(b), cur = st();
        if (probs.length) { toast(probs[0], 'bad'); break; }
        if (cur.status === 'signup') {
          // Still in sign-ups: same start and end, new board.
          var keepStart = cur.startsAt && cur.startsAt > Date.now() + 60000 ? cur.startsAt : null;
          if (confirm('Move this game onto "' + (b.title || 'the designer board') + '"? Sign-ups stay and everyone picks a route again.')) run('newGame', { theme: cur.themeId, board: b, startsAt: keepStart, endsAt: cur.endsAt, signup: true }, 'The game is on the designer board now.');
          break;
        }
        var ls = readStart('newStart'); if (ls === false) break;
        var le = readStart('newEnd'); if (le === false) break;
        if (confirm('Start the next game on "' + (b.title || 'the designer board') + '"' + (ls ? ' with sign-ups open until ' + startWhen(ls) : '') + '?')) run('newGame', { theme: ($('newTheme') && $('newTheme').value) || cur.themeId, board: b, startsAt: ls, endsAt: le && le > (ls || Date.now()) + 3600000 ? le : null });
        break;
      }
      case 'removeplayer': if (confirm('Take ' + st().players[pid].name + ' off the sign-up list? They can join again while sign-ups are open.')) run('removePlayer', { pid: pid }, 'Removed.'); break;
      case 'clearroute': if (confirm('Clear ' + st().players[pid].name + '\'s route so they can pick again?')) run('clearRoute', { pid: pid }, 'Route cleared.'); break;
    }
  }

  // ---- events --------------------------------------------------------------------------------
  // Who reacted: press and hold a reaction (phones), right-click it (computers), or just tap it
  // when you can't react yourself. Hover still shows the names as a tooltip on computers.
  var rxHeldAt = 0, rxHoldTimer = null;
  function closeRxWho() { var w = $('rxWho'); if (w) w.remove(); }
  function openRxWho(chip) {
    closeRxWho();
    var s = st(), t = theme(), id = chip.dataset.rx, r = X.rxCounts((s.reactions || {})[chip.dataset.ev]);
    var who = (r[id] || []).filter(function (q) { return E.reactor(s, q); }); if (!who.length) return;
    var me0 = rxMe(), box = document.createElement('div'); box.id = 'rxWho'; box.className = 'rx-who'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Who reacted');
    box.innerHTML = '<div class="rw-head">' + X.rxIcon(id, t) + '<b>' + esc(X.rxLabel(id, t)) + '</b><span>' + who.length + '</span></div><ul>' +
      who.map(function (q) { var p = E.reactor(s, q); return '<li>' + avatarHtml(p, 'rw-ava') + '<span>' + esc(p.name) + (me0 && q === me0.id ? ' <i>(you)</i>' : isAdmin(s, q) ? ' <i>(admin)</i>' : '') + '</span></li>'; }).join('') + '</ul>';
    document.body.appendChild(box);
    var b = chip.getBoundingClientRect(), vw = document.documentElement.clientWidth, w = box.offsetWidth, h = box.offsetHeight;
    var left = Math.max(8, Math.min(vw - w - 8, b.left + b.width / 2 - w / 2)), top = b.top - h - 8;
    if (top < 8) top = b.bottom + 8;
    box.style.left = left + 'px'; box.style.top = top + 'px';
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (x) {}
  }
  // Secret reactions: press and hold Strong (the hummingbird) or Fire (MSploit) in the picker, or right-click them on a computer.
  // The click that ends the hold is swallowed so it doesn't also send Strong or land on what's under the closed picker.
  var SECRET_RX = { strong: 'hbird', fire: 'msploit' }, SECRET_MSG = { hbird: 'You found the secret hummingbird!', msploit: 'You found the secret MSploit!' };
  var secretAt = 0, secretSwallow = false;
  function secretRx(btn) {
    if (Date.now() - secretAt < 1200) return;
    secretAt = rxHeldAt = Date.now(); secretSwallow = true; clearTimeout(rxHoldTimer);
    var ev = btn.dataset.ev, rx = SECRET_RX[btn.dataset.rx], mine = rxMe(), had = mine && ((X.rxCounts((st().reactions || {})[ev])[rx] || []).indexOf(mine.id) >= 0);
    if (navigator.vibrate) try { navigator.vibrate([10, 40, 10]); } catch (x) {}
    doReact({ dataset: { rx: rx, ev: ev } });
    if (mine && !had) toast(SECRET_MSG[rx], '');
  }
  function bindRxWho() {
    var start = null;
    document.addEventListener('pointerdown', function (e) {
      secretSwallow = false;
      var sb = e.target.closest && e.target.closest('#rxPop button[data-rx="strong"], #rxPop button[data-rx="fire"]');
      if (sb) { start = { x: e.clientX, y: e.clientY }; clearTimeout(rxHoldTimer); rxHoldTimer = setTimeout(function () { secretRx(sb); }, 550); return; }
      var chip = e.target.closest && e.target.closest('.rx-chip'); if (!chip) return;
      start = { x: e.clientX, y: e.clientY };
      clearTimeout(rxHoldTimer);
      rxHoldTimer = setTimeout(function () { rxHeldAt = Date.now(); openRxWho(chip); }, 420);
    });
    window.addEventListener('click', function (e) { if (secretSwallow) { secretSwallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
    var cancel = function () { clearTimeout(rxHoldTimer); start = null; };
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('pointermove', function (e) { if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 12) cancel(); });
    document.addEventListener('contextmenu', function (e) { var sb = e.target.closest && e.target.closest('#rxPop button[data-rx="strong"], #rxPop button[data-rx="fire"]'); if (sb) { e.preventDefault(); secretRx(sb); return; } var chip = e.target.closest && e.target.closest('.rx-chip'); if (!chip) return; e.preventDefault(); rxHeldAt = Date.now(); openRxWho(chip); });
    window.addEventListener('scroll', closeRxWho, true);
    window.addEventListener('resize', closeRxWho);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRxWho(); });
  }
  function bind() {
    bindRxWho();
    document.addEventListener('click', function (e) {
      var rpa = e.target.closest('[data-replay]'); if (rpa && replayEmbedOK() && openReplay(rpa)) { e.preventDefault(); return; }
      var rdb = e.target.closest('[data-rd]'); if (rdb) { closeReplay(); return; }
      if (e.target.id === 'replayDock') { closeReplay(); return; }
      var c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy); return; }
      var rxa = e.target.closest('[data-rxadd]'); if (rxa) { $('rxPop').hidden ? openRx(rxa) : closeRx(); return; }
      if (Date.now() - rxHeldAt < 700) { rxHeldAt = 0; if (e.target.closest('.rx-chip')) { e.preventDefault(); return; } }
      if (!e.target.closest('#rxWho')) closeRxWho();
      var rxb = e.target.closest('[data-rx]'); if (rxb) { if (rxb.getAttribute('aria-disabled') === 'true') { openRxWho(rxb); return; } doReact(rxb); return; }
      if (!e.target.closest('#rxPop')) closeRx();
      var shb = e.target.closest('[data-share]'); if (shb) { var sev = st().events.filter(function (x) { return x.id === Number(shb.dataset.share); })[0]; if (sev) openShare(sev); return; }
      var egg = e.target.closest('.board-svg .egg'); if (egg && !animating) { doEgg(egg); return; }
      var bdg = e.target.closest('[data-badges]'); if (bdg) { e.preventDefault(); openBadges(bdg.getAttribute('data-badges')); return; }
      if (e.target.closest('#rollBtn') || e.target.closest('#mRoll')) { doRoll(); return; }
      if (e.target.closest('#finaleBtn') || e.target.closest('#mFinale')) { openFinale(); return; }
      if (e.target.closest('#remBtn')) { $('remPop').hidden ? openRem() : closeRem(); return; }
      if (!e.target.closest('#remPop')) closeRem();
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
      if (e.target.closest('#meTools')) { openHost(); return; }
      if (e.target.closest('#meHost')) { openHost('today'); jumpToVisits(); return; }
      if (e.target.closest('#meStats')) { openStats(); return; }
      if (e.target.closest('#checkAgain')) { location.reload(); return; }
      var stb = e.target.closest('.st[data-pid]'); if (stb) { openPlayer(stb.dataset.pid); return; }
      if (e.target.closest('[data-hall]')) { openHall(); return; }
      var hr = e.target.closest('[data-hallrm]'); if (hr) {
        var hid = hr.getAttribute('data-hallrm'), hg = (store.hall || []).filter(function (h) { return h.id === hid; })[0];
        if (hg && confirm('Remove "' + hg.title + '" (ended ' + new Date(hg.endedAt).toLocaleDateString() + ') from the hall of fame? Its wins and podiums come off the all-time table too. This can\'t be undone.'))
          store.act('hallRemove', { id: hid }).then(function () { track('host-hall-remove'); toast('Removed from the hall of fame.', 'good'); openHall(); }, fail);
        return;
      }
      var pb = e.target.closest('[data-pcard-board]'); if (pb) { closeModal(); pingToken(pb.getAttribute('data-pcard-board')); return; }
      var pl = e.target.closest('.board-svg .pile-badge, .board-svg .tok[data-pile]'); if (pl) { openPile(pl.getAttribute('data-pile')); return; }
      var ppid = e.target.closest('[data-pile-pid]'); if (ppid) { closeModal(); openPlayer(ppid.getAttribute('data-pile-pid')); return; }
      var tk = e.target.closest('.board-svg .tok');
      if (tk) { var tp = st().players[tk.getAttribute('data-pid')], tid = tp && tp.route && tp.pos >= 0 && st().board.routes[tp.route][tp.pos]; if (tid) { openSpace(tid, tk); return; } }
      var sp = e.target.closest('.board-svg .sp'); if (sp) { openSpace(sp.dataset.id, sp); return; }
      if (e.target.closest('#spacePop [data-close]') || (!e.target.closest('#spacePop') && !$('spacePop').hidden)) closeSpace();
      var fb = e.target.closest('[data-feed]'); if (fb) { feedMode = fb.dataset.feed; renderFeed(); return; }
      var hb = e.target.closest('#hostBody [data-h], #statsBody [data-h]'); if (hb) { hostAction(hb); return; }
      if (e.target.closest('#statsBack')) { closeStats(); return; }
      if (e.target.closest('#hostStats')) { openStats(); return; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if ($('replayDock') && !$('replayDock').hidden) { closeReplay(); return; } if (!$('rxPop').hidden) { closeRx(); return; } if (!$('remPop').hidden) closeRem(); else if (!$('modal').hidden) closeModal(); else if (!$('spacePop').hidden) closeSpace(); else if (!$('hostDrawer').hidden) closeHost(); else if (statsOpen()) closeStats(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.board-svg .sp')) { e.preventDefault(); openSpace(e.target.closest('.sp').dataset.id, e.target.closest('.sp')); }
    });
    document.addEventListener('input', function (e) { if (e.target.id === 'pSearch') { playerQuery = e.target.value; filterPlayers(); } });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'playAs') { store.act('playAs', { pid: t.value }); return; }
      if (t.dataset.cardfor && t.value) {
        var pid = t.dataset.cardfor, cid = t.value, card = st().cards.filter(function (c) { return c.id === cid; })[0];
        if (!confirm('Give ' + st().players[pid].name + ' the card "' + (card ? card.title : cid) + '"? It takes effect right away.')) { t.value = ''; return; }
        store.act('card', { pid: pid, card: cid }).then(function () { toast('Gave ' + st().players[pid].name + ' a card.', 'good'); }, fail); return; }
      if (t.dataset.set) {
        if (st().status === 'running' && !confirm('Change this rule for everyone in the game that is running now?')) { t.checked = !t.checked; return; }
        var patch = {}; patch[t.dataset.set] = t.checked; store.act('settings', { patch: patch }).catch(fail); return; }
      if (t.id === 'hostOutBox') { var out = t.checked; store.act('hostPlays', { plays: !out }).then(function () { toast(out ? 'You\'re hosting only. The Admin badge is on.' : 'You can join this game again.', 'good'); }, function (e) { t.checked = !out; fail(e); }); return; }
      if (t.name === 'sumode') {
        if (t.value === 'closed' && !confirm('Close sign-ups? Nobody new can join until the game starts.')) { renderHost(); return; }
        store.act('signups', { closed: t.value === 'closed' }).then(function () { toast(t.value === 'closed' ? 'Sign-ups are closed until the game starts.' : 'Sign-ups are open.', 'good'); }, fail); return; }
      if (t.dataset.post) { var on = t.checked; store.act('discordPosts', { kind: t.dataset.post, on: on }).then(function () { track('host-discord-' + t.dataset.post + (on ? '-on' : '-off')); toast(on ? 'That post is on.' : 'That post is off.', 'good'); }, function (e) { t.checked = !on; fail(e); }); return; }
      if (t.name === 'acmode') {
        if (!confirm(t.value === 'open' ? 'Let anyone who signs in with Discord play?' : 'Go back to invite-only? Only people you let in can play.')) { renderHost(); return; }
        store.act('accessMode', { mode: t.value }).then(function () { track('host-access-' + t.value); toast(t.value === 'open' ? 'Anyone who signs in can play now.' : 'Invite-only again.', 'good'); }, fail); return; }
      if (t.id === 'remindSel') { store.act('settings', { patch: { remindHour: t.value === '' ? null : Number(t.value) } }).then(function () { track('host-reminder-' + (t.value || 'off')); toast(t.value === '' ? 'Roll reminders are off.' : 'Roll reminders go out at ' + hourLabel(t.value) + '.', 'good'); }, fail); return; }
      if (t.id === 'themeSel') { store.act('theme', { theme: t.value }).then(function () { track('host-theme-' + t.value); renderBoard(true); }, fail); }
    });
    $('howBtn').onclick = openHow;
    $('playlistBtn').onclick = openPlaylist;
    $('hostBtn').onclick = function () {
      var b = this; b.classList.remove('laugh'); void b.offsetWidth; b.classList.add('laugh');
      setTimeout(function () { b.classList.remove('laugh'); }, 900);
      openHost();
    };
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
      if (cam) { cam.tgt = [0, 0, 1000]; cam.set([0, 0, 1000]); }
      w.classList.toggle('zoomed', on); this.setAttribute('aria-pressed', on ? 'true' : 'false'); this.textContent = on ? 'Zoom out' : 'Zoom in';
      if (on) centerOnMe();
    };
    // Sound effects: a quiet switch at the bottom of How to play.
    document.addEventListener('change', function (e) { if (e.target.id !== 'soundChk') return; muted = !e.target.checked; try { localStorage.setItem('cg.muted', muted ? '1' : '0'); } catch (x) {} if (!muted) sfx.hop(); });
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
  function theme0(t) { return t.hero === 'taco' ? 'The game starts in' : null; }
  function renderGate(g) {
    if (window.CGSkipOwner && g.user) window.CGSkipOwner(g.user.id);
    // The game picker stays neutral; each game's own theme shows once you pick it.
    // Before a game is picked, the page is neutral: a d4, a plain font and no game name.
    var t = g.kind !== 'choose' && g.theme && C.themes[g.theme] || null;
    var die = R.dieIcon().replace('<svg ', '<svg class="gate-die" aria-hidden="true" ');
    if (!t) { document.body.classList.add('neutral'); $('gameTitle').textContent = "Beat Saber Board Game"; document.title = "Beat Saber Board Game"; }
    track('gate-' + g.kind);
    document.addEventListener('click', function (e) { if (e.target.closest('a[href*="/auth/login"]')) track('sign-in'); });
    document.body.classList.add('gated');
    if (t) { document.body.setAttribute('data-theme', t.look || t.id); $('gameTitle').textContent = t.title; document.title = t.title; }
    R.setFavicon(t);
    if (t) $('brandCrow').innerHTML = R.hero(0, 0, 1, t);
    else { $('brandCrow').setAttribute('viewBox', '0 0 100 100'); $('brandCrow').innerHTML = R.dieIcon().replace(/^<svg[^>]*>|<\/svg>$/g, ''); }
    if (g.kind !== 'choose') renderClanSwitch(g);
    var msg = {
      closed: ['Coming soon', "The game isn't open yet. Watch your clan Discord for the start."],
      down: ["Can't reach the game", 'The game server is not answering right now. Try again in a minute.'],
      signin: ['Private game', "Sign in with Discord to see your clan's game."],
      pending: ["You're on the list", 'Thanks' + (g.user ? ', ' + g.user.name : '') + '. The host has your request and will let you in. Check back soon.'],
      choose: ['Pick your game', "You're in more than one clan server, so there's a game for each. You can switch any time with the icons at the top of the page."]
    }[g.kind];
    var html = '<section class="gate-card">' + (t ? '<svg class="gate-crow" viewBox="-36 -42 72 80" aria-hidden="true">' + R.hero(0, 0, 1, t) + '</svg>' : die) +
      '<h2>' + esc(msg[0]) + '</h2><p>' + esc(msg[1]) + '</p>' + (t && g.startsAt && g.startsAt > Date.now() ? countdownHtml(g.startsAt, theme0(t)) : '') + '<div class="row" style="justify-content:center">';
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

  // Footer links to the other tools say which game the click came from (GoatCounter reads utm_campaign).
  function toolLinks(s) {
    var camp = s.kind === 'choose' ? 'picker' : s.clan || (s.mode === 'demo' ? 'demo' : s.kind === 'signin' ? 'signed-out' : 'site');
    Array.prototype.forEach.call(document.querySelectorAll('#footTools a[data-tool]'), function (a) {
      try { var u = new URL(a.href); u.searchParams.set('utm_campaign', camp); a.href = u.toString(); } catch (e) {}
      a.addEventListener('click', function () { track('tool-' + a.dataset.tool + '-' + camp); });
    });
  }

  window.CGStore.detect().then(function (s) {
    store = s;
    toolLinks(s);
    if (store.mode === 'gate') { renderGate(store); throw 'gated'; }
    return store.load();
  }).then(function () {
    bind();
    if (store.mode === 'live') track(store.canPlay ? (store.me ? 'visit-player' : 'visit-not-joined') : 'visit-waiting-list');
    // Re-send this device's notification subscription once per visit so every clan has a working copy.
    if (store.mode === 'live' && store.vapidKey && pushSupported() && Notification.permission === 'granted') currentSub().then(refreshZone);
    store.on(function (x) {
      if (animating) return;
      if (x && x.action === 'online') { renderStandings(); placeTokens(); return; }
      renderAll(); checkNewClears();
    });
    renderAll();
    if (/^#host$/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); if (store.isHost) openHost(); }
    if (/^#stats$/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); if (store.isHost) openStats(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
      var d = e.data || {};
      if (d.type !== 'open' && d.type !== 'open-host') return;
      // A notification from the other clan's game opens that game.
      var c = ''; try { c = new URL(d.url || '', location.href).searchParams.get('clan') || ''; } catch (x) {}
      if (c && store.clan && c !== store.clan) { location.href = d.url; return; }
      if ((d.type === 'open-host' || /#host$/.test(d.url || '')) && store.isHost) openHost();
      store.poll && store.poll();
    });
    // Check for news every 20 seconds while someone is using the page. A tab left open and untouched
    // slows down (every 40 seconds after 5 minutes, every 2 minutes after 30) so idle tabs don't eat the
    // server's daily allowance; any tap, key or scroll brings it back to full speed.
    if (store.mode === 'live') {
      var lastUse = Date.now(), lastPoll = Date.now();
      var used = function () { var idle = Date.now() - lastUse; lastUse = Date.now(); if (idle > 300000 && Date.now() - lastPoll > 20000 && document.visibilityState === 'visible') { lastPoll = Date.now(); store.poll(); } };
      ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) { window.addEventListener(ev, used, { passive: true, capture: true }); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') used(); });
      setInterval(function () {
        if (animating || document.visibilityState !== 'visible') return;
        var idle = Date.now() - lastUse, gap = idle < 300000 ? 0 : idle < 1800000 ? 40000 : 120000;
        if (Date.now() - lastPoll < gap - 1000) return;
        lastPoll = Date.now(); store.poll();
      }, 20000);
    }
    setInterval(tickClock, 30000);
    setInterval(tickCountdowns, 1000);
    var seen = false; try { seen = localStorage.getItem('cg.seenHow') === '1'; localStorage.setItem('cg.seenHow', '1'); } catch (e) {}
    var prevSeen = readSeen(), pend = pendingReveals();
    if (!seen) openHow();
    else if (!maybeFinale()) {
      if (pend.length) { animating = true; revealScores(pend).then(function () { animating = false; renderAll(); maybeAway(prevSeen); }); }
      else maybeAway(prevSeen);
    }
    setInterval(applyDusk, 30000);
    scuffleSoon();
    writeSeen();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') writeSeen(); });
    window.addEventListener('pagehide', writeSeen);
  }).catch(function (e) {
    if (e === 'gated') return;
    console.error(e);
    $('boardWrap').innerHTML = '<p class="err" style="padding:20px">The game could not load: ' + esc(e.message) + '</p>';
  });
})();
