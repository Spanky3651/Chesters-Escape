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
    if (p.avatar) return '<img class="' + cls + '" style="--c:' + col + '" src="' + esc(p.avatar) + '" alt="" onerror="this.outerHTML=\'<span class=&quot;' + cls + '&quot; style=&quot;--c:' + col + '&quot;>' + esc(R.initials(p.name)) + '</span>\'">';
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
    }
    placeTokens();
    markMine();
    previewMoves();
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
  function renderHeader() {
    var s = st(), t = theme();
    document.body.setAttribute('data-theme', t.id);
    $('gameTitle').textContent = t.title;
    $('brandCrow').innerHTML = R.chester(0, 0, 1, t.id === 'christmas' ? 'santa' : 'none');
    $('dayNum').textContent = s.status === 'finished' ? 'Game over' : 'Day ' + s.day;
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
    if (store.mode === 'demo') { el.textContent = 'The host starts each new day'; return; }
    var at = E.nextCutoff(s.settings), left = at - Date.now();
    if (left < 0) left = 0;
    var h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    var when = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el.textContent = 'Next day in ' + (h ? h + 'h ' : '') + m + 'm (' + when + ')';
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
      (stats.length ? '<div class="me-stats">' + stats.join('') + '</div>' : '');
    el.style.setProperty('--c', col);
  }

  // ---- turn panel --------------------------------------------------------------
  function renderTurn() {
    var p = me(), el = $('turnPanel'), s = st(), t = theme();
    if (!p) { el.innerHTML = '<h2>Your turn</h2><p class="empty">' + (store.mode === 'live' && !store.canPlay ? 'Once the host lets you in, you can join and get a token on the board.' : 'Join the game to get a token on the board.') + '</p>'; return; }
    if (!p.route) {
      el.innerHTML = '<h2>Pick your route</h2><p class="why">You can\'t change it later.</p><div class="routes">' +
        ['longer', 'riskier'].map(function (r) {
          var info = s.board.routeInfo[r];
          return '<button type="button" class="route-card' + (r === 'riskier' ? ' risk' : '') + '" data-route="' + r + '"><b>' + esc(info.name) + '</b><span>' + esc(info.blurb) + '</span></button>';
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
  function rollTitle(c) { return { task: 'Play your map', rolled: 'Rolled for today', skip: 'Turn lost', 'not-running': 'Waiting', finished: 'Escaped' }[c.code] || 'Not yet'; }
  function rollWhy(c, p) {
    if (c.code === 'task') return 'Your next roll unlocks once BeatLeader shows a pass on ' + (p.tasks.length > 1 ? 'each of these maps' : 'this map') + '. Any difficulty, any modifiers.';
    if (c.code === 'rolled') return store.mode === 'demo' ? 'Come back tomorrow. In the demo, use Start the next day.' : 'Your next roll opens when the day turns over.';
    if (c.code === 'skip') return p.skip ? 'You sit this one out. ' + p.skip + ' more after today.' : 'You sit this one out. You can roll again tomorrow.';
    return c.reason;
  }
  function taskHtml(p, task) {
    var s = st(), why = '';
    if (task.card) { var cd = E.cardById(s, task.card); why = (cd ? cd.title : 'Card') + ' card'; }
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
  var ICON = { roll: '🎲', land: '📍', task: '🎵', card: '🃏', move: '➡️', skip: '⏸️', start: '↩️', warp: '🌀', cleared: '✅', claim: '📨', 'claim-rejected': '❌', 'lost-turn': '💤', escaped: '🎉', route: '🧭', join: '👋', shield: '🛡️', 'shield-used': '🛡️', again: '🎲', overshoot: '🎯', 'host-move': '🧹', 'host-reset': '🧹', reshuffle: '🔀' };
  function evText(e) {
    var s = st(), t = theme(), sp = e.space ? s.board.spaces[e.space] : null, card = e.card ? E.cardById(s, e.card) : null;
    switch (e.t) {
      case 'roll': return { html: (e.bonus ? 'Bonus roll: ' : 'Rolled a ') + '<b>' + e.n + '</b>' };
      case 'land': return null;
      case 'task': return { html: 'Play <b>!bsr ' + esc(e.bsr.join(' or ')) + '</b>' + (sp && sp.kind ? ' (' + esc(t.kinds[sp.kind].title) + ')' : card ? ' (' + esc(card.title) + ')' : '') };
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
      if (feedMode === 'me' && e.pid !== store.me) continue;
      var x = evText(e); if (!x) continue;
      var p = s.players[e.pid];
      html += '<li><span class="ic" aria-hidden="true">' + (ICON[e.t] || '•') + '</span><span>' +
        (feedMode === 'all' && p ? '<span class="who">' + esc(p.name) + '</span> ' : '') +
        '<span class="' + (x.cls || '') + '">' + x.html + '</span> <span class="when">day ' + e.day + '</span></span></li>';
      shown++;
    }
    list.innerHTML = html || '<li class="empty" style="display:block">' + (feedMode === 'me' ? 'Your moves show up here.' : 'Nothing has happened yet.') + '</li>';
    Array.prototype.forEach.call(document.querySelectorAll('.seg [data-feed]'), function (b) { b.setAttribute('aria-selected', b.dataset.feed === feedMode ? 'true' : 'false'); });
  }

  // ---- standings -----------------------------------------------------------------
  function renderStandings() {
    var s = st();
    var ids = s.order.filter(function (pid) { return s.players[pid].route; });
    ids.sort(function (a, b) {
      var A = s.players[a], B = s.players[b];
      if (A.finished || B.finished) return (A.finished ? A.finished.place : 999) - (B.finished ? B.finished.place : 999);
      return E.remaining(s, A) - E.remaining(s, B);
    });
    var html = '<h2>Standings</h2><ol class="st-list">';
    ids.forEach(function (pid, i) {
      var p = s.players[pid], col = R.playerColor(s, pid), pct = Math.round(E.progress(s, p) * 100);
      html += '<li><button type="button" class="st' + (pid === store.me ? ' me' : '') + (p.finished ? ' done' : '') + '" data-pid="' + esc(pid) + '" style="--c:' + col + '">' +
        '<span class="place">' + (p.finished ? ordinal(p.finished.place) : i + 1) + '</span>' + avatarHtml(p, 'ava') +
        '<span style="min-width:0"><span class="nm">' + esc(p.name) + '</span> <span class="chip ' + (p.route === 'riskier' ? 'risk' : 'long') + '">' + (p.route === 'riskier' ? 'Riskier' : 'Longer') + '</span>' +
        '<span class="sub" style="display:block">' + esc(statusLine(p)) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span></span></button></li>';
    });
    $('standings').innerHTML = html + '</ol>';
  }
  function statusLine(p) {
    var s = st();
    if (p.finished) return 'Escaped on day ' + p.finished.day;
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

  function renderAll() {
    if (!st()) return;
    renderHeader(); renderBoard(); renderMe(); renderTurn(); renderFeed(); renderStandings(); renderBar();
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
      $('cardBack').innerHTML = '<div><svg class="crow" viewBox="-36 -42 72 80" aria-hidden="true">' + R.chester(0, 0, 1, t.id === 'christmas' ? 'santa' : 'none') + '</svg><p>' + esc(t.card.back) + '</p></div>';
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
      (s.settings.chainEffects ? '<li>If a card or event moves you onto another space, that space counts too, so one card can set off another.</li>' : '<li>If a card or event moves you onto a map, play it. A card or event never chains into another card.</li>') +
      '<li>First one to the ' + esc(t.goal) + ' wins. Everyone else keeps playing for their place.</li></ol>' +
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
    var t = theme(), xmas = t.id === 'christmas';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="' + t.palette.ground + '"/><stop offset="1" stop-color="' + t.palette.ground2 + '"/></radialGradient></defs>' +
      '<rect width="256" height="256" fill="url(#g)"/>' + R.chester(128, 120, 3.2, xmas ? 'santa' : 'none') + '</svg>';
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
    var fam = theme().id === 'christmas' ? 'Mountains+of+Christmas:wght@700' : 'Grenze+Gotisch:wght@700';
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
      var words = t.words.results.replace('{n}', s.day).split(' '), l1 = words.slice(0, 2).join(' '), l2 = words.slice(2).join(' ');
      var bfill = t.id === 'christmas' ? '#d7263d' : '#3fd04a', bstroke = t.id === 'christmas' ? '#fff' : '#3b2208';
      var banner = '<g transform="translate(40,40) rotate(-7)" font-family="' + esc(t.font) + '" font-weight="700" fill="' + bfill + '" stroke="' + bstroke + '" stroke-width="14" paint-order="stroke">' +
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
  function openResults() {
    track('host-results-image');
    modal('Day ' + st().day + ' results', '<p class="lede">The board with everyone\'s token, ready to post in the game channel.</p><div id="resBox"><p class="why">Drawing the board</p></div>', function (body) {
      makeResults().then(function (blob) {
        var url = URL.createObjectURL(blob), name = theme().title.replace(/[^A-Za-z0-9]+/g, '-') + '-day-' + st().day + '.png';
        body.querySelector('#resBox').innerHTML = '<img class="result-img" src="' + url + '" alt="Board with every player\'s position">' +
          '<div class="row" style="margin-top:12px"><a class="btn" href="' + url + '" download="' + esc(name) + '">Download image</a>' +
          (store.mode === 'live' && store.isHost ? '<button type="button" class="btn ghost" id="resPost">Post to Discord</button>' : '') + '</div>';
        var post = body.querySelector('#resPost');
        if (post) post.addEventListener('click', function () {
          post.disabled = true; post.textContent = 'Posting';
          store.postResults(blob, '**' + theme().words.results.replace('{n}', st().day) + '!!**').then(function () { track('host-results-posted'); post.textContent = 'Posted'; toast('Posted to Discord.', 'good'); }, function (e) { post.disabled = false; post.textContent = 'Post to Discord'; fail(e); });
        });
      }, function (e) { body.querySelector('#resBox').innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    });
  }

  // ---- host tools ------------------------------------------------------------------------------
  function openHost() { $('hostDrawer').hidden = false; $('scrim').hidden = false; renderHost(); $('hostX').focus(); }
  function closeHost() { $('hostDrawer').hidden = true; $('scrim').hidden = true; $('hostBtn').focus(); }
  function renderHost() {
    var s = st(), demo = store.mode === 'demo', html = '';
    var claims = [];
    s.order.forEach(function (pid) { s.players[pid].claims.forEach(function (c) { claims.push({ p: s.players[pid], c: c }); }); });
    html += '<section class="hsec"><h3>Day ' + s.day + '</h3><p>' + (demo ? 'Starting the next day lets every bot clear maps and roll.' : 'The day turns over by itself at the cutoff. Use this only to fix a missed rollover.') + '</p><div class="row">' +
      '<button type="button" class="btn small" data-h="advance">Start the next day</button>' + (demo ? '<button type="button" class="btn small ghost" data-h="simulate">Skip ahead 3 days</button>' : '') +
      '<button type="button" class="btn small ghost" data-h="results">Make the results image</button></div></section>';
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
        return '<div class="claim row" style="justify-content:space-between"><span><b>' + esc(names[id] || 'Tester') + '</b> <span class="why">' + esc(id) + '</span></span><button type="button" class="btn small danger" data-h="unallow" data-id="' + esc(id) + '">Remove</button></div>';
      }).join('');
      html += '</section>';
    }
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
      '<label class="check"><input type="checkbox" data-set="chainEffects"' + (s.settings.chainEffects ? ' checked' : '') + '> <span>Cards and events chain (a card can move you onto another card or event)</span></label>' +
      '<label class="check"><input type="checkbox" data-set="oneRollPerDay"' + (s.settings.oneRollPerDay ? ' checked' : '') + '> <span>One roll per day</span></label></section>';
    html += '<section class="hsec"><h3>Theme and board</h3><div class="row"><label>Theme <select id="themeSel">' + Object.keys(C.themes).map(function (k) { return '<option value="' + k + '"' + (k === s.themeId ? ' selected' : '') + '>' + esc(C.themes[k].name) + '</option>'; }).join('') + '</select></label></div>' +
      '<p style="margin-top:10px">Changing the theme keeps everyone where they are. Starting a new game puts everyone back at the start.</p><div class="row">' +
      '<button type="button" class="btn small ghost" data-h="newgame">Start a new game</button>' + (designerBoard() ? '<button type="button" class="btn small ghost" data-h="loadboard">Start a new game on the designer board</button>' : '') + '</div></section>';
    $('hostBody').innerHTML = html;
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
      case 'newgame': if (confirm('Start a new game? Everyone goes back to the start.')) run('newGame', { theme: st().themeId }, 'New game started.'); break;
      case 'letin': run('letIn', { id: btn.dataset.id }, 'Let in.'); break;
      case 'dismiss': run('dismiss', { id: btn.dataset.id }); break;
      case 'unallow': if (confirm('Remove their access? They will see the invite-only screen.')) run('removeAccess', { id: btn.dataset.id }); break;
      case 'loadboard': {
        var b = designerBoard(), probs = E.checkBoard(b);
        if (probs.length) { toast(probs[0], 'bad'); break; }
        if (confirm('Start a new game on "' + (b.title || 'the designer board') + '"?')) run('newGame', { theme: st().themeId, board: b }, 'New game started on your board.');
        break;
      }
    }
  }

  // ---- events --------------------------------------------------------------------------------
  function bind() {
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]'); if (c) { copy(c.dataset.copy); return; }
      if (e.target.closest('#rollBtn') || e.target.closest('#mRoll')) { doRoll(); return; }
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
    var t = C.themes.cemetery;
    track('gate-' + g.kind);
    document.addEventListener('click', function (e) { if (e.target.closest('a[href*="/auth/login"]')) track('sign-in'); });
    document.body.classList.add('gated');
    $('brandCrow').innerHTML = R.chester(0, 0, 1, 'none');
    var msg = {
      closed: ['Coming soon', "Chester's Escape isn't open yet. Watch the clan Discord for the start."],
      down: ["Can't reach the game", 'The game server is not answering right now. Try again in a minute.'],
      signin: ['Private test', 'Sign in with Discord to watch the game. The host lets players in while it is being tested.'],
      pending: ["You're on the list", 'Thanks' + (g.user ? ', ' + g.user.name : '') + '. The host has your request and will let you in. Check back soon.']
    }[g.kind];
    var html = '<section class="gate-card"><svg class="gate-crow" viewBox="-36 -42 72 80" aria-hidden="true">' + R.chester(0, 0, 1, 'none') + '</svg>' +
      '<h2>' + esc(msg[0]) + '</h2><p>' + esc(msg[1]) + '</p><div class="row" style="justify-content:center">';
    if (g.kind === 'signin') html += '<a class="btn" href="' + esc(g.loginUrl()) + '">Sign in with Discord</a>';
    if (g.kind === 'pending') html += '<button type="button" class="btn ghost" id="gateRetry">Check again</button><button type="button" class="btn link" id="gateOut">Sign out</button>';
    if (g.kind === 'down') html += '<button type="button" class="btn ghost" id="gateRetry">Try again</button>';
    html += '</div></section>';
    document.querySelector('main.layout').outerHTML = '<main class="gate">' + html + '</main>';
    var r = $('gateRetry'); if (r) r.onclick = function () { location.reload(); };
    var o = $('gateOut'); if (o) o.onclick = function () { g.logout(); };
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
    if (store.mode === 'live') { setInterval(function () { if (!animating && document.visibilityState === 'visible') store.poll(); }, 20000); }
    setInterval(tickClock, 30000);
    var seen = false; try { seen = localStorage.getItem('cg.seenHow') === '1'; localStorage.setItem('cg.seenHow', '1'); } catch (e) {}
    if (!seen) openHow();
  }).catch(function (e) {
    if (e === 'gated') return;
    console.error(e);
    $('boardWrap').innerHTML = '<p class="err" style="padding:20px">The game could not load: ' + esc(e.message) + '</p>';
  });
})();
