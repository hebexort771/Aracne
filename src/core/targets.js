// Convierte lo encontrado en "presas" para las arañas.
import { COLORS } from '../spiders/engine.js';

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
  const add = (species, start, end, color, label, extra = {}) => {
    if (start < 0 || end <= start) return null;
    const t = {
      id: `${species}-${start}-${end}`,
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
  // Las arañas empiezan por lo que se ve al abrir: hasta 24 presas del inicio del documento,
  // y el resto por importancia (fechas y fuentes primero).
  const early = out.filter((t) => Number(t.id.split('-')[1]) < doc.text.length * 0.12).sort((a, b) => a.priority - b.priority).slice(0, 24);
  const earlySet = new Set(early);
  const others = out.filter((t) => !earlySet.has(t)).sort((a, b) => a.priority - b.priority);
  const chosen = [...early, ...others.slice(0, Math.max(0, max - early.length))];
  const chosenSet = new Set(chosen);
  const rest = out.filter((t) => !chosenSet.has(t));
  return { chosen, rest };
}
