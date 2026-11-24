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
let BLDISC = { bl1: '1', bl2: '2' }, BLCLAN = {}, blUp = true;
let ACC = { daily: {}, weekly: {} }, accUp = true, clock = Date.UTC(2026, 10, 30, 20);
const realNow = Date.now; Date.now = () => clock;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('/player/') && !blUp) return { ok: false, status: 503, json: async () => ({}) };
  if (url.includes('/player/')) { const id = url.split('/player/')[1]; return { ok: true, status: 200, json: async () => ({ id, name: 'N' + id, socials: BLDISC[id] ? [{ service: 'Discord', userId: BLDISC[id] }] : [], clans: (BLCLAN[id] || []).map((c) => ({ id: c, tag: c === 85 ? 'GENX' : 'X' })) }) }; }
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
  g.clan = () => ({ accClan: 'genx-clan', accClanName: 'GenX Clan', blClan: '85', blClanName: 'GENX', id: 'genx' });
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
  assert(g.state.players.d1 && g.state.players.d1.checked === 'acc', 'player 1 passes');
  assert(!g.state.players.d2, 'player 2 is taken off');
  assert((g.hostMsgs || []).some((m) => /taken off/.test(m.title)));
  ok('carried-over players get the join checks');
}
// GenX map game: GENX on BeatLeader and Discord linked, no AccSaber check
{
  clock = Date.UTC(2026, 11, 12, 20);
  const g = await setup({});
  g.state.settings.accsaber = false;
  g.state.order.slice().forEach((pid) => E.removePlayer(g.state, pid));
  BLDISC = { bl3: '3', bl4: '4', bl5: '9' }; BLCLAN = { bl3: [85], bl4: [12], bl5: [85] };
  let r = await g.act(U('4'), 'join', { blId: 'bl4' });
  assert(r && /GENX/.test(r.error), 'not in GENX: refused');
  r = await g.act(U('5'), 'join', { blId: 'bl5' });
  assert(r && /different Discord/.test(r.error), 'linked to a different Discord: refused');
  r = await g.act(U('3'), 'join', { blId: 'bl3' });
  assert(!r.error, r.error);
  assert.strictEqual(g.state.players.d3.checked, 'bl');
  // a sign-up that skipped the checks gets them; switching to AccSaber mode re-checks for the AccSaber clan
  E.addPlayer(g.state, { id: 'd4', discordId: '4', name: 'P4', blId: 'bl4' });
  await g.accVet();
  assert(!g.state.players.d4, 'unchecked sign-up outside GENX is taken off');
  ok('GenX map game checks GENX on BeatLeader and the Discord link');
}
// GenX map game mid-game: leaving GENX on BeatLeader pauses rolls, adding it back unpauses
{
  clock = Date.UTC(2026, 11, 14, 20);
  const g = await setup({});
  g.state.settings.accsaber = false; g.state.settings.timeZone = 'UTC';
  BLDISC = { bl1: '1', bl2: '2' }; BLCLAN = { bl1: [85], bl2: [85] };
  E.startGame(g.state, clock); g.meta.nextCutoff = E.nextCutoff(g.state.settings, clock + 1000);
  await g.blClanSweep();
  assert(!g.state.players.d1.paused && !g.state.players.d2.paused, 'everyone in GENX: nobody paused');
  BLCLAN.bl2 = [12];
  blUp = false; await g.blClanSweep(); blUp = true;
  assert(!g.state.players.d2.paused, 'BeatLeader down: nobody paused');
  await g.blClanSweep();
  assert.strictEqual(g.state.players.d2.paused, 'bl', 'left GENX: paused');
  assert.strictEqual(E.canRoll(g.state, 'd2').code, 'paused');
  assert(/BeatLeader/.test(E.canRoll(g.state, 'd2').reason));
  let r = await g.act(U('2'), 'roll', {});
  assert(r && r.error, 'paused player cannot roll');
  r = await g.act(U('1'), 'roll', {});
  assert(!r.error, 'others still roll: ' + (r && r.error));
  BLCLAN.bl2 = [85, 12];
  r = await g.act(U('2'), 'verify', {});
  assert(!r.error && !r.paused && !g.state.players.d2.paused, 'added back: check again unpauses');
  assert(g.state.events.some((e) => e.t === 'unpaused' && e.on === 'bl'));
  // host lets them play: the check leaves them alone
  BLCLAN.bl2 = [12]; await g.blClanSweep(); await g.blClanSweep();
  assert.strictEqual(g.state.players.d2.paused, 'bl');
  await g.act({ id: 'h', isHost: true }, 'unpause', { pid: 'd2' });
  await g.blClanSweep(); await g.blClanSweep();
  assert(!g.state.players.d2.paused, 'host override sticks');
  ok('GenX map game pauses a player who leaves GENX and unpauses them when they are back');
}
// AccSaber games and clans without a BeatLeader clan never do the BeatLeader clan check
{
  clock = Date.UTC(2026, 11, 16, 20);
  const g = await setup({});
  E.startGame(g.state, clock);
  BLCLAN = { bl1: [12], bl2: [12] };
  await g.blClanSweep();
  assert(!g.state.players.d1.paused, 'AccSaber game: no BeatLeader clan pause');
  const b = await setup({});
  b.clan = () => ({ id: 'beaters' });
  b.state.settings.accsaber = false; E.startGame(b.state, clock);
  await b.blClanSweep(); await b.accVet();
  assert(!b.state.players.d1.paused && b.state.players.d1, 'Beaters: no clan checks');
  ok('AccSaber and Beaters games are untouched');
}
// No Discord on BeatLeader: ask the host instead, who lets them in; the clan check still runs
{
  clock = Date.UTC(2026, 11, 18, 20); accUp = true;
  const g = await setup({});
  g.state.order.slice().forEach((pid) => E.removePlayer(g.state, pid));
  BLDISC = { bl6: '9', bl8: '8' }; BLCLAN = {};
  let r = await g.act(U('7'), 'join', { blId: 'bl7' });
  assert(r && r.code === 'no-link' && /Link this Discord/.test(r.error), 'no Discord on BeatLeader: no-link code');
  r = await g.act(U('7'), 'join', { blId: 'bl6' });
  assert(r && r.error && r.code !== 'no-link' && /different Discord/.test(r.error), 'profile linked to someone else: no offer to ask');
  r = await g.act(U('7'), 'askJoin', { blId: 'bl6' });
  assert(r && /different Discord/.test(r.error), 'cannot ask with a profile linked to someone else');
  r = await g.act(U('7'), 'askJoin', { blId: 'bl7' });
  assert(!r.error && r.asked === true, r.error);
  assert.strictEqual(g.joinAsks().length, 1);
  assert(!g.state.players.d7, 'not on the board yet');
  assert((g.hostMsgs || []).some((m) => /asked to join/.test(m.title)), 'host hears about it');
  r = await g.act(U('7'), 'approveJoin', { id: '7' });
  assert(r && /Only the host/.test(r.error), 'only the host approves');
  const st = await g.getState({ id: 'h', isHost: true });
  assert.strictEqual(st.joinAsks.length, 1, 'host sees the request');
  r = await g.act({ id: 'h', isHost: true }, 'approveJoin', { id: '7' });
  assert(!r.error, r.error);
  const p7 = g.state.players.d7;
  assert(p7 && p7.manual && p7.checked === 'acc' && p7.blId === 'bl7', 'let in by the host');
  assert.strictEqual(g.joinAsks().length, 0, 'request cleared');
  // the next game carries them over without dropping them for the missing link
  g.state.status = 'finished';
  r = await g.act({ id: 'h', isHost: true }, 'newGame', { signup: true });
  assert(!r || !r.error, r && r.error);
  assert(g.state.players.d7 && g.state.players.d7.manual, 'host-approved player survives the carry-over check');
  // a decline clears the request; old requests don't follow into a new game
  r = await g.act(U('5'), 'askJoin', { blId: 'bl5' });
  assert(!r.error, r.error);
  r = await g.act({ id: 'h', isHost: true }, 'declineJoin', { id: '5' });
  assert.strictEqual(g.joinAsks().length, 0, 'declined');
  ok('players without Discord on BeatLeader can ask the host, who lets them in');
}
// asking still needs the clan: map game without GENX is refused
{
  clock = Date.UTC(2026, 11, 19, 20);
  const g = await setup({});
  g.state.settings.accsaber = false;
  BLDISC = {}; BLCLAN = { bl9: [12] };
  const r = await g.act(U('9'), 'askJoin', { blId: 'bl9' });
  assert(r && /GENX/.test(r.error), 'clan check runs on asks');
  const b = await setup({});
  b.clan = () => ({ id: 'beaters' });
  b.state.settings.accsaber = false;
  const r2 = await b.act(U('9'), 'askJoin', { blId: 'bl9' });
  assert(r2 && /no join checks/.test(r2.error), 'Beaters has nothing to ask for');
  ok('asking to join still needs the clan');
}
console.log('worker timing tests passed');
