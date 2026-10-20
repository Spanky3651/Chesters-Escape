/*
 * Chester's Escape - card editor (the Cards tab of the designer).
 * Rewrite a theme's 20 cards and 14 event space names, preview them as real cards,
 * and download a card pack file to send to the host. What each card does stays fixed.
 */
(function () {
  'use strict';
  var C = window.CGContent, R = window.CGRender;
  var $ = function (id) { return document.getElementById(id); };
  var esc = R.esc;
  var DRAFT = 'cg.designer.cards', LIMITS = { title: 40, text: 160, art: 16, kind: 40 };
  var COLORS = { treasure: 'var(--treasure)', trick: 'var(--trick)', task: 'var(--task)', fate: 'var(--fate)' };
  var GROUPS = [['treasure', 'Moves you ahead or protects you'], ['trick', 'Sends you back or costs you turns'], ['task', 'One more map before the next roll'], ['fate', 'Luck either way']];

  var drafts = load(), themes = Object.keys(C.themes), themeId = themes[0];

  function load() { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') || { themes: {} }; } catch (e) { return { themes: {} }; } }
  function save() {
    drafts.last = themeId;
    try { localStorage.setItem(DRAFT, JSON.stringify(drafts)); return true; }
    catch (e) { toast('This browser is out of room for more pictures. Remove one or use smaller pictures.', 'bad'); return false; }
  }
  function toast(msg, kind) { var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (kind ? ' ' + kind : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast'; }, 3500); }
  function track(name) { try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: 'designer/' + name, title: name, event: true }); } catch (e) {} }

  function theme() { return C.themes[themeId]; }
  function draft() { var d = drafts.themes[themeId] = drafts.themes[themeId] || {}; d.cards = d.cards || {}; d.kinds = d.kinds || {}; return d; }
  function defaults() { return C.cardsFor(themeId); }
  // The card as it would play: the default wording with this draft's edits on top.
  function cards() {
    var d = draft();
    return defaults().map(function (c) {
      var e = d.cards[c.id] || {}, basePic = R.isImg(c.art) ? c.art : '', baseEmoji = basePic ? '' : c.art;
      return Object.assign({}, c, { title: e.title != null ? e.title : c.title, emoji: e.art != null ? e.art : baseEmoji, pic: e.pic != null ? e.pic : basePic, text: e.text != null ? e.text : c.text });
    });
  }
  // A card counts as changed when its words, emoji or picture differ from the theme's own.
  function differs(c, b) { var bp = R.isImg(b.art) ? b.art : '', be = bp ? '' : b.art; return c.title !== b.title || c.emoji !== be || c.pic !== bp || c.text !== b.text; }
  function kinds() {
    var d = draft(), k = theme().kinds, out = {};
    Object.keys(k).forEach(function (id) { var e = d.kinds[id] || {}; out[id] = { title: e.title != null ? e.title : k[id].title, icon: e.icon != null ? e.icon : k[id].icon }; });
    return out;
  }
  function changedCards() { var base = {}; defaults().forEach(function (c) { base[c.id] = c; }); return cards().filter(function (c) { return differs(c, base[c.id]); }).map(function (c) { return c.id; }); }
  function changedKinds() { var k = theme().kinds, now = kinds(); return Object.keys(k).filter(function (id) { return now[id].title !== k[id].title || now[id].icon !== k[id].icon; }); }

  function cardFace(card) {
    var t = theme();
    return '<div class="cprev" style="--cc:' + COLORS[card.cls] + '"><div class="cprev-in"><div class="cface cfront">' +
      '<div class="ctype">' + esc(t.card[card.cls] || 'Card') + '</div><div class="cart' + (card.pic ? ' pic' : '') + '" aria-hidden="true">' + R.cardArt(card.pic || card.emoji) + '</div>' +
      '<div class="ctitle">' + esc(card.title) + '</div><div class="ctext">' + esc(card.text) + '</div><div class="cfx">' + esc(C.cardEffectText(card)) + '</div></div></div></div>';
  }
  function field(id, label, value, max, kind) {
    var tag = kind === 'area' ? '<textarea rows="3"' : '<input type="text"';
    return '<label class="ce-f"><span>' + label + ' <em class="cnt">' + String(value).length + '/' + max + '</em></span>' + tag + ' data-f="' + id + '" maxlength="' + max + '"' +
      (kind === 'area' ? '>' + esc(value) + '</textarea>' : ' value="' + esc(value) + '">') + '</label>';
  }

  function render() {
    var t = theme(), list = cards(), base = {}, d = draft();
    defaults().forEach(function (c) { base[c.id] = c; });
    document.body.setAttribute('data-theme', t.look || t.id);
    R.setFavicon(t);
    $('brandCrow').innerHTML = R.hero(0, 0, 1, t);
    $('ceTheme').innerHTML = themes.map(function (k) { return '<option value="' + k + '"' + (k === themeId ? ' selected' : '') + '>' + esc(C.themes[k].name) + '</option>'; }).join('');
    $('ceAuthor').value = drafts.author || '';
    var html = '';
    GROUPS.forEach(function (g) {
      var group = list.filter(function (c) { return c.cls === g[0]; });
      html += '<section class="ce-group"><h2>' + esc(t.card[g[0]] || g[0]) + ' <span class="muted">(' + group.length + ')</span></h2><p class="why">' + g[1] + '. You can change the words; what the card does stays the same.</p>';
      group.forEach(function (c) {
        var b = base[c.id], changed = differs(c, b);
        html += '<article class="ce-card' + (changed ? ' changed' : '') + '" data-card="' + c.id + '">' + cardFace(c) +
          '<div class="ce-fields"><div class="ce-head"><b>Card ' + c.id.slice(1) + '</b>' + (changed ? '<span class="ce-badge">Changed</span><button type="button" class="btn small link" data-reset="' + c.id + '">Undo changes</button>' : '') + '</div>' +
          '<div class="ce-row">' + field('art', 'Emoji', c.emoji, LIMITS.art) + field('title', 'Title', c.title, LIMITS.title) + '</div>' +
          '<div class="ce-pic">' + (c.pic ? '<img src="' + esc(c.pic) + '" alt="Your picture for this card">' : '') +
          '<label class="btn small ghost file">' + (c.pic ? 'Replace picture' : 'Add a picture') + '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-pic="' + c.id + '" hidden></label>' +
          (c.pic ? '<button type="button" class="btn small link" data-unpic="' + c.id + '">Remove picture</button>' : '<span class="hint">Optional. A picture replaces the emoji on the card. Best at 3:2, like 600 × 400.</span>') + '</div>' +
          field('text', 'Card text', c.text, LIMITS.text, 'area') +
          '<p class="ce-fx">What it does: <b>' + esc(C.cardEffectText(c)) + '</b></p>' +
          (changed ? '<p class="ce-was">Was: ' + esc((R.isImg(b.art) ? '' : b.art + ' ') + b.title) + '. ' + esc(b.text) + '</p>' : '') + '</div></article>';
      });
      html += '</section>';
    });
    var k = theme().kinds, now = kinds();
    html += '<section class="ce-group"><h2>Event spaces <span class="muted">(14)</span></h2><p class="why">The names on the board spaces in this theme. Where each one sits and what it does comes from the board.</p><div class="ce-kinds">';
    Object.keys(k).forEach(function (id) {
      var changed = now[id].title !== k[id].title || now[id].icon !== k[id].icon;
      html += '<div class="ce-kind' + (changed ? ' changed' : '') + '" data-kind="' + id + '"><input type="text" class="ce-icon" data-f="icon" maxlength="16" value="' + esc(now[id].icon) + '" aria-label="Icon">' +
        '<input type="text" data-f="title" maxlength="' + LIMITS.kind + '" value="' + esc(now[id].title) + '" aria-label="Name">' +
        (changed ? '<button type="button" class="btn small link" data-reset-kind="' + id + '" title="Was: ' + esc(k[id].icon + ' ' + k[id].title) + '">Undo</button>' : '') + '</div>';
    });
    html += '</div></section>';
    $('ceList').innerHTML = html;
    status();
  }
  function status() {
    var c = changedCards().length, k = changedKinds().length;
    $('ceStatus').textContent = (c || k) ? c + ' of 20 cards and ' + k + ' of 14 space names changed in ' + theme().name + '.' : 'Nothing changed yet in ' + theme().name + '.';
    $('ceDownload').disabled = !(c || k);
  }

  // Typing updates the card preview in place so the text box keeps its cursor.
  function onInput(e) {
    var f = e.target.getAttribute('data-f'); if (!f) return;
    var cardEl = e.target.closest('[data-card]'), kindEl = e.target.closest('[data-kind]'), d = draft();
    var cnt = e.target.parentNode.querySelector('.cnt'); if (cnt) cnt.textContent = e.target.value.length + '/' + e.target.maxLength;
    if (cardEl) {
      var id = cardEl.getAttribute('data-card'), e2 = d.cards[id] = d.cards[id] || {};
      e2[f] = e.target.value;
      var c = cards().filter(function (x) { return x.id === id; })[0];
      cardEl.querySelector('.cprev').outerHTML = cardFace(c);
      cardEl.classList.add('changed');
    }
    if (kindEl) { var kid = kindEl.getAttribute('data-kind'); (d.kinds[kid] = d.kinds[kid] || {})[f] = e.target.value; kindEl.classList.add('changed'); }
    save(); status();
  }

  function pack() {
    var list = cards(), out = { type: 'chesters-escape-card-pack', version: 2, theme: themeId, themeName: theme().name, author: drafts.author || '', made: new Date().toISOString(), changed: changedCards().concat(changedKinds()), cards: {}, kinds: kinds() };
    list.forEach(function (c) { out.cards[c.id] = { title: c.title, art: c.emoji, text: c.text, does: C.cardEffectText(c) }; if (c.pic) out.cards[c.id].pic = c.pic; });
    return out;
  }
  function download() {
    var p = pack();
    if (!p.changed.length) { toast('Change a card or a space name first.', 'bad'); return; }
    if (!p.author) { toast('Add your name first so MSploit knows who sent it.', 'bad'); $('ceAuthor').focus(); return; }
    track('card-pack-download');
    var blob = new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (theme().name + ' cards ' + p.author).replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '') + '.cards.json'; a.click();
    toast('Downloaded. Send the file to MSploit in Discord.', 'good');
  }
  function open(file) {
    file.text().then(function (txt) {
      var p = JSON.parse(txt);
      if (p.type !== 'chesters-escape-card-pack' || !C.themes[p.theme]) throw new Error('not a pack');
      var had = drafts.themes[p.theme] && (Object.keys(drafts.themes[p.theme].cards || {}).length || Object.keys(drafts.themes[p.theme].kinds || {}).length);
      if (had && !confirm('Replace your own edits for ' + C.themes[p.theme].name + ' with this card pack?')) return;
      if (themes.indexOf(p.theme) < 0) themes.push(p.theme);
      themeId = p.theme;
      var d = drafts.themes[themeId] = { cards: {}, kinds: {} };
      Object.keys(p.cards || {}).forEach(function (id) { var c = p.cards[id]; d.cards[id] = { title: String(c.title || '').slice(0, LIMITS.title), art: String(c.art || '').slice(0, LIMITS.art), text: String(c.text || '').slice(0, LIMITS.text) };
        if (typeof c.pic === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(c.pic) && c.pic.length < 900000) d.cards[id].pic = c.pic; });
      Object.keys(p.kinds || {}).forEach(function (id) { if (theme().kinds[id]) { var k = p.kinds[id]; d.kinds[id] = { title: String(k.title || '').slice(0, LIMITS.kind), icon: String(k.icon || '').slice(0, 16) }; } });
      save(); render(); track('card-pack-open');
      toast('Opened ' + (p.author ? p.author + "'s " : '') + 'card pack for ' + theme().name + '.', 'good');
    }).catch(function () { toast("That file isn't a card pack from this editor.", 'bad'); });
  }

  // ---- card pictures -------------------------------------------------------------------------
  // Shrink to fit the card's art box (up to 640 px wide) so 20 pictures still fit in the browser and
  // in one Discord message. WebP keeps transparency; browsers without it get a JPEG.
  function addPicture(id, file) {
    if (!/^image\//.test(file.type)) { toast("That file isn't a picture.", 'bad'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('That picture is too big. Use one under 20 MB.', 'bad'); return; }
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      var s = Math.min(1, 640 / img.width, 480 / img.height), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
      var g = cv.getContext('2d'), data;
      g.drawImage(img, 0, 0, cv.width, cv.height);
      data = cv.toDataURL('image/webp', .82);
      if (!/^data:image\/webp/.test(data)) { g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#f3eee2'; g.fillRect(0, 0, cv.width, cv.height); data = cv.toDataURL('image/jpeg', .85); }
      var d = draft(), e = d.cards[id] = d.cards[id] || {}, before = e.pic;
      e.pic = data;
      if (!save()) { if (before === undefined) delete e.pic; else e.pic = before; return; }
      track('card-picture'); render(); toast('Picture added to card ' + id.slice(1) + '.', 'good');
    };
    img.onerror = function () { URL.revokeObjectURL(url); toast("That picture couldn't be read.", 'bad'); };
    img.src = url;
  }

  // ---- Board / Cards tabs ----------------------------------------------------------------------
  function setMode(cardsMode) {
    document.body.classList.toggle('cards-mode', cardsMode);
    $('modeBoard').setAttribute('aria-selected', String(!cardsMode));
    $('modeCards').setAttribute('aria-selected', String(cardsMode));
    $('cardsMain').hidden = !cardsMode;
    document.querySelector('main.dz').hidden = cardsMode;
    document.title = cardsMode ? 'Card editor' : 'Board designer';
    document.querySelector('.brand h1').textContent = cardsMode ? 'Card editor' : 'Board designer';
    history.replaceState(null, '', location.pathname + location.search + (cardsMode ? '#cards' : ''));
    if (cardsMode) render();
    else { var bt = $('bTheme'); if (bt) bt.dispatchEvent(new Event('change')); }
  }

  function bind() {
    $('modeBoard').onclick = function () { setMode(false); };
    $('modeCards').onclick = function () { setMode(true); track('cards-tab'); };
    $('ceTheme').onchange = function () { themeId = this.value; save(); render(); };
    $('ceAuthor').oninput = function () { drafts.author = this.value.slice(0, 40); save(); };
    $('ceList').addEventListener('input', onInput);
    $('ceList').addEventListener('change', function (e) {
      var f = e.target.getAttribute && e.target.getAttribute('data-pic');
      if (f && e.target.files && e.target.files[0]) addPicture(f, e.target.files[0]);
    });
    $('ceList').addEventListener('click', function (e) {
      var r = e.target.closest('[data-reset]'), rk = e.target.closest('[data-reset-kind]'), up = e.target.closest('[data-unpic]'), d = draft();
      if (up) { var u = up.getAttribute('data-unpic'), cur = d.cards[u] = d.cards[u] || {}; cur.pic = ''; save(); render(); return; }
      if (r) { delete d.cards[r.getAttribute('data-reset')]; save(); render(); }
      if (rk) { delete d.kinds[rk.getAttribute('data-reset-kind')]; save(); render(); }
    });
    $('ceDownload').onclick = download;
    $('ceOpen').onchange = function () { var f = this.files && this.files[0]; if (f) open(f); this.value = ''; };
    $('ceReset').onclick = function () {
      if (!changedCards().length && !changedKinds().length) return;
      if (confirm('Throw away all your changes to ' + theme().name + '?')) { delete drafts.themes[themeId]; save(); render(); }
    };
    if (location.hash === '#cards') setMode(true);
  }
  // Offer the themes of the clan game you're signed in to, starting on the one it's using.
  (window.CGDesignerClan || Promise.resolve(null)).then(function (info) {
    themes = window.CGDesignerThemes ? window.CGDesignerThemes(info) : themes;
    themeId = drafts.last && themes.indexOf(drafts.last) >= 0 ? drafts.last : info && info.theme && themes.indexOf(info.theme) >= 0 ? info.theme : themes[0];
    bind();
  });
})();
