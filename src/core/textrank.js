// Resumen extractivo sin IA (TextRank) y términos clave (TF-IDF) para la memoria.
import { tokenize, normTerm, isStopword, splitSentences } from './lang.js';

function contentTerms(text) {
  return tokenize(text)
    .filter((w) => w.length > 2 && !isStopword(w))
    .map(normTerm);
}

/**
 * Elige las oraciones más representativas.
 * @param {{id:number,text:string}[]} blocks párrafos numerados
 * @returns {{text:string, block:number, score:number}[]}
 */
export function extractiveSummary(blocks, maxSentences = 7) {
  const sents = [];
  for (const b of blocks) {
    if (b.type === 'heading') continue;
    for (const s of splitSentences(b.text)) {
      const terms = contentTerms(s.text);
      if (terms.length >= 5 && terms.length <= 70) sents.push({ text: s.text, block: b.id, terms, pos: sents.length });
    }
  }
  if (!sents.length) return [];
  const n = sents.length;
  let scores;
  if (n <= 400) {
    const sets = sents.map((s) => new Set(s.terms));
    const w = Array.from({ length: n }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let common = 0;
        for (const t of sets[i]) if (sets[j].has(t)) common++;
        if (!common) continue;
        const sim = common / (Math.log(sets[i].size + 1) + Math.log(sets[j].size + 1));
        w[i][j] = sim; w[j][i] = sim;
      }
    }
    const out = w.map((row) => row.reduce((a, b) => a + b, 0));
    scores = new Float32Array(n).fill(1);
    for (let it = 0; it < 30; it++) {
      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) if (w[j][i] && out[j]) sum += (w[j][i] / out[j]) * scores[j];
        next[i] = 0.15 + 0.85 * sum;
      }
      scores = next;
    }
  } else {
    // Documentos largos: parecido con el "centroide" del texto (rápido).
    const tf = new Map();
    for (const s of sents) for (const t of s.terms) tf.set(t, (tf.get(t) || 0) + 1);
    scores = sents.map((s) => {
      const uniq = new Set(s.terms);
      let sum = 0;
      for (const t of uniq) sum += Math.log(1 + tf.get(t));
      return sum / Math.sqrt(uniq.size + 3);
    });
  }
  // Ligera preferencia por el inicio del texto (introducción).
  const ranked = sents
    .map((s, i) => ({ text: s.text, block: s.block, pos: s.pos, score: scores[i] * (1 + 0.25 * Math.exp(-s.pos / 12)) }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of ranked) {
    if (picked.length >= maxSentences) break;
    if (picked.some((p) => overlap(p.text, s.text) > 0.6)) continue;
    picked.push(s);
  }
  return picked.sort((a, b) => a.pos - b.pos).map(({ text, block, score }) => ({ text, block, score }));
}

function overlap(a, b) {
  const A = new Set(contentTerms(a));
  const B = new Set(contentTerms(b));
  let c = 0;
  for (const t of A) if (B.has(t)) c++;
  return c / Math.max(1, Math.min(A.size, B.size));
}

/**
 * Términos clave de un texto con su peso (frecuencia con bonus por longitud y bigramas).
 * @returns {[string, number, string][]} [término normalizado, peso, forma visible]
 */
export function keyTerms(text, max = 40) {
  const words = tokenize(text);
  const counts = new Map();
  const display = new Map();
  let prev = null;
  for (const w of words) {
    if (w.length < 3 || isStopword(w) || /^\d/.test(w)) { prev = null; continue; }
    const t = normTerm(w);
    counts.set(t, (counts.get(t) || 0) + 1);
    if (!display.has(t)) display.set(t, w.toLowerCase());
    if (prev) {
      const bg = `${prev.t} ${t}`;
      counts.set(bg, (counts.get(bg) || 0) + 1.5);
      if (!display.has(bg)) display.set(bg, `${prev.w.toLowerCase()} ${w.toLowerCase()}`);
    }
    prev = { t, w };
  }
  const total = words.length || 1;
  const short = total < 200;
  const scored = [];
  for (const [t, c] of counts) {
    const isBigram = t.includes(' ');
    if (c < (isBigram ? (short ? 2.5 : 3) : short ? 1 : 2)) continue;
    const weight = (c / total) * 1000 * (1 + Math.min(t.length, 14) / 14);
    scored.push([t, Math.round(weight * 100) / 100, display.get(t)]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, max);
}

/** Similitud coseno entre dos listas de términos [[t, w], …] usando IDF del corpus. */
export function similarity(a, b, idf = () => 1) {
  const A = new Map(a.map(([t, w]) => [t, w * idf(t)]));
  let dot = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v * v;
  const shared = [];
  for (const [t, w0] of b) {
    const w = w0 * idf(t);
    nb += w * w;
    if (A.has(t)) {
      dot += A.get(t) * w;
      shared.push(t);
    }
  }
  if (!na || !nb) return { score: 0, shared: [] };
  return { score: dot / Math.sqrt(na * nb), shared };
}
