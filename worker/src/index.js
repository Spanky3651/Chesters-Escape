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
//   channel webhook), announce ("1" posts day and start/end messages).
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
    announce: String(x.announce != null ? x.announce : env.ANNOUNCE_DAYS || '0'), icon: String(x.icon || '')
  }));
}
// The game page link for a clan, so notifications and Discord posts open the right game.
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
  const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : '';
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
      if (url.pathname.startsWith('/api/push/') && req.method === 'POST') {
        if (!user) return json(env, req, { error: 'Sign in with Discord first.' }, 401);
        const body = await req.json().catch(() => ({}));
        const r = await gameStub(env, user.clan).pushOp(user, url.pathname.slice('/api/push/'.length), body);
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
export class Game extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.state = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) || null;
      // A game already running picks up new built-in bonus maps.
      if (this.state) E.upgradeBonus(this.state.board, C.boards['chester-escape']().bonusMaps);
      this.meta = (await ctx.storage.get('meta')) || {};
    });
  }

  // Which clan this game belongs to. Each call from the front door says so; the alarm uses
  // the last one seen. A game from before clans existed is the "main" game.
  useClan(user) { if (user && user.clan && this.meta.clanId !== user.clan.id) this.meta.clanId = user.clan.id; }
  clan() {
    const all = clans(this.env);
    return all.find((c) => c.id === this.meta.clanId) || all.find((c) => c.game === 'main') || all[0];
  }
  page(hash) { return pageFor(this.env, this.clan(), hash); }
  webhook() { return this.env[this.clan().webhook] || ''; }
  announcing() { return !!this.webhook() && this.clan().announce === '1'; }

  game() {
    if (!this.state) {
      const themeId = this.clan().theme;
      this.state = E.createGame({ board: C.boards['chester-escape'](), cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, rng });
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
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.put('meta', this.meta);
    const s = this.state;
    const next = !s ? null : s.status === 'signup' ? s.startsAt : s.status === 'running' ? Math.min(this.meta.nextCutoff || Infinity, s.endsAt || Infinity) : null;
    const want = Math.max(Date.now() + 1000, Math.min(next && isFinite(next) ? next : Date.now() + CHECK_EVERY, Date.now() + CHECK_EVERY));
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
    return { pid: status === 'ok' && pid && s.players[pid] ? pid : null, access: status, startsAt: s.status === 'signup' ? s.startsAt || null : null, theme: s.themeId };
  }

  async getState(user, since) {
    this.useClan(user);
    const s = this.game(); const pid = this.pidFor(user);
    // Anyone signed in can watch. Only approved players can join and play (checked in act()).
    if (!user) return { error: 'Sign in with Discord to see the game.', code: 'no-access', access: 'signin' };
    const canPlay = this.canUse(user);
    const me = canPlay && pid && s.players[pid] ? pid : null;
    if (since === s.seq) return { state: null, me, canPlay };
    const out = { state: E.publicState(s), me, canPlay, isHost: !!user.isHost, user: { id: user.id, name: user.name, avatar: user.avatar } };
    if (user && user.isHost) out.access = this.access();
    return out;
  }

  async act(user, action, a) {
    this.useClan(user);
    const s = this.game(); const pid = this.pidFor(user);
    if (!this.canUse(user)) return { error: 'This game is invite-only right now.', code: 'no-access' };
    const hostOnly = ['advance', 'approve', 'reject', 'setpos', 'card', 'resetPlayer', 'removePlayer', 'clearRoute', 'settings', 'theme', 'newGame', 'schedule', 'startNow', 'setEnd', 'endNow', 'accessMode', 'letIn', 'dismiss', 'removeAccess'];
    if (hostOnly.includes(action) && !user.isHost) return { error: 'Only the host can do that.', status: 403 };
    if (s.status === 'finished' && ['join', 'route', 'roll', 'verify', 'claim'].includes(action)) return { error: 'The game is over.' };
    const wasRunning = s.status === 'running';
    let result = {};
    try {
      switch (action) {
        case 'join': {
          const bl = await this.blPlayer(a.blId);
          const taken = s.order.find((id) => id !== pid && s.players[id].blId === bl.id);
          if (taken) return { error: 'That BeatLeader profile is already in the game.' };
          E.addPlayer(s, { id: pid, discordId: user.id, name: bl.name || user.name, avatar: bl.avatar || user.avatar, blId: bl.id });
          result = { pid };
          break;
        }
        case 'route': result = this.mine(s, pid) && E.chooseRoute(s, pid, a.route); break;
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
          break;
        }
        case 'newGame': {
          const themeId = C.themes[a.theme] ? a.theme : s.themeId;
          const board = a.board || C.boards['chester-escape']();
          const probs = E.checkBoard(board);
          if (probs.length) return { error: probs[0] };
          const keep = s.order.map((id) => s.players[id]);
          const startsAt = Number(a.startsAt) > Date.now() + 60000 ? Number(a.startsAt) : null;
          const endsAt = Number(a.endsAt) > (startsAt || Date.now()) + 3600000 ? Number(a.endsAt) : null;
          this.state = E.createGame({ board, cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, settings: s.settings, rng, status: startsAt ? 'signup' : 'running', startsAt, endsAt });
          keep.forEach((p) => E.addPlayer(this.state, { id: p.id, discordId: p.discordId, name: p.name, avatar: p.avatar, blId: p.blId }));
          this.meta.nextCutoff = startsAt ? null : E.nextCutoff(this.state.settings);
          break;
        }
        case 'schedule': {
          if (s.status !== 'signup') return { error: 'The game has already started.' };
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
        case 'dismiss': { const ac = this.access(); ac.pending = ac.pending.filter((x) => x.id !== String(a.id)); s.seq++; break; }
        case 'removeAccess': { const ac = this.access(); ac.allowed = ac.allowed.filter((x) => x !== String(a.id)); s.seq++; break; }
        default: return { error: 'Unknown action.' };
      }
    } catch (e) {
      return { error: e.message || 'That did not work.', code: e.code };
    }
    if (wasRunning && this.state.status === 'finished' && action !== 'endNow') await this.announceEnd();
    await this.save();
    const out = { result, state: E.publicState(this.state), me: this.state.players[pid] ? pid : null, canPlay: true };
    if (user.isHost) out.access = this.access();
    return out;
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
    const payload = { title: msg.title, body: msg.body || '', tag: (this.clan().id + '-') + (msg.tag || 'chester'), url: msg.url || this.page() };
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
      const r = await this.pushTo((this.meta.push || []).filter((x) => x.uid === user.id && (!ep || x.endpoint === ep)), { title: 'Notifications are on', body: user.isHost ? 'This device will hear about sign-ins, runs to approve, and your roll reminders.' : 'This device will remind you when your roll or map is waiting.', tag: 'test' });
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
    if (!p || !p.tasks.length || !p.blId) return [];
    const keys = [...new Set(p.tasks.flatMap((t) => t.bsr || []))];
    const hashes = {};
    for (const k of keys) hashes[String(k).toLowerCase()] = await this.bs(String(k).toLowerCase());
    const r = await fetch((this.env.BL_API || 'https://api.beatleader.xyz') + '/player/' + encodeURIComponent(p.blId) + '/scores?sortBy=date&order=desc&count=50', { headers: { 'user-agent': 'ChestersEscape' } });
    if (!r.ok) return [];
    const j = await r.json();
    const scores = (j.data || []).map((x) => {
      const lb = x.leaderboard || {}, d = lb.difficulty || {};
      return { id: x.id, hash: String((lb.song || {}).hash || '').toUpperCase(), time: parseInt(x.timeset, 10) || x.timepost || 0, diff: d.difficultyName || '', acc: x.accuracy || 0, mods: x.modifiers || '' };
    });
    return E.matchScores(s, pid, scores, hashes);
  }

  // Day rollover at the cutoff, plus a BeatLeader sweep for everyone still on a map.
  async announceStart() {
    if (!this.announcing()) return;
    const content = `**${this.state.title} has started!** Day 1 is open, go roll your first d4.` + (this.page() ? `\n${this.page()}` : '');
    await fetch(this.webhook(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
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
    const byUid = {};
    for (const sub of due) { done[sub.endpoint] = s.day; (byUid[sub.uid] = byUid[sub.uid] || []).push(sub); }
    for (const uid of Object.keys(byUid)) {
      const msg = E.reminderFor(s, 'd' + uid);
      if (msg) await this.pushTo(byUid[uid], { ...msg, tag: 'remind-' + s.day });
    }
    const live = new Set((this.meta.push || []).map((x) => x.endpoint));
    for (const k of Object.keys(done)) if (!live.has(k)) delete done[k];
  }

  async announceEnd() {
    const s = this.state;
    if (!this.announcing() || !s.final) return;
    const medal = ['🥇', '🥈', '🥉'];
    const top = s.final.slice(0, 3).map((r, i) => `${medal[i]} ${s.players[r.pid].name}` + (r.escaped ? ` (escaped day ${r.day})` : ` (${r.left} to go)`)).join('\n');
    const content = `**${s.title} is over!**\n${top}` + (this.page() ? `\n${this.page()}` : '');
    await fetch(this.webhook(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) }).catch(() => {});
  }

  async alarm() {
    const s = this.game();
    const now = Date.now();
    if (s.status === 'running' && s.endsAt && now >= s.endsAt - 1000) { E.endGame(s, now); await this.announceEnd(); }
    if (s.status === 'signup' && s.startsAt && now >= s.startsAt - 1000) {
      E.startGame(s, now);
      this.meta.nextCutoff = E.nextCutoff(s.settings, now + 1000);
      await this.announceStart();
    } else if (s.status === 'running' && this.meta.nextCutoff && now >= this.meta.nextCutoff - 1000) {
      E.advanceDay(s);
      this.meta.nextCutoff = E.nextCutoff(s.settings, now + 1000);
      if (this.announcing()) {
        const left = s.order.filter((id) => !s.players[id].finished).length;
        const content = `**Day ${s.day - 1} is done!** ${left} still trying to escape. Day ${s.day} starts now.` + (this.page() ? `\n${this.page()}` : '');
        await fetch(this.webhook(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
      }
    }
    await this.remind(now);
    for (const pid of s.status === 'running' ? s.order.slice(0, 60) : []) {
      const p = s.players[pid];
      if (p.tasks.length && p.blId && !p.finished) { try { await this.check(pid); } catch { /* try again next sweep */ } }
    }
    await this.save();
  }
}
