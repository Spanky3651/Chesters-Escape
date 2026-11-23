// node tests/worker.test.mjs  - runs the game server's AccSaber timing against a fake AccSaber and BeatLeader:
// the day's turn, the start, the end, late missions, weekly bonuses and the join checks.
import assert from 'node:assert';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s, c, n) { if (s === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}', shortCircuit: true }; return n(s, c); }"));
const R = new URL('..', import.meta.url).href.replace(/\/$/, '');
await import(R + '/docs/js/content.js'); await import(R + '/docs/js/engine.js');
const { Game } = await import(R + '/worker/src/index.js');
const E = globalThis.CGEngine, C = globalThis.CGContent;
// fake AccSaber: counts per pool
let BLDISC = { bl1: '1', bl2: '2' };
let ACC = { daily: {}, weekly: {} }, accUp = true, clock = Date.UTC(2026, 10, 30, 20);
const realNow = Date.now; Date.now = () => clock;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('/player/')) { const id = url.split('/player/')[1]; return { ok: true, status: 200, json: async () => ({ id, name: 'N' + id, socials: BLDISC[id] ? [{ service: 'Discord', userId: BLDISC[id] }] : [] }) }; }
  if (!url.includes('accsaber')) return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
  if (!accUp) return { ok: false, status: 503, text: async () => '' };
  if (url.includes('/v1/users/')) return { ok: true, status: 200, json: async () => ({ clan: { slug: 'genx-clan' } }) };
  const pool = url.match(/pool=(\w+)/)[1];
  const rows = Object.entries(ACC[pool]).map(([id, n]) => `{"missionsCompleted":${n},"player":{"id":"${id}","name":"x"},"clan":{"slug":"genx-clan","id":"a28fb65d"},"missionXp":1}`);
  return { ok: true, status: 200, text: async () => `{"content":[${rows.join(',')}],"last":true}` };
};
function mk() {
  const store = new Map(); let alarm = null;
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, delete: async (k) => store.delete(k) }, blockConcurrencyWhile: (f) => f() };
  const g = new Game(ctx, { ACC_API: 'https://api.accsaber.com' });
  g.clan = () => ({ accClan: 'genx-clan', accClanName: 'GenX Clan', id: 'genx' });
  g.useClan = () => {}; g.notifyHosts = async (m) => { (g.hostMsgs = g.hostMsgs || []).push(m); };
  g.announceStart = async () => {}; g.announceEnd = async () => {}; g.discordFeed = async () => {}; g.visit = async () => {}; g.chatLink = async () => null;
  g.ctxAlarm = () => alarm;
  return g;
}
async function setup(opts = {}) {
  const g = mk();
  await new Promise((r) => setTimeout(r, 20));
  const board = C.boards['chester-escape']();
  g.state = E.createGame({ board, cards: C.cardsFor('snowy'), themeId: 'snowy', settings: { accsaber: true, timeZone: 'UTC', cutoffHour: 4, cutoffMinute: 0 }, status: 'signup', startsAt: opts.startsAt });
  g.meta = { access: { mode: 'open', allowed: [], pending: [] } };
  ['1', '2'].forEach((id) => { E.addPlayer(g.state, { id: 'd' + id, discordId: id, name: 'P' + id, blId: 'bl' + id }); E.chooseRoute(g.state, 'd' + id, 'longer'); });
  return g;
}
const U = (id) => ({ id, name: 'P' + id, isHost: false });
const ok = (name) => console.log('ok  ' + name);

// Monday weekly before the start counts for week 1; signup missions don't count as day 1's
{
  ACC = { daily: { bl1: 10, bl2: 5 }, weekly: { bl1: 3, bl2: 2 } };
  clock = Date.UTC(2026, 10, 29, 20);            // Sunday, previous AccSaber week
  const g = await setup({ startsAt: Date.UTC(2026, 11, 1, 4) });   // Tue 04:00 UTC = Mon 11 PM ET
  await g.accRefresh({ force: true });
  clock = Date.UTC(2026, 10, 30, 12);            // Monday: week turned at Mon 04:00 UTC
  ACC.weekly.bl1 = 4; ACC.daily.bl1 = 12;          // a weekly and two dailies done Monday, before the start
  await g.accRefresh({ force: true });
  clock = Date.UTC(2026, 11, 1, 4);
  await g.catchUp();
  assert.strictEqual(g.state.status, 'running');
  const p1 = g.state.players.d1;
  assert.strictEqual(p1.accBonus, 1, 'Monday weekly gives the week 1 bonus');
  assert.strictEqual(E.accDaily(g.state, p1), false, 'dailies from sign-ups are not day 1');
  assert.strictEqual(g.state.players.d2.accBonus || 0, 0);
  ok('Monday weekly counts for week 1, sign-up dailies do not count for day 1');

  // late mission not seen until the turn: still counts for the day that ended (lifeline back)
  p1.lifelines = 2;
  clock += 3600e3; ACC.daily.bl1 = 13; await g.accRefresh({ force: true });   // day 1 daily seen
  assert(E.accDaily(g.state, p1));
  await g.act(U('1'), 'roll', {});
  ACC.daily.bl1 = 14;                             // second daily, late, nobody opens the page
  clock = g.meta.nextCutoff;                      // the reset
  await g.catchUp();
  assert.strictEqual(g.state.day, 2);
  assert.strictEqual(p1.lifelines, 3, 'both dailies on day 1 earn the lifeline back at the turn');
  assert.strictEqual(E.accDaily(g.state, p1), false, 'the late daily is not counted again on day 2');
  ok('late second daily earns the lifeline back at the reset');

  // late weekly on Sunday night, read only at Monday's reset: still the old week's bonus
  const day2 = g.state.day;
  while (E.accWeek(g.meta.nextCutoff) === E.accWeek(clock)) { clock = g.meta.nextCutoff; await g.catchUp(); }
  const before = g.state.players.d2.accBonus || 0;
  ACC.weekly.bl2 = 3;                             // done Sunday night, not seen
  clock = g.meta.nextCutoff; await g.catchUp();   // Monday reset
  assert.strictEqual((g.state.players.d2.accBonus || 0), before + 1, 'Sunday weekly gives that week\'s bonus');
  ACC.weekly.bl2 = 4; clock += 3600e3; await g.accRefresh({ force: true });
  assert.strictEqual((g.state.players.d2.accBonus || 0), before + 2, 'Monday weekly gives the new week\'s bonus too');
  ok('late Sunday weekly counts for its own week');

  // roll after the reset but before the alarm: it's the new day's roll
  ACC.daily.bl2 = (ACC.daily.bl2 || 0) + 1; clock += 600e3; await g.accRefresh({ force: true });
  await g.act(U('2'), 'roll', {});
  const cut = g.meta.nextCutoff;
  clock = cut + 5000;                              // 5 s after the reset, alarm hasn't run
  const d0 = g.state.day;
  const r = await g.act(U('2'), 'roll', {});
  assert.strictEqual(g.state.day, d0 + 1, 'the action turns the day first');
  assert(g.state.players.d2.accBonus > 0 || (r && r.error), 'roll either spends the bonus or is refused');
  ok('an action after the reset turns the day first');

  // roll after the end time
  g.state.endsAt = clock + 1000; clock += 2000;
  ACC.daily.bl1 += 1;
  const r2 = await g.act(U('1'), 'roll', {});
  assert.strictEqual(g.state.status, 'finished');
  assert(r2 && r2.error, 'no roll after the end');
  ok('no roll after the end time');
}
// hidden with no reveal at the start: does not start, host told once, no busy alarm
{
  clock = Date.UTC(2026, 11, 5, 3);
  const g = await setup({ startsAt: Date.UTC(2026, 11, 5, 4) });
  E.hide(g.state, true, null);
  clock = Date.UTC(2026, 11, 5, 4, 0, 5);
  await g.catchUp(); await g.catchUp();
  assert.strictEqual(g.state.status, 'signup');
  assert.strictEqual((g.hostMsgs || []).length, 1);
  assert(g.ctxAlarm() - clock > 60000, 'alarm not set to fire every second');
  const r = await g.act({ id: 'h', isHost: true }, 'schedule', { startsAt: clock + 3600e3 });
  assert(r && r.error, 'schedule refuses a start while hidden with no reveal');
  ok('hidden game does not start without a reveal');
}
// AccSaber down for the start: dailies done right after aren't swallowed
{
  ACC = { daily: { bl1: 10, bl2: 5 }, weekly: { bl1: 3, bl2: 2 } };
  clock = Date.UTC(2026, 11, 7, 20);
  const g = await setup({ startsAt: Date.UTC(2026, 11, 8, 4) });
  await g.accRefresh({ force: true });
  accUp = false; clock = Date.UTC(2026, 11, 8, 4); await g.catchUp(); assert.strictEqual(g.state.status, 'running');
  ACC.daily.bl1 = 11; clock += 3 * 3600e3; accUp = true;
  await g.accRefresh({ force: true });
  assert(E.accDaily(g.state, g.state.players.d1), 'mission after an outage at the start still counts');
  ok('AccSaber down at the start does not swallow day 1 missions');
}
// carried-over players get the AccSaber join checks
{
  clock = Date.UTC(2026, 11, 10, 20); accUp = true;
  const g = await setup({});
  g.state.status = 'finished';
  BLDISC = { bl1: '1' };                          // player 2 never linked Discord on BeatLeader
  const r = await g.act({ id: 'h', isHost: true }, 'newGame', { signup: true });
  assert(!r || !r.error, r && r.error);
  assert(g.state.players.d1 && g.state.players.d1.accOk, 'player 1 passes');
  assert(!g.state.players.d2, 'player 2 is taken off');
  assert((g.hostMsgs || []).some((m) => /taken off/.test(m.title)));
  ok('carried-over players get the join checks');
}
console.log('worker timing tests passed');
