// Capa de pantalla: aparece con el atajo sobre cualquier aplicación.
// Toma la captura, la invierte con una línea de escaneo, la lee con OCR y suelta las arañas.
import '../styles/base.css';
import '../styles/panel.css';
import '../styles/overlay.css';
import 'katex/dist/katex.min.css';
import { api } from '../core/bridge.js';
import { h, clear, icon, toast, cleanError } from '../core/ui.js';
import { SpiderWorld } from '../spiders/engine.js';
import { OcrDoc } from '../core/docmodel.js';
import { analyzeDocument } from '../core/analyze.js';
import { buildTargets } from '../core/targets.js';
import { recognize, warmUpOcr } from '../core/ocr.js';
import { Panel } from '../panel/panel.js';

document.documentElement.classList.add(`os-${api.platform}`);

const base = h('img', { class: 'shot base', alt: '', draggable: 'false' });
const inv = h('img', { class: 'shot inv', alt: '', draggable: 'false' });
const selLayer = h('div', { class: 'sel-layer' });
const status = h('span', { class: 'hud-status' }, 'listo');
const progressBar = h('span', { class: 'hud-progress' }, h('i'));
const invertBtn = h('button', { class: 'hud-btn', title: 'Invertir colores', onclick: () => setInverted(!inverted) }, icon('contrast', 16));
const lectorBtn = h('button', { class: 'hud-btn', title: 'Abrir este texto en el lector', onclick: () => openInLector() }, icon('reading', 16));
const spiderBtn = h('button', { class: 'hud-btn', title: 'Pausar o soltar las arañas', onclick: () => toggleSpiders() }, icon('spider', 16));
const counter = h('span', { class: 'hud-counter' });
const exitBtn = h('button', { class: 'hud-btn exit', title: 'Salir (Esc)', onclick: () => close() }, icon('close', 16), h('span', { class: 'hud-key' }, 'Esc'));
const hud = h('div', { class: 'hud' },
  h('span', { class: 'hud-logo' }, h('img', { src: 'icon.svg', alt: '' }), 'ARACNE'),
  h('span', { class: 'hud-sep' }, '//'),
  status, progressBar, counter, spiderBtn, invertBtn, lectorBtn, exitBtn);
const hint = h('div', { class: 'hint' }, icon('lens', 14), 'Arrastra un recuadro para analizar esa zona con la lupa · Esc para salir');
const stage = h('div', { class: 'stage' }, base, inv, h('div', { class: 'vignette' }), selLayer, hud, hint);
const panelWrap = h('div', { class: 'ov-panel' });
const root = h('div', { class: 'ov' }, stage, panelWrap);
document.body.appendChild(root);

let settings = await api.settings.get();
let world = null;
let panel = null;
let session = null; // {token, imageBitmap, width, height, scale, doc, findings}
let inverted = false;
let open = false;
let token = 0;

panel = new Panel({
  mount: panelWrap,
  mode: 'overlay',
  hooks: {
    startLens: () => {
      hint.classList.add('flash');
      setTimeout(() => hint.classList.remove('flash'), 1200);
    },
    listImages: () => (session ? [{ label: 'Pantalla completa', rects: () => [{ x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight }], context: session.doc?.text.slice(0, 600) || '', load: () => cropToJpeg({ x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight }) }] : []),
    openSettings: () => {
      close();
      api.overlay.openLector({ settings: true });
    },
    openSource: (url) => {
      close();
      api.overlay.openLector({ url });
    },
  },
});

api.on('settings:changed', (s) => {
  settings = s;
  world?.setIntensity(s.animation);
  world?.setPatrol(s.patrol !== false);
});

function setInverted(on) {
  inverted = on;
  root.classList.toggle('inverted', on);
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

async function onOpen(payload) {
  const my = ++token;
  open = true;
  settings = payload.settings || settings;
  const blob = new Blob([payload.image], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  if (base.src) URL.revokeObjectURL(base.src);
  base.src = url;
  inv.src = url;
  await Promise.all([base.decode().catch(() => {}), inv.decode().catch(() => {})]);
  const bitmap = await createImageBitmap(blob);
  if (my !== token) return;
  session = { token: my, bitmap, width: payload.width, height: payload.height, scale: payload.scale, doc: null, findings: null };

  const lum = luminance(bitmap);
  const shouldInvert = settings.invertScreen === 'siempre' || (settings.invertScreen === 'auto' && lum > 0.5);
  root.classList.remove('closing');
  root.classList.add('opening');
  setInverted(shouldInvert);
  requestAnimationFrame(() => root.classList.add('on'));

  if (!world) {
    world = new SpiderWorld({ host: stage, intensity: settings.animation, solidText: true, stars: true });
    world.canvas.style.zIndex = '3';
    world.on('arrive', (t) => {
      const view = railViewFor(t?.species);
      const btn = panelWrap.querySelector(`.rail-btn[data-view="${view}"]`);
      if (!btn) return;
      btn.classList.remove('ping');
      void btn.offsetWidth;
      btn.classList.add('ping');
    });
  } else {
    world.reset();
    world.setIntensity(settings.animation);
  }
  // Lo que tapa el panel no cuenta como zona de lectura.
  world.setInsets({ right: (panelWrap.offsetWidth || 478) + 24 });
  world.setPatrol(settings.patrol !== false);
  if (!world.active) world.setActive(true);
  world.spawn(Math.min(world.maxSpiders, 5));
  world.setScan(true);
  counter.textContent = '';
  panel.doc = null;
  panel.show('overview');
  panel.setHead?.('Leyendo tu pantalla…');
  clear(panel.body, h('div', { class: 'working' }, h('div', { class: 'mini-web' }, h('span'), h('span'), h('span')), h('p', {}, 'Las arañas están leyendo el texto de tu pantalla…')));
  setStatus('escaneando', 0);

  // OCR a un tamaño razonable (más rápido y suficiente para leer).
  const maxW = 2200;
  const k = Math.min(1, maxW / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const cssW = stage.clientWidth || window.innerWidth;
  let page;
  try {
    page = await recognize(canvas, (p) => my === token && setStatus('escaneando', p));
  } catch (err) {
    console.error(err);
    toast(`No se pudo leer la pantalla: ${cleanError(err)}`, 'error', 6000);
    page = { blocks: [] };
  }
  if (my !== token || !open) return;
  world.setScan(false);
  const doc = new OcrDoc(page, canvas.width / cssW, { kind: 'screen', title: 'Tu pantalla', source: '' });
  const findings = analyzeDocument(doc);
  session.doc = doc;
  session.findings = findings;
  panel.setDocument(doc, findings, world);
  panel.show('overview');
  const { chosen, rest } = buildTargets(doc, findings, { max: 60 });
  const panelPoint = (view) => () => {
    const btn = panelWrap.querySelector(`.rail-btn[data-view="${view}"]`);
    const r = btn?.getBoundingClientRect();
    return r ? { x: r.left - 4, y: r.top + r.height / 2 } : { x: stage.clientWidth - 420, y: 200 };
  };
  for (const t of [...chosen, ...rest]) t.carryTo = panelPoint(railViewFor(t.species));
  world.setReader(doc);
  world.deploy(chosen);
  // El resto aparece cuando una araña lee el renglón donde está.
  world.addLatent(rest);
  setStatus(doc.text.trim() ? `${doc.blocks.length} párrafos` : 'no encontré texto', 1);
}

function railViewFor(species) {
  return species === 'dates' ? 'dates' : species === 'sources' ? 'sources' : species === 'context' ? 'context' : 'overview';
}

function toggleSpiders() {
  if (!world) return;
  world.setActive(!world.active);
  spiderBtn.classList.toggle('off', !world.active);
}

// Contador en vivo
setInterval(() => {
  if (!world || !open || !session?.doc) return;
  const st = world.stats;
  spiderBtn.classList.toggle('off', !st.active);
  counter.textContent = st.active
    ? `${st.found} HALLAZGOS · LEÍDO ${Math.round(st.progress * 100)}%`
    : `${st.found} HALLAZGOS · EN PAUSA`;
}, 250);

function setStatus(text, progress) {
  status.textContent = text;
  progressBar.querySelector('i').style.width = `${Math.round((progress ?? 0) * 100)}%`;
  progressBar.classList.toggle('done', progress >= 1);
}

async function close() {
  if (!open) return;
  open = false;
  token++;
  root.classList.add('closing');
  root.classList.remove('on');
  world?.setReader(null);
  world?.reset();
  world?.setScan(false);
  await new Promise((r) => setTimeout(r, 380));
  if (world && !open) world.spiders = []; // la próxima vez vuelven a bajar colgadas de su hilo
  root.classList.remove('opening', 'closing');
  clear(selLayer);
  await api.overlay.hide();
}

function openInLector() {
  if (!session?.doc?.text.trim()) {
    toast('Todavía no hay texto leído.', 'warn');
    return;
  }
  const text = session.doc.blocks.map((b) => b.text).join('\n\n');
  close();
  api.overlay.openLector({ title: `Pantalla ${new Date().toLocaleString('es')}.txt`, text });
}

// ---------------------------------------------------------------- lupa: arrastrar sobre la pantalla

function cropToJpeg(r) {
  const s = session;
  const k = s.bitmap.width / stage.clientWidth;
  const sx = Math.max(0, r.x * k), sy = Math.max(0, r.y * k);
  const sw = Math.min(s.bitmap.width - sx, r.w * k), sh = Math.min(s.bitmap.height - sy, r.h * k);
  const out = Math.min(1, 1600 / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * out));
  c.height = Math.max(1, Math.round(sh * out));
  c.getContext('2d').drawImage(s.bitmap, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.9);
  return { mime: 'image/jpeg', data: url.split(',')[1], thumb: url };
}

selLayer.addEventListener('mousedown', (e) => {
  if (!session || e.button !== 0) return;
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
    const context = session.doc ? session.doc.blocks.filter((b) => {
      const br = session.doc.blockRects(b.id)[0];
      return br && br.y < r.y + r.h + 60 && br.y + br.h > r.y - 60 && br.x < r.x + r.w && br.x + br.w > r.x;
    }).map((b) => b.text).join(' ').slice(0, 700) : '';
    panel.analyzeCapture({ image: { mime: img.mime, data: img.data }, thumb: img.thumb, rects: [r], context }).finally(() => setTimeout(() => box.remove(), 600));
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close();
});

api.on('overlay:open', (p) => onOpen(p).catch((err) => {
  console.error(err);
  toast(`Error: ${cleanError(err)}`, 'error');
}));
api.on('overlay:close', () => close());

warmUpOcr();
api.overlay.ready();
window.__overlay = { onOpen, close, get session() { return session; } };
