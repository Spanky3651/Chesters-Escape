// node tests/engine.test.js  - simulates full games and checks the rules hold
const assert = require('assert');
const E = require('../docs/js/engine.js');
const C = require('../docs/js/content.js');

function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function newGame(theme, rng) {
  const board = C.boards['chester-escape']();
  assert.deepStrictEqual(E.checkBoard(board), [], 'board should validate');
  return E.createGame({ board, cards: C.cardsFor(theme), themeId: theme, rng });
}

// 1. board sanity
{
  const b = C.boards['chester-escape']();
  console.log('longer', b.routes.longer.length, 'riskier', b.routes.riskier.length, 'spaces', Object.keys(b.spaces).length);
  const pos = {}; Object.values(b.spaces).forEach(s => { const k = s.x + ',' + s.y; assert(!pos[k], 'two spaces on ' + k + ' ' + s.id + ' ' + pos[k]); pos[k] = s.id; });
  assert(b.routes.riskier.includes('pulled') && b.routes.riskier.includes('safe'));
  ['cemetery', 'christmas'].forEach(t => { assert.strictEqual(C.cardsFor(t).length, 20); Object.values(b.spaces).forEach(s => { if (s.kind) assert(C.themes[t].kinds[s.kind], t + ' missing kind ' + s.kind); }); });
}

// 2. full simulated games
let days = { longer: [], riskier: [] }, cardsSeen = new Set(), types = new Set();
for (let g = 0; g < 400; g++) {
  const rng = seeded(g + 1);
  const s = newGame(g % 2 ? 'christmas' : 'cemetery', rng);
  const route = g % 2 ? 'longer' : 'riskier';
  ['a', 'b', 'c', 'd'].forEach((id, i) => { E.addPlayer(s, { id, name: id }); E.chooseRoute(s, id, i % 2 ? 'longer' : 'riskier'); });
  let guard = 0;
  while (s.finishOrder.length < 4 && guard++ < 400) {
    for (const id of s.order) {
      const p = s.players[id];
      p.tasks.slice().forEach(t => E.completeTask(s, id, t.id, { by: 'sim' }));
      let c = E.canRoll(s, id);
      while (c.ok) {
        const r = E.roll(s, id, { rng });
        r.events.forEach(e => { types.add(e.t); if (e.t === 'card') cardsSeen.add(e.card); });
        assert(p.pos >= -1 && p.pos <= E.exitIndex(s, p));
        p.tasks.slice().forEach(t => E.completeTask(s, id, t.id, { by: 'sim' }));
        c = E.canRoll(s, id);
      }
      assert(['rolled', 'skip', 'finished', 'not-running'].includes(c.code), 'unexpected block ' + c.code);
    }
    E.advanceDay(s);
  }
  assert(guard < 400, 'game never ended');
  s.order.forEach(id => { const p = s.players[id]; days[p.route].push(p.finished.day); });
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('days to escape  longer avg', avg(days.longer), 'median', med(days.longer), 'max', Math.max(...days.longer));
console.log('                riskier avg', avg(days.riskier), 'median', med(days.riskier), 'min', Math.min(...days.riskier), 'max', Math.max(...days.riskier));
console.log('cards drawn', cardsSeen.size, 'event types', [...types].sort().join(' '));
assert.strictEqual(cardsSeen.size, 20);

// 3. specific rules
{
  const s = newGame('cemetery', seeded(9));
  E.addPlayer(s, { id: 'x', name: 'x' }); E.chooseRoute(s, 'x', 'riskier');
  const clear = () => s.players.x.tasks.slice().forEach((t) => E.completeTask(s, 'x', t.id, { by: 'test' }));
  // land on the grave (index 3) -> back to start
  let r = E.roll(s, 'x', { forced: 4 });
  assert.strictEqual(s.players.x.pos, -1, 'grave sends to start');
  assert.strictEqual(E.canRoll(s, 'x').code, 'task', 'back to start still gets a map');
  assert(s.players.x.tasks[0].bonus, 'it is a bonus map');
  clear();
  assert.strictEqual(E.canRoll(s, 'x').code, 'rolled');
  E.advanceDay(s);
  // shield blocks the grave
  s.players.x.shield = true; r = E.roll(s, 'x', { forced: 4 });
  assert.strictEqual(s.players.x.pos, 3, 'shield blocks grave'); assert(!s.players.x.shield);
  clear(); E.advanceDay(s);
  // swim to safety warps to SAFE
  E.setPosition(s, 'x', 6); E.roll(s, 'x', { forced: 2 });
  assert.strictEqual(E.routeOf(s, s.players.x)[s.players.x.pos], 'safe', 'swim warps to safe');
  assert.strictEqual(s.players.x.tasks.length, 0, 'safe is the one stop with no map');
  E.advanceDay(s);
  // current sends back to pulled under, which costs a turn
  E.setPosition(s, 'x', 12); E.roll(s, 'x', { forced: 2 });
  assert.strictEqual(E.routeOf(s, s.players.x)[s.players.x.pos], 'pulled');
  assert.strictEqual(s.players.x.skip, 1);
  assert(s.players.x.tasks.length, 'losing a turn still gets a map today'); clear();
  E.advanceDay(s);
  assert.strictEqual(E.canRoll(s, 'x').code, 'skip', 'lost turn');
  E.advanceDay(s);
  assert(E.canRoll(s, 'x').ok);
  // card move onto a card space does not draw again
  const s2 = newGame('cemetery', seeded(3));
  E.addPlayer(s2, { id: 'y' }); E.chooseRoute(s2, 'y', 'longer');
  E.setPosition(s2, 'y', 2);       // L3, next is card at index 3
  E.hostCard(s2, 'y', 'c07');      // move +1 onto card -> rest, no draw
  assert.strictEqual(s2.players.y.pos, 3); assert.strictEqual(s2.events.filter(e => e.t === 'card').length, 1);
  // card move onto a map space makes you play it
  E.setPosition(s2, 'y', 3); E.hostCard(s2, 'y', 'c07');
  assert.strictEqual(s2.players.y.tasks.length, 1);
  // matchScores clears a task when a fresh score is found
  const t = s2.players.y.tasks[0];
  const cleared = E.matchScores(s2, 'y', [{ hash: 'ABC', time: Math.floor(Date.now() / 1000), diff: 'Expert', acc: 0.91 }], { [t.bsr[0]]: 'abc' });
  assert.strictEqual(cleared.length, 1); assert.strictEqual(s2.players.y.tasks.length, 0);
  // old score does not count
  E.setPosition(s2, 'y', 1, { apply: true });
  const t2 = s2.players.y.tasks[0];
  assert.strictEqual(E.matchScores(s2, 'y', [{ hash: 'DEF', time: 1000 }], { [t2.bsr[0]]: 'def' }).length, 0);
  // exact finish
  const s3 = newGame('cemetery'); s3.settings.exactFinish = true;
  E.addPlayer(s3, { id: 'z' }); E.chooseRoute(s3, 'z', 'longer'); E.setPosition(s3, 'z', E.exitIndex(s3, s3.players.z) - 2);
  E.roll(s3, 'z', { forced: 4 }); assert(!s3.players.z.finished, 'overshoot stays');
  assert(s3.players.z.tasks.length, 'overshoot still gets a map'); s3.players.z.tasks.slice().forEach((t) => E.completeTask(s3, 'z', t.id, { by: 'test' }));
  E.advanceDay(s3); E.roll(s3, 'z', { forced: 2 }); assert(s3.players.z.finished, 'exact roll escapes');
  // cutoff calc
  const nc = E.nextCutoff({ cutoffHour: 0, cutoffMinute: 59, timeZone: 'America/New_York' }, Date.UTC(2026, 9, 18, 17, 0));
  console.log('next cutoff from 2026-10-18 13:00 ET ->', new Date(nc).toISOString(), '(expect 2026-10-19T04:59Z)');
  assert.strictEqual(new Date(nc).toISOString(), '2026-10-19T04:59:00.000Z');
}
// every roll ends with a map, except on Safe, on escaping, or with a bonus roll waiting
{
  let rolls = 0, bonus = 0, safe = 0, why = {};
  for (let g = 0; g < 300; g++) {
    const rng = seeded(1000 + g);
    const s = newGame(g % 2 ? 'christmas' : 'cemetery', rng);
    ['a', 'b', 'c'].forEach((id, i) => { E.addPlayer(s, { id, name: id }); E.chooseRoute(s, id, i % 2 ? 'longer' : 'riskier'); });
    for (let d = 0; d < 80 && s.finishOrder.length < 3; d++) {
      for (const id of s.order) {
        const p = s.players[id];
        let guard = 0;
        while (E.canRoll(s, id).ok && guard++ < 5) {
          const before = s.events.length;
          E.roll(s, id, { rng });
          rolls++;
          const sp = p.pos >= 0 ? s.board.spaces[E.routeOf(s, p)[p.pos]] : null;
          if (!p.finished && !p.extraRoll && !(sp && sp.type === 'safe')) assert(p.tasks.length > 0, 'roll ended without a map on ' + (sp ? sp.type : 'start'));
          if (sp && sp.type === 'safe' && !p.tasks.length) safe++;
          const b = s.events.slice(before).find((e) => e.t === 'task' && e.bonus);
          if (b) { bonus++; const k = sp ? sp.type : 'start'; why[k] = (why[k] || 0) + 1; }
        }
        p.tasks.slice().forEach((t) => E.completeTask(s, id, t.id, { by: 'test' }));
      }
      E.advanceDay(s);
    }
  }
  console.log('every roll has a map: ' + rolls + ' rolls, ' + bonus + ' bonus maps (' + Object.entries(why).map(([k, v]) => k + ' ' + v).join(', ') + '), ' + safe + ' safe stops');
}

// bonus map upgrade only touches boards still on the built-in list
{
  const built = C.boards['chester-escape']().bonusMaps;
  const old = { bonusMaps: built.slice(0, 6) }; assert(E.upgradeBonus(old, built)); assert.strictEqual(old.bonusMaps.length, built.length);
  const custom = { bonusMaps: ['aaaa1', built[0]] }; assert(!E.upgradeBonus(custom, built)); assert.deepStrictEqual(custom.bonusMaps, ['aaaa1', built[0]]);
  const same = { bonusMaps: built.slice() }; assert(!E.upgradeBonus(same, built));
  console.log('bonus pool ' + built.length + ' maps, upgrade ok');
}

// end of the game: ranking, end time, everyone escaped
{
  const s = newGame('cemetery', seeded(21));
  ['a', 'b', 'c', 'd'].forEach((id) => { E.addPlayer(s, { id, name: id }); E.chooseRoute(s, id, 'longer'); });
  E.setPosition(s, 'a', 30); E.setPosition(s, 'b', 35); E.setPosition(s, 'c', 30); E.setPosition(s, 'd', E.exitIndex(s, s.players.d), { apply: true });
  assert(s.players.d.finished, 'd escaped');
  const r = E.ranking(s);
  assert.deepStrictEqual(r.map((x) => x.pid), ['d', 'b', 'a', 'c']);
  assert.deepStrictEqual(r.map((x) => x.place), [1, 2, 3, 3], 'ties share a place');
  assert(E.endGame(s, 123)); assert.strictEqual(s.status, 'finished'); assert.strictEqual(s.final[0].pid, 'd');
  assert.strictEqual(E.canRoll(s, 'a').code, 'not-running'); assert(!E.endGame(s));
  // everyone out ends it by itself
  const s2 = newGame('cemetery', seeded(22));
  ['x', 'y'].forEach((id) => { E.addPlayer(s2, { id, name: id }); E.chooseRoute(s2, id, 'riskier'); });
  E.setPosition(s2, 'x', E.exitIndex(s2, s2.players.x), { apply: true }); assert.strictEqual(s2.status, 'running');
  E.setPosition(s2, 'y', E.exitIndex(s2, s2.players.y), { apply: true }); assert.strictEqual(s2.status, 'finished', 'last escape ends the game');
  console.log('end of game ok');
}

// replay: rewinding the event log gives the real positions at the start of each day
{
  let checked = 0;
  for (let g = 0; g < 60; g++) {
    const rng = seeded(500 + g), s = newGame('cemetery', rng), snaps = {};
    ['a', 'b', 'c', 'd'].forEach((id, i) => { E.addPlayer(s, { id, name: id }); E.chooseRoute(s, id, i % 2 ? 'longer' : 'riskier'); });
    for (let d = 1; d < 40 && s.status === 'running'; d++) {
      snaps[s.day] = { first: s.seq + 1, pos: Object.fromEntries(s.order.map((id) => [id, s.players[id].pos])) };
      if (d === 5) { E.setPosition(s, 'a', 10); E.resetPlayer(s, 'b'); }
      for (const id of s.order) { let k = 0; while (E.canRoll(s, id).ok && k++ < 5) E.roll(s, id, { rng }); s.players[id].tasks.slice().forEach((t) => E.completeTask(s, id, t.id, { by: 't' })); }
      E.advanceDay(s);
    }
    for (const day of Object.keys(snaps)) {
      const sn = snaps[day]; if (!s.events.length || s.events[0].id > sn.first) continue;
      const got = E.positionsBefore(s, sn.first);
      for (const id of s.order) assert.strictEqual(got[id], sn.pos[id], 'game ' + g + ' day ' + day + ' player ' + id);
      checked++;
    }
  }
  console.log('replay rewind matches real positions on ' + checked + ' days');
}

// roll reminders
{
  const s = newGame('cemetery', seeded(31));
  E.addPlayer(s, { id: 'r1', name: 'r1' }); E.chooseRoute(s, 'r1', 'longer');
  E.addPlayer(s, { id: 'r2', name: 'r2' });
  assert.strictEqual(E.reminderFor(s, 'r1').title, 'Your roll is waiting');
  assert.strictEqual(E.reminderFor(s, 'r2'), null, 'no route yet, no reminder');
  E.roll(s, 'r1', { forced: 1 });
  const p = s.players.r1;
  if (p.tasks.length) { assert(/!bsr/.test(E.reminderFor(s, 'r1').body)); E.claimTask(s, 'r1', p.tasks[0].id, {}); }
  assert.strictEqual(E.reminderFor(s, 'r1'), null, 'rolled and nothing open (or waiting on the host)');
  assert.strictEqual(E.localHour(Date.UTC(2026, 9, 19, 23, 30), 'America/New_York'), 19);
  console.log('reminders ok');
}

// sign-ups before a scheduled start
{
  const board = C.boards['chester-escape']();
  const at = Date.now() + 3 * 86400000;
  const s = E.createGame({ board, cards: C.cardsFor('cemetery'), status: 'signup', startsAt: at, rng: seeded(7) });
  assert.strictEqual(s.status, 'signup'); assert.strictEqual(s.startsAt, at);
  E.addPlayer(s, { id: 'a', name: 'a' }); E.chooseRoute(s, 'a', 'longer');
  assert.strictEqual(E.canRoll(s, 'a').code, 'not-running', 'no rolls during sign-ups');
  assert(s.events.every((e) => e.pre), 'sign-up events are marked');
  assert.strictEqual(E.advanceDay(s), 1, 'days do not advance before the start');
  assert(E.startGame(s, Date.now()));
  assert.strictEqual(s.status, 'running'); assert.strictEqual(s.day, 1);
  assert(E.canRoll(s, 'a').ok, 'can roll after the start');
  assert(!E.startGame(s, Date.now()), 'start only once');
  assert.strictEqual(s.events[s.events.length - 1].t, 'begin');
  console.log('sign-up phase ok');
}

console.log('all engine tests passed');
