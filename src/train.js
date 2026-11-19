// The pick-two trainer (1.4.0). Marco shows two dishes; you tap the one you'd
// cook tonight and give each a Pierre verdict. Every tap refits the weights in
// src/brain/learn.js. Everything stays in this browser until "Copy for Claude".

import { CATALOGUE, FOODS, EQUIPMENT, ASSUMED_BASICS, matchName } from './brain/index.js';
import {
  FEATURES, rawFeatures, featureVector, pierreTags, fitPierre, pierreSummary, fitMarco,
  explainWeights, nextPair, inDiet, VERDICT_VALUE, methodsOf,
} from './brain/learn.js';
import { PIERRE_SEED, TECHNIQUE_OVERLAY, TRAINING_EXTRAS, FORM_TOOLS, PRE_PREP_OPTIONS } from './brain/train-data.js';
import { validateMeal } from './brain/validate.js';
import { callModel, parseJsonObject } from './ai/providers.js';

const VERSION = '1.6.0';
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

function seededVerdicts() {
  return Object.fromEntries(Object.entries(PIERRE_SEED).map(([id, v]) => [id, { ...v, source: 'chat 19 Nov' }]));
}

const state = {
  mood: store.get('train.mood', 'okay'),
  choices: store.get('train.choices', []),
  verdicts: store.get('train.verdicts', null) ?? seededVerdicts(),
  mine: store.get('train.mine', []),
  ai: store.get('train.ai', []),
  pair: store.get('train.pair', null), // [idA, idB]
  editing: null, // id of the user dish being edited
  formVerdict: null,
  fit: null,
  prevTheta: null,
  lastMove: null,
  undo: null,
};
const save = () => {
  store.set('train.choices', state.choices);
  store.set('train.verdicts', state.verdicts);
  store.set('train.mine', state.mine);
  store.set('train.ai', state.ai);
  store.set('train.pair', state.pair);
  store.set('train.mood', state.mood);
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
const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();
const plural = (n, w, p = `${w}s`) => `${fmt(n)} ${n === 1 ? w : p}`;

// ── The pool of dishes ──────────────────────────────────────────────────────
function pool() {
  const builtIn = CATALOGUE.filter((d) => d.kind === 'meal' && inDiet(d)).map((d) => ({ ...d, ...TECHNIQUE_OVERLAY[d.id], origin: 'built-in' }));
  const extras = TRAINING_EXTRAS.map((d) => ({ ...d, origin: 'built-in' }));
  return [...builtIn, ...extras, ...state.mine, ...state.ai];
}
const byId = () => new Map(pool().map((d) => [d.id, d]));

/** Pierre fitted on every verdict so far; predicts dishes nobody judged. */
function pierreModel(dishes = pool()) {
  const rows = dishes.filter((d) => state.verdicts[d.id]).map((d) => ({ tags: pierreTags(d), value: VERDICT_VALUE[state.verdicts[d.id].verdict] }));
  return fitPierre(rows);
}
function pierreOf(dish, model) {
  const v = state.verdicts[dish.id];
  return v ? VERDICT_VALUE[v.verdict] : model.predict(pierreTags(dish));
}

/** Choices as the fitter wants them, with today's Pierre for each dish. */
function choiceVectors(model, map) {
  return state.choices.map((c) => {
    const pa = map.has(c.a) ? pierreOf(map.get(c.a), model) : c.pa;
    const pb = map.has(c.b) ? pierreOf(map.get(c.b), model) : c.pb;
    return { xa: featureVector(c.ra, pa), xb: featureVector(c.rb, pb), pick: c.pick, mood: c.mood };
  });
}

function refit() {
  const map = byId();
  const model = pierreModel([...map.values()]);
  const fit = fitMarco(choiceVectors(model, map));
  if (state.fit) {
    // The headline for "what moved": the biggest change in protein-gram terms.
    const before = explainWeights(state.fit.theta);
    const after = explainWeights(fit.theta);
    const moved = after
      .map((w, j) => ({ ...w, before: before[j] }))
      .filter((w) => w.gramsPerUnit != null && w.before.gramsPerUnit != null && w.key !== 'protein')
      .sort((x, y) => Math.abs(y.gramsPerUnit - y.before.gramsPerUnit) - Math.abs(x.gramsPerUnit - x.before.gramsPerUnit))[0];
    if (moved && Math.abs(moved.gramsPerUnit - moved.before.gramsPerUnit) >= 0.5) state.lastMove = moved;
  }
  state.fit = fit;
  state.pierre = model;
}

// ── Facts on a dish card ───────────────────────────────────────────────────
function prePrepLabel(min) {
  if (!min) return null;
  if (min >= 480) return 'soak overnight';
  if (min >= 120) return `pre-prep ${fmt(min / 60, 0)} h`;
  if (min >= 60) return 'pre-prep 1 h';
  return `pre-prep ${min} min`;
}

function facts(dish) {
  const r = rawFeatures(dish);
  return [
    `${r.protein} g protein`,
    plural(r.tools, 'tool'),
    `${fmt(r.handsOn)} min hands-on`,
    r.waiting > 0 ? `${fmt(r.waiting)} min waiting` : null,
    prePrepLabel(r.prePrepMinutes),
    r.peels > 0 ? `${r.peels} to peel` : null,
    r.cuts > 0 ? `${r.cuts} to cut` : null,
    r.peels + r.cuts === 0 ? 'no knife' : null,
    `${dish.cleanup?.dishes ?? dish.form?.cleanupDishes ?? fmt(r.cleanup)} to wash`,
    (dish.cleanup?.greasy ?? dish.form?.greasy) > 0 ? 'greasy' : null,
  ].filter(Boolean);
}

const ORIGIN = { 'built-in': 'Built-in', mine: 'Yours', ai: 'AI' };

function verdictControl(dish, model) {
  const v = state.verdicts[dish.id];
  const seg = h('div', { class: 'segmented verdict', role: 'radiogroup', 'aria-label': `Pierre on ${dish.name}` },
    ...['pass', 'meh', 'fail'].map((value) => h('button', {
      type: 'button', role: 'radio', 'data-value': value, 'aria-checked': String(v?.verdict === value),
      onclick: () => setVerdict(dish.id, v?.verdict === value ? null : value),
    }, value[0].toUpperCase() + value.slice(1))));
  const guess = v ? null : (() => {
    const p = model.predict(pierreTags(dish));
    const word = p >= 0.67 ? 'pass' : p >= 0.4 ? 'meh' : 'fail';
    return h('span', { class: 'guess' }, `Pierre guesses ${word}`);
  })();
  const why = h('input', {
    type: 'text', class: 'why', placeholder: 'Why? (optional)', value: v?.why ?? '', 'aria-label': `Why, for ${dish.name}`,
    hidden: !v, onchange: (e) => { if (state.verdicts[dish.id]) { state.verdicts[dish.id].why = e.target.value.trim().slice(0, 140); save(); } },
  });
  return h('div', { class: 'pierre' }, h('div', { class: 'pierre-head' }, h('span', { class: 'pierre-label' }, 'Pierre'), guess), seg, why);
}

function dishCard(dish, side, model) {
  return h('article', { class: 'card dish rise', 'data-side': side },
    h('div', { class: 'dish-top' }, h('h3', {}, dish.name), h('span', { class: `badge ${dish.origin === 'ai' ? 'ai' : ''}` }, ORIGIN[dish.origin] ?? 'Dish')),
    h('div', { class: 'reasons' }, ...facts(dish).map((f) => h('span', {}, f))),
    howBlock(dish),
    verdictControl(dish, model),
    h('button', { class: 'btn primary wide pick', type: 'button', 'data-haptic': true, onclick: () => choose(side) }, 'I’d cook this'),
  );
}

function howBlock(dish) {
  const lines = dish.how ? [dish.how] : (dish.steps ?? []).map((s) => s.text);
  const pre = dish.prePrep?.text ? `First: ${dish.prePrep.text}.` : null;
  const ing = (dish.ingredients ?? []).filter((i) => !i.optional).map((i) => FOODS[i.id ?? i.anyOf?.[0]]?.label ?? i.id).filter(Boolean);
  return h('details', { class: 'how' }, h('summary', {}, 'How it’s made'),
    ing.length ? h('p', { class: 'mini' }, ing.join(', ')) : null,
    pre ? h('p', { class: 'mini' }, pre) : null,
    dish.how ? h('p', { class: 'how-text' }, dish.how) : h('ol', {}, ...lines.map((l) => h('li', {}, l))),
    h('p', { class: 'mini' }, `Pierre sees: ${methodsOf(dish).join(', ')}`));
}

// ── Pairs ───────────────────────────────────────────────────────────────────
function pickNewPair() {
  const map = byId();
  const dishes = [...map.values()];
  const model = state.pierre ?? pierreModel(dishes);
  const items = dishes.map((d) => ({ id: d.id, x: featureVector(rawFeatures(d), pierreOf(d, model)), unjudged: !state.verdicts[d.id] }));
  const seenPairs = new Set(state.choices.map((c) => [c.a, c.b].sort().join('|')));
  const shown = new Map();
  for (const c of state.choices) for (const id of [c.a, c.b]) shown.set(id, (shown.get(id) ?? 0) + 1);
  const pair = nextPair(items, { theta: state.fit.theta, seenPairs, shown, rng: Math.random, last: state.pair ?? [] });
  state.pair = pair ? [pair[0].id, pair[1].id] : null;
  save();
}

function currentPair() {
  const map = byId();
  if (!state.pair || !state.pair.every((id) => map.has(id))) pickNewPair();
  return state.pair ? state.pair.map((id) => map.get(id)) : null;
}

function renderPair() {
  const pair = currentPair();
  const box = $('pair');
  if (!pair) {
    box.replaceChildren(h('p', { class: 'mini center' }, 'Add a dish to start.'));
    return;
  }
  const model = state.pierre;
  box.replaceChildren(
    h('h2', { class: 'pair-title' }, 'Which would you cook tonight?'),
    dishCard(pair[0], 'a', model),
    h('p', { class: 'or', 'aria-hidden': 'true' }, 'or'),
    dishCard(pair[1], 'b', model),
  );
  $('undo').hidden = !state.undo;
  $('tally').textContent = state.choices.length ? `${state.choices.length} ${state.choices.length === 1 ? 'pick' : 'picks'} so far` : 'A dozen picks takes about a minute.';
}

function choose(pick) {
  const map = byId();
  const [a, b] = state.pair.map((id) => map.get(id));
  const model = state.pierre;
  const now = new Date();
  state.choices.push({
    at: now.toISOString(), hour: now.getHours(), weekday: now.getDay(), mood: state.mood,
    a: a.id, b: b.id, an: a.name, bn: b.name, pick,
    ra: rawFeatures(a), rb: rawFeatures(b), pa: pierreOf(a, model), pb: pierreOf(b, model),
  });
  state.undo = { kind: 'choice', pair: [...state.pair] };
  refit();
  pickNewPair();
  save();
  renderPair();
  renderLearned();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setVerdict(id, verdict) {
  if (!verdict) delete state.verdicts[id];
  else state.verdicts[id] = { verdict, why: state.verdicts[id]?.why ?? '', source: 'page', at: new Date().toISOString() };
  refit();
  save();
  renderPair();
  renderLearned();
  renderMine();
}

// ── What Marco learned ──────────────────────────────────────────────────────
function renderLearned() {
  const { fit, pierre } = state;
  const body = [];
  const n = fit.n;
  if (n === 0) {
    body.push(h('p', { class: 'mini' }, 'Nothing yet. These are Marco’s starting guesses; every pick moves them.'));
  } else {
    const loo = fit.looHits != null ? `Marco now predicts ${fit.looHits} of your ${n} picks without seeing them` : `Marco matches ${fit.hits} of your ${n} picks`;
    body.push(h('p', { class: 'beats' }, h('strong', {}, `${loo}.`), ` His starting guesses got ${fit.priorHits}.`));
  }
  if (state.lastMove) {
    const m = state.lastMove;
    const line = m.key === 'pierre'
      ? `Moved: a Pierre pass over a fail is now worth ${fmt(-2 * m.gramsPerUnit)} g protein (was ${fmt(-2 * m.before.gramsPerUnit)})`
      : `Moved: ${m.label} now cost ${fmt(m.gramsPerUnit)} g protein each (was ${fmt(m.before.gramsPerUnit)})`;
    body.push(h('p', { class: 'fallback-note' }, line));
  }

  // Weights, in grams of protein: the one currency everyone can feel.
  const rows = explainWeights(fit.theta).filter((w) => w.key !== 'protein');
  const table = h('table', { class: 'parts' },
    h('thead', {}, h('tr', {}, h('th', {}, 'One more…'), h('th', { class: 'num' }, 'costs'), h('th', { class: 'num' }, 'start'))),
    h('tbody', {}, ...rows.map((w) => {
      const start = explainWeights(FEATURES.map((f) => f.prior)).find((s) => s.key === w.key);
      const g = (x) => (x == null ? '–' : w.key === 'pierre' ? `${fmt(-2 * x)} g` : `${fmt(x)} g`);
      const label = w.key === 'pierre' ? 'Pierre pass vs fail (worth)' : w.key === 'prePrep' ? 'pre-prep (a 15 min soak)' : w.label.replace(/s$/, '').replace(/minute$/, 'minute');
      return h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, g(w.gramsPerUnit)), h('td', { class: 'num muted' }, g(start.gramsPerUnit)));
    })));
  body.push(h('p', { class: 'mini' }, 'Each line is how many grams of protein you’d give up to avoid it.'), table);

  const moods = Object.entries(fit.lambdas).filter(([m, l]) => m !== 'okay' && l !== 1);
  if (moods.length) {
    body.push(h('p', { class: 'mini' }, moods.map(([m, l]) => `${m[0].toUpperCase()}${m.slice(1)}: effort feels ${fmt(l, 2)}× as heavy as on an okay night.`).join(' ')));
  }

  const ps = pierreSummary(pierre);
  const chipRow = (title, list, cls) => (list.length ? h('div', { class: 'group' }, h('h3', {}, title), h('div', { class: 'reasons' }, ...list.map((t) => h('span', { class: cls }, t.label)))) : null);
  const judged = Object.keys(state.verdicts).length;
  body.push(h('h3', { class: 'sub' }, `Pierre (${judged} verdicts)`));
  body.push(chipRow('Likes', ps.likes, 'like') ?? h('p', { class: 'mini' }, 'No strong likes yet.'));
  body.push(chipRow('Dislikes', ps.dislikes, 'dislike') ?? h('p', { class: 'mini' }, 'No strong dislikes yet.'));
  $('learned-body').replaceChildren(...body.filter(Boolean));
}

// ── Your dishes ─────────────────────────────────────────────────────────────
function renderMine() {
  $('mine-count').textContent = state.mine.length ? `${state.mine.length}` : '';
  $('mine-list').replaceChildren(...state.mine.map((d) => {
    const v = state.verdicts[d.id];
    return h('li', {},
      h('div', { class: 'other-head' }, h('strong', {}, d.name), h('span', { class: `pass ${v?.verdict === 'pass' ? 'win' : ''}` }, v ? `Pierre: ${v.verdict}` : '')),
      h('p', { class: 'mini' }, facts(d).join(' · ')),
      h('div', { class: 'row tight' },
        h('button', { class: 'btn link', type: 'button', onclick: () => editDish(d.id) }, 'Edit'),
        h('button', { class: 'btn link quiet', type: 'button', onclick: (e) => removeDish(d.id, e.currentTarget) }, 'Delete')));
  }));
}

function renderToolChips(selected = []) {
  $('d-tools').replaceChildren(...FORM_TOOLS.map(([id, label]) => h('button', {
    type: 'button', class: 'chip toggle', role: 'checkbox', 'data-id': id, 'aria-checked': String(selected.includes(id)),
    onclick: (e) => { const b = e.currentTarget; b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')); },
  }, label)));
}

function setFormVerdict(v) {
  state.formVerdict = v;
  for (const b of $('d-verdict').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === v));
}

const FIELDS = ['handsOn', 'waiting', 'peels', 'cuts', 'steps', 'cleanup', 'protein'];

function resetForm() {
  $('dish-form').reset();
  state.editing = null;
  renderToolChips();
  setFormVerdict(null);
  $('d-cancel').hidden = true;
  ($('d-save').querySelector('.lbl') ?? $('d-save')).textContent = 'Save dish';
}

/** Turns the form into a dish the brain can read (counts win over guesses). */
function dishFromForm() {
  const tools = [...$('d-tools').querySelectorAll('[aria-checked=true]')].map((b) => b.dataset.id);
  const names = $('d-ingredients').value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const ingredients = names.map((name) => {
    const id = matchName(name);
    return FOODS[id] ? { id, name, prep: 'measure' } : { id: null, name, prep: 'measure' };
  });
  const num = (id) => Math.max(0, Number($(`d-${id}`).value) || 0);
  const counts = Object.fromEntries(FIELDS.map((k) => [k, num(k)]));
  const greasy = Number($('d-greasy').value) || 0;
  counts.cleanup += 1.5 * greasy;
  counts.tools = tools.length;
  counts.attention = Number($('d-attention').value);
  counts.prePrepMinutes = Number($('d-prePrep').value) || 0;
  return {
    id: state.editing ?? `mine_${Date.now().toString(36)}`,
    name: $('d-name').value.trim().slice(0, 80),
    kind: 'meal',
    origin: 'mine',
    how: $('d-how').value.trim().slice(0, 1200),
    equipment: tools.filter((t) => EQUIPMENT[t] || t === 'pan' || t === 'pot'),
    utensils: tools.filter((t) => ASSUMED_BASICS[t]),
    ingredients: ingredients.filter((i) => i.id),
    ingredientNames: names,
    stars: ingredients.map((i) => i.id).filter((id) => id && ['protein', 'dairy', 'grain', 'bread'].includes(FOODS[id]?.group)),
    counts,
    form: { greasy, cleanupDishes: num('cleanup'), tools },
    prePrep: counts.prePrepMinutes ? { minutes: counts.prePrepMinutes, text: $('d-prePrepText').value.trim().slice(0, 120) } : null,
  };
}

function saveDish(e) {
  e?.preventDefault();
  const dish = dishFromForm();
  if (!dish.name) {
    $('d-name').focus();
    return;
  }
  const i = state.mine.findIndex((d) => d.id === dish.id);
  if (i >= 0) state.mine[i] = dish;
  else state.mine.push(dish);
  if (state.formVerdict) state.verdicts[dish.id] = { verdict: state.formVerdict, why: $('d-why').value.trim().slice(0, 140), source: 'page', at: new Date().toISOString() };
  resetForm();
  refit();
  save();
  renderMine();
  renderPair();
  renderLearned();
}

function editDish(id) {
  const d = state.mine.find((x) => x.id === id);
  if (!d) return;
  state.editing = id;
  $('d-name').value = d.name;
  $('d-how').value = d.how ?? '';
  $('d-ingredients').value = (d.ingredientNames ?? []).join(', ');
  for (const k of FIELDS) $(`d-${k}`).value = k === 'cleanup' ? d.form?.cleanupDishes ?? d.counts.cleanup : d.counts[k] ?? 0;
  $('d-greasy').value = String(d.form?.greasy ?? 0);
  $('d-attention').value = String(d.counts.attention ?? 1);
  $('d-prePrep').value = String(d.counts.prePrepMinutes ?? 0);
  $('d-prePrepText').value = d.prePrep?.text ?? '';
  renderToolChips(d.form?.tools ?? []);
  setFormVerdict(state.verdicts[id]?.verdict ?? null);
  $('d-why').value = state.verdicts[id]?.why ?? '';
  $('d-cancel').hidden = false;
  ($('d-save').querySelector('.lbl') ?? $('d-save')).textContent = 'Update dish';
  $('add-dish').open = true;
  $('add-dish').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function removeDish(id, btn) {
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Tap again to delete';
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete'; }, 3000);
    return;
  }
  state.mine = state.mine.filter((d) => d.id !== id);
  delete state.verdicts[id];
  refit();
  save();
  renderMine();
  renderPair();
  renderLearned();
}

/** Accepts dishes Claude formats from a chat message: an array, or {dishes: [...]}. */
function importDishes() {
  const status = $('import-status');
  let data;
  try {
    data = JSON.parse($('import-text').value);
  } catch {
    status.textContent = 'That isn’t valid JSON. Paste exactly what Claude sent.';
    return;
  }
  const list = Array.isArray(data) ? data : data?.dishes;
  if (!Array.isArray(list)) {
    status.textContent = 'Expected a list of dishes.';
    return;
  }
  let added = 0;
  for (const [k, raw] of list.entries()) {
    if (!raw?.name) continue;
    const c = raw.counts ?? {};
    const id = raw.id && /^mine_[\w-]+$/.test(raw.id) ? raw.id : `mine_${Date.now().toString(36)}_${k}`;
    const tools = Array.isArray(raw.tools) ? raw.tools.map(String) : [];
    const names = Array.isArray(raw.ingredients) ? raw.ingredients.map(String) : [];
    const ids = names.map(matchName).filter((x) => FOODS[x]);
    const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : d);
    const dish = {
      id, name: String(raw.name).slice(0, 80), kind: 'meal', origin: 'mine', how: String(raw.how ?? '').slice(0, 1200),
      equipment: tools.filter((t) => EQUIPMENT[t] || t === 'pan' || t === 'pot'),
      utensils: tools.filter((t) => ASSUMED_BASICS[t]),
      ingredients: ids.map((x) => ({ id: x, prep: 'measure' })),
      ingredientNames: names,
      stars: ids.filter((x) => ['protein', 'dairy', 'grain', 'bread'].includes(FOODS[x]?.group)),
      methods: Array.isArray(raw.methods) ? raw.methods.map(String) : undefined,
      counts: {
        protein: n(c.protein, 15), tools: n(c.tools, tools.length), handsOn: n(c.handsOn, 5), waiting: n(c.waiting),
        prePrepMinutes: n(c.prePrepMinutes), peels: n(c.peels), cuts: n(c.cuts), steps: n(c.steps, 2),
        attention: Math.min(3, n(c.attention, 1)), cleanup: n(c.cleanup, 1),
      },
      form: { greasy: 0, cleanupDishes: n(c.cleanup, 1), tools: tools.filter((t) => FORM_TOOLS.some(([f]) => f === t)) },
      prePrep: n(c.prePrepMinutes) ? { minutes: n(c.prePrepMinutes), text: String(raw.prePrep ?? '').slice(0, 120) } : null,
    };
    const i = state.mine.findIndex((d) => d.id === id);
    if (i >= 0) state.mine[i] = dish;
    else state.mine.push(dish);
    if (VERDICT_VALUE[raw.pierre] != null) state.verdicts[id] = { verdict: raw.pierre, why: String(raw.why ?? '').slice(0, 140), source: 'import' };
    added++;
  }
  status.textContent = added ? `Added ${added} ${added === 1 ? 'dish' : 'dishes'}.` : 'No dishes with a name found.';
  if (added) $('import-text').value = '';
  refit();
  save();
  renderMine();
  renderPair();
  renderLearned();
}

// ── Wacky ideas from the AI ─────────────────────────────────────────────────
function wackyPrompt() {
  const foods = Object.keys(FOODS).filter((id) => !['chicken', 'tuna'].includes(id)).join(', ');
  const kit = [...Object.keys(EQUIPMENT), 'stovetop', 'pot', 'pan'].join(', ');
  const already = pool().map((d) => d.name).join('; ');
  return `You invent dishes for a home cook in India so they can judge them. Vegetarian plus eggs only: no meat, no fish.

Invent 4 dishes that are deliberately different from each other: one wacky or silly, one austere (almost no effort), one lazy but tasty, and one more elaborate that might need soaking or marinating ahead. Do not repeat any of these: ${already}.

Food ids (use ONLY these): ${foods}
Kit ids (use ONLY these): ${kit}
Small utensils: ${Object.keys(ASSUMED_BASICS).join(', ')}

Respond with ONLY a JSON object, no markdown, of exactly this form:
{"recipes": [{
  "name": string,
  "kind": "meal",
  "equipment": [kit ids],
  "utensils": [small utensil ids],
  "ingredients": [{"id": food id, "amount": string, "prep": "ready"|"measure"|"wash"|"crack"|"crumble"|"peel_chop", "optional": boolean}],
  "steps": [{"text": string, "active": minutes busy, "passive": minutes waiting}],
  "prePrep": {"minutes": number, "text": string} or null,
  "attention": 0-3,
  "cleanup": {"dishes": number, "greasy": 0-2},
  "macros": {"protein": grams, "kcal": number, "fiber": grams}
}]}
Honest numbers for one serving. Steps are one short sentence each.`;
}

let wackyBusy = false;
async function inventWacky() {
  const ai = store.get('ai', null);
  const status = $('wacky-status');
  if (!ai?.apiKey) {
    status.textContent = 'Save an AI key on the Marco page first.';
    return;
  }
  if (wackyBusy) return;
  wackyBusy = true;
  $('wacky-go').disabled = true;
  status.textContent = 'Inventing…';
  try {
    const { text, model } = await callModel({
      provider: ai.provider, apiKey: ai.apiKey, model: ai.model, models: ai.models ?? [],
      prompt: wackyPrompt(), deadlineMs: 15000, maxTokens: 2500, parallel: 1, copies: 2, hedgeMs: 4000,
      onStatus: (s) => { status.textContent = s; },
    });
    const obj = parseJsonObject(text);
    if (!obj || !Array.isArray(obj.recipes)) throw new Error('the answer wasn’t a recipe list');
    const stamp = Date.now().toString(36);
    const added = [];
    const rejected = [];
    obj.recipes.slice(0, 6).forEach((raw, i) => {
      const v = validateMeal(raw, { index: i, kind: 'meal' });
      if (!v.ok) return rejected.push(`${raw?.name ?? 'a dish'}: ${v.errors[0]}`);
      if (!inDiet(v.meal)) return rejected.push(`${v.meal.name}: not vegetarian`);
      const mins = Number(raw.prePrep?.minutes);
      added.push({
        ...v.meal, id: `ai_${stamp}_${i}`, origin: 'ai', model,
        prePrep: mins > 0 ? { minutes: Math.min(mins, 1440), text: String(raw.prePrep.text ?? '').slice(0, 120) } : null,
      });
    });
    state.ai.push(...added);
    refit();
    save();
    status.textContent = `${added.length} new ${added.length === 1 ? 'dish' : 'dishes'} in the pairs (${model}).${rejected.length ? ` Dropped: ${rejected.join('; ')}.` : ''}`;
    renderWackyCount();
    renderLearned();
  } catch (e) {
    status.textContent = `Couldn’t invent dishes: ${e.detail ?? e.message ?? e}`;
  } finally {
    wackyBusy = false;
    $('wacky-go').disabled = false;
  }
}

function renderWackyCount() {
  $('wacky-count').textContent = state.ai.length ? `${state.ai.length} in the pairs` : '';
}

// ── Export and reset ────────────────────────────────────────────────────────
function exportData() {
  const { fit } = state;
  const weights = explainWeights(fit.theta).map((w) => ({ key: w.key, theta: +w.theta.toFixed(3), prior: w.prior, gramsPerUnit: w.gramsPerUnit == null ? null : +w.gramsPerUnit.toFixed(2) }));
  const ps = pierreSummary(state.pierre, { top: 8, min: 0.05 });
  const payload = {
    app: 'marco-train', version: VERSION, exportedAt: new Date().toISOString(),
    fit: { n: fit.n, hits: fit.hits, looHits: fit.looHits, priorHits: fit.priorHits, outside: +fit.outside.toFixed(3), lambdas: fit.lambdas, weights },
    pierre: { bias: +state.pierre.bias.toFixed(3), likes: ps.likes.map((t) => [t.tag, +t.weight.toFixed(2)]), dislikes: ps.dislikes.map((t) => [t.tag, +t.weight.toFixed(2)]) },
    choices: state.choices,
    verdicts: state.verdicts,
    mine: state.mine,
    ai: state.ai,
  };
  const text = `Marco pick-two export (${VERSION}):\n${JSON.stringify(payload)}`;
  const btn = $('export');
  const lbl = btn.querySelector('.lbl') ?? btn;
  navigator.clipboard?.writeText(text).then(() => { lbl.textContent = 'Copied'; setTimeout(() => { lbl.textContent = 'Copy for Claude'; }, 2000); }, () => { lbl.textContent = 'Copy failed'; });
}

function reset(e) {
  const btn = e.currentTarget;
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Tap again: erase picks, verdicts and dishes';
    setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Start over'; }, 4000);
    return;
  }
  btn.classList.remove('armed');
  btn.textContent = 'Start over';
  Object.assign(state, { choices: [], verdicts: seededVerdicts(), mine: [], ai: [], pair: null, undo: null, lastMove: null, fit: null });
  refit();
  save();
  renderAll();
}

function undo() {
  if (!state.undo) return;
  state.choices.pop();
  state.pair = state.undo.pair;
  state.undo = null;
  state.lastMove = null;
  refit();
  save();
  renderPair();
  renderLearned();
}

// ── Haptics: Kiron's invisible real iOS switch ──────────────────────────────
function addHaptics(root = document) {
  for (const btn of root.querySelectorAll('[data-haptic]:not(.has-haptic)')) {
    btn.classList.add('has-haptic');
    btn.replaceChildren(h('span', { class: 'lbl' }, btn.textContent));
    btn.append(h('input', { type: 'checkbox', switch: true, class: 'haptic', tabindex: '-1', 'aria-hidden': 'true' }));
  }
}

function renderMood() {
  for (const b of $('mood').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.mood));
}

function renderAll() {
  renderMood();
  renderPair();
  renderLearned();
  renderMine();
  renderWackyCount();
  addHaptics();
}

function init() {
  $('version').textContent = `Marco ${VERSION} · trainer`;
  $('d-prePrep').replaceChildren(...PRE_PREP_OPTIONS.map(([v, l]) => h('option', { value: String(v) }, l)));
  renderToolChips();
  $('mood').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (!v) return;
    state.mood = v;
    save();
    renderMood();
  });
  $('neither').addEventListener('click', () => choose('neither'));
  $('skip').addEventListener('click', () => { pickNewPair(); state.undo = null; renderPair(); addHaptics(); });
  $('undo').addEventListener('click', () => { undo(); addHaptics(); });
  $('d-verdict').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (v) setFormVerdict(state.formVerdict === v ? null : v);
  });
  // The save button carries a haptic switch, which swallows a native submit; save on click instead.
  $('d-save').addEventListener('click', () => { saveDish(); addHaptics(); });
  $('dish-form').addEventListener('submit', (e) => { saveDish(e); addHaptics(); });
  $('d-cancel').addEventListener('click', resetForm);
  $('import-go').addEventListener('click', () => { importDishes(); addHaptics(); });
  $('wacky-go').addEventListener('click', inventWacky);
  $('export').addEventListener('click', exportData);
  $('reset').addEventListener('click', reset);
  // Re-wire haptics on anything rendered later (pair cards).
  new MutationObserver(() => addHaptics($('pair'))).observe($('pair'), { childList: true });
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-haptic]') && !('switch' in HTMLInputElement.prototype) && navigator.vibrate) navigator.vibrate(8);
  });
  refit();
  renderAll();
}

init();
