// The page. Wires the AI (perceive) to the brain (decide). All decisions come
// from src/brain/; this file only gathers input and renders output.

import {
  CATALOGUE, DEFAULT_CONFIG, PROVISIONAL, ASSUMED_BASICS,
  buildInventory, parseItemList, kindOf, labelFor, rank, describeMissing,
  PIERRE_SEED, cookLogEntry, liveRepairEntry, liveVerdicts,
} from './brain/index.js';
import { PROVIDERS, DEFAULT_MODEL, FALLBACK_MODELS, allowedModels, detectProvider, checkKey, pickModel, scanKitchen, designRecipes, AIError } from './ai/providers.js';
import { prepareImage } from './ai/images.js';
import { validateMeal } from './brain/validate.js';
import { DEMO_KITCHEN } from './demo-kitchen.js';

const VERSION = '1.18.2';
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

const state = {
  ai: store.get('ai', null), // { apiKey, provider, model, models }
  photos: [], // { base64, mediaType, previewUrl }
  // Not restored on reload: every page load starts clean (demo-ready).
  items: [], // [{ name, canonical, category, source }]
  missingBasics: store.get('missingBasics', []),
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
  const titles = { food: 'Food', kit: 'Kit', other: 'Not usable yet' };
  $('inventory-groups').replaceChildren(...Object.entries(groups).filter(([, list]) => list.length).map(([key, list]) =>
    h('div', { class: 'group' },
      h('h3', {}, titles[key]),
      h('div', { class: 'chips' }, list.map(({ item, index, id }) =>
        h('span', { class: `chip${id ? '' : ' unknown'}`, title: id ? `Counts as: ${labelFor(id)}` : 'Not in Marco’s vocabulary yet' },
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
  return h('li', {}, labelFor(ing.id), ' ', h('small', {}, `· ${ing.amount}`), ing.optional ? h('small', {}, ' (optional, you have it)') : null);
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
    context: { kind: state.ctx.kind, ...moment(), targets: state.ctx.targets },
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
  $('use-demo').addEventListener('click', () => {
    state.pickSource = 'inventory';
    setItems(DEMO_KITCHEN.map((i) => ({ ...i, source: 'demo' })));
    $('step-inventory').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // A pasted list (another app's export, a note) works as the whole inventory.
  $('paste-go').addEventListener('click', () => {
    const items = parseItemList($('paste-text').value);
    if (!items.length) return;
    state.pickSource = 'inventory';
    setItems(items.map((name) => ({ name, canonical: null, category: 'other', source: 'paste' })));
    $('paste-list').open = false;
    $('step-inventory').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
}

init();
