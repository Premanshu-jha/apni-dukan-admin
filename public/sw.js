// Service worker: shows a small "You're offline" page when the app is opened without a connection. Nothing else is
// cached: the team always works on live data.
// A new version of this file installs and then waits: the app shows "New version available — Reload", and only that
// button switches over (never in the middle of a decision).

// Change the name when offline.html, offline.css or the icon change, so a new version stores them again
const OFFLINE_CACHE = 'offline-v1'
const OFFLINE_PAGE = '/offline.html'
const OFFLINE_FILES = [OFFLINE_PAGE, '/offline.css', '/icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) => cache.addAll(OFFLINE_FILES.map((f) => new Request(f, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n)))),
      // Pages load while the worker starts up, not after it
      self.registration.navigationPreload ? self.registration.navigationPreload.enable() : null,
      self.clients.claim(),
    ]),
  )
})

// The app's "Reload" button: this waiting version takes over
self.addEventListener('message', (event) => {
  if (event.data && event.data.kind === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Opening a page: the network as always; without a connection, the offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return (await event.preloadResponse) || (await fetch(request))
        } catch {
          return (await caches.match(OFFLINE_PAGE, { cacheName: OFFLINE_CACHE })) || Response.error()
        }
      })(),
    )
    return
  }
  // The offline page's own CSS and icon; everything else (the app, the API) goes to the network untouched
  const url = new URL(request.url)
  if (url.origin === self.location.origin && OFFLINE_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname, { cacheName: OFFLINE_CACHE })))
  }
})
