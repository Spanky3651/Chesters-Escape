/*
 * Chester's Escape - game server (Cloudflare Worker + one Durable Object per game).
 *
 * The page lives on GitHub Pages; this Worker holds the shared game state.
 *   - Discord sign-in (so a roll can only be made by its own player)
 *   - rolls on the server with crypto randomness
 *   - BeatLeader checks on the server (no relay needed here)
 *   - the day turns over by itself at the cutoff, and open maps get re-checked every 15 minutes
 *   - the host can post the results image to the game channel through a Discord webhook
 *
 * The rules are the exact same engine the page uses (docs/js/engine.js).
 */
import { DurableObject } from 'cloudflare:workers';
import '../../docs/js/content.js';
import '../../docs/js/engine.js';

const E = globalThis.CGEngine;
const C = globalThis.CGContent;
const GAME_ID = 'main';
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
function hosts(env) { return String(env.HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean); }
function rng() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }

async function userFrom(env, req) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const u = await verify(env, tok);
  if (!u) return null;
  return { ...u, isHost: hosts(env).includes(u.id) };
}

function gameStub(env) { return env.GAME.get(env.GAME.idFromName(GAME_ID)); }

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
    scope: env.GUILD_ID ? 'identify guilds' : 'identify', state, prompt: 'none'
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
  if (env.GUILD_ID) {
    const guilds = await fetch('https://discord.com/api/users/@me/guilds', { headers: auth }).then((r) => r.json());
    if (!Array.isArray(guilds) || !guilds.some((g) => g.id === env.GUILD_ID)) return new Response('This game is for members of the clan Discord server.', { status: 403 });
  }
  const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : '';
  const session = await sign(env, { id: me.id, name: me.global_name || me.username, avatar, exp: Date.now() + 60 * 24 * 3600 * 1000 });
  return Response.redirect(st.r + '#token=' + encodeURIComponent(session), 302);
}

// ---------------------------------------------------------------------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env, req) });
    try {
      if (url.pathname === '/auth/login') return authLogin(env, req, url);
      if (url.pathname === '/auth/callback') return authCallback(env, req, url);
      if (url.pathname === '/dev/login' && env.DEV_LOGIN === '1') {
        // Local testing only: wrangler dev --var DEV_LOGIN:1
        const id = url.searchParams.get('id') || 'dev'; const name = url.searchParams.get('name') || 'Dev player';
        return json(env, req, { token: await sign(env, { id, name, avatar: '', exp: Date.now() + 86400000 }) });
      }
      if (!url.pathname.startsWith('/api/')) return new Response("Chester's Escape game server. The game itself is on the game page.", { status: 200 });

      const user = await userFrom(env, req);
      if (url.pathname === '/api/config') {
        const r = await gameStub(env).whoAmI(user);
        return json(env, req, { live: true, access: r.access, user: user && { id: user.id, name: user.name, avatar: user.avatar }, isHost: !!(user && user.isHost), pid: r.pid });
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const r = await gameStub(env).getState(user, Number(url.searchParams.get('since') ?? -1));
        return json(env, req, r, r.error ? 403 : 200);
      }
      if (url.pathname === '/api/act' && req.method === 'POST') {
        if (!user) return json(env, req, { error: 'Sign in with Discord first.', code: 'auth' }, 401);
        const body = await req.json().catch(() => ({}));
        const r = await gameStub(env).act(user, String(body.action || ''), body.args || {});
        if (r.error && r.code === 'no-access') r.status = 403;
        return json(env, req, r, r.error ? (r.status || 400) : 200);
      }
      if (url.pathname === '/api/host/results' && req.method === 'POST') {
        if (!user || !user.isHost) return json(env, req, { error: 'Only the host can post results.' }, 403);
        if (!env.DISCORD_WEBHOOK_URL) return json(env, req, { error: 'No Discord webhook is set up on the server yet.' }, 400);
        const form = await req.formData();
        const out = new FormData();
        out.append('payload_json', JSON.stringify({ content: String(form.get('text') || ''), allowed_mentions: { parse: [] } }));
        out.append('files[0]', form.get('file'), 'results.png');
        const r = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', body: out });
        if (!r.ok) return json(env, req, { error: 'Discord did not accept the post (' + r.status + ').' }, 502);
        return json(env, req, { ok: true });
      }
      return json(env, req, { error: 'Not found' }, 404);
    } catch (e) {
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
      this.meta = (await ctx.storage.get('meta')) || {};
    });
  }

  game() {
    if (!this.state) {
      const themeId = this.env.THEME || 'cemetery';
      this.state = E.createGame({ board: C.boards['chester-escape'](), cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, rng });
      this.meta = Object.assign(this.meta || {}, { nextCutoff: E.nextCutoff(this.state.settings) });
    }
    return this.state;
  }

  // Who can play. 'testers' (default): only the host and people the host lets in.
  // 'open': anyone who signs in (GUILD_ID still limits sign-in to the clan server).
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
    const want = Math.min(this.meta.nextCutoff || Date.now() + CHECK_EVERY, Date.now() + CHECK_EVERY);
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > want) await this.ctx.storage.setAlarm(want);
  }
  pidFor(user) { return user ? 'd' + user.id : null; }

  async whoAmI(user) {
    const s = this.game(); const pid = this.pidFor(user);
    const status = this.accessFor(user);
    if (status === 'pending') {
      // Put them on the host's waiting list (once).
      const a = this.access();
      if (!a.pending.some((x) => x.id === user.id)) {
        a.pending.push({ id: user.id, name: String(user.name || '').slice(0, 60), avatar: user.avatar || '', at: Date.now() });
        if (a.pending.length > 100) a.pending.shift();
        s.seq++;
        await this.save();
      }
    }
    return { pid: status === 'ok' && pid && s.players[pid] ? pid : null, access: status };
  }

  async getState(user, since) {
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
    const s = this.game(); const pid = this.pidFor(user);
    if (!this.canUse(user)) return { error: 'This game is invite-only right now.', code: 'no-access' };
    const hostOnly = ['advance', 'approve', 'reject', 'setpos', 'card', 'resetPlayer', 'removePlayer', 'clearRoute', 'settings', 'theme', 'newGame', 'accessMode', 'letIn', 'dismiss', 'removeAccess'];
    if (hostOnly.includes(action) && !user.isHost) return { error: 'Only the host can do that.', status: 403 };
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
        case 'claim': this.mine(s, pid); result = E.claimTask(s, pid, a.task, { url: String(a.url || '').slice(0, 300) }); break;
        // host
        case 'advance': E.advanceDay(s); this.meta.nextCutoff = E.nextCutoff(s.settings); result = { day: s.day }; break;
        case 'approve': result = E.completeTask(s, a.pid, a.task, { by: 'host' }); break;
        case 'reject': E.rejectClaim(s, a.pid, a.task); break;
        case 'setpos': E.setPosition(s, a.pid, Number(a.pos), { apply: !!a.apply }); break;
        case 'card': E.hostCard(s, a.pid, a.card); break;
        case 'resetPlayer': E.resetPlayer(s, a.pid); break;
        case 'removePlayer': E.removePlayer(s, a.pid); break;
        case 'clearRoute': { const p = s.players[a.pid]; p.route = null; p.pos = -1; p.tasks = []; break; }
        case 'settings': {
          const allowed = ['exactFinish', 'chainEffects', 'oneRollPerDay', 'cutoffHour', 'cutoffMinute', 'timeZone'];
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
          this.state = E.createGame({ board, cards: C.cardsFor(themeId), themeId, title: C.themes[themeId].title, settings: s.settings, rng });
          keep.forEach((p) => E.addPlayer(this.state, { id: p.id, discordId: p.discordId, name: p.name, avatar: p.avatar, blId: p.blId }));
          this.meta.nextCutoff = E.nextCutoff(this.state.settings);
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
    await this.save();
    const out = { result, state: E.publicState(this.state), me: this.state.players[pid] ? pid : null, canPlay: true };
    if (user.isHost) out.access = this.access();
    return out;
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
  async alarm() {
    const s = this.game();
    const now = Date.now();
    if (this.meta.nextCutoff && now >= this.meta.nextCutoff - 1000) {
      E.advanceDay(s);
      this.meta.nextCutoff = E.nextCutoff(s.settings, now + 1000);
      if (this.env.DISCORD_WEBHOOK_URL && this.env.ANNOUNCE_DAYS === '1') {
        const left = s.order.filter((id) => !s.players[id].finished).length;
        const content = `**Day ${s.day - 1} is done!** ${left} still trying to escape. Day ${s.day} starts now.` + (this.env.GAME_PAGE ? `\n${this.env.GAME_PAGE}` : '');
        await fetch(this.env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
      }
    }
    for (const pid of s.order.slice(0, 60)) {
      const p = s.players[pid];
      if (p.tasks.length && p.blId && !p.finished) { try { await this.check(pid); } catch { /* try again next sweep */ } }
    }
    await this.save();
  }
}
