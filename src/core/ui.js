// Pequeñas utilidades de interfaz (sin frameworks).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = ICONS[name] ? ICONS[name].replace('<svg ', `<svg width="${size}" height="${size}" `) : '';
  return span;
}

const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  web: `<svg ${S}><circle cx="12" cy="12" r="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M19.1 4.9l-4.2 4.2M9.1 14.9l-4.2 4.2"/><path d="M12 6.5l3.9 1.6 1.6 3.9-1.6 3.9-3.9 1.6-3.9-1.6L6.5 12l1.6-3.9z"/></svg>`,
  sources: `<svg ${S}><path d="M9 15l6-6"/><path d="M11 6l1.6-1.6a4 4 0 0 1 5.7 5.7L16.7 11.7"/><path d="M13 18l-1.6 1.6a4 4 0 0 1-5.7-5.7L7.3 12.3"/></svg>`,
  calendar: `<svg ${S}><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.4"/></svg>`,
  context: `<svg ${S}><path d="M4 6h10M4 10h7M4 14h10M4 18h6"/><path d="M16 13l4 4-4 4"/><path d="M14 9.5a3 3 0 1 1 3 3"/></svg>`,
  memory: `<svg ${S}><circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="17" r="2.6"/><path d="M8 8.2l2.8 6.6M16.4 7.8l-3 6.9M8.2 7h7.6"/></svg>`,
  summary: `<svg ${S}><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M17.5 2.5l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor" stroke="none"/></svg>`,
  ask: `<svg ${S}><path d="M4 5h16v11H9l-5 4z"/><path d="M10 9a2 2 0 1 1 2.8 1.8c-.5.2-.8.6-.8 1.2"/><circle cx="12" cy="13.6" r=".6" fill="currentColor"/></svg>`,
  study: `<svg ${S}><path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.6 1.6 3.4 2.2 5.5 2.2s3.9-.6 5.5-2.2V11"/><path d="M21.5 9v5"/></svg>`,
  vision: `<svg ${S}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2"/></svg>`,
  fineprint: `<svg ${S}><path d="M12 3l9 16H3z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="16.8" r=".7" fill="currentColor"/></svg>`,
  reading: `<svg ${S}><path d="M3 5.5c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z"/><path d="M12 6.5v13"/></svg>`,
  settings: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>`,
  open: `<svg ${S}><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  copy: `<svg ${S}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>`,
  download: `<svg ${S}><path d="M12 4v11M7 10.5l5 5 5-5M4.5 20h15"/></svg>`,
  file: `<svg ${S}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  link: `<svg ${S}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`,
  close: `<svg ${S}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  check: `<svg ${S}><path d="M4.5 12.5l5 5 10-11"/></svg>`,
  scan: `<svg ${S}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/></svg>`,
  lens: `<svg ${S}><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M8 10.5h5M10.5 8v5"/></svg>`,
  back: `<svg ${S}><path d="M15 5l-7 7 7 7"/></svg>`,
  send: `<svg ${S}><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>`,
  flip: `<svg ${S}><path d="M4 8a8 8 0 0 1 14-3l2 2"/><path d="M20 3v4h-4"/><path d="M20 16a8 8 0 0 1-14 3l-2-2"/><path d="M4 21v-4h4"/></svg>`,
  contrast: `<svg ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></svg>`,
  sparkles: `<svg ${S}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>`,
  plus: `<svg ${S}><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg ${S}><path d="M5 12h14"/></svg>`,
  focus: `<svg ${S}><path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5"/><rect x="8" y="10" width="8" height="4" rx="1"/></svg>`,
  spider: `<svg ${S}><ellipse cx="12" cy="14.5" rx="3.2" ry="4"/><circle cx="12" cy="8.6" r="2.2"/><path d="M9.5 12.5L4 9.5 3 5M9 14.5H3.5L2 18M9.5 16.5L5 20M14.5 12.5L20 9.5 21 5M15 14.5h5.5L22 18M14.5 16.5L19 20"/></svg>`,
  trash: `<svg ${S}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
};

let toastHost = null;

export function toast(message, kind = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: `toast toast-${kind}` }, message);
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es', opts);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Limita cuántas tareas asíncronas corren a la vez. */
export async function pool(items, limit, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Teclas de un atajo de Electron para mostrarlas como <kbd>. */
export function keyTokens(accel = '') {
  const mac = (window.aracne?.platform || 'darwin') === 'darwin';
  return String(accel).split('+').filter(Boolean).map((k) => {
    if (k === 'CommandOrControl' || k === 'CmdOrCtrl') return mac ? '⌘' : 'Ctrl';
    if (k === 'Shift') return mac ? '⇧' : 'Shift';
    if (k === 'Alt' || k === 'Option') return mac ? '⌥' : 'Alt';
    if (k === 'Control' || k === 'Ctrl') return mac ? '⌃' : 'Ctrl';
    if (k === 'Space') return 'Espacio';
    return k;
  });
}

/** Mensaje de error limpio (sin el prefijo técnico de la comunicación con el proceso principal). */
export function cleanError(err) {
  return String(err?.message || err || 'Error desconocido').replace(/^Error invoking remote method '[^']+':\s*(\w*Error:\s*)?/, '');
}
