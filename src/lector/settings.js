// Ventanas de Ajustes, Bienvenida y Permiso de pantalla.
import { api } from '../core/bridge.js';
import { h, clear, icon, toast, keyTokens, cleanError } from '../core/ui.js';
import { aiStatus } from '../ai/tasks.js';

const isMac = api.platform === 'darwin';

function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => {
    overlay.classList.remove('on');
    setTimeout(() => overlay.remove(), 200);
    window.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const overlay = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}` },
      h('header', {}, h('h2', {}, title), h('button', { class: 'tb-btn', title: 'Cerrar', onclick: close }, icon('close', 18))),
      h('div', { class: 'modal-body' }, body)));
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('on'));
  window.addEventListener('keydown', onKey);
  return close;
}

// ---------------------------------------------------------------- atajo

function accelFromEvent(e) {
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('CommandOrControl');
  if (isMac && e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const k = e.key;
  if (['Shift', 'Control', 'Alt', 'Meta', 'OS'].includes(k)) return null;
  let key;
  if (k === ' ' || e.code === 'Space') key = 'Space';
  else if (/^F\d{1,2}$/.test(k)) key = k;
  else if (e.code.startsWith('Key')) key = e.code.slice(3);
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (['Period', 'Comma', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Minus', 'Equal', 'Backquote'].includes(e.code)) {
    key = { Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' }[e.code];
  } else return null;
  if (parts.length === 0 || (parts.length === 1 && parts[0] === 'Shift')) return null; // necesita un modificador
  return [...parts, key].join('+');
}

// ---------------------------------------------------------------- ajustes

export async function openSettings(section = null) {
  const s = await api.settings.get();
  const info = await api.info();
  const body = h('div', { class: 'settings' });
  const close = modal('Ajustes', body, { wide: true });
  void close;

  // Atajo
  const scLabel = h('span', { class: 'kbd-line' }, info.shortcutLabel);
  let recording = false;
  const recBtn = h('button', { class: 'btn small' }, 'Cambiar');
  const onRec = async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      stopRec();
      return;
    }
    const accel = accelFromEvent(e);
    if (!accel) return;
    stopRec();
    const res = await api.settings.set({ shortcut: accel });
    if (res.shortcut.ok) {
      scLabel.textContent = res.shortcutLabel;
      toast(`Nuevo atajo: ${res.shortcutLabel}`, 'ok');
    } else toast(res.shortcut.error, 'error', 5000);
  };
  const stopRec = () => {
    recording = false;
    recBtn.textContent = 'Cambiar';
    recBtn.classList.remove('recording');
    window.removeEventListener('keydown', onRec, true);
  };
  recBtn.onclick = () => {
    recording = true;
    recBtn.textContent = 'Pulsa la nueva combinación…';
    recBtn.classList.add('recording');
    window.addEventListener('keydown', onRec, true);
  };

  const shortcutSec = h('section', {},
    h('h3', {}, 'Atajo para activar las arañas'),
    h('div', { class: 'row between' }, scLabel, h('div', { class: 'row gap' }, recBtn,
      h('button', { class: 'btn small ghost', onclick: async () => { const r = await api.settings.set({ shortcut: 'CommandOrControl+Shift+Space' }); scLabel.textContent = r.shortcutLabel; } }, 'Restablecer'))),
    h('p', { class: 'muted small' }, 'Funciona en cualquier aplicación. Pulsa la misma combinación o Esc para salir.'));

  // Animación
  const seg = (name, value, options, onChange) => h('div', { class: 'seg' }, options.map(([v, label]) => h('button', {
    class: v === value ? 'on' : '',
    onclick: (e) => {
      e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      onChange(v);
    },
  }, label)));
  const toggle = (label, value, onChange) => {
    const input = h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) });
    return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }), label);
  };
  const animSec = h('section', {},
    h('h3', {}, 'Animación de las arañas'),
    seg('animation', s.animation, [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja'], ['apagada', 'Sin arañas']], (v) => api.settings.set({ animation: v })),
    h('p', { class: 'muted small' }, 'Alta: cada palabra que leen se enciende y se decodifica. Media: solo la recuadran. Baja: tres arañas y una línea de lectura.'),
    toggle('Lectura continua: las arañas siguen leyendo, renglón por renglón, lo que tienes en pantalla', s.patrol !== false, (v) => api.settings.set({ patrol: v })),
    h('h3', {}, 'Colores al activar sobre la pantalla'),
    seg('invert', s.invertScreen, [['auto', 'Automático'], ['siempre', 'Invertir siempre'], ['nunca', 'No invertir']], (v) => api.settings.set({ invertScreen: v })),
    h('p', { class: 'muted small' }, 'Automático invierte las páginas claras para que se vean oscuras, como un rastreador.'));

  // IA
  const aiSec = h('section', { id: 'ai' }, h('h3', {}, 'Inteligencia artificial'));
  const aiBody = h('div');
  aiSec.appendChild(aiBody);
  const renderAi = async () => {
    const cur = await api.settings.get();
    const st = await aiStatus(true);
    const provider = cur.ai.provider;
    const providerSeg = seg('provider', provider, [['auto', 'Automático'], ['ollama', 'Ollama'], ['gemini', 'Gemini'], ['anthropic', 'Claude'], ['openai', 'OpenAI / otros']], async (v) => {
      await api.settings.set({ ai: { provider: v } });
      renderAi();
    });
    const status = h('div', { class: `ai-status ${st.available ? 'ok' : 'off'}` },
      h('span', { class: 'dot' }), st.available ? `Activa: ${st.label}${st.model ? ` · ${st.model}` : ''}${st.vision ? ' · ve imágenes' : ''}` : 'Sin IA configurada (las arañas sin IA siguen funcionando).');

    const keyRow = (prov, placeholder, link, linkText) => {
      const input = h('input', { class: 'input', type: 'password', placeholder: cur.keys?.[prov] ? '•••••••• (guardada)' : placeholder });
      return h('div', { class: 'field' },
        h('div', { class: 'row gap' }, input,
          h('button', { class: 'btn small primary', onclick: async () => { await api.ai.setKey(prov, input.value); input.value = ''; toast('Clave guardada', 'ok'); renderAi(); } }, 'Guardar'),
          cur.keys?.[prov] ? h('button', { class: 'btn small ghost', onclick: async () => { await api.ai.setKey(prov, ''); renderAi(); } }, 'Borrar') : null),
        h('p', { class: 'muted small' }, 'Consíguela en ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.shell.open(link); } }, linkText), '. Se guarda cifrada en tu computadora.'));
    };

    const modelPicker = (prov) => {
      const sel = h('select', { class: 'input' }, h('option', { value: '' }, 'Elegir automáticamente'));
      const load = h('button', { class: 'btn small ghost', onclick: async () => {
        load.textContent = 'Cargando…';
        try {
          const list = await api.ai.models(prov);
          clear(sel, h('option', { value: '' }, 'Elegir automáticamente'), list.map((m) => h('option', { value: m.id, selected: cur.ai.models?.[prov] === m.id }, `${m.name}${m.vision ? ' · visión' : ''}`)));
          load.textContent = `${list.length} modelos`;
        } catch (err) {
          load.textContent = 'Reintentar';
          toast(cleanError(err), 'error', 5000);
        }
      } }, 'Ver modelos');
      sel.onchange = () => api.settings.set({ ai: { models: { [prov]: sel.value } } }).then(() => aiStatus(true));
      if (cur.ai.models?.[prov]) sel.appendChild(h('option', { value: cur.ai.models[prov], selected: true }, cur.ai.models[prov]));
      return h('div', { class: 'field' }, h('label', {}, 'Modelo'), h('div', { class: 'row gap' }, sel, load));
    };

    const blocks = [];
    if (provider === 'auto' || provider === 'ollama') {
      const host = h('input', { class: 'input', value: cur.ai.ollamaHost });
      host.onchange = () => api.settings.set({ ai: { ollamaHost: host.value } });
      blocks.push(h('div', { class: 'provider' },
        h('h4', {}, 'Ollama — gratis, en tu computadora'),
        h('p', { class: 'muted small' }, 'Instálalo desde ollama.com y descarga un modelo. Recomendado: ', h('code', {}, 'ollama pull gemma3'), ' (lee texto e imágenes).'),
        provider === 'ollama' ? h('div', { class: 'field' }, h('label', {}, 'Dirección'), host) : null,
        provider === 'ollama' ? modelPicker('ollama') : null));
    }
    if (provider === 'auto' || provider === 'gemini') {
      blocks.push(h('div', { class: 'provider' }, h('h4', {}, 'Google Gemini — gratis con límites'), keyRow('gemini', 'Clave de API de Gemini', 'https://aistudio.google.com/apikey', 'aistudio.google.com/apikey'), provider === 'gemini' && cur.keys?.gemini ? modelPicker('gemini') : null));
    }
    if (provider === 'anthropic') {
      blocks.push(h('div', { class: 'provider' }, h('h4', {}, 'Claude (Anthropic)'), keyRow('anthropic', 'Clave de API de Anthropic', 'https://console.anthropic.com/', 'console.anthropic.com'), cur.keys?.anthropic ? modelPicker('anthropic') : null));
    }
    if (provider === 'openai') {
      const base = h('input', { class: 'input', value: cur.ai.openaiBase });
      base.onchange = () => api.settings.set({ ai: { openaiBase: base.value } });
      blocks.push(h('div', { class: 'provider' }, h('h4', {}, 'OpenAI o compatible (Groq, OpenRouter, LM Studio…)'),
        h('div', { class: 'field' }, h('label', {}, 'Dirección de la API'), base),
        keyRow('openai', 'Clave de API', 'https://platform.openai.com/api-keys', 'platform.openai.com'), cur.keys?.openai ? modelPicker('openai') : null));
    }
    const test = h('button', { class: 'btn small', onclick: async () => {
      test.textContent = 'Probando…';
      try {
        const r = await api.ai.complete({ system: 'Responde en una sola frase corta.', prompt: 'Saluda a un estudiante en español.', maxTokens: 60 });
        toast(`IA funcionando (${r.model}): ${r.text.slice(0, 80)}`, 'ok', 5000);
      } catch (err) {
        toast(`La IA no respondió: ${cleanError(err)}`, 'error', 6000);
      } finally {
        test.textContent = 'Probar la IA';
      }
    } }, 'Probar la IA');
    clear(aiBody, providerSeg, status, blocks, h('div', { class: 'row gap' }, test));
  };
  renderAi();

  // Memoria e inicio
  const otherSec = h('section', {},
    h('h3', {}, 'Memoria y privacidad'),
    toggle('Recordar lo que leo para encontrar conexiones (se guarda solo en esta computadora)', s.rememberReading, (v) => api.settings.set({ rememberReading: v })),
    h('div', { class: 'row gap' }, h('button', { class: 'btn small ghost', onclick: async () => { await api.memory.clear(); toast('Memoria borrada', 'ok'); } }, icon('trash', 14), 'Borrar la memoria de lecturas')),
    h('h3', {}, 'Inicio'),
    toggle('Abrir Aracne al iniciar sesión (queda lista en la barra de menú)', s.openAtLogin, (v) => api.settings.set({ openAtLogin: v })),
    h('h3', {}, 'Acerca de'),
    h('p', { class: 'muted small' }, `Aracne ${info.version} · Código abierto (licencia MIT) · `, h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.shell.open('https://github.com/hebexort771/Aracne'); } }, 'github.com/hebexort771/Aracne')));

  clear(body, shortcutSec, aiSec, animSec, otherSec);
  if (section === 'ai') requestAnimationFrame(() => aiSec.scrollIntoView({ block: 'start' }));
}

// ---------------------------------------------------------------- bienvenida

export async function openWelcome() {
  const info = await api.info();
  const body = h('div', { class: 'welcome' },
    h('img', { class: 'welcome-logo', src: 'icon.svg', alt: '' }),
    h('p', { class: 'lead' }, 'Aracne suelta arañas digitales sobre lo que lees para ayudarte a entenderlo y comprobarlo.'),
    h('div', { class: 'welcome-grid' },
      feature('sources', 'Verifica fuentes', 'Revisa DOI, ISBN y enlaces; detecta artículos retractados y arma tu bibliografía APA 7.'),
      feature('calendar', 'Encuentra plazos', 'Saca exámenes, entregas y pagos de sílabos y correos, y los manda a tu calendario.'),
      feature('summary', 'Resume y explica', 'Resúmenes con el párrafo de origen de cada idea, glosario y preguntas al documento.'),
      feature('vision', 'Mira imágenes', 'Explica gráficos, fórmulas, tablas y fotos con la lupa araña.'),
      feature('study', 'Te ayuda a estudiar', 'Tarjetas de memoria y quizzes tipo examen, exportables a Anki.'),
      feature('fineprint', 'Lee la letra pequeña', 'Marca las trampas de contratos, términos y pagos.')),
    h('div', { class: 'shortcut-card' },
      h('div', { class: 'keys' }, keyTokens(info.shortcut).map((k) => h('kbd', {}, k))),
      h('div', {}, h('strong', {}, 'Tu atajo para cualquier aplicación'), h('p', { class: 'muted' }, 'Ábrelo sobre una página web, un PDF o lo que estés leyendo. Pulsa de nuevo o Esc para salir.'))),
    h('div', { class: 'row gap center' },
      h('button', { class: 'btn primary big', onclick: () => { close(); api.overlay.activate(); } }, 'Probar el atajo ahora'),
      h('button', { class: 'btn big ghost', onclick: () => close() }, 'Empezar')));
  const close = modal('Bienvenido a Aracne', body, { wide: true, onClose: () => api.settings.set({ firstRun: false }) });
}

function feature(ic, title, text) {
  return h('div', { class: 'feature' }, icon(ic, 22), h('strong', {}, title), h('p', { class: 'muted small' }, text));
}

// ---------------------------------------------------------------- permiso de pantalla (macOS)

export function openPermission() {
  const body = h('div', { class: 'permission' },
    h('p', {}, 'Para que las arañas puedan leer lo que hay en tu pantalla, macOS pide un permiso una sola vez.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Pulsa ', h('strong', {}, 'Abrir Ajustes del Sistema'), '.'),
      h('li', {}, 'En ', h('strong', {}, 'Grabación de pantalla y audio del sistema'), ', activa ', h('strong', {}, 'Aracne'), '.'),
      h('li', {}, 'Vuelve aquí y pulsa ', h('strong', {}, 'Reiniciar Aracne'), '.')),
    h('p', { class: 'muted small' }, 'La captura se usa solo en tu computadora para leer el texto con OCR. No se guarda ni se envía a ningún lado (salvo que tú pidas analizarla con una IA en la nube).'),
    h('div', { class: 'row gap' },
      h('button', { class: 'btn primary', onclick: () => api.perms.openScreenSettings() }, 'Abrir Ajustes del Sistema'),
      h('button', { class: 'btn', onclick: () => api.perms.relaunch() }, 'Reiniciar Aracne')));
  modal('Permiso de grabación de pantalla', body);
}
