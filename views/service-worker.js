const CACHE_NAME = 'saloony-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/auth.html',
  '/home_user.html',
  '/home_salon.html',
  '/images/Saloony-app_icon.png',
  '/images/Saloony_logo.png',
  '/images/auth.jpg'
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
  const data = event.data ? event.data.json() : { title: 'Saloony', body: 'لديك إشعار جديد' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/images/Saloony-app_icon.png',
      badge: '/images/Saloony-app_icon.png'
    })
  );
});
