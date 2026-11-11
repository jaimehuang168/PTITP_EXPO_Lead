const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const filenames = [
  'PTITP_Parque_Tecnologico_Inteligente_ES_1019.pdf',
  'PTITP_Parque_Tecnologico_Inteligente_PT-BR_1020.pdf'
];
const settle = () => new Promise(resolve => setImmediate(resolve));
const pdfResponse = text => ({
  ok: true,
  arrayBuffer: async () => Uint8Array.from(Buffer.from(text)).buffer
});

function openMaterials(t, { fetch, share, canShare } = {}) {
  const { window } = new JSDOM(html, {
    url: 'https://example.test/PTITP_EXPO_Lead/#materiales',
    runScripts: 'outside-only'
  });
  t.after(() => window.close());
  window.fetch = fetch || (() => assert.fail('PDF must load on demand'));
  window.navigator.share = share;
  window.navigator.canShare = canShare;
  if (fs.existsSync('pdf-sharing.js')) {
    window.eval(fs.readFileSync('pdf-sharing.js', 'utf8'));
  }
  const cards = [...window.document.querySelectorAll('#tab-materiales [data-pdf-card]')];
  assert.equal(cards.length, 2);
  return cards.map(card => ({
    button: card.querySelector('button[data-pdf-share]'),
    download: card.querySelector('a[download]'),
    status: card.querySelector('[role="status"]')
  }));
}

test('both original PDF downloads remain available without native file sharing', t => {
  const cards = openMaterials(t);
  cards.forEach(({ button, download }, i) => {
    assert(button.hidden);
    assert.equal(download.download, filenames[i]);
    assert.equal(new URL(download.href).pathname, '/PTITP_EXPO_Lead/assets/pdfs/' + filenames[i]);
  });
});

test('preparation fetches the selected language and the next tap shares an actual PDF file', async t => {
  const requested = [];
  const shares = [];
  const cards = openMaterials(t, {
    fetch: async url => {
      requested.push(url);
      return pdfResponse('%PDF-1.7\n' + url);
    },
    canShare: data => data.files[0].type === 'application/pdf',
    share: async data => shares.push(data)
  });
  assert.deepEqual(requested, []);
  for (const [i, { button, download }] of cards.entries()) {
    assert.equal(button.hidden, false);
    button.click();
    assert(button.disabled);
    assert.equal(shares.length, i, 'preparation must not open the share menu');
    await settle();
    assert.equal(button.textContent, 'Compartir PDF');
    button.click();
    assert.equal(shares.length, i + 1, 'the share call must run in the tap handler');
    const file = shares[i].files[0];
    assert.equal(file.name, filenames[i]);
    assert.equal(file.type, 'application/pdf');
    assert.equal(file.size, Buffer.byteLength('%PDF-1.7\n' + download.href));
    assert.equal(shares[i].url, undefined, 'share the file itself');
    await settle();
  }
  assert.deepEqual(requested, cards.map(card => card.download.href));
});

test('an invalid response can be retried and cancelling the menu keeps the PDF ready', async t => {
  let fetches = 0;
  let shares = 0;
  const [{ button, status }] = openMaterials(t, {
    fetch: async () => pdfResponse(++fetches === 1 ? '<html>Missing PDF</html>' : '%PDF-1.7'),
    canShare: () => true,
    share: async () => {
      if (++shares === 1) throw new DOMException('Cancelled', 'AbortError');
    }
  });
  button.click();
  await settle();
  assert.match(status.textContent, /volvé a intentar/i);
  assert.equal(button.disabled, false);
  button.click();
  await settle();
  button.click();
  await settle();
  assert.equal(status.textContent, '');
  assert.equal(button.textContent, 'Compartir PDF');
  button.click();
  assert.equal(shares, 2);
  assert.equal(fetches, 2);
});

test('an unsupported PDF share offers the direct download instead', async t => {
  const [{ button, download, status }] = openMaterials(t, {
    fetch: async () => pdfResponse('%PDF-1.7'),
    canShare: () => false,
    share: () => assert.fail('unsupported files must not be shared')
  });
  button.click();
  await settle();
  assert(button.hidden);
  assert.equal(download.hidden, false);
  assert.match(status.textContent, /Descargá el PDF/);
});
