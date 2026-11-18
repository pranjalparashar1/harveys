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

import { inventoryPrompt } from './prompt.js';

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
  /** @param {'invalidKey'|'rateLimited'|'network'|'malformedResponse'|'imageTooLarge'} kind */
  constructor(kind, detail = '') {
    super(AIError.message(kind));
    this.kind = kind;
    this.detail = detail;
  }
  static message(kind) {
    return {
      invalidKey: 'That API key was rejected. Check it and try again.',
      rateLimited: 'The provider is rate-limiting requests. Try again in a moment.',
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

/**
 * Builds the request for one inventory scan. Pure, so it is unit-tested.
 * @param {{provider: string, apiKey: string, model: string, images: Array<{base64: string, mediaType: string}>, prompt?: string}} p
 * @returns {{url: string, init: RequestInit}}
 */
export function buildScanRequest({ provider, apiKey, model, images, prompt = inventoryPrompt() }) {
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
          generationConfig: { responseMimeType: 'application/json' },
        }),
      };
    default:
      throw new Error(`Unknown provider ${provider}`);
  }
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
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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

async function send(url, init, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (e) {
    throw new AIError('network', String(e?.message ?? e));
  }
  if (response.status === 401 || response.status === 403) throw new AIError('invalidKey');
  if (response.status === 429) throw new AIError('rateLimited');
  if (response.status === 413) throw new AIError('imageTooLarge');
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AIError('network', `HTTP ${response.status} ${redact(body, apiKey)}`);
  }
  return response.json();
}

/**
 * Sends the photos and returns the list of things the AI saw.
 * The AI only perceives; it never picks a meal.
 */
export async function scanKitchen({ provider, apiKey, model, images, fetchImpl = fetch }) {
  const { url, init } = buildScanRequest({ provider, apiKey, model, images });
  const root = await send(url, init, apiKey, fetchImpl);
  const items = parseInventory(extractText(provider, root));
  if (!items) throw new AIError('malformedResponse', 'unparseable response');
  return items;
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
  const root = await send(url, init, apiKey, fetchImpl);
  return parseModelList(provider, root);
}

/** Picks the Cals default if the account has it, else the lightest-looking model. */
export function pickModel(provider, available) {
  const preferred = DEFAULT_MODEL[provider];
  if (!available?.length || available.includes(preferred)) return preferred;
  const light = { claude: /haiku/, openAI: /mini/, gemini: /flash/ }[provider];
  return available.find((m) => light.test(m)) ?? available[0];
}
