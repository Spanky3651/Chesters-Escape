/*
 * Chester's Escape - board renderer (SVG). Shared by the game and the designer.
 * CGRender.board(board, theme, opts) returns an SVG string.
 * CGRender.placeTokens(svgEl, state, theme, opts) positions player tokens.
 */
(function (root) {
  'use strict';
  var C = root.CGContent;

  // A card's art: an emoji, or a picture (an image path in the game, a data URL from the card editor).
  function isImg(s) { return /^(data:image\/(png|jpeg|webp);|img\/|https:\/\/)/.test(String(s || '')); }
  function cardArt(art) { return isImg(art) ? '<img class="cart-img" src="' + esc(art) + '" alt="">' : esc(art); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function rnd(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // ---- decorations -----------------------------------------------------------
  function tombstone(x, y, s, v, pal) {
    var w = 30 * s, h = 38 * s, o = '';
    o += '<g transform="translate(' + x + ',' + y + ')" opacity=".95">';
    o += '<ellipse cx="0" cy="' + (h * .5) + '" rx="' + (w * .7) + '" ry="' + (6 * s) + '" fill="#000" opacity=".25"/>';
    if (v === 0) o += '<path d="M' + (-w / 2) + ',' + (h / 2) + ' V' + (-h / 6) + ' A' + (w / 2) + ',' + (w / 2) + ' 0 0 1 ' + (w / 2) + ',' + (-h / 6) + ' V' + (h / 2) + ' Z" fill="url(#gStone)" stroke="' + pal.stoneDark + '" stroke-width="1.5"/>';
    else if (v === 1) o += '<path d="M' + (-5 * s) + ',' + (h / 2) + ' V' + (-h * .1) + ' H' + (-14 * s) + ' V' + (-h * .3) + ' H' + (-5 * s) + ' V' + (-h * .55) + ' H' + (5 * s) + ' V' + (-h * .3) + ' H' + (14 * s) + ' V' + (-h * .1) + ' H' + (5 * s) + ' V' + (h / 2) + ' Z" fill="url(#gStone)" stroke="' + pal.stoneDark + '" stroke-width="1.5"/>';
    else o += '<path d="M' + (-w / 2) + ',' + (h / 2) + ' V' + (-h * .25) + ' L0,' + (-h * .55) + ' L' + (w / 2) + ',' + (-h * .25) + ' V' + (h / 2) + ' Z" fill="url(#gStone)" stroke="' + pal.stoneDark + '" stroke-width="1.5"/>';
    if (v !== 1) o += '<text x="0" y="' + (2 * s) + '" text-anchor="middle" font-size="' + (8 * s) + '" font-weight="700" fill="' + pal.stoneDark + '" font-family="Georgia,serif">RIP</text>';
    o += '</g>';
    return o;
  }
  // A grey headstone with a cap of snow, for the Christmas board's snowy cemetery.
  function snowyGrave(x, y, s, v, pal) {
    var h = 38 * s, w = 30 * s, top = v === 1 ? -h * .55 : v === 0 ? -h / 6 - w / 2 : -h * .55;
    var cap = '<path d="M' + (-w * .42) + ',' + (top + 6 * s) + ' Q0,' + (top - 7 * s) + ' ' + (w * .42) + ',' + (top + 6 * s) + ' Q0,' + (top + 1 * s) + ' ' + (-w * .42) + ',' + (top + 6 * s) + 'Z" fill="#fff" stroke="#c9dbe8" stroke-width="1"/>';
    return tombstone(x, y, s, v, pal).replace(/url\(#gStone\)/g, 'url(#gGrave)').replace(/<\/g>$/, cap + '</g>');
  }
  function deadTree(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')" stroke="#1b1f17" stroke-linecap="round" fill="none">';
    o += '<ellipse cx="0" cy="4" rx="46" ry="12" fill="#000" opacity=".28" stroke="none"/>';
    o += '<path d="M0,0 C-2,-30 4,-55 -2,-80" stroke-width="12"/>';
    o += '<path d="M-1,-48 C-20,-60 -34,-62 -48,-82 M-30,-64 C-36,-70 -34,-80 -40,-90 M1,-62 C18,-72 30,-74 44,-96 M28,-77 C38,-80 46,-78 56,-84 M-2,-80 C-8,-96 2,-104 -4,-118 M-2,-84 C10,-94 16,-102 14,-114" stroke-width="5"/>';
    o += '<path d="M-48,-82 l-8,-6 M44,-96 l4,-10 M-40,-90 l-10,-2 M14,-114 l6,-6" stroke-width="3"/>';
    o += '</g>';
    return o;
  }
  function bush(x, y, s, col) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="14" rx="26" ry="7" fill="#000" opacity=".25"/>';
    [[-14, 2, 13], [0, -6, 16], [14, 3, 12], [-4, 8, 12], [8, 9, 11]].forEach(function (c) { o += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + col + '"/>'; });
    o += '<circle cx="-4" cy="-10" r="6" fill="#fff" opacity=".07"/></g>';
    return o;
  }
  function pine(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="6" rx="26" ry="7" fill="#24384a" opacity=".18"/>';
    o += '<rect x="-4" y="-6" width="8" height="12" fill="#6b4a2b"/>';
    o += '<path d="M0,-70 L22,-34 H12 L28,-8 H-28 L-12,-34 H-22 Z" fill="#1f5a3a"/>';
    o += '<path d="M0,-70 L10,-54 L4,-56 L0,-50 L-5,-56 L-10,-54 Z M-14,-34 L-6,-30 L0,-36 L7,-30 L14,-34 L10,-40 L-10,-40 Z" fill="#fff" opacity=".9"/>';
    o += '<circle cx="-8" cy="-20" r="2.6" fill="#d7263d"/><circle cx="10" cy="-26" r="2.6" fill="#f4c542"/><circle cx="2" cy="-46" r="2.4" fill="#d7263d"/></g>';
    return o;
  }
  function present(x, y, s, col) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')"><ellipse cx="0" cy="13" rx="17" ry="4" fill="#24384a" opacity=".18"/>' +
      '<rect x="-13" y="-10" width="26" height="22" rx="2" fill="' + col + '"/><rect x="-15" y="-14" width="30" height="7" rx="2" fill="' + col + '" stroke="#000" stroke-opacity=".12"/>' +
      '<rect x="-2.5" y="-14" width="5" height="26" fill="#f4c542"/><path d="M0,-14 C-10,-24 -14,-14 0,-14 C10,-24 14,-14 0,-14" fill="none" stroke="#f4c542" stroke-width="3"/></g>';
  }
  function snowman(x, y, s) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')"><ellipse cx="0" cy="18" rx="22" ry="5" fill="#24384a" opacity=".18"/>' +
      '<circle cx="0" cy="4" r="16" fill="#fff" stroke="#c9dbe8"/><circle cx="0" cy="-20" r="11" fill="#fff" stroke="#c9dbe8"/>' +
      '<rect x="-9" y="-38" width="18" height="10" fill="#24384a"/><rect x="-13" y="-29" width="26" height="3" fill="#24384a"/>' +
      '<circle cx="-4" cy="-22" r="1.6" fill="#24384a"/><circle cx="4" cy="-22" r="1.6" fill="#24384a"/><path d="M0,-19 l9,2 -9,2 z" fill="#f08a24"/>' +
      '<path d="M-10,-11 h20" stroke="#d7263d" stroke-width="4" stroke-linecap="round"/></g>';
  }
  // Chester: a small round crow. hat = 'none' | 'santa' | 'pilgrim'
  function chester(x, y, s, hat) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="30" rx="26" ry="5" fill="#000" opacity=".3"/>';
    o += '<path d="M-6,26 l-4,6 M6,26 l4,6" stroke="#e8a33c" stroke-width="3" stroke-linecap="round"/>';
    o += '<path d="M14,8 C34,10 40,22 30,26 C26,20 20,16 14,14 Z" fill="#16181d"/>';
    o += '<ellipse cx="0" cy="6" rx="22" ry="22" fill="#20232a"/>';
    o += '<path d="M-20,4 C-30,10 -30,22 -18,24 C-16,16 -16,10 -20,4 Z" fill="#16181d"/>';
    o += '<g class="eyes"><circle cx="-7" cy="-2" r="6" fill="#fff"/><circle cx="7" cy="-2" r="6" fill="#fff"/>';
    o += '<circle cx="-6" cy="-1" r="3.2" fill="#111"/><circle cx="8" cy="-1" r="3.2" fill="#111"/><circle cx="-5" cy="-2.4" r="1" fill="#fff"/><circle cx="9" cy="-2.4" r="1" fill="#fff"/></g>';
    o += '<path d="M-5,5 L5,5 L0,13 Z" fill="#f2a33a"/>';
    o += '<ellipse cx="-13" cy="8" rx="4" ry="2.5" fill="#ff7b9c" opacity=".55"/><ellipse cx="13" cy="8" rx="4" ry="2.5" fill="#ff7b9c" opacity=".55"/>';
    o += hatSvg(hat);
    o += '</g>';
    return o;
  }
  function hatSvg(hat) {
    var o = '';
    if (hat === 'santa') o += '<path d="M-15,-14 C-10,-34 10,-40 22,-30 C14,-30 12,-24 15,-14 Z" fill="#d7263d"/><rect x="-17" y="-17" width="34" height="7" rx="3.5" fill="#fff"/><circle cx="23" cy="-30" r="5" fill="#fff"/>';
    if (hat === 'pilgrim') o += '<ellipse cx="0" cy="-15" rx="23" ry="4.5" fill="#5a4030" stroke="#1a120c" stroke-width="1.2"/><path d="M-12,-16 L-10,-40 L10,-40 L12,-16 Z" fill="#5a4030" stroke="#1a120c" stroke-width="1.2"/><rect x="-11.4" y="-24" width="22.8" height="6" fill="#1a120c"/><rect x="-4.5" y="-25" width="9" height="8" fill="none" stroke="#f2c046" stroke-width="2"/>';
    if (hat === 'party') o += '<path d="M-10,-14 L0,-35 L10,-14 Z" fill="#f2c046" stroke="#c9921c" stroke-width="1.2" stroke-linejoin="round"/><path d="M-7,-20 L5,-23 M-4,-27 L3,-29" stroke="#ff5a8a" stroke-width="2.4" stroke-linecap="round"/><circle cx="0" cy="-36" r="4" fill="#ff5a8a"/><path d="M-11,-14 h22" stroke="#c9921c" stroke-width="2" stroke-linecap="round"/>';
    if (hat === 'witch') o += '<ellipse cx="0" cy="-15" rx="24" ry="4.5" fill="#2d2a5a" stroke="#15132e" stroke-width="1.2"/><path d="M-12,-16 C-8,-28 -2,-38 6,-44 C10,-46 14,-43 12,-40 C8,-40 6,-34 8,-28 L12,-16 Z" fill="#2d2a5a" stroke="#15132e" stroke-width="1.2" stroke-linejoin="round"/><rect x="-11" y="-22" width="22" height="5" fill="#ff8a2b"/><rect x="-3.5" y="-23" width="7" height="7" fill="none" stroke="#f2c046" stroke-width="1.6"/>';
    if (hat === 'bunny') o += '<g stroke="#e4d8e2" stroke-width="1.2"><ellipse cx="-9" cy="-27" rx="5.5" ry="12" transform="rotate(-14 -9 -27)" fill="#fff"/><ellipse cx="9" cy="-27" rx="5.5" ry="12" transform="rotate(14 9 -27)" fill="#fff"/></g><ellipse cx="-9" cy="-27" rx="2.8" ry="8" transform="rotate(-14 -9 -27)" fill="#ff9fb8"/><ellipse cx="9" cy="-27" rx="2.8" ry="8" transform="rotate(14 9 -27)" fill="#ff9fb8"/><path d="M-16,-15 Q0,-24 16,-15" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>';
    if (hat === 'heart') o += '<g transform="translate(16,-26) rotate(14)"><path d="M0,9 C-12,0 -12,-9 -6,-9 C-2.5,-9 0,-6.5 0,-4 C0,-6.5 2.5,-9 6,-9 C12,-9 12,0 0,9 Z" fill="#ff4d6d" stroke="#c9184a" stroke-width="1.2"/></g>';
    return o;
  }
  // Taco: the Beaters mascot, a smiling taco shell with the fillings peeking over the top.
  function taco(x, y, s, hat) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')"><g class="taco-move">';
    o += '<ellipse cx="0" cy="29" rx="29" ry="5" fill="#000" opacity=".28"/>';
    // fillings along the top edge of the shell: lettuce, tomato and meat
    var fill = [[-26, 14, 6, '#5fb83a'], [-23, 4, 6.5, '#6cc443'], [-16, -4, 6.5, '#5fb83a'], [-7, -8, 6.5, '#6cc443'], [3, -9, 6.5, '#5fb83a'], [13, -6, 6.5, '#6cc443'], [21, 1, 6.5, '#5fb83a'], [26, 11, 6, '#6cc443'],
      [-19, 4, 3.6, '#e0412b'], [-2, -7, 3.6, '#e0412b'], [17, -1, 3.6, '#e0412b'], [-10, -3, 3.4, '#8a4b22'], [8, -4, 3.4, '#8a4b22'], [24, 7, 3, '#8a4b22'], [-25, 9, 3, '#e0412b']];
    fill.forEach(function (c) { o += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + c[3] + '"/>'; });
    o += '<path d="M-28,27 A28,27 0 0 1 28,27 Z" fill="#f6c64a" stroke="#d48f1c" stroke-width="2" stroke-linejoin="round"/>';
    o += '<path d="M-20,12 A21,20 0 0 1 2,-0.5" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>';
    o += '<circle cx="-16" cy="20" r="1.2" fill="#d48f1c" opacity=".6"/><circle cx="18" cy="21" r="1.2" fill="#d48f1c" opacity=".6"/><circle cx="10" cy="4" r="1.1" fill="#d48f1c" opacity=".55"/><circle cx="-6" cy="5" r="1.1" fill="#d48f1c" opacity=".55"/>';
    o += '<path d="M-12,13 q4,-5 8,0 M4,13 q4,-5 8,0" fill="none" stroke="#3a2410" stroke-width="2.4" stroke-linecap="round"/>';
    o += '<path d="M-4,18 q4,4.5 8,0" fill="none" stroke="#3a2410" stroke-width="2.2" stroke-linecap="round"/>';
    o += '<ellipse cx="-16" cy="18" rx="4" ry="2.4" fill="#ff7b9c" opacity=".6"/><ellipse cx="16" cy="18" rx="4" ry="2.4" fill="#ff7b9c" opacity=".6"/>';
    if (hat === 'shades') o += '<g fill="#1a1a1a"><rect x="-15" y="6.5" width="12" height="8.5" rx="3.5"/><rect x="3" y="6.5" width="12" height="8.5" rx="3.5"/></g><path d="M-3,9 h6 M-15,9 l-9,-3 M15,9 l9,-3" stroke="#1a1a1a" stroke-width="1.8" stroke-linecap="round"/><path d="M-12,8.5 l3,0 M6,8.5 l3,0" stroke="#fff" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/>';
    else if (hat && hat !== 'none') o += '<g transform="translate(2,4) rotate(8)">' + hatSvg(hat) + '</g>';
    o += '</g></g>';
    return o;
  }
  // Browser tab icon for a theme: the theme's character, cropped close, in that theme's hat.
  function faviconSvg(theme) {
    var taco = theme.hero === 'taco', hat = hatFor(theme);
    var vb = taco ? '-31 -30 62 62' : hat !== 'none' ? '-27 -32 54 54' : '-25 -21 50 50';
    var n = vb.split(' ').map(Number);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '"><rect x="' + n[0] + '" y="' + n[1] + '" width="' + n[2] + '" height="' + n[3] + '" rx="' + (n[2] * .22) + '" fill="' + (taco ? '#2a1a0e' : '#f2a33a') + '"/>' + hero(0, taco ? 2 : 0, 1, theme) + '</svg>';
  }
  function setFavicon(theme) {
    if (typeof document === 'undefined') return;
    var href = 'data:image/svg+xml,' + encodeURIComponent(theme ? faviconSvg(theme) : DIE_ICON);
    var link = document.querySelector('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    if (link.getAttribute('href') !== href) { link.type = 'image/svg+xml'; link.href = href; }
  }
  // The shared icon (sign-in, game picker): an orange d4 showing a 4.
  var DIE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 6 L94 84 Q96 90 90 90 L10 90 Q4 90 6 84 Z" fill="#9a4a12"/><path d="M50 6 L50 90 L10 90 Q4 90 6 84 Z" fill="#e8822a"/><path d="M50 6 L94 84 Q96 90 90 90 L50 90 Z" fill="#ffb347"/><text x="50" y="80" text-anchor="middle" font-family="Arial Black,Arial" font-weight="900" font-size="40" fill="#1a0f00">4</text></svg>';

  // The theme's main character: Chester, or Taco on the Beaters themes.
  function hero(x, y, s, theme) { return theme && theme.hero === 'taco' ? taco(x, y, s, hatFor(theme)) : chester(x, y, s, theme ? hatFor(theme) : 'none'); }


  // ---- Thanksgiving farm art --------------------------------------------------
  function pumpkin(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="13" rx="22" ry="5" fill="#5a3616" opacity=".25"/>';
    o += '<ellipse cx="-9" cy="2" rx="11" ry="12" fill="#d9661f"/><ellipse cx="9" cy="2" rx="11" ry="12" fill="#d9661f"/>';
    o += '<ellipse cx="0" cy="2" rx="10" ry="13" fill="#ea7a2c" stroke="#b4501a" stroke-width="1"/>';
    o += '<path d="M-9,-9 Q-12,2 -9,13 M9,-9 Q12,2 9,13" stroke="#b4501a" stroke-width="1" fill="none"/>';
    o += '<path d="M-1,-10 q-1,-6 3,-9" stroke="#5a3a1a" stroke-width="3.2" stroke-linecap="round" fill="none"/>';
    o += '<path d="M2,-12 q8,-6 12,0 q-7,3 -12,0" fill="#4f8a2b"/>';
    o += '<ellipse cx="-4" cy="-4" rx="3" ry="5" fill="#fff" opacity=".18"/></g>';
    return o;
  }
  function hayBale(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="14" rx="28" ry="6" fill="#5a3616" opacity=".25"/>';
    o += '<rect x="-24" y="-12" width="48" height="26" rx="6" fill="#e3b955" stroke="#a87a26" stroke-width="1.5"/>';
    o += '<path d="M-20,-5 h14 M-2,-5 h18 M-18,3 h10 M0,3 h20 M-20,9 h16" stroke="#b98b2e" stroke-width="1.3" stroke-linecap="round"/>';
    o += '<path d="M-10,-12 v26 M10,-12 v26" stroke="#8a4a1a" stroke-width="2.4"/>';
    o += '<path d="M-24,-6 l-4,-2 M24,-4 l4,-3 M-22,10 l-4,2" stroke="#e3b955" stroke-width="1.5" stroke-linecap="round"/></g>';
    return o;
  }
  function cornShock(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="8" rx="22" ry="5" fill="#5a3616" opacity=".25"/>';
    o += '<path d="M-16,8 L-3,-44 L0,-50 L3,-44 L16,8 Z" fill="#cfa24a" stroke="#9a7426" stroke-width="1.2"/>';
    o += '<path d="M-10,8 L-1,-44 M-4,8 L0,-46 M3,8 L1,-44 M9,8 L2,-42" stroke="#9a7426" stroke-width="1" fill="none"/>';
    o += '<path d="M-3,-44 C-14,-52 -20,-50 -24,-58 M3,-44 C12,-54 18,-52 24,-60 M-1,-40 C-12,-40 -18,-34 -24,-36" stroke="#b78a34" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    o += '<rect x="-9" y="-22" width="18" height="5" rx="2" fill="#8a4a1a"/>';
    o += '<ellipse cx="12" cy="0" rx="4" ry="9" fill="#f2c046" stroke="#c6922a" transform="rotate(18 12 0)"/></g>';
    return o;
  }
  function autumnTree(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="4" rx="48" ry="12" fill="#5a3616" opacity=".25"/>';
    o += '<path d="M-6,4 C-4,-24 -8,-40 -2,-60 L4,-60 C8,-40 4,-24 7,4 Z" fill="#6b4422"/>';
    o += '<path d="M0,-40 C-14,-50 -20,-56 -26,-66 M2,-46 C14,-56 20,-62 26,-74" stroke="#6b4422" stroke-width="4" fill="none" stroke-linecap="round"/>';
    [[-26, -76, 22, '#b23a1c'], [4, -96, 26, '#d9661f'], [28, -74, 22, '#e0a31f'], [-6, -66, 22, '#c8521c'], [-18, -98, 18, '#e0a31f'], [22, -100, 16, '#b23a1c']].forEach(function (c) {
      o += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + c[3] + '"/>';
    });
    o += '<circle cx="-6" cy="-104" r="8" fill="#fff" opacity=".12"/></g>';
    return o;
  }
  function scarecrow(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="6" rx="26" ry="6" fill="#5a3616" opacity=".25"/>';
    o += '<rect x="-3" y="-60" width="6" height="66" fill="#6b4422"/><rect x="-34" y="-46" width="68" height="5" fill="#6b4422"/>';
    o += '<path d="M-34,-48 l-6,-3 M-34,-42 l-7,2 M34,-48 l6,-3 M34,-42 l7,2" stroke="#e3b955" stroke-width="2.2" stroke-linecap="round"/>';
    o += '<path d="M-30,-49 H30 V-38 H14 L12,-12 H-12 L-14,-38 H-30 Z" fill="#b23a1c"/>';
    o += '<path d="M-26,-49 V-38 M-16,-49 V-14 M-6,-49 V-12 M6,-49 V-12 M16,-49 V-14 M26,-49 V-38 M-30,-44 H30 M-13,-30 H13 M-12,-20 H12" stroke="#7a2412" stroke-width="1.4" opacity=".7"/>';
    o += '<path d="M-10,-12 l-3,7 M0,-12 v8 M10,-12 l3,7" stroke="#e3b955" stroke-width="2" stroke-linecap="round"/>';
    o += '<circle cx="0" cy="-62" r="12" fill="#d9b77a" stroke="#a8843e" stroke-width="1.2"/>';
    o += '<path d="M-5,-64 l3,3 M-5,-61 l3,-3 M2,-64 l3,3 M2,-61 l3,-3" stroke="#4a2a10" stroke-width="1.4"/><path d="M-5,-56 q5,3 10,0" stroke="#4a2a10" stroke-width="1.3" fill="none"/>';
    o += '<ellipse cx="0" cy="-71" rx="20" ry="4.5" fill="#e3b955" stroke="#a87a26"/><path d="M-10,-72 Q-9,-86 0,-86 Q9,-86 10,-72 Z" fill="#e3b955" stroke="#a87a26"/><rect x="-10" y="-76" width="20" height="3.5" fill="#b23a1c"/></g>';
    return o;
  }
  function turkey(x, y, s) {
    var o = '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')">';
    o += '<ellipse cx="0" cy="18" rx="26" ry="5" fill="#5a3616" opacity=".25"/>';
    ['#7a3d16', '#d9661f', '#e0a31f', '#b23a1c', '#7a3d16'].forEach(function (c, i) {
      var a = -70 + i * 35;
      o += '<ellipse cx="0" cy="-18" rx="8" ry="22" fill="' + c + '" transform="rotate(' + a + ' 0 2)"/>';
    });
    o += '<ellipse cx="0" cy="4" rx="15" ry="14" fill="#6b3a18"/>';
    o += '<circle cx="0" cy="-12" r="8" fill="#8a4f24"/>';
    o += '<circle cx="-3" cy="-14" r="1.7" fill="#111"/><circle cx="3" cy="-14" r="1.7" fill="#111"/>';
    o += '<path d="M-3,-10 L3,-10 L0,-5 Z" fill="#f2c046"/><path d="M1,-7 q4,4 0,9 q-3,-4 0,-9" fill="#d7263d"/>';
    o += '<path d="M-5,17 v5 M5,17 v5" stroke="#e8a33c" stroke-width="2.4" stroke-linecap="round"/></g>';
    return o;
  }
  function heartShape(col) {
    return '<path d="M0,7 C-9,0 -9,-7 -4.5,-7 C-2,-7 0,-5 0,-3 C0,-5 2,-7 4.5,-7 C9,-7 9,0 0,7 Z" fill="' + col + '"/>';
  }
  function leafShape(col) {
    return '<path d="M0,-7 C5,-6 7,-1 6,3 C4,6 1,7 0,8 C-1,7 -4,6 -6,3 C-7,-1 -5,-6 0,-7 Z M0,-6 V9" fill="' + col + '" stroke="#5a3616" stroke-opacity=".45" stroke-width=".8"/>';
  }

  // ---- per-theme look ---------------------------------------------------------
  // Everything the board draws differently per theme lives here, so a new theme is one more entry.
  var LOOKS = {
    cemetery: {
      sky: 'moon', grain: '.35', pseed: 9, fog: true, parts: 'wisps', river: 'water', fence: 'iron', decor: 'graves', seed: 13,
      vignette: ['#000', '.6'], stone: ['#b3b8ba', '#878d90'],
      title: { shadow: '#0c0e0b', ink: '#d9dcd5', stroke: '#3b3f3a', ink2: '#f2a33a', stroke2: '#2b1a05', tagline: '#e4e6df' },
      good: '#3fd04a', bad: '#a78bfa', warpBad: '#ff4b4b',
      card: 'url(#gCard)', cardText: null, task: ['#16171a', '#f2a33a'], plain: ['#1d201b', '#f1f1ea'], exit: ['#0e100d', '#f2a33a']
    },
    christmas: {
      sky: 'snow', grain: '.07', pseed: 5, fog: false, parts: 'snow', river: 'ice', fence: 'candy', decor: 'winter', seed: 21,
      vignette: ['#24384a', '.25'], stone: ['#ffffff', '#dbe8f2'],
      title: { shadow: '#d7263d', ink: '#24384a', stroke: '#fff', ink2: '#d7263d', stroke2: '#fff', tagline: '#24384a' },
      good: '#2fb35a', bad: '#3a6ea5', warpBad: '#d7263d',
      card: 'url(#gGift)', cardText: '#fff', task: ['#24384a', '#d7263d'], plain: ['#ffffff', '#24384a'], exit: ['#d7263d', '#f4c542']
    },
    thanksgiving: {
      sky: 'sun', grain: '.12', pseed: 7, fog: false, parts: 'leaves', river: 'creek', fence: 'rail', decor: 'farm', seed: 31,
      vignette: ['#5a3616', '.3'], stone: ['#fff7e6', '#ecd3a2'],
      title: { shadow: '#b23a1c', ink: '#4a2a10', stroke: '#fff4dc', ink2: '#d9661f', stroke2: '#fff4dc', tagline: '#4a2a10' },
      good: '#4f8a2b', bad: '#b23a1c', warpBad: '#c0392b',
      card: 'url(#gHarvest)', cardText: '#fff', task: ['#4a2a10', '#d9661f'], plain: ['#fff8ea', '#4a2a10'], exit: ['#7a2a14', '#f2c046']
    },
    // The taco boards bring their own art, so these only set the spaces, particles and colors.
    halloween: {
      sky: 'art', grain: '0', pseed: 11, fog: false, parts: 'leaves', partColors: ['#e8590c', '#ff8a2b', '#8e44ad', '#5a2d82'], river: 'none', fence: 'none', decor: 'none', seed: 41,
      vignette: ['#2a1040', '.3'], stone: ['#fff8ef', '#eadcf2'],
      title: { shadow: '#ff8a2b', ink: '#3b1d4a', stroke: '#fff', ink2: '#ff8a2b', stroke2: '#fff', tagline: '#3b1d4a' },
      good: '#4caf50', bad: '#8e44ad', warpBad: '#e8590c',
      card: 'url(#gTheme)', cardGrad: ['#ff8a2b', '#c4520f'], cardText: '#fff', task: ['#3b1d4a', '#ff8a2b'], plain: ['#fff4e6', '#3b1d4a'], exit: ['#3b1d4a', '#ff8a2b']
    },
    newyear: {
      sky: 'art', grain: '0', pseed: 11, fog: false, parts: 'confetti', partColors: ['#f2c046', '#ff5a8a', '#5ac8fa', '#ffffff'], river: 'none', fence: 'none', decor: 'none', seed: 41,
      vignette: ['#0b1240', '.25'], stone: ['#ffffff', '#dfe4f5'],
      title: { shadow: '#f2c046', ink: '#1d2350', stroke: '#fff', ink2: '#f2c046', stroke2: '#fff', tagline: '#1d2350' },
      good: '#2fb35a', bad: '#5b6cff', warpBad: '#d7263d',
      card: 'url(#gTheme)', cardGrad: ['#f6c84a', '#c9921c'], cardText: '#1d2350', task: ['#1d2350', '#f2c046'], plain: ['#f4f6ff', '#1d2350'], exit: ['#1d2350', '#f2c046']
    },
    valentine: {
      sky: 'art', grain: '0', pseed: 11, fog: false, parts: 'hearts', partColors: ['#ff4d6d', '#ff8fab', '#c9184a'], river: 'none', fence: 'none', decor: 'none', seed: 41,
      vignette: ['#7a1030', '.18'], stone: ['#ffffff', '#ffe3ea'],
      title: { shadow: '#ff4d6d', ink: '#7a1030', stroke: '#fff', ink2: '#ff4d6d', stroke2: '#fff', tagline: '#7a1030' },
      good: '#2fb35a', bad: '#c2185b', warpBad: '#c2185b',
      card: 'url(#gTheme)', cardGrad: ['#ff4d6d', '#c9184a'], cardText: '#fff', task: ['#7a1030', '#ffb3c6'], plain: ['#ffffff', '#7a1030'], exit: ['#7a1030', '#ffd1dc']
    },
    spring: {
      sky: 'art', grain: '0', pseed: 11, fog: false, parts: 'petals', partColors: ['#ffc0d5', '#ff8fb8', '#ffffff'], river: 'none', fence: 'none', decor: 'none', seed: 41,
      vignette: ['#2f4a1d', '.2'], stone: ['#ffffff', '#e8f5d8'],
      title: { shadow: '#e75480', ink: '#2f4a1d', stroke: '#fff', ink2: '#e75480', stroke2: '#fff', tagline: '#2f4a1d' },
      good: '#3fa34d', bad: '#e75480', warpBad: '#e75480',
      card: 'url(#gTheme)', cardGrad: ['#ff8fb8', '#e75480'], cardText: '#fff', task: ['#2f4a1d', '#ffd23f'], plain: ['#ffffff', '#2f4a1d'], exit: ['#2f4a1d', '#ffd23f']
    },
    summer: {
      sky: 'art', grain: '0', pseed: 11, fog: false, parts: 'none', partColors: [], river: 'none', fence: 'none', decor: 'none', seed: 41,
      vignette: ['#0b4f6c', '.15'], stone: ['#ffffff', '#fff1d6'],
      title: { shadow: '#ffb703', ink: '#0b4f6c', stroke: '#fff', ink2: '#ffb703', stroke2: '#fff', tagline: '#0b4f6c' },
      good: '#2fb35a', bad: '#ff7b00', warpBad: '#e63946',
      card: 'url(#gTheme)', cardGrad: ['#ffb703', '#fb8500'], cardText: '#fff', task: ['#0b4f6c', '#ffb703'], plain: ['#ffffff', '#0b4f6c'], exit: ['#0b4f6c', '#ffb703']
    }
  };
  function look(theme) { return LOOKS[theme.look || theme.id] || LOOKS.cemetery; }
  function hatFor(theme) { return theme.hat || 'none'; }

  function fence(L) {
    var o = '<g>';
    if (L.fence === 'rail') return railFence();
    var christmas = L.fence === 'candy';
    var col = christmas ? '#d7263d' : '#5e646b', col2 = christmas ? '#fff' : '#8a9097';
    // rails
    o += '<rect x="10" y="10" width="980" height="980" fill="none" stroke="' + col2 + '" stroke-width="4" opacity=".75"/>';
    o += '<rect x="4" y="4" width="992" height="992" fill="none" stroke="' + col + '" stroke-width="6" opacity=".85"/>';
    for (var i = 0; i <= 15; i++) {
      var p = 20 + i * 64 - (i === 15 ? 4 : 0);
      [[p, 6], [p, 994], [6, p], [994, p]].forEach(function (q) {
        if (christmas) o += '<rect x="' + (q[0] - 5) + '" y="' + (q[1] - 5) + '" width="10" height="10" rx="2" fill="#fff" stroke="#d7263d" stroke-width="3"/>';
        else o += '<rect x="' + (q[0] - 5) + '" y="' + (q[1] - 5) + '" width="10" height="10" fill="' + col + '" stroke="#2d3135" stroke-width="1.5"/>';
      });
    }
    o += '</g>';
    return o;
  }
  // Split-rail farm fence: two wooden rails with posts.
  function railFence() {
    var o = '<g>';
    o += '<rect x="11" y="11" width="978" height="978" fill="none" stroke="#9c6a34" stroke-width="4" opacity=".9"/>';
    o += '<rect x="4" y="4" width="992" height="992" fill="none" stroke="#7a4e24" stroke-width="6"/>';
    for (var i = 0; i <= 15; i++) {
      var p = 20 + i * 64 - (i === 15 ? 4 : 0);
      [[p, 6], [p, 994], [6, p], [994, p]].forEach(function (q) {
        o += '<rect x="' + (q[0] - 5) + '" y="' + (q[1] - 6) + '" width="10" height="12" rx="2" fill="#5a3616" stroke="#2e1a08" stroke-width="1.5"/>';
      });
    }
    return o + '</g>';
  }

  function river(L, pal) {
    var d = 'M1012,640 C960,636 905,650 862,700 C815,755 770,800 728,848 C690,892 648,930 622,1012';
    if (L.river === 'creek') {
      return '<g><path d="' + d + '" stroke="#6b4a22" stroke-width="154" fill="none" stroke-linecap="round" opacity=".9"/>' +
        '<path d="' + d + '" stroke="#5f9bbd" stroke-width="122" fill="none" stroke-linecap="round"/>' +
        '<path d="' + d + '" stroke="#a9d3ea" stroke-width="3" stroke-dasharray="14 22" fill="none" opacity=".85"/>' +
        '<path d="' + d + '" stroke="#cfe8f5" stroke-width="2" stroke-dasharray="6 30" fill="none" transform="translate(28,8)" opacity=".7"/>' +
        '<path d="' + d + '" stroke="#cfe8f5" stroke-width="2" stroke-dasharray="6 30" fill="none" transform="translate(-30,-6)" opacity=".7"/></g>';
    }
    if (L.river === 'ice') {
      return '<g><path d="' + d + '" stroke="#bfe3f7" stroke-width="150" fill="none" stroke-linecap="round" opacity=".95"/>' +
        '<path d="' + d + '" stroke="#e8f6fd" stroke-width="110" fill="none" stroke-linecap="round"/>' +
        '<path d="M930,640 l20,26 -14,18 M860,780 l-26,18 8,22 M700,870 l22,10 M640,930 l-16,-20" stroke="#8cc4e2" stroke-width="2" fill="none"/></g>';
    }
    return '<g><path d="' + d + '" stroke="#0d2c42" stroke-width="152" fill="none" stroke-linecap="round"/>' +
      '<path d="' + d + '" stroke="' + pal.water + '" stroke-width="122" fill="none" stroke-linecap="round"/>' +
      '<path d="' + d + '" stroke="#3f86b3" stroke-width="3" stroke-dasharray="14 22" fill="none" opacity=".8"/>' +
      '<path d="' + d + '" stroke="#5aa2cf" stroke-width="2" stroke-dasharray="6 30" fill="none" transform="translate(28,8)" opacity=".7"/>' +
      '<path d="' + d + '" stroke="#5aa2cf" stroke-width="2" stroke-dasharray="6 30" fill="none" transform="translate(-30,-6)" opacity=".7"/></g>';
  }

  function background(board, theme) {
    var pal = theme.palette, L = look(theme), o = '';
    var art = board.background || theme.art;
    if (art) {
      o += '<image href="' + esc(art) + '" x="0" y="0" width="1000" height="1000" preserveAspectRatio="xMidYMid slice"/>';
      var hh = !board.background && theme.artHero;
      if (hh) {
        // The art's hero on its own layer so it can peek and wiggle (CSS), clipped at the hill line.
        // 'hill': peeks over a hill and dips behind it (clipped at the hill line). 'hop': hops in place.
        var img = '<image class="art-hero egg' + (hh.move === 'hop' ? ' hop' : '') + '" data-egg="hero" href="' + esc(hh.src) + '" x="' + hh.x + '" y="' + hh.y + '" width="' + hh.w + '" height="' + hh.h + '"/>';
        o += hh.clip ? '<clipPath id="heroClip"><path d="' + hh.clip + '"/></clipPath><g clip-path="url(#heroClip)">' + img + '</g>' : img;
      }
      return o;
    }
    o += '<rect width="1000" height="1000" fill="url(#gGround)"/>';
    o += '<rect width="1000" height="1000" filter="url(#fGrain)" opacity="' + L.grain + '"/>';
    if (L.sky === 'sun') {
      // stubble rows across the field, a low autumn sun and a few fallen leaves
      for (var y = 60; y < 1000; y += 46) o += '<path d="M0,' + y + ' Q250,' + (y - 14) + ' 500,' + y + ' T1000,' + y + '" stroke="#8a5a22" stroke-width="3" fill="none" opacity=".12"/>';
      o += '<circle cx="770" cy="90" r="150" fill="url(#gSun)"/>';
      var r2 = rnd(11), cols = ['#b23a1c', '#d9661f', '#e0a31f', '#8a4a1a'];
      for (var j = 0; j < 40; j++) o += '<g transform="translate(' + (r2() * 1000).toFixed(0) + ',' + (r2() * 1000).toFixed(0) + ') rotate(' + (r2() * 360).toFixed(0) + ') scale(' + (.7 + r2() * .5).toFixed(2) + ')" opacity=".75">' + leafShape(cols[j % 4]) + '</g>';
    } else if (L.sky === 'snow') {
      var r1 = rnd(7);
      for (var i = 0; i < 70; i++) o += '<circle cx="' + (r1() * 1000).toFixed(0) + '" cy="' + (r1() * 1000).toFixed(0) + '" r="' + (1 + r1() * 2.4).toFixed(1) + '" fill="#fff" opacity=".9"/>';
    } else {
      o += '<circle cx="760" cy="96" r="120" fill="url(#gMoon)"/>';
    }
    o += river(L, pal);
    o += '<rect width="1000" height="1000" fill="url(#gVignette)"/>';
    return o;
  }

  // Decorations go on free cells only, so they never sit under a space.
  function decor(board, theme) {
    var pal = theme.palette, L = look(theme), used = {}, o = '';
    var cell = board.cell || 64, pad = 20;
    Object.keys(board.spaces).forEach(function (id) { var s = board.spaces[id]; used[Math.floor((s.x - pad) / cell) + ',' + Math.floor((s.y - pad) / cell)] = 1; });
    // keep the title, tagline, start markers and the river clear
    for (var c = 0; c < 15; c++) for (var r = 0; r < 15; r++) {
      if (r <= 2 && c <= 8) used[c + ',' + r] = 1;
      if (c === 0 && r >= 3 && r <= 10) used[c + ',' + r] = 1;
      if ((c >= 11 && r <= 1) || (c >= 12 && r <= 2)) used[c + ',' + r] = 1;
      var cx = pad + c * cell + cell / 2, cy = pad + r * cell + cell / 2;
      var inRiver = cy > 520 && cx > 560 && (Math.abs((cx - 590) + (cy - 1010) * 0.6) < 160 || (cx > 820 && cy > 560 && cy < 860) || (cy > 790 && cx > 600));
      if (inRiver && !(c >= 11 && r <= 7)) used[c + ',' + r] = 1;
    }
    var spots = [[3, 4], [4, 4], [5, 4], [3, 5], [5, 5], [8, 4], [8, 6], [9, 3], [11, 4], [11, 6], [12, 5], [11, 8], [12, 7], [3, 9], [4, 10], [6, 11], [7, 11], [8, 11], [3, 11], [5, 10], [8, 7], [9, 6], [4, 7], [11, 10], [9, 11]];
    var g = rnd(L.seed);
    spots.forEach(function (q, i) {
      if (used[q[0] + ',' + q[1]]) return;
      var x = pad + q[0] * cell + cell / 2 + (g() - .5) * 18, y = pad + q[1] * cell + cell / 2 + (g() - .5) * 14;
      if (L.decor === 'farm') {
        var k = i % 4, sc = .8 + g() * .3;
        if (k === 0) o += '<g class="egg" data-egg="pumpkin">' + pumpkin(x, y + 6, sc) + '</g>';
        else if (k === 1) o += hayBale(x, y + 4, sc * .9);
        else if (k === 2) o += cornShock(x, y + 20, sc);
        else o += pumpkin(x - 8, y + 8, sc * .75) + pumpkin(x + 10, y + 2, sc * .6);
      } else if (L.decor === 'winter') {
        if (i % 3 === 0) o += pine(x, y + 18, .8 + g() * .3);
        else if (i % 3 === 1) o += present(x, y, .9 + g() * .3, ['#d7263d', '#2fb35a', '#3a6ea5', '#f4c542'][i % 4]);
        else o += snowyGrave(x, y, .8 + g() * .3, i % 3 === 2 ? (i % 2) : 2, { stoneDark: '#4f6476' });
      } else {
        o += '<g class="egg" data-egg="grave">' + tombstone(x, y, .8 + g() * .35, i % 3, pal) + '</g>';
      }
    });
    if (L.decor === 'farm') {
      o += autumnTree(560, 420, 1.15) + '<g class="egg" data-egg="scarecrow">' + scarecrow(330, 780, 1.1) + '</g>' + autumnTree(890, 320, .85) + hayBale(440, 600, 1.2) + '<g class="egg" data-egg="turkey">' + turkey(655, 605, 1.05) + '</g>' + '<g class="egg" data-egg="pumpkin">' + pumpkin(820, 405, 1.15) + '</g>';
    } else if (L.decor === 'winter') {
      o += pine(560, 400, 1.3) + pine(318, 760, 1.2) + '<g class="egg" data-egg="snowman">' + snowman(660, 600, 1.1) + '</g>' + '<g class="egg" data-egg="present">' + present(440, 610, 1.1, '#d7263d') + '</g>' + pine(890, 330, 1.05) +
        snowyGrave(600, 470, .95, 0, { stoneDark: '#4f6476' }) + snowyGrave(820, 410, .85, 1, { stoneDark: '#4f6476' });
    } else {
      o += '<g class="egg" data-egg="tree">' + deadTree(560, 410, 1.15) + '</g>' + '<g class="egg" data-egg="tree">' + deadTree(330, 770, 1.05) + '</g>' + deadTree(890, 300, .8) + bush(440, 590, 1, '#1f3a17') + bush(650, 610, .9, '#24431b') + bush(820, 400, .8, '#1f3a17');
    }
    return o;
  }

  // Fog drifting low over the ground (under the spaces), and floating lights or snow on top.
  // Pure CSS animation, switched off by prefers-reduced-motion.
  function fog(theme) {
    if (!look(theme).fog) return '';
    return '<g class="atmo fog" aria-hidden="true">' +
      '<ellipse class="fog1" cx="300" cy="640" rx="420" ry="90" fill="url(#gFog)"/>' +
      '<ellipse class="fog2" cx="720" cy="360" rx="380" ry="80" fill="url(#gFog)"/>' +
      '<ellipse class="fog3" cx="520" cy="880" rx="460" ry="70" fill="url(#gFog)"/></g>';
  }
  function particles(theme) {
    var L = look(theme), g = rnd(L.pseed), o = '<g class="atmo parts" aria-hidden="true">';
    if (L.parts === 'none') return '';
    if (L.parts === 'leaves' || L.parts === 'petals' || L.parts === 'hearts' || L.parts === 'confetti') {
      // Falling leaves, blossom petals, hearts or confetti: same drift, different shape.
      var cols = L.partColors || ['#b23a1c', '#d9661f', '#e0a31f', '#8a4a1a'], many = L.parts === 'confetti' ? 26 : 16;
      for (var j = 0; j < many; j++) {
        var lx = (g() * 1000).toFixed(0), ld = (12 + g() * 10).toFixed(1), ldl = (-g() * 22).toFixed(1), lsw = (g() * 60 - 30).toFixed(0), lsc = (.8 + g() * .4).toFixed(2), col = cols[j % cols.length];
        var shape = L.parts === 'hearts' ? heartShape(col) : L.parts === 'confetti' ? '<rect x="-3" y="-5" width="6" height="10" rx="1" fill="' + col + '"/>' : L.parts === 'petals' ? '<ellipse rx="4.5" ry="7" fill="' + col + '" stroke="#e75480" stroke-opacity=".35" stroke-width=".8"/>' : leafShape(col);
        o += '<g transform="translate(' + lx + ',-16) scale(' + lsc + ')" opacity=".9"><g class="leaf" style="animation-duration:' + ld + 's;animation-delay:' + ldl + 's;--sway:' + lsw + 'px">' + shape + '</g></g>';
      }
    } else if (L.parts === 'snow') {
      for (var i = 0; i < 46; i++) {
        var x = (g() * 1000).toFixed(0), r = (1.6 + g() * 2.8).toFixed(1), d = (9 + g() * 9).toFixed(1), dl = (-g() * 18).toFixed(1), sway = (g() * 40 - 20).toFixed(0);
        o += '<circle class="flake" cx="' + x + '" cy="-12" r="' + r + '" fill="#fff" stroke="#7fa3c0" stroke-opacity=".55" stroke-width="1" style="animation-duration:' + d + 's;animation-delay:' + dl + 's;--sway:' + sway + 'px"/>';
      }
    } else {
      var spots = [[230, 520], [620, 300], [860, 520], [420, 770], [760, 760], [150, 900], [560, 560]];
      spots.forEach(function (q) {
        var d = (7 + g() * 6).toFixed(1), dl = (-g() * 10).toFixed(1);
        o += '<circle class="wisp" cx="' + q[0] + '" cy="' + q[1] + '" r="9" fill="url(#gWisp)" style="animation-duration:' + d + 's;animation-delay:' + dl + 's"/>';
      });
    }
    return o + '</g>';
  }

  function titleBlock(board, theme) {
    var o = '', T = look(theme).title;
    var parts = splitTitle(theme.title);
    var t2 = theme.titleSize || 70;   // long second words get a smaller size
    o += '<g class="title">';
    o += '<text x="34" y="92" font-family="' + esc(theme.font) + '" font-size="64" font-weight="700" fill="' + T.shadow + '" opacity=".55" transform="translate(4,5)">' + esc(parts[0]) + '</text>';
    o += '<text x="34" y="92" font-family="' + esc(theme.font) + '" font-size="64" font-weight="700" fill="' + T.ink + '" stroke="' + T.stroke + '" stroke-width="1.5" paint-order="stroke">' + esc(parts[0]) + '</text>';
    o += '<text x="70" y="160" font-family="' + esc(theme.font) + '" font-size="' + t2 + '" font-weight="700" fill="' + T.shadow + '" opacity=".55" transform="translate(4,5)">' + esc(parts[1]) + '</text>';
    o += '<text x="70" y="160" font-family="' + esc(theme.font) + '" font-size="' + t2 + '" font-weight="700" fill="' + T.ink2 + '" stroke="' + T.stroke2 + '" stroke-width="2" paint-order="stroke">' + esc(parts[1]) + '</text>';
    o += '<g class="egg board-hero" data-egg="hero">' + hero(575, 128, 1.05, theme) + '</g>';
    // tagline down the left edge, one or two words per line like a carved signpost
    var words = theme.tagline.split(' '), lines = [], cur = '';
    words.forEach(function (w) { if ((cur + ' ' + w).trim().length > 8) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) lines.push(cur);
    lines = lines.slice(0, 14);
    var tsize = theme.taglineSize || 19;   // wide display fonts set a smaller size
    o += '<g font-family="' + esc(theme.font) + '" font-size="' + tsize + '" fill="' + T.tagline + '" text-anchor="middle">';
    lines.forEach(function (l, i) { o += '<text x="52" y="' + (230 + i * (tsize + 5)) + '">' + esc(l) + '</text>'; });
    o += '</g></g>';
    return o;
  }
  function splitTitle(t) {
    var i = t.lastIndexOf(' ');
    return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ''];
  }

  function startMarkers(board, theme) {
    var o = '', L = look(theme);
    ['longer', 'riskier'].forEach(function (r) {
      var st = board.starts && board.starts[r]; if (!st) return;
      var label = (theme.words && theme.words[r]) || r;
      var fill = L.good;
      o += '<g class="start" transform="translate(' + st.x + ',' + st.y + ')">';
      if (st.dir === 'left') o += '<path d="M24,-14 L-8,-14 L-8,-24 L-28,0 L-8,24 L-8,14 L24,14 Z" fill="#111" stroke="' + fill + '" stroke-width="3"/>';
      else o += '<path d="M-14,-24 L14,-24 L14,4 L24,4 L0,28 L-24,4 L-14,4 Z" fill="#111" stroke="' + fill + '" stroke-width="3"/>';
      o += '<text x="0" y="' + (st.dir === 'left' ? -38 : -36) + '" text-anchor="middle" font-family="Atkinson Hyperlegible, Arial, sans-serif" font-weight="700" font-size="12.5" fill="' + fill + '" stroke="#000" stroke-width="3" paint-order="stroke">' + esc(label.split(' ')[0]) + '</text>';
      o += '</g>';
    });
    return o;
  }

  // ---- spaces ----------------------------------------------------------------
  function spaceSvg(sp, theme, opts) {
    var pal = theme.palette, L = look(theme), k = sp.kind && theme.kinds[sp.kind];
    var s = 58, h = s / 2, o = '';
    var cls = 'sp sp-' + sp.type + (opts.selected === sp.id ? ' sel' : '');
    o += '<g class="' + cls + '" data-id="' + esc(sp.id) + '" transform="translate(' + sp.x + ',' + sp.y + ')" tabindex="' + (opts.focusable ? 0 : -1) + '" role="button" aria-label="' + esc(label(sp, theme)) + '">';
    if (opts.artSpaces) {
      // The background art already shows this space; draw only a hit area (visible in the designer).
      o += '<rect class="face ghost" x="' + (-h) + '" y="' + (-h) + '" width="' + s + '" height="' + s + '" rx="5" fill="' + (opts.designer ? 'rgba(242,163,58,.18)' : 'transparent') + '" stroke="' + (opts.designer ? '#f2a33a' : 'transparent') + '" stroke-width="2"/>';
      return o + '</g>';
    }
    o += '<rect x="' + (-h + 2) + '" y="' + (-h + 3) + '" width="' + s + '" height="' + s + '" rx="5" fill="#000" opacity=".35"/>';
    var fill = 'url(#gStone)', stroke = pal.stoneDark, txt = pal.ink;
    if (sp.type === 'card') { fill = L.card; }
    if (sp.type === 'task') { fill = L.task[0]; stroke = L.task[1]; txt = '#fff'; }
    if (sp.type === 'move' || sp.type === 'skip' || sp.type === 'start' || sp.type === 'warp' || sp.type === 'safe') { fill = L.plain[0]; stroke = sp.type === 'move' && sp.n > 0 || sp.type === 'safe' || (sp.type === 'warp' && sp.kind === 'swim') ? L.good : L.bad; txt = L.plain[1]; }
    if (sp.type === 'exit') { fill = L.exit[0]; stroke = L.exit[1]; txt = '#fff'; }
    o += '<rect class="face" x="' + (-h) + '" y="' + (-h) + '" width="' + s + '" height="' + s + '" rx="5" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (sp.type === 'map' || sp.type === 'card' ? 1.5 : 2.5) + '"/>';
    if (sp.type === 'map' || sp.type === 'card') o += '<rect x="' + (-h + 3) + '" y="' + (-h + 3) + '" width="' + (s - 6) + '" height="' + (s - 6) + '" rx="3" fill="none" stroke="#fff" stroke-opacity=".22"/>';
    var f = 'Atkinson Hyperlegible, Arial, sans-serif';
    if (sp.type === 'map') {
      if (sp.bsr.length > 1) {
        o += t(0, -14, '!bsr', 10, txt, f, 700, .75) + t(0, -1, sp.bsr[0], 12.5, txt, f, 700) + t(0, 10, 'or', 9, txt, f, 700, .7) + t(0, 22, sp.bsr[1], 12.5, txt, f, 700);
      } else {
        o += t(0, -6, '!bsr', 12, txt, f, 700, .75) + t(0, 13, sp.bsr[0], 15.5, txt, f, 700);
      }
    } else if (sp.type === 'card') {
      var w = theme.words.card;
      var ct = L.cardText || pal.ink;
      o += t(0, -4, w[0], 13.5, ct, f, 700, .9) + t(0, 12, w[1], 13.5, ct, f, 700, .9);
    } else if (sp.type === 'exit') {
      o += t(0, 2, k ? k.icon : '\uD83D\uDEAA', 26, '#fff', 'serif', 400) + t(0, 24, 'EXIT', 10.5, txt, f, 700);
    } else {
      o += t(0, sp.type === 'task' ? -10 : -6, k ? k.icon : '?', sp.type === 'task' ? 19 : 21, txt, 'serif', 400);
      var short = shortLabel(sp, theme);
      if (sp.type === 'task') o += t(0, 9, short, 8.6, '#f2c46b', f, 700) + t(0, 21, '!bsr ' + sp.bsr[0], 9.6, '#fff', f, 700);
      else o += t(0, 15, short, 9.4, txt, f, 700);
    }
    o += '</g>';
    return o;
  }
  function t(x, y, s, size, fill, font, weight, op) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="' + esc(font) + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '"' + (op ? ' opacity="' + op + '"' : '') + '>' + esc(s) + '</text>';
  }
  function shortLabel(sp, theme) {
    switch (sp.type) {
      case 'task': return 'to continue';
      case 'move': return sp.n > 0 ? 'Ahead ' + sp.n : 'Back ' + (-sp.n);
      case 'skip': return sp.turns > 1 ? 'Lose ' + sp.turns : 'Lose turn';
      case 'start': return 'To start';
      case 'warp': return sp.kind === 'swim' ? ((theme.words && theme.words.swim) || 'Swim!') : (sp.kind === 'current' ? 'Current' : 'Warp');
      case 'safe': return 'Safe!';
      default: return '';
    }
  }
  function label(sp, theme) {
    var k = sp.kind && theme.kinds[sp.kind];
    var base = k ? k.title : sp.type === 'card' ? 'Card drop' : sp.type === 'map' ? 'Map space' : sp.type;
    var maps = sp.bsr && sp.bsr.length ? ' !bsr ' + sp.bsr.join(' or ') : '';
    return base + maps + '. ' + C.spaceEffectText(sp);
  }

  function connectors(board, theme) {
    var o = '', L = look(theme);
    // warp arrows, dotted like the original board
    Object.keys(board.spaces).forEach(function (id) {
      var sp = board.spaces[id];
      if (sp.type !== 'warp' || !board.spaces[sp.to]) return;
      var to = board.spaces[sp.to], good = sp.kind === 'swim';
      var col = good ? L.good : L.warpBad;
      var mx = (sp.x + to.x) / 2 + (good ? 60 : -50), my = (sp.y + to.y) / 2 + (good ? 60 : -40);
      o += '<path d="M' + sp.x + ',' + sp.y + ' Q' + mx + ',' + my + ' ' + to.x + ',' + to.y + '" fill="none" stroke="' + col + '" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" opacity=".95" marker-end="url(#mArrow' + (good ? 'G' : 'R') + ')"/>';
    });
    return o;
  }

  function defs(theme) {
    var pal = theme.palette, L = look(theme);
    return '<defs>' +
      '<radialGradient id="gGround" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="' + pal.ground + '"/><stop offset="1" stop-color="' + pal.ground2 + '"/></radialGradient>' +
      '<radialGradient id="gVignette" cx="50%" cy="50%" r="72%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="' + L.vignette[0] + '" stop-opacity="' + L.vignette[1] + '"/></radialGradient>' +
      '<radialGradient id="gMoon" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff7d6" stop-opacity=".55"/><stop offset=".22" stop-color="#fff2c2" stop-opacity=".22"/><stop offset="1" stop-color="#fff2c2" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="gGrave" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9c6d1"/><stop offset="1" stop-color="#7d90a1"/></linearGradient>' +
      '<linearGradient id="gStone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + L.stone[0] + '"/><stop offset="1" stop-color="' + L.stone[1] + '"/></linearGradient>' +
      '<linearGradient id="gCard" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dcd7"/><stop offset="1" stop-color="#a9adaa"/></linearGradient>' +
      '<linearGradient id="gGift" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2384c"/><stop offset="1" stop-color="#a4142a"/></linearGradient>' +
      (L.cardGrad ? '<linearGradient id="gTheme" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + L.cardGrad[0] + '"/><stop offset="1" stop-color="' + L.cardGrad[1] + '"/></linearGradient>' : '') +
      '<linearGradient id="gHarvest" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ea7a2c"/><stop offset="1" stop-color="#b4501a"/></linearGradient>' +
      '<radialGradient id="gSun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff1c4" stop-opacity=".75"/><stop offset=".25" stop-color="#ffd27a" stop-opacity=".35"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="gFog"><stop offset="0" stop-color="#dfe8dc" stop-opacity=".22"/><stop offset="1" stop-color="#dfe8dc" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="gWisp"><stop offset="0" stop-color="#e9ffd0"/><stop offset=".25" stop-color="#9dff6a" stop-opacity=".8"/><stop offset="1" stop-color="#5cff3a" stop-opacity="0"/></radialGradient>' +
      '<filter id="fGrain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .9 0"/></filter>' +
      '<filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<marker id="mArrowG" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + L.good + '"/></marker>' +
      '<marker id="mArrowR" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + L.warpBad + '"/></marker>' +
      '</defs>';
  }

  function board(b, theme, opts) {
    opts = opts || {};
    var o = '<svg class="board-svg" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(theme.title) + ' game board">';
    o += defs(theme);
    o += '<g class="bg">' + background(b, theme) + '</g>';
    // Theme art (the taco boards) already has its own title and scenery.
    var art = b.background || theme.art;
    if (!art) o += '<g class="decor">' + decor(b, theme) + fence(look(theme)) + '</g>';
    if (!art || (b.background && opts.titleOnImage)) o += titleBlock(b, theme);
    if (!(b.background && b.artSpaces)) o += '<g class="links">' + connectors(b, theme) + '</g>';
    if (!art && !opts.still) o += fog(theme);
    if (!(b.background && b.artSpaces)) o += startMarkers(b, theme);
    o += '<g class="spaces">';
    var so = Object.assign({}, opts, { artSpaces: !!(b.background && b.artSpaces) });
    Object.keys(b.spaces).forEach(function (id) { o += spaceSvg(b.spaces[id], theme, so); });
    o += '</g>';
    o += '<g class="hl"></g><g class="tokens"></g>';
    if (!opts.still) o += particles(theme);
    o += '</svg>';
    return o;
  }

  // ---- tokens ----------------------------------------------------------------
  var COLORS = ['#f2a33a', '#3fd04a', '#4cc9f0', '#f72585', '#b388ff', '#ffd166', '#ff6b6b', '#06d6a0', '#8ecae6', '#e9c46a', '#ff9f1c', '#c77dff'];
  function playerColor(s, pid) { var p = s.players[pid]; if (p && p.color) return p.color; return COLORS[s.order.indexOf(pid) % COLORS.length]; }

  function tokenXY(s, p) {
    var b = s.board;
    if (p.pos < 0 || !p.route) { var st = b.starts && b.starts[p.route || 'longer']; return st ? { x: st.x + (p.route ? 0 : -40), y: st.y + (p.route === 'riskier' ? 0 : 0), start: true } : { x: 960, y: 40, start: true }; }
    var id = b.routes[p.route][p.pos], sp = b.spaces[id];
    return { x: sp.x, y: sp.y, id: id };
  }

  function initials(name) { return String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; }

  // Lay out all tokens, grouping players on the same space into a small cluster.
  function layoutTokens(s, overrides) {
    var groups = {};
    s.order.forEach(function (pid) {
      var p = s.players[pid]; if (!p.route) return;
      var xy = overrides && overrides[pid] ? overrides[pid] : tokenXY(s, p);
      var key = Math.round(xy.x) + ',' + Math.round(xy.y);
      (groups[key] = groups[key] || []).push({ pid: pid, x: xy.x, y: xy.y });
    });
    var out = {};
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], n = g.length;
      var r = n === 1 ? 23 : n <= 4 ? 15 : 12;
      g.forEach(function (it, i) {
        var dx = 0, dy = 0;
        if (n > 1) {
          var cols = n <= 4 ? 2 : 3, row = Math.floor(i / cols), col = i % cols;
          var rows = Math.ceil(n / cols), step = r * 1.55;
          dx = (col - (Math.min(cols, n - row * cols) - 1) / 2) * step;
          dy = (row - (rows - 1) / 2) * step;
        }
        out[it.pid] = { x: it.x + dx, y: it.y + dy, r: r, n: n };
      });
    });
    return out;
  }

  function placeTokens(svg, s, theme, opts) {
    opts = opts || {};
    var layer = svg.querySelector('.tokens'); if (!layer) return;
    var pos = layoutTokens(s, opts.overrides);
    // A lone token's name tag runs into tokens on the spaces next to it, so those show only the
    // initials (tap the token for names). Your own tag always shows.
    var crowded = {};
    Object.keys(pos).forEach(function (a) {
      var A = pos[a]; if (A.n !== 1) return;
      crowded[a] = Object.keys(pos).some(function (b) { var B = pos[b]; return b !== a && Math.abs(B.x - A.x) < 74 && B.y - A.y > -10 && B.y - A.y < 72; });
    });
    var defsEl = svg.querySelector('defs');
    s.order.forEach(function (pid) {
      var p = s.players[pid]; if (!p.route) return;
      var L = pos[pid]; if (!L) return;
      var g = layer.querySelector('[data-pid="' + cssEsc(pid) + '"]');
      var col = playerColor(s, pid), clipId = 'clip-' + pid.replace(/[^a-z0-9]/gi, '');
      if (!defsEl.querySelector('#' + clipId)) defsEl.insertAdjacentHTML('beforeend', '<clipPath id="' + clipId + '" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>');
      if (!g) {
        layer.insertAdjacentHTML('beforeend', '<g class="tok" data-pid="' + esc(pid) + '"><g class="tok-in"></g></g>');
        g = layer.lastElementChild;
        g.style.transform = 'translate(' + L.x + 'px,' + L.y + 'px)';
      }
      var me = opts.me === pid, fl = opts.flair || {};
      var r = L.r * (me ? 1.12 : 1);
      var inner = '';
      inner += '<circle r="' + (r + 4) + '" fill="#000" opacity=".45" cy="3"/>';
      inner += '<circle r="' + (r + 3) + '" fill="' + col + '"/>';
      inner += '<circle r="' + r + '" fill="#1a1d18"/>';
      inner += '<text y="' + (r * .36) + '" text-anchor="middle" font-family="Atkinson Hyperlegible, Arial, sans-serif" font-weight="700" font-size="' + (r * .9) + '" fill="#fff">' + esc(initials(p.name)) + '</text>';
      if (p.avatar) inner += '<image href="' + esc(p.avatar) + '" x="' + (-r) + '" y="' + (-r) + '" width="' + (2 * r) + '" height="' + (2 * r) + '" clip-path="url(#' + clipId + ')" preserveAspectRatio="xMidYMid slice" onerror="this.remove()"/>';
      if (me) inner += '<circle r="' + (r + 6.5) + '" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 4" class="me-ring"/>';
      if (p.finished) inner += '<text y="' + (-r - 6) + '" text-anchor="middle" font-size="' + (r * .9) + '">\uD83C\uDF89</text>';
      if (opts.online && opts.online[pid]) inner += '<circle class="on-dot" cx="' + (r * .74).toFixed(1) + '" cy="' + (r * .74).toFixed(1) + '" r="' + (r * .27).toFixed(1) + '"/>';
      if (fl.crown === pid) inner += '<g class="crown" transform="translate(' + (r * .62).toFixed(1) + ',' + (-r * .78).toFixed(1) + ') rotate(20)"><text text-anchor="middle" font-size="' + (r * 1.05).toFixed(1) + '" y="' + (r * .3).toFixed(1) + '">\uD83D\uDC51</text></g>';
      if (fl.lantern === pid) inner += '<g class="lantern" transform="translate(' + (-r * .9).toFixed(1) + ',' + (-r * .7).toFixed(1) + ')"><circle r="' + (r * .75).toFixed(1) + '" class="lantern-glow"/><text text-anchor="middle" font-size="' + (r * 1.05).toFixed(1) + '" y="' + (r * .36).toFixed(1) + '">\uD83C\uDFEE</text></g>';
      inner += '<title>' + esc(p.name) + '</title>';
      if ((L.n === 1 && !crowded[pid]) || me) inner += '<g class="tag"><rect x="-34" y="' + (r + 5) + '" width="68" height="15" rx="7.5" fill="#000" opacity=".78"/><text y="' + (r + 16) + '" text-anchor="middle" font-family="Atkinson Hyperlegible, Arial, sans-serif" font-weight="700" font-size="10.5" fill="#fff">' + esc(trunc(p.name, 11)) + '</text></g>';
      g.querySelector('.tok-in').innerHTML = inner;
      g.classList.toggle('me', me);
      if (!opts.noMove) g.style.transform = 'translate(' + L.x + 'px,' + L.y + 'px)';
      if (me) layer.appendChild(g);  // draw on top
    });
    // remove tokens for players who left
    Array.prototype.forEach.call(layer.querySelectorAll('.tok'), function (g) { if (!s.players[g.getAttribute('data-pid')]) g.remove(); });
  }
  function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  root.CGRender = {
    board: board, placeTokens: placeTokens, layoutTokens: layoutTokens, tokenXY: tokenXY,
    playerColor: playerColor, initials: initials, chester: chester, taco: taco, hero: hero, dieIcon: function () { return DIE_ICON; }, setFavicon: setFavicon, cardArt: cardArt, isImg: isImg, faviconSvg: faviconSvg, hatFor: hatFor, label: label, esc: esc
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
