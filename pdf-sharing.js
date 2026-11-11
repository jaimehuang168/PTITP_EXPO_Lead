(() => {
  'use strict';

  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return;

  for (const card of document.querySelectorAll('[data-pdf-card]')) {
    const button = card.querySelector('[data-pdf-share]');
    const download = card.querySelector('a[download]');
    const status = card.querySelector('[role="status"]');
    let pdf;

    button.hidden = false;
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';

      try {
        if (pdf) {
          // Invoke the system menu within this tap, after preparation has finished.
          await navigator.share({ files: [pdf] });
          return;
        }

        button.textContent = 'Preparando PDF…';
        const response = await fetch(download.href);
        if (!response.ok) throw new Error('PDF download failed');

        const bytes = new Uint8Array(await response.arrayBuffer());
        if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
          throw new Error('Expected a PDF file');
        }

        const file = new File([bytes], download.download, { type: 'application/pdf' });
        if (!navigator.canShare({ files: [file] })) {
          button.hidden = true;
          status.textContent = 'Descargá el PDF y compartilo desde Archivos.';
          return;
        }

        pdf = file;
        status.textContent = 'PDF listo. Tocá Compartir PDF.';
      } catch (error) {
        if (!pdf) {
          status.textContent = 'No se pudo preparar el PDF. Volvé a intentar o descargalo.';
        } else if (error.name !== 'AbortError') {
          status.textContent = 'Descargá el PDF y compartilo desde Archivos.';
        }
      } finally {
        button.textContent = pdf ? 'Compartir PDF' : 'Preparar PDF';
        button.disabled = false;
      }
    });
  }
})();
