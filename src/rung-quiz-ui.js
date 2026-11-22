// Rung quiz screens (1.31.0; one-tap send, a fresh tester per run 1.32.0; relay send 1.33.0): what a tester sees
// after Proceed. Kiron's rules: one question
// per screen, a story bar with no numbers, drag to sort, tap to pick, haptics on every tap.
// The brain work is src/brain/rung-quiz.js; this file is screens, drag, storage and sending.
import { buildRungQuiz, encodeRungResult, CRITERIA } from './brain/rung-quiz.js';
import { sendResult, flush, setToken, outbox } from './send.js';
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
const freshRun = () => ({ testerId: newTesterId(), runNo: ++store.seq, answers: { marco: {}, pierre: {}, white: {}, feedback: blankFeedback() }, at: 0, sent: false });
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

/** screens: intro, a cover per section, each step, end. */
function screens() {
  const out = [{ kind: 'intro' }];
  let last = null;
  for (const s of quiz.steps) {
    if (s.section !== last) { out.push({ kind: 'cover', section: s.section }); last = s.section; }
    out.push({ kind: s.section === 'white' ? 'white' : 'sort', ...s });
  }
  // 1.34.0: what went wrong, then one short screen for each chip tapped.
  if (quiz.steps.length) {
    out.push({ kind: 'feedback' });
    const chips = run.answers.feedback?.chips ?? [];
    for (const chip of FOLLOW_UPS) if (chips.includes(chip)) out.push({ kind: 'fb', chip });
  }
  out.push({ kind: 'end' });
  return out;
}

export function startRungQuiz({ kitchen, inventory, version, source, onExit }) {
  opts = { version, source, onExit };
  quiz = buildRungQuiz({ kitchen, inventory });
  store = loadStore();
  run = store.runs[quiz.id];
  // A sent run belongs to the last person: whoever opens it next is someone new.
  if (!run || run.sent) run = store.runs[quiz.id] = freshRun();
  run.testerId ??= newTesterId();
  run.answers.feedback ??= blankFeedback();
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
    root.addEventListener('submit', (e) => { const f = e.target.closest('.rq-add'); if (f && fb) { e.preventDefault(); fbAdd(f); } });
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

const resultOf = () => encodeRungResult(quiz, run.answers, { version: opts.version, at: new Date().toISOString(), testerId: run.testerId, runNo: run.runNo, source: opts.source });

// ── Render ──────────────────────────────────────────────────────────────────
function bar(list) {
  // One segment per question (covers and the end screen don't count), filled as you go.
  const qs = list.map((s, i) => [s, i]).filter(([s]) => s.kind === 'sort' || s.kind === 'white' || s.kind === 'feedback');
  return `<div class="rq-bar" aria-hidden="true">${qs.map(([s, i]) => `<i class="${i < run.at ? 'done' : i === run.at ? 'now' : ''}"></i>`).join('')}</div>`;
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
        <p class="rq-eyebrow">Taste test</p>
        <h1 class="rq-title">Teach Harvey how you cook</h1>
        <p class="rq-lead">${Object.keys(quiz.dishes).length ? (opts.source === 'link' ? `Harvey looked through your kitchen and found ${Object.keys(quiz.dishes).length} dishes you can make.` : 'Harvey found dishes you can make with your kitchen.') : 'Harvey couldn’t find a dish in this kitchen yet.'} Picture a weeknight, 9 PM. You’re tired.</p>
        <ol class="rq-rounds">
          <li><b>Easiest first</b><span>Sort by effort</span></li>
          <li><b>Tastiest first</b><span>Sort by taste</span></li>
          <li><b>What you’d cook</b><span>Pick your favourites</span></li>
        </ol>
        <p class="rq-small">All taps, a few minutes. At the end you can tell Harvey what it got wrong.</p>
      </div>`;
    foot = Object.keys(quiz.dishes).length
      ? `<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Start</span></button>`
      : `<p class="rq-lead">Add a few more things to your list and try again.</p><button class="btn xl rq-go" data-act="close" type="button">${HX}<span>Back to my list</span></button>`;
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
  } else if (s.kind === 'feedback' || s.kind === 'fb') {
    fb = run.answers.feedback;
    fb.seen = true;
    body = s.kind === 'feedback' ? feedbackScreen() : followUp(s.chip);
    foot = `${back}<button class="btn primary xl rq-go" data-act="next" type="button">${HX}<span>Next</span></button>`;
  } else {
    ({ body, foot } = endScreen());
  }

  const ghost = s.kind === 'intro' || s.kind === 'end';
  root.innerHTML = `
    <header class="rq-top">
      <button class="rq-icon" data-act="close" type="button" aria-label="Close">${HX}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      ${ghost ? '<div class="rq-bar"></div>' : bar(list)}
    </header>
    <main class="rq-body${enter ? '' : ' in'}" data-kind="${s.kind}">${body}</main>
    <footer class="rq-foot">${foot}</footer>`;
  root.scrollTop = 0;
  if (picks) syncPicks();
  if (fb) syncFb();
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
  const copy = {
    '': ['That’s all. Thank you!', 'One tap sends your answers to Harvey’s.'],
    sending: ['Sending…', 'Putting your answers in Harvey’s.'],
    sent: ['Sent. Thank you!', 'Your answers are in Harvey’s. Hand the phone to the next person.'],
    queued: ['Saved. Thank you!', `Your answers are safe on this phone${waiting > 1 ? ` with ${waiting - 1} more` : ''} and send themselves as soon as they can. Leave this page open for a minute if you can.`],
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
    ? `<button class="btn primary xl rq-go" data-act="nextperson" type="button">${HX}<span>Next person</span></button>`
    : ask
      ? `<button class="btn primary xl rq-go" data-act="token" type="button">${HX}<span>Save and send</span></button>`
      : `<button class="btn primary xl rq-go" data-act="send" type="button"${st === 'sending' ? ' disabled' : ''}>${HX}<span>${st === 'sending' ? 'Sending…' : 'Send to Harvey’s'}</span></button>`;
  const alt = [
    done ? '<button class="btn link" data-act="close" type="button">Done for now</button>' : '',
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
  if (act === 'back') { commit(s); run.at = Math.max(0, run.at - 1); save(); return render(); }
  if (act === 'next' && el.classList.contains('ask')) { root.querySelector('.rq-why').scrollIntoView({ behavior: 'smooth', block: 'center' }); root.querySelector('.rq-why').classList.add('nudge'); setTimeout(() => root.querySelector('.rq-why')?.classList.remove('nudge'), 700); return; }
  if (act === 'next') { commit(s); run.at = Math.min(list.length - 1, run.at + 1); save(); return render(); }
  if (act === 'pick') { toggleIn(picks.picks, el.dataset.id); picks.none = false; if (!picks.picks.length) picks.criteria = []; return syncPicks(); }
  if (act === 'why') { toggleIn(picks.criteria, el.dataset.id); return syncPicks(); }
  if (act === 'none') { picks.none = !picks.none; if (picks.none) { picks.picks = []; picks.criteria = []; } return syncPicks(); }
  if (act.startsWith('fb')) return fbTap(act, el);
  if (act === 'send') return send();
  if (act === 'github') { const res = resultOf(); window.open(issueHref(res), '_blank', 'noopener'); sendState = 'sent'; markSent(); return; }
  if (act === 'token') return saveToken();
  if (act === 'nextperson') { store.runs[quiz.id] = run = freshRun(); sendState = ''; save(); return render(); }
  if (act === 'file') { download(resultOf()); return; }
  if (act === 'restart') {
    if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again to start over'; setTimeout(() => { el.classList.remove('armed'); el.textContent = 'Start over'; }, 4000); return; }
    store.runs[quiz.id] = run = freshRun();
    sendState = '';
    save();
    return render();
  }
}

/** Keeps what's on screen. Time adds up if a tester comes back to a question. */
function commit(s) {
  const ms = Math.round(performance.now() - shownAt);
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
