// Bring-your-own-key vision calls, mirroring Cals' RemoteMacroService:
//   • the provider is detected from the key's format (AIProviderDetection.swift)
//   • raw HTTPS per provider, same endpoints and envelopes (no SDKs)
//   • a GET on /models validates the key and lists models (validateKey / listModels)
//   • HTTP errors map to the same user-facing outcomes (MacroEstimationError)
//
// Differences from Cals, because this runs in a browser:
//   • several photos go in one request (Cals sends one plate photo)
//   • Claude needs the `anthropic-dangerous-direct-browser-access` header for CORS
//   • Gemini's key goes in the `x-goog-api-key` header rather than the URL
//
// The key lives only in this browser's localStorage and is sent only to the
// provider it belongs to.

import { inventoryPrompt, recipePrompt } from './prompt.js';

export const PROVIDERS = {
  claude: { label: 'Claude (Anthropic)', keyHint: 'sk-ant-…', keysUrl: 'https://console.anthropic.com/settings/keys' },
  openAI: { label: 'OpenAI', keyHint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Gemini (Google)', keyHint: 'AIza… or AQ.…', keysUrl: 'https://aistudio.google.com/apikey' },
};

/** Same defaults as Cals' AIProviderModels.swift. */
export const DEFAULT_MODEL = {
  openAI: 'gpt-4.1-mini',
  gemini: 'gemini-3.5-flash-lite',
  claude: 'claude-haiku-4-5',
};

/** Offline shortlist, as in Cals, used when /models can't be fetched. */
export const FALLBACK_MODELS = {
  openAI: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1'],
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
};

/** Port of AIProviderDetection.detect(fromKey:). */
export function detectProvider(key) {
  const k = String(key ?? '').trim();
  if (k.startsWith('sk-ant-')) return 'claude'; // must precede the sk- check
  if (k.startsWith('sk-')) return 'openAI';
  if (k.startsWith('AIza') || k.startsWith('AQ.')) return 'gemini';
  return null;
}

export class AIError extends Error {
  /** @param {'invalidKey'|'rateLimited'|'overloaded'|'timeout'|'modelUnavailable'|'badRequest'|'network'|'malformedResponse'|'imageTooLarge'} kind */
  constructor(kind, detail = '', status = 0) {
    super(AIError.message(kind));
    this.kind = kind;
    this.detail = detail;
    this.status = status;
  }
  /** Worth trying again, or on another model. */
  get retryable() {
    return ['rateLimited', 'overloaded', 'timeout', 'modelUnavailable', 'malformedResponse'].includes(this.kind);
  }
  static message(kind) {
    return {
      invalidKey: 'That API key was rejected. Check it and try again.',
      rateLimited: 'The provider is rate-limiting requests. Try again in a moment.',
      overloaded: 'Your AI provider is overloaded right now (high demand). Try again in a minute.',
      timeout: 'Your AI took too long to answer.',
      modelUnavailable: "That model isn't available on this key.",
      badRequest: 'The provider refused the request.',
      network: "Couldn't reach the provider. Check your connection and try again.",
      malformedResponse: 'The provider sent back something unreadable. Try again, or add items by hand.',
      imageTooLarge: 'Those photos are too large to send together. Try fewer photos.',
    }[kind];
  }
}

const ANTHROPIC_HEADERS = (apiKey) => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

/** Gemini "thinking" makes a photo scan slow and more likely to time out; keep it low. */
export function geminiThinking(model) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return null;
}

/**
 * Builds one request (photos optional). Pure, so it is unit-tested.
 * @param {{provider: string, apiKey: string, model: string, images?: Array<{base64: string, mediaType: string}>, prompt: string, thinking?: boolean}} p
 * @returns {{url: string, init: RequestInit}}
 */
export function buildRequest({ provider, apiKey, model, images = [], prompt, thinking = true }) {
  const json = (headers, body) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  switch (provider) {
    case 'claude':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        init: json(ANTHROPIC_HEADERS(apiKey), {
          model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
              { type: 'text', text: prompt },
            ],
          }],
        }),
      };
    case 'openAI':
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        init: json({ authorization: `Bearer ${apiKey}` }, {
          model,
          max_completion_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
            ],
          }],
        }),
      };
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        init: json({ 'x-goog-api-key': apiKey }, {
          contents: [{
            parts: [
              { text: prompt },
              ...images.map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.base64 } })),
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            ...(thinking && geminiThinking(model) ? { thinkingConfig: geminiThinking(model) } : {}),
          },
        }),
      };
    default:
      throw new Error(`Unknown provider ${provider}`);
  }
}

/** The inventory scan request (kept for the tests and for readability). */
export function buildScanRequest({ prompt = inventoryPrompt(), ...rest }) {
  return buildRequest({ prompt, ...rest });
}

/** Port of MacroResponseParsing.extractText(from…). */
export function extractText(provider, root) {
  try {
    switch (provider) {
      case 'openAI': return root.choices[0].message.content ?? null;
      case 'gemini': return root.candidates[0].content.parts.map((p) => p.text ?? '').join('') || null;
      case 'claude': return root.content.find((b) => b.type === 'text')?.text ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

const CATEGORIES = new Set(['food', 'appliance', 'cookware', 'utensil', 'cutlery', 'other']);

/** Takes the first balanced {…} from model text and validates the inventory shape. */
export function parseInventory(text) {
  const obj = parseJsonObject(text);
  if (!obj || !Array.isArray(obj.items)) return null;
  return obj.items
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => ({
      name: i.name.trim().slice(0, 80),
      category: CATEGORIES.has(i.category) ? i.category : 'other',
      canonical: typeof i.canonical === 'string' && i.canonical ? i.canonical : null,
      brand: typeof i.brand === 'string' && i.brand ? i.brand.slice(0, 40) : null,
      quantity: typeof i.quantity === 'string' && i.quantity ? i.quantity.slice(0, 40) : null,
      location: typeof i.location === 'string' && i.location ? i.location.slice(0, 20) : null,
      confidence: ['low', 'medium', 'high'].includes(i.confidence) ? i.confidence : 'medium',
    }));
}

function redact(text, apiKey) {
  const t = String(text).slice(0, 300);
  return apiKey ? t.split(apiKey).join('***') : t;
}

/** Maps an HTTP failure to an outcome, like Cals' MacroEstimationError. */
export function errorForStatus(status, body = '') {
  if (status === 401 || status === 403) return new AIError('invalidKey', body, status);
  if (status === 429) return new AIError('rateLimited', body, status);
  if (status === 413) return new AIError('imageTooLarge', body, status);
  if (status === 404) return new AIError('modelUnavailable', body, status);
  if (status === 400) return new AIError('badRequest', body, status);
  // 500 internal, 502/504 gateway, 503 "high demand" (Gemini), 529 overloaded (Anthropic)
  if (status >= 500) return new AIError('overloaded', body, status);
  return new AIError('network', `HTTP ${status} ${body}`, status);
}

async function send(url, init, apiKey, fetchImpl, timeoutMs = 0) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetchImpl(url, controller ? { ...init, signal: controller.signal } : init);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw errorForStatus(response.status, redact(body, apiKey));
    }
    return await response.json();
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e?.name === 'AbortError') throw new AIError('timeout', `no answer after ${Math.round(timeoutMs / 1000)} s`);
    throw new AIError('network', redact(String(e?.message ?? e), apiKey));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Models to try, in order: the chosen one, then light, stable alternatives the
 * key can use. Overload is per model, so switching often gets through.
 */
export function modelChain(provider, chosen, available = [], max = 3) {
  const stable = (m) => !/(preview|exp|experimental|latest|\d{2}-\d{2})/.test(m);
  const light = { claude: /haiku|sonnet/, openAI: /mini|4o|4\.1/, gemini: /flash/ }[provider];
  const pool = available.length ? available : FALLBACK_MODELS[provider];
  const extras = [...FALLBACK_MODELS[provider], ...pool]
    .filter((m) => !available.length || available.includes(m))
    .filter((m) => m !== chosen && stable(m) && light.test(m));
  return [...new Set([chosen, ...extras])].slice(0, max);
}

/**
 * One call with retries: up to 2 tries per model with backoff, then the next
 * model in the chain. A rejected key stops at once. Returns the model's text.
 * @param {{provider, apiKey, model, models?: string[], prompt: string, images?: any[], fetchImpl?, timeoutMs?: number, onStatus?: (s: string) => void, backoffMs?: number[]}} p
 */
export async function callModel({ provider, apiKey, model, models = [], prompt, images = [], fetchImpl = fetch, timeoutMs = 75000, onStatus = () => {}, backoffMs = [1500, 4000] }) {
  const chain = modelChain(provider, model, models);
  let last;
  for (const m of chain) {
    let thinking = true;
    for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
      onStatus(attempt ? `${m} is busy, retrying…` : m === model ? `Asking ${m}…` : `Trying ${m} instead…`);
      try {
        const { url, init } = buildRequest({ provider, apiKey, model: m, images, prompt, thinking });
        const root = await send(url, init, apiKey, fetchImpl, timeoutMs);
        const text = extractText(provider, root);
        if (!text) throw new AIError('malformedResponse', 'empty answer');
        return { text, model: m };
      } catch (e) {
        last = e;
        if (!(e instanceof AIError)) throw e;
        if (e.kind === 'invalidKey' || e.kind === 'imageTooLarge' || e.kind === 'network') throw e;
        if (e.kind === 'badRequest' && provider === 'gemini' && thinking && geminiThinking(m)) {
          thinking = false; // older model that doesn't know thinkingConfig: retry plainly
          attempt--;
          continue;
        }
        if (e.kind === 'badRequest' || e.kind === 'modelUnavailable' || e.kind === 'timeout') break; // next model
        if (attempt < backoffMs.length) await wait(backoffMs[attempt]);
      }
    }
  }
  last.detail = `${last.detail ? `${last.detail} ` : ''}(tried ${chain.join(', ')})`;
  throw last;
}

/**
 * Sends the photos and returns the list of things the AI saw.
 * The AI only perceives; it never picks a meal.
 */
export async function scanKitchen({ images, ...rest }) {
  const { text, model } = await callModel({ ...rest, images, prompt: inventoryPrompt() });
  const items = parseInventory(text);
  if (!items) throw new AIError('malformedResponse', 'unparseable inventory');
  return Object.assign(items, { model });
}

/** First balanced {…} in model text, parsed, or null. */
export function parseJsonObject(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Asks the AI to design candidate recipes from what Marco knows you have.
 * Returns raw candidates: the brain validates, filters and scores them.
 */
export async function designRecipes({ have, context, ...rest }) {
  const { text, model } = await callModel({ ...rest, timeoutMs: 60000, prompt: recipePrompt({ have, context }) });
  const obj = parseJsonObject(text);
  if (!obj || !Array.isArray(obj.recipes)) throw new AIError('malformedResponse', 'unparseable recipes');
  return { recipes: obj.recipes.slice(0, 5), model };
}

function modelsRequest(provider, apiKey) {
  switch (provider) {
    case 'claude': return { url: 'https://api.anthropic.com/v1/models?limit=100', init: { headers: ANTHROPIC_HEADERS(apiKey) } };
    case 'openAI': return { url: 'https://api.openai.com/v1/models', init: { headers: { authorization: `Bearer ${apiKey}` } } };
    case 'gemini': return { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', init: { headers: { 'x-goog-api-key': apiKey } } };
  }
  throw new Error(`Unknown provider ${provider}`);
}

/** Port of Cals' ModelListParsing: vision/chat-capable models only. */
export function parseModelList(provider, root) {
  const data = root?.data ?? root?.models ?? [];
  switch (provider) {
    case 'claude':
      return data.map((m) => m.id).filter((id) => typeof id === 'string' && id.startsWith('claude-'));
    case 'openAI':
      return data
        .map((m) => m.id)
        .filter((id) => typeof id === 'string' && /^(gpt-4o|gpt-4\.1|gpt-5|o\d)/.test(id))
        .filter((id) => !/(audio|realtime|transcribe|tts|search|image|codex|instruct)/.test(id))
        .sort();
    case 'gemini':
      return data
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => String(m.name ?? '').replace(/^models\//, ''))
        .filter((id) => id.startsWith('gemini-') && !/(tts|image|embedding|live|audio)/.test(id));
  }
  return [];
}

/** Validates the key (HTTP 200 on /models) and returns the usable models. */
export async function checkKey({ provider, apiKey, fetchImpl = fetch }) {
  const { url, init } = modelsRequest(provider, apiKey);
  const root = await send(url, init, apiKey, fetchImpl, 20000);
  return parseModelList(provider, root);
}

/** Picks the Cals default if the account has it, else the lightest-looking model. */
export function pickModel(provider, available) {
  const preferred = DEFAULT_MODEL[provider];
  if (!available?.length || available.includes(preferred)) return preferred;
  const light = { claude: /haiku/, openAI: /mini/, gemini: /flash/ }[provider];
  const stable = (m) => !/(preview|exp|experimental|latest)/.test(m);
  return available.find((m) => light.test(m) && stable(m)) ?? available.find((m) => light.test(m)) ?? available[0];
}
