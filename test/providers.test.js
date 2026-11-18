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
function scripted(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const [status, body] = responses[Math.min(calls.length - 1, responses.length - 1)];
    return { status, ok: status === 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, calls };
}

test('503 "high demand" is retried, then succeeds on the same model', async () => {
  const { impl, calls } = scripted([[503, { error: { message: 'This model is currently experiencing high demand.' } }], [200, GEMINI_OK('{"items":[]}')]]);
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash', prompt: 'p', fetchImpl: impl, backoffMs: [0, 0] });
  assert.equal(r.model, 'gemini-2.5-flash');
  assert.equal(calls.length, 2);
});

test('a model that stays overloaded hands over to another model', async () => {
  const { impl, calls } = scripted([[503, {}], [503, {}], [503, {}], [200, GEMINI_OK('{"items":[]}')]]);
  const statuses = [];
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: 'gemini-3.5-flash-lite', models: ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    prompt: 'p', fetchImpl: impl, backoffMs: [0, 0], onStatus: (s) => statuses.push(s) });
  assert.equal(r.model, 'gemini-2.5-flash');
  assert.ok(calls[3].url.includes('gemini-2.5-flash:'));
  assert.ok(statuses.some((s) => s.includes('instead')));
});

test('when every model is overloaded the error says which were tried', async () => {
  const { impl } = scripted([[503, {}]]);
  await assert.rejects(callModel({ provider: 'gemini', apiKey: 'k', model: 'gemini-2.5-flash', prompt: 'p', fetchImpl: impl, backoffMs: [0] }),
    (e) => e.kind === 'overloaded' && e.detail.includes('tried gemini-2.5-flash'));
});

test('a rejected key is not retried', async () => {
  const { impl, calls } = scripted([[401, {}]]);
  await assert.rejects(callModel({ provider: 'claude', apiKey: 'k', model: 'claude-haiku-4-5', prompt: 'p', fetchImpl: impl, backoffMs: [0, 0] }), (e) => e.kind === 'invalidKey');
  assert.equal(calls.length, 1);
});

test('a hung request times out and moves on instead of sticking on "Looking…"', async () => {
  let n = 0;
  const impl = (url, init) => {
    n++;
    if (n === 1) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return Promise.resolve({ status: 200, ok: true, json: async () => GEMINI_OK('{"items":[]}'), text: async () => '' });
  };
  const r = await callModel({ provider: 'gemini', apiKey: 'k', model: 'gemini-3.5-flash-lite', models: ['gemini-3.5-flash-lite', 'gemini-2.5-flash'], prompt: 'p', fetchImpl: impl, timeoutMs: 50, backoffMs: [0] });
  assert.equal(r.model, 'gemini-2.5-flash');
});

test('Gemini thinking is turned down, and dropped if the model rejects it', async () => {
  const body = (m) => JSON.parse(buildRequest({ provider: 'gemini', apiKey: 'k', model: m, prompt: 'p' }).init.body).generationConfig;
  assert.deepEqual(body('gemini-2.5-flash').thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual(body('gemini-3.5-flash-lite').thinkingConfig, { thinkingLevel: 'low' });
  assert.equal(body('gemini-1.5-flash').thinkingConfig, undefined);
  const { impl, calls } = scripted([[400, {}], [200, GEMINI_OK('{"items":[]}')]]);
  await callModel({ provider: 'gemini', apiKey: 'k', model: 'gemini-3.5-flash-lite', prompt: 'p', fetchImpl: impl, backoffMs: [0] });
  assert.ok(calls[0].body.generationConfig.thinkingConfig);
  assert.equal(calls[1].body.generationConfig.thinkingConfig, undefined);
});

test('model chain prefers stable light models the key actually has', () => {
  assert.deepEqual(modelChain('gemini', 'gemini-3.5-flash-lite', ['gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash-exp']),
    ['gemini-3.5-flash-lite', 'gemini-2.5-flash']);
  assert.equal(modelChain('claude', 'claude-haiku-4-5', []).length, 2);
});

test('designRecipes sends the inventory ids and returns raw recipes for the brain', async () => {
  const { impl, calls } = scripted([[200, { content: [{ type: 'text', text: '{"recipes":[{"name":"x"}]}' }] }]]);
  const r = await designRecipes({ provider: 'claude', apiKey: 'k', model: 'claude-haiku-4-5', have: ['paneer', 'air_fryer'], context: { kind: 'meal', mood: 'tired' }, fetchImpl: impl, backoffMs: [] });
  assert.equal(r.recipes.length, 1);
  const prompt = calls[0].body.messages[0].content.find((c) => c.type === 'text').text;
  assert.ok(prompt.includes('paneer') && prompt.includes('air_fryer'));
  assert.equal(calls[0].body.messages[0].content.filter((c) => c.type === 'image').length, 0);
});
