import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSources, extractAcronyms, extractInternalRefs, blockMatchesRef, validIsbn, isbn13 } from '../src/core/extract.js';
import { readability, splitSentences, detectLang, syllablesEs } from '../src/core/lang.js';
import { extractiveSummary, keyTerms, similarity } from '../src/core/textrank.js';
import { formatReference, formatAuthors, formatBibliography } from '../src/core/apa.js';
import { extractDates } from '../src/core/dates.js';
import { buildIcs, googleCalendarUrl } from '../src/core/ics.js';

test('fuentes: DOI, ISBN, PMID, PMC, arXiv y URL', () => {
  const t = 'Ver doi:10.1111/1475-4983.00068. También https://doi.org/10.1038/379498b0, ISBN 978-0-89672-620-8 y ISBN 0-19-852663-6. PMID: 21508021, PMC3169061, arXiv:2101.00001v2 y https://example.com/a(b).';
  const s = extractSources(t);
  const by = (type) => s.filter((x) => x.type === type).map((x) => x.id);
  assert.deepEqual(by('doi'), ['10.1111/1475-4983.00068', '10.1038/379498b0']);
  assert.deepEqual(by('isbn'), ['9780896726208', '9780198526636']);
  assert.deepEqual(by('pmid'), ['21508021']);
  assert.deepEqual(by('pmcid'), ['PMC3169061']);
  assert.deepEqual(by('arxiv'), ['2101.00001']);
  assert.deepEqual(by('url'), ['https://example.com/a(b)']);
  for (const x of s) assert.equal(t.slice(x.start, x.end).length > 0, true);
});

test('ISBN: valida y convierte', () => {
  assert.equal(validIsbn('978-0-89672-620-8'), true);
  assert.equal(validIsbn('978-0-89672-620-9'), false);
  assert.equal(isbn13('0-19-852663-6'), '9780198526636');
});

test('siglas', () => {
  const t = 'La Organización Mundial de la Salud (OMS) publicó la guía. Según la OMS, el riesgo baja. El Protocolo de Internet (IP) es básico; cada IP identifica un equipo.';
  const a = extractAcronyms(t);
  const oms = a.find((x) => x.acronym === 'OMS');
  assert.ok(oms);
  assert.equal(oms.definition, 'Organización Mundial de la Salud');
  assert.equal(oms.uses.length, 1);
  const ip = a.find((x) => x.acronym === 'IP');
  assert.equal(ip.definition, 'Protocolo de Internet');
});

test('referencias internas', () => {
  const r = extractInternalRefs('Como muestra la Figura 3 y la Tabla 2.1 (ver sección 4.2) [12], [3–5].');
  assert.deepEqual(r.map((x) => `${x.kind}${x.num}`), ['fig3', 'tab2.1', 'sec4.2', 'cite12', 'cite3']);
  assert.equal(blockMatchesRef('Figura 3. Distribución de arañas', { kind: 'fig', num: '3' }), true);
  assert.equal(blockMatchesRef('Tabla 2.1: Resultados', { kind: 'tab', num: '2.1' }), true);
  assert.equal(blockMatchesRef('[12] Selden, P. A. (2011).', { kind: 'cite', num: '12' }), true);
  assert.equal(blockMatchesRef('4.2 Métodos de muestreo', { kind: 'sec', num: '4.2' }), true);
});

test('idioma, oraciones y nivel de lectura', () => {
  assert.equal(detectLang('El análisis de las redes de computadoras es una parte de la carrera.'), 'es');
  assert.equal(detectLang('The analysis of computer networks is part of the course and it is useful.'), 'en');
  const s = splitSentences('El Dr. Pérez llegó. Luego habló con la Sra. Ruiz sobre la Fig. 2. ¿Vendrá mañana? Sí.');
  assert.equal(s.length, 4);
  assert.equal(syllablesEs('computadora'), 5);
  assert.equal(syllablesEs('día'), 2);
  assert.equal(syllablesEs('ciudad'), 2);
  const r = readability('Las arañas tejen redes. Las redes atrapan insectos. Es un trabajo lento pero eficaz. Cada araña construye su propia red con seda muy resistente y flexible.', 'es');
  assert.ok(r.score > 50);
  assert.ok(r.minutes >= 1);
});

test('resumen extractivo y términos clave', () => {
  const blocks = [
    { id: 1, text: 'Las arañas son artrópodos que producen seda. La seda de araña es muy resistente.' },
    { id: 2, text: 'Existen más de cincuenta mil especies de arañas descritas en el mundo. Las arañas viven en casi todos los hábitats.' },
    { id: 3, text: 'La seda se usa para construir redes, envolver presas y proteger los huevos de las arañas.' },
  ];
  const s = extractiveSummary(blocks, 2);
  assert.equal(s.length, 2);
  assert.ok(s.every((x) => [1, 2, 3].includes(x.block)));
  const k = keyTerms(blocks.map((b) => b.text).join(' '));
  assert.ok(k.some(([t]) => t === 'arana'));
  const sim = similarity(k, keyTerms('La seda de las arañas y sus redes'));
  assert.ok(sim.score > 0);
});

test('APA 7', () => {
  assert.equal(formatAuthors([{ given: 'Paul A.', family: 'Selden' }, { given: 'ChungKun', family: 'Shih' }, { name: 'Dong Ren' }]), 'Selden, P. A., Shih, C. y Ren, D.');
  const art = formatReference({ type: 'article', authors: [{ given: 'Paul A.', family: 'Selden' }], year: 2011, title: 'A golden orb-weaver spider from the Middle Jurassic of China', container: 'Biology Letters', volume: 7, issue: 5, pages: '775-778', doi: '10.1098/rsbl.2011.0228' });
  assert.equal(art.text, 'Selden, P. A. (2011). A golden orb-weaver spider from the Middle Jurassic of China. Biology Letters, 7(5), 775–778. https://doi.org/10.1098/rsbl.2011.0228');
  assert.match(art.html, /<i>Biology Letters<\/i>, <i>7<\/i>\(5\)/);
  const book = formatReference({ type: 'book', authors: [{ name: 'Rainer F. Foelix' }], year: 2011, title: 'Biology of Spiders', publisher: 'Oxford University Press' });
  assert.equal(book.text, 'Foelix, R. F. (2011). Biology of Spiders. Oxford University Press.');
  const web = formatReference({ type: 'web', authors: [], site: 'Wikipedia', title: 'Araña', url: 'https://es.wikipedia.org/wiki/Araña', accessed: '2026-10-23T12:00:00' });
  assert.match(web.text, /^Wikipedia\. \(s\.f\.\)\. Araña\. Recuperado el 23 de octubre de 2026, de https/);
  const bib = formatBibliography([book, art].map(() => ({ type: 'book', authors: [{ name: 'Zeta Uno' }], year: 2000, title: 'Z' })));
  assert.ok(bib.text.length > 0);
});

test('plazos', () => {
  const ref = new Date('2026-10-23T12:00:00');
  const t = 'El examen parcial será el 15 de noviembre a las 10:00. La entrega del informe final vence el 21/11/2026. El pago de la pensión vence el 5 de diciembre.';
  const d = extractDates(t, 'es', ref);
  assert.equal(d.length, 3);
  assert.deepEqual(d.map((x) => x.category), ['examen', 'entrega', 'pago']);
  assert.equal(d[0].hasTime, true);
  assert.match(d[0].title, /^Examen parcial/);
  const ics = buildIcs(d, 'Sílabo');
  assert.match(ics, /BEGIN:VEVENT[\s\S]*SUMMARY:Examen/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(googleCalendarUrl(d[1]), /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
});
