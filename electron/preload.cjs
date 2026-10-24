// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'overlay:open',
  'overlay:close',
  'settings:changed',
  'lector:permission',
  'lector:settings',
  'lector:open-path',
  'lector:open-doc',
]);

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('aracne', {
  platform: process.platform,
  info: invoke('app:info'),
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
  ai: {
    status: invoke('ai:status'),
    models: invoke('ai:models'),
    setKey: invoke('ai:setKey'),
    complete: invoke('ai:complete'),
  },
  sources: { check: invoke('sources:check') },
  web: { load: invoke('web:load'), image: invoke('image:fetch') },
  files: {
    open: invoke('file:open'),
    read: invoke('file:read'),
    pending: invoke('file:pending'),
    save: invoke('file:save'),
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
  clipboard: { write: invoke('clipboard:write') },
  shell: { open: invoke('shell:open'), reveal: invoke('shell:reveal') },
  capture: { rect: invoke('capture:rect') },
  memory: {
    list: invoke('memory:list'),
    add: invoke('memory:add'),
    remove: invoke('memory:remove'),
    clear: invoke('memory:clear'),
  },
  overlay: {
    ready: () => ipcRenderer.send('overlay:ready'),
    hide: invoke('overlay:hide'),
    openLector: invoke('overlay:open-lector'),
    activate: invoke('overlay:activate'),
  },
  perms: {
    openScreenSettings: invoke('perm:open-screen-settings'),
    relaunch: invoke('app:relaunch'),
  },
  on(channel, callback) {
    if (!EVENTS.has(channel)) throw new Error(`Evento no permitido: ${channel}`);
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
