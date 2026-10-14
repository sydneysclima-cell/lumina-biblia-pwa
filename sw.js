/* ==========================================================================
   Lumina Bíblia - Service Worker
   Estratégias:
     • Navegação  -> rede primeiro, cai em cache / offline.html quando offline
     • Estáticos  -> cache primeiro + atualização em segundo plano (SWR)
     • Fontes     -> cache primeiro (são imutáveis)
     • API Bíblia -> stale-while-revalidate (último capítulo lido fica offline)
   ========================================================================== */

const VERSION = 'v1.1.0';
const CACHE_CORE = `lumina-core-${VERSION}`;
const CACHE_RUNTIME = `lumina-runtime-${VERSION}`;
const CACHE_API = `lumina-api-${VERSION}`;
const CACHES_TO_KEEP = [CACHE_CORE, CACHE_RUNTIME, CACHE_API];

// Arquivos essenciais: ficam garantidos para o app abrir sem internet.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './assets/ui.css',
  './assets/books.js',
  './assets/content.js',
  './assets/app.js',
  './assets/offline-texts.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.svg',
];

// Assets de CDN pré-baixados para o app continuar bonito offline.
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700;800&display=swap',
];

// Hostes de API de Bíblia usadas pelo app (cache off-line dos capítulos).
const API_HOSTS = ['bible-api.com', 'www.bible-api.com', 'api.bible', 'bible-api.net'];
const API_MAX_AGE = 1000 * 60 * 60 * 24 * 30; // revalida depois de 30 dias
const RUNTIME_MAX_ENTRIES = 80;

const isSameOrigin = (url) => url.origin === self.location.origin;
const isAssetLike = (url, request) =>
  request.destination === 'style' ||
  request.destination === 'script' ||
  request.destination === 'worker' ||
  request.destination === 'image' ||
  request.destination === 'font' ||
  /\.(?:css|js|mjs|png|jpe?g|webp|avif|svg|gif|ico|woff2?|ttf|otf|json|webmanifest)$/i.test(url.pathname);

/* ---------------------------------------------------------------- install */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_CORE);
      // allSettled: um arquivo ausente não derruba a instalação do PWA.
      await Promise.allSettled(
        [...CORE_ASSETS, ...CDN_ASSETS].map(async (url) => {
          const req = new Request(url, { cache: 'reload' });
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
        })
      );
      // Aplica a nova versão assim que instala (a página avisa e recarrega).
      return self.skipWaiting();
    })()
  );
});

/* -------------------------------------------------------------- activate */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !CACHES_TO_KEEP.includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------ fetch */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // nunca cachear POST/PUT (ex.: salvar conto)

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // 1) Navegation: rede -> cache -> offline.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_CORE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = (await caches.match('./index.html')) || (await caches.match('./'));
          if (cached) return cached;
          const offline = await caches.match('./offline.html');
          return (
            offline ||
            new Response('Modo offline: abra o app uma vez com internet para habilitar o cache.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  // 2) Fontes do Google / webfonts: cache primeiro (imutáveis)
  if (
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    /\/webfonts\//.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, CACHE_RUNTIME));
    return;
  }

  // 3) API de Bíblia: stale-while-revalidate
  if (API_HOSTS.includes(url.hostname) || /\/api\//.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_API, API_MAX_AGE));
    return;
  }

  // 4) Estáticos (próprios e de CDN): SWR
  if (isAssetLike(url, request) || isSameOrigin(url)) {
    event.respondWith(staleWhileRevalidate(request, CACHE_RUNTIME));
    return;
  }
});

/* ------------------------------------------------------------- helpers */
async function cacheFirst(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) putInCache(cacheName, request, res.clone());
    return res;
  } catch {
    return offlineFallback(request);
  }
}

async function staleWhileRevalidate(request, cacheName, maxAge = 0) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const isStale =
    maxAge > 0 && hit ? Date.now() - Number(hit.headers.get('sw-cached-at') || 0) > maxAge : !hit;

  const network = fetch(request)
    .then(async (res) => {
      if (!res) return null;
      if (res.ok) {
        // resposta "boa": guarda com carimbo de data para controlar a validade
        const body = await res.clone().blob();
        const headers = new Headers(res.headers);
        headers.set('sw-cached-at', String(Date.now()));
        await cache.put(request, new Response(body, { status: res.status, headers }));
        trimCache(cache, RUNTIME_MAX_ENTRIES);
      } else if (res.type === 'opaque') {
        // cross-origin sem CORS: não dá para ler status/headers, cacheia como está
        await cache.put(request, res.clone());
      }
      return res;
    })
    .catch(() => null);

  if (hit && !isStale) return hit;      // fresco: responde na hora
  const fresh = await network;          // velho: serve o cache e atualiza
  return fresh || hit || offlineFallback(request);
}

async function putInCache(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  await trimCache(cache, RUNTIME_MAX_ENTRIES);
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await cache.delete(keys[0]);
  return trimCache(cache, maxEntries);
}

function offlineFallback(request) {
  if (request.destination === 'image' || /\.(png|jpe?g|webp|svg|gif|ico)$/i.test(request.url)) {
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23090d16"/></svg>'.replace(
        '%23',
        '#'
      ),
      { headers: { 'Content-Type': 'image/svg+xml' } }
    );
  }
  return new Response('', { status: 503, statusText: 'offline' });
}

/* --------------------------------------- permite "atualizar agora" na UI */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
