const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { JSDOM } = require('jsdom');

const base = 'https://example.test/PTITP_EXPO_Lead/';
const html = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('offline.js', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8')).v;
const pdfPaths = [...html.matchAll(/href="(assets\/pdfs\/[^"]+)"/g)]
  .map(match => match[1]).filter((name, index, names) => names.indexOf(name) === index);

async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail('Offline state did not finish');
}

function fixture(t, { missing = '', stale = false } = {}) {
  const { window: w } = new JSDOM(html, { url: base, runScripts: 'outside-only' });
  t.after(() => w.close());
  const storage = new Map();
  const handlers = new Map();
  const requests = [];
  const network = { online: true };
  let claimed = false;

  async function fetchFile(input) {
    if (!network.online) throw new TypeError('Offline');
    const url = new URL(typeof input === 'string' ? input : input.url);
    requests.push(url.href);
    const file = url.pathname.slice(new URL(base).pathname.length) || 'index.html';
    if (file === missing || !fs.existsSync(file)) return new Response('', { status: 404 });
    const data = stale && file === 'index.html'
      ? html.replace("const APP_VERSION = '" + version + "';", "const APP_VERSION = 'old';")
      : fs.readFileSync(file);
    return new Response(data);
  }

  w.caches = {
    async open(name) {
      if (!storage.has(name)) storage.set(name, new Map());
      return {
        async addAll(entries) {
          const data = await Promise.all(entries.map(async request => {
            assert.equal(request.credentials, 'omit');
            const response = await fetchFile(request);
            if (!response.ok) throw new Error('Missing resource');
            return [request.url, await response.arrayBuffer()];
          }));
          for (const [url, bytes] of data) storage.get(name).set(url, bytes);
        }
      };
    },
    async match(url, { cacheName }) {
      const bytes = storage.get(cacheName)?.get(url);
      return bytes && new Response(bytes);
    },
    async keys() { return [...storage.keys()]; },
    async delete(key) { return storage.delete(key); }
  };
  w.Request = Request;
  const workerApi = new w.EventTarget();
  workerApi.register = async url => {
    const worker = {
      location: { href: url },
      addEventListener: (name, fn) => handlers.set(name, fn),
      skipWaiting: async () => {},
      clients: { claim: async () => { claimed = true; } }
    };
    vm.runInNewContext(source, {
      self: worker, navigator: { get onLine() { return network.online; } },
      caches: w.caches, fetch: fetchFile, URL, AbortController, setTimeout, clearTimeout
    });
    for (const name of ['install', 'activate']) {
      let pending;
      handlers.get(name)({ waitUntil: promise => { pending = promise; } });
      await pending;
    }
    workerApi.controller = { scriptURL: url };
    workerApi.dispatchEvent(new w.Event('controllerchange'));
    return { active: workerApi.controller };
  };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: workerApi });
  const status = w.document.getElementById('offline-status');
  const button = w.document.getElementById('offline-prepare');
  w.eval(source);
  return {
    status, button, requests, network, get claimed() { return claimed; },
    serve(url, { method = 'GET', mode = 'same-origin' } = {}) {
      let response;
      handlers.get('fetch')({
        request: { url, method, mode },
        respondWith: promise => { response = promise; }
      });
      return response;
    }
  };
}

test('preparation makes the app and both original PDFs reopenable without the network', async t => {
  const app = fixture(t);
  assert.equal(pdfPaths.length, 2);
  assert.deepEqual(app.requests, [], 'downloads require the preparation tap');
  app.button.click();
  await until(() => app.button.hidden);
  assert(app.claimed);
  assert.match(app.status.textContent, /listos para usar sin conexión/);
  app.network.online = false;
  const page = await app.serve(base + '?evento=pbw-2026', { mode: 'navigate' });
  assert.equal(await page.text(), html);
  for (const path of pdfPaths) {
    const pdf = await app.serve(base + path);
    assert(Buffer.from(await pdf.arrayBuffer()).equals(fs.readFileSync(path)));
  }
  const script = await app.serve(base + 'pdf-sharing.js?v=' + version);
  assert.equal(await script.text(), fs.readFileSync('pdf-sharing.js', 'utf8'));
  assert.equal(app.serve(base, { method: 'POST' }), undefined);
  assert.equal(app.serve('https://script.google.com/macros/s/example/exec?action=config'), undefined);
  assert.equal(app.serve(base + 'version.json?t=123'), undefined);
  assert.equal(app.serve(base + 'pbw2026/', { mode: 'navigate' }), undefined);
});

for (const scenario of [{ missing: pdfPaths[1] }, { stale: true }]) {
  test('an incomplete or stale download does not claim offline readiness', async t => {
    const app = fixture(t, scenario);
    app.button.click();
    await until(() => /quedó incompleta/.test(app.status.textContent));
    assert.equal(app.claimed, false);
    assert.equal(app.button.hidden, false);
    assert.equal(app.button.disabled, false);
  });
}
