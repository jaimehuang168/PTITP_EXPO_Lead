(() => {
  'use strict';

  const version = '1.18.0';
  const base = new URL('./', self.location.href);
  const cachePrefix = 'ptitp-expo-offline:' + base.pathname + ':';
  const cacheName = cachePrefix + version;
  const versioned = name => new URL(name + '?v=' + version, base).href;
  const shell = versioned('index.html');
  const workerUrl = versioned('offline.js');
  const assets = new Map();

  for (const name of [
    'mobile.css', 'presentation.css', 'mobile-ui.js', 'google-session.js',
    'event-ui.js', 'presentation.js', 'pdf-sharing.js', 'offline.js'
  ]) {
    const url = versioned(name);
    assets.set(url, url);
  }
  for (const name of [
    'favicon.png', 'icon-192.png', 'icon-512.png', 'PTITP_LOGO.png',
    'qr_en.png', 'qr_es.png', 'qr_pt.png', 'qr_brochure.png',
    'mapa_satelital.jpg', 'plano_loteamiento.jpg', 'plano_loteamiento.pdf',
    'assets/presentation/pbw-2026.jpeg',
    'assets/presentation/tres-formas.jpeg',
    'assets/presentation/ubicacion-stand.jpeg',
    'assets/presentation/presentacion-parque.jpeg',
    'assets/presentation/visita-guiada.jpeg',
    'assets/presentation/consulta-empresas.jpeg',
    'assets/presentation/condiciones-alquiler.jpeg',
    'assets/pdfs/PTITP_Parque_Tecnologico_Inteligente_ES_1019.pdf',
    'assets/pdfs/PTITP_Parque_Tecnologico_Inteligente_PT-BR_1020.pdf'
  ]) {
    assets.set(new URL(name, base).href, versioned(name));
  }

  const files = [shell, ...assets.values()];
  const cached = url => caches.match(url, { cacheName });

  async function hasPackage() {
    const contents = await Promise.all(files.map(cached));
    if (!contents.every(Boolean)) return false;
    const html = await contents[0].text();
    return html.includes("const APP_VERSION = '" + version + "';");
  }

  async function openPage(request) {
    const saved = await cached(shell).catch(() => undefined);
    if (!saved) return fetch(request);
    if (!navigator.onLine) return saved;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(request, { signal: controller.signal });
      return response.ok ? response : saved;
    } catch {
      return saved;
    } finally {
      clearTimeout(timer);
    }
  }

  if (typeof document === 'undefined') {
    self.addEventListener('install', event => {
      event.waitUntil((async () => {
        if (!await hasPackage()) throw new Error('Incomplete offline package');
        await self.skipWaiting();
      })());
    });
    self.addEventListener('activate', event => {
      event.waitUntil(self.clients.claim());
    });
    self.addEventListener('fetch', event => {
      const request = event.request;
      if (request.method !== 'GET') return;
      const url = new URL(request.url);
      if (url.origin !== base.origin) return;
      if (request.mode === 'navigate' &&
          [base.pathname, base.pathname + 'index.html'].includes(url.pathname)) {
        event.respondWith(openPage(request));
        return;
      }
      const key = assets.get(url.href);
      if (key) event.respondWith(cached(key).catch(() => undefined).then(saved => saved || fetch(request)));
    });
    return;
  }

  const button = document.getElementById('offline-prepare');
  const status = document.getElementById('offline-status');
  if (!button || !status) return;
  if (!navigator.serviceWorker || !self.caches) {
    status.textContent = 'Para llevar los PDF, usá Descargar PDF en Materiales.';
    return;
  }

  const workers = navigator.serviceWorker;
  let preparing = false;
  const controlled = () => workers.controller?.scriptURL === workerUrl;

  function waitForControl(registration) {
    if (controlled()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const installing = registration.installing || registration.waiting;
      const timer = setTimeout(() => finish(new Error('Offline worker did not start')), 15000);
      function finish(error) {
        clearTimeout(timer);
        workers.removeEventListener('controllerchange', check);
        installing?.removeEventListener('statechange', check);
        if (error) reject(error);
        else resolve();
      }
      function check() {
        if (controlled()) finish();
        else if (installing?.state === 'redundant') finish(new Error('Offline worker failed'));
      }
      workers.addEventListener('controllerchange', check);
      installing?.addEventListener('statechange', check);
      check();
    });
  }

  function showReady(ready) {
    button.hidden = ready;
    status.textContent = ready
      ? 'Materiales listos para usar sin conexión.'
      : 'Descargá los PDF, las láminas y los mapas antes de salir (unos 7 MB).';
    self.dispatchEvent(new CustomEvent('ptitp-offline-package', { detail: { ready } }));
  }

  async function checkPackage() {
    try {
      const ready = controlled() && await hasPackage();
      if (!preparing) showReady(ready);
    } catch {
      if (!preparing) showReady(false);
    }
  }

  button.addEventListener('click', async () => {
    if (!navigator.onLine) {
      status.textContent = 'Conectate para preparar el uso sin conexión.';
      return;
    }

    preparing = true;
    button.disabled = true;
    status.textContent = 'Descargando materiales…';
    try {
      if (!await hasPackage()) {
        const cache = await caches.open(cacheName);
        await cache.addAll(files.map(url => new Request(url, { cache: 'reload', credentials: 'omit' })));
        if (!await hasPackage()) throw new Error('Incomplete offline package');
      }
      const registration = await workers.register(workerUrl, { updateViaCache: 'none' });
      await waitForControl(registration);
      showReady(true);

      // Remove only old packages for this app after the new package can open offline.
      const oldCaches = (await caches.keys().catch(() => [])).filter(key => key.startsWith(cachePrefix) && key !== cacheName);
      await Promise.allSettled(oldCaches.map(key => caches.delete(key)));
    } catch {
      status.textContent = 'La preparación quedó incompleta. Conectate y volvé a intentar.';
    } finally {
      preparing = false;
      button.disabled = false;
    }
  });

  workers.addEventListener('controllerchange', checkPackage);
  self.addEventListener('pageshow', checkPackage);
  checkPackage();
})();
