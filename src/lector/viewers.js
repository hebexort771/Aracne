// Visores del lector: página web (modo lectura), PDF, Word, texto e imágenes.
import DOMPurify from 'dompurify';
import { Readability } from '@mozilla/readability';
import { h } from '../core/ui.js';

const PURIFY = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'video', 'audio', 'source', 'link', 'meta', 'noscript', 'svg'],
  FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'srcset', 'sizes', 'class'],
  ALLOW_DATA_ATTR: false,
};

function sanitize(html) {
  return DOMPurify.sanitize(html, PURIFY);
}

function articleShell(title, metaLine) {
  return h('article', { class: 'reader' },
    h('header', { class: 'reader-head', 'data-skip': '' },
      metaLine ? h('div', { class: 'reader-meta' }, metaLine) : null,
      h('h1', { class: 'reader-title' }, title || 'Sin título')));
}

function fixLinks(root, baseUrl) {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) continue;
    try {
      a.setAttribute('href', new URL(href, baseUrl).toString());
    } catch {
      a.removeAttribute('href');
    }
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || img.getAttribute('data-src');
    if (!src) {
      img.remove();
      continue;
    }
    try {
      img.setAttribute('src', new URL(src, baseUrl).toString());
    } catch {
      img.remove();
      continue;
    }
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    img.removeAttribute('width');
    img.removeAttribute('height');
  }
}

// ---------------------------------------------------------------- Web

export function renderWeb(page) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(page.html, 'text/html');
  const base = dom.createElement('base');
  base.href = page.url;
  dom.head.prepend(base);
  // Wikipedia y similares: quita barras de navegación antes del análisis.
  dom.querySelectorAll('nav, footer, .navbox, .mw-editsection, .reference-accessdate + .reference-text ~ .noprint, [role="navigation"], .sidebar, .infobox-navbar, .noprint, .mw-jump-link').forEach((n) => n.remove());
  let art = null;
  try {
    art = new Readability(dom.cloneNode(true), { charThreshold: 300, keepClasses: false }).parse();
  } catch {
    art = null;
  }
  const isWiki = /(^|\.)wikipedia\.org$/i.test((() => { try { return new URL(page.url).hostname; } catch { return ''; } })());
  const title = (art?.title || page.title || page.url).replace(/\s+[-–—]\s+Wikipedia.*$/i, '');
  const site = isWiki ? 'Wikipedia' : art?.siteName || page.meta?.site || (/^https?:/.test(page.url) ? new URL(page.url).hostname.replace(/^www\./, '') : '');
  const byline = isWiki ? '' : art?.byline || page.meta?.author || '';
  const published = isWiki ? '' : art?.publishedTime || page.meta?.published || '';
  const metaLine = [site, byline, published ? new Date(published).toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' }) : ''].filter(Boolean).join(' · ');
  const article = articleShell(title, metaLine);
  const body = h('div', { class: 'reader-body' });
  body.innerHTML = sanitize(art?.content || dom.body?.innerHTML || '');
  fixLinks(body, page.url);
  article.appendChild(body);
  const meta = {
    type: 'web',
    title,
    site: /^https?:/.test(page.url) ? site : '',
    url: /^https?:/.test(page.url) ? page.url : '',
    authors: byline && !/^(por|by)\s*$/i.test(byline) && byline.length < 80 && !/contributors|colaboradores|projects|proyectos|staff|redacci[oó]n|equipo|editors?\b/i.test(byline)
      ? byline.replace(/^(por|by)\s+/i, '').split(/\s*(?:,| y | and | & )\s*/).filter(Boolean).slice(0, 6).map((name) => ({ name }))
      : [],
    accessed: new Date().toISOString(),
  };
  if (published) {
    const d = new Date(published);
    if (!Number.isNaN(d.getTime())) Object.assign(meta, { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
  }
  return { el: article, title, meta, kind: 'web', source: page.url };
}

// ---------------------------------------------------------------- Texto / Markdown / HTML local

export function renderText(name, text) {
  const isMd = /\.md$/i.test(name);
  const article = articleShell(name.replace(/\.[^.]+$/, ''), isMd ? 'Markdown' : 'Texto');
  const body = h('div', { class: 'reader-body' });
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const p of paras) {
    const t = p.trim();
    if (!t) continue;
    const m = isMd && t.match(/^(#{1,6})\s+(.*)$/);
    if (m) body.appendChild(h(`h${Math.min(6, m[1].length + 1)}`, {}, m[2]));
    else if (isMd && /^[-*]\s/m.test(t)) body.appendChild(h('ul', {}, t.split('\n').map((l) => h('li', {}, l.replace(/^[-*]\s+/, '')))));
    else body.appendChild(h('p', {}, t.replace(/\n/g, ' ')));
  }
  article.appendChild(body);
  return { el: article, title: name.replace(/\.[^.]+$/, ''), meta: { type: 'web', title: name, authors: [], accessed: new Date().toISOString() }, kind: 'text', source: name };
}

export function renderHtmlFile(name, html) {
  return renderWeb({ html, url: `file:///${encodeURIComponent(name)}`, title: name, meta: {} });
}

// ---------------------------------------------------------------- Word

export async function renderDocx(name, bytes) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.min.js');
  const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const article = articleShell(name.replace(/\.docx$/i, ''), 'Documento de Word');
  const body = h('div', { class: 'reader-body' });
  body.innerHTML = DOMPurify.sanitize(res.value, { ...PURIFY, FORBID_ATTR: ['style', 'onerror', 'onload', 'class'], ADD_DATA_URI_TAGS: ['img'] });
  article.appendChild(body);
  const firstHeading = body.querySelector('h1, h2');
  const title = firstHeading?.textContent.trim() || name.replace(/\.docx$/i, '');
  return { el: article, title, meta: { type: 'web', title, authors: [], accessed: new Date().toISOString() }, kind: 'docx', source: name };
}

// ---------------------------------------------------------------- PDF

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsPromise;
}

/**
 * Dibuja el PDF: cada página tiene un lienzo (se pinta al acercarse) y una capa de texto (siempre).
 * @returns {Promise<{el, title, meta, kind, groups, pages, destroy}>}
 */
export async function renderPdf(name, bytes, { width = 860, onProgress = () => {} } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const pdf = await task.promise;
  let info = {};
  try {
    info = (await pdf.getMetadata())?.info || {};
  } catch {
    info = {};
  }
  const title = (info.Title && String(info.Title).trim().length > 3 ? String(info.Title).trim() : '') || name.replace(/\.pdf$/i, '');
  const wrap = h('div', { class: 'pdf-doc' });
  const maxPages = Math.min(pdf.numPages, 400);
  const pages = [];
  const groups = [];

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        const p = pages[Number(e.target.dataset.page) - 1];
        if (p && !p.painted) paint(p);
      }
    }
  }, { rootMargin: '900px 0px' });

  async function paint(p) {
    p.painted = true;
    const outputScale = window.devicePixelRatio || 1;
    const canvas = h('canvas', { class: 'pdf-canvas' });
    canvas.width = Math.floor(p.viewport.width * outputScale);
    canvas.height = Math.floor(p.viewport.height * outputScale);
    canvas.style.width = `${p.viewport.width}px`;
    canvas.style.height = `${p.viewport.height}px`;
    p.el.prepend(canvas);
    try {
      await p.page.render({
        canvas,
        viewport: p.viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
      }).promise;
    } catch (err) {
      console.warn('Página no dibujada', err);
    }
  }

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const viewport = page.getViewport({ scale });
    const el = h('div', { class: 'pdf-page', dataset: { page: String(i) } });
    el.style.width = `${viewport.width}px`;
    el.style.height = `${viewport.height}px`;
    el.style.setProperty('--total-scale-factor', String(scale));
    el.style.setProperty('--scale-factor', String(scale));
    el.style.setProperty('--scale-round-x', '1px');
    el.style.setProperty('--scale-round-y', '1px');
    const textDiv = h('div', { class: 'textLayer' });
    el.appendChild(textDiv);
    el.appendChild(h('div', { class: 'pdf-num', 'data-skip': '' }, String(i)));
    wrap.appendChild(el);
    const p = { page, viewport, el, textDiv, painted: false, index: i };
    pages.push(p);
    io.observe(el);
    onProgress(i / maxPages);
  }

  return {
    el: wrap,
    title,
    kind: 'pdf',
    source: name,
    meta: {
      type: 'web',
      title,
      authors: info.Author ? String(info.Author).split(/[;,]| y | and /).map((n) => ({ name: n.trim() })).filter((a) => a.name) : [],
      year: parseYear(info.CreationDate),
      site: '',
      accessed: new Date().toISOString(),
    },
    pages,
    numPages: pdf.numPages,
    /** Se llama después de insertar el PDF en la página (necesita medidas reales). */
    async buildText() {
      for (const p of pages) {
        const tc = await p.page.getTextContent();
        const layer = new pdfjs.TextLayer({ textContentSource: tc, container: p.textDiv, viewport: p.viewport });
        await layer.render();
        groups.push(...groupSpans(layer.textDivs, p.index));
      }
      return groups;
    },
    pageImage(index, maxWidth = 1600) {
      const p = pages[index - 1];
      if (!p) return null;
      const s = Math.min(2, maxWidth / p.viewport.width);
      const vp = p.page.getViewport({ scale: p.viewport.scale * s });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      return p.page.render({ canvas, viewport: vp }).promise.then(() => canvas);
    },
    destroy() {
      io.disconnect();
      task.destroy();
    },
  };
}

function parseYear(d) {
  const m = String(d || '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/** Agrupa los fragmentos de texto del PDF en párrafos según su posición. */
function groupSpans(spans, page) {
  const items = [];
  for (const s of spans) {
    if (!s.textContent || !s.textContent.trim()) continue;
    const r = s.getBoundingClientRect();
    if (r.width < 0.5) continue;
    items.push({ s, top: r.top, left: r.left, h: r.height, bottom: r.bottom, right: r.right });
  }
  const groups = [];
  let cur = null;
  let lineTop = null;
  let lineH = 0;
  let lineLeft = 0;
  for (const it of items) {
    const sameLine = lineTop !== null && Math.abs(it.top - lineTop) < Math.max(3, it.h * 0.5);
    if (sameLine) {
      cur.spans.push(it.s);
      continue;
    }
    const gap = lineTop === null ? Infinity : it.top - (lineTop + lineH);
    const newCol = lineTop !== null && it.top < lineTop - lineH * 2;
    const sizeJump = lineH && Math.abs(it.h - lineH) > lineH * 0.35;
    if (!cur || gap > lineH * 0.85 || newCol || sizeJump || Math.abs(it.left - lineLeft) > 220) {
      cur = { spans: [], page, type: 'p' };
      groups.push(cur);
    }
    cur.spans.push(it.s);
    lineTop = it.top;
    lineH = it.h;
    lineLeft = it.left;
  }
  // Títulos: grupos cortos de una línea con letra más grande que el promedio.
  const avg = items.reduce((a, b) => a + b.h, 0) / (items.length || 1);
  for (const g of groups) {
    const first = g.spans[0].getBoundingClientRect();
    const text = g.spans.map((s) => s.textContent).join(' ').trim();
    if (first.height > avg * 1.25 && text.length < 120) g.type = 'heading';
  }
  return groups;
}

// ---------------------------------------------------------------- Imagen

export function renderImage(name, url) {
  const article = articleShell(name.replace(/\.[^.]+$/, ''), 'Imagen');
  const img = h('img', { class: 'reader-image', src: url, alt: name });
  article.appendChild(h('div', { class: 'reader-body image-body' }, h('figure', {}, img)));
  return { el: article, title: name, meta: { type: 'web', title: name, authors: [], accessed: new Date().toISOString() }, kind: 'image', source: name, img };
}
