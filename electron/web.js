// Carga una página web en una ventana invisible (para que su JavaScript termine de dibujarla)
// y devuelve el HTML final. Si el enlace es un PDF o una imagen, devuelve los bytes.
import { BrowserWindow, net, session } from 'electron';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); })]).finally(() => clearTimeout(t));
}

export function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new Error('Escribe un enlace.');
  if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Solo se pueden abrir enlaces http o https.');
  return u.toString();
}

async function probe(url) {
  try {
    const res = await withTimeout(net.fetch(url, { method: 'HEAD', headers: { 'user-agent': UA } }), 8000, 'timeout');
    return { type: (res.headers.get('content-type') || '').toLowerCase(), url: res.url || url };
  } catch {
    return { type: '', url };
  }
}

async function download(url) {
  const res = await withTimeout(net.fetch(url, { headers: { 'user-agent': UA } }), 60000, 'La descarga tardó demasiado.');
  if (!res.ok) throw new Error(`El servidor respondió ${res.status}.`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { mime: (res.headers.get('content-type') || '').split(';')[0], data: new Uint8Array(buf), url: res.url || url };
}

export async function loadWeb(input) {
  const url = normalizeUrl(input);
  const head = await probe(url);
  if (head.type.includes('application/pdf') || /\.pdf($|\?)/i.test(url)) {
    const file = await download(url);
    return { kind: 'pdf', ...file, name: decodeURIComponent(new URL(file.url).pathname.split('/').pop() || 'documento.pdf') };
  }
  if (head.type.startsWith('image/')) {
    const file = await download(url);
    return { kind: 'image', ...file, name: decodeURIComponent(new URL(file.url).pathname.split('/').pop() || 'imagen') };
  }

  const ses = session.fromPartition('aracne-web');
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, images: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    try {
      await withTimeout(win.loadURL(url, { userAgent: UA }), 30000, 'La página tardó demasiado en cargar.');
    } catch (err) {
      // ERR_ABORTED ocurre con redirecciones del propio sitio; seguimos si hay contenido.
      if (!/ERR_ABORTED|tardó/.test(String(err.message))) throw err;
    }
    // Deja que el JavaScript del sitio termine y baja un poco para activar cargas perezosas.
    await new Promise((r) => setTimeout(r, 1200));
    await win.webContents.executeJavaScript('window.scrollTo(0, document.body ? document.body.scrollHeight / 3 : 0); 1', true).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    const page = await win.webContents.executeJavaScript(`(() => {
      const meta = (n) => document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]')?.content || '';
      return {
        html: document.documentElement.outerHTML,
        url: location.href,
        title: document.title,
        lang: document.documentElement.lang || '',
        meta: {
          author: meta('author') || meta('article:author') || meta('citation_author'),
          site: meta('og:site_name'),
          published: meta('article:published_time') || meta('citation_publication_date') || meta('date') || meta('DC.date'),
          description: meta('description') || meta('og:description'),
          doi: meta('citation_doi') || meta('dc.identifier'),
        },
      };
    })()`, true);
    return { kind: 'web', ...page };
  } finally {
    win.destroy();
  }
}

export async function fetchImage(url) {
  const file = await download(normalizeUrl(url));
  if (!file.mime.startsWith('image/')) throw new Error('No es una imagen.');
  return { mime: file.mime, data: Buffer.from(file.data).toString('base64') };
}
