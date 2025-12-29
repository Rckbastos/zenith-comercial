const CACHE_NAME = 'zenith-comercial-v5';
const urlsToCache = [
  'index.html',
  'zenith-admin-completo.html',
  'zenith-gerente-completo.html',
  'pwa.js',
  'zenith-logo.png',
  'manifest.json'
];

// Instalação do Service Worker
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    console.log('Cache aberto');
    await Promise.all(
      urlsToCache.map(async (url) => {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('Falha ao adicionar ao cache (ignorado):', url, err);
        }
      })
    );
  })());
});

// Ativação do Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Interceptar requisições
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora esquemas não http(s) (ex.: chrome-extension) para evitar erros
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Navegação: deixa seguir direto para evitar problemas de redirect/SPA
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html'))
    );
    return;
  }

  // Somente GET e mesma origem
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' || networkResponse.redirected) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, responseToCache))
          .catch(err => console.warn('Cache put falhou:', err));

        return networkResponse;
      }).catch(() => caches.match(request));
    })
  );
});

// Notificações Push (opcional)
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'Nova atualização disponível',
    icon: '/zenith-logo.png',
    badge: '/zenith-logo.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };
  
  event.waitUntil(
    self.registration.showNotification('Zenith Comercial', options)
  );
});

// Clique na notificação
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/zenith-admin-completo.html')
  );
});
