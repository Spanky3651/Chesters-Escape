/*
 * Chester's Escape - the d4.
 * Drawn the way a real d4 is read: you look down on the point, and the
 * number at the top corner of every face is the roll. Each face shows the
 * numbers of its three corners, so the rolled number appears three times
 * around the point, just like the physical die.
 */
(function (root) {
  'use strict';

  // Top-down tetrahedron: outer triangle A B C, apex O in the middle.
  var A = [60, 10], B = [110, 98], Cc = [10, 98], O = [60, 68.7];
  function lerp(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
  function centroid(a, b, c) { return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; }

  function faceSvg(p, q, fill, labels) {
    // labels: [apexValue, pValue, qValue]
    var cen = centroid(O, p, q), o = '';
    o += '<path d="M' + O + ' L' + p + ' L' + q + ' Z" fill="' + fill + '" stroke="rgba(255,255,255,.35)" stroke-width="1.2" stroke-linejoin="round"/>';
    var spots = [lerp(O, cen, .62), lerp(p, cen, .5), lerp(q, cen, .5)];
    spots.forEach(function (sp, i) {
      // rotate each number so its top points at its own corner, as on a real d4
      var corner = i === 0 ? O : i === 1 ? p : q;
      var ang = Math.atan2(corner[1] - sp[1], corner[0] - sp[0]) * 180 / Math.PI + 90;
      o += '<text x="' + sp[0].toFixed(1) + '" y="' + sp[1].toFixed(1) + '" transform="rotate(' + ang.toFixed(1) + ' ' + sp[0].toFixed(1) + ' ' + sp[1].toFixed(1) + ')" ' +
        'text-anchor="middle" dominant-baseline="central" font-family="Atkinson Hyperlegible, Arial, sans-serif" font-weight="700" ' +
        'font-size="' + (i === 0 ? 15 : 11) + '" fill="' + (i === 0 ? '#fff' : 'rgba(255,255,255,.72)') + '">' + labels[i] + '</text>';
    });
    return o;
  }

  function dieSvg(top, rest) {
    // rest: values on corners A, B, C
    return '<svg viewBox="0 0 120 110" class="d4-svg" aria-hidden="true">' +
      '<defs><linearGradient id="d4a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--die-hi)"/><stop offset="1" stop-color="var(--die-mid)"/></linearGradient>' +
      '<linearGradient id="d4b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--die-mid)"/><stop offset="1" stop-color="var(--die-lo)"/></linearGradient>' +
      '<linearGradient id="d4c" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--die-lo)"/><stop offset="1" stop-color="var(--die-mid)"/></linearGradient></defs>' +
      faceSvg(A, B, 'url(#d4a)', [top, rest[0], rest[1]]) +
      faceSvg(B, Cc, 'url(#d4b)', [top, rest[1], rest[2]]) +
      faceSvg(Cc, A, 'url(#d4c)', [top, rest[2], rest[0]]) +
      '</svg>';
  }

  function others(top) { var o = [1, 2, 3, 4].filter(function (x) { return x !== top; }); return o; }
  function shuffled(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function Die(el) {
    this.el = el;
    el.classList.add('d4');
    el.innerHTML = '<div class="d4-shadow"></div><div class="d4-body"></div>';
    this.body = el.querySelector('.d4-body');
    this.show(4);
  }
  Die.prototype.show = function (top) { this.body.innerHTML = dieSvg(top, shuffled(others(top))); this.value = top; };
  // Tumble for ~1.4s, then settle on `value`. Resolves when it has landed.
  Die.prototype.roll = function (value, opts) {
    var self = this, reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    opts = opts || {};
    return new Promise(function (resolve) {
      if (reduced) { self.show(value); self.el.classList.add('landed'); setTimeout(function () { self.el.classList.remove('landed'); resolve(value); }, 250); return; }
      self.el.classList.remove('landed'); void self.el.offsetWidth; self.el.classList.add('rolling');
      var ticks = 0, total = 12;
      function tick() {
        ticks++;
        var face = ticks < total ? 1 + Math.floor(Math.random() * 4) : value;
        self.show(face);
        if (opts.onTick) opts.onTick(ticks);
        if (ticks < total) setTimeout(tick, 60 + ticks * 9);
        else {
          self.el.classList.remove('rolling'); self.el.classList.add('landed');
          setTimeout(function () { self.el.classList.remove('landed'); resolve(value); }, 520);
        }
      }
      tick();
    });
  };

  root.CGDice = { Die: Die, svg: dieSvg };
})(typeof globalThis !== 'undefined' ? globalThis : this);
