// Capa de pantalla: aparece con el atajo sobre cualquier aplicación.
// Se abre un agujero negro, la oscuridad se extiende como tinta y salen las arañas.
// Leen la pantalla renglón por renglón; cuando terminan, bajan ellas mismas la página de tu
// aplicación, leen lo nuevo y siguen hasta el final. Después vuelven al agujero, la pantalla
// regresa a la luz y lo que encontraron queda en una burbujita.
import '../styles/base.css';
import '../styles/panel.css';
import '../styles/overlay.css';
import 'katex/dist/katex.min.css';
import { api } from '../core/bridge.js';
import { h, clear, icon, toast, cleanError } from '../core/ui.js';
import { SpiderWorld, COLORS } from '../spiders/engine.js';
import { ScreenDoc } from '../core/docmodel.js';
import { analyzeDocument } from '../core/analyze.js';
import { buildTargets } from '../core/targets.js';
import { recognize, warmUpOcr } from '../core/ocr.js';
import { estimateShift, refineShift } from '../core/scroll.js';
import { Panel } from '../panel/panel.js';

document.documentElement.classList.add(`os-${api.platform}`);

const PANEL_W = 478;
const MAX_PAGES = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// ---------------------------------------------------------------- estructura

const baseStrips = h('div', { class: 'strips' });
const inkStrips = h('div', { class: 'strips' });
const baseLayer = h('div', { class: 'layer base' }, baseStrips);
const inkLayer = h('div', { class: 'layer ink' }, inkStrips);
const selLayer = h('div', { class: 'sel-layer' });
const frameLabel = h('span', { class: 'frame-label' }, 'ZONA DE ESCANEO');
const frameBox = h('div', { class: 'frame-box' }, frameLabel, h('button', { class: 'frame-x', title: 'Quitar la zona', onclick: () => clearFrame() }, icon('close', 12)));
const frameLayer = h('div', { class: 'frame-layer' });
const status = h('span', { class: 'hud-status' }, 'listo');
const progressBar = h('span', { class: 'hud-progress' }, h('i'));
const counter = h('span', { class: 'hud-counter' });
const frameBtn = h('button', { class: 'hud-btn', title: 'Enmarcar: elige la parte de la pantalla que deben escanear', onclick: () => startFraming() }, icon('frame', 16), h('span', { class: 'hud-label' }, 'Enmarcar'));
const invertBtn = h('button', { class: 'hud-btn', title: 'Invertir colores', onclick: () => setInverted(!inverted) }, icon('contrast', 16));
const lectorBtn = h('button', { class: 'hud-btn', title: 'Abrir este texto en el lector', onclick: () => openInLector() }, icon('reading', 16));
const exitBtn = h('button', { class: 'hud-btn exit', title: 'Terminar (Esc)', onclick: () => finish() }, icon('close', 16), h('span', { class: 'hud-key' }, 'Esc'));
const hud = h('div', { class: 'hud' },
  h('span', { class: 'hud-logo' }, h('img', { src: 'icon.svg', alt: '' }), 'ARACNE'),
  h('span', { class: 'hud-sep' }, '//'),
  status, progressBar, counter, frameBtn, invertBtn, lectorBtn, exitBtn);
const hint = h('div', { class: 'hint' }, icon('lens', 14), 'Arrastra un recuadro para que la lupa te explique esa zona · Esc para terminar');
const notice = h('div', { class: 'ov-notice' });
const stage = h('div', { class: 'stage' }, baseLayer, inkLayer, frameLayer, frameBox, selLayer, hud, hint, notice);
const marker = h('div', { class: 'cap-marker' }, h('i'), h('i'));
const bubbleCount = h('span', { class: 'bubble-count' });
const bubble = h('button', { class: 'bubble', title: 'Ver lo que encontraron las arañas', onclick: () => togglePanel() },
  h('span', { class: 'bubble-ring' }), icon('spider', 26), bubbleCount,
  h('span', { class: 'bubble-x', title: 'Cerrar', onclick: (e) => { e.stopPropagation(); dismiss(); } }, icon('close', 10)));
const panelWrap = h('div', { class: 'ov-panel' });
const root = h('div', { class: 'ov' }, stage, marker, bubble, panelWrap);
document.body.appendChild(root);

let settings = await api.settings.get();
let world = null;
let session = null;
let inverted = false;
let token = 0;
let camY = 0;
let panelOpen = false;

const panel = new Panel({
  mount: panelWrap,
  mode: 'overlay',
  hooks: {
    startLens: () => {
      if (root.classList.contains('docked')) return;
      togglePanel(false);
      hint.classList.add('flash');
      setTimeout(() => hint.classList.remove('flash'), 1400);
    },
    listImages: () => (session && !root.classList.contains('docked') ? [{ label: 'Lo que se ve ahora', rects: () => [{ x: 0, y: camY, w: stage.clientWidth, h: stage.clientHeight }], context: session.doc?.text.slice(-800) || '', load: () => cropToJpeg({ x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight }) }] : []),
    openSettings: () => {
      dismiss();
      api.overlay.openLector({ settings: true });
    },
    openSource: (url) => {
      dismiss();
      api.overlay.openLector({ url });
    },
    openInLector: () => openInLector(),
    headButtons: () => [
      h('button', { class: 'btn small icon-only ghost', title: 'Ocultar el panel', onclick: () => togglePanel(false) }, icon('hide', 16)),
    ],
  },
});

api.on('settings:changed', (s) => {
  settings = s;
  world?.setIntensity(s.animation);
});

// ---------------------------------------------------------------- utilidades de vista

function setInverted(on) {
  inverted = on;
  root.classList.toggle('invert', on);
}

function setCam(y) {
  camY = y;
  const t = `translate3d(0, ${-y}px, 0)`;
  baseStrips.style.transform = t;
  inkStrips.style.transform = t;
}

function animate(ms, step) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      step(easeInOut(k), k);
      if (k < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

/** La "tinta" que oscurece (o aclara) la pantalla, con borde difuminado y chispitas. */
let inkR = 0;
async function animateInk(to, ms, center) {
  inkLayer.style.setProperty('--ix', `${center.x}px`);
  inkLayer.style.setProperty('--iy', `${center.y}px`);
  const from = inkR;
  await animate(ms, (e) => {
    inkR = from + (to - from) * e;
    inkLayer.style.setProperty('--ir', `${inkR}px`);
    if (world) world.ink = { x: center.x, y: center.y, r: inkR };
  });
  if (world) world.ink = null;
}

function maxRadius(c) {
  const w = stage.clientWidth, h = stage.clientHeight;
  return Math.max(Math.hypot(c.x, c.y), Math.hypot(w - c.x, c.y), Math.hypot(c.x, h - c.y), Math.hypot(w - c.x, h - c.y)) + 140;
}

function luminance(bitmap) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 40;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, 64, 40);
  const d = ctx.getImageData(0, 0, 64, 40).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  return sum / (d.length / 4);
}

function addStrip(url, worldY, height) {
  const mk = () => h('img', { class: 'strip fresh', src: url, alt: '', draggable: 'false', style: { top: `${worldY}px`, height: `${height}px` } });
  baseStrips.appendChild(mk());
  inkStrips.appendChild(mk());
  // Solo se guardan las tiras que pueden verse (las de muy arriba sobran).
  for (const box of [baseStrips, inkStrips]) while (box.children.length > 4) box.firstChild.remove();
}

function setStatus(text, progress) {
  status.textContent = text;
  progressBar.querySelector('i').style.width = `${Math.round((progress ?? 0) * 100)}%`;
  progressBar.classList.toggle('done', progress === null || progress >= 1);
}

function showNotice(content, ms = 0) {
  clear(notice, content);
  notice.classList.add('on');
  if (ms) setTimeout(() => notice.classList.remove('on'), ms);
}

/** Zona que se está escaneando, en coordenadas de pantalla. */
function scanRect() {
  if (session?.region) return session.region;
  const w = stage.clientWidth, hgt = stage.clientHeight;
  return { x: 0, y: 0, w: w - (panelOpen ? PANEL_W + 24 : 0), h: hgt };
}

// ---------------------------------------------------------------- panel y burbuja

function togglePanel(force) {
  const open = force === undefined ? !panelOpen : !!force;
  if (open === panelOpen) return;
  panelOpen = open;
  root.classList.toggle('panel-open', open);
  if (root.classList.contains('docked')) api.overlay.dock(open ? 'panel' : 'bubble');
  else world?.setInsets({ right: open ? PANEL_W + 24 : 0 });
  if (open) panel.render();
}

function bubblePoint() {
  const r = (panelOpen ? panelWrap.querySelector('.rail-btn[data-view="overview"]') : bubble)?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: stage.clientWidth - 40, y: stage.clientHeight / 2 };
}

function ping() {
  for (const el of [bubble, panelWrap.querySelector('.rail-btn[data-view="overview"]')]) {
    if (!el) continue;
    el.classList.remove('ping');
    void el.offsetWidth;
    el.classList.add('ping');
  }
}

setInterval(() => {
  if (!world || !session) return;
  const st = world.stats;
  bubbleCount.textContent = st.found ? String(st.found > 99 ? '99+' : st.found) : '';
  if (session.stopping || !session.doc) return;
  counter.textContent = `PÁG. ${session.pages} · ${st.found} HALLAZGOS · ${st.linesRead} RENGLONES`;
}, 250);

// ---------------------------------------------------------------- abrir

async function onOpen(payload) {
  const my = ++token;
  settings = payload.settings || settings;
  root.classList.remove('docked', 'panel-open', 'framing', 'closing', 'on', 'ready');
  panelOpen = false;
  clear(baseStrips);
  clear(inkStrips);
  clear(selLayer);
  notice.classList.remove('on');
  frameBox.classList.remove('on');
  setCam(0);
  inkR = 0;
  inkLayer.style.setProperty('--ir', '0px');
  counter.textContent = '';

  const blob = new Blob([payload.image], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const bitmap = await createImageBitmap(blob);
  if (my !== token) return;
  const W = stage.clientWidth || window.innerWidth;
  const H = stage.clientHeight || window.innerHeight;
  addStrip(url, 0, H);
  await Promise.all([...baseStrips.querySelectorAll('img'), ...inkStrips.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));

  session = {
    token: my,
    caps: [{ bitmap, url, worldY: 0, scale: payload.scale || bitmap.width / W }],
    doc: null,
    findings: null,
    targets: new Map(),
    region: null,
    pages: 1,
    pxPerUnit: payload.input?.unitPx || 60,
    calibrated: false,
    lastBottom: -Infinity,
    input: payload.input || { ok: false, reason: 'unknown' },
    stopping: false,
    turning: false,
  };

  const lum = luminance(bitmap);
  setInverted(settings.invertScreen === 'siempre' || (settings.invertScreen === 'auto' && lum > 0.5));

  if (!world) {
    world = new SpiderWorld({ host: stage, getCamera: () => ({ x: 0, y: camY }), intensity: settings.animation, solidText: true, stars: true });
    world.canvas.style.zIndex = '3';
    world.on('viewdone', () => nextPage());
    world.on('arrive', () => ping());
  } else {
    world.cancelRecall();
    world.reset();
    world.spiders = [];
    world.portal = null;
    world.setIntensity(settings.animation);
  }
  world.canvas.style.display = '';
  world.setInsets({ right: 0 });
  world.setRegion(null);
  world.setScanMode(false);
  world.setReader(null);
  world.active = true;

  panel.doc = null;
  panel.setNotice(null);
  panel.render();
  root.classList.add('on');
  setStatus('abriendo', 0);

  // El OCR empieza enseguida, mientras se abre el agujero.
  const ocrPromise = ocrPage(session.caps[0], { x: 0, y: 0, w: W, h: H }, my);

  // Agujero negro + tinta que se extiende + arañas que salen de un saltito.
  const center = { x: W / 2, y: H / 2 };
  const portal = world.openPortal(center, 40);
  await sleep(250);
  const ink = animateInk(maxRadius(center), 1500, center);
  await portal;
  if (my !== token) return;
  const emerge = world.emergeFromPortal(world.maxSpiders, 0.28);
  await ink;
  root.classList.add('ready');
  if (my !== token) return;
  if (!session.doc) {
    world.setScan(true);
    setStatus('leyendo tu pantalla', 0.1);
  }
  emerge.then(async () => {
    await sleep(350);
    if (world.portal && !session?.stopping) world.closePortal();
  });

  let page;
  try {
    page = await ocrPromise;
  } catch (err) {
    console.error(err);
    toast(`No se pudo leer la pantalla: ${cleanError(err)}`, 'error', 6000);
    page = { blocks: [] };
  }
  if (my !== token || session.stopping) return;
  world.setScan(false);
  const doc = new ScreenDoc({ kind: 'screen', title: 'Tu pantalla' });
  session.doc = doc;
  addPageToDoc(page.page, page.map, { minY: -Infinity, maxY: H - 2 });
  panel.setDocument(doc, session.findings, world);
  panel.show('overview');
  world.setScanMode(true, { boost: 1.7 });
  world.setReader(doc);
  deployNew();
  setStatus(doc.text.trim() ? 'leyendo' : 'no encontré texto', 1);
  if (world.maxSpiders === 0) setTimeout(() => nextPage(), 1200);
  else if (!doc.text.trim()) setTimeout(() => nextPage(), 900);
}

/** Pasa una captura (o un pedazo) por el OCR y devuelve cómo ubicar cada palabra en el mundo. */
async function ocrPage(cap, rect, my) {
  const k0 = cap.scale;
  const sx = rect.x * k0, sy = rect.y * k0, sw = rect.w * k0, sh = rect.h * k0;
  const maxW = 2200;
  const k = Math.min(1, maxW / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d');
  // El OCR lee mejor letras oscuras sobre fondo claro: las pantallas oscuras se invierten.
  const probe = document.createElement('canvas');
  probe.width = 48;
  probe.height = 32;
  probe.getContext('2d').drawImage(cap.bitmap, sx, sy, sw, sh, 0, 0, 48, 32);
  if (luminance(probe) < 0.42) ctx.filter = 'invert(1) grayscale(1) contrast(1.15)';
  ctx.drawImage(cap.bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const page = await recognize(canvas, (p) => my === token && !session?.doc && setStatus('leyendo tu pantalla', 0.1 + p * 0.9));
  const toCss = k0 * k; // píxeles del canvas por píxel de pantalla
  const map = (b) => ({ x: rect.x + b.x0 / toCss, y: cap.worldY + rect.y + b.y0 / toCss, w: (b.x1 - b.x0) / toCss, h: (b.y1 - b.y0) / toCss });
  return { page, map };
}

function addPageToDoc(page, map, { minY, maxY }) {
  const doc = session.doc;
  const before = doc.lines.length;
  doc.addPage(page, map, { minY, maxY });
  const newLines = doc.lines.slice(before);
  if (newLines.length) session.lastBottom = Math.max(...newLines.map((l) => l.box.y + l.box.h));
  session.findings = analyzeDocument(doc);
}

/** Convierte los hallazgos nuevos en presas escondidas: aparecen cuando una araña lee su renglón. */
function deployNew() {
  const { doc, findings } = session;
  const { chosen, rest } = buildTargets(doc, findings, { max: 9999 });
  const fresh = [];
  for (const t of [...chosen, ...rest]) {
    const old = session.targets.get(t.id);
    if (old) continue;
    t.carryTo = bubblePoint;
    session.targets.set(t.id, t);
    fresh.push(t);
  }
  // Las fuentes y fechas apuntan al objeto que ya está en el mundo (para recolorear al verificar).
  for (const x of [...findings.sources, ...findings.dates]) if (x.target && session.targets.has(x.target.id)) x.target = session.targets.get(x.target.id);
  world.addLatent(fresh);
  panel.updateDocument(findings);
}

// ---------------------------------------------------------------- página siguiente

async function nextPage() {
  const s = session;
  if (!s || s.stopping || s.turning || !s.doc) return;
  const my = token;
  if (s.pages >= MAX_PAGES) return finish();
  s.turning = true;
  try {
    if (settings.autoPage === false) return finish();
    let st = s.input;
    if (!st.ok && st.reason === 'permission') st = s.input = await api.overlay.input(true);
    if (!st.ok) {
      explainNoScroll(st.reason);
      return finish();
    }
    const r = scanRect();
    setStatus('bajando la página', 0.3);
    // La primera vez baja poquito para medir cuánto mueve cada vuelta de la rueda.
    const want = r.h * (s.calibrated ? 0.78 : 0.34);
    const units = Math.max(1, Math.round(want / s.pxPerUnit));
    const res = await api.overlay.scroll({ region: r, units });
    if (my !== token || s.stopping) return;
    if (!res?.ok) {
      explainNoScroll(res?.reason);
      return finish();
    }
    await sleep(520); // las aplicaciones terminan su desplazamiento suave
    root.classList.add('capturing');
    await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
    let shot = null;
    try {
      shot = await api.overlay.capture();
    } finally {
      root.classList.remove('capturing');
    }
    if (my !== token || s.stopping) return;
    if (!shot) return finish();
    const blob = new Blob([shot.image], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const prev = s.caps[s.caps.length - 1];
    const dy = measureShift(prev.bitmap, bitmap, r, prev.scale);
    if (dy < 6) return finish(); // ya no baja más: llegó al final
    const per = dy / (res.units || units);
    s.pxPerUnit = s.calibrated ? s.pxPerUnit * 0.5 + per * 0.5 : per;
    s.calibrated = true;
    const cap = { bitmap, url: URL.createObjectURL(blob), worldY: prev.worldY + dy, scale: shot.scale || prev.scale };
    s.caps.push(cap);
    if (s.caps.length > 3) {
      const old = s.caps.shift();
      old.bitmap.close?.();
    }
    s.pages++;
    // La página se desliza hacia arriba; arañas y marcas se mueven con ella.
    addStrip(cap.url, cap.worldY, stage.clientHeight);
    const from = camY;
    setStatus('leyendo', 1);
    const ocr = ocrPage(cap, { x: r.x, y: Math.max(r.y, r.y + r.h - dy - 60), w: r.w, h: Math.min(r.h, dy + 60) }, my);
    await animate(700, (e) => setCam(from + (cap.worldY - from) * e));
    const { page, map } = await ocr;
    if (my !== token || s.stopping) return;
    addPageToDoc(page, map, { minY: s.lastBottom - 2, maxY: cap.worldY + r.y + r.h - 2 });
    deployNew();
    world.viewDoneFired = false;
    if (world.maxSpiders === 0) setTimeout(() => nextPage(), 900);
  } catch (err) {
    console.error(err);
    finish();
  } finally {
    s.turning = false;
  }
}

/** ¿Cuánto bajó? Compara la zona escaneada de las dos capturas. */
function measureShift(a, b, r, scale) {
  const gray = (bmp, outW) => {
    const sw = r.w * scale, sh = r.h * scale;
    const k = outW / sw;
    const outH = Math.max(8, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, r.x * scale, r.y * scale, sw, sh, 0, 0, outW, outH);
    const d = ctx.getImageData(0, 0, outW, outH).data;
    const g = new Float32Array(outW * outH);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return { g, w: outW, h: outH, perCss: outW / r.w };
  };
  const A = gray(a, 220), B = gray(b, 220);
  const est = estimateShift(A.g, B.g, A.w, A.h);
  if (session) session.lastShift = { ...est, perCss: A.perCss };
  if (!est.moved) return 0;
  const A2 = gray(a, 660), B2 = gray(b, 660);
  const fine = refineShift(A2.g, B2.g, A2.w, A2.h, Math.round((est.dy / A.perCss) * A2.perCss), 5);
  return fine / A2.perCss;
}

function explainNoScroll(reason) {
  if (reason === 'permission') {
    panel.setNotice(h('div', { class: 'card notice' },
      h('strong', {}, 'Para que las arañas bajen la página solas'),
      h('p', { class: 'muted small' }, 'Activa Aracne en Ajustes del Sistema → Privacidad y seguridad → Accesibilidad. Esta vez leyeron solo lo que se veía.'),
      h('button', { class: 'btn small primary', onclick: () => api.perms.openAccessibility() }, 'Abrir Accesibilidad')));
  } else if (reason === 'wayland' || reason === 'unavailable') {
    panel.setNotice(h('div', { class: 'card notice' },
      h('strong', {}, 'Leyeron solo lo que se veía'),
      h('p', { class: 'muted small' }, reason === 'wayland'
        ? 'En sesiones Wayland de Linux no puedo bajar la página por ti. Baja tú y vuelve a pulsar el atajo.'
        : 'No pude mover la rueda del mouse en este sistema. Baja tú y vuelve a pulsar el atajo.')));
  }
}

// ---------------------------------------------------------------- terminar

async function finish() {
  const s = session;
  if (!s || s.stopping) return;
  s.stopping = true;
  const my = token;
  world.setScan(false);
  world.setScanMode(false);
  root.classList.remove('framing');
  frameBox.classList.remove('on');
  togglePanel(false);
  setStatus('volviendo a casa', null);
  counter.textContent = `${world.stats.found} HALLAZGOS`;
  const r = scanRect();
  const center = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  if (world.spiders.length) {
    await world.openPortal(center, 40);
    if (my !== token) return;
    await world.recallToPortal();
    if (my !== token) return;
    await sleep(200);
    await world.closePortal();
  } else world.flushLatent();
  if (my !== token) return;
  root.classList.add('closing');
  inkR = Math.max(inkR, maxRadius(center)); // la tinta cubre todo antes de recogerse hacia el agujero
  await animateInk(0, 1100, center);
  if (my !== token) return;
  await sleep(120);
  if (s.doc?.text.trim()) {
    root.classList.add('docked');
    root.classList.remove('on', 'closing');
    world.canvas.style.display = 'none';
    await api.overlay.dock('bubble');
    if (panel.notice) togglePanel(true);
  } else {
    root.classList.remove('on', 'closing');
    await api.overlay.hide();
  }
}

/** Cierra la burbuja y descarta lo encontrado. */
async function dismiss() {
  token++;
  session = null;
  panelOpen = false;
  root.classList.remove('docked', 'panel-open', 'on', 'ready', 'closing');
  if (world) {
    world.reset();
    world.spiders = [];
    world.setReader(null);
  }
  await api.overlay.hide();
}

function openInLector() {
  if (!session?.doc?.text.trim()) {
    toast('Todavía no hay texto leído.', 'warn');
    return;
  }
  const text = session.doc.blocks.map((b) => b.text).join('\n\n');
  api.overlay.openLector({ title: `Pantalla ${new Date().toLocaleString('es')}.txt`, text });
  dismiss();
}

// ---------------------------------------------------------------- enmarcar

function startFraming() {
  if (!session || session.stopping) return;
  togglePanel(false);
  root.classList.add('framing');
  showNotice(h('span', {}, icon('frame', 14), 'Dibuja el recuadro que deben escanear las arañas · Esc para cancelar'), 0);
}

function clearFrame() {
  if (!session) return;
  session.region = null;
  frameBox.classList.remove('on');
  world?.setRegion(null);
}

frameLayer.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const sx = e.clientX, sy = e.clientY;
  const box = h('div', { class: 'frame-draft' });
  clear(frameLayer, box);
  const move = (ev) => Object.assign(box.style, {
    left: `${Math.min(sx, ev.clientX)}px`, top: `${Math.min(sy, ev.clientY)}px`,
    width: `${Math.abs(ev.clientX - sx)}px`, height: `${Math.abs(ev.clientY - sy)}px`,
  });
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    clear(frameLayer);
    root.classList.remove('framing');
    notice.classList.remove('on');
    const r = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) };
    if (r.w < 60 || r.h < 40 || !session) return;
    session.region = r;
    Object.assign(frameBox.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    frameBox.classList.add('on');
    world.setRegion(() => ({ x: r.x, y: camY + r.y, w: r.w, h: r.h }));
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// ---------------------------------------------------------------- lupa: arrastrar sobre la pantalla

function cropToJpeg(r) {
  const cap = session.caps[session.caps.length - 1];
  const k = cap.scale;
  const yOff = (camY - cap.worldY) * k;
  const sx = Math.max(0, r.x * k), sy = Math.max(0, r.y * k + yOff);
  const sw = Math.min(cap.bitmap.width - sx, r.w * k), sh = Math.min(cap.bitmap.height - sy, r.h * k);
  const out = Math.min(1, 1600 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * out));
  c.height = Math.max(1, Math.round(sh * out));
  c.getContext('2d').drawImage(cap.bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.9);
  return { mime: 'image/jpeg', data: url.split(',')[1], thumb: url };
}

selLayer.addEventListener('mousedown', (e) => {
  if (!session || e.button !== 0 || root.classList.contains('docked')) return;
  const sx = e.clientX, sy = e.clientY;
  const box = h('div', { class: 'sel-box' });
  clear(selLayer, box);
  const move = (ev) => {
    Object.assign(box.style, {
      left: `${Math.min(sx, ev.clientX)}px`,
      top: `${Math.min(sy, ev.clientY)}px`,
      width: `${Math.abs(ev.clientX - sx)}px`,
      height: `${Math.abs(ev.clientY - sy)}px`,
    });
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    const r = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) };
    if (r.w < 14 || r.h < 14) {
      clear(selLayer);
      return;
    }
    box.classList.add('locked');
    const img = cropToJpeg(r);
    const wr = { x: r.x, y: r.y + camY, w: r.w, h: r.h };
    const context = session.doc ? session.doc.blocks.filter((b) => {
      const br = b.box;
      return br && br.y < wr.y + wr.h + 60 && br.y + br.h > wr.y - 60 && br.x < wr.x + wr.w && br.x + br.w > wr.x;
    }).map((b) => b.text).join(' ').slice(0, 700) : '';
    togglePanel(true);
    panel.analyzeCapture({ image: { mime: img.mime, data: img.data }, thumb: img.thumb, rects: [wr], context }).finally(() => setTimeout(() => box.remove(), 600));
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// La rueda del mouse mira lo que ya se leyó (sin salir de lo capturado).
stage.addEventListener('wheel', (e) => {
  if (!session?.caps.length || session.turning) return;
  const top = Math.max(0, session.caps[0].worldY);
  const bottom = session.caps[session.caps.length - 1].worldY;
  setCam(Math.max(top, Math.min(bottom, camY + e.deltaY)));
}, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (root.classList.contains('framing')) {
    root.classList.remove('framing');
    notice.classList.remove('on');
    clear(frameLayer);
    return;
  }
  if (!root.classList.contains('docked')) finish();
});

api.on('overlay:open', (p) => onOpen(p).catch((err) => {
  console.error(err);
  toast(`Error: ${cleanError(err)}`, 'error');
}));
api.on('overlay:close', () => finish());

warmUpOcr();
api.overlay.ready();
window.__overlay = { onOpen, finish, nextPage, get session() { return session; }, get world() { return world; }, get camY() { return camY; } };
void COLORS;
