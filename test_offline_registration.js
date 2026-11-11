const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const { installBrowserAuth, user } = require('./test_helpers/browser-auth.cjs');

const html = fs.readFileSync('index.html', 'utf8');
const profileKey = 'ptitp_offline_registro_v1';
const owner = user();
const profile = {
  usuario: { uid: owner.uid, nombre: owner.displayName, email: owner.email },
  evento: {
    id: 'pbw-2026', nombre: 'EXPO PBW', desde: '2026-11-10', hasta: '2026-11-14',
    visible: true, permiteRegistro: true
  }
};

async function until(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail('Registration state did not finish');
}

function open(t, { online = false, saved = {}, event = '', now = '2026-11-11T14:00:00Z', signedIn = false } = {}) {
  let account;
  const uploads = [];
  const acks = [];
  const { window: w } = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/PTITP_EXPO_Lead/' + event,
    beforeParse(w) {
      Object.defineProperty(w.navigator, 'onLine', { get: () => online });
      w.Date = class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return Date.parse(now); }
      };
      for (const [key, value] of Object.entries(saved)) w.localStorage.setItem(key, value);
      account = installBrowserAuth(w, { signedIn, admin: false });
      w.fetch = async (url, options) => {
        if (!options?.body) return { ok: true, json: async () => ({}) };
        assert(online, 'saving offline must not make a request');
        uploads.push(JSON.parse(options.body));
        return new Promise(resolve => {
          acks.push(() => resolve({ ok: true, json: async () => ({ ok: true }) }));
        });
      };
    }
  });
  t.after(() => w.close());
  const $ = id => w.document.getElementById(id);
  return {
    w, $, account, uploads, acks,
    queue: () => w.eval('getCola()'),
    connect() { online = true; w.dispatchEvent(new w.Event('online')); },
    save(name) {
      $('nombre').value = name;
      w.document.querySelector('input[name=calif]').checked = true;
      $('f').dispatchEvent(new w.Event('submit', { cancelable: true }));
    }
  };
}

test('preparing a verified session stores only a local operator and the active event', async t => {
  const app = open(t, { online: true, signedIn: true });
  await until(() => !app.$('enviar').disabled);
  assert.equal(app.w.localStorage.getItem(profileKey), null);
  app.w.dispatchEvent(new app.w.CustomEvent('ptitp-offline-package', { detail: { ready: true } }));
  const saved = app.w.localStorage.getItem(profileKey);
  assert(saved);
  assert.equal(JSON.parse(saved).usuario.uid, owner.uid);
  assert.equal(JSON.parse(saved).usuario.admin, false);
  assert.equal(JSON.parse(saved).evento.id, profile.evento.id);
  assert(!saved.includes('firebase-fixture'));
});

test('cold offline registration survives reopening and uploads automatically only for its verified owner', async t => {
  const first = open(t, { saved: { [profileKey]: JSON.stringify(profile) } });
  assert.equal(first.$('enviar').disabled, false);
  assert.equal(first.$('enviar').textContent, 'Guardar en el dispositivo');
  assert.equal(first.$('scan-btn').disabled, true);
  assert.equal(first.$('reportes').hidden, true);
  first.save('Offline visitor');
  const [pending] = first.queue();
  assert.equal(pending.nombre, 'Offline visitor');
  assert.equal(pending.operadorUid, owner.uid);
  assert.equal(first.$('nombre').value, '');
  assert(!('idToken' in pending));
  assert.equal(first.uploads.length, 0);

  const reopened = open(t, { saved: Object.fromEntries(Object.entries(first.w.localStorage)) });
  assert.equal(reopened.queue()[0].requestId, pending.requestId);
  reopened.connect();
  await until(() => !reopened.$('login-google').disabled);
  reopened.account.setUser(user('different-uid', 'different@example.test'));
  await until(() => !reopened.$('enviar').disabled);
  assert.equal(reopened.uploads.length, 0);
  assert.equal(reopened.queue().length, 1);

  reopened.account.setUser(owner);
  await until(() => reopened.uploads.length === 1);
  assert.equal(reopened.uploads[0].requestId, pending.requestId);
  assert.equal(reopened.uploads[0].idToken, 'firebase-fixture-' + owner.uid);
  assert.equal(reopened.queue().length, 1, 'keep the record until the server acknowledges it');
  reopened.acks[0]();
  await until(() => reopened.queue().length === 0);
});

test('offline registration is closed without a prepared profile, for a different event, or after the event ends', t => {
  const saved = { [profileKey]: JSON.stringify(profile) };
  for (const options of [{}, { saved, event: '?evento=old-event' }, { saved, now: '2026-11-15T04:00:00Z' }]) {
    const app = open(t, options);
    assert.equal(app.$('enviar').disabled, true);
    app.save('Must not be queued');
    assert.equal(app.queue().length, 0);
  }
});
