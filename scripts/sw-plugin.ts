// Vite plugin: genera dist/sw.js (service worker) con la lista de assets precacheados.
// Offline-first para el estudio: el emulador de chips corre 100 % en el navegador.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const IGNORE = new Set(['sw.js', '_headers', '_redirects'])

function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, base, out)
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

const TEMPLATE = (version: string, files: string[]) => `/* TZOOTZ MEGADRIVE STUDIO — service worker (generado en build) */
const CACHE = 'tz-megadrive-${version}';
const PRECACHE = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('tz-megadrive-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegación: red primero (versión nueva), caché si estamos offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/'))),
    );
    return;
  }

  // Assets: caché primero (están hasheados → inmutables).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`

export function swPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'tz-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = path.resolve(cfg.root, cfg.build.outDir)
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return
      const files = walk(outDir)
        .filter((f) => !IGNORE.has(f) && !f.endsWith('.map'))
        .map((f) => '/' + f)
        .sort()
      // '/' también se sirve con index.html
      const list = ['/', ...files]
      const hash = crypto.createHash('sha1')
      for (const f of files) {
        hash.update(f)
        hash.update(fs.readFileSync(path.join(outDir, f.slice(1))))
      }
      const version = hash.digest('hex').slice(0, 10)
      fs.writeFileSync(path.join(outDir, 'sw.js'), TEMPLATE(version, list))
    },
  }
}
