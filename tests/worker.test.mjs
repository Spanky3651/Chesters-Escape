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
let BLMISSING = new Set(), DISC = {};   // BeatLeader profiles that do not exist; what the fake Discord answers
let ACC = { daily: {}, weekly: {} }, accUp = true, clock = Date.UTC(2026, 10, 30, 20);
const realNow = Date.now; Date.now = () => clock;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('discord.com')) {
    const key = url.includes('/oauth2/token') ? 'token' : url.endsWith('/guilds') ? 'guilds' : 'me';
    if (DISC[key] === 'throw') throw new Error('network down for ' + String(DISC.leak || ''));
    return { ok: true, status: 200, json: async () => DISC[key] };
  }
  if (url.includes('/player/') && BLMISSING.has(url.split('/player/')[1])) return { ok: false, status: 404, json: async () => ({}) };
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
  g.clan = () => ({ name: 'GenX', accClan: 'genx-clan', accClanName: 'GenX Clan', blClan: '85', blClanName: 'GENX', id: 'genx' });
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
// The host gives a missed weekly bonus roll; players can't, and it's once per AccSaber week
{
  clock = Date.UTC(2026, 11, 16, 20);
  const g = await setup({});
  E.startGame(g.state, clock);
  let r = await g.act(U('1'), 'giveWeekly', { pid: 'd1' });
  assert(r && r.error, 'only the host gives a bonus roll');
  r = await g.act({ id: 'h', isHost: true }, 'giveWeekly', { pid: 'd1' });
  assert(!r.error, r.error);
  assert.strictEqual(g.state.players.d1.accBonus, 1);
  r = await g.act({ id: 'h', isHost: true }, 'giveWeekly', { pid: 'd1' });
  assert(r && /already/.test(r.error), 'once a week');
  ok('host gives a missed weekly bonus roll once a week');
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
// ---------------------------------------------------------------------------
// Sign-in failure alerts for the host: the Host tools log and the push, for the Discord step and every join check
const HOST = { id: 'h1', isHost: true };
const alerts = (g) => (g.hostMsgs || []).filter((m) => /couldn't sign in/.test(m.title));
const fresh = async (opts = {}) => { const g = await setup(opts); g.state.settings.accsaber = false; g.state.order.slice().forEach((pid) => E.removePlayer(g.state, pid)); return g; };
{
  // a failed join is logged with the reason and the fix, and the host is pushed
  clock = Date.UTC(2026, 11, 20, 20);
  const g = await fresh();
  BLDISC = { bl3: '3', bl4: '4', bl6: '9' }; BLCLAN = { bl3: [85], bl4: [12], bl6: [85] }; BLMISSING = new Set(['ghost']);
  let r = await g.act({ id: '4', name: 'Four', isHost: false }, 'join', { blId: 'https://beatleader.com/u/bl4' });
  assert(r && r.code === 'bl-clan', 'the join is still refused');
  assert.strictEqual(g.meta.signinLog.length, 1);
  const e = g.meta.signinLog[0];
  assert.deepStrictEqual([e.at, e.id, e.name, e.game, e.code, e.bl], [clock, '4', 'Four', 'GenX', 'bl-clan', 'bl4']);
  assert(/GENX/.test(e.why) && /GENX/.test(e.fix), 'reason and fix name the clan');
  assert.strictEqual(alerts(g).length, 1, 'the host is pushed');
  assert(/Four/.test(alerts(g)[0].title) && /GENX/.test(alerts(g)[0].body), 'the push names the player and the reason');
  assert.strictEqual(alerts(g)[0].tag, 'signin-4-bl-clan');
  const code = async (user, act, args) => { await g.act(user, act, args); return g.meta.signinLog[0].code; };
  assert.strictEqual(await code({ id: '7', name: 'Seven' }, 'join', { blId: 'bl6' }), 'other-discord');
  assert.strictEqual(await code({ id: '8', name: 'Eight' }, 'join', { blId: 'bl8' }), 'no-link');
  assert(/Settings, Socials/.test(g.meta.signinLog[0].fix) && /Ask the host/.test(g.meta.signinLog[0].fix), 'no-link says how to fix it');
  assert.strictEqual(await code({ id: '8', name: 'Eight' }, 'askJoin', { blId: 'bl6' }), 'other-discord', 'asking with a profile linked to someone else is logged too');
  assert.strictEqual(await code({ id: '9', name: 'Nine' }, 'join', { blId: 'ghost' }), 'bl-notfound');
  assert.strictEqual(await code({ id: '9', name: 'Nine' }, 'join', { blId: '' }), 'bl-input');
  assert(!('bl' in g.meta.signinLog[0]), 'nothing typed, nothing recorded');
  const view = await g.signinLog(HOST);
  assert.strictEqual(view.log.length, g.meta.signinLog.length); assert.strictEqual(view.max, 100);
  assert((await g.signinLog({ id: '4', isHost: false })).error, 'only the host can read it');
  ok('a failed join is logged with the reason and the fix, and the host is pushed');
}
{
  // the AccSaber checks, the closed doors, and what is not a failure
  clock = Date.UTC(2026, 11, 21, 20);
  const g = await setup({});
  g.state.order.slice().forEach((pid) => E.removePlayer(g.state, pid));
  BLDISC = { bl5: '5' }; BLCLAN = {}; BLMISSING = new Set();
  const realFetch = globalThis.fetch;
  const accAnswer = (res) => { globalThis.fetch = async (url, init) => String(url).includes('/v1/users/') ? res : realFetch(url, init); };
  const last = async () => { await g.act({ id: '5', name: 'Five' }, 'join', { blId: 'bl5' }); return g.meta.signinLog[0].code; };
  accAnswer({ ok: false, status: 404, json: async () => ({}) }); assert.strictEqual(await last(), 'acc-no-profile');
  accAnswer({ ok: true, status: 200, json: async () => ({ clan: { slug: 'other' } }) }); assert.strictEqual(await last(), 'acc-clan');
  accAnswer({ ok: false, status: 503, json: async () => ({}) }); assert.strictEqual(await last(), 'acc-down');
  globalThis.fetch = realFetch;
  blUp = false; assert.strictEqual(await last(), 'bl-down'); blUp = true;
  g.state.signupsClosed = true; assert.strictEqual(await last(), 'signups-closed'); delete g.state.signupsClosed;
  E.addPlayer(g.state, { id: 'd6', discordId: '6', name: 'Six', blId: 'bl5' });
  assert.strictEqual(await last(), 'profile-taken'); E.removePlayer(g.state, 'd6');
  const sent = alerts(g).length;
  g.meta.access = { mode: 'testers', allowed: [], pending: [] };
  assert.strictEqual(await last(), 'no-access');
  assert.strictEqual(alerts(g).length, sent, 'invite-only is logged without a second push (the waiting-list push covers it)');
  g.meta.access = { mode: 'open', allowed: [], pending: [] };
  g.state.status = 'finished'; assert.strictEqual(await last(), 'game-over');
  // a join that works, and refusals that are not failures, log nothing
  const g2 = await setup({}); g2.state.order.slice().forEach((pid) => E.removePlayer(g2.state, pid));
  const r = await g2.act({ id: '5', name: 'Five' }, 'join', { blId: 'bl5' });
  assert(!r.error, r.error);
  const again = await g2.act({ id: '5', name: 'Five' }, 'askJoin', { blId: 'bl5' });
  assert(again.error && !(g2.meta.signinLog || []).length, 'a good join and a harmless refusal are not logged');
  ok('every join check has its own logged code, and good joins are not logged');
}
{
  // a retrying player is pushed once per window; a new reason, a new player or a later try are pushed again
  clock = Date.UTC(2026, 11, 22, 20);
  const g = await fresh();
  BLDISC = { bl4: '4', bl5: '5' }; BLCLAN = { bl4: [12], bl5: [12] }; BLMISSING = new Set();
  const A = { id: '4', name: 'Four' };
  for (let i = 0; i < 4; i++) { await g.act(A, 'join', { blId: 'bl4' }); clock += 30000; }
  assert.strictEqual(g.meta.signinLog.length, 4, 'each failure still gets its own log entry');
  assert.strictEqual(alerts(g).length, 1, 'four retries, one push');
  await g.act(A, 'join', { blId: 'bl9' });
  assert.strictEqual(alerts(g).length, 2, 'a different reason for the same player is pushed');
  await g.act({ id: '5', name: 'Five' }, 'join', { blId: 'bl5' });
  assert.strictEqual(alerts(g).length, 3, 'the same reason for another player is pushed');
  clock += 11 * 60000;
  await g.act(A, 'join', { blId: 'bl4' });
  assert.strictEqual(alerts(g).length, 4, 'the same thing again after the window is pushed again');
  assert.strictEqual(g.meta.signinLog.length, 7);
  assert(Object.keys(g.meta.signinSeen).length <= 4, 'old repeat markers are dropped');
  // a failure with nobody attached (Discord never said who) is counted on one entry instead
  const h = await fresh();
  for (let i = 0; i < 3; i++) { await h.signinFail({ code: 'discord-token', clan: 'genx', anyGame: true, err: 'invalid_grant' }); clock += 1000; }
  assert.strictEqual(h.meta.signinLog.length, 1); assert.strictEqual(h.meta.signinLog[0].n, 3); assert.strictEqual(alerts(h).length, 1);
  assert(/invalid_grant/.test(h.meta.signinLog[0].why));
  ok('repeats from the same player and reason are pushed once per window');
}
{
  // the log is capped, newest first, and the host can clear it
  clock = Date.UTC(2026, 11, 23, 20);
  const g = await fresh();
  BLDISC = { bl4: '4' }; BLCLAN = { bl4: [12] };
  for (let i = 0; i < 105; i++) await g.act({ id: String(1000 + i), name: 'P' + i }, 'join', { blId: 'bl4' });
  assert.strictEqual(g.meta.signinLog.length, 100, 'capped at 100');
  assert.strictEqual(g.meta.signinLog[0].id, '1104', 'newest first');
  assert.strictEqual(g.meta.signinLog[99].id, '1005', 'the oldest five are gone');
  let r = await g.act({ id: '4', name: 'Four' }, 'clearSignins', {});
  assert(r && r.error, 'players cannot clear it'); assert.strictEqual(g.meta.signinLog.length, 100);
  r = await g.act(HOST, 'clearSignins', {});
  assert(!r.error, r.error); assert.strictEqual((await g.signinLog(HOST)).log.length, 0, 'cleared');
  ok('the sign-in log is capped at 100, newest first, and the host can clear it');
}
{
  // a sign-up taken off at the check before the start is in the log too, without a second push
  clock = Date.UTC(2026, 11, 24, 20); accUp = true;
  const g = await setup({});
  g.state.status = 'finished'; BLDISC = { bl1: '1' }; BLMISSING = new Set();
  const r = await g.act(HOST, 'newGame', { signup: true });
  assert(!r || !r.error, r && r.error);
  const e = g.meta.signinLog.find((x) => x.id === '2');
  assert(e && e.code === 'no-link' && /^Taken off the sign-up list/.test(e.why) && /Ask the host/.test(e.fix), 'logged with the fix');
  assert.strictEqual(alerts(g).length, 0, 'the "taken off" push already covers it');
  assert((g.hostMsgs || []).some((m) => /taken off/.test(m.title)));
  ok('players taken off at the pre-start check are in the log');
}
// ---- the Discord step, through the Worker itself ----
const W = (await import(R + '/worker/src/index.js')).default;
async function world(extra = {}) {
  const games = {};
  const env = { DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'sec-xyz-123', SESSION_SECRET: 'sess-secret', ALLOWED_ORIGINS: 'https://beatsabergames.com', GAME_PAGE: 'https://beatsabergames.com/', HOSTS: 'h1',
    CLANS: { genx: { name: 'GenX', order: 1, guild: 'g-genx', game: 'main', blClan: '85', blClanName: 'GENX' }, beaters: { name: 'Beaters', order: 2, guild: 'g-beat', game: 'beaters' } },
    GAME: { idFromName: (n) => n, get: (n) => games[n] }, DEV_LOGIN: '1', ...extra };
  for (const name of ['main', 'beaters']) {
    const store = new Map(); let alarm = null;
    const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, delete: async (k) => store.delete(k) }, blockConcurrencyWhile: (f) => f() };
    const g = new Game(ctx, env);
    await new Promise((r) => setTimeout(r, 20));
    g.meta = { access: { mode: 'open', allowed: [], pending: [] }, push: [{ uid: 'h1', endpoint: 'https://push.example/1' }] };
    g.notifyHosts = async (m, only) => { (g.notified = g.notified || []).push({ m, uids: g.meta.push.filter(only || (() => true)).map((x) => x.uid) }); };
    games[name] = g;
  }
  return { env, games };
}
const state = async (w, clan) => new URL((await W.fetch(new Request('https://api.test/auth/login?return=' + encodeURIComponent('https://beatsabergames.com/') + (clan ? '&clan=' + clan : '')), w.env)).headers.get('location')).searchParams.get('state');
const callback = (w, st, qs) => W.fetch(new Request('https://api.test/auth/callback?state=' + encodeURIComponent(st) + qs), w.env);
const CODE = 'THE-OAUTH-CODE', pushes = (w) => Object.values(w.games).reduce((n, g) => n + (g.notified || []).filter((x) => x.uids.length).length, 0);
const logs = (w) => JSON.stringify(Object.values(w.games).map((g) => [g.meta.signinLog, g.notified]));
{
  // Discord refuses the code: logged in every game (no game picked), the host pushed once, no code or secret in the log
  let w = await world();
  DISC = { token: { error: 'invalid_grant' } };
  let res = await callback(w, await state(w), '&code=' + CODE);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(w.games.main.meta.signinLog[0].code, 'discord-token'); assert.strictEqual(w.games.beaters.meta.signinLog[0].code, 'discord-token');
  assert.strictEqual(w.games.main.meta.signinLog[0].game, '', 'not tied to a game');
  assert(/invalid_grant/.test(w.games.main.meta.signinLog[0].why));
  assert.strictEqual(pushes(w), 1, 'a host on both games hears once');
  for (const bad of [CODE, 'sec-xyz-123', 'tok-abc']) assert(!logs(w).includes(bad), 'no ' + bad + ' anywhere');
  // the same game picked on the page: only that game's log
  w = await world(); DISC = { token: { error: 'invalid_grant' } };
  await callback(w, await state(w, 'beaters'), '&code=' + CODE);
  assert(!w.games.main.meta.signinLog, 'the other game is left alone'); assert.strictEqual(w.games.beaters.meta.signinLog[0].game, 'Beaters');
  w = await world(); await callback(w, await state(w, 'nonsense'), '&code=' + CODE);
  assert.strictEqual(w.games.main.meta.signinLog.length, 1, 'an unknown game name falls back to every game');
  // two refusals in a row are one counted entry and one push
  w = await world(); DISC = { token: { error: 'invalid_grant' } };
  for (let i = 0; i < 2; i++) await callback(w, await state(w, 'genx'), '&code=' + CODE);
  assert.strictEqual(w.games.main.meta.signinLog.length, 1); assert.strictEqual(w.games.main.meta.signinLog[0].n, 2); assert.strictEqual(pushes(w), 1);
  ok('a refused Discord code is logged and pushed, never with the code in it');
}
{
  // not in a clan server, and a server list Discord would not give
  let w = await world();
  DISC = { token: { access_token: 'tok-abc' }, me: { id: '55', username: 'fifty', global_name: 'Fifty' }, guilds: [{ id: 'elsewhere' }] };
  let res = await callback(w, await state(w), '&code=' + CODE);
  assert.strictEqual(res.status, 302); assert(/#noclan$/.test(res.headers.get('location')), 'still sent to the no-game page');
  let e = w.games.main.meta.signinLog[0];
  assert.deepStrictEqual([e.code, e.id, e.name], ['no-clan-server', '55', 'Fifty']); assert(/Join the clan's Discord server/.test(e.fix));
  assert.strictEqual(pushes(w), 1); assert(/Fifty/.test(w.games.main.notified[0].m.title));
  assert(!logs(w).includes('tok-abc'));
  w = await world(); DISC.guilds = { message: 'You are being rate limited.' };
  res = await callback(w, await state(w, 'genx'), '&code=' + CODE);
  assert(/#noclan$/.test(res.headers.get('location'))); assert.strictEqual(w.games.main.meta.signinLog[0].code, 'discord-servers');
  // Discord gave no account details
  w = await world(); DISC = { token: { access_token: 'tok-abc' }, me: { message: '401: Unauthorized' } };
  res = await callback(w, await state(w, 'genx'), '&code=' + CODE);
  assert.strictEqual(res.status, 400); assert.strictEqual(w.games.main.meta.signinLog[0].code, 'discord-profile');
  ok('no clan server and Discord lookups that fail are logged');
}
{
  // a good sign-in and a cancel log nothing; a real Discord error and a crash do
  let w = await world();
  DISC = { token: { access_token: 'tok-abc' }, me: { id: '56', username: 'x' }, guilds: [{ id: 'g-genx', icon: null }] };
  let res = await callback(w, await state(w), '&code=' + CODE);
  assert(/#token=/.test(res.headers.get('location'))); assert(!w.games.main.meta.signinLog && !pushes(w), 'a good sign-in is not logged');
  res = await callback(w, await state(w), '&error=access_denied');
  assert.strictEqual(res.status, 302); assert(!w.games.main.meta.signinLog, 'cancelling is not a failure');
  res = await callback(w, await state(w, 'genx'), '&error=server_error&error_description=bad%20thing');
  assert(/server_error/.test(w.games.main.meta.signinLog[0].why) && w.games.main.meta.signinLog[0].code === 'discord-error');
  assert(!logs(w).includes('bad thing'), 'Discord\'s free text is not stored');
  res = await callback(w, 'not-a-real-state', '&code=' + CODE);
  assert.strictEqual(res.status, 400); assert.strictEqual(w.games.main.meta.signinLog.length, 1, 'a state we cannot verify is not logged');
  w = await world(); DISC = { token: { access_token: 'tok-abc' }, me: { id: '57', username: 'y' }, guilds: 'throw', leak: CODE + ' and sec-xyz-123' };
  res = await W.fetch(new Request('https://api.test/auth/callback?state=' + encodeURIComponent(await state(w, 'genx')) + '&code=' + CODE), w.env);
  assert.strictEqual(res.status, 500, 'the player still sees the error page');
  const e = w.games.main.meta.signinLog[0];
  assert(e.code === 'server-error' && e.id === '57' && /\(hidden\)/.test(e.why), 'logged with who it was, and the code scrubbed');
  for (const bad of [CODE, 'sec-xyz-123', 'tok-abc']) assert(!logs(w).includes(bad), 'no ' + bad + ' anywhere');
  ok('good sign-ins and cancels log nothing; Discord errors and crashes do');
}
{
  // the Host tools list: host only
  const w = await world();
  await w.games.main.logSignin({ id: '4', name: 'Four', code: 'no-link' });
  const tok = async (id) => (await (await W.fetch(new Request('https://api.test/dev/login?id=' + id + '&clans=genx'), w.env)).json()).token;
  const get = async (id) => W.fetch(new Request('https://api.test/api/host/signins?clan=genx', { headers: { authorization: 'Bearer ' + await tok(id) } }), w.env);
  let res = await get('h1'); assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).log[0].code, 'no-link');
  assert.strictEqual((await get('4')).status, 403);
  ok('only the host can read the sign-in log');
}
// ---------------------------------------------------------------------------
// Discord posts and roll reminders in every theme and mode (the playbook's wording checks): no other family's
// character, no maps in AccSaber games, the goal reads after "the", the theme's own picture, and reminders name the game.
{
  const DAY = 86400000;
  const GENX = { id: 'genx', name: 'GenX', accClan: 'genx-clan', accClanName: 'GenX Clan', blClan: '85', blClanName: 'GENX', webhook: 'W' };
  const BEATERS = { id: 'beaters', name: 'Beaters', webhook: 'W' };
  const runs = [];
  for (const [tid, t] of Object.entries(C.themes)) {
    if (t.family === 'taco') runs.push([tid, BEATERS, false]);   // Beaters games have no AccSaber mode
    else runs.push([tid, GENX, false], [tid, GENX, true]);
  }
  const problems = [];
  for (const [tid, clan, acc] of runs) {
    const t = C.themes[tid], where = tid + (acc ? ' (AccSaber)' : ' (maps)');
    const store = new Map();
    const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => store.set(k, v), getAlarm: async () => null, setAlarm: async () => {}, delete: async (k) => store.delete(k) }, blockConcurrencyWhile: (f) => f() };
    const g = new Game(ctx, { GAME_PAGE: 'https://beatsabergames.com/', ACC_API: 'https://api.accsaber.com' });
    await new Promise((r) => setTimeout(r, 5));
    const posts = [], pushes = [];
    g.clan = () => clan; g.useClan = () => {}; g.notifyHosts = async () => {};
    g.announcing = () => true;
    g.discordPost = async (content, link, card, kind) => { posts.push({ kind, content, card: card || null }); return { ok: true, status: 200 }; };
    g.pushTo = async (subs, msg) => { pushes.push(msg); return { sent: subs.length, failed: 0 }; };
    clock = Date.UTC(2026, 11, 7, 12);
    const board = C.boardFor(t.mapSet);
    g.state = E.createGame({ board, cards: C.cardsFor(tid), themeId: tid, title: C.gameTitle(tid, board), status: 'signup', startsAt: clock + 2 * DAY, endsAt: clock + 20 * DAY,
      settings: acc ? { accsaber: true, timeZone: 'UTC', cutoffHour: 4, cutoffMinute: 0, exactFinish: true } : { exactFinish: true } });
    g.meta = { access: { mode: 'open', allowed: [], pending: [] }, push: [{ uid: '2', endpoint: 'https://push.example/2', tz: 'UTC' }] };
    const s = g.state, daily = (pid) => { if (acc) s.players[pid].acc = { d: s.day, base: 0, cur: 1 }; };
    ['1', '2', '3'].forEach((id) => { E.addPlayer(s, { id: 'd' + id, discordId: id, name: 'P' + id, blId: 'bl' + id }); E.chooseRoute(s, 'd' + id, id === '2' ? 'riskier' : 'longer'); });
    await g.discordFeed();   // the first run only notes where the log is
    for (const p of [g.signupsPost(), g.dayPost(), g.hourPost()]) posts.push({ kind: 'countdown', content: p.text, card: p.card });
    clock = s.startsAt; E.startGame(s, clock); g.meta.nextCutoff = E.nextCutoff(s.settings, clock);
    await g.announceStart();
    // Two players one step from the goal (the race post), one gets out (escape), the other waits at the gate.
    const last = E.exitIndex(s, s.players.d1);
    E.setPosition(s, 'd1', last - 1); E.setPosition(s, 'd3', last - 1);
    await g.discordFeed();
    daily('d1'); daily('d3');
    E.roll(s, 'd1', { forced: 1 }); E.roll(s, 'd3', { forced: 1 });
    // A setback: back to the start from the riskier route.
    const r2 = s.board.routes.riskier, back = r2.findIndex((id) => s.board.spaces[id].type === 'start');
    if (back >= 0) E.setPosition(s, 'd2', back, { apply: true });
    await g.discordFeed();
    // The roll reminder for the player still to roll.
    clock = E.reminderTime(g.meta.nextCutoff, E.remindHour(s), 'UTC') + 1000;
    await g.remind(clock);
    E.advanceDay(s); await g.discordFeed();   // the day's recap
    const lc = g.lastCallPost(); posts.push({ kind: 'lastcall', content: lc.text, card: lc.card });
    E.endGame(s, clock); await g.announceEnd();
    const kinds = new Set(posts.map((p) => p.kind));
    for (const k of ['countdown', 'start', 'race', 'escape', 'moments', 'recap', 'lastcall', 'end']) if (!kinds.has(k)) problems.push(where + ': no ' + k + ' post was made, so its wording went unchecked');
    const text = JSON.stringify(posts);
    if (t.family === 'taco' && /\b(Chester|Hazel)\b|💀/.test(text)) problems.push(where + ': a post shows Chester wording or the cemetery skull: ' + text.match(/.{0,60}(\b(Chester|Hazel)\b|💀).{0,40}/)[0]);
    if (t.family !== 'taco' && /\bTaco\b|🌮/.test(text)) problems.push(where + ': a post shows Taco wording: ' + text.match(/.{0,60}(\bTaco\b|🌮).{0,40}/)[0]);
    if (acc && /\bmaps?\b|!bsr|BeatSaver/i.test(text)) problems.push(where + ': an AccSaber post mentions maps: ' + text.match(/.{0,60}(\bmaps?\b|!bsr|BeatSaver).{0,40}/i)[0]);
    if (!acc && !/\bmaps?\b/i.test(text)) problems.push(where + ': a map game\'s posts never mention maps (the AccSaber check proves nothing)');
    if (!text.includes('made it to the ' + t.goal + '!')) problems.push(where + ': the escape post does not say "made it to the ' + t.goal + '!"');
    const odd = text.match(/\bthe (the|a|an) \w+|\bthe [A-Z]\w*'s \w+/);
    if (odd) problems.push(where + ': a post reads "' + odd[0] + '" (goal always follows "the")');
    const pic = t.thumb || (t.artHero && t.artHero.src) || 'img/icon.png';
    for (const p of posts) for (const c of [].concat(p.card || [])) if (c.thumbnail && !c.thumbnail.url.endsWith(pic)) problems.push(where + ': a ' + p.kind + ' card shows ' + c.thumbnail.url + ' instead of the theme picture ' + pic);
    if (!pushes.length) problems.push(where + ': no roll reminder went out');
    for (const m of pushes) if (!m.title.includes(s.title)) problems.push(where + ': reminder "' + m.title + '" does not name the game');
    if (acc) for (const m of pushes) if (/\bmaps?\b|!bsr/i.test(m.title + ' ' + m.body)) problems.push(where + ': an AccSaber reminder mentions maps');
  }
  assert.deepStrictEqual(problems, [], 'Post wording (see the playbook):\n  ' + problems.join('\n  '));
  ok('Discord posts and reminders in every theme and mode use their own words and pictures');
}
console.log('worker timing tests passed');
