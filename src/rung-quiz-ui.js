// The taste test a tester sees after the link opens (1.31.0; one dish per screen 1.44.0).
// Kiron's rules: one question per screen, a story bar, the action at the thumb, haptics on taps.
//
// 1.44.0 (pranjal, 22 Nov, after a live test): testers tapped while scrolling the 1.43 recipe
// list and rated the wrong dish. Causes: the whole dish header was a button inside the scroll
// surface, stars were 42 px targets packed under it, and finishing a dish auto-scrolled the next
// one under the thumb. Now nothing that rates is inside a long scroll: each dish is its own
// screen that fits a phone, with big stars, effort before taste, and Next only when it's done.
// Taps that land while the page is still scrolling, or in the first instant of a new screen,
// are ignored.
//
// The brain work is src/brain/rung-quiz.js; this file is screens, storage and sending.
import { buildRungQuiz, encodeRungResult, CANT, EFFORT_STARS, TASTE_STARS, WANT_STARS } from './brain/rung-quiz.js';
import { labelFor } from './brain/vocabulary.js';
import { CATALOGUE } from './brain/catalogue.js';
import { withConfirmed, matchTyped, listedSplit, addChoices, FOOD_GROUPS } from './brain/confirm.js';
import { sendResult, flush, setToken, outbox } from './send.js';
import { startFresh } from './fresh.js';
import { CONFUSING, blankFeedback, splitIdeas, norm } from './brain/feedback.js';

const KEY = 'harveys.rq.v1';
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HX = '<input type="checkbox" switch class="haptic" tabindex="-1" aria-hidden="true">';
const buzz = (ms = 8) => { if (!('switch' in HTMLInputElement.prototype) && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* no vibration */ } };
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9z"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

/** What a piece of kit is, in a line, for the bonus screen. Foods need no introduction. */
const ITEM_NOTE = {
  air_fryer: 'A countertop hot-air cooker. Crisps food with a spoon of oil while you do something else.',
  microwave: 'Heats and cooks in a few minutes, in the bowl you eat from.',
  sandwich_maker: 'A small electric press. A filled, toasted sandwich in about 3 minutes.',
  toaster: 'Pops out crisp toast in about 2 minutes.',
  kettle: 'Boils water in about 2 minutes, for tea, coffee, oats and noodles.',
  pressure_cooker: 'Cooks dal, rice and beans fast, sealed, with no stirring.',
  saucepan: 'A deep pot for boiling: noodles, eggs, dal, chai.',
  frying_pan: 'A flat pan for eggs, toast and quick stir-fries.',
  tawa: 'A flat griddle for roti, paratha and toast.',
  kadai: 'A deep, round pan for frying and stir-fries.',
  oven: 'Bakes and grills while you wait.',
  blender: 'Blends shakes, smoothies and chutneys in seconds.',
  induction: 'A plug-in cooking plate. Works with flat-bottomed pots and pans.',
  gas_stove: 'A gas burner for pots and pans.',
};

// ── Storage ─────────────────────────────────────────────────────────────────
function loadStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { /* fresh */ }
  delete s.testerId; // 1.31 kept one id per phone; testers share the phone, so it's one per run now
  delete s.tester;
  s.runs ??= {};
  s.seq ??= 0;
  return s;
}
let store = loadStore();
const newTesterId = () => `t-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const blankDraft = () => ({ have: [], typed: [], removed: [], opened: [] });
/** A new run: a new person holding the phone, so a new tester id. */
const freshRun = (name = '') => ({ testerId: newTesterId(), runNo: ++store.seq, name, v: opts.version, answers: { marco: {}, pierre: {}, white: {}, stars: {}, bonusItem: {}, draft: blankDraft(), feedback: blankFeedback() }, at: 0, sent: false });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode: keep going in memory */ } };

// ── State ───────────────────────────────────────────────────────────────────
let quiz = null;
let run = null;
let sendState = ''; // '', 'sending', 'sent', 'queued', 'failed', 'auth', 'setup', 'bad'
let root = null;
let opts = {};
let shownAt = 0;
let lastScroll = 0;
let downAt = null; // where the finger went down, to tell a tap from a scroll
let kitchenIn = null;
let listed = { food: [], kit: [] }; // what the video saw, split for the two confirm screens
let choices = { food: [], kit: [], noStove: false }; // what "Add more" offers
let panel = null; // on a confirm screen: null (the list), 'cats', or a category id
let sheetId = null; // the recipe open over a dish

/** Every screen, in order. Each dish is its own screen. */
function screens() {
  const out = [{ kind: 'intro' }];
  if (opts.items) out.push({ kind: 'confirm', side: 'food' }, { kind: 'confirm', side: 'kit' });
  out.push({ kind: 'think' }, { kind: 'reveal' });
  quiz.deck.forEach((id, i) => out.push({ kind: 'dish', id, i }));
  if (quiz.bonus) out.push({ kind: 'dish', id: quiz.bonus.id, bonus: true }, { kind: 'want' });
  out.push({ kind: 'feedback' }, { kind: 'end' });
  return out;
}
/** Screens Back passes over: the thinking pause. */
const passOver = (s) => s.kind === 'think';

export function startRungQuiz({ kitchen, inventory, version, source, name = '', onExit, items = null, cache = {}, missingBasics = [] }) {
  opts = { version, source, name, onExit, items, cache, missingBasics, inventory };
  kitchenIn = kitchen;
  quiz = buildRungQuiz({ kitchen, inventory });
  store = loadStore();
  run = store.runs[quiz.id];
  listed = items ? listedSplit(items) : { food: [], kit: [] };
  choices = items ? addChoices(items, { cache, missingBasics }) : { food: [], kit: [], noStove: false };
  // 1.40.0: a run saved by an older version starts again: its screens no longer line up.
  if (run && !run.sent && run.v !== version) run = null;
  if (run && !run.sent && run.answers?.confirm) rebuild(run.answers.confirm);
  // A sent run belongs to the last person: whoever opens it next is someone new.
  if (!run || run.sent) run = store.runs[quiz.id] = freshRun(name);
  if (name && run.name == null) run.name = name;
  run.testerId ??= newTesterId();
  run.answers.feedback ??= blankFeedback();
  run.answers.stars ??= {};
  run.answers.bonusItem ??= {};
  run.answers.draft ??= blankDraft();
  if (run.at >= screens().length) run.at = 0;
  sendState = '';
  panel = null;
  save();
  flush(); // anything left over from a send with no signal
  if (!root) {
    root = document.createElement('div');
    root.className = 'rq';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Taste test');
    document.body.append(root);
    root.addEventListener('click', onClick);
    root.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
    root.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
    root.addEventListener('submit', (e) => { e.preventDefault(); const f = e.target.closest('.rq-add'); if (f) typeAdd(f); });
    root.addEventListener('input', (e) => {
      if (e.target.matches('.rq-makes textarea')) { run.answers.feedback.makes = e.target.value.slice(0, 1000); run.answers.feedback.seen = true; save(); }
    });
    document.addEventListener('keydown', onKey);
  }
  root.hidden = false;
  document.documentElement.classList.add('rq-open');
  render(true);
}

function close() {
  root.hidden = true;
  document.documentElement.classList.remove('rq-open');
  opts.onExit?.();
}

/** The quiz again with what the tester confirmed: unticked items out, added ones in. */
function rebuild(conf) {
  if (!opts.items) return;
  const gone = new Set((conf?.removed ?? []).map(norm));
  const kept = opts.items.filter((i) => !gone.has(norm(typeof i === 'string' ? i : i?.name)));
  const typed = conf?.typed ?? [];
  const ids = [...new Set([...(conf?.have ?? []), ...typed.filter((t) => t.id).map((t) => t.id)])];
  const extras = typed.filter((t) => !t.id).map((t) => t.text);
  const inv = ids.length || extras.length || gone.size ? withConfirmed(kept, ids, { cache: opts.cache, missingBasics: opts.missingBasics }, extras) : opts.inventory;
  quiz = buildRungQuiz({ kitchen: kitchenIn, inventory: inv });
}
const confKey = (c) => JSON.stringify([[...(c?.have ?? [])].sort(), (c?.typed ?? []).map((t) => t.id ?? t.text).sort(), [...(c?.removed ?? [])].map(norm).sort()]);

const resultOf = () => encodeRungResult(quiz, run.answers, { version: opts.version, at: new Date().toISOString(), testerId: run.testerId, runNo: run.runNo, source: opts.source, tester: run.name || '' });

// ── Render ──────────────────────────────────────────────────────────────────
function bar(list) {
  // Story bar: the two confirm screens, the dishes as one segment that fills dish by dish,
  // the bonus, and the last question. Twenty dots for twenty dishes would say nothing.
  const seg = (test) => {
    const idx = list.map((s, i) => [s, i]).filter(([s]) => test(s)).map(([, i]) => i);
    if (!idx.length) return '';
    const done = run.at > idx[idx.length - 1];
    const now = idx.includes(run.at);
    const p = now ? (idx.indexOf(run.at) + 1) / (idx.length + 1) : 0;
    return `<i class="${done ? 'done' : now ? 'now' : ''}"${now ? ` style="--p:${Math.max(0.12, p).toFixed(3)}"` : ''}></i>`;
  };
  return `<div class="rq-bar" aria-hidden="true">${[
    seg((s) => s.kind === 'confirm' && s.side === 'food'),
    seg((s) => s.kind === 'confirm' && s.side === 'kit'),
    seg((s) => s.kind === 'dish' && !s.bonus),
    seg((s) => (s.kind === 'dish' && s.bonus) || s.kind === 'want'),
    seg((s) => s.kind === 'feedback'),
  ].join('')}</div>`;
}

function render(enter = false) {
  const list = screens();
  const s = list[run.at];
  shownAt = performance.now();
  let body = '';
  let foot = '';
  const back = run.at > 0 || panel ? `<button class="rq-icon" data-act="back" type="button" aria-label="Back">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : '<span class="rq-icon ghost"></span>';
  if (s.kind !== 'confirm') panel = null;

  if (s.kind === 'intro') ({ body, foot } = introScreen());
  else if (s.kind === 'confirm') ({ body, foot } = confirmScreen(s.side, back));
  else if (s.kind === 'think') ({ body, foot } = thinkScreen());
  else if (s.kind === 'reveal') ({ body, foot } = revealScreen(back));
  else if (s.kind === 'dish') ({ body, foot } = dishScreen(s, back));
  else if (s.kind === 'want') ({ body, foot } = wantScreen(back));
  else if (s.kind === 'feedback') ({ body, foot } = feedbackScreen(back));
  else ({ body, foot } = endScreen());

  const ghost = ['intro', 'end', 'think', 'reveal'].includes(s.kind);
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
  root.innerHTML = `
    <header class="rq-top">
      <button class="rq-icon" data-act="close" type="button" aria-label="Close">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      ${ghost ? '<div class="rq-bar"></div>' : bar(list)}
      <button class="rq-fresh" data-act="fresh" type="button">Start fresh</button>
    </header>
    <main class="rq-body${enter ? '' : ' in'}" data-kind="${s.kind}${panel ? '-add' : ''}">${body}</main>
    <footer class="rq-foot">${foot}</footer>`;
  root.scrollTop = 0;
  clearTimeout(thinkTimer);
  if (s.kind === 'think') thinkTimer = setTimeout(() => { if (screens()[run.at]?.kind === 'think' && !root.hidden) { run.at++; save(); render(); } }, THINK_MS);
  if (s.kind === 'reveal') countUp();
  if (s.kind === 'dish') syncDish(s.id);
  if (s.kind === 'want') syncWant();
  if (s.kind === 'feedback') syncFb();
}

function introScreen() {
  const can = Object.keys(quiz.dishes).length || opts.items;
  const mini = (n) => `<span class="rq-sw demo">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;
  const body = `
      <div class="rq-hero">
        <p class="rq-eyebrow">${run.name ? `Hi, ${esc(run.name)}` : 'Taste test'}</p>
        <h1 class="rq-title">${can ? 'Test Harvey’s recipes' : 'No recipes yet'}</h1>
        ${can ? `<ol class="rq-rounds">
          ${opts.items ? '<li><b>Confirm your kitchen</b><span>Foods, then cookware</span></li>' : ''}
          <li><b>Rate each recipe</b><span class="rq-mini-rate"><span>Effort ${mini(4)}</span><span>Taste ${mini(3)}</span></span></li>
          <li><b>Send</b><span>One tap</span></li>
        </ol>` : ''}
      </div>`;
  const foot = can
    ? `<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Start</span></button>`
    : `<p class="rq-lead">Add a few more things to your list and try again.</p><button class="btn xl rq-go" data-act="close" type="button">${HX}<span>Back to my list</span></button>`;
  return { body, foot };
}

// ── Confirm your kitchen (1.44.0) ───────────────────────────────────────────
const draft = () => run.answers.draft;
const optKey = (o) => (o.id ? `id:${o.id}` : `t:${norm(o.text)}`);
const isRemoved = (name) => draft().removed.some((n) => norm(n) === norm(name));
const isAdded = (o) => (o.id ? draft().have.includes(o.id) || draft().typed.some((t) => t.id === o.id) : draft().typed.some((t) => !t.id && norm(t.text) === norm(o.text)));
const groupsOf = (side) => (side === 'food' ? choices.food : choices.kit);
/** Added on this side: vocabulary ids and typed things, as tiles. */
function addedOn(side) {
  const all = groupsOf(side).flatMap((g) => g.opts);
  const fromOpts = all.filter(isAdded);
  const known = new Set(fromOpts.map(optKey));
  const typedHere = draft().typed.filter((t) => t.side === side && !known.has(t.id ? `id:${t.id}` : `t:${norm(t.text)}`)).map((t) => ({ id: t.id, text: t.id ? null : t.text, label: t.id ? t.label : t.text }));
  return [...fromOpts, ...typedHere];
}
const tile = (act, attrs, label, on, cls = '') => `<button class="rq-tile${on ? ' on' : ''}${cls}" data-act="${act}" ${attrs} type="button" aria-pressed="${on}">${HX}<span class="rq-box" aria-hidden="true">${TICK}</span><span class="rq-tl">${esc(label)}</span></button>`;
const optAttrs = (o) => (o.id ? `data-id="${esc(o.id)}"` : `data-text="${esc(o.text)}"`);

function confirmScreen(side, back) {
  const food = side === 'food';
  if (panel === 'cats') {
    const groups = groupsOf(side);
    const body = `
      <p class="rq-eyebrow">Add more</p>
      <h1 class="rq-q">What did Harvey miss?</h1>
      <p class="rq-hint">Pick a group.</p>
      <div class="rq-cats">${groups.map((g) => {
        const n = g.opts.filter(isAdded).length + (g.type ? draft().typed.filter((t) => t.side === side && t.group === g.id).length : 0);
        return `<button class="rq-cat" data-act="cat" data-id="${g.id}" type="button">${HX}<b>${esc(g.label)}</b><span>${n ? `${n} added` : `${g.opts.length} to pick from`}</span>${CHEV}</button>`;
      }).join('')}</div>`;
    return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="paneldone" type="button">${HX}<span>Done</span></button>` };
  }
  if (panel) {
    const g = groupsOf(side).find((x) => x.id === panel);
    const typedHere = draft().typed.filter((t) => t.side === side && t.group === g.id && !g.opts.some((o) => isAdded(o) && (o.id ? o.id === t.id : norm(o.text) === norm(t.text))));
    const body = `
      <p class="rq-eyebrow">Add more · ${esc(g.label)}</p>
      <h1 class="rq-q">Tap what you have</h1>
      <div class="rq-tiles add">${g.opts.map((o) => tile('addopt', optAttrs(o), o.label, isAdded(o))).join('')}${typedHere.map((t) => tile('typeddrop', `data-text="${esc(t.text)}"`, t.id ? t.label : t.text, true, ' typed')).join('')}</div>
      ${g.type ? `<p class="rq-group">Something else?</p>
      <form class="rq-add" data-side="${side}" data-group="${g.id}">
        <input type="text" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" placeholder="${food ? 'e.g. atta, soy sauce' : 'e.g. rice cooker, grill'}" aria-label="Something else you have">
        <button class="rq-add-go" data-act="typeadd" type="button" aria-label="Add">${HX}${PLUS}</button>
      </form>` : ''}`;
    return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="paneldone" type="button">${HX}<span>Done</span></button>` };
  }
  const rows = food ? listed.food : listed.kit;
  const added = addedOn(side);
  const stoves = !food && choices.noStove ? groupsOf('kit').find((g) => g.id === 'stove')?.opts ?? [] : [];
  const addedNoStove = added.filter((o) => !stoves.some((x) => x.id === o.id));
  const grouped = food
    ? FOOD_GROUPS.map((g) => [g.label, rows.filter((r) => r.group === g.id)]).filter(([, r]) => r.length)
    : [['', rows]];
  const body = `
      <p class="rq-eyebrow">Your kitchen · ${food ? 1 : 2} of 2</p>
      <h1 class="rq-q">${food ? 'Confirm you have these foods' : 'Confirm your cookware'}</h1>
      <p class="rq-hint">${rows.length ? 'Untick any you don’t have.' : 'Tap Add more.'}</p>
      ${stoves.length ? `<p class="rq-group">Tap your stove</p><div class="rq-tiles add">${stoves.map((o) => tile('addopt', optAttrs(o), o.label, isAdded(o))).join('')}</div>` : ''}
      ${addedNoStove.length ? `<p class="rq-group">Added</p><div class="rq-tiles add">${addedNoStove.map((o) => tile(o.id || !o.text ? 'addopt' : 'typeddrop', optAttrs(o), o.label, true)).join('')}</div>` : ''}
      ${grouped.map(([label, list]) => `${label ? `<p class="rq-group">${esc(label)}</p>` : stoves.length || addedNoStove.length ? '<p class="rq-group">Harvey saw</p>' : ''}<div class="rq-tiles">${list.map((r) => tile('untick', `data-name="${esc(r.name)}"`, r.name, !isRemoved(r.name))).join('')}</div>`).join('')}
      <button class="rq-more" data-act="more" type="button">${HX}<span>Missed something?</span><b>${PLUS}Add more</b></button>`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>${food ? 'Confirm foods' : 'Confirm cookware'}</span></button>` };
}

function toggleOpt(el, side) {
  const d = draft();
  if (el.dataset.id) {
    const id = el.dataset.id;
    if (d.have.includes(id)) d.have = d.have.filter((x) => x !== id);
    else if (d.typed.some((t) => t.id === id)) d.typed = d.typed.filter((t) => t.id !== id);
    else d.have.push(id);
  } else {
    const text = el.dataset.text;
    const i = d.typed.findIndex((t) => norm(t.text) === norm(text));
    if (i >= 0) d.typed.splice(i, 1);
    else { const m = matchTyped(text); d.typed.push({ text: m.text || text, id: m.id, label: m.label, how: m.how, side, group: panel && panel !== 'cats' ? panel : null }); }
  }
}

/** "Something else?": each typed thing goes to its closest known item. */
function typeAdd(form) {
  const input = form.querySelector('input');
  const d = draft();
  for (const text of splitIdeas(input.value)) {
    const m = matchTyped(text);
    if (!m.text) continue;
    if (m.id && (d.have.includes(m.id) || d.typed.some((t) => t.id === m.id))) continue;
    if (!m.id && d.typed.some((t) => !t.id && norm(t.text) === norm(m.text))) continue;
    d.typed.push({ text: m.text, id: m.id, label: m.label, how: m.how, side: form.dataset.side, group: form.dataset.group });
  }
  input.value = '';
  buzz();
  save();
  render();
}

// ── Thinking and the count ──────────────────────────────────────────────────
const THINK_MS = 3200;
let thinkTimer = 0;

function thinkScreen() {
  const d = draft();
  const items = (quiz.kitchen.items ?? []).length - d.removed.length + d.have.length + d.typed.length;
  const lines = [
    items > 0 ? `Reading the ${items} things in your kitchen` : 'Reading your kitchen',
    `Checking ${CATALOGUE.length} recipes against your pots and pans`,
    'Balancing protein and calories',
    'Putting the easiest first',
  ];
  return {
    body: `
      <div class="rq-hero think" role="status" aria-live="polite">
        <div class="rq-orb" aria-hidden="true"><i></i><i></i><i></i><span>H</span></div>
        <h1 class="rq-q center">Harvey’s is thinking…</h1>
        <ul class="rq-steps">${lines.map((l, i) => `<li style="--d:${(i * (THINK_MS - 600)) / lines.length}ms"><span class="rq-tickmini" aria-hidden="true">${TICK}</span>${esc(l)}</li>`).join('')}</ul>
      </div>`,
    foot: '',
  };
}

function revealScreen(back) {
  const n = quiz.cookable;
  const more = quiz.deck.length - n;
  if (!quiz.deck.length) {
    return {
      body: `
      <div class="rq-hero reveal">
        <p class="rq-eyebrow">Harvey’s came up with</p>
        <h1 class="rq-title">Nothing yet</h1>
        <p class="rq-lead">Tell Harvey what you cook.</p>
      </div>`,
      foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Tell Harvey</span></button>`,
    };
  }
  return {
    body: `
      <div class="rq-hero reveal">
        <p class="rq-eyebrow">Harvey’s came up with</p>
        <h1 class="rq-count"><span class="rq-num-big" data-to="${quiz.deck.length}">${quiz.deck.length}</span><span>${quiz.deck.length === 1 ? 'recipe' : 'recipes'} for your kitchen</span></h1>
        ${more ? `<p class="rq-lead">${n} you can cook now, ${more} need${more === 1 ? 's' : ''} one more thing.</p>` : ''}
        <div class="rq-demo-row" aria-hidden="true">
          <div class="rq-starrow"><b>Effort</b><span class="rq-sw demo">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= 4 ? 'on' : ''}" style="--i:${k}">${STAR}</i>`).join('')}</span></div>
          <div class="rq-starrow"><b>Taste</b><span class="rq-sw demo">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= 3 ? 'on' : ''}" style="--i:${k + 5}">${STAR}</i>`).join('')}</span></div>
        </div>
        <p class="rq-lead strong">One at a time. Rate each for effort and taste.</p>
      </div>`,
    foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Start rating</span></button>`,
  };
}

function countUp() {
  const el = root.querySelector('.rq-num-big');
  if (!el) return;
  const to = Number(el.dataset.to);
  if (to < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick); else buzz(12);
  };
  el.textContent = '0';
  requestAnimationFrame(tick);
}

// ── One dish, one screen (1.44.0) ───────────────────────────────────────────
const ingredientsOf = (d) => (d.away ? d.how.split(' · ').slice(1).join(' · ') : d.how);
const METHOD = { 1: 'No cooking', 2: 'One appliance', 3: 'On the stove', 4: 'Two things at once' };
const ASK = {
  effort: { q: 'How easy, tonight?', words: EFFORT_STARS },
  taste: { q: 'How tasty?', words: TASTE_STARS },
  want: { q: '', words: WANT_STARS },
};
const starOf = (id) => run.answers.stars?.[id] ?? {};
const isDone = (id) => { const a = starOf(id); return !!((a.effort && a.taste) || a.cant); };
const dishOf = (id) => quiz.dishes[id] ?? (quiz.bonus?.id === id ? quiz.bonus : null);

/** Five big stars, and what the far ends mean, so no legend is needed. */
function askRow(id, kind, q = ASK[kind].q) {
  const w = ASK[kind].words;
  return `<section class="rq-ask" data-id="${esc(id)}" data-kind="${kind}">
      ${q ? `<p class="rq-ask-q">${esc(q)}<b class="rq-sv"></b></p>` : '<p class="rq-ask-q"><b class="rq-sv"></b></p>'}
      <div class="rq-stars" role="radiogroup" aria-label="${esc(q || kind)}">${[1, 2, 3, 4, 5].map((n) => `<button class="rq-star" data-act="star" data-id="${esc(id)}" data-kind="${kind}" data-n="${n}" type="button" role="radio" aria-checked="false" aria-label="${n} of 5: ${esc(w[n - 1])}">${HX}${STAR}</button>`).join('')}</div>
      <p class="rq-ends" aria-hidden="true"><span>${esc(w[0])}</span><span>${esc(w[4])}</span></p>
    </section>`;
}

function dishScreen(s, back) {
  const d = dishOf(s.id);
  const total = quiz.deck.length;
  const last = s.bonus ? false : s.i === total - 1;
  const body = `
      <p class="rq-eyebrow">${s.bonus ? 'Bonus · needs one more thing' : `Recipe ${s.i + 1} of ${total}`}</p>
      <h1 class="rq-dname">${esc(d.name)}</h1>
      <p class="rq-ding">${esc(ingredientsOf(d))}</p>
      ${d.away ? `<p class="rq-need">Needs ${esc(s.bonus ? d.need.label.toLowerCase() : d.away)}</p>` : ''}
      <div class="rq-dact">
        <button class="rq-see" data-act="recipe" data-id="${esc(s.id)}" type="button">${HX}<span>See the recipe</span>${CHEV}</button>
        <button class="rq-cant" data-act="cant" data-id="${esc(s.id)}" type="button" aria-expanded="false">${HX}<span>I can’t make this</span></button>
      </div>
      <div class="rq-cantwhy" hidden role="group" aria-label="Why not">${CANT.map((c) => `<button class="rq-tag" data-act="cantwhy" data-id="${esc(s.id)}" data-why="${c.id}" type="button" aria-pressed="false">${HX}<span>${esc(c.label)}</span></button>`).join('')}</div>
      ${askRow(s.id, 'effort')}
      ${askRow(s.id, 'taste')}`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>${last ? 'Next' : s.bonus ? 'Next' : 'Next recipe'}</span></button>` };
}

/** Stars, words, the taste row's turn, can't-make, and Next, for the dish on screen. */
function syncDish(id) {
  const a = starOf(id);
  for (const box of root.querySelectorAll('.rq-ask')) {
    const kind = box.dataset.kind;
    const v = a[kind] ?? 0;
    box.classList.toggle('set', !!v);
    // Effort first: taste waits its turn, so the eye goes one place at a time.
    box.classList.toggle('wait', kind === 'taste' && !a.effort && !a.cant);
    box.classList.toggle('off', !!a.cant);
    for (const b of box.querySelectorAll('.rq-star')) {
      const n = Number(b.dataset.n);
      b.classList.toggle('on', n <= v);
      b.setAttribute('aria-checked', String(n === v));
    }
    box.querySelector('.rq-sv').textContent = v ? ASK[kind].words[v - 1] : '';
  }
  const open = !!(a.cantOpen || a.cant);
  const why = root.querySelector('.rq-cantwhy');
  if (why) {
    if (open && why.hidden) { why.hidden = false; why.classList.add('appear'); }
    if (!open) why.hidden = true;
    const btn = root.querySelector('.rq-cant');
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', String(open));
    for (const t of why.querySelectorAll('.rq-tag')) {
      const on = a.cant === t.dataset.why;
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', String(on));
    }
  }
  const go = root.querySelector('.rq-foot [data-act="next"]');
  if (go) {
    go.disabled = !isDone(id);
    go.classList.toggle('ready', isDone(id));
  }
}

function setStar(id, kind, n) {
  if (kind === 'want') {
    const w = run.answers.bonusItem;
    w.want = w.want === n ? 0 : n;
    if (w.want) w.have = false;
    w.ms = Math.round(performance.now() - shownAt);
    save();
    buzz(n >= 4 ? 12 : 8);
    syncWant();
    root.querySelector(`.rq-star[data-n="${n}"]`)?.classList.add('pop');
    return;
  }
  const a = (run.answers.stars[id] ??= {});
  a[kind] = a[kind] === n ? 0 : n; // tap the same star again to clear it
  a.ms = Math.round(performance.now() - shownAt);
  save();
  buzz(n >= 4 ? 12 : 8);
  syncDish(id);
  root.querySelector(`.rq-ask[data-kind="${kind}"] .rq-star[data-n="${n}"]`)?.classList.add('pop');
}

function cantTap(id, why = null) {
  const a = (run.answers.stars[id] ??= {});
  if (why) a.cant = a.cant === why ? null : why;
  else if (a.cant || a.cantOpen) { a.cant = null; a.cantOpen = false; } else a.cantOpen = true;
  a.ms = Math.round(performance.now() - shownAt);
  save();
  syncDish(id);
}

// ── The bonus item ──────────────────────────────────────────────────────────
function wantScreen(back) {
  const b = quiz.bonus;
  const kit = b.need.kind !== 'food';
  const label = b.need.label;
  const others = b.unlocks.filter((u) => u.id !== b.id);
  const body = `
      <p class="rq-eyebrow">Bonus · one more thing</p>
      <h1 class="rq-dname">${esc(label)}</h1>
      <div class="rq-item">
        ${ITEM_NOTE[b.need.id] ? `<p>${esc(ITEM_NOTE[b.need.id])}</p>` : ''}
        <p class="rq-unlocks">With it: <strong>${esc(b.name)}</strong>${others.length ? `, ${others.slice(0, 2).map((u) => esc(u.name)).join(', ')}${others.length > 2 ? ` and ${others.length - 2} more` : ''}` : ''}</p>
      </div>
      ${askRow(b.id, 'want', kit ? 'Would you get one?' : 'Would you buy it?')}
      <button class="rq-cant rq-have" data-act="havebonus" type="button" aria-pressed="false">${HX}<span>I already have ${kit ? 'one' : 'it'}</span></button>`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>` };
}

function syncWant() {
  const w = run.answers.bonusItem;
  const box = root.querySelector('.rq-ask');
  const v = w.want ?? 0;
  box.classList.toggle('set', !!v);
  box.classList.toggle('off', !!w.have);
  for (const b of box.querySelectorAll('.rq-star')) {
    const n = Number(b.dataset.n);
    b.classList.toggle('on', n <= v);
    b.setAttribute('aria-checked', String(n === v));
  }
  box.querySelector('.rq-sv').textContent = v ? WANT_STARS[v - 1] : '';
  const have = root.querySelector('.rq-have');
  have.classList.toggle('on', !!w.have);
  have.setAttribute('aria-pressed', String(!!w.have));
  const go = root.querySelector('.rq-foot [data-act="next"]');
  go.disabled = !(w.want || w.have);
  go.classList.toggle('ready', !go.disabled);
}

// ── Anything confusing? ─────────────────────────────────────────────────────
function feedbackScreen(back) {
  const fb = run.answers.feedback;
  fb.seen = true;
  const chip = (id, label, cls = '') => `<button class="rq-fbchip${cls}" data-act="fbchip" data-id="${id}" type="button" aria-pressed="false">${HX}<span class="rq-check" aria-hidden="true">${TICK}</span><span>${esc(label)}</span></button>`;
  const body = `
      <p class="rq-eyebrow">Almost done</p>
      <h1 class="rq-q">Was anything confusing?</h1>
      <p class="rq-hint">Tap any that apply.</p>
      <div class="rq-fb">${chip('all_good', 'No, all clear', ' good')}${CONFUSING.map((c) => chip(c.id, c.label)).join('')}</div>`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Skip</span></button>` };
}

function syncFb() {
  const fb = run.answers.feedback;
  for (const c of root.querySelectorAll('.rq-fbchip')) {
    const on = c.dataset.id === 'all_good' ? fb.chips.includes('all_good') : fb.confusing.includes(c.dataset.id);
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  }
  const go = root.querySelector('.rq-foot [data-act="next"] span');
  if (go) go.textContent = fb.chips.length ? 'Next' : 'Skip';
}

function fbChip(id) {
  const fb = run.answers.feedback;
  if (id === 'all_good') { fb.confusing = []; fb.chips = fb.chips.includes('all_good') ? [] : ['all_good']; } else {
    const i = fb.confusing.indexOf(id);
    if (i >= 0) fb.confusing.splice(i, 1); else fb.confusing.push(id);
    fb.chips = fb.confusing.length ? ['confusing'] : [];
  }
  save();
  syncFb();
}

// ── The end: what you make, then Send ───────────────────────────────────────
function endScreen() {
  const waiting = outbox().length;
  const st = sendState || (run.sent ? 'sent' : '');
  const who = run.name ? `, ${esc(run.name)}` : '';
  const own = opts.source === 'link' && !!run.name; // their own phone, from their own link
  const copy = {
    '': [`That’s all${who}. Thank you!`, ''],
    sending: ['Sending…', 'Putting your answers in Harvey’s.'],
    sent: [`Sent. Thank you${who}!`, own ? 'Your ratings are in Harvey’s.' : 'Hand the phone to the next person.'],
    queued: [`Saved. Thank you${who}!`, `Leave this page open for a minute so it can send${waiting > 1 ? ` (${waiting} waiting)` : ''}.`],
    failed: ['Not sent', 'Tap Save the file, then send it to whoever gave you the link.'],
    auth: ['Almost there', 'This phone isn’t set up to send yet. Your answers are saved here and go as soon as it is.'],
    setup: ['Set up sending', 'Paste the GitHub token for Harvey’s once. Every send after is one tap, for everyone using this phone.'],
    bad: ['That token didn’t work', 'It needs write access to the harveys repo (Contents: read and write). Your answers are still saved here.'],
  }[st];
  const done = st === 'sent' || st === 'queued';
  const ask = st === 'auth' || st === 'setup' || st === 'bad';
  const fb = run.answers.feedback;
  const body = `
      <div class="rq-hero end">
        <div class="rq-tick${done || !st ? '' : ' wait'}" aria-hidden="true"><svg viewBox="0 0 52 52"><path d="M14 27l8 8 16-17"/></svg></div>
        <h1 class="rq-title">${copy[0]}</h1>
        ${copy[1] ? `<p class="rq-lead">${copy[1]}</p>` : ''}
        ${!st ? `<label class="rq-makes"><span>Meals or foods you often make <i>(optional)</i></span><textarea rows="3" maxlength="1000" placeholder="e.g. rajma chawal, aloo paratha, cold coffee">${esc(fb.makes ?? '')}</textarea></label>` : ''}
        ${ask ? `<label class="rq-field"><span>GitHub token</span><input id="rq-token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>` : ''}
      </div>`;
  const main = done
    ? own
      ? `<button class="btn primary xl rq-go" data-act="close" type="button">${HX}<span>Done</span></button>`
      : `<button class="btn primary xl rq-go" data-act="nextperson" type="button">${HX}<span>Next person</span></button>`
    : ask
      ? `<button class="btn primary xl rq-go" data-act="token" type="button">${HX}<span>Save and send</span></button>`
      : `<button class="btn primary xl rq-go" data-act="send" type="button"${st === 'sending' ? ' disabled' : ''}>${HX}<span>${st === 'sending' ? 'Sending…' : 'Send to Harvey’s'}</span></button>`;
  const alt = [
    !st ? `<button class="btn link" data-act="back" type="button">Back</button>` : '',
    done && !own ? '<button class="btn link" data-act="close" type="button">Done for now</button>' : '',
    done && own ? '<button class="btn link" data-act="nextperson" type="button">Someone else wants a go</button>' : '',
    ask ? '<button class="btn link" data-act="github" type="button">Post on GitHub instead</button>' : '',
    st === 'failed' || ask ? '<button class="btn link" data-act="file" type="button">Save the file</button>' : '',
  ].join('');
  return { body, foot: `<div class="rq-sendbox">${main}<div class="rq-alt">${alt}</div></div>` };
}

// ── Taps ────────────────────────────────────────────────────────────────────
/** Acts that change an answer: these are the ones a scroll must never trigger. */
const ANSWERS = new Set(['star', 'cant', 'cantwhy', 'untick', 'addopt', 'typeddrop', 'havebonus', 'fbchip', 'recipe', 'next', 'cat', 'more']);

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const now = performance.now();
  // A tap is a tap only if the finger didn't travel, the page wasn't scrolling, and the
  // screen has been up long enough to be seen (a double tap mustn't answer the next dish).
  if (ANSWERS.has(act) && !sheetId) {
    const moved = downAt && e.clientX && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12;
    if (moved || now - lastScroll < 140 || now - shownAt < 320) return;
  }
  buzz();
  const list = screens();
  const s = list[run.at];
  if (act === 'close') return close();
  if (act === 'back' && sheetId) return closeRecipe();
  // 1.40.0: one tap on the first screen; mid-test a second tap, so a stray thumb loses nothing.
  if (act === 'fresh') {
    if (run.at > 0 && !el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start fresh'; }, 4000); return; }
    el.textContent = 'Starting…';
    return startFresh();
  }
  if (act === 'back') {
    if (s.kind === 'confirm' && panel) { panel = panel === 'cats' ? null : 'cats'; return render(); }
    commit(s);
    run.at = Math.max(0, run.at - 1);
    while (run.at > 0 && passOver(list[run.at])) run.at--;
    save();
    return render();
  }
  if (act === 'recipe') return openRecipe(el.dataset.id);
  if (act === 'recipeclose') return closeRecipe();
  if (act === 'star') return setStar(el.dataset.id, el.dataset.kind, Number(el.dataset.n));
  if (act === 'cant') return cantTap(el.dataset.id);
  if (act === 'cantwhy') return cantTap(el.dataset.id, el.dataset.why);
  if (act === 'havebonus') { const w = run.answers.bonusItem; w.have = !w.have; if (w.have) w.want = 0; save(); return syncWant(); }
  if (act === 'untick') {
    const d = draft();
    const name = el.dataset.name;
    d.removed = isRemoved(name) ? d.removed.filter((n) => norm(n) !== norm(name)) : [...d.removed, name];
    save();
    el.classList.toggle('on', !isRemoved(name));
    el.setAttribute('aria-pressed', String(!isRemoved(name)));
    return;
  }
  if (act === 'addopt' || act === 'typeddrop') {
    toggleOpt(el, s.side);
    save();
    if (act === 'typeddrop' || !panel) return render(); // the Added row on the list changes shape
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', String(on));
    return;
  }
  if (act === 'more') { panel = 'cats'; return render(); }
  if (act === 'cat') { panel = el.dataset.id; const d = draft(); if (!d.opened.includes(`${s.side}:${panel}`)) d.opened.push(`${s.side}:${panel}`); save(); return render(); }
  if (act === 'paneldone') {
    const form = root.querySelector('.rq-add');
    if (form?.querySelector('input').value.trim()) return typeAddThen(form, () => { panel = null; render(); });
    panel = null;
    return render();
  }
  if (act === 'typeadd') return typeAdd(el.closest('.rq-add'));
  if (act === 'fbchip') return fbChip(el.dataset.id);
  if (act === 'next') { commit(s); run.at = Math.min(list.length - 1, run.at + 1); save(); return render(); }
  if (act === 'send') return send();
  if (act === 'github') { const res = resultOf(); window.open(issueHref(res), '_blank', 'noopener'); sendState = 'sent'; markSent(); return; }
  if (act === 'token') return saveToken();
  if (act === 'nextperson') { store.runs[quiz.id] = run = freshRun(); rebuild(null); sendState = ''; save(); return render(); }
  if (act === 'file') { download(resultOf()); return; }
}

function typeAddThen(form, then) {
  const input = form.querySelector('input');
  const d = draft();
  for (const text of splitIdeas(input.value)) {
    const m = matchTyped(text);
    if (m.text && !d.typed.some((t) => (m.id ? t.id === m.id : norm(t.text) === norm(m.text)))) d.typed.push({ text: m.text, id: m.id, label: m.label, how: m.how, side: form.dataset.side, group: form.dataset.group });
  }
  save();
  then();
}

/** Keeps what's on screen. Time adds up if a tester comes back to a question. */
function commit(s) {
  const ms = Math.round(performance.now() - shownAt);
  if (s.kind === 'confirm') {
    const d = draft();
    const prev = run.answers.confirm;
    const next = {
      have: [...d.have], typed: d.typed.map(({ text, id, label, how }) => ({ text, id, label, how })), removed: [...d.removed], opened: [...d.opened],
      listed: listed.food.length + listed.kit.length, noStove: choices.noStove, burners: null, asked: [], ms: (prev?.ms ?? 0) + ms,
    };
    const changed = confKey(next) !== confKey(prev);
    run.answers.confirm = next;
    if (changed) {
      rebuild(next);
      // New dishes, so ratings made on the old ones start again.
      run.answers.stars = {};
      run.answers.bonusItem = {};
    }
  }
  if (s.kind === 'feedback') { const fb = run.answers.feedback; fb.ms = (fb.ms ?? 0) + ms; }
}

// ── The recipe, over the dish ───────────────────────────────────────────────
const ingName = (i) => {
  const ids = (i.anyOf ?? [i.id]).filter((x) => x && !String(x).startsWith('role:'));
  return ids.map((x, n) => (n ? labelFor(x).toLowerCase() : labelFor(x))).join(' or ');
};

function openRecipe(id) {
  const d = dishOf(id);
  const meal = CATALOGUE.find((m) => m.id === id);
  if (!d || !meal) return;
  sheetId = id;
  const meta = [METHOD[d.rung], d.protein != null ? `${Math.round(d.protein)} g protein` : '', d.kcal != null ? `${Math.round(d.kcal)} kcal` : ''].filter(Boolean);
  const ings = (meal.ingredients ?? []).map((i) => ({ name: ingName(i), amount: i.amount ?? '', optional: !!i.optional })).filter((i) => i.name);
  const sheet = document.createElement('div');
  sheet.className = 'rq-sheet';
  sheet.innerHTML = `
    <div class="rq-scrim" data-act="recipeclose"></div>
    <section class="rq-sheet-in" role="dialog" aria-modal="true" aria-label="${esc(d.name)} recipe">
      <header class="rq-sheet-top">
        <div class="rq-sheet-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}${d.away ? `<span class="away">Needs ${esc(d.away)}</span>` : ''}</div>
        <button class="rq-icon" data-act="recipeclose" type="button" aria-label="Close recipe">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </header>
      <div class="rq-sheet-body">
        <h2 class="rq-sheet-name">${esc(d.name)}</h2>
        <p class="rq-group">You need</p>
        <ul class="rq-ings">${ings.map((i) => `<li><b>${esc(i.name)}</b><span>${esc(i.amount)}${i.optional ? ' · optional' : ''}</span></li>`).join('')}</ul>
        <p class="rq-group">Steps</p>
        <ol class="rq-steps-list">${(meal.steps ?? []).map((s) => `<li>${esc(s.text)}</li>`).join('')}</ol>
      </div>
      <footer class="rq-sheet-foot"><button class="btn primary xl rq-go" data-act="recipeclose" type="button">${HX}<span>Close</span></button></footer>
    </section>`;
  root.append(sheet);
  document.documentElement.classList.add('rq-sheet-open');
  sheet.querySelector('.rq-sheet-foot .rq-go').focus({ preventScroll: true });
}

function closeRecipe() {
  const sheet = root.querySelector('.rq-sheet');
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
  shownAt = performance.now(); // the tap that closed it mustn't land on a star underneath
  if (!sheet) return;
  sheet.classList.add('out');
  setTimeout(() => sheet.remove(), 200);
}

function onKey(e) {
  if (!root || root.hidden) return;
  if (e.key === 'Escape' && sheetId) { e.preventDefault(); closeRecipe(); }
}

// ── Send ────────────────────────────────────────────────────────────────────
const fileName = (res) => `harveys-taste-test-${res.kitchenId}-${res.testerId}.json`;

function issueHref(result) {
  const title = `Taste test: ${result.kitchen.kitchen} (${result.testerId})`;
  const make = (res) => `${REPO_ISSUE}?${new URLSearchParams({ title, labels: 'kitchen-test', body: '```json\n' + JSON.stringify(res) + '\n```' })}`;
  let href = make(result);
  // GitHub drops very long URLs: the kitchen's items go first, the file keeps them.
  if (href.length > 7800) href = make({ ...result, kitchen: { ...result.kitchen, items: `${result.kitchen.items.length} items, see the file` } });
  return href;
}

function download(res) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(res, null, 1)], { type: 'application/json' }));
  a.download = fileName(res);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function markSent() {
  run.sent = true;
  save();
  render();
}

/** One tap: through the relay into the repo (src/send.js). No signal keeps it on the phone; no relay and no token asks for one. */
async function send() {
  const res = resultOf();
  sendState = 'sending';
  render();
  const r = await sendResult(res);
  sendState = r;
  if (r === 'sent' || r === 'queued') { buzz(20); return markSent(); }
  if (r === 'failed') download(res); // the file is the last way home
  save();
  render();
  root.querySelector('#rq-token')?.focus();
}

async function saveToken() {
  const input = root.querySelector('#rq-token');
  const t = input?.value ?? '';
  if (!t.trim()) { input?.focus(); return; }
  sendState = 'sending';
  render();
  const ok = await setToken(t);
  if (ok === 'bad') { sendState = 'bad'; render(); root.querySelector('#rq-token')?.focus(); return; }
  if (ok === 'offline') { sendState = 'queued'; return markSent(); } // token kept unchecked; answers wait for signal
  return send();
}
