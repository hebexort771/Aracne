// Tareas de IA: resumen con párrafos citados, preguntas, estudio, visión y letra pequeña.
import { api } from '../core/bridge.js';
import { tokenize, normTerm, isStopword } from '../core/lang.js';
import { extractiveSummary } from '../core/textrank.js';

const SYSTEM_BASE = `Eres Aracne, un asistente de lectura para estudiantes universitarios.
Responde SIEMPRE en español claro y natural, aunque el documento esté en otro idioma.
Usa solo la información del documento que te dan; si algo no está en el documento, dilo.
Cuando se te pida JSON, responde ÚNICAMENTE con JSON válido, sin texto antes ni después.`;

let statusCache = { at: 0, value: null };

export async function aiStatus(force = false) {
  if (!force && statusCache.value && Date.now() - statusCache.at < 15000) return statusCache.value;
  try {
    statusCache = { at: Date.now(), value: await api.ai.status() };
  } catch {
    statusCache = { at: Date.now(), value: { available: false } };
  }
  return statusCache.value;
}

export function parseJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const first = t.search(/[[{]/);
  const lastObj = t.lastIndexOf('}');
  const lastArr = t.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch {
    const fixed = t.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
    return JSON.parse(fixed);
  }
}

async function callJson({ system = SYSTEM_BASE, prompt, images, maxTokens = 4096 }) {
  const res = await api.ai.complete({ system, prompt, images, json: true, maxTokens });
  try {
    return parseJson(res.text);
  } catch {
    // Segundo intento: pedir que corrija el formato.
    const retry = await api.ai.complete({
      system,
      prompt: `${prompt}\n\nIMPORTANTE: tu respuesta anterior no era JSON válido. Devuelve solo el JSON.`,
      images,
      json: true,
      maxTokens,
    });
    return parseJson(retry.text);
  }
}

function blockLine(b) {
  const t = b.text.length > 1800 ? `${b.text.slice(0, 1800)}…` : b.text;
  return `[¶${b.id}]${b.type === 'heading' ? ' # ' : ' '}${t}`;
}

/** Párrafos que caben en el presupuesto de caracteres, en orden. */
function packBlocks(blocks, budget) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const b of blocks) {
    const line = blockLine(b);
    if (size + line.length > budget && cur.length) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(b);
    size += line.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function docBlocks(doc, findings) {
  const refs = findings?.refBlocks || new Set();
  return doc.blocks.filter((b) => !refs.has(b.id) && b.text.length > 1);
}

function cleanIds(list, doc) {
  const max = doc.blocks.length;
  return [...new Set((Array.isArray(list) ? list : [list]).map((n) => parseInt(String(n).replace(/\D/g, ''), 10)).filter((n) => n >= 1 && n <= max))];
}

// ---------------------------------------------------------------- Resumen

const SUMMARY_SHAPE = `{
  "tldr": "resumen de 2 a 3 oraciones",
  "puntos": [{"texto": "idea clave", "parrafos": [3, 4]}],
  "secciones": [{"titulo": "título", "resumen": "2-4 oraciones", "parrafos": [5, 6, 7]}],
  "glosario": [{"termino": "palabra técnica", "definicion": "explicación sencilla", "parrafo": 8}],
  "preguntas": ["pregunta para pensar o repasar"]
}`;

export async function summarize(doc, findings, onProgress = () => {}) {
  const status = await aiStatus();
  const budget = Math.min(status.contextChars || 14000, 110000);
  const blocks = docBlocks(doc, findings);
  const chunks = packBlocks(blocks, budget);
  const title = doc.title ? `Título: ${doc.title}\n` : '';

  if (chunks.length === 1) {
    onProgress(0.3);
    const json = await callJson({
      prompt: `${title}Documento (cada párrafo empieza con su número [¶N]):\n\n${chunks[0].map(blockLine).join('\n')}\n\n` +
        `Haz un resumen de estudio. Para cada idea indica de qué párrafos sale (números ¶).\n` +
        `Entre 5 y 9 puntos clave, secciones solo si el texto tiene partes distintas, glosario con 4 a 10 términos técnicos y 3 a 5 preguntas de repaso.\n` +
        `Devuelve JSON con esta forma:\n${SUMMARY_SHAPE}`,
      maxTokens: 4096,
    });
    return normalizeSummary(json, doc);
  }

  // Documento largo: resumir por partes y luego unir.
  const partials = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress((i + 0.5) / (chunks.length + 1));
    const json = await callJson({
      prompt: `${title}Parte ${i + 1} de ${chunks.length} del documento:\n\n${chunks[i].map(blockLine).join('\n')}\n\n` +
        `Extrae de 3 a 6 ideas clave de esta parte y los términos técnicos importantes. Indica los párrafos ¶ de cada idea.\n` +
        `JSON: {"puntos":[{"texto":"...","parrafos":[1]}],"glosario":[{"termino":"...","definicion":"...","parrafo":1}],"tema":"de qué trata esta parte en una frase"}`,
      maxTokens: 2048,
    });
    partials.push(json);
  }
  onProgress(chunks.length / (chunks.length + 1));
  const notes = partials.map((p, i) => `Parte ${i + 1} — ${p.tema || ''}\n${(p.puntos || []).map((x) => `- ${x.texto} (¶${(x.parrafos || []).join(', ¶')})`).join('\n')}`).join('\n\n');
  const final = await callJson({
    prompt: `${title}Estas son las ideas clave de cada parte de un documento largo, con sus párrafos:\n\n${notes}\n\n` +
      `Únelas en un resumen de estudio. Conserva los números de párrafo. Devuelve JSON:\n${SUMMARY_SHAPE}`,
    maxTokens: 4096,
  });
  final.glosario = [...(final.glosario || []), ...partials.flatMap((p) => p.glosario || [])];
  return normalizeSummary(final, doc);
}

function normalizeSummary(json, doc) {
  const seenTerms = new Set();
  return {
    tldr: String(json.tldr || json.resumen || '').trim(),
    puntos: (json.puntos || []).map((p) => ({ texto: String(p.texto || p).trim(), parrafos: cleanIds(p.parrafos || [], doc) })).filter((p) => p.texto),
    secciones: (json.secciones || []).map((s) => ({ titulo: String(s.titulo || '').trim(), resumen: String(s.resumen || '').trim(), parrafos: cleanIds(s.parrafos || [], doc) })).filter((s) => s.resumen),
    glosario: (json.glosario || [])
      .map((g) => ({ termino: String(g.termino || '').trim(), definicion: String(g.definicion || '').trim(), parrafo: cleanIds(g.parrafo || [], doc)[0] || null }))
      .filter((g) => g.termino && g.definicion && !seenTerms.has(g.termino.toLowerCase()) && seenTerms.add(g.termino.toLowerCase())),
    preguntas: (json.preguntas || []).map((q) => String(q).trim()).filter(Boolean),
  };
}

/** Resumen sin IA (oraciones más representativas). */
export function offlineSummary(doc, findings) {
  return extractiveSummary(docBlocks(doc, findings), 7);
}

// ---------------------------------------------------------------- Preguntas

function relevantBlocks(doc, findings, question, budget) {
  const blocks = docBlocks(doc, findings);
  const total = blocks.reduce((a, b) => a + b.text.length, 0);
  if (total <= budget) return blocks;
  const qTerms = new Set(tokenize(question).filter((w) => w.length > 2 && !isStopword(w)).map(normTerm));
  const df = new Map();
  const docsTerms = blocks.map((b) => {
    const terms = tokenize(b.text).map(normTerm);
    for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
    return terms;
  });
  const N = blocks.length;
  const avg = docsTerms.reduce((a, t) => a + t.length, 0) / N;
  const scored = blocks.map((b, i) => {
    const terms = docsTerms[i];
    let score = 0;
    for (const q of qTerms) {
      const f = terms.filter((t) => t === q).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) || 0) + 0.5) / ((df.get(q) || 0) + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (terms.length / avg))));
    }
    return { b, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = new Set();
  let size = 0;
  for (const { b, score } of scored) {
    if (score <= 0 && picked.size > 4) break;
    for (const nb of [blocks[blocks.indexOf(b) - 1], b, blocks[blocks.indexOf(b) + 1]]) {
      if (!nb || picked.has(nb)) continue;
      if (size + nb.text.length > budget) break;
      picked.add(nb);
      size += nb.text.length;
    }
    if (size > budget * 0.9) break;
  }
  return blocks.filter((b) => picked.has(b));
}

export async function ask(doc, findings, question, history = []) {
  const status = await aiStatus();
  const budget = Math.min(status.contextChars || 14000, 100000) - 2000;
  const blocks = relevantBlocks(doc, findings, question, budget);
  const past = history.slice(-4).map((m) => `${m.role === 'user' ? 'Estudiante' : 'Aracne'}: ${m.text}`).join('\n');
  const json = await callJson({
    prompt: `${doc.title ? `Título: ${doc.title}\n` : ''}Fragmentos del documento:\n\n${blocks.map(blockLine).join('\n')}\n\n` +
      `${past ? `Conversación previa:\n${past}\n\n` : ''}Pregunta del estudiante: ${question}\n\n` +
      `Responde de forma clara y didáctica (puedes usar ejemplos sencillos). Indica los párrafos ¶ en los que te basas. ` +
      `Si la respuesta no está en el documento, dilo y explica lo que sí dice.\n` +
      `JSON: {"respuesta":"texto (puede tener viñetas con - )","parrafos":[N],"en_documento":true}`,
    maxTokens: 2048,
  });
  return {
    respuesta: String(json.respuesta || json.answer || '').trim(),
    parrafos: cleanIds(json.parrafos || [], doc),
    enDocumento: json.en_documento !== false,
  };
}

// ---------------------------------------------------------------- Estudio

export async function study(doc, findings, { cards = 10, quiz = 6 } = {}) {
  const status = await aiStatus();
  const budget = Math.min(status.contextChars || 14000, 90000);
  let blocks = docBlocks(doc, findings);
  const total = blocks.reduce((a, b) => a + b.text.length, 0);
  if (total > budget) {
    // Prioriza los párrafos más representativos.
    const key = new Set(extractiveSummary(blocks, 40).map((s) => s.block));
    const scored = blocks.filter((b) => key.has(b.id) || b.type === 'heading');
    blocks = packBlocks(scored.length ? scored : blocks, budget)[0];
  }
  const json = await callJson({
    prompt: `${doc.title ? `Título: ${doc.title}\n` : ''}Documento:\n\n${blocks.map(blockLine).join('\n')}\n\n` +
      `Crea material de estudio para un examen universitario sobre este documento:\n` +
      `- ${cards} tarjetas (pregunta corta al frente, respuesta precisa atrás).\n` +
      `- ${quiz} preguntas de opción múltiple con 4 opciones, una sola correcta, distractores creíbles y una explicación.\n` +
      `Indica el párrafo ¶ de donde sale cada una.\n` +
      `JSON: {"tarjetas":[{"frente":"...","reverso":"...","parrafo":N}],"quiz":[{"pregunta":"...","opciones":["a","b","c","d"],"correcta":0,"explicacion":"...","parrafo":N}]}`,
    maxTokens: 6000,
  });
  return {
    tarjetas: (json.tarjetas || []).map((t) => ({ frente: String(t.frente || '').trim(), reverso: String(t.reverso || '').trim(), parrafo: cleanIds(t.parrafo || [], doc)[0] || null })).filter((t) => t.frente && t.reverso),
    quiz: (json.quiz || [])
      .map((q) => ({
        pregunta: String(q.pregunta || '').trim(),
        opciones: (q.opciones || []).map(String).slice(0, 5),
        correcta: Math.max(0, Math.min((q.opciones || []).length - 1, Number(q.correcta) || 0)),
        explicacion: String(q.explicacion || '').trim(),
        parrafo: cleanIds(q.parrafo || [], doc)[0] || null,
      }))
      .filter((q) => q.pregunta && q.opciones.length >= 2),
  };
}

// ---------------------------------------------------------------- Visión

export async function analyzeImage(image, contextText = '') {
  const json = await callJson({
    prompt: `Analiza esta imagen para un estudiante. ${contextText ? `Contexto del documento donde aparece: "${contextText.slice(0, 600)}"\n` : ''}` +
      `1) Di qué tipo de imagen es. 2) Descríbela. 3) Copia el texto que se lee en ella. 4) Explica qué significa o qué enseña. ` +
      `Si es un gráfico, lee los ejes, las series y los valores principales y di qué tendencia muestra. ` +
      `Si es una fórmula, escríbela en LaTeX y explica cada símbolo. Si es una tabla, extrae sus filas. Si es una foto, describe lo importante.\n` +
      `JSON: {"tipo":"grafico|diagrama|formula|tabla|foto|captura|texto|otro","titulo":"...","descripcion":"...","texto":"texto leído (o vacío)",` +
      `"explicacion":"...","datos":[{"etiqueta":"...","valor":"..."}],"latex":"(solo si hay fórmula)","puntos_clave":["..."]}`,
    images: [image],
    maxTokens: 3000,
  });
  return {
    tipo: String(json.tipo || 'otro').toLowerCase(),
    titulo: String(json.titulo || '').trim(),
    descripcion: String(json.descripcion || '').trim(),
    texto: String(json.texto || '').trim(),
    explicacion: String(json.explicacion || '').trim(),
    datos: Array.isArray(json.datos) ? json.datos.filter((d) => d && (d.etiqueta || d.valor)) : [],
    latex: String(json.latex || '').trim(),
    puntos: (json.puntos_clave || []).map(String).filter(Boolean),
  };
}

// ---------------------------------------------------------------- Letra pequeña

export async function fineprint(doc, findings) {
  const status = await aiStatus();
  const budget = Math.min(status.contextChars || 14000, 110000);
  const chunks = packBlocks(doc.blocks, budget);
  const all = [];
  let veredicto = '';
  for (const chunk of chunks.slice(0, 4)) {
    const json = await callJson({
      prompt: `Texto (párrafos numerados [¶N]):\n\n${chunk.map(blockLine).join('\n')}\n\n` +
        `Eres un abogado de consumo que protege al lector. Busca cláusulas que puedan perjudicarlo: renovación automática, ` +
        `costos ocultos o adicionales, penalidades o multas, permanencia mínima, dificultad para cancelar, uso o venta de datos personales, ` +
        `cambios de condiciones sin aviso, renuncia a derechos o a reclamar, arbitraje obligatorio, limitación de responsabilidad, ` +
        `cesión de derechos sobre tu contenido, cobros en moneda extranjera, plazos muy cortos.\n` +
        `Copia la frase exacta del texto en "cita". Gravedad: 3 = muy importante, 2 = cuidado, 1 = para saber.\n` +
        `JSON: {"veredicto":"una frase sobre qué tan seguro es aceptar esto","hallazgos":[{"tipo":"...","gravedad":3,"cita":"frase exacta","explicacion":"qué significa para ti en palabras simples","parrafo":N}]}`,
      maxTokens: 3000,
    });
    veredicto = veredicto || String(json.veredicto || '');
    for (const f of json.hallazgos || []) {
      all.push({
        tipo: String(f.tipo || 'Cláusula').trim(),
        gravedad: Math.max(1, Math.min(3, Number(f.gravedad) || 2)),
        cita: String(f.cita || '').trim(),
        explicacion: String(f.explicacion || '').trim(),
        parrafo: cleanIds(f.parrafo || [], doc)[0] || null,
      });
    }
  }
  all.sort((a, b) => b.gravedad - a.gravedad);
  void findings;
  return { veredicto, hallazgos: all };
}

/** Busca una cita textual dentro del documento (para resaltarla). */
export function locateQuote(doc, quote, blockId) {
  if (!quote) return null;
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');
  const q = norm(quote).slice(0, 160);
  const hay = norm(doc.text);
  let idx = hay.indexOf(q);
  if (idx < 0 && q.length > 40) idx = hay.indexOf(q.slice(0, 40));
  if (idx < 0) {
    const b = blockId ? doc.blocks[blockId - 1] : null;
    return b ? { start: b.start, end: b.end } : null;
  }
  // Mapear el índice normalizado al original (los espacios múltiples se colapsaron).
  let i = 0, j = 0;
  const src = doc.text.toLowerCase();
  while (j < idx && i < src.length) {
    if (/\s/.test(src[i])) {
      while (i + 1 < src.length && /\s/.test(src[i + 1])) i++;
    }
    i++;
    j++;
  }
  return { start: i, end: Math.min(doc.text.length, i + quote.length) };
}
