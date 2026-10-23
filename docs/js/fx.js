/*
 * Chester's Escape - the show: board camera, landing effects, score grades, badges,
 * token flair, rivals and share cards. Pure helpers; app.js decides when to use them.
 */
(function (root) {
  'use strict';
  var E = root.CGEngine, R = root.CGRender, esc = R.esc;
  var NS = 'http://www.w3.org/2000/svg';
  function still() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function cssq(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function star(R) {
    var o = '';
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * .45 : R; o += (i ? 'L' : 'M') + (Math.cos(a) * r).toFixed(1) + ' ' + (Math.sin(a) * r).toFixed(1); }
    return o + 'z';
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---- camera: zooms the board's viewBox toward a point and eases back ------------------------
  function Camera(svg) { this.svg = svg; this.cur = [0, 0, 1000]; this.tgt = [0, 0, 1000]; this.raf = 0; this.waiters = []; }
  Camera.prototype.focus = function (xy, zoom) {
    if (!xy) return this.settled();
    var w = 1000 / (zoom || 1.7);
    this.tgt = [clamp(xy.x - w / 2, 0, 1000 - w), clamp(xy.y - w / 2, 0, 1000 - w), w];
    return this.run();
  };
  Camera.prototype.home = function () { this.tgt = [0, 0, 1000]; return this.run(); };
  Camera.prototype.zoomed = function () { return this.cur[2] < 999; };
  Camera.prototype.set = function (v) { this.cur = v.slice(); this.svg.setAttribute('viewBox', v[0].toFixed(2) + ' ' + v[1].toFixed(2) + ' ' + v[2].toFixed(2) + ' ' + v[2].toFixed(2)); };
  Camera.prototype.settled = function () { var self = this; return this.raf ? new Promise(function (r) { self.waiters.push(r); }) : Promise.resolve(); };
  Camera.prototype.run = function () {
    var self = this;
    if (still()) { this.set(this.tgt); return Promise.resolve(); }
    if (!this.raf) {
      var last = performance.now();
      var step = function (t) {
        var dt = Math.min(64, t - last); last = t;
        var k = 1 - Math.exp(-dt / 150), done = true, n = [];
        for (var i = 0; i < 3; i++) { var d = self.tgt[i] - self.cur[i]; n.push(Math.abs(d) < .4 ? self.tgt[i] : self.cur[i] + d * k); if (Math.abs(d) >= .4) done = false; }
        self.set(n);
        if (done || !self.svg.isConnected) { self.raf = 0; var w = self.waiters; self.waiters = []; w.forEach(function (f) { f(); }); return; }
        self.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
    return this.settled();
  };

  // ---- effects drawn on the board (SVG units) -------------------------------------------------
  function layer(svg) {
    var l = svg.querySelector('.fxl');
    if (!l) { l = document.createElementNS(NS, 'g'); l.setAttribute('class', 'fxl'); var tok = svg.querySelector('.tokens'); tok.parentNode.insertBefore(l, tok.nextSibling); }
    return l;
  }
  function add(svg, html, ms) {
    var l = layer(svg); l.insertAdjacentHTML('beforeend', html);
    var el = l.lastElementChild; setTimeout(function () { if (el) el.remove(); }, ms || 1400);
    return el;
  }
  var fx = {
    pop: function (svg, xy, text, cls, ms) {
      // Long lines wrap onto two or three rows and stay inside the board.
      var words = String(text).split(' '), rows = [''], cap = 26;
      words.forEach(function (w) { var r = rows[rows.length - 1]; if (r && (r + ' ' + w).length > cap) rows.push(w); else rows[rows.length - 1] = r ? r + ' ' + w : w; });
      var wide = Math.max.apply(null, rows.map(function (r) { return r.length; })) * 11.5, x = clamp(xy.x, wide / 2 + 8, 1000 - wide / 2 - 8), lh = 26;
      var body = rows.length === 1 ? esc(text) : rows.map(function (r, i) { return '<tspan x="0" dy="' + (i ? lh : -(rows.length - 1) * lh) + '">' + esc(r) + '</tspan>'; }).join('');
      add(svg, '<g transform="translate(' + x.toFixed(1) + ',' + (xy.y - 34) + ')"><text class="fx-pop ' + (cls || '') + '" text-anchor="middle"' + (ms ? ' style="animation-duration:' + (ms / 1000) + 's"' : '') + '>' + body + '</text></g>', ms || 1500);
    },
    ghost: function (svg, xy, color) { add(svg, '<circle class="fx-ghost" cx="' + xy.x + '" cy="' + xy.y + '" r="22" fill="' + color + '"/>', 700); },
    flash: function (svg, xy, color) {
      add(svg, '<g transform="translate(' + xy.x + ',' + xy.y + ')"><circle class="fx-flash" r="30" stroke="' + color + '"/><circle class="fx-flash f2" r="30" stroke="' + color + '"/></g>', 1000);
    },
    splash: function (svg, xy, color) {
      var o = '<g transform="translate(' + xy.x + ',' + xy.y + ')"><circle class="fx-flash" r="26" stroke="' + color + '"/>';
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2, d = 34 + (i % 3) * 12;
        o += '<circle class="fx-drop" r="' + (3 + i % 3) + '" fill="' + color + '" style="--dx:' + (Math.cos(a) * d).toFixed(1) + 'px;--dy:' + (Math.sin(a) * d - 22).toFixed(1) + 'px;animation-delay:' + (i % 4) * 30 + 'ms"/>';
      }
      add(svg, o + '</g>', 1100);
    },
    swirl: function (svg, xy, color) {
      add(svg, '<g transform="translate(' + xy.x + ',' + xy.y + ')"><circle class="fx-swirl" r="34" stroke="' + color + '"/><circle class="fx-swirl s2" r="22" stroke="' + color + '"/></g>', 1100);
    },
    puff: function (svg, xy) {
      var o = '<g transform="translate(' + xy.x + ',' + xy.y + ')">';
      for (var i = 0; i < 7; i++) { var a = (i / 7) * Math.PI * 2; o += '<circle class="fx-puff" r="' + (10 + i % 3 * 4) + '" style="--dx:' + (Math.cos(a) * 30).toFixed(1) + 'px;--dy:' + (Math.sin(a) * 24 - 10).toFixed(1) + 'px"/>'; }
      add(svg, o + '</g>', 1000);
    },
    zzz: function (svg, xy) {
      add(svg, '<g transform="translate(' + (xy.x + 18) + ',' + (xy.y - 24) + ')"><text class="fx-z">z</text><text class="fx-z z2" x="12" y="-10">z</text><text class="fx-z z3" x="24" y="-22">Z</text></g>', 1900);
    },
    shield: function (svg, xy) { add(svg, '<g transform="translate(' + xy.x + ',' + xy.y + ')"><circle class="fx-shield" r="34"/></g>', 1100); },
    burst: function (svg, xy, color) {
      var o = '<g transform="translate(' + xy.x + ',' + xy.y + ')">';
      for (var i = 0; i < 10; i++) { var a = (i / 10) * Math.PI * 2; o += '<path class="fx-ray" d="M0,-6 L3,0 L0,6 L-3,0Z" fill="' + color + '" style="--dx:' + (Math.cos(a) * 46).toFixed(1) + 'px;--dy:' + (Math.sin(a) * 46).toFixed(1) + 'px;--r:' + Math.round(a * 57.3 + 90) + 'deg"/>'; }
      add(svg, o + '</g>', 900);
    },
    // Two tokens sharing a space scuffle: wind up, knock heads, spring back. A is the attacker; on a
    // 'knock' B gets sent flying for a moment and sees stars. o.crown names a token whose crown pops off.
    scuffle: function (svg, A, B, o) {
      o = o || {};
      var ga = svg.querySelector('.tok[data-pid="' + cssq(A.pid) + '"]'), gb = svg.querySelector('.tok[data-pid="' + cssq(B.pid) + '"]');
      if (still() || !ga || !gb) return wait(0);
      var dx = B.x - A.x, dy = B.y - A.y, d = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / d, uy = dy / d, k = o.small ? .75 : 1;
      var knock = o.kind === 'knock', dur = knock ? 1250 : 900, toks = [ga, gb];
      function go(g, sx, sy, cls) {
        g.classList.remove('scuf', 'scuf-hit', 'crown-pop');
        g.style.setProperty('--ux', (sx * k).toFixed(3)); g.style.setProperty('--uy', (sy * k).toFixed(3));
        g.style.setProperty('--s', Math.abs(sx) < .3 ? 0 : sx > 0 ? 1 : -1);
        void g.getBoundingClientRect(); g.classList.add(cls);
      }
      go(ga, ux, uy, 'scuf'); go(gb, -ux, -uy, knock ? 'scuf-hit' : 'scuf');
      if (o.crown === A.pid) ga.classList.add('crown-pop');
      if (o.crown === B.pid) gb.classList.add('crown-pop');
      setTimeout(function () {
        var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, h = '<g transform="translate(' + mx.toFixed(1) + ',' + my.toFixed(1) + ')">';
        for (var i = 0; i < 4; i++) { var a = (i / 4) * Math.PI * 2 + .4; h += '<circle class="fx-dust" r="' + (4 + i % 2 * 2) + '" cy="6" style="--dx:' + (Math.cos(a) * 16).toFixed(1) + 'px;--dy:' + (Math.sin(a) * 8 + 4).toFixed(1) + 'px"/>'; }
        for (var j = 0; j < 6; j++) h += '<g transform="rotate(' + (j * 60 + 30) + ')"><path class="fx-clash" d="M0 -8V-19"/></g>';
        h += '<path class="fx-star" d="' + star(7) + '" style="--dx:' + (-12 - Math.random() * 6).toFixed(1) + 'px;--dy:-26px"/><path class="fx-star" d="' + star(6) + '" style="--dx:' + (11 + Math.random() * 6).toFixed(1) + 'px;--dy:-30px;animation-delay:60ms"/>';
        add(svg, h + '</g>', 900);
      }, 340);
      if (knock) setTimeout(function () {
        var h = '<g transform="translate(' + B.x.toFixed(1) + ',' + (B.y - (B.r || 15) - 9).toFixed(1) + ')"><g class="fx-orbit-w">';
        for (var i = 0; i < 3; i++) h += '<path class="fx-orbit" d="' + star(4.8) + '" style="animation-delay:' + (-i * .3).toFixed(1) + 's"/>';
        add(svg, h + '</g></g>', 1500);
      }, 520);
      setTimeout(function () { toks.forEach(function (g) { g.classList.remove('scuf', 'scuf-hit', 'crown-pop'); }); }, (o.crown ? Math.max(dur, 1150) : dur) + 40);
      return wait(dur + 60);
    },
    // A song card that flips up out of the space: cover, then the song name.
    coverPop: function (svg, xy, m, label) {
      var w = 168, h = 214, x = clamp(xy.x - w / 2, 8, 1000 - w - 8), y = clamp(xy.y - h - 40, 8, 1000 - h - 8);
      if (y + h > xy.y - 30 && xy.y - h - 40 < 8) y = clamp(xy.y + 44, 8, 1000 - h - 8);
      var name = m && m.name ? m.name : '';
      var o = '<g class="fx-cover" transform="translate(' + x + ',' + y + ')" style="--ox:' + (xy.x - x - w / 2).toFixed(0) + 'px;--oy:' + (xy.y - y - h / 2).toFixed(0) + 'px"><g class="fx-cover-in">' +
        '<rect width="' + w + '" height="' + h + '" rx="14" fill="#101010" stroke="#fff" stroke-width="3"/>' +
        '<text x="' + w / 2 + '" y="22" text-anchor="middle" class="fx-cover-k">' + esc(label || 'Play this map') + '</text>' +
        (m && m.cover ? '<image href="' + esc(m.cover) + '" x="14" y="32" width="' + (w - 28) + '" height="' + (w - 28) + '" preserveAspectRatio="xMidYMid slice"/>' : '<rect x="14" y="32" width="' + (w - 28) + '" height="' + (w - 28) + '" rx="8" fill="#222"/>') +
        '<text x="' + w / 2 + '" y="' + (h - 16) + '" text-anchor="middle" class="fx-cover-n">' + esc(name.length > 19 ? name.slice(0, 18) + '…' : name) + '</text></g></g>';
      add(svg, o, 1900);
      return wait(still() ? 300 : 1500);
    },
    // Pre-launch: light the spaces up along both routes, one after another.
    lightUp: function (svg, ids, total) {
      ids.forEach(function (id, i) {
        setTimeout(function () { var g = svg.querySelector('.sp[data-id="' + id + '"]'); if (g) g.classList.add('lit'); }, total * i / Math.max(1, ids.length));
      });
    },
    unlight: function (svg) { Array.prototype.forEach.call(svg.querySelectorAll('.sp.lit'), function (g) { g.classList.remove('lit'); }); },
    // The escape: the hero leaves the board (Chester flies off, Taco hops away) with a sparkle trail.
    escape: function (svg, xy, theme) {
      if (still()) return wait(200);
      var flier = theme.hero !== 'taco';
      var l = layer(svg);
      l.insertAdjacentHTML('beforeend', '<g class="fx-exit" transform="translate(' + xy.x + ',' + xy.y + ')"><circle class="fx-gate" r="40"/><circle class="fx-gate g2" r="40"/></g>');
      var gate = l.lastElementChild;
      l.insertAdjacentHTML('beforeend', '<g class="fx-hero"><g class="fx-hero-in">' + R.hero(0, 0, 1.25, theme) + '</g></g>');
      var hero = l.lastElementChild;
      var start = performance.now(), dur = 2300;
      var tx = xy.x > 500 ? -120 : 1120, ty = flier ? -140 : xy.y;
      if (!flier) { tx = xy.x > 500 ? xy.x + 420 : xy.x - 420; }
      var lastSpark = 0;
      return new Promise(function (resolve) {
        function frame(t) {
          var k = Math.min(1, (t - start) / dur), e = k < .2 ? 0 : (k - .2) / .8;
          var x, y, s;
          if (flier) {
            var ee = e * e * (3 - 2 * e);
            x = xy.x + (tx - xy.x) * ee; y = xy.y + (ty - xy.y) * ee - Math.sin(ee * Math.PI) * 120;
            s = k < .2 ? k / .2 : 1 + e * .3;
          } else {
            var hops = 4, ph = (e * hops) % 1;
            x = xy.x + (tx - xy.x) * e; y = xy.y - Math.abs(Math.sin(ph * Math.PI)) * 90 * (1 - e * .4);
            s = k < .2 ? k / .2 : 1;
          }
          hero.setAttribute('transform', 'translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') scale(' + s.toFixed(3) + ')' + (flier ? ' rotate(' + (Math.sin(t / 90) * 8).toFixed(1) + ')' : ''));
          if (t - lastSpark > 55 && k > .2) { lastSpark = t; add(svg, '<circle class="fx-spark" cx="' + x.toFixed(0) + '" cy="' + (y + 20).toFixed(0) + '" r="' + (3 + Math.random() * 4).toFixed(1) + '"/>', 900); }
          if (k < 1) requestAnimationFrame(frame); else { hero.remove(); gate.remove(); resolve(); }
        }
        requestAnimationFrame(frame);
      });
    }
  };

  // ---- grades (Beat Saber's own rank letters) --------------------------------------------------
  function grade(acc) {
    if (acc == null || isNaN(acc)) return null;
    var p = acc * 100;
    var g = p >= 90 ? 'SS' : p >= 80 ? 'S' : p >= 65 ? 'A' : p >= 50 ? 'B' : p >= 35 ? 'C' : p >= 20 ? 'D' : 'E';
    return { g: g, cls: 'g-' + g };
  }

  // ---- badges: earned from the game thread, no rule changes ----------------------------------
  var BADGES = [
    { id: 'first', icon: '🥇', name: 'First Out', desc: 'First player to escape' },
    { id: 'risk', icon: '🎲', name: 'Risk Taker', desc: 'Escaped on the riskier route' },
    { id: 'golden', icon: '✨', name: 'Golden Run', desc: 'Cleared a map at 95% or better' },
    { id: 'streak', icon: '🔥', name: 'On Fire', desc: 'Cleared a map 3 days in a row' },
    { id: 'comeback', icon: '📈', name: 'Comeback', desc: 'Climbed from last place into the top half' },
    { id: 'phoenix', icon: '🔁', name: 'Back From the Start', desc: 'Sent back to the start and still escaped' },
    { id: 'shield', icon: '🛡️', name: 'Untouchable', desc: 'A setback bounced off your protection' },
    { id: 'fours', icon: '🎯', name: 'Hot Hand', desc: 'Rolled a 4 three times in a row' },
    { id: 'current', icon: '🌊', name: 'Rode the Current', desc: 'Got carried ahead by the board' },
    { id: 'crowd', icon: '📣', name: 'Crowd Favorite', desc: 'Got 10 reactions on your moments' }
  ];
  var BADGE_BY = {}; BADGES.forEach(function (b) { BADGE_BY[b.id] = b; });
  var badgeCache = { key: '', val: null };
  function badgesFor(s) {
    var key = s.id + '|' + s.seq + '|' + s.events.length;
    if (badgeCache.key === key) return badgeCache.val;
    var out = {}, b = s.board;
    s.order.forEach(function (pid) { out[pid] = {}; });
    var give = function (pid, id) { if (out[pid]) out[pid][id] = 1; };
    var clearDays = {}, runs = {}, sent = {}, wasLastT = {}, gotT = {};
    // what older moments (trimmed from the log in a big game) already earned
    s.order.forEach(function (pid) {
      var t = E.tallyOf && E.tallyOf(s, pid); if (!t) return;
      ['golden', 'fours', 'shield', 'current'].forEach(function (k) { if (t.flags[k]) give(pid, k); });
      if (t.flags.sent) sent[pid] = 1;
      if (t.flags.wasLast) wasLastT[pid] = 1;
      runs[pid] = t.run4 || 0; gotT[pid] = t.rx || 0;
      Object.keys(t.days || {}).forEach(function (d) { (clearDays[pid] = clearDays[pid] || {})[d] = 1; });
    });
    s.events.forEach(function (e) {
      var p = s.players[e.pid]; if (!p) return;
      if (e.t === 'cleared') {
        (clearDays[e.pid] = clearDays[e.pid] || {})[e.day] = 1;
        if (e.proof && e.proof.acc >= 0.95) give(e.pid, 'golden');
      }
      if (e.t === 'roll') { runs[e.pid] = e.n === 4 ? (runs[e.pid] || 0) + 1 : 0; if (runs[e.pid] >= 3) give(e.pid, 'fours'); }
      if (e.t === 'shield-used') give(e.pid, 'shield');
      if (e.t === 'start') sent[e.pid] = 1;
      if (e.t === 'warp' && p.route && b.routes[p.route]) { var r = b.routes[p.route]; if (r.indexOf(e.to) > r.indexOf(e.space)) give(e.pid, 'current'); }
    });
    // On Fire: a cleared map on three game days in a row.
    Object.keys(clearDays).forEach(function (pid) {
      var d = clearDays[pid];
      if (Object.keys(d).some(function (k) { k = Number(k); return d[k + 1] && d[k + 2]; })) give(pid, 'streak');
    });
    s.order.forEach(function (pid) {
      var p = s.players[pid];
      if (p.finished) { if (p.finished.place === 1) give(pid, 'first'); if (p.route === 'riskier') give(pid, 'risk'); if (sent[pid]) give(pid, 'phoenix'); }
    });
    // Reactions on your moments.
    var got = Object.assign({}, gotT);
    Object.keys(s.reactions || {}).forEach(function (id) {
      var ev = null; for (var i = s.events.length - 1; i >= 0; i--) if (s.events[i].id === Number(id)) { ev = s.events[i]; break; }
      if (!ev || !ev.pid) return;
      var r = s.reactions[id]; Object.keys(r).forEach(function (em) { got[ev.pid] = (got[ev.pid] || 0) + r[em].filter(function (q) { return q !== ev.pid; }).length; });
    });
    Object.keys(got).forEach(function (pid) { if (got[pid] >= 10) give(pid, 'crowd'); });
    // Comeback: dead last at the start of some day (with 4+ racing), top half now.
    var racers = s.order.filter(function (pid) { return s.players[pid].route; });
    if (racers.length >= 4) {
      var wasLast = Object.assign({}, wasLastT);
      s.events.forEach(function (e) {
        if (e.t !== 'day') return;
        var pos = E.positionsBefore(s, e.id), left = {};
        racers.forEach(function (pid) { var p = s.players[pid], len = (b.routes[p.route] || []).length; if (pos[pid] != null) left[pid] = len - 1 - pos[pid]; });
        var ids = Object.keys(left); if (ids.length < 4) return;
        var max = Math.max.apply(null, ids.map(function (k) { return left[k]; }));
        var at = ids.filter(function (k) { return left[k] === max; });
        if (at.length === 1 && max > 0) wasLast[at[0]] = 1;
      });
      var rank = E.ranking(s), half = Math.ceil(racers.length / 2);
      rank.forEach(function (r) { if (wasLast[r.pid] && (r.escaped || r.place <= half)) give(r.pid, 'comeback'); });
    }
    var val = {};
    Object.keys(out).forEach(function (pid) { val[pid] = BADGES.filter(function (x) { return out[pid][x.id]; }); });
    badgeCache = { key: key, val: val };
    return val;
  }

  // ---- token flair: a crown for the leader ----
  function flair(s) {
    var o = { crown: null };
    if (s.status !== 'running') return o;
    var rank = E.ranking(s).filter(function (r) { return !r.escaped; });
    if (rank.length >= 2 && rank[0].left < rank[1].left && s.players[rank[0].pid].pos >= 0) o.crown = rank[0].pid;
    return o;
  }

  // ---- rivals: who is just ahead and just behind you ---------------------------------------------
  function rivals(s, pid) {
    var me = s.players[pid]; if (!me || !me.route || me.finished || s.status !== 'running') return null;
    var mine = E.remaining(s, me), ahead = null, behind = null, tied = [];
    s.order.forEach(function (q) {
      var p = s.players[q]; if (q === pid || !p.route || p.finished) return;
      var l = E.remaining(s, p);
      if (l < mine && (!ahead || l > ahead.left)) ahead = { pid: q, left: l, n: mine - l };
      else if (l > mine && (!behind || l < behind.left)) behind = { pid: q, left: l, n: l - mine };
      else if (l === mine) tied.push(q);
    });
    return { ahead: ahead, behind: behind, tied: tied };
  }

  // ---- share cards: a 1200x630 picture of one moment, made for Discord ---------------------
  function loadImg(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = URL.createObjectURL(b); });
    }).catch(function () { return null; });
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, text, max, size, font) { var s = size; g.font = font.replace('{s}', s); while (s > 20 && g.measureText(text).width > max) { s -= 2; g.font = font.replace('{s}', s); } return s; }
  function heroImg(theme) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -46 80 88">' + R.hero(0, 0, 1, theme) + '</svg>';
    return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  }
  // o: { theme, kicker, headline, sub, foot, player: {name, avatar, color}, cover, grade, badges: [icons] }
  function shareCard(o) {
    var t = o.theme, pal = t.palette, disp = t.font, ui = "'Atkinson Hyperlegible', system-ui, sans-serif";
    var fonts = document.fonts ? Promise.all([document.fonts.load('700 80px ' + disp), document.fonts.load('700 30px ' + ui)]).catch(function () {}) : Promise.resolve();
    return Promise.all([fonts, loadImg(o.player && o.player.avatar), loadImg(o.cover), heroImg(t)]).then(function (r) {
      var av = r[1], cov = r[2], hero = r[3];
      var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
      var g = c.getContext('2d');
      var bg = g.createLinearGradient(0, 0, 1200, 630); bg.addColorStop(0, '#000'); bg.addColorStop(1, pal.ground2); g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);
      var glow = g.createRadialGradient(900, 260, 20, 900, 260, 520); glow.addColorStop(0, pal.accent + '66'); glow.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = glow; g.fillRect(0, 0, 1200, 630);
      // diagonal rays behind the right side
      g.save(); g.translate(900, 270); g.globalAlpha = .08; g.fillStyle = pal.accent;
      for (var i = 0; i < 16; i++) { g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, 0); g.lineTo(700, -40); g.lineTo(700, 40); g.closePath(); g.fill(); }
      g.restore();
      g.strokeStyle = pal.accent; g.lineWidth = 8; rr(g, 14, 14, 1172, 602, 26); g.stroke();
      var L = 64;
      if (hero) g.drawImage(hero, L, 52, 70, 77);
      g.fillStyle = '#fff'; g.font = '700 30px ' + disp; g.fillText(t.title, L + 86, 102);
      g.fillStyle = pal.accent; g.font = '700 26px ' + ui; g.fillText(String(o.kicker || '').toUpperCase(), L, 190);
      g.fillStyle = '#fff'; var hs = fit(g, o.headline, o.cover || o.grade ? 640 : 1060, 104, '700 {s}px ' + disp); g.fillText(o.headline, L, 190 + hs);
      var y = 190 + hs + 56;
      if (o.sub) { g.fillStyle = '#d8d8d8'; fit(g, o.sub, o.cover ? 640 : 1060, 34, '700 {s}px ' + ui); g.fillText(o.sub, L, y); y += 50; }
      if (o.badges && o.badges.length) { g.font = '40px ' + ui; g.fillText(o.badges.slice(0, 8).join(' '), L, y + 10); }
      // player chip
      if (o.player) {
        var py = 520, col = o.player.color || pal.accent;
        g.fillStyle = col; g.beginPath(); g.arc(L + 34, py, 37, 0, Math.PI * 2); g.fill();
        g.save(); g.beginPath(); g.arc(L + 34, py, 32, 0, Math.PI * 2); g.clip();
        if (av) g.drawImage(av, L + 2, py - 32, 64, 64); else { g.fillStyle = '#1a1d18'; g.fillRect(L, py - 34, 70, 70); g.fillStyle = '#fff'; g.font = '700 26px ' + ui; g.textAlign = 'center'; g.fillText(R.initials(o.player.name), L + 34, py + 9); g.textAlign = 'left'; }
        g.restore();
        g.fillStyle = '#fff'; g.font = '700 34px ' + ui; g.fillText(o.player.name, L + 88, py + 4);
        if (o.foot) { g.fillStyle = '#bdbdbd'; g.font = '700 22px ' + ui; g.fillText(o.foot, L + 88, py + 36); }
      }
      // right side: song cover with the grade stamped on it, or a big grade alone
      if (cov || o.grade) {
        var cx = 780, cy = 120, cs = 340;
        g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 40; g.fillStyle = '#111'; rr(g, cx, cy, cs, cs, 22); g.fill(); g.restore();
        if (cov) { g.save(); rr(g, cx, cy, cs, cs, 22); g.clip(); g.drawImage(cov, cx, cy, cs, cs); g.restore(); }
        g.lineWidth = 6; g.strokeStyle = '#fff'; rr(g, cx, cy, cs, cs, 22); g.stroke();
        if (o.grade) {
          var gc = { SS: '#ffd34d', S: '#f0f0f0', A: '#5fd068', B: '#5ab0ff', C: '#c58bff', D: '#ff8a5a', E: '#ff5a6e' }[o.grade] || '#fff';
          g.save(); g.translate(cx + cs - 20, cy + cs - 10); g.rotate(-0.18);
          g.fillStyle = 'rgba(0,0,0,.82)'; g.beginPath(); g.arc(0, 0, 82, 0, Math.PI * 2); g.fill();
          g.lineWidth = 8; g.strokeStyle = gc; g.stroke();
          g.fillStyle = gc; g.font = '800 ' + (o.grade.length > 1 ? 78 : 96) + 'px ' + ui; g.textAlign = 'center'; g.fillText(o.grade, 0, o.grade.length > 1 ? 27 : 33);
          g.restore();
        }
      }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 20px ' + ui; g.textAlign = 'right'; g.fillText('Beat Saber Board Game', 1150, 590); g.textAlign = 'left';
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error('Could not draw the picture.')); }, 'image/png'); });
    });
  }

  // ---- easter eggs: a few lines for the hero, and props that react to taps ---------------------
  var LINES = {
    chester: ['Caw! I am not lost. I am exploring.', 'Have you tried Slower Song?', 'Do not tell the gravekeeper I am out here.', 'One more map, then bed. Probably.', 'I saw a 4 once. It was beautiful.',
      'I only collect shiny things. And SS ranks.', 'My wings are basically sabers. Basically.', 'Left, right, duck the wall. I practice every night.', 'Is that a bomb or a black note? Asking for a friend.',
      'Feathers do not sweat. They glisten.', 'Caw caw. That means GG.', 'I tried Expert+. Expert+ tried me back.', 'The ghosts here have great accuracy. All that free time.',
      'Please do not roll a 1. Please do not roll a 1.', 'Nobody tells you how hard sabers are with wings.', 'I am 87% crow and 13% vibes.', 'If the gravekeeper asks, I was never here.',
      'Stream maps are just fast flapping.', 'I would dodge that wall but I am very small.', 'You call it a miss. I call it a feather check.'],
    taco: ['Extra cheese, please!', 'I am not a snack. I am a contestant.', 'Has anyone seen my hat?', 'Hot sauce gives me +2 speed.', 'Crunchy shell, soft heart.',
      'I put the TAC in tactical.', 'Lettuce be friends.', 'Never fold under pressure. Unless you are a taco.', 'My shell cracked on that last stream map.',
      'I would full combo this, but my toppings keep falling.', 'Guac is extra. So is my energy.', 'Taco Tuesday is every day if you believe.', 'Salsa dancing counts as cardio, right?',
      'Nacho average contestant.', 'Who rolled a 4? Me. I did.', 'If I lose, I am the snack.', 'Spicy maps only. Mild is for spectators.', 'I am 90% shell and 10% swing.',
      'Hold the onions. Hold the walls too.', 'Shredded lettuce, shredded accuracy.'],
    grave: ['Boo!', 'Shh, I am resting.', 'Five more minutes...'],
    tree: ['*bats scatter*', 'Creak...'],
    turkey: ['GOBBLE!', 'Not today, chef.', 'Gobble gobble?'],
    scarecrow: ['*crows scatter*', 'Hay there.'],
    pumpkin: ['*grins*', 'Pie? Never heard of it.'],
    snowman: ['Do you want to build a... never mind.', 'Brr!', '*hat flies off*'],
    present: ['Not until the 25th!', '*rattle rattle*']
  };
  // Lines about this game right now: where you are, who leads, what time it is.
  function eggContext(s, meId, theme, now) {
    var out = [], taco = theme.hero === 'taco', goal = theme.goal || 'exit', me = meId && s.players[meId], d = new Date(now || Date.now()), h = d.getHours();
    if (s.status === 'signup') out.push('The game has not started and you are already poking me?');
    if (me && me.finished) out.push('You escaped and came back to poke me? Respect.');
    else if (me && me.tasks && me.tasks.length) out.push('You have a map waiting. Go play it, I will guard your spot.');
    else if (me && me.route && s.status === 'running') { var left = E.remaining(s, me); if (left > 0) out.push(left + ' spaces to the ' + goal + '. You got this.'); }
    if (s.status === 'running') {
      var lead = E.ranking(s).filter(function (r) { return !r.escaped; })[0];
      if (lead && lead.pid !== meId && s.players[lead.pid]) out.push(s.players[lead.pid].name + ' is out in front. Rude.');
      out.push('Day ' + s.day + '. Still ' + (taco ? 'crunchy' : 'flapping') + '.');
    }
    if (h < 5) out.push('It is ' + ((h % 12) || 12) + ':' + ('0' + d.getMinutes()).slice(-2) + ' AM. Go to bed. After one more map.');
    else if (h < 9) out.push('Early session? Warm up those wrists.');
    return out;
  }
  var DIZZY = ['Whoa, stop spinning me!', '@_@ Which way is the exit?', 'I see three d4s now.'];
  var LEGEND = ['Legendary line: you are my favorite player.', 'Legendary line: the next roll is a 4. Trust me.', 'Legendary line: I have seen an SS on every map. In my dreams.'];
  function eggLine(kind, theme, n) {
    var list = LINES[kind === 'hero' ? (theme.hero === 'taco' ? 'taco' : 'chester') : kind] || LINES.grave;
    return list[n % list.length];
  }

  // ---- the game's reactions --------------------------------------------------------------------
  // Drawn as small pictures (no emoji font differences between phones and PCs).
  var BLACK = "'Arial Black', 'Atkinson Hyperlegible', Arial, sans-serif";
  function txt(x, y, size, fill, stroke, sw, t, extra) { return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="' + BLACK + '" font-weight="900" font-size="' + size + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '" paint-order="stroke" stroke-linejoin="round"' : '') + (extra || '') + '>' + t + '</text>'; }
  // A Beat Saber note: dark bevel, bright red or blue face, white arrow (or a dot) near the top.
  var uid = 0;
  function note(x, y, w, h, c, mark, r) {
    var C = c === 'r' ? ['#6e0c18', '#e3263b', '#ff8a95'] : ['#0a2a66', '#2a78f2', '#93c4ff'], f = function (n) { return (+n).toFixed(1); };
    r = r || 3.4;
    var o = '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(w) + '" height="' + f(h) + '" rx="' + f(r) + '" fill="' + C[0] + '" stroke="#050507" stroke-width="1.5"/>' +
      '<rect x="' + f(x + 1.5) + '" y="' + f(y + 1.5) + '" width="' + f(w - 3) + '" height="' + f(h - 3) + '" rx="' + f(Math.max(1, r - 1.3)) + '" fill="' + C[1] + '"/>' +
      '<rect x="' + f(x + 1.5) + '" y="' + f(y + 1.5) + '" width="' + f(w - 3) + '" height="' + f((h - 3) * .4) + '" rx="' + f(Math.max(1, r - 1.3)) + '" fill="' + C[2] + '" opacity=".35"/>';
    var cx = x + w / 2, ay = y + 2.6, aw = w * .27, ah = h * .17;
    if (mark === 'arrow') o += '<path d="M' + f(cx - aw) + ' ' + f(ay) + 'H' + f(cx + aw) + 'L' + f(cx) + ' ' + f(ay + ah) + 'z" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round" opacity=".45" transform="translate(0 .3)"/><path d="M' + f(cx - aw) + ' ' + f(ay) + 'H' + f(cx + aw) + 'L' + f(cx) + ' ' + f(ay + ah) + 'z" fill="#fff" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/>';
    if (mark === 'dot') o += '<circle cx="' + f(cx) + '" cy="' + f(ay + 1.8) + '" r="1.7" fill="#fff"/>';
    return o;
  }
  var RX = {
    ss: { label: 'SS rank', svg: function () { return '<g class="a-ss"><circle class="a-ring" cx="16" cy="16" r="12.6" fill="#121212" stroke="#ffd34d" stroke-width="2.6"/>' + txt(16, 20.6, 12.5, '#ffd34d', '', 0, 'SS') + '</g><path class="a-twinkle" d="M27 2l1 2.6 2.6 1-2.6 1L27 9.2 26 6.6 23.4 5.6 26 4.6z" fill="#fff"/>'; } },
    fire: { label: 'Fire', svg: function () {
      return '<g class="a-flame"><path d="M16 30.5c-6.6 0-10.6-4.3-10.6-10 0-4.6 2.7-7.6 5-10.4.4 2.8 1.6 4.4 3.2 5.2C13 10 15.4 5.5 18.8 2c.4 4.8 3 7.6 5.3 10.6 1.5 2 2.4 4.3 2.4 7.4 0 5.7-4 10.5-10.5 10.5z" fill="#ff4d1f" stroke="#5a1200" stroke-width="1.4" stroke-linejoin="round"/></g>' +
        '<g class="a-flame2"><path d="M16 30.5c-3.9 0-6.3-2.5-6.3-5.8 0-2.8 1.7-4.6 3.2-6.4.3 1.6 1 2.6 2 3.1-.4-3 1.2-5.6 3.3-7.6.3 3 1.9 4.6 3.2 6.4.9 1.2 1.4 2.6 1.4 4.5 0 3.3-2.4 5.8-6.8 5.8z" fill="#ffb02e"/></g>' +
        '<path class="a-core" d="M16 30.5c-2 0-3.2-1.2-3.2-2.9 0-1.6 1.2-2.6 2.2-3.8.6 1.4 1.6 2 2.6 2.4.6.4 1.5 1.1 1.5 1.7 0 1.6-1.2 2.6-3.1 2.6z" fill="#fff3b8"/>' +
        '<circle class="a-ember" cx="8.5" cy="12" r="1.3" fill="#ffb02e"/><circle class="a-ember e2" cx="24.5" cy="10" r="1.1" fill="#ffd36b"/><circle class="a-ember e3" cx="20" cy="5" r=".9" fill="#ff7a3c"/>';
    } },
    letsgo: { label: "Let's go!", svg: function () {
      return '<g class="a-bar1"><rect x="2.5" y="3" width="27" height="12" rx="3" fill="#2bbd5e" stroke="#0a3a1b" stroke-width="1.8"/><rect x="4.4" y="4.6" width="23.2" height="3.6" rx="1.8" fill="#9af5b8" opacity=".55"/>' + txt(16, 12.6, 8.4, '#fff', '#0a3a1b', 2.4, 'LET\u2019S') + '</g>' +
        '<g class="a-bar2"><rect x="4.5" y="16.5" width="23" height="13" rx="3" fill="#1c9f6d" stroke="#0a3a1b" stroke-width="1.8"/><rect x="6.2" y="18" width="19.6" height="3.4" rx="1.7" fill="#8debc6" opacity=".45"/>' +
        txt(10.6, 27, 10, '#fff', '#0a3a1b', 2.4, 'G') + '<g class="a-goflame" transform="translate(12.3 17.2) scale(.3)"><path d="M16 30.5c-6.6 0-10.6-4.3-10.6-10 0-4.6 2.7-7.6 5-10.4.4 2.8 1.6 4.4 3.2 5.2C13 10 15.4 5.5 18.8 2c.4 4.8 3 7.6 5.3 10.6 1.5 2 2.4 4.3 2.4 7.4 0 5.7-4 10.5-10.5 10.5z" fill="#ff5a1f" stroke="#0a3a1b" stroke-width="3"/><path d="M16 30.5c-3.9 0-6.3-2.5-6.3-5.8 0-2.8 1.7-4.6 3.2-6.4.3 1.6 1 2.6 2 3.1-.4-3 1.2-5.6 3.3-7.6.3 3 1.9 4.6 3.2 6.4.9 1.2 1.4 2.6 1.4 4.5 0 3.3-2.4 5.8-6.8 5.8z" fill="#ffd23f"/></g>' + txt(23.6, 27, 10, '#fff', '#0a3a1b', 2.4, '!') + '</g>';
    } },
    love: { label: 'Love it!', svg: function () {
      var H = function (cls, x, y, s) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + s + ')"><path class="a-heart ' + cls + '" d="M0 1.2C0-.6 2.2-1 2.6.6 3-1 5.2-.6 5.2 1.2 5.2 3 2.6 4.6 2.6 4.6S0 3 0 1.2z" fill="#ff4d7a" stroke="#5a0018" stroke-width=".8"/></g>'; };
      return '<path d="M9.6 8.4L10.3 2.4l3.9 3.8z" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1" stroke-linejoin="round"/><path d="M22.4 8.4L21.7 2.4l-3.9 3.8z" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M10.8 6.6l.4-2.6 1.8 1.8zM21.2 6.6l-.4-2.6-1.8 1.8z" fill="#ffc2a6"/>' +
        '<path d="M8.2 23.2Q8.2 15.4 16 15.4t7.8 7.8z" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1"/>' +
        '<circle cx="16" cy="11.4" r="7.2" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1"/>' +
        '<path d="M16 4.6v2.3M13.5 5.2l.6 1.9M18.5 5.2l-.6 1.9M9.4 11.6h1.8M20.8 11.6h1.8" stroke="#b5561a" stroke-width="1.1" stroke-linecap="round"/>' +
        '<ellipse cx="16" cy="14.3" rx="3.7" ry="2.6" fill="#fff4e6"/>' +
        '<path d="M11.7 10.5q1.4-1.7 2.8 0M17.5 10.5q1.4-1.7 2.8 0" fill="none" stroke="#2a1405" stroke-width="1.25" stroke-linecap="round"/>' +
        '<path d="M15.2 12.9l.8.8.8-.8z" fill="#e0607e"/><path d="M14.5 14.3q1.5 2.3 3 0z" fill="#8a1f33" stroke="#2a1405" stroke-width=".7" stroke-linejoin="round"/>' +
        '<g class="a-table"><rect x="1" y="22.6" width="30" height="3.3" rx="1.2" fill="#a8672f" stroke="#3a1f0a" stroke-width="1.2"/><rect x="4" y="25.6" width="2.4" height="5.4" fill="#7a4720" stroke="#3a1f0a" stroke-width="1"/><rect x="25.6" y="25.6" width="2.4" height="5.4" fill="#7a4720" stroke="#3a1f0a" stroke-width="1"/></g>' +
        '<g class="a-pawL"><rect x="5.4" y="14.6" width="4.8" height="8.4" rx="2.4" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1"/><ellipse cx="7.8" cy="22.2" rx="2.8" ry="1.7" fill="#fff4e6" stroke="#4a2306" stroke-width="1"/></g>' +
        '<g class="a-pawR"><rect x="21.8" y="14.6" width="4.8" height="8.4" rx="2.4" fill="#f29a3a" stroke="#4a2306" stroke-width="1.1"/><ellipse cx="24.2" cy="22.2" rx="2.8" ry="1.7" fill="#fff4e6" stroke="#4a2306" stroke-width="1"/></g>' +
        '<path class="a-hitL" d="M2.6 20.6l-1.8-1.8M2.2 22.6H.2" stroke="#fff" stroke-width="1" stroke-linecap="round"/><path class="a-hitR" d="M29.4 20.6l1.8-1.8M29.8 22.6h2" stroke="#fff" stroke-width="1" stroke-linecap="round"/>' +
        H('h1', 2.2, 12, 1) + H('h2', 24.8, 11, 1) + H('h3', 13.4, -1, .9);
    } },
    popcorn: { label: 'Popcorn', svg: function () {
      var K = function (x, y, cls) { return '<g transform="translate(' + x + ' ' + y + ')"><path class="' + (cls || '') + '" d="M0 0a1.7 1.7 0 0 1 2.6-1.2a1.7 1.7 0 0 1 2.6 1.2a1.6 1.6 0 0 1-.6 2.8a1.7 1.7 0 0 1-3.4.2a1.6 1.6 0 0 1-1.2-3z" fill="#fff4d6" stroke="#9a6b22" stroke-width=".8"/></g>'; };
      return '<g class="a-bucket">' + K(8.6, 11, '') + K(12.4, 9.4, '') + K(16.2, 10.2, '') + K(19.6, 9, '') + K(22, 11.2, '') + K(14.4, 12, '') +
        '<path d="M7 14h18l-2.5 16h-13z" fill="#fff" stroke="#3a1f0a" stroke-width="1.5" stroke-linejoin="round"/><path d="M7.00 14L10.00 14L11.67 30L9.50 30zM13.00 14L16.00 14L16.00 30L13.83 30zM19.00 14L22.00 14L20.33 30L18.17 30z" fill="#e8343f"/>' +
        '<path d="M7 14h18l-2.5 16h-13z" fill="none" stroke="#3a1f0a" stroke-width="1.5" stroke-linejoin="round"/><rect x="6" y="12.8" width="20" height="2.6" rx="1.3" fill="#fff" stroke="#3a1f0a" stroke-width="1.3"/></g>' +
        K(9.4, 9, 'a-pop k1') + K(18.6, 8.4, 'a-pop k2') + K(14, 8, 'a-pop k3');
    } },
    lol: { label: 'LOL', svg: function () {
      return '<g class="a-rock"><path d="M16 3.4L28.6 26.6q1 2.2-1.4 2.2H4.8q-2.4 0-1.4-2.2z" fill="#e8822a" stroke="#4a2306" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 3.4L28.6 26.6q1 2.2-1.4 2.2H16z" fill="#ffb347" opacity=".55"/>' +
        txt(16, 13, 5.4, '#4a2306', '', 0, '4') + '<path d="M10.6 16.6l2.8 1.6-2.8 1.6M21.4 16.6l-2.8 1.6 2.8 1.6" fill="none" stroke="#2a1405" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M12 21.4h8q0 5-4 5t-4-5z" fill="#5a1220" stroke="#2a1405" stroke-width="1.1" stroke-linejoin="round"/><path d="M13.6 24.8q2.4-1.6 4.8 0q-1 1.4-2.4 1.4t-2.4-1.4z" fill="#ff7a8e"/></g>' +
        '<path class="a-tearL" d="M9.6 17.4q-4.4.4-6 4.2q-.4 1.8 1.2 2 2.2-.6 3.2-3.4z" fill="#6cc4ff" stroke="#0e3d63" stroke-width=".9" stroke-linejoin="round"/><path class="a-tearR" d="M22.4 17.4q4.4.4 6 4.2q.4 1.8-1.2 2-2.2-.6-3.2-3.4z" fill="#6cc4ff" stroke="#0e3d63" stroke-width=".9" stroke-linejoin="round"/>';
    } },
    jaw: { label: 'No way!', svg: function () {
      return '<g class="a-jawhead">' + note(7, 3.4, 18, 15.6, 'b', 'arrow') +
        '<g class="a-eyes"><circle cx="12.4" cy="11.6" r="3.2" fill="#fff" stroke="#0b0c12" stroke-width=".9"/><circle cx="19.6" cy="11.6" r="3.2" fill="#fff" stroke="#0b0c12" stroke-width=".9"/><circle cx="12.4" cy="11.6" r="1.1" fill="#111"/><circle cx="19.6" cy="11.6" r="1.1" fill="#111"/></g></g>' +
        '<rect x="9" y="17" width="14" height="9" rx="2" fill="#1a0a12"/><path d="M11 24.8q5-3 10 0v1.2H11z" fill="#ff6b84"/>' +
        '<g class="a-jaw">' + note(7.6, 18.4, 16.8, 6.8, 'b', '', 3) + '</g>' +
        '<path class="a-shock" d="M3.4 4.6l2 2.6M2.4 9.6h2.8M28.6 4.6l-2 2.6M29.6 9.6h-2.8" stroke="#ffd34d" stroke-width="1.5" stroke-linecap="round"/>';
    } },
    bump: { label: 'Fist bump', svg: function () {
      var face = function (cx, cy) { return '<circle cx="' + (cx - 2) + '" cy="' + cy + '" r=".95" fill="#fff"/><circle cx="' + (cx + 2) + '" cy="' + cy + '" r=".95" fill="#fff"/><path d="M' + (cx - 1.5) + ' ' + (cy + 2.2) + 'q1.5 1.3 3 0" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>'; };
      var fist = function (x, y, col) { return '<rect x="' + (x - 2.3) + '" y="' + (y - 2.1) + '" width="4.6" height="4.2" rx="1.6" fill="' + col + '" stroke="#050507" stroke-width="1"/><path d="M' + (x - 1) + ' ' + (y - 2) + 'v1.4M' + (x + .4) + ' ' + (y - 2) + 'v1.4" stroke="#050507" stroke-width=".6" stroke-linecap="round"/>'; };
      return '<g class="a-noteL">' + note(1.2, 13, 11.4, 12.6, 'r', 'arrow', 2.6) + face(6.9, 21) + '<ellipse cx="4.6" cy="27.4" rx="1.8" ry="1" fill="#111"/><ellipse cx="9.2" cy="27.4" rx="1.8" ry="1" fill="#111"/></g>' +
        '<g class="a-noteR">' + note(19.4, 13, 11.4, 12.6, 'b', 'arrow', 2.6) + face(25.1, 21) + '<ellipse cx="22.8" cy="27.4" rx="1.8" ry="1" fill="#111"/><ellipse cx="27.4" cy="27.4" rx="1.8" ry="1" fill="#111"/></g>' +
        '<g class="a-armL"><path d="M12.4 20.4L14.2 19.4" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>' + fist(13.8, 19.2, '#ff8a95') + '</g>' +
        '<g class="a-armR"><path d="M19.6 20.4L17.8 19.4" stroke="#1b1b22" stroke-width="2" stroke-linecap="round"/>' + fist(18.2, 19.2, '#93c4ff') + '</g>' +
        '<g class="a-spark"><path d="M16 11.2l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" fill="#ffd34d" stroke="#5a3a00" stroke-width=".5"/><path d="M12.8 12.4l-1.4-1.6M19.2 12.4l1.4-1.6M16 9.6V8" stroke="#ffd34d" stroke-width="1" stroke-linecap="round"/></g>';
    } },
    medal: { label: 'Acc medal', svg: function () {
      var id = 'mclip' + (++uid);
      return '<g class="a-swing"><path d="M10.2 0.6h5.2l3 11.6h-5.2z" fill="#e3263b" stroke="#050507" stroke-width="1.1" stroke-linejoin="round"/><path d="M21.8 0.6h-5.2l-3 11.6h5.2z" fill="#2a78f2" stroke="#050507" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<circle cx="16" cy="20.4" r="9" fill="#e8a417" stroke="#5a3a00" stroke-width="1.4"/><circle cx="16" cy="20.4" r="6.6" fill="#ffd34d" stroke="#b07a10" stroke-width="1"/>' +
        '<circle cx="16" cy="20.4" r="4.4" fill="none" stroke="#b0420e" stroke-width="1.3"/><circle cx="16" cy="20.4" r="1.6" fill="#e3263b"/>' +
        '<path d="M16 14.6v2.4M16 23.8v2.4M10.2 20.4h2.4M19.4 20.4h2.4" stroke="#b0420e" stroke-width="1.2" stroke-linecap="round"/>' +
        '<clipPath id="' + id + '"><circle cx="16" cy="20.4" r="8.3"/></clipPath><g clip-path="url(#' + id + ')"><g class="a-glint"><rect x="9" y="10" width="2.4" height="22" fill="#fff" opacity=".7" transform="rotate(30 16 20.4)"/></g></g></g>' +
        '<path class="a-twinkle" d="M27.4 9.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="#fff"/>';
    } },
    pressf: { label: 'Press F', svg: function () {
      return '<circle class="a-ripple" cx="16" cy="18" r="12" fill="none" stroke="#ffd34d" stroke-width="1.3"/><circle class="a-ripple r2" cx="16" cy="18" r="12" fill="none" stroke="#ffd34d" stroke-width="1"/>' +
        '<rect x="4.6" y="9.4" width="22.8" height="20.2" rx="4.6" fill="#7d8694" stroke="#14171c" stroke-width="1.6"/>' +
        '<g class="a-key"><rect x="6.2" y="6.2" width="19.6" height="18" rx="3.8" fill="#eef0f3" stroke="#14171c" stroke-width="1.4"/><rect x="8" y="7.8" width="16" height="5" rx="2.4" fill="#fff" opacity=".8"/>' +
        txt(16, 20.6, 12.5, '#1f232a', '', 0, 'F') + '<path d="M13.8 22.2h4.4" stroke="#1f232a" stroke-width=".9" stroke-linecap="round" opacity=".5"/></g>';
    } },
    sabers: { label: 'Sabers up', svg: function () {
      var saber = function (cls, hx, hy, tx, ty, col, core) {
        return '<g class="' + cls + '"><line x1="' + hx + '" y1="' + hy + '" x2="' + tx + '" y2="' + ty + '" stroke="' + col + '" stroke-width="5" stroke-linecap="round" opacity=".3" class="a-glow"/><line x1="' + hx + '" y1="' + hy + '" x2="' + tx + '" y2="' + ty + '" stroke="' + col + '" stroke-width="2.6" stroke-linecap="round"/><line x1="' + hx + '" y1="' + hy + '" x2="' + tx + '" y2="' + ty + '" stroke="' + core + '" stroke-width=".9" stroke-linecap="round"/></g>';
      };
      return '<g class="a-cube"><ellipse cx="12.6" cy="28.8" rx="2.4" ry="1.3" fill="#1b1b22"/><ellipse cx="19.4" cy="28.8" rx="2.4" ry="1.3" fill="#1b1b22"/>' +
        note(8.6, 12.4, 14.8, 15.4, 'r', 'arrow') +
        '<ellipse cx="13.4" cy="21.2" rx="1.7" ry="2" fill="#fff"/><ellipse cx="18.6" cy="21.2" rx="1.7" ry="2" fill="#fff"/><circle cx="13.8" cy="21.6" r=".9" fill="#111"/><circle cx="18.2" cy="21.6" r=".9" fill="#111"/>' +
        '<path d="M14.2 24.4q1.8 1.6 3.6 0" fill="none" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></g>' +
        '<g class="a-armL">' + saber('', 6.4, 16.8, 3.4, 5.6, '#ff3b4a', '#ffd6da') + '<line x1="6.4" y1="16.8" x2="7.4" y2="19.6" stroke="#1b1b22" stroke-width="2.6" stroke-linecap="round"/><circle cx="7.6" cy="19.8" r="1.8" fill="#4a4f66" stroke="#0b0c12" stroke-width=".9"/></g>' +
        '<g class="a-armR">' + saber('', 25.6, 16.8, 28.6, 5.6, '#2f86ff', '#d6e8ff') + '<line x1="25.6" y1="16.8" x2="24.6" y2="19.6" stroke="#1b1b22" stroke-width="2.6" stroke-linecap="round"/><circle cx="24.4" cy="19.8" r="1.8" fill="#4a4f66" stroke="#0b0c12" stroke-width=".9"/></g>' +
        '<circle class="a-clash" cx="16" cy="6" r="1.3" fill="#fff"/>';
    } },
    salt: { label: 'Salty', svg: function () { return '<g class="a-shaker"><path d="M10.2 13h11.6l-1.4 14.4a2.2 2.2 0 0 1-2.2 2H13.8a2.2 2.2 0 0 1-2.2-2z" fill="#f5f7f9" stroke="#3d4650" stroke-width="1.5"/><path d="M10.6 13q0-7.6 5.4-7.6t5.4 7.6z" fill="#aab6c2" stroke="#3d4650" stroke-width="1.5"/><circle cx="14.2" cy="9.6" r=".9" fill="#56606a"/><circle cx="17.8" cy="9.6" r=".9" fill="#56606a"/><circle cx="16" cy="7.8" r=".9" fill="#56606a"/>' + txt(16, 23.6, 5, '#5f6c78', '', 0, 'SALT', ' textLength="8.6" lengthAdjust="spacingAndGlyphs"') + '</g><rect class="a-grain" x="6" y="3" width="1.8" height="1.8" fill="#fff"/><rect class="a-grain g2" x="3.4" y="6" width="1.5" height="1.5" fill="#fff"/><rect class="a-grain g3" x="7.6" y="8" width="1.4" height="1.4" fill="#fff"/>'; } },
    rip: { label: 'RIP', svg: function () { return '<path d="M8 28.5V13.5a8 8 0 0 1 16 0v15z" fill="#a3a9ac" stroke="#2c3134" stroke-width="1.8"/><path d="M10 13.5a6 6 0 0 1 6-6" fill="none" stroke="#fff" stroke-width="1.2" opacity=".5"/>' + txt(16, 21.8, 7.6, '#3b4043', '', 0, 'RIP') + '<path d="M4 29.2h24" stroke="#4f8a2b" stroke-width="2.6" stroke-linecap="round"/><g class="a-ghost"><path d="M22.5 11.5a4 4 0 0 1 8 0v5.5l-1.3-1.1-1.4 1.1-1.3-1.1-1.4 1.1-1.3-1.1-1.3 1.1z" fill="#fff" stroke="#2c3134" stroke-width=".9" opacity=".95"/><circle cx="25" cy="11.6" r=".75" fill="#222"/><circle cx="28" cy="11.6" r=".75" fill="#222"/></g>'; } },
    cry: { label: "Crying", svg: function () { return "<g class=\"a-sob\"><rect x=\"5.0\" y=\"3.5\" width=\"22.0\" height=\"22.5\" rx=\"3.4\" fill=\"#0a2a66\" stroke=\"#050507\" stroke-width=\"1.5\"/><rect x=\"6.5\" y=\"5.0\" width=\"19.0\" height=\"19.5\" rx=\"2.1\" fill=\"#2a78f2\"/><rect x=\"6.5\" y=\"5.0\" width=\"19.0\" height=\"7.8\" rx=\"2.1\" fill=\"#93c4ff\" opacity=\".35\"/><path d=\"M10.1 6.1H21.9L16.0 9.9z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\".6\" stroke-linejoin=\"round\"/><path d=\"M9.4 11.8l3.6-1.6M22.6 11.8l-3.6-1.6\" stroke=\"#0a1f4d\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"15.6\" r=\"3\" fill=\"#fff\" stroke=\"#0a1f4d\" stroke-width=\".8\"/><circle cx=\"12\" cy=\"15.6\" r=\"1.6500000000000001\" fill=\"#111\"/><circle cx=\"20\" cy=\"15.6\" r=\"3\" fill=\"#fff\" stroke=\"#0a1f4d\" stroke-width=\".8\"/><circle cx=\"20\" cy=\"15.6\" r=\"1.6500000000000001\" fill=\"#111\"/><path d=\"M9.4 17.6q2.6 1.6 5.2 0v.9q-2.6 1.5-5.2 0zM17.4 17.6q2.6 1.6 5.2 0v.9q-2.6 1.5-5.2 0z\" fill=\"#8fd3ff\"/><path class=\"a-lip\" d=\"M12.6 23.2q1.1-1.4 2.2 0t2.2 0 2.2 0\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.2\" stroke-linecap=\"round\"/></g><path class=\"a-stream\" d=\"M10.2 19.2q-.6 4-.2 9.2M21.8 19.2q.6 4 .2 9.2\" fill=\"none\" stroke=\"#6cc4ff\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-dasharray=\"2.4 2\"/>"; } },
    sweat: { label: "Sweating", svg: function () { return "<g class=\"a-pant\"><rect x=\"5.0\" y=\"4.0\" width=\"22.0\" height=\"22.0\" rx=\"3.4\" fill=\"#6e0c18\" stroke=\"#050507\" stroke-width=\"1.5\"/><rect x=\"6.5\" y=\"5.5\" width=\"19.0\" height=\"19.0\" rx=\"2.1\" fill=\"#e3263b\"/><rect x=\"6.5\" y=\"5.5\" width=\"19.0\" height=\"7.6\" rx=\"2.1\" fill=\"#ff8a95\" opacity=\".35\"/><path d=\"M10.1 6.6H21.9L16.0 10.3z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\".6\" stroke-linejoin=\"round\"/><path d=\"M9 12.4h5M18 12.4h5\" stroke=\"#3a0810\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M9.5 15q2.2-1.6 4.4 0M18.1 15q2.2-1.6 4.4 0\" fill=\"none\" stroke=\"#3a0810\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><ellipse class=\"a-mouth\" cx=\"16\" cy=\"21\" rx=\"3\" ry=\"2.2\" fill=\"#3a0810\"/></g><path class=\"a-drop d1\" d=\"M27 8q-2 3 0 4q2-1 0-4z\" fill=\"#8fd3ff\" stroke=\"#0e3d63\" stroke-width=\".5\"/><path class=\"a-drop d2\" d=\"M4 10q-2 3 0 4q2-1 0-4z\" fill=\"#8fd3ff\" stroke=\"#0e3d63\" stroke-width=\".5\"/>"; } },
    rage: { label: "Rage", svg: function () { return "<g class=\"a-shake\"><rect x=\"5.0\" y=\"7.0\" width=\"22.0\" height=\"21.0\" rx=\"3.4\" fill=\"#6e0c18\" stroke=\"#050507\" stroke-width=\"1.5\"/><rect x=\"6.5\" y=\"8.5\" width=\"19.0\" height=\"18.0\" rx=\"2.1\" fill=\"#e3263b\"/><rect x=\"6.5\" y=\"8.5\" width=\"19.0\" height=\"7.2\" rx=\"2.1\" fill=\"#ff8a95\" opacity=\".35\"/><path d=\"M10.1 9.6H21.9L16.0 13.2z\" fill=\"#fff\" stroke=\"#fff\" stroke-width=\".6\" stroke-linejoin=\"round\"/><path d=\"M8.5 13l5 2.2M23.5 13l-5 2.2\" stroke=\"#2a0006\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"17.4\" r=\"1.6\" fill=\"#fff\"/><circle cx=\"20\" cy=\"17.4\" r=\"1.6\" fill=\"#fff\"/><circle cx=\"12\" cy=\"17.6\" r=\".8\" fill=\"#111\"/><circle cx=\"20\" cy=\"17.6\" r=\".8\" fill=\"#111\"/><path d=\"M11 24q5-3.4 10 0\" fill=\"none\" stroke=\"#2a0006\" stroke-width=\"1.6\" stroke-linecap=\"round\"/></g><g class=\"a-steam\"><circle cx=\"4\" cy=\"8\" r=\"2.4\" fill=\"#e8e8e8\"/><circle cx=\"2.6\" cy=\"4.6\" r=\"1.8\" fill=\"#e8e8e8\"/></g><g class=\"a-steam s2\"><circle cx=\"28\" cy=\"8\" r=\"2.4\" fill=\"#e8e8e8\"/><circle cx=\"29.4\" cy=\"4.6\" r=\"1.8\" fill=\"#e8e8e8\"/></g>"; } },
    hurry: { label: "Hurry up", svg: function () { return "<g class=\"a-jit\"><rect x=\"14.6\" y=\"2\" width=\"2.8\" height=\"4\" rx=\"1\" fill=\"#9aa3ad\" stroke=\"#050507\" stroke-width=\".9\"/><path d=\"M24 7l2-2\" stroke=\"#9aa3ad\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"16\" cy=\"18\" r=\"11\" fill=\"#f5f7f9\" stroke=\"#050507\" stroke-width=\"1.6\"/><circle cx=\"16\" cy=\"18\" r=\"8.6\" fill=\"none\" stroke=\"#e3263b\" stroke-width=\"1.2\" stroke-dasharray=\"1 3.5\"/><path class=\"a-hand\" d=\"M16 18V10.4\" stroke=\"#e3263b\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><circle cx=\"16\" cy=\"18\" r=\"1.4\" fill=\"#050507\"/></g><path class=\"a-tick\" d=\"M3 10l2.5 1.5M2.4 16H5M29 16h-2.6\" stroke=\"#ffd34d\" stroke-width=\"1.4\" stroke-linecap=\"round\"/>"; } },
    strong: { label: "Strong", svg: function () { return "<g class=\"a-pow\"><path d=\"M6 11l-2.6-2M9.6 9L9 5.8M3.6 14.6H1\" stroke=\"#ffd34d\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></g><g class=\"a-arm\"><g transform=\"translate(2.4 3.4) scale(.85)\"><path d=\"M1 30.5V20Q4.5 13.5 10.5 11.5Q16 10 19.6 15.2L19 9.6Q16 9.6 15 7.4Q14.2 4.6 15.8 2.8Q18 1 22.4 1.6Q27.2 2.4 28 6.4L29.6 17Q31.2 25.5 27.4 28.6Q24.6 30.6 18 30.5z\" fill=\"#ffcc4d\" stroke=\"#7a4c0c\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/><path d=\"M2.4 29.2H18q6.4.1 8.8-2 2.2-2 2.2-6.2\" fill=\"none\" stroke=\"#e8a530\" stroke-width=\"2.2\" stroke-linecap=\"round\" opacity=\".9\"/><path d=\"M19.6 15.2q1.8 2.6 1 6\" fill=\"none\" stroke=\"#7a4c0c\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><path d=\"M15.6 5.2q2 .6 3.6-.4M15.4 7.6q2 .4 3.4-.6\" fill=\"none\" stroke=\"#7a4c0c\" stroke-width=\"1\" stroke-linecap=\"round\"/><path d=\"M19 9.6q2.6.8 4.6-1.6\" fill=\"none\" stroke=\"#7a4c0c\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><path class=\"a-shine\" d=\"M6.2 16.4Q8.6 13.6 12.4 13.2\" fill=\"none\" stroke=\"#fff\" stroke-width=\"1.6\" stroke-linecap=\"round\" opacity=\".7\"/></g></g>"; } },
    broken: { label: "Heartbroken", svg: function () { return "<g class=\"a-hl\"><path d=\"M16 8.7C14.2 6.3 12 4.5 9 4.5 5.8 4.5 3 7 3 10.5 3 15 6 20 16 27L14.5 19.7 17 15.7 14 12.7z\" fill=\"#e3263b\" stroke=\"#050507\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/></g><g class=\"a-hr\"><path d=\"M16 8.7C17.8 6.3 20 4.5 23 4.5c3.2 0 6 2.5 6 6 0 4.5-3 9.5-13 16.5L14.5 19.7 17 15.7 14 12.7z\" fill=\"#e3263b\" stroke=\"#050507\" stroke-width=\"1.4\" stroke-linejoin=\"round\"/></g><path class=\"a-tear\" d=\"M24 21q1.6 2.4 0 3.4-1.6-1 0-3.4z\" fill=\"#6cc4ff\"/>"; } },
    hbird: { label: "Hummingbird", svg: function () { return "<g transform=\"translate(0 .4)\"><g class=\"a-fl\"><path d=\"M6.4 31.6C6.6 28.4 6.4 25.6 6.2 23\" fill=\"none\" stroke=\"#2f8f3c\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M6.4 27.6C8.4 26.4 9.8 26.8 10.6 28C9 28.8 7.6 28.8 6.4 27.6Z\" fill=\"#3fb83a\" stroke=\"#1d5e22\" stroke-width=\".7\" stroke-linejoin=\"round\"/><path d=\"M6.2 23.6C4.8 22.2 4.2 20.4 4.3 18.4H8.1C8.2 20.4 7.6 22.2 6.2 23.6Z\" fill=\"#e3265f\" stroke=\"#6b0f2e\" stroke-width=\".9\" stroke-linejoin=\"round\"/><ellipse cx=\"6.2\" cy=\"18.3\" rx=\"2.9\" ry=\"1.1\" fill=\"#ff6fa0\" stroke=\"#6b0f2e\" stroke-width=\".9\"/><path d=\"M5.6 20.2C5.8 21.4 6 22.2 6.2 22.8\" fill=\"none\" stroke=\"#ff9cbc\" stroke-width=\".6\" stroke-linecap=\"round\"/></g><g class=\"a-hov\"><g transform=\"translate(3.6 3.3) scale(.9)\"><g class=\"a-wfar\"><path d=\"M16.2 13.4C16.6 8 19.4 3.2 24.4 0.8C24.2 6 21.8 10.8 18.2 14.6Z\" fill=\"#7fe0c4\" stroke=\"#0d3b2a\" stroke-width=\".9\" stroke-linejoin=\"round\" opacity=\".55\"/></g><path d=\"M21.4 21.2L29.6 24.6L27.2 26.2L30 28.6L25.6 28.2L20.2 23.4Z\" fill=\"#1f7a55\" stroke=\"#0d3b2a\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><path d=\"M9.6 14.6C10.4 19.6 15.6 23.4 22.6 23.8C23.4 22.4 23.2 21 22.2 19.8C20.4 15.4 17.6 11.4 13.6 9.6C11.2 9.2 9.4 11.6 9.6 14.6Z\" fill=\"#2fbf71\" stroke=\"#0d3b2a\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M12.6 18.2C15.6 21.4 18.8 22.8 22.6 23.8C20.6 21.4 18.6 19.8 16.2 18.4Z\" fill=\"#e8f6ee\"/><path d=\"M15 11.2C17.6 12.2 19.6 14.6 21.2 17.6\" fill=\"none\" stroke=\"#7ef0a8\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\".8\"/><circle cx=\"12.4\" cy=\"12.6\" r=\"3.9\" fill=\"#2fbf71\" stroke=\"#0d3b2a\" stroke-width=\"1.2\"/><path d=\"M9.3 13.5C9.3 16.8 11.6 19 15.2 18.8C15.6 16.8 15.2 14.8 14 13.4C12.4 14.1 10.8 14.1 9.3 13.5Z\" fill=\"#ff2d6f\" stroke=\"#0d3b2a\" stroke-width=\".9\" stroke-linejoin=\"round\"/><ellipse cx=\"11.4\" cy=\"15.2\" rx=\"1.3\" ry=\".75\" fill=\"#ff8fb4\" transform=\"rotate(30 11.4 15.2)\"/><path d=\"M9 11.5L0.7 15L1 15.7L9.2 14.1Z\" fill=\"#f1e3b8\" stroke=\"#0d3b2a\" stroke-width=\".6\" stroke-linejoin=\"round\"/><circle cx=\"11.2\" cy=\"11.8\" r=\"1.15\" fill=\"#111\"/><circle cx=\"10.85\" cy=\"11.45\" r=\".4\" fill=\"#fff\"/><path d=\"M13.2 11.6l1.2.3\" stroke=\"#fff\" stroke-width=\".7\" stroke-linecap=\"round\" opacity=\".9\"/><g class=\"a-wnear\"><path d=\"M16.4 14.2C16.2 8.4 19.6 3.4 25.8 1.2C26 7 23.4 11.8 18.6 15.8Z\" fill=\"#9ff2da\" stroke=\"#0d3b2a\" stroke-width=\"1.1\" stroke-linejoin=\"round\"/><path d=\"M17.6 13.6C19.4 9.4 21.6 6 24.6 3.6M18.6 14.6C21 11.2 23 8.6 25.2 6.6\" fill=\"none\" stroke=\"#3aa486\" stroke-width=\".7\" stroke-linecap=\"round\"/></g></g></g></g>"; } },
    msploit: { label: "MSploit", svg: function () { return "<path d=\"M16 1.8C23.2 3.4 27 9.2 27.2 16.4C27.4 22.4 28.4 27.2 30 31.8H2C3.6 27.2 4.6 22.4 4.8 16.4C5 9.2 8.8 3.4 16 1.8Z\" fill=\"#1c1f25\" stroke=\"#050507\" stroke-width=\"1.2\" stroke-linejoin=\"round\"/><path d=\"M15 3.2C9.6 5 6.4 10 6.2 16.4C6 22 5 26.6 3.6 30.8\" fill=\"none\" stroke=\"#4aa8ff\" stroke-width=\"1\" stroke-linecap=\"round\"/><path d=\"M17 3.2C22.4 5 25.6 10 25.8 16.4C26 22 27 26.6 28.4 30.8\" fill=\"none\" stroke=\"#ff3b4f\" stroke-width=\"1\" stroke-linecap=\"round\"/><path d=\"M16 5.6C21.6 7.2 24.4 11.6 24.6 17C24.8 22.6 24.2 27.4 23.6 31.8H8.4C7.8 27.4 7.2 22.6 7.4 17C7.6 11.6 10.4 7.2 16 5.6Z\" fill=\"#050608\"/><path d=\"M9.4 16C9.4 12.6 12.2 10.6 16 10.6C19.8 10.6 22.6 12.6 22.6 16C22.6 19.4 19.8 21.4 16 21.4C12.2 21.4 9.4 19.4 9.4 16Z\" fill=\"#7a0f1c\"/><path d=\"M10.2 18.4C11.8 20.4 13.8 21 16 21C18.2 21 20.2 20.4 21.8 18.4\" fill=\"none\" stroke=\"#e3263b\" stroke-width=\"1.1\" stroke-linecap=\"round\"/><g class=\"a-tm\"><path d=\"M9.93 18.62L9.56 19.22L9.25 19.84L8.99 20.48L8.79 21.11L8.65 21.74L8.56 22.37L8.52 22.99L8.54 23.59L8.6 24.18L8.72 24.75L8.88 25.29L9.09 25.81L9.34 26.29L9.65 26.73L9.99 27.13L10.38 27.48L10.8 27.78L11.26 28.01A0.7 0.7 0 0 1 11.94 26.79L11.7 26.57L11.49 26.33L11.32 26.07L11.17 25.78L11.06 25.46L10.97 25.13L10.91 24.77L10.89 24.4L10.9 24.02L10.94 23.63L11.01 23.23L11.12 22.83L11.26 22.43L11.43 22.04L11.64 21.66L11.88 21.29L12.15 20.93L12.47 20.58Z\" fill=\"#c81b2e\" stroke=\"#050507\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M19.53 20.58L19.85 20.93L20.12 21.29L20.36 21.66L20.57 22.04L20.74 22.43L20.88 22.83L20.99 23.23L21.06 23.63L21.1 24.02L21.11 24.4L21.09 24.77L21.03 25.13L20.94 25.46L20.83 25.78L20.68 26.07L20.51 26.33L20.3 26.57L20.06 26.79A0.7 0.7 0 0 1 20.74 28.01L21.2 27.78L21.62 27.48L22.01 27.13L22.35 26.73L22.66 26.29L22.91 25.81L23.12 25.29L23.28 24.75L23.4 24.18L23.46 23.59L23.48 22.99L23.44 22.37L23.35 21.74L23.21 21.11L23.01 20.48L22.75 19.84L22.44 19.22L22.07 18.62Z\" fill=\"#c81b2e\" stroke=\"#050507\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M12.54 20.47L12.48 20.95L12.45 21.44L12.43 21.92L12.43 22.4L12.44 22.87L12.47 23.33L12.53 23.78L12.59 24.21L12.68 24.64L12.79 25.05L12.91 25.45L13.06 25.83L13.23 26.19L13.41 26.53L13.62 26.84L13.85 27.13L14.1 27.4L14.37 27.62A0.6 0.6 0 0 1 15.23 26.78L15.12 26.58L15.02 26.37L14.94 26.14L14.88 25.89L14.83 25.62L14.79 25.34L14.77 25.04L14.76 24.73L14.77 24.41L14.79 24.07L14.82 23.73L14.87 23.37L14.94 23.01L15.02 22.64L15.11 22.26L15.21 21.89L15.33 21.51L15.46 21.13Z\" fill=\"#e3263b\" stroke=\"#050507\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M16.54 21.13L16.67 21.51L16.79 21.89L16.89 22.26L16.98 22.64L17.06 23.01L17.13 23.37L17.18 23.73L17.21 24.07L17.23 24.41L17.24 24.73L17.23 25.04L17.21 25.34L17.17 25.62L17.12 25.89L17.06 26.14L16.98 26.37L16.88 26.58L16.77 26.78A0.6 0.6 0 0 1 17.63 27.62L17.9 27.4L18.15 27.13L18.38 26.84L18.59 26.53L18.77 26.19L18.94 25.83L19.09 25.45L19.21 25.05L19.32 24.64L19.41 24.21L19.47 23.78L19.53 23.33L19.56 22.87L19.57 22.4L19.57 21.92L19.55 21.44L19.52 20.95L19.46 20.47Z\" fill=\"#e3263b\" stroke=\"#050507\" stroke-width=\"1\" stroke-linejoin=\"round\"/></g><path d=\"M9.6 13.4H22.4V14.4C22.4 17.2 20.799999999999997 18.4 18.9 18.4C17.099999999999998 18.4 16.9 17.2 16.5 15.8H15.5C15.1 17.2 14.899999999999999 18.4 13.1 18.4C11.2 18.4 9.6 17.2 9.6 14.4Z\" fill=\"#0b0c0f\" stroke=\"#050507\" stroke-width=\".8\" stroke-linejoin=\"round\"/><g class=\"a-glint\"><path d=\"M11.6 16.6L13.6 14.8M18.2 16.6L20.2 14.8\" stroke=\"#fff\" stroke-width=\"1\" stroke-linecap=\"round\"/></g><g class=\"a-sb\"><path class=\"a-glow\" d=\"M1.6 19.6L19.2 28.6\" stroke=\"#3d9bff\" stroke-width=\"4.6\" stroke-linecap=\"round\" opacity=\".35\"/><path d=\"M1.6 19.6L19.2 28.6\" stroke=\"#3d9bff\" stroke-width=\"2.2\" stroke-linecap=\"round\"/><path d=\"M1.6 19.6L19.2 28.6\" stroke=\"#fff\" stroke-width=\".9\" stroke-linecap=\"round\"/><path d=\"M19.2 28.6L21.8 30\" stroke=\"#050507\" stroke-width=\"3.2\" stroke-linecap=\"round\"/><path d=\"M19.2 28.6L21.8 30\" stroke=\"#9aa1ab\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></g><g class=\"a-sr\"><path class=\"a-glow\" d=\"M30.4 19.6L12.8 28.6\" stroke=\"#ff2d45\" stroke-width=\"4.6\" stroke-linecap=\"round\" opacity=\".35\"/><path d=\"M30.4 19.6L12.8 28.6\" stroke=\"#ff2d45\" stroke-width=\"2.2\" stroke-linecap=\"round\"/><path d=\"M30.4 19.6L12.8 28.6\" stroke=\"#fff\" stroke-width=\".9\" stroke-linecap=\"round\"/><path d=\"M12.8 28.6L10.2 30\" stroke=\"#050507\" stroke-width=\"3.2\" stroke-linecap=\"round\"/><path d=\"M12.8 28.6L10.2 30\" stroke=\"#9aa1ab\" stroke-width=\"1.5\" stroke-linecap=\"round\"/></g>"; } },
    hero: { label: '', svg: null }
  };
  // Which reactions lead the picker for each kind of moment.
  var RX_ORDER = {
    cleared: ['ss', 'fire', 'medal', 'strong', 'love', 'jaw', 'sweat', 'letsgo', 'bump', 'sabers', 'salt', 'hero', 'lol', 'popcorn', 'cry','broken', 'rage', 'pressf', 'rip', 'hurry'],
    escaped: ['medal', 'letsgo', 'bump', 'love', 'fire', 'strong', 'jaw', 'hero', 'sabers', 'salt', 'cry','broken', 'rage', 'ss', 'popcorn', 'sweat', 'lol', 'pressf', 'rip', 'hurry'],
    bad: ['pressf', 'cry','broken', 'rip', 'rage', 'lol', 'popcorn', 'salt', 'sweat', 'bump', 'jaw', 'hero', 'love', 'strong', 'fire', 'letsgo', 'sabers', 'medal', 'ss', 'hurry'],
    good: ['fire', 'jaw', 'strong', 'love', 'sabers', 'letsgo', 'bump', 'salt', 'sweat', 'popcorn', 'hero', 'medal', 'lol', 'rage', 'ss', 'cry','broken', 'pressf', 'rip', 'hurry'],
    other: ['letsgo', 'bump', 'hurry', 'love', 'lol', 'popcorn', 'hero', 'fire', 'jaw', 'strong', 'sweat', 'medal', 'sabers', 'salt', 'rage', 'cry','broken', 'pressf', 'rip', 'ss']
  };
  function rxLabel(id, theme) { return id === 'hero' ? (theme && theme.hero === 'taco' ? 'Taco!' : 'Caw!') : (RX[id] ? RX[id].label : ''); }
  function rxIcon(id, theme, cls) {
    if (id === 'hero') return '<svg class="' + (cls || 'rx-ico') + ' rx-hero' + (theme && theme.hero === 'taco' ? ' taco' : '') + '" viewBox="-31 -36 62 64" aria-hidden="true"><g class="a-bob">' + R.hero(0, 0, 1, theme) + '</g></svg>';
    return RX[id] ? '<svg class="' + (cls || 'rx-ico') + ' rx-' + id + '" viewBox="0 0 32 32" aria-hidden="true">' + RX[id].svg() + '</svg>' : '';
  }
  // Which reactions to offer first for a moment. The hummingbird and MSploit are left out on purpose:
  // they're the secret ones, sent by pressing and holding Strong or Fire in the picker.
  function rxOrder(e) {
    if (!e) return RX_ORDER.other;
    if (e.t === 'cleared') return RX_ORDER.cleared;
    if (e.t === 'escaped') return RX_ORDER.escaped;
    if (e.t === 'start' || e.t === 'skip' || e.t === 'lost-turn' || e.t === 'gate-closed' || (e.t === 'move' && e.n < 0) || e.t === 'claim-rejected') return RX_ORDER.bad;
    if (e.t === 'pass' || e.t === 'shield-used' || e.t === 'warp' || (e.t === 'move' && e.n > 0)) return RX_ORDER.good;
    return RX_ORDER.other;
  }
  // One event's reactions as { id: [player ids] }, with old emoji reactions folded in.
  function rxCounts(r) {
    var out = {}, L = E.LEGACY_REACTIONS || {};
    Object.keys(r || {}).forEach(function (k) {
      var id = E.REACTIONS.indexOf(k) >= 0 ? k : L[k]; if (!id) return;
      (r[k] || []).forEach(function (q) { out[id] = out[id] || []; if (out[id].indexOf(q) < 0) out[id].push(q); });
    });
    return out;
  }

  root.CGFx = { rxIcon: rxIcon, rxLabel: rxLabel, rxOrder: rxOrder, rxCounts: rxCounts, Camera: Camera, fx: fx, grade: grade, BADGES: BADGES, BADGE_BY: BADGE_BY, badgesFor: badgesFor, flair: flair, rivals: rivals, shareCard: shareCard, eggLine: eggLine, eggContext: eggContext, DIZZY: DIZZY, LEGEND: LEGEND, still: still };
})(typeof globalThis !== 'undefined' ? globalThis : this);
