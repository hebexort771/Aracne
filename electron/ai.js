// Conexión con la IA: Ollama (local y gratis), Gemini, Claude u OpenAI/compatibles.
// Todas las llamadas salen desde el proceso principal; la interfaz nunca ve las claves.
import { net } from 'electron';
import { getSetting, getSecret, updateSettings } from './settings.js';

const TIMEOUT = 180_000;

async function request(url, { method = 'GET', headers = {}, body, timeout = TIMEOUT } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg = json?.error?.message || json?.error || json?.message || text.slice(0, 300) || `HTTP ${res.status}`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      err.status = res.status;
      throw err;
    }
    return json ?? text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('La IA tardó demasiado en responder.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Proveedores ----------------

const providers = {
  ollama: {
    label: 'Ollama (en tu computadora)',
    needsKey: false,
    contextChars: 14000,
    host() {
      return (getSetting('ai').ollamaHost || 'http://127.0.0.1:11434').replace(/\/$/, '');
    },
    async models() {
      const json = await request(`${this.host()}/api/tags`, { timeout: 2500 });
      const list = (json.models || []).map((m) => ({ id: m.name, name: m.name }));
      // Marca los que aceptan imágenes (Ollama moderno informa "capabilities").
      await Promise.all(
        list.slice(0, 25).map(async (m) => {
          try {
            const info = await request(`${this.host()}/api/show`, { method: 'POST', body: { model: m.id }, timeout: 4000 });
            m.vision = Array.isArray(info.capabilities) ? info.capabilities.includes('vision') : /llava|vision|gemma3|qwen2\.5vl|qwen.*vl|minicpm-v|moondream|llama4|mistral-small3/i.test(m.id);
          } catch {
            m.vision = /llava|vision|gemma3|vl|moondream/i.test(m.id);
          }
        }),
      );
      return list.filter((m) => !/embed/i.test(m.id));
    },
    async complete({ model, system, prompt, images, json, maxTokens }) {
      const res = await request(`${this.host()}/api/chat`, {
        method: 'POST',
        body: {
          model,
          stream: false,
          format: json ? 'json' : undefined,
          options: { num_ctx: 16384, num_predict: maxTokens || 2048 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt, images: images?.length ? images.map((i) => i.data) : undefined },
          ],
        },
      });
      return res.message?.content || '';
    },
  },

  gemini: {
    label: 'Google Gemini',
    needsKey: true,
    contextChars: 120000,
    async models(key) {
      const json = await request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, timeout: 15000 });
      return (json.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .filter((m) => /gemini/i.test(m.name) && !/embedding|tts|image-generation|live|audio|robotics|computer-use/i.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name, vision: true }));
    },
    pick(list) {
      return list.find((m) => /flash/i.test(m.id) && !/lite|preview|exp|thinking/i.test(m.id))
        || list.find((m) => /flash/i.test(m.id))
        || list[0];
    },
    async complete({ model, system, prompt, images, json, maxTokens }, key) {
      const parts = [{ text: prompt }];
      for (const img of images || []) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
      const res = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            maxOutputTokens: maxTokens || 4096,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        },
      });
      const cand = res.candidates?.[0];
      if (!cand) throw new Error(res.promptFeedback?.blockReason ? `Gemini bloqueó la respuesta (${res.promptFeedback.blockReason}).` : 'Gemini no devolvió respuesta.');
      return (cand.content?.parts || []).map((p) => p.text || '').join('');
    },
  },

  anthropic: {
    label: 'Claude (Anthropic)',
    needsKey: true,
    contextChars: 120000,
    async models(key) {
      const json = await request('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21' },
        timeout: 15000,
      });
      return (json.data || [])
        .filter((m) => !m.lifecycle || m.lifecycle === 'active')
        .map((m) => ({ id: m.id, name: m.display_name || m.id, vision: true }));
    },
    pick(list) {
      return list.find((m) => /sonnet/i.test(m.id)) || list.find((m) => /haiku/i.test(m.id)) || list[0];
    },
    async complete({ model, system, prompt, images, maxTokens }, key) {
      const content = [];
      for (const img of images || []) content.push({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
      content.push({ type: 'text', text: prompt });
      const res = await request('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2026-10-21' },
        body: { model, max_tokens: maxTokens || 4096, system, messages: [{ role: 'user', content }] },
      });
      return (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    },
  },

  openai: {
    label: 'OpenAI o compatible',
    needsKey: true,
    contextChars: 100000,
    base() {
      return (getSetting('ai').openaiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
    },
    async models(key) {
      const json = await request(`${this.base()}/models`, { headers: { authorization: `Bearer ${key}` }, timeout: 15000 });
      return (json.data || [])
        .filter((m) => !/embedding|whisper|tts|dall-e|moderation|audio|realtime|transcribe|image|search|codex/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.id, vision: true }));
    },
    pick(list) {
      return list.find((m) => /mini/i.test(m.id)) || list[0];
    },
    async complete({ model, system, prompt, images, json }, key) {
      const content = [{ type: 'text', text: prompt }];
      for (const img of images || []) content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } });
      const body = {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content },
        ],
      };
      if (json && /api\.openai\.com/.test(this.base())) body.response_format = { type: 'json_object' };
      const res = await request(`${this.base()}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body,
      });
      return res.choices?.[0]?.message?.content || '';
    },
  },
};

// ---------------- API pública ----------------

let ollamaCache = { at: 0, models: null };

async function ollamaModels() {
  if (ollamaCache.models && Date.now() - ollamaCache.at < 30000) return ollamaCache.models;
  try {
    const models = await providers.ollama.models();
    ollamaCache = { at: Date.now(), models };
  } catch {
    ollamaCache = { at: Date.now(), models: [] };
  }
  return ollamaCache.models;
}

/** Decide qué proveedor y modelo usar ahora mismo. */
export async function resolveProvider() {
  const cfg = getSetting('ai');
  const order = cfg.provider === 'auto' ? ['ollama', 'gemini', 'anthropic', 'openai'] : [cfg.provider];
  for (const id of order) {
    const p = providers[id];
    if (!p) continue;
    if (id === 'ollama') {
      const models = await ollamaModels();
      if (!models.length) continue;
      const chosen = models.find((m) => m.id === cfg.models.ollama) || models.find((m) => !m.vision) || models[0];
      const vision = models.find((m) => m.id === cfg.models['ollama-vision']) || (chosen.vision ? chosen : models.find((m) => m.vision));
      return { id, label: p.label, model: chosen.id, visionModel: vision?.id || null, contextChars: p.contextChars };
    }
    const key = getSecret(id);
    if (!key) continue;
    const model = cfg.models[id] || null;
    return { id, label: p.label, model, visionModel: model, contextChars: p.contextChars, key };
  }
  return null;
}

export async function aiStatus() {
  const r = await resolveProvider();
  if (!r) return { available: false };
  return { available: true, provider: r.id, label: r.label, model: r.model, vision: !!r.visionModel, contextChars: r.contextChars };
}

export async function listModels(provider) {
  const p = providers[provider];
  if (!p) throw new Error('Proveedor desconocido');
  if (provider === 'ollama') {
    ollamaCache = { at: 0, models: null };
    return ollamaModels();
  }
  const key = getSecret(provider);
  if (!key) throw new Error('Falta la clave de API.');
  return p.models(key);
}

/**
 * @param {{system:string, prompt:string, images?:{mime:string,data:string}[], json?:boolean, maxTokens?:number}} req
 */
export async function complete(req) {
  const r = await resolveProvider();
  if (!r) throw new Error('No hay IA configurada. Abre Ajustes → Inteligencia artificial.');
  const p = providers[r.id];
  let model = req.images?.length ? r.visionModel : r.model;
  if (req.images?.length && !model) {
    throw new Error('El modelo de IA que tienes no puede ver imágenes. En Ollama instala uno con visión, por ejemplo: ollama pull gemma3');
  }
  if (!model) {
    // Primera vez con este proveedor: elegir un modelo razonable automáticamente.
    const list = await p.models(r.key);
    if (!list.length) throw new Error('No se encontraron modelos disponibles para tu clave.');
    model = (p.pick ? p.pick(list) : list[0]).id;
    updateSettings({ ai: { models: { [r.id]: model } } });
  }
  const text = await p.complete({ ...req, model }, r.key);
  return { text, provider: r.id, model };
}
