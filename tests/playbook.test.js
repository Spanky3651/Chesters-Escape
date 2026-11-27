// node tests/playbook.test.js (also run at the end of engine.test.js)
// Checks from the Beat Saber Games playbook (the project doc beat-saber-games-playbook.md) that a test can catch:
// map sets that don't fit the board, clan settings in wrangler.toml, AccSaber games showing maps, the exact roll,
// browser storage that should be kept per game or per mode, the other family's character in code, and the files
// the Worker loads (a change to any of them has to deploy the Worker). Theme checks are in themes.test.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../docs/js/content.js');
const E = require('../docs/js/engine.js');
require('../docs/js/render.js');
const R = globalThis.CGRender;

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const problems = [];
const need = (ok, where, what) => { if (!ok) problems.push(where + ': ' + what); };
const stamp = (u) => (String(u).match(/[?&]v=(\w+)/) || [])[1] || '';
const KEY = /^[0-9a-f]{1,6}$/;

// ---- map sets -------------------------------------------------------------------------------------
// A map set gives every map and blocker space of the built-in board a song, plus its own bonus maps,
// and ships the finished playlist players download from Get the maps.
const base = C.boards['chester-escape']();
const mapIds = Object.keys(base.spaces).filter((id) => ['map', 'task'].includes(base.spaces[id].type)).sort();
for (const [id, set] of Object.entries(C.mapSets)) {
  const where = 'map set ' + id, ids = Object.keys(set.spaces || {}).sort();
  need(JSON.stringify(ids) === JSON.stringify(mapIds), where, 'spaces must be exactly the board\'s map and blocker spaces. Missing: ' +
    (mapIds.filter((x) => !ids.includes(x)).join(', ') || 'none') + '. Not on the board: ' + (ids.filter((x) => !mapIds.includes(x)).join(', ') || 'none'));
  const keys = [];
  for (const sid of ids) {
    const k = set.spaces[sid];
    need(Array.isArray(k) && k.length >= 1 && k.length <= 2, where, sid + ' needs one or two map keys');
    (k || []).forEach((x) => { need(KEY.test(x), where, sid + ' has a key that is not a BeatSaver key: ' + x); keys.push(x); });
  }
  need(Array.isArray(set.bonusMaps) && set.bonusMaps.length > 0, where, 'needs bonus maps (every stop without a map draws one)');
  (set.bonusMaps || []).forEach((x) => { need(KEY.test(x), where, 'bonus map is not a BeatSaver key: ' + x); keys.push(x); });
  const dup = keys.filter((x, i) => keys.indexOf(x) !== i);
  need(!dup.length, where, 'a song is on the board twice, or is both a space and a bonus map: ' + [...new Set(dup)].join(', '));
  need(set.title && set.author, where, 'needs a title and an author (Get the maps and the credit line show them)');
  for (const k of ['authorUrl', 'authorAvatar']) if (set[k]) need(!/beatleader\.xyz/.test(set[k]), where, k + ' is on beatleader.xyz, which is gone. Use beatleader.com');
  // The board with these songs still validates, and Get the maps offers the same songs as the playlist file.
  const b = C.boardFor(id);
  need(!E.checkBoard(b).length, where, 'the board with these songs does not validate: ' + E.checkBoard(b).join(' '));
  need(b.mapSet === id, where, 'C.boardFor did not apply it');
  if (!set.playlist) { need(false, where, 'needs playlist: the finished .bplist players download'); continue; }
  need(!/^(https?:)?\/\//.test(set.playlist), where, 'playlist must be a path inside docs/ so it loads from whatever address the site is on (Playlist Studio fetches it from there)');
  need(stamp(set.playlist), where, 'playlist needs a ?v= stamp so a changed list is not hidden behind the cached one');
  let pl = null;
  try { pl = JSON.parse(read('docs/' + set.playlist.split('?')[0])); } catch (e) { need(false, where, 'playlist file missing or not JSON: ' + set.playlist); }
  if (pl) {
    const pk = (pl.songs || []).map((x) => String(x.key || '').toLowerCase());
    const want = E.allMapKeys(b, []);
    need(pk.length === new Set(pk).size, where, 'the playlist lists a song twice');
    need(want.every((k) => pk.includes(k)), where, 'songs on the board but not in the playlist: ' + want.filter((k) => !pk.includes(k)).join(', '));
    need(pk.every((k) => want.includes(k)), where, 'songs in the playlist but not on the board: ' + pk.filter((k) => !want.includes(k)).join(', '));
    need((pl.songs || []).every((x) => /^[0-9a-f]{40}$/i.test(x.hash || '')), where, 'every playlist song needs its hash (the game and mods match on it)');
    need(pl.playlistTitle === set.title, where, 'playlistTitle "' + pl.playlistTitle + '" should match the set title "' + set.title + '"');
    need(pl.image, where, 'playlist needs its cover image');
  }
  // A theme on this set with a day-before picture: the picture shows the board with these songs, so it has to be
  // made again (and stamped) when the songs change.
  for (const [tid, t] of Object.entries(C.themes)) if (t.mapSet === id && t.shot)
    need(stamp(t.shot).slice(0, 8) >= stamp(set.playlist).slice(0, 8), 'theme ' + tid, 'shot ' + t.shot + ' is older than its map set\'s playlist (' + set.playlist + '): render the board picture again');
}
need(base.bonusMaps.length > 0 && base.bonusMaps.every((x) => KEY.test(x)), 'built-in board', 'needs valid bonus maps');

// ---- clans and games (worker/wrangler.toml) -------------------------------------------------------------
// One game per clan Discord server. The Worker quietly falls back to the cemetery theme for an unknown theme
// and to the original songs for an unknown map set, so a typo here would show Chester to a Taco clan.
function toml(src) {
  const out = {}; let sec = out;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const h = line.match(/^\[+([^\]]+)\]+$/);
    if (h) { sec = out; for (const k of h[1].split('.')) sec = sec[k] = sec[k] || {}; continue; }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*=\s*(.+)$/);
    if (m) sec[m[1]] = /^".*"$/.test(m[2]) ? m[2].slice(1, -1) : /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
  }
  return out;
}
const W = toml(read('worker/wrangler.toml')), V = W.vars || {}, clans = Object.entries(V.CLANS || {});
need(clans.length > 0, 'wrangler.toml', 'no [vars.CLANS.*] tables found');
const uniq = {};
for (const [cid, c] of clans) {
  const where = 'clan ' + cid;
  for (const k of ['name', 'guild', 'game', 'webhook', 'order']) need(c[k] !== undefined && c[k] !== '', where, 'needs ' + k);
  // Two clans sharing a game, a server, a switcher spot or a webhook would mix their games or posts.
  for (const k of ['name', 'guild', 'game', 'webhook', 'order']) {
    const u = (uniq[k] = uniq[k] || {});
    need(!u[c[k]], where, k + ' "' + c[k] + '" is also used by clan ' + u[c[k]]); u[c[k]] = cid;
  }
  need(C.themes[c.theme], where, 'theme "' + c.theme + '" is not in content.js (the Worker would fall back to the cemetery theme)');
  if (c.maps) {
    need(C.mapSets[c.maps], where, 'maps "' + c.maps + '" is not a map set in content.js (the Worker would drop it)');
    const fam = (C.themes[c.theme] || {}).family || 'chester';
    for (const [tid, t] of Object.entries(C.themes)) if (t.mapSet === c.maps) need((t.family || 'chester') === fam, where, 'maps "' + c.maps + '" belongs to ' + tid + ', a theme from the other family');
  }
  if (c.accClan) need(c.accClanName, where, 'accClan needs accClanName (how sign-up errors and posts name the clan)');
  if (c.blClan) { need(/^\d+$/.test(String(c.blClan)), where, 'blClan is BeatLeader\'s clan number'); need(c.blClanName, where, 'blClan needs blClanName (its tag, as shown)'); }
  for (const k of ['guild', 'hosts']) if (c[k]) need(/^[\d,\s]*$/.test(String(c[k])), where, k + ' should be Discord IDs');
}
const origin = (u) => { try { return new URL(u).origin; } catch (e) { return ''; } };
const allowed = String(V.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim());
need(origin(V.GAME_PAGE) && allowed.includes(origin(V.GAME_PAGE)), 'wrangler.toml', 'GAME_PAGE ' + V.GAME_PAGE + ' must be in ALLOWED_ORIGINS, or the page cannot call the game server');
need(/^https:\/\//.test(V.GAME_PAGE || ''), 'wrangler.toml', 'GAME_PAGE should be the https address players open');
// og:url and the page itself are on the same address as GAME_PAGE (link previews, sign-in returns).
const index = read('docs/index.html');
need(index.includes('property="og:url" content="' + V.GAME_PAGE + '"'), 'docs/index.html', 'og:url should be GAME_PAGE (' + V.GAME_PAGE + ')');
// Playlist Studio opens Get the maps' playlist file only from hosts it trusts. When its repo sits next to this one,
// check it trusts the game's address (after the move to beatsabergames.com it only trusted the old one).
const studio = path.join(root, '..', 'Playlist-Studio', 'index.html');
let studioNote = 'Playlist Studio check skipped (its repo is not next to this one)';
if (fs.existsSync(studio)) {
  const m = fs.readFileSync(studio, 'utf8').match(/PL_LINK_HOST\s*=\s*\/(.+)\/(\w*);/);
  need(m, 'Playlist Studio', 'PL_LINK_HOST not found in index.html (the playlist link check moved?)');
  if (m) { need(new RegExp(m[1], m[2]).test(origin(V.GAME_PAGE) + '/playlists/x.bplist'), 'Playlist Studio', 'PL_LINK_HOST does not trust ' + origin(V.GAME_PAGE) + ', so Get the maps loses the cover, name and author'); studioNote = 'Playlist Studio trusts ' + origin(V.GAME_PAGE); }
}

// ---- AccSaber mode: no maps anywhere ------------------------------------------------------------------
const TYPES = ['map', 'task', 'card', 'move', 'skip', 'start', 'warp', 'safe', 'blank', 'exit'];
for (const type of TYPES) {
  const txt = C.spaceEffectText({ type, bsr: ['1a2b3'], n: 2, turns: 1 }, true);
  need(!/\bmaps?\b|!bsr/i.test(txt), 'spaceEffectText', 'a ' + type + ' space in an AccSaber game says "' + txt + '"');
}
const chesterThemes = Object.keys(C.themes).filter((id) => !C.themes[id].family);
for (const [id, t] of Object.entries(C.themes)) {
  const b = C.boardFor(t.mapSet);
  const acc = R.board(b, t, { acc: true, still: true }), maps = R.board(b, t, { acc: false, still: true });
  need(!/!bsr|Map space|Play (this|one of these) map/.test(acc), 'theme ' + id, 'the board in an AccSaber game shows map codes or map wording');
  need(/!bsr/.test(maps), 'theme ' + id, 'the board in a map game shows no map codes (the AccSaber check above would prove nothing)');
}
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const say = (x) => (x ? (x.title || '') + ' ' + (x.body || '') + ' ' + (x.reason || '') : '');
// A whole AccSaber game in every theme that can run one (the Chester family; Beaters games have no AccSaber mode):
// nobody is ever handed a map, and no reminder or roll message mentions one.
for (const id of chesterThemes) {
  const rng = seeded(id.length * 7 + 3);
  const s = E.createGame({ board: C.boardFor(C.themes[id].mapSet), cards: C.cardsFor(id), themeId: id, rng, settings: { accsaber: true, timeZone: 'UTC', cutoffHour: 4, cutoffMinute: 0 } });
  ['a', 'b', 'c'].forEach((pid, i) => { E.addPlayer(s, { id: pid, name: pid, blId: 'bl' + pid }); E.chooseRoute(s, pid, i % 2 ? 'longer' : 'riskier'); });
  const said = [];
  for (let day = 0; day < 80 && s.status === 'running'; day++) {
    for (const pid of s.order) {
      const p = s.players[pid];
      said.push(say(E.reminderFor(s, pid)), say(E.canRoll(s, pid)));
      if (day % 5 === 4) continue;   // a day without a mission now and then
      p.acc = { d: s.day, base: 0, cur: 1 };
      said.push(say(E.reminderFor(s, pid)));
      let c = E.canRoll(s, pid), n = 0;
      while (c.ok && n++ < 5) { E.roll(s, pid, { rng }); c = E.canRoll(s, pid); said.push(say(c)); }
      need(!p.tasks.length, 'AccSaber ' + id, 'a player was handed a map');
    }
    E.advanceDay(s);
  }
  need(!s.events.some((e) => e.t === 'task'), 'AccSaber ' + id, 'a map was handed out');
  const bad = said.filter((x) => /\bmaps?\b|!bsr/i.test(x));
  need(!bad.length, 'AccSaber ' + id, 'a reminder or roll message mentions maps: ' + bad[0]);
}

// ---- Exact roll: only the exact roll gets you out, in every theme's deck ------------------------------------
for (const id of Object.keys(C.themes)) {
  const wrong = [];
  for (let g = 0; g < 30; g++) {
    const rng = seeded(g * 31 + id.length);
    const s = E.createGame({ board: C.boardFor(C.themes[id].mapSet), cards: C.cardsFor(id), themeId: id, rng, settings: { exactFinish: true } });
    ['a', 'b', 'c', 'd'].forEach((pid, i) => { E.addPlayer(s, { id: pid, name: pid }); E.chooseRoute(s, pid, i % 2 ? 'longer' : 'riskier'); });
    for (let day = 0; day < 400 && s.status === 'running'; day++) {
      for (const pid of s.order) {
        const p = s.players[pid], clear = () => p.tasks.slice().forEach((t) => E.completeTask(s, pid, t.id, { by: 'test' }));
        clear();
        let c = E.canRoll(s, pid);
        while (c.ok) {
          const from = p.pos, last = E.exitIndex(s, p), r = E.roll(s, pid, { rng });
          if (p.finished && r.events.some((e) => e.t === 'escaped') && r.roll !== last - from) wrong.push(r.roll + ' from ' + (last - from) + ' away');
          clear(); c = E.canRoll(s, pid);
        }
      }
      E.advanceDay(s);
    }
  }
  need(!wrong.length, 'exact roll ' + id, wrong.length + ' escapes without the exact roll (a card, a space or a bigger roll took them out), like a ' + wrong[0]);
}

// ---- Browser storage -------------------------------------------------------------------------------------
// Every localStorage key the site uses, and how far it reaches. A key for one game's or one mode's state that
// isn't split by game id or mode leaks into the next game or the other mode (the AccSaber How to play stayed
// hidden from players who had seen the map game's). A new key fails here until it's added to this list.
const STORE = {
  'cg.muted': 'device',          // sound on or off
  'cg.dcOpen': 'device',         // open Discord links in the app or the browser
  'cg.token': 'device',          // sign-in
  'cg.clan': 'device',           // last clan picked on the switcher
  'cg.demo.v1': 'device',        // the demo game (the demo store)
  'cg.bs.': 'device',            // BeatSaver map details by key
  'cg.designer.work': 'device', 'cg.designer.board': 'device', 'cg.designer.board.': 'device', 'cg.designer.work.': 'device', 'cg.designer.cards': 'device',
  'cg.rev.': 'game', 'cg.badges.': 'game', 'cg.finale.': 'game', 'cg.seen.': 'game', 'cg.swap.': 'game',   // this game's moments
  'cg.seenHow': 'mode'           // How to play shown once: map games and AccSaber games each have their own
};
const lit = (src) => {   // string literals, skipping comments and regex literals
  const out = []; let i = 0, prev = '';
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue; }
    if (c === '/' && /[(,=:[!&|?;{}]$/.test(prev)) {
      i++; let cls = false;
      while (i < src.length) { const e = src[i]; if (e === '\\') { i += 2; continue; } if (e === '[') cls = true; else if (e === ']') cls = false; else if ((e === '/' && !cls) || e === '\n') break; i++; }
      i++; prev = 'r'; continue;
    }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; } out.push({ v: src.slice(i + 1, j), at: j + 1 }); i = j + 1; prev = 's'; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
};
const site = fs.readdirSync(path.join(root, 'docs/js')).filter((f) => f.endsWith('.js')).map((f) => 'docs/js/' + f);
for (const f of site) {
  const src = read(f);
  for (const l of lit(src)) {
    if (!/^cg\.[\w.]*$/.test(l.v)) continue;
    need(STORE[l.v], f, 'localStorage key "' + l.v + '" is new: add it to STORE in this test as device, game or mode, and split it if it is per game or per mode');
    const after = src.slice(l.at, l.at + 60);
    if (STORE[l.v] === 'game') need(/^\s*\+\s*(st\(\)|s)\.id\b/.test(after), f, '"' + l.v + '" is per game but is not followed by the game id');
    if (STORE[l.v] === 'mode') need(/^\s*\+\s*\(.*isAcc/.test(after), f, '"' + l.v + '" is per mode but is not split by E.isAcc');
  }
}

// ---- The other family's character in code ---------------------------------------------------------------
// Words players see come from the theme. Text in the code is shared by every game, so it never names Chester
// or Hazel (Taco games see it too), and only fx.js's Taco-only lines name Taco. "Chester's Escape" is the
// built-in board's name, used to tell a designer board's own name apart from it.
const CODE = ['docs/js/app.js', 'docs/js/render.js', 'docs/js/store.js', 'docs/js/engine.js', 'docs/js/services.js', 'docs/js/fx.js', 'docs/js/dice.js', 'docs/sw.js', 'worker/src/index.js', 'worker/src/push.js'];
for (const f of CODE) for (const l of lit(read(f))) {
  if (/\b(Chester|Hazel)\b/.test(l.v.replace(/Chester's Escape/g, ''))) need(false, f, 'text names Chester or Hazel, which Taco games would show: "' + l.v.slice(0, 80) + '"');
  if (/\bTaco\b/.test(l.v) && f !== 'docs/js/fx.js') need(false, f, 'text names Taco, which Chester games would show: "' + l.v.slice(0, 80) + '"');
}

// ---- What the Worker loads from the site ------------------------------------------------------------------
// The game server runs content.js and engine.js itself, so a change to either needs a Worker deploy. push.ps1
// deploys when worker/, docs/js/content.js or docs/js/engine.js changed. A new file here needs adding there too.
const loads = new Set();
for (const f of fs.readdirSync(path.join(root, 'worker/src'))) {
  for (const m of read('worker/src/' + f).matchAll(/import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g)) if (m[1].includes('docs/')) loads.add(m[1].replace(/^.*docs\//, 'docs/'));
}
need(JSON.stringify([...loads].sort()) === JSON.stringify(['docs/js/content.js', 'docs/js/engine.js']), 'worker', 'the Worker loads ' + [...loads].sort().join(', ') + ' from the site. Add anything new to the Chester Watch list in push.ps1 and the playbook');

assert.deepStrictEqual(problems, [], 'Playbook problems (see beat-saber-games-playbook.md):\n  ' + problems.join('\n  '));
console.log('playbook ok (' + studioNote + ')');
