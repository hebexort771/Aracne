// Acceso al proceso principal. Fuera de Electron (pruebas en navegador) usa un simulador.

function mockApi() {
  let settings = {
    shortcut: 'CommandOrControl+Shift+Space',
    animation: 'alta',
    invertScreen: 'auto',
    rememberReading: true,
    openAtLogin: false,
    firstRun: false,
    ai: { provider: 'auto', models: {}, ollamaHost: 'http://127.0.0.1:11434', openaiBase: 'https://api.openai.com/v1' },
    keys: {},
  };
  const listeners = {};
  const memory = [];
  const mockAi = typeof window !== 'undefined' && window.__ARACNE_MOCK_AI__;
  return {
    platform: 'darwin',
    mock: true,
    info: async () => ({ version: '1.0.0', platform: 'darwin', shortcut: settings.shortcut, shortcutLabel: '⌘⇧Espacio', shortcutOk: true, screenPermission: 'granted' }),
    settings: {
      get: async () => settings,
      set: async (patch) => {
        settings = { ...settings, ...patch };
        return { settings, shortcut: { ok: true }, shortcutLabel: '⌘⇧Espacio' };
      },
    },
    ai: {
      status: async () => (mockAi ? { available: true, provider: 'mock', label: 'Simulada', model: 'demo', vision: true, contextChars: 60000 } : { available: false }),
      models: async () => [],
      setKey: async () => settings,
      complete: async (req) => {
        if (!mockAi) throw new Error('Sin IA');
        return { text: await mockAi(req), provider: 'mock', model: 'demo' };
      },
    },
    sources: {
      check: async (item) => {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 900));
        const roll = Math.random();
        if (item.type === 'url') return { ...item, url: item.id, status: roll < 0.75 ? 'ok' : 'bad', note: roll < 0.75 ? 'El enlace funciona.' : 'Enlace roto (responde 404). Hay una copia guardada en archive.org.', archive: roll < 0.75 ? null : { url: 'https://web.archive.org/' } };
        if (item.type === 'isbn') return { ...item, status: 'ok', note: 'Libro encontrado en Open Library.', title: 'Spiders of North America', year: 2005, container: 'American Arachnological Society', meta: { type: 'book', authors: [{ name: 'Darrell Ubick' }], year: 2005, title: 'Spiders of North America', publisher: 'American Arachnological Society' } };
        return { ...item, status: roll < 0.12 ? 'bad' : 'ok', retracted: roll < 0.12, note: roll < 0.12 ? 'Artículo RETRACTADO: la revista lo retiró. No lo uses como fuente.' : 'El DOI existe y apunta a esta publicación.', title: 'A golden orb-weaver spider from the Middle Jurassic of China', year: 2011, container: 'Biology Letters', meta: { type: 'article', authors: [{ family: 'Selden', given: 'Paul A.' }, { family: 'Shih', given: 'ChungKun' }], year: 2011, title: 'A golden orb-weaver spider from the Middle Jurassic of China', container: 'Biology Letters', volume: '7', issue: '5', pages: '775-778', doi: item.id } };
      },
    },
    web: {
      load: async () => { throw new Error('Simulador: no hay red'); },
      image: async () => { throw new Error('Simulador'); },
    },
    files: { open: async () => null, read: async () => null, pending: async () => [], save: async () => null, pathFor: () => '' },
    clipboard: { write: async ({ text }) => navigator.clipboard?.writeText(text).catch(() => {}) },
    shell: { open: async (u) => window.open(u, '_blank'), reveal: async () => {} },
    capture: { rect: async () => ({ mime: 'image/png', data: '' }) },
    memory: {
      list: async () => memory,
      add: async (e) => { memory.unshift(e); return memory; },
      remove: async () => memory,
      clear: async () => [],
    },
    overlay: { ready: () => {}, hide: async () => {}, openLector: async () => {}, activate: async () => {} },
    perms: { openScreenSettings: async () => {}, relaunch: async () => {} },
    on(channel, cb) {
      (listeners[channel] ||= []).push(cb);
      return () => {};
    },
    emit(channel, payload) {
      for (const cb of listeners[channel] || []) cb(payload);
    },
  };
}

export const api = typeof window !== 'undefined' && window.aracne ? window.aracne : mockApi();
if (typeof window !== 'undefined' && !window.aracne) window.__aracneMock = api;
