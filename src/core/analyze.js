// Corre todas las arañas que no necesitan IA sobre un documento.
import { extractSources, extractAcronyms, extractInternalRefs, blockMatchesRef, looksLikeReference } from './extract.js';
import { extractDates } from './dates.js';
import { readability, hardestSentences } from './lang.js';
import { keyTerms } from './textrank.js';

const REF_HEADING = /referenc|bibliograf|fuentes|notas|citas|citations|works cited|further reading|lecturas|enlaces externos|external links|sources|notes/i;

function isLink(href) {
  return /^https?:\/\//i.test(href);
}

function normalizeUrlId(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * @param {import('./docmodel.js').DomDoc|import('./docmodel.js').OcrDoc} doc
 */
export function analyzeDocument(doc, now = new Date()) {
  const text = doc.text;
  const refBlocks = new Set(doc.blocks.filter((b) => looksLikeReference(b.text)).map((b) => b.id));

  // Para documentos web: bloques bajo un título de "Referencias", "Bibliografía"…
  if (doc.root) {
    let inRefs = false;
    for (const b of doc.blocks) {
      if (b.type === 'heading') inRefs = REF_HEADING.test(b.text);
      else if (inRefs) refBlocks.add(b.id);
    }
  }
  const inRefAt = (pos) => {
    const b = doc.blockAt(pos);
    return b ? refBlocks.has(b.id) : false;
  };

  // ---- Fuentes ----
  const seen = new Map();
  const sources = [];
  for (const s of extractSources(text)) {
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) {
      seen.get(key).occurrences.push({ start: s.start, end: s.end });
      continue;
    }
    const item = { ...s, key, occurrences: [{ start: s.start, end: s.end }], inRefs: inRefAt(s.start) };
    seen.set(key, item);
    sources.push(item);
  }
  // Enlaces de la bibliografía (en páginas web los enlaces no se ven como texto).
  if (doc.root) {
    for (const a of doc.root.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!isLink(href)) continue;
      const b = doc.blockOfElement(a);
      if (!b || !refBlocks.has(b.id)) continue;
      const doiMatch = href.match(/doi\.org\/(10\.\d{4,9}\/[^?#\s]+)/i);
      const type = doiMatch ? 'doi' : 'url';
      const id = doiMatch ? decodeURIComponent(doiMatch[1]).toLowerCase() : normalizeUrlId(href);
      if (type === 'url' && /wikipedia\.org\/wiki\/|wikidata\.org|web\.archive\.org|archive\.(org|today|ph)|worldcat\.org|ui\.adsabs|semanticscholar|search\.worldcat|books\.google|ncbi\.nlm\.nih\.gov\/pubmed\/\d|pubmed\.ncbi|doi\.org|api\.semanticscholar|jstor\.org\/stable\/\d|s2cid|openlibrary\.org|bibcode|hdl\.handle|osti\.gov|zbmath|mathscinet|arxiv\.org\/abs/i.test(id)) continue;
      const node = a.firstChild && a.firstChild.nodeType === 3 ? a.firstChild : null;
      const start = node ? doc.offsetOf(node, 0) : -1;
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      const item = {
        type,
        id,
        key,
        raw: a.textContent.trim(),
        start: start >= 0 ? start : b.start,
        end: start >= 0 ? start + node.nodeValue.length : Math.min(b.end, b.start + 20),
        occurrences: [],
        inRefs: true,
        fromLink: true,
      };
      item.occurrences.push({ start: item.start, end: item.end });
      seen.set(key, item);
      sources.push(item);
    }
  }
  sources.sort((a, b) => a.start - b.start);

  // ---- Fechas ----
  const dates = extractDates(text, doc.lang, now, inRefAt);

  // ---- Siglas ----
  const acronyms = extractAcronyms(text);

  // ---- Referencias internas (figuras, tablas, secciones, citas) ----
  const refs = [];
  // Lista numerada de la bibliografía (en web y Word los números son viñetas, no texto).
  let refList = null;
  if (doc.root) {
    const lists = [...doc.root.querySelectorAll('ol')].filter((ol) => {
      const li = ol.querySelector('li');
      const b = li && doc.blockOfElement(li);
      return b && refBlocks.has(b.id);
    });
    refList = lists[lists.length - 1] || null;
  }
  for (const r of extractInternalRefs(text)) {
    const own = doc.blockAt(r.start);
    let target = null;
    if (r.kind === 'cite') {
      target = doc.blocks.find((b) => b !== own && b.type !== 'heading' && new RegExp(`^\\[${r.num}\\]`).test(b.text));
      if (!target && refList) {
        const li = refList.querySelectorAll(':scope > li')[Number(r.num) - 1];
        if (li) target = doc.blockOfElement(li);
      }
      if (!target) target = doc.blocks.find((b) => b !== own && b.type !== 'heading' && refBlocks.has(b.id) && blockMatchesRef(b.text, r));
    } else {
      target = doc.blocks.find((b) => b !== own && blockMatchesRef(b.text, r));
    }
    if (target) refs.push({ ...r, target: target.id });
  }
  // Enlaces internos (#nota-12) de páginas web: notas al pie, citas de Wikipedia, etc.
  if (doc.root) {
    for (const a of doc.root.querySelectorAll('a[href^="#"]')) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (!id) continue;
      let targetEl = null;
      try {
        targetEl = doc.root.querySelector(`[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
      } catch {
        targetEl = null;
      }
      if (!targetEl) continue;
      const tb = doc.blockOfElement(targetEl);
      const node = a.firstChild && a.firstChild.nodeType === 3 ? a.firstChild : a.querySelector('*')?.firstChild;
      if (!tb || !node || node.nodeType !== 3) continue;
      const start = doc.offsetOf(node, 0);
      if (start < 0) continue;
      const own = doc.blockAt(start);
      if (own && own.id === tb.id) continue;
      refs.push({ kind: 'anchor', num: a.textContent.trim(), label: a.textContent.trim(), start, end: start + node.nodeValue.length, target: tb.id });
    }
  }
  refs.sort((a, b) => a.start - b.start);

  // ---- Lectura ----
  const mainText = doc.blocks.filter((b) => !refBlocks.has(b.id) && b.type !== 'heading').map((b) => b.text).join('\n\n');
  const stats = readability(mainText || text, doc.lang);
  const hard = hardestSentences(mainText || text, 3).map((s) => {
    const idx = text.indexOf(s.text.slice(0, 40));
    return { ...s, block: idx >= 0 ? doc.blockAt(idx)?.id : null };
  });
  const keywords = keyTerms(mainText || text, 40);

  return { sources, dates, acronyms, refs, stats, hard, keywords, refBlocks };
}
