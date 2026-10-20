/*
 * Chester's Escape - board designer.
 */
(function () {
  'use strict';
  var E = window.CGEngine, C = window.CGContent, R = window.CGRender;
  var $ = function (id) { return document.getElementById(id); };
  var esc = R.esc;
  var WORK = 'cg.designer.work', SAVED = 'cg.designer.board';
  var CELL = C.CELL, PAD = C.PAD;

  var board = load() || C.boards['chester-escape']();
  var themeId = 'cemetery', route = 'longer', tool = 'select', sel = null, drag = null, seq = 0;

  function load() { try { return JSON.parse(localStorage.getItem(WORK) || 'null'); } catch (e) { return null; } }
  function persist() {
    try { localStorage.setItem(WORK, JSON.stringify(board)); }
    catch (e) { toast('This browser is out of room for the board. Use a smaller background image.', 'bad'); }
  }
  var toastT;
  function toast(msg, kind) { var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : ''); clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, 3500); }
  function theme() { return C.themes[themeId]; }
  function track(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'designer/' + name, title: name, event: true }); } catch (e) {} }
  function newId() { var id; do { id = 'x' + (++seq); } while (board.spaces[id]); return id; }
  function snapXY(x, y) {
    if (!$('snap').checked) return { x: Math.round(x), y: Math.round(y) };
    var c = Math.max(0, Math.min(14, Math.floor((x - PAD) / CELL))), r = Math.max(0, Math.min(14, Math.floor((y - PAD) / CELL)));
    return { x: PAD + c * CELL + CELL / 2, y: PAD + r * CELL + CELL / 2 };
  }
  function svgPoint(svg, ev) {
    var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function spaceLabel(sp) {
    var k = sp.kind && theme().kinds[sp.kind];
    if (sp.type === 'map') return '!bsr ' + (sp.bsr || []).join(' or ');
    if (sp.type === 'card') return 'Card drop';
    if (sp.type === 'task') return (k ? k.title : 'Blocker') + ' !bsr ' + (sp.bsr || []).join(' or ');
    return (k ? k.title + ' ' : '') + '(' + C.spaceEffectText(sp).toLowerCase() + ')';
  }

  // ---- render ------------------------------------------------------------------
  function render() {
    var t = theme();
    document.body.setAttribute('data-theme', t.look || t.id);
    $('brandCrow').innerHTML = R.hero(0, 0, 1, t);
    var wrap = $('dzWrap');
    wrap.innerHTML = R.board(board, t, { selected: sel, designer: true, still: true });
    wrap.className = 'board-wrap dz-wrap tool-' + tool;
    var svg = wrap.querySelector('svg');
    if ($('showOrder').checked) drawOrder(svg);
    if (sel) { var g = svg.querySelector('.sp[data-id="' + sel + '"]'); if (g) g.classList.add('sel'); }
    renderSteps(); renderSpace(); renderProblems();
    $('bTitle').value = board.title || '';
    $('rName').value = (board.routeInfo[route] || {}).name || '';
    $('rBlurb').value = (board.routeInfo[route] || {}).blurb || '';
    $('bonus').value = (board.bonusMaps || []).join(', ');
    $('artSpaces').checked = !!board.artSpaces; $('artSpaces').disabled = !board.background;
    $('addToRoute').disabled = !sel || board.routes[route].indexOf(sel) >= 0;
    $('routeTabs').innerHTML = Object.keys(board.routes).map(function (r) { return '<button type="button" role="tab" data-route="' + r + '" aria-selected="' + (r === route) + '">' + esc((board.routeInfo[r] || {}).name || r) + '</button>'; }).join('');
  }
  function drawOrder(svg) {
    var list = board.routes[route], pts = [];
    var st = board.starts && board.starts[route]; if (st) pts.push(st.x + ',' + st.y);
    list.forEach(function (id) { var sp = board.spaces[id]; if (sp) pts.push(sp.x + ',' + sp.y); });
    var o = '<g class="order-badge"><polyline points="' + pts.join(' ') + '" fill="none" stroke="#f2a33a" stroke-width="4" stroke-dasharray="8 8" opacity=".85"/>';
    list.forEach(function (id, i) {
      var sp = board.spaces[id]; if (!sp) return;
      o += '<circle cx="' + (sp.x + 22) + '" cy="' + (sp.y - 22) + '" r="11" fill="#f2a33a" stroke="#000" stroke-width="2"/><text x="' + (sp.x + 22) + '" y="' + (sp.y - 18) + '" text-anchor="middle" font-family="Atkinson Hyperlegible, Arial" font-weight="700" font-size="11" fill="#1a0f00">' + (i + 1) + '</text>';
    });
    svg.querySelector('.tokens').insertAdjacentHTML('beforeend', o + '</g>');
  }
  function renderSteps() {
    var list = board.routes[route];
    $('steps').innerHTML = list.map(function (id, i) {
      var sp = board.spaces[id];
      return '<li data-id="' + esc(id) + '" class="' + (id === sel ? 'sel' : '') + '"><span class="n">' + (i + 1) + '</span><span class="lbl">' + esc(sp ? spaceLabel(sp) : 'Missing space') + '</span>' +
        '<span class="acts"><button type="button" data-mv="-1" data-i="' + i + '" aria-label="Move up">&uarr;</button><button type="button" data-mv="1" data-i="' + i + '" aria-label="Move down">&darr;</button><button type="button" data-rm="' + i + '" aria-label="Remove from route">&times;</button></span></li>';
    }).join('') || '<li class="empty">No spaces yet. Pick Add spaces and click the board.</li>';
  }
  function renderSpace() {
    var el = $('spaceEdit'), sp = sel && board.spaces[sel];
    if (!sp) { el.innerHTML = '<p class="empty">Select a space on the board to edit it.</p>'; return; }
    var t = theme(), kinds = Object.keys(t.kinds);
    var inRoutes = Object.keys(board.routes).filter(function (r) { return board.routes[r].indexOf(sp.id) >= 0; }).map(function (r) { return board.routeInfo[r].name + ' step ' + (board.routes[r].indexOf(sp.id) + 1); });
    var types = [['map', 'Map: play a map'], ['task', 'Blocker: play its map to continue'], ['card', 'Card drop'], ['move', 'Move ahead or back'], ['skip', 'Lose turns'], ['start', 'Back to the start'], ['warp', 'Carry to another space'], ['safe', 'Safe space'], ['exit', 'Exit (the goal)']];
    var html = '<div class="field"><label for="sType">What happens here</label><select id="sType">' + types.map(function (x) { return '<option value="' + x[0] + '"' + (sp.type === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></div>';
    if (sp.type !== 'map' && sp.type !== 'card') {
      html += '<div class="field"><label for="sKind">Event art and name</label><select id="sKind"><option value="">None</option>' + kinds.map(function (k) { return '<option value="' + k + '"' + (sp.kind === k ? ' selected' : '') + '>' + t.kinds[k].icon + ' ' + esc(t.kinds[k].title) + '</option>'; }).join('') + '</select><span class="hint">Each theme shows its own version of this event.</span></div>';
    }
    if (sp.type === 'map' || sp.type === 'task') html += '<div class="field"><label for="sBsr">Map key</label><input type="text" id="sBsr" value="' + esc((sp.bsr || []).join(', ')) + '" placeholder="4fde6"><span class="hint">Two keys separated by a comma means the player picks either one.</span></div>';
    if (sp.type === 'move') html += '<div class="field"><label for="sN">Spaces to move</label><input type="number" id="sN" value="' + (sp.n || 0) + '"><span class="hint">Positive moves ahead, negative moves back.</span></div>';
    if (sp.type === 'skip') html += '<div class="field"><label for="sTurns">Turns lost</label><input type="number" id="sTurns" min="1" max="5" value="' + (sp.turns || 1) + '"></div>';
    if (sp.type === 'warp') html += '<div class="field"><label for="sTo">Carries the player to</label><select id="sTo"><option value="">Pick a space</option>' + Object.keys(board.spaces).filter(function (id) { return id !== sp.id; }).map(function (id) { return '<option value="' + esc(id) + '"' + (sp.to === id ? ' selected' : '') + '>' + esc(stepName(id)) + '</option>'; }).join('') + '</select><span class="hint">The space it lands on applies, so a current can drop someone onto a lose-a-turn space.</span></div>';
    html += '<p class="why">' + (inRoutes.length ? 'On the ' + esc(inRoutes.join(' and ')) : 'Not on any route yet') + '.</p>';
    html += '<div class="row"><button type="button" class="btn small danger" id="sDelete">Delete space</button></div>';
    el.innerHTML = html;
  }
  function stepName(id) {
    var sp = board.spaces[id], where = [];
    Object.keys(board.routes).forEach(function (r) { var i = board.routes[r].indexOf(id); if (i >= 0) where.push((r === 'longer' ? 'L' : r === 'riskier' ? 'R' : r) + (i + 1)); });
    return (where.join('/') || id) + ': ' + spaceLabel(sp);
  }
  function renderProblems() {
    var probs = E.checkBoard(board), el = $('problems');
    el.className = 'problems' + (probs.length ? '' : ' ok');
    el.innerHTML = probs.length ? probs.slice(0, 8).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + (probs.length > 8 ? '<li>and ' + (probs.length - 8) + ' more</li>' : '') : '<li>The board is ready to play.</li>';
  }
  function changed() { persist(); render(); }

  // ---- undo and redo -------------------------------------------------------------
  // A snapshot is taken just before each change. The background image is kept by reference
  // (strings are shared), so a big upload is not copied into every step.
  var past = [], future = [], LIMIT = 100, typing = null;
  function snap() {
    var bg = board.background;
    board.background = null;
    var json = JSON.stringify(board);
    board.background = bg;
    return { json: json, bg: bg, sel: sel, route: route };
  }
  function restore(x) {
    board = JSON.parse(x.json); board.background = x.bg;
    sel = x.sel && board.spaces[x.sel] ? x.sel : null;
    route = board.routes[x.route] ? x.route : Object.keys(board.routes)[0];
  }
  function checkpoint() {
    past.push(snap()); if (past.length > LIMIT) past.shift();
    future = []; updateUndo();
  }
  function undo() {
    if (!past.length) return;
    future.push(snap()); restore(past.pop()); typing = null; changed(); updateUndo();
  }
  function redo() {
    if (!future.length) return;
    past.push(snap()); restore(future.pop()); typing = null; changed(); updateUndo();
  }
  function updateUndo() {
    $('undoBtn').disabled = !past.length; $('redoBtn').disabled = !future.length;
  }
  // Typing in a text box counts as one step per visit to the box, not one per letter.
  function typed(id) { if (typing !== id) { checkpoint(); typing = id; } }

  // ---- board pointer -----------------------------------------------------------
  function onDown(ev) {
    var svg = $('dzWrap').querySelector('svg'); if (!svg || !svg.contains(ev.target)) return;
    var p = svgPoint(svg, ev), g = ev.target.closest('.sp');
    if (tool === 'add') {
      var xy = snapXY(p.x, p.y);
      var clash = Object.keys(board.spaces).filter(function (id) { var s = board.spaces[id]; return Math.abs(s.x - xy.x) < 20 && Math.abs(s.y - xy.y) < 20; })[0];
      if (clash) { sel = clash; addToRoute(clash); return; }
      checkpoint();
      var id = newId();
      board.spaces[id] = { id: id, type: 'map', bsr: [''], x: xy.x, y: xy.y };
      insertIntoRoute(id); sel = id; changed();
      return;
    }
    if (tool === 'start') {
      var sxy = snapXY(p.x, p.y);
      checkpoint();
      board.starts = board.starts || {};
      board.starts[route] = Object.assign({}, board.starts[route] || {}, { x: sxy.x, y: sxy.y });
      changed(); toast('Start marker placed for the ' + board.routeInfo[route].name.toLowerCase() + '.', 'good');
      return;
    }
    if (g) {
      sel = g.dataset.id; var sp = board.spaces[sel];
      drag = { id: sel, ox: p.x - sp.x, oy: p.y - sp.y, moved: false, g: g, svg: svg };
      g.classList.add('dragging');
      svg.setPointerCapture && svg.setPointerCapture(ev.pointerId);
      render();
      drag.g = $('dzWrap').querySelector('.sp[data-id="' + sel + '"]'); drag.svg = $('dzWrap').querySelector('svg');
    } else { sel = null; render(); }
  }
  function onMove(ev) {
    if (!drag) return;
    var p = svgPoint(drag.svg, ev), x = p.x - drag.ox, y = p.y - drag.oy;
    drag.moved = true; drag.x = x; drag.y = y;
    drag.g.setAttribute('transform', 'translate(' + x + ',' + y + ')');
  }
  function onUp() {
    if (!drag) return;
    if (drag.moved) { var xy = snapXY(drag.x, drag.y), sp = board.spaces[drag.id]; if (sp.x !== xy.x || sp.y !== xy.y) { checkpoint(); sp.x = xy.x; sp.y = xy.y; } changed(); }
    drag = null;
  }
  function insertIntoRoute(id) {
    var list = board.routes[route];
    var at = sel ? list.indexOf(sel) : -1;
    if (at >= 0) list.splice(at + 1, 0, id);
    else {
      var last = list.length && board.spaces[list[list.length - 1]];
      if (last && last.type === 'exit') list.splice(list.length - 1, 0, id); else list.push(id);
    }
  }
  function addToRoute(id) {
    if (board.routes[route].indexOf(id) >= 0) { render(); return; }
    checkpoint(); insertIntoRoute(id); changed();
  }

  // ---- side panel events ----------------------------------------------------------
  function bind() {
    var wrap = $('dzWrap');
    wrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
      b.addEventListener('click', function () {
        tool = b.dataset.tool;
        document.querySelectorAll('.tool[data-tool]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $('toolHelp').textContent = { select: 'Click a space to edit it. Drag a space to move it.', add: 'Click the board to add a space after the selected one on this route. Clicking an existing space adds it to this route.', start: "Click where this route's start arrow should go." }[tool];
        render();
      });
    });
    $('snap').onchange = render; $('showOrder').onchange = render;
    $('bTheme').innerHTML = Object.keys(C.themes).map(function (k) { return '<option value="' + k + '">' + esc(C.themes[k].name) + '</option>'; }).join('');
    $('bTheme').onchange = function () { themeId = this.value; render(); };
    $('bTitle').oninput = function () { typed('bTitle'); board.title = this.value; persist(); };
    $('rName').oninput = function () { typed('rName:' + route); board.routeInfo[route].name = this.value; persist(); };
    $('rBlurb').oninput = function () { typed('rBlurb:' + route); board.routeInfo[route].blurb = this.value; persist(); };
    ['bTitle', 'rName', 'rBlurb'].forEach(function (id) { $(id).addEventListener('blur', function () { typing = null; }); });
    $('bonus').onchange = function () { checkpoint(); board.bonusMaps = this.value.split(/[\s,]+/).map(function (k) { return k.replace(/^!bsr/i, '').trim().toLowerCase(); }).filter(Boolean); changed(); };
    $('routeTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-route]'); if (b) { route = b.dataset.route; render(); } });
    $('addToRoute').onclick = function () { if (sel) addToRoute(sel); };
    $('steps').addEventListener('click', function (e) {
      var mv = e.target.closest('[data-mv]'), rm = e.target.closest('[data-rm]'), li = e.target.closest('li[data-id]');
      var list = board.routes[route];
      if (mv) { var i = +mv.dataset.i, j = i + (+mv.dataset.mv); if (j < 0 || j >= list.length) return; checkpoint(); var t = list[i]; list[i] = list[j]; list[j] = t; changed(); return; }
      if (rm) { checkpoint(); list.splice(+rm.dataset.rm, 1); changed(); return; }
      if (li) { sel = li.dataset.id; render(); }
    });
    $('spaceEdit').addEventListener('change', function (e) {
      var sp = board.spaces[sel]; if (!sp) return;
      var t = e.target;
      checkpoint();
      if (t.id === 'sType') {
        sp.type = t.value;
        ['bsr', 'n', 'turns', 'to'].forEach(function (k) { delete sp[k]; });
        if (sp.type === 'map' || sp.type === 'task') sp.bsr = [''];
        if (sp.type === 'move') sp.n = 2;
        if (sp.type === 'skip') sp.turns = 1;
        if (sp.type === 'map' || sp.type === 'card') delete sp.kind;
        if (sp.type === 'exit') sp.kind = 'exit';
      }
      if (t.id === 'sKind') { if (t.value) sp.kind = t.value; else delete sp.kind; }
      if (t.id === 'sBsr') sp.bsr = t.value.split(/[\s,]+/).map(function (k) { return k.replace(/^!bsr/i, '').trim().toLowerCase(); }).filter(Boolean).slice(0, 2);
      if (t.id === 'sN') sp.n = parseInt(t.value, 10) || 0;
      if (t.id === 'sTurns') sp.turns = Math.max(1, parseInt(t.value, 10) || 1);
      if (t.id === 'sTo') sp.to = t.value;
      changed();
    });
    $('spaceEdit').addEventListener('click', function (e) {
      if (e.target.id !== 'sDelete' || !sel) return;
      checkpoint();
      Object.keys(board.routes).forEach(function (r) { board.routes[r] = board.routes[r].filter(function (x) { return x !== sel; }); });
      delete board.spaces[sel]; sel = null; changed();
    });
    $('bgFile').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      shrink(f).then(function (url) { track('upload-art'); checkpoint(); board.background = url; changed(); toast('Background added. Now place a space on each square of the art.', 'good'); }, function () { toast("That image couldn't be read.", 'bad'); });
      this.value = '';
    };
    $('bgClear').onclick = function () { if (!board.background) return; checkpoint(); board.background = null; board.artSpaces = false; changed(); };
    $('artSpaces').onchange = function () { checkpoint(); board.artSpaces = this.checked; changed(); };
    $('saveGame').onclick = function () {
      var probs = E.checkBoard(board);
      if (probs.length) { toast('Fix the problems listed first: ' + probs[0], 'bad'); return; }
      board.routeInfo.longer.blurb = board.routeInfo.longer.blurb || '';
      try { localStorage.setItem(SAVED, JSON.stringify(board)); track('save-for-game'); toast('Saved. In the game, open Host tools and start a new game on the designer board.', 'good'); }
      catch (e) { toast('This browser is out of room. Use a smaller background image.', 'bad'); }
    };
    $('exportBtn').onclick = function () {
      track('download-board');
      var blob = new Blob([JSON.stringify(board, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (board.title || 'board').replace(/[^A-Za-z0-9]+/g, '-') + '.board.json'; a.click();
    };
    $('importFile').onchange = function () {
      var f = this.files && this.files[0]; if (!f) return;
      f.text().then(function (txt) {
        var b = JSON.parse(txt);
        if (!b.spaces || !b.routes) throw new Error('not a board');
        checkpoint(); board = b; sel = null; route = Object.keys(b.routes)[0]; changed(); track('open-board'); toast('Board opened. Undo goes back to the board you had.', 'good');
      }).catch(function () { toast("That file isn't a board file from this designer.", 'bad'); });
      this.value = '';
    };
    $('resetBoard').onclick = function () { if (confirm('Throw away this board and start from Chester\'s Escape?')) { checkpoint(); board = C.boards['chester-escape'](); sel = null; route = 'longer'; changed(); toast('Started over. Undo brings your board back.', 'good'); } };
    $('undoBtn').onclick = undo; $('redoBtn').onclick = redo;
    document.addEventListener('keydown', function (e) {
      var inField = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
      var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      // In a text box, Ctrl+Z stays the browser's own text undo.
      if (mod && !e.altKey && !inField && (k === 'z' || k === 'y')) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $('spaceEdit').querySelector('#sDelete') && $('spaceEdit').querySelector('#sDelete').click(); }
    });
  }
  // Keep uploads small enough to save: scale to 1600px and use JPEG.
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', .86));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  bind(); render(); updateUndo();
})();
