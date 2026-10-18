/*
 * Chester's Escape - BeatSaver and BeatLeader lookups (browser).
 * BeatLeader sends no CORS headers, so its calls go through MSploit's relay
 * Worker (the same one Playlist Studio uses). BeatSaver allows browser calls.
 */
(function (root) {
  'use strict';
  var RELAY = 'https://playlist-replay.msploit.workers.dev/?url=';
  var BL = 'https://api.beatleader.xyz';
  var BS = 'https://api.beatsaver.com';
  var mem = {};

  function timeout(ms) { var c = new AbortController(); setTimeout(function () { c.abort(); }, ms); return c.signal; }
  function getJson(url, ms) {
    return fetch(url, { signal: timeout(ms || 12000) }).then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } return r.json(); });
  }
  function viaRelay(url, ms) { return getJson(RELAY + encodeURIComponent(url), ms); }
  function blGet(path) { return viaRelay(BL + path).catch(function (e) { if (e.status === 404) throw e; return getJson(BL + path, 8000); }); }

  function cacheGet(k) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v; } catch (e) { return null; } }
  function cacheSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---- BeatSaver --------------------------------------------------------------
  function map(key) {
    key = String(key || '').toLowerCase().replace(/^!bsr\s*/, '').trim();
    if (!key) return Promise.reject(new Error('No map key'));
    if (mem[key]) return mem[key];
    var cached = cacheGet('cg.bs.' + key);
    if (cached && cached.hash) return (mem[key] = Promise.resolve(cached));
    mem[key] = getJson(BS + '/maps/id/' + key).catch(function () { return viaRelay(BS + '/maps/id/' + key); }).then(function (j) {
      var v = (j.versions || [])[0] || {};
      var m = {
        key: key, hash: String(v.hash || '').toUpperCase(),
        name: (j.metadata && j.metadata.songName) || j.name || key,
        sub: (j.metadata && j.metadata.songSubName) || '',
        author: (j.metadata && j.metadata.songAuthorName) || '',
        mapper: (j.metadata && j.metadata.levelAuthorName) || (j.uploader && j.uploader.name) || '',
        cover: v.coverURL || ('https://eu.cdn.beatsaver.com/' + String(v.hash || '').toLowerCase() + '.jpg'),
        preview: v.previewURL || '',
        duration: (j.metadata && j.metadata.duration) || 0,
        bpm: (j.metadata && j.metadata.bpm) || 0,
        diffs: (v.diffs || []).map(function (d) { return { name: d.difficulty, characteristic: d.characteristic, nps: d.nps, stars: d.stars || null }; })
      };
      cacheSet('cg.bs.' + key, m);
      return m;
    });
    mem[key].catch(function () { delete mem[key]; });
    return mem[key];
  }

  // ---- BeatLeader ---------------------------------------------------------------
  // Accepts a profile link, a BeatLeader/ScoreSaber/Steam/Quest id.
  function parsePlayer(input) {
    var s = String(input || '').trim();
    var m = s.match(/beatleader\.(?:com|xyz)\/u\/([^/?#]+)/i) || s.match(/scoresaber\.com\/u\/(\d+)/i) || s.match(/accsaber\.com\/players\/(\d+)/i);
    if (m) return decodeURIComponent(m[1]);
    return s.replace(/[^A-Za-z0-9_-]/g, '');
  }
  function player(input) {
    var id = parsePlayer(input);
    if (!id) return Promise.reject(new Error('Enter your BeatLeader profile link or ID.'));
    return blGet('/player/' + encodeURIComponent(id)).then(function (p) {
      if (!p || !p.id) throw new Error('No BeatLeader player found for that ID.');
      return { id: String(p.id), name: p.name, avatar: p.avatar || '', country: p.country || '', rank: p.rank || 0, pp: p.pp || 0 };
    }, function (e) { if (e.status === 404) throw new Error('No BeatLeader player found for that ID.'); throw new Error("Couldn't reach BeatLeader. Try again in a moment."); });
  }
  // Recent scores, newest first, flattened to what the engine needs.
  function recentScores(blId, count) {
    return blGet('/player/' + encodeURIComponent(blId) + '/scores?sortBy=date&order=desc&count=' + (count || 40)).then(function (j) {
      return (j.data || []).map(function (s) {
        var lb = s.leaderboard || {}, song = lb.song || {}, d = lb.difficulty || {};
        return { id: s.id, hash: String(song.hash || '').toUpperCase(), time: parseInt(s.timeset, 10) || s.timepost || 0, diff: d.difficultyName || '', mode: d.modeName || '', acc: s.accuracy || 0, mods: s.modifiers || '', fc: !!s.fullCombo, name: song.name || '' };
      });
    });
  }

  // Look up the hashes for every key on a player's open tasks, then check their recent scores.
  function checkTasks(E, state, pid) {
    var p = state.players[pid];
    if (!p || !p.tasks.length) return Promise.resolve({ cleared: [], checked: 0 });
    if (!p.blId) return Promise.reject(new Error('Link your BeatLeader profile first.'));
    var keys = []; p.tasks.forEach(function (t) { (t.bsr || []).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    return Promise.all(keys.map(function (k) { return map(k).then(function (m) { return [k, m.hash]; }, function () { return [k, '']; }); })).then(function (pairs) {
      var hashes = {}; pairs.forEach(function (x) { hashes[String(x[0]).toLowerCase()] = x[1]; });
      return recentScores(p.blId, 50).then(function (scores) {
        return { cleared: E.matchScores(state, pid, scores, hashes), checked: scores.length };
      });
    });
  }

  function replayUrl(scoreId) { return 'https://replay.beatleader.com/?scoreId=' + encodeURIComponent(scoreId); }

  // .bplist with every board map. difficulties lists each Standard difficulty so any choice is highlighted.
  function playlist(title, keys, image) {
    return Promise.all(keys.map(function (k) { return map(k).catch(function () { return null; }); })).then(function (maps) {
      return {
        playlistTitle: title, playlistAuthor: 'GENX', image: image || '',
        songs: maps.filter(Boolean).map(function (m) {
          var diffs = m.diffs.filter(function (d) { return d.characteristic === 'Standard'; });
          if (!diffs.length) diffs = m.diffs;
          return { key: m.key, hash: m.hash.toLowerCase(), songName: m.name, levelAuthorName: m.mapper,
            difficulties: diffs.map(function (d) { return { characteristic: d.characteristic, name: d.name }; }) };
        })
      };
    });
  }

  root.CGServices = { map: map, player: player, parsePlayer: parsePlayer, recentScores: recentScores, checkTasks: checkTasks, replayUrl: replayUrl, playlist: playlist, RELAY: RELAY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
