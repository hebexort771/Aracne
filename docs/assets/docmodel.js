// Modelo de documento común: texto plano con posiciones y una forma de convertir
// cualquier tramo [inicio, fin) en rectángulos sobre la pantalla, para las arañas.
import { detectLang } from './lang.js';

const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, dt, dd, td, th, caption, .ar-block';
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG', 'BUTTON']);

function blockType(el) {
  const t = el.tagName;
  if (/^H[1-6]$/.test(t) || el.dataset?.type === 'heading') return 'heading';
  if (t === 'LI' || t === 'DD' || t === 'DT') return 'li';
  if (t === 'FIGCAPTION' || t === 'CAPTION') return 'caption';
  if (t === 'BLOCKQUOTE') return 'quote';
  if (t === 'PRE') return 'code';
  return 'p';
}

function mergeLineRects(rects) {
  const out = [];
  for (const r of rects) {
    if (r.w < 0.5 || r.h < 0.5) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && r.x <= last.x + last.w + 6 && r.x >= last.x - 2) {
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      const y0 = Math.min(last.y, r.y);
      const y1 = Math.max(last.y + last.h, r.y + r.h);
      last.w = x1 - last.x;
      last.y = y0;
      last.h = y1 - y0;
    } else out.push({ ...r });
  }
  return out;
}

/** Documento hecho de nodos del DOM (web, Word, texto, PDF con capa de texto). */
export class DomDoc {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root contenido
   * @param {HTMLElement} o.scroller contenedor con scroll
   * @param {HTMLElement} o.host elemento sin scroll sobre el que se pinta el lienzo
   * @param {HTMLElement[][]} [o.pdfBlocks] para PDF: grupos de spans ya agrupados en párrafos
   */
  constructor({ root, scroller, host, kind, title, source, meta = {}, pdfBlocks = null }) {
    Object.assign(this, { root, scroller, host, kind, title, source, meta });
    this.segments = [];
    this.blocks = [];
    this.layoutVersion = 0;
    this.rectCache = new Map();
    this.tokenCache = new Map();
    if (pdfBlocks) this.buildFromGroups(pdfBlocks);
    else this.buildFromDom();
    this.lang = detectLang(this.text);
    this.ro = new ResizeObserver(() => {
      this.layoutVersion++;
      this.rectCache.clear();
    });
    this.ro.observe(root);
    // Si cambia el ancho del visor (p. ej. al abrir el panel), el texto se mueve aunque no cambie de tamaño.
    if (scroller && scroller !== root) this.ro.observe(scroller);
    if (host && host !== scroller) this.ro.observe(host);
  }

  buildFromDom() {
    const all = [...this.root.querySelectorAll(BLOCK_SELECTOR)];
    const leaves = all.filter((el) => !el.querySelector(BLOCK_SELECTOR));
    let text = '';
    for (const el of leaves) {
      if (el.closest('[data-skip]')) continue;
      const start = text.length;
      const nodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          let p = n.parentElement;
          while (p && p !== el) {
            if (SKIP.has(p.tagName) || p.hasAttribute('data-skip')) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      let blockText = '';
      for (const node of nodes) {
        const v = node.nodeValue.replace(/\s+/g, ' ');
        if (!v) continue;
        this.segments.push({ node, start: text.length + blockText.length, len: node.nodeValue.length });
        blockText += node.nodeValue;
      }
      const clean = blockText.replace(/\s+/g, ' ').trim();
      if (clean.length < 2) {
        // Bloque vacío: deshacer sus segmentos
        while (this.segments.length && this.segments[this.segments.length - 1].start >= start) this.segments.pop();
        continue;
      }
      text += blockText;
      this.blocks.push({ id: this.blocks.length + 1, el, start, end: text.length, text: clean, type: blockType(el) });
      text += '\n\n';
    }
    this.text = text;
  }

  buildFromGroups(groups) {
    let text = '';
    for (const g of groups) {
      if (!g.spans.length) continue;
      const start = text.length;
      let prevTop = null;
      for (const span of g.spans) {
        const node = span.firstChild;
        if (!node || node.nodeType !== 3) continue;
        const top = parseFloat(span.style.top) || 0;
        if (text.length > start && !/\s$/.test(text)) {
          text += prevTop !== null && Math.abs(top - prevTop) > 2 ? '\n' : ' ';
        }
        this.segments.push({ node, start: text.length, len: node.nodeValue.length });
        text += node.nodeValue;
        prevTop = top;
      }
      const clean = text.slice(start).replace(/\s+/g, ' ').trim();
      if (clean.length < 2) continue;
      this.blocks.push({ id: this.blocks.length + 1, el: g.spans[0], page: g.page, start, end: text.length, text: clean, type: g.type || 'p' });
      text += '\n\n';
    }
    this.text = text;
  }

  segmentIndexAt(pos) {
    let lo = 0, hi = this.segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segments[mid];
      if (pos < s.start) hi = mid - 1;
      else if (pos >= s.start + s.len) lo = mid + 1;
      else return mid;
    }
    return Math.min(lo, this.segments.length - 1);
  }

  /** Posición global de (nodo, desplazamiento) → índice en this.text. */
  offsetOf(node, offset = 0) {
    for (const s of this.segments) if (s.node === node) return s.start + offset;
    return -1;
  }

  range(start, end) {
    if (!this.segments.length) return null;
    const a = this.segments[this.segmentIndexAt(start)];
    const b = this.segments[this.segmentIndexAt(Math.max(start, end - 1))];
    if (!a || !b) return null;
    const r = document.createRange();
    try {
      r.setStart(a.node, Math.min(Math.max(0, start - a.start), a.len));
      r.setEnd(b.node, Math.min(Math.max(0, end - b.start), b.len));
    } catch {
      return null;
    }
    return r;
  }

  hostOrigin() {
    const h = this.host.getBoundingClientRect();
    return { x: h.left - this.scroller.scrollLeft, y: h.top - this.scroller.scrollTop };
  }

  /** Rectángulos en coordenadas del mundo (contenido con scroll). */
  rectsFor(start, end) {
    const key = `${start}:${end}`;
    const cached = this.rectCache.get(key);
    if (cached && cached.v === this.layoutVersion) return cached.rects;
    const r = this.range(start, end);
    if (!r) return [];
    const o = this.hostOrigin();
    const rects = mergeLineRects([...r.getClientRects()].map((c) => ({ x: c.left - o.x, y: c.top - o.y, w: c.width, h: c.height })));
    this.rectCache.set(key, { v: this.layoutVersion, rects });
    return rects;
  }

  elementRects(el) {
    const o = this.hostOrigin();
    const c = el.getBoundingClientRect();
    return [{ x: c.left - o.x, y: c.top - o.y, w: c.width, h: c.height }];
  }

  blockRects(id) {
    const b = this.blocks[id - 1];
    if (!b) return [];
    const rects = this.rectsFor(b.start, b.end);
    if (!rects.length) return [];
    // Un solo rectángulo que envuelve el párrafo (más limpio para resaltar).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
  }

  blockAt(pos) {
    let lo = 0, hi = this.blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = this.blocks[mid];
      if (pos < b.start) hi = mid - 1;
      else if (pos > b.end) lo = mid + 1;
      else return b;
    }
    return null;
  }

  blockOfElement(el) {
    return this.blocks.find((b) => b.el === el || b.el.contains(el) || el.contains(b.el)) || null;
  }

  scrollToRects(rects, behavior = 'smooth') {
    if (!rects?.length) return;
    const y = Math.max(0, rects[0].y - this.scroller.clientHeight * 0.3);
    this.scroller.scrollTo({ top: y, behavior });
  }

  /** Texto visible en pantalla ahora (para preguntas sobre "lo que estoy leyendo"). */
  visibleBlocks() {
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    return this.blocks.filter((b) => {
      const r = this.blockRects(b.id)[0];
      return r && r.y + r.h > top && r.y < bottom;
    });
  }

  // ---------- Lectura continua (las arañas recorren renglón por renglón) ----------

  /** Renglones visibles en coordenadas del mundo. */
  readingLines(view) {
    const top = view.y - 4, bottom = view.y + view.h + 4;
    const out = [];
    for (const b of this.blocks) {
      const br = this.blockRects(b.id)[0];
      if (!br || br.y + br.h < top || br.y > bottom) continue;
      const rects = this.rectsFor(b.start, b.end);
      rects.forEach((r, i) => {
        if (r.w < 8 || r.h < 6 || r.h > 90 || r.y + r.h < top || r.y > bottom) return;
        out.push({ key: `${b.id}:${i}`, block: b.id, idx: i, heading: b.type === 'heading', x: r.x, y: r.y, w: r.w, h: r.h, start: b.start, end: b.end, words: () => this.lineWords(b, r) });
      });
    }
    return out;
  }

  blockTokens(b) {
    let t = this.tokenCache.get(b.id);
    if (!t) {
      t = [];
      const s = this.text.slice(b.start, b.end);
      for (const m of s.matchAll(/\S+/g)) {
        t.push({ s: b.start + m.index, e: b.start + m.index + m[0].length, text: m[0], r: null, v: -1 });
        if (t.length > 1500) break;
      }
      this.tokenCache.set(b.id, t);
    }
    return t;
  }

  /** Palabras de un renglón (búsqueda binaria: solo mide las palabras de ese renglón). */
  lineWords(b, line) {
    const tokens = this.blockTokens(b);
    if (!tokens.length) return [];
    const o = this.hostOrigin();
    const rectOf = (i) => {
      const tk = tokens[i];
      if (tk.v !== this.layoutVersion) {
        tk.v = this.layoutVersion;
        tk.r = null;
        const range = this.range(tk.s, tk.e);
        const c = range ? [...range.getClientRects()].find((x) => x.width > 0.5) : null;
        if (c) tk.r = { x: c.left - o.x, y: c.top - o.y, w: c.width, h: c.height };
      }
      return tk.r;
    };
    let lo = 0, hi = tokens.length - 1, first = tokens.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = rectOf(mid);
      if (!r || r.y + r.h / 2 < line.y) lo = mid + 1;
      else {
        first = mid;
        hi = mid - 1;
      }
    }
    const out = [];
    for (let i = first; i < tokens.length && out.length < 80; i++) {
      const r = rectOf(i);
      if (!r) continue;
      const cy = r.y + r.h / 2;
      if (cy > line.y + line.h + 1) break;
      if (cy >= line.y - 1 && r.x >= line.x - 2 && r.x <= line.x + line.w + 2) out.push({ ...r, text: tokens[i].text });
    }
    return out.sort((a, c) => a.x - c.x);
  }

  wordCount() {
    if (this._words === undefined) this._words = (this.text.match(/\S+/g) || []).length;
    return this._words;
  }

  destroy() {
    this.ro.disconnect();
  }
}

/** Tesseract a veces junta varios párrafos: se separan por saltos verticales, cambios de margen o de tamaño. */
export function ocrParagraphs(page, minConfidence = 55) {
  const paragraphs = [];
  for (const block of page.blocks || []) {
    for (const para of block.paragraphs || []) {
      let cur = [];
      let prev = null;
      for (const line of para.lines || []) {
        const words = (line.words || []).filter((w) => w.text.trim() && (w.confidence >= minConfidence || w.text.length > 3));
        if (!words.length) continue;
        const lh = line.bbox.y1 - line.bbox.y0;
        if (prev) {
          const gap = line.bbox.y0 - prev.bbox.y1;
          const prevH = prev.bbox.y1 - prev.bbox.y0;
          const jumpX = Math.abs(line.bbox.x0 - prev.bbox.x0) > Math.max(lh, prevH) * 6;
          if (gap > Math.max(lh, prevH) * 0.75 || jumpX || Math.abs(lh - prevH) > prevH * 0.45) {
            paragraphs.push(cur);
            cur = [];
          }
        }
        cur.push({ line, words });
        prev = line;
      }
      if (cur.length) paragraphs.push(cur);
    }
  }
  return paragraphs;
}

/**
 * Documento de pantalla de varias páginas: cada vez que las arañas bajan la página se agrega
 * lo nuevo (sin repetir lo que ya estaba). Las posiciones están en coordenadas del "mundo"
 * (la tira de capturas cosidas una debajo de otra).
 */
export class ScreenDoc {
  constructor({ kind = 'screen', title = 'Tu pantalla', source = '' } = {}) {
    Object.assign(this, { kind, title, source });
    this.words = [];
    this.lines = [];
    this.blocks = [];
    this.text = '';
    this.lang = 'es';
    this.pages = 0;
  }

  /**
   * @param {object} page resultado de tesseract
   * @param {(bbox:{x0,y0,x1,y1}) => {x,y,w,h}} map píxeles de la captura → mundo
   * @param {object} [o]
   * @param {number} [o.minY] se ignoran los renglones cuyo centro queda por encima (ya leídos)
   * @param {number} [o.maxY] y los cortados por el borde de abajo (se leen en la página siguiente)
   * @param {{x,y,w,h}} [o.region] solo lo que cae dentro (zona enmarcada)
   */
  addPage(page, map, { minY = -Infinity, maxY = Infinity, region = null, minConfidence = 55 } = {}) {
    const before = this.blocks.length;
    const inside = (r) => {
      const cy = r.y + r.h / 2, cx = r.x + r.w / 2;
      if (cy < minY || r.y + r.h > maxY) return false;
      if (region && (cy < region.y || cy > region.y + region.h || cx < region.x || cx > region.x + region.w)) return false;
      return true;
    };
    let text = this.text;
    for (const para of ocrParagraphs(page, minConfidence)) {
      const lines = para.map(({ line, words }) => ({ box: map(line.bbox), words })).filter((l) => inside(l.box));
      if (!lines.length) continue;
      if (text.length) text += '\n\n';
      const pStart = text.length;
      const blockId = this.blocks.length + 1;
      let box = null;
      lines.forEach(({ box: lb, words }, li) => {
        if (li > 0) text += '\n';
        const line = { box: lb, block: blockId, idx: li, words: [] };
        const lineIdx = this.lines.length;
        this.lines.push(line);
        box = box ? unionBox(box, lb) : { ...lb };
        words.forEach((w, i) => {
          if (i > 0) text += ' ';
          const word = { start: text.length, end: text.length + w.text.length, box: map(w.bbox), line: lineIdx, text: w.text };
          this.words.push(word);
          line.words.push(word);
          text += w.text;
        });
      });
      const pText = text.slice(pStart).replace(/\s+/g, ' ').trim();
      if (pText.length < 2) continue;
      // Título: renglón corto sin punto final cuyo texto llena su caja (no una barra de herramientas).
      const nWords = pText.split(/\s+/).length;
      const heading = pText.length < 70 && nWords <= 9 && !/[.,;:]$/.test(pText) && lines.length === 1 && box.w <= pText.length * box.h * 0.85;
      this.blocks.push({ id: blockId, start: pStart, end: text.length, text: pText, type: heading ? 'heading' : 'p', box, page: this.pages + 1 });
    }
    this.text = text;
    this.pages++;
    this.lang = detectLang(this.text);
    this._words = undefined;
    return { added: this.blocks.length - before };
  }

  rectsFor(start, end) {
    const byLine = new Map();
    for (const w of this.wordsIn(start, end)) {
      const prev = byLine.get(w.line);
      byLine.set(w.line, prev ? unionBox(prev, w.box) : { ...w.box });
    }
    return [...byLine.values()];
  }

  wordsIn(start, end) {
    // Búsqueda binaria: las palabras están en orden de texto.
    const ws = this.words;
    let lo = 0, hi = ws.length - 1, first = ws.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ws[mid].end > start) {
        first = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    const out = [];
    for (let i = first; i < ws.length && ws[i].start < end; i++) out.push(ws[i]);
    return out;
  }

  wordsText(start, end) {
    return this.wordsIn(start, end).map((w) => w.text).join(' ');
  }

  blockRects(id) {
    const b = this.blocks[id - 1];
    return b ? [b.box] : [];
  }

  blockAt(pos) {
    let lo = 0, hi = this.blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const b = this.blocks[mid];
      if (pos < b.start) hi = mid - 1;
      else if (pos > b.end) lo = mid + 1;
      else return b;
    }
    return null;
  }

  scrollToRects() {}

  visibleBlocks() {
    return this.blocks;
  }

  readingLines(view) {
    const out = [];
    this.lines.forEach((l, i) => {
      const r = l.box;
      if (!l.words.length || r.w < 8 || r.h < 5 || r.y + r.h < view.y || r.y > view.y + view.h) return;
      out.push({
        key: `S${i}`,
        block: l.block,
        idx: l.idx,
        ...r,
        start: l.words[0].start,
        end: l.words[l.words.length - 1].end,
        words: () => l.words.map((w) => ({ ...w.box, text: w.text })).sort((a, b) => a.x - b.x),
      });
    });
    return out;
  }

  wordCount() {
    return this.words.length;
  }

  destroy() {}
}

function unionBox(a, b) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Documento hecho con reconocimiento de texto (OCR) de una captura de pantalla. */
export class OcrDoc {
  /**
   * @param {object} page resultado de tesseract (blocks → paragraphs → lines → words)
   * @param {number} scale píxeles de la captura por píxel CSS
   * @param {{x:number,y:number}} offset desplazamiento del área analizada (lupa)
   */
  constructor(page, scale = 1, { kind = 'screen', title = 'Pantalla', source = '', offset = { x: 0, y: 0 }, minConfidence = 55 } = {}) {
    Object.assign(this, { kind, title, source, scale, offset });
    this.words = [];
    this.lines = [];
    this.blocks = [];
    let text = '';
    // Tesseract a veces junta varios párrafos: se separan por saltos verticales grandes.
    const paragraphs = [];
    for (const block of page.blocks || []) {
      for (const para of block.paragraphs || []) {
        let cur = [];
        let prev = null;
        for (const line of para.lines || []) {
          const words = (line.words || []).filter((w) => w.text.trim() && (w.confidence >= minConfidence || w.text.length > 3));
          if (!words.length) continue;
          const lh = line.bbox.y1 - line.bbox.y0;
          if (prev) {
            const gap = line.bbox.y0 - prev.bbox.y1;
            const prevH = prev.bbox.y1 - prev.bbox.y0;
            const jumpX = Math.abs(line.bbox.x0 - prev.bbox.x0) > Math.max(lh, prevH) * 6;
            if (gap > Math.max(lh, prevH) * 0.75 || jumpX || Math.abs(lh - prevH) > prevH * 0.45) {
              paragraphs.push(cur);
              cur = [];
            }
          }
          cur.push({ line, words });
          prev = line;
        }
        if (cur.length) paragraphs.push(cur);
      }
    }
    for (const lines of paragraphs) {
      const pStart = text.length;
      const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      lines.forEach(({ line, words }, li) => {
        if (text.length > pStart) text += '\n';
        const lineIdx = this.lines.length;
        this.lines.push({ bbox: line.bbox, block: this.blocks.length + 1, idx: li, words: [] });
        bbox.x0 = Math.min(bbox.x0, line.bbox.x0); bbox.y0 = Math.min(bbox.y0, line.bbox.y0);
        bbox.x1 = Math.max(bbox.x1, line.bbox.x1); bbox.y1 = Math.max(bbox.y1, line.bbox.y1);
        words.forEach((w, i) => {
          if (i > 0) text += ' ';
          const word = { start: text.length, end: text.length + w.text.length, bbox: w.bbox, line: lineIdx, text: w.text };
          this.words.push(word);
          this.lines[lineIdx].words.push(word);
          text += w.text;
        });
      });
      const pText = text.slice(pStart).replace(/\s+/g, ' ').trim();
      if (pText.length >= 2) {
        const heading = pText.length < 90 && !/[.,;:]$/.test(pText) && lines.length === 1;
        this.blocks.push({ id: this.blocks.length + 1, start: pStart, end: text.length, text: pText, type: heading ? 'heading' : 'p', bbox });
      }
      if (text.length > pStart) text += '\n\n';
    }
    this.text = text;
    this.lang = detectLang(text);
  }

  toCss(b) {
    // scale y offset pueden ser funciones (imagen que cambia de tamaño en el lector).
    const k = typeof this.scale === 'function' ? this.scale() : this.scale;
    const o = typeof this.offset === 'function' ? this.offset() : this.offset;
    return {
      x: b.x0 / k + o.x,
      y: b.y0 / k + o.y,
      w: (b.x1 - b.x0) / k,
      h: (b.y1 - b.y0) / k,
    };
  }

  rectsFor(start, end) {
    const byLine = new Map();
    for (const w of this.words) {
      if (w.end <= start || w.start >= end) continue;
      const r = this.toCss(w.bbox);
      const prev = byLine.get(w.line);
      if (!prev) byLine.set(w.line, r);
      else {
        const x0 = Math.min(prev.x, r.x), y0 = Math.min(prev.y, r.y);
        const x1 = Math.max(prev.x + prev.w, r.x + r.w), y1 = Math.max(prev.y + prev.h, r.y + r.h);
        byLine.set(w.line, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    return [...byLine.values()];
  }

  /** Texto exacto de las palabras que cubre el tramo (para re-escribirlo en el recuadro). */
  wordsText(start, end) {
    return this.words.filter((w) => w.end > start && w.start < end).map((w) => w.text).join(' ');
  }

  blockRects(id) {
    const b = this.blocks[id - 1];
    return b ? [this.toCss(b.bbox)] : [];
  }

  blockAt(pos) {
    return this.blocks.find((b) => pos >= b.start && pos <= b.end) || null;
  }

  scrollToRects() {}

  visibleBlocks() {
    return this.blocks;
  }

  readingLines(view) {
    const out = [];
    this.lines.forEach((l, i) => {
      if (!l.words.length) return;
      const r = this.toCss(l.bbox);
      if (r.w < 8 || r.h < 5 || r.y + r.h < view.y || r.y > view.y + view.h) return;
      out.push({
        key: `L${i}`,
        block: l.block,
        idx: l.idx,
        ...r,
        start: l.words[0].start,
        end: l.words[l.words.length - 1].end,
        words: () => l.words.map((w) => ({ ...this.toCss(w.bbox), text: w.text })).sort((a, b) => a.x - b.x),
      });
    });
    return out;
  }

  wordCount() {
    return this.words.length;
  }

  destroy() {}
}
