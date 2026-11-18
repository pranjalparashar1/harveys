// The page. Wires the AI (perceive) to the brain (decide). All decisions come
// from src/brain/; this file only gathers input and renders output.

import {
  CATALOGUE, DEFAULT_CONFIG, PROVISIONAL, ASSUMED_BASICS,
  buildInventory, kindOf, labelFor, rank, describeMissing,
} from './brain/index.js';
import { PROVIDERS, DEFAULT_MODEL, FALLBACK_MODELS, detectProvider, checkKey, pickModel, scanKitchen, designRecipes, AIError } from './ai/providers.js';
import { prepareImage } from './ai/images.js';
import { validateMeal } from './brain/validate.js';
import { DEMO_KITCHEN } from './demo-kitchen.js';

const MAX_PHOTOS = 8;
const $ = (id) => document.getElementById(id);

// ── Storage (this browser only) ─────────────────────────────────────────────
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`marco.${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`marco.${key}`);
      else localStorage.setItem(`marco.${key}`, JSON.stringify(value));
    } catch { /* private mode: keep working in memory */ }
  },
};

const state = {
  ai: store.get('ai', null), // { apiKey, provider, model, models }
  photos: [], // { base64, mediaType, previewUrl }
  items: store.get('inventory', []), // [{ name, canonical, category, source }]
  missingBasics: store.get('missingBasics', []),
  ctx: { mood: 'tired', kind: 'meal', when: 'now', targets: { protein: 40, calories: 800, fiber: 15 }, ...store.get('context', {}) },
  decided: false,
  aiRecipes: { status: 'idle', accepted: [], rejected: [], model: null, error: null, key: null },
};

// ── Tiny DOM helper (text only, so AI output can never inject markup) ──────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const show = (el, on = true) => { el.hidden = !on; };
const fmt = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString();

// ── 1 · Key ─────────────────────────────────────────────────────────────────
function renderKey() {
  const key = $('api-key').value.trim();
  const provider = detectProvider(key);
  const saved = state.ai && state.ai.apiKey === key;
  $('detected').replaceChildren(
    key
      ? provider
        ? h('span', {}, 'Detected ', h('strong', {}, PROVIDERS[provider].label), saved ? ' · saved in this browser' : '')
        : h('span', {}, "That doesn't look like a Claude, OpenAI or Gemini key.")
      : h('span', {}, 'Get a key: ',
          ...Object.values(PROVIDERS).flatMap((p, i) => [i ? ' · ' : '', h('a', { href: p.keysUrl, target: '_blank', rel: 'noopener' }, p.label)])),
  );
  $('save-key').disabled = !provider;
  show($('forget-key'), !!state.ai);
  show($('model-field'), !!(saved && provider));
  if (saved && provider) {
    const models = state.ai.models?.length ? state.ai.models : FALLBACK_MODELS[provider];
    const list = models.includes(state.ai.model) ? models : [state.ai.model, ...models];
    $('model').replaceChildren(...list.map((m) => h('option', { value: m, selected: m === state.ai.model }, m)));
  }
  const status = $('key-status');
  status.textContent = state.ai ? `${PROVIDERS[state.ai.provider].label} ready` : 'No key';
  status.classList.toggle('ok', !!state.ai);
  renderScanButton();
}

async function saveKey() {
  const apiKey = $('api-key').value.trim();
  const provider = detectProvider(apiKey);
  if (!provider) return;
  const err = $('key-error');
  show(err, false);
  $('save-key').disabled = true;
  $('save-key').textContent = 'Checking…';
  try {
    const models = await checkKey({ provider, apiKey });
    state.ai = { apiKey, provider, models, model: pickModel(provider, models) };
  } catch (e) {
    if (e instanceof AIError && e.kind === 'invalidKey') {
      err.textContent = e.message;
      show(err);
      state.ai = null;
    } else {
      // Offline or CORS hiccup on /models: keep the key and use Cals' default model.
      state.ai = { apiKey, provider, models: [], model: DEFAULT_MODEL[provider] };
      err.textContent = "Couldn't confirm the key right now, but it's saved. The scan will tell us if it works.";
      show(err);
    }
  } finally {
    $('save-key').textContent = 'Save and check key';
    store.set('ai', state.ai);
    renderKey();
  }
}

function forgetKey() {
  state.ai = null;
  store.set('ai', null);
  $('api-key').value = '';
  show($('key-error'), false);
  renderKey();
}

// ── 2 · Photos ──────────────────────────────────────────────────────────────
function renderThumbs() {
  $('thumbs').replaceChildren(...state.photos.map((p, i) =>
    h('li', {},
      h('img', { src: p.previewUrl, alt: `Photo ${i + 1}` }),
      h('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { state.photos.splice(i, 1); renderThumbs(); } }, '×'))));
  renderScanButton();
}

function renderScanButton() {
  const btn = $('scan');
  const n = state.photos.length;
  btn.disabled = !state.ai || n === 0;
  btn.textContent = !state.ai ? 'Add a key to scan' : n ? `Scan ${n} photo${n === 1 ? '' : 's'}` : 'Scan photos';
}

async function addPhotos(fileList) {
  // Copy first: the caller resets the <input>, which can empty a live FileList on iOS.
  const files = Array.from(fileList ?? []);
  const err = $('scan-error');
  const status = $('photo-status');
  show(err, false);
  if (!files.length) return;
  const room = MAX_PHOTOS - state.photos.length;
  const take = files.slice(0, Math.max(0, room));
  const problems = [];
  for (const [i, file] of take.entries()) {
    status.textContent = `Preparing photo ${i + 1} of ${take.length}…`;
    try {
      state.photos.push(await prepareImage(file));
      renderThumbs();
    } catch (e) {
      problems.push(e.message);
    }
  }
  status.textContent = '';
  if (files.length > take.length) problems.push(`Marco sends up to ${MAX_PHOTOS} photos at once, so ${files.length - take.length} were left out.`);
  if (problems.length) {
    err.textContent = problems.join(' ');
    show(err);
  }
  renderThumbs();
}

function explainError(e) {
  if (!(e instanceof AIError)) return `Something went wrong: ${e.message}`;
  let text = e.message;
  if (e.kind === 'overloaded' || e.kind === 'rateLimited' || e.kind === 'timeout') {
    text += ' Marco retried and tried other models first. The sample kitchen still works meanwhile.';
  }
  if (e.detail) text += ` (${e.detail.replace(/\s+/g, ' ').slice(0, 220)})`;
  return text;
}

async function scan() {
  const btn = $('scan');
  const err = $('scan-error');
  const status = $('photo-status');
  show(err, false);
  btn.disabled = true;
  const started = Date.now();
  let phase = 'Looking…';
  const tick = setInterval(() => { btn.textContent = `${phase} ${Math.round((Date.now() - started) / 1000)} s`; }, 500);
  try {
    const items = await scanKitchen({
      ...state.ai,
      images: state.photos,
      onStatus: (s) => { phase = 'Looking…'; status.textContent = s; },
    });
    setItems(items.map((i) => ({ ...i, source: 'ai' })));
    status.textContent = `Found ${items.length} things with ${items.model}.`;
    if (items.model !== state.ai.model) {
      status.textContent += ` ${state.ai.model} was busy, so Marco switched to ${items.model}.`;
      useWorkingModel(items.model);
    }
    $('step-inventory').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    status.textContent = '';
    err.textContent = explainError(e);
    show(err);
  } finally {
    clearInterval(tick);
    renderScanButton();
  }
}

// ── 3 · Inventory ───────────────────────────────────────────────────────────
function setItems(items) {
  state.items = items;
  store.set('inventory', items);
  renderInventory();
  if (state.decided) decide();
}

function inventory() {
  return buildInventory(state.items, { missingBasics: state.missingBasics });
}

function renderInventory() {
  const has = state.items.length > 0;
  show($('step-inventory'), has);
  show($('step-context'), has);
  if (!has) return;
  const groups = { food: [], kit: [], other: [] };
  state.items.forEach((item, index) => {
    const id = buildInventory([item]).matched[0]?.id ?? null;
    const kind = id ? kindOf(id) : null;
    const bucket = kind === 'food' ? 'food' : kind ? 'kit' : 'other';
    groups[bucket].push({ item, index, id });
  });
  const titles = { food: 'Food', kit: 'Appliances, cookware and utensils', other: "Spotted, but Marco can't cook with it yet" };
  $('inventory-groups').replaceChildren(...Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) =>
    h('div', { class: 'group' },
      h('h3', {}, `${titles[key]} · ${list.length}`),
      h('div', { class: 'chips' }, list.map(({ item, index, id }) =>
        h('span', { class: `chip${id ? '' : ' unknown'}`, title: id ? `Counts as: ${labelFor(id)}` : 'Not in Marco’s vocabulary yet' },
          item.name,
          item.quantity ? h('small', {}, ` · ${item.quantity}`) : null,
          h('button', { type: 'button', 'aria-label': `Remove ${item.name}`, onclick: () => setItems(state.items.filter((_, i) => i !== index)) }, '×')))))));
  const usable = groups.food.length + groups.kit.length;
  $('inv-count').textContent = `${usable} usable`;
  $('basics').replaceChildren(...Object.entries(ASSUMED_BASICS).map(([id, b]) => {
    const off = state.missingBasics.includes(id);
    return h('span', {
      class: `chip toggle${off ? ' off' : ''}`, role: 'checkbox', 'aria-checked': String(!off), tabindex: '0',
      onclick: () => toggleBasic(id),
      onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleBasic(id); } },
    }, b.label);
  }));
}

function toggleBasic(id) {
  state.missingBasics = state.missingBasics.includes(id) ? state.missingBasics.filter((x) => x !== id) : [...state.missingBasics, id];
  store.set('missingBasics', state.missingBasics);
  renderInventory();
  if (state.decided) decide();
}

// ── 4 · Context ─────────────────────────────────────────────────────────────
const WHEN = {
  'weekday-evening': { hour: 19, weekday: 2 },
  'weekday-late': { hour: 22, weekday: 2 },
  'weekend-lunch': { hour: 13, weekday: 0 },
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function moment() {
  if (WHEN[state.ctx.when]) return WHEN[state.ctx.when];
  const now = new Date();
  return { hour: now.getHours(), weekday: now.getDay() };
}

function renderContext() {
  for (const group of ['mood', 'kind']) {
    for (const b of $(group).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.ctx[group]));
  }
  $('when').value = state.ctx.when;
  const m = moment();
  const hour12 = `${((m.hour + 11) % 12) + 1} ${m.hour < 12 ? 'am' : 'pm'}`;
  $('when-detail').textContent = state.ctx.when === 'now' ? `${DAYS[m.weekday]}, around ${hour12}` : '';
  $('t-protein').value = state.ctx.targets.protein;
  $('t-calories').value = state.ctx.targets.calories;
  $('t-fiber').value = state.ctx.targets.fiber;
}

function updateCtx(patch) {
  state.ctx = { ...state.ctx, ...patch };
  store.set('context', state.ctx);
  renderContext();
  if (state.decided) decide();
}

// ── 5 · Decide and explain ──────────────────────────────────────────────────
function decide() {
  state.decided = true;
  const result = rank({
    inventory: inventory(),
    targets: state.ctx.targets,
    context: { mood: state.ctx.mood, kind: state.ctx.kind, ...moment() },
    // The AI's recipes compete on exactly the same terms as the catalogue.
    catalogue: [...CATALOGUE, ...state.aiRecipes.accepted],
    config: DEFAULT_CONFIG,
  });
  renderResult(result);
}

// ── AI-designed recipes (proof of concept) ─────────────────────────────────
// The AI proposes; validateMeal() and the ranker dispose. A recipe the AI
// designs can only be suggested if it passes both, and then only if it scores
// best.
function recipeKey() {
  return JSON.stringify([[...inventory().have].sort(), state.ctx.kind, state.ctx.mood, state.missingBasics]);
}

async function askAIForRecipes(force = false) {
  if (!state.ai) return;
  const key = recipeKey();
  if (!force && state.aiRecipes.key === key && state.aiRecipes.status !== 'error') return;
  const inv = inventory();
  state.aiRecipes = { status: 'loading', accepted: [], rejected: [], model: null, error: null, key, note: 'Asking your AI to design recipes…' };
  decide();
  try {
    const { recipes, model } = await designRecipes({
      ...state.ai,
      have: [...inv.have],
      context: { kind: state.ctx.kind, mood: state.ctx.mood },
      onStatus: (note) => { state.aiRecipes.note = note; renderAIStatus(); },
    });
    if (state.aiRecipes.key !== key) return; // inputs changed while waiting
    const accepted = [];
    const rejected = [];
    recipes.forEach((raw, index) => {
      const v = validateMeal(raw, { index, kind: state.ctx.kind });
      if (v.ok) accepted.push({ ...v.meal, adjustments: v.adjustments });
      else rejected.push({ name: v.meal?.name || raw?.name || `Recipe ${index + 1}`, reasons: v.errors });
    });
    state.aiRecipes = { status: 'done', accepted, rejected, model, error: null, key };
    useWorkingModel(model);
  } catch (e) {
    if (state.aiRecipes.key !== key) return;
    state.aiRecipes = { status: 'error', accepted: [], rejected: [], model: null, error: explainError(e), key };
  }
  decide();
}

/** After a fallback, keep using the model that answered so the next call is fast. */
function useWorkingModel(model) {
  if (!state.ai || !model || model === state.ai.model) return;
  state.ai.model = model;
  store.set('ai', state.ai);
  renderKey();
}

function renderAIStatus() {
  const el = document.querySelector('#ai-ideas .ai-note');
  if (el && state.aiRecipes.status === 'loading') el.textContent = state.aiRecipes.note;
}

function aiIdeasCard(result) {
  const ai = state.aiRecipes;
  if (!state.ai) {
    return h('section', { class: 'card', id: 'ai-ideas' },
      h('h2', {}, "Your AI's recipe ideas"),
      h('p', { class: 'hint' }, 'Add an API key above and your AI will also design recipes from what you have. Marco checks and scores them like any other meal.'));
  }
  const head = [h('h2', {}, "Your AI's recipe ideas"),
    h('p', { class: 'hint' }, 'Your AI designs recipes from your inventory. Marco rejects any that use things you don’t have or don’t add up, then scores the rest against its own catalogue. The AI never picks.')];
  if (ai.status === 'loading' || ai.status === 'idle') {
    return h('section', { class: 'card', id: 'ai-ideas' }, head, h('p', { class: 'ai-note muted' }, ai.note || 'Asking your AI to design recipes…'));
  }
  if (ai.status === 'error') {
    return h('section', { class: 'card', id: 'ai-ideas' }, head,
      h('p', { class: 'error' }, ai.error),
      h('button', { class: 'btn', type: 'button', onclick: () => askAIForRecipes(true) }, 'Try again'));
  }
  const position = new Map(result.ranked.map((r, i) => [r.meal.id, i + 1]));
  const blocked = new Map(result.filtered.map((f) => [f.meal.id, f.missing]));
  const rows = [
    ...ai.accepted.map((m) => {
      const pos = position.get(m.id);
      const missing = blocked.get(m.id);
      const verdict = pos
        ? h('span', { class: pos === 1 ? 'pass win' : 'pass' }, pos === 1 ? 'Passed · Marco’s pick' : `Passed · ranked #${pos}`)
        : missing
          ? h('span', { class: 'fail' }, `Rejected · needs ${describeMissing(missing).join(', ')}`)
          : h('span', { class: 'muted' }, 'Not a ' + state.ctx.kind);
      return h('li', {},
        h('div', { class: 'other-head' }, h('strong', {}, m.name), verdict),
        m.adjustments?.length ? h('p', { class: 'mini' }, `Marco corrected: ${[...new Set(m.adjustments)].join('; ')}.`) : null);
    }),
    ...ai.rejected.map((r) => h('li', {},
      h('div', { class: 'other-head' }, h('strong', {}, r.name), h('span', { class: 'fail' }, 'Rejected')),
      h('p', { class: 'mini' }, `Because ${r.reasons.join('; ')}.`))),
  ];
  return h('section', { class: 'card', id: 'ai-ideas' }, head,
    rows.length ? h('ul', { class: 'others' }, rows) : h('p', { class: 'muted' }, 'Your AI returned no recipes.'),
    h('p', { class: 'mini' }, `Designed by ${ai.model}. `, h('button', { class: 'btn link', type: 'button', onclick: () => askAIForRecipes(true) }, 'Ask for new ideas')));
}

function ingredientLine(ing) {
  return h('li', {}, labelFor(ing.id), ' ', h('small', {}, `· ${ing.amount}`), ing.optional ? h('small', {}, ' (optional, you have it)') : null);
}

function whyTable(r) {
  const payRows = r.payoff.parts.map((p) =>
    h('tr', {}, h('td', {}, `${p.amount} ${p.unit}`), h('td', { class: 'num' }, `${Math.round(p.progress * 100)}% of what's left`), h('td', { class: 'num' }, `+${fmt(p.value)}`)));
  const fricRows = r.frictionParts.map((p) =>
    h('tr', {}, h('td', {}, p.label), h('td', { class: 'num' }, `${fmt(p.raw, 1)} → ${fmt(p.normalised)}`), h('td', { class: 'num' }, `${fmt(p.value)}`)));
  return h('details', { class: 'why' },
    h('summary', {}, 'Why this score'),
    h('p', { class: 'formula' }, `score = payoff − λ × friction = ${fmt(r.payoff.value)} − ${fmt(r.lambda.value)} × ${fmt(r.friction)} = ${fmt(r.score)}`),
    h('h3', {}, 'Payoff'),
    h('table', { class: 'parts' }, h('tbody', {}, payRows)),
    r.payoff.confidence < 1 ? h('p', { class: 'mini' }, `Macros are ${r.meal.source === 'ai' ? 'an AI guess' : 'an estimate'}, so payoff counts at ${Math.round(r.payoff.confidence * 100)}%.`) : null,
    h('h3', {}, 'Friction (raw → 0–1, × weight)'),
    h('table', { class: 'parts' }, h('tbody', {}, fricRows)),
    h('h3', {}, 'λ, how much effort costs right now'),
    h('p', { class: 'mini' }, r.lambda.parts.map((p) => `${p.name} ×${p.factor}`).join(' · '), ` = ${fmt(r.lambda.value)}`),
    PROVISIONAL ? h('p', { class: 'mini' }, h('span', { class: 'badge' }, 'Placeholder weights'), ' All weights are equal until they are fitted to your meal log (src/brain/config.js).') : null);
}

function renderResult(result) {
  const root = $('result');
  show(root);
  const [top, ...rest] = result.ranked;
  const cards = [];

  if (!top) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'Nothing Marco knows fits yet'),
      h('p', { class: 'hint' }, 'Add a few more items, or check the small kit list. Here is what blocked the closest meals:'),
      blockedList(result.filtered.slice(0, 6))));
  } else {
    const passive = top.raw.passiveMinutes;
    cards.push(h('section', { class: 'card pick' },
      h('p', { class: 'pick-label' }, top.meal.origin === 'ai' ? 'Cook this · designed by your AI, chosen by Marco' : 'Cook this'),
      h('h2', {}, top.meal.name),
      h('div', { class: 'reasons' }, top.reasons.map((r) => h('span', {}, r))),
      top.beats ? h('p', { class: 'beats' }, 'Beats ', h('strong', {}, top.beats.other.name), ': ', top.beats.reasons.join(', ') || 'a better balance of payoff and effort', '.') : null,
      h('div', { class: 'recipe' },
        h('h3', {}, 'You need'),
        h('ul', {}, top.used.ingredients.map(ingredientLine)),
        h('h3', {}, 'Kit'),
        h('p', { class: 'muted' }, [...top.used.equipment, ...top.used.utensils].map(labelFor).join(', ') || 'Nothing'),
        h('h3', {}, `Steps · about ${fmt(top.raw.activeMinutes, 1)} min hands-on${passive ? ` + ${passive} min waiting` : ''}`),
        h('ol', {}, top.meal.steps.map((s) => h('li', {}, s.text))),
        h('p', { class: 'mini' }, `${top.meal.macros.protein} g protein · ${top.meal.macros.kcal} kcal · ${top.meal.macros.fiber} g fiber (${{ label: 'from labels', ai: 'AI estimate', estimate: 'estimate' }[top.meal.source] ?? 'estimate'})`)),
      whyTable(top)));
  }

  if (rest.length) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'Also possible'),
      h('ul', { class: 'others' }, rest.slice(0, 6).map((r, i) =>
        h('li', {},
          h('div', { class: 'other-head' }, h('strong', {}, `${i + 2}. ${r.meal.name}`, r.meal.origin === 'ai' ? h('span', { class: 'badge ai' }, 'AI') : null), h('span', { class: 'score' }, `score ${fmt(r.score)}`)),
          h('p', { class: 'mini' }, r.reasons.join(' · ')),
          whyTable(r))))));
  }

  cards.push(aiIdeasCard(result));

  if (result.unlocks.length) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'One thing to buy'),
      result.unlocks.map((u) => h('p', { class: 'unlock' }, 'Get ', h('strong', {}, u.label.toLowerCase()), ` and you unlock ${u.meals.length} more: `, h('span', { class: 'muted' }, u.meals.join(', '))))));
  }

  const blockedCatalogue = result.filtered.filter((f) => f.meal.origin !== 'ai');
  if (top && blockedCatalogue.length) {
    cards.push(h('section', { class: 'card' },
      h('details', {}, h('summary', {}, `Skipped ${blockedCatalogue.length} meals you can't make right now`), blockedList(blockedCatalogue))));
  }

  root.replaceChildren(...cards);
}

function blockedList(filtered) {
  return h('ul', { class: 'others' }, filtered.map((f) =>
    h('li', {}, h('strong', {}, f.meal.name), h('p', { class: 'mini' }, `Missing: ${describeMissing(f.missing).join(', ')}`))));
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function init() {
  if (state.ai) $('api-key').value = state.ai.apiKey;
  $('api-key').addEventListener('input', renderKey);
  $('save-key').addEventListener('click', saveKey);
  $('forget-key').addEventListener('click', forgetKey);
  $('model').addEventListener('change', (e) => { state.ai.model = e.target.value; store.set('ai', state.ai); });

  for (const id of ['photo-input', 'camera-input']) {
    $(id).addEventListener('change', async (e) => {
      const files = Array.from(e.target.files ?? []);
      await addPhotos(files);
      e.target.value = ''; // reset only after reading, so the same photo can be picked again
    });
  }
  $('scan').addEventListener('click', scan);
  $('use-demo').addEventListener('click', () => {
    setItems(DEMO_KITCHEN.map((i) => ({ ...i, source: 'demo' })));
    $('step-inventory').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('add-input').value.trim();
    if (!name) return;
    setItems([...state.items, { name, canonical: null, category: 'other', source: 'manual' }]);
    $('add-input').value = '';
  });

  for (const group of ['mood', 'kind']) {
    $(group).addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.value;
      if (v) updateCtx({ [group]: v });
    });
  }
  $('when').addEventListener('change', (e) => updateCtx({ when: e.target.value }));
  for (const [id, key] of [['t-protein', 'protein'], ['t-calories', 'calories'], ['t-fiber', 'fiber']]) {
    $(id).addEventListener('change', (e) => updateCtx({ targets: { ...state.ctx.targets, [key]: Math.max(0, Number(e.target.value) || 0) } }));
  }
  $('decide').addEventListener('click', () => {
    decide();
    askAIForRecipes();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  renderKey();
  renderThumbs();
  renderInventory();
  renderContext();
}

init();
