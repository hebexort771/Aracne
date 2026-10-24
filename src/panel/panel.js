// Panel lateral con todo lo que encuentran las arañas. Se usa en el lector y en la capa de pantalla.
import { h, clear, icon, toast, formatDate, pool, escapeHtml, cleanError } from '../core/ui.js';
import { recognize } from '../core/ocr.js';
import { api } from '../core/bridge.js';
import { COLORS } from '../spiders/engine.js';
import { formatReference, formatBibliography } from '../core/apa.js';
import { buildIcs, googleCalendarUrl } from '../core/ics.js';
import { CATEGORY_LABEL } from '../core/dates.js';
import { similarity } from '../core/textrank.js';
import { aiStatus, summarize, offlineSummary, ask, study, analyzeImage, fineprint, locateQuote } from '../ai/tasks.js';

export const SPECIES = {
  sources: { color: COLORS.cyan, label: 'Fuentes' },
  dates: { color: COLORS.magenta, label: 'Plazos' },
  context: { color: COLORS.blue, label: 'Contexto' },
  memory: { color: COLORS.violet, label: 'Memoria' },
  vision: { color: COLORS.green, label: 'Visión' },
  fineprint: { color: COLORS.amber, label: 'Letra pequeña' },
  summary: { color: COLORS.white, label: 'Resumen' },
};

const VIEWS = [
  ['overview', 'web', 'Telaraña'],
  ['summary', 'summary', 'Resumen'],
  ['ask', 'ask', 'Preguntar'],
  ['study', 'study', 'Estudiar'],
  ['vision', 'vision', 'Visión'],
  ['sources', 'sources', 'Fuentes'],
  ['dates', 'calendar', 'Plazos'],
  ['context', 'context', 'Contexto'],
  ['fineprint', 'fineprint', 'Letra pequeña'],
];

const STATUS_TEXT = { ok: 'Verificada', warn: 'Revisar', bad: 'Problema', unknown: 'Sin verificar', pending: 'Revisando…' };
const TYPE_TEXT = { doi: 'DOI', isbn: 'ISBN', pmid: 'PubMed', pmcid: 'PMC', arxiv: 'arXiv', url: 'Enlace' };
const AUTO_URLS = 25;

export class Panel {
  /**
   * @param {object} o
   * @param {HTMLElement} o.mount
   * @param {'lector'|'overlay'} o.mode
   * @param {object} o.hooks {startLens, listImages, setFocusMode, changeFontSize, openSettings, citeMeta}
   */
  constructor({ mount, mode, hooks = {} }) {
    this.mount = mount;
    this.mode = mode;
    this.hooks = hooks;
    this.doc = null;
    this.findings = null;
    this.world = null;
    this.view = 'overview';
    this.state = this.freshState();
    this.links = [];
    this.root = h('aside', { class: `panel panel-${mode}` });
    this.rail = h('nav', { class: 'rail' });
    this.head = h('header', { class: 'pane-head' });
    this.body = h('div', { class: 'pane-body' });
    this.root.append(this.rail, h('section', { class: 'pane' }, this.head, this.body));
    mount.appendChild(this.root);
    for (const [id, ic, label] of VIEWS) {
      const b = h('button', { class: 'rail-btn', title: label, 'aria-label': label, dataset: { view: id }, onclick: () => this.show(id) }, icon(ic, 20), h('span', { class: 'rail-label' }, label), h('span', { class: 'rail-badge' }));
      this.rail.appendChild(b);
    }
    this.rail.appendChild(h('div', { class: 'rail-spacer' }));
    if (hooks.openSettings) {
      this.rail.appendChild(h('button', { class: 'rail-btn', title: 'Ajustes', 'aria-label': 'Ajustes', onclick: () => hooks.openSettings() }, icon('settings', 20), h('span', { class: 'rail-label' }, 'Ajustes')));
    }
    api.on('settings:changed', () => {
      aiStatus(true).then(() => this.render());
    });
  }

  freshState() {
    return {
      verify: new Map(), // key → resultado
      summary: null,
      summaryBusy: false,
      chat: [],
      chatBusy: false,
      studyData: null,
      studyBusy: false,
      studyTab: 'cards',
      cardIndex: 0,
      cardFlipped: false,
      quizAnswers: {},
      vision: [],
      visionBusy: 0,
      fine: null,
      fineBusy: false,
      memoryLinks: null,
      selectedDates: new Set(),
      showRefDates: false,
      urlLimit: AUTO_URLS,
    };
  }

  /** Conecta un documento nuevo. */
  setDocument(doc, findings, world) {
    this.unlinkAll();
    this.doc = doc;
    this.findings = findings;
    this.world = world;
    this.state = this.freshState();
    this.updateBadges();
    this.render();
    this.verifySources();
    this.computeMemory();
  }

  show(view) {
    this.view = view;
    this.unlinkAll();
    this.render();
    this.body.scrollTop = 0;
  }

  updateBadges() {
    const f = this.findings;
    const set = (view, n, kind = '') => {
      const b = this.rail.querySelector(`[data-view="${view}"] .rail-badge`);
      if (!b) return;
      b.textContent = n ? String(n > 99 ? '99+' : n) : '';
      b.className = `rail-badge ${kind}`;
    };
    if (!f) return;
    const bad = [...this.state.verify.values()].filter((v) => v.status === 'bad').length;
    set('sources', bad || f.sources.length, bad ? 'bad' : '');
    set('dates', f.dates.filter((d) => d.category !== 'referencia').length);
    set('context', f.acronyms.length + (this.state.memoryLinks?.length || 0));
    set('vision', this.state.vision.length);
  }

  // ------------------------------------------------------------ utilidades de vista

  unlinkAll() {
    for (const off of this.links) off();
    this.links = [];
  }

  /** Chip "¶N" que, al pasar el mouse, tiende un hilo hasta el párrafo. */
  paraChip(id, color = COLORS.cyan) {
    const chip = h('button', { class: 'para-chip', title: `Ir al párrafo ${id}` }, `¶${id}`);
    let off = null;
    const center = () => {
      const r = chip.getBoundingClientRect();
      const host = this.world?.host.getBoundingClientRect();
      return { x: r.left - (host?.left || 0), y: r.top + r.height / 2 - (host?.top || 0) };
    };
    chip.addEventListener('mouseenter', () => {
      if (!this.world || !this.doc) return;
      off = this.world.link(center, () => this.doc.blockRects(id), color);
      this.links.push(off);
    });
    chip.addEventListener('mouseleave', () => {
      if (off) off();
      off = null;
    });
    chip.addEventListener('click', () => {
      const rects = this.doc?.blockRects(id);
      if (!rects?.length) return;
      this.doc.scrollToRects(rects);
      if (this.world) {
        const stop = this.world.summon(rects, color);
        setTimeout(stop, 2600);
      }
    });
    return chip;
  }

  chips(ids, color) {
    return ids?.length ? h('span', { class: 'chips' }, ids.slice(0, 6).map((id) => this.paraChip(id, color))) : null;
  }

  /** Hilo y pulso hacia un tramo de texto mientras el mouse está encima de un elemento del panel. */
  hoverLink(el, getRects, color) {
    let off = null;
    el.addEventListener('mouseenter', () => {
      if (!this.world) return;
      const rects = getRects();
      if (!rects?.length) return;
      off = this.world.link(() => {
        const r = el.getBoundingClientRect();
        const host = this.world.host.getBoundingClientRect();
        return { x: r.left - host.left, y: r.top + 18 - host.top };
      }, getRects, color);
      this.links.push(off);
    });
    el.addEventListener('mouseleave', () => {
      if (off) off();
      off = null;
    });
  }

  goTo(rects, color) {
    if (!rects?.length || !this.doc) return;
    this.doc.scrollToRects(rects);
    if (this.world) setTimeout(this.world.summon(rects, color), 2600);
  }

  async copy(text, html, message = 'Copiado') {
    await api.clipboard.write({ text, html });
    toast(message, 'ok');
  }

  setHead(title, sub = '', actions = []) {
    clear(this.head, h('div', { class: 'pane-title' }, h('h2', {}, title), sub ? h('p', { class: 'pane-sub' }, sub) : null), actions.length ? h('div', { class: 'pane-actions' }, actions) : null);
  }

  btn(label, onClick, { kind = '', iconName = null, disabled = false, title = null } = {}) {
    return h('button', { class: `btn ${kind}`, onclick: onClick, disabled, title }, iconName ? icon(iconName, 16) : null, label);
  }

  working(text) {
    return h('div', { class: 'working' }, h('div', { class: 'mini-web' }, h('span'), h('span'), h('span')), h('p', {}, text));
  }

  /** Mientras la IA trabaja, unas arañas recorren los párrafos como si los leyeran. */
  readingSpiders(blockIds, color = COLORS.violet) {
    if (!this.world || !this.doc) return () => {};
    const ids = blockIds.slice(0, 12);
    const targets = ids.map((id) => ({ id: `read-${id}-${Math.random()}`, rects: () => this.doc.blockRects(id).map((r) => ({ ...r, h: Math.min(r.h, 22) })), color, style: 'outline', mark: false }));
    this.world.deploy(targets);
    return () => {};
  }

  async aiGate(container, what) {
    const st = await aiStatus();
    if (st.available) return st;
    clear(container, this.aiSetupCard(what));
    return null;
  }

  aiSetupCard(what) {
    const keyInput = h('input', { type: 'password', class: 'input', placeholder: 'Pega aquí tu clave de Gemini (empieza con AIza…)' });
    const card = h('div', { class: 'card setup' },
      h('div', { class: 'setup-icon' }, icon('sparkles', 26)),
      h('h3', {}, `Activa la IA para ${what}`),
      h('p', { class: 'muted' }, 'Tienes dos opciones gratuitas:'),
      h('div', { class: 'option' },
        h('h4', {}, '1. En tu computadora, sin internet (Ollama)'),
        h('p', { class: 'muted small' }, 'Privado y gratis. Necesita una computadora con 8 GB de RAM o más.'),
        h('ol', { class: 'steps small' },
          h('li', {}, 'Descarga e instala Ollama desde ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.shell.open('https://ollama.com/download'); } }, 'ollama.com')),
          h('li', {}, 'Abre la Terminal y escribe: ', h('code', {}, 'ollama pull gemma3')),
          h('li', {}, 'Vuelve aquí y pulsa Comprobar.')),
        this.btn('Comprobar', async () => {
          const st = await aiStatus(true);
          if (st.available) { toast(`IA lista: ${st.label}`, 'ok'); this.render(); } else toast('Todavía no encuentro Ollama. ¿Está abierto?', 'warn');
        }, { kind: 'small' })),
      h('div', { class: 'option' },
        h('h4', {}, '2. Con tu cuenta de Google (Gemini)'),
        h('p', { class: 'muted small' }, 'Gratis con límites de uso. Consigue la clave en ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.shell.open('https://aistudio.google.com/apikey'); } }, 'aistudio.google.com/apikey'), '.'),
        h('div', { class: 'row' }, keyInput, this.btn('Guardar', async () => {
          if (!keyInput.value.trim()) return;
          await api.ai.setKey('gemini', keyInput.value.trim());
          if ((await api.settings.get()).ai.provider !== 'auto') await api.settings.set({ ai: { provider: 'gemini' } });
          const st = await aiStatus(true);
          toast(st.available ? 'Clave guardada. ¡Listo!' : 'Clave guardada.', 'ok');
          this.render();
        }, { kind: 'small primary' }))),
      this.hooks.openSettings ? h('p', { class: 'muted small' }, '¿Tienes clave de Claude u OpenAI? ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.hooks.openSettings('ai'); } }, 'Configúrala en Ajustes')) : null,
    );
    return card;
  }

  emptyDoc() {
    return h('div', { class: 'empty' }, h('p', {}, 'Abre un documento o activa las arañas sobre la pantalla para empezar.'));
  }

  // ------------------------------------------------------------ render

  render() {
    for (const b of this.rail.querySelectorAll('.rail-btn[data-view]')) b.classList.toggle('active', b.dataset.view === this.view);
    this.updateBadges();
    if (!this.doc) {
      this.setHead('Aracne');
      clear(this.body, this.emptyDoc());
      return;
    }
    const fn = {
      overview: this.renderOverview,
      summary: this.renderSummary,
      ask: this.renderAsk,
      study: this.renderStudy,
      vision: this.renderVision,
      sources: this.renderSources,
      dates: this.renderDates,
      context: this.renderContext,
      fineprint: this.renderFineprint,
    }[this.view];
    fn.call(this);
  }

  // ------------------------------------------------------------ Telaraña (resumen general)

  renderOverview() {
    const f = this.findings;
    const st = f.stats;
    const verified = [...this.state.verify.values()];
    const bad = verified.filter((v) => v.status === 'bad').length;
    this.setHead(this.doc.title || 'Documento', this.doc.kind === 'screen' ? 'Lo que hay en tu pantalla' : 'Lo que encontraron las arañas');

    const tile = (view, ic, n, label, color, extra) => h('button', { class: 'tile', style: { '--c': color }, onclick: () => this.show(view) },
      h('span', { class: 'tile-icon' }, icon(ic, 18)), h('strong', {}, String(n)), h('span', {}, label), extra ? h('em', {}, extra) : null);

    const upcoming = f.dates.filter((d) => d.category !== 'referencia' && new Date(d.date) >= startOfToday());
    const tiles = h('div', { class: 'tiles' },
      tile('sources', 'sources', f.sources.length, 'fuentes', COLORS.cyan, bad ? `${bad} con problemas` : verified.length ? 'verificando' : null),
      tile('dates', 'calendar', upcoming.length, 'plazos próximos', COLORS.magenta),
      tile('context', 'context', f.acronyms.length + f.refs.length, 'siglas y referencias', COLORS.blue),
      tile('context', 'memory', this.state.memoryLinks?.length || 0, 'conexiones', COLORS.violet, this.state.memoryLinks?.length ? 'con lo que leíste' : null),
    );

    const levelBar = h('div', { class: 'level' }, [1, 2, 3, 4, 5].map((i) => h('span', { class: i <= Math.round(st.level || 0) ? 'on' : '' })));
    const reading = h('div', { class: 'card' },
      h('div', { class: 'card-row' },
        h('div', {}, h('div', { class: 'kicker' }, 'Lectura'), h('div', { class: 'big' }, st.minutes ? `${st.minutes} min` : '—'), h('div', { class: 'muted small' }, `${st.words.toLocaleString('es')} palabras · ${st.lang === 'en' ? 'inglés' : 'español'}`)),
        h('div', { class: 'right' }, h('div', { class: 'kicker' }, 'Dificultad'), levelBar, h('div', { class: 'small' }, st.label))),
      f.hard.length ? h('div', { class: 'hard' }, h('div', { class: 'kicker' }, 'Oraciones más difíciles'),
        f.hard.map((s) => {
          const el = h('button', { class: 'hard-item', onclick: () => s.block && this.goTo(this.doc.blockRects(s.block), COLORS.amber) }, h('span', { class: 'muted small' }, `${s.words} palabras`), h('span', {}, `${s.text.slice(0, 120)}${s.text.length > 120 ? '…' : ''}`));
          if (s.block) this.hoverLink(el, () => this.doc.blockRects(s.block), COLORS.amber);
          return el;
        })) : null,
      this.mode === 'lector' && this.hooks.setFocusMode ? h('div', { class: 'row gap' },
        this.btn('Modo enfoque', (e) => { const on = e.currentTarget.classList.toggle('on'); this.hooks.setFocusMode(on); }, { kind: 'small toggle', iconName: 'focus' }),
        this.btn('', () => this.hooks.changeFontSize(-1), { kind: 'small icon-only', iconName: 'minus', title: 'Letra más pequeña' }),
        this.btn('', () => this.hooks.changeFontSize(1), { kind: 'small icon-only', iconName: 'plus', title: 'Letra más grande' })) : null,
    );

    const quick = offlineSummary(this.doc, f).slice(0, 3);
    const gist = quick.length ? h('div', { class: 'card' },
      h('div', { class: 'kicker' }, 'En pocas palabras (sin IA)'),
      h('ul', { class: 'bullets' }, quick.map((s) => h('li', {}, s.text, ' ', this.paraChip(s.block, COLORS.white)))),
      this.btn('Resumen completo con IA', () => this.show('summary'), { kind: 'small primary', iconName: 'sparkles' })) : null;

    const keyw = f.keywords.slice(0, 14);
    const keys = keyw.length ? h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Conceptos que más se repiten'), h('div', { class: 'tags' }, keyw.map(([, , d]) => h('span', { class: 'tag' }, d)))) : null;

    clear(this.body, tiles, reading, gist, keys);
  }

  // ------------------------------------------------------------ Resumen

  async renderSummary() {
    const s = this.state;
    const actions = [];
    if (s.summary) actions.push(this.btn('', () => this.copySummary(), { kind: 'small icon-only', iconName: 'copy', title: 'Copiar resumen' }));
    this.setHead('Resumen', 'Cada idea señala de qué párrafo sale', actions);
    const box = h('div');
    clear(this.body, box);

    const offline = offlineSummary(this.doc, this.findings);
    const offlineCard = offline.length ? h('div', { class: 'card subtle' },
      h('div', { class: 'kicker' }, 'Resumen rápido (sin IA)'),
      h('ul', { class: 'bullets' }, offline.map((x) => h('li', {}, x.text, ' ', this.paraChip(x.block, COLORS.white))))) : null;

    if (s.summaryBusy) {
      clear(box, this.working('Las arañas están leyendo el documento y tejiendo el resumen…'), offlineCard);
      return;
    }
    if (s.summary) {
      clear(box, this.summaryView(s.summary));
      return;
    }
    const st = await aiStatus();
    if (!st.available) {
      clear(box, offlineCard, this.aiSetupCard('hacer resúmenes completos'));
      return;
    }
    clear(box,
      h('div', { class: 'card cta' },
        h('p', {}, 'La IA resume el documento con ideas clave, secciones, glosario y preguntas de repaso. Cada punto tiene un enlace al párrafo original para que puedas comprobarlo.'),
        this.btn('Resumir con IA', () => this.runSummary(), { kind: 'primary', iconName: 'sparkles' }),
        h('p', { class: 'muted small' }, `Usando ${st.label}${st.model ? ` · ${st.model}` : ''}`)),
      offlineCard);
  }

  async runSummary() {
    const s = this.state;
    s.summaryBusy = true;
    this.render();
    const ids = this.doc.blocks.filter((b) => b.type !== 'heading').map((b) => b.id);
    this.readingSpiders(ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 10)) === 0));
    try {
      s.summary = await summarize(this.doc, this.findings);
    } catch (err) {
      toast(`No se pudo resumir: ${cleanError(err)}`, 'error', 6000);
    } finally {
      s.summaryBusy = false;
      if (this.view === 'summary') this.render();
    }
  }

  summaryView(sum) {
    const c = COLORS.white;
    return h('div', { class: 'summary' },
      sum.tldr ? h('div', { class: 'card tldr' }, h('div', { class: 'kicker' }, 'En resumen'), h('p', { class: 'lead' }, sum.tldr)) : null,
      sum.puntos.length ? h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Ideas clave'),
        h('ol', { class: 'points' }, sum.puntos.map((p) => {
          const li = h('li', {}, h('span', {}, p.texto), this.chips(p.parrafos, c));
          if (p.parrafos[0]) this.hoverLink(li, () => p.parrafos.flatMap((id) => this.doc.blockRects(id)), COLORS.cyan);
          return li;
        }))) : null,
      sum.secciones.length ? h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Por secciones'),
        sum.secciones.map((sec) => h('details', { class: 'section', open: sum.secciones.length <= 3 },
          h('summary', {}, sec.titulo || 'Sección'), h('p', {}, sec.resumen), this.chips(sec.parrafos, c)))) : null,
      sum.glosario.length ? h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Glosario'),
        h('dl', { class: 'glossary' }, sum.glosario.map((g) => [h('dt', {}, g.termino, g.parrafo ? this.paraChip(g.parrafo, COLORS.blue) : null), h('dd', {}, g.definicion)]))) : null,
      sum.preguntas.length ? h('div', { class: 'card' }, h('div', { class: 'kicker' }, 'Preguntas de repaso'),
        h('ul', { class: 'bullets q' }, sum.preguntas.map((q) => h('li', {}, h('button', { class: 'link', onclick: () => { this.show('ask'); this.sendQuestion(q); } }, q))))) : null,
      h('div', { class: 'row gap' },
        this.btn('Copiar', () => this.copySummary(), { kind: 'small', iconName: 'copy' }),
        this.btn('Guardar .md', () => this.saveSummary(), { kind: 'small', iconName: 'download' }),
        this.btn('Rehacer', () => this.runSummary(), { kind: 'small ghost' })),
    );
  }

  summaryMarkdown() {
    const s = this.state.summary;
    const lines = [`# Resumen: ${this.doc.title || 'documento'}`, ''];
    if (s.tldr) lines.push(s.tldr, '');
    if (s.puntos.length) lines.push('## Ideas clave', ...s.puntos.map((p) => `- ${p.texto}${p.parrafos.length ? ` (¶${p.parrafos.join(', ¶')})` : ''}`), '');
    for (const sec of s.secciones) lines.push(`## ${sec.titulo}`, sec.resumen, '');
    if (s.glosario.length) lines.push('## Glosario', ...s.glosario.map((g) => `- **${g.termino}**: ${g.definicion}`), '');
    if (s.preguntas.length) lines.push('## Preguntas de repaso', ...s.preguntas.map((q) => `- ${q}`), '');
    if (this.doc.source) lines.push(`Fuente: ${this.doc.source}`);
    return lines.join('\n');
  }

  copySummary() {
    if (this.state.summary) this.copy(this.summaryMarkdown(), null, 'Resumen copiado');
  }

  async saveSummary() {
    const p = await api.files.save({ defaultName: `Resumen - ${(this.doc.title || 'documento').slice(0, 60).replace(/[\\/:*?"<>|]/g, '')}.md`, data: this.summaryMarkdown(), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (p) toast('Resumen guardado', 'ok');
  }

  // ------------------------------------------------------------ Preguntar

  async renderAsk() {
    this.setHead('Pregúntale al documento', this.doc.kind === 'screen' ? 'Sobre lo que tienes en pantalla' : 'Las respuestas citan los párrafos');
    const box = h('div', { class: 'chat' });
    clear(this.body, box);
    const st = await this.aiGate(box, 'responder preguntas');
    if (!st) return;
    const log = h('div', { class: 'chat-log' });
    const s = this.state;
    if (!s.chat.length) {
      const sugg = [
        '¿Cuál es la idea principal?',
        'Explícamelo como si tuviera 15 años',
        '¿Qué conceptos debo saber para un examen?',
        '¿Qué argumentos o evidencias usa el autor?',
        ...(s.summary?.preguntas || []).slice(0, 2),
      ];
      log.appendChild(h('div', { class: 'suggest' }, h('div', { class: 'kicker' }, 'Prueba con'), sugg.map((q) => h('button', { class: 'pill', onclick: () => this.sendQuestion(q) }, q))));
    }
    for (const m of s.chat) {
      log.appendChild(h('div', { class: `msg ${m.role}` },
        h('div', { class: 'bubble', html: m.role === 'ai' ? richText(m.text) : escapeHtml(m.text) }),
        m.parrafos?.length ? this.chips(m.parrafos, COLORS.cyan) : null,
        m.role === 'ai' && m.enDocumento === false ? h('div', { class: 'muted small' }, 'Esto no aparece claramente en el documento.') : null));
    }
    if (s.chatBusy) log.appendChild(this.working('Buscando en el documento…'));
    const input = h('textarea', { class: 'input', rows: 2, placeholder: 'Escribe tu pregunta…' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendQuestion(input.value);
      }
    });
    const form = h('div', { class: 'chat-input' }, input, h('button', { class: 'btn primary icon-only', title: 'Enviar', onclick: () => this.sendQuestion(input.value), disabled: s.chatBusy }, icon('send', 16)));
    clear(box, log, form);
    requestAnimationFrame(() => {
      log.scrollTop = log.scrollHeight;
      if (!s.chatBusy) input.focus();
    });
  }

  async sendQuestion(q) {
    const question = String(q || '').trim();
    const s = this.state;
    if (!question || s.chatBusy) return;
    s.chat.push({ role: 'user', text: question });
    s.chatBusy = true;
    if (this.view === 'ask') this.render();
    try {
      const res = await ask(this.doc, this.findings, question, s.chat.slice(0, -1));
      s.chat.push({ role: 'ai', text: res.respuesta, parrafos: res.parrafos, enDocumento: res.enDocumento });
      if (res.parrafos.length && this.world) {
        const id = res.parrafos[0];
        const stop = this.world.summon(this.doc.blockRects(id), COLORS.cyan);
        setTimeout(stop, 3000);
      }
    } catch (err) {
      s.chat.push({ role: 'ai', text: `No pude responder: ${cleanError(err)}` });
    } finally {
      s.chatBusy = false;
      if (this.view === 'ask') this.render();
    }
  }

  // ------------------------------------------------------------ Estudiar

  async renderStudy() {
    const s = this.state;
    this.setHead('Estudiar', 'Tarjetas y preguntas tipo examen');
    const box = h('div');
    clear(this.body, box);
    const st = await this.aiGate(box, 'crear tarjetas y quizzes');
    if (!st) return;
    if (s.studyBusy) {
      clear(box, this.working('Las arañas están preparando tus tarjetas de estudio…'));
      return;
    }
    if (!s.studyData) {
      clear(box, h('div', { class: 'card cta' },
        h('p', {}, 'Crea tarjetas de memoria y un quiz de opción múltiple con este documento. Cada pregunta indica de qué párrafo sale.'),
        this.btn('Crear material de estudio', () => this.runStudy(), { kind: 'primary', iconName: 'study' })));
      return;
    }
    const tabs = h('div', { class: 'seg' },
      h('button', { class: s.studyTab === 'cards' ? 'on' : '', onclick: () => { s.studyTab = 'cards'; this.render(); } }, `Tarjetas (${s.studyData.tarjetas.length})`),
      h('button', { class: s.studyTab === 'quiz' ? 'on' : '', onclick: () => { s.studyTab = 'quiz'; this.render(); } }, `Quiz (${s.studyData.quiz.length})`));
    const content = s.studyTab === 'cards' ? this.cardsView() : this.quizView();
    clear(box, tabs, content, h('div', { class: 'row gap' },
      this.btn('Exportar a Anki (.csv)', () => this.exportAnki(), { kind: 'small', iconName: 'download' }),
      this.btn('Crear otras', () => this.runStudy(), { kind: 'small ghost' })));
  }

  async runStudy() {
    const s = this.state;
    s.studyBusy = true;
    this.render();
    try {
      s.studyData = await study(this.doc, this.findings);
      s.cardIndex = 0;
      s.cardFlipped = false;
      s.quizAnswers = {};
    } catch (err) {
      toast(`No se pudo crear el material: ${cleanError(err)}`, 'error', 6000);
    } finally {
      s.studyBusy = false;
      if (this.view === 'study') this.render();
    }
  }

  cardsView() {
    const s = this.state;
    const cards = s.studyData.tarjetas;
    if (!cards.length) return h('p', { class: 'muted' }, 'No se generaron tarjetas.');
    const c = cards[s.cardIndex];
    const card = h('div', { class: `flashcard ${s.cardFlipped ? 'flipped' : ''}`, onclick: () => { s.cardFlipped = !s.cardFlipped; card.classList.toggle('flipped'); } },
      h('div', { class: 'face front' }, h('div', { class: 'kicker' }, 'Pregunta'), h('p', {}, c.frente), h('span', { class: 'muted small' }, 'Clic para ver la respuesta')),
      h('div', { class: 'face back' }, h('div', { class: 'kicker' }, 'Respuesta'), h('p', {}, c.reverso)));
    return h('div', { class: 'cards' },
      card,
      h('div', { class: 'row between' },
        this.btn('Anterior', () => { s.cardIndex = (s.cardIndex - 1 + cards.length) % cards.length; s.cardFlipped = false; this.render(); }, { kind: 'small ghost', iconName: 'back' }),
        h('span', { class: 'muted small' }, `${s.cardIndex + 1} / ${cards.length}`, c.parrafo ? ' · ' : '', c.parrafo ? this.paraChip(c.parrafo) : null),
        this.btn('Siguiente', () => { s.cardIndex = (s.cardIndex + 1) % cards.length; s.cardFlipped = false; this.render(); }, { kind: 'small ghost' })));
  }

  quizView() {
    const s = this.state;
    const qs = s.studyData.quiz;
    const answered = Object.keys(s.quizAnswers).length;
    const correct = Object.entries(s.quizAnswers).filter(([i, a]) => qs[i]?.correcta === a).length;
    return h('div', { class: 'quiz' },
      answered ? h('div', { class: 'score' }, `${correct} de ${answered} correctas`) : null,
      qs.map((q, i) => {
        const chosen = s.quizAnswers[i];
        return h('div', { class: 'card q-card' },
          h('p', { class: 'q' }, h('strong', {}, `${i + 1}. `), q.pregunta),
          h('div', { class: 'options' }, q.opciones.map((op, j) => h('button', {
            class: `option-btn ${chosen !== undefined ? (j === q.correcta ? 'right' : j === chosen ? 'wrong' : 'dim') : ''}`,
            disabled: chosen !== undefined,
            onclick: () => { s.quizAnswers[i] = j; this.render(); },
          }, String.fromCharCode(65 + j), '. ', op))),
          chosen !== undefined ? h('div', { class: 'explain' }, h('strong', {}, chosen === q.correcta ? '¡Correcto! ' : 'No exactamente. '), q.explicacion, ' ', q.parrafo ? this.paraChip(q.parrafo) : null) : null);
      }));
  }

  async exportAnki() {
    const d = this.state.studyData;
    const esc = (t) => `"${String(t).replace(/"/g, '""')}"`;
    const rows = [
      ...d.tarjetas.map((t) => `${esc(t.frente)};${esc(t.reverso)}`),
      ...d.quiz.map((q) => `${esc(`${q.pregunta}<br>${q.opciones.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('<br>')}`)};${esc(`${String.fromCharCode(65 + q.correcta)}. ${q.opciones[q.correcta]}<br><br>${q.explicacion}`)}`),
    ];
    const p = await api.files.save({ defaultName: `Estudio - ${(this.doc.title || 'documento').slice(0, 50).replace(/[\\/:*?"<>|]/g, '')}.csv`, data: `#separator:semicolon\n#html:true\n${rows.join('\n')}\n`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (p) toast('Listo. En Anki: Archivo → Importar.', 'ok', 5000);
  }

  // ------------------------------------------------------------ Visión

  async renderVision() {
    const s = this.state;
    this.setHead('Visión', 'Analiza imágenes, gráficos, fórmulas y fotos');
    const box = h('div', { class: 'stack' });
    clear(this.body, box);
    const st = await aiStatus();
    if (!st.available) {
      const list = h('div', { class: 'vision-list' });
      if (s.visionBusy) list.appendChild(this.working('Leyendo el texto de la zona…'));
      for (const v of s.vision) list.appendChild(this.visionCard(v));
      clear(box,
        this.hooks.startLens ? h('div', { class: 'card cta' },
          h('p', {}, 'Sin IA, la lupa araña copia el texto de cualquier zona (incluso de imágenes y PDF escaneados). Con IA, además te explica gráficos, fórmulas, tablas y fotos.'),
          this.btn('Lupa araña', () => this.hooks.startLens(), { kind: 'primary', iconName: 'lens' })) : null,
        list,
        this.aiSetupCard('explicar imágenes'));
      return;
    }
    const images = this.hooks.listImages ? this.hooks.listImages() : [];
    const head = h('div', { class: 'card cta' },
      h('p', {}, this.mode === 'overlay' ? 'Arrastra un recuadro sobre cualquier parte de la pantalla: un gráfico, una fórmula, una foto o una tabla.' : 'Usa la lupa para seleccionar cualquier parte del documento, o analiza todas sus imágenes.'),
      h('div', { class: 'row gap' },
        this.hooks.startLens ? this.btn('Lupa araña', () => this.hooks.startLens(), { kind: 'primary', iconName: 'lens' }) : null,
        images.length ? this.btn(`Analizar ${images.length} imagen${images.length > 1 ? 'es' : ''}`, () => this.analyzeAllImages(images), { kind: '', iconName: 'vision' }) : null),
      !st.vision ? h('p', { class: 'warn small' }, 'Tu modelo de IA actual no ve imágenes. En Ollama instala uno con visión: ollama pull gemma3') : null);
    const list = h('div', { class: 'vision-list' });
    if (s.visionBusy) list.appendChild(this.working(`Analizando ${s.visionBusy} imagen${s.visionBusy > 1 ? 'es' : ''}…`));
    for (const v of s.vision) list.appendChild(this.visionCard(v));
    clear(box, head, list);
  }

  /** Llamado por la lupa (o por el lector al abrir una imagen). */
  async analyzeCapture({ image, thumb, rects = null, context = '' }) {
    const s = this.state;
    s.visionBusy++;
    try {
      image = await toJpeg(image);
      thumb = thumb || `data:image/jpeg;base64,${image.data}`;
    } catch (err) {
      s.visionBusy--;
      toast(`No se pudo leer la imagen: ${cleanError(err)}`, 'error');
      return;
    }
    this.show('vision');
    let stopPulse = null;
    if (rects && this.world) stopPulse = this.world.summon(rects, COLORS.green);
    try {
      const st = await aiStatus();
      if (st.available && st.vision !== false) {
        const result = await analyzeImage(image, context);
        s.vision.unshift({ ...result, thumb, rects });
      } else {
        // Sin IA con visión: al menos se lee el texto de la zona (OCR en tu computadora).
        const img = new Image();
        img.src = thumb;
        await img.decode();
        const page = await recognize(img);
        const text = (page.text || '').trim();
        s.vision.unshift({
          tipo: 'texto', titulo: text ? 'Texto de la zona' : 'Zona sin texto', descripcion: '', texto: text,
          explicacion: '', datos: [], latex: '', puntos: [], thumb, rects, offline: true,
        });
      }
    } catch (err) {
      toast(`No se pudo analizar la imagen: ${cleanError(err)}`, 'error', 6000);
    } finally {
      s.visionBusy--;
      if (stopPulse) setTimeout(stopPulse, 1200);
      if (this.view === 'vision') this.render();
      this.updateBadges();
    }
  }

  async analyzeAllImages(images) {
    await pool(images.slice(0, 12), 2, async (img) => {
      try {
        const data = await img.load();
        await this.analyzeCapture({ image: data, rects: img.rects?.(), context: img.context || '' });
      } catch (err) {
        toast(`Imagen omitida: ${cleanError(err)}`, 'warn');
      }
    });
  }

  visionCard(v) {
    const TYPES = { grafico: 'Gráfico', diagrama: 'Diagrama', formula: 'Fórmula', tabla: 'Tabla', foto: 'Foto', captura: 'Captura', texto: 'Texto', otro: 'Imagen' };
    const latexBox = v.latex ? h('div', { class: 'latex' }) : null;
    if (latexBox) {
      import('katex').then(({ default: katex }) => {
        try {
          katex.render(v.latex.replace(/^\$+|\$+$/g, ''), latexBox, { displayMode: true, throwOnError: false });
        } catch {
          latexBox.textContent = v.latex;
        }
      });
    }
    const card = h('div', { class: 'card vision' },
      h('div', { class: 'vision-top' },
        h('img', { src: v.thumb, alt: '' }),
        h('div', {}, h('span', { class: 'badge green' }, v.offline ? 'Texto (sin IA)' : TYPES[v.tipo] || 'Imagen'), h('h4', {}, v.titulo || 'Análisis'))),
      v.descripcion ? h('p', {}, v.descripcion) : null,
      v.explicacion ? h('div', {}, h('div', { class: 'kicker' }, 'Qué significa'), h('p', {}, v.explicacion)) : null,
      latexBox ? h('div', {}, h('div', { class: 'kicker' }, 'Fórmula'), latexBox, this.btn('Copiar LaTeX', () => this.copy(v.latex, null, 'LaTeX copiado'), { kind: 'small ghost', iconName: 'copy' })) : null,
      v.datos.length ? h('div', {}, h('div', { class: 'kicker' }, 'Datos'), h('table', { class: 'data' }, v.datos.map((d) => h('tr', {}, h('td', {}, d.etiqueta || ''), h('td', {}, String(d.valor ?? '')))))) : null,
      v.puntos.length ? h('ul', { class: 'bullets' }, v.puntos.map((p) => h('li', {}, p))) : null,
      v.texto ? h('details', { open: !!v.offline }, h('summary', {}, 'Texto que se lee en la imagen'), h('pre', { class: 'ocr' }, v.texto), this.btn('Copiar texto', () => this.copy(v.texto, null, 'Texto copiado'), { kind: 'small ghost', iconName: 'copy' })) : null,
    );
    if (v.rects) this.hoverLink(card, () => v.rects, COLORS.green);
    return card;
  }

  // ------------------------------------------------------------ Fuentes

  async verifySources() {
    const items = this.findings?.sources || [];
    if (!items.length) return;
    const urls = items.filter((i) => i.type === 'url');
    const ids = items.filter((i) => i.type !== 'url');
    const toCheck = [...ids.slice(0, 150), ...urls.slice(0, this.state.urlLimit)].filter((i) => !this.state.verify.has(i.key));
    const doc = this.doc;
    for (const i of toCheck) this.state.verify.set(i.key, { status: 'pending' });
    if (this.view === 'sources') this.render();
    let n = 0;
    await pool(toCheck, 4, async (item) => {
      const res = await api.sources.check({ type: item.type, id: item.id });
      if (doc !== this.doc) return;
      this.state.verify.set(item.key, res);
      item.target && (item.target.color = res.status === 'bad' ? COLORS.red : res.status === 'warn' ? COLORS.amber : COLORS.cyan);
      if (++n % 4 === 0 || n === toCheck.length) {
        this.updateBadges();
        if (this.view === 'sources' || this.view === 'overview') this.render();
      }
    });
  }

  renderSources() {
    const f = this.findings;
    const s = this.state;
    const results = f.sources.map((i) => ({ item: i, res: s.verify.get(i.key) }));
    const count = (st) => results.filter((r) => r.res?.status === st).length;
    const withMeta = results.filter((r) => r.res?.meta && r.res.status !== 'bad');
    const citeMeta = this.hooks.citeMeta ? this.hooks.citeMeta() : null;
    this.setHead('Fuentes', `${f.sources.length} encontradas · ${count('ok')} verificadas · ${count('bad')} con problemas`, [
      withMeta.length ? this.btn('APA 7', () => this.copyBibliography(withMeta.map((r) => r.res.meta)), { kind: 'small', iconName: 'copy', title: 'Copiar la bibliografía en formato APA 7' }) : null,
    ].filter(Boolean));

    if (!f.sources.length) {
      clear(this.body,
        h('div', { class: 'empty' }, h('p', {}, 'No hay DOI, ISBN, PubMed ni enlaces en este texto.')),
        citeMeta ? this.citeThisCard(citeMeta) : null);
      return;
    }
    const pendingUrls = f.sources.filter((i) => i.type === 'url' && !s.verify.has(i.key)).length;
    const order = { bad: 0, warn: 1, pending: 2, unknown: 3, ok: 4 };
    results.sort((a, b) => (order[a.res?.status || 'unknown'] ?? 3) - (order[b.res?.status || 'unknown'] ?? 3));
    const list = h('div', { class: 'list' }, results.map(({ item, res }) => this.sourceRow(item, res)));
    clear(this.body,
      h('div', { class: 'legend' },
        h('span', { class: 'dot ok' }), 'verificada', h('span', { class: 'dot warn' }), 'revisar', h('span', { class: 'dot bad' }), 'problema'),
      citeMeta ? this.citeThisCard(citeMeta) : null,
      list,
      pendingUrls ? this.btn(`Revisar ${pendingUrls} enlaces más`, () => { s.urlLimit += 200; this.verifySources(); }, { kind: 'small ghost' }) : null);
  }

  sourceRow(item, res) {
    const status = res?.status || 'unknown';
    const color = status === 'bad' ? COLORS.red : status === 'warn' ? COLORS.amber : COLORS.cyan;
    const row = h('div', { class: `src-row ${status}` },
      h('span', { class: `dot ${status}`, title: STATUS_TEXT[status] }),
      h('div', { class: 'src-main' },
        h('div', { class: 'src-top' }, h('span', { class: 'badge' }, TYPE_TEXT[item.type] || item.type), h('span', { class: 'src-id', title: item.id }, item.type === 'url' ? prettyUrl(item.id) : item.id)),
        res?.title ? h('div', { class: 'src-title' }, res.title, res.year ? ` (${res.year})` : '', res.container ? h('span', { class: 'muted' }, ` · ${res.container}`) : null) : (item.raw && item.fromLink ? h('div', { class: 'src-title muted' }, item.raw.slice(0, 120)) : null),
        res?.note ? h('div', { class: `src-note ${status}` }, res.note) : status === 'pending' ? h('div', { class: 'src-note muted' }, 'Una araña lo está revisando…') : null,
        h('div', { class: 'src-actions' },
          res?.url || item.type === 'url' ? h('button', { class: 'link', onclick: () => api.shell.open(res?.url || item.id) }, icon('open', 13), 'Abrir') : null,
          res?.archive ? h('button', { class: 'link', onclick: () => api.shell.open(res.archive.url) }, icon('open', 13), 'Copia en archive.org') : null,
          res?.meta ? h('button', { class: 'link', onclick: () => { const r = formatReference(res.meta); this.copy(r.text, r.html, 'Referencia APA copiada'); } }, icon('copy', 13), 'APA') : null)));
    this.hoverLink(row, () => (item.occurrences || []).slice(0, 3).flatMap((o) => this.doc.rectsFor(o.start, o.end)), color);
    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.goTo(this.doc.rectsFor(item.start, item.end), color);
    });
    return row;
  }

  citeThisCard(meta) {
    const ref = formatReference(meta);
    return h('div', { class: 'card subtle' },
      h('div', { class: 'kicker' }, 'Citar este documento (APA 7)'),
      h('p', { class: 'cite', html: ref.html }),
      this.btn('Copiar cita', () => this.copy(ref.text, ref.html, 'Cita copiada'), { kind: 'small', iconName: 'copy' }));
  }

  copyBibliography(metas) {
    const bib = formatBibliography(metas);
    this.copy(bib.text, bib.html, `Bibliografía APA copiada (${metas.length} referencias)`);
  }

  // ------------------------------------------------------------ Plazos

  renderDates() {
    const f = this.findings;
    const s = this.state;
    const today = startOfToday();
    const real = f.dates.filter((d) => d.category !== 'referencia');
    const refs = f.dates.filter((d) => d.category === 'referencia');
    const upcoming = real.filter((d) => new Date(d.date) >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = real.filter((d) => new Date(d.date) < today).sort((a, b) => b.date.localeCompare(a.date));
    const selected = [...s.selectedDates].map((i) => f.dates[i]).filter(Boolean);
    this.setHead('Plazos y fechas', `${upcoming.length} próximas · ${past.length} pasadas`, [
      upcoming.length || selected.length ? this.btn(selected.length ? `Exportar ${selected.length}` : 'Exportar', () => this.exportIcs(selected.length ? selected : upcoming), { kind: 'small', iconName: 'calendar', title: 'Guardar en un archivo de calendario (.ics)' }) : null,
    ].filter(Boolean));

    if (!f.dates.length) {
      clear(this.body, h('div', { class: 'empty' }, h('p', {}, 'No encontré fechas en este texto. Prueba con un sílabo, la página de un curso o un correo con entregas.')));
      return;
    }
    const group = (title, list) => (list.length ? h('div', { class: 'group' }, h('div', { class: 'kicker' }, title), list.map((d) => this.dateRow(d))) : null);
    clear(this.body,
      group('Próximas', upcoming),
      group('Ya pasaron', past),
      refs.length ? h('details', { class: 'group', open: s.showRefDates, ontoggle: (e) => { s.showRefDates = e.currentTarget.open; } },
        h('summary', { class: 'kicker' }, `En la bibliografía (${refs.length})`), refs.slice(0, 80).map((d) => this.dateRow(d))) : null,
      h('p', { class: 'muted small' }, 'Marca las que quieras y pulsa Exportar para llevarlas a tu calendario (Google Calendar, Outlook o Calendario de Apple).'));
  }

  dateRow(d) {
    const s = this.state;
    const idx = this.findings.dates.indexOf(d);
    const dt = new Date(d.date);
    const past = dt < startOfToday();
    const days = Math.round((dt - startOfToday()) / 86400000);
    const when = days === 0 ? 'hoy' : days === 1 ? 'mañana' : days > 0 && days < 31 ? `en ${days} días` : null;
    const check = h('input', { type: 'checkbox', checked: s.selectedDates.has(idx), onchange: (e) => { if (e.target.checked) s.selectedDates.add(idx); else s.selectedDates.delete(idx); this.render(); } });
    const row = h('div', { class: `date-row ${past ? 'past' : ''} cat-${d.category}` },
      h('label', { class: 'date-box' }, check, h('span', { class: 'd' }, dt.getDate()), h('span', { class: 'm' }, dt.toLocaleDateString('es', { month: 'short' }).replace('.', ''))),
      h('div', { class: 'date-main' },
        h('div', { class: 'date-title' }, d.title),
        h('div', { class: 'muted small' }, formatDate(d.date, d.hasTime), when ? h('strong', { class: 'when' }, ` · ${when}`) : null, ' · ', h('span', { class: `tag cat` }, CATEGORY_LABEL[d.category] || 'Fecha')),
        h('div', { class: 'date-sentence' }, `“${d.sentence.slice(0, 180)}${d.sentence.length > 180 ? '…' : ''}”`),
        !past && d.category !== 'referencia' ? h('div', { class: 'src-actions' },
          h('button', { class: 'link', onclick: () => api.shell.open(googleCalendarUrl(d, this.doc.source || this.doc.title)) }, icon('calendar', 13), 'Google Calendar'),
          h('button', { class: 'link', onclick: () => this.exportIcs([d]) }, icon('download', 13), '.ics')) : null));
    this.hoverLink(row, () => this.doc.rectsFor(d.start, d.end), COLORS.magenta);
    row.addEventListener('click', (e) => {
      if (e.target.closest('button, input, label')) return;
      this.goTo(this.doc.rectsFor(d.start, d.end), COLORS.magenta);
    });
    return row;
  }

  async exportIcs(items) {
    const ics = buildIcs(items, this.doc.source || this.doc.title || '');
    const p = await api.files.save({ defaultName: `Plazos - ${(this.doc.title || 'Aracne').slice(0, 50).replace(/[\\/:*?"<>|]/g, '')}.ics`, data: ics, filters: [{ name: 'Calendario', extensions: ['ics'] }] });
    if (p) toast('Archivo de calendario guardado. Ábrelo para agregar las fechas.', 'ok', 5000);
  }

  // ------------------------------------------------------------ Contexto + memoria

  async computeMemory() {
    if (!this.findings?.keywords?.length) return;
    const doc = this.doc;
    let list = [];
    try {
      list = await api.memory.list();
    } catch {
      list = [];
    }
    if (doc !== this.doc) return;
    const df = new Map();
    for (const e of list) for (const [t] of e.keywords || []) df.set(t, (df.get(t) || 0) + 1);
    const N = list.length + 1;
    const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)));
    const me = this.memoryId();
    const links = [];
    for (const e of list) {
      if (e.id === me) continue;
      const sim = similarity(e.keywords || [], this.findings.keywords, idf);
      if (sim.score < 0.12 || sim.shared.length < 2) continue;
      const display = new Map(this.findings.keywords.map(([t, , d]) => [t, d]));
      links.push({ entry: e, score: sim.score, shared: sim.shared.slice(0, 6).map((t) => display.get(t) || t) });
    }
    links.sort((a, b) => b.score - a.score);
    this.state.memoryLinks = links.slice(0, 8);
    this.updateBadges();
    if (this.view === 'context' || this.view === 'overview') this.render();
  }

  memoryId() {
    return this.doc?.memoryId || null;
  }

  renderContext() {
    const f = this.findings;
    const s = this.state;
    this.setHead('Contexto', 'Siglas, referencias internas y conexiones');
    const acr = f.acronyms.length ? h('div', { class: 'card' },
      h('div', { class: 'kicker' }, `Siglas (${f.acronyms.length})`),
      h('dl', { class: 'glossary' }, f.acronyms.map((a) => {
        const dt = h('dt', {}, a.acronym, h('span', { class: 'muted small' }, ` · ${a.uses.length} uso${a.uses.length === 1 ? '' : 's'}`));
        const dd = h('dd', {}, a.definition);
        this.hoverLink(dt, () => this.doc.rectsFor(a.start, a.end), COLORS.blue);
        dt.addEventListener('click', () => this.goTo(this.doc.rectsFor(a.start, a.end), COLORS.blue));
        return [dt, dd];
      }))) : null;

    const kinds = { fig: 'figuras', tab: 'tablas', eq: 'ecuaciones', sec: 'secciones', cite: 'citas', anchor: 'notas y enlaces internos' };
    const byKind = {};
    for (const r of f.refs) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const refs = h('div', { class: 'card' },
      h('div', { class: 'kicker' }, 'Referencias internas'),
      f.refs.length
        ? h('p', {}, `${f.refs.length} menciones conectadas: `, Object.entries(byKind).map(([k, n]) => `${n} ${kinds[k] || k}`).join(', '), '.',
          this.mode === 'lector' ? h('span', { class: 'muted' }, ' Pasa el cursor sobre “Figura 2”, “[12]” o una sigla en el texto y una araña te trae lo que menciona.') : null)
        : h('p', { class: 'muted' }, 'No hay menciones a figuras, tablas o citas numeradas.'));

    const ml = s.memoryLinks;
    const mem = h('div', { class: 'card' },
      h('div', { class: 'kicker' }, 'Conexiones con lo que ya leíste'),
      ml === null ? h('p', { class: 'muted' }, 'Buscando…')
        : ml.length ? h('div', { class: 'list' }, ml.map((l) => h('div', { class: 'mem-row' },
          h('div', { class: 'mem-title' }, l.entry.title || 'Sin título'),
          h('div', { class: 'muted small' }, `${l.entry.kind === 'web' ? prettyUrl(l.entry.source || '') : l.entry.source || ''} · leído ${formatDate(l.entry.lastRead)}`),
          h('div', { class: 'tags' }, l.shared.map((t) => h('span', { class: 'tag violet' }, t))),
          l.entry.source && /^https?:/.test(l.entry.source) ? h('button', { class: 'link', onclick: () => this.hooks.openSource ? this.hooks.openSource(l.entry.source) : api.shell.open(l.entry.source) }, icon('open', 13), 'Volver a abrir') : null)))
          : h('p', { class: 'muted' }, 'Todavía no hay conexiones. Cada documento que abras en el lector se recuerda (solo en tu computadora) y aquí verás cuándo un tema se relaciona con algo que ya leíste.'));
    clear(this.body, acr, refs, mem);
  }

  // ------------------------------------------------------------ Letra pequeña

  async renderFineprint() {
    const s = this.state;
    this.setHead('Letra pequeña', 'Trampas en términos, contratos y pagos');
    const box = h('div');
    clear(this.body, box);
    const st = await this.aiGate(box, 'buscar trampas en la letra pequeña');
    if (!st) return;
    if (s.fineBusy) {
      clear(box, this.working('Las arañas están revisando cada cláusula…'));
      return;
    }
    if (!s.fine) {
      clear(box, h('div', { class: 'card cta' },
        h('p', {}, 'Ideal para términos y condiciones, contratos de alquiler, matrículas, suscripciones o páginas de pago. Las arañas marcan las cláusulas que pueden perjudicarte y te las explican en palabras simples.'),
        this.btn('Buscar trampas', () => this.runFineprint(), { kind: 'primary', iconName: 'fineprint' }),
        h('p', { class: 'muted small' }, 'No reemplaza la opinión de un abogado.')));
      return;
    }
    const sev = { 3: ['Muy importante', 'bad'], 2: ['Cuidado', 'warn'], 1: ['Para saber', 'ok'] };
    clear(box,
      s.fine.veredicto ? h('div', { class: 'card tldr' }, h('div', { class: 'kicker' }, 'Veredicto'), h('p', { class: 'lead' }, s.fine.veredicto)) : null,
      s.fine.hallazgos.length ? h('div', { class: 'list' }, s.fine.hallazgos.map((x) => {
        const row = h('div', { class: `card fine sev-${x.gravedad}` },
          h('div', { class: 'row between' }, h('strong', {}, x.tipo), h('span', { class: `badge ${sev[x.gravedad][1]}` }, sev[x.gravedad][0])),
          x.cita ? h('blockquote', {}, `“${x.cita}”`) : null,
          h('p', {}, x.explicacion),
          x.parrafo ? this.paraChip(x.parrafo, COLORS.amber) : null);
        if (x.loc) {
          this.hoverLink(row, () => this.doc.rectsFor(x.loc.start, x.loc.end), x.gravedad === 3 ? COLORS.red : COLORS.amber);
          row.addEventListener('click', (e) => { if (!e.target.closest('button')) this.goTo(this.doc.rectsFor(x.loc.start, x.loc.end), COLORS.amber); });
        }
        return row;
      })) : h('div', { class: 'empty' }, h('p', {}, 'No encontré cláusulas preocupantes.')),
      this.btn('Revisar de nuevo', () => this.runFineprint(), { kind: 'small ghost' }));
  }

  async runFineprint() {
    const s = this.state;
    s.fineBusy = true;
    this.render();
    this.readingSpiders(this.doc.blocks.map((b) => b.id).filter((_, i) => i % 3 === 0), COLORS.amber);
    try {
      const res = await fineprint(this.doc, this.findings);
      for (const x of res.hallazgos) x.loc = locateQuote(this.doc, x.cita, x.parrafo);
      s.fine = res;
      if (this.world) {
        const targets = res.hallazgos.filter((x) => x.loc).map((x, i) => ({
          id: `fine-${i}-${Date.now()}`,
          rects: () => this.doc.rectsFor(x.loc.start, x.loc.end),
          color: x.gravedad === 3 ? COLORS.red : COLORS.amber,
          label: x.tipo.toUpperCase(),
          style: 'fill',
        }));
        this.world.deploy(targets, { autoScroll: false });
      }
    } catch (err) {
      toast(`No se pudo revisar: ${cleanError(err)}`, 'error', 6000);
    } finally {
      s.fineBusy = false;
      if (this.view === 'fineprint') this.render();
    }
  }
}

// ------------------------------------------------------------ auxiliares

/** Cualquier imagen (SVG, WebP, GIF, PNG…) → JPEG de 1600 px como máximo, que todas las IA aceptan. */
async function toJpeg(image) {
  if (image.mime === 'image/jpeg' && image.data && !image.data.includes('%')) return image;
  const isB64 = /^[A-Za-z0-9+/=\s]+$/.test(image.data.slice(0, 200));
  const src = isB64 ? `data:${image.mime};base64,${image.data}` : `data:${image.mime},${image.data}`;
  const img = new Image();
  img.decoding = 'async';
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('formato de imagen no compatible'));
    img.src = src;
  });
  const w = img.naturalWidth || 800, hgt = img.naturalHeight || 600;
  const k = Math.min(1, 1600 / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(hgt * k));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.9).split(',')[1] };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function prettyUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname.length > 32 ? `${x.pathname.slice(0, 30)}…` : x.pathname;
    return `${x.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return u;
  }
}

/** Texto de la IA con viñetas y **negritas** simples, sin HTML externo. */
function richText(text) {
  const lines = escapeHtml(text).split(/\n/);
  let html = '';
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-•*]\s+(.*)/);
    if (m) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${m[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p>${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
