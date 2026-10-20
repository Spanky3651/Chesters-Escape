/*
 * Chester's Escape - which clan game the designer is working for.
 * Uses the same sign-in as the game. Resolves to { clan, clans, theme, family } or null
 * (not signed in, server down, or the practice copy), in which case every theme is offered.
 */
(function (root) {
  'use strict';
  var C = root.CGContent;
  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  var api = ((root.CGConfig && root.CGConfig.api) || '').replace(/\/+$/, ''), token = get('cg.token'), want = get('cg.clan');
  var q = new URLSearchParams(location.search).get('clan');
  if (q) { want = q; try { localStorage.setItem('cg.clan', q); } catch (e) {} }

  root.CGDesignerClan = (!api || !token ? Promise.resolve(null) :
    fetch(api + '/api/config' + (want ? '?clan=' + encodeURIComponent(want) : ''), { headers: { authorization: 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg || !cfg.user || !cfg.clan) return null;
        var t = C.themes[cfg.theme];
        return { clan: cfg.clan, clans: cfg.clans || [], theme: t ? cfg.theme : null, family: (t && t.family) || 'chester', name: ((cfg.clans || []).filter(function (c) { return c.id === cfg.clan; })[0] || {}).name || cfg.clan };
      })
      .catch(function () { return null; }));

  // Themes the designer offers: the clan's own family, or all of them when there's no clan.
  root.CGDesignerThemes = function (info) {
    return Object.keys(C.themes).filter(function (k) { return !info || (C.themes[k].family || 'chester') === info.family; });
  };

  // The clan switcher in the header (same look as the game's), for people in more than one server.
  root.CGDesignerClan.then(function (info) {
    var el = document.getElementById('clanSwitch');
    if (!el || !info || info.clans.length < 2) return;
    el.hidden = false;
    el.innerHTML = info.clans.map(function (c) {
      var on = c.id === info.clan, letters = String(c.name || '?').slice(0, 1).toUpperCase();
      return '<button type="button" class="clan-btn" data-clan="' + c.id + '" aria-pressed="' + on + '" title="' + (on ? 'Designing for ' : 'Switch to ') + c.name + '">' +
        (c.icon ? '<img class="clan-ic" src="' + c.icon + '" alt="" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="clan-ic" hidden>' + letters + '</span>' : '<span class="clan-ic">' + letters + '</span>') +
        '<span class="nm">' + c.name + '</span></button>';
    }).join('');
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-clan]'); if (!b || b.dataset.clan === info.clan) return;
      try { localStorage.setItem('cg.clan', b.dataset.clan); } catch (x) {}
      location.reload();
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
