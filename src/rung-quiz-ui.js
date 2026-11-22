// Rung quiz screens (1.31.0; one-tap send, a fresh tester per run 1.32.0; relay send 1.33.0): what a tester sees
// after Proceed. Kiron's rules: one question
// per screen, a story bar with no numbers, drag to sort, tap to pick, haptics on every tap.
// The brain work is src/brain/rung-quiz.js; this file is screens, drag, storage and sending.
import { buildRungQuiz, encodeRungResult, CRITERIA, WHY_NOT, DIFFICULTY } from './brain/rung-quiz.js';
import { CATALOGUE } from './brain/catalogue.js';
import { confirmCandidates, kitCandidates, withConfirmed, matchTyped, STOVES, BURNERS } from './brain/confirm.js';
import { sendResult, flush, setToken, outbox } from './send.js';
import { startFresh } from './fresh.js';
import { CHIPS, FOLLOW_UPS, WOULDNT_WHY, CONFUSING, blankFeedback, quickDishes, splitIdeas, norm } from './brain/feedback.js';

const KEY = 'harveys.rq.v1';
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HX = '<input type="checkbox" switch class="haptic" tabindex="-1" aria-hidden="true">';
const buzz = (ms = 8) => { if (!('switch' in HTMLInputElement.prototype) && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* no vibration */ } };

const SECTIONS = {
  marco: {
    round: 'Round 1', title: 'Easiest first',
    cover: 'It’s a weeknight, 9 PM, and you’re tired. Drag the dish that’s the least effort to the top.',
    ask: 'Which is the least effort?', lead: 'Drag the easiest to the top.', top: 'Easiest', bottom: 'Most effort',
  },
  pierre: {
    round: 'Round 2', title: 'Tastiest first',
    cover: 'Same dishes, new question. Forget the effort: drag the one you’d enjoy eating most to the top.',
    ask: 'Which would you enjoy most?', lead: 'Drag the tastiest to the top.', top: 'Tastiest', bottom: 'Least tasty',
  },
  white: {
    round: 'Round 3', title: 'What you’d cook',
    cover: 'Still tired, still 9 PM. Tap what you would actually make, your favourite first. Tap again to take one back.',
    ask: 'What would you actually cook tonight?', lead: 'Tap in order, favourite first.',
  },
};
const RUNG_HINT = {
  1: 'No heat, no knife',
  2: 'One appliance does the work',
  3: 'You stand at the stove',
  4: 'Two things cooking at once',
};
const rungHint = (g) => (g.rungs ?? [g.rung]).map((n, i) => (i ? RUNG_HINT[n].replace(/^./, (c) => c.toLowerCase()) : RUNG_HINT[n])).join(', or ');

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
/** A new run: a new person holding the phone, so a new tester id. */
const freshRun = (name = '') => ({ testerId: newTesterId(), runNo: ++store.seq, name, v: opts.version, answers: { marco: {}, pierre: {}, white: {}, cards: {}, difficulty: null, feedback: blankFeedback() }, at: 0, sent: false });
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode: keep going in memory */ } };

// ── State ───────────────────────────────────────────────────────────────────
let quiz = null;
let run = null; // { testerId, runNo, answers: {marco, pierre, white}, at: screen index, sent }
let sendState = ''; // '', 'sending', 'sent', 'queued', 'failed', 'auth', 'setup', 'bad'
let root = null;
let opts = {};
let shownAt = 0;
let order = null; // the list being sorted on screen
let picks = null; // White: { picks: [], criteria: [], none }
let fb = null; // the feedback screens: run.answers.feedback, edited in place
let ask = []; // 1.39.0: what Harvey asks about before Round 1 (confirm.js)
let haveNow = null; // the check screen's taps, until Next
let kit = { kit: [], noStove: false, hasStove: false }; // 1.41.0: the cookware row
let typedNow = null; // 1.41.0: "Add something else", [{ text, id, label, how }]
let burnersNow = null; // 1.41.0: how many can cook at once, 1 | 2 | 3 (3 or more)
let kitchenIn = null;

/**
 * screens (1.42.0): intro, the quick check, Harvey thinking, the count, the meal cards, an offer
 * to rate how hard they are, the ratings, feedback, end. The sorting rounds are gone.
 */
function screens() {
  const out = [{ kind: 'intro' }];
  if (ask.length || kit.kit.length || opts.items) out.push({ kind: 'check' });
  out.push({ kind: 'think' }, { kind: 'reveal' });
  if (quiz.deck.length) out.push({ kind: 'cards' }, { kind: 'rateask' }, { kind: 'rate' });
  // 1.34.0: what went wrong, then one short screen for each chip tapped.
  out.push({ kind: 'feedback' });
  const chips = run.answers.feedback?.chips ?? [];
  for (const chip of FOLLOW_UPS) if (chips.includes(chip)) out.push({ kind: 'fb', chip });
  out.push({ kind: 'end' });
  return out;
}
/** Screens Back passes over: the thinking pause, and the ratings when they were skipped. */
const passOver = (s) => s.kind === 'think' || (s.kind === 'rate' && run.answers.difficulty?.skipped);

export function startRungQuiz({ kitchen, inventory, version, source, name = '', onExit, items = null, cache = {}, missingBasics = [] }) {
  opts = { version, source, name, onExit, items, cache, missingBasics, inventory };
  kitchenIn = kitchen;
  quiz = buildRungQuiz({ kitchen, inventory });
  store = loadStore();
  run = store.runs[quiz.id];
  // 1.39.0: "Did Harvey miss anything?" needs the list itself, so only when the page passes it.
  ask = items ? confirmCandidates(items, { cache, missingBasics }) : [];
  kit = items ? kitCandidates(items, { cache, missingBasics }) : { kit: [], noStove: false, hasStove: false };
  if (run && !run.sent && run.v === version && run.answers?.confirm) rebuild(run.answers.confirm);
  // 1.40.0: a run saved by an older version starts again: its screens no longer line up
  // (1.39.0 put the check before Round 1, so a saved spot skipped it).
  if (run && !run.sent && run.v !== version) run = null;
  // A sent run belongs to the last person: whoever opens it next is someone new.
  if (!run || run.sent) run = store.runs[quiz.id] = freshRun(name);
  // 1.35.0: the name in the link (share.html) greets the tester and labels their result.
  if (name && run.name == null) run.name = name; // a 1.34 run in progress; a "next person" run stays nameless
  run.testerId ??= newTesterId();
  run.answers.feedback ??= blankFeedback();
  run.answers.cards ??= {};
  if (run.at >= screens().length) run.at = 0;
  sendState = '';
  save();
  flush(); // anything left over from a send with no signal
  if (!root) {
    root = document.createElement('div');
    root.className = 'rq';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Taste test');
    document.body.append(root);
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('submit', (e) => {
      const f = e.target.closest('.rq-add');
      if (f?.classList.contains('rq-have-add') && haveNow) { e.preventDefault(); haveAdd(f); } else if (f && fb) { e.preventDefault(); fbAdd(f); }
    });
    document.addEventListener('keydown', onKey);
    root.addEventListener('input', (e) => { if (fb && e.target.matches('.rq-note textarea')) { fb.note = e.target.value.slice(0, 2000); save(); syncFb(); } });
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

/** The quiz again with what the tester said they have. Answers to the old dishes no longer fit. */
function rebuild(conf) {
  const typed = conf?.typed ?? [];
  const ids = [...new Set([...(conf?.have ?? []), ...typed.filter((t) => t.id).map((t) => t.id)])];
  const extras = typed.filter((t) => !t.id).map((t) => t.text);
  const inv = (ids.length || extras.length) && opts.items ? withConfirmed(opts.items, ids, { cache: opts.cache, missingBasics: opts.missingBasics }, extras) : opts.inventory;
  quiz = buildRungQuiz({ kitchen: kitchenIn, inventory: inv });
}
const confKey = (c) => JSON.stringify([[...(c?.have ?? [])].sort(), (c?.typed ?? []).map((t) => t.id ?? t.text).sort()]);

const resultOf = () => encodeRungResult(quiz, run.answers, { version: opts.version, at: new Date().toISOString(), testerId: run.testerId, runNo: run.runNo, source: opts.source, tester: run.name || '' });

// ── Render ──────────────────────────────────────────────────────────────────
function bar(list) {
  // One segment per question (covers and the end screen don't count), filled as you go.
  const qs = list.map((s, i) => [s, i]).filter(([s]) => ['check', 'cards', 'rate', 'feedback'].includes(s.kind));
  const part = (s) => (s.kind === 'cards' ? cardsDone() / quiz.deck.length : s.kind === 'rate' ? ratedCount() / quiz.deck.length : 0.45);
  return `<div class="rq-bar" aria-hidden="true">${qs.map(([s, i]) => `<i class="${i < run.at ? 'done' : i === run.at ? 'now' : ''}"${i === run.at ? ` style="--p:${Math.max(0.06, part(s)).toFixed(3)}"` : ''}></i>`).join('')}</div>`;
}

function render(enter = false) {
  const list = screens();
  const s = list[run.at];
  shownAt = performance.now();
  order = null;
  picks = null;
  fb = null;
  let body = '';
  let foot = '';
  const back = run.at > 0 ? `<button class="rq-icon" data-act="back" type="button" aria-label="Back">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : '<span class="rq-icon ghost"></span>';

  if (s.kind === 'intro') {
    body = `
      <div class="rq-hero">
        <p class="rq-eyebrow">${run.name ? `Hi, ${esc(run.name)}` : 'Taste test'}</p>
        <h1 class="rq-title">What would you cook tonight?</h1>
        <p class="rq-lead">${Object.keys(quiz.dishes).length || ask.length || kit.kit.length ? 'Harvey looks at your kitchen and suggests dishes, easiest first.' : 'Harvey couldn’t find a dish in this kitchen yet.'} Picture a weeknight, 9 PM. You’re tired.</p>
        <ol class="rq-rounds">
          <li><b>Quick check</b><span>Tap what Harvey missed</span></li>
          <li><b>Yes or no</b><span>Would you make each dish?</span></li>
          <li><b>How hard?</b><span>Rate the effort, if you like</span></li>
        </ol>
        <p class="rq-small">All taps, about two minutes. At the end you can tell Harvey what it got wrong.</p>
      </div>`;
    foot = Object.keys(quiz.dishes).length || ask.length || kit.kit.length
      ? `<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Start</span></button>`
      : `<p class="rq-lead">Add a few more things to your list and try again.</p><button class="btn xl rq-go" data-act="close" type="button">${HX}<span>Back to my list</span></button>`;
  } else if (s.kind === 'check') {
    haveNow = [...(run.answers.confirm?.have ?? [])];
    typedNow = (run.answers.confirm?.typed ?? []).map((t) => ({ ...t }));
    burnersNow = run.answers.confirm?.burners ?? null;
    const chip = (a) => `<button class="rq-tag" data-act="have" data-id="${esc(a.id)}" type="button" aria-pressed="false">${HX}<span>${esc(a.label)}</span></button>`;
    // No stove on the list: cookware first, since nothing on the stove counts without one.
    const kitBlock = kit.kit.length ? `
        <p class="rq-group">${kit.noStove ? 'How do you cook?' : 'Cookware'}</p>
        ${kit.noStove ? '<p class="rq-hint tight">Harvey didn’t spot a stove. Tap yours, and any pots or appliances.</p>' : ''}
        <div class="rq-tags rq-have" role="group" aria-label="Cookware you have">${kit.kit.map(chip).join('')}</div>` : '';
    const burners = `
        <div class="rq-burners" hidden>
          <p class="rq-group">How many things can cook on it at once?</p>
          <div class="rq-tags" role="group" aria-label="Burners">${BURNERS.map((b) => `<button class="rq-tag" data-act="burners" data-n="${b.n}" type="button" aria-pressed="false">${HX}<span>${esc(b.label)}</span></button>`).join('')}</div>
        </div>`;
    const foodBlock = ask.length ? `
        <p class="rq-group">Food</p>
        <div class="rq-tags rq-have" role="group" aria-label="Food you have">${ask.map(chip).join('')}</div>` : '';
    body = `
      <div class="rq-hero check">
        <p class="rq-eyebrow">Quick check</p>
        <h1 class="rq-q">Do you have any of these?</h1>
        <p class="rq-hint">A video can’t see inside jars or cupboards. Tap what’s in your kitchen, and Harvey can suggest more dishes.</p>
        ${kit.noStove ? kitBlock + burners + foodBlock : foodBlock + kitBlock + burners}
        <p class="rq-group">Anything else?</p>
        <form class="rq-add rq-have-add">
          <input type="text" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" placeholder="e.g. atta, soy sauce, toaster" aria-label="Add something else you have">
          <button class="rq-add-go" data-act="haveadd" type="button" aria-label="Add">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        </form>
        <div class="rq-tags rq-typed"></div>
      </div>`;
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>None of these</span></button>`;
  } else if (s.kind === 'cover') {
    const sec = SECTIONS[s.section];
    body = `
      <div class="rq-hero cover ${s.section}">
        <p class="rq-eyebrow">${sec.round}</p>
        <h1 class="rq-title">${sec.title}</h1>
        <p class="rq-lead">${sec.cover}</p>
        ${s.section === 'white' ? demoTap() : demoDrag()}
      </div>`;
    foot = `<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Let’s go</span></button>`;
  } else if (s.kind === 'sort') {
    const sec = SECTIONS[s.section];
    const g = quiz.rungs.find((x) => x.rung === s.rung);
    const saved = run.answers[s.section][s.rung];
    order = saved?.ranking?.length === g.dishes.length ? [...saved.ranking] : [...g.shown[s.section]];
    body = `
      ${rungHead(g)}
      <h1 class="rq-q">${sec.ask}</h1>
      <p class="rq-hint">${sec.lead}</p>
      <p class="rq-end top">${sec.top}</p>
      <ol class="rq-sort" data-section="${s.section}">${order.map((id, i) => sortRow(id, i)).join('')}</ol>
      <p class="rq-end">${sec.bottom}</p>`;
    // Until a row moves, Next reads "Keep this order": leaving it is then a choice, not a skip.
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>${sortGoLabel(s, g)}</span></button>`;
  } else if (s.kind === 'white') {
    const g = quiz.rungs.find((x) => x.rung === s.rung);
    const saved = run.answers.white[s.rung];
    picks = { picks: [...(saved?.picks ?? [])], criteria: [...(saved?.criteria ?? [])], none: !!saved?.none };
    body = `
      ${rungHead(g)}
      <h1 class="rq-q">${SECTIONS.white.ask}</h1>
      <p class="rq-hint">${SECTIONS.white.lead} Tap again to remove.</p>
      <div class="rq-picks" role="group" aria-label="Dishes">${g.shown.white.map((id) => pickCard(id)).join('')}</div>
      <button class="rq-none" data-act="none" type="button" aria-pressed="false">${HX}<span>None of these</span></button>
      <div class="rq-why" hidden>
        <p class="rq-why-q">What decided it?</p>
        <p class="rq-hint">Tap what mattered, most first.</p>
        <div class="rq-chips">${CRITERIA.map((c) => `<button class="rq-chip" data-act="why" data-id="${c.id}" type="button">${HX}<span class="rq-num" aria-hidden="true"></span><span>${c.label}</span></button>`).join('')}</div>
      </div>`;
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`;
  } else if (s.kind === 'think') {
    ({ body, foot } = thinkScreen());
  } else if (s.kind === 'reveal') {
    ({ body, foot } = revealScreen(back));
  } else if (s.kind === 'cards') {
    ({ body, foot } = cardsScreen(back));
  } else if (s.kind === 'rateask') {
    ({ body, foot } = rateAskScreen(back));
  } else if (s.kind === 'rate') {
    run.answers.difficulty ??= { levels: {}, skipped: false };
    ({ body, foot } = rateScreen(back));
  } else if (s.kind === 'feedback' || s.kind === 'fb') {
    fb = run.answers.feedback;
    fb.seen = true;
    body = s.kind === 'feedback' ? feedbackScreen() : followUp(s.chip);
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`;
  } else {
    ({ body, foot } = endScreen());
  }

  const ghost = ['intro', 'end', 'think', 'reveal'].includes(s.kind);
  root.innerHTML = `
    <header class="rq-top">
      <button class="rq-icon" data-act="close" type="button" aria-label="Close">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      ${ghost ? '<div class="rq-bar"></div>' : bar(list)}
      <button class="rq-fresh" data-act="fresh" type="button">Start fresh</button>
    </header>
    <main class="rq-body${enter ? '' : ' in'}" data-kind="${s.kind}">${body}</main>
    <footer class="rq-foot">${foot}</footer>`;
  root.scrollTop = 0;
  if (picks) syncPicks();
  if (fb) syncFb();
  if (s.kind === 'check') syncHave();
  clearTimeout(thinkTimer);
  if (s.kind === 'think') thinkTimer = setTimeout(() => { if (screens()[run.at]?.kind === 'think' && !root.hidden) { run.at++; save(); render(); } }, THINK_MS);
  if (s.kind === 'reveal') countUp();
  if (s.kind === 'cards') syncCards(false);
}

function syncHave() {
  for (const b of root.querySelectorAll('.rq-have .rq-tag')) {
    const on = haveNow.includes(b.dataset.id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  // Burners: once there's a stove, on the list or tapped here.
  const stove = kit.hasStove || haveNow.some((id) => STOVES.includes(id)) || typedNow.some((t) => STOVES.includes(t.id));
  const bx = root.querySelector('.rq-burners');
  if (stove && bx.hidden) { bx.hidden = false; bx.classList.add('appear'); }
  if (!stove) { bx.hidden = true; burnersNow = null; }
  for (const b of bx.querySelectorAll('.rq-tag')) {
    const on = Number(b.dataset.n) === burnersNow;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  root.querySelector('.rq-typed').innerHTML = typedNow.map((t, i) => `<button class="rq-tag typed on${t.id ? '' : ' new'}" data-act="havedrop" data-i="${i}" type="button" aria-label="Remove ${esc(t.text)}">${HX}<span>${esc(t.id ? t.label : t.text)}${t.how === 'fuzzy' ? ` <small>(${esc(t.text)})</small>` : ''}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>`).join('');
  root.querySelector('.rq-foot [data-act="next"] span').textContent = haveNow.length || typedNow.length || burnersNow ? 'Next' : 'None of these';
}

/** "Anything else?": each typed thing goes to its closest known item; a chip on screen just lights up. */
function haveAdd(form) {
  const input = form.querySelector('input');
  for (const text of splitIdeas(input.value)) {
    const m = matchTyped(text);
    if (!m.text) continue;
    if (m.id && root.querySelector(`.rq-have .rq-tag[data-id="${m.id}"]`)) { if (!haveNow.includes(m.id)) haveNow.push(m.id); continue; }
    if (typedNow.some((t) => (m.id ? t.id === m.id : !t.id && norm(t.text) === norm(m.text)))) continue;
    typedNow.push({ text: m.text, id: m.id, label: m.label, how: m.how });
  }
  input.value = '';
  buzz();
  syncHave();
}

function rungHead(g) {
  return `<p class="rq-rung"><span class="rq-dot"></span>${esc(g.name)}<span class="rq-rung-hint">${esc(rungHint(g))}</span></p>`;
}

function sortGoLabel(s, g) {
  const moved = run.answers[s.section][s.rung]?.moved || (order && order.some((id, i) => id !== g.shown[s.section][i]));
  return moved ? 'Next' : 'Keep this order';
}

/** The last screen: one Send, then "Next person" so the phone can be handed on. */
function endScreen() {
  const waiting = outbox().length;
  const st = sendState || (run.sent ? 'sent' : '');
  const who = run.name ? `, ${esc(run.name)}` : '';
  const own = opts.source === 'link' && !!run.name; // their own phone, from their own link
  const copy = {
    '': ['That’s all. Thank you!', 'One tap sends your answers to Harvey’s.'],
    sending: ['Sending…', 'Putting your answers in Harvey’s.'],
    sent: [`Sent. Thank you${who}!`, own ? 'Your answers are in Harvey’s. That’s a real help: every tap teaches Harvey how people actually cook.' : 'Your answers are in Harvey’s. Hand the phone to the next person.'],
    queued: [`Saved. Thank you${who}!`, `Your answers are safe on this phone${waiting > 1 ? ` with ${waiting - 1} more` : ''} and send themselves as soon as they can. Leave this page open for a minute if you can.`],
    failed: ['Not sent', 'Something went wrong sending this. Tap Save the file and send it to whoever gave you the link.'],
    auth: ['Almost there', 'This phone isn’t set up to send yet. Your answers are saved here and go as soon as it is.'],
    setup: ['Set up sending', 'Paste the GitHub token for Harvey’s once. Every send after is one tap, for everyone using this phone.'],
    bad: ['That token didn’t work', 'It needs write access to the harveys repo (Contents: read and write). Your answers are still saved here.'],
  }[st];
  const done = st === 'sent' || st === 'queued';
  const ask = st === 'auth' || st === 'setup' || st === 'bad';
  const body = `
      <div class="rq-hero end">
        <div class="rq-tick${done || !st ? '' : ' wait'}" aria-hidden="true"><svg viewBox="0 0 52 52"><path d="M14 27l8 8 16-17"/></svg></div>
        <h1 class="rq-title">${copy[0]}</h1>
        <p class="rq-lead">${copy[1]}</p>
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
    done && !own ? '<button class="btn link" data-act="close" type="button">Done for now</button>' : '',
    done && own ? '<button class="btn link" data-act="nextperson" type="button">Someone else wants a go</button>' : '',
    ask ? '<button class="btn link" data-act="github" type="button">Post on GitHub instead</button>' : '',
    '<button class="btn link" data-act="file" type="button">Save the file</button>',
    done ? '' : '<button class="btn link" data-act="restart" type="button">Start over</button>',
  ].join('');
  return { body, foot: `<div class="rq-sendbox">${main}<div class="rq-alt">${alt}</div></div>` };
}

function sortRow(id, i) {
  const d = quiz.dishes[id];
  return `<li data-id="${esc(id)}"><span class="rq-pos">${i + 1}</span><span class="rq-dish"><b>${esc(d.name)}</b><small>${esc(d.how)}</small></span><span class="rq-grip" aria-hidden="true"><i></i><i></i><i></i></span></li>`;
}

function pickCard(id) {
  const d = quiz.dishes[id];
  return `<button class="rq-pick" data-act="pick" data-id="${esc(id)}" type="button" aria-pressed="false">${HX}<span class="rq-num" aria-hidden="true"></span><span class="rq-dish"><b>${esc(d.name)}</b><small>${esc(d.how)}</small></span></button>`;
}

function demoDrag() {
  return '<div class="rq-demo drag" aria-hidden="true"><i></i><i class="mover"></i><i></i></div>';
}
function demoTap() {
  return '<div class="rq-demo tap" aria-hidden="true"><i><b>2</b></i><i></i><i><b>1</b></i></div>';
}

/** White: reflect `picks` on the screen without re-rendering it. */
function syncPicks() {
  for (const b of root.querySelectorAll('.rq-pick')) {
    const n = picks.picks.indexOf(b.dataset.id);
    b.classList.toggle('on', n >= 0);
    b.setAttribute('aria-pressed', String(n >= 0));
    b.querySelector('.rq-num').textContent = n >= 0 ? String(n + 1) : '';
  }
  for (const c of root.querySelectorAll('.rq-chip')) {
    const n = picks.criteria.indexOf(c.dataset.id);
    c.classList.toggle('on', n >= 0);
    c.querySelector('.rq-num').textContent = n >= 0 ? String(n + 1) : '';
  }
  const none = root.querySelector('.rq-none');
  none.classList.toggle('on', picks.none);
  none.setAttribute('aria-pressed', String(picks.none));
  const why = root.querySelector('.rq-why');
  const showWhy = picks.picks.length > 0;
  if (showWhy && why.hidden) { why.hidden = false; why.classList.add('appear'); }
  if (!showWhy) why.hidden = true;
  // Picked but no reason yet: the button says what's missing and takes you to it.
  const go = root.querySelector('.rq-foot [data-act="next"]');
  const needWhy = picks.picks.length > 0 && !picks.criteria.length;
  go.disabled = !(picks.none || picks.picks.length);
  go.classList.toggle('ask', needWhy);
  go.querySelector('span').textContent = needWhy ? 'What decided it?' : 'Next';
}

// ── Feedback (1.34.0) ───────────────────────────────────────────────────────
// One screen of chips, then one short screen per chip, answered with taps on the tester's
// own list and dishes. Typing is only ever an extra. Every screen can be skipped.
const tag = (field, id, label, extra = '') => `<button class="rq-tag" data-act="fbtag" data-field="${field}" data-id="${esc(id)}"${extra} type="button" aria-pressed="false">${HX}<span>${esc(label)}</span></button>`;
const dishesByRung = (dir = 1) => Object.values(quiz.dishes).sort((a, b) => dir * (a.rung - b.rung) || a.name.localeCompare(b.name));
const KIT = new Set(['appliance', 'appliances', 'cookware', 'utensil', 'utensils', 'equipment', 'tool', 'tools']);
const typed = (field) => (field === 'dishIdeas' ? fb.dishIdeas.filter((d) => !d.quick).map((d) => d.name) : fb[field]);
const adder = (field, placeholder, label) => `
      <form class="rq-add" data-field="${field}">
        <input type="text" enterkeyhint="done" autocomplete="off" autocapitalize="sentences" placeholder="${esc(placeholder)}" aria-label="${esc(label)}">
        <button class="rq-add-go" data-act="fbadd" type="button" aria-label="Add">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      </form>
      <div class="rq-tags rq-added" data-field="${field}"></div>`;
const noteBox = (open) => `
      <button class="rq-note-open" data-act="fbnote" type="button"${open ? ' hidden' : ''}>${HX}<span>+ Add a note</span></button>
      <label class="rq-note"${open ? '' : ' hidden'}><span>Anything else? Say it however you like.</span><textarea rows="3" maxlength="2000" placeholder="e.g. I never use the oven, and I always have leftover dal">${esc(fb.note)}</textarea></label>`;

function feedbackScreen() {
  return `
      <p class="rq-eyebrow">Last bit</p>
      <h1 class="rq-q">How did Harvey do?</h1>
      <p class="rq-hint">Tap any that apply. Each one asks one quick thing.</p>
      <div class="rq-fb">${CHIPS.map((c) => `<button class="rq-fbchip${c.id === 'all_good' ? ' good' : ''}" data-act="fbchip" data-id="${c.id}" type="button" aria-pressed="false">${HX}<span class="rq-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>${c.label}</span></button>`).join('')}</div>
      ${noteBox(!!fb.note)}`;
}

function followUp(chip) {
  const head = (q, hint) => `<p class="rq-eyebrow">${esc(CHIPS.find((c) => c.id === chip).label)}</p><h1 class="rq-q">${q}</h1><p class="rq-hint">${hint}</p>`;
  if (chip === 'wrong_items') {
    return `${head('Which of these aren’t in your kitchen?', 'Tap them. Skip if the list was right.')}
      ${[['Food', (i) => !KIT.has(String(i.category).toLowerCase())], ['Kitchen kit', (i) => KIT.has(String(i.category).toLowerCase())]].map(([label, pick]) => {
        const items = (quiz.kitchen.items ?? []).filter(pick);
        return items.length ? `<p class="rq-group">${label}</p><div class="rq-tags">${items.map((i) => tag('wrongItems', i.name, i.name, ' data-strike')).join('')}</div>` : '';
      }).join('')}
      <p class="rq-sub">Anything we missed?</p>
      ${adder('missedItems', 'e.g. rice, pressure cooker', 'Something you have that wasn’t listed')}`;
  }
  if (chip === 'missing_dishes') {
    return `${head('What do you make on a night like this?', 'Tap any, or add your own.')}
      <div class="rq-tags">${quickDishes(quiz).map((q) => tag('quick', q, q)).join('')}</div>
      <p class="rq-sub">Something else?</p>
      ${adder('dishIdeas', 'e.g. aloo paratha, cold coffee', 'A dish you make')}`;
  }
  if (chip === 'too_hard') {
    return `${head('Which ones are too much work?', 'Tap every dish you’d skip on a tired night.')}
      <div class="rq-tags">${dishesByRung(-1).map((d) => tag('tooHard', d.id, d.name)).join('')}</div>`;
  }
  if (chip === 'wouldnt_eat') {
    return `${head('Which wouldn’t you eat?', 'Tap the dishes.')}
      <div class="rq-tags">${dishesByRung().map((d) => tag('wouldntEat', d.id, d.name)).join('')}</div>
      <p class="rq-sub">Mostly because</p>
      <div class="rq-tags">${WOULDNT_WHY.map((x) => tag('wouldntWhy', x.id, x.label)).join('')}</div>`;
  }
  return `${head('What was confusing?', 'Tap any.')}
      <div class="rq-tags">${CONFUSING.map((x) => tag('confusing', x.id, x.label)).join('')}</div>
      ${noteBox(true)}`;
}

const fbHas = (field, id) => (field === 'quick' ? fb.dishIdeas.some((d) => d.quick && d.name === id) : (fb[field] ?? []).includes(id));

/** Reflect `fb` on the screen without re-rendering it (keeps the keyboard and the scroll). */
function syncFb() {
  for (const c of root.querySelectorAll('.rq-fbchip')) {
    const on = fb.chips.includes(c.dataset.id);
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  }
  for (const t of root.querySelectorAll('.rq-tag[data-field]:not(.typed)')) {
    const on = fbHas(t.dataset.field, t.dataset.id);
    t.classList.toggle('on', on);
    t.setAttribute('aria-pressed', String(on));
  }
  for (const box of root.querySelectorAll('.rq-added')) {
    const f = box.dataset.field;
    box.innerHTML = typed(f).map((n) => `<button class="rq-tag typed on" data-act="fbdrop" data-field="${f}" data-id="${esc(n)}" type="button" aria-label="Remove ${esc(n)}">${HX}<span>${esc(n)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>`).join('');
  }
  const s = screens()[run.at];
  const go = root.querySelector('.rq-foot [data-act="next"] span');
  if (!go) return;
  if (s.kind === 'feedback') go.textContent = fb.chips.length || fb.note.trim() ? 'Next' : 'Skip';
  else {
    const field = { wrong_items: ['wrongItems', 'missedItems'], missing_dishes: ['dishIdeas'], too_hard: ['tooHard'], wouldnt_eat: ['wouldntEat', 'wouldntWhy'], confusing: ['confusing'] }[s.chip];
    go.textContent = field.some((f) => fb[f].length) || (s.chip === 'confusing' && fb.note.trim()) ? 'Next' : 'Skip';
  }
}

function fbTap(act, el) {
  const id = el.dataset.id;
  if (act === 'fbchip') {
    if (id === 'all_good') fb.chips = fb.chips.includes(id) ? [] : [id];
    else { fb.chips = fb.chips.filter((c) => c !== 'all_good'); toggleIn(fb.chips, id); }
    // the bar's last segments are the follow-ups: redraw it so it matches
    const top = root.querySelector('.rq-top .rq-bar');
    if (top) top.outerHTML = bar(screens());
  }
  if (act === 'fbtag') {
    const f = el.dataset.field;
    if (f === 'quick') {
      const i = fb.dishIdeas.findIndex((d) => d.quick && d.name === id);
      if (i >= 0) fb.dishIdeas.splice(i, 1); else fb.dishIdeas.push({ name: id, quick: true });
    } else toggleIn(fb[f], id);
  }
  if (act === 'fbdrop') {
    const f = el.dataset.field;
    if (f === 'dishIdeas') fb.dishIdeas = fb.dishIdeas.filter((d) => d.quick || d.name !== id);
    else fb[f] = fb[f].filter((x) => x !== id);
  }
  if (act === 'fbadd') return fbAdd(el.closest('.rq-add'));
  if (act === 'fbnote') {
    el.hidden = true;
    const box = root.querySelector('.rq-note');
    box.hidden = false;
    box.classList.add('appear');
    box.querySelector('textarea').focus();
  }
  save();
  syncFb();
}

/** Typed adds: "maggi, poha" becomes two. Anything already there isn't added twice. */
function fbAdd(form) {
  const input = form.querySelector('input');
  const f = form.dataset.field;
  const names = splitIdeas(input.value);
  if (!names.length) { input.focus(); return; }
  const have = new Set(f === 'dishIdeas' ? fb.dishIdeas.map((d) => norm(d.name)) : fb[f].map(norm));
  for (const n of names) if (!have.has(norm(n))) { if (f === 'dishIdeas') fb.dishIdeas.push({ name: n, quick: false }); else fb[f].push(n); }
  input.value = '';
  buzz(10);
  save();
  syncFb();
}

// ── Taps ────────────────────────────────────────────────────────────────────
const toggleIn = (list, id) => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); };

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  buzz();
  const act = el.dataset.act;
  const list = screens();
  const s = list[run.at];
  if (act === 'close') return close();
  // 1.40.0: one tap on the first screen; mid-test a second tap, so a stray thumb loses nothing.
  if (act === 'fresh') {
    if (run.at > 0 && !el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start fresh'; }, 4000); return; }
    el.textContent = 'Starting…';
    return startFresh();
  }
  if (act === 'back' && s.kind === 'cards' && cardsDone()) return undoCard();
  if (act === 'back' && s.kind === 'rate' && ratedCount()) return undoRate();
  if (act === 'back') { commit(s); run.at = Math.max(0, run.at - 1); while (run.at > 0 && passOver(list[run.at])) run.at--; save(); return render(); }
  if (act === 'yes' || act === 'no') return decide(act === 'yes');
  if (act === 'whynot') return whyNot(el.dataset.id);
  if (act === 'rate') return rate(Number(el.dataset.level), el);
  if (act === 'rateskip') { run.answers.difficulty = { levels: {}, skipped: true }; run.at += 2; save(); return render(); }
  if (act === 'ratego') { run.answers.difficulty = { levels: { ...(run.answers.difficulty?.levels ?? {}) }, skipped: false }; run.at++; save(); return render(); }
  if (act === 'ratestop') { run.at++; save(); return render(); }
  if (act === 'next' && el.classList.contains('ask')) { root.querySelector('.rq-why').scrollIntoView({ behavior: 'smooth', block: 'center' }); root.querySelector('.rq-why').classList.add('nudge'); setTimeout(() => root.querySelector('.rq-why')?.classList.remove('nudge'), 700); return; }
  if (act === 'next') { commit(s); run.at = Math.min(list.length - 1, run.at + 1); save(); return render(); }
  if (act === 'have') { toggleIn(haveNow, el.dataset.id); return syncHave(); }
  if (act === 'burners') { const n = Number(el.dataset.n); burnersNow = burnersNow === n ? null : n; return syncHave(); }
  if (act === 'haveadd') return haveAdd(el.closest('.rq-add'));
  if (act === 'havedrop') { typedNow.splice(Number(el.dataset.i), 1); return syncHave(); }
  if (act === 'pick') { toggleIn(picks.picks, el.dataset.id); picks.none = false; if (!picks.picks.length) picks.criteria = []; return syncPicks(); }
  if (act === 'why') { toggleIn(picks.criteria, el.dataset.id); return syncPicks(); }
  if (act === 'none') { picks.none = !picks.none; if (picks.none) { picks.picks = []; picks.criteria = []; } return syncPicks(); }
  if (act.startsWith('fb')) return fbTap(act, el);
  if (act === 'send') return send();
  if (act === 'github') { const res = resultOf(); window.open(issueHref(res), '_blank', 'noopener'); sendState = 'sent'; markSent(); return; }
  if (act === 'token') return saveToken();
  if (act === 'nextperson') { store.runs[quiz.id] = run = freshRun(); rebuild(null); sendState = ''; save(); return render(); }
  if (act === 'file') { download(resultOf()); return; }
  if (act === 'restart') {
    if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again to start over'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start over'; }, 4000); return; }
    store.runs[quiz.id] = run = freshRun(run.name); // same person, same name
    rebuild(null);
    sendState = '';
    save();
    return render();
  }
}

/** Keeps what's on screen. Time adds up if a tester comes back to a question. */
function commit(s) {
  const ms = Math.round(performance.now() - shownAt);
  if (s.kind === 'check' && haveNow) {
    const form = root.querySelector('.rq-have-add');
    if (form?.querySelector('input').value.trim()) haveAdd(form); // typed but never tapped Add
    const prev = run.answers.confirm;
    const next = { asked: [...ask, ...kit.kit].map((a) => a.id), have: [...haveNow], typed: typedNow.map((t) => ({ ...t })), burners: burnersNow, noStove: kit.noStove, ms: (prev?.ms ?? 0) + ms };
    const changed = confKey(next) !== confKey(prev);
    run.answers.confirm = next;
    if (changed) {
      rebuild(next);
      // New dishes, so sorts and picks made on the old ones start again.
      run.answers.marco = {}; run.answers.pierre = {}; run.answers.white = {};
      run.answers.cards = {}; run.answers.difficulty = null;
    }
  }
  if (s.kind === 'sort' && order) {
    const g = quiz.rungs.find((x) => x.rung === s.rung);
    const prev = run.answers[s.section][s.rung];
    const shown = g.shown[s.section];
    run.answers[s.section][s.rung] = { ranking: [...order], moved: (prev?.moved ?? false) || order.some((id, i) => id !== shown[i]), ms: (prev?.ms ?? 0) + ms };
  }
  if ((s.kind === 'feedback' || s.kind === 'fb') && fb) {
    // an "Add" typed but never tapped still counts
    for (const form of root.querySelectorAll('.rq-add')) if (form.querySelector('input').value.trim()) fbAdd(form);
    fb.ms = (fb.ms ?? 0) + ms;
  }
  if (s.kind === 'white' && picks) {
    const prev = run.answers.white[s.rung];
    if (picks.none || picks.picks.length) run.answers.white[s.rung] = { picks: [...picks.picks], criteria: [...picks.criteria], none: picks.none, ms: (prev?.ms ?? 0) + ms };
  }
}

// ── Drag to sort (the way iPhone lists reorder) ─────────────────────────────
// A finger on a row lifts it at once. The row follows the finger; the others slide out of
// its way; letting go drops it in the gap. Transform only, so it stays smooth on a phone.
function onPointerDown(e) {
  if (e.target.closest('.rq-card.top')) return cardDrag(e);
  const li = e.target.closest('.rq-sort li');
  if (!li || e.button > 0 || !order) return;
  e.preventDefault();
  const ol = li.parentElement;
  const rows = [...ol.children];
  const from = rows.indexOf(li);
  const boxes = rows.map((r) => r.getBoundingClientRect());
  const step = rows.length > 1 ? boxes[1].top - boxes[0].top : boxes[0].height;
  const y0 = e.clientY;
  const scroll0 = root.scrollTop;
  const pid = e.pointerId;
  let y = y0;
  let to = from;
  let raf = 0;
  try { li.setPointerCapture(pid); } catch { /* old browsers */ }
  li.classList.add('lift');
  ol.classList.add('sorting');
  buzz(10);

  const place = () => {
    const minDy = boxes[0].top - boxes[from].top;
    const maxDy = boxes[rows.length - 1].top - boxes[from].top;
    const dy = Math.max(minDy - step * 0.35, Math.min(maxDy + step * 0.35, y - y0 + root.scrollTop - scroll0));
    li.style.transform = `translate3d(0, ${dy}px, 0) scale(1.03)`;
    const next = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)));
    if (next === to) return;
    to = next;
    buzz(5);
    rows.forEach((r, i) => {
      if (r === li) return;
      let shift = 0;
      if (from < to && i > from && i <= to) shift = -step;
      if (from > to && i < from && i >= to) shift = step;
      r.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
    });
    renumber(rows, from, to);
  };
  // Near the top or bottom edge the screen scrolls by itself, so a long list still sorts.
  const edge = () => {
    raf = 0;
    const h = root.clientHeight;
    const v = y < 120 ? -Math.min(14, (120 - y) / 6) : y > h - 150 ? Math.min(14, (y - (h - 150)) / 6) : 0;
    if (!v) return;
    const before = root.scrollTop;
    root.scrollTop += v;
    if (root.scrollTop !== before) place();
    raf = requestAnimationFrame(edge);
  };
  const move = (ev) => {
    if (ev.pointerId !== pid) return;
    y = ev.clientY;
    place();
    if (!raf) raf = requestAnimationFrame(edge);
  };
  const up = (ev) => {
    if (ev.pointerId !== pid) return;
    cancelAnimationFrame(raf);
    li.removeEventListener('pointermove', move);
    li.removeEventListener('pointerup', up);
    li.removeEventListener('pointercancel', up);
    li.classList.remove('lift');
    if (to === from) { li.style.transform = ''; ol.classList.remove('sorting'); renumber(rows, from, from); return; }
    li.classList.add('drop');
    li.style.transform = `translate3d(0, ${(to - from) * step}px, 0)`;
    setTimeout(() => {
      const [id] = order.splice(from, 1);
      order.splice(to, 0, id);
      ol.classList.remove('sorting');
      ol.innerHTML = order.map((x, i) => sortRow(x, i)).join('');
      ol.children[to].classList.add('settled');
      const s = screens()[run.at];
      const go = root.querySelector('.rq-foot [data-act="next"] span');
      if (go) go.textContent = sortGoLabel(s, quiz.rungs.find((x) => x.rung === s.rung));
    }, 160);
  };
  li.addEventListener('pointermove', move);
  li.addEventListener('pointerup', up);
  li.addEventListener('pointercancel', up);
}

function renumber(rows, from, to) {
  const ids = rows.map((r) => r);
  const [x] = ids.splice(from, 1);
  ids.splice(to, 0, x);
  ids.forEach((r, i) => { r.querySelector('.rq-pos').textContent = String(i + 1); });
}

// ── Meal cards (1.42.0) ─────────────────────────────────────────────────────
// After the quick check: a short "thinking" pause, the count, then one dish per card, yes or
// no (tap or swipe), then an offer to rate how hard each one is. Kiron's rules still hold: one
// question at a time, the action at the thumb, haptics on every tap, no numbers in the bar.
const THINK_MS = 3200;
let thinkTimer = 0;
let flying = false;
let lastNo = null; // the card just turned down: "Why not?" stays open under the next one

const ingredientsOf = (d) => (d.away ? d.how.split(' · ').slice(1).join(' · ') : d.how);
const METHOD = { 1: 'No cooking', 2: 'One appliance', 3: 'On the stove', 4: 'Two things at once' };
const ICON = {
  1: '<path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M9 8c0-1.5 1-2 1-3.5M14 8c0-1.5 1-2 1-3.5"/>',
  2: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><rect x="6" y="9" width="9" height="7" rx="1"/><path d="M18 10v.01M18 13v.01"/>',
  3: '<path d="M5 11h14v3a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6z"/><path d="M19 12h2M12 4c1.5 1.5 1.5 3 0 4.5"/>',
  4: '<path d="M2 12h9v2.5a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4zM13 12h9v2.5a4 4 0 0 1-4 4h-1a4 4 0 0 1-4-4z"/><path d="M6.5 5c1 1 1 2 0 3M17.5 5c1 1 1 2 0 3"/>',
};
const icon = (rung) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[rung] ?? ICON[3]}</svg>`;
const cardsDone = () => quiz.deck.filter((id) => run.answers.cards?.[id]).length;
const ratedCount = () => quiz.rateOrder.filter((id) => run.answers.difficulty?.levels?.[id]).length;
const yesCount = () => quiz.deck.filter((id) => run.answers.cards?.[id]?.yes).length;

function thinkScreen() {
  const items = (quiz.kitchen.items ?? []).length + (run.answers.confirm?.have?.length ?? 0) + (run.answers.confirm?.typed?.length ?? 0);
  const lines = [
    items ? `Reading the ${items} things in your kitchen` : 'Reading your kitchen',
    `Checking ${CATALOGUE.length} recipes against your pots and pans`,
    'Balancing protein and calories',
    'Putting the easiest first',
  ];
  return {
    body: `
      <div class="rq-hero think" role="status" aria-live="polite">
        <div class="rq-orb" aria-hidden="true"><i></i><i></i><i></i><span>H</span></div>
        <h1 class="rq-q center">Harvey’s is thinking…</h1>
        <ul class="rq-steps">${lines.map((l, i) => `<li style="--d:${(i * (THINK_MS - 600)) / lines.length}ms"><span class="rq-tickmini" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>${esc(l)}</li>`).join('')}</ul>
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
        <p class="rq-lead">Harvey couldn’t find a dish for this kitchen. Tell it what you do cook, and it’ll learn.</p>
      </div>`,
      foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Tell Harvey</span></button>`,
    };
  }
  const fan = quiz.deck.slice(0, 3).map((id, i) => `<div class="rq-mini r${quiz.dishes[id].rung}" style="--i:${i}">${icon(quiz.dishes[id].rung)}<b>${esc(quiz.dishes[id].name)}</b></div>`).join('');
  return {
    body: `
      <div class="rq-hero reveal">
        <p class="rq-eyebrow">Harvey’s came up with</p>
        <h1 class="rq-count"><span class="rq-num-big" data-to="${n}">${n}</span><span>${n === 1 ? 'thing you can cook' : 'things you can cook'}</span></h1>
        ${more ? `<p class="rq-lead">plus ${more} that need${more === 1 ? 's' : ''} just one more thing.</p>` : ''}
        <div class="rq-fan" aria-hidden="true">${fan}</div>
        <p class="rq-lead">Easiest first. For each one: would you make it tonight? Tap yes or no, or swipe.</p>
      </div>`,
    foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Show me</span></button>`,
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

function cardHtml(id, depth) {
  const d = quiz.dishes[id];
  const meta = [d.protein != null ? `${Math.round(d.protein)} g protein` : '', d.kcal != null ? `${Math.round(d.kcal)} kcal` : ''].filter(Boolean);
  return `<article class="rq-card r${d.rung}${depth ? '' : ' top'}" data-id="${esc(id)}" style="--k:${depth}"${depth ? ' aria-hidden="true"' : ''}>
      <div class="rq-card-art">${icon(d.rung)}<span>${METHOD[d.rung] ?? ''}</span></div>
      <h2 class="rq-card-name">${esc(d.name)}</h2>
      <p class="rq-card-ing">${esc(ingredientsOf(d))}</p>
      <div class="rq-card-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}${d.away ? `<span class="away">Needs ${esc(d.away)}</span>` : ''}</div>
      <span class="rq-stamp yes" aria-hidden="true">Yes</span><span class="rq-stamp no" aria-hidden="true">No</span>
    </article>`;
}

function cardsScreen(back) {
  lastNo = null;
  return {
    body: `
      <p class="rq-eyebrow center">Would you make this tonight?</p>
      <div class="rq-stack" aria-live="polite"></div>
      <div class="rq-whynot" hidden></div>`,
    foot: `${back}<div class="rq-yn">
        <button class="rq-vote no" data-act="no" type="button" aria-label="No">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg><span>No</span></button>
        <button class="rq-vote yes" data-act="yes" type="button" aria-label="Yes">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>Yes</span></button>
      </div>`,
  };
}

/** The stack, the "Why not?" tray and the bar, without re-rendering the screen. */
function syncCards(enter = true) {
  const left = quiz.deck.filter((id) => !run.answers.cards[id]);
  const stack = root.querySelector('.rq-stack');
  if (!stack) return;
  if (left.length) {
    stack.innerHTML = left.slice(0, 3).map((id, i) => cardHtml(id, i)).reverse().join('');
    if (enter) stack.querySelector('.rq-card.top')?.classList.add('in');
  } else {
    const y = yesCount();
    stack.innerHTML = `<div class="rq-card done"><div class="rq-tick" aria-hidden="true"><svg viewBox="0 0 52 52"><path d="M14 27l8 8 16-17"/></svg></div><h2 class="rq-card-name">${y ? `You’d make ${y} of ${quiz.deck.length}` : 'None of these, got it'}</h2><p class="rq-card-ing">${y ? 'Harvey will remember.' : 'That helps Harvey too.'}</p></div>`;
  }
  const tray = root.querySelector('.rq-whynot');
  if (lastNo && run.answers.cards[lastNo] && !run.answers.cards[lastNo].yes) {
    const a = run.answers.cards[lastNo];
    tray.innerHTML = `<p>Why not <b>${esc(quiz.dishes[lastNo].name)}</b>? <small>Optional</small></p><div class="rq-tags">${WHY_NOT.map((w) => `<button class="rq-tag${a.why === w.id ? ' on' : ''}" data-act="whynot" data-id="${w.id}" type="button" aria-pressed="${a.why === w.id}">${HX}<span>${esc(w.label)}</span></button>`).join('')}</div>`;
    if (tray.hidden) { tray.hidden = false; tray.classList.add('appear'); }
  } else tray.hidden = true;
  const yn = root.querySelector('.rq-yn');
  if (!left.length && yn) yn.outerHTML = `<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`;
  const top = root.querySelector('.rq-top .rq-bar');
  if (top) top.outerHTML = bar(screens());
}

function decide(yes, fromDrag = false) {
  if (flying) return;
  const card = root.querySelector('.rq-card.top');
  if (!card) return;
  const id = card.dataset.id;
  const ms = Math.round(performance.now() - shownAt);
  shownAt = performance.now();
  run.answers.cards[id] = { yes, why: null, ms };
  save();
  buzz(yes ? 12 : 8);
  lastNo = yes ? null : id;
  flying = true;
  card.classList.add('gone', yes ? 'right' : 'left');
  if (!fromDrag) card.style.transform = '';
  setTimeout(() => { flying = false; syncCards(); }, 240);
}

function whyNot(why) {
  const a = run.answers.cards[lastNo];
  if (!a) return;
  a.why = a.why === why ? null : why;
  save();
  syncCards(false);
}

function undoCard() {
  const done = quiz.deck.filter((id) => run.answers.cards[id]);
  const id = done[done.length - 1];
  delete run.answers.cards[id];
  lastNo = null;
  save();
  if (!root.querySelector('.rq-yn')) return render();
  syncCards();
}

/** Swipe the top card: it follows the finger and tilts; past a third of the way it goes. */
function cardDrag(e) {
  if (flying || e.button > 0) return;
  const card = e.target.closest('.rq-card.top');
  const x0 = e.clientX;
  const y0 = e.clientY;
  const t0 = performance.now();
  const pid = e.pointerId;
  const w = card.getBoundingClientRect().width;
  let dx = 0;
  try { card.setPointerCapture(pid); } catch { /* old browsers */ }
  card.classList.add('drag');
  const move = (ev) => {
    if (ev.pointerId !== pid) return;
    dx = ev.clientX - x0;
    const dy = (ev.clientY - y0) * 0.25;
    card.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 18}deg)`;
    card.style.setProperty('--sy', String(Math.max(0, Math.min(1, dx / (w * 0.3)))));
    card.style.setProperty('--sn', String(Math.max(0, Math.min(1, -dx / (w * 0.3)))));
  };
  const up = (ev) => {
    if (ev.pointerId !== pid) return;
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', up);
    card.removeEventListener('pointercancel', up);
    card.classList.remove('drag');
    const fast = Math.abs(dx) / Math.max(1, performance.now() - t0) > 0.6 && Math.abs(dx) > 40;
    if (Math.abs(dx) > w * 0.3 || fast) return decide(dx > 0, true);
    card.style.transform = '';
    card.style.removeProperty('--sy');
    card.style.removeProperty('--sn');
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
}

function rateAskScreen(back) {
  const y = yesCount();
  return {
    body: `
      <div class="rq-hero">
        <p class="rq-eyebrow">${y ? `You’d make ${y} of ${quiz.deck.length}` : 'Thanks, noted'}</p>
        <h1 class="rq-title">How hard is each one?</h1>
        <p class="rq-lead">Rate them for a tired night, even the ones you said no to. It teaches Harvey what “easy” means to you.</p>
        <div class="rq-scale-demo" aria-hidden="true">${DIFFICULTY.map((d) => `<i class="l${d.level}"></i>`).join('')}</div>
        <p class="rq-small">One tap each, about ${Math.max(1, Math.round(quiz.deck.length * 3 / 60))} minute${quiz.deck.length * 3 >= 90 ? 's' : ''}.</p>
      </div>`,
    foot: `${back}<div class="rq-sendbox"><button class="btn primary xl rq-go" data-act="ratego" type="button">${HX}<span>Rate them</span></button><div class="rq-alt"><button class="btn link" data-act="rateskip" type="button">Skip</button></div></div>`,
  };
}

function rateScreen(back) {
  const levels = run.answers.difficulty?.levels ?? {};
  const id = quiz.rateOrder.find((x) => !levels[x]);
  if (!id) {
    return {
      body: '<div class="rq-hero"><h1 class="rq-title">All rated</h1><p class="rq-lead">Thank you. One last screen.</p></div>',
      foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`,
    };
  }
  const d = quiz.dishes[id];
  const said = run.answers.cards?.[id];
  const left = quiz.rateOrder.length - ratedCount();
  return {
    body: `
      <p class="rq-eyebrow center">How hard, on a tired night?</p>
      <div class="rq-card solo r${d.rung}">
        <div class="rq-card-art">${icon(d.rung)}<span>${METHOD[d.rung] ?? ''}</span>${said ? `<em class="${said.yes ? 'y' : 'n'}">${said.yes ? 'You’d make it' : 'You said no'}</em>` : ''}</div>
        <h2 class="rq-card-name">${esc(d.name)}</h2>
        <p class="rq-card-ing">${esc(ingredientsOf(d))}</p>
      </div>
      <div class="rq-levels" role="group" aria-label="How hard">${DIFFICULTY.map((x) => `<button class="rq-level l${x.level}" data-act="rate" data-level="${x.level}" type="button">${HX}<i aria-hidden="true"></i><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></button>`).join('')}</div>
      ${ratedCount() >= 2 && left > 1 ? '<button class="rq-none" data-act="ratestop" type="button">That’s enough for now</button>' : ''}`,
    foot: back ? `${back}<span class="rq-left">${left === 1 ? 'Last one' : `${left} to go`}</span>` : '',
  };
}

function rate(level, el) {
  if (flying) return;
  const id = quiz.rateOrder.find((x) => !run.answers.difficulty.levels[x]);
  if (!id) return;
  run.answers.difficulty.levels[id] = { level, ms: Math.round(performance.now() - shownAt) };
  save();
  el.classList.add('on');
  buzz(10);
  flying = true;
  setTimeout(() => {
    flying = false;
    if (!quiz.rateOrder.some((x) => !run.answers.difficulty.levels[x])) run.at++;
    save();
    render();
  }, 260);
}

function undoRate() {
  const done = quiz.rateOrder.filter((x) => run.answers.difficulty.levels[x]);
  delete run.answers.difficulty.levels[done[done.length - 1]];
  save();
  render();
}

function onKey(e) {
  if (!root || root.hidden || e.target.matches('input, textarea')) return;
  const s = screens()[run.at];
  if (s?.kind === 'cards' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); decide(e.key === 'ArrowRight'); }
  if (s?.kind === 'rate' && /^[1-5]$/.test(e.key)) { const b = root.querySelector(`.rq-level[data-level="${e.key}"]`); if (b) rate(Number(e.key), b); }
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
