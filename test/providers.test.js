import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callModel, modelChain, buildRequest, designRecipes,
  detectProvider, buildScanRequest, extractText, parseInventory, scanKitchen, checkKey, pickModel, parseModelList, AIError,
} from '../src/ai/providers.js';

const IMG = [{ base64: 'AAAA', mediaType: 'image/jpeg' }, { base64: 'BBBB', mediaType: 'image/jpeg' }];
const fakeFetch = (status, body) => async () => ({
  status, ok: status >= 200 && status < 300,
  json: async () => body, text: async () => JSON.stringify(body),
});

test('key detection matches Cals (sk-ant before sk-)', () => {
  assert.equal(detectProvider('sk-ant-api03-x'), 'claude');
  assert.equal(detectProvider('sk-proj-x'), 'openAI');
  assert.equal(detectProvider(' AIzaSyX '), 'gemini');
  assert.equal(detectProvider('AQ.Ab123'), 'gemini');
  assert.equal(detectProvider('hello'), null);
});

test('Claude request: browser header, every photo, key only in header', () => {
  const { url, init } = buildScanRequest({ provider: 'claude', apiKey: 'sk-ant-k', model: 'm', images: IMG, prompt: 'p' });
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(init.headers['x-api-key'], 'sk-ant-k');
  const body = JSON.parse(init.body);
  assert.equal(body.messages[0].content.filter((c) => c.type === 'image').length, 2);
  assert.ok(!init.body.includes('sk-ant-k'));
});

test('OpenAI and Gemini requests carry every photo and keep the key out of the URL', () => {
  const o = buildScanRequest({ provider: 'openAI', apiKey: 'sk-k', model: 'm', images: IMG, prompt: 'p' });
  assert.equal(JSON.parse(o.init.body).messages[0].content.filter((c) => c.type === 'image_url').length, 2);
  assert.equal(o.init.headers.authorization, 'Bearer sk-k');
  const g = buildScanRequest({ provider: 'gemini', apiKey: 'AIzaK', model: 'gemini-x', images: IMG, prompt: 'p' });
  assert.ok(!g.url.includes('AIzaK'));
  assert.equal(g.init.headers['x-goog-api-key'], 'AIzaK');
  assert.equal(JSON.parse(g.init.body).contents[0].parts.filter((p) => p.inline_data).length, 2);
});

test('envelopes unwrap like Cals MacroResponseParsing', () => {
  assert.equal(extractText('claude', { content: [{ type: 'text', text: 'hi' }] }), 'hi');
  assert.equal(extractText('openAI', { choices: [{ message: { content: 'hi' } }] }), 'hi');
  assert.equal(extractText('gemini', { candidates: [{ content: { parts: [{ text: 'hi' }] } }] }), 'hi');
  assert.equal(extractText('claude', {}), null);
});

test('inventory parsing tolerates fences and drops junk', () => {
  const items = parseInventory('```json\n{"items":[{"name":"Paneer","category":"food","canonical":"paneer"},{"name":""},{"nope":1},{"name":"Pan","category":"weird"}]}\n```');
  assert.equal(items.length, 2);
  assert.equal(items[0].canonical, 'paneer');
  assert.equal(items[1].category, 'other');
  assert.equal(parseInventory('no json'), null);
  assert.equal(parseInventory('{"foo":1}'), null);
});

test('scanKitchen returns items and maps HTTP errors like Cals', async () => {
  const ok = await scanKitchen({ provider: 'claude', apiKey: 'k', model: 'm', images: IMG,
    fetchImpl: fakeFetch(200, { content: [{ type: 'text', text: '{"items":[{"name":"Eggs","category":"food","canonical":"eggs"}]}' }] }) });
  assert.equal(ok[0].name, 'Eggs');
  for (const [status, kind] of [[401, 'invalidKey'], [403, 'invalidKey'], [429, 'rateLimited'], [413, 'imageTooLarge'], [500, 'overloaded'], [503, 'overloaded'], [529, 'overloaded'], [404, 'modelUnavailable']]) {
    await assert.rejects(scanKitchen({ provider: 'openAI', apiKey: 'k', model: 'm', images: IMG, backoffMs: [], fetchImpl: fakeFetch(status, {}) }),
      (e) => e instanceof AIError && e.kind === kind);
  }
  await assert.rejects(scanKitchen({ provider: 'gemini', apiKey: 'k', model: 'm', images: IMG, backoffMs: [], fetchImpl: fakeFetch(200, { candidates: [] }) }),
    (e) => e.kind === 'malformedResponse');
});

test('error details never contain the key', async () => {
  await assert.rejects(scanKitchen({ provider: 'openAI', apiKey: 'sk-secret', model: 'm', images: IMG, backoffMs: [], fetchImpl: fakeFetch(500, { echo: 'sk-secret' }) }),
    (e) => !e.detail.includes('sk-secret') && !e.message.includes('sk-secret'));
});

test('model listing filters to usable models and picks a light default', async () => {
  const models = await checkKey({ provider: 'gemini', apiKey: 'k', fetchImpl: fakeFetch(200, { models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
  ] }) });
  assert.deepEqual(models, ['gemini-2.5-flash']);
  assert.equal(pickModel('gemini', models), 'gemini-2.5-flash');
  assert.equal(pickModel('claude', []), 'claude-haiku-4-5');
  assert.equal(pickModel('claude', ['claude-opus-5-5', 'claude-haiku-5-5']), 'claude-haiku-5-5');
  assert.deepEqual(parseModelList('openAI', { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o-audio-preview' }, { id: 'whisper-1' }] }), ['gpt-4o-mini']);
});

const GEMINI_OK = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const reply = (status, body) => ({ status, ok: status === 200, json: async () => body, text: async () => JSON.stringify(body) });

/** fetch fake: per model, a [status, body, delayMs] answer; delay Infinity = never answers. */
function byModel(table) {
  const calls = [];
  const impl = (url, init) => {
    const model = (url.match(/models\/([^:]+):/) ?? [])[1] ?? JSON.parse(init.body).model;
    calls.push({ model, body: JSON.parse(init.body) });
    const [status, body, delay = 0] = table[model] ?? table['*'] ?? [500, {}];
    return new Promise((resolve, reject) => {
      const t = delay === Infinity ? null : setTimeout(() => resolve(reply(status, body)), delay);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
  };
  return { impl, calls };
}
const G = ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];

test('two fast models race and the first good answer wins', async () => {
  const { impl, calls } = byModel({
    'gemini-3.5-flash-lite': [200, GEMINI_OK('{"have":[]}'), 300],
    'gemini-2.5-flash-lite': [200, GEMINI_OK('{"have":[]}'), 20],
  });
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, prompt: 'p', fetchImpl: impl });
  assert.equal(r.model, 'gemini-2.5-flash-lite');
  assert.equal(calls.length, 2);
});

test('503 "high demand" on one model: another model answers', async () => {
  const events = [];
  const { impl } = byModel({
    'gemini-3.5-flash-lite': [503, { error: { message: 'This model is currently experiencing high demand.' } }, 5],
    '*': [200, GEMINI_OK('{"have":[]}'), 30],
  });
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, prompt: 'p', fetchImpl: impl, onEvent: (e) => events.push(e) });
  assert.notEqual(r.model, G[0]);
  const failed = events.find((e) => e.model === G[0] && e.stage === 'model');
  assert.equal(failed.status, 503);
  assert.match(failed.detail, /high demand/);
});

test('when every model is overloaded the error says which were tried', async () => {
  const { impl, calls } = byModel({ '*': [503, {}, 5] });
  await assert.rejects(callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, prompt: 'p', fetchImpl: impl }),
    (e) => e.kind === 'overloaded' && e.detail.includes('tried gemini-3.5-flash-lite'));
  assert.deepEqual(calls.map((c) => c.model), ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']); // flash-lite only
});

test('a rejected key stops everything at once', async () => {
  const { impl } = byModel({ '*': [401, {}, 5] });
  await assert.rejects(callModel({ provider: 'claude', apiKey: 'k', model: 'claude-haiku-4-5', prompt: 'p', fetchImpl: impl }), (e) => e.kind === 'invalidKey');
});

test('an AI that never answers gives up at the deadline, not after a minute', async () => {
  const { impl } = byModel({ '*': [200, {}, Infinity] });
  const t0 = Date.now();
  await assert.rejects(callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, prompt: 'p', fetchImpl: impl, deadlineMs: 300 }),
    (e) => e.kind === 'timeout');
  assert.ok(Date.now() - t0 < 600);
});

test('Gemini speed knobs are set, and dropped if a model rejects them', async () => {
  const cfg = (m, images = []) => JSON.parse(buildRequest({ provider: 'gemini', apiKey: 'k', model: m, prompt: 'p', images }).init.body).generationConfig;
  assert.deepEqual(cfg('gemini-2.5-flash').thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual(cfg('gemini-3.5-flash-lite').thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal(cfg('gemini-1.5-flash').thinkingConfig, undefined);
  assert.equal(cfg('gemini-2.5-flash', [{ base64: 'A', mediaType: 'image/jpeg' }]).mediaResolution, 'MEDIA_RESOLUTION_MEDIUM');
  assert.equal(cfg('gemini-2.5-flash').maxOutputTokens, 2048);
  let n = 0;
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    n++;
    seen.push(body.generationConfig.thinkingConfig?.thinkingLevel ?? 'none');
    return body.generationConfig.thinkingConfig?.thinkingLevel === 'minimal' ? reply(400, {}) : reply(200, GEMINI_OK('{"have":[]}'));
  };
  const seen = [];
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: [G[0]], prompt: 'p', fetchImpl: impl, parallel: 1 });
  assert.equal(r.model, G[0]);
  assert.deepEqual(seen, ['minimal', 'low']); // steps up to 'low', never straight to full thinking
  assert.equal(n, 2);
});

test('OpenAI images go at low detail, Claude replies are capped short', () => {
  const o = JSON.parse(buildRequest({ provider: 'openAI', apiKey: 'k', model: 'm', prompt: 'p', images: IMG }).init.body);
  assert.equal(o.messages[0].content[1].image_url.detail, 'low');
  const c = JSON.parse(buildRequest({ provider: 'claude', apiKey: 'k', model: 'm', prompt: 'p' }).init.body);
  assert.equal(c.max_tokens, 2048);
});

test('compact inventory replies become items with canonical ids', () => {
  const items = parseInventory('{"have":["paneer","air_fryer","made_up"],"other":["ketchup bottle"]}');
  assert.deepEqual(items.map((i) => [i.name, i.canonical, i.category]), [
    ['Paneer', 'paneer', 'food'], ['Air fryer', 'air_fryer', 'appliance'], ['made up', null, 'other'], ['ketchup bottle', null, 'other'],
  ]);
});

test('model chain prefers stable light models the key actually has', () => {
  assert.deepEqual(modelChain('gemini', 'gemini-3.5-flash-lite', ['gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview']),
    ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']); // Gemini: flash-lite only, no previews
  assert.equal(modelChain('claude', 'claude-haiku-4-5', []).length, 2);
});

test('designRecipes sends the inventory ids and returns raw recipes for the brain', async () => {
  const { impl, calls } = byModel({ '*': [200, { content: [{ type: 'text', text: '{"recipes":[{"name":"x"}]}' }] }] });
  const r = await designRecipes({ provider: 'claude', apiKey: 'k', model: 'claude-haiku-4-5', have: ['paneer', 'air_fryer'], context: { kind: 'meal', mood: 'tired' }, fetchImpl: impl, backoffMs: [] });
  assert.equal(r.recipes.length, 1);
  const prompt = calls[0].body.messages[0].content.find((c) => c.type === 'text').text;
  assert.ok(prompt.includes('paneer') && prompt.includes('air_fryer'));
  assert.equal(calls[0].body.messages[0].content.filter((c) => c.type === 'image').length, 0);
});

test('scan sends photos in batches of 4 and merges what comes back', async () => {
  const photos = [1, 2, 3, 4, 5].map((n) => ({ base64: `P${n}`, mediaType: 'image/jpeg' }));
  const calls = [];
  const impl = (url, init) => {
    const datas = JSON.parse(init.body).contents[0].parts.slice(1).map((p) => p.inline_data.data);
    calls.push(datas);
    const text = datas[0] === 'P1' ? '{"have":["paneer","air_fryer"]}' : '{"have":["paneer","eggs"],"other":["ketchup"]}';
    return Promise.resolve(reply(200, GEMINI_OK(text)));
  };
  const items = await scanKitchen({ provider: 'gemini', apiKey: 'k', model: G[0], models: [G[0]], images: photos, fetchImpl: impl, deadlineMs: 500 });
  assert.deepEqual(calls.map((c) => c.length), [4, 1]);
  assert.deepEqual(items.map((i) => i.canonical ?? i.name), ['paneer', 'air_fryer', 'eggs', 'ketchup']);
  assert.equal(items.photosRead, 5);
});

test('a slow Gemini reply is re-sent to the same model, and the first copy back wins', async () => {
  let n = 0;
  const impl = (url, init) => {
    n++;
    if (n === 1) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return new Promise((r) => setTimeout(() => r(reply(200, GEMINI_OK('{"have":["eggs"]}'))), 10));
  };
  const events = [];
  const items = await scanKitchen({ provider: 'gemini', apiKey: 'k', model: G[0], models: [G[0]], images: [{ base64: 'A', mediaType: 'image/jpeg' }], fetchImpl: impl, hedgeMs: 50, deadlineMs: 1000, onEvent: (e) => events.push(e) });
  assert.equal(items[0].canonical, 'eggs');
  assert.deepEqual(events.filter((e) => e.stage === 'sent').map((e) => e.model), [G[0], G[0]]);
});

test('scan fails only when no photo at all could be read', async () => {
  const photos = [1, 2].map((n) => ({ base64: `P${n}`, mediaType: 'image/jpeg' }));
  const { impl } = byModel({ '*': [503, {}, 5] });
  await assert.rejects(scanKitchen({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, images: photos, fetchImpl: impl, deadlineMs: 500 }),
    (e) => e.kind === 'overloaded');
});

test('a silent model gets a second model alongside it after the hedge delay', async () => {
  const { impl, calls } = byModel({ [G[0]]: [200, {}, Infinity], '*': [200, GEMINI_OK('{"have":["eggs"]}'), 5] });
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: G[0], models: G, prompt: 'p', fetchImpl: impl, parallel: 1, hedgeMs: 50, deadlineMs: 1000 });
  assert.notEqual(r.model, G[0]);
  assert.equal(calls.length, 2);
});

test('once one photo group is in, a straggling group only gets a short grace period', async () => {
  const photos = [1, 2, 3, 4, 5].map((n) => ({ base64: `P${n}`, mediaType: 'image/jpeg' }));
  const impl = (url, init) => {
    const first = JSON.parse(init.body).contents[0].parts[1].inline_data.data;
    if (first === 'P5') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
    return Promise.resolve(reply(200, GEMINI_OK('{"have":["paneer"]}')));
  };
  const t0 = Date.now();
  const items = await scanKitchen({ provider: 'gemini', apiKey: 'k', model: G[0], models: [G[0]], images: photos, fetchImpl: impl, deadlineMs: 5000, graceMs: 100, hedgeMs: 0 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(items.photosRead, 4);
});
