// node tests/themes.test.js (also run at the end of engine.test.js)
// Checks every theme has all the pieces a game needs, so a new theme can't quietly fall back to
// another theme's words or pictures. The full list of places to touch is in THEMES.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../docs/js/content.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('docs/css/game.css'), render = read('docs/js/render.js'), index = read('docs/index.html'), fxSrc = read('docs/js/fx.js');
const file = (u) => fs.existsSync(path.join(root, 'docs', String(u).split('?')[0]));

// Themes that still show the Beat Saber Games logo on their Discord posts. Give them a thumb before a game uses them.
const NO_PICTURE_YET = ['christmas', 'thanksgiving'];
// Taco themes whose Discord picture is still the hero cut out of the board art (artHero): small, clipped by the
// scenery and fringed with the background, so it looks rough on Discord. Give them a proper thumb before a game uses them.
const CUTOUT_PICTURE_YET = ['taco-halloween', 'taco-thanksgiving', 'taco-newyear', 'taco-valentine', 'taco-easter', 'taco-summer'];

const looksBlock = render.slice(render.indexOf('var LOOKS = {'));
const boardKinds = new Set(Object.values(C.boards['chester-escape']().spaces).map((s) => s.kind).filter(Boolean));
const problems = [];
const need = (ok, id, what) => { if (!ok) problems.push(id + ': ' + what); };

for (const [id, t] of Object.entries(C.themes)) {
  need(t.id === id, id, 'id must match its key');
  for (const k of ['name', 'title', 'tagline', 'goal', 'font']) need(t[k], id, 'missing ' + k);
  need(t.palette && t.palette.accent, id, 'missing palette.accent (Discord card color)');
  for (const k of ['back', 'treasure', 'trick', 'task', 'fate']) need(t.card && t.card[k], id, 'missing card.' + k);
  for (const k of ['start', 'longer', 'riskier', 'escaped', 'results']) need(t.words && t.words[k], id, 'missing words.' + k);
  need(t.words && Array.isArray(t.words.card) && t.words.card.length === 2, id, 'words.card needs two words (the card-space label)');
  for (const k of ['longer', 'riskier']) need(t.routes && t.routes[k], id, 'missing routes.' + k + ' (route blurb)');
  for (const k of boardKinds) need(t.kinds && t.kinds[k] && t.kinds[k].title && t.kinds[k].icon, id, 'missing kinds.' + k + ' (an event on the board)');
  // Stuck! reaction: a drawing for the theme's back-to-start spot (STUCK in fx.js), or the mud pit pig
  need(t.stuck && (t.stuck === 'mud' || fxSrc.includes('\n    ' + t.stuck + ': function (t)')), id, 'missing stuck, or no Stuck! drawing for it in STUCK in fx.js');
  // card words: its own deck, or its own entry in the card wording table
  need(t.deck || C.cardWords[id], id, 'no card wording: add it to WORDS in content.js (or give the theme a deck)');
  if (t.deck) t.deck.forEach((c) => need(!c.full || file(c.full), id, 'card picture not found: ' + c.full));
  // the look: board drawing settings in render.js and colors in game.css
  const look = t.look || id;
  need(looksBlock.includes('\n    ' + look + ': {') || looksBlock.includes('\n    "' + look + '": {'), id, 'no LOOKS.' + look + ' in render.js (board drawing)');
  need(look === 'cemetery' || css.includes('body[data-theme="' + look + '"]'), id, 'no body[data-theme="' + look + '"] colors in game.css');   // the cemetery colors are the :root defaults
  // its font has to be loaded
  const fam = String(t.font).split(',')[0].replace(/['"]/g, '').trim();
  need(index.includes('family=' + fam.replace(/ /g, '+')), id, 'font "' + fam + '" is not in the Google Fonts link in index.html');
  // Chester's hat and any custom hero must exist in render.js
  if (t.hat && t.hat !== 'none') need(render.includes("hat === '" + t.hat + "'"), id, 'hat "' + t.hat + '" is not drawn in render.js');
  if (t.hero) need(render.includes("hero === '" + t.hero + "'"), id, 'hero "' + t.hero + '" is not drawn in render.js');
  // pictures: Discord posts use thumb, else the hero art; without either the logo stands in, which is only right for the cemetery
  const pic = t.thumb || (t.artHero && t.artHero.src);
  if (pic) need(file(pic), id, 'Discord picture not found: ' + pic);
  else if (look !== 'cemetery' && !NO_PICTURE_YET.includes(id)) need(false, id, 'no Discord picture: add thumb (posts would show the Beat Saber Games logo)');
  for (const k of ['art', 'shot']) if (t[k]) need(file(t[k]), id, k + ' not found: ' + t[k]);
  need(file('img/push/' + id + '.png'), id, 'no notification icon img/push/' + id + '.png');
  if (t.mapSet) need(C.mapSets[t.mapSet], id, 'map set "' + t.mapSet + '" not found');
}
// Within a family (Chester or Taco), every theme names the same events, so a designer board can switch
// between them without an event losing its name.
const fams = {};
for (const [id, t] of Object.entries(C.themes)) (fams[t.family || 'chester'] = fams[t.family || 'chester'] || []).push(id);
for (const ids of Object.values(fams)) {
  const all = new Set(ids.flatMap((id) => Object.keys(C.themes[id].kinds || {})));
  for (const id of ids) for (const k of all) need(C.themes[id].kinds[k], id, 'missing kinds.' + k + ' (other themes in its family have it)');
}
// ---- More checks from the Beat Saber Games playbook (the project doc beat-saber-games-playbook.md) ----
// Picture sizes, read straight from the file header (PNG, JPEG or WebP). Null when the file can't be read.
function imgSize(u) {
  const f = path.join(root, 'docs', String(u).split('?')[0]);
  if (!fs.existsSync(f)) return null;
  const b = fs.readFileSync(f);
  if (b.slice(1, 4).toString() === 'PNG') return { type: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { type: 'jpeg' };
  }
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
    const c = b.slice(12, 16).toString();
    if (c === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (c === 'VP8 ') return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (c === 'VP8L') { const n = b.readUInt32LE(21); return { type: 'webp', w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff) }; }
  }
  return { type: '?' };
}
// A PNG whose corners are opaque light-grey and white squares: a 'transparent' picture with the checkerboard
// saved into it. Reads 8-bit, non-interlaced RGB or RGBA PNGs; anything else is left alone. Returns a reason or ''.
function fakeTransparency(u) {
  const f = path.join(root, 'docs', String(u).split('?')[0]);
  if (!fs.existsSync(f)) return '';
  const b = fs.readFileSync(f);
  if (b.slice(1, 4).toString() !== 'PNG') return '';
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25], inter = b[28];
  if (depth !== 8 || (ct !== 2 && ct !== 6) || inter) return '';
  const chunks = []; for (let i = 8; i < b.length;) { const n = b.readUInt32BE(i), ty = b.slice(i + 4, i + 8).toString(); if (ty === 'IDAT') chunks.push(b.slice(i + 8, i + 8 + n)); i += 12 + n; }
  const raw = require('zlib').inflateSync(Buffer.concat(chunks)), bpp = ct === 6 ? 4 : 3, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, c = up ? up[x] : 0, d = up && x >= bpp ? up[x - bpp] : 0;
      let v = src[x];
      if (ft === 1) v += a; else if (ft === 2) v += c; else if (ft === 3) v += (a + c) >> 1;
      else if (ft === 4) { const p = a + c - d, pa = Math.abs(p - a), pb = Math.abs(p - c), pc = Math.abs(p - d); v += pa <= pb && pa <= pc ? a : pb <= pc ? c : d; }
      row[x] = v & 255;
    }
  }
  const at = (x, y) => { const o = y * stride + x * bpp; return [px[o], px[o + 1], px[o + 2], bpp === 4 ? px[o + 3] : 255]; };
  const n = Math.min(24, w, h), shades = new Set();
  for (const [cx, cy] of [[0, 0], [w - n, 0], [0, h - n], [w - n, h - n]]) for (let y = cy; y < cy + n; y++) for (let x = cx; x < cx + n; x++) {
    const [r, g, bl, al] = at(x, y);
    if (al < 250 || Math.max(r, g, bl) - Math.min(r, g, bl) > 6 || Math.min(r, g, bl) < 200) return '';
    shades.add(Math.round(Math.min(r, g, bl) / 6));
  }
  return shades.size >= 2 ? 'opaque grey and white squares in the corners' : '';
}
// Every piece of text in a theme (and its cards), with where it sits. Picture paths and colors are skipped.
function texts(o, at, out) {
  if (typeof o === 'string') { if (!/^(img\/|#[0-9a-f]{3,8}$|M[\d.])/i.test(o)) out.push([at, o]); }
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) texts(v, at ? at + '.' + k : k, out);
  return out;
}
// The other family's characters: Chester (and Hazel, his girlfriend) never show up in a Taco game, Taco never in a Chester game.
const OTHER = { taco: /\b(Chester|Hazel)\b/, chester: /\bTaco\b/ };
const CARD_IDS = C.cardsFor('cemetery').map((c) => c.id);   // the 20 shared card effects
const FX_TYPES = ['move', 'skip', 'again', 'shield', 'task', 'toNext'];
const seenName = {}, seenTitle = {};
// AccSaber games drop the maps from a route blurb with the same pattern app.js uses (routeBlurb), so a blurb
// that talks about maps any other way would still say so in an AccSaber game.
const appSrc = read('docs/js/app.js'), blurbRx = appSrc.match(/E\.isAcc\(s\) \? out\.replace\(\/(.+?)\/(\w*), ''\)/);
need(blurbRx, 'app.js', 'routeBlurb no longer strips maps from route blurbs the way this test expects: update the check below');
for (const [id, t] of Object.entries(C.themes)) {
  const fam = t.family || 'chester';
  need(fam === 'chester' || fam === 'taco', id, 'family "' + fam + '" is new: add it to the playbook and to OTHER in this test');
  // The family decides who is drawn: R.hero draws Taco only for hero: 'taco'.
  need((fam === 'taco') === (t.hero === 'taco'), id, "family and hero don't match (Taco themes need hero: 'taco', Chester themes have no hero)");
  // No other family's character in the theme's words or its cards.
  const all = texts(Object.assign({}, t, { deck: null }), '', []).concat(texts(C.cardsFor(id), 'cards', []));
  for (const [at, v] of all) if (OTHER[fam] && OTHER[fam].test(v)) need(false, id, at + ' names the other family\'s character: "' + v + '"');
  // goal always follows "the" (posts, thread, How to play, share cards): "made it to the <goal>".
  const goal = String(t.goal || '');
  need(!/^(the|a|an)\s/i.test(goal), id, 'goal "' + goal + '" starts with an article, but it always follows "the"');
  need(!/^\S+['’]s\b/.test(goal), id, 'goal "' + goal + '" starts with a possessive and reads "the ' + goal + '" (say "door of Santa\'s house", not "Santa\'s house")');
  need(!/[.!?,;:]$/.test(goal) && goal.length <= 30, id, 'goal "' + goal + '" should be a short place name with no end punctuation');
  // {n} is the count of spaces or the day number; without it the number goes missing.
  for (const k of ['longer', 'riskier']) need(String((t.routes || {})[k]).includes('{n}'), id, 'routes.' + k + ' needs {n} (the space count)');
  need(String((t.words || {}).results).includes('{n}'), id, 'words.results needs {n} (the day)');
  // Chester themes can run AccSaber games, where a route blurb loses its maps; Taco (Beaters) games are map games only.
  if (fam === 'chester' && blurbRx) for (const k of ['longer', 'riskier']) {
    const acc = String((t.routes || {})[k]).replace(new RegExp(blurbRx[1], blurbRx[2]), '');
    need(!/\b(maps?|songs?)\b/i.test(acc), id, 'routes.' + k + ' still talks about maps in an AccSaber game: "' + acc + '" (say "more maps" so it can be dropped)');
  }
  // The card-space label is two short capital words drawn on a 58px tile.
  if (t.words && Array.isArray(t.words.card)) t.words.card.forEach((w) => need(w === w.toUpperCase() && w.length <= 6, id, 'words.card "' + w + '" should be capitals and at most 6 letters to fit the tile'));
  // Card wording: all 20 cards, or a deck whose cards are complete.
  if (!t.deck && C.cardWords[id]) for (const cid of CARD_IDS) {
    const w = C.cardWords[id][cid];
    need(Array.isArray(w) && w.length === 3 && w.every((x) => String(x).trim()), id, 'WORDS card ' + cid + ' needs a title, an icon and a line');
  }
  if (t.deck) {
    const ids = new Set();
    t.deck.forEach((c) => {
      need(c.id && !ids.has(c.id), id, 'deck card ids must be unique (' + c.id + ')'); ids.add(c.id);
      need(t.card && t.card[c.cls], id, 'deck card ' + c.id + ' is a ' + c.cls + ' card, but card.' + c.cls + ' has no name');
      need(c.title && c.text, id, 'deck card ' + c.id + ' needs a title and text (players read them in the thread and on share cards)');
      (c.effects || []).forEach((fx) => need(FX_TYPES.includes(fx.type), id, 'deck card ' + c.id + ' has an effect the engine does not know: ' + fx.type));
    });
  }
  // Pictures: the notification icon is 192x192 PNG, Discord pictures and board pictures are square, and every
  // picture path carries ?v= so Discord and browsers fetch the new one after a change.
  const push = imgSize('img/push/' + id + '.png');
  if (push) need(push.type === 'png' && push.w === 192 && push.h === 192, id, 'img/push/' + id + '.png should be a 192x192 PNG (it is ' + push.type + ' ' + push.w + 'x' + push.h + ')');
  for (const [k, u] of [['thumb', t.thumb], ['shot', t.shot], ['art', t.art]]) {
    if (!u) continue;
    const z = imgSize(u);
    if (z) need(z.w && z.w === z.h, id, k + ' ' + u + ' should be square (it is ' + z.w + 'x' + z.h + ')');
  }
  // The Discord picture has to be made for Discord: a thumb of at least 256x256, with real transparency if it's a
  // cutout (a checkerboard saved into the pixels shows up as a grey box on Discord).
  if (t.thumb) {
    const z = imgSize(t.thumb);
    if (z && z.w) need(z.w >= 256, id, 'thumb ' + t.thumb + ' is ' + z.w + 'px; Discord pictures need at least 256x256');
    const fake = fakeTransparency(t.thumb);
    need(!fake, id, 'thumb ' + t.thumb + ' has a checkerboard saved into its pixels (' + fake + '); cut it out to real transparency');
  } else if (t.artHero && t.artHero.src) need(CUTOUT_PICTURE_YET.includes(id), id, 'Discord picture is the board cutout (artHero); add a thumb made for Discord, at least 256x256');
  const pics = [t.thumb, t.shot, t.art, t.artHero && t.artHero.src].concat((t.deck || []).map((c) => c.full)).filter(Boolean);
  for (const u of pics) need(/\?v=\w+/.test(u), id, u + ' needs a ?v= stamp, so a new picture isn\'t hidden behind the old one in caches');
  // The picker and Discord tell themes apart by name and title.
  need(!seenName[t.name], id, 'name "' + t.name + '" is also used by ' + seenName[t.name]); seenName[t.name] = id;
  need(!seenTitle[t.title], id, 'title "' + t.title + '" is also used by ' + seenTitle[t.title]); seenTitle[t.title] = id;
}
// The no-picture list only holds themes that still need a picture.
for (const id of NO_PICTURE_YET) {
  const t = C.themes[id] || {};
  need(C.themes[id] && !t.thumb && !(t.artHero && t.artHero.src), id, 'take it off NO_PICTURE_YET in this test: it has a Discord picture now (or is gone)');
}
for (const id of CUTOUT_PICTURE_YET) need(C.themes[id] && !C.themes[id].thumb, id, 'take it off CUTOUT_PICTURE_YET in this test: it has a thumb now (or is gone)');
// A notification icon with no theme is left over from a renamed or removed theme.
for (const f of fs.readdirSync(path.join(root, 'docs/img/push'))) if (/\.png$/.test(f)) need(C.themes[f.replace(/\.png$/, '')], f, 'notification icon with no theme of that id');
assert.deepStrictEqual(problems, [], 'Theme problems (see THEMES.md and the playbook):\n  ' + problems.join('\n  '));
if (NO_PICTURE_YET.length) console.log('themes ok (still on the logo Discord picture: ' + NO_PICTURE_YET.join(', ') + ')');
else console.log('themes ok');
