// Marco prep quiz (1.24.0): one dish, two ways to make it, at a stated time and energy.
// Tap the way you'd actually do it. Answers save after every tap and go out by
// "Send to Harvey's" (a GitHub issue, and the clipboard). scripts/fit-prep.mjs fits θ.
import { PREP_ROUNDS, ENERGY, prepFacts, encodePrep } from './quiz/prep.js';

const VERSION = '1.28.0';
// ?round=2 opens round 2; each round keeps its own answers.
const ROUND = PREP_ROUNDS[new URLSearchParams(location.search).get('round')] ? Number(new URLSearchParams(location.search).get('round')) : 1;
const PREP_QUIZ = PREP_ROUNDS[ROUND];
const KEY = ROUND === 1 ? 'harveys.prep.v1' : `harveys.prep.r${ROUND}.v1`;
const TITLE = ROUND === 1 ? 'Marco prep' : `Marco prep round ${ROUND}`;
const REPO_ISSUE = 'https://github.com/pranjalparashar1/harveys/issues/new';
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state = { answers: {}, i: 0 };
const load = () => { try { state = { ...state, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* fresh */ } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('This phone can’t save right now.'); } };

let toastT;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

const done = () => PREP_QUIZ.filter((q) => state.answers[q.id]?.pick).length;

function option(q, side, pick) {
  const opt = q[side];
  const on = pick === side;
  return `<button type="button" class="opt centre${on ? ' sel' : ''}" role="radio" aria-checked="${on}" data-pick="${side}">
    <span class="ct"><b>${esc(opt.name)}</b><small>${esc(opt.how)}</small>
    <span class="reasons">${prepFacts(opt).map((f) => `<span>${esc(f)}</span>`).join('')}</span></span>
  </button>`;
}

function render() {
  const n = PREP_QUIZ.length;
  if (state.i >= n) return renderEnd();
  const q = PREP_QUIZ[state.i];
  const pick = state.answers[q.id]?.pick;
  document.title = `${q.dish} · ${TITLE}`;
  const extra = (v, label) => `<button type="button" class="chip toggle" role="radio" aria-checked="${pick === v}" data-pick="${v}">${label}</button>`;
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">✕</a>
    <div class="meter" role="img" aria-label="Question ${state.i + 1} of ${n}" style="flex:1;margin:0 8px"><i style="transform:scaleX(${(state.i / n).toFixed(3)})"></i></div>
    <span class="mini">${state.i + 1}/${n}</span>
  </div></header>
  <main class="wrap play">
    <article class="qcardp">
      <p class="mini">${esc(q.when)} · ${esc(ENERGY[q.energy])}</p>
      <h1 class="prompt" tabindex="-1">${esc(q.dish)}</h1>
      <div class="opts" role="radiogroup" aria-label="How you'd make it">${option(q, 'a', pick)}${option(q, 'b', pick)}</div>
      <div class="chips" role="radiogroup" aria-label="Or">${extra('either', 'Either')}${extra('neither', 'Neither tonight')}</div>
    </article>
  </main>
  <div class="actionbar"><div class="actionbar-in">
    ${state.i > 0 ? '<button class="btn ghost back" data-act="back" type="button" aria-label="Back">‹</button>' : ''}
    <button class="btn ghost grow" data-act="skip" type="button">${pick ? (state.i + 1 === n ? 'Finish' : 'Next') : 'Skip'}</button>
  </div></div>`;
}

function renderEnd() {
  const body = encodePrep(state.answers, PREP_QUIZ);
  const href = `${REPO_ISSUE}?${new URLSearchParams({ title: `${TITLE}: ${done()} answers`, labels: 'benchmark', body: '```\n' + body + '\n```' })}`;
  app.innerHTML = `
  <header class="top play"><div class="top-in">
    <a class="icon-btn" href="train.html" aria-label="Back to Train">✕</a>
    <h1>${esc(TITLE)}</h1>
  </div></header>
  <main class="wrap play"><div class="endcard">
    <h1 class="prompt">${done()} of ${PREP_QUIZ.length} answered</h1>
    <div class="cta">
      <a class="btn primary xl send" data-act="send" href="${esc(href)}" target="_blank" rel="noopener">Send to Harvey’s</a>
      <button class="btn ghost" data-act="back" type="button">Back to the last one</button>
      <button class="btn link quiet reset" data-act="reset" type="button">Start over</button>
    </div>
    <p class="mini center version">Harvey’s ${VERSION} · ${esc(TITLE)}</p>
  </div></main>`;
}

let armed = 0;
let advanceT;
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-pick],[data-act]');
  if (!el) return;
  clearTimeout(advanceT);
  if (el.dataset.pick) {
    const q = PREP_QUIZ[state.i];
    state.answers[q.id] = { pick: el.dataset.pick, at: new Date().toISOString() };
    save();
    render();
    // A short beat so the tap shows, then on to the next question.
    advanceT = setTimeout(() => { state.i += 1; save(); render(); scrollTo(0, 0); }, 260);
    return;
  }
  const act = el.dataset.act;
  if (act === 'send') {
    navigator.clipboard?.writeText(encodePrep(state.answers, PREP_QUIZ)).then(() => toast('Copied, and opening GitHub.'), () => {});
    return;
  }
  if (act === 'skip') state.i += 1;
  else if (act === 'back') state.i = Math.max(0, state.i - 1);
  else if (act === 'reset') {
    if (Date.now() - armed > 4000) { armed = Date.now(); el.textContent = 'Tap again to erase'; return; }
    state = { answers: {}, i: 0 };
  }
  save();
  render();
  scrollTo(0, 0);
});

load();
state.i = Math.min(state.i, PREP_QUIZ.length);
render();
