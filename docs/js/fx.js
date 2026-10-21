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
    pop: function (svg, xy, text, cls) {
      add(svg, '<g transform="translate(' + xy.x + ',' + (xy.y - 34) + ')"><text class="fx-pop ' + (cls || '') + '" text-anchor="middle">' + esc(text) + '</text></g>', 1500);
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
    { id: 'triple', icon: '🔥', name: 'On Fire', desc: 'Cleared three maps in one day' },
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
    var cleared = {}, runs = {}, sent = {};
    s.events.forEach(function (e) {
      var p = s.players[e.pid]; if (!p) return;
      if (e.t === 'cleared') {
        var k = e.pid + '|' + e.day; cleared[k] = (cleared[k] || 0) + 1; if (cleared[k] >= 3) give(e.pid, 'triple');
        if (e.proof && e.proof.acc >= 0.95) give(e.pid, 'golden');
      }
      if (e.t === 'roll') { runs[e.pid] = e.n === 4 ? (runs[e.pid] || 0) + 1 : 0; if (runs[e.pid] >= 3) give(e.pid, 'fours'); }
      if (e.t === 'shield-used') give(e.pid, 'shield');
      if (e.t === 'start') sent[e.pid] = 1;
      if (e.t === 'warp' && p.route && b.routes[p.route]) { var r = b.routes[p.route]; if (r.indexOf(e.to) > r.indexOf(e.space)) give(e.pid, 'current'); }
    });
    s.order.forEach(function (pid) {
      var p = s.players[pid];
      if (p.finished) { if (p.finished.place === 1) give(pid, 'first'); if (p.route === 'riskier') give(pid, 'risk'); if (sent[pid]) give(pid, 'phoenix'); }
    });
    // Reactions on your moments.
    var got = {};
    Object.keys(s.reactions || {}).forEach(function (id) {
      var ev = null; for (var i = s.events.length - 1; i >= 0; i--) if (s.events[i].id === Number(id)) { ev = s.events[i]; break; }
      if (!ev || !ev.pid) return;
      var r = s.reactions[id]; Object.keys(r).forEach(function (em) { got[ev.pid] = (got[ev.pid] || 0) + r[em].filter(function (q) { return q !== ev.pid; }).length; });
    });
    Object.keys(got).forEach(function (pid) { if (got[pid] >= 10) give(pid, 'crowd'); });
    // Comeback: dead last at the start of some day (with 4+ racing), top half now.
    var racers = s.order.filter(function (pid) { return s.players[pid].route; });
    if (racers.length >= 4) {
      var wasLast = {};
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

  // ---- token flair: crown for the leader, lantern for last place ----
  function flair(s) {
    var o = { crown: null, lantern: null };
    if (s.status !== 'running') return o;
    var rank = E.ranking(s).filter(function (r) { return !r.escaped; });
    if (rank.length >= 2 && rank[0].left < rank[1].left && s.players[rank[0].pid].pos >= 0) o.crown = rank[0].pid;
    if (rank.length >= 3) { var a = rank[rank.length - 1], b = rank[rank.length - 2]; if (a.left > b.left) o.lantern = a.pid; }
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
    chester: ['Caw! I am not lost. I am exploring.', 'Have you tried Slower Song?', 'Do not tell the gravekeeper I am out here.', 'One more map, then bed. Probably.', 'I saw a 4 once. It was beautiful.'],
    taco: ['Extra cheese, please!', 'I am not a snack. I am a contestant.', 'Has anyone seen my hat?', 'Hot sauce gives me +2 speed.', 'Crunchy shell, soft heart.'],
    grave: ['Boo!', 'Shh, I am resting.', 'Five more minutes...'],
    tree: ['*bats scatter*', 'Creak...'],
    turkey: ['GOBBLE!', 'Not today, chef.', 'Gobble gobble?'],
    scarecrow: ['*crows scatter*', 'Hay there.'],
    pumpkin: ['*grins*', 'Pie? Never heard of it.'],
    snowman: ['Do you want to build a... never mind.', 'Brr!', '*hat flies off*'],
    present: ['Not until the 25th!', '*rattle rattle*']
  };
  function eggLine(kind, theme, n) {
    var list = LINES[kind === 'hero' ? (theme.hero === 'taco' ? 'taco' : 'chester') : kind] || LINES.grave;
    return list[n % list.length];
  }

  // ---- the game's reactions --------------------------------------------------------------------
  // Drawn as small pictures (no emoji font differences between phones and PCs).
  var BLACK = "'Arial Black', 'Atkinson Hyperlegible', Arial, sans-serif";
  function txt(x, y, size, fill, stroke, sw, t, extra) { return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="' + BLACK + '" font-weight="900" font-size="' + size + '" fill="' + fill + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + sw + '" paint-order="stroke" stroke-linejoin="round"' : '') + (extra || '') + '>' + t + '</text>'; }
  var RX = {
    gg: { label: 'GG', svg: function () { return '<rect x="2" y="7" width="28" height="18" rx="6" fill="#26b33f"/><rect x="3.5" y="8.5" width="25" height="7" rx="4" fill="#7ef08a" opacity=".45"/>' + txt(16, 21.3, 13, '#fff', '#0b4416', 2.6, 'GG'); } },
    fc: { label: 'Full combo', svg: function () { return '<circle cx="16" cy="17" r="12.5" fill="#ffc93a" stroke="#a46d06" stroke-width="2"/><circle cx="16" cy="17" r="9" fill="none" stroke="#fff4b8" stroke-width="1.2" opacity=".85"/>' + txt(16, 21.4, 11.5, '#5a3800', '', 0, 'FC') + '<path d="M26.5 1.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" fill="#fff"/>'; } },
    ss: { label: 'SS rank', svg: function () { return '<g transform="rotate(-10 16 16)"><circle cx="16" cy="16" r="13" fill="#121212" stroke="#ffd34d" stroke-width="2.6"/>' + txt(16, 20.6, 12.5, '#ffd34d', '', 0, 'SS') + '</g>'; } },
    sabers: { label: "Let's go", svg: function () {
      return '<g stroke-linecap="round"><line x1="8" y1="24" x2="27" y2="4" stroke="#ff3b4a" stroke-width="6" opacity=".28"/><line x1="8" y1="24" x2="27" y2="4" stroke="#ff5a66" stroke-width="3"/><line x1="8" y1="24" x2="27" y2="4" stroke="#ffd6da" stroke-width="1"/>' +
        '<line x1="24" y1="24" x2="5" y2="4" stroke="#2f86ff" stroke-width="6" opacity=".28"/><line x1="24" y1="24" x2="5" y2="4" stroke="#4d9bff" stroke-width="3"/><line x1="24" y1="24" x2="5" y2="4" stroke="#d6e8ff" stroke-width="1"/>' +
        '<line x1="3.5" y1="28.8" x2="8.5" y2="23.5" stroke="#2b2b2b" stroke-width="4.2"/><line x1="28.5" y1="28.8" x2="23.5" y2="23.5" stroke="#2b2b2b" stroke-width="4.2"/><line x1="7.3" y1="22.5" x2="10" y2="25.3" stroke="#bbb" stroke-width="1.6"/><line x1="24.7" y1="22.5" x2="22" y2="25.3" stroke="#bbb" stroke-width="1.6"/></g>';
    } },
    miss: { label: 'Miss', svg: function () { return '<rect x="7.5" y="7.5" width="17" height="17" rx="3.5" fill="#6a2028" stroke="#a83a46" stroke-width="1" transform="rotate(14 16 16)"/><path d="M12 12.5l4 4.5 4-4.5" fill="none" stroke="#ff8a95" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="rotate(14 16 16)" opacity=".7"/>' + txt(16.5, 21, 9.6, '#ff3b4a', '#1a0004', 2.8, 'MISS', ' transform="skewX(-12) translate(3.4 0)"'); } },
    bomb: { label: 'Hit a bomb', svg: function () { return '<circle cx="14.5" cy="18.5" r="10" fill="#22222b" stroke="#000" stroke-width="1"/><circle cx="11" cy="15" r="3" fill="#fff" opacity=".3"/><rect x="17.5" y="6.5" width="6" height="5" rx="1.2" fill="#5b5b66" transform="rotate(40 20.5 9)"/><path d="M22.5 7.5q2.5-4.5 6-3.4" fill="none" stroke="#c9a46a" stroke-width="1.6" stroke-linecap="round"/><path d="M28.6 0.8l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#ffb02e"/><circle cx="28.6" cy="4" r="1.1" fill="#fff6c8"/>'; } },
    salt: { label: 'Salty', svg: function () { return '<path d="M10.2 13h11.6l-1.4 14.4a2.2 2.2 0 0 1-2.2 2H13.8a2.2 2.2 0 0 1-2.2-2z" fill="#f5f7f9" stroke="#8d9aa6" stroke-width="1.2"/><path d="M10.6 13q0-7.6 5.4-7.6t5.4 7.6z" fill="#aab6c2" stroke="#7c8894" stroke-width="1"/><circle cx="14.2" cy="9.6" r=".9" fill="#56606a"/><circle cx="17.8" cy="9.6" r=".9" fill="#56606a"/><circle cx="16" cy="7.8" r=".9" fill="#56606a"/>' + txt(16, 23.6, 5, '#5f6c78', '', 0, 'SALT', ' textLength="8.6" lengthAdjust="spacingAndGlyphs"') + '<rect x="5" y="3" width="1.8" height="1.8" fill="#fff" transform="rotate(20 6 4)"/><rect x="3.2" y="7.5" width="1.5" height="1.5" fill="#fff"/><rect x="6.5" y="9.5" width="1.4" height="1.4" fill="#fff" transform="rotate(35 7 10)"/>'; } },
    rip: { label: 'RIP', svg: function () { return '<path d="M8 28.5V13.5a8 8 0 0 1 16 0v15z" fill="#a3a9ac" stroke="#5d6366" stroke-width="1.5"/><path d="M10 13.5a6 6 0 0 1 6-6" fill="none" stroke="#fff" stroke-width="1.2" opacity=".5"/>' + txt(16, 21.8, 7.6, '#3b4043', '', 0, 'RIP') + '<path d="M4 29.2h24" stroke="#4f8a2b" stroke-width="2.6" stroke-linecap="round"/>'; } },
    hero: { label: '', svg: null }
  };
  var RX_ORDER = {
    cleared: ['ss', 'fc', 'gg', 'sabers', 'salt', 'hero', 'miss', 'bomb', 'rip'],
    escaped: ['gg', 'hero', 'sabers', 'salt', 'ss', 'fc', 'rip', 'bomb', 'miss'],
    bad: ['rip', 'bomb', 'miss', 'salt', 'gg', 'hero', 'sabers', 'fc', 'ss'],
    good: ['sabers', 'salt', 'gg', 'hero', 'fc', 'ss', 'rip', 'bomb', 'miss'],
    other: ['gg', 'hero', 'sabers', 'salt', 'rip', 'bomb', 'miss', 'fc', 'ss']
  };
  function rxLabel(id, theme) { return id === 'hero' ? (theme && theme.hero === 'taco' ? 'Taco!' : 'Caw!') : (RX[id] ? RX[id].label : ''); }
  function rxIcon(id, theme, cls) {
    if (id === 'hero') return '<svg class="' + (cls || 'rx-ico') + '" viewBox="-36 -40 72 76" aria-hidden="true">' + R.hero(0, 0, 1, theme) + '</svg>';
    return RX[id] ? '<svg class="' + (cls || 'rx-ico') + '" viewBox="0 0 32 32" aria-hidden="true">' + RX[id].svg() + '</svg>' : '';
  }
  // Which reactions to offer first for a moment (all nine are always there).
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

  root.CGFx = { rxIcon: rxIcon, rxLabel: rxLabel, rxOrder: rxOrder, rxCounts: rxCounts, Camera: Camera, fx: fx, grade: grade, BADGES: BADGES, BADGE_BY: BADGE_BY, badgesFor: badgesFor, flair: flair, rivals: rivals, shareCard: shareCard, eggLine: eggLine, still: still };
})(typeof globalThis !== 'undefined' ? globalThis : this);
