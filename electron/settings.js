// Ajustes guardados en la carpeta de datos del usuario. Las claves de IA se cifran con safeStorage.
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = {
  shortcut: 'CommandOrControl+Shift+Space',
  animation: 'alta', // alta | media | baja | apagada
  autoPage: true, // las arañas bajan la página solas hasta terminar el documento
  invertScreen: 'auto', // auto | siempre | nunca
  rememberReading: true,
  openAtLogin: false,
  firstRun: true,
  ai: {
    provider: 'auto', // auto | ollama | gemini | anthropic | openai
    models: {}, // proveedor → modelo elegido
    ollamaHost: 'http://127.0.0.1:11434',
    openaiBase: 'https://api.openai.com/v1',
  },
  secrets: {}, // proveedor → clave cifrada (base64)
};

let file;
let data = structuredClone(DEFAULTS);

export function loadSettings() {
  file = path.join(app.getPath('userData'), 'ajustes.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...structuredClone(DEFAULTS), ...saved, ai: { ...DEFAULTS.ai, ...(saved.ai || {}) } };
  } catch {
    data = structuredClone(DEFAULTS);
  }
  return publicSettings();
}

function save() {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('No se pudieron guardar los ajustes', err);
  }
}

/** Ajustes sin las claves (lo que ve la interfaz). */
export function publicSettings() {
  const { secrets, ...rest } = data;
  return {
    ...structuredClone(rest),
    keys: Object.fromEntries(Object.keys(secrets || {}).map((k) => [k, true])),
  };
}

export function getSetting(key) {
  return data[key];
}

export function updateSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'secrets' || k === 'keys') continue;
    if (k === 'ai' && v && typeof v === 'object') data.ai = { ...data.ai, ...v, models: { ...data.ai.models, ...(v.models || {}) } };
    else data[k] = v;
  }
  save();
  return publicSettings();
}

export function setSecret(provider, value) {
  if (!value) {
    delete data.secrets[provider];
  } else if (safeStorage.isEncryptionAvailable()) {
    data.secrets[provider] = `enc:${safeStorage.encryptString(value).toString('base64')}`;
  } else {
    data.secrets[provider] = `b64:${Buffer.from(value, 'utf8').toString('base64')}`;
  }
  save();
}

export function getSecret(provider) {
  const v = data.secrets?.[provider];
  if (!v) return null;
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('b64:')) return Buffer.from(v.slice(4), 'base64').toString('utf8');
  } catch {
    return null;
  }
  return null;
}
