/*
 * Chester's Escape - game server (Cloudflare Worker + one Durable Object per game).
 *
 * The page lives on GitHub Pages; this Worker holds the shared game state.
 * Each clan (a Discord server) has its own game. Sign-in records which clan servers a
 * player is in; people in more than one pick which game to open.
 *   - Discord sign-in (so a roll can only be made by its own player)
 *   - rolls on the server with crypto randomness
 *   - BeatLeader checks on the server (no relay needed here)
 *   - the day turns over by itself at the cutoff, and open maps get re-checked every 15 minutes
 *   - the host can post the results image to the game channel through a Discord webhook
 *   - hosts can get push notifications when someone is waiting to get in or asks for a run approval
 *
 * The rules are the exact same engine the page uses (docs/js/engine.js).
 */
import { DurableObject } from 'cloudflare:workers';
import '../../docs/js/content.js';
import '../../docs/js/engine.js';
import { sendPush } from './push.js';

const E = globalThis.CGEngine;
const C = globalThis.CGContent;
const CHECK_EVERY = 15 * 60 * 1000;
const HOUR = 3600000, DAY = 86400000;
// Discord posts the host can switch on: countdowns and the start/end, then game moments.
const POST_KINDS = ['signups', 'day', 'hour', 'start', 'lastcall', 'end', 'escape', 'leader', 'setback', 'big', 'gate'];
const MOMENT_CAP = 5, SETBACK = 5, BIG_ACC = 0.95, UNDO_KEEP = 5;
function md(t) { return String(t || '').replace(/([*_~`|>\\])/g, '\\$1'); }
function sec(ms) { return Math.round(ms / 1000); }
function plural(k, w) { return k + ' ' + w + (k === 1 ? '' : 's'); }
function ordinal(n) { const v = n % 100; return n + (v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
const VISIT_GAP = 10 * 60 * 1000;   // a return within this long continues the same visit

// ---------------------------------------------------------------------------
// helpers
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = (s) => b64u(enc.encode(s));
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); };

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function sign(env, payload) { const body = b64uText(JSON.stringify(payload)); return body + '.' + (await hmac(env.SESSION_SECRET, body)); }
async function verify(env, token) {
  if (!token || token.indexOf('.') < 0 || !env.SESSION_SECRET) return null;
  const [body, sig] = token.split('.');
  if ((await hmac(env.SESSION_SECRET, body)) !== sig) return null;
  try { const p = JSON.parse(unb64u(body)); if (p.exp && p.exp < Date.now()) return null; return p; } catch { return null; }
}

function origins(env) { return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean); }
function cors(env, req) {
  const o = req.headers.get('origin');
  const ok = o && origins(env).includes(o);
  return {
    'access-control-allow-origin': ok ? o : origins(env)[0] || '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin'
  };
}
function json(env, req, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(env, req) } });
}
// A time zone name the runtime knows (e.g. America/Los_Angeles), or null.
function validZone(tz) { try { if (!tz) return null; new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return String(tz).slice(0, 64); } catch { return null; } }
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
function hosts(env, clan) { return [...list(env.HOSTS), ...((clan && clan.hosts) || [])]; }

// The clans, from the CLANS setting in wrangler.toml. Each one:
//   name, guild (Discord server ID, empty = anyone), game (stored game name, defaults to the id),
//   order (position on the switcher), theme (for a brand-new game), hosts (extra host IDs), webhook (name of the secret holding the
//   channel webhook), announce ("1" posts the start and end messages, or just "start" or "end"). The host can switch them in Host tools.
// Without CLANS it falls back to one clan built from GUILD_ID, stored as the "main" game.
function clans(env) {
  let c = env.CLANS;
  if (typeof c === 'string') { try { c = JSON.parse(c); } catch { c = null; } }
  if (c && typeof c === 'object' && !Array.isArray(c)) c = Object.entries(c).map(([id, v]) => ({ id, ...v }));
  // Cloudflare may hand the table back in any key order, so "order" sets the switcher order.
  if (Array.isArray(c)) c = c.slice().sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
  if (!Array.isArray(c) || !c.length) c = [{ id: 'main', name: 'Clan', guild: env.GUILD_ID || '', game: 'main' }];
  return c.map((x) => ({
    id: String(x.id), name: String(x.name || x.id), guild: String(x.guild || ''), game: String(x.game || x.id),
    theme: C.themes[x.theme] ? x.theme : (C.themes[env.THEME] ? env.THEME : 'cemetery'),
    hosts: list(x.hosts), webhook: String(x.webhook || 'DISCORD_WEBHOOK_URL'),
    announce: String(x.announce != null ? x.announce : env.ANNOUNCE_DAYS || '0'), icon: String(x.icon || ''),
    maps: C.mapSets[x.maps] ? String(x.maps) : ''
  }));
}
// The game page link for a clan, so notifications and Discord posts open the right game.
// Which songs a clan's board uses: the theme's own map set, else the clan's, else the original.
function mapSetFor(clan, themeId) { const t = C.themes[themeId] || {}; return (C.mapSets[t.mapSet] && t.mapSet) || (clan && clan.maps) || ''; }
function pageFor(env, clan, hash) {
  const base = env.GAME_PAGE || '';
  if (!base) return '';
  return base + (clans(env).length > 1 && clan ? (base.includes('?') ? '&' : '?') + 'clan=' + encodeURIComponent(clan.id) : '') + (hash || '');
}
function rng() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }

// The signed-in player and the clan game this request is for (?clan=, else their first clan).
// Sessions from before clans existed carry no clan list, so those players sign in once more.
async function userFrom(env, req, url) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const u = await verify(env, tok);
  if (!u || !Array.isArray(u.clans)) return null;
  const mine = clans(env).filter((c) => !c.guild || u.clans.includes(c.id));
  if (!mine.length) return null;
  const want = url.searchParams.get('clan');
  const clan = mine.find((c) => c.id === want) || mine[0];
  return { id: u.id, name: u.name, avatar: u.avatar, clan, clans: mine.map((c) => ({ id: c.id, name: c.name, icon: (u.icons && u.icons[c.id]) || c.icon })), isHost: hosts(env, clan).includes(u.id) };
}

function gameStub(env, clan) { return env.GAME.get(env.GAME.idFromName(clan.game)); }

// ---------------------------------------------------------------------------
// Discord sign-in
async function authLogin(env, req, url) {
  const ret = url.searchParams.get('return') || env.GAME_PAGE || '';
  let retOrigin = '';
  try { retOrigin = new URL(ret).origin; } catch { /* bad url */ }
  if (!origins(env).includes(retOrigin)) return new Response('That return address is not allowed.', { status: 400 });
  const state = await sign(env, { r: ret, n: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 });
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: url.origin + '/auth/callback',
    scope: clans(env).some((c) => c.guild) ? 'identify guilds' : 'identify', state, prompt: 'none'
  });
  return Response.redirect('https://discord.com/oauth2/authorize?' + q, 302);
}

async function authCallback(env, req, url) {
  const st = await verify(env, url.searchParams.get('state') || '');
  if (!st) return new Response('Sign-in expired. Go back to the game and try again.', { status: 400 });
  const code = url.searchParams.get('code');
  if (!code) return Response.redirect(st.r, 302);
  const tok = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: url.origin + '/auth/callback' })
  }).then((r) => r.json());
  if (!tok.access_token) return new Response('Discord sign-in failed. Go back to the game and try again.', { status: 400 });
  const auth = { authorization: 'Bearer ' + tok.access_token };
  const me = await fetch('https://discord.com/api/users/@me', { headers: auth }).then((r) => r.json());
  // Which clan servers they are in, plus each server's icon for the game switcher.
  const all = clans(env), member = [], icons = {};
  let guilds = [];
  if (all.some((c) => c.guild)) {
    guilds = await fetch('https://discord.com/api/users/@me/guilds', { headers: auth }).then((r) => r.json());
    if (!Array.isArray(guilds)) guilds = [];
  }
  for (const c of all) {
    const g = c.guild && guilds.find((x) => x.id === c.guild);
    if (!c.guild || g) member.push(c.id);
    if (g && g.icon) icons[c.id] = `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96`;
  }
  if (!member.length) return new Response('This game is for members of the clan Discord servers.', { status: 403 });
  // No picture of their own: Discord's default one for that account, so nobody shows as bare initials.
  let dflt = ''; try { dflt = `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(me.id) >> 22n) % 6n)}.png`; } catch (e) {}
  const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : dflt;
  const session = await sign(env, { id: me.id, name: me.global_name || me.username, avatar, clans: member, icons, exp: Date.now() + 60 * 24 * 3600 * 1000 });
  return Response.redirect(st.r + '#token=' + encodeURIComponent(session), 302);
}

// ---------------------------------------------------------------------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env, req) });
    try {
      if (url.pathname.startsWith('/auth/')) {
        // Say plainly which setting is missing instead of crashing.
        const missing = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET'].filter((k) => !env[k]);
        if (missing.length) return new Response('Sign-in is not set up yet. Missing secret: ' + missing.join(', ') + '\nSet it with: npx wrangler secret put ' + missing[0], { status: 500 });
      }
      if (url.pathname === '/auth/login') return await authLogin(env, req, url);
      if (url.pathname === '/auth/callback') return await authCallback(env, req, url);
      if (url.pathname === '/dev/login' && env.DEV_LOGIN === '1') {
        // Local testing only: wrangler dev --var DEV_LOGIN:1
        const id = url.searchParams.get('id') || 'dev'; const name = url.searchParams.get('name') || 'Dev player';
        const member = url.searchParams.has('clans') ? list(url.searchParams.get('clans')) : clans(env).map((c) => c.id);
        return json(env, req, { token: await sign(env, { id, name, avatar: '', clans: member, icons: {}, exp: Date.now() + 86400000 }) });
      }
      if (!url.pathname.startsWith('/api/')) return new Response("Chester's Escape game server. The game itself is on the game page.", { status: 200 });

      const user = await userFrom(env, req, url);
      if (url.pathname === '/api/icon' && req.method === 'GET') return await siteIcon(url);
      if (url.pathname === '/api/config') {
        if (!user) return json(env, req, { live: true, access: 'signin', clans: [] });
        const r = await gameStub(env, user.clan).whoAmI(user);
        const vapidKey = env.VAPID_PUBLIC_KEY ? String(env.VAPID_PUBLIC_KEY).trim() : undefined;
        return json(env, req, { live: true, access: r.access, startsAt: r.startsAt, vapidKey, user: { id: user.id, name: user.name, avatar: user.avatar }, isHost: user.isHost, pid: r.pid, clan: user.clan.id, clans: user.clans, theme: r.theme });
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        if (!user) return json(env, req, { error: 'Sign in with Discord to see the game.', code: 'no-access', access: 'signin' }, 403);
        const r = await gameStub(env, user.clan).getState(user, Number(url.searchParams.get('since') ?? -1));
        return json(env, req, r, r.error ? 403 : 200);
      }
      if (url.pathname === '/api/act' && req.method === 'POST') {
        if (!user) return json(env, req, { error: 'Sign in with Discord first.', code: 'auth' }, 401);
        const body = await req.json().catch(() => ({}));
        const r = await gameStub(env, user.clan).act(user, String(body.action || ''), body.args || {});
        if (r.error && r.code === 'no-access') r.status = 403;
        return json(env, req, r, r.error ? (r.status || 400) : 200);
      }
      if (url.pathname === '/api/host/stats' && req.method === 'GET') {
        if (!user || !user.isHost) return json(env, req, { error: 'Only the host can see this.' }, 403);
        return json(env, req, await gameStub(env, user.clan).hostStats(user, url.searchParams.get('fresh') === '1'));
      }
      if (url.pathname === '/api/host/visits' && req.method === 'GET') {
        if (!user || !user.isHost) return json(env, req, { error: 'Only the host can see this.' }, 403);
        return json(env, req, await gameStub(env, user.clan).visitLog(user));
      }
      if (url.pathname.startsWith('/api/push/') && req.method === 'POST') {
        if (!user) return json(env, req, { error: 'Sign in with Discord first.' }, 401);
        const body = await req.json().catch(() => ({}));
        const op = url.pathname.slice('/api/push/'.length);
        const r = await gameStub(env, user.clan).pushOp(user, op, body);
        // A browser has one subscription for the whole site, so it goes to every clan this person is in.
        // Otherwise turning it on in one clan leaves a dead copy in the other.
        if (op === 'subscribe' || op === 'unsubscribe') {
          const others = clans(env).filter((c) => c.id !== user.clan.id && user.clans.some((x) => x.id === c.id));
          await Promise.all(others.map((c) => gameStub(env, c).pushOp({ ...user, clan: c, isHost: hosts(env, c).includes(user.id) }, op, body).catch(() => null)));
        }
        return json(env, req, r, r.error ? 400 : 200);
      }
      if (url.pathname === '/api/host/results' && req.method === 'POST') {
        if (!user || !user.isHost) return json(env, req, { error: 'Only the host can post results.' }, 403);
        const hook = env[user.clan.webhook];
        if (!hook) return json(env, req, { error: 'No Discord webhook is set up for ' + user.clan.name + ' yet.' }, 400);
        const form = await req.formData();
        const out = new FormData();
        out.append('payload_json', JSON.stringify({ content: String(form.get('text') || ''), allowed_mentions: { parse: [] } }));
        out.append('files[0]', form.get('file'), 'results.png');
        const r = await fetch(hook, { method: 'POST', body: out });
        if (!r.ok) return json(env, req, { error: 'Discord did not accept the post (' + r.status + ').' }, 502);
        return json(env, req, { ok: true });
      }
      return json(env, req, { error: 'Not found' }, 404);
    } catch (e) {
      if (url.pathname.startsWith('/auth/')) return new Response('Sign-in failed: ' + (e.message || 'server error') + '\nGo back to the game and try again.', { status: 500 });
      return json(env, req, { error: e.message || 'Server error' }, 500);
    }
  }
};

// ---------------------------------------------------------------------------
// One Durable Object holds the whole game, so every action is applied in order.
// ---- GoatCounter for the host's Stats tab ----
// Read with the same GoatCounter API key as Playlist Studio's stats page, kept as a Worker secret:
// npx wrangler secret put GC_TOKEN. GC_SITE (optional) is the site code, chesters-escape by default.
// GoatCounter allows 4 API calls a second, so calls are spaced out; the results are cached for 10 minutes.
let gcLast = 0;
async function gcGet(env, path, params) {
  const site = String(env.GC_SITE || 'chesters-escape').replace(/[^a-z0-9-]/gi, '');
  const qs = new URLSearchParams();
  for (const k of Object.keys(params || {})) if (params[k] != null && params[k] !== '') qs.set(k, String(params[k]));
  for (let tries = 0; tries < 3; tries++) {
    const wait = 270 - (Date.now() - gcLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    gcLast = Date.now();
    const r = await fetch('https://' + site + '.goatcounter.com/api/v0' + path + (qs.toString() ? '?' + qs : ''), {
      headers: { Authorization: 'Bearer ' + String(env.GC_TOKEN).trim(), 'Content-Type': 'application/json', 'User-Agent': 'ChestersEscapeStats' } });
    if (r.status === 429) { await new Promise((x) => setTimeout(x, 1000 * Math.min(5, Number(r.headers.get('X-Rate-Limit-Reset')) || 1))); continue; }
    if (r.status === 401 || r.status === 403) throw new Error('auth');
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }
  throw new Error('busy');
}
const gcIso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const gcList = async (env, page, start, end, limit) => {
  const j = await gcGet(env, '/stats/' + page, { start: gcIso(start), end: gcIso(end), limit });
  return ((j && j.stats) || []).map((x) => ({ id: x.id || '', name: x.name || '', count: x.count || 0, scheme: x.ref_scheme || '' })).filter((x) => x.count > 0);
};
// Visitors to the game page over the last two weeks: the total (events left out, like the GoatCounter
// dashboard), visitors per day from the page paths, where they came from and what they used.
async function gcStats(env) {
  const end = Date.now(), start = end - 14 * DAY;
  const total = await gcGet(env, '/stats/total', { start: gcIso(start), end: gcIso(end) });
  const hits = await gcGet(env, '/stats/hits', { start: gcIso(start), end: gcIso(end), limit: 100, group: 'day' });
  const days = {};
  for (const h of (hits && hits.hits) || []) if (!h.event) for (const x of h.stats || []) days[x.day] = (days[x.day] || 0) + (x.daily || 0);
  const refs = await gcList(env, 'toprefs', start, end, 20);
  const campaigns = await gcList(env, 'campaigns', start, end, 10);
  const sizes = await gcList(env, 'sizes', start, end, 6);
  const browsers = await gcList(env, 'browsers', start, end, 8);
  const systems = await gcList(env, 'systems', start, end, 8);
  const countries = await gcList(env, 'locations', start, end, 12);
  return { visitors: Math.max(0, ((total && total.total) || 0) - ((total && total.total_events) || 0)), days: Object.keys(days).sort().map((d) => [d, days[d]]), refs, campaigns, sizes, browsers, systems, countries };
}
// Small site icons and country flags for the Stats tab lists (Discord, Google, Chrome, flags...). They're public, so
// this needs no sign-in. Each one is fetched once (site icons from Google's icon service, flags from the flag-icons
// package) and kept in the Cloudflare cache for a week. Only plain host names, short https page addresses or two-letter
// country codes are accepted, and only images are passed on.
const ICON_FLAGS = 'https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3/';
async function siteIcon(url) {
  const d = String(url.searchParams.get('d') || '').toLowerCase(), u = String(url.searchParams.get('u') || ''), f = String(url.searchParams.get('f') || '').toLowerCase();
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const none = (age) => new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=' + age } });
  if (/^[a-z]{2}$/.test(f)) {
    const key = new Request('https://chester-icons.invalid/flag/' + f);
    let r = cache ? await cache.match(key) : null;
    if (r) return r;
    let g = null; try { g = await fetch(ICON_FLAGS + f + '.svg'); } catch (e) {}
    const body = g && g.ok ? await g.text() : '';
    if (!/^\s*<svg[\s>]/.test(body) || /<script|on[a-z]+\s*=|javascript:|<foreignObject/i.test(body) || body.length > 200000) return none(86400);
    // An SVG opened on its own could run script on this origin, so it's served locked down.
    r = new Response(body, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
    if (cache) await cache.put(key, r.clone());
    return r;
  }
  let q = '';
  if (d.length <= 100 && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) q = 'domain=' + encodeURIComponent(d);
  else if (u.length <= 200 && /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/[a-z0-9._~\/-]*)?$/i.test(u)) q = 'domain_url=' + encodeURIComponent(u);
  else return new Response('', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const key = new Request('https://chester-icons.invalid/' + q);
  let r = cache ? await cache.match(key) : null;
  if (r) return r;
  let g = null; try { g = await fetch('https://www.google.com/s2/favicons?sz=64&' + q); } catch (e) {}
  const type = (g && g.headers.get('Content-Type')) || '';
  if (!g || !g.ok || !/^image\/(png|x-icon|vnd\.microsoft\.icon|gif|webp|jpeg)$/.test(type)) return none(86400);
  r = new Response(await g.arrayBuffer(), { headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'X-Content-Type-Options': 'nosniff' } });
  if (cache) await cache.put(key, r.clone());
  return r;
}

export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.state = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
      // A game already running picks up new built-in bonus maps.
      if (this.state && !this.state.board.mapSet) E.upgradeBonus(this.state.board, C.boards['chester-escape']().bonusMaps);
      this.meta = (await ctx.storage.get('meta')) || {};
      this.visits = (await ctx.storage.get('visits')) || [];
      this.undoList = (await ctx.storage.get('undoList')) || [];
      // A game that ended before the hall of fame existed still gets its place in it.
      if (this.state && this.state.status === 'finished') this.recordHall();
    });
  }

  // Which clan this game belongs to. Each call from the front door says so; the alarm uses
  // the last one seen. A game from before clans existed is the "main" game.
  useClan(user) {
    if (user && user.clan && this.meta.clanId !== user.clan.id) this.meta.clanId = user.clan.id;
    this.syncMaps();
  }
  // Before the first roll, keep the board's songs in step with the theme and clan (a game made
  // before its map set existed, or before the set's songs changed, picks them up here). Once the
  // game runs, the songs stay put.
  syncMaps() {
    const s = this.state;
    if (!s || s.status !== 'signup' || s.board.custom || s.board.id !== 'chester-escape') return false;
    const want = mapSetFor(this.clan(), s.themeId);
    // Same set but its songs changed since this game was made: pick up the new songs too.
    const songs = (b) => JSON.stringify([Object.keys(b.spaces).sort().map((id) => b.spaces[id].bsr || null), b.bonusMaps || []]);
    if ((s.board.mapSet || '') === want && songs(s.board) === songs(C.boardFor(want))) return false;
    C.applyMapSet(s.board, want); s.seq++; this.dirty = true;
    return true;
  }
  clan() {
    const all = clans(this.env);
    return all.find((c) => c.id === this.meta.clanId) || all.find((c) => c.game === 'main') || all[0];
  }
  page(hash) { return pageFor(this.env, this.clan(), hash); }
  webhook() { return this.env[this.clan().webhook] || ''; }
  // Which automatic Discord posts this game makes. The host switches each one in Host tools; until
  // then the clan's announce setting decides ("1" turns everything on, or a list like "start,end").
  posts() {
    if (!this.meta.posts) {
      const a = String(this.clan().announce || '0'), all = a === '1', l = a.split(',').map((x) => x.trim());
      this.meta.posts = {};
      for (const k of POST_KINDS) this.meta.posts[k] = all || l.includes(k);
    }
    // The day-before post came later: games set up before it follow their one-hour post setting.
    if (this.meta.posts.day === undefined) this.meta.posts.day = !!this.meta.posts.hour;
    return this.meta.posts;
  }
  recordHall() { if ((this.meta.hallHidden || []).includes(this.state.id)) return; E.addToHall(this.meta.hall = this.meta.hall || [], this.state); }
  // The last few host changes, newest last. Each keeps the game as it was before the change.
  async pushUndo(snap, user) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await this.ctx.storage.put('undo:' + id, snap.state);
    this.undoList.push({ id, label: snap.label, at: Date.now(), by: user.name || '', pre: snap.pre, post: this.state.seq, cut: snap.cut });
    while (this.undoList.length > UNDO_KEEP) { const old = this.undoList.shift(); await this.ctx.storage.delete('undo:' + old.id); }
    await this.ctx.storage.put('undoList', this.undoList);
  }
  undoInfo() {
    const l = this.undoList, top = l[l.length - 1];
    return { ok: !!top && (top.post === (this.state && this.state.seq) || this.clearUndoable(top)), list: l.slice().reverse().map((x) => ({ label: x.label, at: x.at, by: x.by })) };
  }
  // A cleared game can always come back while the fresh one is still in sign-ups: nobody has
  // rolled there, so only sign-ups would be lost.
  clearUndoable(top) { return !!top && top.label === 'Cleared the old game' && !!this.state && this.state.status === 'signup' && !this.state.events.some((e) => e.t !== 'join' && e.t !== 'route'); }
  // Hosts who run this clan's game without playing in it. They get an Admin card instead of Join.
  // Player ids of hosts running this game without playing, so the page can mark their name "admin".
  admins() { return (this.meta.hostOut || []).map((id) => 'd' + id); }
  hostOut(user) { return !!user && (this.meta.hostOut || []).includes(String(user.id)); }
  discordInfo() { const p = this.posts(), out = { hooked: !!this.webhook() }; for (const k of POST_KINDS) out[k] = !!p[k]; return out; }
  announcing(kind) { return !!this.webhook() && !!this.posts()[kind]; }
  // A post, optionally with a card linking to the game. The card is built here (not left to
  // Discord's link preview) so each game shows its own art: the taco boards get the taco.
  // Outside requests per wake-up. Cloudflare caps how many one run can make (50 on the free
  // plan), so the 15-minute check keeps a budget: Discord posts and reminders first, BeatLeader
  // checks with what's left, and anything that didn't fit runs a minute later.
  take(n) { if (this.budget == null) return true; if (this.budget < n) { this.later = true; return false; } this.budget -= n; return true; }
  async discordPost(content, link, card) {
    if (!this.take(1)) return 'nobudget';
    const body = { content, allowed_mentions: { parse: [] } };
    if (card && this.page()) body.embeds = [card];
    else if (link && this.page()) body.embeds = [this.gameCard()];
    return fetch(this.webhook(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  }
  gameCard() {
    const s = this.state, t = C.themes[s.themeId] || {}, base = this.env.GAME_PAGE || '';
    const pic = (t.artHero && t.artHero.src) || 'img/icon.png', hex = String((t.palette || {}).accent || '#f2a33a').replace('#', '');
    return { title: s.title, url: this.page(), description: t.tagline || 'Roll the d4 once a day and play the map on the space you land on.', color: parseInt(hex, 16) || 0xf2a33a, thumbnail: { url: base.replace(/\/?$/, '/') + pic } };
  }
  // ---- Discord post pieces ----
  theme() { return C.themes[this.state.themeId] || {}; }
  card(title, extra) {
    const t = this.theme(), base = (this.env.GAME_PAGE || '').replace(/\/?$/, '/');
    const hex = String((t.palette || {}).accent || '#f2a33a').replace('#', '');
    return { title, url: this.page(), color: parseInt(hex, 16) || 0xf2a33a, thumbnail: { url: base + ((t.artHero && t.artHero.src) || 'img/icon.png') }, ...extra };
  }
  mapCount() {
    const s = this.state, maps = new Set();
    for (const sp of Object.values(s.board.spaces)) for (const k of sp.bsr || []) maps.add(k);
    for (const k of s.board.bonusMaps || []) maps.add(k);
    return maps.size;
  }
  span() {
    const s = this.state; if (!s.endsAt || !s.startsAt) return '';
    const d = Math.round((s.endsAt - s.startsAt) / DAY);
    return d % 7 === 0 ? plural(d / 7, 'week') : plural(d, 'day');
  }
  routeName(key) { const i = (this.state.board.routeInfo || {})[key]; return (i && i.name) || key; }
  // How many players are on each route, in board order, plus anyone who hasn't picked one.
  routeSplit() {
    const s = this.state, out = Object.keys(s.board.routes).map((k) => ({ key: k, name: this.routeName(k), n: 0 }));
    let none = 0;
    for (const pid of s.order) { const r = out.find((x) => x.key === s.players[pid].route); if (r) r.n++; else none++; }
    return { routes: out, none };
  }
  routeIcon(i) { return ['🛤️', '🌊', '🧭', '🗺️'][i] || '🧭'; }
  who(n) {
    const clan = String(this.clan().name || '');
    return n === 1 ? '1 player is' : n + ' ' + (/s$/i.test(clan) ? md(clan) : 'players') + ' are';
  }
  // The full pitch card: what the game is, when it runs, and either how to join or who's in.
  pitch(list) {
    const s = this.state, t = this.theme(), n = s.order.length, maps = this.mapCount(), span = this.span();
    const fields = [];
    if (s.startsAt) fields.push({ name: '🎲 Starts', value: `<t:${sec(s.startsAt)}:F>` + (list ? '' : ` (<t:${sec(s.startsAt)}:R>)`), inline: true });
    if (span) fields.push({ name: '⏳ Runs', value: span + `, ends <t:${sec(s.endsAt)}:D>`, inline: true });
    fields.push({ name: '🎵 Maps', value: (maps ? maps + ' maps, ' : '') + 'about one a day', inline: true });
    if (list) {
      // Everyone who's in, in sign-up order. Discord caps a field at 1024 characters.
      let names = '';
      const all = s.order.map((pid) => md(s.players[pid].name));
      for (let i = 0; i < all.length; i++) {
        const next = (names ? names + ', ' : '') + all[i];
        if (next.length > 980) { names += ' and ' + (all.length - i) + ' more'; break; }
        names = next;
      }
      fields.push({ name: (t.family === 'taco' ? '🌮' : '🎟️') + ` Signed up (${n})`, value: names || 'Nobody yet. Be the first!', inline: false });
    } else {
      const r = this.routeSplit().routes.map((x) => x.name.replace(/ route$/i, '')).join(' or ');
      fields.push({ name: '📝 How to join', value: `Open the game, sign in with Discord, paste your BeatLeader profile and pick the ${r} route.`, inline: false });
    }
    const card = this.card('Join ' + s.title, {
      description: (t.tagline ? t.tagline + ' ' : '') + 'Roll a d4 once a day and play the map you land on. Cards, shortcuts and setbacks along the way. First three to the ' + (t.goal || 'exit') + ' take the podium.',
      fields
    });
    if (t.shot) card.image = { url: (this.env.GAME_PAGE || '').replace(/\/?$/, '/') + t.shot };
    return card;
  }
  icon() { return { thanksgiving: '🦃', halloween: '🎃', christmas: '🎄', newyear: '🎉', valentine: '💘', spring: '🐣', summer: '☀️' }[this.theme().look] || '📅'; }
  // Sign-ups open.
  signupsPost() {
    const s = this.state, maps = this.mapCount(), span = this.span();
    const what = maps ? maps + ' maps' + (span ? ' over ' + span : '') + '. ' : '';
    return { text: `📣 **Sign-ups are open for ${md(s.title)}!** ${what}Sign up any time before the first roll.`, card: this.pitch(false) };
  }
  // The post a day before the start: what the game is, when it runs and everyone who's in so far.
  dayPost() {
    const s = this.state, n = s.order.length;
    const call = this.theme().look === 'thanksgiving' ? 'Grab a seat at the table before the first roll.' : 'Join and pick your route before the first roll.';
    return { text: `${this.icon()} **${md(s.title)} starts <t:${sec(s.startsAt)}:R>!** ` + (n ? this.who(n) + ' already in. ' : '') + call, card: this.pitch(true) };
  }
  // An hour before: last call, and how the routes split.
  hourPost() {
    const s = this.state, n = s.order.length, sp = this.routeSplit();
    const fields = sp.routes.map((r, i) => ({ name: this.routeIcon(i) + ' ' + r.name, value: plural(r.n, 'player'), inline: true }));
    if (sp.none) fields.push({ name: '🤔 No route yet', value: plural(sp.none, 'player'), inline: true });
    return {
      text: `⏰ **${md(s.title)} starts <t:${sec(s.startsAt)}:R>!** ` + (n ? this.who(n) + ' in. Last call to sign up.' : 'Nobody has signed up yet. Be the first!'),
      card: this.card('Join ' + s.title, { description: `The first roll unlocks at <t:${sec(s.startsAt)}:t>.`, fields })
    };
  }
  // A day before the end: the podium so far and who can still reach it.
  lastCallPost() {
    const s = this.state, t = this.theme(), goal = t.goal || 'exit', r = E.ranking(s), medal = ['🥇', '🥈', '🥉'];
    const out = r.filter((x) => x.escaped && x.place <= 3), open = 3 - out.length, chasing = r.filter((x) => !x.escaped);
    const fields = out.map((x) => ({ name: medal[x.place - 1] + ' ' + md(s.players[x.pid].name), value: 'Made it, day ' + x.day, inline: true }));
    for (let i = out.length; i < 3 && chasing.length; i++) {
      const c = chasing[i - out.length];
      fields.push({ name: medal[i] + ' Open spot', value: c ? `${md(s.players[c.pid].name)} is ${plural(c.left, 'space')} away` : 'Anyone', inline: true });
    }
    const rest = chasing.slice(open > 0 ? open : 0, (open > 0 ? open : 0) + 5);
    if (rest.length) fields.push({ name: 'Chasing', value: rest.map((x) => `**${md(s.players[x.pid].name)}** ${x.left} to go`).join(' · '), inline: false });
    const head = open > 0 ? `${open === 1 ? 'One spot' : open + ' spots'} left on the podium. Every roll counts now.` : `The podium is set, but every place still counts. Get to the ${goal}!`;
    return { text: `⏳ **${md(s.title)} ends <t:${sec(s.endsAt)}:R>!** ` + head, card: this.card('Standings', { fields }) };
  }
  // The game's totals, counting moments that have aged out of the log.
  totals() {
    const s = this.state, T = (s.tally && s.tally.p) || {};
    let clears = 0, best = null;
    for (const pid of Object.keys(T)) { clears += T[pid].clears || 0; if (T[pid].best && (!best || T[pid].best.acc > best.acc)) best = { pid, ...T[pid].best }; }
    for (const e of s.events) {
      if (e.t !== 'cleared') continue;
      clears++;
      if (e.proof && e.proof.acc && (!best || e.proof.acc > best.acc)) best = { pid: e.pid, acc: e.proof.acc, key: (e.bsr || [])[0], diff: e.proof.diff || '' };
    }
    return { clears, best };
  }
  // Game moments for the channel,  // Game moments for the channel, read from the event log so nothing posts twice. The first run
  // after an update only notes where the log is. Moments are capped per game day so a busy day
  // can't flood the channel; escapes, the game start, end and countdowns don't count toward the cap.
  async discordFeed() {
    const s = this.state, m = this.meta, now = Date.now();
    const last = s.events.length ? s.events[s.events.length - 1].id : 0;
    const bigNow = () => s.events.filter((e) => e.t === 'cleared' && e.proof && e.proof.acc >= BIG_ACC).map((e) => e.id + ':' + Math.round(e.proof.acc * 10000));
    if (!m.feed || m.feed.game !== s.id) {
      const fresh = !!m.feed;
      m.feed = { game: s.id, ev: last, big: bigNow(), leader: this.leaderNow(), open: E.signupsOpen(s) && s.status === 'signup', day: false, hour: false, lastcall: false, capDay: null, n: 0, leadDay: null };
      if (fresh && m.feed.open && this.announcing('signups')) { const p = this.signupsPost(); await this.discordPost(p.text, true, p.card); }
      return;
    }
    const f = m.feed, t = C.themes[s.themeId] || {}, goal = t.goal || 'exit';
    const name = (pid) => md((s.players[pid] || {}).name || 'Someone');
    // false = out of requests for this run: stop here and pick up from this moment next time
    const say = async (kind, text) => {
      if (!this.announcing(kind)) return true;
      if (f.capDay !== s.day) { f.capDay = s.day; f.n = 0; }
      if (kind !== 'escape' && f.n >= MOMENT_CAP) return true;   // escapes always post
      if ((await this.discordPost(text, false)) === 'nobudget') return false;
      if (kind !== 'escape') f.n++;
      return true;
    };
    // countdowns
    const open = s.status === 'signup' && E.signupsOpen(s);
    if (open && !f.open && this.announcing('signups')) { const p = this.signupsPost(); if ((await this.discordPost(p.text, true, p.card)) === 'nobudget') return; }
    f.open = open;
    if (s.status === 'signup' && s.startsAt && !f.day && now >= s.startsAt - DAY && now < s.startsAt - HOUR) {
      const d = this.dayPost();
      if (this.announcing('day') && (await this.discordPost(d.text, true, d.card)) === 'nobudget') return;
      f.day = true;
    }
    if (s.status === 'signup' && s.startsAt && !f.hour && now >= s.startsAt - HOUR && now < s.startsAt) {
      if (this.announcing('hour')) { const p = this.hourPost(); if ((await this.discordPost(p.text, true, p.card)) === 'nobudget') return; }
      f.hour = true;
    }
    if (s.status === 'running' && s.endsAt && !f.lastcall && now >= s.endsAt - DAY && now < s.endsAt) {
      if (this.announcing('lastcall')) { const p = this.lastCallPost(); if ((await this.discordPost(p.text, true, p.card)) === 'nobudget') return; }
      f.lastcall = true;
    }
    // moments since last time
    const fresh = s.events.filter((e) => e.id > f.ev);
    for (const e of fresh) {
      const kd = e.space && s.board.spaces[e.space] && t.kinds ? t.kinds[s.board.spaces[e.space].kind] : null;
      const card = e.card ? (s.cards || []).find((c) => c.id === e.card) : null;
      const why = kd ? `*${kd.title}* ` : card ? `*${card.title || card.name || 'A card'}* ` : '';
      // Setbacks lead with the space's or card's own icon, so a taco game doesn't get the cemetery skull.
      const what = kd ? kd.title : card ? card.title || card.name : '', art = (kd && kd.icon) || (card && card.art) || (t.family === 'taco' ? '😬' : '💀');
      const ow = (pid) => { const r = E.ranking(s).find((x) => x.pid === pid); return r && !r.escaped ? ` and is now ${plural(r.left, 'space')} from the ${goal}` : ''; };
      const hit = (pid, did) => `${art} ${what ? `*${/[!?.]$/.test(what) ? what : what + '!'}* ` : ''}**${name(pid)}** ${did}${ow(pid)}.`;
      let ok = true;
      if (e.t === 'escaped') {
        const p = s.players[e.pid], medal = ['🥇 ', '🥈 ', '🥉 '][e.place - 1] || '', left = 3 - e.place;
        const tail = e.place > 3 ? '' : left > 0 ? ` ${left === 1 ? '1 podium spot' : left + ' podium spots'} left.` : ' The podium is full.';
        ok = await say('escape', `🏁 ${why}**${name(e.pid)}** made it to the ${goal}! ${medal}**${ordinal(e.place)} place** on day ${e.day}` + (p && p.route ? `, by the ${this.routeName(p.route)}.` : '.') + tail);
      } else if (e.t === 'gate-closed') {
        const first = s.finishOrder.find((pid) => s.players[pid] && s.players[pid].finished && s.players[pid].finished.day === e.day);
        const when = this.meta.nextCutoff ? `<t:${sec(this.meta.nextCutoff)}:R>` : 'tomorrow';
        ok = await say('gate', `🚪 **${name(e.pid)}** reached the ${goal}, but ${first ? `**${name(first)}**` : 'someone'} already got out today. ${name(e.pid)} waits one space short and can roll for it again ${when}.`);
      }
      else if (e.t === 'start') ok = await say('setback', hit(e.pid, 'is sent back to the start').replace(/ and is now [^.]*/, ''));
      else if (e.t === 'move' && e.n <= -SETBACK) ok = await say('setback', hit(e.pid, `goes back ${-e.n} spaces`));
      else if (e.t === 'warp') {
        const p = s.players[e.pid], r = p && p.route ? s.board.routes[p.route] : [], back = r.indexOf(e.space) - r.indexOf(e.to);
        if (back >= SETBACK && r.indexOf(e.to) >= 0) ok = await say('setback', hit(e.pid, `gets swept back ${back} spaces`));
      }
      if (!ok) return;   // out of requests: this moment and the rest go next run
      f.ev = e.id;
    }
    f.ev = last;
    // big scores, including old clears improved past the line
    const big = bigNow(), seen = new Set(f.big);
    for (const k of big) {
      if (seen.has(k)) continue;
      const id = Number(k.split(':')[0]), e = s.events.find((x) => x.id === id);
      const before = f.big.some((x) => x.split(':')[0] === String(id));
      if (e && !before) {
        const key = (e.bsr || [])[0], song = key ? await this.songName(key) : '';
        // The best on this map this game, counting every clear still in the log.
        const top = s.events.filter((x) => x.t === 'cleared' && x.proof && x.proof.acc && (x.bsr || [])[0] === key).every((x) => x.proof.acc <= e.proof.acc);
        if (!(await say('big', `✨ **${name(e.pid)}** cleared ${song ? `**${md(song)}**` : 'a map'}` + (e.proof.diff ? ` (${e.proof.diff})` : '') + ` at **${(e.proof.acc * 100).toFixed(2)}%**` + (top ? ', the best on that map this game.' : '.') + (key ? ` \`!bsr ${key}\`` : '')))) return;
      }
      f.big.push(k);
    }
    f.big = big;
    // a new leader, at most once a game day
    const lead = this.leaderNow();
    if (lead && f.leader && lead !== f.leader && s.status === 'running' && !s.players[lead].finished && f.leadDay !== s.day) {
      const r = E.ranking(s)[0];
      f.leadDay = s.day;
      const was = E.ranking(s).find((x) => x.pid === f.leader), gap = r && was && !was.escaped ? was.left - r.left : 0;
      if (!(await say('leader', `👑 **${name(lead)}** passes **${name(f.leader)}** for the lead on day ${s.day}!` + (r ? ` ${plural(r.left, 'space')} from the ${goal}` + (gap > 0 ? `, ${name(f.leader)} is ${gap} behind.` : '.') : '')))) { f.leadDay = null; return; }
    }
    if (lead) f.leader = lead;
  }
  // The one player out in front (nobody when it's a tie).
  leaderNow() {
    const s = this.state; if (!s || s.status !== 'running') return null;
    const r = E.ranking(s); if (!r.length) return null;
    if (r[1] && r[1].place === r[0].place) return null;
    return r[0].pid;
  }
  async songName(key) {
    const m = (this.meta.songs = this.meta.songs || {}); key = String(key).toLowerCase();
    if (m[key]) return m[key];
    if (!this.take(1)) return '';
    const r = await fetch((this.env.BS_API || 'https://api.beatsaver.com') + '/maps/id/' + key, { headers: { 'user-agent': 'ChestersEscape' } }).catch(() => null);
    if (!r || !r.ok) return '';
    const j = await r.json().catch(() => ({}));
    const n = String((j.metadata && j.metadata.songName) || j.name || '').slice(0, 80);
    if (n) { m[key] = n; const ks = Object.keys(m); if (ks.length > 300) delete m[ks[0]]; }
    return n;
  }

  game() {
    if (!this.state) {
      const themeId = this.clan().theme;
      this.dirty = true;
      this.state = E.createGame({ board: C.boardFor(mapSetFor(this.clan(), themeId)), cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, rng });
      this.meta = Object.assign(this.meta || {}, { nextCutoff: E.nextCutoff(this.state.settings) });
    }
    return this.state;
  }

  // Who can play. 'testers' (default): only the host and people the host lets in.
  // 'open': anyone who signs in (sign-in is still limited to the clan's Discord server).
  access() {
    if (!this.meta.access) {
      const seed = String(this.env.TESTERS || '').split(',').map((x) => x.trim()).filter(Boolean);
      this.meta.access = { mode: 'testers', allowed: seed, pending: [] };
    }
    return this.meta.access;
  }
  canUse(user) {
    if (!user) return false;
    const a = this.access();
    return !!user.isHost || a.mode === 'open' || a.allowed.includes(user.id);
  }
  accessFor(user) { return !user ? 'signin' : this.canUse(user) ? 'ok' : 'pending'; }
  async save() {
    this.countDays();
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.put('meta', this.meta);
    const s = this.state;
    let next = !s ? null : s.status === 'signup' ? s.startsAt : s.status === 'running' ? Math.min(this.meta.nextCutoff || Infinity, s.endsAt || Infinity) : null;
    // wake up for the day-before, one-hour and last-day posts too
    const f = this.meta.feed || {}, soon = [s && s.status === 'signup' && s.startsAt && !f.day ? s.startsAt - DAY : 0, s && s.status === 'signup' && s.startsAt && !f.hour ? s.startsAt - HOUR : 0, s && s.status === 'running' && s.endsAt && !f.lastcall ? s.endsAt - DAY : 0].filter((x) => x > Date.now());
    if (soon.length) next = Math.min(next || Infinity, ...soon);
    let want = Math.max(Date.now() + 1000, Math.min(next && isFinite(next) ? next : Date.now() + CHECK_EVERY, Date.now() + CHECK_EVERY));
    if (this.later) { want = Math.min(want, Date.now() + 60000); this.later = false; }
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > want) await this.ctx.storage.setAlarm(want);
  }
  pidFor(user) { return user ? 'd' + user.id : null; }

  async whoAmI(user) {
    this.useClan(user);
    const s = this.game(); const pid = this.pidFor(user);
    const status = this.accessFor(user);
    if (status === 'pending') {
      // Put them on the host's waiting list (once).
      const a = this.access();
      if (!a.pending.some((x) => x.id === user.id)) {
        a.pending.push({ id: user.id, name: String(user.name || '').slice(0, 60), avatar: user.avatar || '', at: Date.now() });
        if (a.pending.length > 100) a.pending.shift();
        s.seq++;
        await this.notifyHosts({ title: (user.name || 'Someone') + ' is waiting to get in', body: 'Open Host tools to let them in.', tag: 'wait-' + user.id });
        await this.save();
      }
    }
    await this.visit(user);
    if (this.dirty) { this.dirty = false; await this.save(); }
    return { pid: status === 'ok' && pid && s.players[pid] ? pid : null, access: status, startsAt: s.status === 'signup' ? s.startsAt || null : null, theme: s.themeId };
  }

  async getState(user, since) {
    this.useClan(user);
    const s = this.game(); const pid = this.pidFor(user);
    // Anyone signed in can watch. Only approved players can join and play (checked in act()).
    if (!user) return { error: 'Sign in with Discord to see the game.', code: 'no-access', access: 'signin' };
    const canPlay = this.canUse(user);
    const me = canPlay && pid && s.players[pid] ? pid : null;
    if (me) this.seen(me);
    await this.visit(user);
    if (this.dirty) { this.dirty = false; await this.save(); }
    if (since === s.seq) return { state: null, me, canPlay, online: this.onlineNow() };
    const out = { state: E.publicState(s), me, canPlay, isHost: !!user.isHost, user: { id: user.id, name: user.name, avatar: user.avatar }, online: this.onlineNow(), hall: this.meta.hall || [], admins: this.admins() };
    if (user && user.isHost) { out.access = this.access(); out.discord = this.discordInfo(); out.undo = this.undoInfo(); out.hostOut = this.hostOut(user); }
    return out;
  }

  async act(user, action, a) {
    this.useClan(user);
    const s = this.game(); const pid = this.pidFor(user);
    if (!this.canUse(user)) return { error: 'This game is invite-only right now.', code: 'no-access' };
    const hostOnly = ['advance', 'approve', 'reject', 'setpos', 'card', 'resetPlayer', 'removePlayer', 'clearPlayers', 'signups', 'clearRoute', 'settings', 'theme', 'newGame', 'clearGame', 'schedule', 'startNow', 'setEnd', 'endNow', 'accessMode', 'letIn', 'dismiss', 'removeAccess', 'discordPosts', 'discordTest', 'undo', 'hallRemove', 'hostPlays'];
    if (hostOnly.includes(action) && !user.isHost) return { error: 'Only the host can do that.', status: 403 };
    if (s.status === 'finished' && ['join', 'route', 'roll', 'verify', 'claim'].includes(action)) return { error: 'The game is over.' };
    const wasRunning = s.status === 'running';
    // Host changes keep a snapshot so the host can take the last few back.
    const snap = user.isHost && E.UNDOABLE.includes(action) ? { state: JSON.stringify(s), cut: this.meta.nextCutoff == null ? null : this.meta.nextCutoff, pre: s.seq, label: E.hostLabel(s, action, a) } : null;
    let result = {};
    try {
      switch (action) {
        case 'join': {
          if (user.isHost && this.hostOut(user)) return { error: "You're hosting this game, not playing. Switch that off in Host tools to join." };
          if (!E.signupsOpen(s)) return { error: 'Sign-ups are closed until the game starts.' };
          const bl = await this.blPlayer(a.blId);
          const taken = s.order.find((id) => id !== pid && s.players[id].blId === bl.id);
          if (taken) return { error: 'That BeatLeader profile is already in the game.' };
          const isNew = !s.players[pid];
          E.addPlayer(s, { id: pid, discordId: user.id, name: bl.name || user.name, avatar: bl.avatar || user.avatar, blId: bl.id });
          result = { pid };
          // Hosts hear about each new sign-up (not their own, and not someone just relinking a profile).
          if (isNew && !user.isHost) {
            const n = s.order.length, who = s.players[pid].name;
            await this.notifyHosts({ title: who + ' signed up', body: n + (n === 1 ? ' player is' : ' players are') + ' in ' + s.title + (s.status === 'signup' ? ' so far.' : ' now.'), tag: 'join-' + pid });
          }
          break;
        }
        case 'route': result = this.mine(s, pid) && E.chooseRoute(s, pid, a.route); break;
        case 'react': result = E.react(s, pid, a.id, a.emoji, s.players[pid] ? null : { name: user.name, avatar: user.avatar }); break;
        case 'roll': this.mine(s, pid); result = E.roll(s, pid, { rng }); delete result.player; break;
        case 'verify': this.mine(s, pid); result = { cleared: await this.check(pid) }; break;
        case 'claim': {
          this.mine(s, pid); result = E.claimTask(s, pid, a.task, { url: String(a.url || '').slice(0, 300) });
          const p = s.players[pid], t = p.tasks.find((x) => x.id === a.task);
          await this.notifyHosts({ title: p.name + ' played a map', body: 'Says they played !bsr ' + (t ? t.bsr.join(' or ') : '?') + '. Approve it in Host tools.', tag: 'claim-' + pid + '-' + a.task });
          break;
        }
        // host
        case 'advance': if (s.status !== 'running') return { error: 'The game has not started yet.' }; E.advanceDay(s); this.meta.nextCutoff = E.nextCutoff(s.settings); result = { day: s.day }; break;
        case 'approve': result = E.completeTask(s, a.pid, a.task, { by: 'host' }); break;
        case 'reject': E.rejectClaim(s, a.pid, a.task); break;
        case 'setpos': E.setPosition(s, a.pid, Number(a.pos), { apply: !!a.apply }); break;
        case 'card': E.hostCard(s, a.pid, a.card); break;
        case 'resetPlayer': E.resetPlayer(s, a.pid); break;
        case 'removePlayer': E.removePlayer(s, a.pid); break;
        case 'clearPlayers': if (!E.clearPlayers(s)) return { error: 'You can only clear sign-ups before the game starts.' }; break;
        case 'signups': if (s.status !== 'signup') return { error: 'The game has already started.' }; if (a.closed) s.signupsClosed = true; else delete s.signupsClosed; s.seq++; break;
        case 'clearRoute': { const p = s.players[a.pid]; p.route = null; p.pos = -1; p.tasks = []; break; }
        case 'settings': {
          const allowed = ['exactFinish', 'oneFinishPerDay', 'oneRollPerDay', 'cutoffHour', 'cutoffMinute', 'timeZone', 'remindHour'];
          for (const k of Object.keys(a.patch || {})) if (allowed.includes(k)) s.settings[k] = a.patch[k];
          this.meta.nextCutoff = E.nextCutoff(s.settings); result = s.settings; break;
        }
        case 'theme': {
          if (!C.themes[a.theme]) return { error: 'Unknown theme.' };
          s.themeId = a.theme; s.title = C.themes[a.theme].title;
          const words = Object.fromEntries(C.cardsFor(a.theme).map((c) => [c.id, c]));
          s.cards = s.cards.map((c) => (words[c.id] ? { ...c, title: words[c.id].title, art: words[c.id].art, text: words[c.id].text } : c));
          this.syncMaps();
          break;
        }
        case 'newGame': {
          if (s.status === 'running') return { error: 'End this game first, then start the next one.' };
          if (s.status === 'signup' && !a.signup) return { error: 'This game is still in sign-ups.' };
          const themeId = C.themes[a.theme] ? a.theme : s.themeId;
          const board = a.board ? { ...a.board, custom: true } : C.boardFor(mapSetFor(this.clan(), themeId));
          const probs = E.checkBoard(board);
          if (probs.length) return { error: probs[0] };
          const keep = s.order.map((id) => s.players[id]);
          const startsAt = Number(a.startsAt) > Date.now() + 60000 ? Number(a.startsAt) : null;
          const endsAt = Number(a.endsAt) > (startsAt || Date.now()) + 3600000 ? Number(a.endsAt) : null;
          this.state = E.createGame({ board, cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, settings: s.settings, rng, status: startsAt || a.signup ? 'signup' : 'running', startsAt, endsAt });
          keep.forEach((p) => E.addPlayer(this.state, { id: p.id, discordId: p.discordId, name: p.name, avatar: p.avatar, blId: p.blId }));
          this.meta.nextCutoff = startsAt || a.signup ? null : E.nextCutoff(this.state.settings);
          if (this.meta.feed) this.meta.feed.game = null;   // a new game: its sign-up post can go out
          break;
        }
        // Wipe a game that's over: a fresh sign-up board with nobody on it and an empty thread.
        // A running game can't be cleared. Rules, who can play, Discord settings and the hall of fame stay.
        case 'clearGame': {
          if (s.status === 'running') return { error: 'This game is still running. End it first, then clear it.' };
          const themeId = C.themes[a.theme] ? a.theme : s.themeId;
          const board = C.boardFor(mapSetFor(this.clan(), themeId));
          const startsAt = Number(a.startsAt) > Date.now() + 60000 ? Number(a.startsAt) : null;
          const endsAt = Number(a.endsAt) > (startsAt || Date.now()) + 3600000 ? Number(a.endsAt) : null;
          this.state = E.createGame({ board, cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, settings: s.settings, rng, status: 'signup', startsAt, endsAt });
          this.state.seq = (s.seq || 0) + 1;   // keep counting up so open pages pick up the change
          this.meta.nextCutoff = null;
          if (this.meta.feed) this.meta.feed.game = null;   // a new game: its sign-up post can go out
          break;
        }
        case 'schedule': {
          if (s.status !== 'signup') return { error: 'The game has already started.' };
          if (a.startsAt == null) { s.startsAt = null; s.seq++; break; }
          const at = Number(a.startsAt);
          if (!(at > Date.now() + 60000)) return { error: 'Pick a start time in the future.' };
          s.startsAt = at; s.seq++; break;
        }
        case 'setEnd': {
          if (s.status === 'finished') return { error: 'The game is already over.' };
          if (a.endsAt == null) { s.endsAt = null; s.seq++; break; }
          const at = Number(a.endsAt);
          if (!(at > Date.now() + 60000) || (s.startsAt && s.status === 'signup' && at <= s.startsAt)) return { error: 'Pick an end time in the future, after the start.' };
          s.endsAt = at; s.seq++; break;
        }
        case 'endNow': {
          if (!E.endGame(s, Date.now())) return { error: 'The game is not running.' };
          this.recordHall();
          await this.announceEnd();
          break;
        }
        case 'startNow': {
          if (!E.startGame(s, Date.now())) return { error: 'The game has already started.' };
          this.meta.nextCutoff = E.nextCutoff(s.settings);
          await this.announceStart();
          break;
        }
        // who can play
        case 'accessMode': { const ac = this.access(); if (a.mode !== 'open' && a.mode !== 'testers') return { error: 'Unknown mode.' }; ac.mode = a.mode; s.seq++; break; }
        case 'letIn': {
          const ac = this.access(), id = String(a.id || '');
          if (!/^\d{5,25}$/.test(id)) return { error: 'That is not a Discord user ID.' };
          if (!ac.allowed.includes(id)) ac.allowed.push(id);
          const w = ac.pending.find((x) => x.id === id);
          ac.names = ac.names || {}; if (w) ac.names[id] = w.name; else if (a.name) ac.names[id] = String(a.name).slice(0, 60);
          ac.pending = ac.pending.filter((x) => x.id !== id); s.seq++; break;
        }
        case 'hallRemove': {
          const id = String(a.id || ''), hall = this.meta.hall || [];
          if (!hall.some((h) => h.id === id)) return { error: 'That game is not in the hall of fame.' };
          this.meta.hall = hall.filter((h) => h.id !== id);
          (this.meta.hallHidden = this.meta.hallHidden || []).push(id);   // so it never comes back on its own
          if (this.meta.hallHidden.length > 100) this.meta.hallHidden.shift();
          s.seq++; break;
        }
        case 'undo': {
          const top = this.undoList[this.undoList.length - 1];
          if (!top) return { error: 'There is nothing to undo.' };
          if (top.post !== s.seq && !this.clearUndoable(top)) return { error: 'Players have done things since then, so undoing it would wipe their moves too.' };
          const raw = await this.ctx.storage.get('undo:' + top.id);
          if (!raw) return { error: 'That change can no longer be undone.' };
          const old = JSON.parse(raw);
          old.seq = Math.max(old.seq || 0, s.seq) + 1;   // keep counting up so pages and event ids stay in order
          this.state = old; this.meta.nextCutoff = top.cut;
          this.undoList.pop(); await this.ctx.storage.delete('undo:' + top.id);
          const below = this.undoList[this.undoList.length - 1];
          if (below && below.post === top.pre) below.post = old.seq;
          await this.ctx.storage.put('undoList', this.undoList);
          if (old.status !== 'finished' && this.meta.hall) this.meta.hall = this.meta.hall.filter((h) => h.id !== old.id);
          if (this.meta.feed && this.meta.feed.game !== old.id) delete this.meta.feed;   // don't re-announce a game we went back to
          result = { undone: top.label };
          break;
        }
        case 'hostPlays': {
          const id = String(user.id), l = (this.meta.hostOut = this.meta.hostOut || []).filter((x) => x !== id);
          if (!a.plays) { if (s.players[pid]) return { error: 'You are signed up for this game. Take yourself off it in the Players tab first.' }; l.push(id); }
          this.meta.hostOut = l; s.seq++; break;
        }
        case 'discordPosts': {
          if (!POST_KINDS.includes(a.kind)) return { error: 'Unknown post.' };
          this.posts()[a.kind] = !!a.on; s.seq++; break;
        }
        case 'discordTest': {
          if (!this.webhook()) return { error: 'No Discord webhook is set up for this game yet.' };
          const r = await this.discordPost(`Test post from **${md(s.title)}**. Game posts will show up in this channel.`, true);
          if (!r || !r.ok) return { error: 'Discord did not accept the post' + (r ? ' (' + r.status + ').' : '.') };
          break;
        }
        case 'dismiss': { const ac = this.access(); ac.pending = ac.pending.filter((x) => x.id !== String(a.id)); s.seq++; break; }
        case 'removeAccess': { const ac = this.access(); ac.allowed = ac.allowed.filter((x) => x !== String(a.id)); s.seq++; break; }
        default: return { error: 'Unknown action.' };
      }
    } catch (e) {
      return { error: e.message || 'That did not work.', code: e.code };
    }
    await this.discordFeed();
    if (wasRunning && this.state.status === 'finished' && action !== 'endNow') { this.recordHall(); await this.announceEnd(); }
    if (snap) await this.pushUndo(snap, user);
    await this.save();
    if (this.state.players[pid]) this.seen(pid);
    const out = { result, state: E.publicState(this.state), me: this.state.players[pid] ? pid : null, canPlay: true, online: this.onlineNow(), hall: this.meta.hall || [], admins: this.admins() };
    if (user.isHost) { out.access = this.access(); out.discord = this.discordInfo(); out.undo = this.undoInfo(); out.hostOut = this.hostOut(user); }
    return out;
  }
  // Who has the game open right now. Open pages check in every 20 seconds while visible, so
  // anyone heard from in the last 50 seconds counts as online. Kept in memory only: no storage
  // writes per check-in, and if the game server restarts everyone simply shows up again on their next check.
  seen(pid) { (this.seenAt = this.seenAt || {})[pid] = Date.now(); }
  onlineNow() {
    const s = this.state, at = this.seenAt || {}, cut = Date.now() - 50000;
    return Object.keys(at).filter((pid) => at[pid] >= cut && s && s.players[pid]);
  }

  // Sessions for the host: when each signed-in person opened the game and when they left. An open
  // page checks in every 20 seconds while it's in front of them. Coming back within 10 minutes of
  // the last check-in continues the same visit, so a quick app switch (or the game server being
  // unloaded between check-ins) never splits one visit into many. Two weeks are kept.
  async visit(user) {
    if (!user || !user.id || user.isHost) return;   // hosts aren't logged
    const now = Date.now(), live = (this.visitLive = this.visitLive || {}), log = this.visits || (this.visits = []);
    await this.sweepVisits(now);
    const cur = live[user.id];
    if (cur && now - cur.last < VISIT_GAP) {
      cur.last = now;
      if (now - cur.saved > 120000) { cur.saved = now; cur.entry.last = now; await this.ctx.storage.put('visits', log); }
      return;
    }
    // Their latest visit, if it ended (or was last heard from) less than 10 minutes ago, carries on.
    let prev = null;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].id === user.id) { prev = log[i]; break; }
    if (prev && now - (prev.end || prev.last) < VISIT_GAP) {
      const wasOpen = prev.end == null, quiet = now - prev.last;
      live[user.id] = { entry: prev, last: now, saved: wasOpen && quiet < 120000 ? prev.last : now };
      prev.end = null;
      if (user.name) prev.name = String(user.name).slice(0, 60);
      if (user.avatar) prev.avatar = String(user.avatar).slice(0, 300);
      // Save when it reopens or the saved check-in is getting old; otherwise memory is enough for now.
      if (!wasOpen || quiet >= 120000) { prev.last = now; await this.ctx.storage.put('visits', log); }
      return;
    }
    const entry = { id: user.id, name: String(user.name || '').slice(0, 60), avatar: String(user.avatar || '').slice(0, 300), start: now, last: now, end: null };
    log.push(entry);
    const cut = now - 14 * 86400000;
    while (log.length && (log.length > 1500 || (log[0].end || log[0].last) < cut)) log.shift();
    live[user.id] = { entry, last: now, saved: now };
    await this.ctx.storage.put('visits', log);
  }
  async sweepVisits(now) {
    const live = this.visitLive || {}, log = this.visits || [];
    let changed = false;
    // Gone quiet for 10 minutes: the visit ends at their last check-in.
    Object.keys(live).forEach((id) => { const v = live[id]; if (now - v.last >= VISIT_GAP) { v.entry.end = v.last; v.entry.last = v.last; delete live[id]; changed = true; } });
    // Nobody in memory (the server was unloaded): an open visit not heard from for 10 minutes ends at its last saved check-in.
    log.forEach((e) => { if (e.end == null && !live[e.id] && now - e.last >= VISIT_GAP) { e.end = e.last; changed = true; } });
    if (this.compactVisits()) changed = true;
    if (changed) await this.ctx.storage.put('visits', log);
  }
  // Joins any visits by the same person less than 10 minutes apart (also fixes logs split up before this rule).
  compactVisits() {
    const log = this.visits || [], live = this.visitLive || {}, keep = [], lastBy = {};
    let changed = false;
    log.forEach((e) => {
      const p = lastBy[e.id];
      if (p && e.start - (p.end != null ? p.end : p.last) < VISIT_GAP) {
        p.last = Math.max(p.last, e.last);
        p.end = p.end == null || e.end == null ? null : Math.max(p.end, e.end);
        if (live[e.id] && live[e.id].entry === e) live[e.id].entry = p;
        changed = true;
        return;
      }
      keep.push(e); lastBy[e.id] = e;
    });
    if (changed) { log.length = 0; keep.forEach((e) => log.push(e)); }
    return changed;
  }
  async visitLog(user) {
    if (!user || !user.isHost) return { error: 'Only the host can see this.' };
    const now = Date.now();
    await this.sweepVisits(now);
    const s = this.game(), live = this.visitLive || {};
    // "On now" means heard from in the last minute; within the 10-minute window but quiet is "away".
    return { now, visits: (this.visits || []).slice(-400).reverse().map((e) => {
      const lv = live[e.id] && live[e.id].entry === e ? live[e.id].last : null, last = lv || e.last;
      // Their Discord picture (visits logged before pictures were kept borrow one from a reaction).
      const avatar = e.avatar || ((s.fans || {})['d' + e.id] || {}).avatar || '';
      return { id: e.id, name: e.name, avatar, start: e.start, end: e.end, last, open: e.end == null && now - last < 60000, player: !!s.players['d' + e.id] };
    }) };
  }

  // Rolls and clears per game day, and rolls by hour (UTC), counted as moments happen and kept with the
  // game's meta. The thread only keeps the latest 800 moments, so the early days of a busy game would
  // otherwise fall off the Stats tab.
  countDays() {
    const s = this.state; if (!s) return;
    let t = this.meta.daily;
    if (!t || t.game !== s.id) t = this.meta.daily = { game: s.id, mark: 0, days: {}, hours: Array(24).fill(0) };
    for (const e of s.events) {
      if (e.id <= t.mark) continue;
      if (e.t !== 'roll' && e.t !== 'cleared') continue;
      const d = t.days[e.day] || (t.days[e.day] = [0, 0]);
      if (e.t === 'roll') { d[0]++; t.hours[new Date(e.at || Date.now()).getUTCHours()]++; } else d[1]++;
    }
    if (s.events.length) t.mark = Math.max(t.mark, s.events[s.events.length - 1].id);
  }
  // The host's Stats tab: the daily tally, who has notifications on, people who signed in but never
  // joined, and GoatCounter's visitors and sources.
  async hostStats(user, fresh) {
    if (!user || !user.isHost) return { error: 'Only the host can see this.' };
    this.useClan(user);
    const s = this.game(), now = Date.now(), hostIds = hosts(this.env, this.clan()), a = this.access();
    await this.sweepVisits(now);
    this.countDays();
    const subs = this.meta.push || [], uids = new Set(subs.map((x) => x.uid));
    const uid = (pid) => (s.players[pid] && s.players[pid].discordId) || String(pid).replace(/^d/, '');
    const notify = { on: s.order.filter((pid) => uids.has(uid(pid))), devices: subs.filter((x) => !hostIds.includes(x.uid)).length };
    // Signed in but not on the board: the visit log, the waiting list, people let in and anyone who reacted.
    const out = {};
    const add = (id, name, avatar, last) => {
      id = String(id || ''); if (!id || s.players['d' + id] || hostIds.includes(id)) return null;
      const o = out[id] || (out[id] = { id, name: '', avatar: '', last: 0, visits: 0, reacted: false });
      if (name && !o.name) o.name = String(name); if (avatar && !o.avatar) o.avatar = String(avatar); if (last > o.last) o.last = last;
      return o;
    };
    for (const v of this.visits || []) { const o = add(v.id, v.name, v.avatar, v.end || v.last || v.start); if (o) o.visits++; }
    for (const w of a.pending) add(w.id, w.name, w.avatar, w.at);
    for (const id of a.allowed) add(id, (a.names || {})[id], '', 0);
    for (const f of Object.values(s.fans || {})) { const o = add(String(f.id).replace(/^d/, ''), f.name, f.avatar, 0); if (o) o.reacted = true; }
    const lurkers = Object.values(out).filter((o) => o.name).map((o) => ({ ...o, why: a.pending.some((w) => w.id === o.id) ? 'waiting' : a.mode === 'open' || a.allowed.includes(o.id) ? 'can-join' : 'looking' }))
      .sort((x, y) => y.last - x.last).slice(0, 100);
    // GoatCounter, cached for 10 minutes (Refresh skips the cache after a minute)
    let gc;
    if (!this.env.GC_TOKEN) gc = { error: 'no-key' };
    else {
      const c = this.gcCache, age = c ? now - c.at : Infinity;
      if (c && (age < (fresh ? 60000 : 600000))) gc = c.data;
      else { try { gc = await gcStats(this.env); this.gcCache = { at: now, data: gc }; } catch (e) { gc = c ? c.data : { error: e.message === 'auth' ? 'auth' : 'down' }; } }
    }
    const d = this.meta.daily || {};
    return { now, daily: { days: d.days || {}, hours: d.hours || [] }, notify, lurkers, gc };
  }

  // --- push notifications for hosts ---
  pushKeys() {
    const pub = String(this.env.VAPID_PUBLIC_KEY || '').trim(), priv = String(this.env.VAPID_PRIVATE_KEY || '').trim();
    return pub && priv ? { publicKey: pub, privateKey: priv, subject: this.env.GAME_PAGE || 'https://spanky3651.github.io/Chesters-Escape/' } : null;
  }
  async notifyHosts(msg, only) {
    const hostIds = hosts(this.env, this.clan());
    return this.pushTo((this.meta.push || []).filter((x) => (only ? only(x) : hostIds.includes(x.uid))), { ...msg, url: this.page('#host') });
  }
  async pushTo(subs, msg) {
    const keys = this.pushKeys();
    if (!keys || !subs.length) return { sent: 0, failed: 0 };
    // Taco themes show their own taco on the notification; everything else keeps the game icon.
    const tid = this.state && this.state.themeId, th = C.themes[tid] || {};
    const payload = { title: msg.title, body: msg.body || '', tag: (this.clan().id + '-') + (msg.tag || 'chester'), url: msg.url || this.page(), icon: th.artHero ? 'img/push/' + tid + '.png' : '' };
    const gone = new Set(); let sent = 0, failed = 0;
    await Promise.all(subs.map(async (sub) => {
      try {
        const st = await sendPush(sub, payload, keys);
        if (st === 404 || st === 410) gone.add(sub.endpoint);
        if (st >= 200 && st < 300) sent++; else failed++;
      } catch { failed++; }
    }));
    if (gone.size) this.meta.push = (this.meta.push || []).filter((x) => !gone.has(x.endpoint));
    return { sent, failed };
  }
  async pushOp(user, op, body) {
    this.useClan(user);
    this.game();
    if (!this.pushKeys()) return { error: 'Notifications are not set up on the server yet.' };
    if (!this.canUse(user)) return { error: 'The host has to let you in first.' };
    const list = (this.meta.push = this.meta.push || []);
    const sub = body && body.subscription;
    if (op === 'subscribe') {
      if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { error: 'That device did not give a usable subscription.' };
      this.meta.push = list.filter((x) => x.endpoint !== sub.endpoint);
      this.meta.push.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, uid: user.id, name: user.name, label: String(body.label || 'Device').slice(0, 60), tz: validZone(body.tz), at: Date.now() });
      if (this.meta.push.length > 100) this.meta.push.shift();
      await this.save();
      return { ok: true, devices: this.meta.push.filter((x) => x.uid === user.id).length };
    }
    if (op === 'unsubscribe') {
      this.meta.push = list.filter((x) => x.endpoint !== String(body && body.endpoint || ''));
      await this.save();
      return { ok: true };
    }
    if (op === 'test') {
      const ep = String(body && body.endpoint || '');
      const r = await this.pushTo((this.meta.push || []).filter((x) => x.uid === user.id && (!ep || x.endpoint === ep)), { title: 'Notifications are on', body: user.isHost ? 'This device will hear when someone signs up, is waiting to get in or has a run to approve.' : 'This device will remind you when your roll or map is waiting.', tag: 'test' });
      await this.save();
      if (r.sent) return { ok: true, sent: r.sent };
      return { error: r.failed ? 'The push did not go through. Turn notifications off and on again on this device.' : 'Turn on notifications on this device first.' };
    }
    return { error: 'Unknown notification action.' };
  }

  mine(s, pid) { if (!s.players[pid]) { const e = new Error('Join the game first.'); e.code = 'no-player'; throw e; } return true; }

  // --- BeatSaver / BeatLeader from the server ---
  async bs(key) {
    this.meta.hashes = this.meta.hashes || {};
    if (this.meta.hashes[key]) return this.meta.hashes[key];
    if (!this.take(1)) return '';
    const r = await fetch((this.env.BS_API || 'https://api.beatsaver.com') + '/maps/id/' + key, { headers: { 'user-agent': 'ChestersEscape' } });
    if (!r.ok) return '';
    const j = await r.json();
    const h = String(((j.versions || [])[0] || {}).hash || '').toUpperCase();
    if (h) this.meta.hashes[key] = h;
    return h;
  }
  async blPlayer(input) {
    const id = String(input || '').match(/[A-Za-z0-9_-]+$/);
    if (!id) throw new Error('Enter your BeatLeader profile link or ID.');
    const r = await fetch((this.env.BL_API || 'https://api.beatleader.xyz') + '/player/' + id[0], { headers: { 'user-agent': 'ChestersEscape' } });
    if (!r.ok) throw new Error('No BeatLeader player found for that ID.');
    const p = await r.json();
    return { id: String(p.id), name: p.name, avatar: p.avatar || '' };
  }
  async check(pid) {
    const s = this.state, p = s.players[pid];
    if (!p || !p.blId) return [];
    // Open maps to clear, plus maps already cleared on BeatLeader in case they beat that score since.
    const done = s.events.filter((e) => e.t === 'cleared' && e.pid === pid && e.proof && e.proof.by === 'beatleader' && e.proof.diff);
    if (!p.tasks.length && !done.length) return [];
    const keys = [...new Set(p.tasks.flatMap((t) => t.bsr || []).concat(done.flatMap((e) => e.bsr || [])))];
    const hashes = {};
    for (const k of keys) hashes[String(k).toLowerCase()] = await this.bs(String(k).toLowerCase());
    if (Object.values(hashes).some((h) => !h) && this.budget != null && this.later) { this.cutShort = true; return []; }
    if (!this.take(1)) { this.cutShort = true; return []; }
    const r = await fetch((this.env.BL_API || 'https://api.beatleader.xyz') + '/player/' + encodeURIComponent(p.blId) + '/scores?sortBy=date&order=desc&count=50', { headers: { 'user-agent': 'ChestersEscape' } });
    if (!r.ok) return [];
    const j = await r.json();
    const scores = (j.data || []).map((x) => {
      const lb = x.leaderboard || {}, d = lb.difficulty || {};
      return { id: x.id, hash: String((lb.song || {}).hash || '').toUpperCase(), time: parseInt(x.timeset, 10) || x.timepost || 0, diff: d.difficultyName || '', acc: x.accuracy || 0, mods: x.modifiers || '' };
    });
    const cleared = p.tasks.length ? E.matchScores(s, pid, scores, hashes) : [];
    E.improveClears(s, pid, scores, hashes);
    return cleared;
  }

  // Day rollover at the cutoff, plus a BeatLeader sweep for everyone still on a map.
  async announceStart() {
    if (!this.announcing('start')) return;
    const s = this.state, n = s.order.length, sp = this.routeSplit(), fields = [{ name: '👥 Players', value: String(n), inline: true }];
    if (sp.routes.length) fields.push({ name: '🛤️ Routes', value: sp.routes.map((r) => r.n + ' ' + r.name.replace(/ route$/i, '')).join(', '), inline: true });
    if (s.endsAt) fields.push({ name: '🏁 Ends', value: `<t:${sec(s.endsAt)}:D>`, inline: true });
    const reset = this.meta.nextCutoff ? ` One roll a day, and the roll resets at <t:${sec(this.meta.nextCutoff)}:t> every night.` : ' One roll a day.';
    await this.discordPost(`🎲 **${md(s.title)} has started!** Day 1 is open: roll your d4 and play the map you land on.`, true,
      this.card('Play ' + s.title, { description: (n ? `${plural(n, 'player')} ${n === 1 ? 'is' : 'are'} off.` : 'Sign up and roll your first d4.') + reset, fields }));
  }

  // Once a game day per device, at the reminder hour in that device's own time zone: nudge
  // players who still have a roll or an open map. Runs from the alarm, so it lands within
  // 15 minutes of the time. Devices from before time zones were sent use the game's zone.
  async remind(now) {
    const s = this.state, h = E.remindHour(s), cutoff = this.meta.nextCutoff;
    if (s.status !== 'running' || h == null || !cutoff) return;
    const done = (this.meta.reminded = this.meta.reminded || {});
    const due = (this.meta.push || []).filter((sub) => done[sub.endpoint] !== s.day && now >= E.reminderTime(cutoff, h, sub.tz || s.settings.timeZone));
    if (!due.length) return;
    // keep a few requests for Discord and BeatLeader; the rest of the reminders go a minute later
    const room = this.budget == null ? due.length : Math.max(0, this.budget - 10);
    const now2 = due.slice(0, room);
    if (now2.length < due.length) this.later = true;
    this.take(now2.length);
    const byUid = {};
    for (const sub of now2) { done[sub.endpoint] = s.day; (byUid[sub.uid] = byUid[sub.uid] || []).push(sub); }
    for (const uid of Object.keys(byUid)) {
      const msg = E.reminderFor(s, 'd' + uid);
      if (msg) await this.pushTo(byUid[uid], { ...msg, tag: 'remind-' + s.day });
    }
    const live = new Set((this.meta.push || []).map((x) => x.endpoint));
    for (const k of Object.keys(done)) if (!live.has(k)) delete done[k];
  }

  async announceEnd() {
    const s = this.state;
    if (!this.announcing('end') || !s.final || !s.final.length) return;   // nobody played: nothing to announce
    // Medals follow the place, so players tied on spaces share one (two golds, then a silver).
    const medal = ['🥇', '🥈', '🥉'];
    const goal = this.theme().goal || 'exit', tot = this.totals(), out = s.final.filter((r) => r.escaped).length;
    const fields = s.final.filter((r) => r.place <= 3).slice(0, 6).map((r) => ({ name: `${medal[r.place - 1]} ${md(s.players[r.pid].name)}`, value: r.escaped ? `Day ${r.day}` : `${r.left} to go`, inline: true }));
    fields.push({ name: '📊 By the numbers', value: `${plural(s.final.length, 'player')} · ${plural(tot.clears, 'map')} cleared · ${out} made it to the ${goal}`, inline: false });
    if (tot.best && s.players[tot.best.pid]) {
      const song = tot.best.key ? await this.songName(tot.best.key) : '';
      fields.push({ name: '✨ Best clear', value: `**${md(s.players[tot.best.pid].name)}**, ${song ? md(song) : 'a map'}` + (tot.best.diff ? ` (${tot.best.diff})` : '') + ` at ${(tot.best.acc * 100).toFixed(2)}%`, inline: false });
    }
    await this.discordPost(`🏁 **${md(s.title)} is over!** Congrats to everyone who played.`, true, this.card('Final results', { fields }));
  }

  async alarm() {
    this.budget = Number(this.env.OUT_BUDGET) || 45; this.later = false;
    try { await this.alarmRun(); } finally { this.budget = null; }
  }
  async alarmRun() {
    const s = this.game();
    const now = Date.now();
    await this.sweepVisits(now);
    if (s.status === 'running' && s.endsAt && now >= s.endsAt - 1000) { E.endGame(s, now); this.recordHall(); await this.announceEnd(); }
    if (s.status === 'signup' && s.startsAt && now >= s.startsAt - 1000) {
      E.startGame(s, now);
      this.meta.nextCutoff = E.nextCutoff(s.settings, now + 1000);
      await this.announceStart();
    } else if (s.status === 'running' && this.meta.nextCutoff && now >= this.meta.nextCutoff - 1000) {
      E.advanceDay(s);
      this.meta.nextCutoff = E.nextCutoff(s.settings, now + 1000);
    }
    await this.remind(now);
    await this.discordFeed();
    if (s.status === 'running') {
      // Everyone on a map first, then a rotating batch of the rest (they may have beaten an old
      // clear). Kept small so a sweep stays well under the Worker's outside-request limit.
      const linked = s.order.filter((id) => s.players[id].blId);
      const busy = linked.filter((id) => s.players[id].tasks.length);
      const hasClears = new Set(s.events.filter((e) => e.t === 'cleared' && e.proof && e.proof.by === 'beatleader').map((e) => e.pid));
      const idle = linked.filter((id) => !s.players[id].tasks.length && hasClears.has(id));
      const off = (this.meta.sweepOff || 0) % (idle.length || 1);
      const take = Math.max(0, 30 - busy.length);
      const batch = idle.slice(off).concat(idle.slice(0, off)).slice(0, take);
      this.meta.sweepOff = off + batch.length;
      // more than 30 on a map: take turns, so nobody past the 30th waits forever
      const boff = (this.meta.busyOff || 0) % (busy.length || 1);
      const turn = busy.slice(boff).concat(busy.slice(0, boff)).slice(0, 30);
      let checked = 0;
      for (const pid of turn.concat(batch)) {
        if (this.budget != null && this.budget < 6) { this.later = true; break; }   // leave room for Discord posts
        this.cutShort = false;
        try { await this.check(pid); } catch { /* try again next sweep */ }
        if (this.cutShort) break;   // ran out partway: this player goes first next time
        checked++;
      }
      this.meta.busyOff = boff + Math.min(checked, turn.length);
    }
    await this.discordFeed();
    await this.save();
  }
}
