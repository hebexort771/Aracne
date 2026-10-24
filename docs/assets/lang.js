// Utilidades de idioma: palabras vacías, oraciones, sílabas y nivel de lectura.
// Módulo puro (sin DOM) para poder probarlo con node --test.

const STOP_ES_LIST = `a al algo algun alguna algunas alguno algunos ante antes asi aun aunque bajo bien cada casi como con contra cual cuales cualquier cuando cuanto de del desde donde dos durante e el ella ellas ello ellos en entre era eran eres es esa esas ese eso esos esta estaba estaban estado estamos estan estar estas este esto estos estoy fue fueron fui ha haber habia han hasta hay he la las le les lo los mas me mediante mi mis mucho muchos muy nada ni no nos nosotros nuestra nuestro o otra otras otro otros para pero poco por porque pues que quien quienes se sea sean segun ser sera seran si sido siempre sin sino sobre solo son su sus tal tambien tan tanto te tener tiene tienen todo todos tras tu tus u un una unas uno unos usted y ya yo cuya cuyo dicho dicha hacer hace hacen puede pueden mismo misma`;
const STOP_EN_LIST = `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours et al may might must shall one two us via per`;

export function stripAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

export const STOP_ES = new Set(STOP_ES_LIST.split(/\s+/));
export const STOP_EN = new Set(STOP_EN_LIST.split(/\s+/));

export function isStopword(word) {
  const w = stripAccents(word.toLowerCase());
  return STOP_ES.has(w) || STOP_EN.has(w);
}

/** Palabras (letras, con apóstrofo o guion interno). */
export function tokenize(text) {
  return text.match(/\p{L}[\p{L}\p{M}'’-]*/gu) || [];
}

/** Forma normalizada para comparar términos: minúsculas, sin tildes, sin plural simple. */
export function normTerm(word) {
  let w = stripAccents(word.toLowerCase()).replace(/[’']/g, '');
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

export function detectLang(text) {
  const words = tokenize(text.slice(0, 20000)).map((w) => stripAccents(w.toLowerCase()));
  let es = 0, en = 0;
  for (const w of words) {
    if (STOP_ES.has(w) && !STOP_EN.has(w)) es++;
    else if (STOP_EN.has(w) && !STOP_ES.has(w)) en++;
  }
  if (es + en < 5) return 'es';
  return es >= en ? 'es' : 'en';
}

const ABBREVIATIONS = /(?:\b(?:sr|sra|srta|dr|dra|lic|ing|prof|etc|ej|pág|pag|págs|pp|p|vol|vols|no|núm|num|fig|figs|cap|ed|eds|ibid|cf|vs|al|aprox|art|inc|ltd|co|mr|mrs|ms|st|jr|e\.g|i\.e|op|cit)\.|\b[A-Z]\.)$/i;

/**
 * Divide un texto en oraciones y devuelve [{text, start, end}] con posiciones.
 */
export function splitSentences(text) {
  const out = [];
  const re = /[.!?…]+["”’)\]]*(?:\[\d{1,3}(?:[,–-]\s*\d{1,3})*\])*\s+|\n{2,}/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const chunk = text.slice(start, m.index + m[0].trimEnd().length);
    const next = text.slice(end, end + 1);
    if (m[0].includes('\n') || (!ABBREVIATIONS.test(chunk) && (/[\p{Lu}¿¡"“(\d]/u.test(next) || next === ''))) {
      pushSentence(out, text, start, m.index + m[0].trimEnd().length);
      start = end;
    }
  }
  pushSentence(out, text, start, text.length);
  return out;
}

function pushSentence(out, text, start, end) {
  let s = start, e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  if (e - s >= 2) out.push({ text: text.slice(s, e), start: s, end: e });
}

// ---- Sílabas ----

const STRONG = 'aeoáéóíú'; // í y ú acentuadas forman hiato
const VOWELS_ES = 'aeiouáéíóúü';

export function syllablesEs(word) {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  if (!w) return 0;
  let count = 0;
  let prevVowel = null;
  for (const ch of w) {
    const isV = VOWELS_ES.includes(ch) || (ch === 'y' && prevVowel !== null && false);
    if (isV) {
      if (prevVowel === null) count++;
      else if (STRONG.includes(prevVowel) && STRONG.includes(ch)) count++; // hiato
      prevVowel = ch;
    } else {
      prevVowel = null;
    }
  }
  return Math.max(1, count);
}

export function syllablesEn(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Nivel de lectura.
 * Español: índice de Szigriszt-Pazos con la escala INFLESZ.
 * Inglés: Flesch Reading Ease.
 */
export function readability(text, lang = detectLang(text)) {
  const words = tokenize(text);
  const sentences = splitSentences(text).filter((s) => tokenize(s.text).length > 0);
  const nW = words.length;
  const nS = Math.max(1, sentences.length);
  if (nW < 20) {
    return { words: nW, sentences: nS, score: null, label: 'Muy poco texto', level: 0, minutes: 0, lang };
  }
  const syl = words.reduce((a, w) => a + (lang === 'en' ? syllablesEn(w) : syllablesEs(w)), 0);
  let score;
  let label;
  let level; // 1 = muy fácil … 5 = muy difícil
  if (lang === 'en') {
    score = 206.835 - 1.015 * (nW / nS) - 84.6 * (syl / nW);
    if (score >= 80) { label = 'Muy fácil'; level = 1; }
    else if (score >= 70) { label = 'Fácil'; level = 2; }
    else if (score >= 60) { label = 'Normal'; level = 3; }
    else if (score >= 50) { label = 'Algo difícil'; level = 3.5; }
    else if (score >= 30) { label = 'Difícil'; level = 4; }
    else { label = 'Muy difícil (universitario)'; level = 5; }
  } else {
    score = 206.835 - 62.3 * (syl / nW) - nW / nS;
    if (score > 80) { label = 'Muy fácil'; level = 1; }
    else if (score > 65) { label = 'Bastante fácil'; level = 2; }
    else if (score > 55) { label = 'Normal'; level = 3; }
    else if (score > 40) { label = 'Algo difícil'; level = 4; }
    else { label = 'Muy difícil (técnico o universitario)'; level = 5; }
  }
  const wpm = lang === 'en' ? 238 : 220;
  return {
    words: nW,
    sentences: nS,
    syllables: syl,
    score: Math.round(score * 10) / 10,
    label,
    level,
    wordsPerSentence: Math.round((nW / nS) * 10) / 10,
    minutes: Math.max(1, Math.round(nW / wpm)),
    lang,
  };
}

/** Oraciones más largas (las más difíciles de leer). */
export function hardestSentences(text, n = 3) {
  return splitSentences(text)
    .map((s) => ({ ...s, words: tokenize(s.text).length }))
    .filter((s) => s.words >= 25)
    .sort((a, b) => b.words - a.words)
    .slice(0, n);
}
