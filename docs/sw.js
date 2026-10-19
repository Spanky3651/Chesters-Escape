// Chester's Escape service worker. It only shows host notifications; it does not cache the site.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || "Chester's Escape", {
    body: d.body || '',
    tag: d.tag || 'chester',
    renotify: true,
    icon: 'img/icon-192.png',
    badge: 'img/badge.png',
    data: { url: d.url || self.registration.scope + '#host' }
  }));
});

// Tapping a notification opens Host tools, reusing an open game tab when there is one.
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope + '#host';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0) { list[i].postMessage({ type: 'open-host' }); return list[i].focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
