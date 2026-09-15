/**
 * Offline shell for Breathe.
 *
 * The filename must stay `service-worker.js`. The previous build registered
 * that exact path with a cache-first strategy and no revalidation, so renaming
 * it would leave the old worker installed and serving the old app from cache
 * indefinitely. Keeping the name lets the browser byte-compare the script,
 * install this one, and drop every old cache on activate.
 *
 * Strategy:
 *   navigations   network-first, falling back to the cached shell
 *   shell assets  cache-first, revalidated in the background
 *   everything else  left alone
 */

const VERSION = 'v1.13.0';
const CACHE = `breathe-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/main.js',
  './src/dom.js',
  './src/engine.js',
  './src/exercises.js',
  './src/storage.js',
  './src/audio.js',
  './src/haptics.js',
  './src/wakelock.js',
  './src/voice.js',
  './src/ui/ring.js',
  './src/ui/controls.js',
  './src/ui/sheet.js',
  './src/ui/home.js',
  './src/ui/session.js',
  './src/ui/complete.js',
  './src/ui/settings.js',
  './src/ui/history.js',
  './icons/icon-192x192.PNG',
  './icons/icon-512x512.PNG'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individually, so one bad entry cannot fail the whole install.
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn('[sw] could not precache', url, err))
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigateStrategy(request));
    return;
  }

  event.respondWith(assetStrategy(request));
});

/**
 * Network first so a new build is picked up as soon as there is a connection,
 * with the cached shell as the offline answer.
 */
async function navigateStrategy(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('./index.html', response.clone());
    return response;
  } catch (e) {
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    return cached || offlineResponse();
  }
}

/** Cache first — instant — while quietly refreshing the copy for next time. */
async function assetStrategy(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  return response || offlineResponse();
}

function offlineResponse() {
  return new Response('Offline', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain' }
  });
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
