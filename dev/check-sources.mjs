// Prueba manual: node_modules/.bin/electron dev/check-sources.mjs
import { app } from 'electron';
import { checkSource } from '../electron/sources.js';
app.whenReady().then(async () => {
  const items = [
    { type: 'doi', id: '10.17487/rfc0791' },
    { type: 'doi', id: '10.1016/s0140-6736(97)11096-0' },
    { type: 'doi', id: '10.99999/aracne.inventado.2026' },
    { type: 'doi', id: '10.5281/zenodo.3242074' },
    { type: 'isbn', id: '9780136681557' },
    { type: 'isbn', id: '9780136764052' },
    { type: 'pmid', id: '9500320' },
    { type: 'pmcid', id: 'PMC3169061' },
    { type: 'arxiv', id: '1706.03762' },
    { type: 'url', id: 'https://www.rfc-editor.org/rfc/rfc791' },
    { type: 'url', id: 'https://biblioteca.universidad-de-ejemplo-aracne.pe/guias/redes.pdf' },
    { type: 'url', id: 'https://en.wikipedia.org/wiki/This_page_does_not_exist_aracne' },
  ];
  for (const it of items) {
    const r = await checkSource(it);
    console.log(`${it.type}:${it.id}\n   → ${r.status} | ${r.note} | ${r.title || ''} ${r.year || ''} | authors=${(r.meta?.authors || []).length}${r.archive ? ' | archive ' + r.archive.url.slice(0, 60) : ''}`);
  }
  app.quit();
});
