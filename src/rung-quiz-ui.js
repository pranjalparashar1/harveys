// Rung quiz screens (1.31.0; one-tap send, a fresh tester per run 1.32.0; relay send 1.33.0): what a tester sees
// after Proceed. Kiron's rules: one question
// per screen, a story bar with no numbers, drag to sort, tap to pick, haptics on every tap.
// The brain work is src/brain/rung-quiz.js; this file is screens, drag, storage and sending.
import { buildRungQuiz, encodeRungResult, CRITERIA, CANT, EFFORT_STARS, TASTE_STARS } from './brain/rung-quiz.js';
import { labelFor } from './brain/vocabulary.js';
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
const freshRun = (name = '') => ({ testerId: newTesterId(), runNo: ++store.seq, name, v: opts.version, answers: { marco: {}, pierre: {}, white: {}, stars: {}, feedback: blankFeedback() }, at: 0, sent: false });
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
 * screens (1.43.0): intro, the quick check, Harvey thinking, the count, the recipe list (effort
 * and taste stars per dish), feedback, end. The 1.42.0 cards and swipes are gone.
 */
function screens() {
  const out = [{ kind: 'intro' }];
  if (ask.length || kit.kit.length || opts.items) out.push({ kind: 'check' });
  out.push({ kind: 'think' }, { kind: 'reveal' });
  if (quiz.deck.length) out.push({ kind: 'stars' });
  // 1.34.0: what went wrong, then one short screen for each chip tapped.
  out.push({ kind: 'feedback' });
  const chips = run.answers.feedback?.chips ?? [];
  for (const chip of FOLLOW_UPS) if (chips.includes(chip)) out.push({ kind: 'fb', chip });
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
  run.answers.stars ??= {};
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
  const qs = list.map((s, i) => [s, i]).filter(([s]) => ['check', 'stars', 'feedback'].includes(s.kind));
  const part = (s) => (s.kind === 'stars' ? doneCount() / quiz.deck.length : 0.45);
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
    const can = Object.keys(quiz.dishes).length || ask.length || kit.kit.length;
    const mini = (n) => `<span class="rq-sw demo">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;
    body = `
      <div class="rq-hero">
        <p class="rq-eyebrow">${run.name ? `Hi, ${esc(run.name)}` : 'Taste test'}</p>
        <h1 class="rq-title">${can ? 'Test Harvey’s recipes' : 'No recipes yet'}</h1>
        ${can ? '<p class="rq-lead">For effort and taste.</p>' : ''}
        ${can ? `<ol class="rq-rounds">
          <li><b>Quick check</b><span>Tap what Harvey missed</span></li>
          <li><b>Rate each recipe</b><span class="rq-mini-rate"><span>Effort ${mini(4)}</span><span>Taste ${mini(3)}</span></span></li>
          <li><b>Send</b><span>One tap</span></li>
        </ol>` : ''}
      </div>`;
    foot = can
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
        ${kit.noStove ? '<p class="rq-hint tight">Tap your stove, and any pots or appliances.</p>' : ''}
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
        <p class="rq-hint">Tap what’s in your kitchen.</p>
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
  } else if (s.kind === 'stars') {
    ({ body, foot } = starsScreen(back));
  } else if (s.kind === 'feedback' || s.kind === 'fb') {
    fb = run.answers.feedback;
    fb.seen = true;
    body = s.kind === 'feedback' ? feedbackScreen() : followUp(s.chip);
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`;
  } else {
    ({ body, foot } = endScreen());
  }

  const ghost = ['intro', 'end', 'think', 'reveal'].includes(s.kind);
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
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
  if (s.kind === 'stars') syncStars();
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
    '': ['That’s all. Thank you!', 'Tap Send.'],
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
// The stars already say "too much effort" and "wouldn't eat", so those chips aren't asked again.
const STARRED = ['too_hard', 'wouldnt_eat'];
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
      <p class="rq-hint">Tap any that apply.</p>
      <div class="rq-fb">${CHIPS.filter((c) => !STARRED.includes(c.id)).map((c) => `<button class="rq-fbchip${c.id === 'all_good' ? ' good' : ''}" data-act="fbchip" data-id="${c.id}" type="button" aria-pressed="false">${HX}<span class="rq-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>${c.label}</span></button>`).join('')}</div>
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
  if (act === 'back' && sheetId) return closeRecipe();
  // 1.40.0: one tap on the first screen; mid-test a second tap, so a stray thumb loses nothing.
  if (act === 'fresh') {
    if (run.at > 0 && !el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start fresh'; }, 4000); return; }
    el.textContent = 'Starting…';
    return startFresh();
  }
  if (act === 'back') { commit(s); run.at = Math.max(0, run.at - 1); while (run.at > 0 && passOver(list[run.at])) run.at--; save(); return render(); }
  if (act === 'recipe') return openRecipe(el.dataset.id);
  if (act === 'recipeclose') return closeRecipe();
  if (act === 'star') return setStar(el.dataset.id, el.dataset.kind, Number(el.dataset.n));
  if (act === 'cant') return cantTap(el.dataset.id);
  if (act === 'cantwhy') return cantTap(el.dataset.id, el.dataset.why);
  if (act === 'finish') { commit(s); run.at++; save(); return render(); }
  if (act === 'next' && s.kind === 'stars' && el.classList.contains('ask')) return nudgeNext();
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
      run.answers.stars = {};
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

// ── Recipe test (1.43.0) ────────────────────────────────────────────────────
// After the quick check: a short "thinking" pause, the count, then every dish in one list, the
// way a Kiron question lists its options. Each dish has two rows of stars, effort and taste
// (5 = effortless, delicious), and "Can't make it" with a reason. Tapping a dish opens its recipe.
const THINK_MS = 3200;
let thinkTimer = 0;
let sheetId = null; // the recipe open on top of the list

const ingredientsOf = (d) => (d.away ? d.how.split(' · ').slice(1).join(' · ') : d.how);
const METHOD = { 1: 'No cooking', 2: 'One appliance', 3: 'On the stove', 4: 'Two things at once' };
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.87l-5.5 2.88 1.05-6.12L3.1 9.3l6.15-.9z"/></svg>';
const KINDS = { effort: { label: 'Effort', words: EFFORT_STARS, empty: '5 = easiest' }, taste: { label: 'Taste', words: TASTE_STARS, empty: '5 = tastiest' } };
const starOf = (id) => run.answers.stars?.[id] ?? {};
const isDone = (id) => { const a = starOf(id); return !!((a.effort && a.taste) || a.cant); };
const doneCount = () => quiz.deck.filter(isDone).length;

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
        <p class="rq-lead strong">Rate each one for effort and taste.</p>
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

/** One row of five stars. The words beside it say what the tap meant. */
function starRow(id, kind) {
  const k = KINDS[kind];
  return `<div class="rq-starrow" data-id="${esc(id)}" data-kind="${kind}">
      <span class="rq-sl"><b>${k.label}</b><small class="rq-sv"></small></span>
      <span class="rq-sw" role="radiogroup" aria-label="${k.label}">${[1, 2, 3, 4, 5].map((n) => `<button class="rq-star" data-act="star" data-id="${esc(id)}" data-kind="${kind}" data-n="${n}" type="button" role="radio" aria-checked="false" aria-label="${k.label} ${n} of 5: ${esc(k.words[n - 1])}">${HX}${STAR}</button>`).join('')}</span>
    </div>`;
}

function cantBlock(id) {
  return `<div class="rq-cantbox" data-id="${esc(id)}">
      <button class="rq-cant" data-act="cant" data-id="${esc(id)}" type="button" aria-expanded="false">${HX}<span>Can’t make it</span></button>
      <div class="rq-cantwhy" hidden role="group" aria-label="Why not">${CANT.map((c) => `<button class="rq-tag" data-act="cantwhy" data-id="${esc(id)}" data-why="${c.id}" type="button" aria-pressed="false">${HX}<span>${esc(c.label)}</span></button>`).join('')}</div>
    </div>`;
}

function rowHtml(id, i) {
  const d = quiz.dishes[id];
  return `<li class="rq-r" data-id="${esc(id)}">
      <button class="rq-r-head" data-act="recipe" data-id="${esc(id)}" type="button" aria-label="${esc(d.name)}: see the recipe">${HX}
        <span class="rq-r-n" aria-hidden="true"><span>${i + 1}</span><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <span class="rq-dish"><b>${esc(d.name)}</b><small>${esc(ingredientsOf(d))}</small>${d.away ? `<em>Needs ${esc(d.away)}</em>` : ''}</span>
        <span class="rq-r-how">Recipe<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></span>
      </button>
      ${starRow(id, 'effort')}
      ${starRow(id, 'taste')}
      ${cantBlock(id)}
    </li>`;
}

function starsScreen(back) {
  return {
    body: `
      <p class="rq-eyebrow">Recipe test</p>
      <h1 class="rq-q">How easy? How tasty?</h1>
      <p class="rq-hint">Rate every recipe. Tap a name to see how it’s made.</p>
      <ol class="rq-rlist">${quiz.deck.map(rowHtml).join('')}</ol>
      <button class="rq-none rq-finish" data-act="finish" type="button" hidden>Finish without the rest</button>`,
    foot: `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`,
  };
}

/** Stars, reasons, ticks, the button and the bar, everywhere a dish shows (list and recipe). */
function syncStars() {
  for (const box of root.querySelectorAll('.rq-starrow[data-id]')) {
    const a = starOf(box.dataset.id);
    const v = a[box.dataset.kind] ?? 0;
    const k = KINDS[box.dataset.kind];
    box.classList.toggle('set', !!v);
    for (const b of box.querySelectorAll('.rq-star')) {
      const n = Number(b.dataset.n);
      b.classList.toggle('on', n <= v);
      b.setAttribute('aria-checked', String(n === v));
    }
    box.querySelector('.rq-sv').textContent = v ? k.words[v - 1] : k.empty;
  }
  for (const box of root.querySelectorAll('.rq-cantbox')) {
    const a = starOf(box.dataset.id);
    const open = !!(a.cantOpen || a.cant);
    const why = box.querySelector('.rq-cantwhy');
    if (open && why.hidden) { why.hidden = false; why.classList.add('appear'); }
    if (!open) why.hidden = true;
    const btn = box.querySelector('.rq-cant');
    btn.classList.toggle('on', open);
    btn.setAttribute('aria-expanded', String(open));
    for (const t of why.querySelectorAll('.rq-tag')) {
      const on = a.cant === t.dataset.why;
      t.classList.toggle('on', on);
      t.setAttribute('aria-pressed', String(on));
    }
  }
  const next = quiz.deck.find((id) => !isDone(id));
  for (const li of root.querySelectorAll('.rq-r')) {
    li.classList.toggle('done', isDone(li.dataset.id));
    li.classList.toggle('now', li.dataset.id === next);
    li.classList.toggle('cant', !!starOf(li.dataset.id).cant);
  }
  const left = quiz.deck.length - doneCount();
  const go = root.querySelector('.rq-foot [data-act="next"]');
  if (go) {
    go.classList.toggle('ask', left > 0);
    go.querySelector('span').textContent = left ? `${left} left to rate` : 'Next';
  }
  const fin = root.querySelector('.rq-finish');
  if (fin) fin.hidden = !(left > 0 && doneCount() >= 3);
  const top = root.querySelector('.rq-top .rq-bar');
  if (top) top.outerHTML = bar(screens());
}

function setStar(id, kind, n) {
  run.answers.stars ??= {};
  const a = (run.answers.stars[id] ??= {});
  const was = isDone(id);
  a[kind] = a[kind] === n ? 0 : n; // tap the same star again to clear it
  a.ms = Math.round(performance.now() - shownAt);
  save();
  buzz(n >= 4 ? 12 : 8);
  syncStars();
  const b = root.querySelector(`.rq-starrow[data-id="${CSS.escape(id)}"][data-kind="${kind}"] .rq-star[data-n="${n}"]`);
  b?.classList.add('pop');
  if (!was && isDone(id) && !sheetId) towardNext(id);
}

/** Just finished a dish: bring the next unrated one into view if it isn't. */
function towardNext(id) {
  const next = quiz.deck.find((x) => !isDone(x));
  if (!next) return;
  const li = root.querySelector(`.rq-r[data-id="${CSS.escape(next)}"]`);
  if (!li) return;
  const r = li.getBoundingClientRect();
  const foot = root.querySelector('.rq-foot')?.getBoundingClientRect().top ?? innerHeight;
  if (r.top > 70 && r.bottom < foot - 8) return;
  setTimeout(() => li.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 280);
}

function cantTap(id, why = null) {
  run.answers.stars ??= {};
  const a = (run.answers.stars[id] ??= {});
  const was = isDone(id);
  if (why) a.cant = a.cant === why ? null : why;
  else if (a.cant || a.cantOpen) { a.cant = null; a.cantOpen = false; } else a.cantOpen = true;
  a.ms = Math.round(performance.now() - shownAt);
  save();
  syncStars();
  if (!was && isDone(id) && !sheetId) towardNext(id);
}

/** "3 left": take them to the first dish still to rate. */
function nudgeNext() {
  const next = quiz.deck.find((x) => !isDone(x));
  const li = next && root.querySelector(`.rq-r[data-id="${CSS.escape(next)}"]`);
  if (!li) return;
  li.scrollIntoView({ behavior: 'smooth', block: 'center' });
  li.classList.remove('nudge');
  void li.offsetWidth;
  li.classList.add('nudge');
}

// ── The recipe, over the list ───────────────────────────────────────────────
const ingName = (i) => {
  const ids = (i.anyOf ?? [i.id]).filter((x) => x && !String(x).startsWith('role:'));
  return ids.map((x, n) => (n ? labelFor(x).toLowerCase() : labelFor(x))).join(' or ');
};

function openRecipe(id) {
  const d = quiz.dishes[id];
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
        <div class="rq-sheet-rate">
          ${starRow(id, 'effort')}
          ${starRow(id, 'taste')}
        </div>
      </div>
      <footer class="rq-sheet-foot"><button class="btn primary xl rq-go" data-act="recipeclose" type="button">${HX}<span>Close recipe</span></button></footer>
    </section>`;
  root.append(sheet);
  document.documentElement.classList.add('rq-sheet-open');
  syncStars();
  sheet.querySelector('.rq-sheet-foot .rq-go').focus({ preventScroll: true });
}

function closeRecipe() {
  const sheet = root.querySelector('.rq-sheet');
  const id = sheetId;
  sheetId = null;
  document.documentElement.classList.remove('rq-sheet-open');
  if (!sheet) return;
  sheet.classList.add('out');
  setTimeout(() => sheet.remove(), 200);
  root.querySelector(`.rq-r-head[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  if (id && isDone(id)) towardNext(id);
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
