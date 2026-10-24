// Referencias en formato APA 7 (convenciones en español: "y", "s.f.", "Recuperado el").

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function initials(given) {
  return given
    .split(/[\s]+/)
    .filter(Boolean)
    .map((part) => part.split('-').map((p) => (p[0] ? `${p[0].toUpperCase()}.` : '')).join('-'))
    .join(' ');
}

/** Acepta {given, family} o {name: "Nombre Apellido"} o "Apellido, Nombre". */
export function normalizeAuthor(a) {
  if (!a) return null;
  if (typeof a === 'string') a = { name: a };
  if (a.family) return { family: a.family.trim(), given: (a.given || '').trim() };
  const name = (a.name || a.literal || '').trim();
  if (!name) return null;
  if (name.includes(',')) {
    const [family, given] = name.split(',');
    return { family: family.trim(), given: (given || '').trim() };
  }
  // Organización o una sola palabra
  const ORG = /\b(universidad|instituto|organizaci[oó]n|ministerio|asociaci[oó]n|sociedad|fundaci[oó]n|colegio|escuela|facultad|biblioteca|gobierno|banco|comisi[oó]n|consejo|departamento|centro|editorial|naciones unidas|university|institute|association|society|foundation|organization|organisation|ministry|department|center|centre|council|college|press|inc\.?|ltd\.?|s\.a\.c?|wikipedia|unesco|oms|who)\b/i;
  if (a.organization || !/\s/.test(name) || ORG.test(name)) return { family: name, given: '', org: true };
  const parts = name.split(/\s+/);
  const particles = ['de', 'del', 'van', 'von', 'da', 'di', 'la', 'le', 'dos', 'das'];
  let i = parts.length - 1;
  while (i > 0 && particles.includes(parts[i - 1].toLowerCase())) i--;
  return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
}

function authorText(a) {
  if (a.org || !a.given) return a.family;
  return `${a.family}, ${initials(a.given)}`;
}

export function formatAuthors(list) {
  const authors = (list || []).map(normalizeAuthor).filter(Boolean);
  if (!authors.length) return '';
  const names = authors.map(authorText);
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function endDot(s) {
  return /[.?!]$/.test(s) ? s : `${s}.`;
}

function dateText(meta) {
  if (meta.year && meta.month && meta.day) return `${meta.year}, ${meta.day} de ${MONTHS_ES[meta.month - 1]}`;
  if (meta.year && meta.month) return `${meta.year}, ${MONTHS_ES[meta.month - 1]}`;
  return meta.year ? String(meta.year) : 's.f.';
}

/**
 * @param {object} meta {type:'article'|'book'|'web', authors, year, month?, day?, title, container?, volume?, issue?, pages?, publisher?, doi?, url?, site?, accessed?}
 * @returns {{text:string, html:string}}
 */
export function formatReference(meta) {
  const parts = []; // [texto, cursiva?]
  const authors = formatAuthors(meta.authors);
  const title = (meta.title || 'Sin título').replace(/\s+/g, ' ').trim();
  const lead = authors || (meta.type === 'web' ? meta.site || '' : '');
  const date = `(${dateText(meta)}).`;

  if (lead) {
    parts.push([`${endDot(lead)} `, false], [`${date} `, false]);
  }

  if (meta.type === 'article') {
    if (!lead) parts.push([`${endDot(title)} `, false], [`${date} `, false]);
    else parts.push([`${endDot(title)} `, false]);
    if (meta.container) {
      parts.push([meta.container, true]);
      if (meta.volume) {
        parts.push([', ', false], [String(meta.volume), true]);
        if (meta.issue) parts.push([`(${meta.issue})`, false]);
      }
      if (meta.pages) parts.push([`, ${String(meta.pages).replace('-', '–')}`, false]);
      parts.push(['. ', false]);
    }
  } else if (meta.type === 'book') {
    if (!lead) parts.push([endDot(title), true], [` ${date} `, false]);
    else parts.push([endDot(title), true], [' ', false]);
    if (meta.publisher) parts.push([`${endDot(meta.publisher)} `, false]);
  } else {
    // Página web
    if (!lead) parts.push([endDot(title), true], [` ${date} `, false]);
    else parts.push([endDot(title), true], [' ', false]);
    if (meta.site && meta.site !== lead && meta.site !== authors) parts.push([`${endDot(meta.site)} `, false]);
    if (!meta.year && meta.accessed) {
      const d = new Date(meta.accessed);
      parts.push([`Recuperado el ${d.getDate()} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}, de `, false]);
    }
  }

  if (meta.doi) parts.push([`https://doi.org/${meta.doi}`, false]);
  else if (meta.url) parts.push([meta.url, false]);

  const text = parts.map(([t]) => t).join('').replace(/\s+/g, ' ').trim();
  const html = parts.map(([t, it]) => (it ? `<i>${escapeHtml(t)}</i>` : escapeHtml(t))).join('').replace(/\s+/g, ' ').trim();
  return { text, html };
}

/** Lista ordenada alfabéticamente, como pide APA. */
export function formatBibliography(metas) {
  const refs = metas.map(formatReference);
  refs.sort((a, b) => a.text.localeCompare(b.text, 'es', { sensitivity: 'base' }));
  return {
    text: refs.map((r) => r.text).join('\n\n'),
    html: refs.map((r) => `<p style="margin-left:0.5in;text-indent:-0.5in">${r.html}</p>`).join(''),
  };
}
