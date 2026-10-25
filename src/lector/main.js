// Ventana del lector: abre páginas web, PDF, Word, texto e imágenes, y las arañas trabajan sobre ellos.
import '../styles/base.css';
import '../styles/panel.css';
import '../styles/lector.css';
import 'katex/dist/katex.min.css';
import { api } from '../core/bridge.js';
import { h, clear, icon, toast, debounce, keyTokens, cleanError } from '../core/ui.js';
import { SpiderWorld, COLORS } from '../spiders/engine.js';
import { DomDoc, OcrDoc } from '../core/docmodel.js';
import { analyzeDocument } from '../core/analyze.js';
import { buildTargets } from '../core/targets.js';
import { offlineSummary } from '../ai/tasks.js';
import { recognize } from '../core/ocr.js';
import { Panel } from '../panel/panel.js';
import { renderWeb, renderText, renderHtmlFile, renderDocx, renderPdf, renderImage } from './viewers.js';
import { openSettings, openWelcome, openPermission } from './settings.js';

const isMac = api.platform === 'darwin';
document.documentElement.classList.add(`os-${api.platform}`);

// ---------------------------------------------------------------- estructura

const address = h('input', { class: 'address', type: 'text', placeholder: 'Pega un enlace (https://…) o arrastra aquí un PDF, Word, imagen o texto', spellcheck: 'false' });
const scroller = h('div', { class: 'scroller' });
const lensLayer = h('div', { class: 'lens-layer' });
const hoverCard = h('div', { class: 'hover-card' });
const loading = h('div', { class: 'loading' });
const hudText = h('span', { class: 'sh-text' }, '');
const hudBtn = h('button', { class: 'sh-btn', title: 'Detener o volver a escanear', onclick: () => (scanState && !scanState.finished ? finishScan() : startScan({ fromTop: false })) }, icon('spider', 14), h('span', {}, 'Detener'));
const spiderHud = h('div', { class: 'spider-hud' }, h('span', { class: 'sh-dot' }), hudText, hudBtn);
const frameLayer = h('div', { class: 'frame-layer' });
const bubbleCount = h('span', { class: 'bubble-count' });
const bubble = h('button', { class: 'lector-bubble', title: 'Mostrar el panel', onclick: () => setPanelHidden(false) }, icon('spider', 24), bubbleCount);
const viewerHost = h('div', { class: 'viewer-host' }, scroller, lensLayer, frameLayer, hoverCard, spiderHud, bubble, loading);
const panelMount = h('div', { class: 'panel-mount' });

const actions = {
  rescan: h('button', { class: 'tb-btn', title: 'Volver a escanear todo el documento', onclick: () => startScan({ fromTop: true }) }, icon('scan', 18)),
  frame: h('button', { class: 'tb-btn', title: 'Enmarcar: elige la parte que deben escanear', onclick: () => startFraming() }, icon('frame', 18)),
  lens: h('button', { class: 'tb-btn', title: 'Lupa araña: analiza una parte con IA', onclick: () => startLens() }, icon('lens', 18)),
  clear: h('button', { class: 'tb-btn', title: 'Quitar las marcas', onclick: () => world.clearMarks() }, icon('close', 18)),
  panel: h('button', { class: 'tb-btn', title: 'Mostrar u ocultar el panel', onclick: () => setPanelHidden(!document.body.classList.contains('no-panel')) }, icon('web', 18)),
  settings: h('button', { class: 'tb-btn', title: 'Ajustes', onclick: () => openSettings() }, icon('settings', 18)),
};

const topbar = h('header', { class: 'topbar' },
  h('button', { class: 'brand', title: 'Inicio', onclick: () => goHome() }, h('img', { src: 'icon.svg', alt: '' }), h('span', {}, 'Aracne')),
  h('form', { class: 'address-wrap', onsubmit: (e) => { e.preventDefault(); openUrl(address.value); } },
    icon('link', 16), address,
    h('button', { type: 'button', class: 'tb-btn', title: 'Abrir archivo', onclick: () => pickFile() }, icon('file', 18))),
  h('div', { class: 'tb-actions' }, Object.values(actions)));

document.body.append(h('div', { class: 'app' }, topbar, h('main', { class: 'layout' }, viewerHost, panelMount)));

// ---------------------------------------------------------------- arañas y panel

let settings = await api.settings.get();
const world = new SpiderWorld({
  host: viewerHost,
  getCamera: () => ({ x: scroller.scrollLeft, y: scroller.scrollTop }),
  setCameraY: (y) => { scroller.scrollTop = y; },
  intensity: settings.animation,
  decor: 'web',
});
world.canvas.style.zIndex = '4';
world.setPatrol(false);
for (const ev of ['wheel', 'keydown', 'mousedown', 'touchstart']) scroller.addEventListener(ev, () => world.cancelAutoScroll(), { passive: true });

// Cada hallazgo que llega al panel hace parpadear su botón (o la burbujita si el panel está oculto).
world.on('arrive', (t) => {
  const view = railViewFor(t?.species);
  const btn = document.body.classList.contains('no-panel') ? bubble : panelMount.querySelector(`.rail-btn[data-view="${view}"]`);
  if (!btn) return;
  btn.classList.remove('ping');
  void btn.offsetWidth;
  btn.classList.add('ping');
});
world.on('viewdone', () => turnPage());

function setPanelHidden(hidden) {
  document.body.classList.toggle('no-panel', hidden);
}

function railViewFor(species) {
  return species === 'dates' ? 'dates' : species === 'sources' ? 'sources' : species === 'context' ? 'context' : 'overview';
}

// Marcador en vivo: página, renglones leídos y hallazgos.
setInterval(() => {
  const st = world.stats;
  bubbleCount.textContent = st.found ? String(st.found > 99 ? '99+' : st.found) : '';
  if (!current) return;
  const scanning = scanState && !scanState.finished;
  spiderHud.classList.toggle('paused', !scanning);
  hudBtn.lastChild.textContent = scanning ? 'Detener' : 'Escanear otra vez';
  hudText.textContent = scanning
    ? `LEYENDO · PÁG. ${scanState.pages} · ${st.linesRead} RENGLONES · ${st.found} HALLAZGOS`
    : `LISTO · ${st.found} HALLAZGOS`;
}, 300);

const panel = new Panel({
  mount: panelMount,
  mode: 'lector',
  hooks: {
    startLens: () => startLens(),
    listImages: () => listImages(),
    setFocusMode: (on) => scroller.classList.toggle('focus', on),
    changeFontSize: (d) => {
      fontScale = Math.max(0.8, Math.min(1.6, fontScale + d * 0.1));
      scroller.style.setProperty('--reader-scale', fontScale);
    },
    openSettings: (section) => openSettings(section),
    citeMeta: () => current?.meta || null,
    openSource: (url) => openUrl(url),
    headButtons: () => [h('button', { class: 'btn small icon-only ghost', title: 'Ocultar el panel', onclick: () => setPanelHidden(true) }, icon('hide', 16))],
  },
});
let fontScale = 1;

api.on('settings:changed', (s) => {
  settings = s;
  world.setIntensity(s.animation);
});

/** @type {{doc:any, findings:any, viewer:any, meta:any}|null} */
let current = null;
let openToken = 0;

// ---------------------------------------------------------------- inicio

async function goHome() {
  openToken++;
  setLoading(null);
  closeCurrent();
  world.decor = 'web';
  address.value = '';
  document.body.classList.add('is-home');
  const info = await api.info();
  let memory = [];
  try {
    memory = await api.memory.list();
  } catch {
    memory = [];
  }
  const recents = memory.slice(0, 6);
  const drop = h('div', { class: 'home' },
    h('div', { class: 'hero' },
      h('img', { class: 'hero-logo', src: 'icon.svg', alt: '' }),
      h('h1', {}, 'Aracne'),
      h('p', { class: 'tagline' }, 'Arañas digitales que leen contigo: verifican fuentes, encuentran fechas, resumen, explican imágenes y te ayudan a estudiar.')),
    h('div', { class: 'home-actions' },
      h('button', { class: 'btn primary big', onclick: () => pickFile() }, icon('file', 18), 'Abrir un archivo'),
      h('button', { class: 'btn big', onclick: () => address.focus() }, icon('link', 18), 'Pegar un enlace'),
      h('button', { class: 'btn big ghost', onclick: () => openSample() }, icon('sparkles', 18), 'Probar con un ejemplo')),
    h('div', { class: 'shortcut-card' },
      h('div', { class: 'keys' }, keyTokens(info.shortcut).map((k) => h('kbd', {}, k))),
      h('div', {},
        h('strong', {}, 'En cualquier aplicación'),
        h('p', { class: 'muted' }, `Pulsa ${info.shortcutLabel} sobre una página, un PDF o lo que estés leyendo: las arañas salen de un agujero negro, leen todo bajando la página solas y vuelven a esconderse. Pulsa de nuevo o Esc para terminar antes.`),
        info.shortcutOk ? null : h('p', { class: 'warn small' }, 'El atajo no se pudo activar porque otra aplicación lo usa. Cámbialo en Ajustes.')),
      h('button', { class: 'btn small', onclick: () => api.overlay.activate() }, 'Probar ahora')),
    recents.length ? h('div', { class: 'recents' },
      h('div', { class: 'kicker' }, 'Leído recientemente'),
      h('div', { class: 'recent-grid' }, recents.map((r) => h('button', {
        class: 'recent',
        disabled: !/^https?:/.test(r.source || ''),
        title: /^https?:/.test(r.source || '') ? r.source : 'Abre el archivo de nuevo para verlo',
        onclick: () => /^https?:/.test(r.source || '') && openUrl(r.source),
      }, h('span', { class: 'recent-kind' }, r.kind === 'pdf' ? 'PDF' : r.kind === 'web' ? 'WEB' : r.kind.toUpperCase()), h('span', { class: 'recent-title' }, r.title || 'Sin título'))))) : null,
  );
  clear(scroller, drop);
  scroller.scrollTop = 0;
  panel.doc = null;
  panel.render();
  // En la portada salen unas cuantas arañas del agujero a pasear por la telaraña.
  world.active = true;
  const homeToken = openToken;
  if (world.spiders.length < 4 && world.maxSpiders > 0) {
    await sleep(320); // espera a que el panel termine de esconderse
    if (homeToken !== openToken) return;
    const c = { x: viewerHost.clientWidth / 2, y: viewerHost.clientHeight * 0.42 };
    world.openPortal(c, 30).then(() => world.emergeFromPortal(4 - world.spiders.length, 0.35)).then(() => sleep(400)).then(() => world.closePortal());
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function closeCurrent() {
  hideHoverCard();
  scanToken++;
  scanState = null;
  world.setScanMode(false);
  world.setRegion(null);
  world.frameRect = null;
  world.reset();
  world.setReader(null);
  if (current?.viewer?.destroy) current.viewer.destroy();
  if (current?.doc?.destroy) current.doc.destroy();
  current = null;
  scroller.classList.remove('focus');
}

function setLoading(text) {
  if (!text) {
    loading.classList.remove('on');
    return;
  }
  clear(loading, h('div', { class: 'loading-box' }, h('div', { class: 'mini-web big' }, h('span'), h('span'), h('span')), h('p', {}, text)));
  loading.classList.add('on');
}

// ---------------------------------------------------------------- abrir documentos

async function openUrl(input) {
  const url = String(input || '').trim();
  if (!url) return;
  const token = ++openToken;
  setLoading('Las arañas están entrando a la página…');
  try {
    const page = await api.web.load(url);
    if (token !== openToken) return;
    if (page.kind === 'pdf') await showPdf(page.name, page.data, page.url);
    else if (page.kind === 'image') await showImage(page.name, page.data, page.mime, page.url);
    else await showViewer(renderWeb(page), page.url);
    address.value = page.url || url;
  } catch (err) {
    toast(`No se pudo abrir: ${cleanError(err)}`, 'error', 6000);
  } finally {
    if (token === openToken) setLoading(null);
  }
}

async function pickFile() {
  try {
    const f = await api.files.open();
    if (f) await openFile(f.name, f.data, f.path);
  } catch (err) {
    toast(`No se pudo abrir el archivo: ${cleanError(err)}`, 'error');
  }
}

async function openFile(name, data, path = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const token = ++openToken;
  setLoading('Las arañas están leyendo el archivo…');
  try {
    if (ext === 'pdf') await showPdf(name, data, path || name);
    else if (ext === 'docx') await showViewer(await renderDocx(name, data), path || name);
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) await showImage(name, data, `image/${ext === 'jpg' ? 'jpeg' : ext}`, path || name);
    else if (['html', 'htm'].includes(ext)) await showViewer(renderHtmlFile(name, new TextDecoder().decode(data)), path || name);
    else await showViewer(renderText(name, new TextDecoder().decode(data)), path || name);
    address.value = name;
  } catch (err) {
    console.error(err);
    toast(`No se pudo leer ${name}: ${cleanError(err)}`, 'error', 6000);
  } finally {
    if (token === openToken) setLoading(null);
  }
}

async function openSample() {
  const res = await fetch('ejemplos/silabo-ejemplo.html');
  const html = await res.text();
  await showViewer(renderHtmlFile('Sílabo de ejemplo.html', html), 'Sílabo de ejemplo');
  address.value = 'Ejemplo: sílabo de un curso';
}

function mountViewer(viewer) {
  closeCurrent();
  document.body.classList.remove('is-home');
  world.decor = null;
  clear(scroller, viewer.el);
  scroller.scrollTop = 0;
  scroller.style.setProperty('--reader-scale', fontScale);
}

async function showViewer(viewer, source) {
  mountViewer(viewer);
  const doc = new DomDoc({ root: viewer.el, scroller, host: viewerHost, kind: viewer.kind, title: viewer.title, source, meta: viewer.meta });
  await afterOpen(doc, viewer, source);
}

async function showPdf(name, data, source) {
  const width = Math.min(900, scroller.clientWidth - 80);
  const viewer = await renderPdf(name, data, { width });
  mountViewer(viewer);
  setLoading('Las arañas están leyendo cada página…');
  const groups = await viewer.buildText();
  setLoading(null);
  const doc = new DomDoc({ root: viewer.el, scroller, host: viewerHost, kind: 'pdf', title: viewer.title, source, meta: viewer.meta, pdfBlocks: groups });
  if (doc.text.trim().length < 50) toast('Este PDF parece escaneado (sin texto). Usa la lupa o el atajo de pantalla para leerlo con OCR.', 'warn', 7000);
  await afterOpen(doc, viewer, source);
}

async function showImage(name, data, mime, source) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const viewer = renderImage(name, url);
  mountViewer(viewer);
  await new Promise((r) => { if (viewer.img.complete) r(); else viewer.img.onload = r; });
  setLoading('Leyendo el texto de la imagen…');
  let page = { blocks: [] };
  try {
    page = await recognize(viewer.img, (p) => setLoading(`Leyendo el texto de la imagen… ${Math.round(p * 100)}%`));
  } catch (err) {
    console.warn('OCR', err);
  }
  setLoading(null);
  const img = viewer.img;
  const doc = new OcrDoc(page, () => img.naturalWidth / img.clientWidth, {
    kind: 'image',
    title: name,
    source,
    offset: () => {
      const r = img.getBoundingClientRect();
      const host = viewerHost.getBoundingClientRect();
      return { x: r.left - host.left + scroller.scrollLeft, y: r.top - host.top + scroller.scrollTop };
    },
  });
  doc.scrollToRects = (rects) => rects?.length && scroller.scrollTo({ top: Math.max(0, rects[0].y - scroller.clientHeight * 0.3), behavior: 'smooth' });
  await afterOpen(doc, viewer, source);
  // Con IA disponible, la araña de visión explica la imagen automáticamente.
  const st = await api.ai.status().catch(() => ({ available: false }));
  if (st.available && st.vision) {
    const canvas = document.createElement('canvas');
    const k = Math.min(1, 1600 / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    panel.analyzeCapture({ image: { mime: 'image/jpeg', data: dataUrl.split(',')[1] }, thumb: dataUrl, rects: doc.elementRects ? null : [imgWorldRect(img)], context: doc.text.slice(0, 600) });
  }
}

function imgWorldRect(img) {
  const r = img.getBoundingClientRect();
  const host = viewerHost.getBoundingClientRect();
  return { x: r.left - host.left + scroller.scrollLeft, y: r.top - host.top + scroller.scrollTop, w: r.width, h: r.height };
}

async function afterOpen(doc, viewer, source) {
  const findings = analyzeDocument(doc);
  doc.memoryId = memoryIdFor(viewer, source);
  current = { doc, findings, viewer, meta: viewer.meta };
  panel.setDocument(doc, findings, world);
  panel.show('overview');
  setupHover(doc, findings);
  startScan({ fromTop: true });
  // Recordar (solo en esta computadora) para la telaraña de memoria.
  if (findings.keywords.length >= 3) {
    api.memory.add({
      id: doc.memoryId,
      title: viewer.title,
      source: /^https?:/.test(source || '') ? source : viewer.source || source,
      kind: viewer.kind,
      keywords: findings.keywords,
      highlights: offlineSummary(doc, findings).slice(0, 3).map((s) => s.text),
      words: findings.stats.words,
      lang: doc.lang,
    }).catch(() => {});
  }
}

function memoryIdFor(viewer, source) {
  if (/^https?:/.test(source || '')) {
    try {
      const u = new URL(source);
      u.hash = '';
      return u.toString();
    } catch {
      return source;
    }
  }
  return `${viewer.kind}:${viewer.title}`;
}

// ---------------------------------------------------------------- escaneo

function railPoint(view) {
  return () => {
    const host = viewerHost.getBoundingClientRect();
    if (document.body.classList.contains('no-panel')) {
      const r = bubble.getBoundingClientRect();
      return { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top };
    }
    const btn = document.querySelector(`.rail-btn[data-view="${view}"]`);
    if (!btn) return { x: host.width - 10, y: host.height / 2 };
    const r = btn.getBoundingClientRect();
    return { x: host.width - 6, y: Math.min(host.height - 20, Math.max(20, r.top + r.height / 2 - host.top)) };
  };
}

// Escaneo completo: salen del agujero, leen renglón por renglón, bajan la página solas
// hasta el final (o hasta el fondo de la zona enmarcada) y vuelven a meterse al agujero.
let scanState = null;
let scanToken = 0;

function viewCenter() {
  const z = scanState?.region;
  if (z) {
    const y = z.y - scroller.scrollTop + Math.min(z.h, scroller.clientHeight) / 2;
    return { x: z.x - scroller.scrollLeft + z.w / 2, y: Math.max(60, Math.min(scroller.clientHeight - 60, y)) };
  }
  return { x: scroller.clientWidth / 2, y: scroller.clientHeight / 2 };
}

async function startScan({ fromTop = true, region = null } = {}) {
  if (!current) return;
  const my = ++scanToken;
  const { doc, findings } = current;
  world.cancelRecall();
  world.reset();
  world.active = true;
  const words = doc.wordCount ? doc.wordCount() : 1000;
  const zone = region || (scanState?.region && !fromTop ? scanState.region : null);
  scanState = { token: my, finished: false, turning: false, pages: 1, region: zone };
  world.frameRect = zone;
  world.setScanMode(true, { boost: Math.max(1.4, Math.min(3.2, words / 1200)), region: zone });
  world.setReader(doc);
  const { chosen, rest } = buildTargets(doc, findings, { max: 9999 });
  for (const t of [...chosen, ...rest]) t.carryTo = railPoint(railViewFor(t.species));
  if (zone) scroller.scrollTop = Math.max(0, zone.y - 40);
  else if (fromTop) scroller.scrollTop = 0;
  world.addLatent([...chosen, ...rest]);
  if (world.maxSpiders === 0) {
    world.flushLatent();
    scanState.finished = true;
    return;
  }
  const missing = world.maxSpiders - world.liveCount();
  if (missing > 0) {
    await world.openPortal(viewCenter(), 38);
    if (my !== scanToken) return;
    await world.emergeFromPortal(missing, 0.22);
    await sleep(350);
    if (my === scanToken && !scanState?.finished) world.closePortal();
  }
}

function waitScrollEnd() {
  return new Promise((resolve) => {
    let last = scroller.scrollTop, still = 0;
    const iv = setInterval(() => {
      if (Math.abs(scroller.scrollTop - last) < 1) still++;
      else still = 0;
      last = scroller.scrollTop;
      if (still >= 3) {
        clearInterval(iv);
        resolve();
      }
    }, 60);
  });
}

/** Cuando terminan lo visible, bajan la página (o terminan). */
async function turnPage() {
  const st = scanState;
  if (!st || st.finished || st.turning || st.token !== scanToken) return;
  const max = scroller.scrollHeight - scroller.clientHeight;
  const limit = st.region ? Math.min(max, st.region.y + st.region.h - scroller.clientHeight * 0.6) : max;
  if (settings.autoPage === false || scroller.scrollTop >= limit - 2) {
    finishScan();
    return;
  }
  st.turning = true;
  const from = scroller.scrollTop;
  scroller.scrollTo({ top: Math.min(limit, from + scroller.clientHeight * 0.78), behavior: 'smooth' });
  await waitScrollEnd();
  st.turning = false;
  if (st.token !== scanToken || st.finished) return;
  if (scroller.scrollTop <= from + 1) {
    finishScan();
    return;
  }
  st.pages++;
  world.viewDoneFired = false;
}

/** Vuelven al agujero negro y desaparecen. */
async function finishScan() {
  const st = scanState;
  if (!st || st.finished) return;
  st.finished = true;
  const my = scanToken;
  world.setScanMode(false);
  if (world.spiders.length) {
    await world.openPortal(viewCenter(), 38);
    if (my !== scanToken) return;
    await world.recallToPortal();
    if (my !== scanToken) return;
    await sleep(150);
    if (my !== scanToken) return;
    await world.closePortal();
  } else world.flushLatent();
  if (my !== scanToken) return;
  world.active = false; // ya no salen más hasta el próximo escaneo
  world.frameRect = null;
}

// ---------------------------------------------------------------- enmarcar

function startFraming() {
  if (!current) {
    toast('Abre un documento primero.', 'warn');
    return;
  }
  frameLayer.classList.add('on');
  clear(frameLayer, h('div', { class: 'lens-hint frame-hint' }, icon('frame', 16), 'Dibuja el recuadro que deben escanear las arañas · Esc para cancelar'));
}

function stopFraming() {
  frameLayer.classList.remove('on');
  clear(frameLayer);
}

frameLayer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const host = viewerHost.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const box = h('div', { class: 'frame-draft' });
  frameLayer.appendChild(box);
  const move = (ev) => Object.assign(box.style, {
    left: `${Math.min(sx, ev.clientX) - host.left}px`, top: `${Math.min(sy, ev.clientY) - host.top}px`,
    width: `${Math.abs(ev.clientX - sx)}px`, height: `${Math.abs(ev.clientY - sy)}px`,
  });
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    stopFraming();
    const w = Math.abs(ev.clientX - sx), hgt = Math.abs(ev.clientY - sy);
    if (w < 60 || hgt < 40) return;
    const region = { x: Math.min(sx, ev.clientX) - host.left + scroller.scrollLeft, y: Math.min(sy, ev.clientY) - host.top + scroller.scrollTop, w, h: hgt };
    startScan({ fromTop: false, region });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---------------------------------------------------------------- tarjetas de contexto al pasar el cursor

let hoverables = [];
let hoverActive = null;
let hoverStop = [];
let hideTimer = null;

function setupHover(doc, findings) {
  hoverables = [];
  const defOf = new Map(findings.acronyms.map((a) => [a.acronym, a]));
  for (const a of findings.acronyms) {
    for (const u of a.uses) hoverables.push({ start: u.start, end: u.end, kind: 'acronym', acr: a });
  }
  for (const r of findings.refs) hoverables.push({ start: r.start, end: r.end, kind: 'ref', ref: r });
  void defOf;
}

const onMove = debounce((e) => {
  if (!current || lensActive || !hoverables.length) return;
  const host = viewerHost.getBoundingClientRect();
  const x = e.clientX - host.left + scroller.scrollLeft;
  const y = e.clientY - host.top + scroller.scrollTop;
  const top = scroller.scrollTop - 40;
  const bottom = scroller.scrollTop + scroller.clientHeight + 40;
  let found = null;
  for (const it of hoverables) {
    const rects = current.doc.rectsFor(it.start, it.end);
    if (!rects.length || rects[0].y > bottom || rects[rects.length - 1].y + 30 < top) continue;
    if (rects.some((r) => x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2)) {
      found = it;
      break;
    }
  }
  if (found && found !== hoverActive) showHoverCard(found, e);
  else if (!found && hoverActive && !hoverCard.matches(':hover')) scheduleHide();
}, 30);
scroller.addEventListener('mousemove', onMove);
hoverCard.addEventListener('mouseleave', () => scheduleHide());
hoverCard.addEventListener('mouseenter', () => clearTimeout(hideTimer));

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideHoverCard, 280);
}

function hideHoverCard() {
  hoverActive = null;
  hoverCard.classList.remove('on');
  for (const s of hoverStop) s();
  hoverStop = [];
}

function showHoverCard(it, e) {
  clearTimeout(hideTimer);
  for (const s of hoverStop) s();
  hoverStop = [];
  hoverActive = it;
  const doc = current.doc;
  let content;
  let targetRects = [];
  if (it.kind === 'acronym') {
    targetRects = doc.rectsFor(it.acr.start, it.acr.end);
    content = [
      h('div', { class: 'kicker' }, 'Sigla'),
      h('div', { class: 'hc-title' }, it.acr.acronym),
      h('p', {}, it.acr.definition),
    ];
  } else {
    const target = doc.blocks[it.ref.target - 1];
    targetRects = doc.blockRects(it.ref.target);
    const label = { fig: 'Figura', tab: 'Tabla', eq: 'Ecuación', sec: 'Sección', cite: 'Referencia', anchor: 'Nota' }[it.ref.kind] || 'Referencia';
    let preview = null;
    if (target?.el && doc.root && it.ref.kind !== 'sec') {
      const fig = target.el.closest('figure') || target.el;
      preview = fig.cloneNode(true);
      preview.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      preview.classList.add('hc-preview');
    } else {
      preview = h('p', { class: 'hc-preview' }, (target?.text || '').slice(0, 600));
    }
    content = [h('div', { class: 'kicker' }, `${label} ${it.ref.num || ''}`), preview];
  }
  clear(hoverCard, ...content, h('button', { class: 'link', onclick: () => { hideHoverCard(); doc.scrollToRects(targetRects); setTimeout(world.summon(targetRects, COLORS.blue), 2400); } }, 'Ir allí →'));
  const host = viewerHost.getBoundingClientRect();
  const cx = Math.min(e.clientX - host.left + 16, host.width - 380);
  const cy = Math.min(e.clientY - host.top + 18, host.height - 260);
  hoverCard.style.left = `${Math.max(10, cx)}px`;
  hoverCard.style.top = `${Math.max(10, cy)}px`;
  hoverCard.classList.add('on');
  // Una araña se posa en la mención y un hilo la une con lo que menciona.
  const refRects = doc.rectsFor(it.start, it.end);
  hoverStop.push(world.summon(refRects, COLORS.blue));
  hoverStop.push(world.link(() => {
    const r = hoverCard.getBoundingClientRect();
    return { x: r.left - host.left + 10, y: r.top - host.top + 10 };
  }, targetRects, COLORS.blue));
}

// ---------------------------------------------------------------- lupa araña

let lensActive = false;

function startLens() {
  if (!current) {
    toast('Abre un documento primero.', 'warn');
    return;
  }
  lensActive = true;
  lensLayer.classList.add('on');
  clear(lensLayer, h('div', { class: 'lens-hint' }, icon('lens', 16), 'Arrastra un recuadro sobre lo que quieras analizar · Esc para cancelar'));
}

function stopLens() {
  lensActive = false;
  lensLayer.classList.remove('on');
  clear(lensLayer);
}

lensLayer.addEventListener('mousedown', (e) => {
  if (!lensActive) return;
  const host = viewerHost.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  const box = h('div', { class: 'lens-box' });
  lensLayer.appendChild(box);
  const move = (ev) => {
    const x = Math.min(sx, ev.clientX) - host.left, y = Math.min(sy, ev.clientY) - host.top;
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(ev.clientX - sx)}px`, height: `${Math.abs(ev.clientY - sy)}px` });
  };
  const up = async (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const rect = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), width: Math.abs(ev.clientX - sx), height: Math.abs(ev.clientY - sy) };
    stopLens();
    if (rect.width < 12 || rect.height < 12) return;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const world0 = { x: rect.x - host.left + scroller.scrollLeft, y: rect.y - host.top + scroller.scrollTop, w: rect.width, h: rect.height };
    const prevCanvas = world.canvas.style.visibility;
    world.canvas.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    let image;
    try {
      image = await api.capture.rect(rect);
    } finally {
      world.canvas.style.visibility = prevCanvas;
    }
    const context = current.doc.blocks.filter((b) => {
      const r = current.doc.blockRects(b.id)[0];
      return r && r.y < world0.y + world0.h + 120 && r.y + r.h > world0.y - 120;
    }).map((b) => b.text).join(' ').slice(0, 700);
    panel.analyzeCapture({ image, rects: [world0], context });
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---------------------------------------------------------------- imágenes del documento (para Visión)

function listImages() {
  if (!current) return [];
  const { viewer, doc } = current;
  if (viewer.kind === 'pdf') {
    const visible = viewer.pages.filter((p) => {
      const r = p.el.getBoundingClientRect();
      const host = viewerHost.getBoundingClientRect();
      return r.bottom > host.top && r.top < host.bottom;
    }).slice(0, 2);
    return visible.map((p) => ({
      label: `Página ${p.index}`,
      rects: () => doc.elementRects(p.el),
      context: doc.blocks.filter((b) => b.page === p.index).map((b) => b.text).join(' ').slice(0, 600),
      load: async () => {
        const canvas = await viewer.pageImage(p.index);
        return { mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] };
      },
    }));
  }
  if (viewer.kind === 'image') {
    const img = viewer.img;
    return [{
      label: 'Imagen',
      rects: () => [imgWorldRect(img)],
      load: async () => {
        const canvas = document.createElement('canvas');
        const k = Math.min(1, 1600 / img.naturalWidth);
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        return { mime: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] };
      },
    }];
  }
  return [...viewer.el.querySelectorAll('img')].filter((img) => img.naturalWidth >= 120 && img.naturalHeight >= 80).map((img) => ({
    label: img.alt || 'Imagen',
    rects: () => doc.elementRects(img),
    context: (img.closest('figure')?.querySelector('figcaption')?.textContent || img.alt || '').slice(0, 400),
    load: async () => {
      const src = img.currentSrc || img.src;
      if (src.startsWith('data:')) {
        const comma = src.indexOf(',');
        const head = src.slice(5, comma);
        return { mime: head.split(';')[0], data: head.includes('base64') ? src.slice(comma + 1) : src.slice(comma + 1) };
      }
      return api.web.image(src);
    },
  }));
}

// ---------------------------------------------------------------- enlaces dentro del lector

scroller.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || lensActive) return;
  const href = a.getAttribute('href');
  e.preventDefault();
  if (href.startsWith('#')) {
    const el = scroller.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (/^https?:/i.test(href)) {
    if (e.metaKey || e.ctrlKey) openUrl(href);
    else api.shell.open(href);
  }
});

// ---------------------------------------------------------------- arrastrar y soltar

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.target === document.documentElement || !e.relatedTarget) document.body.classList.remove('dragging');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer.files?.[0];
  if (file) {
    const data = new Uint8Array(await file.arrayBuffer());
    await openFile(file.name, data, api.files.pathFor(file));
    return;
  }
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (/^https?:\/\//.test(text)) openUrl(text.split('\n')[0]);
});

// ---------------------------------------------------------------- teclado y eventos del sistema

window.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'Escape') {
    if (lensActive) stopLens();
    else if (frameLayer.classList.contains('on')) stopFraming();
    else if (scanState && !scanState.finished) finishScan();
    hideHoverCard();
  }
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    pickFile();
  }
  if (mod && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    address.focus();
    address.select();
  }
});

api.on('lector:open-path', async (p) => {
  try {
    const f = await api.files.read(p);
    if (f) await openFile(f.name, f.data, f.path);
  } catch (err) {
    toast(`No se pudo abrir: ${cleanError(err)}`, 'error');
  }
});
api.on('lector:open-doc', (d) => {
  if (d?.settings) openSettings();
  else if (d?.url) openUrl(d.url);
  else if (d?.text) showViewer(renderText(d.title || 'Pantalla.txt', d.text), d.title);
});
api.on('lector:settings', () => openSettings());
api.on('lector:permission', () => openPermission());

// ---------------------------------------------------------------- arranque

await goHome();
for (const f of await api.files.pending()) await openFile(f.name, f.data, f.path);
if (settings.firstRun) openWelcome();
window.__aracne = { openUrl, openFile, showViewer, world, panel, get current() { return current; }, renderText, renderHtmlFile, openSample };
