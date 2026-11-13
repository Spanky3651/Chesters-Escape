// node tests/themes.test.js (also run at the end of engine.test.js)
// Checks every theme has all the pieces a game needs, so a new theme can't quietly fall back to
// another theme's words or pictures. The full list of places to touch is in THEMES.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../docs/js/content.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const css = read('docs/css/game.css'), render = read('docs/js/render.js'), index = read('docs/index.html');
const file = (u) => fs.existsSync(path.join(root, 'docs', String(u).split('?')[0]));

// Themes that still show the graveyard Chester on their Discord posts. Give them a thumb before a game uses them.
const NO_PICTURE_YET = ['christmas', 'thanksgiving'];

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
  // pictures: Discord posts use thumb, else the hero art; the graveyard icon is only right for the cemetery
  const pic = t.thumb || (t.artHero && t.artHero.src);
  if (pic) need(file(pic), id, 'Discord picture not found: ' + pic);
  else if (look !== 'cemetery' && !NO_PICTURE_YET.includes(id)) need(false, id, 'no Discord picture: add thumb (posts would show the graveyard Chester)');
  for (const k of ['art', 'shot']) if (t[k]) need(file(t[k]), id, k + ' not found: ' + t[k]);
  if (t.artHero) need(file('img/push/' + id + '.png'), id, 'no notification icon img/push/' + id + '.png');
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
assert.deepStrictEqual(problems, [], 'Theme problems (see THEMES.md):\n  ' + problems.join('\n  '));
if (NO_PICTURE_YET.length) console.log('themes ok (still on the graveyard Discord picture: ' + NO_PICTURE_YET.join(', ') + ')');
else console.log('themes ok');
