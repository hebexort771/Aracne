// Convierte lo encontrado en "presas" para las arañas.
import { COLORS } from '../spiders/engine.js';
import { numberLabel } from './general.js';

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function shortLabel(item) {
  switch (item.type) {
    case 'doi': return `doi:${item.id}`;
    case 'isbn': return `ISBN ${item.id}`;
    case 'pmid': return `PMID ${item.id}`;
    case 'pmcid': return item.id;
    case 'arxiv': return `arXiv:${item.id}`;
    default:
      try {
        return new URL(item.id).hostname.replace(/^www\./, '');
      } catch {
        return item.id.slice(0, 30);
      }
  }
}

/**
 * @returns {object[]} objetivos ordenados por prioridad
 */
export function buildTargets(doc, findings, { carryTo = null, max = 90 } = {}) {
  const out = [];
  const text = (s, e) => (doc.wordsText ? doc.wordsText(s, e) : doc.text.slice(s, e).replace(/\s+/g, ' ').trim());
  const ids = new Set();
  const add = (species, start, end, color, label, extra = {}) => {
    if (start < 0 || end <= start) return null;
    const id = `${species}-${start}-${end}`;
    if (ids.has(id)) return null;
    ids.add(id);
    const t = {
      id,
      pos: start,
      species,
      color,
      label,
      text: text(start, end),
      rects: () => doc.rectsFor(start, end),
      carryTo,
      ...extra,
    };
    out.push(t);
    return t;
  };

  for (const d of findings.dates) {
    if (d.category === 'referencia') continue;
    const dt = new Date(d.date);
    const t = add('dates', d.start, d.end, COLORS.magenta, `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`, { priority: 1 });
    if (t) d.target = t;
  }
  for (const s of findings.sources) {
    if (s.type === 'url' && s.fromLink && out.length > max) continue;
    const t = add('sources', s.start, s.end, COLORS.cyan, shortLabel(s), { priority: s.type === 'url' ? 3 : 2 });
    if (t) s.target = t;
  }
  for (const a of findings.acronyms) {
    add('context', a.start, a.end, COLORS.blue, `${a.acronym} = ${a.definition}`, { priority: 2 });
  }
  for (const r of findings.refs.slice(0, 40)) {
    add('context', r.start, r.end, COLORS.blue, null, { priority: 4, style: 'outline' });
  }

  // Todo tipo de texto: cifras, definiciones, nombres, citas, contactos, títulos y conceptos clave.
  const g = findings.general;
  if (g) {
    for (const n of g.numbers.slice(0, 160)) add('data', n.start, n.end, COLORS.amber, numberLabel(n), { priority: 3 });
    for (const d of g.definitions.slice(0, 40)) add('data', d.start, d.end, COLORS.green, `DEF ${d.term}`, { priority: 3 });
    for (const e of g.emails.slice(0, 20)) add('data', e.start, e.end, COLORS.white, 'CORREO', { priority: 3, style: 'outline' });
    for (const p of g.phones.slice(0, 20)) add('data', p.start, p.end, COLORS.white, 'TELÉFONO', { priority: 3, style: 'outline' });
    for (const q of g.quotes.slice(0, 30)) add('data', q.start, q.end, COLORS.green, null, { priority: 5, style: 'underline' });
    let nameOcc = 0;
    for (const n of g.names.slice(0, 60)) {
      for (const o of n.occurrences.slice(0, 3)) {
        if (++nameOcc > 140) break;
        add('data', o.start, o.end, COLORS.violet, o === n.occurrences[0] && n.count > 1 ? `${n.name.toUpperCase()} ×${n.count}` : null, { priority: 5, style: 'underline' });
      }
    }
  }
  for (const hd of (findings.headings || []).slice(0, 80)) {
    const t = add('heading', hd.start, hd.end, COLORS.cyan, null, { priority: 6, style: 'decode', mark: false });
    if (t) t.text = hd.text;
  }
  // Primera aparición de los conceptos que más se repiten.
  const lowered = doc.text.toLowerCase();
  for (const [, , display] of (findings.keywords || []).slice(0, 10)) {
    if (!display || display.length < 4) continue;
    const re = new RegExp(`(?<![\\p{L}])${display.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'u');
    const m = re.exec(lowered);
    if (m) add('data', m.index, m.index + display.length, COLORS.white, null, { priority: 6, style: 'underline' });
  }
  // Las arañas empiezan por lo que se ve al abrir: hasta 24 presas del inicio del documento,
  // y el resto por importancia (fechas y fuentes primero).
  const early = out.filter((t) => t.pos < doc.text.length * 0.12 && t.priority <= 4).sort((a, b) => a.priority - b.priority).slice(0, 24);
  const earlySet = new Set(early);
  const others = out.filter((t) => !earlySet.has(t) && t.priority <= 4).sort((a, b) => a.priority - b.priority);
  const chosen = [...early, ...others.slice(0, Math.max(0, max - early.length))];
  const chosenSet = new Set(chosen);
  const rest = out.filter((t) => !chosenSet.has(t));
  return { chosen, rest };
}
