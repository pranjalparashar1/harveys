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
import { blankFeedback, splitIdeas, norm } from './brain/feedback.js';
import { rank } from './brain/ranker.js';
import { MOMENT, TARGETS } from './brain/kitchen-test.js';
import { DEFAULT_CONFIG } from './brain/config.js';

const KEY = 'harveys.rq.v1';
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 1.45.0: no more invisible switch inside every button. An <input> nested in a <button> is
// invalid HTML, and on iPhones it sat over the button's whole area and took the tap. One
// hidden switch, ticked from code during the tap, gives the same iOS haptic.
const HX = '';
let hapticEl = null;
const buzz = (ms = 8) => {
  if ('switch' in HTMLInputElement.prototype) {
    try {
      if (!hapticEl) {
        hapticEl = document.createElement('label');
        hapticEl.setAttribute('aria-hidden', 'true');
        hapticEl.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
        hapticEl.innerHTML = '<input type="checkbox" switch tabindex="-1">';
        document.body.append(hapticEl);
      }
      hapticEl.click();
    } catch { /* no haptic */ }
  } else if (navigator.vibrate) try { navigator.vibrate(ms); } catch { /* no vibration */ }
};
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
let downAt = null; // where the finger went down, to tell a tap from a scroll
let navTap = null; // the tap that last changed screen, so a double tap can't skip the next one
let guarded = false; // a history entry so the phone's Back goes back one screen, not off the site
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
  // 1.48.0: dishes come in the seeded shuffle, not Harvey's easiest-first order. Shown in
  // Harvey's order, the effort stars partly echo the position, and Marco trains on them.
  (quiz.rateOrder ?? quiz.deck).forEach((id, i) => out.push({ kind: 'dish', id, i }));
  // 1.46.0: the bonus is two screens: how it's made and what the one extra thing unlocks,
  // then its ratings. "Was anything confusing?" is gone (pranjal: it added nothing).
  if (quiz.bonus) out.push({ kind: 'bonusinfo' }, { kind: 'bonus' });
  out.push({ kind: 'end' });
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
  // 1.47.1: only a minor or major bump restarts; a patch (a fix like 1.47.1) keeps the run.
  const minor = (v) => String(v ?? '').split('.').slice(0, 2).join('.');
  if (run && !run.sent && minor(run.v) !== minor(version)) run = null;
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
    // Instant feedback: the finger's button looks pressed at once (iOS needs a touch
    // listener before :active works at all).
    root.addEventListener('touchstart', () => {}, { passive: true });
    root.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      root.querySelector('.press')?.classList.remove('press');
      e.target.closest?.('[data-act]')?.classList.add('press');
    }, { passive: true });
    const unpress = () => root.querySelector('.press')?.classList.remove('press');
    root.addEventListener('pointerup', () => setTimeout(unpress, 120), { passive: true });
    root.addEventListener('pointercancel', unpress, { passive: true });
    addEventListener('popstate', onPop);
    root.addEventListener('submit', (e) => { e.preventDefault(); const f = e.target.closest('.rq-add'); if (f) typeAdd(f); });
    root.addEventListener('input', (e) => {
      if (e.target.matches('.rq-makes textarea')) { run.answers.feedback.makes = e.target.value.slice(0, 1000); run.answers.feedback.seen = true; save(); }
    });
    document.addEventListener('keydown', onKey);
  }
  root.hidden = false;
  document.documentElement.classList.add('rq-open');
  guard();
  render(true);
}

/** One extra history entry while the test is open: the phone's Back button or swipe then
 * lands in onPop, which goes back one screen, instead of leaving the page. */
function guard() {
  if (guarded) return;
  try { history.pushState({ rq: 1 }, ''); guarded = true; } catch { /* no history */ }
}
function onPop() {
  guarded = false;
  if (!root || root.hidden) return;
  if (sheetId) { closeRecipe(); return guard(); }
  if (run.at === 0 && !panel) return close();
  goBack();
  guard();
}

function close() {
  root.hidden = true;
  document.documentElement.classList.remove('rq-open');
  opts.onExit?.();
}

/** The quiz again with what the tester confirmed: unticked items out, added ones in. */
function rebuild(conf) {
  if (!opts.items) return;
  const inv = invFor(conf);
  // 1.49.0: dishes the tester's additions unlocked get the free rating slots first.
  const before = mealsIn(opts.inventory);
  const prefer = new Set([...mealsIn(inv)].filter((id) => !before.has(id)));
  quiz = buildRungQuiz({ kitchen: kitchenIn, inventory: inv, prefer });
}
/** The kitchen as the confirm screens have it: unticked items out, added ones in. */
function invFor(conf) {
  const gone = new Set((conf?.removed ?? []).map(norm));
  const kept = opts.items.filter((i) => !gone.has(norm(typeof i === 'string' ? i : i?.name)));
  const typed = conf?.typed ?? [];
  const ids = [...new Set([...(conf?.have ?? []), ...typed.filter((t) => t.id).map((t) => t.id)])];
  const extras = typed.filter((t) => !t.id).map((t) => t.text);
  return ids.length || extras.length || gone.size ? withConfirmed(kept, ids, { cache: opts.cache, missingBasics: opts.missingBasics }, extras) : opts.inventory;
}
/** Ids of the dishes this kitchen can make, counted the way the reveal counts them. */
const mealsIn = (inv) => new Set(rank({
  inventory: inv, targets: TARGETS, context: { hour: MOMENT.hour, weekday: MOMENT.weekday, kind: quiz?.kind ?? 'meal' }, catalogue: CATALOGUE, config: DEFAULT_CONFIG,
}).ranked.map((r) => r.meal.id));

// ── "+3 meal ideas" (1.49.0) ────────────────────────────────────────────────
// pranjal, 23 Nov: each food or cookware the tester ticks shows, for a moment, how many more
// dishes it opens up given everything else ticked. Nothing shows when it opens up none.
const snap = () => { const d = draft(); return { have: [...d.have], typed: d.typed.map((t) => ({ ...t })), removed: [...d.removed] }; };
let toastEl = null;
let toastT = 0;
function unlockToast(before) {
  if (!opts.items) return;
  let n = 0;
  try {
    const was = mealsIn(invFor(before));
    n = [...mealsIn(invFor(draft()))].filter((id) => !was.has(id)).length;
  } catch { return; }
  if (n < 1) { toastEl?.classList.remove('show'); return; }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'rq-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  toastEl.textContent = `+${n} meal ${n === 1 ? 'idea' : 'ideas'}`;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // restart the pop on a quick second tap
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 1600);
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
    seg((s) => s.kind === 'bonusinfo' || s.kind === 'bonus'),
  ].join('')}</div>`;
}

let shownKey = '';
function render(enter = false) {
  const list = screens();
  const s = list[run.at];
  const key = `${run.at}:${panel}`;
  const same = key === shownKey; // the same screen redrawn: keep its place, don't animate in
  const keepY = same ? root.scrollTop : 0;
  shownKey = key;
  if (!same) shownAt = performance.now();
  if (!same) root.classList.remove('rq-skip');
  let body = '';
  let foot = '';
  const back = run.at > 0 || panel ? `<button class="rq-icon" data-act="back" type="button" aria-label="Back">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : '<span class="rq-icon ghost"></span>';
  if (s.kind !== 'confirm') panel = null;

  if (s.kind === 'intro') ({ body, foot } = introScreen());
  else if (s.kind === 'confirm') ({ body, foot } = confirmScreen(s.side, back));
  else if (s.kind === 'think') ({ body, foot } = thinkScreen());
  else if (s.kind === 'reveal') ({ body, foot } = revealScreen(back));
  else if (s.kind === 'dish') ({ body, foot } = dishScreen(s, back));
  else if (s.kind === 'bonusinfo') ({ body, foot } = bonusInfoScreen(back));
  else if (s.kind === 'bonus') ({ body, foot } = bonusScreen(back));
  else ({ body, foot } = endScreen());

  const ghost = ['intro', 'end', 'think', 'reveal'].includes(s.kind);
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
  clearInterval(demoTimer);
  // On the hello, the close and Start fresh buttons wait until the last line is in: the page
  // starts empty but for "Hi".
  const topIn = s.kind === 'intro' ? ` rq-seq" style="--s:${introSteps}` : '';
  root.innerHTML = `
    <header class="rq-top${topIn}">
      <button class="rq-icon" data-act="close" type="button" aria-label="Close">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      ${ghost ? '<div class="rq-bar"></div>' : bar(list)}
      <button class="rq-fresh" data-act="fresh" type="button">Start fresh</button>
    </header>
    <main class="rq-body${enter ? '' : same ? ' still' : ' in'}" data-kind="${s.kind}${panel ? '-add' : ''}">${body}</main>
    <footer class="rq-foot">${foot}</footer>`;
  root.scrollTop = keepY;
  clearTimeout(thinkTimer);
  if (s.kind === 'think') thinkTimer = setTimeout(() => { if (screens()[run.at]?.kind === 'think' && !root.hidden) { run.at++; save(); render(); } }, THINK_MS);
  if (s.kind === 'reveal') { countUp(); demoStars(); }
  if (s.kind === 'dish') syncDish(s.id);
  if (s.kind === 'bonus') syncDish(quiz.bonus.id);
}

// 1.46.0 (pranjal): the page starts empty but for "Hi, Riya". Each line then fades in on its
// own, so a tester reads one thing at a time. No word yet of videos or ideas: Harvey's found
// some things in their kitchen and wants them checked. What to do with the ideas comes after
// the thinking screen, when there are ideas. A tap anywhere shows the rest at once.
let introSteps = 0;
function introScreen() {
  const can = Object.keys(quiz.dishes).length || opts.items;
  let n = 0;
  // 1.46.0: a bare class="rq-seq" here sat beside the element's own class, and a browser keeps
  // only the first, so in 1.45 every line showed at once. Now one class attribute each.
  const seq = () => `style="--s:${n++}"`;
  const hi = `<h1 class="rq-hi rq-seq" ${seq()}>${run.name ? `Hi, ${esc(run.name)}` : 'Hi there'}</h1>`;
  if (!can) {
    const body = `<div class="rq-hero intro">${hi}<p class="rq-say rq-seq" ${seq()}>Harvey’s has no ideas for this kitchen yet. Add a few more things to your list and try again.</p></div>`;
    introSteps = n;
    return { body, foot: `<button class="btn xl rq-go rq-seq" style="--s:${n}" data-act="close" type="button"><span>Back to my list</span></button>` };
  }
  const lines = opts.items
    ? ['Harvey’s spotted some food and cookware in your kitchen.', 'Some of it may be wrong.', '<b>Help Harvey’s check it.</b>']
    : ['Harvey’s has your kitchen list.', '<b>Let’s see what it can make.</b>'];
  const body = `
      <div class="rq-hero intro" data-act="skipintro">
        ${hi}
        ${lines.map((l) => `<p class="rq-say rq-seq" ${seq()}>${l}</p>`).join('')}
      </div>`;
  introSteps = n;
  return { body, foot: `<button class="btn primary xl rq-go rq-seq" style="--s:${n}" data-act="next" type="button"><span>${opts.items ? 'Check my kitchen' : 'Start'}</span></button>` };
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
  const before = snap();
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
  unlockToast(before);
}

// ── Thinking and the count ──────────────────────────────────────────────────
const THINK_MS = 1800; // 1.45.0: was 3.2 s, and testers read it as Next being slow
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
  // 1.49.0: the count is every dish the kitchen can make; the tester rates up to DECK_MAX of them.
  const more = quiz.deck.length - quiz.cookable;
  const n = Math.max(quiz.total ?? 0, quiz.cookable);
  const ideas = n + more;
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
  // 1.46.0: what to do now lives here, once there are ideas. The example stars keep changing,
  // so nobody reads them as the rating to give.
  const demo = (kind, label) => `<div class="rq-demo-ask" data-demo="${kind}"><p><b>${label}</b><span class="rq-sv"></span></p><span class="rq-sw demo" aria-hidden="true">${[1, 2, 3, 4, 5].map(() => `<i>${STAR}</i>`).join('')}</span></div>`;
  return {
    body: `
      <div class="rq-hero reveal">
        <p class="rq-eyebrow">Harvey’s came up with</p>
        <h1 class="rq-count"><span class="rq-num-big" data-to="${ideas}">${ideas}</span><span>meal and snack ${ideas === 1 ? 'idea' : 'ideas'} for your kitchen</span></h1>
        ${more ? `<p class="rq-lead">${n} you can make now, ${more} need${more === 1 ? 's' : ''} one more thing.</p>` : ''}
        <div class="rq-explain rq-seq" style="--s:1">
          <p class="rq-explain-q">${ideas > quiz.deck.length ? `Now rate ${quiz.deck.length} of them, one at a time` : 'Now rate each idea, one at a time'}</p>
          <p class="rq-explain-n">Give each one as many stars as you like. The stars are for the food, not your kitchen.</p>
          ${demo('effort', 'Effort')}
          ${demo('taste', 'Taste')}
        </div>
      </div>`,
    foot: `${back}<button class="btn primary xl rq-go rq-seq" style="--s:2" data-act="next" type="button">${HX}<span>Start rating</span></button>`,
  };
}

/** The example on the reveal: each row fills to a new number every second or so, with its word. */
let demoTimer = 0;
const DEMO = { effort: [2, 5, 3, 4, 1], taste: [4, 2, 5, 3, 5] };
function demoStars() {
  const rows = [...root.querySelectorAll('.rq-demo-ask')];
  if (!rows.length) return;
  let k = 0;
  const step = () => {
    rows.forEach((row, r) => {
      if ((k + r) % 2) return; // the two rows take turns
      const kind = row.dataset.demo;
      const seq = DEMO[kind];
      const v = seq[Math.floor((k + r) / 2) % seq.length];
      fillStars([...row.querySelectorAll('i')], v);
      row.querySelector('.rq-sv').textContent = (kind === 'effort' ? EFFORT_STARS : TASTE_STARS)[v - 1];
    });
    k++;
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { if (!root.querySelector('.rq-demo-ask')) return; step(); step(); if (!still) demoTimer = setInterval(step, 1100); }, 1500);
}

/** Stars on to v, filling left to right and emptying right to left, each with a small spring.
 * Only classes, a delay and a transform animation: nothing that moves the layout. */
function fillStars(stars, v) {
  const was = stars.filter((el) => el.classList.contains('on')).length;
  stars.forEach((el, i) => {
    const n = i + 1;
    const on = n <= v;
    if (el.classList.contains('on') === on) return;
    const delay = on ? (n - was - 1) * 45 : (was - n) * 30;
    el.style.setProperty('--dl', `${delay}ms`);
    el.classList.toggle('on', on);
    if (on) spring(el.querySelector('svg'), delay);
  });
}
const SPRING = 'linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.7%, 0.737 7.4%, 0.984 10.4%, 1.112 13.1%, 1.161 15.5%, 1.164 17.4%, 1.139 19.6%, 1.006 26.4%, 0.976 29.6%, 0.968 32.9%, 0.986 41.3%, 1.002 51.3%, 1)';
let springOk = null;
function spring(el, delay = 0) {
  if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (springOk == null) springOk = CSS.supports?.('transition-timing-function', SPRING) ?? false;
  try {
    el.animate([{ transform: 'scale(.72)' }, { transform: 'scale(1)' }], { duration: springOk ? 620 : 380, delay, easing: springOk ? SPRING : 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
  } catch { /* no animation */ }
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
  effort: { q: 'How easy to make?', words: EFFORT_STARS },
  taste: { q: 'How tasty would it be?', words: TASTE_STARS },
  want: { q: '', words: WANT_STARS },
};
const starOf = (id) => run.answers.stars?.[id] ?? {};
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

const cantsOf = (a) => a.cants ?? (a.cant ? [a.cant] : []);
const cantOn = (a) => !!(a.cantOpen || a.cant || a.cants?.length);
/** 1.46.0: a dish is done when it's rated, or when they can't make it and said what's missing. */
const isDone = (id) => { const a = starOf(id); return cantOn(a) ? cantsOf(a).length > 0 : !!(a.effort && a.taste); };

function dishScreen(s, back) {
  const d = dishOf(s.id);
  const total = quiz.deck.length;
  const last = s.i === total - 1;
  const body = `
      <p class="rq-eyebrow">Idea ${s.i + 1} of ${total}</p>
      <h1 class="rq-dname">${esc(d.name)}</h1>
      <p class="rq-ding">${esc(ingredientsOf(d))}</p>
      ${d.away ? `<p class="rq-need">Needs ${esc(d.away)}</p>` : ''}
      <div class="rq-dact">
        <button class="rq-see" data-act="recipe" data-id="${esc(s.id)}" type="button">${HX}<span>See the recipe</span>${CHEV}</button>
      </div>
      <p class="rq-ifcould" hidden>If you could make it, how would you rate it? <span>Optional</span></p>
      ${askRow(s.id, 'effort')}
      ${askRow(s.id, 'taste')}
      <div class="rq-cantbox">
        <button class="rq-tile rq-canttoggle" data-act="cant" data-id="${esc(s.id)}" type="button" aria-pressed="false" aria-expanded="false">${HX}<span class="rq-box" aria-hidden="true">${TICK}</span><span class="rq-tl">I can’t make this</span></button>
        <div class="rq-cantwhy" hidden role="group" aria-label="What’s missing">
          <p class="rq-cant-q">What’s missing? <span>Tap one or both.</span></p>
          <div class="rq-tiles add">${CANT.map((c) => `<button class="rq-tile" data-act="cantwhy" data-id="${esc(s.id)}" data-why="${c.id}" type="button" aria-pressed="false">${HX}<span class="rq-box" aria-hidden="true">${TICK}</span><span class="rq-tl">${esc(c.label)}</span></button>`).join('')}</div>
        </div>
      </div>`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>${last ? 'Next' : 'Next idea'}</span></button>` };
}

/** Stars, words, the taste row's turn, can't-make, and Next, for the dish (or bonus) on screen. */
function syncDish(id) {
  const a = starOf(id);
  const w = run.answers.bonusItem;
  const bonus = quiz.bonus?.id === id;
  const cant = !bonus && cantOn(a);
  for (const box of root.querySelectorAll('.rq-ask')) {
    const kind = box.dataset.kind;
    const v = (kind === 'want' ? w.want : a[kind]) ?? 0;
    box.classList.toggle('set', !!v);
    // One row at a time: effort, then taste, then (bonus) the item.
    box.classList.toggle('wait', (kind === 'taste' && !a.effort && !cant) || (kind === 'want' && !(a.effort && a.taste) && !w.want && !w.have));
    box.classList.toggle('off', kind === 'want' && !!w.have);
    box.classList.toggle('maybe', cant);
    const stars = [...box.querySelectorAll('.rq-star')];
    fillStars(stars, v);
    for (const b of stars) b.setAttribute('aria-checked', String(Number(b.dataset.n) === v));
    box.querySelector('.rq-sv').textContent = v ? ASK[kind].words[v - 1] : '';
  }
  const why = root.querySelector('.rq-cantwhy');
  if (why) {
    const picked = cantsOf(a);
    if (cant && why.hidden) { why.hidden = false; why.classList.add('appear'); requestAnimationFrame(() => why.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }
    if (!cant) why.hidden = true;
    const btn = root.querySelector('.rq-canttoggle');
    btn.classList.toggle('on', cant);
    btn.setAttribute('aria-pressed', String(cant));
    btn.setAttribute('aria-expanded', String(cant));
    why.classList.toggle('need', cant && !picked.length);
    for (const t of why.querySelectorAll('.rq-tile')) {
      const on = picked.includes(t.dataset.why);
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', String(on));
    }
    root.querySelector('.rq-ifcould').hidden = !cant;
  }
  const have = root.querySelector('.rq-have');
  if (have) { have.classList.toggle('on', !!w.have); have.setAttribute('aria-pressed', String(!!w.have)); }
  const done = bonus ? !!(a.effort && a.taste && (w.want || w.have)) : isDone(id);
  const go = root.querySelector('.rq-foot [data-act="next"]');
  if (go) {
    go.setAttribute('aria-disabled', String(!done));
    go.classList.toggle('ready', done);
  }
  unnudge();
}

function setStar(id, kind, n) {
  if (kind === 'want') {
    const w = run.answers.bonusItem;
    w.want = w.want === n ? 0 : n;
    if (w.want) w.have = false;
    w.ms = Math.round(performance.now() - shownAt);
  } else {
    const a = (run.answers.stars[id] ??= {});
    a[kind] = a[kind] === n ? 0 : n; // tap the same star again to clear it
    a.ms = Math.round(performance.now() - shownAt);
  }
  save();
  buzz(n >= 4 ? 12 : 8);
  syncDish(id);
  showNext();
}

/** 1.48.0: after a rating, bring the next question into view. On an iPhone SE the taste row
 * sat half under the footer and "I can't make this" was off screen, with nothing to say so. */
function showNext() {
  const next = root.querySelector('.rq-ask:not(.set):not(.off)') ?? root.querySelector('.rq-cantbox');
  if (!next) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => next.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }));
}

/** "I can't make this" is a tick box: tap again to take it back. The reasons are tick boxes too. */
function cantTap(id, why = null) {
  const a = (run.answers.stars[id] ??= {});
  if (why) {
    const picked = cantsOf(a);
    a.cants = picked.includes(why) ? picked.filter((x) => x !== why) : [...picked, why];
    a.cant = a.cants[0] ?? null;
    a.cantOpen = true;
  } else if (cantOn(a)) { a.cant = null; a.cants = []; a.cantOpen = false; } else a.cantOpen = true;
  a.ms = Math.round(performance.now() - shownAt);
  save();
  syncDish(id);
}

// ── The bonus: one more thing (1.46.0) ──────────────────────────────────────
// pranjal: "Rice, would you buy it?" means nothing on its own. First how the dish is made and
// what that one thing would let them cook, then the ratings.
const aOrAn = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const needName = (b) => (b.need.kind !== 'food' ? `${aOrAn(b.need.label)} ${b.need.label.toLowerCase()}` : b.need.label.toLowerCase());

function bonusInfoScreen(back) {
  const b = quiz.bonus;
  const meal = CATALOGUE.find((m) => m.id === b.id);
  const steps = meal?.steps ?? [];
  const others = b.unlocks.filter((u) => u.id !== b.id);
  const thing = needName(b);
  const body = `
      <p class="rq-eyebrow">Bonus idea</p>
      <h1 class="rq-dname">${esc(b.name)}</h1>
      ${ingredientsOf(b) ? `<p class="rq-ding">${esc(ingredientsOf(b))}</p>` : ''}
      <p class="rq-need">You’d need ${esc(thing)}</p>
      ${ITEM_NOTE[b.need.id] ? `<p class="rq-note">${esc(ITEM_NOTE[b.need.id])}</p>` : ''}
      <p class="rq-group">How it’s made</p>
      <ol class="rq-steps-list">${steps.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol>
      ${others.length ? `<div class="rq-item"><p class="rq-unlocks">With ${esc(thing)} you could also make <strong>${others.slice(0, 3).map((u) => esc(u.name)).join(', ')}</strong>${others.length > 3 ? ` and ${others.length - 3} more` : ''}.</p></div>` : ''}`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Rate it</span></button>` };
}

function bonusScreen(back) {
  const b = quiz.bonus;
  const kit = b.need.kind !== 'food';
  const thing = needName(b);
  const body = `
      <p class="rq-eyebrow">Bonus idea · needs ${esc(thing)}</p>
      <h1 class="rq-dname">${esc(b.name)}</h1>
      ${askRow(b.id, 'effort')}
      ${askRow(b.id, 'taste')}
      ${askRow(b.id, 'want', `Would you ${kit ? 'get' : 'buy'} ${thing} to make it?`)}
      <button class="rq-tile rq-have" data-act="havebonus" type="button" aria-pressed="false">${HX}<span class="rq-box" aria-hidden="true">${TICK}</span><span class="rq-tl">I already have ${kit ? 'one' : 'it'}</span></button>`;
  return { body, foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>` };
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
  fb.seen = true; // 1.46.0: no feedback screen; reaching the end is what counts
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
// 1.45.0 (pranjal, 23 Nov, live test: "buttons are broken, do nothing, or take too long"):
// 1.44 ignored any tap within 140 ms of a scroll event and within 320 ms of a new screen.
// On an iPhone a flicked list keeps sending scroll events for a second or more as it slows
// and bounces at the bottom, so taps on a still-looking list (Missed something?, the tiles)
// were silently thrown away. Now: a finger that travelled is a scroll (the phone already
// sends no click for those), and the only tap dropped is a repeat, at the same spot, of the
// tap that just changed the screen. Every kept tap shows and buzzes at once.
const NAV = new Set(['next', 'back', 'more', 'cat', 'paneldone', 'recipe', 'recipeclose']);

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const now = performance.now();
  if (!sheetId && downAt && e.clientX && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 16) return;
  if (sheetDragged && now - sheetDragged < 350) return; // the lift at the end of a sheet drag
  if (navTap && now - navTap.t < 350 && Math.hypot(e.clientX - navTap.x, e.clientY - navTap.y) < 40) return;
  if (NAV.has(act)) navTap = { t: now, x: e.clientX, y: e.clientY };
  buzz();
  const list = screens();
  const s = list[run.at];
  if (act === 'skipintro') { root.classList.add('rq-skip'); return; }
  if (act === 'close') return close();
  if (act === 'back' && sheetId) return closeRecipe();
  // 1.40.0: one tap on the first screen; mid-test a second tap, so a stray thumb loses nothing.
  if (act === 'fresh') {
    if (run.at > 0 && !el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start fresh'; }, 4000); return; }
    el.textContent = 'Starting…';
    return startFresh();
  }
  if (act === 'back') return goBack();
  if (act === 'recipe') return openRecipe(el.dataset.id);
  if (act === 'recipeclose') return closeRecipe();
  if (act === 'star') return setStar(el.dataset.id, el.dataset.kind, Number(el.dataset.n));
  if (act === 'cant') return cantTap(el.dataset.id);
  if (act === 'cantwhy') return cantTap(el.dataset.id, el.dataset.why);
  if (act === 'havebonus') { const w = run.answers.bonusItem; w.have = !w.have; if (w.have) w.want = 0; save(); return syncDish(quiz.bonus.id); }
  if (act === 'untick') {
    const d = draft();
    const name = el.dataset.name;
    const before = snap();
    d.removed = isRemoved(name) ? d.removed.filter((n) => norm(n) !== norm(name)) : [...d.removed, name];
    save();
    el.classList.toggle('on', !isRemoved(name));
    el.setAttribute('aria-pressed', String(!isRemoved(name)));
    if (!isRemoved(name)) unlockToast(before);
    return;
  }
  if (act === 'addopt' || act === 'typeddrop') {
    const before = snap();
    toggleOpt(el, s.side);
    save();
    unlockToast(before);
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
  if (act === 'next') {
    if (el.getAttribute('aria-disabled') === 'true') return nudge();
    commit(s);
    run.at = Math.min(list.length - 1, run.at + 1);
    save();
    return render();
  }
  if (act === 'send') return send();
  if (act === 'github') { const res = resultOf(); window.open(issueHref(res), '_blank', 'noopener'); sendState = 'sent'; markSent(); return; }
  if (act === 'token') return saveToken();
  if (act === 'nextperson') { store.runs[quiz.id] = run = freshRun(); rebuild(null); sendState = ''; save(); return render(); }
  if (act === 'file') { download(resultOf()); return; }
}

function goBack() {
  const list = screens();
  const s = list[run.at];
  if (s.kind === 'confirm' && panel) { panel = panel === 'cats' ? null : 'cats'; return render(); }
  if (run.at === 0) return;
  commit(s);
  run.at = Math.max(0, run.at - 1);
  while (run.at > 0 && passOver(list[run.at])) run.at--;
  save();
  return render();
}

let nudgeTimer = 0;
function unnudge() {
  const go = root?.querySelector('.rq-foot [data-act="next"] span');
  if (go?.dataset.was) { go.textContent = go.dataset.was; delete go.dataset.was; }
}
/** Next tapped before the stars: point at what's missing instead of doing nothing. */
function nudge() {
  const why = root.querySelector('.rq-cantwhy.need');
  const box = why ?? [...root.querySelectorAll('.rq-ask')].find((b) => !b.classList.contains('set') && !b.classList.contains('off'));
  const go = root.querySelector('.rq-foot [data-act="next"] span');
  if (go) {
    go.dataset.was ??= go.textContent;
    go.textContent = why ? 'Tap what’s missing' : box?.dataset.kind === 'taste' ? 'Rate taste first' : box?.dataset.kind === 'want' ? 'Tap the stars first' : 'Rate effort first';
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(unnudge, 1600);
  }
  if (!box) return;
  box.classList.remove('nudge');
  void box.offsetWidth; // restart the animation
  box.classList.add('nudge');
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
}

// ── The recipe, over the dish ───────────────────────────────────────────────
const ingName = (i) => {
  const ids = (i.anyOf ?? [i.id]).filter((x) => x && !String(x).startsWith('role:'));
  return ids.map((x, n) => (n ? labelFor(x).toLowerCase() : labelFor(x))).join(' or ');
};

// 1.46.0 (pranjal: "the close is jittery"): the sheet moves only by transitions on transform,
// with the iOS sheet curve, so open, close and a drag hand over to each other mid-move instead
// of a keyframe fighting a transition. A grey grabber says it can be pulled down; pulling the
// top, or the recipe when it's scrolled to the top, drags it, and a pull past a quarter of its
// height or a flick closes it.
let sheetDragged = 0;
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
      <div class="rq-grab" aria-hidden="true"><i></i></div>
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
  void sheet.offsetHeight; // start from below the screen, then slide up
  sheet.classList.add('open');
  dragSheet(sheet);
  sheet.querySelector('.rq-sheet-foot .rq-go').focus({ preventScroll: true });
}

/** Close, carrying on at the finger's speed when it was flicked (v in px/ms). */
function closeRecipe(v = 0) {
  const sheet = root.querySelector('.rq-sheet:not(.out)');
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
  shownAt = performance.now();
  if (!sheet) return;
  const pane = sheet.querySelector('.rq-sheet-in');
  const scrim = sheet.querySelector('.rq-scrim');
  const left = pane.offsetHeight - (new DOMMatrixReadOnly(getComputedStyle(pane).transform).m42 || 0);
  const ms = v > 0.3 ? Math.max(160, Math.min(380, left / v)) : 380;
  pane.style.transitionDuration = `${ms}ms`;
  scrim.style.transitionDuration = `${ms}ms`;
  pane.style.transform = '';
  scrim.style.opacity = '';
  sheet.classList.add('out');
  sheet.classList.remove('open');
  let gone = false;
  const done = () => { if (!gone) { gone = true; sheet.remove(); } };
  pane.addEventListener('transitionend', (e) => { if (e.target === pane && e.propertyName === 'transform') done(); });
  setTimeout(done, ms + 120);
}

function dragSheet(sheet) {
  const pane = sheet.querySelector('.rq-sheet-in');
  const scrim = sheet.querySelector('.rq-scrim');
  const body = sheet.querySelector('.rq-sheet-body');
  let y0 = null; let dy = 0; let h = 0; let pts = []; let live = false; let fromBody = false;
  const begin = (y, inBody) => { y0 = y; dy = 0; h = pane.offsetHeight; pts = [[performance.now(), y]]; live = false; fromBody = inBody; };
  const move = (y) => {
    if (y0 == null) return false;
    let d = y - y0;
    if (!live) {
      if (fromBody && (body.scrollTop > 0 || d < 0)) { y0 = null; return false; } // the recipe scrolls as usual
      if (Math.abs(d) < 6) return false;
      live = true;
      y0 = y; d = 0;
      pane.classList.add('drag');
      scrim.classList.add('drag');
    }
    dy = d >= 0 ? d : -6 * Math.sqrt(-d); // a little give upwards, like iOS
    pane.style.transform = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
    scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / h));
    pts.push([performance.now(), y]);
    if (pts.length > 6) pts.shift();
    return true;
  };
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    if (!live) return;
    live = false;
    sheetDragged = performance.now();
    const [t1, a] = pts[0];
    const [t2, b] = pts[pts.length - 1];
    const v = t2 - t1 > 0 ? (b - a) / (t2 - t1) : 0;
    pane.classList.remove('drag');
    scrim.classList.remove('drag');
    if (dy > h * 0.25 || (v > 0.5 && dy > 20)) return closeRecipe(v);
    pane.style.transform = '';
    scrim.style.opacity = '';
  };
  // The grabber and the top row: mouse or finger, through pointer events.
  for (const el of [sheet.querySelector('.rq-grab'), sheet.querySelector('.rq-sheet-top')]) {
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) begin(e.clientY, false); });
  }
  const pm = (e) => move(e.clientY);
  addEventListener('pointermove', pm, { passive: true });
  addEventListener('pointerup', end, { passive: true });
  addEventListener('pointercancel', end, { passive: true });
  // The recipe itself: only when it's at the top and pulled down. Touch events, so the drag
  // can take over from the scroll.
  body.addEventListener('touchstart', (e) => begin(e.touches[0].clientY, true), { passive: true });
  body.addEventListener('touchmove', (e) => { if (move(e.touches[0].clientY)) e.preventDefault(); }, { passive: false });
  body.addEventListener('touchend', end, { passive: true });
  body.addEventListener('touchcancel', end, { passive: true });
  new MutationObserver((_, ob) => {
    if (sheet.isConnected) return;
    ob.disconnect();
    removeEventListener('pointermove', pm);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
  }).observe(root, { childList: true });
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
