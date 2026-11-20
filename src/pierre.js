// Pierre-trainer and Pierre-tutor (1.8.0): Kiron's quiz player, for food. One raw food per
// screen, no photos, rated in three steps: texture (0–3 each), taste (tap what's there),
// and how central it is to a meal (1–5). No right answers, no streaks, no
// timer; Back returns to the previous screen. Every tap toggles. "Remove from list" sets a
// food aside. "Send to Harvey's" hands the ratings
// over as text that scripts/ingest-pierre.mjs writes into the brain file.
import {
  stepsOf, validateQuiz, blankState, startRound, tapTexture, tapTaste, tapCentre, tapDistance, tapPrep, tapRated, tapRemove, isRated, isRemoved, upgradeAnswer,
  canAdvance, advance, back, canGoBack, roundOver, unsent, markSent, encodePayload,
} from './quiz/quiz.js';

const VERSION = '1.13.0';
const RENAMED = { protein_bread: 'bread' };
// One player, two quizzes: Pierre-trainer (raw foods) and Pierre-tutor (a food cooked one way).
const QUIZ = document.body.dataset.quiz || 'pierre-trainer';
// The tutor starts fresh with readiness (1.8.1): earlier tutor answers aren't carried over.
const KEY = { 'pierre-tutor': 'harveys.tutor.v2', 'pierre-retest': 'harveys.retest.v1' }[QUIZ] ?? 'marco.pierre.v1';

const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const app = document.getElementById('app');

let quiz = null;
let steps = [];
let state = blankState();
let dir = 0; // 1 when a new screen slides in

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HX = '<input type="checkbox" switch class="haptic" tabindex="-1" aria-hidden="true">';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function load() {
  try { state = { ...blankState(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { state = blankState(); }
  // Foods that left the quiz (protein bread became plain bread in 1.5.2): their old
  // answers aren't sent, and a saved round asks the replacement instead.
  for (const [id, a] of Object.entries(state.answers)) state.answers[id] = upgradeAnswer(a);
  const known = new Set(quiz.foods.map((f) => f.id));
  for (const id of Object.keys(state.answers)) if (!known.has(id)) delete state.answers[id];
  if (state.round) state.round = { ...state.round, ids: state.round.ids.map((id) => RENAMED[id] ?? id) };
  // A saved round whose foods are gone from the quiz restarts cleanly.
  if (state.round && !state.round.ids.every((id) => quiz.foods.some((f) => f.id === id))) state.round = null;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('This phone can’t save right now.'); }
}
const food = (id) => quiz.foods.find((f) => f.id === id);

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

// ── Screens ─────────────────────────────────────────────────────────────────
function render() {
  if (location.hash === '#play' && state.round) return roundOver(state) ? renderEnd() : renderPlay();
  renderHome();
}

function renderHome() {
  document.title = quiz.title;
  const total = quiz.foods.length;
  const rated = quiz.foods.filter((f) => state.answers[f.id]).length;
  const inRound = state.round && !roundOver(state);
  const left = total - rated;
  const toSend = unsent(state).length;
  app.innerHTML = `
  <header class="top"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">‹</a>
    <h1>${esc(quiz.title)}</h1>
  </div></header>
  <main class="wrap quiz-home">
    <div class="meter" role="img" aria-label="${rated} of ${total} foods rated"><i style="transform:scaleX(${(rated / total).toFixed(3)})"></i></div>
    ${left ? `<button class="btn primary xl" data-act="${inRound ? 'resume' : 'begin'}" type="button">${inRound ? 'Keep going' : rated ? 'Next round' : 'Begin'}${HX}</button>` : ''}
    ${rated ? sendLink(toSend, !left) : ''}
    ${rated ? `<button class="btn link quiet reset" data-act="reset" type="button">Start over</button>` : ''}
    <p class="mini center version">Harvey’s ${VERSION} · ${esc(quiz.title)}${quiz.edition ? ` · round ${quiz.edition}` : ''}</p>
  </main>`;
}

function sendLink(toSend, primary) {
  const body = encodePayload(quiz, state.answers);
  const n = Object.keys(state.answers).length;
  const href = `${REPO_ISSUE}?${new URLSearchParams({ title: `${quiz.title}: ${n} foods`, labels: quiz.id, body: '```\n' + body + '\n```' })}`;
  return `<a class="btn${primary ? ' primary xl' : ''} send${toSend ? ' fresh' : ''}" data-act="send" href="${esc(href)}" target="_blank" rel="noopener">Send to Harvey’s</a>`;
}

function renderPlay() {
  const r = state.round;
  const f = food(r.ids[r.i]);
  const step = steps[r.step];
  const d = r.draft;
  document.title = `${f.name} · ${quiz.title}`;
  const dots = r.ids.map((_, i) => `<i class="${i < r.i ? 'past' : i === r.i ? 'now' : ''}"${i === r.i ? ` style="--p:${((r.step + 1) / steps.length).toFixed(3)}"` : ''}></i>`).join('');
  let input = '';
  // A row of None / Low / Medium / High; `attr` says which side of Pierre it rates.
  const rows = (list, values, attr) => `<div class="rates">` + list.map((t) => `
      <div class="rate"><span class="rate-label">${esc(t.label)}${t.line ? `<small>${esc(t.line)}</small>` : ''}</span>
        <div class="segmented levels" role="radiogroup" aria-label="${esc(t.label)}">${quiz.levels.map((w, lv) =>
          `<button type="button" role="radio" aria-checked="${values[t.id] === lv}" ${attr}="${t.id}" data-lv="${lv}">${esc(w)}</button>`).join('')}</div>
      </div>`).join('') + `</div>`;
  if (step === 'texture') {
    input = `<h2 class="step">Texture</h2>` + rows(quiz.textures, d.texture, 'data-tex');
  } else if (step === 'taste') {
    const main = quiz.tastes.filter((t) => !t.bonus);
    const bonus = quiz.tastes.filter((t) => t.bonus);
    input = `<h2 class="step">Taste</h2>` + rows(main, d.taste, 'data-taste')
      + (bonus.length ? `<h2 class="step bonus">Bonus</h2>` + rows(bonus, d.taste, 'data-taste') : '');
  } else if (step === 'distance') {
    input = `<h2 class="step">How far from done?</h2><div class="opts" role="radiogroup" aria-label="How far from done">` + quiz.distance.map((c) => `
      <button type="button" class="opt centre ready${d.distance === c.value ? ' sel' : ''}" role="radio" aria-checked="${d.distance === c.value}" data-distance="${c.value}">
        <span class="k">${c.value}</span><span class="ct"><b>${esc(c.label)}</b><small>${esc(c.line)}</small></span>
      </button>`).join('') + `</div>`;
  } else {
    input = `<h2 class="step">How central?</h2><div class="opts" role="radiogroup" aria-label="How central">` + quiz.centre.map((c) => `
      <button type="button" class="opt centre${d.centre === c.value ? ' sel' : ''}" role="radio" aria-checked="${d.centre === c.value}" data-centre="${c.value}">
        <span class="k">${c.value}</span><span class="ct"><b>${esc(c.label)}</b><small>${esc(c.line)}</small></span>
      </button>`).join('') + `</div>`;
  }
  if (!d.rated || d.removed) input = `<div class="prep-dim" aria-hidden="true">${input}</div>`;
  // What the food is: rated, part of prep, or both. Set on its first screen.
  if (step === 'texture' && !d.removed && quiz.kinds !== false) {
    const kind = (key, on, title, line) => `<button type="button" class="opt kind${on ? ' sel' : ''}" data-kind="${key}" aria-pressed="${on}"><span class="k box">${on ? '✓' : ''}</span><span class="ct"><b>${title}</b><small>${line}</small></span></button>`;
    input = `<div class="opts grid2 kinds" role="group" aria-label="This food is">${kind('rated', d.rated, 'Rate it', 'Texture, taste, centre')}${kind('prep', d.prep, 'Part of prep', 'Needs further processing')}</div>` + input;
  }
  const last = r.i + 1 >= r.ids.length;
  const nextLabel = r.step < steps.length - 1 && d.rated && !d.removed ? 'Next' : last ? 'Finish round' : 'Next food';
  const ok = canAdvance(r.step, d, steps);
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="#" aria-label="Leave this round">✕</a>
    <div class="dots" role="img" aria-label="Food ${r.i + 1} of ${r.ids.length}">${dots}</div>
  </div></header>
  <main class="wrap play">
    <article class="qcardp${reduceMotion() ? '' : dir > 0 ? ' in-next' : dir < 0 ? ' in-prev' : ''}">
      <h1 class="prompt" tabindex="-1">${esc(f.name)}</h1>
      ${how(f) ? `<p class="how">${esc(how(f))}</p>` : ''}
      <button type="button" class="btn link quiet remove${d.removed ? ' on' : ''}" data-act="remove" aria-pressed="${d.removed}">${d.removed ? 'Removed from the list · Undo' : 'Remove from list'}</button>
      ${input}
    </article>
  </main>
  <div class="actionbar"><div class="actionbar-in">
    ${canGoBack(state) ? `<button class="btn ghost back" data-act="back" type="button" aria-label="Back">‹</button>` : ''}
    <button class="btn primary grow${ok ? '' : ' soft'}" data-act="next" type="button" aria-disabled="${!ok}">${nextLabel}${HX}</button>
  </div></div>`;
  dir = 0;
}

// What the technique means, when the name doesn't already say it ("Moong dal, with tadka" → "Tempered with a tadka").
function how(f) {
  const line = f.technique && quiz.techniques?.[f.technique];
  return line && !f.name.toLowerCase().endsWith(line.toLowerCase()) ? line : '';
}

function renderEnd() {
  const r = state.round;
  const left = quiz.foods.some((f) => !state.answers[f.id]);
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="#" aria-label="Back">✕</a>
    <div class="dots" role="img" aria-label="Round finished">${r.ids.map(() => '<i class="past"></i>').join('')}</div>
  </div></header>
  <main class="wrap play"><div class="endcard">
    <h1 class="prompt">${left ? 'Round done' : 'Every food rated'}</h1>
    <div class="tiles">${r.ids.map((id) => tile(food(id))).join('')}</div>
    <div class="cta">
      ${left ? `<button class="btn primary xl" data-act="begin" type="button">Keep going${HX}</button>` : ''}
      ${sendLink(unsent(state).length, !left)}
      <button class="btn ghost" data-act="back" type="button">Back to ${esc(food(r.ids[r.ids.length - 1]).name)}</button>
    </div>
  </div></main>`;
}

function tile(f) {
  const a = state.answers[f.id];
  if (isRemoved(a)) return `<div class="tile removed"><b>${esc(f.name)}</b><span class="c">✕</span></div>`;
  return `<div class="tile"><b>${esc(f.name)}</b>${isRated(a) ? `<span class="c">${a.distance != null ? a.distance : a.centre}</span>` : ''}${a?.prep ? `<span class="c prep${isRated(a) ? ' second' : ''}">P</span>` : ''}</div>`;
}

// ── Taps ────────────────────────────────────────────────────────────────────
function patch(fn) {
  state.round = { ...state.round, draft: fn(state.round.draft) };
  save();
  const y = scrollY;
  renderPlay();
  scrollTo(0, y);
}

let armed = 0;
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tex],[data-taste],[data-centre],[data-distance],[data-kind],[data-act]');
  if (!el) return;
  if (el.dataset.kind) return patch((d) => (el.dataset.kind === 'prep' ? tapPrep(d) : tapRated(d)));
  if (el.closest('.prep-dim')) return;
  if (el.dataset.tex) return patch((d) => tapTexture(d, el.dataset.tex, Number(el.dataset.lv)));
  if (el.dataset.taste) return patch((d) => tapTaste(d, el.dataset.taste, Number(el.dataset.lv)));
  if (el.dataset.centre) return patch((d) => tapCentre(d, Number(el.dataset.centre)));
  if (el.dataset.distance) return patch((d) => tapDistance(d, el.dataset.distance === 'x' ? 'x' : Number(el.dataset.distance)));
  const act = el.dataset.act;
  if (act === 'remove') return patch(tapRemove);
  if (act === 'back') {
    state = back(quiz, state);
    save();
    dir = -1;
    if (location.hash !== '#play') location.hash = 'play'; else { render(); scrollTo(0, 0); }
  } else if (act === 'next') {
    if (!canAdvance(state.round.step, state.round.draft, steps)) return toast(state.round.draft.rated ? 'Pick one to go on.' : 'Rate it, or mark it part of prep.');
    state = advance(quiz, state);
    save();
    dir = 1;
    render();
    scrollTo(0, 0);
    app.querySelector('.prompt')?.focus({ preventScroll: true });
  } else if (act === 'begin') {
    state = startRound(quiz, state);
    save();
    dir = 1;
    if (location.hash === '#play') { render(); scrollTo(0, 0); } else location.hash = 'play';
  } else if (act === 'resume') {
    location.hash = 'play';
  } else if (act === 'send') {
    // The link opens a prefilled GitHub issue; the same text goes to the clipboard to paste to Claude.
    const text = encodePayload(quiz, state.answers);
    navigator.clipboard?.writeText(text).then(() => toast('Copied, and opening GitHub.'), () => {});
    state = markSent(state, Object.keys(state.answers));
    save();
    setTimeout(render, 300);
  } else if (act === 'reset') {
    if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; el.classList.add('armed'); return; }
    state = blankState();
    save();
    render();
  }
});
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.haptic') && !('switch' in HTMLInputElement.prototype) && navigator.vibrate) navigator.vibrate(8);
});

async function init() {
  const res = await fetch(new URL(`./quiz/${QUIZ}.json${new URL(import.meta.url).search}`, import.meta.url));
  quiz = validateQuiz(await res.json());
  // Pierre-tutor asks only pairs the brain doesn't hold or set aside yet (1.10.1): answers saved on
  // another phone or browser, or cleared, don't bring back pairs already ingested.
  if (QUIZ === 'pierre-tutor') {
    const { PIERRE_RAW } = await import('./brain/pierre-raw.js');
    const done = new Set([...Object.keys(PIERRE_RAW.tech ?? {}), ...(PIERRE_RAW.excluded ?? [])]);
    quiz = { ...quiz, foods: quiz.foods.filter((f) => !done.has(f.id)) };
  }
  steps = stepsOf(quiz);
  load();
  render();
}
init().catch((e) => { app.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
