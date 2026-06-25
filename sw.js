/* REPO PRINT · Service Worker — app del técnico offline.
   Solo cachea el shell del técnico; el resto (panel admin, API Supabase) pasa a red. */
const CACHE = 'repoprint-v4';
const SHELL = [
  'tecnico.html', 'css/tecnico.css', 'js/tecnico.js', 'js/config.js',
  'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png',
  'manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { mode: u.startsWith('http') ? 'no-cors' : 'same-origin' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('supabase.co')) return; // API: siempre red
  // Solo servir desde caché lo que está en el shell del técnico; el resto a red.
  e.respondWith(caches.match(e.request).then((cached) => cached || fetch(e.request)));
});
