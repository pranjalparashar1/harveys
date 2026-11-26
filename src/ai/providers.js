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
import { FOODS, EQUIPMENT, ASSUMED_BASICS, labelFor } from '../brain/vocabulary.js';

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
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], // 2.5-flash-lite returns 404 for new keys (checked 18 Nov 2026)
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
  /** @param {'noKey'|'invalidKey'|'rateLimited'|'overloaded'|'timeout'|'modelUnavailable'|'badRequest'|'network'|'malformedResponse'|'imageTooLarge'|'freeLimit'|'scanOff'} kind */
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
      freeLimit: "That's today's free scans.",
      scanOff: 'Free scanning is off right now.',
      noKey: 'Scanning needs an AI key for now.',
    }[kind];
  }
}

const ANTHROPIC_HEADERS = (apiKey) => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

/**
 * Gemini "thinking" is most of a scan's wait. Step 0 asks for the least
 * thinking; if a model rejects that (HTTP 400) the call steps up: 'low', then
 * no setting at all.
 */
export function geminiThinking(model, step = 0) {
  if (/^gemini-2\.5-flash/.test(model)) return step === 0 ? { thinkingBudget: 0 } : null;
  if (/^gemini-3/.test(model)) return [{ thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }][step] ?? null;
  return null;
}
const LAST_STEP = 2;

/**
 * Builds one request (photos optional). Pure, so it is unit-tested.
 * @param {{provider: string, apiKey: string, model: string, images?: Array<{base64: string, mediaType: string}>, prompt: string, thinking?: boolean}} p
 * @returns {{url: string, init: RequestInit}}
 */
export function buildRequest({ provider, apiKey, model, images = [], prompt, thinking = 0, maxTokens = 2048, resolution = 'medium' }) {
  const step = thinking === true ? 0 : thinking === false ? LAST_STEP : thinking;
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
          max_tokens: maxTokens,
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
          max_completion_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: resolution === 'high' ? 'high' : 'low' } })),
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
            maxOutputTokens: maxTokens,
            // Speed knobs. If a model rejects them (HTTP 400) the call is resent without them.
            ...(geminiThinking(model, step) ? { thinkingConfig: geminiThinking(model, step) } : {}),
            ...(step < LAST_STEP && images.length ? { mediaResolution: `MEDIA_RESOLUTION_${resolution.toUpperCase()}` } : {}),
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
  if (!obj) return null;
  // 1.2 compact form: {"have": [ids], "other": [names]}
  if (Array.isArray(obj.have)) {
    const known = (id) => FOODS[id] || EQUIPMENT[id] || ASSUMED_BASICS[id];
    const items = [...new Set(obj.have.filter((id) => typeof id === 'string'))].map((id) => known(id)
      ? { name: labelFor(id), category: FOODS[id] ? 'food' : EQUIPMENT[id]?.kind ?? 'utensil', canonical: id }
      : { name: id.replace(/_/g, ' ').slice(0, 80), category: 'other', canonical: null });
    for (const name of Array.isArray(obj.other) ? obj.other.slice(0, 40) : []) {
      if (typeof name === 'string' && name.trim()) items.push({ name: name.trim().slice(0, 80), category: 'other', canonical: null });
    }
    return items.map((i) => ({ brand: null, quantity: null, location: null, confidence: 'medium', ...i }));
  }
  // 1.0 / 1.1 long form: {"items": [{name, category, canonical, …}]}
  if (!Array.isArray(obj.items)) return null;
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
  // `init.signal` (from callModel) or `timeoutMs` (key check) cancels the request.
  const controller = timeoutMs && !init.signal ? new AbortController() : null;
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
    if (e?.name === 'AbortError') throw new AIError('timeout', 'cancelled');
    throw new AIError('network', redact(String(e?.message ?? e), apiKey));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Models to race, in order: the chosen one, then light, stable alternatives
 * the key can use. Overload is per model, so a second model often answers.
 */
export function modelChain(provider, chosen, available = [], max = 3) {
  const stable = (m) => !/(preview|exp|experimental|latest|\d{2}-\d{2})/.test(m);
  // Gemini: flash-lite only (pranjal's rule for their key; also the fastest tier).
  const light = { claude: /haiku|sonnet/, openAI: /mini|4o|4\.1/, gemini: /flash-lite/ }[provider];
  const pool = available.length ? available : FALLBACK_MODELS[provider];
  const extras = [...FALLBACK_MODELS[provider], ...pool]
    .filter((m) => !available.length || available.includes(m))
    .filter((m) => m !== chosen && stable(m) && light.test(m))
    // fastest first: lite/mini/haiku before the rest
    .sort((a, b) => Number(/lite|-mini|haiku/.test(b)) - Number(/lite|-mini|haiku/.test(a)));
  return [...new Set([chosen, ...extras])].slice(0, max);
}

/**
 * One AI call under a hard deadline (Marco 1.2).
 *
 *   • Two models start at once; the first good answer wins and the other is cancelled.
 *   • If one fails fast (busy, quota, network), the next model in the chain starts,
 *     as long as there is time left.
 *   • Nothing outlives `deadlineMs`. iOS Safari kills requests after about 60 s and
 *     reports "Load failed", which 1.1 showed as "Couldn't reach the provider".
 *   • Every attempt is reported through `onEvent` for the debug panel.
 *
 * @returns {Promise<{text: string, model: string, ms: number}>}
 */
export async function callModel({
  provider, apiKey, model, models = [], prompt, images = [], fetchImpl = fetch,
  deadlineMs = 12000, parallel = 2, maxTokens = 2048, onStatus = () => {}, onEvent = () => {},
  hedgeMs = 0, signal = null, copies = 1, resolution = 'medium',
}) {
  // `copies` > 1 repeats each model: Gemini's latency is bimodal (about 2 s or about
  // 8 s for the same request), so a duplicate sent a few seconds later often wins.
  const chain = modelChain(provider, model, models).flatMap((m) => Array(copies).fill(m));
  const t0 = Date.now();
  const left = () => deadlineMs - (Date.now() - t0);
  const controllers = new Set();
  let next = 0;
  let running = 0;
  let last = null;
  let settled = false;

  return await new Promise((resolve, reject) => {
    let hedge = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hedge);
      for (const c of controllers) c.abort();
      fn(value);
    };
    const timer = setTimeout(() => {
      const e = last && last.kind !== 'timeout' ? last : new AIError('timeout', `no answer within ${Math.round(deadlineMs / 1000)} s`);
      e.detail = `${e.detail ? `${e.detail} ` : ''}(tried ${chain.slice(0, Math.max(next, 1)).join(', ')})`;
      onEvent({ stage: 'deadline', ms: Date.now() - t0, pending: running });
      finish(reject, e);
    }, deadlineMs);

    const attempt = async (m, thinking = 0) => {
      running++;
      const controller = new AbortController();
      controllers.add(controller);
      const started = Date.now();
      onStatus(next <= 1 ? `Asking ${m}…` : `Still waiting, asking ${m} again…`);
      try {
        const { url, init } = buildRequest({ provider, apiKey, model: m, images, prompt, thinking, maxTokens, resolution });
        onEvent({ stage: 'sent', model: m, bytes: init.body.length, ms: Date.now() - t0 });
        const root = await send(url, { ...init, signal: controller.signal }, apiKey, fetchImpl);
        const text = extractText(provider, root);
        if (!text) throw new AIError('malformedResponse', 'empty answer');
        onEvent({ stage: 'model', model: m, ok: true, ms: Date.now() - started });
        finish(resolve, { text, model: m, ms: Date.now() - t0 });
      } catch (err) {
        const e = err instanceof AIError ? err : new AIError('network', String(err?.message ?? err));
        if (settled) return;
        onEvent({ stage: 'model', model: m, ok: false, kind: e.kind, status: e.status, detail: String(e.detail ?? '').slice(0, 300), ms: Date.now() - started });
        if (e.kind === 'invalidKey' || e.kind === 'imageTooLarge') return finish(reject, e);
        last = e;
        if (e.kind === 'badRequest' && provider === 'gemini' && thinking < LAST_STEP) {
          running--;
          controllers.delete(controller);
          return attempt(m, thinking + 1); // a model that rejects a speed knob: step up and resend
        }
      } finally {
        controllers.delete(controller);
      }
      running--;
      if (settled) return;
      if (next < chain.length && left() > 2500) return attempt(chain[next++]);
      if (running === 0) {
        last.detail = `${last.detail ? `${last.detail} ` : ''}(tried ${chain.slice(0, next).join(', ')})`;
        finish(reject, last);
      }
    };

    // Hedge: a model that is silent (not failing) never hands over on its own,
    // so after `hedgeMs` the next model starts alongside it.
    const scheduleHedge = () => {
      hedge = setTimeout(() => {
        if (settled || next >= chain.length) return;
        attempt(chain[next++]);
        scheduleHedge();
      }, hedgeMs);
    };
    if (hedgeMs) scheduleHedge();
    // The caller can stop waiting early (e.g. enough photos are already in).
    signal?.addEventListener('abort', () => finish(reject, new AIError('timeout', 'stopped early: enough photos were in')));
    while (next < Math.min(parallel, chain.length)) attempt(chain[next++]);
  });
}

/**
 * Scan (1.3). Measured with a real Gemini key on 18 Nov 2026 (gemini-3.5-flash-lite):
 *   • latency is set by Gemini's queue, not by the photos: 1 photo and 3 photos
 *     both took about 1.3–2.4 s or 7.5–8.3 s (once 18 s), and text-only took 6.7 s;
 *   • thinking was already 0 tokens, and replies were about 20 tokens.
 * So photos go in small batches (up to 4 per request), and each batch is
 * re-sent to the same model every `hedgeMs` (up to `copies` in flight) until one
 * copy answers. Whatever has arrived by the deadline is used.
 */
export const PHOTOS_PER_REQUEST = 4;

export async function scanKitchen({ images, deadlineMs = 12000, hedgeMs = 2500, copies = 3, graceMs = 5000, perRequest = PHOTOS_PER_REQUEST, prompt = inventoryPrompt(), onEvent = () => {}, onStatus = () => {}, ...rest }) {
  const t0 = Date.now();
  const batches = [];
  for (let i = 0; i < images.length; i += perRequest) batches.push(images.slice(i, i + perRequest));
  let done = 0;
  const stop = new AbortController();
  let grace = null;
  const results = await Promise.allSettled(batches.map((batch, b) =>
    callModel({
      ...rest,
      images: batch,
      prompt,
      parallel: 1,
      copies,
      hedgeMs,
      signal: stop.signal,
      deadlineMs: deadlineMs - (Date.now() - t0),
      onStatus: batches.length === 1 ? onStatus : () => {},
      onEvent: (e) => onEvent({ ...e, batch: batches.length > 1 ? b + 1 : null }),
    }).then((r) => {
      done++;
      if (batches.length > 1) onStatus(`${done} of ${batches.length} photo groups read…`);
      if (!grace && done < batches.length) {
        grace = setTimeout(() => { onEvent({ stage: 'grace', ms: Date.now() - t0 }); stop.abort(); }, graceMs);
      }
      return r;
    })));
  clearTimeout(grace);
  const items = [];
  const seen = new Set();
  const models = new Set();
  let photosRead = 0;
  let lastError = null;
  results.forEach((r, b) => {
    if (r.status !== 'fulfilled') {
      lastError = r.reason;
      return;
    }
    photosRead += batches[b].length;
    models.add(r.value.model);
    for (const item of parseInventory(r.value.text) ?? []) {
      const key = item.canonical ?? item.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    }
  });
  if (photosRead === 0) throw lastError ?? new AIError('malformedResponse', 'no photo could be read');
  return Object.assign(items, { model: [...models].join(' + '), ms: Date.now() - t0, photosRead, photosTotal: images.length });
}

/**
 * Free scan (1.61.0): no key on this phone, so the photos (or video keyframes) go to the
 * relay's POST /scan, which asks Gemini flash-lite with Harvey's own key and answers
 * {have, other, model, ms}. Same items out as scanKitchen(), so the screens after it are
 * the same. A plain text/plain POST, so the browser sends no CORS preflight.
 */
export const RELAY_MAX_IMAGES = 8;
const RELAY_TIMEOUT_MS = 15000; // the relay gives Gemini 11 s; iOS Safari kills requests near 60 s

export function scanUrl(relay) {
  return new URL('scan', String(relay).replace(/\/?$/, '/')).href;
}

/** Up to `max` images, spread evenly (a long video's frames, or too many photos). */
function thin(images, max) {
  if (images.length <= max) return images;
  return Array.from({ length: max }, (_, i) => images[Math.round((i * (images.length - 1)) / (max - 1))]);
}

export async function scanViaRelay({ images, relay, fetchImpl = fetch, timeoutMs = RELAY_TIMEOUT_MS, onEvent = () => {} }) {
  const t0 = Date.now();
  const send = thin(images, RELAY_MAX_IMAGES).map(({ base64, mediaType }) => ({ base64, mediaType }));
  const body = JSON.stringify({ images: send });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  onEvent({ stage: 'sent', model: 'free scan', bytes: body.length, ms: 0 });
  let res;
  try {
    res = await fetchImpl(scanUrl(relay), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    const err = e?.name === 'AbortError' ? new AIError('timeout', `free scan: no answer within ${Math.round(timeoutMs / 1000)} s`) : new AIError('network', `free scan: ${String(e?.message ?? e).slice(0, 200)}`);
    onEvent({ stage: 'model', model: 'free scan', ok: false, kind: err.kind, detail: err.detail, ms: Date.now() - t0 });
    throw err;
  }
  clearTimeout(timer);
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const code = out?.error ?? '';
    const kind = res.status === 429 ? 'freeLimit'
      : res.status === 503 ? 'scanOff'
        : res.status === 504 || code === 'timeout' ? 'timeout'
          : res.status === 413 ? 'imageTooLarge'
            : res.status === 400 || res.status === 415 || res.status === 403 ? 'badRequest'
              : 'overloaded';
    const err = new AIError(kind, `free scan: HTTP ${res.status} ${code}`.trim(), res.status);
    if (kind === 'freeLimit') {
      if (out?.message) err.message = out.message;
      err.retryAfter = Number(out?.retryAfter) || null;
      err.scope = out?.scope ?? null;
    }
    onEvent({ stage: 'model', model: 'free scan', ok: false, kind, status: res.status, detail: err.detail, ms: Date.now() - t0 });
    throw err;
  }
  const items = out && Array.isArray(out.have) ? parseInventory(JSON.stringify({ have: out.have, other: out.other ?? [] })) : null;
  if (!items) throw new AIError('malformedResponse', 'free scan: unreadable reply');
  onEvent({ stage: 'model', model: `free scan · ${out.model ?? '?'}`, ok: true, ms: Date.now() - t0 });
  return Object.assign(items, {
    model: `free scan · ${out.model ?? 'gemini'}`,
    ms: Date.now() - t0,
    photosRead: out.photosRead ?? send.length,
    photosTotal: out.photosTotal ?? send.length,
  });
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
  const { text, model } = await callModel({ deadlineMs: 9000, maxTokens: 1500, parallel: 1, copies: 3, hedgeMs: 3000, ...rest, prompt: recipePrompt({ have, context }) });
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
        .filter((id) => /^gemini-\d/.test(id) && !/(tts|image|embedding|live|audio|transcribe|robotics|computer-use|customtools|omni|nano)/.test(id));
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
/** Models Marco offers for a provider. Gemini: flash-lite only. */
export function allowedModels(provider, available) {
  const list = available?.length ? available : FALLBACK_MODELS[provider];
  return provider === 'gemini' ? list.filter((m) => /flash-lite/.test(m)) : list;
}

export function pickModel(provider, available) {
  const preferred = DEFAULT_MODEL[provider];
  if (!available?.length || available.includes(preferred)) return preferred;
  const light = { claude: /haiku/, openAI: /mini/, gemini: /flash-lite/ }[provider];
  const stable = (m) => !/(preview|exp|experimental|latest)/.test(m);
  return available.find((m) => light.test(m) && stable(m)) ?? available.find((m) => light.test(m)) ?? available[0];
}
