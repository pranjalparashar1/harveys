// The home page (1.60.0): Harvey's as an app, not a demo. The kitchen you confirm once is kept
// on this phone (src/brain/kitchen-store.js), so a returning visit opens straight on White's
// effort ladder with no scan and no network. A first visit gets three ways in: scan, start from a
// kitchen like yours, or paste a list. All three go through the same confirm screens the taste
// test uses (rung-quiz-ui.js startKitchenSetup), then the ladder.
//
// The taste test moved to rate.html; an old tester link that lands here goes there (index.html
// does it before this file loads, and so does this file). All decisions come from src/brain/.

import {
  CATALOGUE, DEFAULT_CONFIG, buildInventory, parseItemList, labelFor, rank, PIERRE_SEED,
  cookLogEntry, liveRepairEntry, liveVerdicts, encodeLiveEvent, soakNeeds, importKitchens, looksLikeKitchenJson,
  classifyPrompt, parseClassification,
} from './brain/index.js';
import { expandTemplates } from './brain/templates.js';
import { PROVIDERS, DEFAULT_MODEL, allowedModels, detectProvider, checkKey, pickModel, callModel, AIError } from './ai/providers.js';
import { scanReady, scanPhotos, checkFreeScan } from './ai/scan.js';
import { prepareMedia, isVideo } from './ai/images.js';
import { startKitchenSetup, startKitchenPicker } from './rung-quiz-ui.js';
import { addChoices, searchAdd, searchNote, matchTyped } from './brain/confirm.js';
import {
  loadKitchen, saveKitchen, encodeBackup, decodeBackup, backupLink, restoreCode, kitchenGroups,
  countItems, withoutIds, withItems, ranOutChoices, itemId,
} from './brain/kitchen-store.js';
import { rateRedirect } from './brain/share-link.js';
import { norm } from './brain/feedback.js';
import { reloadIfStale } from './fresh.js';
import { queueLiveEvent, deviceId, newEventId } from './send.js';

const VERSION = '1.64.0';
const MAX_PHOTOS = 8;
const SCAN_DEADLINE_MS = 12000;
const $ = (id) => document.getElementById(id);

// ── Storage: the same marco.* keys the workbench uses, so nothing is lost ───
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`marco.${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { if (value == null) localStorage.removeItem(`marco.${key}`); else localStorage.setItem(`marco.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const soakedToday = () => { const s = store.get('soaked', null); return s?.day === today() && Array.isArray(s.ids) ? s.ids : []; };
const OWNER_KEY = 'harveys.owner.v1';
const isOwner = () => { try { const t = Number(localStorage.getItem(OWNER_KEY)); return t > 0 && Date.now() - t < 30 * 864e5; } catch { return false; } };

const savedCtx = store.get('context', {});
const state = {
  kitchen: loadKitchen(),
  ai: store.get('ai', null),
  pantry: store.get('pantry', {}),
  soaked: soakedToday(),
  ctx: { kind: savedCtx.kind === 'snack' ? 'snack' : 'meal', targets: { protein: 40, calories: 800, fiber: 15, ...(savedCtx.targets ?? {}) } },
  cookLog: store.get('cookLog', []),
  liveRepairs: store.get('liveRepairs', []),
  cookedNow: new Set(),
  photos: [],
  scanFrom: 'welcome',
  result: null,
  ranout: null, // { name, choices, gone: Map(id → removed items) } after Cooked this
  fixing: null,
  sheet: null, // { off: Set(norm name), choices, q }
};

// ── DOM helpers (text only: nothing from an AI or a list can inject markup) ──
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
const show = (el, on = true) => { if (el) el.hidden = !on; };
const svg = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = d; return s; };
const TICK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const mins = (n) => `${Math.max(1, Math.round(n))} min`;
const cap = (s) => String(s ?? '').replace(/^./, (c) => c.toUpperCase());

// The iOS haptic: one hidden switch, ticked during the tap (as rung-quiz-ui.js does).
let hapticEl = null;
function buzz(ms = 8) {
  if ('switch' in HTMLInputElement.prototype) {
    try {
      if (!hapticEl) {
        hapticEl = h('label', { 'aria-hidden': 'true', style: 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;' });
        hapticEl.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.append(hapticEl);
      }
      hapticEl.click();
    } catch { /* no haptic */ }
  } else if (navigator.vibrate) try { navigator.vibrate(ms); } catch { /* none */ }
}

let toastEl = null;
let toastT = 0;
function toast(text) {
  if (!toastEl) { toastEl = h('div', { class: 'rq-toast', role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
  toastEl.textContent = text;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ── Views ───────────────────────────────────────────────────────────────────
function view(name) {
  for (const id of ['welcome', 'scan-view', 'home']) show($(id), id === name);
  $('app').removeAttribute('aria-busy');
  window.scrollTo(0, 0);
}

function showWelcome(error = '') {
  const err = $('welcome-error');
  err.textContent = error;
  show(err, !!error);
  view('welcome');
}

function showHome() {
  view('home');
  decide();
}

// ── The kitchen ─────────────────────────────────────────────────────────────
const missingBasics = () => state.kitchen?.missingBasics ?? store.get('missingBasics', []);
const inventory = () => buildInventory(state.kitchen?.items ?? [], { missingBasics: missingBasics(), cache: state.pantry });

function setKitchen(patch) {
  state.kitchen = saveKitchen({ ...(state.kitchen ?? { missingBasics: missingBasics() }), ...patch });
  renderCount();
  return state.kitchen;
}

function renderCount() {
  $('kitchen-count').textContent = String(state.kitchen ? countItems(state.kitchen.items, state.pantry) : 0);
}

/** The setup screens are done: keep the kitchen, show the ladder. */
function setupDone({ items, ways }) {
  const k = setKitchen({ items, ways });
  if (!k) return showWelcome('Nothing in the kitchen yet. Add a few things and try again.');
  state.cookedNow.clear();
  showHome();
  classifyUnknown();
}

function setupFrom(items, { merge = false } = {}) {
  const list = merge && state.kitchen ? withItems(items, state.kitchen.items) : items;
  startKitchenSetup({ items: list, cache: state.pantry, missingBasics: missingBasics(), ways: state.kitchen?.ways ?? null, version: VERSION, onDone: setupDone, onExit: () => {} });
}

// Names the vocabulary doesn't know go to flash-lite once (with your own key); kept in this browser.
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
    if (!$('home').hidden) decide();
  } catch { /* unknown names still count as plain extras */ } finally { classifying = false; }
}

// ── Decide: White's ladder, from the saved kitchen, no network ──────────────
function moment() { const n = new Date(); return { hour: n.getHours(), weekday: n.getDay() }; }

function decide() {
  if (!state.kitchen) return;
  state.soaked = soakedToday();
  const inv = inventory();
  state.result = rank({
    inventory: inv,
    targets: state.ctx.targets,
    context: { kind: state.ctx.kind, ...moment() },
    catalogue: expandTemplates(CATALOGUE, inv),
    config: DEFAULT_CONFIG,
    verdicts: { ...PIERRE_SEED, ...liveVerdicts(state.liveRepairs) },
    soaked: state.soaked,
  });
  renderHome();
}

function renderHome() {
  renderCount();
  for (const b of $('kind').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.value === state.ctx.kind));
  renderSoaked();
  renderLadder(state.result);
  renderExtras(state.result);
}

const SOAK_FOODS = [...new Set(CATALOGUE.flatMap(soakNeeds))];
function renderSoaked() {
  const have = inventory().have;
  const foods = SOAK_FOODS.filter((id) => have.has(id));
  show($('soaked-wrap'), foods.length > 0);
  $('soaked').replaceChildren(...foods.map((id) => {
    const on = state.soaked.includes(id);
    return h('button', { class: `hm-chip${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: () => toggleSoaked(id) }, labelFor(id));
  }));
}
function toggleSoaked(id) {
  buzz();
  state.soaked = state.soaked.includes(id) ? state.soaked.filter((x) => x !== id) : [...state.soaked, id];
  store.set('soaked', { day: today(), ids: state.soaked });
  decide();
}

// ── The ladder ──────────────────────────────────────────────────────────────
function pips(n) {
  return h('span', { class: 'hm-pips', 'aria-label': `Effort ${n} of 4` }, [1, 2, 3, 4].map((i) => h('i', { class: i <= n ? 'on' : '' })));
}

function metaLine(r) {
  const parts = [mins(r.raw.handsOn)];
  if (r.raw.waiting) parts.push(`+ ${mins(r.raw.waiting)} waiting`);
  parts.push(`${Math.round(r.meal.macros.protein)} g protein`);
  return parts.join(' · ');
}

/** A floor dish's lift, in plain words. Pierre's other reasons stay in the workbench. */
function liftLine(p) {
  if (p?.tier !== 'floor') return null;
  const add = p.upgrade?.add ?? p.repairs?.[0]?.suggest;
  return add ? h('p', { class: 'hm-lift' }, `Better with ${labelFor(add).toLowerCase()}`) : null;
}

function recipeFold(r) {
  const steps = r.meal.steps.map((st) => h('li', {}, st.text));
  if (r.assemblyStep) steps.push(h('li', {}, r.assemblyStep));
  const kit = [...r.used.equipment, ...r.used.utensils].map(labelFor);
  return h('details', { class: 'hm-recipe' },
    h('summary', {}, 'Recipe'),
    h('div', { class: 'hm-recipe-in' },
      h('p', { class: 'hm-label' }, 'You need'),
      h('ul', { class: 'hm-ings' }, r.used.ingredients.map((i) => h('li', {}, h('b', {}, i.label ?? labelFor(i.id)), h('span', {}, `${i.amount ?? ''}${i.optional ? ' · optional' : ''}`)))),
      kit.length ? h('p', { class: 'hm-kit' }, kit.join(' · ')) : null,
      h('p', { class: 'hm-label' }, 'Steps'),
      h('ol', { class: 'hm-steps' }, steps),
      h('p', { class: 'hm-macros' }, `${r.meal.macros.protein} g protein · ${r.meal.macros.kcal} kcal · ${r.meal.macros.fiber} g fiber`)));
}

// 1.64.0: saved on the phone first, then sent home in the background (src/send.js). Never in the way.
function sendLive(kind, entry) {
  try { queueLiveEvent(encodeLiveEvent({ kind, entry, deviceId: deviceId(), eventId: newEventId(), version: VERSION })); } catch { /* the local copy is what counts */ }
}

const TIERS_YOU_SAY = [['veto', 'Veto'], ['floor', 'Floor'], ['pass', 'Pass'], ['crave', 'Crave']];
function fixDrawer(r) {
  const note = h('input', { type: 'text', class: 'hm-fix-note', placeholder: 'What would fix it?', 'aria-label': `What would fix ${r.meal.name}` });
  return h('div', { class: 'hm-fix' },
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Your tier' },
      TIERS_YOU_SAY.map(([tier, label]) => h('button', { type: 'button', 'aria-checked': String(r.pierre.tier === tier), onclick: () => saveLiveRepair(r, tier, note.value) }, label))),
    note);
}
function saveLiveRepair(r, tier, fix) {
  buzz();
  const entry = liveRepairEntry({ item: r, tier, fix, at: new Date().toISOString() });
  state.liveRepairs = [...state.liveRepairs, entry].slice(-200);
  store.set('liveRepairs', state.liveRepairs);
  sendLive('repair', entry);
  state.fixing = null;
  decide();
}

function dishBlock(r, main) {
  const id = r.meal.id;
  const done = state.cookedNow.has(id);
  const owner = isOwner();
  const fixing = owner && state.fixing === id;
  return h('div', { class: `hm-dish${main ? ' main' : ''}` },
    h(main ? 'h2' : 'h3', { class: 'hm-dname' }, r.meal.name, r.pierre?.tier === 'crave' ? h('span', { class: 'hm-crave' }, 'Crave') : null),
    h('p', { class: 'hm-meta' }, metaLine(r)),
    liftLine(r.pierre),
    r.prePrepNote ? h('p', { class: 'hm-pre' }, `If you have time: ${r.prePrepNote}`) : null,
    recipeFold(r),
    h('div', { class: 'hm-acts' },
      h('button', { class: `btn hm-cook${main ? ' main' : ''}${done ? ' done' : ''}`, type: 'button', 'aria-pressed': String(done), onclick: () => cookedThis(r) },
        done ? [svg(TICK), 'Cooked'] : 'Cooked this'),
      owner ? h('button', { class: 'btn link quiet', type: 'button', 'aria-expanded': String(fixing), onclick: () => { state.fixing = fixing ? null : id; renderLadder(state.result); } }, 'Fix / Veto') : null),
    fixing ? fixDrawer(r) : null);
}

function rungCard(g, i) {
  const alts = g.alternatives;
  return h('article', { class: `hm-rung r${g.rung}`, style: `--i:${i}` },
    h('p', { class: 'hm-rung-head' }, pips(g.rung), h('span', {}, g.name)),
    dishBlock(g.pick, true),
    alts.length ? h('details', { class: 'hm-alts' },
      h('summary', {}, `${alts.length} more like this`),
      h('div', { class: 'hm-alts-in' }, alts.map((r) => dishBlock(r, false)))) : null);
}

let shownOnce = false;
function renderLadder(result) {
  const root = $('ladder');
  if (!result) return root.replaceChildren();
  // Keep the folds the person opened when the ladder re-ranks.
  const open = new Set([...root.querySelectorAll('details[open]')].map((d) => d.dataset.key));
  let cards;
  if (!result.ladder.length) {
    cards = [h('section', { class: 'hm-empty' },
      h('h2', {}, `No ${state.ctx.kind === 'snack' ? 'snack' : 'meal'} fits yet`),
      result.unlocks[0] ? h('p', {}, 'Get ', h('b', {}, result.unlocks[0].label.toLowerCase()), ` and you can make ${result.unlocks[0].meals.slice(0, 2).join(' or ')}.`) : null,
      h('button', { class: 'btn primary wide', type: 'button', onclick: openSheet }, 'Add to my kitchen'))];
  } else {
    cards = result.ladder.map(rungCard);
  }
  root.classList.toggle('enter', !shownOnce);
  shownOnce = true;
  root.replaceChildren(...cards);
  root.querySelectorAll('details').forEach((d, i) => {
    d.dataset.key = `${d.className}:${d.closest('.hm-dish')?.querySelector('.hm-dname')?.textContent ?? d.closest('.hm-rung')?.className ?? i}`;
    if (open.has(d.dataset.key)) d.open = true;
  });
}

function renderExtras(result) {
  const cards = [];
  if (result?.tomorrow?.length) {
    cards.push(h('section', { class: 'hm-card' },
      h('p', { class: 'hm-label' }, 'For tomorrow'),
      h('ul', { class: 'hm-list' }, result.tomorrow.slice(0, 4).map((t) => h('li', {},
        h('b', {}, t.meal.name),
        h('span', {}, `Soak the ${t.soak.map((id) => labelFor(id).toLowerCase()).join(' and ')} tonight`))))));
  }
  if (result?.ladder.length && result.unlocks.length) {
    cards.push(h('section', { class: 'hm-card' },
      h('p', { class: 'hm-label' }, 'One thing to buy'),
      h('ul', { class: 'hm-list' }, result.unlocks.slice(0, 3).map((u) => h('li', {},
        h('b', {}, u.label),
        h('span', {}, `${u.meals.length} more: ${u.meals.slice(0, 3).join(', ')}${u.meals.length > 3 ? '…' : ''}`))))));
  }
  $('extras').replaceChildren(...cards);
}

// ── Cooked this → "Ran out of any of these?" ────────────────────────────────
function cookedThis(r) {
  if (state.cookedNow.has(r.meal.id)) return;
  buzz(12);
  const entry = cookLogEntry({
    chosen: r,
    ladder: state.result.ladder,
    context: { kind: state.ctx.kind, ...moment(), targets: state.ctx.targets, soaked: state.soaked, page: 'home' },
    at: new Date().toISOString(),
  });
  state.cookLog = [...state.cookLog, entry].slice(-500);
  store.set('cookLog', state.cookLog);
  state.cookedNow.add(r.meal.id);
  sendLive('cook', entry);
  const have = inventory().have;
  const choices = ranOutChoices(r).filter((c) => have.has(c.id));
  renderLadder(state.result);
  if (!choices.length) return toast('Logged. Enjoy!');
  state.ranout = { name: r.meal.name, choices, gone: new Map() };
  renderRanout();
}

function renderRanout() {
  const box = $('ranout');
  const ro = state.ranout;
  show(box, !!ro);
  if (!ro) return box.replaceChildren();
  box.replaceChildren(h('div', { class: 'hm-ranout-in' },
    h('p', { class: 'hm-ranout-q' }, h('span', {}, `Cooked ${ro.name}`), 'Ran out of any of these?'),
    h('div', { class: 'hm-chips' }, ro.choices.map((c) => {
      const gone = ro.gone.has(c.id);
      return h('button', { class: `hm-chip${gone ? ' gone' : ''}`, type: 'button', 'aria-pressed': String(gone), onclick: () => toggleRanOut(c.id) }, c.label);
    })),
    h('button', { class: 'btn primary hm-ranout-done', type: 'button', onclick: () => { buzz(); state.ranout = null; renderRanout(); } }, ro.gone.size ? 'Done' : 'No, all good')));
  requestAnimationFrame(() => box.classList.add('show'));
}

function toggleRanOut(id) {
  buzz();
  const ro = state.ranout;
  if (ro.gone.has(id)) {
    setKitchen({ items: withItems(state.kitchen.items, ro.gone.get(id)) });
    ro.gone.delete(id);
  } else {
    const { items, removed } = withoutIds(state.kitchen.items, [id], state.pantry);
    ro.gone.set(id, removed);
    setKitchen({ items });
  }
  decide();
  renderRanout();
}

// ── My kitchen ──────────────────────────────────────────────────────────────
function openSheet() {
  buzz();
  state.ranout = null;
  renderRanout();
  state.sheet = { off: new Set(), choices: null, q: '' };
  $('find').value = '';
  $('backup-out').hidden = true;
  $('copy-backup').textContent = 'Copy backup link';
  disarmForget();
  renderSheet();
  renderFound();
  const d = $('kitchen-sheet');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  document.documentElement.classList.add('hm-sheet-open');
}

function closeSheet() {
  const d = $('kitchen-sheet');
  if (d.open) { if (d.close) d.close(); else { d.removeAttribute('open'); onSheetClosed(); } }
}

/** What the sheet changed lands when it closes: unticked items go, and the ladder re-ranks. */
function onSheetClosed() {
  document.documentElement.classList.remove('hm-sheet-open');
  const s = state.sheet;
  state.sheet = null;
  if (!s || !state.kitchen) return;
  if (s.off.size) setKitchen({ items: state.kitchen.items.filter((i) => !s.off.has(norm(i.name))) });
  if (!state.kitchen) return showWelcome();
  decide();
}

function sheetTile(item, kind) {
  const key = norm(item.name);
  const on = !state.sheet.off.has(key);
  const tile = h('button', { class: `rq-tile${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: () => {
    buzz();
    if (state.sheet.off.has(key)) state.sheet.off.delete(key); else state.sheet.off.add(key);
    const now = !state.sheet.off.has(key);
    tile.classList.toggle('on', now);
    tile.setAttribute('aria-pressed', String(now));
  } }, h('span', { class: 'rq-box', 'aria-hidden': 'true' }, svg(TICK)), h('span', { class: 'rq-tl' }, cap(item.name)));
  tile.dataset.kind = kind;
  return tile;
}

function renderSheet() {
  const g = kitchenGroups(state.kitchen?.items ?? [], state.pantry);
  const byName = (a, b) => a.item.name.localeCompare(b.item.name);
  const section = (label, rows, kind) => (rows.length ? [h('p', { class: 'rq-group' }, label), h('div', { class: 'rq-tiles' }, [...rows].sort(byName).map((r) => sheetTile(r.item, kind)))] : []);
  $('sheet-items').replaceChildren(...section('Food', g.food, 'food'), ...section('Cookware', g.kit, 'kit'));
}

/** Search results under Add more: what Harvey's knows that fits, then "Add “…”". */
function renderFound() {
  const box = $('found');
  const q = state.sheet.q.replace(/\s+/g, ' ').trim();
  if (!q) return box.replaceChildren();
  state.sheet.choices ??= addChoices(state.kitchen.items, { cache: state.pantry, missingBasics: missingBasics() });
  const groups = [...state.sheet.choices.food, ...state.sheet.choices.kit];
  const have = new Set(state.kitchen.items.map((i) => itemId(i, state.pantry)).filter(Boolean));
  const res = searchAdd(q, groups).filter((o) => !(o.id && have.has(o.id)));
  const rows = kitchenGroups(state.kitchen.items, state.pantry);
  const note = searchNote(q, [...rows.food, ...rows.kit].map((r) => ({ name: r.item.name, id: r.id })));
  const typedOn = state.kitchen.items.some((i) => norm(i.name) === norm(q));
  const tiles = res.map((o) => addTile(o.label, () => addToKitchen(o.id ? { name: o.label, canonical: o.id, category: o.group } : { name: o.text, canonical: null })));
  if (q.length >= 2 && note?.kind !== 'assumed' && !typedOn && !res.some((o) => o.how === 'exact') && !(note && !res.length)) {
    tiles.push(addTile(`Add “${q.slice(0, 60)}”`, () => { const m = matchTyped(q); addToKitchen({ name: m.text || q, canonical: m.id }); }, ' typed'));
  }
  const hint = note ? (note.kind === 'assumed' ? 'Salt and oil are always counted.' : `In your kitchen: ${note.names.join(', ')}`) : !res.length ? 'Nothing like that yet. Add it as typed:' : null;
  box.replaceChildren(...[hint ? h('p', { class: 'rq-hint' }, hint) : null, tiles.length ? h('div', { class: 'rq-tiles add' }, tiles) : null].filter(Boolean));
}
function addTile(label, onAdd, cls = '') {
  return h('button', { class: `rq-tile${cls}`, type: 'button', 'aria-pressed': 'false', onclick: onAdd }, h('span', { class: 'rq-box', 'aria-hidden': 'true' }, svg(TICK)), h('span', { class: 'rq-tl' }, label));
}
function addToKitchen(item) {
  buzz();
  setKitchen({ items: withItems(state.kitchen.items, [{ ...item, source: 'add' }]) });
  state.sheet.off.delete(norm(item.name));
  state.sheet.choices = null; // what's on offer changes with the kitchen
  state.sheet.q = '';
  $('find').value = '';
  toast(`Added ${item.name}`);
  renderSheet();
  renderFound();
}

async function copyBackup() {
  buzz();
  const btn = $('copy-backup');
  const k = state.sheet?.off.size ? { ...state.kitchen, items: state.kitchen.items.filter((i) => !state.sheet.off.has(norm(i.name))) } : state.kitchen;
  const code = await encodeBackup(k);
  if (!code) return;
  const link = backupLink(code, `${location.origin}${location.pathname}`);
  const out = $('backup-out');
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = 'Copied. Open it on any phone';
  } catch {
    out.value = link;
    out.hidden = false;
    out.select();
    btn.textContent = 'Copy this link';
  }
}

let forgetArmed = null;
function disarmForget() {
  clearTimeout(forgetArmed);
  forgetArmed = null;
  $('forget-kitchen').textContent = 'Start over';
  $('forget-kitchen').classList.remove('armed');
}
function forgetKitchen() {
  const btn = $('forget-kitchen');
  if (!forgetArmed) { btn.textContent = 'Tap again to clear this kitchen'; btn.classList.add('armed'); forgetArmed = setTimeout(disarmForget, 4000); return; }
  disarmForget();
  state.sheet = null;
  closeSheet();
  state.kitchen = saveKitchen(null);
  state.result = null;
  state.cookedNow.clear();
  showWelcome();
}

// ── Scan ────────────────────────────────────────────────────────────────────
function showScan(from) {
  state.scanFrom = from;
  show($('scan-error'), false);
  show($('scan-fallback'), false);
  renderKey();
  renderThumbs();
  view('scan-view');
  // 1.61.0: once the relay says the free scan is on, no key is needed and the key box hides.
  checkFreeScan().then(() => renderKey());
}

let editingKey = false;
function renderKey() {
  const ready = scanReady(state.ai);
  show($('key-saved'), !!state.ai && !editingKey);
  show($('key-box'), !ready || editingKey);
  if (state.ai) $('key-name').textContent = PROVIDERS[state.ai.provider]?.label.replace(/ \(.*\)$/, '') ?? 'AI key';
  const key = $('api-key').value.trim();
  const provider = detectProvider(key);
  $('detected').textContent = key ? (provider ? PROVIDERS[provider].label : 'Not a Gemini, Claude or OpenAI key') : '';
  $('detected').classList.toggle('ok', !!provider);
  $('save-key').disabled = !provider;
  renderScanButton();
}

async function saveKey() {
  const apiKey = $('api-key').value.trim();
  const provider = detectProvider(apiKey);
  if (!provider) return;
  const err = $('scan-error');
  show(err, false);
  $('save-key').disabled = true;
  $('save-key').textContent = 'Checking…';
  try {
    const models = await checkKey({ provider, apiKey });
    state.ai = { apiKey, provider, models, model: pickModel(provider, allowedModels(provider, models)) };
    editingKey = false;
  } catch (e) {
    if (e instanceof AIError && e.kind === 'invalidKey') { err.textContent = e.message; show(err); state.ai = null; } else {
      state.ai = { apiKey, provider, models: [], model: DEFAULT_MODEL[provider] };
      editingKey = false;
    }
  } finally {
    $('save-key').textContent = 'Save key';
    store.set('ai', state.ai);
    renderKey();
  }
}

function renderThumbs() {
  $('thumbs').replaceChildren(...state.photos.map((p, i) => h('li', {},
    h('img', { src: p.previewUrl, alt: `Photo ${i + 1}` }),
    h('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { state.photos.splice(i, 1); renderThumbs(); } }, '×'))));
  renderScanButton();
}
function renderScanButton() {
  const n = state.photos.length;
  const btn = $('scan');
  btn.disabled = !n || !scanReady(state.ai);
  btn.textContent = n ? `Scan ${n} photo${n === 1 ? '' : 's'}` : 'Scan';
}

async function addPhotos(fileList) {
  const files = Array.from(fileList ?? []); // copy first: iOS can empty a live FileList
  const err = $('scan-error');
  show(err, false);
  if (!files.length) return;
  const problems = [];
  let dropped = 0;
  for (const file of files) {
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) { dropped++; continue; }
    // 1.61.0: a video becomes up to 8 stills on the phone; only the stills are sent.
    $('photo-status').textContent = isVideo(file) ? 'Reading the video…' : 'Preparing…';
    try { state.photos.push(...(await prepareMedia(file, { maxFrames: room })).slice(0, room)); renderThumbs(); } catch (e) { problems.push(e.message); }
  }
  $('photo-status').textContent = '';
  if (dropped) problems.push(`Up to ${MAX_PHOTOS} photos; ${dropped} left out.`);
  if (problems.length) { err.textContent = problems.join(' '); show(err); }
  renderThumbs();
}

async function scan() {
  const btn = $('scan');
  const err = $('scan-error');
  show(err, false);
  show($('scan-fallback'), false);
  btn.disabled = true;
  btn.textContent = 'Looking…';
  btn.classList.add('shimmer');
  try {
    const items = await scanPhotos({ ai: state.ai, images: state.photos, deadlineMs: SCAN_DEADLINE_MS });
    if (!items.length) throw new AIError('malformedResponse', 'no items');
    state.photos = [];
    renderThumbs();
    setupFrom(items.map((i) => ({ ...i, source: 'scan' })), { merge: state.scanFrom === 'home' });
  } catch (e) {
    err.textContent = e instanceof AIError ? e.message : `Something went wrong: ${e.message}`;
    show(err);
    show($('scan-fallback'), !state.kitchen);
    // 1.61.0: free scans used up or off: your own key is the other way on.
    if (e instanceof AIError && ['freeLimit', 'scanOff', 'scanBroken'].includes(e.kind)) { editingKey = true; renderKey(); }
    // 1.64.0: the real cause, small and quiet under the error, for pranjal's testing ("gemini 400 … API_KEY_INVALID").
    if (e instanceof AIError && e.code && e.kind !== 'freeLimit') err.append(h('small', { class: 'hm-code' }, e.code));
  } finally {
    btn.classList.remove('shimmer');
    renderScanButton();
  }
}

// ── Start from a kitchen like yours ─────────────────────────────────────────
let personas = null;
async function openPersonas() {
  buzz();
  try {
    if (!personas) {
      const res = await fetch('data/test-kitchens/kitchens.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      personas = importKitchens(await res.text());
    }
  } catch {
    return showWelcome('Couldn’t load the kitchens. Check your connection and try again.');
  }
  if (!personas?.length) return showWelcome('No kitchens to start from yet.');
  startKitchenPicker({ kitchens: personas, release: true, onPick: (k) => setupFrom(k.items.map((i) => ({ ...i, source: 'persona' }))), onExit: () => {} });
}

// ── Paste a list, or use your own AI app ────────────────────────────────────
const LIST_PROMPT = 'Look at these photos of my kitchen. List every food, spice, sauce, appliance and pot or pan you can see, one per line, by its plain name (e.g. "eggs", "Amul butter", "pressure cooker"). No quantities, no headings, no comments.';

function pasteGo() {
  buzz();
  const text = $('paste-text').value;
  const kitchen = looksLikeKitchenJson(text) ? importKitchens(text)[0] : null;
  let items = kitchen?.items ?? null;
  if (!items) {
    // JSON that won't parse even after repair: take its "name" values, never its braces.
    const names = looksLikeKitchenJson(text) ? [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()) : [];
    items = (names.length ? [...new Set(names)] : parseItemList(text)).map((name) => ({ name, canonical: null, category: 'other', source: 'paste' }));
  }
  if (!items.length) { $('paste-text').focus(); return; }
  setupFrom(items);
}

async function copyPrompt() {
  buzz();
  const btn = $('copy-prompt');
  try { await navigator.clipboard.writeText(LIST_PROMPT); btn.textContent = 'Copied. Paste it with your photos'; } catch {
    $('paste-text').value = LIST_PROMPT;
    $('paste-text').select();
  }
}

// ── Backup links ────────────────────────────────────────────────────────────
async function openRestore(code) {
  const k = await decodeBackup(code);
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* old browser */ }
  if (!k) {
    const msg = typeof DecompressionStream === 'undefined' && code.startsWith('1')
      ? 'This phone’s browser is too old to open the backup link. Update iOS and try again.'
      : 'That backup link didn’t open. It may have been cut short.';
    if (state.kitchen) { showHome(); return toast('Backup link didn’t open'); }
    return showWelcome(msg);
  }
  state.kitchen = saveKitchen(k);
  state.cookedNow.clear();
  showHome();
  toast('Kitchen restored');
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function onHash() {
  const to = rateRedirect(location.hash);
  if (to) { location.replace(to); return true; }
  const code = restoreCode(location.hash);
  if (code) { openRestore(code); return true; }
  return false;
}

function init() {
  if (rateRedirect(location.hash)) return onHash(); // a tester link leaves before anything draws
  addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  reloadIfStale();
  $('version').textContent = VERSION;

  // Gemini keys use flash-lite models only; move a saved non-lite choice over.
  if (state.ai?.provider === 'gemini' && !/flash-lite/.test(state.ai.model)) {
    state.ai.model = pickModel('gemini', allowedModels('gemini', state.ai.models));
    store.set('ai', state.ai);
  }

  $('go-scan').addEventListener('click', () => { buzz(); showScan('welcome'); });
  $('go-persona').addEventListener('click', openPersonas);
  $('paste-go').addEventListener('click', pasteGo);
  $('copy-prompt').addEventListener('click', copyPrompt);

  $('scan-back').addEventListener('click', () => { buzz(); if (state.scanFrom === 'home' && state.kitchen) showHome(); else showWelcome(); });
  $('scan-fallback').addEventListener('click', openPersonas);
  for (const id of ['photo-input', 'camera-input']) {
    $(id).addEventListener('change', async (e) => { await addPhotos(e.target.files); e.target.value = ''; });
  }
  $('scan').addEventListener('click', scan);
  $('api-key').addEventListener('input', renderKey);
  $('save-key').addEventListener('click', saveKey);
  $('change-key').addEventListener('click', () => { editingKey = true; $('api-key').value = state.ai?.apiKey ?? ''; renderKey(); $('api-key').focus(); });

  $('open-kitchen').addEventListener('click', openSheet);
  $('rescan').addEventListener('click', () => { buzz(); showScan('home'); });
  $('kind').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (!v || v === state.ctx.kind) return;
    buzz();
    state.ctx.kind = v;
    store.set('context', { ...store.get('context', {}), kind: v });
    decide();
  });

  const sheet = $('kitchen-sheet');
  sheet.addEventListener('close', onSheetClosed);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); }); // the backdrop
  $('sheet-done').addEventListener('click', () => { buzz(); closeSheet(); });
  $('find').addEventListener('input', (e) => { state.sheet.q = e.target.value.slice(0, 60); renderFound(); });
  $('find-form').addEventListener('submit', (e) => { e.preventDefault(); $('found').querySelector('.rq-tile')?.click(); });
  $('recheck').addEventListener('click', () => { buzz(); closeSheet(); setupFrom(state.kitchen?.items ?? []); });
  $('copy-backup').addEventListener('click', copyBackup);
  $('forget-kitchen').addEventListener('click', forgetKitchen);

  addEventListener('hashchange', onHash);
  if (onHash()) return; // a backup link opens the kitchen it carries
  if (state.kitchen) showHome();
  else showWelcome();
}

init();
