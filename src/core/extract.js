// Extractores de "presas" para las arañas: fuentes, siglas y referencias internas.
// Todos trabajan sobre texto plano y devuelven posiciones [start, end).

const TRAIL = /[.,;:!?'"”’)\]}>]+$/;

function trimTrailing(s) {
  let out = s;
  // Quita puntuación final, pero conserva paréntesis equilibrados (DOIs con "(...)").
  for (;;) {
    const m = out.match(TRAIL);
    if (!m) break;
    const ch = out[out.length - 1];
    if (ch === ')' && count(out, '(') >= count(out, ')')) break;
    if (ch === ']' && count(out, '[') >= count(out, ']')) break;
    out = out.slice(0, -1);
  }
  return out;
}

function count(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// ---------- ISBN ----------

export function isbnDigits(raw) {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function validIsbn(raw) {
  const d = isbnDigits(raw);
  if (d.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      const v = d[i] === 'X' ? 10 : Number(d[i]);
      if (Number.isNaN(v) || (d[i] === 'X' && i !== 9)) return false;
      sum += v * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (d.length === 13 && /^97[89]\d{10}$/.test(d)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

/** ISBN-10 → ISBN-13 (para buscarlo siempre igual). */
export function isbn13(raw) {
  const d = isbnDigits(raw);
  if (d.length === 13) return d;
  const core = `978${d.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + ((10 - (sum % 10)) % 10);
}

// ---------- Fuentes ----------

/**
 * Encuentra DOI, ISBN, PMID, PMCID, arXiv y URLs.
 * @returns {{type:string, id:string, start:number, end:number, raw:string}[]}
 */
export function extractSources(text) {
  const found = [];
  const taken = [];
  const overlaps = (s, e) => taken.some(([a, b]) => s < b && e > a);
  const add = (type, id, start, end, raw) => {
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    found.push({ type, id, start, end, raw });
  };

  // DOI (también dentro de https://doi.org/...)
  for (const m of text.matchAll(/\b(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s?)?(10\.\d{4,9}\/[^\s"'<>]+)/gi)) {
    const doi = trimTrailing(m[1]);
    if (doi.length < 8) continue;
    const start = m.index;
    const end = m.index + m[0].indexOf(m[1]) + doi.length;
    add('doi', doi.toLowerCase(), start, end, text.slice(start, end));
  }

  // arXiv
  for (const m of text.matchAll(/\barXiv:\s?(\d{4}\.\d{4,5})(v\d+)?\b/gi)) {
    add('arxiv', m[1], m.index, m.index + m[0].length, m[0]);
  }
  for (const m of text.matchAll(/https?:\/\/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?/gi)) {
    add('arxiv', m[1], m.index, m.index + m[0].length, m[0]);
  }

  // PMID / PMCID
  for (const m of text.matchAll(/\bPMID:?\s*(\d{5,9})\b/g)) add('pmid', m[1], m.index, m.index + m[0].length, m[0]);
  for (const m of text.matchAll(/\bPMC\s?(\d{5,9})\b/g)) add('pmcid', `PMC${m[1]}`, m.index, m.index + m[0].length, m[0]);

  // ISBN con prefijo
  for (const m of text.matchAll(/\bISBN(?:-1[03])?:?\s*((?:97[89][\s‐-]{0,2})?(?:\d[\s‐-]{0,2}){9}[\dXx])(?![\d-])/g)) {
    if (!validIsbn(m[1])) continue;
    const start = m.index + m[0].indexOf(m[1]);
    add('isbn', isbn13(m[1]), start, start + m[1].length, m[1]);
  }
  // ISBN-13 con guiones sin prefijo (frecuente en bibliografías)
  for (const m of text.matchAll(/\b97[89]-\d{1,5}-\d{1,7}-\d{1,7}-\s?\d\b/g)) {
    if (validIsbn(m[0])) add('isbn', isbn13(m[0]), m.index, m.index + m[0].length, m[0]);
  }

  // URLs
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const url = trimTrailing(m[0]);
    if (/doi\.org\/10\./i.test(url)) continue;
    add('url', url, m.index, m.index + url.length, url);
  }

  return found.sort((a, b) => a.start - b.start);
}

// ---------- Siglas ----------

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'para', 'en', 'por', 'a', 'of', 'the', 'and', 'for', 'on', 'in', 'to', 'con']);

function initialsMatch(phrase, acronym) {
  const words = phrase.split(/[\s-]+/).filter(Boolean);
  const letters = acronym.replace(/s$/, '').toUpperCase();
  // Intenta casar desde el final de la frase hacia atrás (la definición suele estar justo antes).
  for (let startWord = words.length - 1; startWord >= 0; startWord--) {
    const cand = words.slice(startWord);
    const sig = cand.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
    if (sig.length === 0) continue;
    const ini = sig.map((w) => w[0].toUpperCase()).join('');
    if (ini === letters) return cand.join(' ');
    if (sig.length > letters.length + 2) break;
  }
  // Siglas en inglés para términos en español ("Protocolo de Internet (IP)"): mismas iniciales en otro orden.
  if (letters.length <= 5) {
    for (let startWord = words.length - 1; startWord >= 0; startWord--) {
      const cand = words.slice(startWord);
      const sig = cand.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
      if (sig.length > letters.length) break;
      if (sig.length !== letters.length) continue;
      const ini = sig.map((w) => w[0].toUpperCase()).sort().join('');
      if (ini === [...letters].sort().join('')) return cand.join(' ');
    }
  }
  // Coincidencia flexible: todas las letras aparecen en orden como inicio de palabras o sílabas.
  const tail = words.slice(-Math.min(words.length, letters.length + 3)).join(' ');
  let i = 0;
  for (const w of tail.split(/\s+/)) {
    if (i < letters.length && w[0] && w[0].toUpperCase() === letters[i]) i++;
  }
  return i === letters.length && letters.length >= 2 ? tail : null;
}

/**
 * Siglas definidas en el texto, p. ej. "Organización Mundial de la Salud (OMS)".
 * @returns {{acronym:string, definition:string, start:number, end:number, uses:{start:number,end:number}[]}[]}
 */
export function extractAcronyms(text) {
  const defs = new Map();
  const re = /((?:[\p{L}][\p{L}\p{M}'’-]*\s+){1,10}?[\p{L}][\p{L}\p{M}'’-]*)\s+\(([\p{Lu}][\p{Lu}0-9&]{1,9}s?)\)/gu;
  for (const m of text.matchAll(re)) {
    const acronym = m[2];
    if (defs.has(acronym)) continue;
    const definition = initialsMatch(m[1], acronym);
    if (!definition) continue;
    const start = m.index + m[0].lastIndexOf(definition);
    defs.set(acronym, { acronym, definition, start, end: m.index + m[0].length, uses: [] });
  }
  for (const d of defs.values()) {
    const useRe = new RegExp(`(?<![\\p{L}\\d])${escapeRe(d.acronym)}(?![\\p{L}\\d])`, 'gu');
    for (const m of text.matchAll(useRe)) {
      if (m.index >= d.start && m.index < d.end) continue;
      d.uses.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return [...defs.values()];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Referencias internas ----------

const KINDS = [
  ['fig', /^(fig(?:ura|ure)?s?\.?|gr[aá]fic[oa]s?|imagen|image|diagrama)$/i],
  ['tab', /^(tablas?|tables?|cuadros?)$/i],
  ['eq', /^(ecuaci[oó]n(?:es)?|eq\.?|equations?|f[oó]rmulas?)$/i],
  ['sec', /^(secci[oó]n(?:es)?|cap[ií]tulos?|sections?|chapters?|apartados?)$/i],
];

function kindOf(word) {
  for (const [k, re] of KINDS) if (re.test(word)) return k;
  return null;
}

/**
 * Menciones como "Figura 3", "Tabla 2.1", "sección 4" o "[12]".
 * @returns {{kind:string, num:string, start:number, end:number, label:string}[]}
 */
export function extractInternalRefs(text) {
  const out = [];
  const re = /\b(Fig(?:ura|ure)?s?\.?|Gr[aá]fic[oa]s?|Tablas?|Tables?|Cuadros?|Ecuaci[oó]n|Eq\.|Secci[oó]n|Cap[ií]tulo|Section|Chapter|Apartado)\s*(\d+(?:\.\d+)*)\b/giu;
  for (const m of text.matchAll(re)) {
    const kind = kindOf(m[1]);
    if (!kind) continue;
    out.push({ kind, num: m[2], start: m.index, end: m.index + m[0].length, label: m[0] });
  }
  for (const m of text.matchAll(/\[(\d{1,3})(?:\s*[,–-]\s*\d{1,3})*\]/g)) {
    out.push({ kind: 'cite', num: m[1], start: m.index, end: m.index + m[0].length, label: m[0] });
  }
  return out;
}

/** ¿Este párrafo es el pie de una figura/tabla, la entrada N de la bibliografía o un título numerado? */
export function blockMatchesRef(blockText, ref) {
  const t = blockText.trim();
  const num = ref.num.replace(/\./g, '\\.');
  if (ref.kind === 'fig') return new RegExp(`^(fig(ura|ure)?\\.?|gr[aá]fic[oa]|imagen|image)\\s*${num}\\b`, 'i').test(t);
  if (ref.kind === 'tab') return new RegExp(`^(tabla|table|cuadro)\\s*${num}\\b`, 'i').test(t);
  if (ref.kind === 'eq') return new RegExp(`\\(${num}\\)\\s*$`).test(t);
  if (ref.kind === 'sec') return new RegExp(`^((secci[oó]n|cap[ií]tulo|section|chapter)\\s*)?${num}\\.?\\s+\\p{L}`, 'iu').test(t) && t.length < 140;
  if (ref.kind === 'cite') return new RegExp(`^(\\[${num}\\]|${num}\\.|\\^?\\s*${num}\\s)`).test(t);
  return false;
}

/** Párrafos que parecen bibliografía (para separar fechas de publicación de plazos reales). */
export function looksLikeReference(blockText) {
  return /\b(doi|ISBN|PMID|Retrieved|Archived|Recuperado|Consultado|Accedido|pp\.|vol\.|Press|Editorial|et al\.)\b/i.test(blockText)
    || /\(\d{4}[a-z]?\)\.?/.test(blockText) && /\.\s/.test(blockText) && blockText.length < 600;
}
