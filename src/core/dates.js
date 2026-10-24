// Araña de plazos: encuentra fechas importantes y las clasifica.
import * as chrono from 'chrono-node';
import { splitSentences } from './lang.js';

const CATEGORIES = [
  ['examen', 'Examen', /\b(ex[aá]men(es)?|parcial(es)?|evaluaci[oó]n|prueba|pr[aá]ctica calificada|calificad[ao]|control de lectura|test|quiz|exam|midterm|final exam)\b/i],
  ['entrega', 'Entrega', /\b(entrega[rs]?|entregable|presentar|presentaci[oó]n|enviar|subir|plazo|fecha l[ií]mite|vence la entrega|deadline|due|submit|informe|trabajo final|proyecto)\b/i],
  ['pago', 'Pago', /\b(pago|pagar|pensi[oó]n|cuota|matr[ií]cula|vence|vencimiento|mensualidad|payment|fee|tuition|factura)\b/i],
  ['inscripcion', 'Inscripción', /\b(inscripci[oó]n|inscribirse|registro|postula(ci[oó]n|r)?|convocatoria|registration|apply|cierre de)\b/i],
  ['evento', 'Evento', /\b(clase|sesi[oó]n|laboratorio|pr[aá]ctica|taller|charla|conferencia|reuni[oó]n|webinar|seminario|feria|meeting|lecture|class|event)\b/i],
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]).concat([['fecha', 'Fecha'], ['referencia', 'Referencia']]));

function categorize(sentence) {
  for (const [key, , re] of CATEGORIES) if (re.test(sentence)) return key;
  return 'fecha';
}

/**
 * @param {string} text
 * @param {'es'|'en'} lang
 * @param {Date} ref fecha de referencia (hoy)
 * @param {(index:number)=>boolean} isReferenceAt true si la posición cae en la bibliografía
 */
export function extractDates(text, lang = 'es', ref = new Date(), isReferenceAt = () => false) {
  const parsers = lang === 'en' ? [chrono.en, chrono.es] : [chrono.es, chrono.en];
  const seen = new Set();
  const results = [];
  const sentences = splitSentences(text);
  const sentenceAt = (i) => sentences.find((s) => i >= s.start && i < s.end) || { text: text.slice(Math.max(0, i - 80), i + 80), start: i };

  for (const parser of parsers) {
    let parsed = [];
    try {
      parsed = parser.parse(text, ref, { forwardDate: false });
    } catch {
      parsed = [];
    }
    for (const r of parsed) {
      const key = `${r.index}:${r.text.length}`;
      if ([...seen].some((k) => overlapsKey(k, r.index, r.text.length))) continue;
      // Ignora fechas sin día (solo "2024" o "marzo") y horas sueltas.
      const relative = /\b(pr[oó]xim[oa]|este|esta|next|this|ma[nñ]ana|hoy|tomorrow|today)\b/i.test(r.text);
      if (!r.start.isCertain('day') && !(r.start.isCertain('weekday') && relative)) continue;
      if (/^\d{1,2}(:\d{2})?\s*(h|hrs?)?$/i.test(r.text.trim())) continue;
      seen.add(key);
      const date = r.start.date();
      if (Number.isNaN(date.getTime())) continue;
      const sentence = sentenceAt(r.index);
      const inRefs = isReferenceAt(r.index);
      // La categoría sale de lo que está justo antes de la fecha (en la misma oración).
      const ctxStart = Math.max(sentence.start ?? 0, r.index - 90);
      const local = text.slice(ctxStart, r.index + r.text.length + 2);
      const category = inRefs ? 'referencia' : categorize(local) !== 'fecha' ? categorize(local) : categorize(sentence.text);
      results.push({
        start: r.index,
        end: r.index + r.text.length,
        text: r.text,
        date: date.toISOString(),
        hasTime: r.start.isCertain('hour'),
        hasYear: r.start.isCertain('year'),
        endDate: r.end ? r.end.date().toISOString() : null,
        sentence: sentence.text.replace(/\s+/g, ' ').trim(),
        category,
        title: makeTitle(clauseAround(sentence, r.index, r.text.length, text), r.text, category),
      });
    }
  }
  return results.sort((a, b) => a.start - b.start);
}

/** La parte de la oración que corresponde a esta fecha (corta en " y el ", ";", etc.). */
function clauseAround(sentence, index, len, text) {
  const sStart = sentence.start ?? 0;
  const sText = sentence.text;
  const rel = index - sStart;
  if (rel < 0 || rel > sText.length) return sText;
  const before = sText.slice(0, rel);
  const after = sText.slice(rel + len);
  const cutBefore = Math.max(before.lastIndexOf(';'), before.search(/,? y (el|la|los|las) [^,;]*$/) >= 0 ? before.search(/,? y (el|la|los|las) [^,;]*$/) + 2 : -1);
  const endAfter = after.search(/;|,? y (el|la|los|las) /);
  const clause = (cutBefore > 0 ? before.slice(cutBefore + 1) : before) + text.slice(index, index + len) + (endAfter >= 0 ? after.slice(0, endAfter) : after);
  return clause.trim();
}

function overlapsKey(key, start, len) {
  const [s, l] = key.split(':').map(Number);
  return start < s + l && start + len > s;
}

function makeTitle(sentence, dateText, category) {
  const at = sentence.indexOf(dateText);
  const before = at > 0 ? sentence.slice(0, at) : '';
  let t = (before.trim().split(/\s+/).length >= 3 ? before : sentence.replace(dateText, ' ')).replace(/\s+/g, ' ').trim();
  const filler = /\s+(el|la|los|las|del|de|y|para|hasta|desde|a las|a partir del?|será|serán|es|son|vence|vencen|se tomará|se tomarán|se rendirá|se rendirán|se realizará|se realizarán|se entregará|tendrá lugar|está programad[oa]|on|by|is|are|will be|due|the)$/i;
  t = t.replace(/[.,:;\s]+$/, '');
  for (let i = 0; i < 6 && filler.test(t); i++) t = t.replace(filler, '').replace(/[.,:;\s]+$/, '');
  t = t.replace(/^(el|la|los|las|y|e|hasta|desde|para|on|by|the)\s+/i, '').trim();
  if (t.length > 90) t = `${t.slice(0, 87).replace(/\s+\S*$/, '')}…`;
  if (t) t = t[0].toUpperCase() + t.slice(1);
  const label = CATEGORY_LABEL[category] || 'Fecha';
  if (!t) return label;
  if (category === 'fecha' || category === 'referencia') return t;
  const firstWord = t.split(/\s+/)[0].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const labelWord = label.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return firstWord.startsWith(labelWord.slice(0, 5)) ? t : `${label}: ${t}`;
}
