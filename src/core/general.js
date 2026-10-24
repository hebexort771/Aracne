// Araña de "datos": encuentra lo importante de cualquier texto, aunque no sea académico.
// Cifras (dinero, porcentajes, medidas, cantidades grandes), nombres propios, citas textuales,
// definiciones, correos y teléfonos. Módulo puro (sin DOM) para poder probarlo con node --test.
import { isStopword, stripAccents } from './lang.js';

const NUM = String.raw`\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const CUR_PRE = String.raw`S\/\.?|US\$|U\$S|R\$|C\$|A\$|\$|€|£|¥|₹|USD|EUR|PEN|MXN|COP|ARS|CLP|BOB|GBP|UYU|PYG|GTQ|CRC|DOP|HNL|NIO|VES|BRL`;
const CUR_POST = String.raw`soles|sol|dólares|dolares|dólar|euros|euro|pesos|peso|bolívares|bolivianos|reales|libras|quetzales|colones|guaraníes|córdobas|lempiras|USD|EUR|PEN|MXN|COP|ARS|CLP|dollars|dollar|pounds|yen`;
const MAG = String.raw`mil millones|millones|millón|billones|billón|mil|million|millions|billion|billions|thousand|M|MM|K|mn|bn`;
const UNITS = String.raw`km²|km2|km\/h|km|cm|mm|m²|m2|m³|m3|m|kg|mg|µg|g|ml|mL|L|l|ha|°C|ºC|°F|GB|MB|KB|TB|GHz|MHz|kWh|kW|MW|mAh|Mbps|h|min|años|año|meses|mes|días|día|semanas|semana|horas|hora|minutos|minuto|segundos|créditos|habitantes|personas|estudiantes|alumnos|participantes|pacientes|casos|empleados|trabajadores|usuarios|páginas|palabras|veces|puntos|votos|years|year|months|days|weeks|hours|minutes|seconds|people|students|patients|participants|cases|users|employees|credits|pages|words|times|points|votes`;

const RE_MONEY_PRE = new RegExp(String.raw`(?<![\p{L}\d])(?:${CUR_PRE})\s?(?:${NUM})(?:\s?(?:${MAG})\b)?`, 'gu');
const RE_MONEY_POST = new RegExp(String.raw`(?<![\p{L}\d.,])(?:${NUM})\s?(?:(?:${MAG})\s(?:de\s)?)?(?:${CUR_POST})\b`, 'giu');
const RE_PERCENT = new RegExp(String.raw`(?<![\p{L}\d.,])(?:${NUM})\s?(?:%|por\s?ciento|percent\b)`, 'giu');
const RE_MEASURE = new RegExp(String.raw`(?<![\p{L}\d.,])(?:${NUM})\s?(?:(?:${MAG})\s(?:de\s)?)?(?:${UNITS})(?![\p{L}\d])`, 'gu');
const RE_BIG = new RegExp(String.raw`(?<![\p{L}\d.,\/-])(?:\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s(?:${MAG}))(?![\p{L}\d]|[.,]\d)`, 'gu');
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const RE_PHONE = /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}(?!\w)/g;
const PHONE_CUE = /(tel[eé]?f?o?n?o?s?|tel\.|cel(ular)?|m[oó]vil|whats ?app|phone|mobile|llam[ae]|contacto|contact|fax|central|anexo)\W{0,12}$/i;
const RE_QUOTE = /[“«]([^”»\n]{12,280})[”»]|"([^"\n]{12,280})"/g;

const MONTHS_DAYS = new Set(('enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre lunes martes miercoles jueves viernes sabado domingo ' +
  'january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday').split(' '));
const CONNECTORS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'di', 'do', 'dos', 'van', 'von', 'der', 'den', 'of', 'the', 'and', 'le']);
const NOT_NAMES = new Set(('figura tabla capitulo seccion anexo parte tema unidad semana sesion modulo clase grupo pagina nota ' +
  'figure table chapter section appendix part unit week session page note vol volumen issue doi isbn pmid issn ' +
  'nuevo nueva gran primer primera segundo segunda ultimo ultima cada todos todas este esta estos estas ese esa aquel ' +
  'hola gracias bienvenido bienvenida inicio menu buscar ver mas ayuda').split(' '));

const GENERIC_TERMS = /^(objetivo|problema|resultado|idea|punto|tema|caso|motivo|razon|proposito|fin|reto|desafio|meta|verdad|cosa|parte|clave|respuesta|pregunta|solucion|goal|problem|result|point|issue|thing|answer|question|solution|aim|purpose)$/;
const UPPER = /\p{Lu}/u;
const WORD_CAP = String.raw`\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{L}[\p{Ll}\p{M}]*)?`;
const RE_NAME_SEQ = new RegExp(String.raw`${WORD_CAP}(?:\s+(?:(?:de|del|la|las|los|y|e|da|di|do|dos|van|von|der|den|of|the|and|le)\s+){0,2}${WORD_CAP})+`, 'gu');
const RE_CAP_WORD = new RegExp(WORD_CAP, 'gu');

const DEF_ES = /^(?:(?:el|la|los|las|lo|un|una)\s+)?((?:[\p{L}\p{M}][\p{L}\p{M}'’-]*\s+){0,4}[\p{L}\p{M}][\p{L}\p{M}'’-]*)\s*(?:\([^)]{1,40}\)\s*)?(?:,\s*)?(?:(?:es|son)\s+(?:un|una|unos|unas|el|la|los|las|aquel|aquella|aquello|cualquier)\b|se\s+define\s+como|se\s+denomina|se\s+conoce\s+como|se\s+llama|consiste\s+en|se\s+refiere\s+a|se\s+entiende\s+por|significa|hace\s+referencia\s+a|alude\s+a)/iu;
const DEF_EN = /^(?:(?:the|a|an)\s+)?((?:[\p{L}][\p{L}'’-]*\s+){0,4}[\p{L}][\p{L}'’-]*)\s*(?:\([^)]{1,40}\)\s*)?(?:,\s*)?(?:(?:is|are)\s+(?:a|an|the|any)\b|is\s+defined\s+as|are\s+defined\s+as|refers\s+to|is\s+called|means|consists\s+of|is\s+known\s+as)/iu;
const DEF_SE_DENOMINA = /\bse\s+(?:denomina|llama|conoce\s+como)\s+((?:[\p{L}\p{M}][\p{L}\p{M}'’-]*\s+){0,3}[\p{L}\p{M}][\p{L}\p{M}'’-]*)\s+(?:a|al)\s/iu;

function overlaps(taken, s, e) {
  for (const [a, b] of taken) if (s < b && e > a) return true;
  return false;
}

function context(text, start, end, size = 80) {
  let a = start, b = end;
  while (a > 0 && start - a < size && !/[.!?\n]/.test(text[a - 1])) a--;
  while (b < text.length && b - end < size && !/[.!?\n]/.test(text[b])) b++;
  let s = text.slice(a, b).replace(/\s+/g, ' ').trim();
  if (a > 0 && start - a >= size) s = `…${s}`;
  if (b < text.length && b - end >= size) s = `${s}…`;
  return s;
}

function sentenceStartBefore(text, pos) {
  // ¿La palabra en `pos` empieza una oración (o un renglón)?
  let i = pos - 1;
  while (i >= 0 && /[\s"“«(¿¡'‘\-–—•·*]/.test(text[i])) {
    if (text[i] === '\n') return true;
    i--;
  }
  return i < 0 || /[.!?:…\]]/.test(text[i]);
}

function numberValue(raw) {
  const m = raw.match(/\d[\d.,  ]*/);
  if (!m) return null;
  let s = m[0].replace(/[  ]/g, '');
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep >= 0) {
    // 1.234.567 / 12,500 → miles; 3,5 / 1.234,56 → decimales.
    const decimals = s.length - lastSep - 1;
    const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
    s = decimals === 3 ? intPart + s.slice(lastSep + 1) : `${intPart}.${s.slice(lastSep + 1)}`;
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  const mag = raw.toLowerCase();
  if (/mil millones|billion|bn\b/.test(mag)) return v * 1e9;
  if (/millones|millón|million|\bmm?\b/.test(mag)) return v * 1e6;
  if (/\bmil\b|thousand|\bk\b/.test(mag)) return v * 1e3;
  return v;
}

function cleanName(words) {
  // Quita conectores al principio y al final.
  while (words.length && CONNECTORS.has(words[0].toLowerCase())) words.shift();
  while (words.length && CONNECTORS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words;
}

/**
 * @param {string} text
 * @param {object} [o]
 * @param {Array<[number,number]>} [o.taken] tramos ya ocupados por otras arañas (fuentes, fechas, siglas)
 * @param {(pos:number)=>boolean} [o.skip] devuelve true para posiciones que no se analizan (títulos, bibliografía)
 */
export function extractGeneral(text, { taken = [], skip = () => false, lang = 'es' } = {}) {
  const used = [...taken];
  const numbers = [];
  const addNumber = (m, kind) => {
    const raw = m[0].trim();
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const end = start + raw.length;
    if (overlaps(used, start, end) || skip(start)) return;
    used.push([start, end]);
    numbers.push({ kind, raw, start, end, value: numberValue(raw), context: context(text, start, end) });
  };
  for (const m of text.matchAll(RE_MONEY_PRE)) addNumber(m, 'money');
  for (const m of text.matchAll(RE_MONEY_POST)) addNumber(m, 'money');
  for (const m of text.matchAll(RE_PERCENT)) addNumber(m, 'percent');
  for (const m of text.matchAll(RE_MEASURE)) addNumber(m, 'measure');
  for (const m of text.matchAll(RE_BIG)) {
    const raw = m[0];
    // 1.000 o más (con separador de miles) o "3 millones".
    const v = numberValue(raw);
    if (v === null || (v < 1000 && !/\s\p{L}/u.test(raw))) continue;
    addNumber(m, 'number');
  }
  numbers.sort((a, b) => a.start - b.start);

  // ---- Correos ----
  const emails = [];
  for (const m of text.matchAll(RE_EMAIL)) {
    const start = m.index, end = start + m[0].length;
    if (overlaps(used, start, end)) continue;
    used.push([start, end]);
    emails.push({ raw: m[0].replace(/\.$/, ''), start, end: m[0].endsWith('.') ? end - 1 : end });
  }

  // ---- Teléfonos (solo con una pista clara: "Tel.", "+51", "(01)") ----
  const phones = [];
  for (const m of text.matchAll(RE_PHONE)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) continue;
    const start = m.index, end = start + raw.length;
    if (overlaps(used, start, end)) continue;
    const before = text.slice(Math.max(0, start - 28), start);
    const cue = raw.startsWith('+') || /^\(\d/.test(raw) || PHONE_CUE.test(before);
    if (!cue) continue;
    if (/^\d{4}[-–]\d{2,4}$/.test(raw)) continue; // 2023-2024
    used.push([start, end]);
    phones.push({ raw, start, end });
  }

  // ---- Citas textuales ----
  const quotes = [];
  for (const m of text.matchAll(RE_QUOTE)) {
    const inner = m[1] || m[2];
    if (!inner || inner.split(/\s+/).length < 3) continue;
    const start = m.index, end = start + m[0].length;
    if (skip(start) || overlaps(taken, start, end)) continue;
    quotes.push({ text: inner.trim(), start, end });
    if (quotes.length >= 40) break;
  }

  // ---- Nombres propios ----
  const names = new Map();
  const addName = (name, start, end) => {
    const key = stripAccents(name.toLowerCase());
    const item = names.get(key) || { name, count: 0, occurrences: [] };
    item.count++;
    if (item.occurrences.length < 6) item.occurrences.push({ start, end });
    names.set(key, item);
  };
  const nameTaken = [];
  for (const m of text.matchAll(RE_NAME_SEQ)) {
    const start = m.index;
    if (skip(start)) continue;
    let words = m[0].split(/\s+/);
    // Si empieza una oración, la primera palabra puede llevar mayúscula solo por eso ("En Lima…").
    if (sentenceStartBefore(text, start) && (isStopword(words[0]) || NOT_NAMES.has(stripAccents(words[0].toLowerCase())))) words = words.slice(1);
    words = cleanName(words);
    const caps = words.filter((w) => UPPER.test(w[0]));
    if (caps.length < 2 || words.length > 7) continue;
    if (caps.every((w) => MONTHS_DAYS.has(stripAccents(w.toLowerCase())))) continue;
    if (NOT_NAMES.has(stripAccents(caps[0].toLowerCase()))) continue;
    const name = words.join(' ');
    const s = text.indexOf(name, start);
    if (s < 0) continue;
    const e = s + name.length;
    if (overlaps(used, s, e)) continue;
    nameTaken.push([s, e]);
    addName(name, s, e);
  }
  // Palabras sueltas con mayúscula a mitad de oración que se repiten (lugares, marcas, personas).
  const singles = new Map();
  for (const m of text.matchAll(RE_CAP_WORD)) {
    const w = m[0];
    const start = m.index, end = start + w.length;
    if (w.length < 3 || skip(start) || sentenceStartBefore(text, start)) continue;
    const low = stripAccents(w.toLowerCase());
    if (isStopword(w) || MONTHS_DAYS.has(low) || NOT_NAMES.has(low)) continue;
    if (overlaps(nameTaken, start, end) || overlaps(used, start, end)) continue;
    const item = singles.get(low) || { name: w, count: 0, occurrences: [] };
    item.count++;
    if (item.occurrences.length < 6) item.occurrences.push({ start, end });
    singles.set(low, item);
  }
  for (const [key, item] of singles) {
    if (item.count >= 3 && !names.has(key)) names.set(key, item);
  }
  const nameList = [...names.values()]
    .map((n) => ({ ...n, start: n.occurrences[0].start, end: n.occurrences[0].end }))
    .sort((a, b) => b.count - a.count || a.start - b.start);

  // ---- Definiciones ----
  const definitions = [];
  const sentRe = /[^.!?\n]+[.!?]?/g;
  for (const m of text.matchAll(sentRe)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    const sStart = m.index + lead;
    if (sentence.length < 25 || sentence.length > 400 || skip(sStart)) continue;
    const re = lang === 'en' ? DEF_EN : DEF_ES;
    let mm = sentence.match(re) || sentence.match(lang === 'en' ? DEF_ES : DEF_EN);
    let term = mm?.[1];
    let termStart = -1;
    if (term) {
      termStart = sStart + sentence.indexOf(term);
    } else {
      mm = sentence.match(DEF_SE_DENOMINA);
      term = mm?.[1];
      if (term) termStart = sStart + sentence.indexOf(term, mm.index);
    }
    if (!term) continue;
    const words = term.split(/\s+/);
    if (words.length > 5 || isStopword(words[0]) || isStopword(words[words.length - 1])) continue;
    if (GENERIC_TERMS.test(stripAccents(term.toLowerCase()))) continue;
    definitions.push({ term: term.trim(), start: termStart, end: termStart + term.length, sentence, sentenceStart: sStart });
    if (definitions.length >= 40) break;
  }

  return { numbers, emails, phones, quotes, names: nameList, definitions };
}

/** Nombre corto para la etiqueta de una cifra. */
export function numberLabel(n) {
  const k = { money: 'MONTO', percent: 'PORCENTAJE', measure: 'MEDIDA', number: 'CIFRA' }[n.kind] || 'CIFRA';
  return `${k} ${n.raw}`;
}
