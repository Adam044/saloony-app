const CACHE_NAME = 'saloony-cache-v3';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/home_user.html',
  '/home_salon.html',
  '/splash.html',
  '/images/Saloony-app_icon.png',
  '/images/Saloony_logo.png',
  '/images/auth.jpg',
  '/sounds/salon_notifications.wav'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ensure root or index navigations go to splash to avoid index flash
  if (req.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(
        caches.match('/splash.html').then((cached) => {
          return cached || fetch('/splash.html');
        })
      );
      return;
    }
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        const copy = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return networkRes;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Placeholder push event
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Saloony', body: 'لديك إشعار جديد', url: '/home_salon.html' };
  const notificationData = { url: data.url || '/home_salon.html' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/images/Saloony-app_icon.png',
      badge: '/images/Saloony-app_icon.png',
      data: notificationData
    })
  );
});

// Handle notification click to focus app or open relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/home_salon.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const url = new URL(client.url);
        if (url.pathname === targetUrl.replace(location.origin, '')) {
          client.focus();
          return;
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// Listen to messages from pages to show notifications (SSE bridge)
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'saloony-notify') {
    const title = msg.title || 'Saloony';
    const body = msg.body || 'لديك إشعار جديد';
    const data = { url: msg.url || '/home_salon.html' };
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/images/Saloony-app_icon.png',
        badge: '/images/Saloony-app_icon.png',
        data
      })
    );
  }
});
