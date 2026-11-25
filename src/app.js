// The page. Wires the AI (perceive) to the brain (decide). All decisions come
// from src/brain/; this file only gathers input and renders output.

import {
  CATALOGUE, DEFAULT_CONFIG, PROVISIONAL, ASSUMED_BASICS,
  buildInventory, parseItemList, kindOf, labelFor, rank, describeMissing,
  PIERRE_SEED, cookLogEntry, liveRepairEntry, liveVerdicts, soakNeeds,
  importKitchens, looksLikeKitchenJson, classifyPrompt, parseClassification,
} from './brain/index.js';
import { PROVIDERS, DEFAULT_MODEL, FALLBACK_MODELS, allowedModels, detectProvider, checkKey, pickModel, scanKitchen, designRecipes, callModel, AIError } from './ai/providers.js';
import { prepareImage } from './ai/images.js';
import { validateMeal } from './brain/validate.js';
import { DEMO_KITCHEN } from './demo-kitchen.js';
import { startRungQuiz, startKitchenPicker } from './rung-quiz-ui.js';
import { buildRungQuiz, levelBelow } from './brain/rung-quiz.js';
import { decodeKitchen, linkCode, linkName } from './brain/share-link.js';
import { startFresh, reloadIfStale } from './fresh.js';

const VERSION = '1.55.0';
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

function savedContext() {
  const { mood, ...rest } = store.get('context', {}); // drop a mood saved by 1.3 or earlier
  return rest;
}

// What's soaking or soaked (1.21.0) holds for today only: a tick from last night is gone by morning.
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function soakedToday() {
  const saved = store.get('soaked', null);
  return saved?.day === today() && Array.isArray(saved.ids) ? saved.ids : [];
}

const state = {
  ai: store.get('ai', null), // { apiKey, provider, model, models }
  photos: [], // { base64, mediaType, previewUrl }
  // Not restored on reload: every page load starts clean (demo-ready).
  items: [], // [{ name, canonical, category, source }]
  pantry: store.get('pantry', {}), // flash-lite profiles of names Harvey's didn't know (1.29.0), kept
  missingBasics: store.get('missingBasics', []),
  soaked: soakedToday(),
  // No mood: 1.3.2 doesn't ask, so the ranker's λ is neutral on mood (see contextLambda).
  ctx: { kind: 'meal', when: 'now', targets: { protein: 40, calories: 800, fiber: 15 }, ...savedContext() },
  decided: false,
  debug: store.get('debugRuns', []),
  aiRecipes: { status: 'idle', accepted: [], rejected: [], model: null, error: null, key: null },
  // White v2 live learning (Step 5B). Both survive reloads; Debug's "Copy for Claude" carries them.
  cookLog: store.get('cookLog', []),
  liveRepairs: store.get('liveRepairs', []),
  cookedNow: new Set(), // dishes logged since this page loaded, for the "Logged" state
  fixing: null, // the dish id whose Fix / Veto drawer is open
  result: null,
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
/** Sets a button's text without removing its haptic switch. */
const setLabel = (btn, text) => { (btn.querySelector('.lbl') ?? btn).textContent = text; };
const fmt = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString();

// ── 1 · Key ─────────────────────────────────────────────────────────────────
let editingKey = false;

function renderKey() {
  const collapsed = !!state.ai && !editingKey;
  show($('key-saved'), collapsed);
  show($('key-edit'), !collapsed);
  if (state.ai) {
    $('key-name').textContent = PROVIDERS[state.ai.provider].label.replace(/ \(.*\)$/, '');
    const models = allowedModels(state.ai.provider, state.ai.models);
    const list = models.includes(state.ai.model) ? models : [state.ai.model, ...models];
    $('model').replaceChildren(...list.map((m) => h('option', { value: m, selected: m === state.ai.model }, m)));
  }
  const key = $('api-key').value.trim();
  const provider = detectProvider(key);
  $('detected').textContent = key ? (provider ? PROVIDERS[provider].label : 'Not a Claude, OpenAI or Gemini key') : '';
  $('detected').classList.toggle('ok', !!provider);
  $('save-key').disabled = !provider;
  show($('forget-key'), !!state.ai);
  show($('cancel-key'), !!state.ai);
  renderScanButton();
}

function disarmForget() {
  clearTimeout(forgetArmed);
  forgetArmed = null;
  $('forget-key').textContent = 'Forget key';
  $('forget-key').classList.remove('armed');
}

function editKey() {
  editingKey = true;
  show($('key-error'), false);
  renderKey();
  $('api-key').focus();
}

async function saveKey() {
  const apiKey = $('api-key').value.trim();
  const provider = detectProvider(apiKey);
  if (!provider) return;
  const err = $('key-error');
  show(err, false);
  $('save-key').disabled = true;
  setLabel($('save-key'), 'Checking…');
  try {
    const models = await checkKey({ provider, apiKey });
    state.ai = { apiKey, provider, models, model: pickModel(provider, allowedModels(provider, models)) };
    editingKey = false;
  } catch (e) {
    if (e instanceof AIError && e.kind === 'invalidKey') {
      err.textContent = e.message;
      show(err);
      state.ai = null;
    } else {
      // Offline or CORS hiccup on /models: keep the key and use Cals' default model.
      state.ai = { apiKey, provider, models: [], model: DEFAULT_MODEL[provider] };
      editingKey = false;
      err.textContent = "Saved, but couldn't confirm the key yet.";
      show(err);
    }
  } finally {
    setLabel($('save-key'), 'Save');
    store.set('ai', state.ai);
    renderKey();
  }
}

let forgetArmed = null;
function forgetKey() {
  // Destructive, so tap twice (no modal): the label asks once, for 4 s.
  const btn = $('forget-key');
  if (!forgetArmed) {
    btn.textContent = 'Tap again to forget';
    btn.classList.add('armed');
    forgetArmed = setTimeout(disarmForget, 4000);
    return;
  }
  disarmForget();
  state.ai = null;
  editingKey = false;
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
  setLabel(btn, n ? `Scan ${n} photo${n === 1 ? '' : 's'}` : 'Scan');
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
    status.textContent = 'Preparing…';
    try {
      const t = performance.now();
      const photo = await prepareImage(file);
      photo.prepMs = Math.round(performance.now() - t);
      state.photos.push(photo);
      renderThumbs();
    } catch (e) {
      problems.push(e.message);
    }
  }
  status.textContent = '';
  if (files.length > take.length) problems.push(`Up to ${MAX_PHOTOS} photos; ${files.length - take.length} left out.`);
  if (problems.length) {
    err.textContent = problems.join(' ');
    show(err);
  }
  renderThumbs();
}

/** Short, human error for the page. The full detail goes to the Debug panel. */
function explainError(e) {
  return e instanceof AIError ? e.message : `Something went wrong: ${e.message}`;
}

// Marco 1.2 time budget: a recipe on screen within 15 s of tapping Scan.
const SCAN_DEADLINE_MS = 12000;

async function scan() {
  const btn = $('scan');
  const err = $('scan-error');
  const status = $('photo-status');
  show(err, false);
  btn.disabled = true;
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const bytes = state.photos.reduce((a, p) => a + p.base64.length * 0.75, 0);
  const run = startDebugRun('scan', [
    { stage: 'photos ready', detail: `${state.photos.length} photo(s), ${Math.round(bytes / 1024)} KB to send, prepared in ${state.photos.map((p) => p.prepMs ?? '?').join(' + ')} ms` },
  ]);
  setLabel(btn, 'Looking…');
  btn.classList.add('shimmer');
  let source = 'ai';
  try {
    const items = await scanKitchen({
      ...state.ai,
      images: state.photos,
      deadlineMs: SCAN_DEADLINE_MS,
      onStatus: () => {}, // progress lives on the button; counts stay off screen
      onEvent: (e) => logDebug(run, debugEntry(e, since())),
    });
    logDebug(run, { stage: 'AI reply parsed', ms: since(), detail: `${items.length} items from ${items.photosRead} of ${items.photosTotal} photos (${items.model})` });
    setItems(items.map((i) => ({ ...i, source: 'ai' })));
    status.textContent = '';
  } catch (e) {
    logDebug(run, { stage: 'scan failed', ms: since(), detail: `${e.kind ?? 'error'}${e.status ? ` · HTTP ${e.status}` : ''} · ${String(e.detail ?? e.message).slice(0, 300)}` });
    err.textContent = explainError(e);
    show(err);
    status.textContent = '';
    // Fallback: never leave the page without a recipe.
    if (state.items.length) {
      source = 'last';
    } else {
      source = 'sample';
      setItems(DEMO_KITCHEN.map((i) => ({ ...i, source: 'demo' })));
    }
  } finally {
    btn.classList.remove('shimmer');
    renderScanButton();
  }
  // The pick comes from Marco's brain straight away; AI recipes upgrade it later.
  const tb = performance.now();
  decide({ source });
  logDebug(run, { stage: 'Marco picked', ms: since(), detail: `brain took ${Math.round(performance.now() - tb)} ms` });
  finishDebugRun(run, since());
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Only ask for recipe ideas when the AI is answering; otherwise it would just time out again.
  if (source === 'ai') askAIForRecipes();
}

// ── Debug panel: what each stage took, and the real error ──────────────────
/** One line per request event: when it was sent and how big, then how it ended. */
function debugEntry(e, at) {
  const who = [e.batch ? `group ${e.batch}` : null, e.model].filter(Boolean).join(' · ');
  if (e.stage === 'grace') return { stage: 'enough photos in', ms: at, detail: 'stopped waiting for the slowest photo' };
  if (e.stage === 'sent') return { stage: `${who} sent`, ms: at, detail: `${Math.round(e.bytes / 1024)} KB` };
  if (e.stage === 'model') {
    return { stage: `${who} ${e.ok ? 'answered' : 'failed'}`, ms: at,
      detail: e.ok ? `took ${(e.ms / 1000).toFixed(1)} s` : `${e.kind}${e.status ? ` · HTTP ${e.status}` : ''} after ${(e.ms / 1000).toFixed(1)} s${e.detail ? ` · ${e.detail}` : ''}` };
  }
  return { stage: `${who ? `${who} · ` : ''}deadline hit`, ms: at, detail: e.pending ? `${e.pending} request(s) still had no answer` : '' };
}
function startDebugRun(kind, entries = []) {
  const run = { kind, at: new Date().toLocaleTimeString(), entries: entries.map((e) => ({ ms: 0, ...e })), total: null };
  state.debug.unshift(run);
  state.debug = state.debug.slice(0, 4);
  renderDebug();
  return run;
}
function logDebug(run, entry) {
  run.entries.push(entry);
  renderDebug();
}
function saveDebug() {
  store.set('debugRuns', state.debug); // survives a reload, so a failed scan can still be copied
}
function finishDebugRun(run, total) {
  run.total = total;
  saveDebug();
  if (run.kind === 'scan') {
    const times = [...store.get('scanTimes', []), { ms: total, ok: !run.entries.some((e) => e.stage === 'scan failed'), at: Date.now() }].slice(-10);
    store.set('scanTimes', times);
  }
  renderDebug();
}
function renderDebug() {
  const box = $('debug-body');
  if (!box) return;
  const times = store.get('scanTimes', []);
  const sorted = times.map((t) => t.ms).sort((a, b) => a - b);
  const summary = times.length
    ? `Last ${times.length} scans to a recipe: typical ${(sorted[Math.floor((sorted.length - 1) / 2)] / 1000).toFixed(1)} s, slowest ${(sorted[sorted.length - 1] / 1000).toFixed(1)} s, ${times.filter((t) => t.ok).length} answered by the AI.`
    : 'No scans yet.';
  box.replaceChildren(
    h('p', { class: 'mini' }, summary),
    ...state.debug.map((run) => h('div', { class: 'debug-run' },
      h('h3', {}, `${run.kind === 'scan' ? 'Scan' : 'Recipe ideas'} at ${run.at}${run.total != null ? ` · ${(run.total / 1000).toFixed(1)} s total` : ' · running…'}`),
      h('table', { class: 'parts' }, h('tbody', {}, run.entries.map((e) =>
        h('tr', {}, h('td', {}, e.stage), h('td', { class: 'num' }, e.ms != null ? `${(e.ms / 1000).toFixed(1)} s` : ''), h('td', { class: 'dbg' }, e.detail ?? ''))))))),
  );
}
function copyDebug() {
  const text = JSON.stringify({ version: VERSION, ua: navigator.userAgent, conn: navigator.connection?.effectiveType ?? null, provider: state.ai?.provider, model: state.ai?.model, scanTimes: store.get('scanTimes', []), runs: state.debug, cookLog: state.cookLog, liveRepairs: state.liveRepairs }, null, 1);
  navigator.clipboard?.writeText(text).then(() => { $('copy-debug').textContent = 'Copied'; }, () => {});
}

// ── 3 · Inventory ───────────────────────────────────────────────────────────
function setItems(items) {
  state.items = items; // memory only, so a reload starts clean
  renderInventory();
  if (state.decided) decide();
  classifyUnknown();
}

// After "Use this list": what Harvey read, in two groups, before going on to the picks.
const KIT_CATEGORIES = new Set(['cookware', 'appliance', 'appliances', 'utensil', 'utensils', 'equipment', 'tool', 'tools']);
function showPasteSummary(items) {
  state.reviewingPaste = true;
  const food = [];
  const kit = [];
  for (const item of items) {
    let isKit = KIT_CATEGORIES.has(String(item.category ?? '').toLowerCase());
    if (!isKit) {
      const one = buildInventory([item], { cache: state.pantry });
      const id = one.matched[0]?.id;
      const extra = one.extras[0];
      isKit = id ? kindOf(id) !== 'food' : Boolean(extra && !one.unmatched.length && extra.kind !== 'food');
    }
    (isKit ? kit : food).push(item.name);
  }
  const tile = (n, label) => h('div', { class: 'tally' },
    h('span', { class: 'tally-n' }, String(n)),
    h('span', { class: 'tally-label' }, label));
  $('paste-groups').replaceChildren(
    tile(food.length, food.length === 1 ? 'food item' : 'food items'),
    tile(kit.length, 'cookware'));
  show($('paste-list'), false);
  show($('paste-summary'), true);
  show($('step-context'), false);
}

function endPasteReview() {
  state.reviewingPaste = false;
  show($('paste-summary'), false);
}

function inventory() {
  return buildInventory(state.items, { missingBasics: state.missingBasics, cache: state.pantry });
}

// Names nothing knows go to flash-lite once; the answer is cached in this browser for good.
let classifying = false;
async function classifyUnknown() {
  const names = inventory().unmatched.slice(0, 40);
  if (!names.length || classifying || !state.ai?.apiKey) return;
  classifying = true;
  try {
    const { text } = await callModel({ ...state.ai, prompt: classifyPrompt(names), deadlineMs: 12000, maxTokens: 3000, parallel: 1, copies: 2, hedgeMs: 3000 });
    const found = parseClassification(text);
    if (!Object.keys(found).length) return;
    state.pantry = { ...state.pantry, ...found };
    store.set('pantry', state.pantry);
    renderInventory();
    if (state.decided) decide();
  } catch {
    // Unknown names still count as plain extras; try again on the next change.
  } finally {
    classifying = false;
  }
}

// ── Ingredient check (?debug, 1.33.0) ──────────────────────────────────────
// The taste test's own dishes, so this is exactly what a tester would see. Each item listed
// is used (by which dishes) or not (each catalogue dish that names it, and why it's out).
let usageTab = 'unused';
let lastUsage = null;
const testKitchen = () => state.kitchen ?? { kitchen: 'Pasted list', items: state.items };
function renderUsage() {
  const card = $('usage');
  if (!card || document.body.classList.contains('testing')) return;
  show(card, state.items.length > 0);
  if (!state.items.length) return;
  const quiz = buildRungQuiz({ kitchen: { ...testKitchen(), items: state.items }, inventory: inventory() });
  const u = lastUsage = { kitchen: testKitchen().kitchen, dishes: Object.values(quiz.dishes).map((d) => d.name), ...quiz.usage };
  const kit = u.items.filter((x) => x.kit);
  const usedKit = kit.filter((x) => x.status === 'used').length;
  $('usage-sum').textContent = `The taste test shows ${u.dishes.length} dish${u.dishes.length === 1 ? '' : 'es'}. They use ${u.used - usedKit} of ${u.items.length - kit.length} foods and ${usedKit} of ${kit.length} pieces of kit.`;
  for (const b of $('usage-tabs').querySelectorAll('button')) {
    b.setAttribute('aria-checked', String(b.dataset.value === usageTab));
    b.textContent = `${b.dataset.value === 'used' ? 'Used' : 'Not used'} · ${b.dataset.value === 'used' ? u.used : u.unused}`;
  }
  const row = (x, lines) => h('li', { class: `usage-row ${x.status}` },
    h('b', {}, x.name, x.kit ? h('span', { class: 'usage-tag' }, 'kit') : null),
    lines.length ? h('ul', {}, lines) : null);
  const reasonLine = (r) => h('li', {}, r.dish ? h('span', { class: 'usage-dish' }, r.dish) : null, h('span', { class: 'usage-why' }, r.why));
  let body;
  if (usageTab === 'used') {
    body = [h('ul', { class: 'usage-list' }, u.items.filter((x) => x.status === 'used').map((x) => row(x, x.usedIn.map((d) => h('li', {}, h('span', { class: 'usage-dish' }, d))))))];
  } else {
    const gaps = u.items.filter((x) => x.status === 'unused' && !x.reasons[0]?.dish);
    const blocked = u.items.filter((x) => x.status !== 'used' && !gaps.includes(x));
    body = [
      u.blockers.length ? h('div', { class: 'usage-group' },
        h('h3', {}, 'One thing away'),
        h('ul', { class: 'usage-list' }, u.blockers.slice(0, 4).map((b) => h('li', { class: 'usage-row' }, h('b', {}, b.thing), h('ul', {}, b.dishes.map((d) => h('li', {}, h('span', { class: 'usage-dish' }, d)))))))) : null,
      blocked.length ? h('div', { class: 'usage-group' },
        h('h3', {}, 'A dish names it, but it’s out'),
        h('ul', { class: 'usage-list' }, blocked.map((x) => {
          const first = x.reasons.slice(0, 3).map(reasonLine);
          const more = x.reasons.slice(3);
          return row(x, more.length ? [...first, h('li', {}, h('details', { class: 'usage-more' }, h('summary', {}, `${more.length} more`), h('ul', {}, more.map(reasonLine))))] : first);
        }))) : null,
      gaps.length ? h('div', { class: 'usage-group' },
        h('h3', {}, 'No recipe uses it'),
        h('div', { class: 'chips' }, gaps.map((x) => h('span', { class: 'chip static' }, x.name)))) : null,
      !u.unused ? h('p', { class: 'mini' }, 'Every item is used.') : null,
    ];
  }
  $('usage-body').replaceChildren(...body.filter(Boolean));
}

function renderInventory() {
  renderUsage();
  const has = state.items.length > 0;
  show($('step-inventory'), has);
  show($('step-context'), has && !state.reviewingPaste);
  if (!has) return;
  const groups = { food: [], kit: [], other: [] };
  state.items.forEach((item, index) => {
    const one = buildInventory([item], { cache: state.pantry });
    const id = one.matched[0]?.id ?? null;
    const extra = one.extras[0];
    const kind = id ? kindOf(id) : extra && !one.unmatched.length ? (extra.kind === 'food' ? 'food' : 'kit') : null;
    const bucket = kind === 'food' ? 'food' : kind ? 'kit' : 'other';
    groups[bucket].push({ item, index, id: id ?? (kind ? extra.id : null) });
  });
  const titles = { food: 'Food', kit: 'Kit', other: 'Not usable yet' };
  $('inventory-groups').replaceChildren(...Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) =>
    h('div', { class: 'group' },
      h('h3', {}, titles[key]),
      h('div', { class: 'chips' }, list.map(({ item, index, id }) =>
        h('span', { class: `chip${id ? '' : ' unknown'}`, title: id ? `Counts as: ${labelFor(id)}` : 'Not in Harvey’s vocabulary yet' },
          item.name,
          item.quantity ? h('small', {}, ` · ${item.quantity}`) : null,
          h('button', { type: 'button', 'aria-label': `Remove ${item.name}`, onclick: () => setItems(state.items.filter((_, i) => i !== index)) }, '×')))))));
  $('basics').replaceChildren(...Object.entries(ASSUMED_BASICS).map(([id, b]) => {
    const off = state.missingBasics.includes(id);
    return h('span', {
      class: `chip toggle${off ? ' off' : ''}`, role: 'checkbox', 'aria-checked': String(!off), tabindex: '0',
      onclick: () => toggleBasic(id),
      onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleBasic(id); } },
    }, b.label);
  }));
  renderSoaked();
}

// Foods in your kitchen that some dish needs soaked first.
const SOAK_FOODS = [...new Set(CATALOGUE.flatMap(soakNeeds))];
function renderSoaked() {
  const have = inventory().have;
  const foods = SOAK_FOODS.filter((id) => have.has(id));
  show($('soaked-wrap'), foods.length > 0);
  $('soaked').replaceChildren(...foods.map((id) => {
    const on = state.soaked.includes(id);
    return h('span', {
      class: 'chip toggle', role: 'checkbox', 'aria-checked': String(on), tabindex: '0',
      onclick: () => toggleSoaked(id),
      onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleSoaked(id); } },
    }, labelFor(id));
  }));
}

function toggleSoaked(id) {
  state.soaked = state.soaked.includes(id) ? state.soaked.filter((x) => x !== id) : [...state.soaked, id];
  store.set('soaked', { day: today(), ids: state.soaked });
  renderSoaked();
  if (state.decided) decide();
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

function moment() {
  if (WHEN[state.ctx.when]) return WHEN[state.ctx.when];
  const now = new Date();
  return { hour: now.getHours(), weekday: now.getDay() };
}

function renderContext() {
  for (const b of $('kind').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.ctx.kind));
  $('when').value = state.ctx.when;
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
function decide(opts = {}) {
  if (opts.source) state.pickSource = opts.source;
  state.decided = true;
  state.soaked = soakedToday(); // a page left open past midnight forgets last night's ticks
  const result = rank({
    inventory: inventory(),
    targets: state.ctx.targets,
    // No mood: λ is neutral on mood. Pass one here when the page asks again.
    context: { kind: state.ctx.kind, ...moment() },
    // The AI's recipes compete on exactly the same terms as the catalogue.
    catalogue: [...CATALOGUE, ...state.aiRecipes.accepted],
    config: DEFAULT_CONFIG,
    // Your Fix / Veto taps win at once, over the chat verdicts.
    verdicts: { ...PIERRE_SEED, ...liveVerdicts(state.liveRepairs) },
    soaked: state.soaked,
  });
  state.result = result;
  renderResult(result);
}

// ── AI-designed recipes (proof of concept) ─────────────────────────────────
// The AI proposes; validateMeal() and the ranker dispose. A recipe the AI
// designs can only be suggested if it passes both, and then only if it scores
// best.
function recipeKey() {
  return JSON.stringify([[...inventory().have].sort(), state.ctx.kind, state.missingBasics]);
}

async function askAIForRecipes(force = false) {
  if (!state.ai) return;
  const key = recipeKey();
  if (!force && state.aiRecipes.key === key && state.aiRecipes.status !== 'error') return;
  const inv = inventory();
  state.aiRecipes = { status: 'loading', accepted: [], rejected: [], model: null, error: null, key, note: 'Asking your AI to design recipes…' };
  decide();
  const t0 = performance.now();
  const run = startDebugRun('recipes');
  try {
    const { recipes, model } = await designRecipes({
      onEvent: (e) => logDebug(run, debugEntry(e, Math.round(performance.now() - t0))),
      ...state.ai,
      have: [...inv.have],
      context: { kind: state.ctx.kind },
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
    finishDebugRun(run, Math.round(performance.now() - t0));
  } catch (e) {
    if (state.aiRecipes.key !== key) return;
    state.aiRecipes = { status: 'error', accepted: [], rejected: [], model: null, error: explainError(e), key };
    logDebug(run, { stage: 'failed', detail: `${e.kind ?? 'error'}${e.status ? ` · HTTP ${e.status}` : ''} · ${String(e.detail ?? e.message).slice(0, 300)}` });
    finishDebugRun(run, Math.round(performance.now() - t0));
  }
  decide();
}

function renderAIStatus() {
  const el = document.querySelector('#ai-ideas .ai-note');
  if (el && state.aiRecipes.status === 'loading') el.textContent = state.aiRecipes.note;
}

function aiIdeasCard(result) {
  const ai = state.aiRecipes;
  if (!state.ai || ai.status === 'idle') return null;
  const head = [h('h2', {}, 'AI ideas')];
  if (ai.status === 'loading') {
    return h('section', { class: 'card', id: 'ai-ideas' }, head, h('p', { class: 'ai-note muted shimmer' }, ai.note || 'Designing…'));
  }
  if (ai.status === 'error') {
    return h('section', { class: 'card', id: 'ai-ideas' }, head,
      h('p', { class: 'error' }, ai.error),
      h('button', { class: 'btn', type: 'button', onclick: () => askAIForRecipes(true) }, 'Try again'));
  }
  const position = new Map();
  for (const g of result.ladder) [g.pick, ...g.alternatives].forEach((x, i) => position.set(x.meal.id, { rung: g.rung, top: i === 0 }));
  const ranked = new Set(result.ranked.map((r) => r.meal.id));
  const blocked = new Map(result.filtered.map((f) => [f.meal.id, f.missing]));
  const vetoed = new Set(result.vetoed.map((v) => v.meal.id));
  const rows = [
    ...ai.accepted.map((m) => {
      const pos = position.get(m.id);
      const missing = blocked.get(m.id);
      const verdict = pos
        ? h('span', { class: pos.top ? 'pass win' : 'pass' }, pos.top ? `Rung ${pos.rung} pick` : `On rung ${pos.rung}`)
        : ranked.has(m.id)
          ? h('span', { class: 'pass' }, 'Possible')
        : vetoed.has(m.id)
          ? h('span', { class: 'fail' }, 'Pierre veto')
        : missing
          ? h('span', { class: 'fail' }, `Needs ${describeMissing(missing).join(', ')}`)
          : h('span', { class: 'muted' }, 'Not a ' + state.ctx.kind);
      return h('li', {},
        h('div', { class: 'other-head' }, h('strong', {}, m.name), verdict),
        m.adjustments?.length ? h('p', { class: 'mini' }, `Corrected: ${[...new Set(m.adjustments)].join('; ')}`) : null);
    }),
    ...ai.rejected.map((r) => h('li', {},
      h('div', { class: 'other-head' }, h('strong', {}, r.name), h('span', { class: 'fail' }, 'Rejected')),
      h('p', { class: 'mini' }, r.reasons.join('; ')))),
  ];
  return h('section', { class: 'card', id: 'ai-ideas' }, head,
    rows.length ? h('ul', { class: 'others' }, rows) : h('p', { class: 'muted' }, 'None this time.'),
    h('p', { class: 'mini ai-foot' }, ai.model, h('button', { class: 'btn link', type: 'button', onclick: () => askAIForRecipes(true) }, 'New ideas')));
}

function ingredientLine(ing) {
  return h('li', {}, ing.label ?? labelFor(ing.id), ' ', h('small', {}, `· ${ing.amount}`), ing.optional ? h('small', {}, ' (optional, you have it)') : null);
}

// Pierre's tier as a compact badge, and a floor dish's one-line lift.
const TIER_LABEL = { crave: 'Crave', pass: 'Pass', floor: 'Floor' };
function tierBadge(p) {
  if (!p) return null;
  return h('span', { class: `badge tier tier-${p.untested ? 'untested' : p.tier}`, title: p.untested ? 'Pierre hasn’t judged this' : `Pierre: ${p.tier}` }, p.untested ? 'Not judged' : TIER_LABEL[p.tier]);
}
function tierHint(p) {
  return p?.hint ? h('p', { class: 'lift' }, p.hint) : null;
}

function whyTable(r) {
  const payRows = r.payoff.parts.map((p) =>
    h('tr', {}, h('td', {}, `${p.amount} ${p.unit}`), h('td', { class: 'num' }, `${Math.round(p.progress * 100)}% of what's left`), h('td', { class: 'num' }, `+${fmt(p.value)}`)));
  const fricRows = r.frictionParts.map((p) =>
    h('tr', {}, h('td', {}, p.label), h('td', { class: 'num' }, `${fmt(p.raw, 1)} → ${fmt(p.normalised)}`), h('td', { class: 'num' }, `${fmt(p.value)}`)));
  return h('details', { class: 'why' },
    h('summary', {}, 'Why this score'),
    h('p', { class: 'formula' }, `score = payoff − λ × friction = ${fmt(r.payoff.value)} − ${fmt(r.lambda.value)} × ${fmt(r.friction)} = ${fmt(r.score)}`),
    r.pierre ? h('h3', {}, 'Pierre') : null,
    r.pierre ? h('p', { class: 'mini' }, `${r.pierre.untested ? 'not judged' : r.pierre.tier}${r.pierre.source === 'verdict' ? ' (your rating)' : ''}: ${r.pierre.why.length ? r.pierre.why.join('; ') : 'clears the floor'}`) : null,
    h('h3', {}, 'Payoff'),
    h('table', { class: 'parts' }, h('tbody', {}, payRows)),
    r.payoff.confidence < 1 ? h('p', { class: 'mini' }, `Payoff × ${Math.round(r.payoff.confidence * 100)}% (${r.meal.source === 'ai' ? 'AI-guessed' : 'estimated'} macros)`) : null,
    h('h3', {}, 'Friction (raw → 0–1, × weight)'),
    h('table', { class: 'parts' }, h('tbody', {}, fricRows)),
    h('h3', {}, 'λ'),
    h('p', { class: 'mini' }, r.lambda.parts.map((p) => `${p.name} ×${p.factor}`).join(' · '), ` = ${fmt(r.lambda.value)}`),
    PROVISIONAL ? h('p', { class: 'mini' }, h('span', { class: 'badge' }, 'Placeholder weights')) : null);
}

// ── White v2: the effort ladder ─────────────────────────────────────────────
const TIERS_YOU_SAY = [['veto', 'Veto'], ['floor', 'Floor'], ['pass', 'Pass'], ['crave', 'Crave']];

function cookedThis(item) {
  const entry = cookLogEntry({
    chosen: item,
    ladder: state.result.ladder,
    context: { kind: state.ctx.kind, ...moment(), targets: state.ctx.targets, soaked: state.soaked },
    at: new Date().toISOString(),
  });
  state.cookLog = [...state.cookLog, entry].slice(-500);
  store.set('cookLog', state.cookLog);
  state.cookedNow.add(item.meal.id);
  renderResult(state.result);
}

function saveLiveRepair(item, tier, fix) {
  const entry = liveRepairEntry({ item, tier, fix, at: new Date().toISOString() });
  state.liveRepairs = [...state.liveRepairs, entry].slice(-200);
  store.set('liveRepairs', state.liveRepairs);
  state.fixing = null;
  decide();
}

function undoLiveRepair(dishId) {
  state.liveRepairs = state.liveRepairs.filter((r) => r.dishId !== dishId);
  store.set('liveRepairs', state.liveRepairs);
  decide();
}

function cookButton(item, primary = true) {
  const done = state.cookedNow.has(item.meal.id);
  return h('button', {
    class: `btn ${primary ? 'primary' : ''} cook`, type: 'button', disabled: done,
    onclick: () => cookedThis(item),
  }, done ? 'Logged · Cooked tonight' : 'Cooked this');
}

function fixDrawer(item) {
  const note = h('input', { type: 'text', class: 'fix-note', placeholder: 'What would fix it? (optional)', 'aria-label': `What would fix ${item.meal.name}` });
  return h('div', { class: 'fix-drawer' },
    h('p', { class: 'mini' }, `Pierre says ${item.pierre.untested ? 'nothing (not judged)' : item.pierre.tier}. You say:`),
    h('div', { class: 'segmented fix-tiers', role: 'group', 'aria-label': 'Your tier' },
      TIERS_YOU_SAY.map(([tier, label]) => h('button', { type: 'button', onclick: () => saveLiveRepair(item, tier, note.value) }, label))),
    note,
    h('p', { class: 'mini' }, 'Applies now on this phone, and goes to Claude with “Copy for Claude”.'));
}

function recipeBlock(r) {
  const passive = r.raw.waiting;
  const steps = r.meal.steps.map((st) => h('li', {}, st.text));
  if (r.assemblyStep) steps.push(h('li', { class: 'assembly' }, r.assemblyStep));
  return h('details', { class: 'recipe-fold' },
    h('summary', {}, 'Recipe'),
    h('div', { class: 'recipe' },
      h('h3', {}, 'You need'),
      h('ul', {}, r.used.ingredients.map(ingredientLine)),
      h('h3', {}, 'Kit'),
      h('p', { class: 'muted' }, [...r.used.equipment, ...r.used.utensils].map(labelFor).join(', ') || 'Nothing'),
      h('h3', {}, `Steps · about ${fmt(r.raw.handsOn, 1)} min hands-on${passive ? ` + ${passive} min waiting` : ''}`),
      h('ol', {}, steps),
      h('p', { class: 'mini' }, `${r.meal.macros.protein} g protein · ${r.meal.macros.kcal} kcal · ${r.meal.macros.fiber} g fiber (${{ label: 'from labels', ai: 'AI estimate', estimate: 'estimate' }[r.meal.source] ?? 'estimate'})`)),
    whyTable(r));
}

function rungCard(g) {
  const top = g.pick;
  const fixing = state.fixing === top.meal.id;
  return h('section', { class: `card rung rung-${g.rung}` },
    h('p', { class: 'pick-label' }, `Rung ${g.rung} · ${g.name}`),
    h('h2', { class: 'dish-name' }, top.meal.name, top.meal.origin === 'ai' ? h('span', { class: 'badge ai' }, 'AI') : null, ' ', tierBadge(top.pierre)),
    tierHint(top.pierre),
    top.prePrepNote ? h('p', { class: 'preprep' }, `If you have time: ${top.prePrepNote}`) : null,
    h('div', { class: 'reasons' }, top.reasons.map((x) => h('span', {}, x))),
    recipeBlock(top),
    h('div', { class: 'rung-actions' },
      cookButton(top),
      h('button', { class: 'btn link quiet', type: 'button', 'aria-expanded': String(fixing), onclick: () => { state.fixing = fixing ? null : top.meal.id; renderResult(state.result); } }, 'Fix / Veto')),
    fixing ? fixDrawer(top) : null,
    g.alternatives.length ? h('details', { class: 'alts' },
      h('summary', {}, `${g.alternatives.length} more on this rung`),
      h('ul', { class: 'others' }, g.alternatives.map((r) => h('li', {},
        h('div', { class: 'other-head' }, h('strong', {}, r.meal.name, r.meal.origin === 'ai' ? h('span', { class: 'badge ai' }, 'AI') : null), tierBadge(r.pierre)),
        tierHint(r.pierre),
        r.prePrepNote ? h('p', { class: 'mini' }, `If you have time: ${r.prePrepNote}`) : null,
        h('p', { class: 'mini' }, r.reasons.join(' · ')),
        recipeBlock(r),
        h('div', { class: 'rung-actions' }, cookButton(r, false),
          h('button', { class: 'btn link quiet', type: 'button', onclick: () => { state.fixing = state.fixing === r.meal.id ? null : r.meal.id; renderResult(state.result); } }, 'Fix / Veto')),
        state.fixing === r.meal.id ? fixDrawer(r) : null)))) : null);
}

function renderResult(result) {
  const root = $('result');
  const appearing = root.hidden; // animate in once, not on every re-rank
  show(root);
  const cards = [];

  if (!result.ladder.length) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'Nothing fits yet'),
      blockedList(result.filtered.slice(0, 6))));
  } else {
    cards.push(h('div', { class: 'ladder-head' },
      h('h2', {}, 'Pick your effort'),
      state.pickSource === 'sample' ? h('p', { class: 'fallback-note' }, 'No AI answer in time · sample kitchen') : null,
      state.pickSource === 'last' ? h('p', { class: 'fallback-note' }, 'No AI answer in time · last scan') : null));
    for (const g of result.ladder) cards.push(rungCard(g));
  }

  if (result.tomorrow?.length) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'For tomorrow'),
      h('ul', { class: 'others' }, result.tomorrow.slice(0, 4).map((t) =>
        h('li', {},
          h('div', { class: 'other-head' }, h('strong', {}, t.meal.name), h('span', { class: 'muted' }, t.pierre.tier)),
          h('p', { class: 'mini' }, `Soak the ${t.soak.map((id) => labelFor(id).toLowerCase()).join(' and ')} tonight`))))));
  }

  cards.push(aiIdeasCard(result));

  if (result.unlocks.length) {
    cards.push(h('section', { class: 'card' },
      h('h2', {}, 'One thing to buy'),
      result.unlocks.map((u) => h('p', { class: 'unlock' }, 'Get ', h('strong', {}, u.label.toLowerCase()), ` and you unlock ${u.meals.length} more: `, h('span', { class: 'muted' }, u.meals.join(', '))))));
  }

  const blockedCatalogue = result.filtered.filter((f) => f.meal.origin !== 'ai');
  if (result.ladder.length && blockedCatalogue.length) {
    cards.push(h('section', { class: 'card' },
      h('details', { class: 'skipped' }, h('summary', {}, 'Can’t make yet'), blockedList(blockedCatalogue))));
  }

  const latest = Object.keys(liveVerdicts(state.liveRepairs));
  if (latest.length) {
    const byId = new Map(state.liveRepairs.map((r) => [r.dishId, r]));
    cards.push(h('section', { class: 'card' },
      h('details', { class: 'skipped' }, h('summary', {}, `Your fixes (${latest.length})`),
        h('ul', { class: 'others' }, latest.map((id) => {
          const r = byId.get(id);
          return h('li', {},
            h('div', { class: 'other-head' }, h('strong', {}, r.name), h('span', { class: 'muted' }, `${r.pierre} → ${r.yours}`)),
            r.fix ? h('p', { class: 'mini' }, r.fix) : null,
            h('button', { class: 'btn link quiet', type: 'button', onclick: () => undoLiveRepair(id) }, 'Undo'));
        })))));
  }

  const shown = cards.filter(Boolean);
  if (appearing) shown.forEach((c, i) => { c.classList.add('rise'); c.style.animationDelay = `${i * 60}ms`; });
  root.replaceChildren(...shown);
}

function blockedList(filtered) {
  return h('ul', { class: 'others' }, filtered.map((f) =>
    h('li', {}, h('strong', {}, f.meal.name), h('p', { class: 'mini' }, describeMissing(f.missing).join(', ')))));
}

// ── Haptics: Kiron's invisible real iOS switch ──────────────────────────────
// Safari ticks the Taptic Engine when a real <input type=checkbox switch> is
// toggled, so each main button carries one, invisible, over its whole area.
// The tap still bubbles to the button's own click handler. Android vibrates.
function addHaptics() {
  for (const btn of document.querySelectorAll('[data-haptic]')) {
    btn.replaceChildren(h('span', { class: 'lbl' }, btn.textContent));
    const sw = h('input', { type: 'checkbox', switch: true, class: 'haptic', tabindex: '-1', 'aria-hidden': 'true' });
    btn.append(sw);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-haptic]') && !('switch' in HTMLInputElement.prototype) && navigator.vibrate) navigator.vibrate(8);
  });
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function init() {
  // Clean start on every load: no restored scan, no restored scroll.
  store.set('inventory', null); // 1.3 and earlier kept the last scan here
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); }); // Safari back/forward cache
  // 1.40.0: an old copy of the page reloads itself, and "Start fresh" clears this phone's state.
  reloadIfStale();
  document.getElementById('start-fresh')?.addEventListener('click', () => startFresh());
  $('version').textContent = VERSION;
  addHaptics();

  // Gemini keys use flash-lite models only; move a saved non-lite choice over.
  if (state.ai?.provider === 'gemini' && !/flash-lite/.test(state.ai.model)) {
    state.ai.model = pickModel('gemini', allowedModels('gemini', state.ai.models));
    store.set('ai', state.ai);
  }
  if (state.ai) $('api-key').value = state.ai.apiKey;
  $('change-key').addEventListener('click', editKey);
  $('cancel-key').addEventListener('click', () => {
    editingKey = false;
    $('api-key').value = state.ai?.apiKey ?? '';
    show($('key-error'), false);
    renderKey();
  });
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
  $('copy-debug')?.addEventListener('click', copyDebug);
  $('usage-tabs')?.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (v && v !== usageTab) { usageTab = v; renderUsage(); }
  });
  $('usage-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(JSON.stringify({ version: VERSION, ingredientCheck: lastUsage }, null, 1)).then(() => { $('usage-copy').textContent = 'Copied'; }, () => {});
  });
  $('usage-quiz')?.addEventListener('click', () => {
    startRungQuiz({ kitchen: testKitchen(), inventory: inventory(), items: state.items, cache: state.pantry, missingBasics: state.missingBasics, version: VERSION, source: 'paste' });
  });
  $('use-demo').addEventListener('click', () => {
    state.pickSource = 'inventory';
    endPasteReview();
    show($('paste-list'), true);
    setItems(DEMO_KITCHEN.map((i) => ({ ...i, source: 'demo' })));
    $('step-inventory').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // A pasted list (another app's export, a note) works as the whole inventory.
  // So does a catalogued kitchen's JSON (1.29.0): the first kitchen in it.
  $('paste-go').addEventListener('click', () => {
    const text = $('paste-text').value;
    state.linked = false;
    state.sample = false;
    const kitchen = looksLikeKitchenJson(text) ? importKitchens(text)[0] : null;
    if (kitchen) {
      state.pickSource = 'inventory';
      state.reviewingPaste = true;
      state.kitchen = kitchen;
      setItems(kitchen.items);
      showPasteSummary(kitchen.items);
      return;
    }
    // JSON that would not parse even after repair: take its "name" values, never its braces.
    const names = looksLikeKitchenJson(text) ? [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()) : [];
    const items = names.length ? [...new Set(names)] : parseItemList(text);
    if (!items.length) return;
    state.pickSource = 'inventory';
    const list = items.map((name) => ({ name, canonical: null, category: 'other', source: 'paste' }));
    state.reviewingPaste = true;
    state.kitchen = { kitchen: 'Pasted list', diet: 'unknown', notes: '', items: list };
    setItems(list);
    showPasteSummary(list);
  });
  $('paste-edit').addEventListener('click', () => {
    endPasteReview();
    state.linked = false;
    show($('step-context'), false);
    show($('result'), false);
    const box = $('paste-list');
    show(box, true);
    box.open = true;
    $('paste-text').focus();
  });
  // Proceed (1.31.0): the taste test. Marco, then Pierre sort each rung; White picks; Send.
  // ?debug keeps the old ladder of picks.
  $('paste-proceed').addEventListener('click', () => {
    if (document.body.classList.contains('testing')) {
      const from = state.linked ? 'link' : state.sample ? 'sample' : 'paste';
      startRungQuiz({ kitchen: state.kitchen ?? { kitchen: 'Pasted list', items: state.items }, inventory: inventory(), items: state.items, cache: state.pantry, missingBasics: state.missingBasics, version: VERSION, source: from, kitchenSource: from === 'paste' ? null : from, name: state.linked ? testerName() : '' });
      return;
    }
    endPasteReview();
    show($('paste-list'), true);
    $('paste-list').open = false;
    show($('step-context'), state.items.length > 0);
    $('decide').click();
  });

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('add-input').value.trim();
    if (!name) return;
    setItems([...state.items, { name, canonical: null, category: 'other', source: 'manual' }]);
    $('add-input').value = '';
  });

  $('kind').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (v) updateCtx({ kind: v });
  });
  $('when').addEventListener('change', (e) => updateCtx({ when: e.target.value }));
  for (const [id, key] of [['t-protein', 'protein'], ['t-calories', 'calories'], ['t-fiber', 'fiber']]) {
    $(id).addEventListener('change', (e) => updateCtx({ targets: { ...state.ctx.targets, [key]: Math.max(0, Number(e.target.value) || 0) } }));
  }
  $('decide').addEventListener('click', () => {
    decide({ source: 'inventory' });
    askAIForRecipes();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  renderKey();
  renderDebug();
  renderThumbs();
  renderInventory();
  renderContext();
  greet();
  openSharedKitchen().then(() => openSamplePicker());
  addEventListener('hashchange', openSharedKitchen);
}

// ── The tester's greeting (1.35.0) ─────────────────────────────────────────
// share.html puts the tester's first name in the link (#n=Riya&k=…). The page says hi with
// it, the quiz says it on the way in and out, and the result carries it.
// 1.48.0: the name comes from the link only. 1.35 kept it on the phone, so the bare site
// greeted whoever last opened a link there (pranjal's phone said "Hi, <last tester>" after
// checking a link). A resumed run keeps its own name in the saved run, so nothing is lost.
const NAME_KEY = 'harveys.tester.name.v1';
try { localStorage.removeItem(NAME_KEY); } catch { /* private mode */ }
const testerName = () => linkName(location.hash) || '';
function greet(dishes = null) {
  const hi = $('hi');
  if (!hi) return; // owner.html has no greeting
  const name = testerName();
  hi.textContent = name ? `Hi, ${name}` : 'Hi there';
  document.title = name ? `Hi, ${name} · Harvey’s` : 'Harvey’s';
  $('hi-lead').textContent = dishes == null
    ? 'Paste what’s in your kitchen, then tap Use this list.'
    : dishes
      ? `Rate ${dishes} recipe${dishes === 1 ? '' : 's'} from your kitchen for effort and taste.`
      : 'No recipes for this kitchen yet. Ask for a new link.';
}

// Share links (1.34.0): #k=… carries a whole kitchen (src/brain/share-link.js, made on
// share.html). Opening one goes straight into the taste test: no paste, no Proceed.
// Closing the test leaves the kitchen on the page, so Proceed opens it again.
async function openSharedKitchen() {
  const code = linkCode(location.hash);
  if (!code) return;
  const raw = await decodeKitchen(code);
  const kitchen = raw ? importKitchens([raw])[0] : null;
  greet();
  if (!kitchen) {
    const err = $('scan-error');
    // iOS before 16.4 can't unpack a link at all: say that, not "cut short".
    err.textContent = typeof DecompressionStream === 'undefined' && code.startsWith('1')
      ? 'This phone’s browser is too old to open the link. Update iOS (or open it in Chrome) and tap the link again.'
      : 'This link didn’t open, maybe it was cut short. Ask whoever sent it for a new one.';
    show(err, true);
    return;
  }
  state.pickSource = 'inventory';
  state.reviewingPaste = true;
  state.kitchen = kitchen;
  state.linked = true;
  state.sample = false;
  setItems(kitchen.items);
  showPasteSummary(kitchen.items);
  $('paste-proceed').textContent = 'Rate the recipes';
  greet(Object.keys(buildRungQuiz({ kitchen, inventory: inventory() }).dishes).length);
  startRungQuiz({ kitchen, inventory: inventory(), items: state.items, cache: state.pantry, missingBasics: state.missingBasics, version: VERSION, source: 'link', kitchenSource: 'link', name: testerName() });
}

// Sample kitchens (1.52.0): the bare site, with no #k= link, opens on "Pick the kitchen closest
// to yours" (data/test-kitchens/kitchens.json). A pick goes straight into Confirm your foods.
// Closing the picker leaves the paste box, so a custom list still works. Links skip all this.
let sampleKitchens = []; // 1.55.0: the persona list, so a level's deck can favour its own dishes
async function openSamplePicker() {
  if (linkCode(location.hash) || !document.body.classList.contains('testing')) return;
  let kitchens = [];
  try {
    const res = await fetch('data/test-kitchens/kitchens.json', { cache: 'no-cache' });
    if (res.ok) kitchens = importKitchens(await res.text());
  } catch { return; }
  if (!kitchens.length || linkCode(location.hash)) return;
  sampleKitchens = kitchens;
  startKitchenPicker({ kitchens, onPick: openSampleKitchen });
}
function openSampleKitchen(kitchen) {
  state.pickSource = 'inventory';
  state.reviewingPaste = true;
  state.kitchen = kitchen;
  state.linked = false;
  state.sample = true;
  setItems(kitchen.items);
  showPasteSummary(kitchen.items);
  $('paste-proceed').textContent = 'Rate the recipes';
  greet(Object.keys(buildRungQuiz({ kitchen, inventory: inventory() }).dishes).length);
  startRungQuiz({ kitchen, inventory: inventory(), items: state.items, cache: state.pantry, missingBasics: state.missingBasics, version: VERSION, source: 'sample', kitchenSource: 'sample', name: '', below: levelBelow(kitchen, sampleKitchens) });
}

init();
