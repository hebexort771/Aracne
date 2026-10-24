// Araña de fuentes: comprueba DOI, ISBN, PMID, PMCID, arXiv y enlaces con servicios abiertos y gratuitos.
// Crossref (DOI y retractaciones de Retraction Watch), DataCite, PubMed, arXiv,
// Open Library, Google Books y Wayback Machine (copias de enlaces rotos).
import { net } from 'electron';

const UA = 'Aracne/1.0 (https://github.com/hebexort771/Aracne)';
const cache = new Map();

async function get(url, { timeout = 12000, method = 'GET', accept = 'application/json', redirect = 'follow' } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(url, { method, headers: { 'user-agent': UA, accept }, signal: ctrl.signal, redirect });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, opts) {
  const res = await get(url, opts);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function splitInitials(given) {
  // PubMed da "PA" → "P. A."
  if (/^[A-Z]{1,4}$/.test(given)) return given.split('').join(' ');
  return given;
}

// ---------- DOI ----------

async function checkDoi(doi) {
  const out = { type: 'doi', id: doi, doi, url: `https://doi.org/${doi}` };
  let msg = null;
  try {
    const json = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    msg = json?.message || null;
  } catch {
    msg = null;
  }
  if (msg) {
    const title = (msg.title || [])[0] || '';
    const date = msg.issued?.['date-parts']?.[0] || msg.published?.['date-parts']?.[0] || [];
    Object.assign(out, {
      meta: {
        type: /book/.test(msg.type || '') ? 'book' : 'article',
        authors: (msg.author || []).map((a) => (a.family ? { family: a.family, given: a.given || '' } : { name: a.name || '', organization: true })),
        year: date[0] || null,
        title,
        container: (msg['container-title'] || [])[0] || '',
        volume: msg.volume || '',
        issue: msg.issue || '',
        pages: msg.page || '',
        publisher: msg.publisher || '',
        doi,
      },
      title,
      year: date[0] || null,
      container: (msg['container-title'] || [])[0] || msg.publisher || '',
      citedBy: msg['is-referenced-by-count'] ?? null,
    });
    const updates = [...(msg['update-to'] || []), ...(msg['updated-by'] || [])];
    const types = updates.map((u) => (u.type || '').toLowerCase());
    const isNotice = /^(retraction|retracted|withdrawal|notice of retraction)\b/i.test(title) && !/^retracted\s*:/i.test(title);
    if (isNotice) {
      out.status = 'warn';
      out.note = 'Es un aviso de retractación: el artículo al que se refiere fue retirado.';
    } else if (/^retracted\s*[:—-]/i.test(title) || types.some((t) => ['retraction', 'withdrawal', 'removal'].includes(t))) {
      out.status = 'bad';
      out.note = 'Artículo RETRACTADO: la revista lo retiró. No lo uses como fuente.';
      out.retracted = true;
    } else if (types.includes('expression_of_concern')) {
      out.status = 'warn';
      out.note = 'La revista publicó una "expresión de preocupación" sobre este artículo.';
    } else if (types.some((t) => ['correction', 'erratum', 'corrigendum'].includes(t))) {
      out.status = 'ok';
      out.note = 'Existe; tiene una corrección publicada.';
    } else {
      out.status = 'ok';
      out.note = 'El DOI existe y apunta a esta publicación.';
    }
    return out;
  }
  // No está en Crossref: puede ser de DataCite (Zenodo, arXiv, datasets…)
  try {
    const dc = await getJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
    const a = dc?.data?.attributes;
    if (a) {
      const title = a.titles?.[0]?.title || '';
      Object.assign(out, {
        status: 'ok',
        note: `Registrado en DataCite (${a.types?.resourceTypeGeneral || 'recurso'}).`,
        title,
        year: a.publicationYear || null,
        container: a.publisher?.name || a.publisher || '',
        meta: {
          type: 'article',
          authors: (a.creators || []).map((c) => (c.familyName ? { family: c.familyName, given: c.givenName || '' } : { name: c.name, organization: c.nameType === 'Organizational' })),
          year: a.publicationYear || null,
          title,
          container: typeof a.publisher === 'string' ? a.publisher : a.publisher?.name || '',
          doi,
        },
      });
      return out;
    }
  } catch {
    /* sigue */
  }
  try {
    const h = await getJson(`https://doi.org/api/handles/${encodeURIComponent(doi)}`);
    if (h && h.responseCode === 1) {
      return { ...out, status: 'warn', note: 'El DOI existe, pero no hay datos abiertos de esta publicación.' };
    }
  } catch {
    return { ...out, status: 'unknown', note: 'No se pudo comprobar (sin conexión o servicio caído).' };
  }
  return { ...out, status: 'bad', note: 'Este DOI no existe. Puede estar mal escrito o ser inventado.' };
}

// ---------- PubMed ----------

async function pubmedSummary(pmid) {
  const json = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`);
  const r = json?.result?.[pmid];
  if (!r || r.error) return null;
  const doi = (r.articleids || []).find((x) => x.idtype === 'doi')?.value || null;
  const year = Number((r.pubdate || '').slice(0, 4)) || null;
  const retracted = (r.pubtype || []).some((t) => /retracted publication/i.test(t));
  return {
    title: r.title?.replace(/\.$/, '') || '',
    year,
    container: r.fulljournalname || r.source || '',
    doi,
    retracted,
    meta: {
      type: 'article',
      authors: (r.authors || []).filter((a) => a.authtype === 'Author').map((a) => {
        const [family, ...rest] = a.name.split(' ');
        return { family, given: splitInitials(rest.join(' ')) };
      }),
      year,
      title: r.title?.replace(/\.$/, '') || '',
      container: r.fulljournalname || r.source || '',
      volume: r.volume || '',
      issue: r.issue || '',
      pages: r.pages || '',
      doi,
    },
  };
}

async function checkPmid(pmid, type = 'pmid', id = pmid) {
  const out = { type, id, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` };
  const s = await pubmedSummary(pmid);
  if (!s) return { ...out, status: 'bad', note: 'No existe en PubMed.' };
  return {
    ...out,
    ...s,
    status: s.retracted ? 'bad' : 'ok',
    note: s.retracted ? 'Artículo RETRACTADO según PubMed.' : 'Encontrado en PubMed.',
  };
}

async function checkPmcid(pmcid) {
  const json = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(pmcid)}&retmode=json`);
  const pmid = json?.esearchresult?.idlist?.[0];
  if (!pmid) return { type: 'pmcid', id: pmcid, status: 'bad', note: 'No se encontró en PubMed Central.', url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` };
  const r = await checkPmid(pmid, 'pmcid', pmcid);
  r.url = `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`;
  return r;
}

// ---------- arXiv ----------

function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

async function checkArxiv(id) {
  const out = { type: 'arxiv', id, url: `https://arxiv.org/abs/${id}` };
  const res = await get(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { accept: 'application/atom+xml' });
  const xml = await res.text();
  const entry = xml.split('<entry>')[1];
  if (!entry || /<title>Error<\/title>/i.test(entry)) return { ...out, status: 'bad', note: 'Este identificador de arXiv no existe.' };
  const title = xmlText(entry, 'title');
  const year = Number(xmlText(entry, 'published').slice(0, 4)) || null;
  const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => ({ name: m[1].trim() }));
  return {
    ...out,
    status: 'warn',
    note: 'Es un preprint: todavía no pasó revisión por pares. Busca si ya se publicó en una revista.',
    title,
    year,
    container: 'arXiv',
    meta: { type: 'article', authors, year, title, container: 'arXiv', doi: `10.48550/arXiv.${id}` },
  };
}

// ---------- ISBN ----------

async function checkIsbn(isbn) {
  const out = { type: 'isbn', id: isbn, url: `https://openlibrary.org/isbn/${isbn}` };
  try {
    const json = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    const b = json?.[`ISBN:${isbn}`];
    if (b) {
      const year = Number((b.publish_date || '').match(/\d{4}/)?.[0]) || null;
      return {
        ...out,
        status: 'ok',
        note: 'Libro encontrado en Open Library.',
        title: b.title,
        year,
        container: (b.publishers || [])[0]?.name || '',
        url: b.url || out.url,
        meta: { type: 'book', authors: (b.authors || []).map((a) => ({ name: a.name })), year, title: b.title, publisher: (b.publishers || [])[0]?.name || '' },
      };
    }
  } catch {
    /* sigue con Google Books */
  }
  try {
    const json = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const v = json?.items?.[0]?.volumeInfo;
    if (v) {
      const year = Number((v.publishedDate || '').slice(0, 4)) || null;
      return {
        ...out,
        status: 'ok',
        note: 'Libro encontrado en Google Books.',
        title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''),
        year,
        container: v.publisher || '',
        url: v.infoLink || out.url,
        meta: { type: 'book', authors: (v.authors || []).map((n) => ({ name: n })), year, title: v.title + (v.subtitle ? `: ${v.subtitle}` : ''), publisher: v.publisher || '' },
      };
    }
  } catch {
    return { ...out, status: 'unknown', note: 'No se pudo comprobar (sin conexión).' };
  }
  return { ...out, status: 'warn', note: 'El ISBN es válido, pero no aparece en catálogos abiertos.' };
}

// ---------- Enlaces ----------

async function checkUrl(url) {
  const out = { type: 'url', id: url, url };
  let res;
  try {
    res = await get(url, { method: 'HEAD', accept: '*/*', timeout: 10000 });
    if (res.status === 405 || res.status === 403 || res.status === 400) res = await get(url, { accept: 'text/html,*/*', timeout: 12000 });
  } catch (err) {
    res = { status: 0, error: err };
  }
  const code = res.status;
  if (code >= 200 && code < 400) {
    const moved = res.url && res.url !== url && new URL(res.url).hostname !== new URL(url).hostname;
    return { ...out, status: 'ok', code, note: moved ? `Funciona (redirige a ${new URL(res.url).hostname}).` : 'El enlace funciona.' };
  }
  if (code === 401 || code === 403 || code === 429) {
    return { ...out, status: 'warn', code, note: 'El sitio responde, pero pide acceso o bloquea comprobaciones automáticas.' };
  }
  // Roto: buscar copia en archive.org
  let archive = null;
  try {
    const json = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
    const snap = json?.archived_snapshots?.closest;
    if (snap?.available) archive = { url: snap.url.replace(/^http:/, 'https:'), timestamp: snap.timestamp };
  } catch {
    /* sin copia */
  }
  const why = code ? `responde ${code}` : 'no responde';
  return {
    ...out,
    status: 'bad',
    code,
    archive,
    note: archive ? `Enlace roto (${why}). Hay una copia guardada en archive.org.` : `Enlace roto (${why}) y sin copia en archive.org.`,
  };
}

// ---------- Entrada ----------

export async function checkSource({ type, id }) {
  const key = `${type}:${id}`;
  if (cache.has(key)) return cache.get(key);
  const task = (async () => {
    try {
      switch (type) {
        case 'doi': return await checkDoi(id);
        case 'pmid': return await checkPmid(id);
        case 'pmcid': return await checkPmcid(id);
        case 'arxiv': return await checkArxiv(id);
        case 'isbn': return await checkIsbn(id);
        case 'url': return await checkUrl(id);
        default: return { type, id, status: 'unknown', note: 'Tipo no compatible.' };
      }
    } catch (err) {
      cache.delete(key);
      return { type, id, status: 'unknown', note: `No se pudo comprobar: ${err.message}` };
    }
  })();
  cache.set(key, task);
  return task;
}
