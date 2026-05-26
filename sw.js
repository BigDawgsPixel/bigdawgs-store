const CACHE_NAME = 'bigdawgs-store-v2';
const OFFLINE_URL = '/';

const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/sw.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

// ─── Activate ──────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch (Cache-first with network fallback) ─────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    }).catch(() => caches.match(OFFLINE_URL))
  );
});

// ─── Push Notifications ────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "🔥 Hot Deal Alert — BigDawg's Store";
  const options = {
    body: data.body || "A new trending product just dropped! Tap to see today's hottest deals.",
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    image: data.image || '/icons/icon-512.png',
    vibrate: [200, 100, 200],
    tag: 'bigdawgs-deal',
    renotify: true,
    requireInteraction: false,
    actions: [
      { action: 'shop', title: '🛍️ Shop Now' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    data: {
      url: data.url || 'https://bigdawgs-store.vercel.app',
      dateOfArrival: Date.now()
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification Click ────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'https://bigdawgs-store.vercel.app';
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ─── Background Sync ───────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-deals') {
    event.waitUntil(syncLatestDeals());
  }
  if (event.tag === 'sync-wishlist') {
    event.waitUntil(syncWishlist());
  }
});

async function syncLatestDeals() {
  try {
    const response = await fetch('https://bigdawgs-store.vercel.app/');
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('/', response);
    }
  } catch (e) {
    console.log('Background sync failed, will retry:', e);
  }
}

async function syncWishlist() {
  try {
    const db = await openDB();
    const pendingItems = await getPendingWishlistItems(db);
    if (pendingItems.length > 0) {
      console.log('Syncing wishlist items:', pendingItems.length);
    }
  } catch (e) {
    console.log('Wishlist sync failed:', e);
  }
}

// ─── Periodic Background Sync ──────────────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'daily-deals-refresh') {
    event.waitUntil(syncLatestDeals());
  }
});

// ─── Message Handler ───────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'REQUEST_SYNC') {
    self.registration.sync.register('sync-deals').catch(console.error);
  }
});

// ─── Helper stubs ─────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bigdawgs-store', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = e => {
      e.target.result.createObjectStore('wishlist', { keyPath: 'id' });
    };
  });
}

function getPendingWishlistItems(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wishlist', 'readonly');
    const store = tx.objectStore('wishlist');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
