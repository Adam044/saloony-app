const CACHE_NAME = 'saloony-cache-v5';
const APP_VERSION = '1.0.5'; // Update this with each deployment
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
  // Skip waiting to activate immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  // Claim all clients immediately
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k)))),
      self.clients.claim()
    ])
  );
  
  // Notify all clients about the update
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: 'SW_UPDATED',
          version: APP_VERSION
        });
      });
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip service worker for Socket.IO requests entirely
  if (url.pathname.startsWith('/socket.io/')) {
    return; // Let the browser handle Socket.IO requests directly
  }

  // Network-only for API requests to avoid caching dynamic data
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Stale-while-revalidate for static assets and pages (GET only)
  if (req.method === 'GET') {
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
  }
});

// Placeholder push event
self.addEventListener('push', (event) => {
  let payload = { title: 'Saloony', body: 'لديك إشعار جديد', url: '/home_salon.html' };
  try {
    if (event.data) {
      // Support both JSON and plain text payloads
      try { payload = event.data.json(); }
      catch { payload = { title: 'Saloony', body: event.data.text(), url: '/home_salon.html' }; }
    }
  } catch (e) {}

  const targetUrl = payload.url || '/home_salon.html';
  const options = {
    body: payload.body || 'لديك إشعار جديد',
    icon: '/images/Saloony-app_icon.png',
    badge: '/images/Saloony-app_icon.png',
    data: { url: targetUrl },
    lang: 'ar',
    dir: 'rtl',
    tag: payload.tag || 'saloony',
    renotify: true,
    requireInteraction: false,
    timestamp: Date.now()
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'Saloony', options));
});

// Handle notification click to focus app or open relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/home_salon.html';
  const absoluteTarget = new URL(targetUrl, location.origin);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === absoluteTarget.pathname) {
          client.focus();
          return;
        }
      }
      return clients.openWindow(absoluteTarget.href);
    })
  );
});

// Listen to messages from pages to show notifications (SSE bridge)
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  
  // Handle update check requests
  if (msg.type === 'CHECK_UPDATE') {
    event.ports[0].postMessage({
      type: 'UPDATE_STATUS',
      hasUpdate: false,
      version: APP_VERSION
    });
    return;
  }
  
  // Handle skip waiting requests
  if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  
  // Handle notification requests
  if (msg.type === 'saloony-notify') {
    const title = msg.title || 'Saloony';
    const body = msg.body || 'لديك إشعار جديد';
    const targetUrl = msg.url || '/home_salon.html';
    const options = {
      body,
      icon: '/images/Saloony-app_icon.png',
      badge: '/images/Saloony-app_icon.png',
      data: { url: targetUrl },
      lang: 'ar',
      dir: 'rtl',
      tag: msg.tag || 'saloony',
      renotify: true,
      requireInteraction: false,
      timestamp: Date.now()
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});
