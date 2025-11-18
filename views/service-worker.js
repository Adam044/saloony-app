const CACHE_NAME = 'saloony-cache-v8';
const APP_VERSION = '1.0.9'; // Update this with each deployment
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/home_user.html',
  '/home_salon.html',
  '/splash.html',
  '/offline.html',
  '/outage.html',
  '/offline-detect.js',
  '/images/Saloony-app_icon.png',
  '/images/Saloony_logo.png',
  '/images/auth.jpg',
  '/Sounds/salon_notifications.wav'
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

  // Do not intercept cross-origin requests; let browser handle CSP and fetch
  if (url.origin !== location.origin) {
    return;
  }

  // Network-only for API requests to avoid caching dynamic data
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (!res.ok && res.status >= 500) {
            try {
              const clients = await self.clients.matchAll();
              clients.forEach((c) => c.postMessage({ type: 'OUTAGE' }));
            } catch (_) {}
          }
          return res;
        } catch (e) {
          try {
            const clients = await self.clients.matchAll();
            clients.forEach((c) => c.postMessage({ type: 'OUTAGE' }));
          } catch (_) {}
          return caches.match(req);
        }
      })()
    );
    return;
  }

  // Navigation requests: try network, handle server errors, then cache or offline/outage fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (!res.ok && res.status >= 500) {
            const outage = await caches.match('/outage.html');
            if (outage) return outage;
          }
          return res;
        } catch (e) {
          const cached = await caches.match(req);
          if (cached) return cached;
          const outage = await caches.match('/outage.html');
          if (outage) return outage;
          const offline = await caches.match('/offline.html');
          if (offline) return offline;
          return new Response(
            '<!doctype html><html lang="ar"><head><meta charset="utf-8"><title>غير متصل</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8fafc;color:#111827}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;box-shadow:0 10px 25px rgba(0,0,0,0.05)}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#6b7280}</style></head><body dir="rtl"><div class="card"><h1>أنت غير متصل</h1><p>يرجى الاتصال بالإنترنت ثم المحاولة.</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      })()
    );
    return;
  }

  // Stale-while-revalidate for static assets and pages (GET only)
  if (req.method === 'GET') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        try {
          const networkRes = await fetch(req);
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return networkRes;
        } catch (e) {
          if (cached) return cached;
          // Return a minimal fallback response to avoid TypeError in SW
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        }
      })()
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
    icon: payload.icon || '/images/Saloony-app_icon.png',
    badge: payload.badge || '/images/Saloony-app_icon.png',
    data: { url: targetUrl },
    lang: 'ar',
    dir: 'rtl',
    tag: payload.tag || 'saloony',
    renotify: true,
    requireInteraction: payload.requireInteraction === true,
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
